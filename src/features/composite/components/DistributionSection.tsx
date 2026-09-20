/**
 * 中控台 · 「分发」分区。
 *
 * 把「按天分散到日期目录」+「纯净版是否自动伴随」这两个**全局统一**的开关收在一处。
 * 两者都是全局唯一的参数（`PostprocessDistributionFields` 的注释里已声明：分发配置
 * 从旧编排移植过来后，宿主只有后处理面板与节点覆盖弹窗两个），中控台是第三个入口 —
 * ⚠️ 因此这里**刻意不引入新的写入口径**，只是把同一组件搬到更显眼的位置，
 * 与「后处理设置」用的是同一个 store action（`patchDistribution` / `setAutoCompanionClean`）。
 *
 * 为什么不把节点级分发也放进来：节点覆盖层的「恢复继承」是宿主概念，
 * 塞进中控台会让「这个开关到底改了哪一层」变得需要推理 —— 与 ADR-0011 的收窄方向相反。
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
        <SectionHeader title="分发" description="全局一套。按天把产出分散到日期目录，并决定纯净版原图是否跟随产出。" />
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
