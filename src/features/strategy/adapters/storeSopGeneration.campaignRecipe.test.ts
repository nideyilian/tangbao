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
      settings: { model: 'gpt-test' },
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

describe('配方卡引擎：合规红线清空骨架时报错指向真因', () => {
  it('骨架命中红线时，报错说明是「命中红线被移除」而不是「缺少骨架」', async () => {
    const recipe: SopCampaignRecipeConfig = {
      // 「稳赚」是内置红线词
      body: '稳赚不赔的{{主视觉}}',
      dimensions: [
        { name: '主视觉', options: ['产品特写', '手持使用'] },
        { name: '主体', options: ['咖啡杯', '保温杯'] },
      ],
    }

    const error = await generateCampaignRecipePromptsFromStore(makeRecipeSop(recipe), 1, '', {
      exact: true,
    }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('命中合规红线')
    // 关键：不能再说「缺少提示词骨架」——骨架明明在，那样的文案会把排查带偏
    expect(message).not.toContain('缺少提示词骨架')
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
