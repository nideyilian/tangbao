/**
 * 按渠道设置导出位置（后处理设置 → 输出位置；中控台「输出位置」分区）。
 *
 * ## 表格形态：一个渠道 1~2 行，渠道名跨行合并
 *
 * 「渠道 × 位置」天然是**行列**数据。摆成表格后列边界自动对齐，表头一次说清每列是什么，
 * 用户扫一眼就能比「百度存哪、头条存哪」。
 *
 * 一个渠道的多个位置**每行一个**（2026-09-21 改版）：渠道名在那一组里**跨行合并**，
 * 与 Excel 合并单元格同一个读法 —— 左边一个渠道名，右边连着几行就是它的几个位置。
 * 新位置加在**下一行**，不再往右边加列。
 *
 * 两次报障是同一个病：**路径列宽度**被别的元素抢走。
 * ① 2026-09-20：更早的版本每个渠道一个 flex 行「渠道名 + 输入框 + 图标 + 再加一个 + 恢复继承」，
 *    宽度按内容算 —— 输入框被挤到 ~150px，中文共享盘路径只剩 `\192.168.202.:`；
 * ② 2026-09-21：改成表格后第二个位置占**一整列**（「双写位置」），列一多，路径列照样被挤窄。
 * 行内新增不会改变列数，所以「导出位置」这一列永远拿满剩余宽度。
 *
 * ## 操作只有两个，都是逐行图标按钮
 *
 * - `✕`：删掉**这一个**位置（其余位置上移）。删到一个不剩 = 该渠道回到「留空」
 *   （全局层落到默认输出位置、节点层继续向上继承）；
 * - `+`：在这一行**下面再加一个位置**。只出现在该组最后一行，读作「往下加一行」；
 *   到了上限（`MAX_POSTPROCESS_OUTPUT_DIRS`）就不再出现。
 *
 * **刻意没有「清空」按钮**（2026-09-21 报障）：它一次抹掉该渠道已填好的全部位置，
 * 没有确认也撤不回来，误点即丢。要整条退回留空，逐行 `✕` 就行 —— 代价是多点一次，
 * 换来的是「已填的资料不会被一下抹掉」。按钮用图标而不是文字，也是因为路径列要尽量宽
 * （名字由 `aria-label` + `title` 承担，规范：图标按钮必须有可访问名称）。
 *
 * ## 表格交给设计系统的 `DataGrid`
 *
 * 它的列定义同时驱动界面编辑与将来的导入导出（`key` 就是字段协议），路径列自带「选择目录」
 * 按钮，行主键、草稿态提交、校验提示都由它兜住。手搓一套只会多出第二个形状要维护。
 * 唯一的扩展是行合并（`DataGridColumn.spanRows`，默认关，别的表不受影响）。
 *
 * 两个入口共用本组件而不是各写一遍：全局层（`mediaOutputDirs`）与项目节点层
 * （`byMedia[m].outputDirs`）的交互必须一模一样，否则「全局能配两个、节点只能配一个」
 * 这种差异会让 `byMedia` 一覆盖就把双写吃掉。
 *
 * 与「默认输出目录」的关系：留空 = 用默认输出位置（或继承上级），所以**默认位置永远在**，
 * 渠道配置只做覆盖，不会把没配过默认位置的用户推进死胡同。
 */

import { useState, type ReactNode } from 'react'
import { Button, DataGrid, IconButton, Inline, Stack } from '../../design-system'
import type { DataGridColumn } from '../../design-system'
import { CloseIcon, PlusIcon } from '../../design-system/icons'
import { MAX_POSTPROCESS_OUTPUT_DIRS, normalizeOutputDirList, type PostprocessMedia } from '../../lib/postprocessMedia'

interface Props {
  media: PostprocessMedia[]
  /** 读某渠道**本级已配**的位置（1~2 个）；空数组 = 本级没配，用继承值 */
  resolveDirs: (mediaId: string) => string[]
  /** 占位提示：本级留空时会落到哪个位置（继承链解析结果，调用方给） */
  resolveInheritedHint: (mediaId: string) => string
  /** 写某渠道第 `index` 个位置；传空串 = 清掉该位置 */
  onChangeDir: (mediaId: string, index: number, outputDir: string) => void
  /** 删掉某渠道第 `index` 个位置，其余位置上移（删到一个不剩 = 该渠道回到「留空」） */
  onRemoveDir: (mediaId: string, index: number) => void
  onPickError: () => void
  /** 收起态（少数场景渠道与默认位置一致，不需要逐条看） */
  collapsible?: boolean
  description?: ReactNode
}

