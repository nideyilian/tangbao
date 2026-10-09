/**
 * 配方卡「问题清单」数据层测试（TB-153）。
 *
 * 这份清单是**提示改版的唯一真相源**：界面上的条数、明细、落点、处置动作全从它来。
 * 所以这里逐类钉住三件事 —— **认不认得出**（该报的报、不该报的不报）、
 * **落点对不对**（点「定位」会去哪儿）、**动作能不能解决**（给的是不是真能修的那个动作）。
 *
 * 另外两处**别处不在的守卫**也落在这里：
 * - 「同一件事只说一次」：missingPools 与「维度没有候选值」必须合并（旧版两处都说）；
 * - 「每个缺失占位符单独成条」：原来由 `listParsedRecipeAttention` 守（TB-148），
 *   那个函数已被本模块取代，守卫跟着搬过来，**不能丢**。
 */
import { describe, expect, it } from 'vitest'
import {
  appendPlaceholderToBody,
  buildRecipeProblems,
  describeProblemLocation,
  problemTargetKey,
  recipeTargetScope,
  removePlaceholderFromBody,
  resolveRecipeDisplayTerms,
  summarizeRecipeProblems,
  type RecipeProblem,
} from './campaignRecipeProblems'
import { CAMPAIGN_RECIPE_FORBIDDEN_RULES } from './campaignRecipe'
import type { ParsedCampaignRecipe } from './campaignRecipeImport'
import type { SopCampaignRecipeConfig } from './types'
import type { RecipeForbiddenRule } from '../../types'

function makeParsed(overrides: Partial<ParsedCampaignRecipe> = {}): ParsedCampaignRecipe {
  return {
    name: '歌单推荐美女',
    desc: '歌单场景的通用配方',
    body: '{M}, {S1}',
    dimensions: [
      { name: 'M', options: ['甲'] },
      { name: 'S1', options: ['乙'] },
    ],
    missingPools: [],
    dominantSlots: [],
    meta: {},
    ok: true,
    error: '',
    warnings: [],
    source: 'json',
    ...overrides,
  }
}

const HEALTHY_CONFIG: SopCampaignRecipeConfig = {
  body: '{M}, {S1}',
  dimensions: [
    { name: 'M', options: ['甲'] },
    { name: 'S1', options: ['乙'] },
  ],
}

const ids = (problems: RecipeProblem[]) => problems.map((problem) => problem.id)
const byId = (problems: RecipeProblem[], id: string) => problems.find((problem) => problem.id === id)

