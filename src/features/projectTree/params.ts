/**
 * 项目树参数的继承与归一化（纯函数，无副作用，便于单测）。
 *
 * 继承口径：**自根向叶逐级浅合并**，后出现的覆盖先出现的。
 * 方向节点没写某字段时，取它所属产品 → 产品线 → 全局默认里最近一次声明——
 * 这样「整条产品线共用一套水印」只需在产品线上配一次，而不是每个方向各配一遍。
 */

import type { AssetCollection } from '../../types'
import { normalizePostprocessDistributionConfig } from '../../lib/postprocessDistribution'
import {
  applyPostprocessOverride,
  type PostprocessMediaConfig,
  type PostprocessNodeOverride,
} from '../../lib/postprocessMedia'
// 路径解析与后处理命名模板共用同一份实现，避免「表格里的路径」和「产出文件名里的路径」出现两套口径
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import type { ProjectNodeKind, ProjectNodeParams, ProjectNodeParamsMap, ResolvedProjectParams } from './types'

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
): ResolvedProjectParams['path'] {
  if (!collectionId) return { line: '', product: '', direction: '' }
  const path = resolveCollectionPath(collections, collectionId)
  return {
    line: path[0]?.name ?? '',
    product: path[1]?.name ?? '',
    direction: path.length >= 3 ? path[path.length - 1].name : '',
  }
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
 */
export function resolveProjectPostprocessSlice(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  collectionId: string | null,
  fallback: PostprocessMediaConfig,
): ResolvedPostprocessSlice {
  const chain = resolveProjectOverrideChain(collections, params, collectionId)
  let config = fallback
  let enabled = true
  let sourcedFrom: string | null = null
  let sourcedDepth = -1

  for (const entry of chain) {
    config = applyPostprocessOverride(config, entry.override)
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
 */
export function resolveNodeWatermarkBinding(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  collectionId: string | null,
  globalPresetIds: string[],
): ResolvedWatermarkBinding {
  const chain = resolveProjectOverrideChain(collections, params, collectionId)
  let presetIds = globalPresetIds
  let sourcedFrom: string | null = null

  for (const entry of chain) {
    const declared = entry.override.watermarkPresetIds
    // undefined = 不表态（继续继承）；[] = 显式「这个方向不加水印」，必须照收
    if (declared === undefined) continue
    presetIds = declared
    sourcedFrom = entry.collectionId
  }

  // collectionId 为 null（图片没有归属）时两边都是 null，不能算「本级自定义」
  const overridden = collectionId !== null && sourcedFrom === collectionId

  return { presetIds, sourcedFrom, overridden }
}

/**
 * 解析出完整的生效参数（含路径名与归属），供表格展示与后处理执行使用。
 *
 * 归属为空（图片没有挂任何项目）时 `sourcedFrom` 为 null，参数全部来自全局默认——
 * 这是「没配过也能出图」的兜底，不是错误。
 */
export function resolveProjectParams(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  collectionId: string | null,
  fallback: PostprocessMediaConfig,
): ResolvedProjectParams {
  const slice = resolveProjectPostprocessSlice(collections, params, collectionId, fallback)
  return {
    collectionId,
    path: resolveProjectNodePathNames(collections, collectionId),
    enabled: slice.enabled,
    sourcedFrom: slice.sourcedFrom,
    sourcedDepth: slice.sourcedDepth,
  }
}

/** 归一化单个覆盖切片：丢弃 `undefined`，保证「缺省 = 继承」；空对象回退为 undefined。 */
export function normalizePostprocessNodeOverride(raw: unknown): PostprocessNodeOverride | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  const result: PostprocessNodeOverride = {}

  if (Array.isArray(input.selectedMediaIds)) {
    const ids: string[] = []
    for (const item of input.selectedMediaIds) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (!trimmed || ids.includes(trimmed)) continue
      ids.push(trimmed)
    }
    result.selectedMediaIds = ids
  }
  if (input.direction === null) result.direction = null
  else if (input.direction === 'landscape' || input.direction === 'portrait' || input.direction === 'square') {
    result.direction = input.direction
  }
  if (typeof input.outputDir === 'string') result.outputDir = input.outputDir
  if (typeof input.namePattern === 'string' && input.namePattern.trim()) result.namePattern = input.namePattern.trim()
  if (typeof input.creator === 'string') result.creator = input.creator
  // 空数组是**显式**「这个方向不加水印」，必须与「没表态」（undefined）区分，所以数组照收不误。
  // 旧版单值字段（`watermarkPresetId`）一并迁移，否则升级后用户已配的水印会消失。
  if (Array.isArray(input.watermarkPresetIds)) {
    const presetIds: string[] = []
    for (const item of input.watermarkPresetIds) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (!trimmed || presetIds.includes(trimmed)) continue
      presetIds.push(trimmed)
    }
    result.watermarkPresetIds = presetIds
  } else if (typeof input.watermarkPresetId === 'string' && input.watermarkPresetId.trim()) {
    result.watermarkPresetIds = [input.watermarkPresetId.trim()]
  } else if (input.watermarkPresetId === null) {
    result.watermarkPresetIds = []
  }
  if (typeof input.autoCompanionClean === 'boolean') result.autoCompanionClean = input.autoCompanionClean
  // 分发是**整份**配置：缺字段按默认值补齐，不做「部分继承」。
  // 排期由「起始日期 + 天数」共同决定，混着继承会拼出「天数取全局 7、起始日期是新填的」这类
  // 无法从界面上推理出来的组合。要改就整套写在同一个节点上。
  if (input.distribution && typeof input.distribution === 'object') {
    result.distribution = normalizePostprocessDistributionConfig(input.distribution)
  }
  if (typeof input.enabled === 'boolean') result.enabled = input.enabled

  return Object.keys(result).length > 0 ? result : undefined
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
 * 合并一次参数补丁。
 *
 * `undefined` 的字段从补丁里被剔除（保持继承），`null` 是**有效值**（如水印 = 不带）。
 * 传入空补丁（如 `{ watermarkPresetId: undefined }`）表示「恢复继承」该字段；
 * 补丁后一个字段都不剩时整条记录被删除，让节点回到「未配置」状态。
 */
export function mergePostprocessNodeOverride(
  current: PostprocessNodeOverride | undefined,
  patch: PostprocessNodeOverride,
): PostprocessNodeOverride | undefined {
  const merged: PostprocessNodeOverride = { ...current }
  for (const key of Object.keys(patch) as (keyof PostprocessNodeOverride)[]) {
    const value = patch[key]
    if (value === undefined) delete merged[key]
    else (merged as Record<string, unknown>)[key] = value
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
