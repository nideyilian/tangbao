/**
 * 配置包 v9 的契约。
 *
 * 这一组的重点不是"函数能跑"，而是四条**会静默丢固定资产**的规则：
 * ① 节点参数必须跟着树走（此前根本没进包）；② 没分配到产品的水印不能丢；
 * ③ 水印库的**库级**那半（LOGO 列表与顺序、标识符、水印全局适配）也要进包 ——
 * 删掉并排的 `compositeState` 之后，它没有第二个来源；
 * ④ 导出 → 导入之后，每个节点的字段要**逐个对得上**（只断"恢复了几条"是测不出丢字段的）。
 */

import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../types'
import type { CompositeV2Preset } from '../features/composite/lib/compositeV2Types'
import type { ProjectNodeParams } from '../features/projectTree/types'
import { createDefaultPostprocessMediaConfig } from '../storePostprocessMedia'
import {
  buildTreeConfigBundle,
  collectTreeConfigPresets,
  flattenTreeConfigNodes,
  toAssetCollections,
  toCompositeV2State,
  toNodeParams,
  toPostprocessMediaConfig,
  validateTreeConfigBundle,
} from './treeConfigBundle'

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    parentId,
    order,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function preset(id: string, productId?: string): CompositeV2Preset {
  return {
    id,
    name: id,
    ...(productId ? { productId } : {}),
    baseCanvas: { width: 100, height: 100 },
    sampleBackgroundPath: '',
    layers: [],
    updatedAt: 1,
  }
}

/** 一棵够用的树：产品线 → 两个产品 → 各带方向；外加一个自建扩展层与一个回收站节点。 */
const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '能力中心APP', null, 0),
  collection('product-a', '快手', 'line-a', 0),
  collection('product-b', '百度', 'line-a', 1),
  collection('direction-a1', '网赚', 'product-a', 0),
  collection('direction-a2', '萌宠', 'product-a', 1),
  collection('direction-b1', '短剧', 'product-b', 0),
  collection('extra-a1', '子方向', 'direction-b1', 0),
  { ...collection('trashed-a', '已删方向', 'product-a', 2), trashedAt: 123 },
]

const NODE_PARAMS: Record<string, ProjectNodeParams> = {
  'direction-a1': {
    postprocess: {
      enabled: false,
      selectedMediaIds: ['clean', 'gdt'],
      watermarkPresetIds: ['preset-1'],
      outputDir: '\\\\nas\\交付\\快手\\网赚',
      byMedia: { gatt: { outputDirs: ['D:/一', 'D:/二'] } },
    },
    updatedAt: 111,
  },
  'product-a': {
    postprocess: { watermarkPresetIds: ['preset-1', 'preset-2'] },
    updatedAt: 222,
  },
}

const PRESETS: CompositeV2Preset[] = [
  preset('preset-1', 'product-a'),
  preset('preset-2', 'product-a'),
  preset('preset-b', 'product-b'),
  preset('preset-orphan'),
  preset('preset-deleted-owner', 'product-已经不在了'),
]

/** 水印库的库级那半：v9 起它必须进包（不再有并排的 `compositeState` 兜着）。 */
const WATERMARK_LIBRARY = {
  logos: [{ id: 'logo-1', name: '品牌LOGO.png', assetId: 'asset-1' }],
  logoOrder: ['logo-1'],
  libraryPath: 'D:/LOGO库',
  globalFitMode: 'contain-blur' as const,
  identifier: { text: ' · @糖包', placement: 'suffix' as const },
  backgroundFolders: ['D:/背景'],
  recursiveBackgrounds: true,
}

function build() {
  return buildTreeConfigBundle({
    collections: COLLECTIONS,
    nodeParams: NODE_PARAMS,
    presets: PRESETS,
    watermarkLibrary: WATERMARK_LIBRARY,
    postprocess: {
      ...createDefaultPostprocessMediaConfig(),
      outputDir: '全局默认目录',
      namePattern: '{direction}-{seq}',
      selectedCollectionIds: ['direction-a1'],
    },
    appVersion: '0.3.2',
    exportedAt: '2026-09-22T00:00:00.000Z',
  })
}

