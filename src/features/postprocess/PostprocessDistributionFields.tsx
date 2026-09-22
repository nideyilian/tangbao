/**
 * 分发配置表单。
 *
 * 从 `features/composite` 的旧编排里移植过来的能力：把一批产物按天平均分配到日期文件夹，
 * 供投放排期使用。
 *
 * ## 谁跟作用域、谁不跟（2026-09-23）
 *
 * - **排期跟着左边树选的方向走**：`days`（铺几天）/ `skipWeekends`（跳不跳周末）。
 *   「A 产品铺 7 天、B 产品铺 30 天」本来就是逐方向的投放节奏（推翻 ADR-0011 裁决 #4）。
 * - **其余一律全局一套**：启用与否、复制还是移动、改名方式、打乱、改 md5、目标目录 ——
 *   这些是「怎么搬」的操作习惯，全局配一次就够；逐方向各配一遍只会让人怀疑到底哪个生效。
 *
 * 宿主（中控台「渠道与输出」分区的分发小节）负责把 `scheduleScope` 算好传进来：
 * 本组件只负责渲染，不去读项目树 —— 它不知道当前作用域是哪个节点。
 */

import { Badge, Button, SegmentedControl, Switch, TextField } from '../../design-system'
import { FolderOpenIcon } from '../../components/icons'
import type { PostprocessDistributionConfig } from '../../lib/postprocessDistribution'

interface Props {
  config: PostprocessDistributionConfig
  onChange: (patch: Partial<PostprocessDistributionConfig>) => void
  /** 目录选择失败时的提示通道；各宿主取 toast 的方式不同，由调用方注入 */
  onPickError?: () => void
  /**
   * 排期那两个字段的作用域标记。**不传 = 当前是全局作用域**（没有「恢复继承」这一说）。
   *
   * - `overridden`：这个方向自己写了排期 ⇒ 显示「本级自定义」+「恢复继承」；
   * - `sourceHint`：没写时的来源，如「跟随 快手」—— 比干巴巴的「继承中」有用得多；
   * - `onReset`：恢复继承（把该节点的 `distribution` 置 `undefined`）。
   */
  scheduleScope?: {
    overridden: boolean
    sourceHint: string
    onReset: () => void
  }
}

const MODE_OPTIONS: Array<{ value: PostprocessDistributionConfig['mode']; label: string }> = [
  { value: 'copy', label: '复制' },
  { value: 'move', label: '移动' },
]

const RENAME_OPTIONS: Array<{ value: PostprocessDistributionConfig['renameMode']; label: string }> = [
  { value: 'date', label: '替换文件名日期段' },
  { value: 'sequence', label: '按日期+序号重命名' },
]

/**
 * 排期那一组的标题 + 作用域标记。
 *
 * 「铺几天」与「跳过周末」是**同一个覆盖对象**（`distribution`），所以标记只在这一组的标题上
 * 出现一次 —— 两个字段各挂一个「恢复继承」按钮会让人以为它们是两件互不相干的事。
 */
function ScheduleHeading({ scope }: { scope: NonNullable<Props['scheduleScope']> }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-ds-text">排期（跟左边树选的方向走）</span>
      {scope.overridden ? (
        <>
          <Badge tone="info">本级自定义</Badge>
          <Button variant="ghost" size="sm" onClick={scope.onReset}>
            恢复继承
          </Button>
        </>
      ) : (
        <span className="text-xs text-ds-muted">{scope.sourceHint}</span>
      )}
    </div>
  )
}

export default function PostprocessDistributionFields({ config, onChange, onPickError, scheduleScope }: Props) {
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
        description="产出写盘后按天平均分配到日期文件夹（从产出当天开始算），供投放排期使用。全局一套。"
        checked={config.enabled}
        onCheckedChange={(enabled) => onChange({ enabled })}
      />

      {config.enabled && (
        <>
          {scheduleScope && <ScheduleHeading scope={scheduleScope} />}

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
            <p className="text-xs text-ds-muted">
              从产出当天开始算，按天平均分。比如今天导出 1000 张、铺 5 天，就是每天 200 张
              （多个渠道目录各自分各自的，同一张素材在各渠道落在同一天）。
            </p>
          </div>

          <div className="space-y-1.5">
            <Switch
              label="跳过周末"
              description="只往工作日排期，周六周日不分配（排期往后顺延，天数给够）。"
              checked={config.skipWeekends}
              onCheckedChange={(skipWeekends) => onChange({ skipWeekends })}
            />
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
              label="打乱顺序"
              description="按素材打乱后再平均分配（同一张素材的各渠道版本仍落在同一天）。"
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
              placeholder="留空则在产出目录下面建日期文件夹"
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
