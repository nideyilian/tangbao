/**
 * 手动生成视频：按「方向 × 渠道」解析图片目录，逐个渠道跑一遍。
 *
 * ## 与自动触发（`autoTrigger.ts`）的分工
 *
 * - **自动**：后处理产出完的那一刻，拿**本次刚写出的目录**，只看开着开关的渠道；
 * - **手动**（本文件）：用户在中控台点「生成视频」，去**产出记录**里按渠道找**最近那一批**
 *   目录 —— 因为点按钮的时候，图早就落盘了，手上没有「本次产出」的清单。
 *   手动是明确的意图，所以**不看渠道的「出视频」开关**（关着的渠道也能手动出一次）。
 *
 * ## 为什么先扫一遍再跑
 *
 * 记录里的目录可能已经不存在了（分发把批次目录按排期日搬走改名、或者用户手工清理过）。
 * 直接把空目录丢给引擎，得到的是引擎的一句「图片数量不足，共有0张」，用户看到的是引擎在抱怨，
 * 而真因是**我们给错了目录**。所以这里先用引擎的 `scan_images` 数一遍，
 * 把失效的挑出来、如实说清是哪个渠道哪个目录，然后**跳过它继续跑其余的**。
 *
 * ⚠️ 这条「跳过而不是中断」是 2026-09-28 实测报障的直接修复：以前第一个目录不对就 return，
 * 后面几个好端端的渠道全都不跑了，而用户只看到一句报错，以为整件事没做。
 */

import { useStore } from '../../store'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import type { TaskPostprocessOutput } from '../../types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { resolveProjectImageVideoParams } from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import type { ImageVideoScanResult } from './engineTypes'
import { resolveVideoNamingContext } from './naming'
import { resolveDirectionInputDirsByMedia, partitionUsableInputDirs, runImageVideoJob } from './runVideo'
import { useImageVideoStore } from './store'

export interface VideoBatchProgress {
  /** 第几个渠道（从 1 起） */
  index: number
  total: number
  percent: number
  message: string
}

export interface VideoBatchResult {
  message: string
  level: 'success' | 'error' | 'info'
}

/** 数一个目录里有几张图（引擎的 `scan_images`）。 */
async function countImages(dir: string): Promise<number> {
  const api = window.electronAPI
  if (!api?.imageVideoCall) throw new Error('当前环境不支持图转视频（需要在桌面应用里使用）')
  const result = await api.imageVideoCall({ method: 'scan_images', params: { input_dir: dir } })
  if (!result.success) throw new Error(result.error)
  const scanned = result.result as ImageVideoScanResult | undefined
  return scanned?.count ?? 0
}

/** 该方向所有历史任务里的后处理产出记录（手动生成要从这里找目录）。 */
function collectDirectionOutputs(directionId: string): TaskPostprocessOutput[] {
  const tasks = useStore.getState().tasks
  const outputs: TaskPostprocessOutput[] = []
  for (const task of tasks) {
    for (const output of task.postprocessOutputs ?? []) {
      if (output.collectionId === directionId) outputs.push(output)
    }
  }
  return outputs
}

export async function runVideoBatchForDirection(input: {
  directionId: string
  directionLabel: string
  onProgress?: (progress: VideoBatchProgress) => void
  signal?: AbortSignal
}): Promise<VideoBatchResult> {
  if (!window.electronAPI?.imageVideoCall) {
    return { message: '当前环境不支持图转视频（需要在桌面应用里使用）', level: 'error' }
  }

  const candidates = resolveDirectionInputDirsByMedia(collectDirectionOutputs(input.directionId), input.directionId)
  if (candidates.length === 0) {
    return {
      message: `「${input.directionLabel}」还没有可用的图片目录 —— 先跑一次后处理把图导出来（视频用导出后的图）`,
      level: 'error',
    }
  }

  const { usable, skipped } = await partitionUsableInputDirs(candidates, countImages)
  if (usable.length === 0) {
    return {
      message: `「${input.directionLabel}」的 ${candidates.length} 个渠道目录都用不了：${skipped
        .map((item) => `${item.mediaName}（${item.reason}）`)
        .join('；')} —— 有可能是这批图已经被分发搬走或清理过，重跑一次后处理再来`,
      level: 'error',
    }
  }

  const collections = useAssetLibraryStore.getState().collections
  const nodeParams = useProjectTreeParamsStore.getState().params
  const globals = useImageVideoStore.getState().globals

  let completed = 0
  const failed: string[] = []
  for (let index = 0; index < usable.length; index += 1) {
    const entry = usable[index]!
    // 每个渠道用它自己那一套参数（2026-09-28 起参数按渠道存）
    const params = resolveProjectImageVideoParams(collections, nodeParams, input.directionId, globals, entry.mediaId)
    // 命名上下文与参数同源：同一个方向、同一个渠道、同一份分辨率 —— 文件名里的每一段都取自
    // 「这次跑的到底是谁」，不能借别的渠道的值（界面预览与实际落盘要逐字一致）
    const naming = resolveVideoNamingContext({
      collections,
      directionId: input.directionId,
      mediaName: entry.mediaName,
      resolution: params.resolution,
      creator: usePostprocessMediaStore.getState().creator,
    })
    input.onProgress?.({ index: index + 1, total: usable.length, percent: 0, message: `正在准备 ${entry.mediaName}…` })
    const result = await runImageVideoJob({
      inputDir: entry.dir,
      params,
      naming,
      signal: input.signal,
      onProgress: (progress) =>
        input.onProgress?.({
          index: index + 1,
          total: usable.length,
          percent: progress.percent,
          message: `${entry.mediaName}：${progress.message}`,
        }),
    })
    if (result.status === 'completed') {
      completed += 1
      continue
    }
    if (result.status === 'cancelled') {
      return { message: `已取消：停止前已完成 ${completed} 个渠道`, level: 'info' }
    }
    failed.push(`${entry.mediaName}：${result.message || '引擎报错'}`)
  }

  // 汇总：出了几个、跳了几个、哪几个没出、为什么 —— 一次说清，不让人猜
  const parts: string[] = []
  if (completed > 0) parts.push(`${completed} 个渠道已出片`)
  if (failed.length > 0) parts.push(`${failed.length} 个失败（${failed.join('；')}）`)
  if (skipped.length > 0) {
    parts.push(
      `${skipped.length} 个目录跳过（${skipped.map((item) => `${item.mediaName}：${item.reason}`).join('；')}）`,
    )
  }
  return {
    message: `「${input.directionLabel}」${parts.join('，')}`,
    level: failed.length > 0 || completed === 0 ? 'error' : 'success',
  }
}
