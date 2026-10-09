/**
 * 配方卡「问题清单」—— 把散在各处的提示归一成**带落点的问题**。
 *
 * ## 它解决什么
 *
 * 2026-10-09 杰哥报障原话：「解析完成后出现问题时，提示无法点击跳转到对应的出问题位置，
 * 也没有附带修改策略和解决方案，整体上仅仅是一个静态提示。」
 *
 * 病根是**提示的生产者只吐字符串**：`finalize` 推 `warnings[]`、`validateCampaignRecipeConfig`
 * 返回 `string[]`、红线命中返回词名数组 —— 里面没有任何一条信息说明「这个问题长在哪个元素上」。
 * 到了界面这层只剩两件事能做：拼成一句、变个颜色。所以「点了没反应」不是交互没做，
 * 是**根本没东西可跳**。
 *
 * 这个模块把四类来源归一成同一种东西：
 *
 * | 来源 | 原来的形态 | 归一后 |
 * | --- | --- | --- |
 * | 解析失败 | `parsed.error` 一句话 | error + 落点原文框 + 怎么改 |
 * | 解析告警 | `parsed.warnings[]` / `missingPools[]` | 逐条成问题（带落点与建议） |
 * | 结构校验 | `validateCampaignRecipeConfig` 的 `string[]` | 逐条成问题，**落点精确到第几个维度** |
 * | 红线命中 | 两组词名数组 | 逐条成问题（保留原有加白 / 剔除动作） |
 * | 面板级上下文 | 「原文已改动」一句灰字 | 问题 + 「重新解析」动作 |
 *
 * ## 三条口径（勿改回）
 *
 * 1. **条数由明细数出来**：界面上报的「N 个问题」一律取 `problems.length`，
 *    禁止在别处再算一遍（TB-148 踩过的坑：数字一处算、明细另一处渲染 ⇒ 必然漂移）。
 * 2. **去重成一条**：`missingPools` 与「维度没有候选值」说的是同一件事
 *    （解析时已经把缺失的槽补成空维度了），必须合并成一条，不能两处各说一次。
 * 3. **落点是数据，不是选择器**：这里只产出 `RecipeProblemTarget`（语义），
 *    由 `recipeTargetLocate.ts` 换成 DOM 查询 —— 组件里不许出现手写 CSS 选择器。
 *
 * 本模块是**纯数据层**：不 import React、不碰 DOM，句句可单测。
 */
import { CAMPAIGN_RECIPE_FORBIDDEN_RULES, findCampaignRecipeViolations } from './campaignRecipe'
import type { ParsedCampaignRecipe } from './campaignRecipeImport'
import type { SopCampaignRecipeConfig } from './types'
import type { RecipeForbiddenRule } from '../../types'

// ---------------------------------------------------------------------------
// 落点
// ---------------------------------------------------------------------------

/** 这条问题长在哪个元素上。渲染时落到 `data-recipe-target`，跳转时按它查 DOM。 */
export type RecipeProblemTarget =
  | { kind: 'rawText' }
  | { kind: 'body' }
  | { kind: 'dimensions' }
  | { kind: 'dimension'; index: number }
  | { kind: 'option'; dimensionIndex: number; optionIndex: number }
  | { kind: 'terms' }
  | { kind: 'term'; index: number }
  | { kind: 'name' }
  | { kind: 'description' }

/**
 * 落点所在的**层级**，决定「点了要做什么」：
 *
 * - `panel`：配方卡面板自己的控件（原文框）⇒ 就地定位；
 * - `dialog`：配方卡详情弹窗里的控件（骨架 / 维度池 / 候选值 / 词表）⇒ 没开弹窗要先开，再滚；
 * - `outside`：弹窗外面、面板外面的字段（SOP 名称 / 说明在 SOP 管理中心的左侧字段区）
 *   ⇒ 关掉弹窗，滚到那个字段并聚焦。
 *
 * 三层不是设计出来的，是界面本来就这样分层；不区分的话「定位」按钮点下去只能猜。
 */
export type RecipeTargetScope = 'panel' | 'dialog' | 'outside'

export function recipeTargetScope(target: RecipeProblemTarget): RecipeTargetScope {
  switch (target.kind) {
    case 'rawText':
      return 'panel'
    case 'name':
    case 'description':
      return 'outside'
    default:
      return 'dialog'
  }
}

