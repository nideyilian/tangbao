/**
 * 「图转视频」引擎的进程与协议桥。
 *
 * ## 协议
 *
 * 引擎是个独立 exe，用 **stdin/stdout 的 NDJSON** 对话（一行一条 JSON）：
 *
 * ```
 * → {"id":"r1","method":"start_job","params":{"config":{...}}}
 * ← {"type":"response","id":"r1","ok":true,"result":{"job_id":"..."}}
 * ← {"type":"event","event":"engine.ready","payload":{"protocol":1}}
 * ← {"type":"event","event":"job.progress","payload":{...}}
 * ```
 *
 * 请求靠 `id` 配对，事件没有 `id`。**响应与事件混在同一条流上**，所以解析必须按行分帧，
 * 且允许「响应先于事件」「事件夹在两次响应之间」这两种顺序（引擎是这么实现的，不是猜的）。
 *
 * ## 三个必须做对的地方（都是踩过或想清楚才写的）
 *
 * 1. **引擎会自己 spawn 自己**。渲染任务由 `exe --legacy-worker` 子进程完成（`server.py`
 *    的 `_run_legacy_worker`）—— 也就是说糖包启动的引擎进程**还有孙子进程**。
 *    `child.kill()` 在 Windows 上杀不掉孙子，退出后会留下还在啃 CPU 的 worker，
 *    所以这里一律走 `taskkill /T /F`（整棵树）。
 *
 * 2. **引擎 exe 是 console 程序**。spawn 时不设 `windowsHide: true`，用户会看到一个黑框弹出来。
 *
 * 3. **onefile 冷启动慢**。PyInstaller 单文件每次启动要把约 106MB 解压到 `%TEMP%\_MEIxxxx`，
 *    首次（或临时目录被清后）可能十几秒。所以启动超时给到 120s，且引擎**常驻**——
 *    不要跑一次视频就重启一回。
 *
 * ## 本模块不依赖 electron
 *
 * 只吃「引擎路径 + 参数」，方便在没有 Electron 的环境里单测协议解析与超时行为。
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'

/** 单次请求的默认超时；`start_job` 之类的长任务不走这条路（它立刻返回 job_id）。 */
const DEFAULT_TIMEOUT_MS = 20_000
/** 启动（含 onefile 解压）超时。 */
const STARTUP_TIMEOUT_MS = 120_000
/** 主动 shutdown 后等它自己退出的时间；超时就整棵树杀掉。 */
const SHUTDOWN_GRACE_MS = 3_000

export interface EngineResponseFrame {
  type: 'response'
  id: string | null
  ok: boolean
  result?: unknown
  error?: string
}

export interface EngineEventFrame {
  type: 'event'
  event: string
  payload: Record<string, unknown>
}

export type EngineFrame = EngineResponseFrame | EngineEventFrame

export type EngineEventListener = (frame: EngineEventFrame) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
  method: string
}

/**
 * 按行分帧：把 buffer 拆成完整行 + 余下不完整的尾巴。
 *
 * 抽成纯函数是为了单测 —— 「响应与事件混流 + 一次 chunk 可能包含半条 JSON」这种情形
 * 用真实进程很难稳定复现，而它恰恰是最容易写错的部分。
 */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r?\n/)
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}

/**
 * 解析一行。
 *
 * 返回 `null` = 不是协议帧（Python 侧的 stderr 转发、第三方库的 print 都可能混进来），
 * 调用方应当把它当日志而不是当错误 —— 把它当错误会让正常启动也报警。
 */
export function parseEngineFrame(line: string): EngineFrame | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const frame = parsed as Record<string, unknown>
  if (frame.type === 'event') {
    if (typeof frame.event !== 'string') return null
    const payload = frame.payload
    return {
      type: 'event',
      event: frame.event,
      payload: payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {},
    }
  }
  if (typeof frame.id === 'string' || frame.id === null) {
    return {
      type: 'response',
      id: typeof frame.id === 'string' ? frame.id : null,
      ok: frame.ok === true,
      result: frame.result,
      error: typeof frame.error === 'string' ? frame.error : undefined,
    }
  }
  return null
}

/** 结束整棵进程树。Windows 上必须如此 —— 引擎的渲染 worker 是它的子进程。 */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 进程已经没了：正常情况，不打扰调用方
  }
}

export interface ImageEngineBridgeOptions {
  /** 引擎 exe 的绝对路径 */
  exePath: string
  /** 传给引擎的 `--project-root`；缺省用 exe 所在目录 */
  projectRoot?: string
  /** 额外的环境变量（例如显式指定 ffmpeg） */
  env?: Record<string, string>
  /** 日志行回调（stderr 与无法解析为帧的 stdout 行） */
  onLog?: (stream: 'stdout' | 'stderr', message: string) => void
}

export class ImageEngineBridge {
  private readonly options: ImageEngineBridgeOptions
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, PendingRequest>()
  private listeners = new Set<EngineEventListener>()
  private stdoutBuffer = ''
  private sequence = 0
  private starting: Promise<void> | null = null
  private startupSettled: (() => void) | null = null
  private disposing = false

