/**
 * 中控台「视频素材」分区：管两个库 —— BGM（背景音乐）与视频水印（MOV / MP4 / 图片）。
 *
 * ## 为什么单独一个分区，不并进「视频」
 *
 * 「视频」分区管的是**参数**（这个方向怎么出片），这里管的是**素材**（有哪些料可用）。
 * 跟「水印」分区（管水印预设库）是同一类比，跟「视频」不是。塞在一起会让那个 tab
 * 变成一张表 + 两个库的大杂烩，而且改参数的人不需要看见素材管理。
 *
 * ## 预览为什么不弹窗
 *
 * 试听 / 预览都在**本分区内就地**给一个播放器：库是一个列表，用户会连着点好几个听，
 * 每次都弹一层窗口再关掉，比就地播放烦得多。视频走引擎转码（H.264 MP4）后读字节播放 ——
 * 拿到的路径不在 `tangbao://` 作用域里，直接丢给 `<video src>` 会被 CSP 的 `media-src` 拦掉。
 *
 * ## 删除是永久删除
 *
 * 走糖包自己的通道（`image-video:library-delete`），不是引擎的回收站那套（ADR-0021）。
 * 所以按钮点下去要过一道确认弹窗，文案里写明不可恢复。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, DataGrid, Inline, Stack, Tabs, TextField } from '../../design-system'
import type { DataGridColumn } from '../../design-system'
import { useStore } from '../../store'
import {
  createVideoLibraryFolder,
  deleteVideoLibraryItems,
  getVideoLibraryDirs,
  importVideoLibraryFiles,
  loadVideoLibrary,
  prepareAudioPreview,
  prepareVideoPreview,
  renameVideoLibraryItem,
  resetVideoLibraryDirsCache,
  type VideoLibraryDirs,
  type VideoLibraryItem,
  type VideoLibraryKind,
  type VideoLibrarySnapshot,
} from './library'

/** 与引擎 `AUDIO_EXTENSIONS` 一致（只是给文件对话框的筛选提示，真正的校验在引擎那边）。 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'aiff']
/** 与引擎 `WATERMARK_EXTENSIONS`（图片 + 视频）一致。 */
const WATERMARK_EXTENSIONS = [
  'mp4',
  'mov',
  'avi',
  'mkv',
  'flv',
  'wmv',
  'webm',
  'm4v',
  'ts',
  'mpg',
  'mpeg',
  '3gp',
  'rmvb',
  'f4v',
  'jpg',
  'jpeg',
  'png',
  'bmp',
  'webp',
  'tiff',
]

interface LibraryRow {
  id: string
  item: VideoLibraryItem
  folderText: string
  durationText: string
  sizeText: string
}

