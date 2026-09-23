import { beforeEach, describe, expect, it } from 'vitest'
import {
  getActivePostprocessRuns,
  getPostprocessRun,
  isDirectionPostprocessBusy,
  listPostprocessRuns,
  useRuntimeStore,
} from './runtimeStore'
import { getPostprocessRunPercent } from '../features/postprocess/postprocessRun'

describe('runtimeStore', () => {
  beforeEach(() => {
    useRuntimeStore.setState({
      streamPreviews: {},
      streamPreviewSlots: {},
      agentStreamingTexts: {},
      postprocessRunningDirections: [],
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

  /**
   * 方向级并发闸（2026-09-23 按方向独立运行的落点）。
   *
   * 契约：**同一方向同时最多一条**、名额按「最多并发数」限、排队的方向算「在飞」
   * （它已经占着那个方向 —— 界面上的「后处理中」必须把它算上，否则用户看到按钮不转了、
   * 以为整件事已经结束）。
   */
  describe('方向级并发闸', () => {
    it('名额够就开工；同一方向第二次申请被挡（不占第二个名额）', () => {
      const runtime = useRuntimeStore.getState()

      expect(runtime.tryAdmitPostprocessDirection('方向A', 5)).toBe(true)
      expect(useRuntimeStore.getState().postprocessRunningDirections).toEqual(['方向A'])
      // 同一方向再来一条：被挡下，且没有重复占名额
      expect(useRuntimeStore.getState().tryAdmitPostprocessDirection('方向A', 5)).toBe(false)
      expect(useRuntimeStore.getState().postprocessRunningDirections).toEqual(['方向A'])
    })

    it('名额满了就不放行，释放后（幂等）才放得进下一个方向', () => {
      const runtime = useRuntimeStore.getState()
      expect(runtime.tryAdmitPostprocessDirection('方向A', 1)).toBe(true)
      expect(useRuntimeStore.getState().tryAdmitPostprocessDirection('方向B', 1)).toBe(false)

      useRuntimeStore.getState().releasePostprocessDirection('方向A')
      // 幂等：多释放一次不该把别人的名额也放掉
      useRuntimeStore.getState().releasePostprocessDirection('方向A')
      expect(useRuntimeStore.getState().postprocessRunningDirections).toEqual([])
      expect(useRuntimeStore.getState().tryAdmitPostprocessDirection('方向B', 1)).toBe(true)
    })

    it('排队中的 run 也算在飞：它占着那个方向，不能当它不存在', () => {
      const runtime = useRuntimeStore.getState()
      runtime.startPostprocessRun({
        id: 'run-queued',
        source: 'manual',
        totalImages: 2,
        batchId: 'batch-1',
        directionId: '方向A',
        directionLabel: '医疗线 / 百万医疗险 / 方向A',
        queued: true,
      })

      expect(getPostprocessRun('run-queued')?.status).toBe('queued')
      // 排队中不给百分比：0% 与「刚开工还没解出第一张图」长得一样，而意义完全不同
      expect(getPostprocessRunPercent(getPostprocessRun('run-queued')!)).toBeUndefined()
      expect(getActivePostprocessRuns().map((run) => run.id)).toEqual(['run-queued'])
      expect(isDirectionPostprocessBusy('方向A')).toBe(true)
      expect(isDirectionPostprocessBusy('方向B')).toBe(false)

      // 拿到名额 → 转进行中，百分比开始有意义
      useRuntimeStore.getState().markPostprocessRunStarted('run-queued')
      expect(getPostprocessRun('run-queued')?.status).toBe('running')
      expect(getPostprocessRunPercent(getPostprocessRun('run-queued')!)).toBe(0)
    })
  })
})
