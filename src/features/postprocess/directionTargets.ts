/**
 * 一次后处理的「产出目标方向」解析 —— 界面与执行体**共用的唯一实现**（纯逻辑，无副作用）。
 *
 * 为什么必须唯一：后处理拆成「每个方向一条独立 run」之后，「这批图会产出到哪几个方向」
 * 有两处要用 —— 编排层据此（`store.ts`）分组排队，素材库按钮据此判断「我选中的这些素材
 * 涉及的方向是不是还在跑」。两处各写一遍必然分叉成「按钮说能跑、点下去什么都没产」，
 * 而这类偏差在界面上看不出原因。
 *
 * ## 口径（2026-09-24 改：产出目标从「全库一份」改成「按文件夹各一份」）
 *
 * 前一版把「记住的产出目标」做成了**全局一份**，症状是「给一个方向设完，全库都按它产」——
 * 换个方向干活，产出目标还是上一个方向那套（杰哥报障）。现在这份配置挂在他**当时所在的
 * 文件夹**上（`savedTargetsByFolder`，键 = `AssetCollection.id`），取用规则只有一条：
 *
 * > **沿「归属方向 → 它的祖先」向上找第一个设过的文件夹，最近的一环说了算。**
 *
 * - 图有归属、链上命中 → 用命中那一份（在「产品」层设的一份被它下面所有方向继承，
 *   越具体越优先）。跨产品跨方向勾选的能力照旧，一个字没动；
 * - 图有归属、链上一份都没设 → 归属方向自己（「执行时无需手动选项目」的含义，老行为）；
 * - 图无归属（手工拖入 / 旧数据）→ 才退回兜底那一份（`savedTargetCollectionIds`，
 *   即素材库停在「全部 / 收藏 / 未整理」时设置写入的位置）；再没有就退回全局启用范围。
 *
 * **手动与自动的分界没变**：只有手动触发才读产出目标；自动触发一律按图片归属方向产出。
 * 产出目标是**手动场景**的概念 —— 掺进自动跑之后，用户在「产出目标」里勾什么就会悄悄
 * 改掉他看不见的时候发生的自动产出。
 *
 * ⚠️ 不在这里过滤「树上已不存在的 id」（归属方向被删、记住的目标被删）：照旧为它建一条 run，
 * 由执行体报 `PP-TARGET-001` 告诉用户「归属的方向可能已被删除」。在这里悄悄丢掉的话，
 * 用户只会看到「点了没反应」。
 */

import type { AssetCollection } from '../../types'
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import type { PostprocessMediaConfig } from '../../lib/postprocessMedia'
import type { PostprocessRunSource } from './postprocessRun'

export interface ResolveDirectionTargetsInput {
  imageIds: string[]
  /** 图片 id → 归属方向 id（`collectionIds` 里最深那条）；查不到 / 无归属为 null */
  ownership: ReadonlyMap<string, string | null>
  source: PostprocessRunSource
  config: Pick<PostprocessMediaConfig, 'savedTargetCollectionIds' | 'savedTargetsByFolder' | 'selectedCollectionIds'>
  /**
   * 项目树（素材夹表）。
   *
   * 产出目标按文件夹存，取用要沿「归属方向 → 祖先」向上找，所以这里要能拿到树。
   * 不传 = 只认该方向自己那一份、不向上继承（单测与不关心继承的调用方用得上）；
   * **生产链路的调用点都要传** —— 少传一处，在「产品」层设的那份就会对该产品下的方向失效，
   * 症状是「设置了但没生效」，而界面上看不出为什么。
   */
  collections?: AssetCollection[] | Map<string, AssetCollection>
}

/** 某个文件夹**当前生效**的产出目标：清单 + 它落在哪个文件夹上。 */
export interface EffectiveSavedTargets {
  /** 生效的方向 id 列表（空 = 一份都没设过 → 按归属产出） */
  ids: string[]
  /** 这份清单存在哪个文件夹上；`null` = 链上一份都没有 */
  ownerId: string | null
}

/**
 * 查「某个文件夹当前生效的产出目标」—— `方向 / 文件夹 id → 清单` 的**唯一入口**。
 *
 * 链 = 自己 → 祖先（最近的一环优先），由 `resolveCollectionPath` 提供（它自带坏链 / 环兜底）。
 * 界面（弹窗要显示当前生效的是哪一份、继承自谁）与执行体（逐图取目标）都走这里，
 * 两处各写一遍必然出现「弹窗里显示 A、实际产出到 B」。
 */
