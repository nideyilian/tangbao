/**
 * 后处理运行记录：一次「跑后处理」的可查询状态（纯逻辑，无副作用）。
 *
 * 存在的前提：执行体（`taskPostprocess.ts`）是一次调用到底的长任务，界面在它跑完之前
 * 拿不到任何东西 —— 于是「正在跑」「跑了多少」「为什么没出图」三件事在界面上都无从谈起。
 * 这里定义**一次运行**的状态形状 + 状态流转纯函数；存放与订阅交给 `runtimeStore`
 * （内存态，不落盘：进度是会话内信息，重启后没有意义，也不该撑大落库体积）。
 *
 * 两条口径：
 * - **进度按源图算百分比，明细按当前图的产出单元**。一批图的总单元数要逐图解出渠道与尺寸
 *   才知道，事前不可知；拿它当分母会在中途不断跳动（分母变大→百分比回退）。所以分母固定为
 *   源图张数，当前这张图内部再用单元数做小数部分（不跳动，也不撒谎）。
 * - **`issues` 里跳过与出错并存**，状态由「有没有产出」+「有没有 error 级问题」共同决定，
 *   见 `resolvePostprocessRunStatus`。
 */

import { POSTPROCESS_CANCEL_CODE, isErrorIssue, type PostprocessIssue, type PostprocessStage } from './postprocessIssue'

export type PostprocessRunSource = 'auto' | 'manual'

export type PostprocessRunStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped' | 'canceled'

export const POSTPROCESS_RUN_STATUS_LABELS: Record<PostprocessRunStatus, string> = {
  /** 方向级并发闸名额满了：这条 run 已建好记录，等别的方向跑完就开工 */
  queued: '排队中',
  running: '进行中',
  succeeded: '成功',
  partial: '部分完成',
  failed: '失败',
  /** 零产出、但一条真错都没有：只是这次全被跳过了（方向没启用 / 关了自动产出 / 源图已清理） */
  skipped: '已跳过',
  /**
   * 用户主动停的。
   *
   * 与「失败」「部分完成」分开是刻意的：那两种会把人往「软件出问题了」带，而这一种
   * 的正确反应是「知道停在哪了、产物还在、想接着跑就重跑一次」。已经写出的文件一律保留。
   */
  canceled: '已取消',
}

/** 在飞状态（还没落终态）：排队与进行中都属于「这条 run 还占着这个方向」。 */
export function isRunInFlight(run: Pick<PostprocessRun, 'status'>): boolean {
  return run.status === 'queued' || run.status === 'running'
}

/**
 * 一次运行的耗时构成（诊断用）。
 *
 * 为什么要有它：这条链的耗时**差异极大** —— 实测同一套配置下，只编 1 轮的批次是 168ms/变体，
 * 走满编码轮数的批次是 1312ms/变体（由 09-21 八个批次的产出时间戳反推）。而在加它之前
 * **没有任何分阶段数据**，「慢在哪」只能靠猜，而猜错过两次。这四个数把疑点直接摊开：
 *
 * - `paintMs` 高 → 主线程在画布上花的时间多（**会卡界面**）：图层多 / 源图大 / 画面适配贵；
 * - `encodeMs` 高 → JPEG 编码吃 CPU：图内容复杂、体积上限压得紧；
 * - `encodeCount` 是上一项最直接的驱动量（每次调用平均 `encodeMs / encodeCount`）；
 * - `writeMs` 高 → 磁盘 / 共享盘 / 目录授权慢，与渲染无关。
 *
 * 全部为 0 表示这一次没走到渲染（例如整批被跳过）。单位毫秒，是**累计值**不是单张。
 */
export interface PostprocessRunDiagnostics {
  /** 画布绘制累计耗时 */
  paintMs: number
  /** JPEG 编码累计耗时 */
  encodeMs: number
  /** 编码累计轮数（`toBlob` 调用次数） */
  encodeCount: number
  /** 写盘累计耗时（含建目录、查重名、落盘） */
  writeMs: number
}

