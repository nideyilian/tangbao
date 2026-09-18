import { INVALID_FILE_NAME_CHARS } from './sanitizeFileName'
import { escapeRegExp } from './escapeRegExp'

export interface GeneratedImageFilenameSettings {
  imageFilenameDatePrefix: boolean
  imageFilenameUsePrompt: boolean
}

export interface GeneratedImageFilenameContext {
  createdAt: number
  label: string
  prompt: string
  batch: number
}

export function sanitizeGeneratedImageFilenamePart(value: string, maxLength?: number): string {
  // 注意顺序与 `sanitizeFileNameCore` **相反**：这里先压缩空白、再剥非法字符。
  // 控制字符类里含 `\n` / `\t`，先替换会把 prompt 里的换行变成 `-`；先压缩空白则归成空格，
  // 这才是文件名期望的结果（见 generatedImageFilename.test.ts 的既有断言）。
  // 字符集仍共享同一份常量，避免两处漂移。
  const sanitized = value.trim().replace(/\s+/g, ' ').replace(INVALID_FILE_NAME_CHARS, '-')
  return typeof maxLength === 'number' ? sanitized.slice(0, maxLength) : sanitized
}

export function formatGeneratedImageDate(createdAt: number): string {
  const date = Number.isFinite(createdAt) ? new Date(createdAt) : new Date()
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date
  const year = validDate.getFullYear()
  const month = String(validDate.getMonth() + 1).padStart(2, '0')
  const day = String(validDate.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function buildGeneratedImageFileNamePrefix(
  context: GeneratedImageFilenameContext,
  settings: GeneratedImageFilenameSettings,
): string {
  const parts: string[] = []
  if (settings.imageFilenameDatePrefix) {
    parts.push(formatGeneratedImageDate(context.createdAt))
  }
  parts.push(sanitizeGeneratedImageFilenamePart(context.label, 100) || 'image')
  parts.push(String(Math.max(1, Math.trunc(context.batch))))
  if (settings.imageFilenameUsePrompt) {
    const prompt = sanitizeGeneratedImageFilenamePart(context.prompt, 100)
    if (prompt) parts.push(prompt)
  }
  return parts.join('-')
}

export function buildGeneratedImageFileNameBase(
  context: GeneratedImageFilenameContext,
  settings: GeneratedImageFilenameSettings,
  sequence: number,
): string {
  return `${buildGeneratedImageFileNamePrefix(context, settings)}-${Math.max(1, Math.trunc(sequence))}`
}

/**
 * 素材规范名所需的来源字段。只取命名真正用到的几项，避免为了算一个名字把整个
 * `GeneratedAssetOrigin` 拖进来（主进程算 SQL 排序列时也复用这个函数）。
 */
export interface GeneratedAssetNameOrigin {
  key: string
  taskCreatedAt: number
  outputSlot: number
  filenameLabel?: string
  filenameBatch?: number
  generatedFileNameBase?: string
}

export interface GeneratedAssetNameSource {
  origins: ReadonlyArray<GeneratedAssetNameOrigin>
  primaryOriginKey?: string | null
}

/**
 * 素材的**规范文件名基名**（不含扩展名），如 `20260918-网赚-401-1`。
 *
 * 与本地落盘用同一套词序（日期-标签-批次-序号），但**序号取槽位号而不是目录续号**：
 * 落盘要跟目录里已有文件续号，而下载/导出/排序必须对同一张图永远给出同一个名字，
 * 不能取决于磁盘当时的状态。
 *
 * ⚠️ `origin.generatedFileNameBase` 目前**没有任何生产者**（TaskRecord 上那个同名字段也从没被赋值），
 * 所以这里不能只读它——回退成 `asset.imageId` 就是那串 64 位 sha256，用户看到的就是哈希文件名。
 * 有值仍优先用它（将来真在生成时写入这份名字时，导出名与落盘名才会严格一致）。
 *
 * 取不到来源时返回空串，由调用方决定兜底（`getAssetFileName` 会退回 imageId）。
 */
export function resolveGeneratedAssetNameBase(asset: GeneratedAssetNameSource): string {
  const primary = pickPrimaryOrigin(asset)
  if (!primary) return ''
  const explicit = primary.generatedFileNameBase?.trim()
  if (explicit) return explicit

  const parts: string[] = []
  if (Number.isFinite(primary.taskCreatedAt)) parts.push(formatGeneratedImageDate(primary.taskCreatedAt))
  parts.push(sanitizeGeneratedImageFilenamePart(primary.filenameLabel ?? '', 100) || '未命名')
  parts.push(String(toPositiveInt(primary.filenameBatch)))
  // ⚠️ 不能用 `toPositiveInt`：它把 0 钳成 1，而 `outputSlot` 是 **0 起**的，
  // 钳完再 +1 会让第一张图变成 `-2`（整批序号集体错位一位）。
  parts.push(String(toNonNegativeInt(primary.outputSlot) + 1))
  return parts.join('-')
}

/**
 * 素材的批次号（`filenameBatch`）。缺失时返回 0 —— 排序与 SQL 列都用它，
 * 保证「没有批次号的旧素材」稳定地聚在一起，而不是随 `undefined` 的比较结果乱跑。
 */
export function resolveGeneratedAssetBatch(asset: GeneratedAssetNameSource): number {
  const primary = pickPrimaryOrigin(asset)
  const batch = primary?.filenameBatch
  return typeof batch === 'number' && Number.isFinite(batch) ? Math.max(0, Math.trunc(batch)) : 0
}

function pickPrimaryOrigin(asset: GeneratedAssetNameSource): GeneratedAssetNameOrigin | undefined {
  const origins = asset.origins ?? []
  return origins.find((item) => item.key === asset.primaryOriginKey) ?? origins[0]
}

/**
 * 系列图（一组多张）的**组内顺序序号**（1 起）。
 *
 * 命名固定为「X-组序号-组内顺序序号」：组序号沿用批次号（同组所有成员共享，见
 * `resolveSeriesGroupGeneratedImageNaming`），这里负责追加组内顺序：
 * 组内第几名成员 × 每成员张数 + 任务内图片序号 + 1，与提交顺序、出图先后无关，
 * 因此同组的序号稳定、连续且不重复。
 *
 * 非系列任务返回 null，由调用方沿用目录续号（`findNextGeneratedImageSequence`）。
 */
export function getSeriesGroupImageSequence(
  series: { seriesIndex: number } | null | undefined,
  imagesPerPrompt: number | null | undefined,
  imageIndexInTask: number,
): number | null {
  if (!series) return null
  const memberIndex = toPositiveInt(series.seriesIndex) - 1
  const perMember = toPositiveInt(imagesPerPrompt)
  const indexInTask =
    typeof imageIndexInTask === 'number' && Number.isFinite(imageIndexInTask)
      ? Math.max(0, Math.trunc(imageIndexInTask))
      : 0
  return memberIndex * perMember + indexInTask + 1
}

function toPositiveInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.trunc(value))
}

/** 0 起下标的归一化（`outputSlot` 用）。非法值当 0，而不是像 `toPositiveInt` 那样当 1。 */
function toNonNegativeInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

export function findNextGeneratedImageSequence(
  fileNames: string[],
  context: GeneratedImageFilenameContext,
  settings: GeneratedImageFilenameSettings,
): number {
  const prefix = escapeRegExp(buildGeneratedImageFileNamePrefix(context, settings))
  const pattern = new RegExp(`^${prefix}-(\\d+)\\.[^.]+$`, 'i')
  let maxSequence = 0
  for (const fileName of fileNames) {
    const match = fileName.match(pattern)
    if (!match) continue
    maxSequence = Math.max(maxSequence, Number.parseInt(match[1], 10))
  }
  return maxSequence + 1
}
