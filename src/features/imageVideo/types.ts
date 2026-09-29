/**
 * 「图转视频」（嵌入的 Python 引擎）领域模型。
 *
 * ## 参数为什么挂项目树
 *
 * 与后处理同一套口径（见 `features/projectTree/types.ts`）：参数按 `AssetCollection.id`
 * 存覆盖切片，**逐级继承**（方向 → 产品 → 产品线 → 全局基线）。一个方向配好之后，
 * 它下面的所有产出都用这一套；产品线共用一套就配在产品线上，不必每个方向重配一遍。
 *
 * ## 字段是「引擎字段」的翻译，不是重新发明
 *
 * 引擎（`D:\AAA\image-to-video`）自己有一张 40 多项的配置表。这里只收**糖包用得到的**，
 * 并且尽量保持一一对应；两个例外做了合并，因为它们对用户是「三种状态」而不是两个开关：
 *
 * - 转场：引擎是 `use_transition` + `random_transition` 两个布尔，用户想的是
 *   「不要转场 / 固定一种 / 随机」。合并成 `transitionMode` 三选一，映射见 `params.ts`。
 * - 动态效果：同上，`effectMode`。
 *
 * 名单（转场 / 效果 / 分辨率）**照抄引擎的**，不自己编：引擎认中文名，
 * 写错一个就是运行时静默跳过（`job.py` 按名字查表，查不到按无效果处理）。
 */

import type { PostprocessNameToken } from '../../lib/postprocessNaming'

/** 分辨率预设；引擎原样认这些字符串。 */
export const IMAGE_VIDEO_RESOLUTIONS = [
  '1280x720',
  '1920x1080',
  '2560x1440',
  '3840x2160',
  '1080x1920',
  '720x1280',
  '1080x1080',
] as const

/** 引擎内置转场名单（`img2video_config.json` 的 `enabled_transitions`）。 */
export const IMAGE_VIDEO_TRANSITIONS = [
  '淡入淡出',
  '左右滑动',
  '上下滑动',
  '交叉溶解',
  '缩放过渡',
  '圆形扩展',
  '百叶窗',
  '棋盘格',
  '像素化',
  '旋转变换',
  '波浪',
  '颜色混合',
  '方块过渡',
  '放大冲击',
  '缩小爆炸',
  '旋转放大',
  '弹性缩放',
  '3D翻转',
  '推入效果',
  '对角擦除',
  '门式打开',
  '闪光过渡',
  '碎片飞散',
  '光晕扩散',
  '径向旋切',
  '漩涡扭曲',
  '菱形开幕',
  '镜头虚焦',
  '纵向拉幕',
  '横向拉幕',
  '液态融合',
  '流光擦拭',
  '时钟扫描',
] as const

/** 引擎内置画面动态效果名单（`enabled_video_effects`）。 */
export const IMAGE_VIDEO_EFFECTS = [
  '心跳跳动',
  '反复缩放',
  '轻微摇摆',
  '左右晃动',
  '上下浮动',
  '镜头呼吸',
  '脉冲放大',
  '旋转摆动',
  '旋转呼吸',
  '摇摆推拉',
  '圆周漂移',
  '螺旋摆动',
  '双轴呼吸',
  '心跳摇摆',
  '波浪平移',
  '8字漂移',
  '径向脉冲旋转',
  '镜头抖动呼吸',
  '反向双旋',
  '呼吸变焦扫光',
  '旋摆模糊脉冲',
  '透视呼吸摆动',
  '涡旋推拉',
  '变焦摇移',
  '旋转漂移闪动',
  '双频摆动',
  '环形巡航',
  '呼吸鱼眼旋摆',
  '水波扭曲',
  '漩涡旋转',
  '鱼眼镜头',
  '故障抖动',
  '镜像扫光',
  '呼吸模糊',
  '径向拉伸',
  '边缘闪烁',
  '透视俯仰',
  '滚动快门',
  '灵魂出窍',
] as const

/** 转场 / 动态效果的三种状态。 */
export type ImageVideoMode = 'off' | 'fixed' | 'random'

