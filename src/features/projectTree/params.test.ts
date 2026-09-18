import { describe, expect, it } from 'vitest'
import { DEFAULT_POSTPROCESS_DISTRIBUTION } from '../../lib/postprocessDistribution'
import type { PostprocessMediaConfig } from '../../lib/postprocessMedia'
import type { AssetCollection } from '../../types'
import {
  buildProjectNodeParams,
  mergePostprocessNodeOverride,
  normalizePostprocessNodeOverride,
  normalizeProjectNodeParamsMap,
  pickDeepestCollectionId,
  resolveProjectNodeKind,
  resolveProjectNodePathNames,
  resolveNodeWatermarkBinding,
  resolveProjectOverrideChain,
  resolveProjectPostprocessSlice,
} from './params'
import type { ProjectNodeParamsMap } from './types'

function collection(id: string, name: string, parentId: string | null = null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 0, updatedAt: 0 }
}

/**
 * 保险 / 百万医疗险 / 月亮 —— 一棵最小三级树。
 * id 刻意用业务名而非 builtin-*，避免测试依赖内置结构（内置表会随业务调整）。
 */
const LINE = 'line-1'
const PRODUCT = 'product-1'
const DIRECTION = 'direction-1'
const COLLECTIONS: AssetCollection[] = [
  collection(LINE, '保险'),
  collection(PRODUCT, '百万医疗险', LINE),
  collection(DIRECTION, '月亮', PRODUCT),
]

function baseConfig(): PostprocessMediaConfig {
  return {
    media: [],
    selectedMediaIds: ['clean'],
    selectedCollectionIds: [],
    direction: null,
    outputDir: '',
    namePattern: '{line}-{product}-{direction}-{seq}',
    creator: '',
    watermarkPresetIds: [],
    autoCompanionClean: true,
    distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION },
  }
}

describe('resolveProjectNodeKind', () => {
  it('前三层分别是产品线 / 产品 / 方向，更深归为扩展层', () => {
    expect(resolveProjectNodeKind(0)).toBe('line')
    expect(resolveProjectNodeKind(1)).toBe('product')
    expect(resolveProjectNodeKind(2)).toBe('direction')
    expect(resolveProjectNodeKind(3)).toBe('extra')
  })
})

describe('resolveProjectNodePathNames', () => {
  it('按「根 / 第二级 / 叶」映射到 line / product / direction', () => {
    expect(resolveProjectNodePathNames(COLLECTIONS, DIRECTION)).toEqual({
      line: '保险',
      product: '百万医疗险',
      direction: '月亮',
    })
  })

  it('层级不足时缺的那段为空串，不报错', () => {
    expect(resolveProjectNodePathNames(COLLECTIONS, PRODUCT)).toEqual({
      line: '保险',
      product: '百万医疗险',
      direction: '',
    })
  })

  it('无归属时全为空串', () => {
    expect(resolveProjectNodePathNames(COLLECTIONS, null)).toEqual({ line: '', product: '', direction: '' })
  })
})

describe('resolveProjectPostprocessSlice —— 逐级继承', () => {
  it('没有任何覆盖时沿用全局默认，并标记无来源', () => {
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, {}, DIRECTION, baseConfig())
    expect(slice.config.namePattern).toBe('{line}-{product}-{direction}-{seq}')
    expect(slice.enabled).toBe(true)
    expect(slice.sourcedFrom).toBeNull()
    expect(slice.sourcedDepth).toBe(-1)
  })

  it('产品线上配一次，整条线下的方向都继承到', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['preset-line'], creator: '设计组' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.watermarkPresetIds).toEqual(['preset-line'])
    expect(slice.config.creator).toBe('设计组')
    expect(slice.sourcedFrom).toBe(LINE)
    expect(slice.sourcedDepth).toBe(0)
  })

  it('中间层只覆盖自己声明的字段，其余仍继承自上层', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['preset-line'], creator: '设计组' } },
      [PRODUCT]: { postprocess: { namePattern: '{product}-{seq}' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.namePattern).toBe('{product}-{seq}')
    expect(slice.config.watermarkPresetIds).toEqual(['preset-line'])
    expect(slice.config.creator).toBe('设计组')
    expect(slice.sourcedFrom).toBe(PRODUCT)
  })

  it('方向层优先级最高', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['preset-line'] } },
      [DIRECTION]: { postprocess: { watermarkPresetIds: ['preset-direction'] } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.watermarkPresetIds).toEqual(['preset-direction'])
    expect(slice.sourcedDepth).toBe(2)
  })

  it('watermarkPresetIds: [] 是「显式不带水印」，能压掉上层的非空值；undefined 才是继承', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['preset-line'] } },
      [DIRECTION]: { postprocess: { watermarkPresetIds: [] } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.watermarkPresetIds).toEqual([])

    // 对照：同一位置给 undefined（等价于不写该字段）应当继续继承
    const inherit = resolveProjectPostprocessSlice(
      COLLECTIONS,
      { [LINE]: { postprocess: { watermarkPresetIds: ['preset-line'] } }, [DIRECTION]: { postprocess: {} } },
      DIRECTION,
      baseConfig(),
    )
    expect(inherit.config.watermarkPresetIds).toEqual(['preset-line'])
  })

  it('enabled 取链上最深一次显式声明，而不是「任一父级关掉就全关」', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { enabled: false } },
      [DIRECTION]: { postprocess: { enabled: true } },
    }
    expect(resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig()).enabled).toBe(true)
    expect(
      resolveProjectPostprocessSlice(
        COLLECTIONS,
        { [LINE]: { postprocess: { enabled: false } } },
        DIRECTION,
        baseConfig(),
      ).enabled,
    ).toBe(false)
  })

  it('节点不存在时不抛错，退回全局默认', () => {
    const slice = resolveProjectPostprocessSlice(
      COLLECTIONS,
      { ghost: { postprocess: { creator: 'x' } } },
      'ghost',
      baseConfig(),
    )
    expect(slice.config.creator).toBe('')
    expect(slice.sourcedFrom).toBeNull()
  })

  it('不修改传入的基线配置（纯函数）', () => {
    const base = baseConfig()
    resolveProjectPostprocessSlice(COLLECTIONS, { [LINE]: { postprocess: { creator: '改掉了' } } }, DIRECTION, base)
    expect(base.creator).toBe('')
  })
})

