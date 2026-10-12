/**
 * 三段式规则文本 → 一批彼此差异最大的提示词 —— TB-154。
 *
 * ## 这里没有新算法
 *
 * 「挑出彼此差异最大的 N 条」这件事糖包早就解决了：`farthestPointSample`
 * 在配方卡里跑了很久，注释里还记着一次回退（R-94，改了下限判据反而变差）。
 * 所以这里**只做适配**：把六个池换成它认识的 `{ name, options }`，
 * 拿回选中索引，再按索引把固定基底里的 `{池名}` 渲染成具体候选词。
 *
 * 抄一份算法过来是下策 —— 以后改一处忘另一处，两边的「不重样」会慢慢分叉。
 *
 * ## 顺便说一下与瀚灵的差别
 *
 * 瀚灵靠提示词里那句「每次生成至少替换若干装饰表现」**求模型自觉**去重。
 * 糖包这里用采样**算出来**保证差异最大 —— 这一块是糖包更强的地方，保留。
 */

import { farthestPointSample, type CampaignRecipeVariable } from '../strategy/campaignRecipe'
import { VARIABLE_POOL_KEYS, type DirectionRule, type VariablePoolKey } from './defaults'
import { parseRuleText, replacePoolPlaceholders } from './ruleText'

/** 单批上限 —— 与配方卡保持一致的量级（一批几十张，再多用户也翻不完）。 */
export const MAX_DIRECTION_AGENT_BATCH = 100

/** 一条渲染好的提示词。 */
export interface DirectionAgentPrompt {
  /** 正向提示词：渲染后的固定基底（`{池名}` 已换成具体候选词）。 */
  prompt: string
  /** 负向提示词：反向段 + 启用中的 forbidden 规则，拼成一段。空串表示没有。 */
  negativePrompt: string
  /** 组合稳定签名（候选词拼串），供跨批次去重。 */
  signature: string
  /** 池名 → 这次选中的候选词。 */
  values: Record<VariablePoolKey, string>
}

/**
 * 拼负向提示词：反向段 + 禁止项规则。
 *
 * 两处来源合成一段 —— 出图接口通常只有一个负向入口，分开传反而会漏掉一半。
 */
export function buildNegativePrompt(negativePrompt: string, rules: readonly DirectionRule[] = []): string {
  const forbidden = rules
    .filter((rule) => rule.kind === 'forbidden' && rule.enabled && rule.text.trim())
    .map((rule) => rule.text.trim())
  return [negativePrompt.trim(), ...forbidden].filter(Boolean).join('；')
}

/**
 * 出一批提示词。同一份配方、同一套池子，靠换 `seed` 换一整套组合。
 *
 * `usedSignatures` 传上一批的签名（会被就地追加），跨批次自动避开已经用过的组合 ——
 * 「连出两批，两批之间不重复」靠的就是它。
 */
export function composeAgentPrompts(
  agent: { ruleText: string; rules?: readonly DirectionRule[] },
  count: number,
  options: { seed?: string; usedSignatures?: Set<string> } = {},
): { prompts: DirectionAgentPrompt[]; signatures: string[] } {
  const wanted = Math.max(1, Math.min(MAX_DIRECTION_AGENT_BATCH, Math.trunc(count)))
  const parts = parseRuleText(agent.ruleText)

  // 只有非空池参与采样；空池在渲染时兜底（不参与变化）
  const active = VARIABLE_POOL_KEYS.filter((key) => parts.variablePools[key].length > 0)

  if (active.length === 0) {
    throw new Error('这份 Agent 还没有可用的变量词池，先去编辑器里反推或填几组词')
  }

  const variables: CampaignRecipeVariable[] = active.map((key) => ({
    name: key,
    options: parts.variablePools[key],
  }))

  const { selections, signatures } = farthestPointSample(variables, wanted, {
    seed: options.seed ?? Date.now().toString(36),
    usedSignatures: options.usedSignatures,
  })

  const negativePrompt = buildNegativePrompt(parts.negativePrompt, agent.rules ?? [])

  const prompts = selections.map((selection, index) => {
    const values = VARIABLE_POOL_KEYS.reduce(
      (acc, key) => {
        acc[key] = ''
        return acc
      },
      {} as Record<VariablePoolKey, string>,
    )

    active.forEach((key, activeIndex) => {
      const options = parts.variablePools[key]
      values[key] = options[selection[activeIndex]] ?? options[0] ?? ''
    })

    // 没参与采样的池（空了）：有候选词就用首项，一个都没有就置空，
    // **绝不把 `{池名}` 原样留下** —— 模型收到字面的 `{light_effect}`，出的图莫名其妙又不报错
    for (const key of VARIABLE_POOL_KEYS) {
      if (values[key]) continue
      values[key] = parts.variablePools[key][0] ?? ''
    }

    return {
      prompt: replacePoolPlaceholders(parts.basePrompt, values),
      negativePrompt,
      signature: signatures[index] ?? '',
      values,
    }
  })

  return { prompts, signatures }
}
