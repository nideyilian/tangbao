import type { CompositeV2FitMode, CompositeV2Position } from './compositeV2Types'

type Size = { width: number; height: number }

export type CompositeV2RenderBranch = 'source-first' | 'target-first'

export type CompositeV2DrawRect = {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

const VALID_ANCHORS = new Set([
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
])

function assertValidSize(size: Size) {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error('无效的合成尺寸')
  }
}

function assertValidNumber(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('无效的合成数值')
  }
}

function assertValidAnchor(anchor: string) {
  if (!VALID_ANCHORS.has(anchor)) {
    throw new Error('未知的锚点')
  }
}

export function chooseRenderBranch(source: Size, target: Size, tolerance = 0.001): CompositeV2RenderBranch {
  assertValidSize(source)
  assertValidSize(target)

  const sourceRatio = source.width / source.height
  const targetRatio = target.width / target.height
  return Math.abs(sourceRatio - targetRatio) <= tolerance ? 'source-first' : 'target-first'
}

export function planBackgroundFit(mode: CompositeV2FitMode, source: Size, target: Size): CompositeV2DrawRect {
  assertValidSize(source)
  assertValidSize(target)

  switch (mode) {
    case 'stretch':
      return {
        sx: 0,
        sy: 0,
        sw: source.width,
        sh: source.height,
        dx: 0,
        dy: 0,
        dw: target.width,
        dh: target.height,
      }
    case 'contain-blur': {
      const scale = Math.min(target.width / source.width, target.height / source.height)
      const dw = source.width * scale
      const dh = source.height * scale
      return {
        sx: 0,
        sy: 0,
        sw: source.width,
        sh: source.height,
        dx: (target.width - dw) / 2,
        dy: (target.height - dh) / 2,
        dw,
        dh,
      }
    }
    case 'crop-fill': {
      const scale = Math.max(target.width / source.width, target.height / source.height)
      const sw = target.width / scale
      const sh = target.height / scale
      return {
        sx: (source.width - sw) / 2,
        sy: (source.height - sh) / 2,
        sw,
        sh,
        dx: 0,
        dy: 0,
        dw: target.width,
        dh: target.height,
      }
    }
    default:
      throw new Error('未知的背景适应模式')
  }
}

/**
 * 把一张图片按**原图比例**摆进图层框，返回实际绘制尺寸。
 *
 * 为什么必须有它（2026-10-12 杰哥报障「矩形 LOGO 被压缩拉伸」）：原实现直接
 * `drawImage(image, x, y, rect.width, rect.height)` —— 框是什么比例，图就被拉成什么比例。
 * 而 LOGO 图层的框由 `createLogoLayer` 固定成 100×100 正方形，于是**任何非正方形素材
 * 一放进去就变形**，且改框比例也只会换个方向继续变形。
 *
 * 两种模式都**只等比缩放**，任何情况下都不改变图片纵横比：
 * - `cover`（对应「裁剪」打开）：填满框、居中、超出部分由调用方的 `clip` 裁掉。
 *   裁剪语义本来就要求填满，而填满可以靠放大而不是靠拉伸。
 * - `contain`（默认）：完整显示、居中，框比图大时留白。
 *   水印里的 LOGO 多数是带透明边的标志，完整显示才是要的效果。
 */
export function fitMediaSize(source: Size, box: Size, mode: 'contain' | 'cover'): Size {
  assertValidSize(source)
  assertValidSize(box)
  const scale =
    mode === 'cover'
      ? Math.max(box.width / source.width, box.height / source.height)
      : Math.min(box.width / source.width, box.height / source.height)
  return { width: source.width * scale, height: source.height * scale }
}

export function mapLayerPositionToCanvas(position: CompositeV2Position, base: Size, target: Size) {
  assertValidSize(base)
  assertValidSize(target)

  const scaleX = target.width / base.width
  const scaleY = target.height / base.height
  const scale = Math.min(scaleX, scaleY)

  if (position.mode === 'free') {
    assertValidSize({ width: position.width, height: position.height })
    assertValidNumber(position.x)
    assertValidNumber(position.y)
    return {
      x: position.x * scaleX,
      y: position.y * scaleY,
      width: position.width * scale,
      height: position.height * scale,
    }
  }

  if (position.mode === 'anchor') {
    assertValidSize({ width: position.width, height: position.height })
    assertValidNumber(position.marginX)
    assertValidNumber(position.marginY)
    assertValidNumber(position.offsetX)
    assertValidNumber(position.offsetY)
    assertValidAnchor(position.anchor)

    const width = position.width * scale
    const height = position.height * scale
    const marginX = position.marginX * scale
    const marginY = position.marginY * scale
    const offsetX = position.offsetX * scale
    const offsetY = position.offsetY * scale
    const [vertical, horizontal] = position.anchor.split('-') as [string, string | undefined]
    const h = horizontal ?? vertical
    const v = horizontal ? vertical : 'center'
    const x = h === 'left' ? marginX : h === 'right' ? target.width - width - marginX : (target.width - width) / 2
    const y = v === 'top' ? marginY : v === 'bottom' ? target.height - height - marginY : (target.height - height) / 2

    return { x: x + offsetX, y: y + offsetY, width, height }
  }

  throw new Error('未知的定位模式')
}
