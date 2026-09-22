import { describe, expect, it } from 'vitest'
import {
  applyIdentifierToText,
  buildIdentifierLayer,
  createDefaultIdentifier,
  getIdentifierSignature,
  hasRenderableTextLayer,
  isIdentifierEnabled,
  isVerticalText,
  layerWantsIdentifier,
  normalizeIdentifier,
  resolveIdentifierLayer,
  resolveLayerText,
} from './compositeIdentifier'
import type { CompositeV2Preset, CompositeV2TextLayer } from './compositeV2Types'

function presetWithLayers(layers: CompositeV2Preset['layers']): CompositeV2Preset {
  return {
    id: 'p1',
    name: '测试水印',
    productId: '',
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

  it('⭐ 竖排文案（一个字一行）：标识符自己占一格，不与首字并排（2026-09-22 报障）', () => {
    // 现场：合规水印竖排成十几行，★ 贴在首行 → 画出来是「★该」并排，看着像 ★ 被排到了文案左边。
    // 竖排的「上/下」对应横排的「前/后」，所以标识符该**独占第一格**（= 文案上方）。
    const vertical = '该\n活\n动\n存\n在'
    expect(applyIdentifierToText(vertical, { text: '★', placement: 'prefix' })).toBe('★\n该\n活\n动\n存\n在')
    expect(applyIdentifierToText(vertical, { text: '★', placement: 'suffix' })).toBe('该\n活\n动\n存\n在\n★')
    expect(applyIdentifierToText(vertical, { text: '★', placement: 'both' })).toBe('★\n该\n活\n动\n存\n在\n★')
  })

  it('⭐ 横排一字不动：单行仍贴同一行、多行仍只贴整段首尾', () => {
    // 竖排改的是「怎么占格」，不是「贴不贴」——横排这两条必须原样（TB-094 刚修过这块的排版）
    expect(applyIdentifierToText('限时秒杀', { text: '★', placement: 'prefix' })).toBe('★限时秒杀')
    expect(applyIdentifierToText('第一行\n第二行', { text: '★', placement: 'both' })).toBe('★第一行\n第二行★')
  })

  it('竖排判据的边界：两行两字不算、含空行一律当横排、emoji 按字符数算', () => {
    expect(isVerticalText('该\n活')).toBe(true)
    // 横排文案不会每行只有一个字；「优惠\n限时」是正常的两行短文案，不能当竖排
    expect(isVerticalText('优惠\n限时')).toBe(false)
    // 空行的兜底方向：判成横排只是维持既有行为，判成竖排会让标识符凭空多占一格
    expect(isVerticalText('该\n\n活')).toBe(false)
    expect(isVerticalText('单行')).toBe(false)
    // emoji 是代理对（`'👍'.length === 2`），按码元数会把竖排判丢
    expect(isVerticalText('👍\n🎉')).toBe(true)
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

/**
 * 2026-09-22 杰哥的场景：一个水印里有**多段文案**时，标识是逐层贴的 ——
 * 连「卖点」那种不该带标识的文案也会被贴上。`withIdentifier: false` 就是给它的出口。
 */
describe('水印标识符 · 逐层开关（withIdentifier）', () => {
  const identifier = { text: '@小王', placement: 'suffix' as const }

  it('缺省 = 带标识（老数据一个字段都不用补）', () => {
    expect(layerWantsIdentifier({})).toBe(true)
    expect(layerWantsIdentifier({ withIdentifier: true })).toBe(true)
    expect(resolveLayerText({ text: '限时秒杀' }, identifier)).toBe('限时秒杀@小王')
  })

  it('⭐ 显式 false 的那一层不带标识：合规文案带、卖点不带', () => {
    expect(layerWantsIdentifier({ withIdentifier: false })).toBe(false)
    // 同一份标识配置下，两层结果不同 —— 这正是「多文案水印里挑一层带标识」的用法
    expect(resolveLayerText({ text: '本素材纯属广告创意' }, identifier)).toBe('本素材纯属广告创意@小王')
    expect(resolveLayerText({ text: '★投保条件0~70岁', withIdentifier: false }, identifier)).toBe('★投保条件0~70岁')
  })

  it('关掉标识只影响标识：文案本身（含多行）一个字不动', () => {
    const text = '第一行\n第二行'
    expect(resolveLayerText({ text, withIdentifier: false }, identifier)).toBe(text)
    // 开着时也只贴**整段**末行，不是逐行贴
    expect(resolveLayerText({ text }, identifier)).toBe('第一行\n第二行@小王')
  })

  it('标识本身没启用时，开关开不开都是原文', () => {
    expect(resolveLayerText({ text: '限时秒杀' }, createDefaultIdentifier())).toBe('限时秒杀')
    expect(resolveLayerText({ text: '限时秒杀', withIdentifier: false }, createDefaultIdentifier())).toBe('限时秒杀')
  })
})
