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
import { PURE_MEDIA_ID } from '../../lib/postprocessMedia'
import { getVideoLibraryDirs } from './library'
import { resolveVideoNamePrefix, type ImageVideoNamingContext } from './naming'
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
  /**
   * 命名上下文（产品线 / 产品 / 方向 / 渠道 / 创作者 / 分辨率）。
   *
   * **必传**（内部字段可空）：这东西只有调用方手上才有 —— 项目树在 store 里、渠道名在
   * 产出记录里。这里刻意不给兜底默认值：缺了它 `{product}` 这类 token 会整段消失、
   * 文件名悄悄变短，而界面预览显示的还是完整那份（见了鬼的一类不一致）。
   */
  naming: ImageVideoNamingContext
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
 * 这一次**实际**要出几个视频、每个视频用几张图。
 *
 * 「每张图各出一个视频」（`videoCountMode === 'perImage'`）是杰哥 2026-09-28 要的
 * 「单图加特效」那种：一个视频只用 1 张图、靠画面效果撑满时长 —— 所以**视频数 = 目录里的图片数**。
 *
 * 引擎**没有**这个模式：`engine/config.py` 要求显式给「视频数」与「每片图片数」，
 * 还校验「图片数 ≥ 两者之积」。所以这里换算成 `{ imagesPerVideo: 1, videoCount: 图片数 }`，
 * 恰好满足那条校验 —— **别改成让引擎自己数**（它不会）。
 */
export function resolveVideoPlan(
  params: ImageVideoParams,
  imageCount: number,
): { imagesPerVideo: number; videoCount: number } {
  if (params.videoCountMode === 'perImage') return { imagesPerVideo: 1, videoCount: imageCount }
  return { imagesPerVideo: params.imagesPerVideo, videoCount: params.videoCount }
}

/** 一条可以直接拿去转视频的输入目录，带上它属于哪个渠道。 */
export interface ImageVideoInputDir {
  /** 渠道 id（`PostprocessMedia.id`）；用它是为了取这个渠道自己的视频参数 */
  mediaId: string
  /** 渠道显示名（报错与提示里给用户看的，别让人对着 `gdt` 猜） */
  mediaName: string
  dir: string
  /** 这批产出是什么时候写的（用来判断新鲜度，也便于界面提示） */
  createdAt: number
}

interface PostprocessOutputLike {
  path: string
  mediaId?: string
  mediaName?: string
  collectionId?: string
  createdAt?: number
}

/**
 * 从一批产出记录里算出「这个方向、每个渠道各自最近一批」的图片目录。
 *
 * ## 为什么还是查记录，而不是自己去扫导出目录
 *
 * 杰哥 2026-09-28 的原话是「默认应该是输出位置，而不是纯净版」。但**不能**真的去扫
 * 导出位置猜目录：批次目录名里那段项目/方向是可以被命名模板改掉的（`{product}` / `{direction}`），
 * 一旦用户改了模板，按名字匹配就会静默失配 —— 视频生成时才发现「一张图都没有」。
 * 产出记录里的 `collectionId` / `mediaId` 是**写入时记下的归属**，改模板也不会错。
 *
 * 所以「跟随渠道与输出」落在口径上就是这三条：
 *
 * 1. **按渠道分组** —— 每个渠道一份目录，各自出一批视频（多渠道各一份）；
 * 2. **每个渠道只取最近那一批**（`createdAt` 最大）—— 以前是把历史上所有批次全堆进来，
 *    于是几个月前的旧目录也会被拿去转视频；
 * 3. **排除历史「纯净版」**（`mediaId === 'clean'`）—— ADR-0020 起就不再产出它，
 *    但老记录还在库里，而那些文件夹多半早被清理或分发搬走。**2026-09-28 实测报障就是它**：
 *    清单里混进一个已不存在的纯净版目录，引擎数到 0 张图直接报错。
 *
 * ⚠️ 「目录还在不在、里面有没有图」**不在这里判**：这是纯函数，读不了磁盘。
 * 调用方（`resolveUsableInputDirs`）负责过滤，避免把一个已消失的目录送进引擎。
 */
