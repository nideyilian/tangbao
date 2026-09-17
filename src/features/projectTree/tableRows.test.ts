import { describe, expect, it } from 'vitest'
import type { AssetCollection } from '../../types'
import {
  buildProjectTreeTableRows,
  filterProjectTreeTableRows,
  listAvailableParents,
  summarizeProjectTreeRows,
} from './tableRows'
import type { ProjectNodeParamsMap } from './types'

function collection(
  id: string,
  name: string,
  parentId: string | null = null,
  order = 0,
  extra: Partial<AssetCollection> = {},
): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 0, updatedAt: 0, ...extra }
}

/** 两条产品线：保险（1 产品 2 方向）、卡券（1 产品 1 方向）。 */
const LINE_A = 'a'
const PRODUCT_A1 = 'a1'
const DIRECTION_A1X = 'a1x'
const DIRECTION_A1Y = 'a1y'
const LINE_B = 'b'
const PRODUCT_B1 = 'b1'
const DIRECTION_B1X = 'b1x'

const COLLECTIONS: AssetCollection[] = [
  collection(LINE_A, '保险', null, 0),
  collection(PRODUCT_A1, '百万医疗险', LINE_A, 0),
  collection(DIRECTION_A1X, '月亮', PRODUCT_A1, 0),
  collection(DIRECTION_A1Y, '图标', PRODUCT_A1, 1),
  collection(LINE_B, '卡券', null, 1),
  collection(PRODUCT_B1, 'QQ阅读', LINE_B, 0),
  collection(DIRECTION_B1X, '插画', PRODUCT_B1, 0),
]

describe('buildProjectTreeTableRows', () => {
  it('按「父在前」的深度优先顺序展平', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    expect(rows.map((row) => row.id)).toEqual([
      LINE_A,
      PRODUCT_A1,
      DIRECTION_A1X,
      DIRECTION_A1Y,
      LINE_B,
      PRODUCT_B1,
      DIRECTION_B1X,
    ])
  })

  it('给出层级、路径与子节点数', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    const direction = rows.find((row) => row.id === DIRECTION_A1X)
    expect(direction).toMatchObject({
      kind: 'direction',
      depth: 2,
      path: '保险 / 百万医疗险 / 月亮',
      pathNames: ['保险', '百万医疗险', '月亮'],
      childCount: 0,
    })
    expect(rows.find((row) => row.id === PRODUCT_A1)?.childCount).toBe(2)
    expect(rows.find((row) => row.id === LINE_A)).toMatchObject({ kind: 'line', depth: 0, childCount: 1 })
  })

  it('回收站里的节点不出现', () => {
    const withTrash = [...COLLECTIONS, collection('trash', '已删', LINE_A, 9, { trashedAt: 123 })]
    const rows = buildProjectTreeTableRows(withTrash, {})
    expect(rows.some((row) => row.id === 'trash')).toBe(false)
  })

  it('参数来源按「自身优先，否则最近祖先」标记，用于区分自配与继承', () => {
    const params: ProjectNodeParamsMap = {
      [LINE_A]: { postprocess: { watermarkPresetId: 'p-line' } },
      [DIRECTION_A1Y]: { postprocess: { watermarkPresetId: 'p-direction' } },
    }
    const rows = buildProjectTreeTableRows(COLLECTIONS, params)
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get(LINE_A)?.paramsSourcedFrom).toBe(LINE_A)
    expect(byId.get(LINE_A)?.hasOwnParams).toBe(true)
    // 产品没自配 → 来源是产品线
    expect(byId.get(PRODUCT_A1)?.paramsSourcedFrom).toBe(LINE_A)
    expect(byId.get(PRODUCT_A1)?.hasOwnParams).toBe(false)
    expect(byId.get(DIRECTION_A1X)?.paramsSourcedFrom).toBe(LINE_A)
    // 自己配了 → 来源是自己
    expect(byId.get(DIRECTION_A1Y)?.paramsSourcedFrom).toBe(DIRECTION_A1Y)
    // 另一条产品线完全没配 → 无来源
    expect(byId.get(DIRECTION_B1X)?.paramsSourcedFrom).toBeNull()
  })

  it('默认（未勾选任何节点）时整棵树都不在启用范围内', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    expect(rows.every((row) => !row.postprocessEnabled)).toBe(true)
    expect(rows.every((row) => !row.postprocessEnabledInherited)).toBe(true)
  })

  it('勾了产品线 → 旗下产品与方向都按继承启用', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {}, [LINE_A])
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get(LINE_A)).toMatchObject({ postprocessEnabled: true, postprocessEnabledInherited: false })
    // 子级自己被勾 → 生效但标记为继承，表格里只读
    expect(byId.get(PRODUCT_A1)).toMatchObject({ postprocessEnabled: true, postprocessEnabledInherited: true })
    expect(byId.get(DIRECTION_A1X)).toMatchObject({ postprocessEnabled: true, postprocessEnabledInherited: true })
    // 另一条产品线不受影响
    expect(byId.get(LINE_B)).toMatchObject({ postprocessEnabled: false, postprocessEnabledInherited: false })
    expect(byId.get(DIRECTION_B1X)?.postprocessEnabled).toBe(false)
  })

  it('只勾方向 → 祖先不启用（启用方向不连带整条产品线）', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {}, [DIRECTION_A1X])
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get(DIRECTION_A1X)).toMatchObject({ postprocessEnabled: true, postprocessEnabledInherited: false })
    expect(byId.get(LINE_A)?.postprocessEnabled).toBe(false)
    expect(byId.get(PRODUCT_A1)?.postprocessEnabled).toBe(false)
    // 同产品下的另一个方向没被连带
    expect(byId.get(DIRECTION_A1Y)?.postprocessEnabled).toBe(false)
  })

  it('勾选里混入不存在 / 空串的 id 时按未勾处理，不误启用', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {}, ['ghost', '  '])
    expect(rows.every((row) => !row.postprocessEnabled)).toBe(true)
  })
})

