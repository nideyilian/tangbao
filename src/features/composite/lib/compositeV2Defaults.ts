import type { CompositeV2Preset, CompositeV2State } from './compositeV2Types'

/**
 * 出厂唯一预设。
 *
 * 这里曾经还有一个 `createDefaultCompositeV2PresetGroup()`（「默认预设组」）。
 * 分组概念随「预设组」一起退役了——层级归项目树，预设不再需要自己的分组壳。
 * 预设本身（id/画布/图层）原样保留，用户的水印工作不会丢。
 */
export function createDefaultCompositeV2Preset(now = Date.now()): CompositeV2Preset {
  return {
    id: 'preset-default',
    name: '默认产品预设',
    // 出厂预设不预设产品：水印库按产品隔离，这一套会落在「未分配」区，
    // 用户在左侧选一个产品后一键归过去即可（新建产品时不去猜他想要哪个产品）。
    productId: '',
    baseCanvas: { width: 1280, height: 720 },
    sampleBackgroundPath: '',
    layers: [],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2State(now = Date.now()): CompositeV2State {
  return {
    logoLibraryPath: '',
    logoOrder: [],
    projectLogos: [],
    presets: [createDefaultCompositeV2Preset(now)],
    globalFitMode: 'crop-fill',
  }
}
