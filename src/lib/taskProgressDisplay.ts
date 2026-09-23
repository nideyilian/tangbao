import type { TaskProgressStage, TaskRecord } from '../types'
import type { LiveTaskProgress } from '../stores/runtimeStore'

export type TaskProgressTone = 'running' | 'success' | 'warning' | 'error' | 'neutral'

export interface TaskProgressDisplay {
  cardLabel: string
  detailTitle: string
  detailDescription: string
  tone: TaskProgressTone
  reasons: string[]
}

const NO_REASON_TEXT = '服务商没有返回具体原因。'

function getRequestedCount(task: TaskRecord): number {
  return task.batchItemStatuses?.length || task.params?.n || 1
}

function getSuccessCount(task: TaskRecord): number {
  if (task.batchItemStatuses?.length) {
    return task.batchItemStatuses.filter((status) => status === 'done').length
  }
  return task.outputImages?.length ?? 0
}

/** 已保存的输出数量达到请求数量时，生成结果本身应视为成功，不能被后续加载错误覆盖。 */
export function hasCompletedTaskOutputCount(task: TaskRecord, outputCount: number): boolean {
  return outputCount > 0 && outputCount >= getRequestedCount(task)
}

export function hasCompletedTaskOutputs(task: TaskRecord): boolean {
  return hasCompletedTaskOutputCount(task, task.outputImages?.length ?? 0)
}

function getTaskSourceLabel(task: TaskRecord): string {
  const profileName = task.apiProfileName?.trim()
  const model = task.apiModel?.trim()
  if (profileName && model) return `${profileName} / ${model}`
  if (profileName) return profileName
  if (model) return model
  if (task.apiProvider) return String(task.apiProvider)
  return '服务商'
}

function isStoppedTask(task: TaskRecord, liveProgress?: LiveTaskProgress): boolean {
  const text = `${task.error ?? ''} ${liveProgress?.progressMessage ?? task.progressMessage ?? ''}`
  return /已停止|已取消|请求中断|任务已中止|停止生成/.test(text)
}

function getFailureReason(task: TaskRecord, liveProgress?: LiveTaskProgress): string {
  const reason = task.error?.trim() || liveProgress?.progressMessage?.trim() || task.progressMessage?.trim()
  return reason || NO_REASON_TEXT
}

function getPartialFailureReasons(task: TaskRecord): string[] {
  const errorsByIndex = new Map<number, string>()
  for (const item of task.batchItemErrors ?? []) {
    errorsByIndex.set(item.index, item.error?.trim() || NO_REASON_TEXT)
  }

  if (task.batchItemStatuses?.length) {
    return task.batchItemStatuses
      .map((status, index) => {
        if (status !== 'error') return null
        return `第 ${index + 1} 张：${errorsByIndex.get(index) || NO_REASON_TEXT}`
      })
      .filter((reason): reason is string => Boolean(reason))
  }

  return (task.batchItemErrors ?? []).map((item) => `第 ${item.index + 1} 张：${item.error?.trim() || NO_REASON_TEXT}`)
}

function hasPartialFailure(task: TaskRecord): boolean {
  return Boolean(
    task.batchItemStatuses?.some((status) => status === 'error') ||
    task.batchItemErrors?.length ||
    (task.status === 'done' && task.params.n > (task.outputImages?.length ?? 0)),
  )
}

function getRunningStage(task: TaskRecord, liveProgress?: LiveTaskProgress): TaskProgressStage {
  if (liveProgress?.progressStage ?? task.progressStage) return liveProgress?.progressStage ?? task.progressStage!
  if (task.falRequestId || task.customTaskId) return 'relay-received'
  if ((task.outputImages?.length ?? 0) > 0) return 'generating'
  return 'requesting'
}

function getRunningDescription(task: TaskRecord, stage: TaskProgressStage, liveProgress?: LiveTaskProgress): string {
  const requested = getRequestedCount(task)
  const success = getSuccessCount(task)
  if (stage === 'prompting') {
    // 卡片先建、提示词后写：这里要交代清楚「还没开始生图」，否则用户会以为卡住不动。
    return (
      liveProgress?.progressMessage?.trim() ||
      task.progressMessage?.trim() ||
      '正在编写这次的生图提示词，写好会自动开始生图。'
    )
  }
  if (stage === 'relay-received') {
    return (
      liveProgress?.progressMessage?.trim() || task.progressMessage?.trim() || '服务商已接收任务，正在等待生成结果。'
    )
  }
  if (stage === 'previewing' || stage === 'generating') {
    return `已生成 ${success} / ${requested} 张，继续等待剩余图片。`
  }
  if (stage === 'saving') {
    return `已生成 ${success} / ${requested} 张，正在保存结果。`
  }
  return (
    liveProgress?.progressMessage?.trim() ||
    task.progressMessage?.trim() ||
    `正在把请求发送给 ${getTaskSourceLabel(task)}。`
  )
}

