import type { SopGroup } from '../features/strategy/types'
import type { AssetCollection } from '../types'

/**
 * 项目文件夹树 → SOP 分组树的单向镜像。
 *
 * 约定（本模块是全仓唯一的同步口径）：
 * - **项目文件夹树是唯一主源**，SOP 分组树是它的投影；所有结构变更都先落项目树，再镜像出去。
 * - 镜像**只增不删**：用户删掉项目文件夹后，对应分组及其中的 SOP 原样保留（不掉进「未分组」），
 *   文件夹从回收站恢复后会自动重新接上（靠 `collectionId` 关联，不按名称匹配）。
 * - 用户自建、未绑定文件夹的分组（无 `collectionId`）不受影响；仅当根级出现同名时才会被认领绑定，
 *   避免同一层级出现两份同名分组。
 * - 幂等：重复执行不产生重复分组，也不会改写内容已一致的分组（只更新名称/父级的差异）。
 */

/** 由项目树投影出来的分组 id 前缀，便于识别镜像节点。 */
export const SOP_GROUP_MIRROR_ID_PREFIX = 'sop-group-mirror-'

export type SopGroupMirrorPlan = {
  /** 需要写入 SOP 库的分组：新增项 + 名称/父级需要跟上的既有项 */
  upserts: SopGroup[]
  /** 其中新建的分组数 */
  created: number
  /** 被认领的既有分组数 */
  claimed: number
  /** 因父级文件夹缺失（已删或回收站）而跳过的文件夹数，含其整棵子树 */
  skipped: number
}

export const EMPTY_SOP_GROUP_MIRROR_PLAN: SopGroupMirrorPlan = {
  upserts: [],
  created: 0,
  claimed: 0,
  skipped: 0,
}

/**
 * 依据当前项目文件夹树，算出 SOP 分组树需要补齐/更新的部分（纯函数，不落盘）。
 * 调用方拿到 `upserts` 后逐个写入 SOP 库即可；`upserts` 为空表示两边已经一致。
 */
export function buildSopGroupMirrorPlan(
  collections: AssetCollection[],
  sopGroups: SopGroup[],
  now = Date.now(),
): SopGroupMirrorPlan {
  const live = collections.filter((collection) => !collection.trashedAt)
  if (live.length === 0) return EMPTY_SOP_GROUP_MIRROR_PLAN

  const liveById = new Map(live.map((collection) => [collection.id, collection]))
  const groupByCollectionId = new Map<string, SopGroup>()
  /** 可被认领的根级分组：用户自建、未绑定文件夹、名称 → 分组 */
  const claimableRoots = new Map<string, SopGroup>()

  for (const group of sopGroups) {
    if (group.collectionId) {
      if (!groupByCollectionId.has(group.collectionId)) groupByCollectionId.set(group.collectionId, group)
      continue
    }
    if ((group.parentId ?? null) !== null) continue
    const normalizedName = group.name.trim().toLocaleLowerCase('zh-CN')
    if (normalizedName && !claimableRoots.has(normalizedName)) claimableRoots.set(normalizedName, group)
  }

  const upserts: SopGroup[] = []
  const resolvedGroupIdByCollectionId = new Map<string, string>()
  let created = 0
  let claimed = 0
  let skipped = 0

  // 自顶向下遍历：父文件夹先解析，子节点才能挂到正确的父分组上
  const ordered = [...live].sort((left, right) => collectionDepth(left, liveById) - collectionDepth(right, liveById))

  for (const collection of ordered) {
    let resolvedParentId: string | null = null
    if (collection.parentId) {
      const parentGroupId = resolvedGroupIdByCollectionId.get(collection.parentId)
      // 父文件夹缺失（已删/回收站）或已被跳过 → 整棵子树保持现状，不擅自重建
      if (!parentGroupId) {
        skipped++
        continue
      }
      resolvedParentId = parentGroupId
    }

    const existing = groupByCollectionId.get(collection.id)
    if (existing) {
      resolvedGroupIdByCollectionId.set(collection.id, existing.id)
      if (existing.name !== collection.name || (existing.parentId ?? null) !== resolvedParentId) {
        upserts.push({ ...existing, name: collection.name, parentId: resolvedParentId, updatedAt: now })
      }
      continue
    }

    const claimable = resolvedParentId === null ? claimableRoots.get(collection.normalizedName) : undefined
    if (claimable) {
      claimableRoots.delete(collection.normalizedName)
      resolvedGroupIdByCollectionId.set(collection.id, claimable.id)
      upserts.push({
        ...claimable,
        name: collection.name,
        parentId: null,
        collectionId: collection.id,
        updatedAt: now,
      })
      claimed++
      continue
    }

    const group: SopGroup = {
      id: `${SOP_GROUP_MIRROR_ID_PREFIX}${collection.id}`,
      name: collection.name,
      parentId: resolvedParentId,
      collectionId: collection.id,
      createdAt: now,
      updatedAt: now,
    }
    resolvedGroupIdByCollectionId.set(collection.id, group.id)
    upserts.push(group)
    created++
  }

  return { upserts, created, claimed, skipped }
}

/** 把镜像计划写入 SOP 库；`upserts` 为空时直接跳过，不做任何写入。 */
export function applySopGroupMirrorPlan(
  plan: SopGroupMirrorPlan,
  deps: { saveGroup: (group: SopGroup) => void },
): void {
  for (const group of plan.upserts) deps.saveGroup(group)
}

/** 由项目文件夹 id 反查镜像分组 id（不校验是否真的存在）。 */
export function getMirrorGroupId(collectionId: string): string {
  return `${SOP_GROUP_MIRROR_ID_PREFIX}${collectionId}`
}

/** 计算文件夹在树中的深度（根为 0）；数据异常成环时用已访问集合兜底。 */
function collectionDepth(collection: AssetCollection, byId: Map<string, AssetCollection>): number {
  let depth = 0
  let current: AssetCollection | undefined = collection
  const visited = new Set<string>([collection.id])
  while (current?.parentId && depth < 100) {
    const parent: AssetCollection | undefined = byId.get(current.parentId)
    if (!parent || visited.has(parent.id)) break
    visited.add(parent.id)
    current = parent
    depth++
  }
  return depth
}
