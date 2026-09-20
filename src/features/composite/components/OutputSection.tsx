/**
 * 中控台 · 「输出位置」分区。
 *
 * 复刻资产中心里「输出位置」那个独立 tab 的形态。糖包的输出位置是**两层**的
 * （全局渠道表 `mediaOutputDirs` + 节点覆盖 `byMedia`），资产中心只有一个层级。
 *
 * 两层**合在一个界面里**：作用域由工作区左侧的配置资产库树驱动（TB-053 第四轮，
 * 原内嵌下拉已退役），选「全局默认」改的是全局渠道表，选某个节点改的是那个节点的覆盖。
 * 依据是杰哥对中控台的定位——**它是所有参数的唯一编辑入口**，
 * 不该出现「中控台只能改全局、改节点得去别处」的断层。
 *
 * 保留的约束：节点覆盖仍写 `PostprocessNodeOverride.byMedia`（ADR-0011 收窄后的字段），
 * 并且同时摘掉旧的单值 `outputDir`，避免两个字段并存时「显示的」与「生效的」不一致。
 */

import { useMemo } from 'react'
import { Alert, Badge, SectionHeader } from '../../../design-system'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import ChannelOutputDirs from '../../postprocess/ChannelOutputDirs'
import { useStore } from '../../../store'
import { normalizeOutputDirList, type PostprocessNodeOverride } from '../../../lib/postprocessMedia'
import { resolveCollectionPath } from '../../../lib/postprocessProjectTree'
import { isGlobalScope, type ConsoleScope } from '../lib/controlConsoleSections'

interface Props {
  scope: ConsoleScope
}

