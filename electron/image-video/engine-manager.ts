/**
 * 引擎的**单例管理**：一个应用只有一个引擎进程。
 *
 * ## 为什么常驻
 *
 * 引擎是 PyInstaller onefile，每次启动都要把约 106MB 解压到 `%TEMP%\_MEIxxxx`；
 * 而且它本身就是长驻服务（自己带任务队列、暂停/取消、内存优化）。跑一个视频重启一次，
 * 光启动开销就够呛，还会把「杀软扫描 106MB exe」这件事重复做很多遍。
 *
 * 所以：**按需启动一次，之后一直用**；应用退出时才收工（`shutdownEngine`）。
 *
 * ## 找不到引擎时不阻断应用
 *
 * 引擎不在位（用户没跑过取件脚本 / 装包不完整）时，糖包的其它功能照常可用，
 * 只有「生成视频」不可用 —— 所以这里**不抛异常阻断启动**，而是把「为什么不可用」
 * 记成状态交给界面显示。真正要拦住的是构建：`electron-builder.cjs` 的 beforePack
 * 会在缺引擎时直接让打包失败。
 */

import { app, BrowserWindow } from 'electron'
import { ImageEngineBridge, killProcessTree, type EngineEventFrame, type EngineSystemSnapshot } from './engine-bridge'
import { resolveEngineLocation, type EngineLocation } from './engine-path'

/** 引擎事件推给渲染进程的频道。 */
export const IMAGE_VIDEO_EVENT_CHANNEL = 'image-video:event'

let bridge: ImageEngineBridge | null = null
let location: EngineLocation | null = null
let locationResolved = false
let snapshot: EngineSystemSnapshot | null = null

export interface ImageVideoEngineStatus {
  /** 引擎是否在位（不在位时 `reason` 说明找过哪些地方） */
  available: boolean
  running: boolean
  pid: number | null
  exePath: string | null
  origin: EngineLocation['origin'] | null
  meta: EngineLocation['meta']
  ffmpegAvailable: boolean | null
  ffmpegPath: string | null
  ffmpegVersion: string | null
  reason: string | null
}

/** 解析并缓存引擎位置。 */
export function getEngineLocation(): EngineLocation | null {
  if (locationResolved) return location
  locationResolved = true
  location = resolveEngineLocation({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    override: process.env.TANGBAO_ENGINE_PATH,
  })
  return location
}

/** 取（必要时起）引擎。找不到引擎时抛错 —— 调用方负责把它变成界面提示。 */
export async function ensureImageEngine(): Promise<ImageEngineBridge> {
  const resolved = getEngineLocation()
  if (!resolved) {
    throw new Error(
      '找不到图转视频引擎。请在项目根执行 `npm run engine:fetch`，或用 TANGBAO_ENGINE_PATH 指定引擎路径。',
    )
  }
  if (!bridge) {
    bridge = new ImageEngineBridge({
      exePath: resolved.exePath,
      onLog: (stream, message) => {
        // 引擎会把 moviepy/ffmpeg 的进度条刷到 stdout，行很长；裁一下再转发，
        // 免得一条日志几 MB 地把 IPC 撑住
        broadcast({ type: 'event', event: 'engine.log', payload: { stream, message: message.slice(0, 4000) } })
      },
    })
    bridge.subscribe((frame) => {
      // engine.closed 之后桥里的 child 已经置空，下次 call 会自动重启
      broadcast(frame)
    })
  }
  await bridge.ensureStarted()
  return bridge
}

/**
 * 探一次引擎环境（ffmpeg 在不在、是哪一份）。
 *
 * **为什么要把 ffmpeg 路径暴露出来**：引擎找 ffmpeg 的顺序是「先系统 PATH、再它自带的」，
 * 而它自带那份在 onefile 的解压目录里 —— 路径每次启动都变，外部**没法预先钉死**。
 * 于是用户机上那个又老又破的 ffmpeg 会被优先用上，出问题时现象是「编码参数不支持」，
 * 用户在界面上看不到任何线索。这个快照就是为了把「到底用的哪一份」变成可见信息。
 */
export async function probeImageEngineSystem(force = false): Promise<EngineSystemSnapshot | null> {
  if (snapshot && !force) return snapshot
  if (!getEngineLocation()) return null
  try {
    const engine = await ensureImageEngine()
    snapshot = await engine.call<EngineSystemSnapshot>('system_snapshot', {}, 60_000)
  } catch {
    // 探测失败不影响功能判定：真实调用时还会再报一次，这里静默降级为 null
    return null
  }
  return snapshot
}

export function getImageVideoEngineStatus(): ImageVideoEngineStatus {
  const resolved = getEngineLocation()
  return {
    available: resolved !== null,
    running: bridge?.running ?? false,
    pid: bridge?.pid ?? null,
    exePath: resolved?.exePath ?? null,
    origin: resolved?.origin ?? null,
    meta: resolved?.meta ?? null,
    ffmpegAvailable: snapshot?.ffmpeg_available ?? null,
    ffmpegPath: snapshot?.ffmpeg_path ?? null,
    ffmpegVersion: snapshot?.ffmpeg_version ?? null,
    reason: resolved ? null : '未找到引擎可执行文件（跑过 npm run engine:fetch 吗？）',
  }
}

/** 应用退出时调用：请引擎收工，退不掉就杀整棵树。 */
export async function shutdownImageEngine(): Promise<void> {
  const current = bridge
  bridge = null
  snapshot = null
  if (!current) return
  await current.dispose()
}

/**
 * 同步兜底：立刻杀掉引擎整棵树。用于 `will-quit`。
 *
 * 为什么异步的 `shutdownImageEngine` 不够：它要等引擎自己退（有 grace 期），
 * 而退出流程可能被别的 `before-quit` 打断、或更新安装强制退出 —— 那时 await 还没回来，
 * 进程就没了。引擎自己还会 spawn 渲染 worker（孙子进程），`child.kill()` 杀不掉它们，
 * 结果就是**用户关了糖包，后台还有一堆 python 在啃 CPU**。
 */
export function killImageEngineNow(): void {
  const pid = bridge?.pid ?? null
  bridge = null
  snapshot = null
  if (pid) killProcessTree(pid)
}

function broadcast(frame: EngineEventFrame): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IMAGE_VIDEO_EVENT_CHANNEL, frame)
  }
}
