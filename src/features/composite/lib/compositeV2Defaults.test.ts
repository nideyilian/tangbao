import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2State } from './compositeV2Defaults'

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

  it('creates a default state carrying the default preset, without any grouping shell', () => {
    const state = createDefaultCompositeV2State()

    expect(state.presets.map((preset) => preset.id)).toEqual(['preset-default'])
    expect(state.globalFitMode).toBe('crop-fill')
    // 预设组退役：分组交给项目树，默认状态里不该再有第二套分组结构
    expect('presetGroups' in state).toBe(false)
  })

  it('keeps the default state limited to the watermark editing slices', () => {
    // 守门断言：A 套编排的切片（导出任务/队列/历史/分发配置/输出规则/自定义变量）
    // 已随编排统一到 features/postprocess 而移除，预设组也随分组收敛到项目树而移除。
    // 谁把它们加回来，这里立刻变红——那意味着「同一件事又有两个来源」，正是这次收敛要消灭的东西。
    expect(Object.keys(createDefaultCompositeV2State()).sort()).toEqual([
      'globalFitMode',
      'logoLibraryPath',
      'logoOrder',
      'presets',
      'projectLogos',
    ])
  })
})
