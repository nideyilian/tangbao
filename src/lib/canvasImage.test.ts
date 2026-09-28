import { describe, expect, it, vi } from 'vitest'
import { blobToDataUrl, canvasToWebpDataUrl, computeThumbnailScale } from './canvasImage'

/** 只实现 toBlob / toDataURL 的假 canvas：绕开 jsdom 没有 2D 上下文、也无真实编码器的限制。 */
function stubCanvas(options: {
  blob?: Blob | null
  toDataURL?: () => string
  throwOnBlob?: boolean
  onEncode?: (type: string | undefined, quality: number | undefined) => void
}): HTMLCanvasElement {
  return {
    toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => {
      options.onEncode?.(type, quality)
      if (options.throwOnBlob) throw new Error('toBlob 不可用')
      callback(options.blob ?? null)
    },
    toDataURL: options.toDataURL ?? (() => 'data:image/webp;base64,FROM_TO_DATA_URL'),
  } as unknown as HTMLCanvasElement
}

describe('canvasToWebpDataUrl', () => {
  it('优先走 toBlob：编码参数为 webp，dataURL 前缀取自 blob 类型', async () => {
    const onEncode = vi.fn()
    const toDataURL = vi.fn(() => 'data:image/webp;base64,FALLBACK')
    const canvas = stubCanvas({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
      toDataURL,
      onEncode,
    })

    const dataUrl = await canvasToWebpDataUrl(canvas, 0.82)

    expect(onEncode).toHaveBeenCalledWith('image/webp', 0.82)
    expect(dataUrl.startsWith('data:image/webp;base64,')).toBe(true)
    // 主线程同步编码的 toDataURL 不应被触碰
    expect(toDataURL).not.toHaveBeenCalled()
  })

  it('toBlob 给不出 blob 时回退 toDataURL', async () => {
    const toDataURL = vi.fn(() => 'data:image/webp;base64,FALLBACK')
    const canvas = stubCanvas({ blob: null, toDataURL })

    await expect(canvasToWebpDataUrl(canvas, 0.82)).resolves.toBe('data:image/webp;base64,FALLBACK')
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.82)
  })

  it('toBlob 直接抛错时同样回退 toDataURL', async () => {
    const toDataURL = vi.fn(() => 'data:image/webp;base64,FALLBACK')
    const canvas = stubCanvas({ throwOnBlob: true, toDataURL })

    await expect(canvasToWebpDataUrl(canvas, 0.8)).resolves.toBe('data:image/webp;base64,FALLBACK')
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.8)
  })

  it('toBlob 静默降级成 png 时前缀跟随真实 mime（不谎报 webp）', async () => {
    const canvas = stubCanvas({ blob: new Blob([new Uint8Array([9])], { type: 'image/png' }) })

    const dataUrl = await canvasToWebpDataUrl(canvas, 0.82)

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })
})

describe('blobToDataUrl', () => {
  it('按 blob 内容生成 base64 dataURL', async () => {
    const blob = new Blob([new Uint8Array([72, 105])], { type: 'image/webp' })

    await expect(blobToDataUrl(blob)).resolves.toBe('data:image/webp;base64,SGk=')
  })
})

/**
 * grid 通道口径（宽度 ≤512 且长边 ≤1024）。
 * 这组数字直接决定网格里的图糊不糊，所以按像素断言，而不是断言"缩了一点"。
 */
describe('computeThumbnailScale', () => {
  it('横图：只给 maxWidth 的结果与旧口径「最长边 512」逐像素一致（不改变既有行为）', () => {
    // 16:9 横图 → 512×288
    expect(Math.round(1920 * computeThumbnailScale(1920, 1080, 1024, 512))).toBe(512)
    expect(Math.round(1080 * computeThumbnailScale(1920, 1080, 1024, 512))).toBe(288)
  })

  it('竖图：宽度被抬到上限（旧口径下 9:16 只剩 288px 宽，正是报障里最糊的一类）', () => {
    // 3:4 → 512×683（旧口径 384×512）
    const portrait34 = computeThumbnailScale(1080, 1440, 1024, 512)
    expect(Math.round(1080 * portrait34)).toBe(512)
    expect(Math.round(1440 * portrait34)).toBe(683)

    // 9:16 → 512×910（旧口径 288×512）
    const portrait916 = computeThumbnailScale(1080, 1920, 1024, 512)
    expect(Math.round(1080 * portrait916)).toBe(512)
    expect(Math.round(1920 * portrait916)).toBe(910)
  })

  it('极端长图仍受最长边约束，不会为宽度把高度放大失控', () => {
    // 1:4 长图：按宽度会算出 512×2048，被 1024 长边挡回 256×1024
    const scale = computeThumbnailScale(600, 2400, 1024, 512)
    expect(Math.round(600 * scale)).toBe(256)
    expect(Math.round(2400 * scale)).toBe(1024)
  })

  it('只缩不放：源已经比上限小就原样返回（scale = 1）', () => {
    expect(computeThumbnailScale(300, 200, 1024, 512)).toBe(1)
    expect(computeThumbnailScale(512, 512, 1024, 512)).toBe(1)
  })

  it('尺寸非法时回退 scale = 1（调用方原样返回，不生成空图）', () => {
    expect(computeThumbnailScale(0, 100, 1024, 512)).toBe(1)
    expect(computeThumbnailScale(100, 0, 1024, 512)).toBe(1)
  })

  it('不给 maxWidth 时退化成纯最长边口径（老调用方行为不变）', () => {
    expect(Math.round(1080 * computeThumbnailScale(1080, 1440, 512))).toBe(384)
    expect(Math.round(1440 * computeThumbnailScale(1080, 1440, 512))).toBe(512)
  })
})
