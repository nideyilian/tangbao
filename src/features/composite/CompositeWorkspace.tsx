import { useEffect, useState } from 'react'
import { SegmentedControl } from '../../design-system'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useCompositeV2Store } from './storeV2'

/**
 * 中控台（顶栏 tab，原「水印预设」工作区）。
 *
 * 形态对齐「灵境 · 资产中心」：资产中心不把水印当成一个独立页面，而是**产品资料下的一个
 * 配置维度**（与渠道与尺寸 / 输出位置并列的 tab）。糖包照这个口径重组——水印从「整个 tab
 * 就是水印」变成**中控台里的一个功能**，与渠道规格、输出位置平级。
 *
 * 顶栏 `SegmentedControl` 的一个 tab，与素材库 / Agent 同级。归属要边看项目树边配，
 * 「盖一层」会让下层内容既不可用又占着版面；而且它是唯一自带撤销栈与画布编辑快捷键的
 * 编辑面，形态与另外两个工作区本就一致。
 *
 * 原来这里还装着「批量导出」（四步向导 + 分发排期 + 输出规则 + 历史），
 * 它已随编排职责统一到后处理那一套而退役——同一件事不该有两个入口、两套配置来源。
 * 此处保留的是不可替代的部分：图层式水印预设编辑器（瀚灵只有单张水印图）。
 */

/** 中控台的功能分区。第一个是默认区，也是历史行为唯一的入口。 */
const CONTROL_CONSOLE_SECTIONS = [{ value: 'watermark', label: '水印' }] as const

type ControlConsoleSection = (typeof CONTROL_CONSOLE_SECTIONS)[number]['value']

export default function CompositeWorkspace() {
  const canUndo = useCompositeV2Store((state) => state.canUndo)
  const undo = useCompositeV2Store((state) => state.undo)
  const [section, setSection] = useState<ControlConsoleSection>('watermark')

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

  return (
    // 高度对齐另外两个工作区：顶栏在自己的 return 里放了一块等高的 `invisible` 占位，
    // 所以这里按「视口 - 顶栏高度」算即可。窄屏顶栏多一行工作区切换，与素材库同口径取 7rem。
    <main
      aria-label="中控台工作区"
      className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col overflow-hidden bg-ds-surface p-4 text-ds-text sm:h-[calc(100dvh-var(--app-header-offset))] dark:bg-ds-scrim dark:text-ds-text-subtle"
    >
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-ds-text dark:text-ds-text">中控台</h1>
          <p className="truncate text-xs text-ds-muted dark:text-ds-muted">
            水印归属与参数在这里统一配置；每个功能一个分区，改哪一块就切到哪一块。
          </p>
        </div>
        <SegmentedControl
          aria-label="切换中控台功能"
          value={section}
          onValueChange={(value) => setSection(value as ControlConsoleSection)}
          options={CONTROL_CONSOLE_SECTIONS.map((option) => ({ ...option }))}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {section === 'watermark' && <PresetManagementTab />}
      </div>
    </main>
  )
}
