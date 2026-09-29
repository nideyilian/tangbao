/**
 * 配方卡「合规红线」词表 —— 默认值、归一化与命中判定（**全应用唯一实现**）。
 *
 * 为什么单独成文件而不是留在 `features/strategy/campaignRecipe.ts`：
 * `normalizeSettings`（`lib/apiProfiles.ts`）要在设置载入/导入时归一化这份词表，
 * 而 lib **不能**反向依赖 features（分层倒置，且会把渲染侧业务链拉进设置归一化）。
 * 判定本身是纯字符串函数，本来也不属于引擎算法。
 *
 * ## 词表为什么必须可编辑（2026-09-28 TB-142）
 *
 * 判定是**子串匹配**（中文没有词边界），所以「军」会命中「军绿色」、「提现」会命中
 * 「点击提现到账」。原先是硬编码的 21 词且不可关闭，用户遇到误判只能改自己的文案 ——
 * 报障原话是「系统频繁产生误判，而我无法手动修正……我正常的提示词会被整体破坏而无法使用」。
 * 现在默认词表仍是这 21 词，但**实际生效的是用户在「配方卡详情」里维护的那一份**。
 *
 * 三种值语义必须分清（`normalizeRecipeForbiddenTerms` 的三种返回）：
 * `undefined` = 没自定义过（用默认）；`[]` = 用户明确清空（红线关闭）；
 * `RecipeForbiddenRule[]` = 用户那一份。
 *
 * ## 判定为什么是「例外词 + 挖空」而不是纯子串（2026-09-29 TB-145）
 *
 * 光让用户能删词还不够：默认表里有 **4 个单字/短词**（`裸` `军` `警` + `第一` `最高`），
 * 「裸」必然命中「裸妆」、「军」必然命中「军绿色」。而删掉整个「裸」，
 * 「全裸」「半裸」就一起漏了 —— **误伤与漏判只能二选一**，问题出在词太宽。
 *
 * 所以每条规则可以带**例外词**，判定时**先把例外词从正文里挖空**再匹配：
 *
 * ```
 * '裸妆效果'      → 挖掉「裸妆」→ '效果'      → 合规
 * '裸妆和裸体同框' → 挖掉「裸妆」→ '和裸体'    → 命中「裸」，拦住
 * ```
 *
 * - **不写成「有例外就跳过整个词」**：那样第二句会被整体放过 —— 误判修好了，漏判又来了。
 * - **挖空用 `\u0000` 占位而不是删除**：直接删会把断口两侧拼起来，可能拼出一个新的违规词。
 * - 例外表与词表同口径归一化（trim / 去空 / 去重）。⚠️ 空串漏进例外表的后果**比词表更隐蔽**：
 *   `'裸妆'.split('').join('\u0000')` 会把正文**逐字拆散**，该词的例外从此静默失效，
 *   而界面上它看起来还在工作（详见 RISK 的对应条目）。
 */

import type { RecipeForbiddenRule } from '../types'

export type { RecipeForbiddenRule }

/**
 * 词表输入形态：兼容三种来源 —— 旧存档的纯字符串、新形态的对象、
 * 以及调用方（测试 / 界面）临时拼出来的混合数组。
 */
export type RecipeForbiddenTermInput = string | RecipeForbiddenRule
export type RecipeForbiddenTermsInput = readonly RecipeForbiddenTermInput[]

/** 挖空例外词用的占位符（不可见、且不会出现在正常文案里）。 */
const ALLOW_PLACEHOLDER = '\u0000'

/** 紧凑地写默认表：多数词没有例外。 */
function rule(term: string, allow: string[] = []): RecipeForbiddenRule {
  return { term, allow }
}

/**
 * **默认**红线词表（21 词）：广告法与平台审核的高危项，也是新用户那份词表的初始内容。
 *
 * `allow` 是**开箱即用**的例外词 —— 收录的都是「正常人会写、但会被这个宽词误伤」的搭配。
 * ⚠️ `必备` / `必看` / `稳赚` 刻意不配例外：「必备清单」「必看合集」本身就是违规表达。
 *
 * ⚠️ 它**不是运行时的真相** —— 判定处一律走 `findRecipeForbiddenViolations(text, terms)`
 * 把当前生效词表传进去；直接读这个常量，会在用户改过词表之后与实际生效的不一致
 * （典型症状：用户删了词，界面还报命中）。
 */
export const DEFAULT_RECIPE_FORBIDDEN_RULES: readonly RecipeForbiddenRule[] = [
  // 金融 / 收益承诺
  rule('人民币'),
  rule('现金', ['现金流']),
  rule('钞票'),
  rule('提现'),
  rule('赚钱'),
  rule('日赚'),
  rule('月赚'),
  rule('保本', ['保本点']),
  rule('稳赚'),
  // 极限用语
  rule('最高', ['最高峰', '最高点', '最高处', '最高层']),
  rule('必备'),
  rule('必看'),
  rule('第一', ['第一人称', '第一时间', '第一视角', '第一步', '第一印象', '第一反应']),
  // 国家 / 政治敏感
  rule('国家级'),
  rule('领导人'),
  rule('毛泽东'),
  rule('军', ['军绿', '军绿色', '军阵', '军旅']),
  rule('警', ['警醒', '机警', '警觉', '警示', '警告', '警钟']),
  // 色情低俗
  rule('色情'),
  rule('裸体'),
  rule('裸', ['裸妆', '裸色', '裸粉', '裸感', '裸机', '裸眼']),
]

