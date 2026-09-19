/**
 * 后处理设置面板（对应瀚灵的 `Nu()` 面板）。
 *
 * **布局 = 80% 双栏工作区**（`ds-dialog--postprocess` + `ds-dialog-workspace--split`）：
 * - **左栏是纯粹的树状导航**：只展示层级节点名称、展开/收起、选中态，不承载任何参数控件，
 *   也不再有「点节点开参数弹窗」这类入口。树根固定是「全局默认」节点。
 * - **右栏是唯一的参数详情面板**：按左栏当前选中的节点，从 `paramSchema` 读字段列表渲染。
 *
 * 参数定义只有一处（`features/postprocess/paramSchema.ts`）：左树只提供 `selectedNodeId`，
 * 右栏按作用域取字段，两侧都不再各自维护一份参数列表。
 *
 * 原先的形态是「左栏勾选 + 每节点一个参数按钮开第三层弹窗 + 右栏六段硬编码」，
 * 同一个字段在三处出现（左栏开窗、弹窗表单、右栏硬编码段），改一处漏两处的风险一直都在。
 *
 * 外壳交给设计系统的 `Dialog`：遮罩、ESC、焦点陷阱、滚动锁与焦点回归都由它统一接管
 * （走 `overlayManager` 的 overlay 栈，多层弹窗时只响应最上层）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogPane, DialogWorkspace, IconButton, SectionHeader } from '../design-system'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import MediaTableManager from '../features/postprocess/MediaTableManager'
import PostprocessParamPanel from '../features/postprocess/PostprocessParamPanel'
import { GLOBAL_NODE_ID } from '../features/postprocess/paramSchema'
import { useProjectTreeParamsStore } from '../features/projectTree/storeProjectTreeParams'
import { resolveNodeWatermarkBinding } from '../features/projectTree/params'
import {
  buildPostprocessProjectTree,
  findMissingProjectCollectionIds,
  resolvePostprocessProjectTargets,
} from '../lib/postprocessProjectTree'
import type { PostprocessProjectTreeNode } from '../lib/postprocessProjectTree'
import {
  buildPostprocessOutputName,
  selectPostprocessOutputPlan,
  usePostprocessMediaStore,
} from '../storePostprocessMedia'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SlidersHorizontalIcon } from './icons'

interface Props {
  /** 当前生成尺寸（如 `1024x1024`）；`auto` 或空表示无法预估，预览退化为示例尺寸 */
  sourceSize: string
  onClose: () => void
}

/** 方向不可预知时用于预览的示例尺寸，仅用于展示，不参与落盘。 */
const FALLBACK_PREVIEW_SIZE = { width: 1024, height: 1024 }

