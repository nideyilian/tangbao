import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedAsset, GeneratedAssetOrigin, TaskParams, TaskRecord, WorkspaceTab } from '../types'
import { cursorForTask, findOrphanAssets, splitTaskCursor } from './assetReconciliation'

const mock = vi.hoisted(() => ({
  upsertFromTask: vi.fn(),
}))

vi.mock('./assetLibraryRepository', () => mock)

import { reconcileGeneratedAssets } from './assetReconciliation'

function makeTask(id: string, createdAt = 1000): TaskRecord {
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
    createdAt,
    finishedAt: 2000,
    elapsed: 1000,
  }
}

function makeTab(id: string, name: string, tasks: TaskRecord[]): WorkspaceTab {
  return {
    id,
    name,
    groupId: null,
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    params: {} as TaskParams,
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks,
    createdAt: 1,
    updatedAt: 1,
    order: 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.upsertFromTask.mockResolvedValue([])
})

describe('reconcileGeneratedAssets', () => {
  it('processes all tasks in creation order and reports progress per batch', async () => {
    const tasks = [makeTask('c', 3000), makeTask('a', 1000), makeTask('b', 2000)]
    const onProgress = vi.fn()
    const result = await reconcileGeneratedAssets({
      tasks,
      workspaceTabs: [],
      batchSize: 2,
      onProgress,
    })

    expect(result.processed).toBe(3)
    expect(mock.upsertFromTask.mock.calls.map(([task]) => task.id)).toEqual(['a', 'b', 'c'])
    expect(onProgress).toHaveBeenLastCalledWith(3, 3)
    // 全部成功：游标推进到最后一个已终结任务
    expect(result.nextCursor).toBe(cursorForTask(makeTask('c', 3000)))
    expect(result.failedTasks).toBe(0)
  })

  it('derives workspace tab context from task ownership', async () => {
    const tab = makeTab('tab-1', '广告组', [makeTask('task-1')])
    await reconcileGeneratedAssets({ tasks: [makeTask('task-1')], workspaceTabs: [tab] })

    const [task, context] = mock.upsertFromTask.mock.calls[0]
    expect(task.id).toBe('task-1')
    expect(context.workspaceTabId).toBe('tab-1')
    expect(context.workspaceTabName).toBe('广告组')
  })

  it('continues after a failing task and reports failure count', async () => {
    mock.upsertFromTask.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([{ id: 'img-2' }])
    const result = await reconcileGeneratedAssets({
      tasks: [makeTask('a'), makeTask('b')],
      workspaceTabs: [],
    })

    expect(result.failedTasks).toBe(1)
    // 失败任务 id 要能被调用方带进错误文案：红条上只写「N 个任务索引失败」时无从定位
    expect(result.failedTaskIds).toEqual(['a'])
    expect(result.updatedAssets).toBe(1)
    expect(result.processed).toBe(2)
    // 有失败：游标必须清空（下次全量重扫兜底）
    expect(result.nextCursor).toBeNull()
  })

  it('handles empty task list', async () => {
    const result = await reconcileGeneratedAssets({ tasks: [], workspaceTabs: [] })
    expect(result.processed).toBe(0)
    expect(mock.upsertFromTask).not.toHaveBeenCalled()
    expect(result.nextCursor).toBeNull()
  })

  it('only processes tasks created after the cursor (incremental)', async () => {
    const tasks = [makeTask('a', 1000), makeTask('b', 2000), makeTask('c', 3000)]
    // 游标位于 b 之后：只应处理 c
    const result = await reconcileGeneratedAssets({
      tasks,
      workspaceTabs: [],
      cursor: cursorForTask(makeTask('b', 2000)),
    })

    expect(mock.upsertFromTask.mock.calls.map(([task]) => task.id)).toEqual(['c'])
    expect(result.processed).toBe(1)
    expect(result.nextCursor).toBe(cursorForTask(makeTask('c', 3000)))
  })

  it('keeps the cursor when there are no new tasks', async () => {
    const tasks = [makeTask('a', 1000), makeTask('b', 2000)]
    const result = await reconcileGeneratedAssets({
      tasks,
      workspaceTabs: [],
      cursor: cursorForTask(makeTask('b', 2000)),
    })

    expect(mock.upsertFromTask).not.toHaveBeenCalled()
    expect(result.processed).toBe(0)
    expect(result.nextCursor).toBe(cursorForTask(makeTask('b', 2000)))
  })

  it('advances the cursor past running tasks and records them in pendingTaskIds', async () => {
    const running = { ...makeTask('r', 1500), finishedAt: null }
    const done = makeTask('d', 2000)
    const result = await reconcileGeneratedAssets({ tasks: [running, done], workspaceTabs: [] })

    expect(result.failedTasks).toBe(0)
    // 游标推进到最后一个任务（运行中任务不阻塞游标）
    expect(result.nextCursor).toBe(cursorForTask(done))
    // 运行中任务被记入 pendingTaskIds，下次按 id 强制重扫
    expect(result.pendingTaskIds).toEqual(['r'])
  })

  it('re-scans previously pending (running) tasks by id even when they fall before the cursor', async () => {
    const running = { ...makeTask('r', 1500), finishedAt: null }
    const a = makeTask('a', 1000)
    const b = makeTask('b', 2000)
    const result = await reconcileGeneratedAssets({
      tasks: [running, a, b],
      workspaceTabs: [],
      cursor: cursorForTask(b),
      pendingTaskIds: ['r'],
    })

    // 游标在 b：a、b 已覆盖；r 在游标前但通过 pendingTaskIds 强制重扫
    expect(mock.upsertFromTask.mock.calls.map(([task]) => task.id)).toEqual(['r'])
    expect(result.pendingTaskIds).toEqual(['r'])
  })

  it('round-trips cursor encode/decode', () => {
    const task = makeTask('task-42', 123456789)
    const cursor = cursorForTask(task)
    expect(splitTaskCursor(cursor)).toEqual({ createdAt: 123456789, taskId: 'task-42' })
  })
})

