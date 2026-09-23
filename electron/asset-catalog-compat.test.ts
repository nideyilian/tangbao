import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveGeneratedAssetBatch, resolveGeneratedAssetNameBase } from '../src/lib/generatedImageFilename'
import type { GeneratedAsset } from '../src/types'
import { AssetCatalog, CATALOG_MIGRATIONS, CATALOG_SCHEMA_VERSION, CATALOG_SCHEMA_VERSION_KEY } from './asset-catalog'

/**
 * 老库兼容测试（对应 `docs/serpent-borrowing-plan.md` P3）。
 *
 * 守的是一条底线：**新代码必须能打开老版本糖包写出来的库。**
 * 覆盖四件事：缺的列能自动补齐、老数据一条不丢、一次性回填只做一次、库损坏要显式失败
 * 而不是静默变成一个"看起来正常但 0 条数据"的空库（那会让用户以为数据丢了）。
 *
 * ⚠️ 下面 `LEGACY_SCHEMA` **必须永远停在过去**。
 * 往后给 assets / collections / tags 加列时，不要回头往这里补 —— 补了就等于把测试改成"总能通过"，
 * 这道闸门就废了。要覆盖更新的一版结构，请另写一个 `createLibraryV2` 之类的函数。
 */

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'asset-catalog-compat-'))

/**
 * 损坏库单独放一个目录。
 *
 * 原因：`new AssetCatalog(损坏文件)` 会在构造函数里抛错，那个 SQLite 句柄拿不到引用、
 * 只能等 GC 回收；Windows 上未释放的句柄会让"整个目录递归删除"报 EPERM。
 * 隔离出来之后，主目录仍可严格清理，而这条用例也不必为了"删得掉"而被砍掉。
 */
const corruptDir = mkdtempSync(path.join(os.tmpdir(), 'asset-catalog-compat-corrupt-'))

let dbSeq = 0

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
  try {
    rmSync(corruptDir, { recursive: true, force: true })
  } catch (error) {
    console.warn('[asset-catalog-compat] 损坏库临时目录未能清理（句柄待 GC 释放，系统临时目录会自行回收）', error)
  }
})

function nextDbPath(label: string): string {
  return path.join(tempDir, `${label}-${++dbSeq}.sqlite`)
}

/**
 * 老版结构：停在「生成命名排序」那次加列（`file_name` / `filename_batch`）之前，
 * 也停在 collections 的颜色/置顶/软删、tags 的树形列之前。
 *
 * 顺带不建 `asset_machine_index` / `asset_usage_events` / `tombstones` / `app_data_records`
 * 这几张表 —— 更早的库确实没有它们，正好一并验证「表也能后加」。
 */
