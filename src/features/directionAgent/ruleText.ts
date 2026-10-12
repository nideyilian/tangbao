/**
 * 三段式规则文本的解析与序列化 —— TB-154。
 *
 * ## 为什么用"一整段文本"当真相源
 *
 * 照抄瀚灵：一个 agent 的配方就是**一段带三个章节的文本**——
 * `【固定基底Prompt】` / `【变量词池】` / `【反向Prompt】`。
 * 用户看得懂、能直接改、能手写、能贴进 AI 让它延展；结构化字段只是它的**解析视图**。
 *
 * 反过来（字段当真相、文本是渲染结果）会出问题：用户手改一段文本后，
 * 没法可靠地映射回字段（改了哪一行？删了一个候选词算哪条变更？）。
 *
 * ## 与配方卡的区别（别混）
 *
 * 配方卡的 `body` + `dimensions` 长得很像，但：
 * - 配方卡**没有"反向"这一段**，且**从头到尾不调 AI**；
 * - 这里的文本**可由 AI 反推 / 延展生成**，并且是独立模块（杰哥要求「不要在配方卡上面添加」）。
 *
 * ⚠️ 占位符是**单花括号** `{main_color_set}`，照抄瀚灵。**别改成双花括号**
 * ——改了之后存量文本里的 `{...}` 就再也匹配不上了。
 */

import {
  MAX_POOL_OPTIONS,
  MIN_POOL_OPTIONS,
  RULE_SECTION_BASE,
  RULE_SECTION_NEGATIVE,
  RULE_SECTION_POOLS,
  VARIABLE_POOL_KEYS,
  VARIABLE_POOL_LABELS,
  type VariablePoolKey,
} from './defaults'

/** 三段式文本的结构化视图。 */
export interface DirectionAgentRuleParts {
  /** 【固定基底Prompt】：保留什么、替换什么。含 `{池名}` 占位符。 */
  basePrompt: string
  /** 【变量词池】：每个池一组候选词。 */
  variablePools: Record<VariablePoolKey, string[]>
  /** 【反向Prompt】：禁止项。**不能为空**（瀚灵硬校验）。 */
  negativePrompt: string
}

/** 空的三段结构（六个池都为空数组）。 */
export function createEmptyRuleParts(): DirectionAgentRuleParts {
  return {
    basePrompt: '',
    variablePools: VARIABLE_POOL_KEYS.reduce(
      (acc, key) => {
        acc[key] = []
        return acc
      },
      {} as Record<VariablePoolKey, string[]>,
    ),
    negativePrompt: '',
  }
}

/** 词池行的形状：`{main_color_set}: 词1,词2,词3`。分隔符兼容中英文逗号与顿号。 */
const POOL_LINE_PATTERN = /^\s*\{([A-Za-z0-9_]+)\}\s*[:：]\s*(.*)$/

/**
 * `{池名}` 占位符。**单花括号**，照抄瀚灵。
 *
 * 前后各加了否定环视，把 `{{main_color_set}}` 排除在外 —— 那是配方卡的语法。
 * 混进来会留下脏字符（替换掉内层后还剩一层花括号），所以在这里就不认它，
 * 并由 `findRuleTextIssues` 明说「你写的可能是双花括号」。
 */
const PLACEHOLDER_PATTERN = /(?<!\{)\{([A-Za-z0-9_]+)\}(?!\})/g

/** 双花括号写法（配方卡语法）。误用时要提示，不能悄悄放过。 */
const DOUBLE_BRACE_PATTERN = /\{\{[A-Za-z0-9_]+\}\}/g

function isPoolKey(value: string): value is VariablePoolKey {
  return (VARIABLE_POOL_KEYS as readonly string[]).includes(value)
}

/** 把一段候选词切成数组：去空白、去空项、去重，并截到上限。 */
function splitPoolOptions(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，、;；]+/)
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    ),
  ].slice(0, MAX_POOL_OPTIONS)
}