describe('buildRecipeProblems · 该报什么、不该报什么', () => {
  it('既没解析过、配置也空：一条问题都不报（这是「还没填」，不是「坏了」）', () => {
    expect(buildRecipeProblems({ parsed: null, config: { body: '', dimensions: [] } })).toEqual([])
  })

  it('一切正常时一条都不报', () => {
    expect(buildRecipeProblems({ parsed: makeParsed(), config: HEALTHY_CONFIG })).toEqual([])
  })

  it('结构问题：空骨架 / 没有维度 / 维度没名字 / 重名 / 没候选值', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed(),
      config: {
        body: '',
        dimensions: [
          { name: '', options: ['x'] },
          { name: 'S1', options: [] },
          { name: 'S1', options: ['y'] },
        ],
      },
    })
    expect(ids(problems)).toEqual([
      'structure-body-empty',
      'structure-dimension-nameless-0',
      'structure-dimension-empty-1',
      'structure-dimension-duplicate-2',
    ])
    // 每一条都带着落点，且落点精确到「第几个维度」—— 这是「点了能跳过去」的前提
    expect(byId(problems, 'structure-dimension-empty-1')?.target).toEqual({ kind: 'dimension', index: 1 })
    expect(byId(problems, 'structure-dimension-duplicate-2')?.target).toEqual({ kind: 'dimension', index: 2 })
  })

  it('一个维度都没有：落点落在「维度池」并给现成的「加维度」动作', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({ dimensions: [], missingPools: [] }),
      config: { body: '{M}', dimensions: [] },
    })
    const problem = byId(problems, 'structure-no-dimension')
    expect(problem?.target).toEqual({ kind: 'dimensions' })
    expect(problem?.actions).toContainEqual({ kind: 'add-dimension', label: '加维度' })
  })

  it('⭐ 同一件事只说一次：缺失池与「维度没有候选值」合并成一条（旧版两处都说）', () => {
    // 解析时 finalize 已经把缺失的 S3 补成一个空维度，同时又推了一条「以下维度没有候选值」的告警
    const problems = buildRecipeProblems({
      parsed: makeParsed({
        body: '{M}, {S3}',
        dimensions: [
          { name: 'M', options: ['甲'] },
          { name: 'S3', options: [] },
        ],
        missingPools: ['S3'],
        warnings: ['以下维度没有候选值，生成前必须补齐：S3'],
      }),
      config: {
        body: '{M}, {S3}',
        dimensions: [
          { name: 'M', options: ['甲'] },
          { name: 'S3', options: [] },
        ],
      },
    })
    expect(ids(problems)).toEqual(['structure-dimension-empty-1'])
    const problem = problems[0]
    expect(problem.title).toContain('{S3}')
    expect(problem.location).toContain('骨架第 1 行引用了它')
    // 这个维度的三条出路都摆出来：去填值 / 把骨架里的它删掉 / 连维度一起删
    expect(problem.actions.map((action) => action.kind)).toEqual(['locate', 'remove-placeholder', 'remove-dimension'])
  })

  it('解析器读过、但当前配置里没这个维度 ⇒ 单独成条（这条以前会静默消失）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({ missingPools: ['S3', 'S4'], warnings: [] }),
      config: HEALTHY_CONFIG,
    })
    // 每个占位符**单独成条**，不合并成一句（TB-148 的老守卫：合并会让「N 条」与「看到几行」脱钩）
    expect(ids(problems)).toEqual(['parse-missing-pool-S3', 'parse-missing-pool-S4'])
  })

  it('骨架引用了未定义的占位符：落点在骨架，并给「删掉它」这个动作', () => {
    const problems = buildRecipeProblems({ parsed: null, config: { ...HEALTHY_CONFIG, body: '{M}, {S1}, {S9}' } })
    const problem = byId(problems, 'structure-placeholder-missing-S9')
    expect(problem?.target).toEqual({ kind: 'body' })
    expect(problem?.actions).toContainEqual({ kind: 'remove-placeholder', label: '从骨架里删掉 {S9}', name: 'S9' })
  })

  it('维度没被骨架用到：给「在骨架末尾加上 {X}」与「删掉维度」两条出路', () => {
    const problems = buildRecipeProblems({
      parsed: null,
      config: {
        body: '{M}',
        dimensions: [
          { name: 'M', options: ['甲'] },
          { name: 'S1', options: ['乙'] },
        ],
      },
    })
    const problem = byId(problems, 'structure-dimension-unused-1')
    expect(problem?.level).toBe('warn')
    expect(problem?.actions.map((action) => action.kind)).toEqual(['insert-placeholder', 'remove-dimension', 'locate'])
  })

  it('骨架一个占位符都没有时只报一条（逐个维度报「没被引用」是刷屏）', () => {
    const problems = buildRecipeProblems({
      parsed: null,
      config: {
        body: '一只猫，坐在地上',
        dimensions: [
          { name: 'M', options: ['甲'] },
          { name: 'S1', options: ['乙'] },
        ],
      },
    })
    expect(ids(problems)).toEqual(['structure-body-no-placeholder'])
    expect(problems[0].advise).toContain('{M}')
  })
})

