import { useEffect, useMemo, useState } from 'react'
import { Button, Tabs } from '../../design-system'
import {
  CONTROL_CONSOLE_SECTIONS,
  DEFAULT_CONTROL_CONSOLE_SECTION,
  isGlobalScope,
  normalizeControlConsoleSection,
  type ConsoleScope,
} from './lib/controlConsoleSections'
import { ConsoleAssetTree } from './components/ConsoleAssetTree'
import { MediaSection } from './components/MediaSection'
import { OutputSection } from './components/OutputSection'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import {
  getPostprocessMediaConfigSnapshot,
  restorePostprocessMediaConfig,
  usePostprocessMediaStore,
} from '../../storePostprocessMedia'
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
 * 业务线 → 产品 → 方向                  水印 / 输出位置 / 渠道与尺寸
 * 管「改谁」，增删改查都在树上           管「改什么」，跟着树上选中哪一层走
 * ```
 *
 * **树是全局的**（杰哥 2026-09-21）：它管的是整个框架，画廊侧栏与项目树读的是同一份
 * `useAssetLibraryStore.collections`，所以树上一处改动三处同步。
 *
 * **业务模型：方向自带一整套参数，生成图时直接调用**（杰哥 2026-09-20 明确）。
 * 所以左树是参数的组织骨架，不是可选的筛选器：
 * - 选中某个方向 ⇒ 右区就是**该方向的参数**——水印库里逐套勾选开关，
 *   输出位置按这个方向改；
 * - 选中「全局默认」⇒ 右区是全局基线（水印在此只读：
 *   全局清单在前端没有写入点，各方向自己声明才是权威）。
 *
 * ⚠️ 水印分区的形态（杰哥 2026-09-21 定了三条，别再改回去）：
 * 1. **不再有「水印归属」侧栏**：归属看的就是左边这棵树（同一份 `collections`、
 *    同一个选中），编辑器里再放一棵等于同一件事开两个入口；
 * 2. **不做「卡片 → 点编辑 → 编辑器」的中转**：水印分区打开就是编辑器本身；
 * 3. **编辑器高度撑满剩余分区**：它不吃滚动容器 —— 套上 `overflow-y-auto` 之后
 *    会被内容高度顶住，窗口再高也不长，下面就是一片空白。
 * 归属的编辑动作（这个方向用哪几套）落在编辑器水印库的**行勾选框**上，
 * 见 `PresetManagementTab` 里 `togglePresetEnabled`。
 *
 * ⚠️ 准入约束：**有节点级字段的参数才消费作用域**。
 * `PostprocessNodeOverride` 现有 `outputDir` / `byMedia` / `watermarkPresetIds` /
 * `selectedMediaIds`（ADR-0013 加回）/ `enabled`，于是两个分区都是**混合**的：
 * - 「渠道与尺寸」：渠道名与尺寸规格是全局一套，**「参与产出」跟着作用域走**；
 * - 「输出位置」：渠道导出目录跟着作用域走，文件命名 / 分发 / 产出预览是全局一套。
 *
 * 混合的分区**不再**在顶上挂「全局设置」提示条（2026-09-21 连同 `globalOnly` 字段一起删了）：
 * 一条分区级的话说不清哪一半是全局，只会连不该覆盖的那一半一起误导 ——
 * 改成每个小节在自己的标题里说清属于哪一层。
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

  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)

  const showToast = useStore((state) => state.showToast)

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
  /** Ctrl+Z 撤销。输入框里不接管——否则打错字按 Ctrl+Z 会撤掉上一次画布操作。 */
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
             * 「新建预设」撤掉了：水印库栏右上角就有「+」，而水印分区现在打开即编辑器，
             * 不再有「先去卡片层、再点编辑」这一步。「新建方向」也是同一个道理 ——
             * 树节点悬停就有「+」。一个动作只留一个入口。
             */}
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
            onValueChange={setControlConsoleSection}
          />
        </div>

        {/*
         * 高度分两种给法：
         * - **水印**是编辑器：画布与图层面板要自己吃掉剩余高度，套一层滚动容器会让它被
         *   内容高度顶住 —— 窗口高的时候下面就是一片空白（2026-09-21 修）；
         * - 其余分区是表格 / 表单：内容可能超长，交给滚动容器。
         */}
        {activeSection === 'watermark' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-3">
            <PresetManagementTab />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {/*
             * 两个分区都消费作用域（各自内部有混合层，由小节标题说清）。
             * 原先这里按 `active.globalOnly` 挂过一句「全局设置，所有方向共用」——
             * 2026-09-21 连同那个字段一起删了，理由见文件头注。
             */}
            {activeSection === 'media' && <MediaSection scope={scope} />}
            {activeSection === 'output' && <OutputSection scope={scope} />}
          </div>
        )}
      </div>
    </main>
  )
}
