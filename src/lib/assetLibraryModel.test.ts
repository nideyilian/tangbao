import { describe, expect, it } from 'vitest'
import type { GeneratedAsset } from '../types'
import {
  ASSET_STATUS_MARK_LABELS,
  applyAssetPatch,
  assetScopeMatches,
  canAssetBeReviewed,
  containsAssetOrigin,
  countAssetOrigins,
  createEmptyCollection,
  cycleColorLabel,
  findCycleRoot,
  hasAssetAncestor,
  normalizeAsset,
  normalizeAssetRating,
  normalizeAssetStatus,
  normalizeAssetUsageEvent,
  normalizeCollection,
  normalizeTag,
  normalizeTombstone,
  resolveAssetStatusMark,
  sortCollections,
} from './assetLibraryModel'

function makeAsset(overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return normalizeAsset({
    id: 'asset-a',
    imageId: 'hash-a',
    origins: [
      {
        key: 'task-1:0',
        taskId: 'task-1',
        outputSlot: 0,
        taskCreatedAt: 1000,
        prompt: 'cat',
        requestedParams: {},
      },
      {
        key: 'task-2:1',
        taskId: 'task-2',
        outputSlot: 1,
        taskCreatedAt: 2000,
        prompt: 'dog',
        requestedParams: {},
      },
    ],
    ...overrides,
  })
}

describe('normalizeAssetStatus', () => {
  it('rejects unknown values and falls back to active', () => {
    expect(normalizeAssetStatus('trashed')).toBe('trashed')
    expect(normalizeAssetStatus('active')).toBe('active')
    expect(normalizeAssetStatus(undefined)).toBe('active')
    expect(normalizeAssetStatus('deleted')).toBe('active')
  })
})

describe('normalizeAssetRating', () => {
  it('clamps to integer 0-5', () => {
    expect(normalizeAssetRating(0)).toBe(0)
    expect(normalizeAssetRating(5)).toBe(5)
    expect(normalizeAssetRating(3.9)).toBe(3)
    expect(normalizeAssetRating(9)).toBe(0)
    expect(normalizeAssetRating(-1)).toBe(0)
    expect(normalizeAssetRating('abc')).toBe(0)
  })
})

describe('normalizeAsset', () => {
  it('fills defaults for missing fields', () => {
    const asset = normalizeAsset({ id: 'a', imageId: 'a' })
    expect(asset.status).toBe('active')
    expect(asset.rating).toBe(0)
    expect(asset.favorite).toBe(false)
    expect(asset.collectionIds).toEqual([])
    expect(asset.tagIds).toEqual([])
    expect(asset.origins).toEqual([])
    expect(asset.parentAssetIds).toEqual([])
    expect(asset.metadataVersion).toBe(2)
    expect(asset.trashedAt).toBeNull()
    expect(asset.createdAt).toBeGreaterThan(0)
    expect(asset.updatedAt).toBeGreaterThanOrEqual(asset.createdAt)
  })

  it('falls back imageId to id', () => {
    const asset = normalizeAsset({ id: 'x' })
    expect(asset.imageId).toBe('x')
  })

  it('reconstructs origin keys when missing', () => {
    const asset = normalizeAsset({
      id: 'a',
      origins: [{ taskId: 'task-9', outputSlot: 2 }],
    })
    expect(asset.origins[0].key).toBe('task-9:2')
    expect(asset.origins[0].prompt).toBe('')
  })

  it('ignores non-string ids in arrays', () => {
    const asset = normalizeAsset({
      id: 'a',
      collectionIds: ['c1', 42, '', 'c2'],
      tagIds: ['t1', null],
      parentAssetIds: ['p1', 'p2'],
    })
    expect(asset.collectionIds).toEqual(['c1', 'c2'])
    expect(asset.tagIds).toEqual(['t1'])
    expect(asset.parentAssetIds).toEqual(['p1', 'p2'])
  })

  it('validates primaryOriginKey against origins', () => {
    const asset = normalizeAsset({
      id: 'a',
      primaryOriginKey: 'task-1:0',
      origins: [{ key: 'task-1:0', taskId: 't', outputSlot: 0 }],
    })
    expect(asset.primaryOriginKey).toBe('task-1:0')
    const bad = normalizeAsset({
      id: 'a',
      primaryOriginKey: 'missing',
      origins: [{ key: 'task-1:0', taskId: 't', outputSlot: 0 }],
    })
    expect(bad.primaryOriginKey).toBe('task-1:0')
  })
})

