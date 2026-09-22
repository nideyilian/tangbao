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
// 只借类型：适配模式的**唯一真相源**在渲染器那边（`planBackgroundFit` 的入参），
// 这里再立一套同义字面量，将来加第四种模式就会漏改一处。
import type { CompositeV2FitMode } from '../features/composite/lib/compositeV2Types'

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
  sizes: PostprocessMediaSize[]
}

/*
 * ⚠️ 这里曾有一个 `enabled` 字段（「渠道整体停用」），2026-09-21 删除（ADR-0013）。
 *
 * 它与「参与产出」（`selectedMediaIds`）**对产出的影响完全等价**：`matchMediaSizes` 先看渠道启用、
 * `buildPostprocessOutputs` 先按参与列表迭代，任一为关这个渠道就不产出。两个开关说同一件事，
 * 只会让人怀疑它们有什么区别，还多出一种「勾了参与产出却不产出」的静默失效。
 * 旧数据里 `enabled: false` 的渠道由 `normalizePostprocessMediaConfig` 折成「不参与」（见那边的迁移）。
 * **别再把它加回来** —— 「这个渠道暂时不投」就是「不勾参与产出」。
 */

/** 「纯净版」的保留媒体 id：无水印、不压缩、沿用生成尺寸。 */
export const PURE_MEDIA_ID = 'clean'

/** 「纯净版」的展示名。 */
export const PURE_MEDIA_NAME = '纯净版'

/**
 * 单个渠道最多几个导出位置。
 *
 * 两个用于「本地留档 + 共享盘交付」这类**双写**：同一份产物在两个位置各存一份，文件名相同。
 * 上限刻意收成常量而不是放开——导出位置是**写盘放大**（文件数 × 位置数），
 * 放开后一次误配就能把磁盘写满。
 */
export const MAX_POSTPROCESS_OUTPUT_DIRS = 2

/** 默认的画面适配模式：与历史行为一致（曾经是产出链路里写死的常量）。 */
export const DEFAULT_POSTPROCESS_FIT_MODE: CompositeV2FitMode = 'crop-fill'

/**
 * 归一化画面适配模式：未知值一律回落默认值。
 *
 * 必须挡住非法值，不能「原样传给渲染器再看结果」：`planBackgroundFit` 遇到不认识的模式
 * 会抛「未知的背景适应模式」，那是**渲染中途**报错 —— 整张产出当场作废，
 * 而配置里那个坏值还会一直留着，每次跑都废一张。在这里回落是唯一的低成本出口。
 */
export function normalizePostprocessFitMode(value: unknown): CompositeV2FitMode {
  return value === 'contain-blur' || value === 'stretch' || value === 'crop-fill' ? value : DEFAULT_POSTPROCESS_FIT_MODE
}

/**
 * 归一化导出位置列表：去首尾空白、丢空串、去重、保序，最多 `MAX_POSTPROCESS_OUTPUT_DIRS` 个。
 *
 * 空数组是**有效值**，含义是「用默认输出位置」，与 `undefined`（没表态，继续往上继承）是两件事，
 * 所以这里和调用方都不能用 `length` 去判「有没有配」。
 */
export function normalizeOutputDirList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || result.includes(trimmed)) continue
    result.push(trimmed)
    if (result.length >= MAX_POSTPROCESS_OUTPUT_DIRS) break
  }
  return result
}

