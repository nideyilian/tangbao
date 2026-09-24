import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  type GeneratedAsset,
  type GeneratedAssetOrigin,
  type SopBatchSnapshot,
  type TaskRecord,
} from '../types'
import {
  buildAssetBatchGroups,
  buildAssetBatchOverview,
  collectTaskCardAssets,
  countLiveTaskOutputs,
  getPrimaryOrigin,
  hasTaskFailure,
  resolveTaskCardScopeKey,
  truncatePrompt,
} from './assetBatchGrouping'

function makeOrigin(taskId: string, outputSlot: number, prompt = '一只猫'): GeneratedAssetOrigin {
  return {
    key: `${taskId}:${outputSlot}`,
    taskId,
    outputSlot,
    taskCreatedAt: 1000,
    taskFinishedAt: 2000,
    sourceMode: 'gallery',
    prompt,
    requestedParams: DEFAULT_PARAMS,
    inputImageIds: [],
  }
}

function makeAsset(id: string, origin: GeneratedAssetOrigin, createdAt = 1000): GeneratedAsset {
  return {
    id,
    imageId: id,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
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

function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: `提示词 ${id}`,
    params: DEFAULT_PARAMS,
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1000,
    finishedAt: 2000,
    elapsed: 1000,
    ...overrides,
  }
}

const snapshot: SopBatchSnapshot = {
  id: 'snap-1',
  batchId: 'batch-1',
  title: '品牌海报合集',
  tags: ['海报', '新品'],
  promptGroup: { id: 'folder-1', name: '品牌 > 海报' },
  sop: { id: 'sop-1', name: 'SOP 海报', description: '', content: '' },
  brief: '',
  referenceImageIds: [],
  promptCount: 2,
  imagesPerPrompt: 1,
  prompts: [],
  params: DEFAULT_PARAMS,
  workspaceTabId: null,
  createdAt: 1000,
  status: 'ready',
}

