import { describe, expect, it } from 'vitest'
import {
  applyIdentifierToText,
  buildIdentifierLayer,
  createDefaultIdentifier,
  getIdentifierSignature,
  hasRenderableTextLayer,
  isIdentifierEnabled,
  normalizeIdentifier,
  resolveIdentifierLayer,
} from './compositeIdentifier'
import type { CompositeV2Preset, CompositeV2TextLayer } from './compositeV2Types'

function presetWithLayers(layers: CompositeV2Preset['layers']): CompositeV2Preset {
  return {
    id: 'p1',
    name: '测试水印',
    baseCanvas: { width: 1080, height: 1920 },
    sampleBackgroundPath: '',
    layers,
    updatedAt: 1,
  }
}

function textLayer(text: string, visible = true): CompositeV2TextLayer {
  return {
    id: 't1',
    type: 'text',
    name: 'Text Layer',
    visible,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { mode: 'free', x: 0, y: 0, width: 400, height: 100 },
    shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
    text,
    fontFamily: 'sans-serif',
    fontSize: 48,
    fontWeight: 700,
    color: '#000000',
    align: 'center',
    lineHeight: 1.1,
    letterSpacing: 0,
    padding: 5,
  }
}

describe('水印标识符 · 启停判定', () => {
  it('空文本 / 纯空格都不算启用（纯空格只会给水印多贴一对空白）', () => {
    expect(isIdentifierEnabled(createDefaultIdentifier())).toBe(false)
    expect(isIdentifierEnabled({ text: '   ', placement: 'suffix' })).toBe(false)
    expect(isIdentifierEnabled(null)).toBe(false)
  })

  it('带内容即启用，前后空格保留（用户可能就想要间隔）', () => {
    expect(isIdentifierEnabled({ text: ' @小王 ', placement: 'suffix' })).toBe(true)
  })

  it('归一化：位置非法退回结尾，文本缺失退回空串', () => {
    expect(normalizeIdentifier(null)).toEqual({ text: '', placement: 'suffix' })
    expect(normalizeIdentifier({ text: 'A', placement: 'nope' })).toEqual({ text: 'A', placement: 'suffix' })
    expect(normalizeIdentifier({ text: 'A', placement: 'both' })).toEqual({ text: 'A', placement: 'both' })
  })
})

describe('水印标识符 · 文案附加', () => {
  it('结尾：贴在文案最后', () => {
    expect(applyIdentifierToText('限时秒杀', { text: '@小王', placement: 'suffix' })).toBe('限时秒杀@小王')
  })

  it('开头：贴在文案最前', () => {
    expect(applyIdentifierToText('限时秒杀', { text: '@小王', placement: 'prefix' })).toBe('@小王限时秒杀')
  })

  it('两侧：首尾都贴', () => {
    expect(applyIdentifierToText('限时秒杀', { text: '@小王', placement: 'both' })).toBe('@小王限时秒杀@小王')
  })

  it('多行文案只贴整段的首尾，不逐行贴', () => {
    const result = applyIdentifierToText('第一行\n第二行', { text: '@小王', placement: 'both' })
    expect(result).toBe('@小王第一行\n第二行@小王')
  })

  it('未启用时原样返回', () => {
    expect(applyIdentifierToText('限时秒杀', createDefaultIdentifier())).toBe('限时秒杀')
  })
})

describe('水印标识符 · 无文字水印时的左下角图层', () => {
  it('预设里没有可出字的文字层 → 生成左下角一层', () => {
    const layer = resolveIdentifierLayer(presetWithLayers([]), { text: '@小王', placement: 'suffix' })
    expect(layer).not.toBeNull()
    expect(layer?.position).toMatchObject({ mode: 'anchor', anchor: 'bottom-left' })
    expect(layer?.text).toBe('@小王')
  })

  it('有可出字的文字层 → 不生成（那种情况走文案叠加）', () => {
    expect(
      resolveIdentifierLayer(presetWithLayers([textLayer('限时秒杀')]), { text: '@小王', placement: 'suffix' }),
    ).toBeNull()
  })

  it('隐藏的文字层不算「有文字」，空白文本也不算', () => {
    expect(hasRenderableTextLayer(presetWithLayers([textLayer('限时秒杀', false)]))).toBe(false)
    expect(hasRenderableTextLayer(presetWithLayers([textLayer('   ')]))).toBe(false)
    expect(hasRenderableTextLayer(presetWithLayers([textLayer('限时秒杀')]))).toBe(true)
  })

  it('字号按短边比例取，横竖版得到视觉一致的大小', () => {
    const portrait = buildIdentifierLayer(presetWithLayers([]), { text: '@小王', placement: 'suffix' })
    const landscape = buildIdentifierLayer(
      { ...presetWithLayers([]), baseCanvas: { width: 1920, height: 1080 } },
      { text: '@小王', placement: 'suffix' },
    )
    expect(portrait?.fontSize).toBe(landscape?.fontSize)
  })

  it('未启用时返回 null', () => {
    expect(buildIdentifierLayer(presetWithLayers([]), createDefaultIdentifier())).toBeNull()
  })
})

describe('水印标识符 · 缓存签名', () => {
  it('文本或位置任一变化都要换签名（否则改了不重画）', () => {
    const a = getIdentifierSignature({ text: '@小王', placement: 'suffix' })
    const b = getIdentifierSignature({ text: '@小王', placement: 'both' })
    const c = getIdentifierSignature({ text: '@小李', placement: 'suffix' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('未启用时是稳定值', () => {
    expect(getIdentifierSignature(createDefaultIdentifier())).toBe(getIdentifierSignature(null))
  })
})
