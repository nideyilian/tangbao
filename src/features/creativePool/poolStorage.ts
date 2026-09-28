import { POOL_RANDOM_DEFAULT_COUNT } from './poolSelection'
import type { CreativePool, CreativePoolItem, CreativePoolKind, CreativePoolSelection } from './types'
import { clampPoolName, CREATIVE_POOL_KINDS } from './types'

/**
 * 池的持久化。
 *
 * 两个命名空间（**都要**在 `electron/asset-kernel.ts` 的 `APP_DATA_NAMESPACES` 白名单里登记）：
 * - `creativePools` —— 池元数据（一条记录装下全部池，小）。
 * - `creativePoolAssets` —— 池图本体（一条记录一张图，dataUrl 内嵌）。
 *
 * **图为什么单独存**：池元数据会被频繁重写（改名 / 删项 / 加项），把几 MB 的 dataUrl 塞在
 * 同一条记录里，每次重写都要序列化整份图 —— 慢且浪费。
 *
 * **为什么不复用素材库或图片存储**：素材是「删除即永久删除」，图片记录又会被启动时的孤儿
 * 回收（超过 7 天没被任务 / 标签页引用就删，见 `store.ts`）⇒ 池子必须自持一份副本，
 * 否则用户哪天删了素材，池子里的图就变成点不开的空格子。
 */

export const CREATIVE_POOL_NAMESPACE = 'creativePools'
export const CREATIVE_POOL_ASSET_NAMESPACE = 'creativePoolAssets'

const STATE_ID = 'state'
const LOCAL_POOLS_KEY = 'tangbao.creative-pools.v1'
const LOCAL_ASSETS_KEY = 'tangbao.creative-pool-assets.v1'

type AppDataApi = {
  isElectron?: boolean
  appDataGet?: (namespace: string, id: string) => Promise<unknown>
  appDataGetMany?: (namespace: string, ids: string[]) => Promise<unknown[]>
  appDataPut?: (namespace: string, id: string, value: unknown) => Promise<{ success: boolean }>
  appDataDeleteMany?: (namespace: string, ids: string[]) => Promise<{ success: boolean }>
}

function getApi(): AppDataApi | null {
  const runtime = globalThis as typeof globalThis & { window?: { electronAPI?: AppDataApi } }
  const api = runtime.window?.electronAPI
  if (!api?.isElectron) return null
  return api.appDataGet && api.appDataPut ? api : null
}

/**
 * 读失败后**拒绝写入**。
 *
 * ⚠️ 这不是洁癖：`createDesktopJsonStorage` 的注释记着 2026-09-18 那次事故 ——
 * 读失败被当成「没有数据」→ 用初始值覆盖磁盘 → 整份 settings（含 API 配置与密钥引用）被重置。
 * 池子里装的是用户的图，宁可本次会话不落盘，也不能把磁盘上既有的池子覆盖成空。
 * 重启后恢复正常即自动解除（与既有实现同口径）。
 */
let degraded = false

/** 仅测试用：重置降级态。 */
export function resetPoolStorageDegradedForTest() {
  degraded = false
}

/** 仅在测试里断言用。 */
export function isPoolStorageDegraded(): boolean {
  return degraded
}

function readLocalJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeLocalJson(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // 浏览器回退下配额溢出等失败：忽略（生产环境走 SQLite）
  }
}

function readLocalAssetMap(): Record<string, string> {
  const raw = readLocalJson(LOCAL_ASSETS_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

/** 默认选中态：手选、没选任何图、随机抽默认张数。 */
export function createEmptySelection(): CreativePoolSelection {
  return { mode: 'manual', selectedIds: [], randomCount: POOL_RANDOM_DEFAULT_COUNT }
}

/**
 * 选中态归一。**必须校验 id 是否还在池里** —— 删图后残留的勾选要清掉，
 * 否则界面写着「已选 1 张」而实际一张都发不出去。
 */
function normalizeSelection(raw: unknown, itemIds: Set<string>): CreativePoolSelection {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const selectedIds = Array.isArray(source.selectedIds)
    ? [...new Set(source.selectedIds.filter((id): id is string => typeof id === 'string' && itemIds.has(id)))]
    : []
  const randomCount =
    typeof source.randomCount === 'number' && Number.isFinite(source.randomCount)
      ? Math.max(1, Math.floor(source.randomCount))
      : POOL_RANDOM_DEFAULT_COUNT
  return { mode: source.mode === 'random' ? 'random' : 'manual', selectedIds, randomCount }
}

/** 空池：三种 kind 都要在 —— 缺的池不能「不存在」，否则界面少一个入口。 */
export function createEmptyPools(): CreativePool[] {
  return CREATIVE_POOL_KINDS.map((kind) => ({
    kind,
    items: [],
    maxRandomCount: null,
    selection: createEmptySelection(),
  }))
}

/** 随机上限：正的有限数才认，其余（缺省 / 0 / 负数 / 非数）一律当「不限」。 */
function normalizeMaxRandomCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}

function normalizeItem(raw: unknown): CreativePoolItem | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const assetRef = typeof record.assetRef === 'string' ? record.assetRef.trim() : ''
  // 缺 id 或没有图引用的项一律丢掉：留着只会渲染成点不开的空格子
  if (!id || !assetRef) return null
  const now = Date.now()
  return {
    id,
    name: clampPoolName(typeof record.name === 'string' ? record.name : '未命名'),
    assetRef,
    points: Array.isArray(record.points) ? record.points.filter((p): p is string => typeof p === 'string') : [],
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now,
  }
}

