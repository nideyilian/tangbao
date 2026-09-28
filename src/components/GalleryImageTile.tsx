import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import {
  GRID_THUMBNAIL_VARIANT,
  ensureImageCached,
  ensureImageThumbnailCached,
  getCachedThumbnail,
  resolveImageDisplaySrc,
  subscribeImageThumbnail,
} from '../store'
import { decodeImageDataUrl } from '../lib/imageHover'
import { isLocalImageUrl } from '../lib/localImageUrl'
import { currentDevicePixelRatio, resolveTileImagePlan, tileCssWidthFromStyle } from '../lib/tileImagePlan'
import type { TaskRecord, ThumbnailVariant } from '../types'
import { CheckIcon, ImageIcon } from '../design-system/icons'

/** hover 原图加载防抖：鼠标快速扫过网格时不触发加载，避免连续解码多张 2K/4K 原图。 */
export const HOVER_FULL_IMAGE_DEBOUNCE_MS = 160

export interface GalleryImageItem {
  id: string
  imageId: string
  imageIndex: number
  task: TaskRecord
}

export function buildGalleryImageItems(tasks: TaskRecord[]): GalleryImageItem[] {
  return tasks.flatMap((task) =>
    task.outputImages.map((imageId, imageIndex) => ({
      id: `${task.id}:${imageId}:${imageIndex}`,
      imageId,
      imageIndex,
      task,
    })),
  )
}

interface GalleryImageTileProps {
  item: GalleryImageItem
  selected: boolean
  onSelect: (additive: boolean) => void
  onOpenDetail: () => void
  onAspectRatioChange?: (aspectRatio: number) => void
  style?: CSSProperties
  /** 大图库（如上万张）时置为 false：hover 只保留缩略图，不再解码原图。 */
  loadFullOnHover?: boolean
}

