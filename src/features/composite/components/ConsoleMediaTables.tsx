/**
 * 中控台 · 「渠道与输出」分区的表格本体。
 *
 * TB-060 把它从「卡片看板 + 折叠式规格编辑器」两套视图收成表格；
 * **TB-093（2026-09-22）再把「渠道与尺寸」与「输出位置」两张表合成这一张** ——
 * 两者本来就是同一份数据（都按渠道来），各占一个 tab 只会让「这个渠道出到哪」要看两个地方。
 *
 * ## 一个渠道占 1~2 行（合并 ≠ 压成一行）
 *
 * 主键仍是渠道，但导出位置一个渠道最多两个（双写，`MAX_POSTPROCESS_OUTPUT_DIRS`），
 * 所以行粒度是**位置槽**：单写占 1 行、双写占 2 行。「渠道名 / 详细尺寸 / 参与产出」三列
 * 在同一渠道的两行上**跨行合并**（`DataGridColumn.spanRows`，Excel 合并单元格那个读法），
 * 只有「导出位置」逐行 —— 于是第二行读作「它的第二个位置」，而不是「另一个渠道」。
 *
 * ⚠️ **为什么是上下排列而不是左右两列**（杰哥 2026-09-22 定的口径）：与 Excel 合并单元格的
 * 读法一致，而且路径列能拿满剩余宽度 —— 这个表为「路径被挤窄、中文共享盘路径只剩半截」
 * 报过两次障（见 `ChannelOutputDirs` 头注）。左右两列时两条路径各占一半，等于把老毛病请回来。
 * 对应地，「详细尺寸」列**必须给固定宽度**：它是 `flex-wrap` 的复选框组，不给宽会被浏览器按
 * 「内容偏好宽度」抢走弹性空间，路径列又被挤窄。
 *
 * ## 「留空 = 继承」要把继承来的位置**念全**（TB-095）
 *
 * 灰字由调用方给的 `resolveInheritedDirs` 算（本组件不自己读作用域），并且是**列表**而不是一个
 * 字符串：上一级可以给同一个渠道配两处（双写）。只说第一个会让人以为「跟随只跟一处」，
 * 而产出侧两处都照写 —— 界面显示少于实际生效，用户照着界面判断就会错（2026-09-22 杰哥报障）。
 *
 * ## 这张表里混着两种作用域（合并的代价，靠列说明说清）
 *
 * | 列                                  | 层级     | 数据                                                 |
 * | ----------------------------------- | -------- | ---------------------------------------------------- |
 * | 渠道名 / 详细尺寸                   | 全局一套 | `usePostprocessMediaStore.media`                     |
 * | 参与产出                            | 跟作用域 | 全局基线 `selectedMediaIds` / 节点 `selectedMediaIds` |
 * | 导出位置                            | 跟作用域 | 全局 `mediaOutputDirs` / 节点 `byMedia[m].outputDirs` |
 *
 * **分区级提示解决不了这件事**（2026-09-21 删掉 `globalOnly` 的理由），所以层级写在每列的
 * `help` 里，分区顶上另有一条作用域说明条。本组件**不自己读作用域**：勾选状态、目录读写、
 * 继承提示全部由调用方（`ChannelSection`）按当前作用域解析后传进来 —— 表格自己读全局 store
 * 的话，选着某个方向改的却是所有方向共用的那份（ADR-0013 修掉的正是这个病）。
 *
 * ## 它不管什么
 *
 * - 「尺寸数 / 可用尺寸」两个派生列**已删**：尺寸那格本来就是「一眼数出配了几套」的复选框组，
 *   再挂两个数字列是重复表达，还占宽度。
 * - 「画面方向 / 画面适配」是整批三选一，不是某一条记录的字段 → 留在分区里、不进表。
 * - 表里**只有渠道**：原先表外还单列一栏「纯净版」，那条产出路径已拆掉（ADR-0020）。
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  DataGrid,
  IconButton,
  Inline,
  SelectField,
  Stack,
  TextField,
  type DataGridColumn,
} from '../../../design-system'
import { CloseIcon, PlusIcon, TrashIcon } from '../../../design-system/icons'
import { useStore } from '../../../store'
import { buildPostprocessMediaSizeId, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import {
  MAX_POSTPROCESS_OUTPUT_DIRS,
  formatInheritedOutputDirsHint,
  normalizeOutputDirList,
  planPostprocessOutputDirSlots,
  type PostprocessMediaSize,
} from '../../../lib/postprocessMedia'

/** 加尺寸时的默认规格：与原「加尺寸」按钮的行为一致（1024×1024、不做体积压缩）。 */
const DEFAULT_NEW_SIZE = { width: 1024, height: 1024, maxSizeKb: 0, enabled: true }

