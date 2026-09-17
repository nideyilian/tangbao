/**
 * 后处理设置面板（对应瀚灵的 `Nu()` 面板）。
 *
 * 只负责「编排」：勾项目 → 选方向 → 勾媒体 → 定输出与命名，并实时预览会产出哪些变体。
 * 实际的尺寸压缩与水印叠加在输出链路里做（阶段四），面板不碰图片。
 *
 * 所有配置即时写入 `usePostprocessMediaStore`（它自己持久化），没有「保存/取消」的草稿态。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Checkbox, useDialogFocusTrap } from '../design-system'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { useCompositeV2Store } from '../features/composite/storeV2'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import {
  DEFAULT_POSTPROCESS_NAME_PATTERN,
  POSTPROCESS_NAME_TOKENS,
  POSTPROCESS_NAME_TOKEN_LABELS,
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
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, FolderOpenIcon } from './icons'
import Select from './Select'

interface Props {
  /** 当前生成尺寸（如 `1024x1024`）；`auto` 或空表示无法预估，预览退化为示例尺寸 */
  sourceSize: string
  onClose: () => void
}

const DIRECTION_OPTIONS: { value: OutputDirection | null; label: string }[] = [
  { value: null, label: '跟随尺寸' },
  { value: 'landscape', label: '横版' },
  { value: 'portrait', label: '竖版' },
  { value: 'square', label: '方形' },
]

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

const chipClass =
  'inline-flex items-center gap-1 rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-1.5 py-0.5 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted'
const sectionTitleClass = 'text-sm font-medium text-ds-text dark:text-ds-text-subtle'
const sectionHintClass = 'mt-0.5 text-xs leading-relaxed text-ds-muted dark:text-ds-muted'
const fieldLabelClass = 'mb-1.5 block text-xs text-ds-muted dark:text-ds-muted'
const inputClass =
  'w-full rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-xs text-ds-text outline-none transition-colors focus:border-ds-primary/35 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle dark:focus:border-ds-primary/50'
const toggleButtonClass = (active: boolean) =>
  `shrink-0 rounded-ds-lg border px-3 py-1.5 text-xs transition-colors ${
    active
      ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:border-ds-primary/50 dark:bg-ds-primary/10 dark:text-ds-primary'
      : 'border-ds-border/70 bg-ds-surface/60 text-ds-muted hover:bg-ds-subtle dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted dark:hover:bg-ds-surface'
  }`

