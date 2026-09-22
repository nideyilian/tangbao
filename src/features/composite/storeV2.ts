/**
 * 水印预设 store（A 套「后期处理工作区」的全部遗产）。
 *
 * 这个 store 原来装着两件事：水印预设编辑 + 整套批量导出编排（导出队列、任务流、
 * 分发、输出规则、历史记录、自定义命名变量）。编排已统一到 `features/postprocess`
 * 那一套，本 store 只保留前者。
 *
 * ⚠️ **水印库按产品隔离**（2026-09-21）：`presets` 仍是**一个扁平数组**，隔离靠每条的
 * `productId` 字段 + 界面上按产品的过滤（`filterPresetsByProduct`），
 * **不是** `Record<productId, presets[]>`。选扁平 + 标签而不是分桶，理由有三个：
 * ① 归属引用（`params[节点].postprocess.watermarkPresetIds`）存的是 **preset id**，
 *    分桶后「这套预设现在在哪个桶里」要多一层查找，且搬桶就是换 id，引用会集体失效；
 * ② 撤销快照 / 导入导出 / 资产引用扫描（`compositeAssets.ts`）都在遍历这一份数组，
 *    分桶等于把这几条链路全部改一遍，收益却一样；
 * ③ id 全局唯一本来就保证了「不会张冠李戴」，隔离要解决的是**看与选**，不是 id 冲突。
 *
 * 持久化：localStorage（`tangbao-composite-v2-workspace-storage`）。
 * version 3 → 4：编排字段（预设的输出目录、命名模板、自定义变量、渠道尺寸覆盖）随 A 套退役。
 * version 4 → 5：**预设组**退役。它当时唯一的作用是给左栏库做筛选，与归属/产出零关系，
 * 于是「哪套水印该给哪个方向用」只能靠人脑记。现在分组交给项目树本身——方向节点上
 * 挂哪些预设就是分组，而且它就是归属。两次迁移都是**丢弃式**的，预设本身原样保留。
 */
import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { persist } from 'zustand/middleware'
import { createPreviewHistory } from './lib/compositeBackgrounds'
import { normalizePresetProductId, planPresetCopies } from './lib/compositePresetLibrary'
import { createDefaultCompositeV2State } from './lib/compositeV2Defaults'
import { createDefaultIdentifier, normalizeIdentifier } from './lib/compositeIdentifier'
import { fitCompositeTextLayer } from './lib/compositeTextLayout'
import { hasLegacyCompositeAssets, migrateLegacyCompositeAssets } from './lib/compositeAssetMigration'
import type {
  CompositeV2IdentifierConfig,
  CompositeV2BackgroundImage,
  CompositeV2FitMode,
  CompositeV2ImageAssetRef,
  CompositeV2Layer,
  CompositeV2PersistedSnapshot,
  CompositeV2State,
} from './lib/compositeV2Types'

type CompositeV2BatchState = {
  backgroundFolders: string[]
  recursiveBackgrounds: boolean
  backgrounds: CompositeV2BackgroundImage[]
  previewHistory: string[]
  previewHistoryIndex: number
  selectedPreviewPresetId: string
  clipboardLayer: CompositeV2Layer | null
}

type CompositeV2UndoSnapshot = {
  logoLibraryPath: string
  logoOrder: string[]
  projectLogos: CompositeV2State['projectLogos']
  identifier?: CompositeV2State['identifier']
  backgroundFolders: string[]
  recursiveBackgrounds: boolean
  backgrounds: CompositeV2BackgroundImage[]
  previewHistory: string[]
  previewHistoryIndex: number
  selectedPreviewPresetId: string
  presets: CompositeV2State['presets']
  globalFitMode: CompositeV2FitMode
}

type CompositeV2UndoState = {
  undoStack: CompositeV2UndoSnapshot[]
  redoStack: CompositeV2UndoSnapshot[]
  lastHistoryMeta: { mergeKey: string; timestamp: number } | null
  canUndo: boolean
  canRedo: boolean
}

/**
 * store 自己的记账字段（不属于水印数据模型，但必须跟着持久化走）。
 */
type CompositeV2LocalState = {
  /**
   * 「按现有归属推断水印归属产品」这次迁移跑过的版本号；0 = 没跑过。见
   * `lib/compositePresetProductMigration.ts`。
   *
   * **必须留这个标记**：迁移的输入是「哪个产品下的方向勾了这套水印」，而
   * **未分配是合法状态**（用户能主动把水印摘出产品）。没有标记的话，用户摘出来的水印
   * 会在下次启动被「自动收回」——最难查的那类「我明明删了，它自己又回来了」。
   */
  presetProductMigrationVersion: number
}

