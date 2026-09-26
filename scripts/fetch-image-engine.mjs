/**
 * 取「图转视频」引擎（image-to-video-engine.exe）到 resources/image-engine/。
 *
 * ## 为什么引擎不进 git
 *
 * 引擎 exe 约 106 MiB —— 光是它内部 imageio_ffmpeg 自带的那份 ffmpeg 解压后就有 87 MiB。
 * **超过 GitHub 单文件 100 MiB 的硬上限**，直接 push 会被远端拒绝。原程序仓库同样是
 * gitignore 掉它、CI 现场用 PyInstaller 构建（`.gitignore` 第 21 行
 * `desktop/src-tauri/binaries/*.exe`）。所以糖包只在本地与构建时把它取过来，仓库里不留二进制。
 *
 * ## 取件优先级
 *
 * 1. `--from <path>` / 环境变量 `TANGBAO_ENGINE_SOURCE`：显式指定；
 * 2. 本机默认源：`D:/AAA/image-to-video/dist/image-to-video-engine.exe`（开发机直取）；
 * 3. 环境变量 `TANGBAO_ENGINE_URL`：下载（CI 用）。
 *
 * 取到之后写一份 `engine.json`（sha256 / 体积 / 来源 / 时间）—— 主进程与界面靠它显示
 * 当前用的是哪一版引擎。引擎是独立维护的另一个程序，换了版本必须有人知道。
 *
 * 用法：
 *   node scripts/fetch-image-engine.mjs            # 需要时才取
 *   node scripts/fetch-image-engine.mjs --force    # 无条件重取
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_DIR = resolve(PROJECT_ROOT, 'resources/image-engine')
const TARGET_EXE = resolve(TARGET_DIR, 'image-to-video-engine.exe')
const META_FILE = resolve(TARGET_DIR, 'engine.json')

/** 本机开发时的默认引擎来源（原程序仓库的 PyInstaller 产物）。 */
const LOCAL_SOURCE = 'D:/AAA/image-to-video/dist/image-to-video-engine.exe'

/**
 * 引擎体积下限：低于这个数说明取到的是半截文件或占位符。
 *
 * 取件最怕「拿到个不完整的 exe 却当成成功」——那种包装上以后是运行时才炸，
 * 而且报的是「引擎异常退出」，排查会绕很远。所以这里卡一道硬下限。
 */
const MIN_BYTES = 80 * 1024 * 1024

const FORCE = process.argv.includes('--force')

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function formatMb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

async function download(url, destination) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载引擎失败（HTTP ${response.status}）：${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(destination, buffer)
}

async function main() {
  const explicit = argValue('--from') || process.env.TANGBAO_ENGINE_SOURCE
  const url = process.env.TANGBAO_ENGINE_URL

  mkdirSync(TARGET_DIR, { recursive: true })

  if (!FORCE && existsSync(TARGET_EXE)) {
    const size = statSync(TARGET_EXE).size
    if (size >= MIN_BYTES) {
      const meta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8')) : {}
      console.log(`[engine] 已存在，跳过取件：${formatMb(size)}（sha256 ${String(meta.sha256 ?? '').slice(0, 12)}）`)
      return
    }
    console.warn(`[engine] 已有文件只有 ${formatMb(size)}，小于下限，重新取件`)
  }

  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`指定的引擎不存在：${explicit}`)
    copyFileSync(explicit, TARGET_EXE)
    console.log(`[engine] 已从指定路径复制：${explicit}`)
  } else if (existsSync(LOCAL_SOURCE)) {
    copyFileSync(LOCAL_SOURCE, TARGET_EXE)
    console.log(`[engine] 已从本机源复制：${LOCAL_SOURCE}`)
  } else if (url) {
    console.log(`[engine] 正在下载：${url}`)
    await download(url, TARGET_EXE)
  } else {
    throw new Error(
      [
        '找不到图转视频引擎，无法继续。三条路任选一条：',
        `  1. 本机构建原程序后重跑（默认源 ${LOCAL_SOURCE}）`,
        '  2. 用 --from <path> 或 TANGBAO_ENGINE_SOURCE=<path> 指定引擎 exe',
        '  3. 用 TANGBAO_ENGINE_URL=<url> 指向下载地址',
        '刻意不静默跳过：缺引擎的包会在用户机器上跑视频时才炸，那时排查成本高得多。',
      ].join('\n'),
    )
  }

  const size = statSync(TARGET_EXE).size
  if (size < MIN_BYTES) {
    throw new Error(`取到的引擎只有 ${formatMb(size)}，小于下限 ${formatMb(MIN_BYTES)}，视为取件失败`)
  }

  const meta = {
    sha256: sha256(TARGET_EXE),
    bytes: size,
    source: explicit || (existsSync(LOCAL_SOURCE) ? LOCAL_SOURCE : url),
    fetchedAt: new Date().toISOString(),
  }
  writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  console.log(`[engine] 就绪：${formatMb(size)}，sha256 ${meta.sha256.slice(0, 12)}`)
}

main().catch((error) => {
  console.error(`[engine] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
