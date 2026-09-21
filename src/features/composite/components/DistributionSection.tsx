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
 * 所以这里不挂作用域选择器，并由容器在标题里把「全局一套」说清楚：
 * 给用户一个能选节点、选了却什么都不改变的控件，比不给更糟。
 *
 * ⚠️ **2026-09-21：从独立分区并入「输出位置」。**
 * 两者本来就是同一件事的两半（一个管「目录 + 文件名」，一个管「按天怎么分」），
 * 各占一个 tab 只会让「产出放哪」这件事要看两个地方。
 * 因此这里**只剩内容**（两张卡片），标题与「全局一套」那句由 `OutputSection` 的小节头给 ——
 * 与隔壁「文件命名」小节的装配方式完全一致。
 * 外壳的 `flex` / 滚动容器一并去掉：嵌在别人的滚动区里再自带一个，会出现两层滚动条与高度塌陷。
 * 宽度也不自带上限（原先有 `max-w-2xl`），交给容器统一 —— 否则它会比同级的渠道表窄一截。
 */

import { Switch } from '../../../design-system'
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
    <div className="space-y-4">
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
  )
}
