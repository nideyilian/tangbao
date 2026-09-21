/**
 * 项目树参数的继承与归一化（纯函数，无副作用，便于单测）。
 *
 * 继承口径：**自根向叶逐级浅合并**，后出现的覆盖先出现的。
 * 方向节点没写某字段时，取它所属产品 → 产品线 → 全局默认里最近一次声明——
 * 这样「整条产品线共用一套水印」只需在产品线上配一次，而不是每个方向各配一遍。
 */

import type { AssetCollection } from '../../types'
import {
  normalizePostprocessDistributionConfig,
  type PostprocessDistributionConfig,
} from '../../lib/postprocessDistribution'
import {
  applyPostprocessOverride,
  normalizeOutputDirList,
  type PostprocessMediaConfig,
  type PostprocessMediaOverride,
  type PostprocessNodeOverride,
} from '../../lib/postprocessMedia'
// 路径解析与后处理命名模板共用同一份实现，避免「表格里的路径」和「产出文件名里的路径」出现两套口径
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import type { ProjectNodeKind, ProjectNodeParams, ProjectNodeParamsMap } from './types'

/** 由节点深度推导层级语义。 */
export function resolveProjectNodeKind(depth: number): ProjectNodeKind {
  if (depth <= 0) return 'line'
  if (depth === 1) return 'product'
  if (depth === 2) return 'direction'
  return 'extra'
}

/**
 * 节点到根的 id 链（根在前，自身在最后）。
 * 坏链 / 自环 / 环由 `resolveCollectionPath` 兜底（提前停下），这里直接透传。
 */
export function resolveProjectNodeIdChain(collections: AssetCollection[], collectionId: string): string[] {
  return resolveCollectionPath(collections, collectionId).map((item) => item.id)
}

/** 继承链上的一环：谁、在第几层、写了什么。 */
export interface ProjectOverrideChainEntry {
  collectionId: string
  /** 0 产品线 / 1 产品 / 2 方向 / 3+ 扩展层 */
  depth: number
  override: PostprocessNodeOverride
}

/**
 * 取出节点继承链上**真正写了参数**的那些环（根在前、自身在最后）。
 *
 * 抽成共用实现是因为「某个字段最终生效的是谁」这条链，全字段合并（后处理设置）与
 * 单字段查询（水印绑定）必须完全同源——两处各写一遍遍历，迟早会在
 * 「空对象算不算表态」「环怎么兜底」这类细节上分叉。
 */
export function resolveProjectOverrideChain(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  collectionId: string | null,
): ProjectOverrideChainEntry[] {
  const chain: ProjectOverrideChainEntry[] = []
  if (!collectionId) return chain
  resolveProjectNodeIdChain(collections, collectionId).forEach((id, depth) => {
    const override = params[id]?.postprocess
    if (override) chain.push({ collectionId: id, depth, override })
  })
  return chain
}

/** 归属节点的路径名（供 `{line}` / `{product}` / `{direction}` token）；无归属时全为空串。 */
export function resolveProjectNodePathNames(
  collections: AssetCollection[],
  collectionId: string | null,
): { line: string; product: string; direction: string } {
  if (!collectionId) return { line: '', product: '', direction: '' }
  const path = resolveCollectionPath(collections, collectionId)
  return {
    line: path[0]?.name ?? '',
    product: path[1]?.name ?? '',
    direction: path.length >= 3 ? path[path.length - 1].name : '',
  }
}

/**
 * 某个节点**所属的产品**（项目树第二级）id。
 *
 * - 产品节点 → 自己（路径第 2 段的 id 就是它）；
 * - 方向及更深 → 往上取第二级；
 * - 产品线（路径只有一段）/ 不存在的 id / 空 id → `null`。
 *
 * **水印库按产品隔离**后，「现在该看谁的库」全工作区只走这一个函数 —— 界面过滤与
 * 存量数据的一次性归属推断共用一份实现。各写一遍遍历的话，迟早在「产品线层算不算」
 * 或「回收站节点怎么办」这类细节上分叉，而分叉的症状只是「某几个方向的水印莫名少一套」。
 */
export function resolveOwningProductId(collections: AssetCollection[], collectionId: string | null): string | null {
  if (!collectionId) return null
  const path = resolveCollectionPath(collections, collectionId)
  return path[1]?.id ?? null
}

