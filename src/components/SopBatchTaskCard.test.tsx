/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import SopBatchTaskCard from './SopBatchTaskCard'

const storeMocks = vi.hoisted(() => ({
  ensureImageThumbnailCached: vi.fn(),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))

vi.mock('../store', () => storeMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  vi.clearAllMocks()
})

function task(id: string, index: number): TaskRecord {
  return {
    id,
    prompt: `提示词 ${index}`,
    sopBatch: { batchId: 'batch-1', sopId: 'sop-1', sopName: '天体图', promptIndex: index, promptCount: 2 },
    params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high', n: 1 },
    inputImageIds: [],
    outputImages: [`image-${index}`],
    status: 'done',
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  } as unknown as TaskRecord
}

describe('SopBatchTaskCard', () => {
  it('uses batch-level selection, gallery opening, and deletion callbacks', () => {
    const onClick = vi.fn()
    const onOpenBatch = vi.fn()
    const onOpenImage = vi.fn()
    const onRerun = vi.fn()
    const onDelete = vi.fn()
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopBatchTaskCard
          sopName="天体图"
          tasks={[task('task-1', 1), task('task-2', 2)]}
          summary={{ total: 2, running: 0, completed: 2, failed: 0 }}
          isSelected
          onClick={onClick}
          onOpenBatch={onOpenBatch}
          onOpenImage={onOpenImage}
          onRerun={onRerun}
          onDelete={onDelete}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const card = renderer!.root
      .findAllByProps({ 'data-selected': true })
      .find((node) => String(node.props.className).includes('gallery-sop-card'))
    expect(card?.props.className).toContain('gallery-task-card')
    expect(card?.props['data-status']).toBe('done')
    act(() => card!.props.onClick({}))
    expect(onClick).toHaveBeenCalledOnce()

    const thumbnail = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '查看 SOP 批量任务封面图片')
    act(() => thumbnail!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onOpenImage).toHaveBeenCalledWith('image-1')
    expect(onOpenBatch).not.toHaveBeenCalled()

    const openBatchButton = renderer!.root.findByProps({ 'aria-label': '查看 SOP 批量任务 天体图' })
    act(() => openBatchButton!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onOpenBatch).toHaveBeenCalledOnce()

    const rerunButton = renderer!.root.findByProps({ 'aria-label': '再次生成 SOP 批量任务 天体图' })
    act(() => rerunButton!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onRerun).toHaveBeenCalledOnce()
    expect(rerunButton.props.className).toContain('gallery-task-action')
    expect(renderer!.root.findByProps({ 'aria-label': 'SOP 批量任务操作' }).props.className).toContain(
      'overflow-x-auto',
    )
    expect(renderer!.root.findByProps({ 'aria-label': '任务参数' })).toBeTruthy()
    expect(renderer!.root.findByType('h3').children).toContain('已完成')

    const deleteButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '删除 SOP 批量任务 天体图')
    act(() => deleteButton!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('does not mark a batch as failed when its completed output only has a stale loading error', () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    const staleErrorTask = {
      ...task('task-1', 1),
      status: 'error',
      error: '缩略图加载超时',
    } as TaskRecord
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopBatchTaskCard
          sopName="天体图"
          tasks={[staleErrorTask]}
          summary={{ total: 1, running: 0, completed: 0, failed: 1 }}
          onClick={vi.fn()}
          onOpenBatch={vi.fn()}
          onOpenImage={vi.fn()}
          onRerun={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const card = renderer!.root.findAll((node) => String(node.props.className).includes('gallery-sop-card')).at(0)
    expect(card?.props['data-status']).toBe('done')
    expect(renderer!.root.findByType('h3').children).toContain('已完成')
  })

  it('uses asset-library outputs when the task record has not received the output ids yet', () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    const staleTask = {
      ...task('task-1', 1),
      outputImages: [],
      status: 'error',
      error: '保存状态同步失败',
    } as TaskRecord
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopBatchTaskCard
          sopName="天体图"
          tasks={[staleTask]}
          summary={{ total: 1, running: 0, completed: 0, failed: 1 }}
          outputImagesByTask={new Map([['task-1', ['asset-image-1']]])}
          onClick={vi.fn()}
          onOpenBatch={vi.fn()}
          onOpenImage={vi.fn()}
          onRerun={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const card = renderer!.root.findAll((node) => String(node.props.className).includes('gallery-sop-card')).at(0)
    expect(card?.props['data-status']).toBe('done')
    expect(renderer!.root.findByType('h3').children).toContain('已完成')
    expect(
      renderer!.root.findAll(
        (node) =>
          node.type === 'span' && node.children.join('') === '1/1' && String(node.props.className).includes('bottom-1'),
      ),
    ).toHaveLength(1)
  })

  it('keeps a stale failed card failed when the asset library only has a partial output', () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    const staleTask = {
      ...task('task-1', 1),
      params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high', n: 2 },
      outputImages: [],
      status: 'error',
      error: '第二张图片生成失败',
    } as TaskRecord
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopBatchTaskCard
          sopName="天体图"
          tasks={[staleTask]}
          summary={{ total: 1, running: 0, completed: 0, failed: 1 }}
          outputImagesByTask={new Map([['task-1', ['asset-image-1']]])}
          onClick={vi.fn()}
          onOpenBatch={vi.fn()}
          onOpenImage={vi.fn()}
          onRerun={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const card = renderer!.root.findAll((node) => String(node.props.className).includes('gallery-sop-card')).at(0)
    expect(card?.props['data-status']).toBe('error')
    expect(renderer!.root.findByType('h3').children).toContain('生成失败')
    expect(
      renderer!.root.findAll(
        (node) =>
          node.type === 'span' && node.children.join('') === '1/2' && String(node.props.className).includes('bottom-1'),
      ),
    ).toHaveLength(1)
  })

  it('这一批还在出图时，「再次生成」仍然可点（交出去就能再开一轮）', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    const onRerun = vi.fn()
    const runningTask = { ...task('task-1', 1), status: 'running', outputImages: [] } as TaskRecord
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopBatchTaskCard
          sopName="天体图"
          tasks={[runningTask]}
          summary={{ total: 1, running: 1, completed: 0, failed: 0 }}
          onClick={vi.fn()}
          onOpenBatch={vi.fn()}
          onOpenImage={vi.fn()}
          onRerun={onRerun}
          onDelete={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    // 按钮的 `disabled` 只绑「受理动作」，**不绑任务是否还在跑** ——
    // 绑后者时用户得为一批已经丢到后台的活儿干等几分钟，还点不动（2026-09-24 改）
    const rerunButton = renderer!.root.findByProps({ 'aria-label': '再次生成 SOP 批量任务 天体图' })
    expect(rerunButton.props.disabled).toBe(false)
    await act(async () => {
      rerunButton.props.onClick({ stopPropagation: vi.fn() })
    })
    expect(onRerun).toHaveBeenCalledOnce()
  })

  it('受理期间按钮显示进行中并挡住连点，受理结束恢复可点', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    let releaseAccept: (() => void) | null = null
    const acceptPromise = new Promise<void>((resolve) => {
      releaseAccept = resolve
    })
    const onRerun = vi.fn(() => acceptPromise)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopBatchTaskCard
          sopName="天体图"
          tasks={[task('task-1', 1)]}
          summary={{ total: 1, running: 0, completed: 1, failed: 0 }}
          onClick={vi.fn()}
          onOpenBatch={vi.fn()}
          onOpenImage={vi.fn()}
          onRerun={onRerun}
          onDelete={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const findRerun = () => renderer!.root.findByProps({ 'aria-label': '再次生成 SOP 批量任务 天体图' })
    await act(async () => {
      findRerun().props.onClick({ stopPropagation: vi.fn() })
    })
    expect(onRerun).toHaveBeenCalledOnce()

    const pendingButton = findRerun()
    expect(pendingButton.props.disabled).toBe(true)
    expect(pendingButton.props['aria-busy']).toBe(true)
    // 受理中的第二下不再触发：同一批只被受理一次（闸门再由 store 兜底）
    await act(async () => {
      pendingButton.props.onClick({ stopPropagation: vi.fn() })
    })
    expect(onRerun).toHaveBeenCalledOnce()

    await act(async () => {
      releaseAccept?.()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(findRerun().props.disabled).toBe(false)
  })
})
