import { create } from 'zustand'
import type { TaskProgressStage } from '../types'
import { admitDirection, releaseDirection } from '../lib/postprocessDirectionQueue'
import type { PostprocessIssue } from '../features/postprocess/postprocessIssue'
import {
  applyPostprocessProgress,
  createPostprocessRun,
  finishPostprocessRun,
  isRunInFlight,
  startQueuedPostprocessRun,
  type CreatePostprocessRunInput,
  type PostprocessProgressPatch,
  type PostprocessRun,
} from '../features/postprocess/postprocessRun'

export type LiveTaskProgress = {
  progressStage?: TaskProgressStage
  progressMessage?: string
  progressUpdatedAt?: number
}

type RuntimeStore = {
  streamPreviews: Record<string, string>
  streamPreviewSlots: Record<string, Record<string, string>>
  setTaskStreamPreview(taskId: string, image?: string, requestIndex?: number): void
  agentStreamingTexts: Record<string, string>
  setAgentStreamingText(conversationId: string, messageId: string, text: string): void
  clearAgentStreamingText(conversationId: string, messageId?: string): void
  // 高频瞬态进度：生成期间每次进度 tick 只更新这里，不重建 tasks 数组、
  // 不写 IndexedDB，避免所有 s.tasks 订阅者随进度无谓重渲染。
  taskProgress: Record<string, LiveTaskProgress>
  setTaskProgress(taskId: string, progress: LiveTaskProgress): void
  clearTaskProgress(taskId: string): void
  /**
   * 方向级并发闸：正在跑的方向键。
   *
   * 后处理已经改成「每个方向一套独立实例」—— 判据是**方向**而不是「有没有人在跑后处理」：
   * 原先这里放的是一个全局计数，素材库的「跑后处理」按钮拿它当 `loading`（而 `Button` 的
   * loading 直接等于 disabled），于是**只要有一个方向在跑，整库的按钮就点不动**
   * （2026-09-23 杰哥报障「该功能就被整体占用」）。
   *
   * 状态放 store 而不是模块级：界面要能订阅「谁在跑 / 有没有人在排队」。
   * 纯判断在 `lib/postprocessDirectionQueue.ts`（可单测），等待唤醒在
   * `features/postprocess/postprocessDirectionGate.ts`。
   */
  postprocessRunningDirections: string[]
  /**
   * 申请开工一个方向。返回 false = 名额满了（或该方向已在跑）→ 调用方把 run 标成「排队中」
   * 并去 `acquirePostprocessDirection` 等唤醒。
   */
  tryAdmitPostprocessDirection(directionKey: string, maxConcurrent: number): boolean
  /** 释放方向名额。**幂等**，且必须与 `tryAdmit...` 成对（漏释放会让别的方向一直排不上队）。 */
  releasePostprocessDirection(directionKey: string): void
  /**
   * 后处理运行记录（id → 记录），**内存态、不落盘**：进度是会话内信息，重启后没有意义，
   * 也不该撑大落库体积。
   *
   * 这就是「进度查询」的落点：界面与测试都从这里查（`getPostprocessRun` /
   * `listPostprocessRuns` / `getActivePostprocessRuns`），执行体只负责往里写。
   * 状态切换也是靠它触发重渲染 —— 不另立事件总线（项目里订阅 store 是既有写法）。
   *
   * **一条 run 服务一个方向**（`PostprocessRun.directionId`），一次触发（批次）产生 N 条 ——
   * 批次不另建一张表：它只是 run 上的一个分组键，聚合在编排层用 `Promise.all` 完成。
   */
  postprocessRuns: Record<string, PostprocessRun>
  /** 运行 id，**最近在前**；只留最近 `POSTPROCESS_RUN_KEEP` 条，避免长会话无限膨胀。 */
  postprocessRunIds: string[]
  startPostprocessRun(input: CreatePostprocessRunInput): void
  updatePostprocessRun(id: string, patch: PostprocessProgressPatch): void
  /** 排队 → 进行中（拿到并发名额后调用）。幂等，不在排队态时不动。 */
  markPostprocessRunStarted(id: string): void
  finishPostprocessRun(id: string, input: { issues: PostprocessRun['issues']; producedFiles: number }): void
  /**
   * 用户手动清掉一条运行记录（工具栏入口的 ×）。
   *
   * 存在的理由：状态入口与提示不同，它**不自动消失**（这正是不靠 toast 的原因）。
   * 但"不会自动消失"如果没有出口，用户就只能眼睁睁看着一条再也无意义的状态挂在那里 ——
   * 2026-09-21 报障「关不掉」说的就是它。**进行中的记录不允许清**：进度还在往它上面写，
   * 清掉会让后续上报全部落到空处（`updatePostprocessRun` 丢弃不存在的记录）。
   */
  dismissPostprocessRun(id: string): void
}

