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
import type { ImageVideoNodeOverride } from '../imageVideo/types'
import {
  buildImageVideoNodeParams,
  buildProjectNodeParams,
  collectPromotedNodeFieldValues,
  hasLegacyNodeOnlyFields,
  normalizeProjectNodeParamsMap,
  type PromotedNodeFieldValues,
} from './params'
import type { ProjectNodeParamsMap } from './types'

export interface ProjectTreeParamsStore {
  /** 键为 `AssetCollection.id` */
  params: ProjectNodeParamsMap
  /**
   * 升级迁移时从节点上「提升」出来的全局值（R-63 / ADR-0011）。
   *
   * 背景：`PostprocessNodeOverride` 从 10 字段收到 3 字段后，旧数据里挂在节点上的
   * `namePattern` / `creator` / `autoCompanionClean` / `distribution` 会被归一化丢弃 ——
   * 用户配好的值凭空消失且不可逆。所以在 `migrate` 里把最深节点的值接住存在这里，
   * 由消费方合并进全局基线（见 `mergePromotedGlobals`）。
   *
   * 只在迁移那一次写入；之后一直是只读的历史存档，不参与 UI 编辑。
   */
  promotedGlobals: PromotedNodeFieldValues
  /** 按补丁更新某节点的后处理参数；`undefined` 的字段表示恢复该字段的继承 */
  setPostprocessOverride: (collectionId: string, patch: PostprocessNodeOverride) => void
  /** 按补丁更新某节点的图转视频参数；语义同上（`undefined` = 恢复继承） */
  setImageVideoOverride: (collectionId: string, patch: ImageVideoNodeOverride) => void
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

/**
 * 把迁移提升出来的全局值合进全局基线（ADR-0011 / R-63）。
 *
 * **只补空缺**：基线里已经有值的字段不被覆盖。理由是迁移值来自「某个具体节点过去的写法」，
 * 而基线是用户当前的全局设置——若基线已有值，说明用户后来在全局层明确设过，
 * 那个选择比历史残留更该被尊重。迁移的职责只是**不让值凭空消失**，不是夺回控制权。
 *
 * **「空缺」的判定按类型分**：
 * - 字符串字段（`namePattern` / `creator`）：`undefined` **或空串**都算空缺 ——
 *   基线里 `creator: ''` 就是「没填过」，不能因为它是空串就把迁移值挡掉；
 * - 对象字段（`distribution`）：只有 `undefined` 算空缺（整个对象缺席才算没设过）。
 *
 * 调用点在组装 `globalConfig` 的地方（`PostprocessSettingsModal` 的宿主
 * 与运行时产出链路 `runTaskPostprocess`）——统一走这里，避免各处各写一遍合并口径。
 */
export function mergePromotedGlobals<T extends Partial<PromotedNodeFieldValues>>(
  base: T,
  promoted: PromotedNodeFieldValues,
): T {
  const merged: T = { ...base }
  const isBlankString = (value: unknown) => value === undefined || (typeof value === 'string' && value === '')
  if (isBlankString(merged.namePattern) && promoted.namePattern) {
    merged.namePattern = promoted.namePattern as T['namePattern']
  }
  if (isBlankString(merged.creator) && promoted.creator) {
    merged.creator = promoted.creator as T['creator']
  }
  if (merged.distribution === undefined && promoted.distribution !== undefined) {
    merged.distribution = promoted.distribution as T['distribution']
  }
  return merged
}

export const useProjectTreeParamsStore = create<ProjectTreeParamsStore>()(
  persist(
    (set) => ({
      params: {},
      promotedGlobals: {},

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

      setImageVideoOverride: (collectionId, patch) =>
        set((state) => {
          const id = typeof collectionId === 'string' ? collectionId.trim() : ''
          if (!id) return state
          const next = buildImageVideoNodeParams(state.params[id], patch)
          if (!next) {
            if (!state.params[id]) return state
            const params = { ...state.params }
            delete params[id]
            return { params }
          }
          return { params: { ...state.params, [id]: next } }
        }),
    }),
    {
      name: 'tangbao-project-tree-params',
      // v2：`PostprocessNodeOverride` 由 10 字段收到 3 字段（ADR-0011），
      // `namePattern` / `creator` / `autoCompanionClean` / `distribution` 收归全局。
      // **必须 bump** —— 版本号不变时 zustand 不调 `migrate`，节点上的旧值会被 `normalize` 直接丢弃，
      // 用户在方向节点上配好的命名模板 / 分发排期会凭空消失且不可逆（R-63）。
      // v1 → v2 的迁移做两件事：① 归一化时顺手丢掉节点上的旧字段；② 把值提升到 `promotedGlobals`。
      // v3：节点级 `selectedMediaIds` 里的 `clean`（当年的「纯净版」）被归一化剔掉
      // （ADR-0020 / TB-120）。**同样必须 bump** —— 与 v2 同一条理由：不跑 `migrate` 就清不掉，
      // 库里几十个方向会继续每次多产一份谁都没勾过的「纯净版」。
      version: 3,
      storage: createDesktopJsonStorage('projectTreeParams'),
      partialize: (state) => ({ params: state.params, promotedGlobals: state.promotedGlobals }),
      migrate: (persisted, version) => {
        const input = (persisted ?? {}) as Record<string, unknown>
        const rawParams = input.params
        const params = normalizeProjectNodeParamsMap(rawParams)
        // 已经迁过的（v2 起）不再重复提升，否则每次启动都会把历史值再刷一遍
        if (version >= 2) {
          return { params, promotedGlobals: (input.promotedGlobals ?? {}) as PromotedNodeFieldValues }
        }
        // v1 → v2：必须从**原始数据**里收集 —— 归一化已经把节点上的旧字段丢掉了，
        // 从归一化结果里收只会得到空对象（那样就白设这个版本号了）
        const promotedGlobals = hasLegacyNodeOnlyFields(rawParams) ? collectPromotedNodeFieldValues(rawParams) : {}
        return { params, promotedGlobals }
      },
    },
  ),
)
