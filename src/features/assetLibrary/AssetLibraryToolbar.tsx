import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AssetLibraryFilters, AssetSortKey, AssetSourceMode, PinnedFilter } from '../../types'
import {
  Badge,
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  ProgressRing,
  SearchField,
  SegmentedControl,
  Slider,
  Toolbar,
} from '../../design-system'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  ListChecksIcon,
  PinIcon,
  StarIcon,
  XIcon,
} from '../../design-system/icons'
import { useAssetLibraryStore, type AssetGridDensity, type AssetGroupBy } from './store'
import { COLOR_LABEL_OPTIONS } from './colorLabels'
import { pinnedFilterKey, pinnedFilterLabel } from './pinnedFilters'
import FilterControlStrip from './FilterControlStrip'
import { runManualPostprocess, useStore } from '../../store'
import {
  useAnyDirectionPostprocessBusy,
  useLatestPostprocessRun,
  usePostprocessRuns,
  useRuntimeStore,
} from '../../stores/runtimeStore'
import { useDismissableLayer } from '../../hooks/useDismissableLayer'
import {
  POSTPROCESS_RUN_STATUS_TONES,
  countPostprocessIssues,
  formatPostprocessRunBadge,
  formatPostprocessRunProgress,
  getPostprocessRunPercent,
  isRunInFlight,
} from '../postprocess/postprocessRun'
import { POSTPROCESS_STAGE_LABELS } from '../postprocess/postprocessIssue'
import { collectTargetDirectionIdsFromOwnership, resolveEffectiveSavedTargets } from '../postprocess/directionTargets'
import { pickDeepestCollectionId } from '../projectTree/params'
import PostprocessRunsDialog from '../postprocess/PostprocessRunsDialog'
import PostprocessTargetsDialog from '../postprocess/PostprocessTargetsDialog'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'

export interface AssetLibraryToolbarProps {
  scopeLabel: string
  totalCount: number
  /** 当前查询结果可见素材数（用于全选） */
  visibleCount?: number
  onSelectAll?: () => void
  /** 服务商筛选选项（来自素材来源） */
  providerOptions?: string[]
  /** 相似图片搜索标签；存在时显示可清除的徽章 */
  similarLabel?: string
  onClearSimilar?: () => void
  /** 导入外部图片文件为素材 */
  onImportFiles?: (files: File[]) => void
  /** 近似重复检测入口（Electron 可用时显示） */
  onOpenDuplicates?: () => void
  /** 当前范围是否为项目（文件夹）：显示「包含子文件夹」递归开关 */
  isCollectionScope?: boolean
  /** Ctrl/Cmd+F 聚焦搜索框 */
  searchInputRef?: React.Ref<HTMLInputElement>
}

const SORT_OPTIONS: Array<{ key: AssetSortKey; label: string }> = [
  { key: 'updatedAt', label: '最近整理' },
  { key: 'createdAt', label: '生成时间' },
  // 命名的两种排法：整体名（日期-标签-批次-序号）与只看批次号那一段。
  // 放在生成时间旁边——它们描述的都是「这张图是怎么被命名的」，与评分/尺寸那类客观指标不是一类。
  { key: 'name', label: '命名' },
  { key: 'batch', label: '批次号' },
  { key: 'rating', label: '评分' },
  { key: 'width', label: '宽度' },
  { key: 'area', label: '面积' },
]

const SOURCE_MODE_LABELS: Record<AssetSourceMode, string> = {
  gallery: '画廊',
  agent: 'Agent',
  schedule: '日程',
  sop: 'SOP',
  unknown: '未知',
}

