/**
 * 「配方卡详情」弹窗 —— 解析结果的**唯一展示处，也是配方卡内容的编辑处**。
 *
 * 形态（2026-09-20 杰哥定）：外面（`SopCampaignRecipePanel`）只留「配方卡原文」录入 +
 * 解析按钮，其余**全部**收进这里：原资产信息、提示词骨架、维度池、采样预览、合规红线词表。
 * 所以这个弹窗不是「只读详情」，而是「解析结果的查看与编辑面」——
 * 面板上已不再有任何骨架 / 维度的编辑入口。
 *
 * 为什么收进弹窗：外面那块版面同时被「录入」和「结果」两件事占着，而解析完一次之后
 * 用户真正反复操作的是骨架与维度池。留在原地下方会让面板越滚越长，录入区反而被挤没了。
 * 收进来之后职责单一：**外面负责「把原文变成配置」，弹窗负责「把配置看清并改对」**。
 *
 * 四条口径：
 * - **失败也开、没解析过也开**：配方卡可能是从库里打开的老资产，用户这次根本没粘原文，
 *   但骨架与维度仍要能看能改 ⇒ 入口的可用条件是「有解析结果**或**有已保存配置」；
 *   弹窗里跟解析有关的区块（状态条 / 原资产信息 / 缺失池 / 告警）在没有解析结果时整块不渲染；
 * - **不带「应用」按钮**：编辑即时写回草稿（与面板原有行为一致），
 *   加一个「应用」会让「改了没点应用就关掉」变成静默丢失；
 * - **数字只说一次**：维度数 / 候选值数 / 组合空间只出现在维度池标题行（实时值），
 *   顶部状态条只报「成没成、从哪来、有几条待注意」——
 *   上一版两处都报数字，被杰哥指出是重复（见 BACKLOG TB-054）。
 */

import { useMemo, useState } from 'react'
import { Badge, Button, Dialog, IconButton, TextArea, cx } from '../../design-system'
import { AlertTriangleIcon, EyeIcon, FileTextIcon, PlusIcon, SparklesIcon, TrashIcon } from '../../design-system/icons'
import {
  CAMPAIGN_RECIPE_FORBIDDEN_RULES,
  findCampaignRecipeViolations,
  renderCampaignRecipePrompts,
  validateCampaignRecipeConfig,
  type CampaignRecipeDimension,
} from './campaignRecipe'
import type { ParsedCampaignRecipe } from './campaignRecipeImport'
import type { SopCampaignRecipeConfig } from './types'
import type { RecipeForbiddenRule } from '../../types'

/** 一键铺开的预览条数；只用于看效果，不影响实际生成数量。 */
const RECIPE_PREVIEW_COUNT = 6

/**
 * 总开关关闭时用的空词表（TB-147）。
 *
 * 刻意做成**模块级常量**而不是每次渲染写 `[]`：数组字面量每次都是新引用，
 * 会把下面依赖它的 `useMemo` 全部打穿（每渲染一次就重算一遍判定）。
 */
const NO_TERMS: readonly RecipeForbiddenRule[] = []

export interface SopCampaignRecipeParseResultDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 解析结果；`null` = 这次没解析过（编辑已保存的配方卡），此时只渲染可编辑部分 */
  parsed: ParsedCampaignRecipe | null
  /** 当前配置（**可编辑**：骨架与维度池直接写回这里） */
  config: SopCampaignRecipeConfig
  onChange: (config: SopCampaignRecipeConfig) => void
  /**
   * 主控槽（差异优先保证这些槽取值不同），**由面板算好传进来**。
   *
   * 为什么不让弹窗自己算：算它的 `resolveEffectiveDominantSlots` 目前只存在于另一条写线的
   * 未提交改动里。这里收成 prop，两版都能编译，且权重口径的唯一实现仍在引擎模块里。
   */
  dominantSlots?: string[]
  /** 解析出的素材信息，仅用于「主控槽」的来源说明 */
  meta?: { name?: string; desc?: string; dominantSlots?: string[] }
  /**
   * 当前生效的合规红线规则（全局一份，来自 `AppSettings.recipeForbiddenTerms`）。
   * 每条 = 违规词 + 它的**例外词**（TB-145：例外词在判定前会被挖空，见 lib/recipeForbiddenTerms.ts）。
   *
   * 不传 = 内置默认 21 词 —— 于是本弹窗单独使用时也不会「没有红线」。
   * 传 `[]` = 用户把红线全关了（与「没传」**语义不同**，别用长度判断）。
   */
  forbiddenTerms?: readonly RecipeForbiddenRule[]
  /**
   * 修改红线规则（增 / 删 / 改 / 恢复默认都走它）。
   * 不传时词表按只读展示：编辑控件（输入框 / 删除 / 加一条 / 恢复默认）一律不渲染。
   */
  onForbiddenTermsChange?: (terms: RecipeForbiddenRule[]) => void
  /**
   * 红线**总开关**（TB-147）：**默认关闭** —— 只有 `true` 才判定 / 标红 / 显示复核区。
   *
   * 不传 = 关闭（与设置的缺省一致）。刻意**不给"缺省即开"**的兜底：
   * 那样任何一处忘了传就会把功能又打开，而这是个「默认该关」的能力。
   */
  complianceEnabled?: boolean
  /** 切换总开关；不传时开关不渲染（只读场景）。 */
  onComplianceEnabledChange?: (value: boolean) => void
  /**
   * 是否显示红线标记（候选值标红 / 骨架命中提示 / 复核区）。
   * 不传 = 显示。**它只管显示**，判定与生成前剔除照旧（TB-144）。
   */
  showComplianceHints?: boolean
  /** 切换上面的显示开关；不传时开关不渲染（只读场景）。 */
  onShowComplianceHintsChange?: (value: boolean) => void
}

