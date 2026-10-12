import { describe, expect, it } from 'vitest'
import {
  BUILTIN_RULES,
  DEFAULT_RULE_TEXT,
  MIN_POOL_OPTIONS,
  VARIABLE_POOL_KEYS,
  VARIABLE_POOL_LABELS,
} from './defaults'
import {
  createEmptyRuleParts,
  extractPoolPlaceholders,
  findRuleTextIssues,
  parseRuleText,
  parseRuleTextModelOutput,
  replacePoolPlaceholders,
  RULE_TEXT_FORMAT,
  serializeRuleText,
} from './ruleText'

describe('出厂常量（照抄瀚灵，被改了要能发现）', () => {
  it('keeps the six pool keys in the original order', () => {
    expect([...VARIABLE_POOL_KEYS]).toEqual([
      'main_color_set',
      'decor_shape',
      'surface_material',
      'light_effect',
      'background_env',
      'typography_style',
    ])
  })

  it('ships 13 builtin rules split 6 required / 7 forbidden', () => {
    expect(BUILTIN_RULES).toHaveLength(13)
    expect(BUILTIN_RULES.filter((rule) => rule.kind === 'required')).toHaveLength(6)
    expect(BUILTIN_RULES.filter((rule) => rule.kind === 'forbidden')).toHaveLength(7)
  })

  it('puts the six compliance red lines in the builtin forbidden set, all at priority 100', () => {
    const redlines = BUILTIN_RULES.filter((rule) => rule.id.startsWith('redline-'))
    expect(redlines).toHaveLength(6)
    expect(redlines.every((rule) => rule.kind === 'forbidden' && rule.priority === 100)).toBe(true)
  })

  it('has a Chinese label for every pool key', () => {
    for (const key of VARIABLE_POOL_KEYS) {
      expect(VARIABLE_POOL_LABELS[key]).toBeTruthy()
    }
  })
})

describe('parseRuleText', () => {
  it('parses the shipped default text into three parts', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    expect(parts.basePrompt).toContain('保留风格、构图和主体层级')
    expect(parts.negativePrompt).toContain('禁止原图复刻')
    for (const key of VARIABLE_POOL_KEYS) {
      expect(parts.variablePools[key]).toHaveLength(MIN_POOL_OPTIONS)
    }
  })

  it('does not swallow the next section into the previous one', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    expect(parts.basePrompt).not.toContain('变量词池')
    expect(parts.basePrompt).not.toContain('冷色渐变')
    expect(parts.negativePrompt).not.toContain('typography_style')
  })

  it('accepts Chinese punctuation and the full-width colon in pool lines', () => {
    const parts = parseRuleText(
      ['【变量词池】', '{main_color_set}：冷色渐变，暖色渐变、低饱和中性色;高对比撞色；单色明暗层次'].join('\n'),
    )
    expect(parts.variablePools.main_color_set).toEqual([
      '冷色渐变',
      '暖色渐变',
      '低饱和中性色',
      '高对比撞色',
      '单色明暗层次',
    ])
  })

  it('drops pool lines whose key is not one of the six', () => {
    const parts = parseRuleText(['【变量词池】', '{made_up_pool}: 甲,乙'].join('\n'))
    expect(Object.keys(parts.variablePools)).toEqual([...VARIABLE_POOL_KEYS])
    expect(parts.variablePools.main_color_set).toEqual([])
  })

  it('returns an empty structure instead of throwing on broken text', () => {
    expect(parseRuleText('')).toEqual(createEmptyRuleParts())
    expect(parseRuleText('随便写点什么')).toEqual(createEmptyRuleParts())
    expect(parseRuleText('【固定基底Prompt】只有这一段').basePrompt).toBe('只有这一段')
  })

  it('de-duplicates options and drops blanks', () => {
    const parts = parseRuleText(['【变量词池】', '{main_color_set}: 甲, 甲 , ,乙'].join('\n'))
    expect(parts.variablePools.main_color_set).toEqual(['甲', '乙'])
  })
})

describe('serializeRuleText / parseRuleText 往返', () => {
  it('round-trips the shipped default text without drift', () => {
    const once = parseRuleText(DEFAULT_RULE_TEXT)
    const again = parseRuleText(serializeRuleText(once))
    expect(again).toEqual(once)
  })

  it('round-trips a hand-written structure', () => {
    const parts = createEmptyRuleParts()
    parts.basePrompt = '保留构图，替换 {main_color_set} 与 {light_effect}'
    parts.variablePools.main_color_set = ['甲', '乙', '丙', '丁', '戊', '己']
    parts.variablePools.light_effect = ['一', '二', '三', '四', '五', '六']
    parts.negativePrompt = '禁止出现文字'
    expect(parseRuleText(serializeRuleText(parts))).toEqual(parts)
  })

  it('always writes all six pool lines, even the empty ones', () => {
    const text = serializeRuleText(createEmptyRuleParts())
    for (const key of VARIABLE_POOL_KEYS) {
      expect(text).toContain(`{${key}}:`)
    }
  })
})

