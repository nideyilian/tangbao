/**
 * 每日素材批量生成（TB-108）的领域模型。
 *
 * 三条结构约定（改之前先看 `docs/architecture-constraints.md` 第四章）：
 *
 * 1. **不新建第二棵树**：方向 / 产品一律引用项目树的 `AssetCollection.id`。
 *    卡上只存 `directionCollectionId`，产品与产品线由 `resolveOwningProductId`
 *    沿树向上推导 —— 这样节点改名、移动之后归属自动跟着走。
 *
 * 2. **策略卡只引用 SOP，不复制 SOP**：SOP 库（`useRequirementPrototype.sopLibrary`）
 *    仍是唯一真相源。卡上冗余存 `sopName`，只为 SOP 被删之后还能显示这张卡叫什么，
 *    抽取时按「失效」跳过并**报出来**（不像别处那样静默少抽）。
 *
 * 3. **比例是「图片张数」的比例，不是卡数量的比例**：卡是配方，出多少张才是目标。
 */

/** 策略卡：引用一张 SOP / 配方卡，固定挂在某个方向下。一个方向可以有多张。 */
export interface StrategyCard {
  id: string
  name: string
  /** 引用的 SOP / 配方卡 id */
  sopId: string
  /** 冗余保存 SOP 名称（SOP 被删后仍可显示） */
  sopName: string
  /** 归属方向：项目树第 3 级 `AssetCollection.id` */
  directionCollectionId: string
  /** 一条提示词出几张图；最小 1 */
  imagesPerPrompt: number
  /** 同一方向内的抽取权重；越大分到的越多。必须 > 0 */
  weight: number
  /** 关闭的卡不参与每日抽取 */
  enabled: boolean
  notes?: string
  createdAt: number
  updatedAt: number
  /** 从哪次出图转来的；缺省 = 手工新建 */
  sourceBatchId?: string
}

/** 单个方向的抽取比例。 */
export interface DailyDirectionRatio {
  directionCollectionId: string
  /** 百分比数字（如 40 表示 40%）；不要求合计为 100，按权重归一 */
  ratio: number
}

/** 每日生成配置：以**产品**为单位（多产品各配一套，互不影响）。 */
export interface DailyTarget {
  id: string
  /** 产品节点 id（项目树第 2 级） */
  productCollectionId: string
  /** 这个产品每天要出多少张 */
  dailyTotal: number
  directionRatios: DailyDirectionRatio[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** 一天里某个方向的出图计划。 */
export interface DailyDirectionPlan {
  directionCollectionId: string
  directionName: string
  /** 今天这个方向要出几张 */
  plannedCount: number
  /** 张数摊到该方向挂着的卡上 */
  cards: Array<{ cardId: string; cardName: string; count: number }>
}

/** 跳过的原因。每次跳过都要留一条，界面照着报 —— 「静默少抽」比报错更糟。 */
export type DailySkipReason =
  /** 该方向下没有启用的策略卡 */
  | 'no-cards'
  /** 卡引用的 SOP 已被删除 */
  | 'card-sop-missing'
  /** 卡挂的方向节点已不存在（节点被删或改了层级） */
  | 'direction-missing'
  /** 卡没能产出任何提示词 */
  | 'prompt-empty'

export interface DailySkip {
  reason: DailySkipReason
  directionCollectionId?: string
  cardId?: string
  detail: string
}

/** 一天的跑批记录：既用于「当天只跑一次」的去重，也用于预览页聚合当天产出。 */
export interface DailyRun {
  /** `${date}::${productCollectionId}`，天然唯一 */
  id: string
  /** YYYY-MM-DD */
  date: string
  productCollectionId: string
  /** 当天这一批的批次号：出图任务带着它，预览页靠它把这一天的图聚起来 */
  batchId: string
  status: 'running' | 'done' | 'partial' | 'failed'
  plans: DailyDirectionPlan[]
  submittedTaskIds: string[]
  skipped: DailySkip[]
  startedAt: number
  finishedAt: number | null
  error?: string
}

/** 一天跑完之后各方向的产出概览（预览页用）。 */
export interface DailyRunSummary {
  run: DailyRun
  /** 方向 → 已出图数 / 计划数 */
  directions: Array<{
    directionCollectionId: string
    directionName: string
    plannedCount: number
    producedCount: number
  }>
}
