import type { GenerationSlot, TaskRecord } from '../types'

export interface RestoredOutputAssignment {
  /** 可复用的槽位下标（必须是当前没有认领图片的槽位） */
  slotIndex: number
  imageId: string
}

/**
 * 规划「恢复重算」时要补回的已生成图片。
 *
 * 背景：编排式批量任务的 `generationSlots` 快照与 `outputImages` 是分两次写盘的，
 * 崩溃 / 刷新时两者可能不一致 —— 图片已经产出并记进了 `outputImages`，
 * 但槽位快照还停在 `pending` / `submitted`。
 *
 * 恢复重算只按槽位状态重建 `committed`（`store.ts` 里 `slot.status === 'done'` 才回收），
 * 于是这些「有图但槽位没跟上」的图片会在收尾时被 `outputImages: outputIds` 整段覆盖丢掉：
 * 表现为「刷新后任务卡片显示的已生成数量变少」，而素材库是逐条 upsert 的、仍然完整。
 *
 * 这里按「已落盘顺序优先」把它们分配到当前空闲的槽位上，调用方再把槽位标成 done，
 * 既保住图片，也避免对同一张图重复发起生成。
 */
export function planRestoredOutputAssignments(
  slots: readonly Pick<GenerationSlot, 'index' | 'status' | 'outputImageId'>[],
  persistedOutputImages: readonly string[],
): RestoredOutputAssignment[] {
  const claimedImageIds = new Set<string>()
  for (const slot of slots) {
    if (slot.outputImageId) claimedImageIds.add(slot.outputImageId)
  }

  // 只有「没有图片的槽位」可以被复用；已认领图片的槽位保持原样。
  const freeSlotIndexes = slots
    .filter((slot) => !slot.outputImageId)
    .map((slot) => slot.index)
    .sort((a, b) => a - b)
  if (freeSlotIndexes.length === 0) return []

  const assignments: RestoredOutputAssignment[] = []
  for (const imageId of persistedOutputImages) {
    if (!imageId || claimedImageIds.has(imageId)) continue
    const slotIndex = freeSlotIndexes[assignments.length]
    if (slotIndex === undefined) break
    claimedImageIds.add(imageId)
    assignments.push({ slotIndex, imageId })
  }
  return assignments
}

/**
 * 收尾写盘时选择「更完整的一份」输出图片列表。
 *
 * 任务记录里的 `outputImages` 是整字段覆盖写入的，而覆盖源有两类：本轮实际产出、
 * 以及此前已经落盘的列表。恢复重算和迟到的中间态结果都可能只带回较短的一份，
 * 一旦直接覆盖就会出现「内存 / 素材库是全量，任务卡片数量却变少」——
 * 刷新后读到磁盘上的短列表，症状才暴露出来。这里取较长的一份作为不回退的兜底。
 *
 * 返回新数组：调用方可能继续 push（单张模式），不应污染入参。
 */
export function pickMoreCompleteOutputIds(
  producedOutputIds: readonly string[],
  persistedOutputIds: readonly string[],
): string[] {
  return producedOutputIds.length >= persistedOutputIds.length ? [...producedOutputIds] : [...persistedOutputIds]
}

/**
 * 本次执行是否允许把产出结算进任务记录。
 *
 * 正常路径只认 `running`：任务已被停止 / 删除时，迟到的成功结果不该把它"复活"。
 * 但 OpenAI 看门狗超时是例外 —— 它会把任务提前标成终态（`status` 不再是 `running`，
 * 见 `failOpenAITaskIfStillRunning`），那只是「先给用户一个交代」，请求本身可能还在飞。
 * 这种情况下仍必须结算，否则刚 commit 的图片既不进任务卡片也不进素材库，直接变成孤儿数据。
 * 标记由本次执行写入，`executeTask` 开始时和正常收尾后都会清掉，所以它只代表"这一次执行"。
 */
export function canSettleTaskOutputs(task: Pick<TaskRecord, 'status' | 'watchdogTimedOutAt'> | undefined): boolean {
  if (!task) return false
  return task.status === 'running' || task.watchdogTimedOutAt !== undefined
}
