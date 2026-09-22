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

export type CompositeV2TextOrientation = 'horizontal' | 'vertical'

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
  /**
   * 文字方向。**缺省 / 任何不是 `'vertical'` 的值都按横排**。
   *
   * 为什么需要它（2026-09-22 杰哥报障）：竖排文案原先只能**一个字敲一个换行**排出来 ——
   * 改一个字就要把后面所有字往后挪，很容易排歪；而且换行在排版上是「换行」，
   * 标识符会与首字并排（那次报障「★ 排到了文案左边」）。
   *
   * 口径与 `withIdentifier` 一样是**正向判定 + 缺省即老行为**：老数据没有这个字段 ⇒ 横排，
   * 升级前后渲染结果不变；导入的脏值（拼错的字符串）也自动当横排，不需要额外归一化。
   *
   * 竖排的语义（与横排逐项对称，见 `resolveVerticalColumns`）：
   * - **换行符 = 换列**，列内逐字向下；
   * - `lineHeight` = **列距**、`letterSpacing` = 列内的字间距；
   * - 「一个字一行」的老写法先折成一段再排，因此两种写法渲染结果一致。
   */
  orientation?: CompositeV2TextOrientation
  /**
   * 这一层要不要带水印标识符（署名）。**缺省 = 带**。
   *
   * 为什么需要它（2026-09-22 杰哥报障）：标识是**逐层**叠加的，于是多文案水印里连
   * 「卖点」这种不该带标识的文案也会被贴上。这个字段让**层自己**回答「我要不要标识」——
   * 比「预设级指定一层」灵活（两层都该带就都勾上），也比按关键词猜「哪段是合规文案」可靠。
   *
   * ⚠️ 用**正向**字段 + 判据 `layer.withIdentifier !== false`（而不是反向的 `identifierDisabled`）：
   * 反向字段在缺省时是 falsy，会让**老数据整批丢掉标识**。只有显式 `false` 才是不带 ——
   * 与 ADR-0004「`undefined` = 没表态、显式值 = 覆盖」同一口径。
   */
  withIdentifier?: boolean
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
  /**
   * 归属产品：项目树第二级（`AssetCollection.id`，`ProjectNodeKind === 'product'`）。
   *
   * **水印库按产品隔离**（2026-09-21）：这个字段决定「这套水印属于哪个产品的库」，
   * 库列表只列当前作用域所属产品的预设，勾选也只能在本产品的库内选 ——
   * 于是两个产品的同名水印不会互相顶替，也不会出现「A 产品的水印被 B 产品勾上」。
   *
   * **缺省或空串 = 未分配**。两种来路：① 老数据第一次升级、又没有任何方向勾过它；
   * ② 用户主动把水印从产品里摘出来。未分配的预设**不进任何产品的库**，
   * 界面上单独成区，可一键指派到当前产品（否则它会永远用不上、也删不掉）。
   *
   * 字段刻意做成**可选**而不是必填：读取侧一律过 `normalizePresetProductId` 兜底
   * （缺省与空串等价），于是「造一个预设」不必处处想着这个字段 —— 归属是**老数据要补**的东西，
   * 不是每个字面量都得手写的负担。
   */
  productId?: string
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
