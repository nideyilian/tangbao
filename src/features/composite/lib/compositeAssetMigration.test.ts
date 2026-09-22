import { describe, expect, it, vi } from 'vitest'
import { createCompositeV2Store } from '../storeV2'
import type { CompositeV2ImageAssetRef, CompositeV2Layer } from './compositeV2Types'
import { migrateLegacyCompositeAssets } from './compositeAssetMigration'

describe('composite asset migration', () => {
  it('migrates library, data URL, and project references after storing blobs', async () => {
    const store = createCompositeV2Store()
    const preset = store.getState().presets[0]!
    store.setState({
      projectLogos: [{ id: 'logo-a', name: 'A', dataUrl: 'data:image/png;base64,YQ==' }],
      presets: [
        {
          ...preset,
          layers: [
            mediaLayer('layer-data', { kind: 'dataUrl', dataUrl: 'data:image/png;base64,Yg==', name: 'B' }),
            mediaLayer('layer-project', { kind: 'project', id: 'logo-a' }),
          ],
        },
      ],
    })
    const storeAssets = vi.fn(async (blobs: Blob[]) => blobs.map((_, index) => `asset-${index}`))

    const count = await migrateLegacyCompositeAssets({
      getState: store.getState,
      setState: (patch) => store.setState(patch),
      storeAssets,
    })

    expect(count).toBe(2)
    expect(store.getState().projectLogos[0]).toEqual({ id: 'logo-a', name: 'A', assetId: 'asset-0' })
    expect(store.getState().presets[0]!.layers.map((layer) => ('asset' in layer ? layer.asset : null))).toEqual([
      { kind: 'stored', assetId: 'asset-1', name: 'B' },
      { kind: 'stored', assetId: 'asset-0', name: 'A' },
    ])
    expect(JSON.stringify(store.getState().projectLogos)).not.toContain('base64,')
  })

  it('does not change state when storing a legacy asset fails', async () => {
    const store = createCompositeV2Store()
    store.setState({
      projectLogos: [{ id: 'logo-a', name: 'A', dataUrl: 'data:image/png;base64,YQ==' }],
    })
    const before = store.getState().projectLogos

    await expect(
      migrateLegacyCompositeAssets({
        getState: store.getState,
        setState: (patch) => store.setState(patch),
        storeAssets: async () => {
          throw new Error('quota')
        },
      }),
    ).rejects.toThrow('quota')

    expect(store.getState().projectLogos).toBe(before)
  })

  it('⭐ 把「从本机磁盘选图」的图层迁进库（不然配置包搬走就断图）', async () => {
    const store = createCompositeV2Store()
    const preset = store.getState().presets[0]!
    store.setState({
      presets: [{ ...preset, layers: [mediaLayer('layer-path', { kind: 'path', path: 'D:/素材/角标.png' })] }],
    })
    const storeAssets = vi.fn(async (blobs: Blob[]) => blobs.map((_, index) => `asset-${index}`))
    const readImageDataUrl = vi.fn(async (path: string) =>
      path === 'D:/素材/角标.png' ? 'data:image/png;base64,Yw==' : null,
    )

    const count = await migrateLegacyCompositeAssets({
      getState: store.getState,
      setState: (patch) => store.setState(patch),
      storeAssets,
      readImageDataUrl,
    })

    expect(count).toBe(1)
    expect(readImageDataUrl).toHaveBeenCalledWith('D:/素材/角标.png')
    // 落成了库里那份 —— 新电脑上没有 `D:/素材/角标.png` 也不会断图
    expect(store.getState().presets[0]!.layers[0]).toMatchObject({ asset: { kind: 'stored', assetId: 'asset-0' } })
  })

  it('读不到那张图时原样保留（不假装迁移成功）', async () => {
    const store = createCompositeV2Store()
    const preset = store.getState().presets[0]!
    const asset: CompositeV2ImageAssetRef = { kind: 'path', path: 'D:/已经不在了/角标.png' }
    store.setState({ presets: [{ ...preset, layers: [mediaLayer('layer-path', asset)] }] })

    const count = await migrateLegacyCompositeAssets({
      getState: store.getState,
      setState: (patch) => store.setState(patch),
      storeAssets: async () => [],
      readImageDataUrl: async () => null,
    })

    // 它仍然跨不了机器，但至少没把用户已经配好的东西改坏（改成 stored 却指不到资源更糟）
    expect(count).toBe(0)
    expect((store.getState().presets[0]!.layers[0] as { asset: unknown }).asset).toEqual(asset)
  })
})

function mediaLayer(id: string, asset: CompositeV2ImageAssetRef): CompositeV2Layer {
  return {
    id,
    type: 'logo' as const,
    name: id,
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
