import { useEffect, useState } from 'react'
import { SegmentedControl } from '../../design-system'
import {
  CONTROL_CONSOLE_SECTIONS,
  DEFAULT_CONTROL_CONSOLE_SECTION,
  normalizeControlConsoleSection,
  type ControlConsoleSectionId,
} from './lib/controlConsoleSections'
import { DistributionSection } from './components/DistributionSection'
import { MediaSection } from './components/MediaSection'
import { OutputSection } from './components/OutputSection'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useCompositeV2Store } from './storeV2'

/**
 * 中控台（顶栏 tab，原「水印预设」工作区）。
 *
 * 形态对齐「灵境 · 资产中心」：资产中心不把水印当成独立页面，而是产品资料下的一批
 * **配置维度**（渠道与尺寸 / 输出位置 / 水印 …），每个维度一个 tab。糖包照这个口径重组——
 * 水印从「整个 tab 就是水印」变成**中控台里的一个功能**，与渠道规格、输出位置平级。
 *
 * 分区表在 `lib/controlConsoleSections.ts`（单一真相源），此处只负责装配与切换。
 *
 * ⚠️ 一条硬约束：**每个分区必须指向「唯一作用域」的参数**。
 * 全局共享规格（渠道与尺寸 / 分发）可以整体搬进来，因为它们本来就只有一个家；
 * 而多层继承的参数（输出位置、水印归属）只能用「全局基线 + 跳转改节点」的形态，
 * 不在中控台里再造一套节点编辑器 —— 见 `PresetProjectTree.tsx` 开头那条铁律。
 *
 * 顶栏 `SegmentedControl` 的一个 tab，与素材库 / Agent 同级。归属要边看项目树边配，
 * 「盖一层」会让下层内容既不可用又占着版面；而且它是唯一自带撤销栈与画布编辑快捷键的
 * 编辑面，形态与另外两个工作区本就一致。
 *
 * 原来这里还装着「批量导出」（四步向导 + 分发排期 + 输出规则 + 历史），
 * 它已随编排职责统一到后处理那一套而退役——同一件事不该有两个入口、两套配置来源。
 * 此处保留的是不可替代的部分：图层式水印预设编辑器（瀚灵只有单张水印图）。
 */
export default function CompositeWorkspace() {
  const canUndo = useCompositeV2Store((state) => state.canUndo)
  const undo = useCompositeV2Store((state) => state.undo)
  const [section, setSection] = useState<ControlConsoleSectionId>(DEFAULT_CONTROL_CONSOLE_SECTION)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'z' || !canUndo) return
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUndo, undo])

  const active = CONTROL_CONSOLE_SECTIONS.find((item) => item.id === section) ?? CONTROL_CONSOLE_SECTIONS[0]!

  return (
    // 高度对齐另外两个工作区：顶栏在自己的 return 里放了一块等高的 `invisible` 占位，
    // 所以这里按「视口 - 顶栏高度」算即可。窄屏顶栏多一行工作区切换，与素材库同口径取 7rem。
    <main
      aria-label="中控台工作区"
      className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col overflow-hidden bg-ds-surface p-4 text-ds-text sm:h-[calc(100dvh-var(--app-header-offset))] dark:bg-ds-scrim dark:text-ds-text-subtle"
    >
      <header className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-ds-text dark:text-ds-text">中控台</h1>
          <p className="truncate text-xs text-ds-muted dark:text-ds-muted">{active.description}</p>
        </div>
        <SegmentedControl
          aria-label="切换中控台功能"
          className="shrink-0"
          value={section}
          onValueChange={(value) => setSection(normalizeControlConsoleSection(value))}
          options={CONTROL_CONSOLE_SECTIONS.map((option) => ({ value: option.id, label: option.label }))}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-ds-lg border border-ds-border dark:border-ds-border">
        {section === 'watermark' && <PresetManagementTab />}
        {section === 'media' && <MediaSection />}
        {section === 'output' && <OutputSection />}
        {section === 'distribution' && <DistributionSection />}
      </div>
    </main>
  )
}
