/**
 * 水印预设的导出 / 导入（含树状归属）。
 *
 * 三条口径：
 * 1. **导出的是「预设 + 归属」两件事**，不是一整份工作区快照。归属只收**显式声明**的
 *    （`params[节点].postprocess.watermarkPresetIds` / `byMedia[渠道].watermarkPresetIds`），
 *    继承来的不导——继承是目标机器那棵树自己算出来的，把结果数组塞进文件会让「导入」变成
 *    「往别人树上硬写一份可能已经过期的结论」。
 * 2. **归属用路径名而不是 id**：id 在别人机器上不存在，路径名「产品线/产品/方向」才是两台
 *    机器能对齐的唯一东西。导入时按路径逐层匹配，对不上就报「未恢复」，**绝不自动建节点**——
 *    往用户的项目树里塞别人的目录结构是不可逆的。
 * 3. **图片资产内嵌**：`stored` / `project` / 本地 `path` 的图都读出来转成 dataUrl 写进文件，
 *    导入时重新存回本地资产库。否则「分享水印」发出去的是一堆缺图的空图层。
 *
 * 纯函数（收集 / 解析 / 计划）与 IO（读文件 / 资产转码）同文件但分离：前者有单测覆盖，
 * 后者依赖 IndexedDB 与 Electron 对话框。
 */

import { blobToDataUrl } from '../../../lib/canvasImage'
import { readJsonTextFile, saveText, selectFile, selectSavePath } from '../../../lib/localSave'
import { resolveCollectionPath } from '../../../lib/postprocessProjectTree'
import type { PostprocessMedia } from '../../../lib/postprocessMedia'
import type { AssetCollection } from '../../../types'
import type { ProjectNodeParamsMap } from '../../projectTree/types'
import { normalizeIdentifier } from './compositeIdentifier'
import { normalizePresetProductId } from './compositePresetLibrary'
import { dataUrlToCompositeBlob, getCompositeAssetObjectUrl, storeCompositeBlobs } from './compositeAssets'
import type {
  CompositeV2IdentifierConfig,
  CompositeV2Layer,
  CompositeV2Preset,
  CompositeV2ProjectLogo,
} from './compositeV2Types'

export const PRESET_TRANSFER_KIND = 'tangbao-watermark-presets'
export const PRESET_TRANSFER_VERSION = 1

/** 一条归属：某个预设被显式挂在某个树节点（可再细分到渠道）上。 */
export interface PresetTransferBinding {
  presetId: string
  /** 节点路径名，根在前，如 `['女鞋', '凉鞋', '抖音']` */
  path: string[]
  /** 渠道名；缺省 = 该节点的通用绑定 */
  media?: string
}

export interface PresetTransferFile {
  kind: typeof PRESET_TRANSFER_KIND
  version: number
  exportedAt: string
  /** 导出方的标识符配置（可空）。导入时**默认不覆盖**本机的，由 UI 决定。 */
  identifier?: CompositeV2IdentifierConfig
  presets: CompositeV2Preset[]
  bindings: PresetTransferBinding[]
}

// ---------------------------------------------------------------- 导出

export interface CollectPresetBindingsInput {
  /** 本次要导出的预设 id（决定归属里只保留相关的那几条） */
  presetIds: string[]
  collections: AssetCollection[]
  params: ProjectNodeParamsMap
  media: PostprocessMedia[]
}

/**
 * 收集「这些预设被显式挂在哪些节点 / 渠道上」。
 *
 * 节点已被删除（路径解析为空）时跳过：文件里留一条没有路径的归属，导入方只能显示
 * 「不知道挂哪」，那是噪音。
 */
export function collectPresetBindings(input: CollectPresetBindingsInput): PresetTransferBinding[] {
  const wanted = new Set(input.presetIds)
  if (wanted.size === 0) return []
  const mediaNameById = new Map(input.media.map((item) => [item.id, item.name]))
  const bindings: PresetTransferBinding[] = []

  for (const [collectionId, entry] of Object.entries(input.params)) {
    const override = entry?.postprocess
    if (!override) continue
    const path = resolveCollectionPath(input.collections, collectionId).map((item) => item.name)
    if (path.length === 0) continue

    for (const presetId of override.watermarkPresetIds ?? []) {
      if (wanted.has(presetId)) bindings.push({ presetId, path })
    }
    for (const [mediaId, perMedia] of Object.entries(override.byMedia ?? {})) {
      const ids = perMedia?.watermarkPresetIds
      if (!ids) continue
      const mediaName = mediaNameById.get(mediaId)
      for (const presetId of ids) {
        if (!wanted.has(presetId)) continue
        bindings.push({ presetId, path, ...(mediaName ? { media: mediaName } : {}) })
      }
    }
  }

  return bindings
}

