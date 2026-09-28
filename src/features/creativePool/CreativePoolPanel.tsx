import { useCallback, useRef, useState } from 'react'
import { Button, Switch } from '../../design-system'
import { ImagesIcon } from '../../design-system/icons'
import { resolveRandomCount, type CreativePoolSelection } from './poolSelection'
import type { CreativePoolItem } from './types'

export interface CreativePoolPanelProps {
  items: CreativePoolItem[]
  /** 资产引用 id → dataUrl；缺 key 说明图没读出来，渲染成占位而不是破图 */
  assets: Map<string, string>
  /** 随机抽签的张数上限；`null` = 不限 */
  maxRandomCount: number | null
  loading: boolean
  /** 分析进度文案；非空时表示正在跑 */
  analyzing: string
  notice: string
  selection: CreativePoolSelection
  onSelectionChange: (next: CreativePoolSelection) => void
  onMaxRandomCountChange: (value: number | null) => void
  onAddImages: (files: File[]) => void
  onRemoveItem: (itemId: string) => void
  onRenameItem: (itemId: string, name: string) => void
  onClose: () => void
}

/**
 * 风格池面板。
 *
 * 受控组件：池数据与选中由 `useCreativePool` / InputBar 持有，这里只负责呈现与交互 ——
 * 这样生成动作（在 InputBar）拿得到同一份选中的图，不会出现「面板显示选中、提交却没带上」。
 *
 * 池容量不设上限；只有「随机抽几张」有一个**可选**上限，见底部那一行。
 */
