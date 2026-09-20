/**
 * 中控台 · 「输出位置」分区。
 *
 * 复刻资产中心里「输出位置」那个独立 tab 的形态，但**只呈现全局基线**：
 * 糖包的输出位置是**两层**的（全局渠道表 `mediaOutputDirs` + 节点覆盖 `byMedia`），
 * 而资产中心只有一个层级。照搬会造成「在这里改了全局、结果某个方向因为有节点覆盖
 * 完全没变」——这正是 `PostprocessParamPanel` 那条铁律要防的事。
 *
 * 因此本分区的口径是：
 * - **能改的**：全局渠道表（对所有「没有节点覆盖」的方向生效）；
 * - **显式警告**：哪些方向有节点级覆盖（有覆盖的不会被这里影响），并点名；
 * - 改节点覆盖**不在这里做** —— 那是项目树的事，中控台只负责把冲突说清楚，
 *   不在同一个参数上造第二个编辑器。
 */

import { useMemo } from 'react'
import { Alert, Badge, SectionHeader } from '../../../design-system'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import ChannelOutputDirs from '../../postprocess/ChannelOutputDirs'
import { useStore } from '../../../store'

export function OutputSection() {
  const media = usePostprocessMediaStore((state) => state.media)
  const outputDir = usePostprocessMediaStore((state) => state.outputDir)
  const mediaOutputDirs = usePostprocessMediaStore((state) => state.mediaOutputDirs)
  const setMediaOutputDir = usePostprocessMediaStore((state) => state.setMediaOutputDir)
  const clearMediaOutputDirs = usePostprocessMediaStore((state) => state.clearMediaOutputDirs)
  const params = useProjectTreeParamsStore((state) => state.params)
  const collections = useAssetLibraryStore((state) => state.collections)
  const showToast = useStore((state) => state.showToast)

  /**
   * 有节点级输出覆盖的方向数。只统计**真的写了** `outputDir` 或 `byMedia[*].outputDirs` 的节点——
   * 只有一个 `enabled` 的节点不算，否则这个数会把「所有开过后处理面板的方向」都算进来。
   */
  const overriddenCount = useMemo(() => {
    // 名称 → id 的映射，仅用于把提示说得具体（用户认的是方向名，不是 id）
    const nameOf = new Map(collections.map((item) => [item.id, item.name]))
    let count = 0
    const names: string[] = []
    for (const [collectionId, entry] of Object.entries(params)) {
      const override = entry?.postprocess
      if (!override) continue
      const hasDir = typeof override.outputDir === 'string' && override.outputDir.trim().length > 0
      // byMedia 有两种写法：新的 `outputDirs` 数组与兼容用的旧单值 `outputDir`，两种都要算
      const hasByMedia =
        override.byMedia !== undefined &&
        Object.values(override.byMedia).some((item) => {
          if (!item) return false
          if (item.outputDirs !== undefined && item.outputDirs.length > 0) return true
          return typeof item.outputDir === 'string' && item.outputDir.trim().length > 0
        })
      if (!hasDir && !hasByMedia) continue
      count += 1
      if (names.length < 5) names.push(nameOf.get(collectionId) ?? collectionId)
    }
    return { count, names }
  }, [collections, params])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <SectionHeader
          title="输出位置"
          description="按渠道指定导出目录，一个渠道可以给两个位置（同一份产物各存一份）。留空 = 用默认输出位置。"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {overriddenCount.count > 0 && (
          <Alert tone="warning" className="mb-3">
            有 <strong>{overriddenCount.count}</strong> 个方向配了节点级覆盖
            {overriddenCount.names.length > 0 && `（如 ${overriddenCount.names.join('、')}）`}
            ，它们<strong>不受下面这套全局配置影响</strong>。要改这些方向，请到项目树的节点参数里改。
          </Alert>
        )}

        <div className="mb-3 flex items-center gap-2 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 dark:border-ds-border dark:bg-ds-surface-subtle">
          <span className="text-xs text-ds-muted dark:text-ds-muted">默认输出位置</span>
          <span className="truncate font-mono text-xs text-ds-text dark:text-ds-text">
            {outputDir.trim() || '本地保存目录下的 postprocess'}
          </span>
          <Badge tone="neutral" className="ml-auto shrink-0">
            渠道未配时落到这里
          </Badge>
        </div>

        <ChannelOutputDirs
          media={media}
          resolveDirs={(mediaId) => mediaOutputDirs[mediaId] ?? []}
          // 全局层没有上级可继承，留空就是「用默认位置」，所以提示直接指向默认输出位置
          resolveInheritedHint={() => outputDir.trim() || '本地保存目录下的 postprocess'}
          onChangeDir={(mediaId, index, value) => setMediaOutputDir(mediaId, index, value)}
          onClearDirs={(mediaId) => clearMediaOutputDirs(mediaId)}
          onPickError={() => showToast('选择目录失败，请重试', 'error')}
          clearLabel="用默认"
          description={
            <span>
              留空 = 用默认输出位置。给第二个位置即<strong>双写</strong>
              （同一份产物在两个位置各存一份）。
            </span>
          }
        />
      </div>
    </div>
  )
}