const LEGACY_SCHEMA = `
  CREATE TABLE blobs (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    mime_type TEXT,
    byte_size INTEGER,
    file_path TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    current_version_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    trashed_at INTEGER,
    favorite INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    area INTEGER NOT NULL DEFAULT 0,
    collection_ids TEXT NOT NULL,
    tag_ids TEXT NOT NULL,
    origins TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE INDEX assets_status_updated ON assets(status, updated_at DESC, id);
  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    blob_id TEXT NOT NULL REFERENCES blobs(id),
    version_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    json TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE asset_fts USING fts5(asset_id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

/** 一份老数据用的素材记录：`filenameBatch` / `filenameLabel` 齐备，好在回填后有确定的期望值。 */
function legacyAsset(id: string, updatedAt: number): GeneratedAsset {
  return {
    id,
    imageId: `hash-${id}`,
    status: 'active',
    createdAt: updatedAt,
    updatedAt,
    trashedAt: null,
    favorite: false,
    rating: 0,
    collectionIds: [],
    tagIds: [],
    origins: [
      {
        kind: 'generated',
        key: `task:${id}`,
        taskId: `task-${id}`,
        outputSlot: 0,
        taskCreatedAt: updatedAt,
        taskFinishedAt: updatedAt,
        sourceMode: 'gallery',
        prompt: `提示词 ${id}`,
        requestedParams: {} as never,
        inputImageIds: [],
        filenameBatch: 3,
        filenameLabel: '标签A',
      },
    ],
    primaryOriginKey: `task:${id}`,
    parentAssetIds: [],
    metadataVersion: 2,
  }
}

function createLegacyLibrary(dbPath: string, rows: Array<{ id: string; json: string; updatedAt: number }>): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(LEGACY_SCHEMA)
    const insert = db.prepare(
      `INSERT INTO assets(id, current_version_id, status, created_at, updated_at, favorite, rating, area,
        collection_ids, tag_ids, origins, json) VALUES (?, ?, 'active', ?, ?, 0, 0, 0, '[]', '[]', '[]', ?)`,
    )
    for (const row of rows) insert.run(row.id, `version:${row.id}`, row.updatedAt, row.updatedAt, row.json)
  } finally {
    db.close()
  }
}

/** 测试内部自管连接，不套 `readOnly` —— 与"排查真实用户数据"场景不同，这里必须读到刚写入的行。 */
function readColumns(dbPath: string, table: string): string[] {
  const db = new DatabaseSync(dbPath)
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)
  } finally {
    db.close()
  }
}

function readAssetSortRow(dbPath: string, id: string): { file_name: unknown; filename_batch: unknown } {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare('SELECT file_name, filename_batch FROM assets WHERE id = ?').get(id) as
      { file_name: unknown; filename_batch: unknown } | undefined
    if (!row) throw new Error(`asset ${id} 不在库里`)
    return row
  } finally {
    db.close()
  }
}

function runRaw(dbPath: string, sql: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}

describe('老库兼容：新代码打开旧版本写出的库', () => {
  it('缺的列会被自动补齐（assets / collections / tags 三批）', () => {
    const dbPath = nextDbPath('columns')
    createLegacyLibrary(dbPath, [{ id: 'a', json: JSON.stringify(legacyAsset('a', 1)), updatedAt: 1 }])

    const catalog = new AssetCatalog(dbPath)
    catalog.close()

    expect(readColumns(dbPath, 'assets')).toEqual(expect.arrayContaining(['file_name', 'filename_batch']))
    expect(readColumns(dbPath, 'collections')).toEqual(expect.arrayContaining(['color', 'pinned', 'trashed_at']))
    expect(readColumns(dbPath, 'tags')).toEqual(expect.arrayContaining(['parent_id', 'sort_order']))
  })

  it('老数据一条不丢，打开后能正常查询', () => {
    const dbPath = nextDbPath('count')
    const ids = ['a', 'b', 'c']
    createLegacyLibrary(
      dbPath,
      ids.map((id, index) => ({ id, json: JSON.stringify(legacyAsset(id, 100 + index)), updatedAt: 100 + index })),
    )

    const catalog = new AssetCatalog(dbPath)
    const page = catalog.query({
      scope: 'all',
      query: '',
      filters: {},
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    })
    catalog.close()

    expect(page.counts.all).toBe(3)
    expect(page.assets.map((asset) => asset.id).sort()).toEqual(ids)
  })

  it('命名排序列的回填值 === 新代码按同一份数据算出来的值', () => {
    const dbPath = nextDbPath('backfill')
    const asset = legacyAsset('a', 1_700_000_000_000)
    createLegacyLibrary(dbPath, [{ id: 'a', json: JSON.stringify(asset), updatedAt: 1_700_000_000_000 }])

    const catalog = new AssetCatalog(dbPath)
    catalog.close()

    const row = readAssetSortRow(dbPath, 'a')
    expect(row.file_name).not.toBeNull()
    expect(row.file_name).not.toBe('')
    expect(row.file_name).toBe(resolveGeneratedAssetNameBase(asset))
    expect(row.filename_batch).toBe(resolveGeneratedAssetBatch(asset))
    expect(row.filename_batch).toBe(3)
  })

  it('回填只做一次：再次打开不会覆盖已被修正过的值', () => {
    const dbPath = nextDbPath('idempotent')
    createLegacyLibrary(dbPath, [{ id: 'a', json: JSON.stringify(legacyAsset('a', 1)), updatedAt: 1 }])

    const first = new AssetCatalog(dbPath)
    first.close()
    expect(readAssetSortRow(dbPath, 'a').file_name).not.toBe('')

    // 哨兵值：若第二次打开还去回填，这个值就会被覆盖掉。
    runRaw(dbPath, `UPDATE assets SET file_name = '哨兵' WHERE id = 'a'`)

    const second = new AssetCatalog(dbPath)
    second.close()
    expect(readAssetSortRow(dbPath, 'a').file_name).toBe('哨兵')
  })

  it('json 坏掉的老数据不会让打开失败', () => {
    const dbPath = nextDbPath('bad-json')
    createLegacyLibrary(dbPath, [{ id: 'bad', json: '这不是 JSON', updatedAt: 1 }])

    const catalog = new AssetCatalog(dbPath)
    catalog.close()

    const row = readAssetSortRow(dbPath, 'bad')
    expect(row.file_name === '' || row.file_name === null).toBe(true)
    expect(row.filename_batch).toBe(0)
  })

  it('库文件损坏时显式抛错，不会被静默当成空库', () => {
    const dbPath = path.join(corruptDir, `corrupt-${++dbSeq}.sqlite`)
    writeFileSync(dbPath, '这不是一个 SQLite 文件')

    expect(() => new AssetCatalog(dbPath)).toThrow()
  })

  it('老库打开后写入新数据正常，且不影响老数据', () => {
    const dbPath = nextDbPath('write')
    createLegacyLibrary(dbPath, [{ id: 'old', json: JSON.stringify(legacyAsset('old', 1)), updatedAt: 1 }])

    const catalog = new AssetCatalog(dbPath)
    catalog.upsertAssets([
      {
        asset: makeFreshAsset('new'),
        localPath: 'D:/new.png',
      },
    ])
    const page = catalog.query({
      scope: 'all',
      query: '',
      filters: {},
      sortKey: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    })
    catalog.close()

    expect(page.counts.all).toBe(2)
    expect(page.assets.map((asset) => asset.id).sort()).toEqual(['new', 'old'])
  })
})

/** 读库里的结构版本号；没写过、甚至连表都没有（老库 / 全新库）一律返回 null。 */
function readSchemaVersion(dbPath: string): string | null {
  const db = new DatabaseSync(dbPath)
  try {
    const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog_meta'`).get()
    if (!hasTable) return null
    const row = db.prepare('SELECT value FROM catalog_meta WHERE key = ?').get(CATALOG_SCHEMA_VERSION_KEY) as
      { value?: string } | undefined
    return row?.value ?? null
  } finally {
    db.close()
  }
}

