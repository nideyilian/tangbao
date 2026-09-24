/**
 * 素材库当前范围（`AssetLibraryScope`）→ 界面文案。
 *
 * 收口成共享实现的原因：这段文字现在有两个消费者 —— 工具栏顶部的范围标签，
 * 与「产出目标」弹窗里「这份配置归到哪儿 / 不指向具体文件夹时算什么」的提示。
 * 各写一遍的话，同一个范围在两个地方会叫法不同（一处「全部素材」、一处「全部」），
 * 而用户要拿它去判断「我刚设的这份落在谁头上」。
 *
 * 注意这里**不**给 collection 情形拼全路径：工具栏的宽度只放得下一个名字，
 * 需要区分同名文件夹的地方（产出目标弹窗）自己按 `resolveCollectionPath` 拼路径。
 */

import type { AssetLibraryScope } from '../../types'

export function formatAssetLibraryScopeLabel(
  scope: AssetLibraryScope,
  collectionNames: ReadonlyMap<string, string>,
  tagNames: ReadonlyMap<string, string>,
): string {
  if (typeof scope === 'object') {
    if (scope.kind === 'collection') return `项目 · ${collectionNames.get(scope.id) ?? '未命名'}`
    return `标签 · ${tagNames.get(scope.id) ?? '未命名'}`
  }
  switch (scope) {
    case 'all':
      return '全部素材'
    case 'recent':
      return '最近生成'
    case 'favorites':
      return '收藏'
    case 'unorganized':
      return '未整理'
    default:
      return '素材库'
  }
}
