import { describe, expect, it } from 'vitest'
import {
  PRESET_TRANSFER_KIND,
  buildPresetTransferFile,
  collectPresetBindings,
  normalizeImportedPreset,
  parsePresetTransferFile,
  planPresetImport,
  resolveCollectionIdByPath,
} from './compositePresetTransfer'
import type { CompositeV2Preset } from './compositeV2Types'
import type { PostprocessMedia } from '../../../lib/postprocessMedia'
import type { AssetCollection } from '../../../types'
import type { ProjectNodeParamsMap } from '../../projectTree/types'

function collection(id: string, name: string, parentId: string | null = null): AssetCollection {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    parentId,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function preset(id: string, name: string): CompositeV2Preset {
  return {
    id,
    name,
    baseCanvas: { width: 1080, height: 1920 },
    sampleBackgroundPath: '',
    layers: [],
    updatedAt: 1,
  }
}

function media(id: string, name: string): PostprocessMedia {
  return { id, name, enabled: true, sizes: [] }
}

/** 女鞋 / 凉鞋 / 抖音 三层；另有一条男鞋线下也有个同名「抖音」 */
const collections = [
  collection('line-a', '女鞋'),
  collection('prod-a', '凉鞋', 'line-a'),
  collection('dir-a', '抖音', 'prod-a'),
  collection('line-b', '男鞋'),
  collection('prod-b', '拖鞋', 'line-b'),
  collection('dir-b', '抖音', 'prod-b'),
]

describe('预设导出 · 归属收集', () => {
  it('只收显式声明的绑定，并按节点路径名导出', () => {
    const params: ProjectNodeParamsMap = {
      'dir-a': { postprocess: { watermarkPresetIds: ['w1', 'w2'] } },
    }
    const bindings = collectPresetBindings({ presetIds: ['w1', 'w2'], collections, params, media: [] })
    expect(bindings).toEqual([
      { presetId: 'w1', path: ['女鞋', '凉鞋', '抖音'] },
      { presetId: 'w2', path: ['女鞋', '凉鞋', '抖音'] },
    ])
  })

  it('本次没导出的预设，其归属不带走', () => {
    const params: ProjectNodeParamsMap = {
      'dir-a': { postprocess: { watermarkPresetIds: ['w1', 'w2'] } },
    }
    expect(collectPresetBindings({ presetIds: ['w1'], collections, params, media: [] })).toEqual([
      { presetId: 'w1', path: ['女鞋', '凉鞋', '抖音'] },
    ])
  })

  it('继承来的绑定不导（没写就是没表态）', () => {
    const params: ProjectNodeParamsMap = {
      'line-a': { postprocess: { watermarkPresetIds: ['w1'] } },
      'dir-a': { postprocess: { outputDir: 'D:\\out' } },
    }
    expect(collectPresetBindings({ presetIds: ['w1'], collections, params, media: [] })).toEqual([
      { presetId: 'w1', path: ['女鞋'] },
    ])
  })

  it('按渠道的绑定带上渠道名', () => {
    const params: ProjectNodeParamsMap = {
      'dir-a': { postprocess: { byMedia: { m1: { watermarkPresetIds: ['w1'] } } } },
    }
    expect(
      collectPresetBindings({
        presetIds: ['w1'],
        collections,
        params,
        media: [media('m1', '头条')],
      }),
    ).toEqual([{ presetId: 'w1', path: ['女鞋', '凉鞋', '抖音'], media: '头条' }])
  })

  it('节点已被删除 → 归属跳过，不留没有路径的孤儿条目', () => {
    const params: ProjectNodeParamsMap = {
      'gone-node': { postprocess: { watermarkPresetIds: ['w1'] } },
    }
    expect(collectPresetBindings({ presetIds: ['w1'], collections, params, media: [] })).toEqual([])
  })
})

describe('预设文件 · 解析', () => {
  it('导出再解析可原样往返', () => {
    const file = buildPresetTransferFile({
      presets: [preset('w1', '水印一')],
      bindings: [{ presetId: 'w1', path: ['女鞋', '凉鞋', '抖音'] }],
      identifier: { text: '@小王', placement: 'suffix' },
      now: new Date('2026-09-19T00:00:00.000Z'),
    })
    const parsed = parsePresetTransferFile(JSON.stringify(file))
    expect(parsed?.presets).toHaveLength(1)
    expect(parsed?.bindings).toEqual([{ presetId: 'w1', path: ['女鞋', '凉鞋', '抖音'] }])
    expect(parsed?.identifier).toEqual({ text: '@小王', placement: 'suffix' })
  })

  it('不是本功能出的文件 / 版本更高 / 没有预设 → 一律拒绝', () => {
    expect(parsePresetTransferFile('{"kind":"other"}')).toBeNull()
    expect(parsePresetTransferFile('not json')).toBeNull()
    expect(
      parsePresetTransferFile(
        JSON.stringify({ kind: PRESET_TRANSFER_KIND, version: 99, presets: [preset('w1', 'a')] }),
      ),
    ).toBeNull()
    expect(parsePresetTransferFile(JSON.stringify({ kind: PRESET_TRANSFER_KIND, version: 1, presets: [] }))).toBeNull()
  })

  it('坏预设逐条丢弃，坏归属也丢弃，保住能用的部分', () => {
    const raw = JSON.stringify({
      kind: PRESET_TRANSFER_KIND,
      version: 1,
      presets: [{ id: 'w1', name: '好水印', baseCanvas: { width: 1080, height: 1920 }, layers: [] }, { name: '没 id' }],
      bindings: [{ presetId: 'w1', path: ['女鞋'] }, { presetId: 'w1' }],
    })
    const parsed = parsePresetTransferFile(raw)
    expect(parsed?.presets.map((item) => item.id)).toEqual(['w1'])
    expect(parsed?.bindings).toEqual([{ presetId: 'w1', path: ['女鞋'] }])
  })

  it('预设缺字段时按默认值兜底', () => {
    expect(normalizeImportedPreset({ id: 'w9' })).toMatchObject({
      id: 'w9',
      name: '导入的水印',
      baseCanvas: { width: 1080, height: 1920 },
      layers: [],
    })
    expect(normalizeImportedPreset({ name: '没有 id' })).toBeNull()
  })
})

describe('预设导入 · 路径匹配', () => {
  it('逐层匹配路径，不只看最后一级名字', () => {
    expect(resolveCollectionIdByPath(collections, ['女鞋', '凉鞋', '抖音'])).toBe('dir-a')
    expect(resolveCollectionIdByPath(collections, ['男鞋', '拖鞋', '抖音'])).toBe('dir-b')
  })

  it('路径不存在 → 返回 null（不自动建节点）', () => {
    expect(resolveCollectionIdByPath(collections, ['女鞋', '靴子'])).toBeNull()
    expect(resolveCollectionIdByPath(collections, ['抖音'])).toBeNull()
  })
})

describe('预设导入 · 计划', () => {
  const file = buildPresetTransferFile({
    presets: [preset('w1', '水印一'), preset('w2', '水印二')],
    bindings: [
      { presetId: 'w1', path: ['女鞋', '凉鞋', '抖音'] },
      { presetId: 'w1', path: ['女鞋', '凉鞋', '抖音'], media: '头条' },
      { presetId: 'w2', path: ['女鞋', '靴子'] },
    ],
    identifier: { text: '@小王', placement: 'suffix' },
  })

  it('新预设为新增，同 id 默认覆盖', () => {
    const plan = planPresetImport({ file, collections, media: [media('m1', '头条')], existingPresets: [] })
    expect(plan.resolutions.map((item) => item.mode)).toEqual(['add', 'add'])
    const withExisting = planPresetImport({
      file,
      collections,
      media: [media('m1', '头条')],
      existingPresets: [preset('w1', '旧的水印一')],
    })
    expect(withExisting.resolutions.map((item) => item.mode)).toEqual(['update', 'add'])
  })

  it('副本模式下同 id 另存为新 id', () => {
    const plan = planPresetImport({
      file,
      collections,
      media: [media('m1', '头条')],
      existingPresets: [preset('w1', '旧')],
      asCopy: true,
      now: () => 123,
    })
    expect(plan.resolutions[0]).toMatchObject({ sourceId: 'w1', mode: 'copy' })
    expect(plan.resolutions[0]?.finalId).not.toBe('w1')
  })

  it('归属按路径与渠道名落到 id；对不上的进 unmatched', () => {
    const plan = planPresetImport({ file, collections, media: [media('m1', '头条')], existingPresets: [] })
    expect(plan.bindings).toEqual([
      { presetId: 'w1', collectionId: 'dir-a', mediaId: null },
      { presetId: 'w1', collectionId: 'dir-a', mediaId: 'm1' },
    ])
    expect(plan.unmatchedBindings).toHaveLength(1)
    expect(plan.unmatchedBindings[0]).toMatchObject({ presetId: 'w2', path: ['女鞋', '靴子'] })
  })

  it('渠道名对不上时保留节点绑定，但仍记一条未完全恢复', () => {
    const plan = planPresetImport({ file, collections, media: [], existingPresets: [] })
    expect(plan.bindings).toEqual([
      { presetId: 'w1', collectionId: 'dir-a', mediaId: null },
      { presetId: 'w1', collectionId: 'dir-a', mediaId: null },
    ])
    expect(plan.unmatchedBindings).toHaveLength(2)
  })

  it('文件里的标识符带出来，由 UI 决定要不要应用', () => {
    const plan = planPresetImport({ file, collections, media: [], existingPresets: [] })
    expect(plan.identifier).toEqual({ text: '@小王', placement: 'suffix' })
  })
})