describe('filterProjectTreeTableRows', () => {
  it('空关键词返回全部', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    expect(filterProjectTreeTableRows(rows, '   ')).toHaveLength(rows.length)
  })

  it('命中的节点连同整条祖先链一起保留', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    const filtered = filterProjectTreeTableRows(rows, '月亮')
    expect(filtered.map((row) => row.id)).toEqual([LINE_A, PRODUCT_A1, DIRECTION_A1X])
  })

  it('按完整路径也能搜到（用产品线名筛出整条线）', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    const filtered = filterProjectTreeTableRows(rows, '保险 / 百万医疗险')
    expect(filtered.map((row) => row.id)).toEqual([LINE_A, PRODUCT_A1, DIRECTION_A1X, DIRECTION_A1Y])
  })

  it('没有命中时返回空数组，不残留父级', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    expect(filterProjectTreeTableRows(rows, '不存在的名字')).toEqual([])
  })
})

describe('summarizeProjectTreeRows', () => {
  it('统计各级数量、已配参数节点数、启用范围内节点数', () => {
    const params: ProjectNodeParamsMap = { [LINE_A]: { postprocess: { creator: '设计组' } } }
    const rows = buildProjectTreeTableRows(COLLECTIONS, params)
    expect(summarizeProjectTreeRows(rows)).toEqual({
      total: 7,
      line: 2,
      product: 2,
      direction: 3,
      configured: 1,
      enabled: 0,
    })
  })

  it('启用范围把被勾节点及其后代算进去', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {}, [PRODUCT_A1])
    // 产品 + 它下面两个方向
    expect(summarizeProjectTreeRows(rows).enabled).toBe(3)
  })
})

describe('listAvailableParents', () => {
  it('新增节点（无自身）时可选任意节点', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    expect(listAvailableParents(rows, null)).toHaveLength(rows.length)
  })

  it('排除自身与全部后代，避免把节点移进自己的子树', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    const available = listAvailableParents(rows, LINE_A).map((row) => row.id)
    expect(available).not.toContain(LINE_A)
    expect(available).not.toContain(PRODUCT_A1)
    expect(available).not.toContain(DIRECTION_A1X)
    // 另一条产品线仍然可选（跨线搬迁是合法操作）
    expect(available).toContain(LINE_B)
    expect(available).toContain(DIRECTION_B1X)
  })

  it('叶子节点的后代为空，只剩自身被排除', () => {
    const rows = buildProjectTreeTableRows(COLLECTIONS, {})
    const available = listAvailableParents(rows, DIRECTION_A1X).map((row) => row.id)
    expect(available).toEqual([LINE_A, PRODUCT_A1, DIRECTION_A1Y, LINE_B, PRODUCT_B1, DIRECTION_B1X])
  })
})
