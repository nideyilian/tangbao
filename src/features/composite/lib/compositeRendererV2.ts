import { mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'
import { getCompositeAssetObjectUrl } from './compositeAssets'
import { ByteLruCache } from '../../../lib/byteLruCache'
import {
  blobToDataUrl,
  canvasToBlob,
  getSourceHeight,
  getSourceWidth,
  loadImageOriented,
  type OrientedImageSource,
} from '../../../lib/canvasImage'
import {
  getIdentifierSignature,
  normalizeIdentifier,
  resolveIdentifierLayer,
  resolveLayerText,
} from './compositeIdentifier'
import { resolveVerticalColumns } from './compositeTextLayout'
import type {
  CompositeV2IdentifierConfig,
  CompositeV2MediaLayer,
  CompositeV2Preset,
  CompositeV2FitMode,
  CompositeV2Stroke,
  CompositeV2TextLayer,
} from './compositeV2Types'

type Size = { width: number; height: number }

// 叠加层缓存：按字节限制（基准 overlay 可能远超输出尺寸，不能用条数限制，否则内存会爆）。
const MAX_OVERLAY_CACHE_BYTES = 384 * 1024 * 1024

type OverlayCacheEntry = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  lastUsed: number
}

const overlayCache = new Map<string, OverlayCacheEntry>()
let overlayCacheBytes = 0

function touchOverlayEntry(key: string, entry: OverlayCacheEntry) {
  entry.lastUsed = Date.now()
  overlayCache.delete(key)
  overlayCache.set(key, entry)
}

function evictOverlayEntries() {
  while (overlayCacheBytes > MAX_OVERLAY_CACHE_BYTES && overlayCache.size > 1) {
    const oldestKey = overlayCache.keys().next().value
    if (oldestKey === undefined) break
    const entry = overlayCache.get(oldestKey)
    overlayCache.delete(oldestKey)
    if (entry) overlayCacheBytes -= entry.width * entry.height * 4
  }
}

function cacheOverlay(key: string, canvas: HTMLCanvasElement) {
  const prev = overlayCache.get(key)
  if (prev) overlayCacheBytes -= prev.width * prev.height * 4
  const entry: OverlayCacheEntry = { canvas, width: canvas.width, height: canvas.height, lastUsed: Date.now() }
  overlayCache.set(key, entry)
  overlayCacheBytes += entry.width * entry.height * 4
  evictOverlayEntries()
}

// 解码后的图片缓存：按源地址（dataURL / objectURL / 本地路径）复用已解码的位图，
// 避免在拖拽图层时每次指针移动都重新解码大图或重新读取本地文件，导致预览更新滞后。
const IMAGE_CACHE_MAX_BYTES = 128 * 1024 * 1024
const imageCache = new ByteLruCache<string, OrientedImageSource>(IMAGE_CACHE_MAX_BYTES)

export type CompositeV2RenderInput = {
  backgroundDataUrl?: string
  preset: CompositeV2Preset
  targetSize: Size
  fitMode: CompositeV2FitMode
  quality?: number
}

export type CompositeV2RenderOptions = {
  // 返回 true 表示本次渲染已过期（有更新的渲染请求），应放弃写入画布，避免旧帧覆盖新帧。
  isStale?: () => boolean
}

async function loadImage(src: string, cacheKey = src): Promise<OrientedImageSource> {
  const cached = imageCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)
  const image = await loadImageOriented(src)
  imageCache.set(cacheKey, image, (getSourceWidth(image) || 0) * (getSourceHeight(image) || 0) * 4)
  return image
}

export function getScaledTextMetrics(fontSize: number, strokeWidth: number, base: Size, target: Size) {
  const scale = Math.min(target.width / base.width, target.height / base.height)
  return { fontSize: fontSize * scale, strokeWidth: strokeWidth * scale }
}