/** 手工把某一列抹掉，用来模拟"结构落后于版本号"的库。有索引的列必须先删索引。 */
function dropColumn(dbPath: string, table: string, column: string): void {
  runRaw(dbPath, `DROP INDEX IF EXISTS ${table}_${column}`)
  runRaw(dbPath, `ALTER TABLE ${table} DROP COLUMN ${column}`)
}

describe('目录结构版本与迁移链', () => {
  it('全新库打开后直接带上当前结构版本', () => {
    const dbPath = nextDbPath('fresh-version')

    const catalog = new AssetCatalog(dbPath)
    catalog.close()

    expect(readSchemaVersion(dbPath)).toBe(String(CATALOG_SCHEMA_VERSION))
  })

  it('老库（没有版本号）打开后补齐到当前版本', () => {
    const dbPath = nextDbPath('legacy-version')
    createLegacyLibrary(dbPath, [{ id: 'a', json: JSON.stringify(legacyAsset('a', 1)), updatedAt: 1 }])
    expect(readSchemaVersion(dbPath)).toBeNull()

    const catalog = new AssetCatalog(dbPath)
    catalog.close()

    expect(readSchemaVersion(dbPath)).toBe(String(CATALOG_SCHEMA_VERSION))
  })

  it('版本号落后 + 结构缺列 → 补跑迁移，两者一起补齐', () => {
    const dbPath = nextDbPath('behind-version')
    const first = new AssetCatalog(dbPath)
    first.close()

    // 退回"未版本化 + 缺列"的历史状态
    runRaw(dbPath, `DELETE FROM catalog_meta WHERE key = '${CATALOG_SCHEMA_VERSION_KEY}'`)
    dropColumn(dbPath, 'assets', 'file_name')
    expect(readColumns(dbPath, 'assets')).not.toContain('file_name')

    const second = new AssetCatalog(dbPath)
    second.close()

    expect(readColumns(dbPath, 'assets')).toContain('file_name')
    expect(readSchemaVersion(dbPath)).toBe(String(CATALOG_SCHEMA_VERSION))
  })

  it('版本号已是最新 → 整条迁移链被跳过（连缺列都不再探测）', () => {
    const dbPath = nextDbPath('skip-version')
    const first = new AssetCatalog(dbPath)
    first.close()
    expect(readSchemaVersion(dbPath)).toBe(String(CATALOG_SCHEMA_VERSION))

    // 绕过迁移链手工抹掉一列：再次打开**不该**把它补回来。
    // 这是"按版本号跳过"的反向证据 —— 若哪天有人删掉 `runMigrations` 里的版本判断，这条会红。
    dropColumn(dbPath, 'assets', 'file_name')

    const second = new AssetCatalog(dbPath)
    second.close()

    expect(readColumns(dbPath, 'assets')).not.toContain('file_name')
  })

  it('迁移链自检：版本号常量与最后一节对齐，且严格递增无重复', () => {
    const versions = CATALOG_MIGRATIONS.map((migration) => migration.version)

    expect(versions.length).toBeGreaterThan(0)
    expect(Math.max(...versions)).toBe(CATALOG_SCHEMA_VERSION)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
    expect(new Set(versions).size).toBe(versions.length)
  })
})

function makeFreshAsset(id: string): GeneratedAsset {
  return {
    ...legacyAsset(id, 2_000_000_000_000),
    blobId: `blob:hash-${id}`,
    currentVersionId: `version:${id}`,
  }
}
