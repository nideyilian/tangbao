/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import type { CompositeV2Preset } from '../lib/compositeV2Types'
import { useStore } from '../../../store'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { DEFAULT_POSTPROCESS_MEDIA } from '../../../lib/postprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { createCompositeV2StoreState, useCompositeV2Store } from '../storeV2'
import * as compositeAssets from '../lib/compositeAssets'
import { PresetCanvasEditor } from './PresetCanvasEditor'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'
import { PresetManagementTab } from './PresetManagementTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
  useProjectTreeParamsStore.setState({ params: {} })
  useAssetLibraryStore.setState({ collections: [] })
  // 渠道表按渠道配水印的用例会改它：不还原的话下一个用例会跑在别人留下的渠道表上
  usePostprocessMediaStore.setState({ watermarkPresetIds: [], media: DEFAULT_POSTPROCESS_MEDIA })
  // 分隔条比例是持久化的：不清掉的话，上一个用例拖出来的比例会变成下一个用例的初始值
  window.localStorage.clear()
  useStore.getState().setConfirmDialog(null)
  vi.restoreAllMocks()
  delete (window as Window & { electronAPI?: typeof window.electronAPI }).electronAPI
})

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child: string | ReactTestInstance) => (typeof child === 'string' ? child : getNodeText(child)))
    .join('')
}