describe('normalizeAssetUsageEvent', () => {
  it('accepts known actions and rejects records without stable identities', () => {
    expect(
      normalizeAssetUsageEvent({
        id: 'usage-a',
        assetId: 'asset-a',
        imageId: 'image-a',
        action: 'generation-input',
        target: 'gallery',
        occurredAt: 100,
      }),
    ).toEqual(expect.objectContaining({ id: 'usage-a', action: 'generation-input', target: 'gallery' }))
    expect(normalizeAssetUsageEvent({ id: '', assetId: 'asset-a', imageId: 'image-a' })).toBeNull()
  })
})

describe('normalizeCollection / normalizeTag / normalizeTombstone', () => {
  it('normalizes collection and falls back normalizedName', () => {
    const c = normalizeCollection({ id: 'c1', name: '摄影' })
    expect(c).not.toBeNull()
    expect(c!.normalizedName).toBe('摄影'.toLocaleLowerCase('zh-CN'))
  })

  it('returns null for invalid collection', () => {
    expect(normalizeCollection({ id: '' })).toBeNull()
    expect(normalizeCollection({ name: '' })).toBeNull()
  })

  it('normalizes tag', () => {
    const t = normalizeTag({ id: 't1', name: ' 高清 ' })
    expect(t!.name).toBe(' 高清 ')
    expect(t!.normalizedName).toBe(' 高清 '.toLocaleLowerCase('zh-CN'))
  })

  it('defaults tag tree fields and color', () => {
    const t = normalizeTag({ id: 't1', name: '高清' })!
    expect(t.parentId).toBeNull()
    expect(t.order).toBe(0)
    expect(t.color).toBeUndefined()
    const nested = normalizeTag({ id: 't2', name: '子', parentId: 't1', order: 3, color: '#ff0000' })!
    expect(nested.parentId).toBe('t1')
    expect(nested.order).toBe(3)
    expect(nested.color).toBe('#ff0000')
  })

  it('normalizes tombstone and falls back imageId to id', () => {
    const tomb = normalizeTombstone({ id: 'tomb-1' })
    expect(tomb!.imageId).toBe('tomb-1')
    expect(tomb!.purgedAt).toBeGreaterThan(0)
  })
})

describe('applyAssetPatch', () => {
  it('applies only allowed fields and bumps updatedAt', () => {
    const base = makeAsset()
    const patched = applyAssetPatch(base, { favorite: true, rating: 4, collectionIds: ['c1'] }, 5000)
    expect(patched.favorite).toBe(true)
    expect(patched.rating).toBe(4)
    expect(patched.collectionIds).toEqual(['c1'])
    expect(patched.tagIds).toEqual(base.tagIds)
    expect(patched.updatedAt).toBe(5000)
    expect(patched.id).toBe(base.id)
  })

  it('patches notes without losing existing ones when omitted', () => {
    const base = makeAsset({ notes: '原有备注' })
    const patched = applyAssetPatch(base, { notes: '新备注' }, 5000)
    expect(patched.notes).toBe('新备注')
    expect(applyAssetPatch(base, { favorite: true }, 6000).notes).toBe('原有备注')
  })
})

