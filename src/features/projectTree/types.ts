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
import type { ImageVideoNodeOverride } from '../imageVideo/types'

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
 * 后处理与图转视频各占一个字段 —— 包一层对象就是为了这个：接入新模块的参数时
 * 不必改存储结构（`overrides: Record<collectionId, ProjectNodeParams>` 的形状保持稳定）。
 * 两个模块**共用同一条继承链**（方向 → 产品 → 产品线 → 全局），但各自的字段互不影响。
 */
export interface ProjectNodeParams {
  postprocess?: PostprocessNodeOverride
  /** 图转视频参数覆盖；字段缺省 = 继承上层 */
  imageVideo?: ImageVideoNodeOverride
  updatedAt?: number
}

/** 参数覆盖表：键为 `AssetCollection.id`。 */
export type ProjectNodeParamsMap = Record<string, ProjectNodeParams>