/** 落点的稳定字符串键（`data-recipe-target` 的值）。数字下标用冒号分隔。 */
export function problemTargetKey(target: RecipeProblemTarget): string {
  switch (target.kind) {
    case 'dimension':
      return `dim:${target.index}`
    case 'option':
      return `opt:${target.dimensionIndex}:${target.optionIndex}`
    case 'term':
      return `term:${target.index}`
    case 'rawText':
      return 'raw'
    case 'description':
      return 'desc'
    default:
      // body / dimensions / terms / name 本身就是键
      return target.kind
  }
}

// ---------------------------------------------------------------------------
// 问题与动作
// ---------------------------------------------------------------------------

/**
 * 问题的处理动作。
 *
 * **刻意做成声明式**（这里不认识 React）：纯数据层只描述「能做什么」，
 * 由渲染处映射到已有的回调。这样这份清单可以在没有组件的环境里被完整断言
 * —— 「点一下会发生什么」也就成了可测的。
 */
export type RecipeProblemAction =
  /** 滚到某处并高亮（几乎所有问题都该有一个） */
  | { kind: 'locate'; label: string; target: RecipeProblemTarget }
  /** 追加一个空维度 */
  | { kind: 'add-dimension'; label: string }
  /** 删掉第 index 个维度 */
  | { kind: 'remove-dimension'; label: string; index: number }
  /** 删掉某个候选值 */
  | { kind: 'remove-option'; label: string; dimensionIndex: number; optionIndex: number }
  /** 把命中的红线词整词加白（可逆，优于删除） */
  | { kind: 'whitelist-terms'; label: string; terms: string[] }
  /** 在骨架末尾补一个 {name} 占位符 */
  | { kind: 'insert-placeholder'; label: string; name: string }
  /** 把骨架里的 {name} 删掉 */
  | { kind: 'remove-placeholder'; label: string; name: string }
  /** 用当前原文重新解析 */
  | { kind: 'reparse'; label: string }

export type RecipeProblemLevel = 'error' | 'warn'

export interface RecipeProblem {
  /** 稳定 id：同一条问题在重算之间保持同一个字符串（用于列表 key 与测试断言） */
  id: string
  /**
   * 分组：`recipe` = 配方卡本身的问题；`redline` = 合规红线命中。
   * 红线单独成组是为了在弹窗里保留它原有的分组标题与说明
   * （TB-144 的守卫按那段文字断言），同时仍属于**同一份清单**、同一个数字。
   */
  group: 'recipe' | 'redline'
  level: RecipeProblemLevel
  title: string
  /** 人话位置说明（如「维度池 · 第 2 个」） */
  location?: string
  /** 点「定位」去哪儿；没有落点的纯提示不出定位按钮 */
  target?: RecipeProblemTarget
  /** **具体怎么改** —— 必须能照着做，禁止「请检查格式」这类空话 */
  advise: string
  actions: RecipeProblemAction[]
}

export interface RecipeProblemsInput {
  /** 这次的解析结果；`null` = 从库里打开、本次没解析过 */
  parsed: ParsedCampaignRecipe | null
  /** 当前草稿配置 */
  config: SopCampaignRecipeConfig
  /**
   * 面板自己的解析报错（`SopCampaignRecipePanel` 的本地 state）。
   *
   * 为什么单独传：解析**成功**但转换不出可用配置时（解析出的维度全被过滤掉），
   * 报错只存在于面板的本地 state 里，`parsed` 那边是 ok 的 —— 不传进来这条就会被吞掉。
   * 解析失败（`parsed.ok === false`）时由上面那条覆盖，这里不会再重复出条目。
   */
  localParseError?: string
  /** 录入框里的原文与上次解析时不一致（面板级上下文） */
  rawChangedAfterParse?: boolean
  /**
   * **生效中的**红线词表（调用方已按总开关折算过：关闭时传空数组）。
   * 不传 = 用内置默认词表。
   */
  forbiddenTerms?: readonly RecipeForbiddenRule[]
  /** 是否显示红线标记；显式 `false` 时不出红线条目（与「不标红」同口径） */
  showComplianceHints?: boolean
}

/**
 * 空词表刻意做成**模块级常量**而不是每次渲染写 `[]`：
 * 数组字面量每次都是新引用，会把下游依赖它的 `useMemo` 全部打穿。
 */
const EMPTY_TERMS: readonly RecipeForbiddenRule[] = []

