import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './node_modules/streamdown/dist/*.js'],
  theme: {
    extend: {
      colors: {
        // gray 收敛到 zinc（与设计系统中性灰阶同族）
        gray: colors.zinc,
        // 语义色单一来源：Tailwind 的 ds-* 全部映射到 --ds-color-*（src/design-system/styles.css）。
        // 2026-09-19 已删除：shadcn 旧桥映射（background/foreground/muted/border/input/primary/sidebar）
        // 与 blue.* 皮肤色板映射 —— 二者实测 0 消费，见 docs/adr/0008。
        ds: {
          canvas: 'hsl(var(--ds-color-canvas) / <alpha-value>)',
          surface: 'hsl(var(--ds-color-surface) / <alpha-value>)',
          subtle: 'hsl(var(--ds-color-surface-subtle) / <alpha-value>)',
          raised: 'hsl(var(--ds-color-surface-raised) / <alpha-value>)',
          text: 'hsl(var(--ds-color-text) / <alpha-value>)',
          muted: 'hsl(var(--ds-color-text-muted) / <alpha-value>)',
          'text-subtle': 'hsl(var(--ds-color-text-subtle) / <alpha-value>)',
          'text-inverse': 'hsl(var(--ds-color-text-inverse) / <alpha-value>)',
          border: 'hsl(var(--ds-color-border) / <alpha-value>)',
          'border-strong': 'hsl(var(--ds-color-border-strong) / <alpha-value>)',
          primary: 'hsl(var(--ds-color-primary) / <alpha-value>)',
          'primary-hover': 'hsl(var(--ds-color-primary-hover) / <alpha-value>)',
          'primary-subtle': 'hsl(var(--ds-color-primary-subtle) / <alpha-value>)',
          selection: 'hsl(var(--ds-color-selection-surface) / <alpha-value>)',
          'selection-border': 'hsl(var(--ds-color-selection-border) / <alpha-value>)',
          'selection-text': 'hsl(var(--ds-color-selection-text) / <alpha-value>)',
          success: 'hsl(var(--ds-color-success) / <alpha-value>)',
          'success-subtle': 'hsl(var(--ds-color-success-subtle) / <alpha-value>)',
          warning: 'hsl(var(--ds-color-warning) / <alpha-value>)',
          'warning-subtle': 'hsl(var(--ds-color-warning-subtle) / <alpha-value>)',
          danger: 'hsl(var(--ds-color-danger) / <alpha-value>)',
          'danger-hover': 'hsl(var(--ds-color-danger-hover) / <alpha-value>)',
          'danger-subtle': 'hsl(var(--ds-color-danger-subtle) / <alpha-value>)',
          info: 'hsl(var(--ds-color-info) / <alpha-value>)',
          'info-subtle': 'hsl(var(--ds-color-info-subtle) / <alpha-value>)',
          focus: 'hsl(var(--ds-color-focus) / <alpha-value>)',
          scrim: 'hsl(var(--ds-color-scrim) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        'ds-xs': 'var(--ds-font-size-xs)',
        'ds-sm': 'var(--ds-font-size-sm)',
        'ds-md': 'var(--ds-font-size-md)',
        'ds-lg': 'var(--ds-font-size-lg)',
        'ds-xl': 'var(--ds-font-size-xl)',
        'ds-2xl': 'var(--ds-font-size-2xl)',
      },
      borderRadius: {
        'ds-sm': 'var(--ds-radius-sm)',
        'ds-md': 'var(--ds-radius-md)',
        'ds-lg': 'var(--ds-radius-lg)',
        'ds-xl': 'var(--ds-radius-xl)',
        'ds-2xl': 'var(--ds-radius-2xl)',
      },
      // 控件高度尺度：对应 --ds-control-{sm,md,lg}（32/36/40px）。
      // 业务代码统一用 h-ds-control-* / min-h-ds-control-*，替代裸 h-7~h-16 控件高度。
      // 内容/标题栏/缩略图等非控件尺度（h-12/14/16、h-[52px]）用 h-ds-{12,14,16,52}，
      // 像素值保持不变，仅统一类名命名空间，后续调整只改此处。
      height: {
        'ds-control-sm': 'var(--ds-control-sm)',
        'ds-control-md': 'var(--ds-control-md)',
        'ds-control-lg': 'var(--ds-control-lg)',
        'ds-12': '3rem',
        'ds-14': '3.5rem',
        'ds-16': '4rem',
        'ds-52': '3.25rem',
      },
      minHeight: {
        'ds-control-sm': 'var(--ds-control-sm)',
        'ds-control-md': 'var(--ds-control-md)',
        'ds-control-lg': 'var(--ds-control-lg)',
        'ds-12': '3rem',
        'ds-14': '3.5rem',
        'ds-16': '4rem',
        'ds-52': '3.25rem',
      },
      // 正方形图标按钮成对（h-N w-N）时同步宽度，保证不变形
      width: {
        'ds-control-sm': 'var(--ds-control-sm)',
        'ds-control-md': 'var(--ds-control-md)',
        'ds-control-lg': 'var(--ds-control-lg)',
        'ds-12': '3rem',
        'ds-14': '3.5rem',
        'ds-16': '4rem',
        'ds-52': '3.25rem',
      },
      boxShadow: {
        'ds-sm': 'var(--ds-shadow-sm)',
        'ds-md': 'var(--ds-shadow-md)',
        'ds-lg': 'var(--ds-shadow-lg)',
        'ds-inner': 'var(--ds-shadow-inner)',
      },
      zIndex: {
        sticky: '20',
        dropdown: '40',
        overlay: '80',
        modal: '90',
        toast: '100',
        tooltip: '110',
        confirm: '120',
      },
    },
  },
  plugins: [],
}
