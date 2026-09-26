/**
 * 生成视频的执行链路：从「这个方向的一批图片」到「一批 mp4」。
 *
 * ## 一次任务的生命周期
 *
 * ```
 * ① 数图（scan_images）   0 张就直接报错 —— 不让引擎白起一个任务再说「图片数量不足」
 * ② 起任务（start_job）   立刻返回 job_id，渲染在引擎的 worker 子进程里跑
 * ③ 等终态（job.finished）进度靠 job.progress 事件推回来
 * ④ 取消（cancel_job）    signal 一 abort 就发；引擎会把已写出的文件保留
 * ```
 *
 * ## 为什么终态认 `job.finished` 而不是 `job.done`
 *
 * `job.done` 是 worker **自称**跑完（`runner.py` 的 `_apply_worker_payload`），
 * 而 `job.finished` 是引擎在**子进程真的退出之后**才发的，并且无论成功、失败还是取消都会发。
 * 只认 `done` 的话，worker 崩了就会永远等下去（界面上表现为进度条卡住、点取消也没反应）。
 *
 * ## 输入目录是「产出目录」，不是导出根
 *
 * 后处理一次运行会写多个目录（多渠道双写），而视频要的是**这个方向这一批图所在的目录**。
 * 用根目录会把别的方向、别的批次的图一起吞进去 —— 那种错误在成片里才看得出来，
 * 而且每次都要人工比对才能确认。所以这里按产出记录的归属方向筛出目录（见
 * `resolveDirectionInputDirs`）。
 */

import type {
  ImageVideoEngineEvent,
  ImageVideoJobState,
  ImageVideoScanResult,
  ImageVideoStartResult,
} from './engineTypes'
import { buildEngineConfig, resolveVideoOutputDir } from './params'
import type { ImageVideoParams } from './types'

export type ImageVideoRunStatus = 'completed' | 'failed' | 'cancelled'

export interface ImageVideoRunProgress {
  /** 当前这个视频的进度 0-100 */
  percent: number
  /** 整批进度 0-100 */
  overall: number
  message: string
  speed: string | null
}

export interface ImageVideoRunInput {
  /** 输入目录（这个方向本次产出的图片所在目录） */
  inputDir: string
  /** 已按继承链解析完的参数 */
  params: ImageVideoParams
  onProgress?: (progress: ImageVideoRunProgress) => void
  signal?: AbortSignal
}

export interface ImageVideoRunResult {
  status: ImageVideoRunStatus
  jobId: string
  /** 视频落点目录 */
  outputDir: string
  /** 引擎给的结束语（成功是「处理完成」，失败带退出码） */
  message: string
  /** 这次计划出几个视频 */
  expectedCount: number
}

/** 取文件所在目录（只用字符串处理：渲染进程没有 node:path）。 */
function dirNameOf(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index > 0 ? normalized.slice(0, index) : ''
}

/**
 * 从一批产出记录里算出「属于这个方向的图片所在目录」（去重保序）。
 *
 * 用 `collectionId` 筛而不是猜目录名：目录名里的项目/方向段是可以被命名模板改掉的，
 * 一旦用户改了模板，按名字匹配就会静默失配（视频生成时才发现「一张图都没有」）。
 */
export function resolveDirectionInputDirs(
  outputs: readonly { path: string; collectionId?: string }[],
  directionId: string,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const output of outputs) {
    if (output.collectionId !== directionId) continue
    const dir = dirNameOf(output.path)
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    result.push(dir)
  }
  return result
}

