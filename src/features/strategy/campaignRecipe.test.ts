import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_RECIPE_FORBIDDEN_TERMS,
  computeBatchMinDistance,
  deriveUsedSignatures,
  describeCampaignRecipeSize,
  farthestPointSample,
  findCampaignRecipeViolations,
  generateCampaignRecipeBatch,
  isCampaignRecipeCompliant,
  parseCampaignRecipeConfig,
  pickDominantIndices,
  renderCampaignRecipePrompts,
  resolveCampaignRecipeSeriesFixedDimensions,
  resolveEffectiveDominantSlots,
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

  // 回归用例（2026-09-20）：清洗曾经用 `{ name, options }` 重建维度，把 weight 丢掉，
  // 导致 pickDominantIndices 恒返回 undefined —— 界面上「主控槽」整片消失，
  // 引擎内部则因 `dominantIndices ?? 全槽` 的兜底把主控槽约束退化成全槽约束，
  // 多样性策略被静默改写。清洗只应删候选值，不得改动维度的元数据。
  it('清洗保留维度的 weight（曾因重建对象而丢失，导致主控槽全线失效）', () => {
    const { config } = sanitizeCampaignRecipeConfig({
      body: '{{主视觉}}，{{主体}}，{{背景}}',
      dimensions: [
        { name: '主视觉', options: ['日赚稳定', '侧脸特写'], weight: 3 },
        { name: '主体', options: ['耳机', '耳机'], weight: 2 },
        { name: '背景', options: ['棚拍', '居家'] },
      ],
    })
    expect(config.dimensions.map((item) => item.weight)).toEqual([3, 2, undefined])
    // 端到端：清洗后仍能推导出主控槽，且**两个带 weight 的维度都入选**
    // （口径见 pickDominantIndices：> 0 即主控，不比数值大小）
    expect(pickDominantIndices(config.dimensions)).toEqual([0, 1])
  })
})

describe('campaignRecipe 内置变量（尺寸注入 {比例} / {方向} / {尺寸}）', () => {
  it('describeCampaignRecipeSize：常见画幅查表 + 方向判定', () => {
    expect(describeCampaignRecipeSize('1280x720')).toEqual({
      比例: '16:9',
      方向: 'horizontal',
      尺寸: '1280x720',
    })
    expect(describeCampaignRecipeSize('720x1280')?.比例).toBe('9:16')
    expect(describeCampaignRecipeSize('720x1280')?.方向).toBe('vertical')
    expect(describeCampaignRecipeSize('1024x1024')).toMatchObject({ 比例: '1:1', 方向: 'square' })
    // 非常见画幅退回 gcd 约分；解析失败返回 undefined（调用方不注入，占位符按既有约定保留）
    expect(describeCampaignRecipeSize('640x480')?.比例).toBe('4:3')
    expect(describeCampaignRecipeSize('auto')).toBeUndefined()
    expect(describeCampaignRecipeSize('')).toBeUndefined()
    expect(describeCampaignRecipeSize('abc')).toBeUndefined()
  })

  it('骨架里的 {比例} {方向} 被当前尺寸替换（2026-09-20：配方卡比例曾只能写死，与界面选择脱节）', () => {
    const prompts = renderCampaignRecipePrompts(
      {
        body: '主体是{{主视觉}}，{方向} {比例} photo',
        dimensions: [{ name: '主视觉', options: ['产品特写', '使用场景'] }],
      },
      { count: 2, seed: 's', builtinValues: describeCampaignRecipeSize('1280x720') },
    )
    expect(prompts).toContain('主体是产品特写，horizontal 16:9 photo')
    expect(prompts).toContain('主体是使用场景，horizontal 16:9 photo')
  })

  it('未提供 builtinValues 时占位符原样保留（被既有占位符检查拦下，不静默）', () => {
    const prompts = renderCampaignRecipePrompts(
      {
        body: '主体是{{主视觉}}，{比例} photo',
        dimensions: [{ name: '主视觉', options: ['产品特写'] }],
      },
      { count: 1, seed: 's' },
    )
    expect(prompts[0]).toBe('主体是产品特写，{比例} photo')
  })

  it('维度池同名优先：骨架里的 {{比例}} 若定义了维度，不被内置变量覆盖', () => {
    // 注意：用 {{双花括号}} 引用维度 —— {单花括号} 的中文引用受既有 ASCII 正则限制，
    // 不参与维度替换（同名时被内置替换跳过后会保留残留，由占位符检查拦下）。
    const prompts = renderCampaignRecipePrompts(
      {
        body: '主体是{{主视觉}}，画面比例是{{比例}}',
        dimensions: [
          { name: '主视觉', options: ['产品特写'] },
          { name: '比例', options: ['竖版'] },
        ],
      },
      { count: 1, seed: 's', builtinValues: describeCampaignRecipeSize('1280x720') },
    )
    expect(prompts[0]).toBe('主体是产品特写，画面比例是竖版')
  })
})