function GalleryImageTile({
  item,
  onAspectRatioChange,
  onOpenDetail,
  onSelect,
  selected,
  style,
  loadFullOnHover = true,
}: GalleryImageTileProps) {
  // 磁贴取图档位：按「这块磁贴实际要多少设备像素」决定小图 / 大图 / 原图
  // （判定与阈值见 `lib/tileImagePlan.ts`）。滚动期默认仍读 512px 小图，读取量约为 full 的 1/3；
  // 4K + 高 DPR 下磁贴比小图还大时才升级，否则会被拉伸放大（2026-09-28 报障的成因）。
  const plan = resolveTileImagePlan(tileCssWidthFromStyle(style), currentDevicePixelRatio())
  const planVariant: ThumbnailVariant = plan === 'full' ? 'full' : GRID_THUMBNAIL_VARIANT
  const [thumbnailSrc, setThumbnailSrc] = useState(() => getCachedThumbnail(item.imageId, planVariant)?.dataUrl ?? '')
  /** 档位决定的基础图源：`full` 档是大图 dataURL，`original` 档是本地协议地址（原图直出）。 */
  const [planSrc, setPlanSrc] = useState('')
  const [fullImageSrc, setFullImageSrc] = useState('')
  const hoverTimerRef = useRef<number | null>(null)
  const hoveredRef = useRef(false)
  const hoverLoadVersionRef = useRef(0)
  const onAspectRatioChangeRef = useRef(onAspectRatioChange)
  onAspectRatioChangeRef.current = onAspectRatioChange

  useEffect(() => {
    let cancelled = false

    if (plan === 'original') {
      // 原图直出：交给 Chromium 按显示尺寸解码缩放，不在 JS 里再持一份 dataURL
      setThumbnailSrc('')
      setPlanSrc('')
      void resolveImageDisplaySrc(item.imageId)
        .then((src) => {
          if (!cancelled && src) setPlanSrc(src)
        })
        .catch(() => {})
      return () => {
        cancelled = true
      }
    }

    const applyThumbnail = (thumbnail: { dataUrl: string; width?: number; height?: number }) => {
      if (cancelled) return
      setThumbnailSrc(thumbnail.dataUrl)
      if (thumbnail.width && thumbnail.height) onAspectRatioChangeRef.current?.(thumbnail.width / thumbnail.height)
    }
    // 复位时同步读缓存，切档位（窗口缩放 / 密度切换）不闪占位
    setThumbnailSrc(getCachedThumbnail(item.imageId, planVariant)?.dataUrl ?? '')
    setPlanSrc('')
    const unsubscribe = subscribeImageThumbnail(item.imageId, applyThumbnail, planVariant)
    ensureImageThumbnailCached(item.imageId, 'visible', planVariant)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbnailSrc('')
      })
    // 网格只加载缩略图；原图按需在 hover（桌面端交互意图）时加载，
    // 避免可见区 20-40 个 tile 同时解码 2K/4K 原图（100-300MB 峰值内存）。
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [item.imageId, plan, planVariant])

  // 卸载时清理 hover 防抖定时器，避免悬空回调。
  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
    },
    [],
  )

  const cancelPendingHoverLoad = () => {
    hoveredRef.current = false
    // 使在途加载结果失效：快速扫过网格时，离开的 tile 即使加载完成也不再换图。
    hoverLoadVersionRef.current++
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  const handlePointerEnter = () => {
    if (!loadFullOnHover) return
    // 大磁贴档位显示的本来就是原图，再叠一层 dataURL 原图只是白解码一遍
    if (plan === 'original') return
    if (hoverTimerRef.current !== null) return
    hoveredRef.current = true
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null
      if (!hoveredRef.current) return
      const version = ++hoverLoadVersionRef.current
      // Electron 下优先拿本地文件协议地址：原图不再经 IPC 克隆 + base64 往返，扫过网格时省下大量拷贝。
      void resolveImageDisplaySrc(item.imageId)
        .then(async (dataUrl) => {
          if (!dataUrl || version !== hoverLoadVersionRef.current || !hoveredRef.current) return
          // 离屏解码完成后再换 src，杜绝解码期间的空白闪烁。
          await decodeImageDataUrl(dataUrl)
          if (version !== hoverLoadVersionRef.current || !hoveredRef.current) return
          setFullImageSrc(dataUrl)
        })
        .catch(() => {
          // Keep the thumbnail visible when the original image cannot be loaded.
        })
    }, HOVER_FULL_IMAGE_DEBOUNCE_MS)
  }

  /** 渲染优先级：hover 原图 → 档位图源 → 缩略图。 */
  const imageSrc = fullImageSrc || planSrc || thumbnailSrc

  // 协议地址 404（文件被外部删除/移出库根）时回退 dataUrl；dataUrl 本身失败则不再重试。
  const handleImageError = () => {
    if (!isLocalImageUrl(imageSrc)) return
    void ensureImageCached(item.imageId).then((dataUrl) => {
      if (dataUrl) setFullImageSrc(dataUrl)
    })
  }

  const selectFromMouse = (event: MouseEvent<HTMLElement>) => {
    onSelect(event.ctrlKey || event.metaKey)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpenDetail()
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      onSelect(event.ctrlKey || event.metaKey)
    }
  }

  const imageCount = item.task.outputImages.length

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`任务图片 ${item.imageIndex + 1}，单击选择所属任务，双击或按 Enter 查看详情`}
      aria-pressed={selected}
      className={`task-card-wrapper group ${style ? 'absolute' : 'relative aspect-square'} min-w-0 cursor-default overflow-hidden rounded-ds-lg border bg-ds-subtle outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ds-focus/70 focus-visible:ring-offset-2 ${selected ? 'border-ds-selection-border bg-ds-selection ring-1 ring-inset ring-ds-selection-border' : 'border-ds-border hover:border-ds-selection-border'}`}
      data-task-id={item.task.id}
      onClick={selectFromMouse}
      onDoubleClick={(event) => {
        event.preventDefault()
        onOpenDetail()
      }}
      onKeyDown={handleKeyDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={cancelPendingHoverLoad}
      draggable={Boolean(imageSrc)}
      onDragStart={(event) => {
        if (!imageSrc) return
        event.dataTransfer.setData('text/plain', `agent-images:${item.imageId}`)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '160px 160px', ...style }}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          loading="eager"
          decoding="async"
          fetchPriority="low"
          draggable={false}
          onError={handleImageError}
          data-image-id={item.imageId}
          data-image-quality={fullImageSrc ? 'full' : 'thumbnail'}
          data-output-image-ids={item.task.outputImages.join(',')}
          className="saveable-image h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ds-muted">
          <ImageIcon size={24} />
        </div>
      )}

      {selected && (
        <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ds-primary text-ds-text-inverse shadow-ds-sm">
          <CheckIcon size={14} />
        </span>
      )}

      {imageCount > 1 && (
        <span className="absolute right-2 top-2 rounded-md border border-ds-border bg-ds-surface/90 px-1.5 py-0.5 text-xs font-medium tabular-nums text-ds-muted shadow-ds-sm">
          {item.imageIndex + 1}/{imageCount}
        </span>
      )}
    </article>
  )
}

export default memo(
  GalleryImageTile,
  (previous, next) =>
    previous.item === next.item &&
    previous.selected === next.selected &&
    previous.loadFullOnHover === next.loadFullOnHover &&
    previous.style?.height === next.style?.height &&
    previous.style?.left === next.style?.left &&
    previous.style?.top === next.style?.top &&
    previous.style?.width === next.style?.width,
)
