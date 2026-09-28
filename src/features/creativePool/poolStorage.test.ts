import { describe, expect, it } from 'vitest'
import { POOL_RANDOM_DEFAULT_COUNT } from './poolSelection'
import { createEmptyPools, normalizePools } from './poolStorage'
import { CREATIVE_POOL_KINDS } from './types'

describe('createEmptyPools', () => {
  it('三种池都要在（缺的池不能不存在）', () => {
    const pools = createEmptyPools()
    expect(pools.map((p) => p.kind)).toEqual([...CREATIVE_POOL_KINDS])
    expect(pools.every((p) => p.items.length === 0)).toBe(true)
  })
})

describe('normalizePools', () => {
  it('随机上限：正数保留，缺省 / 脏值一律当「不限」', () => {
    const limited = normalizePools({ pools: [{ kind: 'style', items: [], maxRandomCount: 3 }] })
    expect(limited.find((p) => p.kind === 'style')?.maxRandomCount).toBe(3)
    for (const raw of [undefined, null, 0, -1, 'x', Number.NaN]) {
      const pools = normalizePools({ pools: [{ kind: 'style', items: [], maxRandomCount: raw }] })
      expect(pools.find((p) => p.kind === 'style')?.maxRandomCount).toBeNull()
    }
    expect(createEmptyPools().every((pool) => pool.maxRandomCount === null)).toBe(true)
  })

  it('盘上是垃圾（null / 字符串 / 数字）时给出完整空结构', () => {
    for (const raw of [null, undefined, 'nope', 42, []]) {
      expect(normalizePools(raw).map((p) => p.kind)).toEqual([...CREATIVE_POOL_KINDS])
    }
  })

  it('缺某个 kind 时补空，而不是少一个池', () => {
    const pools = normalizePools({ pools: [{ kind: 'style', items: [] }] })
    expect(pools.map((p) => p.kind)).toEqual([...CREATIVE_POOL_KINDS])
    expect(pools.find((p) => p.kind === 'composition')?.items).toEqual([])
  })

  it('丢掉未知 kind 的池，不把它带进界面', () => {
    const pools = normalizePools({ pools: [{ kind: 'nonsense', items: [{ id: 'x', assetRef: 'a' }] }] })
    expect(pools.map((p) => p.kind)).toEqual([...CREATIVE_POOL_KINDS])
    expect(pools.every((p) => p.items.length === 0)).toBe(true)
  })

  it('⭐ 丢掉缺 id 或缺图引用的项（留着就是点不开的空格子）', () => {
    const pools = normalizePools({
      pools: [
        {
          kind: 'style',
          items: [
            { id: 'ok', assetRef: 'a1', name: '厚涂油画' },
            { id: '', assetRef: 'a2' },
            { assetRef: 'a3' },
            { id: 'no-asset' },
            null,
            'nope',
          ],
        },
      ],
    })
    expect(pools.find((p) => p.kind === 'style')?.items.map((i) => i.id)).toEqual(['ok'])
  })

  it('同一池内重复 id 只留第一次', () => {
    const pools = normalizePools({
      pools: [
        {
          kind: 'style',
          items: [
            { id: 'dup', assetRef: 'a1', name: '第一个' },
            { id: 'dup', assetRef: 'a2', name: '第二个' },
          ],
        },
      ],
    })
    const items = pools.find((p) => p.kind === 'style')?.items ?? []
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('第一个')
  })

  it('名字按 8 字上限夹取（旧数据可能超长）', () => {
    const pools = normalizePools({
      pools: [{ kind: 'style', items: [{ id: 'a', assetRef: 'a1', name: '这是一个特别特别长的风格名字' }] }],
    })
    const name = pools.find((p) => p.kind === 'style')?.items[0].name ?? ''
    expect(Array.from(name)).toHaveLength(8)
    expect(name).toBe('这是一个特别特别')
  })

  it('要点只保留字符串，时间戳缺省补当前值', () => {
    const pools = normalizePools({
      pools: [{ kind: 'style', items: [{ id: 'a', assetRef: 'a1', points: ['笔触厚重', 42, null, '低饱和'] }] }],
    })
    const item = pools.find((p) => p.kind === 'style')?.items[0]
    expect(item?.points).toEqual(['笔触厚重', '低饱和'])
    expect(typeof item?.createdAt).toBe('number')
    expect(typeof item?.updatedAt).toBe('number')
  })

  it('items 不是数组时当空处理（不抛异常）', () => {
    const pools = normalizePools({ pools: [{ kind: 'style', items: 'nope' }] })
    expect(pools.find((p) => p.kind === 'style')?.items).toEqual([])
  })

  it('⭐ 选中态：脏值归一，且删图后残留的勾选会被清掉', () => {
    const pools = normalizePools({
      pools: [
        {
          kind: 'style',
          items: [
            { id: 'a', assetRef: 'a1' },
            { id: 'b', assetRef: 'b1' },
          ],
          selection: { mode: 'random', selectedIds: ['a', 'ghost', 'a', 42], randomCount: 3.7 },
        },
      ],
    })
    expect(pools.find((p) => p.kind === 'style')?.selection).toEqual({
      mode: 'random',
      selectedIds: ['a'],
      randomCount: 3,
    })
  })

  it('选中态缺省 / 非法时给默认值（手选 / 空 / 默认张数）', () => {
    const pools = normalizePools({ pools: [{ kind: 'style', items: [] }] })
    expect(pools.find((p) => p.kind === 'style')?.selection).toEqual({
      mode: 'manual',
      selectedIds: [],
      randomCount: POOL_RANDOM_DEFAULT_COUNT,
    })
    expect(createEmptyPools().every((pool) => pool.selection.selectedIds.length === 0)).toBe(true)
  })

  it('选中态的 mode 只认 random，其余一律当手选', () => {
    const pools = normalizePools({
      pools: [{ kind: 'style', items: [{ id: 'a', assetRef: 'a1' }], selection: { mode: 'nonsense' } }],
    })
    expect(pools.find((p) => p.kind === 'style')?.selection.mode).toBe('manual')
  })
})
