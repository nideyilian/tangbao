import { parseCampaignRecipeConfig, type CampaignRecipeConfig } from './campaignRecipe'

/**
 * 配方卡整段文本解析器。
 *
 * 背景：真实的配方卡资产多以 JSON 或「键: 值 + 列表」的自由排版存在，手工拆成
 * 骨架 + 维度池两栏极其耗时且易错，因此提供「整段粘贴 → 自动识别」的入口。
 *
 * 识别顺序（命中即返回，不叠加）：
 * 1. JSON —— 包含 `campaignRecipe` 的资产、裸配方对象、SOP 库导出片段；
 * 2. 自由排版文本 —— `name:` / `desc:` / `template:` / `master:` / `pools:` 等键值块。
 *
 * 解析原则：**宁可少提取也不要乱填**。认不出的字段一律留空并在 `warnings` 里说明，
 * 由用户在可编辑表单里补齐 —— 静默编造一个错误的配方比报错危害大得多。
 */

export interface ParsedCampaignRecipeDimension {
  name: string
  options: string[]
  /** 权重（master 条目常见）。仅作展示，采样时不参与权重计算。 */
  weight?: number
  /** 中文名 → 英文描述（真实资产里维度值常带 en 字段）。 */
  englishByOption?: Record<string, string>
}

export interface ParsedCampaignRecipe {
  /** 配方名称，识不出时为空串。 */
  name: string
  /** 说明 / 描述，识不出时为空串。 */
  desc: string
  /** 骨架正文；识不出时为空串。 */
  body: string
  /** 维度池（含无选项的占位维度）。 */
  dimensions: ParsedCampaignRecipeDimension[]
  /** 模板里用到但候选池缺失的占位符（需要用户补候选值，否则引擎会拒绝）。 */
  missingPools: string[]
  /** 声明的主控槽名（来自 `dominant` 字段 / 解析推导），供 UI 展示。 */
  dominantSlots: string[]
  /** 是否保留原资产的元信息（仅信息性，不参与采样）。 */
  meta: { model?: string; forbidden?: string[]; headlineSlot?: string }
  /** 是否有可用的骨架 + 至少一个维度，决定解析是否算「成功」。 */
  ok: boolean
  /** 失败原因（ok=false 时非空）。 */
  error: string
  /** 非致命提示（如字段留空、有池无值），供 UI 提示用户确认。 */
  warnings: string[]
  /** 识别来源，便于 UI 说明与排查。 */
  source: 'json' | 'text'
}

/** 空结果骨架，避免各处重复构造。 */
function emptyResult(source: 'json' | 'text'): ParsedCampaignRecipe {
  return {
    name: '',
    desc: '',
    body: '',
    dimensions: [],
    missingPools: [],
    dominantSlots: [],
    meta: {},
    ok: false,
    error: '',
    warnings: [],
    source,
  }
}

// ---------------------------------------------------------------------------
// 文本工具
// ---------------------------------------------------------------------------

/** 双花括号占位符 `{{名称}}`（本项目标准写法）。 */
const DOUBLE_BRACE_PATTERN = /\{\{\s*([^{}\r\n]+?)\s*\}\}/gu
/** 单花括号占位符 `{名称}`（外部真实资产常见写法）。 */
const SINGLE_BRACE_PATTERN = /\{\s*([A-Za-z][A-Za-z0-9_]{0,15}|[^{}\r\n]{1,12}?)\s*\}/gu

/** 抽取骨架里的占位符名，按出现顺序去重。两种花括号写法都识别。 */
export function extractPlaceholders(body: string): string[] {
  const names: string[] = []
  const push = (raw: string) => {
    const name = raw.trim()
    if (name && !names.includes(name)) names.push(name)
  }
  for (const match of body.matchAll(DOUBLE_BRACE_PATTERN)) push(match[1])
  // 双花括号已在上一轮消费，剩余的单花括号才是候选（避免把 {{X}} 误读成 {X}）
  const withoutDouble = body.replace(DOUBLE_BRACE_PATTERN, '\u0000')
  for (const match of withoutDouble.matchAll(SINGLE_BRACE_PATTERN)) push(match[1])
  return names
}

