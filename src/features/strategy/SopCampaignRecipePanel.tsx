import { useEffect, useRef, useState } from 'react'
import { Badge, Button, TextArea } from '../../design-system'
import { EyeIcon as Eye, ShuffleIcon as Shuffle, SparklesIcon as Sparkles } from '../../design-system/icons'
import { parseCampaignRecipeText, toCampaignRecipeConfig, type ParsedCampaignRecipe } from './campaignRecipeImport'
import SopCampaignRecipeParseResultDialog, { summarizeParsedRecipe } from './SopCampaignRecipeParseResultDialog'
import { CampaignRecipeProblemList } from './CampaignRecipeProblemList'
import {
  buildRecipeProblems,
  problemTargetKey,
  recipeTargetScope,
  resolveRecipeDisplayTerms,
  summarizeRecipeProblems,
  type RecipeProblemTarget,
} from './campaignRecipeProblems'
import { focusRecipeTarget } from './recipeTargetLocate'
import { resolveEffectiveDominantSlots } from './campaignRecipe'
import type { CampaignRecipeDimension } from './campaignRecipe'
import type { SopCampaignRecipeConfig } from './types'
import type { RecipeForbiddenRule } from '../../types'

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
 * 2026-09-20 追加：外面**要能看出「这个配方卡填了什么、解析到哪一步」**——
 * 从库里打开的配方卡不会经过「粘贴原文」这一步，只有录入框的话外面一片空白，
 * 无法判断有没有内容。所以下面多了一块**内容概览**（只读）：解析状态徽章 +
 * 骨架原文 + 维度规模。它是「原文」的展示，不是编辑器。
 *
 * 关键约束：解析**只填能确定的字段**，认不出的一律留空并在详情里点明，
 * 绝不静默编造 —— 一个错的配方比一个报错的配方危险得多。
 *
 * 2026-10-09（TB-152）：**原文改存进配方卡里**（`config.rawText`），不再是面板的
 * 组件私有 state。它原先是「关掉弹窗 / 切一次 tab 就没了」的那一份（tab 是条件渲染，
 * 整块卸载会连内存一起丢），而骨架与维度却是自动保存的 —— 同一个面板里一半留得住、
 * 一半留不住，用户看到的是「骨架还在、原文变 0 字符」。现在它跟骨架走同一条自动保存
 * 链路，并且**每张卡各记各的**（切卡不再把上一张的原文带过来）。
 *
 * 2026-10-09（TB-153）：外面那块提示从「一段灰字」换成**问题清单**（前几条 + 共 N 条），
 * 每条能点着跳到出问题的地方、并当场写明怎么改。清单本体与弹窗里是**同一份数据**
 * （`buildRecipeProblems`），这里只负责「概览 + 路由」：
 * 落点在弹窗里的，点一下先开弹窗再滚过去；落在面板里的就地滚；落在左侧字段的交给中心。
 */

/**
 * 外面最多铺几条问题明细：再多就让明细进弹窗，别把概览区挤没。
 *
 * 条数由「问题清单」组件内部按 limit 截断，报出来的总数仍是全量（不会因为截断而少报）。
 */
const PROBLEM_PREVIEW_LIMIT = 2

