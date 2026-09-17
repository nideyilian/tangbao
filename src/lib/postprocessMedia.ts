/**
 * 后处理媒体表：投放渠道 → 尺寸规格（宽高 + 体积上限）。
 *
 * 用途：一次生成原图，按「项目 × 媒体 × 尺寸」批量产出各渠道变体。
 * 数据来源见 `docs/hanling-postprocess-replica-plan.md` §1.2。
 *
 * 约定：
 * - 尺寸 id 用确定性的 `渠道-宽x高`（如 `gdt-1280x720`），便于判重、日志核对与人工编辑。
 * - `maxSizeKb: 0` 表示「不压缩」，不是「压到 0KB」——落盘逻辑必须显式判断，别写成隐式真值判断。
 * - 这张表是可编辑的起点，内置值来自参照系统的前端常量，**不代表投放平台的最终规格**，
 *   首次使用前请按实际渠道复核。
 * - 与参照系统的差异：媒体 id 找不到时**显式跳过并上报**，不静默回退到第一个媒体
 *   （源系统的 `?? media[0]` 会导致「选错媒体却照样出图」）。
 */

/** 后处理媒体下的单个尺寸规格。 */
export interface PostprocessMediaSize {
  id: string
  width: number
  height: number
  /** 体积上限（KB）；0 = 不压缩 */
  maxSizeKb: number
  enabled: boolean
}

/** 一个投放渠道（媒体）及其可用尺寸。 */
export interface PostprocessMedia {
  id: string
  name: string
  enabled: boolean
  sizes: PostprocessMediaSize[]
}

/** 「纯净版」的保留媒体 id：无水印、不压缩、沿用生成尺寸。 */
export const PURE_MEDIA_ID = 'clean'

/** 「纯净版」的展示名。 */
export const PURE_MEDIA_NAME = '纯净版'

/** 内置媒体表（4 媒体 / 15 尺寸）。用户可在后处理设置里增删改。 */
export const DEFAULT_POSTPROCESS_MEDIA: PostprocessMedia[] = [
  {
    id: 'gdt',
    name: '广点通',
    enabled: true,
    sizes: [
      { id: 'gdt-1280x720', width: 1280, height: 720, maxSizeKb: 399, enabled: true },
      { id: 'gdt-1080x1920', width: 1080, height: 1920, maxSizeKb: 399, enabled: true },
    ],
  },
  {
    id: 'baidu',
    name: '百度',
    enabled: true,
    sizes: [
      { id: 'baidu-1140x640', width: 1140, height: 640, maxSizeKb: 299, enabled: true },
      { id: 'baidu-370x245', width: 370, height: 245, maxSizeKb: 299, enabled: true },
      { id: 'baidu-1080x1920', width: 1080, height: 1920, maxSizeKb: 399, enabled: true },
    ],
  },
  {
    id: 'vendor',
    name: '厂商',
    enabled: true,
    sizes: [
      { id: 'vendor-1280x720', width: 1280, height: 720, maxSizeKb: 99, enabled: true },
      { id: 'vendor-1080x1920', width: 1080, height: 1920, maxSizeKb: 99, enabled: true },
      { id: 'vendor-320x211', width: 320, height: 211, maxSizeKb: 80, enabled: true },
      { id: 'vendor-320x210', width: 320, height: 210, maxSizeKb: 80, enabled: true },
      { id: 'vendor-720x1280', width: 720, height: 1280, maxSizeKb: 99, enabled: true },
      { id: 'vendor-720x498', width: 720, height: 498, maxSizeKb: 99, enabled: true },
      { id: 'vendor-474x768', width: 474, height: 768, maxSizeKb: 99, enabled: true },
      { id: 'vendor-1080x528', width: 1080, height: 528, maxSizeKb: 99, enabled: true },
    ],
  },
  {
    id: 'toutiao',
    name: '头条',
    enabled: true,
    sizes: [
      { id: 'toutiao-1080x1920', width: 1080, height: 1920, maxSizeKb: 399, enabled: true },
      { id: 'toutiao-1280x720', width: 1280, height: 720, maxSizeKb: 399, enabled: true },
    ],
  },
]