type CompositeV2StoreActions = {
  undo: () => void
  redo: () => void
  setLogoLibraryPath: (path: string) => void
  setLogoOrder: (order: string[]) => void
  addProjectLogos: (logos: CompositeV2State['projectLogos']) => void
  removeProjectLogo: (id: string) => void
  renameProjectLogo: (id: string, name: string) => void
  setBackgroundFolders: (paths: string[]) => void
  setRecursiveBackgrounds: (recursive: boolean) => void
  setBackgrounds: (backgrounds: CompositeV2BackgroundImage[]) => void
  updatePreset: (presetId: string, patch: Partial<CompositeV2State['presets'][number]>) => void
  addImageLayer: (presetId: string, asset?: CompositeV2ImageAssetRef) => void
  replaceOrAddLogoLayer: (presetId: string, asset: CompositeV2ImageAssetRef, selectedLayerId?: string) => string
  addTextLayer: (presetId: string) => void
  addLogoLayer: (presetId: string) => void
  setSelectedPreviewPresetId: (presetId: string) => void
  pushPreviewBackground: (path: string) => void
  previousPreviewBackground: () => void
  nextPreviewBackground: () => void
  createPreset: (name: string, productId: string) => void
  deletePreset: (presetId: string) => void
  duplicatePreset: (presetId: string) => void
  /**
   * 把一批水印**复制到另一个产品**（跨产品复制；同产品内复制走 `duplicatePreset`）。
   *
   * 复制是「另起一套」：id 换新、归属改为目标产品、内容整套带过去，
   * 且**不自动被任何方向勾选** —— 详情与口径见 `planPresetCopies`。
   * 目标产品与源产品相同时不复制（那等于原地再建一套，界面上也不会给这个选项）。
   */
  copyPresetsToProduct: (presetIds: string[], productId: string) => void
  /**
   * 把预设改归到某个产品（空串 = 摘成「未分配」）。
   *
   * 两个使用者：① 启动时按现有归属推断产品的一次性迁移；② 界面上「未分配」区的一键指派。
   */
  assignPresetProduct: (presetId: string, productId: string) => void
  /**
   * 批量指派（产品被删时把它的水印摘成未分配、或一次性收编一批未分配水印）。
   *
   * 逐条走 `assignPresetProduct` 的成本是每次一条撤销记录，批量的场景下会把撤销栈打满，
   * 所以这里合并成一次写入。
   */
  assignPresetsToProduct: (presetIds: string[], productId: string) => void
  mergeImportedPresets: (imported: CompositeV2State['presets']) => void
  copyLayer: (presetId: string, layerId: string) => void
  pasteLayer: (presetId: string) => void
  duplicateLayer: (presetId: string, layerId: string) => void
  setGlobalFitMode: (mode: CompositeV2FitMode) => void
  setIdentifier: (patch: Partial<CompositeV2IdentifierConfig>) => void
}

export type CompositeV2StoreState = CompositeV2BatchState &
  CompositeV2UndoState &
  CompositeV2LocalState &
  CompositeV2State &
  CompositeV2StoreActions

export type CompositeV2PersistedState = CompositeV2PersistedSnapshot & {
  /** 见 `CompositeV2LocalState.presetProductMigrationVersion` */
  presetProductMigrationVersion: number
}

export type CreateCompositeV2StoreOptions = {
  pickRandomIndex?: (length: number) => number
}

const STORAGE_NAME = 'tangbao-composite-v2-workspace-storage'
const DEFAULT_LAYER_POSITION = { mode: 'free' as const, x: 100, y: 100, width: 240, height: 120 }
const DEFAULT_LAYER_SHADOW = { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 }
const DEFAULT_LAYER_STROKE = { enabled: false, color: '#111827', width: 0 }
const HISTORY_LIMIT = 100
const HISTORY_MERGE_WINDOW_MS = 1200
/**
 * 持久化版本。
 * 4 → 5：**预设组**退役（分组交给项目树，预设不再需要自己的分组壳）。
 *   必须靠迁移把 `presetGroups` / `selectedPresetGroupId` 丢掉——否则旧数据反序列化
 *   会把脏字段写回，且 `merge` 还会拿它去校验当前预览的预设，导致选中态莫名清空。
 * 5 → 6：新增**水印标识符**（`identifier`，全局一份）。旧数据没有这个字段，迁移时补默认值
 *   （空文本 = 不附加），因此升级后已配好的水印**渲染结果不变**。
 * 6 → 7：新增**预设归属产品**（`preset.productId`），水印库从「全局一批」改为**按产品隔离**。
 *   迁移这里只补空串（= 未分配），**真正的归属推断在启动后另跑一次**（`migratePresetProducts`）——
 *   `persist.migrate` 拿不到 `collections` / `params`（它们是另外两个 store），
 *   在那个位置算不出「这套水印被哪个产品的方向勾过」。
 */
const COMPOSITE_V2_PERSIST_VERSION = 7

