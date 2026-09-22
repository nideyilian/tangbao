import { useMemo } from 'react'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { allocateByRatios, sumRatios } from './planner'
import { collectDirectionIds, collectProductIds, nameOf } from './scope'
import { useDailyBatchStore } from './store'
import type { DailyDirectionRatio, DailyTarget } from './types'

function newTarget(productCollectionId: string): DailyTarget {
  const now = Date.now()
  return {
    id: `dtarget-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    productCollectionId,
    dailyTotal: 0,
    directionRatios: [],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function DailyTargetsSection({ scopeId }: { scopeId: string | null }) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const targets = useDailyBatchStore((state) => state.targets)
  const saveTarget = useDailyBatchStore((state) => state.saveTarget)
  const setTargetEnabled = useDailyBatchStore((state) => state.setTargetEnabled)

  const productIds = useMemo(() => collectProductIds(collections, scopeId), [collections, scopeId])

  const updateRatio = (target: DailyTarget, directionId: string, ratio: number) => {
    const rest = target.directionRatios.filter((item) => item.directionCollectionId !== directionId)
    const next: DailyDirectionRatio[] = ratio > 0 ? [...rest, { directionCollectionId: directionId, ratio }] : rest
    saveTarget({ ...target, directionRatios: next, updatedAt: Date.now() })
  }

  if (productIds.length === 0) {
    return (
      <p className="rounded-ds-md border border-ds-border px-3 py-6 text-center text-sm text-ds-muted">
        当前作用域下没有产品节点。每日数量是按产品配的，请先在左树点到一个产品（或它的上级）。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-ds-muted">
        每个产品各配一套：这个产品每天一共出多少张、各方向占多少比例。比例不要求加起来正好 100 ——
        按权重归一后总数仍然凑满，不会少出。
      </p>

      {productIds.map((productId) => {
        const existing = targets.find((item) => item.productCollectionId === productId)
        const target = existing ?? { ...newTarget(productId), enabled: false }
        const directionIds = collectDirectionIds(collections, productId)
        const ratios = directionIds.map((id) => {
          const found = target.directionRatios.find((item) => item.directionCollectionId === id)
          return { id, ratio: found?.ratio ?? 0 }
        })
        // 用与跑批完全相同的分配函数算折算张数：界面上看到的，就是明天实际会出的
        const counts = allocateByRatios(target.dailyTotal, ratios)
        const total = sumRatios(ratios.map((item) => item.ratio))

        return (
          <section key={productId} className="rounded-ds-md border border-ds-border p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h3 className="text-sm text-ds-text">{nameOf(collections, productId)}</h3>
              <label className="flex items-center gap-2 text-sm text-ds-muted">
                每天出
                <input
                  type="number"
                  min={0}
                  value={target.dailyTotal}
                  onChange={(event) =>
                    saveTarget({
                      ...target,
                      dailyTotal: Math.max(0, Number(event.target.value) || 0),
                      updatedAt: Date.now(),
                    })
                  }
                  className="w-24 rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1"
                />
                张
              </label>
              <button
                type="button"
                onClick={() => {
                  if (existing) setTargetEnabled(existing.id, !existing.enabled)
                  else saveTarget({ ...target, enabled: true, updatedAt: Date.now() })
                }}
                className="rounded-ds-md border border-ds-border px-2 py-1 text-xs"
              >
                {target.enabled ? '已启用' : '未启用'}
              </button>
              <span className="text-xs text-ds-muted">
                比例合计 {total}%{total !== 100 && ratios.some((item) => item.ratio > 0) && '（已按权重归一）'}
              </span>
            </div>

            {directionIds.length === 0 ? (
              <p className="mt-2 text-xs text-ds-muted">这个产品下还没有方向节点。</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {ratios.map((item, index) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ds-text">{nameOf(collections, item.id)}</span>
                    <label className="flex items-center gap-1 text-xs text-ds-muted">
                      <input
                        type="number"
                        min={0}
                        value={item.ratio}
                        onChange={(event) => updateRatio(target, item.id, Math.max(0, Number(event.target.value) || 0))}
                        className="w-20 rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1"
                      />
                      %
                    </label>
                    <span className="w-24 text-right text-xs text-ds-muted">= {counts[index] ?? 0} 张</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
