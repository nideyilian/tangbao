/**
 * 「参与自动后处理」开关的文案契约。
 *
 * 报障（2026-09-20）：同一个面板里，上方警告写「这个方向不在后处理的启用范围内 ⇒
 * 归属它的图片不会产出渠道变体」，下方开关却显示「已开启」—— 两句话互相打脸。
 * 开关本身没错（它只是方向级那一层），错在**文案让人读不出「现在其实不生效」**。
 */

import { describe, expect, it } from 'vitest'
import { formatParticipationLabel } from './participationLabel'

describe('formatParticipationLabel', () => {
  it('在启用范围内：开启就是「已开启」', () => {
    expect(formatParticipationLabel(true, true)).toBe('已开启')
  })

  it('不在启用范围内：必须标出「未生效」—— 否则与「不会产出渠道变体」的警告自相矛盾', () => {
    expect(formatParticipationLabel(true, false)).toContain('未生效')
    // 仍然如实显示它是开启的（不能把用户设的值藏起来）
    expect(formatParticipationLabel(true, false)).toContain('已开启')
  })

  it('关闭态跟启用范围无关：一律「已关闭」（关闭 + 不产出是一致的，没有矛盾）', () => {
    expect(formatParticipationLabel(false, true)).toBe('已关闭')
    expect(formatParticipationLabel(false, false)).toBe('已关闭')
  })
})
