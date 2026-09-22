/**
 * 中控台 · 「渠道与尺寸」分区的表格本体（TB-060）。
 *
 * 替代原来的「渠道分组卡片 + 折叠式规格编辑器」两套视图：
 * 卡片看板的全部信息（渠道名、`N / M 已应用` 计数、参与产出勾选）在这里都有
 * 对应的一列，而规格增删改从「先展开渠道再逐字段点」变成「一行一个规格、点哪格改哪格」。
 * **信息无损失，只是不再需要两套视图来表达同一份数据。**
 *
 * ## ⚠️ 本组件不自己读 store 的勾选状态（ADR-0013）
 *
 * 「参与产出」是**方向级**的：全局作用域改基线、节点作用域改这个方向自己那份。
 * 所以勾选状态与写回回调都由 `MediaSection` 传进来（它在那边按作用域解析过），
 * 本组件只负责「把值画出来、把点击交回去」。表格自己读全局 store 的话，
 * 选着某个方向改的却是所有方向共用的那份 —— 正是这一版要修掉的问题。
 *
 * 「启用」列**已删除**（2026-09-21）：它与「参与产出」对产出的影响完全等价
 * （`matchMediaSizes` 先看渠道启用、`buildPostprocessOutputs` 先按参与列表迭代，任一为关就不产出），
 * 两个开关说同一件事只会让人怀疑它们有什么区别。详见 `postprocessMedia.ts` 的 ADR-0013 注。
 *
 * ## 为什么是两张表而不是一张
 *
 * 渠道与尺寸是 1:N。压成一张表就得让渠道名在每行重复出现，而那会被读成
 * 「存在多个同名渠道」——这是会误导人的表达。
 *
 * **2026-09-21 尺寸表改成「一行一个渠道 + 详细尺寸复选框组」**（原先是「一行一个规格」）：
 * 用户要的是「详细尺寸使用复选框，尽可能排一行，放不下的排两行」。
 * 一行一个渠道之后，复选框横着铺开，扫一眼就知道「这个渠道配了哪几套、哪几套是开的」——
 * 而「数出来」正是配尺寸时要做的判断。改宽高 / 体积上限 / 跨渠道移动收进
 * 点尺寸名展开的 `SizeEditor`（新表里放不下这些字段了）。
 * ⚠️ 导出到 Excel 的 `channels` / `channel_sizes` 两张 Sheet **不受影响**：
 * 那是数据形状（store 里的 `media[].sizes[]`），与界面怎么摆无关。
 *
 * ## 跨渠道移动尺寸：先加到目标，再删源
 *
 * `sizeId` 由 `mediaId + 宽高` 派生（`buildPostprocessMediaSizeId`），所以同一个规格
 * 换了渠道就是一个**新主键**。先删后加一旦中途失败规格就没了；先加后删最坏只是
 * 短暂出现两份。目标渠道已有同宽高时直接拒绝——那本来就是同一个规格，
 * 让它「撞」上去等于静默丢失信息。
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  DataGrid,
  IconButton,
  Inline,
  SectionHeader,
  SelectField,
  Stack,
  TextField,
  type DataGridColumn,
} from '../../../design-system'
import { PlusIcon, TrashIcon } from '../../../design-system/icons'
import { useStore } from '../../../store'
import { buildPostprocessMediaSizeId, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { PURE_MEDIA_ID, type PostprocessMedia, type PostprocessMediaSize } from '../../../lib/postprocessMedia'

/**
 * 尺寸表的行 = **一个渠道**。
 *
 * 上一版是「一行一个规格」（尺寸展开成行、渠道当外键）。2026-09-21 反馈改成现在这样：
 * 「详细尺寸使用复选框，尽可能排一行，放不下的排两行」。一行一个渠道之后，
 * 复选框组横着铺开，用户扫一眼就知道「这个渠道配了哪几套、哪几套是开的」——
 * 原表得逐行找渠道名才能数出来，而「数出来」正是他配尺寸时要做的判断。
 */
interface SizeRow {
  id: string
  name: string
  sizes: PostprocessMediaSize[]
}

/** 加尺寸时的默认规格：与原「加尺寸」按钮的行为一致（1024×1024、不做体积压缩）。 */
const DEFAULT_NEW_SIZE = { width: 1024, height: 1024, maxSizeKb: 0, enabled: true }

interface Props {
  /** 当前作用域下生效的「参与产出」渠道 id（含 `clean`）。由 `MediaSection` 按作用域解析后传入 */
  selectedMediaIds: string[]
  /** 切换某个渠道的参与状态。写回全局基线还是某个方向，由调用方决定 */
  onToggleSelected: (mediaId: string, next: boolean) => void
  /** 当前参与产出的作用域名（「全局基线」或某个方向名），挂在列说明上 */
  participationScopeLabel: string
}

