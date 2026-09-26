/**
 * 自动出视频的判定与目录筛选。
 *
 * 只测**纯函数**：真正跑任务的那条路要引擎进程，属于手工验证范围。
 * 这两个函数恰恰是最容易写错的地方 —— 「该不该跑」判错会让用户觉得开关失灵，
 * 「取哪些目录」判错会把别的方向的图混进成片，而后者在成片里才看得出来。
 */

import { describe, expect, it } from 'vitest'
import { resolveAutoImageVideoDirs, shouldAutoRunImageVideo } from './autoTrigger'
import { resolveDirectionInputDirs } from './runVideo'
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

describe('resolveDirectionInputDirs', () => {
  const outputs = [
    { path: 'D:/导出/方向A/头条/a-01.jpg', collectionId: 'dirA' },
    { path: 'D:/导出/方向A/广点通/a-01.jpg', collectionId: 'dirA' },
    { path: 'D:/导出/方向A/头条/a-02.jpg', collectionId: 'dirA' },
    { path: 'D:/导出/方向B/头条/b-01.jpg', collectionId: 'dirB' },
    { path: 'D:/导出/未归属/c-01.jpg' },
  ]

  it('只取这个方向的目录，并按首次出现顺序去重', () => {
    expect(resolveDirectionInputDirs(outputs, 'dirA')).toEqual(['D:/导出/方向A/头条', 'D:/导出/方向A/广点通'])
  })

  it('不把别的方向的目录混进来', () => {
    const dirs = resolveDirectionInputDirs(outputs, 'dirA')
    expect(dirs.some((dir) => dir.includes('方向B'))).toBe(false)
  })

  it('没有归属的产出不参与（宁可不产出，也不要拿错目录）', () => {
    expect(resolveDirectionInputDirs(outputs, 'dirA').includes('D:/导出/未归属')).toBe(false)
  })

  it('反斜杠路径同样能取出目录', () => {
    expect(resolveDirectionInputDirs([{ path: 'D:\\导出\\方向A\\头条\\a.jpg', collectionId: 'dirA' }], 'dirA')).toEqual(
      ['D:\\导出\\方向A\\头条'],
    )
  })

  it('方向没有产出时返回空数组（调用方据此不触发）', () => {
    expect(resolveDirectionInputDirs(outputs, 'dirMissing')).toEqual([])
  })
})

describe('resolveAutoImageVideoDirs 与 runVideo 的口径一致', () => {
  it('转发不是另写一套：同样的输入必须得到同样的结果', () => {
    const outputs = [
      { path: 'D:/导出/A/x/1.jpg', collectionId: 'dirA' },
      { path: 'D:/导出/A/y/2.jpg', collectionId: 'dirA' },
    ]
    expect(resolveAutoImageVideoDirs(outputs, 'dirA')).toEqual(resolveDirectionInputDirs(outputs, 'dirA'))
  })
})