function makeOrigin(taskId: string): GeneratedAssetOrigin {
  return {
    key: `${taskId}:0`,
    taskId,
    outputSlot: 0,
    taskCreatedAt: 1000,
    taskFinishedAt: 2000,
    sourceMode: 'gallery',
    prompt: 'p',
    requestedParams: {} as TaskParams,
    inputImageIds: [],
  }
}

function makeAsset(id: string, taskId: string, status: GeneratedAsset['status'] = 'active'): GeneratedAsset {
  const origin = makeOrigin(taskId)
  return {
    id,
    imageId: id,
    status,
    createdAt: 1000,
    updatedAt: 1000,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [origin],
    primaryOriginKey: origin.key,
    parentAssetIds: [],
    metadataVersion: 1,
  }
}

/** 反向对账：素材在、来源任务不在 —— 这批图在卡片视图里没有归属，此前完全静默。 */
describe('findOrphanAssets', () => {
  it('把「来源任务已不存在」的素材挑出来', () => {
    const report = findOrphanAssets(
      [makeAsset('a', 't1'), makeAsset('b', 'gone-task'), makeAsset('c', 't1')],
      new Set(['t1']),
    )
    expect(report.orphanAssetIds).toEqual(['b'])
    expect(report.sourceMissingAssetIds).toEqual([])
    expect(report.scanned).toBe(3)
  })

  it('来源快照连 taskId 都没有的素材单独归一类', () => {
    const report = findOrphanAssets([makeAsset('a', ''), makeAsset('b', 't1')], new Set(['t1']))
    expect(report.orphanAssetIds).toEqual([])
    expect(report.sourceMissingAssetIds).toEqual(['a'])
  })

  it('回收站里的素材不算孤儿（它们本来就不该出现在卡片视图）', () => {
    const report = findOrphanAssets([makeAsset('trashed', 'gone-task', 'trashed')], new Set())
    expect(report.orphanAssetIds).toEqual([])
    expect(report.sourceMissingAssetIds).toEqual([])
    expect(report.scanned).toBe(1)
  })

  it('全部有来源时两个清单都为空', () => {
    const report = findOrphanAssets([makeAsset('a', 't1'), makeAsset('b', 't2')], new Set(['t1', 't2']))
    expect(report).toEqual({ scanned: 2, orphanAssetIds: [], sourceMissingAssetIds: [] })
  })
})
