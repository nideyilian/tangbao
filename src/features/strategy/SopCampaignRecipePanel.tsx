import { useMemo, useState } from 'react'
import { Badge, Button, IconButton, TextArea, cx } from '../../design-system'
import {
  AlertTriangleIcon as AlertTriangle,
  EyeIcon as Eye,
  PlusIcon as Plus,
  ShuffleIcon as Shuffle,
  SparklesIcon as Sparkles,
  TrashIcon as Trash,
} from '../../design-system/icons'
import {
  CAMPAIGN_RECIPE_FORBIDDEN_TERMS,
  findCampaignRecipeViolations,
  renderCampaignRecipePrompts,
  validateCampaignRecipeConfig,
  type CampaignRecipeDimension,
} from './campaignRecipe'
import { parseCampaignRecipeText, toCampaignRecipeConfig, type ParsedCampaignRecipe } from './campaignRecipeImport'
import SopCampaignRecipeParseResultDialog, { countParsedRecipeAttention } from './SopCampaignRecipeParseResultDialog'
import type { SopCampaignRecipeConfig } from './types'

/**
 * 配方卡编辑器。
 *
 * 两个入口分工明确：
 * - **整段录入**（默认）：把真实配方卡原文（JSON 或自由排版）整段粘进来，点「解析」自动
 *   拆出名称 / 骨架 / 维度池，再落到可编辑表单里确认。真实资产动辄十几个维度、上百个候选值，
 *   手工分栏填写成本过高且必错。
 * - **逐项微调**：解析结果始终以可编辑表单呈现，识别错了能就地改，不强迫重来。
 *
 * 关键约束：解析**只填能确定的字段**，认不出的一律留空并在提示条里点明，
 * 绝不静默编造 —— 一个错的配方比一个报错的配方危险得多。
 */

/** 一键铺开的预览条数；只用于看效果，不影响实际生成数量。 */
const RECIPE_PREVIEW_COUNT = 6

