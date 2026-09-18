/**
 * 水印预设 store（A 套「后期处理工作区」的全部遗产）。
 *
 * 这个 store 原来装着两件事：水印预设编辑 + 整套批量导出编排（导出队列、任务流、
 * 分发、输出规则、历史记录、自定义命名变量）。编排已统一到 `features/postprocess`
 * 那一套，本 store 只保留前者。
 *
 * 持久化：localStorage（`tangbao-composite-v2-workspace-storage`）。
 * version 3 → 4 的迁移是**丢弃式**的——旧数据里的编排字段（预设的输出目录、命名模板、
 * 自定义变量、渠道尺寸覆盖）在建模上已归后处理，留着只会让人以为它还算数。
 */
import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { persist } from 'zustand/middleware'
import { createPreviewHistory } from './lib/compositeBackgrounds'
import { createDefaultCompositeV2State } from './lib/compositeV2Defaults'
import { fitCompositeTextLayer } from './lib/compositeTextLayout'
import { hasLegacyCompositeAssets, migrateLegacyCompositeAssets } from './lib/compositeAssetMigration'
import type {
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
  selectedPresetGroupId: string
  selectedPreviewPresetId: string
  clipboardLayer: CompositeV2Layer | null
}

type CompositeV2UndoSnapshot = {
  logoLibraryPath: string
  logoOrder: string[]
  projectLogos: CompositeV2State['projectLogos']
  backgroundFolders: string[]
  recursiveBackgrounds: boolean
  backgrounds: CompositeV2BackgroundImage[]
  previewHistory: string[]
  previewHistoryIndex: number
  selectedPresetGroupId: string
  selectedPreviewPresetId: string
  presets: CompositeV2State['presets']
  presetGroups: CompositeV2State['presetGroups']
  globalFitMode: CompositeV2FitMode
}

type CompositeV2UndoState = {
  undoStack: CompositeV2UndoSnapshot[]
  redoStack: CompositeV2UndoSnapshot[]
  lastHistoryMeta: { mergeKey: string; timestamp: number } | null
  canUndo: boolean
  canRedo: boolean
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
  setSelectedPresetGroup: (groupId: string) => void
  setSelectedPreviewPresetId: (presetId: string) => void
  pushPreviewBackground: (path: string) => void
  previousPreviewBackground: () => void
  nextPreviewBackground: () => void
  createPresetGroup: (name: string) => void
  createPreset: (name: string) => void
  deletePreset: (presetId: string) => void
  renamePresetGroup: (groupId: string, name: string) => void
  movePresetGroup: (groupId: string, targetIndex: number) => void
  duplicatePresetGroup: (groupId: string) => void
  deletePresetGroup: (groupId: string) => void
  reorderPresetInGroup: (groupId: string, presetId: string, targetIndex: number) => void
  duplicatePreset: (presetId: string) => void
  addPresetToGroup: (presetId: string, groupId: string) => void
  removePresetFromGroup: (presetId: string, groupId: string) => void
  copyLayer: (presetId: string, layerId: string) => void
  pasteLayer: (presetId: string) => void
  duplicateLayer: (presetId: string, layerId: string) => void
  setGlobalFitMode: (mode: CompositeV2FitMode) => void
}

export type CompositeV2StoreState = CompositeV2BatchState &
  CompositeV2UndoState &
  CompositeV2State &
  CompositeV2StoreActions

export type CompositeV2PersistedState = CompositeV2PersistedSnapshot

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
 * 持久化版本。3 → 4：编排字段（预设的输出目录/命名模板/自定义变量/渠道尺寸覆盖）
 * 随 A 套编排退役而移除，必须靠迁移把它们丢掉——否则旧数据反序列化会把脏字段写回。
 */
const COMPOSITE_V2_PERSIST_VERSION = 4

export function createCompositeV2StoreState(): CompositeV2BatchState & CompositeV2UndoState & CompositeV2State {
  const defaults = createDefaultCompositeV2State()
  const selectedPresetGroupId = defaults.presetGroups[0]?.id ?? ''

  return {
    logoLibraryPath: defaults.logoLibraryPath,
    logoOrder: [],
    projectLogos: [],
    backgroundFolders: [],
    recursiveBackgrounds: false,
    backgrounds: [],
    previewHistory: [],
    previewHistoryIndex: -1,
    selectedPresetGroupId,
    selectedPreviewPresetId: getFirstPresetIdForGroup(defaults.presetGroups, selectedPresetGroupId),
    presets: defaults.presets,
    presetGroups: defaults.presetGroups,
    globalFitMode: defaults.globalFitMode,
    clipboardLayer: null,
    undoStack: [],
    redoStack: [],
    lastHistoryMeta: null,
    canUndo: false,
    canRedo: false,
  }
}