export function createCompositeV2StoreState(): CompositeV2BatchState &
  CompositeV2UndoState &
  CompositeV2LocalState &
  CompositeV2State {
  const defaults = createDefaultCompositeV2State()

  return {
    logoLibraryPath: defaults.logoLibraryPath,
    logoOrder: [],
    projectLogos: [],
    backgroundFolders: [],
    recursiveBackgrounds: false,
    backgrounds: [],
    previewHistory: [],
    previewHistoryIndex: -1,
    selectedPreviewPresetId: defaults.presets[0]?.id ?? '',
    presets: defaults.presets,
    globalFitMode: defaults.globalFitMode,
    identifier: createDefaultIdentifier(),
    clipboardLayer: null,
    undoStack: [],
    redoStack: [],
    lastHistoryMeta: null,
    canUndo: false,
    canRedo: false,
    presetProductMigrationVersion: 0,
  }
}

export function getCompositeV2PersistedState(state: CompositeV2StoreState): CompositeV2PersistedState {
  return {
    logoLibraryPath: state.logoLibraryPath,
    logoOrder: state.logoOrder ?? [],
    projectLogos: state.projectLogos ?? [],
    presets: state.presets,
    globalFitMode: state.globalFitMode,
    identifier: normalizeIdentifier(state.identifier),
    backgroundFolders: state.backgroundFolders,
    recursiveBackgrounds: state.recursiveBackgrounds,
    selectedPreviewPresetId: state.selectedPreviewPresetId,
    presetProductMigrationVersion: state.presetProductMigrationVersion ?? 0,
  }
}

export function mergeCompositeV2PersistedState(
  persistedState: unknown,
  currentState: CompositeV2StoreState,
): CompositeV2StoreState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = migrateCompositeV2PersistedState(persistedState, COMPOSITE_V2_PERSIST_VERSION)
  const merged = { ...currentState, ...persisted } as CompositeV2StoreState
  const requestedPreviewPresetId = persisted.selectedPreviewPresetId ?? currentState.selectedPreviewPresetId
  // 选中态只在「预设确实还在」时保留：预设被删掉之后还留着 id，画布区会永远空着且不回退。
  const presetExists = merged.presets.some((preset) => preset.id === requestedPreviewPresetId)
  const selectedPreviewPresetId = presetExists ? requestedPreviewPresetId : (merged.presets[0]?.id ?? '')

  return { ...merged, selectedPreviewPresetId }
}

/**
 * 持久化迁移。**只做丢弃，不做换算**：
 * A 套预设的输出目录/命名模板/自定义变量/渠道尺寸覆盖在新模型里没有对应物
 * （后处理那边由「项目树参数 + 媒体表」决定），所以直接不搬。
 * 预设组同理——分组这件事已归项目树，组本身没有第二处容身之所。
 * 素材本身（预设 id/名称/画布/图层）原样保留，用户的图层工作不会丢。
 */
export function migrateCompositeV2PersistedState(persistedState: unknown, _version: number): CompositeV2PersistedState {
  if (!persistedState || typeof persistedState !== 'object') {
    return getCompositeV2PersistedState(createCompositeV2StoreState() as CompositeV2StoreState)
  }

  const legacy = persistedState as Record<string, unknown>
  const presets = (Array.isArray(legacy.presets) ? legacy.presets : [])
    .filter((preset): preset is Record<string, unknown> => Boolean(preset) && typeof preset === 'object')
    .map((preset): CompositeV2State['presets'][number] => ({
      id: typeof preset.id === 'string' ? preset.id : '',
      name: typeof preset.name === 'string' ? preset.name : '',
      // 老数据没有这个字段 → 空串 = 未分配；启动后由 `migratePresetProducts` 按现有归属推断
      productId: normalizePresetProductId(preset.productId),
      baseCanvas: normalizeCanvas(preset.baseCanvas),
      sampleBackgroundPath: typeof preset.sampleBackgroundPath === 'string' ? preset.sampleBackgroundPath : '',
      layers: Array.isArray(preset.layers) ? (preset.layers as CompositeV2State['presets'][number]['layers']) : [],
      updatedAt: typeof preset.updatedAt === 'number' ? preset.updatedAt : Date.now(),
    }))
    .filter((preset) => preset.id !== '')

  return {
    logoLibraryPath: typeof legacy.logoLibraryPath === 'string' ? legacy.logoLibraryPath : '',
    logoOrder: Array.isArray(legacy.logoOrder) ? (legacy.logoOrder as string[]) : [],
    projectLogos: Array.isArray(legacy.projectLogos) ? (legacy.projectLogos as CompositeV2State['projectLogos']) : [],
    presets,
    globalFitMode: normalizeFitMode(legacy.globalFitMode),
    identifier: normalizeIdentifier(legacy.identifier),
    backgroundFolders: Array.isArray(legacy.backgroundFolders) ? (legacy.backgroundFolders as string[]) : [],
    recursiveBackgrounds: Boolean(legacy.recursiveBackgrounds),
    selectedPreviewPresetId:
      typeof legacy.selectedPreviewPresetId === 'string' ? legacy.selectedPreviewPresetId : undefined,
    presetProductMigrationVersion:
      typeof legacy.presetProductMigrationVersion === 'number' && Number.isFinite(legacy.presetProductMigrationVersion)
        ? Math.trunc(legacy.presetProductMigrationVersion)
        : 0,
  }
}

