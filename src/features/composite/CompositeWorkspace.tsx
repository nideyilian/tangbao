import { useEffect } from 'react'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useCompositeV2Store } from './storeV2'

/**
 * 水印预设工作区。
 *
 * 顶栏 `SegmentedControl` 的一个 tab，与素材库 / Agent 同级——不再盖在素材库上的弹窗。
 * 归属要边看项目树边配，「盖一层」会让下层内容既不可用又占着版面；而且它是唯一自带
 * 撤销栈与画布编辑快捷键的编辑面，形态与另外两个工作区本就一致。
 *
 * 原来这里还装着「批量导出」（四步向导 + 分发排期 + 输出规则 + 历史），
 * 它已随编排职责统一到后处理那一套而退役——同一件事不该有两个入口、两套配置来源。
 * 此处保留的是不可替代的部分：图层式水印预设编辑器（瀚灵只有单张水印图）。
 */
export default function CompositeWorkspace() {
  const canUndo = useCompositeV2Store((state) => state.canUndo)
  const undo = useCompositeV2Store((state) => state.undo)

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
      aria-label="水印预设工作区"
      className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col overflow-hidden bg-ds-surface p-4 text-ds-text sm:h-[calc(100dvh-var(--app-header-offset))] dark:bg-ds-scrim dark:text-ds-text-subtle"
    >
      <PresetManagementTab />
    </main>
  )
}
