/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import { useStore } from '../../../store'
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

function findButtonByText(root: ReactTestInstance, text: string) {
  return root
    .findAll((node: ReactTestInstance) => node.type === 'button')
    .find((node: ReactTestInstance) => getNodeText(node).includes(text))
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

  it('splits the left rail into the unified tree and the watermark library', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-management-workspace')).toHaveLength(
      1,
    )
    // 三栏并列：归属树 | 水印库 | 画布。
    // 左栏不再分段（树与库各占一栏），也就不需要分隔条；「预设详情」栏退役后由水印库补位。
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-project-tree')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-library')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-rail')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'tree-resizer')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'stacked-library-rail')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'rail-resizer')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'canvas-pane')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'logo-sidebar')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'layer-bottom-panel')).toHaveLength(1)

    const workspace = renderer!.root.find((node) => node.props['data-layout'] === 'preset-management-workspace')
    expect(workspace.props.className).toContain('h-full')

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

  it('三栏并列：归属树 | 水印库 | 画布，没有分隔条也不再分段', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-project-tree')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-library')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-rail')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'tree-resizer')).toHaveLength(0)
    // 预设组退役后不再有「组」这一层，也就不该再有第二根分隔条
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'rail-resizer')).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'stacked-library-rail')).toHaveLength(0)

    // 水印库与归属树同屏是硬要求：绑定的动作就是「从库里拖到一个方向上」，两者不同屏就做不成
    const grid = renderer!.root.find((node) => node.props['data-layout'] === 'preset-management-workspace')
    expect(grid.props.className).toContain('grid-cols-[300px_260px_minmax(0,1fr)]')
  })

  it('从预设库拖一个水印到树节点上，绑定的就是这个预设', () => {
    // 跨组件的拖拽靠两处共用同一个 MIME 常量，各写一份字面量的话这里会静默不生效
    useAssetLibraryStore.setState({
      collections: [
        {
          id: 'line-a',
          name: '智能客服',
          normalizedName: '智能客服',
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const preset = useCompositeV2Store.getState().presets[0]!
    const libraryRow = renderer!.root
      .findAll((node) => node.props.draggable === true && typeof node.props.onDragStart === 'function')
      .find((node) => getNodeText(node).includes(preset.name))
    expect(libraryRow).toBeTruthy()

    // 复刻浏览器行为：setData 决定 types，getData 只能取回已 set 的类型
    const bag = new Map<string, string>()
    act(() => {
      libraryRow!.props.onDragStart({
        dataTransfer: { effectAllowed: '', setData: (type: string, value: string) => bag.set(type, value) },
      })
    })

    const treeNode = renderer!.root.find((node) => node.props['data-preset-tree-node'] === 'line-a')
    const dropTarget = treeNode.find((node) => typeof node.props.onDrop === 'function')
    act(() => {
      dropTarget.props.onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: { types: [...bag.keys()], getData: (type: string) => bag.get(type) ?? '' },
      })
    })

    expect(useProjectTreeParamsStore.getState().params['line-a']?.postprocess?.watermarkPresetIds).toEqual([preset.id])
  })
})
