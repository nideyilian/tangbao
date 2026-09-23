// @vitest-environment jsdom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import type { GeneratedAsset, TaskRecord } from '../../types'
import AssetGroupedView from './AssetBatchView'
import { useAssetLibraryStore } from './store'

const storeMocks = vi.hoisted(() => {
  const state = {
    tasks: [],
    settings: { alwaysShowRetryButton: false },
    setConfirmDialog: vi.fn(),
    setDetailTaskId: vi.fn(),
    toggleTaskSelection: vi.fn(),
    openFavoritePicker: vi.fn(),
    showToast: vi.fn(),
  }
  const useStore = Object.assign(
    vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
    { getState: vi.fn(() => state) },
  )
  return {
    useStore,
    setDetailTaskId: state.setDetailTaskId,
    editOutputs: vi.fn(),
    removeMultipleTasks: vi.fn(),
    removeTask: vi.fn(),
    rerunSopBatchTasks: vi.fn(),
    reuseConfig: vi.fn(),
    retryTask: vi.fn(),
    updateTaskPrompt: vi.fn(),
    GRID_THUMBNAIL_VARIANT: 'grid',
    ensureImageCached: vi.fn(async () => null),
    ensureImageThumbnailCached: vi.fn(async () => null),
    getCachedThumbnail: vi.fn(() => null),
    prefetchImageThumbnails: vi.fn(),
    subscribeImageThumbnail: vi.fn(() => () => {}),
  }
})

vi.mock('../../store', () => storeMocks)

vi.mock('../stores/runtimeStore', () => ({
  useRuntimeStore: (selector: (value: { streamPreviews: Record<string, string> }) => unknown) =>
    selector({ streamPreviews: {} }),
}))

vi.mock('../../lib/db', () => ({
  getAllSopBatchSnapshots: vi.fn(async () => []),
}))

const taskA = {
  id: 't1',
  prompt: '夏日沙滩主图',
  params: { n: 1, size: '1024x1024', quality: 'auto', output_format: 'png' },
  apiModel: 'gpt-image-1',
  status: 'done',
  createdAt: 1000,
  finishedAt: 2000,
  elapsed: 1000,
  outputImages: ['a', 'b'],
} as unknown as TaskRecord

const taskB = {
  id: 't2',
  prompt: 'SOP 第一条',
  params: { n: 1, size: '1024x1024', quality: 'auto', output_format: 'png' },
  apiModel: 'gpt-image-1',
  status: 'done',
  createdAt: 900,
  finishedAt: 1900,
  elapsed: 1000,
  outputImages: ['c', 'd'],
  sopBatch: {
    batchId: 'b1',
    sopName: '夏季主图 SOP',
    promptIndex: 0,
    imagesPerPrompt: 1,
    promptCount: 1,
  },
} as unknown as TaskRecord

function makeAsset(id: string, taskId: string, overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({
    id,
    imageId: id,
    createdAt: 1000,
    updatedAt: 1000,
    width: 1024,
    height: 1024,
    origins: [
      {
        key: `${taskId}:0`,
        taskId,
        outputSlot: 0,
        taskCreatedAt: 1000,
        taskFinishedAt: 1000,
        sourceMode: 'generated',
        prompt: `prompt-${id}`,
        requestedParams: {},
        inputImageIds: [],
      },
    ],
    primaryOriginKey: `${taskId}:0`,
    ...overrides,
  })
}

const assets: GeneratedAsset[] = [
  makeAsset('a', 't1'),
  makeAsset('b', 't1'),
  makeAsset('c', 't2'),
  makeAsset('d', 't2'),
  // 任务记录已删除 → 孤儿组
  makeAsset('e', 't9'),
]

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  ;(storeMocks.useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (value: unknown) => unknown) =>
      selector({
        tasks: [taskA, taskB],
        settings: { alwaysShowRetryButton: false },
        setConfirmDialog: vi.fn(),
        setDetailTaskId: storeMocks.setDetailTaskId,
      }),
  )
  useAssetLibraryStore.setState({
    selectedAssetIds: [],
    activeAssetId: null,
    batchFocusTaskId: null,
    dismissedOverviewFailedCount: null,
    groupedViewStyle: 'cards',
    viewMode: 'grid',
  })
})