export function resolveDirectionInputDirsByMedia(
  outputs: readonly PostprocessOutputLike[],
  directionId: string,
): ImageVideoInputDir[] {
  const latestByMedia = new Map<string, ImageVideoInputDir>()
  for (const output of outputs) {
    if (output.collectionId !== directionId) continue
    const mediaId = typeof output.mediaId === 'string' ? output.mediaId.trim() : ''
    if (!mediaId || mediaId === PURE_MEDIA_ID) continue
    const dir = dirNameOf(output.path)
    if (!dir) continue
    const createdAt = typeof output.createdAt === 'number' ? output.createdAt : 0
    const current = latestByMedia.get(mediaId)
    if (!current || createdAt > current.createdAt) {
      const mediaName =
        typeof output.mediaName === 'string' && output.mediaName.trim() ? output.mediaName.trim() : mediaId
      latestByMedia.set(mediaId, { mediaId, mediaName, dir, createdAt })
    }
  }
  // 稳定顺序：按渠道 id 排，同一次点击跑出来的批次顺序不该随记录顺序变
  return [...latestByMedia.values()].sort((a, b) => a.mediaId.localeCompare(b.mediaId))
}

/**
 * 把「候选目录」过滤成**真的能用**的那些：目录要存在、且里面数得到图。
 *
 * 为什么要单独一步（而不是直接把候选丢给引擎）：引擎对空目录的报错是
 * 「图片数量不足，共有0张」，用户看到的是引擎在抱怨，而真因在**我们给错了目录**
 * （分发把批次目录按排期日搬走改名了、或者用户手工清理过）。这里先查一遍，
 * 就能把「哪个目录、为什么不能用」如实说出来。
 *
 * `scan` 由调用方注入（桌面端走引擎的 `scan_images`）—— 纯函数好测，也不必在渲染进程里
 * 自己实现一套图片计数。
 */
export async function partitionUsableInputDirs(
  candidates: readonly ImageVideoInputDir[],
  scan: (dir: string) => Promise<number>,
): Promise<{ usable: ImageVideoInputDir[]; skipped: Array<ImageVideoInputDir & { reason: string }> }> {
  const usable: ImageVideoInputDir[] = []
  const skipped: Array<ImageVideoInputDir & { reason: string }> = []
  for (const candidate of candidates) {
    try {
      const count = await scan(candidate.dir)
      if (count > 0) usable.push(candidate)
      else skipped.push({ ...candidate, reason: '目录里没有图片' })
    } catch (error) {
      skipped.push({ ...candidate, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { usable, skipped }
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
  /**
   * 素材库的两个根：BGM 与视频水印的路径都要拼在它下面。
   *
   * 拿不到库目录时**不能静默降级** —— 用户开着 BGM / 水印却拿到一条无声、无水印的成片，
   * 是最难自查的一类错（成片看着「就是没生效」）。所以只在两个开关都关着时才允许继续。
   */
  const dirs = await getVideoLibraryDirs().catch(() => null)
  if (!dirs && (input.params.useBgm || input.params.useVideoWatermark)) {
    throw new Error('开着背景音乐或视频水印，但读不到素材库位置，先打开一次「视频素材」分区再试')
  }
  const library = { bgm: dirs?.bgm ?? '', watermark: dirs?.watermark ?? '' }
  // 「每张图各出一个视频」要等数完图才知道出几个（`resolveVideoPlan`）
  const plan = resolveVideoPlan(input.params, scanned.count)
  // 文件名前缀：命名模板 + 这一批的上下文。界面预览走的是同一个函数（见 `naming.ts`），
  // 否则会出现「预览显示一段、落盘少一段」这种只能在目录里数文件才发现的不一致
  const namePrefix = resolveVideoNamePrefix(input.params, input.naming)
  const config = buildEngineConfig(input.params, { inputDir, outputDir, library, namePrefix }, plan)
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
    expectedCount: plan.videoCount,
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