describe('buildAssetBatchGroups', () => {
  it('groups assets by SOP batch and passes through snapshot promptGroup', () => {
    const taskA = makeTask('t1', {
      sopBatch: {
        batchId: 'batch-1',
        snapshotId: 'snap-1',
        sopId: 'sop-1',
        sopName: 'SOP 海报',
        promptIndex: 0,
        promptCount: 2,
      },
    })
    const taskB = makeTask('t2', {
      sopBatch: {
        batchId: 'batch-1',
        snapshotId: 'snap-1',
        sopId: 'sop-1',
        sopName: 'SOP 海报',
        promptIndex: 1,
        promptCount: 2,
      },
    })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-b', makeOrigin('t2', 0), 2000), makeAsset('img-a', makeOrigin('t1', 0), 1000)],
      new Map([
        ['t1', taskA],
        ['t2', taskB],
      ]),
      new Map([['snap-1', snapshot]]),
    )

    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group?.kind).toBe('sop-batch')
    expect(group?.title).toBe('品牌海报合集')
    expect(group?.promptGroup).toEqual({ id: 'folder-1', name: '品牌 > 海报' })
    expect(group?.snapshotTitle).toBe('品牌海报合集')
    expect(group?.taskIds).toEqual(['t1', 't2'])
    expect(group?.assets.map((asset) => asset.id)).toEqual(['img-a', 'img-b'])
    expect(group?.summary).toEqual({ total: 2, running: 0, completed: 2, failed: 0 })
  })

  it('keeps orphan assets grouped by their origin task id when the task is deleted', () => {
    const groups = buildAssetBatchGroups(
      [
        makeAsset('img-1', makeOrigin('gone-task', 0, '已删除任务的提示词')),
        makeAsset('img-2', makeOrigin('gone-task', 1, '已删除任务的提示词')),
      ],
      new Map(),
      new Map(),
    )

    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group?.kind).toBe('orphan')
    expect(group?.title).toContain('已删除任务的提示词')
    expect(group?.task).toBeNull()
    expect(group?.taskIds).toEqual([])
    expect(group?.assets.map((asset) => asset.id)).toEqual(['img-1', 'img-2'])
  })

  it('groups regular tasks separately from batches and sorts newest first', () => {
    const plainTask = makeTask('t3', { createdAt: 3000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-x', makeOrigin('t3', 0), 3000)],
      new Map([['t3', plainTask]]),
      new Map(),
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind).toBe('task')
    expect(groups[0]?.taskIds).toEqual(['t3'])
    expect(groups[0]?.title).toContain('提示词 t3')
  })

  it('falls back to SOP name when no snapshot and no prompt is available', () => {
    const task = makeTask('t4', {
      sopBatch: { batchId: 'batch-9', sopId: 'sop-9', sopName: '秋季上新', promptIndex: 0, promptCount: 1 },
    })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-y', makeOrigin('t4', 0, ''))],
      new Map([['t4', task]]),
      new Map(),
    )
    expect(groups[0]?.title).toBe('秋季上新')
  })

  it('sorts groups by task submission time (position fixed at creation)', () => {
    const taskOld = makeTask('t-old')
    const taskNew = makeTask('t-new', { createdAt: 9000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-new', makeOrigin('t-new', 0), 9000), makeAsset('img-old', makeOrigin('t-old', 0), 1000)],
      new Map([
        ['t-old', taskOld],
        ['t-new', taskNew],
      ]),
      new Map(),
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-new', 'task:t-old'])
  })

  it('keeps card position fixed at submission time even when assets finish later (no reorder by progress)', () => {
    // 任务 A 先提交（t=1000）但生成慢、素材完成时间晚（9000）；任务 B 后提交（t=8000）、素材 8000。
    // 位置应在创建（提交）时确定：B 在上、A 在下，不能因为 A 的素材晚生成而把 A 顶到 B 前面。
    const taskA = makeTask('t-a', { createdAt: 1000 })
    const taskB = makeTask('t-b', { createdAt: 8000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-a', makeOrigin('t-a', 0), 9000), makeAsset('img-b', makeOrigin('t-b', 0), 8000)],
      new Map([
        ['t-a', taskA],
        ['t-b', taskB],
      ]),
      new Map(),
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-b', 'task:t-a'])
    // 组时间徽章显示任务提交时间而不是素材生成时间
    expect(groups.map((group) => group.createdAt)).toEqual([8000, 1000])
  })

  it('pins a just-submitted running task at the top by submission time (0.7.56 新任务置顶)', () => {
    // 回归：生成中的任务没有素材，组 createdAt 若为 0 会沉到所有有图任务下方，
    // 结束后（成功/部分失败）又因素材时间跳到最上方 → 卡片位置跳动。
    const olderDone = makeTask('t-done', { createdAt: 1000 })
    const freshRunning = makeTask('t-running', { status: 'running', createdAt: 9000 })
    const groups = buildAssetBatchGroups(
      [makeAsset('img-old', makeOrigin('t-done', 0), 2000)],
      new Map([
        ['t-done', olderDone],
        ['t-running', freshRunning],
      ]),
      new Map(),
      { includeTaskless: () => true },
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-running', 'task:t-done'])
    // 运行中卡片的时间徽章显示任务提交时间，而不是 1970 年
    expect(groups[0]?.createdAt).toBe(9000)
  })

  it('uses task submission time as the sort baseline for failed taskless groups', () => {
    const failedOld = makeTask('t-failed-old', { status: 'error', error: 'x', createdAt: 1000 })
    const failedNew = makeTask('t-failed-new', { status: 'error', error: 'x', createdAt: 8000 })
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-failed-old', failedOld],
        ['t-failed-new', failedNew],
      ]),
      new Map(),
      { includeTaskless: () => true },
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-failed-new', 'task:t-failed-old'])
    expect(groups.map((group) => group.createdAt)).toEqual([8000, 1000])
  })

  it('keeps failed task cards even when the includeTaskless predicate rejects them (failure overrides scope)', () => {
    // 用户要求：失败任务卡在任何作用域（含素材专属作用域）都保留，不能因切换文件夹/筛选消失。
    // 模拟 AssetBatchView 的 includeTaskless：素材专属作用域下失败任务仍放行。
    const failed = makeTask('t-failed', { status: 'error', error: '服务商超时' })
    const running = makeTask('t-running', { status: 'running' })
    const scopeRejectAllExceptFailure = (task: TaskRecord) => task.status === 'error'
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-failed', failed],
        ['t-running', running],
      ]),
      new Map(),
      { includeTaskless: scopeRejectAllExceptFailure },
    )
    expect(groups.map((group) => group.id)).toEqual(['task:t-failed'])
  })

  it('keeps partially failed task cards when their assets were cleaned up (done + batchItemErrors)', () => {
    // 部分失败任务 status=done 但含失败槽位：素材被清理后任务卡仍应保留（hasTaskFailure 放行）。
    const partialFailed = makeTask('t-partial', {
      status: 'done',
      outputImages: [],
      batchItemStatuses: ['done', 'error'],
      batchItemErrors: [{ index: 1, error: '第二张失败' }],
    })
    const groups = buildAssetBatchGroups([], new Map([['t-partial', partialFailed]]), new Map(), {
      includeTaskless: () => true,
    })
    expect(groups.map((group) => group.id)).toEqual(['task:t-partial'])
    expect(groups[0]?.summary.failed).toBe(0) // status=done → 计为 completed
  })

  it('drops truly completed taskless tasks (done without failure) as historical empty tasks', () => {
    const doneEmpty = makeTask('t-done', { status: 'done', outputImages: [] })
    const groups = buildAssetBatchGroups([], new Map([['t-done', doneEmpty]]), new Map(), {
      includeTaskless: () => true,
    })
    expect(groups).toEqual([])
  })

  // TB-121：批次成员由「任务记录」决定，不由「素材」决定。
  // 真实事故（2026-09-23）：批次 150 条提示词里只有 74 条的图能查到，卡片就显示「整批 74 条」，
  // 而点开批次详情弹窗写的是 150 条——同一批次两个数字。
  describe('SOP 批次成员补全（TB-121）', () => {
    const sopBatchMeta = (promptIndex: number) => ({
      batchId: 'batch-1',
      snapshotId: 'snap-1',
      sopId: 'sop-1',
      sopName: 'SOP 海报',
      promptIndex,
      promptCount: 3,
    })

    it('没出图的条目不会被从批次里抹掉（即使没传 includeTaskless）', () => {
      const withImage = makeTask('t1', { sopBatch: sopBatchMeta(0) })
      const doneWithoutImage = makeTask('t2', { sopBatch: sopBatchMeta(1), status: 'done', outputImages: [] })
      const failed = makeTask('t3', { sopBatch: sopBatchMeta(2), status: 'error', error: '服务商超时' })

      const groups = buildAssetBatchGroups(
        [makeAsset('img-a', makeOrigin('t1', 0), 1000)],
        new Map([
          ['t1', withImage],
          ['t2', doneWithoutImage],
          ['t3', failed],
        ]),
        new Map([['snap-1', snapshot]]),
      )

      expect(groups).toHaveLength(1)
      // 三条都在，而不是只剩「有图的那一条」
      expect(groups[0]?.taskIds).toEqual(['t1', 't2', 't3'])
      // 卡片上的「整批 N 条提示词」= 全部成员
      expect(groups[0]?.summary).toEqual({ total: 3, running: 0, completed: 2, failed: 1 })
    })

    it('不跨批次吸血：别的批次的任务不会被并进来', () => {
      const taskA = makeTask('t1', { sopBatch: sopBatchMeta(0) })
      const taskB = makeTask('t2', {
        sopBatch: {
          batchId: 'b2',
          snapshotId: 's2',
          sopId: 'sop-2',
          sopName: '另一批',
          promptIndex: 0,
          promptCount: 1,
        },
      })

      const groups = buildAssetBatchGroups(
        [makeAsset('img-a', makeOrigin('t1', 0))],
        new Map([
          ['t1', taskA],
          ['t2', taskB],
        ]),
        new Map(),
      )

      expect(groups).toHaveLength(1)
      expect(groups[0]?.taskIds).toEqual(['t1'])
    })

    it('完全无产出的批次不凭空建卡（历史空批次不刷屏）', () => {
      const empty = makeTask('t1', { sopBatch: sopBatchMeta(0) })
      expect(buildAssetBatchGroups([], new Map([['t1', empty]]), new Map())).toEqual([])
    })

    it('同一提示词重试过只算一条（与批次详情弹窗同一套去重口径）', () => {
      // 单张重试（retryTask）沿用同组批次号，会在同一批次留下同一 promptIndex 的第二条任务。
      // 卡片若不去重，「整批 N 条提示词」会随重试次数虚涨 —— 又变成与弹窗不一致的两个数字。
      const firstAttempt = makeTask('t1', { sopBatch: sopBatchMeta(0), createdAt: 1000 })
      const retried = makeTask('t1-retry', { sopBatch: sopBatchMeta(0), createdAt: 5000 })
      const secondPrompt = makeTask('t2', { sopBatch: sopBatchMeta(1), createdAt: 2000 })

      const groups = buildAssetBatchGroups(
        [makeAsset('img-a', makeOrigin('t1', 0), 1000), makeAsset('img-b', makeOrigin('t1-retry', 0), 5000)],
        new Map([
          ['t1', firstAttempt],
          ['t1-retry', retried],
          ['t2', secondPrompt],
        ]),
        new Map([['snap-1', snapshot]]),
      )

      expect(groups).toHaveLength(1)
      // 保留最新一次尝试，旧的那条不再计入「整批 N 条」
      expect(groups[0]?.taskIds).toEqual(['t1-retry', 't2'])
      expect(groups[0]?.summary.total).toBe(2)
    })

    it('批次位置按组内最早提交时间算（补进来的成员也算）', () => {
      const later = makeTask('t1', { sopBatch: sopBatchMeta(0), createdAt: 8000 })
      const earliest = makeTask('t2', { sopBatch: sopBatchMeta(1), createdAt: 1000, status: 'done', outputImages: [] })

      const groups = buildAssetBatchGroups(
        [makeAsset('img-a', makeOrigin('t1', 0), 8000)],
        new Map([
          ['t1', later],
          ['t2', earliest],
        ]),
        new Map([['snap-1', snapshot]]),
      )

      expect(groups[0]?.createdAt).toBe(1000)
    })
  })
})

