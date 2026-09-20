import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import {
  formatGenerationStatsDuration,
  getGenerationStats,
  getGenerationStatsRangeLabel,
  getNextGenerationStatsRange,
  type GenerationStatsRange,
  type GenerationStatsTabCount,
} from '../lib/generationStats'
import type { AppMode } from '../types'
import { SegmentedControl } from '../design-system'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { HelpCircleIcon, MoonIcon, SettingsIcon, SunIcon } from './icons'

type GenerationStatsMetricKey = 'total' | 'elapsedMs' | 'success' | 'failure'

// 工作区切换：策略（strategy）与下单（ordering）模块已屏蔽，不再提供入口
const appModeOptions: Array<{ value: AppMode; label: string }> = [
  { value: 'gallery', label: '素材库' },
  { value: 'postprocess', label: '中控台' },
  { value: 'agent', label: 'Agent' },
]
const modeOptions = appModeOptions

function formatGenerationStatsValue(key: GenerationStatsMetricKey, value: number) {
  if (key === 'elapsedMs') return formatGenerationStatsDuration(value)
  return String(value)
}

function getGenerationStatsMetricValueClass(key: GenerationStatsMetricKey) {
  // 令牌本身已按明暗模式给值，无需再补 dark: 变体
  if (key === 'total') return 'text-ds-primary'
  if (key === 'elapsedMs') return 'text-ds-text'
  if (key === 'success') return 'text-ds-success'
  return 'text-ds-danger'
}

function getGenerationStatsMetricLabel(key: GenerationStatsMetricKey) {
  if (key === 'total') return '总数'
  if (key === 'elapsedMs') return '时长'
  if (key === 'success') return '成功'
  return '失败'
}

