/**
 * 三段式配方 → 糖包的「变量提示词」模板 —— TB-154。
 *
 * ## 为什么要转这一下
 *
 * Agent 的配方是瀚灵的形状（`{池名}` + 三个章节），而糖包**已有的出图链路**认的是
 * 「变量提示词」格式（`src/lib/variablePrompt.ts`：正文 + 独立一行的「可变项：」块）。
 * 那条链路在**任务执行时**会按数量展开：
 *
 * ```ts
 * // src/store.ts:10316
 * const variablePrompt = parseVariablePrompt(task.prompt)
 * const renderedVariablePrompts = variablePrompt.enabled
 *   ? renderVariablePromptBatch(task.prompt, n, task.id)
 *   : []
 * ```
 *
 * 转成那个格式，就**不用另写一套「展开 + 提交 N 个任务」** —— 直接接上去：
 * 把转换结果当 `task.prompt`、数量当 `params.n`，剩下的（并发、重试、去重、落盘）全是现成的。
 *
 * ## 反向段去哪了
 *
 * 变量提示词的语法**只有「正文 + 可变项」两块，没有负向入口**，所以把【反向Prompt】
 * 作为一句「同时避免出现：…」追加在正文末尾 —— 宁可措辞弱一点，也不能把它丢掉。
 *
 * ## 顺带说一句
 *
 * 变量提示词自带的 `chooseCombinations` 是个成熟的「多样度优先」算法（带使用次数惩罚），
 * 比配方卡那条更完整。**这里不再自己展开**，交给它。
 */

import { VARIABLE_POOL_KEYS } from './defaults'
import { extractPoolPlaceholders, parseRuleText, toDoubleBracePlaceholders } from './ruleText'

/** 变量提示词的定义块标题（语法要求**单独占一行**，一个字都不能改）。 */
const VARIABLE_SECTION_TITLE = '可变项：'

/**
 * 把三段式配方转成变量提示词模板。
 *
 * 只有**正文里引用到的**池才会写进定义块 —— 没引用的池放进去会白占组合空间，
 * 让「不同」这件事在真正看得见的地方变少（选了却没被用上）。
 */
export function ruleTextToVariablePrompt(ruleText: string): string {
  const parts = parseRuleText(ruleText)

  const body = toDoubleBracePlaceholders(parts.basePrompt).trim()
  if (!body) throw new Error('这份配方没有固定基底，转不成变量提示词')

  const referenced = extractPoolPlaceholders(parts.basePrompt)

  const usable = referenced.filter((key) => (VARIABLE_POOL_KEYS as readonly string[]).includes(key))
  const unknown = referenced.filter((key) => !(VARIABLE_POOL_KEYS as readonly string[]).includes(key))
  if (unknown.length > 0) {
    throw new Error(`固定基底里引用了不存在的池：${unknown.map((key) => `{${key}}`).join('、')}`)
  }

  const empty = usable.filter((key) => parts.variablePools[key as (typeof VARIABLE_POOL_KEYS)[number]].length === 0)
  if (empty.length > 0) {
    throw new Error(`这几个池还是空的，填上候选词再出图：${empty.map((key) => `{${key}}`).join('、')}`)
  }

  if (usable.length === 0) {
    throw new Error('固定基底里一个 {池名} 占位符都没有，出一批图会一模一样')
  }

  const negative = parts.negativePrompt.trim()
  const bodyWithNegative = negative ? `${body}\n\n同时避免出现：${negative}` : body

  const definitions = usable.map((key) => {
    const options = parts.variablePools[key as (typeof VARIABLE_POOL_KEYS)[number]]
    // 选项里不能出现 `/`（那是变量提示词的选项分隔符），出现就换成顿号，别让它把一个选项劈成两个
    const safe = options.map((option) => option.replace(/[/／]/gu, '、'))
    return `{{${key}}}：${safe.join(' / ')}`
  })

  return [bodyWithNegative, '', VARIABLE_SECTION_TITLE, ...definitions].join('\n')
}
