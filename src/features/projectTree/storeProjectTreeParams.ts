/**
 * 统一项目树的**参数层** store。
 *
 * 只管「节点 → 参数覆盖」，结构 / 名称一律走 `useAssetLibraryStore` 的 collections（唯一主源）。
 * 这样左侧栏、SOP、后处理、水印看到的是同一棵树的同一个 id，不会出现「表格改完、别处没跟上」。
 *
 * 与节点删除的关系：节点被删除时参数**刻意保留**，不做「删节点顺手清参数」。
 * 孤儿参数不参与解析、也不出现在表格里，代价只是几条没人看的记录；而一旦用户撤销删除、
 * 或从回收站恢复文件夹，同一 id 的参数会立刻重新生效。两个方向的错误代价不对称，故选保守的那个。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from '../../lib/desktopJsonStorage'
import type { PostprocessNodeOverride } from '../../lib/postprocessMedia'
import { buildProjectNodeParams, normalizeProjectNodeParamsMap } from './params'
import type { ProjectNodeParamsMap } from './types'

export interface ProjectTreeParamsStore {
  /** 键为 `AssetCollection.id` */
  params: ProjectNodeParamsMap
  /** 按补丁更新某节点的后处理参数；`undefined` 的字段表示恢复该字段的继承 */
  setPostprocessOverride: (collectionId: string, patch: PostprocessNodeOverride) => void
  /** 清空某节点的全部参数（整条记录删除，回到完全继承） */
  clearNodeParams: (collectionId: string) => void
}

/** 只取持久化切片，供备份导出与跨模块读取。 */
export function getProjectTreeParamsSnapshot(state: ProjectTreeParamsStore): ProjectNodeParamsMap {
  const snapshot: ProjectNodeParamsMap = {}
  for (const [id, value] of Object.entries(state.params)) {
    snapshot[id] = { ...value, ...(value.postprocess ? { postprocess: { ...value.postprocess } } : {}) }
  }
  return snapshot
}

export const useProjectTreeParamsStore = create<ProjectTreeParamsStore>()(
  persist(
    (set) => ({
      params: {},

      setPostprocessOverride: (collectionId, patch) =>
        set((state) => {
          const id = typeof collectionId === 'string' ? collectionId.trim() : ''
          if (!id) return state
          const next = buildProjectNodeParams(state.params[id], patch)
          // 补丁把字段全清空了 → 删掉整条记录，而不是留一个空对象（空对象会在表格里显示成「已配置」）
          if (!next) {
            if (!state.params[id]) return state
            const params = { ...state.params }
            delete params[id]
            return { params }
          }
          return { params: { ...state.params, [id]: next } }
        }),

      clearNodeParams: (collectionId) =>
        set((state) => {
          if (!state.params[collectionId]) return state
          const params = { ...state.params }
          delete params[collectionId]
          return { params }
        }),
    }),
    {
      name: 'tangbao-project-tree-params',
      version: 1,
      storage: createDesktopJsonStorage('projectTreeParams'),
      partialize: (state) => ({ params: state.params }),
      migrate: (persisted) => {
        const input = (persisted ?? {}) as Record<string, unknown>
        return { params: normalizeProjectNodeParamsMap(input.params) }
      },
    },
  ),
)