export function getCompositeV2PersistedState(state: CompositeV2StoreState): CompositeV2PersistedState {
  return {
    logoLibraryPath: state.logoLibraryPath,
    logoOrder: state.logoOrder ?? [],
    projectLogos: state.projectLogos ?? [],
    presets: state.presets,
    presetGroups: state.presetGroups,
    globalFitMode: state.globalFitMode,
    backgroundFolders: state.backgroundFolders,
    recursiveBackgrounds: state.recursiveBackgrounds,
    selectedPresetGroupId: state.selectedPresetGroupId,
    selectedPreviewPresetId: state.selectedPreviewPresetId,
  }
}

export function mergeCompositeV2PersistedState(
  persistedState: unknown,
  currentState: CompositeV2StoreState,
): CompositeV2StoreState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = migrateCompositeV2PersistedState(persistedState, COMPOSITE_V2_PERSIST_VERSION)
  const merged = { ...currentState, ...persisted } as CompositeV2StoreState
  const selectedGroup = getSelectedGroup(
    merged.presetGroups,
    persisted.selectedPresetGroupId ?? currentState.selectedPresetGroupId,
  )
  const selectedPresetGroupId = selectedGroup?.id ?? ''
  const groupPresetIds = [...(selectedGroup?.presetIds ?? [])]
  const requestedPreviewPresetId = persisted.selectedPreviewPresetId ?? currentState.selectedPreviewPresetId
  const selectedPreviewPresetId = groupPresetIds.includes(requestedPreviewPresetId)
    ? requestedPreviewPresetId
    : (groupPresetIds[0] ?? '')

  return {
    ...merged,
    selectedPresetGroupId,
    selectedPreviewPresetId,
  }
}

/**
 * 持久化迁移。**只做丢弃，不做换算**：
 * A 套预设的输出目录/命名模板/自定义变量/渠道尺寸覆盖在新模型里没有对应物
 * （后处理那边由「项目树参数 + 媒体表」决定），所以直接不搬。
 * 素材本身（预设 id/名称/画布/图层）原样保留，用户的图层工作不会丢。
 */