describe('buildRecipeProblems · 解析失败与解析告警', () => {
  it('解析失败且配置空：只报失败这一条（不叠加一堆结构错误刷屏）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({ ok: false, error: '原文既不是 JSON，也认不出「键: 值」结构', dimensions: [] }),
      config: { body: '', dimensions: [] },
    })
    expect(ids(problems)).toEqual(['parse-failed'])
    // 建议必须指向真因，而不是「请检查格式」这种空话
    expect(problems[0].advise).toContain('对照下面的格式示例')
    expect(problems[0].actions.map((action) => action.kind)).toEqual(['locate', 'reparse'])
  })

  it('解析失败但配置里有内容：失败照报，结构问题也照报（老卡不该被挡住）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({ ok: false, error: '未识别到提示词骨架（template / body）', dimensions: [] }),
      config: { body: '{M}', dimensions: [] },
    })
    expect(ids(problems)).toContain('parse-failed')
    expect(ids(problems)).toContain('structure-placeholder-missing-M')
  })

  it('面板自己的解析报错（parsed 是 ok 的）也要接住，不能吞掉', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed(),
      config: HEALTHY_CONFIG,
      localParseError: '解析出的配方卡缺少骨架或可用维度，请到详情里手动补齐',
    })
    expect(ids(problems)).toEqual(['parse-convert-failed'])
    expect(problems[0].advise).toContain('缺少骨架或可用维度')
  })

  it('未识别到配方名称：落点在弹窗外面（左侧字段区），并如实说清「不影响生成」', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({ name: '', warnings: ['未识别到配方名称，请手动填写'] }),
      config: HEALTHY_CONFIG,
    })
    expect(ids(problems)).toEqual(['parse-name-missing'])
    expect(problems[0].target).toEqual({ kind: 'name' })
    expect(recipeTargetScope(problems[0].target!)).toBe('outside')
    // 草稿里没名字（parsed.name 空）才会报，报出来的落点必须是「名称」而不是原文框
    expect(describeProblemLocation(problems[0].target!)).toContain('名称')
  })

  it('一键衍生的格式告警：按真实文案给出**具体**建议（不是「请检查格式」）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({
        warnings: [
          '“可变项：”必须单独占一行（当前这一行后面直接跟了内容），变量定义从下一行开始',
          '正文中的变量未定义：S1、S2',
        ],
      }),
      config: HEALTHY_CONFIG,
    })
    const list = problems.filter((problem) => problem.group === 'recipe' && problem.id.startsWith('parse-warning'))
    expect(list).toHaveLength(2)
    expect(list[0].advise).toContain('单独放一行')
    expect(list[1].advise).toContain('名字对不上')
    // 落点都在原文框（这类问题的病根在原文排版）
    expect(list.every((problem) => problem.target?.kind === 'rawText')).toBe(true)
  })

  it('认不出的告警也有兜底建议（不留空、不留「请检查」）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({ warnings: ['某种以后新增的告警文案'] }),
      config: HEALTHY_CONFIG,
    })
    expect(problems[0].advise).toContain('回到原文框')
  })

  it('原文改过但没重新解析：给「重新解析」动作', () => {
    const problems = buildRecipeProblems({ parsed: makeParsed(), config: HEALTHY_CONFIG, rawChangedAfterParse: true })
    const problem = byId(problems, 'raw-changed')
    expect(problem?.actions.map((action) => action.kind)).toEqual(['reparse', 'locate'])
    expect(problem?.target).toEqual({ kind: 'rawText' })
  })
})

describe('buildRecipeProblems · 红线命中', () => {
  const terms: RecipeForbiddenRule[] = [{ term: '军', allow: [] }]

  it('候选值命中：落点精确到「哪个维度的第几个值」，动作是加白 + 剔除', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed(),
      config: { body: '{M}', dimensions: [{ name: 'M', options: ['军绿色工装', '手感出色'] }] },
      forbiddenTerms: terms,
      showComplianceHints: true,
    })
    expect(ids(problems)).toEqual(['redline-option-0-0'])
    const problem = problems[0]
    expect(problem.group).toBe('redline')
    expect(problem.target).toEqual({ kind: 'option', dimensionIndex: 0, optionIndex: 0 })
    expect(problem.location).toContain('「M」的第 1 个值')
    expect(problem.actions.map((action) => action.kind)).toEqual(['whitelist-terms', 'remove-option', 'locate'])
  })

  it('骨架命中：落点落在骨架行号上，只提示不中断', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed(),
      config: { body: '{M} 的风格\n军绿色背景', dimensions: [{ name: 'M', options: ['甲'] }] },
      forbiddenTerms: terms,
      showComplianceHints: true,
    })
    const problem = byId(problems, 'redline-body')
    expect(problem?.location).toContain('第 2 行')
    expect(problem?.advise).toContain('不中断生成')
  })

  it('词表为空（总开关关闭）⇒ 一条红线条目都不出（与生成链路同口径）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed(),
      config: { body: '{M}', dimensions: [{ name: 'M', options: ['军绿色工装'] }] },
      forbiddenTerms: [],
      showComplianceHints: true,
    })
    expect(problems).toEqual([])
  })

  it('关掉「显示红线标记」⇒ 不出条目，但结构问题照常', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed(),
      config: {
        body: '{M}, {S1}',
        dimensions: [
          { name: 'M', options: ['军绿色工装'] },
          { name: 'S1', options: [] },
        ],
      },
      forbiddenTerms: terms,
      showComplianceHints: false,
    })
    expect(ids(problems).some((id) => id.startsWith('redline'))).toBe(false)
    expect(ids(problems)).toEqual(['structure-dimension-empty-1'])
  })

  it('排序：先「必须先处理」，红线整组垫底（只提示不中断的不该抢在前面）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed(),
      config: { body: '{M}', dimensions: [{ name: 'M', options: ['军绿色工装', ''], weight: 1 }] },
      forbiddenTerms: terms,
      showComplianceHints: true,
    })
    const levels = problems.map((problem) => problem.level)
    // 所有的 error 必须都排在第一个 warn 之前
    expect(levels.lastIndexOf('error')).toBeLessThan(levels.indexOf('warn'))
    expect(problems.at(-1)?.group).toBe('redline')
  })

  it('resolveRecipeDisplayTerms：不显式打开总开关时一律空词表（不许「缺省即开」）', () => {
    expect(resolveRecipeDisplayTerms(undefined, terms)).toEqual([])
    expect(resolveRecipeDisplayTerms(false, terms)).toEqual([])
    expect(resolveRecipeDisplayTerms(true, terms)).toEqual(terms)
    // 不传词表 = 内置默认（不是「没有红线」）
    expect(resolveRecipeDisplayTerms(true, undefined)).toEqual(CAMPAIGN_RECIPE_FORBIDDEN_RULES)
    // 「用户把红线全关了」用空数组表达，与「没传」是两件事
    expect(resolveRecipeDisplayTerms(true, [])).toEqual([])
  })
})

