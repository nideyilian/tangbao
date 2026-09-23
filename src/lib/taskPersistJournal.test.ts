import { describe, expect, it } from 'vitest'
import type { TaskParams, TaskRecord } from '../types'
import {
  MAX_PENDING_TASK_PERSIST_ENTRIES,
  parsePendingTaskPersistJournal,
  replayPendingTaskPersists,
  serializePendingTaskPersistJournal,
  upsertPendingTaskPersist,
} from './taskPersistJournal'

function makeTask(id: string): TaskRecord {
  return {
    id,
    prompt: 'p',
    params: {} as TaskParams,
    inputImageIds: [],
    outputImages: ['img-1'],
    maskTargetImageId: null,
    maskImageId: null,
    status: 'done',
    error: null,
    createdAt: 1000,
    finishedAt: 2000,
    elapsed: 1000,
  }
}

describe('upsertPendingTaskPersist', () => {
  it('记下一条落盘失败的任务', () => {
    const entries = upsertPendingTaskPersist([], makeTask('t1'), 5000)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.task.id).toBe('t1')
    expect(entries[0]?.failedAt).toBe(5000)
    expect(entries[0]?.attempts).toBe(1)
  })

  it('同一任务重复失败不重复堆条目，只累加次数并刷新快照', () => {
    const first = upsertPendingTaskPersist([], makeTask('t1'), 5000)
    const second = upsertPendingTaskPersist(first, makeTask('t1'), 9000)
    expect(second).toHaveLength(1)
    expect(second[0]?.attempts).toBe(2)
    expect(second[0]?.failedAt).toBe(9000)
  })

  it('超过上限时丢最旧的，保留最近的失败', () => {
    let entries = [] as ReturnType<typeof upsertPendingTaskPersist>
    for (let index = 0; index < MAX_PENDING_TASK_PERSIST_ENTRIES + 5; index++) {
      entries = upsertPendingTaskPersist(entries, makeTask(`t${index}`), 1000 + index)
    }
    expect(entries).toHaveLength(MAX_PENDING_TASK_PERSIST_ENTRIES)
    expect(entries[0]?.task.id).toBe('t5')
    expect(entries[entries.length - 1]?.task.id).toBe(`t${MAX_PENDING_TASK_PERSIST_ENTRIES + 4}`)
  })
})

describe('serialize / parse 往返', () => {
  it('空清单序列化成 undefined（调用方据此把 journal 标成 completed）', () => {
    expect(serializePendingTaskPersistJournal([])).toBeUndefined()
    expect(parsePendingTaskPersistJournal(undefined)).toEqual([])
  })

  it('往返后任务快照不丢字段', () => {
    const entries = upsertPendingTaskPersist([], makeTask('t1'), 5000)
    const restored = parsePendingTaskPersistJournal(serializePendingTaskPersistJournal(entries))
    expect(restored).toEqual(entries)
    expect(restored[0]?.task.outputImages).toEqual(['img-1'])
  })

  it('坏 JSON / 非数组 / 缺字段一律当空处理，不让它拖垮启动', () => {
    expect(parsePendingTaskPersistJournal('{oops')).toEqual([])
    expect(parsePendingTaskPersistJournal('{"a":1}')).toEqual([])
    expect(parsePendingTaskPersistJournal('[{"failedAt":1}]')).toEqual([])
  })
})

describe('replayPendingTaskPersists', () => {
  it('写成功的移出清单，写失败的留下且次数 +1', async () => {
    const entries = [
      { task: makeTask('ok'), failedAt: 1, attempts: 1 },
      { task: makeTask('bad'), failedAt: 1, attempts: 1 },
    ]
    const write = async (task: TaskRecord) => {
      if (task.id === 'bad') throw new Error('boom')
    }
    const result = await replayPendingTaskPersists(entries, write, 7000)
    expect(result.persisted).toEqual(['ok'])
    expect(result.stillPending).toHaveLength(1)
    expect(result.stillPending[0]?.task.id).toBe('bad')
    expect(result.stillPending[0]?.attempts).toBe(2)
    expect(result.stillPending[0]?.failedAt).toBe(7000)
  })

  it('全部写成功时不留残留', async () => {
    const entries = [{ task: makeTask('a'), failedAt: 1, attempts: 3 }]
    const result = await replayPendingTaskPersists(entries, async () => {}, 7000)
    expect(result.persisted).toEqual(['a'])
    expect(result.stillPending).toEqual([])
  })

  it('串行重放：后一条不会与前一条并发', async () => {
    const order: string[] = []
    let inFlight = false
    const entries = [
      { task: makeTask('a'), failedAt: 1, attempts: 1 },
      { task: makeTask('b'), failedAt: 1, attempts: 1 },
    ]
    await replayPendingTaskPersists(
      entries,
      async (task) => {
        expect(inFlight).toBe(false)
        inFlight = true
        await new Promise((resolve) => setTimeout(resolve, 1))
        order.push(task.id)
        inFlight = false
      },
      7000,
    )
    expect(order).toEqual(['a', 'b'])
  })
})
