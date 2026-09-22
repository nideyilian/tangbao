/* @vitest-environment jsdom */

/**
 * 确认弹窗「关得掉」的契约。
 *
 * 背景（2026-09-21 报障）：后处理问题清单条数一多，卡片高度不设上限、内容也不滚动，
 * 底部的按钮被顶出屏幕外；而弹窗打开时背景滚动是锁着的 —— 用户只剩 Esc 一条路，
 * 不知道 Esc 的人当场卡住，反映出来就是「这个提示关不掉」。
 *
 * 所以三件事必须同时成立：**卡片有高度上限且内容自己滚**、**右上角有显式 ×**、**点了真的关**。
 */

import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog'

type DialogState = {
  title: string
  message: string
  showCancel?: boolean
  confirmText?: string
  checkbox?: { label: string }
  buttons?: Array<{ label: string; action: () => void }>
} | null

const storeState = vi.hoisted(() => {
  const state: { confirmDialog: DialogState; setConfirmDialog: (next: DialogState) => void } = {
    confirmDialog: null,
    setConfirmDialog: () => {},
  }
  state.setConfirmDialog = (next) => {
    state.confirmDialog = next
  }
  return state
})

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
    renderer = create(<ConfirmDialog />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

describe('ConfirmDialog 关得掉', () => {
  beforeEach(() => {
    storeState.confirmDialog = null
  })

  it('右上角有显式关闭按钮，点它真的关掉（不必知道 Esc）', () => {
    storeState.confirmDialog = {
      title: '后处理跳过（1）',
      message: '这一批没有产出',
      showCancel: false,
      confirmText: '知道了',
    }
    const renderer = render()

    const closeButton = renderer.root.findByProps({ 'aria-label': '关闭' })
    // 必须真的脱离文档流：`.ds-icon-button` 自带 `position: relative`，且 styles.css 在 index.css 之后加载，
    // 少写 `!` 就会退化成「留在流里 + 被 right/top 平移」→ 正好压在正文第一行上（2026-09-22 报障）。
    expect(String(closeButton.props.className)).toContain('!absolute')
    act(() => {
      closeButton.props.onClick()
    })

    expect(storeState.confirmDialog).toBeNull()
    act(() => {
      renderer.update(<ConfirmDialog />)
    })
    expect(renderer.toJSON()).toBeNull()
  })

  it('内容再长也不把按钮顶出屏幕：卡片限高、内容区自己滚', () => {
    storeState.confirmDialog = {
      title: '后处理跳过（20）',
      message: Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 条：所属方向关闭了自动后处理`).join('\n'),
      showCancel: false,
      confirmText: '知道了',
    }
    const renderer = render()

    const surface = renderer.root.findByProps({ role: 'alertdialog' })
    expect(String(surface.props.className)).toContain('max-h-[calc(100dvh-2rem)]')
    expect(String(surface.props.className)).toContain('flex-col')

    // 滚动的只有正文：按钮在滚动区外，必须始终可见
    const description = renderer.root.findByProps({ id: 'confirm-dialog-description' })
    expect(String(description.parent?.props.className)).toContain('overflow-y-auto')
  })

  it('复选框与自定义按钮组仍然渲染（限高改动没有吃掉既有结构）', () => {
    storeState.confirmDialog = {
      title: '删除方向',
      message: '这个方向下有 3 张素材',
      checkbox: { label: '同时删除素材' },
      buttons: [{ label: '确认删除', action: vi.fn() }],
    }
    const renderer = render()

    expect(renderer.root.findByProps({ id: 'confirm-dialog-description' })).toBeDefined()
    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('同时删除素材')
    expect(json).toContain('确认删除')
  })
})
