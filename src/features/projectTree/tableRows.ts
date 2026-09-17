/**
 * 项目树 → 统一表格行（纯函数，无副作用，便于单测）。
 *
 * 表格用**展平 + 缩进**而不是可折叠树：产品线/产品/方向三级规模在百行量级，一次看全比逐级展开
 * 更适合「批量核对哪里配错了参数」这个真实场景。层级靠 `depth` 缩进 + 徽章表达。
 */

import { buildPostprocessProjectTree } from '../../lib/postprocessProjectTree'
import type { AssetCollection } from '../../types'
import { resolveProjectNodeKind } from './params'
import type { ProjectNodeKind, ProjectNodeParamsMap } from './types'

export interface ProjectTreeTableRow {
  id: string
  name: string
  /** 0 = 产品线 */
  depth: number
  kind: ProjectNodeKind
  parentId: string | null
  /** 完整路径「保险 / 百万医疗险 / 月亮」，供搜索与提示 */
  path: string
  pathNames: string[]
  childCount: number
  /** 该节点自身是否配了参数 */
  hasOwnParams: boolean
  /**
   * 生效参数的实际来源节点 id（自身或最近的祖先）；null = 全部来自全局默认。
   * 表格据此把「自己配的」和「继承来的」区分开——否则用户改完上层会以为下层没生效。
   */
  paramsSourcedFrom: string | null
  /**
   * 后处理**启用范围**：自身被勾选，或任一祖先被勾选。
   * 未启用的方向，图片归档进来也不会自动产出变体（原图照常保存）。
   */
  postprocessEnabled: boolean
  /**
   * true = 自身没勾，是靠上级启用的。
   * 表格据此显示成继承态并禁止就地取消——否则取消的只是自己这一格，
   * 上级仍勾着、状态看起来没变化，用户会以为点了没反应。
   */
  postprocessEnabledInherited: boolean
}

export interface ProjectTreeStats {
  total: number
  line: number
  product: number
  direction: number
  /** 配了参数的节点数 */
  configured: number
  /** 落在后处理启用范围内的节点数（含靠上级启用的） */
  enabled: number
}

/**
 * 展平成表格行。
 *
 * 树构建复用 `buildPostprocessProjectTree`（它本身就是通用构建器，命名沿用了最初的使用场景）：
 * 回收站节点不出现、坏链提升为根、环节点兜底，三种脏数据都不会让表格崩或丢节点。
 *
 * `selectedCollectionIds` 是后处理的启用范围（勾了祖先 = 整条分支启用），与「节点参数」是两回事：
 * 前者决定**跑不跑**，后者决定**怎么跑**。
 */
export function buildProjectTreeTableRows(
  collections: AssetCollection[],
  params: ProjectNodeParamsMap,
  selectedCollectionIds: string[] = [],
): ProjectTreeTableRow[] {
  const roots = buildPostprocessProjectTree(collections)
  const rows: ProjectTreeTableRow[] = []
  const selected = new Set(selectedCollectionIds.filter((id) => typeof id === 'string' && id.trim()))

  const walk = (
    nodes: ReturnType<typeof buildPostprocessProjectTree>,
    ancestors: string[],
    inherited: string | null,
    enabledByAncestor: boolean,
  ) => {
    for (const node of nodes) {
      const pathNames = [...ancestors, node.name]
      const hasOwnParams = Boolean(params[node.id]?.postprocess)
      const picked = selected.has(node.id)
      const postprocessEnabled = enabledByAncestor || picked
      rows.push({
        id: node.id,
        name: node.name,
        depth: node.depth,
        kind: resolveProjectNodeKind(node.depth),
        parentId: node.parentId,
        path: pathNames.join(' / '),
        pathNames,
        childCount: node.children.length,
        hasOwnParams,
        paramsSourcedFrom: hasOwnParams ? node.id : inherited,
        postprocessEnabled,
        postprocessEnabledInherited: postprocessEnabled && !picked,
      })
      walk(node.children, pathNames, hasOwnParams ? node.id : inherited, postprocessEnabled)
    }
  }

  walk(roots, [], null, false)
  return rows
}

/**
 * 关键词过滤。
 *
 * 命中节点的**整条祖先链都会被保留**，否则搜索结果只剩一个孤零零的「月亮」，
 * 用户看不出它属于哪条产品线——而「这条方向挂对产品线了吗」恰恰是搜索的常见动机。
 */
export function filterProjectTreeTableRows(rows: ProjectTreeTableRow[], keyword: string): ProjectTreeTableRow[] {
  const query = keyword.trim().toLocaleLowerCase('zh-CN')
  if (!query) return rows

  const byId = new Map(rows.map((row) => [row.id, row]))
  const visible = new Set<string>()
  for (const row of rows) {
    const haystack = `${row.name}\n${row.path}`.toLocaleLowerCase('zh-CN')
    if (!haystack.includes(query)) continue
    let current: ProjectTreeTableRow | undefined = row
    const guard = new Set<string>()
    while (current && !guard.has(current.id)) {
      guard.add(current.id)
      visible.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return rows.filter((row) => visible.has(row.id))
}

/** 统计各类节点数量，供工具栏展示。 */
export function summarizeProjectTreeRows(rows: ProjectTreeTableRow[]): ProjectTreeStats {
  const stats: ProjectTreeStats = {
    total: rows.length,
    line: 0,
    product: 0,
    direction: 0,
    configured: 0,
    enabled: 0,
  }
  for (const row of rows) {
    if (row.kind === 'line') stats.line += 1
    else if (row.kind === 'product') stats.product += 1
    else if (row.kind === 'direction' || row.kind === 'extra') stats.direction += 1
    if (row.hasOwnParams) stats.configured += 1
    if (row.postprocessEnabled) stats.enabled += 1
  }
  return stats
}

/**
 * 某节点可选的父级列表：排除自身与全部后代，避免把节点拖进自己的子树里成环。
 * `rows` 已按「父在前」的 DFS 顺序展平，后代在数组里紧跟在自身之后且 depth 更深。
 */
export function listAvailableParents(rows: ProjectTreeTableRow[], selfId: string | null): ProjectTreeTableRow[] {
  if (!selfId) return rows
  const selfIndex = rows.findIndex((row) => row.id === selfId)
  if (selfIndex < 0) return rows
  const selfDepth = rows[selfIndex].depth
  const blocked = new Set<string>([selfId])
  for (let index = selfIndex + 1; index < rows.length; index += 1) {
    if (rows[index].depth <= selfDepth) break
    blocked.add(rows[index].id)
  }
  return rows.filter((row) => !blocked.has(row.id))
}
