import { useEffect } from 'react'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useCompositeV2Store } from './storeV2'

/**
 * 水印预设工作区。
 *
 * 原来这里是「后期处理工作区」，装着「批量导出」与「预设管理」两个 tab。
 * 批量导出（四步向导 + 分发排期 + 输出规则 + 历史）已随编排职责统一到
 * `features/postprocess` 那一套而退役——同一件事不该有两个入口、两套配置来源。
 * 此处保留的是不可替代的部分：图层式水印预设编辑器（瀚灵只有单张水印图）。
 *
 * 编排退场后仍是「工作区」而非普通面板：它自带撤销栈与画布编辑快捷键。
 */
export default function CompositeWorkspace({ embedded = false }: { embedded?: boolean }) {
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
    <main
      aria-label="水印预设工作区"
      className={`flex min-h-0 flex-col overflow-hidden bg-ds-surface p-4 text-ds-text dark:bg-ds-scrim dark:text-ds-text-subtle ${
        embedded ? 'h-full' : 'h-[calc(100vh-var(--app-header-offset))]'
      }`}
    >
      <PresetManagementTab />
    </main>
  )
}
