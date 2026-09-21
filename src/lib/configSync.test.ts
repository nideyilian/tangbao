/* @vitest-environment jsdom */

/**
 * 配置同步的契约。
 *
 * 只钉两件事，但两件都会**静默出错**：
 * ① 文件名的时间戳必须让"字典序 = 时间序"成立 —— 拉取方就是靠它挑最新的一份，
 *    格式一旦漂移（补零、本地化格式），它会拉到旧配置而无人察觉；
 * ② 目录里只认我们自己发布的包（别把别人的备份、半成品、同名目录当候选）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const spies = vi.hoisted(() => ({ getConfigSyncPath: vi.fn() }))

vi.mock('./localSave', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localSave')>()
  return { ...actual, getConfigSyncPath: spies.getConfigSyncPath }
})

// configSync 只在发布/拉取时才用 store；这里整块替掉，免得把整棵 store 模块图拉进单测
vi.mock('../store', () => ({ exportDataToPath: vi.fn(), importDataFromPath: vi.fn() }))

import { fileStamp, listSyncDirConfigs } from './configSync'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('配置同步：文件名与「最新一份」的判定', () => {
  it('fileStamp 的字典序等于时间序（拉取方就是靠这个挑最新）', () => {
    const older = fileStamp(new Date(2026, 8, 22, 0, 55, 12))
    const newer = fileStamp(new Date(2026, 8, 22, 1, 5, 0))

    expect(older).toBe('20260922-005512')
    expect(newer).toBe('20260922-010500')
    expect([newer, older].sort()).toEqual([older, newer])

    // 跨月跨日也必须成立 —— 补零就是为了这个（9 月 8 日不能排到 11 月后面）
    expect(fileStamp(new Date(2026, 11, 9, 9, 8, 7))).toBe('20261209-090807')
    expect(fileStamp(new Date(2026, 0, 8, 0, 0, 0)) < fileStamp(new Date(2026, 11, 9, 0, 0, 0))).toBe(true)
  })

  it('目录里只认自己发布的包，且按时间从新到旧（目录与非 zip 不算）', async () => {
    spies.getConfigSyncPath.mockResolvedValue('D:/配置')
    vi.stubGlobal('window', {
      electronAPI: {
        readDirEntries: async () => [
          { name: 'tangbao-config-20260921-235900.zip', isDirectory: false },
          { name: 'tangbao-config-20260922-010000.zip', isDirectory: false },
          { name: '别人的备份.zip', isDirectory: false },
          { name: 'tangbao-config-20260922-010000', isDirectory: true },
          { name: 'tangbao-config-20260922-005512.txt', isDirectory: false },
        ],
      },
    })

    expect(await listSyncDirConfigs()).toEqual([
      'tangbao-config-20260922-010000.zip',
      'tangbao-config-20260921-235900.zip',
    ])
  })

  it('没设目录 / 目录不可达时给空列表而不是抛错（设置页据此显示「还没人发布过」）', async () => {
    spies.getConfigSyncPath.mockResolvedValue(null)
    expect(await listSyncDirConfigs()).toEqual([])

    spies.getConfigSyncPath.mockResolvedValue('D:/配置')
    vi.stubGlobal('window', {
      electronAPI: {
        readDirEntries: async () => {
          throw new Error('共享盘不在线')
        },
      },
    })
    expect(await listSyncDirConfigs()).toEqual([])
  })
})
