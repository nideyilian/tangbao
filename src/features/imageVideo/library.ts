/**
 * 视频素材库（BGM + 视频水印）在渲染进程侧的封装。
 *
 * ## 它包的是引擎的 `library_*`，但有两处不是
 *
 * - **删除**走糖包自己的通道（`image-video:library-delete`）：引擎的 `library_remove`
 *   丢系统回收站，与糖包「删除即永久删除」冲突（ADR-0021）；
 * - **库目录**由主进程注入（`library_*` 调用时自动补 `bgm_dir` / `watermark_dir`），
 *   这里只在**渲染时**需要绝对路径去拼引擎配置，才显式取一次并缓存。
 *
 * ## 缓存的边界
 *
 * 库目录一次会话内不会变（它派生自库根，改库根要重启），所以缓存住。
 * 但**快照不缓存** —— 用户导完素材、删完素材都要立刻看到结果，
 * 缓存快照会让「导入了却看不见」变成一个需要刷新才能解释的怪现象。
 */

/** 库的种类（引擎的 `kind` 参数）。 */
export type VideoLibraryKind = 'bgm' | 'watermark'

export interface VideoLibraryDirs {
  root: string
  bgm: string
  watermark: string
}

/** 库里的一个素材。字段与引擎 `_scan_tree` 的返回逐字对应。 */
export interface VideoLibraryItem {
  name: string
  path: string
  /** 库内相对文件夹；`''` = 库根下 */
  folder: string
  type: 'audio' | 'video' | 'image'
  size_bytes: number
  /** 秒；音频与视频有，图片为 null */
  duration: number | null
  added_at: string | null
  /** 去重键（引擎给的 sha256） */
  duplicate_key: string
  tags: string[]
  starred: boolean
  note: string
}

export interface VideoLibraryFolder {
  /** 库内相对路径（`/` 分隔） */
  relative: string
  name: string
  path: string
  /** 递归素材数 */
  count: number
}

/** 引擎 `library_snapshot` 的返回。 */
export interface VideoLibrarySnapshot {
  library_root: string
  bgm_dir: string
  watermark_dir: string
  bgm: VideoLibraryItem[]
  bgm_folders: VideoLibraryFolder[]
  watermark: VideoLibraryItem[]
  watermark_folders: VideoLibraryFolder[]
}

export type VideoLibraryImportStatus = 'imported' | 'duplicate' | 'failed'

export interface VideoLibraryImportResult {
  name: string
  path: string
  status: VideoLibraryImportStatus
  reason?: string
  folder?: string
  size_bytes?: number
  duration?: number | null
}

export interface VideoLibraryDeleteResult {
  success: boolean
  error?: string
  deleted?: string[]
  failed?: Array<{ path: string; error: string }>
  indexEntriesRemoved?: number
}

export interface VideoLibraryApi {
  dirs?: () => Promise<VideoLibraryDirs>
  call?: (payload: { method: string; params?: Record<string, unknown>; timeoutMs?: number }) => Promise<{
    success: boolean
    result?: unknown
    error?: string
  }>
  remove?: (paths: string[]) => Promise<VideoLibraryDeleteResult>
}

function getApi(): VideoLibraryApi | null {
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api) return null
  return {
    dirs: api.imageVideoLibraryDirs,
    call: api.imageVideoCall,
    remove: api.imageVideoLibraryDelete,
  }
}

let cachedDirs: VideoLibraryDirs | null = null

/** 取库目录（一次会话内缓存）。渲染时拼引擎配置要用它的绝对路径。 */
export async function getVideoLibraryDirs(): Promise<VideoLibraryDirs> {
  if (cachedDirs) return cachedDirs
  const api = getApi()
  if (!api?.dirs) throw new Error('当前环境不支持视频素材库（需要在桌面应用里使用）')
  cachedDirs = await api.dirs()
  return cachedDirs
}

/** 仅测试用：清掉目录缓存。 */
export function resetVideoLibraryDirsCache(): void {
  cachedDirs = null
}

