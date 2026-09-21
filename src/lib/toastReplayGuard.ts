/**
 * 提示的「关掉就不再重播」闸门。
 *
 * 背景（2026-09-21 报障「失败提示突然弹出且无法关闭」）：批量生成是**每个任务结算播一次**
 * 同款文案（`生成失败：…` / `生成完成…`），而全局提示只有一个槽位 —— 用户点 × 关掉后，
 * 下一个任务结算立刻把同一条顶回来，主观感受就是「这提示关不掉」。
 *
 * 约定（三条都是刻意的）：
 * - 只有**用户主动关闭**（点 × / Esc）才登记；到点自动消失不算 —— 否则会把正常提示一起吞掉。
 * - 精确匹配文案：换一句（= 新的信息）照常播报。
 * - 窗口有限（默认 8 秒）：同一次批量跑完后再失败，仍会重新提示。
 *
 * 单独成模块而不是塞在 store 里：store 是单例，测试里一旦被 `setState` 换掉字段
 * 就再也测不了这段逻辑（`store.test.ts` 里已有用例把 `showToast` 换成 `vi.fn()`）。
 */
export const TOAST_DISMISS_SUPPRESS_MS = 8000

export interface ToastReplayGuard {
  /** 登记「用户亲手关掉了这句」。 */
  rememberDismissed(message: string, now?: number): void
  /** 该文案是否在抑制窗口内（true = 不要再弹）。 */
  isSuppressed(message: string, now?: number): boolean
}

export function createToastReplayGuard(suppressMs: number = TOAST_DISMISS_SUPPRESS_MS): ToastReplayGuard {
  let dismissedMessage = ''
  let dismissedAt = 0

  return {
    rememberDismissed(message, now = Date.now()) {
      dismissedMessage = message
      dismissedAt = now
    },
    isSuppressed(message, now = Date.now()) {
      return dismissedMessage === message && now - dismissedAt < suppressMs
    },
  }
}
