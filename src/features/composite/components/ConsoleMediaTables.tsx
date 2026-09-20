/**
 * 中控台 · 「渠道与尺寸」分区的表格本体（TB-060）。
 *
 * 替代原来的「渠道分组卡片 + 折叠式规格编辑器」两套视图：
 * 卡片看板的全部信息（渠道名、启用状态、`N / M 已应用` 计数、参与产出勾选）在这里都有
 * 对应的一列，而规格增删改从「先展开渠道再逐字段点」变成「一行一个规格、点哪格改哪格」。
 * **信息无损失，只是不再需要两套视图来表达同一份数据。**
 *
 * ## 为什么是两张表而不是一张
 *
 * 渠道与尺寸是 1:N。压成一张表就得让渠道名在每行重复出现，而那会被读成
 * 「存在多个同名渠道」——这是会误导人的表达。拆开后尺寸表用「渠道」列做外键，
 * 与导出到 Excel 的 `channels` / `channel_sizes` 两张 Sheet 逐一对应。
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
  Alert,
  Button,
  DataGrid,
  IconButton,
  SectionHeader,
  SelectField,
  TextField,
  type DataGridColumn,
} from '../../../design-system'
import { PlusIcon, TrashIcon } from '../../../design-system/icons'
import { useStore } from '../../../store'
import { buildPostprocessMediaSizeId, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import {
  PURE_MEDIA_ID,
  resolveOutputDirection,
  type PostprocessMedia,
  type PostprocessMediaSize,
} from '../../../lib/postprocessMedia'

/** 尺寸行 = 尺寸本身 + 它属于哪个渠道（外键，导出时就是 channel_sizes.mediaId 那一列）。 */
interface SizeRow extends PostprocessMediaSize {
  mediaId: string
}

const DIRECTION_LABELS = {
  landscape: '横版',
  portrait: '竖版',
  square: '方形',
} as const

