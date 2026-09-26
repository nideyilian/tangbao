/**
 * 「图转视频」参数的归一化、继承解析与引擎配置映射（纯函数，便于单测）。
 *
 * ## 两套归一化，语义不同（别混用）
 *
 * - `normalizeImageVideoParams`：给**全局基线**用。缺字段 → 落默认值，就地得到一个完整配置。
 * - `normalizeImageVideoOverride`：给**节点覆盖**用。缺字段 / 空串 / 空值 → **从结果里删掉**，
 *   也就是「这个节点对这个字段没表态」⇒ 继续向上继承。
 *
 * 第二条是关键：如果节点覆盖里留着 `imagesPerVideo: undefined` 或者被写成 `0`，
 * 继承就断了 —— 上层配好的值再也影响不到它。所以这里只保留「真的有值」的字段。
 *
 * ## 空串一律算「没表态」
 *
 * 与仓库既有口径一致（见 `features/composite/lib/consoleWorkbook.ts` 的「目录类字段
 * 空字符串 = 继承」）。代价是「显式要求空前缀」无法表达 —— 但那种需求本身极少，
 * 而多一套「空串 vs 未填」的区分会让界面和导入导出都变复杂。
 */

import { sanitizeFileNameCore } from '../../lib/sanitizeFileName'
import {
  DEFAULT_IMAGE_VIDEO_PARAMS,
  IMAGE_VIDEO_EFFECTS,
  IMAGE_VIDEO_LOCAL_DIR_SUFFIX,
  IMAGE_VIDEO_RESOLUTIONS,
  IMAGE_VIDEO_SELECTION_MODES,
  IMAGE_VIDEO_TRANSITIONS,
  type ImageVideoMode,
  type ImageVideoNodeOverride,
  type ImageVideoParams,
} from './types'

/** 各数值字段的取值范围；界面校验与归一化共用同一份，避免两处写两套。 */
export const IMAGE_VIDEO_NUMBER_RANGES = {
  imagesPerVideo: { min: 1, max: 200 },
  secondsPerImage: { min: 0.1, max: 600 },
  totalDuration: { min: 0, max: 36000 },
  videoCount: { min: 1, max: 100 },
  fps: { min: 1, max: 120 },
  effectIntensity: { min: 0, max: 1000 },
  effectSpeed: { min: 0.1, max: 10 },
  bitrate: { min: 100, max: 100000 },
} as const

export type ImageVideoNumberField = keyof typeof IMAGE_VIDEO_NUMBER_RANGES

/** 名字前缀最长保留多少字符（引擎要拿它拼文件名，太长会顶爆路径长度）。 */
const FILE_PREFIX_MAX = 60

/**
 * 清洗文件名前缀。
 *
 * 前缀会参与拼文件名（引擎拼成 `<前缀>-<序号>.mp4`），所以 `\` `:` `*` 这类字符必须剥掉 ——
 * 留着轻则文件名怪异，重则让引擎把文件写到意料之外的位置。
 *
 * 清洗与仓库其它命名场景共用同一个内核（`sanitizeFileName`），不另写一套；
 * 另外把首尾的 `-` 也去掉，否则前缀尾部那个分隔符会和序号前的那个连成 `--`。
 */
function cleanFilePrefix(value: string): string {
  return sanitizeFileNameCore(value, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILE_PREFIX_MAX)
}

/** 前缀：不在或清洗成空 → 一律当「没表态」。 */
function optionalFilePrefix(value: unknown): string | undefined {
  const text = optionalString(value, FILE_PREFIX_MAX)
  if (text === undefined) return undefined
  return cleanFilePrefix(text) || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 取一个范围内的数字；不是有效数字就返回 `undefined`（= 没表态）。 */
function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(max, Math.max(min, parsed))
}

/** 取一个名单内的字符串；不在名单里返回 `undefined`（= 没表态，继续继承）。 */
function optionalAllowed(value: unknown, allowed: readonly string[]): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return allowed.includes(trimmed) ? trimmed : undefined
}

