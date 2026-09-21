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

import { isErrorIssue, type PostprocessIssue, type PostprocessStage } from './postprocessIssue'

export type PostprocessRunSource = 'auto' | 'manual'

export type PostprocessRunStatus = 'running' | 'succeeded' | 'partial' | 'failed'

export const POSTPROCESS_RUN_STATUS_LABELS: Record<PostprocessRunStatus, string> = {
  running: '进行中',
  succeeded: '成功',
  partial: '部分完成',
  failed: '失败',
}

export interface PostprocessRun {
  id: string
  /** 自动（任务完成触发）还是手动（素材库补跑） */
  source: PostprocessRunSource
  /** 自动触发时对应的任务 id，供任务卡按任务找自己的进度 */
  taskId?: string
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
  /** 当前正在处理的那个产出（「头条 1080x1920 · xxx.jpg」） */
  currentLabel?: string
  issues: PostprocessIssue[]
  startedAt: number
  finishedAt?: number
}

/** 进度补丁：全部是**绝对值**而不是增量 —— 增量在重试 / 并发下容易算重，绝对值天然幂等。 */
export interface PostprocessProgressPatch {
  stage?: PostprocessStage
  completedImages?: number
  imageUnits?: number
  imageUnitsDone?: number
  producedFiles?: number
  currentLabel?: string
}

export interface CreatePostprocessRunInput {
  id: string
  source: PostprocessRunSource
  taskId?: string
  totalImages: number
  startedAt?: number
}

export function createPostprocessRun(input: CreatePostprocessRunInput): PostprocessRun {
  return {
    id: input.id,
    source: input.source,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    status: 'running',
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

/** 应用一次进度上报，返回新对象（store 靠引用变化触发重渲染）。 */
export function applyPostprocessProgress(run: PostprocessRun, patch: PostprocessProgressPatch): PostprocessRun {
  const next: PostprocessRun = { ...run }
  if (patch.stage) next.stage = patch.stage
  if (patch.completedImages !== undefined) next.completedImages = Math.max(0, patch.completedImages)
  if (patch.imageUnits !== undefined) next.imageUnits = Math.max(0, patch.imageUnits)
  if (patch.imageUnitsDone !== undefined) next.imageUnitsDone = Math.max(0, patch.imageUnitsDone)
  if (patch.producedFiles !== undefined) next.producedFiles = Math.max(0, patch.producedFiles)
  if (patch.currentLabel !== undefined) next.currentLabel = patch.currentLabel
  return next
}

export interface FinishPostprocessRunInput {
  issues: PostprocessIssue[]
  producedFiles: number
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
    finishedAt: input.finishedAt ?? Date.now(),
  }
}

/**
 * 状态判定。
 *
 * 有产出 + 有真错 = `partial`（产物在，但有东西没做完，要让人知道）；
 * 有产出 + 只有跳过 = `succeeded`（跳过是配置使然，不是故障）；
 * 零产出但有记录 = `failed`；零产出且无记录 = 本次没有可做的事（不算失败）。
 */
export function resolvePostprocessRunStatus(input: {
  producedFiles: number
  issues: PostprocessIssue[]
}): PostprocessRunStatus {
  if (input.producedFiles > 0) return input.issues.some(isErrorIssue) ? 'partial' : 'succeeded'
  return input.issues.length > 0 ? 'failed' : 'succeeded'
}

/**
 * 百分比（0–100）。分母是源图张数，当前这张图按已完成单元数折算小数部分 ——
 * 一张图要产 20 个单元时，中间那 19 次也能看到数字在动，而不是卡在整数张上。
 */
export function getPostprocessRunPercent(run: PostprocessRun): number | undefined {
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
 * 一行结论（toast / 卡片副标题）。
 *
 * 与 `reportPostprocessResult` 的老文案保持同一形状（「后处理完成：产出 N 个文件」），
 * 因为用户已经认这几句；新增的只是「未完成 M 项」这一段 —— 以前这部分信息只体现在
 * 首条 warning 上，现在给出条数，细节留给「查看问题」。
 */
export function summarizePostprocessRun(run: PostprocessRun): string {
  const { errors, skipped } = countPostprocessIssues(run)
  switch (run.status) {
    case 'running':
      return `后处理进行中：${run.completedImages}/${run.totalImages}`
    case 'succeeded':
      return skipped > 0
        ? `后处理完成：产出 ${run.producedFiles} 个文件，跳过 ${skipped} 项`
        : `后处理完成：产出 ${run.producedFiles} 个文件`
    case 'partial':
      return `后处理完成：产出 ${run.producedFiles} 个文件，${errors + skipped} 项未完成（错误 ${errors}）`
    case 'failed':
    default:
      return errors > 0 ? `后处理失败：没有产出文件（错误 ${errors}）` : '后处理结束：没有产出文件'
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
 * 像 `20260921-快手-网赚-纯净版-陈泽杰-1280x720-1.jpg` 有几十个字符 ——
 * 直接铺在工具栏上会把整条工具栏占满、把其它按钮挤走。工具栏只回答「跑到哪了」，
 * 「正在写哪个文件」属于详情，归悬浮提示（`formatPostprocessRunProgress`）与进度面板。
 */
export function formatPostprocessRunBadge(run: PostprocessRun): string | undefined {
  const count = formatPostprocessRunCount(run)
  if (!count) return undefined
  const percent = getPostprocessRunPercent(run)
  return percent === undefined ? count : `${count} ${percent}%`
}
