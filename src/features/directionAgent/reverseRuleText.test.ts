import { describe, expect, it } from 'vitest'
import { MAX_POOL_OPTIONS, VARIABLE_POOL_KEYS } from './defaults'
import { mergeRuleParts, reverseRuleTextFromImages } from './reverseRuleText'
import { createEmptyRuleParts, parseRuleText } from './ruleText'
import { extendRuleText } from './extendRuleText'

/** 造一份只关心几个池的解析结果。 */
function makeParts(overrides: {
  basePrompt?: string
  negativePrompt?: string
  pools?: Partial<Record<string, string[]>>
}) {
  const parts = createEmptyRuleParts()
  parts.basePrompt = overrides.basePrompt ?? ''
  parts.negativePrompt = overrides.negativePrompt ?? ''
  for (const [key, value] of Object.entries(overrides.pools ?? {})) {
    if (value) parts.variablePools[key as keyof typeof parts.variablePools] = value
  }
  return parts
}

describe('mergeRuleParts（合并规则照抄瀚灵）', () => {
  it('returns an empty structure for an empty list', () => {
    expect(mergeRuleParts([])).toEqual(createEmptyRuleParts())
  })

  it('passes a single result through', () => {
    const merged = mergeRuleParts([
      makeParts({ basePrompt: '保留构图', negativePrompt: '禁止低质量', pools: { main_color_set: ['甲', '乙'] } }),
    ])
    expect(merged.basePrompt).toBe('保留构图')
    expect(merged.negativePrompt).toBe('禁止低质量')
    expect(merged.variablePools.main_color_set).toEqual(['甲', '乙'])
  })

  it('joins distinct base prompts with a full-width semicolon', () => {
    const merged = mergeRuleParts([
      makeParts({ basePrompt: '保留构图' }),
      makeParts({ basePrompt: '保留光影' }),
      makeParts({ basePrompt: '保留构图' }),
    ])
    expect(merged.basePrompt).toBe('保留构图；保留光影')
  })

  it('merges each pool across images, de-duplicating and keeping order', () => {
    const merged = mergeRuleParts([
      makeParts({ pools: { main_color_set: ['冷色渐变', '暖色渐变'] } }),
      makeParts({ pools: { main_color_set: ['暖色渐变', '高对比撞色'] } }),
    ])
    expect(merged.variablePools.main_color_set).toEqual(['冷色渐变', '暖色渐变', '高对比撞色'])
  })

  it('splits the negative section on punctuation before de-duplicating', () => {
    const merged = mergeRuleParts([
      makeParts({ negativePrompt: '禁止原图复刻、具体人物照搬' }),
      makeParts({ negativePrompt: '禁止低质量;禁止原图复刻' }),
    ])
    expect(merged.negativePrompt.split('；').sort()).toEqual(['禁止原图复刻', '具体人物照搬', '禁止低质量'].sort())
  })

  it('caps every pool at the option ceiling', () => {
    const many = Array.from({ length: MAX_POOL_OPTIONS + 30 }, (_, index) => `词${index}`)
    const merged = mergeRuleParts([makeParts({ pools: { main_color_set: many } })])
    expect(merged.variablePools.main_color_set).toHaveLength(MAX_POOL_OPTIONS)
  })

  it('always produces all six pools, even if no image mentioned some of them', () => {
    const merged = mergeRuleParts([makeParts({ pools: { light_effect: ['甲'] } })])
    expect(Object.keys(merged.variablePools).sort()).toEqual([...VARIABLE_POOL_KEYS].sort())
    expect(merged.variablePools.decor_shape).toEqual([])
  })

  it('round-trips through serialize → parse without losing anything', () => {
    const merged = mergeRuleParts([
      makeParts({
        basePrompt: '保留构图，替换 {main_color_set}',
        negativePrompt: '禁止低质量',
        pools: { main_color_set: ['甲', '乙'] },
      }),
      makeParts({ basePrompt: '保留光影', pools: { main_color_set: ['丙'] } }),
    ])
    const reparsed = parseRuleText(
      [
        '【固定基底Prompt】',
        merged.basePrompt,
        '',
        '【变量词池】',
        ...VARIABLE_POOL_KEYS.map((key) => `{${key}}: ${merged.variablePools[key].join(',')}`),
        '',
        '【反向Prompt】',
        merged.negativePrompt,
      ].join('\n'),
    )
    expect(reparsed.basePrompt).toBe(merged.basePrompt)
    expect(reparsed.variablePools.main_color_set).toEqual(['甲', '乙', '丙'])
  })
})

describe('reverseRuleTextFromImages 的入参守卫', () => {
  it('refuses an empty image list before touching the model', async () => {
    await expect(reverseRuleTextFromImages([])).rejects.toThrow(/至少一张参考图/)
  })
})

describe('extendRuleText 的入参守卫（都要在调模型之前拦下）', () => {
  it('refuses an empty requirement', async () => {
    await expect(extendRuleText('some rule text', '   ')).rejects.toThrow(/延展要求/)
  })

  it('refuses an empty rule text', async () => {
    await expect(extendRuleText('   ', '补充更多候选词')).rejects.toThrow(/配方内容/)
  })
})
