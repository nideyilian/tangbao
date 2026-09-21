/**
 * 配方卡引擎：用本地算法（最远点采样 FPS）批量生成彼此差异足够大的提示词。
 *
 * 与普通 SOP 的分工（两条路径严格互斥）：
 * - 普通 SOP：把 SOP 正文交给文本模型，由 AI 逐条编写提示词（依赖网络、语义理解与模型随机性）。
 * - 配方卡（campaign-recipe）：不调 AI。配方卡提供若干「维度 → 候选值」的池子，
 *   引擎用最远点采样在组合空间里挑出两两差异最大的 N 条，跨批次按签名自动去重。
 *
 * 采样算法来自 farthestPointSampling.ts（splitmix64 散列取值 → 近层/远层双层硬约束
 * + 定向重掷 → 签名去重）。为什么不用「随机抽」或纯贪心 max-min：
 * - 随机抽在组合空间里会大量撞车，批量出图重复率高；
 * - 纯贪心 max-min 只保证全局最小距离，但观感上「相邻几条像不像」更扎眼。
 *   因此本引擎用近层窗口（最近 N 条严约束）+ 远层窗口（更长历史松约束）双层把关，
 *   并对「主控槽」（对观感影响最大的维度）施加额外差异下限。
 *
 * 距离定义：两条提示词在「维度取值」上的汉明距离（不同维度计数）。
 */
import type { SopCampaignRecipeConfig, SopCampaignRecipeDimension } from './types'

/** 配方卡维度的别名（语义等价，供引擎内部与调用方共用同一结构）。 */
export type CampaignRecipeDimension = SopCampaignRecipeDimension

/** 配方卡结构别名。 */
export type CampaignRecipeConfig = SopCampaignRecipeConfig

/**
 * 取消检查：signal 已中止时抛出与全应用一致的 AbortError。
 *
 * 本模块是纯数据层，不能 import `sopPromptBatch`（会把 store 依赖链引进来），
 * 因此就地实现 —— 语义与 `throwIfSopPromptGenerationAborted` 保持一致：
 * 优先抛 signal.reason 里的原始错误，否则抛标准 AbortError。
 */
export function throwIfCampaignRecipeAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('提示词生成已取消', 'AbortError')
}

/** 引擎内部的变量结构（与 FpsVariable 同构）。 */
export interface CampaignRecipeVariable {
  name: string
  options: string[]
}

export interface CampaignRecipeSamplingOptions {
  /** 随机种子；换种子即换一整套组合 */
  seed: string
  /** 近层窗口（最近 N 个），默认 10 */
  windowNear?: number
  /** 远层窗口，默认 80 */
  windowFar?: number
  /** 近层：总槽差异下限，默认 7 */
  minTotalNear?: number
  /** 近层：主控槽差异下限，默认 2 */
  minDomNear?: number
  /** 远层：总槽差异下限，默认 6 */
  minTotalFar?: number
  /** 远层：主控槽差异下限，默认 2 */
  minDomFar?: number
  /** 单条最大重掷次数，默认 120 */
  maxAttempt?: number
  /** 主控槽在维度数组中的索引（影响观感最大的几个槽）；缺省 = 全部槽平等 */
  dominantIndices?: number[]
  /** 历史批次已用组合签名（跨批次去重）；会被本批次追加新签名后原样写回 */
  usedSignatures?: Set<string>
}

export interface CampaignRecipeSamplingResult {
  /** 每条是各槽选中的选项索引，长度 = count */
  selections: number[][]
  /** 本批次每个组合的稳定签名（按选项名拼串，加词库不漂移） */
  signatures: string[]
  /** 本批次总重掷次数 */
  totalAttempts: number
  /** 因撞历史签名而重掷的次数 */
  crossBatchHits: number
}

export interface CampaignRecipeSample {
  /** 渲染后的提示词正文 */
  prompt: string
  /** 各维度选中的候选值下标 */
  selection: number[]
  /** 维度名 → 选中的候选值 */
  values: Record<string, string>
  /** 组合稳定签名（供跨批次去重落档） */
  signature: string
}

export interface CampaignRecipeGenerationOptions extends Omit<CampaignRecipeSamplingOptions, 'seed'> {
  /** 目标条数 */
  count: number
  /** 随机种子；缺省时由配方卡正文与维度自动派生，保证默认行为可复现 */
  seed?: string
  /**
   * 已产出的历史提示词（兜底去重）。
   * 主去重走 usedSignatures；这里额外按渲染文本比对，兼容调用方只存了文本的场景。
   */
  existingPrompts?: string[]
  /**
   * 取消信号。本地采样虽然是同步计算，但大池（数百候选值 × 多次重掷）会长时间占住
   * 主线程，不检查 signal 的话「取消」按钮点了没反应 —— 用户只能等它跑完。
   *
   * 检查粒度放在**每次渲染候选之后**：farthestPointSample 内部的重掷循环不接 signal
   * （它是纯数值计算，插入检查反而拖慢），但一旦拿到采样结果就立即校验，
   * 足以把「点了取消还要等完整批渲染」缩短到「等一轮采样」。
   */
  signal?: AbortSignal
  /**
   * 内置变量：不属于维度池、由调用方按当前界面状态注入的占位符（如 `{比例}` / `{方向}` / `{尺寸}`）。
   *
   * 与维度池的关系：**同名时维度池优先**（renderRecipeBody 先跑维度替换，内置变量只补漏），
   * 用户用维度显式定义了同名变量时不会被这里覆盖。
   * 未提供或值为空时占位符**原样保留** —— 与「维度对不上就保留」的既有约定一致，
   * 残留会被链路末端的占位符检查拦下，不静默流进生图。
   */
  builtinValues?: Record<string, string>
  /**
   * 系列模式：**每组画面数**。>1 时启用「组内约束」—— 同一组在 seriesFixedDimensions 上
   * 取值一致，只在其余维度上拉开差异；组与组之间保持不同（系列图语义：组内像一套、组间不重样）。
   *
   * 不传或 ≤1 时行为与单图模式完全一致（默认关闭，存量调用零影响）。
   */
  seriesGroupSize?: number
  /**
   * 系列模式：组内保持一致的维度名（可传多个）。
   *
   * 缺省时取**主控槽**（`pickDominantIndices`，即 weight 最高的维度）——
   * 那是资产作者自己声明的「影响观感最大」的维度，正是该在同一系列里保持一致的东西
   * （形式 / 画风 / 版式），而动作、场景、标题这类内容维度应当每组变化。
   * 不在维度池里的名字会被忽略；若一个都匹配不上，则退化为不分组（不静默改变行为）。
   */
  seriesFixedDimensions?: string[]
}

export interface CampaignRecipeGenerationResult {
  samples: CampaignRecipeSample[]
  /** 本批次的全部签名，供调用方落库到 usedSignatures 做跨批次去重 */
  signatures: string[]
  /** 候选组合总数（各维度候选值数量之积） */
  combinationCount: number
  /** 请求条数 */
  requestedCount: number
  /** 实际产出条数不足请求条数时为 true */
  exhausted: boolean
  /** 重掷统计，便于排查「怎么调不出差异」 */
  totalAttempts: number
  crossBatchHits: number
  /** 因超过单维度上限而被截断的维度名（空数组表示未截断）。 */
  truncatedDimensions: string[]
}

/**
 * 单维度候选值上限。超过时按声明顺序截断并保留前 N 个。
 *
 * 起因：真实配方卡资产常把整份长文本压成一个候选值（例如一张歌单 = 一个候选值），
 * 一个池可能有几百条。全量参与会让组合空间与重掷开销失控，且尾部值几乎不可能被选中；
 * 截断后由调用方明确告知用户，比静默全收更可控。
 */
