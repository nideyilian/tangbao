/**
 * 素材详情的两个可复用区块：**注释编辑**与**衍生关系**。
 *
 * 从 `AssetDetailPanel.tsx` 搬出来。那个文件原是「素材详情右侧栏」的主体，2026-09-21 起
 * 右侧栏被双击弹窗（`AssetViewer`）取代，主体随之删除，只有这两个区块还有消费方
 * （弹窗的右参数栏），所以在独立文件里继续维护。
 *
 * ⚠️ 区块**自己不带外边距**：间距由调用方容器的 `space-y-*` 统一控制。
 * 原先两块都写死 `mt-4`，在弹窗里会与容器间距叠成两倍（2026-09-21 迁移时统一）。
 */

import { useEffect, useRef, useState } from 'react'
import type { GeneratedAsset } from '../../types'
import { ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../../store'
import { ImageIcon } from '../../design-system/icons'
import { assetCommands } from '../../lib/assetCommands'
import { useAssetLibraryStore } from './store'

/** 素材注释编辑（防抖保存到 notes 字段，参与全文检索）。 */
export function NotesEditor({ assetId, value }: { assetId: string; value: string }) {
  const [draft, setDraft] = useState(value)
  const [saved, setSaved] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(value)
    setSaved(true)
  }, [value])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const commit = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const trimmed = next.trim()
    if (trimmed === value) {
      setSaved(true)
      return
    }
    setSaved(false)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void assetCommands
        .patchAssets([assetId], { notes: trimmed || undefined })
        .then(() => setSaved(true))
        .catch(() => {
          setSaved(true)
          useStore.getState().showToast('注释保存失败', 'error')
        })
    }, 600)
  }

  return (
    <section>
      <h3 className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ds-muted">
        <span>注释</span>
        {!saved && <span className="normal-case text-ds-muted/70">保存中…</span>}
      </h3>
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          commit(event.target.value)
        }}
        rows={3}
        placeholder="记录这张素材的用途、备注…（可被搜索）"
        aria-label="素材注释"
        className="w-full resize-y rounded-ds-md border border-ds-border bg-ds-surface px-2 py-1.5 text-xs leading-5 text-ds-foreground outline-none placeholder:text-ds-muted focus:border-ds-primary"
      />
    </section>
  )
}

/** 衍生链：上游输入（parentAssetIds）与下游产物（以本素材为输入的素材）。 */
export function DerivedChain({ asset, onNavigate }: { asset: GeneratedAsset; onNavigate: (assetId: string) => void }) {
  const [parents, setParents] = useState<GeneratedAsset[]>([])
  const [children, setChildren] = useState<GeneratedAsset[]>([])

  useEffect(() => {
    let active = true
    setParents([])
    setChildren([])
    if (window.electronAPI?.assetCatalogDerivedAssets) {
      void window.electronAPI
        .assetCatalogDerivedAssets(asset.id)
        .then((result) => {
          if (!active) return
          setParents(result.parents)
          setChildren(result.children)
        })
        .catch(() => {})
      return () => {
        active = false
      }
    }
    // 浏览器回退：从已水合的素材集合中扫描
    const state = useAssetLibraryStore.getState()
    const all = Object.values(state.assetsById)
    setParents(
      asset.parentAssetIds.map((id) => state.assetsById[id]).filter((item): item is GeneratedAsset => Boolean(item)),
    )
    setChildren(all.filter((candidate) => candidate.id !== asset.id && candidate.parentAssetIds.includes(asset.id)))
    return () => {
      active = false
    }
  }, [asset.id, asset.parentAssetIds])

  if (parents.length === 0 && children.length === 0) return null
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ds-muted">衍生关系</h3>
      {parents.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-ds-muted">上游输入（{parents.length}）</p>
          <ChainThumbnails assets={parents} onNavigate={onNavigate} />
        </div>
      )}
      {children.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ds-muted">下游产物（{children.length}）</p>
          <ChainThumbnails assets={children} onNavigate={onNavigate} />
        </div>
      )}
    </section>
  )
}

function ChainThumbnails({ assets, onNavigate }: { assets: GeneratedAsset[]; onNavigate: (assetId: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {assets.slice(0, 12).map((item) => (
        <ChainThumbnail key={item.id} asset={item} onNavigate={onNavigate} />
      ))}
      {assets.length > 12 && <span className="self-center text-xs text-ds-muted">+{assets.length - 12}</span>}
    </div>
  )
}

function ChainThumbnail({ asset, onNavigate }: { asset: GeneratedAsset; onNavigate: (assetId: string) => void }) {
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
      onClick={() => onNavigate(asset.id)}
      title={asset.origins[0]?.prompt || asset.id}
      className="h-ds-12 w-ds-12 shrink-0 overflow-hidden rounded-ds-md border border-ds-border outline-none hover:border-ds-primary focus-visible:ring-2 focus-visible:ring-ds-focus/70"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-ds-muted/20 text-ds-muted">
          <ImageIcon size={13} />
        </span>
      )}
    </button>
  )
}