interface Props {
  /** 当前作用域下生效的「参与产出」渠道 id（含 `clean`）。由调用方按作用域解析后传入 */
  selectedMediaIds: string[]
  /** 切换某个渠道的参与状态。写回全局基线还是某个方向，由调用方决定 */
  onToggleSelected: (mediaId: string, next: boolean) => void
  /** 当前参与产出的作用域名（「全局基线」或某个方向名），挂在列说明上 */
  participationScopeLabel: string
  /** 读某渠道**本级已配**的导出位置（1~2 个）；空数组 = 本级没配，用继承值 */
  resolveDirs: (mediaId: string) => string[]
  /**
   * 占位提示：本级留空时会落到**哪些**位置（继承链解析结果，调用方给）。
   *
   * 是列表而不是一个字符串（TB-095）：上一级可以给同一个渠道配两处（双写），
   * 只说第一个会让人以为「跟随只跟一处」，产出侧却两处都写。
   */
  resolveInheritedDirs: (mediaId: string) => string[]
  /**
   * 本级留空时能继承到、**且可以逐处开关**的位置（上级真配了的那几处）。
   *
   * 与 `resolveInheritedDirs` 的差别：那个是**文案**（落到默认输出位置时也要说一句），
   * 这个是**可操作的路径**（只有真路径才谈得上开关）。全局作用域没有上级 → 恒返回空数组。
   */
  resolveInheritedToggleDirs: (mediaId: string) => string[]
  /** 某一处导出位置**最终**开不开（含从上级继承来的停用声明） */
  resolveDirEnabled: (mediaId: string, dir: string) => boolean
  /** 切换某一处导出位置的开关；`dir` = 该处当前生效的路径 */
  onToggleDirEnabled: (mediaId: string, dir: string, enabled: boolean) => void
  /** 写某渠道第 `index` 个位置；传空串 = 清掉该位置 */
  onChangeDir: (mediaId: string, index: number, outputDir: string) => void
  /** 删某渠道第 `index` 个位置，其余位置上移（删到一个不剩 = 该渠道回到「留空」） */
  onRemoveDir: (mediaId: string, index: number) => void
  onPickError: () => void
}

/**
 * 表格行 = **一个位置槽**。一个渠道 1~2 行，同组各行的 `rowId` 不同（`渠道id#下标`）——
 * 用下标做 key 会在删行时把值写到隔壁行上（`DataGrid` 头注第 2 条）。
 */
interface ChannelRow {
  rowId: string
  mediaId: string
  channelName: string
  /** 无障碍名称里的行标识：第一行是渠道名，第二行起带位置号（两行同名的话读屏分不清在改谁） */
  name: string
  index: number
  outputDir: string
  /** 本行在合并列里跨几行：该组第一行是组内行数，其余是 0（被上面那格盖住） */
  span: number
  /** 该渠道**已配**的位置数（不含刚点出来还没填的空行） */
  dirCount: number
  /**
   * 留空时会继承到的**全部**位置（通常 1~2 个）—— 逐行不同，所以走 `placeholderForRow`。
   * 空数组 = 链上没人配过这一格，落到默认输出位置。
   */
  inheritedDirs: string[]
  /** 这一格代表的导出位置路径（本级填的，或本级留空时继承来的）；空串 = 没有可开关的位置 */
  toggleDir: string
  /** 这一处的开关状态；`toggleDir` 为空时恒 `false`（那个开关也不可点） */
  dirEnabled: boolean
  /** 这一格是不是「本级留空、跟着上级那一处」 */
  inherited: boolean
  /** 是否给「在下面再加一个位置」 */
  canAdd: boolean
  /** 是否给「删掉这个位置」 */
  canRemove: boolean
  /** 是否是该组第一行（删渠道只在第一行出现，一个渠道一个按钮） */
  leading: boolean
  /** 该渠道的尺寸规格（合并列用，同组各行相同） */
  sizes: PostprocessMediaSize[]
  /** 当前作用域下这个渠道参不参与产出（合并列用） */
  applied: boolean
}

