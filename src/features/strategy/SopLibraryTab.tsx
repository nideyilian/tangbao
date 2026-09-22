import { useEffect, useMemo, useRef, useState } from 'react'
import { usePersistedCollapsedIds } from '../../hooks/usePersistedCollapsedIds'
import {
  Badge,
  Button,
  DialogPane,
  DialogWorkspace,
  EmptyState,
  IconButton,
  Inline,
  ListRow,
  Menu,
  MenuItem,
  MenuSeparator,
  SearchField,
  SelectField,
  TextField,
} from '../../design-system'
import {
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  CopyIcon as Copy,
  FileImageIcon as FileImage,
  HistoryIcon as History,
  ListChecksIcon as ListChecks,
  MousePointerClickIcon as MousePointerClick,
  MoreHorizontalIcon as MoreHorizontal,
  PlusIcon as Plus,
  SaveIcon as Save,
  ShuffleIcon as Shuffle,
  StarIcon as Star,
  TrashIcon as Trash2,
  CloseIcon as X,
} from '../../design-system/icons'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { useStore } from '../../store'
import type { TaskRecord } from '../../types'
import type { SopGroup, SopLibraryItem } from './types'
import { isCampaignRecipeSop } from './campaignRecipe'
import { buildSopGroupTree, flattenSopGroupTree } from './sopGroupTree'
import SopCampaignRecipePanel from './SopCampaignRecipePanel'
import SopImageStack from './SopImageStack'
import SopTextEditor from './SopTextEditor'

const SOP_DRAG_TYPE = 'application/x-tangbao-sop-ids'
/** 分组树折叠状态的本地存储键（纯 UI 偏好，与素材库侧栏的折叠键互不影响）。 */
const SOP_GROUP_COLLAPSED_STORAGE_KEY = 'tangbao.sop-group-collapsed'
/** 分组树每一级的缩进像素，配合展开箭头体现层级。 */
const SOP_GROUP_INDENT = 14

/** 配方卡 SOP 的名称即可保存，内容非空由配方卡编辑器自己的校验负责。 */
function hasSavableContent(item: SopLibraryItem): boolean {
  if (isCampaignRecipeSop(item)) return true
  return Boolean(item.content.trim())
}

export type SopLibraryTabProps = {
  groups: SopGroup[]
  items: SopLibraryItem[]
  tasks: TaskRecord[]
  filteredItems: SopLibraryItem[]
  search: string
  setSearch: (value: string) => void
  selectedGroupId: string
  selectGroup: (groupId: string) => void
  editingGroupId: string | null
  editingGroupName: string
  setEditingGroupName: (value: string) => void
  renameInputRef: React.RefObject<HTMLInputElement | null>
  commitRenameGroup: () => void
  cancelRenameGroup: () => void
  openGroupContextMenu: (event: React.MouseEvent<HTMLElement>, groupId?: string) => void
  selectedIds: Set<string>
  moveItemsToGroup: (itemIds: string[], targetGroupId: string) => void
  addItem: () => void
  /** 新建一张配方卡引擎 SOP（本地采样，不调 AI），与 addItem 的差别只在初始形态。 */
  addCampaignRecipeItem: () => void
  selectedItemId: string
  setSelectedItemId: (id: string) => void
  selectItemWithModifiers: (
    item: SopLibraryItem,
    event?: Pick<React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ) => void
  openCoverPickerForItem: (item: SopLibraryItem) => void
  itemDraft: SopLibraryItem | null
  setItemDraft: React.Dispatch<React.SetStateAction<SopLibraryItem | null>>
  itemDirty: boolean
  itemApplied: boolean
  itemEditorHint: string
  persistedItem?: SopLibraryItem
  onApply?: (item: SopLibraryItem) => void
  onClear?: () => void
  selectedSopId?: string
  applyItem: (item: SopLibraryItem) => void
  saveItemDraftNow: () => boolean
  saveRevisionAsNewItem: (content: string) => void
  viewGeneratedPrompts: (item: SopLibraryItem) => Promise<void>
  onManagePromptRuns?: (item: SopLibraryItem) => void
  setCoverPickerOpen: (open: boolean) => void
  setVersionDialogOpen: (open: boolean) => void
  onTestSopRevision?: (item: SopLibraryItem) => Promise<void>
  onSaveItem: (item: SopLibraryItem) => void
  onDuplicateItem: (itemId: string) => string | null
  onDeleteItem: (itemId: string) => void
}