/**
 * 引擎的选图方式（`image_selection_mode`），**只认这三个值**。
 *
 * 与引擎 `IMAGE_SELECTION_MODES` 逐字一致 —— 写错一个字符引擎会静默按随机处理，
 * 界面上还显示着你选的那个名字（属于最难受的一类不一致）。
 */
export const IMAGE_VIDEO_SELECTION_MODES = ['按名称排序', '随机选择', '按子文件夹抽取'] as const

/**
 * 视频水印的各档取值：**逐字照抄引擎的下拉表**（`src/gui_qt/main_window.py` 的 addItems）。
 *
 * 引擎按中文名查映射表（`watermark.py` 的 `get_ffmpeg_blend_mode` 等），写错一个字符就是
 * 静默按默认值处理 —— 界面上显示着你选的、成片用的是另一个，这类不一致最难查。
 */
export const IMAGE_VIDEO_WATERMARK_POSITIONS = ['左上', '右上', '左下', '右下', '中心'] as const
export const IMAGE_VIDEO_WATERMARK_SIZE_MODES = ['固定比例', '自适应覆盖', '完全覆盖'] as const
export const IMAGE_VIDEO_WATERMARK_BLEND_MODES = ['正常', '滤色', '叠加', '正片叠底', '变亮', '变暗', '相加'] as const
export const IMAGE_VIDEO_WATERMARK_MATCH_METHODS = ['循环', '拉伸', '单次'] as const
/** 成片音轨：用了带音轨的水印视频时，成片留谁的声音。 */
export const IMAGE_VIDEO_WATERMARK_AUDIO_MODES = ['使用BGM', '使用水印', '两者混合', '静音'] as const

/** 水印取用方式：单个文件，还是从文件夹里按视频序号轮转取。 */
export type ImageVideoWatermarkMode = 'single' | 'folder'

/**
 * 「出几个视频」怎么定。
 *
 * - `fixed`：按 `videoCount` 出**固定数量**（默认，也一直是以前的行为）；
 * - `perImage`：**每张图各出一个视频** —— 杰哥 2026-09-28 要的「单图加特效」那种：
 *   一个视频只用 1 张图、靠画面效果撑满时长，视频数 = **目录里的图片数**。
 *
 * 引擎（`src/engine/config.py`）**没有**这个模式：它要求显式给「视频数」与「图片数」，
 * 还校验「图片数 ≥ 视频数 × 每片图片数」。所以 `perImage` 是糖包这边**数完图再换算**过去的
 * （见 `runVideo.ts` 的 `resolveVideoPlan`）—— 别指望引擎自己会数。
 */
export type ImageVideoCountMode = 'fixed' | 'perImage'

