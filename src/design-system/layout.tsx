import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './components'

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12
  align?: CSSProperties['alignItems']
}

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { align, className, gap = 4, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-stack', className)}
      style={{ ...style, alignItems: align, gap: `var(--ds-space-${gap})` }}
      {...props}
    />
  )
})

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8
  align?: CSSProperties['alignItems']
  justify?: CSSProperties['justifyContent']
  wrap?: boolean
}

export const Inline = forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { align = 'center', className, gap = 2, justify, style, wrap = true, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-inline', className)}
      style={{
        ...style,
        alignItems: align,
        gap: `var(--ds-space-${gap})`,
        justifyContent: justify,
        flexWrap: wrap ? 'wrap' : 'nowrap',
      }}
      {...props}
    />
  )
})

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  minColumnWidth?: string
  gap?: 2 | 3 | 4 | 5 | 6 | 8
}

export const Grid = forwardRef<HTMLDivElement, GridProps>(function Grid(
  { className, gap = 4, minColumnWidth = '16rem', style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-grid', className)}
      style={{
        ...style,
        gap: `var(--ds-space-${gap})`,
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumnWidth}), 1fr))`,
      }}
      {...props}
    />
  )
})

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'full'
}

export const Container = forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { className, size = 'lg', ...props },
  ref,
) {
  return <div ref={ref} className={cx('ds-container', `ds-container--${size}`, className)} {...props} />
})

export interface FormGridProps extends HTMLAttributes<HTMLDivElement> {
  /** 行间距（字段行之间）。默认 16px = `--ds-space-4`（MASTER 4.4 标尺） */
  rowGap?: 2 | 3 | 4 | 5 | 6
  /** 列间距（标签列 ↔ 控件列）。默认 20px = `--ds-space-5` */
  columnGap?: 3 | 4 | 5 | 6
}

/**
 * 表单栅格：**12 列固定列模板**。
 *
 * 用法是「标签列 + 控件列」成对平铺（不是每行自己包一层 flex）：
 *
 * ```tsx
 * <FormGrid>
 *   <FormGridLabel>输出目录</FormGridLabel>
 *   <FormGridControl><TextField … /></FormGridControl>
 * </FormGrid>
 * ```
 *
 * 两列的具体跨度写在样式里（`.ds-form-grid__label` = 5 列、`__control` = 7 列），
 * 窄容器自动堆叠（容器查询，不看窗口宽度）。**对齐由列模板保证**，不由内容的宽度碰运气。
 */
export const FormGrid = forwardRef<HTMLDivElement, FormGridProps>(function FormGrid(
  { className, columnGap = 5, rowGap = 4, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-form-grid', className)}
      style={{ ...style, columnGap: `var(--ds-space-${columnGap})`, rowGap: `var(--ds-space-${rowGap})` }}
      {...props}
    />
  )
})

export type FormGridSlotProps = HTMLAttributes<HTMLDivElement>

/** 表单栅格的标签槽：字段名 + 状态徽章 + 字段级操作（如「恢复继承」）。 */
export const FormGridLabel = forwardRef<HTMLDivElement, FormGridSlotProps>(function FormGridLabel(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cx('ds-form-grid__label', className)} {...props} />
})

/** 表单栅格的控件槽：字段的实际控件（输入框、开关、只读摘要…）。 */
export const FormGridControl = forwardRef<HTMLDivElement, FormGridSlotProps>(function FormGridControl(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cx('ds-form-grid__control', className)} {...props} />
})

/**
 * 表单栅格的**跨整行**槽。
 *
 * 用于「一整组」内容而不是单个字段的值 —— 典型是「按渠道的目录列表」：
 * 它自身还要「渠道名 + 输入框 + 操作」，塞进控件列就会被压到读不了
 * （2026-09-20 实测：中文共享盘路径被截成 `\192.168.202.:`）。
 */
export const FormGridFull = forwardRef<HTMLDivElement, FormGridSlotProps>(function FormGridFull(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cx('ds-form-grid__full', className)} {...props} />
})

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical'
}

export const Divider = forwardRef<HTMLHRElement, DividerProps>(function Divider(
  { className, orientation = 'horizontal', ...props },
  ref,
) {
  return (
    <hr
      ref={ref}
      aria-orientation={orientation}
      className={cx('ds-divider', `ds-divider--${orientation}`, className)}
      {...props}
    />
  )
})

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  maxHeight?: string
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { className, maxHeight, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx('ds-scroll-area', className)}
      style={{ ...style, maxHeight }}
      tabIndex={0}
      {...props}
    />
  )
})

export interface SplitPaneProps extends HTMLAttributes<HTMLDivElement> {
  sidebar: ReactNode
  sidebarPosition?: 'start' | 'end'
  sidebarWidth?: string
}

export function SplitPane({
  children,
  className,
  sidebar,
  sidebarPosition = 'start',
  sidebarWidth = '20rem',
  style,
  ...props
}: SplitPaneProps) {
  return (
    <div
      className={cx('ds-split-pane', `ds-split-pane--${sidebarPosition}`, className)}
      style={{ ...style, '--ds-split-sidebar': sidebarWidth } as CSSProperties}
      {...props}
    >
      <aside className="ds-split-pane__sidebar">{sidebar}</aside>
      <div className="ds-split-pane__content">{children}</div>
    </div>
  )
}
