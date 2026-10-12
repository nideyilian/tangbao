import { describe, expect, it } from 'vitest'
import { parseVariablePrompt, renderVariablePromptBatch } from '../../lib/variablePrompt'
import { DEFAULT_RULE_TEXT, VARIABLE_POOL_KEYS } from './defaults'
import { ruleTextToVariablePrompt } from './toVariablePrompt'

/** 造一份最小可用的三段式：正文引用一两个池，池里给够 6 个候选词。 */
function makeRuleText(options: { base?: string; pools?: Partial<Record<string, string[]>>; negative?: string }) {
  const parts = options.pools ?? {}
  return [
    '【固定基底Prompt】',
    options.base ?? '横版主图，底色用 {main_color_set}，打 {light_effect}',
    '',
    '【变量词池】',
    ...VARIABLE_POOL_KEYS.map((key) => {
      const list =
        parts[key] ?? (key === 'main_color_set' || key === 'light_effect' ? ['甲', '乙', '丙', '丁', '戊', '己'] : [])
      return `{${key}}: ${list.join(',')}`
    }),
    '',
    '【反向Prompt】',
    options.negative ?? '禁止原图复刻',
  ].join('\n')
}

describe('ruleTextToVariablePrompt', () => {
  it('produces a template the variable-prompt engine actually accepts', () => {
    // 这条是整个转换的意义所在：转出来必须真的能被那条出图链路认下来
    const template = ruleTextToVariablePrompt(DEFAULT_RULE_TEXT)
    const parsed = parseVariablePrompt(template)
    expect(parsed.detected).toBe(true)
    expect(parsed.enabled).toBe(true)
    expect(parsed.errors).toEqual([])
    expect(parsed.variables).toHaveLength(6)
  })

  it('expands into the requested number of distinct prompts with no placeholder left', () => {
    const template = ruleTextToVariablePrompt(DEFAULT_RULE_TEXT)
    const rendered = renderVariablePromptBatch(template, 10, 'seed')
    expect(rendered).toHaveLength(10)
    expect(new Set(rendered).size).toBe(10)
    for (const prompt of rendered) {
      expect(prompt).not.toContain('{{')
      expect(prompt).not.toContain('}}')
    }
  })

  it('only writes definitions for pools the base prompt references', () => {
    // 没被引用的池放进去只会白占组合空间，让真正看得见的差异变少
    const template = ruleTextToVariablePrompt(makeRuleText({}))
    const parsed = parseVariablePrompt(template)
    expect(parsed.variables.map((variable) => variable.name).sort()).toEqual(['light_effect', 'main_color_set'])
  })

  it('carries the negative section into the body instead of dropping it', () => {
    const template = ruleTextToVariablePrompt(makeRuleText({ negative: '禁止出现具体金额' }))
    expect(template).toContain('同时避免出现：禁止出现具体金额')
  })

  it('splits every pool option with the separator the engine expects', () => {
    const template = ruleTextToVariablePrompt(makeRuleText({}))
    expect(template).toContain('{{main_color_set}}：甲 / 乙 / 丙 / 丁 / 戊 / 己')
  })

  it('replaces a slash inside an option so it does not split into two', () => {
    const template = ruleTextToVariablePrompt(
      makeRuleText({ pools: { main_color_set: ['冷色/暖色', '甲', '乙', '丙', '丁', '戊'] } }),
    )
    const parsed = parseVariablePrompt(template)
    const main = parsed.variables.find((variable) => variable.name === 'main_color_set')
    expect(main?.options[0]).toBe('冷色、暖色')
    expect(main?.options).toHaveLength(6)
  })

  it('throws a readable error when a referenced pool is still empty', () => {
    const text = makeRuleText({ base: '底色用 {main_color_set}，打 {decor_shape}' })
    expect(() => ruleTextToVariablePrompt(text)).toThrow(/还是空的/)
  })

  it('throws when the base prompt references an unknown pool', () => {
    expect(() => ruleTextToVariablePrompt(makeRuleText({ base: '底色用 {no_such_pool}' }))).toThrow(/不存在的池/)
  })

  it('throws when the base prompt has no placeholder at all', () => {
    expect(() => ruleTextToVariablePrompt(makeRuleText({ base: '一张干干净净的图' }))).toThrow(
      /一个 \{池名\} 占位符都没有/,
    )
  })

  it('throws when there is no base prompt', () => {
    const text = ['【变量词池】', '{main_color_set}: 甲,乙', '【反向Prompt】', '禁止低质量'].join('\n')
    expect(() => ruleTextToVariablePrompt(text)).toThrow(/没有固定基底/)
  })
})
