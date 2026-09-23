/**
 * 方向级历史记录的纯逻辑契约（TB-115）。
 *
 * 这一组守的是「长期留档」的三条底线：
 * - **按方向分桶**且每桶有上限：产出是「每个任务完成就跑一次」的高频行为，不限量会无限增长；
 * - **截断但不谎报**：问题条数被截断时 `issueCount` 仍须是真总数 —— 否则用户以为这次只出了
 *   10 个问题，而真相是 200 个（这类「显示少于实际」是最难自查的一种）；
 * - **归一化不整份回退**：坏条目逐条丢，保住用户其余历史（与 `normalizePostprocessMediaConfig`
 *   同一条口径）。
 */

import { describe, expect, it } from 'vitest'
import { createPostprocessIssue } from './postprocessIssue'
import type { PostprocessRun } from './postprocessRun'
import {
  POSTPROCESS_HISTORY_ISSUE_LIMIT,
  POSTPROCESS_HISTORY_OUTPUT_DIR_LIMIT,
  POSTPROCESS_HISTORY_PER_DIRECTION,
  appendHistoryEntry,
  clearHistoryForDirection,
  collectHistoryOutputDirs,
  compactHistoryIssues,
  createHistoryEntryFromRun,
  expandHistoryIssue,
  listHistoryDirectionIds,
  listHistoryForDirection,
  normalizePostprocessHistory,
} from './postprocessHistory'

const NOW = 1_758_000_000_000

function run(overrides: Partial<PostprocessRun> = {}): PostprocessRun {
  return {
    id: 'run-1',
    source: 'auto',
    directionId: 'direction-a',
    directionLabel: '产品线 / 产品 / 方向A',
    status: 'succeeded',
    stage: 'finish',
    totalImages: 3,
    completedImages: 3,
    imageUnits: 0,
    imageUnitsDone: 0,
    producedFiles: 12,
    issues: [],
    startedAt: NOW,
    finishedAt: NOW + 10_000,
    ...overrides,
  }
}

describe('createHistoryEntryFromRun', () => {
  it('⭐ 没有方向 id 的批次级记录不进方向历史（否则「这个方向出了问题」会变成假话）', () => {
    const batchRun = run({ directionId: undefined, directionLabel: '全部方向（分发）' })

    expect(createHistoryEntryFromRun(batchRun, { id: 'h1' })).toBeNull()
  })

  it('方向名 / 产出目标 / 输出目录都是**快照**，不依赖当前配置', () => {
    const entry = createHistoryEntryFromRun(run(), {
      id: 'h1',
      targetDirectionIds: ['direction-a', 'direction-b'],
      outputDirs: ['D:\\交付\\A', '\\\\NAS\\共享\\A'],
    })

    expect(entry?.directionLabel).toBe('产品线 / 产品 / 方向A')
    expect(entry?.targetDirectionIds).toEqual(['direction-a', 'direction-b'])
    expect(entry?.outputDirs).toEqual(['D:\\交付\\A', '\\\\NAS\\共享\\A'])
  })

  it('没给产出目标时退回「就是它自己」（自动触发的情形）', () => {
    const entry = createHistoryEntryFromRun(run(), { id: 'h1' })
    expect(entry?.targetDirectionIds).toEqual(['direction-a'])
  })

  it('输出目录去重（Windows 路径不区分大小写）、保序、有上限', () => {
    const dirs = ['D:\\A', 'd:\\a', ...Array.from({ length: 12 }, (_, index) => `D:\\B${index}`)]
    const entry = createHistoryEntryFromRun(run(), { id: 'h1', outputDirs: dirs })

    // 'd:\a' 与 'D:\A' 是同一个目录，不该各占一格
    expect(entry?.outputDirs[0]).toBe('D:\\A')
    expect(entry?.outputDirs.filter((dir) => dir.toLowerCase() === 'd:\\a')).toHaveLength(1)
    expect(entry?.outputDirs).toHaveLength(POSTPROCESS_HISTORY_OUTPUT_DIR_LIMIT)
  })
})