function normalizeCanvas(value: unknown): { width: number; height: number } {
  const record = (value ?? {}) as { width?: unknown; height?: unknown }
  const width = Number(record.width)
  const height = Number(record.height)
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1280,
    height: Number.isFinite(height) && height > 0 ? height : 720,
  }
}

function normalizeFitMode(value: unknown): CompositeV2FitMode {
  return value === 'contain-blur' || value === 'stretch' || value === 'crop-fill' ? value : 'crop-fill'
}

/**
 * 用外部快照（备份恢复 / 导入）整体替换预设状态。
 *
 * 参数收 `CompositeV2PersistedSnapshot`（不含 `presetProductMigrationVersion`）：备份 ZIP 里的
 * compositeState 是 v7 之前导出的，本来就没有这个字段。缺字段时按 0 处理 → 恢复后会重跑一次
 * 归属迁移，而迁移对**已有归属**的预设是空操作（`planPresetProductClaim` 直接跳过），所以安全。
 */
export function replaceCompositeV2PersistedState(snapshot: CompositeV2PersistedSnapshot): void {
  const merged = mergeCompositeV2PersistedState(snapshot, useCompositeV2Store.getState())
  useCompositeV2Store.setState(getCompositeV2PersistedState(merged))
}

/**
 * 按覆盖范围合并水印库：**同 id 以包为准，本地独有的按 `localOnly` 决定去留**。
 *
 * 为什么不直接 `replaceCompositeV2PersistedState`：那是**整份替换** —— 一次拉取就会把
 * 本地自己建的水印抹掉。而项目树那边一直是「保留本地独有」（ADR-0014 §七 的取舍），
 * 两者口径曾经不一致，结果是**最坏的那种**：「树还在，挂在树上的水印没了」——
 * 界面上看着都对，产出却变了，还不报错。
 */
export function mergeCompositeV2Library(snapshot: CompositeV2PersistedSnapshot, localOnly: 'keep' | 'drop'): void {
  // 「完全以发布方为准」那档：整份替换就对了（本地独有的随它一起去）
  if (localOnly === 'drop') {
    replaceCompositeV2PersistedState(snapshot)
    return
  }

  const current = useCompositeV2Store.getState()
  const incomingPresetIds = new Set(snapshot.presets.map((preset) => preset.id))
  const incomingLogoIds = new Set(snapshot.projectLogos.map((logo) => logo.id))
  const localOnlyPresets = (current.presets ?? []).filter((preset) => !incomingPresetIds.has(preset.id))
  const localOnlyLogos = (current.projectLogos ?? []).filter((logo) => !incomingLogoIds.has(logo.id))
  if (localOnlyPresets.length === 0 && localOnlyLogos.length === 0) {
    replaceCompositeV2PersistedState(snapshot)
    return
  }

  replaceCompositeV2PersistedState({
    ...snapshot,
    // 包里的在前（保持发布方那份的顺序），本地独有的接在后面。**顺序即产出顺序** ——
    // 把本地的插到中间，会让"同样的配置每次跑出不同顺序"。
    presets: [...snapshot.presets, ...localOnlyPresets],
    projectLogos: [...snapshot.projectLogos, ...localOnlyLogos],
    // `logoOrder` 是 id 列表：包里的顺序 + 本地独有的（它们原来是什么顺序就什么顺序）
    logoOrder: [...snapshot.logoOrder, ...localOnlyLogos.map((logo) => logo.id)],
  })
}

export function createCompositeV2Store(options: CreateCompositeV2StoreOptions = {}) {
  return createStore<CompositeV2StoreState>()(createCompositeV2StoreInitializer(options))
}

export const useCompositeV2Store = create<CompositeV2StoreState>()(createCompositeV2StoreInitializer())

queueMicrotask(() => {
  const state = useCompositeV2Store.getState()
  if (!hasLegacyCompositeAssets(state)) return
  void migrateLegacyCompositeAssets({
    getState: useCompositeV2Store.getState,
    setState: (patch) => useCompositeV2Store.setState(patch),
  }).catch((error) => console.error('后期处理资源迁移失败:', error))
})

