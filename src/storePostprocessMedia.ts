/**
 * 后处理编排配置（对应瀚灵的 `SopPostProcessConfig` + `PostprocessSelection`）。
 *
 * 只存**编排配置**，不含任何水印模型：水印一律通过 `CompositeV2Preset`（`features/composite/storeV2`）
 * 的 id 引用，避免在 `watermarkEngine` / `watermarkWorkbench` 删除后再长出第三套水印概念。
 *
 * 与生成结果的解耦：本 store 不碰任务、不碰图片，只回答「用户想产出哪些渠道/尺寸、放哪、怎么命名」。
 * 实际产出在阶段四的输出链路里读本配置。
 *
 * 数据表与算法在 `src/lib/postprocessMedia.ts`，命名模板在 `src/lib/postprocessNaming.ts`。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from './lib/desktopJsonStorage'
import { DEFAULT_POSTPROCESS_NAME_PATTERN } from './lib/postprocessNaming'
import {
  DEFAULT_POSTPROCESS_MEDIA,
  PURE_MEDIA_ID,
  buildPostprocessOutputs,
  resolveOutputDirection,
  type OutputDirection,
  type PostprocessMedia,
  type PostprocessMediaConfig,
  type PostprocessMediaSize,
  type PostprocessOutputPlan,
  type PostprocessProjectTarget,
} from './lib/postprocessMedia'

export type { PostprocessMediaConfig }

export interface PostprocessMediaStore extends PostprocessMediaConfig {
  setMedia: (media: PostprocessMedia[]) => void
  addMedia: (name: string, id?: string) => string | null
  renameMedia: (mediaId: string, name: string) => void
  setMediaEnabled: (mediaId: string, enabled: boolean) => void
  deleteMedia: (mediaId: string) => void
  addMediaSize: (mediaId: string, size: Omit<PostprocessMediaSize, 'id'> & { id?: string }) => void
  updateMediaSize: (mediaId: string, sizeId: string, patch: Partial<Omit<PostprocessMediaSize, 'id'>>) => void
  deleteMediaSize: (mediaId: string, sizeId: string) => void
  /** 恢复内置媒体表（用户的增删改会被覆盖，调用方需先确认） */
  resetMedia: () => void

  setSelectedMediaIds: (ids: string[]) => void
  toggleSelectedMedia: (mediaId: string) => void
  setSelectedCollectionIds: (ids: string[]) => void
  toggleSelectedCollection: (collectionId: string) => void
  setDirection: (direction: OutputDirection | null) => void
  setOutputDir: (outputDir: string) => void
  setNamePattern: (namePattern: string) => void
  setCreator: (creator: string) => void
  setWatermarkPresetId: (presetId: string | null) => void
  setAutoCompanionClean: (enabled: boolean) => void
}

/** 内置媒体表的深拷贝（常量是共享对象，直接引用会被 action 改坏）。 */
export function createDefaultPostprocessMedia(): PostprocessMedia[] {
  return DEFAULT_POSTPROCESS_MEDIA.map((media) => ({
    ...media,
    sizes: media.sizes.map((size) => ({ ...size })),
  }))
}

export function createDefaultPostprocessMediaConfig(): PostprocessMediaConfig {
  return {
    media: createDefaultPostprocessMedia(),
    selectedMediaIds: [PURE_MEDIA_ID],
    selectedCollectionIds: [],
    direction: null,
    outputDir: '',
    namePattern: DEFAULT_POSTPROCESS_NAME_PATTERN,
    creator: '',
    watermarkPresetId: null,
    autoCompanionClean: true,
  }
}

function normalizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || result.includes(trimmed)) continue
    result.push(trimmed)
  }
  return result
}

function normalizeSize(raw: unknown): PostprocessMediaSize | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const width = typeof input.width === 'number' ? Math.trunc(input.width) : Number.NaN
  const height = typeof input.height === 'number' ? Math.trunc(input.height) : Number.NaN
  const maxSizeKb = typeof input.maxSizeKb === 'number' ? input.maxSizeKb : Number.NaN
  if (!id || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null
  // maxSizeKb 语义：0 = 不压缩。负数无意义，按 0 处理而不是丢弃整条尺寸。
  if (!Number.isFinite(maxSizeKb) || maxSizeKb < 0) {
    return { id, width, height, maxSizeKb: 0, enabled: input.enabled !== false }
  }
  return { id, width, height, maxSizeKb, enabled: input.enabled !== false }
}

function normalizeMedia(raw: unknown): PostprocessMedia | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!id || !name) return null
  const sizes: PostprocessMediaSize[] = []
  if (Array.isArray(input.sizes)) {
    for (const rawSize of input.sizes) {
      const size = normalizeSize(rawSize)
      if (!size || sizes.some((item) => item.id === size.id)) continue
      sizes.push(size)
    }
  }
  return { id, name, enabled: input.enabled !== false, sizes }
}