describe('compactHistoryIssues / expandHistoryIssue', () => {
  it('问题条数截断，但 issueCount 仍是**真总数**（不谎报）', () => {
    const issues = Array.from({ length: POSTPROCESS_HISTORY_ISSUE_LIMIT + 5 }, (_, index) =>
      createPostprocessIssue({ code: 'PP-WRITE-001', stage: 'write', file: `f${index}.jpg` }),
    )

    const compact = compactHistoryIssues(issues)

    expect(compact.issues).toHaveLength(POSTPROCESS_HISTORY_ISSUE_LIMIT)
    expect(compact.issueCount).toBe(issues.length)
  })

  it('只存上下文、不存文案 —— 读回来时文案由码表补上（唯一真相源仍在码表）', () => {
    const [stored] = compactHistoryIssues([
      createPostprocessIssue({ code: 'PP-DIR-004', stage: 'write', dir: 'D:\\输出', file: 'a.jpg' }),
    ]).issues

    // 落盘的紧凑形式里没有 message / hint / severity 这三个由码决定的字段
    expect(stored).not.toHaveProperty('message')
    expect(stored).not.toHaveProperty('hint')
    expect(stored).not.toHaveProperty('severity')

    const expanded = expandHistoryIssue(stored)
    expect(expanded.message).toBe('输出子目录创建失败')
    expect(expanded.severity).toBe('error')
    expect(expanded.dir).toBe('D:\\输出')
  })

  it('过长的原始错误被截断（不截断会把记录撑大几十倍）', () => {
    const [stored] = compactHistoryIssues([
      createPostprocessIssue({ code: 'PP-CRASH-001', stage: 'prepare', cause: 'x'.repeat(1000) }),
    ]).issues

    expect(stored.cause!.length).toBe(200)
  })
})

describe('appendHistoryEntry：按方向累积', () => {
  it('最新在前；同一个 id 重复追加是替换而不是并存', () => {
    const first = appendHistoryEntry({ byDirection: {} }, { ...entryOf('h1', 100) })
    const second = appendHistoryEntry(first, entryOf('h2', 200))
    const replaced = appendHistoryEntry(second, entryOf('h1', 300))

    expect(listHistoryForDirection(replaced, 'direction-a').map((item) => item.id)).toEqual(['h1', 'h2'])
    expect(listHistoryForDirection(replaced, 'direction-a')[0].startedAt).toBe(300)
  })

  it('每个方向最多留 50 条，超出丢最老的', () => {
    let state = { byDirection: {} }
    for (let index = 0; index < POSTPROCESS_HISTORY_PER_DIRECTION + 3; index += 1) {
      state = appendHistoryEntry(state, entryOf(`h${index}`, NOW + index))
    }

    const entries = listHistoryForDirection(state, 'direction-a')
    expect(entries).toHaveLength(POSTPROCESS_HISTORY_PER_DIRECTION)
    expect(entries[0].id).toBe(`h${POSTPROCESS_HISTORY_PER_DIRECTION + 2}`)
    // 最早那三条被挤掉
    expect(entries.some((item) => item.id === 'h0')).toBe(false)
  })

  it('方向之间互不干扰：一个方向满了不影响另一个方向', () => {
    let state = { byDirection: {} }
    for (let index = 0; index < POSTPROCESS_HISTORY_PER_DIRECTION + 3; index += 1) {
      state = appendHistoryEntry(state, { ...entryOf(`a${index}`, NOW + index) })
    }
    state = appendHistoryEntry(state, { ...entryOf('b0', NOW), directionId: 'direction-b' })

    expect(listHistoryForDirection(state, 'direction-b')).toHaveLength(1)
    expect(listHistoryDirectionIds(state)).toHaveLength(2)
  })

  it('清空某个方向：只动它，别的方向留着', () => {
    let state = appendHistoryEntry({ byDirection: {} }, entryOf('a0', NOW))
    state = appendHistoryEntry(state, { ...entryOf('b0', NOW), directionId: 'direction-b' })

    const cleared = clearHistoryForDirection(state, 'direction-a')
    expect(listHistoryForDirection(cleared, 'direction-a')).toHaveLength(0)
    expect(listHistoryForDirection(cleared, 'direction-b')).toHaveLength(1)
    // 清一个不存在的方向：引用不变（避免无谓的重渲染）
    expect(clearHistoryForDirection(cleared, 'direction-missing')).toBe(cleared)
  })
})