export function ConsoleMediaTables({ selectedMediaIds, onToggleSelected, participationScopeLabel }: Props) {
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

  /** 纯净版不是渠道（它不产渠道变体），规格表里不出现——它的「尺寸」概念也不同。 */
  const channelRows = useMemo(() => media.filter((item) => item.id !== PURE_MEDIA_ID), [media])

  /** 尺寸表的行 = **渠道**：详细尺寸以复选框组落在同一行里（见 `sizeColumns` 的说明）。 */
  const sizeRows = useMemo<SizeRow[]>(
    () => channelRows.map((item) => ({ id: item.id, name: item.name, sizes: item.sizes })),
    [channelRows],
  )

  const channelOptions = useMemo(() => channelRows.map((item) => ({ value: item.id, label: item.name })), [channelRows])

  /** 当前展开编辑的尺寸（连同它属于哪个渠道）。尺寸可能在别处被删掉 → 自动收起。 */
  const editingSize = useMemo(() => {
    for (const item of channelRows) {
      const size = item.sizes.find((entry) => entry.id === editingSizeId)
      if (size) return { mediaId: item.id, channelName: item.name, size }
    }
    return null
  }, [channelRows, editingSizeId])

  const confirmDeleteChannel = useCallback(
    (row: PostprocessMedia) => {
      setConfirmDialog({
        title: `删除渠道「${row.name}」？`,
        message:
          '这会把它从媒体表与所有已勾选的启用范围里一并移除，之后按这个渠道产出的变体不再生成。已产出的文件不会被删除。',
        confirmText: '删除',
        cancelText: '取消',
        tone: 'danger',
        action: () => deleteMedia(row.id),
      })
    },
    [deleteMedia, setConfirmDialog],
  )

  // ---- 渠道表 ----
  const channelColumns = useMemo<Array<DataGridColumn<PostprocessMedia>>>(
    () => [
      {
        key: 'name',
        header: '渠道名',
        help: '产出变体的渠道名。同名渠道不允许重复。',
        editor: 'text',
        width: 200,
        validate: (value, row) => {
          const text = String(value ?? '').trim()
          if (!text) return '渠道名不能为空'
          const duplicated = media.some((item) => item.id !== row.id && item.name === text)
          return duplicated ? '已有同名渠道' : null
        },
      },
      {
        key: 'applied',
        header: '参与产出',
        // 作用域名写进说明里：同一个开关在全局层和在方向层改的是两份数据，不说清就会改错地方
        help: `勾上这个渠道才产出变体。当前作用域：${participationScopeLabel}。纯净版是单独一项，在下面。`,
        editor: 'switch',
        width: 88,
        getValue: (row) => selectedMediaIds.includes(row.id),
      },
      {
        key: 'sizeCount',
        header: '尺寸数',
        help: '这个渠道配了几个尺寸（含未启用的）。',
        editor: 'readonly',
        width: 80,
        align: 'end',
        getValue: (row) => row.sizes.length,
      },
      {
        key: 'enabledSizeCount',
        header: '可用尺寸',
        help: '已启用的尺寸数——只有这些会真产出。',
        editor: 'readonly',
        width: 88,
        align: 'end',
        getValue: (row) => row.sizes.filter((size) => size.enabled).length,
      },
      {
        key: 'actions',
        header: '',
        editor: 'readonly',
        width: 52,
        // 「加尺寸」不再挂在这一列：尺寸表里每个渠道自己有一个「+」（就近加到那一行）。
        // 同一个动作在两张表上各有一个入口，只会让人怀疑它们是不是同一件事。
        render: (row) => (
          <span className="flex items-center justify-end">
            <IconButton
              size="sm"
              aria-label={`删除渠道 ${row.name}`}
              icon={<TrashIcon className="h-3.5 w-3.5" />}
              onClick={() => confirmDeleteChannel(row)}
            />
          </span>
        ),
      },
    ],
    [confirmDeleteChannel, media, participationScopeLabel, selectedMediaIds],
  )

  const commitChannel = useCallback(
    (rowId: string, columnKey: string, value: unknown) => {
      if (columnKey === 'name') {
        renameMedia(rowId, String(value ?? ''))
        return
      }
      if (columnKey === 'applied') {
        // 写回哪一层由 `MediaSection` 决定（全局基线 / 这个方向），表格不掺和继承
        onToggleSelected(rowId, value === true)
      }
    },
    [onToggleSelected, renameMedia],
  )

  // ---- 尺寸表 ----
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
      // 先加后删（理由见头注）：最坏是短暂两份，不会丢规格
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
   * 尺寸表：**一行一个渠道，详细尺寸是一组复选框**。
   *
   * 行内排布交给 `flex-wrap` —— 尺寸多的渠道自动折到第二行，
   * 不需要为列宽讨价还价（2026-09-21 反馈：「尽可能排一行，放不下的排两行」）。
   * 每一格 = 「复选框（参与产出）+ 尺寸名（点开改详细参数）+ 体积上限（>0 才显示）」。
   */
  const sizeColumns = useMemo<Array<DataGridColumn<SizeRow>>>(
    () => [
      {
        key: 'name',
        header: '渠道',
        editor: 'readonly',
        width: 140,
        render: (row) => row.name,
      },
      {
        key: 'sizes',
        header: '详细尺寸',
        help: '勾上才会产出这个尺寸。点尺寸名可改宽高、体积上限，或把它移到别的渠道。',
        editor: 'readonly',
        render: (row) => (
          <span className="flex flex-wrap items-center gap-1.5 py-0.5" data-testid={`size-checks-${row.id}`}>
            {row.sizes.length === 0 && <span className="text-xs text-ds-muted dark:text-ds-muted">还没有尺寸</span>}
            {row.sizes.map((size) => (
              <span
                key={size.id}
                className="inline-flex items-center gap-1 rounded-ds-md border border-ds-border px-1.5 py-0.5"
              >
                <Checkbox
                  checked={size.enabled}
                  aria-label={`${row.name} ${size.width}×${size.height} 参与产出`}
                  onChange={(next) => updateMediaSize(row.id, size.id, { enabled: next })}
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
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        editor: 'readonly',
        width: 52,
        render: (row) => (
          <span className="flex justify-end">
            <IconButton
              size="sm"
              aria-label={`给「${row.name}」加一个尺寸`}
              title="加一个尺寸（默认 1024×1024，不做体积压缩）"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                addMediaSize(row.id, DEFAULT_NEW_SIZE)
                setEditingSizeId(buildPostprocessMediaSizeId(row.id, DEFAULT_NEW_SIZE.width, DEFAULT_NEW_SIZE.height))
              }}
            />
          </span>
        ),
      },
    ],
    [addMediaSize, updateMediaSize],
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
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionHeader
          title="渠道"
          description="渠道名与尺寸规格是所有方向共用的一份；「参与产出」决定这个渠道在什么地方投产，跟着左侧作用域走。"
        />
        <DataGrid
          aria-label="渠道表"
          columns={channelColumns}
          rows={channelRows}
          getRowId={(row) => row.id}
          onCellCommit={commitChannel}
          showFieldKeys
          emptyTitle="媒体表为空"
          emptyDescription="没有可产出的渠道。在下面加一个，或恢复内置媒体表。"
        />
        {/*
         * 底对齐：输入框和「添加渠道」都是同一个 40px 控件，底边对齐才不会差半个标签行。
         * 原先 `items-center` 把按钮居中在一个「空 label 仍占 8px 字段内间距」的 48px 盒子里
         * —— 按钮比输入框高 4px（2026-09-22 对齐排查）。用 `flex-end` 对空/非空 label 都成立。
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
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="尺寸"
          description="一行一个渠道：勾选决定这套尺寸参不参与产出，放不下会自动折到第二行；点尺寸名改宽高与体积上限。"
        />
        <DataGrid
          aria-label="尺寸表"
          columns={sizeColumns}
          rows={sizeRows}
          getRowId={(row) => row.id}
          // 三列都是只读（增删改走行内的复选框 / 图标按钮），单元格提交用不上
          onCellCommit={() => undefined}
          emptyTitle="媒体表为空"
          emptyDescription="没有可产出的渠道。先在上面加一个。"
          // 渠道就那么几个，虚拟滚动用不上
          virtualizeThreshold={1000}
        />
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
      </section>
    </div>
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
 * 新的尺寸表每行是一个渠道、格子里是复选框，放不下宽高 / 体积上限这些字段了
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
       *
       * 原先 `align="flex-end"`（底对齐）会让「带说明文字的字段」整体抬高一个标签行：
       * 渠道 / 体积上限 有 helperText，宽 / 高 没有 → 实测（截图量测，缩放 0.756）
       * 标签低 20px、控件低 20px，一屏里出现**两条基线**；而且 宽 一旦进校验错误
       * （多一行红字）整行会再往上跳一次 —— 属「状态一变就对不齐」。
       *
       * 顶对齐后：所有标签一条线、所有控件一条线（控件高度都是 `--ds-control-lg`），
       * 说明 / 错误文字各自往下挂，谁也不牵动谁。
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