function GenerationStatsMetric({
  metricKey,
  value,
  tabs,
}: {
  metricKey: GenerationStatsMetricKey
  value: number
  tabs: GenerationStatsTabCount[]
}) {
  const tooltip = useTooltip()
  const label = getGenerationStatsMetricLabel(metricKey)

  return (
    <div className="relative" {...tooltip.handlers}>
      {/* 圆角制度：交互元素统一 pill；间距由父级 gap 控制，本元素不再自带水平 padding */}
      <div className="flex min-w-[3.5rem] flex-col items-start rounded-full px-2.5 py-1 transition-colors hover:bg-ds-surface-subtle">
        <span className="text-xs leading-none text-ds-muted">{label}</span>
        <span className={`mt-0.5 text-xs font-semibold leading-none ${getGenerationStatsMetricValueClass(metricKey)}`}>
          {formatGenerationStatsValue(metricKey, value)}
        </span>
      </div>
      <ViewportTooltip visible={tooltip.visible} className="w-56">
        <div className="space-y-1.5">
          <div className="font-medium text-ds-text">按标签统计：{label}</div>
          {tabs.length ? (
            <div className="space-y-1">
              {tabs.map((tab) => (
                <div key={tab.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-ds-muted">{tab.name}</span>
                  <span className="shrink-0 font-mono text-ds-text">
                    {formatGenerationStatsValue(metricKey, tab[metricKey])}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-ds-muted">暂无标签数据</div>
          )}
        </div>
      </ViewportTooltip>
    </div>
  )
}

function GenerationStatsBar() {
  const tasks = useStore((s) => s.tasks)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const [range, setRange] = useState<GenerationStatsRange>('today')
  const [now, setNow] = useState(Date.now())
  const hasRunningTasks = tasks.some(
    (task) => task.status === 'running' || task.falRecoverable || task.customRecoverable,
  )

  useEffect(() => {
    if (!hasRunningTasks) {
      setNow(Date.now())
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasRunningTasks])

  const stats = useMemo(() => getGenerationStats(tasks, workspaceTabs, range, now), [tasks, workspaceTabs, range, now])
  const metrics: Array<{ key: GenerationStatsMetricKey; value: number }> = [
    { key: 'total', value: stats.totals.total },
    { key: 'elapsedMs', value: stats.totals.elapsedMs },
    { key: 'success', value: stats.totals.success },
    { key: 'failure', value: stats.totals.failure },
  ]

  // 层级制度：只用 1px 描边表达层级，不再叠 阴影 / 半透明底 / 嵌套卡片。
  // 原实现在边框卡片里又放了一个带 shadow-sm 的按钮，形成「三层浮起」，与同排图标按钮的平面语言冲突。
  return (
    <div className="hidden lg:flex items-center gap-1 rounded-full border border-ds-border bg-ds-surface px-1.5 py-1 text-xs">
      {metrics.map((metric) => (
        <GenerationStatsMetric key={metric.key} metricKey={metric.key} value={metric.value} tabs={stats.byTab} />
      ))}
      <button
        type="button"
        onClick={() => setRange((current) => getNextGenerationStatsRange(current))}
        className="ml-0.5 min-w-[3rem] rounded-full bg-ds-surface-subtle px-2.5 py-1.5 text-xs font-medium leading-none text-ds-text transition-colors hover:bg-ds-border"
        title="切换统计范围"
      >
        {getGenerationStatsRangeLabel(range)}
      </button>
    </div>
  )
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const themeMode = useStore((s) => s.settings.themeMode)
  const setSettings = useStore((s) => s.setSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = appMode === 'gallery' && Boolean(activeFavoriteCollectionId)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')

  // 三个工作区一视同仁地切：水印预设与素材库、Agent 一样是 tab，不再是盖在素材库上的弹窗
  const handleModeChange = (mode: AppMode) => setAppMode(mode)

  useEffect(() => {
    if (appMode === 'agent') {
      setScrollDirection('up')
      return
    }

    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          if (currentScrollY < 20) {
            setScrollDirection('up')
          } else if (currentScrollY > lastScrollY + 10) {
            setScrollDirection('down')
          } else if (currentScrollY < lastScrollY - 10) {
            setScrollDirection('up')
          }
          lastScrollY = currentScrollY
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [appMode])

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => {
        setHintVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  const helpTooltip = useTooltip()
  const themeTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const nextThemeMode = themeMode === 'dark' ? 'light' : 'dark'
  const themeTooltipText = nextThemeMode === 'dark' ? '切换深色主题' : '切换浅色主题'

  return (
    <>
      <header
        data-no-drag-select
        data-theme-transition
        className={`safe-area-top fixed top-0 left-0 right-0 z-sticky bg-ds-surface border-b border-ds-border transition-transform duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}
      >
        {/* 间距制度：水平间距一律由父级 gap 控制，子元素不再用 mr-N / ml-N 各自推 */}
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center gap-2 relative">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <h1 className="inline-flex min-w-0 items-start relative">
              {showFavoriteCollectionTitle ? (
                <>
                  <span
                    className="min-w-0 truncate text-ds-lg font-bold tracking-tight text-ds-text sm:hidden"
                    title={favoriteCollectionTitle}
                  >
                    {favoriteCollectionTitle}
                  </span>
                  <a
                    href="https://github.com/nideyilian/tangbao"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden items-center gap-2 text-ds-lg font-bold tracking-tight text-ds-text transition-colors hover:text-ds-muted sm:inline-flex"
                  >
                    <img src="./app-icon.png" alt="" className="h-6 w-6 rounded-full" />
                    糖包
                  </a>
                </>
              ) : (
                <a
                  href="https://github.com/nideyilian/tangbao"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-ds-lg font-bold tracking-tight text-ds-text transition-colors hover:text-ds-muted"
                >
                  <img src="./app-icon.png" alt="" className="h-6 w-6 rounded-full" />
                  糖包
                </a>
              )}
              {hasUpdate && latestRelease && (
                <a
                  href={latestRelease.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={dismiss}
                  className="absolute -right-1 -top-1 translate-x-full -translate-y-1/4 px-1 py-0.5 rounded-sm border border-ds-danger/30 text-xs font-black bg-ds-danger text-ds-text-inverse hover:bg-ds-danger-hover transition animate-fade-in leading-none"
                  title={`新版本 ${latestRelease.tag}`}
                >
                  NEW
                </a>
              )}
            </h1>
          </div>
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div
                className="truncate rounded-full px-2 py-1 text-sm font-semibold text-ds-text"
                title={favoriteCollectionTitle}
              >
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          <GenerationStatsBar />
          <div className="hidden sm:block">
            <SegmentedControl
              aria-label="切换工作区"
              value={appMode}
              options={modeOptions}
              onValueChange={handleModeChange}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className="relative" {...themeTooltip.handlers}>
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setSettings({ themeMode: nextThemeMode })
                }}
                className="p-2 rounded-full text-ds-muted hover:bg-ds-surface-subtle hover:text-ds-text transition-colors"
                aria-label={themeTooltipText}
              >
                {themeMode === 'dark' ? (
                  <SunIcon className="w-5 h-5 text-current" />
                ) : (
                  <MoonIcon className="w-5 h-5 text-current" />
                )}
              </button>
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                {themeTooltipText}
              </ViewportTooltip>
            </div>
            <div className="relative" {...helpTooltip.handlers}>
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-full text-ds-muted hover:bg-ds-surface-subtle hover:text-ds-text transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-current" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div className="relative" {...settingsTooltip.handlers}>
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-full text-ds-muted hover:bg-ds-surface-subtle hover:text-ds-text transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5 text-current" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
        <div
          className={`safe-area-x sm:hidden overflow-hidden transition duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}
        >
          <SegmentedControl
            aria-label="切换工作区"
            value={appMode}
            options={modeOptions}
            onValueChange={handleModeChange}
            size="sm"
            className="app-mode-switcher--mobile mx-2"
          />
        </div>
      </header>

      {/* Hint for sliding down */}
      <div
        className={`fixed top-0 left-0 right-0 z-sticky flex justify-center pointer-events-none transition duration-300 ease-in-out sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}
      >
        <div className="bg-ds-scrim/85 backdrop-blur-sm text-ds-text-inverse text-xs px-3 py-1.5 rounded-b-ds-lg">
          下拉展示顶栏
        </div>
      </div>

      <div
        className={`safe-area-top invisible pointer-events-none transition duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`}
        aria-hidden="true"
      >
        <div className="safe-header-inner" />
        <div
          className={`safe-area-x sm:hidden overflow-hidden transition duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}
        >
          <div className="p-1">
            <div className="py-1.5 text-sm">占位</div>
          </div>
        </div>
      </div>
      {showHelp && (
        <HelpModal
          appMode={appMode}
          isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId}
          onClose={() => setShowHelp(false)}
        />
      )}
    </>
  )
}