/** 画面方向。 */
export type OutputDirection = 'landscape' | 'portrait' | 'square'

/** 由一个尺寸推导画面方向。 */
export function resolveOutputDirection(width: number, height: number): OutputDirection {
  if (width > height) return 'landscape'
  if (width < height) return 'portrait'
  return 'square'
}

/** 方向的中文名（用于 UI 展示与日志）。 */
export function getOutputDirectionLabel(direction: OutputDirection): string {
  if (direction === 'landscape') return '横版'
  if (direction === 'portrait') return '竖版'
  return '方形'
}

/** 按 id 查媒体；不存在返回 undefined（调用方需自行决定如何提示）。 */
export function findPostprocessMedia(
  media: PostprocessMedia[] | undefined,
  mediaId: string,
): PostprocessMedia | undefined {
  return media?.find((item) => item.id === mediaId)
}

/**
 * 取某媒体在指定方向下启用的尺寸。
 *
 * - 媒体不存在 → 空数组（**不回退到第一个媒体**）。
 * - `direction` 为 null → 该媒体全部启用尺寸。
 * - 方形源图无天然方向，视作**通配**，返回全部启用尺寸（横竖渠道都会拿到图）。
 */
export function matchMediaSizes(
  media: PostprocessMedia | undefined,
  direction: OutputDirection | null,
): PostprocessMediaSize[] {
  if (!media || !media.enabled) return []
  const enabledSizes = media.sizes.filter((size) => size.enabled)
  if (!direction || direction === 'square') return enabledSizes
  return enabledSizes.filter((size) => resolveOutputDirection(size.width, size.height) === direction)
}

/**
 * 一次项目维度的选中：`collectionId` + 路径名。
 *
 * 路径名由项目树（`AssetCollection` 层级）解析而来，供命名模板的
 * `{line}` / `{product}` / `{direction}` token 使用；缺层时为空串。
 */
export interface PostprocessProjectTarget {
  collectionId: string
  /** 产品线名（项目树第一级） */
  line: string
  /** 产品名（第二级） */
  product: string
  /** 方向名（第三级；用户自己起的名字，不做尺寸推导） */
  direction: string
}

/** 一个待产出的后处理变体（笛卡尔积的一格）。 */
export interface PostprocessOutputUnit {
  mediaId: string
  mediaName: string
  sizeId: string
  width: number
  height: number
  /** KB；0 = 不压缩 */
  maxSizeKb: number
  /** 纯净版：不叠水印 */
  clean: boolean
  direction: OutputDirection
  /** 归属项目；未启用项目维度时**不存在**该字段（不是 undefined） */
  project?: PostprocessProjectTarget
}

/** 产出计划：`skippedMediaIds` 是需要向用户提示的「找不到的媒体」。 */
export interface PostprocessOutputPlan {
  units: PostprocessOutputUnit[]
  skippedMediaIds: string[]
}

/**
 * 后处理编排配置（store 的持久化切片，定义在 lib 以免 `types.ts` 反向依赖 store）。
 *
 * 只含编排，不含任何水印模型：水印走 `CompositeV2Preset` 的 id 引用。
 */
export interface PostprocessMediaConfig {
  /** 媒体（渠道）表；内置 4 媒体 15 尺寸仅为起点，用户可增删改 */
  media: PostprocessMedia[]
  /** 勾选的媒体 id（含 `clean`） */
  selectedMediaIds: string[]
  /** 勾选的项目（`AssetCollection` id）；复用内置三级项目树 */
  selectedCollectionIds: string[]
  /** 手选方向；null = 按源图尺寸自动判定 */
  direction: OutputDirection | null
  /** 输出目录（绝对路径）；空串 = 沿用既有默认输出位置 */
  outputDir: string
  /** 命名模板，见 `src/lib/postprocessNaming.ts` */
  namePattern: string
  /** 创作者，供 `{creator}` token 取值 */
  creator: string
  /** 引用的水印预设 id（`CompositeV2Preset.id`，见 `features/composite/storeV2`）；null = 不加水印 */
  watermarkPresetId: string | null
  /** 纯净版自动伴随：勾了任一渠道媒体时，额外多产一份无水印原图 */
  autoCompanionClean: boolean
}

