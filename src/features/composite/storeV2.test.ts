import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createCompositeV2Store,
  createCompositeV2StoreState,
  getCompositeV2PersistedState,
  migrateCompositeV2PersistedState,
  mergeCompositeV2PersistedState,
} from './storeV2'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './lib/compositeV2Defaults'
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

    const migrated = migrateCompositeV2PersistedState({ presets: [legacyPreset], customVariables: [] }, 3)

    expect(migrated.presets).toEqual([
      {
        id: 'preset-default',
        name: '默认产品预设',
        baseCanvas: { width: 1280, height: 720 },
        sampleBackgroundPath: '',
        layers: [],
        updatedAt: 1,
      },
    ])
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
      presetGroups: store.getState().presetGroups,
      globalFitMode: store.getState().globalFitMode,
      backgroundFolders: ['D:/bg'],
      recursiveBackgrounds: true,
      selectedPresetGroupId: store.getState().selectedPresetGroupId,
      selectedPreviewPresetId: store.getState().selectedPreviewPresetId,
    })
    expect(persisted).not.toHaveProperty('previewHistory')
    expect(persisted).not.toHaveProperty('backgrounds')
  })

  it('hydrates a coherent non-default preset group selection', () => {
    const source = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', presetIds: ['preset-a'] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', presetIds: ['preset-b'] }
    source.setState({
      presets: [presetA, presetB],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupB.id,
      selectedPreviewPresetId: presetB.id,
    })
    const persisted = JSON.parse(JSON.stringify(getCompositeV2PersistedState(source.getState())))

    const hydrated = mergeCompositeV2PersistedState(persisted, createCompositeV2Store().getState())

    expect(hydrated).toMatchObject({
      selectedPresetGroupId: 'group-b',
      selectedPreviewPresetId: 'preset-b',
    })
  })

  it('falls back to a coherent preset selection when persisted IDs are invalid', () => {
    const currentStore = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', presetIds: ['preset-a'] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', presetIds: ['preset-b'] }
    currentStore.setState({ presets: [presetA, presetB], presetGroups: [groupA, groupB] })
    const persisted = {
      ...getCompositeV2PersistedState(currentStore.getState()),
      selectedPresetGroupId: 'missing-group',
      selectedPreviewPresetId: 'missing-preset',
    }

    const hydrated = mergeCompositeV2PersistedState(JSON.parse(JSON.stringify(persisted)), currentStore.getState())

    expect(hydrated).toMatchObject({
      selectedPresetGroupId: 'group-a',
      selectedPreviewPresetId: 'preset-a',
    })
  })

  it('preserves the preview preset when switching groups', () => {
    const store = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const presetC = { ...createDefaultCompositeV2Preset(3), id: 'preset-c', name: 'Preset C' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', presetIds: ['preset-a', 'preset-b'] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', presetIds: ['preset-c', 'preset-b'] }

    store.setState({
      presets: [presetA, presetB, presetC],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
      selectedPreviewPresetId: presetB.id,
    })

    store.getState().setSelectedPresetGroup(groupB.id)

    expect(store.getState().selectedPresetGroupId).toBe(groupB.id)
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
    const group = { ...createDefaultCompositeV2PresetGroup(10), presetIds: [preset.id] }
    vi.spyOn(Date, 'now').mockReturnValue(99)

    store.setState({ presets: [preset], presetGroups: [group] })
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

  it('creates, renames, duplicates and removes preset groups', () => {
    const store = createCompositeV2Store()
    store.getState().createPresetGroup('Campaign')
    const created = store.getState().presetGroups.find((group) => group.name === 'Campaign')
    expect(created).toBeTruthy()
    store.getState().renamePresetGroup(created!.id, 'Campaign 2')
    store.getState().duplicatePresetGroup(created!.id)
    expect(store.getState().presetGroups.some((group) => group.name === 'Campaign 2 copy')).toBe(true)
    store.getState().deletePresetGroup(created!.id)
    expect(store.getState().presetGroups.some((group) => group.id === created!.id)).toBe(false)
  })

  it('moves a preset group to a new position', () => {
    const store = createCompositeV2Store()
    store.getState().createPresetGroup('Second')
    store.getState().createPresetGroup('Third')
    const [first, second, third] = store.getState().presetGroups

    store.getState().movePresetGroup(third!.id, 0)

    expect(store.getState().presetGroups.map((group) => group.id)).toEqual([third!.id, first!.id, second!.id])
  })

  it('updates the global fit mode', () => {
    const store = createCompositeV2Store()
    store.getState().setGlobalFitMode('contain-blur')
    expect(store.getState().globalFitMode).toBe('contain-blur')
  })
})
