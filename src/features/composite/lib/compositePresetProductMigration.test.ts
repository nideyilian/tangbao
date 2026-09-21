import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../../../types'
import { planLegacyWatermarkPushdown, planPresetProductClaim } from './compositePresetProductMigration'
import type { CompositeV2Preset } from './compositeV2Types'

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name.toLowerCase(), parentId, order, createdAt: 0, updatedAt: 0 }
}

/** 一棵标准三级树：产品线A →（机器人 / 电池）→（月亮 / 太阳）。 */
const COLLECTIONS = [
  collection('line-a', '产品线A', null),
  collection('product-1', '机器人', 'line-a'),
  collection('product-2', '电池', 'line-a'),
  collection('dir-1', '月亮', 'product-1'),
  collection('dir-2', '太阳', 'product-2'),
]

function preset(id: string, name = id, productId = ''): CompositeV2Preset {
  return {
    id,
    name,
    productId,
    baseCanvas: { width: 1, height: 1 },
    sampleBackgroundPath: '',
    layers: [],
    updatedAt: 0,
  }
}

describe('planLegacyWatermarkPushdown', () => {
  it('把全局基线摊到每个产品，产品自己写过的保持不动', () => {
    const plan = planLegacyWatermarkPushdown({
      collections: COLLECTIONS,
      params: { 'product-2': { postprocess: { watermarkPresetIds: ['own'] } } },
      globalPresetIds: ['preset-x'],
    })

    // 只有没表态的产品接过基线；有自己的清单就按自己的来
    expect(plan.paramUpdates).toEqual([{ collectionId: 'product-1', mediaId: null, presetIds: ['preset-x'] }])
    expect(plan.clearGlobalPresetIds).toBe(true)
    expect(plan.lineCleanupIds).toEqual([])
  })

  it('产品线级清单优先于全局基线，摊完清掉产品线那一格', () => {
    const plan = planLegacyWatermarkPushdown({
      collections: COLLECTIONS,
      params: { 'line-a': { postprocess: { watermarkPresetIds: ['line-wm'] } } },
      globalPresetIds: ['preset-x'],
    })

    expect(plan.paramUpdates).toEqual([
      { collectionId: 'product-1', mediaId: null, presetIds: ['line-wm'] },
      { collectionId: 'product-2', mediaId: null, presetIds: ['line-wm'] },
    ])
    expect(plan.lineCleanupIds).toEqual(['line-a'])
    // 没人用到全局基线 → 不清它（清了就是删用户数据）
    expect(plan.clearGlobalPresetIds).toBe(false)
  })

  it('产品线下面一个产品都没有时，不清产品线那一格', () => {
    const plan = planLegacyWatermarkPushdown({
      collections: [collection('line-a', '产品线A', null)],
      params: { 'line-a': { postprocess: { watermarkPresetIds: ['line-wm'] } } },
      globalPresetIds: [],
    })

    expect(plan.paramUpdates).toEqual([])
    expect(plan.lineCleanupIds).toEqual([])
    expect(plan.clearGlobalPresetIds).toBe(false)
  })

  it('空清单不摊：显式「不加水印」与「没表态」在结果上本来就是一回事', () => {
    const plan = planLegacyWatermarkPushdown({
      collections: COLLECTIONS,
      params: { 'line-a': { postprocess: { watermarkPresetIds: [] } } },
      globalPresetIds: [],
    })

    expect(plan.paramUpdates).toEqual([])
    expect(plan.lineCleanupIds).toEqual([])
  })
})

