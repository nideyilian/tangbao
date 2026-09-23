import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import AssetLibraryToolbar from './AssetLibraryToolbar'
import { useAssetLibraryStore } from './store'
import { useRuntimeStore } from '../../stores/runtimeStore'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'

function findToggle(root: ReactTestInstance, index: number) {
  // 排除筛选控件条「+」按钮（它也是 aria-expanded 切换按钮，但属于控件条而非筛选/排序弹层）
  return root.findAll((node) => node.props['aria-expanded'] === false && node.props['aria-label'] !== '添加筛选项')[
    index
  ]
}

afterEach(() => {
  useAssetLibraryStore.setState({
    groupBy: 'grouped',
    viewMode: 'grid',
    gridDensity: 'standard',
    selectedAssetIds: [],
  })
  // 方向级并发闸与后处理范围都是全局内存态：留着会串到别的用例（按钮 loading 会莫名为真）
  useRuntimeStore.setState({ postprocessRunningDirections: [], postprocessRuns: {}, postprocessRunIds: [] })
  usePostprocessMediaStore.setState({ savedTargetCollectionIds: [] })
})

describe('AssetLibraryToolbar', () => {
  it('shows the selected asset count in the toolbar', () => {
    useAssetLibraryStore.setState({ selectedAssetIds: ['asset-a', 'asset-b'] })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="全部" totalCount={7} />)
    })

    expect(renderer!.root.findByProps({ 'data-testid': 'asset-selection-count' }).children.join('')).toBe('已选择 2 张')
  })

  it('keeps filter and sort popovers out of the toolbar layout flow', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="未整理" totalCount={7} />)
    })

    const root = renderer!.root
    act(() => findToggle(root, 0).props.onClick())
    expect(root.findByProps({ 'aria-label': '素材筛选' }).props.className).toContain('!absolute')

    act(() => findToggle(root, 0).props.onClick())
    expect(root.findByProps({ 'aria-label': '素材排序' }).props.className).toContain('!absolute')
  })

  it('switches 图片 / 任务卡片 via segmented buttons without a menu (0.7.56 scheme, no 分组 entry)', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="全部" totalCount={3} />)
    })

    const root = renderer!.root
    const viewGroup = root.findByProps({ 'aria-label': '视图方式' })
    const radios = viewGroup.findAll((node) => node.props.role === 'radio')
    expect(radios).toHaveLength(2)
    // 默认「任务卡片」（store 默认 groupBy: grouped）
    expect(radios[1].props['aria-checked']).toBe(true)

    // 点击「图片」直接切换，无需展开菜单
    act(() => radios[0].props.onClick())
    expect(useAssetLibraryStore.getState().groupBy).toBe('none')
    expect(viewGroup.findAll((node) => node.props.role === 'radio')[0].props['aria-checked']).toBe(true)

    // 再点回「任务卡片」
    act(() => viewGroup.findAll((node) => node.props.role === 'radio')[1].props.onClick())
    expect(useAssetLibraryStore.getState().groupBy).toBe('grouped')
  })

  it('adjusts display size via a shared slider and keeps 列表 as a separate button', () => {
    useAssetLibraryStore.setState({ groupBy: 'none' })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="全部" totalCount={3} />)
    })

    const root = renderer!.root
    const slider = root.findAll((node) => node.type === 'input' && node.props['aria-label'] === '显示大小')[0]!
    expect(slider.props.type).toBe('range')
    // 默认「标准」（DENSITY_ORDER 下标 1）
    expect(slider.props.value).toBe(1)

    // 拖到「大图」：密度切换并回到网格
    act(() => slider.props.onChange({ target: { value: '2' } }))
    expect(useAssetLibraryStore.getState().gridDensity).toBe('cozy')
    expect(useAssetLibraryStore.getState().viewMode).toBe('grid')

    // 拖到「紧凑」
    act(() =>
      root
        .findAll((node) => node.type === 'input' && node.props['aria-label'] === '显示大小')[0]!
        .props.onChange({ target: { value: '0' } }),
    )
    expect(useAssetLibraryStore.getState().gridDensity).toBe('compact')

    // 列表按钮：点击切换列表，再点回网格
    act(() => root.findByProps({ 'aria-label': '列表视图' }).props.onClick())
    expect(useAssetLibraryStore.getState().viewMode).toBe('list')
    act(() => root.findByProps({ 'aria-label': '列表视图' }).props.onClick())
    expect(useAssetLibraryStore.getState().viewMode).toBe('grid')

    // 任务卡片视图：滑动条共用显示，列表按钮隐藏
    useAssetLibraryStore.setState({ groupBy: 'grouped' })
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="全部" totalCount={3} />)
    })
    expect(
      renderer!.root.findAll((node) => node.type === 'input' && node.props['aria-label'] === '显示大小'),
    ).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'aria-label': '列表视图' })).toHaveLength(0)
  })

  it('pins a filter value from the filter panel (筛选面板图钉 → 顶部快捷栏)', () => {
    useAssetLibraryStore.setState({ filters: { provider: '豆包' } })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="全部" totalCount={3} providerOptions={['豆包', 'fal']} />)
    })

    const root = renderer!.root
    // 打开筛选面板
    act(() => findToggle(root, 0).props.onClick())
    // 服务商区图钉：点击后固定到顶部
    const pin = root.findByProps({ 'data-testid': 'asset-filter-pin-provider:豆包' })
    expect(pin.props['aria-pressed']).toBe(false)
    act(() => pin.props.onClick())
    expect(useAssetLibraryStore.getState().pinnedFilters).toEqual([{ kind: 'provider', value: '豆包' }])

    // 已固定：aria-pressed 变为 true；再点取消固定
    act(() => renderer!.root.findByProps({ 'data-testid': 'asset-filter-pin-provider:豆包' }).props.onClick())
    expect(useAssetLibraryStore.getState().pinnedFilters).toEqual([])
    useAssetLibraryStore.setState({ filters: {} })
  })

  it('disables the pin button when the filter value is unset', () => {
    useAssetLibraryStore.setState({ filters: {} })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="全部" totalCount={3} providerOptions={['豆包']} />)
    })
    const root = renderer!.root
    act(() => findToggle(root, 0).props.onClick())
    const pin = root.findByProps({ 'data-testid': 'asset-filter-pin-provider:' })
    expect(pin.props.disabled).toBe(true)
    useAssetLibraryStore.setState({ filters: {} })
  })

  /**
   * 加载态按**方向**判（2026-09-23 改）。
   *
   * 契约：按钮的 loading = 「本次选中素材会产出到的那几个方向里有在跑的」。
   * 别处的方向在跑不该锁住这一屏 —— 这正是「一个方向占了整个功能」的修复点：
   * `Button` 的 `loading` 直接等于 `disabled`，判据一旦退回全局计数，按钮就整体点不动。
   */
  it('跑后处理的加载态只看选中素材所在方向，别的方向在跑不阻塞', () => {
    const direction = (id: string, name: string) => ({
      id,
      name,
      normalizedName: name.toLowerCase(),
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
    })
    const directionA = direction('direction-a', '方向A')
    const directionB = direction('direction-b', '方向B')
    useAssetLibraryStore.setState({
      selectedAssetIds: ['asset-a'],
      collections: [directionA, directionB],
      assetsById: {
        'asset-a': { id: 'asset-a', imageId: 'image-a', collectionIds: [directionA.id] } as never,
        'asset-b': { id: 'asset-b', imageId: 'image-b', collectionIds: [directionB.id] } as never,
      },
    })
    usePostprocessMediaStore.setState({
      selectedCollectionIds: [directionA.id, directionB.id],
      savedTargetCollectionIds: [],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<AssetLibraryToolbar scopeLabel="全部" totalCount={7} />)
    })
    const button = () => renderer!.root.findByProps({ 'data-testid': 'asset-manual-postprocess' })
    expect(button().props.loading).toBe(false)

    // 方向 A 在跑（有一条在飞的运行记录）：选中的是 A 的素材 → 转圈 + 禁用
    act(() => {
      useRuntimeStore.getState().startPostprocessRun({
        id: 'run-a',
        source: 'manual',
        totalImages: 1,
        batchId: 'b1',
        directionId: directionA.id,
      })
    })
    expect(button().props.loading).toBe(true)
    expect(button().findByType('button').props.disabled).toBe(true)

    // 换成方向 B 的素材 → 同一个按钮恢复可用（B 没被占），这是本次改造的核心
    act(() => {
      useAssetLibraryStore.setState({ selectedAssetIds: ['asset-b'] })
    })
    expect(button().props.loading).toBe(false)

    act(() => {
      useRuntimeStore.setState({ postprocessRuns: {}, postprocessRunIds: [] })
    })
    expect(button().props.loading).toBe(false)
  })
})
