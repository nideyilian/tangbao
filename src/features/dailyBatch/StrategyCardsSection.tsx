import { useMemo, useState } from 'react'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useRequirementPrototype } from '../requirementPrototype/store'
import { collectDirectionIds, describeCollectionPath, nameOf } from './scope'
import { useDailyBatchStore } from './store'

/** 卡上显示的产品名：沿项目树往上推的第 2 级（卡本身只存方向）。 */
function productNameOf(
  collections: ReturnType<typeof useAssetLibraryStore.getState>['collections'],
  directionId: string,
) {
  const path = describeCollectionPath(collections, directionId)
  return path.length >= 2 ? path[1] : (path[0] ?? '—')
}

export function StrategyCardsSection({ scopeId }: { scopeId: string | null }) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const sops = useRequirementPrototype((state) => state.sopLibrary)
  const cards = useDailyBatchStore((state) => state.cards)
  const saveCard = useDailyBatchStore((state) => state.saveCard)
  const removeCard = useDailyBatchStore((state) => state.removeCard)
  const setCardEnabled = useDailyBatchStore((state) => state.setCardEnabled)

  const directionIds = useMemo(() => collectDirectionIds(collections, scopeId), [collections, scopeId])
  const visible = useMemo(
    () => cards.filter((card) => directionIds.includes(card.directionCollectionId)),
    [cards, directionIds],
  )

  const [draftOpen, setDraftOpen] = useState(false)
  const [draftSopId, setDraftSopId] = useState('')
  const [draftDirectionId, setDraftDirectionId] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftImages, setDraftImages] = useState(1)
  const [draftWeight, setDraftWeight] = useState(1)

  const sopById = useMemo(() => new Map(sops.map((item) => [item.id, item])), [sops])
  const fallbackDirection = draftDirectionId || directionIds[0] || ''

  const openDraft = () => {
    setDraftSopId(sops[0]?.id ?? '')
    setDraftDirectionId(directionIds[0] ?? '')
    setDraftName('')
    setDraftImages(1)
    setDraftWeight(1)
    setDraftOpen(true)
  }

  const createCard = () => {
    const sop = sopById.get(draftSopId)
    if (!sop || !fallbackDirection) return
    const now = Date.now()
    saveCard({
      id: `scard-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: draftName.trim() || sop.name,
      sopId: sop.id,
      sopName: sop.name,
      directionCollectionId: fallbackDirection,
      imagesPerPrompt: draftImages,
      weight: draftWeight,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    setDraftOpen(false)
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ds-muted">
          一个方向下可以挂多张卡；每天按比例从这些卡里抽。卡只引用 SOP，不复制内容 —— 改 SOP 时所有引用它的卡一起变。
        </p>
        <button
          type="button"
          onClick={openDraft}
          disabled={directionIds.length === 0 || sops.length === 0}
          className="shrink-0 rounded-ds-md border border-ds-border px-3 py-1.5 text-sm text-ds-text disabled:opacity-40"
        >
          新建策略卡
        </button>
      </div>

      {directionIds.length === 0 && (
        <p className="rounded-ds-md border border-ds-border px-3 py-2 text-sm text-ds-muted">
          当前作用域下没有方向节点。策略卡挂在「方向」上，请先在左树点到一个方向（或它的上级）。
        </p>
      )}

      {draftOpen && (
        <div className="rounded-ds-md border border-ds-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              引用的 SOP / 配方卡
              <select
                value={draftSopId}
                onChange={(event) => setDraftSopId(event.target.value)}
                className="rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1.5"
              >
                {sops.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              挂到哪个方向
              <select
                value={fallbackDirection}
                onChange={(event) => setDraftDirectionId(event.target.value)}
                className="rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1.5"
              >
                {directionIds.map((id) => (
                  <option key={id} value={id}>
                    {describeCollectionPath(collections, id).join(' / ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              卡片名称
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="留空则用 SOP 名"
                className="rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1.5"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                一条提示词出几张
                <input
                  type="number"
                  min={1}
                  value={draftImages}
                  onChange={(event) => setDraftImages(Math.max(1, Number(event.target.value) || 1))}
                  className="rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                抽取权重
                <input
                  type="number"
                  min={1}
                  value={draftWeight}
                  onChange={(event) => setDraftWeight(Math.max(1, Number(event.target.value) || 1))}
                  className="rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1.5"
                />
              </label>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={createCard}
              disabled={!draftSopId || !fallbackDirection}
              className="rounded-ds-md bg-ds-primary px-3 py-1.5 text-sm text-ds-on-primary disabled:opacity-40"
            >
              建立
            </button>
            <button
              type="button"
              onClick={() => setDraftOpen(false)}
              className="rounded-ds-md border border-ds-border px-3 py-1.5 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-ds-md border border-ds-border px-3 py-6 text-center text-sm text-ds-muted">
          这个作用域下还没有策略卡。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((card) => {
            const sopMissing = !sopById.has(card.sopId)
            return (
              <li
                key={card.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-ds-md border border-ds-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ds-text">
                    {card.name}
                    {!card.enabled && <span className="ml-2 text-xs text-ds-muted">（已停用）</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ds-muted">
                    产品 {productNameOf(collections, card.directionCollectionId)} · 方向{' '}
                    {nameOf(collections, card.directionCollectionId)}
                  </p>
                </div>
                <p className={`text-xs ${sopMissing ? 'text-ds-danger' : 'text-ds-muted'}`}>
                  {sopMissing ? `SOP 已删除（${card.sopName || card.sopId}）` : `引用：${card.sopName}`}
                </p>
                <p className="text-xs text-ds-muted">
                  {card.imagesPerPrompt} 张/词 · 权重 {card.weight}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCardEnabled(card.id, !card.enabled)}
                    className="rounded-ds-md border border-ds-border px-2 py-1 text-xs"
                  >
                    {card.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCard(card.id)}
                    className="rounded-ds-md border border-ds-border px-2 py-1 text-xs text-ds-danger"
                  >
                    删除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
