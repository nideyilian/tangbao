import type { SopGroup } from './types'

/**
 * SOP 管理左栏的「分组树」工具。
 *
 * 分组是扁平存储（`parentId` 表达层级）、树形展示，做法与素材库的
 * `src/features/assetLibrary/AssetLibrarySidebar.tsx` 的 `buildCollectionTree` 保持同构，
 * 便于两棵树的行为（展开/收起、防环、兄弟顺序）一致。
 */

export interface SopGroupTreeNode {
  group: SopGroup
  children: SopGroupTreeNode[]
}

export interface SopGroupTreeRow {
  group: SopGroup
  /** 缩进层级，根级为 0 */
  depth: number
  /** 是否有子分组：决定是否渲染展开/收起箭头 */
  hasChildren: boolean
}

/**
 * 由扁平分组列表构建树。
 * 兄弟顺序沿用 `groups` 数组的相对顺序（镜像写入时按层级+明细表顺序生成），稳定可预测。
 */
export function buildSopGroupTree(groups: SopGroup[]): SopGroupTreeNode[] {
  const nodes = new Map<string, SopGroupTreeNode>(groups.map((group) => [group.id, { group, children: [] }]))
  const roots: SopGroupTreeNode[] = []
  for (const group of groups) {
    const node = nodes.get(group.id)!
    const parentId = group.parentId ?? null
    const parent = parentId ? nodes.get(parentId) : undefined
    if (parent && parent !== node && hasValidParentChain(group, nodes)) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** 按展开状态把树展平成可渲染的行列表；折叠节点的子树整段跳过。 */
export function flattenSopGroupTree(nodes: SopGroupTreeNode[], collapsedIds: ReadonlySet<string>): SopGroupTreeRow[] {
  const rows: SopGroupTreeRow[] = []
  const walk = (list: SopGroupTreeNode[], depth: number) => {
    for (const node of list) {
      const hasChildren = node.children.length > 0
      rows.push({ group: node.group, depth, hasChildren })
      if (hasChildren && !collapsedIds.has(node.group.id)) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}

/** 收集某分组的全部子孙分组 id（不含自身）；数据成环时自动截断。 */
export function collectSopGroupDescendantIds(groups: SopGroup[], groupId: string): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const group of groups) {
    const parentId = group.parentId ?? null
    if (!parentId) continue
    const list = childrenByParent.get(parentId)
    if (list) list.push(group.id)
    else childrenByParent.set(parentId, [group.id])
  }
  const descendants: string[] = []
  const visited = new Set<string>([groupId])
  const stack = [...(childrenByParent.get(groupId) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    descendants.push(current)
    stack.push(...(childrenByParent.get(current) ?? []))
  }
  return descendants
}

/** 分组自身 + 全部子孙分组 id，用于「选中父分组时连子分组的 SOP 一起看」。 */
export function collectSopGroupSubtreeIds(groups: SopGroup[], groupId: string): string[] {
  return [groupId, ...collectSopGroupDescendantIds(groups, groupId)]
}

/** 判断某分组是否落在被删除的镜像文件夹下（用于左栏的「文件夹已删除」提示）。 */
export function isSopGroupDetached(group: SopGroup, liveCollectionIds: ReadonlySet<string>): boolean {
  return Boolean(group.collectionId) && !liveCollectionIds.has(group.collectionId!)
}

/** 防环：父链回到自身时视为非法，该节点回落为根级。 */
function hasValidParentChain(group: SopGroup, nodes: Map<string, SopGroupTreeNode>): boolean {
  const visited = new Set<string>([group.id])
  let current = group.parentId ?? null
  while (current) {
    if (visited.has(current)) return false
    visited.add(current)
    const parentNode = nodes.get(current)
    if (!parentNode) return true
    current = parentNode.group.parentId ?? null
  }
  return true
}
