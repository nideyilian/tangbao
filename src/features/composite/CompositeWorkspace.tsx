import { useEffect, useMemo, useState } from 'react'
import { Button, Tabs } from '../../design-system'
import { PlusIcon } from '../../design-system/icons'
import {
  CONTROL_CONSOLE_SECTIONS,
  DEFAULT_CONTROL_CONSOLE_SECTION,
  isGlobalScope,
  normalizeControlConsoleSection,
  type ConsoleScope,
} from './lib/controlConsoleSections'
import { ConsoleAssetTree } from './components/ConsoleAssetTree'
import { ConsolePresetGrid } from './components/ConsolePresetGrid'
import { ConsoleToolbar, type ConsoleBindingFilter, type ConsoleViewMode } from './components/ConsoleToolbar'
import { DistributionSection } from './components/DistributionSection'
import { MediaSection } from './components/MediaSection'
import { OutputSection } from './components/OutputSection'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { resolveNodeWatermarkBinding } from '../projectTree/params'
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import {
  getPostprocessMediaConfigSnapshot,
  restorePostprocessMediaConfig,
  usePostprocessMediaStore,
} from '../../storePostprocessMedia'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useStore } from '../../store'
import { GLOBAL_NODE_ID } from '../postprocess/paramSchema'
import { useCompositeV2Store } from './storeV2'
import { exportConsoleWorkbook } from './lib/consoleWorkbook'
import {
  applyConsoleImport,
  formatImportPlan,
  pickConsoleWorkbook,
  planConsoleImport,
  type ConsoleImportActions,
  type ConsoleImportContext,
  type ImportMode,
  type ImportPlan,
} from './lib/consoleImport'
import { usePostprocessGlobalConfig } from '../postprocess/usePostprocessGlobalConfig'

/**
 * 中控台（顶栏 tab，原「水印预设」工作区）。
 *
 * 形态对齐「灵境 · 策略中心」（strategy/center，2026-09-20 登录实测）：**左树 + 右内容**。
 *
 * ```
 * 左：项目树                            右：一排 tab
 * 业务线 → 产品 → 方向                  水印 / 输出位置 / 渠道与尺寸 / 分发
 * 管「改谁」，增删改查都在树上           管「改什么」，跟着树上选中哪一层走
 * ```
 *
 * **树是全局的**（杰哥 2026-09-21）：它管的是整个框架，画廊侧栏与项目树读的是同一份
 * `useAssetLibraryStore.collections`，所以树上一处改动三处同步。
 *
 * **业务模型：方向自带一整套参数，生成图时直接调用**（杰哥 2026-09-20 明确）。
 * 所以左树是参数的组织骨架，不是可选的筛选器：
 * - 选中某个方向 ⇒ 右区就是**该方向的参数**——水印卡片网格上直接开停用，
 *   输出位置按这个方向改；
 * - 选中「全局默认」⇒ 右区是全局基线（水印在此是只读总览：
 *   全局清单在前端没有写入点，各方向自己声明才是权威）。
 *
 * ⚠️ 准入约束：**有节点级字段的参数才消费作用域**。
 * `PostprocessNodeOverride`（ADR-0011 收窄后）只有 `outputDir` / `byMedia` /
 * `watermarkPresetIds` / `enabled`；`distribution` / `autoCompanionClean` /
 * `selectedMediaIds` 不在其中，所以「渠道与尺寸」「分发」是全局一套（`globalOnly`）。
 *
 * ⚠️ 模型教训（2026-09-21 上午）：曾经把配置维度挂到树上当一级（「维度 → 作用域」两级树），
 * 结果是每个能按方向配的维度各挂一棵完整的方向树，展开两个组就是两棵一模一样的树。
 * 维度与作用域是两条轴，套成一层嵌套必然会复制数据 —— 现在树只有一棵，维度就是这排 tab。
 *
 * 顶栏 `SegmentedControl` 的一个 tab，与素材库 / Agent 同级。
 */
