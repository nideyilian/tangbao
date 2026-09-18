/**
 * 水印工作区左栏的「水印归属」树。
 *
 * 解决的问题：水印预设原先只有扁平的预设组与全局库，看不出**哪个方向用哪些水印**。
 * 而这件事的答案其实早就存在——`PostprocessNodeOverride.watermarkPresetIds`，
 * 只是只能在项目树节点的「参数」弹窗里逐节点打开看。水印侧看不到对应关系，
 * 于是「这版水印是给谁用的」只能靠脑子记。
 *
 * 设计口径：
 * - **树不另建**：结构来自 `AssetCollection`（唯一主源），与左侧栏、SOP、后处理同一棵树同一批 id。
 * - **值不另存**：读写的就是项目树参数层那份 `watermarkPresetIds`，与「参数」弹窗同一份数据。
 *   这里只是同一份值的第二个编辑入口，不引入第二处存储。
 * - **继承可见**：节点显示的是**生效值**，并标明它来自本级、某个祖先、还是全局默认。
 *   未表态（`undefined`）才继承；空数组是「这个方向就是不加水印」，两者在界面上必须能区分。
 * - **首次改动即物化**：在继承态下加/减一个水印，会把当前生效的那份复制成显式数组再改，
 *   否则直接写结果数组会把「少一个」错表达成「一个都不要」。
 */

import { useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, RotateCcwIcon, XIcon } from '../../../design-system/icons'
import {
  buildPostprocessProjectTree,
  flattenPostprocessProjectTree,
  isCollectionWithinSelection,
} from '../../../lib/postprocessProjectTree'
import type { PostprocessProjectTreeNode } from '../../../lib/postprocessProjectTree'
import { useStore } from '../../../store'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { resolveNodeWatermarkBinding, resolveProjectNodeKind } from '../../projectTree/params'
import type { ResolvedWatermarkBinding } from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { PROJECT_NODE_KIND_LABELS } from '../../projectTree/types'
import { PRESET_LIBRARY_DRAG_TYPE } from '../lib/compositePresetLibrary'
import { bindPresetToNode, summarizeBoundPresets, unbindPresetFromNode } from '../lib/presetBinding'
import { useCompositeV2Store } from '../storeV2'

/** 缩进阶梯：树上每深一层缩进一级，超过就不再缩（深层节点挤在右半边没法看） */
const INDENT_CLASS = ['pl-0', 'pl-3', 'pl-6', 'pl-9'] as const
/** 一行最多铺几个水印 chip，超出折叠成「+N」 */
const MAX_VISIBLE_CHIPS = 3

const chipClass =
  'rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-1.5 py-0.5 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted'

