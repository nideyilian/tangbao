/**
 * 中控台 · 左侧项目树。
 *
 * 它是**整个框架的唯一管理入口**：业务线 → 产品 → 方向的层级在这里增删改查。
 * 画廊侧栏与项目树读的是同一份 `useAssetLibraryStore.collections`，
 * 所以这里改一笔，那两处自动跟上 —— 树只有一份，没有「同步」这个动作。
 *
 * 右边那排 tab（水印 / 输出位置 / 渠道与尺寸 / 分发）**跟着这棵树走**：
 * 树上选到哪一层，右区改的就是那一层的参数；选「全局默认」改的是全局基线。
 *
 * ```
 * ▾ 智能客服            ← 业务线（点名称 = 选中；悬停出行内操作）
 *     ▾ 机器人           ← 产品
 *         竖版展示        ← 方向
 * ```
 *
 * ## 两个刻意的做法
 *
 * 1. **增删改查在树里直接做**（行内输入框，不弹窗）。这是杰哥 2026-09-21 的要求：
 *    树不只是显示，还要"能增加业务线、产品、方向，增删改查"。行内编辑的好处是
 *    改完立刻在树上看到结果，层级关系不会被弹窗遮住。
 * 2. **删掉当前选中节点时，作用域一并归位到「全局默认」**。否则右区标题会指着一个
 *    已经不存在的节点，参数写进去没人看得到。
 *
 * ## 前身教训（2026-09-21 上午，别再犯）
 *
 * 曾把「配置维度」挂成树的一级，做成「维度 → 作用域」两级树。结果**每个能按方向配的
 * 维度各挂了一棵完整的作用域树**：展开水印组是一棵，展开输出位置组又是一棵，
 * 两棵一模一样 —— 维度和作用域是两个控件维度，套成一层嵌套必然会复制数据。
 * 现在**树只有一棵，维度交给右区的 tab**。
 */

import { useMemo, useState } from 'react'
import { Button, SearchField, SegmentedControl } from '../../../design-system'
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, PlusIcon, TrashIcon } from '../../../design-system/icons'
import { buildPostprocessProjectTree, flattenPostprocessProjectTree } from '../../../lib/postprocessProjectTree'
import type { PostprocessProjectTreeNode } from '../../../lib/postprocessProjectTree'
import { useStore } from '../../../store'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { isGlobalScope, type ConsoleScope } from '../lib/controlConsoleSections'

interface Props {
  /** 当前选中的作用域（`GLOBAL_NODE_ID` 或某个 collection id） */
  value: ConsoleScope
  onValueChange: (value: ConsoleScope) => void
}

/** 正在编辑哪一格：新增（挂在谁下面）或改名（改哪一个）。 */
type EditTarget = { kind: 'create'; parentId: string | null } | { kind: 'rename'; id: string }

/**
 * 缩进阶梯：每深一层缩进一级，超过就不再缩（深层节点挤在左栏没法看）。
 */
const INDENT_CLASS = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const

