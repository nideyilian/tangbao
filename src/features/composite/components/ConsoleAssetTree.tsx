/**
 * 中控台 · 左侧作用域树。
 *
 * 形态复刻「灵境 · 策略中心」（strategy/center）的左栏「策略资产库」：
 * 搜索框 + 「全部」总览项 + 产品线 → 产品 → 方向的树，节点行 = 展开箭头 + 名称 + 计数徽章。
 *
 * 在糖包里的语义映射：
 * - 灵境点方向看该方向的策略卡片 ⇒ 糖包点节点**切作用域**——右区从此编辑该节点的覆盖值；
 * - 灵境「全部策略 304」 ⇒ 糖包「全局默认」——回到全局基线的编辑位；
 * - 灵境节点徽章 = 该方向策略数 ⇒ 糖包节点徽章 = 该节点**写了多少个覆盖字段**
 *   （0 个不显示）。徽章回答的是「哪些节点偏离了全局」，与中控台「统一入口」的定位一致；
 * - 灵境回收站 ⇒ 糖包暂无对应实体，刻意不做。
 *
 * 树数据与水印归属树同源（`buildPostprocessProjectTree`，唯一主源 `AssetCollection`），
 * 但**不带拖拽 / 绑定**——那是水印分区内部归属树的职责，两棵树不要混。
 */

import { useMemo, useState } from 'react'
import { Badge, SearchField } from '../../../design-system'
import { ChevronDownIcon, ChevronRightIcon } from '../../../design-system/icons'
import { buildPostprocessProjectTree, flattenPostprocessProjectTree } from '../../../lib/postprocessProjectTree'
import type { PostprocessProjectTreeNode } from '../../../lib/postprocessProjectTree'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { isGlobalScope, type ConsoleScope } from '../lib/controlConsoleSections'

interface Props {
  value: ConsoleScope
  onValueChange: (value: ConsoleScope) => void
}

/**
 * 缩进阶梯：每深一层缩进一级，超过就不再缩（深层节点挤在左栏没法看）。
 * 与水印归属树同一口径。
 */
const INDENT_CLASS = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const

/** 数某节点写了几个覆盖字段。`byMedia` 整体算一个——用户感知上「按渠道配过」就是一条。 */
function countOverrideFields(nodeId: string, params: ReturnType<typeof useProjectTreeParamsStore.getState>['params']) {
  const override = params[nodeId]?.postprocess
  if (!override) return 0
  let count = 0
  if (override.outputDir !== undefined && override.outputDir !== '') count += 1
  if (override.watermarkPresetIds !== undefined) count += 1
  if (override.enabled !== undefined) count += 1
  if (override.byMedia !== undefined) count += 1
  return count
}

export function ConsoleAssetTree({ value, onValueChange }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const [query, setQuery] = useState('')

  const tree = useMemo(() => buildPostprocessProjectTree(collections), [collections])
  const flatNodes = useMemo(() => flattenPostprocessProjectTree(tree), [tree])
  /** 有子节点的 id 集合，用于判断该渲染展开箭头 */
  const parentIds = useMemo(
    () => new Set(flatNodes.filter((node) => node.children.length > 0).map((node) => node.id)),
    [flatNodes],
  )
  /** 默认全展开——灵境的树就是全展开形态，配置工作不需要先点一串箭头 */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(flatNodes.filter((node) => node.children.length > 0).map((node) => node.id)),
  )

  /**
   * 搜索过滤：命中节点与其**祖先链**保留，其余剪掉；搜索态下视为全展开
   * （否则「搜到了却折叠着看不见」，等于没搜）。
   */
  const visibleTree = useMemo(() => {
    const q = query.trim()
    if (!q) return tree
    const keep = (nodes: PostprocessProjectTreeNode[]): PostprocessProjectTreeNode[] => {
      const result: PostprocessProjectTreeNode[] = []
      for (const node of nodes) {
        const children = keep(node.children)
        if (node.name.includes(q) || children.length > 0) result.push({ ...node, children })
      }
      return result
    }
    return keep(tree)
  }, [tree, query])
  const searching = query.trim().length > 0

  const toggleExpand = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const globalSelected = isGlobalScope(value)
  const overrideCountByNode = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of flatNodes) map.set(node.id, countOverrideFields(node.id, params))
    return map
  }, [flatNodes, params])

  const renderNodes = (nodes: PostprocessProjectTreeNode[]) => (
    <>
      {nodes.map((node) => {
        const expanded = searching || expandedIds.has(node.id)
        const hasChildren = searching || parentIds.has(node.id)
        const selected = value === node.id
        const overrideCount = overrideCountByNode.get(node.id) ?? 0
        return (
          <div key={node.id}>
            <div
              data-layout="console-scope-node"
              className={`mr-2 flex items-center gap-1 rounded-ds-lg pr-1 ${INDENT_CLASS[Math.min(node.depth, 3)]} ${
                selected ? 'bg-ds-subtle dark:bg-ds-subtle' : ''
              }`}
            >
              <button
                type="button"
                aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
                aria-expanded={expanded}
                className={`flex h-6 w-6 shrink-0 items-center justify-center text-ds-muted dark:text-ds-muted ${
                  hasChildren ? 'cursor-pointer' : 'invisible'
                }`}
                onClick={() => hasChildren && toggleExpand(node.id)}
              >
                {expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left"
                onClick={() => onValueChange(node.id)}
              >
                <span
                  className={`truncate text-sm ${
                    selected ? 'font-medium text-ds-text dark:text-ds-text' : 'text-ds-text/80 dark:text-ds-text/80'
                  }`}
                >
                  {node.name}
                </span>
                {overrideCount > 0 && (
                  <Badge tone="warning" className="ml-auto shrink-0">
                    {overrideCount}
                  </Badge>
                )}
              </button>
            </div>
            {expanded && hasChildren && node.children.length > 0 && <div>{renderNodes(node.children)}</div>}
          </div>
        )
      })}
    </>
  )

  return (
    <nav
      aria-label="中控台作用域树"
      className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-ds-border dark:border-ds-border"
    >
      <div className="shrink-0 space-y-2 px-3 pt-3">
        <h2 className="text-sm font-semibold text-ds-text dark:text-ds-text">配置资产库</h2>
        <SearchField label="搜索节点" placeholder="搜索节点" size="sm" value={query} onChange={setQuery} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-2">
        {/* 「全局默认」= 灵境的「全部策略」总览项：回到全局基线的编辑位。徽章 = 节点总数 */}
        <div
          className={`mr-2 flex items-center rounded-ds-lg pl-2 pr-1 ${
            globalSelected ? 'bg-ds-subtle dark:bg-ds-subtle' : ''
          }`}
        >
          <button
            type="button"
            aria-current={globalSelected ? 'true' : undefined}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left"
            onClick={() => onValueChange(GLOBAL_NODE_ID)}
          >
            <span
              className={`truncate text-sm ${
                globalSelected ? 'font-medium text-ds-text dark:text-ds-text' : 'text-ds-text/80 dark:text-ds-text/80'
              }`}
            >
              全局默认
            </span>
            <Badge tone={globalSelected ? 'info' : 'neutral'} className="ml-auto shrink-0">
              {flatNodes.length}
            </Badge>
          </button>
        </div>

        {renderNodes(visibleTree)}
        {visibleTree.length === 0 && (
          <p className="px-2 py-3 text-xs text-ds-muted dark:text-ds-muted">
            {searching ? '没有匹配的节点。' : '还没有项目节点。'}
          </p>
        )}
      </div>
    </nav>
  )
}
