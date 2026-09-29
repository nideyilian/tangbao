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

import type { ImageVideoNamingContext } from './naming'
import { resolveDirectionInputDirsByMedia, runImageVideoJob, type ImageVideoInputDir } from './runVideo'
import type { ImageVideoParams } from './types'

export interface AutoImageVideoNotice {
  message: string
  level: 'success' | 'error' | 'info'
}

/** 一个渠道要跑的一批：目录 + **该渠道自己那一套**参数（2026-09-28 起参数按渠道存）。 */
export interface AutoImageVideoRun {
  mediaId: string
  mediaName: string
  /** 要处理的图片目录（本次产出实际写到的目录） */
  dir: string
  params: ImageVideoParams
  /**
   * 命名上下文，由触发方（后处理收尾，`store.ts`）组装。
   *
   * 放这儿而不是在跑的时候现读：自动触发出现在后处理收尾那一刻，那时手上就有方向与渠道；
   * 隔了几分钟再回头去猜「这可是哪个方向」，只会猜错。
   */
  naming: ImageVideoNamingContext
}

export interface AutoImageVideoInput {
  directionLabel: string
  runs: AutoImageVideoRun[]
  onNotice?: (notice: AutoImageVideoNotice) => void
}

/**
 * 该不该自动出视频。
 *
 * 两个条件缺一不可：**这个渠道开着视频开关**，且**这次真的产出了图**。
 * 后者不能省 —— 零产出的批次（整批被跳过）再去跑一次视频，只会得到一句
 * 引擎报的「图片数量不足」，把一次本来就说清楚的跳过又搅浑一次。
 *
 * 判的是**单个渠道**的参数（2026-09-28 起视频参数按渠道存）：一个方向投三个渠道时，
 * 可以只让其中两个出视频。
 */
export function shouldAutoRunImageVideo(params: ImageVideoParams, producedCount: number): boolean {
  return params.enabled && producedCount > 0
}

/** 从产出记录里挑出该方向每个渠道的目录（转发 `runVideo` 的实现，避免两处各写一套筛选）。 */
export function resolveAutoImageVideoDirs(
  outputs: readonly { path: string; mediaId?: string; mediaName?: string; collectionId?: string; createdAt?: number }[],
  directionId: string,
): ImageVideoInputDir[] {
  return resolveDirectionInputDirsByMedia(outputs, directionId)
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

/**
 * 逐个渠道跑，**一个失败不吞掉别的**。
 *
 * 以前是「第一个目录不对就 return」：一个渠道的目录被分发搬走 / 手工清理过，后面几个
 * 好端端的渠道就都不跑了，而用户只看到一句报错、以为整件事没做（2026-09-28 实测）。
 * 现在把失败收集起来、跑完剩下的，最后一次性说清「出了几个、哪几个没出、为什么」。
 */
async function runAutoImageVideo(input: AutoImageVideoInput): Promise<void> {
  const failed: string[] = []
  let completed = 0
  for (const run of input.runs) {
    try {
      const result = await runImageVideoJob({ inputDir: run.dir, params: run.params, naming: run.naming })
      if (result.status === 'completed') {
        completed += 1
        continue
      }
      const reason = result.status === 'cancelled' ? '已取消' : result.message || '引擎报错'
      failed.push(`${run.mediaName}：${reason}`)
    } catch (error) {
      failed.push(`${run.mediaName}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failed.length === 0) {
    input.onNotice?.({
      message: `自动出视频完成（${input.directionLabel}）：${completed} 个渠道`,
      level: 'success',
    })
    return
  }
  input.onNotice?.({
    message: `自动出视频部分完成（${input.directionLabel}）：${completed} 个渠道已出片，${failed.length} 个没出 —— ${failed.join('；')}`,
    level: completed > 0 ? 'info' : 'error',
  })
}
