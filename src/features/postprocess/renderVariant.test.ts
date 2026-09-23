/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 这两个 mock 就是本文件要验的全部东西：**画布渲染了几次**、**编码了几次、用的什么质量**。
 *
 * jsdom 没有 canvas 实现，而体积搜索本来也不需要真画 —— 要守的是「画一次、编码少数几次」，
 * 以及「返回的必须是**实测达标**的那一帧」（搜索策略优化不能把正确性搭进去）。
 */
const mocks = vi.hoisted(() => ({
  renderCanvas: vi.fn(async () => {}),
  encode: vi.fn<(canvas: unknown, type: string, quality: number) => Promise<Blob>>(async () => blobOfKb(1)),
  toDataUrl: vi.fn(async (blob: Blob) => `data:image/jpeg;base64,${blob.size}`),
}))

vi.mock('../composite/lib/compositeRendererV2', () => ({
  renderCompositeV2ToCanvas: mocks.renderCanvas,
}))

vi.mock('../../lib/canvasImage', () => ({
  canvasToBlob: mocks.encode,
  blobToDataUrl: mocks.toDataUrl,
}))

import { renderOnce, renderWithMaxKb } from './renderVariant'

/** 假 Blob：只需要 `size`（体积判定读它），不必真的分配字节。 */
function blobOfKb(kb: number): Blob {
  return { size: Math.max(1, Math.round(kb * 1024)) } as unknown as Blob
}

/** 近似真实 JPEG 的体积曲线：体积随质量**指数**增长（对数域才近似线性）。 */
function exponentialSize(quality: number): Blob {
  return blobOfKb(0.5 * Math.exp(7 * quality))
}

/** 阶跃曲线：用来制造「插值猜高了」的场景 —— 边界卡在 0.6。 */
function stepSize(quality: number): Blob {
  return blobOfKb(quality > 0.6 ? 500 : 50)
}

/** 从返回的 dataUrl 反推选中的体积（mock 的 `toDataUrl` 把 size 写进了字符串）。 */
function sizeOf(dataUrl: string): number {
  return Number(dataUrl.replace('data:image/jpeg;base64,', ''))
}

const baseInput = {
  backgroundDataUrl: 'data:image/png;base64,AAAA',
  preset: { id: 'p1', updatedAt: 1 } as never,
  targetSize: { width: 1080, height: 1920 },
  fitMode: 'crop-fill' as const,
}

describe('renderWithMaxKb · 画布只画一次、编码只打几枪', () => {
  beforeEach(() => {
    mocks.renderCanvas.mockClear()
    mocks.encode.mockClear()
    mocks.toDataUrl.mockClear()
  })

  it('0.9 一次达标：渲染 1 次、编码 1 次（最常见路径，别弄丢）', async () => {
    mocks.encode.mockResolvedValue(blobOfKb(100))

    const result = await renderWithMaxKb(baseInput, 200)

    expect(mocks.renderCanvas).toHaveBeenCalledTimes(1)
    expect(mocks.encode).toHaveBeenCalledTimes(1)
    expect(mocks.encode).toHaveBeenCalledWith(expect.anything(), 'image/jpeg', 0.9)
    expect(result.warning).toBeUndefined()
    expect(result.stats.encodeCount).toBe(1)
  })

  it('⭐ 需要压缩时：渲染仍然只有 1 次，总编码 3 次（旧实现的上限是 10 次）', async () => {
    mocks.encode.mockImplementation(async (_canvas, _type, quality: number) => exponentialSize(quality))

    await renderWithMaxKb(baseInput, 100)

    // 旧实现这里会是 10（0.9 + 0.01 探底 + 8 轮二分）；这条断言精确打在新策略上
    expect(mocks.encode).toHaveBeenCalledTimes(3)
    expect(mocks.renderCanvas).toHaveBeenCalledTimes(1)
  })

  it('⭐ 插值猜高时退一档，且返回的一定是**实测达标**的那一帧', async () => {
    mocks.encode.mockImplementation(async (_canvas, _type, quality: number) => stepSize(quality))

    const result = await renderWithMaxKb(baseInput, 100)

    // 0.9 超标 → 0.5 达标 → 插值点（≈0.62）越界超标 → 退到 (0.5+0.62)/2 达标
    expect(mocks.encode).toHaveBeenCalledTimes(4)
    // 返回的是真正达标的那一档，不是被否掉的高质量帧
    expect(sizeOf(result.dataUrl)).toBe(50 * 1024)
    expect(sizeOf(result.dataUrl)).toBeLessThanOrEqual(100 * 1024)
  })

  it('最低质量也超标：3 次编码后返回超限结果并带 warning', async () => {
    mocks.encode.mockResolvedValue(blobOfKb(500))

    const result = await renderWithMaxKb(baseInput, 100)

    expect(mocks.encode).toHaveBeenCalledTimes(3)
    expect(result.warning).toContain('仍超过 100KB')
    expect(mocks.renderCanvas).toHaveBeenCalledTimes(1)
  })

  it('诊断字段对得上：encodeCount 等于实际编码次数，两段耗时都是有限数', async () => {
    mocks.encode.mockImplementation(async (_canvas, _type, quality: number) => exponentialSize(quality))

    const result = await renderWithMaxKb(baseInput, 100)

    expect(result.stats.encodeCount).toBe(mocks.encode.mock.calls.length)
    expect(Number.isFinite(result.stats.paintMs)).toBe(true)
    expect(Number.isFinite(result.stats.encodeMs)).toBe(true)
    expect(result.stats.paintMs).toBeGreaterThanOrEqual(0)
    expect(result.stats.encodeMs).toBeGreaterThanOrEqual(0)
  })

  it('取消：渲染前就抛错，一张画布都不建', async () => {
    await expect(renderWithMaxKb(baseInput, 200, { shouldCancel: () => true })).rejects.toThrow('渲染被取消')
    expect(mocks.renderCanvas).not.toHaveBeenCalled()
  })
})

describe('renderOnce · 单次高质量编码', () => {
  beforeEach(() => {
    mocks.renderCanvas.mockClear()
    mocks.encode.mockClear()
  })

  it('只编码一次，不进体积搜索（纯净版 / 不限体积走这条）', async () => {
    mocks.encode.mockResolvedValue(blobOfKb(900))

    const result = await renderOnce(baseInput, 0.92)

    expect(mocks.renderCanvas).toHaveBeenCalledTimes(1)
    expect(mocks.encode).toHaveBeenCalledTimes(1)
    expect(mocks.encode).toHaveBeenCalledWith(expect.anything(), 'image/jpeg', 0.92)
    expect(result.warning).toBeUndefined()
    expect(result.stats.encodeCount).toBe(1)
  })
})
