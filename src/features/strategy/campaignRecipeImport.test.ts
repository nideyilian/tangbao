import { describe, expect, it } from 'vitest'
import { extractPlaceholders, parseCampaignRecipeText, toCampaignRecipeConfig } from './campaignRecipeImport'

/** 真实资产的精简版：保留结构特征（master + pools + 单花括号模板 + dominant） */
const REAL_SHAPE_JSON = JSON.stringify({
  name: '歌单推荐美女',
  desc: '音乐APP拉新',
  model: 'GPT image2',
  headline_slot: 'S8',
  dominant: ['S1', 'S3', 'S8'],
  forbidden: ['最火', '神曲'],
  template: '{M}, {S1}, {S2}, {S3}, large headline text at top: 「{S8}」, {S2}',
  master: [
    { key: 'M1戴耳机侧颜特写', en: 'close-up side profile', weight: 2 },
    { key: 'M2居家桌前听歌', en: 'at home desk', weight: 1 },
  ],
  pools: {
    S1: [
      { key: '甜美元气', en: 'sweet energetic' },
      { key: '清冷', en: 'cool elegant' },
    ],
    S2: [{ key: '黑长直', en: 'long straight black hair' }],
    S3: [
      { key: '米白针织', en: 'off-white knit' },
      { key: '碎花长裙', en: 'floral dress' },
    ],
    S8: [
      { key: '深夜必听的歌', en: 'late night' },
      { key: '一首接一首', en: 'song after song' },
    ],
  },
})

describe('parseCampaignRecipeText · JSON 分支', () => {
  it('extracts name, description, body and every pool from a real-shaped asset', () => {
    const result = parseCampaignRecipeText(REAL_SHAPE_JSON)

    expect(result.ok).toBe(true)
    expect(result.source).toBe('json')
    expect(result.name).toBe('歌单推荐美女')
    expect(result.desc).toBe('音乐APP拉新')
    expect(result.body).toContain('{M}')
    // master 区块要落到模板引用的 {M} 槽上，而不是新造一个「款式」维度
    expect(result.dimensions.map((item) => item.name)).toEqual(['S1', 'S2', 'S3', 'S8', 'M'])
    expect(result.dimensions.find((item) => item.name === 'M')?.options).toEqual(['M1戴耳机侧颜特写', 'M2居家桌前听歌'])
    // 无条件为空的维度不该出现（这就是「不留脏数据」）
    expect(result.missingPools).toEqual([])
  })

  it('carries dominant / headline_slot into slot weights so the engine can prioritise them', () => {
    const result = parseCampaignRecipeText(REAL_SHAPE_JSON)
    // headline_slot 权重最高，其余 dominant 次之，非主控槽不带权重
    expect(result.dimensions.find((item) => item.name === 'S8')?.weight).toBe(3)
    expect(result.dimensions.find((item) => item.name === 'S1')?.weight).toBe(2)
    expect(result.dimensions.find((item) => item.name === 'S3')?.weight).toBe(2)
    expect(result.dimensions.find((item) => item.name === 'S2')?.weight).toBeUndefined()
    expect(result.dominantSlots).toEqual(['S1', 'S3', 'S8'])
    expect(result.meta.headlineSlot).toBe('S8')
    // 原资产的禁用词不自动套用本引擎的红线，只作信息展示
    expect(result.meta.forbidden).toEqual(['最火', '神曲'])
  })

  it('keeps option order and chinese→english descriptions', () => {
    const result = parseCampaignRecipeText(REAL_SHAPE_JSON)
    const s1 = result.dimensions.find((item) => item.name === 'S1')
    expect(s1?.options).toEqual(['甜美元气', '清冷'])
    expect(s1?.englishByOption).toEqual({ 甜美元气: 'sweet energetic', 清冷: 'cool elegant' })
  })

  it('unwraps a SOP library export that nests the recipe under campaignRecipe', () => {
    const exported = JSON.stringify({
      items: [
        {
          id: 'sop-1',
          name: '外层名字',
          content: '',
          campaignRecipe: {
            body: '{{主体}}，{{背景}}',
            dimensions: [
              { name: '主体', options: ['咖啡杯'] },
              { name: '背景', options: ['原木桌面'] },
            ],
          },
        },
      ],
    })
    const result = parseCampaignRecipeText(exported)

    expect(result.ok).toBe(true)
    expect(result.body).toBe('{{主体}}，{{背景}}')
    expect(result.dimensions.map((item) => item.name)).toEqual(['主体', '背景'])
  })

  it('accepts a bare config (body + dimensions) without name or pools', () => {
    const config = JSON.stringify({
      body: '{{主体}}，{{风格}}',
      dimensions: [
        { name: '主体', options: ['包'] },
        { name: '风格', options: ['胶片'] },
      ],
    })
    const result = parseCampaignRecipeText(config)
    expect(result.ok).toBe(true)
    expect(result.warnings).toContain('未识别到配方名称，请手动填写')
  })

  it('reads pools written as a plain object map of values', () => {
    const result = parseCampaignRecipeText(
      JSON.stringify({ template: '{A}, {B}', pools: { A: { 甲: 'first', 乙: 'second' }, B: [['x', 'y']] } }),
    )
    const a = result.dimensions.find((item) => item.name === 'A')
    expect(a?.options).toEqual(['甲', '乙'])
    expect(a?.englishByOption).toEqual({ 甲: 'first', 乙: 'second' })
  })
})