describe('配置包 v9：以树为骨架', () => {
  it('文件头带类型与版本，回收站计数在里面（不是配置内容）', () => {
    const bundle = build()

    expect(bundle.format.kind).toBe('tangbao-config')
    expect(bundle.format.version).toBe(9)
    expect(bundle.format.exportedAt).toBe('2026-09-22T00:00:00.000Z')
    expect(bundle.format.appVersion).toBe('0.3.2')
    expect(bundle.format.skippedNodes).toBe(1)
  })

  it('第一层是树：产品线 → 产品 → 方向 → 自建扩展层，层级靠 children 嵌套', () => {
    const bundle = build()

    expect(bundle.tree.map((node) => node.id)).toEqual(['line-a'])
    const line = bundle.tree[0]
    expect(line.children.map((node) => node.id)).toEqual(['product-a', 'product-b'])
    expect(line.children[0].children.map((node) => node.id)).toEqual(['direction-a1', 'direction-a2'])
    // 第 4 层是自建节点，原样嵌在方向下面，不会被拍平或丢掉
    expect(line.children[1].children[0].children.map((node) => node.id)).toEqual(['extra-a1'])
  })

  it('⭐ 节点自己的参数跟着节点走（此前它根本没进包）', () => {
    const bundle = build()
    const directionA1 = bundle.tree[0].children[0].children[0]

    expect(directionA1.overrides).toMatchObject({
      enabled: false,
      selectedMediaIds: ['clean', 'gdt'],
      watermarkPresetIds: ['preset-1'],
      outputDir: '\\\\nas\\交付\\快手\\网赚',
      // 按渠道的细分覆盖要原样带着，它有嵌套层级，最容易被"浅拷贝"吃掉
      byMedia: { gatt: { outputDirs: ['D:/一', 'D:/二'] } },
    })
    expect(directionA1.updatedAt).toBe(111)
    // 产品线上没有任何覆盖 → 不写这个字段（写空对象会让"有没有配过"分不出来）
    expect(bundle.tree[0].overrides).toBeUndefined()
  })

  it('⭐ 水印库挂在它归属的产品下面', () => {
    const bundle = build()
    const [productA, productB] = bundle.tree[0].children

    expect(productA.watermarkPresets?.map((item) => item.id)).toEqual(['preset-1', 'preset-2'])
    expect(productB.watermarkPresets?.map((item) => item.id)).toEqual(['preset-b'])
    // 挂在产品下的水印不可以同时出现在"未分配"里
    expect(bundle.unassignedWatermarks.map((item) => item.id)).toEqual(['preset-orphan', 'preset-deleted-owner'])
  })

  it('⭐ 没归属的水印单列一区（缺省 / 指向已删产品），不能静默丢', () => {
    const bundle = build()

    expect(bundle.unassignedWatermarks.map((item) => item.id)).toEqual(['preset-orphan', 'preset-deleted-owner'])
    // 全量水印数守恒：挂在树上的 + 未分配的 = 输入的
    expect(collectTreeConfigPresets(bundle)).toHaveLength(PRESETS.length)
  })

  it('⭐ 水印库的库级那半也进包（LOGO 列表与顺序、标识符、水印全局适配）', () => {
    const bundle = build()

    // 逐字段比对：这一半原先靠并排的 `compositeState` 带，删掉它之后这里是唯一来源
    expect(bundle.watermarkLibrary).toEqual(WATERMARK_LIBRARY)

    const restored = toCompositeV2State(bundle)
    expect(restored.projectLogos).toEqual(WATERMARK_LIBRARY.logos)
    expect(restored.logoOrder).toEqual(['logo-1'])
    expect(restored.logoLibraryPath).toBe('D:/LOGO库')
    expect(restored.globalFitMode).toBe('contain-blur')
    expect(restored.identifier).toEqual({ text: ' · @糖包', placement: 'suffix' })
    expect(restored.backgroundFolders).toEqual(['D:/背景'])
    expect(restored.recursiveBackgrounds).toBe(true)
    // 预设一律从这里取（含未归属的）—— 恢复侧的入口只有这一个
    expect(restored.presets).toHaveLength(PRESETS.length)
  })

  it('回收站里的节点不导出，但要报个数（否则「怎么少了几个方向」无法解释）', () => {
    const bundle = build()
    const ids = flattenTreeConfigNodes(bundle.tree).map((node) => node.id)

    expect(bundle.format.skippedNodes).toBe(1)
    expect(ids).not.toContain('trashed-a')
    expect(ids).toHaveLength(7)
  })

  it('不修改入参（collections / presets 是 store 的 state，就地排序会改到界面顺序）', () => {
    const collections = [...COLLECTIONS]
    const presets = [...PRESETS]
    const beforeCollections = JSON.stringify(collections)
    const beforePresets = JSON.stringify(presets)

    buildTreeConfigBundle({
      collections,
      nodeParams: NODE_PARAMS,
      presets,
      watermarkLibrary: WATERMARK_LIBRARY,
      postprocess: createDefaultPostprocessMediaConfig(),
    })

    expect(JSON.stringify(collections)).toBe(beforeCollections)
    expect(JSON.stringify(presets)).toBe(beforePresets)
  })

  it('⭐ 导出 → 恢复：逐节点对得上（父级关系、参数、水印归属都要还原）', () => {
    const bundle = build()

    const restored = toAssetCollections(bundle, 9_000)
    expect(restored.map((node) => [node.id, node.parentId, node.order])).toEqual([
      ['line-a', null, 0],
      ['product-a', 'line-a', 0],
      ['direction-a1', 'product-a', 0],
      ['direction-a2', 'product-a', 1],
      ['product-b', 'line-a', 1],
      ['direction-b1', 'product-b', 0],
      ['extra-a1', 'direction-b1', 0],
    ])
    // 回收站标记要清成 null：拉过来就是活的配置，不该带着别人那边的删除状态
    expect(restored.every((node) => node.trashedAt === null)).toBe(true)

    const params = toNodeParams(bundle)
    expect(Object.keys(params).sort()).toEqual(['direction-a1', 'product-a'])
    // 逐字段比对，不是"有几条"——丢字段正是这么被漏过去的
    expect(params['direction-a1'].postprocess).toEqual(NODE_PARAMS['direction-a1'].postprocess)
    expect(params['product-a']).toEqual(NODE_PARAMS['product-a'])

    // 水印归属按 productId 还原（导入侧靠这个把它们放回各自的库）
    const presets = collectTreeConfigPresets(bundle)
    expect(presets.find((item) => item.id === 'preset-2')?.productId).toBe('product-a')
    expect(presets.find((item) => item.id === 'preset-orphan')?.productId).toBeUndefined()
  })

  it('⭐ 全局默认层承载全局：渠道字典与各节点「用哪几个渠道」是两层，不能混成一层', () => {
    const bundle = build()

    expect(bundle.defaults.channels.length).toBeGreaterThan(0)
    expect(bundle.defaults.outputDir).toBe('全局默认目录')
    expect(bundle.defaults.namePattern).toBe('{direction}-{seq}')
    expect(bundle.defaults.selectedCollectionIds).toEqual(['direction-a1'])

    const roundTrip = toPostprocessMediaConfig(bundle)
    expect(roundTrip.media).toEqual(bundle.defaults.channels)
    expect(roundTrip.outputDir).toBe('全局默认目录')
    // 节点上的渠道选择不参与全局重建（它属于节点，不属于全局）
    expect(roundTrip.selectedMediaIds).toEqual(createDefaultPostprocessMediaConfig().selectedMediaIds)
  })

  it('结构体检：版本不对 / 缺树 / 缺渠道字典 / 缺水印库都要挡住，别拿半个包去覆盖用户的配置', () => {
    expect(validateTreeConfigBundle(null).ok).toBe(false)

    const bundle = build()
    expect(validateTreeConfigBundle(JSON.parse(JSON.stringify(bundle))).ok).toBe(true)

    const missingChannels = {
      ...bundle,
      defaults: { ...bundle.defaults, channels: undefined },
    }
    expect(validateTreeConfigBundle(missingChannels).ok).toBe(false)

    const missingLibrary = { ...bundle, watermarkLibrary: undefined }
    expect(validateTreeConfigBundle(missingLibrary).ok).toBe(false)

    expect(validateTreeConfigBundle({ ...bundle, tree: undefined }).ok).toBe(false)
  })

  it('⭐ v8 旧包整包拒收并说明原因 —— 不是静默什么都不恢复', () => {
    const bundle = build()

    // v8 的形态：版本挂在顶层、树叫 nodes、全局叫 root、水印库在 compositeState 里
    const legacy = {
      version: 8,
      exportedAt: '2026-09-20T00:00:00.000Z',
      root: bundle.defaults,
      nodes: bundle.tree,
      unassignedWatermarks: [],
      trashedSkipped: 0,
    }
    const result = validateTreeConfigBundle(legacy)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('版本不认识')
    expect(result.ok === false && result.reason).toContain('8')
  })

  it('缺兜底字段时补齐默认值（缺字段读成 undefined 会在下游炸出不同的错）', () => {
    const bundle = build()
    const withoutFallbacks = {
      format: { ...bundle.format, skippedNodes: undefined },
      defaults: bundle.defaults,
      watermarkLibrary: { ...bundle.watermarkLibrary, logos: undefined, logoOrder: undefined, libraryPath: undefined },
      tree: bundle.tree,
    }

    const result = validateTreeConfigBundle(withoutFallbacks)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.format.skippedNodes).toBe(0)
    expect(result.bundle.unassignedWatermarks).toEqual([])
    expect(result.bundle.watermarkLibrary.logos).toEqual([])
    expect(result.bundle.watermarkLibrary.logoOrder).toEqual([])
    expect(result.bundle.watermarkLibrary.libraryPath).toBe('')
  })
})
