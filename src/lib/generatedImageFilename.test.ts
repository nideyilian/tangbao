import { describe, expect, it, vi } from 'vitest'
import {
  buildGeneratedImageFileNameBase,
  findNextGeneratedImageSequence,
  formatGeneratedImageDate,
  getSeriesGroupImageSequence,
  resolveGeneratedAssetBatch,
  resolveGeneratedAssetNameBase,
  sanitizeGeneratedImageFilenamePart,
} from './generatedImageFilename'

const context = {
  createdAt: new Date(2026, 6, 3, 8).getTime(),
  label: '快手',
  prompt: '  红色\n海报:竖版  ',
  batch: 2,
}

describe('generated image filenames', () => {
  it('uses the task generation date and omits the prompt by default', () => {
    expect(
      buildGeneratedImageFileNameBase(
        { ...context, batch: 1 },
        {
          imageFilenameDatePrefix: true,
          imageFilenameUsePrompt: false,
        },
        1,
      ),
    ).toBe('20260703-快手-1-1')
  })

  it('includes a sanitized prompt when enabled', () => {
    expect(
      buildGeneratedImageFileNameBase(
        context,
        {
          imageFilenameDatePrefix: true,
          imageFilenameUsePrompt: true,
        },
        2,
      ),
    ).toBe('20260703-快手-2-红色 海报-竖版-2')
  })

  it('supports disabling the date while keeping the prompt', () => {
    expect(
      buildGeneratedImageFileNameBase(
        context,
        {
          imageFilenameDatePrefix: false,
          imageFilenameUsePrompt: true,
        },
        3,
      ),
    ).toBe('快手-2-红色 海报-竖版-3')
  })

  it('supports disabling both optional parts', () => {
    expect(
      buildGeneratedImageFileNameBase(
        context,
        {
          imageFilenameDatePrefix: false,
          imageFilenameUsePrompt: false,
        },
        4,
      ),
    ).toBe('快手-2-4')
  })

  it('uses local calendar fields for the generation date', () => {
    expect(formatGeneratedImageDate(new Date(2026, 0, 9, 23, 59).getTime())).toBe('20260109')
  })

  it('collapses whitespace, replaces invalid characters, and truncates parts', () => {
    expect(sanitizeGeneratedImageFilenamePart('  a\n\tb:c  ')).toBe('a b-c')
    expect(sanitizeGeneratedImageFilenamePart('x'.repeat(101), 100)).toHaveLength(100)
  })

  it('limits the prompt to 100 characters', () => {
    const base = buildGeneratedImageFileNameBase(
      {
        ...context,
        prompt: 'y'.repeat(101),
      },
      {
        imageFilenameDatePrefix: true,
        imageFilenameUsePrompt: true,
      },
      12,
    )

    expect(base).toBe(`20260703-快手-2-${'y'.repeat(100)}-12`)
  })

  it('omits an empty prompt and falls back for an empty label', () => {
    expect(
      buildGeneratedImageFileNameBase(
        {
          ...context,
          label: '  ',
          prompt: ' \n ',
        },
        {
          imageFilenameDatePrefix: false,
          imageFilenameUsePrompt: true,
        },
        1,
      ),
    ).toBe('image-2-1')
  })

  it('continues after the largest matching sequence', () => {
    expect(
      findNextGeneratedImageSequence(
        ['20260703-快手-2-1.png', '20260703-快手-2-7.webp', '20260702-快手-2-9.png', 'other.txt'],
        context,
        { imageFilenameDatePrefix: true, imageFilenameUsePrompt: false },
      ),
    ).toBe(8)
  })

  it('falls back to the current date for an invalid timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 4, 10))
    expect(formatGeneratedImageDate(Number.NaN)).toBe('20260704')
    vi.useRealTimers()
  })

  describe('series group sequence', () => {
    it('numbers each member of the group continuously', () => {
      // 一组 2 张、每成员 1 张：组内顺序依次为 1、2
      expect(getSeriesGroupImageSequence({ seriesIndex: 1 }, 1, 0)).toBe(1)
      expect(getSeriesGroupImageSequence({ seriesIndex: 2 }, 1, 0)).toBe(2)
    })

    it('keeps numbering continuous when a member returns several images', () => {
      // 每成员 2 张：第 2 名成员的组内顺序接着第 1 名成员排（3、4）
      expect(getSeriesGroupImageSequence({ seriesIndex: 1 }, 2, 0)).toBe(1)
      expect(getSeriesGroupImageSequence({ seriesIndex: 1 }, 2, 1)).toBe(2)
      expect(getSeriesGroupImageSequence({ seriesIndex: 2 }, 2, 0)).toBe(3)
      expect(getSeriesGroupImageSequence({ seriesIndex: 2 }, 2, 1)).toBe(4)
      // 出图先后不影响编号：第 3 名成员的第 1 张仍是 5
      expect(getSeriesGroupImageSequence({ seriesIndex: 3 }, 2, 0)).toBe(5)
    })

    it('returns null for non-series tasks and normalizes broken values', () => {
      expect(getSeriesGroupImageSequence(undefined, 2, 0)).toBeNull()
      expect(getSeriesGroupImageSequence(null, 2, 0)).toBeNull()
      expect(getSeriesGroupImageSequence({ seriesIndex: 0 }, 0, 0)).toBe(1)
      expect(getSeriesGroupImageSequence({ seriesIndex: Number.NaN }, undefined, Number.NaN)).toBe(1)
    })

    it('builds the X-组序号-组内顺序序号 filename', () => {
      const base = buildGeneratedImageFileNameBase(
        { ...context, batch: 5 },
        { imageFilenameDatePrefix: true, imageFilenameUsePrompt: false },
        getSeriesGroupImageSequence({ seriesIndex: 2 }, 1, 0)!,
      )
      expect(base).toBe('20260703-快手-5-2')
    })
  })

  describe('素材规范名（下载 / 导出 / 排序共用）', () => {
    /** 只带命名相关字段的最小来源；`GeneratedAsset` 里其余字段与命名无关。 */
    const origin = (patch: Partial<Parameters<typeof resolveGeneratedAssetNameBase>[0]['origins'][number]> = {}) => ({
      key: 'task-1:0',
      taskCreatedAt: new Date(2026, 8, 18, 10).getTime(),
      outputSlot: 0,
      filenameLabel: '网赚',
      filenameBatch: 401,
      ...patch,
    })

    it('按「日期-标签-批次-序号」派生，序号从槽位号来', () => {
      expect(resolveGeneratedAssetNameBase({ origins: [origin()], primaryOriginKey: 'task-1:0' })).toBe(
        '20260918-网赚-401-1',
      )
      expect(
        resolveGeneratedAssetNameBase({ origins: [origin({ outputSlot: 2 })], primaryOriginKey: 'task-1:2' }),
      ).toBe('20260918-网赚-401-3')
    })

    it('显式的 generatedFileNameBase 优先于派生', () => {
      expect(
        resolveGeneratedAssetNameBase({
          origins: [origin({ generatedFileNameBase: '落盘时那份名字' })],
          primaryOriginKey: 'task-1:0',
        }),
      ).toBe('落盘时那份名字')
    })

    it('取不到标签 / 批次时仍给可读名，不会退化成哈希', () => {
      // 老素材没有 filenameLabel / filenameBatch。名字难看但可读，
      // 比 `${imageId}.png` 那串 64 位 sha256 强——后者用户根本认不出是哪张图。
      expect(
        resolveGeneratedAssetNameBase({
          origins: [origin({ filenameLabel: undefined, filenameBatch: undefined })],
          primaryOriginKey: 'task-1:0',
        }),
      ).toBe('20260918-未命名-1-1')
    })

    it('优先用 primaryOriginKey 指的那个来源，不是数组第一个', () => {
      const first = origin({ key: 'task-1:0' })
      const primary = { ...origin({ key: 'task-2:0' }), filenameLabel: '小红书', filenameBatch: 7 }
      expect(resolveGeneratedAssetNameBase({ origins: [first, primary], primaryOriginKey: 'task-2:0' })).toBe(
        '20260918-小红书-7-1',
      )
      // 没有 primaryOriginKey 时退回第一个（老数据）
      expect(resolveGeneratedAssetNameBase({ origins: [first, primary], primaryOriginKey: null })).toBe(
        '20260918-网赚-401-1',
      )
    })

    it('没有任何来源时返回空串，由调用方兜底', () => {
      expect(resolveGeneratedAssetNameBase({ origins: [], primaryOriginKey: null })).toBe('')
    })

    it('批次号取原始值（缺失归 0），供排序与建列使用', () => {
      expect(resolveGeneratedAssetBatch({ origins: [origin()], primaryOriginKey: 'task-1:0' })).toBe(401)
      expect(
        resolveGeneratedAssetBatch({
          origins: [origin({ filenameBatch: undefined })],
          primaryOriginKey: 'task-1:0',
        }),
      ).toBe(0)
      expect(resolveGeneratedAssetBatch({ origins: [], primaryOriginKey: null })).toBe(0)
    })
  })
})
