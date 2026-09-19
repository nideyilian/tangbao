import { THEME_IDS, THEME_REGISTRY, type ThemeId } from '../theme/registry'
import { SegmentedControl } from './forms'

export type ThemeSwitcherValue = ThemeId

export interface ThemeOption {
  value: ThemeId
  label: string
  description: string
}

/** 主题选项，由 src/theme/registry.ts 注册表推导（单一来源）。 */
export const THEME_OPTIONS: ThemeOption[] = THEME_IDS.map((id) => ({
  value: id,
  label: THEME_REGISTRY[id].label,
  description: THEME_REGISTRY[id].description,
}))

export interface ThemeSwitcherProps {
  value: ThemeSwitcherValue
  onChange: (value: ThemeSwitcherValue) => void
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/**
 * 主题切换器：在浅色 / 深色之间切换。
 *
 * 2026-09-19（docs/adr/0008）：原多皮肤 ColorSchemeSwitcher / ColorPresetGrid 已移除，
 * 统一收敛为这一处开关 —— 颜色只有一套 Token，主题只是同一套 Token 的明暗两种取值。
 */
export function ThemeSwitcher({
  value,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel = '主题',
}: ThemeSwitcherProps) {
  return (
    <SegmentedControl
      aria-label={ariaLabel}
      value={value}
      onValueChange={(next) => onChange(next as ThemeSwitcherValue)}
      size={size}
      className={className}
      options={THEME_OPTIONS.map((option) => ({
        value: option.value,
        label: <span title={option.description}>{option.label}</span>,
      }))}
    />
  )
}
