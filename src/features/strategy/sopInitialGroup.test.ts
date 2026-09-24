/**
 * SOP 初始分组解析的测试。
 *
 * 这段逻辑错了不会报错，只会「打开 SOP 停在别的分组」——属于最容易被漏掉的那类问题，
 * 所以四类分支都要钉住：指针不是方向 / 方向自己有分组 / 只有上级有分组 / 一个都没对上。
 */

import { describe, expect, it } from 'vitest'
import { resolveInitialSopGroupId, SOP_ALL_GROUPS_ID } from './sopInitialGroup'
import type { AssetCollection, AssetLibraryScope } from '../../types'

const collections = [
  { id: 'line-a', name: '产品线A', parentId: null },
  { id: 'product-a', name: '产品A', parentId: 'line-a' },
  { id: 'direction-moon', name: '月亮', parentId: 'product-a' },
] as AssetCollection[]

const groups = [
  { id: 'g-line', collectionId: 'line-a' },
  { id: 'g-product', collectionId: 'product-a' },
  { id: 'g-moon', collectionId: 'direction-moon' },
  { id: 'g-custom' }, // 用户自建分组，不挂文件夹
]

const collectionScope = (id: string): AssetLibraryScope => ({ kind: 'collection', id })

describe('resolveInitialSopGroupId', () => {
  it('指针指向方向且该方向有镜像分组 ⇒ 那个分组（最深优先）', () => {
    expect(resolveInitialSopGroupId({ groups, collections, scope: collectionScope('direction-moon') })).toBe('g-moon')
  })

  it('该方向没有镜像分组时，向上退到产品 / 产品线（而不是直接回全部）', () => {
    const onlyLineAndProduct = [{ id: 'g-product', collectionId: 'product-a' }]
    expect(
      resolveInitialSopGroupId({ groups: onlyLineAndProduct, collections, scope: collectionScope('direction-moon') }),
    ).toBe('g-product')

    const onlyLine = [{ id: 'g-line', collectionId: 'line-a' }]
    expect(resolveInitialSopGroupId({ groups: onlyLine, collections, scope: collectionScope('direction-moon') })).toBe(
      'g-line',
    )
  })

  it('指针不是具体文件夹（全部 / 收藏 / 标签）⇒ 全部', () => {
    const scopes: AssetLibraryScope[] = ['all', 'recent', 'favorites', 'unorganized', { kind: 'tag', id: 't1' }]
    for (const scope of scopes) {
      expect(resolveInitialSopGroupId({ groups, collections, scope })).toBe(SOP_ALL_GROUPS_ID)
    }
  })

  it('文件夹在树里找不到 / 没有镜像分组 ⇒ 全部，不抛错', () => {
    expect(resolveInitialSopGroupId({ groups, collections, scope: collectionScope('不存在') })).toBe(SOP_ALL_GROUPS_ID)
    expect(resolveInitialSopGroupId({ groups: [groups[3]!], collections, scope: collectionScope('line-a') })).toBe(
      SOP_ALL_GROUPS_ID,
    )
    expect(resolveInitialSopGroupId({ groups: [], collections, scope: collectionScope('line-a') })).toBe(
      SOP_ALL_GROUPS_ID,
    )
  })

  it('同一文件夹有多个镜像分组时结果稳定（取第一个，不会每次打开都跳）', () => {
    const duplicated = [
      { id: 'g-first', collectionId: 'line-a' },
      { id: 'g-second', collectionId: 'line-a' },
    ]
    const first = resolveInitialSopGroupId({ groups: duplicated, collections, scope: collectionScope('line-a') })
    const second = resolveInitialSopGroupId({ groups: duplicated, collections, scope: collectionScope('line-a') })
    expect(first).toBe('g-first')
    expect(second).toBe('g-first')
  })
})
