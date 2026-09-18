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

import type { PostprocessDistributionConfig } from './postprocessDistribution'

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
  /**
   * 该方向**归属到**的水印预设 id（项目树参数层解析出来的结果），顺序即产出顺序。
   *
   * 由调用方注入——`lib` 不能反向依赖项目树参数层。`undefined` = 没给，退回外层那份水印列表；
   * **空数组是有效值**，表示「这个方向明确不加水印」。这两件事必须分开判（用 `undefined` 而不是
   * `length`），否则「少一个预设」会被写成「一个都不要」。
   */
  watermarkPresetIds?: string[]
  /**
   * 同上，但**按渠道**细分（键为媒体 id）；命中时优先于 `watermarkPresetIds`。
   *
   * 同一个方向的厂商 / 百度 / 头条叠的合规水印常常不同，而水印是「每个渠道尺寸各出一份」的
   * 维度之一，不按渠道给就算不出正确的产出条数。纯净版不叠水印，所以它不在这张表里。
   */
  watermarkPresetIdsByMedia?: Record<string, string[]>
}

/** 产出用的水印预设引用：只带 id 与展示名，让 lib 层不依赖 composite 的类型。 */
export interface PostprocessWatermarkRef {
  id: string
  name: string
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
  /**
   * 该单元叠加的水印预设；纯净版与「未选任何预设」时**不存在**该字段。
   *
   * 预设是**单元维度**而不是配置维度：同一方向可配多个预设，每个预设各出一套完整尺寸规格。
   */
  watermark?: PostprocessWatermarkRef
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
  /**
   * 引用的水印预设（`CompositeV2Preset.id`，见 `features/composite/storeV2`）；**空数组 = 不加水印**。
   *
   * 配多个预设 → 每个渠道尺寸各出一套（产出量与文件数按预设数倍增）。
   * 数组顺序即产出顺序，保证同样的配置每次跑出同样的结果。
   */
  watermarkPresetIds: string[]
  /** 纯净版自动伴随：勾了任一渠道媒体时，额外多产一份无水印原图 */
  autoCompanionClean: boolean
  /** 产出后的按天分发（默认关闭）；见 `src/lib/postprocessDistribution.ts` */
  distribution: PostprocessDistributionConfig
}

/**
 * 按媒体（渠道）细分的覆盖。
 *
 * 只开放「同一个方向在不同渠道上确实不一样」的两项：
 * - `outputDir`：同一方向各渠道交付到不同目录（实测《输出位置明细》里 25/61 个方向如此，
 *   且三段目录连层级顺序都不同，没法用公共前缀或目录变量塞进一个值）；
 * - `watermarkPresetIds`：同一方向各渠道的合规水印不同（56/61 个方向如此）。
 *
 * 刻意**不**开放 `namePattern` / `selectedMediaIds` / `distribution` / `direction`：它们要么是
 * 全局规格，要么是「这个节点要不要跑」的开关，按渠道分只会让「到底哪个值生效」需要递归推理。
 * 类型上保持窄，比事后靠约定约束可靠。
 */
export interface PostprocessMediaOverride {
  /** 输出目录（绝对路径）；空串 = 用默认输出位置 */
  outputDir?: string
  /** 水印预设 id 列表；`[]` = 该渠道不加水印（显式覆盖），`undefined` = 回退通用值 */
  watermarkPresetIds?: string[]
}

/**
 * 某个项目树节点（产品线 / 产品 / 方向）对后处理参数的**局部覆盖**。
 *
 * 与 `PostprocessMediaConfig` 的差别：只允许覆盖「逐方向可变」的字段——
 * 渠道字典（`media`）是全局共享规格表，产出目标（`selectedCollectionIds`）在自动匹配模式下
 * 由图片归属推导，两者都**不该**被节点覆盖。
 *
 * 未出现的字段（`undefined`）表示「不表态」，沿继承链向上取值：方向 → 产品 → 产品线 → 全局默认。
 * 要显式表达「这个方向就是不带水印」，用 `watermarkPresetIds: []`——`undefined` 才是继承。
 *
 * `byMedia` 是**同层内的再细分**，不是新的一级继承：本节点某渠道没写时回退到本节点的通用值，
 * 而不是继续往父节点找。否则「方向级写了百度、产品级写了通用」会拼出无法从界面上推理的组合。
 */
export interface PostprocessNodeOverride {
  /** 该方向启用的媒体 id（含 `clean`）；undefined = 继承 */
  selectedMediaIds?: string[]
  /** 手选方向；`null` = 按源图尺寸自动判定 */
  direction?: OutputDirection | null
  /** 输出目录（绝对路径）；空串 = 用默认输出位置 */
  outputDir?: string
  namePattern?: string
  creator?: string
  /** 水印预设 id 列表；`[]` = 该方向不加水印（显式覆盖），`undefined` = 继承 */
  watermarkPresetIds?: string[]
  autoCompanionClean?: boolean
  /** 分发配置；`undefined` = 继承。**整份替换**而非字段合并，要单独关掉写 `{ enabled: false }` */
  distribution?: PostprocessDistributionConfig
  /** 该方向是否参与自动后处理；false = 归属此方向的图片不产出变体 */
  enabled?: boolean
  /**
   * 按渠道细分覆盖；键为媒体 id（`PostprocessMedia.id`）。
   *
   * 命中的渠道用这里面的值，其余渠道回退本节点的通用值（再往上是继承链）。
   * 只对本层生效，不会往父节点继续找——见类型上方注释。
   */
  byMedia?: Record<string, PostprocessMediaOverride>
}

