/**
 * 水印工作区左栏的「水印归属」树。
 *
 * 解决的问题：水印预设原先只有扁平的**预设组**与全局库，看不出**哪个方向用哪些水印**。
 * 而这件事的答案其实早就存在——`PostprocessNodeOverride.watermarkPresetIds`，
 * 只是只能在项目树节点的「参数」弹窗里逐节点打开看。水印侧看不到对应关系，
 * 于是「这版水印是给谁用的」只能靠脑子记。
 *
 * **这里只做一件事**：设置「这个产品 / 这个方向下包含哪些水印预设」。
 * 输出目录、命名模板、渠道规格、启用范围全在后处理那套界面里——同一个参数有两个入口，
 * 迟早会出现「在 A 改了、在 B 看不到」，所以树上一个都不放。
 *
 * 预设组退役之后，这棵树同时承担两件事，不再有中间层：
 * - **层级管理**：新建子节点 / 重命名 / 删除 / 拖动换父级
 * - **归属**：拖入预设绑定、chip 解绑、恢复继承；渠道分叉的归属点节点行右侧的「按渠道」图标改
 *
 * 四条设计口径：
 * - **树不另建**：结构来自 `AssetCollection`（唯一主源），与左侧栏、SOP、后处理同一棵树同一批 id。
 * - **值不另存**：读写的就是项目树参数层那份 `watermarkPresetIds`，不引入第二处存储。
 * - **行上不挂标签**（2026-09-18 第三轮）：层级靠缩进表达，不再标「产品线 / 产品」；来源
 *   （本级自定义 / 继承自「X」/ 跟随全局）与状态（不加水印）一律不显示——那些都是注释，
 *   一排灰底小字会把树压成两行一个节点，真正要看的「这个方向绑了哪几套水印」反而被淹掉。
 *   于是**没有绑定的节点就是一个节点一行**（行下那排整块不渲染）。
 *   ⚠️ 代价：`undefined`（继承）与 `[]`（显式不加水印）在树上不再可区分，只剩「恢复继承」
 *   按钮的有无。要看生效明细去后处理面板的「水印归属」区块——那里是逐方向列出来的。
 * - **首次改动即物化**：在继承态下加/减一个水印，会把当前生效的那份复制成显式数组再改，
 *   否则直接写结果数组会把「少一个」错表达成「一个都不要」。
 */

import { useMemo, useState } from 'react'
import { Checkbox, Menu, MenuItem, MenuSeparator, Popover } from '../../../design-system'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  Layers3Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  TrashIcon,
  XIcon,
} from '../../../design-system/icons'
import { useAppDialog } from '../../../hooks/useAppDialog'
import {
  buildPostprocessProjectTree,
  flattenPostprocessProjectTree,
  resolveCollectionPath,
} from '../../../lib/postprocessProjectTree'
import type { PostprocessProjectTreeNode } from '../../../lib/postprocessProjectTree'
import { useStore } from '../../../store'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import {
  resolveNodeWatermarkBinding,
  resolveNodeWatermarkBindingsByMedia,
  type ResolvedMediaWatermarkBinding,
  type ResolvedWatermarkBinding,
} from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { PRESET_LIBRARY_DRAG_TYPE, parsePresetDragPayload } from '../lib/compositePresetLibrary'
import { bindPresetToNode, bindPresetsToNode, summarizeBoundPresets, unbindPresetFromNode } from '../lib/presetBinding'
import { useCompositeV2Store } from '../storeV2'

/**
 * 节点拖拽的 MIME。与「拖预设进来绑定」共用一个 drop 目标，靠载荷类型区分意图：
 * 预设 = 绑定水印，节点 = 换父级。只看 getData 反而不行——两者都在拖拽里，
 * 分不清就成了「想挪文件夹却给方向绑了水印」。
 */
export const COLLECTION_NODE_DRAG_TYPE = 'application/x-tangbao-collection-node'

/** 缩进阶梯：树上每深一层缩进一级，超过就不再缩（深层节点挤在右半边没法看） */
const INDENT_CLASS = ['pl-0', 'pl-3', 'pl-6', 'pl-9'] as const
/** 一行最多铺几个水印 chip，超出折叠成「+N」 */
const MAX_VISIBLE_CHIPS = 3

/** 新建子节点时的默认名。按层级语义给，省掉「建完还要先改名」这一步。 */
function childNameFor(depth: number) {
  if (depth <= 0) return '新产品'
  if (depth === 1) return '新方向'
  return '新节点'
}