/**
 * 归一化持久化数据 / 备份数据。
 *
 * 两个刻意的语义区分：
 * - `media` **缺失（非数组）** → 回填内置表；用户手动清空的 `[]` **保持为空**，不复活已删媒体。
 * - 坏条目（缺 id、宽高非正）逐条丢弃，而不是整份配置回退 —— 保住用户其余的编辑。
 */
export function normalizePostprocessMediaConfig(raw: unknown): PostprocessMediaConfig {
  const defaults = createDefaultPostprocessMediaConfig()
  if (!raw || typeof raw !== 'object') return defaults
  const input = raw as Record<string, unknown>

  let media = defaults.media
  if (Array.isArray(input.media)) {
    media = []
    for (const rawMedia of input.media) {
      const normalized = normalizeMedia(rawMedia)
      if (!normalized || media.some((item) => item.id === normalized.id)) continue
      media.push(normalized)
    }
  }

  const direction =
    input.direction === 'landscape' || input.direction === 'portrait' || input.direction === 'square'
      ? input.direction
      : null

  const namePattern =
    typeof input.namePattern === 'string' && input.namePattern.trim()
      ? input.namePattern.trim()
      : DEFAULT_POSTPROCESS_NAME_PATTERN

  const watermarkPresetId =
    typeof input.watermarkPresetId === 'string' && input.watermarkPresetId.trim()
      ? input.watermarkPresetId.trim()
      : null

  return {
    media,
    selectedMediaIds: normalizeStringList(input.selectedMediaIds) ?? defaults.selectedMediaIds,
    selectedCollectionIds: normalizeStringList(input.selectedCollectionIds) ?? defaults.selectedCollectionIds,
    direction,
    outputDir: typeof input.outputDir === 'string' ? input.outputDir : defaults.outputDir,
    namePattern,
    creator: typeof input.creator === 'string' ? input.creator : defaults.creator,
    watermarkPresetId,
    autoCompanionClean: input.autoCompanionClean !== false,
  }
}

/** 选择列表只保留 `clean` 与当前确实存在的媒体，避免删媒体后留下悬空勾选。 */
function pruneSelectedMediaIds(media: PostprocessMedia[], selectedMediaIds: string[]): string[] {
  const existing = new Set(media.map((item) => item.id))
  return selectedMediaIds.filter((id) => id === PURE_MEDIA_ID || existing.has(id))
}

function createCustomMediaId(): string {
  return `custom-${crypto.randomUUID().slice(0, 8)}`
}

export function buildPostprocessMediaSizeId(mediaId: string, width: number, height: number): string {
  return `${mediaId}-${Math.trunc(width)}x${Math.trunc(height)}`
}

function mapMedia(
  media: PostprocessMedia[],
  mediaId: string,
  mapper: (item: PostprocessMedia) => PostprocessMedia,
): PostprocessMedia[] {
  let changed = false
  const next = media.map((item) => {
    if (item.id !== mediaId) return item
    const updated = mapper(item)
    if (updated !== item) changed = true
    return updated
  })
  return changed ? next : media
}

