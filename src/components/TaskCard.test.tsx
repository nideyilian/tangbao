/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { createPostprocessIssue } from '../features/postprocess/postprocessIssue'
import TaskCard from './TaskCard'

const storeMocks = vi.hoisted(() => {
  const state = {
    toggleTaskSelection: vi.fn(),
    settings: { alwaysShowRetryButton: false },
    openFavoritePicker: vi.fn(),
    setConfirmDialog: vi.fn(),
  }
  const useStore = Object.assign(
    vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
    { getState: vi.fn(() => state) },
  )

  return {
    useStore,
    ensureImageCached: vi.fn(),
    resolveImageDisplaySrc: vi.fn(),
    ensureImageThumbnailCached: vi.fn(),
    subscribeImageThumbnail: vi.fn(() => () => {}),
    retryTask: vi.fn(),
    removeMultipleTasks: vi.fn(),
    updateTaskPrompt: vi.fn(),
    // ⚠️ 手工 mock 的工厂必须与 `../store` 的导出同步（R-75）：少一个就报
    // `No "X" export is defined on the "../store" mock`，而堆栈指着的却是 TaskCard
    showPostprocessIssuesDialog: vi.fn(),
  }
})

vi.mock('../store', () => storeMocks)
/**
 * 后处理运行记录由用例按需注入（默认空 = 没有记录、不渲染徽章）。
 *
 * 三个 ref 对应卡片用到的三处查询（R-75：手工 mock 的工厂必须与真实导出同步）：
 * 代表 run、在飞方向数、最近一批已落定方向的问题清单。
 */
