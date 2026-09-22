import { describe, expect, it } from 'vitest'
import { allocateByRatios, allocateToCards, buildDailyPlan, dailyJitter, sumRatios } from './planner'

describe('每日分配：比例 → 各方向张数', () => {
  it('比例合计正好 100 时，张数与比例一致', () => {
    const result = allocateByRatios(1000, [
      { id: 'a', ratio: 50 },
      { id: 'b', ratio: 30 },
      { id: 'c', ratio: 20 },
    ])
    expect(result).toEqual([500, 300, 200])
  })

  it('⭐ 合计恒等于设定的总数（杰哥原话：确保总数达到设定值）', () => {
    // 7 个方向、比例带除不尽的小数：最容易因为取整丢张数
    const result = allocateByRatios(1000, [
      { id: 'a', ratio: 33.33 },
      { id: 'b', ratio: 33.33 },
      { id: 'c', ratio: 33.34 },
      { id: 'd', ratio: 10 },
      { id: 'e', ratio: 7 },
      { id: 'f', ratio: 3 },
      { id: 'g', ratio: 1 },
    ])
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(1000)
  })

  it('比例合计不为 100 时按权重归一，总数照样凑满', () => {
    // 只配了 60%：剩下的 40% 按已配比例摊回去，而不是少出图
    const result = allocateByRatios(1000, [
      { id: 'a', ratio: 30 },
      { id: 'b', ratio: 30 },
    ])
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(1000)
    expect(result).toEqual([500, 500])
  })

  it('一个比例都没配时退化为各方向均分（仍然凑满总数）', () => {
    const result = allocateByRatios(100, [
      { id: 'a', ratio: 0 },
      { id: 'b', ratio: 0 },
      { id: 'c', ratio: 0 },
    ])
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(100)
  })

  it('总数为 0 或负数时不产出负数', () => {
    expect(allocateByRatios(0, [{ id: 'a', ratio: 50 }])).toEqual([0])
    expect(allocateByRatios(-5, [{ id: 'a', ratio: 50 }])).toEqual([0])
  })
})

describe('每日分配：方向张数 → 每张卡', () => {
  it('权重大的卡分到更多', () => {
    const result = allocateToCards(
      400,
      [
        { id: 'c1', name: '卡1', weight: 3 },
        { id: 'c2', name: '卡2', weight: 1 },
      ],
      '2026-09-23',
    )
    expect(result[0]).toBeGreaterThan(result[1])
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(400)
  })

  it('⭐ 同一天重跑份额一致（补跑不会越补越乱）', () => {
    const cards = [
      { id: 'c1', name: '卡1', weight: 1 },
      { id: 'c2', name: '卡2', weight: 1 },
      { id: 'c3', name: '卡3', weight: 1 },
    ]
    expect(allocateToCards(100, cards, '2026-09-23')).toEqual(allocateToCards(100, cards, '2026-09-23'))
  })

  it('⭐ 换一天份额会浮动（这就是「随机抽取」的那点随机）', () => {
    const cards = [
      { id: 'c1', name: '卡1', weight: 1 },
      { id: 'c2', name: '卡2', weight: 1 },
      { id: 'c3', name: '卡3', weight: 1 },
    ]
    const seen = new Set<string>()
    for (let day = 1; day <= 12; day += 1) {
      seen.add(allocateToCards(100, cards, `2026-09-${String(day).padStart(2, '0')}`).join(','))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('启用中的卡都拿到份额，权重为正不会轮空', () => {
    const result = allocateToCards(
      30,
      [
        { id: 'c1', name: '卡1', weight: 1 },
        { id: 'c2', name: '卡2', weight: 1 },
        { id: 'c3', name: '卡3', weight: 1 },
      ],
      '2026-09-23',
    )
    expect(result.every((count) => count > 0)).toBe(true)
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(30)
  })
})

describe('一天的完整出图计划', () => {
  it('排得下去时，计划张数等于每日总数', () => {
    const result = buildDailyPlan({
      dateKey: '2026-09-23',
      dailyTotal: 1000,
      directions: [
        {
          directionCollectionId: 'd1',
          directionName: '方向一',
          ratio: 40,
          cards: [
            { id: 'c1', name: '卡1', weight: 1 },
            { id: 'c2', name: '卡2', weight: 1 },
          ],
        },
        {
          directionCollectionId: 'd2',
          directionName: '方向二',
          ratio: 60,
          cards: [{ id: 'c3', name: '卡3', weight: 1 }],
        },
      ],
    })
    expect(result.totalPlanned).toBe(1000)
    expect(result.skipped).toEqual([])
    expect(result.directions.map((item) => item.plannedCount)).toEqual([400, 600])
  })

  it('⭐ 方向下没有卡时不静默：记进 skipped 并写清原因', () => {
    const result = buildDailyPlan({
      dateKey: '2026-09-23',
      dailyTotal: 1000,
      directions: [
        {
          directionCollectionId: 'd1',
          directionName: '方向一',
          ratio: 40,
          cards: [{ id: 'c1', name: '卡1', weight: 1 }],
        },
        { directionCollectionId: 'd2', directionName: '方向二', ratio: 60, cards: [] },
      ],
    })
    expect(result.totalPlanned).toBe(400)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toBe('no-cards')
    expect(result.skipped[0].detail).toContain('方向二')
    expect(result.skipped[0].detail).toContain('600')
  })

  it('没排到张数的方向（比例 0）不算跳过', () => {
    const result = buildDailyPlan({
      dateKey: '2026-09-23',
      dailyTotal: 100,
      directions: [
        {
          directionCollectionId: 'd1',
          directionName: '方向一',
          ratio: 100,
          cards: [{ id: 'c1', name: '卡1', weight: 1 }],
        },
        { directionCollectionId: 'd2', directionName: '方向二', ratio: 0, cards: [] },
      ],
    })
    expect(result.skipped).toEqual([])
    expect(result.totalPlanned).toBe(100)
  })
})

describe('抖动与合计的工具函数', () => {
  it('dailyJitter 落在 [0,1) 且对同一输入稳定', () => {
    const value = dailyJitter('card-1', '2026-09-23')
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(1)
    expect(dailyJitter('card-1', '2026-09-23')).toBe(value)
    expect(dailyJitter('card-2', '2026-09-23')).not.toBe(value)
  })

  it('sumRatios 只累加有效的正数', () => {
    expect(sumRatios([40, 30, 30])).toBe(100)
    expect(sumRatios([40, -10, Number.NaN])).toBe(40)
  })
})
