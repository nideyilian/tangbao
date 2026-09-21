import { create } from 'zustand'
import type { TaskProgressStage } from '../types'
import {
  applyPostprocessProgress,
  createPostprocessRun,
  finishPostprocessRun,
  type PostprocessProgressPatch,
  type PostprocessRun,
  type PostprocessRunSource,
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
  // 后处理在飞计数。后处理是「点了之后几十秒内没有任何界面变化」的典型场景，
  // 计数 > 0 时素材库的「跑后处理」按钮显示加载态——用户据此判断「点了到底有没有生效」。
  // 用计数而不是布尔：自动产出（任务完成触发）与手动补跑可能同时发生。
  postprocessRunning: number
  beginPostprocess(): void
  endPostprocess(): void
  /**
   * 后处理运行记录（id → 记录），**内存态、不落盘**：进度是会话内信息，重启后没有意义，
   * 也不该撑大落库体积。
   *
   * 这就是「进度查询」的落点：界面与测试都从这里查（`getPostprocessRun` /
   * `listPostprocessRuns` / `getActivePostprocessRuns`），执行体只负责往里写。
   * 状态切换也是靠它触发重渲染 —— 不另立事件总线（项目里订阅 store 是既有写法）。
   */
  postprocessRuns: Record<string, PostprocessRun>
  /** 运行 id，**最近在前**；只留最近 `POSTPROCESS_RUN_KEEP` 条，避免长会话无限膨胀。 */
  postprocessRunIds: string[]
  startPostprocessRun(input: { id: string; source: PostprocessRunSource; taskId?: string; totalImages: number }): void
  updatePostprocessRun(id: string, patch: PostprocessProgressPatch): void
  finishPostprocessRun(id: string, input: { issues: PostprocessRun['issues']; producedFiles: number }): void
}

/** 保留的运行记录条数（够看「最近几次」，又不至于长会话里无限堆积）。 */
export const POSTPROCESS_RUN_KEEP = 20

export const useRuntimeStore = create<RuntimeStore>()((set) => ({
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
  postprocessRunning: 0,
  beginPostprocess: () => set((state) => ({ postprocessRunning: state.postprocessRunning + 1 })),
  // 计数减到 0 为止：异常路径里多调一次 endPostprocess 也不该让计数变负（否则按钮永久转圈）
  endPostprocess: () => set((state) => ({ postprocessRunning: Math.max(0, state.postprocessRunning - 1) })),
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
  finishPostprocessRun: (id, input) =>
    set((state) => {
      const current = state.postprocessRuns[id]
      if (!current) return state
      return { postprocessRuns: { ...state.postprocessRuns, [id]: finishPostprocessRun(current, input) } }
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

/** 正在跑的那些（可能同时有自动与手动两条）。 */
export function getActivePostprocessRuns(): PostprocessRun[] {
  return listPostprocessRuns().filter((run) => run.status === 'running')
}

/**
 * 一次运行是否「还在飞」——`postprocessRunning` 计数与运行记录是两份信息，
 * 界面判断加载态优先看记录（它带得出进度），计数只作兜底。
 */
export function hasActivePostprocessRun(): boolean {
  return getActivePostprocessRuns().length > 0
}

/** 某个任务的最近一次后处理运行（任务卡按任务找自己的进度）。 */
export function getLatestPostprocessRunForTask(taskId: string): PostprocessRun | undefined {
  return listPostprocessRuns().find((run) => run.taskId === taskId)
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
