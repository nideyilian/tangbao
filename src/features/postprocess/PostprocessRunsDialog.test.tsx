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
/**
 * 素材库作用域的替身：面板靠它决定「当前方向」是哪个、要不要渲染标签条。
 *
 * 默认 `all`（不指向具体文件夹）—— 那时面板只有一页，与本组件分页之前的行为一致，
 * 于是「只关心三段内容」的那些用例不必逐个改造。
 */
const scopeFixtures = vi.hoisted(() => ({
  scope: 'all' as unknown,
  collections: [] as unknown[],
}))
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

/**
 * 素材库 store 的替身。
 *
 * ⚠️ 必须 mock：面板现在会订阅 `scope` / `collections` 算「当前方向」——
 * 真身是带 persist 的 zustand store，在 jsdom 里跑真身既慢又会引入与本面板无关的状态。
 * mock 路径 `../assetLibrary/store` 与组件里的 import 解析到同一个模块（都从 postprocess 出发）。
 */
vi.mock('../assetLibrary/store', () => ({
  useAssetLibraryStore: (selector: (value: unknown) => unknown) =>
    selector({ scope: scopeFixtures.scope, collections: scopeFixtures.collections }),
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

/** 一条方向历史的缺省形状；各用例只覆盖自己关心的那几项。 */
function entry(overrides: Record<string, unknown>) {
  return {
    source: 'auto',
    startedAt: NOW,
    finishedAt: NOW + 1000,
    status: 'succeeded',
    totalImages: 1,
    producedFiles: 2,
    targetDirectionIds: [],
    outputDirs: [],
    issues: [],
    issueCount: 0,
    ...overrides,
  }
}

/** 「在素材库某个方向里打开」——面板的默认停靠页、标签条、空态都由它决定。 */
function enterDirection(directionId: string, name: string, parents: Array<{ id: string; name: string }> = []) {
  scopeFixtures.scope = { kind: 'collection', id: directionId }
  scopeFixtures.collections = [
    ...parents.map((parent, index) => ({ ...parent, parentId: index === 0 ? null : parents[index - 1].id })),
    { id: directionId, name, parentId: parents.length > 0 ? parents[parents.length - 1].id : null },
  ]
}

function tabButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
}

function clickTab(index: number) {
  act(() => tabButtons()[index]?.click())
}

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
  scopeFixtures.scope = 'all'
  scopeFixtures.collections = []
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
    // 有在跑的、盘上还没有历史 —— 这时历史列表自己给空态说明（两个数据源各自表达）
    fixtures.runs = [run({ id: 'run-running', status: 'running', totalImages: 1, directionId: 'd1' })]

    expect(render()).toContain('还没有历史记录')
  })

  /**
   * 一次都没跑过时的空态收敛（2026-09-24）。
   *
   * 分页之前这里是**两个空态叠着**：「还没有跑过后处理」（上半段）+「还没有历史记录」（下半段），
   * 同一屏两句话说的是同一件事。收敛成一个之后，「空」只出现一次。
   */
  it('一次都没跑过时只有一个空态，不叠两句同义的话', () => {
    const text = render()

    expect(text).toContain('还没有跑过后处理')
    expect(text).not.toContain('还没有历史记录')
  })

  /**
   * 重启后不说谎（2026-09-24）。
   *
   * 内存态的 run 重启即失、落盘的历史还在 —— 空态若只看内存那一份，就会出现
   * 「还没有跑过后处理」与下面一列历史记录同屏，用户看到的是自相矛盾的一句话。
   */
  it('⭐ 重启后（内存空、盘上有历史）不说「还没有跑过后处理」', () => {
    fixtures.runs = []
    historyFixtures.byDirection = {
      'direction-a': [entry({ id: 'h1', directionId: 'direction-a', directionLabel: '产品线 / 产品 / 月亮' })],
    }

    const text = render()

    expect(text).not.toContain('还没有跑过后处理')
    expect(text).toContain('产品线 / 产品 / 月亮')
  })

  /**
   * 分页（2026-09-24 杰哥定）：从哪个方向打开，默认就停在哪一页。
   *
   * 这是面板第一个「按素材库上下文」的行为 —— 判据与产出目标弹窗的 `scopeFolderId` 同源。
   */
  it('⭐ 从某个方向打开时默认停在它的标签页，只看它的记录', () => {
    enterDirection('direction-a', '月亮', [
      { id: 'line', name: '产品线' },
      { id: 'product', name: '产品' },
    ])
    historyFixtures.byDirection = {
      'direction-a': [entry({ id: 'h-a', directionId: 'direction-a', directionLabel: '产品线 / 产品 / 月亮' })],
      'direction-b': [entry({ id: 'h-b', directionId: 'direction-b', directionLabel: '产品线 / 产品 / 太阳' })],
    }
    render()

    // 标签放末段名（全路径塞不进标签条），全路径挂在 title 上
    const tabs = tabButtons()
    expect(tabs[0].textContent).toBe('月亮')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].textContent).toContain('全部方向')

    const text = document.body.textContent ?? ''
    expect(text).toContain('产品线 / 产品 / 月亮')
    // 别的方向即使有记录也不该出现在这一页
    expect(text).not.toContain('太阳')

    clickTab(1)
    expect(document.body.textContent).toContain('太阳')
  })

  it('素材库没停在具体文件夹时不渲染标签条（只有一页可看，摆个单项标签没意义）', () => {
    scopeFixtures.scope = 'all'
    historyFixtures.byDirection = {
      'direction-a': [entry({ id: 'h1', directionId: 'direction-a', directionLabel: '月亮' })],
    }
    render()

    expect(tabButtons()).toHaveLength(0)
    expect(document.body.textContent).toContain('历史记录（按方向，长期保留）')
  })

  /**
   * 在飞的跟着标签页走（杰哥 2026-09-24 明确要的：**不**常驻在两页之上）。
   *
   * 代价是明确的 —— 切到当前方向页就看不见别的方向在跑，要看全貌得切到「全部方向」。
   */
  it('⭐ 正在跑的跟着标签页过滤：当前方向页只看得见这个方向的进度', () => {
    enterDirection('direction-a', '月亮')
    fixtures.runs = [
      run({ id: 'run-a', status: 'running', totalImages: 3, directionId: 'direction-a', directionLabel: '月亮' }),
      run({ id: 'run-b', status: 'running', totalImages: 3, directionId: 'direction-b', directionLabel: '太阳' }),
    ]
    render()

    const blocks = document.querySelectorAll('[data-testid="postprocess-active-run"]')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].textContent).toContain('月亮')
    expect(document.body.textContent).not.toContain('太阳')

    clickTab(1)
    expect(document.querySelectorAll('[data-testid="postprocess-active-run"]')).toHaveLength(2)
  })

  it('没有方向的批次级结果只在「全部方向」页出现（当前方向页里它无处归属）', () => {
    enterDirection('direction-a', '月亮')
    fixtures.runs = [run({ id: 'run-batch', status: 'failed' })]
    render()

    expect(document.body.textContent).not.toContain('不属于某个方向的结果')

    clickTab(1)
    expect(document.body.textContent).toContain('不属于某个方向的结果')
  })

  it('当前方向没有任何记录时，空态说的是这个方向，而不用全局那句', () => {
    enterDirection('direction-a', '月亮')
    historyFixtures.byDirection = {
      'direction-b': [entry({ id: 'h-b', directionId: 'direction-b', directionLabel: '太阳' })],
    }

    const text = render()

    expect(text).toContain('这个方向还没有产出记录')
    expect(text).not.toContain('还没有跑过后处理')
    // 全局页仍有别的方向的记录 —— 空只空在当前页
    clickTab(1)
    expect(document.body.textContent).toContain('太阳')
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