/**
 * 汇总一组维度的规模。入参放宽到「有 options 即可」——
 * 这样**解析结果的维度**与**可编辑配置的维度**共用同一份口径，不会出现两个数字打架。
 */
export function summarizeParsedRecipe(
  dimensions: Array<{ options?: string[]; englishByOption?: Record<string, string> }>,
) {
  let optionCount = 0
  let englishCount = 0
  let combinationCount = dimensions.length > 0 ? 1 : 0
  for (const dimension of dimensions) {
    const usable = (dimension.options ?? []).filter((option) => option.trim()).length
    optionCount += usable
    // 空维度会让组合空间归零（引擎也会拒绝生成），保留 0 比「乘出来还是 1」诚实
    combinationCount *= Math.max(0, usable)
    englishCount += Object.keys(dimension.englishByOption ?? {}).length
  }
  return { optionCount, combinationCount, englishCount }
}

/**
 * 解析结果里「需要用户留意」的条数 = 告警 + 缺失池。
 *
 * 给面板那个入口按钮用：**外面不铺细节，只报「有几条要留意」**，
 * 让人知道「弹窗里有没有事要看」，但不把内容再抄一遍到界面上。
 */
export function countParsedRecipeAttention(parsed: ParsedCampaignRecipe | null): number {
  if (!parsed) return 0
  return parsed.warnings.length + parsed.missingPools.length
}

const SOURCE_LABEL: Record<ParsedCampaignRecipe['source'], string> = {
  json: 'JSON',
  text: '自由排版',
  'variable-prompt': '一键衍生模板',
}

function blankDimension(): CampaignRecipeDimension {
  return { name: '', options: [''] }
}

/** 抽出骨架里已用到的占位符名称（两种花括号写法都认）。 */
function extractPlaceholders(body: string): string[] {
  const names: string[] = []
  const push = (raw: string) => {
    const name = raw.trim()
    if (name && !names.includes(name)) names.push(name)
  }
  const doubleBrace = /\{\{\s*([^{}\r\n]+?)\s*\}\}/gu
  for (const match of body.matchAll(doubleBrace)) push(match[1])
  const withoutDouble = body.replace(doubleBrace, '\u0000')
  for (const match of withoutDouble.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]{0,15}|[^{}\r\n]{1,12}?)\s*\}/gu))
    push(match[1])
  return names
}

