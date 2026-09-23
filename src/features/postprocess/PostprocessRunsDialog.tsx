/**
 * 后处理进度面板：正在跑的 + 方向级历史记录。
 *
 * 为什么需要它：TB-069 把进度落成了「素材库工具栏上的一行文本」与任务卡上的小徽章 ——
 * 那行文本只在**素材库视图、且工具栏在视野里**时才存在。用户在画廊或中控台里批量出图时，
 * 后台自动后处理跑了多少、跑到哪、成了没，界面没有任何答复（2026-09-21 报障
 * 「真正的处理进度弹窗为什么没有实现，我要从哪里查进度」）。
 *
 * 与 toast 的分工：toast 是「刚发生」的一次性播报，几秒即逝且**是单槽**（连发互相顶掉）；
 * 这里是**可查询的常驻记录**，主动打开就能看到全量。
 *
 * 面板里是**三段**，别混：
 * 1. 「正在跑」= 内存态实时进度（`runtimeStore`），重启即失；
 * 2. 「不属于某个方向的结果」= 批次级问题（分发失败、准备阶段崩溃）—— 没有方向，
 *    因此进不了方向历史，只能在这里显示；
 * 3. 「历史记录」= 落盘的长期留档（`storePostprocessHistory`），按方向分桶、重启仍在，
 *    也是「这次产到哪几个目录」的查询入口（带「打开输出位置」按钮）。
 *
 * ⚠️ 第 2 段刻意**只留没有方向的记录**：有方向的那些都已落进第 3 段，两段同时显示同一次运行
 * 会让人以为它跑了两次（TB-115 之前那段「最近记录」就是这个症状）。
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
import { cancelPostprocessDirection } from './postprocessCancel'
import PostprocessHistoryList from './PostprocessHistoryList'
import {
  POSTPROCESS_RUN_SOURCE_LABELS,
  POSTPROCESS_RUN_STATUS_LABELS,
  POSTPROCESS_RUN_STATUS_TONES,
  countPostprocessIssues,
  describePostprocessDiagnostics,
  formatPostprocessDuration,
  formatPostprocessRunCount,
  formatPostprocessRunTime,
  getPostprocessRunPercent,
  isRunInFlight,
  summarizePostprocessRun,
  type PostprocessRun,
} from './postprocessRun'

/**
 * 方向段（`产品线 / 产品 / 方向`）。
 *
 * 每条 run 只服务一个方向，而这里同时会有好几个方向的记录 —— 不带方向的话，
 * 「三条同时跑的记录」在用户眼里是三份无法区分的东西。
 */
function directionOf(run: PostprocessRun): string {
  return run.directionLabel ?? (run.directionId ? run.directionId : '未指定方向')
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
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-xs text-ds-muted">
          {`${directionOf(run)} · ${POSTPROCESS_RUN_STATUS_LABELS[run.status]} · ${POSTPROCESS_STAGE_LABELS[run.stage]} · ${POSTPROCESS_RUN_SOURCE_LABELS[run.source]} · 共 ${run.totalImages} 张 · 已产出 ${run.producedFiles} 个文件 · 开始于 ${formatPostprocessRunTime(run.startedAt)}`}
        </div>
        {/*
          取消按钮**按方向**（TB-115）：后处理是一方向一条独立 run，停一个不该牵连别的方向 ——
          这与「方向之间互不阻塞」是同一条口径。排队中的也能取消（`acquire` 里 race 了 abort 源）。
        */}
        {run.directionId && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="postprocess-cancel-run"
            title="停掉这个方向的产出。已经写出的文件会保留，不会删除。"
            onClick={() => cancelPostprocessDirection(run.directionId!)}
          >
            取消
          </Button>
        )}
      </div>
      {/* 写盘文件名正是工具栏里被压掉的那一段：这里要能完整读到，长名字换行而不是溢出 */}
      {run.currentLabel && <div className="break-all text-xs text-ds-text-subtle">{`正在写：${run.currentLabel}`}</div>}
    </div>
  )
}

function RunRow({ run }: { run: PostprocessRun }) {
  const { errors, skipped } = countPostprocessIssues(run)
  const summary = `${formatPostprocessRunTime(run.startedAt)} · ${directionOf(run)} · ${POSTPROCESS_RUN_SOURCE_LABELS[run.source]} · ${summarizePostprocessRun(run)}`
  const diagnostics = describePostprocessDiagnostics(run.diagnostics)
  const elapsed = run.finishedAt ? run.finishedAt - run.startedAt : undefined
  return (
    <div
      data-testid="postprocess-run-row"
      className="flex flex-col gap-1 rounded-ds-lg border border-ds-border px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <StatusIndicator tone={POSTPROCESS_RUN_STATUS_TONES[run.status]}>
          {POSTPROCESS_RUN_STATUS_LABELS[run.status]}
        </StatusIndicator>
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
      {diagnostics && (
        <div className="text-xs text-ds-text-subtle">{`耗时 ${formatPostprocessDuration(elapsed ?? 0)} · ${diagnostics}`}</div>
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
  const finished = runs.filter((run) => !isRunInFlight(run))
  /**
   * 只留**没有方向**的批次级记录（分发失败、准备阶段崩溃）。
   *
   * 有方向的那些已经落进下面的方向历史里了。两段都显示同一次运行，用户看到的是
   * 「同一条记录出现两次」—— 次数一多，他会开始怀疑是不是真的跑了两次。
   */
  const batchLevel = finished.filter((run) => !run.directionId)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      size="md"
      title="后处理进度"
      description="每个方向各自跑一条，互不阻塞（同时跑几个由设置里的「最多并发数」决定，超出的排队）。下面是每个方向的历史记录：长期保留、重启后仍在，每条都能直接打开产出所在位置。"
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
        {batchLevel.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ds-muted">
                {`不属于某个方向的结果（${batchLevel.length}）`}
              </span>
              <IconButton
                aria-label="清空这些不分方向的结果"
                icon={<CloseIcon size={15} />}
                size="sm"
                onClick={() => batchLevel.forEach((run) => dismissPostprocessRun(run.id))}
              />
            </div>
            {batchLevel.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-ds-border pt-4">
          <span className="text-xs font-medium text-ds-muted">历史记录（按方向，长期保留）</span>
          <PostprocessHistoryList />
        </div>
      </div>
    </Dialog>
  )
}
