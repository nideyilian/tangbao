export type StrategyGenerationMode = 'text-to-image' | 'image-to-image'

export type StrategyReferenceSource = 'knowledge-material' | 'local-image' | 'generated-image'

export interface StrategyReferenceConfig {
  source: StrategyReferenceSource
  label: string
  value: string
  imageIds: string[]
}

export interface StrategyKnowledgeConfig {
  resolved: boolean
  insightIds: string[]
}

export type StrategySopMode = 'none' | 'preset' | 'custom'

export interface StrategySopConfig {
  resolved: boolean
  mode: StrategySopMode
  presetId?: string
  name?: string
  description?: string
  content: string
}

export interface StrategyWorkflow {
  reference?: StrategyReferenceConfig
  instruction: string
  knowledge: StrategyKnowledgeConfig
  sop: StrategySopConfig
}

export interface StrategyOutputs {
  channels: {
    enabled: boolean
    channelIds: string[]
  }
  sizes: {
    enabled: boolean
    ratios: Array<'16:9' | '9:16'>
  }
  export: {
    enabled: boolean
    presetId?: string
  }
  allocation: {
    enabled: boolean
    presetId?: string
  }
}

export type StrategyFlowStepKind =
  'mode' | 'reference' | 'instruction' | 'knowledge' | 'sop' | 'channel' | 'size' | 'export' | 'allocation'

export interface StrategyFlowStep {
  id: string
  kind: StrategyFlowStepKind
  label: string
  value: string
  sourceType?: 'knowledge-material' | 'knowledge-term' | 'local-image' | 'generated-image' | 'sop-preset'
  referenceImageIds?: string[]
}

export interface StrategyAsset {
  id: string
  name: string
  productId: string
  materialTypeId: string
  description: string
  coverImageId?: string
  generationMode: StrategyGenerationMode | null
  workflow: StrategyWorkflow
  outputs: StrategyOutputs
  quantity: number
  status: 'draft' | 'review' | 'published'
  version: number
  createdBy: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  resultPromptOverrides?: Record<string, string>
}

export type StrategyPresetType = 'export' | 'allocation'

export interface StrategyPreset {
  id: string
  name: string
  type: StrategyPresetType
  description: string
  value: string
  global: true
  createdBy: string
  createdAt: number
  archived?: boolean
}

export interface SopGroup {
  id: string
  name: string
  /** 父分组 id；null / 缺省表示根级分组。分组树支持逐级展开与收起。 */
  parentId?: string | null
  /**
   * 关联的项目文件夹 id。
   * 项目文件夹树是唯一主源，SOP 分组树是它的投影：带该字段的分组由镜像链路维护，
   * 缺省表示用户自建或历史遗留的独立分组（保留不动，不与项目树绑定）。
   */
  collectionId?: string
  createdAt: number
  updatedAt: number
}

/**
 * SOP 类型：
 * - single           单条提示词：交给 AI 逐条编写
 * - series           系列图：一组内固定块 + 多条成员提示词，交给 AI 生成
 * - campaign-recipe  配方卡引擎：不调 AI，用本地最远点采样从维度池批量组合出提示词
 */
export type SopKind = 'single' | 'series' | 'campaign-recipe'

/**
 * SOP 执行方式（触发本地/远端分支的依据）：
 * - prompt-generator   调 AI 文本模型生成提示词（默认）
 * - variable-prompt    本地展开变量模板组合，组合不足时用 AI 扩词条
 * - campaign-recipe    配方卡引擎：纯本地最远点采样，完全不调 AI
 */
export type SopExecutionMode = 'prompt-generator' | 'variable-prompt' | 'campaign-recipe'

/**
 * 配方卡单个维度：一个维度名 + 一组候选值。
 * 候选值命中合规红线的会在入库/生成前被剔除。
 */
export interface SopCampaignRecipeDimension {
  name: string
  options: string[]
  /**
   * 主控槽权重（可选，由整段文本解析时的 `weight` 字段带入）。
   * 权重更高的维度会被当作主控槽，最远点采样优先保证它与窗口内任意点取值都不同。
   * 采样本身**不按权重加权抽取** —— 权重只影响「差异约束优先施加在哪个槽」。
   */
  weight?: number
}

/**
 * 配方卡引擎配置。
 * body 用 {{维度名}} 占位；引擎用最远点采样在维度组合空间里挑出彼此差异最大的 N 条。
 */
export interface SopCampaignRecipeConfig {
  /** 提示词骨架，含 {{维度名}} 占位符 */
  body: string
  /** 维度池，至少一个维度且每个维度至少一个候选值 */
  dimensions: SopCampaignRecipeDimension[]
}

export interface SopSeriesConfig {
  imageCount: 2 | 3
  fixedDimensions: string[]
  variableDimensions: string[]
  /**
   * 用户为固定维度填的具体值（键为维度名）。
   * 填了的维度由客户端逐字拼进固定块，模型不得改写；留空的维度仍交给模型补全。
   */
  fixedValues?: Record<string, string>
}

export interface SopLibraryItem {
  id: string
  groupId?: string
  coverImageId?: string
  name: string
  description: string
  content: string
  /** 旧 SOP 缺省为 single；series SOP 的每组提示词遵循组内固定规则。 */
  kind?: SopKind
  seriesConfig?: SopSeriesConfig
  /**
   * 配方卡引擎配置。存在该字段即走「配方卡引擎」本地生成分支，不调用 AI。
   * 与 executionMode='campaign-recipe' 二者任一命中即判定为该类型（字段优先）。
   */
  campaignRecipe?: SopCampaignRecipeConfig
  /**
   * 主控槽名（原资产的 dominant 声明，整段解析时带入）。
   * 仅作展示与「按骨架补齐」提示，实际主控槽由 `campaignRecipe.dimensions[].weight` 决定。
   */
  dominantSlots?: string[]
  source: 'manual' | 'generated' | 'legacy-preset'
  metaInstructionId?: string
  /** 变量提示词资产：content 为可被 parseVariablePrompt 解析的模板，可展开批量生图 */
  executionMode?: SopExecutionMode
  /** 变量提示词资产的每个可变项的结构化参数（主题/类型/衍生数量）；旧资产缺省时由正文推导 */
  variableMeta?: SopVariableMeta[]
  createdBy: string
  createdAt: number
  updatedAt: number
  favorite?: boolean
  lastUsedAt?: number
}

export interface SopMetaInstruction {
  id: string
  name: string
  description: string
  instruction: string
  kind: 'general' | 'image-prompt' | 'prompt-reverse' | 'variable-prompt-skill' | 'custom'
  createdAt: number
  updatedAt: number
}

/**
 * 变量提示词资产中单个可变项的结构化参数。
 * 正文模板仍是唯一事实源；本元数据是增强层（主题/类型/数量），
 * 与正文不一致时以 parseVariablePrompt 的解析结果为准。
 */
export interface SopVariableMeta {
  /** 与模板 {{变量名}} 逐字一致的变量名 */
  name: string
  /** 衍生/改写方向的主题描述，如「高端美妆」 */
  theme: string
  /** 选项池类型，如「实物」「文案联动」「场景」 */
  type: string
  /** 目标选项数量（衍生数量）；应用后同步为实际选项数 */
  count: number
}

export interface SopVersion {
  id: string
  name: string
  content: string
  createdAt: number
  createdBy: string
}
