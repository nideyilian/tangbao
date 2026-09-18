import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_POSTPROCESS_DISTRIBUTION,
  buildDistributionDates,
  isPostprocessDistributionActive,
  normalizePostprocessDistributionConfig,
  runPostprocessDistribution,
  type PostprocessDistributionConfig,
  type PostprocessDistributionElectronApi,
  type PostprocessDistributionItem,
} from './postprocessDistribution'

function createConfig(overrides: Partial<PostprocessDistributionConfig> = {}): PostprocessDistributionConfig {
  return {
    ...DEFAULT_POSTPROCESS_DISTRIBUTION,
    enabled: true,
    startDate: '20260701',
    days: 3,
    renameMode: 'date',
    ...overrides,
  }
}

function createItems(paths: string[], outputRoot?: string): PostprocessDistributionItem[] {
  return paths.map((path) => (outputRoot ? { path, outputRoot } : { path }))
}

function createMockApi(initialExisting: string[] = []) {
  const existing = new Set(initialExisting)
  const calls: Array<{ sourcePath: string; targetPath: string; mode: 'copy' | 'move'; appendRandomByte?: boolean }> = []
  const removedDirs: string[] = []
  const api: PostprocessDistributionElectronApi = {
    pathJoin: async (...parts: string[]) => parts.join('\\'),
    checkExists: async (path: string) => existing.has(path),
    distributeFile: async (input) => {
      calls.push(input)
      existing.add(input.targetPath)
      return { success: true }
    },
    removeEmptyDir: async (dir: string) => {
      removedDirs.push(dir)
      return undefined
    },
  }
  return { api, calls, removedDirs }
}

describe('isPostprocessDistributionActive', () => {
  it('开关、天数、起始日期三者缺一不可', () => {
    expect(isPostprocessDistributionActive(createConfig())).toBe(true)
    expect(isPostprocessDistributionActive(createConfig({ enabled: false }))).toBe(false)
    expect(isPostprocessDistributionActive(createConfig({ days: 0 }))).toBe(false)
    // 缺日期时**不做任何搬运**，而不是退回今天：猜日期会把素材投放到错误的日子上
    expect(isPostprocessDistributionActive(createConfig({ startDate: '' }))).toBe(false)
    expect(isPostprocessDistributionActive(createConfig({ startDate: '2026-07-01' }))).toBe(false)
  })
})

describe('buildDistributionDates', () => {
  it('跳过周末时顺延到工作日', () => {
    // 2026-07-03 是周五
    expect(buildDistributionDates('20260703', 3, true)).toEqual(['20260703', '20260706', '20260707'])
  })

  it('跨月与跨年时补零正确', () => {
    expect(buildDistributionDates('20261231', 3, false)).toEqual(['20261231', '20270101', '20270102'])
  })

  it('非法日期返回空数组', () => {
    expect(buildDistributionDates('', 3, false)).toEqual([])
    expect(buildDistributionDates('20260701', 0, false)).toEqual([])
  })
})

describe('normalizePostprocessDistributionConfig', () => {
  it('默认关闭：分发会移动磁盘文件，不能靠默认值把产物搬走', () => {
    expect(normalizePostprocessDistributionConfig(undefined).enabled).toBe(false)
    expect(DEFAULT_POSTPROCESS_DISTRIBUTION.enabled).toBe(false)
  })

  it('天数非法回落到默认值，mode / renameMode 只认白名单', () => {
    const config = normalizePostprocessDistributionConfig({ days: 0, mode: 'delete', renameMode: 'uuid' })
    expect(config.days).toBe(1)
    expect(config.mode).toBe('copy')
    expect(config.renameMode).toBe('date')
  })
})

