import type { CompositeV2StoreState } from '../storeV2'
import { dataUrlToCompositeBlob, storeCompositeBlobs } from './compositeAssets'
import type { CompositeV2ImageAssetRef, CompositeV2ProjectLogo } from './compositeV2Types'

type MigrationDeps = {
  getState: () => CompositeV2StoreState
  setState: (patch: Partial<CompositeV2StoreState>) => void
  storeAssets?: typeof storeCompositeBlobs
  /**
   * 把本机文件读成 dataUrl（读不到返回 `null`）。
   *
   * 只有 `path` 型资源需要它 —— 那是「从本机磁盘选图」直接写进图层的形态，
   * 只记住了盘上的位置，**换台机器就读不到**，导出前必须读进来落库。
   *
   * 用注入而不是在模块里直接调 `window.electronAPI`：这个模块要保持能在非 Electron
   * 环境下跑（测试说给假实现就给假实现）。
   */
  readImageDataUrl?: (path: string) => Promise<string | null>
}

export function hasLegacyCompositeAssets(state: Pick<CompositeV2StoreState, 'projectLogos' | 'presets'>): boolean {
  if (state.projectLogos.some((logo) => typeof logo.dataUrl === 'string')) return true
  return state.presets.some((preset) =>
    preset.layers.some((layer) => {
      if (layer.type !== 'image' && layer.type !== 'logo') return false
      const kind = layer.asset?.kind
      // `path` 也算：它只记了本机磁盘上的位置，配置包搬到别的机器上就是断图。
      // 导出前那一步（`buildCompositeBackup`）会把它读进来落库成 `stored`。
      return kind === 'dataUrl' || kind === 'project' || kind === 'path'
    }),
  )
}

export async function migrateLegacyCompositeAssets(deps: MigrationDeps): Promise<number> {
  const snapshot = deps.getState()
  if (!hasLegacyCompositeAssets(snapshot)) return 0

  const dataUrls: string[] = []
  const addDataUrl = (value?: string) => {
    if (value && !dataUrls.includes(value)) dataUrls.push(value)
  }
  snapshot.projectLogos.forEach((logo) => addDataUrl(logo.dataUrl))
  /** 「从本机磁盘选图」写进来的绝对路径；读得到就迁成 `stored`，读不到保持原样。 */
  const paths: string[] = []
  snapshot.presets.forEach((preset) =>
    preset.layers.forEach((layer) => {
      if (layer.type !== 'image' && layer.type !== 'logo') return
      if (layer.asset?.kind === 'dataUrl') addDataUrl(layer.asset.dataUrl)
      if (layer.asset?.kind === 'path' && layer.asset.path && !paths.includes(layer.asset.path)) {
        paths.push(layer.asset.path)
      }
    }),
  )

  // path → dataUrl：读不到（文件不在本机 / 没权限）就跳过 —— 保留 `path` 原样，
  // 至少不把用户已经配好的东西改坏，只是它仍然跨不了机器。
  const dataUrlByPath = new Map<string, string>()
  for (const path of paths) {
    try {
      const dataUrl = await deps.readImageDataUrl?.(path)
      if (!dataUrl) continue
      dataUrlByPath.set(path, dataUrl)
      addDataUrl(dataUrl)
    } catch {
      // 单个文件读失败不该拖垮整次迁移：导出继续，只是这张图这次不进包
    }
  }

  const blobs = await Promise.all(dataUrls.map(dataUrlToCompositeBlob))
  const ids = await (deps.storeAssets ?? storeCompositeBlobs)(blobs)
  const assetIdByDataUrl = new Map(dataUrls.map((dataUrl, index) => [dataUrl, ids[index]!]))
  const latest = deps.getState()
  const projectLogos = latest.projectLogos.map((logo): CompositeV2ProjectLogo => {
    if (logo.assetId) return logo
    const assetId = logo.dataUrl ? assetIdByDataUrl.get(logo.dataUrl) : undefined
    if (!assetId) return logo
    return {
      id: logo.id,
      name: logo.name,
      assetId,
      width: logo.width,
      height: logo.height,
    }
  })
  const assetByProjectId = new Map(
    projectLogos.flatMap((logo) =>
      logo.assetId ? [[logo.id, { assetId: logo.assetId, name: logo.name }] as const] : [],
    ),
  )
  const presets = latest.presets.map((preset) => ({
    ...preset,
    layers: preset.layers.map((layer) => {
      if (layer.type !== 'image' && layer.type !== 'logo') return layer
      const asset = migrateAssetRef(layer.asset, assetIdByDataUrl, assetByProjectId, dataUrlByPath)
      return asset === layer.asset ? layer : { ...layer, asset }
    }),
  }))

  deps.setState({ projectLogos, presets })
  return new Set(ids).size
}

function migrateAssetRef(
  asset: CompositeV2ImageAssetRef | null,
  assetIdByDataUrl: Map<string, string>,
  assetByProjectId: Map<string, { assetId: string; name: string }>,
  dataUrlByPath: Map<string, string>,
): CompositeV2ImageAssetRef | null {
  if (!asset) return asset
  if (asset.kind === 'dataUrl') {
    const assetId = assetIdByDataUrl.get(asset.dataUrl)
    return assetId ? { kind: 'stored', assetId, name: asset.name } : asset
  }
  if (asset.kind === 'project') {
    const resolved = assetByProjectId.get(asset.id)
    return resolved ? { kind: 'stored', ...resolved } : asset
  }
  // 「从本机磁盘选图」的形态：读到了才算迁得动，读不到就原样留着（不假装成功）
  if (asset.kind === 'path') {
    const dataUrl = dataUrlByPath.get(asset.path)
    const assetId = dataUrl ? assetIdByDataUrl.get(dataUrl) : undefined
    return assetId ? { kind: 'stored', assetId } : asset
  }
  return asset
}