export function PresetProjectTree() {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const presets = useCompositeV2Store((state) => state.presets)
  const selectedPreviewPresetId = useCompositeV2Store((state) => state.selectedPreviewPresetId)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const selectedCollectionIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
  const showToast = useStore((state) => state.showToast)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [dropTargetId, setDropTargetId] = useState('')

  const tree = useMemo(() => buildPostprocessProjectTree(collections), [collections])
  const flatNodes = useMemo(() => flattenPostprocessProjectTree(tree), [tree])
  const presetNameById = useMemo(() => new Map(presets.map((preset) => [preset.id, preset.name])), [presets])

  /** 每个节点的生效水印 + 来源。一次算完，避免递归渲染里反复走继承链。 */
  const bindings = useMemo(() => {
    const map = new Map<string, ResolvedWatermarkBinding>()
    for (const node of flatNodes) {
      map.set(node.id, resolveNodeWatermarkBinding(collections, params, node.id, globalWatermarkPresetIds))
    }
    return map
  }, [collections, flatNodes, globalWatermarkPresetIds, params])

  /** 节点未启用时「设了也不产出」，得提前说，否则是一次「配了半天没反应」 */
  const enabledByAncestor = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const node of flatNodes) {
      map.set(node.id, isCollectionWithinSelection(collections, node.id, selectedCollectionIds))
    }
    return map
  }, [collections, flatNodes, selectedCollectionIds])

  const toggleExpanded = (nodeId: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })

  /** 写入生效数组：继承态下这一步同时完成「物化成本级覆盖」 */
  const writeBinding = (node: PostprocessProjectTreeNode, nextIds: string[]) =>
    setPostprocessOverride(node.id, { watermarkPresetIds: nextIds })

  const bindPreset = (node: PostprocessProjectTreeNode, presetId: string) => {
    const binding = bindings.get(node.id)
    const currentIds = binding?.presetIds ?? []
    if (currentIds.includes(presetId)) {
      showToast(`「${node.name}」已经绑了水印「${presetNameById.get(presetId) ?? presetId}」`, 'info')
      return
    }
    writeBinding(node, bindPresetToNode(currentIds, presetId))
    showToast(`已把水印「${presetNameById.get(presetId) ?? presetId}」绑到「${node.name}」`, 'success')
  }

  const unbindPreset = (node: PostprocessProjectTreeNode, presetId: string) => {
    const binding = bindings.get(node.id)
    writeBinding(node, unbindPresetFromNode(binding?.presetIds ?? [], presetId))
    showToast(`已从「${node.name}」解绑水印「${presetNameById.get(presetId) ?? presetId}」`, 'success')
  }

  const resetBinding = (node: PostprocessProjectTreeNode) => {
    // 写 undefined（不是写当前值）才算「恢复继承」：写当前值会把继承来的那份固化在本级，
    // 以后改上层就再也影响不到这个节点了。
    setPostprocessOverride(node.id, { watermarkPresetIds: undefined })
    showToast(`「${node.name}」已恢复继承上级的水印设置`, 'success')
  }

  const renderSourceChip = (node: PostprocessProjectTreeNode, binding: ResolvedWatermarkBinding) => {
    if (binding.overridden) return <span className={chipClass}>本级自定义</span>
    if (binding.sourcedFrom) {
      const source = collections.find((item) => item.id === binding.sourcedFrom)
      return <span className={chipClass}>继承自「{source?.name ?? '已删除节点'}」</span>
    }
    return <span className={chipClass}>跟随全局</span>
  }

  const renderNode = (node: PostprocessProjectTreeNode) => {
    const expanded = expandedIds.has(node.id)
    const indentClass = INDENT_CLASS[Math.min(node.depth, INDENT_CLASS.length - 1)]
    const binding = bindings.get(node.id) ?? { presetIds: [], sourcedFrom: null, overridden: false }
    const summary = summarizeBoundPresets(binding.presetIds, presets)
    const overflow = Math.max(0, summary.presets.length - MAX_VISIBLE_CHIPS)
    const visible = summary.presets.slice(0, MAX_VISIBLE_CHIPS)
    const inScope = enabledByAncestor.get(node.id) ?? false
    const isDropTarget = dropTargetId === node.id
    const kindLabel = PROJECT_NODE_KIND_LABELS[resolveProjectNodeKind(node.depth)]

    return (
      // 缩进放在最外层：整块（节点行 + 水印 chip 行）一起右移，chip 行再在此基础上内缩一点
      <div key={node.id} data-preset-tree-node={node.id} className={indentClass}>
        <div
          className={`rounded-md ${isDropTarget ? 'bg-ds-primary-subtle dark:bg-ds-primary/10' : ''}`}
          onDragOver={(event) => {
            const types = Array.from((event.dataTransfer as { types?: readonly string[] } | undefined)?.types ?? [])
            if (!types.includes(PRESET_LIBRARY_DRAG_TYPE)) return
            event.preventDefault()
            const transfer = event.dataTransfer as { dropEffect?: string } | undefined
            if (transfer) transfer.dropEffect = 'copy'
            if (dropTargetId !== node.id) setDropTargetId(node.id)
          }}
          onDragLeave={() => setDropTargetId((current) => (current === node.id ? '' : current))}
          onDrop={(event) => {
            event.preventDefault()
            setDropTargetId('')
            const transfer = event.dataTransfer as
              { types?: readonly string[]; getData?: (type: string) => string } | undefined
            // 显式认类型，而不是只靠 getData 返回空兜底：拖预设组、拖文件到节点上都不该被当成绑定
            const types = Array.from(transfer?.types ?? [])
            if (!types.includes(PRESET_LIBRARY_DRAG_TYPE)) return
            const presetId = transfer?.getData?.(PRESET_LIBRARY_DRAG_TYPE) ?? ''
            if (presetId) bindPreset(node, presetId)
          }}
        >
          <div className="flex items-center gap-1.5 py-0.5">
            {node.children.length > 0 ? (
              <button
                type="button"
                aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(node.id)}
                className="shrink-0 cursor-pointer rounded p-0.5 text-ds-muted hover:text-ds-text dark:text-ds-muted dark:hover:text-ds-text"
              >
                {expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate text-sm text-ds-text dark:text-ds-text">{node.name}</span>
            <span className={chipClass}>{kindLabel}</span>
            <button
              type="button"
              className="ml-auto shrink-0 cursor-pointer rounded p-0.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-primary disabled:cursor-not-allowed disabled:opacity-30 dark:text-ds-muted dark:hover:bg-ds-subtle"
              aria-label={`把当前选中的水印预设绑定到 ${node.name}`}
              title={
                selectedPreviewPresetId
                  ? `把当前选中的水印「${presetNameById.get(selectedPreviewPresetId) ?? ''}」绑到这个方向（也可从下方预设库直接拖进来）`
                  : '先在下方预设库选中一个水印，再点这里绑定（也可直接拖进来）'
              }
              disabled={!selectedPreviewPresetId}
              onClick={() => selectedPreviewPresetId && bindPreset(node, selectedPreviewPresetId)}
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className={`${indentClass} flex flex-wrap items-center gap-1 pb-1 pl-5`}>
            {renderSourceChip(node, binding)}
            {summary.presets.length === 0 && summary.missingIds.length === 0 && (
              <span className={chipClass}>不加水印</span>
            )}
            {visible.map((preset) => (
              <span
                key={preset.id}
                data-bound-preset={preset.id}
                className="group inline-flex max-w-[10rem] items-center gap-0.5 rounded-ds-lg border border-ds-primary/40 bg-ds-primary-subtle px-1.5 py-0.5 text-xs text-ds-primary dark:border-ds-primary/40 dark:bg-ds-primary/10 dark:text-ds-primary"
              >
                <button
                  type="button"
                  className="cursor-pointer truncate"
                  title={`切到这个水印去编辑图层：${preset.name}`}
                  onClick={() => setSelectedPreviewPresetId(preset.id)}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  aria-label={`从 ${node.name} 解绑水印 ${preset.name}`}
                  title="从这个方向解绑（不影响预设本身）"
                  onClick={() => unbindPreset(node, preset.id)}
                  className="cursor-pointer opacity-60 hover:opacity-100"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
            {overflow > 0 && <span className={chipClass}>+{overflow}</span>}
            {summary.missingIds.length > 0 && (
              <span
                className="rounded-ds-lg border border-ds-danger/40 bg-ds-danger-subtle px-1.5 py-0.5 text-xs text-ds-danger"
                title={`绑定的水印里有 ${summary.missingIds.length} 个已经不存在了（预设被删），它们不会产出。点右侧「恢复继承」之类的操作可以清掉，或到预设库重新建同 id 的预设。`}
              >
                已失效 {summary.missingIds.length}
              </span>
            )}
            {binding.overridden && (
              <button
                type="button"
                aria-label={`恢复 ${node.name} 的水印继承`}
                title="去掉本级的覆盖，重新跟随上级"
                onClick={() => resetBinding(node)}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-ds-lg px-1 py-0.5 text-xs text-ds-muted hover:text-ds-primary dark:text-ds-muted dark:hover:text-ds-primary"
              >
                <RotateCcwIcon className="h-3 w-3" />
                恢复继承
              </button>
            )}
            {!inScope && (
              <span
                className={chipClass}
                title="这个方向不在后处理的启用范围内，水印配了也不会产出。到工具栏「项目树」表格的「后处理」列勾选它本身或它的上级。"
              >
                未启用
              </span>
            )}
          </div>
        </div>
        {expanded && node.children.map((child) => renderNode(child))}
      </div>
    )
  }

  return (
    <section
      data-layout="preset-project-tree"
      className="flex min-h-0 flex-col overflow-hidden bg-ds-surface dark:bg-ds-scrim"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">水印归属</h2>
          <p className="truncate text-xs text-ds-muted">每个方向用哪些水印（随项目树自动生效）</p>
        </div>
      </header>
      {tree.length === 0 ? (
        <p className="p-3 text-xs text-ds-muted">
          还没有项目文件夹。可在左侧「素材库」里新建产品线与方向，这里会自动跟上。
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
          {tree.map((node) => renderNode(node))}
        </div>
      )}
    </section>
  )
}