export function getScaledLayerStrokeWidth(stroke: CompositeV2Stroke | undefined, base: Size, target: Size) {
  if (!stroke?.enabled || stroke.width <= 0) return 0
  return stroke.width * Math.min(target.width / base.width, target.height / base.height)
}

/**
 * 叠加层缓存键。除预设修订号与目标尺寸外，还纳入两个**不在预设里**的输入签名：
 * - 项目 Logo 资产签名：更换/重命名项目 Logo 不会更新 preset.updatedAt，不纳入会沿用旧 Logo。
 * - 水印标识符签名：标识符是渲染时叠加的派生值（见 `compositeIdentifier`），改它同样不会
 *   动到 updatedAt —— 漏掉这一项的表现是「改了标识符，预览和产出纹丝不动」，且只在
 *   重启应用清掉缓存后才突然生效，极难定位。
 */
export function getCompositeOverlayCacheKey(
  preset: Pick<CompositeV2Preset, 'id' | 'updatedAt'>,
  target: Size,
  logoSignature?: string,
  identifierSignature?: string,
) {
  return `${preset.id}:${preset.updatedAt}:${target.width}x${target.height}${logoSignature ? `:logos=${logoSignature}` : ''}${identifierSignature ? `:id=${identifierSignature}` : ''}`
}

export async function renderCombinedOverlay(preset: CompositeV2Preset, target: Size) {
  const { logoSignature, identifierSignature, identifier } = await getRuntimeRenderContext()

  // 与预设画布同比例的尺寸：以 baseCanvas 等比放大（覆盖最大所需尺寸）的版本渲染一次，
  // 所有同比例输出共享并缩放合成——避免每个输出尺寸都全量重绘所有图层（这是批量导出的主要加速点）。
  // 比例不同（或 baseCanvas 无效）时回退为按目标尺寸精确渲染。
  if (sameRatio(preset.baseCanvas, target)) {
    const key = `base:${preset.id}:${preset.updatedAt}:logos=${logoSignature}:id=${identifierSignature}`
    const need = coverSize(preset.baseCanvas, target)
    const cached = overlayCache.get(key)
    if (cached && cached.width >= need.width && cached.height >= need.height) {
      touchOverlayEntry(key, cached)
      return cached.canvas
    }
    const canvas = await renderOverlayAt(preset, need, identifier)
    cacheOverlay(key, canvas)
    return canvas
  }

  const key = getCompositeOverlayCacheKey(preset, target, logoSignature, identifierSignature)
  const cached = overlayCache.get(key)
  if (cached) {
    touchOverlayEntry(key, cached)
    return cached.canvas
  }
  const canvas = await renderOverlayAt(preset, target, identifier)
  cacheOverlay(key, canvas)
  return canvas
}

/**
 * 取渲染时那些「不在预设里」的输入。
 *
 * 动态 import 是为了避开 `storeV2 → 本文件` 的循环依赖（store 侧要用到本文件的度量函数），
 * 与 `resolveLayerImage` 里的 Logo 查找同一个理由。
 */
async function getRuntimeRenderContext(): Promise<{
  logoSignature: string
  identifierSignature: string
  identifier: CompositeV2IdentifierConfig
}> {
  const { useCompositeV2Store } = await import('../storeV2')
  const state = useCompositeV2Store.getState()
  const logos = state.projectLogos ?? []
  const identifier = normalizeIdentifier(state.identifier)
  return {
    logoSignature: logos.map((logo) => logo.assetId ?? logo.dataUrl ?? logo.id).join('|'),
    identifierSignature: getIdentifierSignature(identifier),
    identifier,
  }
}

function sameRatio(a: Size, b: Size, tolerance = 0.01) {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  return Math.abs(a.width / a.height - b.width / b.height) <= tolerance
}

/** 同比例下把 base 等比放大到能完全覆盖 target：保证放大输出不糊、缩小输出保持清晰 */
function coverSize(base: Size, target: Size): Size {
  const scale = Math.max(target.width / base.width, target.height / base.height, 1)
  return {
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  }
}

