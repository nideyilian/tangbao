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
import PostprocessRunsDialog from './PostprocessRunsDialog'

const fixtures = vi.hoisted(() => ({ runs: [] as unknown[] }))
const spies = vi.hoisted(() => ({
  dismissPostprocessRun: vi.fn(),
  showPostprocessIssuesDialog: vi.fn(),
}))

vi.mock('../../stores/runtimeStore', () => ({
  usePostprocessRuns: () => fixtures.runs,
  useRuntimeStore: (selector: (value: { dismissPostprocessRun: () => void }) => unknown) =>
    selector({ dismissPostprocessRun: spies.dismissPostprocessRun }),
}))

vi.mock('../../store', () => ({
  showPostprocessIssuesDialog: spies.showPostprocessIssuesDialog,
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
    fixtures.runs = [
      run({ id: 'run-a', status: 'succeeded', producedFiles: 6, source: 'manual' }),
      run({
        id: 'run-b',
        status: 'failed',
        issues: [
          {
            code: 'PP-SCOPE-002',
            message: '所属方向关闭了自动后处理',
            hint: '线索',
            severity: 'skipped',
            stage: 'prepare',
          },
        ],
      }),
    ]
    const text = render()

    expect(text).toContain('成功')
    expect(text).toContain('后处理完成：产出 6 个文件')
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

    const clearButton = document.querySelector<HTMLButtonElement>('[aria-label="清空已完成的后处理记录"]')
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
})