/**
 * 从一张图的若干归属 id 里挑出「最具体」的那个（层级最深）作为它的方向归属。
 *
 * 素材可以同时挂在产品线和方向上（自动归档是**追加** collectionIds，不是替换），
 * 这种情况下应当以最深的方向为准，否则参数会取到产品线那一级、把方向的个性化设置丢了。
 * 已删除 / 不存在的 id 直接忽略。
 */
export function pickDeepestCollectionId(collections: AssetCollection[], ids: string[]): string | null {
  if (ids.length === 0) return null
  const byId = new Map(collections.map((item) => [item.id, item]))
  let best: string | null = null
  let bestDepth = -1
  for (const id of ids) {
    const trimmed = typeof id === 'string' ? id.trim() : ''
    if (!trimmed || !byId.has(trimmed)) continue
    const depth = resolveCollectionPath(byId, trimmed).length
    if (depth > bestDepth) {
      bestDepth = depth
      best = trimmed
    }
  }
  return best
}

export interface ResolvedPostprocessSlice {
  /** 合并后的生效配置（`selectedCollectionIds` 保持基线值，由调用方按归属改写） */
  config: PostprocessMediaConfig
  /** 链上最深一次 `enabled` 声明的值；无人声明时为 true */
  enabled: boolean
  /** 提供了参数的节点 id（链上最深的一个）；null = 全部来自全局默认 */
  sourcedFrom: string | null
  /** `sourcedFrom` 所在深度；无来源时为 -1 */
  sourcedDepth: number
}

/**
 * 合并出某个节点的生效后处理配置。
 *
 * `enabled` 单独处理而不是放进 `applyPostprocessOverride`：它是「要不要跑」的开关，
 * 不属于 `PostprocessMediaConfig` 的形状，混进去会让快照对比、备份导出都带上一个假字段。
 *
 * `mediaId` 给出时按该渠道解析 `byMedia`（渠道是**单元维度**：同一张原图会展开成多个渠道的变体，
 * 每个变体的输出目录可能不同）。继承方向不变：链上更深的节点仍然最后应用、覆盖更浅的。
 */
export function resolveProjectPostprocessSlice(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  collectionId: string | null,
  fallback: PostprocessMediaConfig,
  mediaId?: string,
): ResolvedPostprocessSlice {
  const chain = resolveProjectOverrideChain(collections, params, collectionId)
  let config = fallback
  let enabled = true
  let sourcedFrom: string | null = null
  let sourcedDepth = -1

  for (const entry of chain) {
    config = applyPostprocessOverride(config, entry.override, mediaId)
    if (entry.override.enabled !== undefined) enabled = entry.override.enabled
    sourcedFrom = entry.collectionId
    sourcedDepth = entry.depth
  }

  return { config, enabled, sourcedFrom, sourcedDepth }
}

/** 某个节点最终生效的水印绑定。 */
export interface ResolvedWatermarkBinding {
  /** 生效的水印预设 id，顺序即产出顺序；空数组 = 这个方向不加水印 */
  presetIds: string[]
  /** 提供了该值的节点 id；null = 全部来自全局默认 */
  sourcedFrom: string | null
  /** 本节点自己写了这个字段（对应「本级自定义」；false 时显示为继承） */
  overridden: boolean
}

/**
 * 只解析「这个节点用哪些水印」这一个字段。
 *
 * 单独开一个入口而不是让调用方去凑一份完整的 `PostprocessMediaConfig` 再调
 * `resolveProjectPostprocessSlice`：水印工作区只关心水印，为了拿一个数组去订阅
 * 媒体表、输出目录、分发配置等九个字段，既绕又容易在字段增删时漏改。
 * 继承口径与全字段合并**共用同一条链**（`resolveProjectOverrideChain`），不会分叉。
 *
 * `mediaId` 给出时优先取该渠道在 `byMedia` 里的值，缺失则回退本级通用值。
 */
