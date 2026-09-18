import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  CopyIcon as Copy,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import {
  PRESET_GROUP_DRAG_TYPE as GROUP_DRAG_TYPE,
  PRESET_LIBRARY_DRAG_TYPE as LIBRARY_PRESET_DRAG_TYPE,
  filterPresetsForLibrary,
} from '../lib/compositePresetLibrary'
import type { CompositeFsImage } from '../lib/compositeTypes'
import {
  dataUrlToCompositeBlob,
  getCompositeAssetObjectUrl,
  isCompositeAssetReferenced,
  removeCompositeAsset,
  storeCompositeBlobs,
} from '../lib/compositeAssets'
import { useCompositeV2Store } from '../storeV2'
import { useStore } from '../../../store'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'
import { PresetCanvasEditor } from './PresetCanvasEditor'
import { PresetLayerPanel } from './PresetLayerPanel'
import { PresetProjectTree } from './PresetProjectTree'
import { useAppDialog } from '../../../hooks/useAppDialog'

const PRESET_BASE_SIZES = [
  { value: '1280x720', label: '1280×720', width: 1280, height: 720 },
  { value: '1080x1920', label: '1080×1920', width: 1080, height: 1920 },
  { value: '800x800', label: '800×800', width: 800, height: 800 },
] as const

