/**
 * 「图转视频」引擎的可执行文件定位。
 *
 * ## 引擎是什么
 *
 * 引擎是**另一个程序**（`D:\AAA\image-to-video`，PyInstaller 冻结的 Python，约 106MB），
 * 通过 stdin/stdout 的 NDJSON 协议对话（一行一条 JSON，见 `engine-bridge.ts`）。
 * 它不共享糖包的进程、不读糖包的代码，只吃 `input_dir` 出 `output_dir`。
 *
 * ## 它不在 git 里
 *
 * 体积超 GitHub 单文件 100MiB 上限，所以由 `scripts/fetch-image-engine.mjs` 取件、
 * 由 `electron-builder.cjs` 的 extraResources 放进 `process.resourcesPath/image-engine/`。
 * 仓库里只有一个 `.gitkeep` 与这份定位逻辑。
 *
 * ## 三条解析规则（顺序即优先级）
 *
 * 1. `TANGBAO_ENGINE_PATH` 环境变量 —— 调试用，指向任意一份引擎；
 * 2. 打包态：`<resourcesPath>/image-engine/image-to-video-engine.exe`；
 * 3. 开发态：`<appPath>/resources/image-engine/image-to-video-engine.exe`。
 *
 * 定位逻辑抽成**不依赖 electron 的纯函数**（只吃路径 + 注入的 exists 判据），
 * 这样「找过哪些地方」这件事能被单测锁住 —— 引擎找不到时的报错必须能说清它找过哪里，
 * 否则用户拿到的只有一句「引擎未就绪」。
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'

export const ENGINE_DIR_NAME = 'image-engine'
export const ENGINE_FILE_NAME = 'image-to-video-engine.exe'

/** 引擎随包携带的元信息（由取件脚本写，用于界面显示「现在用的是哪一版」）。 */
export interface EngineMeta {
  sha256?: string
  bytes?: number
  source?: string
  fetchedAt?: string
}

export type EngineOrigin = 'override' | 'packaged' | 'development'

export interface EngineLocation {
  exePath: string
  origin: EngineOrigin
  meta: EngineMeta | null
  /** 解析过程中试过的每一个路径（找不到时报给用户，别让人猜） */
  tried: string[]
}

export interface ResolveEngineLocationOptions {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  override?: string
  /** 注入以便单测；默认 `fs.existsSync` */
  exists?: (candidate: string) => boolean
}

/**
 * 解析引擎位置；找不到返回 `null` 并带上「试过哪些路径」。
 *
 * 注意打包态与开发态的**目录不同**：打包后是 `resources/image-engine/`，
 * 开发时是仓库里的 `resources/image-engine/`（同一个相对位置，不同基准）。
 */
export function resolveEngineLocation(options: ResolveEngineLocationOptions): EngineLocation | null {
  const exists = options.exists ?? existsSync
  const tried: string[] = []

  const candidates: Array<{ exePath: string; origin: EngineOrigin }> = []
  if (options.override && options.override.trim()) {
    candidates.push({ exePath: options.override.trim(), origin: 'override' })
  }
  candidates.push({
    exePath: path.join(options.resourcesPath, ENGINE_DIR_NAME, ENGINE_FILE_NAME),
    origin: 'packaged',
  })
  candidates.push({
    exePath: path.join(options.appPath, 'resources', ENGINE_DIR_NAME, ENGINE_FILE_NAME),
    origin: 'development',
  })

  for (const candidate of candidates) {
    tried.push(candidate.exePath)
    if (!exists(candidate.exePath)) continue
    return {
      exePath: candidate.exePath,
      origin: candidate.origin,
      meta: readEngineMeta(path.join(path.dirname(candidate.exePath), 'engine.json')),
      tried,
    }
  }
  return null
}

/** 读同目录的 `engine.json`；缺失或损坏一律返回 null（元信息只用于显示，不该拖垮启动）。 */
export function readEngineMeta(metaPath: string): EngineMeta | null {
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as EngineMeta
  } catch {
    return null
  }
}

/** 引擎找不到时给用户看的说明（含试过的路径）。 */
export function describeMissingEngine(location: null | EngineLocation, tried: string[]): string {
  return [
    '找不到图转视频引擎，生成视频不可用。',
    '试过这些位置：',
    ...tried.map((item) => `  - ${item}`),
    '解决：在项目根跑 `npm run engine:fetch`，或用 TANGBAO_ENGINE_PATH 指向引擎 exe。',
  ].join('\n')
}
