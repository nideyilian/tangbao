import type { AssetCollection } from '../../types'
import { isCampaignRecipeSop } from '../strategy/adapters/storeSopGeneration'
import {
  generateCampaignRecipePromptsFromStore,
  generatePromptsFromSopStore,
  generateVariablePromptsFromSopStore,
} from '../strategy/adapters/storeSopGeneration'
import { normalizeSopPromptCandidates } from '../strategy/sopPromptBatch'
import type { SopLibraryItem } from '../strategy/types'
import { buildDailyPlan, selectEligibleCards } from './planner'
import type { DailyRun, DailySkip, DailyTarget, StrategyCard } from './types'

/** 提交一条生图任务所需的信息（由调用方接到 `submitTaskWithData`）。 */
export interface DailyTaskInput {
  prompt: string
  sopId: string
  sopName: string
  /** 当天这一批的批次号：出图任务带着它，预览页靠它把这一天的图聚起来 */
  batchId: string
  promptIndex: number
  promptCount: number
  imagesPerPrompt: number
  /** 图片自动归档到这个方向 */
  directionCollectionId: string
}

export interface DailyBatchDeps {
  /** 项目树（判定方向还在不在） */
  collections: AssetCollection[]
  /** SOP 库（判定卡引用的 SOP 还在不在） */
  sops: SopLibraryItem[]
  /** 生成提示词。做成注入是为了单测能脱离 API 与 zustand */
  generatePrompts?: (sop: SopLibraryItem, count: number, existingPrompts: string[]) => Promise<string[]>
  /** 提交生图任务，返回任务 id；失败返回 null */
  submitTask: (input: DailyTaskInput) => Promise<string | null>
  now?: () => number
}

/** 一天一批的批次号。预览页与素材库的批次分组都认它。 */
export function dailyBatchId(dateKey: string, productCollectionId: string): string {
  return `daily-${dateKey}-${productCollectionId}`
}

/**
 * 按卡的类型选对应的提示词引擎 —— 与「SOP 批量出图」弹窗里的三分支保持一致
 * （`GallerySopBatchModal.tsx:2505`）：配方卡走本地采样、变量提示词走本地展开、其余走 AI 写词。
 */
export async function generateCardPrompts(
  sop: SopLibraryItem,
  count: number,
  existingPrompts: string[] = [],
): Promise<string[]> {
  const generated = isCampaignRecipeSop(sop)
    ? await generateCampaignRecipePromptsFromStore(sop, count, '', { existingPrompts })
    : sop.executionMode === 'variable-prompt'
      ? await generateVariablePromptsFromSopStore(sop, count, '', { existingPrompts })
      : await generatePromptsFromSopStore(sop, count, '', { existingPrompts })
  return normalizeSopPromptCandidates(generated, count, existingPrompts)
}

export interface RunDailyBatchResult {
  run: DailyRun
  /** 计划出但没排下去的张数（界面要如实显示，不许让人以为跑满了） */
  unplanned: number
}

/**
 * 跑一个产品一天的量。
 *
 * 三条刻意的取舍：
 * 1. **串行提交**：1000 张会慢，但不会把 API 打挂；并发闸门留给二期（那时候才需要）。
 * 2. **单张卡失败不中断整批**：失败记进 `error`，状态标 `partial`，已经出的图照常进预览。
 *    宁可「跑出 700 张 + 一条失败原因」，也不要「整批回滚、一张都没有」。
 * 3. **提示词去重按卡喂历史**：把本批已经出的词喂回去，避免同一张卡在一天内出重复的组合。
 */
export async function runDailyBatch(
  target: DailyTarget,
  cards: StrategyCard[],
  dateKey: string,
  deps: DailyBatchDeps,
): Promise<RunDailyBatchResult> {
  const now = deps.now ?? Date.now
  const batchId = dailyBatchId(dateKey, target.productCollectionId)
  const nameById = new Map(deps.collections.map((item) => [item.id, item.name]))
  const skipped: DailySkip[] = []

  const directions = target.directionRatios.map((ratio) => {
    const directionName = nameById.get(ratio.directionCollectionId) ?? ratio.directionCollectionId
    const eligible = selectEligibleCards(cards, deps.sops, deps.collections, ratio.directionCollectionId, directionName)
    skipped.push(...eligible.skipped)
    return {
      directionCollectionId: ratio.directionCollectionId,
      directionName,
      ratio: ratio.ratio,
      cards: eligible.cards,
    }
  })

  const plan = buildDailyPlan({ dateKey, dailyTotal: target.dailyTotal, directions })
  skipped.push(...plan.skipped)

  const submittedTaskIds: string[] = []
  const errors: string[] = []
  const generate = deps.generatePrompts ?? generateCardPrompts

  for (const direction of plan.directions) {
    const usedPrompts: string[] = []
    for (const allocation of direction.cards) {
      if (allocation.count <= 0) continue
      const card = cards.find((item) => item.id === allocation.cardId)
      const sop = card ? deps.sops.find((item) => item.id === card.sopId) : undefined
      if (!card || !sop) continue
      try {
        const prompts = await generate(sop, allocation.count, usedPrompts)
        if (prompts.length === 0) {
          skipped.push({
            reason: 'prompt-empty',
            directionCollectionId: direction.directionCollectionId,
            cardId: card.id,
            detail: `「${card.name}」今天该出 ${allocation.count} 张，但一条提示词都没生成出来`,
          })
          continue
        }
        usedPrompts.push(...prompts)
        for (const [index, prompt] of prompts.entries()) {
          const taskId = await deps.submitTask({
            prompt,
            sopId: card.sopId,
            sopName: card.sopName,
            batchId,
            promptIndex: index,
            promptCount: prompts.length,
            imagesPerPrompt: card.imagesPerPrompt,
            directionCollectionId: direction.directionCollectionId,
          })
          if (taskId) submittedTaskIds.push(taskId)
        }
      } catch (error) {
        // 单张卡挂掉不牵连整批：记原因，继续跑下一张
        errors.push(`「${card.name}」：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const failed = errors.length > 0
  const status: DailyRun['status'] = failed ? (submittedTaskIds.length > 0 ? 'partial' : 'failed') : 'done'
  const run: DailyRun = {
    id: `${dateKey}::${target.productCollectionId}`,
    date: dateKey,
    productCollectionId: target.productCollectionId,
    batchId,
    status,
    plans: plan.directions,
    submittedTaskIds,
    skipped,
    startedAt: now(),
    finishedAt: now(),
    error: errors.length > 0 ? errors.join('；') : undefined,
  }

  return { run, unplanned: Math.max(0, target.dailyTotal - plan.totalPlanned) }
}
