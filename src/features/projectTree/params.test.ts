import { describe, expect, it } from 'vitest'
import { DEFAULT_POSTPROCESS_DISTRIBUTION } from '../../lib/postprocessDistribution'
import { resolvePostprocessOutputDirs, type PostprocessMediaConfig } from '../../lib/postprocessMedia'
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
  resolveNodeWatermarkBindingsByMedia,
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
    mediaOutputDirs: {},
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

describe('byMedia —— 同一个方向在各渠道上不同', () => {
  const MEDIA = ['baidu', 'toutiao', 'gdt']

  it('命中渠道优先于本级通用值，未命中渠道回退通用值', () => {
    const params: ProjectNodeParamsMap = {
      [DIRECTION]: { postprocess: { outputDir: '通用目录', byMedia: { baidu: { outputDir: '百度目录' } } } },
    }
    expect(resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig(), 'baidu').config.outputDir).toBe(
      '百度目录',
    )
    expect(
      resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig(), 'toutiao').config.outputDir,
    ).toBe('通用目录')
    // 不传 mediaId（老调用点）→ 完全忽略 byMedia
    expect(resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig()).config.outputDir).toBe(
      '通用目录',
    )
  })

  it('父节点按渠道配的值能被整条线下的方向继承', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { byMedia: { baidu: { outputDir: '产品线-百度' } } } },
      [DIRECTION]: { postprocess: { byMedia: { toutiao: { outputDir: '方向-头条' } } } },
    }
    expect(resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig(), 'baidu').config.outputDir).toBe(
      '产品线-百度',
    )
    expect(
      resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig(), 'toutiao').config.outputDir,
    ).toBe('方向-头条')
  })

  it('渠道内 outputDir 空串 = 该渠道用默认输出位置，不能被通用值顶掉', () => {
    const params: ProjectNodeParamsMap = {
      [DIRECTION]: { postprocess: { outputDir: '通用目录', byMedia: { baidu: { outputDir: '' } } } },
    }
    expect(resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig(), 'baidu').config.outputDir).toBe(
      '',
    )
  })

  it('渠道内空数组 = 该渠道不加水印，且不牵连其他渠道', () => {
    const params: ProjectNodeParamsMap = {
      [DIRECTION]: {
        postprocess: {
          watermarkPresetIds: ['通用水印'],
          byMedia: { baidu: { watermarkPresetIds: [] }, toutiao: { watermarkPresetIds: ['头条水印'] } },
        },
      },
    }
    const presets = (mediaId: string) =>
      resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig(), mediaId).config.watermarkPresetIds
    expect(presets('baidu')).toEqual([])
    expect(presets('toutiao')).toEqual(['头条水印'])
    expect(presets('gdt')).toEqual(['通用水印'])
  })

  it('resolveNodeWatermarkBinding 按渠道解析，本级自定义的判定照旧', () => {
    const params: ProjectNodeParamsMap = {
      [DIRECTION]: { postprocess: { byMedia: { baidu: { watermarkPresetIds: ['百度水印'] } } } },
    }
    expect(resolveNodeWatermarkBinding(COLLECTIONS, params, DIRECTION, ['全局水印'], 'baidu')).toEqual({
      presetIds: ['百度水印'],
      sourcedFrom: DIRECTION,
      overridden: true,
    })
    // 这个渠道本节点没表态 → 跟随全局，不能算本级自定义
    expect(resolveNodeWatermarkBinding(COLLECTIONS, params, DIRECTION, ['全局水印'], 'gdt')).toEqual({
      presetIds: ['全局水印'],
      sourcedFrom: null,
      overridden: false,
    })
  })

  it('resolveNodeWatermarkBindingsByMedia 只回传与通用值不同的渠道', () => {
    const params: ProjectNodeParamsMap = {
      [DIRECTION]: {
        postprocess: {
          watermarkPresetIds: ['通用水印'],
          byMedia: {
            baidu: { watermarkPresetIds: ['百度水印'] },
            // 与通用值一致 —— 不该出现在列表里
            toutiao: { watermarkPresetIds: ['通用水印'] },
            // 只改了目录、没动水印 —— 同样不该出现
            gdt: { outputDir: '只改了目录' },
          },
        },
      },
    }
    expect(resolveNodeWatermarkBindingsByMedia(COLLECTIONS, params, DIRECTION, ['全局水印'], MEDIA)).toEqual([
      { mediaId: 'baidu', presetIds: ['百度水印'] },
    ])
  })

  it('归一化：空对象渠道被丢掉，预设去重去空，非字符串目录被剔除', () => {
    const normalized = normalizePostprocessNodeOverride({
      byMedia: {
        baidu: { outputDir: '百度目录', watermarkPresetIds: ['a', ' a ', '  ', 'b'] },
        toutiao: {},
        '   ': { outputDir: '空渠道名' },
        gdt: { outputDir: 123, watermarkPresetIds: '不是数组' },
      },
    })
    expect(normalized?.byMedia).toEqual({ baidu: { outputDir: '百度目录', watermarkPresetIds: ['a', 'b'] } })
  })

  it('归一化：一条有效字段都不剩时 byMedia 整个键消失，不留「已按渠道覆盖」的空壳', () => {
    expect(normalizePostprocessNodeOverride({ byMedia: { baidu: {} } })?.byMedia).toBeUndefined()
    expect(normalizePostprocessNodeOverride({ byMedia: [] })?.byMedia).toBeUndefined()
    expect(normalizePostprocessNodeOverride({ byMedia: 'baidu' })?.byMedia).toBeUndefined()
  })

  it('归一化后的参数表里 byMedia 能原样保留', () => {
    const result = normalizeProjectNodeParamsMap({
      [DIRECTION]: {
        postprocess: { byMedia: { baidu: { outputDir: '百度目录', watermarkPresetIds: [] } } },
        updatedAt: 7,
      },
    })
    expect(result[DIRECTION]?.postprocess?.byMedia).toEqual({
      baidu: { outputDir: '百度目录', watermarkPresetIds: [] },
    })
  })
})

