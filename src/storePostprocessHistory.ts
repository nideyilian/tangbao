/**
 * 方向级后处理历史（**落盘**）。
 *
 * 与 `runtimeStore` 里的 `postprocessRuns` 分工，别混：
 * - `postprocessRuns` = **正在跑**（内存态、高频上报、重启即失、只留会话内 60 条）；
 * - 这里 = **跑完了**（落盘、按方向分桶、长期累积、可查历史条目）。
 *
 * 收尾时由 `store.ts` 从一条 run 生成一条记录并追加（`createHistoryEntryFromRun`），
 * 于是「实时进度」与「长期留档」是同一份数据的两个生命周期，而不是两套各自记账的东西。
 *
 * 数据表与算法在 `features/postprocess/postprocessHistory.ts`（纯逻辑、可单测），这里只负责
 * 存放、订阅与落盘 —— 与 `storePostprocessMedia` 同一个格局。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from './lib/desktopJsonStorage'
import {
  EMPTY_POSTPROCESS_HISTORY,
  appendHistoryEntry,
  clearHistoryForDirection,
  normalizePostprocessHistory,
  type PostprocessHistoryEntry,
  type PostprocessHistoryState,
} from './features/postprocess/postprocessHistory'

export interface PostprocessHistoryStore extends PostprocessHistoryState {
  /** 追加一条历史（同 id 是替换而不是并存，见 `appendHistoryEntry`）。 */
  appendPostprocessHistory: (entry: PostprocessHistoryEntry) => void
  /** 清掉某个方向的历史 */
  clearDirectionPostprocessHistory: (directionId: string) => void
  /** 清掉全部历史（设置页的「清空历史」，用户主动） */
  clearAllPostprocessHistory: () => void
}

/**
 * 稳定的空数组引用。
 *
 * 不能在 selector 里现建 `[]`：每次渲染返回新引用会让订阅者在**任何** store 变化时重渲染
 * （后处理期间 store 变化很频繁）。这与 `runtimeStore` 里那几处「返回布尔而不是数组」同一条理由。
 */
const EMPTY_ENTRIES: PostprocessHistoryEntry[] = []

export const usePostprocessHistoryStore = create<PostprocessHistoryStore>()(
  persist(
    (set) => ({
      ...EMPTY_POSTPROCESS_HISTORY,
      appendPostprocessHistory: (entry) => set((state) => appendHistoryEntry(state, entry)),
      clearDirectionPostprocessHistory: (directionId) => set((state) => clearHistoryForDirection(state, directionId)),
      clearAllPostprocessHistory: () => set({ byDirection: {} }),
    }),
    {
      name: 'tangbao-postprocess-history',
      /**
       * v1 = 首版。
       *
       * `migrate` 走**归一化+补默认值**（而不是像 `compositeV2` 那样丢弃式迁移）：
       * 这里没有需要折算的旧语义，将来新增字段让归一化兜默认值即可 ——
       * 用户的历史是「回头查账」用的，不该因为一次升级就清零。
       */
      version: 1,
      storage: createDesktopJsonStorage('postprocessHistory'),
      /**
       * ⚠️ **显式白名单**：新字段忘了加进来 = 写的时候当没发生、重启就没了，
       * 而界面上不报任何错（`appDataNamespaceContract` 只守得住 namespace，守不住字段）。
       */
      partialize: (state) => ({ byDirection: state.byDirection }),
      migrate: (persisted) => normalizePostprocessHistory(persisted),
    },
  ),
)

/** 命令式追加（执行体收尾用，不进组件渲染）。 */
export function appendPostprocessHistoryEntry(entry: PostprocessHistoryEntry): void {
  usePostprocessHistoryStore.getState().appendPostprocessHistory(entry)
}

/**
 * 生成历史记录 id。
 *
 * 用 `Date.now()` + 随机后缀（与 `store.ts` 生成 runId 同一个模式）而不是 `crypto.randomUUID()`：
 * 后者在 jsdom / 老渲染环境里不一定存在，而这里只需要「同一批里不重号」。
 */
export function createPostprocessHistoryId(): string {
  return `pph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 命令式读整个状态（启动放行目录、备份导出用）。 */
export function getPostprocessHistoryState(): PostprocessHistoryState {
  return usePostprocessHistoryStore.getState()
}

/** 组件里订阅某个方向的历史（最新在前；没有就是稳定的空数组）。 */
export function usePostprocessHistoryForDirection(directionId: string): PostprocessHistoryEntry[] {
  return usePostprocessHistoryStore((state) => state.byDirection[directionId] ?? EMPTY_ENTRIES)
}

/**
 * 组件里订阅整张表。
 *
 * 返回的是 `byDirection` 这个**对象本身**（引用只在变更时变），方向列表由组件自己
 * `Object.keys` —— 直接返回 keys 数组每次都是新引用，会让订阅者无谓重渲染。
 */
export function usePostprocessHistoryByDirection(): Record<string, PostprocessHistoryEntry[]> {
  return usePostprocessHistoryStore((state) => state.byDirection)
}
