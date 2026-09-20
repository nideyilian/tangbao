import { useMemo } from 'react'
import { Badge, Button, IconButton, TextArea, cx } from '../../design-system'
import { EyeIcon as Eye, PlusIcon as Plus, ShuffleIcon as Shuffle, TrashIcon as Trash } from '../../design-system/icons'
import {
  CAMPAIGN_RECIPE_FORBIDDEN_TERMS,
  findCampaignRecipeViolations,
  renderCampaignRecipePrompts,
  validateCampaignRecipeConfig,
  type CampaignRecipeDimension,
} from './campaignRecipe'
import type { SopCampaignRecipeConfig } from './types'

/**
 * 配方卡编辑器：与变量提示词资产的「可变项参数工作台」同级，但用途完全不同。
 *
 * 差异要点（与变量提示词的「选项池 + AI 衍生」严格区分）：
 * - 这里编辑的是**维度池**，候选值全部由人手填，不调 AI 衍生；
 * - 骨架里的 `{{维度名}}` 占位符由最远点采样组合填充，目标不是「每个维度全覆盖」，
 *   而是「每批 N 条两两差异尽量大」；
 * - 合规红线是**硬约束**：命中红线词的候选值在生成前会被引擎剔除，
 *   因此这里提前给出黄条警告，避免用户填完才发现值不生效。
 *
 * 骨架与维度池存在 `campaignRecipe` 字段，`content` 仍留作摘要/说明，
 * 与 `generateCampaignRecipePromptsFromStore` 的「字段优先」读取顺序一致。
 */

/** 一键铺开的预览条数；只用于看效果，不影响实际生成数量。 */
const RECIPE_PREVIEW_COUNT = 6

export type SopCampaignRecipePanelProps = {
  config: SopCampaignRecipeConfig
  onChange: (config: SopCampaignRecipeConfig) => void
}

function blankDimension(): CampaignRecipeDimension {
  return { name: '', options: [''] }
}