const postprocessRunRef = vi.hoisted(() => ({ current: undefined as unknown }))
const postprocessInflightRef = vi.hoisted(() => ({ current: 0 }))
const postprocessIssuesRef = vi.hoisted(() => ({ current: [] as unknown[] }))
vi.mock('../stores/runtimeStore', () => ({
  useRuntimeStore: (selector: (value: { streamPreviews: Record<string, string> }) => unknown) =>
    selector({ streamPreviews: {} }),
  useLatestPostprocessRunForTask: () => postprocessRunRef.current,
  useTaskPostprocessInflightCount: () => postprocessInflightRef.current,
  useTaskPostprocessIssueCount: () => postprocessIssuesRef.current.length,
  getTaskPostprocessIssues: () => postprocessIssuesRef.current,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  postprocessRunRef.current = undefined
  postprocessInflightRef.current = 0
  postprocessIssuesRef.current = []
  vi.clearAllMocks()
})

const task: TaskRecord = {
  id: 'task-1',
  prompt: 'single image',
  params: { ...DEFAULT_PARAMS, n: 1 },
  inputImageIds: [],
  outputImages: ['image-1'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

describe('TaskCard', () => {
  const collectTexts = (renderer: ReturnType<typeof create>) =>
    renderer.root.findAll((node) => typeof node.props.children === 'string').map((node) => node.props.children)

  it('后处理产出以计数徽章呈现，无产出时不渲染徽章', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    storeMocks.resolveImageDisplaySrc.mockResolvedValue('data:image/png;base64,original')
    let withoutBadge!: ReturnType<typeof create>
    await act(async () => {
      withoutBadge = create(
        <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(withoutBadge)
    expect(collectTexts(withoutBadge)).not.toContain('后处理 2')

    const taskWithOutputs: TaskRecord = {
      ...task,
      postprocessOutputs: [
        {
          rawImageId: 'image-1',
          path: 'D:\\out\\a.jpg',
          mediaId: 'clean',
          mediaName: '纯净版',
          sizeId: 'clean-1024x1024',
          width: 1024,
          height: 1024,
          clean: true,
          createdAt: 1,
        },
        {
          rawImageId: 'image-1',
          path: 'D:\\out\\b.jpg',
          mediaId: 'gdt',
          mediaName: '广点通',
          sizeId: 'gdt-1280x720',
          width: 1280,
          height: 720,
          clean: false,
          createdAt: 2,
        },
      ],
    }
    let withBadge!: ReturnType<typeof create>
    await act(async () => {
      withBadge = create(
        <TaskCard
          task={taskWithOutputs}
          onReuse={vi.fn()}
          onEditOutputs={vi.fn()}
          onDelete={vi.fn()}
          onClick={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(withBadge)
    expect(collectTexts(withBadge)).toContain('后处理 2')
  })

  it('falls back to the original image when a single output has no thumbnail', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce(undefined)
    storeMocks.resolveImageDisplaySrc.mockResolvedValueOnce('data:image/png;base64,original')
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)

    expect(storeMocks.resolveImageDisplaySrc).toHaveBeenCalledWith('image-1')
    expect(renderer.root.findByType('img').props.src).toBe('data:image/png;base64,original')
  })

  it('shows the actual generated resolution on the cover badge, not the scaled thumbnail size', async () => {
    // 回归：Electron 磁盘缩略图（thumbs/）解析出的是压缩后尺寸（最长边 ≤1024px），
    // 封面分辨率徽章必须用任务的实际参数（actualParamsByImage/actualParams）显示原图尺寸。
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/webp;base64,thumb',
      width: 1024,
      height: 1024,
      thumbnailVersion: 5,
    })
    const doneTask: TaskRecord = {
      ...task,
      actualParams: { size: '2048x2048' },
      actualParamsByImage: { 'image-1': { size: '2048x2048' } },
    }
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <TaskCard task={doneTask} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)

    const texts = renderer.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children)
    expect(texts).toContain('2048×2048')
    expect(texts).not.toContain('1024×1024')
  })

  it('does not show a completed output as failed when thumbnail loading reports a stale error', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/webp;base64,thumb',
      width: 1024,
      height: 1024,
      thumbnailVersion: 5,
    })
    const staleErrorTask: TaskRecord = {
      ...task,
      status: 'error',
      error: '缩略图加载超时',
    }
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <TaskCard
          task={staleErrorTask}
          onReuse={vi.fn()}
          onEditOutputs={vi.fn()}
          onDelete={vi.fn()}
          onClick={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer)

    expect(renderer.root.find((node) => node.props['data-status']).props['data-status']).toBe('done')
    expect(renderer.root.findAll((node) => node.props['aria-label'] === '重试任务')).toHaveLength(0)
    expect(
      renderer.root.findAll((node) => typeof node.props.children === 'string').map((node) => node.props.children),
    ).not.toContain('生成失败')
  })
})

/**
 * 后处理状态徽章。
 *
 * 为什么值得单独测：`postprocessOutputs` 是**产出落库之后**才有的，所以「跑到一半」与
 * 「跑了但一个都没成」两种情况下，卡片上原本什么都不显示 —— 这两个徽章就是补那段空白的，
 * 一旦条件写反（例如把 status 判成非 running），用户又会回到「不知道在跑还是失败了」。
 */