export const MAX_DIMENSION_OPTIONS = 400

// ---------------------------------------------------------------------------
// 合规红线（内置，不可关闭）
// ---------------------------------------------------------------------------

/**
 * 合规红线词表：命中任意一项即判定该候选值不合规，直接从候选池剔除。
 * 这些词属于广告法与平台审核的高危项，不允许进入任何生成的提示词。
 */
export const CAMPAIGN_RECIPE_FORBIDDEN_TERMS = [
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
] as const

/**
 * 检测文本命中的合规红线词，返回命中的词表（空数组表示合规）。
 *
 * 说明：中文没有词边界，这里对每个红线词做子串匹配。
 * 例如「军」会命中「军绿色」「行军床」，属刻意保守 —— 合规判定宁可误杀不可放过。
 */
export function findCampaignRecipeViolations(text: string): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  return CAMPAIGN_RECIPE_FORBIDDEN_TERMS.filter((term) => normalized.includes(term))
}

/** 文本是否合规（未命中任何红线词）。 */
export function isCampaignRecipeCompliant(text: string): boolean {
  return findCampaignRecipeViolations(text).length === 0
}

/**
 * 校验并规整配方卡结构；返回错误列表（空数组表示可用）。
 * 与 parseVariablePrompt 的定位一致：格式错误必须被拦截，不能带着坏数据去出图。
 */
export function validateCampaignRecipeConfig(config: CampaignRecipeConfig): string[] {
  const errors: string[] = []
  if (!config || typeof config !== 'object') return ['配方卡结构无效']
  if (!config.body?.trim()) errors.push('配方卡缺少提示词骨架 body')
  const dimensions = Array.isArray(config.dimensions) ? config.dimensions : []
  if (dimensions.length === 0) errors.push('配方卡至少需要一个维度')
  const seen = new Set<string>()
  for (const dimension of dimensions) {
    const name = dimension?.name?.trim()
    if (!name) {
      errors.push('存在缺少名称的维度')
      continue
    }
    if (seen.has(name)) errors.push(`维度「${name}」重复定义`)
    seen.add(name)
    const options = Array.isArray(dimension.options) ? dimension.options.filter((option) => option?.trim()) : []
    if (options.length === 0) errors.push(`维度「${name}」没有任何候选值`)
  }
  return errors
}

/**
 * 用红线词表清洗配方卡：剔除命中红线的候选值与正文。
 * 返回清洗后的配方卡与被剔除项，便于向用户提示。
 *
 * `bodyRemoved` 单独标记「骨架正文因命中红线被整段清空」。调用方必须据此给出
 * 与真因对齐的报错 —— 否则用户只会看到「配方卡缺少提示词骨架 body」，
 * 跑去检查骨架却发现骨架明明在，完全指向错误的排查方向。
 */
export function sanitizeCampaignRecipeConfig(config: CampaignRecipeConfig): {
  config: CampaignRecipeConfig
  removed: string[]
  bodyRemoved: boolean
} {
  const removed: string[] = []
  const dimensions = (config.dimensions ?? []).map((dimension) => {
    const options = (dimension.options ?? []).filter((option) => {
      const violations = findCampaignRecipeViolations(option)
      if (violations.length === 0) return true
      removed.push(`维度「${dimension.name}」候选值「${option}」（命中：${violations.join('、')}）`)
      return false
    })
    // ⚠️ 必须原样带回 weight（以及未来的新字段）。
    // 曾经这里写成 `return { name: dimension.name, options }`，把 weight 悄悄丢掉，
    // 后果是「主控槽」全线失效：pickDominantIndices 拿不到权重 → 返回 undefined
    // → 界面 resolveEffectiveDominantSlots 显示不出主控槽，同时 farthestPointSample
    // 里 `dominantIndices ?? 全槽` 的兜底把「只对主控槽下狠手」退化成「所有槽平等」，
    // 多样性策略被静默改写（2026-09-20 实测：S1=2/S3=2/S4=2/S8=3/M=2 全被抹成 undefined）。
    // 清洗只应删候选值，不该动维度的元数据 —— 这是「剔污」与「重建」的边界。
    return { ...dimension, options }
  })
  const bodyViolations = findCampaignRecipeViolations(config.body ?? '')
  if (bodyViolations.length > 0) {
    removed.push(`提示词骨架（命中：${bodyViolations.join('、')}）`)
  }
  return {
    config: { body: bodyViolations.length > 0 ? '' : config.body, dimensions },
    removed,
    bodyRemoved: bodyViolations.length > 0,
  }
}

// ---------------------------------------------------------------------------
// 最远点采样（移植自 farthestPointSampling.ts）
// ---------------------------------------------------------------------------

const MASK = 0xffffffff

/**
 * splitmix64 的 32 位截断等价物：无周期散列。
 *
 * 三个常量是 64 位字面量，超出 Number.MAX_SAFE_INTEGER，直接写会触发 no-loss-of-precision。
 * **不能改写成截断后的短常量** —— 实测会改变散列结果、进而改变采样输出
 * （拆分/截断常量后与原始引擎的 selections 不再一致）。
 * 这里用 eslint-disable 保留原始字面量，维持与 farthestPointSampling.ts 逐位一致。
 */
/* eslint-disable no-loss-of-precision */
function mix64(x: number): number {
  x = (x + 0x9e3779b97f4a7c15) & MASK
  x = Math.imul(x ^ (x >>> 30), 0xbf58476d1ce4e5b9)
  x = Math.imul(x ^ (x >>> 27), 0x94d049bb133111eb)
  return (x ^ (x >>> 31)) >>> 0
}
/* eslint-enable no-loss-of-precision */

/** 字符串 → 32 位散列（FNV-1a），用于把 seed/变量名转成初值 */
function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 组合稳定签名：按各槽选中的选项名拼串（不随词库追加漂移） */
function signatureOf(variables: CampaignRecipeVariable[], selection: number[]): string {
  return variables.map((variable, index) => variable.options[selection[index]]).join('|')
}

/**
 * 两个组合的槽位差异数（汉明距离）。
 *
 * ⚠️ 上界取**两者长度的较小值**，不用 `left.length`。曾经用 `left.length`，而当时
 * `enforce` 的 `n` 屏蔽会让 `selection` 数组被幻影槽位撑长（R-69），于是这里把
 * `NaN` 与 `undefined` 也算成「不同」，差异被虚报成 ~100 ⇒ 近层/远层的「总槽差异」
 * 约束形同不存在，而对外暴露的 `computeBatchMinDistance` 还会报出「1.000 完美」的假象。
 * 长度不等本身就说明上游已坏，这里只做防御性截断，由测试的 shape 断言负责暴露。
 */
function hamming(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length)
  let distance = 0
  for (let index = 0; index < length; index++) if (left[index] !== right[index]) distance += 1
  return distance
}

/** 主控槽差异数。`dom` 的取值来自 `pickDominantIndices` 或调用方，下标必然落在维度范围内。 */
function domDiff(left: number[], right: number[], dom: number[]): number {
  let distance = 0
  for (const index of dom) if (left[index] !== right[index]) distance += 1
  return distance
}