export type SopCampaignRecipePanelProps = {
  config: SopCampaignRecipeConfig
  /** 解析出的素材信息（名称 / 说明 / 主控槽），随配方卡一起保存。 */
  meta?: { name?: string; desc?: string; dominantSlots?: string[] }
  onChange: (config: SopCampaignRecipeConfig) => void
  onMetaChange?: (meta: { name?: string; desc?: string; dominantSlots?: string[] }) => void
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

export default function SopCampaignRecipePanel({ config, meta, onChange, onMetaChange }: SopCampaignRecipePanelProps) {
  const [rawText, setRawText] = useState('')
  const [parseError, setParseError] = useState('')
  const [parsed, setParsed] = useState<ParsedCampaignRecipe | null>(null)
  /**
   * 「解析结果」弹窗是否打开。与 `parsed` 分开存：
   * 关闭弹窗**不清空**解析结果 —— 用户常要「看一眼 → 关掉 → 改两笔 → 再看一眼」，
   * 关掉就丢会让入口变成一次性的。
   */
  const [parseResultOpen, setParseResultOpen] = useState(false)

  const body = config.body ?? ''
  // config 每次编辑都是新对象，直接进 useMemo 依赖会让派生计算每次重算；
  // 拆出稳定引用后，只有内容真变时才重算。
  const dimensions = useMemo(() => config.dimensions ?? [], [config.dimensions])

  const placeholders = useMemo(() => extractPlaceholders(body), [body])
  const errors = useMemo(() => validateCampaignRecipeConfig(config), [config])

  /** 骨架命中红线会让整段骨架被引擎清空，必须提前告知。 */
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

  function handleParse() {
    const result = parseCampaignRecipeText(rawText)
    setParsed(result)
    if (!result.ok) {
      setParseError(result.error)
      return
    }
    // 解析成功 → 填入可编辑表单（这是「先确认再落库」的关键：不直接覆盖保存）
    const next = toCampaignRecipeConfig(result)
    if (!next) {
      setParseError('解析出的配方卡缺少骨架或可用维度，请在下方手动补齐')
      return
    }
    setParseError('')
    // 这里不再拼「已识别 N 个维度、组合空间 M 条」的提示：
    // 那些数字在下方「解析结果确认」区块里本来就有，细节在「查看解析结果」弹窗里，
    // 外面再报一遍就是三处重复（加了弹窗就该把外面那层收掉）。
    onChange(next)
    onMetaChange?.({
      ...(result.name ? { name: result.name } : {}),
      ...(result.desc ? { desc: result.desc } : {}),
      ...(result.dominantSlots.length > 0 ? { dominantSlots: result.dominantSlots } : {}),
    })
  }

  function handleClearInput() {
    setRawText('')
    setParsed(null)
    setParseError('')
    // 解析结果被清掉了，弹窗留在空态会让人以为「内容丢了」，直接关掉
    setParseResultOpen(false)
  }
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

  /** 入口按钮上只报「有几条要留意」，细节进弹窗（外面不重复铺内容） */
  const attentionCount = countParsedRecipeAttention(parsed)

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
        {/* ---- 整段录入：粘贴原文 → 解析 ---- */}
        <div className="sop-recipe-import">
          <div className="sop-recipe-panel__section-head">
            <div className="min-w-0">
              <strong>
                <Sparkles size={13} />
                整段录入
              </strong>
              <span>把配方卡原文整段粘进来，支持 JSON 与「键: 值 + 列表」自由排版</span>
            </div>
          </div>
          <TextArea
            label="配方卡原文"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder={
              '直接粘贴整份配方卡，例如：\n\n{\n  "name": "歌单推荐美女",\n  "template": "{M}, {S1}, ...",\n  "master": [...],\n  "pools": { "S1": [...], "S2": [...] }\n}\n\n或自由排版：\nname: 歌单推荐美女\ntemplate: {M}, {S1}, {S2}\nmaster:\n  M1 戴耳机侧颜特写, close-up side profile...\npools:\n  S1: 甜美元气, 温柔治愈, 清冷'
            }
            containerClassName="sop-recipe-import__field"
            className="sop-recipe-import__input"
          />
          <div className="sop-recipe-import__actions">
            <Button
              size="sm"
              variant="primary"
              onClick={handleParse}
              disabled={!rawText.trim()}
              leadingIcon={<Sparkles size={14} />}
            >
              解析
            </Button>
            <Button size="sm" variant="secondary" onClick={handleClearInput} disabled={!rawText && !parsed}>
              清空
            </Button>
            <span className="sop-recipe-import__hint">{rawText.trim().length} 字符</span>
            {/* 原文区域右下角的弹窗入口。放在字符数**之后** ⇒ 落在整栏最右端
                （字符数自带 margin-left:auto，插在它前面会被挤到中间）。
                没解析过时禁用并说明原因：给一个点了没反应的按钮比不给更糟。 */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setParseResultOpen(true)}
              disabled={!parsed}
              title={parsed ? '查看这次解析读到的全部内容' : '先粘贴原文并点「解析」'}
              leadingIcon={<Eye size={14} />}
            >
              {attentionCount > 0 ? `查看解析结果（${attentionCount} 条待注意）` : '查看解析结果'}
            </Button>
          </div>

          {parseError && (
            <p className="sop-recipe-panel__warning" role="alert">
              {parseError}
            </p>
          )}
          {/* 只留「动作完成了」这一句即时反馈，**不带任何数字**：
              维度数与组合空间在下方「解析结果确认」区块里本来就有，细节在弹窗里，
              这里再报一遍就是三处重复 —— 加了弹窗就该把外面那层收掉。
              `!parseError` 是必须的：解析出了骨架/维度的失败分支同样会让 ok=true。
              文案刻意不提「已填入」：解析成功但骨架/维度为空时，下方会提示缺什么，
              说「已填入」会与那提示自相矛盾。它只是「动作完成」的信号，不承诺结果完整。 */}
          {parsed?.ok && !parseError && <p className="sop-recipe-panel__success">解析完成，请核对下方结果。</p>}
        </div>

        {/* ---- 解析结果确认与微调 ---- */}
        <div className="sop-recipe-panel__section-head">
          <div className="min-w-0">
            <strong>解析结果确认</strong>
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

        {meta?.dominantSlots && meta.dominantSlots.length > 0 && (
          <p className="sop-recipe-panel__hint">
            主控槽（来自原资产的 dominant 声明，差异优先保证这些槽）：{meta.dominantSlots.join('、')}
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
            const isDominant = Boolean(dimension.name.trim() && meta?.dominantSlots?.includes(dimension.name))
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
            )
          })}
          {dimensions.length === 0 && (
            <p className="sop-recipe-panel__hint">
              <AlertTriangle size={13} /> 还没有维度。粘贴原文后点「解析」，或手动加维度。
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
      {/* 解析结果弹窗：只读呈现解析器读到的东西（原资产信息 / 维度池 / 骨架 / 告警）。
          关闭方式四处都走既有约定：右上 X、底部「关闭」、Esc、点遮罩。 */}
      <SopCampaignRecipeParseResultDialog open={parseResultOpen} onOpenChange={setParseResultOpen} parsed={parsed} />
    </section>
  )
}