describe('campaignRecipe 写死画幅自动归一（一切以输入框尺寸为准）', () => {
  const hardcodedRecipe: CampaignRecipeConfig = {
    // 真实资产常见写法：画幅写死在骨架里
    body: '主体是{{主视觉}}, vertical 9:16 photo, no brand logo',
    dimensions: [{ name: '主视觉', options: ['产品特写'] }],
  }

  const render = (size: string) =>
    renderCampaignRecipePrompts(hardcodedRecipe, {
      count: 1,
      seed: 's',
      builtinValues: describeCampaignRecipeSize(size),
    })[0]

  it('骨架里写死的 vertical 9:16 跟随输入框尺寸（横版尺寸 → horizontal 16:9）', () => {
    expect(render('1280x720')).toBe('主体是产品特写, horizontal 16:9 photo, no brand logo')
  })

  it('方形尺寸 → square 1:1，非常见画幅 → 约分比例', () => {
    expect(render('1024x1024')).toBe('主体是产品特写, square 1:1 photo, no brand logo')
    expect(render('832x1216')).toBe('主体是产品特写, vertical 13:19 photo, no brand logo')
  })

  it('尺寸非法（auto）时不动作，写死值原样保留', () => {
    expect(render('auto')).toBe('主体是产品特写, vertical 9:16 photo, no brand logo')
  })

  it('不误伤非画幅的冒号数字（时间 12:30、非画幅比 5:7 都不在画幅表内）', () => {
    const prompts = renderCampaignRecipePrompts(
      { body: 'at 12:30, ratio 5:7, {{主体}}', dimensions: [{ name: '主体', options: ['杯子'] }] },
      { count: 1, seed: 's', builtinValues: describeCampaignRecipeSize('1280x720') },
    )
    expect(prompts[0]).toBe('at 12:30, ratio 5:7, 杯子')
  })
})

