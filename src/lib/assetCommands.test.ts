import { describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset, StoredImage, TaskRecord } from '../types'
import { createAssetCommandService, getAssetFileName, type AssetCommandDependencies } from './assetCommands'

function makeAsset(id = 'asset-a', overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return {
    id,
    imageId: id,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [],
    primaryOriginKey: null,
    parentAssetIds: [],
    metadataVersion: 1,
    ...overrides,
  }
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'orange cat product photo',
    params: {} as TaskRecord['params'],
    inputImageIds: ['reference-a'],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 100,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

function makeDependencies(overrides: Partial<AssetCommandDependencies> = {}): AssetCommandDependencies {
  const assets = new Map<string, GeneratedAsset>([['asset-a', makeAsset()]])
  const images = new Map<string, StoredImage>([
    [
      'asset-a',
      {
        id: 'asset-a',
        dataUrl: 'data:image/png;base64,AAA',
        localPath: 'D:\\cache\\asset-a.png',
        width: 1200,
        height: 800,
      },
    ],
    [
      'reference-a',
      { id: 'reference-a', dataUrl: 'data:image/png;base64,BBB', source: 'upload', width: 640, height: 960 },
    ],
  ])
  return {
    loadLibrary: vi.fn(async () => ({ assets: [...assets.values()], collections: [], tags: [], tombstones: [] })),
    getAsset: vi.fn(async (id) => assets.get(id)),
    getAssetsByIds: vi.fn(
      async (ids: string[]) =>
        new Map<string, GeneratedAsset>(ids.flatMap((id) => (assets.has(id) ? [[id, assets.get(id)!] as const] : []))),
    ),
    getImagesByIds: vi.fn(
      async (ids: string[]) =>
        new Map<string, StoredImage>(ids.flatMap((id) => (images.has(id) ? [[id, images.get(id)!] as const] : []))),
    ),
    saveAssets: vi.fn(async (next: GeneratedAsset[]) => {
      next.forEach((asset) => assets.set(asset.id, asset))
    }),
    publishAssets: vi.fn(),
    ensureImageDataUrl: vi.fn(async (id) => images.get(id)?.dataUrl ?? null),
    addReference: vi.fn(async () => true),
    openComposite: vi.fn(async () => true),
    getTask: vi.fn(async () => undefined),
    reuseTask: vi.fn(async () => true),
    download: vi.fn(async () => true),
    patchAssets: vi.fn(async () => undefined),
    trashAssets: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    showToast: vi.fn(),
    now: vi.fn(() => 500),
    createId: vi.fn(() => 'usage-a'),
    ...overrides,
  }
}

describe('AssetCommandService', () => {
  it('uses an asset as a reference through the adapter and records the action', async () => {
    const deps = makeDependencies()
    const service = createAssetCommandService(deps)

    await expect(service.useAsReference('asset-a', { target: 'agent' })).resolves.toBe(true)

    expect(deps.addReference).toHaveBeenCalledWith({ id: 'asset-a', dataUrl: 'data:image/png;base64,AAA' }, 'agent')
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset-a',
        imageId: 'asset-a',
        action: 'selected-as-reference',
        target: 'agent',
      }),
    )
  })

  it('opens a locally stored asset in the composite workspace and records the action', async () => {
    const deps = makeDependencies()
    const service = createAssetCommandService(deps)

    await expect(service.openInComposite('asset-a')).resolves.toBe(true)

    expect(deps.openComposite).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [expect.objectContaining({ id: 'asset-a' })],
        images: [expect.objectContaining({ localPath: 'D:\\cache\\asset-a.png' })],
      }),
    )
    expect(deps.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ action: 'open-composite' }))
  })

  it('opens multiple selected assets in the postprocess workspace at once', async () => {
    const deps = makeDependencies({
      getAssetsByIds: vi.fn(async (ids: string[]) => {
        const entries: Array<[string, GeneratedAsset]> = []
        for (const id of ids) {
          if (id === 'asset-a') entries.push([id, makeAsset('asset-a')])
          if (id === 'asset-b') entries.push([id, makeAsset('asset-b')])
        }
        return new Map(entries)
      }),
      getImagesByIds: vi.fn(async (ids: string[]) => {
        const entries: Array<[string, StoredImage]> = []
        for (const id of ids) {
          entries.push([
            id,
            { id, dataUrl: `data:image/png;base64,${id}`, localPath: `D:\\cache\\${id}.png`, width: 800, height: 600 },
          ])
        }
        return new Map(entries)
      }),
    })
    const service = createAssetCommandService(deps)

    await expect(service.openInPostprocessBatch(['asset-a', 'asset-b'])).resolves.toBe(true)

    expect(deps.openComposite).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [expect.objectContaining({ id: 'asset-a' }), expect.objectContaining({ id: 'asset-b' })],
        images: [
          expect.objectContaining({ localPath: 'D:\\cache\\asset-a.png' }),
          expect.objectContaining({ localPath: 'D:\\cache\\asset-b.png' }),
        ],
      }),
    )
    expect(deps.recordUsage).toHaveBeenCalledTimes(2)
    expect(deps.showToast).toHaveBeenCalledWith('已设为水印预览底图（2 张）', 'success')
  })

  it('archives a previously external task input as a reference asset without changing its blob id', async () => {
    const deps = makeDependencies()
    const service = createAssetCommandService(deps)
    const task = makeTask()

    const promoted = await service.archiveTaskReferences(task, {
      sourceMode: 'gallery',
      workspaceTabId: 'tab-a',
      workspaceTabName: '产品图',
    })

    expect(promoted).toHaveLength(1)
    expect(promoted[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^asset:/),
        imageId: 'reference-a',
        width: 640,
        height: 960,
      }),
    )
    expect(promoted[0]?.origins[0]).toEqual(
      expect.objectContaining({
        kind: 'reference',
        taskId: 'task-a',
        workspaceTabId: 'tab-a',
      }),
    )
    expect(deps.saveAssets).toHaveBeenCalledWith(promoted)
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'usage:generation-input:task-a:reference-a',
        action: 'generation-input',
        taskId: 'task-a',
      }),
    )
  })

  it('records task use for an existing asset without duplicating the asset record', async () => {
    const existing = makeAsset('reference-a')
    const deps = makeDependencies({
      getAssetsByIds: vi.fn(async () => new Map([['reference-a', existing]])),
    })
    const service = createAssetCommandService(deps)

    await expect(service.archiveTaskReferences(makeTask(), { sourceMode: 'gallery' })).resolves.toEqual([])

    expect(deps.saveAssets).not.toHaveBeenCalled()
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'reference-a',
        action: 'generation-input',
      }),
    )
  })

  it('applies the source SOP of an asset to the gallery and records the action', async () => {
    const assetWithSop = makeAsset('asset-sop', {
      origins: [
        {
          kind: 'generated',
          key: 'task-a:0',
          taskId: 'task-a',
          outputSlot: 0,
          taskCreatedAt: 100,
          taskFinishedAt: 200,
          sourceMode: 'gallery',
          prompt: 'sop prompt',
          requestedParams: {} as TaskRecord['params'],
          inputImageIds: [],
        },
      ],
      primaryOriginKey: 'task-a:0',
    })
    const deps = makeDependencies({
      getAsset: vi.fn(async () => assetWithSop),
      getTask: vi.fn(async () =>
        makeTask({
          sopBatch: { batchId: 'b1', sopId: 'sop-1', sopName: '商品图 SOP', promptIndex: 0, promptCount: 1 },
        }),
      ),
      applySopToGallery: vi.fn(async () => true),
    })
    const service = createAssetCommandService(deps)

    await expect(service.applyAssetSop('asset-sop')).resolves.toBe(true)

    expect(deps.applySopToGallery).toHaveBeenCalledWith('sop-1')
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset-sop',
        action: 'reuse-config',
        target: 'sop',
        sopId: 'sop-1',
      }),
    )
  })

  it('reports an info toast when the asset has no associated SOP', async () => {
    const deps = makeDependencies({
      getTask: vi.fn(async () => makeTask()),
    })
    const service = createAssetCommandService(deps)

    await expect(service.applyAssetSop('asset-a')).resolves.toBe(false)
    expect(deps.showToast).toHaveBeenCalledWith('这项素材没有关联的 SOP', 'info')
    expect(deps.applySopToGallery).toBeUndefined()
  })
})

