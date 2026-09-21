/**
 * 中控台 · 左侧配置资产库树（两级：**配置维度 → 作用域**）。
 *
 * 形态源头是「灵境 · 策略中心」的左栏「策略资产库」（搜索 + 总览项 + 项目树 +
 * 节点行 = 箭头 + 名称 + 计数徽章），糖包的语义映射：
 *
 * ```
 * ▾ 水印                      4        ← 一级 = 配置维度（维度组）
 *     全局默认                12       ← 二级 = 作用域（全局基线）
 *     ▾ 智能客服                      ← 二级 = 作用域（产品线 / 产品 / 方向）
 *         ▾ 机器人
 *             竖版展示
 * ▸ 输出位置
 * ▸ 渠道与尺寸                        ← scopeAware=false：不铺方向树
 * ▸ 分发
 * ▸ 方向
 * ```
 *
 * ## 为什么维度要在树里（2026-09-21 改版）
 *
 * 维度与作用域是同一个问题的两半（「改什么」×「改谁」）。改版前它们分散在
 * 「右区工具栏下拉 + 左树」两处：定一个落点要动两个地方，而且**「哪些维度能按方向配」
 * 这个约束在界面上完全看不出来**（用户会以为「渠道与尺寸」也能按方向配，选了半天方向
 * 却发现改的是全局 —— 那正是 `controlConsoleSections.ts` 头注里说的「给了作用域却
 * 什么都不变，比不给更糟」）。
 *
 * 合到一棵树之后：
 * 1. **点一次就到** —— 维度与作用域同时确定；
 * 2. **约束由结构表达** —— `scopeAware=false` 的维度下面只有「全局一套」一项，
 *    不铺方向树，用户一眼就知道它不按方向分；
 * 3. 右区工具栏空出一格，不再同时承担「切维度」与「筛当前维度内容」两种职责。
 *
 * ## 三条口径
 *
 * - **点纯全局维度会把作用域一并归位到「全局默认」**。否则右区标题显示着某个方向、
 *   内容却是全局一套，等于自己制造一次「所见非所改」。
 * - **展开状态跟着当前维度走**：切到哪个维度就展开哪个组（外部跳转改了 `section` 也会
 *   自动展开），其余组折叠 —— 不然 5 份作用域树同时铺开，这栏就没法看了。
 * - **搜索只作用于作用域树**，并在此态下只显示 `scopeAware` 的维度组：
 *   搜的是「方向名」，而纯全局维度里根本没有可搜的节点，留着只是噪音。
 */

import { useEffect, useMemo, useState } from 'react'
import { Badge, SearchField, SegmentedControl } from '../../../design-system'
import { ChevronDownIcon, ChevronRightIcon } from '../../../design-system/icons'
import { buildPostprocessProjectTree, flattenPostprocessProjectTree } from '../../../lib/postprocessProjectTree'
import type { PostprocessProjectTreeNode } from '../../../lib/postprocessProjectTree'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import {
  CONTROL_CONSOLE_SECTIONS,
  isGlobalScope,
  type ControlConsoleSection,
  type ControlConsoleSectionId,
  type ConsoleScope,
} from '../lib/controlConsoleSections'

interface Props {
  /** 当前配置维度 */
  section: ControlConsoleSectionId
  onSectionChange: (section: ControlConsoleSectionId) => void
  /** 当前作用域（`GLOBAL_NODE_ID` 或某个 collection id） */
  value: ConsoleScope
  onValueChange: (value: ConsoleScope) => void
}

/**
 * 缩进阶梯：每深一层缩进一级，超过就不再缩（深层节点挤在左栏没法看）。
 * 第 0 档留给维度组标题，作用域节点从第 1 档起。
 */
const INDENT_CLASS = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const

type ParamsMap = ReturnType<typeof useProjectTreeParamsStore.getState>['params']

/** 数某节点在**这个维度**上写了几个覆盖字段。 */
function countFieldsForSection(section: ControlConsoleSectionId, nodeId: string, params: ParamsMap): number {
  const override = params[nodeId]?.postprocess
  if (!override) return 0
  if (section === 'watermark') return override.watermarkPresetIds !== undefined ? 1 : 0
  if (section === 'output') {
    let count = 0
    // 空的 outputDir 不算「写了」—— 它与「没写」在解析里等价（都是向上继承）
    if (override.outputDir !== undefined && override.outputDir !== '') count += 1
    if (override.byMedia !== undefined) count += 1
    return count
  }
  // 其余维度不按方向分，节点上不存在属于它们的覆盖
  return 0
}

