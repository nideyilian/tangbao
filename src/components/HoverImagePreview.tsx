import { createPortal } from 'react-dom'

export interface HoverPreviewState {
  imageId: string
  src: string
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  preview: HoverPreviewState
  sizeText?: string
  zIndex?: number
  portal?: boolean
}

export default function HoverImagePreview({ preview, sizeText, zIndex = 110, portal = false }: Props) {
  const content = (
    // 悬停预览刻意使用深色底（在图上读图更准），是媒体交互的合理例外；
    // 但阴影必须回到 token 体系（浮层档 = dropdown → shadow-ds-md），不用体系外的 shadow-2xl。
    <div
      className="pointer-events-none fixed hidden overflow-hidden rounded-ds-lg border border-white/15 bg-black/85 p-2 shadow-ds-md backdrop-blur-md md:block"
      style={{
        left: preview.left,
        top: preview.top,
        width: preview.width,
        height: preview.height,
        zIndex,
      }}
    >
      <img src={preview.src} data-image-id={preview.imageId} className="h-full w-full object-contain" alt="" />
      {sizeText && (
        <span
          aria-label="图片尺寸"
          className="absolute right-3 top-3 rounded-md bg-black/65 px-2 py-1 text-xs font-medium tabular-nums text-white shadow-sm backdrop-blur-sm"
        >
          {sizeText}
        </span>
      )}
    </div>
  )

  if (!portal || import.meta.env.MODE === 'test' || typeof document === 'undefined' || !document.body) return content
  return createPortal(content, document.body)
}
