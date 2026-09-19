/**
 * 主题注册表：明暗模式的唯一定义来源。
 *
 * 2026-09-19（docs/adr/0008）：多皮肤（换肤）机制已移除。
 * 原 SKIN_REGISTRY / SkinId / normalizeSkinId / getOrderedSkins 一并删除 ——
 * 皮肤带来的复杂度（5 套皮肤 × 2 模式 × 约 60 Token + 219 行对比度契约测试 +
 * 717 行旧工具类重定向兼容桥）远超收益，且兼容桥本身就是在补偿「Token 不统一」。
 *
 * 颜色唯一的真相源：src/design-system/styles.css 的 :root / .dark。
 * 若将来确实需要换肤，应基于变量集（variable modes）重做，而不是再叠一层 CSS 覆盖。
 */

export interface ThemeDefinition {
  /** 显示名称 */
  label: string
  /** 一句话说明 */
  description: string
}

export const THEME_REGISTRY = {
  light: { label: '浅色', description: '默认明亮主题' },
  dark: { label: '深色', description: '近黑画布，夜间护眼' },
} as const satisfies Record<string, ThemeDefinition>

/** 主题 ID：由注册表自动推导 */
export type ThemeId = keyof typeof THEME_REGISTRY

export const DEFAULT_THEME_ID: ThemeId = 'light'

/** 排序后的全部主题 ID */
export const THEME_IDS: ThemeId[] = ['light', 'dark']

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_REGISTRY, value)
}

/** 非法 / 未知主题一律回退到浅色 */
export function normalizeThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID
}

export interface ThemeEntry extends ThemeDefinition {
  id: ThemeId
}

/** 供设置页 / Header 等 UI 使用的有序主题列表 */
export function getOrderedThemes(): ThemeEntry[] {
  return THEME_IDS.map((id) => ({ id, ...THEME_REGISTRY[id] }))
}
