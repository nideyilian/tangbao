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
import { Badge, IconButton, SegmentedControl } from '../design-system'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { HelpCircleIcon, MoonIcon, SettingsIcon, SunIcon } from './icons'

type GenerationStatsMetricKey = 'total' | 'elapsedMs' | 'success' | 'failure'

// 工作区切换：策略（strategy）与下单（ordering）模块已屏蔽，不再提供入口
const appModeOptions: Array<{ value: AppMode; label: string }> = [
  { value: 'gallery', label: '素材库' },
  { value: 'daily', label: '每日生成' },
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
      {/* 高度制度：与同排控件一致 36px（--ds-control-md）；圆角 8px —— MASTER 4.5
          把胶囊圆角只留给标签和筛选，交互控件一律用控件圆角。
          水平间距由父级 gap 控制，本元素不自带水平外边距。 */}
      <div className="flex h-ds-control-md min-w-[3.5rem] flex-col items-center justify-center rounded-ds-md px-2 transition-colors hover:bg-ds-surface-subtle">
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

  // 分级制度：4 个指标是一组、范围切换是另一组 —— 组内 gap-1(4px)、组间 gap-3(12px)，
  // 全部由父级控制，两组等高（36px）。
  // 原实现把两组塞进同一个边框胶囊，胶囊里的指标块 34px、范围按钮 24px，同排差 10px；
  // 再叠「胶囊套胶囊 + 各自 pill 圆角」，与同排图标按钮的平面语言冲突（MASTER 4.5）。
  return (
    <div className="hidden lg:flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1">
        {metrics.map((metric) => (
          <GenerationStatsMetric key={metric.key} metricKey={metric.key} value={metric.value} tabs={stats.byTab} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRange((current) => getNextGenerationStatsRange(current))}
        className="h-ds-control-md min-w-[3rem] rounded-ds-md bg-ds-surface-subtle px-3 text-xs font-medium leading-none text-ds-text transition-colors hover:bg-ds-border"
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
        className={`safe-area-top fixed top-0 left-0 right-0 z-sticky bg-ds-surface border-b border-ds-border transition-transform duration-[var(--ds-duration-normal)] ease-[var(--ds-ease-in-out)] ${appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}
      >
        {/* 顶栏是应用壳的一部分，**不加 max-width** —— 它必须与下方工作区标题行共用
            同一条左基线（素材库工具条 / 每日生成分区条 / 中控台标题行都是 16px 内边距）。
            宽度制度的例外说明见 MASTER 4.4：75rem 针对的是「主内容」，不含应用壳。
            间距制度：组内 gap-1(4px)、组间 gap-3(12px)，一律由父级 gap 控制，
            子元素不得用 mr-N / ml-N 各自推。 */}
        <div className="safe-area-x safe-header-inner flex items-center gap-3 relative">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {/* 品牌区垂直居中与整行一致（原来用 items-start，logo 与文字各自贴顶）；
                版本徽章从「绝对定位浮在右上角」改为同排 flex 项，
                否则它的位置靠 translate 魔法数字维持，与「一切对齐到同一条基线」冲突。 */}
            <h1 className="inline-flex min-w-0 items-center gap-2 relative">
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
                  className="shrink-0 animate-fade-in"
                  href={latestRelease.url}
                  onClick={dismiss}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={`新版本 ${latestRelease.tag}`}
                >
                  <Badge tone="danger">NEW</Badge>
                </a>
              )}
            </h1>
          </div>
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div className="truncate px-2 text-sm font-semibold text-ds-text" title={favoriteCollectionTitle}>
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
          {/* 图标按钮统一走设计系统 IconButton（36px 控件高 + 8px 控件圆角 + 描边层级）。
              原先是手搓的 p-2 rounded-full 幽灵按钮，与素材库等处的 IconButton 构成两套图标按钮，
              且 pill 圆角违反 MASTER 4.5「胶囊只留给标签和筛选」。 */}
          <div className="flex items-center gap-1 shrink-0">
            <div className="relative" {...themeTooltip.handlers}>
              <IconButton
                aria-label={themeTooltipText}
                icon={themeMode === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
                onClick={() => {
                  dismissAllTooltips()
                  setSettings({ themeMode: nextThemeMode })
                }}
              />
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                {themeTooltipText}
              </ViewportTooltip>
            </div>
            <div className="relative" {...helpTooltip.handlers}>
              <IconButton
                aria-label="操作指南"
                icon={<HelpCircleIcon className="h-5 w-5" />}
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
              />
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div className="relative" {...settingsTooltip.handlers}>
              <IconButton
                aria-label="设置"
                icon={<SettingsIcon className="h-5 w-5" />}
                onClick={() => setShowSettings(true)}
              />
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
        {/* 移动端第二行与第一行共用同一条左基线：间距只由 safe-area-x 提供，
            切换器自己不再用 mx-2 推（那会让第二行比第一行多缩进 8px）。 */}
        <div
          className={`safe-area-x sm:hidden overflow-hidden transition-[max-height,opacity,padding] duration-[var(--ds-duration-normal)] ease-[var(--ds-ease-in-out)] ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}
        >
          <SegmentedControl
            aria-label="切换工作区"
            value={appMode}
            options={modeOptions}
            onValueChange={handleModeChange}
            size="sm"
            className="app-mode-switcher--mobile"
          />
        </div>
      </header>

      {/* Hint for sliding down */}
      <div
        className={`fixed top-0 left-0 right-0 z-sticky flex justify-center pointer-events-none transition-[transform,opacity] duration-[var(--ds-duration-normal)] ease-[var(--ds-ease-in-out)] sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}
      >
        <div className="bg-ds-scrim/85 backdrop-blur-sm text-ds-text-inverse text-xs px-3 py-1.5 rounded-b-ds-lg">
          下拉展示顶栏
        </div>
      </div>

      <div
        className={`safe-area-top invisible pointer-events-none transition-[max-height,opacity] duration-[var(--ds-duration-normal)] ease-[var(--ds-ease-in-out)] ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`}
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
