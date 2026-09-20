import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../design-system'
import { PlusIcon } from '../../design-system/icons'
import {
  CONTROL_CONSOLE_SECTIONS,
  DEFAULT_CONTROL_CONSOLE_SECTION,
  isGlobalScope,
  normalizeControlConsoleSection,
  type ControlConsoleSectionId,
  type ConsoleScope,
} from './lib/controlConsoleSections'
import { ConsoleAssetTree } from './components/ConsoleAssetTree'
import { ConsolePresetGrid } from './components/ConsolePresetGrid'
import { ConsoleToolbar, type ConsoleBindingFilter, type ConsoleViewMode } from './components/ConsoleToolbar'
import { DistributionSection } from './components/DistributionSection'
import { MediaSection } from './components/MediaSection'
import { OutputSection } from './components/OutputSection'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { resolveNodeWatermarkBinding } from '../projectTree/params'
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useStore } from '../../store'
import { GLOBAL_NODE_ID } from '../postprocess/paramSchema'
import { useCompositeV2Store } from './storeV2'

/**
 * 中控台（顶栏 tab，原「水印预设」工作区）。
 *
 * 形态完全对齐「灵境 · 策略中心」（strategy/center，2026-09-20 登录实测）：
 * **左树 + 右内容**。左栏「配置资产库」= 搜索 + 全局默认总览项 + 项目树
 * （节点带覆盖计数徽章）；右区 = 作用域标题 + 操作按钮 + 两行工具栏（筛选 / 批量）+ 内容。
 *
 * **业务模型：方向自带一整套参数，生成图时直接调用**（杰哥 2026-09-20 明确）。
 * 所以左树是参数的组织骨架，不是可选的筛选器：
 * - 选中某个方向 ⇒ 右区就是**该方向的参数**——水印卡片网格上直接开停用，
 *   其余维度（渠道与尺寸 / 输出位置 / 分发）同理由分区面板就地编辑；
 * - 选中「全局默认」⇒ 右区是全局基线与总览（水印在此是只读总览：
 *   全局清单在前端没有写入点，各方向自己声明才是权威）。
 *
 * ⚠️ 准入约束：**有节点级字段的参数才消费作用域**。
 * `PostprocessNodeOverride`（ADR-0011 收窄后）只有 `outputDir` / `byMedia` /
 * `watermarkPresetIds` / `enabled`；`distribution` / `autoCompanionClean` /
 * `selectedMediaIds` 不在其中，所以「渠道与尺寸」「分发」是纯全局分区。
 *
 * 顶栏 `SegmentedControl` 的一个 tab，与素材库 / Agent 同级。
 */