export interface PostprocessRun {
  id: string
  /** 自动（任务完成触发）还是手动（素材库补跑） */
  source: PostprocessRunSource
  /** 自动触发时对应的任务 id，供任务卡按任务找自己的进度 */
  taskId?: string
  /**
   * 所属批次：**一次触发一条**（手动点一次 / 一个任务完成跑一轮）。
   *
   * 批次内每个产出方向各一条 run —— 这就是「按方向独立运行」的落点：
   * 方向之间互不阻塞（各自排队、各自进度、各自问题清单），但**分发与总结算是一次**的
   * （分发要跨方向共用一次洗牌，否则同一张素材会在不同渠道落到不同的日子）。
   */
  batchId?: string
  /** 这条 run 服务的**产出方向**（collectionId）—— 方向级并发闸与界面按它归位 */
  directionId?: string
  /** 方向展示名（`产品线 / 产品 / 方向`）：只用于界面，不参与任何判定 */
  directionLabel?: string
  status: PostprocessRunStatus
  stage: PostprocessStage
  /** 本次要处理的源图总数（分母，事前已知） */
  totalImages: number
  /** 已整张处理完的源图数 */
  completedImages: number
  /** 当前这张源图解出的产出单元总数与已完成数（分母未知时为 0） */
  imageUnits: number
  imageUnitsDone: number
  /** 已写成的文件数（双写时按实际写成的份数算） */
  producedFiles: number
  /**
   * 本次**已经写出过文件**的目录（去重保序，第一个是主位置）。
   *
   * 进度里就带着它（而不是只在收尾结果里）是为了「中途中断」那一档：取消或崩溃时执行体是
   * **抛出去**的，`TaskPostprocessResult.outputDirs` 根本没机会返回 —— 而那一刻用户最想知道的
   * 恰恰是「已经产出的那几张在哪」。历史记录上的「打开输出位置」在一条取消记录上只能靠它。
   */
  outputDirs?: string[]
  /** 当前正在处理的那个产出（「头条 1080x1920 · xxx.jpg」） */
  currentLabel?: string
  issues: PostprocessIssue[]
  startedAt: number
  finishedAt?: number
  /**
   * 耗时构成，**收尾时才写**（见 `finishPostprocessRun`）。
   *
   * 运行中不给值：中途的数字没有参考价值，而且每张图往上写会打破
   * 「`PostprocessProgressPatch` 全部是绝对值」的一致性（增量在重试/并发下会算重）。
   */
  diagnostics?: PostprocessRunDiagnostics
}

/** 进度补丁：全部是**绝对值**而不是增量 —— 增量在重试 / 并发下容易算重，绝对值天然幂等。 */
export interface PostprocessProgressPatch {
  stage?: PostprocessStage
  completedImages?: number
  imageUnits?: number
  imageUnitsDone?: number
  producedFiles?: number
  /** 已经写出过文件的目录（绝对值，去重保序）；见 `PostprocessRun.outputDirs` */
  outputDirs?: string[]
  currentLabel?: string
}

export interface CreatePostprocessRunInput {
  id: string
  source: PostprocessRunSource
  taskId?: string
  totalImages: number
  /** 所属批次（见 `PostprocessRun.batchId`） */
  batchId?: string
  directionId?: string
  directionLabel?: string
  /**
   * 以「排队中」起步：方向级并发闸名额已满时，记录先建好（用户点下去就能查到它），
   * 拿到名额再转 `running`（见 `startQueuedPostprocessRun`）。
   */
  queued?: boolean
  startedAt?: number
}

export function createPostprocessRun(input: CreatePostprocessRunInput): PostprocessRun {
  return {
    id: input.id,
    source: input.source,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.batchId ? { batchId: input.batchId } : {}),
    ...(input.directionId ? { directionId: input.directionId } : {}),
    ...(input.directionLabel ? { directionLabel: input.directionLabel } : {}),
    status: input.queued ? 'queued' : 'running',
    stage: 'prepare',
    totalImages: Math.max(0, input.totalImages),
    completedImages: 0,
    imageUnits: 0,
    imageUnitsDone: 0,
    producedFiles: 0,
    issues: [],
    startedAt: input.startedAt ?? Date.now(),
  }
}

/**
 * 排队 → 进行中（`startedAt` 重打，界面上「开始于」是真正开工的时刻）。
 *
 * 幂等：不在排队态时原样返回 —— 并发闸的唤醒是广播式的（所有等待者都会醒来看一眼名额），
 * 被唤醒但没抢到名额的那个不该因为这次调用就把自己标成在跑。
 */
export function startQueuedPostprocessRun(run: PostprocessRun, now: number = Date.now()): PostprocessRun {
  if (run.status !== 'queued') return run
  return { ...run, status: 'running', stage: 'prepare', startedAt: now }
}

