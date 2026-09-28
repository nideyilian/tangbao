/**
 * 视频素材库的文件操作与索引清理。
 *
 * 重点钉住两件事：
 * 1. **越界必须拒** —— `image-video:library-delete` 能永久删文件，它绝不能变成「传什么删什么」；
 * 2. **删文件要顺手清索引** —— 引擎的导入去重看的是索引里的 sha256，
 *    只删文件不清索引的话，那些 sha256 变成孤儿，用户把同一个文件重新导入时会被
 *    误判成「库中已有相同素材」（看着像导入坏了）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteVideoLibraryEntries, isPathInsideLibrary, LIBRARY_INDEX_FILE, removeIndexEntries } from './library-fs'

describe('isPathInsideLibrary', () => {
  const root = path.resolve('D:/库/video-library')

  it('库内（含库根本身）算在内', () => {
    expect(isPathInsideLibrary('D:/库/video-library/bgm/a.mp3', root)).toBe(true)
    expect(isPathInsideLibrary(root, root)).toBe(true)
  })

  it('库外一律不算', () => {
    expect(isPathInsideLibrary('D:/其它/a.mp3', root)).toBe(false)
    expect(isPathInsideLibrary('D:/库/video-library-备份/a.mp3', root)).toBe(false)
  })

  it('`..` 穿越不算（这是这条通道唯一的安全边界）', () => {
    expect(isPathInsideLibrary('D:/库/video-library/../other/a.mp3', root)).toBe(false)
    expect(isPathInsideLibrary('D:/库/video-library/bgm/../../outside.mp3', root)).toBe(false)
  })
})

describe('removeIndexEntries', () => {
  const index = { version: 1, kind: 'bgm', entries: { 'a.mp3': { sha256: 'x' }, 'b.mp3': { sha256: 'y' } } }

  it('摘掉给定名字，其余不动', () => {
    const { next, removed } = removeIndexEntries(index, ['a.mp3'])
    expect(removed).toBe(1)
    expect(next).toEqual({ version: 1, kind: 'bgm', entries: { 'b.mp3': { sha256: 'y' } } })
  })

  it('名字不在索引里就当没摘（不算错）', () => {
    expect(removeIndexEntries(index, ['zzz.mp3'])).toEqual({ next: index, removed: 0 })
  })

  it('索引损坏时原样返回、一条都不删 —— 绝不写回半截索引', () => {
    expect(removeIndexEntries(null, ['a.mp3']).removed).toBe(0)
    expect(removeIndexEntries({ entries: 'not-an-object' }, ['a.mp3']).removed).toBe(0)
    expect(removeIndexEntries([1, 2], ['a.mp3']).removed).toBe(0)
  })
})

describe('deleteVideoLibraryEntries', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'tangbao-video-library-'))
    mkdirSync(path.join(root, 'bgm'), { recursive: true })
    writeFileSync(path.join(root, 'bgm', 'song.mp3'), 'x')
    writeFileSync(path.join(root, 'bgm', 'keep.mp3'), 'y')
    writeFileSync(
      path.join(root, 'bgm', LIBRARY_INDEX_FILE),
      JSON.stringify({
        version: 1,
        kind: 'bgm',
        entries: { 'song.mp3': { sha256: 'aaa' }, 'keep.mp3': { sha256: 'bbb' } },
      }),
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('删文件 + 顺手清掉它的索引条目（不清的话下次导入会被误判成重复）', () => {
    const result = deleteVideoLibraryEntries([path.join(root, 'bgm', 'song.mp3')], root)
    expect(result.deleted).toHaveLength(1)
    expect(result.failed).toEqual([])
    expect(result.indexEntriesRemoved).toBe(1)
    expect(existsSync(path.join(root, 'bgm', 'song.mp3'))).toBe(false)

    const index = JSON.parse(readFileSync(path.join(root, 'bgm', LIBRARY_INDEX_FILE), 'utf8'))
    expect(Object.keys(index.entries)).toEqual(['keep.mp3'])
  })

  it('⭐ 库外路径逐条拒绝，且不动那个文件', () => {
    const outside = path.join(tmpdir(), `tangbao-outside-${Date.now()}.txt`)
    writeFileSync(outside, 'must survive')
    try {
      const result = deleteVideoLibraryEntries([outside], root)
      expect(result.deleted).toEqual([])
      expect(result.failed[0]?.error).toContain('不在视频素材库内')
      expect(existsSync(outside)).toBe(true)
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('不存在的文件报「文件不存在」，不抛', () => {
    const result = deleteVideoLibraryEntries([path.join(root, 'bgm', 'gone.mp3')], root)
    expect(result.deleted).toEqual([])
    expect(result.failed[0]?.error).toBe('文件不存在')
  })

  it('一个删不掉不影响其余（逐条报结果）', () => {
    const result = deleteVideoLibraryEntries(
      [path.join(tmpdir(), 'outside-a.mp3'), path.join(root, 'bgm', 'song.mp3')],
      root,
    )
    expect(result.deleted).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
  })
})