function createCompositeV2StoreInitializer(options: CreateCompositeV2StoreOptions = {}) {
  const pickRandomIndex = options.pickRandomIndex ?? defaultPickRandomIndex

  return persist<CompositeV2StoreState, [], [], CompositeV2PersistedState>(
    (set, get) => {
      const setWithHistory = (
        updater: (state: CompositeV2StoreState) => Partial<CompositeV2StoreState> | {},
        mergeKey?: string,
      ) => {
        set((state) => {
          const patch = updater(state)
          if (!patch || Object.keys(patch).length === 0) return patch
          const prevSnapshot = captureUndoSnapshot(state)
          const nextSnapshot = captureUndoSnapshot({ ...state, ...patch } as CompositeV2StoreState)
          if (areUndoSnapshotsEqual(prevSnapshot, nextSnapshot)) return patch
          const now = Date.now()
          const shouldMerge = Boolean(
            mergeKey &&
            state.lastHistoryMeta &&
            state.lastHistoryMeta.mergeKey === mergeKey &&
            now - state.lastHistoryMeta.timestamp <= HISTORY_MERGE_WINDOW_MS,
          )
          const undoStack = shouldMerge
            ? state.undoStack
            : trimHistoryStack([...state.undoStack, structuredClone(prevSnapshot)])
          return {
            ...patch,
            undoStack,
            redoStack: [],
            lastHistoryMeta: mergeKey ? { mergeKey, timestamp: now } : null,
            canUndo: undoStack.length > 0,
            canRedo: false,
          }
        })
      }

      const setWithoutHistory = (updater: (state: CompositeV2StoreState) => Partial<CompositeV2StoreState> | {}) => {
        set((state) => updater(state))
      }

      return {
        ...createCompositeV2StoreState(),
        undo: () =>
          set((state) => {
            const snapshot = state.undoStack[state.undoStack.length - 1]
            if (!snapshot) return {}
            const currentSnapshot = captureUndoSnapshot(state)
            const undoStack = state.undoStack.slice(0, -1)
            const redoStack = trimHistoryStack([...state.redoStack, structuredClone(currentSnapshot)])
            return {
              ...applyUndoSnapshot(snapshot),
              undoStack,
              redoStack,
              lastHistoryMeta: null,
              canUndo: undoStack.length > 0,
              canRedo: redoStack.length > 0,
            }
          }),
        redo: () =>
          set((state) => {
            const snapshot = state.redoStack[state.redoStack.length - 1]
            if (!snapshot) return {}
            const currentSnapshot = captureUndoSnapshot(state)
            const undoStack = trimHistoryStack([...state.undoStack, structuredClone(currentSnapshot)])
            const redoStack = state.redoStack.slice(0, -1)
            return {
              ...applyUndoSnapshot(snapshot),
              undoStack,
              redoStack,
              lastHistoryMeta: null,
              canUndo: undoStack.length > 0,
              canRedo: redoStack.length > 0,
            }
          }),
        setLogoLibraryPath: (logoLibraryPath) => setWithHistory(() => ({ logoLibraryPath }), 'logos:library-path'),
        setLogoOrder: (logoOrder) => setWithHistory(() => ({ logoOrder }), 'logos:order'),
        addProjectLogos: (logos) =>
          setWithHistory((state) => ({ projectLogos: [...(state.projectLogos ?? []), ...logos] }), 'logos:assets'),
        removeProjectLogo: (id) =>
          setWithHistory(
            (state) => ({ projectLogos: (state.projectLogos ?? []).filter((l) => l.id !== id) }),
            'logos:assets',
          ),
        renameProjectLogo: (id, name) =>
          setWithHistory(
            (state) => ({ projectLogos: (state.projectLogos ?? []).map((l) => (l.id === id ? { ...l, name } : l)) }),
            'logos:assets',
          ),
        setBackgroundFolders: (backgroundFolders) =>
          setWithHistory(() => ({ backgroundFolders }), 'backgrounds:source'),
        setRecursiveBackgrounds: (recursiveBackgrounds) =>
          setWithHistory(() => ({ recursiveBackgrounds }), 'backgrounds:source'),
        setBackgrounds: (backgrounds) =>
          setWithHistory(
            () => ({
              backgrounds,
              ...createRandomPreviewState(backgrounds, pickRandomIndex),
            }),
            'backgrounds:source',
          ),
        updatePreset: (presetId, patch) =>
          setWithHistory(
            (state) => ({
              presets: updatePresets(state.presets, presetId, (preset, now) => ({
                ...preset,
                ...patch,
                updatedAt: now,
              })),
            }),
            getPresetPatchMergeKey(presetId, patch),
          ),
        addImageLayer: (presetId, asset) =>
          setWithHistory(
            (state) => ({
              presets: updatePresets(state.presets, presetId, (preset, now) => ({
                ...preset,
                layers: [...preset.layers, createImageLayer(asset ?? null, now, preset.baseCanvas)],
                updatedAt: now,
              })),
            }),
            `preset:${presetId}:layers`,
          ),
        replaceOrAddLogoLayer: (presetId, asset, selectedLayerId) => {
          let resolvedLayerId = ''
          setWithHistory(
            (state) => ({
              presets: updatePresets(state.presets, presetId, (preset, now) => {
                const selectedIndex = preset.layers.findIndex(
                  (layer) => layer.id === selectedLayerId && layer.type === 'logo',
                )
                const logoIndex =
                  selectedIndex >= 0 ? selectedIndex : preset.layers.findIndex((layer) => layer.type === 'logo')
                if (logoIndex >= 0) {
                  const layers = [...preset.layers]
                  const logo = layers[logoIndex]!
                  if (logo.type !== 'logo') return preset
                  resolvedLayerId = logo.id
                  layers[logoIndex] = { ...logo, asset }
                  return { ...preset, layers, updatedAt: now }
                }
                const logo = createLogoLayer(asset, now, preset.baseCanvas)
                resolvedLayerId = logo.id
                return { ...preset, layers: [...preset.layers, logo], updatedAt: now }
              }),
            }),
            `preset:${presetId}:layers`,
          )
          return resolvedLayerId
        },
        addTextLayer: (presetId) =>
          setWithHistory(
            (state) => ({
              presets: updatePresets(state.presets, presetId, (preset, now) => ({
                ...preset,
                layers: [...preset.layers, createTextLayer(now, preset.baseCanvas)],
                updatedAt: now,
              })),
            }),
            `preset:${presetId}:layers`,
          ),
        addLogoLayer: (presetId) =>
          setWithHistory(
            (state) => ({
              presets: updatePresets(state.presets, presetId, (preset, now) => ({
                ...preset,
                layers: [...preset.layers, createLogoLayer(null, now, preset.baseCanvas)],
                updatedAt: now,
              })),
            }),
            `preset:${presetId}:layers`,
          ),
        setSelectedPreviewPresetId: (selectedPreviewPresetId) => setWithoutHistory(() => ({ selectedPreviewPresetId })),
        pushPreviewBackground: (path) =>
          setWithoutHistory((state) => {
            if (!path.trim()) return {}
            return createPreviewHistoryState(state, (preview) => preview.push(path))
          }),
        previousPreviewBackground: () =>
          setWithoutHistory((state) => createPreviewHistoryState(state, (preview) => preview.previous())),
        nextPreviewBackground: () =>
          setWithoutHistory((state) => createPreviewHistoryState(state, (preview) => preview.next())),
        createPreset: (name, productId) =>
          setWithHistory((state) => {
            const now = Date.now()
            const preset: CompositeV2State['presets'][number] = {
              id: uniqueId('preset'),
              name: name.trim() || '新预设',
              // 落库即定归属：水印库按产品隔离，新建的水印必须属于当前作用域的那个产品 ——
              // 否则它会掉进「未分配」区，在当前产品的库里根本看不见（等于建了个看不见的东西）。
              productId: normalizePresetProductId(productId),
              baseCanvas: { width: 1080, height: 1920 },
              sampleBackgroundPath: '',
              layers: [],
              updatedAt: now,
            }
            return {
              presets: [...state.presets, preset],
              selectedPreviewPresetId: preset.id,
            }
          }, 'presets:structure'),
        assignPresetProduct: (presetId, productId) =>
          setWithHistory(
            (state) => ({
              presets: assignPresetsProduct(state.presets, [presetId], normalizePresetProductId(productId)),
            }),
            'presets:structure',
          ),
        assignPresetsToProduct: (presetIds, productId) =>
          setWithHistory(
            (state) => ({
              presets: assignPresetsProduct(state.presets, presetIds, normalizePresetProductId(productId)),
            }),
            'presets:structure',
          ),
        deletePreset: (presetId) =>
          setWithHistory((state) => {
            const presets = state.presets.filter((preset) => preset.id !== presetId)
            if (presets.length === state.presets.length) return {}
            // 只动预设本身：项目树参数里对它的引用**不清理**，那是刻意的——
            // 参数层不该偷偷改用户配好的归属，统一树会把「已失效」显示出来让用户自己决定。
            return {
              presets,
              selectedPreviewPresetId:
                state.selectedPreviewPresetId === presetId ? (presets[0]?.id ?? '') : state.selectedPreviewPresetId,
            }
          }, 'presets:structure'),
        duplicatePreset: (presetId) =>
          setWithHistory((state) => {
            const source = state.presets.find((preset) => preset.id === presetId)
            if (!source) return {}
            const preset = structuredClone({
              ...source,
              id: uniqueId('preset'),
              name: `${source.name} 副本`,
              updatedAt: Date.now(),
            })
            return {
              presets: [...state.presets, preset],
              selectedPreviewPresetId: preset.id,
            }
          }, 'presets:structure'),
        copyPresetsToProduct: (presetIds, productId) =>
          setWithHistory((state) => {
            const copies = planPresetCopies({
              presets: state.presets,
              presetIds,
              targetProductId: productId,
              makeId: () => uniqueId('preset'),
              now: Date.now(),
            })
            if (copies.length === 0) return {}
            // **不动 `selectedPreviewPresetId`**：目标通常是别的产品，而画布只在**当前产品**的库里找预设。
            // 把选中态指过去，画布会切到一套左栏根本不列的预设，看起来像「选中的东西不见了」。
            return { presets: [...state.presets, ...copies] }
          }, 'presets:structure'),
        /**
         * 合并导入的预设：同 id 覆盖、**保留原位**，新 id 追加在末尾。
         *
         * 覆盖不新增条目是「导入 = 恢复」的语义；留在原位是为了不打断用户排好的顺序
         * （顺序即归属里的产出顺序，整体追加会把已有水印挤到后面）。
         *
         * ⚠️ **归属由调用方在送进来之前定好**：文件里的 `productId` 是**导出方机器上的产品 id**，
         * 在本机根本不存在，直接用会把这套水印归到一个查无此人的产品下（界面上既不在当前产品的库、
         * 也不在「未分配」区，等于导入完就消失）。所以调用方必须先按本机情况改写 `productId`，
         * 这里只负责合并，不做推断。
         */
        mergeImportedPresets: (imported) =>
          setWithHistory((state) => {
            if (imported.length === 0) return {}
            const presets = [...state.presets]
            for (const preset of imported) {
              const index = presets.findIndex((item) => item.id === preset.id)
              if (index >= 0) presets[index] = preset
              else presets.push(preset)
            }
            return { presets }
          }, 'presets:import'),
        copyLayer: (presetId, layerId) =>
          setWithoutHistory((state) => {
            const preset = state.presets.find((p) => p.id === presetId)
            if (!preset) return {}
            const layer = preset.layers.find((l) => l.id === layerId)
            if (!layer) return {}
            return { clipboardLayer: structuredClone(layer) }
          }),
        pasteLayer: (presetId) =>
          setWithHistory((state) => {
            if (!state.clipboardLayer) return {}
            return {
              presets: updatePresets(state.presets, presetId, (preset, now) => {
                const newLayer = {
                  ...structuredClone(state.clipboardLayer!),
                  id: `layer-${now}-${Math.random().toString(36).slice(2, 6)}`,
                }
                return {
                  ...preset,
                  layers: [...preset.layers, newLayer],
                  updatedAt: now,
                }
              }),
            }
          }, `preset:${presetId}:layers`),
        duplicateLayer: (presetId, layerId) =>
          setWithHistory(
            (state) => ({
              presets: updatePresets(state.presets, presetId, (preset, now) => {
                const index = preset.layers.findIndex((l) => l.id === layerId)
                if (index < 0) return preset
                const newLayer = {
                  ...structuredClone(preset.layers[index]!),
                  id: `layer-${now}-${Math.random().toString(36).slice(2, 6)}`,
                }
                const layers = [...preset.layers]
                layers.splice(index + 1, 0, newLayer)
                return { ...preset, layers, updatedAt: now }
              }),
            }),
            `preset:${presetId}:layers`,
          ),
        setGlobalFitMode: (globalFitMode) => setWithHistory(() => ({ globalFitMode }), 'output:fit-mode'),
        // 标识符是全局一份：改一次要立刻反映到**所有**预设的预览与后处理产出上，
        // 所以只改这一个字段，不去遍历预设（那会把一次输入变成 N 次预设写盘，且撤销栈爆掉）。
        setIdentifier: (patch) =>
          setWithHistory(
            (state) => ({ identifier: normalizeIdentifier({ ...state.identifier, ...patch }) }),
            'watermark:identifier',
          ),
      }
    },
    {
      name: STORAGE_NAME,
      version: COMPOSITE_V2_PERSIST_VERSION,
      partialize: getCompositeV2PersistedState,
      merge: mergeCompositeV2PersistedState,
      migrate: migrateCompositeV2PersistedState,
    },
  )
}

