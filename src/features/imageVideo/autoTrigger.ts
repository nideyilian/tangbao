/**
 * 「导出完自动接着跑」：后处理产出完成之后，按方向的开关自动出视频。
 *
 * ## 为什么挂在后处理收尾、而不是分发之后
 *
 * 分发会**把产出文件夹按排期日搬走**（见 `lib/postprocessDistribution.ts`）——
 * 搬完之后，「这个方向的一批图」就散在好几个日期目录里了，一个视频没法跨那么多目录取图。
 * 所以自动出视频必须发生在**图还聚在一起**的时候，也就是后处理产出之后、分发之前。
 *
 * ⚠️ 由此带来一个组合限制：**同一方向开了分发时，视频用的是分发前的那批图**。
 * 那是刻意的 —— 视频要的是一批连续的图，而分发的目的正是把它们打散。
 *
 * ## 串行，不并发
 *
 * 每个方向完成后各自触发一次，方向多的时候会一起涌进来。引擎本身能跑多任务，
 * 但视频渲染是 CPU 密集型（ffmpeg 编码），同时开几条会把机器占满、还会互相拖慢。
 * 所以这里排成一条链：**前面的跑完（或失败）再跑下一个**。
 *
 * ## 绝不抛错到调用方
 *
 * 后处理的收尾流程不能被视频拖住，也不能因为视频失败而变成「后处理失败了」——
 * 两件事的成败必须分开。所以这里是 fire-and-forget，异常只在提示里体现。
 */

import { resolveDirectionInputDirs, runImageVideoJob } from './runVideo'
import type { ImageVideoParams } from './types'

export interface AutoImageVideoNotice {
  message: string
  level: 'success' | 'error' | 'info'
}

export interface AutoImageVideoInput {
  directionLabel: string
  params: ImageVideoParams
  /** 要处理的图片目录（本次产出实际写到的目录） */
  dirs: string[]
  onNotice?: (notice: AutoImageVideoNotice) => void
}

/**
 * 该不该自动出视频。
 *
 * 两个条件缺一不可：**这个方向开着视频开关**，且**这次真的产出了图**。
 * 后者不能省 —— 零产出的批次（整批被跳过）再去跑一次视频，只会得到一句
 * 引擎报的「图片数量不足」，把一次本来就说清楚的跳过又搅浑一次。
 */
export function shouldAutoRunImageVideo(params: ImageVideoParams, producedCount: number): boolean {
  return params.enabled && producedCount > 0
}

/** 从产出记录里挑出该方向的图片目录（转发 `runVideo` 的实现，避免两处各写一套筛选）。 */
export function resolveAutoImageVideoDirs(
  outputs: readonly { path: string; collectionId?: string }[],
  directionId: string,
): string[] {
  return resolveDirectionInputDirs(outputs, directionId)
}

/** 自动出视频的串行队列（模块级：整个应用一条链）。 */
let queue: Promise<void> = Promise.resolve()

export function enqueueAutoImageVideo(input: AutoImageVideoInput): void {
  queue = queue
    .then(() => runAutoImageVideo(input))
    .catch(() => {
      // runAutoImageVideo 内部已经把所有异常转成提示了；这里兜底只为保证队列不断
    })
}

async function runAutoImageVideo(input: AutoImageVideoInput): Promise<void> {
  let completed = 0
  try {
    for (const inputDir of input.dirs) {
      const result = await runImageVideoJob({ inputDir, params: input.params })
      if (result.status !== 'completed') {
        const reason = result.status === 'cancelled' ? '已取消' : result.message || '引擎报错'
        input.onNotice?.({
          message: `自动出视频未完成（${input.directionLabel}）：${reason}`,
          level: 'error',
        })
        return
      }
      completed += 1
    }
    input.onNotice?.({
      message: `自动出视频完成（${input.directionLabel}）：${completed} 个目录`,
      level: 'success',
    })
  } catch (error) {
    input.onNotice?.({
      message: `自动出视频失败（${input.directionLabel}）：${error instanceof Error ? error.message : String(error)}`,
      level: 'error',
    })
  }
}
