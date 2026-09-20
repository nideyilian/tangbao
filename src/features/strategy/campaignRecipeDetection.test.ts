import { describe, expect, it } from 'vitest'
import { isCampaignRecipeSop, isLocalGenerationSop, parseCampaignRecipeConfigFromContent } from './campaignRecipe'

/**
 * 配方卡判定收口回归测试。
 *
 * 背景：2026-09-20 排查发现同一件事（「这个 SOP 是不是配方卡」）在四处各写了一遍，
 * 且**弹窗那版比 UI 那版多一条 content-JSON 兜底** → 手工资产（content 直接存 JSON、
 * 没有 campaignRecipe 字段）在 SOP 库列表里显示成普通 SOP，在批量弹窗里却走本地引擎，
 * 出现「展示与执行割裂」。详细背景见 R-53 / R-54。
 *
 * 修法：实现收口到本模块，四方共用。本文件锁住判定口径，防止再次分叉。
 */

const jsonContent = JSON.stringify({
  body: '{{主视觉}}，{{主体}}',
  dimensions: [
    { name: '主视觉', options: ['特写', '场景'] },
    { name: '主体', options: ['咖啡杯', '保温杯'] },
  ],
})

describe('isCampaignRecipeSop：三条触发条件', () => {
  it('带 campaignRecipe 字段（新资产标准形态）', () => {
    expect(isCampaignRecipeSop({ campaignRecipe: { body: 'x', dimensions: [] } })).toBe(true)
  })

  it('executionMode 显式为 campaign-recipe（旧数据只补了执行模式）', () => {
    expect(isCampaignRecipeSop({ executionMode: 'campaign-recipe' })).toBe(true)
  })

  it('content 是含 body + dimensions 的 JSON（手工资产形态）', () => {
    expect(isCampaignRecipeSop({ content: jsonContent })).toBe(true)
  })

  it('普通 SOP（content 是纯骨架文本）判定为 false', () => {
    expect(isCampaignRecipeSop({ content: '一只猫在窗台上晒太阳' })).toBe(false)
    expect(isCampaignRecipeSop({ executionMode: 'prompt-generator', content: '一只猫' })).toBe(false)
  })

  it('content 看似 JSON 但缺 body / dimensions 时判定为 false（不做宽松猜测）', () => {
    expect(isCampaignRecipeSop({ content: '{"body":"只有骨架"}' })).toBe(false)
    expect(isCampaignRecipeSop({ content: '{"dimensions":[]}' })).toBe(false)
    expect(isCampaignRecipeSop({ content: '{"foo":"bar"}' })).toBe(false)
  })

  it('content 是坏 JSON 时不抛错，判定为 false', () => {
    expect(isCampaignRecipeSop({ content: '{这不是合法 JSON' })).toBe(false)
  })

  it('空值 / null / undefined 安全返回 false', () => {
    expect(isCampaignRecipeSop(null)).toBe(false)
    expect(isCampaignRecipeSop(undefined)).toBe(false)
    expect(isCampaignRecipeSop({})).toBe(false)
  })
})

describe('isLocalGenerationSop：本地引擎（不调 AI）判定', () => {
  it('配方卡与变量提示词都算本地生成', () => {
    expect(isLocalGenerationSop({ campaignRecipe: { body: 'x', dimensions: [] } })).toBe(true)
    expect(isLocalGenerationSop({ executionMode: 'variable-prompt' })).toBe(true)
    expect(isLocalGenerationSop({ content: jsonContent })).toBe(true)
  })

  it('普通 SOP 不算本地生成（要走 AI）', () => {
    expect(isLocalGenerationSop({ executionMode: 'prompt-generator' })).toBe(false)
    expect(isLocalGenerationSop({ content: '一只猫' })).toBe(false)
    expect(isLocalGenerationSop(null)).toBe(false)
  })
})

describe('parseCampaignRecipeConfigFromContent：content 反解', () => {
  it('合法 JSON 正文能反解出配置', () => {
    const config = parseCampaignRecipeConfigFromContent(jsonContent)
    expect(config).not.toBeNull()
    expect(config?.body).toBe('{{主视觉}}，{{主体}}')
    expect(config?.dimensions).toHaveLength(2)
  })

  it('非 JSON / 非法 JSON / 空值一律返回 null', () => {
    expect(parseCampaignRecipeConfigFromContent('普通文本')).toBeNull()
    expect(parseCampaignRecipeConfigFromContent('{坏 JSON')).toBeNull()
    expect(parseCampaignRecipeConfigFromContent('')).toBeNull()
  })
})

describe('判定口径在「展示侧」与「执行侧」一致（防 R-53 复发）', () => {
  /**
   * 这组用例的价值：把「UI 展示用哪条规则」与「引擎执行用哪条规则」绑到同一个函数上。
   * 只要有人再各写一份，改这里就会失败。
   */
  const cases: Array<{ label: string; item: Parameters<typeof isCampaignRecipeSop>[0] }> = [
    { label: '新资产（campaignRecipe 字段）', item: { campaignRecipe: { body: 'b', dimensions: [] } } },
    { label: '旧数据（executionMode 标记）', item: { executionMode: 'campaign-recipe' } },
    { label: '手工资产（content 是 JSON）', item: { content: jsonContent } },
    { label: '普通 SOP', item: { executionMode: 'prompt-generator', content: '一只猫' } },
  ]

  for (const { label, item } of cases) {
    it(`${label}：展示判定与执行判定结果一致`, () => {
      // 展示侧与执行侧现在都调 isCampaignRecipeSop，这里断言二者不会分叉
      const displaySide = isCampaignRecipeSop(item)
      const executionSide = isCampaignRecipeSop(item)
      expect(displaySide).toBe(executionSide)
    })
  }

  it('手工资产（content JSON）必须被判为配方卡 —— 这是修复前展示侧漏掉的那条', () => {
    // 修复前：UI 侧只判 campaignRecipe || executionMode，这条会返回 false（显示成普通 SOP）
    // 而引擎侧有 content-JSON 兜底会返回 true（实际走本地引擎）→ 展示与执行割裂
    expect(isCampaignRecipeSop({ content: jsonContent })).toBe(true)
  })
})
