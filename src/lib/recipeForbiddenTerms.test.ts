import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECIPE_FORBIDDEN_RULES,
  DEFAULT_RECIPE_FORBIDDEN_TERMS,
  findRecipeForbiddenViolations,
  isRecipeCompliant,
  normalizeRecipeForbiddenTerms,
  resolveRecipeForbiddenTerms,
} from './recipeForbiddenTerms'

describe('recipeForbiddenTerms 归一化（用户词表）', () => {
  it('「没配过」与「清空」是两种语义，不能混', () => {
    // undefined = 字段不存在（旧存档 / 新用户）⇒ 调用方回落到默认词表
    expect(normalizeRecipeForbiddenTerms(undefined)).toBeUndefined()
    expect(normalizeRecipeForbiddenTerms(null)).toBeUndefined()
    expect(normalizeRecipeForbiddenTerms('不是数组')).toBeUndefined()
    // [] = 用户明确把红线全删光 ⇒ 必须原样保留，不能折算成 undefined（否则默认词表又冒回来）
    expect(normalizeRecipeForbiddenTerms([])).toEqual([])
  })

  it('trim / 去空 / 去重，保持输入顺序', () => {
    expect(normalizeRecipeForbiddenTerms([' 提现 ', '提现', '', '   ', 3, null, '军'])).toEqual([
      { term: '提现', allow: [] },
      { term: '军', allow: [] },
    ])
  })

  /**
   * TB-145：升级前存档里存的是**纯字符串数组**。读进来必须照收，
   * 语义 = 「这个词没有例外」，判定行为与升级前完全一致（不能因为这次升级就让老用户变样）。
   */
  it('旧存档（纯字符串数组）照收，补成空例外', () => {
    expect(normalizeRecipeForbiddenTerms(['军', '裸'])).toEqual([
      { term: '军', allow: [] },
      { term: '裸', allow: [] },
    ])
    // 混合形态也认（用户改过词表之后，存档里会既有串又有对象）
    expect(normalizeRecipeForbiddenTerms(['军', { term: '裸', allow: ['裸妆'] }])).toEqual([
      { term: '军', allow: [] },
      { term: '裸', allow: ['裸妆'] },
    ])
  })

  it('归一化结果喂回判定：用户删掉的词不再命中（闭环）', () => {
    const raw = DEFAULT_RECIPE_FORBIDDEN_TERMS.filter((term) => term !== '提现')
    const stored = normalizeRecipeForbiddenTerms(raw)
    expect(stored).toBeDefined()
    expect(findRecipeForbiddenViolations('点击提现到账', stored)).toEqual([])
    // 没动过的词照旧命中
    expect(findRecipeForbiddenViolations('日赚千元', stored)).toEqual(['日赚'])
  })
})

describe('recipeForbiddenTerms 判定（基础）', () => {
  it('缺省按默认词表判定', () => {
    expect(findRecipeForbiddenViolations('日赚千元不是梦')).toEqual(['日赚'])
    expect(findRecipeForbiddenViolations('国家级领导人')).toEqual(['国家级', '领导人'])
    expect(findRecipeForbiddenViolations('产品特写，暖调，木质桌面')).toEqual([])
    expect(isRecipeCompliant('产品特写，暖调')).toBe(true)
  })

  it('resolve：没传用默认规则；传了（含空数组）原样用', () => {
    expect(resolveRecipeForbiddenTerms(undefined)).toBe(DEFAULT_RECIPE_FORBIDDEN_RULES)
    expect(resolveRecipeForbiddenTerms([])).toEqual([])
    expect(resolveRecipeForbiddenTerms(['军'])).toEqual([{ term: '军', allow: [] }])
  })

  // ⚠️ 界面「加一条」时那一格是空的（用户还没输入完）。判定用的是 `text.includes(term)`，
  // 而任意文本都 includes('') —— 只要空串漏进词表，所有提示词都会被判违规。
  it('空串（含全空白）不参与判定，绝不会「命中一切」', () => {
    expect(findRecipeForbiddenViolations('完全干净的文案', [''])).toEqual([])
    expect(findRecipeForbiddenViolations('完全干净的文案', ['  ', '  '])).toEqual([])
    expect(findRecipeForbiddenViolations('完全干净的文案', ['', '军'])).toEqual([])
    // 传纯字符串时没有例外 ⇒「军绿色」仍会被拦（想放行就要配例外，见下一组）
    expect(findRecipeForbiddenViolations('军绿色工装', ['', '军'])).toEqual(['军'])
  })

  it('默认词表仍是需求指定的那 21 个词', () => {
    expect([...DEFAULT_RECIPE_FORBIDDEN_TERMS]).toHaveLength(21)
    expect([...DEFAULT_RECIPE_FORBIDDEN_RULES]).toHaveLength(21)
    for (const term of ['人民币', '现金', '钞票', '提现', '军', '警', '裸']) {
      expect(DEFAULT_RECIPE_FORBIDDEN_TERMS).toContain(term)
    }
    // 词名列表由规则派生 —— 两者必须同步，否则界面「恢复默认 N 词」会与实际条数对不上
    expect([...DEFAULT_RECIPE_FORBIDDEN_TERMS]).toEqual(DEFAULT_RECIPE_FORBIDDEN_RULES.map((item) => item.term))
  })
})

/**
 * TB-145 的核心：**例外词**让「正常搭配放行」与「违规用法照拦」同时成立。
 *
 * 需求原话：「当前红线表经常误伤正常描述，例如"裸妆"因含"裸"字而被一并禁用，这并不合理。」
 */
