/**
 * 方向级后处理历史记录：一次产出的**长期留档**（纯逻辑，无副作用）。
 *
 * 存在的理由（2026-09-23 杰哥）：后处理此前有两种记录，都不是他要的 ——
 * 1. `PostprocessRun`（`stores/runtimeStore.ts`）是**内存态**，只留本次会话最近 60 条，重启即失；
 * 2. `TaskPostprocessOutput`（落在 `task.postprocessOutputs`）**挂在任务下**，不是按方向，
 *    任务记录一没就查不到。
 * 于是「这个方向上周那批到底产到哪了、为什么有几张没出」在界面上无解。这里补的就是它：
 * **按方向分桶、落盘、持续累积**，每条自带「产出到哪几个方向、实际写到哪些目录」的快照。
 *
 * ## 三条刻意的口径
 *
 * - **快照而不是引用**：`directionLabel` / `targetDirectionIds` / `outputDirs` 都是**当时**的值。
 *   记录的价值恰在于「事后能还原当时发生了什么」；去读当前配置只能得到今天的答案 ——
 *   输出目录、水印、渠道都在项目树节点层可覆盖（ADR-0003 实测 25/61 个方向目录不同），
 *   改一次全变，昨天那条记录就再也解释不了昨天那批文件为什么在那个目录里。
 * - **产出目标只在这里留痕，不在这里配置**：那份配置存在 `savedTargetsByFolder`（按素材库当时所在的
 *   文件夹各一份，2026-09-24 改）与兜底的 `savedTargetCollectionIds` 上，字段语义见
 *   `lib/postprocessMedia.ts` 的字段注释；本模块只把「当时到底产到了哪几个方向」记成快照，
 *   不参与「下次产到哪」的推导 —— 记的是结果，配的是意图，两者混在一起就再也解释不了历史。
 * - **问题只存上下文、不存文案**：`message` / `hint` / `severity` 一律从码表派生
 *   （`createPostprocessIssue`），历史里再存一份必然与码表分叉。见 `PostprocessHistoryIssue`。
 */

import {
  createPostprocessIssue,
  type PostprocessIssue,
  type PostprocessIssueCode,
  type PostprocessStage,
} from './postprocessIssue'
import type {
  PostprocessRun,
  PostprocessRunDiagnostics,
  PostprocessRunSource,
  PostprocessRunStatus,
} from './postprocessRun'

/**
 * 每个方向保留的历史条数。
 *
 * 50 的取法：一条记录实测约 0.4KB（目录 1~2 个、问题多为 0 条），50 条 ≈ 20KB/方向，
 * 100 个方向也只有 2MB 左右 —— 与「用户回头能查到上周那批」相比这个代价可以忽略。
 * 上限本身是必需的：产出是**每个生成任务完成就跑一次**的高频行为，不限量会无限增长。
 */
export const POSTPROCESS_HISTORY_PER_DIRECTION = 50

/**
 * 单条记录里保留的问题条数。
 *
 * 超出只留总数（`issueCount`）。配置级问题（目录不可用、预设被删）一批图会反复遇到，
 * 逐图存下来只会把真正不同的那几条埋掉，还把记录撑大几十倍。
 */
export const POSTPROCESS_HISTORY_ISSUE_LIMIT = 10

/**
 * 单条记录里保留的输出目录数。
 *
 * 一个方向下按渠道拆成多个桶，每桶 1~2 个位置，所以目录数**可能大于 2**。
 * 8 是「够用且可控」的折中：真配到 8 个以上位置时，最先的那几个（= 主交付位置）已经在里面了。
 */
export const POSTPROCESS_HISTORY_OUTPUT_DIR_LIMIT = 8

/** `cause` 最长保留多少字符：原始错误可能带着整段堆栈，不截断会把记录撑爆。 */
const CAUSE_MAX_LENGTH = 200

/** 目录字符串最长保留多少字符（Windows 长路径 + UNC 共享盘路径都可能很长）。 */
const DIR_MAX_LENGTH = 300