describe('extractPoolPlaceholders', () => {
  it('collects placeholders once each, in order', () => {
    expect(extractPoolPlaceholders('用 {light_effect} 和 {main_color_set}，再来 {light_effect}')).toEqual([
      'light_effect',
      'main_color_set',
    ])
  })

  it('reads the single-brace form only, not the double-brace one', () => {
    // 照抄瀚灵用单花括号；双花括号是配方卡的写法，这里不该被认出来
    expect(extractPoolPlaceholders('{{main_color_set}}')).toEqual([])
  })
})

describe('replacePoolPlaceholders（与 extract 共用同一个正则）', () => {
  it('replaces known keys and leaves unknown ones untouched', () => {
    expect(replacePoolPlaceholders('用 {main_color_set} 和 {light_effect}', { main_color_set: '冷色渐变' })).toBe(
      '用 冷色渐变 和 {light_effect}',
    )
  })

  it('does not touch the double-brace form', () => {
    expect(replacePoolPlaceholders('{{main_color_set}}', { main_color_set: '冷色渐变' })).toBe('{{main_color_set}}')
  })
})

describe('parseRuleTextModelOutput / RULE_TEXT_FORMAT（反推与延展共用）', () => {
  it('reads the ruleText field, unescaping newlines', () => {
    expect(parseRuleTextModelOutput('{"ruleText":"第一行\\n第二行"}')).toBe('第一行\n第二行')
  })

  it('strips a json code fence', () => {
    expect(parseRuleTextModelOutput('```json\n{"ruleText":"甲"}\n```')).toBe('甲')
  })

  it('throws a readable error when the payload is not JSON', () => {
    expect(() => parseRuleTextModelOutput('我随便写了一段')).toThrow(/规定格式/)
  })

  it('throws when ruleText is blank', () => {
    expect(() => parseRuleTextModelOutput('{"ruleText":"   "}')).toThrow(/可用的配方内容/)
  })

  it('declares a strict schema whose required matches its properties', () => {
    expect(RULE_TEXT_FORMAT.schema.additionalProperties).toBe(false)
    expect([...RULE_TEXT_FORMAT.schema.required]).toEqual(Object.keys(RULE_TEXT_FORMAT.schema.properties))
  })
})

describe('findRuleTextIssues（门槛照抄瀚灵的硬校验）', () => {
  it('reports nothing for the shipped default', () => {
    expect(findRuleTextIssues(parseRuleText(DEFAULT_RULE_TEXT))).toEqual([])
  })

  it('flags a blank negative prompt', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    parts.negativePrompt = ''
    expect(findRuleTextIssues(parts).join()).toContain('反向Prompt')
  })

  it('flags a blank base prompt', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    parts.basePrompt = ''
    expect(findRuleTextIssues(parts).join()).toContain('固定基底')
  })

  it('flags a pool holding fewer than six options', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    parts.variablePools.main_color_set = ['甲', '乙']
    const issues = findRuleTextIssues(parts).join()
    expect(issues).toContain('主色')
    expect(issues).toContain('不够 6 个')
  })

  it('flags a placeholder whose pool is empty', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    parts.variablePools.light_effect = []
    expect(findRuleTextIssues(parts).join()).toContain('换不出东西')
  })

  it('flags a filled pool that the base prompt never references', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    parts.basePrompt = '只保留构图，替换 {main_color_set}'
    expect(findRuleTextIssues(parts).join()).toContain('用不上')
  })

  it('flags a placeholder that names a pool which does not exist', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    parts.basePrompt = '替换 {no_such_pool}'
    expect(findRuleTextIssues(parts).join()).toContain('不存在的池')
  })

  it('flags the double-brace form as a mistake', () => {
    const parts = parseRuleText(DEFAULT_RULE_TEXT)
    parts.basePrompt = '保留构图，替换 {{main_color_set}}'
    const issues = findRuleTextIssues(parts).join()
    expect(issues).toContain('双花括号')
  })

  it('flags an entirely empty pool set', () => {
    const parts = createEmptyRuleParts()
    parts.basePrompt = '画面'
    parts.negativePrompt = '禁止低质量'
    expect(findRuleTextIssues(parts).join()).toContain('一模一样')
  })
})