export default function PostprocessSettingsModal({ sourceSize, onClose }: Props) {
  usePreventBackgroundScroll(true)
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  useDialogFocusTrap(true, modalRef)
  const mouseDownTargetRef = useRef<EventTarget | null>(null)

  const media = usePostprocessMediaStore((state) => state.media)
  const selectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const selectedCollectionIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
  const direction = usePostprocessMediaStore((state) => state.direction)
  const outputDir = usePostprocessMediaStore((state) => state.outputDir)
  const namePattern = usePostprocessMediaStore((state) => state.namePattern)
  const creator = usePostprocessMediaStore((state) => state.creator)
  const watermarkPresetId = usePostprocessMediaStore((state) => state.watermarkPresetId)
  const autoCompanionClean = usePostprocessMediaStore((state) => state.autoCompanionClean)

  const toggleSelectedMedia = usePostprocessMediaStore((state) => state.toggleSelectedMedia)
  const setSelectedMediaIds = usePostprocessMediaStore((state) => state.setSelectedMediaIds)
  const toggleSelectedCollection = usePostprocessMediaStore((state) => state.toggleSelectedCollection)
  const setDirection = usePostprocessMediaStore((state) => state.setDirection)
  const setOutputDir = usePostprocessMediaStore((state) => state.setOutputDir)
  const setNamePattern = usePostprocessMediaStore((state) => state.setNamePattern)
  const setCreator = usePostprocessMediaStore((state) => state.setCreator)
  const setWatermarkPresetId = usePostprocessMediaStore((state) => state.setWatermarkPresetId)
  const setAutoCompanionClean = usePostprocessMediaStore((state) => state.setAutoCompanionClean)

  const showToast = useStore((state) => state.showToast)
  const collections = useAssetLibraryStore((state) => state.collections)
  const presets = useCompositeV2Store((state) => state.presets)

  const config = useMemo(
    () => ({
      media,
      selectedMediaIds,
      selectedCollectionIds,
      direction,
      outputDir,
      namePattern,
      creator,
      watermarkPresetId,
      autoCompanionClean,
    }),
    [
      media,
      selectedMediaIds,
      selectedCollectionIds,
      direction,
      outputDir,
      namePattern,
      creator,
      watermarkPresetId,
      autoCompanionClean,
    ],
  )

  const projectTree = useMemo(() => buildPostprocessProjectTree(collections), [collections])
  const projectTargets = useMemo(
    () => resolvePostprocessProjectTargets(collections, selectedCollectionIds),
    [collections, selectedCollectionIds],
  )
  const missingProjectIds = useMemo(
    () => findMissingProjectCollectionIds(collections, selectedCollectionIds),
    [collections, selectedCollectionIds],
  )

  const parsedSource = useMemo(() => parseSourceSize(sourceSize), [sourceSize])
  const previewSource = parsedSource ?? FALLBACK_PREVIEW_SIZE

  const plan = useMemo(
    () => selectPostprocessOutputPlan(config, previewSource, projectTargets),
    [config, previewSource, projectTargets],
  )

  const nameIssues = useMemo(() => {
    const unknown = findUnknownPostprocessNameTokens(namePattern)
    const missing = findMissingPostprocessNameTokens(namePattern)
    const duplicated = findDuplicatedPostprocessNameTokens(namePattern)
    return { unknown, missing, duplicated }
  }, [namePattern])

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [previewExpanded, setPreviewExpanded] = useState(false)

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

  const handleMouseDown = (event: React.MouseEvent) => {
    mouseDownTargetRef.current = event.target
  }
  const handleMouseUp = (event: React.MouseEvent) => {
    const downTarget = mouseDownTargetRef.current
    const upTarget = event.target
    if (
      modalRef.current &&
      downTarget &&
      !modalRef.current.contains(downTarget as Node) &&
      upTarget &&
      !modalRef.current.contains(upTarget as Node)
    ) {
      onClose()
    }
    mouseDownTargetRef.current = null
  }

  const chooseOutputDir = async () => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) setOutputDir(path)
    } catch {
      showToast('选择输出目录失败，请重试', 'error')
    }
  }

  const renderProjectNode = (node: PostprocessProjectTreeNode) => {
    const expanded = expandedIds.has(node.id)
    const indentClass = INDENT_CLASS[Math.min(node.depth, INDENT_CLASS.length - 1)]
    return (
      <div key={node.id}>
        <div className={`flex items-center gap-1.5 py-0.5 ${indentClass}`}>
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleExpanded(node.id)}
              aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
              aria-expanded={expanded}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text dark:hover:bg-ds-surface"
            >
              {expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          <Checkbox
            checked={selectedCollectionIds.includes(node.id)}
            onChange={() => toggleSelectedCollection(node.id)}
            label={node.name}
          />
          {node.depth === 0 && <span className={chipClass}>产品线</span>}
          {node.depth === 1 && <span className={chipClass}>产品</span>}
          {node.depth >= 2 && <span className={chipClass}>方向</span>}
        </div>
        {expanded && node.children.map((child) => renderProjectNode(child))}
      </div>
    )
  }

  return (
    <div
      data-no-drag-select
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="postprocess-settings-title"
        className="ds-modal-surface relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-ds-xl border p-5 animate-modal-in motion-reduce:animate-none"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="postprocess-settings-title" className={sectionTitleClass}>
              后处理
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ds-muted dark:text-ds-muted">
              同时选择项目与媒体后启用。沿用对应水印、尺寸和命名，保留未处理原图以供下一轮修改。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-1 text-ds-muted transition-colors hover:bg-ds-subtle hover:text-ds-text dark:hover:bg-ds-surface dark:hover:text-ds-text"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 custom-scrollbar">
          <section>
            <div className="mb-2">
              <div className={sectionTitleClass}>项目</div>
              <p className={sectionHintClass}>勾选到哪一级，命名里就带哪一级：勾产品线只带产品线，勾方向则三层都带。</p>
            </div>
            {projectTree.length === 0 ? (
              <div className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface">
                还没有项目文件夹。可在左侧栏创建，或到设置里补齐内置项目结构。
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-ds-lg border border-ds-border/70 bg-ds-surface/40 p-2 custom-scrollbar dark:border-ds-border dark:bg-ds-surface">
                {projectTree.map((node) => renderProjectNode(node))}
              </div>
            )}
            {missingProjectIds.length > 0 && (
              <p className="mt-1.5 text-xs text-ds-warning dark:text-ds-warning">
                有 {missingProjectIds.length} 个已勾选的项目不存在或已删除，将被跳过。
              </p>
            )}
          </section>

          <section>
            <div className="mb-2">
              <div className={sectionTitleClass}>方向</div>
              <p className={sectionHintClass}>决定每个媒体产出哪些尺寸；跟随尺寸时按原图方向自动匹配。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {DIRECTION_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setDirection(option.value)}
                  className={toggleButtonClass(direction === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={sectionTitleClass}>媒体</div>
                <p className={sectionHintClass}>
                  纯净版可单独勾选；勾了任一渠道且开启「纯净版自动伴随」时会自动补一份无水印原图。
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  allMediaSelected
                    ? setSelectedMediaIds([PURE_MEDIA_ID])
                    : setSelectedMediaIds([...enabledMedia.map((item) => item.id), PURE_MEDIA_ID])
                }
                className={toggleButtonClass(allMediaSelected)}
              >
                {allMediaSelected ? '仅保留纯净版' : '全选'}
              </button>
            </div>
            <div className="space-y-1.5">
              {media.length === 0 && (
                <div className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface">
                  媒体表为空，请在后续版本里添加渠道规格。
                </div>
              )}
              {media.map((item) => {
                const checked = selectedMediaIds.includes(item.id)
                return (
                  <div
                    key={item.id}
                    className={`rounded-ds-lg border px-3 py-2 transition-colors ${
                      item.enabled
                        ? 'border-ds-border/70 bg-ds-surface/60 dark:border-ds-border dark:bg-ds-surface'
                        : 'border-ds-border/60 bg-ds-surface/40 opacity-60 dark:border-ds-border dark:bg-ds-surface'
                    }`}
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
                  </div>
                )
              })}
            </div>
            {plan.skippedMediaIds.length > 0 && (
              <p className="mt-1.5 text-xs text-ds-warning dark:text-ds-warning">
                有 {plan.skippedMediaIds.length} 个媒体已不存在，将被跳过（不会静默改产出别的渠道）。
              </p>
            )}
          </section>

          <section>
            <div className="mb-2">
              <div className={sectionTitleClass}>输出与命名</div>
              <p className={sectionHintClass}>
                这里的输出位置与命名模板只作用于后处理产物，优先于水印预设里的同名设置。
              </p>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className={fieldLabelClass}>输出目录</span>
                <div className="flex items-center gap-2">
                  <input
                    value={outputDir}
                    onChange={(event) => setOutputDir(event.target.value)}
                    placeholder="留空则输出到本地保存目录的 postprocess 文件夹"
                    className={inputClass}
                  />
                  <button type="button" onClick={() => void chooseOutputDir()} className={toggleButtonClass(false)}>
                    <span className="flex items-center gap-1">
                      <FolderOpenIcon className="h-3.5 w-3.5" />
                      浏览
                    </span>
                  </button>
                </div>
              </label>

              <div>
                <span className={fieldLabelClass}>命名模板</span>
                <div className="flex items-center gap-2">
                  <input
                    value={namePattern}
                    onChange={(event) => setNamePattern(event.target.value)}
                    placeholder={DEFAULT_POSTPROCESS_NAME_PATTERN}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setNamePattern(DEFAULT_POSTPROCESS_NAME_PATTERN)}
                    className={toggleButtonClass(false)}
                  >
                    恢复默认
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {POSTPROCESS_NAME_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      title={`插入 ${POSTPROCESS_NAME_TOKEN_LABELS[token]}`}
                      onClick={() => setNamePattern(`${namePattern}{${token}}`)}
                      className={chipClass}
                    >
                      {`{${token}}`}
                    </button>
                  ))}
                </div>
                {nameIssues.unknown.length > 0 && (
                  <p className="mt-1.5 text-xs text-ds-warning dark:text-ds-warning">
                    未知占位符：{nameIssues.unknown.map((token) => `{${token}}`).join('、')}（会原样保留在文件名里）
                  </p>
                )}
                {nameIssues.missing.length > 0 && (
                  <p className="mt-1.5 text-xs text-ds-warning dark:text-ds-warning">
                    缺少 {nameIssues.missing.map((token) => `{${token}}`).join('、')}：同批次产物可能互相覆盖。
                  </p>
                )}
                {nameIssues.duplicated.length > 0 && (
                  <p className="mt-1.5 text-xs text-ds-muted dark:text-ds-muted">
                    重复占位符：{nameIssues.duplicated.map((token) => `{${token}}`).join('、')}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="min-w-0">
                  <span className={fieldLabelClass}>创作者</span>
                  <input
                    value={creator}
                    onChange={(event) => setCreator(event.target.value)}
                    placeholder="供 {creator} 使用"
                    className={inputClass}
                  />
                </label>
                <label className="min-w-0">
                  <span className={fieldLabelClass}>水印预设</span>
                  <Select
                    value={watermarkPresetId ?? ''}
                    onChange={(value) => setWatermarkPresetId(typeof value === 'string' && value ? value : null)}
                    options={[
                      { label: '不加水印', value: '' },
                      ...presets.map((preset) => ({ label: preset.name, value: preset.id })),
                    ]}
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-ds-text dark:text-ds-text-subtle">纯净版自动伴随</div>
                  <p className={sectionHintClass}>勾了任一渠道媒体时，额外多产一份无水印原图。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoCompanionClean(!autoCompanionClean)}
                  className={toggleButtonClass(autoCompanionClean)}
                >
                  {autoCompanionClean ? '开启' : '关闭'}
                </button>
              </div>
              {watermarkPresetId && !presets.some((preset) => preset.id === watermarkPresetId) && (
                <p className="text-xs text-ds-warning dark:text-ds-warning">
                  引用的水印预设已不存在，产出时会跳过水印叠加。
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={sectionTitleClass}>产出预览</div>
                <p className={sectionHintClass}>
                  按 {previewSourceLabel}：{projectTargets.length} 个项目，共 {previewUnits.length} 个变体。 统一输出
                  JPEG；比例与生成尺寸不一致时等比放大裁切填满，不拉伸、不留白边。
                </p>
              </div>
              {previewUnits.length > 6 && (
                <button
                  type="button"
                  onClick={() => setPreviewExpanded((value) => !value)}
                  className={toggleButtonClass(false)}
                >
                  {previewExpanded ? '收起' : `展开全部 ${previewUnits.length} 条`}
                </button>
              )}
            </div>
            {previewUnits.length === 0 ? (
              <div className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-3 py-2 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface">
                {projectTargets.length === 0
                  ? '选择项目与媒体后显示产出清单。'
                  : '当前选择产不出任何变体，请检查媒体与方向。'}
              </div>
            ) : (
              <ul className="space-y-1">
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
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-ds-muted dark:text-ds-muted">
            {projectTargets.length === 0
              ? '未满足启用条件：需同时选择项目与媒体'
              : previewUnits.length === 0
                ? '当前选择产不出变体，请检查媒体与方向'
                : `每张原图产出 ${previewUnits.length} 个文件`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-ds-lg bg-ds-primary px-4 py-2 text-sm font-medium text-ds-text-inverse transition-colors hover:bg-ds-primary-hover"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
