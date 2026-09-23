/**
 * 后处理进度面板：正在跑的那一次 + 最近几次运行记录。
 *
 * 为什么需要它：TB-069 把进度落成了「素材库工具栏上的一行文本」与任务卡上的小徽章 ——
 * 那行文本只在**素材库视图、且工具栏在视野里**时才存在。用户在画廊或中控台里批量出图时，
 * 后台自动后处理跑了多少、跑到哪、成了没，界面没有任何答复（2026-09-21 报障
 * 「真正的处理进度弹窗为什么没有实现，我要从哪里查看进度」）。
 *
 * 与 toast 的分工：toast 是「刚发生」的一次性播报，几秒即逝且**是单槽**（连发互相顶掉）；
 * 这里是**可查询的常驻记录**，主动打开就能看到全量（会话内最近 `POSTPROCESS_RUN_KEEP` 条）。
 *
 * 条目自己不渲染错误码清单，点「查看问题」走统一的问题清单弹窗：一份清单只有一处渲染实现，
 * 才不会出现「弹窗里说 A、别处说 B」。
 */

import {
  Button,
  CloseIcon,
  Dialog,
  EmptyState,
  IconButton,
  InfoIcon,
  Progress,
  StatusIndicator,
} from '../../design-system'
import { showPostprocessIssuesDialog } from '../../store'
import { usePostprocessRuns, useRuntimeStore } from '../../stores/runtimeStore'
import { POSTPROCESS_STAGE_LABELS } from './postprocessIssue'
import {
  POSTPROCESS_RUN_STATUS_LABELS,
  countPostprocessIssues,
  formatPostprocessRunCount,
  getPostprocessRunPercent,
  isRunInFlight,
  summarizePostprocessRun,
  type PostprocessRun,
  type PostprocessRunStatus,
} from './postprocessRun'

/**
 * 状态 → 指示灯色调。「跳过/部分完成」是警告不是错误，别一律红。
 *
 * `skipped` 用中性灰、不走警告黄：它的含义是「这次一张都没产，但原因是配置 / 参与范围」，
 * 与 `partial`（产出不全，可能真要去修）不是一回事。黄色会把人往「出故障了」带，
 * 而这类记录的正确反应是「看一眼跳过的原因，决定要不要手动跑」。
 * `queued` 同样中性：它在等名额，不是故障（配小了「最多并发数」时必然会看到它）。
 */
const STATUS_TONE: Record<PostprocessRunStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  skipped: 'neutral',
}

const SOURCE_LABELS = { auto: '自动触发', manual: '手动触发' } as const

/**
 * 方向段（`产品线 / 产品 / 方向`）。
 *
 * 每条 run 只服务一个方向，而记录列表里同时会有好几个方向的记录 —— 不带方向的话，
 * 「三条同时跑的记录」在用户眼里是三份无法区分的东西。
 */
function directionOf(run: PostprocessRun): string {
  return run.directionLabel ?? (run.directionId ? run.directionId : '未指定方向')
}

function formatRunTime(timestamp: number): string {
  // 带日期：会话可能跨天（午夜后还在跑），只给时刻会让人误读成今天
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function ActiveRunBlock({ run }: { run: PostprocessRun }) {
  const percent = getPostprocessRunPercent(run)
  return (
    <div className="flex flex-col gap-2 rounded-ds-lg border border-ds-border p-3" data-testid="postprocess-active-run">
      <Progress
        label={
          run.status === 'queued'
            ? `${directionOf(run)} · 排队中`
            : (formatPostprocessRunCount(run) ?? `共 ${run.totalImages} 张`)
        }
        showValue={percent !== undefined}
        value={percent}
      />
      <div className="text-xs text-ds-muted">
        {`${directionOf(run)} · ${POSTPROCESS_RUN_STATUS_LABELS[run.status]} · ${POSTPROCESS_STAGE_LABELS[run.stage]} · ${SOURCE_LABELS[run.source]} · 共 ${run.totalImages} 张 · 已产出 ${run.producedFiles} 个文件 · 开始于 ${formatRunTime(run.startedAt)}`}
      </div>
      {/* 写盘文件名正是工具栏里被压掉的那一段：这里要能完整读到，长名字换行而不是溢出 */}
      {run.currentLabel && <div className="break-all text-xs text-ds-text-subtle">{`正在写：${run.currentLabel}`}</div>}
    </div>
  )
}

function RunRow({ run }: { run: PostprocessRun }) {
  const { errors, skipped } = countPostprocessIssues(run)
  const summary = `${formatRunTime(run.startedAt)} · ${directionOf(run)} · ${SOURCE_LABELS[run.source]} · ${summarizePostprocessRun(run)}`
  return (
    <div
      data-testid="postprocess-run-row"
      className="flex items-center gap-2 rounded-ds-lg border border-ds-border px-3 py-2"
    >
      <StatusIndicator tone={STATUS_TONE[run.status]}>{POSTPROCESS_RUN_STATUS_LABELS[run.status]}</StatusIndicator>
      {/* 行内为了紧凑会截断，全文挂在 title 上（hover 即得） */}
      <div title={summary} className="min-w-0 flex-1 truncate text-xs text-ds-muted">
        {summary}
      </div>
      {run.issues.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => showPostprocessIssuesDialog(run.issues)}>
          {errors > 0 ? `查看问题 (${errors})` : `查看跳过 (${skipped})`}
        </Button>
      )}
    </div>
  )
}

export default function PostprocessRunsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runs = usePostprocessRuns()
  const dismissPostprocessRun = useRuntimeStore((state) => state.dismissPostprocessRun)

  // 在飞的**全部**方向（含排队）：后处理按方向独立运行，同时有好几条是正常状态，
  // 只显示一条会让另外几条看起来不存在。
  const activeRuns = runs.filter(isRunInFlight)
  const history = runs.filter((run) => !isRunInFlight(run))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      size="md"
      title="后处理进度"
      description="每个方向各自跑一条，互不阻塞（同时跑几个由设置里的「最多并发数」决定，超出的排队）。这里是它们跑到哪了，以及最近几次的结果（只保留本次会话）。"
    >
      <div className="flex flex-col gap-4">
        {activeRuns.map((run) => (
          <ActiveRunBlock key={run.id} run={run} />
        ))}
        {activeRuns.length === 0 && runs.length === 0 && (
          <EmptyState
            icon={<InfoIcon size={20} />}
            title="还没有跑过后处理"
            description="生成任务完成后会自动产出变体；没有归属方向的素材可以在素材库选中后手动跑一次。"
          />
        )}
        {history.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ds-muted">{`最近记录（${history.length}）`}</span>
              <IconButton
                aria-label="清空已完成的后处理记录"
                icon={<CloseIcon size={15} />}
                size="sm"
                onClick={() => history.forEach((run) => dismissPostprocessRun(run.id))}
              />
            </div>
            {history.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}
