import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  type UIEvent,
} from 'react'
import { EmptyState, IconButton } from '../../design-system'
import { BookOpenCheckIcon, Layers3Icon, XIcon } from '../../design-system/icons'
import {
  editOutputs,
  prefetchImageThumbnails,
  GRID_THUMBNAIL_VARIANT,
  removeMultipleTasks,
  removeTask,
  rerunSopBatchTasks,
  reuseConfig,
  useStore,
} from '../../store'
import { getAllSopBatchSnapshots } from '../../lib/db'
import { HOVER_FULL_IMAGE_LIMIT } from '../../lib/imageHover'
import { markScrollActivity } from '../../lib/scrollActivity'
import { formatSopBatchElapsed, getSopBatchElapsedMs } from '../../lib/sopBatchTaskGrouping'
import {
  buildAssetBatchGroups,
  buildAssetBatchOverview,
  countLiveTaskOutputs,
  getPrimaryOrigin,
  hasTaskFailure,
  type AssetBatchGroup,
} from '../../lib/assetBatchGrouping'
import type { GeneratedAsset, SopBatchSnapshot, TaskRecord } from '../../types'
import { findCardImageAsset } from './assetContextMenuTarget'
import TaskCard from '../../components/TaskCard'
import SopBatchTaskCard from '../../components/SopBatchTaskCard'
import SopBatchDetailModal from '../../components/SopBatchDetailModal'
import TaskParamSummary from '../../components/TaskParamSummary'
import OrphanBatchCard from './OrphanBatchCard'
import { useAssetLibraryStore, type AssetGridDensity } from './store'
import { hasSameStrategyCard } from '../dailyBatch/planner'
import { useDailyBatchStore } from '../dailyBatch/store'
import AssetTile, { type TileSelectMode } from './AssetTile'
import AssetCardMenu from './AssetCardMenu'
import { AssetListRow } from './AssetListView'
import { getAssetGridColumns } from './AssetGrid'
import { resolveAssetContextMenuScope, type AssetMenuActionScope } from './assetContextMenuTarget'
import { useDragSelect, getMarqueeBoxStyle } from '../../hooks/useDragSelect'

/** 任务卡片固定行高（与旧画廊 TASK_CARD_ROW_HEIGHT 一致）；卡片高度固定保证虚拟化布局确定性 */
const CARD_H = 200
const CARD_GAP = 16
const VIRTUAL_OVERSCAN = 600
const SCROLL_PREFETCH_GROUPS = 12
const SCROLL_PREFETCH_ASSETS = 48

// ===== 图片砖·列表行形式的组块常量（组头 + 内联砖区）=====
const HEADER_H = 52
const PARAM_ROW_H = 32
const GROUP_GAP = 16
const TILE_GAP = 8
const BODY_PAD_X = 0
const BODY_PAD_Y = 12
const LIST_ROW_H = 64

/**
 * 任务卡片列数：宽度断点 + 密度修正（与图片网格同规则：紧凑 +1 列，大图 -1 列）。
 * 列数随工具栏「显示大小」滑动条变化（图片 / 任务卡片共用）。
 */
function getTaskCardColumns(width: number, density: AssetGridDensity = 'standard'): number {
  if (width <= 0) return 2
  let columns = width < 820 ? 1 : width < 1220 ? 2 : width < 1700 ? 3 : 4
  if (density === 'compact') columns = Math.max(1, columns + 1)
  if (density === 'cozy') columns = Math.max(1, columns - 1)
  return columns
}

/**
 * 图片砖·列表行形式的分组网格砖尺寸：按图片原始比例（钳制 0.5–2，与图片模式水流布局同规则）。
 * 返回每个砖的高度（宽固定为 cellWidth）与块体总高——行高取行内最高砖，保证虚拟化布局确定性。
 */
function computeGroupTileLayout(
  assets: GeneratedAsset[],
  columns: number,
  cellWidth: number,
): { heights: number[]; bodyHeight: number } {
  const colCount = Math.max(1, columns)
  const heights = assets.map((asset) => {
    const ratio = asset.width && asset.height ? asset.height / asset.width : 1
    return Math.max(1, Math.round(cellWidth * Math.min(2, Math.max(0.5, ratio))))
  })
  let bodyHeight = 0
  for (let index = 0; index < heights.length; index += colCount) {
    const rowMax = Math.max(...heights.slice(index, index + colCount))
    bodyHeight += rowMax
    if (index + colCount < heights.length) bodyHeight += TILE_GAP
  }
  return { heights, bodyHeight }
}

function formatGroupTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN')
}

interface AssetGroupTileProps {
  group: AssetBatchGroup
  asset: GeneratedAsset
  selected: boolean
  style: CSSProperties
  loadFullOnHover: boolean
  suppressClickUntilRef: React.MutableRefObject<number>
  onToggleSelect: (assetId: string, mode: TileSelectMode) => void
  onOpenMenu: (event: React.MouseEvent<HTMLDivElement>, asset: GeneratedAsset) => void
}

/**
 * 组内图片砖的 memo 包装：把「组闭包 → 打开组查看器」固化在内部 useCallback，
 * 对外只暴露稳定引用，保证拖拽框选中（父级每帧重渲染）图片砖零重渲染、不闪烁。
 */
const AssetGroupTile = memo(function AssetGroupTile({
  group,
  asset,
  selected,
  style,
  loadFullOnHover,
  suppressClickUntilRef,
  onToggleSelect,
  onOpenMenu,
}: AssetGroupTileProps) {
  const handleOpenViewer = useCallback(
    (assetId: string) => {
      const ids = group.assets.map((item) => item.id)
      const target = ids.includes(assetId) ? assetId : ids[0]
      if (target) useAssetLibraryStore.getState().openViewer(target, ids)
    },
    [group],
  )
  return (
    <AssetTile
      asset={asset}
      selected={selected}
      style={style}
      loadFullOnHover={loadFullOnHover}
      suppressClickUntilRef={suppressClickUntilRef}
      onToggleSelect={onToggleSelect}
      onOpenViewer={handleOpenViewer}
      onOpenMenu={onOpenMenu}
    />
  )
})

interface BatchGroupCardProps {
  group: AssetBatchGroup
  isSelected: boolean
  tasksById: ReadonlyMap<string, TaskRecord>
  suppressClickUntilRef: React.MutableRefObject<number>
  onOpenViewer: (group: AssetBatchGroup, targetId?: string) => void
  onGroupMenu: (event: React.MouseEvent<HTMLDivElement>, group: AssetBatchGroup) => void
  onToggleSelection: (group: AssetBatchGroup) => void
  onSetDetailTaskId: (taskId: string) => void
  onSetBatchDetailGroup: (group: AssetBatchGroup | null) => void
}

/**
 * 任务卡片形式的分组卡片体（SOP 批次 / 任务 / 孤儿三类）：
 * memo 化 + 内部 useCallback 固定全部处理器，滚动帧中父级重渲染不击穿 memo，
 * 避免整棵 TaskCard / SopBatchTaskCard 子树每帧重建（这是分组视图滚动卡顿的主要来源）。
 */
