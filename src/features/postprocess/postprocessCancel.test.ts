/**
 * 取消链路的行为契约（TB-115）。
 *
 * 这一组守的是「取消」与「失败」的**边界**，而不是取消按钮好不好点：
 *
 * - 取消要能**精确**打到一个方向（后处理是一方向一条独立 run，停一个不该牵连别的方向）；
 * - 取消句柄必须与 run 同生命周期 —— 漏释放的后果不是崩溃，而是**下一次**触发时
 *   用户点的「取消」打到一条已经跑完的记录上（毫无反应，且新的那次照样跑到底）；
 * - 「已取消」必须能被可靠识别（专属错误类型 + `AbortError`），否则它会被 `writeVariant`
 *   记成 `PP-RENDER-001`，症状是「点了取消，记录里多一条渲染失败」。
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  PostprocessCanceledError,
  cancelAllPostprocessDirections,
  cancelPostprocessDirection,
  countRegisteredPostprocessCancels,
  isPostprocessCanceledError,
  isPostprocessDirectionCancelable,
  registerPostprocessCancel,
  releasePostprocessCancel,
  resetPostprocessCancellers,
  throwIfPostprocessCanceled,
} from './postprocessCancel'

afterEach(() => {
  resetPostprocessCancellers()
})

describe('取消登记表：按方向', () => {
  it('登记之后该方向可取消；取消是幂等的（第二次返回 false 而不是再报一次）', () => {
    registerPostprocessCancel('direction-a')

    expect(isPostprocessDirectionCancelable('direction-a')).toBe(true)
    expect(cancelPostprocessDirection('direction-a')).toBe(true)
    expect(cancelPostprocessDirection('direction-a')).toBe(false)
    expect(isPostprocessDirectionCancelable('direction-a')).toBe(false)
  })

  it('取消一个方向不牵连别的方向（方向之间互不阻塞是同一条口径）', () => {
    const a = registerPostprocessCancel('direction-a')
    const b = registerPostprocessCancel('direction-b')

    expect(cancelPostprocessDirection('direction-a')).toBe(true)
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(false)
  })

  it('没登记过的方向点了取消返回 false —— 界面据此知道这一下没打到任何人', () => {
    expect(cancelPostprocessDirection('direction-missing')).toBe(false)
  })

  it('释放之后不再可取消，且不留残余（防「打到已经跑完的那一次」）', () => {
    const signal = registerPostprocessCancel('direction-a')
    releasePostprocessCancel('direction-a')

    expect(countRegisteredPostprocessCancels()).toBe(0)
    expect(cancelPostprocessDirection('direction-a')).toBe(false)
    expect(signal.aborted).toBe(false)
  })

  it('同一方向连续两次触发：先收尾那次释放句柄时，不会把后一次的句柄删掉', () => {
    const first = registerPostprocessCancel('direction-a')
    const second = registerPostprocessCancel('direction-a')

    // 第一次收尾（拿着自己的 signal）—— 句柄此刻已经是第二次的那一个，不该被删
    releasePostprocessCancel('direction-a', first)
    expect(isPostprocessDirectionCancelable('direction-a')).toBe(true)

    // 第二次收尾（带上自己的 signal）才真的删掉
    releasePostprocessCancel('direction-a', second)
    expect(countRegisteredPostprocessCancels()).toBe(0)
  })

  it('全部取消：只数**还没取消过**的，重复调用不会重复计数', () => {
    registerPostprocessCancel('direction-a')
    registerPostprocessCancel('direction-b')

    expect(cancelAllPostprocessDirections()).toBe(2)
    expect(cancelAllPostprocessDirections()).toBe(0)
  })
})

describe('取消错误的识别', () => {
  it('认自己的类型', () => {
    expect(isPostprocessCanceledError(new PostprocessCanceledError())).toBe(true)
  })

  /**
   * `AbortSignal.abort()` 会让某些异步边界透出 `DOMException('AbortError')`
   * （`fetch` 一类的实现、以及第三方 sleep/wait 工具）。它同样是「用户按了停止」——
   * 不认它的话，这类取消会被当成失败报出来。
   */
  it('也认 AbortError（signal.abort() 在某些异步边界会透出它）', () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    expect(isPostprocessCanceledError(abortError)).toBe(true)
  })

  it('普通错误不认 —— 认错了会把真失败静默丢掉', () => {
    expect(isPostprocessCanceledError(new Error('渲染失败'))).toBe(false)
    expect(isPostprocessCanceledError(undefined)).toBe(false)
    expect(isPostprocessCanceledError('后处理已取消')).toBe(false)
  })

  it('已 abort 的 signal 抛错；未 abort / 没传 signal 什么都不做', () => {
    const controller = new AbortController()
    const idle = new AbortController()

    expect(() => throwIfPostprocessCanceled()).not.toThrow()
    expect(() => throwIfPostprocessCanceled(idle.signal)).not.toThrow()
    controller.abort()
    expect(() => throwIfPostprocessCanceled(controller.signal)).toThrow(PostprocessCanceledError)
  })
})
