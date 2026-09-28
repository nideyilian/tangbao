import { describe, expect, it } from 'vitest'
import { pickRandomPoolItems, pickSelectedPoolItems, resolvePoolSelection, resolveRandomCount } from './poolSelection'
import type { CreativePoolItem } from './types'

function item(id: string): CreativePoolItem {
  return { id, name: id, assetRef: `a-${id}`, points: [], createdAt: 0, updatedAt: 0 }
}

const ITEMS = ['a', 'b', 'c', 'd'].map(item)

describe('pickSelectedPoolItems', () => {
  it('按池内顺序返回，而不是按勾选先后（序号才稳定）', () => {
    expect(pickSelectedPoolItems(ITEMS, ['c', 'a']).map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('没勾选时返回空', () => {
    expect(pickSelectedPoolItems(ITEMS, [])).toEqual([])
  })

  it('忽略池里已不存在的 id（图被删掉后勾选残留）', () => {
    expect(pickSelectedPoolItems(ITEMS, ['a', 'zzz']).map((i) => i.id)).toEqual(['a'])
  })

  it('不修改传入数组', () => {
    const ids = ['b']
    pickSelectedPoolItems(ITEMS, ids)
    expect(ids).toEqual(['b'])
    expect(ITEMS).toHaveLength(4)
  })
})

describe('pickRandomPoolItems', () => {
  it('抽 0 张或空池返回空', () => {
    expect(pickRandomPoolItems(ITEMS, 0)).toEqual([])
    expect(pickRandomPoolItems([], 3)).toEqual([])
    expect(pickRandomPoolItems(ITEMS, -1)).toEqual([])
  })

  it('要的张数不少于池子大小时全给，且保持原顺序（不去洗牌）', () => {
    expect(pickRandomPoolItems(ITEMS, 4).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(pickRandomPoolItems(ITEMS, 10).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('随机源返回 0 时抽到的是前 N 张（部分洗牌不越界）', () => {
    expect(pickRandomPoolItems(ITEMS, 2, () => 0).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('抽到的张数正确且不重复', () => {
    for (let round = 0; round < 20; round += 1) {
      const picked = pickRandomPoolItems(ITEMS, 3)
      expect(picked).toHaveLength(3)
      expect(new Set(picked.map((i) => i.id)).size).toBe(3)
    }
  })

  it('不修改传入数组和元素', () => {
    pickRandomPoolItems(ITEMS, 2)
    expect(ITEMS.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('resolvePoolSelection', () => {
  it('manual 走勾选，且不受随机上限约束（勾选是用户一张张点的）', () => {
    const picked = resolvePoolSelection(ITEMS, { mode: 'manual', selectedIds: ['a', 'b', 'c'], randomCount: 3 }, 1)
    expect(picked.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('random 忽略勾选、按张数重抽', () => {
    const picked = resolvePoolSelection(ITEMS, { mode: 'random', selectedIds: ['b'], randomCount: 2 }, null, () => 0)
    expect(picked.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('⭐ random 的抽签数被可选上限夹住', () => {
    const picked = resolvePoolSelection(ITEMS, { mode: 'random', selectedIds: [], randomCount: 4 }, 2, () => 0)
    expect(picked.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('resolveRandomCount', () => {
  it('没配上限时上限就是池子大小（等于不限，但不会超出池子）', () => {
    expect(resolveRandomCount(3, 10, null)).toBe(3)
    expect(resolveRandomCount(999, 10, null)).toBe(10)
  })

  it('配了上限就按上限夹', () => {
    expect(resolveRandomCount(9, 10, 3)).toBe(3)
    expect(resolveRandomCount(2, 10, 3)).toBe(2)
  })

  it('上限比池子还大时以池子为准（抽不出不存在的图）', () => {
    expect(resolveRandomCount(9, 4, 100)).toBe(4)
  })

  it('至少 1 张；空池返回 0', () => {
    expect(resolveRandomCount(0, 10, null)).toBe(1)
    expect(resolveRandomCount(-5, 10, null)).toBe(1)
    expect(resolveRandomCount(3, 0, null)).toBe(0)
  })

  it('上限为脏值（0 / 负数 / 非数）一律当「不限」', () => {
    expect(resolveRandomCount(5, 10, 0)).toBe(5)
    expect(resolveRandomCount(5, 10, -2)).toBe(5)
    expect(resolveRandomCount(5, 10, Number.NaN)).toBe(5)
  })
})
