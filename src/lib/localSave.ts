import type { AgentConversation, AgentRound, TaskRecord, ThumbnailVariant } from '../types'
import type { UpdateStatus } from '../hooks/useAutoUpdate'
import type { ApiSecretBundle } from './apiSecrets'
import { sanitizeFileNameCore } from './sanitizeFileName'
import type {
  AssetCatalogCursorPage,
  AssetCatalogQuery,
  AssetCollection,
  AssetTag,
  AssetTombstone,
  AssetUsageEvent,
  ExternalAssetCommand,
  GeneratedAsset,
} from '../types'
import { sanitizeGeneratedImageFilenamePart } from './generatedImageFilename'
import { decodeDataUrlToBytes } from './imageFingerprint'
import { escapeRegExp } from './escapeRegExp'

type ElectronAPI = {
  apiFetch?: (
    request: {
      id: string
      url: string
      method: string
      headers: Array<[string, string]>
      body?: ArrayBuffer
      redirect: RequestRedirect
    },
    onEvent: (
      event:
        | { id: string; type: 'chunk'; data: Uint8Array | ArrayBuffer }
        | { id: string; type: 'done' }
        | { id: string; type: 'error'; error: string },
    ) => void,
  ) => Promise<{ status: number; statusText: string; headers: Array<[string, string]> }>
  cancelApiFetch?: (id: string) => void
  selectDirectory: () => Promise<string | null>
  selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  selectFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[] | null>
  saveImage: (filePath: string, dataUrl: string) => Promise<boolean>
  /** 同 saveImage，但直接传已解码字节，省掉主进程的 base64 解码（大图热点路径） */
  saveImageBytes?: (filePath: string, bytes: Uint8Array) => Promise<boolean>
  /** 硬链接：同一物理文件、两个目录入口，不占额外磁盘空间 */
  linkFile?: (sourcePath: string, targetPath: string) => Promise<boolean>
  saveCompositeImage: (filePath: string, dataUrl: string, maxSizeKb?: number) => Promise<boolean>
  /** 同 saveCompositeImage，但直接传已解码字节；导出成图是大图热点，省掉主进程同步 base64 解码 */
  saveCompositeImageBytes?: (filePath: string, bytes: Uint8Array) => Promise<boolean>
  authorizeCompositeOutputDirectory?: (dirPath: string) => Promise<boolean>
  saveJson: (filePath: string, data: unknown) => Promise<boolean>
  saveText: (filePath: string, content: string) => Promise<boolean>
  ensureDir: (dirPath: string) => Promise<boolean | string>
  pathJoin: (...paths: string[]) => Promise<string>
  checkExists: (filePath: string) => Promise<boolean>
  readDir: (dirPath: string) => Promise<string[]>
  readDirEntries?: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>
  readImageFile: (filePath: string) => Promise<{ path: string; name: string; dataUrl: string } | null>
  listImageFiles: (dirPath: string) => Promise<{ path: string; name: string; dataUrl?: string }[]>
  listCompositeBackgroundFiles?: (
    dirPath: string,
    recursive: boolean,
  ) => Promise<Array<{ path: string; name: string; relativeDir: string; width: number; height: number }>>
  scanEnteredCompositeBackgroundFolder?: (
    dirPath: string,
    recursive: boolean,
  ) => Promise<
    | {
        success: true
        folderPath: string
        files: Array<{ path: string; name: string; relativeDir: string; width: number; height: number }>
      }
    | { success: false; error: string }
  >
  pickImageFile: (input: {
    path: string
    mode: 'random' | 'sequential'
    index: number
  }) => Promise<{ path: string; name: string; dataUrl: string } | null>
  deleteCompositeFiles?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  /** 删除本地导出的图片文件（可位于库根外的用户自定义目录；仅限图片扩展名+常规文件） */
  deleteLocalImageFiles?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  distributeFile?: (input: {
    sourcePath: string
    targetPath: string
    mode: 'copy' | 'move'
    appendRandomByte?: boolean
  }) => Promise<{ success: boolean }>
  readFileBuffer: (filePath: string) => Promise<{ data: ArrayBuffer; name: string } | null>
  getDefaultPath: () => Promise<string>
  getStateFilePath?: () => Promise<string>
  /** 在资源管理器中显示文件/打开目录；目标缺失时主进程回退到最近的已存在父目录。 */
  openInExplorer: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  getLocalSavePath: () => Promise<string | null>
  setLocalSavePath: (path: string) => Promise<void>
  copyCacheToRoot?: (newRoot: string) => Promise<Array<{ from: string; to: string }>>
  readJsonText: (filePath: string) => Promise<string | null>
  writeJsonText: (filePath: string, content: string, backupIntervalOrSkip?: number | boolean) => Promise<boolean>
  listBackups: (filePath: string) => Promise<string[]>
  checkBackupHasData: (backupPath: string) => Promise<boolean>
  restoreFromBackup: (backupPath: string, targetPath: string) => Promise<boolean>
  deleteBackup: (backupPath: string) => Promise<boolean>
  /** 按「前缀 + 保留份数」清理目录下的备份文件（主进程完成列目录与删旧） */
  pruneLibraryBackups?: (dir: string, prefix: string, keep: number) => Promise<number>
  saveZipBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<boolean>
  selectZipSavePath?: (defaultName: string) => Promise<string | null>
  exportZipToPath?: (request: ElectronZipExportRequest) => Promise<{ success: boolean; error?: string }>
  deleteCacheImages?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  reconcileCacheImages?: (referencedFileNames: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  getDesktopPath: () => Promise<string>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
  checkForUpdate: () => Promise<{ success: boolean; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean }>
  getAppVersion: () => Promise<string>
  loadApiSecrets?: () => Promise<{ available: boolean; secrets: ApiSecretBundle; error?: string }>
  saveApiSecrets?: (secrets: ApiSecretBundle) => Promise<{ success: boolean; error?: string }>
  getStartupMode?: () => Promise<{ safeMode: boolean }>
  getCloseToTray?: () => Promise<boolean>
  setCloseToTray?: (enabled: boolean) => Promise<boolean>
  assetCatalogUpsert?: (records: Array<{ asset: GeneratedAsset; localPath?: string }>) => Promise<{ success: boolean }>
  assetCatalogRecordUsage?: (events: AssetUsageEvent[]) => Promise<{ success: boolean }>
  assetCatalogExportUsage?: () => Promise<AssetUsageEvent[]>
  assetCatalogGetUsageByAsset?: (assetId: string) => Promise<AssetUsageEvent[]>
  assetCatalogClearUsage?: () => Promise<{ success: boolean }>
  assetCatalogDelete?: (assetIds: string[]) => Promise<{ success: boolean }>
  assetCatalogClear?: () => Promise<{ success: boolean }>
  assetCatalogQuery?: (query: AssetCatalogQuery) => Promise<AssetCatalogCursorPage>
  /** 全量导出素材记录（含回收站），供备份/合并使用 */
  assetCatalogExportAll?: () => Promise<GeneratedAsset[]>
  assetCatalogGet?: (assetId: string) => Promise<unknown>
  /** 按原图 imageId 反查素材详情（素材 id 与 imageId 是两套键） */
  assetCatalogGetByImageId?: (imageId: string) => Promise<unknown>
  assetCatalogGetAssetsByIds?: (ids: string[]) => Promise<GeneratedAsset[]>
  assetCatalogPutCollections?: (records: AssetCollection[]) => Promise<{ success: boolean }>
  assetCatalogDeleteCollection?: (id: string) => Promise<{ success: boolean }>
  /** 软删除项目（进文件夹回收站，整棵子树） */
  assetCatalogTrashCollection?: (id: string) => Promise<{ success: boolean }>
  /** 恢复项目（清除软删除标记，整棵子树） */
  assetCatalogRestoreCollection?: (id: string) => Promise<{ success: boolean }>
  assetCatalogGetCollections?: () => Promise<AssetCollection[]>
  assetCatalogPutTags?: (records: AssetTag[]) => Promise<{ success: boolean }>
  assetCatalogDeleteTag?: (id: string) => Promise<{ success: boolean }>
  assetCatalogGetTags?: () => Promise<AssetTag[]>
  assetCatalogPutTombstones?: (records: AssetTombstone[]) => Promise<{ success: boolean }>
  assetCatalogDeleteTombstone?: (imageId: string) => Promise<{ success: boolean }>
  assetCatalogGetTombstones?: (imageIds: string[]) => Promise<AssetTombstone[]>
  assetCatalogGetAllTombstones?: () => Promise<AssetTombstone[]>
  assetCatalogMetaGet?: (key: string) => Promise<string | null>
  assetCatalogMetaSet?: (key: string, value: string) => Promise<{ success: boolean }>
  assetCatalogPurge?: (
    assetIds: string[],
    now: number,
    tasksToPatch?: Array<{ id: string; value: unknown }>,
  ) => Promise<{
    purged: string[]
    tombstones: AssetTombstone[]
  }>
  /** 清理仅以参考图身份归档的素材（不写墓碑），返回删除的素材 id */
  assetCatalogCleanupReferenceAssets?: () => Promise<string[]>
  /** 近似重复检测（感知哈希 Hamming） */
  assetCatalogNearDuplicates?: (threshold?: number) => Promise<Array<{ assets: GeneratedAsset[]; avgHamming: number }>>
  /** 衍生链（上游输入 + 下游产物） */
  assetCatalogDerivedAssets?: (assetId: string) => Promise<{
    parents: GeneratedAsset[]
    children: GeneratedAsset[]
  }>
  assetCatalogRecommend?: (input: {
    query?: string
    context?: string
    similarToAssetId?: string
    limit?: number
  }) => Promise<Array<{ asset: GeneratedAsset; score: number }>>
  assetCatalogStatus?: () => Promise<{ ready: boolean; assetCount: number; backend: 'sqlite-fts5' }>
  appDataGet?: (namespace: string, id: string) => Promise<unknown>
  appDataGetAll?: (namespace: string) => Promise<unknown[]>
  appDataGetMany?: (namespace: string, ids: string[]) => Promise<unknown[]>
  appDataPut?: (namespace: string, id: string, value: unknown) => Promise<{ success: boolean }>
  appDataPutMany?: (namespace: string, records: Array<{ id: string; value: unknown }>) => Promise<{ success: boolean }>
  /** 跨命名空间批量写：一次往返提交多条不同 namespace 的记录，用于合并「图片 + 缩略图」 */
  appDataPutBatch?: (entries: Array<{ namespace: string; id: string; value: unknown }>) => Promise<{ success: boolean }>
  appDataReplace?: (namespace: string, records: Array<{ id: string; value: unknown }>) => Promise<{ success: boolean }>
  appDataDelete?: (namespace: string, id: string) => Promise<{ success: boolean }>
  appDataDeleteMany?: (namespace: string, ids: string[]) => Promise<{ success: boolean }>
  appDataDeleteImageRecords?: (ids: string[]) => Promise<{ success: boolean }>
  appDataClearImageRecords?: () => Promise<{ success: boolean }>
  appDataClear?: (namespace: string) => Promise<{ success: boolean }>
  appDataCounts?: (namespaces: string[]) => Promise<Record<string, number>>
  appDataImportStores?: (stores: Record<string, unknown[]>) => Promise<{ success: boolean }>
  appDataCommitImportedRecords?: (records: {
    images: unknown[]
    thumbnails: unknown[]
    tasks: unknown[]
    replaceTasks?: boolean
  }) => Promise<{ success: boolean }>
  appDataUpdateImageLocalPaths?: (mappings: Array<{ from: string; to: string }>) => Promise<{ success: boolean }>
  getAssetApiStatus?: () => Promise<{
    enabled: boolean
    host: '127.0.0.1'
    port: number
    token: string
    baseUrl: string
    /** 可直接粘进 MCP 客户端配置的启动命令；开发版 args 里会带上应用目录。 */
    mcp: { command: string; args: string[] }
  }>
  configureAssetApi?: (input: { enabled: boolean; port?: number }) => Promise<{
    enabled: boolean
    host: '127.0.0.1'
    port: number
    token: string
    baseUrl: string
    mcp: { command: string; args: string[] }
  }>
  onExternalAssetCommand?: (callback: (payload: { id: string; command: ExternalAssetCommand }) => void) => () => void
  /** tangbao:// 深链接（打开素材 / 搜索 / 导入 / 打开项目） */
  onDeepLink?: (
    callback: (
      payload:
        | { kind: 'open'; assetId: string }
        | { kind: 'search'; query: string }
        | { kind: 'import'; path: string }
        | { kind: 'collection'; collectionId: string },
    ) => void,
  ) => () => void
  /** 应用管理的原图或工作区图片文件被外部删除。 */
  onLibraryImageFileRemoved?: (callback: (payload: { path: string; imageId?: string }) => void) => () => void
  completeExternalAssetCommand?: (payload: { id: string; result?: unknown; error?: string }) => void
  /** 扫描旧版本 userData 目录（糖包 / tangbao / 糖包 V2 等），返回可导入内容概况 */
  scanLegacySources?: () => Promise<LegacySourceInfo[]>
  /** 从旧目录导入数据到当前 userData（只复制不覆盖）；IndexedDB 仅复制匹配当前运行模式的目录 */
  importLegacySource?: (payload: {
    sourceDir: string
    selection: {
      importState: boolean
      importLocalSettings: boolean
      importLocalSaves: boolean
      importIndexedDb: boolean
    }
  }) => Promise<{ success: boolean; error?: string; result?: LegacyImportResult }>
  /** 重启应用（导入 IndexedDB 目录后需重启才能被 Chromium 识别） */
  relaunchApp?: () => Promise<{ success: boolean }>
  /** 磁盘真实占用统计（cache-images 原图 + 库根 backups + 库根 thumbs） */
  getDiskStorageUsage?: () => Promise<{
    cacheDir: string | null
    imagesBytes: number
    imagesCount: number
    backupBytes: number
    thumbsBytes: number
    thumbsCount: number
  }>
  /** 读磁盘缩略图（库根 thumbs/，webp）；未命中返回 null。variant 决定通道（默认 full） */
  readThumbnail?: (
    id: string,
    version: number,
    variant?: ThumbnailVariant,
  ) => Promise<{ dataUrl: string; width?: number; height?: number } | null>
  /** 写磁盘缩略图（webp 字节）；variant 决定通道（默认 full） */
  writeThumbnail?: (id: string, version: number, dataUrl: string, variant?: ThumbnailVariant) => Promise<boolean>
  /** 删除图片的全部磁盘缩略图（full + grid 所有版本），返回删除数量 */
  deleteThumbnails?: (imageIds: string[]) => Promise<{ deleted: number }>
  /** 文件存在性检查（主进程 fs.existsSync，路径限库内） */
  fileExists?: (filePath: string) => Promise<boolean>
  /** 库根备份目录（ZIP 备份默认位置） */
  getLibraryBackupsPath?: () => Promise<string | null>
  /** 库完整性校验（主进程只读：SQLite integrity_check + 原图抽查 + 孤儿/缺失报告） */
  runLibraryIntegrityCheck?: (referencedPaths: string[]) => Promise<{
    catalog: 'ok' | 'corrupt' | 'unavailable'
    catalogDetail?: string
    assetCount: number
    sampled: number
    mismatched: Array<{ fileName: string; expected: string; actual: string }>
    orphanFiles: string[]
    missingFiles: string[]
    checkedAt: number
  } | null>
  /** 按项目树复制原图副本到目标目录（主进程逐文件复制，不占渲染进程内存） */
  exportProjectCopies?: (
    targetRoot: string,
    entries: Array<{ sourcePath: string; targetPath: string; assetId?: string }>,
  ) => Promise<{ copied: number; failed: Array<{ targetPath: string; error: string }>; total: number } | null>
  /** 批量导出图片到文件夹（sourcePath 复制 / dataUrl 写盘） */
  exportImagesToFolder?: (
    targetDir: string,
    files: Array<{ fileName: string; sourcePath?: string; dataUrl?: string }>,
  ) => Promise<{ saved: number; failed: Array<{ fileName: string; error: string }>; total: number } | null>
  /** 原生剪贴板写入图片（主进程 nativeImage） */
  writeImageToClipboard?: (dataUrl: string) => Promise<boolean>
  /** 原生系统通知（主进程 Notification，点击聚焦窗口） */
  showNotification?: (title: string, body?: string) => Promise<boolean>
  /** 通用原生保存对话框 */
  selectSavePath?: (defaultName: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  /** 主进程流式读取备份 manifest（不整包载入） */
  readZipManifest?: (filePath: string) => Promise<
    | {
        success: true
        manifest: unknown
        entryPaths: string[]
        entriesTotal: number
        totalCompressedBytes: number
        manifestBytes: number
      }
    | { success: false; error: string }
  >
  /** 主进程按条目读取备份内容（含 CRC 校验） */
  readZipEntry?: (
    filePath: string,
    archivePath: string,
  ) => Promise<{ success: true; bytes: Uint8Array } | { success: false; error: string }>
  isElectron: boolean
}

export type ElectronZipExportRequest = {
  destinationPath: string
  manifestJson: string
  entries: Array<
    | { sourcePath: string; archivePath: string; mtime?: number }
    | { data: Uint8Array; archivePath: string; mtime?: number }
  >
}

/** 旧版 userData 目录中的 IndexedDB 数据目录概况（与主进程 legacy-data-import.ts 对应）。 */
export interface LegacyIndexedDbEntryInfo {
  /** leveldb 目录名，如 file__0.indexeddb.leveldb */
  dirName: string
  sizeMb: number
  /** 是否为当前运行模式（打包版 file:// / dev http://localhost:41731）的数据 */
  matchesCurrentOrigin: boolean
}

/** 旧版 userData 目录概况（与主进程 legacy-data-import.ts 对应）。 */
export interface LegacySourceInfo {
  dir: string
  dirName: string
  stateFileMtime: number | null
  hasLocalSettings: boolean
  hasLocalSaves: boolean
  localSavesSizeMb: number
  indexedDbEntries: LegacyIndexedDbEntryInfo[]
  hasBackups: boolean
  sizeMb: number
}

/** 旧数据导入结果（与主进程 legacy-data-import.ts 对应）。 */
export interface LegacyImportResult {
  imported: string[]
  skipped: string[]
  notes: string[]
}

export interface LegacyImportSelection {
  importState: boolean
  importLocalSettings: boolean
  importLocalSaves: boolean
  importIndexedDb: boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

function getAPI(): ElectronAPI | null {
  return typeof window !== 'undefined' ? (window.electronAPI ?? null) : null
}

export function isElectron(): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return true
  return Boolean(getAPI()?.isElectron)
}

export async function selectLocalSaveDirectory(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  return api.selectDirectory()
}

/** 原生打开对话框（Electron）；非 Electron 环境返回 null。 */
export async function selectFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  const api = getAPI()
  if (!api?.selectFile) return null
  return api.selectFile(filters)
}

/**
 * 图片写盘统一入口。
 *
 * 主进程过去要在自己的事件循环上对整张图的 base64 字符串做 `Buffer.from(..., 'base64')`
 * （5MB 图 ≈ 6.7M 字符）后再同步 `writeFileSync`——解码与写盘两段都阻塞主进程，
 * 而主进程一卡整窗都卡。现在解码改在渲染进程走 `Uint8Array.fromBase64` 原生快路径
 * （见 `imageFingerprint.decodeDataUrlToBytes`），IPC 只搬原始字节（比重 1/3 的 base64 字符串更小），
 * 主进程只剩一次异步写盘。
 *
 * 仍保留 dataUrl 回退：① 旧 preload 没有该通道；② 入参不是合法 base64（能力探测/异常数据）时，
 * 继续交给主进程解析，保持改动前的容错行为。
 */
async function saveImageViaApi(
  api: NonNullable<ReturnType<typeof getAPI>>,
  filePath: string,
  dataUrl: string,
  bytes?: Uint8Array,
): Promise<boolean> {
  if (api.saveImageBytes) {
    // 只有真要写字节时才解码 dataUrl：原实现无论走哪条通道都会先解一遍 base64。
    // 调用方已持有字节时（文件夹导入）直接透传，省掉一次主线程解码。
    const payload = bytes ?? decodeDataUrlToBytes(dataUrl)
    try {
      return await api.saveImageBytes(filePath, payload)
    } catch {
      // 落到下面的 dataUrl 通道
    }
  }
  return api.saveImage(filePath, dataUrl)
}

/**
 * 合成图（含水印）写盘。调用方是后处理（`features/postprocess/taskPostprocess`），
 * `api` 由调用方显式传入，不依赖全局注入。
 *
 * 与 `saveImage` 同策略：优先在渲染进程解码后走字节通道（合成图常有 10MB+，
 * 主进程同步解码 base64 会连带卡住窗口消息与其它 IPC），缺通道或失败时回退 dataUrl。
 */
export async function saveCompositeImage(
  api: NonNullable<Window['electronAPI']>,
  filePath: string,
  dataUrl: string,
): Promise<boolean> {
  const saveBytes = api.saveCompositeImageBytes
  if (saveBytes) {
    try {
      return await saveBytes(filePath, decodeDataUrlToBytes(dataUrl))
    } catch {
      // 落到下面的 dataUrl 通道
    }
  }
  return api.saveCompositeImage(filePath, dataUrl)
}

/** 原生保存图片（Electron，主进程写盘）；非 Electron 环境返回 false。 */
export async function saveImage(filePath: string, dataUrl: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return saveImageViaApi(api, filePath, dataUrl)
}

/** 写文本文件（Electron，主进程写盘，无 .bak 自动备份）；非 Electron 环境返回 false。 */
export async function saveText(filePath: string, content: string): Promise<boolean> {
  const api = getAPI()
  if (!api?.saveText) return false
  try {
    return await api.saveText(filePath, content)
  } catch {
    return false
  }
}

export async function getLocalSavePath(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const saved = await api.getLocalSavePath()
  if (saved) return saved
  const defaultPath = await api.getDefaultPath()
  if (defaultPath) {
    await api.setLocalSavePath(defaultPath)
    return defaultPath
  }
  return null
}

export async function setLocalSavePath(path: string): Promise<void> {
  const api = getAPI()
  if (!api) return
  await api.setLocalSavePath(path)
}

export async function copyRawCacheImagesToRoot(newRoot: string): Promise<Array<{ from: string; to: string }>> {
  return (await getAPI()?.copyCacheToRoot?.(newRoot)) ?? []
}

export async function getDefaultLocalSavePath(): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  return api.getDefaultPath()
}

