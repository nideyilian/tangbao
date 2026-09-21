import { describe, expect, it } from 'vitest'
import {
  applyPostprocessProgress,
  countPostprocessIssues,
  createPostprocessRun,
  finishPostprocessRun,
  formatPostprocessRunBadge,
  formatPostprocessRunProgress,
  getPostprocessRunPercent,
  resolvePostprocessRunStatus,
  summarizePostprocessRun,
} from './postprocessRun'
import { createPostprocessIssue } from './postprocessIssue'

function run(totalImages = 4) {
  return createPostprocessRun({ id: 'run-1', source: 'manual', totalImages, startedAt: 1000 })
}

describe('后处理运行记录', () => {
  it('刚建出来是进行中、准备阶段、零产出', () => {
    expect(run()).toMatchObject({
      id: 'run-1',
      source: 'manual',
      status: 'running',
      stage: 'prepare',
      totalImages: 4,
      completedImages: 0,
      producedFiles: 0,
      issues: [],
    })
  })

  it('进度补丁是绝对值，且不改原对象（store 靠引用变化触发重渲染）', () => {
    const first = run()
    const second = applyPostprocessProgress(first, { stage: 'write', completedImages: 1, imageUnits: 3 })
    const third = applyPostprocessProgress(second, { imageUnitsDone: 2, producedFiles: 5 })

    expect(first).toMatchObject({ stage: 'prepare', completedImages: 0, producedFiles: 0 })
    expect(second).toMatchObject({ stage: 'write', completedImages: 1, imageUnits: 3, imageUnitsDone: 0 })
    expect(third).toMatchObject({ stage: 'write', completedImages: 1, imageUnitsDone: 2, producedFiles: 5 })
    expect(third).not.toBe(second)
  })

  it('负数补丁被夹回 0（异常路径不会把计数算负）', () => {
    const next = applyPostprocessProgress(run(), { completedImages: -3, producedFiles: -1 })
    expect(next.completedImages).toBe(0)
    expect(next.producedFiles).toBe(0)
  })

  it('百分比以源图张数为分母，当前这张按单元数折算小数部分', () => {
    // 4 张图，第 2 张跑到 4 个单元里的 2 个 → (1 + 0.5) / 4 = 37.5% → 38%
    const next = applyPostprocessProgress(run(4), { completedImages: 1, imageUnits: 4, imageUnitsDone: 2 })
    expect(getPostprocessRunPercent(next)).toBe(38)
  })

  it('百分比不因分母未知/单元未解出而瞎跳，跑完钉在 100', () => {
    expect(getPostprocessRunPercent(run(0))).toBeUndefined()
    expect(getPostprocessRunPercent(run(4))).toBe(0)
    const finished = finishPostprocessRun(applyPostprocessProgress(run(4), { completedImages: 4 }), {
      issues: [],
      producedFiles: 6,
      finishedAt: 2000,
    })
    expect(getPostprocessRunPercent(finished)).toBe(100)
  })

  /**
   * 判定表（2026-09-21 报障：零产出 + 只有跳过曾被判成 `failed`，于是「这个方向关了自动后处理」
   * 这类**配置使然**的跳过被渲染成红色故障，而同一批图手动跑一次就产出了）。
   * 契约：**零产出那一档必须看 severity，不能只看条数。**
   */
  it('状态判定：跳过不是故障 —— 零产出也一样', () => {
    const skipped = createPostprocessIssue({ code: 'PP-SCOPE-001', stage: 'prepare' })
    const error = createPostprocessIssue({ code: 'PP-DIR-004', stage: 'write' })
    expect(resolvePostprocessRunStatus({ producedFiles: 3, issues: [skipped] })).toBe('succeeded')
    expect(resolvePostprocessRunStatus({ producedFiles: 3, issues: [skipped, error] })).toBe('partial')
    // 零产出：只有跳过 = 已跳过（不是失败）；有真错 = 失败；无记录 = 本次没有可做的事
    expect(resolvePostprocessRunStatus({ producedFiles: 0, issues: [skipped] })).toBe('skipped')
    expect(resolvePostprocessRunStatus({ producedFiles: 0, issues: [skipped, error] })).toBe('failed')
    expect(resolvePostprocessRunStatus({ producedFiles: 0, issues: [] })).toBe('succeeded')
  })

  it('收尾：写问题清单与产出数，清掉「当前产出」，记完成时间', () => {
    const error = createPostprocessIssue({ code: 'PP-WRITE-001', stage: 'write', file: 'a.jpg' })
    const finished = finishPostprocessRun(
      applyPostprocessProgress(run(4), {
        stage: 'distribute',
        completedImages: 3,
        imageUnits: 2,
        imageUnitsDone: 2,
        currentLabel: '头条 1080x1920',
      }),
      { issues: [error], producedFiles: 2, finishedAt: 9999 },
    )
    expect(finished).toMatchObject({
      status: 'partial',
      stage: 'finish',
      producedFiles: 2,
      completedImages: 4,
      imageUnits: 0,
      imageUnitsDone: 0,
      finishedAt: 9999,
    })
    expect(finished.currentLabel).toBeUndefined()
    expect(finished.issues).toHaveLength(1)
  })

  it('跳过与错误分开计数（界面要能说「跳过 3 项、错误 1 项」）', () => {
    const finished = finishPostprocessRun(run(2), {
      issues: [
        createPostprocessIssue({ code: 'PP-SRC-001', stage: 'prepare' }),
        createPostprocessIssue({ code: 'PP-SCOPE-001', stage: 'prepare' }),
        createPostprocessIssue({ code: 'PP-DIR-001', stage: 'write' }),
      ],
      producedFiles: 0,
    })
    expect(countPostprocessIssues(finished)).toEqual({ errors: 1, skipped: 2 })
  })

  it('一行结论按状态分档，且带上未完成条数', () => {
    const done = finishPostprocessRun(run(2), { issues: [], producedFiles: 4 })
    expect(summarizePostprocessRun(done)).toBe('后处理完成：产出 4 个文件')

    const partial = finishPostprocessRun(run(2), {
      issues: [createPostprocessIssue({ code: 'PP-WRITE-001', stage: 'write' })],
      producedFiles: 2,
    })
    expect(summarizePostprocessRun(partial)).toContain('产出 2 个文件')
    expect(summarizePostprocessRun(partial)).toContain('错误 1')

    const failed = finishPostprocessRun(run(2), {
      issues: [createPostprocessIssue({ code: 'PP-DIR-001', stage: 'write' })],
      producedFiles: 0,
    })
    expect(summarizePostprocessRun(failed)).toBe('后处理失败：没有产出文件（错误 1）')

    // 零产出但只有跳过：文案要说「被跳过」，不能说成失败（否则用户以为软件坏了）
    const skippedOnly = finishPostprocessRun(run(2), {
      issues: [createPostprocessIssue({ code: 'PP-SCOPE-002', stage: 'prepare' })],
      producedFiles: 0,
    })
    expect(summarizePostprocessRun(skippedOnly)).toBe('后处理没有产出：1 项被跳过')

    expect(summarizePostprocessRun(applyPostprocessProgress(run(4), { completedImages: 1 }))).toBe('后处理进行中：1/4')
  })

  it('进度文本 = 计数 + 百分比 + 当前产出，总数未知时不硬编分母', () => {
    const next = applyPostprocessProgress(run(4), {
      completedImages: 2,
      currentLabel: '头条 1080x1920 · a.jpg',
    })
    expect(formatPostprocessRunProgress(next)).toBe('2/4 50% · 头条 1080x1920 · a.jpg')
    expect(formatPostprocessRunProgress(createPostprocessRun({ id: 'x', source: 'auto', totalImages: 0 }))).toBe('')
  })

  /**
   * 紧凑进度是**工具栏专用口径**（2026-09-21 报障：工具栏被写盘文件名撑满）。
   * 契约只有一条：**它永远不含当前产出文件名** —— 那个字段可能几十个字符。
   */
  it('紧凑进度只给计数与百分比，绝不带上当前产出文件名', () => {
    const next = applyPostprocessProgress(run(4), {
      completedImages: 2,
      currentLabel: '纯净版 1280x720 · 20260921-快手-网赚-纯净版-陈泽杰-1280x720-1.jpg',
    })

    expect(formatPostprocessRunBadge(next)).toBe('2/4 50%')
    expect(formatPostprocessRunBadge(next)).not.toContain('陈泽杰')
    // 总数未知（分母为 0）→ 不给数字，界面据此显示一句「后处理中」而不是「0/0」
    expect(formatPostprocessRunBadge(createPostprocessRun({ id: 'x', source: 'auto', totalImages: 0 }))).toBeUndefined()
  })
})
