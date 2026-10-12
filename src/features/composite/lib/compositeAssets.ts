import type { StoredCompositeAsset } from '../../../types'
import { deleteCompositeAsset, getCompositeAsset, putCompositeAssets } from '../../../lib/db'
import type { CompositeV2Layer, CompositeV2Preset, CompositeV2ProjectLogo } from './compositeV2Types'
import { ByteLruCache } from '../../../lib/byteLruCache'
import { dataUrlToBlob } from '../../../lib/blobDataUrl'

type AssetState = {
  projectLogos: CompositeV2ProjectLogo[]
  presets: CompositeV2Preset[]
}

type StoreCompositeBlobDeps = {
  putMany: (assets: StoredCompositeAsset[]) => Promise<void>
  now: () => number
}

const objectUrlCache = new ByteLruCache<string, string>(64 * 1024 * 1024, (url) => URL.revokeObjectURL(url))

export async function hashCompositeBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  }
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (const value of bytes) {
    h1 = Math.imul(h1 ^ value, 0x01000193)
    h2 = Math.imul(h2 ^ value, 0x27d4eb2d)
  }
  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

export async function dataUrlToCompositeBlob(dataUrl: string): Promise<Blob> {
  return dataUrlToBlob(dataUrl)
}

export async function storeCompositeBlobs(
  blobs: Blob[],
  deps: StoreCompositeBlobDeps = { putMany: putCompositeAssets, now: Date.now },
): Promise<string[]> {
  const ids = await Promise.all(blobs.map(hashCompositeBlob))
  const unique = new Map<string, StoredCompositeAsset>()
  ids.forEach((id, index) => {
    if (!unique.has(id)) unique.set(id, { id, blob: blobs[index]!, createdAt: deps.now() })
  })
  await deps.putMany([...unique.values()])
  return ids
}

/**
 * 把一张已经读成 dataUrl 的本机图片**存进程序内**，返回可直接写进图层的 `stored` 引用。
 *
 * 为什么必须走这一步（2026-10-12 杰哥报障「水印里的图读不到」+ 要求「添加进水印的图片
 * 要保存在程序内，直到我把它删除」）：水印编辑器里「从本机磁盘选图」原先只往图层写
 * `{ kind: 'path', path }` —— **只记盘上的位置，图本身没进程序**。后果是三重的：
 *
 * 1. **换台机器就断图**：配置包里只有路径，B 机没这个盘就是没图；
 * 2. **同机器重启也断图**：主进程的路径白名单里只有「本次运行中用对话框选过的目录」
 *    （`sessionAllowedRoots` 是内存 Set），关掉软件就不再放行，渲染直接失败；
 * 3. **不进配置包**：`collectCompositeAssetIds` 只收集 `stored`，`path` 型素材导不出去。
 *
 * 存进资产库后，这三个问题一次性消失，且与 LOGO 库、预设导入走的是**同一套**存储
 * （IndexedDB 的 `compositeAssets`），删除时也有引用计数兜底（`isCompositeAssetReferenced`）。
 *
 * 失败返回 `null`（存不下就别往图层写半个引用），由调用方提示用户重试。
 */
export async function storeCompositeAssetFromDataUrl(
  dataUrl: string,
  name?: string,
): Promise<{ kind: 'stored'; assetId: string; name?: string } | null> {
  try {
    const blob = await dataUrlToCompositeBlob(dataUrl)
    const [assetId] = await storeCompositeBlobs([blob])
    if (!assetId) return null
    return { kind: 'stored', assetId, ...(name ? { name } : {}) }
  } catch (error) {
    console.error('把图片存入程序内失败:', error)
    return null
  }
}

/**
 * 读一张「本机磁盘上的老素材」（图层里 `{ kind: 'path' }` / `{ kind: 'internal' }` 的形态）。
 *
 * 与直接调 `readImageFile` 只差一步：**先请主进程放行它所在的目录**。那种形态的图是在某次
 * 会话里用对话框选进来的，而「选过的目录」只在那**一次运行**的白名单里（内存 Set、重启清空）；
 * 不放行的话连读都读不到，也就永远没机会把它收编成程序内的资产 —— 这正是 2026-10-12 报障
 * 「水印预览与后处理一起失败」的现场。
 *
 * 放行失败与读不到一律返回 `null`，由调用方按「素材缺失」处理。
 */
