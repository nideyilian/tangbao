import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectCompositeAssetIds,
  collectLayerAssetIds,
  dataUrlToCompositeBlob,
  isCompositeAssetReferenced,
  releaseUnreferencedAssets,
  storeCompositeAssetFromDataUrl,
  storeCompositeBlobs,
} from './compositeAssets'
import type { CompositeV2ImageAssetRef } from './compositeV2Types'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'

afterEach(() => vi.restoreAllMocks())

describe('composite assets', () => {
  it('deduplicates equal blobs and returns one id per input', async () => {
    const putMany = vi.fn().mockResolvedValue(undefined)
    const ids = await storeCompositeBlobs([new Blob(['same']), new Blob(['same'])], { putMany, now: () => 1 })

    expect(ids[0]).toBe(ids[1])
    expect(putMany).toHaveBeenCalledTimes(1)
    expect(putMany.mock.calls[0]![0]).toHaveLength(1)
  })

  it('converts a data URL to a Blob with its MIME type', async () => {
    const blob = await dataUrlToCompositeBlob('data:image/png;base64,YQ==')
    expect(blob.type).toBe('image/png')
    await expect(blob.text()).resolves.toBe('a')
  })

  it('collects unique library and preset references', () => {
    const preset = createDefaultCompositeV2Preset(1)
    preset.layers = [
      {
        id: 'logo-layer',
        type: 'logo',
        name: 'Logo',
        visible: true,
        locked: false,
        opacity: 1,
        rotation: 0,
        position: { mode: 'free', x: 0, y: 0, width: 10, height: 10 },
        shadow: { enabled: false, color: '#000', x: 0, y: 0, blur: 0, opacity: 0 },
        asset: { kind: 'stored', assetId: 'asset-b', name: 'b.png' },
        radius: 0,
        clip: false,
      },
    ]
    const state = {
      projectLogos: [{ id: 'logo-a', name: 'A', assetId: 'asset-a' }],
      presets: [preset],
    }

    expect(collectCompositeAssetIds(state)).toEqual(['asset-a', 'asset-b'])
    expect(isCompositeAssetReferenced(state, 'asset-b')).toBe(true)
    expect(isCompositeAssetReferenced(state, 'missing')).toBe(false)
  })
})

const dbMock = vi.hoisted(() => ({
  putCompositeAssets: vi.fn(async () => undefined),
  getCompositeAsset: vi.fn(async () => null),
  deleteCompositeAsset: vi.fn(async () => undefined),
}))

vi.mock('../../../lib/db', () => dbMock)

function mediaLayerFixture(id: string, asset: CompositeV2ImageAssetRef | null) {
  return {
    id,
    type: 'logo' as const,
    name: 'Logo',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { mode: 'free' as const, x: 0, y: 0, width: 10, height: 10 },
    shadow: { enabled: false, color: '#000', x: 0, y: 0, blur: 0, opacity: 0 },
    asset,
    radius: 0,
    clip: false,
  }
}

describe('storeCompositeAssetFromDataUrl —— 图片存进程序内（2026-10-12 需求）', () => {
  it('落库并返回可直接写进图层的 stored 引用', async () => {
    const asset = await storeCompositeAssetFromDataUrl('data:image/png;base64,YQ==', '角标.png')

    expect(asset).toMatchObject({ kind: 'stored', name: '角标.png' })
    expect(asset!.assetId).toBeTruthy()
    expect(dbMock.putCompositeAssets).toHaveBeenCalledTimes(1)
  })

  it('写入失败返回 null —— 绝不让图层拿到一个指向不存在资源的引用', async () => {
    dbMock.putCompositeAssets.mockRejectedValueOnce(new Error('quota'))

    await expect(storeCompositeAssetFromDataUrl('data:image/png;base64,YQ==')).resolves.toBeNull()
  })
})

/*
 * 需求原话（2026-10-12 杰哥）：「添加进水印的图片要保存在程序内，**直到我把它删除**」。
 * 前半句由「选图即落库」保证，后半句由这里保证 —— 删掉图层/水印时把没人再用的图真正释放。
 */
describe('collectLayerAssetIds / releaseUnreferencedAssets —— 删了才释放', () => {
  const state = (layers: ReturnType<typeof mediaLayerFixture>[]) => ({
    projectLogos: [],
    presets: [{ ...createDefaultCompositeV2Preset(1), layers }],
  })

  it('只收 stored 形态的 id：文字层、path 型、空素材都跳过', () => {
    const ids = collectLayerAssetIds([
      mediaLayerFixture('a', { kind: 'stored', assetId: 'asset-a' }),
      mediaLayerFixture('b', { kind: 'stored', assetId: 'asset-a' }),
      mediaLayerFixture('c', { kind: 'path', path: 'D:/x.png' }),
      mediaLayerFixture('d', null),
      {
        ...mediaLayerFixture('e', null),
        type: 'text' as unknown as 'logo',
        id: 'e',
      } as never,
    ])

    expect(ids).toEqual(['asset-a'])
  })

  it('⭐ 仍被别处引用时不删 —— 同一张图可能被多套水印共用', async () => {
    dbMock.deleteCompositeAsset.mockClear()
    const referenced = state([
      mediaLayerFixture('kept', { kind: 'stored', assetId: 'asset-shared' }),
      mediaLayerFixture('removed', { kind: 'stored', assetId: 'asset-only-here' }),
    ])

    await releaseUnreferencedAssets(['asset-shared'], () => referenced)

    expect(dbMock.deleteCompositeAsset).not.toHaveBeenCalled()
  })

  it('⭐ 已经没人引用了才真删', async () => {
    dbMock.deleteCompositeAsset.mockClear()
    const afterDelete = state([mediaLayerFixture('kept', { kind: 'stored', assetId: 'asset-other' })])

    await releaseUnreferencedAssets(['asset-gone'], () => afterDelete)

    expect(dbMock.deleteCompositeAsset).toHaveBeenCalledWith('asset-gone')
  })

  it('删除失败只记日志、不上抛（一个孤儿资源不该让「已删除图层」变成失败）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    dbMock.deleteCompositeAsset.mockRejectedValueOnce(new Error('io'))

    await expect(releaseUnreferencedAssets(['asset-x'], () => state([]))).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })
})
