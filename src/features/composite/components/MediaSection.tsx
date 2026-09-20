/**
 * 中控台 · 「渠道与尺寸」分区。
 *
 * **2026-09-21 表格化（TB-060）**：这个分区原来有两套视图 —— 渠道分组卡片（看板）
 * 与折叠式规格编辑器（改）。同一份数据要两个视图才表达完，且改一个尺寸要先展开渠道、
 * 再逐字段点。现在两套合一：看板要表达的信息全部落在渠道表的列上
 * （渠道名 / 参与产出 / 启用 / 尺寸数 / 可用尺寸），规格增删改也在同一张表里就地完成。
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
 * ⚠️ **这个分区是纯全局的，不挂作用域选择器。**
 * 「应用哪些渠道」（`selectedMediaIds`）看起来像节点级参数，但实测类型后确认不是：
 * `PostprocessNodeOverride`（ADR-0011 收窄后）只有 `outputDir` / `watermarkPresetIds` /
 * `enabled` / `byMedia` 四个字段。节点要关掉某个渠道走 `enabled: false`（整个方向不产出），
 * 粒度更粗 —— 那是收窄时明确做的取舍。给了能选节点、选了却什么都不变的控件比不给更糟。
 *
 * **2026-09-20 追加「画面方向」**：它决定「每个渠道取用哪一组尺寸」，与渠道表是同一件事的两半。
 * 原先挂在后处理弹窗的全局作用域里，弹窗收窄为方向级参数后搬到这里。
 * 顺带改掉了原字段说明的自相矛盾（原文写「跟随源图方向自动判定，不提供手选覆盖」，
 * 而界面上给的却是一个可手选的分段控件）。
 */

import { Checkbox, SectionHeader, SegmentedControl } from '../../../design-system'
import { DIRECTION_OPTIONS, PURE_MEDIA_ID } from '../../../lib/postprocessMedia'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { ConsoleMediaTables } from './ConsoleMediaTables'

export function MediaSection() {
  const media = usePostprocessMediaStore((state) => state.media)
  const selectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const toggleSelectedMedia = usePostprocessMediaStore((state) => state.toggleSelectedMedia)
  const direction = usePostprocessMediaStore((state) => state.direction)
  const setDirection = usePostprocessMediaStore((state) => state.setDirection)

  /** 纯净版不是渠道（不产渠道变体），但同样是一个可勾选的产出项，所以单独一栏。 */
  const pureMedia = media.find((item) => item.id === PURE_MEDIA_ID) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <SectionHeader
          title="渠道与尺寸"
          description="全局共享规格：每个渠道产出哪些尺寸、体积上限多少。勾选决定这个渠道是否参与产出，画面方向决定取用哪一组尺寸。"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {/*
         * 画面方向：它决定「每个渠道取用哪一组尺寸」，与下面的渠道表是同一件事的两半，
         * 所以放在最上面而不是另开分区。
         * 默认「跟随尺寸」即按源图比例自动判，只有要整批强制横/竖时才需要动它。
         */}
        <section
          data-layout="console-direction"
          className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-ds-text dark:text-ds-text">画面方向</p>
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

        <ConsoleMediaTables />

        {/* 纯净版单独一栏：它不是渠道（不产渠道变体），但同样是一个可勾选的产出项，
            塞进渠道表会让「尺寸数 / 可用尺寸」这些列对它失去意义。 */}
        {pureMedia && (
          <section
            data-layout="console-pure-media"
            className="mt-4 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
          >
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={selectedMediaIds.includes(pureMedia.id)}
                onChange={() => toggleSelectedMedia(pureMedia.id)}
                aria-label={`${selectedMediaIds.includes(pureMedia.id) ? '取消应用' : '应用'}纯净版`}
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
