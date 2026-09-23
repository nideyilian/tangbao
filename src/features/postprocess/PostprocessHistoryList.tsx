/**
 * 方向级后处理历史的列表（**长期留档**那一份）。
 *
 * 数据来自落盘的历史 store（`storePostprocessHistory`），与 `PostprocessRunsDialog` 顶部那段
 * 「正在跑」是两件事：那边是内存态实时进度（重启即失），这边是重启后仍在的记录。
 *
 * 两个复用处，靠 `directionIds` 区分：
 * - 后处理进度面板 → 不传 = 全部方向（一屏看全）；
 * - 中控台「输出位置」分区 → 传左边树选中的那个方向 = 只看它（左边点哪个方向、右边看哪个方向）。
 *
 * ## 「打开输出位置」为什么不是简单的一个按钮
 *
 * 配了双写（本地留档 + 共享盘交付）时，一次产出会写到**两个**目录；一个方向下还按渠道拆成
 * 多个桶，目录数可能更多。只给一个按钮等于把其余位置藏起来 ——
 * 而用户点这个按钮**恰恰是为了去核对文件**，少一个位置他会以为产出丢了。
 *
 * 所以按目录数分流：只有一处就直接打开（最常见）；多于一处先展开目录清单，逐个打开。
 * 空目录（这次一个文件都没写成）按钮置灰并说明原因，而不是点了毫无反应。
 */

import { useMemo, useState } from 'react'
import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  EmptyState,
  IconButton,
  InfoIcon,
  StatusIndicator,
} from '../../design-system'
import { FolderOpenIcon } from '../../design-system/icons'
import { openInExplorer } from '../../lib/localSave'
import { showPostprocessIssuesDialog, useStore } from '../../store'
import { usePostprocessHistoryByDirection } from '../../storePostprocessHistory'
import { expandHistoryIssue, type PostprocessHistoryEntry } from './postprocessHistory'
import {
  POSTPROCESS_RUN_SOURCE_LABELS,
  POSTPROCESS_RUN_STATUS_LABELS,
  POSTPROCESS_RUN_STATUS_TONES,
  describePostprocessDiagnostics,
  formatPostprocessDuration,
  formatPostprocessRunTime,
} from './postprocessRun'

interface Props {
  /** 只显示这些方向的历史；不传（或空数组）= 全部有记录的方向 */
  directionIds?: string[]
  /** 空态说明；不传用默认文案 */
  emptyDescription?: string
}

