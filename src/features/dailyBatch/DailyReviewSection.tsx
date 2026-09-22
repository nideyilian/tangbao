import { useMemo, useState } from 'react'
import type { TaskRecord } from '../../types'
import GalleryImageTile, { buildGalleryImageItems } from '../../components/GalleryImageTile'
import { runManualPostprocess, useStore } from '../../store'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { executeDailyTarget, todayKey } from './execute'
import { collectProductIds, nameOf } from './scope'
import { useDailyBatchStore } from './store'

interface DirectionGroup {
  directionId: string
  directionName: string
  plannedCount: number
  tasks: TaskRecord[]
}

export function DailyReviewSection({ scopeId }: { scopeId: string | null }) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const runs = useDailyBatchStore((state) => state.runs)
  const targets = useDailyBatchStore((state) => state.targets)
  const tasks = useStore((state) => state.tasks)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const dateKey = todayKey()
  const productIds = useMemo(() => collectProductIds(collections, scopeId), [collections, scopeId])
  const todayRuns = useMemo(
    () =>
      runs.filter((run) => run.date === dateKey && (scopeId === null || productIds.includes(run.productCollectionId))),
    [runs, dateKey, scopeId, productIds],
  )
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])

  const groupsByRun = useMemo(() => {
    return todayRuns.map((run) => {
      const byDirection = new Map<string, TaskRecord[]>()
      for (const taskId of run.submittedTaskIds) {
        const task = tasksById.get(taskId)
        if (!task) continue
        const key = task.defaultCollectionId ?? ''
        const list = byDirection.get(key) ?? []
        list.push(task)
        byDirection.set(key, list)
      }
      const groups: DirectionGroup[] = [...byDirection.entries()].map(([directionId, list]) => ({
        directionId,
        directionName: directionId ? nameOf(collections, directionId) : '未归档',
        plannedCount: run.plans.find((plan) => plan.directionCollectionId === directionId)?.plannedCount ?? 0,
        tasks: list,
      }))
      // 计划里有、但一张都还没出来的方向也要显示 —— 否则用户不知道那个方向根本没跑
      for (const plan of run.plans) {
        if (!byDirection.has(plan.directionCollectionId)) {
          groups.push({
            directionId: plan.directionCollectionId,
            directionName: nameOf(collections, plan.directionCollectionId),
            plannedCount: plan.plannedCount,
            tasks: [],
          })
        }
      }
      return { run, groups }
    })
  }, [todayRuns, tasksById, collections])

  const toggle = (imageId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(imageId)) next.delete(imageId)
      else next.add(imageId)
      return next
    })
  }

  const runNow = async () => {
    setBusy(true)
    try {
      const list = targets.filter((item) => item.enabled && item.dailyTotal > 0)
      for (const target of list) {
        await executeDailyTarget(dateKey, target)
      }
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      // 直接走现有的手动后处理：水印、画面适配、命名、按方向落盘、分发，
      // 全部用中控台已经配好的那一套，本页不重配任何参数
      await runManualPostprocess([...selected])
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }

  if (todayRuns.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-sm text-ds-muted">
          {dateKey} 还没有跑过。每天首次打开应用时会自动跑一次，也可以现在手动跑。
        </p>
        <button
          type="button"
          onClick={runNow}
          disabled={busy}
          className="rounded-ds-md bg-ds-primary px-3 py-1.5 text-sm text-ds-on-primary disabled:opacity-40"
        >
          {busy ? '正在提交…' : '立即跑一次今天'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ds-muted">
          {dateKey} 的产出，按方向分区。点图选中（= 通过），再点一次取消；双击看大图。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={runNow}
            disabled={busy}
            className="rounded-ds-md border border-ds-border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            再跑一次
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={busy || selected.size === 0}
            className="rounded-ds-md bg-ds-primary px-3 py-1.5 text-sm text-ds-on-primary disabled:opacity-40"
          >
            {busy ? '处理中…' : `发布选中的 ${selected.size} 张`}
          </button>
        </div>
      </div>

      {groupsByRun.map(({ run, groups }) => (
        <section key={run.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ds-text">{nameOf(collections, run.productCollectionId)}</span>
            <span className="text-ds-muted">批次 {run.batchId}</span>
            {run.status !== 'done' && <span className="text-ds-danger">状态：{run.status}</span>}
          </div>

          {run.error && (
            <p className="rounded-ds-md border border-ds-danger px-3 py-2 text-sm text-ds-danger">{run.error}</p>
          )}
          {run.skipped.map((skip, index) => (
            <p
              key={`${skip.reason}-${index}`}
              className="rounded-ds-md border border-ds-border px-3 py-2 text-sm text-ds-muted"
            >
              {skip.detail}
            </p>
          ))}

          {groups.map((group) => {
            const items = buildGalleryImageItems(group.tasks)
            const produced = group.tasks.reduce((sum, task) => sum + task.outputImages.length, 0)
            const allImageIds = items.map((item) => item.imageId)
            return (
              <div key={group.directionId} className="rounded-ds-md border border-ds-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm text-ds-text">
                    {group.directionName}
                    <span className="ml-2 text-xs text-ds-muted">
                      计划 {group.plannedCount} 张 · 已出 {produced} 张
                    </span>
                    {produced < group.plannedCount && (
                      <span className="ml-2 text-xs text-ds-danger">还差 {group.plannedCount - produced} 张</span>
                    )}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelected((current) => new Set([...current, ...allImageIds]))}
                      disabled={items.length === 0}
                      className="rounded-ds-md border border-ds-border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      本方向全选
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((current) => {
                          const next = new Set(current)
                          for (const id of allImageIds) next.delete(id)
                          return next
                        })
                      }
                      disabled={items.length === 0}
                      className="rounded-ds-md border border-ds-border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      清空
                    </button>
                  </div>
                </div>

                {items.length === 0 ? (
                  <p className="mt-2 text-xs text-ds-muted">这个方向今天还没有图出来。</p>
                ) : (
                  <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                    {items.map((item) => (
                      <GalleryImageTile
                        key={item.id}
                        item={item}
                        selected={selected.has(item.imageId)}
                        onSelect={() => toggle(item.imageId)}
                        onOpenDetail={() => {
                          const ids = items.map((entry) => entry.imageId)
                          // 素材 id 与图片存储 id 是同一个内容哈希，可直接当素材打开
                          useAssetLibraryStore.getState().openViewer(item.imageId, ids)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
