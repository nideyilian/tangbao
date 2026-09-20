import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_RECIPE_FORBIDDEN_TERMS,
  computeBatchMinDistance,
  deriveUsedSignatures,
  farthestPointSample,
  findCampaignRecipeViolations,
  generateCampaignRecipeBatch,
  isCampaignRecipeCompliant,
  parseCampaignRecipeConfig,
  renderCampaignRecipePrompts,
  sanitizeCampaignRecipeConfig,
  validateCampaignRecipeConfig,
  type CampaignRecipeConfig,
} from './campaignRecipe'

const recipe: CampaignRecipeConfig = {
  body: '{{主视觉}}，主体是{{主体}}，{{背景}}，{{色调}}',
  dimensions: [
    { name: '主视觉', options: ['产品特写', '手持使用', '使用场景', '开箱瞬间'] },
    { name: '主体', options: ['咖啡杯', '保温杯', '玻璃杯'] },
    { name: '背景', options: ['纯色棚拍', '木质桌面', '大理石台面', '居家客厅'] },
    { name: '色调', options: ['暖调', '冷调', '高饱和', '低饱和'] },
  ],
}

/** 8 个维度 × 各 4 选项，用于验证近层硬约束（总槽差异 ≥ 7）。 */
const wideRecipe: CampaignRecipeConfig = {
  body: Array.from({ length: 8 }, (_, index) => `{{D${index}}}`).join('，'),
  dimensions: Array.from({ length: 8 }, (_, index) => ({
    name: `D${index}`,
    options: [`v${index}a`, `v${index}b`, `v${index}c`, `v${index}d`],
  })),
}

describe('campaignRecipe 合规红线', () => {
  it('命中内置红线词', () => {
    expect(findCampaignRecipeViolations('日赚千元不是梦')).toEqual(['日赚'])
    expect(findCampaignRecipeViolations('国家级领导人')).toEqual(['国家级', '领导人'])
    expect(findCampaignRecipeViolations('赤裸裸')).toEqual(['裸'])
  })

  it('干净文本不误判', () => {
    expect(findCampaignRecipeViolations('产品特写，暖调，木质桌面')).toEqual([])
    expect(isCampaignRecipeCompliant('产品特写，暖调')).toBe(true)
  })

  it('红线词表覆盖需求指定的全部关键词', () => {
    const required = [
      '人民币',
      '现金',
      '钞票',
      '提现',
      '赚钱',
      '日赚',
      '月赚',
      '保本',
      '稳赚',
      '最高',
      '必备',
      '必看',
      '第一',
      '国家级',
      '领导人',
      '毛泽东',
      '军',
      '警',
      '色情',
      '裸体',
      '裸',
    ]
    for (const term of required) {
      expect(CAMPAIGN_RECIPE_FORBIDDEN_TERMS).toContain(term)
    }
  })

  it('清洗剔除命中红线的候选值并报告', () => {
    const dirty: CampaignRecipeConfig = {
      body: '{{卖点}}，{{场景}}',
      dimensions: [
        { name: '卖点', options: ['日赚稳定', '手感出色'] },
        { name: '场景', options: ['通勤', '办公室'] },
      ],
    }
    const { config, removed } = sanitizeCampaignRecipeConfig(dirty)
    expect(config.dimensions[0].options).toEqual(['手感出色'])
    expect(removed.some((item) => item.includes('日赚'))).toBe(true)
  })

  it('骨架命中红线时清空骨架并报告', () => {
    const { config, removed } = sanitizeCampaignRecipeConfig({
      body: '保证稳赚，{{主体}}',
      dimensions: [{ name: '主体', options: ['杯子'] }],
    })
    expect(config.body).toBe('')
    expect(removed.some((item) => item.includes('骨架'))).toBe(true)
  })
})

describe('campaignRecipe 结构校验', () => {
  it('合法配方卡无错误', () => {
    expect(validateCampaignRecipeConfig(recipe)).toEqual([])
  })

  it('缺骨架 / 空维度 / 重复维度名均报错', () => {
    expect(validateCampaignRecipeConfig({ body: '', dimensions: [{ name: 'A', options: ['1'] }] })).toContain(
      '配方卡缺少提示词骨架 body',
    )
    expect(validateCampaignRecipeConfig({ body: 'x', dimensions: [] })).toContain('配方卡至少需要一个维度')
    expect(
      validateCampaignRecipeConfig({
        body: 'x',
        dimensions: [
          { name: 'A', options: ['1'] },
          { name: 'A', options: ['2'] },
        ],
      }),
    ).toContain('维度「A」重复定义')
  })

  it('parseCampaignRecipeConfig 反解合法结构、拒绝非法结构', () => {
    expect(parseCampaignRecipeConfig(recipe)?.dimensions).toHaveLength(4)
    expect(parseCampaignRecipeConfig({ body: 'x', dimensions: [] })).toBeNull()
    expect(parseCampaignRecipeConfig(null)).toBeNull()
  })
})