export default function PostprocessHistoryList({ directionIds, emptyDescription }: Props) {
  const byDirection = usePostprocessHistoryByDirection()
  const showToast = useStore((state) => state.showToast)
  /** 折叠的方向 id（默认全展开：历史是来查的，不是来点的） */
  const [collapsed, setCollapsed] = useState<string[]>([])
  /** 展开了目录清单的那条记录 id —— 只在多于一个输出位置时才用得上 */
  const [dirsExpandedId, setDirsExpandedId] = useState<string | null>(null)

  /**
   * 方向分组，按「最新一条记录的时间」倒序。
   *
   * 排序依据用最新记录而不是方向名：最近产出过的方向排在最上面，与实际使用顺序一致 ——
   * 用户来查的多半就是刚才那一批。
   */
  const groups = useMemo(() => {
    const ids = directionIds && directionIds.length > 0 ? directionIds : Object.keys(byDirection)
    return ids
      .map((directionId) => ({ directionId, entries: byDirection[directionId] ?? [] }))
      .filter((group) => group.entries.length > 0)
      .sort((a, b) => (b.entries[0]?.startedAt ?? 0) - (a.entries[0]?.startedAt ?? 0))
  }, [byDirection, directionIds])

  const handleOpenDir = async (dir: string) => {
    const result = await openInExplorer(dir)
    if (!result.ok) showToast(result.error || '打开输出位置失败', 'error')
  }

  const toggleCollapsed = (directionId: string) =>
    setCollapsed((current) =>
      current.includes(directionId) ? current.filter((id) => id !== directionId) : [...current, directionId],
    )

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<InfoIcon size={20} />}
        title="还没有历史记录"
        description={
          emptyDescription ??
          '跑过一次后处理之后，这里会按方向留下可查的记录：每次产到哪几个方向、写到哪些目录、有没有出错。记录长期保留，重启后仍在。'
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ directionId, entries }) => {
        const isOpen = !collapsed.includes(directionId)
        const label = entries[0].directionLabel
        return (
          <div
            key={directionId}
            className="rounded-ds-lg border border-ds-border"
            data-testid="postprocess-history-group"
          >
            <div className="flex items-center gap-2 border-b border-ds-border px-3 py-2">
              <IconButton
                size="sm"
                aria-label={isOpen ? `收起「${label}」的历史` : `展开「${label}」的历史`}
                icon={isOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                onClick={() => toggleCollapsed(directionId)}
              />
              {/* 方向名可能很长（产品线 / 产品 / 方向），截断但 hover 能看全 */}
              <span title={label} className="min-w-0 flex-1 truncate text-sm text-ds-text">
                {label}
              </span>
              <span className="shrink-0 text-xs text-ds-muted tabular-nums">{`${entries.length} 条`}</span>
            </div>
            {isOpen && (
              <div className="flex flex-col gap-1 p-2">
                {entries.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    dirsExpanded={dirsExpandedId === entry.id}
                    onToggleDirs={() => setDirsExpandedId(dirsExpandedId === entry.id ? null : entry.id)}
                    onOpenDir={handleOpenDir}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface HistoryRowProps {
  entry: PostprocessHistoryEntry
  dirsExpanded: boolean
  onToggleDirs: () => void
  onOpenDir: (dir: string) => void
}

function HistoryRow({ entry, dirsExpanded, onToggleDirs, onOpenDir }: HistoryRowProps) {
  const elapsed = Math.max(0, entry.finishedAt - entry.startedAt)
  const diagnostics = describePostprocessDiagnostics(entry.diagnostics)
  /**
   * 一行摘要：**时间 · 来源 · 多少张图 → 多少个文件**。
   *
   * 把源图数与产出数并排放（而不是只报产出数）：这两个数一起才回答得了
   * 「这次是不是全产出了」—— 只看「产出 12 个」不知道本该是几个。
   */
  const summary = `${formatPostprocessRunTime(entry.startedAt)} · ${POSTPROCESS_RUN_SOURCE_LABELS[entry.source]} · ${entry.totalImages} 张 → ${entry.producedFiles} 个文件`
  /**
   * 产出目标只在**跨方向**时才显示。
   *
   * 大多数记录是「按归属方向产出」（目标就是它自己），此时显示「产到 1 个方向」纯属噪音；
   * 而手动跑跨了 3 个方向时，这个数正是解释「为什么这条记录里的文件不属于这个方向」的关键。
   */
  const crossedTargets = entry.targetDirectionIds.length > 1
  const dirCount = entry.outputDirs.length

  return (
    <div
      data-testid="postprocess-history-row"
      className="flex flex-col gap-1 rounded-ds-lg border border-ds-border px-2 py-1.5"
    >
      <div className="flex items-center gap-2">
        <StatusIndicator tone={POSTPROCESS_RUN_STATUS_TONES[entry.status]}>
          {POSTPROCESS_RUN_STATUS_LABELS[entry.status]}
        </StatusIndicator>
        {/* 行内为了紧凑会截断，全文挂在 title 上（hover 即得） */}
        <div title={summary} className="min-w-0 flex-1 truncate text-xs text-ds-muted">
          {summary}
        </div>
        {entry.issueCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => showPostprocessIssuesDialog(entry.issues.map(expandHistoryIssue))}
          >
            {`查看问题 (${entry.issueCount})`}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          data-testid="postprocess-history-open"
          // 一个文件都没写成时按钮置灰并**说明原因**（不是点了没反应）：这次没产出，
          // 自然也没有位置可打开 —— 用户该看的是旁边那个「查看问题」
          disabled={dirCount === 0}
          title={dirCount === 0 ? '这次没有写出文件，没有可打开的位置' : undefined}
          onClick={() => {
            if (dirCount === 1) onOpenDir(entry.outputDirs[0])
            // 多于一处：先展开目录清单，让用户自己挑（双写时两个位置都可能是他要找的）
            else if (dirCount > 1) onToggleDirs()
          }}
        >
          {dirCount > 1 ? `打开位置 (${dirCount})` : '打开位置'}
        </Button>
      </div>
      {(diagnostics || crossedTargets) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ds-text-subtle">
          {diagnostics && <span>{`耗时 ${formatPostprocessDuration(elapsed)} · ${diagnostics}`}</span>}
          {crossedTargets && <span>{`本次产到 ${entry.targetDirectionIds.length} 个方向`}</span>}
        </div>
      )}
      {dirsExpanded && dirCount > 0 && (
        <div className="flex flex-col gap-1 pt-0.5">
          {entry.outputDirs.map((dir) => (
            <div key={dir} className="flex items-center gap-2">
              <span title={dir} className="min-w-0 flex-1 truncate text-xs text-ds-muted">
                {dir}
              </span>
              <IconButton
                aria-label={`打开 ${dir}`}
                size="sm"
                icon={<FolderOpenIcon size={14} />}
                onClick={() => onOpenDir(dir)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