export function migrateCompositeV2PersistedState(persistedState: unknown, _version: number): CompositeV2PersistedState {
  if (!persistedState || typeof persistedState !== 'object') {
    return getCompositeV2PersistedState(createCompositeV2StoreState() as CompositeV2StoreState)
  }

  const legacy = persistedState as {
    logoLibraryPath?: unknown
    logoOrder?: unknown
    projectLogos?: unknown
    presets?: unknown
    presetGroups?: unknown
    globalFitMode?: unknown
    backgroundFolders?: unknown
    recursiveBackgrounds?: unknown
    selectedPresetGroupId?: unknown
    selectedPreviewPresetId?: unknown
  }
  const presets = (Array.isArray(legacy.presets) ? legacy.presets : [])
    .filter((preset): preset is Record<string, unknown> => Boolean(preset) && typeof preset === 'object')
    .map((preset): CompositeV2State['presets'][number] => ({
      id: typeof preset.id === 'string' ? preset.id : '',
      name: typeof preset.name === 'string' ? preset.name : '',
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
    presetGroups: Array.isArray(legacy.presetGroups) ? (legacy.presetGroups as CompositeV2State['presetGroups']) : [],
    globalFitMode: normalizeFitMode(legacy.globalFitMode),
    backgroundFolders: Array.isArray(legacy.backgroundFolders) ? (legacy.backgroundFolders as string[]) : [],
    recursiveBackgrounds: Boolean(legacy.recursiveBackgrounds),
    selectedPresetGroupId: typeof legacy.selectedPresetGroupId === 'string' ? legacy.selectedPresetGroupId : undefined,
    selectedPreviewPresetId:
      typeof legacy.selectedPreviewPresetId === 'string' ? legacy.selectedPreviewPresetId : undefined,
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

export function replaceCompositeV2PersistedState(snapshot: CompositeV2PersistedState): void {
  const merged = mergeCompositeV2PersistedState(snapshot, useCompositeV2Store.getState())
  useCompositeV2Store.setState(getCompositeV2PersistedState(merged))
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
        setSelectedPresetGroup: (groupId) =>
          setWithoutHistory((state) => ({
            selectedPresetGroupId: getSelectedGroup(state.presetGroups, groupId)?.id ?? '',
          })),
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
        createPresetGroup: (name) =>
          setWithHistory((state) => {
            const now = Date.now()
            const group = { id: uniqueId('group'), name: name.trim() || '新预设组', presetIds: [], updatedAt: now }
            return {
              presetGroups: [...state.presetGroups, group],
              selectedPresetGroupId: group.id,
            }
          }, 'preset-groups:structure'),
        createPreset: (name) =>
          setWithHistory((state) => {
            const now = Date.now()
            const preset: CompositeV2State['presets'][number] = {
              id: uniqueId('preset'),
              name: name.trim() || '新预设',
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
        deletePreset: (presetId) =>
          setWithHistory((state) => {
            const presets = state.presets.filter((preset) => preset.id !== presetId)
            if (presets.length === state.presets.length) return {}
            return {
              presets,
              presetGroups: state.presetGroups.map((group) => ({
                ...group,
                presetIds: group.presetIds.filter((id) => id !== presetId),
                updatedAt: group.presetIds.includes(presetId) ? Date.now() : group.updatedAt,
              })),
              selectedPreviewPresetId:
                state.selectedPreviewPresetId === presetId ? (presets[0]?.id ?? '') : state.selectedPreviewPresetId,
            }
          }, 'presets:structure'),
        renamePresetGroup: (groupId, name) =>
          setWithHistory(
            (state) => ({
              presetGroups: state.presetGroups.map((group) =>
                group.id === groupId ? { ...group, name: name.trim() || group.name, updatedAt: Date.now() } : group,
              ),
            }),
            `preset-group:${groupId}:name`,
          ),
        movePresetGroup: (groupId, targetIndex) =>
          setWithHistory((state) => {
            const sourceIndex = state.presetGroups.findIndex((group) => group.id === groupId)
            if (sourceIndex < 0) return {}
            const nextIndex = Math.max(0, Math.min(state.presetGroups.length - 1, targetIndex))
            if (sourceIndex === nextIndex) return {}
            const presetGroups = [...state.presetGroups]
            const [group] = presetGroups.splice(sourceIndex, 1)
            presetGroups.splice(nextIndex, 0, group!)
            return { presetGroups }
          }, 'preset-groups:structure'),
        duplicatePresetGroup: (groupId) =>
          setWithHistory((state) => {
            const source = state.presetGroups.find((group) => group.id === groupId)
            if (!source) return {}
            const group = {
              ...source,
              id: uniqueId('group'),
              name: `${source.name} copy`,
              presetIds: [...source.presetIds],
              updatedAt: Date.now(),
            }
            return { presetGroups: [...state.presetGroups, group] }
          }, 'preset-groups:structure'),
        deletePresetGroup: (groupId) =>
          setWithHistory((state) => {
            if (state.presetGroups.length <= 1) return {}
            const presetGroups = state.presetGroups.filter((group) => group.id !== groupId)
            return {
              presetGroups,
              selectedPresetGroupId: presetGroups[0]?.id ?? '',
            }
          }, 'preset-groups:structure'),
        reorderPresetInGroup: (groupId, presetId, targetIndex) =>
          setWithHistory(
            (state) => ({
              presetGroups: state.presetGroups.map((group) => {
                if (group.id !== groupId) return group
                const currentIndex = group.presetIds.indexOf(presetId)
                if (currentIndex < 0) return group
                const presetIds = [...group.presetIds]
                const [item] = presetIds.splice(currentIndex, 1)
                presetIds.splice(targetIndex, 0, item!)
                return { ...group, presetIds, updatedAt: Date.now() }
              }),
            }),
            `preset-group:${groupId}:preset-order`,
          ),
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
        addPresetToGroup: (presetId, groupId) =>
          setWithHistory((state) => {
            const group = state.presetGroups.find((g) => g.id === groupId)
            if (!group || group.presetIds.includes(presetId)) return {}
            return {
              presetGroups: state.presetGroups.map((g) =>
                g.id === groupId ? { ...g, presetIds: [...g.presetIds, presetId], updatedAt: Date.now() } : g,
              ),
            }
          }, `preset-group:${groupId}:membership`),
        removePresetFromGroup: (presetId, groupId) =>
          setWithHistory(
            (state) => ({
              presetGroups: state.presetGroups.map((group) =>
                group.id === groupId
                  ? { ...group, presetIds: group.presetIds.filter((id) => id !== presetId), updatedAt: Date.now() }
                  : group,
              ),
            }),
            `preset-group:${groupId}:membership`,
          ),
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

function getSelectedGroup(presetGroups: CompositeV2State['presetGroups'], groupId: string) {
  return presetGroups.find((group) => group.id === groupId) ?? presetGroups[0] ?? null
}

function getFirstPresetIdForGroup(presetGroups: CompositeV2State['presetGroups'], groupId: string) {
  return getSelectedGroup(presetGroups, groupId)?.presetIds[0] ?? ''
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
    backgroundFolders: [...state.backgroundFolders],
    recursiveBackgrounds: state.recursiveBackgrounds,
    backgrounds: [...state.backgrounds],
    previewHistory: [...state.previewHistory],
    previewHistoryIndex: state.previewHistoryIndex,
    selectedPresetGroupId: state.selectedPresetGroupId,
    selectedPreviewPresetId: state.selectedPreviewPresetId,
    presets: [...state.presets],
    presetGroups: [...state.presetGroups],
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