/**
 * 历史里存的问题项：**只存上下文**，文案从码表还原。
 *
 * 与 `PostprocessIssue` 的差别就是少了 `message` / `hint` / `severity` 三个字段 ——
 * 它们由 `code` 唯一决定（`ISSUE_TEMPLATES`），存下来只会与码表分叉。
 * 读的时候用 `createPostprocessIssue` 补回来，于是「界面按码查到的说法」与「当时 toast 的说法」
 * 永远是同一句。
 */
export type PostprocessHistoryIssue = Pick<
  PostprocessIssue,
  'code' | 'stage' | 'file' | 'sourceImageId' | 'sourceIndex' | 'mediaId' | 'mediaName' | 'dir' | 'detail' | 'cause'
>

export interface PostprocessHistoryEntry {
  id: string
  /**
   * 分桶键：**方向 id**（`AssetCollection.id`）。
   *
   * 一条 run 只服务一个方向（见 `PostprocessRun.directionId`），所以这个字段恒有值 ——
   * 批次级记录（分发失败、准备阶段崩溃）没有方向，**不进**方向历史（见 `createHistoryEntryFromRun`）。
   */
  directionId: string
  /** 方向展示名快照（`产品线 / 产品 / 方向`）：方向被改名或删除后，旧记录仍然读得懂 */
  directionLabel: string
  /** 同一次触发（批次）的各方向共享；一次手动跑跨 3 个方向就是 3 条、同一个 batchId */
  batchId?: string
  source: PostprocessRunSource
  taskId?: string
  startedAt: number
  finishedAt: number
  status: PostprocessRunStatus
  /** 本次要处理的源图数 */
  totalImages: number
  /** 实际写成的文件数（双写按实际份数算） */
  producedFiles: number
  /** 本次产出到哪几个方向（**快照**，不是读当前配置） */
  targetDirectionIds: string[]
  /**
   * 本次实际写入的目录（去重保序，第一个是主位置）—— 「打开输出位置」按钮的目标，
   * 也是重启后重新放行这些目录的依据（`collectHistoryOutputDirs`）。
   */
  outputDirs: string[]
  /** 问题清单（封顶 `POSTPROCESS_HISTORY_ISSUE_LIMIT`） */
  issues: PostprocessHistoryIssue[]
  /** 问题**总数**：可能大于 `issues.length`（超出部分只留计数） */
  issueCount: number
  diagnostics?: PostprocessRunDiagnostics
}

/** 落盘形状：方向 id → 该方向的历史（**最新在前**）。 */
export interface PostprocessHistoryState {
  byDirection: Record<string, PostprocessHistoryEntry[]>
}

export const EMPTY_POSTPROCESS_HISTORY: PostprocessHistoryState = { byDirection: {} }

/** 目录去重键：Windows 路径不区分大小写，同一条路径的两种写法不该各占一格。 */
function dirKey(dir: string): string {
  return dir.trim().toLowerCase()
}

function normalizeDirList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(dirKey(trimmed))) continue
    seen.add(dirKey(trimmed))
    result.push(trimmed.slice(0, DIR_MAX_LENGTH))
    if (result.length >= POSTPROCESS_HISTORY_OUTPUT_DIR_LIMIT) break
  }
  return result
}

function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || result.includes(trimmed)) continue
    result.push(trimmed)
  }
  return result
}

/**
 * `issues` → 紧凑形式（丢文案、截断 `cause`、按上限截断条数）。
 *
 * 返回的 `issueCount` 单独给出来：截断之后「上面只列了 10 条」与「这次真就 10 个问题」
 * 在界面上必须能分开，否则用户会以为问题只有这么多。
 */
export function compactHistoryIssues(issues: readonly PostprocessIssue[]): {
  issues: PostprocessHistoryIssue[]
  issueCount: number
} {
  const compact: PostprocessHistoryIssue[] = []
  for (const issue of issues) {
    if (compact.length >= POSTPROCESS_HISTORY_ISSUE_LIMIT) break
    compact.push({
      code: issue.code,
      stage: issue.stage,
      ...(issue.file ? { file: issue.file } : {}),
      ...(issue.sourceImageId ? { sourceImageId: issue.sourceImageId } : {}),
      ...(issue.sourceIndex === undefined ? {} : { sourceIndex: issue.sourceIndex }),
      ...(issue.mediaId ? { mediaId: issue.mediaId } : {}),
      ...(issue.mediaName ? { mediaName: issue.mediaName } : {}),
      ...(issue.dir ? { dir: issue.dir } : {}),
      ...(issue.detail ? { detail: issue.detail } : {}),
      ...(issue.cause ? { cause: issue.cause.slice(0, CAUSE_MAX_LENGTH) } : {}),
    })
  }
  return { issues: compact, issueCount: issues.length }
}