/** 内置媒体表（4 媒体 / 15 尺寸）。用户可在后处理设置里增删改。 */
export const DEFAULT_POSTPROCESS_MEDIA: PostprocessMedia[] = [
  {
    id: 'gdt',
    name: '广点通',
    sizes: [
      { id: 'gdt-1280x720', width: 1280, height: 720, maxSizeKb: 399, enabled: true },
      { id: 'gdt-1080x1920', width: 1080, height: 1920, maxSizeKb: 399, enabled: true },
    ],
  },
  {
    id: 'baidu',
    name: '百度',
    sizes: [
      { id: 'baidu-1140x640', width: 1140, height: 640, maxSizeKb: 299, enabled: true },
      { id: 'baidu-370x245', width: 370, height: 245, maxSizeKb: 299, enabled: true },
      { id: 'baidu-1080x1920', width: 1080, height: 1920, maxSizeKb: 399, enabled: true },
    ],
  },
  {
    id: 'vendor',
    name: '厂商',
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

/**
 * 方向选择控件的取值域：`auto` 是「跟随源图尺寸」的显式取值，写到 store 时换算回 `null`。
 *
 * 与 `OutputDirection` 放在一起 —— 它是同一个字段的 UI 取值，不是第二套方向定义。
 */
export type DirectionValue = 'auto' | OutputDirection

/** 画面方向选项。**只有这一份**，媒体分区与任何需要方向选择的地方都引用它。 */
export const DIRECTION_OPTIONS: Array<{ value: DirectionValue; label: string }> = [
  { value: 'auto', label: '跟随尺寸' },
  { value: 'landscape', label: '横版' },
  { value: 'portrait', label: '竖版' },
  { value: 'square', label: '方形' },
]

/**
 * 画面适配选项。**只有这一份**：中控台的选择控件、Excel 往返的取值域、产出链的兜底判定
 * 都从这里取，别在界面里另写一份 `[{value: 'crop-fill', label: '裁剪'}, …]`——
 * 那样改一处文案就会出现「表里写裁剪、界面写裁切」。
 */
export const FIT_MODE_OPTIONS: Array<{ value: CompositeV2FitMode; label: string }> = [
  { value: 'crop-fill', label: '裁剪填满' },
  { value: 'contain-blur', label: '模糊填充' },
  { value: 'stretch', label: '拉伸铺满' },
]

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
 *
 * ⚠️ 这里只看**尺寸级**的启用。「这个渠道投不投」是**调用方**的事：它只对
 * `selectedMediaIds` 里列出的渠道调本函数（见 `buildPostprocessOutputs`）——
 * 渠道级曾经还有一个 `enabled` 开关，2026-09-21 已删（ADR-0013）。
 */
export function matchMediaSizes(
  media: PostprocessMedia | undefined,
  direction: OutputDirection | null,
): PostprocessMediaSize[] {
  if (!media) return []
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
  /**
   * 「记住配置」保存的产出目标（`AssetCollection.id` 列表）；顺序即产出顺序。
   *
   * - **空数组 = 没记住** → 每张图按**自己的归属方向**产出（原行为，也是默认值）。
   * - **非空** → 这一批图**全部**按这份列表产出，各自归属不再参与目标推导。
   *
   * 为什么需要它：归属只能表达「这张图属于哪个方向」，而同一批素材经常要同时投到
   * 多个产品 / 多个方向。靠「把素材挂到多个方向」绕不过去 —— 归属取最深的一条
   * （`pickDeepestCollectionId`），同级挂两个只有一个生效、另一个**静默忽略**，
   * 而且挂载会改写素材的真实归属，越挂越乱。
   *
   * ⚠️ 它**不是**「启用范围」：`selectedCollectionIds` 回答「哪些方向允许跑」，
   * 这个字段回答「这次产出到哪些」。两者互相独立，判定也分开做
   * （目标要逐个过启用范围，见 `taskPostprocess`）。
   */
  savedTargetCollectionIds: string[]
  /** 手选方向；null = 按源图尺寸自动判定 */
  direction: OutputDirection | null
  /**
   * 源图适配到目标尺寸的方式（**全局一套**，不参与方向级继承）。
   *
   * 三选一，代价各不同：
   * - `crop-fill`（**默认**）：等比放大填满画布 + 裁掉溢出的边。画面填满、不变形，代价是丢边缘内容。
   * - `contain-blur`：完整画面不变形居中，四周补一圈「原图模糊放大」做底。
   *   代价是带模糊边 —— 电商主图这类对留白敏感的渠道通常不收，用之前先确认渠道规则。
   * - `stretch`：填满且画面完整，但比例被改变（人像/产品会变形）。
   *
   * 默认值与历史行为一致（`taskPostprocess` 曾把 `crop-fill` 写死成常量）——
   * 升级不会让已有产出的画面观感发生变化。
   */
  fitMode: CompositeV2FitMode
  /** 输出目录（绝对路径）；空串 = 沿用既有默认输出位置 */
  outputDir: string
  /**
   * 按渠道（`PostprocessMedia.id`）单独指定的导出位置，每个渠道 1~2 个；命中时优先于 `outputDir`。
   *
   * - 缺键或空数组 = 该渠道用 `outputDir`（**默认输出位置始终保留**，渠道配置只是覆盖）。
   * - 配 2 个位置 = 该渠道双写：同一份产物两处各写一份，文件名相同。
   * - 纯净版没有渠道，因此不在这张表里，固定沿用 `outputDir`。
   *
   * 这是「全局渠道层」，与项目树节点上的同名覆盖（`PostprocessNodeOverride.byMedia`）是同一件事的
   * 两个层级，生效顺序见 `applyPostprocessOverride`。
   */
  mediaOutputDirs: Record<string, string[]>
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
 * - `outputDir` / `outputDirs`：同一方向各渠道交付到不同目录（实测《输出位置明细》里 25/61 个方向如此，
 *   且三段目录连层级顺序都不同，没法用公共前缀或目录变量塞进一个值）；`outputDirs` 支持 1~2 个位置（双写）。
 * - `watermarkPresetIds`：同一方向各渠道的合规水印不同（56/61 个方向如此）。
 *
 * 刻意**不**开放 `namePattern` / `selectedMediaIds` / `distribution` / `direction`：它们要么是
 * 全局规格，要么是「这个节点要不要跑」的开关，按渠道分只会让「到底哪个值生效」需要递归推理。
 * ⚠️ `selectedMediaIds` 在**节点层**是开放的（ADR-0013），但在本层（渠道再细分）仍然不开放 ——
 * 「这个渠道在节点层投不投」就是它有没有出现在那份列表里，再套一层布尔只会多出一个推理步骤。
 * 类型上保持窄，比事后靠约定约束可靠。
 */
export interface PostprocessMediaOverride {
  /**
   * 该渠道的导出位置（1~2 个）；`[]` = 该渠道用默认输出位置。
   *
   * 与下面的 `outputDir` 二选一时**本字段优先**——双写需要两个位置，单值字段表达不了。
   */
  outputDirs?: string[]
  /** 输出目录（绝对路径）；空串 = 用默认输出位置。**旧写法**，保留是为了兼容已导入的数据 */
  outputDir?: string
  /** 水印预设 id 列表；`[]` = 该渠道不加水印（显式覆盖），`undefined` = 回退通用值 */
  watermarkPresetIds?: string[]
}

/**
 * 把「按渠道覆盖」折成导出位置列表；`undefined` = 没表态（继续继承），`[]` = 显式「用默认输出位置」。
 *
 * 单值字段 `outputDir` 只是旧数据的写法，折成 `[]`（空串）而不是 `['']`，
 * 否则空串会被当成一个真实目录传下去。
 */
export function foldMediaOutputDirs(override: PostprocessMediaOverride | undefined): string[] | undefined {
  if (!override) return undefined
  if (override.outputDirs !== undefined) return normalizeOutputDirList(override.outputDirs)
  if (override.outputDir !== undefined) return normalizeOutputDirList([override.outputDir])
  return undefined
}

/**
 * 某个渠道最终生效的导出位置列表（0 = 用默认输出位置，1 = 单写，2 = 双写）。
 *
 * 只读**已合并**的配置：全局渠道层与节点覆盖都由 `applyPostprocessOverride` 折进了
 * `mediaOutputDirs[mediaId]`，所以这里不需要知道继承链。列表为空时回退到 `outputDir` ——
 * 「原有的全局默认位置」永远是兜底，不会被渠道配置弄丢。
 */
export function resolvePostprocessOutputDirs(
  config: Pick<PostprocessMediaConfig, 'outputDir' | 'mediaOutputDirs'>,
  mediaId: string,
): string[] {
  const perMedia = normalizeOutputDirList(config.mediaOutputDirs?.[mediaId])
  if (perMedia.length > 0) return perMedia
  return normalizeOutputDirList([config.outputDir])
}

/**
 * 「本级留空会落到哪」的占位提示文案 —— 导出位置那格输入框的灰字。
 *
 * ⚠️ **一个位置都不能漏**（2026-09-22 TB-095）：同一个渠道上一级可以配两处（双写），
 * 只说第一个会让人以为「跟随只跟一处」，而产出侧两处都会照写 —— 界面显示少于实际生效，
 * 恰恰是最难自查的那类不一致（用户照着界面判断「只会出一份」，实际出两份）。
 *
 * 多于一处时把**数量写在最前**：共享盘路径常被输入框截断，`2 处` 是那一眼要看的信息。
 *
 * 空列表 = 链上没人配过这一格 → 落到默认输出位置（全局层由调用方直接给默认位置那条）。
 */
export function formatInheritedOutputDirsHint(dirs: string[]): string {
  const list = normalizeOutputDirList(dirs)
  if (list.length === 0) return '留空则用默认输出位置'
  if (list.length === 1) return `留空则 ${list[0]}`
  return `留空则继承 ${list.length} 处：${list.join('、')}`
}

/**
 * 某个项目树节点（产品线 / 产品 / 方向）对后处理参数的**局部覆盖**。
 *
 * 只保留「与这个项目 / 这个方向直接相关」的字段（口径见 ADR-0011；`selectedMediaIds`
 * 由 ADR-0013 重新放回节点层）：
 *
 * | 字段                | 为什么留在节点上                                           |
 * | ------------------- | ---------------------------------------------------------- |
 * | `outputDir`         | 实测 25/61 个方向的交付目录不同（ADR-0003）                |
 * | `watermarkPresetIds`| 实测 56/61 个方向的合规水印不同（ADR-0003）                |
 * | `selectedMediaIds`  | 「这个方向投哪几个渠道」是方向维度（ADR-0013，见下）       |
 * | `enabled`           | 「这个方向要不要跑」是节点自有语义                         |
 *
 * **刻意收窄掉的字段**（原 10 字段 → 现 4 + `byMedia`）：`direction` /
 * `namePattern` / `creator` / `autoCompanionClean` / `distribution`。理由是它们**不是**方向维度：
 * - `direction`：画面方向**按源图自动判**（见 `resolveOutputDirection`），不提供手选口子；
 * - `namePattern` / `creator`：命名规则**全局一套**，逐方向配只会让文件名口径分散；
 * - `autoCompanionClean` / `distribution`：属于「全局怎么跑」，无任何逐方向差异证据。
 *
 * ### `selectedMediaIds` 为什么回到节点层（ADR-0013，2026-09-21）
 *
 * ADR-0011 当初把它收走，理由是「勾哪些渠道是**运行时操作**」。实际用下来这个判断只对了一半：
 * 渠道**规格**（渠道名、尺寸、体积上限）确实是全局一套，但「**这个方向**投哪几个渠道」是每批图
 * 都要重新确认的事 —— 它跟 `enabled`（这个方向跑不跑）是同一个层级的决策。放全局之后，
 * 中控台里选一个方向、改的却是所有方向共用的那份勾选，界面还挂着「全局设置」的提示条，
 * 用户没法表达「A 方向投头条、B 方向不投」。
 *
 * 语义与 `watermarkPresetIds` 完全一致：`undefined` = 没表态、沿继承链向上取；**空数组是有效值**，
 * 表示「这个方向一个渠道都不投」。渠道规格表是全局的（`media`）、产出目标
 * （`selectedCollectionIds`）在自动匹配模式下由图片归属推导，两者都**不该**被节点覆盖。
 *
 * ⚠️ `byMedia` 层仍**不**开放本字段：渠道再细分一层「投不投」会让「到底哪个值生效」需要递归推理
 * （见 `PostprocessMediaOverride`）。要在某个渠道上收手，就是把它从本层列表里去掉。
 *
 * 未出现的字段（`undefined`）表示「不表态」，沿继承链向上取值：方向 → 产品 → 产品线 → 全局默认。
 * 要显式表达「这个方向就是不带水印」，用 `watermarkPresetIds: []`——`undefined` 才是继承。
 *
 * `byMedia` 是**同层内的再细分**，不是新的一级继承：本节点某渠道没写时回退到本节点的通用值，
 * 而不是继续往父节点找。否则「方向级写了百度、产品级写了通用」会拼出无法从界面上推理的组合。
 */
export interface PostprocessNodeOverride {
  /** 输出目录（绝对路径）；空串 = 用默认输出位置 */
  outputDir?: string
  /** 水印预设 id 列表；`[]` = 该方向不加水印（显式覆盖），`undefined` = 继承 */
  watermarkPresetIds?: string[]
  /**
   * 该方向投哪几个渠道（媒体 id，含 `clean`）；**`[]` = 这个方向一个渠道都不投**，
   * `undefined` = 继承。
   *
   * 数组顺序即产出顺序（与全局同字段一个口径，`buildPostprocessOutputs` 按它迭代）。
   * 本层不表态时不会「退回空」，而是继续沿继承链向上取 —— 与 `watermarkPresetIds` 同一套规则。
   */
  selectedMediaIds?: string[]
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
 * 节点层只可能改到 `outputDir` / `watermarkPresetIds` / `selectedMediaIds`
 * （+ `byMedia` 的渠道再细分目录与水印），其余字段一律透传基线 —— 它们收归全局（ADR-0011），
 * 节点上不再有覆盖入口。
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
  // 导出位置要按渠道合并到**一个**字段上：写盘侧（`resolvePostprocessOutputDirs`）只认
  // `mediaOutputDirs[mediaId]`，否则「节点里写的两个位置」和「全局渠道表」得在写盘处再拼一次继承链。
  // 顺序：节点渠道（含旧单值写法）→ 节点通用 → 全局渠道 → 全局默认（= 这里的 `outputDir`）。
  const mediaOutputDirs = { ...base.mediaOutputDirs }
  if (mediaId) {
    const nodeDirs = override.outputDir === undefined ? undefined : normalizeOutputDirList([override.outputDir])
    const declared = foldMediaOutputDirs(perMedia) ?? nodeDirs
    if (declared === undefined) {
      // 本节点没表态：基线上该渠道的值照原样留着（正常就是全局渠道表那条）
    } else if (declared.length > 0) {
      mediaOutputDirs[mediaId] = declared
    } else {
      // 显式「用默认输出位置」：连全局渠道配置一起让位，最终落到 `outputDir`
      delete mediaOutputDirs[mediaId]
    }
  }
  return {
    media: base.media,
    // 本节点不表态就沿用基线上的列表（全局或更浅一层）——`[]` 是有效值，别用 `length` 判
    selectedMediaIds: override.selectedMediaIds ?? base.selectedMediaIds,
    selectedCollectionIds: base.selectedCollectionIds,
    // 产出目标是**全局一套**：它是「这次产出到哪些方向」的一次性选择（「记住配置」写入），
    // 逐方向各存一份会让「为什么这张图进了那个目录」需要递归推理。节点层没有覆盖入口，
    // 但必须在这里显式透传 —— 本函数返回的是白名单对象，漏了就是 `undefined` 往下游走。
    savedTargetCollectionIds: base.savedTargetCollectionIds,
    direction: base.direction,
    // 用 `??` 而不是 `||`：空串是「用默认输出位置」、空数组是「这个渠道不加水印」，都是有效值
    outputDir: perMedia?.outputDir ?? override.outputDir ?? base.outputDir,
    // 画面适配是全局规格，节点层没有覆盖入口 → 一律透传基线。
    // ⚠️ 这里**必须显式列出**：函数返回的是白名单对象，漏掉的字段在下游就是 `undefined`，
    // 而渲染器拿到 `undefined` 会抛「未知的背景适应模式」—— 整批产出当场废掉。
    fitMode: base.fitMode,
    mediaOutputDirs,
    namePattern: base.namePattern,
    creator: base.creator,
    watermarkPresetIds: perMedia?.watermarkPresetIds ?? override.watermarkPresetIds ?? base.watermarkPresetIds,
    autoCompanionClean: base.autoCompanionClean,
    distribution: base.distribution,
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
