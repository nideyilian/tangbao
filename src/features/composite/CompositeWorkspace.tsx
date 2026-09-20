import { useEffect, useMemo, useState } from 'react'
import { SegmentedControl } from '../../design-system'
import {
  CONTROL_CONSOLE_SECTIONS,
  DEFAULT_CONTROL_CONSOLE_SECTION,
  isGlobalScope,
  normalizeControlConsoleSection,
  type ControlConsoleSectionId,
  type ConsoleScope,
} from './lib/controlConsoleSections'
import { ConsoleAssetTree } from './components/ConsoleAssetTree'
import { DistributionSection } from './components/DistributionSection'
import { MediaSection } from './components/MediaSection'
import { OutputSection } from './components/OutputSection'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { resolveCollectionPath } from '../../lib/postprocessProjectTree'
import { GLOBAL_NODE_ID } from '../postprocess/paramSchema'
import { useCompositeV2Store } from './storeV2'

/**
 * 中控台（顶栏 tab，原「水印预设」工作区）。
 *
 * 形态完全对齐「灵境 · 策略中心」（strategy/center，2026-09-20 登录实测）：
 * **左树 + 右内容**。左栏「配置资产库」= 搜索 + 全局默认总览项 + 项目树
 * （节点带覆盖计数徽章）；右区 = 当前作用域标题 + 分区切换工具栏 + 分区内容。
 * 树决定「改谁」（作用域），分区决定「改什么」——
 * 点树节点 = 切作用域，右区从此编辑该节点的覆盖值。
 *
 * **作用域是工作区级的**：分区共用同一个 `scope`，切分区不重置。
 * 作用域由左树驱动（第三轮的下拉选择器已升级为这棵树）。
 *
 * ⚠️ 一条硬约束：**中控台是全部参数的统一编辑入口**（TB-053 第三轮定调）。
 * 有节点级可覆盖字段的分区就地编辑；纯全局分区（渠道与尺寸 / 分发）不消费作用域。
 *
 * 顶栏 `SegmentedControl` 的一个 tab，与素材库 / Agent 同级。
 *
 * 原来这里还装着「批量导出」（四步向导 + 分发排期 + 输出规则 + 历史），
 * 它已随编排职责统一到后处理那一套而退役。
 * 此处保留的是不可替代的部分：图层式水印预设编辑器（瀚灵只有单张水印图）。
 */
export default function CompositeWorkspace() {
  const canUndo = useCompositeV2Store((state) => state.canUndo)
  const undo = useCompositeV2Store((state) => state.undo)
  const collections = useAssetLibraryStore((state) => state.collections)
  const [section, setSection] = useState<ControlConsoleSectionId>(DEFAULT_CONTROL_CONSOLE_SECTION)
  const [scope, setScope] = useState<ConsoleScope>(GLOBAL_NODE_ID)

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

  /** 右区标题 = 当前作用域名；节点被删后静默退回「全局默认」（树内同口径兜底） */
  const scopeTitle = useMemo(() => {
    if (isGlobalScope(scope)) return '全局默认'
    return collections.find((item) => item.id === scope)?.name ?? '全局默认'
  }, [collections, scope])

  /** 面包屑路径（产品线 / 产品 / 方向），对齐灵境卡片说明里的归属写法 */
  const scopePath = useMemo(() => {
    if (isGlobalScope(scope)) return '对所有未单独设置的节点生效'
    return resolveCollectionPath(collections, scope)
      .map((item) => item.name)
      .join(' / ')
  }, [collections, scope])

  return (
    // 高度对齐另外两个工作区：顶栏在自己的 return 里放了一块等高的 `invisible` 占位，
    // 所以这里按「视口 - 顶栏高度」算即可。窄屏顶栏多一行工作区切换，与素材库同口径取 7rem。
    <main
      aria-label="中控台工作区"
      className="flex h-[calc(100dvh-7rem)] min-h-0 overflow-hidden bg-ds-surface text-ds-text sm:h-[calc(100dvh-var(--app-header-offset))] dark:bg-ds-scrim dark:text-ds-text-subtle"
    >
      <ConsoleAssetTree value={scope} onValueChange={setScope} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
        <header className="mb-3 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-ds-text dark:text-ds-text">{scopeTitle}</h1>
            <p className="truncate text-xs text-ds-muted dark:text-ds-muted">
              {scopePath} · {active.description}
            </p>
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
          {section === 'output' && <OutputSection scope={scope} />}
          {section === 'distribution' && <DistributionSection />}
        </div>
      </div>
    </main>
  )
}
