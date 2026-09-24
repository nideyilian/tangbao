import { memo, useEffect, useState, type MouseEvent } from 'react'
import {
  BookmarkIcon as Bookmark,
  BookOpenCheckIcon as BookOpenCheck,
  EyeIcon as Eye,
  ImageIcon,
  LoaderCircleIcon as LoaderCircle,
  RefreshIcon as RefreshCw,
  TrashIcon as Trash2,
} from '../design-system/icons'
import type { TaskRecord, TaskStatus } from '../types'
import { formatSopBatchElapsed, getSopBatchElapsedMs, type SopBatchSummary } from '../lib/sopBatchTaskGrouping'
import { hasCompletedTaskOutputCount } from '../lib/taskProgressDisplay'
import { Card, IconButton } from '../design-system'
import TaskParamSummary from './TaskParamSummary'
import { useCoverThumbnail } from '../hooks/useCoverThumbnail'

function BatchCover({
  imageId,
  imageIds,
  isRunning,
  isFailed,
  onOpenImage,
}: {
  imageId: string
  imageIds: string[]
  isRunning: boolean
  isFailed: boolean
  onOpenImage: (imageId: string) => void
}) {
  const { src, lost } = useCoverThumbnail(imageId)

  if (imageId) {
    return (
      <button
        type="button"
        data-no-drag-select
        className="h-full w-full"
        aria-label="查看 SOP 批量任务封面图片"
        onClick={(event) => {
          event.stopPropagation()
          onOpenImage(imageId)
        }}
      >
        {src ? (
          <img
            src={src}
            data-image-id={imageId}
            data-output-image-ids={imageIds.join(',')}
            alt="SOP 批量任务生成结果"
            className="saveable-image h-full w-full object-cover"
          />
        ) : lost ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-ds-muted/10">
            <ImageIcon size={22} className="gallery-placeholder-icon" />
            <span className="text-xs text-ds-muted">图片已丢失</span>
          </span>
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <ImageIcon size={30} className="gallery-placeholder-icon" />
          </span>
        )}
      </button>
    )
  }

  if (isRunning) {
    return (
      <div className="flex flex-col items-center gap-2">
        <LoaderCircle
          size={30}
          className="gallery-state-icon gallery-state-icon--info animate-spin motion-reduce:animate-none"
        />
        <span className="gallery-task-meta text-xs">生成中</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <ImageIcon size={30} className={isFailed ? 'gallery-state-icon--danger' : 'gallery-placeholder-icon'} />
      <span className={`text-xs ${isFailed ? 'gallery-state-text--danger' : 'gallery-task-meta'}`}>
        {isFailed ? '生成失败' : '暂无图片'}
      </span>
    </div>
  )
}

