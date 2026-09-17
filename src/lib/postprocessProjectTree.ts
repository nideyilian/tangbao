/**
 * 项目树 → 后处理「项目维度」的桥梁。
 *
 * 复用左侧栏的项目文件夹树（`AssetCollection` 层级），不另建项目模型：
 * - `buildPostprocessProjectTree` 给面板渲染一棵可勾选的树；
 * - `resolvePostprocessProjectTargets` 把勾选的 id 解析成 `{collectionId, line, product, direction}`，
 *   路径名供命名模板的 `{line}` / `{product}` / `{direction}` token 使用。
 *
 * 只读、无副作用，便于单测。坏数据（坏链、自环、环）不抛错，降级为「提升到根」或跳过。
 */

import type { AssetCollection } from '../types'
import type { PostprocessProjectTarget } from './postprocessMedia'

export interface PostprocessProjectTreeNode {
  id: string
  name: string
  /** 0 = 产品线 */
  depth: number
  parentId: string | null
  children: PostprocessProjectTreeNode[]
}

function compareCollections(a: AssetCollection, b: AssetCollection): number {
  if (a.order !== b.order) return a.order - b.order
  return a.name.localeCompare(b.name, 'zh-Hans-CN')
}

/**
 * 解析一个节点到根的路径（根在前，自身在最后）。
 * 遇到坏链或环时提前停下，避免死循环。
 */
export function resolveCollectionPath(
  collections: AssetCollection[] | Map<string, AssetCollection>,
  collectionId: string,
): AssetCollection[] {
  const byId = collections instanceof Map ? collections : new Map(collections.map((item) => [item.id, item]))
  const path: AssetCollection[] = []
  const seen = new Set<string>()
  let current = byId.get(collectionId)
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    path.unshift(current)
    const parentId = current.parentId
    current = parentId && parentId !== current.id ? byId.get(parentId) : undefined
  }
  return path
}

/**
 * 构建可勾选的项目树。
 *
 * - 回收站节点（`trashedAt`）不出现；
 * - `parentId` 指向不存在的节点时该节点提升为根；
 * - 处在环里的节点（正常数据不会有）也会被提升为根，保证它们仍可被勾选而不是凭空消失。
 */
export function buildPostprocessProjectTree(collections: AssetCollection[]): PostprocessProjectTreeNode[] {
  const usable = collections.filter((collection) => !collection.trashedAt)
  const byId = new Map(usable.map((collection) => [collection.id, collection]))
  const childrenByParent = new Map<string | null, AssetCollection[]>()

  for (const collection of usable) {
    const rawParentId = collection.parentId
    const parentId = rawParentId && rawParentId !== collection.id && byId.has(rawParentId) ? rawParentId : null
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(collection)
    childrenByParent.set(parentId, siblings)
  }

  const visited = new Set<string>()
  const build = (parentId: string | null, depth: number): PostprocessProjectTreeNode[] => {
    const siblings = [...(childrenByParent.get(parentId) ?? [])].sort(compareCollections)
    const nodes: PostprocessProjectTreeNode[] = []
    for (const collection of siblings) {
      if (visited.has(collection.id)) continue
      visited.add(collection.id)
      nodes.push({
        id: collection.id,
        name: collection.name,
        depth,
        parentId,
        children: build(collection.id, depth + 1),
      })
    }
    return nodes
  }

  const roots = build(null, 0)
  // 兜底：只在环里的节点不会被上面访问到，提升为根（连同其非环节点），别让用户勾不到
  for (const collection of [...usable].sort(compareCollections)) {
    if (visited.has(collection.id)) continue
    visited.add(collection.id)
    roots.push({
      id: collection.id,
      name: collection.name,
      depth: 0,
      parentId: null,
      children: build(collection.id, 1),
    })
  }
  return roots
}

/** 展平成「同级按 order」的列表，配合 depth 供简单预览使用。 */
export function flattenPostprocessProjectTree(nodes: PostprocessProjectTreeNode[]): PostprocessProjectTreeNode[] {
  const result: PostprocessProjectTreeNode[] = []
  const walk = (list: PostprocessProjectTreeNode[]) => {
    for (const node of list) {
      result.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return result
}

/**
 * 把勾选的 collectionId 解析成项目目标（路径名）。
 *
 * 层级映射：第一级 → `line`，第二级 → `product`，最后一级（仅当层级 ≥ 3 时）→ `direction`。
 * 用户自建更深层级时取「根 / 第二级 / 叶」，不做报错——命名里多一层少一层不影响产出。
 */
export function resolvePostprocessProjectTargets(
  collections: AssetCollection[],
  selectedIds: string[],
): PostprocessProjectTarget[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  const targets: PostprocessProjectTarget[] = []
  const seen = new Set<string>()

  for (const id of selectedIds) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    const node = byId.get(trimmed)
    if (!node || node.trashedAt) continue
    seen.add(trimmed)
    const path = resolveCollectionPath(byId, trimmed)
    targets.push({
      collectionId: trimmed,
      line: path[0]?.name ?? '',
      product: path[1]?.name ?? '',
      direction: path.length >= 3 ? path[path.length - 1].name : '',
    })
  }
  return targets
}

/** 勾选里已经不存在（被删/被清空的回收站）的 id，供 UI 提示。 */
export function findMissingProjectCollectionIds(collections: AssetCollection[], selectedIds: string[]): string[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  return selectedIds.filter((id) => {
    const node = byId.get(id)
    return !node || Boolean(node.trashedAt)
  })
}
