/**
 * 中控台 · 「方向」分区的两张表（TB-060）。
 *
 * ## 为什么这里要有两张表
 *
 * 「方向」（`AssetCollection` 树）是数据本体的骨架，但它原先只能通过左树导航与
 * 「新建方向」按钮间接管理 —— 改名、改归属、删层级，以及每个方向的参与方式与输出目录，
 * 都没有一个集中的编辑入口。这一区把它补齐：
 *
 * | 表       | 管什么                                     | 行主键         |
 * | -------- | ------------------------------------------ | -------------- |
 * | 方向结构 | 名称 / 层级 / 上级 / 子项数 / 增删          | `collectionId` |
 * | 方向参数 | 参与产出 / 输出目录 / 水印数 / 设置来源     | `collectionId` |
 *
 * ## 三条刻意的口径
 *
 * 1. **行序 = 左树的深度优先顺序**（`buildDirectionRows`）。表格与树对不上号是最容易
 *    让人改错行的地方；按同一顺序展开，用户一眼能找到同一行的两处。
 * 2. **参数表显示的是「生效值」而不是「本级写了什么」**，并单开一列「设置来源」
 *    （本级 / 继承 / 全局）说明它是哪来的。只显示本级值会让「空着 = 什么都不产出」被误读 ——
 *    实际是向上继承。
 * 3. **水印清单只读**。它的编辑入口在「水印」分区的归属表 —— 一个参数只有一个入口，
 *    这是仓库反复强调过的（`paramSchema.ts` 头注里记着「同一个参数两个入口」的历史教训）。
 *    这里只显示数量，点水印分区去改。
 *
 * ## 环保护
 *
 * 「上级」列的候选项要排除**自己与自己的全部后代**（`collectSubtreeIds`）：
 * 把一个节点挂到自己的子孙下面会让树成环，`buildDirectionRows` 的遍历与左树的渲染
 * 都会死循环。store 层不保证校验，所以这一层必须挡住。
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  DataGrid,
  IconButton,
  SectionHeader,
  TextField,
  type DataGridColumn,
} from '../../../design-system'
import { PlusIcon, TrashIcon } from '../../../design-system/icons'
import { useStore } from '../../../store'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import {
  resolveProjectNodeKind,
  resolveNodeWatermarkBinding,
  resolveProjectPostprocessSlice,
} from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { useCompositeV2Store } from '../storeV2'
import { usePostprocessGlobalConfig } from '../../postprocess/usePostprocessGlobalConfig'
import type { AssetCollection } from '../../../types'

/** 表格行：集合本身 + 它在树里的深度与路径（路径给「层级路径」列用）。 */
export interface DirectionTableRow extends AssetCollection {
  depth: number
  pathNames: string[]
}

const LEVEL_LABELS: Record<string, string> = {
  line: '产品线',
  product: '产品',
  direction: '方向',
  extra: '扩展层',
}

/**
 * 收集某个节点的整棵子树 id（含它自己）。
 *
 * 用于两处：挡住「把节点挂到自己的子孙下」（会成环），以及删除前告知会影响多少个子项。
 */
export function collectSubtreeIds(collections: AssetCollection[], rootId: string): Set<string> {
  const result = new Set<string>([rootId])
  let changed = true
  // 迭代到不动点而不是递归：兄弟顺序里可能有「后出现的父节点」，一趟扫不全
  while (changed) {
    changed = false
    for (const item of collections) {
      if (!item.parentId) continue
      if (result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id)
        changed = true
      }
    }
  }
  return result
}

/**
 * 把集合展开成「按树序排列」的表格行。
 *
 * 递归里带 `visited` 不是为了性能：脏数据（`parentId` 互指）会让遍历无限递归，
 * 拼错一个 id 就能让整个工作区白屏。宁可少显示几行，也不能死循环。
 */
export function buildDirectionRows(collections: AssetCollection[]): DirectionTableRow[] {
  const byParent = new Map<string | null, AssetCollection[]>()
  for (const item of collections) {
    const key = item.parentId ?? null
    const list = byParent.get(key)
    if (list) list.push(item)
    else byParent.set(key, [item])
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order)

  const result: DirectionTableRow[] = []
  const visited = new Set<string>()
  const walk = (parentId: string | null, depth: number, pathNames: string[]) => {
    for (const item of byParent.get(parentId) ?? []) {
      if (visited.has(item.id)) continue
      visited.add(item.id)
      const nextPath = [...pathNames, item.name]
      result.push({ ...item, depth, pathNames: nextPath })
      walk(item.id, depth + 1, nextPath)
    }
  }
  walk(null, 0, [])
  return result
}