  constructor(options: ImageEngineBridgeOptions) {
    this.options = options
  }

  /** 引擎当前是否在跑。 */
  get running(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  /** 引擎进程号；未启动为 null。 */
  get pid(): number | null {
    return this.child?.pid ?? null
  }

  subscribe(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 起引擎（已起则直接返回）。并发调用共用同一次启动。 */
  async ensureStarted(): Promise<void> {
    if (this.running) return
    if (this.starting) return this.starting
    this.starting = this.startChild()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  /**
   * 发一条请求并等配对响应。
   *
   * 未启动时会先起引擎 —— 但 `health` 例外（它本身用于探活，不该触发启动）。
   */
  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (!this.running && method !== 'health') await this.ensureStarted()
    const child = this.child
    if (!child || child.exitCode !== null) throw new Error('图转视频引擎未在运行')

    const id = `tangbao-${Date.now().toString(36)}-${this.sequence++}`
    const payload = `${JSON.stringify({ id, method, params })}\n`

    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`引擎请求超时：${method}（${timeoutMs}ms）`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
    })

    child.stdin.write(payload, 'utf8')
    return (await response) as T
  }

  /** 收工：请引擎自己退，退不掉再杀整棵树。 */
  async dispose(): Promise<void> {
    this.disposing = true
    const child = this.child
    if (!child) return
    try {
      child.stdin.write(`${JSON.stringify({ id: null, method: 'shutdown', params: {} })}\n`, 'utf8')
      child.stdin.end()
    } catch {
      // stdin 已经断了：直接进下面的超时兜底
    }
    const exited = await this.waitForExit(child, SHUTDOWN_GRACE_MS)
    if (!exited && child.pid) killProcessTree(child.pid)
    this.child = null
    this.rejectAllPending(new Error('引擎已关闭'))
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.removeListener('exit', onExit)
        resolve(false)
      }, timeoutMs)
      const onExit = () => {
        clearTimeout(timer)
        resolve(true)
      }
      child.once('exit', onExit)
    })
  }

  private async startChild(): Promise<void> {
    const exePath = this.options.exePath
    const projectRoot = this.options.projectRoot ?? path.dirname(exePath)
    const child = spawn(exePath, ['--project-root', projectRoot], {
      cwd: projectRoot,
      // 引擎是 console 程序：不藏窗口用户会看到黑框
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...this.options.env },
    })
    this.child = child
    this.stdoutBuffer = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk))
    child.stderr.on('data', (chunk: string) => this.options.onLog?.('stderr', chunk))

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.startupSettled = null
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(
        () => settle(new Error(`图转视频引擎启动超时（${STARTUP_TIMEOUT_MS / 1000}s）`)),
        STARTUP_TIMEOUT_MS,
      )
      const onError = (error: Error) => settle(error)
      const onExit = (code: number | null) => settle(new Error(`图转视频引擎启动后立即退出（code=${code ?? '未知'}）`))
      child.once('error', onError)
      child.once('exit', onExit)
      // 引擎就绪时会主动推 engine.ready；收到即认为起好了
      this.startupSettled = () => settle()
    })

    // 崩溃兜底：清空在飞请求并广播，界面据此显示「引擎已退出」而不是一直转圈
    child.on('exit', (code) => {
      this.child = null
      const reason = this.disposing ? '引擎已关闭' : `图转视频引擎已退出（code=${code ?? '未知'}）`
      this.rejectAllPending(new Error(reason))
      this.emit({ type: 'event', event: 'engine.closed', payload: { code } })
    })
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    const { lines, rest } = splitNdjson(this.stdoutBuffer)
    this.stdoutBuffer = rest
    for (const line of lines) this.consumeLine(line)
    // 尾巴里如果已经是一个完整 JSON（最后一条没带换行），就地消化掉
    const tail = this.stdoutBuffer.trim()
    if (tail.startsWith('{') && tail.endsWith('}')) {
      this.stdoutBuffer = ''
      this.consumeLine(tail)
    }
  }

  private consumeLine(line: string): void {
    const frame = parseEngineFrame(line)
    if (!frame) {
      if (line.trim()) this.options.onLog?.('stdout', line)
      return
    }
    if (frame.type === 'event') {
      if (frame.event === 'engine.ready') this.startupSettled?.()
      this.emit(frame)
      return
    }
    if (!frame.id) return
    const pending = this.pending.get(frame.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(frame.id)
    if (frame.ok) pending.resolve(frame.result)
    else pending.reject(new Error(frame.error || `引擎请求失败：${pending.method}`))
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private emit(frame: EngineEventFrame): void {
    for (const listener of this.listeners) listener(frame)
  }
}

/** 引擎能力快照（`system_snapshot` 的子集）。 */
export interface EngineSystemSnapshot {
  cpu_percent?: number
  memory_percent?: number
  memory_available_gb?: number
  process_memory_mb?: number
  disk_free_gb?: number
  ffmpeg_available?: boolean
  ffmpeg_path?: string | null
  ffmpeg_version?: string | null
}