function parseSourceSize(size: string): { width: number; height: number } | null {
  const match = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(size ?? '')
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

/** 缩进用固定档位类名，不用内联 padding 以保持与设计系统一致。 */
const INDENT_CLASS = ['pl-0', 'pl-4', 'pl-8', 'pl-12']

/** 内嵌 chip：所在容器多为 surface（白），用下沉色 surface-subtle 保证可见。 */
const chipClass =
  'inline-flex items-center gap-1 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-1.5 py-0.5 text-xs text-ds-muted'

export default function PostprocessSettingsModal({ sourceSize, onClose }: Props) {
  const media = usePostprocessMediaStore((state) => state.media)
  const selectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const selectedCollectionIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
  const direction = usePostprocessMediaStore((state) => state.direction)
  const outputDir = usePostprocessMediaStore((state) => state.outputDir)
  const mediaOutputDirs = usePostprocessMediaStore((state) => state.mediaOutputDirs)
  const namePattern = usePostprocessMediaStore((state) => state.namePattern)
  const creator = usePostprocessMediaStore((state) => state.creator)
  const watermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const autoCompanionClean = usePostprocessMediaStore((state) => state.autoCompanionClean)
  const distribution = usePostprocessMediaStore((state) => state.distribution)

  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)

  /** 右栏参数面板读的全局基线（单份组装，避免面板里再拼一遍） */
  const globalConfig = useMemo(
    () => ({
      media,
      selectedMediaIds,
      selectedCollectionIds,
      direction,
      outputDir,
      mediaOutputDirs,
      namePattern,
      creator,
      watermarkPresetIds,
      autoCompanionClean,
      distribution,
    }),
    [
      media,
      selectedMediaIds,
      selectedCollectionIds,
      direction,
      outputDir,
      mediaOutputDirs,
      namePattern,
      creator,
      watermarkPresetIds,
      autoCompanionClean,
      distribution,
    ],
  )

  const projectTree = useMemo(() => buildPostprocessProjectTree(collections), [collections])

  const parsedSource = parseSourceSize(sourceSize)
  const previewSource = parsedSource ?? FALLBACK_PREVIEW_SIZE

  const projectTargets = useMemo(
    () =>
      resolvePostprocessProjectTargets(collections, selectedCollectionIds).map((target) => ({
        ...target,
        watermarkPresetIds: resolveNodeWatermarkBinding(collections, params, target.collectionId, watermarkPresetIds)
          .presetIds,
      })),
    [collections, selectedCollectionIds, params, watermarkPresetIds],
  )

  const missingProjectIds = useMemo(
    () => findMissingProjectCollectionIds(collections, selectedCollectionIds),
    [collections, selectedCollectionIds],
  )

  const plan = useMemo(
    () => selectPostprocessOutputPlan(globalConfig, previewSource, projectTargets, {}),
    [globalConfig, previewSource, projectTargets],
  )
  const previewUnits = projectTargets.length > 0 ? plan.units : []
  /** 产出预览只列前几条：这一屏是确认配置，不是逐条核对清单 */
  const visibleUnits = previewUnits.slice(0, 6)

  // ── 左栏：纯树导航态 ────────────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  /** 选中的树节点 id；默认落在「全局默认」上，让右栏一开就有内容 */
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(GLOBAL_NODE_ID)

  // 项目树首次可用时展开产品线（产品与方向默认折叠，否则 77 个节点会淹掉整块面板）。
  // 只自动展开一次，之后完全尊重用户的折叠操作。
  const treeInitializedRef = useRef(false)
  useEffect(() => {
    if (treeInitializedRef.current || projectTree.length === 0) return
    treeInitializedRef.current = true
    setExpandedIds(new Set(projectTree.filter((node) => node.children.length > 0).map((node) => node.id)))
  }, [projectTree])

  const toggleExpanded = (id: string) =>
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** 选中节点在树上的祖先链，用于把新建/已删节点的选中态补齐可见 */
  useEffect(() => {
    if (!selectedNodeId || selectedNodeId === GLOBAL_NODE_ID) return
    if (!collections.some((item) => item.id === selectedNodeId)) return
    setExpandedIds((current) => {
      const next = new Set(current)
      let cursor = collections.find((item) => item.id === selectedNodeId)?.parentId ?? null
      while (cursor) {
        next.add(cursor)
        cursor = collections.find((item) => item.id === cursor)?.parentId ?? null
      }
      return next
    })
  }, [selectedNodeId, collections])

  const footerStatus =
    projectTargets.length === 0
      ? '未满足启用条件：需同时勾选启用范围与媒体'
      : previewUnits.length === 0
        ? '当前选择产不出变体，请检查媒体与方向'
        : `每张原图产出 ${previewUnits.length} 个文件`

  /**
   * 树节点行：**只有展开箭头、名称、选中态**。
   *
   * 原先这里还有 Checkbox（启用范围）与「参数」IconButton（开第三层弹窗）——
   * 一个把导航栏变成了表单，另一个让同一份参数有了两个入口。
   * 现在启用范围改到右栏参数面板的「参与自动后处理」，参数编辑就是右栏本身。
   */
  const renderProjectNode = (node: PostprocessProjectTreeNode) => {
    const expanded = expandedIds.has(node.id)
    const indentClass = INDENT_CLASS[Math.min(node.depth, INDENT_CLASS.length - 1)]
    const selected = selectedNodeId === node.id
    const inScope = selectedCollectionIds.includes(node.id)
    return (
      <div key={node.id}>
        <div className={`flex items-center gap-1 rounded-ds-lg ${indentClass}`}>
          {node.children.length > 0 ? (
            <IconButton
              size="sm"
              aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
              aria-expanded={expanded}
              icon={
                expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />
              }
              onClick={() => toggleExpanded(node.id)}
            />
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            data-testid={`postprocess-tree-node-${node.id}`}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-ds-md px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
              selected ? 'bg-ds-primary/10 font-medium text-ds-primary' : 'text-ds-text hover:bg-ds-surface'
            }`}
            onClick={() => setSelectedNodeId(node.id)}
          >
            <span className="min-w-0 flex-1 truncate" title={node.name}>
              {node.name}
            </span>
            {node.depth === 0 && <span className={chipClass}>产品线</span>}
            {node.depth === 1 && <span className={chipClass}>产品</span>}
            {node.depth >= 2 && <span className={chipClass}>方向</span>}
            {/* 启用范围只作为状态提示，不再是可点的控件——控件在右栏 */}
            {inScope && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-primary" />}
          </button>
        </div>
        {expanded && node.children.map((child) => renderProjectNode(child))}
      </div>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="后处理"
      description="左侧选节点，右侧看它的参数。未单独设置的字段沿「方向 → 产品 → 产品线 → 全局默认」逐级继承。"
      className="ds-dialog--postprocess"
      footer={
        <>
          <span className="self-center text-xs text-ds-muted">{footerStatus}</span>
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      <DialogWorkspace layout="split" className="min-h-0 flex-1">
        {/* 左栏：纯树导航。只有名称、展开箭头与选中态，没有任何参数控件 */}
        <DialogPane as="aside" tone="sidebar" scroll={false} className="flex flex-col gap-2">
          <SectionHeader title="节点" description="选中一个节点，右侧显示它的参数。" />
          <div className="min-h-0 flex-1 overflow-y-auto rounded-ds-lg border border-ds-border bg-ds-surface p-1 custom-scrollbar">
            {/* 树根固定是「全局默认」：所有节点的兜底值，媒体表这类全局规格也挂在它下面 */}
            <button
              type="button"
              aria-current={selectedNodeId === GLOBAL_NODE_ID ? 'true' : undefined}
              data-testid="postprocess-tree-node-global"
              className={`flex w-full items-center gap-1.5 rounded-ds-md px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
                selectedNodeId === GLOBAL_NODE_ID
                  ? 'bg-ds-primary/10 font-medium text-ds-primary'
                  : 'text-ds-text hover:bg-ds-surface-subtle'
              }`}
              onClick={() => setSelectedNodeId(GLOBAL_NODE_ID)}
            >
              <SlidersHorizontalIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">全局默认</span>
              <span className="shrink-0 text-xs text-ds-muted">{selectedCollectionIds.length} 个启用</span>
            </button>

            {projectTree.length === 0 ? (
              <p className="px-1.5 py-2 text-xs text-ds-muted">还没有项目文件夹，树是空的。</p>
            ) : (
              <div className="mt-0.5">{projectTree.map((node) => renderProjectNode(node))}</div>
            )}
          </div>
          {missingProjectIds.length > 0 && (
            <Alert tone="warning">有 {missingProjectIds.length} 个已勾选的节点不存在或已删除，将被跳过。</Alert>
          )}
        </DialogPane>

        {/* 右栏：唯一参数详情面板。字段与分组全部来自 paramSchema */}
        <DialogPane tone="content" className="min-h-0">
          <PostprocessParamPanel
            selectedNodeId={selectedNodeId}
            globalConfig={globalConfig}
            enabledScopeIds={selectedCollectionIds}
            outputUnitCount={projectTargets.length > 0 ? previewUnits.length : undefined}
            renderMediaTable={() => <MediaTableManager />}
            renderOutputPreview={() => <OutputPreview units={visibleUnits} config={globalConfig} />}
          />
        </DialogPane>
      </DialogWorkspace>
    </Dialog>
  )
}

/** 产出预览清单（只读）。 */
function OutputPreview({
  units,
  config,
}: {
  units: ReturnType<typeof selectPostprocessOutputPlan>['units']
  config: Parameters<typeof buildPostprocessOutputName>[0]
}) {
  if (units.length === 0) {
    return (
      <p className="text-xs text-ds-muted">
        勾选启用范围与媒体后显示产出清单。统一输出 JPEG；比例与生成尺寸不一致时等比放大裁切填满。
      </p>
    )
  }
  return (
    <ul className="space-y-1">
      {units.map((unit, index) => (
        <li
          key={`${unit.project?.collectionId ?? 'none'}-${unit.sizeId}-${index}`}
          className="flex items-center gap-2 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-1.5 text-xs"
        >
          <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
          <span className="shrink-0 text-ds-muted">
            {[unit.project?.line, unit.project?.product, unit.project?.direction].filter(Boolean).join(' / ') ||
              '未归属'}{' '}
            · {unit.width}x{unit.height}
          </span>
          <span
            className="ml-auto min-w-0 truncate text-ds-text"
            title={buildPostprocessOutputName(config, unit, unit.project ?? {}, index + 1)}
          >
            {buildPostprocessOutputName(config, unit, unit.project ?? {}, index + 1)}
          </span>
        </li>
      ))}
    </ul>
  )
}
