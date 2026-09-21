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

/**
 * 产品 id 归一化：只认去空白后的非空字符串，其余（`undefined` / `null` / 数字 / 空白）一律算**未分配**。
 *
 * 迁移、store 写入、界面过滤三处共用这一份 —— 各写一遍的话，某处把 `"   "` 当成了产品 id，
 * 那套水印就会既不属于任何产品的库、又不在「未分配」区，谁都看不见也删不掉。
 */
export function normalizePresetProductId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 取某个产品的库。
 *
 * `productId` 为空串时**返回空数组**而不是「全部」：未分配的预设不属于任何产品，
 * 「没选产品」这个状态有自己的界面（提示先选产品），拿它当通配会让隔离形同虚设 ——
 * 选到产品线层就能看见所有产品的水印，正是这次要治的问题。
 */
export function filterPresetsByProduct(presets: CompositeV2Preset[], productId: string): CompositeV2Preset[] {
  const id = normalizePresetProductId(productId)
  if (!id) return []
  return presets.filter((preset) => normalizePresetProductId(preset.productId) === id)
}

/** 取出全部未分配的预设（老数据第一次升级后、或用户主动摘出来的那些）。 */
export function filterUnassignedPresets(presets: CompositeV2Preset[]): CompositeV2Preset[] {
  return presets.filter((preset) => normalizePresetProductId(preset.productId) === '')
}

/**
 * 复制出来的水印叫什么：默认「XX 副本」，目标产品里已有同名就退到「XX 副本 2」「XX 副本 3」…
 *
 * **只与目标产品的现有名字比对**：水印库已按产品隔离，重名只可能撞在落地的那一侧；
 * 拿全量名字比会把源产品里的「XX 副本」也算进来，用户会莫名其妙拿到一个「XX 副本 2」。
 */
export function buildCopiedPresetName(sourceName: string, takenNames: Iterable<string>, suffix = '副本'): string {
  const base = `${sourceName} ${suffix}`
  const taken = new Set(takenNames)
  if (!taken.has(base)) return base
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base} ${index}`
    if (!taken.has(candidate)) return candidate
  }
  // 极端兜底：同一个名字被占满 999 次。加时间戳保证不重名，优先级低于「名字好看」。
  return `${base} ${Date.now()}`
}

export interface PlanPresetCopyInput {
  /** 现有全部预设（扁平数组，跨产品） */
  presets: CompositeV2Preset[]
  /** 要复制的源水印 id（顺序即落地顺序；重复 id 只算一次） */
  presetIds: string[]
  /** 落地到哪个产品；空串 = 未分配（不是合法目标，直接不复制） */
  targetProductId: string
  /** id 工厂：传进来而不是内部生成，纯函数才好测 */
  makeId: () => string
  now: number
}

/**
 * 规划「把这些水印复制到目标产品」要**新增**的预设（纯函数，不落库、不改入参）。
 *
 * 复制的是整套水印：画布尺寸、图层（含图片 / LOGO 的资产引用）、适配方式全都带过去 ——
 * 这是用户说「复制」时的全部预期，少带一样都要在目标产品里重配一遍。
 *
 * 三条刻意的口径：
 * - **图片 / LOGO 只沿用引用，不复制资产**：同一台机器上的 blob 是共享的，复制它既慢又占空间；
 *   引用计数（`isCompositeAssetReferenced`）已经保证「删源水印不会把副本弄成没图」。
 * - **id 一定换新**：沿用源 id 会把两个产品的库指向同一套水印，改一个另一个跟着变 ——
 *   那就不是复制而是「共用」，正是按产品隔离要治的问题。
 * - **不改归属引用**：复制出来的水印**不自动被任何方向勾选**。自动勾上等于「复制一下」
 *   就静默改了产出结果，用户以为只是留个底稿。
 */
export function planPresetCopies(input: PlanPresetCopyInput): CompositeV2Preset[] {
  const target = normalizePresetProductId(input.targetProductId)
  if (!target) return []

  const byId = new Map(input.presets.map((preset) => [preset.id, preset]))
  const taken = input.presets
    .filter((preset) => normalizePresetProductId(preset.productId) === target)
    .map((preset) => preset.name)
  const copies: CompositeV2Preset[] = []
  const seen = new Set<string>()

  for (const presetId of input.presetIds) {
    if (seen.has(presetId)) continue
    seen.add(presetId)
    const source = byId.get(presetId)
    if (!source) continue
    // 同产品内复制 = 原地再建一套，用户要的是「搬到另一个产品」；界面也不会给出这个选项
    if (normalizePresetProductId(source.productId) === target) continue
    const name = buildCopiedPresetName(source.name, taken)
    taken.push(name)
    copies.push({
      ...structuredClone(source),
      id: input.makeId(),
      name,
      productId: target,
      updatedAt: input.now,
    })
  }
  return copies
}