const AssetGroupCardBody = memo(function AssetGroupCardBody({
  group,
  isSelected,
  tasksById,
  suppressClickUntilRef,
  onOpenViewer,
  onGroupMenu,
  onToggleSelection,
  onSetDetailTaskId,
  onSetBatchDetailGroup,
}: BatchGroupCardProps) {
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const batchTasks = useCallback(
    (target: AssetBatchGroup): TaskRecord[] =>
      target.taskIds.map((id) => tasksById.get(id)).filter((task): task is TaskRecord => task != null),
    [tasksById],
  )
  const repTask = useMemo(() => {
    if (group.kind === 'orphan') return null
    return group.task ?? batchTasks(group)[0] ?? null
  }, [group, batchTasks])
  const taskList = batchTasks(group)
  const outputImagesByTask = useMemo(() => {
    const result = new Map<string, string[]>()
    for (const asset of group.assets) {
      const taskId = getPrimaryOrigin(asset)?.taskId
      if (!taskId || !asset.imageId) continue
      const imageIds = result.get(taskId) ?? []
      if (!imageIds.includes(asset.imageId)) imageIds.push(asset.imageId)
      result.set(taskId, imageIds)
    }
    return result
  }, [group.assets])

  const handleTaskCardClick = useCallback(
    (event: ReactMouseEvent | ReactTouchEvent) => {
      const e = event as ReactMouseEvent
      if (Date.now() < suppressClickUntilRef.current) return
      if (e.ctrlKey || e.metaKey) {
        onToggleSelection(group)
        return
      }
      const task = group.task ?? batchTasks(group)[0]
      if (task) onSetDetailTaskId(task.id)
    },
    [group, batchTasks, onSetDetailTaskId, onToggleSelection, suppressClickUntilRef],
  )

  const handleSopCardClick = useCallback(
    (event: ReactMouseEvent | ReactTouchEvent) => {
      const e = event as ReactMouseEvent
      if (Date.now() < suppressClickUntilRef.current) return
      if (e.ctrlKey || e.metaKey) {
        onToggleSelection(group)
        return
      }
      onSetBatchDetailGroup(group)
    },
    [group, onSetBatchDetailGroup, onToggleSelection, suppressClickUntilRef],
  )

  const handleOrphanCardClick = useCallback(
    (event: ReactMouseEvent | ReactTouchEvent) => {
      const e = event as ReactMouseEvent
      if (Date.now() < suppressClickUntilRef.current) return
      if (e.ctrlKey || e.metaKey) {
        onToggleSelection(group)
        return
      }
      onOpenViewer(group)
    },
    [group, onOpenViewer, onToggleSelection, suppressClickUntilRef],
  )

  const handleReuse = useCallback(() => {
    const task = group.task ?? batchTasks(group)[0]
    if (task) reuseConfig(task)
  }, [group, batchTasks])

  const handleEditOutputs = useCallback(() => {
    const task = group.task ?? batchTasks(group)[0]
    if (task) editOutputs(task)
  }, [group, batchTasks])

  /**
   * 「存为策略卡」的可用性。
   *
   * 两种情况都**置灰并说明原因**，而不是藏掉按钮或点了没反应：
   * ① 这批不是 SOP 出的（没有可引用的卡片）；② 发任务时素材库没选中文件夹（没有归属方向，
   * 而策略卡必须挂在方向上）。
   */
  const strategyCardDisabledReason = useMemo(() => {
    const task = taskList.find((item) => item.sopBatch)
    if (!task?.sopBatch) return '这个批次不是 SOP 生成的，没有可引用的卡片'
    if (!task.defaultCollectionId) return '这个批次没有归属方向：发任务时素材库要先选中一个方向文件夹'
    return ''
  }, [taskList])

  const handleSaveAsStrategyCard = useCallback(() => {
    const task = taskList.find((item) => item.sopBatch)
    const batch = task?.sopBatch
    const directionId = task?.defaultCollectionId
    if (!batch || !directionId) return
    const store = useDailyBatchStore.getState()
    // 同一张 SOP 在同一个方向重复存没有意义（内容完全一样），先说清而不是默默多一张卡
    if (hasSameStrategyCard(store.cards, batch.sopId, directionId)) {
      useStore.getState().showToast('这个方向已经有一张引用同一张 SOP 的策略卡了', 'info')
      return
    }
    const created = store.createCardFromGeneration({
      sopId: batch.sopId,
      sopName: batch.sopName,
      directionCollectionId: directionId,
      imagesPerPrompt: batch.imagesPerPrompt ?? task.params.n,
      sourceBatchId: batch.batchId,
    })
    useStore
      .getState()
      .showToast(
        created ? `已存为策略卡「${created.name}」，可在「每日生成」里看到` : '存为策略卡失败，请重试',
        created ? 'success' : 'error',
      )
  }, [taskList])

  const handleRerunBatch = useCallback(() => {
    const taskList = batchTasks(group)
    if (taskList.length === 0) return
    void rerunSopBatchTasks(taskList)
  }, [group, batchTasks])

  const handleDeleteGroup = useCallback(() => {
    if (group.kind === 'sop-batch') {
      const taskList = batchTasks(group)
      setConfirmDialog({
        title: '删除 SOP 批量任务',
        message: `确定要删除这 ${taskList.length} 个 SOP 子任务吗？这些任务生成的图片会一并删除（不可恢复）；被其他任务/会话引用的图片会保留。`,
        action: () =>
          removeMultipleTasks(taskList.map((task) => task.id)).catch(() =>
            useStore.getState().showToast('删除失败，请重试', 'error'),
          ),
      })
      return
    }
    const task = group.task
    if (!task) return
    setConfirmDialog({
      title: '删除任务',
      message:
        '确定要删除这个任务吗？任务的提示词、参数和它生成的图片会一并删除（不可恢复）；被其他任务/会话引用的图片会保留。',
      action: () => removeTask(task).catch(() => useStore.getState().showToast('删除失败，请重试', 'error')),
    })
  }, [group, batchTasks, setConfirmDialog])

  const handleOpenBatch = useCallback(() => onSetBatchDetailGroup(group), [group, onSetBatchDetailGroup])

  const handleOpenImage = useCallback(
    (imageId: string) => {
      const target = group.assets.find((asset) => asset.imageId === imageId)?.id
      onOpenViewer(group, target)
    },
    [group, onOpenViewer],
  )

  if (group.kind === 'sop-batch') {
    return (
      <SopBatchTaskCard
        sopName={repTask?.sopBatch?.sopName ?? group.title}
        tasks={taskList}
        summary={group.summary}
        isSelected={isSelected}
        onClick={handleSopCardClick}
        onOpenBatch={handleOpenBatch}
        onOpenImage={handleOpenImage}
        onRerun={handleRerunBatch}
        onDelete={handleDeleteGroup}
        onSaveAsStrategyCard={handleSaveAsStrategyCard}
        saveAsStrategyCardDisabledReason={strategyCardDisabledReason || undefined}
        outputImagesByTask={outputImagesByTask}
      />
    )
  }
  if (group.kind === 'task' && repTask) {
    return (
      <TaskCard
        task={repTask}
        isSelected={isSelected}
        disableSwipe
        onClick={handleTaskCardClick}
        onReuse={handleReuse}
        onEditOutputs={handleEditOutputs}
        onDelete={handleDeleteGroup}
      />
    )
  }
  return (
    <OrphanBatchCard
      group={group}
      isSelected={isSelected}
      onClick={handleOrphanCardClick}
      onOpen={() => onOpenViewer(group)}
    />
  )
})

