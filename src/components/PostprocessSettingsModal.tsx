/**
 * 后处理设置面板（对应瀚灵的 `Nu()` 面板）。
 *
 * 只负责「编排」：勾项目 → 选方向 → 勾媒体 → 定输出与命名，并实时预览会产出哪些变体。
 * 实际的尺寸压缩与水印叠加在输出链路里做（阶段四），面板不碰图片。
 *
 * 所有配置即时写入 `usePostprocessMediaStore`（它自己持久化），没有「保存/取消」的草稿态。
 *
 * **布局 = 80% 双栏工作区**（`ds-dialog--postprocess` + `ds-dialog-workspace--split`）：
 * 左栏是项目树（启用范围，可能上百个节点，自己滚），右栏是逐项设置。
 * 原先单栏纵向堆叠时，树被压在 `max-h-56` 的小框里，勾一屏要看两个滚动条。
 *
 * **参数的入口就挂在左栏树上**：每个节点一个「参数」按钮直接开单节点参数弹窗，
 * 标题右侧另有「参数表格」开完整工作台。启用范围与节点参数虽然分开存，但同属一棵树，
 * 用户不该为了改参数跑到另一个模块的工具栏里去找入口。
 *
 * 外壳交给设计系统的 `Dialog`：遮罩、ESC、焦点陷阱、滚动锁与焦点回归都由它统一接管
 * （走 `overlayManager` 的 overlay 栈，多层弹窗时只响应最上层）。
 * 面板不再手搓 `ds-modal-*` 骨架自接三个 hook —— 那套只做视觉，不参与 overlay 栈管理。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogPane,
  DialogWorkspace,
  EmptyState,
  IconButton,
  SectionHeader,
  SegmentedControl,
  Surface,
  Switch,
  TextField,
} from '../design-system'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { useCompositeV2Store } from '../features/composite/storeV2'
import ChannelOutputDirs from '../features/postprocess/ChannelOutputDirs'
import NamePatternField from '../features/postprocess/NamePatternField'
import PostprocessDistributionFields from '../features/postprocess/PostprocessDistributionFields'
import ProjectNodeParamsDialog from '../features/projectTree/ProjectNodeParamsDialog'
import ProjectTreeWorkbench from '../features/projectTree/ProjectTreeWorkbench'
import { resolveNodeWatermarkBinding } from '../features/projectTree/params'
import { useProjectTreeParamsStore } from '../features/projectTree/storeProjectTreeParams'
import {
  DEFAULT_POSTPROCESS_NAME_PATTERN,
  findDuplicatedPostprocessNameTokens,
  findMissingPostprocessNameTokens,
  findUnknownPostprocessNameTokens,
} from '../lib/postprocessNaming'
import { PURE_MEDIA_ID, getOutputDirectionLabel, type OutputDirection } from '../lib/postprocessMedia'
import {
  buildPostprocessProjectTree,
  findMissingProjectCollectionIds,
  resolvePostprocessProjectTargets,
  type PostprocessProjectTreeNode,
} from '../lib/postprocessProjectTree'
import { useStore } from '../store'
import {
  buildPostprocessOutputName,
  selectPostprocessOutputPlan,
  usePostprocessMediaStore,
} from '../storePostprocessMedia'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderOpenIcon, SlidersHorizontalIcon } from './icons'

interface Props {
  /** 当前生成尺寸（如 `1024x1024`）；`auto` 或空表示无法预估，预览退化为示例尺寸 */
  sourceSize: string
  onClose: () => void
}

/** 「跟随尺寸」在分段控件里需要一个显式取值，落到 store 时再换算回 `null`。 */
type DirectionValue = 'auto' | OutputDirection

const DIRECTION_OPTIONS: Array<{ value: DirectionValue; label: string }> = [
  { value: 'auto', label: '跟随尺寸' },
  { value: 'landscape', label: '横版' },
  { value: 'portrait', label: '竖版' },
  { value: 'square', label: '方形' },
]

/** 方向不可预知时用于预览的示例尺寸，仅用于展示，不参与落盘。 */
const FALLBACK_PREVIEW_SIZE = { width: 1024, height: 1024 }

/** 水印归属明细默认列几条。启用范围动辄几十个方向，全铺开会把下面的分发给挤没。 */
const BINDING_PREVIEW_LIMIT = 6

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