/**
 * 解析三段式文本。
 *
 * **不抛错、尽力解析** —— 文本是用户手写的，缺一段、标题写错都属正常，
 * 由 `findRuleTextIssues` 把问题说给人听，而不是在这里崩掉、
 * 让界面变成一个「点了没反应」的输入框。
 */
export function parseRuleText(text: string): DirectionAgentRuleParts {
  const parts = createEmptyRuleParts()
  if (!text) return parts

  const baseIdx = text.indexOf(RULE_SECTION_BASE)
  const poolIdx = text.indexOf(RULE_SECTION_POOLS)
  const negativeIdx = text.indexOf(RULE_SECTION_NEGATIVE)

  const contentAfter = (title: string, start: number): string => {
    if (start < 0) return ''
    return text.slice(start + title.length)
  }

  // 每一段都切到「下一个标题出现的位置」为止，避免把整段尾巴都吞进来。
  const cutAt = (body: string, ...stops: number[]): string => {
    const ends = stops.filter((index) => index >= 0)
    if (ends.length === 0) return body
    return body.slice(0, Math.min(...ends))
  }

  const baseBody = contentAfter(RULE_SECTION_BASE, baseIdx)
  parts.basePrompt = cutAt(
    baseBody,
    poolIdx >= 0 ? poolIdx - (baseIdx + RULE_SECTION_BASE.length) : -1,
    negativeIdx >= 0 ? negativeIdx - (baseIdx + RULE_SECTION_BASE.length) : -1,
  ).trim()

  const negativeBody = contentAfter(RULE_SECTION_NEGATIVE, negativeIdx)
  parts.negativePrompt = negativeBody.trim()

  if (poolIdx >= 0) {
    const poolBody = cutAt(
      contentAfter(RULE_SECTION_POOLS, poolIdx),
      negativeIdx >= 0 ? negativeIdx - (poolIdx + RULE_SECTION_POOLS.length) : -1,
    )
    for (const line of poolBody.split(/\r?\n/)) {
      const match = line.match(POOL_LINE_PATTERN)
      if (!match) continue
      const key = match[1]
      if (!isPoolKey(key)) continue
      const options = splitPoolOptions(match[2])
      if (options.length > 0) parts.variablePools[key] = options
    }
  }

  return parts
}

/**
 * 序列化回文本。**与 `parseRuleText` 往返一致**：
 * `parse(serialize(x))` 等于 `x`（有测试守着）。
 *
 * 六个池**固定按 key 顺序输出、且都写出来**（哪怕是空的）——
 * 少写一池，下一轮解析就不知道它"是被删了还是没写"。
 */
export function serializeRuleText(parts: DirectionAgentRuleParts): string {
  return [
    RULE_SECTION_BASE,
    parts.basePrompt.trim(),
    '',
    RULE_SECTION_POOLS,
    ...VARIABLE_POOL_KEYS.map((key) => `{${key}}: ${parts.variablePools[key].join(',')}`),
    '',
    RULE_SECTION_NEGATIVE,
    parts.negativePrompt.trim(),
  ].join('\n')
}

/** 固定基底里引用到的池名（去重，按出现顺序）。 */
export function extractPoolPlaceholders(basePrompt: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const match of basePrompt.matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1]
    if (seen.has(key)) continue
    seen.add(key)
    found.push(key)
  }
  return found
}

/**
 * 把 `{池名}` 换成具体值；没给值的原样保留。
 *
 * **与 `extractPoolPlaceholders` 共用同一个正则** —— 两处各写一份的话，
 * 迟早出现「校验说没问题、替换却没生效」这种静默失效。
 */
export function replacePoolPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_PATTERN, (whole, key: string) => values[key] ?? whole)
}

/**
 * 模型输出三段式的结构化契约。**反推和延展共用这一份** —— 两处各写各的迟早分叉。
 *
 * 为什么把三段式塞进一个 JSON 字段、而不是让它直接吐纯文本：
 * `requestModelJson` 的结构化通道自带「模型不守格式就重试一次」的兜底，
 * 纯文本通道没这层保护，模型随手加一句解释整段就废了。
 */
export const RULE_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'direction_agent_rule_text',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      ruleText: { type: 'string' },
    },
    required: ['ruleText'],
    additionalProperties: false,
  },
} as const

