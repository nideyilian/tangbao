import type { TaskRecord } from '../types'

/**
 * 「任务落盘失败」的补偿日志。
 *
 * 背景（`store.ts` 的 `persistTaskWithRetry` 注释已经把这个坑写在代码里）：
 * 任务写库是跨进程的 fire-and-forget（渲染 → 主进程 → UtilityProcess → SQLite），
 * 素材 worker 换代时在途请求会被直接 reject。丢一次写就意味着**内存与磁盘永久不一致**：
 * 素材是逐条 upsert 的所以仍然完整，而任务卡片按任务记录渲染 —— 重启后这张卡片就永久消失。
 *
 * 素材→任务那个反方向此前完全没有兜底：正向对账（`reconcileGeneratedAssets`）遍历的是
 * **内存里的 tasks**，重启后内存里也没有这条任务了，所以它救不回来。
 *
 * 因此这里存的是**任务的完整副本**而不是只存 id —— 重启后内存里已经没有它了。
 */

export interface PendingTaskPersistEntry {
  /** 落盘失败的那条任务的完整快照 */
  task: TaskRecord
  /** 最近一次失败的时间戳 */
  failedAt: number
  /** 累计失败次数（重放仍失败会 +1，用于判断是不是数据本身有问题） */
  attempts: number
}

export const PENDING_TASK_PERSIST_JOURNAL_ID = 'pending-task-persist-v1'

/**
 * 上限：正常情况这里应该是空的。真出问题时也不该无界增长把迁移 journal 撑爆，
 * 超出时丢**最旧**的（保留最近的失败，它们更可能是当前会话还在跑的任务）。
 */
export const MAX_PENDING_TASK_PERSIST_ENTRIES = 50

function isEntry(value: unknown): value is PendingTaskPersistEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as PendingTaskPersistEntry
  return typeof entry.task?.id === 'string' && typeof entry.failedAt === 'number'
}

/** 解析 journal 里存的 JSON。任何异常形态一律当空处理 —— 坏数据不能拖垮启动。 */
export function parsePendingTaskPersistJournal(sourceBackup: string | undefined | null): PendingTaskPersistEntry[] {
  if (!sourceBackup) return []
  try {
    const parsed = JSON.parse(sourceBackup) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEntry).slice(-MAX_PENDING_TASK_PERSIST_ENTRIES)
  } catch {
    return []
  }
}

/** 序列化；空清单返回 undefined（调用方据此把 journal 标成 completed）。 */
export function serializePendingTaskPersistJournal(entries: readonly PendingTaskPersistEntry[]): string | undefined {
  if (entries.length === 0) return undefined
  return JSON.stringify(entries.slice(-MAX_PENDING_TASK_PERSIST_ENTRIES))
}

/**
 * 记一条失败。同一任务重复失败**不重复堆条目**：只刷新快照与失败时间、累加次数。
 * （同一个任务在一次会话里可能失败多次，每次都堆一条会让上限很快被一条任务占满。）
 */
export function upsertPendingTaskPersist(
  entries: readonly PendingTaskPersistEntry[],
  task: TaskRecord,
  now: number,
): PendingTaskPersistEntry[] {
  const previous = entries.find((entry) => entry.task.id === task.id)
  const next = entries.filter((entry) => entry.task.id !== task.id)
  next.push({ task, failedAt: now, attempts: (previous?.attempts ?? 0) + 1 })
  return next.slice(-MAX_PENDING_TASK_PERSIST_ENTRIES)
}

export interface ReplayPendingTaskPersistResult {
  /** 这次终于写成功的任务 id */
  persisted: string[]
  /** 仍然写不进去的（留在 journal 里等下次），attempts 已 +1 */
  stillPending: PendingTaskPersistEntry[]
}

/**
 * 重放：逐条重写。成功的移出清单，失败的留下。
 *
 * 串行执行（不并发）：这些任务本来是同一批写失败的重试，再并发写回只会重演同样的争用。
 */
export async function replayPendingTaskPersists(
  entries: readonly PendingTaskPersistEntry[],
  write: (task: TaskRecord) => Promise<void>,
  now: number,
): Promise<ReplayPendingTaskPersistResult> {
  const persisted: string[] = []
  const stillPending: PendingTaskPersistEntry[] = []
  for (const entry of entries) {
    try {
      await write(entry.task)
      persisted.push(entry.task.id)
    } catch {
      stillPending.push({ ...entry, failedAt: now, attempts: entry.attempts + 1 })
    }
  }
  return { persisted, stillPending }
}
