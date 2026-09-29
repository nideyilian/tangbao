import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SopLibraryItem } from '../types'
import type { SopCampaignRecipeConfig } from '../types'

/**
 * 配方卡 → 引擎生提示词 链路的修复回归测试。
 *
 * 覆盖 2026-09-20 排查出的四类缺陷：
 * 1. 占位符残留会带着 `{{未定义}}` 直接送去生图（无任何拦截）；
 * 2. 骨架命中合规红线被整段清空时，报错文案指向「缺少骨架」这个假原因；
 * 3. 候选池被截断 / 候选值被红线剔除，用户完全无感知；
 * 4. 「取消」在本地采样分支点了没反应（signal 未贯穿）。
 */

const storeMocks = vi.hoisted(() => ({
  submitTaskWithData: vi.fn(),
  getSopBatchSnapshots: vi.fn(async () => [] as unknown[]),
  /**
   * 当前设置（含配方卡红线词表）。**用属性访问而不是解构捕获** ——
   * 测试里会整体替换这个对象来模拟「用户在配方卡里改了词表」，getState 每次读到的是新的那份。
   */
  settings: { model: 'gpt-test' } as {
    model: string
    recipeForbiddenTerms?: string[]
    /** 红线总开关（TB-147）：不设 = 关闭。 */
    recipeForbiddenEnabled?: boolean
  },
}))

vi.mock('../../../lib/apiProfiles', () => ({
  DEFAULT_API_TIMEOUT: 600,
  getAgentTextApiProfile: () => ({
    provider: 'openai',
    apiMode: 'responses',
    name: 'Agent 测试',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    timeout: 600,
    apiProxy: false,
  }),
  getAgentTextProtocol: () => 'responses',
  validateApiProfile: () => null,
}))

vi.mock('../../../lib/devProxy', () => ({
  buildApiUrl: () => 'https://api.example.com/v1/responses',
  readClientDevProxyConfig: () => ({}),
  shouldUseApiProxy: () => false,
}))

vi.mock('../../../store', () => ({
  submitTaskWithData: storeMocks.submitTaskWithData,
  useStore: {
    getState: () => ({
      settings: storeMocks.settings,
      addTask: vi.fn(),
      notifyError: vi.fn(),
      showToast: vi.fn(),
    }),
    setState: vi.fn(),
  },
}))

vi.mock('../../../lib/db', () => ({
  getAllSopBatchSnapshots: storeMocks.getSopBatchSnapshots,
  putSopBatchSnapshot: vi.fn(),
  getSopBatchSnapshot: vi.fn(),
  deleteSopBatchSnapshot: vi.fn(),
}))

const { generateCampaignRecipePromptsFromStore } = await import('./storeSopGeneration')

function makeRecipeSop(recipe: SopCampaignRecipeConfig): SopLibraryItem {
  return {
    id: 'sop-recipe-1',
    name: '测试配方卡',
    description: '',
    content: '',
    kind: 'campaign-recipe',
    executionMode: 'campaign-recipe',
    campaignRecipe: recipe,
    source: 'manual',
    createdBy: 'test',
    createdAt: Date.parse('2026-09-20T00:00:00.000Z'),
    updatedAt: Date.parse('2026-09-20T00:00:00.000Z'),
  }
}

const healthyRecipe: SopCampaignRecipeConfig = {
  body: '{{主视觉}}，主体是{{主体}}',
  dimensions: [
    { name: '主视觉', options: ['产品特写', '手持使用', '使用场景'] },
    { name: '主体', options: ['咖啡杯', '保温杯', '玻璃杯'] },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  // 红线**总开关**（TB-147）实际默认是关的；这个文件里的用例多数测的是「命中红线」的行为，
  // 所以在脚手架里默认打开，要测「关闭」的用例自己覆盖成 false（见文件末尾那两条）。
  storeMocks.settings = { model: 'gpt-test', recipeForbiddenEnabled: true }
  storeMocks.getSopBatchSnapshots.mockResolvedValue([])
})