/** 从模型的结构化输出里取出三段式文本（反推 / 延展共用）。 */
export function parseRuleTextModelOutput(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('模型没有返回规定格式的内容，请重试')
  }

  const ruleText = (parsed as { ruleText?: unknown })?.ruleText
  if (typeof ruleText !== 'string' || !ruleText.trim()) {
    throw new Error('模型没有返回可用的配方内容，请重试')
  }
  return ruleText
}

/**
 * 把单花括号占位符转成双花括号：`{main_color_set}` → `{{main_color_set}}`。
 *
 * 糖包的「变量提示词」引擎（`src/lib/variablePrompt.ts`）认的是双花括号，
 * 而瀚灵的三段式用单花括号。接那条出图链路时要转一次。
 *
 * **同样复用 `PLACEHOLDER_PATTERN`** —— 转出来的东西和校验认的东西必须是同一个集合，
 * 否则会出现「校验说引用了 3 个池、转过去只认 2 个」。
 */
export function toDoubleBracePlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_PATTERN, (_whole, key: string) => `{{${key}}}`)
}

/**
 * 把三段式文本的问题说成**人话**（空数组 = 没问题）。
 *
 * 这里的门槛是**照抄瀚灵的硬校验**（它的报错原文就是这几条），不是我自己定的：
 * - `反推规则的禁止出现不能为空。`
 * - `反推规则的必须遵循中每个变量至少需要六个候选词。`
 * - `反推结果缺少固定基底、六组变量词池或反向，请重试。`
 */
export function findRuleTextIssues(parts: DirectionAgentRuleParts): string[] {
  const issues: string[] = []

  if (!parts.basePrompt.trim()) {
    issues.push('缺少「固定基底Prompt」——不知道要保留什么、替换什么')
  }
  if (!parts.negativePrompt.trim()) {
    issues.push('「反向Prompt」不能为空——没有禁止项，出一批图容易互相撞脸')
  }

  const referenced = extractPoolPlaceholders(parts.basePrompt)
  const usable = VARIABLE_POOL_KEYS.filter((key) => parts.variablePools[key].length > 0)

  if (usable.length === 0) {
    issues.push('六个变量词池都是空的——没有可变化的东西，出一批图会一模一样')
  }

  const thin = usable.filter((key) => parts.variablePools[key].length < MIN_POOL_OPTIONS)
  if (thin.length > 0) {
    const labels = thin.map((key) => `${VARIABLE_POOL_LABELS[key]}（${parts.variablePools[key].length} 个）`)
    issues.push(`这几个池的候选词不够 ${MIN_POOL_OPTIONS} 个：${labels.join('、')}——组合太少，几张就撞了`)
  }

  const unknown = referenced.filter((key) => !isPoolKey(key))
  if (unknown.length > 0) {
    issues.push(`固定基底里引用了不存在的池：${unknown.map((key) => `{${key}}`).join('、')}`)
  }

  const empty = referenced.filter((key) => isPoolKey(key) && parts.variablePools[key].length === 0)
  if (empty.length > 0) {
    const labels = empty.map((key) => (isPoolKey(key) ? VARIABLE_POOL_LABELS[key] : key))
    issues.push(`固定基底里用了 ${labels.join('、')}，但对应的词池是空的，这个占位符换不出东西`)
  }

  const unused = usable.filter((key) => !referenced.includes(key))
  if (unused.length > 0) {
    const labels = unused.map((key) => VARIABLE_POOL_LABELS[key])
    issues.push(`填了 ${labels.join('、')}的词，但固定基底里没有对应的 {池名} 占位符，用不上`)
  }

  const doubleBraced = parts.basePrompt.match(DOUBLE_BRACE_PATTERN)
  if (doubleBraced && doubleBraced.length > 0) {
    issues.push(
      `检测到双花括号写法 ${doubleBraced.join('、')}——这里是单花括号 {池名}（双花括号是配方卡的语法，照搬过来会留下脏字符）`,
    )
  }

  return issues
}