export interface AssetBatchViewProps {
  assets: GeneratedAsset[]
  libraryAssetCount?: number
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onFindSimilar?: (assetId: string) => void
  /** 查询上下文签名：变化时重置滚动到顶部；assets 内容更新不重置（避免批量操作跳动） */
  resetScrollKey?: string
  /** 当前作用域（serialized）：决定无素材任务是否补入（生成中/失败的任务卡可见性） */
  scope?: string
  /**
   * 「包含子文件夹」：与素材查询口径一致。关闭时项目文件夹只补入直接在该文件夹
   * 提交的无素材任务（defaultCollectionId === 当前文件夹）；开启时才放行整个子树的
   * 任务。避免「A 子文件夹生成的任务卡出现在父文件夹」与图片模式不一致。
   */
  includeSubcollections?: boolean
}

/**
 * 分组视图（grouped）：把当前查询结果按「SOP 批次 → 任务 → 已删除任务」三级聚合，
 * 支持两种展现形式（`groupedViewStyle` 切换，类比图片模式的密度选择）：
 * - `cards`（任务卡片）：SOP 批次 → `SopBatchTaskCard`（封面 + SOP 名 + 进度 + 参数 + 查看批次/再次生成/删除）、
 *   任务 → `TaskCard`（缩略图 + 提示词 + 参数标签 + 重试/收藏/复用/编辑输出/删除）、
 *   任务已删除 → `OrphanBatchCard`（封面 + 提示词摘要 + 打开查看器）；卡片网格固定响应式列数，不随密度变化。
 * - `tiles`（图片砖·列表行）：组头（标题 + 状态徽章 + 常驻操作按钮 + 参数摘要）+ 组内图片砖网格（按
 *   `viewMode` 切换图片砖 / 列表行），砖列数固定按「标准」密度布局（不随密度变化）。
 *
 * 两种形式都以整卡/整组为选择单元（`useDragSelect` 的 getItemIds / getItemId）。
 */
