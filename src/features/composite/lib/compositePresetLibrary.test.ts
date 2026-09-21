import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'
import {
  buildCopiedPresetName,
  filterPresetsByQuery,
  parsePresetDragPayload,
  planPresetCopies,
  serializePresetDragPayload,
} from './compositePresetLibrary'
import type { CompositeV2Preset } from './compositeV2Types'

function preset(id: string, name: string, updatedAt = 1): CompositeV2Preset {
  return { ...createDefaultCompositeV2Preset(updatedAt), id, name, updatedAt }
}

describe('水印库筛选', () => {
  const presets = [preset('a', '夏季促销角标'), preset('b', '品牌 LOGO'), preset('c', '简约角标')]

  it('没有搜索词时原样返回，顺序不动', () => {
    expect(filterPresetsByQuery(presets, '')).toBe(presets)
    expect(filterPresetsByQuery(presets, undefined)).toBe(presets)
  })

  it('按名称匹配，忽略大小写与首尾空格', () => {
    expect(filterPresetsByQuery(presets, ' logo ').map((item) => item.id)).toEqual(['b'])
    expect(filterPresetsByQuery(presets, '角标').map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('不因为「刚编辑过」而重排顺序', () => {
    // 原实现无搜索词时按 updatedAt 重排，于是每次编辑完一个预设它在列表里就跳一次位，
    // 用户刚记住的位置会跑掉。
    const edited = [preset('a', '甲', 1), preset('b', '乙', 999), preset('c', '丙', 5)]
    expect(filterPresetsByQuery(edited, '').map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('不修改调用方传入的数组', () => {
    const input = [...presets]
    filterPresetsByQuery(input, '角标')
    expect(input.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('搜不到时返回空数组而不是原列表', () => {
    expect(filterPresetsByQuery(presets, '不存在的名字')).toEqual([])
  })
})

describe('拖拽载荷', () => {
  it('多选时带上整批 id，顺序即绑定顺序', () => {
    expect(parsePresetDragPayload(serializePresetDragPayload(['a', 'b', 'c']))).toEqual(['a', 'b', 'c'])
  })

  it('兼容单个裸 id 的载荷', () => {
    expect(parsePresetDragPayload('preset-1')).toEqual(['preset-1'])
  })

  it('空白与坏 JSON 都解析成空数组，不抛错', () => {
    expect(parsePresetDragPayload('')).toEqual([])
    expect(parsePresetDragPayload('   ')).toEqual([])
    expect(parsePresetDragPayload('[not json')).toEqual([])
    expect(parsePresetDragPayload('{"a":1}')).toEqual([])
  })

  it('过滤掉数组里的非字符串与空项，不把脏数据带进绑定', () => {
    expect(parsePresetDragPayload('["a",1,null,"","b"]')).toEqual(['a', 'b'])
  })

  it('序列化时丢掉空 id', () => {
    expect(parsePresetDragPayload(serializePresetDragPayload(['a', '  ', 'b']))).toEqual(['a', 'b'])
  })
})

describe('跨产品复制水印', () => {
  const source = { ...preset('w1', '合规头部'), productId: 'p-a' }
  const other = { ...preset('w2', '角标'), productId: 'p-b' }

  function plan(overrides: Partial<Parameters<typeof planPresetCopies>[0]> = {}) {
    let seed = 0
    return planPresetCopies({
      presets: [source, other],
      presetIds: ['w1'],
      targetProductId: 'p-b',
      makeId: () => `copy-${(seed += 1)}`,
      now: 1000,
      ...overrides,
    })
  }

  it('名称默认加「副本」，只与**目标产品**里的名字比（源产品的同名不算冲突）', () => {
    expect(buildCopiedPresetName('合规头部', [])).toBe('合规头部 副本')
    // 源产品里已经有「合规头部 副本」时，复制到没有它的产品不该被迫改名
    expect(buildCopiedPresetName('合规头部', ['合规头部 副本', '别的'])).toBe('合规头部 副本 2')
    expect(buildCopiedPresetName('合规头部', ['合规头部 副本', '合规头部 副本 2'])).toBe('合规头部 副本 3')

    // 源自己就是一套副本时不去猜「尾部的副本要不要替换」：统一在原名后追加，名字可预测，
    // 重名规避交给序号那一步
    const copies = plan({ presets: [{ ...source, name: '合规头部 副本' }, other] })
    expect(copies[0].name).toBe('合规头部 副本 副本')
  })

  it('复制 = 新的一套：换 id、改归属、内容整套带走', () => {
    const [copy] = plan()
    expect(copy.id).toBe('copy-1')
    expect(copy.productId).toBe('p-b')
    expect(copy.name).toBe('合规头部 副本')
    expect(copy.updatedAt).toBe(1000)
    expect(copy.baseCanvas).toEqual(source.baseCanvas)
    expect(copy.layers).toEqual(source.layers)
  })

  it('同产品不复制（那是原地再建一套，交给 duplicatePreset）', () => {
    expect(plan({ targetProductId: 'p-a' })).toEqual([])
  })

  it('空目标产品 / 不存在的 id / 重复 id 都按规则处理，不抛错', () => {
    expect(plan({ targetProductId: '' })).toEqual([])
    expect(plan({ presetIds: ['不存在'] })).toEqual([])
    expect(plan({ presetIds: ['w1', 'w1'] }).map((item) => item.id)).toEqual(['copy-1'])
  })

  it('一次复制多套时互不撞名，且不改入参', () => {
    const presets = [source, { ...preset('w3', '合规头部'), productId: 'p-a' }, other]
    const copies = plan({ presets, presetIds: ['w1', 'w3'] })
    expect(copies.map((item) => item.name)).toEqual(['合规头部 副本', '合规头部 副本 2'])
    expect(presets.map((item) => item.id)).toEqual(['w1', 'w3', 'w2'])
  })
})