/** 把紧凑形式还原成完整问题项（补回码表里的描述 / 线索 / 严重度）。 */
export function expandHistoryIssue(issue: PostprocessHistoryIssue): PostprocessIssue {
  return createPostprocessIssue(issue)
}

/**
 * 从一次运行为它所属的方向生成一条历史。
 *
 * 返回 null 的两种情形，都是刻意的：
 * - **没有 `directionId`**：批次级记录（`recordBatchLevelPostprocessRun` 建的「全部方向（分发）」、
 *   准备阶段崩溃）不属于任何方向，塞进某个方向的桶里会让「这个方向出了问题」变成假话。
 * - **`startedAt` 不可用**：不该发生，但坏数据不应污染落盘。
 */
export function createHistoryEntryFromRun(
  run: PostprocessRun,
  extras: {
    id: string
    /** 本次产出到哪几个方向；不传则用该方向自己（自动触发就是这种情形） */
    targetDirectionIds?: string[]
    /** 本次实际写入的目录 */
    outputDirs?: string[]
    /** 方向名快照；不传则退回 run 上的 `directionLabel` */
    directionLabel?: string
    /** 覆盖产出文件数（run 收尾前调用时用进度里的实时值） */
    producedFiles?: number
    finishedAt?: number
  },
): PostprocessHistoryEntry | null {
  if (!run.directionId) return null
  if (!Number.isFinite(run.startedAt)) return null
  const { issues, issueCount } = compactHistoryIssues(run.issues)
  const outputDirs = normalizeDirList(extras.outputDirs)
  const targetDirectionIds = normalizeIdList(extras.targetDirectionIds ?? [run.directionId])
  return {
    id: extras.id,
    directionId: run.directionId,
    directionLabel: extras.directionLabel ?? run.directionLabel ?? run.directionId,
    ...(run.batchId ? { batchId: run.batchId } : {}),
    source: run.source,
    ...(run.taskId ? { taskId: run.taskId } : {}),
    startedAt: run.startedAt,
    finishedAt: extras.finishedAt ?? run.finishedAt ?? Date.now(),
    status: run.status,
    totalImages: run.totalImages,
    producedFiles: extras.producedFiles ?? run.producedFiles,
    targetDirectionIds: targetDirectionIds.length > 0 ? targetDirectionIds : [run.directionId],
    outputDirs,
    issues,
    issueCount,
    ...(run.diagnostics ? { diagnostics: { ...run.diagnostics } } : {}),
  }
}

/**
 * 追加一条历史到对应方向的桶里，**最新在前**，超出上限丢掉最老的。
 *
 * 同一条 `id` 重复追加是**替换**而不是并存：收尾路径可能被重入（异常兜底路径也会落一次），
 * 留着两条一模一样的记录只会让人以为跑了两次。
 */
export function appendHistoryEntry(
  state: PostprocessHistoryState,
  entry: PostprocessHistoryEntry,
): PostprocessHistoryState {
  const current = state.byDirection[entry.directionId] ?? []
  const kept = current.filter((item) => item.id !== entry.id)
  const next = [entry, ...kept].slice(0, POSTPROCESS_HISTORY_PER_DIRECTION)
  return { byDirection: { ...state.byDirection, [entry.directionId]: next } }
}

/** 清掉某个方向的历史（用户主动清）。方向不存在时原样返回，避免无谓的引用变化。 */
export function clearHistoryForDirection(state: PostprocessHistoryState, directionId: string): PostprocessHistoryState {
  if (!(directionId in state.byDirection)) return state
  const byDirection = { ...state.byDirection }
  delete byDirection[directionId]
  return { byDirection }
}

