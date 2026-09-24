import type { GeneratedAsset, GeneratedAssetOrigin, SopBatchSnapshot, TaskRecord } from '../types'
import { hasCompletedTaskOutputs } from './taskProgressDisplay'
import { keepLatestPromptAttempts } from './sopBatchTaskGrouping'

/**
 * 素材库「生成批次」展现方式的分组纯函数。
 *
 * 把当前查询结果中的素材按「生成批次 → 任务 → 已删除任务」三级聚合：
 * - SOP 批次（task.sopBatch）→ 一个批次组（保留快照 tags 与词库树文件夹 promptGroup，只读不回写）；
 * - 普通任务 → 任务组；
 * - 任务记录已删除（素材仍在）→ 孤儿组，使用素材来源快照（origins）还原信息，不丢数据。
 */

export type AssetBatchGroupKind = 'sop-batch' | 'task' | 'orphan'

export interface AssetBatchGroupSummary {
  total: number
  running: number
  completed: number
  failed: number
}

export interface AssetBatchGroup {
  /** 稳定组键（批次 id / 任务 id / orphan 键） */
  id: string
  kind: AssetBatchGroupKind
  /** 组标题（批次标题 / SOP 名 / 任务提示词摘要 / 孤儿提示词摘要） */
  title: string
  /** 关联任务 id 列表；孤儿组为空 */
  taskIds: string[]
  /** 代表任务（SOP 组为组内首个任务）；孤儿组为 null */
  task: TaskRecord | null
  /** 组内素材（按来源输出槽位再按生成时间排序） */
  assets: GeneratedAsset[]
  /**
   * 卡片上「N 张」的唯一口径（**以任务记录为准，不以当前可见素材为准**）。
   *
   * - `task` → 该任务现存的产出槽位数；
   * - `sop-batch` → 组内（去重后）各任务之和；
   * - `orphan` → 没有任务记录可依，退回可见素材数。
   *
   * 它**不随查询范围 / 分页 / 拖拽变化**，只在用户真的删图（槽位被置空）或删任务时才变。
   * 消费方一律读这个字段，不要再自己数 `assets` —— 那正是「同一张卡两个数字」的成因。
   */
  outputCount: number
  /**
   * 排序基准时间：有素材的组 = 素材最新生成时间；
   * 无素材的活跃任务组（生成中 / 失败）回退为任务提交时间（0.7.56 新任务置顶方案），
   * 避免刚提交的任务因 createdAt=0 沉底、结束后又跳到最上方。
   */
  createdAt: number
  summary: AssetBatchGroupSummary
  /** SOP 批次快照所属词库树文件夹（id+名称冗余，仅展示） */
  promptGroup: { id: string; name: string } | null
  /** SOP 批次快照标题（用户可编辑的提示词集标题） */
  snapshotTitle?: string
  snapshotId?: string
  /** 来源工作区名称（素材 origins 冗余） */
  workspaceTabName?: string
  /** 展示用的提示词摘要（批次标题 / 任务 / 孤儿提示词） */
  promptExcerpt: string
}

export function getPrimaryOrigin(asset: GeneratedAsset): GeneratedAssetOrigin | undefined {
  if (asset.primaryOriginKey) {
    const found = asset.origins.find((origin) => origin.key === asset.primaryOriginKey)
    if (found) return found
  }
  return asset.origins[0]
}

/**
 * 任务「还剩几张图」的唯一口径 = 产出槽位里**非空**的那几个。
 *
 * `outputImages` 是**定长槽位数组**：素材被永久删除时 `patchTaskForPurgedSlots`
 * （`lib/assetPurge.ts`）把对应槽位置成 `undefined`，但**数组长度保持不变** ——
 * 所以 `.length` 会把用户已经删掉的槽位也算进去，报出一个点不开的数字。
 * `TaskCard` 的角标早已是这个口径（`liveOutputCount`），这里把它收敛成唯一实现。
 */
export function countLiveTaskOutputs(task: TaskRecord): number {
  return (task.outputImages ?? []).filter(Boolean).length
}

export function truncatePrompt(prompt: string, max = 80): string {
  const singleLine = prompt.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= max) return singleLine
  return `${singleLine.slice(0, max)}…`
}