/**
 * 折算出「界面上真正生效」的红线词表（总开关的语义收口，面板与弹窗共用一份）。
 *
 * - 总开关**不显式等于 `true`** ⇒ 空数组（不判定、不标红、不出条目）；
 * - 否则用传入的词表，不传 = 内置默认。
 *
 * ⚠️ 刻意**不做归一化**（不调 `resolveEnabledRecipeForbiddenTerms`）：界面上的词表带着
 * 用户正在输入的中间态（点「加一条」留下的空词、只敲了一半的例外），归一化会把这些吃掉，
 * 表现为「打字打着字内容消失」。生成链路拿的是设置里的成品，那边才归一化。
 */
export function resolveRecipeDisplayTerms(
  complianceEnabled: boolean | undefined,
  terms: readonly RecipeForbiddenRule[] | undefined,
): readonly RecipeForbiddenRule[] {
  if (complianceEnabled !== true) return EMPTY_TERMS
  return terms ?? CAMPAIGN_RECIPE_FORBIDDEN_RULES
}

// ---------------------------------------------------------------------------
// 位置文案
// ---------------------------------------------------------------------------

/** 落点的人话位置说明。没传维度名时退化成下标，不留空。 */
export function describeProblemLocation(
  target: RecipeProblemTarget,
  dimensionName?: string,
  optionIndex?: number,
): string {
  switch (target.kind) {
    case 'rawText':
      return '配方卡原文 · 录入框'
    case 'body':
      return '提示词骨架'
    case 'dimensions':
      return '维度池'
    case 'dimension':
      return dimensionName
        ? `维度池 · 第 ${target.index + 1} 个（${dimensionName}）`
        : `维度池 · 第 ${target.index + 1} 个`
    case 'option':
      return `维度池 · 「${dimensionName ?? `第 ${target.dimensionIndex + 1} 个维度`}」的第 ${
        (optionIndex ?? target.optionIndex) + 1
      } 个值`
    case 'terms':
      return '合规红线词表'
    case 'term':
      return `合规红线词表 · 第 ${target.index + 1} 条`
    case 'name':
      return 'SOP 名称 · 左侧字段区'
    case 'description':
      return 'SOP 说明 · 左侧字段区'
  }
}

// ---------------------------------------------------------------------------
// 原文告警 → 具体建议
// ---------------------------------------------------------------------------

/**
 * 兜底建议：认不出具体类型时也要给一句能照做的话。
 *
 * 为什么不用「请检查」：用户拿着「请检查」没法行动；而这句至少告诉他
 * 「这是排版/键名问题 + 去哪儿改 + 改完要重新解析」。
 */
const RAW_TEXT_FALLBACK_ADVISE = '多半是排版或键名问题：回到原文框，对照下面的格式示例改一处，再点「解析」。'

/**
 * 原文告警的「怎么改」规则表。
 *
 * ⚠️ 这里做的是**文案 → 建议**的适配，用 `includes` 匹配而不是精确等于：
 * 生产这些文案的地方（`campaignRecipeImport.ts` / `lib/variablePrompt.ts`）不该被本模块绑住。
 * 代价是文案一改适配就失效 —— 所以 `campaignRecipeProblems.test.ts` 用**真实文案**逐条钉住
 * （改了生产处文案，这里立刻红）。
 */
const RAW_TEXT_ADVISE_RULES: Array<{ needle: string; advise: string }> = [
  { needle: '必须单独占一行', advise: '把「可变项：」单独放一行，它后面不要再跟内容，变量定义从下一行开始。' },
  { needle: '前缺少提示词正文', advise: '提示词正文要写在「可变项：」之前，中间空一行。' },
  { needle: '缺少变量名', advise: '那一行要写成「{{变量名}}：值1 / 值2」，行首的变量名不能少。' },
  { needle: '重复定义', advise: '同一个变量名只留一处定义，删掉重复的那条。' },
  { needle: '没有可用选项', advise: '在变量名后面用 / 分隔写上可选值，例如：{{风格}}：水彩 / 油画。' },
  { needle: '没有可用的变量定义', advise: '「可变项：」下面至少写一条「{{变量名}}：值1 / 值2」。' },
  {
    needle: '正文中的变量未定义',
    advise: '名字对不上：把正文里的变量名改成「可变项」里写过的名字，或在「可变项」里补上它。',
  },
  { needle: '正文未使用', advise: '这些变量在正文里没出现，本次不生效；要用就在正文里写上 {{变量名}}。' },
  {
    needle: '正文没有使用',
    advise: '正文里至少用一次「可变项」里定义的变量，例如写上 {{变量名}}。',
  },
]