/** 替换 mock 任务 store 里的任务列表（任务来自主 store，测试里只能通过 mock 换）。 */
function setStoreTasks(tasks: TaskRecord[]) {
  ;(storeMocks.useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (value: unknown) => unknown) =>
      selector({
        tasks,
        settings: { alwaysShowRetryButton: false },
        setConfirmDialog: vi.fn(),
        setDetailTaskId: storeMocks.setDetailTaskId,
      }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/**
 * @param layoutWidth 布局容器的 `clientWidth`。传 0 模拟「还没量到宽度」
 *   （空态 → 非空态切换、ResizeObserver 未建立时就是这个状态，见下方 TB-106 用例）。
 */
function renderGrouped(layoutWidth = 800, scope?: string) {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(AssetGroupedView, { assets, libraryAssetCount: assets.length, onPurgeRequest: vi.fn(), scope }),
      {
        createNodeMock: (element) => {
          const props = element.props as Record<string, unknown>
          if (props['data-testid'] === 'asset-batch-view')
            return { clientHeight: 600, scrollTop: 0, scrollIntoView: vi.fn() }
          if (props['data-testid'] === 'asset-grouped-layout') return { clientWidth: layoutWidth }
          // TaskCard 的 swipe 副作用会写 cardRef.current.style.transform
          return { scrollIntoView: vi.fn(), style: {} }
        },
      },
    )
  })
  return renderer!
}

function collectText(renderer: ReactTestRenderer): string {
  return collectTextOf(renderer.root)
}

/** 拼出任意节点的可见文本（概览条这类局部节点的断言用它，避免被卡片文案串味）。 */
function collectTextOf(root: unknown): string {
  const parts: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') parts.push(node)
    else if (node && typeof node === 'object') {
      const inst = node as { children?: unknown[] }
      ;(inst.children ?? []).forEach(walk)
    }
  }
  walk(root)
  return parts.join('')
}

function cardByGroupId(renderer: ReactTestRenderer, groupId: string) {
  return renderer.root.find((node) => node.props['data-group-id'] === groupId)
}

describe('AssetGroupedView（容器宽度还没量到）', () => {
  it('never renders 1px phantom cards while the layout width is unknown（TB-106）', () => {
    // `layoutWidth === 0` = 还没量到容器宽度：空态 → 非空态切换时测量 effect 可能不重跑、
    // ResizeObserver 也没建起来（`layoutRef`/`scrollRef` 首帧为 null 直接 return）。
    // 旧实现把它算成 `Math.max(1, (0 - 16) / 2)` = **1px**，卡片「在 DOM 里但看不见」——
    // 用户看到的就是「任务卡片全没了」，而且不报错、不留占位。
    const renderer = renderGrouped(0)
    // 必须卸载（放 finally：断言失败也要卸）——本文件后续用例共用 `useAssetLibraryStore`，
    // 留着挂载实例会串味：实测「查看来源任务」那 3 条滚动用例会跟着红（scrollIntoView 0 次 / 高亮丢失），
    // 变成 3 条迷惑性的连带失败。
    try {
      const cards = renderer.root.findAll((node) => node.props['data-testid'] === 'asset-batch-card')
      const phantom = cards.filter((card) => Number((card.props.style as { width?: number }).width ?? 0) <= 1)
      expect(phantom).toHaveLength(0)
    } finally {
      act(() => renderer.unmount())
    }
  })
})