describe('byMedia 的合并 —— 逐渠道，不是整份替换', () => {
  it('改百度不会把头条静默抹掉', () => {
    const current = { byMedia: { baidu: { outputDir: '百度' }, toutiao: { outputDir: '头条' } } }
    const merged = mergePostprocessNodeOverride(current, { byMedia: { baidu: { outputDir: '百度-新' } } })
    expect(merged?.byMedia).toEqual({ baidu: { outputDir: '百度-新' }, toutiao: { outputDir: '头条' } })
  })

  it('渠道内字段给 undefined 表示恢复继承：字段被删掉，渠道本身还在', () => {
    const current = { byMedia: { baidu: { outputDir: '百度', watermarkPresetIds: ['a'] } } }
    const merged = mergePostprocessNodeOverride(current, { byMedia: { baidu: { outputDir: undefined } } })
    expect(merged?.byMedia).toEqual({ baidu: { watermarkPresetIds: ['a'] } })
  })

  it('某渠道被清空时该渠道键消失，其余渠道保留', () => {
    const current = { byMedia: { baidu: { outputDir: '百度' }, toutiao: { outputDir: '头条' } } }
    const merged = mergePostprocessNodeOverride(current, { byMedia: { baidu: { outputDir: undefined } } })
    expect(merged?.byMedia).toEqual({ toutiao: { outputDir: '头条' } })
  })

  it('所有渠道都清空后 byMedia 键整份删除', () => {
    const current = { byMedia: { baidu: { outputDir: '百度' } } }
    expect(mergePostprocessNodeOverride(current, { byMedia: { baidu: { outputDir: undefined } } })).toBeUndefined()
  })

  it('byMedia: undefined 表示把「按渠道覆盖」整份恢复继承，其余字段不动', () => {
    const current = { byMedia: { baidu: { outputDir: '百度' } }, creator: '设计组' }
    expect(mergePostprocessNodeOverride(current, { byMedia: undefined })).toEqual({ creator: '设计组' })
  })
})