export function resolveNodeWatermarkBinding(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  collectionId: string | null,
  globalPresetIds: string[],
  mediaId?: string,
): ResolvedWatermarkBinding {
  const chain = resolveProjectOverrideChain(collections, params, collectionId)
  let presetIds = globalPresetIds
  let sourcedFrom: string | null = null

  for (const entry of chain) {
    const perMedia = mediaId ? entry.override.byMedia?.[mediaId] : undefined
    // 渠道值优先于本级通用值；undefined = 不表态（继续继承），[] = 显式「不加水印」，必须照收
    const declared = perMedia?.watermarkPresetIds ?? entry.override.watermarkPresetIds
    if (declared === undefined) continue
    presetIds = declared
    sourcedFrom = entry.collectionId
  }

  // collectionId 为 null（图片没有归属）时两边都是 null，不能算「本级自定义」
  const overridden = collectionId !== null && sourcedFrom === collectionId

  return { presetIds, sourcedFrom, overridden }
}

/** 某节点在单个渠道上生效的水印绑定。 */
export interface ResolvedMediaWatermarkBinding {
  mediaId: string
  presetIds: string[]
}

function sameIdList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/**
 * 列出某节点**按渠道**生效、且与通用值不同的水印绑定。
 *
 * 树上的行要能看出「这个方向在头条用这套、在百度用那套」，而 `resolveNodeWatermarkBinding`
 * 一次只回答一个渠道。这里逐渠道解析，但**只回传与通用值不同的那些**——否则每个方向都会
 * 列出全部渠道，树上一屏全是重复信息，「哪些渠道真的不一样」反而看不出来。
 */
export function resolveNodeWatermarkBindingsByMedia(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  collectionId: string | null,
  globalPresetIds: string[],
  mediaIds: string[],
): ResolvedMediaWatermarkBinding[] {
  const base = resolveNodeWatermarkBinding(collections, params, collectionId, globalPresetIds)
  const result: ResolvedMediaWatermarkBinding[] = []
  for (const mediaId of mediaIds) {
    const resolved = resolveNodeWatermarkBinding(collections, params, collectionId, globalPresetIds, mediaId)
    if (sameIdList(resolved.presetIds, base.presetIds)) continue
    result.push({ mediaId, presetIds: resolved.presetIds })
  }
  return result
}

/** 归一化水印预设 id 列表：去空、去重、保序。空数组有效（= 显式不加水印）。 */
function normalizePresetIdList(raw: unknown): string[] {
  const ids: string[] = []
  if (!Array.isArray(raw)) return ids
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || ids.includes(trimmed)) continue
    ids.push(trimmed)
  }
  return ids
}

/**
 * 归一化「按渠道覆盖」表。
 *
 * 口径与通用值一致：字段缺失 = 不表态（回退本节点通用值），`watermarkPresetIds: []` = 该渠道不加水印。
 * 某渠道一条有效字段都没剩下时整个键丢掉——留一个空对象会让界面显示成「已按渠道覆盖」却什么都没配。
 */