describe('runPostprocessDistribution', () => {
  it('同名产物自动加后缀，不静默覆盖', async () => {
    const { api, calls } = createMockApi()
    // 两个文件原名里的日期不同，但替换为目标日期后同名 → 第二个必须自动改名
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\img_20260601.jpg', 'D:\\out\\20260701\\img_20260602.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
    )

    expect(result.success).toBe(2)
    expect(result.canceled).toBe(false)
    // 后缀用「-」与 `taskPostprocess.resolveUniquePath` 保持一致：同一条链路上的重名兜底应该长得一样
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\img_20260701.jpg',
      'D:\\out\\20260701\\img_20260701-2.jpg',
    ])
  })

  it('目标已存在时继续试探 -2 之后的后缀', async () => {
    const { api, calls } = createMockApi(['D:\\out\\20260701\\img_20260701.jpg'])
    await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\img_20260601.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
    )

    expect(calls[0]?.targetPath).toBe('D:\\out\\20260701\\img_20260701-2.jpg')
  })

  it('sequence 模式按日期文件夹名 + 序号重排', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\x.jpg', 'D:\\out\\20260701\\y.jpg', 'D:\\out\\20260701\\z.jpg']),
      createConfig({ renameMode: 'sequence', days: 3 }),
      api,
    )

    expect(result.success).toBe(3)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\20260701_01.jpg',
      'D:\\out\\20260702\\20260702_01.jpg',
      'D:\\out\\20260703\\20260703_01.jpg',
    ])
  })

  it('日期段判定不受下划线影响（`\\b` 会在 `_2` 前失效，故不能用）', async () => {
    const { api, calls } = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\img_20260601.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
    )

    // 目录里没有日期段 → 嵌套日期子文件夹；文件名里的日期段被替换
    expect(calls[0]?.targetPath).toBe('D:\\out\\20260701\\img_20260701.jpg')
  })

  it('日期替换目录在多天之间保持稳定，不出现嵌套日期文件夹', async () => {
    const { api, calls } = createMockApi()
    // 回归：全局正则 test() 的 lastIndex 状态曾让相邻目录交替走「替换」与「嵌套」两个分支
    const result = await runPostprocessDistribution(
      createItems([
        'D:\\out\\20260701\\a.jpg',
        'D:\\out\\20260701\\b.jpg',
        'D:\\out\\20260701\\c.jpg',
        'D:\\out\\20260701\\d.jpg',
        'D:\\out\\20260701\\e.jpg',
      ]),
      createConfig({ renameMode: 'date', days: 5 }),
      api,
    )

    expect(result.success).toBe(5)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\a.jpg',
      'D:\\out\\20260702\\b.jpg',
      'D:\\out\\20260703\\c.jpg',
      'D:\\out\\20260704\\d.jpg',
      'D:\\out\\20260705\\e.jpg',
    ])
  })

  it('余数分给前几天，保证总数不多不少', async () => {
    const { api, calls } = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg', 'D:\\out\\20260701\\c.jpg']),
      createConfig({ renameMode: 'date', days: 2 }),
      api,
    )

    // 3 个 / 2 天 → 第 1 天 2 个、第 2 天 1 个
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\a.jpg',
      'D:\\out\\20260701\\b.jpg',
      'D:\\out\\20260702\\c.jpg',
    ])
  })

  it('非法起始日期时一条都不搬，并把原因写进 errors', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ startDate: '2026-07-01' }),
      api,
    )

    expect(result.success).toBe(0)
    expect(result.errors.some((error) => error.includes('起始日期'))).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('启用但没填起始日期时报错而不是静默跳过', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ startDate: '' }),
      api,
    )

    // 用户开了开关却什么都没发生是最难排查的情形，必须有可读原因
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('起始日期')
    expect(calls).toHaveLength(0)
  })

  it('shouldCancel 生效后立刻停下，已完成的不回退', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\1.jpg', 'D:\\out\\20260701\\2.jpg', 'D:\\out\\20260701\\3.jpg']),
      createConfig({ renameMode: 'date' }),
      api,
      { shouldCancel: () => calls.length >= 2 },
    )

    expect(calls).toHaveLength(2)
    expect(result.success).toBe(2)
    expect(result.canceled).toBe(true)
  })

  it('move 模式清理搬空的源目录，copy 模式不动源目录', async () => {
    const moved = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\folderA\\20260701\\a.jpg', 'D:\\out\\folderB\\20260701\\b.jpg']),
      createConfig({ mode: 'move', renameMode: 'date' }),
      moved.api,
    )
    expect(moved.removedDirs).toEqual(['D:\\out\\folderA\\20260701', 'D:\\out\\folderB\\20260701'])

    const copied = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\folderA\\20260701\\a.jpg']),
      createConfig({ mode: 'copy', renameMode: 'date' }),
      copied.api,
    )
    expect(copied.removedDirs).toEqual([])
  })

  it('modifyMd5 透传为 appendRandomByte，规避平台重复素材判定', async () => {
    const { api, calls } = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ renameMode: 'date', days: 1, modifyMd5: true }),
      api,
    )

    expect(calls[0]?.appendRandomByte).toBe(true)
  })

  it('分发到 targetDir 时先授权目标根，并保留相对结构', async () => {
    const { api, calls } = createMockApi()
    const authorize = vi.fn(async () => true)
    api.authorizeCompositeOutputDirectory = authorize

    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\保险\\月亮\\20260701\\a.jpg'], 'D:/out'),
      createConfig({ renameMode: 'date', days: 1, targetDir: 'D:\\dist' }),
      api,
    )

    // 分隔符混用（根用 /、路径用 \）时前缀匹配仍要成立
    expect(authorize).toHaveBeenCalledWith('D:\\dist\\保险\\月亮\\20260701')
    expect(result.success).toBe(1)
    expect(calls[0]?.targetPath).toBe('D:\\dist\\保险\\月亮\\20260701\\a.jpg')
  })

  it('targetDir 未授权时整组跳过并上报，不静默半途而废', async () => {
    const { api, calls } = createMockApi()
    api.authorizeCompositeOutputDirectory = async () => false

    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg'], 'D:\\out'),
      createConfig({ renameMode: 'date', days: 1, targetDir: 'relative\\dist' }),
      api,
    )

    expect(result.success).toBe(0)
    expect(result.errors.some((error) => error.includes('未授权'))).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('未配 targetDir 时在原地建日期子文件夹（相对结构不参与）', async () => {
    const { api, calls } = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\保险\\月亮\\a.jpg'], 'D:\\out'),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
    )

    expect(calls[0]?.targetPath).toBe('D:\\out\\保险\\月亮\\20260701\\a.jpg')
  })

  it('randomize 只打乱顺序，产出数量与目标天数分布不变', async () => {
    const { api, calls } = createMockApi()
    const paths = ['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg', 'D:\\out\\20260701\\c.jpg']
    const result = await runPostprocessDistribution(
      createItems(paths),
      createConfig({ renameMode: 'date', days: 3, randomize: true }),
      api,
    )

    expect(result.success).toBe(3)
    expect(new Set(calls.map((call) => call.sourcePath))).toEqual(new Set(paths))
  })

  it('未启用或没有产出时直接返回，不触碰磁盘', async () => {
    const { api, calls } = createMockApi()
    const disabled = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ enabled: false }),
      api,
    )
    const empty = await runPostprocessDistribution([], createConfig(), api)

    expect(disabled.success).toBe(0)
    expect(empty.success).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('单条失败只记 errors，不影响同批其它产出', async () => {
    const { api } = createMockApi()
    const original = api.distributeFile!
    let count = 0
    api.distributeFile = async (input) => {
      count += 1
      if (count === 2) return { success: false, error: '目标目录不存在' }
      return await original(input)
    }

    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
    )

    expect(result.success).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.moved).toHaveLength(1)
    expect(result.errors.some((error) => error.includes('目标目录不存在'))).toBe(true)
  })
})
