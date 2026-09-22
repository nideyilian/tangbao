import { describe, expect, it } from 'vitest'
import { DEFAULT_POSTPROCESS_DISTRIBUTION } from '../../lib/postprocessDistribution'
import { resolvePostprocessOutputDirs, type PostprocessMediaConfig } from '../../lib/postprocessMedia'
import type { AssetCollection } from '../../types'
import {
  buildProjectNodeParams,
  collectPromotedNodeFieldValues,
  hasLegacyNodeOnlyFields,
  listProductNodes,
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
import { mergePromotedGlobals } from './storeProjectTreeParams'
import type { PromotedNodeFieldValues } from './params'
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
    savedTargetCollectionIds: [],
    direction: null,
    fitMode: 'crop-fill',
    outputDir: '',
    mediaOutputDirs: {},
    namePattern: '{line}-{product}-{direction}-{seq}',
    creator: '',
    watermarkPresetIds: [],
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
      [LINE]: { postprocess: { watermarkPresetIds: ['preset-line'], outputDir: 'D:/投放' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.watermarkPresetIds).toEqual(['preset-line'])
    expect(slice.config.outputDir).toBe('D:/投放')
    expect(slice.sourcedFrom).toBe(LINE)
    expect(slice.sourcedDepth).toBe(0)
  })

  it('中间层只覆盖自己声明的字段，其余仍继承自上层', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetIds: ['preset-line'], outputDir: 'D:/投放' } },
      [PRODUCT]: { postprocess: { outputDir: 'D:/产品级' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.outputDir).toBe('D:/产品级')
    expect(slice.config.watermarkPresetIds).toEqual(['preset-line'])
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

  it('⭐ selectedMediaIds 同样沿链继承（ADR-0013）：本级优先，空数组是「一个渠道都不投」', () => {
    // ① 谁都没表态 → 用全局基线
    const base = baseConfig()
    expect(resolveProjectPostprocessSlice(COLLECTIONS, {}, DIRECTION, base).config.selectedMediaIds).toEqual(['clean'])

    // ② 产品线写了 → 方向继承它
    const line = { [LINE]: { postprocess: { selectedMediaIds: ['baidu'] } } }
    expect(resolveProjectPostprocessSlice(COLLECTIONS, line, DIRECTION, base).config.selectedMediaIds).toEqual([
      'baidu',
    ])

    // ③ 方向自己写了 → 方向优先
    const both = { ...line, [DIRECTION]: { postprocess: { selectedMediaIds: ['toutiao'] } } }
    expect(resolveProjectPostprocessSlice(COLLECTIONS, both, DIRECTION, base).config.selectedMediaIds).toEqual([
      'toutiao',
    ])

    // ④ 空数组是**有效值**（这个方向一个渠道都不投），要能压掉上层 —— 当成「没表态」就错了
    const empty = { ...line, [DIRECTION]: { postprocess: { selectedMediaIds: [] } } }
    expect(resolveProjectPostprocessSlice(COLLECTIONS, empty, DIRECTION, base).config.selectedMediaIds).toEqual([])
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
      { ghost: { postprocess: { outputDir: 'D:/幽灵' } } },
      'ghost',
      baseConfig(),
    )
    expect(slice.config.outputDir).toBe('')
    expect(slice.sourcedFrom).toBeNull()
  })

  it('不修改传入的基线配置（纯函数）', () => {
    const base = baseConfig()
    resolveProjectPostprocessSlice(
      COLLECTIONS,
      { [LINE]: { postprocess: { outputDir: 'D:/改掉了' } } },
      DIRECTION,
      base,
    )
    expect(base.outputDir).toBe('')
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
      good: { postprocess: { outputDir: 'D:/投放' } },
      badId: { postprocess: null },
      '': { postprocess: { outputDir: 'D:/空 id' } },
      notObject: 42,
    })
    expect(Object.keys(result)).toEqual(['good'])
    expect(result.good.postprocess?.outputDir).toBe('D:/投放')
  })

  it('⭐ 收窄后：节点上已收归全局的字段被丢弃（ADR-0011）', () => {
    // 这四者移到了全局层，节点上再写也不再被读取 —— 只有 `collectPromotedNodeFieldValues`
    // 会在 normalize **之前**把它们接住（R-63 的迁移），这里验证「读不回来」
    const result = normalizeProjectNodeParamsMap({
      node: {
        postprocess: {
          namePattern: '{product}-{seq}',
          creator: '设计组',
          autoCompanionClean: false,
          distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION, enabled: true },
        },
      },
    })
    expect(result.node).toBeUndefined()
  })

  it('收窄后：节点上的 direction 仍被丢弃（画面方向不给手选口子）', () => {
    expect(normalizeProjectNodeParamsMap({ node: { postprocess: { direction: 'landscape' } } }).node).toBeUndefined()
  })

  it('⭐ selectedMediaIds 回到节点层（ADR-0013）：照读，且空数组是有效值', () => {
    // 反过来钉住：ADR-0011 期间它被丢弃，ADR-0013 之后「这个方向投哪几个渠道」是方向级参数。
    // 这条用例原先断言的是「被丢弃」—— 谁改回去谁就会看到它变红。
    expect(
      normalizeProjectNodeParamsMap({ node: { postprocess: { selectedMediaIds: ['gdt'] } } }).node.postprocess,
    ).toEqual({ selectedMediaIds: ['gdt'] })
    // 空数组 = 显式「这个方向一个渠道都不投」，不能与「没表态」合并成同一个值
    expect(normalizeProjectNodeParamsMap({ node: { postprocess: { selectedMediaIds: [] } } }).node.postprocess).toEqual(
      { selectedMediaIds: [] },
    )
  })

  it('保留 null 语义（不带水印）与 enabled=false 语义', () => {
    const result = normalizeProjectNodeParamsMap({
      node: { postprocess: { watermarkPresetIds: [], enabled: false } },
    })
    expect(result.node.postprocess).toEqual({ watermarkPresetIds: [], enabled: false })
  })
})

