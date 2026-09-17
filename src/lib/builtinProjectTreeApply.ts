import type { AssetCollection } from '../types'
import { BUILTIN_PROJECT_TREE, flattenBuiltinProjectTree } from './builtinProjectTree'

/**
 * 内置「产品线 - 产品 - 方向」结构 → 项目文件夹树的写入器。
 *
 * 数据安全底线（与 `assetAutoArchive.ensureFolderChain` 保持同一套惯例）：
 * - **只新增，绝不改写/删除**任何既有文件夹；用户改过的名称、移动过的位置一律原样保留。
 * - 幂等：以内置 id 判重，重复执行不会产生重复文件夹。
 * - 父级在回收站里（用户删过这条产品线）时，整条分支跳过，不擅自把它从回收站捞出来。
 */

/** 只暴露「写一个文件夹」这一项能力，便于测试注入与复用既有仓储。 */
export type BuiltinProjectTreeDeps = {
  putCollection: (collection: AssetCollection) => Promise<AssetCollection>
}

export type BuiltinProjectTreeApplyResult = {
  /** 输入集合 + 本次新建的集合（新建项按内置顺序追加） */
  collections: AssetCollection[]
  /** 本次真正新建的文件夹，供调用方同步进内存态 */
  created: AssetCollection[]
  /** 命中已有文件夹（含回收站中的）而跳过的节点数 */
  reused: number
  /** 因父级不可用（不在集合里，或已被用户删进回收站）而跳过的节点数 */
  skipped: number
}

/** 内置结构写入的迁移 id：只执行一次，用户之后删除的内置文件夹不会被自动重建。 */
export const BUILTIN_PROJECT_TREE_MIGRATION_ID = 'builtin-project-tree-v1'

/**
 * 把「产品线 - 产品 - 方向」三级结构补齐到项目文件夹树。
 *
 * 判定顺序：父级是否可用（不可用则跳过整个分支）→ 该 id 是否已存在（存在则原样保留）→ 新建。
 * 复用「内置 id 即权威标识」的判重方式，不按名称匹配，避免与用户自建的同名文件夹误绑。
 */
export async function applyBuiltinProjectTree(
  collections: AssetCollection[],
  deps: BuiltinProjectTreeDeps,
  now = Date.now(),
): Promise<BuiltinProjectTreeApplyResult> {
  const pool = [...collections]
  const byId = new Map(pool.map((collection) => [collection.id, collection]))
  const created: AssetCollection[] = []
  let reused = 0
  let skipped = 0

  for (const node of flattenBuiltinProjectTree(BUILTIN_PROJECT_TREE)) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    // 父级不在（或被用户删进回收站）时不重建父节点，也不落子节点 —— 尊重用户的删除
    if (node.parentId !== null && (!parent || parent.trashedAt)) {
      skipped++
      continue
    }
    if (byId.has(node.id)) {
      reused++
      continue
    }
    const saved = await deps.putCollection(createBuiltinCollection(node, now))
    pool.push(saved)
    byId.set(saved.id, saved)
    created.push(saved)
  }

  return { collections: pool, created, reused, skipped }
}

/** 用内置节点信息构造 `AssetCollection`；id 直接用内置 id，保证重复执行可稳定识别。 */
export function createBuiltinCollection(
  node: { id: string; name: string; parentId: string | null; order: number },
  now = Date.now(),
): AssetCollection {
  return {
    id: node.id,
    name: node.name,
    normalizedName: node.name.toLocaleLowerCase('zh-CN'),
    parentId: node.parentId,
    order: node.order,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 统计当前项目树里缺失的内置节点数量（含因父级缺失而连带缺失的节点）。
 * 供设置页展示「内置结构缺失 N 项」并提供补齐入口；不做任何写操作。
 */
export function countMissingBuiltinNodes(collections: AssetCollection[]): number {
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  let missing = 0
  for (const node of flattenBuiltinProjectTree(BUILTIN_PROJECT_TREE)) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (node.parentId !== null && (!parent || parent.trashedAt)) {
      missing++
      continue
    }
    if (!byId.has(node.id)) missing++
  }
  return missing
}