/** 跑一次视频生成，跑到终态才返回。 */
export async function runImageVideoJob(input: ImageVideoRunInput): Promise<ImageVideoRunResult> {
  const api = window.electronAPI
  if (!api?.imageVideoCall || !api.onImageVideoEvent) {
    throw new Error('当前环境不支持图转视频（需要在桌面应用里使用）')
  }

  const inputDir = input.inputDir.trim()
  if (!inputDir) throw new Error('没有找到这个方向的产出目录，先导出图片再来生成视频')
  const outputDir = resolveVideoOutputDir(inputDir, input.params.outputDir)
  if (!outputDir) throw new Error('视频输出目录解析失败')

  // ① 数图：0 张就停在这里。引擎那边的报错是「图片数量不足，共有0张」，转手给用户看
  // 需要多一步翻译，不如在这儿直接说清楚是哪个目录里没有图。
  const scanResult = await api.imageVideoCall({ method: 'scan_images', params: { input_dir: inputDir } })
  if (!scanResult.success) throw new Error(scanResult.error)
  const scanned = scanResult.result as ImageVideoScanResult | undefined
  if (!scanned || !scanned.count) {
    throw new Error(`目录里没有图片，无法生成视频：${inputDir}`)
  }

  // ② 起任务
  const config = buildEngineConfig(input.params, { inputDir, outputDir })
  const started = await api.imageVideoCall({
    method: 'start_job',
    params: { config },
    // 引擎要先写配置、拉 worker 子进程；给它 60s（onefile 冷启动可能较慢）
    timeoutMs: 60_000,
  })
  if (!started.success) throw new Error(started.error)
  const jobId = (started.result as ImageVideoStartResult | undefined)?.job_id
  if (!jobId) throw new Error('引擎没有返回任务号，无法跟踪进度')

  // ③ 等终态
  return waitForJobFinished(api, jobId, {
    outputDir,
    expectedCount: input.params.videoCount,
    onProgress: input.onProgress,
    signal: input.signal,
  })
}

/** 事件 payload 是 `Record<string, unknown>`，按 `job_id` 存在与否判定它是不是任务状态。 */
function asJobState(payload: Record<string, unknown>): ImageVideoJobState | null {
  return typeof payload.job_id === 'string' ? (payload as unknown as ImageVideoJobState) : null
}

interface WaitOptions {
  outputDir: string
  expectedCount: number
  onProgress?: (progress: ImageVideoRunProgress) => void
  signal?: AbortSignal
}

function waitForJobFinished(
  api: NonNullable<Window['electronAPI']>,
  jobId: string,
  options: WaitOptions,
): Promise<ImageVideoRunResult> {
  return new Promise<ImageVideoRunResult>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      unsubscribe?.()
      options.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (result: ImageVideoRunResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const unsubscribe = api.onImageVideoEvent?.((payload) => {
      const event = payload as ImageVideoEngineEvent
      if (!event || event.type !== 'event') return

      // 引擎整体退出：不管是崩了还是被别处关了，这个任务都已经没了下文。
      // 不处理的话界面会永远停在最后那个百分比上（用户以为还在跑）。
      if (event.event === 'engine.closed') {
        fail(new Error('图转视频引擎已退出，任务中断'))
        return
      }

      const state = asJobState(event.payload)
      if (!state || state.job_id !== jobId) return

      if (event.event === 'job.progress' || event.event === 'job.status') {
        options.onProgress?.({
          percent: Number(state.progress) || 0,
          overall: Number(state.overall) || 0,
          message: state.message ?? '',
          speed: state.speed ?? null,
        })
        return
      }

      if (event.event === 'job.finished') {
        const status: ImageVideoRunStatus =
          state.status === 'completed' ? 'completed' : state.status === 'cancelled' ? 'cancelled' : 'failed'
        finish({
          status,
          jobId,
          outputDir: options.outputDir,
          message: state.message ?? '',
          expectedCount: options.expectedCount,
        })
      }
    })

    const onAbort = () => {
      // 取消是「请求」不是「立刻断言」：引擎还有收尾（关 ffmpeg、清临时文件），
      // 真正的结论等 job.finished 回来（那时 status 是 cancelled）
      void api.imageVideoCall?.({ method: 'cancel_job', params: { job_id: jobId } })
    }
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort)
  })
}

/** 暂停 / 继续（界面上暂停按钮用；暂停期间任务仍占着引擎，不会自己结束）。 */
export async function pauseImageVideoJob(jobId: string): Promise<void> {
  const api = window.electronAPI
  if (!api?.imageVideoCall) return
  const result = await api.imageVideoCall({ method: 'pause_job', params: { job_id: jobId } })
  if (!result.success) throw new Error(result.error)
}

export async function resumeImageVideoJob(jobId: string): Promise<void> {
  const api = window.electronAPI
  if (!api?.imageVideoCall) return
  const result = await api.imageVideoCall({ method: 'resume_job', params: { job_id: jobId } })
  if (!result.success) throw new Error(result.error)
}