/** 一套完整的图转视频参数（全局基线就是这个形状，节点覆盖是它的 Partial）。 */
export interface ImageVideoParams {
  /**
   * 这个方向要不要出视频。
   *
   * **默认关**（与「自动后处理」同一个口径）：出视频是重活（要跑 ffmpeg 编码），
   * 不该靠默认值把用户的机器占满。
   */
  enabled: boolean
  /** 每个视频用几张图 */
  imagesPerVideo: number
  /** 每张图停留多少秒 */
  secondsPerImage: number
  /** 固定总时长（秒）；`0` = 按「图片数 × 每图时长」自动算 */
  totalDuration: number
  /**
   * 「出几个视频」怎么定（见 `ImageVideoCountMode`）。
   *
   * `perImage` 时下面那两个字段**都不生效**：每个视频恒用 1 张图、视频数 = 目录里的图片数。
   */
  videoCountMode: ImageVideoCountMode
  /** 一次出几个视频（`videoCountMode === 'fixed'` 时生效） */
  videoCount: number
  /** 分辨率预设，取值见 `IMAGE_VIDEO_RESOLUTIONS` */
  resolution: string
  fps: number
  /**
   * 选图方式，取值见 `IMAGE_VIDEO_SELECTION_MODES`。
   *
   * 默认「按名称排序」而**不是**引擎默认的「随机选择」：糖包的口径是
   * 「同样的配置跑出同样的结果」，随机选图会让同一个方向跑两次拿到不同的成片，
   * 出了问题没法复现。要随机的人自己在表格里改。
   */
  imageSelection: string
  transitionMode: ImageVideoMode
  /** `transitionMode === 'fixed'` 时用哪一种转场 */
  transitionType: string
  effectMode: ImageVideoMode
  /** `effectMode === 'fixed'` 时用哪一种动态效果 */
  effectType: string
  /**
   * 动态效果强度（引擎量纲：**百分比，100 = 正常强度**）。
   *
   * 引擎里是 `intensity_scale = intensity / 100.0`（`render/effects.py`），
   * 所以 100 是"设计强度"，比 100 小就变轻微。注意别把它当 0~1 的系数填。
   */
  effectIntensity: number
  /** 动态效果速度倍率（引擎默认 1.0） */
  effectSpeed: number
  /** 视频码率（kbps） */
  bitrate: number
  /**
   * 输出文件的**命名模板**（可用占位符见 `IMAGE_VIDEO_NAME_TOKENS`）。
   *
   * ⚠️ **不含序号**：引擎固定把 `-1`、`-2` 加在末尾，`{seq}` 写了也会被忽略
   * （序号由「这一次出几个视频」决定，糖包给不出）。所以这里渲染出来就是引擎的
   * `custom_prefix`（见 `naming.ts` 的 `resolveVideoNamePrefix`）。
   *
   * 空 = 没表态（继续向上继承），继承链最底端是 `IMAGE_VIDEO_NAME_PATTERN`。
   */
  namePattern: string
  /**
   * 输出目录（绝对路径）。
   *
   * **空 = 就近输出**：写在输入目录同级、名字加 `-视频` 的文件夹里。
   * 之所以不默认写进输入目录本身：那个目录是导出交付用的，混进 mp4 会让下游
   * （投放、上传、再分发）拿到一堆不是素材的文件。
   */
  outputDir: string

  // ---------- BGM（背景音乐）----------

  /**
   * 要不要配背景音乐。
   *
   * **默认关**，与「出视频」「加水印」同一个口径：靠默认值把声音加进成片，
   * 用户拿去投放时才会发现不对（那时候已经导出几十条了）。
   */
  useBgm: boolean
  /** 音量 0~1（引擎量纲就是 0~1，不是百分比）。 */
  bgmVolume: number
  /**
   * 选曲方式：`true` = 每个视频随机抽一首，`false` = 按视频序号**轮转**。
   *
   * 默认轮转：糖包的口径是「同样的配置跑出同样的结果」，随机选曲会让同一个方向跑两次
   * 拿到不同的成片，出了问题没法复现。要随机的人自己在表格里改。
   */
  bgmRandom: boolean
  /** 一首放完了循环播；关掉就是放完即止（视频比曲子长时会静音） */
  bgmLoop: boolean
  /**
   * 用 BGM 库里的哪个文件夹的曲子；`''` = 整个库。
   *
   * 存**库内相对路径**而不是绝对路径：库搬家（换盘 / 共享盘路径变）之后仍然指得对。
   * 绝对路径由 `params.ts` 在生成引擎配置时拼出来。
   */
  bgmFolder: string

  // ---------- 视频水印（MOV / MP4，也支持图片）----------

  /** 要不要叠视频水印。默认关（同上，不靠默认值改用户的成片）。 */
  useVideoWatermark: boolean
  /** 单个文件 还是 从文件夹里轮转取 */
  watermarkMode: ImageVideoWatermarkMode
  /**
   * 库内相对路径：`single` 时是文件、`folder` 时是文件夹；`''` = 用整个水印库。
   *
   * 同样存相对路径（理由见 `bgmFolder`）。
   */
  watermarkPath: string
  /** 位置，取值见 `IMAGE_VIDEO_WATERMARK_POSITIONS` */
  watermarkPosition: string
  /** 大小模式，见 `IMAGE_VIDEO_WATERMARK_SIZE_MODES` */
  watermarkSizeMode: string
  /** 缩放百分比（引擎默认 100） */
  watermarkScale: number
  /** 混合模式，见 `IMAGE_VIDEO_WATERMARK_BLEND_MODES` */
  watermarkBlendMode: string
  /** 水印时长的匹配方式，见 `IMAGE_VIDEO_WATERMARK_MATCH_METHODS` */
  watermarkMatchMethod: string
  /** 成片音轨，见 `IMAGE_VIDEO_WATERMARK_AUDIO_MODES` */
  watermarkAudio: string
}

