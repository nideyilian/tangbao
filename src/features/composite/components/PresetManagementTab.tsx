import { useEffect, useMemo, useState } from 'react'
import { Checkbox, SegmentedControl } from '../../../design-system'
import {
  CopyIcon as Copy,
  ExportIcon,
  ImportIcon,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import {
  PRESET_LIBRARY_DRAG_TYPE as LIBRARY_PRESET_DRAG_TYPE,
  filterPresetsByQuery,
  serializePresetDragPayload,
} from '../lib/compositePresetLibrary'
import type { CompositeFsImage } from '../lib/compositeTypes'
import {
  dataUrlToCompositeBlob,
  getCompositeAssetObjectUrl,
  isCompositeAssetReferenced,
  removeCompositeAsset,
  storeCompositeBlobs,
} from '../lib/compositeAssets'
import {
  IDENTIFIER_PLACEMENTS,
  IDENTIFIER_PLACEMENT_LABELS,
  createDefaultIdentifier,
  isIdentifierEnabled,
} from '../lib/compositeIdentifier'
import {
  buildPresetTransferFile,
  collectPresetBindings,
  embedPresetAssets,
  parsePresetTransferFile,
  pickPresetTransferFile,
  planPresetImport,
  restorePresetAssets,
  savePresetTransferFile,
  type PresetImportPlan,
} from '../lib/compositePresetTransfer'
import { bindPresetToNode } from '../lib/presetBinding'
import { useCompositeV2Store } from '../storeV2'
import { useStore } from '../../../store'
import { resolveNodeWatermarkBinding } from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'
import { PresetCanvasEditor } from './PresetCanvasEditor'
import { PresetLayerPanel } from './PresetLayerPanel'
import { PresetProjectTree } from './PresetProjectTree'
import { useAppDialog } from '../../../hooks/useAppDialog'

export function PresetManagementTab() {
  const store = useCompositeV2Store()
  const { openConfirmDialog, openInfoDialog } = useAppDialog()
  const [query, setQuery] = useState('')
  const [logoStatusText] = useState('支持拖拽添加 LOGO。')
  const [isRefreshingLogos] = useState(false)
  const [logoObjectUrls, setLogoObjectUrls] = useState<Record<string, string>>({})
  const [selectedLayerId, setSelectedLayerId] = useState('')
  const [editingPresetId, setEditingPresetId] = useState('')
  const [editingPresetName, setEditingPresetName] = useState('')
  const [draggingLibraryPresetId, setDraggingLibraryPresetId] = useState('')

  /**
   * 库里多选出来、准备批量绑定的预设。
   *
   * 这是「预设组」退役后唯一需要补的能力：以前把一伙水印打进一个组，往方向上一拖
   * 就是一次绑一组；组没了之后，勾几个再拖/点 + 就是同一个动作，而且不用先去建组。
   * 存数组不存 Set：顺序即绑定顺序，而绑定顺序即产出顺序。
   */
  const [librarySelection, setLibrarySelection] = useState<string[]>([])
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const media = usePostprocessMediaStore((state) => state.media)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const identifier = store.identifier ?? createDefaultIdentifier()

  const toggleLibrarySelection = (presetId: string) =>
    setLibrarySelection((prev) =>
      prev.includes(presetId) ? prev.filter((id) => id !== presetId) : [...prev, presetId],
    )

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

  const visiblePresets = useMemo(() => filterPresetsByQuery(store.presets, query), [query, store.presets])
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

  /**
   * 导出：库里勾了就导勾选的那批，没勾就导全部（「我要备份整个水印库」是默认预期）。
   * 归属与图片资产一并带走，保证接收方导入即可用。
   */
  async function handleExportPresets() {
    const targets =
      librarySelection.length > 0
        ? store.presets.filter((preset) => librarySelection.includes(preset.id))
        : store.presets
    if (targets.length === 0) {
      useStore.getState().showToast('水印库是空的，没有可导出的水印', 'info')
      return
    }
    const bindings = collectPresetBindings({
      presetIds: targets.map((preset) => preset.id),
      collections,
      params,
      media,
    })
    const presets = await embedPresetAssets(targets, store.projectLogos ?? [])
    const result = await savePresetTransferFile(buildPresetTransferFile({ presets, bindings, identifier }))
    if (!result.ok) {
      if (result.error) useStore.getState().showToast(result.error, 'error')
      return
    }
    useStore
      .getState()
      .showToast(
        `已导出 ${targets.length} 个水印${bindings.length > 0 ? `，含 ${bindings.length} 条归属` : ''}`,
        'success',
      )
  }

  async function handleImportPresets() {
    const picked = await pickPresetTransferFile()
    if (!picked.text) {
      if (picked.error) useStore.getState().showToast(picked.error, 'error')
      return
    }
    const file = parsePresetTransferFile(picked.text)
    if (!file) {
      openInfoDialog({
        title: '不是水印预设文件',
        message: '请选择从「水印库 → 导出」保存下来的 JSON 文件。其它 JSON 不会被猜着导入。',
      })
      return
    }
    const plan = planPresetImport({ file, collections, media, existingPresets: store.presets })
    const updated = plan.resolutions.filter((item) => item.mode === 'update').length
    const summary = [
      `新增 ${plan.resolutions.length - updated} 个水印${updated > 0 ? `，覆盖 ${updated} 个同 id 的水印` : ''}。`,
      plan.bindings.length > 0 ? `可恢复 ${plan.bindings.length} 条归属。` : '文件里没有可恢复的归属。',
      plan.unmatchedBindings.length > 0
        ? `有 ${plan.unmatchedBindings.length} 条归属在本机找不到同名路径，导入后不会动你的项目树。`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
    openConfirmDialog({
      title: '导入水印预设？',
      message: summary,
      confirmText: '导入',
      action: () => void applyImport(plan),
    })
  }

  async function applyImport(plan: PresetImportPlan) {
    const presets = await restorePresetAssets(plan.presets)
    store.mergeImportedPresets(presets)
    for (const binding of plan.bindings) {
      // 每次都取最新 params：循环里连写多条，用闭包里的旧值会把前一条覆盖掉
      const latestParams = useProjectTreeParamsStore.getState().params
      const current = resolveNodeWatermarkBinding(
        collections,
        latestParams,
        binding.collectionId,
        globalWatermarkPresetIds,
        binding.mediaId ?? undefined,
      ).presetIds
      const nextIds = bindPresetToNode(current, binding.presetId)
      setPostprocessOverrideOf(binding.collectionId, binding.mediaId, nextIds)
    }
    // 标识符只在本机没配过时才采用文件里的：静默改掉用户已有的署名是最糟的一类意外
    if (plan.identifier && !isIdentifierEnabled(identifier)) store.setIdentifier(plan.identifier)
    useStore
      .getState()
      .showToast(
        `已导入 ${plan.resolutions.length} 个水印${plan.bindings.length > 0 ? `，恢复 ${plan.bindings.length} 条归属` : ''}`,
        'success',
      )
  }

  function setPostprocessOverrideOf(collectionId: string, mediaId: string | null, presetIds: string[]) {
    useProjectTreeParamsStore
      .getState()
      .setPostprocessOverride(
        collectionId,
        mediaId ? { byMedia: { [mediaId]: { watermarkPresetIds: presetIds } } } : { watermarkPresetIds: presetIds },
      )
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
      className="grid h-full min-h-0 min-w-[1180px] flex-1 grid-cols-[300px_260px_minmax(0,1fr)] overflow-hidden border border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim"
    >
      {/* 左栏：水印归属。整栏只回答一件事——「这个产品 / 这个方向用哪几套水印」。
          调参（输出目录、命名、渠道规格）全在后处理那边，这里一概不放：同一个参数
          有两个入口，迟早会出现「在 A 改了、在 B 看不到」。 */}
      <PresetProjectTree librarySelection={librarySelection} />

      {/* 中栏：水印库。原先它在左栏下段、与归属树共用一条分隔条；「预设详情」栏在归属与
          参数各自归位后已经空了，把库挪过来正好补上这个位置——拖出方（库）与拖入方（树）
          仍在一屏之内，一次绑定不用换界面。 */}
      <section
        data-layout="preset-library"
        className="flex min-h-0 flex-col overflow-hidden border-r border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim"
      >
        <header className="flex items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border shrink-0">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">水印库</h2>
            <p className="truncate text-xs text-ds-muted">
              {librarySelection.length > 0 ? `已选 ${librarySelection.length} 个` : '拖到上方方向即可归属'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title="导入水印预设文件"
              aria-label="导入水印预设文件"
              onClick={() => void handleImportPresets()}
              className="inline-flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded-md text-ds-muted hover:bg-ds-subtle hover:text-ds-primary dark:text-ds-muted dark:hover:bg-ds-subtle dark:hover:text-ds-primary"
            >
              <ImportIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="导出水印预设到文件（勾选时只导勾选的）"
              aria-label="导出水印预设到文件"
              onClick={() => void handleExportPresets()}
              className="inline-flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded-md text-ds-muted hover:bg-ds-subtle hover:text-ds-primary dark:text-ds-muted dark:hover:bg-ds-subtle dark:hover:text-ds-primary"
            >
              <ExportIcon className="h-4 w-4" />
            </button>
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
          </div>
        </header>
        <div className="shrink-0 space-y-1.5 p-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按名称搜索"
            aria-label="搜索预设"
            className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-sm dark:border-ds-border dark:bg-ds-scrim"
          />
          {librarySelection.length > 0 && (
            <button
              type="button"
              onClick={() => setLibrarySelection([])}
              className="cursor-pointer text-xs text-ds-muted underline-offset-2 hover:text-ds-primary hover:underline dark:text-ds-muted dark:hover:text-ds-primary"
            >
              清空选择
            </button>
          )}

          {/* 标识符是全局一份：改一次对所有预设同时生效，所以它挨着「水印库」而不是塞进
              单个预设的图层面板——放在预设里会让人以为它只管这一个水印。 */}
          <div
            data-layout="preset-identifier"
            className="space-y-1.5 border-t border-ds-border pt-2 dark:border-ds-border"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ds-text dark:text-ds-text">水印标识符</span>
              <span className="text-xs text-ds-muted dark:text-ds-muted">
                {isIdentifierEnabled(identifier) ? '已生效' : '未启用'}
              </span>
            </div>
            <input
              value={identifier.text}
              onChange={(event) => store.setIdentifier({ text: event.target.value })}
              placeholder="如 @小王"
              aria-label="水印标识符"
              data-identifier-input
              className="w-full rounded-md border border-ds-border bg-ds-surface px-2 py-1.5 text-sm text-ds-text outline-none focus:border-ds-primary dark:border-ds-border dark:bg-ds-scrim dark:text-ds-text"
            />
            <SegmentedControl
              aria-label="标识符附加位置"
              size="sm"
              value={identifier.placement}
              onValueChange={(placement) => store.setIdentifier({ placement })}
              options={IDENTIFIER_PLACEMENTS.map((value) => ({
                value,
                label: IDENTIFIER_PLACEMENT_LABELS[value],
              }))}
              className="w-full"
            />
            <p className="text-xs text-ds-muted dark:text-ds-muted">
              有文字的水印按所选位置附加；没有文字水印的，自动加在左下角。
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5 px-2 pb-2">
          {visiblePresets.length === 0 && (
            <p className="px-2 py-3 text-xs text-ds-muted">没有匹配的水印。点右上角 + 新建一个。</p>
          )}
          {visiblePresets.map((preset) => (
            <div
              key={preset.id}
              draggable={editingPresetId !== preset.id}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy'
                // 拖的那一行如果在多选里，就把整批带上。否则用户勾了三个却只绑上一个，
                // 界面上没有任何反馈——典型「操作了但结果不符预期」的静默失败。
                const payload = librarySelection.includes(preset.id) ? librarySelection : [preset.id]
                ;(event.dataTransfer as { setData?: (type: string, value: string) => void }).setData?.(
                  LIBRARY_PRESET_DRAG_TYPE,
                  serializePresetDragPayload(payload),
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
                  <Checkbox
                    checked={librarySelection.includes(preset.id)}
                    onChange={() => toggleLibrarySelection(preset.id)}
                    aria-label={`把水印「${preset.name}」加入待绑定`}
                    className={
                      librarySelection.includes(preset.id) ? 'shrink-0' : 'shrink-0 opacity-0 group-hover:opacity-100'
                    }
                  />
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
