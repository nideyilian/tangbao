/** 把数值限制在 [min, max] 区间。此前 Lightbox / AssetViewer / viewportTransform 各有一份。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
