/**
 * 水印预设的数据模型。
 *
 * 这里曾经有整套「批量导出编排」的类型（导出任务/队列/成功失败项/分发配置/
 * 历史记录/渠道尺寸规则/自定义命名变量）。编排职责已统一到 `features/postprocess`
 * 那一套，本文件因此只保留水印预设本身：画布基准、图层、预览背景。
 *
 * 预设不再带输出路径与命名模板——输出目录、命名、渠道尺寸全部由后处理的
 * 「项目树参数 + 媒体表」决定。同一个参数不再有两个来源，是这次收敛的核心。
 *
 * `CompositeV2PresetGroup`（预设组）也已删除：它当时唯一的作用是给左栏库做筛选，
 * 与归属/产出零关系，于是「哪套水印该给哪个方向用」只能靠人脑记。现在分组这件事
 * 交给项目树本身——方向节点上挂哪些预设，就是分组，且它就是归属。
 */

export type CompositeV2FitMode = 'crop-fill' | 'contain-blur' | 'stretch'

export type CompositeV2Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type CompositeV2Position =
  | {
      mode: 'anchor'
      anchor: CompositeV2Anchor
      marginX: number
      marginY: number
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
  | {
      mode: 'free'
      x: number
      y: number
      width: number
      height: number
    }

export type CompositeV2Shadow = {
  enabled: boolean
  color: string
  x: number
  y: number
  blur: number
  opacity: number
}

export type CompositeV2Stroke = {
  enabled: boolean
  color: string
  width: number
}

export type CompositeV2LayerBase = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  rotation: number
  position: CompositeV2Position
  shadow: CompositeV2Shadow
  stroke?: CompositeV2Stroke
}

export type CompositeV2ImageAssetRef =
  | { kind: 'path'; path: string }
  | { kind: 'internal'; path: string; originalPath?: string }
  | { kind: 'dataUrl'; dataUrl: string; name?: string }
  | { kind: 'project'; id: string }
  | { kind: 'stored'; assetId: string; name?: string }

export type CompositeV2MediaLayer = CompositeV2LayerBase & {
  type: 'image' | 'logo'
  asset: CompositeV2ImageAssetRef | null
  radius: number
  clip: boolean
}

export type CompositeV2ImageLayer = CompositeV2MediaLayer & {
  type: 'image'
}

export type CompositeV2LogoLayer = CompositeV2MediaLayer & {
  type: 'logo'
}

export type CompositeV2TextLayer = CompositeV2LayerBase & {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
  padding: number
}

export type CompositeV2Layer = CompositeV2ImageLayer | CompositeV2LogoLayer | CompositeV2TextLayer

/**
 * 水印标识符的附加位置。
 *
 * - `prefix`：贴在文案开头
 * - `suffix`：贴在文案结尾
 * - `both`：两侧都贴
 */
export type CompositeV2IdentifierPlacement = 'prefix' | 'suffix' | 'both'

/**
 * 水印标识符（全局一份，对所有预设生效）。
 *
 * 它是**派生值**而不是预设里的一个图层：写进图层就得每个预设各改一遍，且别人导入你的预设时
 * 会把你的署名一起带来。放在全局、渲染时叠加，既能「所有带文字的水印一次性全生效」，
 * 也能让导出文件里带不带署名成为可选项。
 */
export type CompositeV2IdentifierConfig = {
  /** 标识符原文（前后空格保留：用户可能就想要「文案 · @小王」这种带间隔的效果） */
  text: string
  placement: CompositeV2IdentifierPlacement
}

/** 预设里没有任何可用文字水印时，标识符退化成一个左下角文字层——这些是它的默认样式。 */
export const IDENTIFIER_FALLBACK_STYLE = {
  /** 字号取 baseCanvas 短边的比例：竖版横版都能得到视觉上一致的大小 */
  fontSizeRatio: 0.032,
  color: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidthRatio: 0.006,
  marginRatio: 0.03,
} as const

export type CompositeV2Preset = {
  id: string
  name: string
  baseCanvas: { width: number; height: number }
  sampleBackgroundPath: string
  layers: CompositeV2Layer[]
  updatedAt: number
}

export type CompositeV2BackgroundImage = {
  path: string
  name: string
  relativeDir: string
  width: number
  height: number
  /**
   * 图片数据（可选）。素材库送入的无本地文件的生成图走 dataUrl 模式：
   * 渲染/预览时优先用 dataUrl，否则回退到 readImageFile(path) 读本地文件。
   */
  dataUrl?: string
}

type CompositeV2ProjectLogoBase = {
  id: string
  name: string
  width?: number
  height?: number
}

export type CompositeV2ProjectLogo = CompositeV2ProjectLogoBase &
  ({ assetId: string; dataUrl?: never } | { assetId?: never; dataUrl: string })

export type CompositeV2State = {
  logoLibraryPath: string
  logoOrder: string[]
  projectLogos: CompositeV2ProjectLogo[]
  presets: CompositeV2Preset[]
  globalFitMode: CompositeV2FitMode
  backgroundFolders?: string[]
  recursiveBackgrounds?: boolean
  identifier?: CompositeV2IdentifierConfig
}

export type CompositeV2PersistedSnapshot = CompositeV2State & {
  selectedPreviewPresetId?: string
}