export default function CompositeWorkspace() {
  const canUndo = useCompositeV2Store((state) => state.canUndo)
  const undo = useCompositeV2Store((state) => state.undo)
  const presets = useCompositeV2Store((state) => state.presets)
  const createPreset = useCompositeV2Store((state) => state.createPreset)
  const deletePreset = useCompositeV2Store((state) => state.deletePreset)
  const duplicatePreset = useCompositeV2Store((state) => state.duplicatePreset)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)

  const collections = useAssetLibraryStore((state) => state.collections)
  const createCollection = useAssetLibraryStore((state) => state.createCollection)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)

  const showToast = useStore((state) => state.showToast)
  const { openConfirmDialog } = useAppDialog()

  const [section, setSection] = useState<ControlConsoleSectionId>(DEFAULT_CONTROL_CONSOLE_SECTION)
  const [scope, setScope] = useState<ConsoleScope>(GLOBAL_NODE_ID)
  /** 水印分区有两个视图：卡片网格（管理）/ 编辑器（画布 + 库）。其余分区只有一种。 */
  const [watermarkView, setWatermarkView] = useState<'cards' | 'editor'>('cards')
  const [bindingFilter, setBindingFilter] = useState<ConsoleBindingFilter>('all')
  const [query, setQuery] = useState('')
  const [perRow, setPerRow] = useState(4)
  const [view, setView] = useState<ConsoleViewMode>('grid')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'z' || !canUndo) return
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUndo, undo])

  // 作用域换节点时清掉选择：跨方向的批量操作没有意义，留着只会误导
  useEffect(() => {
    setSelectedIds([])
  }, [scope])

  const active = CONTROL_CONSOLE_SECTIONS.find((item) => item.id === section) ?? CONTROL_CONSOLE_SECTIONS[0]!
  const isGlobal = isGlobalScope(scope)

  const scopeTitle = useMemo(() => {
    if (isGlobal) return '全局默认'
    return collections.find((item) => item.id === scope)?.name ?? '全局默认'
  }, [collections, scope, isGlobal])

  const scopePath = useMemo(() => {
    if (isGlobal) return '对所有未单独设置的节点生效'
    return resolveCollectionPath(collections, scope)
      .map((item) => item.name)
      .join(' / ')
  }, [collections, scope, isGlobal])

  /**
   * 各预设被多少个方向**显式声明**在用。
   *
   * 只数显式声明（节点自己写了 `watermarkPresetIds` 或 `byMedia[*]`），
   * 不数继承来的值——否则「全局清单」会让每个预设都显示「N 个方向在用」，
   * 这个数字就失去意义了。它要回答的是「谁特意挑过这一套」。
   */
  const explicitUsage = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const [collectionId, entry] of Object.entries(params)) {
      const override = entry?.postprocess
      if (!override) continue
      const declared = new Set<string>(override.watermarkPresetIds ?? [])
      for (const perMedia of Object.values(override.byMedia ?? {})) {
        for (const id of perMedia?.watermarkPresetIds ?? []) declared.add(id)
      }
      for (const id of declared) {
        const set = map.get(id) ?? new Set<string>()
        set.add(collectionId)
        map.set(id, set)
      }
    }
    return map
  }, [params])

  /** 当前作用域（某个方向）生效的水印清单；全局作用域下就是全局基线 */
  const effectivePresetIds = useMemo(() => {
    if (isGlobal) return globalWatermarkPresetIds
    return resolveNodeWatermarkBinding(collections, params, scope, globalWatermarkPresetIds).presetIds
  }, [isGlobal, collections, params, scope, globalWatermarkPresetIds])

  const usedByCount = (presetId: string) => explicitUsage.get(presetId)?.size ?? 0

  /** 方向作用域下就地改该方向的水印清单（首次改动即物化：把生效清单写成显式数组再改） */
  const writeNodePresetIds = (nextIds: string[]) => {
    if (isGlobal) return
    setPostprocessOverride(scope, { watermarkPresetIds: nextIds })
  }

  const toggleEnabled = (presetId: string) => {
    if (isGlobal) return
    const next = effectivePresetIds.includes(presetId)
      ? effectivePresetIds.filter((id) => id !== presetId)
      : [...effectivePresetIds, presetId]
    writeNodePresetIds(next)
  }

  const visiblePresets = useMemo(() => {
    const q = query.trim()
    return presets.filter((preset) => {
      if (q && !preset.name.includes(q)) return false
      if (bindingFilter === 'bound' && (explicitUsage.get(preset.id)?.size ?? 0) === 0) return false
      if (bindingFilter === 'unbound' && (explicitUsage.get(preset.id)?.size ?? 0) > 0) return false
      return true
    })
  }, [presets, query, bindingFilter, explicitUsage])

  const toggleSelect = (presetId: string) => {
    setSelectedIds((current) =>
      current.includes(presetId) ? current.filter((id) => id !== presetId) : [...current, presetId],
    )
  }

  const openInEditor = (presetId: string) => {
    setSelectedPreviewPresetId(presetId)
    setWatermarkView('editor')
  }

  const confirmDelete = (ids: string[]) => {
    if (ids.length === 0) return
    openConfirmDialog({
      title: ids.length === 1 ? '删除这个预设？' : `删除选中的 ${ids.length} 个预设？`,
      message: '删除后无法恢复。若已有方向在用它，那些方向的产出会少这一层水印。',
      confirmText: '删除',
      tone: 'danger',
      action: () => {
        for (const id of ids) deletePreset(id)
        setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
        showToast(`已删除 ${ids.length} 个预设`, 'success')
      },
    })
  }

  const duplicateMany = (ids: string[]) => {
    for (const id of ids) duplicatePreset(id)
    setSelectedIds([])
    showToast(`已复制 ${ids.length} 个预设`, 'success')
  }

  const isCardView = section === 'watermark' && watermarkView === 'cards'

  return (
    // 高度对齐另外两个工作区：顶栏在自己的 return 里放了一块等高的 `invisible` 占位，
    // 所以这里按「视口 - 顶栏高度」算即可。窄屏顶栏多一行工作区切换，与素材库同口径取 7rem。
    <main
      aria-label="中控台工作区"
      className="flex h-[calc(100dvh-7rem)] min-h-0 overflow-hidden bg-ds-surface text-ds-text sm:h-[calc(100dvh-var(--app-header-offset))] dark:bg-ds-scrim dark:text-ds-text-subtle"
    >
      <ConsoleAssetTree value={scope} onValueChange={setScope} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-ds-text dark:text-ds-text">{scopeTitle}</h1>
            <p className="truncate text-xs text-ds-muted dark:text-ds-muted">
              {scopePath} · {active.description}
            </p>
          </div>
          {isCardView && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void createCollection('新方向', isGlobal ? null : scope)
                }}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                新建方向
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  createPreset('新预设')
                  setWatermarkView('editor')
                }}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                新建预设
              </Button>
            </div>
          )}
        </header>

        <div className="pt-2.5">
          <ConsoleToolbar
            section={section}
            onSectionChange={(next) => {
              setSection(normalizeControlConsoleSection(next))
              // 切维度时回到卡片视图：否则从编辑器切走再切回来会停在编辑器，与工具栏筛选不一致
              setWatermarkView('cards')
            }}
            bindingFilter={bindingFilter}
            onBindingFilterChange={setBindingFilter}
            query={query}
            onQueryChange={setQuery}
            perRow={perRow}
            onPerRowChange={setPerRow}
            view={view}
            onViewChange={setView}
            visibleCount={visiblePresets.length}
            selectedCount={selectedIds.length}
            onSelectAll={() => setSelectedIds(visiblePresets.map((preset) => preset.id))}
            onClearSelection={() => setSelectedIds([])}
            canToggleEnabled={!isGlobal}
            onEnableSelected={() => {
              writeNodePresetIds(Array.from(new Set([...effectivePresetIds, ...selectedIds])))
              setSelectedIds([])
            }}
            onDisableSelected={() => {
              writeNodePresetIds(effectivePresetIds.filter((id) => !selectedIds.includes(id)))
              setSelectedIds([])
            }}
            onDuplicateSelected={() => duplicateMany(selectedIds)}
            onDeleteSelected={() => confirmDelete(selectedIds)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {section === 'watermark' && watermarkView === 'cards' && (
            <ConsolePresetGrid
              presets={visiblePresets}
              perRow={perRow}
              view={view}
              inNodeScope={!isGlobal}
              isEnabled={(presetId) => effectivePresetIds.includes(presetId)}
              usedByCount={usedByCount}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleEnabled={toggleEnabled}
              onEdit={openInEditor}
              onDuplicate={(presetId) => duplicateMany([presetId])}
              onDelete={(presetId) => confirmDelete([presetId])}
              emptyHint={
                presets.length === 0
                  ? '水印库是空的，点右上角「新建预设」开始。'
                  : '当前筛选条件下没有预设，换个关键词或把「归属范围」调回「全部预设」。'
              }
            />
          )}

          {section === 'watermark' && watermarkView === 'editor' && (
            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setWatermarkView('cards')}>
                  返回卡片
                </Button>
                <span className="text-xs text-ds-muted dark:text-ds-muted">画布编辑与预设库；改动即时写回卡片。</span>
              </div>
              <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-ds-lg border border-ds-border dark:border-ds-border">
                <PresetManagementTab />
              </div>
            </div>
          )}

          {section === 'media' && <MediaSection />}
          {section === 'output' && <OutputSection scope={scope} />}
          {section === 'distribution' && <DistributionSection />}
        </div>
      </div>
    </main>
  )
}
