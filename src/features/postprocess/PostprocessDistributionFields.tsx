/**
 * 分发配置表单。
 *
 * 从 `features/composite` 的旧编排里移植过来的能力：把一批产物按天平均分配到日期文件夹，
 * 供投放排期使用。提取成独立组件是因为它有两个宿主——「后处理设置」面板（全局默认）
 * 与项目树节点参数弹窗（方向级覆盖）——两边必须长得完全一样，否则同一个配置在两处
 * 会呈现不同的字段与措辞，用户没法判断哪个才是生效的。
 *
 * 不在这里做「恢复继承」：那是节点覆盖层的概念，由宿主用 FieldRow 包一层提供。
 */

import { Button, SegmentedControl, Switch, TextField } from '../../design-system'
import { FolderOpenIcon } from '../../components/icons'
import type { PostprocessDistributionConfig } from '../../lib/postprocessDistribution'

interface Props {
  config: PostprocessDistributionConfig
  onChange: (patch: Partial<PostprocessDistributionConfig>) => void
  /** 目录选择失败时的提示通道；各宿主取 toast 的方式不同，由调用方注入 */
  onPickError?: () => void
}

const MODE_OPTIONS: Array<{ value: PostprocessDistributionConfig['mode']; label: string }> = [
  { value: 'copy', label: '复制' },
  { value: 'move', label: '移动' },
]

const RENAME_OPTIONS: Array<{ value: PostprocessDistributionConfig['renameMode']; label: string }> = [
  { value: 'date', label: '替换文件名日期段' },
  { value: 'sequence', label: '按日期+序号重命名' },
]

export default function PostprocessDistributionFields({ config, onChange, onPickError }: Props) {
  const pickTargetDir = async () => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) onChange({ targetDir: path })
    } catch {
      onPickError?.()
    }
  }

  return (
    <div className="space-y-3">
      <Switch
        label="启用分发"
        description="产出写盘后按天平均分配到日期文件夹（从产出当天开始算），供投放排期使用。"
        checked={config.enabled}
        onCheckedChange={(enabled) => onChange({ enabled })}
      />

      {config.enabled && (
        <>
          <div className="space-y-1.5">
            <TextField
              label="铺几天"
              value={String(config.days)}
              onChange={(event) => {
                const next = Number(event.target.value.replace(/\D/g, ''))
                onChange({ days: Number.isFinite(next) && next > 0 ? next : 1 })
              }}
              placeholder="1"
            />
            <p className="text-xs text-ds-muted dark:text-ds-muted">
              从产出当天开始算，按天平均分。比如今天导出 1000 张、铺 5 天，就是每天 200 张
              （多个渠道目录各自分各自的，同一张素材在各渠道落在同一天）。
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ds-text dark:text-ds-text">搬运方式</span>
            <SegmentedControl
              aria-label="分发搬运方式"
              value={config.mode}
              options={MODE_OPTIONS}
              onValueChange={(mode) => onChange({ mode })}
            />
            <p className="text-xs text-ds-muted dark:text-ds-muted">
              {config.mode === 'move'
                ? '移动会从产出目录搬走文件（源目录空了会被清理），产物只剩日期文件夹里那一份。'
                : '复制保留产出目录里的原文件，日期文件夹里另存一份。'}
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ds-text dark:text-ds-text">重命名方式</span>
            <SegmentedControl
              aria-label="分发重命名方式"
              value={config.renameMode}
              options={RENAME_OPTIONS}
              onValueChange={(renameMode) => onChange({ renameMode })}
            />
            <p className="text-xs text-ds-muted dark:text-ds-muted">
              {config.renameMode === 'date'
                ? '把原文件名里的日期段替换成分发日期；原名没有日期段时保持原样。'
                : '按「日期_序号」重排，原名不带日期时更好认。'}
            </p>
          </div>

          <div className="space-y-2">
            <Switch
              label="跳过周末"
              description="只往工作日排期，周六周日不分配。"
              checked={config.skipWeekends}
              onCheckedChange={(skipWeekends) => onChange({ skipWeekends })}
            />
            <Switch
              label="打乱顺序"
              description="先打乱再平均分配，避免同一批素材出现肉眼可见的排期规律。"
              checked={config.randomize}
              onCheckedChange={(randomize) => onChange({ randomize })}
            />
            <Switch
              label="改写文件校验值"
              description="追加随机字节改变 md5，规避投放平台的「重复素材」判定。"
              checked={config.modifyMd5}
              onCheckedChange={(modifyMd5) => onChange({ modifyMd5 })}
            />
          </div>

          <div className="flex items-end gap-2">
            <TextField
              label="分发目标目录"
              containerClassName="min-w-0 flex-1"
              value={config.targetDir}
              onChange={(event) => onChange({ targetDir: event.target.value })}
              placeholder="留空则在产出目录里建日期文件夹"
            />
            <Button
              variant="secondary"
              leadingIcon={<FolderOpenIcon className="h-3.5 w-3.5" />}
              onClick={() => void pickTargetDir()}
            >
              浏览
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