export default function CompositeWorkspace() {
  const canUndo = useCompositeV2Store((state) => state.canUndo)
  const undo = useCompositeV2Store((state) => state.undo)
  const presets = useCompositeV2Store((state) => state.presets)
  const createPreset = useCompositeV2Store((state) => state.createPreset)
  const deletePreset = useCompositeV2Store((state) => state.deletePreset)
  const duplicatePreset = useCompositeV2Store((state) => state.duplicatePreset)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)

  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)

  const showToast = useStore((state) => state.showToast)
  const { openConfirmDialog } = useAppDialog()

  /** 导出用的全局基线（与各分区读的是同一份，`usePostprocessGlobalConfig` 就是为此收口的）。 */
  const globalConfig = usePostprocessGlobalConfig()
  const identifier = useCompositeV2Store((state) => state.identifier)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  /**
   * 当前分区来自应用 store，而不是本工作区的局部 state。
   *
   * 原因：**外部要能指定落点**。「后处理」弹窗里的「去中控台改全局规格」只切工作区、
   * 不带分区的话，用户会落在默认分区还得自己找（等于没跳）。
   *
   * 离开时归位默认（下面的 cleanup）：这样「从顶栏点进来」看到的仍是水印，
   * 既有行为不变 —— 只有带目标分区的跳转才会落在别处。
   */
  const section = useStore((state) => state.controlConsoleSection)
  const setControlConsoleSection = useStore((state) => state.setControlConsoleSection)
  useEffect(() => () => setControlConsoleSection(DEFAULT_CONTROL_CONSOLE_SECTION), [setControlConsoleSection])
  /**
   * 作用域来自**全局上下文指针** `useAssetLibraryStore.scope`，不是本工作区的局部 state。
   *
   * 这是「全局统一树结构」的落地（杰哥 2026-09-20）：项目树是唯一主源，
   * 「现在看哪个方向」只该有**一个**指针，中控台 / 素材库 / SOP 都读它，
   * 于是「在任何地方打开都默认是当前方向」自然成立。
   *
   * 注意用 `setCollectionContextScope` 而不是 `setScope`：后者会清空素材库的选中态，
   * 在中控台点个方向就把用户在素材库选的一堆图清掉，那是事故（见 store 里两者的注释）。
   */
  const libraryScope = useAssetLibraryStore((state) => state.scope)
  const setCollectionContextScope = useAssetLibraryStore((state) => state.setCollectionContextScope)
  const scope: ConsoleScope =
    typeof libraryScope === 'object' && libraryScope.kind === 'collection' ? libraryScope.id : GLOBAL_NODE_ID
  const setScope = (next: ConsoleScope) => {
    setCollectionContextScope(isGlobalScope(next) ? null : next)
  }
  /** 水印分区有两个视图：卡片网格（管理）/ 编辑器（画布 + 库）。其余分区只有一种。 */
  const [watermarkView, setWatermarkView] = useState<'cards' | 'editor'>('cards')
  const [bindingFilter, setBindingFilter] = useState<ConsoleBindingFilter>('all')
  const [query, setQuery] = useState('')
  const [perRow, setPerRow] = useState(4)
  const [view, setView] = useState<ConsoleViewMode>('grid')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'z' || !canUndo) return
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUndo, undo])

  // 作用域换节点时清掉选择：跨方向的批量操作没有意义，留着只会误导
  useEffect(() => {
    setSelectedIds([])
  }, [scope])

  /**
   * store 里可能残留已下线的分区 id（例如上一版的 `directions`），所以先归一化再用：
   * 否则那排 tab 一个选中项都没有，右区还是空白。
   */
  const activeSection = normalizeControlConsoleSection(section)
  const active = CONTROL_CONSOLE_SECTIONS.find((item) => item.id === activeSection) ?? CONTROL_CONSOLE_SECTIONS[0]!
  const isGlobal = isGlobalScope(scope)

  const scopeTitle = useMemo(() => {
    if (isGlobal) return '全局默认'
    return collections.find((item) => item.id === scope)?.name ?? '全局默认'
  }, [collections, scope, isGlobal])

  const scopePath = useMemo(() => {
    if (isGlobal) return '对所有未单独设置的节点生效'
    return resolveCollectionPath(collections, scope)
      .map((item) => item.name)
      .join(' / ')
  }, [collections, scope, isGlobal])

  /**
   * 各预设被多少个方向**显式声明**在用。
   *
   * 只数显式声明（节点自己写了 `watermarkPresetIds` 或 `byMedia[*]`），
   * 不数继承来的值——否则「全局清单」会让每个预设都显示「N 个方向在用」，
   * 这个数字就失去意义了。它要回答的是「谁特意挑过这一套」。
   */
  const explicitUsage = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const [collectionId, entry] of Object.entries(params)) {
      const override = entry?.postprocess
      if (!override) continue
      const declared = new Set<string>(override.watermarkPresetIds ?? [])
      for (const perMedia of Object.values(override.byMedia ?? {})) {
        for (const id of perMedia?.watermarkPresetIds ?? []) declared.add(id)
      }
      for (const id of declared) {
        const set = map.get(id) ?? new Set<string>()
        set.add(collectionId)
        map.set(id, set)
      }
    }
    return map
  }, [params])

  /** 当前作用域（某个方向）生效的水印清单；全局作用域下就是全局基线 */
  const effectivePresetIds = useMemo(() => {
    if (isGlobal) return globalWatermarkPresetIds
    return resolveNodeWatermarkBinding(collections, params, scope, globalWatermarkPresetIds).presetIds
  }, [isGlobal, collections, params, scope, globalWatermarkPresetIds])

  const usedByCount = (presetId: string) => explicitUsage.get(presetId)?.size ?? 0

  /** 方向作用域下就地改该方向的水印清单（首次改动即物化：把生效清单写成显式数组再改） */
  const writeNodePresetIds = (nextIds: string[]) => {
    if (isGlobal) return
    setPostprocessOverride(scope, { watermarkPresetIds: nextIds })
  }

  const toggleEnabled = (presetId: string) => {
    if (isGlobal) return
    const next = effectivePresetIds.includes(presetId)
      ? effectivePresetIds.filter((id) => id !== presetId)
      : [...effectivePresetIds, presetId]
    writeNodePresetIds(next)
  }

  const visiblePresets = useMemo(() => {
    const q = query.trim()
    return presets.filter((preset) => {
      if (q && !preset.name.includes(q)) return false
      if (bindingFilter === 'bound' && (explicitUsage.get(preset.id)?.size ?? 0) === 0) return false
      if (bindingFilter === 'unbound' && (explicitUsage.get(preset.id)?.size ?? 0) > 0) return false
      return true
    })
  }, [presets, query, bindingFilter, explicitUsage])

  const toggleSelect = (presetId: string) => {
    setSelectedIds((current) =>
      current.includes(presetId) ? current.filter((id) => id !== presetId) : [...current, presetId],
    )
  }

  const openInEditor = (presetId: string) => {
    setSelectedPreviewPresetId(presetId)
    setWatermarkView('editor')
  }

  const confirmDelete = (ids: string[]) => {
    if (ids.length === 0) return
    openConfirmDialog({
      title: ids.length === 1 ? '删除这个预设？' : `删除选中的 ${ids.length} 个预设？`,
      message: '删除后无法恢复。若已有方向在用它，那些方向的产出会少这一层水印。',
      confirmText: '删除',
      tone: 'danger',
      action: () => {
        for (const id of ids) deletePreset(id)
        setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
        showToast(`已删除 ${ids.length} 个预设`, 'success')
      },
    })
  }

  const duplicateMany = (ids: string[]) => {
    for (const id of ids) duplicatePreset(id)
    setSelectedIds([])
    showToast(`已复制 ${ids.length} 个预设`, 'success')
  }

  const isCardView = activeSection === 'watermark' && watermarkView === 'cards'

  /**
   * 导出中控台全量数据为 Excel。
   *
   * 四种结果分开处理：**用户取消不打扰**（他自己点的取消），**失败必须说清**（否则
   * 又是一次「点了没反应」，而失败真因常常被吞在 IPC 的 catch 里 —— 见 runbook 十七条）。
   */
  const handleExport = async () => {
    setExporting(true)
    try {
      const outcome = await exportConsoleWorkbook({ collections, globalConfig, identifier, params, presets })
      if (outcome === 'saved') showToast('已导出中控台数据', 'success')
      else if (outcome === 'failed') showToast('导出失败：文件没能写入，换一个位置再试', 'error')
      else if (outcome === 'unsupported') showToast('当前环境不支持导出文件', 'error')
    } finally {
      setExporting(false)
    }
  }

  /** 导入用的当前状态快照（lib 层不认识 store，这里把它拼好传进去）。 */
  const buildImportContext = (): ConsoleImportContext => ({
    collections: useAssetLibraryStore.getState().collections,
    media: usePostprocessMediaStore.getState().media,
    params: useProjectTreeParamsStore.getState().params,
    mediaOutputDirs: usePostprocessMediaStore.getState().mediaOutputDirs,
    presetIds: useCompositeV2Store.getState().presets.map((preset) => preset.id),
  })

  /** 写库用的 action 集合。用 `getState()` 现取，省得把十几个 action 都挂成 hook 依赖。 */
  const buildImportActions = (): ConsoleImportActions => {
    const media = usePostprocessMediaStore.getState()
    const tree = useProjectTreeParamsStore.getState()
    const library = useAssetLibraryStore.getState()
    const composite = useCompositeV2Store.getState()
    return {
      addMedia: media.addMedia,
      renameMedia: media.renameMedia,
      setMediaEnabled: media.setMediaEnabled,
      addMediaSize: media.addMediaSize,
      updateMediaSize: media.updateMediaSize,
      deleteMediaSize: media.deleteMediaSize,
      setSelectedMediaIds: media.setSelectedMediaIds,
      setMediaOutputDir: media.setMediaOutputDir,
      clearMediaOutputDirs: media.clearMediaOutputDirs,
      patchDistribution: media.patchDistribution,
      setNamePattern: media.setNamePattern,
      setCreator: media.setCreator,
      setAutoCompanionClean: media.setAutoCompanionClean,
      setPostprocessOverride: tree.setPostprocessOverride,
      setIdentifier: composite.setIdentifier,
      createCollection: library.createCollection,
      renameCollection: library.renameCollection,
      moveCollection: library.moveCollection,
    }
  }

  /**
   * 按计划写库。
   *
   * **导入前抓快照、失败就整体回滚** —— 半吊子状态比「没导入」更糟：用户会以为导入成功了，
   * 而数据其实是两边的混合（TB-042 那次踩过的教训，见 `data-portability-redesign.md` §2.3）。
   */
  const runImportPlan = async (plan: ImportPlan, mode: ImportMode) => {
    const before = {
      postprocess: getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState()),
      params: JSON.parse(JSON.stringify(useProjectTreeParamsStore.getState().params)) as typeof params,
      collections: [...useAssetLibraryStore.getState().collections],
      identifier: useCompositeV2Store.getState().identifier,
    }
    setImporting(true)
    try {
      const result = await applyConsoleImport({ ...plan, mode }, buildImportActions(), buildImportContext())
      showToast(`已导入 ${result.written} 项`, 'success')
    } catch (error) {
      restorePostprocessMediaConfig(before.postprocess)
      useProjectTreeParamsStore.setState({ params: before.params })
      useAssetLibraryStore.setState({ collections: before.collections })
      useCompositeV2Store.setState({ identifier: before.identifier })
      showToast(`导入失败，已回滚到导入前：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  /**
   * 选文件 → 解析 → 算计划 → dry-run 弹窗。
   *
   * 预览用 `confirmDialog` 的 `buttons`（它支持任意多按钮），三种选择各自是一颗显式按钮：
   * **合并**（安全，默认）、**整体覆盖**（先清空尺寸再写）、**取消**。
   * 不用「confirm 位 + cancel 位」那种两按钮妥协 —— 那会逼着不想覆盖的人去点危险按钮旁边的「取消」。
   */
  const handleImport = async () => {
    setImporting(true)
    try {
      const tables = await pickConsoleWorkbook()
      if (!tables) return // 用户取消选文件，安静收场
      if ([...tables.values()].every((table) => table.rows.length === 0)) {
        showToast('这份文件里没有可导入的数据行', 'error')
        return
      }
      const plan = planConsoleImport(tables, buildImportContext(), 'merge')
      setConfirmDialog({
        title: '导入中控台数据',
        message: formatImportPlan(plan),
        messageAlign: 'left',
        buttons: [
          { label: '合并导入', tone: 'primary', action: () => void runImportPlan(plan, 'merge') },
          { label: '整体覆盖', tone: 'danger', action: () => void runImportPlan(plan, 'replace') },
          { label: '取消', tone: 'secondary', action: () => undefined },
        ],
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    // 高度对齐另外两个工作区：顶栏在自己的 return 里放了一块等高的 `invisible` 占位，
    // 所以这里按「视口 - 顶栏高度」算即可。窄屏顶栏多一行工作区切换，与素材库同口径取 7rem。
    <main
      aria-label="中控台工作区"
      className="flex h-[calc(100dvh-7rem)] min-h-0 overflow-hidden bg-ds-surface text-ds-text sm:h-[calc(100dvh-var(--app-header-offset))] dark:bg-ds-scrim dark:text-ds-text-subtle"
    >
      {/*
       * 左树 = 项目树（业务线 / 产品 / 方向）：管「改谁」，增删改查都在树上做。
       * 「改什么」交给右区那排 tab —— 维度**不进树**：树只有一棵，维度是另一条轴，
       * 两者套成一层嵌套必然把同一棵作用域树复制好几份（2026-09-21 上午的教训）。
       */}
      <ConsoleAssetTree value={scope} onValueChange={setScope} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0">
            {/* 标题只写「改谁」——「改什么」由下面那排 tab 自己说 */}
            <h1 className="truncate text-base font-semibold text-ds-text dark:text-ds-text">{scopeTitle}</h1>
            <p className="truncate text-xs text-ds-muted dark:text-ds-muted">
              {scopePath} · {active.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/*
             * 「新建方向」撤掉了：项目树每个节点悬停就有「+」，两处入口迟早出现
             * 「在 A 加了、在 B 看不到」。一个动作只留一个入口。
             */}
            {isCardView && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  createPreset('新预设')
                  setWatermarkView('editor')
                }}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                新建预设
              </Button>
            )}
            {/*
             * 导出放在工作区标题栏而不是某个分区里：它导的是**整个中控台**的数据面，
             * 不属于任何单一分区（放进分区会让人以为只导那一块）。
             */}
            <Button variant="ghost" size="sm" disabled={importing} onClick={() => void handleImport()}>
              {importing ? '处理中…' : '导入 Excel'}
            </Button>
            <Button variant="secondary" size="sm" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? '导出中…' : '导出 Excel'}
            </Button>
          </div>
        </header>

        {/*
         * 「改什么」就是这一排。它跟着左树选中的节点走：树管「谁」、tab 管「哪块」，
         * 各点一次，互不重叠。
         */}
        <div className="shrink-0 px-4 pt-2.5">
          <Tabs
            aria-label="参数分区"
            size="sm"
            value={activeSection}
            items={CONTROL_CONSOLE_SECTIONS.map((item) => ({ value: item.id, label: item.label }))}
            onValueChange={(next) => {
              setControlConsoleSection(next)
              // 切 tab 时回到卡片视图：否则从编辑器切走再切回来会停在编辑器，与工具栏筛选不一致
              setWatermarkView('cards')
            }}
          />
        </div>

        <div className="pt-2.5">
          <ConsoleToolbar
            presetCardMode={activeSection === 'watermark'}
            bindingFilter={bindingFilter}
            onBindingFilterChange={setBindingFilter}
            query={query}
            onQueryChange={setQuery}
            perRow={perRow}
            onPerRowChange={setPerRow}
            view={view}
            onViewChange={setView}
            visibleCount={visiblePresets.length}
            selectedCount={selectedIds.length}
            onSelectAll={() => setSelectedIds(visiblePresets.map((preset) => preset.id))}
            onClearSelection={() => setSelectedIds([])}
            canToggleEnabled={!isGlobal}
            onEnableSelected={() => {
              writeNodePresetIds(Array.from(new Set([...effectivePresetIds, ...selectedIds])))
              setSelectedIds([])
            }}
            onDisableSelected={() => {
              writeNodePresetIds(effectivePresetIds.filter((id) => !selectedIds.includes(id)))
              setSelectedIds([])
            }}
            onDuplicateSelected={() => duplicateMany(selectedIds)}
            onDeleteSelected={() => confirmDelete(selectedIds)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/*
           * 「渠道与尺寸」「分发」是全局唯一的，选哪个节点看到的都是同一套。
           * 这里只加一句说明，**不隐藏也不置灰** —— 藏起来会让人切来切去找不着，
           * 而它确实是要改的东西，只是不按方向分。
           */}
          {active.globalOnly && (
            <p className="mb-2 text-xs text-ds-muted dark:text-ds-muted">
              全局设置，所有方向共用 —— 这一块不按方向分。
            </p>
          )}

          {activeSection === 'watermark' && watermarkView === 'cards' && (
            <ConsolePresetGrid
              presets={visiblePresets}
              perRow={perRow}
              view={view}
              inNodeScope={!isGlobal}
              isEnabled={(presetId) => effectivePresetIds.includes(presetId)}
              usedByCount={usedByCount}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleEnabled={toggleEnabled}
              onEdit={openInEditor}
              onDuplicate={(presetId) => duplicateMany([presetId])}
              onDelete={(presetId) => confirmDelete([presetId])}
              emptyHint={
                presets.length === 0
                  ? '水印库是空的，点右上角「新建预设」开始。'
                  : '当前筛选条件下没有预设，换个关键词或把「归属范围」调回「全部预设」。'
              }
            />
          )}

          {activeSection === 'watermark' && watermarkView === 'editor' && (
            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setWatermarkView('cards')}>
                  返回卡片
                </Button>
                <span className="text-xs text-ds-muted dark:text-ds-muted">画布编辑与预设库；改动即时写回卡片。</span>
              </div>
              <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-ds-lg border border-ds-border dark:border-ds-border">
                <PresetManagementTab />
              </div>
            </div>
          )}

          {activeSection === 'media' && <MediaSection />}
          {activeSection === 'output' && <OutputSection scope={scope} />}
          {activeSection === 'distribution' && <DistributionSection />}
        </div>
      </div>
    </main>
  )
}
