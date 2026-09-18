import { describe, expect, it } from 'vitest'
import {
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
  createDefaultCompositeV2State,
} from './compositeV2Defaults'

describe('composite v2 defaults', () => {
  it('creates a default preset that carries watermark data only', () => {
    expect(createDefaultCompositeV2Preset(1)).toEqual({
      id: 'preset-default',
      name: '默认产品预设',
      baseCanvas: { width: 1280, height: 720 },
      sampleBackgroundPath: '',
      layers: [],
      updatedAt: 1,
    })
  })

  it('creates a default state with a preset group pointing at the default preset', () => {
    const state = createDefaultCompositeV2State()

    expect(state.presets.map((preset) => preset.id)).toEqual(['preset-default'])
    expect(state.presetGroups).toEqual([
      {
        id: 'group-default',
        name: '默认预设组',
        presetIds: ['preset-default'],
        updatedAt: state.presetGroups[0]!.updatedAt,
      },
    ])
    expect(state.globalFitMode).toBe('crop-fill')
  })

  it('keeps the default state limited to the watermark editing slices', () => {
    // 守门断言：A 套编排的切片（导出任务/队列/历史/分发配置/输出规则/自定义变量）
    // 已随编排统一到 features/postprocess 而移除。谁把它们加回来，这里立刻变红——
    // 那意味着「同一件事又有两个来源」，正是这次收敛要消灭的东西。
    expect(Object.keys(createDefaultCompositeV2State()).sort()).toEqual([
      'globalFitMode',
      'logoLibraryPath',
      'logoOrder',
      'presetGroups',
      'presets',
      'projectLogos',
    ])
  })

  it('creates a preset group with the given timestamp', () => {
    expect(createDefaultCompositeV2PresetGroup(7)).toEqual({
      id: 'group-default',
      name: '默认预设组',
      presetIds: ['preset-default'],
      updatedAt: 7,
    })
  })
})
