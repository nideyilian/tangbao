/**
 * 统一项目树：类型定义。
 *
 * 结构（产品线 → 产品 → 方向）与名称的**唯一主源是 `AssetCollection`**（collections 表），
 * 本模块不再造第二棵树，只补一层「节点参数」：
 *
 * - 结构/名称：走 `useAssetLibraryStore` 的 collections CRUD → 左侧栏天然同步，
 *   SOP 分组经既有镜像链路（`src/lib/sopGroupMirror.ts`）自动跟上；
 * - 参数：按 `collectionId` 存覆盖切片，逐级继承（方向 → 产品 → 产品线 → 全局默认），
 *   后处理执行时按图片归属自动取用，无需手动勾选。
 *
 * 参数落在**独立 store** 而不是给 collections 表加列：collections 是目录元数据（要动
 * SQLite schema + 迁移），而参数是应用配置，两者生命周期与备份诉求不同。
 */

import type { PostprocessNodeOverride } from '../../lib/postprocessMedia'

/** 树节点的层级语义。第 4 层及以后是用户自建的深层节点，按「扩展」处理。 */
export type ProjectNodeKind = 'line' | 'product' | 'direction' | 'extra'

/** 单层语义对应的中文名，用于表格徽章与提示文案。 */
export const PROJECT_NODE_KIND_LABELS: Record<ProjectNodeKind, string> = {
  line: '产品线',
  product: '产品',
  direction: '方向',
  extra: '扩展层',
}

/**
 * 一个树节点的参数配置。
 *
 * 当前只有后处理一项；包一层对象是为了后续接入别的模块参数时不必改存储结构
 * （`overrides: Record<collectionId, ProjectNodeParams>` 的形状保持稳定）。
 */
export interface ProjectNodeParams {
  postprocess?: PostprocessNodeOverride
  updatedAt?: number
}

/** 参数覆盖表：键为 `AssetCollection.id`。 */
export type ProjectNodeParamsMap = Record<string, ProjectNodeParams>

/** 解析后的生效参数，供表格展示与后处理执行读取。 */
export interface ResolvedProjectParams {
  /** 归属节点 id；null 表示图片没有归属（用全局默认） */
  collectionId: string | null
  /** 结构路径名，供 `{line}` / `{product}` / `{direction}` token */
  path: { line: string; product: string; direction: string }
  /** 该方向是否参与自动后处理 */
  enabled: boolean
  /** 真正提供了参数的节点 id；null = 全部来自全局默认 */
  sourcedFrom: string | null
  /** 提供参数的节点在各层级里的深度（0 产品线 / 1 产品 / 2 方向）；sourcedFrom 为 null 时是 -1 */
  sourcedDepth: number
}
