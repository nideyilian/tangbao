import { allocateInteger } from '../../lib/agentBatchPlanner'
import type { AssetCollection } from '../../types'
import type { SopLibraryItem } from '../strategy/types'
import type { DailyDirectionPlan, DailySkip, StrategyCard } from './types'

/** 按 id 建索引，避免在循环里反复 `find`（方向多、卡多时是实打实的开销）。 */
function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

export interface EligibleCardsResult {
  cards: CardInput[]
  skipped: DailySkip[]
}

/**
 * 挑出「今天真的能出图」的卡。
 *
 * 三种情况一律进 `skipped` 并写明原因：**卡引用的 SOP 被删了、卡挂的方向节点没了、卡被关掉了**。
 * 关掉的卡不算跳过（那是用户自己的选择，界面上另有开关显示），只有「用户以为该出图却出不了」的才报。
 */
export function selectEligibleCards(
  cards: StrategyCard[],
  sops: SopLibraryItem[],
  collections: AssetCollection[],
  directionCollectionId: string,
  directionName: string,
): EligibleCardsResult {
  const sopById = indexById(sops)
  const collectionIds = new Set(collections.map((item) => item.id))
  const eligible: CardInput[] = []
  const skipped: DailySkip[] = []

  for (const card of cards) {
    if (card.directionCollectionId !== directionCollectionId) continue
    if (!card.enabled) continue
    if (!collectionIds.has(directionCollectionId)) {
      skipped.push({
        reason: 'direction-missing',
        directionCollectionId,
        cardId: card.id,
        detail: `「${card.name}」挂的方向「${directionName}」已经不存在了（节点被删或层级变了）`,
      })
      continue
    }
    const sop = sopById.get(card.sopId)
    if (!sop) {
      skipped.push({
        reason: 'card-sop-missing',
        directionCollectionId,
        cardId: card.id,
        detail: `「${card.name}」引用的 SOP「${card.sopName || card.sopId}」已被删除`,
      })
      continue
    }
    eligible.push({ id: card.id, name: card.name, weight: card.weight })
  }

  return { cards: eligible, skipped }
}

export interface RatioInput {
  id: string
  ratio: number
}

export interface CardInput {
  id: string
  name: string
  weight: number
}

/**
 * 按「日期 + 卡 id」生成 `[0,1)` 的稳定随机数。
 *
 * 稳定的意思是**同一天同一张卡结果恒定**：当天手动补跑时份额与第一次一致，不会越补越乱；
 * 换一天就变，于是每天的份额有浮动 —— 这就是「随机抽取」的那点随机。
 * （不引入 Math.random：那样重跑会翻盘，出了问题没法复现。）
 */
export function dailyJitter(cardId: string, dateKey: string): number {
  let hash = 2166136261
  const source = `${dateKey}:${cardId}`
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

/** 权重的抖动区间：0.7 ~ 1.3 倍。太大会让用户配的比例失去意义，太小则看不出浮动。 */
const JITTER_MIN = 0.7
const JITTER_SPAN = 0.6

/**
 * 把每日总数按各方向的比例分下去。
 *
 * 两条性质（都来自 `allocateInteger`）：
 * - 合计**恒等于**传入的总数，不会因取整少一张（「确保总数达到设定值」就靠这条）；
 * - 比例全为 0 或没配时，退化为**各方向均分** —— 仍然凑满总数，而不是哪都不出图。
 */
export function allocateByRatios(total: number, inputs: RatioInput[]): number[] {
  return allocateInteger(
    total,
    inputs.map((item) => (Number.isFinite(item.ratio) && item.ratio > 0 ? item.ratio : 0)),
  )
}

/**
 * 把一个方向的张数摊到它挂着的卡上。
 *
 * 每张卡都按自己的权重拿一份（权重 > 0 就有份，不会轮空），份额再按当天抖动浮动。
 */
export function allocateToCards(count: number, cards: CardInput[], dateKey: string): number[] {
  return allocateInteger(
    count,
    cards.map((card) => {
      const base = Number.isFinite(card.weight) && card.weight > 0 ? card.weight : 1
      return base * (JITTER_MIN + JITTER_SPAN * dailyJitter(card.id, dateKey))
    }),
  )
}

export interface DailyPlanInput {
  /** YYYY-MM-DD，只用于抖动种子 */
  dateKey: string
  dailyTotal: number
  directions: Array<{
    directionCollectionId: string
    directionName: string
    ratio: number
    /** 该方向下启用且 SOP 仍在的策略卡 */
    cards: CardInput[]
  }>
}

export interface DailyPlanResult {
  directions: DailyDirectionPlan[]
  skipped: DailySkip[]
  /** 实际排下去的张数（有方向被跳过时会小于 dailyTotal，界面必须如实显示） */
  totalPlanned: number
}

/**
 * 算出一天的完整出图计划：总数 → 各方向 → 方向内的每张卡。
 *
 * 排不下去的方向一律进 `skipped` 并写清原因 —— 这是刻意的：
 * 「配了 1000 张只出了 700 张」如果不报，用户只会以为系统在偷懒。
 */
export function buildDailyPlan(input: DailyPlanInput): DailyPlanResult {
  const counts = allocateByRatios(
    input.dailyTotal,
    input.directions.map((direction) => ({ id: direction.directionCollectionId, ratio: direction.ratio })),
  )
  const directions: DailyDirectionPlan[] = []
  const skipped: DailySkip[] = []

  input.directions.forEach((direction, index) => {
    const plannedCount = counts[index] ?? 0
    if (direction.cards.length === 0) {
      if (plannedCount > 0) {
        skipped.push({
          reason: 'no-cards',
          directionCollectionId: direction.directionCollectionId,
          detail: `「${direction.directionName}」今天计划 ${plannedCount} 张，但这个方向下没有可用的策略卡`,
        })
      }
      return
    }
    const cardCounts = allocateToCards(plannedCount, direction.cards, input.dateKey)
    directions.push({
      directionCollectionId: direction.directionCollectionId,
      directionName: direction.directionName,
      plannedCount,
      cards: direction.cards.map((card, cardIndex) => ({
        cardId: card.id,
        cardName: card.name,
        count: cardCounts[cardIndex] ?? 0,
      })),
    })
  })

  return {
    directions,
    skipped,
    totalPlanned: directions.reduce((sum, direction) => sum + direction.plannedCount, 0),
  }
}

/** 比例合计（界面上显示「合计 100%」用）。 */
export function sumRatios(ratios: number[]): number {
  return ratios.reduce((sum, ratio) => (Number.isFinite(ratio) && ratio > 0 ? sum + ratio : sum), 0)
}
