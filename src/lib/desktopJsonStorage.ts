import { createJSONStorage, type StateStorage } from 'zustand/middleware'
import { createCoalescedJsonStorage } from './coalescedJsonStorage'

type LegacyJsonAdapter = {
  read: () => Promise<string | null>
}

type DesktopAppDataApi = {
  isElectron?: boolean
  appDataGet?: (namespace: string, id: string) => Promise<unknown>
  appDataPut?: (namespace: string, id: string, value: unknown) => Promise<{ success: boolean }>
}

function getApi(): DesktopAppDataApi | null {
  const globalWindow = globalThis as typeof globalThis & { window?: { electronAPI?: DesktopAppDataApi } }
  const api = globalWindow.window?.electronAPI
  return api?.isElectron && api.appDataGet && api.appDataPut ? api : null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dispatchPersistProblem(namespace: string, detail: string) {
  const runtime = globalThis as typeof globalThis & {
    dispatchEvent?: (event: unknown) => void
    CustomEvent?: new (type: string, init?: { detail?: unknown }) => unknown
  }
  if (runtime.dispatchEvent && runtime.CustomEvent) {
    runtime.dispatchEvent(new runtime.CustomEvent('tangbao:persist-error', { detail: { namespace, detail } }))
  }
}

/**
 * 桌面端 JSON 持久化。
 *
 * 编码约定（**改这里之前先读**）：`appDataPut(ns, id, value)` 落盘的是 `JSON.stringify(value)`，
 * `appDataGet` 返回的又是 `JSON.parse(row.json)`。zustand persist 传进来的 `content` 已经是字符串，
 * 所以正常落盘是**双重编码**，读回来 parse 一次刚好还原成字符串。
 *
 * 因此 `read` **不能**用「返回值是不是字符串」来判定记录是否有效：一旦某条记录是单层编码
 * （例如经导入通道写入），`appDataGet` 会返回对象，早期实现会把它当成「没有数据」→ zustand 拿初始
 * state 兜底 → 首次 set 直接把磁盘上的真实数据覆盖掉。2026-09-18 整份 `settings` 被重置成出厂默认
 * （API 配置与密钥引用一并丢失）就是这条路径。
 *
 * 现在的约定：
 * - 读失败（IPC 抛错）或记录存在但格式不认识 → 进入**降级态**，**拒绝后续写入**，宁可本次会话的
 *   改动不落盘，也不允许把磁盘上的既有数据覆盖成默认值；用户重启后恢复正常即自动解除。
 * - 只有「主进程确认没有这条记录」才返回 null，交由 zustand 用初始 state 并正常落盘（首次运行）。
 */
export function createDesktopJsonStorage(namespace: string, legacy?: LegacyJsonAdapter) {
  return createJSONStorage((): StateStorage => {
    const api = getApi()
    if (!api) return localStorage

    let degraded = false
    let degradedNotified = false
    const markDegraded = (reason: string) => {
      degraded = true
      if (degradedNotified) return
      degradedNotified = true
      console.error(`[storage] ${namespace} 状态读取异常，本次会话已禁用该命名空间写盘：${reason}`)
      dispatchPersistProblem(namespace, reason)
    }

    const inner = createCoalescedJsonStorage(
      {
        read: async () => {
          let value: unknown
          try {
            value = await api.appDataGet!(namespace, 'state')
          } catch (error) {
            // 读取本身失败绝不能降级成「没有数据」：zustand 会拿初始 state 覆盖磁盘真实数据。
            markDegraded(error instanceof Error ? error.message : '读取状态记录失败')
            throw error
          }

          let corrupted = false
          if (typeof value === 'string' && value.length > 0) {
            try {
              JSON.parse(value)
              return value
            } catch {
              console.warn(`[storage] SQLite 状态记录损坏，回退旧存储：${namespace}`)
              corrupted = true
            }
          } else if (value !== undefined && value !== null) {
            // 记录存在但不是字符串 → 单层编码，兼容还原（见文件头说明）。
            if (isPlainRecord(value)) {
              console.warn(`[storage] 状态记录为单层编码，按对象兼容还原：${namespace}`)
              return JSON.stringify(value)
            }
            markDegraded(`状态记录格式无法识别：${typeof value}`)
            throw new Error(`应用状态记录格式无法识别：${namespace}`)
          }

          const legacyValue = (await legacy?.read()) ?? null
          if (legacyValue) {
            const result = await api.appDataPut!(namespace, 'state', legacyValue)
            if (!result.success) throw new Error(`应用状态迁移失败：${namespace}`)
            return legacyValue
          }
          if (corrupted) {
            // 有记录但读不出来，且没有可迁移的旧存储 → 不能让默认值把它盖掉。
            markDegraded('状态记录损坏且无旧存储可迁移')
          }
          return legacyValue
        },
        write: async (content) => {
          const result = await api.appDataPut!(namespace, 'state', content)
          if (!result.success) throw new Error(`应用状态写入失败：${namespace}`)
          return true
        },
      },
      {
        onWriteError: (error) => {
          console.error(`[storage] 应用状态写入失败，将自动重试：${namespace}`, error)
          dispatchPersistProblem(namespace, error instanceof Error ? error.message : '写入失败')
        },
      },
    )

    return {
      getItem: (name) => inner.getItem(name),
      setItem: (name, value) => {
        if (degraded) return
        return inner.setItem(name, value)
      },
      removeItem: (name) => {
        if (degraded) return
        return inner.removeItem(name)
      },
    }
  })
}