export async function readLocalAssetImageDataUrl(filePath: string): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.readImageFile) return null
  try {
    await api.authorizeCompositeAssetPath?.(filePath)
    const payload = await api.readImageFile(filePath)
    return payload?.dataUrl ?? null
  } catch (error) {
    console.error('读取本机素材失败:', error)
    return null
  }
}

export async function getCompositeAssetObjectUrl(assetId: string): Promise<string | null> {
  const cached = objectUrlCache.get(assetId)
  if (cached) return cached
  const asset = await getCompositeAsset(assetId)
  // 记录损坏或不是 Blob 时按「资源缺失」处理：绝不能把非 Blob 交给 createObjectURL，
  // 否则会抛 "Overload resolution failed" 并中断整张预览。
  if (!asset || !(asset.blob instanceof Blob)) return null
  const url = URL.createObjectURL(asset.blob)
  objectUrlCache.set(assetId, url, asset.blob.size)
  return url
}

export function revokeCompositeAssetObjectUrl(assetId: string): void {
  const url = objectUrlCache.get(assetId)
  if (!url) return
  objectUrlCache.delete(assetId)
}

export async function removeCompositeAsset(assetId: string): Promise<void> {
  await deleteCompositeAsset(assetId)
  revokeCompositeAssetObjectUrl(assetId)
}

export function collectCompositeAssetIds(state: AssetState): string[] {
  const ids = new Set<string>()
  for (const logo of state.projectLogos) if (logo.assetId) ids.add(logo.assetId)
  for (const preset of state.presets) {
    for (const layer of preset.layers) {
      if ((layer.type === 'image' || layer.type === 'logo') && layer.asset?.kind === 'stored') {
        ids.add(layer.asset.assetId)
      }
    }
  }
  return [...ids]
}

export function isCompositeAssetReferenced(state: AssetState, assetId: string): boolean {
  return collectCompositeAssetIds(state).includes(assetId)
}

/** 从一批图层里收集它们引用的资产 id（`stored` 才有 id；文字层与别种引用形态直接跳过）。 */
export function collectLayerAssetIds(layers: Iterable<CompositeV2Layer>): string[] {
  const ids = new Set<string>()
  for (const layer of layers) {
    if (layer.type === 'text') continue
    if (layer.asset?.kind === 'stored') ids.add(layer.asset.assetId)
  }
  return [...ids]
}

/**
 * 把「已经没人用了」的图片素材从程序里真正删掉。
 *
 * 需求原话（2026-10-12 杰哥）：「添加进水印的图片要保存在程序内，**直到我把它删除**」——
 * 反过来读就是「我删掉它时应该真的释放掉」。如果没有这一步，删图层只是把引用摘了，
 * 图片本身永远留在资产库里（一张 4MB 的水印图 × 几十次改稿就是几百 MB 的白占）。
 *
 * 判据与 LOGO 库删除**同一个**（`isCompositeAssetReferenced`）：同一张素材可能被多个图层、
 * 甚至多套水印共用，还有别的引用就不能删 —— 删了会让别处的图静默变成空白。
 *
 * ⚠️ 必须在 **store 更新之后** 调（调用方先删、再 release）：判据读的是「删完之后」的状态，
 * 早一步调用会把刚刚还被自己引用的资产当成孤儿。
 *
 * 删除失败只留一个孤儿资源、不影响「已删除」这个结果本身，因此只记日志不上抛。
 */
export async function releaseUnreferencedAssets(assetIds: Iterable<string>, getState: () => AssetState): Promise<void> {
  for (const assetId of assetIds) {
    if (isCompositeAssetReferenced(getState(), assetId)) continue
    try {
      await removeCompositeAsset(assetId)
    } catch (error) {
      console.error('释放图片资源失败:', error)
    }
  }
}