/** 秒 → `mm:ss`；没有时长（图片）给一个破折号。 */
function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function VideoLibrarySection() {
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  const [kind, setKind] = useState<VideoLibraryKind>('bgm')
  const [dirs, setDirs] = useState<VideoLibraryDirs | null>(null)
  const [snapshot, setSnapshot] = useState<VideoLibrarySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 正在试听的素材路径；null = 没在放 */
  const [playingPath, setPlayingPath] = useState<string | null>(null)
  /** 视频预览（就地在下方播放） */
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  /** 新建文件夹的行内输入框内容；`null` = 收起状态（Electron 里 window.prompt 不可用，只能用行内输入）。 */
  const [folderDraft, setFolderDraft] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [libraryDirs, next] = await Promise.all([getVideoLibraryDirs(), loadVideoLibrary()])
      setDirs(libraryDirs)
      setSnapshot(next)
      setNotice(null)
    } catch (error) {
      setNotice(`读不到素材库：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 卸载时收掉正在播放的东西 —— 不然试听中的音频会一直响到进程结束。 */
  useEffect(
    () => () => {
      audioRef.current?.pause()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    },
    [],
  )

  const items = useMemo(() => (kind === 'bgm' ? (snapshot?.bgm ?? []) : (snapshot?.watermark ?? [])), [kind, snapshot])

  const rows: LibraryRow[] = useMemo(
    () =>
      items.map((item) => ({
        id: item.path,
        item,
        folderText: item.folder || '（库根）',
        durationText: formatDuration(item.duration),
        sizeText: formatSize(item.size_bytes),
      })),
    [items],
  )

  const stopAudio = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingPath(null)
  }, [])

  const handlePlay = useCallback(
    async (item: VideoLibraryItem) => {
      if (playingPath === item.path) {
        stopAudio()
        return
      }
      stopAudio()
      setBusy(`正在准备试听：${item.name}`)
      try {
        const previewPath = await prepareAudioPreview(item.path)
        if (!previewPath) throw new Error('引擎没有给出可播放的音频')
        const file = await window.electronAPI?.readFileBuffer?.(previewPath)
        if (!file?.data) throw new Error('读取音频失败')
        const url = URL.createObjectURL(new Blob([file.data], { type: 'audio/mpeg' }))
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = url
        const audio = new Audio(url)
        audio.onended = () => setPlayingPath(null)
        audioRef.current = audio
        await audio.play()
        setPlayingPath(item.path)
      } catch (error) {
        setNotice(`试听失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setBusy(null)
      }
    },
    [playingPath, stopAudio],
  )

  const handlePreviewVideo = useCallback(async (item: VideoLibraryItem) => {
    setBusy(`正在准备预览：${item.name}（大文件转码要等一会儿）`)
    try {
      const previewPath = await prepareVideoPreview(item.path)
      if (!previewPath) throw new Error('引擎没有给出可预览的视频')
      const file = await window.electronAPI?.readFileBuffer?.(previewPath)
      if (!file?.data) throw new Error('读取视频失败')
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous.url)
        return { url: URL.createObjectURL(new Blob([file.data], { type: 'video/mp4' })), name: item.name }
      })
    } catch (error) {
      setNotice(`预览失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(null)
    }
  }, [])

  const handleImport = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.selectFiles) return
    const extensions = kind === 'bgm' ? AUDIO_EXTENSIONS : WATERMARK_EXTENSIONS
    const picked = await api.selectFiles([{ name: kind === 'bgm' ? '音频' : '水印素材（视频 / 图片）', extensions }])
    if (!picked || picked.length === 0) return
    setBusy(`正在导入 ${picked.length} 个文件…`)
    try {
      const results = await importVideoLibraryFiles(kind, picked)
      const imported = results.filter((item) => item.status === 'imported')
      const duplicated = results.filter((item) => item.status === 'duplicate')
      const failed = results.filter((item) => item.status === 'failed')
      // 逐条如实报：重复与失败都要说清是哪个、为什么 —— 静默跳过会被读成「导入坏了」
      const parts = [`导入 ${imported.length} 个`]
      if (duplicated.length > 0) parts.push(`重复跳过 ${duplicated.length} 个（${duplicated[0]?.reason ?? ''}）`)
      if (failed.length > 0) parts.push(`失败 ${failed.length} 个（${failed[0]?.reason ?? ''}）`)
      setNotice(parts.join(' · '))
      showToast(parts.join(' · '), failed.length > 0 ? 'error' : 'success')
      await refresh()
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(null)
    }
  }, [kind, refresh, showToast])

  const submitCreateFolder = useCallback(async () => {
    const name = (folderDraft ?? '').trim()
    if (!name) return
    setBusy('正在建文件夹…')
    try {
      await createVideoLibraryFolder(kind, name)
      setFolderDraft(null)
      await refresh()
    } catch (error) {
      setNotice(`新建文件夹失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(null)
    }
  }, [folderDraft, kind, refresh])

  const handleDelete = useCallback(
    (items: VideoLibraryItem[]) => {
      if (items.length === 0) return
      const names = items.map((item) => item.name).join('、')
      setConfirmDialog({
        title: items.length > 1 ? `删除 ${items.length} 个素材` : '删除素材',
        message: `确定永久删除「${names}」吗？文件会从素材库直接删掉，**不进回收站、不可恢复**。`,
        action: () =>
          void (async () => {
            setBusy('正在删除…')
            try {
              const result = await deleteVideoLibraryItems(items.map((item) => item.path))
              if (result.failed && result.failed.length > 0) {
                setNotice(`有 ${result.failed.length} 个没删掉：${result.failed[0]?.error ?? ''}`)
              }
              await refresh()
            } catch (error) {
              setNotice(`删除失败：${error instanceof Error ? error.message : String(error)}`)
            } finally {
              setBusy(null)
            }
          })(),
      })
    },
    [refresh, setConfirmDialog],
  )

  const handleRename = useCallback(
    async (row: LibraryRow, nextName: string) => {
      const trimmed = nextName.trim()
      if (!trimmed || trimmed === row.item.name) return
      try {
        await renameVideoLibraryItem(kind, row.item.path, trimmed)
        await refresh()
      } catch (error) {
        setNotice(`改名失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [kind, refresh],
  )

  const columns = useMemo<Array<DataGridColumn<LibraryRow>>>(
    () => [
      {
        key: 'name',
        header: '名称',
        help: '直接改这一格就重命名（扩展名保留）',
        editor: 'text',
        width: 240,
      },
      { key: 'folderText', header: '文件夹', editor: 'readonly', width: 130 },
      { key: 'durationText', header: '时长', editor: 'readonly', width: 80, align: 'end' },
      { key: 'sizeText', header: '大小', editor: 'readonly', width: 90, align: 'end' },
      {
        key: 'actions',
        header: '操作',
        editor: 'readonly',
        width: 160,
        render: (row) => (
          <Inline gap={1}>
            {kind === 'bgm' ? (
              <Button variant="ghost" onClick={() => void handlePlay(row.item)}>
                {playingPath === row.item.path ? '停止' : '试听'}
              </Button>
            ) : row.item.type === 'video' ? (
              <Button variant="ghost" onClick={() => void handlePreviewVideo(row.item)}>
                预览
              </Button>
            ) : (
              <span className="text-xs text-ds-muted">图片水印</span>
            )}
            <Button variant="ghost" onClick={() => handleDelete([row.item])}>
              删除
            </Button>
          </Inline>
        ),
      },
    ],
    [handleDelete, handlePlay, handlePreviewVideo, kind, playingPath],
  )

  const handleReveal = useCallback(async () => {
    const target = kind === 'bgm' ? dirs?.bgm : dirs?.watermark
    if (target) await window.electronAPI?.openInExplorer?.(target)
  }, [dirs, kind])

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Inline gap={2} align="center" wrap>
          <span className="text-sm font-medium text-ds-text">视频素材</span>
          <Badge tone="neutral">
            {`BGM ${snapshot?.bgm.length ?? 0} 首 · 水印 ${snapshot?.watermark.length ?? 0} 个`}
          </Badge>
        </Inline>
        <p className="text-xs text-ds-muted">
          两个库都放在糖包库根下（{dirs?.root ?? '…'}），随库搬家与备份一起走。导入是**复制**进来，
          原文件不动；库里已有的相同素材会自动跳过并告诉你。<strong>删除是永久删除，不进回收站。</strong>
        </p>
      </Stack>

      <Tabs
        aria-label="素材库种类"
        size="sm"
        value={kind}
        items={[
          { value: 'bgm', label: `BGM（${snapshot?.bgm.length ?? 0}）` },
          { value: 'watermark', label: `视频水印（${snapshot?.watermark.length ?? 0}）` },
        ]}
        onValueChange={(value) => {
          stopAudio()
          setKind(value as VideoLibraryKind)
        }}
      />

      <Inline gap={2} align="center" wrap>
        <Button onClick={() => void handleImport()} disabled={busy !== null}>
          导入文件…
        </Button>
        <Button
          variant="ghost"
          onClick={() => setFolderDraft((current) => (current === null ? '' : null))}
          disabled={busy !== null}
        >
          {folderDraft === null ? '新建文件夹' : '取消新建'}
        </Button>
        <Button variant="ghost" onClick={() => void handleReveal()} disabled={!dirs}>
          在文件夹里显示
        </Button>
        <Button variant="ghost" onClick={() => void refresh()} disabled={loading || busy !== null}>
          刷新
        </Button>
        {busy ? <span className="text-xs text-ds-muted">{busy}</span> : null}
      </Inline>

      {/* 行内输入而不是弹窗：Electron 渲染进程没有 window.prompt，中控台左树也是同一套做法 */}
      {folderDraft !== null ? (
        <Inline gap={2} align="center" wrap>
          <TextField
            label="新文件夹名"
            value={folderDraft}
            autoFocus
            placeholder={kind === 'bgm' ? '如「轻快」' : '如「角标」'}
            onChange={(event) => setFolderDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitCreateFolder()
              if (event.key === 'Escape') setFolderDraft(null)
            }}
          />
          <Button onClick={() => void submitCreateFolder()} disabled={!folderDraft.trim() || busy !== null}>
            建这个文件夹
          </Button>
        </Inline>
      ) : null}

      <DataGrid
        aria-label={kind === 'bgm' ? 'BGM 素材库' : '视频水印素材库'}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onCellCommit={(rowId, columnKey, value) => {
          if (columnKey !== 'name') return
          const row = rows.find((item) => item.id === rowId)
          if (row) void handleRename(row, String(value ?? ''))
        }}
        emptyTitle={kind === 'bgm' ? '库里还没有音乐' : '库里还没有水印素材'}
        emptyDescription={
          kind === 'bgm'
            ? '点「导入文件…」把 mp3 / wav 等加进来；按文件夹分类后，方向级可以按文件夹选曲。'
            : '点「导入文件…」把 MOV / MP4 / 图片加进来；出片时按视频序号轮转取用。'
        }
      />

      {preview ? (
        <Stack gap={2}>
          <Inline gap={2} align="center">
            <span className="text-xs text-ds-text">预览：{preview.name}</span>
            <Button
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(preview.url)
                setPreview(null)
              }}
            >
              关闭预览
            </Button>
          </Inline>
          {/* 就地播放：src 是 blob:（CSP 的 media-src 放行 blob，不放行 tangbao:） */}
          <video src={preview.url} controls autoPlay className="max-h-[320px] w-full rounded-ds-md bg-black" />
        </Stack>
      ) : null}

      {notice ? <p className="text-xs text-ds-text">{notice}</p> : null}
      {!loading && !dirs ? (
        <p className="text-xs text-ds-muted">
          当前环境不支持视频素材库（需要在桌面应用里使用）。
          <Button
            variant="ghost"
            onClick={() => {
              resetVideoLibraryDirsCache()
              void refresh()
            }}
          >
            重新检测
          </Button>
        </p>
      ) : null}
    </Stack>
  )
}
