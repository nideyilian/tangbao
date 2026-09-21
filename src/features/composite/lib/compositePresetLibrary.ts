import type { CompositeV2Preset } from './compositeV2Types'

/**
 * 拖拽 MIME 类型。
 *
 * ⚠️ **2026-09-21 起没有使用者**：原先的拖出方（水印库）改成了「库行勾选开关」，
 * 拖入方（水印归属树 `PresetProjectTree`）整栏退役 —— 归属改看中控台左边那棵项目树。
 *
 * 留着不删的理由：绑定的动作本身没变，只是换了入口；「把库里这套直接拖到左边树上」
 * 仍是最顺手的交互，恢复时不必重写载荷编解码与它的边界用例。
 * 真要恢复，拖出方与拖入方**必须共用这一份字面量** —— 各写一份的话拖过去不认，
 * 现象是「拖了没反应」这种最难查的静默失败。
 */
export const PRESET_LIBRARY_DRAG_TYPE = 'application/x-tangbao-library-preset'

/**
 * 拖拽载荷编解码。
 *
 * 载荷是 **id 数组**而不是单个 id：库里多选之后拖进树里要能一次绑好几个，
 * 而「一次绑一组」正是原先「预设组」唯一不可替代的能力——组退役后由它承接。
 * （多选这个入口随归属树一起下线了，但形状保持数组：改成单 id 只会让恢复时再改一遍，
 *   而数组形式天然兼容单 id。）
 *
 * `parse` 兼容裸 id：拖拽虽然只在本进程内用，但早期版本的单 id 载荷、
 * 以及外部拖进来的普通文本都会落到同一个 MIME 上，解析不能假设一定是 JSON。
 */
export function serializePresetDragPayload(presetIds: string[]): string {
  return JSON.stringify(presetIds.filter((id) => id.trim() !== ''))
}

export function parsePresetDragPayload(raw: string): string[] {
  const text = raw.trim()
  if (!text) return []
  // 对象形状的 JSON 直接当坏载荷丢掉：它不是数组、也不可能是预设 id，
  // 而下面的「裸 id」兼容分支会把它原样当成一个 id 传下去，变成一次查不到预设的静默绑定。
  if (text.startsWith('{')) return []
  if (!text.startsWith('[')) return [text]
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  } catch {
    return []
  }
}

/**
 * 按名称搜索。
 *
 * 分组维度随「预设组」一并退役：层级归项目树，这里只负责「找得到」。
 * 顺带修掉一个旧问题——原实现无论有没有搜索词都按 `updatedAt` 重排，
 * 于是「每次编辑完一个预设，它在列表里就跳一次位」，用户刚记住的位置会跑掉。
 * 现在无搜索词时保持传入顺序（即预设的创建/维护顺序），稳定不动。
 */
export function filterPresetsByQuery(presets: CompositeV2Preset[], query: string | undefined): CompositeV2Preset[] {
  const keyword = query?.trim().toLowerCase()
  if (!keyword) return presets
  return presets.filter((preset) => preset.name.toLowerCase().includes(keyword))
}
