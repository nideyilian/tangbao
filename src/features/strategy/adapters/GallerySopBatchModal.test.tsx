/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { DEFAULT_PARAMS, type SopBatchSnapshot, type TaskRecord } from '../../../types'
import GallerySopBatchModal, {
  collectOutcomeFailureReason,
  collectSourceFailureReason,
  getGallerySopPromptRunStorageKey,
} from './GallerySopBatchModal'
import { SOP_PROGRESSIVE_PROMPT_BATCH_SIZE, SOP_SERIES_PROGRESSIVE_GROUP_BATCH_SIZE } from '../sopPromptBatch'
import { SOP_SERIES_ANCHOR_INSTRUCTION } from '../../../lib/sopSeriesAnchor'

const generateMocks = vi.hoisted(() => ({
  generatePromptsFromSopStore: vi.fn(),
  generateVariablePromptsFromSopStore: vi.fn(),
  generateCampaignRecipePromptsFromStore: vi.fn(),
  getSopPromptGenerationModelFromStore: vi.fn(() => 'gpt-test'),
}))
const storeMocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(),
  ensureImageThumbnailCached: vi.fn(),
  submitTaskWithData: vi.fn(),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))
const dbMocks = vi.hoisted(() => ({
  deleteSopBatchSnapshot: vi.fn(),
  getAllSopBatchSnapshots: vi.fn(),
  getSopBatchSnapshot: vi.fn(),
  putSopBatchSnapshot: vi.fn(),
}))
const requirementState = vi.hoisted(() => {
  // 手工资产形态：没有 campaignRecipe 字段，配方配置直接放在 content 的 JSON 里。
  // 引擎侧有 parseCampaignRecipeConfigFromContent 兜底，弹窗分流也必须认得（见 R-53）。
  const recipeJsonSop = {
    id: 'sop-recipe-json',
    name: 'JSON 正文配方卡',
    description: '',
    content: '' as string,
    source: 'manual' as const,
    createdBy: 'user-1',
    createdAt: 5,
    updatedAt: 5,
  }
  // 完整形态的配方卡 SOP：快照里的 `sop` 字段是**整份库项**，
  // 本地引擎判定（isLocalGenerationSopForSop）要靠 campaignRecipe / executionMode 才能命中。
  // 手写精简版会漏掉这两个字段，把配方卡误判成普通 SOP（R-54 净化/收敛测试都会因此假绿）。
  const recipeSop = {
    id: 'sop-recipe',
    name: '双十一配方卡',
    description: '本地引擎批量组合',
    content: '{{主视觉}}，主体是{{主体}}',
    kind: 'campaign-recipe' as const,
    campaignRecipe: {
      body: '{{主视觉}}，主体是{{主体}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '手持使用', '使用场景'] },
        { name: '主体', options: ['咖啡杯', '保温杯', '玻璃杯'] },
      ],
    },
    source: 'manual' as const,
    createdBy: 'user-1',
    createdAt: 4,
    updatedAt: 4,
  }
  return {
    recipeJsonSop,
    recipeSop,
    sopLibrary: [
      {
        id: 'sop-1',
        name: '商品图 SOP',
        description: '',
        content: '生成商品图。',
        source: 'manual',
        createdBy: 'user-1',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'sop-2',
        name: '海报 SOP',
        description: '',
        content: '生成海报。',
        source: 'manual',
        createdBy: 'user-1',
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'sop-series',
        name: '系列海报 SOP',
        description: '同组统一视觉规范',
        content: '同组保持同一视觉规范，只改主体与背景。',
        kind: 'series' as const,
        seriesConfig: { imageCount: 3 as const, fixedDimensions: ['视觉风格'], variableDimensions: ['主体', '背景'] },
        source: 'manual',
        createdBy: 'user-1',
        createdAt: 3,
        updatedAt: 3,
      },
      recipeSop,
      // 手工资产形态：没有 campaignRecipe 字段，配方配置直接放在 content 的 JSON 里。
      // 引擎侧有同款兜底解析，弹窗分流也必须认得（见 R-53）。
      recipeJsonSop,
    ],
  }
})
const storeState = vi.hoisted(() => ({
  params: {
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: 'auto',
    output_format: 'png',
    n: 1,
    adNegativeRuleId: 'general-strict',
  },
  settings: {
    adNegativeRuleProfiles: [
      { id: 'general-strict', name: '通用严格' },
      { id: 'ocean-engine', name: '今日头条' },
      { id: 'tencent-ads', name: '广点通' },
    ],
  },
  inputImages: [] as Array<{ id: string; dataUrl: string }>,
  inputImageFolder: null,
  customOutputPath: '',
  tasks: [] as TaskRecord[],
  activeWorkspaceTabId: 'tab-a',
  workspaceTabs: [{ id: 'tab-a', name: '标签 A' }],
  showToast: vi.fn(),
  setConfirmDialog: vi.fn(),
  setInputImages: vi.fn(),
  setInputImageFolder: vi.fn(),
  setParams: vi.fn(),
}))

