import type { AssetCollection } from '../../types'

/**
 * 把项目树建成「父 → 子」索引；回收站里的节点不参与。
 * 三个查询函数都基于它，避免各写一遍遍历。
 */
function buildIndex(collections: AssetCollection[]) {
  const childrenByParent = new Map<string | null, AssetCollection[]>()
  const depthById = new Map<string, number>()
  for (const item of collections) {
    if (item.trashedAt) continue
    const key = item.parentId ?? null
    const list = childrenByParent.get(key) ?? []
    list.push(item)
    childrenByParent.set(key, list)
  }
  const walk = (parentId: string | null, depth: number) => {
    for (const item of childrenByParent.get(parentId) ?? []) {
      depthById.set(item.id, depth)
      walk(item.id, depth + 1)
    }
  }
  walk(null, 0)
  return { childrenByParent, depthById }
}

/** 从根到该节点的名字路径（如 `['保险', '医疗险', '方向一']`）。 */
export function describeCollectionPath(collections: AssetCollection[], id: string): string[] {
  const byId = new Map(collections.map((item) => [item.id, item]))
  const path: string[] = []
  let current = byId.get(id)
  // 上限只是防御脏数据造成的环，正常树最多几层
  let guard = 0
  while (current && guard < 64) {
    path.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
    guard += 1
  }
  return path
}

/**
 * 取作用域里某一层级的全部节点 id。
 *
 * - `scopeId` 为 null ⇒ 全树搜；
 * - 否则只取**作用域自身及其后代**中位于该层级的节点
 *   （点产品就得到它下面的方向，点产品线就得到它下面所有产品的方向）。
 */
export function collectNodeIdsAtDepth(collections: AssetCollection[], scopeId: string | null, depth: number): string[] {
  const { childrenByParent, depthById } = buildIndex(collections)
  if (scopeId === null) {
    return [...depthById.entries()].filter(([, itemDepth]) => itemDepth === depth).map(([id]) => id)
  }
  const scopeDepth = depthById.get(scopeId)
  if (scopeDepth === undefined) return []
  const result: string[] = []
  const walk = (id: string, currentDepth: number) => {
    if (currentDepth === depth) result.push(id)
    for (const child of childrenByParent.get(id) ?? []) walk(child.id, currentDepth + 1)
  }
  walk(scopeId, scopeDepth)
  return result
}

/** 作用域下的所有方向（第 3 级）。 */
export function collectDirectionIds(collections: AssetCollection[], scopeId: string | null): string[] {
  return collectNodeIdsAtDepth(collections, scopeId, 2)
}

/** 作用域下的所有产品（第 2 级）。 */
export function collectProductIds(collections: AssetCollection[], scopeId: string | null): string[] {
  return collectNodeIdsAtDepth(collections, scopeId, 1)
}

/** 名字查不到就退回 id：界面上宁可显示一串 id，也不要空白。 */
export function nameOf(collections: AssetCollection[], id: string): string {
  return collections.find((item) => item.id === id)?.name ?? id
}