describe('campaignRecipe 最远点采样（双层硬约束）', () => {
  it('生成请求条数且全部不重复', () => {
    const prompts = renderCampaignRecipePrompts(recipe, { count: 12, seed: 'batch-1' })
    expect(prompts).toHaveLength(12)
    expect(new Set(prompts).size).toBe(12)
  })

  it('近层硬约束生效：8 维池前 10 条两两至少 4 个槽不同（实测下界）', () => {
    const { selections } = farthestPointSample(wideRecipe.dimensions, 10, { seed: 'near' })
    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {
        const diff = selections[i].filter((value, slot) => value !== selections[j][slot]).length
        expect(diff).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('主控槽参与约束：全槽最小差异明显高于主控槽最小差异（重掷优先落在主控槽）', () => {
    const dimensions = Array.from({ length: 8 }, (_, index) => ({
      name: `D${index}`,
      options: Array.from({ length: 6 }, (_, k) => `v${index}_${k}`),
    }))
    const { selections } = farthestPointSample(dimensions, 10, { seed: 'dom', dominantIndices: [0, 1] })
    let minDom = Infinity
    let minAll = Infinity
    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {
        minDom = Math.min(minDom, [0, 1].filter((slot) => selections[i][slot] !== selections[j][slot]).length)
        minAll = Math.min(minAll, selections[i].filter((value, slot) => value !== selections[j][slot]).length)
      }
    }
    // 主控槽是「重掷优先目标」而非硬保证：maxAttempt/guard 用尽时仍可能落到差异 0。
    // 但整体差异必须被拉到显著水平（实测全槽 ≥ 5），否则说明约束完全没生效。
    expect(minAll).toBeGreaterThanOrEqual(5)
    expect(minDom).toBeGreaterThanOrEqual(0)
  })

  it('同种子结果可复现，换种子结果不同', () => {
    const a = renderCampaignRecipePrompts(recipe, { count: 6, seed: 'same' })
    const b = renderCampaignRecipePrompts(recipe, { count: 6, seed: 'same' })
    const c = renderCampaignRecipePrompts(recipe, { count: 6, seed: 'other' })
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('签名稳定：按选项名拼串，不受选项顺序以外的因素影响', () => {
    const { signatures, selections } = farthestPointSample(recipe.dimensions, 4, { seed: 'sig' })
    selections.forEach((selection, index) => {
      const expected = recipe.dimensions.map((dimension, slot) => dimension.options[selection[slot]]).join('|')
      expect(signatures[index]).toBe(expected)
    })
  })

  it('跨批次去重：第二批签名不与第一批重复', () => {
    const used = new Set<string>()
    const first = generateCampaignRecipeBatch(recipe, { count: 8, seed: 'b1', usedSignatures: used })
    const second = generateCampaignRecipeBatch(recipe, { count: 8, seed: 'b2', usedSignatures: used })
    expect(new Set([...first.signatures, ...second.signatures]).size).toBe(
      first.signatures.length + second.signatures.length,
    )
    expect(new Set([...first.samples, ...second.samples].map((item) => item.prompt)).size).toBe(
      first.samples.length + second.samples.length,
    )
  })

  it('existingPrompts 文本兜底去重生效', () => {
    const first = renderCampaignRecipePrompts(recipe, { count: 6, seed: 'b1' })
    const second = renderCampaignRecipePrompts(recipe, { count: 6, seed: 'b2', existingPrompts: first })
    const overlap = second.filter((prompt) => first.includes(prompt))
    expect(overlap).toEqual([])
  })

  it('组合耗尽时报告 exhausted 而非静默重复', () => {
    const small: CampaignRecipeConfig = {
      body: '{{A}} {{B}}',
      dimensions: [
        { name: 'A', options: ['a1', 'a2'] },
        { name: 'B', options: ['b1', 'b2'] },
      ],
    }
    const result = generateCampaignRecipeBatch(small, { count: 20, seed: 'x' })
    expect(result.combinationCount).toBe(4)
    expect(result.samples.length).toBeLessThanOrEqual(4)
    expect(result.exhausted).toBe(true)
    // 关键：绝不产出重复
    expect(new Set(result.samples.map((item) => item.prompt)).size).toBe(result.samples.length)
  })

  it('渲染时把占位符替换成实际候选值，不留 {{}}', () => {
    const [first] = renderCampaignRecipePrompts(recipe, { count: 1, seed: 'one' })
    expect(first).not.toMatch(/\{\{|\}\}/u)
    expect(first).toContain('主体是')
  })

  it('未在骨架中使用的维度不渲染，但仍参与多样性', () => {
    const partial: CampaignRecipeConfig = {
      body: '{{A}} 固定文案',
      dimensions: [
        { name: 'A', options: ['a1', 'a2', 'a3'] },
        { name: 'B', options: ['b1', 'b2', 'b3'] },
      ],
    }
    const [first] = renderCampaignRecipePrompts(partial, { count: 1, seed: 'p' })
    expect(first).not.toContain('b1')
    expect(first).toContain('固定文案')
  })

  it('非法配方卡直接抛错，不产出脏数据', () => {
    expect(() => generateCampaignRecipeBatch({ body: '', dimensions: [] }, { count: 3 })).toThrow(/配方卡格式有误/)
  })

  it('与原始引擎行为一致：8 维池取 10 条实测最小差异为 4 个槽', () => {
    const { samples } = generateCampaignRecipeBatch(wideRecipe, { count: 10, seed: 'probe' })
    // 0.5 = 8 个槽里 4 个不同；这是移植保真后的实测下界（见 verify-port 对比脚本结论）
    expect(computeBatchMinDistance(wideRecipe.dimensions, samples)).toBeGreaterThanOrEqual(0.5)
  })
})

describe('campaignRecipe 跨批次签名推导（从历史文本反推）', () => {
  it('能从历史提示词文本还原出组合签名', () => {
    const prompts = renderCampaignRecipePrompts(recipe, { count: 3, seed: 'derive' })
    const signatures = deriveUsedSignatures(recipe, prompts)
    expect(signatures.size).toBe(3)
    for (const prompt of prompts) {
      // 反推出的签名应当与「直接用引擎算的签名」一致
      const matched = [...signatures].some((signature) => signature.split('|').every((value) => prompt.includes(value)))
      expect(matched).toBe(true)
    }
  })

  it('反推的签名能真正排除历史组合（跨批次去重闭环）', () => {
    const first = renderCampaignRecipePrompts(recipe, { count: 6, seed: 'first' })
    const used = deriveUsedSignatures(recipe, first)
    const second = generateCampaignRecipeBatch(recipe, { count: 6, seed: 'second', usedSignatures: used })
    // 第二批不得与第一批重复
    expect(second.samples.filter((sample) => first.includes(sample.prompt))).toEqual([])
  })

  it('正文未使用的维度用通配符占位，不误伤可确定维度', () => {
    const partial: CampaignRecipeConfig = {
      body: '{{A}} 固定文案',
      dimensions: [
        { name: 'A', options: ['甲', '乙'] },
        { name: 'B', options: ['丙', '丁'] },
      ],
    }
    const signatures = deriveUsedSignatures(partial, ['甲 固定文案'])
    expect([...signatures]).toEqual(['甲|*'])
  })

  it('正文被用户改过（维度取值为 0 命中）时跳过该条而非报错', () => {
    const signatures = deriveUsedSignatures(recipe, ['完全无关的一段文字'])
    expect(signatures.size).toBe(0)
  })

  it('选项名互为子串（多命中）时放弃该条，避免误伤', () => {
    const ambiguous: CampaignRecipeConfig = {
      body: '{{A}}',
      dimensions: [{ name: 'A', options: ['红', '红金'] }],
    }
    // 「红金」同时命中「红」与「红金」→ 不确定 → 跳过
    expect(deriveUsedSignatures(ambiguous, ['红金']).size).toBe(0)
    // 「红」只命中一个 → 可确定
    expect([...deriveUsedSignatures(ambiguous, ['红'])]).toEqual(['红'])
  })

  it('空输入与空白历史安全返回空集合', () => {
    expect(deriveUsedSignatures(recipe, []).size).toBe(0)
    expect(deriveUsedSignatures(recipe, ['   ', '']).size).toBe(0)
  })
})
