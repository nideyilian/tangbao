/**
 * 「水印预设 ↔ 项目树节点」绑定的纯函数。
 *
 * 绑定的落点**不是水印自己的 store**，而是项目树参数层
 * （`ProjectNodeOverride.watermarkPresetIds`，见 `features/projectTree`）。
 * 水印工作区只是这份数据的一个编辑入口，与节点「参数」弹窗里那排勾选框读写同一份值——
 * 同一个参数不能有两个来源，所以这里只做数组运算，不引入第二处存储。
 *
 * 语义要点：`undefined` 是「不表态、继续继承」，`[]` 是**显式**「这个方向不加水印」。
 * 因此「在继承态下摘掉一个水印」必须先物化成显式数组（把继承来的那份复制下来再删），
 * 直接写 `[]` 会把「少一个」错表达成「一个都不要」。
 */

import type { CompositeV2Preset } from './compositeV2Types'

/** 追加绑定（保序：数组顺序即产出顺序）。已存在时不重复追加。 */
export function bindPresetToNode(current: string[], presetId: string): string[] {
  const id = presetId.trim()
  if (!id || current.includes(id)) return current
  return [...current, id]
}

/** 解绑一个预设，保持其余顺序。 */
export function unbindPresetFromNode(current: string[], presetId: string): string[] {
  const id = presetId.trim()
  if (!id || !current.includes(id)) return current
  return current.filter((item) => item !== id)
}

export interface BoundPresetSummary {
  /** 能对上号的预设，顺序与绑定顺序一致 */
  presets: CompositeV2Preset[]
  /** 绑了但这个预设已经不存在了（被删）——要提示，不能静默少显示一个 */
  missingIds: string[]
}

/**
 * 把绑定的 id 列表解析成可渲染的预设。
 *
 * 已删除的预设 id 单独列出来而不是丢弃：绑定值是跟着节点参数走的，预设被删时
 * 不会有人去清理它（参数层刻意不管「预设是否还存在」）。不提示的话，用户会看到
 * 「这个方向说绑了 3 个，界面上只有 2 个」，且找不到原因。
 */
export function summarizeBoundPresets(presetIds: string[], presets: CompositeV2Preset[]): BoundPresetSummary {
  const byId = new Map(presets.map((preset) => [preset.id, preset]))
  const found: CompositeV2Preset[] = []
  const missingIds: string[] = []
  for (const id of presetIds) {
    const preset = byId.get(id)
    if (preset) found.push(preset)
    else missingIds.push(id)
  }
  return { presets: found, missingIds }
}
