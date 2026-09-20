import { describe, expect, it } from 'vitest'
import { countRecipeEnglishOptions, computeRecipeCombinationCount } from './SopCampaignRecipePanel'

/**
 * 配方卡面板的两个纯计算函数回归测试。
 *
 * 背景（2026-09-20 排查）：
 * - 「解析成功」提示条里的组合数是**当场手算**的（`dimensions.reduce(total * options.length)`），
 *   而面板本身的 `combinationCount` 过滤了空候选值 —— 两处口径不同，
 *   提示的数字比实际能跑出来的组合大。用户按提示的规模去配数量会拿到重复提示词。
 * - `englishByOption`（原资产的 en 字段）被解析器提取后**没有任何下游**，
 *   用户完全不知道解析器读到了它。现在在提示条里明确告知「已识别、不参与采样」。
 *
 * 这两个函数抽成模块级导出，就是为了让面板（没有组件测试）的核心计算可被直接覆盖。
 */

describe('computeRecipeCombinationCount：组合空间大小', () => {
  it('各维度有效候选值数量之积', () => {
    expect(
      computeRecipeCombinationCount([
        { name: 'A', options: ['a1', 'a2', 'a3'] },
        { name: 'B', options: ['b1', 'b2'] },
      ]),
    ).toBe(6)
  })

  it('空白候选值不计入组合空间（这是修复前提示条与面板口径不一致的地方）', () => {
    // 若不过滤空值会算成 3 × 2 = 6；过滤后是 2 × 2 = 4
    expect(
      computeRecipeCombinationCount([
        { name: 'A', options: ['a1', '  ', 'a2'] },
        { name: 'B', options: ['b1', 'b2'] },
      ]),
    ).toBe(4)
  })

  it('某维度全部为空时组合数为 0（提示用户补值，而不是给一个虚高的数字）', () => {
    expect(
      computeRecipeCombinationCount([
        { name: 'A', options: ['a1', 'a2'] },
        { name: 'B', options: ['', '   '] },
      ]),
    ).toBe(0)
  })

  it('空维度列表返回 0', () => {
    expect(computeRecipeCombinationCount([])).toBe(0)
  })

  it('单维度时就是该维度的有效候选值数量', () => {
    expect(computeRecipeCombinationCount([{ name: 'A', options: ['a1', 'a2', 'a3'] }])).toBe(3)
  })

  it('options 缺失时安全处理（不抛错）', () => {
    expect(computeRecipeCombinationCount([{ name: 'A', options: undefined as unknown as string[] }])).toBe(0)
  })
})

describe('countRecipeEnglishOptions：英文描述计数', () => {
  it('累加各维度的英文描述条数', () => {
    expect(
      countRecipeEnglishOptions([
        { englishByOption: { 甜甜圈: 'donut', 咖啡: 'coffee' } },
        { englishByOption: { 红色: 'red' } },
      ]),
    ).toBe(3)
  })

  it('没有英文描述时返回 0', () => {
    expect(countRecipeEnglishOptions([{}, { englishByOption: {} }])).toBe(0)
  })

  it('空列表返回 0', () => {
    expect(countRecipeEnglishOptions([])).toBe(0)
  })
})