export function ConsoleMediaTables({
  selectedMediaIds,
  onToggleSelected,
  participationScopeLabel,
  resolveDirs,
  resolveInheritedDirs,
  resolveInheritedToggleDirs,
  resolveDirEnabled,
  onToggleDirEnabled,
  onChangeDir,
  onRemoveDir,
  onPickError,
}: Props) {
  const media = usePostprocessMediaStore((state) => state.media)
  const renameMedia = usePostprocessMediaStore((state) => state.renameMedia)
  const deleteMedia = usePostprocessMediaStore((state) => state.deleteMedia)
  const addMedia = usePostprocessMediaStore((state) => state.addMedia)
  const addMediaSize = usePostprocessMediaStore((state) => state.addMediaSize)
  const updateMediaSize = usePostprocessMediaStore((state) => state.updateMediaSize)
  const deleteMediaSize = usePostprocessMediaStore((state) => state.deleteMediaSize)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  const [newChannelName, setNewChannelName] = useState('')
  /** 正在展开详细编辑的尺寸 id（纯 UI 态，不落盘）。 */
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null)
  /**
   * 已点开「+」但还没填的渠道（纯 UI 态，不落盘）—— 那一行就是「待填的第 2 个位置」。
   * 填上之后会自动失活：它还要满足「本渠道没到上限」，所以值一落盘就由真实数据接管。
   */
  const [extraOpen, setExtraOpen] = useState<string[]>([])

  /**
   * 规格与位置表的行 = 媒体表本身。
   *
   * 原先这里还要滤掉「纯净版」（它不产渠道变体、连「尺寸」的概念都不同），该产出路径已拆掉
   * （ADR-0020），媒体表里不会再出现它。
   */
  const channelRows = media

  const closeExtra = useCallback(
    (mediaId: string) => setExtraOpen((current) => current.filter((id) => id !== mediaId)),
    [],
  )

  /**
   * 行模型：**一个渠道展开成 1~2 行**（有几份已配的位置就几行，点过「+」再多一行空的）。
   * 跨行合并的三个列都读这里的 `span`。
   */
  const rows = useMemo<ChannelRow[]>(() => {
    const result: ChannelRow[] = []
    for (const item of channelRows) {
      const dirs = normalizeOutputDirList(resolveDirs(item.id))
      const dirCount = dirs.length
      const inheritedDirs = resolveInheritedDirs(item.id)
      const applied = selectedMediaIds.includes(item.id)
      /**
       * 行数由 `planPostprocessOutputDirSlots` 定（与后处理弹窗那张表共用同一条规则）：
       * 本级配了就按本级的算；本级没配则按**能继承到的位置数**铺开 ——
       * 继承来的两处要各自有开关，只铺一行的话「停了第一处、第二处还在写」显示不出来。
       */
      const slots = planPostprocessOutputDirSlots({
        ownDirs: dirs,
        inheritedDirs: resolveInheritedToggleDirs(item.id),
        extraSlot: extraOpen.includes(item.id),
      })
      const slotCount = slots.length
      for (const slot of slots) {
        result.push({
          rowId: `${item.id}#${slot.index}`,
          mediaId: item.id,
          channelName: item.name,
          name: slot.index === 0 ? item.name : `${item.name}（位置${slot.index + 1}）`,
          index: slot.index,
          outputDir: slot.ownDir,
          span: slot.index === 0 ? slotCount : 0,
          dirCount,
          inheritedDirs,
          toggleDir: slot.dir,
          dirEnabled: slot.dir !== '' && resolveDirEnabled(item.id, slot.dir),
          inherited: slot.inherited,
          // 「+」只在组内最后一行：读作「在这一行下面加一行」
          canAdd: dirCount > 0 && slot.index === slotCount - 1 && slotCount < MAX_POSTPROCESS_OUTPUT_DIRS,
          canRemove: dirCount > 0,
          leading: slot.index === 0,
          sizes: item.sizes,
          applied,
        })
      }
    }
    return result
  }, [
    channelRows,
    extraOpen,
    resolveDirs,
    resolveInheritedDirs,
    resolveInheritedToggleDirs,
    resolveDirEnabled,
    selectedMediaIds,
  ])

  /** 行主键 → 行模型：提交单元格时要从中还原「是哪个渠道的第几个位置」 */
  const rowById = useMemo(() => new Map(rows.map((row) => [row.rowId, row])), [rows])

  /** 合并列共用的跨行数：三个列读同一份，切换渠道时不会一列合、一列不合。 */
  const spanAt = useCallback((index: number) => rows[index]?.span ?? 1, [rows])

  const confirmDeleteChannel = useCallback(
    (mediaId: string, channelName: string) => {
      setConfirmDialog({
        title: `删除渠道「${channelName}」？`,
        message:
          '这会把它从渠道表与所有已勾选的启用范围里一并移除，它的尺寸规格与导出位置也一起没了。已产出的文件不会被删除。',
        confirmText: '删除',
        cancelText: '取消',
        tone: 'danger',
        action: () => deleteMedia(mediaId),
      })
    },
    [deleteMedia, setConfirmDialog],
  )

  const confirmDeleteSize = useCallback(
    (mediaId: string, channelName: string, size: PostprocessMediaSize) => {
      setConfirmDialog({
        title: `删除「${channelName} ${size.width}×${size.height}」？`,
        message: '删除后这个尺寸不再产出。已产出的文件不会被删除。',
        confirmText: '删除',
        cancelText: '取消',
        tone: 'danger',
        action: () => deleteMediaSize(mediaId, size.id),
      })
    },
    [deleteMediaSize, setConfirmDialog],
  )

  /**
   * 删掉一行。
   *
   * 这一行如果是刚点「+」出来的空行（`index` 已经超出已配的位置数），它本来就没落盘，
   * 直接收起即可 —— 不能拿 `index` 去删数据，那会删掉别人。
   */
  const removeRow = useCallback(
    (row: ChannelRow) => {
      closeExtra(row.mediaId)
      if (row.index < row.dirCount) onRemoveDir(row.mediaId, row.index)
    },
    [closeExtra, onRemoveDir],
  )

  /**
   * 选择目录对话框。设计系统不认识 Electron，所以由这里注入（`DataGridColumn.pickPath`）。
   * ⚠️ 手输路径不在主进程白名单里（只有对话框选过的目录才放行），所以这个按钮是主要入口。
   *
   * 用 `useCallback` 包着：它要进 `columns` 的依赖数组，每次渲染新建函数会让列定义白重建一遍。
   */
  const pickPath = useCallback(async (): Promise<string | null> => {
    try {
      return (await window.electronAPI?.selectDirectory?.()) ?? null
    } catch {
      onPickError()
      return null
    }
  }, [onPickError])

  /**
   * 三列跨行合并成「渠道」块，一列逐行是位置 —— 合在一起就是
   * 「一行一个渠道（双写占两行）」。
   *
   * 列宽刻意收窄：「详细尺寸」给固定宽（防止复选框组抢走弹性空间），
   * 「导出位置」不给宽 → 拿满剩余宽度（路径要尽量能看全）。
   */
  const columns = useMemo<Array<DataGridColumn<ChannelRow>>>(
    () => [
      {
        key: 'name',
        header: '渠道名',
        help: '所有方向共用：改一次所有方向都跟着变。同名渠道不允许重复。',
        editor: 'text',
        width: 140,
        // 短标记列居中（2026-09-22 杰哥定）：渠道名与「参与产出」居中，其余列左对齐
        align: 'center',
        getValue: (row) => row.channelName,
        spanRows: spanAt,
        validate: (value, row) => {
          const text = String(value ?? '').trim()
          if (!text) return '渠道名不能为空'
          return media.some((item) => item.id !== row.mediaId && item.name === text) ? '已有同名渠道' : null
        },
      },
      {
        key: 'sizes',
        header: '详细尺寸',
        help: '所有方向共用的一份规格：勾上才会产出这个尺寸。点尺寸名可改宽高、体积上限，或把它移到别的渠道。',
        editor: 'readonly',
        // 320 而不是 300：两列各要放下「1080×1920 399KB」这种最宽的一格（约 135px）+ 内边距
        width: 320,
        spanRows: spanAt,
        render: (row) => (
          /*
           * **两列网格**，不是 flex-wrap（2026-09-22 杰哥反馈「两列尺寸这种对齐方式太乱了」）：
           * flex-wrap 下第二列的起点取决于它左边那个 chip 有多宽 —— 逐行参差，看着就是乱的；
           * grid 的列宽由该列最宽的 chip 定，两列各自成一条竖线，扫起来才整齐。
           */
          <span className="grid grid-cols-2 gap-1.5" data-testid={`size-checks-${row.mediaId}`}>
            {row.sizes.length === 0 && (
              <span className="col-span-2 text-xs text-ds-muted dark:text-ds-muted">还没有尺寸</span>
            )}
            {row.sizes.map((size) => (
              <span
                key={size.id}
                /* 高度定死 24px：给「加尺寸」按钮一个能对齐的高度，也让折行时每格一样高 */
                className="inline-flex h-6 items-center gap-1 rounded-ds-md border border-ds-border px-2"
              >
                <Checkbox
                  checked={size.enabled}
                  aria-label={`${row.channelName} ${size.width}×${size.height} 参与产出`}
                  onChange={(next) => updateMediaSize(row.mediaId, size.id, { enabled: next })}
                />
                <button
                  type="button"
                  data-testid={`edit-size-${size.id}`}
                  title="改宽高、体积上限，或移到别的渠道"
                  className="text-xs text-ds-text hover:text-ds-accent dark:text-ds-text"
                  onClick={() => setEditingSizeId(size.id)}
                >
                  {size.width}×{size.height}
                </button>
                {size.maxSizeKb > 0 && (
                  <span className="text-xs text-ds-muted dark:text-ds-muted">{size.maxSizeKb}KB</span>
                )}
              </span>
            ))}
            {/*
             * 「加尺寸」贴着这一组的末尾，且与 chip **同高**（24px 正方形）——
             * `IconButton size="sm"` 是 32px（`--ds-control-sm`），比 chip 高一截，看着像浮在格子里。
             * ⚠️ 必须带 `!` 前缀：ds 基础类声明过 height / min-height / width，不加会被它吃掉（R-80）。
             */}
            <IconButton
              size="sm"
              className="!h-6 !w-6 !min-h-6"
              aria-label={`给「${row.channelName}」加一个尺寸`}
              title="加一个尺寸（默认 1024×1024，不做体积压缩）"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                addMediaSize(row.mediaId, DEFAULT_NEW_SIZE)
                setEditingSizeId(
                  buildPostprocessMediaSizeId(row.mediaId, DEFAULT_NEW_SIZE.width, DEFAULT_NEW_SIZE.height),
                )
              }}
            />
          </span>
        ),
      },
      {
        key: 'applied',
        header: '参与产出',
        // 作用域名写进说明里：同一个开关在全局层和在方向层改的是两份数据，不说清就会改错地方
        help: `勾上这个渠道才产出变体。当前作用域：${participationScopeLabel}。`,
        editor: 'switch',
        width: 88,
        align: 'center',
        getValue: (row) => row.applied,
        spanRows: spanAt,
      },
      {
        key: 'outputDir',
        header: '导出位置',
        help: '留空 = 用默认输出位置（节点作用域下继续沿树向上继承）；给两个 = 双写，同一份产物两处各写一份。',
        editor: 'path',
        pickPath,
        // 留空的含义逐行不同：第一行是「继承上级」（**几个位置都要念出来**，见
        // `formatInheritedOutputDirsHint`），第二行是「不多写这一份」
        placeholderForRow: (row) => {
          // 第一行永远念**全部**继承来源（TB-095：只说一处会让人以为「跟随只跟一处」）；
          // 第二行起是「本级留空、对应上级的第 N 处」，念它自己那一条就够
          if (row.index === 0) return formatInheritedOutputDirsHint(row.inheritedDirs)
          if (row.inherited) return formatInheritedOutputDirsHint([row.toggleDir])
          return '留空 = 不多写这一个位置'
        },
      },
      {
        key: 'dirEnabled',
        // 列头叫「写入」而不是「启用」：这张表里**已经有一个**渠道级开关（「参与产出」），
        // 再来一列叫「启用」会让人以为是同一个东西的两种说法（ADR-0013 删掉渠道级 `enabled`
        // 正是因为这个）。这一列管的是**这一处导出位置写不写**，与「这个渠道产不产出」是两件事：
        // 关掉「写入」照样生成变体，只是不落这一处；关掉「参与产出」连变体都不生成。
        header: '写入',
        help: '关掉这一处就不再往它写文件：位置配置留着，随时能开回来。没有路径的格（还没填、或只落到默认输出位置）不可点。',
        editor: 'readonly',
        width: 72,
        align: 'center',
        render: (row) => (
          <Checkbox
            checked={row.dirEnabled}
            disabled={row.toggleDir === ''}
            aria-label={
              row.toggleDir === ''
                ? `${row.name}：这一处还没有导出位置`
                : `${row.name}：${row.dirEnabled ? '停掉' : '恢复'}写入 ${row.toggleDir}`
            }
            title={
              row.toggleDir === ''
                ? '这一处还没有导出位置，开关没有作用对象'
                : row.dirEnabled
                  ? `关掉这一处：不再往 ${row.toggleDir} 写文件（路径配置保留）`
                  : `打开这一处：恢复往 ${row.toggleDir} 写文件`
            }
            onChange={(next) => onToggleDirEnabled(row.mediaId, row.toggleDir, next)}
          />
        ),
      },
      {
        key: 'actions',
        header: '操作',
        editor: 'readonly',
        width: 96,
        render: (row) => (
          <Inline gap={1} wrap={false}>
            {/* 删渠道只在该组第一行：它删的是整个渠道（含各位置），挂在第二行会被读成「删这个位置」 */}
            {row.leading && (
              <IconButton
                size="sm"
                aria-label={`删除渠道 ${row.channelName}`}
                title={`删除渠道「${row.channelName}」（含它的尺寸与导出位置）`}
                icon={<TrashIcon className="h-3.5 w-3.5" />}
                onClick={() => confirmDeleteChannel(row.mediaId, row.channelName)}
              />
            )}
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
    ],
    [
      addMediaSize,
      confirmDeleteChannel,
      media,
      onToggleDirEnabled,
      participationScopeLabel,
      pickPath,
      removeRow,
      spanAt,
      updateMediaSize,
    ],
  )

  const handleCellCommit = useCallback(
    (rowId: string, columnKey: string, value: unknown) => {
      const row = rowById.get(rowId)
      if (!row) return
      if (columnKey === 'name') {
        // 改名是渠道级动作：三个合并列都长在同一组行上，任何一行提交都落到同一个渠道
        renameMedia(row.mediaId, String(value ?? ''))
        return
      }
      if (columnKey === 'applied') {
        // 写回哪一层由调用方决定（全局基线 / 这个方向），表格不掺和继承
        onToggleSelected(row.mediaId, value === true)
        return
      }
      if (columnKey === 'outputDir') {
        const text = typeof value === 'string' ? value : ''
        /**
         * 填上第 2 个位置之后就把「+ 展开态」收掉。
         *
         * 不收的话会出现「删掉第 2 个位置，那个空行自己又冒出来」——用户会以为删除没生效
         * （`extra` 只看「有没有点过 +」，不看这个位置后来是不是被填过、又被删了）。
         */
        if (row.index > 0 && text.trim()) closeExtra(row.mediaId)
        onChangeDir(row.mediaId, row.index, text)
      }
    },
    [closeExtra, onChangeDir, onToggleSelected, renameMedia, rowById],
  )

  const handleAddChannel = () => {
    const trimmed = newChannelName.trim()
    if (!trimmed) return
    const id = addMedia(trimmed)
    if (!id) {
      showToast('添加失败：同名渠道已存在', 'error')
      return
    }
    setNewChannelName('')
  }

  /** 当前展开编辑的尺寸（连同它属于哪个渠道）。尺寸可能在别处被删掉 → 自动收起。 */
  const editingSize = useMemo(() => {
    for (const item of channelRows) {
      const size = item.sizes.find((entry) => entry.id === editingSizeId)
      if (size) return { mediaId: item.id, channelName: item.name, size }
    }
    return null
  }, [channelRows, editingSizeId])

  const channelOptions = useMemo(() => channelRows.map((item) => ({ value: item.id, label: item.name })), [channelRows])

  const moveSize = useCallback(
    (sizeId: string, fromMediaId: string, toMediaId: string) => {
      if (fromMediaId === toMediaId) return
      const size = media.find((item) => item.id === fromMediaId)?.sizes.find((entry) => entry.id === sizeId)
      if (!size) return
      const target = media.find((item) => item.id === toMediaId)
      if (!target) return
      const nextId = buildPostprocessMediaSizeId(toMediaId, size.width, size.height)
      if (target.sizes.some((entry) => entry.id === nextId)) {
        showToast(`「${target.name}」已有 ${size.width}×${size.height}，未移动`, 'error')
        return
      }
      // 先加后删（理由见 `ChannelOutputDirs` 头注）：最坏是短暂两份，不会丢规格
      addMediaSize(toMediaId, {
        width: size.width,
        height: size.height,
        maxSizeKb: size.maxSizeKb,
        enabled: size.enabled,
      })
      deleteMediaSize(fromMediaId, sizeId)
    },
    [addMediaSize, deleteMediaSize, media, showToast],
  )

  /**
   * 尺寸编辑面板的「应用」：**先移渠道，再改宽高与体积上限**。
   *
   * 顺序不能反 —— 宽高决定尺寸主键（`渠道-宽x高`），先改宽高再移动就会拿着一个
   * 在新渠道里不存在的 id 去写，静默失败。
   */
  const handleSizeApply = useCallback(
    (patch: { channelId: string; width: number; height: number; maxSizeKb: number }) => {
      const current = editingSize
      if (!current) return
      const { size } = current
      if (patch.channelId !== current.mediaId) {
        moveSize(size.id, current.mediaId, patch.channelId)
      }
      const idInTarget = buildPostprocessMediaSizeId(patch.channelId, size.width, size.height)
      updateMediaSize(patch.channelId, idInTarget, {
        width: patch.width,
        height: patch.height,
        maxSizeKb: patch.maxSizeKb,
      })
      // 宽高变了主键就变了 —— 编辑目标跟到新 id 上，否则面板会以为尺寸被删了而自动收起
      setEditingSizeId(buildPostprocessMediaSizeId(patch.channelId, patch.width, patch.height))
    },
    [editingSize, moveSize, updateMediaSize],
  )

  return (
    <Stack gap={3}>
      <DataGrid
        aria-label="渠道与输出"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.rowId}
        onCellCommit={handleCellCommit}
        emptyTitle="渠道表为空"
        emptyDescription="没有可产出的渠道。在下面加一个，或恢复内置媒体表。"
        // 渠道就那么几个（一个最多两行），虚拟滚动用不上；给大也是为了跨行合并生效（两者互斥）
        virtualizeThreshold={1000}
      />

      {/*
       * 底对齐：输入框和「添加渠道」都是同一个 40px 控件，底边对齐才不会差半个标签行。
       * 用 `flex-end` 而不是 `items-center`：后者会把按钮居中在一个「空 label 仍占字段内间距」的盒子里。
       */}
      <Inline gap={2} align="flex-end">
        <TextField
          label=""
          aria-label="新渠道名称"
          containerClassName="min-w-0 flex-1"
          placeholder="新渠道名称，如「抖音」"
          value={newChannelName}
          onChange={(event) => setNewChannelName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleAddChannel()
          }}
        />
        <Button
          variant="secondary"
          disabled={!newChannelName.trim()}
          leadingIcon={<PlusIcon className="h-3.5 w-3.5" />}
          onClick={handleAddChannel}
        >
          添加渠道
        </Button>
      </Inline>

      {editingSize && (
        <SizeEditor
          // key 绑尺寸主键：换一个尺寸编辑就重挂载，草稿态跟着重置（否则会串到上一条上）
          key={editingSize.size.id}
          channelId={editingSize.mediaId}
          channelName={editingSize.channelName}
          size={editingSize.size}
          channels={channelOptions}
          onApply={handleSizeApply}
          onDelete={() => confirmDeleteSize(editingSize.mediaId, editingSize.channelName, editingSize.size)}
          onClose={() => setEditingSizeId(null)}
        />
      )}
    </Stack>
  )
}

