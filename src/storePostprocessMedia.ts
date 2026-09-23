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
  DEFAULT_POSTPROCESS_FIT_MODE,
  DEFAULT_POSTPROCESS_MEDIA,
  MAX_POSTPROCESS_OUTPUT_DIRS,
  PURE_MEDIA_ID,
  buildPostprocessOutputs,
  normalizeOutputDirList,
  normalizePostprocessFitMode,
  resolveOutputDirection,
  type OutputDirection,
  type PostprocessMedia,
  type PostprocessMediaConfig,
  type PostprocessMediaSize,
  type PostprocessOutputPlan,
  type PostprocessProjectTarget,
} from './lib/postprocessMedia'
import type { CompositeV2FitMode } from './features/composite/lib/compositeV2Types'
import {
  DEFAULT_POSTPROCESS_DISTRIBUTION,
  normalizePostprocessDistributionConfig,
  type PostprocessDistributionConfig,
} from './lib/postprocessDistribution'

export type { PostprocessMediaConfig }

export interface PostprocessMediaStore extends PostprocessMediaConfig {
  addMedia: (name: string, id?: string) => string | null
  renameMedia: (mediaId: string, name: string) => void
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
  /**
   * 「记住配置」：把这次选定的产出目标固化下来，后续**手动**跑批一直复用它，直到再次修改。
   *
   * **只作用于手动触发**（执行体按 `source === 'manual'` 取它；自动后处理不读）：
   * 自动产出的去向仍是图片归属方向，不被这份清单悄悄改掉。
   *
   * 传空数组 = 恢复「按图片归属方向产出」（与从没点过记住一致）。空数组表达的是「不指定目标」，
   * **不是**「什么都不产出」。
   */
  setSavedTargetCollectionIds: (ids: string[]) => void
  /** 清掉记住的产出目标（等价于 `setSavedTargetCollectionIds([])`，给界面一个语义明确的入口） */
  clearSavedTargetCollectionIds: () => void
  setDirection: (direction: OutputDirection | null) => void
  /**
   * 设置源图适配目标尺寸的方式（全局一套）。
   *
   * 收窄到联合类型而不是 `string`：这个值是直接喂给渲染器的，拼错了不会在编译期暴露，
   * 而是等到出图时才抛「未知的背景适应模式」。
   */
  setFitMode: (fitMode: CompositeV2FitMode) => void
  setOutputDir: (outputDir: string) => void
  /**
   * 写某个渠道第 `index` 个导出位置（0 起）。传空串 = 清掉该位置，后面的位置前移。
   *
   * 逐槽下标而不是整份数组：界面上一次只改一个输入框，整份替换会把另一个位置连同
   * 正在输入的内容一起顶掉（受控输入尤其明显）。
   */
  setMediaOutputDir: (mediaId: string, index: number, outputDir: string) => void
  /** 清掉某个渠道的全部导出位置（回到 `outputDir` 那个默认位置） */
  clearMediaOutputDirs: (mediaId: string) => void
  setNamePattern: (namePattern: string) => void
  setCreator: (creator: string) => void
  /** 局部更新分发配置（只传要改的字段，其余保持） */
  patchDistribution: (patch: Partial<PostprocessDistributionConfig>) => void
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
    // 默认没记住任何产出目标 → 按图片归属方向产出（与历史行为一致）
    savedTargetCollectionIds: [],
    direction: null,
    // 默认「裁剪填满」：与历史行为一致，升级不改观感
    fitMode: DEFAULT_POSTPROCESS_FIT_MODE,
    outputDir: '',
    // 默认一个渠道都不单独指定：全部走 `outputDir`（空串 = 本地保存目录下的 postprocess）
    mediaOutputDirs: {},
    namePattern: DEFAULT_POSTPROCESS_NAME_PATTERN,
    creator: '',
    watermarkPresetIds: [],
    distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION },
  }
}

/**
 * 归一化「全局渠道导出位置」表：丢掉空列表与坏键，键与值都过一遍归一化。
 *
 * 键指向的渠道**允许不存在**（媒体可以被删后再加回来），所以不在这里按 `media` 剪枝；
 * 真正会用到它的写盘侧是按渠道查表，查不到就是没用上，不会出错。
 */
