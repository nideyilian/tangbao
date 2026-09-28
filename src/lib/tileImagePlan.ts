import { FULL_THUMBNAIL_MAX_EDGE, GRID_THUMBNAIL_WIDTH_LIMIT } from './thumbnailLimits'

/** 磁贴取图方案：网格小图 / 详情大图 / 原图直出。 */
export type TileImagePlan = 'grid' | 'full' | 'original'

/**
 * 按磁贴的**显示尺寸**决定用哪一档图源。
 *
 * 背景（2026-09-28 报障「图片模式预览时，图片即使调整到最小尺寸仍然非常模糊」）：
 * 磁贴宽度 = 内容宽 ÷ 列数，而缩略图的像素是固定的 —— 4K 屏 + 150% 缩放下，
 * 紧凑 6 列的一个磁贴要 570 设备像素，而 grid 小图横图只有 512 宽、竖图更少，
 * 只能被浏览器拉伸。**调密度救不了这件事**：紧凑 570 / 标准 687 / 大图 1158，
 * 三个档位全部超过源的分辨率，改的只是拉伸倍数。
 *
 * 所以判据是「这个磁贴实际需要多少设备像素」：
 * - ≤ grid 宽度上限 → 网格小图（省内存、省磁盘读）
 * - ≤ full 最长边 → 详情大图
 * - 还更大 → 直接给原图协议地址，让 Chromium 按显示尺寸解码缩放（大图密度下本来就该看细节）
 *
 * 阈值取自两档源的实际能力（`db.ts` 的常量），这里不另写一份数字 ——
 * 两边对不上时会出现「选了够用的档位却还是糊」这种最难查的静默失效。
 */
export function resolveTileImagePlan(tileCssWidth: number, devicePixelRatio: number): TileImagePlan {
  const cssWidth = Number.isFinite(tileCssWidth) && tileCssWidth > 0 ? tileCssWidth : 0
  // 拿不到磁贴宽度（CSS 网格布局、测试环境）时保守走小图：宁省内存，也不无谓拉原图
  if (cssWidth <= 0) return 'grid'
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const needPx = cssWidth * dpr
  if (needPx <= GRID_THUMBNAIL_WIDTH_LIMIT) return 'grid'
  if (needPx <= FULL_THUMBNAIL_MAX_EDGE) return 'full'
  return 'original'
}

/**
 * 取当前环境的设备像素比。
 * Electron 下用户改缩放（display 缩放 / 页面缩放）会实时反映在 `devicePixelRatio` 上，
 * 所以每次重算都要现读，不要缓存在模块级。
 */
export function currentDevicePixelRatio(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/**
 * 从磁贴样式里取 CSS 宽度（绝对定位瀑布流会写 `style.width`）。
 * 走 CSS 网格单元布局（如每日回顾的 `minmax(120px, 1fr)`）时拿不到数字，
 * 返回 0 让调用方走保守分支。
 */
export function tileCssWidthFromStyle(style: { width?: string | number } | undefined): number {
  const width = style?.width
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 0
}