export async function openInExplorer(filePath: string): Promise<{ ok: boolean; error?: string }> {
  const api = getAPI()
  if (!api) return { ok: false, error: '当前环境不支持打开文件位置' }
  try {
    return await api.openInExplorer(filePath)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function readFileBuffer(filePath: string): Promise<{ data: ArrayBuffer; name: string } | null> {
  const api = getAPI()
  if (!api) return null
  return api.readFileBuffer(filePath)
}

export async function readDirectory(dirPath: string): Promise<string[]> {
  const api = getAPI()
  if (!api) return []
  return api.readDir(dirPath)
}

/** 读取目录条目（含文件/目录类型）；非 Electron 环境返回 []。 */
export async function readDirectoryEntries(dirPath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
  const api = getAPI()
  if (!api?.readDirEntries) return []
  return api.readDirEntries(dirPath)
}

export async function checkPathExists(filePath: string): Promise<boolean | null> {
  const api = getAPI()
  if (!api) return null
  return api.checkExists(filePath)
}

export async function joinPath(...paths: string[]): Promise<string> {
  const api = getAPI()
  if (!api) return paths.join('/')
  return api.pathJoin(...paths)
}

const EXT_MAP: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  jpg: 'jpg',
  webp: 'webp',
}

/** MIME → 文件扩展名（`getImageExtensionFromDataUrl` 的按 mime 版本，供只有字节没有 dataUrl 的调用方使用）。 */
export function getImageExtensionFromMime(mime: string | undefined, fallbackExt: string = 'png'): string {
  const normalized = mime?.toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/png') return 'png'
  return EXT_MAP[fallbackExt] || fallbackExt || 'png'
}

export function getImageExtensionFromDataUrl(dataUrl: string, fallbackExt: string = 'png'): string {
  return getImageExtensionFromMime(dataUrl.match(/^data:([^;,]+)/i)?.[1], fallbackExt)
}

async function ensureSubDir(basePath: string, subDir: string): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  const dirPath = await api.pathJoin(basePath, subDir)
  await api.ensureDir(dirPath)
  return dirPath
}

