/**
 * 自动出视频的判定与目录筛选。
 *
 * 只测**纯函数**：真正跑任务的那条路要引擎进程，属于手工验证范围。
 * 这两个函数恰恰是最容易写错的地方 —— 「该不该跑」判错会让用户觉得开关失灵，
 * 「取哪些目录」判错会把别的方向的图混进成片，而后者在成片里才看得出来。
 */

import { describe, expect, it } from 'vitest'
import { resolveAutoImageVideoDirs, shouldAutoRunImageVideo } from './autoTrigger'
import { resolveDirectionInputDirsByMedia } from './runVideo'
import { DEFAULT_IMAGE_VIDEO_PARAMS } from './types'

const BASE = { ...DEFAULT_IMAGE_VIDEO_PARAMS }

describe('shouldAutoRunImageVideo', () => {
  it('开着开关且有产出才跑', () => {
    expect(shouldAutoRunImageVideo({ ...BASE, enabled: true }, 3)).toBe(true)
  })

  it('开关关着不跑 —— 默认就是关的，不能靠默认值把机器占满', () => {
    expect(shouldAutoRunImageVideo({ ...BASE, enabled: false }, 3)).toBe(false)
  })

  it('零产出不跑：再去跑一次只会拿到「图片数量不足」，把一次已经说清的跳过搅浑', () => {
    expect(shouldAutoRunImageVideo({ ...BASE, enabled: true }, 0)).toBe(false)
  })
})

describe('resolveDirectionInputDirsByMedia', () => {
  const outputs = [
    { path: 'D:/导出/方向A/头条/a-01.jpg', collectionId: 'dirA', mediaId: 'toutiao', mediaName: '头条', createdAt: 10 },
    { path: 'D:/导出/方向A/广点通/a-01.jpg', collectionId: 'dirA', mediaId: 'gdt', mediaName: '广点通', createdAt: 10 },
    { path: 'D:/导出/方向A/头条/a-02.jpg', collectionId: 'dirA', mediaId: 'toutiao', mediaName: '头条', createdAt: 10 },
    { path: 'D:/导出/方向B/头条/b-01.jpg', collectionId: 'dirB', mediaId: 'toutiao', mediaName: '头条', createdAt: 10 },
    { path: 'D:/导出/未归属/c-01.jpg' },
  ]

  it('每个渠道各一条（多渠道各出一批视频），同渠道的多条记录只出一条', () => {
    expect(resolveDirectionInputDirsByMedia(outputs, 'dirA')).toEqual([
      { mediaId: 'gdt', mediaName: '广点通', dir: 'D:/导出/方向A/广点通', createdAt: 10 },
      { mediaId: 'toutiao', mediaName: '头条', dir: 'D:/导出/方向A/头条', createdAt: 10 },
    ])
  })

  it('⭐ 同一渠道只取最近那一批 —— 以前会把历史批次全堆进来，几个月前的旧目录也拿去转视频', () => {
    const older = { path: 'D:/导出/方向A/头条/旧批次/a.jpg', collectionId: 'dirA', mediaId: 'toutiao', createdAt: 1 }
    const newer = { path: 'D:/导出/方向A/头条/新批次/a.jpg', collectionId: 'dirA', mediaId: 'toutiao', createdAt: 99 }
    expect(resolveDirectionInputDirsByMedia([older, newer], 'dirA')[0]?.dir).toBe('D:/导出/方向A/头条/新批次')
    expect(resolveDirectionInputDirsByMedia([newer, older], 'dirA')[0]?.dir).toBe('D:/导出/方向A/头条/新批次')
  })

  it('⭐ 历史「纯净版」记录不进清单（ADR-0020 起已不再产出，那些目录多半已被清理或分发搬走）', () => {
    const clean = { path: 'D:/导出/方向A/纯净版/x.jpg', collectionId: 'dirA', mediaId: 'clean', createdAt: 99 }
    const dirs = resolveDirectionInputDirsByMedia([...outputs, clean], 'dirA')
    expect(dirs.some((item) => item.dir.includes('纯净版'))).toBe(false)
  })

  it('不把别的方向的目录混进来；没有归属的产出不参与', () => {
    const dirs = resolveDirectionInputDirsByMedia(outputs, 'dirA')
    expect(dirs.some((item) => item.dir.includes('方向B') || item.dir.includes('未归属'))).toBe(false)
  })

  it('没有 mediaId 的记录不参与（判不出渠道就取不到它的视频参数）', () => {
    expect(resolveDirectionInputDirsByMedia([{ path: 'D:/导出/A/x/1.jpg', collectionId: 'dirA' }], 'dirA')).toEqual([])
  })

  it('反斜杠路径同样能取出目录', () => {
    const win = [{ path: 'D:\\导出\\方向A\\头条\\a.jpg', collectionId: 'dirA', mediaId: 'toutiao', createdAt: 1 }]
    expect(resolveDirectionInputDirsByMedia(win, 'dirA')[0]?.dir).toBe('D:\\导出\\方向A\\头条')
  })

  it('方向没有产出时返回空数组（调用方据此不触发）', () => {
    expect(resolveDirectionInputDirsByMedia(outputs, 'dirMissing')).toEqual([])
  })

  it('渠道没给显示名时退回 id，不会显示成空白', () => {
    const noName = [{ path: 'D:/导出/A/x/1.jpg', collectionId: 'dirA', mediaId: 'gdt', createdAt: 1 }]
    expect(resolveDirectionInputDirsByMedia(noName, 'dirA')[0]?.mediaName).toBe('gdt')
  })
})

describe('resolveAutoImageVideoDirs 与 runVideo 的口径一致', () => {
  it('转发不是另写一套：同样的输入必须得到同样的结果', () => {
    const outputs = [
      { path: 'D:/导出/A/x/1.jpg', collectionId: 'dirA', mediaId: 'gdt', createdAt: 1 },
      { path: 'D:/导出/A/y/2.jpg', collectionId: 'dirA', mediaId: 'baidu', createdAt: 1 },
    ]
    expect(resolveAutoImageVideoDirs(outputs, 'dirA')).toEqual(resolveDirectionInputDirsByMedia(outputs, 'dirA'))
  })
})
