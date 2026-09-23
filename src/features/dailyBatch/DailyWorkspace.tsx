import { useState } from 'react'
import { Tabs } from '../../design-system'
import { DailyReviewSection } from './DailyReviewSection'
import { DailyScopeTree } from './DailyScopeTree'
import { DailyTargetsSection } from './DailyTargetsSection'
import { StrategyCardsSection } from './StrategyCardsSection'

const SECTIONS = [
  { id: 'review', label: '预览审核' },
  { id: 'cards', label: '策略卡' },
  { id: 'targets', label: '每日任务' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const SECTION_TABS = SECTIONS.map((item) => ({ value: item.id, label: item.label }))

/**
 * 每日生成工作区。
 *
 * 三个分区是同一条流水线的三步，不是三个互不相干的功能：
 * 策略卡（配哪些卡）→ 每日任务（每天出多少、各方向占多少）→ 预览审核（看当天结果、发布）。
 * 卡和数量配一次长期有效，**每天只看「预览审核」**，所以它是默认分区。
 */
export default function DailyWorkspace() {
  const [scopeId, setScopeId] = useState<string | null>(null)
  const [section, setSection] = useState<SectionId>('review')

  return (
    <main
      aria-label="每日生成工作区"
      className="flex h-[calc(100dvh-7rem)] min-h-0 overflow-hidden bg-ds-surface text-ds-text sm:h-[calc(100dvh-var(--app-header-offset))]"
    >
      <DailyScopeTree value={scopeId} onChange={setScopeId} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 分区切换走设计系统 Tabs（TB-110）：选中态用中性 Selection 下划线，符合 MASTER 4.2
            「导航选中态不使用整块品牌色背景」；自带 tablist 语义与左右方向键切换。
            原先手搓按钮、选中态是 bg-ds-primary-subtle（品牌蓝铺底），全应用只此一处。
            底线由 header 承担（DS Tabs 自带 1px 底线，这里用 !border-b-0 让位，避免双线）。 */}
        <header className="shrink-0 border-b border-ds-border px-4">
          <Tabs
            aria-label="每日生成分区"
            className="!border-b-0"
            items={SECTION_TABS}
            onValueChange={setSection}
            value={section}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {section === 'review' && <DailyReviewSection scopeId={scopeId} />}
          {section === 'cards' && <StrategyCardsSection scopeId={scopeId} />}
          {section === 'targets' && <DailyTargetsSection scopeId={scopeId} />}
        </div>
      </div>
    </main>
  )
}