describe('AssetGroupedView（分组视图 · 任务卡片形式）', () => {
  it('renders one task card per group (task / SOP batch) with the overview bar, no orphan cards', () => {
    const renderer = renderGrouped()
    // 2 个组：任务组 + SOP 批次组；「任务已删除」孤儿组不再展示（展示层过滤，数据不动）
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-card' })).toHaveLength(2)
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-overview' })).toHaveLength(1)
    expect(collectText(renderer)).toContain('2 个分组')
    expect(collectText(renderer)).not.toContain('任务已删除')
    act(() => renderer.unmount())
  })

  it('renders the task card with prompt and task action buttons', () => {
    const renderer = renderGrouped()
    expect(collectText(renderer)).toContain('夏日沙滩主图')
    const buttonsByAria = (label: string) =>
      renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label)
    // 旧画廊 TaskCard 的动作按钮（aria-label 来自 TaskActionButton 的 tooltip）
    expect(buttonsByAria('复用配置')).toHaveLength(1)
    expect(buttonsByAria('编辑输出')).toHaveLength(1)
    expect(buttonsByAria('删除任务')).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('renders the SOP batch card with batch info and batch action buttons', () => {
    const renderer = renderGrouped()
    expect(collectText(renderer)).toContain('SOP · 夏季主图 SOP')
    const buttonsByTitle = (label: string) =>
      renderer.root.findAll((node) => node.type === 'button' && node.props.title === label)
    // SopBatchTaskCard 的按钮（IconButton title）
    expect(buttonsByTitle('查看批次')).toHaveLength(1)
    expect(buttonsByTitle('再次生成')).toHaveLength(1)
    expect(buttonsByTitle('删除批次')).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('shows a completed SOP card when its image is already in the asset library but the task state is stale', () => {
    const staleTask = {
      ...taskB,
      outputImages: [],
      status: 'error',
      error: '保存状态同步失败',
    } as TaskRecord
    ;(storeMocks.useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (value: unknown) => unknown) =>
        selector({
          tasks: [taskA, staleTask],
          settings: { alwaysShowRetryButton: false },
          setConfirmDialog: vi.fn(),
          setDetailTaskId: storeMocks.setDetailTaskId,
        }),
    )

    const renderer = renderGrouped()
    const sopCard = cardByGroupId(renderer, 'sop-batch:b1')
    const statusCard = sopCard.find((node) => String(node.props.className).includes('gallery-sop-card'))
    expect(statusCard.props['data-status']).toBe('done')
    expect(collectText(renderer)).toContain('已完成')
    expect(collectText(renderer)).toContain('图片 2/2')
    act(() => renderer.unmount())
  })

  it('does not render orphan cards for deleted tasks (禁止「任务已删除」状态)', () => {
    const renderer = renderGrouped()
    // 任务记录已删除的素材（asset e / origin t9）不再以「任务已删除」卡展示；
    // 素材数据本身不动，仍可从「图片」视图/回收站访问
    expect(renderer.root.findAllByProps({ 'data-group-id': 'orphan:t9' })).toHaveLength(0)
    expect(renderer.root.findAll((node) => node.type === 'button' && node.props.title === '打开查看器')).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('回收站作用域放行孤儿组：删掉任务卡后的图能在回收站里找到（TB-119）', () => {
    // 删任务卡现在把它的产出图移入回收站（来源任务随之消失）⇒ 那些图只会归进孤儿组。
    // 回收站里若也一并滤掉孤儿组，用户按「删任务卡 → 去回收站捞图」走就会看到空回收站
    // （只有切回图片模式才看得见），与「回收站中可见、可操作」的原意相反。
    const renderer = renderGrouped(800, 'trash')
    try {
      expect(renderer.root.findAllByProps({ 'data-group-id': 'orphan:t9' }).length).toBeGreaterThan(0)
      expect(collectText(renderer)).toContain('任务已删除')
      // 孤儿卡不给「删除/复用配置」这类入口（任务没了，入口点了也没用）
      expect(renderer.root.findAll((node) => node.props.title === '删除任务')).toHaveLength(0)
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('opens the task detail modal on a plain click (published version interaction)', () => {
    const renderer = renderGrouped()
    const taskCard = cardByGroupId(renderer, 'task:t1')
    // TaskCard 内部 Card 根节点持有 onClick
    const clickable = taskCard.findAll((node) => typeof node.props.onClick === 'function')[0]!
    act(() => {
      clickable.props.onClick({ ctrlKey: false, metaKey: false })
    })
    // 发布版行为：单击任务卡打开任务详情弹窗（展示该任务全部生成图片）
    expect(storeMocks.setDetailTaskId).toHaveBeenCalledWith('t1')
    // 单击不改变选择（选择走 Ctrl/⌘ 或框选）
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual([])
    act(() => renderer.unmount())
  })

  // 网格因「目录查询回写」拿到内容相同但引用全新的素材列表时，不能把用户已打开的右键菜单
  // 顺手关掉——历史上这个无条件 setMenu(null) 让菜单闪一下就消失（素材库必现）。
  it('keeps the open context menu when the grid refreshes with equivalent assets', () => {
    const renderer = renderGrouped()
    const card = renderer.root.findAll((node) => node.props['data-testid'] === 'asset-batch-card')[0]!
    act(() => {
      card.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 12,
        clientY: 12,
        target: null,
      })
    })
    const menuCount = () => renderer.root.findAll((node) => node.props['data-testid'] === 'asset-card-menu').length
    expect(menuCount()).toBe(1)

    act(() => {
      renderer.update(
        createElement(AssetGroupedView, {
          assets: assets.map((asset) => ({ ...asset })),
          libraryAssetCount: assets.length,
          onPurgeRequest: vi.fn(),
        }),
      )
    })
    expect(menuCount()).toBe(1)
    act(() => renderer.unmount())
  })

  // 目标素材已从结果集中消失（删除 / 移动 / 切文件夹）时，菜单必须关闭，避免操作到已失效的素材。
  it('closes the context menu once the target asset is gone from the result set', () => {
    const renderer = renderGrouped()
    const card = renderer.root.findAll((node) => node.props['data-testid'] === 'asset-batch-card')[0]!
    act(() => {
      card.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 12,
        clientY: 12,
        target: null,
      })
    })
    const menuCount = () => renderer.root.findAll((node) => node.props['data-testid'] === 'asset-card-menu').length
    expect(menuCount()).toBe(1)

    act(() => {
      const remaining = assets.filter((asset) => asset.id !== 'a' && asset.id !== 'b')
      renderer.update(
        createElement(AssetGroupedView, {
          assets: remaining,
          libraryAssetCount: remaining.length,
          onPurgeRequest: vi.fn(),
        }),
      )
    })
    expect(menuCount()).toBe(0)
    act(() => renderer.unmount())
  })

  it('toggles the group selection with Ctrl/⌘ click', () => {
    useAssetLibraryStore.setState({ selectedAssetIds: ['a', 'b'] })
    const renderer = renderGrouped()
    const sopCard = cardByGroupId(renderer, 'sop-batch:b1')
    const clickable = sopCard.findAll((node) => typeof node.props.onClick === 'function')[0]!
    act(() => {
      clickable.props.onClick({ ctrlKey: true, metaKey: false })
    })
    const ids = [...useAssetLibraryStore.getState().selectedAssetIds].sort()
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
    act(() => renderer.unmount())
  })

  it('opens the SOP batch detail modal on a plain card click', () => {
    const renderer = renderGrouped()
    const sopCard = cardByGroupId(renderer, 'sop-batch:b1')
    const clickable = sopCard.findAll((node) => typeof node.props.onClick === 'function')[0]!
    act(() => {
      clickable.props.onClick({ ctrlKey: false, metaKey: false })
    })
    // SopBatchDetailModal 打开（批次详情弹窗展示全部提示词与生成图片）
    expect(renderer.root.findAllByProps({ 'aria-labelledby': 'sop-batch-detail-title' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('keeps the SOP batch detail modal open while new images are added to the batch', () => {
    const renderer = renderGrouped()
    const sopCard = cardByGroupId(renderer, 'sop-batch:b1')
    const clickable = sopCard.findAll((node) => typeof node.props.onClick === 'function')[0]!
    act(() => {
      clickable.props.onClick({ ctrlKey: false, metaKey: false })
    })
    expect(renderer.root.findAllByProps({ 'aria-labelledby': 'sop-batch-detail-title' })).toHaveLength(1)

    // 回归：生图过程中该批次新增一张素材后，弹窗不应被自动关闭
    const nextAssets = [...assets, makeAsset('f', 't2')]
    act(() => {
      renderer.update(
        createElement(AssetGroupedView, {
          assets: nextAssets,
          libraryAssetCount: nextAssets.length,
          onPurgeRequest: vi.fn(),
        }),
      )
    })
    expect(renderer.root.findAllByProps({ 'aria-labelledby': 'sop-batch-detail-title' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('shows an empty state when there are no assets', () => {
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(AssetGroupedView, { assets: [], libraryAssetCount: 0 }), {
        createNodeMock: () => ({}),
      })
    })
    expect(renderer!.root.findAllByProps({ 'data-testid': 'asset-batch-empty' })).toHaveLength(1)
    act(() => renderer!.unmount())
  })

  it('scrolls to and highlights the group of the focused task, then clears', () => {
    const scrollIntoViewMock = vi.fn()
    const createNode = (element: { props?: unknown }) => {
      const props = (element.props ?? {}) as Record<string, unknown>
      if (props['data-testid'] === 'asset-batch-view')
        return { clientHeight: 600, scrollTop: 0, scrollIntoView: scrollIntoViewMock }
      return { clientWidth: 800, scrollIntoView: scrollIntoViewMock, style: {} }
    }
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(AssetGroupedView, { assets, libraryAssetCount: assets.length }), {
        createNodeMock: createNode,
      })
    })
    useAssetLibraryStore.getState().setBatchFocusTaskId('t2')
    act(() => {
      renderer!.update(createElement(AssetGroupedView, { assets, libraryAssetCount: assets.length }))
    })
    const highlighted = renderer!.root.findAllByProps({ 'data-group-id': 'sop-batch:b1' })
    expect(highlighted.length).toBeGreaterThan(0)
    // 高亮环（ring）落在目标组卡片上。
    // ⚠️ 判据必须是 `ring-inset` 而不是 `ring-2`：卡片基础类里本来就有
    // `focus-visible:ring-2`，用 `ring-2` 断言恒真、什么都测不到（只有高亮态才加 `ring-inset`）。
    expect(highlighted[0]!.props.className).toContain('ring-inset')
    expect(scrollIntoViewMock).toHaveBeenCalled()
    useAssetLibraryStore.getState().setBatchFocusTaskId(null)
    act(() => renderer!.unmount())
  })

  // ===== TB-103：「突发跳转」+ 速览失败数关不掉 =====

  it('查看来源任务只滚一次：生成中素材持续新增时不再把视口拉回那张卡', () => {
    const scrollIntoViewMock = vi.fn()
    const createNode = (element: { props?: unknown }) => {
      const props = (element.props ?? {}) as Record<string, unknown>
      if (props['data-testid'] === 'asset-batch-view')
        return { clientHeight: 600, scrollTop: 0, scrollIntoView: scrollIntoViewMock }
      return { clientWidth: 800, scrollIntoView: scrollIntoViewMock, style: {} }
    }
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(AssetGroupedView, { assets, libraryAssetCount: assets.length }), {
        createNodeMock: createNode,
      })
    })
    act(() => {
      useAssetLibraryStore.getState().setBatchFocusTaskId('t2')
    })
    const afterFocus = scrollIntoViewMock.mock.calls.length
    expect(afterFocus).toBeGreaterThan(0)

    // 生成中：每张新图入库都是一次 assets 变化 ⇒ groups 引用必然更新。
    // 原实现把 groups 当无条件重跑信号，这里会被反复拉动（用户手动滚走又被拽回来）。
    let running = assets
    for (let index = 0; index < 3; index += 1) {
      running = [...running, makeAsset(`stream-${index}`, 't2')]
      act(() => {
        renderer!.update(createElement(AssetGroupedView, { assets: running, libraryAssetCount: running.length }))
      })
    }
    // 先证明这 3 次 update 真的重渲染了 —— 否则「没再滚」是假绿：
    // AssetGroupedView 是 memo，props 全等会 bailout，那就等于什么都没测。
    // 每次传的都是新 assets 引用，概览素材数必须从 4 一路涨到 7。
    const overview = () => collectTextOf(renderer!.root.findAllByProps({ 'data-testid': 'asset-batch-overview' })[0])
    expect(overview()).toContain('7 张素材')
    expect(scrollIntoViewMock.mock.calls.length).toBe(afterFocus)
    act(() => renderer!.unmount())
  })

  it('查看来源任务的高亮 3 秒后自行清除，素材变化不会把计时重置', () => {
    // 只冻 setTimeout / clearTimeout —— 用默认的 useFakeTimers() 会连 requestAnimationFrame
    // 一起替换掉，和 beforeEach 里 stub 的 rAF 打架、React 的 effect 刷不出来（实测：高亮压根没上）。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const createNode = (element: { props?: unknown }) => {
        const props = (element.props ?? {}) as Record<string, unknown>
        if (props['data-testid'] === 'asset-batch-view')
          return { clientHeight: 600, scrollTop: 0, scrollIntoView: vi.fn() }
        return { clientWidth: 800, scrollIntoView: vi.fn(), style: {} }
      }
      let renderer: ReactTestRenderer
      act(() => {
        renderer = create(createElement(AssetGroupedView, { assets, libraryAssetCount: assets.length }), {
          createNodeMock: createNode,
        })
      })
      act(() => {
        useAssetLibraryStore.getState().setBatchFocusTaskId('t2')
      })
      const ringClass = () =>
        renderer!.root.findAllByProps({ 'data-group-id': 'sop-batch:b1' })[0]!.props.className as string
      expect(ringClass()).toContain('ring-inset')

      // t=1s：素材变化一次 —— 原实现会在这里 clearTimeout 并重新计 3 秒
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      const next = [...assets, makeAsset('stream-x', 't2')]
      act(() => {
        renderer!.update(createElement(AssetGroupedView, { assets: next, libraryAssetCount: next.length }))
      })
      // 证明这次 update 真的重渲染了（否则「计时没被重置」是假绿：memo 在 props 全等时
      // 直接 bailout，effect 压根不会重跑）。素材数 4 → 5 就是重渲染发生的证据。
      expect(collectTextOf(renderer!.root.findAllByProps({ 'data-testid': 'asset-batch-overview' })[0])).toContain(
        '5 张素材',
      )

      // t=3s（距聚焦满 3 秒）→ 高亮必须已清除
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(ringClass()).not.toContain('ring-inset')
      act(() => renderer!.unmount())
    } finally {
      vi.useRealTimers()
    }
  })

  it('速览的「失败 N」可以关掉，且只有失败数继续上涨才重新出现', () => {
    const failedTask = {
      id: 't3',
      prompt: '失败的任务',
      params: { n: 1, size: '1024x1024', quality: 'auto', output_format: 'png' },
      apiModel: 'gpt-image-1',
      status: 'error',
      createdAt: 1100,
      outputImages: [],
    } as unknown as TaskRecord
    const anotherFailedTask = { ...failedTask, id: 't4', prompt: '又失败的任务', createdAt: 1200 }
    setStoreTasks([taskA, taskB, failedTask])

    const renderer = renderGrouped()
    const overviewText = () => collectTextOf(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-overview' })[0])
    const closeButton = () =>
      renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === '关闭失败提示')

    expect(overviewText()).toContain('失败 1')
    expect(closeButton()).toHaveLength(1)

    act(() => closeButton()[0]!.props.onClick())
    expect(overviewText()).not.toContain('失败')
    expect(closeButton()).toHaveLength(0)

    // 素材再变（生成中）不该让它复活：失败数没涨
    const nextAssets = [...assets, makeAsset('stream-y', 't1')]
    act(() => {
      renderer.update(createElement(AssetGroupedView, { assets: nextAssets, libraryAssetCount: nextAssets.length }))
    })
    expect(overviewText()).not.toContain('失败')

    // 失败数上涨（1 → 2）→ 重新出现。
    // ⚠️ 必须同时换一个 assets 引用：AssetGroupedView 是 `memo`，props 全等会直接 bailout，
    //    tasks 再怎么变这一次也读不到（实测踩过：overview 仍是旧值）。
    setStoreTasks([taskA, taskB, failedTask, anotherFailedTask])
    const grownAssets = [...nextAssets, makeAsset('stream-z', 't1')]
    act(() => {
      renderer.update(createElement(AssetGroupedView, { assets: grownAssets, libraryAssetCount: grownAssets.length }))
    })
    expect(overviewText()).toContain('失败 2')
    act(() => renderer.unmount())
  })
})

describe('AssetGroupedView（分组视图 · 图片砖/列表行形式）', () => {
  it('renders one block per group with headers and the same asset tiles as image mode', () => {
    useAssetLibraryStore.setState({ groupedViewStyle: 'tiles' })
    const renderer = renderGrouped()
    // 2 个组：任务组 + SOP 批次组（孤儿组不展示）
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-group' })).toHaveLength(2)
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-group-header' })).toHaveLength(2)
    // 图片砖与图片模式同一组件（data-testid=asset-card）；孤儿素材 e 不在此视图展示
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-card' })).toHaveLength(4)
    // 速览条
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-overview' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('keeps the task card function buttons on the group header, one-click', () => {
    useAssetLibraryStore.setState({ groupedViewStyle: 'tiles' })
    const renderer = renderGrouped()
    // 任务组与 SOP 批次组都保留复用配置 / 编辑输出
    expect(renderer.root.findAllByProps({ title: '复用配置' })).toHaveLength(2)
    expect(renderer.root.findAllByProps({ title: '编辑输出' })).toHaveLength(2)
    // 再次生成仅 SOP 批次组
    expect(renderer.root.findAllByProps({ title: '再次生成' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ title: '删除批次' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ title: '删除任务' })).toHaveLength(1)
    // 孤儿组不展示 → 不再出现「任务已删除」标注
    expect(renderer.root.findAllByProps({ children: '任务已删除' }).length).toBe(0)
    act(() => renderer.unmount())
  })

  it('restores the task card parameter summary on the header (task + SOP groups, not orphan)', () => {
    useAssetLibraryStore.setState({ groupedViewStyle: 'tiles' })
    const renderer = renderGrouped()
    try {
      // 参数摘要行：任务组与 SOP 批次组各一行（TaskParamSummary + 图片进度/耗时）
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-group-params' })).toHaveLength(2)
      // TaskParamSummary 的参数标签（aria-label="任务参数"）
      expect(renderer.root.findAllByProps({ 'aria-label': '任务参数' })).toHaveLength(2)
      const text = collectText(renderer)
      expect(text).toContain('图片 2/2')
      expect(text).toContain('耗时')
      expect(text).toContain('整批 1 条提示词')
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('renders tiles at the image aspect ratio instead of fixed squares', () => {
    useAssetLibraryStore.setState({ groupedViewStyle: 'tiles' })
    const portrait = makeAsset('p1', 't1', { width: 1024, height: 2048 })
    const landscape = makeAsset('p2', 't1', { width: 2048, height: 1024 })
    const square = makeAsset('p3', 't1', { width: 1024, height: 1024 })
    const ratioAssets = [portrait, landscape, square]
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(AssetGroupedView, { assets: ratioAssets, libraryAssetCount: ratioAssets.length }),
        {
          createNodeMock: (element) => {
            const props = element.props as Record<string, unknown>
            if (props['data-testid'] === 'asset-batch-view')
              return { clientHeight: 600, scrollTop: 0, scrollIntoView: vi.fn() }
            if (props['data-testid'] === 'asset-grouped-layout') return { clientWidth: 800 }
            return { scrollIntoView: vi.fn(), style: {} }
          },
        },
      )
    })
    const tileHeight = (id: string): number => {
      const tile = renderer!.root.findAllByProps({ 'data-asset-id': id })
      expect(tile.length).toBe(1)
      const style = tile[0]!.props.style as { width: number; height: number }
      return style.height / style.width
    }
    // 竖图 ≈ 2 倍宽、横图 ≈ 0.5 倍宽、方图 ≈ 1 倍宽（钳制 0.5–2）
    expect(tileHeight('p1')).toBeGreaterThan(1.9)
    expect(tileHeight('p2')).toBeLessThan(0.6)
    expect(tileHeight('p3')).toBeGreaterThan(0.9)
    expect(tileHeight('p3')).toBeLessThan(1.1)
    act(() => renderer!.unmount())
  })

  it('switches to list arrangement with the same list rows as list view', () => {
    useAssetLibraryStore.setState({ groupedViewStyle: 'tiles', viewMode: 'list' })
    const renderer = renderGrouped()
    expect(renderer.root.findAllByProps({ 'data-testid': 'asset-group-list' })).toHaveLength(2)
    // 孤儿素材 e 不在分组视图展示，其余 4 张素材成行
    expect(renderer.root.findAllByProps({ role: 'row' })).toHaveLength(4)
    act(() => renderer.unmount())
  })
})

describe('AssetGroupedView（项目文件夹作用域 · 「包含子文件夹」开关一致性）', () => {
  const parentCollection = {
    id: 'col-parent',
    name: '父文件夹',
    normalizedName: '父文件夹',
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    trashedAt: null,
  }
  const childCollection = {
    id: 'col-child',
    name: '子文件夹',
    normalizedName: '子文件夹',
    parentId: 'col-parent',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    trashedAt: null,
  }

  const runningInChild = {
    id: 't-running-child',
    prompt: '子文件夹生成中的任务',
    params: { n: 1, size: '1024x1024', quality: 'auto', output_format: 'png' },
    apiModel: 'gpt-image-1',
    status: 'running',
    createdAt: 500,
    finishedAt: null,
    elapsed: null,
    outputImages: [],
    defaultCollectionId: 'col-child',
  } as unknown as TaskRecord

  const runningInParent = {
    id: 't-running-parent',
    prompt: '父文件夹直接生成中的任务',
    params: { n: 1, size: '1024x1024', quality: 'auto', output_format: 'png' },
    apiModel: 'gpt-image-1',
    status: 'running',
    createdAt: 600,
    finishedAt: null,
    elapsed: null,
    outputImages: [],
    defaultCollectionId: 'col-parent',
  } as unknown as TaskRecord

  const failedInChild = {
    id: 't-failed-child',
    prompt: '子文件夹失败的任务',
    params: { n: 1, size: '1024x1024', quality: 'auto', output_format: 'png' },
    apiModel: 'gpt-image-1',
    status: 'error',
    error: '服务商超时',
    createdAt: 700,
    finishedAt: null,
    elapsed: null,
    outputImages: [],
    defaultCollectionId: 'col-child',
  } as unknown as TaskRecord

  const partialFailedInChild = {
    id: 't-partial-child',
    prompt: '子文件夹部分失败的任务',
    params: { n: 2, size: '1024x1024', quality: 'auto', output_format: 'png' },
    apiModel: 'gpt-image-1',
    status: 'done',
    createdAt: 800,
    finishedAt: 900,
    elapsed: 100,
    outputImages: ['ok'],
    batchItemStatuses: ['done', 'error'],
    batchItemErrors: [{ index: 1, error: '第二张失败' }],
    defaultCollectionId: 'col-child',
  } as unknown as TaskRecord

  const failedInParent = {
    id: 't-failed-parent',
    prompt: '父文件夹失败的任务',
    params: { n: 1, size: '1024x1024', quality: 'auto', output_format: 'png' },
    apiModel: 'gpt-image-1',
    status: 'error',
    error: '服务商超时',
    createdAt: 750,
    finishedAt: null,
    elapsed: null,
    outputImages: [],
    defaultCollectionId: 'col-parent',
  } as unknown as TaskRecord

  function renderInParentFolder(
    tasks: TaskRecord[],
    includeSubcollections: boolean,
    assetsOverride?: GeneratedAsset[],
  ) {
    ;(storeMocks.useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (value: unknown) => unknown) =>
        selector({
          tasks,
          settings: { alwaysShowRetryButton: false },
          setConfirmDialog: vi.fn(),
          setDetailTaskId: storeMocks.setDetailTaskId,
        }),
    )
    useAssetLibraryStore.setState({ collections: [parentCollection, childCollection] })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(AssetGroupedView, {
          // 父文件夹内至少有一张已归档素材 → 视图非空，无素材任务卡由 includeTaskless 补入
          assets: assetsOverride ?? [makeAsset('x', 't1')],
          libraryAssetCount: (assetsOverride ?? [makeAsset('x', 't1')]).length,
          onPurgeRequest: vi.fn(),
          scope: 'collection:col-parent',
          includeSubcollections,
        }),
        {
          createNodeMock: (element) => {
            const props = element.props as Record<string, unknown>
            if (props['data-testid'] === 'asset-batch-view')
              return { clientHeight: 600, scrollTop: 0, scrollIntoView: vi.fn() }
            if (props['data-testid'] === 'asset-grouped-layout') return { clientWidth: 800 }
            return { scrollIntoView: vi.fn(), style: {} }
          },
        },
      )
    })
    return renderer!
  }

  it('默认（不勾「包含子文件夹」）时，子文件夹提交的无素材任务卡不出现在父文件夹', () => {
    const renderer = renderInParentFolder([taskA, runningInChild], false)
    try {
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-card' })).toHaveLength(1)
      expect(collectText(renderer)).toContain('夏日沙滩主图')
      expect(collectText(renderer)).not.toContain('子文件夹生成中的任务')
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('开启「包含子文件夹」后，子树内提交的无素材任务卡出现在父文件夹（与图片模式口径一致）', () => {
    const renderer = renderInParentFolder([taskA, runningInChild], true)
    try {
      expect(collectText(renderer)).toContain('子文件夹生成中的任务')
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-card' })).toHaveLength(2)
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('不勾「包含子文件夹」时，直接在该文件夹提交的无素材任务卡仍然可见', () => {
    const renderer = renderInParentFolder([taskA, runningInParent], false)
    try {
      expect(collectText(renderer)).toContain('父文件夹直接生成中的任务')
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-card' })).toHaveLength(2)
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('失败/部分失败任务卡也不跨文件夹出现（兄弟/子文件夹失败任务不出现在当前文件夹）', () => {
    const renderer = renderInParentFolder([taskA, failedInChild, partialFailedInChild], false)
    try {
      expect(collectText(renderer)).not.toContain('子文件夹失败的任务')
      expect(collectText(renderer)).not.toContain('子文件夹部分失败的任务')
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-card' })).toHaveLength(1)
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('失败任务卡仍显示在所属文件夹内（不因收紧而消失）', () => {
    const renderer = renderInParentFolder([taskA, failedInParent], false)
    try {
      expect(collectText(renderer)).toContain('父文件夹失败的任务')
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-card' })).toHaveLength(2)
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('素材为空时仍渲染失败任务卡而不是空状态（提示条点击进来的可见性）', () => {
    const renderer = renderInParentFolder([failedInParent], false, [])
    try {
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-empty' })).toHaveLength(0)
      expect(collectText(renderer)).toContain('父文件夹失败的任务')
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-card' })).toHaveLength(1)
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('无素材且无补入任务组时仍显示空状态', () => {
    const renderer = renderInParentFolder([taskA], false, [])
    try {
      expect(renderer.root.findAllByProps({ 'data-testid': 'asset-batch-empty' })).toHaveLength(1)
    } finally {
      act(() => renderer.unmount())
    }
  })
})