export function sanitizeFolderName(name: string): string {
  return sanitizeFileNameCore(name.trim()).slice(0, 100) || '未命名'
}

function formatDateVariable(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function resolveOutputDirectoryVariables(path: string): string {
  return path.replace(/\{date\}/gi, formatDateVariable())
}

export function getDirectoryBaseName(dirPath: string): string {
  const normalized = dirPath.trim().replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return sanitizeFolderName(parts[parts.length - 1] || 'images')
}

export async function getLocalImageSaveDirectory(subFolder?: string): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  let imagesDir = await ensureSubDir(basePath, 'images')
  if (subFolder) {
    imagesDir = await ensureSubDir(imagesDir, sanitizeFolderName(subFolder))
  }
  return imagesDir
}

/** 按多级文件夹段创建本地图片保存目录（如项目层级 `根目录/images/项目A/子项目B`）。
 *  每一段单独 sanitize 后逐级创建，避免整体 sanitize 把路径分隔符抹成 `-`。 */
export async function getLocalImageSaveDirectoryForSegments(segments: string[]): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  let imagesDir = await ensureSubDir(basePath, 'images')
  for (const segment of segments) {
    const trimmed = segment?.trim() ?? ''
    if (!trimmed) continue
    imagesDir = await ensureSubDir(imagesDir, sanitizeFolderName(trimmed))
  }
  return imagesDir
}