/**
 * 保留的运行记录条数。
 *
 * 从 20 提到 60 的原因（2026-09-23）：一条 run 现在只服务**一个方向**，一次触发（批次）
 * 就会产生 N 条（几个方向几条）。按 20 条算，跑两三轮多方向批次就会把上一次的记录整批挤掉，
 * 用户回头查「刚才那个方向为什么没出图」时记录已经没了 —— 而记录本身就是为这个场景存在的。
 * 60 条记录的内存开销可以忽略（每条只有计数与问题清单）。
 */
export const POSTPROCESS_RUN_KEEP = 60

export const useRuntimeStore = create<RuntimeStore>()((set, get) => ({
  streamPreviews: {},
  streamPreviewSlots: {},
  setTaskStreamPreview: (taskId, image, requestIndex = 0) =>
    set((state) => {
      if (image) {
        const slotKey = String(requestIndex)
        const currentSlots = state.streamPreviewSlots[taskId] ?? {}
        if (state.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return state
        return {
          streamPreviews: { ...state.streamPreviews, [taskId]: image },
          streamPreviewSlots: {
            ...state.streamPreviewSlots,
            [taskId]: { ...currentSlots, [slotKey]: image },
          },
        }
      }

      if (!(taskId in state.streamPreviews) && !(taskId in state.streamPreviewSlots)) return state
      const streamPreviews = { ...state.streamPreviews }
      const streamPreviewSlots = { ...state.streamPreviewSlots }
      delete streamPreviews[taskId]
      delete streamPreviewSlots[taskId]
      return { streamPreviews, streamPreviewSlots }
    }),
  agentStreamingTexts: {},
  setAgentStreamingText: (conversationId, messageId, text) =>
    set((state) => ({
      agentStreamingTexts: {
        ...state.agentStreamingTexts,
        [`${conversationId}:${messageId}`]: text,
      },
    })),
  clearAgentStreamingText: (conversationId, messageId) =>
    set((state) => {
      const keyPrefix = messageId ? `${conversationId}:${messageId}` : `${conversationId}:`
      const agentStreamingTexts = { ...state.agentStreamingTexts }
      if (messageId) {
        delete agentStreamingTexts[`${conversationId}:${messageId}`]
      } else {
        for (const key of Object.keys(agentStreamingTexts)) {
          if (key.startsWith(keyPrefix)) delete agentStreamingTexts[key]
        }
      }
      return { agentStreamingTexts }
    }),
  taskProgress: {},
  setTaskProgress: (taskId, progress) =>
    set((state) => {
      const current = state.taskProgress[taskId]
      if (
        current &&
        current.progressStage === progress.progressStage &&
        current.progressMessage === progress.progressMessage &&
        current.progressUpdatedAt === progress.progressUpdatedAt
      ) {
        return state
      }
      return {
        taskProgress: {
          ...state.taskProgress,
          [taskId]: { ...current, ...progress },
        },
      }
    }),
  clearTaskProgress: (taskId) =>
    set((state) => {
      if (!(taskId in state.taskProgress)) return state
      const taskProgress = { ...state.taskProgress }
      delete taskProgress[taskId]
      return { taskProgress }
    }),
  postprocessRunningDirections: [],
  tryAdmitPostprocessDirection: (directionKey, maxConcurrent) => {
    const outcome = admitDirection({ running: get().postprocessRunningDirections }, directionKey, maxConcurrent)
    if (!outcome.admitted) return false
    set({ postprocessRunningDirections: outcome.state.running })
    return true
  },
  releasePostprocessDirection: (directionKey) => {
    const outcome = releaseDirection({ running: get().postprocessRunningDirections }, directionKey)
    // 没释放成功（不在名单里）就不 set：避免每次最多余地重建一次数组、白触发一轮重渲染
    if (!outcome.released) return
    set({ postprocessRunningDirections: outcome.state.running })
  },
  postprocessRuns: {},
  postprocessRunIds: [],
  startPostprocessRun: (input) =>
    set((state) => {
      const run = createPostprocessRun(input)
      const runIds = [run.id, ...state.postprocessRunIds.filter((id) => id !== run.id)]
      const kept = runIds.slice(0, POSTPROCESS_RUN_KEEP)
      // 顺手清掉被挤出去的记录：只留 id 列表而留着记录，会变成看得见却查不到的内存泄漏
      const runs: Record<string, PostprocessRun> = {}
      for (const id of kept) {
        const existing = state.postprocessRuns[id]
        if (existing) runs[id] = existing
      }
      runs[run.id] = run
      return { postprocessRuns: runs, postprocessRunIds: kept }
    }),
  updatePostprocessRun: (id, patch) =>
    set((state) => {
      const current = state.postprocessRuns[id]
      // 记录已被挤出去的迟到上报直接丢弃：重建一条只有一半进度的记录比没有更误导
      if (!current) return state
      return { postprocessRuns: { ...state.postprocessRuns, [id]: applyPostprocessProgress(current, patch) } }
    }),
  markPostprocessRunStarted: (id) =>
    set((state) => {
      const current = state.postprocessRuns[id]
      if (!current) return state
      const next = startQueuedPostprocessRun(current)
      // 幂等：没变就不 set（广播唤醒时所有等待者都会调用一次，多数是被唤醒但没抢到名额的）
      if (next === current) return state
      return { postprocessRuns: { ...state.postprocessRuns, [id]: next } }
    }),
  finishPostprocessRun: (id, input) =>
    set((state) => {
      const current = state.postprocessRuns[id]
      if (!current) return state
      return { postprocessRuns: { ...state.postprocessRuns, [id]: finishPostprocessRun(current, input) } }
    }),
  dismissPostprocessRun: (id) =>
    set((state) => {
      const run = state.postprocessRuns[id]
      // 不存在 / 还在跑或在排队 → 不动：还没落定态的进度上报必须还有地方落
      if (!run || isRunInFlight(run)) return state
      const postprocessRuns = { ...state.postprocessRuns }
      delete postprocessRuns[id]
      return { postprocessRuns, postprocessRunIds: state.postprocessRunIds.filter((item) => item !== id) }
    }),
}))

/** 按 id 查一次后处理运行（进行中与已结束都能查到）。 */
export function getPostprocessRun(id: string): PostprocessRun | undefined {
  return useRuntimeStore.getState().postprocessRuns[id]
}

/** 最近的运行记录（最近在前）。 */
export function listPostprocessRuns(): PostprocessRun[] {
  const { postprocessRunIds, postprocessRuns } = useRuntimeStore.getState()
  return postprocessRunIds.map((id) => postprocessRuns[id]).filter((run): run is PostprocessRun => Boolean(run))
}

/** 正在跑的方向数（未必等于在飞的 run 数：还有排在队里的）。 */
export function countRunningPostprocessDirections(): number {
  return useRuntimeStore.getState().postprocessRunningDirections.length
}

/**
 * 还在飞的（排队中 + 进行中），最近在前。
 *
 * 「排队中」也算在飞：这条 run 已经占着那个方向（同一方向同时只允许一条），
 * 界面上的「后处理中」必须把它算进去，否则用户看到按钮不转了、以为整件事已经结束。
 */
export function getActivePostprocessRuns(): PostprocessRun[] {
  return listPostprocessRuns().filter(isRunInFlight)
}

/** 正在跑的（不含排队）。 */
export function getRunningPostprocessRuns(): PostprocessRun[] {
  return listPostprocessRuns().filter((run) => run.status === 'running')
}

/** 排队等名额的。 */
export function getQueuedPostprocessRuns(): PostprocessRun[] {
  return listPostprocessRuns().filter((run) => run.status === 'queued')
}

/** 某个方向当前有没有在飞的后处理（并发闸之外的第二道口径，界面与编排都用它）。 */
export function isDirectionPostprocessBusy(directionId: string): boolean {
  const { postprocessRuns, postprocessRunIds } = useRuntimeStore.getState()
  return postprocessRunIds.some((id) => {
    const run = postprocessRuns[id]
    return Boolean(run) && isRunInFlight(run!) && run!.directionId === directionId
  })
}

/**
 * 组件里订阅「这些方向里有没有在飞的后处理」。
 *
 * **判据是运行记录，不是闸的名额表**（`postprocessRunningDirections`）—— 两者必须与
 * 执行体里那条 `isDirectionPostprocessBusy` 一致，否则会出现「按钮让点、点下去被
 * `PP-RUN-001` 跳过」。差异就在于**排队中**：它占着方向但没占名额，按名额表判会漏。
 *
 * 返回布尔而不是数组：数组每次都是新引用，会让订阅者在**任何** store 变化时重渲染
 * （进度每次上报都是 store 变化，一次后处理几十秒里能触发上千次）。
 */
export function useAnyDirectionPostprocessBusy(directionIds: readonly string[]): boolean {
  return useRuntimeStore((state) => {
    if (directionIds.length === 0) return false
    const busy = new Set(directionIds)
    for (const id of state.postprocessRunIds) {
      const run = state.postprocessRuns[id]
      if (run && isRunInFlight(run) && run.directionId && busy.has(run.directionId)) return true
    }
    return false
  })
}

/** 某个批次（一次触发）的全部 run，最近在前。 */
export function listPostprocessRunsForBatch(batchId: string): PostprocessRun[] {
  return listPostprocessRuns().filter((run) => run.batchId === batchId)
}

/**
 * 一次运行是否「还在飞」——`postprocessRunningDirections` 与运行记录是两份信息，
 * 界面判断加载态优先看记录（它带得出进度），名额表只作兜底。
 */
export function hasActivePostprocessRun(): boolean {
  return getActivePostprocessRuns().length > 0
}

/** 某个任务的最近一次后处理运行（任务卡按任务找自己的进度）。 */
export function getLatestPostprocessRunForTask(taskId: string): PostprocessRun | undefined {
  return listPostprocessRuns().find((run) => run.taskId === taskId)
}

/**
 * 某个任务**最近一批**的全部 run（同一 `batchId`）—— 任务卡按方向汇总要用。
 *
 * 取最近一批而不是全部历史：任务卡只有一行位置，把几次触发混在一起显示会得到一个
 * 没有意义的和（「产出 12 个文件」是两次跑的总和，用户无从判断这次成了没）。
 * 内部按 store 快照取，避免在 selector 里现建数组（那会让订阅者每一次进度上报都重渲染）。
 */
function collectTaskBatchRuns(
  state: { postprocessRunIds: string[]; postprocessRuns: Record<string, PostprocessRun> },
  taskId: string,
): PostprocessRun[] {
  const taskRuns: PostprocessRun[] = []
  for (const id of state.postprocessRunIds) {
    const run = state.postprocessRuns[id]
    if (run?.taskId === taskId) taskRuns.push(run)
  }
  const head = taskRuns[0]
  if (!head) return []
  if (!head.batchId) return [head]
  return taskRuns.filter((run) => run.batchId === head.batchId)
}

/** 某个任务最近一批的全部 run（命令式读取，不进渲染）。 */
export function getLatestPostprocessBatchForTask(taskId: string): PostprocessRun[] {
  return collectTaskBatchRuns(useRuntimeStore.getState(), taskId)
}

/**
 * 任务卡用：该任务当前**在飞的方向数**（0 = 没有在飞的）。
 *
 * 返回数字而不是数组：数组每次都是新引用，会让卡片在任何一次进度上报时重渲染
 * （一次后处理几十秒里上千次上报，任务网格里几十张卡会一起跟着抖）。
 */
export function useTaskPostprocessInflightCount(taskId: string): number {
  return useRuntimeStore((state) => {
    let count = 0
    for (const id of state.postprocessRunIds) {
      const run = state.postprocessRuns[id]
      if (run && run.taskId === taskId && isRunInFlight(run)) count += 1
    }
    return count
  })
}

/** 任务卡用：该任务最近一批里**已落定**的那些方向的问题条数（在飞的还没结论，不计）。 */
export function useTaskPostprocessIssueCount(taskId: string): number {
  return useRuntimeStore((state) => {
    let count = 0
    for (const run of collectTaskBatchRuns(state, taskId)) {
      if (!isRunInFlight(run)) count += run.issues.length
    }
    return count
  })
}

/** 「查看问题」点击时命令式取该任务最近一批的问题清单。 */
export function getTaskPostprocessIssues(taskId: string): PostprocessIssue[] {
  return getLatestPostprocessBatchForTask(taskId).flatMap((run) => run.issues)
}

/** 最近一次后处理运行（不分来源；「查看问题」入口用它）。 */
export function getLatestPostprocessRun(): PostprocessRun | undefined {
  return listPostprocessRuns()[0]
}

/** 组件里订阅「最近一次运行」，避免各处自己拼 id 列表。 */
export function useLatestPostprocessRun(): PostprocessRun | undefined {
  return useRuntimeStore((state) => {
    const id = state.postprocessRunIds[0]
    return id ? state.postprocessRuns[id] : undefined
  })
}

/**
 * 组件里订阅**全部**运行记录（最近在前）。
 *
 * 分两步取（先拿不变的两个引用，再在渲染里 map）：直接把 map+filter 写进 selector 会
 * 每次返回新数组，让订阅者在**任何** store 变化时都重渲染一遍（进度每次上报都是 store 变化）。
 */
export function usePostprocessRuns(): PostprocessRun[] {
  const runIds = useRuntimeStore((state) => state.postprocessRunIds)
  const runs = useRuntimeStore((state) => state.postprocessRuns)
  return runIds.map((id) => runs[id]).filter((run): run is PostprocessRun => Boolean(run))
}

/** 组件里订阅某个任务的最近一次运行。 */
export function useLatestPostprocessRunForTask(taskId: string): PostprocessRun | undefined {
  return useRuntimeStore((state) => {
    for (const id of state.postprocessRunIds) {
      const run = state.postprocessRuns[id]
      if (run?.taskId === taskId) return run
    }
    return undefined
  })
}