export type SopCampaignRecipePanelProps = {
  config: SopCampaignRecipeConfig
  /** 解析出的素材信息（名称 / 说明 / 主控槽），随配方卡一起保存。 */
  meta?: { name?: string; desc?: string; dominantSlots?: string[] }
  onChange: (config: SopCampaignRecipeConfig) => void
  onMetaChange?: (meta: { name?: string; desc?: string; dominantSlots?: string[] }) => void
  /**
   * 当前生效的合规红线规则（全局一份，来自设置）。每条 = 词 + 它的例外词（TB-145）。
   * 不传 = 内置默认 21 词；传 `[]` = 用户把红线全关了（与不传语义不同）。
   */
  forbiddenTerms?: readonly RecipeForbiddenRule[]
  /**
   * 修改红线规则（配方面板只是透传，真正的存储与生效在设置里）。
   * 不传 = 词表按只读展示。
   */
  onForbiddenTermsChange?: (terms: RecipeForbiddenRule[]) => void
  /**
   * 红线**总开关**（TB-147）：**默认关闭** —— 关闭时不判定 / 不标红 / 生成前也不剔除。
   * 不传 = 关闭（与设置的缺省一致，避免"忘了传就当开着"）。
   */
  complianceEnabled?: boolean
  /** 切换总开关；不传时开关不渲染（只读场景）。 */
  onComplianceEnabledChange?: (value: boolean) => void
  /** 是否显示红线标记；不传 = 显示。只管显示，判定与生成前剔除照旧。 */
  showComplianceHints?: boolean
  /** 切换红线标记显示；不传则开关不渲染。 */
  onShowComplianceHintsChange?: (value: boolean) => void
  /**
   * 定位到**弹窗外面、面板外面**的字段（SOP 名称 / 说明在管理中心的左侧字段区）。
   *
   * 「未识别到配方名称」这类问题的落点就长在那里 —— 只有面板这一层够不着，
   * 由中心滚动 + 聚焦。不传时该条问题仍然出现，只是定位按钮点了不跳。
   */
  onLocateOutside?: (field: 'name' | 'description') => void
}

/**
 * 组合空间大小：各维度**有效**候选值数量之积（空串不算）。
 *
 * 抽成模块级函数是为了让「解析提示条」与「面板展示」用同一口径 ——
 * 两边分别手算过一次，其中一边漏了空值过滤，提示的数字比实际能跑出来的大。
 * 导出的目的是可被测试直接覆盖（面板组件本身没有测试文件）。
 */
export function computeRecipeCombinationCount(dimensions: CampaignRecipeDimension[]): number {
  return dimensions.reduce(
    (total, dimension) => {
      const size = (dimension.options ?? []).filter((option) => option.trim()).length
      return total * Math.max(0, size)
    },
    dimensions.length > 0 ? 1 : 0,
  )
}

/**
 * 解析结果里带英文描述的候选值总数。
 *
 * `englishByOption` 只用于导入期识别，不参与采样（它没有对应的 config 字段），
 * 但用户需要知道「解析器读到了 en 字段」，否则会以为被漏掉了。
 */
export function countRecipeEnglishOptions(dimensions: Array<{ englishByOption?: Record<string, string> }>): number {
  return dimensions.reduce((total, dimension) => total + Object.keys(dimension.englishByOption ?? {}).length, 0)
}

