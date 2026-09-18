import type { CompositeV2Preset, CompositeV2PresetGroup, CompositeV2State } from './compositeV2Types'

export function createDefaultCompositeV2Preset(now = Date.now()): CompositeV2Preset {
  return {
    id: 'preset-default',
    name: '默认产品预设',
    baseCanvas: { width: 1280, height: 720 },
    sampleBackgroundPath: '',
    layers: [],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2PresetGroup(now = Date.now()): CompositeV2PresetGroup {
  return {
    id: 'group-default',
    name: '默认预设组',
    presetIds: ['preset-default'],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2State(now = Date.now()): CompositeV2State {
  return {
    logoLibraryPath: '',
    logoOrder: [],
    projectLogos: [],
    presets: [createDefaultCompositeV2Preset(now)],
    presetGroups: [createDefaultCompositeV2PresetGroup(now)],
    globalFitMode: 'crop-fill',
  }
}
