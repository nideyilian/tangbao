// 注意：文件名保留自历史（原为「词条库侧栏」，与素材详情共用「详情 / 词条」两个 Tab）。
// 词条库已于 2026-09-18 下线（依据 docs/redundancy-audit.md），
// 本组件现在只承载「素材详情」面板，仅在详情打开时出现。
//
// 下面两个 storage key 保留历史字面量（`wordLibrarySidebar_*`）：
// 改掉会让用户已保存的面板位置与停靠状态丢失。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useStore } from '../store'
import { CloseIcon, IconButton, ImageIcon } from '../design-system'
import { useMediaQuery } from '../hooks/useMediaQuery'
import AssetDetailPanel from '../features/assetLibrary/AssetDetailPanel'
import AssetPurgeModal from '../features/assetLibrary/AssetPurgeModal'
import { useAssetLibraryStore, getVisibleAssets } from '../features/assetLibrary/store'
import { queryAssets } from '../features/assetLibrary/query'

const MIN_W = 300
const MIN_H = 520
const MAX_W = 600
const MAX_H = 860
const DEFAULT_W = 340
const DEFAULT_H = 760
const SNAP_THRESHOLD = 10
const SHARED_WIDTH_KEY = 'floating_panel_width_v1'
const POS_STORAGE_KEY = 'wordLibrarySidebar_pos_v2'
const DOCK_STORAGE_KEY = 'wordLibrarySidebar_dock_v1'

function loadSavedWidth(): number {
  try {
    const raw = localStorage.getItem(SHARED_WIDTH_KEY)
    const value = raw ? JSON.parse(raw) : null
    if (typeof value === 'number') return Math.max(MIN_W, Math.min(MAX_W, value))
  } catch {
    // Ignore invalid local preferences and use the safe default.
  }
  return DEFAULT_W
}

function loadSavedPosition() {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    const value = raw ? JSON.parse(raw) : null
    if (typeof value?.x === 'number' && typeof value?.y === 'number') {
      return {
        x: Math.max(0, Math.min(window.innerWidth - DEFAULT_W, value.x)),
        y: Math.max(0, Math.min(window.innerHeight - DEFAULT_H, value.y)),
      }
    }
  } catch {
    // Ignore invalid local preferences and use the safe default.
  }
  return { x: Math.max(0, window.innerWidth - DEFAULT_W - 24), y: 72 }
}

function loadSavedDock(): 'left' | 'right' | null {
  try {
    const value = localStorage.getItem(DOCK_STORAGE_KEY)
    if (value === 'left' || value === 'right') return value
    if (value === null) return 'right'
  } catch {
    // Ignore invalid local preferences and use the safe default.
  }
  return null
}