/**
 * 把用户在输入框里**手输**的导出位置纳入主进程白名单（TB-049）。
 *
 * 为什么需要这一步：主进程的 `assertAllowedPath` 只放行 桌面/文档/下载/图片/userData +
 * `localSettings.localSavePath` + 本次会话通过**目录选择对话框**选过的路径
 * （`sessionAllowedRoots`，内存态、重启清空）。而「按渠道设置导出位置」这一栏
 * （`ChannelOutputDirs`）允许用户**直接敲路径**，敲进去的 `D:\...` 不在白名单里，
 * 于是 `fs:ensure-dir` 抛「Path is outside allowed application directories」并被
 * catch 成 `false` → 整批产出静默跳过，界面上只看到「导出位置不可用」，真因永久丢失。
 *
 * 口径（杰哥 2026-09-20 确认）：**用户在设置里显式填过的目录即视为受信**。
 * 这不是「开放整个盘」—— 目录是用户自己敲进去的，等价于一次授权行为。
 *
 * 必须在 `ensureDir` **之前**调用：`ensureDir` 内部第一句就是 `assertAllowedPath`，
 * 授权晚一步就永远轮不到。文件夹选择对话框走的是另一条路（选完主进程自己就 add 了），
 * 这里重复调用无害。
 */
export async function authorizeOutputDirectory(outputDirectory: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  const trimmed = resolveOutputDirectoryVariables(outputDirectory.trim())
  if (!trimmed) return false
  return (await api.authorizeCompositeOutputDirectory?.(trimmed)) ?? false
}