export function ConsoleAssetTree({ value, onValueChange }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const createCollection = useAssetLibraryStore((state) => state.createCollection)
  const renameCollection = useAssetLibraryStore((state) => state.renameCollection)
  const deleteCollection = useAssetLibraryStore((state) => state.deleteCollection)
  const restoreCollection = useAssetLibraryStore((state) => state.restoreCollection)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  const [query, setQuery] = useState('')
  /** 灵境的「全部 / 已归档」两个 tab；糖包对应「全部 / 回收站」 */
  const [tab, setTab] = useState<'active' | 'trashed'>('active')
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState('')

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
  /** 回收站视图是平铺列表（回收节点在数据源里已被放到根上），把树摊平即可 */
  const trashedFlat = useMemo(() => flattenPostprocessProjectTree(visibleTree), [visibleTree])

  const toggleExpand = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  /** 某节点下面的全部后代 id（删除前算影响面，删后判断作用域要不要归位）。 */
  const descendantsOf = (id: string): string[] => {
    const result: string[] = []
    const walk = (parentId: string) => {
      for (const item of collections) {
        if (item.parentId === parentId) {
          result.push(item.id)
          walk(item.id)
        }
      }
    }
    walk(id)
    return result
  }

  const startCreate = (parentId: string | null) => {
    setEditing({ kind: 'create', parentId })
    setDraft('')
  }

  const startRename = (nodeId: string, currentName: string) => {
    setEditing({ kind: 'rename', id: nodeId })
    setDraft(currentName)
  }

  const cancelEdit = () => {
    setEditing(null)
    setDraft('')
  }

  /**
   * 提交当前编辑。
   *
   * 新建成功后**自动选中新节点**并把父级展开 —— 用户加完一个方向，下一步必然是在
   * 右区给它配参数；不选中的话他还得自己在树上再找一遍。
   */
  const submitEdit = async () => {
    const target = editing
    if (!target) return
    const name = draft.trim()
    if (!name) {
      cancelEdit()
      return
    }
    if (target.kind === 'rename') {
      cancelEdit()
      try {
        await renameCollection(target.id, name)
      } catch {
        showToast('改名失败，请重试', 'error')
      }
      return
    }
    cancelEdit()
    try {
      const created = await createCollection(name, target.parentId)
      if (!created) {
        showToast('同级已有同名节点', 'error')
        return
      }
      if (target.parentId) {
        setExpandedIds((current) => new Set(current).add(target.parentId!))
      }
      onValueChange(created.id)
    } catch {
      showToast('创建失败，请重试', 'error')
    }
  }

  const askDelete = (node: PostprocessProjectTreeNode) => {
    const removed = [node.id, ...descendantsOf(node.id)]
    const descendantCount = removed.length - 1
    setConfirmDialog({
      title: `删除「${node.name}」？`,
      message:
        (descendantCount > 0 ? `这会连同 ${descendantCount} 个子节点一起删除。` : '') +
        '此操作不可恢复（可在素材库里撤销）。文件夹内的图片不会被删除，只会变为「未整理」；节点上已配置的参数会保留，若之后重建同名结构不会自动继承。',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger',
      action: () => {
        void deleteCollection(node.id)
        // 删掉正是当前作用域（或它的某个后代）时归位全局，否则右区会指着一个不存在的节点
        if (removed.includes(value)) onValueChange(GLOBAL_NODE_ID)
      },
    })
  }

  /** 行内输入框：改名与新增共用一套键盘行为（回车提交、Esc 取消）。 */
  const renderEditor = (placeholder: string) => (
    <input
      autoFocus
      aria-label={placeholder}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void submitEdit()
        if (event.key === 'Escape') cancelEdit()
      }}
      className="ds-input h-6 min-w-0 flex-1 px-1.5 py-0 text-sm"
    />
  )

  const renderCreateRow = (depth: number) => (
    <div
      data-layout="console-tree-new"
      className={`mr-2 flex items-center gap-1 rounded-ds-lg pr-1 ${INDENT_CLASS[Math.min(depth, 3)]}`}
    >
      <span className="h-6 w-6 shrink-0" aria-hidden="true" />
      {renderEditor('名称，回车确认')}
    </div>
  )

  const renderTrashedRow = (node: PostprocessProjectTreeNode) => (
    <div
      key={node.id}
      data-layout="console-tree-node"
      className={`group mr-2 flex items-center gap-1 rounded-ds-lg pr-1 ${INDENT_CLASS[0]}`}
    >
      <span className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate py-1.5 text-sm text-ds-text/80 dark:text-ds-text/80">{node.name}</span>
      <button
        type="button"
        aria-label={`恢复 ${node.name}`}
        className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-ds-md px-1.5 text-xs text-ds-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 dark:text-ds-muted"
        onClick={() => void restoreCollection(node.id)}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        恢复
      </button>
    </div>
  )

  /** 渲染项目树。行内操作只在悬停/聚焦时出现，避免默认状态下满屏按钮。 */
  const renderNodes = (nodes: PostprocessProjectTreeNode[]) => (
    <>
      {nodes.map((node) => {
        const expanded = searching || expandedIds.has(node.id)
        const hasChildren = searching || parentIds.has(node.id)
        const selected = value === node.id
        const renaming = editing?.kind === 'rename' && editing.id === node.id
        return (
          <div key={node.id}>
            <div
              data-layout="console-tree-node"
              className={`group mr-2 flex items-center gap-1 rounded-ds-lg pr-1 ${
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

              {renaming ? (
                renderEditor(`重命名 ${node.name}`)
              ) : (
                <>
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
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      aria-label={`在 ${node.name} 下新增`}
                      title="新增子级"
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-ds-md text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-ds-text"
                      onClick={() => startCreate(node.id)}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`重命名 ${node.name}`}
                      title="重命名"
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-ds-md text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-ds-text"
                      onClick={() => startRename(node.id, node.name)}
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${node.name}`}
                      title="删除"
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-ds-md text-ds-muted hover:text-ds-danger dark:text-ds-muted"
                      onClick={() => askDelete(node)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/*
              新增子级的输入框**不能**放在「展开且已有子节点」的分支里：给一个还没有
              子节点的方向加子级，恰恰就是这种情况 —— 那样点了「+」什么都不会出现。
            */}
            {editing?.kind === 'create' && editing.parentId === node.id && renderCreateRow(node.depth + 2)}
            {expanded && node.children.length > 0 && <div>{renderNodes(node.children)}</div>}
          </div>
        )
      })}
    </>
  )

  return (
    <nav
      aria-label="项目树"
      className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-ds-border dark:border-ds-border"
    >
      <div className="shrink-0 space-y-2 px-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ds-text dark:text-ds-text">项目树</h2>
          {/* 图标走 `leadingIcon`：塞进 children 时 Tailwind preflight 的 `svg { display: block }`
              会把图标顶成单独一行，文字被挤到第二行（图标压在「业务线」上方）。 */}
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={() => startCreate(null)}
          >
            业务线
          </Button>
        </div>
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

      {/* 全部视图：业务线 → 产品 → 方向。
          **条件渲染，不用 CSS 隐藏** —— 隐藏的话这棵树还留在 DOM 里，切到回收站时
          页面里就同时有两份节点，等于自己把同一棵树复制了一遍（展开态存在 state 里，不会丢）。 */}
      {tab === 'active' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-2">
          <button
            type="button"
            aria-label="全局默认"
            aria-current={isGlobalScope(value) ? 'true' : undefined}
            className={`mb-1 mr-2 flex w-[calc(100%-0.5rem)] cursor-pointer items-center rounded-ds-lg py-1.5 text-left ${INDENT_CLASS[1]} ${
              isGlobalScope(value) ? 'bg-ds-subtle dark:bg-ds-subtle' : ''
            }`}
            onClick={() => onValueChange(GLOBAL_NODE_ID)}
          >
            <span
              className={`truncate text-sm ${
                isGlobalScope(value)
                  ? 'font-medium text-ds-text dark:text-ds-text'
                  : 'text-ds-text/80 dark:text-ds-text/80'
              }`}
            >
              全局默认
            </span>
          </button>

          {editing?.kind === 'create' && editing.parentId === null && renderCreateRow(1)}
          {renderNodes(visibleTree)}
          {visibleTree.length === 0 && editing?.kind !== 'create' && (
            <p className={`${INDENT_CLASS[1]} py-2 pr-2 text-xs text-ds-muted dark:text-ds-muted`}>
              {searching ? '没有匹配的节点。' : '还没有节点，点右上角「业务线」开始。'}
            </p>
          )}
        </div>
      )}

      {/* 回收站视图：只列已回收节点，不套层级 —— 它们在参数解析里已经出局，
          这里点选只用于「看一眼有哪些、要不要恢复」，不会成为编辑作用域。 */}
      {tab === 'trashed' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-2">
          {trashedFlat.map(renderTrashedRow)}
          {visibleTree.length === 0 && (
            <p className="px-2 py-3 text-xs text-ds-muted dark:text-ds-muted">回收站是空的。</p>
          )}
        </div>
      )}
    </nav>
  )
}
