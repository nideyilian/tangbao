/**
 * 方向 Agent 的数据类型 —— TB-154。
 *
 * ## 三层：项目分类 → 方向 → Agent
 *
 * 照抄瀚灵：**前两层只是文本字段**（随打随有、不用维护、没有唯一性约束），
 * 只有 Agent 是要配置的干活单元。同一「分类 + 方向」下可以挂**任意多个** Agent，靠 `name` 区分。
 * 左树只按 `category` 分组，`direction` 只是卡片上的标签（瀚灵就是这么做的）。
 *
 * ## 真相源是「一段文本」
 *
 * 配方本体是 `ruleText` —— 一段带三个章节的文本（固定基底 / 变量词池 / 反向），
 * 由 `ruleText.ts` 解析成结构化视图。用户看得懂、能直接改、能手写、能贴给 AI 延展。
 * **反向做（字段当真相）会出问题**：用户手改一段文本后没法可靠映射回字段。
 *
 * ## 这里没有「全局通用池」
 *
 * 我第一版把六个池做成了全局共享、备一次永久用 —— **那是错的**。
 * 瀚灵的池子是**每个 Agent 自带**（由参考图反推生成，或手写），就存在 `ruleText` 里。
 * 详见 `.workbuddy/reference/hanling/hanling-project-agent-blueprint.md`。
 */

import type { DirectionRule } from './defaults'

/** 一个「项目分类 · 方向」下的具体出图配置。 */
export interface DirectionAgent {
  id: string
  /** Agent 名，如「暖色促销版」。同一「分类 · 方向」下靠它区分。 */
  name: string
  /** 项目分类，如「百度」。**空串表示未填**（界面按 `UNCLASSIFIED_CATEGORY` 归集）。左树按它分组。 */
  category: string
  /** 方向，如「网赚」。只是标签，不进树。 */
  direction: string
  /**
   * 用户写的大白话，如「生成网赚信息流图片，标题为"看视频 领红包"，可以轻微发散…」。
   *
   * 有两条路进这里：手动写，或者由 AI 从参考图**反推**时顺带产出。
   * **不直接参与出图** —— 出图只读 `ruleText`；留着是为了让用户回头看得懂这版配方当初要什么。
   */
  description: string
  /**
   * 三段式规则文本（**配方的真相源**）。
   *
   * 用 `parseRuleText` 取结构化视图，用 `serializeRuleText` 写回。
   * 新建时用 `DEFAULT_RULE_TEXT` 打底。
   */
  ruleText: string
  /** 约束清单（必须遵循 / 禁止出现）。新建时自动带上 `BUILTIN_RULES` 那 13 条。 */
  rules: DirectionRule[]
  /** 关掉之后不在出图时可选（照抄瀚灵的「仅显示当前启用的」）。 */
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** 没填分类时左树上的归集名。**只用于显示**，`category` 字段本身保持空串。 */
export const UNCLASSIFIED_CATEGORY = '未分类'

/** Agent 名上限。太短会重名（同分类同方向下靠它区分），太长列表放不下。 */
export const AGENT_NAME_MAX_LENGTH = 20

/** 按上限截断 Agent 名（超长直接截，不加省略号 —— 上限本身就该是硬约束）。 */
export function clampAgentName(name: string): string {
  return Array.from(name.trim()).slice(0, AGENT_NAME_MAX_LENGTH).join('')
}

/**
 * 「分类 · 方向」分组键。
 *
 * 两处（左树分组、出图时归组）必须用**同一个**口径算，否则会出现
 * 「树里在一组、新建时归到另一组」。所以只在这里实现一份。
 */
export function agentGroupKey(agent: Pick<DirectionAgent, 'category' | 'direction'>): string {
  return `${agent.category}\u0000${agent.direction}`
}

/** 左树 / 列表上的分组标题。 */
export function describeAgentGroup(agent: Pick<DirectionAgent, 'category' | 'direction'>): string {
  const category = agent.category.trim() || UNCLASSIFIED_CATEGORY
  const direction = agent.direction.trim()
  return direction ? `${category} · ${direction}` : category
}