export const usePostprocessMediaStore = create<PostprocessMediaStore>()(
  persist(
    (set, get) => ({
      ...createDefaultPostprocessMediaConfig(),

      setMedia: (media) =>
        set((state) => {
          const normalized = normalizePostprocessMediaConfig({ ...state, media }).media
          return { media: normalized, selectedMediaIds: pruneSelectedMediaIds(normalized, state.selectedMediaIds) }
        }),

      addMedia: (name, id) => {
        const trimmedName = name.trim()
        if (!trimmedName) return null
        const mediaId = (id ?? '').trim() || createCustomMediaId()
        if (get().media.some((item) => item.id === mediaId)) return null
        set((state) => ({ media: [...state.media, { id: mediaId, name: trimmedName, enabled: true, sizes: [] }] }))
        return mediaId
      },

      renameMedia: (mediaId, name) => {
        const trimmedName = name.trim()
        if (!trimmedName) return
        set((state) => ({
          media: mapMedia(state.media, mediaId, (item) =>
            item.name === trimmedName ? item : { ...item, name: trimmedName },
          ),
        }))
      },

      setMediaEnabled: (mediaId, enabled) =>
        set((state) => ({
          media: mapMedia(state.media, mediaId, (item) => (item.enabled === enabled ? item : { ...item, enabled })),
        })),

      deleteMedia: (mediaId) =>
        set((state) => {
          if (!state.media.some((item) => item.id === mediaId)) return state
          return {
            media: state.media.filter((item) => item.id !== mediaId),
            selectedMediaIds: state.selectedMediaIds.filter((id) => id !== mediaId),
          }
        }),

      addMediaSize: (mediaId, size) => {
        const width = Math.trunc(size.width)
        const height = Math.trunc(size.height)
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return
        const sizeId = (size.id ?? '').trim() || buildPostprocessMediaSizeId(mediaId, width, height)
        const maxSizeKb = Number.isFinite(size.maxSizeKb) && size.maxSizeKb > 0 ? size.maxSizeKb : 0
        set((state) => ({
          media: mapMedia(state.media, mediaId, (item) => {
            if (item.sizes.some((entry) => entry.id === sizeId)) return item
            return {
              ...item,
              // 同宽高重复添加视为无操作：尺寸 id 由宽高派生，重复即同一规格
              sizes: [...item.sizes, { id: sizeId, width, height, maxSizeKb, enabled: size.enabled !== false }],
            }
          }),
        }))
      },

      updateMediaSize: (mediaId, sizeId, patch) =>
        set((state) => ({
          media: mapMedia(state.media, mediaId, (item) => {
            const index = item.sizes.findIndex((entry) => entry.id === sizeId)
            if (index < 0) return item
            const current = item.sizes[index]
            const merged: PostprocessMediaSize = { ...current, ...patch }
            const width = Number.isFinite(merged.width) ? Math.trunc(merged.width) : current.width
            const height = Number.isFinite(merged.height) ? Math.trunc(merged.height) : current.height
            if (width <= 0 || height <= 0) return item
            const maxSizeKb = Number.isFinite(merged.maxSizeKb) && merged.maxSizeKb > 0 ? merged.maxSizeKb : 0
            const enabled = merged.enabled !== false
            // 宽高变了就重算 id（id 由宽高派生）；新 id 与同媒体其它尺寸撞车则视为重复规格，放弃本次修改。
            const nextId =
              width === current.width && height === current.height
                ? current.id
                : buildPostprocessMediaSizeId(item.id, width, height)
            if (nextId !== current.id && item.sizes.some((entry, i) => i !== index && entry.id === nextId)) return item
            if (
              nextId === current.id &&
              width === current.width &&
              height === current.height &&
              maxSizeKb === current.maxSizeKb &&
              enabled === current.enabled
            ) {
              return item
            }
            const sizes = [...item.sizes]
            sizes[index] = { id: nextId, width, height, maxSizeKb, enabled }
            return { ...item, sizes }
          }),
        })),

      deleteMediaSize: (mediaId, sizeId) =>
        set((state) => ({
          media: mapMedia(state.media, mediaId, (item) => {
            if (!item.sizes.some((entry) => entry.id === sizeId)) return item
            return { ...item, sizes: item.sizes.filter((entry) => entry.id !== sizeId) }
          }),
        })),

      resetMedia: () =>
        set((state) => {
          const media = createDefaultPostprocessMedia()
          return { media, selectedMediaIds: pruneSelectedMediaIds(media, state.selectedMediaIds) }
        }),

      setSelectedMediaIds: (ids) =>
        set((state) => ({
          selectedMediaIds: pruneSelectedMediaIds(state.media, normalizeStringList(ids) ?? []),
        })),

      toggleSelectedMedia: (mediaId) =>
        set((state) => {
          const trimmed = mediaId.trim()
          if (!trimmed) return state
          const has = state.selectedMediaIds.includes(trimmed)
          return {
            selectedMediaIds: has
              ? state.selectedMediaIds.filter((id) => id !== trimmed)
              : [...state.selectedMediaIds, trimmed],
          }
        }),

      setSelectedCollectionIds: (ids) => set({ selectedCollectionIds: normalizeStringList(ids) ?? [] }),

      toggleSelectedCollection: (collectionId) =>
        set((state) => {
          const trimmed = collectionId.trim()
          if (!trimmed) return state
          const has = state.selectedCollectionIds.includes(trimmed)
          return {
            selectedCollectionIds: has
              ? state.selectedCollectionIds.filter((id) => id !== trimmed)
              : [...state.selectedCollectionIds, trimmed],
          }
        }),

      setDirection: (direction) =>
        set({
          direction: direction === 'landscape' || direction === 'portrait' || direction === 'square' ? direction : null,
        }),

      setOutputDir: (outputDir) => set({ outputDir: typeof outputDir === 'string' ? outputDir : '' }),

      setNamePattern: (namePattern) =>
        set({
          namePattern:
            typeof namePattern === 'string' && namePattern.trim()
              ? namePattern.trim()
              : DEFAULT_POSTPROCESS_NAME_PATTERN,
        }),

      setCreator: (creator) => set({ creator: typeof creator === 'string' ? creator : '' }),

      setWatermarkPresetId: (presetId) =>
        set({ watermarkPresetId: typeof presetId === 'string' && presetId.trim() ? presetId.trim() : null }),

      setAutoCompanionClean: (enabled) => set({ autoCompanionClean: enabled === true }),
    }),
    {
      name: 'tangbao-postprocess-media',
      version: 1,
      // 无 legacy 适配器：这是新 store，不存在需要从 localStorage 迁移的历史数据
      // （对比 `assetLibraryUi` / `compositeWorkspace` 那两个有迁移诉求的 ns）。
      storage: createDesktopJsonStorage('postprocessMedia'),
      partialize: (state) => ({
        media: state.media,
        selectedMediaIds: state.selectedMediaIds,
        selectedCollectionIds: state.selectedCollectionIds,
        direction: state.direction,
        outputDir: state.outputDir,
        namePattern: state.namePattern,
        creator: state.creator,
        watermarkPresetId: state.watermarkPresetId,
        autoCompanionClean: state.autoCompanionClean,
      }),
      migrate: (persisted) => normalizePostprocessMediaConfig(persisted),
    },
  ),
)

