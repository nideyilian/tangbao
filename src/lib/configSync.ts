/**
 * 配置同步：把本机的中控台配置**发布**到一个共享目录，或从那里**拉取最新的一份**。
 *
 * 与「导出数据 / 导入数据」共用同一套包和同一条恢复链路，差别只有三处：
 * - 路径不是当场选出来的，而是设置里配好的那个目录（多半是内网共享盘）
 * - 发布出来的文件名带时间戳，**字典序即时间序** —— 拉取方不用猜哪份最新，也不靠机器时钟比大小
 * - 拉取前**先把本机配置备份一份**，备份失败就不拉（单向覆盖的护栏）
 *
 * 单向覆盖的语义是刻意的：发布方那份是"标准配置"，拉取方以它为准。
 * 拉取方本地多出来的方向不会被删（见 `restoreTreeConfigBundle` 的注释），
 * 但**同 id 的节点一律以包为准**。
 */

import { getConfigSyncPath, getLocalSavePath } from './localSave'
import { exportDataToPath, importDataFromPath } from '../store'

/** 发布出来的包名前缀。改它要连着 `parseSyncFileName` 与文档一起改。 */
export const CONFIG_SYNC_FILE_PREFIX = 'tangbao-config-'
/** 拉取前的本机备份前缀，与手工备份的 `backup-before-*` 约定保持一致。 */
const BACKUP_PREFIX = 'backup-before-pull-'

export interface ConfigSyncResult {
  ok: boolean
  /** 直接给用户看的一句话结论（成功与失败都要说清"发生了什么"） */
  message: string
}

function getFsApi(): NonNullable<Window['electronAPI']> | null {
  if (typeof window === 'undefined') return null
  return window.electronAPI ?? null
}

/**
 * 文件名里的时间戳：`20260922-005512`。
 *
 * 刻意不用 `toLocaleString` 那类本地化格式 —— 里面有斜杠和中文，既不能做文件名，
 * 也会让"字典序 = 时间序"这个前提失效（拉取方正是靠它挑最新的一份）。
 */
export function fileStamp(at = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`,
    `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`,
  ].join('-')
}

/** 目录里已发布的配置，按时间从新到旧。 */
export async function listSyncDirConfigs(): Promise<string[]> {
  const api = getFsApi()
  const dir = await getConfigSyncPath()
  if (!api?.readDirEntries || !dir) return []
  try {
    const entries = await api.readDirEntries(dir)
    return entries
      .filter(
        (entry) => !entry.isDirectory && entry.name.startsWith(CONFIG_SYNC_FILE_PREFIX) && entry.name.endsWith('.zip'),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse()
  } catch {
    // 目录不存在 / 不可达时给空列表：设置页据此显示「还没有人发布过配置」，
    // 而不是弹一个用户看不懂的 IO 错误
    return []
  }
}

/**
 * 发布当前配置到配置目录。
 *
 * 只发**配置**（树 + 每个方向的参数 + 水印库 + 渠道与尺寸），不带任务、图片，
 * 也不带本机的素材索引 —— 后者发过去只会让别人的素材库里多出一堆指不到的条目。
 * 树会额外写一份 `assetCollections`，那是给过渡期的老版本（≤0.3.2）用的，见 store.ts 的注释。
 */
export async function publishConfigToSyncDir(): Promise<ConfigSyncResult> {
  const api = getFsApi()
  if (!api) return { ok: false, message: '当前环境不支持（需要在桌面客户端里操作）' }
  const dir = await getConfigSyncPath()
  if (!dir) return { ok: false, message: '还没设置配置目录。先在上面填一个（或点「选择目录」）再发布。' }

  const created = await api.ensureDir(dir)
  if (created !== true) {
    return { ok: false, message: `配置目录建不出来：${dir}${typeof created === 'string' ? `（${created}）` : ''}` }
  }

  const fileName = `${CONFIG_SYNC_FILE_PREFIX}${fileStamp()}.zip`
  const filePath = await api.pathJoin(dir, fileName)
  const result = await exportDataToPath(filePath, {
    exportConfig: true,
    exportTasks: false,
    exportAssets: false,
    exportImages: false,
  })
  if (!result.success) return { ok: false, message: `发布失败：写不进 ${dir}（确认这个目录可写）` }
  return { ok: true, message: `已发布：${fileName}` }
}

/**
 * 拉取配置目录里最新的那份，覆盖本机配置。
 *
 * 备份失败**直接中止**：没有备份的覆盖是不可回退的，宁可这次不拉。
 */
export async function pullLatestConfigFromSyncDir(): Promise<ConfigSyncResult> {
  const api = getFsApi()
  if (!api?.readDirEntries) return { ok: false, message: '当前环境不支持（需要在桌面客户端里操作）' }
  const dir = await getConfigSyncPath()
  if (!dir) return { ok: false, message: '还没设置配置目录。先在上面填一个（或点「选择目录」）再拉取。' }

  const names = await listSyncDirConfigs()
  const latest = names[0]
  if (!latest) return { ok: false, message: `这个目录里还没有人发布过配置：${dir}` }

  const backupPath = await backupLocalConfigBeforePull()
  if (!backupPath) return { ok: false, message: '拉取前备份失败，已中止 —— 不做没有退路的覆盖' }

  const filePath = await api.pathJoin(dir, latest)
  const ok = await importDataFromPath(filePath, {
    importConfig: true,
    importTasks: false,
    importAssets: false,
    importImages: false,
  })
  if (!ok) return { ok: false, message: `拉取失败：${latest} 读不了或内容不完整（本机配置未变）` }
  return { ok: true, message: `已拉取 ${latest}；本机原配置备份在 ${backupPath}` }
}

/**
 * 拉取前把本机配置存一份。
 *
 * 存在**本机**（本地保存目录下的 `backups/`）而不是配置目录：备份是给自己回退用的，
 * 放共享盘等于让所有能看到那个盘的人都能翻你的历史配置。
 */
export async function backupLocalConfigBeforePull(): Promise<string | null> {
  const api = getFsApi()
  if (!api) return null
  const root = await getLocalSavePath()
  if (!root) return null
  const backupDir = await api.pathJoin(root, 'backups')
  if ((await api.ensureDir(backupDir)) !== true) return null
  const filePath = await api.pathJoin(backupDir, `${BACKUP_PREFIX}${fileStamp()}.zip`)
  const result = await exportDataToPath(filePath, {
    exportConfig: true,
    exportTasks: false,
    exportAssets: false,
    exportImages: false,
  })
  return result.success ? filePath : null
}
