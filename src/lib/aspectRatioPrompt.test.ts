import { describe, expect, it } from 'vitest'
import { withAspectRatioPrompt } from './aspectRatioPrompt'

describe('withAspectRatioPrompt', () => {
  it('空提示词时直接给出比例，不带前导逗号', () => {
    expect(withAspectRatioPrompt('', '16:9')).toBe('画面比例为:16:9')
    expect(withAspectRatioPrompt('   ', '1:1')).toBe('画面比例为:1:1')
  })

  it('已有提示词时追加到末尾', () => {
    expect(withAspectRatioPrompt('一只猫', '9:16')).toBe('一只猫，画面比例为:9:16')
  })

  it('已存在比例时替换而不是重复追加', () => {
    expect(withAspectRatioPrompt('一只猫，画面比例为:1:1', '16:9')).toBe('一只猫，画面比例为:16:9')
  })

  it('未选择尺寸（ratio 为空）时只摘掉旧约束，不留空片段', () => {
    expect(withAspectRatioPrompt('一只猫，画面比例为:16:9', '')).toBe('一只猫')
    expect(withAspectRatioPrompt('一只猫', '')).toBe('一只猫')
  })

  it('摘得掉没有值的脏尾巴（历史数据里可能残留 `画面比例为:`）', () => {
    expect(withAspectRatioPrompt('一只猫，画面比例为:', '16:9')).toBe('一只猫，画面比例为:16:9')
    expect(withAspectRatioPrompt('一只猫，画面比例为:', '')).toBe('一只猫')
  })

  it('多层堆积的旧片段会被一次清理干净', () => {
    expect(withAspectRatioPrompt('一只猫，画面比例为:1:1，画面比例为:4:3', '16:9')).toBe('一只猫，画面比例为:16:9')
  })

  it('容错尾部的标点与空白', () => {
    expect(withAspectRatioPrompt('一只猫。画面比例为:16:9  ', '1:1')).toBe('一只猫，画面比例为:1:1')
    expect(withAspectRatioPrompt('一只猫，画面比例为 : 16:9', '1:1')).toBe('一只猫，画面比例为:1:1')
  })

  it('不改动提示词中间出现的同类文字（只约束末尾）', () => {
    expect(withAspectRatioPrompt('画面比例为:1:1 的猫', '16:9')).toBe('画面比例为:1:1 的猫，画面比例为:16:9')
  })
})
