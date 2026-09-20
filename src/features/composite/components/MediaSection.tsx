/**
 * 中控台 · 「渠道与尺寸」分区。
 *
 * 复刻「灵境 · 资产中心」里那套**渠道分组 + 组内尺寸卡片 + 分组头计数徽章**：
 *
 * ```
 * ▸ 广点通                    2 / 2 已应用
 *    [广点通 1280 x 720]  横版   1280 x 720 · ≤ 399 KB
 *    [广点通 1080 x 1920] 竖版   1080 x 1920 · ≤ 399 KB
 * ▸ 百度                      0 / 3 已应用
 * ```
 *
 * 三个刻意的设计点（都是照资产中心抄的）：
 * 1. **分组头带 `N / M 已应用` 徽章** —— 不必展开就知道这个渠道配了几个尺寸，
 *    原先是「要展开折叠区才知道」。
 * 2. **尺寸卡片自带三要素**：`渠道 + 宽高` / `横竖标签` / `体积上限`。
 *    横竖由宽高**推导**（`resolveOutputDirection`），不作为独立字段存——
 *    存了就会与宽高不一致。
 * 3. **状态二元**：启用 / 未启用，一眼可辨。
 *
 * 规格的新增 / 改名 / 删除 / 尺寸增删复用 `MediaTableManager`（那批 CRUD action 的既有
 * 唯一 UI 入口），放在下段折叠区里，不另写一套编辑器。
 *
 * ⚠️ **这个分区目前也是纯全局的，不挂作用域选择器。**
 * 「应用哪些渠道」（`selectedMediaIds`）看起来像是节点级参数，但实测类型后确认不是：
 * `PostprocessNodeOverride`（ADR-0011 收窄后）只有 `outputDir` / `watermarkPresetIds` /
 * `enabled` / `byMedia` 四个字段，`selectedMediaIds` 不在其中。
 * 节点要关掉某个渠道，走的是 `enabled: false`（整个方向不产出）——
 * 粒度比「逐渠道」粗，这是那次收窄时明确做的取舍。
 *
 * 因此这里不挂作用域选择器：给了能选节点、选了却什么都不变的控件比不给更糟。
 *
 * **2026-09-20 追加「画面方向」**：它决定「每个渠道取用哪一组尺寸」，与渠道分组是同一件事的
 * 两半。原先它挂在后处理弹窗的全局作用域里，弹窗收窄为方向级参数后搬到这里。
 * 顺带改掉了原字段说明的自相矛盾（原文写「跟随源图方向自动判定，不提供手选覆盖」，
 * 而界面上给的却是一个可手选的分段控件）。
 */

import { useMemo, useState } from 'react'
import { Badge, Button, Checkbox, EmptyState, SectionHeader, SegmentedControl } from '../../../design-system'
import { Layers3Icon } from '../../../design-system/icons'
import { DIRECTION_OPTIONS, PURE_MEDIA_ID, resolveOutputDirection } from '../../../lib/postprocessMedia'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import MediaTableManager from '../../postprocess/MediaTableManager'

const DIRECTION_LABELS = {
  landscape: '横版',
  portrait: '竖版',
  square: '方形',
} as const

