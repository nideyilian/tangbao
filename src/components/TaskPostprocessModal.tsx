import { useCallback, useMemo } from 'react'
import { Dialog, IconButton, ListRow } from '../design-system'
import { FolderOpenIcon } from '../design-system/icons'
import { openInExplorer } from '../lib/localSave'
import { useStore } from '../store'
import type { TaskPostprocessOutput, TaskRecord } from '../types'

interface TaskPostprocessModalProps {
  task: TaskRecord
  onClose: () => void
}

/** 从绝对路径取文件名；同时兼容 Windows 反斜杠与 POSIX 斜杠。 */
export function getPostprocessOutputFileName(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? filePath
}

/**
 * 单个任务的后处理产出清单。
 *
 * 之所以是弹层而不是卡片内展开：任务网格按 `TASK_CARD_ROW_HEIGHT`（192px）固定行高虚拟化，
 * 卡片高度一旦随内容变化就会让后续行全部错位。产出清单只在这里展示，卡片侧只放一枚计数徽章。
 *
 * 展示的是**产出时的实际参数**（`output.width/height` 快照），不是当前媒体表配置——
 * 媒体表可被用户事后修改，用实时配置会与磁盘上的文件不符。
 */
export default function TaskPostprocessModal({ task, onClose }: TaskPostprocessModalProps) {
  const showToast = useStore((s) => s.showToast)
  const outputs = useMemo(() => task.postprocessOutputs ?? [], [task.postprocessOutputs])

  const handleReveal = useCallback(
    async (output: TaskPostprocessOutput) => {
      const result = await openInExplorer(output.path)
      if (!result.ok) showToast(result.error || '打开文件位置失败', 'error')
    },
    [showToast],
  )

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="后处理产出"
      description={`共 ${outputs.length} 个文件，于生成完成时按渠道规格自动输出。`}
      size="lg"
    >
      <div className="flex max-h-[60vh] flex-col overflow-y-auto">
        {outputs.map((output) => (
          <ListRow
            key={`${output.rawImageId}-${output.sizeId}-${output.path}`}
            variant="divided"
            title={`${output.mediaName} · ${output.width}×${output.height}`}
            description={getPostprocessOutputFileName(output.path)}
            meta={output.clean ? '纯净版' : undefined}
            actions={
              <IconButton
                aria-label={`打开 ${output.mediaName} ${output.width}×${output.height} 所在文件夹`}
                size="sm"
                icon={<FolderOpenIcon size={16} />}
                onClick={() => void handleReveal(output)}
              />
            }
          />
        ))}
      </div>
    </Dialog>
  )
}
