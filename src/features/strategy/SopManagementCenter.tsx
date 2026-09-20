import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import './styles.css'
import { IconButton, Menu, MenuItem, MenuSeparator, Tabs, Tooltip } from '../../design-system'
import {
  CloseIcon as X,
  CopyIcon as Copy,
  ExportIcon as Export,
  FolderPlusIcon as FolderPlus,
  ImportIcon as Import,
  LibraryIcon as Library,
  PencilIcon as Pencil,
  Settings2Icon as Settings2,
  SparklesIcon as Sparkles,
  TrashIcon as Trash2,
} from '../../design-system/icons'
import type { SopBatchSnapshot, SopGenerationRecord, TaskRecord } from '../../types'
import {
  MAX_SOP_REFERENCE_IMAGES,
  type GenerateSop,
  type SopGenerationProgress,
  type SopGenerationProgressStage,
  type SopReferenceImage,
} from './sopGeneration'
import { sopLibraryId } from './sopLibrary'
import { collectSopGroupSubtreeIds } from './sopGroupTree'
import { getSopCoverCandidates } from './sopCover'
import { getAllSopBatchSnapshots, getAllSopGenerationRecords, putSopGenerationRecord } from '../../lib/db'
import { createImageThumbnailDataUrl } from '../../lib/canvasImage'
import SopLibraryTab from './SopLibraryTab'
import SopMetaTab from './SopMetaTab'
import SopGenerateTab from './SopGenerateTab'
import SopCoverPickerDialog from './SopCoverPickerDialog'
import SopPromptRunsDialog from './SopPromptRunsDialog'
import SopVersionHistoryDialog from './SopVersionHistoryDialog'
import SopGenerationDetailOverlay from './SopGenerationDetailOverlay'
import type { SopGroup, SopLibraryItem, SopMetaInstruction, SopVersion } from './types'
import { isCampaignRecipeSop } from './campaignRecipe'
import { resolveInitialSopGroupId } from './sopInitialGroup'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'
import { useAppDialog } from '../../hooks/useAppDialog'
import { LARGE_MODAL_SIZE_STYLE, useLargeModalMode } from '../../hooks/useLargeModalMode'
import LargeModalToggle from '../../components/LargeModalToggle'
import AssetPickerModal from '../assetLibrary/AssetPickerModal'
import { assetCommands } from '../../lib/assetCommands'
import { useStore } from '../../store'

type CenterTab = 'library' | 'meta' | 'generate'
type GenerationStepId = Exclude<SopGenerationProgressStage, 'repair'> | 'save'
/** 生成所需的元指令子集；生成记录快照与库内元指令共用该结构。 */
type GenerationMetaInput = Pick<SopMetaInstruction, 'id' | 'name' | 'description' | 'instruction' | 'kind'>
type GenerationJob = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  error?: string
  startedAt?: number
  resultName?: string
  resultId?: string
  currentStep?: GenerationStepId
  completedSteps?: GenerationStepId[]
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const GENERATION_HISTORY_PAGE_SIZE = 4
const SOP_MANAGEMENT_MODAL_MODE_STORAGE_KEY = 'tangbao.sop-management-modal-mode'
const SOP_AUTO_SAVE_DELAY_MS = 800
type AutoSaveState = 'idle' | 'pending' | 'saved' | 'blocked'

const SOP_GENERATION_STEPS: Array<{
  id: GenerationStepId
  label: string
  description: string
}> = [
  { id: 'validate', label: '校验生成条件', description: '检查元指令、说明和参考图片' },
  { id: 'prepare', label: '整理参考输入', description: '按顺序标记并组织全部参考图' },
  { id: 'request', label: '调用 AI 编译 SOP', description: '分析共同规律、差异和执行约束' },
  { id: 'parse', label: '校验生成结构', description: '检查名称、说明和完整 SOP 正文' },
  { id: 'save', label: '保存到 SOP 库', description: '写入目标分组并准备立即使用' },
]

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
    reader.onerror = () => reject(new Error(`无法读取图片「${file.name}」`))
    reader.readAsDataURL(file)
  })
}

function generationStepsBefore(step: GenerationStepId) {
  const stepIndex = SOP_GENERATION_STEPS.findIndex((item) => item.id === step)
  return SOP_GENERATION_STEPS.slice(0, Math.max(0, stepIndex)).map((item) => item.id)
}

function getGenerationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '未知错误，请检查 API 配置后重试'
  if (/缺少名称、说明或 SOP 正文|缺少可用的 SOP 正文|返回不完整内容/.test(message)) {
    return 'AI 返回内容不完整，系统已自动尝试修复。请重新生成；若仍失败，请切换文本模型或简化生成元指令。'
  }
  return message
}

