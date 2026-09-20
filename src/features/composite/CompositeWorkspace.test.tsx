import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CompositeWorkspace from './CompositeWorkspace'
import { CONTROL_CONSOLE_SECTIONS, DEFAULT_CONTROL_CONSOLE_SECTION } from './lib/controlConsoleSections'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'

/**
 * 中控台装配测试。
 *
 * 分区内容各自 mock 成占位文本：这里要锁的是**分区注册表 → 渲染分支**的对应关系
 * （切到哪个分区就渲染哪一块），不是各分区内部的业务逻辑 —— 那种测试该跟着分区组件自己走。
 */
vi.mock('./components/PresetManagementTab', () => ({
  PresetManagementTab: () => <div>preset-screen</div>,
}))
vi.mock('./components/MediaSection', () => ({
  MediaSection: () => <div>media-screen</div>,
}))
vi.mock('./components/OutputSection', () => ({
  OutputSection: () => <div>output-screen</div>,
}))
vi.mock('./components/DistributionSection', () => ({
  DistributionSection: () => <div>distribution-screen</div>,
}))

/**
 * 切到某个分区。
 *
 * `SegmentedControl` 的按钮只带 `data-segment-index`（位置），不带 value，
 * 所以按「注册表里的顺序」换算下标 —— 这样也顺带锁住了「注册表顺序 = 界面顺序」。
 */
function switchTo(renderer: ReturnType<typeof create>, value: string) {
  const index = CONTROL_CONSOLE_SECTIONS.findIndex((section) => section.id === value)
  if (index < 0) throw new Error(`注册表里没有这个分区：${value}`)
  const button = renderer.root.findAll(
    (node) => typeof node.type === 'string' && node.type === 'button' && node.props['data-segment-index'] === index,
  )[0]
  if (!button) throw new Error(`未找到分区按钮（下标 ${index}）：${value}`)
  const onClick = button.props.onClick as (() => void) | undefined
  act(() => {
    onClick?.()
  })
}

describe('CompositeWorkspace', () => {
  beforeEach(() => {
    usePostprocessMediaStore.setState({ selectedMediaIds: [] })
  })

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

  it('renders the watermark section as the default console function', () => {
    // 第一个分区必须是水印：它是历史行为唯一的入口，改成别的会让老用户点进来看到别处。
    expect(DEFAULT_CONTROL_CONSOLE_SECTION).toBe('watermark')

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByProps({ children: 'preset-screen' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: 'media-screen' })).toHaveLength(0)
  })

  it('labels the console as 中控台 rather than 水印预设', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    const main = renderer.root.findByType('main')
    expect(main.props['aria-label']).toBe('中控台工作区')
    expect(renderer.root.findByProps({ 'aria-label': '切换中控台功能' })).toBeTruthy()
  })

  it('switches to each registered section and renders exactly one at a time', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    const expectations: Record<string, string> = {
      watermark: 'preset-screen',
      media: 'media-screen',
      output: 'output-screen',
      distribution: 'distribution-screen',
    }
    // 注册表里的每个分区都要真的能切过去 —— 加了分区却忘了接线是这类注册表最常见的失效
    for (const section of CONTROL_CONSOLE_SECTIONS) {
      switchTo(renderer, section.id)
      const expected = expectations[section.id]
      expect(expected, `分区 ${section.id} 缺少期望的占位文本`).toBeTruthy()
      expect(renderer.root.findAllByProps({ children: expected })).toHaveLength(1)
      // 同一时刻只能渲染一个分区：否则两块叠在一起，改哪块都说不清
      const others = Object.entries(expectations)
        .filter(([id]) => id !== section.id)
        .map(([, text]) => text)
      for (const other of others) {
        expect(renderer.root.findAllByProps({ children: other })).toHaveLength(0)
      }
    }
  })
})