export function ConsoleAssetTree({ section, onSectionChange, value, onValueChange }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const [query, setQuery] = useState('')
  /** 灵境的「全部 / 已归档」两个 tab；糖包对应「全部 / 回收站」 */
  const [tab, setTab] = useState<'active' | 'trashed'>('active')
  const [expandedSections, setExpandedSections] = useState<Set<ControlConsoleSectionId>>(() => new Set([section]))

  /**
   * 当前维度必须展开：外部跳转（`useJumpToControlConsole`）只改 `section`，
   * 不展开的话用户跳过来看到的是折叠着的组 —— 等于没跳。
   */
  useEffect(() => {
    setExpandedSections((current) => {
      if (current.has(section)) return current
      const next = new Set(current)
      next.add(section)
      return next
    })
  }, [section])

  /**
   * 树数据源。回收站视图把 `trashedAt` 抹平后再建树——
   * `buildPostprocessProjectTree` 会过滤掉已回收节点，直接传进去只会得到空树。
   */
  const source = useMemo(() => {
    if (tab === 'active') return collections
    return collections.filter((item) => item.trashedAt).map((item) => ({ ...item, trashedAt: null, parentId: null }))
  }, [collections, tab])

  const tree = useMemo(() => buildPostprocessProjectTree(source), [source])
  const flatNodes = useMemo(() => flattenPostprocessProjectTree(tree), [tree])
  const trashedCount = useMemo(() => collections.filter((item) => item.trashedAt).length, [collections])
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
  /** 搜索态只留 scopeAware 的组：搜的是方向名，纯全局维度里没有可搜的节点 */
  const visibleSections = searching
    ? CONTROL_CONSOLE_SECTIONS.filter((item) => item.scopeAware)
    : CONTROL_CONSOLE_SECTIONS

  const toggleExpand = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const toggleSection = (id: ControlConsoleSectionId) => {
    setExpandedSections((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * 选中一个「维度 + 作用域」组合。
   *
   * 纯全局维度会**连带把作用域归位到全局默认**：否则右区标题写着某个方向、内容却是
   * 全局一套 —— 那正是这次改版要消灭的「所见非所改」。
   */
  const pickSection = (item: ControlConsoleSection, scope: ConsoleScope) => {
    onSectionChange(item.id)
    if (!item.scopeAware) onValueChange(GLOBAL_NODE_ID)
    else onValueChange(scope)
  }

  const overrideCountByNode = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of flatNodes) map.set(node.id, countFieldsForSection(section, node.id, params))
    return map
  }, [flatNodes, params, section])

  const globalSelected = isGlobalScope(value)

  /** 渲染作用域树。`ownerSection` 用来判断「这一行是不是当前维度的选中项」。 */
  const renderNodes = (nodes: PostprocessProjectTreeNode[], ownerSection: ControlConsoleSectionId) => (
    <>
      {nodes.map((node) => {
        const expanded = searching || expandedIds.has(node.id)
        const hasChildren = searching || parentIds.has(node.id)
        const selected = ownerSection === section && value === node.id
        const overrideCount = ownerSection === section ? (overrideCountByNode.get(node.id) ?? 0) : 0
        return (
          <div key={node.id}>
            <div
              data-layout="console-scope-node"
              className={`mr-2 flex items-center gap-1 rounded-ds-lg pr-1 ${
                INDENT_CLASS[Math.min(node.depth + 1, 3)]
              } ${selected ? 'bg-ds-subtle dark:bg-ds-subtle' : ''}`}
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
            {expanded && hasChildren && node.children.length > 0 && (
              <div>{renderNodes(node.children, ownerSection)}</div>
            )}
          </div>
        )
      })}
    </>
  )

  /** 「全局默认」行：所有维度都有（纯全局维度里它是唯一一项）。 */
  const renderGlobalRow = (item: ControlConsoleSection, hint?: string) => {
    const selected = section === item.id && globalSelected
    return (
      <div
        data-layout="console-scope-node"
        className={`mr-2 flex items-center rounded-ds-lg pr-1 ${INDENT_CLASS[1]} ${
          selected ? 'bg-ds-subtle dark:bg-ds-subtle' : ''
        }`}
      >
        <span className="h-6 w-6 shrink-0" aria-hidden="true" />
        <button
          type="button"
          aria-current={selected ? 'true' : undefined}
          aria-label={`${item.label} · 全局默认`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left"
          onClick={() => pickSection(item, GLOBAL_NODE_ID)}
        >
          <span
            className={`truncate text-sm ${
              selected ? 'font-medium text-ds-text dark:text-ds-text' : 'text-ds-text/80 dark:text-ds-text/80'
            }`}
          >
            {hint ?? '全局默认'}
          </span>
          {item.scopeAware && (
            <Badge tone={selected ? 'info' : 'neutral'} className="ml-auto shrink-0">
              {flatNodes.length}
            </Badge>
          )}
        </button>
      </div>
    )
  }

  /** 维度组标题行：展开箭头 + 名称 + 「有几个节点为它单独配过」的计数。 */
  const renderSectionRow = (item: ControlConsoleSection) => {
    const expanded = searching || expandedSections.has(item.id)
    const active = section === item.id
    const affected = item.scopeAware
      ? flatNodes.filter((node) => countFieldsForSection(item.id, node.id, params) > 0).length
      : 0
    return (
      <div data-layout="console-dimension-node" className="mr-2 flex items-center gap-1 rounded-ds-lg pl-2 pr-1">
        <button
          type="button"
          aria-label={expanded ? `收起配置维度 ${item.label}` : `展开配置维度 ${item.label}`}
          aria-expanded={expanded}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ds-muted dark:text-ds-muted"
          onClick={() => toggleSection(item.id)}
        >
          {expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          aria-current={active ? 'true' : undefined}
          aria-label={`配置维度 ${item.label}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 text-left"
          onClick={() => pickSection(item, value)}
        >
          <span
            className={`truncate text-sm font-medium ${
              active ? 'text-ds-text dark:text-ds-text' : 'text-ds-text/70 dark:text-ds-text/70'
            }`}
          >
            {item.label}
          </span>
          {affected > 0 && (
            <Badge tone="warning" className="ml-auto shrink-0" title="有节点单独配过这一项">
              {affected}
            </Badge>
          )}
        </button>
      </div>
    )
  }

  return (
    <nav
      aria-label="中控台配置资产库"
      className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-ds-border dark:border-ds-border"
    >
      <div className="shrink-0 space-y-2 px-3 pt-3">
        <h2 className="text-sm font-semibold text-ds-text dark:text-ds-text">配置资产库</h2>
        <SearchField label="搜索节点" placeholder="搜索节点" size="sm" value={query} onChange={setQuery} />
        {/* 灵境的「全部 N / 已归档」tab：糖包对应「全部 / 回收站」 */}
        <SegmentedControl
          aria-label="切换资产范围"
          size="sm"
          value={tab}
          options={[
            { value: 'active' as const, label: `全部 ${collections.length - trashedCount}` },
            { value: 'trashed' as const, label: `回收站 ${trashedCount}` },
          ]}
          onValueChange={setTab}
        />
      </div>

      {/* 全部视图：维度组 → 作用域 */}
      <div className={tab === 'active' ? 'min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-2' : 'hidden'}>
        {visibleSections.map((item) => {
          const expanded = searching || expandedSections.has(item.id)
          return (
            <div key={item.id} className="pb-1">
              {renderSectionRow(item)}
              {expanded &&
                (item.scopeAware ? (
                  <>
                    {renderGlobalRow(item)}
                    {renderNodes(visibleTree, item.id)}
                    {visibleTree.length === 0 && (
                      <p className={`${INDENT_CLASS[2]} py-2 pr-2 text-xs text-ds-muted dark:text-ds-muted`}>
                        {searching ? '没有匹配的节点。' : '还没有项目节点。'}
                      </p>
                    )}
                  </>
                ) : (
                  renderGlobalRow(item, '全局一套（不按方向分）')
                ))}
            </div>
          )
        })}
      </div>

      {/* 回收站视图：只列已回收节点，不套维度组 —— 回收站节点不参与参数解析，
          所以这里点选只用于「看一眼有哪些」，不会成为编辑作用域。 */}
      {tab === 'trashed' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-2">
          {renderNodes(visibleTree, section)}
          {visibleTree.length === 0 && (
            <p className="px-2 py-3 text-xs text-ds-muted dark:text-ds-muted">回收站是空的。</p>
          )}
        </div>
      )}
    </nav>
  )
}
