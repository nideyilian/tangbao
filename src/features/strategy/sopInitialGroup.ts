/**
 * SOP 管理中心的**初始分组**解析。
 *
 * 背景（杰哥 2026-09-20）：全局统一树结构之后，「现在看哪个方向」只有一个指针
 * （`useAssetLibraryStore.scope`），任何工作区打开时都该**默认停在当前方向**。
 * SOP 侧的实现基础早就有了 —— `SopGroup.collectionId` 把分组挂到项目文件夹上
 * （见 `types.ts` 里那句「项目文件夹树是唯一主源，SOP 分组树是它的投影」），
 * 所以这里只差「把指针翻译成分组 id」这一步。
 *
 * 抽成纯函数是为了可测：这是「取个初值」，出错的表现是「打开 SOP 停在别的分组」，
 * 不会报错、只会让人困惑 —— 这类逻辑必须有测试兜着。
 *
 * 分辨率策略：**由深到浅**。项目树是「产品线 → 产品 → 方向」多层，而镜像到 SOP 的
 * 分组未必每一层都建了（可能只建到产品级）。所以从方向自己开始往上找，
 * 第一个命中的分组就是它 —— 这比「找不到就回全部」更符合预期：
 * 用户在方向级，落到它的产品分组里，仍然看到相关内容。
 */

import type { AssetCollection, AssetLibraryScope } from '../../types'
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import type { SopGroup } from './types'

/** 没有指向具体分组时的兜底值：SOP 中心里的「全部」 */
export const SOP_ALL_GROUPS_ID = 'all'

interface Input {
  groups: Pick<SopGroup, 'id' | 'collectionId'>[]
  collections: AssetCollection[]
  scope: AssetLibraryScope
}

/**
 * 把全局上下文指针（当前方向）翻译成 SOP 分组 id；翻译不出来时返回 `'all'`（全部）。
 *
 * - `scope` 不是具体文件夹（`'all'` / `'favorites'` / `{kind:'tag'}` 等）⇒ `'all'`：
 *   那些都不是「某个方向」，拿它们去定位分组只会定位到错的地方；
 * - 同一文件夹有多个分组时取 `groups` 里**第一个**（顺序稳定，避免每次打开跳来跳去）；
 * - 沿父链向上找，但**只在项目树自己的链上找**（不猜、不模糊匹配名字）。
 */
export function resolveInitialSopGroupId({ groups, collections, scope }: Input): string {
  const collectionId = typeof scope === 'object' && scope !== null && scope.kind === 'collection' ? scope.id : ''
  if (!collectionId) return SOP_ALL_GROUPS_ID

  // 先出现者优先：同一文件夹重复镜像时结果稳定
  const groupIdByCollection = new Map<string, string>()
  for (const group of groups) {
    if (!group.collectionId) continue
    if (!groupIdByCollection.has(group.collectionId)) groupIdByCollection.set(group.collectionId, group.id)
  }
  if (groupIdByCollection.size === 0) return SOP_ALL_GROUPS_ID

  // 由深到浅：方向 → 产品 → 产品线
  const path = resolveCollectionPath(collections, collectionId)
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const hit = groupIdByCollection.get(path[index]!.id)
    if (hit) return hit
  }
  return SOP_ALL_GROUPS_ID
}
