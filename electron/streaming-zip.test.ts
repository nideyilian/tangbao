import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { TREE_CONFIG_ENTRY } from '../src/lib/treeConfigBundle'
import { writeStreamingZip } from './streaming-zip'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('writeStreamingZip', () => {
  it('writes a readable archive from source files', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-zip-'))
    dirs.push(dir)
    const source = path.join(dir, 'a.png')
    const destinationPath = path.join(dir, 'backup.zip')
    writeFileSync(source, 'first')

    expect(
      await writeStreamingZip({
        destinationPath,
        manifestJson: JSON.stringify({ version: 3 }),
        entries: [{ sourcePath: source, archivePath: 'images/a.png', mtime: 1 }],
      }),
    ).toEqual({ success: true })

    const archive = unzipSync(readFileSync(destinationPath))
    expect(JSON.parse(strFromU8(archive['manifest.json']))).toEqual({ version: 3 })
    expect(Buffer.from(archive['images/a.png']).toString()).toBe('first')
  })

  it('removes partial output when a source is missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-zip-'))
    dirs.push(dir)
    const destinationPath = path.join(dir, 'backup.zip')
    const missing = path.join(dir, 'missing.png')
    const result = await writeStreamingZip({
      destinationPath,
      manifestJson: '{}',
      entries: [{ sourcePath: missing, archivePath: 'images/missing.png' }],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('missing.png')
    expect(existsSync(destinationPath)).toBe(false)
    expect(existsSync(`${destinationPath}.partial`)).toBe(false)
  })

  it('writes inline composite asset bytes', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-zip-'))
    dirs.push(dir)
    const destinationPath = path.join(dir, 'backup.zip')

    expect(
      await writeStreamingZip({
        destinationPath,
        manifestJson: '{}',
        entries: [
          {
            archivePath: 'composite-assets/asset-a.png',
            data: new Uint8Array([1, 2, 3]),
          },
        ],
      }),
    ).toEqual({ success: true })

    const archive = unzipSync(readFileSync(destinationPath))
    expect([...archive['composite-assets/asset-a.png']]).toEqual([1, 2, 3])
  })

  it('writes inline thumbnail bytes', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-zip-'))
    dirs.push(dir)
    const destinationPath = path.join(dir, 'backup.zip')

    expect(
      await writeStreamingZip({
        destinationPath,
        manifestJson: '{}',
        entries: [{ archivePath: 'thumbnails/image-a.webp', data: new Uint8Array([4, 5, 6]) }],
      }),
    ).toEqual({ success: true })

    const archive = unzipSync(readFileSync(destinationPath))
    expect([...archive['thumbnails/image-a.webp']]).toEqual([4, 5, 6])
  })

  it('rejects inline entries outside supported archive folders', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-zip-'))
    dirs.push(dir)
    const destinationPath = path.join(dir, 'backup.zip')

    const result = await writeStreamingZip({
      destinationPath,
      manifestJson: '{}',
      entries: [{ archivePath: 'other/asset-a.png', data: new Uint8Array([1]) }],
    })

    expect(result.success).toBe(false)
    expect(existsSync(destinationPath)).toBe(false)
  })

  /**
   * 成对守卫：包内**根级**的配置本体必须写得进去。
   *
   * v9 把配置拆成包内独立一份 `config.json` 时，主进程这条白名单没跟着放行，
   * 结果是「发布配置 / 导出数据」在写第一个条目时就被拒 —— 而它一直没被测出来，
   * 因为当时的用例只覆盖了三个资源目录。这条用例刻意用渲染侧的常量，
   * 谁改了 `TREE_CONFIG_ENTRY` 却忘了同步白名单（或反过来），这里就会红。
   */
  it('writes the root-level config entry (pairs with TREE_CONFIG_ENTRY)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stream-zip-'))
    dirs.push(dir)
    const destinationPath = path.join(dir, 'backup.zip')

    expect(
      await writeStreamingZip({
        destinationPath,
        manifestJson: '{}',
        entries: [{ archivePath: TREE_CONFIG_ENTRY, data: new Uint8Array([7, 8]) }],
      }),
    ).toEqual({ success: true })

    expect([...unzipSync(readFileSync(destinationPath))[TREE_CONFIG_ENTRY]]).toEqual([7, 8])
  })
})
