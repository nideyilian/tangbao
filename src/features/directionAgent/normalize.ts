import { BUILTIN_RULES, DEFAULT_RULE_TEXT, type DirectionRule } from './defaults'
import { parseRuleText } from './ruleText'
import { clampAgentName, type DirectionAgent } from './types'

/**
 * 把磁盘上读到的任意形状归一成合法的 Agent 列表。
 *
 * 盘上的数据可能来自旧版本、导入或手工改过的库，所以一律**防御式解析、不信任任何字段**。
 *
 * ## 为什么丢掉「不完整」的条目，而不是留空壳
 *
 * 规则文本解析不出固定基底、或者六个池全是空的 Agent **出不了图**。
 * 留着它，用户在列表里点进去只会觉得「这个按钮坏了」。宁可少一张卡片，
 * 也不能让一张卡片刻意看起来能用、实际点了没反应 —— 那是糖包反复踩过的静默失效。
 */

/** 判断一段规则文本是否「能出图」：至少要有固定基底 + 反向 + 一个非空池。 */
function isUsableRuleText(ruleText: string): boolean {
  const parts = parseRuleText(ruleText)
  if (!parts.basePrompt.trim() || !parts.negativePrompt.trim()) return false
  return Object.values(parts.variablePools).some((options) => options.length > 0)
}

/** 兜底一份规则：老数据没有 `rules` 时，把出厂那 13 条补回去（不能让它变成无约束）。 */
function normalizeRules(raw: unknown): DirectionRule[] {
  if (!Array.isArray(raw)) return BUILTIN_RULES.map((rule) => ({ ...rule }))

  const seen = new Set<string>()
  const rules: DirectionRule[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    if (!id || !text || seen.has(id)) continue
    seen.add(id)
    rules.push({
      id,
      kind: record.kind === 'forbidden' ? 'forbidden' : 'required',
      text,
      priority: typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : 50,
      enabled: record.enabled !== false,
      source: record.source === 'user' || record.source === 'ai' ? record.source : 'builtin',
    })
  }

  // 出厂那 13 条是底线（含 6 条合规红线），老数据里缺哪条就补哪条 ——
  // 不能因为「当年存的时候还没有这条」就让某个 agent 少一道红线。
  for (const builtin of BUILTIN_RULES) {
    if (!seen.has(builtin.id)) rules.push({ ...builtin })
  }
  return rules
}

export function normalizeAgents(raw: unknown): DirectionAgent[] {
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  const seen = new Set<string>()
  const result: DirectionAgent[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>

    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id || seen.has(id)) continue

    const rawRuleText = typeof record.ruleText === 'string' ? record.ruleText : ''
    const ruleText = rawRuleText.trim() ? rawRuleText : DEFAULT_RULE_TEXT
    if (!isUsableRuleText(ruleText)) continue

    seen.add(id)
    result.push({
      id,
      name: clampAgentName(typeof record.name === 'string' && record.name.trim() ? record.name : '未命名'),
      category: typeof record.category === 'string' ? record.category.trim() : '',
      direction: typeof record.direction === 'string' ? record.direction.trim() : '',
      description: typeof record.description === 'string' ? record.description : '',
      ruleText,
      rules: normalizeRules(record.rules),
      enabled: record.enabled !== false,
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : now,
    })
  }

  return result
}

/** 生成 Agent id。用短横线 + 字母数字，避开记录 id 的字符限制。 */
export function createAgentId(): string {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