export function buildPresetTransferFile(input: {
  presets: CompositeV2Preset[]
  bindings: PresetTransferBinding[]
  identifier?: CompositeV2IdentifierConfig
  now?: Date
}): PresetTransferFile {
  return {
    kind: PRESET_TRANSFER_KIND,
    version: PRESET_TRANSFER_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    ...(input.identifier ? { identifier: normalizeIdentifier(input.identifier) } : {}),
    presets: input.presets,
    bindings: input.bindings,
  }
}

// ---------------------------------------------------------------- 解析

/** 归一化导入的单个预设：坏字段按默认值兜底，图层保留结构合法的那些。 */
export function normalizeImportedPreset(raw: unknown): CompositeV2Preset | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return null
  const canvas = (value.baseCanvas ?? {}) as { width?: unknown; height?: unknown }
  const width = Number(canvas.width)
  const height = Number(canvas.height)
  const layers = Array.isArray(value.layers)
    ? value.layers.filter((layer): layer is CompositeV2Layer => Boolean(layer) && typeof layer === 'object')
    : []

  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : '导入的水印',
    // 文件里的归属是**导出方机器上的产品 id**，本机多半不存在。这里照读不丢，
    // 但导入落库前必须由调用方改写成「本机的当前产品」—— 见 `PresetManagementTab.applyImport`。
    productId: normalizePresetProductId(value.productId),
    baseCanvas: {
      width: Number.isFinite(width) && width > 0 ? width : 1080,
      height: Number.isFinite(height) && height > 0 ? height : 1920,
    },
    sampleBackgroundPath: typeof value.sampleBackgroundPath === 'string' ? value.sampleBackgroundPath : '',
    layers,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

function normalizeImportedBinding(raw: unknown): PresetTransferBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const presetId = typeof value.presetId === 'string' ? value.presetId.trim() : ''
  if (!presetId) return null
  const path = Array.isArray(value.path)
    ? value.path.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  if (path.length === 0) return null
  return {
    presetId,
    path,
    ...(typeof value.media === 'string' && value.media.trim() ? { media: value.media } : {}),
  }
}

/** 解析导出文件。结构不对（不是本功能出的文件 / 版本更高）一律返回 null，不猜。 */
export function parsePresetTransferFile(text: string): PresetTransferFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const value = parsed as Record<string, unknown>
  if (value.kind !== PRESET_TRANSFER_KIND) return null
  const version = Number(value.version)
  if (!Number.isFinite(version) || version > PRESET_TRANSFER_VERSION) return null
  if (!Array.isArray(value.presets)) return null

  const presets = value.presets
    .map(normalizeImportedPreset)
    .filter((preset): preset is CompositeV2Preset => Boolean(preset))
  if (presets.length === 0) return null

  const bindings = Array.isArray(value.bindings)
    ? value.bindings.map(normalizeImportedBinding).filter((item): item is PresetTransferBinding => Boolean(item))
    : []

  return {
    kind: PRESET_TRANSFER_KIND,
    version,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    ...(value.identifier ? { identifier: normalizeIdentifier(value.identifier) } : {}),
    presets,
    bindings,
  }
}

// ---------------------------------------------------------------- 导入计划

/**
 * 按路径名逐层找节点。
 *
 * 逐层而不是只比最后一级：两条产品线下的「抖音」同名方向很多，只比名字会把水印挂到
 * 另一条产品线去——那比「没恢复」糟糕得多，因为它看起来是成功的。
 */
export function resolveCollectionIdByPath(collections: AssetCollection[], path: string[]): string | null {
  let parentId: string | null = null
  let currentId: string | null = null
  for (const name of path) {
    const found = collections.find((item) => item.name === name && (item.parentId ?? null) === parentId)
    if (!found) return null
    currentId = found.id
    parentId = found.id
  }
  return currentId
}

