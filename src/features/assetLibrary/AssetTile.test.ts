import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAsset } from '../../lib/assetLibraryModel'
import AssetTile from './AssetTile'

/**
 * 缩略图档位（2026-09-28）：磁贴按「自己实际要多少设备像素」决定读 grid / full / 原图。
 *
 * 这组用例钉的是**链路**而不是算法 —— 算法在 `lib/tileImagePlan.test.ts` 里按数值断言，
 * 这里证明"档位真的接到了加载上"。只测算法的话，组件里少接一根线照样全绿，
 * 而那正是本仓最怕的一类静默失效（界面上「看着没变化」）。
 */
const thumbnailMocks = vi.hoisted(() => ({
  GRID_THUMBNAIL_VARIANT: 'grid',
  ensureImageCached: vi.fn(async (_id: string) => null),
  ensureImageThumbnailCached: vi.fn(
    async (_id: string, _priority?: 'visible' | 'background', _variant?: string) => null,
  ),
  getCachedThumbnail: vi.fn((_id: string, _variant?: string) => null),
  resolveImageDisplaySrc: vi.fn(async (_id: string) => 'tangbao://image/?path=C%3A%2Fcache-images%2Fsha.png'),
  subscribeImageThumbnail: vi.fn((_id: string, _listener: unknown, _variant?: string) => () => {}),
}))

vi.mock('../../store', () => thumbnailMocks)

function renderTile(style: { width?: number } | undefined): ReactTestRenderer {
  const asset = normalizeAsset({
    id: 'asset-plan-1',
    imageId: 'img-plan-1',
    width: 1080,
    height: 1920,
    origins: [],
  })
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(AssetTile, {
        asset,
        selected: false,
        style: style as never,
        onToggleSelect: vi.fn(),
        onOpenViewer: vi.fn(),
        onOpenMenu: vi.fn(),
        suppressClickUntilRef: { current: 0 } as never,
      }),
    )
  })
  return renderer
}

function lastVariant(): unknown {
  const calls = thumbnailMocks.ensureImageThumbnailCached.mock.calls
  return calls.at(-1)?.[2]
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AssetTile 缩略图档位', () => {
  it('磁贴比小图还大时升级到大图通道（不再硬撑 512 小图被拉伸）', () => {
    // 700 CSS × DPR 1 = 700 设备像素 > 512
    renderTile({ width: 700 })
    expect(lastVariant()).toBe('full')
    expect(thumbnailMocks.resolveImageDisplaySrc).not.toHaveBeenCalled()
  })

  it('磁贴小于小图能力时仍走 grid —— 省内存的默认路径不能被改掉', () => {
    renderTile({ width: 400 })
    expect(lastVariant()).toBe('grid')
  })

  it('磁贴超过大图能力时直接原图直出，不再加载缩略图', () => {
    renderTile({ width: 1200 })
    expect(thumbnailMocks.ensureImageThumbnailCached).not.toHaveBeenCalled()
    expect(thumbnailMocks.resolveImageDisplaySrc).toHaveBeenCalledWith('img-plan-1')
  })

  it('拿不到磁贴宽度（CSS 网格布局）时保守走 grid，不无谓拉原图', () => {
    renderTile(undefined)
    expect(lastVariant()).toBe('grid')
    expect(thumbnailMocks.resolveImageDisplaySrc).not.toHaveBeenCalled()
  })
})
