import { describe, expect, it } from 'vitest'
import { BUILTIN_PROJECT_TREE, flattenBuiltinProjectTree, isBuiltinProjectNodeId } from './builtinProjectTree'

describe('内置「产品线 - 产品 - 方向」结构', () => {
  it('包含 3 条产品线 / 13 个产品 / 61 个方向', () => {
    expect(BUILTIN_PROJECT_TREE.map((line) => line.name)).toEqual(['保险', 'APP-拉新', '卡券'])
    const products = BUILTIN_PROJECT_TREE.flatMap((line) => line.products)
    expect(products).toHaveLength(13)
    expect(products.reduce((total, product) => total + product.directions.length, 0)).toBe(61)
  })

  it('节点 id 全局唯一且都带内置前缀（可稳定识别，不依赖名称）', () => {
    const nodes = flattenBuiltinProjectTree()
    expect(nodes).toHaveLength(3 + 13 + 61)
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length)
    expect(nodes.every((node) => isBuiltinProjectNodeId(node.id))).toBe(true)
  })

  it('展平顺序保证父节点排在子节点之前', () => {
    const seen = new Set<string>()
    for (const node of flattenBuiltinProjectTree()) {
      if (node.parentId) expect(seen.has(node.parentId)).toBe(true)
      seen.add(node.id)
    }
  })

  it('层级与父子关系正确，同名方向在不同产品下各自独立', () => {
    const nodes = flattenBuiltinProjectTree()
    expect(nodes.find((node) => node.name === '快手')).toMatchObject({
      id: 'builtin-product-8',
      parentId: 'builtin-line-7',
      depth: 1,
    })
    expect(nodes.find((node) => node.id === 'builtin-direction-10')).toMatchObject({
      name: '网赚',
      parentId: 'builtin-product-8',
      depth: 2,
    })
    // 「网赚」在快手 / 百度 / 百度极速版等产品下都会出现，不能按名称合并
    const wangzhuan = nodes.filter((node) => node.name === '网赚')
    expect(wangzhuan.length).toBeGreaterThan(1)
    expect(new Set(wangzhuan.map((node) => node.id)).size).toBe(wangzhuan.length)
  })

  it('同层级节点保留明细表中的先后顺序', () => {
    const kuaishou = BUILTIN_PROJECT_TREE.find((line) => line.name === 'APP-拉新')!.products[0]
    expect(kuaishou.directions.map((direction) => direction.name)).toEqual([
      '网赚',
      '萌宠',
      '老歌',
      '旅游',
      '美食',
      '短剧',
      '一分购',
      '官方样式',
      '内容创意',
      '购物',
    ])
  })
})