export type PresetImportMode = 'add' | 'update' | 'copy'

export interface PresetImportResolution {
  /** 文件里的原始 id */
  sourceId: string
  /** 落到本机的 id（副本模式下是新 id） */
  finalId: string
  name: string
  mode: PresetImportMode
}

export interface PresetImportBinding {
  /** 对应 `PresetImportResolution.finalId` */
  presetId: string
  collectionId: string
  /** 渠道 id；null = 写节点通用绑定 */
  mediaId: string | null
}

export interface PresetImportPlan {
  presets: CompositeV2Preset[]
  resolutions: PresetImportResolution[]
  bindings: PresetImportBinding[]
  /** 路径在本机对不上的归属（只报告，不动树） */
  unmatchedBindings: PresetTransferBinding[]
  identifier?: CompositeV2IdentifierConfig
}

export interface PlanPresetImportInput {
  file: PresetTransferFile
  collections: AssetCollection[]
  media: PostprocessMedia[]
  existingPresets: CompositeV2Preset[]
  /** true = 同 id 也一律另存为副本；false = 同 id 覆盖（「恢复预设」的默认语义） */
  asCopy?: boolean
  now?: () => number
}

export function planPresetImport(input: PlanPresetImportInput): PresetImportPlan {
  const timestamp = (input.now ?? Date.now)()
  const existingIds = new Set(input.existingPresets.map((preset) => preset.id))
  const mediaIdByName = new Map(input.media.map((item) => [item.name, item.id]))
  const presets: CompositeV2Preset[] = []
  const resolutions: PresetImportResolution[] = []

  input.file.presets.forEach((preset, index) => {
    const exists = existingIds.has(preset.id)
    const mode: PresetImportMode = !exists ? 'add' : input.asCopy ? 'copy' : 'update'
    const finalId = mode === 'copy' ? `${preset.id}-copy-${timestamp}-${index}` : preset.id
    presets.push({ ...preset, id: finalId })
    resolutions.push({ sourceId: preset.id, finalId, name: preset.name, mode })
  })

  const finalIdBySource = new Map(resolutions.map((item) => [item.sourceId, item.finalId]))
  const bindings: PresetImportBinding[] = []
  const unmatchedBindings: PresetTransferBinding[] = []

  for (const binding of input.file.bindings) {
    const finalId = finalIdBySource.get(binding.presetId)
    if (!finalId) continue
    const collectionId = resolveCollectionIdByPath(input.collections, binding.path)
    if (!collectionId) {
      unmatchedBindings.push({ ...binding, presetId: finalId })
      continue
    }
    const mediaId = binding.media ? (mediaIdByName.get(binding.media) ?? null) : null
    if (binding.media && !mediaId) {
      // 渠道名对不上但要保留节点绑定：挂到通用值上比整条丢掉好，且提示里会说明
      unmatchedBindings.push({ ...binding, presetId: finalId })
    }
    bindings.push({ presetId: finalId, collectionId, mediaId })
  }

  return {
    presets,
    resolutions,
    bindings,
    unmatchedBindings,
    ...(input.file.identifier ? { identifier: input.file.identifier } : {}),
  }
}

// ---------------------------------------------------------------- IO：资产内嵌 / 还原

async function objectUrlToDataUrl(objectUrl: string): Promise<string | null> {
  try {
    const response = await fetch(objectUrl)
    return await blobToDataUrl(await response.blob())
  } catch {
    return null
  }
}

async function readLocalImageAsDataUrl(path: string): Promise<string | null> {
  try {
    const payload = await window.electronAPI?.readImageFile?.(path)
    return payload?.dataUrl ?? null
  } catch {
    return null
  }
}

/**
 * 把预设里的图片资产读成 dataUrl 内嵌。
 *
 * `path` 类型也一并内嵌：分享出去的预设带着 `C:\Users\A\logo.png` 对接收方毫无意义，
 * 而内嵌之后至少能做到「导入即可用」。读不到（文件已移动）就原样保留，不因此中断导出。
 */
