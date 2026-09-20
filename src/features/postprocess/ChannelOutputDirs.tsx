/**
 * 按渠道设置导出位置（后处理设置 → 输出位置；中控台「输出位置」分区）。
 *
 * ## 为什么是表格
 *
 * 「渠道 × 位置」天然是**行列**：4 个渠道、每个 1~2 个位置。摆成表格后
 * **列边界自动对齐**（所有行共用同一个 `grid-template-columns`），
 * 表头一次说清每列是什么，用户扫一眼就能比「百度存哪、头条存哪」。
 *
 * 反面教材（2026-09-20 截图报障）：原先每个渠道是一个 flex 行
 * 「渠道名 + 输入框 + 图标 + 再加一个 + 恢复继承」，行内元素宽度按内容算 ——
 * 输入框被挤到 ~150px，中文共享盘路径只剩 `\192.168.202.:`，
 * **用户根本没法核对**。表格的列宽是**算出来的**，不是内容挤出来的。
 *
 * 一个渠道可以给 **1~2 个**位置：给两个就是**双写**——同一份产物在两个位置各存一份，
 * 文件名相同（典型用法是「本地留档 + 共享盘交付」）。
 *
 * 两个入口共用本组件而不是各写一遍：全局层（`mediaOutputDirs`）与项目节点层
 * （`byMedia[m].outputDirs`）的交互必须一模一样，否则「全局能配两个、节点只能配一个」
 * 这种差异会让 `byMedia` 一覆盖就把双写吃掉。
 *
 * 与「默认输出目录」的关系：留空 = 用默认输出位置（或继承上级），所以**默认位置永远在**，
 * 渠道配置只做覆盖，不会把没配过默认位置的用户推进死胡同。
 */

import { useState, type ReactNode } from 'react'
import { Button, IconButton, Inline, Stack, TextField } from '../../design-system'
import { FolderOpenIcon, XIcon } from '../../design-system/icons'
import { MAX_POSTPROCESS_OUTPUT_DIRS, normalizeOutputDirList, type PostprocessMedia } from '../../lib/postprocessMedia'

interface Props {
  media: PostprocessMedia[]
  /** 读某渠道**本级已配**的位置（1~2 个）；空数组 = 本级没配，用继承值 */
  resolveDirs: (mediaId: string) => string[]
  /** 占位提示：本级留空时会落到哪个位置（继承链解析结果，调用方给） */
  resolveInheritedHint: (mediaId: string) => string
  /** 写某渠道第 `index` 个位置；传空串 = 清掉该槽 */
  onChangeDir: (mediaId: string, index: number, outputDir: string) => void
  /** 清空某渠道的全部位置，回到继承（项目节点）或默认位置（全局） */
  onClearDirs: (mediaId: string) => void
  onPickError: () => void
  /** 收起态（少数场景渠道与默认位置一致，不需要逐条看） */
  collapsible?: boolean
  /** 清空按钮的文案：全局是「用默认」、节点是「恢复继承」 */
  clearLabel?: string
  description?: ReactNode
}

/**
 * 列模板。**表头与所有数据行共用同一个值**，列边界因此严格对齐。
 *
 * - 渠道 4.5rem：3 个汉字（「广点通」）在 12px 下约 36px，留出余量；
 * - 位置列用 `minmax(0, 1fr)`：把剩余宽度**平分**给输入框，而不是按内容撑宽。
 *   `minmax(0, …)` 是必须的 —— 少了它，输入框里的长路径会把列顶开（grid 默认最小尺寸是 auto）；
 * - 操作 9.5rem：最多两个 `sm` 按钮（再加一个 / 恢复继承）并排。
 *
 * 「双写位置」列**只在真有双写时才出现**：默认 3 列能让「导出位置」拿到全部剩余宽度，
 * 中文共享盘路径才显示得全（这一步是实测逼出来的，不是审美选择）。
 */
const COLUMNS_WITH_SECOND = '4.5rem minmax(0, 1.4fr) minmax(0, 1fr) 9.5rem'
const COLUMNS_SINGLE = '4.5rem minmax(0, 1fr) 9.5rem'

const ROW_CLASS = 'border-b border-ds-border last:border-b-0'
const HEAD_CLASS = 'bg-ds-surface-subtle px-3 py-2 text-xs font-medium text-ds-muted'
const CELL_CLASS = 'min-w-0 px-3 py-2'