function createRandomPreviewState(
  backgrounds: CompositeV2BackgroundImage[],
  pickRandomIndex: (length: number) => number,
) {
  if (!backgrounds.length) {
    return { previewHistory: [], previewHistoryIndex: -1 }
  }

  const selectedBackground =
    backgrounds[clampIndex(pickRandomIndex(backgrounds.length), backgrounds.length)] ?? backgrounds[0]
  const preview = createPreviewHistory([selectedBackground.path]).snapshot()

  return {
    previewHistory: preview.entries,
    previewHistoryIndex: preview.index,
  }
}

function createPreviewHistoryState(
  state: Pick<CompositeV2StoreState, 'previewHistory' | 'previewHistoryIndex'>,
  updater: (preview: ReturnType<typeof createPreviewHistory>) => void,
) {
  const preview = createPreviewHistory({
    entries: state.previewHistory,
    index: state.previewHistoryIndex,
  })
  updater(preview)
  const snapshot = preview.snapshot()
  return {
    previewHistory: snapshot.entries,
    previewHistoryIndex: snapshot.index,
  }
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return -1
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.floor(index), 0), length - 1)
}

function defaultPickRandomIndex(length: number) {
  return Math.floor(Math.random() * length)
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function trimHistoryStack<T>(stack: T[]) {
  if (stack.length <= HISTORY_LIMIT) return stack
  return stack.slice(stack.length - HISTORY_LIMIT)
}

/**
 * 捕获撤销快照。数组元素在 store 中从不被原地修改（所有更新都整体替换新数组），
 * 因此这里用浅拷贝即可：对上千条 backgrounds 的 structuredClone 会在每次编辑时
 * 造成明显的卡顿，浅拷贝把每次快照成本从 O(元素深拷贝) 降到 O(数组长度)。
 */
function captureUndoSnapshot(state: CompositeV2StoreState): CompositeV2UndoSnapshot {
  return {
    logoLibraryPath: state.logoLibraryPath,
    logoOrder: [...(state.logoOrder ?? [])],
    projectLogos: [...(state.projectLogos ?? [])],
    identifier: state.identifier,
    backgroundFolders: [...state.backgroundFolders],
    recursiveBackgrounds: state.recursiveBackgrounds,
    backgrounds: [...state.backgrounds],
    previewHistory: [...state.previewHistory],
    previewHistoryIndex: state.previewHistoryIndex,
    selectedPreviewPresetId: state.selectedPreviewPresetId,
    presets: [...state.presets],
    globalFitMode: state.globalFitMode,
  }
}

function applyUndoSnapshot(snapshot: CompositeV2UndoSnapshot): Partial<CompositeV2StoreState> {
  return structuredClone(snapshot)
}

function areUndoSnapshotsEqual(a: CompositeV2UndoSnapshot, b: CompositeV2UndoSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function getPresetPatchMergeKey(presetId: string, patch: Partial<CompositeV2State['presets'][number]>) {
  const keys = Object.keys(patch).sort()
  return `preset:${presetId}:${keys.join(',') || 'update'}`
}

/**
 * 把一批预设改归到某个产品（空串 = 摘成未分配）。
 *
 * 已经是该产品的条目**原样返回**，让 `setWithHistory` 的「前后快照相等」判断生效 ——
 * 否则一次什么都没改的指派也会往撤销栈里塞一条，用户按 Ctrl+Z 会感觉「撤了但没反应」。
 */
function assignPresetsProduct(
  presets: CompositeV2State['presets'],
  presetIds: string[],
  productId: string,
): CompositeV2State['presets'] {
  const wanted = new Set(presetIds.map(normalizePresetProductId).filter(Boolean))
  if (wanted.size === 0) return presets
  // 指派只动归属这一个字段，**不碰 `updatedAt`**：它记的是「水印内容什么时候改的」，
  // 把归属变更算进去会让「按更新时间看谁刚被改过」这件事失真。
  let changed = false
  const next = presets.map((preset) => {
    if (!wanted.has(preset.id) || normalizePresetProductId(preset.productId) === productId) return preset
    changed = true
    return { ...preset, productId }
  })
  return changed ? next : presets
}

function updatePresets(
  presets: CompositeV2State['presets'],
  presetId: string,
  updater: (preset: CompositeV2State['presets'][number], now: number) => CompositeV2State['presets'][number],
) {
  let changed = false
  const now = Date.now()
  const nextPresets = presets.map((preset) => {
    if (preset.id !== presetId) return preset
    changed = true
    return updater(preset, now)
  })

  return changed ? nextPresets : presets
}

function createCenteredFreePosition(
  canvas: { width: number; height: number },
  size: { width: number; height: number },
) {
  return {
    mode: 'free' as const,
    x: Math.round((canvas.width - size.width) / 2),
    y: Math.round((canvas.height - size.height) / 2),
    width: size.width,
    height: size.height,
  }
}

function createImageLayer(
  asset: CompositeV2ImageAssetRef | null,
  now: number,
  baseCanvas: { width: number; height: number },
) {
  return {
    id: `image-layer-${now}`,
    type: 'image' as const,
    name: 'Image Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: createCenteredFreePosition(baseCanvas, {
      width: DEFAULT_LAYER_POSITION.width,
      height: DEFAULT_LAYER_POSITION.height,
    }),
    shadow: { ...DEFAULT_LAYER_SHADOW },
    stroke: { ...DEFAULT_LAYER_STROKE },
    asset,
    radius: 0,
    clip: false,
  }
}