function normalizeByMediaOverride(raw: unknown): Record<string, PostprocessMediaOverride> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: Record<string, PostprocessMediaOverride> = {}
  for (const [rawMediaId, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const mediaId = typeof rawMediaId === 'string' ? rawMediaId.trim() : ''
    if (!mediaId || !rawValue || typeof rawValue !== 'object') continue
    const entry = rawValue as Record<string, unknown>
    const override: PostprocessMediaOverride = {}
    // 多位置写法优先保留；单值 `outputDir` 一起读进来（旧数据），合并时由 `foldMediaOutputDirs` 决定谁生效
    if (Array.isArray(entry.outputDirs)) override.outputDirs = normalizeOutputDirList(entry.outputDirs)
    if (typeof entry.outputDir === 'string') override.outputDir = entry.outputDir
    if (Array.isArray(entry.watermarkPresetIds)) {
      override.watermarkPresetIds = normalizePresetIdList(entry.watermarkPresetIds)
    }
    if (Object.keys(override).length > 0) result[mediaId] = override
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** 归一化单个覆盖切片：丢弃 `undefined`，保证「缺省 = 继承」；空对象回退为 undefined。 */
export function normalizePostprocessNodeOverride(raw: unknown): PostprocessNodeOverride | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  const result: PostprocessNodeOverride = {}

  // 已收归全局的字段（`selectedMediaIds` / `direction` / `namePattern` / `creator` /
  // `autoCompanionClean` / `distribution`）在这里**刻意不读**：它们不再是节点可覆盖项（ADR-0011）。
  // 旧数据里的值由 `collectPromotedNodeFieldValues` 在 migrate 阶段先接住，不会丢。
  if (typeof input.outputDir === 'string') result.outputDir = input.outputDir
  // 空数组是**显式**「这个方向不加水印」，必须与「没表态」（undefined）区分，所以数组照收不误。
  // 旧版单值字段（`watermarkPresetId`）一并迁移，否则升级后用户已配的水印会消失。
  if (Array.isArray(input.watermarkPresetIds)) {
    result.watermarkPresetIds = normalizePresetIdList(input.watermarkPresetIds)
  } else if (typeof input.watermarkPresetId === 'string' && input.watermarkPresetId.trim()) {
    result.watermarkPresetIds = [input.watermarkPresetId.trim()]
  } else if (input.watermarkPresetId === null) {
    result.watermarkPresetIds = []
  }
  if (typeof input.enabled === 'boolean') result.enabled = input.enabled
  const byMedia = normalizeByMediaOverride(input.byMedia)
  if (byMedia) result.byMedia = byMedia

  return Object.keys(result).length > 0 ? result : undefined
}

/** 已收归全局的字段（ADR-0011）。旧数据里它们可能还挂在节点上，迁移时需提升到全局。 */
export interface PromotedNodeFieldValues {
  /** 值为 `undefined` 表示该节点没写过这个字段 */
  namePattern?: string
  creator?: string
  autoCompanionClean?: boolean
  distribution?: PostprocessDistributionConfig
}

/**
 * 从**原始（未归一化）**节点参数表里，为已收归全局的字段各挑一个旧值（R-63 的一次性迁移）。
 *
 * **为什么需要它**：`PostprocessNodeOverride` 从 10 字段收到 3 字段（ADR-0011）后，
 * 旧数据里挂在节点上的 `namePattern` / `creator` / `autoCompanionClean` / `distribution`
 * 会被 `normalizePostprocessNodeOverride` 直接丢弃 —— 用户**已经配好的值凭空消失、
 * 界面上不报任何错**，且不可逆。这是 R-63 记的场景，所以升级时必须先把值接住、提升到全局基线。
 *
 * **必须吃原始数据**：归一化后这些字段已经没了，从归一化结果里收集只会得到空对象。
 *
 * **取谁的值**：按 `collectionId` 字典序扫（`Object.keys` 顺序不可依赖，必须显式排序），
 * 第一个写了该字段的节点胜出。**刻意不用「层级最深优先」** —— 迁移发生在 `persist.migrate`
 * 里，那里拿不到 `collections`（它是另一个 store）算不了深度。多值并存时按 id 稳定取一个，
 * 保证同一份数据每次迁移结果一致；剩下的值用户到全局层重配即可。
 *
 * 返回空对象表示「没有任何节点写过这些字段」，调用方跳过迁移即可。
 */
export function collectPromotedNodeFieldValues(rawParams: unknown): PromotedNodeFieldValues {
  if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) return {}
  const source = rawParams as Record<string, unknown>
  const promoted: PromotedNodeFieldValues = {}
  for (const collectionId of Object.keys(source).sort()) {
    const record = source[collectionId]
    if (!record || typeof record !== 'object') continue
    const input = (record as Record<string, unknown>).postprocess
    if (!input || typeof input !== 'object') continue
    const fields = input as Record<string, unknown>
    if (promoted.namePattern === undefined && typeof fields.namePattern === 'string' && fields.namePattern.trim()) {
      promoted.namePattern = fields.namePattern.trim()
    }
    if (promoted.creator === undefined && typeof fields.creator === 'string') {
      promoted.creator = fields.creator
    }
    if (promoted.autoCompanionClean === undefined && typeof fields.autoCompanionClean === 'boolean') {
      promoted.autoCompanionClean = fields.autoCompanionClean
    }
    if (promoted.distribution === undefined && fields.distribution && typeof fields.distribution === 'object') {
      promoted.distribution = normalizePostprocessDistributionConfig(fields.distribution)
    }
  }
  return promoted
}

