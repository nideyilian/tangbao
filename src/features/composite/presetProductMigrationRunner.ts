/**
 * 「水印库按产品隔离」迁移的运行壳子。
 *
 * 计划（纯函数、可单测）在 `lib/compositePresetProductMigration.ts`，这里只负责
 * 读三个 store、把计划写回去、并落迁移标记 —— 也就是那一步「必须跨 store」的部分。
 *
 * 放在 feature 根目录而不是 `lib/`：它直接依赖三个 store（`assetLibrary` /
 * `projectTree` / `postprocessMedia`），不属于「纯工具」。挂在 `PresetManagementTab`
 * 挂载时调用，那时所有 store 模块都已加载，不存在模块循环。
 */

import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import {
  PRESET_PRODUCT_MIGRATION_VERSION,
  planLegacyWatermarkPushdown,
  planPresetProductClaim,
} from './lib/compositePresetProductMigration'
import { useCompositeV2Store } from './storeV2'

export interface PresetProductMigrationOutcome {
  /** 本次是否真的跑了（false = 之前已跑过） */
  ran: boolean
}

/**
 * 跑一次（幂等）：已跑过则直接返回。
 *
 * 全程用 `getState()` 现取最新的 store —— 摊清单会改 `params`，而第二步推断读的正是
 * 摊完之后的 `params`，用一开始那份快照会让刚摊下去的清单被漏掉。
 */
export function runPresetProductMigration(): PresetProductMigrationOutcome {
  if ((useCompositeV2Store.getState().presetProductMigrationVersion ?? 0) >= PRESET_PRODUCT_MIGRATION_VERSION) {
    return { ran: false }
  }

  const collections = useAssetLibraryStore.getState().collections
  const tree = () => useProjectTreeParamsStore.getState()

  // 第一步：把 v6 的「全局基线」与「产品线级清单」摊到每个产品上。
  // 必须在推断之前 —— 推断读的就是这些清单，顺序反了会让「只在全局清单里出现过」的水印
  // 保持未分配，而产出链路按 id 照样找得到它（界面上却哪儿都没有）。
  const pushdown = planLegacyWatermarkPushdown({
    collections,
    params: tree().params,
    globalPresetIds: usePostprocessMediaStore.getState().watermarkPresetIds,
  })
  for (const update of pushdown.paramUpdates) {
    tree().setPostprocessOverride(update.collectionId, { watermarkPresetIds: update.presetIds })
  }
  for (const lineId of pushdown.lineCleanupIds) {
    // 写 `undefined` = 撤掉这一格（值已经摊给下辖产品了），节点上其它字段原样保留
    tree().setPostprocessOverride(lineId, { watermarkPresetIds: undefined })
  }
  if (pushdown.clearGlobalPresetIds) {
    // 全局基线在 v7 之后没有任何写入点，留着只会让人以为「改它还能影响所有产品」
    usePostprocessMediaStore.setState({ watermarkPresetIds: [] })
  }

  // 第二步：按（摊完之后的）显式清单推断每套水印归哪个产品，跨产品共用的复制副本。
  const claim = planPresetProductClaim({
    presets: useCompositeV2Store.getState().presets,
    collections,
    params: tree().params,
  })
  for (const update of claim.paramUpdates) {
    tree().setPostprocessOverride(
      update.collectionId,
      update.mediaId
        ? { byMedia: { [update.mediaId]: { watermarkPresetIds: update.presetIds } } }
        : { watermarkPresetIds: update.presetIds },
    )
  }
  // 直接 setState 而不是走 action：迁移不是用户操作，不该占撤销栈的一格
  // （否则用户升级后第一次按 Ctrl+Z 会撤到「迁移前」，水印归属整体回退，且没有任何提示）。
  // 标记与数据**同一次写入**：中途抛错时标记没落，下次启动会重跑 —— 比「跑了一半却记成已完成」安全。
  useCompositeV2Store.setState({
    presets: claim.presets,
    presetProductMigrationVersion: PRESET_PRODUCT_MIGRATION_VERSION,
  })
  return { ran: true }
}
