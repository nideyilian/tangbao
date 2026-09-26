/**
 * 图转视频引擎在**渲染进程侧**的类型。
 *
 * 与主进程 `electron/image-video/engine-manager.ts` 的状态形状逐字对应，但这份是独立写的 ——
 * 渲染进程的 tsconfig 不包含 `electron/`，跨项目引用类型会让两边编译互相拖累。
 * **改一边记得改另一边**：界面靠这些字段回答「引擎在不在、用的是哪份 ffmpeg」，
 * 少一个字段就是少一条排查线索。
 */

/** 引擎环境状态（`image-video:status` 的返回）。 */
export interface ImageVideoEngineStatus {
  /** 引擎可执行文件是否在位 */
  available: boolean
  /** 进程是否在跑 */
  running: boolean
  pid: number | null
  exePath: string | null
  /** 从哪条规则找到的：环境变量覆盖 / 打包态 / 开发态 */
  origin: 'override' | 'packaged' | 'development' | null
  /** 取件脚本写下的元信息（sha256 / 体积 / 来源 / 时间） */
  meta: { sha256?: string; bytes?: number; source?: string; fetchedAt?: string } | null
  ffmpegAvailable: boolean | null
  ffmpegPath: string | null
  ffmpegVersion: string | null
  /** 引擎不可用时的原因 */
  reason: string | null
}

/** 引擎的环境快照（`system_snapshot` 的子集）。 */
export interface ImageVideoEngineSnapshot {
  cpu_percent?: number
  memory_percent?: number
  memory_available_gb?: number
  process_memory_mb?: number
  disk_free_gb?: number
  ffmpeg_available?: boolean
  ffmpeg_path?: string | null
  ffmpeg_version?: string | null
}

/** 调用结果：失败也走返回而不是抛，界面统一按 `success` 分支处理。 */
export type ImageVideoCallResult<T = unknown> = { success: true; result: T } | { success: false; error: string }

/** 引擎主动推来的事件帧。 */
export interface ImageVideoEngineEvent {
  type: 'event'
  event: string
  payload: Record<string, unknown>
}

/** 引擎任务状态（`job.started` / `job.status` / `job.progress` / `job.done` / `job.finished` 的 payload）。 */
export interface ImageVideoJobState {
  job_id: string
  status: 'queued' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  paused: boolean
  cancel_requested: boolean
  /** 当前视频的进度 0-100 */
  progress: number
  /** 整体进度 0-100（多个视频时按视频数摊） */
  overall: number
  speed: string | null
  message: string
  started_at: number | null
  finished_at: number | null
  return_code: number | null
}

/** 开始任务时引擎返回的东西。 */
export interface ImageVideoStartResult {
  job_id: string
  status: string
}

/** 扫描输入的返回。 */
export interface ImageVideoScanResult {
  count: number
  images: Array<{ path: string; name: string }>
}