/** 应用一次进度上报，返回新对象（store 靠引用变化触发重渲染）。 */
export function applyPostprocessProgress(run: PostprocessRun, patch: PostprocessProgressPatch): PostprocessRun {
  const next: PostprocessRun = { ...run }
  if (patch.stage) next.stage = patch.stage
  if (patch.completedImages !== undefined) next.completedImages = Math.max(0, patch.completedImages)
  if (patch.imageUnits !== undefined) next.imageUnits = Math.max(0, patch.imageUnits)
  if (patch.imageUnitsDone !== undefined) next.imageUnitsDone = Math.max(0, patch.imageUnitsDone)
  if (patch.producedFiles !== undefined) next.producedFiles = Math.max(0, patch.producedFiles)
  // 空数组等于「还没写出过任何目录」→ 收回 undefined，避免记录里挂一个「有值但为空」的字段
  if (patch.outputDirs !== undefined) {
    next.outputDirs = patch.outputDirs.length > 0 ? [...patch.outputDirs] : undefined
  }
  if (patch.currentLabel !== undefined) next.currentLabel = patch.currentLabel
  return next
}

export interface FinishPostprocessRunInput {
  issues: PostprocessIssue[]
  producedFiles: number
  /** 本次的耗时构成；不传（旧调用方 / 单测）则记录上不带这个字段 */
  diagnostics?: PostprocessRunDiagnostics
  finishedAt?: number
}

/** 收尾：写入问题清单与产出数，按「有没有产出 + 有没有真错」定状态。 */
export function finishPostprocessRun(run: PostprocessRun, input: FinishPostprocessRunInput): PostprocessRun {
  const producedFiles = Math.max(0, input.producedFiles)
  return {
    ...run,
    status: resolvePostprocessRunStatus({ producedFiles, issues: input.issues }),
    stage: 'finish',
    producedFiles,
    issues: input.issues,
    completedImages: run.totalImages,
    imageUnits: 0,
    imageUnitsDone: 0,
    currentLabel: undefined,
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
    finishedAt: input.finishedAt ?? Date.now(),
  }
}

/**
 * 状态判定。
 *
 * 有产出 + 有真错 = `partial`（产物在，但有东西没做完，要让人知道）；
 * 有产出 + 只有跳过 = `succeeded`（跳过是配置使然，不是故障）；
 * 零产出 + 有真错 = `failed`；零产出 + 只有跳过 = `skipped`；
 * 零产出且无记录 = 本次没有可做的事（不算失败）。
 *
 * ⭐ **零产出那一档必须看 severity，不能只看条数**（2026-09-21 报障「记录里一堆失败、
 * 可实际最后是成功的」）：原来写的是 `issues.length > 0 ? 'failed'`，于是
 * `PP-SCOPE-002`（该方向关掉了自动后处理）、`PP-SCOPE-001`（方向没在启用范围内）这类
 * **跳过型**原因，会把整条记录染成红色「失败」；而同一个方向**手动**跑一次就产出了
 * （手动刻意不受那个开关限制，见 `taskPostprocess.ts`），用户看到的就是
 * 「一堆失败 + 一个成功」—— 其实是同一件事的两种触发方式。
 */
export function resolvePostprocessRunStatus(input: {
  producedFiles: number
  issues: PostprocessIssue[]
}): PostprocessRunStatus {
  /**
   * **取消优先于一切**（2026-09-23）。
   *
   * 不这么判的话它会掉进下面两档里：有产出 + 有真错 ⇒ 「部分完成」，零产出 ⇒ 「失败」。
   * 而中途取消往往两档都沾（停之前写出去的文件可能带着 warning、停之后自然没产出），
   * 于是「我自己按的停止」在记录里变成一条红色的失败，用户只会以为软件坏了 ——
   * 而这类记录的正确反应是「知道停在哪、产物还在、想接着跑就重跑一次」。
   */
  if (input.issues.some((issue) => issue.code === POSTPROCESS_CANCEL_CODE)) return 'canceled'
  if (input.producedFiles > 0) return input.issues.some(isErrorIssue) ? 'partial' : 'succeeded'
  if (input.issues.some(isErrorIssue)) return 'failed'
  return input.issues.length > 0 ? 'skipped' : 'succeeded'
}

