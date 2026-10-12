import { describe, expect, it } from 'vitest'
import { BUILTIN_RULES, DEFAULT_RULE_TEXT } from './defaults'
import { createAgentId, normalizeAgents } from './normalize'
import { AGENT_NAME_MAX_LENGTH, agentGroupKey, describeAgentGroup } from './types'

const validEntry = {
  id: 'agent-1',
  name: '暖色促销版',
  category: '百度',
  direction: '网赚',
  description: '生成网赚信息流图片',
  ruleText: DEFAULT_RULE_TEXT,
  rules: BUILTIN_RULES.map((rule) => ({ ...rule })),
  enabled: true,
  createdAt: 1000,
  updatedAt: 2000,
}

describe('normalizeAgents', () => {
  it('returns an empty list for a non-array payload', () => {
    expect(normalizeAgents(null)).toEqual([])
    expect(normalizeAgents({ agents: [] })).toEqual([])
    expect(normalizeAgents('[]')).toEqual([])
  })

  it('normalizes a well-formed entry and trims its text fields', () => {
    const [agent] = normalizeAgents([{ ...validEntry, category: '  百度  ', direction: ' 网赚 ' }])
    expect(agent.category).toBe('百度')
    expect(agent.direction).toBe('网赚')
    expect(agent.name).toBe('暖色促销版')
  })

  it('drops entries without an id, and de-duplicates repeated ids', () => {
    const result = normalizeAgents([{ ...validEntry, id: '' }, validEntry, { ...validEntry, name: '第二个' }])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('暖色促销版')
  })

  it('drops entries that could never generate an image', () => {
    // 缺固定基底 / 缺反向 / 六个池全空 —— 留着只会让用户点了没反应（静默失效）
    const noBase = ['【变量词池】', '{main_color_set}: 甲,乙', '【反向Prompt】', '禁止低质量'].join('\n')
    const noNegative = ['【固定基底Prompt】', '画面', '【变量词池】', '{main_color_set}: 甲,乙'].join('\n')
    const noPools = ['【固定基底Prompt】', '画面', '【反向Prompt】', '禁止低质量'].join('\n')
    expect(normalizeAgents([{ ...validEntry, ruleText: noBase }])).toEqual([])
    expect(normalizeAgents([{ ...validEntry, ruleText: noNegative }])).toEqual([])
    expect(normalizeAgents([{ ...validEntry, ruleText: noPools }])).toEqual([])
  })

  it('backs a blank ruleText with the shipped default instead of dropping the agent', () => {
    const [agent] = normalizeAgents([{ ...validEntry, ruleText: '   ' }])
    expect(agent.ruleText).toBe(DEFAULT_RULE_TEXT)
  })

  it('restores the 13 builtin rules when the stored rules are missing', () => {
    const [agent] = normalizeAgents([{ ...validEntry, rules: undefined }])
    expect(agent.rules).toHaveLength(13)
  })

  it('re-adds any builtin rule that is missing from the stored set', () => {
    // 老数据里缺哪条就补哪条 —— 不能因为「当年存的时候还没有这条」就少一道红线
    const partial = [{ ...BUILTIN_RULES[0] }]
    const [agent] = normalizeAgents([{ ...validEntry, rules: partial }])
    expect(agent.rules).toHaveLength(13)
    expect(agent.rules.some((rule) => rule.id === 'redline-porn')).toBe(true)
  })

  it('drops malformed rules and repairs their fields', () => {
    const [agent] = normalizeAgents([
      {
        ...validEntry,
        rules: [
          { id: '', kind: 'required', text: '缺 id' },
          { id: 'r1', kind: 'weird', text: '  自定义  ' },
          { id: 'r2', kind: 'forbidden', text: '有文本', priority: 'x', enabled: 'yes', source: 'nope' },
        ],
      },
    ])
    const custom = agent.rules.find((rule) => rule.id === 'r1')
    expect(custom?.kind).toBe('required')
    expect(custom?.text).toBe('自定义')
    const repaired = agent.rules.find((rule) => rule.id === 'r2')
    expect(repaired?.priority).toBe(50)
    expect(repaired?.enabled).toBe(true)
    expect(repaired?.source).toBe('builtin')
  })

  it('falls back to 未命名 and clamps an over-long name', () => {
    expect(normalizeAgents([{ ...validEntry, name: '   ' }])[0].name).toBe('未命名')
    expect(normalizeAgents([{ ...validEntry, name: '名'.repeat(50) }])[0].name).toHaveLength(AGENT_NAME_MAX_LENGTH)
  })

  it('keeps empty category/direction as empty strings rather than undefined', () => {
    const [agent] = normalizeAgents([{ ...validEntry, category: undefined, direction: null }])
    expect(agent.category).toBe('')
    expect(agent.direction).toBe('')
  })

  it('treats enabled as true unless it is explicitly false', () => {
    expect(normalizeAgents([{ ...validEntry, enabled: undefined }])[0].enabled).toBe(true)
    expect(normalizeAgents([{ ...validEntry, enabled: false }])[0].enabled).toBe(false)
  })

  it('substitutes a timestamp for a corrupt createdAt/updatedAt', () => {
    const before = Date.now()
    const [agent] = normalizeAgents([{ ...validEntry, createdAt: 'yesterday', updatedAt: Number.NaN }])
    expect(agent.createdAt).toBeGreaterThanOrEqual(before)
    expect(agent.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('drops non-object entries', () => {
    expect(normalizeAgents([null, 42, 'x', undefined])).toEqual([])
  })
})

describe('createAgentId', () => {
  it('produces unique ids with a stable prefix', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createAgentId()))
    expect(ids.size).toBe(50)
    expect([...ids].every((id) => id.startsWith('agent-'))).toBe(true)
  })
})

describe('分组键与分组名', () => {
  it('is equal for the same category/direction and differs otherwise', () => {
    const a = { category: '百度', direction: '网赚' }
    expect(agentGroupKey(a)).toBe(agentGroupKey({ ...a }))
    expect(agentGroupKey(a)).not.toBe(agentGroupKey({ category: '百度', direction: '医疗' }))
    expect(agentGroupKey(a)).not.toBe(agentGroupKey({ category: '快手', direction: '网赚' }))
  })

  it('keeps 「ab/c」与「a/bc」两种切分不撞键', () => {
    // 用 \u0000 而不是空串拼接：否则 category="ab"+direction="c" 与 "a"+"bc" 会算出同一个键
    expect(agentGroupKey({ category: 'ab', direction: 'c' })).not.toBe(
      agentGroupKey({ category: 'a', direction: 'bc' }),
    )
  })

  it('joins category and direction, and falls back when category is blank', () => {
    expect(describeAgentGroup({ category: '百度', direction: '网赚' })).toBe('百度 · 网赚')
    expect(describeAgentGroup({ category: '  ', direction: '网赚' })).toBe('未分类 · 网赚')
    expect(describeAgentGroup({ category: '百度', direction: '' })).toBe('百度')
  })
})
