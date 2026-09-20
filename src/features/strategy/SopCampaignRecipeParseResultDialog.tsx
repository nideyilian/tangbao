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

import { useMemo } from 'react'
import { Badge, Button, Dialog, IconButton, TextArea, cx } from '../../design-system'
import { AlertTriangleIcon, EyeIcon, FileTextIcon, PlusIcon, SparklesIcon, TrashIcon } from '../../design-system/icons'
import {
  CAMPAIGN_RECIPE_FORBIDDEN_TERMS,
  findCampaignRecipeViolations,
  renderCampaignRecipePrompts,
  validateCampaignRecipeConfig,
  type CampaignRecipeDimension,
} from './campaignRecipe'
import type { ParsedCampaignRecipe } from './campaignRecipeImport'
import type { SopCampaignRecipeConfig } from './types'

/** 一键铺开的预览条数；只用于看效果，不影响实际生成数量。 */
const RECIPE_PREVIEW_COUNT = 6

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
}: SopCampaignRecipeParseResultDialogProps) {
  const close = () => onOpenChange(false)
  const body = config.body ?? ''
  // config 每次编辑都是新对象，直接进 useMemo 依赖会让派生计算每次重算；拆出稳定引用
  const dimensions = useMemo(() => config.dimensions ?? [], [config.dimensions])

  const placeholders = useMemo(() => extractPlaceholders(body), [body])
  const errors = useMemo(() => validateCampaignRecipeConfig(config), [config])
  const bodyViolations = useMemo(() => findCampaignRecipeViolations(body), [body])
  const optionViolations = useMemo(
    () =>
      dimensions.flatMap((dimension, dimensionIndex) =>
        (dimension.options ?? []).flatMap((option, optionIndex) => {
          const violations = findCampaignRecipeViolations(option)
          return violations.length > 0 ? [{ dimensionIndex, optionIndex, option, violations }] : []
        }),
      ),
    [dimensions],
  )
  const preview = useMemo(() => {
    if (errors.length > 0 || bodyViolations.length > 0) return []
    try {
      return renderCampaignRecipePrompts(config, { count: RECIPE_PREVIEW_COUNT, seed: 'preview' })
    } catch {
      return []
    }
  }, [bodyViolations.length, config, errors.length])

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

          {bodyViolations.length > 0 && (
            <p className="sop-recipe-panel__warning" role="alert">
              骨架命中合规红线「{bodyViolations.join('、')}」，生成时整段骨架会被清空。请先改写。
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
                      const hit = findCampaignRecipeViolations(option)
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

          {optionViolations.length > 0 && (
            <p className="sop-recipe-panel__warning" role="alert">
              有 {optionViolations.length} 个候选值命中合规红线，生成时会被自动剔除：
              {optionViolations
                .slice(0, 3)
                .map((entry) => `${entry.option}（${entry.violations.join('、')}）`)
                .join('；')}
              {optionViolations.length > 3 ? ' 等' : ''}
            </p>
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
                {bodyViolations.length > 0
                  ? '骨架命中红线，暂不可预览。'
                  : errors.length > 0
                    ? '补齐骨架与维度后即可预览。'
                    : '骨架未引用任何维度，暂不可预览。'}
              </p>
            )}
          </div>

          <details className="sop-recipe-panel__terms">
            <summary>合规红线词表（{CAMPAIGN_RECIPE_FORBIDDEN_TERMS.length} 项，不可关闭）</summary>
            <p>{CAMPAIGN_RECIPE_FORBIDDEN_TERMS.join(' · ')}</p>
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
