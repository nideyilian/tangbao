import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getTaskProgressDisplay } from './taskProgressDisplay'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS, n: 4 },
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

describe('getTaskProgressDisplay', () => {
  it('写提示词阶段：卡上写「编写提示词中」，并明说还没开始生图（TB-087）', () => {
    const display = getTaskProgressDisplay(
      task({
        promptPending: true,
        progressStage: 'prompting',
      }),
    )

    expect(display.cardLabel).toBe('编写提示词中')
    // 必须交代「还没开始生图」，否则用户会以为卡住了
    expect(display.detailDescription).toContain('写好会自动开始生图')
  })

  it('写提示词期间卡上的说明跟着当前步骤走', () => {
    const display = getTaskProgressDisplay(
      task({
        promptPending: true,
        progressStage: 'prompting',
        progressMessage: '正在逐张分析参考图…',
      }),
    )

    expect(display.detailDescription).toBe('正在逐张分析参考图…')
  })

  it('提示词环节失败：说「提示词失败」，跟生图失败区分开（TB-087）', () => {
    const display = getTaskProgressDisplay(
      task({
        status: 'error',
        promptFailed: true,
        progressStage: 'failed',
        error: '提示词生成失败：分组 A 下模型 m 的可用渠道不存在',
      }),
    )

    expect(display.cardLabel).toBe('提示词失败')
    expect(display.detailTitle).toBe('提示词生成失败')
    expect(display.detailDescription).toContain('可用渠道不存在')
  })

  it('shows request progress for a running task before provider acknowledgment', () => {
    const display = getTaskProgressDisplay(
      task({
        progressStage: 'requesting',
        apiProfileName: '默认',
        apiModel: 'gpt-image-1',
      }),
    )

    expect(display.cardLabel).toBe('发送请求中')
    expect(display.detailDescription).toContain('默认 / gpt-image-1')
  })

  it('shows relay progress after an async provider accepts the task', () => {
    const display = getTaskProgressDisplay(
      task({
        progressStage: 'relay-received',
        falRequestId: 'fal-1',
      }),
    )

    expect(display.cardLabel).toBe('中转站接收中')
    expect(display.detailDescription).toContain('服务商已接收任务')
  })

  it('shows generating progress with current output count', () => {
    const display = getTaskProgressDisplay(
      task({
        progressStage: 'previewing',
        outputImages: ['img-1'],
      }),
    )

    expect(display.cardLabel).toBe('生成中')
    expect(display.detailDescription).toContain('已生成 1 / 4 张')
  })

  it('shows reconnect progress for recoverable provider errors', () => {
    const display = getTaskProgressDisplay(
      task({
        status: 'error',
        error: '连接断开',
        falRecoverable: true,
      }),
    )

    expect(display.cardLabel).toBe('重连查询中')
    expect(display.detailDescription).toContain('之后会继续查询任务结果')
  })

  it('shows insufficient count and per-image reasons for partial failures', () => {
    const display = getTaskProgressDisplay(
      task({
        status: 'done',
        outputImages: ['img-1', 'img-2'],
        batchItemStatuses: ['done', 'done', 'error', 'error'],
        batchItemErrors: [
          { index: 2, error: '请求超时' },
          { index: 3, error: '内容被拒绝' },
        ],
        finishedAt: 2,
      }),
    )

    expect(display.cardLabel).toBe('数量不够')
    expect(display.detailDescription).toContain('请求 4 张，实际生成 2 张')
    expect(display.reasons).toEqual(['第 3 张：请求超时', '第 4 张：内容被拒绝'])
  })

  it('shows concrete hard failure reason', () => {
    const display = getTaskProgressDisplay(
      task({
        status: 'error',
        error: 'API key 无效',
      }),
    )

    expect(display.cardLabel).toBe('生成失败')
    expect(display.detailDescription).toContain('API key 无效')
  })

  it('keeps a task successful when all requested output images exist despite a stale error status', () => {
    const display = getTaskProgressDisplay(
      task({
        status: 'error',
        error: '缩略图加载超时',
        outputImages: ['img-1', 'img-2', 'img-3', 'img-4'],
      }),
    )

    expect(display.cardLabel).toBe('已完成')
    expect(display.tone).toBe('success')
  })

  it('shows stopped label for interrupted tasks', () => {
    const display = getTaskProgressDisplay(
      task({
        status: 'error',
        error: '请求中断',
      }),
    )

    expect(display.cardLabel).toBe('已停止')
    expect(display.detailDescription).toContain('请求中断')
  })
})