export default function WordLibrarySidebar() {
  const compactViewport = useMediaQuery('(max-width: 1023px)')
  const appMode = useStore((state) => state.appMode)
  const activeAsset = useAssetLibraryStore((state) =>
    state.activeAssetId ? state.assetsById[state.activeAssetId] : undefined,
  )
  const detailOpen = useAssetLibraryStore((state) => state.detailOpen)
  const setDetailOpen = useAssetLibraryStore((state) => state.setDetailOpen)
  const assetScope = useAssetLibraryStore((state) => state.scope)
  const assetQuery = useAssetLibraryStore((state) => state.query)
  const assetFilters = useAssetLibraryStore((state) => state.filters)
  const assetSortKey = useAssetLibraryStore((state) => state.sortKey)
  const assetSortOrder = useAssetLibraryStore((state) => state.sortOrder)
  const assetCollections = useAssetLibraryStore((state) => state.collections)
  const assetById = useAssetLibraryStore((state) => state.assetsById)
  const assetOrder = useAssetLibraryStore((state) => state.assetOrder)

  const [compactOpen, setCompactOpen] = useState(false)
  const [position, setPosition] = useState(loadSavedPosition)
  const [size, setSize] = useState(() => ({ width: loadSavedWidth(), height: DEFAULT_H }))
  const [docked, setDocked] = useState<'left' | 'right' | null>(loadSavedDock)
  const [purgeRequest, setPurgeRequest] = useState<{ ids: string[] } | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef(false)
  const resizeRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const resizeStartRef = useRef({ x: 0, y: 0, width: DEFAULT_W, height: DEFAULT_H })

  const detailAvailable = appMode === 'gallery' && Boolean(activeAsset && detailOpen)

  // 素材详情连续浏览：按素材库当前查询结果前后切换
  const detailAssetList = useMemo(() => {
    if (!detailAvailable || !activeAsset) return []
    const assets = getVisibleAssets({ assetsById: assetById, assetOrder })
    return queryAssets(
      { assets, collections: assetCollections },
      { scope: assetScope, query: assetQuery, filters: assetFilters, sortKey: assetSortKey, sortOrder: assetSortOrder },
    ).assets
  }, [
    activeAsset,
    assetById,
    assetCollections,
    assetFilters,
    assetOrder,
    assetQuery,
    assetScope,
    assetSortKey,
    assetSortOrder,
    detailAvailable,
  ])

  const goPrevAsset = useCallback(() => {
    if (!activeAsset || detailAssetList.length === 0) return
    const index = detailAssetList.findIndex((item) => item.id === activeAsset.id)
    const prev = index <= 0 ? detailAssetList[detailAssetList.length - 1] : detailAssetList[index - 1]
    if (prev) useAssetLibraryStore.getState().setActiveAsset(prev.id)
  }, [activeAsset, detailAssetList])

  const goNextAsset = useCallback(() => {
    if (!activeAsset || detailAssetList.length === 0) return
    const index = detailAssetList.findIndex((item) => item.id === activeAsset.id)
    const next = index < 0 || index >= detailAssetList.length - 1 ? detailAssetList[0] : detailAssetList[index + 1]
    if (next) useAssetLibraryStore.getState().setActiveAsset(next.id)
  }, [activeAsset, detailAssetList])

  useEffect(() => {
    const root = document.documentElement
    // 变量名沿用历史，CSS 侧（design-system）仍在读它们。
    // 2026-09-19 修正：必须用 `visible` 而不是 `docked` 判定。此前只要 docked === 'right'
    // 就写死 340px，但下方 `if (!detailAvailable) return null` 会让面板**不渲染**却没卸载，
    // useEffect 的 cleanup 也就永不触发 —— 于是右侧 340px 被永久占位，露出 body 的画布底色，
    // 表现为「界面右边莫名多一条灰边」（浅色主题下尤其明显）。占位必须跟随可见性。
    const visible = detailAvailable && !compactViewport
    root.style.setProperty('--word-library-left-width', visible && docked === 'left' ? `${size.width}px` : '0px')
    root.style.setProperty('--word-library-right-width', visible && docked === 'right' ? `${size.width}px` : '0px')
    return () => {
      root.style.setProperty('--word-library-left-width', '0px')
      root.style.setProperty('--word-library-right-width', '0px')
    }
  }, [detailAvailable, compactViewport, docked, size.width])

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (dragRef.current) {
        setPosition({
          x: Math.max(0, Math.min(event.clientX - dragOffsetRef.current.x, window.innerWidth - size.width)),
          y: Math.max(0, Math.min(event.clientY - dragOffsetRef.current.y, window.innerHeight - size.height)),
        })
      }
      if (resizeRef.current) {
        setSize({
          width: Math.max(
            MIN_W,
            Math.min(MAX_W, resizeStartRef.current.width + event.clientX - resizeStartRef.current.x),
          ),
          height: Math.max(
            MIN_H,
            Math.min(MAX_H, resizeStartRef.current.height + event.clientY - resizeStartRef.current.y),
          ),
        })
      }
    }
    const stop = () => {
      if (dragRef.current) {
        setPosition((current) => {
          const rightDistance = window.innerWidth - current.x - size.width
          if (current.x <= SNAP_THRESHOLD) setDocked('left')
          else if (rightDistance <= SNAP_THRESHOLD) setDocked('right')
          localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(current))
          return current
        })
      }
      if (resizeRef.current) localStorage.setItem(SHARED_WIDTH_KEY, JSON.stringify(size.width))
      dragRef.current = false
      resizeRef.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
  }, [size.height, size.width])

  useEffect(() => {
    if (docked) localStorage.setItem(DOCK_STORAGE_KEY, docked)
    else localStorage.removeItem(DOCK_STORAGE_KEY)
  }, [docked])

  const beginDrag = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest('button, input, select')) return
    const panel = panelRef.current?.getBoundingClientRect()
    if (!panel) return
    dragRef.current = true
    dragOffsetRef.current = { x: event.clientX - panel.left, y: event.clientY - panel.top }
    setPosition({ x: panel.left, y: panel.top })
    if (docked) setDocked(null)
    event.preventDefault()
  }

  // 没有可展示的素材详情时不占用屏幕（词条库下线后，这里是唯一入口条件）
  if (!detailAvailable) return null

  if (compactViewport && !compactOpen) {
    return (
      <IconButton
        aria-label="打开素材详情"
        icon={<ImageIcon className="h-4 w-4" />}
        onClick={() => setCompactOpen(true)}
        className="fixed right-2 top-[calc(var(--app-header-offset)+var(--ds-space-2))] z-[var(--ds-z-overlay)] border border-ds-border bg-ds-raised shadow-[var(--ds-shadow-md)]"
      />
    )
  }

  const isDocked = Boolean(docked)
  const panelStyle: CSSProperties = compactViewport
    ? {
        right: 'var(--ds-space-2)',
        top: 'calc(var(--app-header-offset) + var(--ds-space-2))',
        width: 'min(420px, calc(100% - var(--ds-space-4)))',
        height: 'calc(100dvh - var(--app-header-offset) - var(--ds-space-4))',
        borderRadius: 'var(--ds-radius-xl)',
        boxShadow: 'var(--ds-shadow-lg)',
      }
    : isDocked
      ? {
          left: docked === 'left' ? 0 : undefined,
          right: docked === 'right' ? 0 : undefined,
          top: 'var(--app-header-offset)',
          width: size.width,
          height: 'calc(100vh - var(--app-header-offset))',
          borderRadius: 0,
        }
      : {
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
          borderRadius: 'var(--ds-radius-xl)',
          boxShadow: 'var(--ds-shadow-lg)',
        }

  return (
    <div
      ref={panelRef}
      className="tangbao-side-panel fixed z-40 flex flex-col overflow-hidden"
      data-docked={docked ?? undefined}
      style={panelStyle}
    >
      <header className="tangbao-side-panel__header shrink-0 select-none" onMouseDown={beginDrag}>
        <div className="flex items-center gap-3">
          <div className="tangbao-side-panel__icon">
            <ImageIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="tangbao-side-panel__title">素材详情</h3>
            <p className="tangbao-side-panel__meta">
              {activeAsset?.width && activeAsset.height ? `${activeAsset.width} × ${activeAsset.height}` : '已选择素材'}
            </p>
          </div>
          <IconButton
            aria-label="关闭素材详情"
            icon={<CloseIcon className="h-4 w-4" />}
            size="sm"
            onClick={() => setDetailOpen(false)}
          />
          {compactViewport && (
            <IconButton
              aria-label="关闭右侧边栏"
              icon={<CloseIcon className="h-4 w-4" />}
              size="sm"
              onClick={() => setCompactOpen(false)}
            />
          )}
        </div>
      </header>

      <AssetDetailPanel
        embedded
        onPrev={goPrevAsset}
        onNext={goNextAsset}
        onPurgeRequest={(ids) => setPurgeRequest({ ids })}
      />

      {!isDocked && !compactViewport && (
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 z-10 h-6 w-6 cursor-se-resize opacity-60"
          style={{
            background: 'linear-gradient(135deg, transparent 55%, hsl(var(--ds-color-text-muted) / 0.55) 55%)',
            borderBottomRightRadius: 'var(--ds-radius-xl)',
          }}
          onMouseDown={(event) => {
            resizeRef.current = true
            resizeStartRef.current = {
              x: event.clientX,
              y: event.clientY,
              width: size.width,
              height: size.height,
            }
            event.preventDefault()
            event.stopPropagation()
          }}
        />
      )}

      <AssetPurgeModal
        open={purgeRequest !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeRequest(null)
        }}
        assetIds={purgeRequest?.ids ?? []}
        title="永久删除素材"
      />
    </div>
  )
}