describe('collectHistoryOutputDirs：启动时重新放行用', () => {
  it('跨方向去重（大小写不敏感）并保序 —— 这是重启后「打开输出位置」还能用的依据', () => {
    let state = appendHistoryEntry(
      { byDirection: {} },
      { ...entryOf('a0', NOW), outputDirs: ['D:\\交付\\A', '\\\\NAS\\共享\\A'] },
    )
    state = appendHistoryEntry(state, {
      ...entryOf('b0', NOW),
      directionId: 'direction-b',
      outputDirs: ['d:\\交付\\a', 'D:\\交付\\B'],
    })

    expect(collectHistoryOutputDirs(state)).toEqual(['D:\\交付\\A', '\\\\NAS\\共享\\A', 'D:\\交付\\B'])
  })
})

describe('normalizePostprocessHistory：坏数据逐条丢，不整份回退', () => {
  it('丢弃缺 id / 缺时间 / 状态或来源非法的条目，其余原样留下', () => {
    const normalized = normalizePostprocessHistory({
      byDirection: {
        'direction-a': [
          { ...entryOf('good', NOW) },
          { ...entryOf('', NOW) },
          { ...entryOf('bad-status', NOW), status: 'flying' },
          { ...entryOf('bad-source', NOW), source: 'robot' },
          { ...entryOf('bad-time', NOW), startedAt: 0 },
        ],
      },
    })

    expect(listHistoryForDirection(normalized, 'direction-a').map((item) => item.id)).toEqual(['good'])
  })

  it('桶键以**外层键**为准：内层字段与桶不一致时，以「它在哪个桶里」为真', () => {
    const normalized = normalizePostprocessHistory({
      byDirection: { 'direction-a': [{ ...entryOf('h1', NOW), directionId: 'direction-other' }] },
    })

    expect(listHistoryForDirection(normalized, 'direction-a')[0].directionId).toBe('direction-a')
  })

  it('重排成「最新在前」并截断到上限（备份恢复 / 手工编辑过的数据不保证顺序）', () => {
    const entries = Array.from({ length: POSTPROCESS_HISTORY_PER_DIRECTION + 2 }, (_, index) =>
      // 故意**倒着**放：最老的排在最前
      entryOf(`h${index}`, NOW + index),
    )
    const normalized = normalizePostprocessHistory({ byDirection: { 'direction-a': entries } })

    const list = listHistoryForDirection(normalized, 'direction-a')
    expect(list).toHaveLength(POSTPROCESS_HISTORY_PER_DIRECTION)
    expect(list[0].startedAt).toBeGreaterThan(list[1].startedAt)
    expect(list.every((item, index) => index === 0 || list[index - 1].startedAt >= item.startedAt)).toBe(true)
  })

  it('整个入参不合法 → 空状态（不是抛错）', () => {
    expect(normalizePostprocessHistory(null)).toEqual({ byDirection: {} })
    expect(normalizePostprocessHistory({ byDirection: 'nope' })).toEqual({ byDirection: {} })
  })
})

function entryOf(id: string, startedAt: number) {
  return {
    id,
    directionId: 'direction-a',
    directionLabel: '产品线 / 产品 / 方向A',
    source: 'manual' as const,
    startedAt,
    finishedAt: startedAt + 1000,
    status: 'succeeded' as const,
    totalImages: 2,
    producedFiles: 4,
    targetDirectionIds: ['direction-a'],
    outputDirs: ['D:\\交付\\A'],
    issues: [],
    issueCount: 0,
  }
}
