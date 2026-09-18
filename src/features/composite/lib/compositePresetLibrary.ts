import type { CompositeV2Preset, CompositeV2PresetGroup } from './compositeV2Types'

/**
 * 拖拽 MIME 类型。
 *
 * 放在这里而不是各自组件里定义：预设库（`PresetManagementTab`）是拖出方，
 * 预设组与项目树（`PresetProjectTree`）都是拖入方，三处必须是同一份字面量，
 * 否则拖过去不认，且现象是「拖了没反应」这种最难查的静默失败。
 */
export const PRESET_GROUP_DRAG_TYPE = 'application/x-tangbao-preset-group'
export const PRESET_LIBRARY_DRAG_TYPE = 'application/x-tangbao-library-preset'

export function addPresetToGroup(group: CompositeV2PresetGroup, presetId: string): CompositeV2PresetGroup {
  if (group.presetIds.includes(presetId)) return group
  return { ...group, presetIds: [...group.presetIds, presetId], updatedAt: Date.now() }
}

export function movePresetInGroup(
  group: CompositeV2PresetGroup,
  presetId: string,
  targetIndex: number,
): CompositeV2PresetGroup {
  const currentIndex = group.presetIds.indexOf(presetId)
  if (currentIndex < 0) return group

  const presetIds = [...group.presetIds]
  const [item] = presetIds.splice(currentIndex, 1)
  presetIds.splice(Math.max(0, Math.min(targetIndex, presetIds.length)), 0, item)

  return { ...group, presetIds, updatedAt: Date.now() }
}

export function duplicatePresetIntoGroup(
  presets: CompositeV2Preset[],
  group: CompositeV2PresetGroup,
  sourcePresetId: string,
  newPresetId: string,
  now = Date.now(),
): { presets: CompositeV2Preset[]; group: CompositeV2PresetGroup } {
  const source = presets.find((preset) => preset.id === sourcePresetId)
  if (!source) return { presets, group }
  if (presets.some((preset) => preset.id === newPresetId) || group.presetIds.includes(newPresetId)) {
    return { presets, group }
  }

  const copy: CompositeV2Preset = {
    ...structuredClone(source),
    id: newPresetId,
    name: `${source.name} 副本`,
    updatedAt: now,
  }

  return {
    presets: [...presets, copy],
    group: { ...group, presetIds: [...group.presetIds, copy.id], updatedAt: now },
  }
}

export function filterPresetsForLibrary(
  presets: CompositeV2Preset[],
  groups: CompositeV2PresetGroup[],
  filters: { query?: string; groupId?: string },
): CompositeV2Preset[] {
  const query = filters.query?.trim().toLowerCase()
  const group = filters.groupId ? groups.find((item) => item.id === filters.groupId) : null

  let result = presets.filter((preset) => !query || preset.name.toLowerCase().includes(query))

  if (group) {
    result = result.filter((preset) => group.presetIds.includes(preset.id))
    if (!query) {
      // Sort by the order in group.presetIds
      result.sort((a, b) => {
        const indexA = group.presetIds.indexOf(a.id)
        const indexB = group.presetIds.indexOf(b.id)
        return indexA - indexB
      })
      return result
    }
  }

  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}
