import { useMemo, useRef, useState } from 'react'
import { Button, useDialogFocusTrap } from '../../../design-system'
import { useCloseOnEscape } from '../../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../../hooks/usePreventBackgroundScroll'
import type { ProjectProductNode } from '../../projectTree/params'
import type { CompositeV2Preset } from '../lib/compositeV2Types'

export interface PresetCopyDialogProps {
  /** 要复制的源水印：单条复制是 1 套，整库复制是当前产品的全部 */
  presets: CompositeV2Preset[]
  /** 源水印所在的产品名（只用于说明文案） */
  sourceProductName: string
  /** 目标产品候选（调用方已排除源产品本身） */
  products: ProjectProductNode[]
  onConfirm: (targetProductId: string) => void
  onClose: () => void
}

/**
 * 「把水印复制到其他产品」的目标选择弹窗。
 *
 * 为什么要有它：水印库按产品隔离之后，跨产品搬一套水印原本只能「导出 JSON → 切产品 → 导入」，
 * 一趟下来要落一个临时文件、还得记着刚才那套叫什么。复制应该是库内一步动作。
 *
 * 界面要提前说清三件事（说不清用户就得点完再看结果）：
 * 复制几套、复制到谁、复制过去之后会不会自动生效 —— 答案是**不会**，
 * 见 `planPresetCopies`：复制出来的水印不替任何方向勾选，免得「留个底稿」变成改了产出。
 */
export default function PresetCopyDialog({
  presets,
  sourceProductName,
  products,
  onConfirm,
  onClose,
}: PresetCopyDialogProps) {
  usePreventBackgroundScroll(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  useDialogFocusTrap(true, dialogRef)

  const [targetId, setTargetId] = useState(() => products[0]?.id ?? '')

  /** 按产品线归组：候选多起来之后，一眼看不出谁跟谁是一条线，选错就是复制到别的产品去了。 */
  const groups = useMemo(() => {
    const byLine = new Map<string, ProjectProductNode[]>()
    for (const product of products) {
      const list = byLine.get(product.lineId)
      if (list) list.push(product)
      else byLine.set(product.lineId, [product])
    }
    return [...byLine.values()]
  }, [products])

  const target = products.find((product) => product.id === targetId)

  const itemClass = (active: boolean) =>
    `w-full cursor-pointer rounded-ds-lg border px-3 py-1.5 text-left text-sm transition-colors ${
      active
        ? 'border-ds-primary bg-ds-primary-subtle text-ds-primary dark:border-ds-primary dark:bg-ds-primary/10 dark:text-ds-primary'
        : 'border-ds-border text-ds-text hover:border-ds-primary hover:text-ds-primary dark:border-ds-border dark:text-ds-text-subtle dark:hover:text-ds-primary'
    }`

  return (
    <div
      data-no-drag-select
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-copy-dialog-title"
        className="ds-modal-surface relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-ds-xl border p-5 animate-modal-in motion-reduce:animate-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="preset-copy-dialog-title" className="text-base font-semibold text-ds-text dark:text-ds-text-subtle">
          复制水印到其他产品
        </h2>
        <p className="mt-1 text-xs text-ds-muted dark:text-ds-muted">
          把「{sourceProductName}」的 {presets.length} 套水印复制成新的一套放到目标产品；原水印不动。
        </p>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {groups.map((group) => (
            <section key={group[0].lineId} className="space-y-1">
              <div className="px-1 text-xs font-medium text-ds-muted dark:text-ds-muted">{group[0].lineName}</div>
              {group.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  aria-pressed={product.id === targetId}
                  onClick={() => setTargetId(product.id)}
                  className={itemClass(product.id === targetId)}
                >
                  {product.name}
                </button>
              ))}
            </section>
          ))}
        </div>

        <div className="mt-4 rounded-ds-lg border border-ds-border px-3 py-2 text-xs text-ds-muted dark:border-ds-border dark:text-ds-muted">
          <p>复制后：归属改为目标产品，名称带「副本」，可继续单独编辑。</p>
          <p className="mt-1">不会自动启用 —— 要哪个方向用，在库里勾上它。</p>
          <p className="mt-1">图片与 LOGO 沿用同一份素材，不额外占空间。</p>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button
            className="flex-1"
            data-testid="preset-copy-confirm"
            disabled={!target}
            onClick={() => target && onConfirm(target.id)}
          >
            {target ? `复制到「${target.name}」` : '选择目标产品'}
          </Button>
        </div>
      </div>
    </div>
  )
}
