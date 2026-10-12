import { describe, expect, it } from 'vitest'
import { buildNegativePrompt, composeAgentPrompts, MAX_DIRECTION_AGENT_BATCH } from './composePrompts'
import { DEFAULT_RULE_TEXT, type DirectionRule } from './defaults'

/** 一段只有两个池、各 4 个候选词的配方（组合空间 16，够测跨批去重）。 */
const SMALL_RULE_TEXT = [
  '【固定基底Prompt】',
  '横版主图，底色用 {main_color_set}，打 {light_effect}',
  '【变量词池】',
  '{main_color_set}: 冷色渐变,暖色渐变,低饱和中性色,高对比撞色',
  '{decor_shape}: ',
  '{surface_material}: ',
  '{light_effect}: 柔和轮廓光,体积光束,局部高光,霓虹边缘光',
  '{background_env}: ',
  '{typography_style}: ',
  '【反向Prompt】',
  '禁止原图复刻',
].join('\n')

const AGENT = { ruleText: SMALL_RULE_TEXT }

describe('buildNegativePrompt', () => {
  it('returns just the reverse section when there are no rules', () => {
    expect(buildNegativePrompt('禁止原图复刻')).toBe('禁止原图复刻')
  })

  it('appends enabled forbidden rules and skips disabled / required ones', () => {
    const rules: DirectionRule[] = [
      { id: 'a', kind: 'forbidden', text: '禁止色情', priority: 100, enabled: true, source: 'builtin' },
      { id: 'b', kind: 'forbidden', text: '不要这个', priority: 90, enabled: false, source: 'user' },
      { id: 'c', kind: 'required', text: '必须中文', priority: 100, enabled: true, source: 'builtin' },
      { id: 'd', kind: 'forbidden', text: '禁止政治敏感', priority: 100, enabled: true, source: 'builtin' },
    ]
    expect(buildNegativePrompt('禁止原图复刻', rules)).toBe('禁止原图复刻；禁止色情；禁止政治敏感')
  })

  it('works when the reverse section is blank', () => {
    const rules: DirectionRule[] = [
      { id: 'a', kind: 'forbidden', text: '禁止色情', priority: 100, enabled: true, source: 'builtin' },
    ]
    expect(buildNegativePrompt('', rules)).toBe('禁止色情')
    expect(buildNegativePrompt('', [])).toBe('')
  })
})

describe('composeAgentPrompts', () => {
  it('renders one prompt per requested item, with no placeholder left behind', () => {
    const { prompts, signatures } = composeAgentPrompts(AGENT, 8, { seed: 'a' })
    expect(prompts).toHaveLength(8)
    expect(signatures).toHaveLength(8)
    for (const item of prompts) {
      expect(item.prompt).not.toContain('{')
      expect(item.prompt).toContain('横版主图')
    }
  })

  it('substitutes real pool options, not the raw placeholder', () => {
    const { prompts } = composeAgentPrompts(AGENT, 6, { seed: 'colors' })
    const colors = new Set(['冷色渐变', '暖色渐变', '低饱和中性色', '高对比撞色'])
    for (const item of prompts) {
      expect(colors.has(item.values.main_color_set)).toBe(true)
      expect(item.prompt).toContain(item.values.main_color_set)
      expect(item.prompt).toContain(item.values.light_effect)
    }
  })

  it('carries the assembled negative prompt on every item', () => {
    const rules: DirectionRule[] = [
      { id: 'a', kind: 'forbidden', text: '禁止色情', priority: 100, enabled: true, source: 'builtin' },
    ]
    const { prompts } = composeAgentPrompts({ ...AGENT, rules }, 4, { seed: 'neg' })
    for (const item of prompts) {
      expect(item.negativePrompt).toBe('禁止原图复刻；禁止色情')
    }
  })

  it('keeps every combination in a batch distinct', () => {
    const { signatures } = composeAgentPrompts(AGENT, 10, { seed: 'distinct' })
    expect(new Set(signatures).size).toBe(signatures.length)
  })

  it('avoids combinations already used by previous batches', () => {
    // TB-154 验收：同一份配方连出两批，两批之间不重复 —— 靠传入的签名集合
    const used = new Set<string>()
    const first = composeAgentPrompts(AGENT, 5, { seed: 'batch-1', usedSignatures: used })
    const second = composeAgentPrompts(AGENT, 5, { seed: 'batch-2', usedSignatures: used })
    expect(new Set([...first.signatures, ...second.signatures]).size).toBe(10)
  })

  it('clamps the request to the batch ceiling', () => {
    const { prompts } = composeAgentPrompts({ ruleText: DEFAULT_RULE_TEXT }, MAX_DIRECTION_AGENT_BATCH + 50, {
      seed: 'cap',
    })
    expect(prompts).toHaveLength(MAX_DIRECTION_AGENT_BATCH)
  })

  it('throws a readable error when there is no usable pool', () => {
    const noPools = ['【固定基底Prompt】', '画面', '【变量词池】', '【反向Prompt】', '禁止低质量'].join('\n')
    expect(() => composeAgentPrompts({ ruleText: noPools }, 4)).toThrow(/变量词池/)
  })

  it('uses the first option for pools that hold words but are not referenced', () => {
    // 词填了却没在固定基底里引用：不参与采样，也不能让占位符漏出去
    const extraPool = [
      '【固定基底Prompt】',
      '底色用 {main_color_set}',
      '【变量词池】',
      '{main_color_set}: 甲,乙,丙,丁',
      '{light_effect}: 一,二',
      '{decor_shape}: ',
      '{surface_material}: ',
      '{background_env}: ',
      '{typography_style}: ',
      '【反向Prompt】',
      '禁止低质量',
    ].join('\n')
    const { prompts } = composeAgentPrompts({ ruleText: extraPool }, 4, { seed: 'extra' })
    for (const item of prompts) {
      expect(item.prompt).not.toContain('{')
      // 引用了的池参与变化
      expect(['甲', '乙', '丙', '丁']).toContain(item.values.main_color_set)
    }
  })
})