/**
 * 「同一张任务卡片」的素材范围键 —— 与该素材在素材库任务卡片视图里所属的卡片口径一致：
 * - 普通任务卡片 → 该次生成的全部输出图（同一 `taskId`）；
 * - SOP 批次卡片 → 整批（同一 `snapshotId || batchId`）全部任务的输出图；
 * - 任务记录已被清理（孤儿卡片）→ 只按来源快照里的 `taskId` 匹配，不再扩批。
 *
 * 返回排序后以 `|` 连接的任务 id（可直接当 `useMemo` 依赖比较用）；没有来源任务时返回 `''`。
 */
export function resolveTaskCardScopeKey(tasks: readonly TaskRecord[], taskId: string | undefined): string {
  if (!taskId) return ''
  const taskIds = new Set<string>([taskId])
  const anchor = tasks.find((task) => task.id === taskId)
  const batchKey = anchor?.sopBatch ? anchor.sopBatch.snapshotId || anchor.sopBatch.batchId : null
  if (batchKey) {
    for (const task of tasks) {
      if (!task.sopBatch) continue
      if ((task.sopBatch.snapshotId || task.sopBatch.batchId) === batchKey) taskIds.add(task.id)
    }
  }
  return [...taskIds].sort().join('|')
}

/**
 * 按范围键取出该任务卡片内的素材（只含在库素材），排序与卡片一致：输出槽位 → 生成时间。
 * 范围键来自 `resolveTaskCardScopeKey`。
 */
export function collectTaskCardAssets(assets: GeneratedAsset[], scopeKey: string): GeneratedAsset[] {
  if (!scopeKey) return []
  const taskIds = new Set(scopeKey.split('|'))
  return assets
    .filter((asset) => asset.status === 'active' && asset.origins.some((origin) => taskIds.has(origin.taskId)))
    .sort((a, b) => {
      const slotDelta = (getPrimaryOrigin(a)?.outputSlot ?? 0) - (getPrimaryOrigin(b)?.outputSlot ?? 0)
      return slotDelta || a.createdAt - b.createdAt
    })
}

function summarizeTasks(tasks: TaskRecord[]): AssetBatchGroupSummary {
  return tasks.reduce<AssetBatchGroupSummary>(
    (summary, task) => {
      if (task.status === 'running') summary.running += 1
      else if (task.status === 'error' && !hasCompletedTaskOutputs(task)) summary.failed += 1
      else summary.completed += 1
      summary.total += 1
      return summary
    },
    { total: 0, running: 0, completed: 0, failed: 0 },
  )
}

/** 任务是否有失败迹象：完全失败（status=error）或部分失败（status=done 但含失败槽位）。 */
export function hasTaskFailure(task: TaskRecord): boolean {
  return (
    (task.status === 'error' && !hasCompletedTaskOutputs(task)) ||
    (task.batchItemErrors != null && task.batchItemErrors.length > 0 && !hasCompletedTaskOutputs(task))
  )
}

export interface AssetBatchGroupingOptions {
  /** 是否把"没有素材产出"的任务也补成任务组（生成中/失败的任务必须可见，回归 0.7.56 行为）。 */
  includeTaskless?: (task: TaskRecord) => boolean
}

