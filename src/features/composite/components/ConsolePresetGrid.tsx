/**
 * 中控台 · 水印卡片网格。
 *
 * 复刻「灵境 · 策略中心」的资产网格：卡片按「每行数量」排布，可切网格 / 列表两种视图。
 *
 * 作用域决定卡片的语义（同一个「方向自带一整套参数」模型的两个视角）：
 * - **全局默认**：网格是水印库总览，徽章显示「N 个方向在用」；
 * - **选中某个方向**：网格是该方向的**水印参数**——徽章显示「已启用 / 未启用」，
 *   卡上可直接开关（`onToggleEnabled`），这就是生成图片时会直接调用的那份清单。
 */

import { EmptyState } from '../../../design-system'
import { ImageIcon } from '../../../design-system/icons'
import { ConsolePresetCard } from './ConsolePresetCard'
import type { CompositeV2Preset } from '../lib/compositeV2Types'
import type { ConsoleViewMode } from './ConsoleToolbar'

interface Props {
  presets: CompositeV2Preset[]
  /** 每行数量（2~6），来自工具栏滑块 */
  perRow: number
  view: ConsoleViewMode
  /** 处于方向作用域：卡片上给「启用 / 停用」开关 */
  inNodeScope: boolean
  /** 该预设的生效状态：方向作用域下 = 是否被该方向启用 */
  isEnabled: (presetId: string) => boolean
  /** 有几个方向在用这套水印（全局视角的徽章文案用） */
  usedByCount: (presetId: string) => number
  selectedIds: string[]
  onToggleSelect: (presetId: string) => void
  onToggleEnabled: (presetId: string) => void
  onEdit: (presetId: string) => void
  onDuplicate: (presetId: string) => void
  onDelete: (presetId: string) => void
  /** 无卡片时的说明（区分「库里就没有」与「被筛选筛掉了」） */
  emptyHint: string
}

export function ConsolePresetGrid({
  presets,
  perRow,
  view,
  inNodeScope,
  isEnabled,
  usedByCount,
  selectedIds,
  onToggleSelect,
  onToggleEnabled,
  onEdit,
  onDuplicate,
  onDelete,
  emptyHint,
}: Props) {
  if (presets.length === 0) {
    return <EmptyState icon={<ImageIcon className="h-5 w-5" />} title="没有可展示的预设" description={emptyHint} />
  }

  return (
    <div
      data-layout="console-preset-grid"
      data-view={view}
      className={view === 'grid' ? 'grid gap-3' : 'flex flex-col gap-2'}
      // 每行数量用内联样式：Tailwind 无法为运行时变量生成 `grid-cols-N` 类名
      style={view === 'grid' ? { gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` } : undefined}
    >
      {presets.map((preset) => {
        const enabled = isEnabled(preset.id)
        const used = usedByCount(preset.id)
        return (
          <ConsolePresetCard
            key={preset.id}
            preset={preset}
            inNodeScope={inNodeScope}
            enabled={enabled}
            usage={
              inNodeScope
                ? enabled
                  ? { label: '已启用', tone: 'success' as const }
                  : { label: '未启用', tone: 'neutral' as const }
                : used > 0
                  ? { label: `${used} 个方向在用`, tone: 'success' as const }
                  : { label: '未使用', tone: 'warning' as const }
            }
            selected={selectedIds.includes(preset.id)}
            onToggleSelect={() => onToggleSelect(preset.id)}
            onToggleEnabled={() => onToggleEnabled(preset.id)}
            onEdit={() => onEdit(preset.id)}
            onDuplicate={() => onDuplicate(preset.id)}
            onDelete={() => onDelete(preset.id)}
          />
        )
      })}
    </div>
  )
}