/** 解析失败 / 原文告警 → 一句能照着做的建议。 */
export function adviseForRawText(message: string): string {
  const rule = RAW_TEXT_ADVISE_RULES.find((item) => message.includes(item.needle))
  return rule ? rule.advise : RAW_TEXT_FALLBACK_ADVISE
}

/** 解析失败原因 → 一句能照着做的建议（失败文案来自解析器，只做适配）。 */
export function adviseForParseFailure(error: string): string {
  if (error.includes('骨架'))
    return '确认模板那一行的键名写成 template: 或 body:；也可以让原文直接以骨架行开头（例如 {M}, {S1}）。'
  if (error.includes('维度池')) return '补一段 pools:（键是槽名、值是列表）或 master: 列表，再重新解析。'
  if (error.includes('变量定义')) return '在「可变项：」下面按 {{变量名}}：值1 / 值2 的格式写定义。'
  if (error.includes('正文')) return '把提示词正文写在「可变项：」之前，中间空一行。'
  return '回到原文框，对照下面的格式示例改一处，再点「解析」。'
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

/** 取骨架里某个占位符第一次出现的行号（1 起）；找不到返回 `undefined`。 */
function lineOfPlaceholder(body: string, name: string): number | undefined {
  const lines = body.split(/\r?\n/u)
  const index = lines.findIndex((line) => line.includes(`{${name}}`) || line.includes(`{{${name}}}`))
  return index >= 0 ? index + 1 : undefined
}

/** 取某段文字第一次出现的行号（1 起）；找不到返回 `undefined`。 */
function lineOfText(body: string, text: string): number | undefined {
  const lines = body.split(/\r?\n/u)
  const index = lines.findIndex((line) => line.includes(text))
  return index >= 0 ? index + 1 : undefined
}

/** 骨架里用到的占位符名（两种花括号都认，去重保序）。 */
function placeholdersOf(body: string): string[] {
  const names: string[] = []
  const push = (raw: string) => {
    const name = raw.trim()
    if (name && !names.includes(name)) names.push(name)
  }
  for (const match of body.matchAll(/\{\{\s*([^{}\r\n]+?)\s*\}\}/gu)) push(match[1])
  const withoutDouble = body.replace(/\{\{\s*[^{}\r\n]+?\s*\}\}/gu, '\u0000')
  for (const match of withoutDouble.matchAll(/\{\s*([^{}\r\n]+?)\s*\}/gu)) push(match[1])
  return names
}

/** 「解析失败 / 结构 / 原文」这三组问题（红线单独一组，见 `buildRecipeProblems`）。 */
function buildRecipeGroupProblems(input: RecipeProblemsInput): RecipeProblem[] {
  const { parsed, config } = input
  const problems: RecipeProblem[] = []
  const body = config.body ?? ''
  const dimensions = config.dimensions ?? []
  const hasConfigContent = body.trim().length > 0 || dimensions.length > 0

  // ---- 1. 解析失败：先说这一条（config 为空时不再补结构问题，否则同一件事说两遍） ----
  if (parsed && !parsed.ok) {
    const error = parsed.error || '解析失败，请检查原文格式后重试。'
    problems.push({
      id: 'parse-failed',
      group: 'recipe',
      level: 'error',
      title: '这份原文没解析出配方卡',
      location: describeProblemLocation({ kind: 'rawText' }),
      target: { kind: 'rawText' },
      advise: `${error} ${adviseForParseFailure(error)}`,
      actions: [
        { kind: 'locate', label: '回到原文框', target: { kind: 'rawText' } },
        { kind: 'reparse', label: '重新解析' },
      ],
    })
    if (!hasConfigContent) return problems
  } else if (input.localParseError?.trim()) {
    // 解析本身没失败、但转换不出可用配置（维度全被过滤掉）—— 报错只在面板的本地 state 里，
    // 上面那条覆盖不到，单独接住，否则这条提示会被这次改版吞掉。
    problems.push({
      id: 'parse-convert-failed',
      group: 'recipe',
      level: 'error',
      title: '解析出来的内容还不足以生成',
      location: describeProblemLocation({ kind: 'rawText' }),
      target: { kind: 'rawText' },
      advise: input.localParseError.trim(),
      actions: [{ kind: 'locate', label: '回到原文框', target: { kind: 'rawText' } }],
    })
  }

  // 没解析过、配置也空：这不是「有问题」，是「还没填」 —— 面板自己有「待解析」态
  if (!parsed && !hasConfigContent) return problems

  const missingPools = new Set((parsed?.missingPools ?? []).map((name) => name.trim()))

  // ---- 2. 骨架 ----
  if (!body.trim()) {
    problems.push({
      id: 'structure-body-empty',
      group: 'recipe',
      level: 'error',
      title: '还没有提示词骨架',
      location: describeProblemLocation({ kind: 'body' }),
      target: { kind: 'body' },
      advise:
        '骨架就是最终提示词的模板，用 {维度名} 占位。可以直接在骨架框里写，也可以回到原文框粘一份配方卡再点「解析」。',
      actions: [
        { kind: 'locate', label: '去写骨架', target: { kind: 'body' } },
        { kind: 'locate', label: '回到原文框', target: { kind: 'rawText' } },
      ],
    })
  }

  // ---- 3. 维度：没维度 / 无名 / 重名 / 没候选值 ----
  if (dimensions.length === 0) {
    problems.push({
      id: 'structure-no-dimension',
      group: 'recipe',
      level: 'error',
      title: '一个维度都没有，引擎没法采样',
      location: describeProblemLocation({ kind: 'dimensions' }),
      target: { kind: 'dimensions' },
      advise: '在维度池点「加维度」手写一个，或回到原文框粘一段 pools: / master: 让解析器帮你补。',
      actions: [
        { kind: 'add-dimension', label: '加维度' },
        { kind: 'locate', label: '回到原文框', target: { kind: 'rawText' } },
      ],
    })
  }

  const seenNames = new Set<string>()
  dimensions.forEach((dimension, index) => {
    const name = (dimension.name ?? '').trim()
    const options = (dimension.options ?? []).filter((option) => option.trim())
    const target: RecipeProblemTarget = { kind: 'dimension', index }

    if (!name) {
      problems.push({
        id: `structure-dimension-nameless-${index}`,
        group: 'recipe',
        level: 'error',
        title: `第 ${index + 1} 个维度还没起名字`,
        location: describeProblemLocation(target),
        target,
        advise: '维度名要与骨架里的 {维度名} 一致，填上名字它才会参与出词。',
        actions: [{ kind: 'locate', label: '定位到这个维度', target }],
      })
      return
    }

    if (seenNames.has(name)) {
      problems.push({
        id: `structure-dimension-duplicate-${index}`,
        group: 'recipe',
        level: 'error',
        title: `维度「${name}」重复定义了`,
        location: describeProblemLocation(target, name),
        target,
        advise: '引擎按名字取值，同名的只有第一个生效。删掉后面这个，或者给它改个名字并在骨架里同步改。',
        actions: [
          { kind: 'remove-dimension', label: '删掉这个重复的', index },
          { kind: 'locate', label: '定位到这个维度', target },
        ],
      })
      return
    }
    seenNames.add(name)

    if (options.length === 0) {
      // ⚠️ missingPools 与「维度没有候选值」是**同一件事**：解析时已经把缺失的槽补成空维度了。
      // 合并成一条，标题按「骨架引用的」与否区分 —— 不合并就会出现两处各说一次（旧版就是这样）。
      const fromSkeleton = missingPools.has(name)
      const line = fromSkeleton ? lineOfPlaceholder(body, name) : undefined
      problems.push({
        id: `structure-dimension-empty-${index}`,
        group: 'recipe',
        level: 'error',
        title: fromSkeleton ? `骨架里的 {${name}} 还没有候选值` : `维度「${name}」还没有候选值`,
        location: line
          ? `${describeProblemLocation(target, name)} · 骨架第 ${line} 行引用了它`
          : describeProblemLocation(target, name),
        target,
        advise: fromSkeleton
          ? `解析时已经自动补了一个叫「${name}」的空维度（骨架里 {${name}} 引用了它），填 1 个值就能用；不需要这个槽，就把它从骨架里删掉。`
          : '至少填 1 个值，否则组合空间是 0、引擎会拒绝生成这张卡。',
        actions: fromSkeleton
          ? [
              { kind: 'locate', label: '去填值', target },
              { kind: 'remove-placeholder', label: `从骨架里删掉 {${name}}`, name },
              { kind: 'remove-dimension', label: '删掉这个维度', index },
            ]
          : [
              { kind: 'locate', label: '去填值', target },
              { kind: 'remove-dimension', label: '删掉这个维度', index },
            ],
      })
    }
  })

  // ---- 4. 维度池规模：空维度会让组合空间归零，这里不重复报（上面每条已单独报） ----

  // ---- 5. 骨架引用了、但维度池里没有被报告的占位符 ----
  // 正常路径下 finalize 已经把缺失槽补成空维度（上面报过），但「从库里打开的老卡 + 手改了骨架」
  // 不会有解析结果来补 —— 这条兜住那种情况。
  const reportedPlaceholderNames = new Set<string>()
  for (const name of placeholdersOf(body)) {
    if (seenNames.has(name)) continue
    reportedPlaceholderNames.add(name)
    const line = lineOfPlaceholder(body, name)
    problems.push({
      id: `structure-placeholder-missing-${name}`,
      group: 'recipe',
      level: 'error',
      title: `骨架里的 {${name}} 找不到对应维度`,
      location: line ? `提示词骨架 · 第 ${line} 行` : describeProblemLocation({ kind: 'body' }),
      target: { kind: 'body' },
      advise: '两条路选一条：在维度池补一个叫这个名字的维度并填值；或者把骨架里的这个占位符删掉。',
      actions: [
        { kind: 'add-dimension', label: `补一个「${name}」维度（先建后改名）` },
        { kind: 'remove-placeholder', label: `从骨架里删掉 {${name}}`, name },
        { kind: 'locate', label: '定位到骨架', target: { kind: 'body' } },
      ],
    })
  }

  // ---- 5b. 解析时报告过的「模板引用了未定义的占位符」，但当前配置里根本没有这个维度 ----
  // 正常路径下 finalize 会给每个缺失槽补一个空维度（于是上面第 3 段已经报过），
  // 所以走到这里说明「这份配置不是这次解析的结果」（用户改了骨架 / 换了卡）。
  // 不补这一段的话，解析器读到的那条信息会**静默消失** —— 旧版这里是会报出来的。
  for (const name of parsed?.missingPools ?? []) {
    const trimmed = name.trim()
    if (!trimmed || seenNames.has(trimmed) || reportedPlaceholderNames.has(trimmed)) continue
    reportedPlaceholderNames.add(trimmed)
    problems.push({
      id: `parse-missing-pool-${trimmed}`,
      group: 'recipe',
      level: 'error',
      title: `解析时模板引用了 {${trimmed}}，但没有找到它的候选池`,
      location: describeProblemLocation({ kind: 'body' }),
      target: { kind: 'body' },
      advise: '不补候选值，这个占位符会原样留在提示词里。要么在维度池补一个同名维度并填值，要么把骨架里的它删掉。',
      actions: [
        { kind: 'add-dimension', label: `补一个「${trimmed}」维度（先建后改名）` },
        { kind: 'remove-placeholder', label: `从骨架里删掉 {${trimmed}}`, name: trimmed },
        { kind: 'locate', label: '定位到骨架', target: { kind: 'body' } },
      ],
    })
  }

  // ---- 6. 骨架完全没用维度 / 某个维度没被骨架引用（能生成，但白占地方） ----
  const usedNames = new Set(placeholdersOf(body))
  const namedDimensions = dimensions.filter((dimension) => (dimension.name ?? '').trim())
  if (!body.trim() && namedDimensions.length > 0) {
    // 骨架整个是空的 ⇒「还没有提示词骨架」那条已经说过了，
    // 这里不要再逐个维度报「没被引用」（每个维度都"没被用到"是必然的，纯噪音）。
  } else if (usedNames.size === 0 && namedDimensions.length > 0) {
    // 一条顶 N 条：骨架里一个占位符都没有时，逐个维度报「没被引用」只会刷屏，
    // 而病根是同一个 —— 骨架里没写占位符。
    const example = namedDimensions[0].name.trim()
    problems.push({
      id: 'structure-body-no-placeholder',
      group: 'recipe',
      level: 'warn',
      title: '骨架里没有用到任何维度',
      location: describeProblemLocation({ kind: 'body' }),
      target: { kind: 'body' },
      advise: `骨架里写上占位符（例如 {${example}}）才会按维度出词；现在每条生成出来都是同一句。`,
      actions: [{ kind: 'locate', label: '去写骨架', target: { kind: 'body' } }],
    })
  } else {
    dimensions.forEach((dimension, index) => {
      const name = (dimension.name ?? '').trim()
      if (!name || !seenNames.has(name)) return
      if (usedNames.has(name)) return
      const target: RecipeProblemTarget = { kind: 'dimension', index }
      problems.push({
        id: `structure-dimension-unused-${index}`,
        group: 'recipe',
        level: 'warn',
        title: `维度「${name}」没有被骨架用到`,
        location: describeProblemLocation(target, name),
        target,
        advise: '它不参与出词（签名里仍会记一笔，用于跨批次去重）。要么在骨架里写上占位符，要么把维度删掉。',
        actions: [
          { kind: 'insert-placeholder', label: `在骨架末尾加上 {${name}}`, name },
          { kind: 'remove-dimension', label: '删掉这个维度', index },
          { kind: 'locate', label: '定位到这个维度', target },
        ],
      })
    })
  }

  // ---- 7. 解析告警（缺名称 / 变量提示词格式问题…）
  // 已经由上面「结构」那段覆盖的告警要跳过，否则同一件事说两遍。
  const SKIP_WARNING_NEEDLES = ['未识别到任何维度池', '未识别到配方名称', '以下维度没有候选值']
  const seenWarnings = new Set<string>()
  ;(parsed?.warnings ?? []).forEach((warning, index) => {
    const text = warning.trim()
    if (!text || seenWarnings.has(text)) return
    if (SKIP_WARNING_NEEDLES.some((needle) => text.includes(needle))) return
    seenWarnings.add(text)
    problems.push({
      id: `parse-warning-${index}`,
      group: 'recipe',
      level: 'warn',
      title: text,
      location: describeProblemLocation({ kind: 'rawText' }),
      target: { kind: 'rawText' },
      advise: adviseForRawText(text),
      actions: [{ kind: 'locate', label: '定位到原文框', target: { kind: 'rawText' } }],
    })
  })

  if (parsed && !parsed.name.trim()) {
    problems.push({
      id: 'parse-name-missing',
      group: 'recipe',
      level: 'warn',
      title: '这份配方卡还没有名字',
      location: describeProblemLocation({ kind: 'name' }),
      target: { kind: 'name' },
      advise: '解析器没从原文里读到名称，到左侧「名称」里填一个就行 —— 这一步不影响生成。',
      actions: [{ kind: 'locate', label: '去填名称', target: { kind: 'name' } }],
    })
  }

  // ---- 8. 面板级上下文：原文改了但没重新解析 ----
  if (input.rawChangedAfterParse) {
    problems.push({
      id: 'raw-changed',
      group: 'recipe',
      level: 'warn',
      title: '录入框里的原文已改动',
      location: describeProblemLocation({ kind: 'rawText' }),
      target: { kind: 'rawText' },
      advise: '下面显示的骨架与维度是上一次解析的结果。改完原文要点「解析」才会更新。',
      actions: [
        { kind: 'reparse', label: '重新解析' },
        { kind: 'locate', label: '回到原文框', target: { kind: 'rawText' } },
      ],
    })
  }

  return problems
}

/** 红线命中 → 问题（沿用既有的「加白 / 剔除」实现，这里只把它们变成可定位的条目）。 */
function buildRedlineProblems(input: RecipeProblemsInput): RecipeProblem[] {
  if (input.showComplianceHints === false) return [] // 关掉「显示红线标记」⇒ 不出红线条目（判定照旧）
  const terms = input.forbiddenTerms ?? CAMPAIGN_RECIPE_FORBIDDEN_RULES
  if (terms.length === 0) return [] // 总开关关闭时调用方传空数组 ⇒ 不判定（与生成链路同口径）

  const config = input.config
  const problems: RecipeProblem[] = []

  const body = config.body ?? ''
  const bodyHits = findCampaignRecipeViolations(body, terms)
  if (bodyHits.length > 0) {
    // 行号按**命中的那个词**算，不是按占位符算 —— 用户要的是「哪一行的文案撞上了」
    const line = lineOfText(body, bodyHits[0]) ?? 1
    problems.push({
      id: 'redline-body',
      group: 'redline',
      level: 'warn',
      title: `骨架命中红线「${bodyHits.join('、')}」`,
      location: `提示词骨架 · 第 ${line} 行`,
      target: { kind: 'body' },
      advise:
        '骨架是你手写的文案，命中只提示、不中断生成。子串匹配很容易误伤（比如「军」撞「军绿色」）—— 觉得是误判就整词加白，可随时恢复。',
      actions: [
        { kind: 'whitelist-terms', label: '这不是红线，加白', terms: bodyHits },
        { kind: 'locate', label: '定位到骨架', target: { kind: 'body' } },
      ],
    })
  }

  ;(config.dimensions ?? []).forEach((dimension, dimensionIndex) => {
    ;(dimension.options ?? []).forEach((option, optionIndex) => {
      const hit = findCampaignRecipeViolations(option, terms)
      if (hit.length === 0) return
      const target: RecipeProblemTarget = { kind: 'option', dimensionIndex, optionIndex }
      problems.push({
        id: `redline-option-${dimensionIndex}-${optionIndex}`,
        group: 'redline',
        level: 'warn',
        title: `候选值「${option}」命中红线「${hit.join('、')}」`,
        location: describeProblemLocation(target, (dimension.name ?? '').trim(), optionIndex),
        target,
        advise: '这个值在生成前会被自动剔除。误判就整词加白；确实违规就剔掉这个值。',
        actions: [
          { kind: 'whitelist-terms', label: '这不是红线，加白', terms: hit },
          { kind: 'remove-option', label: '确认违规，剔除', dimensionIndex, optionIndex },
          { kind: 'locate', label: '定位到这个值', target },
        ],
      })
    })
  })

  return problems
}

/**
 * 构建问题清单。
 *
 * 排序：先「必须先处理」（error），再「要留意」（warn），红线整组放最后
 * —— 红线只提示不中断生成，不该抢在「这张卡生成不出来」前面。
 */
export function buildRecipeProblems(input: RecipeProblemsInput): RecipeProblem[] {
  const recipe = buildRecipeGroupProblems(input)
  const redline = buildRedlineProblems(input)
  return [
    ...recipe.filter((problem) => problem.level === 'error'),
    ...recipe.filter((problem) => problem.level === 'warn'),
    ...redline,
  ]
}

/** 汇总：总数 + 其中「必须先处理」的条数（界面上报的**唯一**口径）。 */
export function summarizeRecipeProblems(problems: readonly RecipeProblem[]): {
  total: number
  blocking: number
} {
  return {
    total: problems.length,
    blocking: problems.filter((problem) => problem.level === 'error').length,
  }
}

/** 红线组的说明文案（弹窗里组头下面那句）；红线条目为 0 时调用方不渲染。 */
export const REDLINE_GROUP_SUMMARY = '候选值命中会在生成前被剔除。判为误判：「加白」= 整个词不再判（可随时恢复）。'

// ---------------------------------------------------------------------------
// 骨架文本的小编辑（问题清单上的「在骨架末尾加上 {X}」/「从骨架里删掉 {X}」两个动作）
// ---------------------------------------------------------------------------

/** 把名字转成可以放进正则的字面量（维度名可能带 `.` `(` 这类符号）。 */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * 在骨架末尾补一个占位符。
 *
 * 末尾已经有标点就不再补分隔符 —— 补成 `{M},，{S1}` 会让人以为文件坏了。
 */
export function appendPlaceholderToBody(body: string, name: string): string {
  const trimmed = body.replace(/\s+$/u, '')
  if (!trimmed) return `{${name}}`
  return /[,，、:：;；]$/u.test(trimmed) ? `${trimmed} {${name}}` : `${trimmed}，{${name}}`
}

/**
 * 从骨架里删掉某个占位符（`{{名}}` 与 `{名}` 两种写法都删）。
 *
 * 顺带把「因为它被拿掉而空掉的分隔符」收干净（`, ,` → `,`、行首尾的逗号去掉），
 * 但**只动受影响的那些行**：整篇重排会把用户自己的排版风格改掉，
 * 那是「帮他修一处」变成了「顺手重写他的东西」。
 */
export function removePlaceholderFromBody(body: string, name: string): string {
  const escaped = escapeForRegExp(name)
  const without = body
    .replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'gu'), '')
    .replace(new RegExp(`\\{\\s*${escaped}\\s*\\}`, 'gu'), '')

  const before = body.split(/\r?\n/u)
  const cleaned = without.split(/\r?\n/u).map((line) => {
    const next = line
      .replace(/[ \t]{2,}/gu, ' ')
      // 收掉「因为占位符被拿掉而空出来」的分隔符。**沿用原文用的那个分隔符**
      // （半角逗号就还给半角逗号）—— 一律换成全角逗号等于顺手改了用户的排版风格。
      .replace(/([,，、]\s*){2,}/gu, (matched) => `${matched.trim()[0]} `)
      .replace(/^[\s,，、]+/u, '')
      .replace(/[\s,，、]+$/u, '')
      .trim()
    return next
  })

  // 只丢掉「本来有内容、删完变空」的那些行；原文里就空着的行不动它
  return cleaned
    .filter((line, index) => line !== '' || (before[index] ?? '').trim() === '')
    .join('\n')
    .trim()
}