/** SOP 管理中心「SOP 库」标签页：分组侧栏 + SOP 列表 + 参数与正文编辑面板。 */
export default function SopLibraryTab({
  groups,
  items,
  tasks,
  filteredItems,
  search,
  setSearch,
  selectedGroupId,
  selectGroup,
  editingGroupId,
  editingGroupName,
  setEditingGroupName,
  renameInputRef,
  commitRenameGroup,
  cancelRenameGroup,
  openGroupContextMenu,
  selectedIds,
  moveItemsToGroup,
  addItem,
  addCampaignRecipeItem,
  selectedItemId,
  setSelectedItemId,
  selectItemWithModifiers,
  openCoverPickerForItem,
  itemDraft,
  setItemDraft,
  itemDirty,
  itemApplied,
  itemEditorHint,
  persistedItem,
  onApply,
  onClear,
  selectedSopId,
  applyItem,
  saveItemDraftNow,
  saveRevisionAsNewItem,
  viewGeneratedPrompts,
  onManagePromptRuns,
  setCoverPickerOpen,
  setVersionDialogOpen,
  onTestSopRevision,
  onSaveItem,
  onDuplicateItem,
  onDeleteItem,
}: SopLibraryTabProps) {
  const { openConfirmDialog } = useAppDialog()
  const showToast = useStore((state) => state.showToast)
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  /** 折叠存档按「当前还存在的分组 id」筛一遍（删掉的分组不会在存档里累积）。 */
  const allGroupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups])
  // 折叠状态的持久化在 `usePersistedCollapsedIds` 里（三棵树共用一份，别在这儿再写一份）
  const [collapsedGroupIds, setCollapsedGroupIds] = usePersistedCollapsedIds(
    SOP_GROUP_COLLAPSED_STORAGE_KEY,
    allGroupIds,
  )
  const editorMenuRef = useRef<HTMLDivElement>(null)

  /** 分组树按展开状态展平成行列表；折叠的分组整棵子树跳过。 */
  const groupTreeRows = useMemo(
    () => flattenSopGroupTree(buildSopGroupTree(groups), collapsedGroupIds),
    [groups, collapsedGroupIds],
  )

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  useCloseOnEscape(editorMenuOpen, () => setEditorMenuOpen(false))

  useEffect(() => {
    if (!editorMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!editorMenuRef.current?.contains(event.target as Node)) setEditorMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [editorMenuOpen])

  useEffect(() => {
    setEditorMenuOpen(false)
  }, [selectedItemId])

  const handleSopDragStart = (event: React.DragEvent<HTMLElement>, item: SopLibraryItem) => {
    const itemIds = selectedIds.has(item.id) && selectedIds.size > 1 ? Array.from(selectedIds) : [item.id]
    event.dataTransfer.setData(SOP_DRAG_TYPE, JSON.stringify(itemIds))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleGroupDragOver = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    if (!Array.from(event.dataTransfer.types).includes(SOP_DRAG_TYPE)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDragOverGroupId(groupId)
  }

  const handleGroupDragLeave = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragOverGroupId((current) => (current === groupId ? null : current))
  }

  const handleGroupDrop = (event: React.DragEvent<HTMLElement>, groupId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOverGroupId(null)
    const raw = event.dataTransfer.getData(SOP_DRAG_TYPE)
    if (!raw) return
    try {
      const itemIds = JSON.parse(raw)
      if (Array.isArray(itemIds)) {
        const validIds = itemIds.filter((itemId): itemId is string => typeof itemId === 'string')
        if (validIds.length > 0) moveItemsToGroup(validIds, groupId)
      }
    } catch {
      // 忽略无效的拖拽负载
    }
  }

  return (
    <DialogWorkspace layout="triple" className="sop-center-library-grid min-h-0 flex-1">
      <DialogPane
        as="aside"
        tone="sidebar"
        className="sop-center-sidebar"
        onContextMenu={(event) => openGroupContextMenu(event)}
      >
        <div className="space-y-1">
          {[
            { id: 'all', name: '全部 SOP', count: items.length },
            { id: 'favorites', name: '收藏', count: items.filter((item) => item.favorite).length },
            { id: 'recent', name: '最近使用', count: items.filter((item) => item.lastUsedAt).length },
            { id: 'ungrouped', name: '未分组', count: items.filter((item) => !item.groupId).length },
          ].map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => selectGroup(group.id)}
              className="sop-center-nav-item"
              data-selected={selectedGroupId === group.id || undefined}
              data-drag-over={group.id === 'ungrouped' && dragOverGroupId === '' ? true : undefined}
              onDragOver={group.id === 'ungrouped' ? (event) => handleGroupDragOver(event, '') : undefined}
              onDragLeave={group.id === 'ungrouped' ? (event) => handleGroupDragLeave(event, '') : undefined}
              onDrop={group.id === 'ungrouped' ? (event) => handleGroupDrop(event, '') : undefined}
            >
              <span>{group.name}</span>
              <span className="text-xs opacity-70">{group.count}</span>
            </button>
          ))}
          {groupTreeRows.map(({ group, depth, hasChildren }) => {
            const isEditing = editingGroupId === group.id
            const collapsed = collapsedGroupIds.has(group.id)
            const indent = { paddingLeft: depth * SOP_GROUP_INDENT }
            if (isEditing) {
              return (
                <div
                  key={group.id}
                  className="sop-center-group-row sop-center-group-row--editing flex items-center gap-1"
                  data-selected={selectedGroupId === group.id || undefined}
                  style={indent}
                >
                  <span className="sop-center-group-tree-toggle" aria-hidden="true" />
                  <input
                    ref={renameInputRef}
                    value={editingGroupName}
                    onChange={(event) => setEditingGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRenameGroup()
                      if (event.key === 'Escape') cancelRenameGroup()
                    }}
                    onBlur={commitRenameGroup}
                    placeholder="分组名称"
                    className="ds-input h-ds-control-lg min-w-0 flex-1 px-3 text-sm"
                    aria-label="重命名分组"
                  />
                  <IconButton
                    size="sm"
                    onClick={commitRenameGroup}
                    aria-label="保存分组名称"
                    icon={<Check size={14} />}
                  />
                  <IconButton
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={cancelRenameGroup}
                    aria-label="取消重命名"
                    icon={<X size={14} />}
                  />
                </div>
              )
            }
            return (
              <div key={group.id} className="sop-center-group-tree-node" style={indent}>
                {hasChildren ? (
                  <button
                    type="button"
                    className="sop-center-group-tree-toggle"
                    aria-label={`${collapsed ? '展开' : '收起'}${group.name}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleGroupCollapsed(group.id)
                    }}
                  >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                ) : (
                  <span className="sop-center-group-tree-toggle" aria-hidden="true" />
                )}
                <ListRow
                  className="sop-center-group-row sop-center-group-tree-row"
                  selected={selectedGroupId === group.id}
                  title={group.name}
                  data-sop-drop-group={group.id}
                  data-drag-over={dragOverGroupId === group.id || undefined}
                  onDragOver={(event) => handleGroupDragOver(event, group.id)}
                  onDragLeave={(event) => handleGroupDragLeave(event, group.id)}
                  onDrop={(event) => handleGroupDrop(event, group.id)}
                  interactive={{
                    onClick: () => selectGroup(group.id),
                  }}
                  onContextMenu={(event) => openGroupContextMenu(event, group.id)}
                />
              </div>
            )
          })}
        </div>
      </DialogPane>

      <DialogPane className="sop-center-list-panel">
        <div className="sop-center-list-head">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">SOP 列表</h3>
              <span className="sop-center-list-count">{filteredItems.length}</span>
            </div>
          </div>
          <Inline gap={2} wrap={false}>
            <Button size="sm" variant="secondary" onClick={addItem} leadingIcon={<Plus size={15} />}>
              新建
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={addCampaignRecipeItem}
              leadingIcon={<Shuffle size={15} />}
              title="新建一张走本地最远点采样的配方卡（不调用 AI）"
            >
              配方卡
            </Button>
          </Inline>
        </div>
        <SearchField
          className="mt-3"
          label="搜索 SOP"
          value={search}
          onChange={setSearch}
          onClear={() => setSearch('')}
          placeholder="搜索名称、说明或正文"
        />
        <div className="sop-center-sop-list mt-3" role="list">
          {filteredItems.map((item) => {
            const groupName = groups.find((group) => group.id === item.groupId)?.name ?? '未分组'
            return (
              <article
                key={item.id}
                className="sop-center-sop-row group"
                data-selected={selectedItemId === item.id || selectedIds.has(item.id) || undefined}
                role="listitem"
                draggable
                onDragStart={(event) => handleSopDragStart(event, item)}
                onDragEnd={() => setDragOverGroupId(null)}
              >
                <SopImageStack
                  item={selectedItemId === item.id && itemDraft ? itemDraft : item}
                  tasks={tasks}
                  onClick={(event) => selectItemWithModifiers(item, event)}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    openCoverPickerForItem(item)
                  }}
                  title="单击编辑；Ctrl/⌘ 点击切换多选；Shift 点击连续选择；拖到左侧分组移动；双击选择封面"
                />
                {/*
                 * 右上角「类型角标」区：系列 / 变量提示词 / 配方卡引擎。
                 * 这三个都是**资产类型**标识，统一放在卡片右上角，与右侧操作按钮列错开。
                 * 原先它们（或其中一部分）混在下方参数行里 —— 参数行宽度不足时会换行，
                 * 把内容整体抬高并顶出卡片下边界（2026-09-20 反馈的徽章跑出卡片）。
                 */}
                {(item.kind === 'series' || item.executionMode === 'variable-prompt' || isCampaignRecipeSop(item)) && (
                  <span className="sop-center-sop-badges">
                    {item.kind === 'series' && (
                      <Badge tone="info" title={`系列 SOP · ${item.seriesConfig?.imageCount ?? 3} 图`}>
                        系列 {item.seriesConfig?.imageCount ?? 3} 图
                      </Badge>
                    )}
                    {item.executionMode === 'variable-prompt' && <Badge tone="info">变量提示词</Badge>}
                    {isCampaignRecipeSop(item) && <Badge tone="info">配方卡引擎</Badge>}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(event) => selectItemWithModifiers(item, event)}
                  title={item.name}
                  aria-pressed={selectedIds.has(item.id)}
                  className="sop-center-sop-main"
                >
                  <span className="sop-center-sop-title">{item.name}</span>
                  <span className="sop-center-sop-description">{item.description.trim() || '暂无说明'}</span>
                  <span className="sop-center-sop-params" aria-label="SOP 参数">
                    <span>{groupName}</span>
                    {selectedSopId === item.id && <Badge tone="success">使用中</Badge>}
                  </span>
                </button>
                <div className="sop-center-sop-actions" aria-label={`${item.name} 操作`}>
                  <IconButton
                    size="sm"
                    onClick={() => {
                      onSaveItem({ ...item, favorite: !item.favorite, updatedAt: Date.now() })
                      showToast(
                        item.favorite ? `已取消收藏 SOP「${item.name}」` : `已收藏 SOP「${item.name}」`,
                        'success',
                      )
                    }}
                    aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.name}`}
                    title={item.favorite ? '取消收藏' : '收藏'}
                    icon={<Star size={14} fill={item.favorite ? 'currentColor' : 'none'} />}
                    className={`sop-center-row-action ${item.favorite ? 'sop-center-action--favorite' : ''}`}
                  />
                  {onApply && (
                    <IconButton
                      size="sm"
                      onClick={() => applyItem(item)}
                      aria-label={`应用 ${item.name}`}
                      title="应用到当前生图"
                      icon={<MousePointerClick size={14} />}
                      className={`sop-center-row-action ${selectedSopId === item.id ? 'sop-center-action--applied' : ''}`}
                    />
                  )}
                  <IconButton
                    size="sm"
                    onClick={() => {
                      const id = onDuplicateItem(item.id)
                      if (id) {
                        setSelectedItemId(id)
                        showToast(`已复制 SOP「${item.name}」`, 'success')
                      } else {
                        showToast('复制 SOP 失败，请重试', 'error')
                      }
                    }}
                    aria-label={`复制${item.name}`}
                    title="复制 SOP"
                    icon={<Copy size={14} />}
                    className="sop-center-row-action"
                  />
                  <IconButton
                    size="sm"
                    onClick={() =>
                      openConfirmDialog({
                        title: '删除 SOP？',
                        message: `将永久删除「${item.name}」。`,
                        confirmText: '确认删除',
                        tone: 'danger',
                        action: () => {
                          onDeleteItem(item.id)
                          showToast(`已删除 SOP「${item.name}」`, 'success')
                        },
                      })
                    }
                    aria-label={`删除${item.name}`}
                    title="删除 SOP"
                    icon={<Trash2 size={14} />}
                    className="sop-center-row-action sop-center-action--danger"
                  />
                </div>
              </article>
            )
          })}
          {filteredItems.length === 0 && (
            <EmptyState title="当前分组暂无 SOP" description="新建 SOP，或切换到其他分组查看。" />
          )}
        </div>
      </DialogPane>

      <DialogPane tone="canvas" className="sop-center-editor-panel flex min-h-0 flex-col">
        {itemDraft ? (
          <div className="sop-center-editor-card flex min-h-0 flex-1 flex-col gap-4">
            <div className="sop-center-editor-head">
              <div className="min-w-0">
                <span className="sop-center-editor-eyebrow">正在编辑</span>
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="truncate font-semibold">{itemDraft.name || '未命名 SOP'}</h3>
                  {itemApplied && <Badge tone="success">使用中</Badge>}
                </div>
                <p className="sop-center-quiet-text mt-1 text-xs" aria-live="polite">
                  {itemEditorHint}
                </p>
              </div>
              <Inline className="sop-center-editor-card__actions max-w-full" gap={2} justify="flex-end" wrap={false}>
                {onApply && (
                  <Button
                    size="sm"
                    disabled={!persistedItem || itemDirty || itemApplied}
                    onClick={() => persistedItem && applyItem(persistedItem)}
                    variant={itemApplied || itemDirty ? 'secondary' : 'primary'}
                    leadingIcon={<MousePointerClick size={15} />}
                    className={itemApplied ? 'text-ds-success' : undefined}
                  >
                    {itemApplied ? '已使用' : '应用 SOP'}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!itemDirty || !itemDraft.name.trim() || !hasSavableContent(itemDraft)}
                  onClick={() => saveItemDraftNow()}
                  variant={itemDirty ? 'primary' : 'secondary'}
                  leadingIcon={<Save size={15} />}
                >
                  保存修改
                </Button>
                <div ref={editorMenuRef} className="relative">
                  <IconButton
                    size="sm"
                    onClick={() => setEditorMenuOpen((current) => !current)}
                    aria-label="更多 SOP 操作"
                    aria-expanded={editorMenuOpen}
                    aria-haspopup="menu"
                    title="更多操作"
                    icon={<MoreHorizontal size={16} />}
                  />
                  {editorMenuOpen && (
                    <Menu label="SOP 更多操作" className="sop-center-editor-menu">
                      <MenuItem
                        icon={<ListChecks size={15} />}
                        disabled={!persistedItem}
                        onClick={() => {
                          setEditorMenuOpen(false)
                          if (!persistedItem) return
                          if (onManagePromptRuns) onManagePromptRuns(persistedItem)
                          else void viewGeneratedPrompts(persistedItem)
                        }}
                      >
                        {onManagePromptRuns ? '提示词管理' : '生成提示词'}
                      </MenuItem>
                      <MenuItem
                        icon={<FileImage size={15} />}
                        onClick={() => {
                          setEditorMenuOpen(false)
                          setCoverPickerOpen(true)
                        }}
                      >
                        选择封面
                      </MenuItem>
                      <MenuItem
                        icon={<History size={15} />}
                        disabled={!persistedItem}
                        onClick={() => {
                          setEditorMenuOpen(false)
                          setVersionDialogOpen(true)
                        }}
                      >
                        版本历史
                      </MenuItem>
                      {onClear && selectedSopId && (
                        <>
                          <MenuSeparator />
                          <MenuItem
                            onClick={() => {
                              setEditorMenuOpen(false)
                              onClear()
                              showToast('已取消应用当前 SOP', 'info')
                            }}
                          >
                            取消应用
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  )}
                </div>
              </Inline>
            </div>
            <div className="sop-center-editor-fields">
              <TextField
                label="名称"
                value={itemDraft.name}
                onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })}
              />
              <SelectField
                label="所属分组"
                value={itemDraft.groupId ?? ''}
                onChange={(event) => setItemDraft({ ...itemDraft, groupId: event.target.value || undefined })}
                options={[
                  { value: '', label: '未分组' },
                  ...groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
              />
              <TextField
                label="说明"
                value={itemDraft.description}
                onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })}
              />
            </div>
            {/* 配方卡引擎不显示普通 SOP 的正文编辑窗口。
                它的「正文」是骨架（在「配方卡详情」弹窗里），content 本来就该是空的 ——
                留一个空的正文明细框只会让人以为配方卡也要写正文，还容易误判成「内容丢了」。 */}
            {!isCampaignRecipeSop(itemDraft) && (
              <SopTextEditor
                documentId={itemDraft.id}
                value={itemDraft.content}
                onChange={(content) => setItemDraft({ ...itemDraft, content })}
                onSaveAsRevision={saveRevisionAsNewItem}
                onTestRevision={
                  onTestSopRevision ? (content) => onTestSopRevision({ ...itemDraft, content }) : undefined
                }
                variableMeta={itemDraft.executionMode === 'variable-prompt' ? itemDraft.variableMeta : undefined}
                onVariableMetaChange={(meta) =>
                  setItemDraft((current) => (current ? { ...current, variableMeta: meta } : current))
                }
              />
            )}
            {isCampaignRecipeSop(itemDraft) && (
              <SopCampaignRecipePanel
                config={itemDraft.campaignRecipe ?? { body: '', dimensions: [] }}
                meta={{ name: itemDraft.name, desc: itemDraft.description, dominantSlots: itemDraft.dominantSlots }}
                onChange={(campaignRecipe) => setItemDraft({ ...itemDraft, campaignRecipe })}
                onMetaChange={(patch) => {
                  // 解析出的名称/说明/主控槽直接落到草案上，随保存一起持久化；
                  // 名称已有值时**不覆盖**用户手填的名字（只在识别到且当前为空时补）
                  setItemDraft((current) => {
                    if (!current) return current
                    const next = { ...current }
                    if (patch.name && !current.name.trim()) next.name = patch.name
                    if (patch.desc && !current.description.trim()) next.description = patch.desc
                    if (patch.dominantSlots) next.dominantSlots = patch.dominantSlots
                    return next
                  })
                }}
              />
            )}
          </div>
        ) : (
          <EmptyState className="h-full" title="选择或新建一个 SOP" description="从左侧列表选择内容后即可编辑。" />
        )}
      </DialogPane>
    </DialogWorkspace>
  )
}