function createLogoLayer(
  asset: CompositeV2ImageAssetRef | null,
  now: number,
  baseCanvas: { width: number; height: number },
) {
  return {
    ...createImageLayer(asset, now, baseCanvas),
    id: `logo-layer-${now}`,
    type: 'logo' as const,
    name: 'LOGO Layer',
    position: {
      mode: 'anchor' as const,
      anchor: 'top-left' as const,
      marginX: 20,
      marginY: 20,
      offsetX: 0,
      offsetY: 0,
      width: 100,
      height: 100,
    },
  }
}

function createTextLayer(now: number, baseCanvas: { width: number; height: number }) {
  const layer = fitCompositeTextLayer({
    id: `text-layer-${now}`,
    type: 'text' as const,
    name: 'Text Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { ...DEFAULT_LAYER_POSITION },
    shadow: { ...DEFAULT_LAYER_SHADOW },
    text: 'New Text',
    fontFamily: 'sans-serif',
    fontSize: 48,
    fontWeight: 700,
    color: '#000000',
    align: 'center' as const,
    lineHeight: 1.1,
    letterSpacing: 0,
    padding: 5,
    stroke: {
      enabled: false,
      color: '#111827',
      width: 0,
    },
  })
  return {
    ...layer,
    position: createCenteredFreePosition(baseCanvas, {
      width: layer.position.width,
      height: layer.position.height,
    }),
  }
}
