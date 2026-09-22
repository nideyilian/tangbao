import { describe, expect, it } from 'vitest'
import { measureCompositeTextBox } from './compositeTextLayout'
import type { CompositeV2TextLayer } from './compositeV2Types'

function textLayer(patch: Partial<CompositeV2TextLayer> = {}): CompositeV2TextLayer {
  return {
    id: 'text-a',
    type: 'text',
    name: 'Text Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { mode: 'free', x: 0, y: 0, width: 1, height: 1 },
    shadow: { enabled: false, color: '#000000', x: 0, y: 0, blur: 0, opacity: 0 },
    text: 'AB',
    fontFamily: 'sans-serif',
    fontSize: 20,
    fontWeight: 400,
    color: '#000000',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    padding: 5,
    stroke: { enabled: false, color: '#000000', width: 0 },
    ...patch,
  }
}

describe('composite text layout', () => {
  it('sizes a single line from measured width and padding', () => {
    expect(measureCompositeTextBox(textLayer(), () => 20)).toEqual({
      width: 30,
      height: 34,
    })
  })

  it('uses the longest line, line count, letter spacing, and padding', () => {
    const layer = textLayer({
      text: 'ABC\nD',
      letterSpacing: 2,
      padding: 6,
    })

    expect(measureCompositeTextBox(layer, (line) => line.length * 10)).toEqual({
      width: 46,
      height: 60,
    })
  })

  it('⭐ 竖排：框与横排逐项对调（宽 = 列数 × 列距、高 = 最长列的字长和）', () => {
    // 竖排的框必须「窄而高」：否则锚点按横排那种宽框定位，字列会跑到画面外
    const layer = textLayer({ text: 'ABCDEF', orientation: 'vertical', padding: 5 })
    // 宽 = 1 列 × 20 × 1.2 + 10 = 34；高 = 6 字 × 20 + 10 = 130
    expect(measureCompositeTextBox(layer, (line) => line.length * 10)).toEqual({ width: 34, height: 130 })
  })

  it('⭐ 竖排 +「一字一行」的老写法：折成一段再算（否则算成 3 列 × 1 字）', () => {
    // 没有方向参数之前，用户只能一个字敲一个换行 —— 那是竖排的另一种写法，不是三列
    const layer = textLayer({ text: 'A\nB\nC', orientation: 'vertical', padding: 5 })
    expect(measureCompositeTextBox(layer, (line) => line.length * 10)).toEqual({ width: 34, height: 70 })
  })

  it('竖排 + 正常换行 = 换列：宽随列数增加，高取最长那列', () => {
    const layer = textLayer({ text: 'AB\nCD', orientation: 'vertical', padding: 5 })
    expect(measureCompositeTextBox(layer, (line) => line.length * 10)).toEqual({ width: 58, height: 50 })
  })
})
