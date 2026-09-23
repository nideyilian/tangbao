/**
 * 「自动后处理」开关的文案契约。
 *
 * 历史（2026-09-20）：面板上方警告写「未启用后处理 ⇒ 不会产出变体」、下方开关却显示
 * 「已开启」，两句话互相打脸。当时开关之上还有一层「启用范围」白名单，所以文案必须能读出
 * 「现在其实不生效」，于是多出「未生效」这一档。
 *
 * 现状（2026-09-23）：白名单已撤掉，只剩方向级这一层开关（默认开），
 * 「未生效」不再存在 —— 文案回到最直白的两个词。
 */

import { describe, expect, it } from 'vitest'
import { formatParticipationLabel } from './participationLabel'

describe('formatParticipationLabel', () => {
  it('按开关如实说', () => {
    expect(formatParticipationLabel(true)).toBe('已开启')
    expect(formatParticipationLabel(false)).toBe('已关闭')
  })

  it('全部文案都是 3 个字', () => {
    for (const label of [formatParticipationLabel(true), formatParticipationLabel(false)]) {
      expect(label).toHaveLength(3)
    }
  })
})
