import { describe, expect, it } from 'vitest'
import { resolveTileImagePlan, tileCssWidthFromStyle } from './tileImagePlan'
import { FULL_THUMBNAIL_MAX_EDGE, GRID_THUMBNAIL_WIDTH_LIMIT } from './thumbnailLimits'

describe('resolveTileImagePlan', () => {
  it('1080p / 100% 缩放：磁贴远小于小图，仍走省内存的 grid 档（不改变既有行为）', () => {
    // 内容区 1200 CSS ÷ 6 列（紧凑）
    expect(resolveTileImagePlan(190, 1)).toBe('grid')
    // 内容区 2340 CSS ÷ 5 列（标准）
    expect(resolveTileImagePlan(458, 1)).toBe('grid')
  })

  it('4K / 150% 缩放：密度只改列数、救不了分辨率，按需逐档升级', () => {
    // 2026-09-28 报障的现场：内容区 2340 CSS、DPR 1.5
    // 紧凑 6 列 → 380 CSS × 1.5 = 570 设备像素 > 512（旧行为：被拉伸 1.5 倍 ⇒ 糊）
    expect(resolveTileImagePlan(380, 1.5)).toBe('full')
    // 标准 5 列 → 458 × 1.5 = 687
    expect(resolveTileImagePlan(458, 1.5)).toBe('full')
    // 大图 3 列 → 772 × 1.5 = 1158 > 1024 ⇒ 原图直出
    expect(resolveTileImagePlan(772, 1.5)).toBe('original')
  })

  it('边界是「等于即够用」', () => {
    expect(resolveTileImagePlan(512, 1)).toBe('grid')
    expect(resolveTileImagePlan(512.5, 1)).toBe('full')
    expect(resolveTileImagePlan(1024, 1)).toBe('full')
    expect(resolveTileImagePlan(1024.5, 1)).toBe('original')
  })

  it('拿不到宽度 / DPR 非法时保守走小图，不无谓拉原图', () => {
    expect(resolveTileImagePlan(0, 1.5)).toBe('grid')
    expect(resolveTileImagePlan(-10, 1.5)).toBe('grid')
    expect(resolveTileImagePlan(Number.NaN, 1.5)).toBe('grid')
    expect(resolveTileImagePlan(380, 0)).toBe('grid')
    expect(resolveTileImagePlan(380, Number.NaN)).toBe('grid')
  })

  it('阈值取自缩略图口径常量（两边写两份数字就会「选了够用的档位却还是糊」）', () => {
    expect(resolveTileImagePlan(GRID_THUMBNAIL_WIDTH_LIMIT, 1)).toBe('grid')
    expect(resolveTileImagePlan(GRID_THUMBNAIL_WIDTH_LIMIT + 1, 1)).toBe('full')
    expect(resolveTileImagePlan(FULL_THUMBNAIL_MAX_EDGE, 1)).toBe('full')
    expect(resolveTileImagePlan(FULL_THUMBNAIL_MAX_EDGE + 1, 1)).toBe('original')
  })
})

describe('tileCssWidthFromStyle', () => {
  it('读绝对定位瀑布流写入的数字宽度', () => {
    expect(tileCssWidthFromStyle({ width: 380 })).toBe(380)
  })

  it('CSS 网格单元 / 百分比 / 缺失一律返回 0，让调用方走保守分支', () => {
    expect(tileCssWidthFromStyle({ width: '100%' })).toBe(0)
    expect(tileCssWidthFromStyle({})).toBe(0)
    expect(tileCssWidthFromStyle(undefined)).toBe(0)
  })
})