/**
 * 默认词表的**词名列表**（只有词，不含例外）。
 *
 * 保留它是为了兼容既有引用：`campaignRecipe.ts` 把它 re-export 成
 * `CAMPAIGN_RECIPE_FORBIDDEN_TERMS`，界面用它显示「恢复默认 N 词」。
 * ⚠️ **判定/恢复默认请用 `DEFAULT_RECIPE_FORBIDDEN_RULES`** —— 只见词名会丢掉例外。
 */
export const DEFAULT_RECIPE_FORBIDDEN_TERMS: readonly string[] = DEFAULT_RECIPE_FORBIDDEN_RULES.map((item) => item.term)

/** 归一化例外词表：trim、去空、去重，保持顺序。 */
function normalizeAllowList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const allow: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const word = item.trim()
    if (!word || seen.has(word)) continue
    seen.add(word)
    allow.push(word)
  }
  return allow
}

/** 归一化单条规则：接受 `string`（旧形态）或 `{ term, allow }`；认不出返回 null。 */
function normalizeRuleItem(value: unknown): RecipeForbiddenRule | null {
  if (typeof value === 'string') {
    const term = value.trim()
    return term ? { term, allow: [] } : null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const term = typeof record.term === 'string' ? record.term.trim() : ''
  if (!term) return null
  return { term, allow: normalizeAllowList(record.allow) }
}

/**
 * 归一化词表列表：逐条归一化 + 按词名去重（保持输入顺序）。
 *
 * 去重口径是**词名**：同一个词只留第一次出现的（含它当时的例外表），
 * 否则界面上会出现两个「裸」，改哪个生效全看顺序。
 */
function normalizeRuleList(value: readonly unknown[]): RecipeForbiddenRule[] {
  const seen = new Set<string>()
  const rules: RecipeForbiddenRule[] = []
  for (const item of value) {
    const normalized = normalizeRuleItem(item)
    if (!normalized || seen.has(normalized.term)) continue
    seen.add(normalized.term)
    rules.push(normalized)
  }
  return rules
}

/**
 * 归一化用户自定义词表。
 *
 * - `undefined` —— 这个字段不存在（旧存档 / 新用户）⇒ 调用方用默认词表；
 * - `[]`        —— 用户**明确把词表清空**了 ⇒ 红线关闭，一个词都不拦；
 * - 数组        —— 用户那份词表（已 trim、去空、去重，保持输入顺序）。
 *
 * 所以这里**不能**把空数组折算成 undefined，调用方也**不能**按长度判断「有没有配」——
 * 否则用户「把误判词全删光」会被当成「没配过」，默认词表又冒回来。
 *
 * ⚠️ 旧存档存的是 `string[]`（TB-145 之前），这里照收：纯字符串补成 `allow: []`，
 * 即「这个词没有例外」，判定行为与升级前**完全一致**。
 */
export function normalizeRecipeForbiddenTerms(value: unknown): RecipeForbiddenRule[] | undefined {
  if (!Array.isArray(value)) return undefined
  return normalizeRuleList(value)
}

/**
 * 取当前生效的词表规则：没传（旧调用 / 未配置）→ 默认规则；传了（**含空数组**）→ 原样归一化后用。
 *
 * 用 `??` 而不是 `||`：空数组是「用户把红线全关了」这一明确表态，不能被当成「没配」。
 *
 * ⚠️ 传进来的可能是**已经归一化过**的数组（来自设置），也可能是界面/测试临时拼的
 * 混合形态，所以这里统一再归一化一次（幂等）。开销可忽略（词表只有几十条）。
 */
export function resolveRecipeForbiddenTerms(terms?: RecipeForbiddenTermsInput | null): readonly RecipeForbiddenRule[] {
  if (!terms) return DEFAULT_RECIPE_FORBIDDEN_RULES
  return normalizeRuleList(terms)
}

/**
 * 把正文里的**例外词**挖空（换成占位符）。
 *
 * 必须先挖完再判定，不能边挖边判 —— 否则前一个词的判定会看到「已被挖掉一部分」的正文，
 * 结果依赖词表顺序，无法解释。
 */
function maskAllowWords(text: string, rules: readonly RecipeForbiddenRule[]): string {
  let masked = text
  for (const item of rules) {
    for (const allow of item.allow) {
      if (masked.includes(allow)) masked = masked.split(allow).join(ALLOW_PLACEHOLDER)
    }
  }
  return masked
}

/**
 * 检测文本命中的红线词，返回命中的词表（空数组表示合规）。
 *
 * 判定顺序：先按**全部**例外词把正文挖空，再逐词 `includes`。
 * 「裸妆和裸体同框」这类混写因此仍然会被拦住（挖掉「裸妆」后还剩「裸体」）。
 */
export function findRecipeForbiddenViolations(text: string, terms?: RecipeForbiddenTermsInput | null): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  const rules = resolveRecipeForbiddenTerms(terms)
  if (rules.length === 0) return []

  const masked = maskAllowWords(normalized, rules)
  return rules.filter((item) => masked.includes(item.term)).map((item) => item.term)
}

/** 文本是否合规（未命中任何红线词）。 */
export function isRecipeCompliant(text: string, terms?: RecipeForbiddenTermsInput | null): boolean {
  return findRecipeForbiddenViolations(text, terms).length === 0
}