/**
 * 任务卡「不因素材不可见而消失 / 缩水」（TB-129，杰哥 2026-09-24）。
 *
 * 需求原文：「任务卡禁止自动消失，数量必须持续存在，只有当我手动删除整张卡片或删除卡内的
 * 某些图片时，才根据我的操作相应地改变和显示数量」。
 *
 * 修之前的病根：建卡的主体是**素材**，任务只是挂在素材上的标签 ⇒ 图一被拖到别的文件夹、
 * 或在还没加载的分页里，卡就凭空消失（`includeTaskless` 当时还把已成功完成的任务整类跳过）。
 */
describe('任务卡以任务记录为准（TB-129）', () => {
  it('有产出的已完成任务：图不在查询结果里也建卡，数量按任务记录算', () => {
    const task = makeTask('t1', { outputImages: ['img-1', 'img-2', 'img-3'] })
    // 查询结果里只挂着 1 张 —— 另外 2 张被拖到了别的文件夹 / 落在没加载的分页里
    const groups = buildAssetBatchGroups(
      [makeAsset('img-1', makeOrigin('t1', 0))],
      new Map([['t1', task]]),
      new Map(),
      {
        includeTaskless: () => true,
      },
    )

    expect(groups).toHaveLength(1)
    // 挂图仍然只渲染查得到的那 1 张（图片真实性优先）
    expect(groups[0]?.assets).toHaveLength(1)
    // 但**数量**以任务记录为准，不随「这张图现在能不能查到」缩水
    expect(groups[0]?.outputCount).toBe(3)
  })

  it('卡内的图一张都查不到时，卡片仍然在（不再凭空消失）', () => {
    const task = makeTask('t1', { outputImages: ['img-1', 'img-2'] })
    const groups = buildAssetBatchGroups([], new Map([['t1', task]]), new Map(), {
      includeTaskless: () => true,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind).toBe('task')
    expect(groups[0]?.assets).toHaveLength(0)
    expect(groups[0]?.outputCount).toBe(2)
  })

  it('删掉卡内某张图（槽位被置空）后数量减一 —— 而槽位数组长度不变', () => {
    // `patchTaskForPurgedSlots` 的产物：槽位置空、数组长度保持 3
    const task = makeTask('t1', { outputImages: ['img-1', undefined as never, 'img-3'] })

    expect(countLiveTaskOutputs(task)).toBe(2)
    expect(task.outputImages).toHaveLength(3)

    const groups = buildAssetBatchGroups(
      [makeAsset('img-1', makeOrigin('t1', 0)), makeAsset('img-3', makeOrigin('t1', 2))],
      new Map([['t1', task]]),
      new Map(),
      { includeTaskless: () => true },
    )
    expect(groups[0]?.outputCount).toBe(2)
  })

  it('从未产出的历史空任务仍然不建卡（守住「不被历史任务刷屏」）', () => {
    const empty = makeTask('t-empty', { status: 'done', outputImages: [] })
    const groups = buildAssetBatchGroups([], new Map([['t-empty', empty]]), new Map(), {
      includeTaskless: () => true,
    })
    expect(groups).toHaveLength(0)
  })

  it('速览的图片数与卡片同一个口径（不退回可见素材数）', () => {
    const task = makeTask('t1', { outputImages: ['img-1', 'img-2', 'img-3'] })
    const tasksById = new Map([['t1', task]])
    const groups = buildAssetBatchGroups([makeAsset('img-1', makeOrigin('t1', 0))], tasksById, new Map(), {
      includeTaskless: () => true,
    })

    expect(buildAssetBatchOverview(groups, tasksById).assetCount).toBe(3)
  })
})

describe('hasTaskFailure', () => {
  it('detects fully failed and partially failed tasks', () => {
    expect(hasTaskFailure(makeTask('a', { status: 'error', error: 'x' }))).toBe(true)
    expect(
      hasTaskFailure(
        makeTask('b', {
          status: 'done',
          batchItemStatuses: ['done', 'error'],
          batchItemErrors: [{ index: 1, error: 'x' }],
        }),
      ),
    ).toBe(true)
    expect(hasTaskFailure(makeTask('c', { status: 'done' }))).toBe(false)
    expect(hasTaskFailure(makeTask('d', { status: 'running' }))).toBe(false)
    expect(hasTaskFailure(makeTask('e', { status: 'done', batchItemStatuses: ['done', 'done'] }))).toBe(false)
    expect(
      hasTaskFailure(
        makeTask('f', {
          status: 'error',
          error: '缩略图加载超时',
          params: { ...makeTask('base').params, n: 1 },
          outputImages: ['img-ok'],
        }),
      ),
    ).toBe(false)
  })
})

describe('buildAssetBatchOverview', () => {
  it('aggregates group/task/asset counts and task statuses', () => {
    const taskDone = makeTask('t1')
    const taskRunning = makeTask('t2', { status: 'running' })
    const taskFailed = makeTask('t3', { status: 'error' })
    const groups = buildAssetBatchGroups(
      [
        makeAsset('img-1', makeOrigin('t1', 0)),
        makeAsset('img-2', makeOrigin('t2', 0)),
        makeAsset('img-3', makeOrigin('t3', 0)),
        makeAsset('img-4', makeOrigin('gone', 0)),
      ],
      new Map([
        ['t1', taskDone],
        ['t2', taskRunning],
        ['t3', taskFailed],
      ]),
      new Map(),
    )
    const overview = buildAssetBatchOverview(
      groups,
      new Map([
        ['t1', taskDone],
        ['t2', taskRunning],
        ['t3', taskFailed],
      ]),
    )
    expect(overview.groupCount).toBe(4) // 3 个任务组 + 1 个孤儿组
    expect(overview.taskCount).toBe(3) // 孤儿组不占任务数
    expect(overview.assetCount).toBe(4)
    expect(overview.completed).toBe(1)
    expect(overview.running).toBe(1)
    expect(overview.failed).toBe(1)
  })

  it('includes active tasks without assets so running/failed tasks stay visible', () => {
    const taskRunning = makeTask('t-running', { status: 'running' })
    const taskFailed = makeTask('t-failed', { status: 'error', error: '服务商超时' })
    const taskStopped = makeTask('t-stopped', { status: 'error', error: '任务已停止' })
    const taskDone = makeTask('t-done', { status: 'done' })
    // t-running/t-failed 无素材（提交后/失败后没有产出），t-done 也无素材（历史空任务不补）
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-running', taskRunning],
        ['t-failed', taskFailed],
        ['t-stopped', taskStopped],
        ['t-done', taskDone],
      ]),
      new Map(),
      { includeTaskless: () => true },
    )

    const ids = groups.map((group) => group.id)
    expect(ids).toContain('task:t-running')
    expect(ids).toContain('task:t-failed')
    expect(ids).toContain('task:t-stopped')
    expect(ids).not.toContain('task:t-done')
    const failedGroup = groups.find((group) => group.id === 'task:t-failed')!
    expect(failedGroup.assets).toEqual([])
    expect(failedGroup.task?.error).toBe('服务商超时')
  })

  it('applies the includeTaskless predicate (project scope only includes its own tasks)', () => {
    const taskInProject = makeTask('t-in', { status: 'running', defaultCollectionId: 'col-a' })
    const taskElsewhere = makeTask('t-out', { status: 'running', defaultCollectionId: 'col-b' })
    const taskNone = makeTask('t-none', { status: 'running' })
    const groups = buildAssetBatchGroups(
      [],
      new Map([
        ['t-in', taskInProject],
        ['t-out', taskElsewhere],
        ['t-none', taskNone],
      ]),
      new Map(),
      { includeTaskless: (task) => task.defaultCollectionId === 'col-a' },
    )
    const ids = groups.map((group) => group.id)
    expect(ids).toContain('task:t-in')
    expect(ids).not.toContain('task:t-out')
    expect(ids).not.toContain('task:t-none')
  })

  it('keeps the default (no options) behavior without adding taskless tasks', () => {
    const taskRunning = makeTask('t-running', { status: 'running' })
    const groups = buildAssetBatchGroups([], new Map([['t-running', taskRunning]]), new Map())
    expect(groups).toEqual([])
  })
})

