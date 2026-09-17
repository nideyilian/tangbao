import type { SopBatchTaskMeta, TaskRecord, WorkspaceTab } from '../types'
import { formatGeneratedImageDate } from './generatedImageFilename'

type BatchTask = Pick<
  TaskRecord,
  'id' | 'createdAt' | 'filenameBatch' | 'scheduledOutputPath' | 'scheduledOutputSubFolder'
>

export function normalizeGeneratedImageBatch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

export interface SeriesGroupGeneratedImageNaming {
  /** 组标识：同组所有成员任务共享的批次号 */
  filenameBatch: number
  /** 组内共享的批次目录（仅「按批次建文件夹」布局下存在） */
  localSaveBatchFolder?: string
}

type SeriesGroupNamingTask = Pick<TaskRecord, 'sopBatch' | 'filenameBatch' | 'localSaveBatchFolder'>

/**
 * 系列图（一组多张）的**组标识**解析。
 *
 * 系列图的一次「组」会拆成多条成员任务（每条提示词一个任务）提交，若各成员各自领取批次号，
 * 同一组图片就会散落到不同批次号（以及不同批次目录）里，文件名也无法体现组内顺序。
 * 这里让同组后续成员沿用组内首个任务的批次号与批次目录，命名因此稳定为
 * 「X-组序号-组内顺序序号」（组内顺序见 `getSeriesGroupImageSequence`）。
 *
 * 返回 null 表示组内还没有已提交的任务（即组内首个成员），由调用方按常规分配新批次号；
 * 「重新生成」会换新的 batchId，因此不会命中上一轮的任务，产出不会与旧图重名。
 */
export function resolveSeriesGroupGeneratedImageNaming(
  tasks: readonly SeriesGroupNamingTask[],
  sopBatch: Pick<SopBatchTaskMeta, 'batchId' | 'series'> | null | undefined,
): SeriesGroupGeneratedImageNaming | null {
  const groupIndex = sopBatch?.series?.groupIndex
  if (!sopBatch || typeof groupIndex !== 'number') return null

  for (const task of tasks) {
    const sibling = task.sopBatch
    if (!sibling || sibling.batchId !== sopBatch.batchId) continue
    if (sibling.series?.groupIndex !== groupIndex) continue
    const batch = normalizeGeneratedImageBatch(task.filenameBatch)
    if (!batch) continue
    return { filenameBatch: batch, localSaveBatchFolder: task.localSaveBatchFolder }
  }
  return null
}

export function getNextGeneratedImageBatch(
  tasks: Pick<BatchTask, 'createdAt' | 'filenameBatch'>[],
  createdAt: number,
): number {
  const date = formatGeneratedImageDate(createdAt)
  return (
    tasks.reduce((maximum, task) => {
      if (formatGeneratedImageDate(task.createdAt) !== date) return maximum
      return Math.max(maximum, normalizeGeneratedImageBatch(task.filenameBatch) ?? 0)
    }, 0) + 1
  )
}

export function assignMissingGeneratedImageBatches(
  tasks: TaskRecord[],
  workspaceTabs: WorkspaceTab[],
): { tasks: TaskRecord[]; changedTaskIds: string[] } {
  const scopeByTaskId = new Map<string, string>()
  for (const tab of workspaceTabs) {
    for (const task of tab.tasks) {
      if (!scopeByTaskId.has(task.id)) scopeByTaskId.set(task.id, `tab:${tab.id}`)
    }
  }

  const groupKey = (task: BatchTask) => {
    const fallback = task.scheduledOutputSubFolder ?? getPathBaseName(task.scheduledOutputPath) ?? 'image'
    const scope = scopeByTaskId.get(task.id) ?? `fallback:${fallback}`
    return `${scope}\0${formatGeneratedImageDate(task.createdAt)}`
  }

  const maximumByGroup = new Map<string, number>()
  for (const task of tasks) {
    const batch = normalizeGeneratedImageBatch(task.filenameBatch)
    if (!batch) continue
    const key = groupKey(task)
    maximumByGroup.set(key, Math.max(maximumByGroup.get(key) ?? 0, batch))
  }

  const assignedByTaskId = new Map<string, number>()
  const missing = tasks
    .filter((task) => !normalizeGeneratedImageBatch(task.filenameBatch))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

  for (const task of missing) {
    const key = groupKey(task)
    const batch = (maximumByGroup.get(key) ?? 0) + 1
    maximumByGroup.set(key, batch)
    assignedByTaskId.set(task.id, batch)
  }

  return {
    tasks: tasks.map((task) => {
      const batch = assignedByTaskId.get(task.id)
      return batch ? { ...task, filenameBatch: batch } : task
    }),
    changedTaskIds: [...assignedByTaskId.keys()],
  }
}

function getPathBaseName(value?: string): string | null {
  if (!value) return null
  const parts = value
    .trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts[parts.length - 1] || null
}
