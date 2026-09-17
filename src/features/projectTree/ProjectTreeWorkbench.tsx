/**
 * 统一项目树工作台：一张表管完「产品线 → 产品 → 方向」的结构与参数。
 *
 * 这是左侧栏 / SOP 管理 / 后处理 / 水印四个模块的**共同上游**：
 * - 结构改动走 `useAssetLibraryStore` 的 collections CRUD → 左侧栏即时同步，
 *   SOP 分组经既有镜像链路自动跟上（`src/lib/sopGroupMirror.ts`，订阅 collections 变化）；
 * - 参数写进 `useProjectTreeParamsStore`，后处理执行时按图片归属自动取用。
 *
 * 所以这里没有「同步按钮」——所有改动都是一次写入、多处生效。
 */

import { useCallback, useMemo, useState } from 'react'
import { Button, Dialog, SelectField, TextField } from '../../design-system'
import { SearchIcon } from '../../components/icons'
import { useStore } from '../../store'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useAssetLibraryStore } from '../assetLibrary/store'
import ProjectNodeParamsDialog from './ProjectNodeParamsDialog'
import ProjectTreeTable from './ProjectTreeTable'
import { buildProjectTreeTableRows, filterProjectTreeTableRows, summarizeProjectTreeRows } from './tableRows'
import type { ProjectTreeTableRow } from './tableRows'
import { useProjectTreeParamsStore } from './storeProjectTreeParams'

interface Props {
  onClose: () => void
}

const ROOT_VALUE = ''

/** 新增节点弹窗：名称 + 挂到哪一级。 */
function AddNodeDialog({
  defaultParentId,
  rows,
  onCancel,
  onSubmit,
}: {
  defaultParentId: string | null
  rows: ProjectTreeTableRow[]
  onCancel: () => void
  onSubmit: (name: string, parentId: string | null) => void
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState(defaultParentId ?? ROOT_VALUE)

  const options = useMemo(
    () => [
      { value: ROOT_VALUE, label: '（根级 · 新建产品线）' },
      ...rows.map((row) => ({ value: row.id, label: row.path })),
    ],
    [rows],
  )

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed, parentId || null)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title="新增节点"
      description="挂在产品线下就是产品，挂在产品下就是方向。层级只影响命名里的 {line}/{product}/{direction} 取哪一段。"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={!name.trim()} onClick={submit}>
            创建
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField
          label="名称"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        <SelectField
          label="上级"
          value={parentId}
          options={options}
          onChange={(event) => setParentId(event.target.value)}
        />
      </div>
    </Dialog>
  )
}

export default function ProjectTreeWorkbench({ onClose }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const createCollection = useAssetLibraryStore((state) => state.createCollection)
  const renameCollection = useAssetLibraryStore((state) => state.renameCollection)
  const deleteCollection = useAssetLibraryStore((state) => state.deleteCollection)
  const params = useProjectTreeParamsStore((state) => state.params)
  // 启用范围与「节点参数」共用同一棵树，但分开存：前者是全局勾选（决定跑不跑），后者按节点存（决定怎么跑）
  const selectedCollectionIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
  const toggleSelectedCollection = usePostprocessMediaStore((state) => state.toggleSelectedCollection)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const showToast = useStore((state) => state.showToast)

  const [keyword, setKeyword] = useState('')
  const [paramTarget, setParamTarget] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null)

  const rows = useMemo(
    () => buildProjectTreeTableRows(collections, params, selectedCollectionIds),
    [collections, params, selectedCollectionIds],
  )
  const visibleRows = useMemo(() => filterProjectTreeTableRows(rows, keyword), [rows, keyword])
  const stats = useMemo(() => summarizeProjectTreeRows(rows), [rows])

  const describeSource = useCallback(
    (row: ProjectTreeTableRow) => {
      if (!row.paramsSourcedFrom) return '全局默认'
      if (row.paramsSourcedFrom === row.id) return '本级已设置'
      const node = collections.find((item) => item.id === row.paramsSourcedFrom)
      return `继承自「${node?.name ?? '已删除节点'}」`
    },
    [collections],
  )

  const handleCreate = async (name: string, parentId: string | null) => {
    setAdding(null)
    try {
      const created = await createCollection(name, parentId)
      if (!created) showToast('创建失败：同级已有同名节点', 'error')
    } catch {
      showToast('创建失败，请重试', 'error')
    }
  }

  const handleRename = async (collectionId: string, name: string) => {
    try {
      await renameCollection(collectionId, name)
    } catch {
      showToast('重命名失败，请重试', 'error')
    }
  }

  const handleDelete = (row: ProjectTreeTableRow) => {
    const descendantCount = rows.filter((item) => item.id !== row.id && item.path.startsWith(`${row.path} / `)).length
    setConfirmDialog({
      title: `删除「${row.name}」？`,
      message:
        (descendantCount > 0 ? `这会连同 ${descendantCount} 个子节点一起删除。` : '') +
        '此操作不可恢复（可在素材库里撤销）。文件夹内的图片不会被删除，只会变为「未整理」；节点上已配置的参数会保留，若之后重建同名结构不会自动继承。',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger',
      action: () => {
        void deleteCollection(row.id)
      },
    })
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title="项目树"
        description="产品线 → 产品 → 方向。结构在这里改，左侧栏与 SOP 分组同步；「后处理」列勾选即启用该分支，参数按图片所在方向自动取用，无需逐张挑选。"
        size="xl"
        footer={
          <>
            <span className="self-center text-xs text-ds-muted dark:text-ds-muted">
              {stats.line} 条产品线 · {stats.product} 个产品 · {stats.direction} 个方向 · {stats.configured}{' '}
              个节点已配参数 · {stats.enabled} 个节点在启用范围内
            </span>
            <Button onClick={onClose}>完成</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <TextField
              label=""
              containerClassName="w-64"
              placeholder="搜索名称或路径，如「保险 / 百万医疗险」"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {keyword.trim() && (
              <Button variant="ghost" size="sm" onClick={() => setKeyword('')}>
                清除
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setAdding({ parentId: null })}>
              新建产品线
            </Button>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-ds-muted dark:text-ds-muted">
              <SearchIcon className="h-3.5 w-3.5" />共 {rows.length} 个节点，显示 {visibleRows.length} 个
            </span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            <ProjectTreeTable
              rows={visibleRows}
              describeSource={describeSource}
              onAddChild={(parentId) => setAdding({ parentId })}
              onOpenParams={(collectionId) => setParamTarget(collectionId)}
              onRename={(collectionId, name) => void handleRename(collectionId, name)}
              onDelete={handleDelete}
              onTogglePostprocess={toggleSelectedCollection}
            />
          </div>
        </div>
      </Dialog>

      {adding && (
        <AddNodeDialog
          defaultParentId={adding.parentId}
          rows={rows}
          onCancel={() => setAdding(null)}
          onSubmit={(name, parentId) => void handleCreate(name, parentId)}
        />
      )}

      {paramTarget && <ProjectNodeParamsDialog collectionId={paramTarget} onClose={() => setParamTarget(null)} />}
    </>
  )
}
