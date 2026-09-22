import { describe, expect, it } from 'vitest'
import type { DailyRun } from './types'
import {
  DAILY_RUN_KEEP_DAYS,
  normalizeDailyRun,
  normalizeDailyTarget,
  normalizeStrategyCard,
  pruneDailyRuns,
} from './normalize'

/**
 * 这组用例钉的是**字段白名单**：`normalize*` 是显式列举字段的，
 * 新增字段时忘了同步 → 落库读回来该字段凭空消失，而且**全程不报错**
 * （界面只是少显示一样东西）。TB-105 在 `normalizeAsset` 上踩过一次，这里照着补守卫。
 */
describe('策略卡归一化', () => {
  it('⭐ 全字段往返不丢（新增字段时必须回来补这里）', () => {
    const card = normalizeStrategyCard({
      id: 'c1',
      name: '方向一 · 主推',
      sopId: 'sop-1',
      sopName: '主推配方卡',
      directionCollectionId: 'dir-1',
      imagesPerPrompt: 2,
      weight: 3,
      enabled: false,
      notes: '跑得不错',
      createdAt: 1000,
      updatedAt: 2000,
      sourceBatchId: 'batch-9',
    })
    expect(card).not.toBeNull()
    expect(card).toEqual({
      id: 'c1',
      name: '方向一 · 主推',
      sopId: 'sop-1',
      sopName: '主推配方卡',
      directionCollectionId: 'dir-1',
      imagesPerPrompt: 2,
      weight: 3,
      enabled: false,
      notes: '跑得不错',
      createdAt: 1000,
      updatedAt: 2000,
      sourceBatchId: 'batch-9',
    })
  })

  it('缺 id / sopId / 方向 的记录被丢弃，不留半截对象', () => {
    expect(normalizeStrategyCard({ sopId: 's', directionCollectionId: 'd' })).toBeNull()
    expect(normalizeStrategyCard({ id: 'c', directionCollectionId: 'd' })).toBeNull()
    expect(normalizeStrategyCard({ id: 'c', sopId: 's' })).toBeNull()
    expect(normalizeStrategyCard(null)).toBeNull()
    expect(normalizeStrategyCard('x')).toBeNull()
  })

  it('出图数与权重有下限，不许出现 0 张或负权重', () => {
    const card = normalizeStrategyCard({
      id: 'c1',
      sopId: 'sop-1',
      directionCollectionId: 'dir-1',
      imagesPerPrompt: 0,
      weight: -5,
    })
    expect(card?.imagesPerPrompt).toBe(1)
    expect(card?.weight).toBe(1)
  })

  it('没名字时用 SOP 名兜底，不会显示成一片「未命名」', () => {
    expect(normalizeStrategyCard({ id: 'c', sopId: 's', directionCollectionId: 'd', sopName: '配方甲' })?.name).toBe(
      '配方甲',
    )
  })
})

describe('每日配置归一化', () => {
  it('⭐ 全字段往返不丢', () => {
    const target = normalizeDailyTarget({
      id: 't1',
      productCollectionId: 'p1',
      dailyTotal: 1000,
      directionRatios: [
        { directionCollectionId: 'd1', ratio: 60 },
        { directionCollectionId: 'd2', ratio: 40 },
      ],
      enabled: true,
      createdAt: 10,
      updatedAt: 20,
    })
    expect(target).toEqual({
      id: 't1',
      productCollectionId: 'p1',
      dailyTotal: 1000,
      directionRatios: [
        { directionCollectionId: 'd1', ratio: 60 },
        { directionCollectionId: 'd2', ratio: 40 },
      ],
      enabled: true,
      createdAt: 10,
      updatedAt: 20,
    })
  })

  it('每日总数为负时归零（等于关掉，不是出负张）', () => {
    expect(normalizeDailyTarget({ id: 't', productCollectionId: 'p', dailyTotal: -100 })?.dailyTotal).toBe(0)
  })

  it('比例里的残缺项被剔除，不污染分配', () => {
    const target = normalizeDailyTarget({
      id: 't',
      productCollectionId: 'p',
      directionRatios: [{ directionCollectionId: 'd1', ratio: 30 }, { ratio: 20 }, null],
    })
    expect(target?.directionRatios).toEqual([{ directionCollectionId: 'd1', ratio: 30 }])
  })
})

describe('跑批记录归一化', () => {
  it('⭐ 计划、跳过原因、任务号都不丢', () => {
    const run = normalizeDailyRun({
      id: '2026-09-23::p1',
      date: '2026-09-23',
      productCollectionId: 'p1',
      batchId: 'daily-20260923-p1',
      status: 'partial',
      plannedCount: 1000,
      plans: [
        {
          directionCollectionId: 'd1',
          directionName: '方向一',
          plannedCount: 400,
          cards: [{ cardId: 'c1', cardName: '卡1', count: 400 }],
        },
      ],
      submittedTaskIds: ['task-1', 'task-2'],
      skipped: [{ reason: 'no-cards', directionCollectionId: 'd2', detail: '方向二没有卡' }],
      startedAt: 1,
      finishedAt: 2,
      error: '部分失败',
    })
    expect(run?.plans).toHaveLength(1)
    expect(run?.plans[0].cards).toEqual([{ cardId: 'c1', cardName: '卡1', count: 400 }])
    expect(run?.submittedTaskIds).toEqual(['task-1', 'task-2'])
    expect(run?.skipped[0]).toEqual({ reason: 'no-cards', directionCollectionId: 'd2', detail: '方向二没有卡' })
    expect(run?.error).toBe('部分失败')
  })

  it('缺 date 或 id 的记录被丢弃', () => {
    expect(normalizeDailyRun({ date: '2026-09-23' })).toBeNull()
    expect(normalizeDailyRun({ id: 'x' })).toBeNull()
  })

  it('只保留最近若干天的记录（跑批记录只服务当天去重与最近预览）', () => {
    const total = DAILY_RUN_KEEP_DAYS + 10
    const runs = Array.from({ length: total }, (_, index) => ({
      id: `r${index}`,
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      productCollectionId: 'p',
    }))
      .map((item) => normalizeDailyRun(item))
      .filter((item): item is DailyRun => item !== null)
    const pruned = pruneDailyRuns(runs)
    expect(pruned).toHaveLength(DAILY_RUN_KEEP_DAYS)
    // 按日期从新到旧排好
    expect(pruned.map((item) => item.date)).toEqual(
      [...pruned]
        .map((item) => item.date)
        .sort()
        .reverse(),
    )
    // 最早的 10 天被丢掉
    expect(pruned.some((item) => item.date === '2026-01-01')).toBe(false)
    expect(pruned.some((item) => item.date === `2026-01-${String(total).padStart(2, '0')}`)).toBe(true)
  })
})
