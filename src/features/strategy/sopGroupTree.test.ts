import { describe, expect, it } from 'vitest'
import type { SopGroup } from './types'
import {
  buildSopGroupTree,
  collectSopGroupDescendantIds,
  collectSopGroupSubtreeIds,
  flattenSopGroupTree,
  isSopGroupDetached,
} from './sopGroupTree'

function group(id: string, name: string, parentId: string | null = null, collectionId?: string): SopGroup {
  return { id, name, parentId, ...(collectionId ? { collectionId } : {}), createdAt: 1, updatedAt: 1 }
}

describe('SOP 分组树', () => {
  it('按 parentId 建树，兄弟顺序沿用分组数组顺序', () => {
    const tree = buildSopGroupTree([
      group('line', 'APP-拉新'),
      group('kuaishou', '快手', 'line'),
      group('xhs', '小红书', 'line'),
      group('wangzhuan', '网赚', 'kuaishou'),
      group('free', '通用 SOP'),
    ])

    expect(tree.map((node) => node.group.id)).toEqual(['line', 'free'])
    expect(tree[0].children.map((node) => node.group.id)).toEqual(['kuaishou', 'xhs'])
    expect(tree[0].children[0].children.map((node) => node.group.id)).toEqual(['wangzhuan'])
  })

  it('展平时折叠节点整棵子树跳过', () => {
    const tree = buildSopGroupTree([
      group('line', 'APP-拉新'),
      group('kuaishou', '快手', 'line'),
      group('wangzhuan', '网赚', 'kuaishou'),
    ])

    expect(flattenSopGroupTree(tree, new Set()).map((row) => [row.group.id, row.depth])).toEqual([
      ['line', 0],
      ['kuaishou', 1],
      ['wangzhuan', 2],
    ])
    expect(flattenSopGroupTree(tree, new Set(['kuaishou'])).map((row) => row.group.id)).toEqual(['line', 'kuaishou'])
    expect(flattenSopGroupTree(tree, new Set(['line'])).map((row) => row.group.id)).toEqual(['line'])
  })

  it('hasChildren 决定是否渲染展开箭头', () => {
    const tree = buildSopGroupTree([group('line', 'APP-拉新'), group('kuaishou', '快手', 'line')])

    expect(flattenSopGroupTree(tree, new Set()).map((row) => row.hasChildren)).toEqual([true, false])
  })

  it('父级缺失或成环时回落为根级，不会死循环', () => {
    const tree = buildSopGroupTree([group('a', 'A', 'missing'), group('b', 'B', 'c'), group('c', 'C', 'b')])

    expect(tree.map((node) => node.group.id).sort()).toEqual(['a', 'b', 'c'])
    expect(flattenSopGroupTree(tree, new Set())).toHaveLength(3)
  })

  it('收集子孙与子树 id，数据成环时自动截断', () => {
    const groups = [
      group('line', 'APP-拉新'),
      group('kuaishou', '快手', 'line'),
      group('wangzhuan', '网赚', 'kuaishou'),
      group('xhs', '小红书', 'line'),
    ]

    expect(collectSopGroupDescendantIds(groups, 'line').sort()).toEqual(['kuaishou', 'wangzhuan', 'xhs'])
    expect(collectSopGroupSubtreeIds(groups, 'kuaishou').sort()).toEqual(['kuaishou', 'wangzhuan'])
    expect(collectSopGroupSubtreeIds(groups, 'wangzhuan')).toEqual(['wangzhuan'])
  })

  it('可用 collectionId 判断分组是否已脱离项目文件夹', () => {
    const bound = group('g1', '快手', null, 'c1')
    const orphan = group('g2', '通用 SOP')

    expect(isSopGroupDetached(bound, new Set(['c1']))).toBe(false)
    expect(isSopGroupDetached(bound, new Set(['c2']))).toBe(true)
    expect(isSopGroupDetached(orphan, new Set())).toBe(false)
  })
})
