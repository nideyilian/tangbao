import { useState } from 'react'
import { Button, TextArea } from '../../design-system'
import { EyeIcon as Eye, ShuffleIcon as Shuffle, SparklesIcon as Sparkles } from '../../design-system/icons'
import { parseCampaignRecipeText, toCampaignRecipeConfig, type ParsedCampaignRecipe } from './campaignRecipeImport'
import SopCampaignRecipeParseResultDialog, { countParsedRecipeAttention } from './SopCampaignRecipeParseResultDialog'
import type { CampaignRecipeDimension } from './campaignRecipe'
import type { SopCampaignRecipeConfig } from './types'

/**
 * 配方卡引擎 · 入外面板。
 *
 * 只做一件事：**把配方卡原文变成配置**。整段粘进来 → 点「解析」→ 拆出名称 / 骨架 / 维度池，
 * 写入可编辑草稿。
 *
 * 其余**全部**在「配方卡详情」弹窗里（`SopCampaignRecipeParseResultDialog`）：
 * 原资产信息、提示词骨架、维度池（增删改）、采样预览、合规红线词表。
 * 2026-09-20 杰哥定的形态：「外面窗口只显示原文内容」，因为解析完一次之后用户反复操作的是
 * 骨架与维度池，留在原地下方会让面板越滚越长、录入区反被挤没。
 * ⇒ **弹窗不再是只读详情，它同时是编辑面**；面板上已无任何骨架 / 维度的编辑入口。
 *
 * 关键约束：解析**只填能确定的字段**，认不出的一律留空并在详情里点明，
 * 绝不静默编造 —— 一个错的配方比一个报错的配方危险得多。
 */

export type SopCampaignRecipePanelProps = {
  config: SopCampaignRecipeConfig
  /** 解析出的素材信息（名称 / 说明 / 主控槽），随配方卡一起保存。 */
  meta?: { name?: string; desc?: string; dominantSlots?: string[] }
  onChange: (config: SopCampaignRecipeConfig) => void
  onMetaChange?: (meta: { name?: string; desc?: string; dominantSlots?: string[] }) => void
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

  /** 入口按钮上只报「有几条要留意」，细节进弹窗（外面不重复铺内容） */
  const attentionCount = countParsedRecipeAttention(parsed)

  /**
   * 入口的可用条件：**有解析结果，或本来就带着配置**。
   *
   * 光看 `parsed` 会漏掉最常见的一种用法 —— 从库里打开一个已保存的配方卡 SOP，
   * 用户这次根本没粘原文、也不会去点「解析」，但骨架与维度仍然要看要改。
   * 那时入口若禁着，编辑器就彻底进不去了（骨架 / 维度只有弹窗里有）。
   */
  const hasConfigContent = (config.body ?? '').trim().length > 0 || (config.dimensions ?? []).length > 0
  const canOpenDetail = Boolean(parsed) || hasConfigContent

  /** 主控槽展示口径：HEAD 版本用解析出的声明（引擎侧的权重推导落地后可换成按权重算） */
  const dominantSlotsForDisplay = meta?.dominantSlots ?? []

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
              disabled={!canOpenDetail}
              title={
                parsed
                  ? '查看这次解析读到的全部内容'
                  : hasConfigContent
                    ? '查看并编辑当前配方卡的骨架与维度'
                    : '先粘贴原文并点「解析」'
              }
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
              维度数与组合空间在详情弹窗的维度池标题行里说，细节全在弹窗里，
              这里再报一遍就是三处重复 —— 加了弹窗就该把外面那层收掉。
              `!parseError` 是必须的：解析出了骨架/维度的失败分支同样会让 ok=true。
              文案刻意不提「已填入」：解析成功但骨架/维度为空时，弹窗里会提示缺什么，
              说「已填入」会与那提示自相矛盾。它只是「动作完成」的信号，不承诺结果完整。 */}
          {parsed?.ok && !parseError && (
            <p className="sop-recipe-panel__success">解析完成，点右侧「查看解析结果」核对并微调。</p>
          )}
        </div>
      </div>

      {/* 配方卡详情弹窗：解析结果的唯一查看与编辑处（骨架 / 维度池 / 预览 / 词表都在里面）。
          关闭方式四处都走既有约定：右上 X、底部「关闭」、Esc、点遮罩。 */}
      <SopCampaignRecipeParseResultDialog
        open={parseResultOpen}
        onOpenChange={setParseResultOpen}
        parsed={parsed}
        config={config}
        onChange={onChange}
        dominantSlots={dominantSlotsForDisplay}
        meta={meta}
      />
    </section>
  )
}
