import { describe, expect, it } from 'vitest'
import type { GenerationSlotStatus } from '../types'
import { canSettleTaskOutputs, pickMoreCompleteOutputIds, planRestoredOutputAssignments } from './generatedOutputImages'

const slot = (index: number, status: GenerationSlotStatus, outputImageId?: string) => ({
  index,
  status,
  outputImageId,
})

describe('planRestoredOutputAssignments', () => {
  it('把已落盘但槽位未跟上的图片补到空闲槽位', () => {
    // 槽位快照落后：img-a 已产出，但槽位仍是 pending
    const result = planRestoredOutputAssignments([slot(0, 'pending'), slot(1, 'submitted')], ['img-a'])
    expect(result).toEqual([{ slotIndex: 0, imageId: 'img-a' }])
  })

  it('跳过槽位已认领的图片，只补缺失的那些', () => {
    const slots = [slot(0, 'done', 'img-a'), slot(1, 'pending'), slot(2, 'pending')]
    const result = planRestoredOutputAssignments(slots, ['img-a', 'img-b'])
    expect(result).toEqual([{ slotIndex: 1, imageId: 'img-b' }])
  })

  it('保持已落盘顺序，按槽位下标升序分配', () => {
    const slots = [slot(0, 'pending'), slot(1, 'pending'), slot(2, 'pending')]
    const result = planRestoredOutputAssignments(slots, ['img-a', 'img-b', 'img-c'])
    expect(result).toEqual([
      { slotIndex: 0, imageId: 'img-a' },
      { slotIndex: 1, imageId: 'img-b' },
      { slotIndex: 2, imageId: 'img-c' },
    ])
  })

  it('槽位不够时只补能放下的部分，不越界', () => {
    const slots = [slot(0, 'done', 'img-a'), slot(1, 'failed')]
    const result = planRestoredOutputAssignments(slots, ['img-a', 'img-b', 'img-c'])
    expect(result).toEqual([{ slotIndex: 1, imageId: 'img-b' }])
  })

  it('没有空闲槽位或没有已落盘图片时返回空', () => {
    expect(planRestoredOutputAssignments([slot(0, 'done', 'img-a')], ['img-a', 'img-b'])).toEqual([])
    expect(planRestoredOutputAssignments([slot(0, 'pending')], [])).toEqual([])
  })

  it('忽略空 id 与重复 id', () => {
    const result = planRestoredOutputAssignments([slot(0, 'pending'), slot(1, 'pending')], ['', 'img-a', 'img-a'])
    expect(result).toEqual([{ slotIndex: 0, imageId: 'img-a' }])
  })
})

describe('pickMoreCompleteOutputIds', () => {
  it('本轮产出更多时用本轮产出', () => {
    expect(pickMoreCompleteOutputIds(['a', 'b', 'c'], ['a'])).toEqual(['a', 'b', 'c'])
  })

  it('本轮产出更少时保留已落盘的一份，不让数量回退', () => {
    expect(pickMoreCompleteOutputIds(['a'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('数量相同时用本轮产出', () => {
    expect(pickMoreCompleteOutputIds(['x'], ['y'])).toEqual(['x'])
  })

  it('返回新数组，调用方 push 不会污染入参', () => {
    const persisted = ['a', 'b']
    const result = pickMoreCompleteOutputIds([], persisted)
    result.push('c')
    expect(persisted).toEqual(['a', 'b'])
    expect(result).toEqual(['a', 'b', 'c'])
  })
})

describe('canSettleTaskOutputs', () => {
  it('运行中的任务允许结算', () => {
    expect(canSettleTaskOutputs({ status: 'running' })).toBe(true)
  })

  it('任务已删除（undefined）不允许结算', () => {
    expect(canSettleTaskOutputs(undefined)).toBe(false)
  })

  it('用户主动停止（error 且无超时标记）不允许结算', () => {
    expect(canSettleTaskOutputs({ status: 'error' })).toBe(false)
  })

  it('看门狗超时终结后仍允许结算：超时只给用户交代，不代表请求失败', () => {
    expect(canSettleTaskOutputs({ status: 'done', watchdogTimedOutAt: 1700000000000 })).toBe(true)
    expect(canSettleTaskOutputs({ status: 'error', watchdogTimedOutAt: 1700000000000 })).toBe(true)
  })

  it('标记为 0 也算存在（不能用 falsy 判断）', () => {
    expect(canSettleTaskOutputs({ status: 'done', watchdogTimedOutAt: 0 })).toBe(true)
  })
})
