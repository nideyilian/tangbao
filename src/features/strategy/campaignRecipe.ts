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
}

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
 */
export function sanitizeCampaignRecipeConfig(config: CampaignRecipeConfig): {
  config: CampaignRecipeConfig
  removed: string[]
} {
  const removed: string[] = []
  const dimensions = (config.dimensions ?? []).map((dimension) => {
    const options = (dimension.options ?? []).filter((option) => {
      const violations = findCampaignRecipeViolations(option)
      if (violations.length === 0) return true
      removed.push(`维度「${dimension.name}」候选值「${option}」（命中：${violations.join('、')}）`)
      return false
    })
    return { name: dimension.name, options }
  })
  const bodyViolations = findCampaignRecipeViolations(config.body ?? '')
  if (bodyViolations.length > 0) {
    removed.push(`提示词骨架（命中：${bodyViolations.join('、')}）`)
  }
  return {
    config: { body: bodyViolations.length > 0 ? '' : config.body, dimensions },
    removed,
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

function hamming(left: number[], right: number[]): number {
  let distance = 0
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) distance += 1
  return distance
}

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
 * 2. 近层/远层双层硬约束：近层窗口（默认最近 10 条）总槽差异 ≥ 7 且主控槽 ≥ 2；
 *    远层窗口（默认 80 条）放宽到总槽 ≥ 6 且主控槽 ≥ 2。不满足就定向重掷「冲突最多的槽」，
 *    主控槽不足时优先重掷主控槽。
 * 3. 签名去重：撞历史签名（跨批次）或本批已用时继续重掷，最多 40 轮。
 */
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

  /** 贪心 max-min：对所有窗口组合逐对检查，定向重掷冲突最多的槽（主控优先） */
  const enforce = (candidate: number[], window: number[][]): number => {
    const near = window.slice(-windowNear)
    let attempts = 0
    // ⚠️ 保真移植：原始代码此处循环变量名为 n，遮蔽了函数外的 const n = variables.length，
    // 导致下方 [...Array(n).keys()] 实际用的是「重掷轮次」而非「维度总数」。
    // 后果：轮次 0 时 sameSlots 恒为空 → 只重掷第 0 槽；轮次 k 时只在前 k 个槽里挑。
    // 这是原始实现的行为（疑似 n 命名冲突的笔误），但已影响实际采样分布，
    // 故此处逐字保留以维持结果一致 —— 详见 docs/RISK.md 的配方卡引擎条目。
    for (let n = 0; n < maxAttempt; n++) {
      attempts++
      let target: number[] | null = null
      let needDom = false
      for (const point of near) {
        if (domDiff(candidate, point, dom) < minDomNear || hamming(candidate, point) < minTotalNear) {
          target = point
          needDom = domDiff(candidate, point, dom) < minDomNear
          break
        }
      }
      if (!target) {
        for (const point of window) {
          if (domDiff(candidate, point, dom) < minDomFar || hamming(candidate, point) < minTotalFar) {
            target = point
            needDom = domDiff(candidate, point, dom) < minDomFar
            break
          }
        }
      }
      if (!target) break
      const sameSlots = [...Array(n).keys()].filter((slot) => candidate[slot] === target![slot])
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

function renderRecipeBody(body: string, dimensions: CampaignRecipeVariable[], selection: number[]) {
  const valueByName = new Map(
    dimensions.map((dimension, index) => [dimension.name, dimension.options[selection[index]]]),
  )
  return body
    .replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/gu, (marker, rawName: string) => valueByName.get(rawName.trim()) ?? marker)
    .replace(/[ \t]+\n/g, '\n')
    .trim()
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
  const { body, dimensions } = config
  const requestedCount = Math.max(1, Math.trunc(options.count))
  const usedSignatures = options.usedSignatures ?? new Set<string>()
  const existing = new Set((options.existingPrompts ?? []).map((prompt) => prompt.trim()).filter(Boolean))

  const combinationCount = dimensions.reduce((total, dimension) => {
    if (total >= Number.MAX_SAFE_INTEGER / dimension.options.length) return Number.MAX_SAFE_INTEGER
    return total * dimension.options.length
  }, 1)

  const sampled = farthestPointSample(dimensions, requestedCount, {
    ...options,
    // seed 缺省时由配方卡内容派生：同一张配方卡默认结果稳定可复现
    seed: options.seed?.trim() || `${body}|${dimensions.map((item) => item.name).join(',')}`,
    usedSignatures,
  })

  const samples: CampaignRecipeSample[] = []
  for (let index = 0; index < sampled.selections.length; index++) {
    const selection = sampled.selections[index]
    const prompt = renderRecipeBody(body, dimensions, selection)
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
  }
}

/** 只取渲染后的提示词数组（调用方最常用的形态）。 */
export function renderCampaignRecipePrompts(
  config: CampaignRecipeConfig,
  options: CampaignRecipeGenerationOptions,
): string[] {
  return generateCampaignRecipeBatch(config, options).samples.map((sample) => sample.prompt)
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
    dimensions.push({ name, options })
  }
  if (!body.trim() || dimensions.length === 0) return null
  return { body, dimensions }
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
  const usedInBody = dimensions.filter((dimension) => body.includes(`{{${dimension.name}}}`))

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