/**
 * 从 variables 的选项池中挑 count 个两两差异最大的组合。
 *
 * 三层把关：
 * 1. splitmix64 散列取值：seed + 序号确定性地撒出候选点，可复现且不依赖 Math.random。
 * 2. 近层/远层双层约束：近层窗口（默认最近 10 条）总槽差异 ≥ 7 且主控槽 ≥ 2；
 *    远层（全部已选点，见 `windowFar` 注释）放宽到总槽 ≥ 6 且主控槽 ≥ 2。不满足就
 *    定向重掷「冲突最多的槽」，主控槽不足时优先重掷主控槽。
 * 3. 签名去重：撞历史签名（跨批次）或本批已用时继续重掷，最多 40 轮。
 *
 * 预算耗尽时以 **best-so-far 择优**收尾（见 `enforce`）—— 不拿随机游走的终点当结果。
 *
 * ## ⚠️ 三条「曾经踩过」的坑（2026-09-21 实测修正，勿回退）
 *
 * **① 主控槽下限 > 主控槽数，会把「总槽差异」约束整个短路。**
 * `domDiff` 的上限就是主控槽个数，而判据是
 * `domDiff < minDom || hamming < minTotal` 这种**或**关系：只要 `minDom` 不可达，
 * 条件便恒真 ⇒ `hamming` 那一侧**永不参与判断** ⇒ `minTotalNear/Far` 沦为死参数
 * ⇒ 每轮都重掷、打满预算 ⇒ 退出时放行**未满足约束**的候选。
 * 修法与实测见 `enforce` 内的 `minDomNearEffective` 与 R-68 的对照表。
 *
 * **② 主控槽的口径决定一切（`pickDominantIndices`）。**
 * 曾经只取「权重并列最高」者，真实资产 `S1=2,S3=2,S4=2,S8=3,M=2` 被收窄成单个 `S8情绪`
 * ⇒ 直接触发①。改为「全部带 `weight` 的维度」后，30 条实测：
 * 最小差异 1/13 → **6/13**、违约对 9.4% → **0%**、重掷 3481 → **126**（快 27 倍）。
 *
 * **③ 曾经用来支撑「保留旧行为」的那张对照表，是用本文件被污染的指标量出来的，已作废。**
 * 旧表（「放宽下限是净亏」「全槽最小差异 7.00 vs 3.10」）用的是 `computeBatchMinDistance`，
 * 而它经 `hamming` 取 `left.length` 作上界、又叠加了 `selection` 数组被幻影槽位撑长的问题
 * （R-69），数字虚高、**结论相反**。
 * **凡要验收多样性，一律自己用「下标 < 维度数」的真实槽重算，不要复用引擎的自检函数。**
 */
export interface CampaignRecipeCandidate {
  /** 维度名 */
  key: string
  /**
   * 主控槽声明：**只要 `> 0` 即算主控槽，数值大小不参与任何判定**
   * （见 `pickDominantIndices` —— 与原始 Python 引擎的 `cfg["dominant"]` 显式列表同义）。
   * 语义 = 「这个槽对观感影响大，请优先保证它与窗口内的取值都不同」。
   */
  weight?: number
}

/** 由维度的候选值声明推导主控槽下标。 */
export function pickDominantIndices(dimensions: CampaignRecipeDimension[]): number[] | undefined {
  // **判定口径：显式声明了正权重（`weight > 0`）即为主控槽，数值大小不参与比较。**
  //
  // 为什么不是「只取权重并列最高」：那是 2026-09-21 之前的行为，后果是真实资产
  // `S1=2,S3=2,S4=2,S8=3,M=2` 被收窄成**单个** `S8情绪`，而 `farthestPointSample` 的
  // `minDomNear/Far` 默认 2 > 主控槽数 1 ⇒ `domDiff < 2` **恒真** ⇒ 判据的**或**关系把
  // 「总槽差异」那一侧整个短路，`minTotalNear/Far` 沦为死参数（R-68）。
  // 实测（13 维 × 6 候选 / 30 条，只统计真实槽）：收窄成单槽时最小差异 1/13、
  // 9.4% 的组合对差异 <6；改为「全部带 weight」后最小 6/13、**0% 违约**，重掷 3481 → 126。
  //
  // 与原始 Python 引擎的口径一致：那边 `cfg["dominant"]` 就是一张**显式列表**，
  // 权重只表达「这个槽要保护起来」这一件事，不比大小。
  const weighted = dimensions
    .map((dimension, index) => ({ index, weight: dimension.weight }))
    .filter((item) => typeof item.weight === 'number' && Number.isFinite(item.weight) && item.weight > 0)
  if (weighted.length === 0) return undefined
  const dominant = weighted.map((item) => item.index)
  // 全部维度都被声明成主控时返回 undefined，交给下游按「全槽平等」处理：
  // 否则 dom.length === 维度数，`domDiff` 退化成 `hamming`，主控槽这一层就失去意义。
  return dominant.length > 0 && dominant.length < dimensions.length ? dominant : undefined
}

/**
 * 按**实际生效的权重**算出主控槽名集合，供界面展示。
 *
 * 为什么不让界面直接读 `SopLibraryItem.dominantSlots`：那个字段记录的是「原资产怎么声明的」，
 * 一旦用户在界面上增删改维度的 `weight`，它就与现实脱节 —— 界面还标着「主控槽」，
 * 引擎却按新的权重跑，出现「界面说 A、执行做 B」。**执行口径（weight）是唯一真相**，
 * 本函数让展示侧与它对齐；原资产的声明退化为「来源说明」而非事实来源。
 */
export function resolveEffectiveDominantSlots(dimensions: CampaignRecipeDimension[]): string[] {
  const indices = pickDominantIndices(dimensions)
  if (!indices) return []
  return indices.map((index) => dimensions[index]?.name ?? '').filter(Boolean)
}

/** 按上限截断超长维度池，返回截断后的维度与被动过的维度名。 */
export function truncateOversizedDimensions(dimensions: CampaignRecipeDimension[]): {
  dimensions: CampaignRecipeDimension[]
  truncated: string[]
} {
  const truncated: string[] = []
  const next = dimensions.map((dimension) => {
    if (dimension.options.length <= MAX_DIMENSION_OPTIONS) return dimension
    truncated.push(dimension.name)
    return { ...dimension, options: dimension.options.slice(0, MAX_DIMENSION_OPTIONS) }
  })
  return { dimensions: next, truncated }
}