function optionalMode(value: unknown): ImageVideoMode | undefined {
  return value === 'off' || value === 'fixed' || value === 'random' ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return value === true || value === 'true' || value === 1 || value === '1'
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

/** 去掉对象里值为 `undefined` 的键（对象 spread 会带着键，继承判断必须看得见这个区别）。 */
function compact<T extends object>(value: T): T {
  const result = {} as Record<string, unknown>
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item
  }
  return result as T
}

/**
 * 节点覆盖归一化：**只保留真的表了态的字段**。
 *
 * 数值字段越界会被钳到范围内而不是丢弃 —— 用户填了 999 张图，钳成 200 并让他看见，
 * 比悄悄变回「继承」要好（后者会让界面上显示的值和实际生效的值对不上）。
 */
export function normalizeImageVideoOverride(raw: unknown): ImageVideoNodeOverride {
  if (!isRecord(raw)) return {}
  const ranges = IMAGE_VIDEO_NUMBER_RANGES
  const override: ImageVideoNodeOverride = {
    enabled: optionalBoolean(raw.enabled),
    imagesPerVideo: optionalNumber(raw.imagesPerVideo, ranges.imagesPerVideo.min, ranges.imagesPerVideo.max),
    secondsPerImage: optionalNumber(raw.secondsPerImage, ranges.secondsPerImage.min, ranges.secondsPerImage.max),
    totalDuration: optionalNumber(raw.totalDuration, ranges.totalDuration.min, ranges.totalDuration.max),
    videoCount: optionalNumber(raw.videoCount, ranges.videoCount.min, ranges.videoCount.max),
    resolution: optionalAllowed(raw.resolution, IMAGE_VIDEO_RESOLUTIONS),
    fps: optionalNumber(raw.fps, ranges.fps.min, ranges.fps.max),
    imageSelection: optionalAllowed(raw.imageSelection, IMAGE_VIDEO_SELECTION_MODES),
    transitionMode: optionalMode(raw.transitionMode),
    transitionType: optionalAllowed(raw.transitionType, IMAGE_VIDEO_TRANSITIONS),
    effectMode: optionalMode(raw.effectMode),
    effectType: optionalAllowed(raw.effectType, IMAGE_VIDEO_EFFECTS),
    effectIntensity: optionalNumber(raw.effectIntensity, ranges.effectIntensity.min, ranges.effectIntensity.max),
    effectSpeed: optionalNumber(raw.effectSpeed, ranges.effectSpeed.min, ranges.effectSpeed.max),
    bitrate: optionalNumber(raw.bitrate, ranges.bitrate.min, ranges.bitrate.max),
    filePrefix: optionalFilePrefix(raw.filePrefix),
    datePrefix: optionalBoolean(raw.datePrefix),
    outputDir: optionalString(raw.outputDir, 500),
  }
  return compact(override)
}

/**
 * 全局基线归一化：得到一份**完整**配置。
 *
 * 与 override 的差别是「缺字段填默认」而非「缺字段丢弃」。落盘数据被外部改坏
 * （手改 JSON、老版本字段名）时，这里必须能兜住 —— 所以每个字段都是独立判定的，
 * 不依赖 `Object.assign` 之类的整体合并。
 */
export function normalizeImageVideoParams(raw: unknown): ImageVideoParams {
  // 清洗发生在 `normalizeImageVideoOverride` 里（unique 入口），这里只管补默认值 ——
  // 若在出口处再洗一遍，界面上显示的值和实际落盘的值就可能对不上（静默不一致）。
  const override = normalizeImageVideoOverride(raw)
  return { ...DEFAULT_IMAGE_VIDEO_PARAMS, ...override }
}

/**
 * 逐级解析出生效参数：`chain` 必须是**根在前、自身在最后**（见 `resolveProjectNodeIdChain`）。
 *
 * 从默认值起步，逐层浅合并 —— 后出现的覆盖先出现的。这与后处理参数
 * （`applyPostprocessOverride` 的继承链）是同一套语义，两个模块的参数面板不该手感不同。
 */
