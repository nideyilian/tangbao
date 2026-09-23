/* @vitest-environment jsdom */

/**
 * 后处理进度面板的展示契约。
 *
 * 背景（2026-09-21 报障「真正的处理进度弹窗为什么没有实现，我要从哪里查看进度」）：
 * 进度原先只落在「素材库工具栏上的一行文本」，用户在画廊或中控台里看不到任何答复。
 * 这个面板是「跑到哪了 / 成了没 / 为什么没成」的查询落点。
 *
 * 面板挂在 Dialog 上（portal 到 body），所以断言走 `document.body.textContent`。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostprocessRun, PostprocessRunStatus } from './postprocessRun'
import { resolvePostprocessRunStatus } from './postprocessRun'
import PostprocessRunsDialog from './PostprocessRunsDialog'

const fixtures = vi.hoisted(() => ({ runs: [] as unknown[] }))
/** 方向历史（落盘那一份）的替身：面板下半段与上半段是两个数据源。 */
const historyFixtures = vi.hoisted(() => ({ byDirection: {} as Record<string, unknown[]> }))
const spies = vi.hoisted(() => ({
  dismissPostprocessRun: vi.fn(),
  showPostprocessIssuesDialog: vi.fn(),
  showToast: vi.fn(),
  cancelPostprocessDirection: vi.fn(),
}))

vi.mock('../../stores/runtimeStore', () => ({
  usePostprocessRuns: () => fixtures.runs,
  useRuntimeStore: (selector: (value: { dismissPostprocessRun: () => void }) => unknown) =>
    selector({ dismissPostprocessRun: spies.dismissPostprocessRun }),
}))

vi.mock('../../storePostprocessHistory', () => ({
  usePostprocessHistoryByDirection: () => historyFixtures.byDirection,
}))

vi.mock('./postprocessCancel', () => ({
  cancelPostprocessDirection: spies.cancelPostprocessDirection,
}))