function normalizeMediaOutputDirs(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, string[]> = {}
  for (const [rawMediaId, rawDirs] of Object.entries(raw as Record<string, unknown>)) {
    const mediaId = typeof rawMediaId === 'string' ? rawMediaId.trim() : ''
    if (!mediaId) continue
    const dirs = normalizeOutputDirList(rawDirs)
    if (dirs.length > 0) result[mediaId] = dirs
  }
  return result
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

/**
 * 水印预设 id 列表归一化。
 *
 * 兼容旧版本的**单值**字段 `watermarkPresetId`：那是上一版的落盘格式，
 * 不迁移的话升级后用户已配好的水印会凭空消失。
 */
function normalizeWatermarkPresetIds(input: Record<string, unknown>): string[] {
  if (Array.isArray(input.watermarkPresetIds)) return normalizeStringList(input.watermarkPresetIds) ?? []
  const legacy = input.watermarkPresetId
  return typeof legacy === 'string' && legacy.trim() ? [legacy.trim()] : []
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

/**
 * 旧数据里这个渠道是不是被「启用」开关关掉的。
 *
 * `enabled` 字段已在 ADR-0013 删除（它与「参与产出」对产出的影响完全等价），
 * 所以归一化时要把旧值读出来折成「不参与」，见 `normalizePostprocessMediaConfig`。
 */
function isLegacyDisabledMedia(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).enabled === false
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
  return { id, name, sizes }
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
  /**
   * 旧数据里被「启用」开关关掉的渠道（ADR-0013 删掉该字段时的一次性迁移）。
   *
   * **必须折成「不参与」而不是直接忽略这个字段**：忽略等于把「停用过的渠道」重新放回产出，
   * 而留着它又会让用户「勾了参与产出却不产出」（一个界面上看不见的杀手开关）。
   * 两条路都会让人对着结果发懵，所以只有一条是对的 —— 把「停用」翻译成它当时真正表达的意思。
   */
  const legacyDisabledMediaIds = new Set<string>()
  if (Array.isArray(input.media)) {
    media = []
    for (const rawMedia of input.media) {
      const normalized = normalizeMedia(rawMedia)
      if (!normalized || media.some((item) => item.id === normalized.id)) continue
      if (isLegacyDisabledMedia(rawMedia)) legacyDisabledMediaIds.add(normalized.id)
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

  const selectedMediaIds = normalizeStringList(input.selectedMediaIds) ?? defaults.selectedMediaIds

  return {
    media,
    selectedMediaIds: selectedMediaIds.filter((id) => !legacyDisabledMediaIds.has(id)),
    selectedCollectionIds: normalizeStringList(input.selectedCollectionIds) ?? defaults.selectedCollectionIds,
    // 缺字段（旧数据 / 从没点过「记住配置」）→ 空数组 = 按归属方向走，与旧行为完全一致，
    // 所以**不需要 bump persist.version**：没有需要折算的旧语义。
    savedTargetCollectionIds: normalizeStringList(input.savedTargetCollectionIds) ?? defaults.savedTargetCollectionIds,
    direction,
    // 旧数据没有这个字段 → 回落默认值，恰好等于它原来的行为（产出链路里写死的也是 crop-fill）
    fitMode: normalizePostprocessFitMode(input.fitMode),
    outputDir: typeof input.outputDir === 'string' ? input.outputDir : defaults.outputDir,
    mediaOutputDirs: normalizeMediaOutputDirs(input.mediaOutputDirs),
    namePattern,
    creator: typeof input.creator === 'string' ? input.creator : defaults.creator,
    watermarkPresetIds: normalizeWatermarkPresetIds(input),
    distribution: normalizePostprocessDistributionConfig(input.distribution),
  }
}

/**
 * 选择列表只保留 `clean` 与当前确实存在的媒体，避免删媒体后留下悬空勾选。
 *
 * 导出给**节点级**参与渠道用：那份列表存在项目树参数里（不在本 store），写入前要跟全局一个口径，
 * 否则「删掉一个渠道」之后节点上会留着它的 id，产出时只能报「选中的媒体已被删除」。
 */
export function pruneSelectedMediaIds(media: PostprocessMedia[], selectedMediaIds: string[]): string[] {
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

      addMedia: (name, id) => {
        const trimmedName = name.trim()
        if (!trimmedName) return null
        const mediaId = (id ?? '').trim() || createCustomMediaId()
        if (get().media.some((item) => item.id === mediaId)) return null
        set((state) => ({ media: [...state.media, { id: mediaId, name: trimmedName, sizes: [] }] }))
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

      deleteMedia: (mediaId) =>
        set((state) => {
          if (!state.media.some((item) => item.id === mediaId)) return state
          const mediaOutputDirs = { ...state.mediaOutputDirs }
          delete mediaOutputDirs[mediaId]
          return {
            media: state.media.filter((item) => item.id !== mediaId),
            selectedMediaIds: state.selectedMediaIds.filter((id) => id !== mediaId),
            mediaOutputDirs,
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

      setSavedTargetCollectionIds: (ids) => set({ savedTargetCollectionIds: normalizeStringList(ids) ?? [] }),

      clearSavedTargetCollectionIds: () => set({ savedTargetCollectionIds: [] }),

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

      setFitMode: (fitMode) => set({ fitMode: normalizePostprocessFitMode(fitMode) }),

      setOutputDir: (outputDir) => set({ outputDir: typeof outputDir === 'string' ? outputDir : '' }),

      setMediaOutputDir: (mediaId, index, outputDir) =>
        set((state) => {
          const id = typeof mediaId === 'string' ? mediaId.trim() : ''
          if (!id || !Number.isInteger(index) || index < 0 || index >= MAX_POSTPROCESS_OUTPUT_DIRS) return state
          const current = normalizeOutputDirList(state.mediaOutputDirs[id])
          const slots = [...current]
          while (slots.length <= index) slots.push('')
          // 归一化会丢掉空槽：`['', 'D:\B']` 塌成 `['D:\B']`（位置 2 顶到位置 1）。
          // 这种「位置 1 空着但位置 2 有值」的组合由 UI 挡掉——第二个位置只在第一个填了之后才加得出来。
          slots[index] = typeof outputDir === 'string' ? outputDir : ''
          const next = normalizeOutputDirList(slots)
          const mediaOutputDirs = { ...state.mediaOutputDirs }
          if (next.length > 0) mediaOutputDirs[id] = next
          else delete mediaOutputDirs[id]
          return { mediaOutputDirs }
        }),

      clearMediaOutputDirs: (mediaId) =>
        set((state) => {
          const id = typeof mediaId === 'string' ? mediaId.trim() : ''
          if (!id || !(id in state.mediaOutputDirs)) return state
          const mediaOutputDirs = { ...state.mediaOutputDirs }
          delete mediaOutputDirs[id]
          return { mediaOutputDirs }
        }),

      setNamePattern: (namePattern) =>
        set({
          namePattern:
            typeof namePattern === 'string' && namePattern.trim()
              ? namePattern.trim()
              : DEFAULT_POSTPROCESS_NAME_PATTERN,
        }),

      setCreator: (creator) => set({ creator: typeof creator === 'string' ? creator : '' }),

      patchDistribution: (patch) =>
        set((state) => ({ distribution: normalizePostprocessDistributionConfig({ ...state.distribution, ...patch }) })),
    }),
    {
      name: 'tangbao-postprocess-media',
      // v2：水印预设由单值 `watermarkPresetId` 改为多值 `watermarkPresetIds`。
      // 必须 bump —— 版本号不变时 zustand 不会触发 `migrate`，旧字段会被静默丢弃，
      // 用户上一版配好的水印在升级后凭空消失。
      // v3：渠道「启用」字段删除（ADR-0013），旧的 `enabled: false` 折成「不参与产出」。
      // 同样必须 bump —— 不跑 `migrate` 的话 `normalize` 里的折算不会发生，
      // 被停用过的渠道会在升级后**悄悄重新开始产出**（行为反转，且界面上看不出发生过什么）。
      //
      // 新增 `fitMode`（画面适配模式）**刻意不 bump**：纯新增字段，且默认值 `crop-fill`
      // 恰好就是旧行为（当时写死在产出链路里），旧数据缺这个字段时浅合并直接拿到默认值。
      // 没有需要折算的旧语义，无谓 bump 只会让所有用户的数据白过一遍 `migrate`。
      version: 3,
      storage: createDesktopJsonStorage('postprocessMedia'),
      partialize: (state) => ({
        media: state.media,
        selectedMediaIds: state.selectedMediaIds,
        selectedCollectionIds: state.selectedCollectionIds,
        // ⚠️ 这是**显式白名单**：新字段忘了加进来 = 点完「记住配置」当场生效、重启就没了，
        // 而界面上不报任何错（`appDataNamespaceContract` 只能守住 namespace，守不住字段）。
        savedTargetCollectionIds: state.savedTargetCollectionIds,
        direction: state.direction,
        fitMode: state.fitMode,
        outputDir: state.outputDir,
        mediaOutputDirs: state.mediaOutputDirs,
        namePattern: state.namePattern,
        creator: state.creator,
        watermarkPresetIds: state.watermarkPresetIds,
        distribution: state.distribution,
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
    savedTargetCollectionIds: [...state.savedTargetCollectionIds],
    direction: state.direction,
    fitMode: state.fitMode,
    outputDir: state.outputDir,
    mediaOutputDirs: Object.fromEntries(
      Object.entries(state.mediaOutputDirs).map(([mediaId, dirs]) => [mediaId, [...dirs]]),
    ),
    namePattern: state.namePattern,
    creator: state.creator,
    watermarkPresetIds: [...state.watermarkPresetIds],
    distribution: { ...state.distribution },
  }
}

/** 用备份数据恢复配置（缺失字段走默认值，不抛错）。 */
export function restorePostprocessMediaConfig(raw: unknown): void {
  usePostprocessMediaStore.setState(normalizePostprocessMediaConfig(raw))
}

export type PostprocessOutputSource = { width: number; height: number }

/**
 * 产出计划：`勾选的项目 × 勾选的媒体 × 尺寸 × 水印预设`。
 *
 * **纯净版只在显式勾选时进列**（2026-09-23 去掉「自动伴随」）：原先「勾了任一渠道就额外多产
 * 一份无水印原图」产出的其实是「无水印 + 沿用生成尺寸 + 不压缩」的 JPEG —— 而素材库里那张
 * 原图**本来就是无水的**，尺寸也没适配过渠道要求，等于把原图有损重编一份，白占磁盘。
 *
 * `projects` 由调用方从项目树解析后传入（store 不依赖 assetLibrary，避免循环/耦合）；
 * 不传则不展开项目维度，单元里也不带 `project` 字段。
 * `presetNames` 是水印预设 id → 展示名的映射（store 不依赖 composite，同样由调用方注入）。
 */
export function selectPostprocessOutputPlan(
  config: Pick<PostprocessMediaConfig, 'media' | 'selectedMediaIds' | 'direction' | 'watermarkPresetIds'>,
  source: PostprocessOutputSource,
  projects: PostprocessProjectTarget[] = [],
  presetNames: Record<string, string> = {},
): PostprocessOutputPlan {
  // 勾了 `clean` 就把它提到最前：顺序即产出顺序，维持旧实现的顺序以免 `{seq}` 编号漂移
  const includeClean = config.selectedMediaIds.includes(PURE_MEDIA_ID)
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
    // id → 展示名；调用方查不到名字时退回 id，宁可在文件名里看见 id 也不要出现空段
    watermarks: config.watermarkPresetIds.map((id) => ({ id, name: presetNames[id] ?? id })),
    presetNames,
  })
}

/**
 * 后处理是否已具备运行条件：至少勾了一个渠道，且至少能产出一个变体。
 *
 * 2026-09-23 起**不再看「启用范围」**：那层白名单已撤掉 —— 方向参不参与改由方向级开关决定
 * （`PostprocessNodeOverride.enabled`），整个后台跑不跑由设置里的总开关决定
 * （`AppSettings.autoPostprocess`）。所以这里只剩一句话：**这批图按当前配置能不能产出东西**。
 */
export function isPostprocessReady(
  config: PostprocessMediaConfig,
  source?: PostprocessOutputSource,
  projects: PostprocessProjectTarget[] = [],
  presetNames: Record<string, string> = {},
): boolean {
  if (config.selectedMediaIds.length === 0) return false
  if (!source) return true
  return selectPostprocessOutputPlan(config, source, projects, presetNames).units.length > 0
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