export async function getExplicitImageSaveDirectory(outputDirectory: string): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const trimmed = resolveOutputDirectoryVariables(outputDirectory.trim())
  if (!trimmed) return null
  // 先前把授权放在后面（`taskPostprocess` 里 `ensureDir` 之后），等于永远等不到。
  // `ensureDir` 现在失败时返回**错误消息字符串**而不是 `false`（R-62），所以这里同时兼容
  // 布尔与字符串：只有 `true` 才算成功，字符串走「失败但可诊断」的路径由上层决定怎么提示。
  const ok = await api.ensureDir(trimmed)
  return ok === true ? trimmed : null
}

export async function saveRawCacheImageToLocal(
  id: string,
  dataUrl: string,
  options: { bytes?: Uint8Array; mime?: string } = {},
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const cacheDir = await ensureSubDir(basePath, 'cache-images')
  // 调用方已持有字节（文件夹导入）时用 mime 定扩展名，避免为了拿扩展名先拼一遍 dataUrl
  const ext = options.mime ? getImageExtensionFromMime(options.mime) : getImageExtensionFromDataUrl(dataUrl)
  const filePath = await api.pathJoin(cacheDir, `${id}.${ext}`)

  const success = await saveImageViaApi(api, filePath, dataUrl, options.bytes)
  return success ? filePath : null
}

const imageSaveQueues = new Map<string, Promise<void>>()

async function saveImageExclusively<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const previous = imageSaveQueues.get(directory) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  imageSaveQueues.set(directory, tail)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (imageSaveQueues.get(directory) === tail) imageSaveQueues.delete(directory)
  }
}

/**
 * 解析本地图片目标路径（含避免覆盖的序号递增）。
 * 供「写字节副本」（saveImageToLocal）与「硬链接」（linkImageToLocal）共用，
 * 保证两种写入方式使用同一套命名规则。
 */
async function resolveLocalImageTargetPath(
  imagesDir: string,
  taskId: string,
  imageIndex: number,
  ext: string,
  fileNameBase?: string,
): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const fileExt = EXT_MAP[ext] || 'png'
  const directoryBaseName = getDirectoryBaseName(imagesDir) || sanitizeFolderName(taskId)
  const exactBaseName = fileNameBase ? sanitizeGeneratedImageFilenamePart(fileNameBase, 220) || directoryBaseName : ''
  const exactSequenceMatch = exactBaseName.match(/^(.*)-(\d+)$/)
  const sequencePrefix = exactSequenceMatch?.[1] || directoryBaseName
  const requestedSequence = exactSequenceMatch ? Number.parseInt(exactSequenceMatch[2], 10) : imageIndex + 1
  let fileName = `${exactBaseName || `${directoryBaseName}-${imageIndex + 1}`}.${fileExt}`
  let filePath = await api.pathJoin(imagesDir, fileName)

  // 避免覆盖：如果文件已存在，则自动查找当前目录下的最大序号并递增
  if (await api.checkExists(filePath)) {
    let maxIndex = 0
    try {
      const files = await api.readDir(imagesDir)
      const regex = new RegExp(`^${escapeRegExp(sequencePrefix)}-(\\d+)\\.`)
      for (const file of files) {
        const match = file.match(regex)
        if (match) {
          const idx = parseInt(match[1], 10)
          if (idx > maxIndex) maxIndex = idx
        }
      }
    } catch (err) {
      console.error('Failed to read directory for sequential naming', err)
    }

    let nextIndex = Math.max(maxIndex + 1, requestedSequence + 1)
    fileName = `${sequencePrefix}-${nextIndex}.${fileExt}`
    filePath = await api.pathJoin(imagesDir, fileName)

    while (await api.checkExists(filePath)) {
      nextIndex++
      fileName = `${sequencePrefix}-${nextIndex}.${fileExt}`
      filePath = await api.pathJoin(imagesDir, fileName)
    }
  }

  return filePath
}

export async function saveImageToLocal(
  taskId: string,
  imageIndex: number,
  dataUrl: string,
  ext: string = 'png',
  subFolder?: string,
  outputDirectory?: string,
  fileNameBase?: string,
): Promise<string | null> {
  const api = getAPI()
  if (!api) return null

  const imagesDir = outputDirectory
    ? await getExplicitImageSaveDirectory(outputDirectory)
    : await getLocalImageSaveDirectory(subFolder)
  if (!imagesDir) return null

  return saveImageExclusively(imagesDir, async () => {
    const filePath = await resolveLocalImageTargetPath(imagesDir, taskId, imageIndex, ext, fileNameBase)
    if (!filePath) return null
    const success = await saveImageViaApi(api, filePath, dataUrl)
    return success ? filePath : null
  })
}

/**
 * 在工作区目录为目标原图创建**硬链接**（同一物理文件、不占额外磁盘空间）。
 * 源文件缺失或当前环境不支持时返回 null，由调用方回退为字节副本。
 */