/**
 * 百分比（0–100）。分母是源图张数，当前这张图按已完成单元数折算小数部分 ——
 * 一张图要产 20 个单元时，中间那 19 次也能看到数字在动，而不是卡在整数张上。
 *
 * 排队中**不给数字**（而不是给 0%）：0% 与「刚开工还没解出第一张图」在界面上长得一样，
 * 而这两件事对用户的意义完全不同 —— 一个是「还没轮到」，一个是「已经在干了」。
 */
export function getPostprocessRunPercent(run: PostprocessRun): number | undefined {
  if (run.status === 'queued') return undefined
  if (run.totalImages <= 0) return undefined
  if (run.finishedAt) return 100
  const fraction = run.imageUnits > 0 ? Math.min(1, run.imageUnitsDone / run.imageUnits) : 0
  const done = Math.min(run.totalImages, run.completedImages + fraction)
  return Math.max(0, Math.min(100, Math.round((done / run.totalImages) * 100)))
}

/** 「3/12」这种计数文本；总数未知（0）时返回 undefined，界面据此不显示。 */
export function formatPostprocessRunCount(run: PostprocessRun): string | undefined {
  if (run.totalImages <= 0) return undefined
  return `${Math.min(run.completedImages, run.totalImages)}/${run.totalImages}`
}

export function countPostprocessIssues(run: PostprocessRun): { errors: number; skipped: number } {
  let errors = 0
  let skipped = 0
  for (const issue of run.issues) {
    if (isErrorIssue(issue)) errors += 1
    else skipped += 1
  }
  return { errors, skipped }
}

/**
 * 这次**不值得留档**吗：给出的原因只有「这个方向关了自动后处理」。
 *
 * 用来回答「零产出的这条 run 该不该在进度面板与方向历史里留下一条」（见 `store.ts` 的调用处）。
 *
 * ⚠️ **不能按 `severity === 'skipped'` 一刀切** —— 跳过型里混着必须留的两类：
 * - `PP-CANCEL-001` 用户主动停的（严重度刻意是 skipped）：产物已经落盘，「停在哪了」正是他要看的；
 * - `PP-SRC-001` 源图读不到：指向真的缺数据，静默掉等于把问题藏起来。
 * 所以这里只认这一个码。它之所以特殊，是因为**开关是用户自己关的**：他当然知道关着，
 * 每批再照原样记一条「已跳过」只是拿他自己配的事实刷屏
 * （2026-09-23 杰哥报障「不要有提示跳过的提醒」）。
 */
export function isAutoDisabledOnlySkip(issues: readonly PostprocessIssue[]): boolean {
  return issues.length > 0 && issues.every((issue) => issue.code === 'PP-SCOPE-002')
}

/**
 * 一行结论（toast / 卡片副标题）。
 *
 * 与 `reportPostprocessResult` 的老文案保持同一形状（「后处理完成：产出 N 个文件」），
 * 因为用户已经认这几句；新增的只是「未完成 M 项」这一段 —— 以前这部分信息只体现在
 * 首条 warning 上，现在给出条数，细节留给「查看问题」。
 */
export function summarizePostprocessRun(run: PostprocessRun): string {
  const { errors, skipped } = countPostprocessIssues(run)
  switch (run.status) {
    case 'queued':
      return '排队等待开工：同时运行的方向数已达上限'
    case 'running':
      return `后处理进行中：${run.completedImages}/${run.totalImages}`
    case 'succeeded':
      return skipped > 0
        ? `后处理完成：产出 ${run.producedFiles} 个文件，跳过 ${skipped} 项`
        : `后处理完成：产出 ${run.producedFiles} 个文件`
    case 'partial':
      return `后处理完成：产出 ${run.producedFiles} 个文件，${errors + skipped} 项未完成（错误 ${errors}）`
    // 「没有产出」但一条真错都没有：说清是「被跳过」，不然用户以为软件坏了
    case 'skipped':
      return `后处理没有产出：${skipped} 项被跳过`
    // 「停在哪了」是这条记录唯一要说的事：产物一个没少，只是没跑完
    case 'canceled':
      return run.producedFiles > 0 ? `已取消：停止前已产出 ${run.producedFiles} 个文件` : '已取消：本次没有产出文件'
    case 'failed':
    default:
      return errors > 0 ? `后处理失败：没有产出文件（错误 ${errors}）` : '后处理失败：没有产出文件'
  }
}

