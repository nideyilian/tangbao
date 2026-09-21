/**
 * 素材详情弹窗（原「Eagle 式全屏查看器」）。
 *
 * **2026-09-21 改版**：双击素材打开的原来是铺满全屏的黑底查看器，参数挤在右侧一条窄栏里；
 * 同时素材库还有另一个「素材详情右侧栏」（`WordLibrarySidebar` 承载的浮动面板，单击素材即弹出）。
 * 同一个素材两套参数展示、两处入口，且两处内容还不一样（侧栏有操作按钮组 / SOP / 来源明细 /
 * 输入图片数，全屏查看器有颜色标签 / 注释 / 衍生关系）。
 *
 * 现在**只留这一处**：双击 → 大弹窗（不是全屏），左图右参，参数按组排完整。
 * 侧栏那条链路（含单击弹出、窄屏抽屉、`detailOpen` 状态）整体删除。
 *
 * ## 为什么背景改成了「弹窗」而不是全屏
 *
 * 全屏把「看单张图」做成了「进另一个应用」：退出要先意识到自己在哪、参数栏还被挤到 320px。
 * 弹窗留出四周的素材库上下文，参数栏能拿到 384px。
 *
 * ## 参数展示的取舍（2026-09-21 杰哥定）
 *
 * - **不要「项目归属」模块**：右键菜单的「添加到项目」就是改归属的地方，弹窗里再来一块是重复。
 * - **操作按钮只放右键菜单没有的**：其余（查看大图 / 找相似 / 复制 / 收藏 / 添加到项目 /
 *   用作水印预览底图 / 复用提示词与参数 / 导出原图 / 打开文件位置 / 移入回收站）右键都能点到，
 *   弹窗里不再各放一份。这里的「查看来源任务」正是右键没有的那个。
 *
 * ## 底部缩略图条（2026-09-21 改）
 *
 * 原来是跨任务的「类似图片」推荐（`assetCommands.recommend`，按内容相似度/文本向量排序），
 * 结果常常是**别的任务**里长得像的图，与用户心里「这张卡还出了哪几张」不是一回事。
 * 现在改为**同一张任务卡片**生成的图片：同 `taskId`；SOP 批次卡片为该批次（同
 * `snapshotId || batchId`）的全部任务输出图 —— 与该素材在素材库「任务卡片」视图里所属的
 * 那张卡口径一致。列表含当前这张（描边高亮），点击即切换；卡片只有一张图时整条不渲染。
 * 跨任务的「找相似图片」仍有右键菜单入口，没有丢功能。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenCheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  ImagePlusIcon,
  StarIcon,
  TrashIcon,
  Wand2Icon,
  WrenchIcon,
  XIcon,
} from '../../design-system/icons'
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../../store'
import { copyImageSourceToClipboard, getClipboardFailureMessage } from '../../lib/clipboard'
import { assetCommands } from '../../lib/assetCommands'
import { cycleColorLabel } from '../../lib/assetLibraryModel'
import type { AssetColorLabel, AssetRating, GeneratedAsset } from '../../types'
import { useAssetLibraryStore } from './store'
import AssetParamBreakdown from './AssetParamBreakdown'
import { DerivedChain, NotesEditor } from './AssetDetailSections'
import { COLOR_LABELS_WITH_NAMES } from './colorLabels'
import { clamp } from '../../lib/clamp'
import { collectTaskCardAssets, getPrimaryOrigin, resolveTaskCardScopeKey } from '../../lib/assetBatchGrouping'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useRequirementPrototype } from '../requirementPrototype/store'

const MIN_SCALE = 1
const MAX_SCALE = 8

/** 素材详情弹窗：大图缩放/拖拽 + 前后导航 + 右参数栏（左图右参，窄屏自动上下）。 */
function AssetViewerInner() {
  const viewerAssetId = useAssetLibraryStore((state) => state.viewerAssetId)
  const viewerAssetIds = useAssetLibraryStore((state) => state.viewerAssetIds)
  const assetsById = useAssetLibraryStore((state) => state.assetsById)
  const patchAssets = useAssetLibraryStore((state) => state.patchAssets)
  const closeViewer = useAssetLibraryStore((state) => state.closeViewer)
  const setViewerAsset = useAssetLibraryStore((state) => state.setViewerAsset)

  const asset = viewerAssetId ? assetsById[viewerAssetId] : undefined
  const imageId = asset?.imageId
  const [src, setSrc] = useState('')
  /**
   * 左右布局还是上下布局。
   *
   * ⚠️ 用 JS 判断而不是 `md:` 前缀：这个弹窗上依赖响应式类的写法在本机实测不可靠
   * （2026-09-21：参数栏被挤成 0 宽、遮罩定位也出过问题），逐个排查的代价远高于直接判断。
   */
  const wide = useMediaQuery('(min-width: 768px)')
  const [showToast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  /** 焦点容器（整个弹窗）：打开时聚焦，键盘快捷键才会生效 */
  const dialogRef = useRef<HTMLDivElement>(null)
  /**
   * 图片舞台：滚轮缩放 / 拖拽平移的作用域。
   *
   * ⚠️ **不能拿弹窗容器共用**：那个矩形包含右侧参数栏，缩放中心会整体偏右
   * （按 Ctrl 滚轮时图会往一边跑）。
   */
  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 })
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender((n) => n + 1), [])

  // 打开后立即把焦点拉进弹窗：否则焦点停留在背后卡片上，空格/Esc 会被卡片 keydown
  // 拦截（stopPropagation 挡掉 window 冒泡监听），表现为「要先点击弹窗内其他地方才生效」。
  // 关闭时把焦点还给打开前的元素，保证「空格开、空格关、再空格开」连续可用。
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      previous?.focus({ preventScroll: true })
    }
  }, [])

  const toast = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 2000)
  }

  // 图片加载 + 重置变换
  useEffect(() => {
    if (!imageId) {
      setSrc('')
      return
    }
    let cancelled = false
    setSrc('')
    scaleRef.current = 1
    txRef.current = 0
    tyRef.current = 0
    ensureImageCached(imageId)
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setSrc(dataUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [imageId])

  const currentIndex = viewerAssetId ? viewerAssetIds.indexOf(viewerAssetId) : -1
  const total = viewerAssetIds.length
  const navigate = useCallback(
    (delta: number) => {
      if (viewerAssetIds.length === 0) return
      const next = (((currentIndex + delta) % viewerAssetIds.length) + viewerAssetIds.length) % viewerAssetIds.length
      const id = viewerAssetIds[next]
      if (id) setViewerAsset(id)
    },
    [currentIndex, setViewerAsset, viewerAssetIds],
  )

  // 键盘：Esc/空格 关闭、←/→ 导航、1-5/0 评分、F 收藏、C 轮换颜色（Eagle 式）。
  // capture 阶段拦截：弹窗打开后（含图片加载中、焦点仍在背后卡片时）空格/Esc 立即生效，
  // 不会被卡片的 keydown（打开弹窗）抢先。
  useEffect(() => {
    if (!viewerAssetId) return
    const onKey = (event: KeyboardEvent) => {
      // 输入框/文本域内不拦截（如右侧「注释」编辑中按空格、退格、方向键、字母应正常打字）
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'Escape' || event.key === ' ') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeViewer()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        navigate(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        navigate(1)
      } else if (event.key >= '1' && event.key <= '5') {
        void patchAssets([viewerAssetId], { rating: Number(event.key) as AssetRating }).catch(() =>
          useStore.getState().showToast('操作失败', 'error'),
        )
      } else if (event.key === '0') {
        void patchAssets([viewerAssetId], { rating: 0 }).catch(() => useStore.getState().showToast('操作失败', 'error'))
      } else if (event.key.toLocaleLowerCase() === 'f') {
        const current = assetsById[viewerAssetId]
        if (current)
          void patchAssets([viewerAssetId], { favorite: !current.favorite }).catch(() =>
            useStore.getState().showToast('操作失败', 'error'),
          )
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'c') {
        // Ctrl/Cmd+C：复制素材（须在普通 'c'（循环颜色）之前判断，否则永远不可达）
        event.preventDefault()
        useAssetLibraryStore.getState().copyAssets([viewerAssetId])
        useStore.getState().showToast('已复制素材', 'success')
      } else if (event.key.toLocaleLowerCase() === 'c') {
        const current = assetsById[viewerAssetId]
        if (current)
          void patchAssets([viewerAssetId], { colorLabel: cycleColorLabel(current.colorLabel) }).catch(() =>
            useStore.getState().showToast('操作失败', 'error'),
          )
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        // Eagle 式：删除当前素材（移入回收站），自动切换到下一张；删完最后一张则关闭弹窗
        event.preventDefault()
        event.stopImmediatePropagation()
        void (async () => {
          const assetStore = useAssetLibraryStore.getState()
          try {
            await assetStore.moveToTrash([viewerAssetId])
            useStore.getState().showToast('已移入回收站', 'success')
            const remaining = useAssetLibraryStore
              .getState()
              .viewerAssetIds.filter((id) => id !== viewerAssetId && useAssetLibraryStore.getState().assetsById[id])
            if (remaining.length > 0) setViewerAsset(remaining[0])
            else closeViewer()
          } catch {
            useStore.getState().showToast('操作失败，请重试', 'error')
          }
        })()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [assetsById, closeViewer, navigate, patchAssets, setViewerAsset, viewerAssetId])

  // 滚轮缩放 + 拖拽平移
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = event.clientX - rect.left - rect.width / 2
      const my = event.clientY - rect.top - rect.height / 2
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE)
      const ratio = next / scaleRef.current
      scaleRef.current = next
      if (next <= 1) {
        txRef.current = 0
        tyRef.current = 0
      } else {
        txRef.current = mx - ratio * (mx - txRef.current)
        tyRef.current = my - ratio * (my - tyRef.current)
      }
      rerender()
    }
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0 || scaleRef.current <= 1) return
      event.preventDefault()
      dragRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        baseTx: txRef.current,
        baseTy: tyRef.current,
      }
    }
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag.active) return
      txRef.current = drag.baseTx + (event.clientX - drag.startX)
      tyRef.current = drag.baseTy + (event.clientY - drag.startY)
      rerender()
    }
    const onUp = () => {
      dragRef.current.active = false
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [rerender])

  const primaryOrigin = useMemo(
    () =>
      asset ? (asset.origins.find((origin) => origin.key === asset.primaryOriginKey) ?? asset.origins[0]) : undefined,
    [asset],
  )
  const tasks = useStore((state) => state.tasks)
  const sourceTask = useMemo(
    () => tasks.find((task) => task.id === primaryOrigin?.taskId),
    [primaryOrigin?.taskId, tasks],
  )
  const sopItems = useRequirementPrototype((state) => state.sopLibrary)
  const sourceSop = useMemo(() => {
    const sopId = sourceTask?.sopBatch?.sopId
    if (!sopId) return undefined
    return sopItems.find((item) => item.id === sopId)
  }, [sourceTask?.sopBatch?.sopId, sopItems])

  /**
   * 底部缩略图条：**同一张任务卡片**生成的图片（口径见 `resolveTaskCardScopeKey`）。
   *
   * 刻意拆成两步：范围键只随任务列表变，素材扫描只随范围键 / 素材变 ——
   * 否则生图过程中每次任务进度更新，都会把已加载素材全量重扫一遍。
   */
  const taskScopeKey = useMemo(
    () => resolveTaskCardScopeKey(tasks, primaryOrigin?.taskId),
    [primaryOrigin?.taskId, tasks],
  )
  const taskImageAssets = useMemo(
    () => collectTaskCardAssets(Object.values(assetsById), taskScopeKey),
    [assetsById, taskScopeKey],
  )

  if (!viewerAssetId || !asset) return null

  const s = scaleRef.current
  const isZoomed = s > 1

  const setColorLabel = (label: AssetColorLabel | null) => {
    void patchAssets([asset.id], { colorLabel: label }).catch(() => useStore.getState().showToast('操作失败', 'error'))
  }
  const copyImage = async () => {
    try {
      await copyImageSourceToClipboard(src || (await ensureImageCached(asset.imageId)) || '')
      toast('图片已复制')
    } catch (error) {
      toast(getClipboardFailureMessage('复制失败', error), 'error')
    }
  }

  const actionButtonClass =
    'flex min-h-ds-control-lg min-w-11 items-center justify-center rounded-ds-md text-ds-muted outline-none hover:bg-ds-subtle hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-focus/70'

  return (
    <div
      className="z-modal flex items-center justify-center bg-ds-scrim/45 p-4 sm:p-6"
      // ⚠️ 定位走内联样式：`fixed` 类挂在这里时**实际不生效**（2026-09-21 实测）——
      // 遮罩层会留在壳层内容流里，被 `--app-docked-left-width` 推着偏右，也盖不住顶栏。
      // 弹窗的定位基准必须是视口，不能赌某个工具类。
      style={{ position: 'fixed', inset: 0 }}
      onMouseDown={(event) => {
        // 遮罩点击关闭：只认落在遮罩本身上的按下（弹窗内部的点击会冒泡到遮罩，但 target 不是它）
        if (event.target === event.currentTarget) closeViewer()
      }}
    >
      <div
        ref={dialogRef}
        data-testid="asset-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="素材详情"
        tabIndex={-1}
        className="overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface outline-none"
        /*
         * ⚠️ 尺寸与方向**全部走内联样式**，不依赖 Tailwind 的任意值类与响应式前缀。
         * 2026-09-21 实测：这组类在这个弹窗上不可靠 —— `fixed` 类挂上后遮罩仍留在壳层内容流里
         * （被 --app-docked-left-width 推着偏右、盖不住顶栏），参数栏也被挤成 0 宽。
         * 排查代价远高于直接写死，所以这里要的是确定性，不是优雅。
         */
        style={{
          display: 'flex',
          flexDirection: wide ? 'row' : 'column',
          width: 'min(1440px, 96%)',
          height: '88%',
          maxHeight: 900,
        }}
      >
        {/* 左：图片区（深色画布，看图的传统底） */}
        <div className="flex flex-col bg-ds-scrim/40" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <div className="flex h-ds-12 shrink-0 items-center justify-between gap-3 px-3">
            <div className="min-w-0 flex-1 truncate text-sm text-ds-text">
              {primaryOrigin?.prompt || `素材 ${asset.id}`}
              {/* 位置只在当前图属于打开时的浏览列表时才显示：从底部同任务缩略图切进来的图不在该列表里，
                  否则会显示成「0 / n」。 */}
              {total > 1 && currentIndex >= 0 && (
                <span className="ml-2 shrink-0 text-xs text-ds-muted">
                  {currentIndex + 1} / {total}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={actionButtonClass}
                aria-label="复制图片"
                onClick={() => void copyImage()}
              >
                <CopyIcon size={16} />
              </button>
              <button
                type="button"
                className={actionButtonClass}
                aria-label="导出原图"
                onClick={() =>
                  void assetCommands
                    .exportAsset(asset.id)
                    .then((ok) => toast(ok ? '已开始导出' : '导出失败', ok ? 'success' : 'error'))
                }
              >
                <DownloadIcon size={16} />
              </button>
              <button
                type="button"
                className={actionButtonClass}
                aria-label="加入参考图"
                onClick={() =>
                  void assetCommands.useAsReference(asset.id).then((ok) => {
                    if (ok) toast('已加入参考图')
                  })
                }
              >
                <ImagePlusIcon size={16} />
              </button>
              <button
                type="button"
                className={actionButtonClass}
                aria-label="用作水印预览底图"
                onClick={() => {
                  void assetCommands.openInPostprocess(asset.id)
                  closeViewer()
                }}
              >
                <WrenchIcon size={16} />
              </button>
              <button
                type="button"
                className={actionButtonClass}
                aria-label="找相似"
                onClick={() => {
                  useAssetLibraryStore.getState().setSimilarToAsset(asset.id)
                  closeViewer()
                }}
              >
                <Wand2Icon size={16} />
              </button>
              <button
                type="button"
                className={actionButtonClass}
                aria-label="移入回收站"
                onClick={() => {
                  void useAssetLibraryStore
                    .getState()
                    .moveToTrash([asset.id])
                    .then(() => useStore.getState().showToast('已移入回收站', 'success'))
                    .catch(() => useStore.getState().showToast('操作失败', 'error'))
                  closeViewer()
                }}
              >
                <TrashIcon size={16} />
              </button>
              <button type="button" className={actionButtonClass} aria-label="关闭素材详情" onClick={closeViewer}>
                <XIcon size={18} />
              </button>
            </div>
          </div>

          <div
            ref={containerRef}
            className="relative min-h-0 flex-1 overflow-hidden"
            style={{ cursor: isZoomed ? 'grab' : 'default' }}
            onDoubleClick={() => {
              if (s > 1) {
                scaleRef.current = 1
                txRef.current = 0
                tyRef.current = 0
              } else {
                scaleRef.current = 2.5
              }
              rerender()
            }}
          >
            {src ? (
              <img
                src={src}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none object-contain"
                style={{
                  transform: `translate(calc(-50% + ${txRef.current}px), calc(-50% + ${tyRef.current}px)) scale(${s})`,
                  transition: dragRef.current.active ? 'none' : 'transform 0.15s ease-out',
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-ds-muted">加载中…</div>
            )}
            {isZoomed && (
              <span className="absolute bottom-3 left-3 rounded-full bg-ds-scrim px-2 py-1 text-xs text-ds-text-inverse">
                {Math.round(s * 100)}%
              </span>
            )}

            {total > 1 && (
              <>
                <button
                  type="button"
                  aria-label="上一张"
                  onClick={() => navigate(-1)}
                  className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ds-scrim/70 p-2 text-ds-text-inverse outline-none hover:bg-ds-scrim focus-visible:ring-2 focus-visible:ring-ds-focus/70"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="下一张"
                  onClick={() => navigate(1)}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ds-scrim/70 p-2 text-ds-text-inverse outline-none hover:bg-ds-scrim focus-visible:ring-2 focus-visible:ring-ds-focus/70"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* 底部：同一任务卡片生成的图片（含当前这张，卡片只有一张时整条不渲染） */}
          {taskImageAssets.length > 1 && (
            <div className="shrink-0 border-t border-ds-border px-3 py-2">
              <p className="mb-1.5 text-xs text-ds-muted">同一任务</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {taskImageAssets.map((item) => (
                  <TaskImageThumbnail
                    key={item.id}
                    asset={item}
                    selected={item.id === asset.id}
                    onClick={() => setViewerAsset(item.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/*
          右：参数栏（窄屏折到下方，高度限 45% 并自己滚）—— **常驻，不提供收起入口**：
          收起按钮的样式和顶部「关闭弹窗」的 × 一样，误点后参数栏消失、又很难找回来
          （2026-09-21 杰哥报障：同一个弹窗里出现两个 ×）。
        */}
        <aside
          data-testid="asset-viewer-info"
          className="flex shrink-0 flex-col border-ds-border bg-ds-surface"
          style={{
            width: wide ? 384 : '100%',
            maxHeight: wide ? undefined : '45%',
            borderLeftWidth: wide ? 1 : 0,
            borderTopWidth: wide ? 0 : 1,
          }}
        >
          <div className="flex shrink-0 items-center border-b border-ds-border px-3 py-2">
            <span className="text-sm font-medium">素材信息</span>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <div className="flex items-center justify-between">
              <div role="radiogroup" aria-label="评分" className="flex items-center">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    role="radio"
                    aria-checked={asset.rating === rating}
                    aria-label={`${rating} 星`}
                    onClick={() =>
                      void patchAssets([asset.id], {
                        rating: (asset.rating === rating ? 0 : rating) as AssetRating,
                      }).catch(() => useStore.getState().showToast('操作失败', 'error'))
                    }
                    className="grid h-ds-control-sm w-ds-control-sm place-items-center text-ds-muted hover:text-ds-warning"
                  >
                    <StarIcon
                      size={15}
                      fill={rating <= asset.rating ? 'currentColor' : 'none'}
                      className={rating <= asset.rating ? 'text-ds-warning' : ''}
                    />
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-pressed={asset.favorite}
                onClick={() =>
                  void patchAssets([asset.id], { favorite: !asset.favorite }).catch(() =>
                    useStore.getState().showToast('操作失败', 'error'),
                  )
                }
                className={`flex h-ds-control-sm items-center gap-1 rounded-ds-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${asset.favorite ? 'text-ds-warning' : 'text-ds-muted hover:text-ds-warning'}`}
              >
                <StarIcon size={14} fill={asset.favorite ? 'currentColor' : 'none'} />
                {asset.favorite ? '已收藏' : '收藏'}
              </button>
            </div>

            {/* 颜色标签 */}
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">颜色标签</h4>
              <div className="flex flex-wrap items-center gap-1.5">
                {COLOR_LABELS_WITH_NAMES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-label={item.label}
                    title={item.label}
                    onClick={() => setColorLabel(asset.colorLabel === item.value ? null : item.value)}
                    className={`h-5 w-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${asset.colorLabel === item.value ? 'ring-2 ring-ds-focus ring-offset-1' : ''}`}
                    style={{ backgroundColor: item.color }}
                  />
                ))}
              </div>
            </div>

            <section>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">文件信息</h4>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ds-muted">尺寸</dt>
                <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
                <dt className="text-ds-muted">格式</dt>
                <dd>{asset.mimeType ?? '—'}</dd>
                <dt className="text-ds-muted">大小</dt>
                <dd>{asset.byteSize ? `${(asset.byteSize / 1024 / 1024).toFixed(1)} MB` : '—'}</dd>
                <dt className="text-ds-muted">生成时间</dt>
                <dd>{new Date(asset.createdAt).toLocaleString()}</dd>
                {primaryOrigin && (
                  <>
                    <dt className="text-ds-muted">输入图片</dt>
                    <dd>{primaryOrigin.inputImageIds.length} 张</dd>
                  </>
                )}
              </dl>
            </section>

            {/* 参数解耦展示：任务级共享参数 + 本图专属参数（seed / 实际差异 / 文件名） */}
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-xs font-medium uppercase tracking-wide text-ds-muted">来源与参数</h4>
                {/* 「查看来源任务」是右键菜单里没有的操作，所以它留在弹窗里才有入口 */}
                <button
                  type="button"
                  disabled={!sourceTask}
                  title={sourceTask ? '切到任务卡片视图并定位该任务' : '该素材没有关联任务'}
                  className="text-xs text-ds-primary outline-none hover:underline disabled:text-ds-muted disabled:no-underline"
                  onClick={() => {
                    if (!sourceTask) return
                    const assetStore = useAssetLibraryStore.getState()
                    assetStore.setGroupBy('grouped')
                    assetStore.setBatchFocusTaskId(sourceTask.id)
                    closeViewer()
                  }}
                >
                  查看来源任务 →
                </button>
              </div>
              <AssetParamBreakdown origin={primaryOrigin} />
              {asset.origins.length > 1 && (
                <ul className="mt-2 space-y-1">
                  {asset.origins.map((origin) => (
                    <li key={origin.key} className="rounded-ds-md border border-ds-border px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{origin.key}</span>
                        <span className="shrink-0 text-ds-muted">{origin.apiModel ?? origin.sourceMode}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-ds-muted">{origin.prompt}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">提示词</h4>
              <p className="whitespace-pre-wrap break-words text-xs leading-5">{primaryOrigin?.prompt || '—'}</p>
              {primaryOrigin?.revisedPrompt && (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-ds-muted">
                  修订：{primaryOrigin.revisedPrompt}
                </p>
              )}
            </section>

            {(sourceSop || sourceTask?.sopBatch) && (
              <section>
                <h4 className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ds-muted">
                  <BookOpenCheckIcon size={13} /> SOP
                </h4>
                {sourceSop ? (
                  <button
                    type="button"
                    title="点击应用该 SOP 为当前生图 SOP"
                    className="flex min-h-ds-control-lg w-full items-center justify-between gap-2 rounded-ds-md border border-ds-border px-2.5 text-xs transition-colors hover:border-ds-primary/40 hover:bg-ds-subtle"
                    onClick={() => {
                      void assetCommands.applyAssetSop(asset.id).then((ok) => {
                        if (!ok) return
                        useStore.getState().showToast(`已应用 SOP「${sourceSop.name}」`, 'success')
                        closeViewer()
                      })
                    }}
                  >
                    <span className="truncate">{sourceSop.name}</span>
                    <span className="shrink-0 text-ds-muted">点击复用 →</span>
                  </button>
                ) : (
                  <p className="text-xs text-ds-muted">{sourceTask?.sopBatch?.sopName || '未知 SOP'}（已从库中删除）</p>
                )}
              </section>
            )}

            <NotesEditor assetId={asset.id} value={asset.notes ?? ''} />

            <DerivedChain asset={asset} onNavigate={(id) => setViewerAsset(id)} />

            {/*
             * 刻意**没有**「项目归属」模块：右键菜单的「添加到项目」就是改归属的入口，
             * 弹窗里再来一块是同一件事的第二入口（2026-09-21 杰哥定）。
             */}
          </div>

          <div className="shrink-0 border-t border-ds-border p-2">
            {asset.status === 'trashed' ? (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    void useAssetLibraryStore
                      .getState()
                      .restoreAssets([asset.id])
                      .then(() => useStore.getState().showToast('已恢复', 'success'))
                      .catch(() => useStore.getState().showToast('恢复失败', 'error'))
                  }}
                  className="flex min-h-ds-control-lg w-full items-center justify-center rounded-ds-md border border-ds-border px-2 text-xs"
                >
                  恢复
                </button>
                {/*
                 * 「永久删除」刻意不放在这里：它必须先弹引用冲突确认（`AssetPurgeModal`），
                 * 而那个确认弹窗挂在素材库工作区上（要读它的 `requestPurge`），弹窗拿不到。
                 * 回收站素材的**右键菜单**里有这个入口，所以不是丢功能。
                 */}
                <p className="text-center text-xs text-ds-muted">永久删除请用右键菜单</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void useAssetLibraryStore
                    .getState()
                    .moveToTrash([asset.id])
                    .then(() => {
                      useStore.getState().showToast('已移入回收站', 'success')
                      closeViewer()
                    })
                    .catch(() => useStore.getState().showToast('操作失败', 'error'))
                }}
                className="flex min-h-ds-control-lg w-full items-center justify-center gap-1 rounded-ds-md border border-ds-danger/35 text-xs text-ds-danger outline-none hover:bg-ds-danger/10 focus-visible:ring-2 focus-visible:ring-ds-focus/70"
              >
                <TrashIcon size={13} /> 移入回收站
              </button>
            )}
          </div>
        </aside>

        {showToast && (
          <div
            className={`absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs ${
              showToast.tone === 'error' ? 'bg-ds-danger text-ds-text-inverse' : 'bg-ds-scrim text-ds-text-inverse'
            }`}
          >
            {showToast.message}
          </div>
        )}
      </div>
    </div>
  )
}

/** 底部「同一任务」缩略图：`selected` 为当前正在看的那张（描边高亮，仍可点击）。 */
function TaskImageThumbnail({
  asset,
  selected,
  onClick,
}: {
  asset: GeneratedAsset
  selected: boolean
  onClick: () => void
}) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    const apply = (thumbnail: { dataUrl: string }) => {
      if (active) setSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(asset.imageId, apply)
    void ensureImageThumbnailCached(asset.imageId).then((thumbnail) => {
      if (thumbnail) apply(thumbnail)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [asset.imageId])
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected}
      title={getPrimaryOrigin(asset)?.prompt || asset.id}
      className={`h-ds-16 w-ds-16 shrink-0 overflow-hidden rounded-ds-md border outline-none focus-visible:ring-2 focus-visible:ring-ds-focus/70 ${
        selected ? 'border-ds-primary ring-2 ring-ds-primary/60' : 'border-ds-border hover:border-ds-primary'
      }`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-ds-subtle text-ds-muted">
          <EyeIcon size={14} />
        </span>
      )}
    </button>
  )
}

export default memo(AssetViewerInner)
