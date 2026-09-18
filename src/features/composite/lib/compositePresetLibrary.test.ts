import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './compositeV2Defaults'
import {
  addPresetToGroup,
  duplicatePresetIntoGroup,
  filterPresetsForLibrary,
  movePresetInGroup,
} from './compositePresetLibrary'

import type { CompositeV2Preset, CompositeV2TextLayer } from './compositeV2Types'

describe('composite preset library', () => {
  it('adds a global preset reference to a group once', () => {
    const group = createDefaultCompositeV2PresetGroup(1)
    expect(addPresetToGroup(group, 'preset-default').presetIds).toEqual(['preset-default'])
    expect(addPresetToGroup(group, 'preset-2').presetIds).toEqual(['preset-default', 'preset-2'])
  })

  it('duplicates a global preset and adds the copy to the current group', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const group = createDefaultCompositeV2PresetGroup(1)

    const result = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 2)

    expect(result.presets).toHaveLength(2)
    expect(result.presets[1]).toMatchObject({ id: 'preset-copy', name: `${preset.name} \u526f\u672c`, updatedAt: 2 })
    expect(result.presets[1]).not.toBe(preset)
    expect(result.group.presetIds).toEqual(['preset-default', 'preset-copy'])
  })

  it('does not duplicate when the new preset id already exists', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const existingPreset = { ...createDefaultCompositeV2Preset(2), id: 'preset-copy' }
    const presets = [preset, existingPreset]
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['preset-default', 'preset-copy'] }

    const globalDuplicate = duplicatePresetIntoGroup(
      presets,
      createDefaultCompositeV2PresetGroup(1),
      preset.id,
      'preset-copy',
      3,
    )
    const groupDuplicate = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 3)

    expect(globalDuplicate.presets).toBe(presets)
    expect(globalDuplicate.group.presetIds).toEqual(['preset-default'])
    expect(groupDuplicate.presets).toEqual([preset])
    expect(groupDuplicate.group).toBe(group)
    expect(groupDuplicate.group.presetIds).toEqual(['preset-default', 'preset-copy'])
  })

  it('duplicates nested preset data without sharing source references', () => {
    const layer: CompositeV2TextLayer = {
      id: 'layer-1',
      type: 'text',
      name: 'source layer',
      visible: true,
      locked: false,
      opacity: 1,
      rotation: 0,
      position: { mode: 'free', x: 0, y: 0, width: 100, height: 50 },
      shadow: { enabled: false, color: '#000000', x: 0, y: 0, blur: 0, opacity: 0 },
      text: 'source text',
      fontFamily: 'sans-serif',
      fontSize: 24,
      fontWeight: 400,
      color: '#000000',
      align: 'center',
      lineHeight: 1,
      letterSpacing: 0,
      padding: 0,
    }
    const preset: CompositeV2Preset = {
      ...createDefaultCompositeV2Preset(1),
      id: 'preset-original',
      layers: [layer],
    }
    const group = createDefaultCompositeV2PresetGroup(1)

    const result = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 2)
    const copied = result.presets[1]!.layers[0] as CompositeV2TextLayer
    copied.name = 'copy layer'
    copied.position.width = 999

    expect((preset.layers[0] as CompositeV2TextLayer).name).toBe('source layer')
    expect(preset.layers[0]!.position.width).toBe(100)
    expect(result.presets[1]!.layers).not.toBe(preset.layers)
    expect(result.presets[1]!.layers[0]).not.toBe(preset.layers[0])
  })

  it('reorders group preset ids', () => {
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b', 'c'] }
    expect(movePresetInGroup(group, 'c', 0).presetIds).toEqual(['c', 'a', 'b'])
  })

  it('clamps moved preset indexes to group bounds', () => {
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b', 'c'] }

    expect(movePresetInGroup(group, 'c', -1).presetIds).toEqual(['c', 'a', 'b'])
    expect(movePresetInGroup(group, 'a', 99).presetIds).toEqual(['b', 'c', 'a'])
  })

  it('filters presets by name and group membership', () => {
    const presets = [
      { ...createDefaultCompositeV2Preset(1), id: 'a', name: '\u767e\u5ea6\u4ea7\u54c1' },
      { ...createDefaultCompositeV2Preset(2), id: 'b', name: '\u5382\u5546\u4ea7\u54c1' },
    ]
    const groups = [{ ...createDefaultCompositeV2PresetGroup(1), id: 'g1', presetIds: ['b'] }]

    expect(
      filterPresetsForLibrary(presets, groups, { query: '\u4ea7\u54c1', groupId: 'g1' }).map((preset) => preset.id),
    ).toEqual(['b'])
  })

  it('does not mutate caller preset order when filtering', () => {
    const presets = [
      { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'a' },
      { ...createDefaultCompositeV2Preset(3), id: 'b', name: 'b' },
      { ...createDefaultCompositeV2Preset(2), id: 'c', name: 'c' },
    ]

    expect(filterPresetsForLibrary(presets, [], {}).map((preset) => preset.id)).toEqual(['b', 'c', 'a'])
    expect(presets.map((preset) => preset.id)).toEqual(['a', 'b', 'c'])
  })
})