/** 全角转半角（仅 ASCII 可见字符区），让中英文冒号/括号/逗号统一处理。 */
function toHalfWidth(value: string): string {
  return value.replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

/**
 * 归一化「键」：去空白、全角转半角、小写。
 * 这样 `S1` / `s1` / `Ｓ1` / `  S1  ` 都归到同一个键。
 */
function normalizeKey(raw: string): string {
  return toHalfWidth(raw).replace(/\s+/gu, '').toLowerCase()
}

/** 去掉行首的编号与项目符号：`1.` `1、` `(2)` `三、` `-` `*` `•`。 */
function stripListPrefix(line: string): string {
  return line
    .replace(/^\s*[(（]?\s*\d+\s*[)）.、,，:：]\s*/u, '')
    .replace(/^\s*[(（]?\s*[一二三四五六七八九十]+\s*[)）.、,，:：]\s*/u, '')
    .replace(/^\s*[-*•·—]+\s*/u, '')
    .trim()
}

/** 按中英文冒号或制表符首次出现处切分 `key: value`。 */
function splitKeyValue(line: string): { key: string; value: string } | null {
  const match = /^([^:：\t]{1,40})[:：\t](.*)$/u.exec(line)
  if (!match) return null
  return { key: match[1].trim(), value: match[2].trim() }
}

/** 拆候选值行：支持中英文逗号、分号、竖线、顿号、空格分隔。 */
function splitOptions(value: string): string[] {
  return value
    .split(/[,，;；|、\t]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// JSON 分支
// ---------------------------------------------------------------------------

function toDimension(name: string, rawOptions: unknown): ParsedCampaignRecipeDimension {
  const dimension: ParsedCampaignRecipeDimension = { name, options: [] }
  if (!Array.isArray(rawOptions)) return dimension
  const english: Record<string, string> = {}
  for (const entry of rawOptions) {
    if (typeof entry === 'string') {
      const label = entry.trim()
      if (label) dimension.options.push(label)
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    // 兼容 key / name / value / 中文名 多种字段名
    const key = [record.key, record.name, record.value, record.label, record['中文名']].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0,
    )
    if (!key?.trim()) continue
    const label = key.trim()
    dimension.options.push(label)
    if (typeof record.en === 'string' && record.en.trim()) english[label] = record.en.trim()
    if (typeof record.weight === 'number' && Number.isFinite(record.weight) && dimension.weight === undefined) {
      dimension.weight = record.weight
    }
  }
  if (Object.keys(english).length > 0) dimension.englishByOption = english
  return dimension
}

/** 从任意对象里抽出配方卡三要素：name / desc / body / dimensions。 */
function readRecipeObject(record: Record<string, unknown>, result: ParsedCampaignRecipe): boolean {
  if (typeof record.name === 'string' && record.name.trim()) result.name = record.name.trim()
  else if (typeof record.title === 'string' && record.title.trim()) result.name = record.title.trim()

  for (const field of ['desc', 'description', '说明'] as const) {
    if (typeof record[field] === 'string' && (record[field] as string).trim()) {
      result.desc = (record[field] as string).trim()
      break
    }
  }

  // 骨架：template / body / prompt / skeleton 任一
  for (const field of ['template', 'body', 'prompt', 'skeleton'] as const) {
    if (typeof record[field] === 'string' && (record[field] as string).trim()) {
      result.body = (record[field] as string).trim()
      break
    }
  }

  const rawPools = (record.pools ?? record.dimensions ?? record.pool) as unknown
  if (rawPools && typeof rawPools === 'object') {
    if (Array.isArray(rawPools)) {
      // [{name, options}] 形态
      for (const entry of rawPools) {
        if (!entry || typeof entry !== 'object') continue
        const item = entry as Record<string, unknown>
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        if (!name) continue
        result.dimensions.push(toDimension(name, item.options ?? item.values))
      }
    } else {
      const pools = rawPools as Record<string, unknown>
      // 保持原对象键顺序（JSON 键序即作者意图：S1…S12）
      for (const [rawName, rawOptions] of Object.entries(pools)) {
        const name = rawName.trim()
        if (!name) continue
        // 对象形态的池：{ "S1": { "值": "en" } }
        if (rawOptions && !Array.isArray(rawOptions) && typeof rawOptions === 'object') {
          const entries = Object.entries(rawOptions as Record<string, unknown>)
          result.dimensions.push(
            toDimension(
              name,
              entries.map(([key, value]) => (typeof value === 'string' ? { key, en: value } : { key })),
            ),
          )
          continue
        }
        result.dimensions.push(toDimension(name, rawOptions))
      }
    }
  }

  // master 区块：模板里的主体槽（真实资产用 `{M}` 引用）。
  // 槽名从模板推断 —— 优先取模板中「用不上 pools 键」的占位符，例如 {M}。
  const master = record.master ?? record.masters
  if (Array.isArray(master) && master.length > 0) {
    const poolKeys = new Set(result.dimensions.map((dimension) => dimension.name))
    const freeSlots = extractPlaceholders(result.body).filter((name) => !poolKeys.has(name))
    const slotName = freeSlots[0] ?? 'M'
    const existing = result.dimensions.find((dimension) => dimension.name === slotName)
    if (existing && existing.options.length === 0) {
      const filled = toDimension(slotName, master)
      existing.options = filled.options
      existing.weight = filled.weight
      existing.englishByOption = filled.englishByOption
    } else if (!existing) {
      result.dimensions.push(toDimension(slotName, master))
    }
  }

  // dominant：原资产用它声明「差异优先保证的槽」。转成维度 weight 交给引擎，
  // 比忽略它更贴近作者意图（headline_slot 通常是其中权重最高的那个）。
  const headlineSlot = typeof record.headline_slot === 'string' ? record.headline_slot.trim() : ''
  if (headlineSlot && !result.meta.headlineSlot) result.meta.headlineSlot = headlineSlot
  const dominant = Array.isArray(record.dominant)
    ? record.dominant.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
    : typeof record.dominant === 'string'
      ? splitOptions(record.dominant)
      : []
  if (dominant.length > 0) {
    result.dominantSlots = dominant
    for (const dimension of result.dimensions) {
      if (!dominant.includes(dimension.name)) continue
      // headline_slot 权重更高（它直接决定画面大标题），其余主控槽次之
      dimension.weight = dimension.name === headlineSlot ? 3 : 2
    }
  }

  if (typeof record.model === 'string' && record.model.trim()) result.meta.model = record.model.trim()
  if (Array.isArray(record.forbidden)) {
    result.meta.forbidden = record.forbidden.filter((item): item is string => typeof item === 'string')
  }

  // headline_slot 只用于提示主控槽，不构成解析失败
  return Boolean(result.body)
}

/** 在 JSON 树里找出「像配方对象」的那个节点（含 campaignRecipe 字段或带 template+pools）。 */
function findRecipeNode(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || depth > 5) return null
  if (Array.isArray(value)) {
    // SOP 库导出形如 { items: [ {...}, {...} ] }，要逐个元素找
    for (const entry of value) {
      const nested = findRecipeNode(entry, depth + 1)
      if (nested) return nested
    }
    return null
  }
  const record = value as Record<string, unknown>
  if (record.campaignRecipe && typeof record.campaignRecipe === 'object') {
    const nested = record.campaignRecipe as Record<string, unknown>
    // campaignRecipe 可能只带 body+dimensions，名称/说明在外层，先合并再看
    return { ...record, ...nested }
  }
  const hasTemplate = ['template', 'body', 'prompt', 'skeleton'].some(
    (field) => typeof record[field] === 'string' && (record[field] as string).trim(),
  )
  const hasPools = Boolean(record.pools ?? record.dimensions ?? record.pool ?? record.master)
  if (hasTemplate && hasPools) return record
  // 递归常见容器
  for (const field of ['item', 'sop', 'data', 'recipe', 'items', 'list'] as const) {
    const nested = findRecipeNode(record[field], depth + 1)
    if (nested) return nested
  }
  return null
}

// ---------------------------------------------------------------------------
// 自由排版文本分支
// ---------------------------------------------------------------------------

/** 已知的顶层键（归一化后）。用于判断一行是不是「键: 值」。 */
const KNOWN_TOP_KEYS = new Set([
  'name',
  'desc',
  'description',
  'template',
  'master',
  'pools',
  'model',
  'dominant',
  'forbidden',
  'headline_slot',
  'headlineslot',
  'templatebody',
  'body',
  '说明',
  '名称',
  '描述',
])

/**
 * 解析 `master` 区块。
 *
 * 真实资产的用法是「master 存主体/款式库，模板里用 `{M}` 引用」，
 * 所以这里默认把槽名取为 `M`（与环境变量式占位符一致）；
 * 若模板里实际用的是别的槽名，由调用方在可编辑表单里改。
 */
function parseMasterLines(lines: string[], slotName = 'M'): ParsedCampaignRecipeDimension {
  const dimension: ParsedCampaignRecipeDimension = { name: slotName, options: [] }
  const english: Record<string, string> = {}
  for (const rawLine of lines) {
    const line = stripListPrefix(rawLine)
    if (!line) continue
    const weightMatch = /\bweight\s*[:：]\s*(\d+)/iu.exec(line)
    const withoutWeight = line.replace(/\bweight\s*[:：]\s*\d+/iu, '').trim()
    const commaIndex = /[,，]/u.exec(withoutWeight)
    const key = (commaIndex ? withoutWeight.slice(0, commaIndex.index) : withoutWeight).trim()
    const en = commaIndex ? withoutWeight.slice(commaIndex.index + 1).trim() : ''
    if (!key) continue
    dimension.options.push(key)
    if (en) english[key] = en
    if (weightMatch && dimension.weight === undefined) dimension.weight = Number(weightMatch[1])
  }
  if (Object.keys(english).length > 0) dimension.englishByOption = english
  return dimension
}

function parseTextRecipe(text: string): ParsedCampaignRecipe {
  const result = emptyResult('text')
  const lines = text.split(/\r?\n/u)

  // 逐行扫描，收集顶层键值 + master/pools 两个多行区块
  let currentBlock: 'master' | 'pools' | null = null
  let currentPool: string | null = null
  const masterLines: string[] = []
  const poolOptions = new Map<string, string[]>()

  const closeBlock = () => {
    currentBlock = null
    currentPool = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    // 忽略注释行
    if (/^(#|\/\/)/u.test(line)) continue

    const kv = splitKeyValue(line)
    const normalizedKey = kv ? normalizeKey(kv.key) : ''

    if (kv && KNOWN_TOP_KEYS.has(normalizedKey)) {
      const value = kv.value.trim()
      if (normalizedKey === 'name' || normalizedKey === '名称') {
        result.name = value
        closeBlock()
        continue
      }
      if (
        normalizedKey === 'desc' ||
        normalizedKey === 'description' ||
        normalizedKey === '说明' ||
        normalizedKey === '描述'
      ) {
        result.desc = value
        closeBlock()
        continue
      }
      if (normalizedKey === 'template' || normalizedKey === 'body' || normalizedKey === 'templatebody') {
        result.body = value
        closeBlock()
        continue
      }
      if (normalizedKey === 'master') {
        currentBlock = 'master'
        currentPool = null
        if (value) masterLines.push(value)
        continue
      }
      if (normalizedKey === 'pools') {
        currentBlock = 'pools'
        currentPool = null
        continue
      }
      // model / dominant / forbidden / headline_slot 不参与采样，跳过
      closeBlock()
      continue
    }

    if (currentBlock === 'master') {
      masterLines.push(line)
      continue
    }

    if (currentBlock === 'pools') {
      // pools 内部行有三种形态：
      //   `S1:`           仅有池名
      //   `S1: 值1, 值2`  池名 + 值
      //   值 / 编号值     归属上一个池
      const poolKv = splitKeyValue(line)
      // 池名**保留原始大小写**：`S1` 与 `s1` 在模板里是不同的槽，
      // 归一化只用于「是否已知顶层键」的判断，不能用来改写池名。
      const candidateName = poolKv ? poolKv.key.trim() : /^([A-Za-z][A-Za-z0-9_]{0,15})$/u.exec(line)?.[1]?.trim()
      if (candidateName) {
        currentPool = candidateName
        if (!poolOptions.has(candidateName)) poolOptions.set(candidateName, [])
        if (poolKv?.value) poolOptions.get(candidateName)!.push(...splitOptions(poolKv.value))
        continue
      }
      if (currentPool) {
        const value = stripListPrefix(line)
        if (value) poolOptions.get(currentPool)!.push(...splitOptions(value))
        continue
      }
      // pools 块里尚未识别出池名 → 视为无效行，忽略
      continue
    }

    // 块外散落的「键: 值」，按归一化键名兜底识别
    if (kv) {
      const key = normalizeKey(kv.key)
      if (!result.name && (key === '名称' || key === '配方名' || key === 'title')) result.name = kv.value
      else if (!result.desc && (key === '说明' || key === '描述' || key === 'desc')) result.desc = kv.value
      else if (!result.body && (key === 'template' || key === 'body' || key === '骨架')) result.body = kv.value
    }
  }

  if (masterLines.length > 0) {
    const poolKeys = new Set([...poolOptions.keys()])
    const freeSlots = extractPlaceholders(result.body).filter((name) => !poolKeys.has(normalizeKey(name)))
    result.dimensions.push(parseMasterLines(masterLines, freeSlots[0] ?? 'M'))
  }
  for (const [name, options] of poolOptions) result.dimensions.push({ name, options })

  return result
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/** 校验并补全解析结果：补 missingPools 占位维度、判定 ok、生成 warnings。 */
function finalize(result: ParsedCampaignRecipe): ParsedCampaignRecipe {
  const placeholders = extractPlaceholders(result.body)
  // 匹配用「去空白后的小写」做键：模板里写 `{ s1 }` 也能对上池 `S1`。
  // 大小写不敏感是刻意的 —— 手写配方的槽名大小写经常不一致，报「缺池」比容错更烦人；
  // 真正的重复槽（同时存在 S1 与 s1）由 toCampaignRecipeConfig 去重时再收敛。
  const knownByLooseName = new Set(result.dimensions.map((dimension) => normalizeKey(dimension.name)))

  // 模板引用但候选池缺失 → 补空维度占位，交给用户填值（不静默忽略）
  result.missingPools = placeholders.filter((name) => !knownByLooseName.has(normalizeKey(name)))
  for (const name of result.missingPools) {
    result.dimensions.push({ name, options: [] })
    knownByLooseName.add(normalizeKey(name))
  }

  const emptyDimensions = result.dimensions.filter((dimension) => dimension.options.length === 0)
  if (emptyDimensions.length > 0) {
    result.warnings.push(`以下维度没有候选值，生成前必须补齐：${emptyDimensions.map((item) => item.name).join('、')}`)
  }
  if (result.dimensions.length === 0) result.warnings.push('未识别到任何维度池')
  if (!result.name) result.warnings.push('未识别到配方名称，请手动填写')
  if (!result.body) {
    result.error = '未识别到提示词骨架（template / body）'
    result.ok = false
    return result
  }
  if (result.dimensions.length === 0) {
    result.error = '未识别到任何维度池（pools / master），引擎无法采样'
    result.ok = false
    return result
  }
  result.ok = true
  return result
}

/**
 * 把任意整段文本解析成配方卡。
 *
 * @param text 粘贴进来的原文（JSON 或自由排版）
 * @returns 解析结果；`ok=false` 时 `error` 说明原因，UI 应据此给出明确提示而不是继续保存
 */
export function parseCampaignRecipeText(text: string): ParsedCampaignRecipe {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) {
    const empty = emptyResult('text')
    empty.error = '内容为空，请先粘贴配方卡原文'
    return empty
  }

  // 1) JSON 优先：以 { 或 [ 开头时尝试解析
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const node =
        findRecipeNode(parsed) ??
        (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null)
      if (node) {
        const result = emptyResult('json')
        readRecipeObject(node, result)
        if (result.body || result.dimensions.length > 0) return finalize(result)
      }
    } catch {
      // JSON 解析失败 → 回落到文本模式（用户可能粘了半截 JSON 或带注释）
    }
  }

  // 2) 自由排版文本
  const textResult = parseTextRecipe(trimmed)
  if (textResult.body || textResult.dimensions.length > 0 || textResult.name) return finalize(textResult)

  const failed = emptyResult('text')
  failed.error = '无法从这段内容识别出配方卡：既不是合法 JSON，也没有找到 template / pools 结构'
  return failed
}

/**
 * 把解析结果落成引擎可直接消费的 `CampaignRecipeConfig`。
 *
 * 三条收敛规则：
 * 1. 丢掉没有候选值的维度 —— 空维度会让引擎报格式错误，由 UI 层拦在保存之前；
 * 2. 同名的重复维度合并（保留先出现的声明顺序，候选值去重合并）；
 * 3. `weight` 一并带过去：它决定主控槽，影响「优先保证哪个槽有差异」。
 */
export function toCampaignRecipeConfig(parsed: ParsedCampaignRecipe): CampaignRecipeConfig | null {
  const merged = new Map<string, { name: string; options: string[]; weight?: number }>()
  for (const dimension of parsed.dimensions) {
    const name = dimension.name.trim()
    if (!name || dimension.options.length === 0) continue
    // 合并键用「去空白小写」，避免同一槽因大小写差异被拆成两个维度
    const key = normalizeKey(name)
    const existing = merged.get(key)
    if (existing) {
      for (const option of dimension.options) {
        if (!existing.options.includes(option)) existing.options.push(option)
      }
      if (existing.weight === undefined && dimension.weight !== undefined) existing.weight = dimension.weight
      continue
    }
    merged.set(key, {
      name,
      options: [...new Set(dimension.options)],
      ...(typeof dimension.weight === 'number' && Number.isFinite(dimension.weight) && dimension.weight > 0
        ? { weight: dimension.weight }
        : {}),
    })
  }

  const dimensions = [...merged.values()]
  if (!parsed.body.trim() || dimensions.length === 0) return null
  const config = { body: parsed.body, dimensions }
  // 复用引擎自己的结构校验，避免两套规则漂移
  return parseCampaignRecipeConfig(config)
}
