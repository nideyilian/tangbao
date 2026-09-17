import { describe, expect, it } from 'vitest'
import type { PostprocessMediaConfig } from '../../lib/postprocessMedia'
import type { AssetCollection } from '../../types'
import {
  buildProjectNodeParams,
  mergePostprocessNodeOverride,
  normalizeProjectNodeParamsMap,
  pickDeepestCollectionId,
  resolveProjectNodeKind,
  resolveProjectNodePathNames,
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
    watermarkPresetId: null,
    autoCompanionClean: true,
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
      [LINE]: { postprocess: { watermarkPresetId: 'preset-line', creator: '设计组' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.watermarkPresetId).toBe('preset-line')
    expect(slice.config.creator).toBe('设计组')
    expect(slice.sourcedFrom).toBe(LINE)
    expect(slice.sourcedDepth).toBe(0)
  })

  it('中间层只覆盖自己声明的字段，其余仍继承自上层', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetId: 'preset-line', creator: '设计组' } },
      [PRODUCT]: { postprocess: { namePattern: '{product}-{seq}' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.namePattern).toBe('{product}-{seq}')
    expect(slice.config.watermarkPresetId).toBe('preset-line')
    expect(slice.config.creator).toBe('设计组')
    expect(slice.sourcedFrom).toBe(PRODUCT)
  })

  it('方向层优先级最高', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetId: 'preset-line' } },
      [DIRECTION]: { postprocess: { watermarkPresetId: 'preset-direction' } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.watermarkPresetId).toBe('preset-direction')
    expect(slice.sourcedDepth).toBe(2)
  })

  it('watermarkPresetId: null 是「显式不带水印」，能压掉上层的非空值；undefined 才是继承', () => {
    const params: ProjectNodeParamsMap = {
      [LINE]: { postprocess: { watermarkPresetId: 'preset-line' } },
      [DIRECTION]: { postprocess: { watermarkPresetId: null } },
    }
    const slice = resolveProjectPostprocessSlice(COLLECTIONS, params, DIRECTION, baseConfig())
    expect(slice.config.watermarkPresetId).toBeNull()

    // 对照：同一位置给 undefined（等价于不写该字段）应当继续继承
    const inherit = resolveProjectPostprocessSlice(
      COLLECTIONS,
      { [LINE]: { postprocess: { watermarkPresetId: 'preset-line' } }, [DIRECTION]: { postprocess: {} } },
      DIRECTION,
      baseConfig(),
    )
    expect(inherit.config.watermarkPresetId).toBe('preset-line')
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
      node: { postprocess: { watermarkPresetId: null, autoCompanionClean: false } },
    })
    expect(result.node.postprocess).toEqual({ watermarkPresetId: null, autoCompanionClean: false })
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
    const merged = mergePostprocessNodeOverride({ creator: '设计组', watermarkPresetId: 'p1' }, { creator: undefined })
    expect(merged).toEqual({ watermarkPresetId: 'p1' })

    const kept = mergePostprocessNodeOverride({ watermarkPresetId: 'p1' }, { watermarkPresetId: null })
    expect(kept).toEqual({ watermarkPresetId: null })
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
