/**
 * 「产出目标方向」解析的口径（按产出方向拆分的**键**）。
 *
 * 为什么这套口径要单独锁住（2026-09-23）：后处理拆成「每个方向一条独立 run」之后，
 * 这个判断同时被两处使用 —— 编排层据此分组排队，素材库按钮据此判断「我选中的素材涉及的
 * 方向是不是在跑」。任一处独自漂移，症状都是「按钮说能跑、点下去什么都没产」，
 * 而界面上看不出原因。所以这里逐条钉住它，包括**自动触发不读「记住的产出目标」**这条
 * 杰哥明确要求过的边界。
 */

import { describe, expect, it } from 'vitest'
import type { PostprocessMediaConfig } from '../../lib/postprocessMedia'
import {
  collectTargetDirectionIds,
  collectTargetDirectionIdsFromOwnership,
  groupImageIdsByTargetDirection,
  resolveImageTargetDirectionIds,
} from './directionTargets'

type ConfigSlice = Pick<PostprocessMediaConfig, 'savedTargetCollectionIds' | 'selectedCollectionIds'>

function config(overrides: Partial<ConfigSlice> = {}): ConfigSlice {
  return { savedTargetCollectionIds: [], selectedCollectionIds: [], ...overrides }
}

function ownership(entries: Array<[string, string | null]>): Map<string, string | null> {
  return new Map(entries)
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

  it('⭐ 手动触发：记住的产出目标优先，可跨方向且与归属无关', () => {
    const targets = resolveImageTargetDirectionIds('image-a', {
      imageIds: ['image-a'],
      ownership: ownership([['image-a', '方向A']]),
      source: 'manual',
      config: config({ savedTargetCollectionIds: ['方向B', '方向C'], selectedCollectionIds: ['方向A'] }),
    })

    expect(targets).toEqual(['方向B', '方向C'])
  })

  it('⭐ 自动触发不读「记住的产出目标」——那份清单只管手动点的那一次', () => {
    const targets = resolveImageTargetDirectionIds('image-a', {
      imageIds: ['image-a'],
      ownership: ownership([['image-a', '方向A']]),
      source: 'auto',
      config: config({ savedTargetCollectionIds: ['方向B'], selectedCollectionIds: ['方向A'] }),
    })

    expect(targets).toEqual(['方向A'])
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

  it('同一张图手动记住两个方向 → 它同时进两个桶（每个方向一条 run 各产一次）', () => {
    const groups = groupImageIdsByTargetDirection({
      imageIds: ['image-a'],
      ownership: ownership([['image-a', '方向A']]),
      source: 'manual',
      config: config({ savedTargetCollectionIds: ['方向B', '方向C'] }),
    })

    expect([...groups.keys()]).toEqual(['方向B', '方向C'])
    expect(groups.get('方向B')).toEqual(['image-a'])
    expect(groups.get('方向C')).toEqual(['image-a'])
  })

  it('界面入口（只有归属这一列数据）与编排层算出同一个集合', () => {
    const fromOwnership = collectTargetDirectionIdsFromOwnership(
      ['方向A', null, '方向A'],
      'auto',
      config({ selectedCollectionIds: ['方向Z'] }),
    )
    const fromGroups = collectTargetDirectionIds({
      imageIds: ['a', 'b', 'c'],
      ownership: ownership([
        ['a', '方向A'],
        ['b', null],
        ['c', '方向A'],
      ]),
      source: 'auto',
      config: config({ selectedCollectionIds: ['方向Z'] }),
    })

    expect(fromOwnership).toEqual(fromGroups)
    expect(fromOwnership).toEqual(['方向A', '方向Z'])
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