describe('recipeForbiddenTerms 例外词（TB-145）', () => {
  it('单字词不再误伤正常搭配（杰哥点名的「裸妆」）', () => {
    for (const text of ['裸妆效果，自然清透', '裸色系唇釉试色', '裸粉渐变背景', '裸眼3D视觉', '裸感妆效']) {
      expect(findRecipeForbiddenViolations(text)).toEqual([])
    }
  })

  it('同类误伤一并覆盖：军 / 警 / 第一 / 最高 / 现金', () => {
    for (const text of [
      '军绿色工装外套',
      '军旅题材插画',
      '画面是密集军阵与旌旗',
      '他机警地回头看了一眼',
      '警醒色调，警示感构图',
      '第一人称视角拍摄',
      '第一时间捕捉到画面',
      '第一印象很干净',
      '山最高峰处的云海',
      '现金流稳定的商务场景',
    ]) {
      expect(findRecipeForbiddenViolations(text)).toEqual([])
    }
  })

  it('违规用法照旧拦住（例外不是把这个词关掉）', () => {
    expect(findRecipeForbiddenViolations('裸体艺术人像')).toEqual(['裸体', '裸'])
    expect(findRecipeForbiddenViolations('全裸出镜')).toEqual(['裸'])
    expect(findRecipeForbiddenViolations('参军报国')).toEqual(['军'])
    expect(findRecipeForbiddenViolations('色情低俗内容')).toEqual(['色情'])
    expect(findRecipeForbiddenViolations('点击提现到账')).toEqual(['提现'])
    expect(findRecipeForbiddenViolations('稳稳赚钱的方法')).toEqual(['赚钱', '稳赚'])
  })

  /**
   * ⭐ 本方案与「有例外就跳过整个词」的分水岭。
   *
   * 后者实现更省事（`if (text.includes(allow)) continue`），但会在**一句话里同时出现**
   * 正常搭配与违规用法时整条放过 —— 误判修好了，漏判又来了。
   * 挖空法把例外词先摘掉再判，剩下的部分照常查。
   */
  it('⭐ 一句里同时有正常搭配与违规用法时，仍然拦住（不被整体放过）', () => {
    expect(findRecipeForbiddenViolations('裸妆和裸体同框')).toEqual(['裸体', '裸'])
    expect(findRecipeForbiddenViolations('军绿色工装与军队方阵')).toEqual(['军'])
    expect(findRecipeForbiddenViolations('第一时间参军')).toEqual(['军'])
  })

  it('用户自定义例外同样生效，且只豁免填进去的那一段', () => {
    const rules = [
      { term: '苹果', allow: ['苹果绿'] },
      { term: '香蕉', allow: [] },
    ]
    expect(findRecipeForbiddenViolations('苹果绿的墙面', rules)).toEqual([])
    // 同一句里另一处「苹果」不在例外里 ⇒ 照拦
    expect(findRecipeForbiddenViolations('苹果绿的墙面，旁边摆着苹果', rules)).toEqual(['苹果'])
    expect(findRecipeForbiddenViolations('香蕉', rules)).toEqual(['香蕉'])
  })

  /**
   * 挖空必须用占位符，不能直接删除：删除会把断口两侧**拼起来**，
   * 可能拼出一个原文里根本不存在的违规词（假命中）。
   */
  it('挖空用占位符而不是删除：不会把断口两侧拼出新词', () => {
    // 「X」被豁免 ⇒ 判定前会被挖掉。若实现是删除，'AXB' 会被拼成 'AB'（假命中规则「AB」）；
    // 用占位符则保持 'A\u0000B'，拼不出任何东西。
    const rules = [
      { term: 'AB', allow: [] },
      { term: 'X', allow: ['X'] },
    ]
    expect(findRecipeForbiddenViolations('AXB', rules)).toEqual([])
  })

  /**
   * ⚠️ 例外表里的空串**比词表里的更阴险**：`'裸妆'.split('').join('\0')` 会把正文
   * **逐字拆散**，该词的例外从此静默失效，而界面上它看起来还在工作。
   * 所以例外表必须与词表同口径归一化（trim / 去空 / 去重），不能直接拿来用。
   */
  it('例外表也做 trim / 去空 / 去重（混进空串不能让该词失效）', () => {
    const rules = [{ term: '裸', allow: ['', '  ', '裸妆', '裸妆', ' 裸妆 '] }]
    // 例外照常生效（未被空串干扰）
    expect(findRecipeForbiddenViolations('裸妆效果', rules)).toEqual([])
    // 违规用法照常命中
    expect(findRecipeForbiddenViolations('裸体艺术', rules)).toEqual(['裸'])
  })

  it('重复词名只留第一条（含它当时的例外）', () => {
    const normalized = normalizeRecipeForbiddenTerms([
      { term: '裸', allow: ['裸妆'] },
      { term: '裸', allow: [] },
    ])
    expect(normalized).toEqual([{ term: '裸', allow: ['裸妆'] }])
    expect(findRecipeForbiddenViolations('裸妆效果', normalized)).toEqual([])
  })

  it('词表为空 = 红线全关（一条都不拦）', () => {
    expect(findRecipeForbiddenViolations('裸体艺术人像', [])).toEqual([])
    expect(isRecipeCompliant('日赚千元', [])).toBe(true)
  })
})