export async function linkImageToLocal(
  sourcePath: string,
  taskId: string,
  imageIndex: number,
  ext: string = 'png',
  subFolder?: string,
  outputDirectory?: string,
  fileNameBase?: string,
): Promise<string | null> {
  const api = getAPI()
  const linkFile = api?.linkFile
  if (!api || !linkFile) return null

  const imagesDir = outputDirectory
    ? await getExplicitImageSaveDirectory(outputDirectory)
    : await getLocalImageSaveDirectory(subFolder)
  if (!imagesDir) return null

  return saveImageExclusively(imagesDir, async () => {
    const filePath = await resolveLocalImageTargetPath(imagesDir, taskId, imageIndex, ext, fileNameBase)
    if (!filePath) return null
    const ok = await linkFile(sourcePath, filePath)
    return ok ? filePath : null
  })
}

export async function saveTaskMetaToLocal(taskId: string, task: TaskRecord): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const tasksDir = await ensureSubDir(basePath, 'tasks')
  const filePath = await api.pathJoin(tasksDir, `${taskId}.json`)

  const meta = {
    id: task.id,
    prompt: task.prompt,
    params: task.params,
    actualParams: task.actualParams,
    actualParamsByImage: task.actualParamsByImage,
    revisedPromptByImage: task.revisedPromptByImage,
    apiProvider: task.apiProvider,
    apiProfileName: task.apiProfileName,
    apiMode: task.apiMode,
    apiModel: task.apiModel,
    inputImageIds: task.inputImageIds,
    inputImageFolderPath: task.inputImageFolderPath,
    outputImages: task.outputImages,
    status: task.status,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    elapsed: task.elapsed,
    isFavorite: task.isFavorite,
    sourceMode: task.sourceMode,
    agentToolAction: task.agentToolAction,
  }

  const success = await api.saveJson(filePath, meta)
  return success ? filePath : null
}

export async function savePromptToLocal(taskId: string, prompt: string): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const promptsDir = await ensureSubDir(basePath, 'prompts')
  const filePath = await api.pathJoin(promptsDir, `${taskId}.txt`)

  const success = await api.saveText(filePath, prompt)
  return success ? filePath : null
}

function formatAgentConversationMarkdown(conversation: AgentConversation): string {
  const lines: string[] = []
  lines.push(`# ${conversation.title || 'Agent 对话'}`)
  lines.push('')
  lines.push(`创建时间: ${new Date(conversation.createdAt).toLocaleString()}`)
  lines.push(`更新时间: ${new Date(conversation.updatedAt).toLocaleString()}`)
  lines.push('')

  for (const round of conversation.rounds) {
    const roundIndex = round.index + 1
    lines.push(`---`)
    lines.push(``)
    lines.push(`## 第 ${roundIndex} 轮`)
    lines.push('')

    const userMsg = conversation.messages.find((m) => m.id === round.userMessageId)
    if (userMsg) {
      lines.push(`### 用户`)
      lines.push('')
      lines.push(userMsg.content)
      lines.push('')
    }

    const assistantMsg = conversation.messages.find((m) => m.id === round.assistantMessageId)
    if (assistantMsg) {
      lines.push(`### 助手`)
      lines.push('')
      lines.push(assistantMsg.content)
      lines.push('')
    }

    if (round.error) {
      lines.push(`> 错误: ${round.error}`)
      lines.push('')
    }

    lines.push(`状态: ${round.status === 'done' ? '完成' : round.status === 'error' ? '失败' : '运行中'}`)
    if (round.finishedAt) {
      lines.push(`完成时间: ${new Date(round.finishedAt).toLocaleString()}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatMarkdownJson(value: unknown) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
}

function getTaskOutputPath(task: TaskRecord, imageId: string, imageIndex: number) {
  return task.localSavedOutputImagePaths?.[`${imageIndex}:${imageId}`] ?? null
}

export function formatAgentRoundSummaryMarkdown(
  conversation: AgentConversation,
  round: AgentRound,
  tasks: TaskRecord[],
): string {
  const orderedTasks = round.outputTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TaskRecord => Boolean(task))
  const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
  const assistantMessage = round.assistantMessageId
    ? conversation.messages.find((message) => message.id === round.assistantMessageId)
    : undefined
  const successCount = orderedTasks.filter((task) => task.outputImages.length > 0).length
  const failedCount = orderedTasks.filter((task) => task.status === 'error').length
  const statusText = round.status === 'done' ? '完成' : round.status === 'error' ? '失败' : '运行中'
  const lines: string[] = [
    `# ${conversation.title || 'Agent 对话'} · 第 ${round.index} 轮`,
    '',
    `- 对话 ID: \`${conversation.id}\``,
    `- 轮次 ID: \`${round.id}\``,
    `- 父轮次: ${round.parentRoundId ? `\`${round.parentRoundId}\`` : '无'}`,
    `- 状态: ${statusText}`,
    `- 开始时间: ${new Date(round.createdAt).toISOString()}`,
    `- 完成时间: ${round.finishedAt ? new Date(round.finishedAt).toISOString() : '未完成'}`,
    `- 图片任务: ${orderedTasks.length}；成功: ${successCount}；失败: ${failedCount}`,
    '',
    '## 用户请求',
    '',
    userMessage?.content || round.prompt || '无',
    '',
    '## 输入资源',
    '',
    `- 参考图 ID: ${round.inputImageIds.length > 0 ? round.inputImageIds.map((id) => `\`${id}\``).join('、') : '无'}`,
    `- 蒙版目标图 ID: ${round.maskTargetImageId ? `\`${round.maskTargetImageId}\`` : '无'}`,
    `- 蒙版图 ID: ${round.maskImageId ? `\`${round.maskImageId}\`` : '无'}`,
    '',
  ]

  if (assistantMessage?.content) {
    lines.push('## Agent 回复', '', assistantMessage.content, '')
  }

  if (round.error) {
    lines.push('## 轮次错误', '', round.error, '')
  }

  lines.push('## 图片任务明细', '')
  if (orderedTasks.length === 0) {
    lines.push('本轮没有图片任务。', '')
  }

  orderedTasks.forEach((task, taskIndex) => {
    lines.push(
      `### ${taskIndex + 1}. 任务 \`${task.id}\``,
      '',
      `- 状态: ${task.status}`,
      `- 批次调用 ID: ${task.agentBatchCallId ? `\`${task.agentBatchCallId}\`` : '无'}`,
      `- 工具调用 ID: ${task.agentToolCallId ? `\`${task.agentToolCallId}\`` : '无'}`,
      `- Provider: ${task.apiProvider ?? '未知'}`,
      `- API 配置: ${task.apiProfileName ?? '未知'}`,
      `- API 模式: ${task.apiMode ?? '未知'}`,
      `- 模型: ${task.apiModel ?? '未知'}`,
      `- 创建时间: ${new Date(task.createdAt).toISOString()}`,
      `- 完成时间: ${task.finishedAt ? new Date(task.finishedAt).toISOString() : '未完成'}`,
      `- 耗时: ${task.elapsed != null ? `${task.elapsed} ms` : '未知'}`,
      '',
      '#### 提示词',
      '',
      task.prompt || '无',
      '',
      '#### 请求参数',
      '',
      formatMarkdownJson(task.params),
      '',
      '#### 实际参数',
      '',
      formatMarkdownJson(task.actualParamsByImage ?? task.actualParams ?? {}),
      '',
      '#### 输出',
      '',
    )

    if (task.outputImages.length === 0) {
      lines.push('- 无输出图片')
    } else {
      task.outputImages.forEach((imageId, imageIndex) => {
        const savedPath = getTaskOutputPath(task, imageId, imageIndex)
        const rawUrl = task.rawImageUrls?.[imageIndex]
        const revisedPrompt = task.revisedPromptByImage?.[imageId]
        lines.push(`- 图片 ${imageIndex + 1}: \`${imageId}\``)
        lines.push(`  - 本地路径: ${savedPath ?? '未保存'}`)
        if (rawUrl) lines.push(`  - 原始 URL: ${rawUrl}`)
        if (revisedPrompt) lines.push(`  - 改写提示词: ${revisedPrompt}`)
      })
    }

    if (task.batchItemStatuses?.length) lines.push('', '#### 批次状态', '', formatMarkdownJson(task.batchItemStatuses))
    if (task.batchItemErrors?.length) lines.push('', '#### 批次错误', '', formatMarkdownJson(task.batchItemErrors))
    if (task.error) lines.push('', '#### 错误', '', task.error)
    lines.push('')
  })

  return lines.join('\n')
}