export function ConsoleMediaTables() {
  const media = usePostprocessMediaStore((state) => state.media)
  const selectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const setSelectedMediaIds = usePostprocessMediaStore((state) => state.setSelectedMediaIds)
  const renameMedia = usePostprocessMediaStore((state) => state.renameMedia)
  const setMediaEnabled = usePostprocessMediaStore((state) => state.setMediaEnabled)
  const deleteMedia = usePostprocessMediaStore((state) => state.deleteMedia)
  const addMedia = usePostprocessMediaStore((state) => state.addMedia)
  const addMediaSize = usePostprocessMediaStore((state) => state.addMediaSize)
  const updateMediaSize = usePostprocessMediaStore((state) => state.updateMediaSize)
  const deleteMediaSize = usePostprocessMediaStore((state) => state.deleteMediaSize)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  const [newChannelName, setNewChannelName] = useState('')
  const [newSizeChannelId, setNewSizeChannelId] = useState('')

  /** 纯净版不是渠道（它不产渠道变体），规格表里不出现——它的「尺寸」概念也不同。 */
  const channelRows = useMemo(() => media.filter((item) => item.id !== PURE_MEDIA_ID), [media])

  const sizeRows = useMemo<SizeRow[]>(
    () => media.flatMap((item) => item.sizes.map((size) => ({ ...size, mediaId: item.id }))),
    [media],
  )

  const channelOptions = useMemo(() => channelRows.map((item) => ({ value: item.id, label: item.name })), [channelRows])

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
        help: '勾上这个渠道才产出变体。纯净版是单独一项，在下面。',
        editor: 'switch',
        width: 88,
        getValue: (row) => selectedMediaIds.includes(row.id),
      },
      {
        key: 'enabled',
        header: '启用',
        help: '停用后这个渠道整体不参与产出，即使勾了「参与产出」。',
        editor: 'switch',
        width: 72,
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
        width: 104,
        render: (row) => (
          <span className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNewSizeChannelId(row.id)
                addMediaSize(row.id, { width: 1024, height: 1024, maxSizeKb: 0, enabled: true })
              }}
            >
              加尺寸
            </Button>
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
    [addMediaSize, confirmDeleteChannel, media, selectedMediaIds],
  )

  const commitChannel = useCallback(
    (rowId: string, columnKey: string, value: unknown) => {
      if (columnKey === 'name') {
        renameMedia(rowId, String(value ?? ''))
        return
      }
      if (columnKey === 'enabled') {
        setMediaEnabled(rowId, value === true)
        return
      }
      if (columnKey === 'applied') {
        const next = selectedMediaIds.filter((id) => id !== rowId)
        setSelectedMediaIds(value === true ? [...next, rowId] : next)
      }
    },
    [renameMedia, selectedMediaIds, setMediaEnabled, setSelectedMediaIds],
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
    (row: SizeRow) => {
      const channelName = media.find((item) => item.id === row.mediaId)?.name ?? row.mediaId
      setConfirmDialog({
        title: `删除「${channelName} ${row.width}×${row.height}」？`,
        message: '删除后这个尺寸不再产出。已产出的文件不会被删除。',
        confirmText: '删除',
        cancelText: '取消',
        tone: 'danger',
        action: () => deleteMediaSize(row.mediaId, row.id),
      })
    },
    [deleteMediaSize, media, setConfirmDialog],
  )

  const sizeColumns = useMemo<Array<DataGridColumn<SizeRow>>>(
    () => [
      {
        key: 'mediaId',
        header: '渠道',
        help: '改这一列 = 把这个尺寸移到另一个渠道。',
        editor: 'select',
        options: channelOptions,
        width: 140,
      },
      {
        key: 'width',
        header: '宽',
        help: '正整数。改了宽高等于换了一个规格（尺寸主键由渠道 + 宽高派生）。',
        editor: 'number',
        width: 88,
        align: 'end',
        validate: (value) => (typeof value === 'number' && value > 0 ? null : '宽需要正整数'),
      },
      {
        key: 'height',
        header: '高',
        editor: 'number',
        width: 88,
        align: 'end',
        validate: (value) => (typeof value === 'number' && value > 0 ? null : '高需要正整数'),
      },
      {
        key: 'maxSizeKb',
        header: '体积上限 KB',
        help: '0 表示不做体积压缩（不是「无限」的同义词）。',
        editor: 'number',
        width: 116,
        align: 'end',
        validate: (value) => {
          if (value === undefined) return null
          return typeof value === 'number' && value >= 0 ? null : '需要一个 ≥ 0 的数字'
        },
      },
      {
        key: 'direction',
        header: '画面方向',
        help: '由宽高推导，不单独存——存了就会与宽高不一致。',
        editor: 'readonly',
        width: 88,
        getValue: (row) => DIRECTION_LABELS[resolveOutputDirection(row.width, row.height)],
      },
      {
        key: 'enabled',
        header: '启用',
        editor: 'switch',
        width: 72,
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
              aria-label={`删除尺寸 ${row.width}x${row.height}`}
              icon={<TrashIcon className="h-3.5 w-3.5" />}
              onClick={() => confirmDeleteSize(row)}
            />
          </span>
        ),
      },
    ],
    [channelOptions, confirmDeleteSize],
  )

  const commitSize = useCallback(
    (rowId: string, columnKey: string, value: unknown) => {
      const row = sizeRows.find((item) => item.id === rowId)
      if (!row) return
      if (columnKey === 'mediaId') {
        moveSize(rowId, row.mediaId, String(value ?? ''))
        return
      }
      if (columnKey === 'enabled') {
        updateMediaSize(row.mediaId, rowId, { enabled: value === true })
        return
      }
      if (columnKey === 'width') {
        updateMediaSize(row.mediaId, rowId, { width: Number(value) })
        return
      }
      if (columnKey === 'height') {
        updateMediaSize(row.mediaId, rowId, { height: Number(value) })
        return
      }
      if (columnKey === 'maxSizeKb') {
        updateMediaSize(row.mediaId, rowId, { maxSizeKb: value === undefined ? 0 : Number(value) })
      }
    },
    [moveSize, sizeRows, updateMediaSize],
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

  const handleAddSize = () => {
    const channelId = newSizeChannelId || channelRows[0]?.id
    if (!channelId) {
      showToast('先添加一个渠道', 'error')
      return
    }
    addMediaSize(channelId, { width: 1024, height: 1024, maxSizeKb: 0, enabled: true })
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionHeader
          title="渠道"
          description="渠道与尺寸是全局共享规格：所有方向按同一张表产出，方向层只能决定参不参与。"
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
        <div className="flex items-center gap-2">
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
          <Button variant="secondary" disabled={!newChannelName.trim()} onClick={handleAddChannel}>
            <PlusIcon className="h-3.5 w-3.5" />
            添加渠道
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="尺寸"
          description="一行一个规格。改「渠道」列即把该规格移到另一个渠道；改宽高等于换一个规格主键。"
        />
        {sizeRows.length === 0 && <Alert tone="info">还没有尺寸。渠道配了尺寸才会产出变体。</Alert>}
        <DataGrid
          aria-label="尺寸表"
          columns={sizeColumns}
          rows={sizeRows}
          getRowId={(row) => row.id}
          onCellCommit={commitSize}
        />
        <div className="flex items-end gap-2">
          <SelectField
            label=""
            aria-label="新尺寸所属渠道"
            containerClassName="w-48"
            value={newSizeChannelId || channelRows[0]?.id || ''}
            options={channelOptions}
            onChange={(event) => setNewSizeChannelId(event.target.value)}
          />
          <Button variant="secondary" disabled={channelRows.length === 0} onClick={handleAddSize}>
            <PlusIcon className="h-3.5 w-3.5" />
            添加尺寸
          </Button>
          <span className="text-xs text-ds-muted dark:text-ds-muted">新尺寸默认 1024×1024、不做体积压缩。</span>
        </div>
      </section>
    </div>
  )
}

export default ConsoleMediaTables