describe('配方卡引擎：占位符残留拦截', () => {
  it('骨架里的维度名与维度定义对不上时直接报错，不把带 {{}} 的提示词放出去', async () => {
    // 骨架写 {{场景}}，维度却定义成「场景名」—— 典型的手写笔误
    const broken: SopCampaignRecipeConfig = {
      body: '{{场景}}，主体是{{主体}}',
      dimensions: [
        { name: '场景名', options: ['棚拍', '外景'] },
        { name: '主体', options: ['咖啡杯', '保温杯'] },
      ],
    }

    await expect(generateCampaignRecipePromptsFromStore(makeRecipeSop(broken), 2, '', { exact: true })).rejects.toThrow(
      /未替换的占位符\s*\{\{场景\}\}/,
    )
  })

  it('报错信息点名是哪个占位符，而不是只说「生成失败」', async () => {
    const broken: SopCampaignRecipeConfig = {
      body: '{{甲}}{{乙}}',
      dimensions: [
        { name: '甲', options: ['A1', 'A2'] },
        { name: '丙', options: ['C1', 'C2'] },
      ],
    }

    const error = await generateCampaignRecipePromptsFromStore(makeRecipeSop(broken), 1, '', {
      exact: true,
    }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('{{乙}}')
    expect((error as Error).message).toContain('完全一致')
  })

  it('占位符全部能对上时不报错（不误伤正常配方卡）', async () => {
    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(healthyRecipe), 3, '', {
      exact: true,
    })
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(/\{\{|\}\}/)
    }
  })

  it('单花括号写法对不上维度名时同样被拦下', async () => {
    // renderRecipeBody 对 {X} 也是「对不上就原样保留」，同样会漏到模型
    const broken: SopCampaignRecipeConfig = {
      body: '{主视觉}，主体是{不存在的维度}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '手持使用'] },
        { name: '主体', options: ['咖啡杯', '保温杯'] },
      ],
    }

    await expect(generateCampaignRecipePromptsFromStore(makeRecipeSop(broken), 1, '', { exact: true })).rejects.toThrow(
      /未替换的占位符/,
    )
  })
})

/**
 * TB-142：骨架命中红线**不再中断生成、也不再清空骨架**。
 *
 * 原行为是「骨架整段清空 + 抛错」，误判（词表里那个词太宽，如「提现」「军」撞正常文案）时
 * 用户看到的是一整批 0 条 + 「请在配方卡页检查骨架文案」—— 而骨架本身没毛病。
 * 现在只提示，由用户裁决：删掉误判的那个词（改词表），或者改写骨架。
 */
describe('配方卡引擎：骨架命中红线只提示、不中断（TB-142）', () => {
  /** 「稳赚」是内置默认红词汇里的词 */
  const cashOutRecipe: SopCampaignRecipeConfig = {
    body: '稳赚不赔的{{主视觉}}',
    dimensions: [
      { name: '主视觉', options: ['产品特写', '手持使用'] },
      { name: '主体', options: ['咖啡杯', '保温杯'] },
    ],
  }

  it('骨架命中红线时照常产出，并把「命中骨架」通过 onSanitized 报给调用方', async () => {
    const onSanitized = vi.fn()

    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(cashOutRecipe), 2, '', {
      exact: true,
      onSanitized,
    })

    // 旧行为：骨架被清空 ⇒ 抛错（0 条）
    expect(prompts).toHaveLength(2)
    // 骨架一个字没动：命中词照旧出现在产出里（删词还是改文案，由用户决定）
    expect(prompts[0]).toContain('稳赚')
    const removed = onSanitized.mock.calls[0][0] as string[]
    expect(removed.join('；')).toContain('提示词骨架')
    expect(removed.join('；')).toContain('稳赚')
  })

  it('用户把该词从词表里删掉之后，生成链路不再报命中（改词表确实生效）', async () => {
    const onSanitized = vi.fn()
    storeMocks.settings = { model: 'gpt-test', recipeForbiddenTerms: ['提现'] }

    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(cashOutRecipe), 2, '', {
      exact: true,
      onSanitized,
    })

    expect(prompts).toHaveLength(2)
    expect(onSanitized).not.toHaveBeenCalled()
  })

  it('没有配过词表时按内置默认表判定（老存档行为不变）', async () => {
    const onSanitized = vi.fn()
    const recipe: SopCampaignRecipeConfig = {
      body: '{{主视觉}}，主体是{{主体}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '稳赚促销', '使用场景'] },
        { name: '主体', options: ['咖啡杯', '保温杯', '玻璃杯'] },
      ],
    }

    await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 4, '', { exact: true, onSanitized })
    expect((onSanitized.mock.calls[0][0] as string[]).join('；')).toContain('稳赚促销')
  })

  it('把词表清空（空数组）后候选值也不再剔除（红线全关）', async () => {
    const onSanitized = vi.fn()
    storeMocks.settings = { model: 'gpt-test', recipeForbiddenTerms: [] }
    const recipe: SopCampaignRecipeConfig = {
      body: '{{主视觉}}，主体是{{主体}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '稳赚促销', '使用场景'] },
        { name: '主体', options: ['咖啡杯', '保温杯', '玻璃杯'] },
      ],
    }

    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 4, '', {
      exact: true,
      onSanitized,
    })
    expect(prompts).toHaveLength(4)
    expect(onSanitized).not.toHaveBeenCalled()
  })

  it('候选值命中红线时不算致命错误，只在剔除后正常产出', async () => {
    const recipe: SopCampaignRecipeConfig = {
      body: '{{主视觉}}，主体是{{主体}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '稳赚促销', '使用场景'] },
        { name: '主体', options: ['咖啡杯', '保温杯', '玻璃杯'] },
      ],
    }

    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 4, '', {
      exact: true,
    })
    expect(prompts).toHaveLength(4)
    for (const prompt of prompts) {
      expect(prompt).not.toContain('稳赚')
    }
  })

  /**
   * ⭐ 成对守卫（TB-147）：**同一条**命中红线的候选值，开关关着就保留、开着就剔除。
   *
   * 单测「关闭时保留」会被「压根没配词表」蒙混过去（两者结果一样），所以必须成对 ——
   * 上面那条就是「开着 → 剔除」的那一半。
   */
  it('总开关关闭时：命中的候选值照常保留、也不回调 onSanitized', async () => {
    const recipe: SopCampaignRecipeConfig = {
      body: '{{主视觉}}，主体是{{主体}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '稳赚促销'] },
        { name: '主体', options: ['咖啡杯', '保温杯'] },
      ],
    }
    storeMocks.settings = { model: 'gpt-test', recipeForbiddenEnabled: false, recipeForbiddenTerms: ['稳赚'] }
    const onSanitized = vi.fn()

    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 4, '', {
      exact: true,
      onSanitized,
    })

    expect(onSanitized).not.toHaveBeenCalled()
    expect(prompts.some((prompt) => prompt.includes('稳赚'))).toBe(true)
  })

  it('总开关关闭时：骨架命中也不回执（提示与剔除同源，不会只剩一半）', async () => {
    const recipe: SopCampaignRecipeConfig = {
      body: '稳赚的{{主视觉}}',
      dimensions: [{ name: '主视觉', options: ['产品特写', '使用场景'] }],
    }
    storeMocks.settings = { model: 'gpt-test', recipeForbiddenEnabled: false, recipeForbiddenTerms: ['稳赚'] }
    const onSanitized = vi.fn()

    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 2, '', {
      exact: true,
      onSanitized,
    })

    expect(prompts).toHaveLength(2)
    expect(onSanitized).not.toHaveBeenCalled()
  })

  it('剔除候选值时通过 onSanitized 回调告知调用方', async () => {
    const onSanitized = vi.fn()
    const recipe: SopCampaignRecipeConfig = {
      body: '{{主视觉}}，{{主体}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '日赚轻松', '使用场景'] },
        { name: '主体', options: ['咖啡杯', '保温杯', '玻璃杯'] },
      ],
    }

    await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 3, '', {
      exact: true,
      onSanitized,
    })

    expect(onSanitized).toHaveBeenCalledTimes(1)
    const removed = onSanitized.mock.calls[0][0] as string[]
    expect(removed.join('；')).toContain('日赚轻松')
  })
})