export default function SopManagementCenter({
  groups,
  items,
  tasks = [],
  metaInstructions,
  currentUserId,
  onSaveGroup,
  onDuplicateGroup,
  onDeleteGroup,
  onSaveItem,
  onDuplicateItem,
  onDeleteItem,
  onSaveMetaInstruction,
  onDuplicateMetaInstruction,
  onDeleteMetaInstruction,
  onGenerateSop,
  onTestSopRevision,
  selectedSopId,
  onApply,
  onClear,
  sopVersionHistory = {},
  generationContext,
  onClose,
  onManagePromptRuns,
}: {
  groups: SopGroup[]
  items: SopLibraryItem[]
  tasks?: TaskRecord[]
  metaInstructions: SopMetaInstruction[]
  currentUserId: string
  onSaveGroup: (group: SopGroup) => void
  onDuplicateGroup: (groupId: string) => string | null
  onDeleteGroup: (groupId: string) => void
  onSaveItem: (item: SopLibraryItem) => void
  onDuplicateItem: (itemId: string) => string | null
  onDeleteItem: (itemId: string) => void
  onSaveMetaInstruction: (item: SopMetaInstruction) => void
  onDuplicateMetaInstruction: (itemId: string) => string | null
  onDeleteMetaInstruction: (itemId: string) => void
  onGenerateSop: GenerateSop
  onTestSopRevision?: (item: SopLibraryItem) => Promise<void>
  selectedSopId?: string
  onApply?: (item: SopLibraryItem) => void
  onClear?: () => void
  sopVersionHistory?: Record<string, SopVersion[]>
  generationContext?: { product?: string; materialType?: string; generationMode?: string }
  onClose: () => void
  /**
   * 宿主提供「提示词管理」跳转时（图库模式），「生成提示词」按钮直接打开提示词管理弹窗并定位到该 SOP；
   * 未提供时（策略工作台）保留内置的只读提示词集快照弹窗。
   */
  onManagePromptRuns?: (item: SopLibraryItem) => void
}) {
  const { openConfirmDialog } = useAppDialog()
  const { largeView, toggleLargeView } = useLargeModalMode(SOP_MANAGEMENT_MODAL_MODE_STORAGE_KEY)
  const [tab, setTab] = useState<CenterTab>('library')
  /**
   * 初始分组跟随**全局上下文指针**（当前方向）——「在任何地方打开都默认停在当前方向」。
   *
   * 只在挂载时取一次（`useState` 惰性初始化）：之后用户在 SOP 里换分组是 SOP 自己的浏览行为，
   * **不回写**全局指针。反过来也不跟随 —— 这里不是双向绑定，是「打开就定位」。
   * 用 `getState()` 取快照而不是订阅：初始化只关心「打开那一刻看的是哪个方向」，
   * 订阅会让「别处换了方向」把用户正看的分组顶掉。
   */
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => {
    const { scope, collections } = useAssetLibraryStore.getState()
    return resolveInitialSopGroupId({ groups, collections, scope })
  })
  const [search, setSearch] = useState('')
  const initiallySelectedItem = items.find((item) => item.id === selectedSopId) ?? items[0]
  const [selectedItemId, setSelectedItemId] = useState(initiallySelectedItem?.id ?? '')
  const [selectedMetaId, setSelectedMetaId] = useState(metaInstructions[0]?.id ?? '')
  const [metaChatOpen, setMetaChatOpen] = useState(false)
  const [metaSearch, setMetaSearch] = useState('')
  const [itemDraft, setItemDraft] = useState<SopLibraryItem | null>(initiallySelectedItem ?? null)
  const [metaDraft, setMetaDraft] = useState<SopMetaInstruction | null>(metaInstructions[0] ?? null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [generatorMetaId, setGeneratorMetaId] = useState(metaInstructions[0]?.id ?? '')
  const [generatorMetaFallback, setGeneratorMetaFallback] = useState<GenerationMetaInput | null>(null)
  const [generatorGroupId, setGeneratorGroupId] = useState(groups[0]?.id ?? '')
  const [generatorBrief, setGeneratorBrief] = useState('')
  const [referenceImages, setReferenceImages] = useState<Array<SopReferenceImage & { id: string }>>([])
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [referenceDragActive, setReferenceDragActive] = useState(false)
  const [job, setJob] = useState<GenerationJob>({ status: 'idle', message: '等待生成' })
  const [generationPanel, setGenerationPanel] = useState<'status' | 'history' | 'detail'>('status')
  const [generationRecords, setGenerationRecords] = useState<SopGenerationRecord[]>([])
  const [generationRecordsLoading, setGenerationRecordsLoading] = useState(false)
  const [generationHistoryPage, setGenerationHistoryPage] = useState(0)
  const [selectedGenerationRecord, setSelectedGenerationRecord] = useState<SopGenerationRecord | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false)
  const [snapshotsForItem, setSnapshotsForItem] = useState<SopBatchSnapshot[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>('idle')
  const autoSaveTimerRef = useRef<number | null>(null)
  const referenceDragDepthRef = useRef(0)
  const generationAbortRef = useRef<AbortController | null>(null)
  const generationMountedRef = useRef(true)
  const addReferenceImagesRef = useRef<(files: File[]) => Promise<void>>(async () => {})
  const pasteImageGateRef = useRef({ enabled: false })
  const importInputRef = useRef<HTMLInputElement>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const sopSelectionAnchorRef = useRef<string | null>(null)
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)
  const showToast = useStore((state) => state.showToast)
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupId?: string } | null>(null)
  const groupContextMenuRef = useRef<HTMLDivElement>(null)

  const viewGeneratedPrompts = async (item: SopLibraryItem) => {
    setSnapshotDialogOpen(true)
    setSnapshotsLoading(true)
    try {
      const all = await getAllSopBatchSnapshots()
      setSnapshotsForItem(
        all.filter((snapshot) => snapshot.sop.id === item.id).sort((a, b) => b.createdAt - a.createdAt),
      )
    } catch {
      showToast('加载生成提示词记录失败', 'error')
    } finally {
      setSnapshotsLoading(false)
    }
  }

  const filteredItems = useMemo(() => {
    const groupedItems =
      selectedGroupId === 'favorites'
        ? items.filter((item) => item.favorite)
        : selectedGroupId === 'recent'
          ? [...items].filter((item) => item.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
          : selectedGroupId === 'all'
            ? items
            : selectedGroupId === 'ungrouped'
              ? items.filter((item) => !item.groupId)
              : (() => {
                  // 分组树：选中父分组时连同各级子分组里的 SOP 一起显示，否则点开产品线会看到空列表
                  const subtreeIds = new Set(collectSopGroupSubtreeIds(groups, selectedGroupId))
                  return items.filter((item) => !!item.groupId && subtreeIds.has(item.groupId))
                })()
    const query = search.trim().toLocaleLowerCase()
    return query
      ? groupedItems.filter((item) =>
          `${item.name} ${item.description} ${item.content}`.toLocaleLowerCase().includes(query),
        )
      : groupedItems
  }, [groups, items, search, selectedGroupId])
  const filteredMetaInstructions = useMemo(() => {
    const query = metaSearch.trim().toLocaleLowerCase()
    return query
      ? metaInstructions.filter((item) =>
          `${item.name} ${item.description} ${item.instruction}`.toLocaleLowerCase().includes(query),
        )
      : metaInstructions
  }, [metaInstructions, metaSearch])
  const persistedItem = items.find((item) => item.id === selectedItemId)
  const selectedGeneratorMeta = metaInstructions.find((item) => item.id === generatorMetaId)
  const generatorKind = selectedGeneratorMeta?.kind ?? generatorMetaFallback?.kind ?? 'general'
  const isPromptReverseGeneration = generatorKind === 'prompt-reverse'
  const itemDirty = Boolean(
    itemDraft &&
    persistedItem &&
    (itemDraft.name !== persistedItem.name ||
      itemDraft.description !== persistedItem.description ||
      itemDraft.content !== persistedItem.content ||
      itemDraft.groupId !== persistedItem.groupId ||
      itemDraft.coverImageId !== persistedItem.coverImageId ||
      JSON.stringify(itemDraft.variableMeta ?? null) !== JSON.stringify(persistedItem.variableMeta ?? null) ||
      itemDraft.kind !== persistedItem.kind ||
      itemDraft.executionMode !== persistedItem.executionMode ||
      // 配方卡的骨架与维度池是独立字段（不在 content 里），漏比这一项会让编辑「看着改了但存不下去」
      JSON.stringify(itemDraft.campaignRecipe ?? null) !== JSON.stringify(persistedItem.campaignRecipe ?? null) ||
      JSON.stringify(itemDraft.dominantSlots ?? null) !== JSON.stringify(persistedItem.dominantSlots ?? null) ||
      JSON.stringify(itemDraft.seriesConfig ?? null) !== JSON.stringify(persistedItem.seriesConfig ?? null)),
  )
  const itemDraftValid = Boolean(
    itemDraft?.name.trim() && (isCampaignRecipeSop(itemDraft) || itemDraft?.content.trim()),
  )
  const persistedMeta = metaInstructions.find((item) => item.id === selectedMetaId)
  const metaDirty = Boolean(
    metaDraft &&
    persistedMeta &&
    (metaDraft.name !== persistedMeta.name ||
      metaDraft.description !== persistedMeta.description ||
      metaDraft.instruction !== persistedMeta.instruction ||
      metaDraft.kind !== persistedMeta.kind),
  )
  const metaEditorHint = metaDirty ? '有未保存的修改，请点击保存。' : '重命名或修改后，新生成任务立即使用最新内容。'
  const coverCandidates = useMemo(() => getSopCoverCandidates(itemDraft?.id ?? '', tasks), [itemDraft?.id, tasks])
  const itemApplied = Boolean(itemDraft && selectedSopId === itemDraft.id)
  const itemEditorHint =
    autoSaveState === 'saved'
      ? '修改已自动保存。'
      : itemDirty
        ? itemDraftValid
          ? itemApplied
            ? '修改将在 1 秒内自动保存，并更新当前使用的 SOP。'
            : '修改将在 1 秒内自动保存。'
          : itemDraft && isCampaignRecipeSop(itemDraft)
            ? '配方卡需要名称、提示词骨架与至少一个维度，当前修改尚未保存。'
            : '名称和正文不能为空，当前修改尚未保存。'
        : itemApplied
          ? '当前 SOP 已使用。'
          : '无需编辑即可直接应用。'

  useEffect(() => {
    if (job.status !== 'running' || !job.startedAt) return
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - job.startedAt!) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [job.startedAt, job.status])

  useEffect(() => {
    generationMountedRef.current = true
    return () => {
      // 关闭弹窗不中止生成：让生成在后台继续，完成后再提示。
      generationMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (tab !== 'generate') return
    let active = true
    setGenerationRecordsLoading(true)
    setGenerationHistoryPage(0)
    void getAllSopGenerationRecords()
      .then((records) => {
        if (active) setGenerationRecords(records.sort((a, b) => b.createdAt - a.createdAt))
      })
      .catch(() => {
        if (active) setGenerationRecords([])
      })
      .finally(() => {
        if (active) setGenerationRecordsLoading(false)
      })
    return () => {
      active = false
    }
  }, [tab])

  useEffect(() => {
    const selected = filteredItems.find((item) => item.id === selectedItemId)
    if (selected) {
      setItemDraft(selected)
      return
    }
    // 当前选中项被搜索/分组过滤掉时，只在「全量列表里也不存在」才切换到第一条。
    // 若它仍存在于 items（只是被过滤），保留选中与草稿不动 —— 否则会出现
    // 「刚新建的配方卡被静默换成另一张卡，随后按那张卡的类型走了 AI 生成」这种串台（R-52）。
    if (selectedItemId && items.some((item) => item.id === selectedItemId)) return
    const next = filteredItems[0] ?? null
    setSelectedItemId(next?.id ?? '')
    setItemDraft(next)
  }, [filteredItems, items, selectedItemId])

  useEffect(() => {
    const selected = metaInstructions.find((item) => item.id === selectedMetaId)
    if (selected) {
      setMetaDraft(selected)
      return
    }
    const next = metaInstructions[0] ?? null
    setSelectedMetaId(next?.id ?? '')
    setMetaDraft(next)
  }, [metaInstructions, selectedMetaId])

  useEffect(() => {
    if (
      !['all', 'ungrouped', 'favorites', 'recent'].includes(selectedGroupId) &&
      !groups.some((group) => group.id === selectedGroupId)
    ) {
      setSelectedGroupId('all')
    }
    if (
      (!generatorGroupId && groups[0]) ||
      (generatorGroupId && !groups.some((group) => group.id === generatorGroupId))
    ) {
      setGeneratorGroupId(groups[0]?.id ?? '')
    }
  }, [generatorGroupId, groups, selectedGroupId])

  useEffect(() => {
    if (
      (!generatorMetaId && metaInstructions[0]) ||
      (generatorMetaId && !metaInstructions.some((item) => item.id === generatorMetaId))
    ) {
      setGeneratorMetaId(metaInstructions[0]?.id ?? '')
    }
  }, [generatorMetaId, metaInstructions])

  useEffect(() => {
    if (editingGroupId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [editingGroupId])

  useEffect(() => {
    setAutoSaveState('idle')
  }, [selectedItemId])

  useEffect(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (!itemDirty || !itemDraft) return
    if (!itemDraft.name.trim() || (!isCampaignRecipeSop(itemDraft) && !itemDraft.content.trim())) {
      setAutoSaveState('blocked')
      return
    }

    const draftToSave = itemDraft
    setAutoSaveState('pending')
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      onSaveItem({ ...draftToSave, updatedAt: Date.now() })
      setAutoSaveState('saved')
    }, SOP_AUTO_SAVE_DELAY_MS)

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [itemDirty, itemDraft, onSaveItem])

  const startRenameGroup = (group: SopGroup) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
  }

  const commitRenameGroup = () => {
    if (!editingGroupId) return
    const name = editingGroupName.trim()
    const group = groups.find((item) => item.id === editingGroupId)
    if (!group) {
      setEditingGroupId(null)
      return
    }
    if (name && name !== group.name) {
      onSaveGroup({ ...group, name, updatedAt: Date.now() })
      // 镜像分组（由项目文件夹投影而来）改名要写回主源，否则下次镜像会把旧名字推回来；
      // 独立分组（用户自建、未绑定文件夹）保持原样，只改 SOP 侧。
      if (group.collectionId) {
        void import('../assetLibrary/store').then(({ useAssetLibraryStore }) =>
          useAssetLibraryStore.getState().renameCollection(group.collectionId!, name),
        )
      } else {
        showToast('分组已重命名', 'success')
      }
    }
    setEditingGroupId(null)
  }

  const cancelRenameGroup = () => setEditingGroupId(null)

  const saveItemDraftNow = useCallback(
    (draft = itemDraft) => {
      // 与自动保存 effect、itemDraftValid 共用同一门槛：配方卡的骨架在 campaignRecipe 里，
      // content 为空是合法状态。漏掉这个分支会让配方卡永远存不下（弹「放弃未保存的修改？」），
      // 见 R-51。
      if (!draft?.name.trim() || (!isCampaignRecipeSop(draft) && !draft.content.trim())) return false
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      onSaveItem({ ...draft, updatedAt: Date.now() })
      setAutoSaveState('idle')
      showToast('修改已保存', 'success')
      return true
    },
    [itemDraft, onSaveItem, showToast],
  )

  const saveMetaDraftNow = (draft = metaDraft) => {
    if (!draft?.name.trim() || !draft.instruction.trim()) return false
    onSaveMetaInstruction({ ...draft, updatedAt: Date.now() })
    return true
  }

  const runAfterDraftConfirmation = (action: () => void) => {
    if (!itemDirty) {
      action()
      return
    }
    if (saveItemDraftNow()) {
      action()
      return
    }
    openConfirmDialog({
      title: '放弃未保存的修改？',
      message: '当前 SOP 的修改尚未保存，继续操作将丢失这些修改。',
      confirmText: '放弃修改',
      tone: 'warning',
      action,
    })
  }

  const runAfterUnsavedConfirmation = (action: () => void) => {
    if (tab === 'meta' && metaDirty) {
      if (saveMetaDraftNow()) {
        action()
        return
      }
      openConfirmDialog({
        title: '放弃未保存的修改？',
        message: '当前生成元指令的修改尚未保存，继续操作将丢失这些修改。',
        confirmText: '放弃修改',
        tone: 'warning',
        action,
      })
      return
    }
    runAfterDraftConfirmation(action)
  }

  const closeSafely = () => {
    // 生成运行中同样允许关闭：生成在后台继续，完成后右下角提示。
    runAfterUnsavedConfirmation(onClose)
  }

  const selectItem = (item: SopLibraryItem) => {
    if (item.id === selectedItemId) {
      if (itemDirty) saveItemDraftNow()
      setCoverPickerOpen(false)
      return
    }
    const select = () => {
      setSelectedItemId(item.id)
      setItemDraft(item)
      setCoverPickerOpen(false)
    }
    runAfterDraftConfirmation(select)
  }

  const selectItemWithModifiers = (
    item: SopLibraryItem,
    event?: Pick<React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ) => {
    const orderedIds = filteredItems.map((candidate) => candidate.id)
    const anchorId = sopSelectionAnchorRef.current ?? selectedItemId

    if (event?.shiftKey) {
      const anchorIndex = orderedIds.indexOf(anchorId)
      const targetIndex = orderedIds.indexOf(item.id)
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const range = orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
        setSelectedIds((current) => new Set([...current, ...range]))
      } else {
        setSelectedIds(new Set([item.id]))
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      setSelectedIds((current) => {
        const next = new Set(current)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
    } else {
      setSelectedIds(new Set())
    }

    sopSelectionAnchorRef.current = item.id
    selectItem(item)
  }

  const openCoverPickerForItem = (item: SopLibraryItem) => {
    if (item.id === selectedItemId) {
      setCoverPickerOpen(true)
      return
    }
    const open = () => {
      setSelectedItemId(item.id)
      setItemDraft(item)
      setCoverPickerOpen(true)
    }
    runAfterDraftConfirmation(open)
  }

  const applyItem = (item: SopLibraryItem) => {
    runAfterDraftConfirmation(() => {
      const source = item.id === selectedItemId && itemDraft ? itemDraft : item
      const applied = { ...source, lastUsedAt: Date.now() }
      onSaveItem(applied)
      onApply?.(applied)
      setSelectedItemId(applied.id)
      setItemDraft(applied)
      setCoverPickerOpen(false)
      showToast(`已应用 SOP「${applied.name}」到当前生图`, 'success')
    })
  }

  const saveRevisionAsNewItem = (content: string) => {
    if (!itemDraft) return
    const now = Date.now()
    const baseName = `${itemDraft.name}（新版）`
    const existingNames = new Set(items.map((item) => item.name))
    let name = baseName
    let suffix = 2
    while (existingNames.has(name)) {
      name = `${itemDraft.name}（新版 ${suffix}）`
      suffix += 1
    }
    onSaveItem({
      ...itemDraft,
      id: sopLibraryId('sop'),
      name,
      content,
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: undefined,
    })
    showToast(`已保存为「${name}」`, 'success')
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey) || !itemDraft) return
      event.preventDefault()
      saveItemDraftNow()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [itemDraft, saveItemDraftNow])

  // Delete/Backspace：删除选中的 SOP（与「删除所选」按钮走同一确认流程；仅 SOP 库标签页生效）
  useEffect(() => {
    if (tab !== 'library') return
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedIds.size === 0) return
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      batchDeleteSelected()
    }
    window.addEventListener('keydown', handleDeleteShortcut)
    return () => window.removeEventListener('keydown', handleDeleteShortcut)
  })

  const selectMeta = (item: SopMetaInstruction) => {
    if (item.id === selectedMetaId) return
    const select = () => {
      setSelectedMetaId(item.id)
      setMetaDraft(item)
    }
    runAfterUnsavedConfirmation(select)
  }

  /**
   * 新建子文件夹。
   * 分组树是项目文件夹树的投影，所以这里先在素材库项目树里建文件夹（唯一主源），再镜像出分组，
   * 保证左侧栏与 SOP 管理两边一一对应。父级取当前选中分组所绑定的文件夹。
   */
  const addGroup = () => {
    void (async () => {
      const selectedGroup = groups.find((item) => item.id === selectedGroupId)
      const parentCollectionId = selectedGroup?.collectionId ?? null
      const { useAssetLibraryStore } = await import('../assetLibrary/store')
      const created = await useAssetLibraryStore.getState().createCollection('新建文件夹', parentCollectionId)
      if (!created) return
      const [{ syncSopGroupsWithProjectTree }, { getMirrorGroupId }] = await Promise.all([
        import('../../lib/sopGroupSync'),
        import('../../lib/sopGroupMirror'),
      ])
      await syncSopGroupsWithProjectTree()
      const mirrorGroupId = getMirrorGroupId(created.id)
      setSelectedGroupId(mirrorGroupId)
      setEditingGroupId(mirrorGroupId)
      setEditingGroupName(created.name)
    })()
  }

  const openGroupContextMenu = (
    event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number },
    groupId?: string,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setGroupContextMenu({ x: event.clientX, y: event.clientY, groupId })
  }

  const closeGroupContextMenu = () => setGroupContextMenu(null)

  const renameGroupFromMenu = (group: SopGroup) => {
    closeGroupContextMenu()
    startRenameGroup(group)
  }

  const duplicateGroupFromMenu = (group: SopGroup) => {
    closeGroupContextMenu()
    const newId = onDuplicateGroup(group.id)
    if (newId) {
      setSelectedGroupId(newId)
      setEditingGroupId(newId)
      setEditingGroupName(`${group.name} 副本`)
      showToast(`已复制分组「${group.name}」`, 'success')
    } else {
      showToast('复制分组失败，请重试', 'error')
    }
  }

  const deleteGroupFromMenu = (group: SopGroup) => {
    closeGroupContextMenu()
    openConfirmDialog({
      title: group.collectionId ? '删除文件夹？' : '删除 SOP 分组？',
      message: group.collectionId
        ? `将删除文件夹「${group.name}」及其子文件夹（可在素材库回收站恢复），组内 SOP 会转为未分组。`
        : `将删除分组「${group.name}」，组内 SOP 会转为未分组。`,
      confirmText: '确认删除',
      tone: 'danger',
      action: () => {
        onDeleteGroup(group.id)
        // 镜像分组：同步把对应项目文件夹移入回收站，否则下次镜像会把它重新建出来
        if (group.collectionId) {
          void import('../assetLibrary/store').then(({ useAssetLibraryStore }) =>
            useAssetLibraryStore.getState().deleteCollection(group.collectionId!),
          )
        }
        showToast(`已删除分组「${group.name}」`, 'success')
      },
    })
  }

  useEffect(() => {
    if (!groupContextMenu) return
    const close = (event: Event) => {
      if (
        groupContextMenuRef.current &&
        event.target instanceof Node &&
        groupContextMenuRef.current.contains(event.target)
      ) {
        return
      }
      setGroupContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGroupContextMenu(null)
    }
    window.addEventListener('mousedown', close, { capture: true })
    window.addEventListener('wheel', close, { capture: true })
    window.addEventListener('scroll', close, { capture: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close, { capture: true })
      window.removeEventListener('wheel', close, { capture: true })
      window.removeEventListener('scroll', close, { capture: true })
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [groupContextMenu])

  const addItem = () => {
    const now = Date.now()
    const targetGroupId = ['all', 'favorites', 'recent', 'ungrouped'].includes(selectedGroupId)
      ? undefined
      : selectedGroupId
    const item: SopLibraryItem = {
      id: sopLibraryId('sop'),
      groupId: targetGroupId,
      name: '未命名 SOP',
      description: '',
      content: '',
      source: 'manual',
      createdBy: currentUserId,
      createdAt: now,
      updatedAt: now,
    }
    onSaveItem(item)
    setSelectedGroupId(targetGroupId ?? 'ungrouped')
    selectItem(item)
    showToast('已新建 SOP，请完善名称与正文', 'success')
  }

  /**
   * 新建配方卡引擎 SOP：与 addItem 的差别只在初始形态。
   *
   * 初始给一个「主体/背景/光线」三件套骨架而不是空对象，是为了让用户一进编辑器
   * 就能看到占位符与维度的对应关系 —— 空骨架 + 空维度池会直接报格式错误，
   * 新手上手成本太高。`content` 留摘要位，引擎读的是 campaignRecipe 字段。
   */
  const addCampaignRecipeItem = () => {
    const now = Date.now()
    const targetGroupId = ['all', 'favorites', 'recent', 'ungrouped'].includes(selectedGroupId)
      ? undefined
      : selectedGroupId
    const item: SopLibraryItem = {
      id: sopLibraryId('sop'),
      groupId: targetGroupId,
      name: '未命名配方卡',
      description: '本地最远点采样批量出词，不调用 AI。',
      content: '',
      kind: 'campaign-recipe',
      executionMode: 'campaign-recipe',
      campaignRecipe: {
        body: '{{主体}}，{{背景}}，{{光线}}，高清实拍',
        dimensions: [
          { name: '主体', options: ['咖啡杯', '帆布包', '运动鞋', '机械键盘'] },
          { name: '背景', options: ['原木桌面', '纯色背景', '城市街景', '落地窗前'] },
          { name: '光线', options: ['清晨侧光', '午后暖光', '阴天柔光', '影棚硬光'] },
        ],
      },
      source: 'manual',
      createdBy: currentUserId,
      createdAt: now,
      updatedAt: now,
    }
    onSaveItem(item)
    setSelectedGroupId(targetGroupId ?? 'ungrouped')
    selectItem(item)
    showToast('已新建配方卡，维度池与骨架可直接编辑', 'success')
  }

  const addMeta = () => {
    const now = Date.now()
    const item: SopMetaInstruction = {
      id: sopLibraryId('meta'),
      name: '未命名生成元指令',
      description: '',
      instruction: '',
      kind: 'custom',
      createdAt: now,
      updatedAt: now,
    }
    onSaveMetaInstruction(item)
    selectMeta(item)
    showToast('已新建生成元指令', 'success')
  }

  const batchDeleteSelected = () => {
    if (selectedIds.size === 0) return
    openConfirmDialog({
      title: `删除选中的 ${selectedIds.size} 个 SOP？`,
      message: '将永久删除选中的 SOP，且无法撤销。',
      confirmText: '确认删除',
      tone: 'danger',
      action: () => {
        const count = selectedIds.size
        selectedIds.forEach((itemId) => onDeleteItem(itemId))
        setSelectedIds(new Set())
        sopSelectionAnchorRef.current = null
        showToast(`已删除 ${count} 个 SOP`, 'success')
      },
    })
  }

  const moveItemsToGroup = (itemIds: string[], targetGroupId: string) => {
    const selectedItemIds = new Set(itemIds)
    if (selectedItemIds.size === 0) return
    const nextGroupId = targetGroupId || undefined
    let movedCount = 0
    items.forEach((item) => {
      if (selectedItemIds.has(item.id) && item.groupId !== nextGroupId) {
        onSaveItem({ ...item, groupId: nextGroupId, updatedAt: Date.now() })
        movedCount += 1
      }
    })
    setSelectedIds(new Set())
    sopSelectionAnchorRef.current = null
    const groupName = groups.find((group) => group.id === nextGroupId)?.name ?? '未分组'
    showToast(
      movedCount > 0 ? `已移动 ${movedCount} 个 SOP 到「${groupName}」` : `所选 SOP 已在「${groupName}」`,
      movedCount > 0 ? 'success' : 'info',
    )
  }

  const handleExport = () => {
    try {
      const data = { version: 1, exportedAt: new Date().toISOString(), groups, items, metaInstructions }
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `sop-library-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('导出失败，请重试', 'error')
      return
    }
    showToast('SOP 库已导出', 'success')
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as {
        groups?: unknown
        items?: unknown
        metaInstructions?: unknown
      }
      const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : []
      const rawItems = Array.isArray(parsed.items) ? parsed.items : []
      const rawMetas = Array.isArray(parsed.metaInstructions) ? parsed.metaInstructions : []
      const groupIdMap = new Map<string, string>()
      let addedGroups = 0
      let addedItems = 0
      let addedMetas = 0
      for (const raw of rawGroups) {
        const group = raw as Partial<SopGroup> | null
        if (!group || typeof group.name !== 'string' || !group.name.trim()) continue
        const newId = sopLibraryId('group')
        groupIdMap.set(group.id ?? '', newId)
        onSaveGroup({ id: newId, name: group.name.trim(), createdAt: Date.now(), updatedAt: Date.now() })
        addedGroups += 1
      }
      for (const raw of rawItems) {
        const item = raw as Partial<SopLibraryItem> | null
        if (!item || typeof item.name !== 'string' || typeof item.content !== 'string') continue
        const groupId = item.groupId ? (groupIdMap.get(item.groupId) ?? item.groupId) : undefined
        onSaveItem({
          id: sopLibraryId('sop'),
          groupId,
          name: item.name.trim() || '未命名 SOP',
          description: typeof item.description === 'string' ? item.description : '',
          content: item.content,
          kind: item.kind === 'series' ? 'series' : undefined,
          seriesConfig: item.kind === 'series' ? item.seriesConfig : undefined,
          source: 'manual',
          createdBy: currentUserId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        addedItems += 1
      }
      for (const raw of rawMetas) {
        const meta = raw as Partial<SopMetaInstruction> | null
        if (!meta || typeof meta.name !== 'string' || typeof meta.instruction !== 'string') continue
        onSaveMetaInstruction({
          id: sopLibraryId('meta'),
          name: meta.name.trim() || '未命名生成元指令',
          description: typeof meta.description === 'string' ? meta.description : '',
          instruction: meta.instruction,
          kind:
            meta.kind === 'general' ||
            meta.kind === 'image-prompt' ||
            meta.kind === 'prompt-reverse' ||
            meta.kind === 'variable-prompt-skill' ||
            meta.kind === 'custom'
              ? meta.kind
              : 'custom',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        addedMetas += 1
      }
      const total = addedGroups + addedItems + addedMetas
      if (total === 0) throw new Error('empty')
      showToast(`已导入 ${addedGroups} 个分组、${addedItems} 个 SOP、${addedMetas} 个元指令`, 'success')
    } catch {
      showToast('导入失败：文件格式不正确或内容为空', 'error')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const restoreVersion = (version: SopVersion) => {
    if (!itemDraft) return
    const restored = { ...itemDraft, name: version.name, content: version.content, updatedAt: Date.now() }
    onSaveItem(restored)
    setItemDraft(restored)
    setVersionDialogOpen(false)
    showToast('已恢复到所选版本', 'success')
  }

  const addReferenceImages = async (files: File[]) => {
    if (job.status === 'running') return
    const available = MAX_SOP_REFERENCE_IMAGES - referenceImages.length
    if (available <= 0) {
      setJob({
        status: 'error',
        message: '参考图片已达上限',
        error: `最多添加 ${MAX_SOP_REFERENCE_IMAGES} 张图片，请先移除一张再继续。`,
      })
      return
    }
    const validFiles = files.filter(
      (file) => (!file.type || file.type.startsWith('image/')) && file.size <= MAX_IMAGE_BYTES,
    )
    const selected = validFiles.slice(0, available)
    const skipped = files.length - selected.length
    if (selected.length === 0) {
      setJob({
        status: 'error',
        message: '没有可添加的图片',
        error: '请拖入 PNG、JPG、WEBP 等图片文件，单张大小不超过 10 MiB。',
      })
      return
    }
    try {
      const settled = await Promise.allSettled(
        selected.map(async (file, index) => ({
          id: `${Date.now()}-${index}-${file.name}`,
          name: file.name,
          dataUrl: await readImage(file),
        })),
      )
      const loaded = settled
        .filter(
          (result): result is PromiseFulfilledResult<SopReferenceImage & { id: string }> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value)
      const failed = settled.length - loaded.length
      if (loaded.length === 0) throw new Error('图片读取失败，请重新选择文件')
      setReferenceImages((current) => [...current, ...loaded])
      const omitted = skipped + failed
      setJob({
        status: 'idle',
        message:
          omitted > 0
            ? `已添加 ${loaded.length} 张参考图片，另有 ${omitted} 张因格式、大小或数量限制被跳过`
            : `已添加 ${loaded.length} 张参考图片`,
      })
    } catch (error) {
      setJob({
        status: 'error',
        message: '图片读取失败',
        error: error instanceof Error ? error.message : String(error),
      })
      showToast('图片读取失败', 'error')
    }
  }

  const addLibraryReferences = async (
    assets: Array<{ id: string; imageId: string; origins: Array<{ prompt: string }> }>,
  ) => {
    const available = Math.max(0, MAX_SOP_REFERENCE_IMAGES - referenceImages.length)
    const existingIds = new Set(referenceImages.map((image) => image.id))
    const selected = assets.filter((asset) => !existingIds.has(asset.imageId)).slice(0, available)
    try {
      const loaded = (
        await Promise.all(
          selected.map(async (asset) => {
            const image = await assetCommands.resolveReference(asset.id, {
              target: 'sop',
              sopId: selectedItemId || undefined,
            })
            if (!image) return null
            return {
              id: image.id,
              name: asset.origins[0]?.prompt?.trim().slice(0, 40) || `素材-${asset.imageId.slice(0, 8)}`,
              dataUrl: image.dataUrl,
            }
          }),
        )
      ).filter((image): image is SopReferenceImage & { id: string } => image !== null)
      setReferenceImages((current) => {
        const existing = new Set(current.map((image) => image.id))
        return [...current, ...loaded.filter((image) => !existing.has(image.id))].slice(0, MAX_SOP_REFERENCE_IMAGES)
      })
      setJob({
        status: 'idle',
        message: loaded.length ? `已从素材库添加 ${loaded.length} 张参考图片` : '没有添加新的参考图片',
      })
    } catch {
      showToast('添加素材失败，请重试', 'error')
    }
  }

  // 直接粘贴图片（Ctrl+V）到参考图片：生成页打开且未运行时拦截图片粘贴并加入参考图。
  addReferenceImagesRef.current = addReferenceImages
  pasteImageGateRef.current = {
    enabled: tab === 'generate' && !isPromptReverseGeneration && job.status !== 'running',
  }
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!pasteImageGateRef.current.enabled) return
      const items = event.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      void addReferenceImagesRef.current(imageFiles)
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  const hasDraggedFiles = (event: ReactDragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files')

  const handleReferenceDragEnter = (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    referenceDragDepthRef.current += 1
    if (job.status !== 'running' && referenceImages.length < MAX_SOP_REFERENCE_IMAGES) setReferenceDragActive(true)
  }

  const handleReferenceDragOver = (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = job.status === 'running' ? 'none' : 'copy'
  }

  const handleReferenceDragLeave = (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    referenceDragDepthRef.current = Math.max(0, referenceDragDepthRef.current - 1)
    if (referenceDragDepthRef.current === 0) setReferenceDragActive(false)
  }

  const handleReferenceDrop = async (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    referenceDragDepthRef.current = 0
    setReferenceDragActive(false)
    await addReferenceImages(Array.from(event.dataTransfer.files ?? []))
  }

  const blockUnscopedImageDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const updateGenerationProgress = (progress: SopGenerationProgress) => {
    const step: GenerationStepId = progress.stage === 'repair' ? 'parse' : progress.stage
    setJob((current) => ({
      ...current,
      status: 'running',
      message: progress.message,
      error: undefined,
      currentStep: step,
      completedSteps: generationStepsBefore(step),
    }))
  }

  const cancelGeneration = () => {
    generationAbortRef.current?.abort()
    showToast('已取消生成', 'info')
  }

  /**
   * 使用给定输入执行一次 SOP 智能生成并落库。
   * 供表单按钮与「生成记录重新生成」共用：不读取表单状态，输入全部显式传入。
   */
  const runGenerationWith = async (
    meta: GenerationMetaInput,
    groupId: string,
    brief: string,
    images: Array<SopReferenceImage & { id: string }>,
  ) => {
    if (meta.kind === 'image-prompt' && images.length === 0) {
      setJob({ status: 'error', message: '无法开始生成', error: '图片生成 SOP 至少需要一张画风参考图片' })
      return
    }
    if (meta.kind === 'variable-prompt-skill' && images.length === 0) {
      setJob({ status: 'error', message: '无法开始生成', error: '变量提示词技能至少需要一张参考图片' })
      return
    }
    if (meta.kind === 'prompt-reverse' && !brief.trim()) {
      setJob({ status: 'error', message: '无法开始反推', error: '请粘贴至少一条完整的提示词样本' })
      return
    }
    if (!brief.trim() && images.length === 0) {
      setJob({ status: 'error', message: '无法开始生成', error: '请填写生成说明或添加参考图片' })
      return
    }
    generationAbortRef.current?.abort()
    const controller = new AbortController()
    generationAbortRef.current = controller
    const generationReferenceImages = meta.kind === 'prompt-reverse' ? [] : images
    const startedAt = Date.now()
    const recordId = `sop-generation-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const targetGroup = groups.find((group) => group.id === groupId)
    const recordReferenceImages = await Promise.all(
      generationReferenceImages.map(async (image) => ({
        ...image,
        dataUrl: await createImageThumbnailDataUrl(image.dataUrl),
      })),
    )
    const generationRecord: SopGenerationRecord = {
      id: recordId,
      status: 'running',
      createdAt: startedAt,
      updatedAt: startedAt,
      metaInstruction: {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        instruction: meta.instruction,
        kind: meta.kind,
      },
      targetGroup: targetGroup ? { id: targetGroup.id, name: targetGroup.name } : undefined,
      brief,
      referenceImages: recordReferenceImages,
    }
    setElapsed(0)
    setGenerationPanel('status')
    setGenerationHistoryPage(0)
    setJob({
      status: 'running',
      message: '正在校验生成条件',
      startedAt,
      currentStep: 'validate',
      completedSteps: [],
    })
    try {
      await putSopGenerationRecord(generationRecord)
      setGenerationRecords((current) => [generationRecord, ...current.filter((item) => item.id !== recordId)])
      const generated = await onGenerateSop(
        brief,
        generationContext ?? {},
        generationReferenceImages,
        meta.kind === 'image-prompt'
          ? 'image-prompt'
          : meta.kind === 'prompt-reverse'
            ? 'prompt-reverse'
            : meta.kind === 'variable-prompt-skill'
              ? 'variable-prompt-skill'
              : 'general',
        meta.instruction,
        {
          onProgress: updateGenerationProgress,
          signal: controller.signal,
          ...(meta.kind === 'variable-prompt-skill' ? { excludeText: true } : {}),
        },
      )
      setJob((current) => ({
        ...current,
        status: 'running',
        message: '正在保存到 SOP 库',
        currentStep: 'save',
        completedSteps: generationStepsBefore('save'),
      }))
      const now = Date.now()
      const item: SopLibraryItem = {
        id: sopLibraryId('sop'),
        groupId: groupId || undefined,
        name: generated.name,
        description: generated.description,
        content: generated.sop,
        kind: generated.kind,
        seriesConfig: generated.seriesConfig,
        source: 'generated',
        metaInstructionId: meta.id,
        executionMode: meta.kind === 'variable-prompt-skill' ? 'variable-prompt' : 'prompt-generator',
        createdBy: currentUserId,
        createdAt: now,
        updatedAt: now,
      }
      onSaveItem(item)
      const completedAt = Date.now()
      const completedRecord: SopGenerationRecord = {
        ...generationRecord,
        status: 'success',
        updatedAt: completedAt,
        elapsedMs: completedAt - startedAt,
        result: {
          id: item.id,
          name: item.name,
          description: item.description,
          content: item.content,
        },
      }
      await putSopGenerationRecord(completedRecord)
      if (generationMountedRef.current) {
        setGenerationRecords((current) => [completedRecord, ...current.filter((entry) => entry.id !== recordId)])
        setSelectedGroupId(item.groupId ?? 'ungrouped')
        selectItem(item)
        setJob({
          status: 'success',
          message: `SOP「${item.name}」生成并保存成功`,
          resultName: item.name,
          resultId: item.id,
          startedAt,
          currentStep: 'save',
          completedSteps: SOP_GENERATION_STEPS.map((step) => step.id),
        })
      } else {
        // 后台完成：弹窗已关闭，右下角提示并提供跳转
        showToast(`SOP「${item.name}」已生成并保存`, 'success', {
          label: '查看结果',
          onClick: () => useStore.getState().requestSopCenterJump(item.id),
        })
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const cancelledAt = Date.now()
        setJob({ status: 'idle', message: '生成已取消' })
        const cancelledRecord: SopGenerationRecord = {
          ...generationRecord,
          status: 'error',
          updatedAt: cancelledAt,
          elapsedMs: cancelledAt - startedAt,
          error: '生成已取消',
        }
        try {
          await putSopGenerationRecord(cancelledRecord)
          setGenerationRecords((current) => [cancelledRecord, ...current.filter((entry) => entry.id !== recordId)])
        } catch {
          // 记录写入失败不影响取消结果。
        }
        return
      }
      const failedAt = Date.now()
      const errorMessage = getGenerationErrorMessage(error)
      const failedRecord: SopGenerationRecord = {
        ...generationRecord,
        status: 'error',
        updatedAt: failedAt,
        elapsedMs: failedAt - startedAt,
        error: errorMessage,
      }
      try {
        await putSopGenerationRecord(failedRecord)
        setGenerationRecords((current) => [failedRecord, ...current.filter((entry) => entry.id !== recordId)])
      } catch {
        // 保留原始生成错误，避免记录写入失败掩盖真正原因。
      }
      setJob((current) => ({
        ...current,
        status: 'error',
        message: 'SOP 生成失败',
        error: errorMessage,
        startedAt,
      }))
      if (!generationMountedRef.current) {
        showToast(`SOP 生成失败：${errorMessage}`, 'error')
      }
    }
  }

  const runGeneration = async () => {
    const meta = metaInstructions.find((item) => item.id === generatorMetaId) ?? generatorMetaFallback
    if (!meta) {
      setJob({ status: 'error', message: '无法开始生成', error: '请选择一个 SOP 生成元指令' })
      return
    }
    await runGenerationWith(meta, generatorGroupId, generatorBrief, referenceImages)
  }

  /** 把一条生成记录的输入载入生成表单（不改动记录本身），供编辑后重新生成。 */
  const loadGenerationRecordIntoForm = (record: SopGenerationRecord) => {
    if (job.status === 'running') return
    const meta = metaInstructions.find((item) => item.id === record.metaInstruction.id)
    if (meta) {
      setGeneratorMetaId(meta.id)
      setGeneratorMetaFallback(null)
    } else {
      // 元指令已从库中删除：保留当前选择，但记住记录内快照供重新生成使用。
      setGeneratorMetaFallback(record.metaInstruction)
    }
    setGeneratorGroupId(groups.some((group) => group.id === record.targetGroup?.id) ? record.targetGroup!.id : '')
    setGeneratorBrief(record.brief)
    setReferenceImages(
      record.referenceImages.map((image) => ({ id: image.id, name: image.name, dataUrl: image.dataUrl })),
    )
    setGenerationPanel('status')
    setGenerationHistoryPage(0)
  }

  /** 从生成记录一键重新生成：载入记录输入后立即使用记录内的元指令快照执行。 */
  const regenerateFromRecord = async (record: SopGenerationRecord) => {
    if (job.status === 'running') return
    loadGenerationRecordIntoForm(record)
    const meta = metaInstructions.find((item) => item.id === record.metaInstruction.id) ?? record.metaInstruction
    await runGenerationWith(meta, record.targetGroup?.id ?? '', record.brief, record.referenceImages)
  }

  const editGenerationRecord = (record: SopGenerationRecord) => {
    loadGenerationRecordIntoForm(record)
    showToast(
      `已载入生成记录「${record.result?.name ?? record.metaInstruction.name}」的输入，可修改后重新生成`,
      'success',
    )
  }

  const completedGenerationSteps = new Set(job.completedSteps ?? [])
  const activeGenerationStepIndex = job.currentStep
    ? SOP_GENERATION_STEPS.findIndex((step) => step.id === job.currentStep)
    : -1
  const generationProgress =
    job.status === 'success'
      ? 100
      : job.status === 'idle'
        ? 0
        : Math.round(((Math.max(0, activeGenerationStepIndex) + 0.5) / SOP_GENERATION_STEPS.length) * 100)
  const generationHistoryPageCount = Math.max(1, Math.ceil(generationRecords.length / GENERATION_HISTORY_PAGE_SIZE))
  const visibleGenerationRecords = generationRecords.slice(
    generationHistoryPage * GENERATION_HISTORY_PAGE_SIZE,
    (generationHistoryPage + 1) * GENERATION_HISTORY_PAGE_SIZE,
  )

  return (
    <div
      className="sop-center-overlay fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center p-4 animate-overlay-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sop-center-title"
      data-generation-detail-open={generationPanel === 'detail' && selectedGenerationRecord ? 'true' : undefined}
      data-block-global-image-input="true"
      onDragOver={blockUnscopedImageDrop}
      onDrop={blockUnscopedImageDrop}
      onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) closeSafely()
      }}
    >
      <div
        style={
          largeView
            ? // 大弹窗模式：宽度给到 80vw，但**高度同样随内容**（上限 80vh）。
              // 固定 80vh 时内容少的分组会在底部留出比默认模式更大的一片空白 ——
              // 「点一下放大反而更空」就是这么来的。内容多时仍能撑到 80vh 并内部滚动。
              { ...LARGE_MODAL_SIZE_STYLE, height: 'auto', maxHeight: '80vh' }
            : undefined
        }
        className="sop-center-dialog relative animate-modal-in flex w-full flex-col overflow-hidden transition-[width,height,max-width] duration-200 ease-out"
      >
        <header className="sop-center-header">
          <div>
            <h2 id="sop-center-title" className="text-lg font-semibold tracking-tight">
              SOP 管理中心
            </h2>
            <p className="sop-center-quiet-text mt-1 text-xs">统一管理 SOP、分组和生成元指令。</p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="导出 SOP 库" side="bottom">
              <IconButton onClick={handleExport} aria-label="导出 SOP 库" icon={<Export size={16} />} />
            </Tooltip>
            <Tooltip content="导入 SOP 库" side="bottom">
              <IconButton
                onClick={() => importInputRef.current?.click()}
                aria-label="导入 SOP 库"
                icon={<Import size={16} />}
              />
            </Tooltip>
            <LargeModalToggle largeView={largeView} dialogName="SOP 管理中心" onToggle={toggleLargeView} />
            <IconButton
              onClick={closeSafely}
              disabled={job.status === 'running'}
              aria-label="关闭 SOP 管理中心"
              icon={<X size={18} />}
            />
          </div>
        </header>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="选择要导入的 SOP 库文件"
          onChange={(event) => void handleImport(event.currentTarget.files?.[0])}
        />

        <Tabs
          aria-label="SOP 管理中心功能"
          value={tab}
          onValueChange={(value) => runAfterUnsavedConfirmation(() => setTab(value))}
          className="sop-center-tabs"
          items={[
            { value: 'library', label: 'SOP 库', icon: <Library size={16} /> },
            { value: 'meta', label: '生成元指令', icon: <Settings2 size={16} /> },
            { value: 'generate', label: '智能生成', icon: <Sparkles size={16} /> },
          ]}
        />

        {tab === 'library' && (
          <SopLibraryTab
            groups={groups}
            items={items}
            tasks={tasks}
            filteredItems={filteredItems}
            search={search}
            setSearch={setSearch}
            selectedGroupId={selectedGroupId}
            selectGroup={(groupId) => runAfterDraftConfirmation(() => setSelectedGroupId(groupId))}
            editingGroupId={editingGroupId}
            editingGroupName={editingGroupName}
            setEditingGroupName={setEditingGroupName}
            renameInputRef={renameInputRef}
            commitRenameGroup={commitRenameGroup}
            cancelRenameGroup={cancelRenameGroup}
            openGroupContextMenu={openGroupContextMenu}
            selectedIds={selectedIds}
            moveItemsToGroup={moveItemsToGroup}
            addItem={addItem}
            addCampaignRecipeItem={addCampaignRecipeItem}
            selectedItemId={selectedItemId}
            setSelectedItemId={setSelectedItemId}
            selectItemWithModifiers={selectItemWithModifiers}
            openCoverPickerForItem={openCoverPickerForItem}
            itemDraft={itemDraft}
            setItemDraft={setItemDraft}
            itemDirty={itemDirty}
            itemApplied={itemApplied}
            itemEditorHint={itemEditorHint}
            persistedItem={persistedItem}
            onApply={onApply}
            onClear={onClear}
            selectedSopId={selectedSopId}
            applyItem={applyItem}
            saveItemDraftNow={saveItemDraftNow}
            saveRevisionAsNewItem={saveRevisionAsNewItem}
            viewGeneratedPrompts={viewGeneratedPrompts}
            onManagePromptRuns={onManagePromptRuns}
            setCoverPickerOpen={setCoverPickerOpen}
            setVersionDialogOpen={setVersionDialogOpen}
            onTestSopRevision={onTestSopRevision}
            onSaveItem={onSaveItem}
            onDuplicateItem={onDuplicateItem}
            onDeleteItem={onDeleteItem}
          />
        )}
        {tab === 'meta' && (
          <SopMetaTab
            filteredMetaInstructions={filteredMetaInstructions}
            metaSearch={metaSearch}
            setMetaSearch={setMetaSearch}
            selectedMetaId={selectedMetaId}
            selectMeta={selectMeta}
            setSelectedMetaId={setSelectedMetaId}
            metaDraft={metaDraft}
            setMetaDraft={setMetaDraft}
            metaDirty={metaDirty}
            metaEditorHint={metaEditorHint}
            metaChatOpen={metaChatOpen}
            setMetaChatOpen={setMetaChatOpen}
            addMeta={addMeta}
            onSaveMetaInstruction={onSaveMetaInstruction}
            onDuplicateMetaInstruction={onDuplicateMetaInstruction}
            onDeleteMetaInstruction={onDeleteMetaInstruction}
          />
        )}
        {tab === 'generate' && (
          <SopGenerateTab
            metaInstructions={metaInstructions}
            groups={groups}
            generatorKind={generatorKind}
            isPromptReverseGeneration={isPromptReverseGeneration}
            generatorMetaId={generatorMetaId}
            setGeneratorMetaId={setGeneratorMetaId}
            onClearMetaFallback={() => setGeneratorMetaFallback(null)}
            generatorMetaFallbackName={generatorMetaFallback?.name ?? null}
            generatorGroupId={generatorGroupId}
            setGeneratorGroupId={setGeneratorGroupId}
            generatorBrief={generatorBrief}
            setGeneratorBrief={setGeneratorBrief}
            referenceImages={referenceImages}
            setReferenceImages={setReferenceImages}
            referenceDragActive={referenceDragActive}
            handleReferenceDragEnter={handleReferenceDragEnter}
            handleReferenceDragOver={handleReferenceDragOver}
            handleReferenceDragLeave={handleReferenceDragLeave}
            handleReferenceDrop={handleReferenceDrop}
            addReferenceImages={addReferenceImages}
            setAssetPickerOpen={setAssetPickerOpen}
            job={job}
            runGeneration={runGeneration}
            cancelGeneration={cancelGeneration}
            setTab={setTab}
            generationPanel={generationPanel}
            setGenerationPanel={setGenerationPanel}
            generationRecords={generationRecords}
            generationRecordsLoading={generationRecordsLoading}
            visibleGenerationRecords={visibleGenerationRecords}
            generationHistoryPage={generationHistoryPage}
            setGenerationHistoryPage={setGenerationHistoryPage}
            generationHistoryPageCount={generationHistoryPageCount}
            editGenerationRecord={editGenerationRecord}
            regenerateFromRecord={regenerateFromRecord}
            setSelectedGenerationRecord={setSelectedGenerationRecord}
            elapsed={elapsed}
            generationProgress={generationProgress}
            completedGenerationSteps={completedGenerationSteps}
            steps={SOP_GENERATION_STEPS}
          />
        )}

        {tab === 'generate' && generationPanel === 'detail' && selectedGenerationRecord && (
          <SopGenerationDetailOverlay
            record={selectedGenerationRecord}
            running={job.status === 'running'}
            onEdit={editGenerationRecord}
            onRegenerate={(record) => void regenerateFromRecord(record)}
            onBack={() => setGenerationPanel('history')}
          />
        )}

        {coverPickerOpen && itemDraft && (
          <SopCoverPickerDialog
            itemName={itemDraft.name}
            coverImageId={itemDraft.coverImageId}
            candidates={coverCandidates}
            onSelect={(imageId) => {
              setItemDraft({ ...itemDraft, coverImageId: imageId })
              setCoverPickerOpen(false)
            }}
            onRemove={() => {
              setItemDraft({ ...itemDraft, coverImageId: undefined })
              setCoverPickerOpen(false)
            }}
            onClose={() => setCoverPickerOpen(false)}
          />
        )}
      </div>

      <SopPromptRunsDialog
        open={snapshotDialogOpen}
        onOpenChange={setSnapshotDialogOpen}
        sopName={persistedItem?.name ?? '当前 SOP'}
        loading={snapshotsLoading}
        snapshots={snapshotsForItem}
      />
      <SopVersionHistoryDialog
        open={versionDialogOpen}
        onOpenChange={setVersionDialogOpen}
        sopName={itemDraft?.name ?? '当前 SOP'}
        versions={sopVersionHistory[itemDraft?.id ?? ''] ?? []}
        onRestore={restoreVersion}
      />
      {groupContextMenu &&
        (() => {
          const contextGroup = groupContextMenu.groupId
            ? groups.find((item) => item.id === groupContextMenu.groupId)
            : undefined
          return (
            <div
              ref={groupContextMenuRef}
              className="fixed z-[var(--ds-z-tooltip)] animate-fade-in"
              style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Menu label="分组操作" className="w-40">
                <MenuItem
                  icon={<FolderPlus size={14} />}
                  onClick={() => {
                    closeGroupContextMenu()
                    addGroup()
                  }}
                >
                  新建分组
                </MenuItem>
                {contextGroup && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={<Pencil size={14} />} onClick={() => renameGroupFromMenu(contextGroup)}>
                      重命名
                    </MenuItem>
                    <MenuItem icon={<Copy size={14} />} onClick={() => duplicateGroupFromMenu(contextGroup)}>
                      复制
                    </MenuItem>
                    <MenuItem
                      icon={<Trash2 size={14} />}
                      tone="danger"
                      onClick={() => deleteGroupFromMenu(contextGroup)}
                    >
                      删除
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          )
        })()}
      <AssetPickerModal
        open={assetPickerOpen}
        onOpenChange={setAssetPickerOpen}
        selectionLimit={Math.max(1, MAX_SOP_REFERENCE_IMAGES - referenceImages.length)}
        title="选择 SOP 参考素材"
        description="所选素材会直接进入当前 SOP 生成上下文。"
        onSelect={addLibraryReferences}
      />
    </div>
  )
}