vi.mock('../../../store', () => ({
  ensureImageCached: storeMocks.ensureImageCached,
  ensureImageThumbnailCached: storeMocks.ensureImageThumbnailCached,
  submitTaskWithData: storeMocks.submitTaskWithData,
  subscribeImageThumbnail: storeMocks.subscribeImageThumbnail,
  useStore: Object.assign((selector: (state: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}))
vi.mock('../../../lib/db', () => ({
  deleteSopBatchSnapshot: dbMocks.deleteSopBatchSnapshot,
  getAllSopBatchSnapshots: dbMocks.getAllSopBatchSnapshots,
  getSopBatchSnapshot: dbMocks.getSopBatchSnapshot,
  putSopBatchSnapshot: dbMocks.putSopBatchSnapshot,
}))
vi.mock('../../requirementPrototype/store', () => ({
  useRequirementPrototype: (selector: (state: typeof requirementState) => unknown) => selector(requirementState),
}))
vi.mock('./storeSopGeneration', () => generateMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

/**
 * 模拟「落盘 → 读回」边界（R-58）：真实 put/get 走 JSON 序列化，
 * 未声明的字段会丢。这里按结构化克隆过一遍，保证测试断言拿到的是
 * 「真正能落盘的形态」，而不是内存里的引用。
 */
function throughPersistedBoundary(snapshot: SopBatchSnapshot): SopBatchSnapshot {
  return structuredClone(snapshot)
}

function createPromptRun(id: string, title: string, promptGroup?: SopBatchSnapshot['promptGroup']): SopBatchSnapshot {
  return {
    id,
    title,
    promptGroup,
    batchId: '',
    workspaceTabId: 'tab-a',
    createdAt: 10,
    updatedAt: 20,
    status: 'ready',
    sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
    brief: '',
    referenceImageIds: [],
    promptCount: 1,
    imagesPerPrompt: 1,
    prompts: [{ id: `${id}-prompt`, text: `${title}内容`, origin: 'ai', edited: false, sourceId: 'text-to-image' }],
    params: { ...DEFAULT_PARAMS },
  }
}

function selectPrompt(renderer: ReturnType<typeof create>, index: number) {
  act(() => {
    renderer.root.findByProps({ 'aria-label': `选择第 ${index} 条提示词` }).props.onClick()
  })
}

beforeEach(() => {
  dbMocks.getAllSopBatchSnapshots.mockResolvedValue([])
  dbMocks.getSopBatchSnapshot.mockResolvedValue(undefined)
  dbMocks.putSopBatchSnapshot.mockResolvedValue('run-1')
  dbMocks.deleteSopBatchSnapshot.mockResolvedValue(undefined)
  storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
})

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  window.localStorage.clear()
  storeState.inputImages = []
  storeState.tasks = []
  vi.clearAllMocks()
})

describe('collectSourceFailureReason', () => {
  it('原样带出失败参考图的报错，不做转述', () => {
    expect(
      collectSourceFailureReason([
        {
          status: 'failed',
          error: '分组 专用gemini 下模型 gemini-3.1-pro-preview 的可用渠道不存在（retry）',
        },
      ]),
    ).toBe('分组 专用gemini 下模型 gemini-3.1-pro-preview 的可用渠道不存在（retry）')
  })

  it('跳过成功项与空报错，只汇总失败原因', () => {
    expect(
      collectSourceFailureReason([
        { status: 'completed', error: undefined },
        { status: 'failed', error: '   ' },
        { status: 'failed', error: '模型不可用' },
      ]),
    ).toBe('模型不可用')
  })

  it('多个参考图报同一原因时只保留一条', () => {
    expect(
      collectSourceFailureReason([
        { status: 'failed', error: '渠道不存在' },
        { status: 'failed', error: '渠道不存在' },
      ]),
    ).toBe('渠道不存在')
  })

  it('没有失败项时返回空串', () => {
    expect(collectSourceFailureReason([{ status: 'completed' }, { status: 'partial' }])).toBe('')
  })
})

describe('collectOutcomeFailureReason', () => {
  it('带出提交失败项的原始报错', () => {
    expect(collectOutcomeFailureReason([{ error: new Error('输出目录不在允许范围内') }])).toBe(
      '输出目录不在允许范围内。',
    )
  })

  it('跳过成功项，多个失败原因并列且去重', () => {
    expect(
      collectOutcomeFailureReason([
        { taskId: 'task-1' },
        { error: new Error('模型不可用') },
        { error: new Error('模型不可用') },
        { error: '输出目录不可写' },
      ]),
    ).toBe('模型不可用；输出目录不可写。')
  })

  it('失败但不带原因时给出可读占位，不产出空句子', () => {
    expect(collectOutcomeFailureReason([{ error: undefined }])).toBe('未知原因。')
  })

  it('全部成功时返回空串', () => {
    expect(collectOutcomeFailureReason([{ taskId: 'task-1' }, { taskId: 'task-2' }])).toBe('')
  })
})

describe('GallerySopBatchModal background generation', () => {
  it('lets the user choose the information-flow review rule from batch settings', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={1} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const reviewRuleSelect = renderer!.root.findByProps({ 'aria-label': '选择信息流审核规则' })
    act(() => reviewRuleSelect.props.onChange({ target: { value: 'ocean-engine' } }))

    expect(storeState.setParams).toHaveBeenCalledWith({ adNegativeRuleId: 'ocean-engine' })
  })

  it('starts generating before consuming the one-shot auto-start request', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['自动生成的提示词'])

    function AutoStartHost() {
      const [autoStart, setAutoStart] = useState(true)
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<AutoStartHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('自动生成的提示词')
  })

  it('routes recipe-card SOPs to the local engine instead of the AI text model', async () => {
    generateMocks.generateCampaignRecipePromptsFromStore.mockResolvedValue(['本地生成的提示词'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe"
          initialPromptCount={1}
          autoStart
          onAutoStartConsumed={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 配方卡走本地引擎分支，绝不调用 AI 生成函数
    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledOnce()
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
    expect(generateMocks.generateVariablePromptsFromSopStore).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('本地生成的提示词')
  })

  it('routes ordinary SOPs to the AI text model, not the local engine', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['AI 生成的提示词'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          autoStart
          onAutoStartConsumed={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(generateMocks.generateCampaignRecipePromptsFromStore).not.toHaveBeenCalled()
  })

  it('routes a recipe card stored as JSON content to the local engine too', async () => {
    // 回归 R-53：引擎侧用 parseCampaignRecipeConfigFromContent 兜底识别「content 直接放 JSON」的
    // 手工资产，但弹窗分流曾只认 campaignRecipe 字段 / executionMode → 同一张卡被判成普通 SOP 走 AI。
    requirementState.recipeJsonSop.content = JSON.stringify({
      body: '{{主视觉}}，主体是{{主体}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '使用场景'] },
        { name: '主体', options: ['咖啡杯', '玻璃杯'] },
      ],
    })
    generateMocks.generateCampaignRecipePromptsFromStore.mockResolvedValue(['JSON 配方卡本地生成的提示词'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe-json"
          initialPromptCount={1}
          autoStart
          onAutoStartConsumed={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledOnce()
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('settles the status when switching SOP aborts an in-flight local run (R-55)', async () => {
    // 回归 R-55：init effect 的依赖是 [promptRunStorageKey, initialSopId]，cleanup 会中止在途生成。
    // 用户从「配方卡」切到另一张 SOP（或弹窗重挂载）时，中止后若无人结算状态，
    // UI 会永久停在「生成中 · 0 条提示词」——看起来就像「完全没走引擎」。
    let resolveRecipe!: (value: string[]) => void
    generateMocks.generateCampaignRecipePromptsFromStore.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRecipe = resolve
        }),
    )

    let updateSop!: (value: string) => void
    function SwitchingSopHost() {
      const [sopId, setSopId] = useState('sop-recipe')
      updateSop = setSopId
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId={sopId}
          initialPromptCount={1}
          autoStart
          onAutoStartConsumed={vi.fn()}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<SwitchingSopHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledOnce()

    // 生成仍在途时切走 SOP → init effect 重跑 → cleanup 中止在途控制器
    await act(async () => {
      updateSop('sop-1')
      await Promise.resolve()
      await Promise.resolve()
    })
    // 让被中止的 promise 有机会落定
    await act(async () => {
      resolveRecipe(['迟到的提示词'])
      await Promise.resolve()
      await Promise.resolve()
    })

    // 状态必须被结算：最后一个落盘的 run 快照不能再停在 generating
    // （run 头部的「生成中」正是读自 activeRun.status，见 getRunStatusLabel）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    const snapshots = dbMocks.putSopBatchSnapshot.mock.calls.map((call) => call[0] as SopBatchSnapshot)
    // 库里不得留下任何非终态快照（挂载收敛逻辑负责把 generating 归位）
    expect(snapshots.every((snapshot) => snapshot.status !== 'generating')).toBe(true)
  })

  it('does not tag a local-engine run with the AI text model name (R-54)', async () => {
    // 回归 R-54：本地算法分支（配方卡）的 run 快照不该带上文本模型名 ——
    // 无条件记录会让界面显示「文本模型 gemini-…」，用户据此误判成走了 AI。
    generateMocks.getSopPromptGenerationModelFromStore.mockReturnValue('gemini-3.1-pro-preview')
    generateMocks.generateCampaignRecipePromptsFromStore.mockResolvedValue(['本地生成的提示词'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe"
          initialPromptCount={1}
          autoStart
          onAutoStartConsumed={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledOnce()
    // 快照落盘里不应出现该文本模型名
    const persisted = dbMocks.putSopBatchSnapshot.mock.calls.map((call) => JSON.stringify(call[0])).join('\n')
    expect(persisted).not.toContain('gemini-3.1-pro-preview')
  })

  it('does not start a second generation while one is already in flight (R-56)', async () => {
    // 回归 R-56：generateForSources 开头会 abort 上一轮，而被 abort 的那一轮最后落盘的是
    // `status: 'generating'` 的孤儿快照（progressiveSnapshotId 已不等于 activeRunIdRef，
    // 永远等不到收尾覆盖）。界面就永久停在「生成中 · 0 条提示词」。
    let resolveRecipe!: (value: string[]) => void
    generateMocks.generateCampaignRecipePromptsFromStore.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRecipe = resolve
        }),
    )
    // autoStart 在消费后会被置回 false，随后若再次变 true（宿主回写、重挂载）不得重入
    function RestartableHost() {
      const [autoStart, setAutoStart] = useState(true)
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe"
          initialPromptCount={2}
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<RestartableHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRecipe(['第一条', '第二条'])
      await Promise.resolve()
      await Promise.resolve()
    })

    // 全程只允许一次生成调用：多出来的那次会 abort 前一次并留下孤儿 generating 快照
    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledTimes(1)
  })

  it('tells the user instead of silently swallowing a click while generating (R-57)', async () => {
    // 回归 R-57：重入闸挡下时必须给明确反馈。否则点击被静默吞掉，
    // 界面停在上一轮留下的「生成中 · 0 条提示词」上，用户会判断成「生成坏了」。
    //
    // 触发方式是**同一 tick 内连点两次**「再次生成」按钮：
    // 重入闸读同步 ref，第一次点击同步置 true；第二次点击在 React 尚未重渲染、
    // 异步 `running` 还没翻成 true 的窗口里进来，异步守卫挡不住，只有 ref 闸门能挡。
    // 这也是唯一能真正走到闸门分支的路径 —— 一旦 `running` 变 true，按钮就整组不渲染了。
    let resolveRecipe!: (value: string[]) => void
    generateMocks.generateCampaignRecipePromptsFromStore.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRecipe = resolve
        }),
    )

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe"
          initialPromptCount={2}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 先造出一份已就绪的提示词列表，让「再次生成」按钮进入树（未生成时该按钮不渲染）。
    const findLabel = (pattern: RegExp) => {
      const nodes = renderer!.root.findAll((node) => {
        const label = node.props?.['aria-label']
        return typeof label === 'string' && pattern.test(label)
      })
      if (nodes.length === 0) {
        throw new Error(
          `未找到匹配 ${pattern} 的按钮；当前可见：${JSON.stringify(
            renderer!.root
              .findAll((node) => typeof node.props?.['aria-label'] === 'string')
              .map((node) => node.props['aria-label']),
          )}`,
        )
      }
      return nodes[0]
    }
    await act(async () => {
      findLabel(/^生成 \d+ 条 SOP 提示词$/).props.onClick?.()
      await Promise.resolve()
    })
    const firstRun = resolveRecipe
    await act(async () => {
      firstRun(['第一条', '第二条'])
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledTimes(1)

    // 第二轮改成永不 resolve，制造「在途」状态。
    generateMocks.generateCampaignRecipePromptsFromStore.mockImplementation(
      () => new Promise<string[]>(() => undefined),
    )
    storeState.showToast.mockClear()

    const againButton = findLabel(/^再次生成 \d+ 条 SOP 提示词$/)
    await act(async () => {
      // 同一 tick 连点两次：第二次必然命中重入闸。
      againButton.props.onClick?.()
      againButton.props.onClick?.()
      await Promise.resolve()
    })

    // 闸门挡下：只允许一次真实生成，并且必须留下明确提示（不能静默吞掉）。
    expect(generateMocks.generateCampaignRecipePromptsFromStore).toHaveBeenCalledTimes(2)
    expect(storeState.showToast).toHaveBeenCalledWith(expect.stringContaining('尚未结束'), 'info')
  })

  it('cleans a stale AI model name off a local-engine run when opening it (R-54)', async () => {
    // 回归 R-54 残留：旧版本写进快照的文本模型名会被弹窗「恢复 → 再回写」，
    // 光改 ref 洗不掉 —— 每开一次弹窗它都会复活，界面显示成「文本模型 gemini-…」。
    // 打开时就必须就地净化并落盘。
    const dirtyRun: SopBatchSnapshot = {
      ...createPromptRun('run-dirty', '旧配方卡批次'),
      status: 'generating',
      promptCount: 0,
      prompts: [],
      sop: requirementState.recipeSop,
      promptGenerationModel: 'gemini-3.1-pro-preview',
    }
    // 真实链路里「列表查询」和「按 id 查询」是同一条库记录被**各反序列化一次**，
    // 得到两个互不相干的 JS 对象。这里用 clone 还原这个语义 ——
    // 共用同一引用会掩盖「就地改一个不影响另一个」导致的覆盖 bug。
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([throughPersistedBoundary(dirtyRun)])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(throughPersistedBoundary(dirtyRun))
    // key 必须与 getGallerySopPromptRunStorageKey('tab-a') 一致，否则挂载 effect 读不到指针，
    // 会跳过 applyPromptRun 走兜底分支 —— 那样测的就不是净化路径了。
    window.localStorage.setItem(
      'tangbao.gallery-sop-prompt-run.tab-a',
      JSON.stringify({ version: 4, activeRunId: 'run-dirty', selectedSopId: 'sop-recipe' }),
    )

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 必须深拷贝成快照：mock 收到的是**引用**，后续代码可能就地把同一个对象改成别的值，
    // 直接拿引用断言会读到「未来」的状态（这里踩过一次：两条都显示 undefined 却断言失败）。
    const persisted = dbMocks.putSopBatchSnapshot.mock.calls.map((call) => structuredClone(call[0] as SopBatchSnapshot))
    // 净化结果必须真的写回库里，否则下次打开又复活
    expect(persisted.some((snapshot) => snapshot.id === 'run-dirty')).toBe(true)
    // 落盘的最后一份必须是干净的：中间那次写回若带脏 model，下次打开就会复活
    const lastWrite = persisted.filter((snapshot) => snapshot.id === 'run-dirty').at(-1)
    expect(lastWrite?.promptGenerationModel).toBeUndefined()
    expect(JSON.stringify(persisted)).not.toContain('gemini-3.1-pro-preview')
  })

  it('keeps the recipe config inside the persisted snapshot so local-engine detection survives a reload (R-58)', async () => {
    // 回归 R-58：快照 `sop` 若只留 id/name/description/content，
    // 读回侧的本地引擎判定（isLocalGenerationSopForSop）就恒为 false ——
    // content 骨架不以 `{` 开头时，内联 JSON 兜底也命中不了。
    // 后果是模型名挡板与残留净化一起失效，配方卡一直显示「文本模型 gemini-…」。
    const recipeRun: SopBatchSnapshot = {
      ...createPromptRun('run-recipe', '配方卡批次'),
      sop: requirementState.recipeSop,
      // 带上脏模型名：保证净化路径必然回写一次（回写出去的形态 = 真实落盘形态）。
      promptGenerationModel: 'gemini-3.1-pro-preview',
    }
    // 让弹窗打开时把这条 run 收成活跃快照，并由净化/收敛路径回写一次 ——
    // 回写出去的形态就是真实落盘形态，用来验证 sop 是否还带得动本地引擎判定。
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([throughPersistedBoundary(recipeRun)])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(throughPersistedBoundary(recipeRun))
    window.localStorage.setItem(
      'tangbao.gallery-sop-prompt-run.tab-a',
      JSON.stringify({ version: 4, activeRunId: 'run-recipe', selectedSopId: 'sop-recipe' }),
    )

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 必须走 `buildPromptRunSnapshot` 这条**构造新快照**的路径去写盘，
    // 因为 R-58 的裁剪就发生在那里（收敛透传的对象不经过裁剪，测不到）。
    dbMocks.putSopBatchSnapshot.mockClear()
    generateMocks.generateCampaignRecipePromptsFromStore.mockResolvedValue(['一条', '两条'])
    const findLabel = (pattern: RegExp) => {
      const nodes = renderer!.root.findAll((node) => {
        const label = node.props?.['aria-label']
        return typeof label === 'string' && pattern.test(label)
      })
      if (nodes.length === 0) {
        throw new Error(
          `未找到匹配 ${pattern} 的按钮；当前可见：${JSON.stringify(
            renderer!.root
              .findAll((node) => typeof node.props?.['aria-label'] === 'string')
              .map((node) => node.props['aria-label']),
          )}`,
        )
      }
      return nodes[0]
    }
    await act(async () => {
      findLabel(/^再次生成 \d+ 条 SOP 提示词$/).props.onClick?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    const persisted = dbMocks.putSopBatchSnapshot.mock.calls.map((call) => structuredClone(call[0] as SopBatchSnapshot))
    expect(persisted.length).toBeGreaterThan(0)
    // 判定所需的字段必须随快照一起落盘，否则重启后配方卡被判成普通 SOP，
    // 模型名挡板与残留净化一起失效（R-54 会因此复活）。
    const withSop = persisted.find((snapshot) => snapshot.sop.id === 'sop-recipe')
    expect(withSop).toBeDefined()
    expect(withSop?.sop.campaignRecipe?.dimensions?.length).toBeGreaterThan(0)
  })

  it('converges historical generating snapshots on mount so the UI leaves「生成中」(R-57)', async () => {
    // 回归 R-57：历史遗留的孤儿快照停在 status='generating' 后不再推进，
    // run 头部就永久显示「生成中 · 0 条提示词」。弹窗挂载时不可能有在途生成
    // （在途状态都在内存 ref 里），必须就地收敛成 ready 并写回。
    const orphan: SopBatchSnapshot = {
      ...createPromptRun('run-orphan', '卡住的批次'),
      status: 'generating',
      promptCount: 0,
      prompts: [],
      sop: requirementState.recipeSop,
    }
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([structuredClone(orphan)])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(structuredClone(orphan))
    // 同上：用真实 key，确保走 applyPromptRun 的收敛回写路径而不是兜底分支。
    window.localStorage.setItem(
      'tangbao.gallery-sop-prompt-run.tab-a',
      JSON.stringify({ version: 4, activeRunId: 'run-orphan', selectedSopId: 'sop-recipe' }),
    )

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-recipe"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const persisted = dbMocks.putSopBatchSnapshot.mock.calls.map((call) => call[0] as SopBatchSnapshot)
    const converged = persisted.find((snapshot) => snapshot.id === 'run-orphan')
    expect(converged).toBeDefined()
    expect(converged!.status).toBe('ready')
  })

  it('uses the latest input requirement when a mounted modal starts another run', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['新任务提示词'])
    let updateBrief!: (value: string) => void
    let startNextRun!: () => void

    function ReusableSopHost() {
      const [brief, setBrief] = useState('上一任务要求')
      const [autoStart, setAutoStart] = useState(false)
      updateBrief = setBrief
      startNextRun = () => setAutoStart(true)
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          initialBrief={brief}
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<ReusableSopHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      updateBrief('新任务要求')
      startNextRun()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '新任务要求',
      expect.anything(),
    )
  })

  it('uses the latest generation count when the same SOP starts again', async () => {
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, quantity, _brief, options) => {
      const prompts = Array.from({ length: quantity }, (_, index) => `提示词-${index + 1}`)
      await options.onBatch?.(prompts, quantity, quantity)
      return prompts
    })
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let startNextRun!: () => void

    function ReusableSopHost() {
      const [promptCount, setPromptCount] = useState(1)
      const [autoStart, setAutoStart] = useState(true)
      startNextRun = () => {
        setPromptCount(3)
        setAutoStart(true)
      }
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={promptCount}
          initialAutoGenerate
          syncInitialGenerationCounts
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<ReusableSopHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      startNextRun()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore.mock.calls.map((call) => call[1])).toEqual([1, 3])
  })

  it('continues generating and persists the result after being moved to the background', async () => {
    let resolveGeneration!: (value: string[]) => void
    generateMocks.generatePromptsFromSopStore.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveGeneration = resolve
        }),
    )
    const onBackground = vi.fn()
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          autoStart
          onClose={vi.fn()}
          onBackground={onBackground}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    const closeButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '转入后台继续生成 SOP 提示词')
    act(() => closeButton!.props.onClick())
    expect(onBackground).toHaveBeenCalledOnce()

    await act(async () => {
      resolveGeneration(['后台生成的提示词'])
      await Promise.resolve()
    })

    const persisted = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(persisted).toMatchObject({ version: 4, selectedSopId: 'sop-1', availablePrompts: 1 })
    expect(persisted.activeRunId).toMatch(/^sop-run-/)
    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: persisted.activeRunId,
        status: 'ready',
        prompts: [expect.objectContaining({ text: '后台生成的提示词', origin: 'ai' })],
      }),
    )
  })

  it('pauses before the next prompt batch and continues on demand', async () => {
    let releaseCurrentBatch!: () => void
    let secondBatchStarted = false
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      await options.beforeBatch?.()
      await options.onBatch?.(['第一批提示词'], 1, 2)
      await new Promise<void>((resolve) => {
        releaseCurrentBatch = resolve
      })
      await options.beforeBatch?.()
      secondBatchStarted = true
      await options.onBatch?.(['第二批提示词'], 2, 2)
      return ['第一批提示词', '第二批提示词']
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '暂停提示词生成' }).props.onClick()
      releaseCurrentBatch()
      await Promise.resolve()
    })

    expect(secondBatchStarted).toBe(false)
    expect(renderer!.root.findByProps({ 'aria-label': '继续提示词生成' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('第一批提示词')

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '继续提示词生成' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(secondBatchStarted).toBe(true)
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('第二批提示词')
  })

  it('cancels the active prompt request and returns to an idle state', async () => {
    let requestSignal!: AbortSignal
    generateMocks.generatePromptsFromSopStore.mockImplementation((_sop, _quantity, _brief, options) => {
      requestSignal = options.signal
      return new Promise<string[]>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '取消提示词生成' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestSignal.aborted).toBe(true)
    expect(renderer!.root.findAllByProps({ 'aria-label': '取消提示词生成' })).toHaveLength(0)
    expect(
      renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('提示词生成已取消')),
    ).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 0,
    })
  })

  // 渐进派发（自动生成开）时，生图任务提交是挂在 onBatch 里的 await 上。
  // 用户点「取消」后必须在「当前这一条还没提交完」时也能立刻收口，不能卡在
  // 「正在取消提示词生成」上等图片接口自己回来。
  it('cancels the progressive run while an image dispatch is still in flight', async () => {
    let dispatchResolve: ((taskId: string) => void) | null = null
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      await options.onBatch?.(['第一条提示词'], 1, 2)
      await options.onBatch?.(['第二条提示词'], 2, 2)
      return ['第一条提示词', '第二条提示词']
    })
    // 第一张图的提交挂住不返回：模拟图片接口迟迟不回（用户在此时点取消）。
    storeMocks.submitTaskWithData.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          dispatchResolve = resolve
        }),
    )
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          initialAutoGenerate
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '取消提示词生成' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 取消后必须回到可用状态：取消按钮消失，且不再卡在「正在取消」文案上。
    expect(renderer!.root.findAllByProps({ 'aria-label': '取消提示词生成' })).toHaveLength(0)
    expect(
      renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('正在取消提示词生成')),
    ).toBe(false)

    // 收尾：让挂住的提交回来，不应把状态又推回生成中。
    await act(async () => {
      dispatchResolve?.('task-late')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderer!.root.findAllByProps({ 'aria-label': '取消提示词生成' })).toHaveLength(0)

    // 晚到的提交在后台自行收尾，不再产生状态更新
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderer!.root.findAllByProps({ 'aria-label': '取消提示词生成' })).toHaveLength(0)
  })

  it('surfaces the model error verbatim when prompt generation fails outright', async () => {
    // 用户亲历场景：Agent 模型在服务商侧无可用渠道。界面必须显示这句原文，
    // 否则用户只能看到「生成中断」，无法判断是配置问题还是程序坏了（R-63）。
    generateMocks.generatePromptsFromSopStore.mockRejectedValue(
      new Error('分组 专用gemini 下模型 gemini-3.1-pro-preview 的可用渠道不存在（retry）'),
    )
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const alerts = renderer!.root.findAllByProps({ role: 'alert' })
    expect(
      alerts.some((node) => String(node.children.join('')).includes('分组 专用gemini 下模型 gemini-3.1-pro-preview')),
    ).toBe(true)
  })

  it('aborts the previous SOP request when a keyed workbench switches SOPs', async () => {
    let previousSignal!: AbortSignal
    generateMocks.generatePromptsFromSopStore.mockImplementation((_sop, _quantity, _brief, options) => {
      previousSignal = options.signal
      return new Promise<string[]>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal key="sop-1" workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.update(
        <GallerySopBatchModal key="sop-2" workspaceTabId="tab-a" initialSopId="sop-2" onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })

    expect(previousSignal.aborted).toBe(true)
    expect(
      renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('当前 SOP：海报 SOP')),
    ).toBe(true)
    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
  })

  it('persists the automatic image-generation switch per workspace tab', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    const toggle = renderer!.root
      .findAllByType('input')
      .find((input) => input.props['aria-label'] === '每生成一条提示词立即发送生图')
    expect(toggle!.props.checked).toBe(false)
    act(() => toggle!.props.onChange({ target: { checked: true } }))

    expect(
      renderer!.root
        .findAllByType('input')
        .find((input) => input.props['aria-label'] === '每生成一条提示词立即发送生图')!.props.checked,
    ).toBe(true)
    const persisted = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(persisted.autoGenerate).toBe(true)
  })

  it('offers an explicit prompt-generation entry inside the SOP workspace', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['从工作台生成的提示词'])
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={1} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const generateButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 1 条 SOP 提示词')
    expect(generateButton).toBeDefined()

    await act(async () => {
      generateButton!.props.onClick()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('从工作台生成的提示词')
  })

  it('offers a source-level action that supplements its prompt shortfall and generates only those images', async () => {
    generateMocks.generatePromptsFromSopStore
      .mockImplementationOnce(async (_sop, _quantity, _brief, options) => {
        await options.onBatch?.(['已有提示词'], 1, 3)
        return ['已有提示词']
      })
      .mockImplementationOnce(async (_sop, _quantity, _brief, options) => {
        const supplemented = ['补充提示词 1', '补充提示词 2']
        await options.onBatch?.(supplemented, 2, 2)
        return supplemented
      })
    storeMocks.submitTaskWithData.mockResolvedValueOnce('task-supplement-1').mockResolvedValueOnce('task-supplement-2')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={3} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '生成 3 条 SOP 提示词' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).not.toHaveBeenCalled()
    const supplementButton = renderer!.root.findByProps({
      'aria-label': '为「文生图（无参考图）」补充 2 条提示词并生成 2 张图片',
    })
    await act(async () => {
      supplementButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore.mock.calls.map((call) => call[1])).toEqual([3, 2])
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].prompt)).toEqual([
      '补充提示词 1',
      '补充提示词 2',
    ])
  })

  it('restores the active SOP run from IndexedDB without mixing another SOP', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-saved',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      pinned: true,
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '历史要求',
      referenceImageIds: [],
      promptCount: 80,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-1', text: '历史提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 3,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 80,
        imagesPerPrompt: 1,
        availablePrompts: 1,
        brief: storedRun.brief,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('历史提示词')
    expect(
      renderer!.root
        .findAllByType('button')
        .some((button) => button.props['aria-label'] === '补充缺口 79 条提示词并生成 79 张图片'),
    ).toBe(true)
    expect(storeState.setParams).toHaveBeenCalledWith(storedRun.params)
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('supplements only missing prompts and generates images only for the supplemented prompts', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-partial',
      batchId: 'batch-existing',
      batchIds: ['batch-existing'],
      taskIds: ['task-existing'],
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'submitted',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '',
      referenceImageIds: [],
      promptCount: 3,
      imagesPerPrompt: 2,
      prompts: [{ id: 'prompt-existing', text: '已有提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS, n: 2 },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 3,
        imagesPerPrompt: 2,
        availablePrompts: 1,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      const supplemented = ['补充提示词 1', '补充提示词 2']
      await options.onBatch?.(supplemented, 2, 2)
      return supplemented
    })
    storeMocks.submitTaskWithData.mockResolvedValueOnce('task-supplement-1').mockResolvedValueOnce('task-supplement-2')

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const supplementButton = renderer!.root.findByProps({
      'aria-label': '补充缺口 2 条提示词并生成 4 张图片',
    })
    await act(async () => {
      supplementButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      2,
      '',
      expect.objectContaining({
        existingPrompts: expect.arrayContaining(['已有提示词']),
        maxBatchSize: SOP_PROGRESSIVE_PROMPT_BATCH_SIZE,
      }),
    )
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].prompt)).toEqual([
      '补充提示词 1',
      '补充提示词 2',
    ])
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].params.n)).toEqual([2, 2])
    expect(storeMocks.submitTaskWithData.mock.calls.map((call) => call[0].sopBatch.promptIndex)).toEqual([2, 3])
    expect(storeMocks.submitTaskWithData.mock.calls.every((call) => call[0].sopBatch.promptCount === 3)).toBe(true)

    const submittedSnapshots = dbMocks.putSopBatchSnapshot.mock.calls
      .map(([snapshot]) => snapshot as SopBatchSnapshot)
      .filter((snapshot) => snapshot.id === storedRun.id && snapshot.status === 'submitted')
    expect(submittedSnapshots.at(-1)).toMatchObject({
      prompts: [
        expect.objectContaining({ id: 'prompt-existing', text: '已有提示词' }),
        expect.objectContaining({ text: '补充提示词 1' }),
        expect.objectContaining({ text: '补充提示词 2' }),
      ],
      taskIds: ['task-existing', 'task-supplement-1', 'task-supplement-2'],
    })
    expect(submittedSnapshots.at(-1)?.batchIds).toEqual(expect.arrayContaining(['batch-existing']))
  })

  it('shows explicit supplement and regenerate-all actions after partial prompt generation', async () => {
    generateMocks.generatePromptsFromSopStore
      .mockResolvedValueOnce(['保留的提示词'])
      .mockResolvedValueOnce(['新提示词 1', '新提示词 2', '新提示词 3'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={3} onClose={vi.fn()} />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '生成 3 条 SOP 提示词' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      renderer!.root.findByProps({
        'aria-label': '补充缺口 2 条提示词并生成 2 张图片',
      }),
    ).toBeTruthy()
    const regenerateAllButton = renderer!.root.findByProps({
      'aria-label': '重新生成全部 3 条 SOP 提示词',
    })
    expect(
      renderer!.root
        .findAllByProps({ role: 'alert' })
        .some((node) => String(node.children.join('')).includes('补充缺口')),
    ).toBe(true)

    await act(async () => {
      regenerateAllButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore.mock.calls.map((call) => call[1])).toEqual([3, 3])
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('新提示词 1')
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('新提示词 2')
    selectPrompt(renderer!, 3)
    expect(renderer!.root.findByProps({ 'aria-label': '第 3 条提示词' }).props.value).toBe('新提示词 3')
    expect(storeState.setConfirmDialog).not.toHaveBeenCalled()
  })

  it('asks the host for attention instead of silently skipping auto-start when prompts remain', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-leftover',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      pinned: true,
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '上一批要求',
      referenceImageIds: [],
      promptCount: 2,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-1', text: '上一批残留提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 3,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 2,
        imagesPerPrompt: 1,
        availablePrompts: 1,
        brief: storedRun.brief,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)
    const onNeedsAttention = vi.fn()
    const onAutoStartConsumed = vi.fn()

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          autoStart
          onAutoStartConsumed={onAutoStartConsumed}
          onNeedsAttention={onNeedsAttention}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 静默运行时若在此处无声 return，用户按下发送将毫无反馈
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
    expect(onNeedsAttention).toHaveBeenCalledWith('existing-prompts')
    expect(onAutoStartConsumed).toHaveBeenCalledOnce()
  })

  it('does not restore reference images into the input bar in silent mode', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-silent-restore',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      pinned: true,
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '上一批要求',
      referenceImageIds: ['ref-image-1'],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [
        { id: 'prompt-1', text: '参考图提示词', origin: 'ai', edited: false, sourceId: 'source-1-ref-image-1' },
      ],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 1,
        imagesPerPrompt: 1,
        availablePrompts: 1,
        brief: storedRun.brief,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          autoStart
          visible={false}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 静默模式下只恢复提示词列表，不把历史参考图写回输入框
    expect(storeState.setInputImages).not.toHaveBeenCalled()
    expect(storeState.setInputImageFolder).not.toHaveBeenCalled()
  })

  it('shows saved prompt collections in one directory without starting a new generation', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-history',
      batchId: 'sop-batch-history',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'submitted',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '历史要求',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-history', text: '可查看的历史提示词', origin: 'ai', edited: false }],
      params: { ...DEFAULT_PARAMS },
    }
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByType('h3').some((node) => node.children.join('') === '提示词集')).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集时间线' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '查看提示词集 历史要求' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看全部提示词集' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看未归档提示词集' })).toHaveLength(0)
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('lists runs newest first without SOP grouping and labels their text model', async () => {
    const older = {
      ...createPromptRun('run-older', '旧版提示词'),
      createdAt: 10,
      updatedAt: 100,
      promptGenerationModel: 'gpt-old',
    }
    const newer = {
      ...createPromptRun('run-newer', '新版提示词'),
      createdAt: 20,
      updatedAt: 20,
      promptGenerationModel: 'gpt-new',
    }
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([older, newer])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    // 时间线平铺：无 SOP 分组，最新（newer）在最上面
    const runButtons = renderer!.root.findAll(
      (node) => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('查看提示词集 '),
    )
    expect(runButtons.map((node) => node.props['aria-label'])).toEqual([
      '查看提示词集 新版提示词',
      '查看提示词集 旧版提示词',
    ])
    expect(renderer!.root.findByProps({ title: '生成提示词的文本模型：gpt-new' }).children).toEqual(['gpt-new'])
    expect(renderer!.root.findAllByProps({ 'aria-label': 'SOP 分组 商品图 SOP，2 个提示词集' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '选择 新版提示词' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '选择 旧版提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '新建提示词集' }).props.className).toContain(
      'sop-prompt-run-create',
    )
  })

  it('opens previous prompts without an active SOP and keeps generation settings unchanged', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-library',
      title: '夏日海报提示词',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 30,
      status: 'ready',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '清爽、高对比',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 2,
      prompts: [
        {
          id: 'prompt-library',
          text: '无需 SOP 也能查看的历史提示词',
          origin: 'ai',
          edited: false,
          sourceId: 'text-to-image',
        },
      ],
      params: { ...DEFAULT_PARAMS, n: 2 },
    }
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findByProps({ 'aria-label': '查看提示词集 夏日海报提示词' })).toBeTruthy()
    const promptEditor = renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' })
    expect(promptEditor.props.value).toBe('无需 SOP 也能查看的历史提示词')
    expect(promptEditor.props.className).toContain('sop-prompt-detail-editor-input')
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集名称' }).props.value).toBe('夏日海报提示词')
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集名称' }).props.title).toBe('夏日海报提示词')
    expect(renderer!.root.findAllByProps({ 'aria-label': '重新生成第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '每生成一条提示词立即发送生图' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '生成 0 张图片' })).toHaveLength(0)
    expect(renderer!.root.findAllByType('button').some((button) => button.children.includes('添加提示词'))).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('completed')
    expect(storeState.setParams).not.toHaveBeenCalled()
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('shows generated thumbnails left of one editable prompt and groups its actions', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'run-with-images',
      title: '有图片的提示词集',
      batchId: 'batch-with-images',
      taskIds: ['task-with-images'],
      workspaceTabId: 'tab-a',
      createdAt: 10,
      status: 'submitted',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '' },
      brief: '',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [
        { id: 'prompt-with-images', text: '原始提交提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' },
      ],
      params: { ...DEFAULT_PARAMS },
    }
    storeState.tasks = [
      {
        id: 'task-with-images',
        prompt: '原始提交提示词',
        params: { ...DEFAULT_PARAMS },
        inputImageIds: [],
        outputImages: ['output-image-1'],
        revisedPromptByImage: { 'output-image-1': '图片反推后的提示词' },
        sopBatch: {
          batchId: 'batch-with-images',
          snapshotId: 'run-with-images',
          sopId: 'sop-1',
          sopName: '商品图 SOP',
          promptId: 'prompt-with-images',
          promptIndex: 1,
          promptCount: 1,
        },
        status: 'done',
        error: null,
        createdAt: 10,
        finishedAt: null,
        elapsed: null,
      } as TaskRecord,
    ]
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const promptRow = renderer!.root.findByProps({ id: 'prompt-output-prompt-with-images' })
    const mediaBlock = renderer!.root.findByProps({ 'data-slot': 'item-media' })
    const promptBlock = renderer!.root.findByProps({ 'data-slot': 'input-group' })
    expect(promptRow.props.className).toContain('grid-cols-[auto_minmax(0,1fr)]')
    expect(promptRow.props.className).toContain('items-start')
    expect(promptRow.props['data-slot']).toBe('item')
    expect(mediaBlock.props.className).toContain('flex-col')
    expect(renderer!.root.findByProps({ 'data-slot': 'item-content' })).toBeTruthy()
    expect(promptBlock.props.className).toContain('h-full')
    expect(promptBlock.props.className).toContain('flex-col')
    expect(promptBlock.findByProps({ 'data-slot': 'input-group-header' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ 'data-slot': 'item-header' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-slot': 'button-group' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词的生成结果' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '查看第 1 条提示词的生成图片 1' }).props.style.width).toBe('100%')
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词的功能与状态' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词操作' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '复制第 1 条提示词' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ children: '图片反推 / 改写提示词' })).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('图片反推后的提示词')
    expect(renderer!.root.findAllByProps({ 'aria-label': '定位第 1 条提示词' })).toHaveLength(0)
  })

  it('keeps the selected prompt in the detail pane without a redundant result view', async () => {
    const storedRun = createPromptRun('run-view-switch', '视图切换提示词集')
    storedRun.promptCount = 2
    storedRun.prompts = [
      { id: 'prompt-view-1', text: '第一条提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' },
      { id: 'prompt-view-2', text: '第二条提示词', origin: 'manual', edited: true, sourceId: 'text-to-image' },
    ]
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByProps({ role: 'tab' })).toHaveLength(0)
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('第二条提示词')
  })

  it('keeps collection creation separate from the single prompt add action', async () => {
    const storedRun = createPromptRun('run-actions', '操作提示词集')
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByProps({ 'aria-label': '新建提示词集' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'aria-label': '新增提示词' })).toHaveLength(1)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '新增提示词' }).props.onClick()
      await Promise.resolve()
    })

    expect(renderer!.root.findAllByProps({ 'data-slot': 'item' })).toHaveLength(2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' })).toBeTruthy()
  })

  it('creates and persists an independent prompt collection without an SOP', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const dialog = renderer!.root.findByProps({ role: 'dialog', 'aria-labelledby': 'gallery-sop-title' })
    expect(dialog.props.style).toMatchObject({
      height: 'min(88vh, 900px)',
      maxWidth: 'min(98vw, 1560px)',
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '新建提示词集' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '未命名提示词集',
        sop: expect.objectContaining({ id: 'prompt-library', name: '独立提示词集' }),
        status: 'ready',
      }),
    )
    expect(renderer!.root.findByProps({ 'aria-label': '提示词集名称' }).props.value).toBe('未命名提示词集')
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' })).toBeTruthy()
  })

  it('toggles and persists the prompt management large modal mode', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    act(() => {
      renderer!.root.findByProps({ 'aria-label': '进入 提示词管理大弹窗模式' }).props.onClick()
    })
    expect(
      renderer!.root.findByProps({ role: 'dialog', 'aria-labelledby': 'gallery-sop-title' }).props.style,
    ).toMatchObject({
      width: '80vw',
      height: '80vh',
      maxWidth: 'none',
    })

    act(() => renderer!.unmount())
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)
    expect(renderer!.root.findByProps({ 'aria-label': '退出 提示词管理大弹窗模式' }).props['aria-pressed']).toBe(true)
  })

  it('keeps the current prompt set in history when generating a new version', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-current',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '当前要求',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-current', text: '原提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: storedRun.id,
        selectedSopId: 'sop-1',
        promptCount: 1,
        imagesPerPrompt: 1,
        availablePrompts: 1,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['新提示词'])

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const regenerateButton = renderer!.root.findByProps({ 'aria-label': '再次生成 1 条 SOP 提示词' })
    await act(async () => {
      regenerateButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 「再次生成提示词」是明确的重新生成意图，无需二次确认
    expect(storeState.setConfirmDialog).not.toHaveBeenCalled()
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('新提示词')
    const pointer = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(pointer.activeRunId).not.toBe(storedRun.id)
  })

  it('does not restore prompts or parameters saved by a different SOP', async () => {
    const previousRun: SopBatchSnapshot = {
      id: 'sop-run-previous',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      status: 'ready',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '旧 SOP 要求',
      referenceImageIds: [],
      promptCount: 80,
      imagesPerPrompt: 4,
      prompts: [{ id: 'prompt-old', text: '旧 SOP 提示词', origin: 'ai', edited: false }],
      params: { ...DEFAULT_PARAMS, n: 4 },
    }
    window.localStorage.setItem(
      getGallerySopPromptRunStorageKey('tab-a'),
      JSON.stringify({
        version: 4,
        activeRunId: previousRun.id,
        selectedSopId: 'sop-1',
        promptCount: 80,
        imagesPerPrompt: 4,
        availablePrompts: 1,
      }),
    )
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([previousRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(previousRun)
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-2" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '生成 5 条 SOP 提示词' })).toBeTruthy()
    expect(storeState.setParams).not.toHaveBeenCalled()
  })

  it('generates and dispatches prompts sequentially, then resets for the next run', async () => {
    const events: string[] = []
    storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      events.push('generate-1')
      await options.onBatch?.(['第一条提示词'], 1, 2)
      events.push('generate-2')
      await options.onBatch?.(['第二条提示词'], 2, 2)
      return ['第一条提示词', '第二条提示词']
    })
    storeMocks.submitTaskWithData.mockImplementation(async ({ prompt }) => {
      events.push(`dispatch-${prompt}`)
      return prompt === '第一条提示词' ? 'task-1' : 'task-2'
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          initialAutoGenerate
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      2,
      '',
      expect.objectContaining({
        maxBatchSize: SOP_PROGRESSIVE_PROMPT_BATCH_SIZE,
        onBatch: expect.any(Function),
      }),
    )
    expect(events).toEqual(['generate-1', 'dispatch-第一条提示词', 'generate-2', 'dispatch-第二条提示词'])
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(storeMocks.submitTaskWithData.mock.calls[0][0].sopBatch).toMatchObject({ promptIndex: 1, promptCount: 2 })
    expect(storeMocks.submitTaskWithData.mock.calls[1][0].sopBatch).toMatchObject({ promptIndex: 2, promptCount: 2 })
    expect(storeMocks.submitTaskWithData.mock.calls[0][0].sopBatch.batchId).toBe(
      storeMocks.submitTaskWithData.mock.calls[1][0].sopBatch.batchId,
    )
    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '生成 2 条 SOP 提示词' }).props.disabled).toBe(false)
    expect(
      renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('当前 SOP：商品图 SOP')),
    ).toBe(true)
    expect(storeState.inputImages).toEqual([{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }])
    expect(JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 0,
    })
  })

  it('continues the progressive run when one image task fails to dispatch', async () => {
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      await options.onBatch?.(['会失败的提示词'], 1, 2)
      await options.onBatch?.(['会成功的提示词'], 2, 2)
      return ['会失败的提示词', '会成功的提示词']
    })
    storeMocks.submitTaskWithData.mockRejectedValueOnce(new Error('图片接口暂时不可用')).mockResolvedValueOnce('task-2')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          initialAutoGenerate
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('会失败的提示词')
    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('会成功的提示词')
    expect(
      renderer!.root
        .findAllByProps({ role: 'alert' })
        .some((node) => String(node.children.join('')).includes('部分提示词未创建生图任务')),
    ).toBe(true)
  })

  it('generates and submits each prompt with only its corresponding reference image', async () => {
    storeState.inputImages = [
      { id: 'image-1', dataUrl: 'data:image/png;base64,one' },
      { id: 'image-2', dataUrl: 'data:image/png;base64,two' },
    ]
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => [
      `${options.context.sourceLabel}提示词`,
    ])
    storeMocks.submitTaskWithData.mockResolvedValueOnce('task-1').mockResolvedValueOnce('task-2')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={2}
          initialImagesPerPrompt={2}
          initialBrief="夏日清爽，不要人物"
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '夏日清爽，不要人物',
      expect.objectContaining({
        referenceImages: [{ name: '图1', dataUrl: 'data:image/png;base64,one' }],
      }),
    )
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '夏日清爽，不要人物',
      expect.objectContaining({
        referenceImages: [{ name: '图2', dataUrl: 'data:image/png;base64,two' }],
      }),
    )
    const firstReferenceButton = renderer!.root.findByProps({ title: '图1 · 点击查看大图' })
    expect(renderer!.root.findAllByProps({ title: '图2 · 点击查看大图' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看第 1 条提示词的参考图 1 大图' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'aria-label': '查看第 1 条提示词的参考图 2 大图' })).toHaveLength(0)

    act(() => firstReferenceButton.props.onClick())
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'gallery-sop-reference-preview-title' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ alt: '图1' })).toHaveLength(3)

    act(() => renderer!.root.findByProps({ 'aria-label': '关闭参考图大图预览' }).props.onClick())
    expect(renderer!.root.findAllByProps({ 'aria-label': '关闭参考图大图预览' })).toHaveLength(0)

    selectPrompt(renderer!, 2)
    expect(renderer!.root.findByProps({ title: '图2 · 点击查看大图' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '查看第 2 条提示词的参考图 1 大图' })).toBeTruthy()

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 4 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        inputImages: [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }],
        params: expect.objectContaining({ n: 2, reference_mode: 'cycle' }),
      }),
      { silentSuccess: true },
    )
    expect(storeMocks.submitTaskWithData).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        inputImages: [{ id: 'image-2', dataUrl: 'data:image/png;base64,two' }],
        params: expect.objectContaining({ n: 2, reference_mode: 'cycle' }),
      }),
      { silentSuccess: true },
    )
    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: '夏日清爽，不要人物',
        referenceImageIds: ['image-1', 'image-2'],
        promptCount: 2,
        imagesPerPrompt: 2,
        prompts: [
          expect.objectContaining({ referenceImageIds: ['image-1'] }),
          expect.objectContaining({ referenceImageIds: ['image-2'] }),
        ],
        params: expect.objectContaining({ n: 2, reference_mode: 'cycle' }),
      }),
    )
  })

  it('supports more than sixteen references without combining them', async () => {
    storeState.inputImages = Array.from({ length: 17 }, (_, index) => ({
      id: `image-${index + 1}`,
      dataUrl: `data:image/png;base64,image-${index + 1}`,
    }))
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => [
      `${options.context.sourceLabel}提示词`,
    ])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={17}
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledTimes(17)
    expect(
      generateMocks.generatePromptsFromSopStore.mock.calls.every((call) => call[3].referenceImages?.length === 1),
    ).toBe(true)

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 17 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(17)
    expect(storeMocks.submitTaskWithData.mock.calls.every((call) => call[0].inputImages.length === 1)).toBe(true)
  })

  it('fixes the batch-start project folder on every submitted task instead of following folder switches', async () => {
    const { useAssetLibraryStore } = await import('../../assetLibrary/store')
    const previousScope = useAssetLibraryStore.getState().scope
    try {
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'col-start-folder' } })
      storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
      generateMocks.generatePromptsFromSopStore.mockResolvedValue(['固定文件夹提示词'])
      storeMocks.submitTaskWithData.mockResolvedValue('task-1')
      let renderer: ReturnType<typeof create>

      await act(async () => {
        renderer = create(
          <GallerySopBatchModal
            workspaceTabId="tab-a"
            initialSopId="sop-1"
            initialPromptCount={1}
            autoStart
            onClose={vi.fn()}
          />,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      mountedRenderers.push(renderer!)

      // 批次启动后用户切到别的文件夹（模拟生成过程中切换）
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'col-switched-mid-batch' } })

      const startButton = renderer!.root
        .findAllByType('button')
        .find((button) => button.props['aria-label'] === '生成 1 张图片')
      await act(async () => {
        startButton!.props.onClick()
        await Promise.resolve()
      })

      // 提交的任务应固定使用批次启动时的文件夹
      expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(
        expect.objectContaining({ defaultCollectionId: 'col-start-folder' }),
        { silentSuccess: true },
      )
    } finally {
      useAssetLibraryStore.setState({ scope: previousScope })
    }
  })

  it('uses references for prompt generation only when second reference is off', async () => {
    storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['仅提示词阶段参考'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '',
      expect.objectContaining({
        referenceImages: [{ name: '图1', dataUrl: 'data:image/png;base64,one' }],
      }),
    )

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 1 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(expect.objectContaining({ inputImages: [] }), {
      silentSuccess: true,
    })
  })

  it('submits a high-volume SOP batch without a confirmation popup', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['高数量提示词'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          initialImagesPerPrompt={20}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const startButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '生成 20 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeState.setConfirmDialog).not.toHaveBeenCalled()
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledOnce()
  })
})

