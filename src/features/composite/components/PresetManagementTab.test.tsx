/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import { useStore } from '../../../store'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
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
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'preset-logo' }
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
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'preset-size' }
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
    const preset = createDefaultCompositeV2Preset(1)
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

  it('creates a preset only in the global preset library', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }

    useCompositeV2Store.setState({
      presets: [presetA],
      selectedPreviewPresetId: presetA.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const createPresetButtons = renderer!.root.findAllByProps({ title: '新建预设' })
    const libraryCreateButton = createPresetButtons.at(-1)

    act(() => {
      libraryCreateButton?.props.onClick()
    })

    expect(useCompositeV2Store.getState().presets).toHaveLength(2)
    // 新建的预设直接进库并成为当前编辑对象，不需要「先建组、再入组」这类前置动作
    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(useCompositeV2Store.getState().presets[1]!.id)
  })

  it('deletes a preset from the library and falls back to a valid preview selection', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      selectedPreviewPresetId: presetB.id,
    })
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const deleteButton = renderer!.root.findByProps({ title: '删除预设' })

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
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }

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
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }

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
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    useCompositeV2Store.setState({ presets: [preset], selectedPreviewPresetId: preset.id })
    usePostprocessMediaStore.setState({ watermarkPresetIds: [] })
    useAssetLibraryStore.setState({
      scope: { kind: 'collection', id: 'direction-moon' },
      collections: [
        { id: 'line-a', name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'direction-moon', name: '月亮', parentId: 'line-a', order: 0, createdAt: 0, updatedAt: 0 },
      ] as never,
    })

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

  it('全局默认下不给开关：全局基线是各方向的兜底值，前端没有写入点', () => {
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    useCompositeV2Store.setState({ presets: [preset], selectedPreviewPresetId: preset.id })
    useAssetLibraryStore.setState({ scope: 'all' })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    // 给一个点了没反应的控件比不给更糟：这里直接禁用并把原因写在可访问名里
    const box = renderer!.root.findByProps({ 'aria-label': '「Alpha Preset」的启用在方向层设置' })
    expect(box.props.disabled).toBe(true)
    expect(getNodeText(renderer!.root)).toContain('先在左侧项目树选一个方向')
  })
})