/** 原始节点参数表里是否还残留着已收归全局的字段（迁移标记用）。 */
export function hasLegacyNodeOnlyFields(rawParams: unknown): boolean {
  if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) return false
  const source = rawParams as Record<string, unknown>
  for (const record of Object.values(source)) {
    if (!record || typeof record !== 'object') continue
    const input = (record as Record<string, unknown>).postprocess
    if (!input || typeof input !== 'object') continue
    const fields = input as Record<string, unknown>
    if (
      fields.namePattern !== undefined ||
      fields.creator !== undefined ||
      fields.autoCompanionClean !== undefined ||
      fields.distribution !== undefined
    ) {
      return true
    }
  }
  return false
}

/** 归一化整张参数表；坏条目逐条丢弃，不整份回退（保住用户其余编辑）。 */
export function normalizeProjectNodeParamsMap(raw: unknown): ProjectNodeParamsMap {
  if (!raw || typeof raw !== 'object') return {}
  const input = raw as Record<string, unknown>
  const result: ProjectNodeParamsMap = {}
  for (const [collectionId, value] of Object.entries(input)) {
    const id = collectionId.trim()
    if (!id || !value || typeof value !== 'object') continue
    const postprocess = normalizePostprocessNodeOverride((value as Record<string, unknown>).postprocess)
    if (!postprocess) continue
    const updatedAt = (value as Record<string, unknown>).updatedAt
    result[id] = { postprocess, ...(typeof updatedAt === 'number' ? { updatedAt } : {}) }
  }
  return result
}

/**
 * 逐渠道合并「按渠道覆盖」表。
 *
 * 不能整份替换：界面上一次只改一个渠道的一个字段，整份替换会把没提到的渠道**静默抹掉**——
 * 用户改完百度发现头条的配置没了，且看不到任何提示。渠道内的字段用 `undefined` 表示
 * 「恢复继承」，所以里层的 undefined 也要一起剔除，不能只在外层做。
 */
function mergeByMediaOverride(
  current: Record<string, PostprocessMediaOverride> | undefined,
  patch: Record<string, PostprocessMediaOverride>,
): Record<string, PostprocessMediaOverride> | undefined {
  const result: Record<string, PostprocessMediaOverride> = { ...current }
  for (const [mediaId, patchEntry] of Object.entries(patch)) {
    if (!patchEntry || typeof patchEntry !== 'object') continue
    const entry: PostprocessMediaOverride = { ...result[mediaId] }
    for (const key of Object.keys(patchEntry) as (keyof PostprocessMediaOverride)[]) {
      const value = patchEntry[key]
      if (value === undefined) delete entry[key]
      else (entry as Record<string, unknown>)[key] = value
    }
    if (Object.keys(entry).length > 0) result[mediaId] = entry
    else delete result[mediaId]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * 合并一次参数补丁。
 *
 * `undefined` 的字段从补丁里被剔除（保持继承），`null` 是**有效值**（如水印 = 不带）。
 * 传入空补丁（如 `{ watermarkPresetId: undefined }`）表示「恢复继承」该字段；
 * 补丁后一个字段都不剩时整条记录被删除，让节点回到「未配置」状态。
 *
 * `byMedia` 例外地**逐渠道合并**而不是整份替换，理由见 `mergeByMediaOverride`。
 */
export function mergePostprocessNodeOverride(
  current: PostprocessNodeOverride | undefined,
  patch: PostprocessNodeOverride,
): PostprocessNodeOverride | undefined {
  const merged: PostprocessNodeOverride = { ...current }
  for (const key of Object.keys(patch) as (keyof PostprocessNodeOverride)[]) {
    const value = patch[key]
    if (value === undefined) {
      delete merged[key]
      continue
    }
    if (key === 'byMedia') {
      const next = mergeByMediaOverride(merged.byMedia, value as Record<string, PostprocessMediaOverride>)
      if (next) merged.byMedia = next
      else delete merged.byMedia
      continue
    }
    ;(merged as Record<string, unknown>)[key] = value
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/** 写回一条参数记录；覆盖被清空时返回 null，由调用方删除该键。 */
export function buildProjectNodeParams(
  current: ProjectNodeParams | undefined,
  patch: PostprocessNodeOverride,
  now = Date.now(),
): ProjectNodeParams | null {
  const postprocess = mergePostprocessNodeOverride(current?.postprocess, patch)
  if (!postprocess) return null
  return { postprocess, updatedAt: now }
}
