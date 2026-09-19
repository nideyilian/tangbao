/**
 * 水印标识符的附加规则（纯函数，无副作用，便于单测）。
 *
 * 两条规则：
 * 1. **预设里有能出字的文字层** → 按位置把标识符贴到文案上（开头 / 结尾 / 两侧）。
 * 2. **一个能出字的文字层都没有** → 退化成一个左下角的独立文字层，只写标识符本身。
 *
 * 标识符**不写回预设**：它是渲染时叠加的派生值。写回就得在导出/复制/撤销时反复处理
 * 「这段到底是不是用户自己写的」，还会让「改一次标识符」变成改 N 个预设的批量写盘；
 * 叠加则天然满足「设置后对所有相关水印即时生效」。
 *
 * ⚠️ 叠加层的代价：overlay 缓存键必须纳入标识符签名，否则改了标识符但 `preset.updatedAt`
 * 没变，预览会继续用旧帧（见 `compositeRendererV2.getCompositeOverlayCacheKey`）。
 */

import {
  IDENTIFIER_FALLBACK_STYLE,
  type CompositeV2IdentifierConfig,
  type CompositeV2IdentifierPlacement,
  type CompositeV2Preset,
  type CompositeV2TextLayer,
} from './compositeV2Types'

export const IDENTIFIER_PLACEMENTS: CompositeV2IdentifierPlacement[] = ['prefix', 'suffix', 'both']

export const IDENTIFIER_PLACEMENT_LABELS: Record<CompositeV2IdentifierPlacement, string> = {
  prefix: '开头',
  suffix: '结尾',
  both: '两侧',
}

export function createDefaultIdentifier(): CompositeV2IdentifierConfig {
  return { text: '', placement: 'suffix' }
}

/** 归一化：位置非法退回 `suffix`；文本缺失退回空串（空串 = 不附加）。 */
export function normalizeIdentifier(value: unknown): CompositeV2IdentifierConfig {
  if (!value || typeof value !== 'object') return createDefaultIdentifier()
  const raw = value as Record<string, unknown>
  const placement = raw.placement
  return {
    text: typeof raw.text === 'string' ? raw.text : '',
    placement: placement === 'prefix' || placement === 'both' ? placement : 'suffix',
  }
}

/**
 * 标识符是否真的要贴。
 *
 * 判据是 `trim()` 后非空：用户可能就想要「文案  @小王」这种带间隔的效果，所以原文的前后
 * 空格要保留；但**纯空格**的标识符只会给每个水印多贴一对空白，那不是用户输入它的意图。
 */
export function isIdentifierEnabled(identifier?: CompositeV2IdentifierConfig | null): boolean {
  return Boolean(identifier && identifier.text.trim() !== '')
}

/**
 * 把标识符贴到一段文案上。
 *
 * 多行文案只贴**整段**的首尾（首行前 / 末行后），不是逐行都贴——「文案开头、文案结尾」
 * 说的是整段，逐行贴会把多行水印变得像列表。
 */
export function applyIdentifierToText(text: string, identifier?: CompositeV2IdentifierConfig | null): string {
  if (!isIdentifierEnabled(identifier)) return text
  const value = identifier!.text
  const atPrefix = identifier!.placement === 'prefix' || identifier!.placement === 'both'
  const atSuffix = identifier!.placement === 'suffix' || identifier!.placement === 'both'
  if (!atPrefix && !atSuffix) return text
  const lines = text.split('\n')
  if (atPrefix) lines[0] = value + (lines[0] ?? '')
  if (atSuffix) lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + value
  return lines.join('\n')
}

/**
 * 标识符签名，供 overlay 缓存键使用。
 *
 * 必须同时含文本与位置：只含文本时，把「结尾」改成「两侧」会因为签名不变而命中旧缓存，
 * 表现是「切换位置没反应」。
 */
export function getIdentifierSignature(identifier?: CompositeV2IdentifierConfig | null): string {
  if (!isIdentifierEnabled(identifier)) return '-'
  return `${identifier!.placement}:${identifier!.text}`
}

/** 预设里是否存在「能出字」的文字层（可见 + 文本非空）。隐藏 / 空文本的层不算。 */
export function hasRenderableTextLayer(preset: CompositeV2Preset | null | undefined): boolean {
  if (!preset) return false
  return preset.layers.some((layer) => layer.type === 'text' && layer.visible && layer.text.trim() !== '')
}

/**
 * 造出「无文字水印时」的那个左下角标识符层。
 *
 * 样式取预设画布短边的比例而不是写死像素：竖版 1080x1920 与横版 1920x1080 会得到视觉上
 * 一致的大小，不用为两种版式各配一份样式。宽度给到画布的 80%，保证 `fillText` 的 maxWidth
 * 不会把长标识符挤扁。
 */
export function buildIdentifierLayer(
  preset: CompositeV2Preset,
  identifier?: CompositeV2IdentifierConfig | null,
): CompositeV2TextLayer | null {
  if (!isIdentifierEnabled(identifier)) return null
  const base = preset.baseCanvas
  const shortSide = Math.min(base.width, base.height)
  if (!(shortSide > 0)) return null
  const fontSize = Math.max(8, Math.round(shortSide * IDENTIFIER_FALLBACK_STYLE.fontSizeRatio))
  const margin = Math.round(shortSide * IDENTIFIER_FALLBACK_STYLE.marginRatio)
  const strokeWidth = Math.round(shortSide * IDENTIFIER_FALLBACK_STYLE.strokeWidthRatio * 100) / 100

  return {
    id: `identifier-layer-${preset.id}`,
    type: 'text',
    name: '水印标识符',
    visible: true,
    // 锁住：它是派生的，不该被当成普通图层拖走或改字号
    locked: true,
    opacity: 1,
    rotation: 0,
    position: {
      mode: 'anchor',
      anchor: 'bottom-left',
      marginX: margin,
      marginY: margin,
      offsetX: 0,
      offsetY: 0,
      width: Math.max(1, Math.round(base.width * 0.8)),
      height: Math.max(1, Math.round(fontSize * 1.4)),
    },
    shadow: { enabled: false, color: IDENTIFIER_FALLBACK_STYLE.strokeColor, x: 0, y: 4, blur: 12, opacity: 0.25 },
    stroke: { enabled: strokeWidth > 0, color: IDENTIFIER_FALLBACK_STYLE.strokeColor, width: strokeWidth },
    text: identifier!.text,
    fontFamily: 'sans-serif',
    fontSize,
    fontWeight: 700,
    color: IDENTIFIER_FALLBACK_STYLE.color,
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    padding: 0,
  }
}

/**
 * 渲染时要画的额外标识符层：有可出字的文字层时为 null（那种情况走文案叠加），
 * 否则返回左下角那层。
 */
export function resolveIdentifierLayer(
  preset: CompositeV2Preset,
  identifier?: CompositeV2IdentifierConfig | null,
): CompositeV2TextLayer | null {
  if (hasRenderableTextLayer(preset)) return null
  return buildIdentifierLayer(preset, identifier)
}
