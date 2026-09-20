/**
 * 中控台 · 水印预设卡片。
 *
 * 形态复刻「灵境 · 策略中心」的资产卡片：
 * 封面（真实画布预览）+ 状态徽章 + 名称 + 编号 + 说明 + 归属统计 + 悬停操作条。
 * 灵境的封面支持多张切换（策略有多版图），糖包一个预设只有一张画布 ⇒ 单张，
 * 不做假的多图 tab。
 *
 * **封面是真实渲染**，不是占位图：走 `renderCompositeV2ToCanvas`，与产出链路同一个渲染器，
 * 保证「卡片上看到的」与「产出时的」一致。渲染失败（无 canvas / 预设坏了）时退化为
 * 尺寸占位块，卡片其余信息照常可用 —— 一张卡片渲染失败不该让整片网格空白。
 *
 * ⚠️ 卡上**不做重命名**：名称的唯一编辑入口在水印分区的库里，
 * 卡上再给一个就是第二个入口（同一参数两个入口必出「改了一处另一处不更新」）。
 */

import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Checkbox, Menu, MenuItem, MenuSeparator, Popover } from '../../../design-system'
import { CopyIcon, MoreHorizontalIcon, PencilIcon, PlayIcon, TrashIcon } from '../../../design-system/icons'
import { renderCompositeV2ToCanvas } from '../lib/compositeRendererV2'
import type { CompositeV2Preset } from '../lib/compositeV2Types'

interface Props {
  preset: CompositeV2Preset
  /**
   * 卡片右上角的使用状态。
   *
   * 两种作用域下语义不同（同一个「方向自带参数」模型的两个视角）：
   * - 全局默认：`N 个方向在用` / `未使用`——回答「这套水印有哪些方向在用」；
   * - 选中某个方向：`已启用` / `未启用`——回答「这个方向用不用这套」，且可直接切换。
   */
  usage: { label: string; tone: 'success' | 'warning' | 'neutral' }
  /** 处于方向作用域：卡上给出「启用 / 停用」开关（方向的水印参数就地改） */
  inNodeScope: boolean
  enabled: boolean
  onToggleEnabled: () => void
  selected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/** 封面最长边像素。卡面尺寸下再大也看不出差别，纯属白烧渲染时间。 */
const COVER_MAX_EDGE = 320

/** 按基准画布等比缩到封面尺寸（保持比例，避免卡片高矮不一） */
function coverTarget(baseCanvas: { width: number; height: number }) {
  const width = Math.max(1, baseCanvas.width || 1)
  const height = Math.max(1, baseCanvas.height || 1)
  const scale = COVER_MAX_EDGE / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function formatUpdatedAt(value: number) {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 预设画布的实时预览。渲染失败时退化为尺寸占位块。 */
function PresetCover({ preset }: { preset: CompositeV2Preset }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  const target = coverTarget(preset.baseCanvas)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let stale = false
    setFailed(false)
    // 尺寸在 effect 内算：只依赖 preset，避免把派生对象塞进依赖数组（每次都新引用 ⇒ 每帧重渲染）
    const size = coverTarget(preset.baseCanvas)
    void renderCompositeV2ToCanvas({ preset, targetSize: size, fitMode: 'crop-fill' }, canvas, {
      isStale: () => stale,
    }).catch(() => {
      // 单张渲染失败不改整片网格，只退化为占位块
      if (!stale) setFailed(true)
    })
    return () => {
      stale = true
    }
    // 预设内容变化（改图层/改画布）要重绘，所以依赖整个 preset 引用
  }, [preset])

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ds-surface-subtle dark:bg-ds-surface-subtle">
        <span className="font-mono text-xs text-ds-muted dark:text-ds-muted">
          {preset.baseCanvas.width} × {preset.baseCanvas.height}
        </span>
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label={`${preset.name} 封面`}
      className="h-full w-full object-contain"
      width={target.width}
      height={target.height}
    />
  )
}

