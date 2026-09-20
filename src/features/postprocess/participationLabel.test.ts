/**
 * 「自动后处理」开关的文案契约。
 *
 * 报障（2026-09-20）：同一个面板里，上方警告写「未启用后处理 ⇒ 不会产出变体」，
 * 下方开关却显示「已开启」—— 两句话互相打脸。开关本身没错（它只是方向级那一层），
 * 错在**文案让人读不出「现在其实不生效」**。
 *
 * 第二轮反馈（同日）：「不要那么多、那么长的说明」——
 * 于是文案收敛成三个字，只说结论，不复述开关状态（开关的**位置**已经表达了开/关）。
 */

import { describe, expect, it } from 'vitest'
import { formatParticipationLabel } from './participationLabel'

describe('formatParticipationLabel', () => {
  it('在启用范围内：按开关如实说', () => {
    expect(formatParticipationLabel(true, true)).toBe('已开启')
    expect(formatParticipationLabel(false, true)).toBe('已关闭')
  })

  it('不在启用范围内：一律「未生效」—— 开关是开是关都不产出，说结论即可', () => {
    expect(formatParticipationLabel(true, false)).toBe('未生效')
    expect(formatParticipationLabel(false, false)).toBe('未生效')
  })

  it('全部文案都是 3 个字', () => {
    for (const label of [
      formatParticipationLabel(true, true),
      formatParticipationLabel(false, true),
      formatParticipationLabel(true, false),
    ]) {
      expect(label).toHaveLength(3)
    }
  })
})
