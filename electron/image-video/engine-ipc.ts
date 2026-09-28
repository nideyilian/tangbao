/**
 * 「图转视频」引擎的 IPC 入口。
 *
 * ## 为什么不做成通用 `call(method, params)`
 *
 * 引擎自己暴露了 60 多个方法，其中一大半糖包根本不用（`jianying_*` 剪映、
 * `effect_library_*` 效果库、`library_*` 里的标签 / 去重 / 体检 / 拆 BGM 等长尾）。
 * 把整张方法表透给渲染进程的后果是：**任何人都能借引擎去读写不在糖包白名单里的目录**
 * （引擎本身不认识糖包的 `assertAllowedPath`）。
 *
 * 所以这里是一张**显式白名单**：只有糖包真正要用的方法能被调用，别的一律拒。
 * 加方法时必须同时想清楚「它会不会绕过糖包的路径白名单」。
 *
 * ## 素材库的两个目录由**主进程注入**，渲染端不认识它们
 *
 * `library_*` 系列都要吃 `bgm_dir` / `watermark_dir`。这两个路径**不经过调用方** ——
 * 主进程在转发时自己填上（`getLibraryPaths()` 派生的库根子目录）。
 * 好处有两层：渲染端不必知道库在哪（少一处要同步的真相），
 * 而且**它没有机会把库指到任意目录**去（这个通道能复制 / 删除文件）。
 *
 * ## 删除**不在这里**
 *
 * 引擎的 `library_remove` 走的是系统回收站，与糖包「删除即永久删除」的口径冲突
 * （ADR-0021 / 2026-09-27 杰哥选定），所以它**刻意不在白名单里**；
 * 删除由 `image-video:library-delete` 直接做（见 `library-fs.ts`）。
 */

import { mkdirSync } from 'fs'
import { getLibraryPaths } from '../library-paths'
import { handleChecked } from '../ipc-guard'
import { ensureImageEngine, getImageVideoEngineStatus, probeImageEngineSystem } from './engine-manager'
import { deleteVideoLibraryEntries } from './library-fs'

/**
 * 允许渲染进程调用的引擎方法。
 *
 * - 配置类：`default_config` / `validate_config_detailed` / `normalize_config` —— 纯计算，不碰盘；
 * - 扫描：`scan_images` —— 只读输入目录，用来在界面上显示「这个方向这次有多少张图」；
 * - 任务：`start_job` / `pause_job` / `resume_job` / `cancel_job` / `list_jobs` —— 视频生成本体；
 * - 环境：`system_snapshot` —— 拿 ffmpeg 实际路径与版本（诊断用）；
 * - 素材库：列表 / 导入 / 改名 / 建文件夹 + 三种预览。**注意 `library_remove` 不在此列**（见文件头注）。
 */
const ALLOWED_METHODS = new Set([
  'default_config',
  'normalize_config',
  'validate_config',
  'validate_config_detailed',
  'scan_images',
  'start_job',
  'pause_job',
  'resume_job',
  'cancel_job',
  'list_jobs',
  'system_snapshot',
  'library_snapshot',
  'library_import',
  'library_rename',
  'library_create_folder',
  'audio_cover',
  'library_preview_audio',
  'preview_video',
])

/** 需要主进程补上库目录的方法（渲染端传的相对路径也据此解析）。 */
const LIBRARY_AWARE_METHODS = new Set(['library_snapshot', 'library_import', 'library_rename', 'library_create_folder'])

export interface VideoLibraryDirs {
  root: string
  bgm: string
  watermark: string
}

/**
 * 解析并**确保存在**视频素材库的两个目录。
 *
 * 由糖包建目录而不是等引擎建：库根是糖包的数据，目录该在用户第一次打开素材库时就出现在
 * 库根下（而不是他点了导入、引擎在别处悄悄建了一个）。
 */
export function ensureVideoLibraryDirs(): VideoLibraryDirs {
  const paths = getLibraryPaths()
  const dirs: VideoLibraryDirs = { root: paths.videoLibrary, bgm: paths.videoBgm, watermark: paths.videoWatermark }
  for (const dir of [dirs.root, dirs.bgm, dirs.watermark]) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // 建不出来（盘不可写）不算致命：界面上会在读到空列表时显示出来，
      // 而且引擎那边还有第二次机会自己建。这里只是「尽量让目录早点出现」。
    }
  }
  return dirs
}

export function registerImageVideoIpc(): void {
  handleChecked('image-video:status', async () => {
    const status = getImageVideoEngineStatus()
    // 引擎在位但还没探过环境时，顺手探一次 —— 界面要显示「用的是哪份 ffmpeg」。
    // 探测失败不影响状态返回（只把 ffmpeg 三项留成 null）。
    if (status.available && status.ffmpegAvailable === null) {
      await probeImageEngineSystem()
      return getImageVideoEngineStatus()
    }
    return status
  })

  handleChecked('image-video:probe-system', async () => {
    const snapshot = await probeImageEngineSystem(true)
    return { success: snapshot !== null, snapshot, status: getImageVideoEngineStatus() }
  })

  /** 库路径（界面显示「素材存在哪」用；调用路径由主进程内部注入，不靠这个）。 */
  handleChecked('image-video:library-dirs', () => ensureVideoLibraryDirs())

  /**
   * 永久删除库里的素材（文件或空文件夹）。
   *
   * 走糖包自己的实现而不是引擎的 `library_remove`：后者丢系统回收站，
   * 与「删除即永久删除」冲突。路径必须落在库目录内（见 `library-fs.ts`）。
   */
  handleChecked('image-video:library-delete', (_event, payload: unknown) => {
    const request = (payload ?? {}) as { paths?: unknown }
    const paths = Array.isArray(request.paths) ? request.paths.filter((item) => typeof item === 'string') : []
    if (paths.length === 0) return { success: false, error: '没有要删除的素材' }
    const dirs = ensureVideoLibraryDirs()
    const result = deleteVideoLibraryEntries(paths, dirs.root)
    return { success: result.failed.length === 0, ...result }
  })

  handleChecked('image-video:engine-call', async (_event, payload: unknown) => {
    const request = (payload ?? {}) as { method?: unknown; params?: unknown; timeoutMs?: unknown }
    const method = typeof request.method === 'string' ? request.method : ''
    if (!ALLOWED_METHODS.has(method)) {
      return { success: false, error: `不允许调用引擎方法：${method || '(空)'}` }
    }
    let params =
      request.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? (request.params as Record<string, unknown>)
        : {}
    if (LIBRARY_AWARE_METHODS.has(method)) {
      const dirs = ensureVideoLibraryDirs()
      params = { ...params, bgm_dir: dirs.bgm, watermark_dir: dirs.watermark }
    }
    const timeoutMs = typeof request.timeoutMs === 'number' && request.timeoutMs > 0 ? request.timeoutMs : undefined
    try {
      const engine = await ensureImageEngine()
      const result = await engine.call<unknown>(method, params, timeoutMs)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
