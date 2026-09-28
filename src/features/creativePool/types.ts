/**
 * 创作池（Creative Pool）。
 *
 * 一个池 = 一类可复用的参考图集合。当前只落地「风格池」，但容器按多类设计：
 * 新增「构图池 / 样式池」只需加一个 kind 与对应措辞（见 `poolPrompt.ts`），
 * 存储、网格、勾选、随机、发图链路全部共用。
 */

/** 池类型。只影响「AI 分析时问什么」与「生图约束怎么说」。 */
export type CreativePoolKind = 'style' | 'composition' | 'pattern'

/** 池的展示顺序（面板 tab 按它来）。 */
export const CREATIVE_POOL_KINDS: readonly CreativePoolKind[] = ['style', 'composition', 'pattern']

/** 池内一项：一张参考图 + AI 起的名字 + 分析要点。 */
export interface CreativePoolItem {
  id: string
  /** 名字，最多 8 个字（AI 起名后允许手动改） */
  name: string
  /**
   * 图在池资产命名空间（`creativePoolAssets`）里的记录 id。
   *
   * 刻意**不复用**素材库的 assetId 或图片存储的 imageId：素材是「删除即永久删除」，
   * 图片记录又会被启动时的孤儿回收（`store.ts` 里超过 7 天没被任何任务 / 标签页引用就删）。
   * 池子必须自持一份副本，否则用户哪天删了素材，池子里的图就变成空白格子。
   */
  assetRef: string
  /**
   * AI 分析出的要点（风格维度）。**当前不参与生图**，只用于展示与人工校对。
   *
   * 理由：发「对画面的内容描述」会与图冲突、把模型带偏（详见 `poolPrompt.ts` 顶部注释）。
   * 将来若要启用，只需改 `buildPoolReferenceRule` 一处。
   */
  points: string[]
  createdAt: number
  updatedAt: number
}

/**
 * 这次生图要用池里的哪些图。
 *
 * - `manual` —— 用勾选的（**勾 1 张就是单选、勾多张就是多选**，不需要单独的「单选模式」）。
 * - `random` —— 每次生成时从整个池里重抽 `randomCount` 张。
 *
 * ⚠️ 它**持久化在池子里**（不再只活在 InputBar 的 useState）：
 * 只放组件 state 时，任何一次热更新 / 重挂都会把它清空，用户勾了也「看起来没勾」——
 * 而且提交时只是静默走普通生图，不报错、不留痕，极难排查。
 */
export interface CreativePoolSelection {
  mode: 'manual' | 'random'
  selectedIds: string[]
  randomCount: number
}

export interface CreativePool {
  kind: CreativePoolKind
  /** 池内全部项。**容量不设上限** —— 可以一直往里丢图。 */
  items: CreativePoolItem[]
  /**
   * 随机抽签的张数上限；`null` / 缺省 = **不限**（上限即池子大小）。
   *
   * 注意限的是「一次随机抽几张」，不是池子能存多少张 —— 每张池图都会进请求负载，
   * 抽太多会又慢又贵，所以给随机模式留一个可选的安全阀；手动勾选不受它约束
   * （那是用户自己一张张点出来的，有明确意图）。
   */
  maxRandomCount: number | null
  /** 这次生图用哪些图（持久化在这里，不是组件 state —— 原因见 `CreativePoolSelection`）。 */
  selection: CreativePoolSelection
}

/** 池图资产：一条记录一张图，dataUrl 内嵌（照水印资产 `compositeAssets` 的存法）。 */
export interface CreativePoolAsset {
  id: string
  dataUrl: string
}

/** 名字上限（AI 起名与手动改名共用同一口径）。 */
export const POOL_NAME_MAX_LENGTH = 8

/** 按上限截断名字（超长直接截，不做省略号 —— 8 个字本身就该是硬约束）。 */
export function clampPoolName(name: string): string {
  return Array.from(name.trim()).slice(0, POOL_NAME_MAX_LENGTH).join('')
}