/** 某个方向的历史（最新在前）；没有就是空数组。 */
export function listHistoryForDirection(
  state: PostprocessHistoryState,
  directionId: string,
): PostprocessHistoryEntry[] {
  return state.byDirection[directionId] ?? []
}

/** 历史里出现过的全部方向 id（界面按它列方向列表）。 */
export function listHistoryDirectionIds(state: PostprocessHistoryState): string[] {
  return Object.keys(state.byDirection)
}

export function countHistoryEntries(state: PostprocessHistoryState): number {
  let total = 0
  for (const entries of Object.values(state.byDirection)) total += entries.length
  return total
}

/**
 * 历史里出现过的全部输出目录（去重，**最新的方向在前**）。
 *
 * ⚠️ 这不是给界面用的，而是**启动时重新放行**这些目录用的（见 `App` / `store` 的初始化）：
 * 主进程的路径白名单里，`sessionAllowedRoots` 是内存 Set、**重启即清空**，
 * 而 `localSavePath` / `configSyncPath` 两条会从本地设置读回来。后处理的自定义输出目录
 * （多半是内网共享盘）不属于这两条 —— 产出那一次靠 `composite:authorize-output-directory`
 * 放行，重启后就没人再放行它了，于是历史记录上的「打开输出位置」会被 `assertAllowedPath`
 * 拒掉，报一句「路径不在允许范围」。用户看到的是「昨天还能打开，今天点不动了」。
 *
 * 只放行「**真的写出过文件**」的目录（而不是配置里写的那些）：这是一份可信来源 ——
 * 用户亲自配过、且产出确实落在那里。
 */
export function collectHistoryOutputDirs(state: PostprocessHistoryState): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entries of Object.values(state.byDirection)) {
    for (const entry of entries) {
      for (const dir of entry.outputDirs) {
        const key = dirKey(dir)
        if (seen.has(key)) continue
        seen.add(key)
        result.push(dir)
      }
    }
  }
  return result
}

const RUN_SOURCES: readonly PostprocessRunSource[] = ['auto', 'manual']
const RUN_STATUSES: readonly PostprocessRunStatus[] = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'skipped',
  'canceled',
]

const ISSUE_STAGES: readonly PostprocessStage[] = ['prepare', 'render', 'write', 'distribute', 'finish']

/**
 * `stage` 的类型谓词。
 *
 * 不能写成 `ISSUE_STAGES.includes(stage)`：那不会把 `string` 缩窄成 `PostprocessStage`，
 * 于是校验通过之后往对象里塞时还得再断言一次 —— 而断言正是这一步要避免的东西。
 */
function isIssueStage(value: string): value is PostprocessStage {
  return (ISSUE_STAGES as readonly string[]).includes(value)
}

function normalizeIssue(raw: unknown): PostprocessHistoryIssue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  // 码不认识就丢这条：码表是文案的唯一真相源，留一个没有码的问题项在界面上会渲染成空行
  const code = typeof input.code === 'string' ? (input.code as PostprocessIssueCode) : ''
  const stage = typeof input.stage === 'string' ? input.stage : ''
  if (!code || !isIssueStage(stage)) return null
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  const index =
    typeof input.sourceIndex === 'number' && Number.isFinite(input.sourceIndex) ? input.sourceIndex : undefined
  return {
    code,
    stage,
    ...(text(input.file) ? { file: text(input.file) } : {}),
    ...(text(input.sourceImageId) ? { sourceImageId: text(input.sourceImageId) } : {}),
    ...(index === undefined ? {} : { sourceIndex: index }),
    ...(text(input.mediaId) ? { mediaId: text(input.mediaId) } : {}),
    ...(text(input.mediaName) ? { mediaName: text(input.mediaName) } : {}),
    ...(text(input.dir) ? { dir: text(input.dir) } : {}),
    ...(text(input.detail) ? { detail: text(input.detail) } : {}),
    ...(text(input.cause) ? { cause: text(input.cause) } : {}),
  }
}

