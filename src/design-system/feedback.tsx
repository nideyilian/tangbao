import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { Button, cx, EmptyState } from './components'
import { AlertCircleIcon, CheckCircleIcon, CloseIcon, InfoIcon, TriangleAlertIcon } from './icons'

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger'

const feedbackIcons = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: TriangleAlertIcon,
  danger: AlertCircleIcon,
}

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: FeedbackTone
  title?: ReactNode
  actions?: ReactNode
}

export function Alert({ actions, children, className, role, title, tone = 'info', ...props }: AlertProps) {
  const Icon = feedbackIcons[tone]
  return (
    <div
      className={cx('ds-alert', `ds-alert--${tone}`, className)}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      {...props}
    >
      <Icon className="ds-alert__icon" size={18} aria-hidden="true" />
      <div className="ds-alert__copy">
        {title && <div className="ds-alert__title">{title}</div>}
        <div className="ds-alert__content">{children}</div>
      </div>
      {actions && <div className="ds-alert__actions">{actions}</div>}
    </div>
  )
}

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

export function Spinner({ className, label = '正在加载', size = 'md', ...props }: SpinnerProps) {
  return (
    <span className={cx('ds-spinner', `ds-spinner--${size}`, className)} role="status" aria-label={label} {...props} />
  )
}

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value?: number
  max?: number
  label: string
  showValue?: boolean
  tone?: 'primary' | FeedbackTone
}

export function Progress({
  className,
  label,
  max = 100,
  showValue = false,
  tone = 'primary',
  value,
  ...props
}: ProgressProps) {
  const bounded = value === undefined ? undefined : Math.min(max, Math.max(0, value))
  const percentage = bounded === undefined ? undefined : Math.round((bounded / max) * 100)

  return (
    <div className={cx('ds-progress', className)} {...props}>
      <div className="ds-progress__label-row">
        <span>{label}</span>
        {showValue && percentage !== undefined && <span>{percentage}%</span>}
      </div>
      <div
        className="ds-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={bounded}
        aria-busy={bounded === undefined || undefined}
      >
        <span
          className={cx(
            'ds-progress__bar',
            `ds-progress__bar--${tone}`,
            bounded === undefined && 'ds-progress__bar--indeterminate',
          )}
          style={bounded === undefined ? undefined : { transform: `scaleX(${percentage! / 100})` }}
        />
      </div>
    </div>
  )
}

export interface ProgressRingProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * 0–100 的确定进度。**不传 = 进度不可知**，画一段 1/4 弧自转。
   *
   * 「说不出」与「0%」必须分开：排队中、多方向并发时没有单一百分比，
   * 这时给个 0% 的环会让人以为它根本没在动。
   */
  value?: number
  /** 直径（px）。工具栏这类紧凑位置 18 够用。 */
  size?: number
  tone?: 'primary' | FeedbackTone | 'neutral'
}

/**
 * 环形进度。
 *
 * 存在的理由（2026-09-23）：工具栏那类**横向空间极紧**的位置放不下条形进度，
 * 原先的写法是「一个转圈图标 + 一句文字」—— 两者都在说「在跑」，而且图标是直接塞进
 * 按钮 children 的 SVG（`svg{display:block}` 会让它另起一行压住文字，见 compliance.test.ts
 * 里那条同名检查）。
 *
 * 环把「在跑」和「跑到哪了」压进同一个方框：弧长就是百分比，不必再读数字；
 * 它按直径占位、不吃横向空间，也就不会再跟文字抢那一行。
 *
 * 无障碍：环是**装饰**，状态由相邻文字提供（与 `StatusIndicator` 的圆点同一口径），
 * 因此固定 `aria-hidden`，不重复播报。
 */
export function ProgressRing({ className, size = 18, tone = 'primary', value, ...props }: ProgressRingProps) {
  const bounded = value === undefined ? undefined : Math.min(100, Math.max(0, value))
  // 线宽随直径走：18px 用 2.2px，放大后不至于变成一根发丝
  const strokeWidth = Math.max(2, Math.round(size / 8))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  // 确定态：整圈虚线按百分比截断；不定态：只留 1/4 弧，靠整体自转表达「在忙」
  const dashArray =
    bounded === undefined ? `${circumference * 0.25} ${circumference}` : `${circumference} ${circumference}`
  const dashOffset = bounded === undefined ? 0 : circumference * (1 - bounded / 100)

  return (
    <span
      aria-hidden="true"
      className={cx(
        'ds-progress-ring',
        `ds-progress-ring--${tone}`,
        bounded === undefined && 'ds-progress-ring--indeterminate',
        className,
      )}
      style={{ height: size, width: size }}
      {...props}
    >
      <svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle
          className="ds-progress-ring__track"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="ds-progress-ring__bar"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeDasharray={dashArray}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          // 从 12 点开始长（SVG 的 0° 在 3 点方向）
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </span>
  )
}

export interface StatusIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | FeedbackTone
  pulse?: boolean
}

export function StatusIndicator({ children, className, pulse, tone = 'neutral', ...props }: StatusIndicatorProps) {
  return (
    <span className={cx('ds-status', `ds-status--${tone}`, className)} {...props}>
      <span className={cx('ds-status__dot', pulse && 'ds-status__dot--pulse')} aria-hidden="true" />
      {children}
    </span>
  )
}

export interface ToastMessageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: FeedbackTone
  title?: ReactNode
  /** 可选的操作按钮（例如「查看」跳转）。渲染在文案与关闭按钮之间。 */
  action?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
}

export const ToastMessage = forwardRef<HTMLDivElement, ToastMessageProps>(function ToastMessage(
  { action, children, className, dismissLabel = '关闭通知', onDismiss, role, title, tone = 'info', ...props },
  ref,
) {
  const Icon = feedbackIcons[tone]
  return (
    <div
      ref={ref}
      className={cx('ds-toast', `ds-toast--${tone}`, className)}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
      <div className="ds-toast__copy">
        {title && <div className="ds-toast__title">{title}</div>}
        <div>{children}</div>
      </div>
      {action && <div className="ds-toast__action">{action}</div>}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel}>
          <CloseIcon size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
})

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  description: ReactNode
  onRetry?: () => void
  retryLabel?: string
  details?: ReactNode
}

export function ErrorState({
  className,
  description,
  details,
  onRetry,
  retryLabel = '重试',
  title = '操作未完成',
  ...props
}: ErrorStateProps) {
  return (
    <EmptyState
      className={className}
      icon={<AlertCircleIcon size={22} />}
      title={title}
      description={
        <>
          {description}
          {details && <span className="ds-error-state__details">{details}</span>}
        </>
      }
      action={onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
      {...props}
    />
  )
}

export interface KbdProps extends HTMLAttributes<HTMLElement> {}

export function Kbd({ className, ...props }: KbdProps) {
  return <kbd className={cx('ds-kbd', className)} {...props} />
}