/** 一行「标签：值」；值缺失时显示占位词，体现「解析器只填能确定的字段」 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">{label}</span>
      <span className="min-w-0 break-words text-xs text-ds-text dark:text-ds-text">
        {value.trim() ? value : <span className="text-ds-muted dark:text-ds-muted">未识别</span>}
      </span>
    </div>
  )
}

export default function SopCampaignRecipeParseResultDialog({
  open,
  onOpenChange,
  parsed,
  config,
  onChange,
  dominantSlots,
  meta,
  forbiddenTerms,
  onForbiddenTermsChange,
  complianceEnabled,
  onComplianceEnabledChange,
  showComplianceHints,
  onShowComplianceHintsChange,
}: SopCampaignRecipeParseResultDialogProps) {
  const close = () => onOpenChange(false)
  /** 红线词表区默认展开（`<details>` 的 open 必须受控，否则用户收起后一旦重渲染就被弹回展开）。 */
  const [termsOpen, setTermsOpen] = useState(true)
  const body = config.body ?? ''
  // config 每次编辑都是新对象，直接进 useMemo 依赖会让派生计算每次重算；拆出稳定引用
  const dimensions = useMemo(() => config.dimensions ?? [], [config.dimensions])
  /**
   * 当前生效词表。不传 → 默认 21 词。
   * ⚠️ 不能写成 `forbiddenTerms && forbiddenTerms.length ? forbiddenTerms : 默认` ——
   * 空数组是「用户把红线全关了」，那样写会让默认词表又冒回来（TB-142）。
   */
  const terms = forbiddenTerms ?? CAMPAIGN_RECIPE_FORBIDDEN_RULES
  const canEditTerms = typeof onForbiddenTermsChange === 'function'
  /**
   * 例外输入框的「正在输入」原文（TB-145）。
   *
   * 为什么需要它：例外是「顿号分隔的一串」，写回设置时要 split 成数组，
   * 而受控输入直接回显 `allow.join('、')` 会把用户刚敲下的尾随顿号吃掉 ——
   * 表现为「输完一个词想接着输第二个，顿号打不出来」。所以编辑期间保留原始串，
   * 失焦后再回显规整结果。
   */
  const [allowDraft, setAllowDraft] = useState<{ index: number; text: string } | null>(null)
  /**
   * 已加白的条数（TB-146）。标题行必须报出来 —— 加白后词仍留在表里却不生效，
   * 不说明的话用户会以为「表里有这个词、怎么不拦了」。
   */
  const whitelistedCount = terms.filter((item) => item.disabled).length
  /**
   * 红线**总开关**（TB-147）：**默认关闭**（与设置缺省一致，不传 = 关）。
   * 与 `showComplianceHints` 是两层：这个决定「判不判」，那个只管「标不标」。
   */
  const complianceOn = complianceEnabled === true
  const canToggleCompliance = typeof onComplianceEnabledChange === 'function'
  /**
   * **判定实际用的**词表：总开关关闭时为空数组 —— 复用「空词表 = 红线全关」的既有语义，
   * 于是标红 / 复核区 / 骨架命中提示**一次全部消失**（不必在三个判定点各包一层 `if`）。
   *
   * ⚠️ 这里**刻意不走** `resolveEnabledRecipeForbiddenTerms`：那个会顺手把词表归一化，
   * 而界面上的词表带着「用户正在输入的中间态」（点「加一条」留下的空词、只敲了一半的例外），
   * 归一化会把这些吃掉 ⇒ 输入框内容凭空消失。生成链路（`storeSopGeneration`）拿的是
   * 设置里的成品，那边才用那个 helper。
   */
  const activeTerms = complianceOn ? terms : NO_TERMS
  /**
   * 词表标题。用模板串拼好而不是散在 JSX 里 —— JSX 的换行缩进会折成空白，
   * 断言与所见文本就未必一致了（TB-146 的测试要按这段文字断言）。
   */
  const termsSummary = `合规红线词表（${terms.length} 项${
    whitelistedCount > 0 ? ` · ${whitelistedCount} 项已加白` : ''
  } · ${complianceOn ? '已启用' : '已关闭'}）`
  /** 红线标记是否显示：关掉只停止标红，判定与生成前剔除照旧（TB-144）。 */
  const showRedlineHints = showComplianceHints ?? true
  const canToggleHints = typeof onShowComplianceHintsChange === 'function'

  const placeholders = useMemo(() => extractPlaceholders(body), [body])
  const errors = useMemo(() => validateCampaignRecipeConfig(config), [config])
  const bodyViolations = useMemo(() => findCampaignRecipeViolations(body, activeTerms), [body, activeTerms])
  const optionViolations = useMemo(
    () =>
      dimensions.flatMap((dimension, dimensionIndex) =>
        (dimension.options ?? []).flatMap((option, optionIndex) => {
          const violations = findCampaignRecipeViolations(option, activeTerms)
          return violations.length > 0 ? [{ dimensionIndex, optionIndex, option, violations }] : []
        }),
      ),
    [dimensions, activeTerms],
  )
  // 骨架命中**不再阻断预览**：生成链路也不再中断（TB-142），预览与真实生成必须同口径。
  const preview = useMemo(() => {
    if (errors.length > 0) return []
    try {
      return renderCampaignRecipePrompts(config, { count: RECIPE_PREVIEW_COUNT, seed: 'preview' })
    } catch {
      return []
    }
  }, [config, errors.length])

  const hasConfigContent = body.trim().length > 0 || dimensions.length > 0
  const summary = summarizeParsedRecipe(dimensions)
  /** 主控槽展示口径：面板传进来的优先，退到解析声明 */
  const displayDominantSlots = dominantSlots ?? parsed?.dominantSlots ?? []
  const unusedDimensions = dimensions.filter(
    (dimension) => dimension.name.trim() && !placeholders.includes(dimension.name),
  )
  const parsedDimensionCount = parsed?.dimensions.length ?? 0

  function updateDimension(index: number, patch: Partial<CampaignRecipeDimension>) {
    onChange({
      ...config,
      dimensions: dimensions.map((dimension, current) => (current === index ? { ...dimension, ...patch } : dimension)),
    })
  }

  function updateOption(dimensionIndex: number, optionIndex: number, value: string) {
    const dimension = dimensions[dimensionIndex]
    updateDimension(dimensionIndex, {
      options: dimension.options.map((option, current) => (current === optionIndex ? value : option)),
    })
  }

  function addDimension() {
    onChange({ ...config, dimensions: [...dimensions, blankDimension()] })
  }

  function removeDimension(index: number) {
    onChange({ ...config, dimensions: dimensions.filter((_, current) => current !== index) })
  }

  function addOption(dimensionIndex: number) {
    const dimension = dimensions[dimensionIndex]
    updateDimension(dimensionIndex, { options: [...dimension.options, ''] })
  }

  function removeOption(dimensionIndex: number, optionIndex: number) {
    const dimension = dimensions[dimensionIndex]
    const next = dimension.options.filter((_, current) => current !== optionIndex)
    updateDimension(dimensionIndex, { options: next.length > 0 ? next : [''] })
  }

  /** 把骨架里出现、但维度池还没有的占位符一键补成空维度，省去手抄维度名。 */
  function syncDimensionsFromBody() {
    const missing = placeholders.filter((name) => !dimensions.some((dimension) => dimension.name === name))
    if (missing.length === 0) return
    onChange({ ...config, dimensions: [...dimensions, ...missing.map((name) => ({ name, options: [''] }))] })
  }

  // ---- 红线词表：增 / 改 / 删 / 恢复默认（改动即时写回设置，全局生效） ----
  // 空串允许暂存在界面状态里（用户点「加一条」时那一格本来就是空的）；
  // 判定侧由 resolveRecipeForbiddenTerms 过滤空串，不会出现「空词命中一切」（见该函数注释）。

  /** 例外输入的解析口径：顿号 / 逗号 / 空白都算分隔符（与判定侧的归一化同口径）。 */
  function parseAllowText(text: string): string[] {
    return text
      .split(/[、,，\s]+/u)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function addTerm() {
    setAllowDraft(null)
    onForbiddenTermsChange?.([...terms, { term: '', allow: [] }])
  }

  function updateTerm(index: number, value: string) {
    onForbiddenTermsChange?.(terms.map((item, current) => (current === index ? { ...item, term: value } : item)))
  }

  /**
   * 改某一行的「例外」。
   *
   * 输入态允许出现空串 / 尾随分隔符（用户还在敲），所以**原文交给 `allowDraft` 保存**、
   * 只把解析结果写回设置；失焦后回显规整后的串。
   */
  function updateTermAllow(index: number, text: string) {
    setAllowDraft({ index, text })
    const allow = parseAllowText(text)
    onForbiddenTermsChange?.(terms.map((item, current) => (current === index ? { ...item, allow } : item)))
  }

  function removeTerm(index: number) {
    setAllowDraft(null)
    onForbiddenTermsChange?.(terms.filter((_, current) => current !== index))
  }

  /** 恢复默认：必须用带例外的 RULES —— 纯词名版本会把内置例外一起丢掉（TB-145）。 */
  function resetTerms() {
    setAllowDraft(null)
    onForbiddenTermsChange?.(CAMPAIGN_RECIPE_FORBIDDEN_RULES.map((item) => ({ ...item, allow: [...item.allow] })))
  }

  /**
   * 切换「加白」（TB-146）。
   *
   * 只动 `disabled` 一个字段 —— **词与它的例外都原样保留**，撤白后立即恢复用途。
   * 这正是它比「删掉这个词」安全的地方：删除是不可逆的（要回来只能「恢复默认」或手打）。
   */
  function toggleTermDisabled(index: number, disabled: boolean) {
    setAllowDraft(null)
    onForbiddenTermsChange?.(terms.map((item, current) => (current === index ? { ...item, disabled } : item)))
  }

  /**
   * 复核动作「这不是红线」：把命中它的词**加白**（整词不再参与判定，可一键恢复）。
   *
   * 落点刻意选**词表**而不是给这个候选值开豁免：误判的根因是那个词太宽（「军」撞「军绿色」），
   * 处置一次全局受益；给单个值开豁免，同一个词换个值还会再撞（TB-144 的口径）。
   *
   * TB-146：这里从「删掉这个词」改成「加白」—— 误判的常见语义是「这个词在我的场景里是正常的」，
   * 而它**会变**（换个方向可能又要拦）。可逆动作更适合做默认，删除留给词表里的 × 。
   */
  function whitelistTerms(words: string[]) {
    setAllowDraft(null)
    const target = new Set(words)
    onForbiddenTermsChange?.(terms.map((item) => (target.has(item.term) ? { ...item, disabled: true } : item)))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="配方卡详情"
      description={
        parsed
          ? '解析结果的唯一查看与编辑处；改动即时写回，无需另外保存。'
          : '当前配方卡配置（这次没有解析原文）；改动即时写回，无需另外保存。'
      }
      footer={
        <Button size="sm" variant="secondary" onClick={close}>
          关闭
        </Button>
      }
    >
      {!parsed && !hasConfigContent ? (
        <p className="text-xs text-ds-muted dark:text-ds-muted">
          还没有内容。请在上方粘贴配方卡原文后点「解析」，或先给这个配方卡加上骨架与维度。
        </p>
      ) : (
        <div className="sop-recipe-panel__body">
          {/* 解析相关区块：只在这次真的解析过时才有东西可报 */}
          {parsed && (
            <>
              {/* 只报「成没成、从哪来、有几条要留意」，数字留给下方维度池标题行说一次 */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={parsed.ok ? 'success' : 'danger'}>{parsed.ok ? '解析成功' : '解析失败'}</Badge>
                <Badge tone="neutral">识别来源：{SOURCE_LABEL[parsed.source]}</Badge>
                {countParsedRecipeAttention(parsed) > 0 && (
                  <Badge tone="warning">{countParsedRecipeAttention(parsed)} 条待注意</Badge>
                )}
              </div>

              {!parsed.ok && (
                <p
                  className="flex items-start gap-1.5 rounded-ds-lg border border-ds-danger/35 bg-ds-danger-subtle px-3 py-2 text-xs text-ds-danger dark:border-ds-danger/40 dark:bg-ds-danger/10 dark:text-ds-danger"
                  role="alert"
                >
                  <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{parsed.error || '解析失败，请检查原文格式后重试。'}</span>
                </p>
              )}

              {/* 原资产声明的东西：它们不进表单，所以只有这里能看到 */}
              <section className="space-y-1 rounded-ds-lg border border-ds-border px-3 py-2 dark:border-ds-border">
                <div className="flex items-center gap-1.5">
                  <SparklesIcon className="h-3.5 w-3.5 text-ds-muted dark:text-ds-muted" />
                  <span className="text-xs font-medium text-ds-text dark:text-ds-text">原资产信息</span>
                </div>
                <Field label="名称" value={parsed.name} />
                <Field label="说明" value={parsed.desc} />
                <Field
                  label="主控槽"
                  value={
                    parsed.dominantSlots.length > 0
                      ? `${parsed.dominantSlots.join('、')}（按当前权重实时推导：${
                          displayDominantSlots.join('、') || '无'
                        }）`
                      : displayDominantSlots.join('、')
                  }
                />
                <Field label="模型" value={parsed.meta.model ?? ''} />
                <Field label="标题槽" value={parsed.meta.headlineSlot ?? ''} />
                {parsed.meta.forbidden && parsed.meta.forbidden.length > 0 && (
                  <Field
                    label="禁用词"
                    value={`${parsed.meta.forbidden.length} 项（本引擎不自动套用）：${parsed.meta.forbidden.join('、')}`}
                  />
                )}
              </section>

              {/* 解析过程中的提醒：缺失池 + 非致命告警 */}
              {parsed.missingPools.length > 0 && (
                <p className="rounded-ds-lg border border-ds-warning/35 bg-ds-warning-subtle px-3 py-2 text-xs text-ds-warning dark:border-ds-warning/40 dark:bg-ds-warning/10 dark:text-ds-warning">
                  模板引用了但候选池缺失的占位符：<strong>{parsed.missingPools.join('、')}</strong>
                  （不补齐引擎会拒绝生成）
                </p>
              )}
              {parsed.warnings.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-ds-muted dark:text-ds-muted">
                  {parsed.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* 维度池标题行：数字只说这一次（实时值），并承载维度级操作 */}
          <div className="sop-recipe-panel__section-head">
            <div className="min-w-0">
              <strong>
                <FileTextIcon className="h-3.5 w-3.5" />
                维度池
              </strong>
              <span>
                {dimensions.length} 个维度 · {summary.optionCount} 个候选值 · 组合空间 {summary.combinationCount} 条
                {summary.combinationCount > 0 && summary.combinationCount < 20 ? '（偏小，建议加候选值）' : ''}
                {summary.englishCount > 0 ? ` · ${summary.englishCount} 个带英文描述（仅用于识别）` : ''}
              </span>
            </div>
            <div className="sop-recipe-panel__section-actions">
              {placeholders.some((name) => !dimensions.some((dimension) => dimension.name === name)) && (
                <Button size="sm" variant="secondary" onClick={syncDimensionsFromBody}>
                  按骨架补齐
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={addDimension}
                leadingIcon={<PlusIcon className="h-3.5 w-3.5" />}
              >
                加维度
              </Button>
            </div>
          </div>

          <TextArea
            label="提示词骨架"
            value={body}
            onChange={(event) => onChange({ ...config, body: event.target.value })}
            placeholder="用 {维度名} 或 {{维度名}} 占位"
            helperText={
              placeholders.length > 0
                ? `已识别占位符：${placeholders.map((name) => `{${name}}`).join('、')}`
                : '尚未识别到占位符，引擎会拒绝生成'
            }
            containerClassName="sop-recipe-panel__body-field"
            className="sop-recipe-panel__body-input"
          />

          {showRedlineHints && bodyViolations.length > 0 && (
            <p className="sop-recipe-panel__warning" role="alert">
              骨架命中红线「{bodyViolations.join('、')}」，已列入下方「红线复核」。
            </p>
          )}

          {displayDominantSlots.length > 0 && (
            <p className="sop-recipe-panel__hint">
              主控槽（差异优先保证这些槽的取值不同）：{displayDominantSlots.join('、')}
              {meta?.dominantSlots && meta.dominantSlots.length > 0
                ? `（解析结果声明为：${meta.dominantSlots.join('、')}）`
                : ''}
            </p>
          )}

          {unusedDimensions.length > 0 && (
            <p className="sop-recipe-panel__hint">
              维度「{unusedDimensions.map((dimension) => dimension.name).join('、')}」未被骨架引用，
              这些维度不参与实际出词（签名仍会记录，便于历史去重）。
            </p>
          )}

          <div className="sop-recipe-panel__dimensions">
            {dimensions.map((dimension, dimensionIndex) => {
              const isDominant = Boolean(dimension.name.trim() && displayDominantSlots.includes(dimension.name))
              return (
                <article key={dimensionIndex} className="sop-recipe-dimension">
                  <div className="sop-recipe-dimension__head">
                    <input
                      value={dimension.name}
                      placeholder="维度名（与骨架里的 {名称} 对应）"
                      aria-label={`维度 ${dimensionIndex + 1} 名称`}
                      onChange={(event) => updateDimension(dimensionIndex, { name: event.target.value })}
                    />
                    {isDominant && <Badge tone="info">主控</Badge>}
                    {dimension.weight !== undefined && <Badge tone="neutral">权重 {dimension.weight}</Badge>}
                    <span className="sop-recipe-dimension__count">
                      {dimension.options.filter((option) => option.trim()).length} 个值
                    </span>
                    <IconButton
                      size="sm"
                      onClick={() => removeDimension(dimensionIndex)}
                      aria-label={`删除维度 ${dimension.name || dimensionIndex + 1}`}
                      title="删除维度"
                      icon={<TrashIcon className="h-3.5 w-3.5" />}
                    />
                  </div>
                  <div className="sop-recipe-dimension__options">
                    {dimension.options.map((option, optionIndex) => {
                      // ⚠️ 必须把当前词表传进去：漏传会用**内置 21 词**判定，
                      // 于是用户删掉误判词之后，格子照旧标红（"删了还标红"就是这么来的，TB-144 实测）。
                      const hit = showRedlineHints ? findCampaignRecipeViolations(option, activeTerms) : []
                      return (
                        <label
                          key={optionIndex}
                          className={cx('sop-recipe-option', hit.length > 0 && 'sop-recipe-option--blocked')}
                          title={hit.length > 0 ? `命中合规红线：${hit.join('、')}，生成时会被剔除` : undefined}
                        >
                          <input
                            value={option}
                            placeholder="候选值"
                            aria-label={`维度 ${dimension.name || dimensionIndex + 1} 候选值 ${optionIndex + 1}`}
                            onChange={(event) => updateOption(dimensionIndex, optionIndex, event.target.value)}
                          />
                          {hit.length > 0 && <Badge tone="danger">红线</Badge>}
                          <button
                            type="button"
                            className="sop-recipe-option__remove"
                            onClick={() => removeOption(dimensionIndex, optionIndex)}
                            aria-label={`删除候选值 ${option || optionIndex + 1}`}
                            title="删除候选值"
                          >
                            <TrashIcon className="h-3 w-3" />
                          </button>
                        </label>
                      )
                    })}
                    <button
                      type="button"
                      className="sop-recipe-dimension__add"
                      onClick={() => addOption(dimensionIndex)}
                    >
                      <PlusIcon className="h-3 w-3" />
                      加候选值
                    </button>
                  </div>
                </article>
              )
            })}
            {dimensions.length === 0 && (
              <p className="sop-recipe-panel__hint">
                <AlertTriangleIcon className="h-3.5 w-3.5" /> 还没有维度。点上方「加维度」，或回到外面重新解析原文。
              </p>
            )}
          </div>

          {/* 红线复核（TB-144）：命中项一条条摆出来让用户裁决，而不是只标个红、值还被静默丢掉。
              两个动作各自落到**已有的真相源**，不需要另存复核结果：
              「这不是红线」→ 把词加白（红线词表，全局 + 持久 + 可逆）；「确认违规，剔除」→ 删候选值（随这张卡）。
              命中清零后整块消失，不留常驻噪音。 */}
          {showRedlineHints && (bodyViolations.length > 0 || optionViolations.length > 0) && (
            <section
              className="rounded-ds-lg border border-ds-warning/35 bg-ds-warning-subtle px-3 py-2 dark:border-ds-warning/40 dark:bg-ds-warning/10"
              aria-label="红线复核"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <strong className="flex items-center gap-1.5 text-xs font-medium text-ds-text dark:text-ds-text">
                  <AlertTriangleIcon className="h-3.5 w-3.5" />
                  红线复核 · 本次命中 {bodyViolations.length + optionViolations.length} 处
                </strong>
                <span className="text-xs text-ds-muted dark:text-ds-muted">
                  候选值命中会在生成前被剔除。判为误判：「加白」= 整个词不再判（可随时恢复）；
                  只有某个正常搭配被误伤，就到下方词表里给这个词加例外（更精准）。
                </span>
              </div>
              <div className="mt-1.5 grid gap-1">
                {bodyViolations.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-ds-muted dark:text-ds-muted">骨架</span>
                    <span className="min-w-0 flex-1 break-words text-xs text-ds-text dark:text-ds-text">
                      命中「{bodyViolations.join('、')}」
                    </span>
                    {canEditTerms && (
                      <Button size="sm" variant="secondary" onClick={() => whitelistTerms(bodyViolations)}>
                        这不是红线，加白
                      </Button>
                    )}
                  </div>
                )}
                {optionViolations.map((entry) => (
                  <div
                    className="flex flex-wrap items-center gap-2"
                    key={`${entry.dimensionIndex}:${entry.optionIndex}:${entry.option}`}
                  >
                    <span className="text-xs text-ds-muted dark:text-ds-muted">候选值</span>
                    <span className="min-w-0 flex-1 break-words text-xs text-ds-text dark:text-ds-text">
                      「{entry.option}」
                      {dimensions[entry.dimensionIndex]?.name ? `（${dimensions[entry.dimensionIndex].name}）` : ''}
                      命中「{entry.violations.join('、')}」
                    </span>
                    {canEditTerms && (
                      <Button size="sm" variant="secondary" onClick={() => whitelistTerms(entry.violations)}>
                        这不是红线，加白
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => removeOption(entry.dimensionIndex, entry.optionIndex)}
                    >
                      确认违规，剔除
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {errors.length > 0 && <p className="sop-recipe-panel__warning">{errors.join('；')}</p>}

          <div className="sop-recipe-panel__preview">
            <div className="sop-recipe-panel__section-head">
              <div className="min-w-0">
                <strong>
                  <EyeIcon className="h-3.5 w-3.5" />
                  预览
                </strong>
                <span>取前 {RECIPE_PREVIEW_COUNT} 条，按差异最大顺序排列</span>
              </div>
            </div>
            {preview.length > 0 ? (
              <ol className="sop-recipe-preview__list">
                {preview.map((prompt, index) => (
                  <li key={index}>{prompt}</li>
                ))}
              </ol>
            ) : (
              <p className="sop-recipe-panel__hint">
                {errors.length > 0 ? '补齐骨架与维度后即可预览。' : '骨架未引用任何维度，暂不可预览。'}
              </p>
            )}
          </div>

          {/* 红线词表：可编辑（增 / 改 / 删 / 恢复默认）。条目直接写回设置、全局生效。
              默认展开 —— 命中之后要来这里删词，藏在折叠里等于让人多找一步（TB-142 的报障场景）。 */}
          <details
            className="sop-recipe-panel__terms"
            open={termsOpen}
            onToggle={(event) => setTermsOpen(event.currentTarget.open)}
          >
            <summary>
              {termsSummary}
              {bodyViolations.length > 0 ? ' · 本次骨架命中' : ''}
            </summary>
            {/* 总开关（TB-147）：**默认关闭**。关闭时下面整块仍可查看与编辑（先把词配好、
                再打开开关），只是不判定 —— 所以这里特意不把编辑区禁掉。 */}
            {canToggleCompliance && (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-ds-muted dark:text-ds-muted">
                  {complianceOn
                    ? '已启用：命中的地方会标红，生成前会剔除命中的候选值。'
                    : '已关闭：不判定、不标红，生成前也不剔除。下面的词表只是留档。'}
                </span>
                <Button
                  size="sm"
                  variant={complianceOn ? 'primary' : 'secondary'}
                  onClick={() => onComplianceEnabledChange?.(!complianceOn)}
                >
                  {complianceOn ? '合规红线：开' : '合规红线：关'}
                </Button>
              </div>
            )}
            {/* 显示开关（TB-144）：手动关掉这些标记。⚠️ 只关显示，判定与生成前剔除照旧 ——
                想真正不拦某个误判词，用上方复核区的「这不是红线，加白」（TB-146），
                或到下方词表里给那个词配例外（TB-145）。
                总开关关着时不渲染它：没东西可标，留着只是噪音。 */}
            {complianceOn && canToggleHints && (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-ds-muted dark:text-ds-muted">
                  关掉只停用标红与复核提示，不改变判定；想放过某个词或某种正常搭配，
                  用上面的「加白」或下方词表里的「例外」。
                </span>
                <Button
                  size="sm"
                  variant={showRedlineHints ? 'primary' : 'secondary'}
                  onClick={() => onShowComplianceHintsChange?.(!showRedlineHints)}
                >
                  {showRedlineHints ? '显示红线标记：开' : '显示红线标记：关'}
                </Button>
              </div>
            )}
            {canEditTerms ? (
              <>
                <div className="sop-recipe-terms__grid">
                  {terms.map((item, index) => {
                    // 加白的词不参与判定，也就不该再标红 —— 否则「明明加白了还红着」很吓人
                    const hit = !item.disabled && bodyViolations.includes(item.term)
                    // ⚠️ `allow` 走一次 `?? []`：类型上它必填，但数据是从设置读回来的，
                    // 手工改过库 / 旧格式缺这个字段时，`.join` 会**把整个弹窗渲染崩掉**（白屏），
                    // 而不是显示成空 —— 这种崩法比显示不对难查得多。
                    const allow = item.allow ?? []
                    // 编辑期间显示原始串（保住用户刚敲的顿号），失焦后回显规整结果
                    const allowText = allowDraft?.index === index ? allowDraft.text : allow.join('、')
                    return (
                      <div
                        key={index}
                        className={cx(
                          'sop-recipe-term',
                          hit && 'sop-recipe-term--hit',
                          item.disabled && 'sop-recipe-term--muted',
                        )}
                        title={hit ? '命中当前骨架' : undefined}
                      >
                        <div className="sop-recipe-term__head">
                          {/* 勾选 = 加白（TB-146）：整词停用，词与例外都留着，可随时切回。
                              存的是 `disabled` 而非 `enabled` —— 让勾选框与数据同向，免掉取反写错。 */}
                          <input
                            type="checkbox"
                            className="sop-recipe-term__whitelist"
                            checked={Boolean(item.disabled)}
                            aria-label={`把红线词「${item.term || index + 1}」加白（不再参与判定）`}
                            title="加白：这个词不再参与红线判定；再点一次恢复"
                            onChange={(event) => toggleTermDisabled(index, event.target.checked)}
                          />
                          <input
                            className="sop-recipe-term__word"
                            value={item.term}
                            placeholder="违规词"
                            aria-label={`红线词 ${index + 1}`}
                            onChange={(event) => updateTerm(index, event.target.value)}
                          />
                          <button
                            type="button"
                            className="sop-recipe-term__remove"
                            onClick={() => removeTerm(index)}
                            aria-label={`删除红线词 ${item.term || index + 1}`}
                            title="彻底删除这个词（不可恢复，要回来只能「恢复默认」）"
                          >
                            <TrashIcon className="h-3 w-3" />
                          </button>
                        </div>
                        {item.disabled ? (
                          // 加白态：例外已经没有服务对象，改成状态说明（配置仍保留在数据里）
                          <div className="sop-recipe-term__muted-note">
                            <Badge tone="info">已加白</Badge>
                            <span>不参与判定</span>
                          </div>
                        ) : (
                          /* 例外词（TB-145）：写在这里的搭配，判定前会被挖空 ——
                             「裸妆」放行，而同一条里出现的「裸体」照拦。 */
                          <input
                            className="sop-recipe-term__allow"
                            value={allowText}
                            placeholder="例外：填正常搭配"
                            aria-label={`例外词 ${index + 1}（${item.term || '未命名'}）`}
                            title="这些正常搭配不算违规（顿号分隔）"
                            onChange={(event) => updateTermAllow(index, event.target.value)}
                            onBlur={() => setAllowDraft(null)}
                          />
                        )}
                      </div>
                    )
                  })}
                  <button type="button" className="sop-recipe-terms__add" onClick={addTerm}>
                    <PlusIcon className="h-3 w-3" />
                    加一条
                  </button>
                </div>
                <div className="sop-recipe-terms__actions">
                  <span>
                    命中只提示、不中断生成。误判有两条路：勾选框「加白」= 整个词不再判、可随时恢复；
                    右下的「例外」填正常搭配（如「裸妆」）= 只放过那一种写法。改动立即对所有配方卡生效。
                  </span>
                  <Button size="sm" variant="secondary" onClick={resetTerms}>
                    恢复默认 {CAMPAIGN_RECIPE_FORBIDDEN_RULES.length} 词
                  </Button>
                </div>
              </>
            ) : (
              <p>
                {terms.length > 0
                  ? terms
                      .map((item) => {
                        if (item.disabled) return `${item.term}（已加白）`
                        const allow = item.allow ?? []
                        return allow.length > 0 ? `${item.term}（例外：${allow.join('、')}）` : item.term
                      })
                      .join(' · ')
                  : '（当前词表为空，红线已关闭）'}
              </p>
            )}
          </details>

          {/* 解析快照与当前配置可能不一致（用户改过），点明差异来源免得互相怀疑 */}
          {parsedDimensionCount > 0 && parsedDimensionCount !== dimensions.length && (
            <p className="sop-recipe-panel__hint">
              解析时读到 {parsedDimensionCount} 个维度，当前配置是 {dimensions.length}{' '}
              个（你改过；一切以当前配置为准）。
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}
