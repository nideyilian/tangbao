import type { CreativePoolItem, CreativePoolSelection } from './types'

// 类型本体住在 types.ts（池数据的一部分，要跟着落盘）；这里再导出一次，
// 让既有的 `from './poolSelection'` 导入不用改路径。
export type { CreativePoolSelection }

/** 「随机」模式的默认抽签张数。 */
export const POOL_RANDOM_DEFAULT_COUNT = 2

/**
 * 解析这次随机抽签实际抽几张。
 *
 * - 池子为空 → 0（不抽）。
 * - `maxRandomCount` 为 `null` / 非法 → 上限就是池子大小（等于不限）。
 * - 结果至少 1、至多上限。
 *
 * 池子容量本身**不设上限**（可以无限丢图）；这里限的只是「一次抽几张」，
 * 因为每张池图都会进请求负载，抽太多又慢又贵。上限由用户配置，默认不设。
 */
export function resolveRandomCount(count: number, poolSize: number, maxRandomCount: number | null): number {
  if (poolSize <= 0) return 0
  const limit =
    maxRandomCount && Number.isFinite(maxRandomCount) && maxRandomCount > 0
      ? Math.min(Math.floor(maxRandomCount), poolSize)
      : poolSize
  const desired = Number.isFinite(count) ? Math.floor(count) : 1
  return Math.max(1, Math.min(desired, limit))
}

/**
 * 勾选模式：按池内顺序返回命中的项（**不是**按勾选先后）。
 *
 * 顺序稳定很关键 —— 池图在请求里的位置决定了角色指令里的序号（见 `poolPrompt.ts`），
 * 跟着勾选顺序变会让同一组图产生不同的序号，指令就对不上了。
 */
export function pickSelectedPoolItems(items: CreativePoolItem[], selectedIds: readonly string[]): CreativePoolItem[] {
  if (selectedIds.length === 0) return []
  const wanted = new Set(selectedIds)
  return items.filter((item) => wanted.has(item.id))
}

/**
 * 随机模式：从整个池里抽 `count` 张（「全部随机」）。
 *
 * 用 Fisher-Yates 的**部分**洗牌：只洗前 count 个位置，不对整个池做无用重排。
 * `random` 可注入（测试 / 将来若要做固定种子）。
 */
export function pickRandomPoolItems(
  items: CreativePoolItem[],
  count: number,
  random: () => number = Math.random,
): CreativePoolItem[] {
  const size = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0))
  if (size === 0 || items.length === 0) return []
  if (size >= items.length) return [...items]

  const pool = [...items]
  for (let i = 0; i < size; i += 1) {
    // 夹一下：random 若返回 1（非标准实现）也不会越界
    const offset = Math.min(pool.length - 1 - i, Math.floor(random() * (pool.length - i)))
    const j = i + Math.max(0, offset)
    const swap = pool[i]
    pool[i] = pool[j]
    pool[j] = swap
  }
  return pool.slice(0, size)
}

/**
 * 按当前模式解析这次要用的池图。随机模式每次调用都会重抽。
 *
 * `maxRandomCount` 只作用于随机模式（手动勾选是用户一张张点出来的，有明确意图，不夹）。
 */
export function resolvePoolSelection(
  items: CreativePoolItem[],
  selection: CreativePoolSelection,
  maxRandomCount: number | null,
  random?: () => number,
): CreativePoolItem[] {
  if (selection.mode !== 'random') return pickSelectedPoolItems(items, selection.selectedIds)
  return pickRandomPoolItems(items, resolveRandomCount(selection.randomCount, items.length, maxRandomCount), random)
}