export function ConsoleDirectionTables() {
  const collections = useAssetLibraryStore((state) => state.collections)
  const createCollection = useAssetLibraryStore((state) => state.createCollection)
  const renameCollection = useAssetLibraryStore((state) => state.renameCollection)
  const moveCollection = useAssetLibraryStore((state) => state.moveCollection)
  const deleteCollection = useAssetLibraryStore((state) => state.deleteCollection)

  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)

  const presets = useCompositeV2Store((state) => state.presets)
  const globalPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const globalConfig = usePostprocessGlobalConfig()

  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  const [newRootName, setNewRootName] = useState('')

  const rows = useMemo(() => buildDirectionRows(collections), [collections])
  const presetNames = useMemo(() => Object.fromEntries(presets.map((preset) => [preset.id, preset.name])), [presets])

  /**
   * 每行的生效值。**预算一次**而不是在列的 `getValue` 里各算一遍 —— 那是 O(行 × 链深)，
   * 而且 `getValue` 会被 DataGrid 在每次渲染时对每个单元格调用一次。
   */
  const resolved = useMemo(() => {
    const map = new Map<
      string,
      { enabled: boolean; outputDir: string; sourcedFrom: string | null; watermarkNames: string[] }
    >()
    for (const row of rows) {
      const slice = resolveProjectPostprocessSlice(collections, params, row.id, globalConfig)
      const binding = resolveNodeWatermarkBinding(collections, params, row.id, globalPresetIds)
      map.set(row.id, {
        enabled: slice.enabled,
        outputDir: slice.config.outputDir,
        sourcedFrom: slice.sourcedFrom,
        watermarkNames: binding.presetIds.map((id) => presetNames[id] ?? id),
      })
    }
    return map
  }, [rows, collections, params, globalConfig, globalPresetIds, presetNames])

  /** 「上级」的候选项：顶层 + 所有节点，**排除自己与自己的后代**（理由见头注「环保护」）。 */
  const parentOptionsFor = useCallback(
    (row: DirectionTableRow) => {
      const blocked = collectSubtreeIds(collections, row.id)
      return [
        { value: '', label: '（顶层）' },
        ...collections.filter((item) => !blocked.has(item.id)).map((item) => ({ value: item.id, label: item.name })),
      ]
    },
    [collections],
  )

  const confirmDelete = useCallback(
    (row: DirectionTableRow) => {
      const affected = collectSubtreeIds(collections, row.id).size
      const hasChildren = affected > 1
      setConfirmDialog({
        title: `删除「${row.name}」？`,
        message: hasChildren
          ? `它有 ${affected - 1} 个子项（连同它们的参数一起）会被移入回收站。素材本身不会被删除。`
          : '它会连同参数一起被移入回收站。素材本身不会被删除。',
        confirmText: '删除',
        cancelText: '取消',
        tone: 'danger',
        action: () => {
          void deleteCollection(row.id)
        },
      })
    },
    [collections, deleteCollection, setConfirmDialog],
  )

  // ---- 表一：方向结构 ----
  const structureColumns = useMemo<Array<DataGridColumn<DirectionTableRow>>>(
    () => [
      {
        key: 'name',
        header: '名称',
        help: '产品线 / 产品 / 方向的显示名。同名不冲突，但同级同名容易看错。',
        editor: 'text',
        width: 220,
        validate: (value, row) => {
          const text = String(value ?? '').trim()
          if (!text) return '名称不能为空'
          const siblingDuplicated = collections.some(
            (item) => item.id !== row.id && item.parentId === row.parentId && item.name === text,
          )
          return siblingDuplicated ? '同级已有同名项' : null
        },
      },
      {
        key: 'level',
        header: '层级',
        help: '前三层固定是产品线 / 产品 / 方向，更深归为扩展层。',
        editor: 'readonly',
        width: 88,
        getValue: (row) => LEVEL_LABELS[resolveProjectNodeKind(row.depth)] ?? '扩展层',
      },
      {
        key: 'parentId',
        header: '上级',
        help: '改这一列即把整棵子树挂到别处。候选项里不会有它自己或它的子孙。',
        editor: 'select',
        width: 180,
        optionsForRow: parentOptionsFor,
      },
      {
        key: 'childCount',
        header: '子项',
        editor: 'readonly',
        width: 64,
        align: 'end',
        getValue: (row) => collections.filter((item) => item.parentId === row.id).length,
      },
      {
        key: 'actions',
        header: '',
        editor: 'readonly',
        width: 132,
        render: (row) => (
          <span className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void createCollection('新方向', row.id)
              }}
            >
              加子方向
            </Button>
            <IconButton
              size="sm"
              aria-label={`删除方向 ${row.name}`}
              icon={<TrashIcon className="h-3.5 w-3.5" />}
              onClick={() => confirmDelete(row)}
            />
          </span>
        ),
      },
    ],
    [collections, confirmDelete, createCollection, parentOptionsFor],
  )

  const commitStructure = useCallback(
    (rowId: string, columnKey: string, value: unknown) => {
      if (columnKey === 'name') {
        void renameCollection(rowId, String(value ?? ''))
        return
      }
      if (columnKey === 'parentId') {
        const next = String(value ?? '')
        void moveCollection(rowId, next === '' ? null : next)
      }
    },
    [moveCollection, renameCollection],
  )

  // ---- 表二：方向级参数 ----
  const paramColumns = useMemo<Array<DataGridColumn<DirectionTableRow>>>(
    () => [
      {
        key: 'path',
        header: '方向',
        help: '产品线 / 产品 / 方向 的完整路径。',
        editor: 'readonly',
        width: 260,
        getValue: (row) => row.pathNames.join(' / '),
      },
      {
        key: 'sourcedFrom',
        header: '设置来源',
        help: '「本级」= 这个方向自己写了参数；「继承」= 沿用更上层；「全局」= 没人写，用全局默认。',
        editor: 'readonly',
        width: 88,
        getValue: (row) => {
          const source = resolved.get(row.id)?.sourcedFrom ?? null
          if (source === null) return '全局'
          return source === row.id ? '本级' : '继承'
        },
      },
      {
        key: 'enabled',
        header: '参与产出',
        help: '关掉后这个方向不产出变体，原图照常保存。',
        editor: 'switch',
        width: 88,
        getValue: (row) => resolved.get(row.id)?.enabled ?? true,
      },
      {
        key: 'outputDir',
        header: '输出目录',
        help: '留空 = 向上继承。改这里只影响这一个方向。',
        editor: 'path',
        width: 320,
        placeholder: '留空则向上继承',
        getValue: (row) => resolved.get(row.id)?.outputDir ?? '',
        pickPath: async () => {
          try {
            return (await window.electronAPI?.selectDirectory?.()) ?? null
          } catch {
            showToast('选择目录失败，请重试', 'error')
            return null
          }
        },
      },
      {
        key: 'watermarks',
        header: '水印',
        help: '只读。改水印请到「水印」分区的归属表 —— 一个参数只有一个入口。',
        editor: 'readonly',
        width: 220,
        getValue: (row) => {
          const names = resolved.get(row.id)?.watermarkNames ?? []
          return names.length > 0 ? names.join('、') : '不加水印'
        },
      },
    ],
    [resolved, showToast],
  )

  const commitParam = useCallback(
    (rowId: string, columnKey: string, value: unknown) => {
      if (columnKey === 'enabled') {
        setPostprocessOverride(rowId, { enabled: value === true })
        return
      }
      if (columnKey === 'outputDir') {
        const next = String(value ?? '').trim()
        // 清空 = 恢复继承，而不是「覆盖成空目录」—— 写 undefined 才是「不表态」
        setPostprocessOverride(rowId, { outputDir: next === '' ? undefined : next })
      }
    },
    [setPostprocessOverride],
  )

  const handleAddRoot = () => {
    const trimmed = newRootName.trim()
    if (!trimmed) return
    void createCollection(trimmed, null)
    setNewRootName('')
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionHeader
          title="方向结构"
          description="产品线 / 产品 / 方向 的层级与归属。左树是导航，这里是同一份数据的表格视图，改哪边都一样。"
        />
        <DataGrid
          aria-label="方向结构表"
          columns={structureColumns}
          rows={rows}
          getRowId={(row) => row.id}
          onCellCommit={commitStructure}
          emptyTitle="还没有任何方向"
          emptyDescription="在下面新建一个产品线，再往里加产品与方向。"
        />
        <div className="flex items-center gap-2">
          <TextField
            label=""
            aria-label="新产品线名称"
            containerClassName="min-w-0 flex-1"
            placeholder="新产品线名称"
            value={newRootName}
            onChange={(event) => setNewRootName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleAddRoot()
            }}
          />
          <Button variant="secondary" disabled={!newRootName.trim()} onClick={handleAddRoot}>
            <PlusIcon className="h-3.5 w-3.5" />
            新建产品线
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="方向参数"
          description="每个方向参不参与产出、产出到哪。显示的是沿继承链解析后的生效值，「设置来源」说明它是哪来的。"
        />
        {rows.length === 0 && <Alert tone="info">还没有方向。先在上面建产品线与方向。</Alert>}
        <DataGrid
          aria-label="方向参数表"
          columns={paramColumns}
          rows={rows}
          getRowId={(row) => row.id}
          onCellCommit={commitParam}
        />
        <p className="text-xs text-ds-muted dark:text-ds-muted">
          水印归属在「水印」分区编辑；这里只读展示，避免同一个参数出现两个入口。
        </p>
      </section>
    </div>
  )
}

export default ConsoleDirectionTables
