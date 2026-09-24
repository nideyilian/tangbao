/**
 * 「产出目标方向」解析的口径（按产出方向拆分的**键**）。
 *
 * 为什么这套口径要单独锁住（2026-09-23）：后处理拆成「每个方向一条独立 run」之后，
 * 这个判断同时被两处使用 —— 编排层据此分组排队，素材库按钮据此判断「我选中的素材涉及的
 * 方向是不是在跑」。任一处独自漂移，症状都是「按钮说能跑、点下去什么都没产」，
 * 而界面上看不出原因。
 *
 * 2026-09-24 追加一条更硬的边界：产出目标改成**按文件夹各存一份**，取用时沿
 * 「归属方向 → 祖先」向上找最近的一环。于是「别处设的那份会不会影响这一张图」必须逐条钉住 ——
 * 上一版的全局一份就是在这里失控的（给一个方向设完，全库都按它产）。
 */

import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../../types'
import type { PostprocessMediaConfig } from '../../lib/postprocessMedia'
import {
  collectTargetDirectionIds,
  collectTargetDirectionIdsFromOwnership,
  groupImageIdsByTargetDirection,
  resolveEffectiveSavedTargets,
  resolveImageTargetDirectionIds,
} from './directionTargets'

type ConfigSlice = Pick<
  PostprocessMediaConfig,
  'savedTargetCollectionIds' | 'savedTargetsByFolder' | 'selectedCollectionIds'
>

function config(overrides: Partial<ConfigSlice> = {}): ConfigSlice {
  return { savedTargetCollectionIds: [], savedTargetsByFolder: {}, selectedCollectionIds: [], ...overrides }
}

function collection(id: string, name: string, parentId: string | null = null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 0, updatedAt: 0 }
}

/**
 * 两条产品线各带方向，用来验「跨产品设目标」与「沿树向上继承」：
 * `产品A → 方向A1 / 方向A2`、`产品B → 方向B1`。
 */
const TREE = [
  collection('prod-a', '产品A'),
  collection('dir-a1', '方向A1', 'prod-a', 0),
  collection('dir-a2', '方向A2', 'prod-a', 1),
  collection('prod-b', '产品B'),
  collection('dir-b1', '方向B1', 'prod-b', 0),
]

function ownership(entries: Array<[string, string | null]>): Map<string, string | null> {
  return new Map(entries)
}

/** 单张图、手动触发的一般形态，只让用例说清「哪张图归谁、配置长什么样」。 */
function resolveManual(
  imageId: string,
  ownedDirectionId: string | null,
  configSlice: ConfigSlice,
  collections?: AssetCollection[],
) {
  return resolveImageTargetDirectionIds(imageId, {
    imageIds: [imageId],
    ownership: ownership([[imageId, ownedDirectionId]]),
    source: 'manual',
    config: configSlice,
    collections,
  })
}