/** 进度文本：计数 + 百分比 + 当前产出。界面各处共用一份，避免按钮与卡片各写一版口径。 */
export function formatPostprocessRunProgress(run: PostprocessRun): string {
  const count = formatPostprocessRunCount(run)
  const percent = getPostprocessRunPercent(run)
  const head = count ? (percent === undefined ? count : `${count} ${percent}%`) : undefined
  return [head, run.currentLabel].filter(Boolean).join(' · ')
}

/**
 * 紧凑进度（窄位置用）：只有「跑了多少 + 百分比」，**不带当前产出文件名**。
 *
 * 为什么必须有这么一份（2026-09-21 报障）：`run.currentLabel` 是写盘文件名，
 * 像 `20260921-快手-网赚-广点通-陈泽杰-1280x720-1.jpg` 有几十个字符 ——
 * 直接铺在工具栏上会把整条工具栏占满、把其它按钮挤走。工具栏只回答「跑到哪了」，
 * 「正在写哪个文件」属于详情，归悬浮提示（`formatPostprocessRunProgress`）与进度面板。
 */
export function formatPostprocessRunBadge(run: PostprocessRun): string | undefined {
  const count = formatPostprocessRunCount(run)
  if (!count) return undefined
  const percent = getPostprocessRunPercent(run)
  return percent === undefined ? count : `${count} ${percent}%`
}

/**
 * 运行时刻（给人看）。
 *
 * 带日期：会话可能跨天（午夜后还在跑），只给时刻会让人误读成今天。
 *
 * 从 `PostprocessRunsDialog` 搬到这里并导出（TB-115）：进度面板与「方向历史记录」两处都要
 * 显示同一批时间与耗时 —— 各写一份的话，同一个时刻在两个界面里长得不一样，而这种不一致
 * 最难解释（用户会以为是两次不同的运行）。
 */
export function formatPostprocessRunTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 毫秒给人看：一秒以下给整数毫秒，以上给秒（两位小数够区分钟级以内的差别）。 */
export function formatPostprocessDuration(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

/** 触发来源的展示名（进度面板与历史记录共用；「自动/手动」的口径只在这一处）。 */
export const POSTPROCESS_RUN_SOURCE_LABELS: Record<PostprocessRunSource, string> = {
  auto: '自动触发',
  manual: '手动触发',
}

/** 状态指示灯色调的取值域，与 design-system 的 `StatusIndicator` 对齐。 */
export type PostprocessStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/**
 * 状态 → 色调。定义在这里而不是各组件里（TB-115 提取）：
 * 进度面板与方向历史记录两处各写一份，必然出现「同一次运行在两个界面颜色不一样」——
 * 而那是最难解释的一种不一致（用户会以为它们不是同一次）。
 */
export const POSTPROCESS_RUN_STATUS_TONES: Record<PostprocessRunStatus, PostprocessStatusTone> = {
  // 排队用中性：它在等名额，不是故障（把「最多并发数」配小了必然会看到它）
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  // 跳过与取消都用中性灰、**不走警告黄**：它们的正确反应是「看一眼原因，决定要不要手动跑」，
  // 而黄色会把人往「出故障了」带（2026-09-21 为 `skipped` 定的口径，取消同理）。
  skipped: 'neutral',
  canceled: 'neutral',
}

/**
 * 耗时构成：`画 X · 编码 Y（N 轮）· 写盘 Z`。
 *
 * 为什么直接摊开而不是只报一个总耗时：「慢」有三种成因，处理方式完全不同 ——
 * 画得多 ⇒ 图层 / 尺寸问题（而且是**卡界面**的那一类）；编码多 ⇒ 体积上限压得紧
 * （`N 轮` 一眼看出，正常应是 1 或 3 轮）；写盘多 ⇒ 磁盘或共享盘慢，与渲染无关。
 * 只给总耗时等于这三种都得重新猜一遍。
 *
 * 返回 null 表示没有可看的数字（收尾前中断、或整批被跳过所以没走到渲染）。
 */
export function describePostprocessDiagnostics(diagnostics: PostprocessRunDiagnostics | undefined): string | null {
  if (!diagnostics) return null
  if (diagnostics.paintMs === 0 && diagnostics.encodeMs === 0 && diagnostics.writeMs === 0) return null
  return `画 ${formatPostprocessDuration(diagnostics.paintMs)} · 编码 ${formatPostprocessDuration(diagnostics.encodeMs)}（${diagnostics.encodeCount} 轮）· 写盘 ${formatPostprocessDuration(diagnostics.writeMs)}`
}