export function farthestPointSample(
  variables: CampaignRecipeVariable[],
  count: number,
  options: CampaignRecipeSamplingOptions,
): CampaignRecipeSamplingResult {
  const windowNear = options.windowNear ?? 10
  // ⚠️ 保真移植：原始实现里 windowFar 只被赋默认值、从未参与逻辑 ——
  // 远层用的是完整 window（全部已选点），所以「远窗口」实际是无界的。
  // 保留该选项仅为 API 兼容，改它不影响结果；详见 docs/RISK.md 的配方卡引擎条目。
  void (options.windowFar ?? 80)
  const minTotalNear = options.minTotalNear ?? 7
  const minDomNear = options.minDomNear ?? 2
  const minTotalFar = options.minTotalFar ?? 6
  const minDomFar = options.minDomFar ?? 2
  const maxAttempt = options.maxAttempt ?? 120
  const dom = options.dominantIndices ?? variables.map((_, index) => index)
  const used = options.usedSignatures ?? new Set<string>()

  const n = variables.length
  const sizes = variables.map((variable) => variable.options.length)
  const seedNum = hashString(options.seed)

  // 每槽独立盐（seed 相关）→ 换 seed 即换整套取值
  const salts = variables.map((_, index) => mix64(seedNum ^ (index * 2654435761)))

  const baseCandidate = (k: number): number[] => sizes.map((size, slot) => mix64(k * 104729 + salts[slot]) % size)

  const rngState = { s: mix64(seedNum ^ 0x5f3564df) }
  const nextValue = (slot: number, current: number): number => {
    // xorshift32
    rngState.s ^= rngState.s << 13
    rngState.s ^= rngState.s >>> 17
    rngState.s ^= rngState.s << 5
    rngState.s >>>= 0
    let value = rngState.s % sizes[slot]
    let guard = 0
    while (value === current && guard < sizes[slot] + 2) {
      rngState.s ^= rngState.s << 13
      rngState.s ^= rngState.s >>> 17
      rngState.s ^= rngState.s << 5
      rngState.s >>>= 0
      value = rngState.s % sizes[slot]
      guard++
    }
    return value
  }

  /**
   * 贪心 max-min：对所有窗口组合逐对检查，定向重掷冲突最多的槽（主控优先）。
   *
   * ## 这一版修掉了三个把 max-min 架空的缺陷（2026-09-21，勿回退）
   *
   * 1. **下限必须可达**：`minDom > 主控槽数` 时 `domDiff < minDom` 恒真，判据的 OR 关系会把
   *    `hamming` 那一侧短路，`minTotal*` 变成死参数 —— 见下方 `minDomNearEffective`。
   * 2. **槽位枚举必须用维度数**：曾写成 `Array(n)` 而 `n` 被循环变量遮蔽成轮次，产生幻影槽位
   *    与 NaN（R-69），并让 `hamming` 虚报差异、连官方指标都在报假数。
   * 3. **预算耗尽必须择优**：曾经直接用随机游走的终点，终点可能比起点更差 —— 见 `bestCandidate`。
   *
   * 三处都改完后的实测（13 维 × 6 候选 / 30 条，真实槽口径）：最小差异 1/13 → **6/13**，
   * 差异 <6 的组合对 9.4% → **0%**，重掷 3481 → **126**。
   */
  const enforce = (candidate: number[], window: number[][]): number => {
    const near = window.slice(-windowNear)
    let attempts = 0
    // 下限不得超过可用槽数：`domDiff` 的上界就是主控槽个数，`minDom > 主控槽数` 会让
    // 判据**恒真**，进而把判据里 OR 的「总槽差异」那一侧整个短路（`minTotal*` 沦为死参数）。
    // 取 `min(下限, 主控槽数)` 后语义仍成立：主控槽数不足时等价于「主控槽必须全部不同」。
    // 实测（13 维 / 30 条）：主控槽仅 1 个时违约率 9.4% → 0.9%；详见 docs/RISK.md R-68。
    const minDomNearEffective = Math.min(minDomNear, dom.length)
    const minDomFarEffective = Math.min(minDomFar, dom.length)
    /**
     * 过程中「与窗口最不相似」的候选（max-min 的目标值 = 与窗口的最小差异）。
     *
     * 为什么必须有：预算是有限的（`maxAttempt`），耗尽时**不能拿「随机游走的终点」当结果**
     * —— 终点完全可能比起点更差，而它会被原样采用（这是「相似度过高」的直接来源，见 R-68）。
     * 记下 best-so-far 并在收尾择优，可保证「无论预算够不够，结果都不差于过程中出现过的最优」。
     */
    let bestCandidate: number[] | null = null
    let bestScore = -1
    const scoreOf = (value: number[]): number => {
      let min = Number.MAX_SAFE_INTEGER
      for (const point of window) {
        const distance = hamming(value, point)
        if (distance < min) min = distance
      }
      return min
    }
    for (let round = 0; round < maxAttempt; round++) {
      attempts++
      const score = scoreOf(candidate)
      if (score > bestScore) {
        bestScore = score
        bestCandidate = [...candidate]
      }
      let target: number[] | null = null
      let needDom = false
      for (const point of near) {
        if (domDiff(candidate, point, dom) < minDomNearEffective || hamming(candidate, point) < minTotalNear) {
          target = point
          needDom = domDiff(candidate, point, dom) < minDomNearEffective
          break
        }
      }
      if (!target) {
        for (const point of window) {
          if (domDiff(candidate, point, dom) < minDomFarEffective || hamming(candidate, point) < minTotalFar) {
            target = point
            needDom = domDiff(candidate, point, dom) < minDomFarEffective
            break
          }
        }
      }
      if (!target) break
      // ⚠️ 槽位枚举必须用**维度数**（`sizes.length`），不能用重掷轮次。曾经这里写成
      // `Array(n).keys()` 而 `n` 被循环变量遮蔽成轮次：轮次 ≥ 维度数时 `candidate[slot]`
      // 与 `target[slot]` 同为 `undefined` ⇒ 幻影槽位当选 ⇒ `nextValue` 里 `% undefined`
      // 得 NaN ⇒ selection 被撑到 119 长、塞满 NaN（R-69）。
      const sameSlots = [...Array(sizes.length).keys()].filter((slot) => candidate[slot] === target![slot])
      const candidates = needDom ? sameSlots.filter((slot) => dom.includes(slot)).concat(sameSlots) : sameSlots
      // 选在窗口里和当前值重合最多的槽重掷
      let slot = candidates[0] ?? 0
      let bestCount = -1
      for (const candidateSlot of candidates) {
        let count = 0
        for (const point of window) if (candidate[candidateSlot] === point[candidateSlot]) count++
        if (count > bestCount) {
          bestCount = count
          slot = candidateSlot
        }
      }
      candidate[slot] = nextValue(slot, candidate[slot])
    }
    // 收尾择优：预算耗尽时 candidate 可能仍不满足约束，此时改用过程里评分最高的那个。
    // 必须**原地改写**（`candidate` 是调用方持有的引用），不能返回新数组。
    const best = bestCandidate
    if (best && bestScore > scoreOf(candidate)) {
      for (let index = 0; index < candidate.length; index++) candidate[index] = best[index]
    }
    return attempts
  }

  const selections: number[][] = []
  const signatures: string[] = []
  let totalAttempts = 0
  let crossHits = 0

  for (let k = 0; k < count; k++) {
    const candidate = baseCandidate(k)
    totalAttempts += enforce(candidate, selections)

    // 签名去重（含跨批次历史）
    let signature = signatureOf(variables, candidate)
    let guard = 0
    while (used.has(signature) && guard < 40) {
      const s1 = dom[guard % dom.length]
      const secondary = [...Array(n).keys()].filter((slot) => !dom.includes(slot))
      const s2 = secondary.length ? secondary[guard % secondary.length] : (s1 + 1) % n
      candidate[s1] = nextValue(s1, candidate[s1])
      candidate[s2] = nextValue(s2, candidate[s2])
      totalAttempts += enforce(candidate, selections)
      signature = signatureOf(variables, candidate)
      if (used.has(signature)) crossHits++
      guard++
    }
    used.add(signature)
    signatures.push(signature)
    selections.push(candidate)
  }

  return { selections, signatures, totalAttempts, crossBatchHits: crossHits }
}

// ---------------------------------------------------------------------------
// 渲染与对外入口
// ---------------------------------------------------------------------------

/**
 * 渲染骨架：把占位符替换成该维度本轮选中的候选值。
 *
 * 支持两种占位符写法：
 * - `{{维度名}}` —— 本项目的标准写法；
 * - `{维度名}` —— 外部真实资产（如产品线手工配的配方卡）常见写法。
 *
 * 单花括号分支**只替换能对上维度名的标记**，对上不上的原样保留（例：`{M}` 若没有 M 维度，
 * 就留在正文里暴露给用户，而不是静默删掉）。这样即使识别不全也不会丢失信息。
 */
function escapeCampaignRecipeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 骨架里的两条占位符扫描口径（渲染与「正文引用了哪些维度」的判定**共用这一份**）。
 *
 * 为什么必须是常量而不是各处内联：双花括号是项目标准，单花括号是外部真实资产常态
 * （`{M}` / `{S9风格}`）。两处若各写各的，就会出现「渲染认单花括号、判定不认」这类
 * 口径分叉 —— 2026-09-21 实测的跨批次去重静默失效正是这么来的（见 `deriveUsedSignatures`）。
 */
const RECIPE_DOUBLE_BRACE_PATTERN = /\{\{\s*([^{}\r\n]+?)\s*\}\}/gu
const RECIPE_SINGLE_BRACE_PATTERN = /\{\s*([\p{L}\p{N}_]{1,40})\s*\}/gu

/**
 * 正文实际引用了哪些维度名（两种花括号写法都算）。
 *
 * 扫描顺序**先双后单**：先把 `{{名称}}` 消费掉再扫单花括号，否则 `{{S1}}` 的内层
 * `{S1}` 会被重复识别（R-50 的同类坑）。
 *
 * 独立实现而不复用 `campaignRecipeImport.ts` 的 `extractPlaceholders`：依赖方向是
 * import → campaignRecipe，反向引用会成环。两处的单花括号字符类宽度不同（那边兼容
 * 更宽松的外部写法），改动其一时需同步核对。
 */
function referencedDimensionNames(body: string): Set<string> {
  const names = new Set<string>()
  const withoutDouble = body.replace(RECIPE_DOUBLE_BRACE_PATTERN, '\u0000')
  // 双花括号用原文扫（替换后只剩哨兵），单花括号在替换后的文本上扫。
  for (const match of body.matchAll(RECIPE_DOUBLE_BRACE_PATTERN)) names.add(match[1].trim())
  for (const match of withoutDouble.matchAll(RECIPE_SINGLE_BRACE_PATTERN)) names.add(match[1].trim())
  names.delete('')
  return names
}

/**
 * 骨架里**写死**的画幅描述（比例数字 / 方向词）统一改为当前界面尺寸。
 *
 * 为什么需要：真实配方卡资产习惯把画幅写死在骨架里（如 `vertical 9:16 photo`），
 * 但输入栏是可以单独选尺寸的 —— 两者一旦不一致，出图比例与提示词描述就互相打架。
 * 这里让骨架里的写死值**无条件跟随输入栏尺寸**（杰哥 2026-09-20 定的口径：
 * 「自动屏蔽掉写死的，一切以输入框设置的尺寸为准」）。
 *
 * 只做高置信替换：
 * - 比例数字：必须能对上常见画幅表（容差 1.5%），所以 `12:30`（时间）、`1:2` 之外的
 *   随机数字对不会被误伤；`1:1` 这类一位数比例也能命中。
 * - 方向词：只认 `vertical` / `horizontal` —— 它们在英文提示词里基本只指画幅方向；
 *   `square` / `portrait` / `landscape` 语义发散（方形构图、人像题材、风景题材），不动。
 *
 * `builtinValues` 缺比例或方向时不动作（尺寸为 `auto` 或解析失败即属此列）——
 * 宁可保持原样，也不猜一个值写进提示词。
 */
function normalizeHardcodedAspect(body: string, builtinValues?: Record<string, string>) {
  const ratio = builtinValues?.比例
  const orientation = builtinValues?.方向
  if (!ratio && !orientation) return body
  let result = body
  if (ratio) {
    result = result.replace(/\b(\d{1,4})\s*[:：]\s*(\d{1,4})\b/g, (marker, rawWidth: string, rawHeight: string) => {
      const width = Number(rawWidth)
      const height = Number(rawHeight)
      if (!width || !height) return marker
      const value = width / height
      const hit = CAMPAIGN_RECIPE_RATIO_TABLE.some((entry) => Math.abs(entry.ratio - value) / entry.ratio < 0.015)
      return hit ? ratio : marker
    })
  }
  if (orientation) {
    result = result.replace(/\b(?:vertical|horizontal)\b/gi, orientation)
  }
  return result
}

/** 内置变量替换：在维度替换**之后**跑。与维度池同名的内置变量跳过 —— 用户显式定义的维度优先。 */
function applyBuiltinValues(body: string, builtinValues?: Record<string, string>, dimensionNames?: Set<string>) {
  if (!builtinValues) return body
  let result = body
  for (const [name, value] of Object.entries(builtinValues)) {
    if (typeof value !== 'string' || value.length === 0) continue
    if (dimensionNames?.has(name)) continue
    const escaped = escapeCampaignRecipeRegExp(name)
    result = result
      .replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'gu'), value)
      .replace(new RegExp(`\\{\\s*${escaped}\\s*\\}`, 'gu'), value)
  }
  return result
}

function renderRecipeBody(
  body: string,
  dimensions: CampaignRecipeVariable[],
  selection: number[],
  builtinValues?: Record<string, string>,
) {
  const valueByName = new Map(
    dimensions.map((dimension, index) => [dimension.name, dimension.options[selection[index]]]),
  )
  // 先纠正写死的画幅描述（一切以输入栏尺寸为准），再走维度替换 ——
  // 顺序很关键：`{比例}` 这类占位符也要在归一之后才替换，否则归一得到的方向词会被再改一次。
  const normalizedBody = normalizeHardcodedAspect(body, builtinValues)
  const replaced = normalizedBody
    .replace(RECIPE_DOUBLE_BRACE_PATTERN, (marker, rawName: string) => valueByName.get(rawName.trim()) ?? marker)
    // 单花括号引用：名字允许任意语言的字母/数字/下划线组合。
    // 曾经限定为纯 ASCII（`[A-Za-z][A-Za-z0-9_]{0,15}`），导致真实资产里的
    // `{S9风格}`、`{S11标题}` 这类「编号 + 中文」引用**一律替换不到**，
    // 生成出的提示词带着花括号占位符（2026-09-20「快手短剧_信息流」无法生成）。
    // 仍然「对不上维度名就原样保留」，所以正文里成对的合法花括号不会丢信息。
    .replace(RECIPE_SINGLE_BRACE_PATTERN, (marker, rawName: string) => {
      const value = valueByName.get(rawName.trim())
      return value === undefined ? marker : value
    })
  // 内置变量（如 {比例}）是中文名，上面的单花括号正则只认 ASCII 标识符 —— 必须单独跑一遍。
  // 注意：单花括号的中文维度引用不被上面的维度替换支持（ASCII 限制），所以同名跳过
  // 必须在这里做（按维度名集合判断），不能依赖「维度先替换掉就找不到了」。
  return applyBuiltinValues(replaced, builtinValues, valueByName ? new Set(valueByName.keys()) : undefined)
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** FNV-1a：把一个字符串稳定映射成 32 位无符号整数（用于按组确定性地挑固定维度取值）。 */
function hashCampaignRecipeString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * 为第 N 组挑一组「固定维度取值」。同组内所有成员共用它，组与组之间尽量不同
 * （`usedCombos` 保证除非组合空间穷尽，不出现两组固定值完全相同）。
 */
function pickSeriesFixedSelection(
  fixedDimensions: CampaignRecipeVariable[],
  groupIndex: number,
  seed: string,
  usedCombos: Set<string>,
): number[] {
  const pick = (salt: string) =>
    fixedDimensions.map((dimension) => hashCampaignRecipeString(`${salt}|${dimension.name}`) % dimension.options.length)
  const baseSalt = `${seed}|series|${groupIndex}`
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const selection = pick(attempt === 0 ? baseSalt : `${baseSalt}|${attempt}`)
    const key = selection.join(',')
    if (!usedCombos.has(key)) {
      usedCombos.add(key)
      return selection
    }
  }
  // 固定维度组合空间已穷尽（例如只有一个组合）：允许重复，但组内一致性不受影响。
  return pick(baseSalt)
}

