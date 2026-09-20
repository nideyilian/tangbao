import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUserData = mkdtempSync(path.join(os.tmpdir(), 'secure-api-secrets-'))

vi.mock('electron', () => ({
  app: { getPath: () => mockUserData },
  // 测试里不需要真加密：加个前缀即可，方便断言落盘内容。
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, ''),
  },
}))

import { loadApiSecrets, saveApiSecrets } from './secure-api-secrets'

const secretsPath = () => path.join(mockUserData, 'api-secrets.bin')
const tempPath = () => `${secretsPath()}.tmp`
const backupPath = () => `${secretsPath()}.bak.swap`

const secrets = (key: string) => ({
  version: 1 as const,
  imageProfiles: { 'default-openai': key },
  agentProfiles: {},
})

/** 直接落一份「上一版」密钥文件，模拟应用上次运行结束时的状态。 */
function seedPreviousSecrets(key: string) {
  writeFileSync(secretsPath(), Buffer.from(`enc:${JSON.stringify(secrets(key))}`, 'utf8'))
}

describe('secure api secrets 原子写入', () => {
  beforeEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
    mkdirSync(mockUserData, { recursive: true })
  })

  afterAll(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('写入成功后不留临时文件与备份残留', () => {
    seedPreviousSecrets('sk-old')

    const result = saveApiSecrets(secrets('sk-new'))

    expect(result.success).toBe(true)
    expect(existsSync(tempPath())).toBe(false)
    expect(existsSync(backupPath())).toBe(false)
    expect(loadApiSecrets().secrets.imageProfiles['default-openai']).toBe('sk-new')
  })

  it('首次写入（无旧文件）直接成功', () => {
    const result = saveApiSecrets(secrets('sk-first'))

    expect(result.success).toBe(true)
    expect(loadApiSecrets().secrets.imageProfiles['default-openai']).toBe('sk-first')
  })

  it('已有陈旧备份残留时写入仍成功，并把残留清掉', () => {
    seedPreviousSecrets('sk-old')
    writeFileSync(backupPath(), Buffer.from('enc:{"version":1,"imageProfiles":{},"agentProfiles":{}}'))

    const result = saveApiSecrets(secrets('sk-new'))

    expect(result.success).toBe(true)
    expect(existsSync(backupPath())).toBe(false)
    expect(loadApiSecrets().secrets.imageProfiles['default-openai']).toBe('sk-new')
  })

  /**
   * 本次事故复现：清理旧备份的 `rmSync` 抛错（现场是 CodeBuddy 的 safe-delete 钩子，
   * 抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`；Windows 上杀软/索引器占用也会抛 EPERM）。
   *
   * 这里用「备份路径是个目录」制造同样的 `rmSync` 抛错（不带 recursive 时抛 EISDIR），
   * 不需要 mock 任何模块。旧实现会让整次保存失败 → 密钥永远写不进去。
   */
  it('清理旧备份抛错时，密钥仍写入成功（不得整体失败）', () => {
    seedPreviousSecrets('sk-old')
    mkdirSync(backupPath())

    const result = saveApiSecrets(secrets('sk-new'))

    expect(result.success).toBe(true)
    expect(loadApiSecrets().secrets.imageProfiles['default-openai']).toBe('sk-new')
    expect(readFileSync(secretsPath(), 'utf8')).toContain('sk-new')
  })

  it('无文件时读取返回空密钥且标记可用', () => {
    const loaded = loadApiSecrets()

    expect(loaded.available).toBe(true)
    expect(loaded.error).toBeUndefined()
    expect(loaded.secrets.imageProfiles).toEqual({})
    expect(loaded.secrets.agentProfiles).toEqual({})
  })

  it('文件损坏时返回空密钥并带上错误信息，不抛异常', () => {
    writeFileSync(secretsPath(), Buffer.from('not-a-valid-payload-without-prefix', 'utf8'))

    const loaded = loadApiSecrets()

    expect(loaded.available).toBe(true)
    expect(loaded.secrets.imageProfiles).toEqual({})
    expect(loaded.error).toBeTruthy()
  })
})