describe('mergePostprocessNodeOverride', () => {
  it('undefined 的字段表示恢复继承（从记录里删除），空数组是有效值', () => {
    const merged = mergePostprocessNodeOverride(
      { outputDir: 'D:/投放', watermarkPresetIds: ['p1'] },
      { outputDir: undefined },
    )
    expect(merged).toEqual({ watermarkPresetIds: ['p1'] })

    const kept = mergePostprocessNodeOverride({ watermarkPresetIds: ['p1'] }, { watermarkPresetIds: [] })
    expect(kept).toEqual({ watermarkPresetIds: [] })
  })

  it('字段被全部清空时返回 undefined', () => {
    expect(mergePostprocessNodeOverride({ outputDir: 'D:/投放' }, { outputDir: undefined })).toBeUndefined()
  })
})

describe('buildProjectNodeParams', () => {
  it('正常写入并带上时间戳', () => {
    const result = buildProjectNodeParams(undefined, { outputDir: 'D:/投放' }, 1234)
    expect(result).toEqual({ postprocess: { outputDir: 'D:/投放' }, updatedAt: 1234 })
  })

  it('覆盖被清空时返回 null，由调用方删除该键（避免留下「已配置」的空壳）', () => {
    expect(buildProjectNodeParams({ postprocess: { outputDir: 'D:/投放' } }, { outputDir: undefined })).toBeNull()
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
    expect(normalizePostprocessNodeOverride({ outputDir: 'D:/投放' })?.watermarkPresetIds).toBeUndefined()
  })
})