describe('TaskCard · 后处理状态徽章', () => {
  const collectTexts = (renderer: ReturnType<typeof create>) =>
    renderer.root.findAll((node) => typeof node.props.children === 'string').map((node) => node.props.children)

  async function renderCard() {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    storeMocks.resolveImageDisplaySrc.mockResolvedValue('data:image/png;base64,original')
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)
    return renderer
  }

  it('进行中显示进度徽章（进度数字来自运行记录，不是写死的文案）', async () => {
    postprocessRunRef.current = {
      id: 'run-1',
      source: 'auto',
      taskId: 'task-1',
      status: 'running',
      stage: 'write',
      totalImages: 4,
      completedImages: 1,
      imageUnits: 3,
      imageUnitsDone: 2,
      producedFiles: 2,
      currentLabel: '头条 1080x1920',
      issues: [],
      startedAt: 1,
    }
    postprocessInflightRef.current = 1

    const texts = collectTexts(await renderCard())
    // (1 + 2/3) / 4 = 41.7% → 42%
    expect(texts).toContain('后处理中 1/4 42% · 头条 1080x1920')
  })

  it('多个方向同时跑时补一个方向计数（只给一个方向的百分比会让人以为别的不见了）', async () => {
    postprocessRunRef.current = {
      id: 'run-1',
      source: 'auto',
      taskId: 'task-1',
      status: 'running',
      stage: 'write',
      totalImages: 4,
      completedImages: 1,
      imageUnits: 0,
      imageUnitsDone: 0,
      producedFiles: 2,
      issues: [],
      startedAt: 1,
    }
    postprocessInflightRef.current = 3

    const texts = collectTexts(await renderCard())
    expect(texts).toContain('后处理中 1/4 25% · 3 个方向')
  })

  it('结束后有问题给问题徽章，点击把**最近一批全方向**的问题交给清单弹窗', async () => {
    const issues = [
      createPostprocessIssue({ code: 'PP-DIR-001', stage: 'write', dir: 'D:/投放' }),
      createPostprocessIssue({ code: 'PP-PRESET-001', stage: 'prepare' }),
    ]
    postprocessIssuesRef.current = issues
    postprocessRunRef.current = {
      id: 'run-2',
      source: 'auto',
      taskId: 'task-1',
      status: 'failed',
      stage: 'finish',
      totalImages: 2,
      completedImages: 2,
      imageUnits: 0,
      imageUnitsDone: 0,
      producedFiles: 0,
      issues,
      startedAt: 1,
      finishedAt: 2,
    }

    const renderer = await renderCard()
    const badge = renderer.root.findByProps({ 'data-testid': 'task-postprocess-issues' })
    expect(collectTexts(renderer)).toContain('后处理问题 2')

    act(() => {
      badge.props.onClick({ stopPropagation: () => {} })
    })
    // 卡片只负责把问题交出去；弹窗的内容（码 / 上下文 / 线索）由 store 侧的用例守
    expect(storeMocks.showPostprocessIssuesDialog).toHaveBeenCalledWith(issues)
  })

  it('没有运行记录时两个徽章都不渲染（正常完成的任务不该多出状态）', async () => {
    const renderer = await renderCard()
    expect(renderer.root.findAllByProps({ 'data-testid': 'task-postprocess-running' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-testid': 'task-postprocess-issues' })).toHaveLength(0)
  })
})

/**
 * 图片被永久删除后的卡片表现（2026-09-21 需求）：
 * 「素材库里的图片被删除后，任务卡片上直接把该图片标成『已删除』，不要移除卡片其他内容」。
 *
 * 数据侧由 `patchTaskForPurgedSlots` 保证：槽位置空 + 槽位号记进 `purgedOutputSlots`，
 * **任务与卡片都不删**。这里守的是卡片那一半：读到被删的封面槽位要给出「已删除」，
 * 而不是留一个没有任何说明的空白占位。
 */
describe('TaskCard · 封面图已被删除', () => {
  const collectTexts = (renderer: ReturnType<typeof create>) =>
    renderer.root.findAll((node) => typeof node.props.children === 'string').map((node) => node.props.children)

  it('封面槽位被删时标「已删除」，卡片本身仍在、不误报「图片已丢失」', async () => {
    const purgedTask: TaskRecord = {
      ...task,
      // patchTaskForPurgedSlots 的实际写法：槽位置空 + 槽位号入 purgedOutputSlots
      outputImages: [undefined as unknown as string],
      purgedOutputSlots: [0],
    }
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <TaskCard task={purgedTask} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)

    expect(collectTexts(renderer)).toContain('已删除')
    expect(collectTexts(renderer)).not.toContain('图片已丢失')
    // 卡片还在、状态仍是完成（删图不删任务）
    expect(renderer.root.find((node) => node.props['data-status']).props['data-status']).toBe('done')
  })

  it('没被删的卡片不会误标「已删除」', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/webp;base64,thumb',
      width: 512,
      height: 512,
      thumbnailVersion: 5,
    })
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
      )
    })
    mountedRenderers.push(renderer)
    expect(collectTexts(renderer)).not.toContain('已删除')
  })
})