export function buildAssetBatchGroups(
  assets: GeneratedAsset[],
  tasksById: ReadonlyMap<string, TaskRecord>,
  snapshotsById: ReadonlyMap<string, SopBatchSnapshot>,
  options: AssetBatchGroupingOptions = {},
): AssetBatchGroup[] {
  const { includeTaskless } = options
  const groups = new Map<string, AssetBatchGroup>()

  // `outputCount` 与 `assets` 一样由 ensureGroup 统一初始化、函数末尾统一计算：
  // 让每个 seed 各写一遍只会多出 5 个可以写错的默认值。
  const ensureGroup = (
    key: string,
    seed: () => Omit<AssetBatchGroup, 'assets' | 'createdAt' | 'summary' | 'outputCount'>,
  ) => {
    const existing = groups.get(key)
    if (existing) return existing
    const created: AssetBatchGroup = {
      ...seed(),
      assets: [],
      outputCount: 0,
      createdAt: 0,
      summary: { total: 0, running: 0, completed: 0, failed: 0 },
    }
    groups.set(key, created)
    return created
  }

  for (const asset of assets) {
    const origin = getPrimaryOrigin(asset)
    const taskId = origin?.taskId ?? ''
    const task = taskId ? tasksById.get(taskId) : undefined

    let group: AssetBatchGroup
    if (task?.sopBatch) {
      const groupId = task.sopBatch.snapshotId || task.sopBatch.batchId
      const snapshot = groupId ? snapshotsById.get(groupId) : undefined
      const existing = groups.get(`sop-batch:${groupId}`)
      if (existing) {
        group = existing
      } else {
        group = ensureGroup(`sop-batch:${groupId}`, () => {
          const batchTitle =
            snapshot?.title?.trim() ||
            task.sopBatch?.sopName?.trim() ||
            (origin?.prompt ? truncatePrompt(origin.prompt) : 'SOP 批量任务')
          return {
            id: `sop-batch:${groupId}`,
            kind: 'sop-batch',
            title: batchTitle,
            taskIds: [],
            task: null,
            promptGroup: snapshot?.promptGroup ?? null,
            snapshotTitle: snapshot?.title,
            snapshotId: snapshot?.id ?? groupId,
            workspaceTabName: origin?.workspaceTabName,
            promptExcerpt: origin?.prompt ? truncatePrompt(origin.prompt) : '',
          }
        })
      }
      if (task && !group.taskIds.includes(task.id)) {
        group.taskIds.push(task.id)
        if (!group.task) group.task = task
      }
    } else if (task) {
      const existing = groups.get(`task:${task.id}`)
      if (existing) {
        group = existing
      } else {
        group = ensureGroup(`task:${task.id}`, () => ({
          id: `task:${task.id}`,
          kind: 'task',
          title: task.prompt.trim() ? truncatePrompt(task.prompt) : `任务 ${task.id.slice(0, 8)}`,
          taskIds: [task.id],
          task,
          promptGroup: null,
          workspaceTabName: origin?.workspaceTabName,
          promptExcerpt: task.prompt.trim() ? truncatePrompt(task.prompt) : '',
        }))
      }
    } else {
      // 任务记录已删除（素材保留）：按来源任务聚合，来源信息来自素材快照
      const orphanKey = taskId ? `orphan:${taskId}` : `orphan:${asset.id}`
      const existing = groups.get(orphanKey)
      if (existing) {
        group = existing
      } else {
        group = ensureGroup(orphanKey, () => ({
          id: orphanKey,
          kind: 'orphan',
          title: origin?.prompt?.trim() ? truncatePrompt(origin.prompt) : '任务已删除',
          taskIds: [],
          task: null,
          promptGroup: null,
          workspaceTabName: origin?.workspaceTabName,
          promptExcerpt: origin?.prompt?.trim() ? truncatePrompt(origin.prompt) : '',
        }))
      }
    }

    group.assets.push(asset)
    if (asset.createdAt > group.createdAt) group.createdAt = asset.createdAt
  }

  // 补入**没有被上面的素材循环建组**的任务（TB-129 起：卡片的存在以任务记录为准）。
  //
  // 为什么必须补：上面的循环主体是**素材**，任务只是素材的归属标签 —— 于是「任务在、图暂时
  // 查不到」（被拖到别的文件夹、落在还没加载的分页里、被搜索词过滤掉）会让卡片凭空消失，
  // 或让卡上数量缩水。已成功完成的任务此前**没有任何兜底**（成功任务被下面那行 continue 跳过），
  // 所以「图一拖走、卡就没了」这类现象都出在这里。
  //
  // 现在的口径：
  // - **有产出的任务一律建卡**，不管图当前可不可见；
  // - 「已完结且从未产出」的历史空任务不建卡（否则卡片视图会被历史空任务刷屏）；
  // - 失败任务（含部分失败）必须保留任务卡 —— 即使素材已被清理，用户仍需看到失败状态并重试。
  // 可见性（哪个范围该出现哪些卡）仍由 `includeTaskless` 谓词按作用域控制。
  if (includeTaskless) {
    for (const task of tasksById.values()) {
      if (task.status === 'done' && !hasTaskFailure(task) && countLiveTaskOutputs(task) === 0) continue
      if (!includeTaskless(task)) continue
      const alreadyGrouped = [...groups.values()].some((group) => group.taskIds.includes(task.id))
      if (alreadyGrouped) continue
      if (task.sopBatch) {
        const groupId = task.sopBatch.snapshotId || task.sopBatch.batchId
        const snapshot = groupId ? snapshotsById.get(groupId) : undefined
        const group = ensureGroup(`sop-batch:${groupId}`, () => ({
          id: `sop-batch:${groupId}`,
          kind: 'sop-batch',
          title:
            snapshot?.title?.trim() ||
            task.sopBatch?.sopName?.trim() ||
            (task.prompt.trim() ? truncatePrompt(task.prompt) : 'SOP 批量任务'),
          taskIds: [],
          task: null,
          promptGroup: snapshot?.promptGroup ?? null,
          snapshotTitle: snapshot?.title,
          snapshotId: snapshot?.id ?? groupId,
          workspaceTabName: undefined,
          promptExcerpt: task.prompt.trim() ? truncatePrompt(task.prompt) : '',
        }))
        if (!group.taskIds.includes(task.id)) group.taskIds.push(task.id)
        if (!group.task) group.task = task
      } else {
        ensureGroup(`task:${task.id}`, () => ({
          id: `task:${task.id}`,
          kind: 'task',
          title: task.prompt.trim() ? truncatePrompt(task.prompt) : `任务 ${task.id.slice(0, 8)}`,
          taskIds: [task.id],
          task,
          promptGroup: null,
          workspaceTabName: undefined,
          promptExcerpt: task.prompt.trim() ? truncatePrompt(task.prompt) : '',
        }))
      }
    }
  }

  /**
   * SOP 批次是一个**整体**：成员由「任务记录」决定，不由「素材」决定。
   *
   * 素材只负责"挂图"——某条没出图、或它的图不在当前查询结果里（在别的文件夹、在还没加载到的
   * 分页里、已被清理），都不该把它从「整批 N 条」里静默抹掉。批次详情弹窗
   * （`SopBatchDetailModal` → `sopBatchTaskGrouping.groupSopBatchTasks`）就是按任务记录算的；
   * 两边口径不一致，就会出现「卡片说 74 条、点开弹窗说 150 条」这种同一批次两个数字。
   *
   * ⚠️ 只补**已经存在**的批次组（= 至少有一张图落进来的）。完全无产出的批次**不**凭空建卡，
   * 否则卡片视图会被历史空批次刷屏——那是 `includeTaskless` 谓词该管的事，不由这里代劳。
   */
  for (const task of tasksById.values()) {
    const sopBatch = task.sopBatch
    if (!sopBatch) continue
    const groupId = sopBatch.snapshotId || sopBatch.batchId
    if (!groupId) continue
    const group = groups.get(`sop-batch:${groupId}`)
    if (!group || group.taskIds.includes(task.id)) continue
    group.taskIds.push(task.id)
  }

  // 排序基准时间：任务卡位置在创建（提交）时即确定，不随实际生成进度变化——
  // 有关联任务的组一律以任务提交时间为基准（SOP 组取组内最早提交时间 = 批次创建时间），
  // 避免「生成中沉底、生成完成跳到最上方」的卡片跳动；孤儿组（任务已删除）没有任务
  // 时间，回退为素材最新生成时间。
  for (const group of groups.values()) {
    if (group.taskIds.length === 0) continue
    let taskBaseline = Number.MAX_SAFE_INTEGER
    for (const taskId of group.taskIds) {
      const task = tasksById.get(taskId)
      if (task && task.createdAt < taskBaseline) taskBaseline = task.createdAt
    }
    if (taskBaseline !== Number.MAX_SAFE_INTEGER) group.createdAt = taskBaseline
  }

  for (const group of groups.values()) {
    group.assets.sort((a, b) => {
      const slotDelta = (getPrimaryOrigin(a)?.outputSlot ?? 0) - (getPrimaryOrigin(b)?.outputSlot ?? 0)
      return slotDelta || a.createdAt - b.createdAt
    })
    if (group.kind === 'sop-batch' && group.taskIds.length > 0) {
      // 单张重试会沿用同组批次号，在同一批次里留下同一 `promptId` 的第二条任务。
      // 去重口径必须与批次详情弹窗一致（`groupSopBatchTasks` 用的是同一个函数），
      // 否则「整批 N 条提示词」会随重试次数虚涨，又变成两个数字。
      const batchTasks = keepLatestPromptAttempts(
        group.taskIds.map((id) => tasksById.get(id)).filter((task): task is TaskRecord => task != null),
      ).sort(
        (a, b) =>
          (a.sopBatch?.promptIndex ?? Number.MAX_SAFE_INTEGER) - (b.sopBatch?.promptIndex ?? Number.MAX_SAFE_INTEGER) ||
          a.createdAt - b.createdAt,
      )
      group.taskIds = batchTasks.map((task) => task.id)
      if (!group.task) group.task = batchTasks[0] ?? null
      group.summary = summarizeTasks(batchTasks)
    }
  }

  /**
   * 「N 张」统一在这里算一次（消费方直接读 `outputCount`，不要再自己数 `assets`）。
   *
   * ⚠️ 必须排在 SOP 去重**之后**：上面那个循环改写过 `taskIds`（同一提示词重试过只留最新一条），
   * 在它之前算会把重试的那条也算进来 —— 卡片数字就会比批次详情弹窗多出来一块，
   * 变成「同一批次两个数字」（TB-121 修过一次的同类问题）。
   */
  for (const group of groups.values()) {
    if (group.kind === 'orphan' || group.taskIds.length === 0) {
      // 没有任务记录可依（任务已删除 / 归档图）：退回可见素材数，不显示 0 张
      group.outputCount = group.assets.length
      continue
    }
    let count = 0
    for (const taskId of group.taskIds) {
      const task = tasksById.get(taskId)
      if (task) count += countLiveTaskOutputs(task)
    }
    /**
     * **只降不升的兜底**：任务记录算出来是 0、而这张卡确实挂着图 ⇒ 用可见素材数。
     *
     * 正常数据下任务记录必然有产出（素材就是从它的 `outputImages` 同步过去的），
     * 所以这条在正常路径上**永不触发**、不会破坏「数字不随范围变」。
     * 它只为一种情况存在：任务记录缺产出信息（迁移不全 / 落盘不完整）时，
     * 宁可退回一个会变的数字，也不要出现「卡上写 0 张、点进去明明有图」。
     */
    group.outputCount = count > 0 ? count : group.assets.length
  }

  return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
}