describe('状态标记：已使用 / 已审核（TB-105）', () => {
  it('⭐ 新字段过一遍 normalizeAsset 不丢 —— 白名单漏加就是静默丢数据', () => {
    // 这条守的是「落库 → 读回」这一段：`normalizeAsset` 是显式白名单，
    // 加了字段却忘了放行，界面上只是「标签不亮」，全程一个错都不报。
    const asset = normalizeAsset({ id: 'a', imageId: 'h', origins: [], postprocessAt: 1727, reviewedAt: 1728 })
    expect(asset.postprocessAt).toBe(1727)
    expect(asset.reviewedAt).toBe(1728)

    const bare = normalizeAsset({ id: 'a', imageId: 'h', origins: [] })
    expect(bare.postprocessAt).toBeUndefined()
    expect(bare.reviewedAt).toBeUndefined()
  })

  it('applyAssetPatch：postprocessAt 只写不清，缺省时保持原值', () => {
    const patched = applyAssetPatch(makeAsset(), { postprocessAt: 1727 }, 2000)
    expect(patched.postprocessAt).toBe(1727)
    // 之后任何不带该字段的补丁都不该把它抹掉
    expect(applyAssetPatch(patched, { favorite: true }, 3000).postprocessAt).toBe(1727)
  })

  it('applyAssetPatch：reviewedAt 传 null 是**清除**，与「没传」不是一回事', () => {
    const reviewed = applyAssetPatch(makeAsset(), { reviewedAt: 1727 }, 2000)
    expect(reviewed.reviewedAt).toBe(1727)
    expect(applyAssetPatch(reviewed, { reviewedAt: null }, 3000).reviewedAt).toBeUndefined()
    expect(applyAssetPatch(reviewed, {}, 3000).reviewedAt).toBe(1727)
  })

  it('两枚标记互斥：最多亮一枚，都有值时以「已使用」为准（事实优先于人的判断）', () => {
    expect(resolveAssetStatusMark({})).toBeNull()
    expect(resolveAssetStatusMark({ reviewedAt: 1 })).toBe('reviewed')
    expect(resolveAssetStatusMark({ postprocessAt: 1 })).toBe('used')
    expect(resolveAssetStatusMark({ postprocessAt: 1, reviewedAt: 2 })).toBe('used')
  })

  it('产出过后面处理的素材，不再可被标记为已审核', () => {
    expect(canAssetBeReviewed({})).toBe(true)
    expect(canAssetBeReviewed({ postprocessAt: 1 })).toBe(false)
  })

  it('两枚标记的文案各只有一份来源（网格胶囊与列表 chip 共用）', () => {
    expect(ASSET_STATUS_MARK_LABELS.used).toBe('已使用')
    expect(ASSET_STATUS_MARK_LABELS.reviewed).toBe('已审核')
  })
})

describe('containsAssetOrigin / countAssetOrigins', () => {
  it('matches by exact key', () => {
    const asset = makeAsset()
    expect(containsAssetOrigin(asset, 'task-1:0')).toBe(true)
    expect(containsAssetOrigin(asset, 'task-1:1')).toBe(false)
  })

  it('counts origins by task prefix', () => {
    const asset = makeAsset()
    expect(countAssetOrigins(asset, 'task-1:')).toBe(1)
    expect(countAssetOrigins(asset, 'task-2:')).toBe(1)
    expect(countAssetOrigins(asset, 'task-')).toBe(2)
    expect(countAssetOrigins(asset, 'task-1:99')).toBe(0)
  })
})

describe('hasAssetAncestor / findCycleRoot', () => {
  it('finds transitive ancestors and breaks cycles', () => {
    const a = normalizeAsset({ id: 'a', parentAssetIds: ['b'] })
    const b = normalizeAsset({ id: 'b', parentAssetIds: ['c'] })
    const c = normalizeAsset({ id: 'c', parentAssetIds: ['a'] }) // cycle a->b->c->a
    const byId = new Map([
      ['a', a],
      ['b', b],
      ['c', c],
    ])
    expect(hasAssetAncestor(a, 'c', byId)).toBe(true)
    expect(hasAssetAncestor(a, 'a', byId)).toBe(true) // via cycle
    expect(findCycleRoot(a, byId)).not.toBeNull()
  })

  it('returns null when no cycle exists', () => {
    const a = normalizeAsset({ id: 'a', parentAssetIds: ['b'] })
    const b = normalizeAsset({ id: 'b' })
    const byId = new Map([
      ['a', a],
      ['b', b],
    ])
    expect(hasAssetAncestor(a, 'b', byId)).toBe(true)
    expect(hasAssetAncestor(a, 'z', byId)).toBe(false)
    expect(findCycleRoot(a, byId)).toBeNull()
  })
})