describe('campaignRecipe 系列模式（组内一致 / 组间不同）', () => {
  // 维度名刻意混搭「风格类」与「内容类」，并在多个维度上重复取值 —— 便于断言组内一致性。
  const seriesRecipe: CampaignRecipeConfig = {
    body: '{{画风}}风格的{{主体}}，{{动作}}，{{背景}}，{{光线}}',
    dimensions: [
      { name: '画风', options: ['日系', '3D', '扁平'], weight: 3 },
      { name: '光线', options: ['暖光', '冷光', '柔光'] },
      { name: '主体', options: ['女孩', '男孩'] },
      { name: '动作', options: ['笑', '跳', '挥手', '鼓掌', '点头', '回头'] },
      { name: '背景', options: ['室内', '街头', '公园'] },
    ],
  }

  it('缺省固定维度：风格/形式类保留，内容类剔除（含排除优先）', () => {
    const fixed = resolveCampaignRecipeSeriesFixedDimensions([
      { name: 'S9风格', options: ['a'] },
      { name: 'S1人物风格', options: ['a'] },
      { name: 'S6光线', options: ['a'] },
      { name: 'S12布局', options: ['a'] },
      { name: 'S5背景氛围', options: ['a'] }, // 含「背景」→ 必须判为变化，尽管也可能被误判
      { name: 'S2动作', options: ['a'] },
      { name: 'S11标题', options: ['a'] },
      { name: 'M', options: ['a'], weight: 3 }, // 主控槽，即使名字无关键词也固定
    ])
    expect(fixed).toContain('S9风格')
    expect(fixed).toContain('S1人物风格')
    expect(fixed).toContain('S6光线')
    expect(fixed).toContain('S12布局')
    expect(fixed).toContain('M')
    expect(fixed).not.toContain('S5背景氛围')
    expect(fixed).not.toContain('S2动作')
    expect(fixed).not.toContain('S11标题')
  })

  it('组内：固定维度取值一致、变化维度拉开差异', () => {
    const samples = generateCampaignRecipeBatch(seriesRecipe, {
      count: 6,
      seed: 's',
      usedSignatures: new Set(),
      seriesGroupSize: 3,
    }).samples
    expect(samples).toHaveLength(6)
    for (const group of [samples.slice(0, 3), samples.slice(3, 6)]) {
      expect(new Set(group.map((s) => s.values['画风'])).size).toBe(1)
      expect(new Set(group.map((s) => s.values['光线'])).size).toBe(1)
      // 内容类维度在组内必须出现差异（否则不成系列）
      expect(new Set(group.map((s) => s.values['动作'])).size).toBeGreaterThan(1)
    }
  })

  it('组间：固定维度取值不同（组合空间充足时）', () => {
    const samples = generateCampaignRecipeBatch(seriesRecipe, {
      count: 6,
      seed: 's',
      usedSignatures: new Set(),
      seriesGroupSize: 3,
    }).samples
    const first = `${samples[0].values['画风']}|${samples[0].values['光线']}`
    const second = `${samples[3].values['画风']}|${samples[3].values['光线']}`
    expect(first).not.toBe(second)
  })

  it('显式指定组内固定维度时以传入为准', () => {
    const samples = generateCampaignRecipeBatch(seriesRecipe, {
      count: 4,
      seed: 's',
      usedSignatures: new Set(),
      seriesGroupSize: 2,
      seriesFixedDimensions: ['主体'],
    }).samples
    expect(new Set(samples.slice(0, 2).map((s) => s.values['主体'])).size).toBe(1)
    // 「画风」不在固定名单里 → 组内允许变化（这里只断言它不再被强制固定）
    expect(samples).toHaveLength(4)
  })

  /**
   * 回归（R-70）：组间不能逐组雷同。
   *
   * 真实资产的形态是「13 维、M 在最后、变化维度多达 10 个」，而**签名重掷**选槽用的是
   * `dom[guard % dom.length]`（guard 从 0 起）—— 浅轮次只会碰靠前的几个槽，**靠后的槽
   * （典型就是 M）永远轮不到重掷**，其取值完全由 `baseCandidate(k)` 决定。于是每组若沿用
   * 同一个 seed，`baseCandidate(k)` 序列相同 ⇒ 三组的 M 逐位雷同（实测都是 `3,2,1,0`）。
   * 修法是每组把 groupIndex 混进 seed，让出发点本身不同。
   */
  it('组间：靠后的变化维度也不能逐组雷同（每组必须换 seed）', () => {
    const names = [
      'S1主体',
      'S2场景',
      'S3动作',
      'S4道具',
      'S5服饰',
      'S6光线',
      'S7景别',
      'S8情绪',
      'S9风格',
      'S10质感',
      'S11标题',
      'S12氛围',
      'M',
    ]
    const realistic: CampaignRecipeConfig = {
      body: names.map((name) => `{{${name}}}`).join('，'),
      dimensions: names.map((name) => ({
        name,
        options: Array.from({ length: 6 }, (_, k) => `${name}选项${k}`),
      })),
    }
    const groups = 3
    const groupSize = 3
    const samples = generateCampaignRecipeBatch(realistic, {
      count: groups * groupSize,
      seed: 's',
      usedSignatures: new Set(),
      seriesGroupSize: groupSize,
    }).samples
    // 取各组第一张的 M 槽取值：修 seed 之前三者**全同**（都为 baseCandidate(0) 的产物），
    // 修之后至少出现分歧。注意 M 只有 6 个候选值，3 组随机取值本就有约 44% 概率碰撞，
    // 所以断言「不全相同」而不是「两两不同」—— 后者会随机变红。
    const mValues = Array.from({ length: groups }, (_, index) => samples[index * groupSize].values['M'])
    expect(mValues).toHaveLength(groups)
    expect(new Set(mValues).size).toBeGreaterThan(1)
  })

  it('seriesGroupSize ≤ 1 时行为与单图模式完全一致（默认关闭）', () => {
    const plain = generateCampaignRecipeBatch(seriesRecipe, { count: 6, seed: 's', usedSignatures: new Set() })
    const withOne = generateCampaignRecipeBatch(seriesRecipe, {
      count: 6,
      seed: 's',
      usedSignatures: new Set(),
      seriesGroupSize: 1,
    })
    expect(withOne.samples.map((s) => s.prompt)).toEqual(plain.samples.map((s) => s.prompt))
  })
})