interface SizeEditorProps {
  channelId: string
  channelName: string
  size: PostprocessMediaSize
  channels: Array<{ value: string; label: string }>
  onApply: (patch: { channelId: string; width: number; height: number; maxSizeKb: number }) => void
  onDelete: () => void
  onClose: () => void
}

/**
 * 尺寸的**详细参数**编辑面板（点尺寸表里的尺寸名展开）。
 *
 * 为什么从「表格里一列一列地改」变成「点开一个小面板」：
 * 尺寸表每行是一个渠道、格子里是复选框，放不下宽高 / 体积上限这些字段了
 * （2026-09-21 反馈要的是「尽可能排一行」，不是又宽又空的表）。
 * 但改宽高、体积上限、跨渠道移动一个都不能少，所以收进这个面板。
 *
 * **草稿态提交**：输入期间只动本地，点「应用」才写库 —— 宽高决定尺寸主键
 * （`渠道-宽x高`），半截值（`1` → `10` → `108`）会连着换三次主键，
 * 中间那两次还会与外层解析出来的引用打架（`DataGrid` 当年踩过同一个坑）。
 */
function SizeEditor({ channelId, channelName, size, channels, onApply, onDelete, onClose }: SizeEditorProps) {
  const [draftChannelId, setDraftChannelId] = useState(channelId)
  const [width, setWidth] = useState(String(size.width))
  const [height, setHeight] = useState(String(size.height))
  const [maxSizeKb, setMaxSizeKb] = useState(String(size.maxSizeKb))

  const widthValue = Number(width)
  const heightValue = Number(height)
  const maxKbValue = Number(maxSizeKb)
  const widthInvalid = !Number.isInteger(widthValue) || widthValue <= 0
  const heightInvalid = !Number.isInteger(heightValue) || heightValue <= 0
  const maxKbInvalid = maxSizeKb.trim() !== '' && (!Number.isFinite(maxKbValue) || maxKbValue < 0)
  const invalid = widthInvalid || heightInvalid || maxKbInvalid

  return (
    <Stack gap={3} className="rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:bg-ds-scrim">
      <Inline gap={3}>
        <span className="text-sm font-medium text-ds-text dark:text-ds-text">
          编辑尺寸：{channelName} {size.width}×{size.height}
        </span>
        <span className="text-xs text-ds-muted dark:text-ds-muted">改宽高等于换一套尺寸，原规格不再产出。</span>
        <span className="min-w-4 flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose}>
          收起
        </Button>
      </Inline>

      {/*
       * 字段行：**顶对齐**（2026-09-22 对齐修正）。
       * 底对齐会让「带说明文字的字段」整体抬高一个标签行：渠道 / 体积上限 有 helperText，宽 / 高 没有
       * → 一屏里出现**两条基线**；而且 宽 一旦进校验错误（多一行红字）整行会再往上跳一次。
       */}
      <Inline gap={3} align="flex-start" data-testid="size-editor-fields">
        <SelectField
          label="渠道"
          aria-label="尺寸所属渠道"
          containerClassName="w-40"
          value={draftChannelId}
          options={channels}
          helperText="换渠道 = 把这一套尺寸移过去"
          onChange={(event) => setDraftChannelId(event.target.value)}
        />
        <TextField
          label="宽"
          aria-label="尺寸宽"
          containerClassName="w-24"
          value={width}
          error={widthInvalid ? '正整数' : undefined}
          onChange={(event) => setWidth(event.target.value)}
        />
        <TextField
          label="高"
          aria-label="尺寸高"
          containerClassName="w-24"
          value={height}
          error={heightInvalid ? '正整数' : undefined}
          onChange={(event) => setHeight(event.target.value)}
        />
        <TextField
          label="体积上限 KB"
          aria-label="尺寸体积上限"
          containerClassName="w-40"
          value={maxSizeKb}
          error={maxKbInvalid ? '≥ 0 的数字' : undefined}
          helperText="0 = 不做体积压缩"
          onChange={(event) => setMaxSizeKb(event.target.value)}
        />
        {/*
         * 操作区要跟**控件**那条线对齐，而不是标签线 —— 所以借 `.ds-field` 的标签槽占位：
         * 同一个 class、同一份 token（标签 13px × 1.25 + 字段内间距 8px），不写死像素，
         * 以后改字号或字段间距，按钮会自己跟着走。`invisible` 只占位不显形（保住布局盒），
         * `aria-hidden` 让读屏跳过这行占位文字。
         */}
        <div className="ds-field" data-testid="size-editor-actions">
          <span className="ds-field__label invisible" aria-hidden="true">
            操作
          </span>
          <Inline gap={2}>
            <Button
              variant="secondary"
              disabled={invalid}
              onClick={() =>
                onApply({
                  channelId: draftChannelId,
                  width: widthValue,
                  height: heightValue,
                  maxSizeKb: Number.isFinite(maxKbValue) && maxKbValue > 0 ? Math.trunc(maxKbValue) : 0,
                })
              }
            >
              应用
            </Button>
            {/* 图标必须走 `leadingIcon`：塞进 children 的话，Tailwind preflight 的
                `svg { display: block }` 会把图标顶成单独一行，文字被挤到第二行（图标压在文字上方）。 */}
            <Button variant="ghost" leadingIcon={<TrashIcon className="h-3.5 w-3.5" />} onClick={onDelete}>
              删除尺寸
            </Button>
          </Inline>
        </div>
      </Inline>
    </Stack>
  )
}

export default ConsoleMediaTables