describe('planPresetProductClaim', () => {
  it('只有一个产品勾过 → 直接归过去，参数不用动', () => {
    const plan = planPresetProductClaim({
      presets: [preset('p1')],
      collections: COLLECTIONS,
      params: { 'dir-1': { postprocess: { watermarkPresetIds: ['p1'] } } },
    })

    expect(plan.presets.map((item) => item.productId)).toEqual(['product-1'])
    expect(plan.paramUpdates).toEqual([])
    expect(plan.assigned).toBe(1)
    expect(plan.duplicated).toBe(0)
  })

  it('⭐ 两个产品共用同一套 → 各复制一份，引用改指到各自的副本', () => {
    const plan = planPresetProductClaim({
      presets: [preset('p1', '角标')],
      collections: COLLECTIONS,
      params: {
        'dir-1': { postprocess: { watermarkPresetIds: ['p1'] } },
        'dir-2': { postprocess: { watermarkPresetIds: ['p1'] } },
      },
    })

    expect(plan.assigned).toBe(1)
    expect(plan.duplicated).toBe(1)
    // 主份归先出现的产品，副本归另一个
    expect(plan.presets.find((item) => item.id === 'p1')?.productId).toBe('product-1')
    const copy = plan.presets.find((item) => item.id !== 'p1')!
    expect(copy.productId).toBe('product-2')
    expect(copy.name).toContain('电池')
    // 图层是深拷贝：两份水印以后各改各的，不会互相牵连
    expect(copy.layers).not.toBe(plan.presets[0]!.layers)
    // 只有第二个产品的引用要改指；第一个产品的引用保持原样，不需要写回
    expect(plan.paramUpdates).toEqual([{ collectionId: 'dir-2', mediaId: null, presetIds: [copy.id] }])
  })

  it('没人勾过 → 保持未分配', () => {
    const plan = planPresetProductClaim({ presets: [preset('p1')], collections: COLLECTIONS, params: {} })

    expect(plan.presets[0]!.productId).toBe('')
    expect(plan.unassigned).toBe(1)
    expect(plan.assigned).toBe(0)
  })

  it('已有归属的预设不参与推断（重复迁移是空操作）', () => {
    const plan = planPresetProductClaim({
      presets: [preset('p1', 'p1', 'product-2')],
      collections: COLLECTIONS,
      params: { 'dir-1': { postprocess: { watermarkPresetIds: ['p1'] } } },
    })

    expect(plan.presets.map((item) => item.productId)).toEqual(['product-2'])
    expect(plan.assigned).toBe(0)
  })

  it('产品线层的声明不算归属（它不属于任何产品）', () => {
    const plan = planPresetProductClaim({
      presets: [preset('p1')],
      collections: COLLECTIONS,
      params: { 'line-a': { postprocess: { watermarkPresetIds: ['p1'] } } },
    })

    expect(plan.presets[0]!.productId).toBe('')
  })

  it('按渠道单独设的水印同样参与推断', () => {
    const plan = planPresetProductClaim({
      presets: [preset('p1')],
      collections: COLLECTIONS,
      params: { 'dir-1': { postprocess: { byMedia: { toutiao: { watermarkPresetIds: ['p1'] } } } } },
    })

    expect(plan.presets[0]!.productId).toBe('product-1')
  })

  it('⭐ 同一份数据跑两次得到同样的副本 id（迁移必须确定性）', () => {
    const input = {
      presets: [preset('p1', '角标')],
      collections: COLLECTIONS,
      params: {
        'dir-1': { postprocess: { watermarkPresetIds: ['p1'] } },
        'dir-2': { postprocess: { watermarkPresetIds: ['p1'] } },
      },
    }

    expect(planPresetProductClaim(input).presets.map((item) => item.id)).toEqual(
      planPresetProductClaim(input).presets.map((item) => item.id),
    )
  })

  it('产品在回收站时不算产品，水印保持未分配', () => {
    const plan = planPresetProductClaim({
      presets: [preset('p1')],
      collections: COLLECTIONS.map((item) => (item.id === 'product-1' ? { ...item, trashedAt: 1 } : item)),
      params: { 'dir-1': { postprocess: { watermarkPresetIds: ['p1'] } } },
    })

    expect(plan.presets[0]!.productId).toBe('')
  })
})
