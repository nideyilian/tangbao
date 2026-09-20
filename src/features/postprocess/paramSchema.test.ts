/**
 * 参数元数据表的契约。
 *
 * 断言都是「防重复定义」这一目标本身的可测形式：
 * 键唯一、分组都能落到、没有死分组、组说明不与字段说明重复，
 * 以及**全局独有参数不在这张表里**（它们在中控台分区有唯一入口，本表只管方向级）。
 */

import { describe, expect, it } from 'vitest'
import {
  GLOBAL_NODE_ID,
  PARAM_GROUPS,
  POSTPROCESS_PARAM_FIELDS,
  selectParamFields,
  selectParamFieldsByGroup,
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

  it('全局节点 id 是哨兵值，不会与真实 collection id 混淆', () => {
    expect(GLOBAL_NODE_ID).toMatch(/^__/)
  })
})

describe('paramSchema · 只描述方向级参数', () => {
  it('表里只有方向级可覆盖字段；全局独有参数一律不在（它们在中控台分区）', () => {
    // 全局独有参数：渠道与尺寸、画面方向、命名模板、创作者、分发、纯净版伴随、产出预览。
    // 它们一旦回到这张表，就又变成「同一参数两个入口」，那正是这次收窄要消除的重复。
    expect(selectParamFields().map((field) => field.control)).toEqual(['enabled', 'outputDir', 'watermarkBinding'])
  })

  it('分组顺序即操作顺序：先决定参不参与，再决定产出放哪，最后是水印', () => {
    expect(PARAM_GROUPS.map((group) => group.id)).toEqual(['participation', 'output', 'watermark'])
  })

  it('分组选择器不返回空分组，也不丢字段', () => {
    for (const entry of selectParamFieldsByGroup()) {
      expect(entry.fields.length).toBeGreaterThan(0)
    }
    const total = selectParamFieldsByGroup().reduce((sum, entry) => sum + entry.fields.length, 0)
    expect(total).toBe(selectParamFields().length)
  })

  it('每个分组都有字段，不会出现死分组', () => {
    const used = new Set(POSTPROCESS_PARAM_FIELDS.map((field) => field.group))
    for (const group of PARAM_GROUPS) {
      expect(used.has(group.id), `分组 ${group.id} 没有任何字段`).toBe(true)
    }
  })

  it('组说明不与任何字段说明重复（同一句说明只能出现一处）', () => {
    const helps = new Set(POSTPROCESS_PARAM_FIELDS.map((field) => field.help).filter(Boolean))
    for (const group of PARAM_GROUPS) {
      if (!group.description) continue
      expect(helps.has(group.description), `分组 ${group.id} 的说明与某个字段的 help 逐字重复`).toBe(false)
    }
  })
})
