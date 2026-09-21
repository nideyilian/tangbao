import { useEffect, useMemo, useState } from 'react'
import { Checkbox, SegmentedControl } from '../../../design-system'
import {
  CopyIcon as Copy,
  ExportIcon,
  ImportIcon,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import { filterPresetsByProduct, filterPresetsByQuery, filterUnassignedPresets } from '../lib/compositePresetLibrary'
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
import { runPresetProductMigration } from '../presetProductMigrationRunner'
import { useCompositeV2Store } from '../storeV2'
import { useStore } from '../../../store'
import { resolveNodeWatermarkBinding, resolveOwningProductId } from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'
import { PresetCanvasEditor } from './PresetCanvasEditor'
import { PresetLayerPanel } from './PresetLayerPanel'
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
  /**
   * 生效范围：`null` = 这个范围的**通用水印**（写 `watermarkPresetIds`）；
   * 某个媒体 id = 该渠道**单独的水印**（写 `byMedia[媒体]`）。
   *
   * 渠道是在「作用域（左树给）」与「水印（库给）」之外的**第三个维度**。
   * 它不进左树：维度与作用域套成一层嵌套必然把同一棵作用域树复制 N 份（TB-062 的教训），
   * 所以它是一排选择器 —— 与右区那排分区 tab 同一种表达方式。
   */
  const [mediaScope, setMediaScope] = useState<string | null>(null)

  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const media = usePostprocessMediaStore((state) => state.media)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const identifier = store.identifier ?? createDefaultIdentifier()

  /**
   * 当前范围 = 中控台左树选中的那个节点。
   *
   * 作用域读的是**全局上下文指针** `useAssetLibraryStore.scope`，与中控台左树、右区标题
   * 是同一个值，所以不会出现「库里勾的方向和树上选的不一致」这种错位。
   */
  const libraryScope = useAssetLibraryStore((state) => state.scope)
  const scope =
    typeof libraryScope === 'object' && libraryScope.kind === 'collection' ? libraryScope.id : GLOBAL_NODE_ID
  const isGlobal = scope === GLOBAL_NODE_ID
  const scopeName = isGlobal ? '全局默认' : (collections.find((item) => item.id === scope)?.name ?? '全局默认')

  /**
   * 当前作用域所属的**产品**：水印库按产品隔离，这个值决定「现在看的是哪个产品的库」。
   *
   * - 产品节点 → 它自己；
   * - 方向（及更深）→ 往上取第二级；
   * - 产品线 / 全局默认 → `null`。
   *
   * 后两种没有「自己的库」：水印是产品的资产，在这两层既没有归属对象、也没有可勾的清单
   * （`byMedia` 那一层在数据上就不存在），所以界面直接给一句「先选一个产品」，
   * 而不是把下辖所有产品的水印堆在一起 —— 那正是改版前「分不清谁是谁」的根源。
   */
  const productId = useMemo(
    () => (isGlobal ? null : resolveOwningProductId(collections, scope)),
    [collections, scope, isGlobal],
  )
  const productName = productId ? (collections.find((item) => item.id === productId)?.name ?? '') : ''
  const hasProduct = Boolean(productId)

  /** 一次性迁移（幂等）：把 v6 的全局 / 产品线级清单摊到产品，并按现有归属推断每套水印归谁。 */
  useEffect(() => {
    runPresetProductMigration()
  }, [])

  /**
   * 没有产品这一层时把渠道选择归位。
   * 否则从「方向A + 头条」切到全局再切回某个方向，会停在一个上次用过的渠道上 ——
   * 而用户的心智是「刚进来看的应该是这个方向的通用值」。
   */
  useEffect(() => {
    if (!hasProduct) setMediaScope(null)
  }, [hasProduct])

  const activeMedia = mediaScope ? media.find((item) => item.id === mediaScope) : undefined
  const mediaName = activeMedia?.name ?? ''

  /**
   * 当前生效范围解析出来的水印绑定。
   *
   * 给 `mediaId` 时解析的是**该渠道生效的那套**（渠道值优先于本级通用值，两者都没有就继续
   * 往上级继承）—— 所以界面上的勾选状态永远反映「生成图时真正会叠什么」，而不是
   * 「这个节点上配过什么」。全局默认没有 `byMedia` 这一层，只读全局基线。
   */
  const binding = useMemo(() => {
    if (isGlobal) return { presetIds: globalWatermarkPresetIds, sourcedFrom: null, overridden: false }
    return resolveNodeWatermarkBinding(collections, params, scope, globalWatermarkPresetIds, mediaScope ?? undefined)
  }, [isGlobal, collections, params, scope, globalWatermarkPresetIds, mediaScope])

  const effectivePresetIds = binding.presetIds
  const isPresetEnabled = (presetId: string) => effectivePresetIds.includes(presetId)

  /** 本范围的节点覆盖。全局默认没有「覆盖」这一说（基线就是基线自己的值）。 */
  const nodeOverride = isGlobal ? undefined : params[scope]?.postprocess

  /**
   * 被本范围**单独设过**水印的渠道集合。
   *
   * 只认「本级写了 `byMedia[媒体].watermarkPresetIds`」的：选择器据此打点，一眼看出哪些渠道
   * 跟通用那套不一样 —— 与 `resolveNodeWatermarkBindingsByMedia` 的「只回传与通用值不同的渠道」
   * 是同一个口径（那边看全链，这里只看本级）。
   */
  const overriddenMediaIds = useMemo(() => {
    const result = new Set<string>()
    for (const [mediaId, entry] of Object.entries(nodeOverride?.byMedia ?? {})) {
      if (entry?.watermarkPresetIds !== undefined) result.add(mediaId)
    }
    return result
  }, [nodeOverride])

  /**
   * 这批水印是从哪儿继承来的（本级没写时才说得上）。
   * 不写清的话「勾选里显示的那几套」会被当成「本范围的设置」—— 用户会以为自己在改产品，
   * 实际一勾就产生了一条方向级覆盖。
   */
  const inheritedFromName =
    !isGlobal && !binding.overridden && binding.sourcedFrom
      ? (collections.find((item) => item.id === binding.sourcedFrom)?.name ?? '')
      : ''

  /**
   * 写当前生效范围：通用那格写 `watermarkPresetIds`，某渠道写 `byMedia[该渠道]`。
   * 两者在数据层是**同层**关系（渠道值优先于本级通用值），所以一次只动一格。
   */
  const writePresetIds = (nextIds: string[]) => {
    if (!hasProduct) return
    if (mediaScope) setPostprocessOverride(scope, { byMedia: { [mediaScope]: { watermarkPresetIds: nextIds } } })
    else setPostprocessOverride(scope, { watermarkPresetIds: nextIds })
  }

  /**
   * 逐套开关当前生效范围的水印。这是「这个方向 / 这个渠道用哪几套」唯一的编辑入口。
   *
   * **首次改动即物化**：继承态下把生效清单复制成显式数组再改。直接写「剩下的这几个」
   * 会把继承来的其余水印静默丢掉——症状是「我只想减一个，结果另外两个也没了」。
   */
  const togglePresetEnabled = (presetId: string) => {
    if (!hasProduct) return
    const next = effectivePresetIds.includes(presetId)
      ? effectivePresetIds.filter((id) => id !== presetId)
      : [...effectivePresetIds, presetId]
    writePresetIds(next)
  }

  /**
   * 撤掉当前生效范围的设置、退回继承。
   *
   * 传 `undefined` 而不是「写入当前生效值」：写值等于把继承来的那份固化在本级，
   * 以后改上层就再也影响不到这里（与「输出位置」分区的「恢复继承」同一个口径）。
   */
  const resetCurrentScope = () => {
    if (!hasProduct) return
    if (mediaScope) {
      setPostprocessOverride(scope, { byMedia: { [mediaScope]: { watermarkPresetIds: undefined } } })
      useStore.getState().showToast(`「${scopeName}」在${mediaName}已改回跟随通用`, 'success')
      return
    }
    setPostprocessOverride(scope, { watermarkPresetIds: undefined })
    useStore.getState().showToast(`「${scopeName}」已改回跟随上级`, 'success')
  }

  /**
   * 把「未分配」的水印归到当前产品。
   *
   * 只改归属这一个字段：归过去之后它就落在本产品的库里，是否启用由产品 / 方向层自己决定 ——
   * 与「在这个库里新建一套」的后续行为完全一致，不额外替用户勾上或取消。
   */
  const assignUnassigned = (presetIds: string[]) => {
    if (!hasProduct || presetIds.length === 0) return
    store.assignPresetsToProduct(presetIds, productId ?? '')
    useStore.getState().showToast(`已归到「${productName}」`, 'success')
  }

  /** 库栏副标题：这一勾会落到哪一层，以及没写过的值是从哪儿来的。 */
  const scopeHint = !hasProduct
    ? '水印属于产品 —— 先在左侧选一个产品，再逐套开关'
    : inheritedFromName
      ? `继承自「${inheritedFromName}」· 改动即在${mediaScope ? `本方向的${mediaName}` : '本范围'}单独生效`
      : `勾选 = 「${scopeName}」${mediaScope ? `在${mediaName} ` : ''}用这套水印`

  /** 生效范围 pill：选中 = 强调色（与库行的选中态同源），未选中 = 灰边。 */
  const scopePillClass = (active: boolean) =>
    `inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
      active
        ? 'border-ds-primary bg-ds-primary-subtle font-medium text-ds-primary dark:border-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary'
        : 'border-ds-border text-ds-muted hover:border-ds-primary hover:text-ds-primary dark:border-ds-border dark:text-ds-muted dark:hover:text-ds-primary'
    }`

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

  /** 本产品的库（**不含**搜索过滤）：画布的「当前预设」在这一层找，所以搜到看不见也不会把画布清空。 */
  const libraryPresets = useMemo(
    () => filterPresetsByProduct(store.presets, productId ?? ''),
    [store.presets, productId],
  )
  const visiblePresets = useMemo(() => filterPresetsByQuery(libraryPresets, query), [query, libraryPresets])
  /** 未分配的（不属于任何产品的库）：列在下方，可一键归到当前产品，否则它会永远用不上。 */
  const unassignedPresets = useMemo(
    () => (hasProduct ? filterPresetsByQuery(filterUnassignedPresets(store.presets), query) : []),
    [hasProduct, store.presets, query],
  )
  /**
   * 画布上的当前预设**只在当前产品的库里找**。
   *
   * 两个后果都是有意的：① 搜索把当前这套滤掉时画布照旧显示它（改版前就是这行为）；
   * ② 切到另一个产品时它自动让位给新产品的第一套 —— 否则画布上会一直停着上一个产品的水印，
   * 而左栏列表里根本没有它，看起来像「选中的东西不见了」。
   */
  const activePreset = libraryPresets.find((preset) => preset.id === store.selectedPreviewPresetId) ?? null
  useEffect(() => {
    if (!activePreset && libraryPresets[0]) setSelectedPreviewPresetId(libraryPresets[0].id)
  }, [activePreset, libraryPresets, setSelectedPreviewPresetId])

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
   * 导出整个水印库。归属与图片资产一并带走，保证接收方导入即可用。
   *
   * 不再支持「只导勾选的那几个」：库行上的勾选框已改为**当前范围是否启用这套水印**
   * （2026-09-21 改版），勾选与导出不再是同一件事，绑在一起会让人以为「勾上 = 要导出」。
   */
  async function handleExportPresets() {
    if (!hasProduct) return
    // 只导**当前产品**的库：按产品隔离之后，把别产品的水印一起导出去没有意义 ——
    // 接收方导入时会被归到他自己选的当前产品下，等于把两个产品的水印搅在一起。
    const targets = libraryPresets
    if (targets.length === 0) {
      useStore.getState().showToast(`「${productName}」的水印库是空的，没有可导出的水印`, 'info')
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
    const restored = await restorePresetAssets(plan.presets)
    // 文件里的 `productId` 是**导出方机器上的产品 id**，在本机根本不存在。不改写的话这套水印会
    // 归到一个查无此人的产品下 —— 既不在任何产品的库、也不在「未分配」区，导入完就消失了。
    const presets = restored.map((preset) => ({ ...preset, productId: productId ?? '' }))
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
      className="grid h-full min-h-0 min-w-[880px] flex-1 grid-cols-[300px_minmax(0,1fr)] overflow-hidden border border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim"
    >
      {/* 左栏：水印库。2026-09-21 改版后**不再有「水印归属」树**：归属读的就是中控台
          左边那棵项目树（同一份 collections、同一个选中），编辑器里再放一棵等于同一件事
          开了两个入口。归属的编辑动作（当前方向用哪几套）改为下面库行上的勾选框。 */}
      <section
        data-layout="preset-library"
        className="flex min-h-0 flex-col overflow-hidden border-r border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim"
      >
        <header className="flex items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border shrink-0">
          <div className="min-w-0">
            {/* 标题带上产品名：库按产品隔离后，「这是谁的库」必须一眼可见 ——
                只写「水印库」的话，切产品时列表内容整批换掉而标题不变，看起来像同一批水印在变魔术。 */}
            <h2 className="truncate text-sm font-semibold">{hasProduct ? `水印库 · ${productName}` : '水印库'}</h2>
            {/* 副标题写清这一勾落到哪一层、没写过的值是从哪儿来的 —— 不写的话
                「库里显示的那几套」会被当成「本范围的设置」，而它可能只是从产品继承来的。 */}
            <p className="truncate text-xs text-ds-muted" title={scopeHint}>
              {scopeHint}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title={hasProduct ? '导入水印预设文件' : '先在左侧选一个产品'}
              aria-label="导入水印预设文件"
              disabled={!hasProduct}
              onClick={() => void handleImportPresets()}
              className="inline-flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded-md text-ds-muted hover:bg-ds-subtle hover:text-ds-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none dark:text-ds-muted dark:hover:bg-ds-subtle dark:hover:text-ds-primary"
            >
              <ImportIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={hasProduct ? '导出水印预设到文件' : '先在左侧选一个产品'}
              aria-label="导出水印预设到文件"
              disabled={!hasProduct}
              onClick={() => void handleExportPresets()}
              className="inline-flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded-md text-ds-muted hover:bg-ds-subtle hover:text-ds-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none dark:text-ds-muted dark:hover:bg-ds-subtle dark:hover:text-ds-primary"
            >
              <ExportIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={hasProduct ? `在「${productName}」下新建水印` : '先在左侧选一个产品'}
              disabled={!hasProduct}
              onClick={() => {
                store.createPreset('新预设', productId ?? '')
                useStore.getState().showToast(`已创建水印（归属「${productName}」）`, 'success')
              }}
              className="inline-flex h-ds-control-sm w-ds-control-sm cursor-pointer items-center justify-center rounded-md border border-ds-border hover:bg-ds-subtle disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none dark:border-ds-border dark:hover:bg-ds-subtle"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="shrink-0 space-y-1.5 p-3">
          {/*
           * 生效范围：决定下面那些勾选写进「本范围的通用水印」还是「某个渠道单独的水印」。
           *
           * 没有产品这一层（产品线 / 全局默认）时整块不渲染 —— 那时界面主体是
           * 「先选一个产品」，数据层也没有 `byMedia` 这一层，摆一排点不动的渠道
           * 只会让人以为「这里也能按渠道配，只是现在锁着」。
           */}
          {hasProduct && (
            <div
              data-layout="preset-scope-switch"
              className="space-y-1 border-b border-ds-border pb-2 dark:border-ds-border"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ds-text dark:text-ds-text">生效范围</span>
                {binding.overridden && (
                  <button
                    type="button"
                    onClick={resetCurrentScope}
                    title={
                      mediaScope
                        ? `撤掉「${mediaName}」的单独设置，改回跟随通用`
                        : `撤掉本级的设置，改回跟随上级（${inheritedFromName || '上级'}）`
                    }
                    className="shrink-0 cursor-pointer text-xs text-ds-muted underline-offset-2 hover:text-ds-primary hover:underline dark:text-ds-muted dark:hover:text-ds-primary"
                  >
                    {mediaScope ? '跟随通用' : '跟随上级'}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  aria-pressed={mediaScope === null}
                  onClick={() => setMediaScope(null)}
                  title="这个范围的通用水印：没被单独设过的渠道都用它"
                  className={scopePillClass(mediaScope === null)}
                >
                  通用
                </button>
                {media.map((item) => {
                  const overridden = overriddenMediaIds.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={mediaScope === item.id}
                      onClick={() => setMediaScope(item.id)}
                      title={
                        overridden
                          ? `${item.name} 已单独设置（点进来改，或撤掉改回跟随通用）`
                          : `${item.name} 跟随通用；点进来一改即在本方向单独生效`
                      }
                      className={scopePillClass(mediaScope === item.id)}
                    >
                      {item.name}
                      {overridden && (
                        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ds-warning" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按名称搜索"
            aria-label="搜索预设"
            className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-sm dark:border-ds-border dark:bg-ds-scrim"
          />

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
          {!hasProduct && (
            <p className="px-2 py-3 text-xs text-ds-muted">
              水印库按产品分开管理。在左侧项目树里选中一个产品（或它下面的方向），这里就会列出那个产品自己的水印。
            </p>
          )}
          {hasProduct && visiblePresets.length === 0 && (
            <p className="px-2 py-3 text-xs text-ds-muted">
              {query ? '没有匹配的水印。' : `「${productName}」还没有水印。点右上角 + 新建一个。`}
            </p>
          )}
          {visiblePresets.map((preset) => (
            <div
              key={preset.id}
              className={`group relative rounded-md px-2 py-1.5 transition-colors ${preset.id === store.selectedPreviewPresetId ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary' : 'hover:bg-ds-subtle dark:hover:bg-ds-subtle'}`}
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
                  {/* 勾选 = **当前范围启用这套水印**（2026-09-21 改版后的唯一归属入口）。
                      原先它兼着「选几个再拖到归属树上」的批量语义，归属树退役后拖拽目标
                      已不存在，勾选框回归它本来的意思。
                      库按产品隔离后，能出现在这里的只有当前作用域那个产品的水印
                      （见 `libraryPresets`），所以「勾 A 产品的水印」在物理上就不可能落到 B 产品上。 */}
                  <Checkbox
                    checked={isPresetEnabled(preset.id)}
                    disabled={!hasProduct}
                    onChange={() => togglePresetEnabled(preset.id)}
                    aria-label={`${isPresetEnabled(preset.id) ? '停用' : '启用'}「${preset.name}」${mediaScope ? `（${mediaName}）` : ''}`}
                    title={`写进：${scopeName} · ${mediaScope ? mediaName : '通用'}`}
                    className="shrink-0"
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

          {/*
           * 未分配区：v7 之前水印库是全局一批，升级后「没有任何产品的方向勾过它」的那些水印
           * 就没有归属。它们不属于任何产品的库，但**不能就这么消失** —— 产出链路按 id 全局找预设，
           * 照样会用它，而界面上哪儿都看不见（这种「生成图带了水印、库里却查不到」最难排查）。
           * 这里给一个显式出口：看得见、能归到当前产品。
           */}
          {unassignedPresets.length > 0 && (
            <div
              data-layout="preset-unassigned"
              className="mt-2 space-y-0.5 border-t border-ds-border pt-2 dark:border-ds-border"
            >
              <div className="flex items-center justify-between gap-2 px-2">
                <span className="text-xs font-medium text-ds-muted dark:text-ds-muted">
                  未分配（{unassignedPresets.length}）
                </span>
                <button
                  type="button"
                  onClick={() => assignUnassigned(unassignedPresets.map((preset) => preset.id))}
                  className="shrink-0 cursor-pointer text-xs text-ds-muted underline-offset-2 hover:text-ds-primary hover:underline dark:text-ds-muted dark:hover:text-ds-primary"
                >
                  全部归到「{productName}」
                </button>
              </div>
              <p className="px-2 text-xs text-ds-muted dark:text-ds-muted">
                这些水印不属于任何产品，所以哪个产品的库里都不会列出它们。归到当前产品后即可勾选使用。
              </p>
              {unassignedPresets.map((preset) => (
                <div key={preset.id} className="flex items-center gap-2 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-ds-sm text-ds-text dark:text-ds-text-subtle">
                    {preset.name}
                  </span>
                  {/* 文字链接风格，与上面那排「跟随上级 / 跟随通用」一致 ——
                      这一区是次要动作，配个带边框的按钮反而比主列表更抢眼 */}
                  <button
                    type="button"
                    onClick={() => assignUnassigned([preset.id])}
                    className="shrink-0 cursor-pointer text-xs text-ds-muted underline-offset-2 hover:text-ds-primary hover:underline dark:text-ds-muted dark:hover:text-ds-primary"
                  >
                    归到「{productName}」
                  </button>
                </div>
              ))}
            </div>
          )}
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
