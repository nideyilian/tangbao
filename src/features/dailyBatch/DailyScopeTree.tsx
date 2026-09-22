import { useMemo } from 'react'
import type { AssetCollection } from '../../types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { resolveProjectNodeKind } from '../projectTree/params'
import { PROJECT_NODE_KIND_LABELS } from '../projectTree/types'

export interface TreeRow {
  id: string
  name: string
  depth: number
}

/** 把项目树按父子顺序展平；回收站里的节点不出现。 */
export function flattenProjectTree(collections: AssetCollection[]): TreeRow[] {
  const childrenByParent = new Map<string | null, AssetCollection[]>()
  for (const item of collections) {
    if (item.trashedAt) continue
    const key = item.parentId ?? null
    const list = childrenByParent.get(key) ?? []
    list.push(item)
    childrenByParent.set(key, list)
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  }
  const rows: TreeRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const item of childrenByParent.get(parentId) ?? []) {
      rows.push({ id: item.id, name: item.name, depth })
      walk(item.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/**
 * 每日生成的左栏作用域树。
 *
 * 结构直接来自素材库的项目树（`useAssetLibraryStore.collections`），
 * 层级语义（产品线 / 产品 / 方向）由 `resolveProjectNodeKind` 按深度判定 ——
 * 全系统只有这一棵树，这里不另建。
 */
export function DailyScopeTree({
  value,
  onChange,
}: {
  value: string | null
  onChange: (collectionId: string | null) => void
}) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const rows = useMemo(() => flattenProjectTree(collections), [collections])

  return (
    <aside aria-label="项目树" className="flex w-56 min-w-0 shrink-0 flex-col border-r border-ds-border bg-ds-canvas">
      <div className="px-3 py-2 text-sm text-ds-muted">项目树</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`w-full rounded-ds-md px-2 py-1.5 text-left text-sm ${
            value === null ? 'bg-ds-primary-subtle text-ds-text' : 'text-ds-muted'
          }`}
        >
          全部
        </button>
        {rows.length === 0 && <p className="px-2 py-3 text-xs text-ds-muted">还没有项目树，先去素材库建几个文件夹。</p>}
        {rows.map((row) => {
          const kind = resolveProjectNodeKind(row.depth)
          const selected = value === row.id
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onChange(row.id)}
              style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
              className={`w-full rounded-ds-md py-1.5 pr-2 text-left text-sm ${
                selected ? 'bg-ds-primary-subtle text-ds-text' : 'text-ds-muted'
              }`}
            >
              <span className="mr-1.5 text-xs text-ds-muted">{PROJECT_NODE_KIND_LABELS[kind]}</span>
              {row.name}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
