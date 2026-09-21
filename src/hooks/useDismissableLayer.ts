import { useEffect, useRef, type RefObject } from 'react'
import { useCloseOnEscape } from './useCloseOnEscape'

/**
 * 下拉浮层（下拉菜单 / 选择器 / 筛选面板 / 自动补全）的**统一关闭行为**：
 * 点面板外任意处关闭 + `Escape` 关闭，且 Esc 只关最内层（走 `useCloseOnEscape` 的全局栈）。
 *
 * 与「一级弹窗」的遮罩点击关闭不是一回事：下拉浮层没有独立遮罩，关闭判据是
 * "指针落点既不在面板里、也不在触发按钮上"，所以这里挂在 document 上收 `pointerdown`。
 * 这样各处的下拉不再各写一套（有的只认再次点触发按钮、有的只认鼠标移开）。
 *
 * ⚠️ 为什么必须排除触发按钮（`anchorRef`）：否则点按钮的按下瞬间就会被判成"点在外面"而关闭，
 * 紧接着按钮自己的 toggle 又把它打开 —— 表现为面板闪一下重开。
 */
export interface DismissableLayerOptions {
  /** 浮层是否打开；关闭时不挂任何监听 */
  enabled: boolean
  /** 触发关闭（点面板外 / Esc） */
  onDismiss: () => void
  /** 浮层容器 */
  ref: RefObject<HTMLElement | null>
  /** 触发按钮：落在它上面的指针事件不算"外部"，交给它自己的 toggle 处理 */
  anchorRef?: RefObject<HTMLElement | null>
}

export function useDismissableLayer({ enabled, onDismiss, ref, anchorRef }: DismissableLayerOptions) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useCloseOnEscape(enabled, () => dismissRef.current())

  useEffect(() => {
    if (!enabled) return
    // 非浏览器环境（node 环境的组件测试）没有 document：静默降级，不挂监听。
    if (typeof document === 'undefined') return
    const onPointerDown = (event: PointerEvent) => {
      const layer = ref.current
      if (!layer) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (layer.contains(target)) return
      if (anchorRef?.current?.contains(target)) return
      dismissRef.current()
    }
    // capture 阶段收：面板内部若有 stopPropagation（拖拽把手、输入框等）也不会漏掉外部点击
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [anchorRef, enabled, ref])
}
