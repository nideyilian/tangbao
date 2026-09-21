/**
 * 中控台 · 「渠道与尺寸」分区。
 *
 * **2026-09-21 表格化（TB-060）**：这个分区原来有两套视图 —— 渠道分组卡片（看板）
 * 与折叠式规格编辑器（改）。同一份数据要两个视图才表达完，且改一个尺寸要先展开渠道、
 * 再逐字段点。现在两套合一：看板要表达的信息全部落在渠道表的列上
 * （渠道名 / 参与产出 / 尺寸数 / 可用尺寸），规格增删改也在同一张表里就地完成。
 * **信息无损失，少了一套视图。**
 *
 * 卡片看板当年是照「灵境 · 资产中心」复刻的（分组头 `N / M 已应用` 徽章、组内尺寸卡片带
 * `渠道 + 宽高` / `横竖标签` / `体积上限`）。这些信息一个没丢：「N / M」拆成
 * 「尺寸数 / 可用尺寸」两列，「横竖」是尺寸表里由宽高推导的只读列，「体积上限」是尺寸表的一列。
 * 真正去掉的是**重复表达**。
 *
 * 两个**刻意留在表格之外**的控件：
 * - 「画面方向」是整批三选一，不是某一条记录的字段，进表格只会更难读；
 * - 「纯净版」不是渠道（它不产渠道变体），放进渠道表会让「尺寸数 / 可用尺寸」对它失去意义。
 *
 * ## ⚠️ 一分为二：规格是全局的，参与是方向级的（ADR-0013，2026-09-21）
 *
 * 这个分区里其实是**两类**东西，原先被当成一类：
 *
 * | 内容                                 | 层级     | 存哪                        |
 * | ------------------------------------ | -------- | --------------------------- |
 * | 渠道名 / 尺寸规格 / 体积上限         | 全局一套 | `usePostprocessMediaStore`  |
 * | **这个方向投哪几个渠道**（参与产出） | 方向级   | 节点覆盖 `selectedMediaIds` |
 *
 * 原先「参与产出」也放全局，于是选某个方向、改的却是所有方向共用的那份勾选，还得挂一句
 * 「全局设置，所有方向共用」的提示条 —— 用户没法表达「A 方向投头条、B 方向不投」。
 * 现在它跟作用域走：**全局作用域改的是基线，节点作用域改的是这个方向自己那份**，
 * 未表态的方向沿树向上继承（与输出目录、水印归属同一套规则）。所以本分区**不再**是 `globalOnly`。
 *
 * 生效值走 `resolveProjectPostprocessSlice`（产出链用的同一个函数），而不是界面上自己再拼一遍 ——
 * 两处各写一遍继承逻辑，迟早会出现「界面显示一套、实际产出按另一套」。
 *
 * **2026-09-20 追加「画面方向」**：它决定「每个渠道取用哪一组尺寸」，与渠道表是同一件事的两半。
 * 原先挂在后处理弹窗的全局作用域里，弹窗收窄为方向级参数后搬到这里。
 * 顺带改掉了原字段说明的自相矛盾（原文写「跟随源图方向自动判定，不提供手选覆盖」，
 * 而界面上给的却是一个可手选的分段控件）。
 */

