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
 * `undefined` = 没自定义过（用默认）；`[]` = 用户明确清空（红线关闭）；`string[]` = 用户那一份。
 */

/**
 * **默认**红线词表（21 词）：广告法与平台审核的高危项，也是新用户那份词表的初始内容。
 *
 * ⚠️ 它**不是运行时的真相** —— 判定处一律走 `findRecipeForbiddenViolations(text, terms)`
 * 把当前生效词表传进去；直接 filter 这个常量，会在用户改过词表之后与实际生效的不一致
 * （典型症状：用户删了词，界面还报命中）。
 */
export const DEFAULT_RECIPE_FORBIDDEN_TERMS: readonly string[] = [
  // 金融 / 收益承诺
  '人民币',
  '现金',
  '钞票',
  '提现',
  '赚钱',
  '日赚',
  '月赚',
  '保本',
  '稳赚',
  // 极限用语
  '最高',
  '必备',
  '必看',
  '第一',
  // 国家 / 政治敏感
  '国家级',
  '领导人',
  '毛泽东',
  '军',
  '警',
  // 色情低俗
  '色情',
  '裸体',
  '裸',
]

/**
 * 归一化用户自定义词表。
 *
 * - `undefined` —— 这个字段不存在（旧存档 / 新用户）⇒ 调用方用默认词表；
 * - `[]`        —— 用户**明确把词表清空**了 ⇒ 红线关闭，一个词都不拦；
 * - `string[]`  —— 用户那份词表（已 trim、去空、去重，保持输入顺序）。
 *
 * 所以这里**不能**把空数组折算成 undefined，调用方也**不能**按长度判断「有没有配」——
 * 否则用户「把误判词全删光」会被当成「没配过」，默认词表又冒回来。
 */
export function normalizeRecipeForbiddenTerms(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const terms: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    if (!term || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
  }
  return terms
}

/**
 * 取当前生效的词表：没传（旧调用 / 未配置）→ 默认词表；传了（**含空数组**）→ 原样使用。
 *
 * 用 `??` 而不是 `||`：空数组是「用户把红线全关了」这一明确表态，不能被当成「没配」。
 *
 * ⚠️ **必须滤掉空串**：判定用的是 `text.includes(term)`，而 `任意文本.includes('')` 恒为 `true`
 * —— 词表里只要混进一个空串，所有文本都会被判违规。界面上「点加一条」时那一格就是空的
 * （用户还没输入完），所以这层防护是必需的，不是洁癖。
 */
export function resolveRecipeForbiddenTerms(terms?: readonly string[] | null): readonly string[] {
  if (!terms) return DEFAULT_RECIPE_FORBIDDEN_TERMS
  return terms.filter((term) => typeof term === 'string' && term.trim().length > 0)
}

/** 检测文本命中的红线词，返回命中的词表（空数组表示合规）。 */
export function findRecipeForbiddenViolations(text: string, terms?: readonly string[] | null): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  return resolveRecipeForbiddenTerms(terms).filter((term) => normalized.includes(term))
}

/** 文本是否合规（未命中任何红线词）。 */
export function isRecipeCompliant(text: string, terms?: readonly string[] | null): boolean {
  return findRecipeForbiddenViolations(text, terms).length === 0
}