export function OutputSection({ scope }: Props) {
  const media = usePostprocessMediaStore((state) => state.media)
  const outputDir = usePostprocessMediaStore((state) => state.outputDir)
  const mediaOutputDirs = usePostprocessMediaStore((state) => state.mediaOutputDirs)
  const setMediaOutputDir = usePostprocessMediaStore((state) => state.setMediaOutputDir)
  const clearMediaOutputDirs = usePostprocessMediaStore((state) => state.clearMediaOutputDirs)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const collections = useAssetLibraryStore((state) => state.collections)
  const showToast = useStore((state) => state.showToast)

  const isGlobal = isGlobalScope(scope)
  const override = isGlobal ? undefined : params[scope]?.postprocess
  const scopeNode = useMemo(
    () => (isGlobal ? undefined : collections.find((item) => item.id === scope)),
    [collections, isGlobal, scope],
  )

  /**
   * 有节点级输出覆盖的方向数。只在**全局作用域**下提示——切到节点作用域时
   * 用户正在编辑覆盖本身，再警告「有覆盖」就成了自指噪音。
   *
   * 只统计真的写了 `outputDir` 或 `byMedia[*].outputDirs` 的节点：只有一个 `enabled`
   * 的节点不算，否则这个数会把「所有开过后处理面板的方向」都算进来。
   */
  const overriddenCount = useMemo(() => {
    if (!isGlobal) return { count: 0, names: [] as string[] }
    // 名称 → id 的映射，仅用于把提示说得具体（用户认的是方向名，不是 id）
    const nameOf = new Map(collections.map((item) => [item.id, item.name]))
    let count = 0
    const names: string[] = []
    for (const [collectionId, entry] of Object.entries(params)) {
      if (collectionId === scope) continue
      const item = entry?.postprocess
      if (!item) continue
      const hasDir = typeof item.outputDir === 'string' && item.outputDir.trim().length > 0
      // byMedia 有两种写法：新的 `outputDirs` 数组与兼容用的旧单值 `outputDir`，两种都要算
      const hasByMedia =
        item.byMedia !== undefined &&
        Object.values(item.byMedia).some((value) => {
          if (!value) return false
          if (value.outputDirs !== undefined && value.outputDirs.length > 0) return true
          return typeof value.outputDir === 'string' && value.outputDir.trim().length > 0
        })
      if (!hasDir && !hasByMedia) continue
      count += 1
      if (names.length < 5) names.push(nameOf.get(collectionId) ?? collectionId)
    }
    return { count, names }
  }, [collections, params, isGlobal, scope])

  /** 节点作用域下某渠道本级已配的目录；兼容旧的单值 `outputDir` */
  const resolveDirs = (mediaId: string): string[] => {
    if (isGlobal) return mediaOutputDirs[mediaId] ?? []
    const entry = override?.byMedia?.[mediaId]
    return normalizeOutputDirList(entry?.outputDirs ?? (entry?.outputDir ? [entry.outputDir] : []))
  }

  const apply = (patch: PostprocessNodeOverride) => {
    if (isGlobal) return
    setPostprocessOverride(scope, patch)
  }

  const handleChangeDir = (mediaId: string, index: number, value: string) => {
    if (isGlobal) {
      setMediaOutputDir(mediaId, index, value)
      return
    }
    const slots = [...resolveDirs(mediaId)]
    while (slots.length <= index) slots.push('')
    slots[index] = value
    const next = normalizeOutputDirList(slots)
    // 同时写 `outputDirs` 并摘掉旧的单值 `outputDir`：两个字段并存时以 `outputDirs` 为准，
    // 留着旧值只会让「界面上显示的」和「实际生效的」不一致。
    apply({ byMedia: { [mediaId]: { outputDirs: next.length > 0 ? next : undefined, outputDir: undefined } } })
  }

  const handleClearDirs = (mediaId: string) => {
    if (isGlobal) {
      clearMediaOutputDirs(mediaId)
      return
    }
    apply({ byMedia: { [mediaId]: { outputDirs: undefined, outputDir: undefined } } })
  }

  /**
   * 本渠道留空后会落到哪。
   * - 全局作用域：全局层没有上级，落到默认输出位置；
   * - 节点作用域：拿**父节点**那条链单独解析一次，作为占位提示——
   *   这样用户能看见「清掉本级覆盖会退回哪里」，而不是清完才发现变了。
   */
  const inheritedHint = useMemo(() => {
    if (isGlobal) return undefined
    const path = resolveCollectionPath(collections, scope)
    const parentId = path.length >= 2 ? path[path.length - 2].id : null
    const parentOverride = parentId ? params[parentId]?.postprocess : undefined
    const parentByMedia = parentOverride?.byMedia
    return (mediaId: string): string => {
      const entry = parentByMedia?.[mediaId]
      const dirs = normalizeOutputDirList(entry?.outputDirs ?? (entry?.outputDir ? [entry.outputDir] : []))
      return dirs[0] ?? outputDir.trim() ?? '默认输出位置'
    }
  }, [isGlobal, collections, scope, params, outputDir])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <SectionHeader
          title="输出位置"
          description="按渠道指定导出目录，一个渠道可以给两个位置（同一份产物各存一份）。留空 = 用默认输出位置。"
        />
      </div>

      <div className="shrink-0 space-y-3 px-4 pt-3">
        {!isGlobal && (
          <p className="text-xs text-ds-muted dark:text-ds-muted">
            正在编辑「{scopeNode?.name ?? '已删除节点'}」的覆盖值；留空的项继续按树向上继承。
            换作用域请用左侧的配置资产库树。
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {isGlobal && overriddenCount.count > 0 && (
          <Alert tone="warning" className="mb-3">
            有 <strong>{overriddenCount.count}</strong> 个方向配了节点级覆盖
            {overriddenCount.names.length > 0 && `（如 ${overriddenCount.names.join('、')}）`}
            ，它们<strong>不受下面这套全局配置影响</strong>。在左侧树点那个节点即可直接改。
          </Alert>
        )}

        {isGlobal && (
          <div className="mb-3 flex items-center gap-2 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 dark:border-ds-border dark:bg-ds-surface-subtle">
            <span className="text-xs text-ds-muted dark:text-ds-muted">默认输出位置</span>
            <span className="truncate font-mono text-xs text-ds-text dark:text-ds-text">
              {outputDir.trim() || '本地保存目录下的 postprocess'}
            </span>
            <Badge tone="neutral" className="ml-auto shrink-0">
              渠道未配时落到这里
            </Badge>
          </div>
        )}

        <ChannelOutputDirs
          media={media}
          resolveDirs={resolveDirs}
          resolveInheritedHint={inheritedHint ?? (() => outputDir.trim() || '本地保存目录下的 postprocess')}
          onChangeDir={handleChangeDir}
          onClearDirs={handleClearDirs}
          onPickError={() => showToast('选择目录失败，请重试', 'error')}
          clearLabel={isGlobal ? '用默认' : '恢复继承'}
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
