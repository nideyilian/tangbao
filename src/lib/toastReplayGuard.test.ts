import { describe, expect, it } from 'vitest'
import { createToastReplayGuard } from './toastReplayGuard'

/**
 * 契约：用户亲手关掉的提示不再重播（2026-09-21 报障「失败提示无法关闭」）。
 * 批量生成每完成一个任务就播一次同款文案，不拦的话点掉就被下一条顶回来。
 */
describe('提示重播闸门', () => {
  it('没被用户关过时，任何文案都照常播报', () => {
    const guard = createToastReplayGuard()
    expect(guard.isSuppressed('生成失败')).toBe(false)
  })

  it('用户亲手关掉的那句，窗口内不再播', () => {
    const guard = createToastReplayGuard(8000)
    guard.rememberDismissed('生成失败', 1000)
    expect(guard.isSuppressed('生成失败', 1000 + 7999)).toBe(true)
  })

  it('换个文案照常播报（抑制只针对被关掉的那一句）', () => {
    const guard = createToastReplayGuard(8000)
    guard.rememberDismissed('生成失败', 1000)
    expect(guard.isSuppressed('生成完成，共 4 张图片', 1000)).toBe(false)
  })

  it('超出窗口后重新播报（下一次批量失败仍要看得见）', () => {
    const guard = createToastReplayGuard(8000)
    guard.rememberDismissed('生成失败', 1000)
    expect(guard.isSuppressed('生成失败', 1000 + 8000)).toBe(false)
  })

  it('记住的是最后一次被关掉的那句', () => {
    const guard = createToastReplayGuard(8000)
    guard.rememberDismissed('生成失败', 1000)
    guard.rememberDismissed('素材导出失败', 2000)
    expect(guard.isSuppressed('生成失败', 2000)).toBe(false)
    expect(guard.isSuppressed('素材导出失败', 2000)).toBe(true)
  })
})
