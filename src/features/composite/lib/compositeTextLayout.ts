import { isVerticalText } from './compositeIdentifier'
import type { CompositeV2TextLayer } from './compositeV2Types'

export type CompositeTextLineMeasurer = (line: string) => number

/**
 * 竖排时要排的**列**（一行 = 一列）。
 *
 * 「一个字一行」是竖排的**另一种写法** —— 在这个参数出现之前，用户只能这么排竖排
 * （一个字敲一个回车）。这里先把它折成一段：否则那些换行会被当成「换列」，
 * 把一个字一行的文案排成**横着的一排字**。
 *
 * 渲染与测量读的是**同一个**函数：两处各写一遍折叠规则，迟早出现「框按折后的算、
 * 字按折前的画」这种对不上的偏差。
 */
export function resolveVerticalColumns(text: string): string[] {
  return (isVerticalText(text) ? text.replace(/\n/g, '') : text).split('\n')
}

/**
 * 文字层的框 = 文案的**自然尺寸 + padding**（也叫「自动适应」），改文字后由
 * `fitCompositeTextLayer` 重新算一遍。
 *
 * ⚠️ **它只是框，不是排版约束**：渲染时只拿它定位（对齐锚点），绝不拿它断行或压缩文字。
 * 两个原因（2026-09-22 两天内栽了两次，都写进了 RISK）：
 *
 * 1. 它是**历史数据**：旧版文本层的框是手拖的、或者铺满画布（库里 `preset-compliance-06`
 *    是 1160 宽的框配 19 字文案），跟当前文案对不上；
 * 2. 它**永远算不进渲染时才叠加的标识符**：标识符不写回预设（见 `compositeIdentifier`），
 *    于是含标识的那一行必然比框宽一截 —— 库里 `preset-compliance-04` 框内宽 432 = 23 字 ×18px，
 *    加 `★` 前缀后正好 24 字 = 432，卡在边界上超出一丁点，就够把末字挤到第二行。
 *
 * 这两条合起来说明：**框宽和文案宽最多只能做到「差不多」，拿它当硬约束必然出事。**
 */
export function measureCompositeTextBox(
  layer: CompositeV2TextLayer,
  measureLine: CompositeTextLineMeasurer = (line) => measureLineWithCanvas(layer, line),
) {
  const padding = Number.isFinite(layer.padding) ? Math.max(0, layer.padding) : 5
  /*
   * 竖排：宽高与横排**逐项对调** —— 宽 = 列数 × 列距（`lineHeight` 在竖排里是列距），
   * 高 = 最长那列的字数与字距之和。
   *
   * 字宽按 `fontSize` 近似（汉字等宽）：框只用来定位，不值得为它逐字 measure 一遍。
   */
  if (layer.orientation === 'vertical') {
    const columns = resolveVerticalColumns(layer.text)
    const longest = Math.max(...columns.map((column) => Array.from(column).length), 1)
    const contentWidth = columns.length * layer.fontSize * layer.lineHeight
    const contentHeight = longest * layer.fontSize + Math.max(0, longest - 1) * layer.letterSpacing
    return {
      width: Math.max(1, Math.ceil(contentWidth + padding * 2)),
      height: Math.max(1, Math.ceil(contentHeight + padding * 2)),
    }
  }
  const lines = layer.text.split('\n')
  const contentWidth = Math.max(
    ...lines.map((line) => measureLine(line) + Math.max(0, [...line].length - 1) * layer.letterSpacing),
    0,
  )
  const contentHeight = Math.max(1, lines.length) * layer.fontSize * layer.lineHeight

  return {
    width: Math.max(1, Math.ceil(contentWidth + padding * 2)),
    height: Math.max(1, Math.ceil(contentHeight + padding * 2)),
  }
}

export function fitCompositeTextLayer(layer: CompositeV2TextLayer): CompositeV2TextLayer {
  const size = measureCompositeTextBox(layer)
  return {
    ...layer,
    position: {
      ...layer.position,
      width: size.width,
      height: size.height,
    },
  }
}

function measureLineWithCanvas(layer: CompositeV2TextLayer, line: string) {
  if (typeof document === 'undefined') return [...line].length * layer.fontSize * 0.6
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) {
    return [...line].length * layer.fontSize * 0.6
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return [...line].length * layer.fontSize * 0.6
  context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
  return context.measureText(line || ' ').width
}
