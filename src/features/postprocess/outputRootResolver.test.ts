/**
 * TB-049 回归：输出根目录解析器必须是「先授权、再建目录」，且顺序不可交换。
 *
 * ## 为什么这组测试是这么写的
 *
 * 第一版测试只断言了 `localSave` 里的 `authorizeOutputDirectory` /
 * `getExplicitImageSaveDirectory` 两个函数各自的行为。**反向验证时**（把
 * `taskPostprocess` 里的调用顺序改回旧版）**测试全绿** —— 说明它根本没锁住 bug。
 *
 * 根因：bug 住在「调用顺序」里，而当时那段逻辑内联在 `taskPostprocess.ts` 的闭包中，
 * 不可测。所以把它抽成 `createOutputRootResolver`，让顺序变成可断言的对象。
 *
 * 这一组的核心是 `authorize` / `resolve` 的**调用序列**，不是「各自被调用过」——
 * 只断言「调用过」的话，顺序换回来依然绿。
 */

import { describe, expect, it, vi } from 'vitest'
import { createOutputRootResolver } from './outputRootResolver'

/** 记录调用序列，用来断言先后关系而不是存在性。 */
function createTracker(resolvable: (configured: string) => string | null = (c) => c || 'LOCAL/postprocess') {
  const calls: string[] = []
  return {
    calls,
    authorize: vi.fn(async (dir: string) => {
      calls.push(`authorize:${dir}`)
      return true
    }),
    resolve: vi.fn(async (configured: string) => {
      calls.push(`resolve:${configured}`)
      return resolvable(configured)
    }),
  }
}

describe('TB-049 · 输出根目录解析：先授权再建目录', () => {
  it('配了位置时，authorize 严格发生在 resolve 之前', async () => {
    const tracker = createTracker()
    const resolve = createOutputRootResolver({ authorize: tracker.authorize, resolve: tracker.resolve })

    await expect(resolve('D:/导出/保险')).resolves.toBe('D:/导出/保险')

    expect(tracker.calls).toEqual(['authorize:D:/导出/保险', 'resolve:D:/导出/保险'])
    // 反向验证的锚点：把两者对调，上面这条 toEqual 立刻挂
    expect(tracker.calls.indexOf('authorize:D:/导出/保险')).toBeLessThan(tracker.calls.indexOf('resolve:D:/导出/保险'))
  })

  it('多渠道路径：每个路径都各自先授权再解析，不共用一次授权', async () => {
    const tracker = createTracker()
    const resolve = createOutputRootResolver({ authorize: tracker.authorize, resolve: tracker.resolve })

    await resolve('D:/广点通')
    await resolve('D:/百度')

    expect(tracker.calls).toEqual(['authorize:D:/广点通', 'resolve:D:/广点通', 'authorize:D:/百度', 'resolve:D:/百度'])
  })

  it('空白配置串跳过授权（授权空串会被 path.resolve 解析成进程 CWD）', async () => {
    const tracker = createTracker(() => 'LOCAL/postprocess')
    const resolve = createOutputRootResolver({ authorize: tracker.authorize, resolve: tracker.resolve })

    await expect(resolve('')).resolves.toBe('LOCAL/postprocess')

    expect(tracker.authorize).not.toHaveBeenCalled()
    expect(tracker.calls).toEqual(['resolve:'])

    // `'   '` trim 后与 `''` 是同一个缓存键，第二次直接命中缓存 —— 这正是
    // 「缓存键用 trim 后的值」这条设计的体现，不是漏解析。
    await expect(resolve('   ')).resolves.toBe('LOCAL/postprocess')
    expect(tracker.calls).toEqual(['resolve:'])
  })

  it('按配置串缓存：同一路径第二次不再授权也不再建目录', async () => {
    const tracker = createTracker()
    const resolve = createOutputRootResolver({ authorize: tracker.authorize, resolve: tracker.resolve })

    await resolve('D:/导出')
    await resolve('D:/导出')

    expect(tracker.authorize).toHaveBeenCalledTimes(1)
    expect(tracker.resolve).toHaveBeenCalledTimes(1)
  })

  it('缓存键用 trim 后的值：前后空格不产生第二条缓存', async () => {
    const tracker = createTracker()
    const resolve = createOutputRootResolver({ authorize: tracker.authorize, resolve: tracker.resolve })

    await resolve('D:/导出')
    await resolve('  D:/导出  ')

    expect(tracker.authorize).toHaveBeenCalledTimes(1)
    expect(tracker.authorize).toHaveBeenCalledWith('D:/导出')
  })

  it('解析失败（null）也被缓存，不逐张图重试', async () => {
    const tracker = createTracker(() => null)
    const resolve = createOutputRootResolver({ authorize: tracker.authorize, resolve: tracker.resolve })

    await expect(resolve('//NAS/不可达')).resolves.toBeNull()
    await expect(resolve('//NAS/不可达')).resolves.toBeNull()

    expect(tracker.resolve).toHaveBeenCalledTimes(1)
  })

  it('授权被拒绝时仍然继续解析（是否放行由 resolve 决定，不在这里短路）', async () => {
    // 授权失败不等于必须放弃：`resolve` 内部走 `ensureDir`，它会用同一套白名单再判一次，
    // 而 `ensureDir` 才是「目录到底能不能写」的权威。这里只保证顺序，不替它做决定。
    const calls: string[] = []
    const resolve = createOutputRootResolver({
      authorize: async (dir) => {
        calls.push(`authorize:${dir}`)
        return false
      },
      resolve: async (configured) => {
        calls.push(`resolve:${configured}`)
        return null
      },
    })

    await expect(resolve('D:/导出')).resolves.toBeNull()
    expect(calls).toEqual(['authorize:D:/导出', 'resolve:D:/导出'])
  })
})