function toDateInputValue(timestamp: number | undefined): string {
  if (timestamp === undefined) return ''
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 筛选面板里的「固定到顶部」图钉按钮：
 * 把当前控件选中的单个筛选值固定到顶部快捷栏（再次点击取消固定）。
 * disabled 时（当前值为「不限」）置灰并提示先选择值。
 */
function FilterPinButton({ filter, disabled = false }: { filter: PinnedFilter; disabled?: boolean }) {
  const pinnedFilters = useAssetLibraryStore((s) => s.pinnedFilters)
  const togglePinFilter = useAssetLibraryStore((s) => s.togglePinFilter)
  const isPinned = pinnedFilters.some((item) => pinnedFilterKey(item) === pinnedFilterKey(filter))
  const label = pinnedFilterLabel(filter)
  return (
    <button
      type="button"
      aria-label={isPinned ? `取消固定到顶部：${label}` : `固定到顶部：${label}`}
      aria-pressed={isPinned}
      title={
        disabled ? '先选择值再固定到顶部' : isPinned ? `已固定到顶部，点击取消（${label}）` : `固定到顶部（${label}）`
      }
      disabled={disabled}
      data-testid={`asset-filter-pin-${pinnedFilterKey(filter)}`}
      onClick={() => togglePinFilter(filter)}
      className={`flex shrink-0 items-center rounded p-1 outline-none transition focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
        isPinned
          ? 'text-ds-primary hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10'
          : 'text-ds-muted hover:bg-ds-muted/15 hover:text-ds-text'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <PinIcon size={12} filled={isPinned} aria-hidden="true" />
    </button>
  )
}

function AssetLibraryToolbar({
  scopeLabel,
  totalCount,
  visibleCount = 0,
  onSelectAll,
  providerOptions = [],
  similarLabel,
  onClearSimilar,
  onImportFiles,
  onOpenDuplicates,
  isCollectionScope = false,
  searchInputRef,
}: AssetLibraryToolbarProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const query = useAssetLibraryStore((s) => s.query)
  const setQuery = useAssetLibraryStore((s) => s.setQuery)
  const filters = useAssetLibraryStore((s) => s.filters)
  const setFilters = useAssetLibraryStore((s) => s.setFilters)
  const sortKey = useAssetLibraryStore((s) => s.sortKey)
  const sortOrder = useAssetLibraryStore((s) => s.sortOrder)
  const setSort = useAssetLibraryStore((s) => s.setSort)
  const selectedAssetCount = useAssetLibraryStore((s) => s.selectedAssetIds.length)

  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  // 筛选 / 排序面板统一关闭：点面板外任意处或 Esc（原来只能再点一次触发按钮）
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const filterAnchorRef = useRef<HTMLButtonElement>(null)
  const sortPanelRef = useRef<HTMLDivElement>(null)
  const sortAnchorRef = useRef<HTMLButtonElement>(null)
  useDismissableLayer({
    enabled: filterOpen,
    onDismiss: () => setFilterOpen(false),
    ref: filterPanelRef,
    anchorRef: filterAnchorRef,
  })
  useDismissableLayer({
    enabled: sortOpen,
    onDismiss: () => setSortOpen(false),
    ref: sortPanelRef,
    anchorRef: sortAnchorRef,
  })

  const activeFilterCount = [
    filters.favoriteOnly,
    filters.minRating !== undefined && filters.minRating > 0,
    filters.orientation,
    filters.provider,
    filters.model,
    filters.sourceMode,
    filters.collectionId,
    filters.colorLabel,
    (filters.tagIds?.length ?? 0) > 0,
    filters.dateFrom !== undefined,
    filters.dateTo !== undefined,
    filters.minWidth !== undefined,
    filters.maxWidth !== undefined,
  ].filter(Boolean).length

  const sortLabel = SORT_OPTIONS.find((option) => option.key === sortKey)?.label ?? '排序'

  const patchFilters = (patch: Partial<AssetLibraryFilters>) => {
    setFilters({ ...filters, ...patch })
  }

  const clearFilters = () => setFilters({})

  // 水平内边距统一到 16px：与设计系统 Container 的 padding-inline(--ds-space-4)、
  // 顶栏的 safe-area-x、每日生成 / 中控台标题行共用同一条左基线（TB-110）。
  // 原 32px(px-8) 是全应用唯一一处，会让顶栏品牌与素材库内容左边界差 16px。
  return (
    <Toolbar
      label="素材库工具栏"
      data-testid="asset-library-toolbar"
      className="flex flex-wrap items-center gap-2 px-4 py-2"
    >
      <span className="text-sm font-medium text-ds-foreground">{scopeLabel}</span>
      <span className="text-xs tabular-nums text-ds-muted">{totalCount} 张</span>
      {selectedAssetCount > 0 && (
        <span
          role="status"
          aria-live="polite"
          data-testid="asset-selection-count"
          className="text-xs font-semibold tabular-nums text-ds-primary"
        >
          已选择 {selectedAssetCount} 张
        </span>
      )}

      {isCollectionScope && <IncludeSubcollectionsSwitch />}

      <PostprocessTargetsEntryButton />

      <ManualPostprocessButton />

      <PostprocessStatusEntry />

      {similarLabel && onClearSimilar && (
        <Badge tone="info">
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-label={`清除相似搜索：${similarLabel}`}
            data-testid="asset-clear-similar"
            onClick={onClearSimilar}
          >
            {similarLabel}
            <XIcon size={12} />
          </button>
        </Badge>
      )}

      <SearchField
        ref={searchInputRef}
        className="w-56"
        size="sm"
        label="搜索素材"
        placeholder="搜索提示词、模型、项目"
        value={query}
        onChange={setQuery}
        onClear={() => setQuery('')}
      />

      {/* 筛选控件条：「+」菜单自主选择放出的筛选参数（维度级），选值即筛选 */}
      <FilterControlStrip providerOptions={providerOptions} />

      <div className="relative">
        <Badge tone={activeFilterCount > 0 ? 'info' : 'neutral'}>
          <button
            ref={filterAnchorRef}
            type="button"
            className="flex items-center gap-1.5"
            aria-expanded={filterOpen}
            onClick={() => {
              setFilterOpen((open) => !open)
              setSortOpen(false)
            }}
          >
            筛选
            {activeFilterCount > 0 && <span className="tabular-nums">({activeFilterCount})</span>}
          </button>
        </Badge>
        {filterOpen && (
          <Popover ref={filterPanelRef} label="素材筛选" className="!absolute left-0 top-full z-dropdown mt-2 w-72">
            <div className="max-h-[28rem] space-y-3 overflow-y-auto p-3">
              <label className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  仅看收藏
                  <FilterPinButton filter={{ kind: 'favoriteOnly' }} />
                </span>
                <input
                  type="checkbox"
                  checked={filters.favoriteOnly === true}
                  onChange={(event) => patchFilters({ favoriteOnly: event.target.checked || undefined })}
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  最低评分
                  <FilterPinButton
                    filter={{ kind: 'minRating', value: filters.minRating ?? 1 }}
                    disabled={!filters.minRating || filters.minRating <= 0}
                  />
                </span>
                <select
                  value={filters.minRating ?? 0}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    patchFilters({ minRating: value > 0 ? value : undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value={0}>不限</option>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} 星及以上
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  形状
                  <FilterPinButton
                    filter={{ kind: 'orientation', value: filters.orientation ?? 'landscape' }}
                    disabled={!filters.orientation}
                  />
                </span>
                <select
                  value={filters.orientation ?? ''}
                  onChange={(event) => {
                    const value = event.target.value as AssetLibraryFilters['orientation']
                    patchFilters({ orientation: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  <option value="landscape">横向</option>
                  <option value="portrait">纵向</option>
                  <option value="square">方形</option>
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  生成来源
                  <FilterPinButton
                    filter={{ kind: 'sourceMode', value: filters.sourceMode ?? 'gallery' }}
                    disabled={!filters.sourceMode}
                  />
                </span>
                <select
                  value={filters.sourceMode ?? ''}
                  onChange={(event) => {
                    const value = event.target.value as AssetSourceMode | ''
                    patchFilters({ sourceMode: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  {Object.entries(SOURCE_MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  颜色
                  <FilterPinButton
                    filter={{ kind: 'colorLabel', value: filters.colorLabel ?? 'red' }}
                    disabled={!filters.colorLabel}
                  />
                </span>
                <select
                  value={filters.colorLabel ?? ''}
                  onChange={(event) => {
                    const value = event.target.value as AssetLibraryFilters['colorLabel']
                    patchFilters({ colorLabel: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  {COLOR_LABEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  服务商
                  <FilterPinButton
                    filter={{ kind: 'provider', value: filters.provider ?? '' }}
                    disabled={!filters.provider}
                  />
                </span>
                <select
                  value={filters.provider ?? ''}
                  onChange={(event) => {
                    const value = event.target.value
                    patchFilters({ provider: value || undefined })
                  }}
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1"
                >
                  <option value="">不限</option>
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 flex items-center gap-1">
                  模型
                  <FilterPinButton
                    filter={{ kind: 'model', value: filters.model ?? '' }}
                    disabled={!filters.model?.trim()}
                  />
                </span>
                <input
                  type="text"
                  value={filters.model ?? ''}
                  onChange={(event) => patchFilters({ model: event.target.value.trim() || undefined })}
                  placeholder="如 gpt-image-1"
                  className="w-full rounded border border-ds-border bg-ds-surface px-2 py-1 outline-none placeholder:text-ds-muted focus:border-ds-primary"
                />
              </label>
              <fieldset className="block text-xs">
                <legend className="mb-1">生成日期</legend>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    aria-label="起始日期"
                    value={toDateInputValue(filters.dateFrom)}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ dateFrom: value ? new Date(`${value}T00:00:00`).getTime() : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                  <span className="text-ds-muted">至</span>
                  <input
                    type="date"
                    aria-label="结束日期"
                    value={toDateInputValue(filters.dateTo)}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ dateTo: value ? new Date(`${value}T23:59:59.999`).getTime() : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                </div>
              </fieldset>
              <fieldset className="block text-xs">
                <legend className="mb-1">宽度（像素）</legend>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    aria-label="最小宽度"
                    placeholder="最小"
                    value={filters.minWidth ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ minWidth: value ? Number(value) : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                  <span className="text-ds-muted">至</span>
                  <input
                    type="number"
                    min={0}
                    aria-label="最大宽度"
                    placeholder="最大"
                    value={filters.maxWidth ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      patchFilters({ maxWidth: value ? Number(value) : undefined })
                    }}
                    className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1"
                  />
                </div>
              </fieldset>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-xs text-ds-primary"
                >
                  <XIcon size={12} /> 清除全部筛选
                </button>
              )}
            </div>
          </Popover>
        )}
      </div>

      <div className="relative">
        <Badge tone="neutral">
          <button
            ref={sortAnchorRef}
            type="button"
            className="flex items-center gap-1.5"
            aria-expanded={sortOpen}
            onClick={() => {
              setSortOpen((open) => !open)
              setFilterOpen(false)
            }}
          >
            <ArrowDownIcon size={13} />
            {sortLabel}
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </Badge>
        {sortOpen && (
          <Popover ref={sortPanelRef} label="素材排序" className="!absolute left-0 top-full z-dropdown mt-2 w-52">
            <Menu label="排序方式">
              {SORT_OPTIONS.map((option) => (
                <MenuItem
                  key={option.key}
                  onClick={() => {
                    const nextOrder = sortKey === option.key && sortOrder === 'desc' ? 'asc' : 'desc'
                    setSort(option.key, nextOrder)
                    setSortOpen(false)
                  }}
                >
                  {option.label}
                  {sortKey === option.key ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : ''}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  setSort('updatedAt', 'desc')
                  setSortOpen(false)
                }}
              >
                重置排序
              </MenuItem>
            </Menu>
          </Popover>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <FavoriteToggleButton />
        <ViewPresetControl />
        {/* 显示大小滑动条（图片 / 任务卡片共用）+ 列表按钮（仅图片视图） */}
        <LayoutPresetControl />
        <SaveFilterButton />
        {onImportFiles && (
          <>
            <Badge tone="neutral">
              <button
                type="button"
                className="flex items-center gap-1.5"
                data-testid="asset-import-files"
                onClick={() => importInputRef.current?.click()}
              >
                <FolderIcon size={13} />
                导入图片
              </button>
            </Badge>
            <input
              ref={importInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const files = event.target.files ? Array.from(event.target.files) : []
                if (files.length > 0) onImportFiles(files)
                event.target.value = ''
              }}
            />
          </>
        )}
        {onOpenDuplicates && (
          <Badge tone="neutral">
            <button
              type="button"
              className="flex items-center gap-1.5"
              data-testid="asset-open-duplicates"
              onClick={onOpenDuplicates}
            >
              <CopyIcon size={13} />
              查重
            </button>
          </Badge>
        )}
        {onSelectAll && visibleCount > 0 && (
          <Badge tone="neutral">
            <button
              type="button"
              className="flex items-center gap-1.5"
              data-testid="asset-select-all"
              onClick={onSelectAll}
              title="选中当前查询的全部素材（不受分页限制）"
            >
              <CheckCircleIcon size={13} />
              全选全部结果
            </button>
          </Badge>
        )}
      </div>
    </Toolbar>
  )
}

/** 「包含子文件夹」：项目 scope 递归查询开关（Eagle 风格，持久化，默认开启）。 */
function IncludeSubcollectionsSwitch() {
  const includeSubcollections = useAssetLibraryStore((s) => s.includeSubcollections)
  const setIncludeSubcollections = useAssetLibraryStore((s) => s.setIncludeSubcollections)
  return (
    <Badge tone={includeSubcollections ? 'info' : 'neutral'}>
      <button
        type="button"
        role="switch"
        aria-checked={includeSubcollections}
        aria-label="包含子文件夹"
        data-testid="asset-include-subcollections"
        title="关闭时仅显示当前文件夹素材（顶部展示子文件夹，可点击进入）；开启后连同全部下级文件夹的素材一起显示"
        onClick={() => setIncludeSubcollections(!includeSubcollections)}
        className="flex items-center gap-1.5"
      >
        <FolderOpenIcon size={13} />
        包含子文件夹
        <span
          aria-hidden="true"
          className={`relative h-3.5 w-6 rounded-full transition-colors ${includeSubcollections ? 'bg-ds-primary' : 'bg-ds-muted/40'}`}
        >
          <span
            className={`absolute top-0.5 left-0 h-2.5 w-2.5 rounded-full bg-ds-surface transition-transform ${includeSubcollections ? 'translate-x-3' : 'translate-x-0.5'}`}
          />
        </span>
      </button>
    </Badge>
  )
}

/** 视图预设（图片 / 任务卡片，0.7.56 方案）：生图由任务卡承载，两种方式都只是展示形式。
 *  - 图片：大图平铺（纯素材网格 / 列表），看"图"；
 *  - 任务卡片：每次生成对应一张任务卡（承载提示词、参数与图片），看"任务"。
 *  旧的「分组·图片砖」展现已并入任务卡片（迁移时归一，工具栏不再提供入口）。 */
type ViewPreset = 'images' | 'cards'

function getViewPreset(groupBy: AssetGroupBy): ViewPreset {
  return groupBy === 'none' ? 'images' : 'cards'
}

const VIEW_PRESET_OPTIONS: Array<{ value: ViewPreset; label: string; icon: ReactNode }> = [
  { value: 'images', label: '图片', icon: <ImageIcon size={13} /> },
  { value: 'cards', label: '任务卡片', icon: <ListChecksIcon size={13} /> },
]

/** 视图按钮组（图片 / 任务卡片）：点击即切换，持久化；对应 0.7.56 画廊的「大图 / 任务卡片」两种显示方式。 */
function ViewPresetControl() {
  const groupBy = useAssetLibraryStore((s) => s.groupBy)
  const setGroupBy = useAssetLibraryStore((s) => s.setGroupBy)

  return (
    <SegmentedControl
      aria-label="视图方式"
      size="sm"
      value={getViewPreset(groupBy)}
      options={VIEW_PRESET_OPTIONS.map((option) => ({
        value: option.value,
        label: (
          <span className="flex items-center gap-1">
            {option.icon}
            {option.label}
          </span>
        ),
      }))}
      onValueChange={(value) => setGroupBy(value === 'images' ? 'none' : 'grouped')}
    />
  )
}

/** 显示大小滑动条（Eagle 式，图片 / 任务卡片视图共用）：拖动调节网格密度与任务卡片列数（紧凑 / 标准 / 大图）。
 *  列表保留为独立小按钮（仅图片视图；列表不消耗密度，选择列表时保留密度偏好，返回网格时恢复）。 */
const DENSITY_ORDER: AssetGridDensity[] = ['compact', 'standard', 'cozy']

function LayoutPresetControl() {
  const viewMode = useAssetLibraryStore((s) => s.viewMode)
  const gridDensity = useAssetLibraryStore((s) => s.gridDensity)
  const groupBy = useAssetLibraryStore((s) => s.groupBy)
  const setViewMode = useAssetLibraryStore((s) => s.setViewMode)
  const setGridDensity = useAssetLibraryStore((s) => s.setGridDensity)

  const isImages = getViewPreset(groupBy) === 'images'

  return (
    <div className="flex items-center gap-1.5">
      <Slider
        aria-label="显示大小"
        title="拖动调节显示大小：紧凑 / 标准 / 大图"
        className="[&_input]:w-24"
        min={0}
        max={DENSITY_ORDER.length - 1}
        step={1}
        value={DENSITY_ORDER.indexOf(gridDensity)}
        onChange={(value) => {
          setGridDensity(DENSITY_ORDER[value])
          setViewMode('grid')
        }}
      />
      {isImages && (
        <Badge tone={viewMode === 'list' ? 'info' : 'neutral'}>
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-label="列表视图"
            aria-pressed={viewMode === 'list'}
            title="列表视图"
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          >
            <ListChecksIcon size={13} />
          </button>
        </Badge>
      )}
    </div>
  )
}

/** 保存当前范围/关键词/筛选为智能文件夹。 */
function SaveFilterButton() {
  const query = useAssetLibraryStore((s) => s.query)
  const filters = useAssetLibraryStore((s) => s.filters)
  const scope = useAssetLibraryStore((s) => s.scope)
  const addSavedFilter = useAssetLibraryStore((s) => s.addSavedFilter)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  // 保存面板同样支持「点外 / Esc」关闭：原来只能再点一次触发按钮
  const panelRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  useDismissableLayer({ enabled: open, onDismiss: () => setOpen(false), ref: panelRef, anchorRef })

  const hasActiveCriteria = Boolean(query.trim()) || Object.keys(filters).length > 0 || scope !== 'all'
  if (!hasActiveCriteria) return null

  return (
    <div className="relative">
      <Badge tone="neutral">
        <button
          ref={anchorRef}
          type="button"
          className="flex items-center gap-1.5"
          aria-expanded={open}
          data-testid="asset-save-filter"
          onClick={() => {
            setOpen((value) => !value)
            setName('')
          }}
        >
          <FolderIcon size={13} />
          保存为智能文件夹
        </button>
      </Badge>
      {open && (
        <Popover ref={panelRef} label="保存智能文件夹" className="!absolute right-0 top-full z-dropdown mt-2 w-60">
          <form
            className="flex items-center gap-2 p-2"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                const saved = addSavedFilter(name)
                if (saved) {
                  setOpen(false)
                  useStore.getState().showToast(`已保存智能文件夹「${saved.name}」`, 'success')
                }
              } catch {
                useStore.getState().showToast('保存失败', 'error')
              }
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="文件夹名称，如：竖版高清"
              aria-label="智能文件夹名称"
              className="min-w-0 flex-1 rounded border border-ds-border bg-ds-surface px-2 py-1 text-xs outline-none placeholder:text-ds-muted focus:border-ds-primary"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="shrink-0 rounded-md bg-ds-primary px-2.5 py-1 text-xs font-medium text-ds-text-inverse outline-none hover:bg-ds-primary-hover disabled:opacity-50"
            >
              保存
            </button>
          </form>
        </Popover>
      )}
    </div>
  )
}

/** 收藏夹按钮：进入/退出收藏夹（收藏夹内容嵌入素材库内容区，侧栏与顶部工具栏保持不变）。
 * 与素材库「仅看收藏」筛选解耦——本按钮只驱动主 store 的 filterFavorite，由 AssetLibraryWorkspace 渲染收藏夹。 */
function FavoriteToggleButton() {
  const filters = useAssetLibraryStore((s) => s.filters)
  const setFilters = useAssetLibraryStore((s) => s.setFilters)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)

  const handleClick = () => {
    if (filterFavorite) {
      // 退出收藏夹：清收藏模式与收藏夹选择，并同步素材库的收藏筛选
      setFilterFavorite(false)
      setActiveFavoriteCollectionId(null)
      if (filters.favoriteOnly) setFilters({ ...filters, favoriteOnly: undefined })
      return
    }
    // 进入收藏夹概览
    setFilterFavorite(true)
    setActiveFavoriteCollectionId(null)
  }

  return (
    <div className="flex items-center gap-2">
      {filterFavorite && activeFavoriteCollectionId && (
        <Badge tone="neutral">
          <button
            type="button"
            className="flex items-center gap-1.5"
            aria-label="返回收藏夹概览"
            title="返回收藏夹概览"
            onClick={() => setActiveFavoriteCollectionId(null)}
          >
            <ArrowLeftIcon size={13} />
          </button>
        </Badge>
      )}
      <Badge tone={filterFavorite ? 'info' : 'neutral'}>
        <button
          type="button"
          className="flex items-center gap-1.5"
          aria-label={filterFavorite ? '退出收藏夹' : '收藏夹'}
          aria-pressed={filterFavorite}
          data-testid="asset-favorite-toggle"
          title={filterFavorite ? '退出收藏夹' : '收藏夹'}
          onClick={handleClick}
        >
          <StarIcon size={13} fill={filterFavorite ? 'currentColor' : 'none'} />
          {filterFavorite ? '退出收藏夹' : '收藏夹'}
        </button>
      </Badge>
    </div>
  )
}

/**
 * 「产出目标」入口：一批素材要产出到哪些方向（可跨产品多选）。
 *
 * 与「跑后处理」不同，它**常驻**：改的是长期生效的配置（点「记住配置」后每次**手动跑**都按它产出），
 * 用户会在没选素材的时候来改它，所以不跟选中状态走。自动后处理不读它，仍按图片归属方向产出。
 *
 * 按钮上带已记住的数量：「按图片归属产出」和「按记住的 3 个方向产出」在跑之前完全看不出区别，
 * 结果却差好几倍的文件数 —— 这个数字就是跑之前唯一的可见状态。
 */
function PostprocessTargetsEntryButton() {
  const scope = useAssetLibraryStore((s) => s.scope)
  const collections = useAssetLibraryStore((s) => s.collections)
  const savedTargetCollectionIds = usePostprocessMediaStore((s) => s.savedTargetCollectionIds)
  const savedTargetsByFolder = usePostprocessMediaStore((s) => s.savedTargetsByFolder)
  const selectedAssetCount = useAssetLibraryStore((s) => s.selectedAssetIds.length)
  const [open, setOpen] = useState(false)

  const scopeFolderId = typeof scope === 'object' && scope.kind === 'collection' ? scope.id : null

  /**
   * 数字 = **当前范围生效的那一份**有几个方向（不再是一个全库共用的数）。
   *
   * 取用与执行体共用 `resolveEffectiveSavedTargets`：这里独立算一遍的话，会出现
   * 「按钮写着 3 个、跑起来只产出到 1 个」—— 而这个偏差只能靠产出结果发现。
   * 说「当前范围」而不是「当前文件夹」：停在「全部素材 / 收藏」这类地方时它算的是兜底那一份。
   */
  const savedCount = useMemo(
    () =>
      scopeFolderId
        ? resolveEffectiveSavedTargets({ savedTargetsByFolder }, scopeFolderId, collections).ids.length
        : savedTargetCollectionIds.length,
    [scopeFolderId, savedTargetsByFolder, collections, savedTargetCollectionIds],
  )

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        data-testid="asset-postprocess-targets"
        title={
          savedCount > 0
            ? `当前范围已记住 ${savedCount} 个产出方向：从这里手动跑后处理按它产出，点这里改`
            : '选择手动跑后处理要产出到哪些方向（跨产品线可选），选完点「记住配置」，存在当前所在的文件夹上'
        }
        onClick={() => setOpen(true)}
      >
        {savedCount > 0 ? `产出目标 (${savedCount})` : '产出目标'}
      </Button>
      {open && <PostprocessTargetsDialog onClose={() => setOpen(false)} assetCount={selectedAssetCount} />}
    </>
  )
}

/**
 * 「跑后处理」：对选中的**已有素材**补跑一次后处理。
 *
 * 自动触发只发生在生成完成那一刻，历史素材与当时还没启用后处理的老图再也拿不到变体，
 * 这里补的就是这条路径（旧「后期处理工作台」的批量导出覆盖的场景）。
 *
 * 只在有选中时出现：空选中时点它无从判断该处理什么。
 *
 * 必须显示加载态：一次后处理要读图、逐渠道渲染并做体积二分压缩，几十秒内界面不会有
 * 任何其他变化 —— 没有加载态时，「跑到第几张」与「按钮没生效」在用户眼里完全一样。
 *
 * **但进度数字不归它**（2026-09-21 报障）：它和右侧常驻的「后处理」状态入口曾同时铺完整的
 * 进度文本（含几十个字符的写盘文件名），两段加起来把整条工具栏占满。现在分工固定：
 * 这个按钮只说「我点的这次在跑」，进度由状态入口给紧凑计数、详情归点开的面板。
 */
function ManualPostprocessButton() {
  const selectedAssetIds = useAssetLibraryStore((s) => s.selectedAssetIds)
  const assetsById = useAssetLibraryStore((s) => s.assetsById)
  const collections = useAssetLibraryStore((s) => s.collections)
  const showToast = useStore((state) => state.showToast)
  const savedTargetCollectionIds = usePostprocessMediaStore((s) => s.savedTargetCollectionIds)
  const savedTargetsByFolder = usePostprocessMediaStore((s) => s.savedTargetsByFolder)
  const selectedCollectionIds = usePostprocessMediaStore((s) => s.selectedCollectionIds)

  /**
   * 这次点击会产出到哪些方向。
   *
   * 用的是编排层**同一份口径**（`directionTargets.ts` 的唯一实现）—— 在这里另写一遍判定的后果是
   * 「按钮让点、点下去被跳过」，而界面上看不出为什么。
   */
  const targetDirectionIds = useMemo(
    () =>
      collectTargetDirectionIdsFromOwnership(
        selectedAssetIds.map((assetId) => {
          const asset = assetsById[assetId]
          return asset ? pickDeepestCollectionId(collections, asset.collectionIds) : null
        }),
        'manual',
        { savedTargetCollectionIds, savedTargetsByFolder, selectedCollectionIds },
        // 产出目标按文件夹存，判定要沿归属方向向上找 —— 漏传这棵树会让「在产品层设的那份」失效
        collections,
      ),
    [selectedAssetIds, assetsById, collections, savedTargetCollectionIds, savedTargetsByFolder, selectedCollectionIds],
  )
  /**
   * **按方向判加载态**（2026-09-23 改）：原先看的是「有没有后处理在跑」这个全局事实，
   * 而按钮的 `loading` 直接等于 `disabled`（见 `design-system/components.tsx`）—— 所以任一方向在跑，
   * 整个素材库的按钮都点不动，别的方向根本开不了工（杰哥报障「该功能就被整体占用」）。
   * 现在只看本次选中素材会产出到的那几个方向：别的方向在跑与我无关。
   */
  const running = useAnyDirectionPostprocessBusy(targetDirectionIds)

  if (selectedAssetIds.length === 0) return null

  const handleClick = () => {
    // 选中的是素材记录，后处理要的是图片 id；素材已被清理的（imageId 缺失）单独提示，
    // 不能默默少跑几张——用户看到的是「选了 5 张，产出 3 张」这种对不上的结果。
    const imageIds: string[] = []
    let missing = 0
    for (const assetId of selectedAssetIds) {
      const asset = assetsById[assetId]
      if (asset?.imageId) imageIds.push(asset.imageId)
      else missing += 1
    }
    if (missing > 0) showToast(`${missing} 张素材的图片数据已不存在，已跳过`, 'error')
    void runManualPostprocess(imageIds)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={running}
      data-testid="asset-manual-postprocess"
      title={
        running
          ? '这批素材所在的某个方向正在跑后处理：进度看右侧「后处理」入口（点开是完整面板）。其他方向不受影响，另选素材即可继续跑'
          : '对选中素材跑一次后处理：参数与输出目录按每张图所属方向自动取值；方向之间互不阻塞，同时跑几个由设置里的「最多并发数」决定'
      }
      onClick={handleClick}
    >
      {/*
        文案**不再随运行态切换**（2026-09-23）：原先跑起来会变成「后处理中…」，而右侧常驻入口
        同时在报同一件事 —— 一屏里两句「后处理」、两个转圈，分不清哪个是入口、哪个是刚点的动作。
        运行态保留 `loading`（它同时是 disabled 的唯一表达：这批方向在跑，点了也会被并发闸挡），
        让文案只说**这个按钮要干什么**。
      */}
      {`跑后处理 (${selectedAssetIds.length})`}
    </Button>
  )
}

/**
 * 后处理状态入口（**常驻**）：进行中报进度、结束后有问题报结果、两者都没有时报「后处理记录」
 * —— 三种形态都点开同一个面板。
 *
 * 为什么要它：「跑后处理」按钮只在有选中素材时出现，而后处理既可能由生成完成自动触发、
 * 也可能在选中被清掉之后还在跑 —— 那时界面上就没有任何东西说明「它还在跑」。
 * 这个入口不依赖选中状态，是「到底有没有在跑」的常驻答复。
 *
 * ⚠️ 2026-09-23 起**真正常驻**（原先只在「在飞」或「最近一次有问题」时才出现）：没在跑、
 * 也没问题时它仍在，报「后处理记录」。不这么做的话，「上次跑完了、想回头查产到哪几个目录」
 * 这种时候界面上根本没有入口 —— 杰哥原话：「我没有在后处理时无法查看之前的记录」。
 *
 * 为什么不能只靠 toast：toast 几秒就没了，而且失败原因多到看不全（哪张图、哪个渠道、
 * 哪个目录、原始错误）。
 *
 * 为什么改成「点开面板」而不是「直接弹清单」（2026-09-21 报障）：这个入口是**状态**不是通知 ——
 * 它不会自己消失，于是「关掉清单之后按钮还在」在用户眼里就是「关不掉」。
 * 现在问题清单只在面板里按需展开；入口旁边另给一个明确的 ×（这次状态看过了，清掉），
 * 进度与历次结果也都在同一个面板里查（素材库之外也想看进度时，这就是落点）。
 */
function PostprocessStatusEntry() {
  const [open, setOpen] = useState(false)
  /**
   * 在飞的**全部**方向（不再只取第一条）。
   *
   * 2026-09-23 改：后处理按方向独立运行之后，「谁在跑」是一个集合而不是一条记录 ——
   * 只取第一条的话，三个方向在跑时界面只显示一个，另外两个像是凭空消失（而这正是
   * 「我只跑了一个方向」这类误判的来源）。排队中的也算在飞：它占着那个方向。
   */
  const runs = usePostprocessRuns()
  const latestRun = useLatestPostprocessRun()
  const dismissPostprocessRun = useRuntimeStore((s) => s.dismissPostprocessRun)

  const activeRuns = runs.filter(isRunInFlight)
  const runningCount = activeRuns.filter((run) => run.status === 'running').length
  const queuedCount = activeRuns.length - runningCount

  const { errors, skipped } = latestRun ? countPostprocessIssues(latestRun) : { errors: 0, skipped: 0 }
  // 结束后的文案：一个真错都没有时叫「跳过」而不是「问题」—— 码表里大多数是配置使然
  const idleLabel =
    latestRun && latestRun.issues.length > 0
      ? errors > 0
        ? `后处理出错 (${errors})`
        : `后处理跳过 (${skipped})`
      : null
  /**
   * 紧凑标签：一个方向时给「4/12 33%」这种可读进度，多个方向时只报**几个在跑** ——
   * 把 N 个方向的进度拼进工具栏必然超宽（这一条已经被 2026-09-21 那次报障验证过），
   * 逐步进度留给悬浮提示与点开的面板。
   */
  const activeLabel =
    activeRuns.length === 0
      ? undefined
      : activeRuns.length === 1
        ? activeRuns[0].status === 'queued'
          ? '排队中'
          : (formatPostprocessRunBadge(activeRuns[0]) ?? '后处理中')
        : `${runningCount} 个方向在跑${queuedCount > 0 ? ` · ${queuedCount} 排队` : ''}`
  /**
   * 入口文案**三态**（入口常驻之后三种都得有话说）：
   * 在跑 → 报进度；跑完 → 报结果（有真错说「出错」、零产出但没出错说「跳过」）；
   * 都没有 → 说清这里能查**历史记录**（否则一个不带状态的「后处理」按钮没人知道点开是什么）。
   */
  const entryLabel =
    activeRuns.length > 0 ? (activeLabel ? `后处理 ${activeLabel}` : '后处理中') : (idleLabel ?? '后处理记录')
  /**
   * 环：**弧长就是进度**，替掉原先塞在 children 里那个转圈图标。
   *
   * 三种取值对应三件事：
   * - 单方向在跑 → 确定进度（`getPostprocessRunPercent` 返回 undefined 表示排队中，环自动转成不定态）；
   * - 多方向在跑 → 没有单一百分比，给不定态。编一个「平均进度」是撒谎；
   * - 没在跑但跑过 → 满环 + 结果色（成功绿 / 部分完成黄 / 出错红 / 跳过与取消中性灰，
   *   与面板里的 StatusIndicator 同一套 `POSTPROCESS_RUN_STATUS_TONES`）。
   *
   * 首次进入（从没跑过）不画环：一个空环只会被读成「卡在 0%」。
   */
  const ring =
    activeRuns.length > 0 ? (
      <ProgressRing tone="info" value={activeRuns.length === 1 ? getPostprocessRunPercent(activeRuns[0]) : undefined} />
    ) : latestRun ? (
      <ProgressRing tone={POSTPROCESS_RUN_STATUS_TONES[latestRun.status]} value={100} />
    ) : undefined
  // 悬浮提示：每个方向一行（含当前写盘文件名 —— 那是被工具栏刻意压掉的详情）
  const activeTitle = activeRuns
    .map((run) => {
      const progress = formatPostprocessRunProgress(run)
      const head = `${run.directionLabel ?? '未指定方向'} · ${run.status === 'queued' ? '排队中' : POSTPROCESS_STAGE_LABELS[run.stage]}`
      return progress ? `${head} · ${progress}` : head
    })
    .join('\n')

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          // 图标走 leadingIcon：Button 的 children 会被包进一个 span，直接塞进去的 svg
          // 会被 preflight 的 `svg{display:block}` 顶到单独一行（表现就是「图标飘在文字左上」）
          leadingIcon={ring}
          // tabular-nums：数字等宽 —— 「0/100」涨到「100/100」时长宽不变，工具栏不抖
          className="tabular-nums"
          data-testid={activeRuns.length > 0 ? 'asset-postprocess-progress' : 'asset-postprocess-issues'}
          title={
            activeRuns.length > 0
              ? `${activeTitle}\n（点开看完整进度与最近记录）`
              : '看历次后处理的产出、跳过与错误：按方向长期保留、重启后仍在，每条都能直接打开产出所在位置'
          }
          onClick={() => setOpen(true)}
        >
          {entryLabel}
        </Button>
        {/* 只在跑完之后给 ×：在飞的记录要留着接进度上报，清掉会让后续上报全部落空 */}
        {activeRuns.length === 0 && latestRun && (
          <IconButton
            aria-label="清除这次后处理的状态"
            icon={<XIcon size={13} />}
            size="sm"
            data-testid="asset-postprocess-dismiss"
            onClick={() => dismissPostprocessRun(latestRun.id)}
          />
        )}
      </div>
      <PostprocessRunsDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export default memo(AssetLibraryToolbar)
