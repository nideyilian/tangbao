import { describe, expect, it } from 'vitest'
import {
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
    expect(normalizeRecipeForbiddenTerms([' 提现 ', '提现', '', '   ', 3, null, '军'])).toEqual(['提现', '军'])
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

describe('recipeForbiddenTerms 判定', () => {
  it('缺省按默认词表判定', () => {
    expect(findRecipeForbiddenViolations('日赚千元不是梦')).toEqual(['日赚'])
    expect(findRecipeForbiddenViolations('国家级领导人')).toEqual(['国家级', '领导人'])
    expect(findRecipeForbiddenViolations('产品特写，暖调，木质桌面')).toEqual([])
    expect(isRecipeCompliant('产品特写，暖调')).toBe(true)
  })

  it('resolve：没传用默认；传了（含空数组）原样用', () => {
    expect(resolveRecipeForbiddenTerms(undefined)).toBe(DEFAULT_RECIPE_FORBIDDEN_TERMS)
    expect(resolveRecipeForbiddenTerms([])).toEqual([])
    expect(resolveRecipeForbiddenTerms(['军'])).toEqual(['军'])
  })

  // ⚠️ 界面「加一条」时那一格是空的（用户还没输入完）。判定用的是 `text.includes(term)`，
  // 而任意文本都 includes('') —— 只要空串漏进词表，所有提示词都会被判违规。
  it('空串（含全空白）不参与判定，绝不会「命中一切」', () => {
    expect(findRecipeForbiddenViolations('完全干净的文案', [''])).toEqual([])
    expect(findRecipeForbiddenViolations('完全干净的文案', ['  ', '  '])).toEqual([])
    expect(findRecipeForbiddenViolations('完全干净的文案', ['', '军'])).toEqual([])
    expect(findRecipeForbiddenViolations('军绿色工装', ['', '军'])).toEqual(['军'])
  })

  it('默认词表仍是需求指定的那 21 个词', () => {
    expect([...DEFAULT_RECIPE_FORBIDDEN_TERMS]).toHaveLength(21)
    for (const term of ['人民币', '现金', '钞票', '提现', '军', '警', '裸']) {
      expect(DEFAULT_RECIPE_FORBIDDEN_TERMS).toContain(term)
    }
  })
})
