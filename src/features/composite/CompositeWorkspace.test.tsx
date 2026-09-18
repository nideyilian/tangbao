import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import CompositeWorkspace from './CompositeWorkspace'

vi.mock('./components/PresetManagementTab', () => ({
  PresetManagementTab: () => <div>preset-screen</div>,
}))

describe('CompositeWorkspace', () => {
  it('fills the viewport below the fixed application header', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    const workspace = renderer.root.findByType('main')
    // 顶栏在自己的 return 里放了一块等高的 invisible 占位，所以「视口 − 顶栏高度」即整屏；
    // 窄屏顶栏多一行工作区切换，与素材库同口径取 7rem。
    expect(workspace.props.className).toContain('h-[calc(100dvh-7rem)]')
    expect(workspace.props.className).toContain('sm:h-[calc(100dvh-var(--app-header-offset))]')
    expect(workspace.props.className).toContain('overflow-hidden')
  })

  it('renders the preset editor without any orchestration tab', () => {
    // 编排（批量导出/分发/输出规则/历史）已归后处理，这里不再有 tab 可分。
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByProps({ children: 'preset-screen' })).toBeTruthy()
    expect(renderer.root.findAllByType('nav')).toHaveLength(0)
  })
})