describe('pickDeepestCollectionId —— 图片归属方向的选取', () => {
  it('同时挂在产品线与方向上时取更深的那个（自动归档是追加而非替换）', () => {
    expect(pickDeepestCollectionId(COLLECTIONS, [LINE, DIRECTION])).toBe(DIRECTION)
    expect(pickDeepestCollectionId(COLLECTIONS, [DIRECTION, LINE])).toBe(DIRECTION)
  })

  it('忽略已删除 / 不存在的 id', () => {
    expect(pickDeepestCollectionId(COLLECTIONS, ['ghost', LINE])).toBe(LINE)
  })

  it('全部无效或为空时返回 null（调用方按「无归属」退回全局默认）', () => {
    expect(pickDeepestCollectionId(COLLECTIONS, ['ghost'])).toBeNull()
    expect(pickDeepestCollectionId(COLLECTIONS, [])).toBeNull()
  })

  it('单个归属直接返回它本身', () => {
    expect(pickDeepestCollectionId(COLLECTIONS, [PRODUCT])).toBe(PRODUCT)
  })
})

describe('normalizeProjectNodeParamsMap', () => {
  it('丢弃坏条目，保留合法条目（不整份回退）', () => {
    const result = normalizeProjectNodeParamsMap({
      good: { postprocess: { creator: '设计组' } },
      badId: { postprocess: null },
      '': { postprocess: { creator: '空 id' } },
      notObject: 42,
    })
    expect(Object.keys(result)).toEqual(['good'])
    expect(result.good.postprocess?.creator).toBe('设计组')
  })

  it('剔除非法枚举与非字符串字段', () => {
    const result = normalizeProjectNodeParamsMap({
      node: { postprocess: { direction: 'diagonal', creator: 123, autoCompanionClean: 'yes' } },
    })
    expect(result.node).toBeUndefined()
  })

  it('保留 null 语义（不带水印）与 false 语义', () => {
    const result = normalizeProjectNodeParamsMap({
      node: { postprocess: { watermarkPresetIds: [], autoCompanionClean: false } },
    })
    expect(result.node.postprocess).toEqual({ watermarkPresetIds: [], autoCompanionClean: false })
  })

  it('去除 selectedMediaIds 里的空串与重复项', () => {
    const result = normalizeProjectNodeParamsMap({
      node: { postprocess: { selectedMediaIds: ['clean', ' ', 'clean', 'gdt'] } },
    })
    expect(result.node.postprocess?.selectedMediaIds).toEqual(['clean', 'gdt'])
  })
})

describe('mergePostprocessNodeOverride', () => {
  it('undefined 的字段表示恢复继承（从记录里删除），null 是有效值', () => {
    const merged = mergePostprocessNodeOverride(
      { creator: '设计组', watermarkPresetIds: ['p1'] },
      { creator: undefined },
    )
    expect(merged).toEqual({ watermarkPresetIds: ['p1'] })

    const kept = mergePostprocessNodeOverride({ watermarkPresetIds: ['p1'] }, { watermarkPresetIds: [] })
    expect(kept).toEqual({ watermarkPresetIds: [] })
  })

  it('字段被全部清空时返回 undefined', () => {
    expect(mergePostprocessNodeOverride({ creator: '设计组' }, { creator: undefined })).toBeUndefined()
  })
})