async function renderOverlayAt(
  preset: CompositeV2Preset,
  size: Size,
  identifier?: CompositeV2IdentifierConfig | null,
): Promise<HTMLCanvasElement> {
  const overlay = document.createElement('canvas')
  overlay.width = size.width
  overlay.height = size.height
  const overlayCtx = overlay.getContext('2d')
  if (!overlayCtx) throw new Error('当前环境不支持 Canvas')
  for (const layer of [...preset.layers].reverse()) {
    if (layer.visible) await drawLayer(overlayCtx, layer, preset, size, identifier)
  }
  // 一个能出字的文字层都没有时，标识符退化成一个左下角图层。最后画 = 压在最上层，
  // 且它本身就是标识符原文，不再二次叠加（传 null）。
  const identifierLayer = resolveIdentifierLayer(preset, identifier)
  if (identifierLayer) await drawLayer(overlayCtx, identifierLayer, preset, size, null)
  return overlay
}

async function resolveLayerImage(layer: CompositeV2MediaLayer) {
  if (!layer.asset) return null
  if (layer.asset.kind === 'dataUrl' && layer.asset.dataUrl) {
    return loadImage(layer.asset.dataUrl)
  }
  if (layer.asset.kind === 'stored') {
    const objectUrl = await getCompositeAssetObjectUrl(layer.asset.assetId)
    return objectUrl ? loadImage(objectUrl, `stored:${layer.asset.assetId}`) : null
  }
  const asset = layer.asset
  if (asset?.kind === 'project') {
    const { useCompositeV2Store } = await import('../storeV2')
    const logo = useCompositeV2Store.getState().projectLogos.find((l) => l.id === asset.id)
    if (logo?.assetId) {
      const objectUrl = await getCompositeAssetObjectUrl(logo.assetId)
      return objectUrl ? loadImage(objectUrl, `stored:${logo.assetId}`) : null
    }
    return logo?.dataUrl ? loadImage(logo.dataUrl, `project:${asset.id}`) : null
  }
  const path = 'path' in layer.asset ? layer.asset.path : undefined
  if (!path) return null
  const cacheKey = `path:${path}`
  const cached = imageCache.get(cacheKey)
  if (cached) return cached
  const api = window.electronAPI
  const payload = await api?.readImageFile?.(path)
  if (!payload?.dataUrl) return null
  return loadImage(payload.dataUrl, cacheKey)
}

function applyShadow(
  ctx: CanvasRenderingContext2D,
  layer: CompositeV2TextLayer | CompositeV2MediaLayer,
  base: Size,
  target: Size,
) {
  if (!layer.shadow.enabled) return
  const scaleX = target.width / base.width
  const scaleY = target.height / base.height
  const scale = Math.min(scaleX, scaleY)
  const alpha = Math.max(0, Math.min(1, layer.shadow.opacity))
  const hex = layer.shadow.color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  ctx.shadowColor = hex
    ? `rgba(${Number.parseInt(hex[1]!, 16)}, ${Number.parseInt(hex[2]!, 16)}, ${Number.parseInt(hex[3]!, 16)}, ${alpha})`
    : layer.shadow.color
  ctx.shadowOffsetX = layer.shadow.x * scale
  ctx.shadowOffsetY = layer.shadow.y * scale
  ctx.shadowBlur = layer.shadow.blur * scale
}

/**
 * 画一个图层 —— `renderOverlayAt` 唯一的绘制入口。
 *
 * ⚠️ **导出是为了可测**：文字图层「一行文案到底画几次、传不传 maxWidth」这两件事只有拿到
 * ctx 才验得了，而 jsdom 没有 canvas 实现，`compositeRendererV2.test.ts` 用一份记录调用的
 * 假 ctx 驱动这里（2026-09-22 那两次文字报障都是在这两点上栽的）。生产代码请走
 * `renderCompositeV2ToCanvas`。
 */