describe('searchAllAssetIds', () => {
  function makePagedQuery(assetsById: Map<string, GeneratedAsset>) {
    return vi.fn(async (input: { cursor?: string | null; limit?: number }) => {
      const all = [...assetsById.values()].sort((a, b) => a.id.localeCompare(b.id))
      const start = input.cursor ? Number(input.cursor) : 0
      const page = all.slice(start, start + (input.limit ?? 500))
      return {
        assets: page,
        totalCount: all.length,
        nextCursor: start + page.length < all.length ? String(start + page.length) : null,
        counts: {
          all: all.length,
          recent: 0,
          favorites: 0,
          unorganized: 0,
          trash: 0,
          byCollection: {},
        },
      }
    })
  }

  const baseInput = {
    scope: 'all' as const,
    query: '',
    filters: {},
    sortKey: 'createdAt' as const,
    sortOrder: 'desc' as const,
  }

  it('collects every matching asset id across cursor pages', async () => {
    const assets = new Map<string, GeneratedAsset>(
      Array.from({ length: 1300 }, (_, i) => [
        `asset-${String(i).padStart(4, '0')}`,
        makeAsset(`asset-${String(i).padStart(4, '0')}`),
      ]),
    )
    const queryCatalog = makePagedQuery(assets)
    const service = createAssetCommandService(makeDependencies({ queryCatalog }))

    const result = await service.searchAllAssetIds({ ...baseInput, query: '' })

    expect(result.ids).toHaveLength(1300)
    expect(result.totalCount).toBe(1300)
    expect(result.truncated).toBe(false)
    expect(queryCatalog.mock.calls.length).toBeGreaterThan(2)
  })

  it('stops at the protection cap and reports truncation', async () => {
    const assets = new Map<string, GeneratedAsset>(
      Array.from({ length: 30_000 }, (_, i) => [`asset-${i}`, makeAsset(`asset-${i}`)]),
    )
    const service = createAssetCommandService(makeDependencies({ queryCatalog: makePagedQuery(assets) }))

    const result = await service.searchAllAssetIds({ ...baseInput, query: '' }, 10_000)

    expect(result.ids).toHaveLength(10_000)
    expect(result.truncated).toBe(true)
  })

  it('底层每页只给 200 条时也能翻页收全 450 条（全选不受页大小限制）', async () => {
    const assets = new Map<string, GeneratedAsset>(
      Array.from({ length: 450 }, (_, i) => {
        const id = `asset-${String(i).padStart(4, '0')}`
        return [id, makeAsset(id)]
      }),
    )
    // 模拟主进程当年的 200 夹子：不管上层要多少，一页最多 200 条
    const clamped = vi.fn(async (input: { cursor?: string | null; limit?: number }) => {
      const all = [...assets.keys()].sort((a, b) => a.localeCompare(b))
      const start = input.cursor ? Number(input.cursor) : 0
      const size = Math.min(input.limit ?? 500, 200)
      const page = all.slice(start, start + size).map((id) => assets.get(id)!)
      return {
        assets: page,
        totalCount: all.length,
        nextCursor: start + page.length < all.length ? String(start + page.length) : null,
        counts: {
          all: all.length,
          recent: 0,
          favorites: 0,
          unorganized: 0,
          trash: 0,
          byCollection: {},
        },
      }
    })
    const service = createAssetCommandService(makeDependencies({ queryCatalog: clamped }))

    const result = await service.searchAllAssetIds({ ...baseInput, query: '' })

    expect(result.ids).toHaveLength(450)
    expect(new Set(result.ids).size).toBe(450)
    expect(result.truncated).toBe(false)
  })

  it('游标不推进（下一页重复同一批 id）时立刻收手并报截断，不把结果缩成一小撮', async () => {
    const assets = new Map<string, GeneratedAsset>(
      Array.from({ length: 450 }, (_, i) => {
        const id = `asset-${String(i).padStart(4, '0')}`
        return [id, makeAsset(id)]
      }),
    )
    // 坏游标：永远返回第一页（且 nextCursor 恒非空），旧实现会白翻 64 轮、
    // 堆积 12800 条重复 id，最后被上层去重成 200 条 —— 看起来像「全选只能选 200 张」。
    const stuck = vi.fn(async (input: { cursor?: string | null; limit?: number }) => {
      const all = [...assets.keys()].sort((a, b) => a.localeCompare(b))
      const size = Math.min(input.limit ?? 500, 200)
      return {
        assets: all.slice(0, size).map((id) => assets.get(id)!),
        totalCount: all.length,
        nextCursor: 'stuck',
        counts: {
          all: all.length,
          recent: 0,
          favorites: 0,
          unorganized: 0,
          trash: 0,
          byCollection: {},
        },
      }
    })
    const service = createAssetCommandService(makeDependencies({ queryCatalog: stuck }))

    const result = await service.searchAllAssetIds({ ...baseInput, query: '' })

    expect(stuck.mock.calls.length).toBe(2)
    expect(result.ids).toHaveLength(200)
    expect(result.truncated).toBe(true)
  })

  it('falls back to a full in-memory query when no catalog backend exists', async () => {
    const assets = new Map<string, GeneratedAsset>([['asset-a', makeAsset('asset-a')]])
    const service = createAssetCommandService(
      makeDependencies({
        queryCatalog: undefined,
        loadLibrary: vi.fn(async () => ({
          assets: [...assets.values()],
          collections: [],
          tags: [],
          tombstones: [],
        })),
      }),
    )

    const result = await service.searchAllAssetIds({ ...baseInput, query: '' })

    expect(result.ids).toEqual(['asset-a'])
    expect(result.truncated).toBe(false)
  })
})

