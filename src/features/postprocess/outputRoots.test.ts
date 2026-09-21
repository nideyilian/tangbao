import { describe, expect, it, vi } from 'vitest'
import { resolveBucketOutputRoots } from './outputRoots'

/** 只有这些目录"建得出来"，其余返回 null 模拟不可达的共享盘 */
function resolverFor(available: string[]) {
  return vi.fn(async (configured: string) => (configured && available.includes(configured) ? configured : null))
}

function config(outputDir: string, mediaOutputDirs: Record<string, string[]> = {}) {
  return { outputDir, mediaOutputDirs }
}

describe('resolveBucketOutputRoots —— 每桶的导出位置决策', () => {
  it('一个位置都没配时落到默认输出位置（本地 postprocess），不是空', async () => {
    const warn = vi.fn()
    const resolveRoot = vi.fn(async (configured: string) => (configured === '' ? 'LOCAL/postprocess' : null))
    const roots = await resolveBucketOutputRoots(config(''), 'baidu', resolveRoot, warn)
    expect(roots).toEqual(['LOCAL/postprocess'])
    expect(resolveRoot).toHaveBeenCalledWith('')
    expect(warn).not.toHaveBeenCalled()
  })

  it('配一个就返回一个；配两个返回两个且顺序即配置顺序（第一个是主位置）', async () => {
    const warn = vi.fn()
    const single = await resolveBucketOutputRoots(
      config('', { baidu: ['D:/共享盘'] }),
      'baidu',
      resolverFor(['D:/共享盘']),
      warn,
    )
    expect(single).toEqual(['D:/共享盘'])

    const double = await resolveBucketOutputRoots(
      config('', { baidu: ['D:/共享盘', 'D:/本地留档'] }),
      'baidu',
      resolverFor(['D:/共享盘', 'D:/本地留档']),
      warn,
    )
    expect(double).toEqual(['D:/共享盘', 'D:/本地留档'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('两个位置指向同一个目录时只写一份（去重）', async () => {
    const warn = vi.fn()
    const roots = await resolveBucketOutputRoots(
      config('', { baidu: ['D:/同一个', 'D:/同一个'] }),
      'baidu',
      resolverFor(['D:/同一个']),
      warn,
    )
    // 归一化阶段就已经去重，这里看到的是一个位置
    expect(roots).toEqual(['D:/同一个'])
  })

  it('配了位置但一个都建不出来 → 空列表 + 报码，绝不悄悄写到本地', async () => {
    const onIssue = vi.fn()
    const resolveRoot = vi.fn(async (configured: string) => (configured === '' ? 'LOCAL/postprocess' : null))
    const roots = await resolveBucketOutputRoots(
      config('D:/全局默认', { baidu: ['//NAS/不可达'] }),
      'baidu',
      resolveRoot,
      onIssue,
    )
    expect(roots).toEqual([])
    // 报的是码 + 目录，不再是「请检查路径是否可达」这句查不出真因的话
    expect(onIssue).toHaveBeenCalledWith({ code: 'PP-DIR-001', stage: 'write', mediaId: 'baidu', dir: '//NAS/不可达' })
    // 关键：没有回退去调默认目录（`''` 那次只可能是从没配位置的分支来）
    expect(resolveRoot).not.toHaveBeenCalledWith('')
  })

  it('双写时只有一个位置可用 → 写可用的那个并把少的位置数报出来', async () => {
    const onIssue = vi.fn()
    const roots = await resolveBucketOutputRoots(
      config('', { baidu: ['D:/可用', '//NAS/不可达'] }),
      'baidu',
      resolverFor(['D:/可用']),
      onIssue,
    )
    expect(roots).toEqual(['D:/可用'])
    expect(onIssue).toHaveBeenCalledWith({
      code: 'PP-DIR-003',
      stage: 'write',
      mediaId: 'baidu',
      detail: '配了 2 个，可用 1 个',
    })
  })

  it('渠道没配时沿用默认输出目录（不因为别的渠道配了就一起变）', async () => {
    const warn = vi.fn()
    const roots = await resolveBucketOutputRoots(
      config('D:/全局默认', { baidu: ['D:/百度'] }),
      'toutiao',
      resolverFor(['D:/全局默认', 'D:/百度']),
      warn,
    )
    expect(roots).toEqual(['D:/全局默认'])
  })
})