describe('分发配置已收归全局（ADR-0011）—— 节点上不再可覆盖', () => {
  it('⭐ 节点写 distribution 会被归一化丢弃', () => {
    const normalized = normalizePostprocessNodeOverride({
      distribution: { enabled: true, startDate: '20260901', days: 7, mode: 'delete', renameMode: 'uuid' },
    })
    // 整条记录没有任何可保留字段 → undefined（不再是「保留一份整份配置」）
    expect(normalized).toBeUndefined()
  })

  it('⭐ 语义变化前：node.creator 会压掉全局值；收窄后沿用到全局基线', () => {
    const chain: ProjectNodeParamsMap = {
      [DIRECTION]: { postprocess: { outputDir: 'D:/方向' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, chain, DIRECTION, baseConfig())
    // 分发固定取全局基线的值，节点层无法再改
    expect(slice.config.distribution).toEqual(baseConfig().distribution)
    expect(slice.config.outputDir).toBe('D:/方向')
  })
})

describe('resolveProjectOverrideChain —— 共用的继承链', () => {
  it('只收写了参数的节点，根在前、自身在最后', () => {
    const chain: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { outputDir: 'D:/整条线' } },
      [DIRECTION]: { postprocess: { watermarkPresetIds: ['p-dir'] } },
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
    expect(resolveProjectOverrideChain([], { [LINE]: { postprocess: { outputDir: 'D:/x' } } }, DIRECTION)).toEqual([])
  })

  it('链上参数与全字段合并在同一个字段上给出同一个来源', () => {
    const chain: ProjectNodeParamsMap = {
      [PRODUCT]: { postprocess: { outputDir: 'D:/中间层' } },
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
      [DIRECTION]: { postprocess: { outputDir: 'D:/只改了别的字段' } },
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
    const current = { byMedia: { baidu: { outputDir: '百度' } }, outputDir: 'D:/投放' }
    expect(mergePostprocessNodeOverride(current, { byMedia: undefined })).toEqual({ outputDir: 'D:/投放' })
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
      { [LINE]: { postprocess: { enabled: true } } },
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

describe('R-63 迁移：节点上已收归全局的旧值必须被接住（ADR-0011）', () => {
  const LEGACY_PAYLOAD = {
    [DIRECTION]: {
      postprocess: {
        creator: '方向级创作者',
        namePattern: '{product}-{seq}',
        autoCompanionClean: false,
        distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION, enabled: true, days: 30 },
      },
    },
  }

  it('hasLegacyNodeOnlyFields：认得出旧数据里的残留字段', () => {
    expect(hasLegacyNodeOnlyFields(LEGACY_PAYLOAD)).toBe(true)
    // 已经迁干净的（只剩保留字段）不算残留
    expect(hasLegacyNodeOnlyFields({ x: { postprocess: { outputDir: 'D:/a' } } })).toBe(false)
    // 坏形状不抛错
    expect(hasLegacyNodeOnlyFields(null)).toBe(false)
    expect(hasLegacyNodeOnlyFields(42)).toBe(false)
  })

  it('⭐ collectPromotedNodeFieldValues：把节点上的旧值提升出来，不让它消失', () => {
    const promoted = collectPromotedNodeFieldValues(LEGACY_PAYLOAD)
    expect(promoted.creator).toBe('方向级创作者')
    expect(promoted.namePattern).toBe('{product}-{seq}')
    expect(promoted.distribution?.days).toBe(30)
  })

  it('⭐ 必须吃原始数据 —— 归一化结果里这些字段已经没了', () => {
    const normalized = normalizeProjectNodeParamsMap(LEGACY_PAYLOAD)
    // 归一化把整条记录丢了（没有可保留字段），所以从它里面收集只能是空
    expect(normalized[DIRECTION]).toBeUndefined()
    expect(collectPromotedNodeFieldValues(normalized)).toEqual({})
  })

  it('多个节点都写过同一字段时，按 collectionId 稳定取一个（结果可复现）', () => {
    const payload = {
      'zzz-node': { postprocess: { creator: 'Z' } },
      'aaa-node': { postprocess: { creator: 'A' } },
    }
    expect(collectPromotedNodeFieldValues(payload).creator).toBe('A')
    // 键顺序换了也要拿到同一个
    expect(
      collectPromotedNodeFieldValues({ 'aaa-node': payload['aaa-node'], 'zzz-node': payload['zzz-node'] }).creator,
    ).toBe('A')
  })

  it('没有任何残留时返回空对象（调用方据此跳过迁移）', () => {
    expect(collectPromotedNodeFieldValues({ x: { postprocess: { outputDir: 'D:/a' } } })).toEqual({})
  })

  it('⭐ mergePromotedGlobals：只补空缺，基线已有值时以基线为准', () => {
    const baseline: PromotedNodeFieldValues = { namePattern: '{line}-{seq}', creator: '' }
    const promoted: PromotedNodeFieldValues = {
      namePattern: '{product}-{seq}',
      creator: '迁移来的',
      distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION, enabled: true, days: 30 },
    }
    const merged = mergePromotedGlobals(baseline, promoted)
    // 基线已有 namePattern → 不被迁移值覆盖
    expect(merged.namePattern).toBe('{line}-{seq}')
    // 基线 creator 是空串（= 没设过）→ 迁移值补上
    expect(merged.creator).toBe('迁移来的')
    // 基线没这个字段（对象缺席）→ 迁移值补上
    expect(merged.distribution?.days).toBe(30)
  })

  it('空迁移值不改变基线', () => {
    const baseline: PromotedNodeFieldValues = { namePattern: 'x', creator: 'y' }
    expect(mergePromotedGlobals(baseline, {})).toEqual(baseline)
  })
})

describe('listProductNodes —— 跨产品动作的候选清单', () => {
  const tree: AssetCollection[] = [
    collection('line-a', '保险'),
    collection('product-1', '百万医疗险', 'line-a'),
    collection('direction-1', '月亮', 'product-1'),
    collection('line-b', '电商'),
    collection('product-2', 'QQ阅读', 'line-b'),
  ]

  it('只列第二级的产品，带它所属产品线', () => {
    expect(listProductNodes(tree)).toEqual([
      { id: 'product-1', name: '百万医疗险', lineId: 'line-a', lineName: '保险' },
      { id: 'product-2', name: 'QQ阅读', lineId: 'line-b', lineName: '电商' },
    ])
  })

  it('产品线与方向都不是候选（水印是产品的资产）', () => {
    const ids = listProductNodes(tree).map((node) => node.id)
    expect(ids).not.toContain('line-a')
    expect(ids).not.toContain('direction-1')
  })

  it('回收站里的产品不算候选，它所在产品线被删时也不算（复制过去用户看不见）', () => {
    const trashed: AssetCollection[] = [
      collection('line-a', '保险'),
      { ...collection('product-1', '百万医疗险', 'line-a'), trashedAt: 99 },
      { ...collection('line-b', '电商'), trashedAt: 99 },
      collection('product-2', 'QQ阅读', 'line-b'),
    ]
    expect(listProductNodes(trashed)).toEqual([])
  })

  it('根级节点（没有产品线）不算产品', () => {
    expect(listProductNodes([collection('orphan', '孤儿节点')])).toEqual([])
  })
})
