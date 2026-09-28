/**
 * 视频素材库的**文件操作**（导入走引擎，删除走这里）。
 *
 * ## 为什么不复用引擎的 `library_remove`
 *
 * 引擎的删除是 `send2trash` **丢进系统回收站**（它注释写着「给用户反悔机会」），
 * 而糖包 2026-09-24 已拍板「删除即永久删除、回收站撤除」（ADR-0021）——
 * 全应用只该有一种删除语义，库素材不该例外（2026-09-27 杰哥选定）。
 * 所以删除由糖包主进程直接做，引擎那边对应的方法**刻意不进白名单**。
 *
 * ## ⚠️ 但索引必须跟着清（不清会让「删掉的素材再也导不回来」）
 *
 * 引擎给每个库目录维护一份 `.library_index.json`，里面按文件名存着 `sha256`
 * （BGM 还存音频指纹）。而 `library_import` 的去重是**先查索引里的 sha256、再查磁盘**：
 * 只删文件、不清索引的话，那些 sha256 变成孤儿留在索引里 ——
 * 于是用户把同一个文件重新导入时，引擎会答「库中已有相同素材：xxx」，
 * 而那个「已有」的素材其实已经被他删掉了。**看着像导入坏了，其实是索引没跟上。**
 *
 * 所以删除 = 删文件 + 从**该文件所在目录**的索引里摘掉那一条（索引是按目录一份的）。
 */

import { existsSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import path from 'path'

export const LIBRARY_INDEX_FILE = '.library_index.json'

/** 候选路径是否真的在库目录内（`..` 穿越、同前缀的兄弟目录都挡掉）。 */
export function isPathInsideLibrary(candidate: string, libraryRoot: string): boolean {
  const root = path.resolve(libraryRoot)
  const target = path.resolve(candidate)
  if (target === root) return true
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * 从一份索引内容里摘掉给定文件名，返回新内容与被摘掉的条数。
 *
 * 纯函数（不碰盘），便于单测 —— 这段逻辑最容易写错的地方是「索引损坏时该怎么办」：
 * 一律**原样返回、一条都不删**，让上层如实报失败，绝不写回一个半截的索引。
 */
export function removeIndexEntries(index: unknown, names: readonly string[]): { next: unknown; removed: number } {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return { next: index, removed: 0 }
  const record = index as Record<string, unknown>
  const entries = record.entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { next: index, removed: 0 }

  const nextEntries: Record<string, unknown> = { ...(entries as Record<string, unknown>) }
  let removed = 0
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(nextEntries, name)) {
      delete nextEntries[name]
      removed += 1
    }
  }
  if (removed === 0) return { next: index, removed: 0 }
  return { next: { ...record, entries: nextEntries }, removed }
}

/** 从某个目录的索引里摘掉若干文件名（索引不存在 / 损坏时静默跳过 —— 那不算删除失败）。 */
function pruneIndex(directory: string, names: readonly string[]): number {
  const indexPath = path.join(directory, LIBRARY_INDEX_FILE)
  if (!existsSync(indexPath) || names.length === 0) return 0
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch {
    // 索引损坏：不动它（引擎下次扫描会自己重建），更不因此判删除失败
    return 0
  }
  const { next, removed } = removeIndexEntries(parsed, names)
  if (removed === 0) return 0
  // 原子写：临时文件 + rename，避免引擎那边读到半截 JSON
  const temporary = `${indexPath}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(next, null, 1), 'utf8')
  renameSync(temporary, indexPath)
  return removed
}

export interface DeleteLibraryResult {
  deleted: string[]
  failed: Array<{ path: string; error: string }>
  /** 顺带摘掉的索引条目数（诊断用） */
  indexEntriesRemoved: number
}

/**
 * 永久删除库里的素材（文件或空文件夹），并同步清理索引。
 *
 * 逐条处理、逐条报结果：一个删不掉不影响其余的（用户看到的是「哪几个没删掉」，
 * 而不是一句「删除失败」）。
 */
export function deleteVideoLibraryEntries(paths: readonly string[], libraryRoot: string): DeleteLibraryResult {
  const deleted: string[] = []
  const failed: Array<{ path: string; error: string }> = []
  let indexEntriesRemoved = 0

  for (const raw of paths) {
    const target = path.resolve(String(raw ?? '').trim())
    if (!target) continue
    if (!isPathInsideLibrary(target, libraryRoot)) {
      // 越界一律拒：这个通道能永久删文件，绝不能成为「传什么删什么」
      failed.push({ path: target, error: '路径不在视频素材库内' })
      continue
    }
    // 目录用递归删、文件用 unlink —— 分开是因为 rmSync 对单个文件也「能work」，
    // 但那样会掩盖「本想删空文件夹却删掉了整个子树」这种误用
    let isDirectory: boolean
    try {
      isDirectory = statSync(target).isDirectory()
    } catch {
      failed.push({ path: target, error: '文件不存在' })
      continue
    }
    try {
      if (isDirectory) rmSync(target, { recursive: true, force: true })
      else unlinkSync(target)
      deleted.push(target)
      indexEntriesRemoved += pruneIndex(path.dirname(target), [path.basename(target)])
    } catch (error) {
      failed.push({ path: target, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { deleted, failed, indexEntriesRemoved }
}