/**
 * 系列模式下判定「组内应保持一致」的维度名关键词。
 *
 * 为什么按名字判：配方卡的维度名是资产作者起的（`S9风格` / `M` / `S2动作`…），
 * 与通用系列维度库（画风/构图/…）**完全不重叠**，无法靠库映射；
 * 而画风、光线、版式这类维度一旦组内变化，整组就不像一套图 —— 这是系列图最忌讳的。
 * 覆盖中英文两种命名习惯（真实资产两种都有）。
 */
const CAMPAIGN_RECIPE_SERIES_CONSISTENCY_KEYWORDS = [
  '风格',
  '画风',
  '色调',
  '色彩',
  '配色',
  '光线',
  '光影',
  '视角',
  '构图',
  '布局',
  '版式',
  '字体',
  '形式',
  '类型',
  'style',
  'tone',
  'palette',
  'color',
  'colour',
  'lighting',
  'light',
  'angle',
  'composition',
  'layout',
  'format',
  'font',
  'typeface',
]

/**
 * 系列模式下判定「组内应当变化」的维度名关键词。**优先级高于一致性关键词** ——
 * 「背景氛围」既含「背景」（该变）又可能被误判，一律以变化为准。
 *
 * 刻意不放「人物」「角色」：`S1人物风格` 要的是「同一批人物的画风」，属于该固定的部分。
 */
const CAMPAIGN_RECIPE_SERIES_VARIABLE_KEYWORDS = [
  '动作',
  '场景',
  '标题',
  '文案',
  '内容',
  '主体',
  '背景',
  '环境',
  'action',
  'scene',
  'title',
  'copy',
  'content',
  'subject',
  'background',
]

/**
 * 推导系列模式下缺省的「组内固定维度」：主控槽 ∪ 名字命中风格/形式类关键词的维度，
 * 且排除命中内容类关键词的维度。
 *
 * 全部落空时返回空数组 —— 调用方据此退化为普通采样（不静默改变行为）。
 */
export function resolveCampaignRecipeSeriesFixedDimensions(dimensions: CampaignRecipeDimension[]): string[] {
  const dominant = new Set(resolveEffectiveDominantSlots(dimensions))
  const result: string[] = []
  for (const dimension of dimensions) {
    const name = dimension.name
    if (CAMPAIGN_RECIPE_SERIES_VARIABLE_KEYWORDS.some((keyword) => name.includes(keyword))) continue
    const consistency = CAMPAIGN_RECIPE_SERIES_CONSISTENCY_KEYWORDS.some((keyword) =>
      name.toLocaleLowerCase().includes(keyword),
    )
    if (dominant.has(name) || consistency) result.push(name)
  }
  return result
}

/**
 * 采样入口：单图模式直接跑最远点采样；**系列模式按「组」采样**。
 *
 * 系列图的语义是「组内像一套、组间不重样」：同一组里固定维度取值一致，
 * 只在变化维度上拉开差异。配方卡的维度体系（`S9风格` / `M` / …）与通用系列维度库
 * （画风/构图/…）完全不重叠，所以组内固定项必须在**配方卡自己的维度**上表达
 * （见 options.seriesFixedDimensions，缺省取主控槽）。
 *
 * 组与组之间共用同一份 `usedSignatures`，因此每组的「变化维度组合」也互不重复 ——
 * 一组就是一种内容组合，符合系列图「一组讲一个内容」的预期。
 */
function sampleCampaignRecipeSelections(
  dimensions: CampaignRecipeVariable[],
  requestedCount: number,
  options: CampaignRecipeSamplingOptions,
  series: { groupSize: number; fixedDimensionNames?: string[] },
): CampaignRecipeSamplingResult {
  const fixedNames = new Set(series.fixedDimensionNames ?? [])
  const fixedIndices: number[] = []
  const variableIndices: number[] = []
  dimensions.forEach((dimension, index) => {
    if (fixedNames.has(dimension.name)) fixedIndices.push(index)
    else variableIndices.push(index)
  })
  // 组内约束只在「真的有固定项、也真的有可变化项」时启用；
  // 否则退化为普通采样 —— 不静默改变既有行为。
  if (series.groupSize <= 1 || fixedIndices.length === 0 || variableIndices.length === 0) {
    return farthestPointSample(dimensions, requestedCount, options)
  }

  const fixedDimensions = fixedIndices.map((index) => dimensions[index])
  const variableDimensions = variableIndices.map((index) => dimensions[index])
  // 主控槽里落在「变化维度」上的那些，继续在组内起主导作用（下标映射到子数组）
  const variableSet = new Set(variableIndices)
  const allDominant = options.dominantIndices ?? dimensions.map((_, index) => index)
  const variableDominant = allDominant
    .filter((index) => variableSet.has(index))
    .map((index) => variableIndices.indexOf(index))

  const selections: number[][] = []
  const signatures: string[] = []
  let totalAttempts = 0
  let crossBatchHits = 0
  const usedFixedCombos = new Set<string>()
  const groupCount = Math.ceil(requestedCount / series.groupSize)

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const size = Math.min(series.groupSize, requestedCount - groupIndex * series.groupSize)
    if (size <= 0) break
    const fixedSelection = pickSeriesFixedSelection(fixedDimensions, groupIndex, options.seed, usedFixedCombos)
    const sampledVariables = farthestPointSample(variableDimensions, size, {
      ...options,
      // 每组必须换 seed：`baseCandidate(k)` 只由 `seed + k` 决定，沿用同一个 seed 会让
      // 每组的「变化维度」出发点序列**完全相同** —— 实测 3 组的 M 槽取值都是 `3,2,1,0`，
      // 组间只剩 40 轮 L3 签名重掷在兜，且完全不接 L2 的 max-min 约束（R-70）。
      seed: `${options.seed}|group|${groupIndex}`,
      dominantIndices: variableDominant.length ? variableDominant : undefined,
    })
    totalAttempts += sampledVariables.totalAttempts
    crossBatchHits += sampledVariables.crossBatchHits
    for (const variableSelection of sampledVariables.selections) {
      const merged = new Array<number>(dimensions.length).fill(0)
      fixedIndices.forEach((dimensionIndex, position) => {
        merged[dimensionIndex] = fixedSelection[position]
      })
      variableIndices.forEach((dimensionIndex, position) => {
        merged[dimensionIndex] = variableSelection[position]
      })
      selections.push(merged)
      signatures.push(signatureOf(dimensions, merged))
    }
  }

  return { selections, signatures, totalAttempts, crossBatchHits }
}

/**
 * 配方卡批量生成主入口。
 *
 * 去重优先级：usedSignatures（跨批次，权威）→ existingPrompts（文本兜底）→ 本批已用。
 * 候选值不足时不会静默重复：宁可少给（exhausted=true），也不产出两条一样的提示词。
 */