async function callEngine<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
  const api = getApi()
  if (!api?.call) throw new Error('当前环境不支持视频素材库（需要在桌面应用里使用）')
  const result = await api.call({ method, params, timeoutMs })
  if (!result.success) throw new Error(result.error || `引擎调用失败：${method}`)
  return result.result as T
}

/**
 * 读一次库快照。
 *
 * 首次调用时引擎会**自动建好两个库目录**（`snapshot` 内部 mkdir），主进程那边也会兜一层 ——
 * 所以「第一次打开素材库」看到的是两个空目录而不是一句报错。
 */
export async function loadVideoLibrary(): Promise<VideoLibrarySnapshot> {
  return callEngine<VideoLibrarySnapshot>('library_snapshot', {}, 120_000)
}

/**
 * 把本地文件导入库（引擎**复制**进来，不动源文件）。
 *
 * 引擎在这条路上做了两层去重：先比 sha256，BGM 还会比对音频指纹（同一首歌换个码率也认得出）。
 * 判为重复的会带着「库中已有相同素材：xxx」回来 —— 界面**必须逐条报出来**，
 * 静默跳过会让用户以为导入坏了（R-57：静默的「点了没反应」最糟）。
 */
export async function importVideoLibraryFiles(
  kind: VideoLibraryKind,
  filePaths: readonly string[],
  folder = '',
): Promise<VideoLibraryImportResult[]> {
  if (filePaths.length === 0) return []
  const result = await callEngine<{ results?: VideoLibraryImportResult[] }>(
    'library_import',
    { kind, paths: [...filePaths], folder },
    // 导入要算 sha256 与音频指纹，慢一些
    600_000,
  )
  return result?.results ?? []
}

export async function renameVideoLibraryItem(kind: VideoLibraryKind, itemPath: string, newName: string): Promise<void> {
  await callEngine('library_rename', { kind, path: itemPath, new_name: newName })
}

export async function createVideoLibraryFolder(kind: VideoLibraryKind, folder: string): Promise<void> {
  await callEngine('library_create_folder', { kind, folder })
}

/** 永久删除（糖包自己的通道，不是引擎的回收站那套）。 */
export async function deleteVideoLibraryItems(paths: readonly string[]): Promise<VideoLibraryDeleteResult> {
  const api = getApi()
  if (!api?.remove) throw new Error('当前环境不支持删除（需要在桌面应用里使用）')
  return api.remove([...paths])
}

/**
 * 取音频内嵌封面（有的 mp3 自带专辑图）；没有就返回 null。
 *
 * 返回的是**磁盘路径**，渲染端要显示还得读字节 —— 封面字段只是锦上添花，
 * 拿不到就退化成默认图标，不该因为它报错。
 */
export async function loadAudioCover(itemPath: string): Promise<string | null> {
  try {
    const result = await callEngine<{ cover_path?: string | null }>('audio_cover', { path: itemPath }, 60_000)
    return result?.cover_path ?? null
  } catch {
    return null
  }
}

/**
 * 准备一段可播放的音频（引擎必要时转码），返回**磁盘路径**。
 *
 * 播放由调用方读字节走 Blob（拿得到的路径不在 `tangbao://` 的作用域里，
 * 直接给 `<audio src>` 会被 CSP 的 `media-src` 拦掉）。
 */
export async function prepareAudioPreview(itemPath: string): Promise<string | null> {
  const result = await callEngine<{ preview_path?: string | null }>(
    'library_preview_audio',
    { path: itemPath },
    120_000,
  )
  return result?.preview_path ?? null
}

/** 准备一段可播放的视频（引擎必要时转码成 H.264 MP4，**丢掉音轨**），返回磁盘路径。 */
export async function prepareVideoPreview(itemPath: string): Promise<string | null> {
  const result = await callEngine<{ preview_path?: string | null }>('preview_video', { path: itemPath }, 600_000)
  return result?.preview_path ?? null
}
