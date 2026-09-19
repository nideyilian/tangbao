/**
 * 后处理输出的命名模板：`{token}` 占位符替换。
 *
 * 来源见 `docs/hanling-postprocess-replica-plan.md` §1.1、§3 阶段三。
 * 与参照系统的差异：token 由 7 段收敛为「必要 6 段 + 可选 2 段」，默认模板不含
 * `{creator}`（糖包既有命名风格更短），但 token 保留，用户需要时自行加回。
 *
 * 约定：
 * - 取值一律过 `sanitizeGeneratedImageFilenamePart`，与糖包其它文件名同源，避免非法字符入盘。
 * - **取值为空的段会被整段删除**（而不是留一个空段），否则会出现 `A--B` 这种名字。
 * - 未知 token 原样保留，便于用户在文件名里直接看出模板写错了；`findUnknownPostprocessNameTokens`
 *   供 UI 提前提示，两者配合而不是静默吞掉。
 */

import { formatGeneratedImageDate, sanitizeGeneratedImageFilenamePart } from './generatedImageFilename'
import { getOutputDirectionLabel, resolveOutputDirection, type OutputDirection } from './postprocessMedia'

/** 全部可用 token。 */
export const POSTPROCESS_NAME_TOKENS = [
  'date',
  'line',
  'product',
  'direction',
  'creator',
  'media',
  'size',
  'seq',
  'preset',
] as const

export type PostprocessNameToken = (typeof POSTPROCESS_NAME_TOKENS)[number]

/** 建议模板必须包含的 token：缺 `{seq}` 时同批次产物会互相覆盖。 */
export const POSTPROCESS_REQUIRED_NAME_TOKENS: PostprocessNameToken[] = ['seq']

/** 默认命名模板（对齐糖包既有 `前缀-序号` 风格，不照抄参照系统的 7 段）。 */
export const DEFAULT_POSTPROCESS_NAME_PATTERN = '{date}-{product}-{direction}-{media}-{size}-{seq}'

/** token → 中文说明，供设置面板展示。 */
export const POSTPROCESS_NAME_TOKEN_LABELS: Record<PostprocessNameToken, string> = {
  date: '日期（YYYYMMDD）',
  line: '产品线',
  product: '产品',
  direction: '方向（横版/竖版/方形）',
  creator: '创作者',
  media: '媒体（渠道名）',
  size: '尺寸（1280x720）',
  seq: '序号',
  preset: '水印预设名',
}

/**
 * token → 变量按钮上的**短中文名**（去掉括号里的取值示例）。
 *
 * 按钮显示中文、插入的仍然是 `{token}`：模板本身是落盘格式（改了会让所有人已配好的模板失效），
 * 但 `{date}` 这种英文占位符对用户只是一串看不懂的符号，所以按钮上给中文名，
 * 占位符本身放进 tooltip。
 */
export const POSTPROCESS_NAME_TOKEN_SHORT_LABELS: Record<PostprocessNameToken, string> = {
  date: '日期',
  line: '产品线',
  product: '产品',
  direction: '方向',
  creator: '创作者',
  media: '媒体',
  size: '尺寸',
  seq: '序号',
  preset: '水印预设',
}

/** 在模板里插入一个 token 的结果：新模板 + 插入后光标应落的位置。 */
export interface PostprocessNameInsertResult {
  pattern: string
  caret: number
}

/**
 * 在**指定位置**插入一个 token 占位符；不给位置时追加到末尾。
 *
 * `selection` 来自 DOM，光标落在输入框外（点变量按钮时）会读到过期甚至归零的值，
 * 所以这里一律把区间夹到 `[0, length]` 而不是抛错——插入位置错一位的代价远小于报错。
 * 有选区时替换选区，没有选区时就是「插在光标处」。
 */
export function insertPostprocessNameToken(
  pattern: string,
  token: PostprocessNameToken,
  selection?: { start: number; end: number },
): PostprocessNameInsertResult {
  const text = typeof pattern === 'string' ? pattern : ''
  const length = text.length
  const clamp = (value: number | undefined, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(Math.max(Math.trunc(value), 0), length)
  }
  const start = clamp(selection?.start, length)
  const end = Math.max(start, clamp(selection?.end, start))
  const placeholder = `{${token}}`
  return { pattern: `${text.slice(0, start)}${placeholder}${text.slice(end)}`, caret: start + placeholder.length }
}

const TOKEN_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g

export interface PostprocessNameContext {
  /** 时间戳；不传则取当前时间 */
  createdAt?: number
  line?: string
  product?: string
  direction?: string
  creator?: string
  media?: string
  /** 水印预设名；同一方向配了多套水印时用来区分文件名 */
  preset?: string
  /** 尺寸，优先取 width/height；也可直接给已格式化的字符串 */
  size?: { width: number; height: number } | string
  seq?: number
}

/** 尺寸的 token 文本，如 `1280x720`。 */
export function formatPostprocessSizeToken(size: PostprocessNameContext['size']): string {
  if (!size) return ''
  if (typeof size === 'string') return size
  const { width, height } = size
  if (!Number.isFinite(width) || !Number.isFinite(height)) return ''
  return `${Math.trunc(width)}x${Math.trunc(height)}`
}

