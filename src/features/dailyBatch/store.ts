/**
 * 每日素材批量生成的 store（TB-108）。
 *
 * 落到独立 namespace `dailyBatch`（主进程白名单见 `electron/asset-kernel.ts`）。
 * 为什么不塞进 SOP 库那个 store：SOP 库属于「提示词资产」，本模块是「排产」，
 * 两者生命周期不同；本模块对 SOP 只做**单向引用**（读 `useRequirementPrototype.sopLibrary`），
 * 不写回，避免两个模块互相改同一份数据。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from '../../lib/desktopJsonStorage'
import { normalizeDailyRun, normalizeDailyTarget, normalizeStrategyCard, pruneDailyRuns } from './normalize'
import type { DailyRun, DailyTarget, StrategyCard } from './types'

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 从一次出图结果转成策略卡时要带的信息。 */
export interface CreateCardFromGenerationInput {
  /** 这次用的是哪张 SOP / 配方卡 */
  sopId: string
  sopName: string
  /** 归属方向（项目树第 3 级） */
  directionCollectionId: string
  /** 一条提示词出几张 */
  imagesPerPrompt?: number
  /** 来源批次，便于回溯这张卡是从哪次出图来的 */
  sourceBatchId?: string
  name?: string
}

export interface DailyBatchStore {
  cards: StrategyCard[]
  /** 以产品为单位的每日配置；多产品各一条 */
  targets: DailyTarget[]
  runs: DailyRun[]

  /** 新建或更新一张策略卡（按 id 覆盖） */
  saveCard: (card: StrategyCard) => void
  removeCard: (cardId: string) => void
  setCardEnabled: (cardId: string, enabled: boolean) => void
  /** 出图之后「存为策略卡」的入口 */
  createCardFromGeneration: (input: CreateCardFromGenerationInput) => StrategyCard | null

  /** 新建或更新一个产品的每日配置 */
  saveTarget: (target: DailyTarget) => void
  removeTarget: (targetId: string) => void
  setTargetEnabled: (targetId: string, enabled: boolean) => void

  upsertRun: (run: DailyRun) => void
  /** 查某产品某天是否已经跑过（当天只跑一次就靠它） */
  findRun: (date: string, productCollectionId: string) => DailyRun | undefined
  clearRuns: () => void
}

export const useDailyBatchStore = create<DailyBatchStore>()(
  persist(
    (set, get) => ({
      cards: [],
      targets: [],
      runs: [],

      saveCard: (card) =>
        set((state) => {
          const normalized = normalizeStrategyCard(card)
          if (!normalized) return state
          const index = state.cards.findIndex((item) => item.id === normalized.id)
          if (index < 0) return { cards: [...state.cards, normalized] }
          const cards = [...state.cards]
          cards[index] = normalized
          return { cards }
        }),

      removeCard: (cardId) => set((state) => ({ cards: state.cards.filter((item) => item.id !== cardId) })),

      setCardEnabled: (cardId, enabled) =>
        set((state) => ({
          cards: state.cards.map((item) => (item.id === cardId ? { ...item, enabled, updatedAt: Date.now() } : item)),
        })),

      createCardFromGeneration: (input) => {
        const now = Date.now()
        const normalized = normalizeStrategyCard({
          id: newId('scard'),
          name: input.name?.trim() || input.sopName,
          sopId: input.sopId,
          sopName: input.sopName,
          directionCollectionId: input.directionCollectionId,
          imagesPerPrompt: input.imagesPerPrompt ?? 1,
          weight: 1,
          enabled: true,
          sourceBatchId: input.sourceBatchId,
          createdAt: now,
          updatedAt: now,
        })
        if (!normalized) return null
        get().saveCard(normalized)
        return normalized
      },

      saveTarget: (target) =>
        set((state) => {
          const normalized = normalizeDailyTarget(target)
          if (!normalized) return state
          const index = state.targets.findIndex((item) => item.id === normalized.id)
          if (index < 0) return { targets: [...state.targets, normalized] }
          const targets = [...state.targets]
          targets[index] = normalized
          return { targets }
        }),

      removeTarget: (targetId) => set((state) => ({ targets: state.targets.filter((item) => item.id !== targetId) })),

      setTargetEnabled: (targetId, enabled) =>
        set((state) => ({
          targets: state.targets.map((item) =>
            item.id === targetId ? { ...item, enabled, updatedAt: Date.now() } : item,
          ),
        })),

      upsertRun: (run) =>
        set((state) => {
          const normalized = normalizeDailyRun(run)
          if (!normalized) return state
          const rest = state.runs.filter((item) => item.id !== normalized.id)
          return { runs: pruneDailyRuns([...rest, normalized]) }
        }),

      findRun: (date, productCollectionId) =>
        get().runs.find((item) => item.date === date && item.productCollectionId === productCollectionId),

      clearRuns: () => set({ runs: [] }),
    }),
    {
      name: 'tangbao-daily-batch',
      version: 1,
      storage: createDesktopJsonStorage('dailyBatch'),
      partialize: (state) => ({ cards: state.cards, targets: state.targets, runs: state.runs }),
      migrate: (persisted) => {
        const input = (persisted ?? {}) as Record<string, unknown>
        return {
          cards: Array.isArray(input.cards)
            ? input.cards
                .map((item) => normalizeStrategyCard(item))
                .filter((item): item is StrategyCard => item !== null)
            : [],
          targets: Array.isArray(input.targets)
            ? input.targets
                .map((item) => normalizeDailyTarget(item))
                .filter((item): item is DailyTarget => item !== null)
            : [],
          runs: Array.isArray(input.runs)
            ? pruneDailyRuns(
                input.runs.map((item) => normalizeDailyRun(item)).filter((item): item is DailyRun => item !== null),
              )
            : [],
        }
      },
    },
  ),
)
