/**
 * 统一项目树表格。
 *
 * 刻意用**展平表格**而不是可折叠树控件：这一屏的目的是「俯视整棵树、批量核对哪里配错了参数」，
 * 一次看全比逐级点开更省事；层级靠缩进 + 徽章表达，搜索时命中项的祖先链会自动保留。
 *
 * 组件本身不持有结构数据：行的增删改一律交给上层调 `useAssetLibraryStore` 的 collections CRUD，
 * 这样左侧栏与 SOP 分组会通过既有链路自动跟上，不存在「表格里改了、别处还是旧的」。
 */

import { useState } from 'react'
import {
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from '../../design-system'
import { PencilIcon, PlusIcon, SlidersHorizontalIcon, TrashIcon } from '../../components/icons'
import type { ProjectTreeTableRow } from './tableRows'
import { PROJECT_NODE_KIND_LABELS } from './types'

interface Props {
  rows: ProjectTreeTableRow[]
  /** 把「生效参数来源」翻译成给人看的文案 */
  describeSource: (row: ProjectTreeTableRow) => string
  onAddChild: (parentId: string) => void
  onOpenParams: (collectionId: string) => void
  onRename: (collectionId: string, name: string) => void
  onDelete: (row: ProjectTreeTableRow) => void
  /** 切换该节点的后处理启用范围（勾了祖先则子级只读，见 `postprocessEnabledInherited`） */
  onTogglePostprocess: (collectionId: string) => void
}

/** 缩进用固定档位类名，不用内联 padding，保持与设计系统一致。 */
const INDENT_CLASS = ['pl-0', 'pl-4', 'pl-8', 'pl-12']

const chipClass =
  'inline-flex items-center gap-1 rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-1.5 py-0.5 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted'

/** 启用勾选的悬停说明：把「为什么这格点不动」直接写在 title 里，省得用户去猜。 */
function describeToggle(row: ProjectTreeTableRow): string {
  // 短句（2026-09-20 反馈「说明又长又说不明白」）：一句结论 + 一句「去哪改」
  if (row.postprocessEnabledInherited) return '继承上级；要单独改，去后处理面板'
  return row.postprocessEnabled ? '已启用：归属图片会产出变体' : '未启用：只保存原图'
}

export default function ProjectTreeTable({
  rows,
  describeSource,
  onAddChild,
  onOpenParams,
  onRename,
  onDelete,
  onTogglePostprocess,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const startRename = (row: ProjectTreeTableRow) => {
    setEditingId(row.id)
    setDraftName(row.name)
  }

  const commitRename = (row: ProjectTreeTableRow) => {
    const next = draftName.trim()
    setEditingId(null)
    if (!next || next === row.name) return
    onRename(row.id, next)
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="没有匹配的节点"
        description="调整关键词，或先新建一条产品线。结构在这里改完，左侧栏与 SOP 分组会同步更新。"
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>层级</TableHead>
          <TableHead>后处理</TableHead>
          <TableHead>后处理参数</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const indentClass = INDENT_CLASS[Math.min(row.depth, INDENT_CLASS.length - 1)]
          const editing = editingId === row.id
          return (
            <TableRow key={row.id}>
              <TableCell>
                <div className={`flex items-center gap-1.5 ${indentClass}`}>
                  {editing ? (
                    <TextField
                      label=""
                      containerClassName="flex-1"
                      autoFocus
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => commitRename(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(row)
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="truncate text-left text-xs text-ds-text hover:underline dark:text-ds-text"
                      title={row.path}
                      onClick={() => startRename(row)}
                    >
                      {row.name}
                    </button>
                  )}
                  {row.childCount > 0 && <span className={chipClass}>{row.childCount}</span>}
                </div>
              </TableCell>
              <TableCell>
                <span className={chipClass}>{PROJECT_NODE_KIND_LABELS[row.kind]}</span>
              </TableCell>
              <TableCell>
                <Checkbox
                  checked={row.postprocessEnabled}
                  disabled={row.postprocessEnabledInherited}
                  aria-label={`${row.path} 的后处理启用状态`}
                  title={describeToggle(row)}
                  onChange={() => onTogglePostprocess(row.id)}
                />
              </TableCell>
              <TableCell>
                <span className="text-xs text-ds-muted dark:text-ds-muted">{describeSource(row)}</span>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-0.5">
                  <IconButton
                    size="sm"
                    aria-label={`在 ${row.name} 下新增子级`}
                    title="新增子级"
                    icon={<PlusIcon className="h-3.5 w-3.5" />}
                    onClick={() => onAddChild(row.id)}
                  />
                  <IconButton
                    size="sm"
                    aria-label={`设置 ${row.name} 的参数`}
                    title="参数"
                    icon={<SlidersHorizontalIcon className="h-3.5 w-3.5" />}
                    onClick={() => onOpenParams(row.id)}
                  />
                  <IconButton
                    size="sm"
                    aria-label={`重命名 ${row.name}`}
                    title="重命名"
                    icon={<PencilIcon className="h-3.5 w-3.5" />}
                    onClick={() => startRename(row)}
                  />
                  <IconButton
                    size="sm"
                    aria-label={`删除 ${row.name}`}
                    title="删除"
                    icon={<TrashIcon className="h-3.5 w-3.5" />}
                    onClick={() => onDelete(row)}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** 供工作台复用的「新建产品线」动作按钮（保持表格区之外不散落样式）。 */
export function AddLineButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      新建产品线
    </Button>
  )
}
