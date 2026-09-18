import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesktopJsonStorage } from './desktopJsonStorage'

type Api = {
  isElectron: boolean
  appDataGet: (namespace: string, id: string) => Promise<unknown>
  appDataPut: (namespace: string, id: string, value: unknown) => Promise<{ success: boolean }>
}

function stubElectronApi(overrides: Partial<Api> = {}) {
  const puts: Array<{ namespace: string; id: string; value: unknown }> = []
  const api: Api = {
    isElectron: true,
    appDataGet: async () => undefined,
    appDataPut: async (namespace, id, value) => {
      puts.push({ namespace, id, value })
      return { success: true }
    },
    ...overrides,
  }
  vi.stubGlobal('window', { electronAPI: api })
  return { api, puts }
}

/** 落盘是双重编码：zustand 的字符串再被 JSON.stringify 一次。读回来 appDataGet 会 parse 一层。 */
const doubleEncoded = (payload: unknown) => JSON.stringify(JSON.stringify(payload))
const payload = { state: { settings: { baseUrl: 'https://example.com' } }, version: 4 }

/** createJSONStorage 的返回类型是 `| undefined`，桥接可用时不会落到 undefined。 */
function makeStorage(namespace: string, legacy?: { read: () => Promise<string | null> }) {
  const storage = createDesktopJsonStorage(namespace, legacy)
  if (!storage) throw new Error('storage 创建失败')
  return storage
}

async function drainWrites() {
  await vi.advanceTimersByTimeAsync(1000)
}

describe('createDesktopJsonStorage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reads a double-encoded record back as the persisted state', async () => {
    // appDataGet 内部会 JSON.parse 一次，所以双重编码的记录读出来正好是字符串
    stubElectronApi({ appDataGet: async () => JSON.parse(doubleEncoded(payload)) })

    const storage = makeStorage('zustand')

    await expect(storage.getItem('tangbao')).resolves.toEqual(payload)
  })

  it('restores a single-encoded record instead of treating it as missing', async () => {
    // 单层编码：appDataGet 返回的是对象。早期实现用 typeof === 'string' 判定，
    // 会把这种情况误判成「没有数据」，让 zustand 用初始 state 覆盖磁盘真实配置。
    stubElectronApi({ appDataGet: async () => payload })

    const storage = makeStorage('zustand')

    await expect(storage.getItem('tangbao')).resolves.toEqual(payload)
  })

  it('treats a missing record as first run and still allows writing', async () => {
    const { puts } = stubElectronApi({ appDataGet: async () => undefined })

    const storage = makeStorage('zustand')
    await expect(storage.getItem('tangbao')).resolves.toBeNull()

    const written = storage.setItem('tangbao', payload)
    await drainWrites()
    await written

    expect(puts).toHaveLength(1)
    expect(puts[0].namespace).toBe('zustand')
  })

  it('blocks writes after a read failure so real data cannot be overwritten', async () => {
    const { puts } = stubElectronApi({
      appDataGet: async () => {
        throw new Error('invalid app data namespace')
      },
    })

    const storage = makeStorage('zustand')
    await expect(storage.getItem('tangbao')).rejects.toThrow('invalid app data namespace')

    // zustand 在 getItem 失败后会退回初始 state，之后任何一次 set 都会尝试落盘 —— 必须拦住
    await storage.setItem('tangbao', { state: {}, version: 4 })
    await storage.removeItem('tangbao')
    await drainWrites()

    expect(puts).toHaveLength(0)
  })

  it('blocks writes when an existing record is corrupted and no legacy store can be migrated', async () => {
    const { puts } = stubElectronApi({ appDataGet: async () => '{not valid json' })

    const storage = makeStorage('zustand')
    await expect(storage.getItem('tangbao')).resolves.toBeNull()

    await storage.setItem('tangbao', { state: {}, version: 4 })
    await drainWrites()

    expect(puts).toHaveLength(0)
  })

  it('migrates from the legacy store and writes the migrated content back', async () => {
    const legacyContent = JSON.stringify({ state: { fromLegacy: true }, version: 3 })
    const { puts } = stubElectronApi({ appDataGet: async () => undefined })

    const storage = makeStorage('zustand', { read: async () => legacyContent })

    await expect(storage.getItem('tangbao')).resolves.toEqual({ state: { fromLegacy: true }, version: 3 })
    expect(puts).toHaveLength(1)
    expect(puts[0].value).toBe(legacyContent)
  })

  it('rejects an unrecognised record shape instead of falling back to defaults', async () => {
    const { puts } = stubElectronApi({ appDataGet: async () => 42 })

    const storage = makeStorage('zustand')
    await expect(storage.getItem('tangbao')).rejects.toThrow('应用状态记录格式无法识别')

    await storage.setItem('tangbao', { state: {}, version: 4 })
    await drainWrites()

    expect(puts).toHaveLength(0)
  })

  it('falls back to localStorage when the desktop bridge is unavailable', async () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    })
    vi.stubGlobal('window', { electronAPI: { isElectron: false } })

    const storage = makeStorage('zustand')
    storage.setItem('tangbao', payload)

    expect(backing.get('tangbao')).toBe(JSON.stringify(payload))
  })
})
