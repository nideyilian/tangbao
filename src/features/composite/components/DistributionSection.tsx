/**
 * 中控台 · 「渠道与输出」分区里的**分发**小节。
 *
 * ⚠️ **只有排期跟作用域走**（2026-09-23）：`days`（铺几天）与 `skipWeekends`（跳不跳周末）
 * 是「这个方向 / 这个产品的投放节奏」，逐方向配；**其余一律全局一套** —— 启用与否、
 * 复制还是移动、改名方式、打乱、改 md5、目标目录都是「怎么搬」的操作习惯。
 *
 * ⚠️ **上一轮这里写的是「纯全局、不参与作用域切换」，那句话现在是错的。** 当时的成因是
 * `PostprocessNodeOverride`（ADR-0011 收窄后）里没有 `distribution` 字段：2026-09-20 曾打算
 * 给它挂作用域选择器，是被 `tsc` 报错拦下的，不是判断「方向级没用」；ADR-0011 收窄的理由栏
 * 原文也是「无逐方向差异证据」。而「A 产品铺 7 天、B 产品铺 30 天」本来就是逐方向的节奏，
 * 与 ADR-0003 量到的「输出目录 / 水印按方向分叉」是同一类证据 —— 只是当时没人去量。
 *
 * ⚠️ **2026-09-21：从独立分区并入「输出位置」（TB-068）。**
 * 两者本来就是同一件事的两半（一个管「目录 + 文件名」，一个管「按天怎么分」），
 * 各占一个 tab 只会让「产出放哪」这件事要看两个地方。
 * 因此这里**只剩内容**，标题由 `ChannelSection` 的小节头给 —— 与隔壁「文件命名」同款装配。
 * 外壳的 `flex` / 滚动容器一并去掉：嵌在别人的滚动区里再自带一个，会出现两层滚动条与高度塌陷。
 *
 * 生效值一律走 `resolveProjectPostprocessSlice`（与产出链同一个函数），界面不自己拼一遍
 * 继承 —— 两处各写一遍迟早出现「界面显示一套、实际产出按另一套」。
 */

import { useMemo } from 'react'
import { resolveProjectOverrideChain, resolveProjectPostprocessSlice } from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { usePostprocessGlobalConfig } from '../../postprocess/usePostprocessGlobalConfig'
import type { PostprocessDistributionOverride } from '../../../lib/postprocessMedia'
import type { PostprocessDistributionConfig } from '../../../lib/postprocessDistribution'
import PostprocessDistributionFields from '../../postprocess/PostprocessDistributionFields'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useStore } from '../../../store'
import { isGlobalScope, type ConsoleScope } from '../lib/controlConsoleSections'

interface Props {
  /** 当前作用域：`GLOBAL_NODE_ID`（全局基线）或某个节点 id，由左侧树驱动 */
  scope: ConsoleScope
}

export function DistributionSection({ scope }: Props) {
  const globalDistribution = usePostprocessMediaStore((state) => state.distribution)
  const patchDistribution = usePostprocessMediaStore((state) => state.patchDistribution)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const collections = useAssetLibraryStore((state) => state.collections)
  const globalConfig = usePostprocessGlobalConfig()
  const showToast = useStore((state) => state.showToast)

  const isGlobal = isGlobalScope(scope)
  /** 这个节点自己写了排期没有。`undefined` = 没表态（继续向上继承）。 */
  const own: PostprocessDistributionOverride | undefined = isGlobal
    ? undefined
    : params[scope]?.postprocess?.distribution

  const effective = useMemo(
    () =>
      isGlobal
        ? globalDistribution
        : resolveProjectPostprocessSlice(collections, params, scope, globalConfig).config.distribution,
    [collections, globalConfig, globalDistribution, isGlobal, params, scope],
  )

  /** 没表态时这份值是从哪儿继承来的 ——「跟随 快手」比「继承中」有用得多。 */
  const sourceHint = useMemo(() => {
    if (isGlobal) return '全局基线'
    const chain = resolveProjectOverrideChain(collections, params, scope)
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const entry = chain[index]
      if (entry.collectionId === scope) continue
      if (!entry.override.distribution) continue
      return `跟随 ${collections.find((item) => item.id === entry.collectionId)?.name ?? entry.collectionId}`
    }
    return '跟随全局基线'
  }, [collections, isGlobal, params, scope])

  /**
   * 写回。**排期按作用域、其余一律写全局** —— 一张卡片里两拨字段落点不同，这里必须分开投递，
   * 否则节点上改「铺几天」会把目标目录一起写进节点覆盖（那是全局口径，不该跟节点走）。
   */
  const onChange = (patch: Partial<PostprocessDistributionConfig>) => {
    if (isGlobal) {
      patchDistribution(patch)
      return
    }
    const schedule: PostprocessDistributionOverride = {}
    if (patch.days !== undefined) schedule.days = patch.days
    if (patch.skipWeekends !== undefined) schedule.skipWeekends = patch.skipWeekends
    if (Object.keys(schedule).length > 0) {
      setPostprocessOverride(scope, { distribution: { ...own, ...schedule } })
    }
    const rest: Partial<PostprocessDistributionConfig> = { ...patch }
    delete rest.days
    delete rest.skipWeekends
    if (Object.keys(rest).length > 0) patchDistribution(rest)
  }

  /** 恢复继承：`undefined` 表示这个方向不表态（不是空对象，空对象是「什么都覆盖」）。 */
  const resetSchedule = () => {
    if (isGlobal) return
    setPostprocessOverride(scope, { distribution: undefined })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-3 dark:border-ds-border dark:bg-ds-scrim">
        <PostprocessDistributionFields
          config={effective}
          onChange={onChange}
          onPickError={() => showToast('选择目录失败，请重试', 'error')}
          scheduleScope={
            isGlobal
              ? undefined
              : {
                  overridden: own !== undefined,
                  sourceHint,
                  onReset: resetSchedule,
                }
          }
        />
      </div>
    </div>
  )
}
