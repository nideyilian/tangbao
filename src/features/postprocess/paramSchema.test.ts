/**
 * 参数元数据表的契约。
 *
 * 这里的断言都是「防重复定义」这一目标本身的可测形式：
 * 键唯一、分组都能落到、作用域分明、方向选项只有这一份。
 */

import { describe, expect, it } from 'vitest'
import {
  DIRECTION_OPTIONS,
  GLOBAL_NODE_ID,
  PARAM_GROUPS,
  POSTPROCESS_PARAM_FIELDS,
  selectParamFields,
  selectParamFieldsByGroup,
  validateNamePattern,
} from './paramSchema'

describe('paramSchema · 单一来源约束', () => {
  it('字段键唯一（同一个参数不会声明两遍）', () => {
    const keys = POSTPROCESS_PARAM_FIELDS.map((field) => field.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('每个字段的分组都在 PARAM_GROUPS 里有定义', () => {
    const groups = new Set(PARAM_GROUPS.map((group) => group.id))
    for (const field of POSTPROCESS_PARAM_FIELDS) {
      expect(groups.has(field.group), `${field.key} 的分组 ${field.group} 没有定义`).toBe(true)
    }
  })

  it('分组 id 唯一', () => {
    const ids = PARAM_GROUPS.map((group) => group.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('方向选项只有这一份，且顺序固定', () => {
    expect(DIRECTION_OPTIONS.map((option) => option.value)).toEqual(['auto', 'landscape', 'portrait', 'square'])
    expect(DIRECTION_OPTIONS[0].label).toBe('跟随尺寸')
  })

  it('全局节点 id 是哨兵值，不会与真实 collection id 混淆', () => {
    expect(GLOBAL_NODE_ID).toMatch(/^__/)
  })
})

describe('paramSchema · 作用域', () => {
  it('全局作用域排除只属于节点的字段', () => {
    const controls = selectParamFields('global').map((field) => field.control)
    expect(controls).not.toContain('enabled')
    expect(controls).toContain('media')
    expect(controls).toContain('mediaTable')
    expect(controls).toContain('outputPreview')
  })

  it('节点作用域排除只属于全局的字段', () => {
    const controls = selectParamFields('node').map((field) => field.control)
    expect(controls).toContain('enabled')
    expect(controls).not.toContain('mediaTable')
    expect(controls).not.toContain('outputPreview')
  })

  it('两种作用域共用同一批 both 字段', () => {
    const globalKeys = new Set(selectParamFields('global').map((field) => field.key))
    const nodeKeys = new Set(selectParamFields('node').map((field) => field.key))
    for (const field of POSTPROCESS_PARAM_FIELDS.filter((item) => item.scope === 'both')) {
      expect(globalKeys.has(field.key)).toBe(true)
      expect(nodeKeys.has(field.key)).toBe(true)
    }
  })

  it('分组选择器不返回空分组（避免全局节点上出现空的「参与方式」）', () => {
    for (const scope of ['global', 'node'] as const) {
      for (const entry of selectParamFieldsByGroup(scope)) {
        expect(entry.fields.length).toBeGreaterThan(0)
      }
      // 两种作用域覆盖的字段集合应等于该作用域的全部字段
      const total = selectParamFieldsByGroup(scope).reduce((sum, entry) => sum + entry.fields.length, 0)
      expect(total).toBe(selectParamFields(scope).length)
    }
  })

  it('每个分组在至少一种作用域下有字段，不会出现死分组', () => {
    const used = new Set(POSTPROCESS_PARAM_FIELDS.map((field) => field.group))
    for (const group of PARAM_GROUPS) {
      expect(used.has(group.id), `分组 ${group.id} 没有任何字段`).toBe(true)
    }
  })
})

describe('paramSchema · 命名模板校验', () => {
  it('全部通过时返回空数组', () => {
    expect(validateNamePattern('{date}-{seq}', { unknown: [], missing: [], duplicated: [] })).toEqual([])
  })

  it('未知占位符是 error', () => {
    const issues = validateNamePattern('{oops}', { unknown: ['oops'], missing: [], duplicated: [] })
    expect(issues).toHaveLength(1)
    expect(issues[0].tone).toBe('error')
    expect(issues[0].message).toContain('{oops}')
  })

  it('缺少占位符是 error，并说明会互相覆盖', () => {
    const issues = validateNamePattern('{date}', { unknown: [], missing: ['seq'], duplicated: [] })
    expect(issues[0].tone).toBe('error')
    expect(issues[0].message).toContain('覆盖')
  })

  it('重复占位符只是 warning', () => {
    const issues = validateNamePattern('{size}-{size}', { unknown: [], missing: [], duplicated: ['size'] })
    expect(issues[0].tone).toBe('warning')
  })

  it('多个问题同时报出，不互相盖掉', () => {
    const issues = validateNamePattern('{oops}', { unknown: ['oops'], missing: ['seq'], duplicated: ['size'] })
    expect(issues).toHaveLength(3)
  })
})