export async function embedPresetAssets(
  presets: CompositeV2Preset[],
  projectLogos: CompositeV2ProjectLogo[] = [],
): Promise<CompositeV2Preset[]> {
  const result: CompositeV2Preset[] = []

  for (const preset of presets) {
    const layers: CompositeV2Layer[] = []
    for (const layer of preset.layers) {
      if (layer.type === 'text' || !layer.asset || layer.asset.kind === 'dataUrl') {
        layers.push(layer)
        continue
      }
      const asset = layer.asset
      let dataUrl: string | null = null
      let name: string | undefined

      if (asset.kind === 'stored' || asset.kind === 'project') {
        const logo = asset.kind === 'project' ? projectLogos.find((item) => item.id === asset.id) : undefined
        const assetId = asset.kind === 'stored' ? asset.assetId : (logo?.assetId ?? '')
        name = asset.kind === 'stored' ? asset.name : logo?.name
        if (assetId) {
          const objectUrl = await getCompositeAssetObjectUrl(assetId).catch(() => null)
          dataUrl = objectUrl ? await objectUrlToDataUrl(objectUrl) : null
        }
        // LOGO 库里那份可能只有 dataUrl（没有落资产库），这时直接用它，别把图层导成空的
        if (!dataUrl) dataUrl = logo?.dataUrl ?? null
      } else {
        name = asset.path.split(/[\\/]/).pop()
        dataUrl = await readLocalImageAsDataUrl(asset.path)
      }

      layers.push(dataUrl ? { ...layer, asset: { kind: 'dataUrl', dataUrl, ...(name ? { name } : {}) } } : layer)
    }
    result.push({ ...preset, layers })
  }

  return result
}

/** 把文件里的 dataUrl 资产存回本地资产库，转成 `stored` 引用（与预设内部其余图层同构）。 */
export async function restorePresetAssets(presets: CompositeV2Preset[]): Promise<CompositeV2Preset[]> {
  const jobs: { presetIndex: number; layerIndex: number; dataUrl: string; name?: string }[] = []
  presets.forEach((preset, presetIndex) => {
    preset.layers.forEach((layer, layerIndex) => {
      if (layer.type === 'text' || !layer.asset) return
      if (layer.asset.kind !== 'dataUrl' || !layer.asset.dataUrl) return
      jobs.push({
        presetIndex,
        layerIndex,
        dataUrl: layer.asset.dataUrl,
        ...(layer.asset.name ? { name: layer.asset.name } : {}),
      })
    })
  })
  if (jobs.length === 0) return presets

  const blobs = await Promise.all(jobs.map((job) => dataUrlToCompositeBlob(job.dataUrl)))
  const assetIds = await storeCompositeBlobs(blobs)

  const next = presets.map((preset) => ({ ...preset, layers: [...preset.layers] }))
  jobs.forEach((job, index) => {
    const assetId = assetIds[index]
    if (!assetId) return
    const layer = next[job.presetIndex]?.layers[job.layerIndex]
    if (!layer || layer.type === 'text') return
    next[job.presetIndex]!.layers[job.layerIndex] = {
      ...layer,
      asset: { kind: 'stored', assetId, ...(job.name ? { name: job.name } : {}) },
    }
  })
  return next
}

// ---------------------------------------------------------------- IO：文件读写

export interface PresetFileSaveResult {
  ok: boolean
  filePath?: string
  error?: string
}

function defaultExportName(now = new Date()): string {
  return `tangbao_watermarks_${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
}

/**
 * 写导出文件。
 *
 * 保存目录受主进程白名单约束（桌面 / 文档 / 下载 / 图片 / userData），选到别处会写失败——
 * 这时明确告诉用户换目录，而不是只报「保存失败」。
 */
export async function savePresetTransferFile(file: PresetTransferFile): Promise<PresetFileSaveResult> {
  const filePath = await selectSavePath(defaultExportName(), [{ name: 'JSON', extensions: ['json'] }])
  if (!filePath) return { ok: false }
  const ok = await saveText(filePath, JSON.stringify(file, null, 2))
  if (!ok) {
    return { ok: false, error: '写入失败：请选择桌面 / 文档 / 下载 / 图片目录下的位置再试。' }
  }
  return { ok: true, filePath }
}

export async function pickPresetTransferFile(): Promise<{ text?: string; error?: string }> {
  const filePath = await selectFile([{ name: 'JSON', extensions: ['json'] }])
  if (!filePath) return {}
  const text = await readJsonTextFile(filePath)
  if (!text) return { error: '读取失败：文件无法读取或不是文本文件。' }
  return { text }
}