export function resolveEffectiveSavedTargets(
  config: Pick<PostprocessMediaConfig, 'savedTargetsByFolder'>,
  folderId: string | null,
  collections?: AssetCollection[] | Map<string, AssetCollection>,
): EffectiveSavedTargets {
  if (!folderId) return { ids: [], ownerId: null }
  // 自身 → 根：最近的一环说了算（在「产品」层设的能被其下所有方向继承）
  const chainIds = collections
    ? resolveCollectionPath(collections, folderId)
        .map((item) => item.id)
        .reverse()
    : [folderId]
  for (const id of chainIds) {
    const hit = config.savedTargetsByFolder[id]
    if (hit && hit.length > 0) return { ids: dedupe(hit), ownerId: id }
  }
  return { ids: [], ownerId: null }
}

/**
 * 单张图的产出目标方向（顺序即产出顺序，已去重）。
 *
 * 返回值可能是**树上已不存在的 id**（归属方向被删、记住的目标被删）：刻意不在这里过滤，
 * 让编排层照旧为它建一条 run —— 那样执行体会按老规矩报 `PP-TARGET-001`。
 */
export function resolveImageTargetDirectionIds(imageId: string, input: ResolveDirectionTargetsInput): string[] {
  const { source, config } = input
  const owned = input.ownership.get(imageId) ?? null

  if (source === 'manual') {
    if (owned) {
      const effective = resolveEffectiveSavedTargets(config, owned, input.collections)
      if (effective.ids.length > 0) return effective.ids
    } else {
      // 无归属：只有这时才用「兜底那一份」（素材库不在具体文件夹里时设置的）。
      // ⚠️ 它**不**对有归属的图生效 —— 若生效，"设一次全库都变"的老毛病立刻回来。
      const fallback = dedupe(config.savedTargetCollectionIds)
      if (fallback.length > 0) return fallback
    }
  }

  if (owned) return [owned]

  return dedupe(config.selectedCollectionIds)
}

function dedupe(ids: readonly string[]): string[] {
  const result: string[] = []
  for (const id of ids) {
    const trimmed = typeof id === 'string' ? id.trim() : ''
    if (!trimmed || result.includes(trimmed)) continue
    result.push(trimmed)
  }
  return result
}

/**
 * 整批按方向分组：方向 id → 该方向的源图 id 列表（保序）。
 *
 * 顺序 = 源图在批次里的顺序，所以「先出现的方向先开工」，与用户在素材库里的选择顺序一致。
 *
 * 传进来的是数组时**先转成 Map 再往下走**：`resolveCollectionPath` 每次调用都会建一次
 * `id → 节点`的表，而这个函数是逐图调用的 —— 不先转，几百张图就把同一棵树解析几百遍。
 */
export function groupImageIdsByTargetDirection(input: ResolveDirectionTargetsInput): Map<string, string[]> {
  const collections = input.collections
  const normalized: ResolveDirectionTargetsInput =
    collections && !(collections instanceof Map)
      ? { ...input, collections: new Map(collections.map((item) => [item.id, item])) }
      : input

  const groups = new Map<string, string[]>()
  for (const imageId of normalized.imageIds) {
    if (!imageId) continue
    for (const directionId of resolveImageTargetDirectionIds(imageId, normalized)) {
      const bucket = groups.get(directionId)
      if (bucket) {
        if (!bucket.includes(imageId)) bucket.push(imageId)
      } else {
        groups.set(directionId, [imageId])
      }
    }
  }
  return groups
}

/** 界面用：这批素材会涉及的全部方向 id（去重，顺序同 `groupImageIdsByTargetDirection`）。 */
export function collectTargetDirectionIds(input: ResolveDirectionTargetsInput): string[] {
  return [...groupImageIdsByTargetDirection(input).keys()]
}

/**
 * 界面用：只有「归属方向」这一列数据时算目标方向（编排层是从 `Map` 入手，判定逻辑同一份）。
 *
 * 存在的理由：素材库工具栏要判断「我选中的这些素材涉及的方向里有没有在跑的」，
 * 而它手上只有素材（没有 imageId → 归属的映射）。判定逻辑不能在这里重写一遍 ——
 * 重写的后果是「按钮说能跑、点下去被跳过」，而界面上看不出为什么。
 */
export function collectTargetDirectionIdsFromOwnership(
  ownedDirectionIds: readonly (string | null)[],
  source: PostprocessRunSource,
  config: ResolveDirectionTargetsInput['config'],
  collections?: AssetCollection[] | Map<string, AssetCollection>,
): string[] {
  const ownership = new Map<string, string | null>()
  ownedDirectionIds.forEach((directionId, index) => ownership.set(`#${index}`, directionId))
  return collectTargetDirectionIds({ imageIds: [...ownership.keys()], ownership, source, config, collections })
}