export function generateCampaignRecipeBatch(
  config: CampaignRecipeConfig,
  options: CampaignRecipeGenerationOptions,
): CampaignRecipeGenerationResult {
  const errors = validateCampaignRecipeConfig(config)
  if (errors.length > 0) throw new Error(`配方卡格式有误：${errors[0]}`)
  // 超长池先截断（真实资产里常见「一个候选值 = 一整段长文本」，池可能有几百条），
  // 截断结果通过 truncatedDimensions 回传，由调用方提示用户，不静默丢数据。
  const { dimensions: usableDimensions, truncated } = truncateOversizedDimensions(config.dimensions)
  const body = config.body
  const dimensions: CampaignRecipeVariable[] = usableDimensions
  const requestedCount = Math.max(1, Math.trunc(options.count))
  const usedSignatures = options.usedSignatures ?? new Set<string>()
  const existing = new Set((options.existingPrompts ?? []).map((prompt) => prompt.trim()).filter(Boolean))

  const combinationCount = dimensions.reduce((total, dimension) => {
    if (total >= Number.MAX_SAFE_INTEGER / dimension.options.length) return Number.MAX_SAFE_INTEGER
    return total * dimension.options.length
  }, 1)

  const samplingOptions = {
    ...options,
    // seed 缺省时由配方卡内容派生：同一张配方卡默认结果稳定可复现
    seed: options.seed?.trim() || `${body}|${dimensions.map((item) => item.name).join(',')}`,
    // 显式传入的 dominantIndices 优先；否则按候选值声明的 weight 推导主控槽
    dominantIndices: options.dominantIndices ?? pickDominantIndices(usableDimensions),
    usedSignatures,
  }

  const grouped = sampleCampaignRecipeSelections(dimensions, requestedCount, samplingOptions, {
    groupSize: Math.max(1, Math.trunc(options.seriesGroupSize ?? 1)),
    // 缺省固定项 = 主控槽 + 风格/形式类维度（剔除内容类维度）；显式传入时以传入为准
    fixedDimensionNames: options.seriesFixedDimensions?.length
      ? options.seriesFixedDimensions
      : resolveCampaignRecipeSeriesFixedDimensions(usableDimensions),
  })
  const sampled = grouped

  // 采样是最耗时的一步（大池 + 多次重掷），拿到结果先看有没有被取消，
  // 避免「点了取消还要把整批渲染完」。
  throwIfCampaignRecipeAborted(options.signal)

  const samples: CampaignRecipeSample[] = []
  for (let index = 0; index < sampled.selections.length; index++) {
    // 每 50 条查一次取消，兼顾响应速度与循环开销
    if (index > 0 && index % 50 === 0) throwIfCampaignRecipeAborted(options.signal)
    const selection = sampled.selections[index]
    const prompt = renderRecipeBody(body, dimensions, selection, options.builtinValues)
    // 文本兜底去重：签名不同但渲染结果相同（如不同维度取值恰好渲染成同一句）时跳过
    if (existing.has(prompt) || samples.some((sample) => sample.prompt === prompt)) continue
    const values: Record<string, string> = {}
    dimensions.forEach((dimension, dimensionIndex) => {
      values[dimension.name] = dimension.options[selection[dimensionIndex]]
    })
    samples.push({ prompt, selection, values, signature: sampled.signatures[index] })
  }

  return {
    samples,
    signatures: samples.map((sample) => sample.signature),
    combinationCount,
    requestedCount,
    exhausted: samples.length < requestedCount,
    totalAttempts: sampled.totalAttempts,
    crossBatchHits: sampled.crossBatchHits,
    truncatedDimensions: truncated,
  }
}

/** 只取渲染后的提示词数组（调用方最常用的形态）。 */
export function renderCampaignRecipePrompts(
  config: CampaignRecipeConfig,
  options: CampaignRecipeGenerationOptions,
): string[] {
  return generateCampaignRecipeBatch(config, options).samples.map((sample) => sample.prompt)
}

// ---------------------------------------------------------------------------
// 内置变量：尺寸 → 比例 / 方向（供配方卡骨架用 {比例} / {方向} / {尺寸} 注入）
// ---------------------------------------------------------------------------

/** 常见画幅比例（宽/高比 → 标注），命中容差 1.5%；查不到再退回 gcd 约分。 */
const CAMPAIGN_RECIPE_RATIO_TABLE: Array<{ ratio: number; label: string }> = [
  { ratio: 1, label: '1:1' },
  { ratio: 5 / 4, label: '5:4' },
  { ratio: 4 / 5, label: '4:5' },
  { ratio: 4 / 3, label: '4:3' },
  { ratio: 3 / 4, label: '3:4' },
  { ratio: 3 / 2, label: '3:2' },
  { ratio: 2 / 3, label: '2:3' },
  { ratio: 16 / 9, label: '16:9' },
  { ratio: 9 / 16, label: '9:16' },
  { ratio: 16 / 10, label: '16:10' },
  { ratio: 10 / 16, label: '10:16' },
  { ratio: 21 / 9, label: '21:9' },
  { ratio: 9 / 21, label: '9:21' },
  { ratio: 2 / 1, label: '2:1' },
  { ratio: 1 / 2, label: '1:2' },
]

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * 把生图尺寸（如 "1280x720"）解析成配方卡内置变量。
 *
 * 返回的三个键对应骨架里的 `{比例}` / `{方向}` / `{尺寸}` 占位符：
 * - 比例：查常见画幅表（16:9 / 3:4 …），查不到退回 gcd 约分；
 * - 方向：horizontal / vertical / square —— 英文词，可直接嵌入英文提示词；
 * - 尺寸：原始 `宽x高` 文本。
 *
 * 解析失败（空串 / 非数字 / 零）返回 undefined —— 调用方就不传内置变量，
 * 骨架里的占位符按既有约定原样保留，由占位符检查暴露，不静默编一个值。
 */
export function describeCampaignRecipeSize(size: string): Record<string, string> | undefined {
  const match = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i.exec(size ?? '')
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  const ratio = width / height
  const hit = CAMPAIGN_RECIPE_RATIO_TABLE.find((entry) => Math.abs(entry.ratio - ratio) / entry.ratio < 0.015)
  const divisor = gcd(width, height)
  const ratioLabel = hit ? hit.label : `${width / divisor}:${height / divisor}`
  const orientation = ratio > 1.02 ? 'horizontal' : ratio < 0.98 ? 'vertical' : 'square'
  return {
    比例: ratioLabel,
    方向: orientation,
    尺寸: `${width}x${height}`,
  }
}

/**
 * 计算一批采样结果内两两之间的最小差异（归一化，0~1），用于验收「两两差异够大」。
 */
export function computeBatchMinDistance(dimensions: CampaignRecipeVariable[], samples: CampaignRecipeSample[]): number {
  if (samples.length < 2 || dimensions.length === 0) return 1
  let minDistance = 1
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const distance = hamming(samples[i].selection, samples[j].selection) / dimensions.length
      if (distance < minDistance) minDistance = distance
    }
  }
  return minDistance
}

/** 从任意结构反解出配方卡配置（用于手工资产与持久化数据的兼容解析）。 */
export function parseCampaignRecipeConfig(value: unknown): CampaignRecipeConfig | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const body = typeof record.body === 'string' ? record.body : ''
  const rawDimensions = Array.isArray(record.dimensions) ? record.dimensions : []
  const dimensions: CampaignRecipeDimension[] = []
  for (const item of rawDimensions) {
    if (!item || typeof item !== 'object') continue
    const dimension = item as Record<string, unknown>
    const name = typeof dimension.name === 'string' ? dimension.name.trim() : ''
    const options = Array.isArray(dimension.options)
      ? dimension.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
      : []
    if (!name || options.length === 0) continue
    const parsed: CampaignRecipeDimension = { name, options }
    // weight 影响主控槽选择，必须保留（丢掉会让采样退化回「全槽平等」）
    if (typeof dimension.weight === 'number' && Number.isFinite(dimension.weight) && dimension.weight > 0) {
      parsed.weight = dimension.weight
    }
    dimensions.push(parsed)
  }
  if (!body.trim() || dimensions.length === 0) return null
  return { body, dimensions }
}