function runningDisplay(task: TaskRecord, liveProgress?: LiveTaskProgress): TaskProgressDisplay {
  const stage = getRunningStage(task, liveProgress)
  const cardLabel =
    stage === 'prompting'
      ? '编写提示词中'
      : stage === 'relay-received'
        ? '中转站接收中'
        : stage === 'previewing' || stage === 'generating' || stage === 'saving'
          ? '生成中'
          : '发送请求中'

  return {
    cardLabel,
    detailTitle: cardLabel,
    detailDescription: getRunningDescription(task, stage, liveProgress),
    tone: 'running',
    reasons: [],
  }
}

function partialFailureDisplay(task: TaskRecord): TaskProgressDisplay {
  const requested = getRequestedCount(task)
  const success = getSuccessCount(task)
  const reasons = getPartialFailureReasons(task)
  const reasonText = reasons.length
    ? `未生成的图片原因：${reasons.join('；')}。`
    : `未生成的图片原因：${NO_REASON_TEXT}`

  return {
    cardLabel: '数量不够',
    detailTitle: '生成数量不够',
    detailDescription: `请求 ${requested} 张，实际生成 ${success} 张。${reasonText}`,
    tone: 'warning',
    reasons,
  }
}

function recoverableDisplay(task: TaskRecord): TaskProgressDisplay {
  const reason = task.error?.trim()
  return {
    cardLabel: '重连查询中',
    detailTitle: '重连查询中',
    detailDescription: reason ? `${reason} 之后会继续查询任务结果。` : '连接已断开，之后会继续查询任务结果。',
    tone: 'warning',
    reasons: [],
  }
}

/**
 * 上次会话被中断（应用退出 / 崩溃）留下的任务。
 *
 * ⚠️ 必须与「已停止」分开：那是**用户自己按的停止**，这是**应用没了**。
 * 前者不需要再跑，后者可以接着跑 —— 长得像，但该做的事相反。
 * 判据用 `interruptedAt` 字段，不靠匹配 `task.error` 的文案（改文案就失效）。
 */
function interruptedDisplay(task: TaskRecord): TaskProgressDisplay {
  const requested = getRequestedCount(task)
  const success = getSuccessCount(task)
  const reason = task.error?.trim()
  return {
    cardLabel: '上次没跑完',
    detailTitle: '上次没跑完',
    detailDescription:
      `应用退出时这条任务还在跑，已产出 ${success} / ${requested} 张。` +
      `点「继续」会把剩下的接着跑完，已经产出的不会重复生成。` +
      (reason ? `中断原因：${reason}。` : ''),
    tone: 'warning',
    reasons: reason ? [reason] : [],
  }
}

function errorDisplay(task: TaskRecord, liveProgress?: LiveTaskProgress): TaskProgressDisplay {
  if (isStoppedTask(task, liveProgress)) {
    const reason = getFailureReason(task, liveProgress)
    return {
      cardLabel: '已停止',
      detailTitle: '任务已停止',
      detailDescription: `任务已停止：${reason}`,
      tone: 'warning',
      reasons: [reason],
    }
  }

  const reason = getFailureReason(task, liveProgress)
  // 失败在「写提示词」环节：卡片要说清是哪一段坏的 —— 提示词没写出来时生图根本没开始，
  // 跟「生图失败」要用户做的事不一样（前者重试写词、后者重试出图）。
  if (task.promptFailed) {
    return {
      cardLabel: '提示词失败',
      detailTitle: '提示词生成失败',
      detailDescription: reason,
      tone: 'error',
      reasons: [reason],
    }
  }
  return {
    cardLabel: '生成失败',
    detailTitle: '生成失败',
    detailDescription: `任务失败：${reason}`,
    tone: 'error',
    reasons: [reason],
  }
}

export function getTaskProgressDisplay(task: TaskRecord, liveProgress?: LiveTaskProgress): TaskProgressDisplay {
  if (task.status === 'running') return runningDisplay(task, liveProgress)
  // 中断优先于「数量够了就算完成」：被标记中断的任务一定是"没跑完就断了"
  // （跑满的会先走成 done，根本不会被标记），所以放在前面不会误伤。
  if (task.interruptedAt) return interruptedDisplay(task)
  if (hasCompletedTaskOutputs(task)) {
    return {
      cardLabel: '已完成',
      detailTitle: '已完成',
      detailDescription: `生成完成，共 ${task.outputImages.length} 张图片。`,
      tone: 'success',
      reasons: [],
    }
  }
  if (task.status === 'error' && (task.falRecoverable || task.customRecoverable)) return recoverableDisplay(task)
  if (hasPartialFailure(task)) return partialFailureDisplay(task)
  if (task.status === 'error') return errorDisplay(task, liveProgress)

  const count = task.outputImages.length
  return {
    cardLabel: '已完成',
    detailTitle: '已完成',
    detailDescription: count > 0 ? `生成完成，共 ${count} 张图片。` : '生成完成。',
    tone: 'success',
    reasons: [],
  }
}