export async function saveAgentConversationToLocal(
  conversationId: string,
  conversation: AgentConversation,
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const agentDir = await ensureSubDir(basePath, 'agent')
  const filePath = await api.pathJoin(agentDir, `${conversationId}.md`)

  const markdown = formatAgentConversationMarkdown(conversation)
  const success = await api.saveText(filePath, markdown)
  return success ? filePath : null
}

export async function saveAgentRoundSummaryToLocal(
  conversation: AgentConversation,
  round: AgentRound,
  tasks: TaskRecord[],
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const agentDir = await ensureSubDir(basePath, 'agent')
  const conversationDir = await ensureSubDir(agentDir, conversation.id)
  const roundNumber = String(round.index).padStart(3, '0')
  const filePath = await api.pathJoin(conversationDir, `round-${roundNumber}-${round.id}.md`)
  const markdown = formatAgentRoundSummaryMarkdown(conversation, round, tasks)
  const success = await api.saveText(filePath, markdown)
  return success ? filePath : null
}

export async function getBackupList(customPath?: string): Promise<string[]> {
  const api = getAPI()
  if (!api) return []
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return api.listBackups(dataPath + '/tangbao.json')
}

export async function getBackupPath(): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return dataPath + '/backups'
}

export async function selectBackupDirectory(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const result = await api.selectDirectory()
  return result || null
}

export async function checkBackupHasData(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.checkBackupHasData(backupPath)
}

export async function restoreFromBackupFile(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return api.restoreFromBackup(backupPath, dataPath + '/tangbao.json')
}

export async function deleteBackupFile(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.deleteBackup(backupPath)
}

export async function saveZipToPath(filePath: string, buffer: ArrayBuffer): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.saveZipBuffer(filePath, buffer)
}

export async function exportZipToPath(
  request: ElectronZipExportRequest,
): Promise<{ success: boolean; error?: string }> {
  const api = getAPI()
  return api?.exportZipToPath ? api.exportZipToPath(request) : { success: false, error: '当前环境不支持流式导出' }
}

export async function selectZipSavePath(defaultName: string): Promise<string | null> {
  return getAPI()?.selectZipSavePath?.(defaultName) ?? null
}

/** 通用原生保存对话框（Electron）；非 Electron 环境返回 null。 */
export async function selectSavePath(
  defaultName: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  return getAPI()?.selectSavePath?.(defaultName, filters) ?? null
}

/** 读 JSON 文本文件（Electron 主进程）；非 Electron 或读取失败返回 null。 */
export async function readJsonTextFile(filePath: string): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  try {
    return await api.readJsonText(filePath)
  } catch {
    return null
  }
}

/** 写 JSON 文本文件（Electron 主进程，跳过自动备份）；非 Electron 返回 false。 */
export async function writeJsonTextFile(filePath: string, content: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  try {
    return await api.writeJsonText(filePath, content, true)
  } catch {
    return false
  }
}

export async function getDiskStorageUsage(): Promise<{
  cacheDir: string | null
  imagesBytes: number
  imagesCount: number
  backupBytes: number
  thumbsBytes: number
  thumbsCount: number
} | null> {
  return getAPI()?.getDiskStorageUsage?.() ?? null
}

/** 原图删除的结果：删除失败的文件必须能被看见（此前返回值被丢弃，删除失败全程无痕）。 */
export interface DeleteRawCacheImagesResult {
  deleted: number
  failed: string[]
}