export default function ChannelOutputDirs({
  media,
  resolveDirs,
  resolveInheritedHint,
  onChangeDir,
  onClearDirs,
  onPickError,
  collapsible = false,
  clearLabel = '用默认',
  description,
}: Props) {
  /** 已点开「再加一个」但还没填第二个位置的渠道（纯 UI 态，不落盘） */
  const [secondOpen, setSecondOpen] = useState<string[]>([])
  const [open, setOpen] = useState(!collapsible)

  const closeSecond = (mediaId: string) => setSecondOpen((current) => current.filter((id) => id !== mediaId))

  const pickDirectory = async (mediaId: string, index: number) => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) onChangeDir(mediaId, index, path)
    } catch {
      onPickError()
    }
  }

  const configuredNames = media.filter((item) => resolveDirs(item.id).length > 0).map((item) => item.name)

  const rows = media.map((item) => {
    const dirs = normalizeOutputDirList(resolveDirs(item.id))
    // 第二个位置有两种来源：已经配过（`dirs.length > 1`）或刚点了「再加一个」
    const showSecond = dirs.length > 1 || secondOpen.includes(item.id)
    return { item, dirs, showSecond, inherited: resolveInheritedHint(item.id) }
  })

  /** 只要有一个渠道要显示第二个位置，整张表就带「双写位置」列 —— 列必须整表统一，否则对不齐 */
  const withSecondColumn = rows.some((row) => row.showSecond)
  const columns = withSecondColumn ? COLUMNS_WITH_SECOND : COLUMNS_SINGLE

  const table =
    media.length === 0 ? (
      <p className="text-xs text-ds-muted">媒体表为空，没有可单独设置的渠道。</p>
    ) : (
      <div
        role="table"
        aria-label="按渠道设置导出位置"
        className="overflow-hidden rounded-ds-md border border-ds-border"
      >
        <div
          role="row"
          className={`grid items-center ${ROW_CLASS} ${HEAD_CLASS}`}
          style={{ gridTemplateColumns: columns }}
        >
          <span role="columnheader">渠道</span>
          <span role="columnheader">导出位置</span>
          {withSecondColumn && <span role="columnheader">双写位置</span>}
          <span role="columnheader">操作</span>
        </div>

        {rows.map(({ item, dirs, showSecond, inherited }) => {
          const canAddSecond = dirs.length > 0 && dirs.length < MAX_POSTPROCESS_OUTPUT_DIRS && !showSecond
          return (
            <div
              key={item.id}
              role="row"
              className={`grid items-center ${ROW_CLASS}`}
              style={{ gridTemplateColumns: columns }}
            >
              <span role="cell" className={`${CELL_CLASS} truncate text-xs text-ds-text`} title={item.name}>
                {item.name}
              </span>

              <span role="cell" className={CELL_CLASS}>
                <Inline gap={2} wrap={false}>
                  <TextField
                    label=""
                    aria-label={`${item.name} 的导出位置`}
                    // ⚠️ 撑开宽度必须写 `containerClassName`：`className` 落到内层 `<input>` 上，
                    // 外层 `.ds-field` 是 `display:grid`，写错位置输入框就按内容宽度定死、右侧留一大片空。
                    containerClassName="min-w-0 flex-1"
                    data-testid={`channel-output-dir-${item.id}-0`}
                    value={dirs[0] ?? ''}
                    placeholder={inherited ? `留空则 ${inherited}` : '留空则继承'}
                    onChange={(event) => onChangeDir(item.id, 0, event.target.value)}
                  />
                  <IconButton
                    size="sm"
                    aria-label={`选择 ${item.name} 的导出位置`}
                    title="选择导出位置"
                    icon={<FolderOpenIcon className="h-3.5 w-3.5" />}
                    onClick={() => void pickDirectory(item.id, 0)}
                  />
                </Inline>
              </span>

              {withSecondColumn && (
                <span role="cell" className={CELL_CLASS}>
                  {showSecond ? (
                    <Inline gap={2} wrap={false}>
                      <TextField
                        label=""
                        aria-label={`${item.name} 的第二个导出位置`}
                        containerClassName="min-w-0 flex-1"
                        data-testid={`channel-output-dir-${item.id}-1`}
                        value={dirs[1] ?? ''}
                        placeholder="同一份产物再存一份"
                        onChange={(event) => onChangeDir(item.id, 1, event.target.value)}
                      />
                      <IconButton
                        size="sm"
                        aria-label={`选择 ${item.name} 第二个导出位置`}
                        title="选择第二个导出位置"
                        icon={<FolderOpenIcon className="h-3.5 w-3.5" />}
                        onClick={() => void pickDirectory(item.id, 1)}
                      />
                      <IconButton
                        size="sm"
                        aria-label={`取消 ${item.name} 的第二个导出位置`}
                        title="取消第二个位置"
                        icon={<XIcon className="h-3.5 w-3.5" />}
                        onClick={() => {
                          onChangeDir(item.id, 1, '')
                          closeSecond(item.id)
                        }}
                      />
                    </Inline>
                  ) : (
                    <span className="text-xs text-ds-muted">—</span>
                  )}
                </span>
              )}

              <span role="cell" className={CELL_CLASS}>
                <Inline gap={1} wrap={false}>
                  {canAddSecond && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`channel-output-add-${item.id}`}
                      title="再加一个位置：同一份产物也会写到这里（双写）"
                      onClick={() => setSecondOpen((current) => [...current, item.id])}
                    >
                      再加一个
                    </Button>
                  )}
                  {dirs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="清空后这个渠道回到上级/默认的输出位置"
                      onClick={() => {
                        onClearDirs(item.id)
                        closeSecond(item.id)
                      }}
                    >
                      {clearLabel}
                    </Button>
                  )}
                </Inline>
              </span>
            </div>
          )
        })}
      </div>
    )

  if (!collapsible) {
    return (
      <Stack gap={2}>
        {/* 说明只留必要的：表头已经写清「导出位置 / 双写位置」，这里不再复述一遍 */}
        <Stack gap={1}>
          <span className="text-xs font-medium text-ds-text">按渠道</span>
          {description && <span className="text-xs text-ds-muted">{description}</span>}
        </Stack>
        {table}
      </Stack>
    )
  }

  return (
    <Stack gap={2}>
      <Inline gap={2}>
        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? '收起按渠道设置' : '按渠道分别设置'}
        </Button>
        {!open && configuredNames.length > 0 && (
          <span className="text-xs text-ds-accent">{configuredNames.join('、')} 已单独设置</span>
        )}
      </Inline>
      {open && table}
    </Stack>
  )
}
