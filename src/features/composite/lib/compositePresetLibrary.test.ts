import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'
import { filterPresetsByQuery, parsePresetDragPayload, serializePresetDragPayload } from './compositePresetLibrary'
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
