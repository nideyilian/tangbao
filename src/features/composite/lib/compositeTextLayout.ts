import type { CompositeV2TextLayer } from './compositeV2Types'

export type CompositeTextLineMeasurer = (line: string) => number

export function measureCompositeTextBox(
  layer: CompositeV2TextLayer,
  measureLine: CompositeTextLineMeasurer = (line) => measureLineWithCanvas(layer, line),
) {
  const lines = layer.text.split('\n')
  const padding = Number.isFinite(layer.padding) ? Math.max(0, layer.padding) : 5
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

/**
 * 按可用宽度把**一行**拆成多行。
 *
 * 为什么必须自己折行（2026-09-22 杰哥报障「部分文字出现被拉伸变形」）：
 * 渲染时原先把 `rect.width - padding * 2` 直接当 `fillText` 的第 4 参（maxWidth）——
 * **canvas 遇到超宽文字是横向压扁，不是换行**；而 `rect.width` 是按**不含标识符**的文字算的
 * （`measureCompositeTextBox` 只认 `\n`），所以带长标识的那一层必然超框、被压成瘦字。
 * 折行只是多占一行，字的比例不变。
 *
 * 断行规则：**逐字断**。中文按字断开正是期望；英文长单词会被拆开（水印里罕见，先不为它加复杂度）。
 *
 * 空行 / 放得下 / maxWidth 非法时都原样返回 —— 调用方拿去 `forEach` 画，不需要额外分支。
 */
export function wrapCompositeTextLine(line: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (line === '' || !(maxWidth > 0) || measure(line) <= maxWidth) return [line]
  const rows: string[] = []
  let current = ''
  for (const char of line) {
    const next = current + char
    // `current` 非空才允许断：万一单个字符就超宽，也不能推出一个空行（那会让字掉进空气里）
    if (current && measure(next) > maxWidth) {
      rows.push(current)
      current = char
    } else {
      current = next
    }
  }
  rows.push(current)
  return rows
}