vi.mock('../../store', () => ({
  showPostprocessIssuesDialog: spies.showPostprocessIssuesDialog,
  // 历史列表（TB-115）会在「打开输出位置」失败时用 showToast 给出可见原因，
  // 所以这个 mock 必须带上 `useStore` —— 少一个键就是整个面板在渲染时炸掉
  useStore: (selector: (value: { showToast: () => void }) => unknown) => selector({ showToast: spies.showToast }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = 1_758_000_000_000

function run(overrides: Partial<PostprocessRun> & { status: PostprocessRunStatus }): PostprocessRun {
  return {
    id: `run-${overrides.status}`,
    source: 'auto',
    stage: 'finish',
    totalImages: 0,
    completedImages: 0,
    imageUnits: 0,
    imageUnitsDone: 0,
    producedFiles: 0,
    issues: [],
    startedAt: NOW,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root = createRoot(container)
    root.render(<PostprocessRunsDialog open onClose={() => {}} />)
  })
  return document.body.textContent ?? ''
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  fixtures.runs = []
  historyFixtures.byDirection = {}
})

describe('后处理进度面板', () => {
  it('正在跑的那次给出计数与阶段，不只有一句「进行中」', () => {
    fixtures.runs = [run({ status: 'running', totalImages: 5, completedImages: 2, source: 'manual', stage: 'render' })]
    const text = render()

    expect(text).toContain('2/5')
    expect(text).toContain('手动触发')
    // 阶段名要出现：只写「进行中」回答不了「卡在哪一步」
    expect(text).toContain('渲染')
  })

  it('历次运行给出状态、来源与结论，问题入口按「跳过 / 出错」分别给名', () => {
    /**
     * 状态**由真判定函数算出来**，不在 fixture 里手写 —— 否则这条用例只测了「标签映射表」，
     * 测不到「跳过型问题 → 界面显示已跳过」这条真链路（2026-09-21 报障：
     * 零产出 + 只有跳过曾被判成「失败」，同一方向手动跑一次却产出成功）。
     */
    const skippedOnly: PostprocessRun['issues'] = [
      {
        code: 'PP-SCOPE-002',
        message: '所属方向关闭了自动后处理',
        hint: '线索',
        severity: 'skipped',
        stage: 'prepare',
      },
    ]
    fixtures.runs = [
      run({ id: 'run-a', status: 'succeeded', producedFiles: 6, source: 'manual' }),
      run({
        id: 'run-b',
        status: resolvePostprocessRunStatus({ producedFiles: 0, issues: skippedOnly }),
        issues: skippedOnly,
      }),
    ]
    const text = render()

    expect(text).toContain('成功')
    expect(text).toContain('后处理完成：产出 6 个文件')
    expect(text).toContain('已跳过')
    // 回归护栏：面板里「失败」二字只该属于真出错的那一档，这条记录一个错都没有
    expect(text).not.toContain('失败')
    expect(text).toContain('查看跳过 (1)')

    const skipButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === '查看跳过 (1)',
    )
    act(() => {
      skipButton?.click()
    })
    expect(spies.showPostprocessIssuesDialog).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ code: 'PP-SCOPE-002' })]),
    )
  })

  it('清空按钮把已结束的记录都交出去（进行中的不在列表里，天然清不到）', () => {
    fixtures.runs = [
      run({ id: 'run-running', status: 'running', totalImages: 1 }),
      run({ id: 'run-done-a', status: 'succeeded', producedFiles: 1 }),
      run({ id: 'run-done-b', status: 'failed' }),
    ]
    render()

    const clearButton = document.querySelector<HTMLButtonElement>('[aria-label="清空这些不分方向的结果"]')
    expect(clearButton).not.toBeNull()
    act(() => {
      clearButton?.click()
    })

    expect(spies.dismissPostprocessRun).toHaveBeenCalledTimes(2)
    expect(spies.dismissPostprocessRun).not.toHaveBeenCalledWith('run-running')
  })

  it('还没跑过时给空态说明，而不是一片空白', () => {
    fixtures.runs = []
    expect(render()).toContain('还没有跑过后处理')
  })

  /**
   * 耗时构成（2026-09-23）。
   *
   * 加它之前这条链**没有任何分阶段数据**：「慢在哪」只能靠两批产出记录的时间戳反推，
   * 而反推错过两次。所以这行字的作用不只是「好看」—— 它把三种成因分开摊给用户看：
   * 画得多是主线程问题（卡界面）、编码多说明体积上限压得紧、写盘多就是磁盘/共享盘慢。
   */
  it('⭐ 带耗时构成时：总耗时 + 三段拆分 + 编码轮数都显示出来', () => {
    fixtures.runs = [
      run({
        id: 'run-timing',
        status: 'succeeded',
        producedFiles: 20,
        finishedAt: NOW + 12_400,
        diagnostics: { paintMs: 400, encodeMs: 9800, encodeCount: 38, writeMs: 1100 },
      }),
    ]
    const text = render()

    expect(text).toContain('12.4s')
    expect(text).toContain('画 400ms')
    expect(text).toContain('编码 9.80s')
    // 轮数是「编码为什么贵」最直接的线索：正常应是 1 轮或 3 轮
    expect(text).toContain('38 轮')
    expect(text).toContain('写盘 1.10s')
  })

  it('没有耗时数据时整行不出现（不摆一串 0ms 出来误导人）', () => {
    fixtures.runs = [run({ id: 'run-no-timing', status: 'succeeded', producedFiles: 1 })]

    expect(render()).not.toContain('耗时')
  })

  /**
   * 方向历史（TB-115）：面板下半段是**落盘**的长期记录。
   *
   * 与上半段是两个数据源（内存的实时进度 / 落盘的历史），所以这组用另一份 fixture。
   */
  it('⭐ 历史记录按方向分组：方向名、源图数→产出数、「打开位置」入口都在', () => {
    historyFixtures.byDirection = {
      'direction-a': [
        {
          id: 'h1',
          directionId: 'direction-a',
          directionLabel: '产品线 / 产品 / 方向A',
          source: 'manual',
          startedAt: NOW,
          finishedAt: NOW + 3000,
          status: 'succeeded',
          totalImages: 2,
          producedFiles: 4,
          targetDirectionIds: ['direction-a'],
          outputDirs: ['D:\\交付\\A'],
          issues: [],
          issueCount: 0,
        },
      ],
    }
    const text = render()

    expect(text).toContain('历史记录（按方向，长期保留）')
    expect(text).toContain('产品线 / 产品 / 方向A')
    // 源图数与产出数并排：只看「产出 4 个」回答不了「本该是几个」
    expect(text).toContain('2 张 → 4 个文件')
    expect(text).toContain('打开位置')
  })

  it('历史为空时说明「跑过一次就有」，而不是留一片空白', () => {
    expect(render()).toContain('还没有历史记录')
  })

  /**
   * 取消按钮（TB-115）：**按方向**取消 —— 传出去的必须是这条 run 的方向 id。
   * 传错（或传空）会让用户点了取消却停掉别的方向，而界面上看不出发生过什么。
   */
  it('⭐ 在跑的方向给「取消」，且把该方向 id 传出去', () => {
    fixtures.runs = [
      run({
        id: 'run-running',
        status: 'running',
        totalImages: 3,
        directionId: 'direction-a',
        directionLabel: '方向A',
      }),
    ]
    render()

    const cancelButton = document.querySelector<HTMLButtonElement>('[data-testid="postprocess-cancel-run"]')
    expect(cancelButton).not.toBeNull()
    act(() => {
      cancelButton?.click()
    })
    expect(spies.cancelPostprocessDirection).toHaveBeenCalledWith('direction-a')
  })

  it('没有方向的批次级记录不给取消按钮（取消是按方向的动作）', () => {
    fixtures.runs = [run({ id: 'run-batch', status: 'running', totalImages: 1 })]
    render()

    expect(document.querySelector('[data-testid="postprocess-cancel-run"]')).toBeNull()
  })
})
