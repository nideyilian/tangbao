import { describe, expect, it } from 'vitest'
import { measureCompositeTextBox, wrapCompositeTextLine } from './compositeTextLayout'
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
})

/**
 * 折行：2026-09-22「部分文字被拉伸变形」的修复。
 *
 * 原先超宽的行直接交给 `fillText` 的第 4 参（maxWidth）——**那是横向压扁、不是换行**，
 * 于是带长标识符的那一层整段字被压成瘦字。折行只是多占一行，字的比例不变。
 */
describe('文字折行（wrapCompositeTextLine）', () => {
  const measure = (text: string) => [...text].length * 10

  it('放得下就原样一行', () => {
    expect(wrapCompositeTextLine('限时秒杀', 100, measure)).toEqual(['限时秒杀'])
  })

  it('⭐ 超宽时折行，且每行都不超过可用宽度', () => {
    const rows = wrapCompositeTextLine('本素材纯属广告创意', 50, measure)
    // 每行最多 5 字（5×10 = 50 正好放得下，第 6 字才换行）
    expect(rows).toEqual(['本素材纯属', '广告创意'])
    for (const row of rows) expect(measure(row)).toBeLessThanOrEqual(50)
  })

  it('⭐ 折行只切行、不改字：拼回去必须等于原文（防丢字 / 防变形）', () => {
    const text = '★投保条件0~70岁 | 大病小病均可保障(责任内)'
    expect(wrapCompositeTextLine(text, 60, measure).join('')).toBe(text)
  })

  it('空行与非法宽度都原样返回，调用方不必再分支', () => {
    expect(wrapCompositeTextLine('', 50, measure)).toEqual([''])
    expect(wrapCompositeTextLine('限时秒杀', 0, measure)).toEqual(['限时秒杀'])
  })

  it('单个字符就超宽时也不推出空行（否则那个字会被画到空气里）', () => {
    expect(wrapCompositeTextLine('宽宽宽', 5, measure)).toEqual(['宽', '宽', '宽'])
  })
})
