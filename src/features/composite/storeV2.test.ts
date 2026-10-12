import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createCompositeV2Store,
  createCompositeV2StoreState,
  getCompositeV2PersistedState,
  migrateCompositeV2PersistedState,
  mergeCompositeV2PersistedState,
} from './storeV2'
import { createDefaultCompositeV2Preset } from './lib/compositeV2Defaults'
import type { CompositeV2ImageLayer, CompositeV2TextLayer } from './lib/compositeV2Types'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('composite v2 store state factory', () => {
  it('creates a default preset with canvas and layers only', () => {
    const preset = createDefaultCompositeV2Preset(1)

    expect(preset).toEqual({
      id: 'preset-default',
      name: '默认产品预设',
      // 出厂预设不预设产品：水印库按产品隔离，它会落在「未分配」区等用户指派
      productId: '',
      baseCanvas: { width: 1280, height: 720 },
      sampleBackgroundPath: '',
      layers: [],
      updatedAt: 1,
    })
  })

  it('drops retired orchestration fields when migrating an old snapshot', () => {
    const legacyPreset = {
      ...createDefaultCompositeV2Preset(1),
      // 旧版本的预设自带整套编排字段：输出目录、命名模板、变量取值、渠道尺寸覆盖。
      // 编排职责已归后处理，这些字段必须被丢掉——留着就会被当成「还算数」的配置。
      outputRootPath: 'D:/out',
      distributionPath: 'D:/dist',
      filenameTemplate: '{preset}-{index}',
      namingTemplate: '{project}',
      customVariableValues: { project: '项目A' },
      useOutputOverrides: true,
      outputRuleGroupsOverride: [{ id: 'gdt', name: '广点通', rules: [], distributionPaths: [] }],
    }

    const migrated = migrateCompositeV2PersistedState(
      // 同时带上 v4 时代的预设组：分组已收敛到项目树，组本身没有第二处容身之所，也必须丢掉
      {
        presets: [legacyPreset],
        customVariables: [],
        presetGroups: [{ id: 'group-default', name: '默认预设组', presetIds: ['preset-default'], updatedAt: 1 }],
        selectedPresetGroupId: 'group-default',
      },
      3,
    )

    expect(migrated.presets).toEqual([
      {
        id: 'preset-default',
        name: '默认产品预设',
        // 老快照里没有归属字段：迁移补空串 = 未分配，之后由一次性迁移按现有归属推断
        productId: '',
        baseCanvas: { width: 1280, height: 720 },
        sampleBackgroundPath: '',
        layers: [],
        updatedAt: 1,
      },
    ])
    expect(migrated).not.toHaveProperty('presetGroups')
    expect(migrated).not.toHaveProperty('selectedPresetGroupId')
  })

  it('normalizes a broken canvas and fit mode instead of trusting persisted values', () => {
    const migrated = migrateCompositeV2PersistedState(
      {
        presets: [
          { ...createDefaultCompositeV2Preset(1), id: 'preset-a', baseCanvas: { width: 0, height: Number.NaN } },
          { ...createDefaultCompositeV2Preset(2), id: 'preset-b', baseCanvas: { width: 800, height: 800 } },
        ],
        globalFitMode: 'nonsense',
      },
      3,
    )

    expect(migrated.presets.map((preset) => preset.baseCanvas)).toEqual([
      { width: 1280, height: 720 },
      { width: 800, height: 800 },
    ])
    expect(migrated.globalFitMode).toBe('crop-fill')
  })

  it('discards presets without an id', () => {
    const migrated = migrateCompositeV2PersistedState(
      { presets: [{ name: '没有 id 的脏数据' }, createDefaultCompositeV2Preset(1)] },
      3,
    )

    expect(migrated.presets.map((preset) => preset.id)).toEqual(['preset-default'])
  })

  it('creates batch state separate from persisted preset state', () => {
    const state = createCompositeV2StoreState()

    expect(state.logoLibraryPath).toBe('')
    expect(state.backgroundFolders).toEqual([])
    expect(state.recursiveBackgrounds).toBe(false)
    expect(state.backgrounds).toEqual([])
    expect(state.previewHistory).toEqual([])
    expect(state.previewHistoryIndex).toBe(-1)
    expect(state.presets.length).toBeGreaterThan(0)
  })

  it('returns only persisted domain state for storage', () => {
    const store = createCompositeV2Store()
    store.setState({
      backgroundFolders: ['D:/bg'],
      recursiveBackgrounds: true,
      backgrounds: [{ path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '', width: 100, height: 100 }],
      previewHistory: ['D:/bg/a.jpg'],
      previewHistoryIndex: 0,
      logoOrder: [],
      projectLogos: [],
    })
    store.setState({ logoLibraryPath: 'D:/logos' })

    const persisted = getCompositeV2PersistedState(store.getState())

    expect(persisted).toEqual({
      logoLibraryPath: 'D:/logos',
      logoOrder: [],
      projectLogos: [],
      presets: store.getState().presets,
      globalFitMode: store.getState().globalFitMode,
      identifier: { text: '', placement: 'suffix' },
      backgroundFolders: ['D:/bg'],
      recursiveBackgrounds: true,
      selectedPreviewPresetId: store.getState().selectedPreviewPresetId,
      presetProductMigrationVersion: 0,
    })
    expect(persisted).not.toHaveProperty('previewHistory')
    expect(persisted).not.toHaveProperty('backgrounds')
  })

  it('hydrates the persisted preset selection', () => {
    const source = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    source.setState({ presets: [presetA, presetB], selectedPreviewPresetId: presetB.id })
    const persisted = JSON.parse(JSON.stringify(getCompositeV2PersistedState(source.getState())))

    const hydrated = mergeCompositeV2PersistedState(persisted, createCompositeV2Store().getState())

    expect(hydrated.selectedPreviewPresetId).toBe('preset-b')
  })

  it('falls back to the first preset when the persisted selection no longer exists', () => {
    const currentStore = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    currentStore.setState({ presets: [presetA, presetB], selectedPreviewPresetId: presetA.id })
    const persisted = {
      ...getCompositeV2PersistedState(currentStore.getState()),
      selectedPreviewPresetId: 'missing-preset',
    }

    const hydrated = mergeCompositeV2PersistedState(JSON.parse(JSON.stringify(persisted)), currentStore.getState())

    // 预设被删掉之后还留着 id，画布区会永远空着且不回退 —— 所以必须换成一个真实存在的
    expect(hydrated.selectedPreviewPresetId).toBe('preset-a')
  })

  it('switches the preview preset without any grouping constraint', () => {
    const store = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    store.setState({ presets: [presetA, presetB], selectedPreviewPresetId: presetA.id })

    store.getState().setSelectedPreviewPresetId(presetB.id)

    expect(store.getState().selectedPreviewPresetId).toBe('preset-b')
  })

  it('chooses a deterministic random preview when backgrounds refresh', () => {
    const store = createCompositeV2Store({ pickRandomIndex: () => 1 })
    const backgrounds = [
      { path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '', width: 100, height: 100 },
      { path: 'D:/bg/b.jpg', name: 'b.jpg', relativeDir: '', width: 100, height: 100 },
      { path: 'D:/bg/c.jpg', name: 'c.jpg', relativeDir: '', width: 100, height: 100 },
    ]

    store.getState().setBackgrounds(backgrounds)

    expect(store.getState().backgrounds).toEqual(backgrounds)
    expect(store.getState().previewHistory).toEqual(['D:/bg/b.jpg'])
    expect(store.getState().previewHistoryIndex).toBe(0)
  })

  it('updates batch controls through minimal setters', () => {
    const store = createCompositeV2Store()

    store.getState().setBackgroundFolders(['D:/bg'])
    store.getState().setRecursiveBackgrounds(true)
    store.getState().setSelectedPreviewPresetId('preset-default')

    expect(store.getState()).toMatchObject({
      backgroundFolders: ['D:/bg'],
      recursiveBackgrounds: true,
      selectedPreviewPresetId: 'preset-default',
    })
  })

  it('truncates forward preview history when a new random background is pushed after going back', () => {
    const store = createCompositeV2Store()

    store.setState({
      previewHistory: ['D:/bg/a.jpg', 'D:/bg/b.jpg', 'D:/bg/c.jpg'],
      previewHistoryIndex: 2,
    })

    store.getState().previousPreviewBackground()
    store.getState().pushPreviewBackground('D:/bg/d.jpg')

    expect(store.getState().previewHistory).toEqual(['D:/bg/a.jpg', 'D:/bg/b.jpg', 'D:/bg/d.jpg'])
    expect(store.getState().previewHistoryIndex).toBe(2)
  })

  it('keeps previous and next preview navigation inside the visited range', () => {
    const store = createCompositeV2Store()

    store.setState({
      previewHistory: ['D:/bg/a.jpg', 'D:/bg/b.jpg'],
      previewHistoryIndex: 0,
    })

    store.getState().previousPreviewBackground()
    expect(store.getState().previewHistoryIndex).toBe(0)

    store.getState().nextPreviewBackground()
    expect(store.getState().previewHistoryIndex).toBe(1)

    store.getState().nextPreviewBackground()
    expect(store.getState().previewHistoryIndex).toBe(1)
  })

  it('updates a preset immutably and refreshes updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    vi.spyOn(Date, 'now').mockReturnValue(99)

    store.setState({ presets: [preset] })
    const previousPreset = store.getState().presets[0]

    store.getState().updatePreset(preset.id, { name: 'Preset A Updated', sampleBackgroundPath: 'D:/sample.jpg' })

    expect(store.getState().presets[0]).toMatchObject({
      id: preset.id,
      name: 'Preset A Updated',
      sampleBackgroundPath: 'D:/sample.jpg',
      updatedAt: 99,
    })
    expect(store.getState().presets[0]).not.toBe(previousPreset)
  })

  it('adds a text layer to the target preset and stamps updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    vi.spyOn(Date, 'now').mockReturnValue(123)

    store.setState({ presets: [preset] })
    store.getState().addTextLayer(preset.id)

    const layer = store.getState().presets[0]?.layers[0] as CompositeV2TextLayer | undefined
    expect(layer).toMatchObject({
      type: 'text',
      name: 'Text Layer',
      text: 'New Text',
      color: '#000000',
      padding: 5,
      shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
      stroke: { enabled: false, color: '#111827', width: 0 },
    })
    expect(layer!.position.width).toBeGreaterThan(0)
    expect(layer!.position.height).toBeGreaterThan(0)
    expect(layer!.position.mode).toBe('free')
    if (layer!.position.mode !== 'free') throw new Error('Expected text layer position to use free mode')
    expect(Math.abs(layer!.position.x + layer!.position.width / 2 - preset.baseCanvas.width / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(layer!.position.y + layer!.position.height / 2 - preset.baseCanvas.height / 2)).toBeLessThanOrEqual(
      1,
    )
    expect(store.getState().presets[0]?.updatedAt).toBe(123)
  })

  it('adds an image layer with the provided asset and stamps updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    vi.spyOn(Date, 'now').mockReturnValue(456)

    store.setState({ presets: [preset] })
    store.getState().addImageLayer(preset.id, { kind: 'path', path: 'D:/logos/logo.png' })

    const layer = store.getState().presets[0]?.layers[0] as CompositeV2ImageLayer | undefined
    expect(layer).toMatchObject({
      type: 'image',
      name: 'Image Layer',
      asset: { kind: 'path', path: 'D:/logos/logo.png' },
      position: {
        mode: 'free',
        x: Math.round((preset.baseCanvas.width - 240) / 2),
        y: Math.round((preset.baseCanvas.height - 120) / 2),
        width: 240,
        height: 120,
      },
      shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
      stroke: { enabled: false, color: '#111827', width: 0 },
    })
    expect(store.getState().presets[0]?.updatedAt).toBe(456)
  })

  it('creates a LOGO layer without changing an ordinary image layer', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    store.setState({ presets: [preset] })
    store.getState().addImageLayer(preset.id, { kind: 'path', path: 'D:/images/photo.png' })

    const logoId = store.getState().replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/logo-a.png' })
    const layers = store.getState().presets[0]!.layers

    expect(layers).toHaveLength(2)
    expect(layers[0]).toMatchObject({
      type: 'image',
      asset: { kind: 'path', path: 'D:/images/photo.png' },
    })
    expect(layers[1]).toMatchObject({
      id: logoId,
      type: 'logo',
      name: 'LOGO Layer',
      asset: { kind: 'path', path: 'D:/logos/logo-a.png' },
      stroke: { enabled: false, color: '#111827', width: 0 },
    })
  })

  it('replaces the selected LOGO first and otherwise the first LOGO', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    store.setState({ presets: [preset] })
    const firstLogoId = store.getState().replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/first.png' })
    const secondLogoId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/second.png' }, 'missing-layer')

    expect(secondLogoId).toBe(firstLogoId)
    expect(store.getState().presets[0]!.layers[0]).toMatchObject({
      id: firstLogoId,
      asset: { kind: 'path', path: 'D:/logos/second.png' },
    })

    const firstLogo = store.getState().presets[0]!.layers[0]!
    expect(firstLogo.type).toBe('logo')
    if (firstLogo.type !== 'logo') throw new Error('Expected a LOGO layer')
    store.getState().presets[0]!.layers.push({
      ...firstLogo,
      id: 'logo-selected',
      asset: { kind: 'path', path: 'D:/logos/selected-old.png' },
    })
    const selectedId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'path', path: 'D:/logos/selected-new.png' }, 'logo-selected')

    expect(selectedId).toBe('logo-selected')
    expect(store.getState().presets[0]!.layers[1]).toMatchObject({
      id: 'logo-selected',
      asset: { kind: 'path', path: 'D:/logos/selected-new.png' },
    })
  })

  it('creates, duplicates and deletes presets without any grouping side effect', () => {
    const store = createCompositeV2Store()
    store.getState().createPreset('Campaign', 'product-a')
    const created = store.getState().presets.find((preset) => preset.name === 'Campaign')
    expect(created).toBeTruthy()
    // 归属随「当前产品」一起落库：不落的话它会掉进「未分配」区，在当前产品的库里根本看不见
    expect(created!.productId).toBe('product-a')

    store.getState().duplicatePreset(created!.id)
    // 副本沿用原份的归属：否则「复制一套改改」会把它变成未分配、从本产品的库里消失
    expect(store.getState().presets.find((preset) => preset.name === 'Campaign 副本')?.productId).toBe('product-a')

    store.getState().deletePreset(created!.id)
    expect(store.getState().presets.some((preset) => preset.id === created!.id)).toBe(false)
  })

  it('⭐ 改归属不动内容，也不给未分配的预设乱指派', () => {
    const store = createCompositeV2Store()
    store.getState().createPreset('Campaign', 'product-a')
    const created = store.getState().presets.find((preset) => preset.name === 'Campaign')!
    const before = store.getState().presets.map((preset) => preset.updatedAt)

    store.getState().assignPresetProduct(created.id, 'product-b')

    expect(store.getState().presets.find((preset) => preset.id === created.id)?.productId).toBe('product-b')
    // `updatedAt` 记的是「水印内容什么时候改的」，改归属不该算进去
    expect(store.getState().presets.map((preset) => preset.updatedAt)).toEqual(before)

    // 没点名的预设一个都不动
    store.getState().assignPresetsToProduct([created.id], 'product-c')
    expect(store.getState().presets.find((preset) => preset.id === created.id)?.productId).toBe('product-c')
    expect(store.getState().presets.find((preset) => preset.id === 'preset-default')?.productId).toBe('')
  })

  it('⭐ 跨产品复制：新 id、改归属、内容整套带走，且不动当前编辑对象', () => {
    const store = createCompositeV2Store()
    store.getState().createPreset('Campaign', 'product-a')
    const source = store.getState().presets.find((preset) => preset.name === 'Campaign')!
    const selectionBefore = store.getState().selectedPreviewPresetId

    store.getState().copyPresetsToProduct([source.id], 'product-b')

    const copy = store.getState().presets.find((preset) => preset.productId === 'product-b')!
    expect(copy).toBeTruthy()
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Campaign 副本')
    expect(copy.baseCanvas).toEqual(source.baseCanvas)
    expect(copy.layers).toEqual(source.layers)
    // 源份一个字段都不该被改：用户改副本时原水印要原样留着
    expect(store.getState().presets.find((preset) => preset.id === source.id)).toMatchObject({
      name: 'Campaign',
      productId: 'product-a',
    })
    // 画布只在**当前产品**的库里找预设，把选中态指到副本上会让画布切到一套左栏不列的预设
    expect(store.getState().selectedPreviewPresetId).toBe(selectionBefore)
  })

  it('跨产品复制：同产品/空目标不产生副本', () => {
    const store = createCompositeV2Store()
    store.getState().createPreset('Campaign', 'product-a')
    const source = store.getState().presets.find((preset) => preset.name === 'Campaign')!
    const countBefore = store.getState().presets.length

    store.getState().copyPresetsToProduct([source.id], 'product-a')
    store.getState().copyPresetsToProduct([source.id], '')
    store.getState().copyPresetsToProduct(['不存在'], 'product-b')

    expect(store.getState().presets).toHaveLength(countBefore)
  })

  it('updates the global fit mode', () => {
    const store = createCompositeV2Store()
    store.getState().setGlobalFitMode('contain-blur')
    expect(store.getState().globalFitMode).toBe('contain-blur')
  })

  it('migrates a snapshot without an identifier to the disabled default', () => {
    // 升级后已配好的水印渲染结果必须不变：默认空文本 = 不附加
    const migrated = migrateCompositeV2PersistedState({ presets: [createDefaultCompositeV2Preset(1)] }, 5)
    expect(migrated.identifier).toEqual({ text: '', placement: 'suffix' })
  })

  it('keeps a persisted identifier and lets one edit cover every preset', () => {
    const store = createCompositeV2Store()
    store.getState().setIdentifier({ text: '@小王', placement: 'both' })
    expect(store.getState().identifier).toEqual({ text: '@小王', placement: 'both' })
    // 预设本身一个都没动：标识符是渲染时叠加的，不是逐预设写盘
    expect(store.getState().presets.every((preset) => preset.updatedAt <= Date.now())).toBe(true)
    store.getState().undo()
    expect(store.getState().identifier).toEqual({ text: '', placement: 'suffix' })
  })

  it('merges imported presets in place for known ids and appends new ones', () => {
    const store = createCompositeV2Store()
    const first = store.getState().presets[0]!
    store.getState().createPreset('第二个', 'product-a')
    const before = store.getState().presets.map((preset) => preset.id)

    store.getState().mergeImportedPresets([
      { ...first, name: '覆盖后的名字' },
      { ...first, id: 'brand-new', name: '全新的' },
    ])

    // 覆盖留在原位（顺序即归属里的产出顺序），新增追加在末尾
    expect(store.getState().presets[0]?.name).toBe('覆盖后的名字')
    expect(store.getState().presets.map((preset) => preset.id)).toEqual([...before, 'brand-new'])
  })
})

