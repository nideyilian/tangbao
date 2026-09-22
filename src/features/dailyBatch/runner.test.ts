import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../../types'
import type { SopLibraryItem } from '../strategy/types'
import { dailyBatchId, runDailyBatch, type DailyTaskInput } from './runner'
import type { DailyTarget, StrategyCard } from './types'

function makeCollection(id: string, name: string, parentId: string | null = null): AssetCollection {
  return { id, name, normalizedName: name, parentId, order: 0, createdAt: 0, updatedAt: 0 }
}

function makeSop(id: string, name: string): SopLibraryItem {
  return {
    id,
    name,
    description: '',
    content: name,
    source: 'manual',
    createdBy: 'test',
    createdAt: 0,
    updatedAt: 0,
    executionMode: 'campaign-recipe',
  }
}

function makeCard(overrides: Partial<StrategyCard> = {}): StrategyCard {
  return {
    id: 'card-1',
    name: '卡1',
    sopId: 'sop-1',
    sopName: '配方甲',
    directionCollectionId: 'dir-1',
    imagesPerPrompt: 1,
    weight: 1,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeTarget(overrides: Partial<DailyTarget> = {}): DailyTarget {
  return {
    id: 'target-1',
    productCollectionId: 'prod-1',
    dailyTotal: 10,
    directionRatios: [{ directionCollectionId: 'dir-1', ratio: 100 }],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function collectSubmissions(): {
  tasks: DailyTaskInput[]
  submitTask: (input: DailyTaskInput) => Promise<string | null>
} {
  const tasks: DailyTaskInput[] = []
  return {
    tasks,
    submitTask: async (input: DailyTaskInput) => {
      tasks.push(input)
      return `task-${tasks.length}`
    },
  }
}

describe('跑批编排', () => {
  it('按计划的张数提交任务，并带上批次号与归档方向', async () => {
    const { tasks, submitTask } = collectSubmissions()
    const result = await runDailyBatch(makeTarget(), [makeCard()], '2026-09-23', {
      collections: [makeCollection('prod-1', '产品甲'), makeCollection('dir-1', '方向一', 'prod-1')],
      sops: [makeSop('sop-1', '配方甲')],
      generatePrompts: async (_sop, count) => Array.from({ length: count }, (_, index) => `提示词${index}`),
      submitTask,
    })
    expect(tasks).toHaveLength(10)
    expect(tasks[0].batchId).toBe('daily-2026-09-23-prod-1')
    expect(tasks[0].directionCollectionId).toBe('dir-1')
    expect(result.run.status).toBe('done')
    expect(result.run.submittedTaskIds).toHaveLength(10)
    expect(result.unplanned).toBe(0)
  })

  it('⭐ 卡引用的 SOP 被删：记进 skipped 并写清是哪张卡，不静默少抽', async () => {
    const { submitTask } = collectSubmissions()
    const result = await runDailyBatch(makeTarget(), [makeCard({ sopId: '已被删的sop' })], '2026-09-23', {
      collections: [makeCollection('prod-1', '产品甲'), makeCollection('dir-1', '方向一', 'prod-1')],
      sops: [makeSop('sop-1', '配方甲')],
      generatePrompts: async () => ['x'],
      submitTask,
    })
    expect(result.run.submittedTaskIds).toHaveLength(0)
    expect(result.run.skipped[0].reason).toBe('card-sop-missing')
    expect(result.run.skipped[0].detail).toContain('卡1')
  })

  it('⭐ 方向节点没了：报出来而不是当这个方向不存在', async () => {
    const { submitTask } = collectSubmissions()
    const result = await runDailyBatch(makeTarget(), [makeCard()], '2026-09-23', {
      collections: [makeCollection('prod-1', '产品甲')],
      sops: [makeSop('sop-1', '配方甲')],
      generatePrompts: async () => ['x'],
      submitTask,
    })
    expect(result.run.skipped[0].reason).toBe('direction-missing')
    // 节点没了就查不到名字了，只能退到 id —— 至少让用户知道是哪一张卡出的问题
    expect(result.run.skipped[0].detail).toContain('dir-1')
    expect(result.run.skipped[0].cardId).toBe('card-1')
  })

  it('⭐ 单张卡失败不牵连整批：其余照出，状态标 partial 并留下原因', async () => {
    const { tasks, submitTask } = collectSubmissions()
    let callCount = 0
    const result = await runDailyBatch(
      makeTarget({
        dailyTotal: 20,
        directionRatios: [
          { directionCollectionId: 'dir-1', ratio: 50 },
          { directionCollectionId: 'dir-2', ratio: 50 },
        ],
      }),
      [makeCard(), makeCard({ id: 'card-2', name: '卡2', directionCollectionId: 'dir-2' })],
      '2026-09-23',
      {
        collections: [
          makeCollection('prod-1', '产品甲'),
          makeCollection('dir-1', '方向一', 'prod-1'),
          makeCollection('dir-2', '方向二', 'prod-1'),
        ],
        sops: [makeSop('sop-1', '配方甲')],
        generatePrompts: async (sop, count) => {
          // 只在第一次（第一张卡）炸，第二张必须照常出图 —— 断言的就是「不牵连」
          callCount += 1
          if (callCount === 1) throw new Error(`引擎炸了（${sop.id}）`)
          return Array.from({ length: count }, (_, index) => `提示词${index}`)
        },
        submitTask,
      },
    )
    expect(result.run.status).toBe('partial')
    expect(result.run.error).toContain('引擎炸了')
    expect(tasks.length).toBeGreaterThan(0)
  })

  it('一条提示词都没生成出来时报 prompt-empty，不算成功', async () => {
    const { submitTask } = collectSubmissions()
    const result = await runDailyBatch(makeTarget(), [makeCard()], '2026-09-23', {
      collections: [makeCollection('prod-1', '产品甲'), makeCollection('dir-1', '方向一', 'prod-1')],
      sops: [makeSop('sop-1', '配方甲')],
      generatePrompts: async () => [],
      submitTask,
    })
    expect(result.run.skipped.some((item) => item.reason === 'prompt-empty')).toBe(true)
    expect(result.run.submittedTaskIds).toHaveLength(0)
  })

  it('方向下没有卡时，未排下去的张数如实回给界面', async () => {
    const { submitTask } = collectSubmissions()
    const result = await runDailyBatch(makeTarget({ dailyTotal: 100 }), [], '2026-09-23', {
      collections: [makeCollection('prod-1', '产品甲'), makeCollection('dir-1', '方向一', 'prod-1')],
      sops: [],
      generatePrompts: async () => ['x'],
      submitTask,
    })
    expect(result.unplanned).toBe(100)
    expect(result.run.skipped[0].detail).toContain('100 张')
  })

  it('提示词去重：同一张卡当天出的词会喂回引擎', async () => {
    const seen: string[][] = []
    const { submitTask } = collectSubmissions()
    await runDailyBatch(
      makeTarget({ dailyTotal: 6, directionRatios: [{ directionCollectionId: 'dir-1', ratio: 100 }] }),
      [makeCard(), makeCard({ id: 'card-2', name: '卡2' })],
      '2026-09-23',
      {
        collections: [makeCollection('prod-1', '产品甲'), makeCollection('dir-1', '方向一', 'prod-1')],
        sops: [makeSop('sop-1', '配方甲')],
        generatePrompts: async (_sop, count, existing) => {
          seen.push(existing)
          return Array.from({ length: count }, (_, index) => `第${seen.length}批-${index}`)
        },
        submitTask,
      },
    )
    // 第二张卡拿到的是第一张卡已经出过的词
    expect(seen[1].length).toBeGreaterThan(0)
  })
})

describe('批次号', () => {
  it('一天一个产品一个批次号', () => {
    expect(dailyBatchId('2026-09-23', 'prod-1')).toBe('daily-2026-09-23-prod-1')
  })
})
