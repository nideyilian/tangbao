import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../types'
import {
  buildPostprocessProjectTree,
  findMissingProjectCollectionIds,
  flattenPostprocessProjectTree,
  resolveCollectionPath,
  resolvePostprocessProjectTargets,
} from './postprocessProjectTree'

let seq = 0

function collection(id: string, name: string, parentId: string | null = null, order = 0): AssetCollection {
  seq += 1
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    parentId,
    order,
    createdAt: seq,
    updatedAt: seq,
  }
}

/** 产品线「智能客服」→ 产品「机器人」→ 方向「竖版展示」。 */
function threeLevelTree(): AssetCollection[] {
  return [
    collection('line-a', '智能客服', null, 0),
    collection('product-a', '机器人', 'line-a', 0),
    collection('direction-a', '竖版展示', 'product-a', 0),
    collection('direction-b', '横版展示', 'product-a', 1),
    collection('line-b', '智能硬件', null, 1),
    collection('product-b', '音箱', 'line-b', 0),
  ]
}

describe('buildPostprocessProjectTree', () => {
  it('按 order 建出三级树，depth 与 parentId 一致', () => {
    const tree = buildPostprocessProjectTree(threeLevelTree())
    expect(tree.map((node) => node.id)).toEqual(['line-a', 'line-b'])
    expect(tree[0].depth).toBe(0)
    expect(tree[0].parentId).toBeNull()
    expect(tree[0].children.map((node) => node.id)).toEqual(['product-a'])
    expect(tree[0].children[0].depth).toBe(1)
    expect(tree[0].children[0].parentId).toBe('line-a')
    expect(tree[0].children[0].children.map((node) => node.id)).toEqual(['direction-a', 'direction-b'])
    expect(tree[0].children[0].children[0].depth).toBe(2)
  })

  it('同级按 order 排序，order 相同时按名称', () => {
    const collections = [collection('x', '乙', null, 1), collection('y', '甲', null, 1), collection('z', '丙', null, 0)]
    expect(buildPostprocessProjectTree(collections).map((node) => node.id)).toEqual(['z', 'y', 'x'])
  })

  it('回收站里的节点不出现', () => {
    const collections = threeLevelTree()
    collections[2].trashedAt = Date.now()
    const tree = buildPostprocessProjectTree(collections)
    expect(tree[0].children[0].children.map((node) => node.id)).toEqual(['direction-b'])
  })

  it('parentId 指向不存在的节点 → 提升为根，不丢失', () => {
    const tree = buildPostprocessProjectTree([collection('orphan', '孤儿', 'missing-parent')])
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ id: 'orphan', depth: 0, parentId: null })
  })

  it('自环与互相引用成环都不会死循环，环内节点一律提升为根', () => {
    const selfLoop = buildPostprocessProjectTree([collection('self', '自环', 'self')])
    expect(selfLoop.map((node) => node.id)).toEqual(['self'])

    const cyclic = buildPostprocessProjectTree([
      collection('a', 'A', 'b'),
      collection('b', 'B', 'a'),
      collection('child-of-a', 'A 的子节点', 'a'),
    ])
    // 环内节点全部可达（不死循环、不丢节点），具体挂在哪一层不作要求
    expect(
      flattenPostprocessProjectTree(cyclic)
        .map((node) => node.id)
        .sort(),
    ).toEqual(['a', 'b', 'child-of-a'])
    for (const node of cyclic) expect(node.depth).toBe(0)
  })

  it('flatten 按「父在子前」的顺序展平', () => {
    const tree = buildPostprocessProjectTree(threeLevelTree())
    expect(flattenPostprocessProjectTree(tree).map((node) => node.id)).toEqual([
      'line-a',
      'product-a',
      'direction-a',
      'direction-b',
      'line-b',
      'product-b',
    ])
  })
})

describe('resolveCollectionPath', () => {
  it('返回根到自身的路径', () => {
    const path = resolveCollectionPath(threeLevelTree(), 'direction-b')
    expect(path.map((item) => item.name)).toEqual(['智能客服', '机器人', '横版展示'])
  })

  it('节点不存在时返回空路径', () => {
    expect(resolveCollectionPath(threeLevelTree(), 'ghost')).toEqual([])
  })
})

describe('resolvePostprocessProjectTargets', () => {
  it('三级节点解析出产品线/产品/方向', () => {
    const targets = resolvePostprocessProjectTargets(threeLevelTree(), ['direction-b'])
    expect(targets).toEqual([
      { collectionId: 'direction-b', line: '智能客服', product: '机器人', direction: '横版展示' },
    ])
  })

  it('选产品时方向为空（由尺寸推导），选产品线时产品与方向都为空', () => {
    expect(resolvePostprocessProjectTargets(threeLevelTree(), ['product-a'])[0]).toMatchObject({
      line: '智能客服',
      product: '机器人',
      direction: '',
    })
    expect(resolvePostprocessProjectTargets(threeLevelTree(), ['line-a'])[0]).toMatchObject({
      line: '智能客服',
      product: '',
      direction: '',
    })
  })

  it('用户自建更深层级时取「根 / 第二级 / 叶」', () => {
    const collections = [...threeLevelTree(), collection('deep', '临时投放', 'direction-a', 0)]
    const targets = resolvePostprocessProjectTargets(collections, ['deep'])
    expect(targets[0]).toMatchObject({ line: '智能客服', product: '机器人', direction: '临时投放' })
  })

  it('保留勾选顺序、去重，跳过不存在与回收站节点', () => {
    const collections = threeLevelTree()
    collections[4].trashedAt = Date.now()
    const targets = resolvePostprocessProjectTargets(collections, [
      'line-b',
      'line-a',
      'line-b',
      'ghost',
      '  ',
      'line-b',
    ])
    expect(targets.map((target) => target.collectionId)).toEqual(['line-a'])
  })
})

describe('findMissingProjectCollectionIds', () => {
  it('列出不存在或已在回收站的勾选', () => {
    const collections = threeLevelTree()
    collections[0].trashedAt = Date.now()
    expect(findMissingProjectCollectionIds(collections, ['line-a', 'product-a', 'ghost'])).toEqual(['line-a', 'ghost'])
  })
})