describe('落点：键与层级', () => {
  it('落点键稳定且能区分下标', () => {
    expect(problemTargetKey({ kind: 'rawText' })).toBe('raw')
    expect(problemTargetKey({ kind: 'body' })).toBe('body')
    expect(problemTargetKey({ kind: 'dimensions' })).toBe('dimensions')
    expect(problemTargetKey({ kind: 'dimension', index: 1 })).toBe('dim:1')
    expect(problemTargetKey({ kind: 'option', dimensionIndex: 1, optionIndex: 2 })).toBe('opt:1:2')
    expect(problemTargetKey({ kind: 'term', index: 3 })).toBe('term:3')
    expect(problemTargetKey({ kind: 'terms' })).toBe('terms')
    expect(problemTargetKey({ kind: 'name' })).toBe('name')
    expect(problemTargetKey({ kind: 'description' })).toBe('desc')
  })

  it('层级决定「点了要做什么」：面板内 / 弹窗内 / 弹窗外', () => {
    expect(recipeTargetScope({ kind: 'rawText' })).toBe('panel')
    expect(recipeTargetScope({ kind: 'body' })).toBe('dialog')
    expect(recipeTargetScope({ kind: 'dimension', index: 0 })).toBe('dialog')
    expect(recipeTargetScope({ kind: 'option', dimensionIndex: 0, optionIndex: 0 })).toBe('dialog')
    expect(recipeTargetScope({ kind: 'terms' })).toBe('dialog')
    expect(recipeTargetScope({ kind: 'name' })).toBe('outside')
    expect(recipeTargetScope({ kind: 'description' })).toBe('outside')
  })

  it('每条问题都带人话位置（没落点的纯提示除外）', () => {
    const problems = buildRecipeProblems({
      parsed: makeParsed({ name: '' }),
      config: HEALTHY_CONFIG,
    })
    for (const problem of problems) {
      if (problem.target) expect(problem.location?.length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('summarizeRecipeProblems', () => {
  it('总数与「必须先处理」的条数（界面上的唯一报数口径）', () => {
    const problems: RecipeProblem[] = [
      { id: 'a', group: 'recipe', level: 'error', title: 'a', advise: '', actions: [] },
      { id: 'b', group: 'recipe', level: 'warn', title: 'b', advise: '', actions: [] },
      { id: 'c', group: 'redline', level: 'warn', title: 'c', advise: '', actions: [] },
    ]
    expect(summarizeRecipeProblems(problems)).toEqual({ total: 3, blocking: 1 })
    expect(summarizeRecipeProblems([])).toEqual({ total: 0, blocking: 0 })
  })
})

describe('骨架文本的两个小编辑', () => {
  it('appendPlaceholderToBody：末尾已有标点就不重复加分隔符', () => {
    expect(appendPlaceholderToBody('{M}', 'S1')).toBe('{M}，{S1}')
    expect(appendPlaceholderToBody('{M},', 'S1')).toBe('{M}, {S1}')
    expect(appendPlaceholderToBody('', 'S1')).toBe('{S1}')
    expect(appendPlaceholderToBody('   ', 'S1')).toBe('{S1}')
  })

  it('removePlaceholderFromBody：两种花括号都删，并收干净留下的分隔符', () => {
    expect(removePlaceholderFromBody('{M}, {S1}, {S2}', 'S1')).toBe('{M}, {S2}')
    expect(removePlaceholderFromBody('{{M}}，{{S1}}', 'S1')).toBe('{{M}}')
    expect(removePlaceholderFromBody('{M}, {S1}', 'M')).toBe('{S1}')
  })

  it('removePlaceholderFromBody：占位符单独占一行时把那一行去掉，但不动别的空行', () => {
    expect(removePlaceholderFromBody('第一行\n{S9}\n\n第三行', 'S9')).toBe('第一行\n\n第三行')
  })

  it('removePlaceholderFromBody：名字里带正则特殊字符也不炸', () => {
    expect(removePlaceholderFromBody('{a.b}, {M}', 'a.b')).toBe('{M}')
  })
})