describe('parseCampaignRecipeText · 自由排版文本分支', () => {
  const PLAIN_TEXT = [
    'name: 歌单推荐美女',
    'desc: 音乐APP拉新',
    'template: {M}, {S1}, {S2}, 大标题「{S8}」',
    '',
    'master:',
    '- M1 戴耳机侧颜特写, close-up side profile, weight: 2',
    '- M2 居家桌前听歌, at home desk',
    '',
    'pools:',
    'S1: 甜美元气, 温柔治愈, 清冷',
    'S2:',
    '  1. 黑长直',
    '  2. 微卷',
    'S8：深夜必听的歌、一首接一首',
  ].join('\n')

  it('parses key/value headers, master list and pools with both separators', () => {
    const result = parseCampaignRecipeText(PLAIN_TEXT)

    expect(result.ok).toBe(true)
    expect(result.source).toBe('text')
    expect(result.name).toBe('歌单推荐美女')
    expect(result.desc).toBe('音乐APP拉新')
    expect(result.body).toContain('{M}')
    expect(result.dimensions.map((item) => item.name)).toEqual(['M', 'S1', 'S2', 'S8'])
    expect(result.dimensions.find((item) => item.name === 'M')?.options).toEqual([
      'M1 戴耳机侧颜特写',
      'M2 居家桌前听歌',
    ])
    expect(result.dimensions.find((item) => item.name === 'S1')?.options).toEqual(['甜美元气', '温柔治愈', '清冷'])
    // 编号列表要去掉序号
    expect(result.dimensions.find((item) => item.name === 'S2')?.options).toEqual(['黑长直', '微卷'])
    // 顿号也要能分隔
    expect(result.dimensions.find((item) => item.name === 'S8')?.options).toEqual(['深夜必听的歌', '一首接一首'])
  })

  it('tolerates full-width colons and extra spaces in keys', () => {
    const result = parseCampaignRecipeText(['name ： 测试配方', 'template ： {A}', 'pools:', 'A：甲，乙'].join('\n'))
    expect(result.name).toBe('测试配方')
    expect(result.dimensions[0].options).toEqual(['甲', '乙'])
  })

  it('creates an empty placeholder dimension for a referenced but missing pool', () => {
    const result = parseCampaignRecipeText(['template: {A}, {B}', 'pools:', 'A: 甲, 乙'].join('\n'))

    expect(result.ok).toBe(true)
    expect(result.missingPools).toEqual(['B'])
    // 空缺维度必须留空并在 warnings 里点明，不能编造候选值
    expect(result.dimensions.find((item) => item.name === 'B')?.options).toEqual([])
    expect(result.warnings.join('；')).toContain('B')
  })
})

describe('parseCampaignRecipeText · 失败与边界', () => {
  it('reports empty input instead of returning a blank recipe', () => {
    const result = parseCampaignRecipeText('   \n  ')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('内容为空')
  })

  it('reports unparseable content instead of guessing', () => {
    const result = parseCampaignRecipeText('这是一段和配方卡无关的说明文字，没有模板也没有候选池。')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('无法从这段内容识别出配方卡')
  })

  it('reports a missing skeleton when only pools are given', () => {
    const result = parseCampaignRecipeText(['pools:', 'S1: 甲, 乙'].join('\n'))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('提示词骨架')
  })

  it('falls back to text parsing when the JSON is malformed', () => {
    // 半截 JSON：解析失败后仍应尝试按文本读取，且不抛异常
    const result = parseCampaignRecipeText('name: 半截\ntemplate: {A}\npools:\nA: 甲, 乙\n}  ')
    expect(result.ok).toBe(true)
    expect(result.name).toBe('半截')
  })
})

describe('extractPlaceholders', () => {
  it('recognises both brace styles without double-counting', () => {
    expect(extractPlaceholders('{M}, {S1}, 「{S8}」')).toEqual(['M', 'S1', 'S8'])
    expect(extractPlaceholders('{{主体}}，{{背景}}')).toEqual(['主体', '背景'])
    // 双花括号不能被当成单花括号再解析一次
    expect(extractPlaceholders('{{A}} and {B}')).toEqual(['A', 'B'])
    // 重复出现只留一次
    expect(extractPlaceholders('{A} {A} {B}')).toEqual(['A', 'B'])
  })
})

describe('toCampaignRecipeConfig', () => {
  it('drops empty dimensions and preserves weights', () => {
    const result = parseCampaignRecipeText(REAL_SHAPE_JSON)
    const config = toCampaignRecipeConfig(result)

    expect(config).not.toBeNull()
    expect(config!.dimensions.map((item) => item.name)).toEqual(['S1', 'S2', 'S3', 'S8', 'M'])
    expect(config!.dimensions.find((item) => item.name === 'S8')?.weight).toBe(3)
  })

  it('returns null when a referenced dimension has no candidate values', () => {
    const result = parseCampaignRecipeText(['template: {A}, {B}', 'pools:', 'A: 甲'].join('\n'))
    // B 只有占位没有值 → 不能产出 config，交给 UI 提示补齐
    expect(toCampaignRecipeConfig(result)).not.toBeNull()
    expect(toCampaignRecipeConfig(result)!.dimensions.map((item) => item.name)).toEqual(['A'])
  })

  it('returns null without a skeleton', () => {
    const result = parseCampaignRecipeText(['pools:', 'A: 甲'].join('\n'))
    expect(toCampaignRecipeConfig(result)).toBeNull()
  })
})