export function ConsolePresetCard({
  preset,
  usage,
  inNodeScope,
  enabled,
  onToggleEnabled,
  selected,
  onToggleSelect,
  onEdit,
  onDuplicate,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <article
      data-layout="console-preset-card"
      className={`group relative flex flex-col overflow-hidden rounded-ds-lg border bg-ds-surface dark:bg-ds-scrim ${
        selected ? 'border-ds-accent dark:border-ds-accent' : 'border-ds-border dark:border-ds-border'
      }`}
    >
      <div className="relative shrink-0 bg-ds-surface-subtle dark:bg-ds-surface-subtle">
        <div className="flex h-40 items-center justify-center overflow-hidden">
          <button
            type="button"
            className="h-full w-full cursor-pointer"
            onClick={onEdit}
            aria-label={`打开 ${preset.name}`}
          >
            <PresetCover preset={preset} />
          </button>
        </div>

        {/* 状态徽章：灵境是「草稿 / 已发布」；糖包按作用域分别是「N 个方向在用」「已启用」 */}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1">
          <Badge tone={usage.tone}>{usage.label}</Badge>
        </div>

        <div className="absolute right-2 top-2 rounded-ds-lg bg-ds-surface px-1 dark:bg-ds-scrim">
          <Checkbox checked={selected} onChange={onToggleSelect} aria-label={`选择 ${preset.name}`} />
        </div>

        {/* 悬停操作条：落在封面下沿，不占卡片固定高度（灵境同样形态） */}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-ds-scrim px-1.5 py-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          {/* 方向作用域下，「启用 / 停用」就摆在最前面 —— 这是最常做的动作（生成图直接调用这套参数） */}
          {inNodeScope && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleEnabled}
              aria-label={`${enabled ? '停用' : '启用'} ${preset.name}`}
            >
              {enabled ? '停用' : '启用'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`编辑画布 ${preset.name}`}>
            <PencilIcon className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`预览 ${preset.name}`}>
            <PlayIcon className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDuplicate} aria-label={`复制 ${preset.name}`}>
            <CopyIcon className="h-3.5 w-3.5" />
          </Button>
          <div className="ml-auto flex items-center">
            <button
              type="button"
              aria-label={`${preset.name} 更多操作`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
              className="cursor-pointer rounded-ds-lg p-1 text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:text-ds-muted dark:hover:bg-ds-subtle"
            >
              <MoreHorizontalIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`删除 ${preset.name}`}
              onClick={onDelete}
              className="cursor-pointer rounded-ds-lg p-1 text-ds-muted hover:bg-ds-subtle hover:text-ds-danger dark:text-ds-muted dark:hover:bg-ds-subtle"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <Popover
                label={`${preset.name} 的操作菜单`}
                arrow={false}
                className="!absolute bottom-full right-0 z-dropdown mb-1 w-36 !p-1"
              >
                <Menu label={`${preset.name} 的操作`} className="!border-0 !bg-transparent !p-0">
                  <MenuItem icon={<CopyIcon className="h-3.5 w-3.5" />} onClick={onDuplicate}>
                    复制预设
                  </MenuItem>
                  <MenuItem icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={onEdit}>
                    在库里打开
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem tone="danger" icon={<TrashIcon className="h-3.5 w-3.5" />} onClick={onDelete}>
                    删除预设
                  </MenuItem>
                </Menu>
              </Popover>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-0.5 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ds-text dark:text-ds-text">{preset.name}</span>
        </div>
        <span className="font-mono text-xs text-ds-muted dark:text-ds-muted">预设-{preset.id.slice(-4)}</span>
        <span className="truncate text-xs text-ds-muted dark:text-ds-muted">
          画布 {preset.baseCanvas.width} × {preset.baseCanvas.height} · {preset.layers.length} 图层
        </span>
        <span className="truncate text-xs text-ds-muted dark:text-ds-muted">
          更新 {formatUpdatedAt(preset.updatedAt)}
        </span>
      </div>
    </article>
  )
}