export function PresetManagementTab() {
  const store = useCompositeV2Store()
  const { openConfirmDialog, openInfoDialog } = useAppDialog()
  const [query, setQuery] = useState('')
  const [logoStatusText, setLogoStatusText] = useState('支持拖拽添加 LOGO。')
  const [isRefreshingLogos, setIsRefreshingLogos] = useState(false)
  const [logoObjectUrls, setLogoObjectUrls] = useState<Record<string, string>>({})
  const [selectedLayerId, setSelectedLayerId] = useState('')
  const [editingGroupId, setEditingGroupId] = useState('')
  const [editingGroupName, setEditingGroupName] = useState('')
  const [draggingGroupId, setDraggingGroupId] = useState('')
  const [editingPresetId, setEditingPresetId] = useState('')
  const [editingPresetName, setEditingPresetName] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [draggingLibraryPresetId, setDraggingLibraryPresetId] = useState('')
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)

  const toggleGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  /** 读回上次拖的分隔条比例。越界或坏值一律回退默认，不让一次坏写把左栏挤成一条线。 */
  function readStoredSplit(key: string, fallback: number) {
    try {
      const saved = localStorage.getItem(key)
      if (saved) {
        const val = parseFloat(saved)
        if (Number.isFinite(val) && val >= 20 && val <= 80) return val
      }
    } catch {}
    return fallback
  }

  const [librarySplit, setLibrarySplit] = useState(() => readStoredSplit('tangbao-composite-library-split', 50))
  const [treeSplit, setTreeSplit] = useState(() => readStoredSplit('tangbao-composite-tree-split', 45))
  const resizingLibraryRef = useRef(false)
  const resizingTreeRef = useRef(false)

  const sortedLogoAssets = useMemo(() => {
    const assets =
      store.projectLogos?.map((logo) => ({
        path: logo.id, // Use ID as path to satisfy CompositeFsImage interface
        name: logo.name,
        dataUrl: logo.assetId ? logoObjectUrls[logo.assetId] : logo.dataUrl,
      })) || []

    if (!store.logoOrder || store.logoOrder.length === 0) return assets
    const orderMap = new Map(store.logoOrder.map((id, index) => [id, index]))
    return [...assets].sort((a, b) => {
      const indexA = orderMap.get(a.path) ?? Infinity
      const indexB = orderMap.get(b.path) ?? Infinity
      return indexA - indexB
    })
  }, [logoObjectUrls, store.projectLogos, store.logoOrder])

  useEffect(() => {
    let active = true
    const logos = store.projectLogos.filter((logo) => logo.assetId)
    void Promise.all(
      logos.map(
        async (logo) => [logo.assetId!, await getCompositeAssetObjectUrl(logo.assetId!).catch(() => null)] as const,
      ),
    ).then((entries) => {
      if (!active) return
      setLogoObjectUrls(
        Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))),
      )
    })
    return () => {
      active = false
    }
  }, [store.projectLogos])

  useEffect(() => {
    try {
      localStorage.setItem('tangbao-composite-library-split', String(librarySplit))
    } catch {}
  }, [librarySplit])

  useEffect(() => {
    try {
      localStorage.setItem('tangbao-composite-tree-split', String(treeSplit))
    } catch {}
  }, [treeSplit])

  const visiblePresets = useMemo(
    () =>
      filterPresetsForLibrary(store.presets, store.presetGroups, {
        query,
      }),
    [query, store.presetGroups, store.presets],
  )
  const activePreset = store.presets.find((preset) => preset.id === store.selectedPreviewPresetId) ?? null
  useEffect(() => {
    if (!activePreset && visiblePresets[0]) setSelectedPreviewPresetId(visiblePresets[0].id)
  }, [activePreset, setSelectedPreviewPresetId, visiblePresets])

  useEffect(() => {
    if (!activePreset?.layers.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(activePreset?.layers[0]?.id ?? '')
    }
  }, [activePreset, selectedLayerId])

  // Removed file system load logos code, as it's no longer used
  // async function ensureDefaultLogoLibraryPath() ...
  // async function loadLogos(path: string) ...

  async function chooseLogoFolder() {
    // 增加对环境支持的提示
    if (!window.electronAPI) {
      openInfoDialog({ title: '当前环境不支持', message: '请在桌面客户端中选择本地文件。' })
      return
    }
    if (!window.electronAPI.selectFiles) {
      openInfoDialog({ title: '文件选择尚未就绪', message: '请重启应用后再试。' })
      return
    }

    const paths = await window.electronAPI.selectFiles([
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
    ])
    if (paths && paths.length > 0) {
      let imported = 0
      const names: string[] = []
      const blobs: Blob[] = []
      for (const path of paths) {
        try {
          const fileName = path.split(/[\\/]/).pop() || 'logo.png'
          const payload = await window.electronAPI.readImageFile(path)
          if (payload?.dataUrl) {
            names.push(fileName)
            blobs.push(await dataUrlToCompositeBlob(payload.dataUrl))
            imported++
          }
        } catch (e) {
          console.error('Failed to import logo:', e)
        }
      }
      if (imported > 0) {
        try {
          const assetIds = await storeCompositeBlobs(blobs)
          store.addProjectLogos(
            names.map((name, index) => ({
              id: `logo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name,
              assetId: assetIds[index]!,
            })),
          )
          useStore.getState().showToast(`已导入 ${imported} 个 LOGO`, 'success')
        } catch (error) {
          console.error('存储 LOGO 失败:', error)
          useStore.getState().showToast('导入失败：所选文件均无法读取，或存储失败', 'error')
        }
      } else {
        useStore.getState().showToast('导入失败：所选文件均无法读取，或存储失败', 'error')
      }
    }
  }

  async function importLogoFiles(files: FileList) {
    let imported = 0
    const names: string[] = []
    const blobs: Blob[] = []

    for (const file of Array.from(files)) {
      try {
        names.push(file.name)
        blobs.push(file)
        imported++
      } catch (e) {
        console.error('Failed to import logo:', e)
      }
    }
    if (imported > 0) {
      try {
        const assetIds = await storeCompositeBlobs(blobs)
        store.addProjectLogos(
          names.map((name, index) => ({
            id: `logo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            assetId: assetIds[index]!,
          })),
        )
        useStore.getState().showToast(`已导入 ${imported} 个 LOGO`, 'success')
      } catch (error) {
        console.error('导入 LOGO 失败:', error)
        useStore.getState().showToast('导入失败，部分文件无法读取', 'error')
      }
    }
  }

  async function deleteLogoAsset(asset: CompositeFsImage) {
    const logo = useCompositeV2Store.getState().projectLogos.find((item) => item.id === asset.path)
    store.removeProjectLogo(asset.path)
    if (!logo?.assetId) {
      useStore.getState().showToast(`已删除 LOGO「${asset.name}」`, 'success')
      return
    }
    const latest = useCompositeV2Store.getState()
    if (!isCompositeAssetReferenced(latest, logo.assetId)) {
      try {
        await removeCompositeAsset(logo.assetId)
      } catch (error) {
        console.error('删除后期处理资源失败:', error)
        useStore.getState().showToast('删除 LOGO 资源失败，请重试', 'error')
        return
      }
    }
    useStore.getState().showToast(`已删除 LOGO「${asset.name}」`, 'success')
  }

  async function renameLogoAsset(asset: CompositeFsImage, newName: string) {
    store.renameProjectLogo(asset.path, newName)
    useStore.getState().showToast(`已重命名为「${newName}」`, 'success')
  }

  function createPresetGroup() {
    store.createPresetGroup('新预设组')
    const createdId = useCompositeV2Store.getState().selectedPresetGroupId
    setEditingGroupId(createdId)
    setEditingGroupName(useCompositeV2Store.getState().presetGroups.find((group) => group.id === createdId)?.name ?? '')
    useStore.getState().showToast('已创建预设组，输入名称回车保存', 'success')
  }

  function beginGroupRename(groupId: string, name: string) {
    setEditingGroupId(groupId)
    setEditingGroupName(name)
  }

  function finishGroupRename() {
    if (editingGroupId) {
      store.renamePresetGroup(editingGroupId, editingGroupName)
      useStore.getState().showToast(`已重命名为「${editingGroupName}」`, 'success')
    }
    setEditingGroupId('')
    setEditingGroupName('')
  }

  function beginPresetRename(presetId: string, name: string) {
    setEditingPresetId(presetId)
    setEditingPresetName(name)
  }

  function finishPresetRename() {
    if (editingPresetId) {
      store.updatePreset(editingPresetId, { name: editingPresetName })
      useStore.getState().showToast(`已重命名为「${editingPresetName}」`, 'success')
    }
    setEditingPresetId('')
    setEditingPresetName('')
  }

  /** 按指针位置换算上栏占比。host 传分隔条的父容器（被分割的那个网格）。 */
  function computeSplit(clientY: number, host: HTMLElement | null) {
    if (!host) return null
    const rect = host.getBoundingClientRect()
    if (rect.height <= 0) return null
    return Math.max(20, Math.min(80, ((clientY - rect.top) / rect.height) * 100))
  }

  function resizeLibraryPanes(clientY: number, host: HTMLElement | null) {
    if (!resizingLibraryRef.current) return
    const next = computeSplit(clientY, host)
    if (next !== null) setLibrarySplit(next)
  }

  function resizeTreePane(clientY: number, host: HTMLElement | null) {
    if (!resizingTreeRef.current) return
    const next = computeSplit(clientY, host)
    if (next !== null) setTreeSplit(next)
  }

  /**
   * 分隔条的指针事件三件套。抽出来是因为左栏现在有两根（树 / 预设组 / 预设库），
   * 复制两份的话「谁 setPointerCapture、谁 release」很容易只改一处。
   * `activeRef` 是「正在拖」的标记：没有它，鼠标只是划过分隔条也会改尺寸。
   */
  function resizerProps(
    dataLayout: string,
    activeRef: React.MutableRefObject<boolean>,
    resize: (clientY: number, host: HTMLElement | null) => void,
  ) {
    return {
      'data-layout': dataLayout,
      role: 'separator' as const,
      'aria-orientation': 'horizontal' as const,
      tabIndex: 0,
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        activeRef.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        resize(event.clientY, event.currentTarget.parentElement)
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        resize(event.clientY, event.currentTarget.parentElement)
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        activeRef.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      },
    }
  }

  function selectNewestLayer(presetId: string) {
    const latestPreset = useCompositeV2Store.getState().presets.find((preset) => preset.id === presetId)
    const newestLayerId = latestPreset?.layers.at(-1)?.id ?? ''
    if (newestLayerId) setSelectedLayerId(newestLayerId)
  }

  function handleAddTextLayer() {
    if (!activePreset) return
    store.addTextLayer(activePreset.id)
    selectNewestLayer(activePreset.id)
    useStore.getState().showToast('已添加文字图层', 'success')
  }

  function handleAddImageLayer() {
    if (!activePreset) return
    store.addImageLayer(activePreset.id)
    selectNewestLayer(activePreset.id)
    useStore.getState().showToast('已添加图片图层', 'success')
  }

  function handleAddLogoLayer() {
    if (!activePreset) return
    store.addLogoLayer(activePreset.id)
    selectNewestLayer(activePreset.id)
    useStore.getState().showToast('已添加 LOGO 图层', 'success')
  }

  return (
    <div
      data-layout="preset-management-workspace"
      className="grid h-full min-h-0 min-w-[1180px] flex-1 grid-cols-[260px_280px_minmax(0,1fr)] overflow-hidden border border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim"
    >
      {/* 左栏：水印归属树 + 预设组 + 预设库。树必须在最上且常驻——
          绑定的主要动作是「从下方预设库拖到某个方向」，两者不同屏就做不成。 */}
      <div
        data-layout="preset-rail"
        className="grid min-h-0 overflow-hidden border-r border-ds-border dark:border-ds-border"
        style={{ gridTemplateRows: `${treeSplit}% 5px minmax(0, 1fr)` }}
      >
        <PresetProjectTree />

        <div
          {...resizerProps('tree-resizer', resizingTreeRef, resizeTreePane)}
          className="cursor-row-resize border-y border-ds-border bg-ds-surface hover:bg-ds-primary-subtle dark:border-ds-border dark:bg-ds-scrim dark:hover:bg-ds-primary/10"
        />

        <div
          data-layout="stacked-library-rail"
          className="grid min-h-0 overflow-hidden"
          style={{ gridTemplateRows: `${librarySplit}% 5px minmax(0, 1fr)` }}
        >
          <section className="flex min-h-0 flex-col overflow-hidden bg-ds-surface dark:bg-ds-scrim">
            <header className="flex items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border">
              <div>
                <h2 className="text-sm font-semibold">预设组</h2>
                <p className="text-xs text-ds-muted">{store.presetGroups.length} 个分组</p>
              </div>
              <button
                type="button"
                title="新建预设组"
                onClick={createPresetGroup}
                className="inline-flex h-ds-control-sm w-ds-control-sm items-center justify-center rounded-md border border-ds-border dark:border-ds-border"
              >
                <Plus className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {store.presetGroups.map((group) => {
                const selected = group.id === store.selectedPresetGroupId
                const editing = group.id === editingGroupId
                return (
                  <div
                    key={group.id}
                    data-preset-group-id={group.id}
                    draggable={!editing}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      ;(event.dataTransfer as { setData?: (type: string, value: string) => void }).setData?.(
                        GROUP_DRAG_TYPE,
                        group.id,
                      )
                      setDraggingGroupId(group.id)
                    }}
                    onDragEnd={() => setDraggingGroupId('')}
                    onDragOver={(event) => {
                      const transfer = event.dataTransfer as
                        { types?: readonly string[]; dropEffect?: string } | undefined
                      const types = Array.from(transfer?.types ?? [])
                      if (types.includes(GROUP_DRAG_TYPE) || types.includes(LIBRARY_PRESET_DRAG_TYPE)) {
                        event.preventDefault()
                        if (transfer) transfer.dropEffect = types.includes(LIBRARY_PRESET_DRAG_TYPE) ? 'copy' : 'move'
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const transfer = event.dataTransfer as { getData?: (type: string) => string } | undefined
                      const draggedPresetId = transfer?.getData?.(LIBRARY_PRESET_DRAG_TYPE) ?? ''
                      if (draggedPresetId) {
                        store.addPresetToGroup(draggedPresetId, group.id)
                        const draggedPreset = store.presets.find((p) => p.id === draggedPresetId)
                        useStore
                          .getState()
                          .showToast(
                            `已将预设「${draggedPreset?.name ?? draggedPresetId}」添加到组「${group.name}」`,
                            'success',
                          )
                        setDraggingLibraryPresetId('')
                        return
                      }
                      const draggedGroupId = transfer?.getData?.(GROUP_DRAG_TYPE) || draggingGroupId
                      if (draggedGroupId) {
                        store.movePresetGroup(
                          draggedGroupId,
                          store.presetGroups.findIndex((item) => item.id === group.id),
                        )
                        useStore.getState().showToast('已调整预设组顺序', 'success')
                      }
                      setDraggingGroupId('')
                    }}
                    className={`rounded-md ${editing ? '' : 'cursor-grab active:cursor-grabbing'} ${draggingGroupId === group.id ? 'opacity-50' : ''} ${selected && !editing ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary' : ''}`}
                  >
                    {editing ? (
                      <input
                        autoFocus
                        aria-label={`重命名预设组 ${group.name}`}
                        value={editingGroupName}
                        onChange={(event) => setEditingGroupName(event.target.value)}
                        onBlur={finishGroupRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            finishGroupRename()
                          } else if (event.key === 'Escape') {
                            setEditingGroupId('')
                            setEditingGroupName('')
                          }
                        }}
                        className="m-2 w-[calc(100%-1rem)] rounded border border-ds-primary/35 bg-ds-surface px-2 py-1 text-sm text-ds-text outline-none dark:bg-ds-scrim dark:text-ds-text-subtle"
                      />
                    ) : (
                      <div className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm group">
                        <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => toggleGroup(group.id, e)}
                            className="p-0.5 text-ds-muted hover:text-ds-muted dark:hover:text-ds-text shrink-0"
                          >
                            {expandedGroups.has(group.id) ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0"
                            aria-pressed={selected}
                            onClick={() => store.setSelectedPresetGroup(group.id)}
                            onDoubleClick={() => beginGroupRename(group.id, group.name)}
                          >
                            {expandedGroups.has(group.id) ? (
                              <FolderOpen className="h-4 w-4 shrink-0 text-ds-primary" />
                            ) : (
                              <Folder className="h-4 w-4 shrink-0 text-ds-primary" />
                            )}
                            <span className="truncate">{group.name}</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 pl-2">
                          {selected && (
                            <div className="flex items-center gap-0.5 mr-1">
                              <button
                                type="button"
                                title="添加当前选中预设到组"
                                disabled={
                                  !store.selectedPreviewPresetId ||
                                  group.presetIds.includes(store.selectedPreviewPresetId)
                                }
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (!store.selectedPreviewPresetId) return
                                  store.addPresetToGroup(store.selectedPreviewPresetId, group.id)
                                  useStore
                                    .getState()
                                    .showToast(
                                      `已添加预设「${activePreset?.name ?? '未命名预设'}」到组「${group.name}」`,
                                      'success',
                                    )
                                }}
                                className="cursor-pointer p-1 text-ds-muted hover:bg-ds-subtle rounded disabled:cursor-not-allowed disabled:opacity-30 dark:text-ds-muted dark:hover:bg-ds-subtle"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="复制组"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  store.duplicatePresetGroup(group.id)
                                  useStore.getState().showToast(`已复制预设组「${group.name}」`, 'success')
                                }}
                                className="cursor-pointer p-1 text-ds-primary hover:bg-ds-primary-subtle rounded dark:text-ds-primary dark:hover:bg-ds-primary/20"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="删除组"
                                disabled={store.presetGroups.length <= 1}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openConfirmDialog({
                                    title: '删除预设组？',
                                    message: `将删除预设组「${group.name}」，组内预设不会被删除。`,
                                    confirmText: '确认删除',
                                    tone: 'danger',
                                    action: () => {
                                      store.deletePresetGroup(group.id)
                                      useStore.getState().showToast(`已删除预设组「${group.name}」`, 'success')
                                    },
                                  })
                                }}
                                className="cursor-pointer p-1 text-ds-danger hover:bg-ds-danger-subtle rounded disabled:cursor-not-allowed disabled:opacity-30 dark:text-ds-danger dark:hover:bg-ds-danger/20"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          <span className="text-xs opacity-70 w-4 text-right">{group.presetIds.length}</span>
                        </div>
                      </div>
                    )}
                    {expandedGroups.has(group.id) && !editing && (
                      <div className="pl-6 pr-2 py-1 space-y-0.5">
                        {group.presetIds.map((presetId) => {
                          const preset = store.presets.find((p) => p.id === presetId)
                          if (!preset) return null
                          const isPresetSelected = preset.id === store.selectedPreviewPresetId
                          return (
                            <div
                              key={preset.id}
                              className={`group/item flex items-center gap-1 rounded-md px-2 py-1.5 text-xs ${isPresetSelected ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/20 dark:text-ds-primary' : 'hover:bg-ds-subtle dark:hover:bg-ds-subtle'}`}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  store.setSelectedPresetGroup(group.id)
                                  store.setSelectedPreviewPresetId(preset.id)
                                }}
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0 opacity-50" />
                                <span className="truncate">{preset.name}</span>
                              </button>
                              <button
                                type="button"
                                title="从组中移除预设"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  store.removePresetFromGroup(preset.id, group.id)
                                  useStore.getState().showToast(`已将预设「${preset.name}」移出组`, 'success')
                                }}
                                className="p-1 text-ds-danger opacity-0 transition group-hover/item:opacity-100 hover:bg-ds-danger-subtle rounded dark:text-ds-danger dark:hover:bg-ds-danger/20"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <div
            {...resizerProps('rail-resizer', resizingLibraryRef, resizeLibraryPanes)}
            aria-valuenow={Math.round(librarySplit)}
            className="cursor-row-resize border-y border-ds-border bg-ds-surface hover:bg-ds-primary-subtle dark:border-ds-border dark:bg-ds-scrim dark:hover:bg-ds-primary/10"
          />

          <section className="min-h-0 flex flex-col overflow-hidden bg-ds-surface dark:bg-ds-scrim">
            <header className="flex items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border shrink-0">
              <h2 className="text-sm font-semibold">全局水印预设库</h2>
              <button
                type="button"
                title="新建预设"
                onClick={() => {
                  store.createPreset('新预设')
                  useStore.getState().showToast('已创建预设', 'success')
                }}
                className="inline-flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded-md border border-ds-border dark:border-ds-border hover:bg-ds-subtle dark:hover:bg-ds-subtle"
              >
                <Plus className="h-4 w-4" />
              </button>
            </header>
            <div className="p-3 shrink-0">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="按名称搜索"
                aria-label="搜索预设"
                className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-sm dark:border-ds-border dark:bg-ds-scrim"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-0.5 px-2 pb-2">
              {visiblePresets.map((preset) => (
                <div
                  key={preset.id}
                  draggable={editingPresetId !== preset.id}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy'
                    ;(event.dataTransfer as { setData?: (type: string, value: string) => void }).setData?.(
                      LIBRARY_PRESET_DRAG_TYPE,
                      preset.id,
                    )
                    setDraggingLibraryPresetId(preset.id)
                  }}
                  onDragEnd={() => setDraggingLibraryPresetId('')}
                  className={`group relative rounded-md px-2 py-1.5 transition-colors ${preset.id === store.selectedPreviewPresetId ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary' : 'hover:bg-ds-subtle dark:hover:bg-ds-subtle'} ${draggingLibraryPresetId === preset.id ? 'opacity-50' : ''}`}
                >
                  {editingPresetId === preset.id ? (
                    <input
                      autoFocus
                      value={editingPresetName}
                      onChange={(e) => setEditingPresetName(e.target.value)}
                      onBlur={finishPresetRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          finishPresetRename()
                        }
                        if (e.key === 'Escape') {
                          setEditingPresetId('')
                          setEditingPresetName('')
                        }
                      }}
                      className="w-full rounded border border-ds-primary/35 bg-ds-surface px-2 py-0.5 text-ds-sm text-ds-text outline-none dark:bg-ds-scrim dark:text-ds-text-subtle"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-pressed={preset.id === store.selectedPreviewPresetId}
                        onClick={() => store.setSelectedPreviewPresetId(preset.id)}
                        onDoubleClick={() => beginPresetRename(preset.id, preset.name)}
                        className="flex min-w-0 flex-1 items-center justify-between text-left"
                      >
                        <div className="truncate font-medium text-ds-sm">{preset.name}</div>
                        <div className="ml-2 shrink-0 text-xs opacity-70">
                          {preset.layers.length}层 · {preset.baseCanvas.width}x{preset.baseCanvas.height}
                        </div>
                      </button>
                      {preset.id === store.selectedPreviewPresetId && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            title="复制为新预设"
                            onClick={() => {
                              store.duplicatePreset(preset.id)
                              useStore.getState().showToast(`已复制为新预设「${preset.name}」`, 'success')
                            }}
                            className="cursor-pointer p-1 text-ds-primary hover:bg-ds-primary-subtle rounded-md dark:text-ds-primary dark:hover:bg-ds-primary/20"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="删除预设"
                            onClick={() =>
                              openConfirmDialog({
                                title: '删除预设？',
                                message: `将永久删除预设「${preset.name}」。`,
                                confirmText: '确认删除',
                                tone: 'danger',
                                action: () => {
                                  store.deletePreset(preset.id)
                                  useStore.getState().showToast(`已删除预设「${preset.name}」`, 'success')
                                },
                              })
                            }
                            className="cursor-pointer p-1 text-ds-danger hover:bg-ds-danger-subtle rounded-md dark:text-ds-danger dark:hover:bg-ds-danger/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="flex min-h-0 flex-col border-r border-ds-border bg-ds-surface/30 dark:border-ds-border dark:bg-ds-scrim/10">
        <header className="flex items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border shrink-0">
          <h2 className="text-sm font-semibold">预设详情</h2>
          {activePreset && (
            <span className="text-sm text-ds-muted font-medium truncate max-w-[150px]">{activePreset.name}</span>
          )}
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {activePreset ? (
            <div className="divide-y divide-gray-200 dark:divide-white/[0.08]">
              {/* 基本设置 */}
              <div className="space-y-4 pb-4">
                <label className="block text-xs font-medium text-ds-muted">
                  基准尺寸
                  <select
                    aria-label="基准尺寸"
                    value={`${activePreset.baseCanvas.width}x${activePreset.baseCanvas.height}`}
                    onChange={(event) => {
                      const selected = PRESET_BASE_SIZES.find((size) => size.value === event.target.value)
                      if (selected) {
                        store.updatePreset(activePreset.id, {
                          baseCanvas: { width: selected.width, height: selected.height },
                        })
                      }
                    }}
                    className="mt-1 w-full cursor-pointer rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-sm dark:border-ds-border dark:bg-ds-scrim"
                  >
                    {PRESET_BASE_SIZES.map((size) => (
                      <option key={size.value} value={size.value}>
                        {size.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ds-muted">请在左侧选择一个预设</div>
          )}
        </div>
      </div>

      <div
        data-layout="editor-shell"
        className="grid min-h-0 grid-cols-[minmax(0,1fr)_288px] grid-rows-[minmax(0,1fr)_280px] overflow-hidden"
      >
        <div data-layout="canvas-pane" className="min-h-0 overflow-hidden">
          <PresetCanvasEditor
            preset={activePreset}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            onAddText={handleAddTextLayer}
            onAddImage={handleAddImageLayer}
            onAddLogo={handleAddLogoLayer}
            onUpdatePreset={(patch) => activePreset && store.updatePreset(activePreset.id, patch)}
          />
        </div>

        <div className="min-h-0 overflow-hidden border-l border-ds-border dark:border-ds-border">
          <FloatingLogoLibrary
            variant="sidebar"
            path={store.logoLibraryPath}
            assets={sortedLogoAssets}
            statusText={logoStatusText}
            isRefreshing={isRefreshingLogos}
            assetsDisabled={!activePreset}
            assetDisabledReason="请先选择预设以插入该 LOGO"
            onSelectFolder={() => void chooseLogoFolder()}
            onRefresh={() => {}}
            onDeleteAsset={deleteLogoAsset}
            onRenameAsset={renameLogoAsset}
            onReorderAssets={(newAssets) => {
              store.setLogoOrder(newAssets.map((a) => a.path))
              useStore.getState().showToast('已更新 LOGO 顺序', 'success')
            }}
            onImportFiles={importLogoFiles}
            onPickAsset={(asset) => {
              if (!activePreset) return
              const logo = store.projectLogos.find((item) => item.id === asset.path)
              if (!logo?.assetId) return
              const layerId = store.replaceOrAddLogoLayer(
                activePreset.id,
                { kind: 'stored', assetId: logo.assetId, name: logo.name },
                selectedLayerId,
              )
              setSelectedLayerId(layerId)
              useStore.getState().showToast(`已插入 LOGO「${logo.name}」`, 'success')
            }}
          />
        </div>

        <div
          data-layout="layer-bottom-panel"
          className="col-span-2 min-h-0 overflow-hidden border-t border-ds-border dark:border-ds-border"
        >
          <PresetLayerPanel
            preset={activePreset}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            onUpdatePreset={(patch) => activePreset && store.updatePreset(activePreset.id, patch)}
          />
        </div>
      </div>
    </div>
  )
}