// ---------------------------------------------------------------------------
// 配方卡判定（全应用唯一实现）
// ---------------------------------------------------------------------------

/**
 * 判定一个 SOP 是否走「配方卡引擎」本地生成分支。
 *
 * **本函数是全应用唯一的判定实现**，SOP 库列表 / 管理中心 / 批量弹窗 / 生成引擎
 * 一律从这里导入，不要再各写一份内联判断。
 *
 * 为什么必须唯一：判定口径一旦分叉，就会出现「引擎能认出、界面认不出」（或反过来）的
 * 展示与执行割裂 —— 用户看到的是普通 SOP，实际却走了本地引擎，反之亦然。这类问题
 * 在界面**看不出任何异常**，只能靠人工比对配置才能发现（本就是 R-53 / R-54 的病根）。
 *
 * 放在本模块而非 `storeSopGeneration` 的原因：后者在 `GallerySopBatchModal` 的测试里
 * 被 `vi.mock` **整体替换**（见 R-46），弹窗一旦从它导入任何函数，mock 未覆盖时
 * 会一次性弄挂该文件全部生成相关用例。本模块只依赖 type，可被 UI 安全导入。
 *
 * 命中任一即成立：
 * 1. 带 `campaignRecipe` 字段 —— 新资产的标准形态；
 * 2. `executionMode === 'campaign-recipe'` —— 兼容「只补了执行模式」的旧数据；
 * 3. `content` 是一段含 body + dimensions 的 JSON —— 手工资产形态（见下方解析函数）。
 */
export function isCampaignRecipeSop(
  sop:
    (Partial<Pick<SopLibraryItemLike, 'campaignRecipe' | 'executionMode'>> & { content?: string }) | null | undefined,
): boolean {
  if (!sop) return false
  if (sop.campaignRecipe) return true
  if (sop.executionMode === 'campaign-recipe') return true
  return parseCampaignRecipeConfigFromContent(sop.content ?? '') !== null
}

/** 判定只需要这几个字段，避免本模块反向依赖 SopLibraryItem 的完整定义。 */
interface SopLibraryItemLike {
  campaignRecipe?: SopCampaignRecipeConfig | null
  executionMode?: string | null
}

/**
 * 从纯文本正文反解配方卡配置。
 *
 * 兼容「用 JSON 正文存配方卡」的手工资产形态：content 直接放一段
 * {"body":"...","dimensions":[{"name":"...","options":["..."]}]} 即可被执行分支识别，
 * 不需要额外迁移脚本。解析失败返回 null，由调用方报「配置缺失」。
 */
export function parseCampaignRecipeConfigFromContent(content: string): SopCampaignRecipeConfig | null {
  const text = content?.trim()
  if (!text || !text.startsWith('{')) return null
  try {
    return parseCampaignRecipeConfig(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

/**
 * 该 SOP 是否由本地算法生成提示词（配方卡 / 变量提示词），即：不调用 AI 文本模型。
 *
 * 用于「记录模型名」「界面展示模型名」这类需要区分本地/远端的场景 ——
 * 本地分支跑出来的 run 不该带上文本模型名，否则用户会误以为走了 AI（见 R-54）。
 */
export function isLocalGenerationSop(
  sop:
    (Partial<Pick<SopLibraryItemLike, 'campaignRecipe' | 'executionMode'>> & { content?: string }) | null | undefined,
): boolean {
  if (!sop) return false
  return isCampaignRecipeSop(sop) || sop.executionMode === 'variable-prompt'
}

/**
 * 从已产出的提示词文本反推其组合签名。
 *
 * 用途：跨批次去重需要「历史用过的签名集合」，但历史以**文本**形式持久化
 * （`SopBatchSnapshot.prompts[].text`）。签名本身是「各维度选项名用 | 拼串」，
 * 被渲染成正文后无法直接还原，所以这里改为反向推导：
 * 对每条历史文本，找出「每个维度的哪个候选值出现在其中」的组合；
 * 只有当某个维度**恰好只有一个候选值命中**时才记录，多个命中（一个选项名是另一个的子串）
 * 或零命中（正文没用到该维度）时放弃该维度的约束，用通配符 `*` 占位。
 *
 * 这样得到的签名与 `signatureOf` 的产物在「可确定」的维度上一致，
 * 用于把历史组合排除出候选池；无法确定的历史条目不会误伤新组合。
 */
export function deriveUsedSignatures(config: CampaignRecipeConfig, existingPrompts: string[]): Set<string> {
  const signatures = new Set<string>()
  const { body, dimensions } = config
  // 正文压根没用到的维度不参与签名（与 signatureOf 对齐：它按全部维度拼串，
  // 但渲染后未使用的维度在文本里不可见，这里只能按「可确定维度」近似）。
  //
  // ⚠️ 这里曾经写成 `body.includes(`{{${dimension.name}}}`)` —— 只认双花括号，而外部真实
  // 资产的骨架用的是单花括号（`{M}` / `{S1主体}`）。于是 referenced 恒为空集，每个维度
  // 都走下方 `parts.push('*')` 分支 → **整批历史塌缩成同一条签名 `*|*|…|*`**，它与任何
  // 真实签名（选项名拼串）都不相等 ⇒ 跨批次去重静默失效（2026-09-21 实测：真实资产
  // 批间重复 10/10，同一份配置换成双花括号骨架则是 0/10）。详见 docs/RISK.md 的 R-66。
  const referenced = referencedDimensionNames(body)
  const usedInBody = dimensions.filter((dimension) => referenced.has(dimension.name.trim()))

  for (const rawPrompt of existingPrompts) {
    const prompt = rawPrompt.trim()
    if (!prompt) continue
    const parts: string[] = []
    let determinable = true
    for (const dimension of dimensions) {
      if (!usedInBody.includes(dimension)) {
        // 正文未使用的维度：对该条历史而言无信息，用通配符占位
        parts.push('*')
        continue
      }
      const matched = dimension.options.filter((option) => prompt.includes(option))
      if (matched.length === 1) {
        parts.push(matched[0])
      } else {
        // 0 个命中（正文被用户改过）或多个命中（选项名互为子串）→ 该维度不可确定
        determinable = false
        break
      }
    }
    if (determinable) signatures.add(parts.join('|'))
  }
  return signatures
}

/**
 * 判断一条历史提示词是否由本配方卡渲染而来（用于筛选「同一张配方卡的历史」）。
 * 宽松判定：正文中出现的**维度占位符之外**的固定片段（取最长的连续非占位片段）必须出现在历史里。
 */
export function looksLikeRecipeOutput(config: CampaignRecipeConfig, prompt: string): boolean {
  const { body } = config
  // 拆出正文里的固定片段（把 {{...}} 换成哨兵后按哨兵切分）
  const segments = body
    .split(/\{\{\s*[^{}\r\n]+?\s*\}\}/gu)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2)
  if (segments.length === 0) return false
  const longest = segments.reduce((best, current) => (current.length > best.length ? current : best), '')
  return prompt.includes(longest)
}
