import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_POSTPROCESS_DISTRIBUTION,
  buildDistributionDates,
  isPostprocessDistributionActive,
  normalizePostprocessDistributionConfig,
  runPostprocessDistribution,
  toBaseDate,
  type PostprocessDistributionConfig,
  type PostprocessDistributionElectronApi,
  type PostprocessDistributionItem,
} from './postprocessDistribution'

/** 排期起算日固定，用例才可复现（生产里由调用方按产出当天给，见 `toBaseDate`）。 */
const BASE_DATE = '20260701'

function createConfig(overrides: Partial<PostprocessDistributionConfig> = {}): PostprocessDistributionConfig {
  return {
    ...DEFAULT_POSTPROCESS_DISTRIBUTION,
    enabled: true,
    days: 3,
    renameMode: 'date',
    ...overrides,
  }
}

function createOptions(overrides: { baseDate?: string; shouldCancel?: () => boolean } = {}): {
  baseDate: string
  shouldCancel?: () => boolean
} {
  return { baseDate: BASE_DATE, ...overrides }
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
  it('只看开关与天数；日期不再参与判定（起算日由程序取）', () => {
    expect(isPostprocessDistributionActive(createConfig())).toBe(true)
    expect(isPostprocessDistributionActive(createConfig({ enabled: false }))).toBe(false)
    expect(isPostprocessDistributionActive(createConfig({ days: 0 }))).toBe(false)
  })
})

