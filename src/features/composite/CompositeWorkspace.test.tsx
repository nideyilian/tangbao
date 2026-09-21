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
 * 形态是**左树 + 右 tab**：
 * - 左栏项目树（`ConsoleAssetTree`）管「改谁」，增删改查都在树上；
 * - 右区 = 作用域标题 + 一排 tab（管「改什么」）+ 内容。
 *
 * 分区内容各自 mock 成占位文本：这里锁的是**分区注册表 → tab → 渲染分支**的对应关系，
 * 以及「树 → 作用域 → 右区标题」这条链 —— 不是各分区内部的业务逻辑。
 */
vi.mock('./components/MediaSection', () => ({
  MediaSection: () => <div>media-screen</div>,
}))
vi.mock('./components/OutputSection', () => ({
  OutputSection: () => <div>output-screen</div>,
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
 * 切到某个分区：**点右区那排 tab**（2026-09-21 改版后「改什么」只在 tab 上，
 * 维度不再进树 —— 这条 helper 的改法本身就是那次改版的断言）。
 */
function switchSection(renderer: ReturnType<typeof create>, sectionId: string) {
  const label = CONTROL_CONSOLE_SECTIONS.find((item) => item.id === sectionId)?.label
  if (!label) throw new Error(`未知分区：${sectionId}`)
  const tab = renderer.root.find(
    (node) => node.type === 'button' && node.props.role === 'tab' && collectText(node.props.children).includes(label),
  )
  act(() => {
    ;(tab.props.onClick as () => void)()
  })
}

/** 点左树里的某个节点：按可见文本找按钮 */
function clickTreeButton(renderer: ReturnType<typeof create>, text: string) {
  const button = renderer.root.find((node) => node.type === 'button' && collectText(node.props.children).includes(text))
  act(() => {
    ;(button.props.onClick as () => void)()
  })
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

    expect(renderer.root.findByProps({ children: 'editor-screen' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: 'media-screen' })).toHaveLength(0)
  })

  it('labels the console as 中控台 and exposes the scope tree', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByType('main').props['aria-label']).toBe('中控台工作区')
    // 左栏项目树是整个框架的管理入口，必须有稳定可访问名
    expect(renderer.root.findByProps({ 'aria-label': '项目树' })).toBeTruthy()
  })

  it('switches to each registered section and renders exactly one at a time', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    // 「分发」2026-09-21 起不是分区了：它作为小节并进「输出位置」，所以这里没有它的占位
    const expectations: Record<string, string> = {
      watermark: 'editor-screen',
      media: 'media-screen',
      output: 'output-screen',
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
    useStore.setState({ controlConsoleSection: 'media' })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })
    expect(renderer.root.findByProps({ children: 'media-screen' })).toBeTruthy()

    act(() => renderer.unmount())
    expect(useStore.getState().controlConsoleSection).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
  })

  it('没有指定分区时仍默认落水印', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByProps({ children: 'editor-screen' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: 'output-screen' })).toHaveLength(0)
  })

  it('右区标题跟着左树走：树选到哪一层，标题就是哪一层', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(collectText(renderer.root.findByType('h1').props.children)).toBe('全局默认')

    clickTreeButton(renderer, '月亮')
    expect(collectText(renderer.root.findByType('h1').props.children)).toBe('月亮')
  })

  it('⭐ 不再有分区级的「全局设置」提示条（2026-09-21 起两个分区都是混合的）', () => {
    // 曾经按 `ControlConsoleSection.globalOnly` 在分区顶上挂一句「全局设置，所有方向共用」。
    // 现在「渠道与尺寸」是「规格全局 + 参与产出方向级（ADR-0013）」、
    // 「输出位置」是「渠道目录跟作用域 + 命名 / 分发 / 产出预览全局」——
    // 一句**分区级**的话说不清哪一半是全局，只会连不该覆盖的那一半一起误导。
    // 字段与提示条一起删了，这条用例钉的就是「别再挂回来」。
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    for (const section of ['media', 'output', 'watermark'] as const) {
      switchSection(renderer, section)
      expect(
        renderer.root.findAllByProps({ children: '全局设置，所有方向共用 —— 这一块不按方向分。' }),
        `分区 ${section} 不该再挂分区级的全局提示`,
      ).toHaveLength(0)
    }
  })

  it('⭐ 水印分区打开就是编辑器，没有「卡片 → 点编辑」的中转', () => {
    // 2026-09-21 改版：卡片网格、卡片工具栏、「返回卡片」按钮整体退役，
    // 水印分区渲染的就是编辑器本身（原路径是 卡片 → 编辑 → 编辑器）。
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(renderer.root.findByProps({ children: 'editor-screen' })).toBeTruthy()
  })

  it('⭐ 水印分区不吃滚动容器：高度交给编辑器自己撑满（否则窗口高了下方留白）', () => {
    // 编辑器（画布 + 图层面板）要靠 flex 长满剩余高度。套一层 overflow-y-auto 之后
    // 它会被「内容高度」顶住，窗口再高也不会长，下面就是一片空白 —— 这次修的就是这条。
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    /** 分区内容槽：中控台右区里那一格「填满剩余高度 + 内边距」的容器 */
    const isSectionSlot = (className: unknown) =>
      typeof className === 'string' && className.includes('flex-1') && className.includes('px-4 py-3')

    const editorSlot = renderer.root.findAll((node) => isSectionSlot(node.props.className))
    expect(editorSlot).toHaveLength(1)
    expect(editorSlot[0]!.props.className).not.toContain('overflow-y-auto')

    // 对照：表格型分区那一格仍要能滚（水印是特例，不能把别的分区也带成不可滚）
    switchSection(renderer, 'media')
    const scrollSlot = renderer.root.findAll((node) => isSectionSlot(node.props.className))
    expect(scrollSlot).toHaveLength(1)
    expect(scrollSlot[0]!.props.className).toContain('overflow-y-auto')
  })

  it('作用域读的是**全局上下文指针**：打开即默认选中当前方向', () => {
    // 别的入口（素材库 / SOP）把指针指到某个方向后再进中控台，右区应直接是那个方向
    useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'direction-moon' } })

    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<CompositeWorkspace />)
    })

    expect(collectText(renderer.root.findByType('h1').props.children)).toBe('月亮')
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