/**
 * 节点级覆盖：字段缺省（`undefined`）= 继承上层。
 *
 * 与 `PostprocessNodeOverride` 同一套语义 —— 显式给值才算表态，
 * 于是「方向没说话」和「方向明确要求不加日期前缀」能区分开。
 */
export type ImageVideoNodeOverride = Partial<ImageVideoParams>

/** 输出目录为空时的就近目录名后缀。 */
export const IMAGE_VIDEO_LOCAL_DIR_SUFFIX = '-视频'

/**
 * 视频命名可用的 token：**后处理那套的子集**（渲染复用 `lib/postprocessNaming`）。
 *
 * 比后处理少两个：
 * - `{preset}`（水印预设名）—— 视频水印取自素材库的文件/文件夹，不是预设体系；
 * - `{seq}`（序号）—— 引擎固定加在末尾，模板里写了也不生效。
 *
 * 渲染器认的这一份要和界面变量按钮列的那一份**同源**（都读这个常量），别各写一遍。
 */
export const IMAGE_VIDEO_NAME_TOKENS = [
  'date',
  'line',
  'product',
  'direction',
  'media',
  'creator',
  'size',
] as const satisfies readonly PostprocessNameToken[]

/** 默认命名模板：`20260929-机器人-竖版-广点通-1.mp4`（末尾的 `-1` 由引擎加）。 */
export const IMAGE_VIDEO_NAME_PATTERN = '{date}-{product}-{direction}-{media}'

/**
 * 默认参数。
 *
 * 取值刻意保守：**不自动出视频、不随机转场、不加花哨动态效果**。
 * 随机转场虽然观感好，但它不可复现（同一个方向跑两次结果不同），
 * 与糖包其它地方「同样的配置跑出同样的结果」的口径冲突 —— 要随机的人自己在表格里改。
 */
export const DEFAULT_IMAGE_VIDEO_PARAMS: ImageVideoParams = {
  enabled: false,
  imagesPerVideo: 6,
  secondsPerImage: 2,
  totalDuration: 0,
  videoCountMode: 'fixed',
  videoCount: 1,
  resolution: '1280x720',
  fps: 30,
  imageSelection: '按名称排序',
  transitionMode: 'fixed',
  transitionType: '淡入淡出',
  effectMode: 'fixed',
  effectType: '镜头呼吸',
  effectIntensity: 100,
  effectSpeed: 1,
  bitrate: 2000,
  namePattern: IMAGE_VIDEO_NAME_PATTERN,
  outputDir: '',
  useBgm: false,
  bgmVolume: 0.5,
  bgmRandom: false,
  bgmLoop: false,
  bgmFolder: '',
  useVideoWatermark: false,
  // 默认「文件夹轮转」而不是引擎默认的「单文件」：这个功能的库本来就是按文件夹收素材的
  // （一个方向换一批水印是常态），单文件反而要用户每次先挑一个。
  watermarkMode: 'folder',
  watermarkPath: '',
  // ⚠️ 位置**刻意不用引擎默认的「中心」**：中心水印会直接压住画面主体，
  // 作为默认值不合理（用户开了水印没改位置，成片就废了）。角落是水印的常态位置。
  watermarkPosition: '右下',
  watermarkSizeMode: '自适应覆盖',
  watermarkScale: 100,
  watermarkBlendMode: '正常',
  watermarkMatchMethod: '循环',
  watermarkAudio: '使用BGM',
}