describe('toBaseDate', () => {
  it('按本地时区格式化成 YYYYMMDD', () => {
    expect(toBaseDate(new Date(2026, 6, 1, 12, 0, 0).getTime())).toBe('20260701')
    expect(toBaseDate(new Date(2026, 11, 31, 23, 59, 59).getTime())).toBe('20261231')
  })

  it('非法值回退执行当天，不抛错', () => {
    expect(toBaseDate(undefined)).toMatch(/^\d{8}$/)
    expect(toBaseDate(Number.NaN)).toMatch(/^\d{8}$/)
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

  it('跳过周末不会少给天数（天数给够，只是日期不连续）', () => {
    // 周五起算 5 天 → 跨过周末，最后落在下周四
    expect(buildDistributionDates('20260703', 5, true)).toEqual([
      '20260703',
      '20260706',
      '20260707',
      '20260708',
      '20260709',
    ])
  })

  it('非法起算日或天数返回空数组（起算日由程序算，走到这里即内部缺陷）', () => {
    expect(buildDistributionDates('', 3, false)).toEqual([])
    expect(buildDistributionDates('2026-07-01', 3, false)).toEqual([])
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

  it('旧数据里的 startDate 被丢弃（起算日改为程序按产出当天取）', () => {
    const config = normalizePostprocessDistributionConfig({ enabled: true, startDate: '20260901', days: 5 })
    expect(config.days).toBe(5)
    expect(config.enabled).toBe(true)
    expect('startDate' in config).toBe(false)
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
      createOptions(),
    )

    expect(result.success).toBe(2)
    expect(result.canceled).toBe(false)
    // 后缀用「-」与 `taskPostprocess.resolveUniquePath` 保持一致：同一条链路上的重名兜底应该长得一样
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\20260701\\img_20260701.jpg',
      'D:\\out\\20260701\\20260701\\img_20260701-2.jpg',
    ])
  })

  it('目标已存在时继续试探 -2 之后的后缀', async () => {
    const { api, calls } = createMockApi(['D:\\out\\20260701\\20260701\\img_20260701.jpg'])
    await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\img_20260601.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
      createOptions(),
    )

    expect(calls[0]?.targetPath).toBe('D:\\out\\20260701\\20260701\\img_20260701-2.jpg')
  })

  it('sequence 模式按日期文件夹名 + 序号重排', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\x.jpg', 'D:\\out\\20260701\\y.jpg', 'D:\\out\\20260701\\z.jpg']),
      createConfig({ renameMode: 'sequence', days: 3 }),
      api,
      createOptions(),
    )

    expect(result.success).toBe(3)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\20260701\\20260701_01.jpg',
      'D:\\out\\20260701\\20260702\\20260702_01.jpg',
      'D:\\out\\20260701\\20260703\\20260703_01.jpg',
    ])
  })

  it('日期段判定不受下划线影响（`\\b` 会在 `_2` 前失效，故不能用）', async () => {
    const { api, calls } = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\img_20260601.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
      createOptions(),
    )

    // 文件名里的日期段被替换成分发日期
    expect(calls[0]?.targetPath).toBe('D:\\out\\20260701\\img_20260701.jpg')
  })

  it('⭐ 原地恒定建日期子文件夹，不再替换目录名里的日期段', async () => {
    const { api, calls } = createMockApi()
    // 目录名里的日期来自命名模板 `{date}`（产出日），不是排期日。
    // 旧实现会把它替换掉 ⇒ 日期子文件夹永远不出现；这里锁住「目录名原样不动 + 下面多一层日期」。
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
      createOptions(),
    )

    expect(result.success).toBe(5)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\20260701\\a.jpg',
      'D:\\out\\20260701\\20260702\\b.jpg',
      'D:\\out\\20260701\\20260703\\c.jpg',
      'D:\\out\\20260701\\20260704\\d.jpg',
      'D:\\out\\20260701\\20260705\\e.jpg',
    ])
  })

  it('⭐ 起算日等于产出当天时，目标目录是日期子文件夹而不是文件自己（自我复制回归）', async () => {
    const { api, calls } = createMockApi()
    // 线上实踩：旧实现下 baseDir 含日期段 ⇒ 替换成本身 ⇒ 目标 == 源 ⇒ 每个文件与
    // **自己**撞名 ⇒ 整目录凭空多出一份 `-2` 副本（`a-2.jpg`）。
    await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ renameMode: 'date', days: 1 }),
      api,
      createOptions({ baseDate: '20260701' }),
    )

    expect(calls[0]?.targetPath).toBe('D:\\out\\20260701\\20260701\\a.jpg')
  })

  it('余数分给前几天，保证总数不多不少', async () => {
    const { api, calls } = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg', 'D:\\out\\20260701\\c.jpg']),
      createConfig({ renameMode: 'date', days: 2 }),
      api,
      createOptions(),
    )

    // 3 个 / 2 天 → 第 1 天 2 个、第 2 天 1 个
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\20260701\\a.jpg',
      'D:\\out\\20260701\\20260701\\b.jpg',
      'D:\\out\\20260701\\20260702\\c.jpg',
    ])
  })

  it('天数多于文件数时不硬凑：前 N 天各 1 个，其余天为空', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg']),
      createConfig({ renameMode: 'date', days: 5 }),
      api,
      createOptions(),
    )

    expect(result.success).toBe(2)
    expect(calls.map((call) => call.targetPath)).toEqual([
      'D:\\out\\20260701\\20260701\\a.jpg',
      'D:\\out\\20260701\\20260702\\b.jpg',
    ])
  })

  it('起算日非法时一条都不搬，并把原因写进 errors', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig(),
      api,
      createOptions({ baseDate: '2026-07-01' }),
    )

    expect(result.success).toBe(0)
    expect(result.errors.some((error) => error.includes('起算日'))).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('shouldCancel 生效后立刻停下，已完成的不回退', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\1.jpg', 'D:\\out\\20260701\\2.jpg', 'D:\\out\\20260701\\3.jpg']),
      createConfig({ renameMode: 'date' }),
      api,
      createOptions({ shouldCancel: () => calls.length >= 2 }),
    )

    expect(calls).toHaveLength(2)
    expect(result.success).toBe(2)
    expect(result.canceled).toBe(true)
  })

  it('move 模式清理搬空的源目录，copy 模式不动源目录', async () => {
    const moved = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\folderA\\a.jpg', 'D:\\out\\folderB\\b.jpg']),
      createConfig({ mode: 'move', renameMode: 'date', days: 1 }),
      moved.api,
      createOptions(),
    )
    expect(moved.removedDirs).toEqual(['D:\\out\\folderA', 'D:\\out\\folderB'])

    const copied = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\folderA\\a.jpg']),
      createConfig({ mode: 'copy', renameMode: 'date', days: 1 }),
      copied.api,
      createOptions(),
    )
    expect(copied.removedDirs).toEqual([])
  })

  it('modifyMd5 透传为 appendRandomByte，规避平台重复素材判定', async () => {
    const { api, calls } = createMockApi()
    await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ renameMode: 'date', days: 1, modifyMd5: true }),
      api,
      createOptions(),
    )

    expect(calls[0]?.appendRandomByte).toBe(true)
  })

  it('分发到 targetDir 时先授权目标根，并保留相对结构', async () => {
    const { api, calls } = createMockApi()
    const authorize = vi.fn(async () => true)
    api.authorizeCompositeOutputDirectory = authorize

    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\保险\\月亮\\a.jpg'], 'D:/out'),
      createConfig({ renameMode: 'date', days: 1, targetDir: 'D:\\dist' }),
      api,
      createOptions(),
    )

    // 分隔符混用（根用 /、路径用 \）时前缀匹配仍要成立；授权的是「相对结构那一层」
    expect(authorize).toHaveBeenCalledWith('D:\\dist\\保险\\月亮')
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
      createOptions(),
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
      createOptions(),
    )

    expect(calls[0]?.targetPath).toBe('D:\\out\\保险\\月亮\\20260701\\a.jpg')
  })

  it('⭐ 打乱按素材洗牌：同一张图在各渠道目录里落在同一天', async () => {
    const { api, calls } = createMockApi()
    // 同一批素材导出到两个渠道目录，每个目录里各有一份（这是线上的实际形态）
    const items: PostprocessDistributionItem[] = [
      { path: 'D:\\out\\gdt\\s1-gdt.jpg', sourceKey: 's1' },
      { path: 'D:\\out\\gdt\\s2-gdt.jpg', sourceKey: 's2' },
      { path: 'D:\\out\\gdt\\s3-gdt.jpg', sourceKey: 's3' },
      { path: 'D:\\out\\toutiao\\s1-tt.jpg', sourceKey: 's1' },
      { path: 'D:\\out\\toutiao\\s2-tt.jpg', sourceKey: 's2' },
      { path: 'D:\\out\\toutiao\\s3-tt.jpg', sourceKey: 's3' },
    ]

    const result = await runPostprocessDistribution(
      items,
      createConfig({ renameMode: 'sequence', days: 3, randomize: true }),
      api,
      createOptions(),
    )

    expect(result.success).toBe(6)
    // 按目录（日期）聚合，看每个日期文件夹里收的是哪些素材
    const byDate = new Map<string, string[]>()
    for (const call of calls) {
      const date = call.targetPath.split('\\').slice(-2)[0]
      const list = byDate.get(date) ?? []
      list.push(call.sourcePath)
      byDate.set(date, list)
    }
    expect(byDate.size).toBe(3)
    for (const [, paths] of byDate) {
      // 同上一条日期里，两个渠道拿到的**素材**必须一致 ⇒ 同一张素材跨渠道同期。
      // 比的是素材名（渠道目录前缀本来就不一样），不是整条路径。
      const stem = (p: string) => (p.split('\\').pop() ?? '').replace(/-(?:gdt|tt)\.jpg$/, '')
      const gdt = paths
        .filter((p) => p.includes('gdt'))
        .map(stem)
        .sort()
      const tt = paths
        .filter((p) => p.includes('toutiao'))
        .map(stem)
        .sort()
      expect(gdt).toHaveLength(1)
      expect(gdt).toEqual(tt)
    }
  })

  it('打乱不改产出数量与天数分布', async () => {
    const { api, calls } = createMockApi()
    const paths = ['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg', 'D:\\out\\20260701\\c.jpg']
    const result = await runPostprocessDistribution(
      createItems(paths),
      createConfig({ renameMode: 'date', days: 3, randomize: true }),
      api,
      createOptions(),
    )

    expect(result.success).toBe(3)
    expect(new Set(calls.map((call) => call.sourcePath))).toEqual(new Set(paths))
  })

  it('没给 sourceKey 时回退按文件洗牌，不影响分法', async () => {
    const { api, calls } = createMockApi()
    const result = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg', 'D:\\out\\20260701\\b.jpg']),
      createConfig({ renameMode: 'date', days: 2, randomize: true }),
      api,
      createOptions(),
    )

    expect(result.success).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('未启用或没有产出时直接返回，不触碰磁盘', async () => {
    const { api, calls } = createMockApi()
    const disabled = await runPostprocessDistribution(
      createItems(['D:\\out\\20260701\\a.jpg']),
      createConfig({ enabled: false }),
      api,
      createOptions(),
    )
    const empty = await runPostprocessDistribution([], createConfig(), api, createOptions())

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
      createOptions(),
    )

    expect(result.success).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.moved).toHaveLength(1)
    expect(result.errors.some((error) => error.includes('目标目录不存在'))).toBe(true)
  })
})
