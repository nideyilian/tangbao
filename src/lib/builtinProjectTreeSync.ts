import type { AssetCollection } from '../types'
import { getMigrationJournal, putMigrationJournal } from './db'
import { listCollections, putCollection } from './assetLibraryRepository'
import { runMigration } from './migrations/registry'
import { applyBuiltinProjectTree, BUILTIN_PROJECT_TREE_MIGRATION_ID } from './builtinProjectTreeApply'

/**
 * 内置「产品线 - 产品 - 方向」结构的启动写入。
 *
 * 与既有 `src/lib/migrations/*` 保持同一套惯例：走迁移 journal，**只执行一次**。
 * 这样里有一个关键取舍 —— 用户在界面里删除（或改名、移动）内置文件夹后不会被自动重建，
 * 避免重蹈「文件夹删不干净、每次启动又冒出来」的覆辙（见 assetLibrary store 的 hydrate 注释）。
 * 需要找回时由用户在设置页显式触发 {@link restoreBuiltinProjectTree}。
 */

/** 首次启动补齐内置结构；已执行过（含用户已删改）时直接返回空数组。 */
export async function runBuiltinProjectTreeMigration(now = Date.now()): Promise<AssetCollection[]> {
  let created: AssetCollection[] = []
  const journal = { get: getMigrationJournal, put: putMigrationJournal }
  await runMigration(
    BUILTIN_PROJECT_TREE_MIGRATION_ID,
    journal,
    async () => {
      const collections = await listCollections()
      const result = await applyBuiltinProjectTree(collections, { putCollection }, now)
      created = result.created
    },
    now,
  )
  return created
}

/**
 * 显式补齐内置结构（不走 journal）：把当前缺失的内置节点补回项目树。
 * 用于设置页的「补齐内置结构」入口 —— 只新增缺失项，绝不改写或删除用户调整过的文件夹。
 */
export async function restoreBuiltinProjectTree(now = Date.now()): Promise<{
  created: AssetCollection[]
  reused: number
  skipped: number
}> {
  const collections = await listCollections()
  const result = await applyBuiltinProjectTree(collections, { putCollection }, now)
  return { created: result.created, reused: result.reused, skipped: result.skipped }
}