function findInputByAriaLabel(root: ReactTestInstance, label: string) {
  return root.findAllByType('input').find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

/** 生效范围那一排里的某个选项（按可见文字找）。 */
function findScopePill(renderer: ReturnType<typeof create>, label: string) {
  const scope = renderer.root.find((node) => node.props['data-layout'] === 'preset-scope-switch')
  return scope.findAll((node: ReactTestInstance) => node.type === 'button').find((node) => getNodeText(node) === label)
}

/** 标准现场：产品线A → 机器人（= 当前产品）/ 电池（= 另一个产品）。 */
const LINE_ID = 'line-a'
const PRODUCT_ID = 'product-b'
const OTHER_PRODUCT_ID = 'product-c'

function buildTree(extra: Array<Record<string, unknown>> = []) {
  return [
    { id: LINE_ID, name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
    { id: PRODUCT_ID, name: '机器人', parentId: LINE_ID, order: 0, createdAt: 0, updatedAt: 0 },
    { id: OTHER_PRODUCT_ID, name: '电池', parentId: LINE_ID, order: 1, createdAt: 0, updatedAt: 0 },
    ...extra,
  ] as never
}

/** 把作用域落到某个节点上（默认落在产品「机器人」）。 */
function seedScope(scopeId: string = PRODUCT_ID, extra: Array<Record<string, unknown>> = []) {
  useAssetLibraryStore.setState({
    scope: { kind: 'collection', id: scopeId },
    collections: buildTree(extra),
  })
}

/**
 * 造一套属于某产品的预设。
 *
 * 水印库按产品隔离后，「往 store 里塞 preset」**不等于**「界面上看得见它」——
 * 库列表读的是**当前作用域所属产品**的预设，所以用例必须同时把归属和树准备好
 * （`seedScope`）。漏了这一步的症状是「界面上一套水印都没有」，而 store 里其实躺着一堆。
 */
function productPreset(id: string, name: string, productId: string = PRODUCT_ID): CompositeV2Preset {
  return { ...createDefaultCompositeV2Preset(1), id, name, productId }
}

describe('PresetManagementTab', () => {
  it('stores imported LOGO bytes before adding metadata', async () => {
    let resolveIds!: (ids: string[]) => void
    vi.spyOn(compositeAssets, 'storeCompositeBlobs').mockReturnValue(
      new Promise((resolve) => {
        resolveIds = resolve
      }),
    )
    const file = new File(['logo'], 'logo.png', { type: 'image/png' })
    const files = {
      0: file,
      length: 1,
      item: () => null,
      [Symbol.iterator]: function* () {
        yield file
      },
    } as unknown as FileList
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    let importing!: Promise<void>
    act(() => {
      importing = renderer!.root.findByType(FloatingLogoLibrary).props.onImportFiles(files)
    })
    expect(useCompositeV2Store.getState().projectLogos).toEqual([])

    await act(async () => {
      resolveIds(['asset-logo'])
      await importing
    })
    expect(useCompositeV2Store.getState().projectLogos[0]).toMatchObject({
      name: 'logo.png',
      assetId: 'asset-logo',
    })
  })

  it('splits the workspace into the watermark library and the canvas', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-management-workspace')).toHaveLength(
      1,
    )
    // 两栏并列：水印库 | 画布。
    // 2026-09-21 改版把「水印归属」整栏删了 —— 归属读的就是中控台左边那棵项目树
    // （同一份 collections、同一个选中），编辑器里再放一棵等于同一件事开两个入口。
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-project-tree')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-library')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-rail')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'tree-resizer')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'stacked-library-rail')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'rail-resizer')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'canvas-pane')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'logo-sidebar')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'layer-bottom-panel')).toHaveLength(1)

    const workspace = renderer!.root.find((node) => node.props['data-layout'] === 'preset-management-workspace')
    // h-full 是「高度自适应」的另一半：中控台把剩余高度交给它（不再套滚动容器），
    // 这里必须真的长满，否则窗口高了下方仍是空白。
    expect(workspace.props.className).toContain('h-full')
    expect(workspace.props.className).toContain('grid-cols-[300px_minmax(0,1fr)]')

    const fixedMinimumHeightNodes = renderer!.root.findAll(
      (node) => typeof node.props.className === 'string' && node.props.className.includes('min-h-[680px]'),
    )
    expect(fixedMinimumHeightNodes).toHaveLength(0)
  })

  it('replaces an existing LOGO layer instead of adding an image layer', async () => {
    const preset = productPreset('preset-logo', 'LOGO 水印')
    seedScope()
    useCompositeV2Store.setState({
      presets: [preset],
      selectedPreviewPresetId: preset.id,
      logoLibraryPath: 'D:/logos',
    })
    const logoId = useCompositeV2Store.getState().replaceOrAddLogoLayer(preset.id, { kind: 'project', id: 'old-logo' })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {},
    })

    useCompositeV2Store.setState({
      projectLogos: [{ id: 'new-logo', name: 'new.png', dataUrl: 'data:image/png;base64,AAAA' }],
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const logoButton = renderer!.root
      .findAllByType('button')
      .find(
        (node) =>
          node.props['aria-label'] === '应用LOGO' &&
          node.parent?.parent?.children.some(
            (child) =>
              typeof child === 'object' && child !== null && 'props' in child && child.props?.title === 'new.png',
          ),
      )
    act(() => {
      logoButton?.props.onClick()
    })

    const layers = useCompositeV2Store.getState().presets[0]!.layers
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({
      id: logoId,
      type: 'logo',
      asset: {
        kind: 'project',
        id: 'old-logo',
      },
    })
  })

  it('基准尺寸选择器挂在画布工具栏上（原「预设详情」栏已退役）', () => {
    const preset = productPreset('preset-size', '尺寸水印')
    seedScope()
    useCompositeV2Store.setState({
      presets: [preset],
      selectedPreviewPresetId: preset.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const sizeSelect = renderer!.root.findByProps({ 'aria-label': '基准尺寸' })
    expect(
      sizeSelect.findAllByType('option').map((option) => ({
        value: option.props.value,
        label: getNodeText(option),
      })),
    ).toEqual([
      { value: '1280x720', label: '1280 × 720' },
      { value: '1080x1920', label: '1080 × 1920' },
      { value: '800x800', label: '800 × 800' },
    ])

    act(() => {
      sizeSelect.props.onChange({ target: { value: '1080x1920' } })
    })

    expect(useCompositeV2Store.getState().presets[0]!.baseCanvas).toEqual({
      width: 1080,
      height: 1920,
    })
  })
  it('auto-selects the newly created layer after adding text', () => {
    const preset = { ...createDefaultCompositeV2Preset(1), productId: PRODUCT_ID }
    seedScope()
    useCompositeV2Store.setState({
      presets: [preset],
      selectedPreviewPresetId: preset.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const addTextButton = renderer!.root
      .findAllByType('button')
      .find((node) => node.props['aria-label'] === '添加文字图层')
    act(() => {
      addTextButton?.props.onClick()
    })

    const latestPreset = useCompositeV2Store.getState().presets[0]!
    const newestLayerId = latestPreset.layers.at(-1)?.id
    const canvasEditor = renderer!.root.findByType(PresetCanvasEditor)

    expect(latestPreset.layers).toHaveLength(1)
    expect(newestLayerId).toBeTruthy()
    expect(canvasEditor.props.selectedLayerId).toBe(newestLayerId)
  })

  it('reloads the persisted LOGO library when preset management opens', async () => {
    const listImageFiles = vi
      .fn()
      .mockResolvedValue([{ path: 'D:/logos/logo.png', name: 'logo.png', dataUrl: 'data:image/png;base64,AAAA' }])
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { listImageFiles },
    })
    useCompositeV2Store.setState({
      logoLibraryPath: 'D:/logos',
      projectLogos: [{ id: 'new-logo', name: 'new.png', dataUrl: 'data:image/png;base64,AAAA' }],
    } as never)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(useCompositeV2Store.getState().projectLogos).toHaveLength(1)
    expect(useCompositeV2Store.getState().projectLogos[0]?.name).toBe('new.png')
  })

  it('⭐ 新建的水印落进当前产品的库，并成为当前编辑对象', () => {
    const presetA = productPreset('preset-a', 'Alpha Preset')
    seedScope()

    useCompositeV2Store.setState({
      presets: [presetA],
      selectedPreviewPresetId: presetA.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const libraryCreateButton = renderer!.root.findAllByProps({ title: '在「机器人」下新建水印' }).at(-1)

    act(() => {
      libraryCreateButton?.props.onClick()
    })

    const presets = useCompositeV2Store.getState().presets
    expect(presets).toHaveLength(2)
    // 归属跟着当前作用域的产品走：不落归属它会掉进「未分配」区，在这个产品的库里直接看不见
    expect(presets[1]!.productId).toBe(PRODUCT_ID)
    // 新建的预设直接进库并成为当前编辑对象，不需要「先建组、再入组」这类前置动作
    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presets[1]!.id)
  })

  it('⭐ 库列表只列当前产品的预设，别的产品的看不见', () => {
    const mine = productPreset('preset-a', 'Alpha Preset')
    const others = productPreset('preset-b', 'Beta Preset', OTHER_PRODUCT_ID)
    const orphan = createDefaultCompositeV2Preset(1) // productId = '' → 未分配
    seedScope()
    useCompositeV2Store.setState({ presets: [mine, others, orphan], selectedPreviewPresetId: mine.id })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const text = getNodeText(renderer!.root)
    expect(text).toContain('Alpha Preset')
    // 隔离的硬要求：别产品的水印既不出现在列表里，也不可能被勾到
    expect(text).not.toContain('Beta Preset')
    // 标题带上产品名，切产品时不会看起来像「同一批水印在变魔术」
    expect(text).toContain('水印库 · 机器人')
    // 未分配的不进任何产品的库，但必须**看得见**（否则它既用不上也删不掉）
    expect(text).toContain('未分配（1）')
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-unassigned')).toHaveLength(1)
  })

  it('⭐ 未分配的水印可一键归到当前产品', () => {
    const mine = productPreset('preset-a', 'Alpha Preset')
    const orphan = { ...createDefaultCompositeV2Preset(1), name: '老水印' }
    seedScope()
    useCompositeV2Store.setState({ presets: [mine, orphan], selectedPreviewPresetId: mine.id })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const assignButton = renderer!.root.findAllByType('button').find((node) => getNodeText(node) === '归到「机器人」')
    expect(assignButton).toBeTruthy()
    act(() => {
      assignButton!.props.onClick()
    })

    expect(useCompositeV2Store.getState().presets.find((preset) => preset.id === orphan.id)?.productId).toBe(PRODUCT_ID)
    // 归过去之后未分配区就空了
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-unassigned')).toHaveLength(0)
  })

  it('每张卡的操作按钮都常驻：没选中那一套也能直接复制 / 删除它', () => {
    seedScope()
    useCompositeV2Store.setState({
      presets: [productPreset('preset-a', 'Alpha Preset'), productPreset('preset-b', 'Beta Preset')],
      selectedPreviewPresetId: 'preset-a',
    })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    // 选中态在 preset-a，preset-b 那一行的按钮照样在。
    // 改回「只在选中行渲染按钮」的话这里会直接抛错 —— 卡片改成两栏长条后，
    // 按钮必须落在固定的位置，「想删某一套还得先点选它」是这次要消掉的别扭。
    const rowB = renderer!.root.findByProps({ 'data-testid': 'preset-row-preset-b' })
    expect(rowB.findByProps({ title: '删除预设「Beta Preset」' })).toBeTruthy()
    expect(rowB.findByProps({ title: '复制「Beta Preset」为新预设' })).toBeTruthy()
    expect(rowB.findByProps({ 'data-testid': 'preset-copy-one' })).toBeTruthy()
  })

  it('deletes a preset from the library and falls back to a valid preview selection', () => {
    const presetA = productPreset('preset-a', 'Alpha Preset')
    const presetB = productPreset('preset-b', 'Beta Preset')
    seedScope()

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      selectedPreviewPresetId: presetB.id,
    })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    // 删除按钮现在每张卡都常驻，标题里带上预设名才能精确定位到 preset-b 那一行
    const deleteButton = renderer!.root.findByProps({ title: '删除预设「Beta Preset」' })

    act(() => {
      deleteButton.props.onClick()
    })
    const confirmDialog = useStore.getState().confirmDialog
    expect(confirmDialog).toMatchObject({
      title: '删除预设？',
      confirmText: '确认删除',
      tone: 'danger',
    })
    act(() => {
      confirmDialog?.action?.()
      useStore.getState().setConfirmDialog(null)
    })

    expect(useCompositeV2Store.getState().presets.map((preset) => preset.id)).toEqual([presetA.id])
    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetA.id)
  })

  it('keeps the current preset details when filtering hides it from the library list', () => {
    const presetA = productPreset('preset-a', 'Alpha Preset')
    const presetB = productPreset('preset-b', 'Beta Preset')
    seedScope()

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      selectedPreviewPresetId: presetB.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const searchInput = findInputByAriaLabel(renderer!.root, '搜索预设')
    act(() => {
      searchInput?.props.onChange({ target: { value: 'Alpha' } })
    })

    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetB.id)
    expect(getNodeText(renderer!.root)).toContain('Beta Preset')
  })

  it('keeps rendering the current preset details when the library filter returns no results', () => {
    const presetA = productPreset('preset-a', 'Alpha Preset')
    const presetB = productPreset('preset-b', 'Beta Preset')
    seedScope()

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      selectedPreviewPresetId: presetB.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const searchInput = findInputByAriaLabel(renderer!.root, '搜索预设')
    act(() => {
      searchInput?.props.onChange({ target: { value: 'No Match' } })
    })

    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetB.id)
    expect(getNodeText(renderer!.root)).toContain('Beta Preset')
  })

  it('⭐ 库行勾选 = 当前范围启用这套水印', () => {
    const preset = productPreset('preset-a', 'Alpha Preset')
    useCompositeV2Store.setState({ presets: [preset], selectedPreviewPresetId: preset.id })
    usePostprocessMediaStore.setState({ watermarkPresetIds: [] })
    seedScope('direction-moon', [
      { id: 'direction-moon', name: '月亮', parentId: PRODUCT_ID, order: 0, createdAt: 0, updatedAt: 0 },
    ])

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    // 作用域写在副标题里：库行勾选框的语义是「这个范围用不用这套水印」，
    // 不再是原来的「选几个准备拖到归属树」。看不清这一点就会以为勾选是为了导出。
    expect(getNodeText(renderer!.root)).toContain('勾选 = 「月亮」用这套水印')

    act(() => {
      renderer!.root.findByProps({ 'aria-label': '启用「Alpha Preset」' }).props.onChange(true)
    })

    // 写的是这个方向的覆盖（不是全局清单）：继承态下首次改动必须物化成显式数组，
    // 否则「加一个」会被理解成「只留这一个」，把继承来的其余水印静默丢掉。
    expect(useProjectTreeParamsStore.getState().params['direction-moon']?.postprocess?.watermarkPresetIds).toEqual([
      preset.id,
    ])
  })

  it('没有产品这一层（产品线 / 全局默认）时不给库：只提示先选一个产品', () => {
    const preset = productPreset('preset-a', 'Alpha Preset')
    seedScope()
    useCompositeV2Store.setState({ presets: [preset], selectedPreviewPresetId: preset.id })
    useAssetLibraryStore.setState({ scope: 'all' })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    // 给一个点了没反应的库比不给更糟：说清「水印属于产品」，并让三个入口都给出同一条下一步
    expect(getNodeText(renderer!.root)).toContain('水印属于产品')
    expect(renderer!.root.findAllByProps({ title: '先在左侧选一个产品' }).length).toBeGreaterThan(0)
    // 生效范围那一排也不渲染：数据层没有 byMedia 这一层，
    // 摆一排点不动的渠道会让人以为「这里也能按渠道配，只是现在锁着」
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-scope-switch')).toHaveLength(0)
    // 连「未分配」区都不出现：没有产品就没有可归的对象，摆出来只会让人白点
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-unassigned')).toHaveLength(0)
  })

  it('⭐ 打开水印库时把存量水印按现有归属归到产品（v6 数据没有归属字段）', () => {
    // v6 的水印库是全局一批、预设上没有归属；升级后靠「哪个产品的方向勾过它」补上这个字段
    const preset = { ...createDefaultCompositeV2Preset(1), name: '老水印' }
    seedScope('direction-moon', [
      { id: 'direction-moon', name: '月亮', parentId: PRODUCT_ID, order: 0, createdAt: 0, updatedAt: 0 },
    ])
    useCompositeV2Store.setState({
      presets: [preset],
      selectedPreviewPresetId: preset.id,
      presetProductMigrationVersion: 0,
    })
    useProjectTreeParamsStore.setState({
      params: { 'direction-moon': { postprocess: { watermarkPresetIds: [preset.id] } } },
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    // 归到「月亮」所在的产品 ⇒ 它出现在本产品的库里，而不是掉进「未分配」
    expect(useCompositeV2Store.getState().presets[0]!.productId).toBe(PRODUCT_ID)
    expect(useCompositeV2Store.getState().presetProductMigrationVersion).toBe(1)
    expect(getNodeText(renderer!.root)).toContain('老水印')
  })

  it('⭐ 迁移只跑一次：用户主动摘出来的水印不会被下次打开自动收回', () => {
    const preset = { ...createDefaultCompositeV2Preset(1), name: '刚摘出来的' }
    seedScope('direction-moon', [
      { id: 'direction-moon', name: '月亮', parentId: PRODUCT_ID, order: 0, createdAt: 0, updatedAt: 0 },
    ])
    // 标记已是 1（跑过了），而这个预设归属为空 = 用户刚把它摘出来
    useCompositeV2Store.setState({
      presets: [preset],
      selectedPreviewPresetId: preset.id,
      presetProductMigrationVersion: 1,
    })
    useProjectTreeParamsStore.setState({
      params: { 'direction-moon': { postprocess: { watermarkPresetIds: [preset.id] } } },
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    // 归属必须还是空的，否则「我明明把它摘出来了，它自己又回来了」——最难查的一类问题
    expect(useCompositeV2Store.getState().presets[0]!.productId).toBe('')
  })

  describe('按渠道单独设水印', () => {
    /**
     * 一棵三级树：**只有产品写了通用水印**，方向本身什么都没写。
     * 这正是杰哥说的「默认按产品维度来 —— 该产品下所有方向都显示同一套」。
     */
    function seedProductLevelWatermark() {
      usePostprocessMediaStore.setState({
        watermarkPresetIds: [],
        media: [
          { id: 'toutiao', name: '头条' },
          { id: 'baidu', name: '百度' },
        ] as never,
      })
      seedScope('direction-moon', [
        { id: 'direction-moon', name: '月亮', parentId: PRODUCT_ID, order: 0, createdAt: 0, updatedAt: 0 },
      ])
      useProjectTreeParamsStore.setState({
        params: { [PRODUCT_ID]: { postprocess: { watermarkPresetIds: ['preset-shared'] } } },
      })
    }

    it('⭐ 方向没写过时显示的是继承来的那套，并写明来源', () => {
      seedProductLevelWatermark()

      let renderer: ReturnType<typeof create>
      act(() => {
        renderer = create(<PresetManagementTab />)
      })
      mountedRenderers.push(renderer!)

      // 不写来源的话，「库里勾着的这几套」会被当成这个方向自己的设置 ——
      // 用户以为在改产品，实际一勾就落了一条方向级覆盖
      expect(getNodeText(renderer!.root)).toContain('继承自「机器人」')
      // 本级没写就没有「跟随上级」可点（没东西可撤）
      expect(renderer!.root.findAll((node) => node.type === 'button' && getNodeText(node) === '跟随上级')).toHaveLength(
        0,
      )
    })

    it('⭐ 切到某个渠道后勾选 = 该渠道单独的水印（写 byMedia，不动通用那格）', () => {
      seedProductLevelWatermark()
      // 归属「机器人」：水印库按产品隔离，这套得属于当前方向所在的产品才会出现在库里
      const preset = productPreset('preset-a', 'Alpha Preset')
      useCompositeV2Store.setState({ presets: [preset], selectedPreviewPresetId: preset.id })

      let renderer: ReturnType<typeof create>
      act(() => {
        renderer = create(<PresetManagementTab />)
      })
      mountedRenderers.push(renderer!)

      act(() => {
        findScopePill(renderer!, '头条')!.props.onClick()
      })
      expect(getNodeText(renderer!.root)).toContain('本方向的头条单独生效')

      act(() => {
        renderer!.root.findByProps({ 'aria-label': '启用「Alpha Preset」（头条）' }).props.onChange(true)
      })

      // 头条当前生效值是继承来的 ['preset-shared']，首次改动要**物化**成显式数组再追加；
      // 直接写「勾上的那几个」会把它静默丢掉
      expect(useProjectTreeParamsStore.getState().params['direction-moon']?.postprocess?.byMedia).toEqual({
        toutiao: { watermarkPresetIds: ['preset-shared', preset.id] },
      })
      // 通用那格没被写脏：其他渠道照旧跟随通用
      expect(
        useProjectTreeParamsStore.getState().params['direction-moon']?.postprocess?.watermarkPresetIds,
      ).toBeUndefined()
    })

    it('⭐「跟随通用」是删掉那一格，不是写回当前值（否则以后改通用就影响不到它）', () => {
      seedProductLevelWatermark()
      useProjectTreeParamsStore.setState({
        params: {
          [PRODUCT_ID]: { postprocess: { watermarkPresetIds: ['preset-shared'] } },
          'direction-moon': { postprocess: { byMedia: { toutiao: { watermarkPresetIds: ['preset-toutiao'] } } } },
        },
      })

      let renderer: ReturnType<typeof create>
      act(() => {
        renderer = create(<PresetManagementTab />)
      })
      mountedRenderers.push(renderer!)

      act(() => {
        findScopePill(renderer!, '头条')!.props.onClick()
      })

      const reset = renderer!.root
        .findAll((node) => node.type === 'button')
        .find((node) => getNodeText(node) === '跟随通用')
      expect(reset).toBeTruthy()
      act(() => {
        reset!.props.onClick()
      })

      expect(useProjectTreeParamsStore.getState().params['direction-moon']?.postprocess?.byMedia).toBeUndefined()
    })

    it('本级写了通用水印时给「跟随上级」，撤掉后回到继承', () => {
      seedProductLevelWatermark()
      useProjectTreeParamsStore.setState({
        params: {
          [PRODUCT_ID]: { postprocess: { watermarkPresetIds: ['preset-shared'] } },
          'direction-moon': { postprocess: { watermarkPresetIds: ['preset-own'] } },
        },
      })

      let renderer: ReturnType<typeof create>
      act(() => {
        renderer = create(<PresetManagementTab />)
      })
      mountedRenderers.push(renderer!)

      const reset = renderer!.root
        .findAll((node) => node.type === 'button')
        .find((node) => getNodeText(node) === '跟随上级')
      expect(reset).toBeTruthy()
      act(() => {
        reset!.props.onClick()
      })

      expect(
        useProjectTreeParamsStore.getState().params['direction-moon']?.postprocess?.watermarkPresetIds,
      ).toBeUndefined()
    })
  })

  /**
   * 跨产品复制（单条 / 整库）。
   *
   * 契约：复制出的是**新的一套**（新 id、归属改到目标产品、内容整套带走），并且
   * **不自动启用** —— 不动任何节点的水印清单。目标候选里不出现当前产品。
   */
  describe('复制水印到其他产品', () => {
    /**
     * 点开「复制到…」并选中目标产品，返回渲染器。
     *
     * `rowPresetId` 给「单套」入口用：行内操作按钮**每张卡都常驻**之后，同一个 testid 在
     * 列表里会出现多次，必须落到具体那一行去找，否则拿到的是第一行那套水印。
     * 「整库」入口在头部、全局唯一，不传即可。
     */
    function openCopyDialog(entryTestId: string, rowPresetId?: string) {
      seedScope()
      useCompositeV2Store.setState({
        presets: [productPreset('preset-a', '合规水印头部'), productPreset('preset-b', '角标')],
        selectedPreviewPresetId: 'preset-a',
      })

      let renderer: ReturnType<typeof create>
      act(() => {
        renderer = create(<PresetManagementTab />)
      })
      mountedRenderers.push(renderer!)

      const scope = rowPresetId
        ? renderer!.root.findByProps({ 'data-testid': `preset-row-${rowPresetId}` })
        : renderer!.root
      act(() => {
        scope.findByProps({ 'data-testid': entryTestId }).props.onClick()
      })
      return renderer!
    }

    function clickButton(renderer: ReturnType<typeof create>, label: string) {
      const button = renderer.root.findAll((node) => node.type === 'button').find((node) => getNodeText(node) === label)
      expect(button, `没找到按钮「${label}」`).toBeTruthy()
      act(() => {
        button!.props.onClick()
      })
    }

    it('单条：换新 id、归属改到目标产品、名称带副本，且不自动启用', () => {
      const showToast = vi.fn()
      useStore.setState({ showToast })
      useProjectTreeParamsStore.setState({
        params: { [PRODUCT_ID]: { postprocess: { watermarkPresetIds: ['preset-a'] } } },
      })
      const renderer = openCopyDialog('preset-copy-one', 'preset-a')

      clickButton(renderer, '电池')
      act(() => {
        renderer.root.findByProps({ 'data-testid': 'preset-copy-confirm' }).props.onClick()
      })

      const presets = useCompositeV2Store.getState().presets
      expect(presets).toHaveLength(3)
      const copy = presets.find((preset) => preset.productId === OTHER_PRODUCT_ID)
      expect(copy).toMatchObject({ name: '合规水印头部 副本' })
      expect(copy?.id).not.toBe('preset-a')
      // 内容整套带过去：画布尺寸与图层不能丢，否则等于复制了个空壳
      expect(copy?.baseCanvas).toEqual(presets.find((preset) => preset.id === 'preset-a')?.baseCanvas)
      expect(copy?.layers).toEqual(presets.find((preset) => preset.id === 'preset-a')?.layers)
      // 只复制了选中的那一套，不是整库
      expect(presets.filter((preset) => preset.productId === OTHER_PRODUCT_ID)).toHaveLength(1)
      // **不自动启用**：当前产品的清单原样不动（源 id 仍在，新 id 没被塞进去）
      expect(useProjectTreeParamsStore.getState().params[PRODUCT_ID]?.postprocess?.watermarkPresetIds).toEqual([
        'preset-a',
      ])
      expect(showToast).toHaveBeenCalledWith('已复制 1 套水印到「电池」（未启用）', 'success')
    })

    it('整库：一次复制本产品的全部水印，目标产品里已有的同名会加序号', () => {
      const showToast = vi.fn()
      useStore.setState({ showToast })
      const renderer = openCopyDialog('preset-copy-library')

      // 目标产品已有同名副本，复制过去不能撞名
      useCompositeV2Store.setState((state) => ({
        presets: [...state.presets, productPreset('preset-c', '合规水印头部 副本', OTHER_PRODUCT_ID)],
      }))

      clickButton(renderer, '电池')
      act(() => {
        renderer.root.findByProps({ 'data-testid': 'preset-copy-confirm' }).props.onClick()
      })

      const inTarget = useCompositeV2Store.getState().presets.filter((preset) => preset.productId === OTHER_PRODUCT_ID)
      // 已有的 `preset-c` 是「合规水印头部 副本」，所以这次复制出来的必须让开这个名字
      expect(
        inTarget
          .filter((preset) => preset.id !== 'preset-c')
          .map((preset) => preset.name)
          .sort(),
      ).toEqual(['合规水印头部 副本 2', '角标 副本'])
      expect(showToast).toHaveBeenCalledWith('已复制 2 套水印到「电池」（未启用）', 'success')
    })

    it('候选里不出现当前产品，只剩一个产品时入口不可点', () => {
      seedScope(PRODUCT_ID, [{ id: 'product-d', name: '无关产品', parentId: 'line-b', order: 0 }])
      useCompositeV2Store.setState({
        presets: [productPreset('preset-a', '合规水印头部')],
        selectedPreviewPresetId: 'preset-a',
      })

      let renderer: ReturnType<typeof create>
      act(() => {
        renderer = create(<PresetManagementTab />)
      })
      mountedRenderers.push(renderer!)

      act(() => {
        renderer!.root.findByProps({ 'data-testid': 'preset-copy-one' }).props.onClick()
      })

      const dialog = renderer!.root.findByProps({ 'aria-labelledby': 'preset-copy-dialog-title' })
      // 只比「候选按钮」这一层：标题与说明里本来就会出现源产品名（「把『机器人』的 1 套水印…」）
      const candidates = dialog
        .findAll((node) => node.type === 'button')
        .map((node) => getNodeText(node))
        .filter((text) => text !== '取消' && !text.startsWith('复制到'))
      expect(candidates).not.toContain('机器人')
      expect(candidates).toContain('电池')
    })
  })
})