/**
 * 表格行模型：一个**位置**一行。
 *
 * 列键（`outputDir`）**同时是导入导出的字段协议** —— 别随界面文案改。
 * `name` 是 `DataGrid.getRowLabel` 认的键：第一行就是渠道名，第二行起带位置号
 * （两行同名的话读屏会分不清在改哪一个）。
 */
interface ChannelDirRow {
  /** 行主键：`渠道id#槽位`。一个渠道多行，用下标做 key 会在删行时把值写到隔壁行上 */
  rowId: string
  mediaId: string
  /** 渠道名（合并格显示用，同组各行相同） */
  channelName: string
  /** 无障碍名称里的行标识（见上方注释） */
  name: string
  index: number
  outputDir: string
  /** 本行在「渠道」列跨几行：该组第一行是组内行数，其余是 0（被上面那格盖住） */
  channelSpan: number
  /** 该渠道**已配**的位置数（不含刚点出来还没填的空行） */
  dirCount: number
  /** 留空时会继承到的目录 —— 逐行不同，所以走 `placeholderForRow` */
  inherited: string
  /** 是否给「在下面再加一个位置」 */
  canAdd: boolean
  /** 是否给「删掉这个位置」 */
  canRemove: boolean
}

export default function ChannelOutputDirs({
  media,
  resolveDirs,
  resolveInheritedHint,
  onChangeDir,
  onRemoveDir,
  onPickError,
  collapsible = false,
  description,
}: Props) {
  /**
   * 已点开「+」但还没填的渠道（纯 UI 态，不落盘）—— 那个空行就是「待填的第 2 个位置」。
   *
   * 填上之后会自动失活：`extra` 还要满足「本渠道没到上限」，所以一旦值落盘，
   * 多出来的那行就由真实数据接管，不需要额外的收尾动作。
   */
  const [extraOpen, setExtraOpen] = useState<string[]>([])
  const [open, setOpen] = useState(!collapsible)

  const closeExtra = (mediaId: string) => setExtraOpen((current) => current.filter((id) => id !== mediaId))

  const rows: ChannelDirRow[] = []
  for (const item of media) {
    const dirs = normalizeOutputDirList(resolveDirs(item.id))
    const dirCount = dirs.length
    /**
     * 「+」点出来的待填空行。只有**已经配过一个位置**的渠道才给加 —— 否则第一个位置都没填
     * 就能加出两个空行，一排空框反而不知道该填哪个（`+` 的条件见下面的 `canAdd`）。
     */
    const extra = extraOpen.includes(item.id) && dirCount > 0 && dirCount < MAX_POSTPROCESS_OUTPUT_DIRS
    // 每个渠道至少占一行：留空也要有个能打字的地方（这就是「留空 = 继承上级」的入口）
    const slotCount = Math.min(MAX_POSTPROCESS_OUTPUT_DIRS, Math.max(1, dirCount + (extra ? 1 : 0)))

    for (let index = 0; index < slotCount; index += 1) {
      rows.push({
        rowId: `${item.id}#${index}`,
        mediaId: item.id,
        channelName: item.name,
        name: index === 0 ? item.name : `${item.name}（位置${index + 1}）`,
        index,
        outputDir: dirs[index] ?? '',
        channelSpan: index === 0 ? slotCount : 0,
        dirCount,
        inherited: resolveInheritedHint(item.id),
        // 「+」只在组内最后一行：读作「在这一行下面加一行」
        canAdd: dirCount > 0 && index === slotCount - 1 && slotCount < MAX_POSTPROCESS_OUTPUT_DIRS,
        canRemove: dirCount > 0,
      })
    }
  }

  /** 行主键 → 行模型：提交单元格时要从中还原「是哪个渠道的第几个位置」 */
  const rowById = new Map(rows.map((row) => [row.rowId, row]))

  /** 选择目录对话框。设计系统不认识 Electron，所以由这里注入（`DataGridColumn.pickPath`） */
  const pickPath = async (): Promise<string | null> => {
    try {
      return (await window.electronAPI?.selectDirectory?.()) ?? null
    } catch {
      onPickError()
      return null
    }
  }

  /**
   * 删掉一行。
   *
   * 这一行如果是刚点「+」出来的空行（`index` 已经超出已配的位置数），它本来就没落盘，
   * 直接收起即可 —— 不能拿 `index` 去删数据，那会删掉别人。
   */
  const removeRow = (row: ChannelDirRow) => {
    closeExtra(row.mediaId)
    if (row.index < row.dirCount) onRemoveDir(row.mediaId, row.index)
  }

  const columns: Array<DataGridColumn<ChannelDirRow>> = [
    {
      key: 'channel',
      header: '渠道',
      editor: 'readonly',
      width: 96,
      render: (row) => row.channelName,
      // 一个渠道配了两个位置时，渠道名在这一组里只出现一次（Excel 的合并单元格）
      spanRows: (index) => rows[index]?.channelSpan ?? 1,
    },
    {
      key: 'outputDir',
      header: '导出位置',
      editor: 'path',
      pickPath,
      placeholderForRow: (row) =>
        row.index === 0 ? (row.inherited ? `留空则 ${row.inherited}` : '留空则继承上级') : '留空 = 不多写这一个位置',
    },
    {
      key: 'actions',
      header: '操作',
      editor: 'readonly',
      width: 88,
      render: (row) => (
        <Inline gap={1} wrap={false}>
          {row.canRemove && (
            <IconButton
              size="sm"
              aria-label={`${row.name}：删除这个位置`}
              // 删到只剩一个时它就是「不用这个位置了」——说清会退到哪，免得点完不知道发生了什么
              title={
                row.dirCount > 1
                  ? '删掉这一个位置（其余位置保留）'
                  : '删掉这个位置：该渠道改回「留空」，用上级/默认的输出位置'
              }
              icon={<CloseIcon className="h-3.5 w-3.5" />}
              onClick={() => removeRow(row)}
            />
          )}
          {row.canAdd && (
            <IconButton
              size="sm"
              aria-label={`${row.name}：在下面再加一个位置`}
              title="在这一行下面再加一个位置：同一份产物也会写到这里（双写）"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => setExtraOpen((current) => [...current, row.mediaId])}
            />
          )}
        </Inline>
      ),
    },
  ]

  const handleCellCommit = (rowId: string, columnKey: string, value: unknown) => {
    const row = rowById.get(rowId)
    if (!row || columnKey !== 'outputDir') return
    const text = typeof value === 'string' ? value : ''
    /**
     * 填上第 2 个位置之后就把「+ 展开态」收掉。
     *
     * 不收的话会出现「删掉第 2 个位置，那个空行自己又冒出来」——用户会以为删除没生效
     * （`extra` 只看「有没有点过 +」，不看这个位置后来是不是被填过、又被删过）。
     */
    if (row.index > 0 && text.trim()) closeExtra(row.mediaId)
    onChangeDir(row.mediaId, row.index, text)
  }

  const table =
    media.length === 0 ? (
      <p className="text-xs text-ds-muted">媒体表为空，没有可单独设置的渠道。</p>
    ) : (
      <DataGrid
        columns={columns}
        rows={rows}
        getRowId={(row) => row.rowId}
        onCellCommit={handleCellCommit}
        aria-label="按渠道设置导出位置"
        // 渠道就那么几个（默认 4 个，一个最多两行），虚拟滚动与批量选择都用不上；
        // 阈值给大也是为了让行合并生效（两者互斥，见 `spanRows` 的注释）
        virtualizeThreshold={1000}
      />
    )

  if (!collapsible) {
    return (
      <Stack gap={2}>
        {/* 说明只留必要的：每个渠道一行一个位置，表头已经说清每列是什么 */}
        <Stack gap={1}>
          <span className="text-xs font-medium text-ds-text">按渠道</span>
          {description && <span className="text-xs text-ds-muted">{description}</span>}
        </Stack>
        {table}
      </Stack>
    )
  }

  const configuredNames = Array.from(new Set(rows.filter((row) => row.dirCount > 0).map((row) => row.channelName)))

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
