import { INVALID_FILE_NAME_CHARS } from './sanitizeFileName'

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
