/**
 * 中控台 · 「分发」分区。
 *
 * 把「按天分散到日期目录」+「纯净版是否自动伴随」两个开关收在一处。
 *
 * ⚠️ **这个分区是纯全局的，不参与作用域切换。**
 * 上一轮我一度以为分发可以按节点覆盖，实测类型后确认不行：
 * `PostprocessNodeOverride`（ADR-0011 收窄后）只有 `outputDir` / `watermarkPresetIds` /
 * `enabled` / `byMedia` 四个字段，`distribution` 与 `autoCompanionClean` **不在其中** ——
 * 它们在 v1→v2 迁移时被「提升」到了 `promotedGlobals`，即**只读的历史存档**。
 *
 * 所以这里不挂作用域选择器，并在界面上把「全局一套」说清楚：
 * 给用户一个能选节点、选了却什么都不改变的控件，比不给更糟。
 */

import { SectionHeader, Switch } from '../../../design-system'
import { useStore } from '../../../store'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import PostprocessDistributionFields from '../../postprocess/PostprocessDistributionFields'

export function DistributionSection() {
  const autoCompanionClean = usePostprocessMediaStore((state) => state.autoCompanionClean)
  const setAutoCompanionClean = usePostprocessMediaStore((state) => state.setAutoCompanionClean)
  const distribution = usePostprocessMediaStore((state) => state.distribution)
  const patchDistribution = usePostprocessMediaStore((state) => state.patchDistribution)
  const showToast = useStore((state) => state.showToast)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <SectionHeader
          title="分发"
          description="全局一套，对所有方向统一生效。按天把产出分散到日期目录，并决定纯净版原图是否跟随产出。"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="max-w-2xl space-y-4">
          <div className="rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2.5 dark:border-ds-border dark:bg-ds-scrim">
            <Switch
              label="纯净版自动伴随"
              description="勾了任一渠道时，额外多产一份无水印原图。关掉后纯净版只在你显式勾选时才产出。"
              checked={autoCompanionClean}
              onCheckedChange={(checked) => setAutoCompanionClean(checked)}
            />
          </div>

          <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-3 dark:border-ds-border dark:bg-ds-scrim">
            <PostprocessDistributionFields
              config={distribution}
              onChange={(patch) => patchDistribution(patch)}
              onPickError={() => showToast('选择目录失败，请重试', 'error')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