describe('getAssetFileName', () => {
  const namingOrigin = {
    key: 'task-a:0',
    taskCreatedAt: new Date(2026, 8, 18, 9).getTime(),
    outputSlot: 0,
    filenameLabel: '网赚',
    filenameBatch: 401,
  } as GeneratedAsset['origins'][number]

  it('用「日期-标签-批次-序号」而不是 64 位 content hash', () => {
    // 曾经的实现只读 `origin.generatedFileNameBase`，而那个字段全仓没有生产者，
    // 于是每次下载/导出落到的都是 `${imageId}.png` —— 用户看到一串 sha256 认不出是哪张图。
    const asset = makeAsset('asset-a', {
      imageId: '0a70cdc563d773c44b1d1bbfbcf3bb4301fc654382184eb2e971d997842568f1',
      mimeType: 'image/png',
      origins: [namingOrigin],
      primaryOriginKey: 'task-a:0',
    })
    expect(getAssetFileName(asset)).toBe('20260918-网赚-401-1.png')
  })

  it('扩展名跟随 mimeType', () => {
    const asset = makeAsset('asset-a', {
      mimeType: 'image/jpeg',
      origins: [namingOrigin],
      primaryOriginKey: 'task-a:0',
    })
    expect(getAssetFileName(asset)).toBe('20260918-网赚-401-1.jpg')
  })

  it('来源缺失时才退回 imageId（老数据兜底，不是常规路径）', () => {
    const asset = makeAsset('asset-a', { imageId: 'hash-only', mimeType: 'image/png' })
    expect(getAssetFileName(asset)).toBe('hash-only.png')
  })
})
