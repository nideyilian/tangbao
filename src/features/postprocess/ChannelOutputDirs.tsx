/**
 * 按渠道设置导出位置（后处理设置 → 输出与命名；项目树节点参数 → 输出目录）。
 *
 * 一个渠道可以给 **1~2 个**位置：给两个就是**双写**——同一份产物在两个位置各存一份，文件名相同
 * （典型用法是「本地留档 + 共享盘交付」）。这解决的是「一个全局路径喂不饱多渠道路数」：
 * 《输出位置明细》里 25/61 个方向的各渠道本来就不在同一个目录，连层级顺序都不同，塞不进一个值。
 *
 * 两个入口共用本组件而不是各写一遍：全局层（`mediaOutputDirs`）与项目节点层（`byMedia[m].outputDirs`）
 * 的交互必须一模一样，否则「全局能配两个、节点只能配一个」这种差异会让 `byMedia` 一覆盖就把双写吃掉。
 *
 * 与「默认输出目录」的关系：留空 = 用默认输出位置（或继承上级），所以**默认位置永远在**，
 * 渠道配置只做覆盖，不会把没配过默认位置的用户推进死胡同。
 */

import { useState, type ReactNode } from 'react'
import { Button, IconButton, TextField } from '../../design-system'
import { FolderOpenIcon, XIcon } from '../../design-system/icons'
import { MAX_POSTPROCESS_OUTPUT_DIRS, normalizeOutputDirList, type PostprocessMedia } from '../../lib/postprocessMedia'

interface Props {
  media: PostprocessMedia[]
  /** 读某渠道**本级已配**的位置（1~2 个）；空数组 = 本级没配，用继承值 */
  resolveDirs: (mediaId: string) => string[]
  /** 占位提示：本级留空时会落到哪个位置（继承链解析结果，调用方给） */
  resolveInheritedHint: (mediaId: string) => string
  /** 写某渠道第 `index` 个位置；传空串 = 清掉该槽 */
  onChangeDir: (mediaId: string, index: number, outputDir: string) => void
  /** 清空某渠道的全部位置，回到继承（项目节点）或默认位置（全局） */
  onClearDirs: (mediaId: string) => void
  onPickError: () => void
  /** 收起态（项目节点里默认收起：多数方向各渠道共用一个目录） */
  collapsible?: boolean
  /** 清空按钮的文案：全局是「用默认」、节点是「恢复继承」 */
  clearLabel?: string
  description?: ReactNode
}

export default function ChannelOutputDirs({
  media,
  resolveDirs,
  resolveInheritedHint,
  onChangeDir,
  onClearDirs,
  onPickError,
  collapsible = false,
  clearLabel = '用默认',
  description,
}: Props) {
  /** 已点开「再加一个」但还没填第二个位置的渠道（纯 UI 态，不落盘） */
  const [secondOpen, setSecondOpen] = useState<string[]>([])
  const [open, setOpen] = useState(!collapsible)

  const closeSecond = (mediaId: string) => setSecondOpen((current) => current.filter((id) => id !== mediaId))

  const pickDirectory = async (mediaId: string, index: number) => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) onChangeDir(mediaId, index, path)
    } catch {
      onPickError()
    }
  }

  const configuredNames = media.filter((item) => resolveDirs(item.id).length > 0).map((item) => item.name)

  const rows = (
    <div className="space-y-2">
      {media.length === 0 && (
        <p className="text-xs text-ds-muted dark:text-ds-muted">媒体表为空，没有可单独设置的渠道。</p>
      )}
      {media.map((item) => {
        const dirs = normalizeOutputDirList(resolveDirs(item.id))
        // 第二个位置有两种来源：已经配过（`dirs.length > 1`）或刚点了「再加一个」
        const showSecond = dirs.length > 1 || secondOpen.includes(item.id)
        const canAddSecond = dirs.length > 0 && dirs.length < MAX_POSTPROCESS_OUTPUT_DIRS && !showSecond
        const inherited = resolveInheritedHint(item.id)
        return (
          <div key={item.id} className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-1.5 text-xs text-ds-text dark:text-ds-text">{item.name}</span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <TextField
                  label=""
                  className="flex-1"
                  data-testid={`channel-output-dir-${item.id}-0`}
                  value={dirs[0] ?? ''}
                  placeholder={inherited ? `留空 = ${inherited}` : '留空 = 用默认输出位置'}
                  onChange={(event) => onChangeDir(item.id, 0, event.target.value)}
                />
                <IconButton
                  size="sm"
                  aria-label={`选择 ${item.name} 的导出位置`}
                  title="选择导出位置"
                  icon={<FolderOpenIcon className="h-3.5 w-3.5" />}
                  onClick={() => void pickDirectory(item.id, 0)}
                />
                {canAddSecond && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`channel-output-add-${item.id}`}
                    title="再加一个位置：同一份产物也会写到这里（双写）"
                    onClick={() => setSecondOpen((current) => [...current, item.id])}
                  >
                    再加一个
                  </Button>
                )}
                {dirs.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="清空后这个渠道回到上级/默认的输出位置"
                    onClick={() => {
                      onClearDirs(item.id)
                      closeSecond(item.id)
                    }}
                  >
                    {clearLabel}
                  </Button>
                )}
              </div>

              {showSecond && (
                <div className="flex items-center gap-1.5">
                  <TextField
                    label=""
                    className="flex-1"
                    data-testid={`channel-output-dir-${item.id}-1`}
                    value={dirs[1] ?? ''}
                    placeholder="第二个位置（双写）"
                    onChange={(event) => onChangeDir(item.id, 1, event.target.value)}
                  />
                  <IconButton
                    size="sm"
                    aria-label={`选择 ${item.name} 第二个导出位置`}
                    title="选择第二个导出位置"
                    icon={<FolderOpenIcon className="h-3.5 w-3.5" />}
                    onClick={() => void pickDirectory(item.id, 1)}
                  />
                  <IconButton
                    size="sm"
                    aria-label={`取消 ${item.name} 的第二个导出位置`}
                    title="取消第二个位置"
                    icon={<XIcon className="h-3.5 w-3.5" />}
                    onClick={() => {
                      onChangeDir(item.id, 1, '')
                      closeSecond(item.id)
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )

  if (!collapsible) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-medium text-ds-text dark:text-ds-text-subtle">按渠道设置导出位置</span>
          <span className="text-xs text-ds-muted dark:text-ds-muted">
            {description ?? '留空 = 用上面的默认位置；填两个 = 同一份产物两处各存一份（双写）'}
          </span>
        </div>
        {rows}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? '收起按渠道设置' : '按渠道分别设置'}
        </Button>
        {!open && configuredNames.length > 0 && (
          <span className="text-xs text-ds-accent dark:text-ds-accent">{configuredNames.join('、')} 已单独设置</span>
        )}
      </div>
      {open && (
        <>
          <p className="text-xs text-ds-muted dark:text-ds-muted">
            留空 = 用上面的通用值（继承上级）。填两个 =
            同一份产物两处各存一份。只有同一方向各渠道不一样时才需要在这里单独填。
          </p>
          {rows}
        </>
      )}
    </div>
  )
}