export interface BuildPostprocessOutputsInput {
  /** 勾选的媒体 id（含 `clean`）；重复项会被去重，顺序即产出顺序 */
  mediaIds: string[]
  media?: PostprocessMedia[]
  /** 生成原图尺寸，供纯净版与方向判定使用 */
  sourceWidth: number
  sourceHeight: number
  /** 手选方向；缺省则按源图尺寸自动判定 */
  direction?: OutputDirection | null
  /**
   * 项目维度；缺省或空数组 → 不展开项目（只按媒体产出，单元里不带 `project` 字段）。
   * 非空时按「项目 × 媒体 × 尺寸」展开，项目顺序即产出顺序。
   */
  projects?: PostprocessProjectTarget[]
}

function dedupeMediaIds(mediaIds: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const mediaId of mediaIds) {
    if (!mediaId || seen.has(mediaId)) continue
    seen.add(mediaId)
    result.push(mediaId)
  }
  return result
}

/**
 * 组合出全部后处理变体：`勾选的项目 × 勾选的媒体 × 该媒体同方向的启用尺寸`。
 *
 * 纯函数，无副作用；幂等输入必得幂等输出（顺序稳定）。选择「先定方向、再筛尺寸」而不是反过来。
 * 项目维度缺省时不展开（单元里不带 `project`），保持「只按媒体产出」的旧行为。
 */
export function buildPostprocessOutputs(input: BuildPostprocessOutputsInput): PostprocessOutputPlan {
  const media = input.media ?? DEFAULT_POSTPROCESS_MEDIA
  const sizeValid =
    Number.isFinite(input.sourceWidth) &&
    Number.isFinite(input.sourceHeight) &&
    input.sourceWidth > 0 &&
    input.sourceHeight > 0
  const sourceDirection = resolveOutputDirection(input.sourceWidth, input.sourceHeight)
  const direction = input.direction ?? (sizeValid ? sourceDirection : 'landscape')
  const mediaIds = dedupeMediaIds(input.mediaIds)
  // 项目维度缺省用单个 null 占位，让下面的循环只有一份实现
  const projects: (PostprocessProjectTarget | null)[] = input.projects?.length ? input.projects : [null]

  const units: PostprocessOutputUnit[] = []
  const skippedMediaIds: string[] = []
  const skipped = new Set<string>()

  for (const project of projects) {
    const projectField = project ? { project } : {}

    for (const mediaId of mediaIds) {
      if (mediaId === PURE_MEDIA_ID) {
        // 纯净版沿用生成尺寸，且不压缩；源尺寸不可用时无法产出，跳过不报错
        if (!sizeValid) continue
        units.push({
          mediaId: PURE_MEDIA_ID,
          mediaName: PURE_MEDIA_NAME,
          sizeId: `${PURE_MEDIA_ID}-${input.sourceWidth}x${input.sourceHeight}`,
          width: input.sourceWidth,
          height: input.sourceHeight,
          maxSizeKb: 0,
          clean: true,
          direction: sourceDirection,
          ...projectField,
        })
        continue
      }

      const target = findPostprocessMedia(media, mediaId)
      if (!target) {
        // 同一个找不到的媒体在多项目下只上报一次
        if (!skipped.has(mediaId)) {
          skipped.add(mediaId)
          skippedMediaIds.push(mediaId)
        }
        continue
      }
      for (const size of matchMediaSizes(target, direction)) {
        units.push({
          mediaId: target.id,
          mediaName: target.name,
          sizeId: size.id,
          width: size.width,
          height: size.height,
          maxSizeKb: size.maxSizeKb,
          clean: false,
          direction: resolveOutputDirection(size.width, size.height),
          ...projectField,
        })
      }
    }
  }

  return { units, skippedMediaIds }
}
