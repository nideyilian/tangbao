import { useState } from 'react'
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
        <header className="flex items-center gap-1 border-b border-ds-border px-4 py-2">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`rounded-ds-md px-3 py-1.5 text-sm ${
                section === item.id ? 'bg-ds-primary-subtle text-ds-text' : 'text-ds-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
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