describe('byMedia 的两个导出位置（双写）', () => {
  it('节点渠道配两个位置：整条链解析后两个都在，且优先于节点通用值与全局渠道表', () => {
    const params: ProjectNodeParamsMap = {
      [DIRECTION]: {
        postprocess: {
          outputDir: '通用目录',
          byMedia: { baidu: { outputDirs: ['D:/百度一', 'D:/百度二'] } },
        },
      },
    }
    const global: PostprocessMediaConfig = {
      ...baseConfig(),
      outputDir: '全局默认目录',
      mediaOutputDirs: { baidu: ['D:/全局百度'] },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, global, 'baidu')
    expect(resolvePostprocessOutputDirs(slice.config, 'baidu')).toEqual(['D:/百度一', 'D:/百度二'])
    // 层级：节点渠道 → 节点通用 → 全局渠道 → 全局默认。节点写了通用目录，其余渠道就用它
    expect(resolvePostprocessOutputDirs(slice.config, 'toutiao')).toEqual(['通用目录'])

    // 层级：节点渠道 → 节点通用 → 全局渠道 → 全局默认。节点写了通用目录，其余渠道就用它
    expect(resolvePostprocessOutputDirs(slice.config, 'toutiao')).toEqual(['通用目录'])

    const noGeneralParams: ProjectNodeParamsMap = {
      [DIRECTION]: { postprocess: { byMedia: { baidu: { outputDirs: ['D:/百度一'] } } } },
    }
    const noGeneralFor = (mediaId: string) =>
      resolveProjectPostprocessSlice(COLLECTIONS, noGeneralParams, DIRECTION, global, mediaId)
    // 节点没写通用值时：命中的渠道用节点值，未命中的才轮到全局渠道表 → 再不行是全局默认目录
    expect(resolvePostprocessOutputDirs(noGeneralFor('baidu').config, 'baidu')).toEqual(['D:/百度一'])
    expect(resolvePostprocessOutputDirs(noGeneralFor('toutiao').config, 'toutiao')).toEqual(['全局默认目录'])
  })

  it('只有全局渠道表配了两个位置时，节点没表态的渠道照样双写', () => {
    const global: PostprocessMediaConfig = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/一', 'D:/二'] } }
    const slice = resolveProjectPostprocessSlice(
      COLLECTIONS,
      { [LINE]: { postprocess: { creator: '某某' } } },
      LINE,
      global,
      'baidu',
    )
    expect(resolvePostprocessOutputDirs(slice.config, 'baidu')).toEqual(['D:/一', 'D:/二'])
  })

  it('归一化保留 outputDirs（含旧单值字段并存）并截到两个', () => {
    const normalized = normalizePostprocessNodeOverride({
      byMedia: {
        baidu: { outputDir: '旧单值', outputDirs: ['D:/一', 'D:/二', 'D:/三'] },
        toutiao: { outputDirs: ['  ', '  '] },
      },
    })
    expect(normalized?.byMedia?.baidu).toEqual({ outputDir: '旧单值', outputDirs: ['D:/一', 'D:/二'] })
    // 全是空串 → 归一化成空数组，语义是**显式**「用默认输出位置」（区别于「没表态」的键缺失）
    expect(normalized?.byMedia?.toutiao).toEqual({ outputDirs: [] })
  })

  it('合并时写入第二个位置不会清掉第一个（逐槽更新）', () => {
    const first = buildProjectNodeParams(undefined, { byMedia: { baidu: { outputDirs: ['D:/一'] } } })
    const second = buildProjectNodeParams(first ?? undefined, {
      byMedia: { baidu: { outputDirs: ['D:/一', 'D:/二'] } },
    })
    expect(second?.postprocess?.byMedia?.baidu).toEqual({ outputDirs: ['D:/一', 'D:/二'] })
  })

  it('参数表整份归一化后两个位置仍能读出', () => {
    const map = normalizeProjectNodeParamsMap({
      [DIRECTION]: { postprocess: { byMedia: { baidu: { outputDirs: ['D:/一', 'D:/二'] } } } },
    })
    expect(map[DIRECTION]?.postprocess?.byMedia?.baidu?.outputDirs).toEqual(['D:/一', 'D:/二'])
  })
})