describe('buildProjectNodeParams', () => {
  it('正常写入并带上时间戳', () => {
    const result = buildProjectNodeParams(undefined, { creator: '设计组' }, 1234)
    expect(result).toEqual({ postprocess: { creator: '设计组' }, updatedAt: 1234 })
  })

  it('覆盖被清空时返回 null，由调用方删除该键（避免留下「已配置」的空壳）', () => {
    expect(buildProjectNodeParams({ postprocess: { creator: '设计组' } }, { creator: undefined })).toBeNull()
  })
})

describe('normalizePostprocessNodeOverride —— 水印预设多值与旧字段迁移', () => {
  it('数组照收：空数组是「显式不加水印」，与「没表态」区分开', () => {
    expect(normalizePostprocessNodeOverride({ watermarkPresetIds: ['a', 'b'] })?.watermarkPresetIds).toEqual(['a', 'b'])
    expect(normalizePostprocessNodeOverride({ watermarkPresetIds: [] })?.watermarkPresetIds).toEqual([])
  })

  it('旧版单值字段迁移：字符串 → 单元素数组，null → 空数组', () => {
    expect(normalizePostprocessNodeOverride({ watermarkPresetId: 'a' })?.watermarkPresetIds).toEqual(['a'])
    expect(normalizePostprocessNodeOverride({ watermarkPresetId: null })?.watermarkPresetIds).toEqual([])
  })

  it('去重并丢掉空白项', () => {
    const normalized = normalizePostprocessNodeOverride({ watermarkPresetIds: ['a', ' a ', '  ', 'b'] })
    expect(normalized?.watermarkPresetIds).toEqual(['a', 'b'])
  })

  it('新旧字段都没有时该键不出现（保持「缺省 = 继承」）', () => {
    expect(normalizePostprocessNodeOverride({ creator: '设计组' })?.watermarkPresetIds).toBeUndefined()
  })
})

describe('节点分发配置 —— 整份替换而非逐字段继承', () => {
  it('归一化补齐缺失字段并挡住非法枚举值', () => {
    const normalized = normalizePostprocessNodeOverride({
      distribution: { enabled: true, startDate: '20260901', days: 7, mode: 'delete', renameMode: 'uuid' },
    })
    expect(normalized?.distribution?.mode).toBe('copy')
    expect(normalized?.distribution?.renameMode).toBe('date')
    expect(normalized?.distribution?.skipWeekends).toBe(false)
  })

  it('方向级整份替换上层，不把两者的字段混起来', () => {
    const chain: ProjectNodeParamsMap = {
      [LINE]: {
        postprocess: {
          distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION, enabled: true, startDate: '20260901', days: 30 },
        },
      },
      [DIRECTION]: {
        postprocess: {
          distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION, enabled: true, startDate: '20261201', days: 3 },
        },
      },
    }

    const slice = resolveProjectPostprocessSlice(COLLECTIONS, chain, DIRECTION, baseConfig())

    // 天数取的是方向级的 3 而不是产品线的 30：排期由两者共同决定，混着继承会拼出推理不出的组合
    expect(slice.config.distribution.startDate).toBe('20261201')
    expect(slice.config.distribution.days).toBe(3)
  })

  it('没写 distribution 的节点沿用上层值', () => {
    const chain: ProjectNodeParamsMap = {
      [LINE]: {
        postprocess: { distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION, enabled: true, startDate: '20260901' } },
      },
      [DIRECTION]: { postprocess: { creator: '设计组' } },
    }

    const slice = resolveProjectPostprocessSlice(COLLECTIONS, chain, DIRECTION, baseConfig())
    expect(slice.config.distribution.startDate).toBe('20260901')
  })

  it('传 undefined 可把本级分发摘掉，恢复继承', () => {
    const current = {
      postprocess: { distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION, enabled: true, days: 5 } },
    }
    expect(mergePostprocessNodeOverride(current.postprocess, { distribution: undefined })).toBeUndefined()
  })
})

