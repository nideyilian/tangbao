import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CompositeWorkspace from './CompositeWorkspace'
import { CONTROL_CONSOLE_SECTIONS, DEFAULT_CONTROL_CONSOLE_SECTION } from './lib/controlConsoleSections'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { useStore } from '../../store'

/**
 * 中控台装配测试。
 *
 * 复刻灵境策略中心后的形态是**左树 + 右内容**：
 * - 左栏作用域树（`ConsoleAssetTree`）；
 * - 右区 = 作用域标题 + 工具栏（配置维度下拉切换分区）+ 内容。
 *
 * 分区内容各自 mock 成占位文本：这里锁的是**分区注册表 → 渲染分支**的对应关系，
 * 以及「树 → 作用域 → 右区标题」这条链 —— 不是各分区内部的业务逻辑。
 */
vi.mock('./components/ConsoleDirectionTables', () => ({
  ConsoleDirectionTables: () => <div>directions-screen</div>,
}))
vi.mock('./components/ConsolePresetGrid', () => ({
  ConsolePresetGrid: () => <div>preset-screen</div>,
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
vi.mock('./components/PresetManagementTab', () => ({
  PresetManagementTab: () => <div>editor-screen</div>,
}))

/** 递归收集 props.children 里的全部文本（children 可能是字符串 / 单元素 / 数组） */
function collectText(children: unknown): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(collectText).join('')
  if (children && typeof children === 'object' && 'props' in (children as Record<string, unknown>)) {
    return collectText((children as { props: { children?: unknown } }).props.children)
  }
  return ''
}

/**
 * 切到某个配置维度：**点左树上的维度组**（2026-09-21 改版后维度由树承载，
 * 不再是工具栏里的下拉 —— 这条 helper 的改法本身就是那次改版的断言）。
 */
function switchSection(renderer: ReturnType<typeof create>, sectionId: string) {
  const label = CONTROL_CONSOLE_SECTIONS.find((item) => item.id === sectionId)?.label
  if (!label) throw new Error(`未知维度：${sectionId}`)
  const button = renderer.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === `配置维度 ${label}`,
  )
  act(() => {
    ;(button.props.onClick as () => void)()
  })
}

/** 点左树里的某个节点：按可见文本找按钮 */
function clickTreeButton(renderer: ReturnType<typeof create>, text: string) {
  const button = renderer.root.find((node) => node.type === 'button' && collectText(node.props.children).includes(text))
  act(() => {
    ;(button.props.onClick as () => void)()
  })
}

function findByText(renderer: ReturnType<typeof create>, text: string) {
  return renderer.root.find((node) => node.type === 'button' && collectText(node.props.children).includes(text))
}

describe('CompositeWorkspace', () => {
  beforeEach(() => {
    usePostprocessMediaStore.setState({ selectedMediaIds: [], watermarkPresetIds: [] })
    useAssetLibraryStore.setState({
      scope: 'all',
      collections: [
        { id: 'line-a', name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'direction-moon', name: '月亮', parentId: 'line-a', order: 0, createdAt: 0, updatedAt: 0 },
      ] as never,
    })
    useProjectTreeParamsStore.setState({ params: {} })
    // 分区是 store 里的值：不重置会让「默认落水印」那条用例受上一条影响
    useStore.setState({ controlConsoleSection: DEFAULT_CONTROL_CONSOLE_SECTION })
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

  it('labels the console as 中控台 and exposes the scope tree', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByType('main').props['aria-label']).toBe('中控台工作区')
    // 左栏配置资产库（配置维度 → 作用域）是复刻灵境策略中心的核心部件，必须有稳定可访问名
    expect(renderer.root.findByProps({ 'aria-label': '中控台配置资产库' })).toBeTruthy()
  })

  it('switches to each registered section and renders exactly one at a time', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    const expectations: Record<string, string> = {
      watermark: 'preset-screen',
      directions: 'directions-screen',
      media: 'media-screen',
      output: 'output-screen',
      distribution: 'distribution-screen',
    }
    // 注册表里的每个分区都要真的能切过去 —— 加了分区却忘了接线是这类注册表最常见的失效
    for (const section of CONTROL_CONSOLE_SECTIONS) {
      switchSection(renderer, section.id)
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

  it('⭐ 外部带目标分区跳进来时直接落在那一个分区（不能只切工作区）', () => {
    // 场景：别处（如「后处理」弹窗）点了「去中控台改全局规格」。
    // 分区是应用 store 里的唯一真相源，所以跳转方直接写它即可，不需要额外握手协议。
    useStore.setState({ controlConsoleSection: 'output' })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByProps({ children: 'output-screen' })).toBeTruthy()
  })

  it('⭐ 离开中控台后分区归位默认，所以「从顶栏进来」仍是水印（既有行为不变）', () => {
    useStore.setState({ controlConsoleSection: 'distribution' })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })
    expect(renderer.root.findByProps({ children: 'distribution-screen' })).toBeTruthy()

    act(() => renderer.unmount())
    expect(useStore.getState().controlConsoleSection).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
  })

  it('没有指定分区时仍默认落水印', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByProps({ children: 'preset-screen' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: 'output-screen' })).toHaveLength(0)
  })

  it('右区标题同时说明「当前维度」与「当前作用域」', () => {
    // 维度切换挪到左树之后，右区必须自己说清现在在哪一项 —— 否则从树上点了作用域，
    // 右区内容属于哪个维度就看不出来了（标题里带维度名前缀就是为了这个）
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(collectText(renderer.root.findByType('h1').props.children)).toBe('水印 · 全局默认')

    clickTreeButton(renderer, '月亮')
    expect(collectText(renderer.root.findByType('h1').props.children)).toBe('水印 · 月亮')
  })

  it('方向作用域下「批量启用」才可用（全局默认下置灰并给出原因）', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    // 全局默认：没有「启用」这个概念（水印由各方向自己声明），按钮置灰且带说明
    const globalButton = findByText(renderer, '批量启用')
    expect(globalButton.props.disabled).toBe(true)
    expect(String(globalButton.props.title)).toContain('方向')

    clickTreeButton(renderer, '月亮')
    // 换成方向后不再置灰（仍未选中卡片时会 disabled，但原因变成「没选卡片」，不再是「必须是方向」）
    expect(findByText(renderer, '批量启用').props.title).toBeUndefined()
  })

  it('作用域读的是**全局上下文指针**：打开即默认选中当前方向', () => {
    // 别的入口（素材库 / SOP）把指针指到某个方向后再进中控台，右区应直接是那个方向
    useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'direction-moon' } })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(collectText(renderer.root.findByType('h1').props.children)).toBe('水印 · 月亮')
  })

  it('在树里选方向会写回全局指针，别的入口能读到同一个值', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    clickTreeButton(renderer, '月亮')
    expect(useAssetLibraryStore.getState().scope).toEqual({ kind: 'collection', id: 'direction-moon' })

    clickTreeButton(renderer, '全局默认')
    expect(useAssetLibraryStore.getState().scope).toBe('all')
  })

  it('切作用域不动素材库的选中态（否则在别的入口选好的素材会被静默清掉）', () => {
    useAssetLibraryStore.setState({ selectedAssetIds: ['asset-1', 'asset-2'] })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    clickTreeButton(renderer, '月亮')
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual(['asset-1', 'asset-2'])
  })
})