export function resolveImageVideoParams(chain: readonly ImageVideoNodeOverride[]): ImageVideoParams {
  let merged: ImageVideoParams = { ...DEFAULT_IMAGE_VIDEO_PARAMS }
  for (const layer of chain) {
    merged = { ...merged, ...normalizeImageVideoOverride(layer) }
  }
  return merged
}

/** 引擎一次渲染需要的两个目录。 */
export interface ImageVideoEnginePaths {
  /** 输入：这个方向的产出图片目录 */
  inputDir: string
  /** 输出：视频落点 */
  outputDir: string
}

/**
 * 把糖包的参数翻译成引擎配置。
 *
 * 三个固定值是有意为之，不是漏了：
 * - `use_watermark` / `use_image_watermark`：引擎自带一套水印体系，与糖包的水印库是两回事。
 *   第一版不接，显式关掉 —— 引擎的默认值一旦是开的，就会悄悄往成片上打东西。
 * - `use_bgm`：同上，第一版不出声。
 * - `codec`：固定 H264（投放平台兼容性最好）；要换编码器的人自己改引擎配置，不在糖包这层暴露。
 */
export function buildEngineConfig(params: ImageVideoParams, paths: ImageVideoEnginePaths): Record<string, unknown> {
  return {
    input_dir: paths.inputDir,
    output_dir: paths.outputDir,
    num_images: params.imagesPerVideo,
    duration: params.secondsPerImage,
    total_duration: params.totalDuration,
    fps: params.fps,
    video_count: params.videoCount,
    video_format: 'mp4',
    resolution_preset: params.resolution,
    resolution_presets: [...IMAGE_VIDEO_RESOLUTIONS],
    keep_aspect_ratio: true,
    use_transition: params.transitionMode !== 'off',
    transition_type: params.transitionType,
    random_transition: params.transitionMode === 'random',
    enabled_transitions: [...IMAGE_VIDEO_TRANSITIONS],
    use_video_effect: params.effectMode !== 'off',
    video_effect_type: params.effectType,
    random_video_effect: params.effectMode === 'random',
    enabled_video_effects: [...IMAGE_VIDEO_EFFECTS],
    video_effect_intensity: params.effectIntensity,
    video_effect_speed: params.effectSpeed,
    use_bgm: false,
    bgm_dir: '',
    bgm_files: [],
    random_bgm: false,
    loop_bgm: false,
    codec: 'H264',
    use_watermark: false,
    use_image_watermark: false,
    watermark_layers: [],
    use_date_prefix: params.datePrefix,
    use_first_image_name: false,
    custom_prefix: params.filePrefix,
    image_selection_mode: params.imageSelection,
    bitrate: params.bitrate,
  }
}

/**
 * 视频写到哪。
 *
 * 留空 = **就近输出**：给输入目录名加 `-视频` 后缀，成为它的同级目录。
 * 刻意不写进输入目录本身 —— 那是导出的交付目录，混进 mp4 会让下游
 * （投放、上传、再分发）拿到一堆不是素材的文件；而且分发/排期那一套是按图片文件走的，
 * 目录里多出视频会污染它们。
 */
export function resolveVideoOutputDir(inputDir: string, configured: string): string {
  const trimmedConfigured = configured.trim()
  if (trimmedConfigured) return trimmedConfigured
  const normalizedInput = inputDir.trim().replace(/[\\/]+$/, '')
  if (!normalizedInput) return ''
  return `${normalizedInput}${IMAGE_VIDEO_LOCAL_DIR_SUFFIX}`
}

/**
 * 一句话摘要（表格折叠态与日志用）。
 *
 * 只讲**用户看得懂的三个数**：几个视频、每个视频几张图多久、什么分辨率。
 * 参数有二十多项，摘要里全列等于没摘要。
 */
export function summarizeImageVideoParams(params: ImageVideoParams): string {
  const perVideo = `${params.imagesPerVideo} 张 / ${params.secondsPerImage}s 每张`
  const total = params.totalDuration > 0 ? `，固定总长 ${params.totalDuration}s` : ''
  return `${params.videoCount} 个视频 · ${perVideo}${total} · ${params.resolution} · ${params.fps}fps`
}
