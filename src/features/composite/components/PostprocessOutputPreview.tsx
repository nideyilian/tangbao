/**
 * 后处理**产出预览**：按当前作用域展开「会产出哪些文件」（只读核对）。
 *
 * 中控台「输出位置」分区的「产出预览」块。原先它挂在后处理弹窗的「全局默认」作用域下，
 * 2026-09-20 弹窗收窄为方向级后搬到中控台 —— 中控台的作用域由左栏配置资产库树驱动，
 * 所以「这个方向会产出什么」在这里能直接看，不需要再回弹窗。
 *
 * 两个刻意的口径：
 * 1. **按作用域取值**：节点作用域用该节点继承后的配置展开（水印归属按渠道解析），
 *    全局作用域用全局基线 + 已启用的产出范围展开；
 * 2. **源图尺寸是估算的**：中控台不绑定任何一次生成，所以用一个示例尺寸（1280×720）。
 *    `direction` 为「跟随尺寸」时实际比例由图片自身决定，界面上明写这一点，
 *    不然用户会拿推算结果去对账。
 */

import { useMemo } from 'react'
import { Alert, Badge, SectionHeader } from '../../../design-system'
import { CheckIcon } from '../../../design-system/icons'
import { isGlobalScope, type ConsoleScope } from '../lib/controlConsoleSections'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { resolveNodeWatermarkBinding, resolveProjectPostprocessSlice } from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { useCompositeV2Store } from '../storeV2'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { usePostprocessGlobalConfig } from '../../postprocess/usePostprocessGlobalConfig'
import { buildSourceVariantPlans } from '../../../lib/postprocessRunner'
import { resolvePostprocessProjectTargets } from '../../../lib/postprocessProjectTree'
import { selectPostprocessOutputPlan } from '../../../storePostprocessMedia'

/** 示例源图尺寸（横版）：中控台不对应任何一次生成，只能给一个有代表性的比例。 */
const SAMPLE_SOURCE = { width: 1280, height: 720 }

/** 预览只列前几条：这一块是核对配置，不是逐条点货的清单。 */
const VISIBLE_UNITS = 6

interface Props {
  /** 作用域：`GLOBAL_NODE_ID` = 全局默认，其余为项目树节点 id */
  scope: ConsoleScope
}

export function PostprocessOutputPreview({ scope }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const selectedCollectionIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
  const watermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const presets = useCompositeV2Store((state) => state.presets)
  const globalConfig = usePostprocessGlobalConfig()

  const isGlobal = isGlobalScope(scope)
  const config = useMemo(
    () => resolveProjectPostprocessSlice(collections, params, isGlobal ? null : scope, globalConfig).config,
    [collections, params, isGlobal, scope, globalConfig],
  )

  /** 产出目标：全局层用「已启用的范围」，节点层就是它自己 */
  const targets = useMemo(() => {
    const ids = isGlobal ? selectedCollectionIds : [scope]
    return resolvePostprocessProjectTargets(collections, ids).map((target) => ({
      ...target,
      watermarkPresetIds: resolveNodeWatermarkBinding(collections, params, target.collectionId, watermarkPresetIds)
        .presetIds,
    }))
  }, [collections, params, isGlobal, scope, selectedCollectionIds, watermarkPresetIds])

  // 水印预设名进文件名（`{preset}` 占位符）：查不到就退回 id，宁可看见 id 也不出现空段
  const presetNames = useMemo(() => Object.fromEntries(presets.map((preset) => [preset.id, preset.name])), [presets])

  const plan = useMemo(
    () => selectPostprocessOutputPlan(config, SAMPLE_SOURCE, targets, presetNames),
    [config, targets, presetNames],
  )

  /**
   * 文件名在**产出链路自己的编排**里算（`buildSourceVariantPlans`），不在这里数下标。
   *
   * 序号是按产出文件夹分别计数的（见 `postprocessRunner` 头注）—— 拿 `units` 的下标当序号，
   * 预览会显示成另一套号，而这块的用途恰恰是「跑之前核对会产出什么」。
   */
  const namedPlans = useMemo(
    () =>
      buildSourceVariantPlans({
        source: { imageId: 'preview', index: 0, ...SAMPLE_SOURCE },
        units: plan.units,
        config,
        startSequences: {},
      }).plans,
    [plan, config],
  )

  const visible = namedPlans.slice(0, VISIBLE_UNITS)

  return (
    <div className="space-y-2">
      <SectionHeader
        title="产出预览"
        description={`按 ${SAMPLE_SOURCE.width}×${SAMPLE_SOURCE.height} 源图估算。「跟随尺寸」时实际比例由图片自身决定。`}
      />
      {plan.skippedMediaIds.length > 0 && (
        <Alert tone="warning">有 {plan.skippedMediaIds.length} 个已勾选的渠道在媒体表里找不到，已跳过。</Alert>
      )}
      {isGlobal && targets.length === 0 && (
        <p className="text-xs text-ds-muted">还没有启用任何方向。在项目树的「后处理」列勾选后会在这里展开。</p>
      )}
      {plan.units.length === 0 ? (
        <p className="text-xs text-ds-muted">当前配置产不出文件，请检查渠道勾选、尺寸与画面方向。</p>
      ) : (
        <ul className="space-y-1">
          {visible.map(({ unit, fileName }, index) => (
            <li
              key={`${unit.project?.collectionId ?? 'none'}-${unit.sizeId}-${index}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-1.5 text-xs"
            >
              <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
              <span className="shrink-0 text-ds-muted">
                {[unit.project?.line, unit.project?.product, unit.project?.direction].filter(Boolean).join(' / ') ||
                  '未归属'}
              </span>
              <Badge tone="neutral">{unit.mediaName}</Badge>
              <span className="shrink-0 text-ds-muted">
                {unit.width}×{unit.height}
              </span>
              <span className="ml-auto min-w-0 truncate text-ds-text" title={fileName}>
                {fileName}
              </span>
            </li>
          ))}
          {namedPlans.length > visible.length && (
            <li className="px-3 text-xs text-ds-muted">还有 {namedPlans.length - visible.length} 个文件未列出。</li>
          )}
        </ul>
      )}
    </div>
  )
}

export default PostprocessOutputPreview