/** 只取持久化切片，供备份导出与跨模块读取。 */
export function getPostprocessMediaConfigSnapshot(state: PostprocessMediaStore): PostprocessMediaConfig {
  return {
    media: state.media.map((media) => ({ ...media, sizes: media.sizes.map((size) => ({ ...size })) })),
    selectedMediaIds: [...state.selectedMediaIds],
    selectedCollectionIds: [...state.selectedCollectionIds],
    direction: state.direction,
    outputDir: state.outputDir,
    namePattern: state.namePattern,
    creator: state.creator,
    watermarkPresetId: state.watermarkPresetId,
    autoCompanionClean: state.autoCompanionClean,
  }
}

/** 用备份数据恢复配置（缺失字段走默认值，不抛错）。 */
export function restorePostprocessMediaConfig(raw: unknown): void {
  usePostprocessMediaStore.setState(normalizePostprocessMediaConfig(raw))
}

export type PostprocessOutputSource = { width: number; height: number }

/**
 * 产出计划：`勾选的项目 × 勾选的媒体 × 尺寸`。
 *
 * 纯净版自动伴随在这里补：只要勾了任一渠道媒体且开关开着，就确保 `clean` 在列；
 * 用户主动取消勾选 `clean` 且未勾任何渠道时不强加（避免空生成）。
 *
 * `projects` 由调用方从项目树解析后传入（store 不依赖 assetLibrary，避免循环/耦合）；
 * 不传则不展开项目维度，单元里也不带 `project` 字段。
 */
export function selectPostprocessOutputPlan(
  config: Pick<PostprocessMediaConfig, 'media' | 'selectedMediaIds' | 'direction' | 'autoCompanionClean'>,
  source: PostprocessOutputSource,
  projects: PostprocessProjectTarget[] = [],
): PostprocessOutputPlan {
  const hasChannel = config.selectedMediaIds.some((id) => id !== PURE_MEDIA_ID)
  const includeClean = config.selectedMediaIds.includes(PURE_MEDIA_ID) || (config.autoCompanionClean && hasChannel)
  const mediaIds = includeClean
    ? [PURE_MEDIA_ID, ...config.selectedMediaIds.filter((id) => id !== PURE_MEDIA_ID)]
    : [...config.selectedMediaIds]

  return buildPostprocessOutputs({
    mediaIds,
    media: config.media,
    sourceWidth: source.width,
    sourceHeight: source.height,
    direction: config.direction,
    projects,
  })
}

/** 后处理是否已具备运行条件：至少勾了一个项目 + 至少能产出一个变体。 */
export function isPostprocessReady(
  config: PostprocessMediaConfig,
  source?: PostprocessOutputSource,
  projects: PostprocessProjectTarget[] = [],
): boolean {
  if (config.selectedCollectionIds.length === 0) return false
  if (config.selectedMediaIds.length === 0) return false
  if (!source) return true
  return selectPostprocessOutputPlan(config, source, projects).units.length > 0
}

/**
 * 取某个产出单元的文件名主干（不含扩展名）。
 *
 * 实现在 `src/lib/postprocessNaming.ts`（lib 不能反向依赖 store 文件）；此处 re-export 保持既有调用点稳定。
 */
export { buildPostprocessOutputName } from './lib/postprocessNaming'

/** 源图方向（供 UI 预判将产出哪些尺寸）。 */
export function resolvePostprocessSourceDirection(source: PostprocessOutputSource): OutputDirection {
  return resolveOutputDirection(source.width, source.height)
}
