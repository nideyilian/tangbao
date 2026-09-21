/* @vitest-environment jsdom */

/**
 * 提示（toast）「关得掉」的契约。
 *
 * 背景（2026-09-21 报障）：提示没有关闭按钮，而且**没有操作按钮时容器是 `pointer-events-none`**
 * —— 用户连「点掉它」都做不到，只能干等 3 秒（带按钮的 6 秒）。自动后处理每完成一个任务
 * 都可能弹一条，等不起；一条也关不掉的提示，反复出现时就是纯粹的打扰。
 */

import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from './Toast'

type ToastState = {
  message: string
  type: 'success' | 'error' | 'info'
  action?: { label: string; onClick: () => void }
} | null

const storeState = vi.hoisted(() => ({
  toast: null as ToastState,
  clearToast: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: (selector: (value: typeof storeState) => unknown) => selector(storeState),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
})

function render() {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<Toast />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

describe('Toast 关得掉', () => {
  beforeEach(() => {
    storeState.toast = null
    storeState.clearToast.mockClear()
  })

  it('提示带关闭按钮，点它立刻消失（不必等自动关闭）', () => {
    storeState.toast = { message: '后处理完成：产出 3 个文件', type: 'info' }
    const renderer = render()

    const closeButton = renderer.root.findByProps({ 'aria-label': '关闭通知' })
    act(() => {
      closeButton.props.onClick()
    })

    expect(storeState.clearToast).toHaveBeenCalledTimes(1)
  })

  it('容器始终可点：pointer-events-none 时「点掉它」这件事根本做不到', () => {
    storeState.toast = { message: '没有产出文件：[PP-SCOPE-002] 所属方向关闭了自动后处理', type: 'error' }
    const renderer = render()

    const container = renderer.root.findByProps({ 'data-testid': 'app-toast' })
    expect(String(container.props.className)).toContain('pointer-events-auto')
  })

  it('没有提示时不渲染任何东西', () => {
    expect(render().toJSON()).toBeNull()
  })
})
