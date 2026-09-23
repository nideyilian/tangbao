/**
 * 方向级并发闸的行为契约。
 *
 * 背景（2026-09-23）：后处理原先一把全局锁 —— 一个方向在跑，别的方向点不动。改成按方向管理后，
 * 「同时最多跑几个方向」这件事必须**可测**：它决定的是用户能不能同时开两条线，
 * 而不是一个可以随手调的常数。这里守四条：
 * ① 名额没满就开、满了就排队（不丢单）；
 * ② **同一方向同时最多一条**（两条会争同一批输出目录与文件名序号）；
 * ③ 释放是幂等的（异常路径多释放一次不能吃掉别人的名额）；
 * ④ 上限被非法值污染时不至于让所有方向都开不了工。
 */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_DIRECTION_GATE,
  admitDirection,
  isDirectionRunning,
  normalizeDirectionConcurrency,
  releaseDirection,
  type DirectionGateState,
} from './postprocessDirectionQueue'

/** 连续申请，返回「哪些被放行」——把连锁的 admit 写成一行，读起来跟操作顺序一致。 */
function admitAll(keys: string[], maxConcurrent: number): { state: DirectionGateState; admitted: string[] } {
  let state = EMPTY_DIRECTION_GATE
  const admitted: string[] = []
  for (const key of keys) {
    const outcome = admitDirection(state, key, maxConcurrent)
    state = outcome.state
    if (outcome.admitted) admitted.push(key)
  }
  return { state, admitted }
}

describe('后处理方向级并发闸', () => {
  it('名额没满：申请一个放一个', () => {
    const { state, admitted } = admitAll(['方向A', '方向B'], 2)

    expect(admitted).toEqual(['方向A', '方向B'])
    expect(state.running).toEqual(['方向A', '方向B'])
  })

  it('⭐ 名额满了就排队（不丢单）：第三个方向不被放行，也不改变已在跑的', () => {
    const { state, admitted } = admitAll(['方向A', '方向B', '方向C'], 2)

    expect(admitted).toEqual(['方向A', '方向B'])
    expect(state.running).toEqual(['方向A', '方向B'])
    // 排队的方向不占名额，释放一个之后它就能开工（这里是「不丢单」的可测部分）
    expect(isDirectionRunning(state, '方向C')).toBe(false)
    const afterRelease = releaseDirection(state, '方向A')
    expect(afterRelease.released).toBe(true)
    expect(admitDirection(afterRelease.state, '方向C', 2).admitted).toBe(true)
  })

  it('⭐ 同一方向同时最多一条：第二次申请排队，而不是两个实例抢同一批目录', () => {
    const first = admitDirection(EMPTY_DIRECTION_GATE, '方向A', 5)
    expect(first.admitted).toBe(true)

    const second = admitDirection(first.state, '方向A', 5)
    expect(second.admitted).toBe(false)
    // 关键：它没有因为「名额还够（1 < 5）」就放行 —— 这是本闸存在的核心
    expect(second.state.running).toEqual(['方向A'])
  })

  it('释放是幂等的：多释放一次不动别人的名额', () => {
    const started = admitAll(['方向A', '方向B'], 5).state

    const once = releaseDirection(started, '方向A')
    expect(once.released).toBe(true)
    expect(once.state.running).toEqual(['方向B'])

    const twice = releaseDirection(once.state, '方向A')
    expect(twice.released).toBe(false)
    expect(twice.state.running).toEqual(['方向B'])
  })

  it('上限被非法值污染时至少放行一个（不能让所有方向都开不了工）', () => {
    expect(normalizeDirectionConcurrency(0)).toBe(1)
    expect(normalizeDirectionConcurrency(Number.NaN)).toBe(1)
    expect(normalizeDirectionConcurrency(undefined)).toBe(1)
    expect(normalizeDirectionConcurrency(5.7)).toBe(5)

    expect(admitDirection(EMPTY_DIRECTION_GATE, '方向A', 0).admitted).toBe(true)
  })

  it('大写上限不做封顶：杰哥要求「不要限制」（配 999 就按 999 跑）', () => {
    const { state, admitted } = admitAll(
      Array.from({ length: 12 }, (_, i) => `方向${i}`),
      999,
    )

    expect(admitted).toHaveLength(12)
    expect(state.running).toHaveLength(12)
  })
})