describe('campaignRecipe 单花括号占位符名的字符范围', () => {
  // 回归用例（2026-09-20）：「快手短剧_信息流」这张真实资产用 `{S9风格}` / `{S11标题}`
  // 这类「编号 + 中文」的写法，而单花括号正则当时限定纯 ASCII（`[A-Za-z][A-Za-z0-9_]{0,15}`），
  // 一律替换不到 → 提示词带着花括号占位符 → 被链路的占位符检查拦下，表现为「无法生成提示词」。
  it('支持「编号 + 中文」的占位符名', () => {
    const prompts = renderCampaignRecipePrompts(
      {
        body: '{M}. {S9风格} illustration, 大字"{S11标题}" {S12布局}',
        dimensions: [
          { name: 'M', options: ['M1人物插画+大字'] },
          { name: 'S9风格', options: ['日系动漫风'] },
          { name: 'S11标题', options: ['耳机一戴谁也不爱'] },
          { name: 'S12布局', options: ['左上角竖排'] },
        ],
      },
      { count: 1, seed: 's' },
    )
    expect(prompts[0]).toBe('M1人物插画+大字. 日系动漫风 illustration, 大字"耳机一戴谁也不爱" 左上角竖排')
  })

  it('支持纯中文占位符名（维度池有同名维度时按维度替换）', () => {
    const prompts = renderCampaignRecipePrompts(
      {
        body: '画面是{场景}，主体是{{主体}}',
        dimensions: [
          { name: '场景', options: ['地铁'] },
          { name: '主体', options: ['耳机'] },
        ],
      },
      { count: 1, seed: 's' },
    )
    expect(prompts[0]).toBe('画面是地铁，主体是耳机')
  })

  it('对不上的花括号原样保留（正文里的合法花括号不丢信息）', () => {
    const prompts = renderCampaignRecipePrompts(
      { body: '返回 {未定义项} 与 {{也未知}}，主体是{{主体}}', dimensions: [{ name: '主体', options: ['杯子'] }] },
      { count: 1, seed: 's' },
    )
    expect(prompts[0]).toBe('返回 {未定义项} 与 {{也未知}}，主体是杯子')
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

  it('主控槽参与约束：全槽差异被拉到高位（8 维池实测下界 4 个槽不同）', () => {
    const dimensions = Array.from({ length: 8 }, (_, index) => ({
      name: `D${index}`,
      options: Array.from({ length: 6 }, (_, k) => `v${index}_${k}`),
    }))
    const { selections } = farthestPointSample(dimensions, 10, { seed: 'dom', dominantIndices: [0, 1] })
    // 形状必须先对：曾经 selection 被幻影槽位撑到 119 长并塞满 NaN（R-69），
    // 那时下面所有差异统计都是被虚报的假数字 —— 旧断言写的 `>= 6` 正是被假数字校准出来的
    // （真实值只有 2）。形状断言放在最前面，才能保证后面的数字有意义。
    for (const selection of selections) {
      expect(selection).toHaveLength(8)
      expect(selection.some((value) => !Number.isFinite(value))).toBe(false)
    }
    let minDom = Infinity
    let minAll = Infinity
    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {
        minDom = Math.min(minDom, [0, 1].filter((slot) => selections[i][slot] !== selections[j][slot]).length)
        minAll = Math.min(minAll, selections[i].filter((value, slot) => value !== selections[j][slot]).length)
      }
    }
    // 全槽差异必须被拉到高水平。数字是**真实槽口径的实测值**：8 维 × 6 选项、10 条、
    // dominantIndices=[0,1] 时下界为 4（修 R-68/R-69 之前的真实值是 2）。
    expect(minAll).toBeGreaterThanOrEqual(4)
    // 主控槽也必须被照顾到：2 个主控槽至少 1 个不同（有信息的真断言，非恒真）
    expect(minDom).toBeGreaterThanOrEqual(1)
  })

  /**
   * 回归：主控槽下限必须**可达**，否则会把「总槽差异」约束整个短路（R-68）。
   *
   * 2026-09-21 之前的实现里 `minDomNear/Far` 默认 2，而单主控槽时 `domDiff` 上限只有 1 ⇒
   * `domDiff < 2` **恒真** ⇒ 判据的 OR 关系让 `hamming` 那一侧永不参与判断 ⇒
   * `minTotalNear/Far` 沦为死参数 ⇒ 退出时放行未满足约束的候选。
   *
   * 旧用例曾把「单主控槽时重掷恒打满 1081」当作**刻意保留的取舍**钉住 —— 但那个结论是用
   * 被 R-69 污染的指标（`selection` 被撑长、差异虚报）校准出来的，已作废：用真实槽口径复测，
   * 收窄成单主控槽反而让 9.4% 的组合对差异 <6。
   */
  it('主控槽下限会被收敛到可达范围，总差异约束不再被短路', () => {
    const dimensions = Array.from({ length: 7 }, (_, index) => ({
      name: `D${index}`,
      options: Array.from({ length: 8 }, (_, k) => `v${index}_${k}`),
    }))
    // 单主控槽：下限收敛为 1（等价于「主控槽必须不同」）⇒ 判据可达 ⇒ 会提前早退
    const single = farthestPointSample(dimensions, 10, { seed: 'pin', dominantIndices: [0] })
    // 10 条 × maxAttempt(120) = 1200 是「一次都不早退」的上界；可达后必须显著低于它
    expect(single.totalAttempts).toBeLessThan(1200)

    // 直接钉住「总差异下限不再是死参数」：调大它必须真的改变输出。
    // 这是 R-68 最锋利的一条 —— 修复前把 minTotalFar 从 6 提到 10，指标**一个数都不变**。
    const loose = farthestPointSample(dimensions, 10, { seed: 'pin', dominantIndices: [0], minTotalFar: 6 })
    const tight = farthestPointSample(dimensions, 10, { seed: 'pin', dominantIndices: [0], minTotalFar: 10 })
    expect(tight.totalAttempts).toBeGreaterThan(loose.totalAttempts)
  })

  it('回归：采样结果形状必须是「每条长度 = 维度数」且无 NaN', () => {
    const dimensions = Array.from({ length: 7 }, (_, index) => ({
      name: `D${index}`,
      options: Array.from({ length: 8 }, (_, k) => `v${index}_${k}`),
    }))
    // 曾经 enforce 的 `Array(n)` 拿重掷轮次当槽位上界（R-69）：轮次 ≥ 维度数时产生幻影槽位，
    // selection 被撑到 119 长、塞满 NaN，连 computeBatchMinDistance 都在报「1.000 完美」的假数。
    const { selections } = farthestPointSample(dimensions, 20, { seed: 'shape' })
    for (const selection of selections) {
      expect(selection).toHaveLength(dimensions.length)
      expect(selection.some((value) => !Number.isFinite(value))).toBe(false)
    }
  })

  /**
   * 回归：**低差异基座（`base_cand`）不能退化** —— 这是「相似度高」的基座层根因。
   *
   * `mix64` 曾用 float64 直接算 64 位常量，而 `0x9e3779b97f4a7c15` ≈ 1.14e19 已超出
   * float64 的整数精度（该量级的间隔是 2048）⇒ 第一步 `(x + BIG) & 0xffffffff` 把 x 的贡献
   * **整个吞掉**（实测 `x = 0` 与 `x = 1000` 得到同值）⇒ 散列退化 ⇒ **8 个选项的维度实际只用 2 个值**。
   * 后果：真实资产 30 条里，`S13副标题` 只有 15:15 两个值、`M` 有 27/30 挤在前两个值上。
   *
   * ⚠️ 必须用 `maxAttempt: 0` **关掉重掷**再观测：重掷会从其它选项取值，把退化的基座盖住
   * （看起来"分布还行"），只有直连基座才能测到。
   */
  it('低差异基座不能退化：8 选项的槽在 30 条里应覆盖大部分取值', () => {
    const dimensions = Array.from({ length: 3 }, (_, index) => ({
      name: `D${index}`,
      options: Array.from({ length: 8 }, (_, k) => `D${index}V${k}`),
    }))
    const { selections } = farthestPointSample(dimensions, 30, { seed: 'spread', maxAttempt: 0 })
    for (let slot = 0; slot < dimensions.length; slot += 1) {
      const unique = new Set(selections.map((item) => item[slot])).size
      // 30 条取 8 个选项：基座正常时应接近 8，退化时只有 2（float64 版的实测值）
      expect(unique).toBeGreaterThanOrEqual(6)
    }
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

  /**
   * 单花括号骨架（外部真实资产的常态写法，如 `{M}` / `{S9风格}`）的回归用例。
   *
   * 起因（2026-09-21）：`usedInBody` 曾写成 `body.includes('{{' + name + '}}')`，只认双花括号。
   * 真实资产骨架是单花括号 ⇒ 判定恒为假 ⇒ 每个维度都走通配分支 ⇒ **整批历史塌缩成同一条
   * 签名 `*|*|…|*`**（永不等于真实签名）⇒ 跨批次去重静默失效。实测同一份 13 维配置：
   * 双花括号批间重复 0/10、单花括号 10/10（详见 docs/RISK.md 的 R-66）。
   *
   * ⚠️ 这两条用例**必须用同一 seed**：不同 seed 本身就会产出不同组合，去重完全失效时也照样
   * 「不重复」—— 既有那条「跨批次去重闭环」用例用 first/second 两个 seed，正是因此一直绿着，
   * 没能拦住这个 bug。同 seed 才能把「去重是否真的在起作用」隔离出来。
   */
  describe('单花括号骨架（外部真实资产写法）', () => {
    const singleBrace: CampaignRecipeConfig = {
      body: '{A}，固定文案，{B}',
      dimensions: [
        // 候选空间（4 × 4 = 16）必须显著大于两批的需求：组合穷尽时引擎会放行重复项
        // 而不是标记 exhausted，那是另一码事（见 R-66 的同族风险），不该混进本用例的判定。
        { name: 'A', options: ['甲', '乙', '丙', '丁'] },
        { name: 'B', options: ['戊', '己', '庚', '辛'] },
      ],
    }

    it('反推得到逐条真签名，而不是一条通配签名', () => {
      const prompts = renderCampaignRecipePrompts(singleBrace, { count: 3, seed: 'derive-single' })
      const signatures = deriveUsedSignatures(singleBrace, prompts)
      // 中间态断言：只断最终产出会被 `??` 式兜底掩盖，这里直接断签名本体
      expect(signatures.size).toBe(3)
      expect([...signatures].some((signature) => signature.includes('*'))).toBe(false)
      // 与渲染出的正文对得上（签名各段都能在该条提示词里找到）
      for (const prompt of prompts) {
        expect([...signatures].some((signature) => signature.split('|').every((value) => prompt.includes(value)))).toBe(
          true,
        )
      }
    })

    it('同 seed 复跑时跨批次去重仍然闭环（批间零重复）', () => {
      const first = renderCampaignRecipePrompts(singleBrace, { count: 3, seed: 'same-seed' })
      const used = deriveUsedSignatures(singleBrace, first)
      const second = generateCampaignRecipeBatch(singleBrace, { count: 3, seed: 'same-seed', usedSignatures: used })
      // 同一 seed 会撒出同一串候选点，全靠签名去重把它们推走 —— 去重失效时这里恒为 3 条全重复
      expect(second.samples.filter((sample) => first.includes(sample.prompt))).toEqual([])
    })

    it('正文未引用的维度仍用通配符，单/双花括号混写不误判', () => {
      const mixed: CampaignRecipeConfig = {
        body: '{{A}} 与 {B}',
        dimensions: [
          { name: 'A', options: ['甲', '乙'] },
          { name: 'B', options: ['丙', '丁'] },
          { name: 'C', options: ['戊', '己'] },
        ],
      }
      // C 未出现在正文 → 通配；A 走双花括号、B 走单花括号，两者都要被认出
      expect([...deriveUsedSignatures(mixed, ['甲 与 丙'])]).toEqual(['甲|丙|*'])
    })
  })
})

describe('campaignRecipe 取消贯穿（signal 直达采样内部）', () => {
  /**
   * 这组用例直接打 generateCampaignRecipeBatch，**不经过 generateSopPromptBatches**。
   *
   * 起因：最初把取消用例写在 storeSopGeneration 层，反向验证（关掉引擎内的 abort 检查）
   * 后发现测试**依然全绿** —— 因为取消是被外层竞速拦下的，引擎里那两处检查根本没被走到。
   * 探针没打中目标，测试等于没测。这里改从引擎入口直接验，才能覆盖到采样与渲染循环。
   */
  const bigRecipe: CampaignRecipeConfig = {
    body: '{{大池}}，{{主体}}',
    dimensions: [
      { name: '大池', options: Array.from({ length: 400 }, (_, index) => `选项${index}`) },
      { name: '主体', options: ['咖啡杯', '保温杯'] },
    ],
  }

  it('signal 已中止时，采样完成后立即抛 AbortError 而不返回样本', () => {
    const controller = new AbortController()
    controller.abort(new DOMException('提示词生成已取消', 'AbortError'))

    expect(() => generateCampaignRecipeBatch(bigRecipe, { count: 50, signal: controller.signal })).toThrow(/取消/)
  })

  it('抛的是 AbortError，让上层的 isAbortError 判定能识别', () => {
    const controller = new AbortController()
    controller.abort()

    const error = (() => {
      try {
        generateCampaignRecipeBatch(bigRecipe, { count: 20, signal: controller.signal })
        return null
      } catch (err) {
        return err
      }
    })()

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
  })

  it('signal.reason 带原始错误时优先抛出原始错误（保留真实取消原因）', () => {
    const controller = new AbortController()
    const reason = new Error('用户切走了工作台')
    controller.abort(reason)

    expect(() => generateCampaignRecipeBatch(bigRecipe, { count: 20, signal: controller.signal })).toThrow(
      '用户切走了工作台',
    )
  })

  it('未中止的 signal 不影响正常生成', () => {
    const controller = new AbortController()
    const { samples } = generateCampaignRecipeBatch(bigRecipe, { count: 5, signal: controller.signal })
    expect(samples).toHaveLength(5)
  })

  it('不传 signal 时行为与修复前一致（向后兼容）', () => {
    const { samples } = generateCampaignRecipeBatch(bigRecipe, { count: 5 })
    expect(samples).toHaveLength(5)
  })
})

describe('campaignRecipe 主控槽口径（展示必须跟随实际权重）', () => {
  /**
   * 背景：`dominantSlots`（SopLibraryItem 顶层，供 UI 展示）与 `dimensions[].weight`
   * （真正参与采样）是同一语义的两个家。导入资产时两者被同时写入，但用户之后在界面上
   * 增删权重时 `dominantSlots` 不会跟着变 → 界面还标着「主控槽」，引擎已按新权重要跑，
   * 出现「界面说 A、执行做 B」。
   *
   * 修法：界面改为从 weight 实时推导（`resolveEffectiveDominantSlots`），
   * `dominantSlots` 退化为「原资产怎么声明的」这一来源说明。
   */
  it('按权重推导主控槽名', () => {
    const dimensions = [
      { name: '主视觉', options: ['a'], weight: 3 },
      { name: '主体', options: ['b'], weight: 2 },
      { name: '背景', options: ['c'] },
    ]
    // 口径：`weight > 0` 即主控槽，**不比数值大小** —— 用户给多个槽写权重，
    // 本意是「这些都请保护起来」（与原始 Python 引擎的 `cfg["dominant"]` 显式列表同义）。
    expect(resolveEffectiveDominantSlots(dimensions)).toEqual(['主视觉', '主体'])
  })

  it('权重并列时全部入选', () => {
    const dimensions = [
      { name: '甲', options: ['a'], weight: 3 },
      { name: '乙', options: ['b'], weight: 3 },
      { name: '丙', options: ['c'] },
    ]
    expect(resolveEffectiveDominantSlots(dimensions)).toEqual(['甲', '乙'])
  })

  it('没有任何权重时返回空数组（不是全部维度）', () => {
    const dimensions = [
      { name: '甲', options: ['a'] },
      { name: '乙', options: ['b'] },
    ]
    expect(resolveEffectiveDominantSlots(dimensions)).toEqual([])
  })

  it('全部维度权重相等时不算主控（避免把全部槽都算主控）', () => {
    const dimensions = [
      { name: '甲', options: ['a'], weight: 2 },
      { name: '乙', options: ['b'], weight: 2 },
    ]
    expect(resolveEffectiveDominantSlots(dimensions)).toEqual([])
  })

  it('用户删掉权重后，主控槽随之失效（这是修复前会不一致的场景）', () => {
    // 导入时：主视觉 weight 3、主体 weight 2 → 两个都算主控槽
    const imported = [
      { name: '主视觉', options: ['a'], weight: 3 },
      { name: '主体', options: ['b'], weight: 2 },
      { name: '背景', options: ['c'] },
    ]
    expect(resolveEffectiveDominantSlots(imported)).toEqual(['主视觉', '主体'])

    // 用户把「主视觉」的权重清掉 → 界面必须跟着变，只剩「主体」
    const edited = [
      { name: '主视觉', options: ['a'] },
      { name: '主体', options: ['b'], weight: 2 },
      { name: '背景', options: ['c'] },
    ]
    expect(resolveEffectiveDominantSlots(edited)).toEqual(['主体'])
  })

  it('推导结果与引擎实际使用的主控槽一致（pickDominantIndices 同一口径）', () => {
    const dimensions = [
      { name: '甲', options: ['a'], weight: 3 },
      { name: '乙', options: ['b'] },
      { name: '丙', options: ['c'] },
    ]
    const indices = pickDominantIndices(dimensions)
    const names = resolveEffectiveDominantSlots(dimensions)
    expect(names).toEqual((indices ?? []).map((index) => dimensions[index].name))
    expect(names).toEqual(['甲'])
  })
})