export async function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: CompositeV2TextLayer | CompositeV2MediaLayer,
  preset: CompositeV2Preset,
  target: Size,
  identifier?: CompositeV2IdentifierConfig | null,
) {
  const rect = mapLayerPositionToCanvas(layer.position, preset.baseCanvas, target)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  applyShadow(ctx, layer, preset.baseCanvas, target)

  if (layer.type !== 'text') {
    const image = await resolveLayerImage(layer)
    if (image) {
      if (layer.clip) {
        const radius = Math.min(layer.radius, rect.width / 2, rect.height / 2)
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, radius)
        ctx.clip()
        ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
        ctx.restore()
      } else {
        ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
      }
      const strokeWidth = getScaledLayerStrokeWidth(layer.stroke, preset.baseCanvas, target)
      if (strokeWidth > 0) {
        const radius = Math.min(layer.radius, rect.width / 2, rect.height / 2)
        ctx.beginPath()
        ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, radius)
        ctx.strokeStyle = layer.stroke?.color || '#111827'
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
    }
  } else {
    const metrics = getScaledTextMetrics(layer.fontSize, layer.stroke?.width || 0, preset.baseCanvas, target)
    const scale = Math.min(target.width / preset.baseCanvas.width, target.height / preset.baseCanvas.height)
    const padding = (layer.padding ?? 5) * scale
    ctx.font = `${layer.fontWeight} ${metrics.fontSize}px ${layer.fontFamily}`
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${layer.letterSpacing * Math.min(target.width / preset.baseCanvas.width, target.height / preset.baseCanvas.height)}px`
    ctx.fillStyle = layer.color
    ctx.textAlign = layer.align
    ctx.textBaseline = 'middle'
    /*
     * 标识符在这里叠加，不写回预设：一次改动要对所有预设同时生效，且导出预设时不该把署名带走。
     *
     * ⚠️ 叠加是**逐层**的（这段在每一个文字层的渲染里都会跑）—— 单段文案的水印只贴一处，
     * 多段文案的水印默认**每段都贴**。所以给「卖点」这种不该带标识的文案留了出口：
     * 该层 `withIdentifier: false` 时跳过（2026-09-22 加，缺省仍然带）。
     */
    /*
     * ⛔ 框宽（`rect.width`）**只用来定位**（对齐锚点 + padding），绝不用来排版。
     * 排版的唯一依据是文案自己的换行符 —— 2026-09-22 两天内栽了两次，两条路都堵死：
     *
     * - **不传 `fillText` 的第 4 参（maxWidth）**：那不是「放不下就换行」，而是**横向压扁**
     *   （报障「部分文字出现被拉伸变形」）。
     * - **不自己折行**：框宽是**历史数据** —— 旧版文本层的框是手拖/铺满画布的
     *   （库里 `preset-compliance-06` 是 1160 宽的框配 19 字文案），而且它**永远算不进
     *   渲染时才叠加的标识符**（`preset-compliance-04`：框内宽 432 = 23 字 ×18px，
     *   叠加 `★` 前缀后正好 24 字 = 432，卡在边界上超出一丁点 → 末字被推到第二行，
     *   就是「我没设换行它自己换行」）。拿一个对不上的数去断行，只会把差一像素变成差一行。
     *
     * 溢出怎么办：字比框宽时按 `align` 向外长 —— `right` 保持右边缘不动、往左溢出，
     * `center` 两边对称溢出。水印里这几行本来就贴边对齐，这样正是想要的。
     */
    const textX =
      layer.align === 'left' ? -rect.width / 2 + padding : layer.align === 'right' ? rect.width / 2 - padding : 0

    /** 画一笔（描边 + 填充）。横排按整行画、竖排按单字画，这一对调用两处都要，所以收在这里。 */
    const paint = (text: string, x: number, y: number) => {
      if (layer.stroke?.enabled && metrics.strokeWidth > 0) {
        ctx.strokeStyle = layer.stroke.color || '#000000'
        ctx.lineWidth = metrics.strokeWidth
        ctx.lineJoin = 'round'
        ctx.strokeText(text, x, y)
      }
      ctx.fillText(text, x, y)
    }

    const rawText = resolveLayerText(layer, identifier)
    if (layer.orientation === 'vertical') {
      /*
       * 竖排：**一列一行地画，列内逐字**（换行符 = 换列，见 `resolveVerticalColumns`）。
       *
       * 三个与横排**逐项对称**的口径，改一边就要改另一边：
       * - `lineHeight` 在这里是**列距**、`letterSpacing` 是列内的**字间距**；
       * - canvas 的 `letterSpacing` 只作用于**水平方向** → 竖排必须自己把它加进 y 步进，
       *   并把它清回 `0px`（不清的话同一个值会被算两次）；
       * - 多列以对齐锚点为中心往两边排（与横排的多行「以框中心上下摊开」同构），
       *   所以 `align` 仍读作「这一块贴框的哪一边」。
       *
       * ⚠️ **不做自动折列**：折列要拿框高当约束，而框是历史数据（见上面那段）；
       * 换列只认用户自己敲的换行符。
       */
      ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px'
      const columns = resolveVerticalColumns(rawText)
      const charStep = metrics.fontSize + layer.letterSpacing * scale
      const columnStep = metrics.fontSize * layer.lineHeight
      columns.forEach((column, columnIndex) => {
        const x = textX + (columnIndex - (columns.length - 1) / 2) * columnStep
        const chars = Array.from(column)
        chars.forEach((char, charIndex) => {
          paint(char, x, (charIndex - (chars.length - 1) / 2) * charStep)
        })
      })
    } else {
      const lines = rawText.split('\n')
      lines.forEach((line, index) => {
        paint(line, textX, (index - (lines.length - 1) / 2) * metrics.fontSize * layer.lineHeight)
      })
    }
  }
  ctx.restore()
}

export async function renderCompositeV2ToCanvas(
  input: CompositeV2RenderInput,
  canvas: HTMLCanvasElement,
  options?: CompositeV2RenderOptions,
) {
  const background = input.backgroundDataUrl ? await loadImage(input.backgroundDataUrl) : null
  if (options?.isStale?.()) return canvas
  const overlay = await renderCombinedOverlay(input.preset, input.targetSize)
  if (options?.isStale?.()) return canvas

  canvas.width = input.targetSize.width
  canvas.height = input.targetSize.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas')
  ctx.clearRect(0, 0, input.targetSize.width, input.targetSize.height)

  if (background) {
    if (input.fitMode === 'contain-blur') {
      ctx.save()
      ctx.filter = 'blur(24px)'
      ctx.drawImage(background, -24, -24, input.targetSize.width + 48, input.targetSize.height + 48)
      ctx.restore()
    }
    const rect = planBackgroundFit(
      input.fitMode,
      { width: getSourceWidth(background), height: getSourceHeight(background) },
      input.targetSize,
    )
    ctx.drawImage(background, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh)
  }

  // overlay 可能以更大的同比例基准尺寸渲染，这里统一缩放到目标尺寸（异比例时尺寸相等，等价 1:1 绘制）
  ctx.drawImage(overlay, 0, 0, input.targetSize.width, input.targetSize.height)
  return canvas
}

export async function renderCompositeV2ToJpegDataUrl(input: CompositeV2RenderInput) {
  const canvas = document.createElement('canvas')
  await renderCompositeV2ToCanvas(input, canvas)
  // 走 toBlob 而非同步 toDataURL：后处理要把产物压到目标体积，会对同一 preset 反复试编码
  // （见 `features/postprocess/renderVariant` 的高低质量二分探测），每次同步编码都是一次主线程冻结。
  // 返回值仍是 dataUrl，调用方零改动。
  return blobToDataUrl(await canvasToBlob(canvas, 'image/jpeg', input.quality ?? 0.9))
}
