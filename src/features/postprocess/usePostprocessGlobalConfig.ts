/**
 * 组装后处理**全局基线**（`PostprocessMediaConfig`）。
 *
 * 基线在这个功能里有两个用途：作为继承链的根被逐级解析（`resolveProjectPostprocessSlice`），
 * 以及算产出计划。原先每个消费方各自从 store 里拼一份（弹窗一份、预览一份），
 * 少拼一个字段就出现「预览里少了某个渠道」这类难查的偏差，所以收口成这一个 hook。
 *
 * `mergePromotedGlobals`：把升级迁移时从节点上提升出来的旧值（R-63 / ADR-0011）补进基线。
 * **只补空缺** —— 基线已有值的字段以基线为准，迁移值不夺回控制权。
 */

import { useMemo } from 'react'
import type { PostprocessMediaConfig } from '../../lib/postprocessMedia'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { mergePromotedGlobals, useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'

export function usePostprocessGlobalConfig(): PostprocessMediaConfig {
  const media = usePostprocessMediaStore((state) => state.media)
  const selectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const selectedCollectionIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
  const savedTargetCollectionIds = usePostprocessMediaStore((state) => state.savedTargetCollectionIds)
  const direction = usePostprocessMediaStore((state) => state.direction)
  const fitMode = usePostprocessMediaStore((state) => state.fitMode)
  const outputDir = usePostprocessMediaStore((state) => state.outputDir)
  const mediaOutputDirs = usePostprocessMediaStore((state) => state.mediaOutputDirs)
  const namePattern = usePostprocessMediaStore((state) => state.namePattern)
  const creator = usePostprocessMediaStore((state) => state.creator)
  const watermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const autoCompanionClean = usePostprocessMediaStore((state) => state.autoCompanionClean)
  const distribution = usePostprocessMediaStore((state) => state.distribution)
  const promotedGlobals = useProjectTreeParamsStore((state) => state.promotedGlobals)

  return useMemo(
    () =>
      mergePromotedGlobals(
        {
          media,
          selectedMediaIds,
          selectedCollectionIds,
          savedTargetCollectionIds,
          direction,
          fitMode,
          outputDir,
          mediaOutputDirs,
          namePattern,
          creator,
          watermarkPresetIds,
          autoCompanionClean,
          distribution,
        },
        promotedGlobals,
      ),
    [
      media,
      selectedMediaIds,
      selectedCollectionIds,
      savedTargetCollectionIds,
      direction,
      fitMode,
      outputDir,
      mediaOutputDirs,
      namePattern,
      creator,
      watermarkPresetIds,
      autoCompanionClean,
      distribution,
      promotedGlobals,
    ],
  )
}