describe('GallerySopBatchModal folder isolation', () => {
  it('keeps separate prompt runs per folder within the same workspace tab', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['文件夹A的提示词'])
    let rendererA: ReturnType<typeof create>
    await act(async () => {
      rendererA = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          folderKey="folder-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(rendererA!)

    const keyA = getGallerySopPromptRunStorageKey('tab-a', 'folder-a')
    const keyB = getGallerySopPromptRunStorageKey('tab-a', 'folder-b')

    await act(async () => {
      rendererA!.root.findByProps({ 'aria-label': '生成 1 条 SOP 提示词' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    // 草稿写入 folder-a 的独立 key;folder-b 没有该数据
    expect(JSON.parse(window.localStorage.getItem(keyA) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 1,
    })
    expect(window.localStorage.getItem(keyB)).toBeNull()

    // 同标签页另一个文件夹:独立实例与草稿,不继承 folder-a 的提示词
    let rendererB: ReturnType<typeof create>
    await act(async () => {
      rendererB = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          folderKey="folder-b"
          initialSopId="sop-2"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(rendererB!)
    expect(rendererB!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    // folder-a 的草稿保持完好
    expect(JSON.parse(window.localStorage.getItem(keyA) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 1,
    })
  })

  it('anchors the remaining series members to the first picture of their group', async () => {
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      const prompts = [
        '系列统一规范（非画面文字）：蓝色背景\n本张画面：咖啡杯',
        '系列统一规范（非画面文字）：蓝色背景\n本张画面：茶杯',
        '系列统一规范（非画面文字）：蓝色背景\n本张画面：水壶',
      ]
      await options.onBatch?.(prompts, 1, 1)
      return prompts
    })
    storeMocks.ensureImageCached.mockResolvedValue('data:image/png;base64,anchor')
    storeMocks.submitTaskWithData.mockImplementation(
      async (data: { prompt: string; sopBatch?: TaskRecord['sopBatch'] }) => {
        // 首图出图后，同组其余画面才拿得到锚定参考图
        if (data.sopBatch?.series?.seriesIndex === 1) {
          storeState.tasks = [
            {
              id: 'task-anchor',
              prompt: data.prompt,
              params: { ...DEFAULT_PARAMS },
              inputImageIds: [],
              outputImages: ['image-anchor'],
              sopBatch: data.sopBatch,
              status: 'done',
              error: null,
              createdAt: 10,
              finishedAt: 20,
              elapsed: 10,
            } as TaskRecord,
          ]
          return 'task-anchor'
        }
        return 'task-member'
      },
    )

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-series"
          initialPromptCount={1}
          initialSeriesMode
          autoStart
          onAutoStartConsumed={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findAllByProps({ 'aria-label': '生成 3 张图片' })[0].props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(3)
    const calls = storeMocks.submitTaskWithData.mock.calls.map(([data]) => data)
    expect(calls[0].inputImages).toEqual([])
    expect(calls[0].prompt).not.toContain(SOP_SERIES_ANCHOR_INSTRUCTION)
    for (const call of calls.slice(1)) {
      expect(call.inputImages).toEqual([{ id: 'image-anchor', dataUrl: 'data:image/png;base64,anchor' }])
      expect(call.prompt.startsWith(SOP_SERIES_ANCHOR_INSTRUCTION)).toBe(true)
    }
  })

  it('defers series member dispatch to the anchor without blocking the prompt batch loop', async () => {
    const events: string[] = []
    let releaseAnchor: (() => void) | null = null
    const anchorReady = new Promise<void>((resolve) => {
      releaseAnchor = resolve
    })
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      const group = [
        '系列统一规范（非画面文字）：蓝色背景\n本张画面：咖啡杯',
        '系列统一规范（非画面文字）：蓝色背景\n本张画面：茶杯',
        '系列统一规范（非画面文字）：蓝色背景\n本张画面：水壶',
      ]
      await options.onBatch?.([...group, ...group], 2, 2)
      events.push('generate-resolved')
      return [...group, ...group]
    })
    storeMocks.ensureImageCached.mockResolvedValue('data:image/png;base64,anchor')
    storeMocks.submitTaskWithData.mockImplementation(async (data: { sopBatch?: TaskRecord['sopBatch'] }) => {
      if (data.sopBatch?.series?.seriesIndex === 1) {
        events.push('dispatch-first')
        // 首图任务先不出图：释放 anchorReady 后才作为锚定参考可用
        void anchorReady.then(() => {
          storeState.tasks = [
            {
              id: 'task-anchor',
              prompt: 'anchor',
              params: { ...DEFAULT_PARAMS },
              inputImageIds: [],
              outputImages: ['image-anchor'],
              status: 'done',
              error: null,
              createdAt: 10,
              finishedAt: 20,
              elapsed: 10,
            } as TaskRecord,
          ]
        })
        return 'task-anchor'
      }
      events.push('dispatch-member')
      return 'task-member'
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-series"
          initialPromptCount={2}
          initialSeriesMode
          initialAutoGenerate
          autoStart
          onAutoStartConsumed={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    mountedRenderers.push(renderer!)

    // 锚定异步化的核心锚点：提示词批次收尾时只提交了两个组首图，组内成员全部挂在后台等锚定
    expect(events).toEqual(['dispatch-first', 'dispatch-first', 'generate-resolved'])
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)

    // 首图出图后（waitForSopSeriesAnchor 轮询间隔 800ms），后台成员带锚定参考图提交
    await act(async () => {
      releaseAnchor?.()
      await new Promise((resolve) => setTimeout(resolve, 1000))
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(6)
    const calls = storeMocks.submitTaskWithData.mock.calls.map(([data]) => data)
    expect(calls.slice(0, 2).map((call) => call.inputImages)).toEqual([[], []])
    expect(calls.slice(0, 2).every((call) => !call.prompt.startsWith(SOP_SERIES_ANCHOR_INSTRUCTION))).toBe(true)
    for (const call of calls.slice(2)) {
      expect(call.inputImages).toEqual([{ id: 'image-anchor', dataUrl: 'data:image/png;base64,anchor' }])
      expect(call.prompt.startsWith(SOP_SERIES_ANCHOR_INSTRUCTION)).toBe(true)
    }
    expect(events).toEqual([
      'dispatch-first',
      'dispatch-first',
      'generate-resolved',
      'dispatch-member',
      'dispatch-member',
      'dispatch-member',
      'dispatch-member',
    ])

    // 系列图一次只请求 1 组提示词（一组 = 一条含 3 段的内容，由客户端拆成 3 条成员提示词），
    // 而不是一次要模型规划多组 —— 组间差异必须逐组独立规划，母图锚定也只等本组首图。
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-series' }),
      2,
      '',
      expect.objectContaining({ maxBatchSize: SOP_SERIES_PROGRESSIVE_GROUP_BATCH_SIZE }),
    )
  })
})