import { useMemo } from 'react'
import { Badge, Button, Checkbox, Inline, SectionHeader, SegmentedControl } from '../../../design-system'
import { DIRECTION_OPTIONS, FIT_MODE_OPTIONS, PURE_MEDIA_ID } from '../../../lib/postprocessMedia'
import { pruneSelectedMediaIds, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { resolveProjectOverrideChain, resolveProjectPostprocessSlice } from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { usePostprocessGlobalConfig } from '../../postprocess/usePostprocessGlobalConfig'
import type { CompositeV2FitMode } from '../lib/compositeV2Types'
import { isGlobalScope, type ConsoleScope } from '../lib/controlConsoleSections'
import { ConsoleMediaTables } from './ConsoleMediaTables'

interface Props {
  /** 当前作用域：`GLOBAL_NODE_ID`（全局基线）或某个方向节点 id，由左侧树驱动 */
  scope: ConsoleScope
}

/**
 * 每种适配模式的代价，只显示**当前选中**的那一条。
 *
 * 必须逐条说清代价：三个选项都能「把图放进画布」，差别全在代价上（丢边缘 / 带模糊边 / 变形）。
 * 只给三个名字让人选，往往是产出跑完才发现不对，得整批重跑。
 */
const FIT_MODE_HINT: Record<CompositeV2FitMode, string> = {
  'crop-fill': '等比放大填满、超出的边裁掉：画面不变形，代价是丢边缘内容。',
  'contain-blur': '完整画面居中、四周补原图模糊底：画面不丢不变形，代价是带模糊边，对留白敏感的渠道可能不收。',
  stretch: '直接铺满：画面不丢，代价是比例被改变（会变形）。',
}

export function MediaSection({ scope }: Props) {
  const media = usePostprocessMediaStore((state) => state.media)
  const globalSelectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const setSelectedMediaIds = usePostprocessMediaStore((state) => state.setSelectedMediaIds)
  const direction = usePostprocessMediaStore((state) => state.direction)
  const setDirection = usePostprocessMediaStore((state) => state.setDirection)
  const fitMode = usePostprocessMediaStore((state) => state.fitMode)
  const setFitMode = usePostprocessMediaStore((state) => state.setFitMode)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const collections = useAssetLibraryStore((state) => state.collections)
  const globalConfig = usePostprocessGlobalConfig()

  const isGlobal = isGlobalScope(scope)
  const scopeNode = useMemo(
    () => (isGlobal ? undefined : collections.find((item) => item.id === scope)),
    [collections, isGlobal, scope],
  )

  /**
   * 本级有没有写过这个字段。`undefined` = 没表态（继续向上继承）。
   *
   * 这是 `OutputSection` 里「留空 = 继承」的数组版判法 —— **不能看 `length`**：
   * 空数组是有效值，表示「这个方向一个渠道都不投」。
   */
  const ownSelectedMediaIds = isGlobal ? undefined : params[scope]?.postprocess?.selectedMediaIds

  /** 生效的参与渠道（节点作用域沿树继承）。产出链读的是同一个函数，界面不会与产出分叉。 */
  const effectiveSelectedMediaIds = useMemo(
    () =>
      isGlobal
        ? globalSelectedMediaIds
        : resolveProjectPostprocessSlice(collections, params, scope, globalConfig).config.selectedMediaIds,
    [collections, globalConfig, globalSelectedMediaIds, isGlobal, params, scope],
  )

  /**
   * 本级没表态时，这个值是从哪儿继承来的 ——「跟随「产品名」」比「继承中」有用得多。
   * 链是根在前、自身在最后，所以从后往前找第一个写了本字段的环。
   */
  const inheritedFromLabel = useMemo(() => {
    if (isGlobal || ownSelectedMediaIds !== undefined) return '全局默认'
    const chain = resolveProjectOverrideChain(collections, params, scope)
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const entry = chain[index]
      if (entry.collectionId === scope) continue
      if (entry.override.selectedMediaIds === undefined) continue
      return collections.find((item) => item.id === entry.collectionId)?.name ?? entry.collectionId
    }
    return '全局默认'
  }, [collections, isGlobal, ownSelectedMediaIds, params, scope])

  /** 写回当前作用域。都**整份重写**：数组顺序即产出顺序，逐项增删表达不出顺序变化。 */
  const writeSelectedMediaIds = (next: string[]) => {
    const pruned = pruneSelectedMediaIds(media, next)
    if (isGlobal) {
      setSelectedMediaIds(pruned)
      return
    }
    setPostprocessOverride(scope, { selectedMediaIds: pruned })
  }

  const toggleSelected = (mediaId: string, next: boolean) => {
    const has = effectiveSelectedMediaIds.includes(mediaId)
    if (has === next) return
    writeSelectedMediaIds(
      next ? [...effectiveSelectedMediaIds, mediaId] : effectiveSelectedMediaIds.filter((id) => id !== mediaId),
    )
  }

  /** 纯净版不是渠道（不产渠道变体），但同样是一个可勾选的产出项，所以单独一栏。 */
  const pureMedia = media.find((item) => item.id === PURE_MEDIA_ID) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <SectionHeader
          title="渠道与尺寸"
          description={
            isGlobal
              ? '全局共享规格：每个渠道产出哪些尺寸、体积上限多少。这里的「参与产出」是基线，某个方向要不一样，在左边树里点它再改。'
              : '渠道名与尺寸规格是所有方向共用的一份；这里改的是这个方向投哪几个渠道。'
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {/*
         * 参与产出的来源。节点作用域下必须说清「这一格现在是谁说了算」：
         * 有本级值就给一条退路（改回跟随上级），没有就说清跟的是谁。
         */}
        {!isGlobal && (
          <div className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 dark:bg-ds-surface-subtle">
            <Inline gap={2} wrap={false}>
              <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">参与渠道</span>
              {ownSelectedMediaIds === undefined ? (
                <span className="truncate text-xs text-ds-text dark:text-ds-text">跟随「{inheritedFromLabel}」</span>
              ) : (
                <>
                  <Badge tone="info">本级自定义</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    // 置 `undefined`（= 恢复继承）而不是 `[]`：`[]` 是「一个渠道都不投」，那是另一个意思
                    onClick={() => setPostprocessOverride(scope, { selectedMediaIds: undefined })}
                  >
                    改为跟随上级
                  </Button>
                </>
              )}
              <span className="min-w-0 flex-1" />
              <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">
                {scopeNode?.name ?? '已删除节点'}
              </span>
            </Inline>
          </div>
        )}

        {/*
         * 画面方向：它决定「每个渠道取用哪一组尺寸」，与下面的渠道表是同一件事的两半，
         * 所以放在最上面而不是另开分区。
         * 默认「跟随尺寸」即按源图比例自动判，只有要整批强制横/竖时才需要动它。
         *
         * ⚠️ 它仍是**全局一套**（ADR-0011 没有把它开放到节点层）—— 所以在节点作用域里
         * 要显式标出来，否则会被上面那条「跟随/本级自定义」的来源提示连带误导。
         */}
        <section
          data-layout="console-direction"
          className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-ds-text dark:text-ds-text">
                画面方向
                <span className="ml-2 text-xs font-normal text-ds-muted dark:text-ds-muted">全局一套</span>
              </p>
              <p className="text-xs text-ds-muted dark:text-ds-muted">
                决定每个渠道取用哪一组尺寸。默认按源图比例自动判，需要整批强制横 / 竖时在这里覆盖。
              </p>
            </div>
            <div className="ml-auto shrink-0">
              <SegmentedControl
                aria-label="画面方向"
                value={direction ?? 'auto'}
                options={DIRECTION_OPTIONS}
                onValueChange={(value) => setDirection(value === 'auto' ? null : value)}
              />
            </div>
          </div>
        </section>

        {/*
         * 「画面适配」：与「画面方向」并排的另一个**整批规格** ——
         * 方向决定每个渠道取用哪一组尺寸，适配决定源图怎么放进那组尺寸，两者配合才是一张成品。
         *
         * 同样是**全局一套**（不做方向级继承，理由见 `PostprocessMediaConfig.fitMode`）：
         * 产出链读的就是这里写下的值，所以这里不需要「跟随上级 / 本级自定义」那套提示。
         *
         * ⚠️ 它**不动默认值**：默认仍是「裁剪填满」，与这次改动之前的行为一致。
         * 换成模糊填充会产出带模糊边的素材，对留白敏感的渠道可能不收 —— 那是用户的选择，不是默认。
         */}
        <section
          data-layout="console-fit-mode"
          className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-ds-text dark:text-ds-text">
                画面适配
                <span className="ml-2 text-xs font-normal text-ds-muted dark:text-ds-muted">全局一套</span>
              </p>
              {/*
               * 只显示**当前选中**那条的代价：三条一起铺开会把这一区撑成一段说明文字，
               * 而用户做决定时真正要看的只有「我选的这个有什么坑」。
               */}
              <p className="text-xs text-ds-muted dark:text-ds-muted">{FIT_MODE_HINT[fitMode]}</p>
            </div>
            <div className="ml-auto shrink-0">
              <SegmentedControl
                aria-label="画面适配"
                value={fitMode}
                options={FIT_MODE_OPTIONS}
                onValueChange={setFitMode}
              />
            </div>
          </div>
        </section>

        <ConsoleMediaTables
          selectedMediaIds={effectiveSelectedMediaIds}
          onToggleSelected={toggleSelected}
          participationScopeLabel={isGlobal ? '全局基线' : (scopeNode?.name ?? '已删除节点')}
        />

        {/* 纯净版单独一栏：它不是渠道（不产渠道变体），但同样是一个可勾选的产出项，
            塞进渠道表会让「尺寸数 / 可用尺寸」这些列对它失去意义。 */}
        {pureMedia && (
          <section
            data-layout="console-pure-media"
            className="mt-4 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
          >
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={effectiveSelectedMediaIds.includes(pureMedia.id)}
                onChange={(next) => toggleSelected(pureMedia.id, next)}
                aria-label={`${effectiveSelectedMediaIds.includes(pureMedia.id) ? '取消应用' : '应用'}纯净版`}
              />
              <span className="text-sm font-medium text-ds-text dark:text-ds-text">{pureMedia.name}</span>
              <span className="text-xs text-ds-muted dark:text-ds-muted">不产渠道变体，只产一份无水印原图</span>
            </label>
          </section>
        )}
      </div>
    </div>
  )
}