describe('sortCollections', () => {
  it('sorts collections depth-first by order then name', () => {
    const child = normalizeCollection({ id: 'c1', name: 'B', parentId: 'r2', order: 1 })!
    const root2 = normalizeCollection({ id: 'r2', name: 'A', order: 0 })!
    const root1 = normalizeCollection({ id: 'r1', name: 'Z', order: 2 })!
    const sorted = sortCollections([child, root2, root1])
    expect(sorted.map((c) => c.id)).toEqual(['r2', 'c1', 'r1'])
  })

  it('keeps orphaned and cyclic collections visible exactly once', () => {
    const orphan = normalizeCollection({ id: 'orphan', name: '孤立', parentId: 'missing' })!
    const cycleA = normalizeCollection({ id: 'cycle-a', name: '循环 A', parentId: 'cycle-b' })!
    const cycleB = normalizeCollection({ id: 'cycle-b', name: '循环 B', parentId: 'cycle-a' })!
    const sorted = sortCollections([cycleB, orphan, cycleA])

    expect(new Set(sorted.map((collection) => collection.id))).toEqual(new Set(['orphan', 'cycle-a', 'cycle-b']))
    expect(sorted).toHaveLength(3)
  })
})

describe('assetScopeMatches', () => {
  const now = 10_000
  const recent = makeAsset({ createdAt: now - 1000 })
  const old = makeAsset({ createdAt: now - 999 * 24 * 60 * 60 * 1000 })

  it('matches all', () => {
    expect(assetScopeMatches('all', recent, now)).toBe(true)
  })

  it('matches recent within window', () => {
    expect(assetScopeMatches('recent', recent, now)).toBe(true)
    expect(assetScopeMatches('recent', old, now)).toBe(false)
  })

  it('matches favorites / unorganized', () => {
    expect(assetScopeMatches('favorites', makeAsset({ favorite: true }), now)).toBe(true)
    expect(assetScopeMatches('favorites', makeAsset(), now)).toBe(false)
    expect(assetScopeMatches('unorganized', makeAsset(), now)).toBe(true)
    expect(assetScopeMatches('unorganized', makeAsset({ collectionIds: ['c1'] }), now)).toBe(false)
  })

  it('已回收素材对任何范围都不可见（回收站已撤除，ADR-0021）', () => {
    const trashed = makeAsset({ status: 'trashed', trashedAt: 2000 })
    expect(assetScopeMatches('all', trashed, now)).toBe(false)
    expect(assetScopeMatches('recent', trashed, now)).toBe(false)
    expect(assetScopeMatches('favorites', { ...trashed, favorite: true }, now)).toBe(false)
    expect(assetScopeMatches('unorganized', trashed, now)).toBe(false)
    expect(assetScopeMatches({ kind: 'collection', id: 'c1' }, { ...trashed, collectionIds: ['c1'] }, now)).toBe(false)
  })

  it('matches collection and tag scopes', () => {
    expect(assetScopeMatches({ kind: 'collection', id: 'c1' }, makeAsset({ collectionIds: ['c1'] }), now)).toBe(true)
    expect(assetScopeMatches({ kind: 'collection', id: 'c2' }, makeAsset({ collectionIds: ['c1'] }), now)).toBe(false)
    expect(assetScopeMatches({ kind: 'tag', id: 't1' }, makeAsset({ tagIds: ['t1'] }), now)).toBe(true)
  })
})

describe('creators', () => {
  it('creates empty collection with fresh id', () => {
    const c = createEmptyCollection(123)
    expect(c.id).toBeTruthy()
    expect(c.name).toBe('')
    expect(c.createdAt).toBe(123)
  })
})

describe('cycleColorLabel', () => {
  it('cycles through the Eagle-style order and clears after gray', () => {
    expect(cycleColorLabel(undefined)).toBe('red')
    expect(cycleColorLabel('red')).toBe('orange')
    expect(cycleColorLabel('orange')).toBe('yellow')
    expect(cycleColorLabel('yellow')).toBe('green')
    expect(cycleColorLabel('green')).toBe('blue')
    expect(cycleColorLabel('blue')).toBe('purple')
    expect(cycleColorLabel('purple')).toBe('gray')
    expect(cycleColorLabel('gray')).toBeUndefined()
  })
})
