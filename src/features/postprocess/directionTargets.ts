/**
 * 一次后处理的「产出目标方向」解析 —— 界面与执行体**共用的唯一实现**（纯逻辑，无副作用）。
 *
 * 为什么必须唯一：后处理拆成「每个方向一条独立 run」之后，「这批图会产出到哪几个方向」
 * 有两处要用 —— 编排层据此（`store.ts`）分组排队，素材库按钮据此判断「我选中的这些素材
 * 涉及的方向是不是还在跑」。两处各写一遍必然分叉成「按钮说能跑、点下去什么都没产」，
 * 而这类偏差在界面上看不出原因。
 *
 * 口径与执行体逐张图的那一份**一字不差**（原 `taskPostprocess.ts` 里的 `targetIds` 计算）：
 * - **手动触发**（素材库点「跑后处理」）→ 「记住的产出目标」（`savedTargetCollectionIds`）优先；
 * - 否则有归属方向 → 归属方向本身（「执行时无需手动选项目」的含义）；
 * - 否则无归属（手工拖入 / 旧数据）→ 退回全局启用范围（`selectedCollectionIds`）。
 *
 * 自动触发**不读**「记住的产出目标」—— 那份清单只管手动点的那一次（杰哥 2026-09-22 明确），
 * 否则用户在「产出目标」里勾什么就会悄悄改掉他看不见的时候发生的自动产出。
 */

import type { PostprocessMediaConfig } from '../../lib/postprocessMedia'
import type { PostprocessRunSource } from './postprocessRun'

export interface ResolveDirectionTargetsInput {
  imageIds: string[]
  /** 图片 id → 归属方向 id（`collectionIds` 里最深那条）；查不到 / 无归属为 null */
  ownership: ReadonlyMap<string, string | null>
  source: PostprocessRunSource
  config: Pick<PostprocessMediaConfig, 'savedTargetCollectionIds' | 'selectedCollectionIds'>
}

/**
 * 单张图的产出目标方向（顺序即产出顺序，已去重）。
 *
 * 返回值可能是**树上已不存在的 id**（归属方向被删、记住的目标被删）：刻意不在这里过滤，
 * 让编排层照旧为它建一条 run —— 那样执行体会按老规矩报 `PP-TARGET-001` 告诉用户
 * 「归属的方向可能已被删除」。在这里悄悄丢掉的话，用户只会看到「点了没反应」。
 */
export function resolveImageTargetDirectionIds(imageId: string, input: ResolveDirectionTargetsInput): string[] {
  const { source, config } = input
  const savedTargets = source === 'manual' ? config.savedTargetCollectionIds : []
  if (savedTargets.length > 0) return dedupe(savedTargets)

  const owned = input.ownership.get(imageId) ?? null
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
 */
export function groupImageIdsByTargetDirection(input: ResolveDirectionTargetsInput): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const imageId of input.imageIds) {
    if (!imageId) continue
    for (const directionId of resolveImageTargetDirectionIds(imageId, input)) {
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
  config: Pick<PostprocessMediaConfig, 'savedTargetCollectionIds' | 'selectedCollectionIds'>,
): string[] {
  const ownership = new Map<string, string | null>()
  ownedDirectionIds.forEach((directionId, index) => ownership.set(`#${index}`, directionId))
  return collectTargetDirectionIds({ imageIds: [...ownership.keys()], ownership, source, config })
}
