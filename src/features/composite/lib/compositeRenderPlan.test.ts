import { describe, expect, it } from 'vitest'
import { chooseRenderBranch, fitMediaSize, mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'

describe('composite render plan', () => {
  it('chooses source-first when source and target ratios match within tolerance', () => {
    expect(chooseRenderBranch({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toBe('source-first')
  })

  it('chooses target-first when source and target ratios differ beyond tolerance', () => {
    expect(chooseRenderBranch({ width: 1280, height: 720 }, { width: 1080, height: 1920 })).toBe('target-first')
  })

  it('plans crop-fill as a centered source crop that fills the target', () => {
    expect(planBackgroundFit('crop-fill', { width: 1000, height: 500 }, { width: 300, height: 300 })).toMatchObject({
      sx: 250,
      sy: 0,
      sw: 500,
      sh: 500,
      dx: 0,
      dy: 0,
      dw: 300,
      dh: 300,
    })
  })

  it('plans contain-blur as a centered full-image fit inside the target', () => {
    expect(planBackgroundFit('contain-blur', { width: 400, height: 200 }, { width: 300, height: 300 })).toMatchObject({
      sx: 0,
      sy: 0,
      sw: 400,
      sh: 200,
      dx: 0,
      dy: 75,
      dw: 300,
      dh: 150,
    })
  })

  it('plans stretch as a direct source-to-target draw', () => {
    expect(planBackgroundFit('stretch', { width: 400, height: 200 }, { width: 300, height: 300 })).toMatchObject({
      sx: 0,
      sy: 0,
      sw: 400,
      sh: 200,
      dx: 0,
      dy: 0,
      dw: 300,
      dh: 300,
    })
  })

  it('rejects unknown background fit modes', () => {
    expect(() =>
      planBackgroundFit('mystery' as never, { width: 400, height: 200 }, { width: 300, height: 300 }),
    ).toThrow(/未知的/i)
  })

  it('maps free position from base canvas to target canvas', () => {
    expect(
      mapLayerPositionToCanvas(
        { mode: 'free', x: 128, y: 72, width: 256, height: 144 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toEqual({ x: 64, y: 36, width: 128, height: 72 })
  })

  it('maps anchor position using scaled size, margins, and offsets', () => {
    expect(
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'top-left',
          marginX: 128,
          marginY: 72,
          offsetX: 32,
          offsetY: 16,
          width: 256,
          height: 144,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toEqual({ x: 80, y: 44, width: 128, height: 72 })
  })

  it('rejects invalid sizes when choosing a render branch', () => {
    expect(() => chooseRenderBranch({ width: 0, height: 720 }, { width: 1920, height: 1080 })).toThrow(/无效的/i)
  })

  it('rejects invalid sizes when planning background fit', () => {
    expect(() =>
      planBackgroundFit('crop-fill', { width: 1000, height: 500 }, { width: Number.NaN, height: 300 }),
    ).toThrow(/无效的/i)
  })

  it('rejects invalid sizes when mapping layer positions', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'free', x: 1, y: 2, width: 3, height: 4 },
        { width: 1280, height: -1 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects invalid free layer dimensions', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'free', x: 1, y: 2, width: 0, height: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects non-finite free layer coordinates', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'free', x: Number.POSITIVE_INFINITY, y: 2, width: 3, height: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects invalid anchor layer dimensions', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'center',
          marginX: 0,
          marginY: 0,
          offsetX: 0,
          offsetY: 0,
          width: Number.NaN,
          height: 4,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects non-finite anchor margins and offsets', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'center',
          marginX: Number.POSITIVE_INFINITY,
          marginY: 0,
          offsetX: 0,
          offsetY: Number.NaN,
          width: 3,
          height: 4,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/无效的/i)
  })

  it('rejects unknown position modes', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        { mode: 'mystery' as never, x: 1, y: 2, width: 3, height: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/未知的/i)
  })

  it('rejects unknown anchor values', () => {
    expect(() =>
      mapLayerPositionToCanvas(
        {
          mode: 'anchor',
          anchor: 'mystery' as never,
          marginX: 0,
          marginY: 0,
          offsetX: 0,
          offsetY: 0,
          width: 3,
          height: 4,
        },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toThrow(/未知的/i)
  })
})

/*
 * 图片/LOGO 图层「按原图比例画」的几何（2026-10-12 杰哥报障「矩形 LOGO 被压缩拉伸」）。
 *
 * 原来的绘制是 `drawImage(image, x, y, 框宽, 框高)` —— 框是什么比例，图就被拉成什么比例。
 * 这两条守卫钉住「只等比缩放」：任一端都不能出现「宽高比变了」。
 */
describe('fitMediaSize —— 图片进框只等比缩放，绝不拉伸', () => {
  it('⭐ contain：长边贴框、短边等比缩（矩形图进方框不会被压成正方形）', () => {
    // 300×100 的 LOGO 放进 100×100 的框
    const size = fitMediaSize({ width: 300, height: 100 }, { width: 100, height: 100 }, 'contain')
    expect(size.width).toBeCloseTo(100)
    expect(size.height).toBeCloseTo(100 / 3)
  })

  it('⭐ cover：填满框、超出部分交给裁剪（同样不吃掉比例）', () => {
    const size = fitMediaSize({ width: 300, height: 100 }, { width: 100, height: 100 }, 'cover')
    expect(size.width).toBeCloseTo(300)
    expect(size.height).toBeCloseTo(100)
  })

  it('两种模式下宽高比都与原图一致 —— 这是「不变形」唯一的判据', () => {
    const source = { width: 1024, height: 300 }
    const box = { width: 137, height: 512 }
    for (const mode of ['contain', 'cover'] as const) {
      const size = fitMediaSize(source, box, mode)
      expect(size.width / size.height).toBeCloseTo(source.width / source.height)
    }
  })

  it('正方形图进方框：比例本来就对，尺寸等于框（对照，证明不是「一律缩小」）', () => {
    expect(fitMediaSize({ width: 200, height: 200 }, { width: 50, height: 50 }, 'contain')).toEqual({
      width: 50,
      height: 50,
    })
  })

  it('尺寸非法时抛错，不静默返回 0（0 会让 drawImage 什么都不画）', () => {
    expect(() => fitMediaSize({ width: 0, height: 10 }, { width: 10, height: 10 }, 'contain')).toThrow(/尺寸/i)
  })
})