export interface AssetBatchOverview {
  /** 分组数量（批次 + 任务 + 任务已删除组） */
  groupCount: number
  /** 涉及的任务数（孤儿组不占任务数） */
  taskCount: number
  /**
   * 图片总数。**口径与卡片一致**（各组的 `outputCount` 之和，即以任务记录为准），
   * 不随查询范围/分页缩水 —— 否则速览说「3 张」而卡片写「5 张」，又是一处对不上。
   */
  assetCount: number
  completed: number
  running: number
  failed: number
}

/** 批次视图顶部速览：对当前分组聚合任务状态（替代已移除的「任务导航」状态速览）。 */
export function buildAssetBatchOverview(
  groups: AssetBatchGroup[],
  tasksById: ReadonlyMap<string, TaskRecord>,
): AssetBatchOverview {
  const taskIds = new Set<string>()
  let assetCount = 0
  for (const group of groups) {
    // 与卡片同一个口径（`outputCount`），不要退回 `assets.length`
    assetCount += group.outputCount
    for (const taskId of group.taskIds) taskIds.add(taskId)
  }
  let completed = 0
  let running = 0
  let failed = 0
  for (const taskId of taskIds) {
    const task = tasksById.get(taskId)
    if (!task) continue
    if (task.status === 'running') running += 1
    else if (task.status === 'error' && !hasCompletedTaskOutputs(task)) failed += 1
    else completed += 1
  }
  return {
    groupCount: groups.length,
    taskCount: taskIds.size,
    assetCount,
    completed,
    running,
    failed,
  }
}