/**
 * 把节点覆盖叠加到基线配置上（纯函数，不改写入参）。
 *
 * `enabled` 是节点自有概念、不属于 `PostprocessMediaConfig`，故不参与合并，由调用方单独读取。
 *
 * `mediaId` 给出时，先取该渠道在 `byMedia` 里的值：命中的字段优先于本节点的通用值，
 * 未命中的字段照旧回退通用值。渠道是**单元维度**（同一张原图会展开成多个渠道的变体），
 * 所以调用方要在逐单元那一层传入它，不能只在「一张源图解析一次」那里传。
 */
export function applyPostprocessOverride(
  base: PostprocessMediaConfig,
  override: PostprocessNodeOverride | undefined,
  mediaId?: string,
): PostprocessMediaConfig {
  if (!override) return base
  const perMedia = mediaId ? override.byMedia?.[mediaId] : undefined
  return {
    media: base.media,
    selectedMediaIds: override.selectedMediaIds ?? base.selectedMediaIds,
    selectedCollectionIds: base.selectedCollectionIds,
    direction: override.direction === undefined ? base.direction : override.direction,
    // 用 `??` 而不是 `||`：空串是「用默认输出位置」、空数组是「这个渠道不加水印」，都是有效值
    outputDir: perMedia?.outputDir ?? override.outputDir ?? base.outputDir,
    namePattern: override.namePattern ?? base.namePattern,
    creator: override.creator ?? base.creator,
    watermarkPresetIds: perMedia?.watermarkPresetIds ?? override.watermarkPresetIds ?? base.watermarkPresetIds,
    autoCompanionClean: override.autoCompanionClean ?? base.autoCompanionClean,
    // 分发是整份配置对象：只读使用，不做深拷贝
    distribution: override.distribution ?? base.distribution,
  }
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
  /**
   * 水印预设维度；缺省或空数组 → 每个尺寸只出 1 个不叠水印的单元。
   * 非空时再乘一层：同一尺寸按预设各出一份，顺序即产出顺序。
   *
   * 项目自带归属（`project.watermarkPresetIds`）时以归属为准，这份只作兜底。
   */
  watermarks?: PostprocessWatermarkRef[]
  /**
   * 预设 id → 展示名；用来给项目级归属解出名字。
   *
   * 归属只带 id（它来自项目树参数层，那边不认识 composite 的预设对象），
   * 查不到名字时退回 id——宁可在文件名里看见 id，也不要出现一个空段。
   */
  presetNames?: Record<string, string>
}

/** 按 id 去重（保序），丢掉空 id 的条目。 */
function dedupeWatermarks(watermarks: PostprocessWatermarkRef[] | undefined): PostprocessWatermarkRef[] {
  if (!watermarks?.length) return []
  const seen = new Set<string>()
  const result: PostprocessWatermarkRef[] = []
  for (const item of watermarks) {
    const id = typeof item?.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name: typeof item.name === 'string' ? item.name.trim() : '' })
  }
  return result
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
 * 组合出全部后处理变体：`勾选的项目 × 勾选的媒体 × 该媒体同方向的启用尺寸 × 水印预设`。
 *
 * 纯函数，无副作用；幂等输入必得幂等输出（顺序稳定）。选择「先定方向、再筛尺寸」而不是反过来。
 * 项目维度缺省时不展开（单元里不带 `project`），保持「只按媒体产出」的旧行为。
 * 水印预设与媒体、项目同为**维度**：配了 N 个预设，每个渠道尺寸就出 N 份。
 * 纯净版是原图本身，**不随预设倍增**（同一张原图存 N 份毫无意义）。
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
  const watermarks = dedupeWatermarks(input.watermarks)
  const presetNames = input.presetNames ?? {}
  // 项目维度缺省用单个 null 占位，让下面的循环只有一份实现
  const projects: (PostprocessProjectTarget | null)[] = input.projects?.length ? input.projects : [null]

  const units: PostprocessOutputUnit[] = []
  const skippedMediaIds: string[] = []
  const skipped = new Set<string>()

  for (const project of projects) {
    const projectField = project ? { project } : {}
    // 项目自带的归属优先：同一个方向在厂商 / 百度 / 头条叠的水印本来就不同，用一份全局列表
    // 展开出来的清单跟实际产出对不上，用户就没法拿它确认配置。
    // 一律判 `undefined` 而不是 `length`——空数组是「这个方向明确不加水印」，跟「没给」是两件事。
    const watermarksForMedia = (mediaId: string): PostprocessWatermarkRef[] => {
      const byMedia = project?.watermarkPresetIdsByMedia?.[mediaId]
      const declared = byMedia !== undefined ? byMedia : project?.watermarkPresetIds
      if (declared === undefined) return watermarks
      return dedupeWatermarks(declared.map((id) => ({ id, name: presetNames[id] ?? id })))
    }

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
      // 逐渠道算一次而不是在尺寸循环里反复算：水印是「每渠道各出一套」的维度
      const mediaWatermarks = watermarksForMedia(mediaId)
      for (const size of matchMediaSizes(target, direction)) {
        const unit: PostprocessOutputUnit = {
          mediaId: target.id,
          mediaName: target.name,
          sizeId: size.id,
          width: size.width,
          height: size.height,
          maxSizeKb: size.maxSizeKb,
          clean: false,
          direction: resolveOutputDirection(size.width, size.height),
          ...projectField,
        }
        // 没配预设 → 该尺寸只出一份不叠水印的；配了 → 每个预设各出一份
        if (mediaWatermarks.length === 0) {
          units.push(unit)
          continue
        }
        for (const watermark of mediaWatermarks) units.push({ ...unit, watermark })
      }
    }
  }

  return { units, skippedMediaIds }
}