function normalizeDiagnostics(raw: unknown): PostprocessRunDiagnostics | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const input = raw as Record<string, unknown>
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
  return {
    paintMs: num(input.paintMs),
    encodeMs: num(input.encodeMs),
    encodeCount: num(input.encodeCount),
    writeMs: num(input.writeMs),
  }
}

/**
 * 归一化一条历史。坏数据**逐条丢弃**而不是整份回退 —— 保住用户其余的历史，
 * 与 `normalizePostprocessMediaConfig` 同一条口径。
 *
 * 缺 `directionId` 的条目直接丢：桶键就是它，没有桶键的条目无处安放。
 */
function normalizeHistoryEntry(raw: unknown, bucketDirectionId: string): PostprocessHistoryEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const directionId = typeof input.directionId === 'string' && input.directionId.trim() ? input.directionId.trim() : ''
  const source = typeof input.source === 'string' ? (input.source as PostprocessRunSource) : 'auto'
  const status = typeof input.status === 'string' ? (input.status as PostprocessRunStatus) : 'succeeded'
  const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  if (!id || !directionId || !RUN_SOURCES.includes(source) || !RUN_STATUSES.includes(status)) return null
  const startedAt = time(input.startedAt)
  if (startedAt <= 0) return null

  const issues: PostprocessHistoryIssue[] = []
  if (Array.isArray(input.issues)) {
    for (const rawIssue of input.issues) {
      const issue = normalizeIssue(rawIssue)
      if (issue) issues.push(issue)
      if (issues.length >= POSTPROCESS_HISTORY_ISSUE_LIMIT) break
    }
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
  const issueCount = Math.max(count(input.issueCount), issues.length)
  const diagnostics = normalizeDiagnostics(input.diagnostics)

  return {
    id,
    // 桶键以**外层键**为准：内层字段与实际桶不一致时，以「它在哪个桶里」为真
    directionId: bucketDirectionId || directionId,
    directionLabel: text(input.directionLabel) || bucketDirectionId || directionId,
    ...(text(input.batchId) ? { batchId: text(input.batchId) } : {}),
    source,
    ...(text(input.taskId) ? { taskId: text(input.taskId) } : {}),
    startedAt,
    finishedAt: time(input.finishedAt) || startedAt,
    status,
    totalImages: count(input.totalImages),
    producedFiles: count(input.producedFiles),
    targetDirectionIds: normalizeIdList(input.targetDirectionIds),
    outputDirs: normalizeDirList(input.outputDirs),
    issues,
    issueCount,
    ...(diagnostics ? { diagnostics } : {}),
  }
}

/**
 * 归一化整个落盘状态（读盘 / 迁移 / 备份恢复共用）。
 *
 * 每条按上限截断、按 `startedAt` **倒序**排：落盘顺序理论上已经是最新在前，
 * 但备份恢复 / 手工编辑过的数据不保证，重排一次让「最新在前」这条界面契约恒成立。
 */
export function normalizePostprocessHistory(raw: unknown): PostprocessHistoryState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_POSTPROCESS_HISTORY
  const input = (raw as Record<string, unknown>).byDirection
  if (!input || typeof input !== 'object' || Array.isArray(input)) return EMPTY_POSTPROCESS_HISTORY

  const byDirection: Record<string, PostprocessHistoryEntry[]> = {}
  for (const [rawDirectionId, rawEntries] of Object.entries(input as Record<string, unknown>)) {
    const directionId = typeof rawDirectionId === 'string' ? rawDirectionId.trim() : ''
    if (!directionId || !Array.isArray(rawEntries)) continue
    const entries: PostprocessHistoryEntry[] = []
    const seenIds = new Set<string>()
    for (const rawEntry of rawEntries) {
      const entry = normalizeHistoryEntry(rawEntry, directionId)
      if (!entry || seenIds.has(entry.id)) continue
      seenIds.add(entry.id)
      entries.push(entry)
    }
    if (entries.length === 0) continue
    entries.sort((a, b) => b.startedAt - a.startedAt)
    byDirection[directionId] = entries.slice(0, POSTPROCESS_HISTORY_PER_DIRECTION)
  }
  return { byDirection }
}
