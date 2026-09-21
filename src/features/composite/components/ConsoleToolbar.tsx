/**
 * 中控台 · 右区工具栏。
 *
 * 形态复刻「灵境 · 策略中心」的两行工具栏：
 *
 * ```
 * [按发布状态 ▾] [按配置完整性 ▾] [搜索当前策略] [每行数量 ─●──] [▦] [☰]
 * [全选当前] [取消选择] [批量挪动] [批量复制] [批量删除] [一键发布]
 * ```
 *
 * 糖包的对应物：
 *
 * - **配置维度不在这里**（2026-09-21 改版，见 `controlConsoleSections.ts` 头注）：
 *   它挪到左树的一级节点，与作用域合成「点一次定落点」。工具栏从此只管**当前维度内部**
 *   的筛选与批量，不再承担「切维度」这种换页性质的职责 —— 一个控件只做一件事。
 * - 归属范围（全部 / 已绑定 / 未绑定）+ 搜索 + 每行数量 + 网格/列表：只在预设卡片形态下有意义；
 * - 批量行：全选当前 / 取消选择 / 批量启用 / 批量停用 / 批量复制 / 批量删除。
 *   灵境的「批量挪动」「一键发布」在糖包没有对应动作（预设不移动、不发布），
 *   所以**不做** —— 放一个点了没反应的按钮比不放更糟。
 *
 * 批量操作在没选中任何卡片时 `disabled`（与灵境一致），避免「点了没反应」的困惑。
 */

import { Button, SearchField, SegmentedControl, SelectField, Slider } from '../../../design-system'
import { CollectionManageIcon, Grid2X2Icon } from '../../../design-system/icons'

/** 卡片归属筛选。只在「水印」维度下有内容可筛。 */
export type ConsoleBindingFilter = 'all' | 'bound' | 'unbound'
export type ConsoleViewMode = 'grid' | 'list'

interface Props {
  /**
   * 当前维度是否是「预设卡片」形态（水印）。其余维度是表格或表单，
   * 归属筛选 / 搜索 / 每行数量 / 视图切换 / 批量操作都无对象，整组隐藏。
   */
  presetCardMode: boolean
  bindingFilter: ConsoleBindingFilter
  onBindingFilterChange: (filter: ConsoleBindingFilter) => void
  query: string
  onQueryChange: (query: string) => void
  perRow: number
  onPerRowChange: (perRow: number) => void
  view: ConsoleViewMode
  onViewChange: (view: ConsoleViewMode) => void
  /** 当前筛选后可见的卡片数（「全选当前」的范围） */
  visibleCount: number
  selectedCount: number
  onSelectAll: () => void
  onClearSelection: () => void
  /**
   * 批量启用 / 停用选中的水印。
   *
   * 只在**选中某个方向**时可用：糖包的模型是「方向自带一整套参数，生成图直接调用」，
   * 所以「启用这套水印」本质是改该方向的 `watermarkPresetIds`。
   * 全局默认下没有「启用」这个概念（基线是各方向的默认值，不是某次生成用的清单），
   * 因此按钮置灰并说明原因，而不是给一个点了没反应的控件。
   */
  canToggleEnabled: boolean
  onEnableSelected: () => void
  onDisableSelected: () => void
  onDuplicateSelected: () => void
  onDeleteSelected: () => void
}

const BINDING_OPTIONS = [
  { value: 'all', label: '全部预设' },
  { value: 'bound', label: '已绑定' },
  { value: 'unbound', label: '未绑定' },
]

const VIEW_OPTIONS = [
  { value: 'grid' as const, label: <Grid2X2Icon className="h-3.5 w-3.5" /> },
  { value: 'list' as const, label: <CollectionManageIcon className="h-3.5 w-3.5" /> },
]

export function ConsoleToolbar({
  presetCardMode,
  bindingFilter,
  onBindingFilterChange,
  query,
  onQueryChange,
  perRow,
  onPerRowChange,
  view,
  onViewChange,
  visibleCount,
  selectedCount,
  onSelectAll,
  onClearSelection,
  canToggleEnabled,
  onEnableSelected,
  onDisableSelected,
  onDuplicateSelected,
  onDeleteSelected,
}: Props) {
  const hasSelection = selectedCount > 0

  if (!presetCardMode) return null

  return (
    <div className="shrink-0 space-y-2 border-b border-ds-border px-4 py-2.5 dark:border-ds-border">
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          label="归属范围"
          aria-label="归属范围"
          containerClassName="min-w-32"
          value={bindingFilter}
          options={BINDING_OPTIONS}
          onChange={(event) => onBindingFilterChange(event.target.value as ConsoleBindingFilter)}
        />
        <SearchField
          label="搜索预设"
          placeholder="搜索预设"
          size="sm"
          value={query}
          onChange={onQueryChange}
          className="min-w-40 flex-1"
        />
        <Slider
          label="每行数量"
          aria-label="每行预设数量"
          min={2}
          max={6}
          step={1}
          value={perRow}
          valueDisplay={perRow}
          onChange={onPerRowChange}
        />
        <SegmentedControl
          aria-label="切换卡片视图"
          size="sm"
          value={view}
          options={VIEW_OPTIONS}
          onValueChange={onViewChange}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onSelectAll} disabled={visibleCount === 0}>
          全选当前
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection} disabled={!hasSelection}>
          取消选择
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEnableSelected}
          disabled={!hasSelection || !canToggleEnabled}
          title={canToggleEnabled ? undefined : '「启用」是方向级的设置，请先在左侧选一个方向'}
        >
          批量启用
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDisableSelected}
          disabled={!hasSelection || !canToggleEnabled}
          title={canToggleEnabled ? undefined : '「停用」是方向级的设置，请先在左侧选一个方向'}
        >
          批量停用
        </Button>
        <Button variant="ghost" size="sm" onClick={onDuplicateSelected} disabled={!hasSelection}>
          批量复制
        </Button>
        <Button variant="ghost" size="sm" onClick={onDeleteSelected} disabled={!hasSelection}>
          批量删除
        </Button>
        {selectedCount > 0 && <span className="text-xs text-ds-muted dark:text-ds-muted">已选 {selectedCount} 个</span>}
      </div>
    </div>
  )
}