export default function CreativePoolPanel({
  items,
  assets,
  maxRandomCount,
  loading,
  analyzing,
  notice,
  selection,
  onSelectionChange,
  onMaxRandomCountChange,
  onAddImages,
  onRemoveItem,
  onRenameItem,
  onClose,
}: CreativePoolPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const busy = Boolean(analyzing)
  // 随机张数的合法上限：配了就按配置，没配就是池子大小（= 不限）
  const randomLimit = Math.max(1, resolveRandomCount(Number.MAX_SAFE_INTEGER, items.length, maxRandomCount) || 1)

  const toggleItem = useCallback(
    (itemId: string) => {
      // 勾选**不设上限**（这是用户一张张点出来的，有明确意图，不该被拦）。
      // 随机模式下勾选不参与，但允许点，点了就切回手选，免得用户以为坏了没反应。
      const nextSelected = selection.selectedIds.includes(itemId)
        ? selection.selectedIds.filter((id) => id !== itemId)
        : [...selection.selectedIds, itemId]
      onSelectionChange({ ...selection, mode: 'manual', selectedIds: nextSelected })
    },
    [onSelectionChange, selection],
  )

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      onAddImages(Array.from(fileList))
    },
    [onAddImages],
  )

  const finishRename = useCallback(() => {
    if (editingId) onRenameItem(editingId, editingName)
    setEditingId(null)
    setEditingName('')
  }, [editingId, editingName, onRenameItem])

  const selectedCount =
    selection.mode === 'random'
      ? resolveRandomCount(selection.randomCount, items.length, maxRandomCount)
      : selection.selectedIds.length

  return (
    <>
      <button
        type="button"
        aria-label="关闭风格池"
        onClick={onClose}
        className="fixed inset-0 z-overlay cursor-default"
      />
      {/*
        data-block-global-image-input：屏蔽 InputBar 挂在 document 上的全局图片拖拽 / 粘贴监听。
        不加这个属性，拖进来的图会先被全局监听收走挂成「参考图」，池子永远收不到 ——
        同一个约定见 SopManagementCenter（那边是全屏模态，同样靠它屏蔽）。
        另有 stopPropagation 兜一层：万一将来全局监听改成捕获阶段，属性判断依然管用。
      */}
      <div
        data-block-global-image-input="true"
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.stopPropagation()
          setDragActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDragActive(false)
          handleFiles(event.dataTransfer?.files ?? null)
        }}
        className={`absolute bottom-full right-0 z-overlay mb-2 flex max-h-[58vh] w-[min(660px,calc(100vw-24px))] flex-col gap-2.5 overflow-y-auto rounded-ds-lg border bg-ds-surface/95 px-3 py-2.5 shadow-ds-md backdrop-blur-xl dark:bg-ds-scrim/95 ${
          dragActive ? 'border-ds-primary' : 'border-ds-border'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ds-text">
            <ImagesIcon size={14} />
            风格池
            <span className="text-ds-muted">{items.length} 张</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            aria-label="把图片丢进风格池"
          >
            {busy ? '分析中…' : '丢图进来'}
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />

        {loading ? (
          <p className="py-6 text-center text-xs text-ds-muted">正在读取风格池…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center text-ds-muted">
            <ImagesIcon size={22} />
            <p className="text-xs">还没有图。把图片拖进来，或点右上角「丢图进来」</p>
            <p className="text-xs">AI 会看图、起名（最多 8 个字）并存档，数量不限</p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {items.map((item) => {
              const isSelected = selection.mode === 'manual' && selection.selectedIds.includes(item.id)
              const src = assets.get(item.assetRef)
              return (
                /*
                  整格就是图，名字压在图底部的一条薄标签里 ——
                  图不被「文字区」切走一块，同一屏能看到更多风格图。
                  名字条压在图上，所以底色必须跟主题走（ds-surface/90）而不是固定深色：
                  ds-scrim 在两个主题下都是深色，浅色主题下会让深色文字看不见。
                */
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    aria-pressed={isSelected}
                    aria-label={`选择 ${item.name}`}
                    title={item.points.join('；')}
                    className={`relative block w-full overflow-hidden rounded-ds-lg border-2 ${
                      isSelected ? 'border-ds-primary' : 'border-transparent'
                    }`}
                  >
                    {src ? (
                      <img src={src} alt={item.name} className="aspect-square w-full object-cover" />
                    ) : (
                      <span className="flex aspect-square w-full items-center justify-center bg-ds-subtle text-xs text-ds-muted">
                        图缺失
                      </span>
                    )}
                    {editingId !== item.id && (
                      <span
                        data-pool-name={item.id}
                        onDoubleClick={() => {
                          setEditingId(item.id)
                          setEditingName(item.name)
                        }}
                        className={`absolute inset-x-0 bottom-0 h-5 truncate px-1 text-center text-xs leading-5 ${
                          isSelected ? 'bg-ds-primary text-ds-text-inverse' : 'bg-ds-surface/90 text-ds-text'
                        }`}
                      >
                        {item.name}
                      </span>
                    )}
                  </button>
                  {isSelected && (
                    <span className="pointer-events-none absolute right-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-ds-surface bg-ds-primary" />
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    aria-label={`从风格池删除 ${item.name}`}
                    title="删除（连同池内的图）"
                    className="absolute left-1.5 top-1.5 hidden h-4 w-4 items-center justify-center rounded-ds-md bg-ds-surface/90 text-xs text-ds-text group-hover:flex"
                  >
                    ×
                  </button>
                  {editingId === item.id && (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onBlur={finishRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') finishRename()
                        if (event.key === 'Escape') {
                          setEditingId(null)
                          setEditingName('')
                        }
                      }}
                      aria-label={`重命名 ${item.name}`}
                      className="absolute inset-x-0.5 bottom-0.5 h-5 rounded-ds-md border border-ds-border bg-ds-surface px-1 text-center text-xs text-ds-text"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {analyzing && <p className="text-xs text-ds-primary">{analyzing}</p>}
        {notice && <p className="text-xs text-ds-muted">{notice}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ds-border pt-2">
          <span className="flex items-center gap-1.5">
            <Switch
              checked={selection.mode === 'random'}
              onCheckedChange={(checked) => onSelectionChange({ ...selection, mode: checked ? 'random' : 'manual' })}
              aria-label="随机抽签模式"
              label={<span className="text-xs">随机</span>}
              labelPosition="end"
              className="gap-1.5"
            />
            <input
              type="number"
              min={1}
              max={randomLimit}
              value={Math.min(selection.randomCount, randomLimit)}
              disabled={selection.mode !== 'random'}
              onChange={(event) =>
                onSelectionChange({
                  ...selection,
                  randomCount: Math.min(randomLimit, Math.max(1, Math.floor(Number(event.target.value) || 1))),
                })
              }
              aria-label="随机抽取张数"
              className="w-12 rounded-ds-lg border border-ds-border bg-ds-surface px-1.5 py-0.5 text-xs text-ds-text disabled:opacity-50"
            />
            <span className="text-xs text-ds-muted">张</span>
            <span className="text-xs text-ds-muted">/ 上限</span>
            <input
              type="number"
              min={1}
              value={maxRandomCount ?? ''}
              placeholder="不限"
              onChange={(event) => {
                const raw = event.target.value.trim()
                onMaxRandomCountChange(raw === '' ? null : Math.max(1, Math.floor(Number(raw) || 1)))
              }}
              aria-label="随机抽签张数上限（留空不限）"
              title="随机抽签的张数上限；留空 = 不限"
              className="w-14 rounded-ds-lg border border-ds-border bg-ds-surface px-1.5 py-0.5 text-xs text-ds-text placeholder:text-ds-muted"
            />
            <span className="text-xs text-ds-muted">张</span>
          </span>
          <span className={`text-xs ${selectedCount > 0 ? 'text-ds-primary' : 'text-ds-muted'}`}>
            {selectedCount > 0 ? `已选 ${selectedCount} 张` : '未选图 —— 本次生图不会带池里的图'}
          </span>
        </div>
      </div>
    </>
  )
}