function SopBatchTaskCard({
  sopName,
  tasks,
  summary,
  isSelected = false,
  onClick,
  onOpenBatch,
  onOpenImage,
  onRerun,
  onDelete,
  onSaveAsStrategyCard,
  saveAsStrategyCardDisabledReason,
  outputImagesByTask,
}: {
  sopName: string
  tasks: TaskRecord[]
  summary: SopBatchSummary
  isSelected?: boolean
  onClick: (event: MouseEvent<HTMLElement>) => void
  onOpenBatch: () => void
  onOpenImage: (imageId: string) => void
  /** 返回 promise 时按钮在受理期间显示进行中并挡住连点（见 `rerunBatch`）。 */
  onRerun: () => void | Promise<void>
  onDelete: () => void
  /** 把这一批用的 SOP 存成策略卡（供「每日生成」按比例抽取）。缺省则不显示该按钮。 */
  onSaveAsStrategyCard?: () => void
  /** 有值 = 不能存（按钮置灰并把原因写在 title 上，不让用户「点了没反应」）。 */
  saveAsStrategyCardDisabledReason?: string
  outputImagesByTask?: ReadonlyMap<string, string[]>
}) {
  const [now, setNow] = useState(Date.now())
  /**
   * 「再次生成」的受理中状态（2026-09-24）。
   *
   * 按钮的 `disabled` 只绑这个，**不绑任务是否还在跑**：点击的语义是把这一批需求交出去，
   * 交完就该恢复可点，好让用户接着开下一轮。原先绑 `isRunning` 时，用户得为一批
   * 已经丢到后台的活儿干等几分钟，还点不动。防重复受理由 `rerunSopBatchTasks` 的
   * 受理闸兜底（同一批重复受理会被挡住并提示），这里只管按钮自己的视觉状态。
   */
  const [rerunPending, setRerunPending] = useState(false)
  const rerunBatch = () => {
    if (rerunPending) return
    setRerunPending(true)
    Promise.resolve(onRerun()).finally(() => setRerunPending(false))
  }
  const getTaskOutputImageIds = (task: TaskRecord) => {
    return Array.from(
      new Set([...(outputImagesByTask?.get(task.id) ?? []), ...(task.outputImages ?? []).filter(Boolean)]),
    )
  }
  const outputImageIds = tasks.flatMap(getTaskOutputImageIds)
  const imageTotal = tasks.reduce(
    (total, task) =>
      total + Math.max(task.sopBatch?.imagesPerPrompt ?? task.params?.n ?? 1, getTaskOutputImageIds(task).length),
    0,
  )
  const imageCompleted = outputImageIds.length
  const promptTarget = Math.max(summary.total, ...tasks.map((task) => task.sopBatch?.promptCount ?? 0))
  const isRunning = tasks.some(
    (task) =>
      task.status === 'running' ||
      ((task.falRecoverable || task.customRecoverable) &&
        !hasCompletedTaskOutputCount(task, getTaskOutputImageIds(task).length)),
  )
  const failedCount = tasks.filter(
    (task) => task.status === 'error' && !hasCompletedTaskOutputCount(task, getTaskOutputImageIds(task).length),
  ).length
  const isFailed = tasks.length > 0 && failedCount === tasks.length
  const cardStatus: TaskStatus = isRunning ? 'running' : isFailed ? 'error' : 'done'
  // 整批都还没开跑（全在写提示词）、或整批都倒在写提示词上时，卡上得说清是哪一段：
  // 一律说「生成中 / 生成失败」，前者会让人以为图已经在出，后者会让人去查生图接口。
  const isPrompting = tasks.length > 0 && tasks.every((task) => task.promptPending)
  const isPromptFailed = tasks.length > 0 && tasks.every((task) => task.promptFailed)
  const status = isPrompting
    ? '编写提示词中'
    : isPromptFailed
      ? '提示词失败'
      : isRunning
        ? '生成中'
        : isFailed
          ? '生成失败'
          : failedCount > 0
            ? '部分完成'
            : '已完成'
  const representativeTask = tasks[0]
  const elapsed = formatSopBatchElapsed(getSopBatchElapsedMs(tasks, now))

  useEffect(() => {
    if (!isRunning) return
    setNow(Date.now())
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [isRunning])

  return (
    <div className="gallery-card-shell relative rounded-ds-lg">
      <Card
        onClick={onClick}
        data-selected={isSelected || undefined}
        data-status={cardStatus}
        className="gallery-task-card gallery-sop-card relative cursor-pointer overflow-hidden transition-[box-shadow,border-color,background-color,transform]"
      >
        {isSelected && (
          <span
            aria-hidden="true"
            className="gallery-selection-check absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center text-xs font-bold"
          >
            ✓
          </span>
        )}
        <div className="flex h-44">
          <div className="gallery-task-media relative flex h-full w-40 min-w-[10rem] shrink-0 items-center justify-center overflow-hidden">
            <BatchCover
              imageId={outputImageIds[0] ?? ''}
              imageIds={outputImageIds}
              isRunning={isRunning}
              isFailed={isFailed}
              onOpenImage={onOpenImage}
            />
            <span className="absolute left-1.5 top-1.5 flex items-center rounded bg-black/50 px-1.5 py-0.5 font-mono text-xs text-white backdrop-blur-sm sm:text-xs">
              {elapsed}
            </span>
            {imageTotal > 0 && (
              <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                {imageCompleted}/{imageTotal}
              </span>
            )}
          </div>

          <div className="gallery-task-body flex min-w-0 flex-1 flex-col p-3">
            <div className="gallery-sop-inline mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">
                <BookOpenCheck size={13} className="mr-1 inline" />
                SOP · {sopName}
              </span>
              <span className="shrink-0 tabular-nums">
                {summary.total}/{promptTarget}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <h3 className="gallery-task-prompt truncate text-sm font-medium">{status}</h3>
              <p className="gallery-task-meta mt-1 line-clamp-2 text-xs leading-relaxed">
                整批 {promptTarget} 条提示词 · 图片 {imageCompleted}/{imageTotal} · 耗时 {elapsed}
                {summary.running ? ` · 生成中 ${summary.running}` : ''}
                {failedCount ? ` · 失败 ${failedCount}` : ''}
              </p>
            </div>
            {representativeTask && (
              <TaskParamSummary task={representativeTask} className="hide-scrollbar mask-edge-r pr-2" />
            )}
            <div
              data-no-drag-select
              aria-label="SOP 批量任务操作"
              className="gallery-task-actions ml-auto mt-0.5 flex max-w-full shrink-0 items-center gap-1 overflow-x-auto hide-scrollbar mask-edge-r pr-2"
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                type="button"
                onClick={onOpenBatch}
                aria-label={`查看 SOP 批量任务 ${sopName}`}
                title="查看批次"
                className="gallery-task-action gallery-task-action--primary"
                size="sm"
                icon={<Eye size={16} />}
              />
              <IconButton
                type="button"
                onClick={rerunBatch}
                aria-label={`再次生成 SOP 批量任务 ${sopName}`}
                aria-busy={rerunPending}
                title={rerunPending ? '正在受理这一批…' : '再次生成'}
                disabled={rerunPending}
                className="gallery-task-action gallery-task-action--primary"
                size="sm"
                icon={
                  rerunPending ? (
                    <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <RefreshCw size={16} />
                  )
                }
              />
              {onSaveAsStrategyCard && (
                <IconButton
                  type="button"
                  onClick={onSaveAsStrategyCard}
                  aria-label={`把 ${sopName} 存为策略卡`}
                  title={saveAsStrategyCardDisabledReason ?? '存为策略卡（供「每日生成」按比例抽取）'}
                  disabled={Boolean(saveAsStrategyCardDisabledReason)}
                  className="gallery-task-action gallery-task-action--primary"
                  size="sm"
                  icon={<Bookmark size={16} />}
                />
              )}
              <IconButton
                type="button"
                onClick={onDelete}
                aria-label={`删除 SOP 批量任务 ${sopName}`}
                title="删除批次"
                className="gallery-task-action gallery-task-action--danger"
                size="sm"
                icon={<Trash2 size={16} />}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default memo(
  SopBatchTaskCard,
  (previous, next) =>
    previous.sopName === next.sopName &&
    previous.tasks === next.tasks &&
    previous.summary === next.summary &&
    previous.isSelected === next.isSelected &&
    previous.onSaveAsStrategyCard === next.onSaveAsStrategyCard &&
    previous.saveAsStrategyCardDisabledReason === next.saveAsStrategyCardDisabledReason &&
    previous.outputImagesByTask === next.outputImagesByTask,
)