describe('后处理产出目标方向解析', () => {
  it('有归属：目标就是归属方向本身（执行时无需手动选项目）', () => {
    const targets = resolveImageTargetDirectionIds('image-a', {
      imageIds: ['image-a'],
      ownership: ownership([['image-a', '方向A']]),
      source: 'auto',
      config: config({ selectedCollectionIds: ['方向A', '方向B'] }),
    })

    expect(targets).toEqual(['方向A'])
  })

  it('无归属：退回全局启用范围（手工拖入 / 旧数据）', () => {
    const targets = resolveImageTargetDirectionIds('image-x', {
      imageIds: ['image-x'],
      ownership: ownership([['image-x', null]]),
      source: 'auto',
      config: config({ selectedCollectionIds: ['方向A', '方向B'] }),
    })

    expect(targets).toEqual(['方向A', '方向B'])
  })

  it('⭐ 手动 + 归属方向设过：按它那份产出（可跨产品、跨方向）', () => {
    expect(
      resolveManual('image-a', 'dir-a1', config({ savedTargetsByFolder: { 'dir-a1': ['dir-b1', 'dir-a1'] } }), TREE),
    ).toEqual(['dir-b1', 'dir-a1'])
  })

  it('⭐ 在「产品」层设的一份，被它下面所有方向继承', () => {
    const saved = config({ savedTargetsByFolder: { 'prod-a': ['dir-b1'] } })

    expect(resolveManual('image-a', 'dir-a1', saved, TREE)).toEqual(['dir-b1'])
    expect(resolveManual('image-b', 'dir-a2', saved, TREE)).toEqual(['dir-b1'])
  })

  it('越具体越优先：自己设过就不再往上看', () => {
    const saved = config({ savedTargetsByFolder: { 'prod-a': ['dir-b1'], 'dir-a1': ['dir-a2'] } })

    expect(resolveManual('image-a', 'dir-a1', saved, TREE)).toEqual(['dir-a2'])
    // 同一个产品下的另一条方向没自己设，仍拿产品层那份
    expect(resolveManual('image-b', 'dir-a2', saved, TREE)).toEqual(['dir-b1'])
  })

  it('链上一份都没设 → 按归属方向自身产出（老行为）', () => {
    const saved = config({ savedTargetsByFolder: { 'prod-b': ['dir-b1'] } })

    expect(resolveManual('image-a', 'dir-a1', saved, TREE)).toEqual(['dir-a1'])
  })

  it('⭐ 兜底那份（素材库不在具体文件夹里时设的）不影响有归属的图', () => {
    // 这一条是 2026-09-24 报障的根因：上一版只有这一份，于是「设一个方向 → 全库都变」。
    const saved = config({ savedTargetCollectionIds: ['dir-b1'], savedTargetsByFolder: {} })

    expect(resolveManual('image-a', 'dir-a1', saved, TREE)).toEqual(['dir-a1'])
  })

  it('无归属：兜底那份优先于全局启用范围', () => {
    const saved = config({ savedTargetCollectionIds: ['dir-b1'], selectedCollectionIds: ['dir-a1'] })

    expect(resolveManual('image-x', null, saved, TREE)).toEqual(['dir-b1'])
  })

  it('⭐ 自动触发不读「记住的产出目标」——两份都不读（只管手动点的那一次）', () => {
    const saved = config({
      savedTargetCollectionIds: ['dir-b1'],
      savedTargetsByFolder: { 'dir-a1': ['dir-b1'] },
      selectedCollectionIds: ['dir-a1'],
    })

    const targets = resolveImageTargetDirectionIds('image-a', {
      imageIds: ['image-a'],
      ownership: ownership([['image-a', 'dir-a1']]),
      source: 'auto',
      config: saved,
      collections: TREE,
    })

    expect(targets).toEqual(['dir-a1'])
  })

  it('不传项目树时只认该方向自己那一份（不向上继承）', () => {
    const saved = config({ savedTargetsByFolder: { 'prod-a': ['dir-b1'] } })

    expect(resolveManual('image-a', 'dir-a1', saved)).toEqual(['dir-a1'])
    expect(resolveManual('image-a', 'dir-a1', config({ savedTargetsByFolder: { 'dir-a1': ['dir-b1'] } }))).toEqual([
      'dir-b1',
    ])
  })

  it('分组：一张图投两个方向就进两个桶，同一方向的多张图聚在一起且保序', () => {
    const groups = groupImageIdsByTargetDirection({
      imageIds: ['image-a', 'image-b', 'image-c'],
      ownership: ownership([
        ['image-a', '方向A'],
        ['image-b', '方向B'],
        ['image-c', '方向A'],
      ]),
      source: 'auto',
      config: config(),
    })

    expect([...groups.keys()]).toEqual(['方向A', '方向B'])
    expect(groups.get('方向A')).toEqual(['image-a', 'image-c'])
    expect(groups.get('方向B')).toEqual(['image-b'])
  })

  it('手动记住两个方向 → 同一张图同时进两个桶（每个方向一条 run 各产一次）', () => {
    const groups = groupImageIdsByTargetDirection({
      imageIds: ['image-a'],
      ownership: ownership([['image-a', 'dir-a1']]),
      source: 'manual',
      config: config({ savedTargetsByFolder: { 'dir-a1': ['dir-a2', 'dir-b1'] } }),
      collections: TREE,
    })

    expect([...groups.keys()]).toEqual(['dir-a2', 'dir-b1'])
    expect(groups.get('dir-a2')).toEqual(['image-a'])
    expect(groups.get('dir-b1')).toEqual(['image-a'])
  })

  it('界面入口（只有归属这一列数据）与编排层算出同一个集合', () => {
    const saved = config({ selectedCollectionIds: ['方向Z'] })
    const collections = TREE

    const fromOwnership = collectTargetDirectionIdsFromOwnership(['dir-a1', null, 'dir-a1'], 'auto', saved, collections)
    const fromGroups = collectTargetDirectionIds({
      imageIds: ['a', 'b', 'c'],
      ownership: ownership([
        ['a', 'dir-a1'],
        ['b', null],
        ['c', 'dir-a1'],
      ]),
      source: 'auto',
      config: saved,
      collections,
    })

    expect(fromOwnership).toEqual(fromGroups)
    expect(fromOwnership).toEqual(['dir-a1', '方向Z'])
  })

  it('空配置 / 空输入不炸也不产出悬空方向', () => {
    expect(collectTargetDirectionIdsFromOwnership([null], 'auto', config())).toEqual([])
    expect(
      groupImageIdsByTargetDirection({
        imageIds: [''],
        ownership: ownership([['', null]]),
        source: 'manual',
        config: config(),
      }).size,
    ).toBe(0)
  })
})

describe('当前生效的产出目标（界面按它显示 / 执行体按它取）', () => {
  it('返回生效清单与它的落点：自己设的就报自己', () => {
    const saved = config({ savedTargetsByFolder: { 'dir-a1': ['dir-b1'] } })

    expect(resolveEffectiveSavedTargets(saved, 'dir-a1', TREE)).toEqual({ ids: ['dir-b1'], ownerId: 'dir-a1' })
  })

  it('继承来的要报出「落在谁身上」——界面靠它提示「继承自某层」', () => {
    const saved = config({ savedTargetsByFolder: { 'prod-a': ['dir-b1'] } })

    expect(resolveEffectiveSavedTargets(saved, 'dir-a1', TREE)).toEqual({ ids: ['dir-b1'], ownerId: 'prod-a' })
  })

  it('一份都没设 / 不在具体文件夹里：空清单且无落点', () => {
    const saved = config({ savedTargetsByFolder: { 'prod-b': ['dir-b1'] } })

    expect(resolveEffectiveSavedTargets(saved, 'dir-a1', TREE)).toEqual({ ids: [], ownerId: null })
    expect(resolveEffectiveSavedTargets(saved, null, TREE)).toEqual({ ids: [], ownerId: null })
  })
})