export default function SopCampaignRecipePanel({
  config,
  meta,
  onChange,
  onMetaChange,
  forbiddenTerms,
  onForbiddenTermsChange,
  complianceEnabled,
  onComplianceEnabledChange,
  showComplianceHints,
  onShowComplianceHintsChange,
  onLocateOutside,
}: SopCampaignRecipePanelProps) {
  /**
   * 「整段录入」的原文 —— **存在配方卡里**（`config.rawText`），不是组件私有 state（TB-152）。
   *
   * 读：直接取 config；写：`writeRawText`（走 `onChange`，于是自动保存会把它一起落库）。
   * ⚠️ 别改回 `useState` —— 那样它就只活在面板内存里，关弹窗 / 切 tab / 换卡全丢。
   */
  const rawText = config.rawText ?? ''
  const [parseError, setParseError] = useState('')
  const [parsed, setParsed] = useState<ParsedCampaignRecipe | null>(null)
  /**
   * 「解析结果」弹窗是否打开。与 `parsed` 分开存：
   * 关闭弹窗**不清空**解析结果 —— 用户常要「看一眼 → 关掉 → 改两笔 → 再看一眼」，
   * 关掉就丢会让入口变成一次性的。
   */
  const [parseResultOpen, setParseResultOpen] = useState(false)
  /**
   * 解析进行中。**不是装饰**：解析是本地同步函数，几百 KB 的原文会把主线程卡住，
   * 所以 handleParse 先置这个标志渲染一帧，再在下一 tick 跑解析 ——
   * 让用户看到「正在解析」而不是「界面卡住」。
   */
  const [parsing, setParsing] = useState(false)
  /** 上次解析所用的原文：与当前录入框不一致 ⇒ 提示「原文已改动，需重新解析」 */
  const [lastParsedText, setLastParsedText] = useState('')
  const parseTimerRef = useRef<number | null>(null)
  /** 面板根节点：落点在面板里时（原文框）就地定位用。 */
  const panelRef = useRef<HTMLElement | null>(null)
  /**
   * 待执行的「定位到弹窗里某个元素」请求。
   *
   * 为什么要绕这一圈：外面点到一条落点在弹窗里的问题时，弹窗还没挂上，
   * 立刻滚动一定滚空。所以这里只记下目标、把弹窗打开，由弹窗在挂载后自己消费。
   * `seq` 是**必须的**：同一个目标连点两次也要能再触发一次（只比目标的话第二次没有变化，
   * effect 不会重跑，用户会觉得「点第二下没反应」）。
   */
  const [locateRequest, setLocateRequest] = useState<{ target: RecipeProblemTarget; seq: number } | null>(null)
  const locateSeqRef = useRef(0)

  /** 已保存的骨架与维度规模：外面据此判断「这个配方卡填了没有、大概填了多少」 */
  const body = config.body ?? ''
  const dimensions = config.dimensions ?? []
  const summary = summarizeParsedRecipe(dimensions)

  /**
   * 解析状态。五态而不是四态：`已保存内容` 单列 ——
   * 从库里打开的配方卡带着上次存下的骨架，本次并没有解析过，
   * 把它算作「待解析」会让人以为内容没保存，算作「解析完成」又是假的。
   */
  type ParseStatus = 'idle' | 'parsing' | 'success' | 'failed' | 'saved'
  const parseStatus: ParseStatus = parsing
    ? 'parsing'
    : parsed
      ? parsed.ok && !parseError
        ? 'success'
        : 'failed'
      : (config.body ?? '').trim().length > 0 || dimensions.length > 0
        ? 'saved'
        : 'idle'
  const PARSE_STATUS_META: Record<
    ParseStatus,
    { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }
  > = {
    idle: { label: '待解析', tone: 'warning' },
    parsing: { label: '解析中…', tone: 'info' },
    success: { label: '解析完成', tone: 'success' },
    failed: { label: '解析失败', tone: 'danger' },
    saved: { label: '已保存内容', tone: 'neutral' },
  }
  const statusMeta = PARSE_STATUS_META[parseStatus]
  /** 解析完之后又改了原文 ⇒ 当前内容可能已经对不上了 */
  const rawChangedAfterParse = Boolean(parsed) && rawText !== lastParsedText
  /**
   * 入口的可用条件：**有解析结果，或本来就带着配置**。
   *
   * 光看 `parsed` 会漏掉最常见的一种用法 —— 从库里打开一个已保存的配方卡 SOP，
   * 用户这次根本没粘原文、也不会去点「解析」，但骨架与维度仍然要看要改。
   * 那时入口若禁着，编辑器就彻底进不去了（骨架 / 维度只有弹窗里有）。
   */
  const hasConfigContent = (config.body ?? '').trim().length > 0 || (config.dimensions ?? []).length > 0
  const canOpenDetail = Boolean(parsed) || hasConfigContent
  // 主控槽按「当前权重」推导（执行口径即唯一真相），解析声明只作为来源说明
  const dominantSlotsForDisplay = resolveEffectiveDominantSlots(config.dimensions ?? [])

  /**
   * 问题清单（TB-153）。**外面所有报数的地方都从这一份来** ——
   * 徽章、入口按钮、下面铺出来的条目，全取 `problems.length`，
   * 不在任何地方另算一遍（TB-148 的病根就是「数字与明细两处算」）。
   *
   * 红线一并进来（按总开关 / 显示开关折算），所以「有红线命中」也会体现在这个数字里。
   */
  const problems = buildRecipeProblems({
    parsed,
    config,
    localParseError: parseError,
    rawChangedAfterParse,
    forbiddenTerms: resolveRecipeDisplayTerms(complianceEnabled, forbiddenTerms),
    showComplianceHints,
  })
  // 报数只有这一个来源：徽章、入口按钮、清单内部全取这一份
  const { total: problemCount, blocking: blockingCount } = summarizeRecipeProblems(problems)

  /**
   * 定位路由：一条问题的落点可能在三层里的任意一层，点了要做什么不一样。
   *
   * - `dialog`：先开弹窗，再让弹窗自己滚（弹窗还没挂上，这会儿滚一定滚空）；
   * - `outside`：落点在管理中心的左侧字段区（名称 / 说明）—— 关掉弹窗，交给中心滚 + 聚焦；
   * - `panel`：落点就在本面板（原文框），就地滚。
   */
  function routeLocate(target: RecipeProblemTarget) {
    const scope = recipeTargetScope(target)
    if (scope === 'dialog') {
      locateSeqRef.current += 1
      setLocateRequest({ target, seq: locateSeqRef.current })
      setParseResultOpen(true)
      return
    }
    if (scope === 'outside') {
      setParseResultOpen(false)
      onLocateOutside?.(target.kind === 'description' ? 'description' : 'name')
      return
    }
    focusRecipeTarget(problemTargetKey(target), panelRef.current)
  }

  /**
   * 写回原文（TB-152）。
   *
   * 原文与骨架 / 维度池同属一张配方卡，所以共用同一个 `onChange` ——
   * 中心的自动保存链只认 `itemDraft`，绕过它就又会变成「只活在内存里」。
   */
  function writeRawText(value: string) {
    onChange({ ...config, rawText: value })
  }

  function handleParse() {
    if (parsing) return
    const text = rawText
    setParsing(true)
    setParseError('')
    // 先渲染一帧「解析中」再跑同步解析：大原文会把主线程卡住，
    // 没有这一帧用户只会看到界面没反应（见 `parsing` 的注释）。
    parseTimerRef.current = window.setTimeout(() => {
      parseTimerRef.current = null
      try {
        const result = parseCampaignRecipeText(text)
        setParsed(result)
        setLastParsedText(text)
        if (!result.ok) {
          setParseError(result.error)
          return
        }
        // 解析成功 → 填入可编辑表单（这是「先确认再落库」的关键：不直接覆盖保存）
        const next = toCampaignRecipeConfig(result)
        if (!next) {
          setParseError('解析出的配方卡缺少骨架或可用维度，请到详情里手动补齐')
          return
        }
        setParseError('')
        // 这里不再拼「已识别 N 个维度、组合空间 M 条」的提示：
        // 那些数字在下面的「内容概览」与详情弹窗里各有一次，外面再报一遍就是重复。
        //
        // 原文跟着一起写回（TB-152）：`toCampaignRecipeConfig` 只认得 body / dimensions
        // （内部走 `parseCampaignRecipeConfig`，那个函数**只挑结构字段**），漏这一步
        // 就会出现「刚粘完、一点解析，原文立刻从配方卡里消失」。
        onChange({ ...next, rawText: text })
        onMetaChange?.({
          ...(result.name ? { name: result.name } : {}),
          ...(result.desc ? { desc: result.desc } : {}),
          ...(result.dominantSlots.length > 0 ? { dominantSlots: result.dominantSlots } : {}),
        })
      } finally {
        setParsing(false)
      }
    }, 0)
  }

  useEffect(
    () => () => {
      if (parseTimerRef.current !== null) window.clearTimeout(parseTimerRef.current)
    },
    [],
  )

  function handleClearInput() {
    // 原文随配方卡一起存着（TB-152）⇒「清空」必须连**存下来的那份**一起清，
    // 只清内存等于没清：切走再切回来原文又冒出来。
    writeRawText('')
    setParsed(null)
    setParseError('')
    setLastParsedText('')
    // 解析结果被清掉了，弹窗留在空态会让人以为「内容丢了」，直接关掉
    setParseResultOpen(false)
  }

  return (
    <section className="sop-recipe-panel" ref={panelRef} aria-label="配方卡引擎配置">
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
              <span>把原文整段粘进来：配方卡 JSON、「键: 值 + 列表」自由排版，或「一键衍生」模板</span>
            </div>
          </div>
          <TextArea
            label="配方卡原文"
            value={rawText}
            onChange={(event) => writeRawText(event.target.value)}
            placeholder={
              '直接粘贴整份配方卡，例如：\n\n{\n  "name": "歌单推荐美女",\n  "template": "{M}, {S1}, ...",\n  "master": [...],\n  "pools": { "S1": [...], "S2": [...] }\n}\n\n或自由排版：\nname: 歌单推荐美女\ntemplate: {M}, {S1}, {S2}\nmaster:\n  M1 戴耳机侧颜特写, close-up side profile...\npools:\n  S1: 甜美元气, 温柔治愈, 清冷\n\n或「一键衍生」产出的变量提示词模板（正文 + 可变项）：\n一只{{主体}}，{{风格}}风格。\n\n可变项：\n{{主体}}：柴犬 / 柯基\n{{风格}}：水彩 / 油画'
            }
            containerClassName="sop-recipe-import__field"
            className="sop-recipe-import__input"
            // 定位锚点：「回到原文框」类问题直接滚到这里（TB-153）。TextArea 会把未知属性透传给 textarea。
            data-recipe-target="raw"
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
                没解析过时禁用并说明原因：给一个点了没反应的按钮比不给更糟。
                按钮上与概览徽章报**同一个数**（都取 problems.length，不可能对不上）。 */}
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
              {problemCount > 0 ? `查看解析结果（${problemCount} 个问题）` : '查看解析结果'}
            </Button>
          </div>
        </div>

        {/* 内容概览（只读）：不打开详情就能看出「这个配方卡填了什么 / 解析到哪一步」。
            状态、问题清单、骨架原文、维度规模都收在这一块里 ——
            原来散在录入区里的成功提示与失败提示已删除，避免同一件事两处都说。
            只读：编辑入口只有「查看解析结果」弹窗一个。 */}
        <section className="sop-recipe-overview" aria-label="配方卡内容概览">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
            {problemCount > 0 && (
              <Badge tone={blockingCount > 0 ? 'danger' : 'warning'}>
                {problemCount} 个问题{blockingCount > 0 ? ` · ${blockingCount} 处必须先处理` : ''}
              </Badge>
            )}
            <span className="text-xs text-ds-muted dark:text-ds-muted">
              {hasConfigContent
                ? `${dimensions.length} 个维度 · ${summary.optionCount} 个候选值 · 组合空间 ${summary.combinationCount} 条`
                : '尚未填写内容'}
            </span>
          </div>

          {/* 问题清单（TB-153）：替代原来那串「摘要文字 + 失败原因 + 原文已改动」的灰字。
              每条能点着跳到出问题的地方（落点在弹窗里的会先把弹窗打开），
              并当场写明怎么改。外面只铺前几条，其余进弹窗。 */}
          <CampaignRecipeProblemList
            problems={problems}
            variant="panel"
            limit={PROBLEM_PREVIEW_LIMIT}
            onLocate={routeLocate}
          />

          {hasConfigContent ? (
            <>
              <span className="text-xs text-ds-muted dark:text-ds-muted">当前骨架（配方卡原文）：</span>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-2 py-1.5 font-mono text-xs text-ds-text dark:border-ds-border dark:bg-ds-surface-subtle dark:text-ds-text">
                {body.trim() || '（骨架为空，请到详情里补上）'}
              </pre>
            </>
          ) : (
            <p className="sop-recipe-panel__hint">
              这个配方卡还没有内容：在上面粘贴原文后点「解析」，或进「查看解析结果」手动加骨架与维度。
            </p>
          )}
        </section>
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
        forbiddenTerms={forbiddenTerms}
        onForbiddenTermsChange={onForbiddenTermsChange}
        complianceEnabled={complianceEnabled}
        onComplianceEnabledChange={onComplianceEnabledChange}
        showComplianceHints={showComplianceHints}
        onShowComplianceHintsChange={onShowComplianceHintsChange}
        // 问题清单的两个入参：面板与弹窗必须用**同一份输入**，否则两边条数会对不上
        rawChangedAfterParse={rawChangedAfterParse}
        localParseError={parseError}
        // 弹窗里点到「落点不在弹窗」的问题时，回给面板路由（关弹窗 / 就地滚 / 交给管理中心）
        onLocateRequest={routeLocate}
        locateRequest={locateRequest}
      />
    </section>
  )
}