/** 列出模板里的 token（按出现顺序，含重复）。 */
export function listPostprocessNameTokens(pattern: string): string[] {
  return [...pattern.matchAll(TOKEN_PATTERN)].map((match) => match[1])
}

/** 模板里的未知 token（写错的、或本版本不支持的）。 */
export function findUnknownPostprocessNameTokens(pattern: string): string[] {
  const known = new Set<string>(POSTPROCESS_NAME_TOKENS)
  const unknown: string[] = []
  for (const token of listPostprocessNameTokens(pattern)) {
    if (!known.has(token) && !unknown.includes(token)) unknown.push(token)
  }
  return unknown
}

/** 模板里缺少的必要 token（去重）。 */
export function findMissingPostprocessNameTokens(pattern: string): PostprocessNameToken[] {
  const present = new Set(listPostprocessNameTokens(pattern))
  return POSTPROCESS_REQUIRED_NAME_TOKENS.filter((token) => !present.has(token))
}

/** 模板中重复出现的 token（去重后的列表，不含首次出现）。 */
export function findDuplicatedPostprocessNameTokens(pattern: string): string[] {
  const seen = new Set<string>()
  const duplicated: string[] = []
  for (const token of listPostprocessNameTokens(pattern)) {
    if (seen.has(token)) {
      if (!duplicated.includes(token)) duplicated.push(token)
      continue
    }
    seen.add(token)
  }
  return duplicated
}

function resolveTokenValue(token: string, context: PostprocessNameContext): string | null {
  switch (token) {
    case 'date':
      return formatGeneratedImageDate(context.createdAt ?? Date.now())
    case 'line':
      return context.line ?? null
    case 'product':
      return context.product ?? null
    case 'direction': {
      // 项目树里的方向名优先（用户自己的叫法）；缺省时按尺寸推导中文方向，免得调用方到处补兜底。
      if (context.direction) return context.direction
      const size = context.size
      if (size && typeof size !== 'string' && Number.isFinite(size.width) && Number.isFinite(size.height)) {
        return getOutputDirectionLabel(resolveOutputDirection(size.width, size.height))
      }
      return null
    }
    case 'creator':
      return context.creator ?? null
    case 'media':
      return context.media ?? null
    case 'preset':
      return context.preset ?? null
    case 'size':
      return formatPostprocessSizeToken(context.size) || null
    case 'seq': {
      const seq = context.seq
      if (typeof seq !== 'number' || !Number.isFinite(seq)) return '1'
      return String(Math.max(1, Math.trunc(seq)))
    }
    default:
      return null
  }
}

const KNOWN_TOKEN_SET = new Set<string>(POSTPROCESS_NAME_TOKENS)

/**
 * 渲染模板。
 *
 * - 未知 token → 原样保留（`{foo}` 留在结果里，便于肉眼发现模板写错）。
 * - 已知但取值为空的 token → 整段删除。
 * - 结果再折叠连续 `-` 与首尾 `-`，避免出现空段。
 * - 兜底：清洗后为空 → `'image'`。
 */
export function renderPostprocessNamePattern(pattern: string, context: PostprocessNameContext = {}): string {
  const safePattern = typeof pattern === 'string' && pattern.trim() ? pattern : DEFAULT_POSTPROCESS_NAME_PATTERN
  const replaced = safePattern.replace(TOKEN_PATTERN, (raw, name: string) => {
    if (!KNOWN_TOKEN_SET.has(name)) return raw
    const value = resolveTokenValue(name, context)
    return value === null ? '' : sanitizeGeneratedImageFilenamePart(value, 60)
  })
  const collapsed = replaced
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
  const sanitized = sanitizeGeneratedImageFilenamePart(collapsed, 180)
  return sanitized || 'image'
}

/** 命名所需的最小单元视图：与 `PostprocessOutputUnit` 结构兼容，只取命名相关字段。 */
export interface PostprocessNameTarget {
  mediaName: string
  width: number
  height: number
  direction: OutputDirection
  /** 该单元叠加的水印预设；不叠水印时缺省。`{preset}` token 取它的展示名。 */
  watermark?: { name: string }
}

/**
 * 取某个产出单元的文件名主干（不含扩展名）。
 *
 * 项目树里的方向名（`names.direction`，用户自己的叫法）优先；
 * 缺省回退到按尺寸推导的中文方向。
 */
export function buildPostprocessOutputName(
  config: { namePattern: string; creator: string },
  unit: PostprocessNameTarget,
  names: { line?: string; product?: string; direction?: string } = {},
  sequence = 1,
  createdAt?: number,
): string {
  return renderPostprocessNamePattern(config.namePattern, {
    createdAt,
    line: names.line,
    product: names.product,
    direction: names.direction ?? getOutputDirectionLabel(unit.direction),
    creator: config.creator,
    media: unit.mediaName,
    preset: unit.watermark?.name,
    size: { width: unit.width, height: unit.height },
    seq: sequence,
  })
}
