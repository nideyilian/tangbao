import { beforeEach, describe, expect, it } from 'vitest'
import { getPostprocessRun, listPostprocessRuns, useRuntimeStore } from './runtimeStore'

describe('runtimeStore', () => {
  beforeEach(() => {
    useRuntimeStore.setState({
      streamPreviews: {},
      streamPreviewSlots: {},
      agentStreamingTexts: {},
      postprocessRuns: {},
      postprocessRunIds: [],
    })
  })

  it('tracks stream previews outside the durable application store', () => {
    const runtime = useRuntimeStore.getState()
    runtime.setTaskStreamPreview('task-a', 'preview-a', 1)

    expect(useRuntimeStore.getState().streamPreviews).toEqual({ 'task-a': 'preview-a' })
    expect(useRuntimeStore.getState().streamPreviewSlots).toEqual({ 'task-a': { '1': 'preview-a' } })

    useRuntimeStore.getState().setTaskStreamPreview('task-a')
    expect(useRuntimeStore.getState().streamPreviews).toEqual({})
    expect(useRuntimeStore.getState().streamPreviewSlots).toEqual({})
  })

  it('clears one or all buffered Agent messages for a conversation', () => {
    const runtime = useRuntimeStore.getState()
    runtime.setAgentStreamingText('conversation-a', 'message-a', 'first')
    runtime.setAgentStreamingText('conversation-a', 'message-b', 'second')
    runtime.setAgentStreamingText('conversation-b', 'message-a', 'other')

    runtime.clearAgentStreamingText('conversation-a', 'message-a')
    expect(useRuntimeStore.getState().agentStreamingTexts).toEqual({
      'conversation-a:message-b': 'second',
      'conversation-b:message-a': 'other',
    })

    useRuntimeStore.getState().clearAgentStreamingText('conversation-a')
    expect(useRuntimeStore.getState().agentStreamingTexts).toEqual({
      'conversation-b:message-a': 'other',
    })
  })

  /**
   * 状态入口的「×」契约（2026-09-21 报障「关不掉」）。
   *
   * 状态入口不自动消失（这正是不靠 toast 的原因），所以必须给用户一个出口；
   * 但**进行中的那条不能清** —— 进度还在往它上面写，清掉之后每一次上报都会落到空处
   * （`updatePostprocessRun` 对不存在的记录直接丢弃），进度就永久停了。
   */
  it('清掉一条已结束的运行记录，进行中的那条不动', () => {
    const runtime = useRuntimeStore.getState()
    runtime.startPostprocessRun({ id: 'run-a', source: 'auto', totalImages: 2 })
    runtime.startPostprocessRun({ id: 'run-b', source: 'manual', totalImages: 1 })
    runtime.finishPostprocessRun('run-b', { issues: [], producedFiles: 3 })

    runtime.dismissPostprocessRun('run-a')
    expect(getPostprocessRun('run-a')).toBeDefined()

    runtime.dismissPostprocessRun('run-b')
    expect(getPostprocessRun('run-b')).toBeUndefined()
    expect(listPostprocessRuns().map((run) => run.id)).toEqual(['run-a'])
  })
})
