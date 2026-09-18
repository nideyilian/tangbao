/**
 * 取路径的最后一段文件名/目录名（兼容 `\` 与 `/`，忽略结尾分隔符）。
 *
 * 此前 `downloadImages.ts` 与 `generatedImageBatch.ts` 各有一份逐字相同的实现；
 * 抽到此处是因为 `downloadImages` 依赖 store，让 `generatedImageBatch` 反向引用会引入环。
 */
export function getPathBaseName(value?: string): string | null {
  if (!value) return null
  const parts = value
    .trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts[parts.length - 1] || null
}