/** 抽出正文里已用到的占位符名称，用于提示「哪些维度没被骨架引用」。 */
function extractPlaceholders(body: string): string[] {
  const names: string[] = []
  const pattern = /\{\{\s*([^{}\r\n]+?)\s*\}\}/gu
  for (const match of body.matchAll(pattern)) {
    const name = match[1].trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

export default function SopCampaignRecipePanel({ config, onChange }: SopCampaignRecipePanelProps) {
  const body = config.body ?? ''
  // config 每次编辑都是新对象，直接进 useMemo 依赖会让派生计算每次重算；
  // 拆出稳定标量（body 字符串 + dimensions 引用）后，只有内容真变时才算。
  const dimensions = useMemo(() => config.dimensions ?? [], [config.dimensions])

  const placeholders = useMemo(() => extractPlaceholders(body), [body])
  const errors = useMemo(() => validateCampaignRecipeConfig(config), [config])

  /**
   * 合规体检：骨架命中的红线词会让整个 body 被引擎清空（sanitize 的行为），
   * 所以这里必须让用户先看到，而不是等到生成时才莫名其妙失败。
   */
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

  /** 骨架与维度池齐全时给出前几条预览，让「差异够大」可肉眼验收。 */
  const preview = useMemo(() => {
    if (errors.length > 0 || bodyViolations.length > 0) return []
    try {
      return renderCampaignRecipePrompts(config, { count: RECIPE_PREVIEW_COUNT, seed: 'preview' })
    } catch {
      return []
    }
  }, [bodyViolations.length, config, errors.length])

  /** 维度池总组合数：用于在耗尽前提醒「空间不够」。 */
  const combinationCount = useMemo(
    () =>
      dimensions.reduce(
        (total, dimension) => {
          const size = (dimension.options ?? []).filter((option) => option.trim()).length
          return total * Math.max(0, size)
        },
        dimensions.length > 0 ? 1 : 0,
      ),
    [dimensions],
  )

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
    // 新增空行后立刻聚焦由浏览器默认行为处理；这里只保证数组长度正确
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

  const unusedDimensions = dimensions.filter(
    (dimension) => dimension.name.trim() && !placeholders.includes(dimension.name),
  )

  return (
    <section className="sop-recipe-panel" aria-label="配方卡引擎配置">
      <header className="sop-recipe-panel__header">
        <strong>
          <Shuffle size={13} />
          配方卡引擎
        </strong>
        <span>本地最远点采样 · 不调用 AI · 跨批次自动去重</span>
      </header>

      <div className="sop-recipe-panel__body">
        <TextArea
          label="提示词骨架"
          value={body}
          onChange={(event) => onChange({ ...config, body: event.target.value })}
          placeholder="用 {{维度名}} 占位，例如：{{主体}}，{{背景}}，{{光线}}，高清实拍"
          helperText={
            placeholders.length > 0
              ? `已识别占位符：${placeholders.map((name) => `{{${name}}}`).join('、')}`
              : '尚未识别到 {{维度名}} 占位符，引擎会提示骨架缺少维度引用'
          }
          containerClassName="sop-recipe-panel__body-field"
          className="sop-recipe-panel__body-input"
        />

        {bodyViolations.length > 0 && (
          <p className="sop-recipe-panel__warning" role="alert">
            骨架命中合规红线「{bodyViolations.join('、')}」，生成时整段骨架会被清空。请先改写。
          </p>
        )}

        <div className="sop-recipe-panel__section-head">
          <div className="min-w-0">
            <strong>维度池</strong>
            <span>
              {dimensions.length} 个维度 · 组合空间 {combinationCount} 条
              {combinationCount > 0 && combinationCount < 20 ? '（偏小，建议加候选值）' : ''}
            </span>
          </div>
          <div className="sop-recipe-panel__section-actions">
            {placeholders.some((name) => !dimensions.some((dimension) => dimension.name === name)) && (
              <Button size="sm" variant="secondary" onClick={syncDimensionsFromBody}>
                按骨架补齐
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={addDimension} leadingIcon={<Plus size={14} />}>
              加维度
            </Button>
          </div>
        </div>

        {unusedDimensions.length > 0 && (
          <p className="sop-recipe-panel__hint">
            维度「{unusedDimensions.map((dimension) => dimension.name).join('、')}」未被骨架引用，
            这些维度不参与实际出词（签名仍会记录，便于历史去重）。
          </p>
        )}

        <div className="sop-recipe-panel__dimensions">
          {dimensions.map((dimension, dimensionIndex) => (
            <article key={dimensionIndex} className="sop-recipe-dimension">
              <div className="sop-recipe-dimension__head">
                <input
                  value={dimension.name}
                  placeholder="维度名（与骨架里的 {{名称}} 对应）"
                  aria-label={`维度 ${dimensionIndex + 1} 名称`}
                  onChange={(event) => updateDimension(dimensionIndex, { name: event.target.value })}
                />
                <span className="sop-recipe-dimension__count">
                  {dimension.options.filter((option) => option.trim()).length} 个值
                </span>
                <IconButton
                  size="sm"
                  onClick={() => removeDimension(dimensionIndex)}
                  aria-label={`删除维度 ${dimension.name || dimensionIndex + 1}`}
                  title="删除维度"
                  icon={<Trash size={14} />}
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
                        <Trash size={12} />
                      </button>
                    </label>
                  )
                })}
                <button type="button" className="sop-recipe-dimension__add" onClick={() => addOption(dimensionIndex)}>
                  <Plus size={12} />
                  加候选值
                </button>
              </div>
            </article>
          ))}
          {dimensions.length === 0 && (
            <p className="sop-recipe-panel__hint">还没有维度。点「加维度」开始，或按骨架自动补齐。</p>
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
                <Eye size={13} />
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
      </div>
    </section>
  )
}