const chipClass =
  'rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-1.5 py-0.5 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted'

export function PresetProjectTree({ librarySelection = [] }: { librarySelection?: string[] }) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const createCollection = useAssetLibraryStore((state) => state.createCollection)
  const renameCollection = useAssetLibraryStore((state) => state.renameCollection)
  const deleteCollection = useAssetLibraryStore((state) => state.deleteCollection)
  const moveCollection = useAssetLibraryStore((state) => state.moveCollection)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const presets = useCompositeV2Store((state) => state.presets)
  const selectedPreviewPresetId = useCompositeV2Store((state) => state.selectedPreviewPresetId)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const media = usePostprocessMediaStore((state) => state.media)
  const showToast = useStore((state) => state.showToast)
  const { openConfirmDialog } = useAppDialog()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [dropTargetId, setDropTargetId] = useState('')
  const [moveTargetId, setMoveTargetId] = useState('')
  const [menuNodeId, setMenuNodeId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')
  /** 正在就地展开「按渠道」归属编辑的节点。同一时刻只开一个。 */
  const [channelEditorNodeId, setChannelEditorNodeId] = useState('')

  const tree = useMemo(() => buildPostprocessProjectTree(collections), [collections])
  const flatNodes = useMemo(() => flattenPostprocessProjectTree(tree), [tree])
  const presetNameById = useMemo(() => new Map(presets.map((preset) => [preset.id, preset.name])), [presets])
  const mediaNameById = useMemo(() => new Map(media.map((item) => [item.id, item.name])), [media])

  /** 每个节点的生效水印 + 来源。一次算完，避免递归渲染里反复走继承链。 */
  const bindings = useMemo(() => {
    const map = new Map<string, ResolvedWatermarkBinding>()
    for (const node of flatNodes) {
      map.set(node.id, resolveNodeWatermarkBinding(collections, params, node.id, globalWatermarkPresetIds))
    }
    return map
  }, [collections, flatNodes, globalWatermarkPresetIds, params])

  /**
   * 按渠道单独绑的那部分（`byMedia`）。
   *
   * 只收「与通用值不同」的渠道：多数方向各渠道共用一套水印，把每个渠道都列出来
   * 反而会把「哪些渠道真的不一样」淹掉。要改就点节点行右侧的「按渠道」图标。
   */
  const mediaBindings = useMemo(() => {
    const map = new Map<string, ResolvedMediaWatermarkBinding[]>()
    const mediaIds = media.map((item) => item.id)
    for (const node of flatNodes) {
      map.set(
        node.id,
        resolveNodeWatermarkBindingsByMedia(collections, params, node.id, globalWatermarkPresetIds, mediaIds),
      )
    }
    return map
  }, [collections, flatNodes, globalWatermarkPresetIds, params, media])

  /**
   * 一次要绑的预设。优先用库里勾的那批，没勾就退回当前正在编辑的那个——
   * 后者是「先在库里点一个水印、再到树上点 +」的老路径，不能因为多了多选就断掉。
   */
  const bindingCandidates =
    librarySelection.length > 0 ? librarySelection : selectedPreviewPresetId ? [selectedPreviewPresetId] : []

  const toggleExpanded = (nodeId: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })

  // ---- 归属 ----

  /** 写入生效数组：继承态下这一步同时完成「物化成本级覆盖」 */
  const writeBinding = (node: PostprocessProjectTreeNode, nextIds: string[]) =>
    setPostprocessOverride(node.id, { watermarkPresetIds: nextIds })

  const bindPresets = (node: PostprocessProjectTreeNode, presetIds: string[]) => {
    const currentIds = bindings.get(node.id)?.presetIds ?? []
    const added = presetIds.filter((id) => !currentIds.includes(id))
    if (added.length === 0) {
      showToast(`「${node.name}」已经绑了这些水印`, 'info')
      return
    }
    writeBinding(node, bindPresetsToNode(currentIds, presetIds))
    const names = added.map((id) => presetNameById.get(id) ?? id)
    showToast(
      added.length === 1
        ? `已把水印「${names[0]}」绑到「${node.name}」`
        : `已把 ${added.length} 个水印绑到「${node.name}」：${names.join('、')}`,
      'success',
    )
  }

  const unbindPreset = (node: PostprocessProjectTreeNode, presetId: string) => {
    writeBinding(node, unbindPresetFromNode(bindings.get(node.id)?.presetIds ?? [], presetId))
    showToast(`已从「${node.name}」解绑水印「${presetNameById.get(presetId) ?? presetId}」`, 'success')
  }

  const resetBinding = (node: PostprocessProjectTreeNode) => {
    // 写 undefined（不是写当前值）才算「恢复继承」：写当前值会把继承来的那份固化在本级，
    // 以后改上层就再也影响不到这个节点了。
    setPostprocessOverride(node.id, { watermarkPresetIds: undefined })
    showToast(`「${node.name}」已恢复继承上级的水印设置`, 'success')
  }

  /**
   * 某渠道当前**生效**的预设列表。
   *
   * 首次按渠道改动时要拿它去物化成本级数组——直接写「勾上的那几个」会把继承来的其余预设
   * 静默丢掉，症状是「我只是想加一个，结果另外两个没了」。
   */
  const effectivePresetIdsForMedia = (nodeId: string, mediaId: string) =>
    resolveNodeWatermarkBinding(collections, params, nodeId, globalWatermarkPresetIds, mediaId).presetIds

  const toggleChannelPreset = (node: PostprocessProjectTreeNode, mediaId: string, presetId: string) => {
    const current = effectivePresetIdsForMedia(node.id, mediaId)
    const next = current.includes(presetId)
      ? unbindPresetFromNode(current, presetId)
      : bindPresetToNode(current, presetId)
    setPostprocessOverride(node.id, { byMedia: { [mediaId]: { watermarkPresetIds: next } } })
  }

  /** 把某个渠道退回「跟随本节点的通用设置」（摘掉渠道覆盖，不是写成当前值）。 */
  const resetChannelBinding = (node: PostprocessProjectTreeNode, mediaId: string) => {
    setPostprocessOverride(node.id, { byMedia: { [mediaId]: { watermarkPresetIds: undefined } } })
    showToast(`「${node.name}」在${mediaNameById.get(mediaId) ?? mediaId}已改回跟随通用设置`, 'success')
  }

  // ---- 层级 ----

  const startRename = (node: PostprocessProjectTreeNode) => {
    setMenuNodeId('')
    setEditingId(node.id)
    setEditingName(node.name)
  }

  const commitRename = () => {
    const targetId = editingId
    const nextName = editingName.trim()
    setEditingId('')
    setEditingName('')
    if (!targetId) return
    const current = collections.find((item) => item.id === targetId)
    if (!nextName || nextName === current?.name) return
    void renameCollection(targetId, nextName).then(() => showToast(`已重命名为「${nextName}」`, 'success'))
  }

  const addChild = (node: PostprocessProjectTreeNode) => {
    setMenuNodeId('')
    void createCollection(childNameFor(node.depth), node.id).then((created) => {
      if (!created) return
      setExpandedIds((prev) => new Set(prev).add(node.id))
      setEditingId(created.id)
      setEditingName(created.name)
    })
  }

  const removeNode = (node: PostprocessProjectTreeNode) => {
    setMenuNodeId('')
    const descendantCount = flattenPostprocessProjectTree([node]).length - 1
    openConfirmDialog({
      title: '删除文件夹？',
      message:
        descendantCount > 0
          ? `将删除「${node.name}」及其下 ${descendantCount} 个子级。素材本身不会被删除，只是解除归档；这些方向上的后处理参数与归属会一并消失。`
          : `将删除「${node.name}」。素材本身不会被删除，只是解除归档；这个方向上的后处理参数与归属会一并消失。`,
      confirmText: '确认删除',
      tone: 'danger',
      action: () => {
        void deleteCollection(node.id).then(() => showToast(`已删除「${node.name}」`, 'success'))
      },
    })
  }

  /** 换父级。目标是自己或自己的后代时拒绝——那会造出一个从根走不到的环。 */
  const moveNode = (draggedId: string, targetId: string | null) => {
    if (!draggedId || draggedId === targetId) return
    const dragged = collections.find((item) => item.id === draggedId)
    if (!dragged) return
    if (targetId && resolveCollectionPath(collections, targetId).some((item) => item.id === draggedId)) {
      showToast('不能把文件夹放进它自己的子级里', 'error')
      return
    }
    if ((dragged.parentId ?? null) === targetId) return
    const targetName = targetId ? (collections.find((item) => item.id === targetId)?.name ?? '') : ''
    void moveCollection(draggedId, targetId).then(() => {
      showToast(
        targetId ? `已把「${dragged.name}」移到「${targetName}」下` : `已把「${dragged.name}」移到顶层`,
        'success',
      )
      if (targetId) setExpandedIds((prev) => new Set(prev).add(targetId))
    })
  }

  // ---- 渲染 ----

  const renderNode = (node: PostprocessProjectTreeNode) => {
    const expanded = expandedIds.has(node.id)
    const indentClass = INDENT_CLASS[Math.min(node.depth, INDENT_CLASS.length - 1)]
    const binding = bindings.get(node.id) ?? { presetIds: [], sourcedFrom: null, overridden: false }
    const channelBindings = mediaBindings.get(node.id) ?? []
    const summary = summarizeBoundPresets(binding.presetIds, presets)
    const overflow = Math.max(0, summary.presets.length - MAX_VISIBLE_CHIPS)
    const visible = summary.presets.slice(0, MAX_VISIBLE_CHIPS)
    const isDropTarget = dropTargetId === node.id
    const isMoveTarget = moveTargetId === node.id
    const isEditing = editingId === node.id
    const highlight = isDropTarget || isMoveTarget
    const channelOverride = params[node.id]?.postprocess?.byMedia
    const hasChannelOverride = channelBindings.length > 0
    /**
     * 行下那排只在真有东西可看时才占位：没有绑定、没有失效引用、也没有可恢复的覆盖就整块不渲染。
     * 否则每个节点都拖着一条空白行，树会被压成两行一个 —— 而「哪几套水印」本来一眼就该看完。
     */
    const hasWatermarkRow = summary.presets.length > 0 || summary.missingIds.length > 0 || binding.overridden

    return (
      // 缩进放在最外层：整块（节点行 + 水印 chip 行）一起右移，chip 行再在此基础上内缩一点
      <div key={node.id} data-preset-tree-node={node.id} className={indentClass}>
        <div
          draggable={!isEditing}
          className={`group/node rounded-md ${highlight ? 'bg-ds-primary-subtle ring-1 ring-ds-primary/40 dark:bg-ds-primary/10' : ''}`}
          onDragStart={(event) => {
            event.stopPropagation()
            event.dataTransfer.effectAllowed = 'move'
            ;(event.dataTransfer as { setData?: (type: string, value: string) => void }).setData?.(
              COLLECTION_NODE_DRAG_TYPE,
              node.id,
            )
          }}
          onDragOver={(event) => {
            const types = Array.from((event.dataTransfer as { types?: readonly string[] } | undefined)?.types ?? [])
            const transfer = event.dataTransfer as { dropEffect?: string } | undefined
            if (types.includes(PRESET_LIBRARY_DRAG_TYPE)) {
              event.preventDefault()
              if (transfer) transfer.dropEffect = 'copy'
              if (dropTargetId !== node.id) setDropTargetId(node.id)
              return
            }
            if (types.includes(COLLECTION_NODE_DRAG_TYPE)) {
              event.preventDefault()
              if (transfer) transfer.dropEffect = 'move'
              if (moveTargetId !== node.id) setMoveTargetId(node.id)
            }
          }}
          onDragLeave={() => {
            setDropTargetId((current) => (current === node.id ? '' : current))
            setMoveTargetId((current) => (current === node.id ? '' : current))
          }}
          onDrop={(event) => {
            event.preventDefault()
            // 不往下冒泡：否则会同时命中根容器的「移到顶层」，把刚挪进来的节点又拎出去
            event.stopPropagation()
            setDropTargetId('')
            setMoveTargetId('')
            const transfer = event.dataTransfer as
              { types?: readonly string[]; getData?: (type: string) => string } | undefined
            const types = Array.from(transfer?.types ?? [])
            if (types.includes(PRESET_LIBRARY_DRAG_TYPE)) {
              const presetIds = parsePresetDragPayload(transfer?.getData?.(PRESET_LIBRARY_DRAG_TYPE) ?? '')
              if (presetIds.length > 0) bindPresets(node, presetIds)
              return
            }
            if (types.includes(COLLECTION_NODE_DRAG_TYPE)) {
              moveNode(transfer?.getData?.(COLLECTION_NODE_DRAG_TYPE) ?? '', node.id)
            }
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
            {isEditing ? (
              <input
                autoFocus
                aria-label={`重命名 ${node.name}`}
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitRename()
                  } else if (event.key === 'Escape') {
                    setEditingId('')
                    setEditingName('')
                  }
                }}
                className="min-w-0 flex-1 rounded border border-ds-primary/35 bg-ds-surface px-1.5 py-0.5 text-sm text-ds-text outline-none dark:bg-ds-scrim dark:text-ds-text"
              />
            ) : (
              <button
                type="button"
                title={`${node.name}（双击重命名）`}
                onDoubleClick={() => startRename(node)}
                onClick={() => toggleExpanded(node.id)}
                className="min-w-0 truncate text-left text-sm text-ds-text dark:text-ds-text"
              >
                {node.name}
              </button>
            )}
            {/* 这里原先挂一个「产品线 / 产品」标签。层级缩进已经说清了，标签只是重复一遍。 */}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="cursor-pointer rounded p-0.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-primary disabled:cursor-not-allowed disabled:opacity-30 dark:text-ds-muted dark:hover:bg-ds-subtle"
                aria-label={`把水印绑定到 ${node.name}`}
                title={
                  bindingCandidates.length === 0
                    ? '先在下方水印库里勾选（或点中）一个水印，再点这里绑定；也可直接把水印拖进来'
                    : librarySelection.length > 1
                      ? `把库里勾选的 ${librarySelection.length} 个水印一次绑到这个方向（也可直接拖进来）`
                      : `把水印「${presetNameById.get(bindingCandidates[0]!) ?? ''}」绑到这个方向（也可直接拖进来）`
                }
                disabled={bindingCandidates.length === 0}
                onClick={() => bindPresets(node, bindingCandidates)}
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
              {/* 按渠道从「行上的标签」改成操作区里的一个图标：有渠道分叉时点亮成强调色，
                  点开在节点行下方就地展开勾选表。入口必须常驻——源表里 56 个方向的水印是按渠道
                  给的，没有入口就没地方维护；但它本身不该占掉树的一行。 */}
              <button
                type="button"
                aria-label={`${node.name} 的按渠道水印`}
                aria-expanded={channelEditorNodeId === node.id}
                title={
                  hasChannelOverride
                    ? `这些渠道各自绑了不同的水印：\n${channelBindings
                        .map((item) => {
                          const names = summarizeBoundPresets(item.presetIds, presets).presets.map(
                            (preset) => preset.name,
                          )
                          return `${mediaNameById.get(item.mediaId) ?? item.mediaId}：${names.join('、') || '不加水印'}`
                        })
                        .join('\n')}\n点一下改`
                    : '默认各渠道共用上面这套；只有同一方向在不同渠道要叠不同水印时才需要在这里单独设'
                }
                onClick={(event) => {
                  event.stopPropagation()
                  setChannelEditorNodeId((current) => (current === node.id ? '' : node.id))
                }}
                className={
                  hasChannelOverride
                    ? 'cursor-pointer rounded p-0.5 text-ds-accent hover:bg-ds-subtle'
                    : 'cursor-pointer rounded p-0.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-primary dark:text-ds-muted dark:hover:bg-ds-subtle'
                }
              >
                <Layers3Icon className="h-3.5 w-3.5" />
              </button>
              <div className="relative">
                <button
                  type="button"
                  aria-label={`${node.name} 的更多操作`}
                  aria-haspopup="menu"
                  aria-expanded={menuNodeId === node.id}
                  title="新建子节点 / 重命名 / 删除"
                  onClick={() => setMenuNodeId((current) => (current === node.id ? '' : node.id))}
                  className="cursor-pointer rounded p-0.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-text dark:text-ds-muted dark:hover:bg-ds-subtle"
                >
                  <MoreHorizontalIcon className="h-3.5 w-3.5" />
                </button>
                {menuNodeId === node.id && (
                  <Popover
                    label={`${node.name} 的操作菜单`}
                    arrow={false}
                    className="!absolute right-0 top-full z-dropdown mt-1 w-36 !p-1"
                  >
                    <Menu label={`${node.name} 的操作`} className="!border-0 !bg-transparent !p-0">
                      <MenuItem icon={<FolderPlusIcon className="h-3.5 w-3.5" />} onClick={() => addChild(node)}>
                        新建子节点
                      </MenuItem>
                      <MenuItem icon={<PencilIcon className="h-3.5 w-3.5" />} onClick={() => startRename(node)}>
                        重命名
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        tone="danger"
                        icon={<TrashIcon className="h-3.5 w-3.5" />}
                        onClick={() => removeNode(node)}
                      >
                        删除
                      </MenuItem>
                    </Menu>
                  </Popover>
                )}
              </div>
            </div>
          </div>

          {hasWatermarkRow && (
            <div className="flex flex-wrap items-center gap-1 pb-1 pl-5">
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
              {overflow > 0 && (
                // 不指向「参数弹窗」了：那里已经不管水印归属，指过去会是一次空跑
                <span
                  className={chipClass}
                  title="一行放不下，没有逐个列出；绑定关系本身不受影响，点开「按渠道」或到下方水印库搜索都能找到它们"
                >
                  +{overflow}
                </span>
              )}
              {summary.missingIds.length > 0 && (
                <span
                  className="rounded-ds-lg border border-ds-danger/40 bg-ds-danger-subtle px-1.5 py-0.5 text-xs text-ds-danger"
                  title={`绑定的水印里有 ${summary.missingIds.length} 个已经不存在了（预设被删），它们不会产出。点「恢复继承」可以清掉，或到水印库重建同 id 的预设。`}
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
            </div>
          )}

          {/* 按渠道编辑**就地展开**而不是弹层：树的滚动容器会裁掉绝对定位的浮层，
              而在归属这件事上「看得见上下文」比「少占两行」重要。 */}
          {channelEditorNodeId === node.id && (
            <div className="mb-1 ml-5 space-y-2 rounded-md border border-ds-border bg-ds-surface/60 p-2 dark:border-ds-border dark:bg-ds-surface">
              <p className="text-xs text-ds-muted dark:text-ds-muted">
                勾选 = 该渠道单独用这套；全部取消 = 该渠道不加水印；「跟随通用」= 用上面那套。
              </p>
              {media.length === 0 && (
                <p className="text-xs text-ds-muted dark:text-ds-muted">媒体表为空，没有可单独设置的渠道。</p>
              )}
              {media.map((item) => {
                const ids = effectivePresetIdsForMedia(node.id, item.id)
                const overridden = channelOverride?.[item.id]?.watermarkPresetIds !== undefined
                return (
                  <div key={item.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ds-text dark:text-ds-text">{item.name}</span>
                      {overridden ? (
                        <button
                          type="button"
                          onClick={() => resetChannelBinding(node, item.id)}
                          className="cursor-pointer text-xs text-ds-accent underline-offset-2 hover:underline dark:text-ds-accent"
                        >
                          跟随通用
                        </button>
                      ) : (
                        <span className="text-xs text-ds-muted dark:text-ds-muted">跟随通用</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 pl-1">
                      {presets.length === 0 && (
                        <span className="text-xs text-ds-muted dark:text-ds-muted">水印库还是空的。</span>
                      )}
                      {presets.map((preset) => (
                        <Checkbox
                          key={preset.id}
                          checked={ids.includes(preset.id)}
                          onChange={() => toggleChannelPreset(node, item.id, preset.id)}
                          label={preset.name}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {expanded && node.children.map((child) => renderNode(child))}
      </div>
    )
  }

  return (
    <section
      data-layout="preset-project-tree"
      className="flex min-h-0 flex-col overflow-hidden border-r border-ds-border bg-ds-surface dark:border-ds-border dark:bg-ds-scrim"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-ds-border px-3 py-2 dark:border-ds-border">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">水印归属</h2>
          <p className="truncate text-xs text-ds-muted">这个产品 / 方向下包含哪几套水印</p>
        </div>
      </header>
      {tree.length === 0 ? (
        <p className="p-3 text-xs text-ds-muted">
          还没有项目文件夹。可在左侧「素材库」里新建产品线与方向，这里会自动跟上。
        </p>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar"
          onClick={() => setMenuNodeId('')}
          onDragOver={(event) => {
            // 拖到空白处 = 移回顶层。节点自己的 drop 已 stopPropagation，不会走到这里。
            if (!Array.from(event.dataTransfer.types ?? []).includes(COLLECTION_NODE_DRAG_TYPE)) return
            event.preventDefault()
          }}
          onDrop={(event) => {
            const types = Array.from(event.dataTransfer.types ?? [])
            if (!types.includes(COLLECTION_NODE_DRAG_TYPE)) return
            event.preventDefault()
            setMoveTargetId('')
            moveNode(event.dataTransfer.getData(COLLECTION_NODE_DRAG_TYPE), null)
          }}
        >
          {tree.map((node) => renderNode(node))}
        </div>
      )}
    </section>
  )
}