export function MediaSection() {
  const media = usePostprocessMediaStore((state) => state.media)
  const selectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const toggleSelectedMedia = usePostprocessMediaStore((state) => state.toggleSelectedMedia)
  const [showSpecEditor, setShowSpecEditor] = useState(false)
  const direction = usePostprocessMediaStore((state) => state.direction)
  const setDirection = usePostprocessMediaStore((state) => state.setDirection)

  /**
   * 「已应用」= 这个渠道已经在产出范围里。纯净版是个特殊渠道（不产渠道变体，只产无水印原图），
   * 它也算一个可勾选项，但不出现在渠道分组里 — 见下方单独渲染。
   */
  const channelMedia = useMemo(() => media.filter((item) => item.id !== PURE_MEDIA_ID), [media])
  const pureMedia = useMemo(() => media.find((item) => item.id === PURE_MEDIA_ID) ?? null, [media])

  const enabledSizeCount = (sizes: Array<{ enabled: boolean }>) => sizes.filter((size) => size.enabled).length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <SectionHeader
          title="渠道与尺寸"
          description="全局共享规格：每个渠道产出哪些尺寸、体积上限多少。勾选决定这个渠道是否参与产出，画面方向决定取用哪一组尺寸。"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setShowSpecEditor((current) => !current)}>
              {showSpecEditor ? '收起规格编辑' : '编辑规格'}
            </Button>
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {/*
         * 画面方向：它决定「每个渠道取用哪一组尺寸」，与下面的渠道分组是同一件事的两半，
         * 所以放在最上面而不是另开分区。原先这个控件挂在后处理弹窗的全局作用域里
         * （2026-09-20 弹窗收窄为方向级后搬到这里）。
         * 默认「跟随尺寸」即按源图比例自动判，只有要整批强制横/竖时才需要动它。
         */}
        <section
          data-layout="console-direction"
          className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-ds-text dark:text-ds-text">画面方向</p>
              <p className="text-xs text-ds-muted dark:text-ds-muted">
                决定每个渠道取用哪一组尺寸。默认按源图比例自动判，需要整批强制横 / 竖时在这里覆盖。
              </p>
            </div>
            <div className="ml-auto shrink-0">
              <SegmentedControl
                aria-label="画面方向"
                value={direction ?? 'auto'}
                options={DIRECTION_OPTIONS}
                onValueChange={(value) => setDirection(value === 'auto' ? null : value)}
              />
            </div>
          </div>
        </section>

        {media.length === 0 && (
          <EmptyState
            icon={<Layers3Icon className="h-5 w-5" />}
            title="媒体表为空"
            description="没有可产出的渠道。请到「编辑规格」里添加渠道，或恢复内置媒体表。"
          />
        )}

        <div className="space-y-3">
          {channelMedia.map((item) => {
            const applied = selectedMediaIds.includes(item.id)
            const enabledSizes = enabledSizeCount(item.sizes)
            return (
              <section
                key={item.id}
                data-layout="console-media-group"
                className="rounded-ds-lg border border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim"
              >
                <header className="flex items-center justify-between gap-3 border-b border-ds-border px-3 py-2 dark:border-ds-border">
                  <label className="flex min-w-0 cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={applied}
                      onChange={() => toggleSelectedMedia(item.id)}
                      aria-label={`${applied ? '取消应用' : '应用'}渠道 ${item.name}`}
                    />
                    <span className="truncate text-sm font-semibold text-ds-text dark:text-ds-text">{item.name}</span>
                    {!item.enabled && <Badge tone="warning">已停用</Badge>}
                  </label>
                  {/* 计数徽章：一眼看出这个渠道配了几个尺寸，不必展开 */}
                  <Badge tone={enabledSizes > 0 ? 'success' : 'neutral'}>
                    {enabledSizes} / {item.sizes.length} 已应用
                  </Badge>
                </header>

                <div className="space-y-1 p-2">
                  {item.sizes.length === 0 && (
                    <p className="px-1 py-2 text-xs text-ds-muted dark:text-ds-muted">
                      还没有尺寸，到「编辑规格」里加一个。
                    </p>
                  )}
                  {item.sizes.map((size) => {
                    const direction = resolveOutputDirection(size.width, size.height)
                    return (
                      <div
                        key={size.id}
                        data-layout="console-size-card"
                        className={`flex items-center gap-3 rounded-ds-lg border px-2 py-1.5 ${
                          size.enabled
                            ? 'border-ds-border bg-ds-surface-subtle dark:border-ds-border dark:bg-ds-surface-subtle'
                            : 'border-ds-border/60 opacity-60 dark:border-ds-border/60'
                        }`}
                      >
                        <span className="shrink-0 rounded-ds-lg bg-ds-subtle px-1.5 py-0.5 text-xs text-ds-muted dark:bg-ds-subtle dark:text-ds-muted">
                          {item.name}
                        </span>
                        <span className="shrink-0 font-mono text-sm tabular-nums text-ds-text dark:text-ds-text">
                          {size.width} × {size.height}
                        </span>
                        <Badge tone="info">{DIRECTION_LABELS[direction]}</Badge>
                        <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">
                          {size.maxSizeKb > 0 ? `≤ ${size.maxSizeKb} KB` : '不限体积'}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-ds-muted dark:text-ds-muted">
                          {size.enabled ? '已应用' : '未启用'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        {/* 纯净版单独一栏：它不是渠道（不产渠道变体），但同样是一个可勾选的产出项，
            塞进渠道分组会让「广点通 2/2」这类计数口径变得说不清。 */}
        {pureMedia && (
          <section
            data-layout="console-pure-media"
            className="mt-3 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
          >
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={selectedMediaIds.includes(pureMedia.id)}
                onChange={() => toggleSelectedMedia(pureMedia.id)}
                aria-label={`${selectedMediaIds.includes(pureMedia.id) ? '取消应用' : '应用'}纯净版`}
              />
              <span className="text-sm font-medium text-ds-text dark:text-ds-text">{pureMedia.name}</span>
              <span className="text-xs text-ds-muted dark:text-ds-muted">不产渠道变体，只产一份无水印原图</span>
            </label>
          </section>
        )}

        {/* 规格编辑器折叠在下段：它是「改规格」的地方，与上段的「读总览 + 勾选」分开，
            避免一屏里同时出现两套可编辑控件（同一参数两个入口的观感）。 */}
        {showSpecEditor && (
          <section
            data-layout="console-spec-editor"
            className="mt-4 border-t border-ds-border pt-4 dark:border-ds-border"
          >
            <MediaTableManager />
          </section>
        )}
      </div>
    </div>
  )
}