/** 带素材的图片/LOGO 图层字面量（只填断言用得上的字段，其余走默认）。 */
function mediaLayerFixture(id: string, asset: CompositeV2ImageLayer['asset']): CompositeV2ImageLayer {
  return {
    id,
    type: 'image',
    name: 'Image Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { mode: 'free', x: 0, y: 0, width: 240, height: 120 },
    shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
    asset,
    radius: 0,
    clip: false,
  }
}

/*
 * 2026-10-12 报障：「LOGO 图层只有正方形的，矩形 LOGO 会被压缩拉伸」。
 * 根因之一是 LOGO 图层的框被写死成 100×100，换素材时又只动 asset、不动 position。
 */
describe('LOGO 图层按素材原图比例设框（2026-10-12 报障）', () => {
  function presetWithLogoLayer() {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    store.setState({ presets: [preset] })
    return { store, preset }
  }

  it('⭐ 矩形素材：长边贴 100，短边等比缩 —— 不再是 100×100 的正方框', () => {
    const { store, preset } = presetWithLogoLayer()

    const layerId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'stored', assetId: 'asset-1', name: '京东保LOGO' }, undefined, {
        width: 300,
        height: 100,
      })

    const logo = store.getState().presets[0]!.layers.find((layer) => layer.id === layerId)!
    expect(logo.position.width).toBe(100)
    expect(logo.position.height).toBe(33)
    expect(logo.position.width / logo.position.height).toBeCloseTo(3, 1)
  })

  it('竖版素材：高是长边，宽按比例缩', () => {
    const { store, preset } = presetWithLogoLayer()

    const layerId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'stored', assetId: 'asset-2' }, undefined, {
        width: 100,
        height: 400,
      })

    const logo = store.getState().presets[0]!.layers.find((layer) => layer.id === layerId)!
    expect(logo.position.height).toBe(100)
    expect(logo.position.width).toBe(25)
  })

  it('不给素材尺寸时保持正方形（空白 LOGO 图层没有比例可依，不猜一个）', () => {
    const { store, preset } = presetWithLogoLayer()

    const layerId = store.getState().replaceOrAddLogoLayer(preset.id, { kind: 'stored', assetId: 'asset-3' })

    const logo = store.getState().presets[0]!.layers.find((layer) => layer.id === layerId)!
    expect(logo.position.width).toBe(100)
    expect(logo.position.height).toBe(100)
  })

  it('替换已有 LOGO：锚点与边距保留，只换素材与框尺寸', () => {
    const { store, preset } = presetWithLogoLayer()
    const firstId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'stored', assetId: 'asset-old' }, undefined, {
        width: 100,
        height: 100,
      })

    const secondId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'stored', assetId: 'asset-new' }, undefined, {
        width: 200,
        height: 100,
      })

    expect(secondId).toBe(firstId)
    const logo = store.getState().presets[0]!.layers[0]!
    expect(logo).toMatchObject({ type: 'logo', asset: { kind: 'stored', assetId: 'asset-new' } })
    expect(logo.position.width / logo.position.height).toBeCloseTo(2, 1)
    if (logo.position.mode !== 'anchor') throw new Error('Expected an anchor position')
    expect(logo.position.anchor).toBe('top-left')
    expect(logo.position.marginX).toBe(20)
  })

  it('尺寸非法（0 / NaN）退回正方形，不把框算成 0', () => {
    const { store, preset } = presetWithLogoLayer()

    const layerId = store
      .getState()
      .replaceOrAddLogoLayer(preset.id, { kind: 'stored', assetId: 'asset-4' }, undefined, {
        width: 0,
        height: 0,
      })

    const logo = store.getState().presets[0]!.layers.find((layer) => layer.id === layerId)!
    expect(logo.position.width).toBe(100)
    expect(logo.position.height).toBe(100)
  })
})

