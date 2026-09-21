/**
 * 配置包 v8 的契约。
 *
 * 这一组的重点不是"函数能跑"，而是三条**会静默丢固定资产**的规则：
 * ① 节点参数必须跟着树走（此前根本没进包）；② 没分配到产品的水印不能丢；
 * ③ 导出 → 导入之后，每个节点的字段要**逐个对得上**（只断"恢复了几条"是测不出丢字段的）。
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

function build() {
  return buildTreeConfigBundle({
    collections: COLLECTIONS,
    nodeParams: NODE_PARAMS,
    presets: PRESETS,
    postprocess: {
      ...createDefaultPostprocessMediaConfig(),
      outputDir: '全局默认目录',
      namePattern: '{direction}-{seq}',
      selectedCollectionIds: ['direction-a1'],
    },
    exportedAt: '2026-09-22T00:00:00.000Z',
  })
}

describe('配置包 v8：以树为骨架', () => {
  it('第一层是树：产品线 → 产品 → 方向 → 自建扩展层，层级靠 children 嵌套', () => {
    const bundle = build()

    expect(bundle.version).toBe(8)
    expect(bundle.nodes.map((node) => node.id)).toEqual(['line-a'])
    const line = bundle.nodes[0]
    expect(line.children.map((node) => node.id)).toEqual(['product-a', 'product-b'])
    expect(line.children[0].children.map((node) => node.id)).toEqual(['direction-a1', 'direction-a2'])
    // 第 4 层是自建节点，原样嵌在方向下面，不会被拍平或丢掉
    expect(line.children[1].children[0].children.map((node) => node.id)).toEqual(['extra-a1'])
  })

  it('⭐ 节点自己的参数跟着节点走（此前它根本没进包）', () => {
    const bundle = build()
    const directionA1 = bundle.nodes[0].children[0].children[0]

    expect(directionA1.postprocess).toMatchObject({
      enabled: false,
      selectedMediaIds: ['clean', 'gdt'],
      watermarkPresetIds: ['preset-1'],
      outputDir: '\\\\nas\\交付\\快手\\网赚',
      // 按渠道的细分覆盖要原样带着，它有嵌套层级，最容易被"浅拷贝"吃掉
      byMedia: { gatt: { outputDirs: ['D:/一', 'D:/二'] } },
    })
    expect(directionA1.updatedAt).toBe(111)
    // 产品线上没有任何覆盖 → 不写这个字段（写空对象会让"有没有配过"分不出来）
    expect(bundle.nodes[0].postprocess).toBeUndefined()
  })

  it('⭐ 水印库挂在它归属的产品下面', () => {
    const bundle = build()
    const [productA, productB] = bundle.nodes[0].children

    expect(productA.watermarks?.map((item) => item.id)).toEqual(['preset-1', 'preset-2'])
    expect(productB.watermarks?.map((item) => item.id)).toEqual(['preset-b'])
    // 挂在产品下的水印不可以同时出现在"未分配"里
    expect(bundle.unassignedWatermarks.map((item) => item.id)).toEqual(['preset-orphan', 'preset-deleted-owner'])
  })

  it('⭐ 没归属的水印单列一区（缺省 / 指向已删产品），不能静默丢', () => {
    const bundle = build()

    expect(bundle.unassignedWatermarks.map((item) => item.id)).toEqual(['preset-orphan', 'preset-deleted-owner'])
    // 全量水印数守恒：挂在树上的 + 未分配的 = 输入的
    expect(collectTreeConfigPresets(bundle)).toHaveLength(PRESETS.length)
  })

  it('回收站里的节点不导出，但要报个数（否则「怎么少了几个方向」无法解释）', () => {
    const bundle = build()
    const ids = flattenTreeConfigNodes(bundle.nodes).map((node) => node.id)

    expect(bundle.trashedSkipped).toBe(1)
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

  it('⭐ 根节点承载全局：渠道字典与各节点「用哪几个渠道」是两层，不能混成一层', () => {
    const bundle = build()

    expect(bundle.root.channels.length).toBeGreaterThan(0)
    expect(bundle.root.outputDir).toBe('全局默认目录')
    expect(bundle.root.namePattern).toBe('{direction}-{seq}')
    expect(bundle.root.selectedCollectionIds).toEqual(['direction-a1'])

    const roundTrip = toPostprocessMediaConfig(bundle)
    expect(roundTrip.media).toEqual(bundle.root.channels)
    expect(roundTrip.outputDir).toBe('全局默认目录')
    // 节点上的渠道选择不参与根节点重建（它属于节点，不属于全局）
    expect(roundTrip.selectedMediaIds).toEqual(createDefaultPostprocessMediaConfig().selectedMediaIds)
  })

  it('结构体检：版本不对 / 缺树 / 缺渠道字典都要挡住，别拿半个包去覆盖用户的配置', () => {
    expect(validateTreeConfigBundle(null).ok).toBe(false)
    expect(validateTreeConfigBundle({ version: 7, nodes: [], root: {} }).ok).toBe(false)

    const bundle = build()
    expect(validateTreeConfigBundle(JSON.parse(JSON.stringify(bundle))).ok).toBe(true)

    const missingChannels = { ...bundle, root: { ...bundle.root, channels: undefined } }
    expect(validateTreeConfigBundle(missingChannels).ok).toBe(false)
  })
})