describe('配方卡引擎：候选池截断提示', () => {
  it('候选值超过单维上限时通过 onTruncated 回调告知调用方', async () => {
    const onTruncated = vi.fn()
    // MAX_DIMENSION_OPTIONS = 400，造 401 条触发截断
    const oversized = Array.from({ length: 401 }, (_, index) => `选项${index}`)
    const recipe: SopCampaignRecipeConfig = {
      body: '{{大池}}，{{主体}}',
      dimensions: [
        { name: '大池', options: oversized },
        { name: '主体', options: ['咖啡杯', '保温杯'] },
      ],
    }

    await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 2, '', {
      exact: true,
      onTruncated,
    })

    expect(onTruncated).toHaveBeenCalledTimes(1)
    expect(onTruncated.mock.calls[0][0]).toEqual(['大池'])
  })

  it('未超上限时不触发 onTruncated（不误报）', async () => {
    const onTruncated = vi.fn()
    await generateCampaignRecipePromptsFromStore(makeRecipeSop(healthyRecipe), 3, '', {
      exact: true,
      onTruncated,
    })
    expect(onTruncated).not.toHaveBeenCalled()
  })
})

describe('配方卡引擎：取消贯穿本地采样', () => {
  it('signal 已中止时立即抛 AbortError，不产出任何提示词', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('提示词生成已取消', 'AbortError'))

    const error = await generateCampaignRecipePromptsFromStore(makeRecipeSop(healthyRecipe), 5, '', {
      exact: true,
      signal: controller.signal,
    }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
  })

  it('大池采样时中途取消能生效（不再等到整批跑完）', async () => {
    const controller = new AbortController()
    const oversized = Array.from({ length: 400 }, (_, index) => `选项${index}`)
    const recipe: SopCampaignRecipeConfig = {
      body: '{{大池}}，{{主体}}',
      dimensions: [
        { name: '大池', options: oversized },
        { name: '主体', options: ['咖啡杯', '保温杯'] },
      ],
    }

    // 一进入就取消：即使请求 200 条也不该产出结果
    controller.abort(new DOMException('提示词生成已取消', 'AbortError'))

    await expect(
      generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 200, '', {
        exact: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/取消/)
  })

  it('未传 signal 时行为不变（向后兼容）', async () => {
    const prompts = await generateCampaignRecipePromptsFromStore(makeRecipeSop(healthyRecipe), 3, '', {
      exact: true,
    })
    expect(prompts).toHaveLength(3)
  })
})