/*
 * 收编：老预设里 `{ kind: 'path' }` 的素材被读到之后，就地换成程序内的 `stored`。
 * 它是**渲染时顺手做的**，所以绝不能产生用户可见的副作用（撤销栈、内容修订号）。
 */
describe('adoptLayerAsset —— 老 path 素材收编（2026-10-12）', () => {
  it('⭐ 只换素材引用：不动 updatedAt、不进撤销栈', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    store.setState({
      presets: [
        { ...preset, layers: [mediaLayerFixture('image-layer-x', { kind: 'path', path: 'D:/素材/角标.png' })] },
      ],
    })
    const updatedAtBefore = store.getState().presets[0]!.updatedAt
    const canUndoBefore = store.getState().canUndo

    store
      .getState()
      .adoptLayerAsset(preset.id, 'image-layer-x', { kind: 'stored', assetId: 'asset-1', name: '角标.png' })

    expect(store.getState().presets[0]!.layers[0]).toMatchObject({
      asset: { kind: 'stored', assetId: 'asset-1', name: '角标.png' },
    })
    // 画面一个字都没变：动了 updatedAt 会让覆盖层缓存整批失效
    expect(store.getState().presets[0]!.updatedAt).toBe(updatedAtBefore)
    // 用户没做这个动作，不该能「撤」它
    expect(store.getState().canUndo).toBe(canUndoBefore)
  })

  it('图层 id 找不到时不产生任何改动（返回同一份 presets 引用）', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    store.setState({ presets: [{ ...preset, layers: [mediaLayerFixture('image-layer-x', null)] }] })
    const before = store.getState().presets

    store.getState().adoptLayerAsset(preset.id, 'missing-layer', { kind: 'stored', assetId: 'asset-1' })

    expect(store.getState().presets).toBe(before)
  })
})
