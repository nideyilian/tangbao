import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface StoredApiSecrets {
  version: 1
  imageProfiles: Record<string, string>
  agentProfiles: Record<string, string>
}

export interface ApiSecretsLoadResult {
  available: boolean
  secrets: StoredApiSecrets
  error?: string
}

const EMPTY_SECRETS: StoredApiSecrets = {
  version: 1,
  imageProfiles: {},
  agentProfiles: {},
}

/**
 * 原子替换：写入临时文件 → 把旧文件挪成备份 → 临时文件改名就位 → 清掉备份。
 *
 * **只有最后那步改名是不可失败的**；其余都是尽力而为的清理动作。Windows 上
 * `rmSync` 会因为杀软/索引器短暂占用文件抛 `EPERM`/`EBUSY`，一旦让这种失败冒到
 * 调用方，`saveApiSecrets` 就会整体失败 → 渲染层 `[api-secrets] 写入失败，将自动重试`
 * 每 1.5 秒重试一次且永远不成功（密钥再也存不进去）。所以清理动作一律降级为告警。
 */
function removeFileQuietly(filePath: string): void {
  try {
    rmSync(filePath, { force: true })
  } catch (error) {
    console.warn('[api-secrets] 清理临时文件失败，已忽略', filePath, error)
  }
}

function replaceFile(filePath: string, content: string | Buffer): void {
  const tempPath = `${filePath}.tmp`
  const backupPath = `${filePath}.bak.swap`
  writeFileSync(tempPath, content)
  removeFileQuietly(backupPath)
  try {
    if (existsSync(filePath)) renameSync(filePath, backupPath)
  } catch (error) {
    // 备份失败不致命：旧文件仍在原位，下面的改名在 Windows 上会直接覆盖它。
    console.warn('[api-secrets] 备份旧密钥文件失败，将直接覆盖', error)
  }
  try {
    renameSync(tempPath, filePath)
    removeFileQuietly(backupPath)
  } catch (error) {
    if (existsSync(backupPath) && !existsSync(filePath)) renameSync(backupPath, filePath)
    throw error
  } finally {
    removeFileQuietly(tempPath)
  }
}

export function getApiSecretsPath(): string {
  return path.join(app.getPath('userData'), 'api-secrets.bin')
}

function normalizeSecretRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] =>
          entry[0].length > 0 && entry[0].length <= 512 && typeof entry[1] === 'string' && entry[1].length <= 16_384,
      )
      .map(([key, secret]) => [key, secret]),
  )
}

export function normalizeApiSecrets(value: unknown): StoredApiSecrets {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    version: 1,
    imageProfiles: normalizeSecretRecord(record.imageProfiles),
    agentProfiles: normalizeSecretRecord(record.agentProfiles),
  }
}

export function loadApiSecrets(): ApiSecretsLoadResult {
  if (!safeStorage.isEncryptionAvailable()) return { available: false, secrets: EMPTY_SECRETS }
  const filePath = getApiSecretsPath()
  if (!existsSync(filePath)) return { available: true, secrets: EMPTY_SECRETS }
  try {
    const decrypted = safeStorage.decryptString(readFileSync(filePath))
    return { available: true, secrets: normalizeApiSecrets(JSON.parse(decrypted)) }
  } catch (error) {
    return {
      available: true,
      secrets: EMPTY_SECRETS,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function saveApiSecrets(value: unknown): { success: boolean; error?: string } {
  if (!safeStorage.isEncryptionAvailable()) return { success: false, error: '系统安全存储不可用' }
  const filePath = getApiSecretsPath()
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(normalizeApiSecrets(value)))
    replaceFile(filePath, encrypted)
    scrubLegacyStateFiles()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function stripProfileApiKey(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...(value as Record<string, unknown>), apiKey: '' }
}

function stripSettingsApiKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const settings = value as Record<string, unknown>
  return {
    ...settings,
    apiKey: '',
    profiles: Array.isArray(settings.profiles) ? settings.profiles.map(stripProfileApiKey) : settings.profiles,
    agentProfiles: Array.isArray(settings.agentProfiles)
      ? settings.agentProfiles.map(stripProfileApiKey)
      : settings.agentProfiles,
    agentProfile: stripProfileApiKey(settings.agentProfile),
  }
}

function stripPersistedStateApiKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const root = value as Record<string, unknown>
  if (root.state && typeof root.state === 'object' && !Array.isArray(root.state)) {
    const state = root.state as Record<string, unknown>
    return {
      ...root,
      state: {
        ...state,
        settings: stripSettingsApiKeys(state.settings),
        dismissedCodexCliPrompts: [],
      },
    }
  }
  return {
    ...root,
    settings: stripSettingsApiKeys(root.settings),
    dismissedCodexCliPrompts: [],
  }
}

function scrubLegacyStateFiles(): void {
  const basePath = path.join(app.getPath('userData'), 'tangbao.json')
  for (const filePath of [basePath, `${basePath}.bak`]) {
    if (!existsSync(filePath)) continue
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      replaceFile(filePath, JSON.stringify(stripPersistedStateApiKeys(parsed), null, 2))
    } catch (error) {
      console.warn('[api-secrets] 清理旧状态文件中的 API Key 失败', filePath, error)
    }
  }
}
