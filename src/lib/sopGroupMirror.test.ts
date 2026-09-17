import { describe, expect, it } from 'vitest'
import type { SopGroup } from '../features/strategy/types'
import type { AssetCollection } from '../types'
import {
  applySopGroupMirrorPlan,
  buildSopGroupMirrorPlan,
  getMirrorGroupId,
  type SopGroupMirrorPlan,
} from './sopGroupMirror'

function collection(
  id: string,
  name: string,
  parentId: string | null = null,
  trashedAt: number | null = null,
): AssetCollection {
  return {
    id,
    name,
    normalizedName: name.toLocaleLowerCase('zh-CN'),
    parentId,
    order: 0,
    trashedAt,
    createdAt: 1,
    updatedAt: 1,
  }
}

/** 模拟把镜像计划写进 SOP 库后的分组列表（保持插入顺序）。 */
function applyTo(groups: SopGroup[], plan: SopGroupMirrorPlan): SopGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  applySopGroupMirrorPlan(plan, { saveGroup: (group) => byId.set(group.id, group) })
  return [...byId.values()]
}

describe('项目文件夹树 → SOP 分组树镜像', () => {
  it('按项目层级建出分组树，父分组 id 逐级串联', () => {
    const collections = [collection('c1', 'APP-拉新'), collection('c2', '快手', 'c1'), collection('c3', '网赚', 'c2')]

    const plan = buildSopGroupMirrorPlan(collections, [])

    expect(plan.created).toBe(3)
    const byCollectionId = new Map(plan.upserts.map((group) => [group.collectionId, group]))
    expect(byCollectionId.get('c1')).toMatchObject({
      id: getMirrorGroupId('c1'),
      name: 'APP-拉新',
      parentId: null,
    })
    expect(byCollectionId.get('c2')).toMatchObject({ name: '快手', parentId: getMirrorGroupId('c1') })
    expect(byCollectionId.get('c3')).toMatchObject({ name: '网赚', parentId: getMirrorGroupId('c2') })
  })

  it('幂等：写入后再算一次没有任何变更', () => {
    const collections = [collection('c1', 'APP-拉新'), collection('c2', '快手', 'c1')]

    const first = buildSopGroupMirrorPlan(collections, [])
    const groups = applyTo([], first)
    const second = buildSopGroupMirrorPlan(collections, groups)

    expect(first.created).toBe(2)
    expect(second.upserts).toEqual([])
  })

  it('文件夹改名 / 移动后同步到对应分组', () => {
    const collections = [collection('c1', 'APP-拉新'), collection('c2', '快手', 'c1')]
    const groups = applyTo([], buildSopGroupMirrorPlan(collections, []))

    const renamed = [collection('c1', 'APP-拉新线'), collection('c2', '快手极速版', 'c1')]
    const plan = buildSopGroupMirrorPlan(renamed, groups)

    expect(plan.created).toBe(0)
    expect(plan.upserts).toHaveLength(2)
    expect(plan.upserts.find((group) => group.collectionId === 'c1')?.name).toBe('APP-拉新线')
    expect(plan.upserts.find((group) => group.collectionId === 'c2')?.name).toBe('快手极速版')
  })

  it('文件夹移到另一个父级时，分组的 parentId 跟着变', () => {
    const collections = [collection('c1', 'A'), collection('c2', 'B'), collection('c3', '子', 'c1')]
    const groups = applyTo([], buildSopGroupMirrorPlan(collections, []))

    const moved = [collection('c1', 'A'), collection('c2', 'B'), collection('c3', '子', 'c2')]
    const plan = buildSopGroupMirrorPlan(moved, groups)

    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0]).toMatchObject({ collectionId: 'c3', parentId: getMirrorGroupId('c2') })
  })

  it('根级同名分组被认领绑定，不产生第二份同名兄弟', () => {
    const groups: SopGroup[] = [{ id: 'sop-group-general', name: '通用 SOP', createdAt: 1, updatedAt: 1 }]

    const plan = buildSopGroupMirrorPlan([collection('c1', '通用 SOP')], groups)

    expect(plan.created).toBe(0)
    expect(plan.claimed).toBe(1)
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0]).toMatchObject({ id: 'sop-group-general', collectionId: 'c1', parentId: null })
  })

  it('非根层级的同名分组不被认领（避免误绑到别人的子分组）', () => {
    const groups: SopGroup[] = [{ id: 'g1', name: '子分组', parentId: 'g0', createdAt: 1, updatedAt: 1 }]

    const plan = buildSopGroupMirrorPlan([collection('c1', '子分组')], groups)

    expect(plan.claimed).toBe(0)
    expect(plan.created).toBe(1)
  })

  it('文件夹进回收站：不再参与镜像，既有分组与其中的 SOP 原样保留', () => {
    const live = [collection('c1', 'A'), collection('c2', 'B', 'c1'), collection('c3', 'C', 'c2')]
    const groups = applyTo([], buildSopGroupMirrorPlan(live, []))

    // c3 被移入回收站：镜像结果应保持不变（不新增、也不删除 c3 对应的分组）
    const withTrashed = [collection('c1', 'A'), collection('c2', 'B', 'c1'), collection('c3', 'C', 'c2', 999)]
    const plan = buildSopGroupMirrorPlan(withTrashed, groups)

    expect(plan.upserts).toEqual([])
    expect(groups.map((group) => group.collectionId)).toEqual(['c1', 'c2', 'c3'])
  })

  it('父文件夹进回收站时整棵子树跳过，不擅自新建孤立分组', () => {
    const plan = buildSopGroupMirrorPlan([collection('c1', 'A', null, 999), collection('c2', 'B', 'c1')], [])

    expect(plan.upserts).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('用户自建、未绑定文件夹的分组始终不受影响', () => {
    const groups: SopGroup[] = [{ id: 'user-group', name: '我的分组', parentId: null, createdAt: 1, updatedAt: 1 }]

    const plan = buildSopGroupMirrorPlan([collection('c1', '项目')], groups)

    expect(plan.upserts.map((group) => group.id)).toEqual([getMirrorGroupId('c1')])
    expect(groups).toHaveLength(1)
  })

  it('项目树为空时不做任何事（避免误清空）', () => {
    const groups: SopGroup[] = [{ id: 'g1', name: 'A', createdAt: 1, updatedAt: 1 }]

    const plan = buildSopGroupMirrorPlan([], groups)

    expect(plan.upserts).toEqual([])
    expect(plan.skipped).toBe(0)
  })
})