export async function deleteRawCacheImages(filePaths: string[]): Promise<DeleteRawCacheImagesResult> {
  const api = getAPI()
  if (!api?.deleteCacheImages || filePaths.length === 0) return { deleted: 0, failed: [] }
  try {
    const result = await api.deleteCacheImages(filePaths)
    const failed = result?.failed ?? []
    if (failed.length > 0) {
      // 失败基本只有两类原因：路径不在库根的 `cache-images/` 下（例如库根换过、记录里还是旧路径），
      // 或 unlink 失败（文件被占用 / 无权限）。这行日志是排查「素材删了、磁盘没瘦」的唯一线索
      // （2026-09-21：132 张素材被删而文件一张不少，就是因为失败信息没人看）。
      console.warn('[cache-image-delete] 原图文件删除失败（这些文件仍留在磁盘上）', {
        requested: filePaths.length,
        failed: failed.length,
        sample: failed.slice(0, 3),
      })
    }
    return { deleted: result?.deleted?.length ?? 0, failed }
  } catch (error) {
    console.warn('[cache-image-delete] 原图删除请求失败', {
      requested: filePaths.length,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    return { deleted: 0, failed: filePaths }
  }
}

/** 删除本地导出的图片文件（可位于库根外自定义目录）；非 Electron 或无 API 时静默跳过。 */
export async function deleteLocalImageFiles(filePaths: string[]): Promise<number> {
  const api = getAPI()
  const uniquePaths = Array.from(
    new Set(filePaths.filter((filePath) => typeof filePath === 'string' && filePath.trim())),
  )
  if (!api?.deleteLocalImageFiles || uniquePaths.length === 0) return 0
  try {
    const result = await api.deleteLocalImageFiles(uniquePaths)
    return result?.deleted?.length ?? 0
  } catch {
    return 0
  }
}

export async function reconcileRawCacheImages(referencedFileNames: string[]): Promise<void> {
  const api = getAPI()
  if (api?.reconcileCacheImages) await api.reconcileCacheImages(referencedFileNames)
}

/** 读磁盘缩略图（库根 thumbs/）；非 Electron 或未命中返回 null。variant 决定通道（默认 full）。 */
export async function readThumbnailFromDisk(
  id: string,
  version: number,
  variant: ThumbnailVariant = 'full',
): Promise<{ dataUrl: string; width?: number; height?: number } | null> {
  const api = getAPI()
  if (!api?.readThumbnail) return null
  try {
    return await api.readThumbnail(id, version, variant)
  } catch {
    return null
  }
}

/** 写磁盘缩略图（webp 字节）；非 Electron 或失败返回 false。variant 决定通道（默认 full）。 */
export async function writeThumbnailToDisk(
  id: string,
  version: number,
  dataUrl: string,
  variant: ThumbnailVariant = 'full',
): Promise<boolean> {
  const api = getAPI()
  if (!api?.writeThumbnail) return false
  try {
    return await api.writeThumbnail(id, version, dataUrl, variant)
  } catch {
    return false
  }
}

/** 删除图片的全部磁盘缩略图（full + grid 所有版本）：源文件丢失的图清理用。 */
export async function deleteThumbnailsFromDisk(imageIds: string[]): Promise<number> {
  const api = getAPI()
  if (!api?.deleteThumbnails || imageIds.length === 0) return 0
  try {
    const result = await api.deleteThumbnails(imageIds)
    return result?.deleted ?? 0
  } catch {
    return 0
  }
}

/** 文件存在性检查（Electron，主进程 fs.existsSync）；非 Electron 或无 API 返回 true（不做清理判定）。 */
export async function fileExistsOnDisk(filePath: string): Promise<boolean> {
  const api = getAPI()
  if (!api?.fileExists) return true
  try {
    return await api.fileExists(filePath)
  } catch {
    return true
  }
}

/** 库根备份目录（ZIP 备份默认位置）；非 Electron 返回 null。 */
export async function getLibraryBackupsPath(): Promise<string | null> {
  const api = getAPI()
  if (!api?.getLibraryBackupsPath) return null
  try {
    return await api.getLibraryBackupsPath()
  } catch {
    return null
  }
}

/**
 * 按「前缀 + 保留份数」清理某个备份目录，返回实际删除数量。
 *
 * 保留策略是**尽力而为**：主进程不支持、路径未授权或删除失败都只返回 0，
 * 绝不能因为它而让备份本身失败。
 */
export async function pruneLibraryBackupsInDir(dir: string, prefix: string, keep: number): Promise<number> {
  const api = getAPI()
  if (!api?.pruneLibraryBackups) return 0
  try {
    return await api.pruneLibraryBackups(dir, prefix, keep)
  } catch {
    return 0
  }
}

/** 库完整性校验（主进程只读）；非 Electron 返回 null。 */
export async function runLibraryIntegrityCheckIpc(referencedPaths: string[]): Promise<{
  catalog: 'ok' | 'corrupt' | 'unavailable'
  catalogDetail?: string
  assetCount: number
  sampled: number
  mismatched: Array<{ fileName: string; expected: string; actual: string }>
  orphanFiles: string[]
  missingFiles: string[]
  checkedAt: number
} | null> {
  const api = getAPI()
  if (!api?.runLibraryIntegrityCheck) return null
  try {
    return await api.runLibraryIntegrityCheck(referencedPaths)
  } catch {
    return null
  }
}

/** 按项目树复制原图副本到目标目录（主进程逐文件复制）；非 Electron 返回 null。 */
export async function exportProjectCopies(
  targetRoot: string,
  entries: Array<{ sourcePath: string; targetPath: string; assetId?: string }>,
): Promise<{ copied: number; failed: Array<{ targetPath: string; error: string }>; total: number } | null> {
  const api = getAPI()
  if (!api?.exportProjectCopies) return null
  try {
    return await api.exportProjectCopies(targetRoot, entries)
  } catch {
    return null
  }
}

/** 批量导出图片到文件夹（主进程逐文件写盘）；非 Electron 返回 null。 */
export async function exportImagesToFolder(
  targetDir: string,
  files: Array<{ fileName: string; sourcePath?: string; dataUrl?: string }>,
): Promise<{ saved: number; failed: Array<{ fileName: string; error: string }>; total: number } | null> {
  const api = getAPI()
  if (!api?.exportImagesToFolder) return null
  try {
    return await api.exportImagesToFolder(targetDir, files)
  } catch {
    return null
  }
}

export async function getDesktopPath(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  return api.getDesktopPath()
}

/** 扫描旧版本 userData 目录（糖包 / tangbao / 糖包 V2 等）；非 Electron 返回 []。 */
export async function scanLegacyDataSources(): Promise<LegacySourceInfo[]> {
  const api = getAPI()
  if (!api?.scanLegacySources) return []
  try {
    return await api.scanLegacySources()
  } catch {
    return []
  }
}

/** 从旧目录导入数据到当前 userData（只复制不覆盖）；IndexedDB 仅导入匹配当前运行模式的目录。 */
export async function importLegacyDataSource(
  sourceDir: string,
  selection: LegacyImportSelection,
): Promise<{ success: boolean; error?: string; result?: LegacyImportResult }> {
  const api = getAPI()
  if (!api?.importLegacySource) return { success: false, error: '当前环境不支持导入旧版数据' }
  try {
    return await api.importLegacySource({ sourceDir, selection })
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 重启应用（导入 IndexedDB 目录后需重启才能被 Chromium 识别）。 */
export async function relaunchAppAfterImport(): Promise<boolean> {
  const api = getAPI()
  if (!api?.relaunchApp) return false
  try {
    const result = await api.relaunchApp()
    return result?.success === true
  } catch {
    return false
  }
}