describe('resolveProjectOverrideChain —— 共用的继承链', () => {
  it('只收写了参数的节点，根在前、自身在最后', () => {
    const chain: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { creator: '整条线' } },
      [DIRECTION]: { postprocess: { namePattern: '{seq}' } },
      // PRODUCT 没配 → 不出现在链上
    }
    expect(resolveProjectOverrideChain(COLLECTIONS, chain, DIRECTION).map((entry) => entry.collectionId)).toEqual([
      LINE,
      DIRECTION,
    ])
    expect(resolveProjectOverrideChain(COLLECTIONS, chain, DIRECTION).map((entry) => entry.depth)).toEqual([0, 2])
  })

  it('无归属（null）与空参数都返回空链，不抛错', () => {
    expect(resolveProjectOverrideChain(COLLECTIONS, {}, null)).toEqual([])
    expect(resolveProjectOverrideChain(COLLECTIONS, {}, DIRECTION)).toEqual([])
    expect(resolveProjectOverrideChain([], { [LINE]: { postprocess: { creator: 'x' } } }, DIRECTION)).toEqual([])
  })

  it('链上参数与全字段合并在同一个字段上给出同一个来源', () => {
    const chain: ProjectNodeParamsMap = {
      [PRODUCT]: { postprocess: { creator: '中间层' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, chain, DIRECTION, baseConfig())
    const last = resolveProjectOverrideChain(COLLECTIONS, chain, DIRECTION).at(-1)
    expect(last?.collectionId).toBe(slice.sourcedFrom)
  })
})

describe('resolveNodeWatermarkBinding —— 某方向到底用哪些水印', () => {
  const GLOBAL = ['global-a']

  it('没有任何覆盖时取全局默认，并标记为「跟随全局」', () => {
    expect(resolveNodeWatermarkBinding(COLLECTIONS, {}, DIRECTION, GLOBAL)).toEqual({
      presetIds: GLOBAL,
      sourcedFrom: null,
      overridden: false,
    })
  })

  it('在产品线上配一次，整条线下的方向都继承到（来源指向产品线，不算本级）', () => {
    const chain: ProjectNodeParamsMap = { [LINE]: { postprocess: { watermarkPresetIds: ['line-w'] } } }
    expect(resolveNodeWatermarkBinding(COLLECTIONS, chain, DIRECTION, GLOBAL)).toEqual({
      presetIds: ['line-w'],
      sourcedFrom: LINE,
      overridden: false,
    })
  })

  it('方向自己配的压掉上层，来源是它自己', () => {
    const chain: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['line-w'] } },
      [DIRECTION]: { postprocess: { watermarkPresetIds: ['dir-w'] } },
    }
    expect(resolveNodeWatermarkBinding(COLLECTIONS, chain, DIRECTION, GLOBAL)).toEqual({
      presetIds: ['dir-w'],
      sourcedFrom: DIRECTION,
      overridden: true,
    })
  })

  it('空数组是「显式不加水印」，能压掉上层的非空值；undefined 才是继承', () => {
    const explicitEmpty: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['line-w'] } },
      [DIRECTION]: { postprocess: { watermarkPresetIds: [] } },
    }
    expect(resolveNodeWatermarkBinding(COLLECTIONS, explicitEmpty, DIRECTION, GLOBAL).presetIds).toEqual([])

    const inherit: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['line-w'] } },
      [DIRECTION]: { postprocess: { creator: '只改了别的字段' } },
    }
    expect(resolveNodeWatermarkBinding(COLLECTIONS, inherit, DIRECTION, GLOBAL).presetIds).toEqual(['line-w'])
  })

  it('方向显式写空数组时仍算「本级自定义」（界面上要能显示成可恢复继承）', () => {
    const chain: ProjectNodeParamsMap = { [DIRECTION]: { postprocess: { watermarkPresetIds: [] } } }
    const binding = resolveNodeWatermarkBinding(COLLECTIONS, chain, DIRECTION, GLOBAL)
    expect(binding.presetIds).toEqual([])
    expect(binding.overridden).toBe(true)
  })

  it('无归属（collectionId 为 null）时不能误判成本级自定义', () => {
    // 两边都是 null，若写成 sourcedFrom === collectionId 就会误判
    expect(resolveNodeWatermarkBinding(COLLECTIONS, {}, null, GLOBAL)).toEqual({
      presetIds: GLOBAL,
      sourcedFrom: null,
      overridden: false,
    })
  })

  it('节点不存在或已删除时退回全局默认，不抛错', () => {
    const chain: ProjectNodeParamsMap = { [LINE]: { postprocess: { watermarkPresetIds: ['line-w'] } } }
    expect(resolveNodeWatermarkBinding(COLLECTIONS, chain, 'missing-id', GLOBAL).presetIds).toEqual(GLOBAL)
  })

  it('不修改传入的全局数组（纯函数）', () => {
    const global = ['a', 'b']
    const chain: ProjectNodeParamsMap = { [DIRECTION]: { postprocess: { watermarkPresetIds: ['c'] } } }
    resolveNodeWatermarkBinding(COLLECTIONS, chain, DIRECTION, global)
    expect(global).toEqual(['a', 'b'])
  })
})