function AssetGroupedView({
  assets,
  libraryAssetCount = assets.length,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onFindSimilar,
  resetScrollKey,
  scope,
  includeSubcollections = false,
}: AssetBatchViewProps) {
  const tasks = useStore((state) => state.tasks)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const setDetailTaskId = useStore((state) => state.setDetailTaskId)
  const selectedAssetIds = useAssetLibraryStore((state) => state.selectedAssetIds)
  const clearSelection = useAssetLibraryStore((state) => state.clearSelection)
  const batchFocusTaskId = useAssetLibraryStore((state) => state.batchFocusTaskId)
  const setBatchFocusTaskId = useAssetLibraryStore((state) => state.setBatchFocusTaskId)
  const dismissedOverviewFailedCount = useAssetLibraryStore((state) => state.dismissedOverviewFailedCount)
  const dismissOverviewFailed = useAssetLibraryStore((state) => state.dismissOverviewFailed)
  const groupedViewStyle = useAssetLibraryStore((state) => state.groupedViewStyle)
  const viewMode = useAssetLibraryStore((state) => state.viewMode)
  const gridDensity = useAssetLibraryStore((state) => state.gridDensity)
  const collections = useAssetLibraryStore((state) => state.collections)

  const suppressClickUntilRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const prefetchFrameRef = useRef<number | null>(null)
  const lastScrollTopRef = useRef(0)
  const pendingPrefetchDirectionRef = useRef<-1 | 1>(1)
  const initialPrefetchKeyRef = useRef<string | undefined>(undefined)
  const hasInitialPrefetchedRef = useRef(false)
  const groupElementRefs = useRef(new Map<string, HTMLDivElement>())
  /**
   * 「查看来源任务」登记下来、**尚未完成定位**的目标任务 id。
   *
   * 用它而不是直接看 store 里的 `batchFocusTaskId`：store 那个值由 `AssetViewer` 写、
   * 在素材变化时不会变，无法区分「这次点的意图」与「上一次点完还留着的意图」。
   * ref 表达「登记 → 销账」，定位成功即归零，因此**只会滚一次**（见下方 effect 注释）。
   */
  const focusIntentRef = useRef<string | null>(null)

  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, SopBatchSnapshot>>(new Map())
  const [layoutWidth, setLayoutWidth] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 800 })
  const [menu, setMenu] = useState<{
    x: number
    y: number
    asset: GeneratedAsset
    assetIds?: string[]
    actionScope?: AssetMenuActionScope
  } | null>(null)
  const [highlightGroupId, setHighlightGroupId] = useState<string | null>(null)
  const [batchDetailGroup, setBatchDetailGroup] = useState<AssetBatchGroup | null>(null)
  // 图片砖·列表行形式的组头参数摘要需要实时耗时（运行中的任务每秒刷新一次）
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let active = true
    void getAllSopBatchSnapshots().then((all) => {
      if (!active) return
      setSnapshots(new Map(all.map((snapshot) => [snapshot.id, snapshot])))
    })
    return () => {
      active = false
    }
  }, [])

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  // 无素材任务的可见性按作用域过滤：收藏/未整理/标签是素材专属作用域 → 不补；
  // 项目作用域 → 只补该项目提交的任务（生成中 / 失败 / 已停止，全部按 defaultCollectionId
  // 归属过滤，不再跨文件夹放行）；全部/最近 → 补全部活跃任务。
  // 「包含子文件夹」开关与素材查询口径一致：关闭时只放行直接在该文件夹提交的任务
  // （defaultCollectionId === 当前文件夹），开启时才放行整个子树的任务——避免子文件夹
  // 或其他文件夹的任务卡出现，与图片模式（严格按素材 collectionIds 过滤）一致。
  const includeTaskless = useMemo(() => {
    const current = scope ?? ''
    if (current === 'favorite' || current === 'unorganized' || current.startsWith('tag:')) {
      // 素材专属作用域：失败任务（含部分失败）仍保留任务卡——避免「任务失败后切换到
      // 收藏/未整理/标签时失败任务卡消失、用户看不到失败原因」。
      return (task: TaskRecord) => hasTaskFailure(task)
    }
    if (current.startsWith('collection:')) {
      const rootId = current.slice('collection:'.length)
      if (!includeSubcollections) {
        return (task: TaskRecord) => task.defaultCollectionId === rootId
      }
      const subtree = new Set<string>()
      const stack = [rootId]
      while (stack.length > 0) {
        const id = stack.pop()!
        if (subtree.has(id)) continue
        subtree.add(id)
        for (const collection of collections) if (collection.parentId === id) stack.push(collection.id)
      }
      return (task: TaskRecord) => task.defaultCollectionId != null && subtree.has(task.defaultCollectionId)
    }
    return () => true
  }, [collections, includeSubcollections, scope])
  // 任务卡视图不展示「任务已删除」孤儿组（按用户要求，禁止出现该状态）：只过滤展示，不自动改动任何数据。
  //
  // 2026-09-24 起删任务卡会连同产出图一起永久删除（ADR-0021），来源任务与图同时消失，
  // 不再有「任务没了、图还留着」的孤儿；此前「回收站作用域放行孤儿组」的例外随之撤除。
  const groups = useMemo(
    () =>
      buildAssetBatchGroups(assets, tasksById, snapshots, { includeTaskless }).filter(
        (group) => group.kind !== 'orphan',
      ),
    [assets, includeTaskless, snapshots, tasksById],
  )
  const overview = useMemo(() => buildAssetBatchOverview(groups, tasksById), [groups, tasksById])
  /**
   * 速览里的「失败 N」可以关掉。
   *
   * 口径与图片模式那条「生成中 / N 个任务失败」提示条完全一致（`AssetLibraryWorkspace.tsx`）：
   * 关掉后**只有失败数继续上涨**才重新出现 —— 否则切文件夹、切视图回来又冒出来，
   * 用户感知仍然是「关不掉」（2026-09-22 杰哥报障）。
   * 「生成中」不计入：它是状态不是提醒，数量变化不该让关掉的失败提示复活。
   */
  const overviewFailedNoticeVisible =
    overview.failed > 0 && (dismissedOverviewFailedCount === null || overview.failed > dismissedOverviewFailedCount)
  const selected = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds])

  // 图片砖·列表行形式的组头参数摘要需要实时耗时（运行中的任务每秒刷新一次）
  const isAnyRunning = overview.running > 0
  useEffect(() => {
    if (!isAnyRunning) return
    setNow(Date.now())
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [isAnyRunning])

  // 任务卡片形式的列数与卡宽：随「显示大小」密度变化（紧凑 +1 列 / 大图 -1 列）
  const cardColumns = useMemo(() => getTaskCardColumns(layoutWidth, gridDensity), [gridDensity, layoutWidth])
  const cardWidth = useMemo(
    // `layoutWidth === 0` = 还没量到容器宽度。此时**不能**退化成 `Math.max(1, 负数)` = 1px：
    // 那会渲染出一排宽 1 像素、视觉上「不存在」的幻影卡片（TB-106）。保持 0，由 visibleItems 拦住。
    () =>
      cardColumns > 0 && layoutWidth > 0 ? Math.max(1, (layoutWidth - CARD_GAP * (cardColumns - 1)) / cardColumns) : 0,
    [cardColumns, layoutWidth],
  )

  // 图片砖·列表行形式的列数与单元宽度：随「显示大小」密度变化（与图片模式同规则）
  const tileColumns = useMemo(() => getAssetGridColumns(layoutWidth, gridDensity), [gridDensity, layoutWidth])
  const cellWidth = useMemo(
    () =>
      tileColumns > 0 ? Math.max(1, (layoutWidth - BODY_PAD_X * 2 - TILE_GAP * (tileColumns - 1)) / tileColumns) : 0,
    [tileColumns, layoutWidth],
  )

  // 任务卡片形式：卡片确定性布局（每行 cardColumns 张、固定卡高，供视口虚拟化）
  const cardLayouts = useMemo(() => {
    const colCount = Math.max(1, cardColumns)
    return groups.map((group, index) => {
      const row = Math.floor(index / colCount)
      const col = index % colCount
      return {
        group,
        left: col * (cardWidth + CARD_GAP),
        top: row * (CARD_H + CARD_GAP),
        width: cardWidth,
        height: CARD_H,
      }
    })
  }, [groups, cardColumns, cardWidth])

  // 图片砖·列表行形式的组内砖布局缓存：列数/宽度不变时每个组只算一次，
  // 滚动帧直接复用（含稳定的砖 style 对象，避免每帧新建对象击穿 AssetGroupTile memo）
  const tileLayoutByGroup = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeGroupTileLayout> & { styles: CSSProperties[] }>()
    if (groupedViewStyle !== 'tiles' || viewMode === 'list') return map
    const colCount = Math.max(1, tileColumns)
    for (const group of groups) {
      const layout = computeGroupTileLayout(group.assets, colCount, cellWidth)
      map.set(group.id, { ...layout, styles: layout.heights.map((height) => ({ width: cellWidth, height })) })
    }
    return map
  }, [cellWidth, groupedViewStyle, groups, tileColumns, viewMode])

  // 图片砖·列表行形式：组块确定性布局（组头 + 方砖行；列表：组头 + 定高行）
  const blockLayouts = useMemo(() => {
    let top = 0
    return groups.map((group) => {
      const rows =
        viewMode === 'list'
          ? group.assets.length
          : Math.max(1, Math.ceil(group.assets.length / Math.max(1, tileColumns)))
      const bodyHeight =
        viewMode === 'list' ? rows * LIST_ROW_H : BODY_PAD_Y * 2 + (tileLayoutByGroup.get(group.id)?.bodyHeight ?? 0)
      // 有代表任务（非孤儿组）时组头多一行参数摘要
      const repTask =
        group.kind === 'orphan'
          ? null
          : (group.task ??
            group.taskIds.map((id) => tasksById.get(id)).find((task): task is TaskRecord => task != null) ??
            null)
      const headerH = repTask ? HEADER_H + PARAM_ROW_H : HEADER_H
      const height = headerH + bodyHeight
      const layout = { group, top, height }
      top += height + GROUP_GAP
      return layout
    })
  }, [groups, viewMode, tileColumns, tasksById, tileLayoutByGroup])

  const totalHeight = useMemo(() => {
    if (groupedViewStyle === 'cards') {
      if (cardLayouts.length === 0) return 0
      const rows = Math.ceil(cardLayouts.length / Math.max(1, cardColumns))
      return rows * (CARD_H + CARD_GAP) - CARD_GAP
    }
    if (blockLayouts.length === 0) return 0
    const last = blockLayouts[blockLayouts.length - 1]
    return last.top + last.height
  }, [groupedViewStyle, cardLayouts.length, cardColumns, blockLayouts])

  const visibleItems = useMemo(() => {
    const min = viewport.top - VIRTUAL_OVERSCAN
    const max = viewport.top + viewport.height + VIRTUAL_OVERSCAN
    if (groupedViewStyle === 'cards') {
      // 宽度还没量到（`cardWidth === 0`）：宁可这一帧什么都不画，也不要渲染一排 1px 宽的幻影卡片（TB-106）
      if (cardWidth <= 0) return []
      return cardLayouts.filter((layout) => layout.top + layout.height >= min && layout.top <= max)
    }
    return blockLayouts.filter((block) => block.top + block.height >= min && block.top <= max)
  }, [cardLayouts, cardWidth, blockLayouts, groupedViewStyle, viewport])

  useEffect(() => {
    if (groups.length === 0) return
    const prefetchKey = `${resetScrollKey ?? ''}|${groupedViewStyle}|${viewMode}`
    if (hasInitialPrefetchedRef.current && initialPrefetchKeyRef.current === prefetchKey) return
    hasInitialPrefetchedRef.current = true
    initialPrefetchKeyRef.current = prefetchKey
    const ids = groups
      .flatMap((group) => (groupedViewStyle === 'cards' ? group.assets.slice(0, 1) : group.assets))
      .slice(0, SCROLL_PREFETCH_ASSETS)
      .map((asset) => asset.imageId)
    prefetchImageThumbnails(ids, 'ahead', GRID_THUMBNAIL_VARIANT)
  }, [groupedViewStyle, groups, resetScrollKey, viewMode])

  const measure = useCallback((resetScroll = false) => {
    const layoutElement = layoutRef.current
    const scrollElement = scrollRef.current
    if (!layoutElement || !scrollElement) return

    const nextWidth = layoutElement.clientWidth
    const nextHeight = scrollElement.clientHeight
    if (nextWidth > 0) {
      setLayoutWidth((current) => (current === nextWidth ? current : nextWidth))
    }
    if (resetScroll) scrollElement.scrollTop = 0
    setViewport((current) => {
      const top = resetScroll ? 0 : scrollElement.scrollTop
      const height = nextHeight > 0 ? nextHeight : current.height
      return current.top === top && current.height === height ? current : { top, height }
    })
  }, [])

  /**
   * 「有东西可以测量了」——空态与非空态是**两棵不同的子树**（见下方空态提前 return），
   * 所以它一变，`layoutRef` / `scrollRef` 就是新挂上的 DOM。
   *
   * 为什么必须进依赖：下面那个测量 effect 的依赖里只有 `measure`（`useCallback([])` 恒定），
   * 也就是**一生只跑一次**。若首次挂载落在空态（两个 ref 都是 `null`），effect 会直接 return，
   * `ResizeObserver` **从此永不建立** ⇒ `layoutWidth` 永远停在 0 ⇒ `cardWidth` 退化成 1px，
   * 卡片全部「看不见」。空 → 非空的那一次切换必须补上测量与 observer（TB-106）。
   */
  const hasMeasurableContent = assets.length > 0 || groups.length > 0

  useLayoutEffect(() => {
    if (!hasMeasurableContent) return
    const layoutElement = layoutRef.current
    const scrollElement = scrollRef.current
    if (!layoutElement || !scrollElement) return
    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(layoutElement)
    observer.observe(scrollElement)
    return () => observer.disconnect()
  }, [hasMeasurableContent, measure])

  // 兜底：窗口尺寸变化（含 Electron 最大化/缩放）强制重新测量列数与视口高度。
  // 首帧若为空状态（无 layoutRef/scrollRef），上面的主 effect 会提前返回，
  // ResizeObserver 从未建立——素材加载后窗口放大时布局宽度将永远停留在旧值
  // （表现为"放大全屏后图片仍按小窗口排列，只显示一半"）。此监听不依赖元素存在。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleWindowResize = () => measure()
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [measure])

  // 查询上下文变化（切文件夹/搜索/筛选/排序）→ 重置滚动到顶部；
  // 仅 assets 内容更新（批量操作、入库）→ 重新测量但不重置滚动，避免批量移动时图片跳动闪烁。
  const resetScrollKeyRef = useRef(resetScrollKey)
  useLayoutEffect(() => {
    if (resetScrollKeyRef.current === resetScrollKey) return
    resetScrollKeyRef.current = resetScrollKey
    setMenu(null)
    setBatchDetailGroup(null)
    measure(true)
  }, [resetScrollKey, measure])

  useLayoutEffect(() => {
    // 这里只负责重新测量布局，**不**无条件关菜单：菜单自身有「点击外部 / Esc / 选中操作」
    // 三条关闭路径。只有右键目标已经从当前结果集中消失（删除、移动、切文件夹）时才关闭，
    // 否则网格任何一次内容更新都会把用户刚打开的菜单顺手清掉（表现为菜单闪一下就没）。
    setMenu((current) => (current && assets.some((item) => item.id === current.asset.id) ? current : null))
    measure(false)
    const frame = requestAnimationFrame(() => measure(false))
    return () => cancelAnimationFrame(frame)
  }, [assets, measure])

  // 生图过程中仅新增素材（assets 增加）时，保持批次详情弹窗打开，让进度/结果实时更新；
  // 仅当批次组真正消失（整批删除 / 素材被清理）时才关闭弹窗，避免“每生成一张图弹窗就关闭”。
  useEffect(() => {
    if (!batchDetailGroup) return
    const stillExists = groups.some((group) => group.id === batchDetailGroup.id)
    if (!stillExists) setBatchDetailGroup(null)
  }, [groups, batchDetailGroup])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
      if (prefetchFrameRef.current !== null) cancelAnimationFrame(prefetchFrameRef.current)
    },
    [],
  )

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      const direction: -1 | 1 = element.scrollTop >= lastScrollTopRef.current ? 1 : -1
      lastScrollTopRef.current = element.scrollTop
      pendingPrefetchDirectionRef.current = direction
      if (prefetchFrameRef.current === null) {
        prefetchFrameRef.current = requestAnimationFrame(() => {
          prefetchFrameRef.current = null
          const layouts = groupedViewStyle === 'cards' ? cardLayouts : blockLayouts
          const min = element.scrollTop - VIRTUAL_OVERSCAN
          const max = element.scrollTop + element.clientHeight + VIRTUAL_OVERSCAN
          const mounted = layouts.filter((layout) => layout.top + layout.height >= min && layout.top <= max)
          if (mounted.length === 0) return
          const minIndex = layouts.indexOf(mounted[0]!)
          const maxIndex = layouts.indexOf(mounted[mounted.length - 1]!)
          const currentDirection = pendingPrefetchDirectionRef.current
          const start =
            currentDirection > 0
              ? Math.min(layouts.length, maxIndex + 1)
              : Math.max(0, minIndex - SCROLL_PREFETCH_GROUPS)
          const end =
            currentDirection > 0
              ? Math.min(layouts.length, maxIndex + 1 + SCROLL_PREFETCH_GROUPS)
              : Math.min(layouts.length, minIndex)
          if (end <= start) return
          const ids = layouts
            .slice(start, end)
            .flatMap((layout) => (groupedViewStyle === 'cards' ? layout.group.assets.slice(0, 1) : layout.group.assets))
            .slice(0, SCROLL_PREFETCH_ASSETS)
            .map((asset) => asset.imageId)
          prefetchImageThumbnails(ids, 'ahead', GRID_THUMBNAIL_VARIANT)
        })
      }
      if (hasMore && !loadingMore && element.scrollHeight - element.scrollTop - element.clientHeight < 600)
        onLoadMore?.()
      if (scrollFrameRef.current !== null) return
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        markScrollActivity()
        setViewport((current) => {
          const top = element.scrollTop
          const height = element.clientHeight
          return current.top === top && current.height === height ? current : { top, height }
        })
      })
    },
    [blockLayouts, cardLayouts, groupedViewStyle, hasMore, loadingMore, onLoadMore],
  )

  // 查看来源任务：接住意图（登记一次即把 store 值清空 —— 清空后同一个任务再点一次
  // 仍然算「新意图」，不会因为值没变而被 React 判定为无变化）。
  useEffect(() => {
    if (!batchFocusTaskId) return
    focusIntentRef.current = batchFocusTaskId
    setBatchFocusTaskId(null)
  }, [batchFocusTaskId, setBatchFocusTaskId])

  /**
   * 查看来源任务：定位并高亮对应分组。
   *
   * ⚠️ 依赖里**必须**有 `groups`：素材仍在加载 / 目标卡片还没进虚拟化视口时，
   * 这一次找不到就什么都不做，等 `groups` 下次变化再试。
   *
   * 但**只有意图尚未销账时**才动作 —— 销账（`focusIntentRef.current = null`）发生在
   * 滚动那一刻，所以整个定位过程只会滚一次。
   * 2026-09-22 报障「突发跳转」的根因就是缺了这道销账：原实现无条件重跑，而 `groups`
   * 随 `assets` 变（生成中每秒都在新增素材）⇒ 素材每变一次就再滚一次、并把 3 秒高亮
   * 计时器一起重置 ⇒ 用户手动滚走后被反复拽回那张卡，且高亮永不消失。
   */
  useEffect(() => {
    const targetTaskId = focusIntentRef.current
    if (!targetTaskId) return
    const group = groups.find((item) => item.taskIds.includes(targetTaskId))
    if (!group) return
    const element = groupElementRefs.current.get(group.id)
    if (!element) return
    focusIntentRef.current = null
    setHighlightGroupId(group.id)
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [batchFocusTaskId, groups])

  /**
   * 高亮 3 秒后自动清除。
   *
   * 单独一个 effect（上一个是「滚动」，这个是「计时」）：两者混在一起时，`groups` 每次
   * 变化都会跑一次 cleanup，把计时器清掉 —— 结果是高亮永远等不到清除。
   */
  useEffect(() => {
    if (!highlightGroupId) return
    const timer = window.setTimeout(() => setHighlightGroupId(null), 3000)
    return () => window.clearTimeout(timer)
  }, [highlightGroupId])

  const setGroupRef = useCallback(
    (groupId: string) => (element: HTMLDivElement | null) => {
      if (element) groupElementRefs.current.set(groupId, element)
      else groupElementRefs.current.delete(groupId)
    },
    [],
  )

  // 框选：任务卡片形式以整卡为原子（getItemIds：命中卡片 = 组内全部素材）；
  // 图片砖·列表行形式以单张图片砖为原子（getItemId：data-asset-id，与图片模式一致）。
  const { selectionBox } = useDragSelect({
    containerSelector: '[data-drag-select-surface]',
    containerRef: scrollRef,
    itemSelector: '[data-asset-card]',
    getItemIds:
      groupedViewStyle === 'cards'
        ? (element) => {
            if (!(element instanceof HTMLElement)) return null
            const raw = element.dataset.assetIds
            if (!raw) return null
            try {
              const parsed = JSON.parse(raw)
              return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null
            } catch {
              return null
            }
          }
        : undefined,
    getItemId:
      groupedViewStyle === 'tiles'
        ? (element) => (element instanceof HTMLElement ? (element.dataset.assetId ?? null) : null)
        : undefined,
    onSelectionChange: (ids) => useAssetLibraryStore.getState().replaceSelection(ids),
    initialSelectedIds: selectedAssetIds,
    onSuppressClick: () => {
      suppressClickUntilRef.current = Date.now() + 250
    },
  })

  const batchTasks = (group: AssetBatchGroup): TaskRecord[] =>
    group.taskIds.map((id) => tasksById.get(id)).filter((task): task is TaskRecord => task != null)

  /** 组内代表任务：SOP 组取首个任务，任务组取该任务，孤儿组无 */
  const getRepresentativeTask = (group: AssetBatchGroup): TaskRecord | null => {
    if (group.kind === 'orphan') return null
    return (
      group.task ??
      group.taskIds.map((id) => tasksById.get(id)).find((task): task is TaskRecord => task != null) ??
      null
    )
  }

  const handleReuse = (group: AssetBatchGroup) => {
    const task = group.task ?? batchTasks(group)[0]
    if (task) reuseConfig(task)
  }

  const handleEditOutputs = (group: AssetBatchGroup) => {
    const task = group.task ?? batchTasks(group)[0]
    if (task) editOutputs(task)
  }

  const handleRerunBatch = (group: AssetBatchGroup) => {
    const taskList = batchTasks(group)
    if (taskList.length === 0) return
    void rerunSopBatchTasks(taskList)
  }

  const handleDeleteGroup = (group: AssetBatchGroup) => {
    if (group.kind === 'sop-batch') {
      const taskList = batchTasks(group)
      setConfirmDialog({
        title: '删除 SOP 批量任务',
        message: `确定要删除这 ${taskList.length} 个 SOP 子任务吗？这些任务生成的图片会一并删除（不可恢复）；被其他任务/会话引用的图片会保留。`,
        action: () =>
          removeMultipleTasks(taskList.map((task) => task.id)).catch(() =>
            useStore.getState().showToast('删除失败，请重试', 'error'),
          ),
      })
      return
    }
    const task = group.task
    if (!task) return
    setConfirmDialog({
      title: '删除任务',
      message:
        '确定要删除这个任务吗？任务的提示词、参数和它生成的图片会一并删除（不可恢复）；被其他任务/会话引用的图片会保留。',
      action: () => removeTask(task).catch(() => useStore.getState().showToast('删除失败，请重试', 'error')),
    })
  }

  const openGroupViewer = useCallback((group: AssetBatchGroup, targetId?: string) => {
    const ids = group.assets.map((asset) => asset.id)
    const target = targetId && ids.includes(targetId) ? targetId : ids[0]
    if (target) useAssetLibraryStore.getState().openViewer(target, ids)
  }, [])

  /** 图片砖·列表行形式的组头点击：切换组内全部素材的选择 */
  const toggleGroupSelection = useCallback(
    (group: AssetBatchGroup) => {
      const ids = group.assets.map((asset) => asset.id)
      const shouldSelect = !ids.every((id) => selectedAssetIds.includes(id))
      const next = new Set(selectedAssetIds)
      for (const id of ids) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
      useAssetLibraryStore.getState().replaceSelection([...next])
    },
    [selectedAssetIds],
  )

  /** 图片砖·列表行形式的单张图片砖切换（框选拖拽刚结束抑制紧随的点击） */
  const handleTileToggleSelect = useCallback(
    (assetId: string, mode: TileSelectMode) => {
      if (Date.now() < suppressClickUntilRef.current) return
      if (mode === 'replace') {
        clearSelection()
        useAssetLibraryStore.getState().selectAsset(assetId)
        return
      }
      useAssetLibraryStore.getState().toggleSelectAsset(assetId)
    },
    [clearSelection],
  )

  /** 图片砖·列表行形式的单张图片砖右键：Eagle 式（未选中 → 以该砖为唯一选中；已选中 → 作用于选区） */
  const handleTileMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, asset: GeneratedAsset) => {
    const selection = useAssetLibraryStore.getState().selectedAssetIds
    const target = resolveAssetContextMenuScope(selection, asset.id)
    if (!selection.includes(asset.id)) useAssetLibraryStore.getState().replaceSelection([asset.id])
    setMenu({ x: event.clientX, y: event.clientY, asset, assetIds: target.assetIds, actionScope: target.actionScope })
  }, [])

  /**
   * 任务卡片整卡右键：命中卡内某张图片时按「该图片」处理（Eagle 式），否则以组内全部素材为目标。
   *
   * 命中图片时必须 `stopPropagation`：卡片根 div 是卡内 img 的祖先，不拦的话 window 上的
   * 全局图片右键菜单也会打开，两个菜单叠在同一坐标、层级还不同（全局 z 更高），而
   * `AssetCardMenu` 的「点外部即关闭」会把落在上层菜单上的 pointerdown 判成外部点击 ——
   * 表现为右键菜单闪一下就没了。`AssetTile` / `AssetListRow` 早就拦了，只有这里漏了。
   */
  const handleGroupMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, group: AssetBatchGroup) => {
      const hitAsset = findCardImageAsset(event.target, group.assets)
      if (hitAsset) {
        event.preventDefault()
        event.stopPropagation()
        handleTileMenu(event, hitAsset)
        return
      }
      const first = group.assets[0]
      if (!first) return
      const selection = useAssetLibraryStore.getState().selectedAssetIds
      const groupIds = group.assets.map((asset) => asset.id)
      const included = groupIds.some((id) => selection.includes(id))
      if (!included) useAssetLibraryStore.getState().replaceSelection(groupIds)
      const assetIds = included && selection.length > 0 ? Array.from(new Set([...selection, ...groupIds])) : groupIds
      // 'full'：整卡多图按批量口径出菜单，但保留单张入口（查看大图 / 打开文件位置以首张为入口）
      setMenu({ x: event.clientX, y: event.clientY, asset: first, assetIds, actionScope: 'full' })
    },
    [handleTileMenu],
  )

  // 空状态仅在没有素材**且没有补入的任务组**（生成中/失败任务卡）时显示：
  // includeTaskless 补入的任务组必须渲染——否则「3 个任务失败」提示条点击进来
  // 会看到空状态，失败原因无处可查。
  if (assets.length === 0 && groups.length === 0) {
    return (
      <div data-testid="asset-batch-empty" className="flex min-h-0 flex-1 items-center justify-center py-10 sm:py-24">
        <EmptyState
          icon={<Layers3Icon size={22} />}
          title={libraryAssetCount === 0 ? '还没有生成素材' : '没有匹配的生成批次'}
          description={
            libraryAssetCount === 0
              ? '完成图片生成后，素材会自动收录到这里。'
              : '尝试清空搜索词、筛选条件，或切换左侧范围。'
          }
        />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      data-testid="asset-batch-view"
      data-drag-select-surface
      className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
      onClick={(event) => {
        // 框选拖拽刚结束的点击会落在容器上（mousedown/up 目标不同），此时不应当清空选区
        if (Date.now() < suppressClickUntilRef.current) return
        if (event.target === event.currentTarget) clearSelection()
      }}
      onScroll={handleScroll}
    >
      {/* 生成状态速览：分组视图的批次感总览。
          注意：不用 backdrop-blur —— sticky 头部在内容滚动时每帧重算背景模糊，是滚动卡顿的来源之一。 */}
      <div
        data-testid="asset-batch-overview"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ds-border/60 bg-ds-surface px-4 py-1.5 text-xs text-ds-muted"
      >
        <span className="tabular-nums">
          {overview.groupCount} 个分组 · {overview.taskCount} 个任务 · {overview.assetCount} 张素材
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-success" />
          完成 {overview.completed}
        </span>
        {overview.running > 0 && (
          <span className="flex items-center gap-1 tabular-nums text-ds-primary">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-ds-primary" />
            生成中 {overview.running}
          </span>
        )}
        {overviewFailedNoticeVisible && (
          <span className="flex items-center gap-1 tabular-nums text-ds-danger">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-danger" />
            失败 {overview.failed}
            {/* `.ds-icon-button` 自带 `height/min-height: var(--ds-control-md)`，特异性与 Tailwind
                工具类同为单类 ⇒ 不加 `!` 会静默吃掉尺寸、把这条 sticky 细行整行撑高（R-80 级联）。 */}
            <IconButton
              className="!h-5 !min-h-5 !w-5 shrink-0"
              size="sm"
              aria-label="关闭失败提示"
              title="关闭失败提示（失败数再次增加时会重新出现）"
              icon={<XIcon size={12} />}
              onClick={() => dismissOverviewFailed(overview.failed)}
            />
          </span>
        )}
      </div>

      {/* 内容间距层：左右留白统一 32px（滚动条在最右边缘，不挤占右侧内容间距）；
          底部留白跟随输入框高度（--input-bar-clearance），保证最后一行图片不被悬浮输入框遮挡、可完整点击 */}
      <div className="px-4 pb-[var(--input-bar-clearance,12rem)]">
        <div
          ref={layoutRef}
          data-testid="asset-grouped-layout"
          className="relative w-full"
          style={{ height: totalHeight }}
        >
          {groupedViewStyle === 'cards'
            ? (
                visibleItems as Array<{
                  group: AssetBatchGroup
                  left: number
                  top: number
                  width: number
                  height: number
                }>
              ).map(({ group, left, top, width, height }) => {
                const isHighlighted = group.id === highlightGroupId
                const groupSelected = group.assets.length > 0 && group.assets.every((asset) => selected.has(asset.id))

                return (
                  <div
                    key={group.id}
                    ref={setGroupRef(group.id)}
                    data-testid="asset-batch-card"
                    data-group-id={group.id}
                    data-asset-card
                    data-asset-ids={JSON.stringify(group.assets.map((asset) => asset.id))}
                    role="button"
                    tabIndex={0}
                    aria-pressed={groupSelected}
                    aria-label={`${group.title}，${group.outputCount} 张`}
                    onDoubleClick={(event) => {
                      event.preventDefault()
                      openGroupViewer(group)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      handleGroupMenu(event, group)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        openGroupViewer(group)
                      }
                    }}
                    className={`absolute overflow-hidden rounded-ds-lg outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
                      isHighlighted ? 'ring-2 ring-inset ring-ds-focus/70' : ''
                    }`}
                    style={{ left, top, width, height }}
                  >
                    {/* 卡体 memo 化：滚动帧中不重建 TaskCard / SopBatchTaskCard / OrphanBatchCard 子树 */}
                    <AssetGroupCardBody
                      group={group}
                      isSelected={groupSelected}
                      tasksById={tasksById}
                      suppressClickUntilRef={suppressClickUntilRef}
                      onOpenViewer={openGroupViewer}
                      onGroupMenu={handleGroupMenu}
                      onToggleSelection={toggleGroupSelection}
                      onSetDetailTaskId={setDetailTaskId}
                      onSetBatchDetailGroup={setBatchDetailGroup}
                    />
                  </div>
                )
              })
            : (visibleItems as Array<{ group: AssetBatchGroup; top: number; height: number }>).map(
                ({ group, top, height }) => {
                  const isHighlighted = group.id === highlightGroupId
                  const groupSelected = group.assets.length > 0 && group.assets.every((asset) => selected.has(asset.id))
                  const taskList = batchTasks(group)
                  const isRunning = group.summary.running > 0
                  const repTask = getRepresentativeTask(group)
                  const imageCompleted = taskList.reduce((total, task) => total + countLiveTaskOutputs(task), 0)
                  const imageTotal = taskList.reduce(
                    (total, task) =>
                      total +
                      Math.max(task.sopBatch?.imagesPerPrompt ?? task.params?.n ?? 1, task.outputImages?.length ?? 0),
                    0,
                  )
                  const batchPromptCount =
                    group.kind === 'sop-batch' && taskList.length > 0
                      ? Math.max(group.summary.total, ...taskList.map((task) => task.sopBatch?.promptCount ?? 0))
                      : 0
                  const elapsedText =
                    taskList.length > 0 ? formatSopBatchElapsed(getSopBatchElapsedMs(taskList, now)) : '—'
                  const tileLayout = tileLayoutByGroup.get(group.id)
                  return (
                    <section
                      key={group.id}
                      ref={setGroupRef(group.id)}
                      data-testid="asset-batch-group"
                      data-group-id={group.id}
                      className={`absolute left-0 right-0 overflow-hidden rounded-ds-lg border border-ds-border bg-ds-surface ${
                        isHighlighted ? 'bg-ds-primary/5 ring-1 ring-inset ring-ds-focus/50' : ''
                      }`}
                      style={{ top, height }}
                    >
                      {/* 组头：标题行 + 参数摘要行（保留任务卡功能按钮与参数，一键直达） */}
                      <div className={`border-b border-ds-border/60 ${groupSelected ? 'bg-ds-primary/5' : ''}`}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-pressed={groupSelected}
                          aria-label={`${group.title}，${group.outputCount} 张`}
                          data-testid="asset-group-header"
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleGroupSelection(group)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              toggleGroupSelection(group)
                            }
                          }}
                          className="flex h-[52px] cursor-pointer items-center gap-2 px-0 outline-none focus-visible:bg-ds-muted/10 hover:bg-ds-muted/10"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            {group.kind === 'sop-batch' && (
                              <BookOpenCheckIcon size={14} className="shrink-0 text-ds-muted" aria-hidden="true" />
                            )}
                            <span className="min-w-0 truncate text-sm font-medium">{group.title}</span>
                            {group.kind === 'orphan' && (
                              <span className="shrink-0 text-xs text-ds-danger">任务已删除</span>
                            )}
                            {isRunning && (
                              <span className="flex shrink-0 items-center gap-1 text-xs text-ds-primary">
                                <span
                                  aria-hidden="true"
                                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-ds-primary"
                                />
                                生成中 {group.summary.running}
                              </span>
                            )}
                            {group.summary.failed > 0 && (
                              <span className="flex shrink-0 items-center gap-1 text-xs text-ds-danger">
                                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-danger" />
                                失败 {group.summary.failed}
                              </span>
                            )}
                            {/* 「N 张」读组的 `outputCount`（= 任务记录里仍在的产出数）。
                                不要再写成 `group.assets.length` —— 那是「当前能查到的图」，
                                切范围/分页/把图拖走都会让它变，卡片数字就会自己跳。 */}
                            <span className="shrink-0 text-xs tabular-nums text-ds-muted">{group.outputCount} 张</span>
                            <span className="hidden shrink-0 text-xs tabular-nums text-ds-muted sm:inline">
                              {formatGroupTime(group.createdAt)}
                            </span>
                          </span>
                          <span
                            className="ml-auto flex shrink-0 items-center gap-1"
                            data-no-drag-select
                            onClick={(event) => event.stopPropagation()}
                          >
                            {group.kind !== 'orphan' && group.task && (
                              <>
                                <button
                                  type="button"
                                  title="复用配置"
                                  aria-label={`复用配置 ${group.title}`}
                                  onClick={() => handleReuse(group)}
                                  className="rounded-md border border-ds-border px-2 py-1 text-xs text-ds-muted outline-none hover:bg-ds-muted/10 hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-focus/50"
                                >
                                  复用配置
                                </button>
                                <button
                                  type="button"
                                  title="编辑输出"
                                  aria-label={`编辑输出 ${group.title}`}
                                  disabled={
                                    taskList.length === 0 ||
                                    !taskList.some((task) => (task.outputImages?.length ?? 0) > 0)
                                  }
                                  onClick={() => handleEditOutputs(group)}
                                  className="rounded-md border border-ds-border px-2 py-1 text-xs text-ds-muted outline-none hover:bg-ds-muted/10 hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-focus/50 disabled:opacity-40"
                                >
                                  编辑输出
                                </button>
                              </>
                            )}
                            {group.kind === 'sop-batch' && (
                              <button
                                type="button"
                                title="再次生成"
                                aria-label={`再次生成 ${group.title}`}
                                disabled={isRunning}
                                onClick={() => handleRerunBatch(group)}
                                className="rounded-md border border-ds-border px-2 py-1 text-xs text-ds-muted outline-none hover:bg-ds-muted/10 hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-focus/50 disabled:opacity-40"
                              >
                                再次生成
                              </button>
                            )}
                            {group.kind !== 'orphan' && (
                              <button
                                type="button"
                                title={group.kind === 'sop-batch' ? '删除批次' : '删除任务'}
                                aria-label={`${group.kind === 'sop-batch' ? '删除批次' : '删除任务'} ${group.title}`}
                                onClick={() => handleDeleteGroup(group)}
                                className="rounded-md border border-ds-border px-2 py-1 text-xs text-ds-danger outline-none hover:bg-ds-danger/10 focus-visible:ring-2 focus-visible:ring-ds-focus/50"
                              >
                                删除
                              </button>
                            )}
                          </span>
                        </div>

                        {/* 参数摘要行：任务卡 TaskParamSummary（来源/模型/尺寸/质量/格式/数量）+ 图片进度/耗时 */}
                        {repTask && (
                          <div
                            data-testid="asset-group-params"
                            data-no-drag-select
                            onClick={(event) => event.stopPropagation()}
                            className="flex items-center gap-2 overflow-hidden border-t border-ds-border/40 px-0 py-1"
                          >
                            <TaskParamSummary task={repTask} className="hide-scrollbar mask-edge-r min-w-0" />
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-ds-muted">
                              {batchPromptCount > 0 && <>整批 {batchPromptCount} 条提示词 · </>}
                              图片 {imageCompleted}/{imageTotal} · 耗时 {elapsedText}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 组内素材：网格 = 同一套图片砖；列表 = 同一套列表行 */}
                      {viewMode === 'list' ? (
                        <div data-testid="asset-group-list">
                          {group.assets.map((asset) => (
                            <AssetListRow
                              key={asset.id}
                              asset={asset}
                              selected={selected.has(asset.id)}
                              onToggleSelect={handleTileToggleSelect}
                              onOpenViewer={(assetId) => openGroupViewer(group, assetId)}
                              onContextMenu={handleTileMenu}
                              onKeyDown={(event, rowAsset) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  openGroupViewer(group, rowAsset.id)
                                }
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                        <div
                          data-testid="asset-group-tiles"
                          className="px-0 py-3"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${Math.max(1, tileColumns)}, ${cellWidth}px)`,
                            gap: TILE_GAP,
                            justifyContent: 'start',
                            alignItems: 'start',
                          }}
                        >
                          {group.assets.map((asset, index) => (
                            <AssetGroupTile
                              key={asset.id}
                              group={group}
                              asset={asset}
                              selected={selected.has(asset.id)}
                              loadFullOnHover={libraryAssetCount <= HOVER_FULL_IMAGE_LIMIT}
                              style={tileLayout!.styles[index]}
                              suppressClickUntilRef={suppressClickUntilRef}
                              onToggleSelect={handleTileToggleSelect}
                              onOpenMenu={handleTileMenu}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  )
                },
              )}
        </div>
      </div>

      <div
        role="status"
        aria-hidden={!loadingMore}
        className="flex h-10 items-center justify-center text-xs text-ds-muted"
      >
        {loadingMore ? '正在加载更多素材…' : ''}
      </div>
      {selectionBox && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-sm border border-ds-selection-border bg-ds-selection/60"
          style={getMarqueeBoxStyle(selectionBox, scrollRef.current)}
        />
      )}
      {menu && (
        <AssetCardMenu
          x={menu.x}
          y={menu.y}
          asset={menu.asset}
          assetIds={menu.assetIds}
          actionScope={menu.actionScope}
          assetIdList={assets.map((asset) => asset.id)}
          onFindSimilar={onFindSimilar}
          onClose={() => setMenu(null)}
        />
      )}
      {batchDetailGroup && (
        <SopBatchDetailModal
          sopName={batchDetailGroup.title}
          tasks={batchTasks(batchDetailGroup)}
          onClose={() => setBatchDetailGroup(null)}
          onOpenImage={(imageId) => {
            const target = batchDetailGroup.assets.find((asset) => asset.imageId === imageId)?.id
            openGroupViewer(batchDetailGroup, target)
          }}
        />
      )}
    </div>
  )
}

export default memo(AssetGroupedView)
