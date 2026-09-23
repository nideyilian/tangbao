/**
 * 后处理「方向级并发闸」：同时最多跑 N 个方向，超出排队（纯逻辑，无副作用）。
 *
 * 存在的前提（2026-09-23 杰哥裁决）：后处理原先是**一把全局的锁** —— 只要有一个方向在跑，
 * 素材库的「跑后处理」按钮就整体禁用（按钮的 `loading` 直接等于 `disabled`），别的方向点不动；
 * 运行记录也只有一条「最近的在跑」。改成「一个方向一套独立实例」之后，需要有人回答两个问题：
 * **这个方向现在能不能开工**、**同时最多开几个**。这里只做这两个判断，
 * 状态存放与等待唤醒交给调用方（`runtimeStore` 存、`features/postprocess/postprocessDirectionGate` 等）。
 *
 * 三条刻意的口径：
 * - **闸的粒度是方向，不是任务**：同一方向同时最多一条 —— 两条 run 会争同一批输出目录与
 *   文件名序号，串行是唯一能让序号连续、不互相抢名的安排（写盘侧的撞名兜底仍保留）。
 * - **上限由「最多并发数」决定**：杰哥 2026-09-23「同时跑的数量不要限制，可以使用最多并发数
 *   + 排队的方式」—— 所以它不是 1，也不是写死的 2，而是设置里那个数（默认 5）。
 * - **排队不丢单**：超出名额的只是等，不是被丢弃。调用方在 `release` 后负责唤醒等待者。
 */

/** 闸的状态。只有一个字段是有意的：谁能开工完全由「正在跑的方向集合」推出来。 */
export interface DirectionGateState {
  /** 正在跑的方向键；顺序 = 开工顺序（调试与界面文案用） */
  running: string[]
}

export const EMPTY_DIRECTION_GATE: DirectionGateState = { running: [] }

/**
 * 并发上限的兜底钳制。
 *
 * 正常情况下调用方传进来的是 `normalizeMaxConcurrent(profile.maxConcurrent)`；这里再兜一层
 * 是因为闸的下限必须是 1 —— 传进 0 / NaN 会让**所有**方向都开不了工（点了没反应且不报错，
 * 正是最难查的那类）。上限不设（杰哥明确「不要限制」）：真配成 999 就按 999 跑。
 */
export function normalizeDirectionConcurrency(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.trunc(numeric))
}

/** 这个方向现在是不是正在跑。 */
export function isDirectionRunning(state: DirectionGateState, directionKey: string): boolean {
  return state.running.includes(directionKey)
}

/**
 * 申请开工。
 *
 * 两条不满足就排队：**同一方向已经在跑**、**正在跑的方向数已达上限**。
 * 返回 `admitted: false` 时状态原样返回（调用方据此把 run 标成「排队中」并等待唤醒）。
 */
export function admitDirection(
  state: DirectionGateState,
  directionKey: string,
  maxConcurrent: number,
): { state: DirectionGateState; admitted: boolean } {
  const limit = normalizeDirectionConcurrency(maxConcurrent)
  if (isDirectionRunning(state, directionKey)) return { state, admitted: false }
  if (state.running.length >= limit) return { state, admitted: false }
  return { state: { running: [...state.running, directionKey] }, admitted: true }
}

/**
 * 释放一个方向的名额。
 *
 * 幂等：不在 `running` 里时返回原状态（异常路径里多释放一次不该动到别人的名额）。
 * **不在这里放行队首** —— 队列是按 run 的等待顺序，只有调用方知道谁在等；
 * 它拿到 `released: true` 后再唤醒等待者，由它们各自回来 `admitDirection` 抢名额。
 */
export function releaseDirection(
  state: DirectionGateState,
  directionKey: string,
): { state: DirectionGateState; released: boolean } {
  if (!isDirectionRunning(state, directionKey)) return { state, released: false }
  return { state: { running: state.running.filter((key) => key !== directionKey) }, released: true }
}
