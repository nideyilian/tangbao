/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mainStore = vi.hoisted(() => ({
  appMode: 'gallery',
}))

const assetStore = vi.hoisted(() => ({
  activeAssetId: 'asset-1',
  assetsById: { 'asset-1': { id: 'asset-1', width: 1672, height: 941 } },
  assetOrder: ['asset-1'],
  collections: [],
  scope: 'all',
  query: '',
  filters: {},
  sortKey: 'updatedAt',
  sortOrder: 'desc',
  detailOpen: true,
  setDetailOpen: vi.fn(),
  setActiveAsset: vi.fn(),
}))

vi.mock('../store', () => {
  const useStore = Object.assign((selector: (state: typeof mainStore) => unknown) => selector(mainStore), {
    getState: () => mainStore,
    subscribe: () => () => {},
  })
  return { useStore }
})

vi.mock('../features/assetLibrary/store', () => ({
  useAssetLibraryStore: Object.assign((selector: (state: typeof assetStore) => unknown) => selector(assetStore), {
    getState: () => assetStore,
  }),
  getVisibleAssets: ({
    assetsById,
    assetOrder,
  }: {
    assetsById: Record<string, { id: string }>
    assetOrder: string[]
  }) => assetOrder.map((id) => assetsById[id]).filter(Boolean),
}))

vi.mock('../features/assetLibrary/AssetDetailPanel', () => ({
  default: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="embedded-asset-detail" data-embedded={embedded || undefined} />
  ),
}))

vi.mock('../features/assetLibrary/query', () => ({
  queryAssets: () => ({
    assets: [],
    totalCount: 0,
    counts: {
      all: 0,
      recent: 0,
      favorites: 0,
      unorganized: 0,
      trash: 0,
      byCollection: new Map(),
    },
  }),
}))

vi.mock('../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))

import WordLibrarySidebar from './WordLibrarySidebar'

describe('WordLibrarySidebar（词条库下线后：只承载素材详情）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    assetStore.detailOpen = true
  })

  it('以右侧全高面板承载素材详情，并可通过按钮关闭', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<WordLibrarySidebar />)
    })

    const panel = renderer.root.findByProps({ 'data-docked': 'right' })
    expect(panel.props.style.height).toBe('calc(100vh - var(--app-header-offset))')
    expect(renderer.root.findByProps({ 'data-testid': 'embedded-asset-detail' }).props['data-embedded']).toBe(true)

    // 词条库已下线：原先的「详情 / 词条」双 Tab 不应再存在
    expect(renderer.root.findAll((node) => node.props.role === 'tab')).toHaveLength(0)

    act(() => renderer.root.findByProps({ 'aria-label': '关闭素材详情' }).props.onClick())
    expect(assetStore.setDetailOpen).toHaveBeenCalledWith(false)
  })

  it('没有可展示的素材详情时不渲染面板', () => {
    assetStore.detailOpen = false
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<WordLibrarySidebar />)
    })
    expect(renderer.toJSON()).toBeNull()
  })
})