/**
 * 把磁盘上读到的任意形状归一成完整的三池结构（缺的补空、脏项丢掉、重复 id 去重）。
 *
 * 盘上的数据可能来自旧版本、导入或手工改过的库，所以这里一律防御式解析，
 * **不信任任何字段**。
 */
export function normalizePools(raw: unknown): CreativePool[] {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawPools = Array.isArray(source.pools) ? source.pools : []
  const byKind = new Map<CreativePoolKind, CreativePoolItem[]>()
  const maxByKind = new Map<CreativePoolKind, number | null>()
  const selectionByKind = new Map<CreativePoolKind, CreativePoolSelection>()

  for (const entry of rawPools) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const kind = record.kind
    if (typeof kind !== 'string' || !CREATIVE_POOL_KINDS.includes(kind as CreativePoolKind)) continue
    const items = Array.isArray(record.items) ? record.items : []
    const seen = new Set<string>()
    const normalized: CreativePoolItem[] = []
    for (const rawItem of items) {
      const item = normalizeItem(rawItem)
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      normalized.push(item)
    }
    byKind.set(kind as CreativePoolKind, normalized)
    maxByKind.set(kind as CreativePoolKind, normalizeMaxRandomCount(record.maxRandomCount))
    selectionByKind.set(
      kind as CreativePoolKind,
      normalizeSelection(record.selection, new Set(normalized.map((item) => item.id))),
    )
  }

  return CREATIVE_POOL_KINDS.map((kind) => ({
    kind,
    items: byKind.get(kind) ?? [],
    maxRandomCount: maxByKind.get(kind) ?? null,
    selection: selectionByKind.get(kind) ?? createEmptySelection(),
  }))
}

/** 读全部池。读失败 → 进入降级态并返回空池（**不会**因此清空磁盘）。 */
export async function readPools(): Promise<CreativePool[]> {
  const api = getApi()
  if (!api?.appDataGet) return normalizePools(readLocalJson(LOCAL_POOLS_KEY))
  try {
    const raw = await api.appDataGet(CREATIVE_POOL_NAMESPACE, STATE_ID)
    return normalizePools(raw)
  } catch (error) {
    degraded = true
    console.error('[creativePool] 读取池失败，本次会话不再写盘（避免覆盖磁盘上的既有数据）', error)
    return createEmptyPools()
  }
}

/** 写全部池。降级态或写失败返回 false（调用方据此提示，不静默吞掉）。 */
export async function writePools(pools: CreativePool[]): Promise<boolean> {
  if (degraded) return false
  const api = getApi()
  const payload = { pools }
  if (!api?.appDataPut) {
    writeLocalJson(LOCAL_POOLS_KEY, payload)
    return true
  }
  try {
    await api.appDataPut(CREATIVE_POOL_NAMESPACE, STATE_ID, payload)
    return true
  } catch (error) {
    console.error('[creativePool] 写入池失败', error)
    return false
  }
}

/**
 * 按引用 id 取回池图 dataUrl。
 *
 * ⚠️ 主进程的 `app-data:get-many` 返回的是「值的数组」——**既不带 id、顺序也不保证**
 * （`asset-catalog.ts` 里是 `[...Map.values()]`）。所以这里按 value 自带的 `id` 建映射，
 * 绝不按位置对应。（`{ id, dataUrl }` 这个形状就是为它准备的。）
 */
export async function readPoolAssets(refs: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (refs.length === 0) return result

  const api = getApi()
  if (!api?.appDataGetMany) {
    const local = readLocalAssetMap()
    for (const ref of refs) {
      const dataUrl = local[ref]
      if (dataUrl) result.set(ref, dataUrl)
    }
    return result
  }

  try {
    const rows = await api.appDataGetMany(CREATIVE_POOL_ASSET_NAMESPACE, [...refs])
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      if (typeof record.id === 'string' && typeof record.dataUrl === 'string' && record.dataUrl) {
        result.set(record.id, record.dataUrl)
      }
    }
  } catch (error) {
    console.error('[creativePool] 读取池图失败', error)
  }
  return result
}

/** 写入一张池图（`assetRef` 同时也是记录 id）。 */
export async function writePoolAsset(assetRef: string, dataUrl: string): Promise<boolean> {
  if (degraded) return false
  const api = getApi()
  if (!api?.appDataPut) {
    const local = readLocalAssetMap()
    local[assetRef] = dataUrl
    writeLocalJson(LOCAL_ASSETS_KEY, local)
    return true
  }
  try {
    await api.appDataPut(CREATIVE_POOL_ASSET_NAMESPACE, assetRef, { id: assetRef, dataUrl })
    return true
  } catch (error) {
    console.error('[creativePool] 写入池图失败', error)
    return false
  }
}

/** 删除池图（删池项时调用；图是池子私有的，删项即删图）。 */
export async function deletePoolAssets(refs: readonly string[]): Promise<void> {
  if (refs.length === 0 || degraded) return
  const api = getApi()
  if (!api?.appDataDeleteMany) {
    const local = readLocalAssetMap()
    for (const ref of refs) delete local[ref]
    writeLocalJson(LOCAL_ASSETS_KEY, local)
    return
  }
  try {
    await api.appDataDeleteMany(CREATIVE_POOL_ASSET_NAMESPACE, [...refs])
  } catch (error) {
    console.error('[creativePool] 删除池图失败', error)
  }
}

/** 生成池项 id / 资产 id。用短横线 + 字母数字，避开记录 id 的字符限制。 */
export function createPoolId(): string {
  return `pool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createPoolAssetRef(): string {
  return `pa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