describe('getPrimaryOrigin', () => {
  it('prefers the primary origin key and falls back to the first origin', () => {
    const primary = makeOrigin('t1', 0, '主来源')
    const secondary = makeOrigin('t2', 0, '次来源')
    const asset = { ...makeAsset('a', secondary), primaryOriginKey: primary.key, origins: [secondary, primary] }
    expect(getPrimaryOrigin(asset)?.prompt).toBe('主来源')
    expect(getPrimaryOrigin({ ...asset, primaryOriginKey: null })?.prompt).toBe('次来源')
  })
})

describe('truncatePrompt', () => {
  it('collapses whitespace and truncates long prompts', () => {
    expect(truncatePrompt('  高  清   猫  ')).toBe('高 清 猫')
    const long = 'x'.repeat(120)
    expect(truncatePrompt(long)).toBe(`${'x'.repeat(80)}…`)
  })
})

/** 素材详情弹窗底部「同一任务」缩略图条的口径：与任务卡片视图里那张卡一致。 */
describe('resolveTaskCardScopeKey / collectTaskCardAssets', () => {
  const sopMeta = (batchId: string, snapshotId: string, promptIndex: number) => ({
    batchId,
    snapshotId,
    sopId: 'sop-1',
    sopName: '夏季主图 SOP',
    promptIndex,
    promptCount: 2,
  })

  it('普通任务卡片 = 该次生成的输出图（同一 taskId）', () => {
    const tasks = [makeTask('t1'), makeTask('t2')]
    expect(resolveTaskCardScopeKey(tasks, 't1')).toBe('t1')
    expect(resolveTaskCardScopeKey(tasks, undefined)).toBe('')
  })

  it('SOP 批次卡片 = 同一批次（snapshotId / batchId）的全部任务', () => {
    const tasks = [
      makeTask('t2', { sopBatch: sopMeta('b1', 's1', 1) }),
      makeTask('t1', { sopBatch: sopMeta('b1', 's1', 0) }),
      makeTask('t3', { sopBatch: sopMeta('b2', 's2', 0) }),
      makeTask('t4'),
    ]
    expect(resolveTaskCardScopeKey(tasks, 't1')).toBe('t1|t2')
    // 非 SOP 任务不受批次扩展影响
    expect(resolveTaskCardScopeKey(tasks, 't4')).toBe('t4')
  })

  it('snapshotId 不同的两个批次不合并（仅 batchId 相同也不算同一张卡）', () => {
    const tasks = [
      makeTask('t1', { sopBatch: sopMeta('b1', 's1', 0) }),
      makeTask('t2', { sopBatch: sopMeta('b1', 's2', 0) }),
    ]
    expect(resolveTaskCardScopeKey(tasks, 't1')).toBe('t1')
  })

  it('任务记录已被清理时仍按来源快照的 taskId 匹配，不扩批', () => {
    expect(resolveTaskCardScopeKey([], 'gone')).toBe('gone')
  })

  it('只取该卡片内的在库素材，并按输出槽位排序', () => {
    const assets = [
      makeAsset('c', makeOrigin('t2', 0)),
      makeAsset('b', makeOrigin('t1', 1)),
      makeAsset('a', makeOrigin('t1', 0)),
      { ...makeAsset('trashed', makeOrigin('t1', 2)), status: 'trashed' as const },
    ]
    expect(collectTaskCardAssets(assets, 't1').map((asset) => asset.id)).toEqual(['a', 'b'])
    expect(collectTaskCardAssets(assets, '')).toEqual([])
  })
})
