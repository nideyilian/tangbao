/**
 * 配方卡「问题清单」的渲染件（面板与详情弹窗共用）。
 *
 * 为什么要共用一份渲染：**数字与明细必须同源**。上一版是「徽章在一处算、明细在另一处渲染」，
 * 于是出现了「报着 N 条、只看到 M 行」这种对不上的情况（TB-148）。现在条数只有
 * `problems.length` 一个来源，两个变体渲染的都是同一份数组，从结构上不可能漂移。
 *
 * 两个变体：
 * - `panel`：配方卡面板上那块小地方，只铺前几条（标题 + 位置 + 一个「定位」），
 *   剩下的报一句「另外还有 N 条」并把入口指给「查看解析结果」——
 *   外面那块版面本来就被录入区挤着，铺全了会把内容概览挤没。
 * - `dialog`：详情弹窗里铺全量：标题 + 位置 + **怎么改** + 动作按钮 + 红线分组头。
 *
 * 这个组件**不认识业务**：定位交给 `onLocate`、修复动作交给 `onAction`，
 * 由调用方映射到自己的回调（面板要能开弹窗、弹窗能就地改 config，两者的路由不一样）。
 * 两个回调都不传时只剩纯文本（只读场景不留一堆点不动的按钮）。
 */
import { Button } from '../../design-system'
import {
  REDLINE_GROUP_SUMMARY,
  summarizeRecipeProblems,
  type RecipeProblem,
  type RecipeProblemAction,
  type RecipeProblemTarget,
} from './campaignRecipeProblems'

export interface CampaignRecipeProblemListProps {
  problems: readonly RecipeProblem[]
  variant?: 'panel' | 'dialog'
  /** 面板变体最多铺几条（默认 2）。 */
  limit?: number
  /** 「定位」被点：由调用方决定怎么跳（可能要先开弹窗、或跳到弹窗外面的字段）。 */
  onLocate?: (target: RecipeProblemTarget) => void
  /** 修复型动作（加维度 / 删候选值 / 加白 / 插入或删除占位符 / 重新解析）。 */
  onAction?: (action: RecipeProblemAction) => void
}

export function CampaignRecipeProblemList({
  problems,
  variant = 'dialog',
  limit = 2,
  onLocate,
  onAction,
}: CampaignRecipeProblemListProps) {
  if (problems.length === 0) return null

  const { total, blocking } = summarizeRecipeProblems(problems)
  const compact = variant === 'panel'
  const shown = compact ? problems.slice(0, limit) : problems
  const hiddenCount = total - shown.length
  const redlineCount = shown.filter((problem) => problem.group === 'redline').length

  return (
    <section className="sop-recipe-problems" aria-label="配方卡问题清单" data-recipe-problem-count={total}>
      {/* 面板变体不报数：那块地方已经有徽章与入口按钮在报同一个数（同源，但不该说三遍） */}
      {!compact && (
        <div className="sop-recipe-problems__head">
          <strong>{total} 个问题</strong>
          <span>
            {blocking > 0 ? `${blocking} 处必须先处理，否则这张卡生成不出来` : '都不影响生成，收紧一下会更稳'}
          </span>
        </div>
      )}

      {/* 红线分组头：沿用 TB-144 那块复核区的标题与说明口径（命中项的处置动作已并入条目本身） */}
      {!compact && redlineCount > 0 && (
        <div className="sop-recipe-problems__head">
          <strong>红线复核 · 本次命中 {redlineCount} 处</strong>
          <span>{REDLINE_GROUP_SUMMARY}</span>
        </div>
      )}

      {shown.map((problem) => {
        const usable = problem.actions.filter((action) =>
          action.kind === 'locate' ? Boolean(onLocate) : Boolean(onAction),
        )
        // 推荐动作排前面：修复型（真把问题解决掉）优先于「定位」（只是带路）
        const primaryIndex = Math.max(
          0,
          usable.findIndex((action) => action.kind !== 'locate'),
        )
        return (
          <article
            key={problem.id}
            className={`sop-recipe-problem sop-recipe-problem--${problem.level}`}
            data-recipe-problem-id={problem.id}
          >
            <span className="sop-recipe-problem__dot" aria-hidden="true" />
            <div className="sop-recipe-problem__body">
              <p className="sop-recipe-problem__title">{problem.title}</p>
              {problem.location && <p className="sop-recipe-problem__location">位置：{problem.location}</p>}
              {/* 建议两个变体都渲染：杰哥报的就是「提示没有修改策略」这件事 ——
                  外面那几行如果只有标题，等于把老问题又留在了外面。 */}
              {problem.advise && <p className="sop-recipe-problem__advise">{problem.advise}</p>}

              <div className="sop-recipe-problem__actions">
                {compact
                  ? problem.target &&
                    onLocate && (
                      <Button size="sm" variant="secondary" onClick={() => onLocate(problem.target!)}>
                        定位
                      </Button>
                    )
                  : usable.map((action, index) => (
                      <Button
                        key={`${problem.id}-${action.kind}-${index}`}
                        size="sm"
                        variant={index === primaryIndex ? 'primary' : 'secondary'}
                        onClick={() => {
                          if (action.kind === 'locate') onLocate?.(action.target)
                          else onAction?.(action)
                        }}
                      >
                        {action.label}
                      </Button>
                    ))}
              </div>
            </div>
          </article>
        )
      })}

      {hiddenCount > 0 && (
        <p className="sop-recipe-problem__location">另外还有 {hiddenCount} 条，点「查看解析结果」看全部。</p>
      )}
    </section>
  )
}
