/**
 * 「图转视频」引擎的 IPC 入口。
 *
 * ## 为什么不做成通用 `call(method, params)`
 *
 * 引擎自己暴露了 60 多个方法，其中一大半糖包根本不用（`library_*` 素材库、`jianying_*` 剪映、
 * `effect_library_*` 效果库）。把整张方法表透给渲染进程的后果是：**任何人都能借引擎去读写
 * 不在糖包白名单里的目录**（引擎本身不认识糖包的 `assertAllowedPath`）。
 *
 * 所以这里是一张**显式白名单**：只有糖包真正要用的方法能被调用，别的一律拒。
 * 加方法时必须同时想清楚「它会不会绕过糖包的路径白名单」。
 *
 * ## 事件是推送的
 *
 * 引擎的事件（`engine.ready` / 任务进度 / 日志）由 `engine-manager.ts` 主动推给所有窗口，
 * 频道 `image-video:event`；preload 侧只做订阅透传，不缓存、不重放。
 */

import { handleChecked } from '../ipc-guard'
import { ensureImageEngine, getImageVideoEngineStatus, probeImageEngineSystem } from './engine-manager'

/**
 * 允许渲染进程调用的引擎方法。
 *
 * - 配置类：`default_config` / `validate_config_detailed` / `normalize_config` —— 纯计算，不碰盘；
 * - 扫描：`scan_images` —— 只读输入目录，用来在界面上显示「这个方向这次有多少张图」；
 * - 任务：`start_job` / `pause_job` / `resume_job` / `cancel_job` / `list_jobs` —— 视频生成本体；
 * - 环境：`system_snapshot` —— 拿 ffmpeg 实际路径与版本（诊断用）。
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
])

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

  handleChecked('image-video:engine-call', async (_event, payload: unknown) => {
    const request = (payload ?? {}) as { method?: unknown; params?: unknown; timeoutMs?: unknown }
    const method = typeof request.method === 'string' ? request.method : ''
    if (!ALLOWED_METHODS.has(method)) {
      return { success: false, error: `不允许调用引擎方法：${method || '(空)'}` }
    }
    const params =
      request.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? (request.params as Record<string, unknown>)
        : {}
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