const chipClass =
  'inline-flex items-center gap-1 rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-1.5 py-0.5 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted'

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

  const toggleSelectedMedia = usePostprocessMediaStore((state) => state.toggleSelectedMedia)
  const setSelectedMediaIds = usePostprocessMediaStore((state) => state.setSelectedMediaIds)
  const toggleSelectedCollection = usePostprocessMediaStore((state) => state.toggleSelectedCollection)
  const setDirection = usePostprocessMediaStore((state) => state.setDirection)
  const setOutputDir = usePostprocessMediaStore((state) => state.setOutputDir)
  const setMediaOutputDir = usePostprocessMediaStore((state) => state.setMediaOutputDir)
  const clearMediaOutputDirs = usePostprocessMediaStore((state) => state.clearMediaOutputDirs)
  const setNamePattern = usePostprocessMediaStore((state) => state.setNamePattern)
  const setCreator = usePostprocessMediaStore((state) => state.setCreator)
  const setAutoCompanionClean = usePostprocessMediaStore((state) => state.setAutoCompanionClean)
  const patchDistribution = usePostprocessMediaStore((state) => state.patchDistribution)

  const showToast = useStore((state) => state.showToast)
  const setAppMode = useStore((state) => state.setAppMode)
  const collections = useAssetLibraryStore((state) => state.collections)
  const presets = useCompositeV2Store((state) => state.presets)
  const params = useProjectTreeParamsStore((state) => state.params)

  const config = useMemo(
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

  /** 预设 id → 展示名：产出预览要按它展开单元数，归属只带 id，也靠它显示成人看得懂的名字。 */
  const presetNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const preset of presets) names[preset.id] = preset.name
    return names
  }, [presets])

  /**
   * 产出目标 = 启用范围内的每个节点，并**带上它归属到的水印**。
   *
   * 归属来自项目树参数层（水印工作区那棵树在改），**逐渠道**解析——同一个方向在
   * 厂商 / 百度 / 头条叠的合规水印本来就不同，拿一份全局列表展开，预览出来的数量
   * 跟实际产出对不上，用户就没法用它确认配置。
   */
  const projectTargets = useMemo(
    () =>
      resolvePostprocessProjectTargets(collections, selectedCollectionIds).map((target) => {
        const byMedia: Record<string, string[]> = {}
        for (const item of media) {
          byMedia[item.id] = resolveNodeWatermarkBinding(
            collections,
            params,
            target.collectionId,
            watermarkPresetIds,
            item.id,
          ).presetIds
        }
        return {
          ...target,
          watermarkPresetIds: resolveNodeWatermarkBinding(collections, params, target.collectionId, watermarkPresetIds)
            .presetIds,
          watermarkPresetIdsByMedia: byMedia,
        }
      }),
    [collections, selectedCollectionIds, params, watermarkPresetIds, media],
  )

  const missingProjectIds = useMemo(
    () => findMissingProjectCollectionIds(collections, selectedCollectionIds),
    [collections, selectedCollectionIds],
  )

  /**
   * 「这个方向会叠哪几套水印」的汇总。
   *
   * 数据源是**归属**，不是水印库全集：列全集只回答了「有哪些水印可买」，
   * 而用户在产出前要确认的是「这批图实际会叠什么」。
   */
  const watermarkBindingRows = useMemo(
    () =>
      projectTargets.map((target) => {
        const ids = target.watermarkPresetIds ?? []
        return {
          collectionId: target.collectionId,
          label: [target.product || target.line, target.direction].filter(Boolean).join(' / ') || target.collectionId,
          names: ids.map((id) => presetNames[id] ?? id),
          missingCount: ids.filter((id) => !presetNames[id]).length,
        }
      }),
    [projectTargets, presetNames],
  )

  /** 树里没单独表态的方向会用这套；它也得有个地方让人看见，否则归属显得凭空少了一块。 */
  const globalWatermarkNames = useMemo(
    () => watermarkPresetIds.map((id) => presetNames[id] ?? id),
    [watermarkPresetIds, presetNames],
  )

  const parsedSource = useMemo(() => parseSourceSize(sourceSize), [sourceSize])
  const previewSource = parsedSource ?? FALLBACK_PREVIEW_SIZE

  const plan = useMemo(
    () => selectPostprocessOutputPlan(config, previewSource, projectTargets, presetNames),
    [config, previewSource, projectTargets, presetNames],
  )

  const nameIssues = useMemo(() => {
    const unknown = findUnknownPostprocessNameTokens(namePattern)
    const missing = findMissingPostprocessNameTokens(namePattern)
    const duplicated = findDuplicatedPostprocessNameTokens(namePattern)
    return { unknown, missing, duplicated }
  }, [namePattern])

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [previewExpanded, setPreviewExpanded] = useState(false)
  /** 水印归属明细是否展开全部方向 */
  const [bindingExpanded, setBindingExpanded] = useState(false)
  /** 左栏点某个节点的「参数」→ 单节点参数弹窗（按 collectionId 存，逐级继承） */
  const [paramTarget, setParamTarget] = useState<string | null>(null)
  /** 左栏「参数表格」→ 完整工作台（结构增删改 + 各节点参数来源一览） */
  const [tableOpen, setTableOpen] = useState(false)

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

  const enabledMedia = media.filter((item) => item.enabled)
  const allMediaSelected = enabledMedia.length > 0 && enabledMedia.every((item) => selectedMediaIds.includes(item.id))

  const previewSourceLabel = parsedSource
    ? `${previewSource.width}x${previewSource.height}`
    : `${previewSource.width}x${previewSource.height}（示例）`

  // 没有项目就没有产出目标：此时 `plan` 会退化成「单个匿名项目」，不能拿来当预览数量
  const previewUnits = projectTargets.length > 0 ? plan.units : []
  const visibleUnits = previewExpanded ? previewUnits : previewUnits.slice(0, 6)

  const visibleBindingRows = bindingExpanded
    ? watermarkBindingRows
    : watermarkBindingRows.slice(0, BINDING_PREVIEW_LIMIT)
  const hasMissingWatermarkPreset = watermarkBindingRows.some((row) => row.missingCount > 0)

  const chooseOutputDir = async () => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) setOutputDir(path)
    } catch {
      showToast('选择输出目录失败，请重试', 'error')
    }
  }

  const renderProjectNode = (node: PostprocessProjectTreeNode, enabledByAncestor = false) => {
    const expanded = expandedIds.has(node.id)
    const indentClass = INDENT_CLASS[Math.min(node.depth, INDENT_CLASS.length - 1)]
    const picked = selectedCollectionIds.includes(node.id)
    // 勾了上级 = 旗下全部启用。子节点必须显示成「已启用但改不动」，
    // 否则界面上看着没勾、实际却在产出，用户没法解释产出是哪来的。
    const enabledInherited = enabledByAncestor && !picked
    return (
      <div key={node.id}>
        <div className={`flex items-center gap-1.5 py-0.5 ${indentClass}`}>
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
          <Checkbox
            checked={picked || enabledByAncestor}
            disabled={enabledInherited}
            title={
              enabledInherited
                ? '由上级启用；要单独关掉这个方向，点右侧「参数」关掉「参与自动后处理」'
                : '勾选 = 启用该分支的自动后处理；勾了上级则旗下全部启用'
            }
            onChange={() => toggleSelectedCollection(node.id)}
            label={node.name}
          />
          {node.depth === 0 && <span className={chipClass}>产品线</span>}
          {node.depth === 1 && <span className={chipClass}>产品</span>}
          {node.depth >= 2 && <span className={chipClass}>方向</span>}
          {/* 节点级参数入口：启用范围与节点参数同属一棵树，入口就该在同一行，
              不该让用户为改参数跑到另一个模块的工具栏里找 */}
          <IconButton
            size="sm"
            className="ml-auto shrink-0"
            aria-label={`设置 ${node.name} 的后处理参数`}
            title="这个节点的后处理参数（继承自上级的会在弹窗里标出来）"
            icon={<SlidersHorizontalIcon className="h-3.5 w-3.5" />}
            onClick={() => setParamTarget(node.id)}
          />
        </div>
        {expanded && node.children.map((child) => renderProjectNode(child, picked || enabledByAncestor))}
      </div>
    )
  }

  const footerStatus =
    projectTargets.length === 0
      ? '未满足启用条件：需同时勾选启用范围与媒体'
      : previewUnits.length === 0
        ? '当前选择产不出变体，请检查媒体与方向'
        : `每张原图产出 ${previewUnits.length} 个文件`

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title="后处理"
        description="勾选项目 = 启用自动后处理的范围（勾了产品线，旗下方向一起启用）。有归属的图片按所在方向的参数自动产出，无需逐张挑选；未勾选的分支只保存原图。"
        className="ds-dialog--postprocess"
        footer={
          <>
            <span className="self-center text-xs text-ds-muted dark:text-ds-muted">{footerStatus}</span>
            <Button onClick={onClose}>完成</Button>
          </>
        }
      >
        <DialogWorkspace layout="split" className="min-h-0 flex-1">
          {/* 左栏：项目树。启用范围可能上百个节点，独占一栏自己滚，不再挤在正文的小框里 */}
          <DialogPane as="aside" tone="sidebar" scroll={false} className="flex flex-col gap-2">
            <SectionHeader
              title="启用范围"
              description="勾了上级则旗下全部启用。目录与文件名里的 {line}/{product}/{direction} 取图片所在方向，与勾选层级无关。"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="postprocess-open-tree-table"
                  title="打开项目树参数总表：结构增删改 + 各节点参数来源一览"
                  onClick={() => setTableOpen(true)}
                >
                  参数表格
                </Button>
              }
            />
            {projectTree.length === 0 ? (
              <EmptyState title="还没有项目文件夹" description="可在左侧栏创建，或到设置里补齐内置项目结构。" />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-ds-lg border border-ds-border/70 bg-ds-surface/40 p-2 custom-scrollbar dark:border-ds-border dark:bg-ds-surface">
                {projectTree.map((node) => renderProjectNode(node))}
              </div>
            )}
            {missingProjectIds.length > 0 && (
              <Alert tone="warning">有 {missingProjectIds.length} 个已勾选的项目不存在或已删除，将被跳过。</Alert>
            )}
          </DialogPane>

          {/* 右栏：方向 / 媒体 / 输出与命名 / 分发 / 产出预览 */}
          <DialogPane tone="content" className="space-y-5">
            <section>
              <SectionHeader title="方向" description="决定每个媒体产出哪些尺寸；跟随尺寸时按原图方向自动匹配。" />
              <SegmentedControl
                aria-label="画面方向"
                className="mt-2"
                value={direction ?? 'auto'}
                options={DIRECTION_OPTIONS}
                onValueChange={(value) => setDirection(value === 'auto' ? null : value)}
              />
            </section>

            <section>
              <SectionHeader
                title="媒体"
                description="纯净版可单独勾选；勾了任一渠道且开启「纯净版自动伴随」时会自动补一份无水印原图。"
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      allMediaSelected
                        ? setSelectedMediaIds([PURE_MEDIA_ID])
                        : setSelectedMediaIds([...enabledMedia.map((item) => item.id), PURE_MEDIA_ID])
                    }
                  >
                    {allMediaSelected ? '仅保留纯净版' : '全选'}
                  </Button>
                }
              />
              <div className="mt-2 space-y-1.5">
                {media.length === 0 && <EmptyState title="媒体表为空" description="请在后续版本里添加渠道规格。" />}
                {media.map((item) => {
                  const checked = selectedMediaIds.includes(item.id)
                  return (
                    <Surface
                      key={item.id}
                      tone="subtle"
                      className={item.enabled ? 'px-3 py-2' : 'px-3 py-2 opacity-60'}
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={checked}
                          disabled={!item.enabled}
                          onChange={() => toggleSelectedMedia(item.id)}
                          label={item.name}
                        />
                        {!item.enabled && <span className={chipClass}>已停用</span>}
                        <span className="ml-auto text-xs text-ds-muted dark:text-ds-muted">
                          {item.sizes.filter((size) => size.enabled).length} 个尺寸
                        </span>
                      </div>
                      {item.sizes.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                          {item.sizes.map((size) => (
                            <span
                              key={size.id}
                              className={`${chipClass} ${size.enabled ? '' : 'line-through opacity-60'}`}
                            >
                              {size.width}x{size.height}
                              <span className="text-ds-muted dark:text-ds-muted">
                                {size.maxSizeKb > 0 ? `≤${size.maxSizeKb}KB` : '不压缩'}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </Surface>
                  )
                })}
              </div>
              {plan.skippedMediaIds.length > 0 && (
                <Alert tone="warning" className="mt-1.5">
                  有 {plan.skippedMediaIds.length} 个媒体已不存在，将被跳过（不会静默改产出别的渠道）。
                </Alert>
              )}
            </section>

            <section>
              <SectionHeader
                title="输出与命名"
                description="只作用于后处理产物。水印预设只提供图层，不参与输出位置与命名。位置与模板都可以逐渠道单独设，项目方向还能再覆盖一层。"
              />
              <div className="mt-2 space-y-3">
                <div className="flex items-end gap-2">
                  <TextField
                    label="默认输出目录"
                    containerClassName="min-w-0 flex-1"
                    value={outputDir}
                    onChange={(event) => setOutputDir(event.target.value)}
                    placeholder="留空则输出到本地保存目录的 postprocess 文件夹"
                  />
                  <Button
                    variant="secondary"
                    leadingIcon={<FolderOpenIcon className="h-3.5 w-3.5" />}
                    onClick={() => void chooseOutputDir()}
                  >
                    浏览
                  </Button>
                </div>

                <div className="mt-1">
                  <ChannelOutputDirs
                    media={media}
                    resolveDirs={(mediaId) => mediaOutputDirs[mediaId] ?? []}
                    resolveInheritedHint={() => outputDir.trim()}
                    onChangeDir={setMediaOutputDir}
                    onClearDirs={clearMediaOutputDirs}
                    onPickError={() => showToast('选择导出位置失败，请重试', 'error')}
                  />
                </div>

                <div>
                  <NamePatternField
                    value={namePattern}
                    onChange={setNamePattern}
                    placeholder={DEFAULT_POSTPROCESS_NAME_PATTERN}
                    trailing={
                      <Button variant="secondary" onClick={() => setNamePattern(DEFAULT_POSTPROCESS_NAME_PATTERN)}>
                        恢复默认
                      </Button>
                    }
                  />
                  {nameIssues.unknown.length > 0 && (
                    <Alert tone="warning" className="mt-1.5">
                      未知占位符：{nameIssues.unknown.map((token) => `{${token}}`).join('、')}（会原样保留在文件名里）
                    </Alert>
                  )}
                  {nameIssues.missing.length > 0 && (
                    <Alert tone="warning" className="mt-1.5">
                      缺少 {nameIssues.missing.map((token) => `{${token}}`).join('、')}：同批次产物可能互相覆盖。
                    </Alert>
                  )}
                  {nameIssues.duplicated.length > 0 && (
                    <Alert tone="info" className="mt-1.5">
                      重复占位符：{nameIssues.duplicated.map((token) => `{${token}}`).join('、')}
                    </Alert>
                  )}
                </div>

                <TextField
                  label="创作者"
                  value={creator}
                  onChange={(event) => setCreator(event.target.value)}
                  placeholder="供 {creator} 使用"
                />

                <Switch
                  label="纯净版自动伴随"
                  description="勾了任一渠道媒体时，额外多产一份无水印原图。"
                  checked={autoCompanionClean}
                  onCheckedChange={setAutoCompanionClean}
                />
              </div>
            </section>

            {/* 水印归属：列的是**实际会叠的**，不是水印库里有哪些。
                这里曾经是一排「把整个水印库列出来勾选」的框，于是归属有了两个来源
                （树里按方向 → 这里按整批），同一个方向到底叠什么得两处对着看才能说清。 */}
            <section>
              <SectionHeader
                title="水印归属"
                description={`按图片所在方向自动取用，在「水印归属」树里改。树里没单独表态的方向跟随全局默认${
                  globalWatermarkNames.length > 0 ? `（${globalWatermarkNames.join('、')}）` : '（当前为空 = 不加水印）'
                }。`}
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="postprocess-open-watermark-binding"
                    title="打开水印预设工作区：编辑水印图层，并设置各方向的归属"
                    onClick={() => {
                      onClose()
                      setAppMode('postprocess')
                    }}
                  >
                    设置水印归属
                  </Button>
                }
              />
              {watermarkBindingRows.length === 0 ? (
                <EmptyState
                  className="mt-2"
                  title="勾选启用范围后，这里显示各方向实际会叠的水印。"
                  description={presets.length === 0 ? '水印库里还没有预设。' : undefined}
                />
              ) : (
                <ul className="mt-2 space-y-1">
                  {visibleBindingRows.map((row) => (
                    <li
                      key={row.collectionId}
                      className="flex items-center gap-2 rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-1.5 text-xs dark:border-ds-border dark:bg-ds-surface"
                    >
                      <span className="min-w-0 flex-1 truncate text-ds-text dark:text-ds-text-subtle" title={row.label}>
                        {row.label}
                      </span>
                      <span className="shrink-0 text-ds-muted dark:text-ds-muted">
                        {row.names.length > 0 ? row.names.join('、') : '不加水印'}
                      </span>
                      {row.missingCount > 0 && (
                        <span className="shrink-0 rounded-ds-lg border border-ds-danger/40 bg-ds-danger-subtle px-1.5 py-0.5 text-ds-danger">
                          已失效 {row.missingCount}
                        </span>
                      )}
                    </li>
                  ))}
                  {watermarkBindingRows.length > BINDING_PREVIEW_LIMIT && (
                    <li>
                      <Button variant="ghost" size="sm" onClick={() => setBindingExpanded((value) => !value)}>
                        {bindingExpanded ? '收起' : `展开全部 ${watermarkBindingRows.length} 条`}
                      </Button>
                    </li>
                  )}
                </ul>
              )}
              {hasMissingWatermarkPreset && (
                <Alert tone="warning" className="mt-1.5">
                  有方向引用的水印预设已不存在，归属它的图片会整批跳过——不静默降级成无水印，避免交付错的投放素材。
                </Alert>
              )}
            </section>

            <section>
              <SectionHeader title="分发" description="产物写盘后的排期：按天平均分配到日期文件夹，供投放使用。" />
              <div className="mt-2">
                <PostprocessDistributionFields
                  config={distribution}
                  onChange={patchDistribution}
                  onPickError={() => showToast('选择分发目录失败，请重试', 'error')}
                />
              </div>
            </section>

            <section>
              <SectionHeader
                title="产出预览"
                description={`按 ${previewSourceLabel}：${projectTargets.length} 个启用节点，共 ${previewUnits.length} 个变体。实际产出按图片所在方向取名，这里只是按勾选层级预估。 统一输出 JPEG；比例与生成尺寸不一致时等比放大裁切填满，不拉伸、不留白边。`}
                actions={
                  previewUnits.length > 6 ? (
                    <Button variant="ghost" size="sm" onClick={() => setPreviewExpanded((value) => !value)}>
                      {previewExpanded ? '收起' : `展开全部 ${previewUnits.length} 条`}
                    </Button>
                  ) : undefined
                }
              />
              {previewUnits.length === 0 ? (
                <EmptyState
                  className="mt-2"
                  title={projectTargets.length === 0 ? '勾选启用范围与媒体后显示产出清单。' : '当前选择产不出任何变体'}
                  description={projectTargets.length === 0 ? undefined : '请检查媒体与方向。'}
                />
              ) : (
                <ul className="mt-2 space-y-1">
                  {visibleUnits.map((unit, index) => {
                    const fileName = buildPostprocessOutputName(config, unit, unit.project ?? {}, index + 1)
                    return (
                      <li
                        key={`${unit.project?.collectionId ?? 'none'}-${unit.sizeId}-${index}`}
                        className="flex items-center gap-2 rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-1.5 text-xs dark:border-ds-border dark:bg-ds-surface"
                      >
                        <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ds-muted" />
                        <span className="shrink-0 text-ds-muted dark:text-ds-muted">
                          {unit.project ? `${unit.project.product || unit.project.line}/` : ''}
                        </span>
                        <span className="shrink-0 text-ds-text dark:text-ds-text-subtle">
                          {unit.clean ? '纯净版' : unit.mediaName}
                        </span>
                        <span className="shrink-0 text-ds-muted dark:text-ds-muted">
                          {unit.width}x{unit.height} · {getOutputDirectionLabel(unit.direction)}
                        </span>
                        <span className="ml-auto truncate font-mono text-ds-muted dark:text-ds-muted" title={fileName}>
                          {fileName}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </DialogPane>
        </DialogWorkspace>
      </Dialog>

      {/* 两个子弹窗挂在父弹窗之外（与项目树工作台同一做法）：overlay 栈只让最上层响应 ESC */}
      {tableOpen && <ProjectTreeWorkbench onClose={() => setTableOpen(false)} />}
      {paramTarget && <ProjectNodeParamsDialog collectionId={paramTarget} onClose={() => setParamTarget(null)} />}
    </>
  )
}
