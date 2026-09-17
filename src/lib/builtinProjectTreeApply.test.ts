import { describe, expect, it, vi } from 'vitest'
import type { AssetCollection } from '../types'
import { flattenBuiltinProjectTree } from './builtinProjectTree'
import { applyBuiltinProjectTree, countMissingBuiltinNodes } from './builtinProjectTreeApply'

const TOTAL_BUILTIN_NODES = 3 + 13 + 61

function collection(partial: Partial<AssetCollection> & { id: string; name: string }): AssetCollection {
  return {
    normalizedName: partial.name.toLocaleLowerCase('zh-CN'),
    parentId: null,
    order: 0,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

function createDeps() {
  const saved: AssetCollection[] = []
  return {
    saved,
    putCollection: vi.fn(async (item: AssetCollection) => {
      saved.push(item)
      return item
    }),
  }
}

describe('内置结构写入项目文件夹树', () => {
  it('空库时一次建满全部三级节点，且每级的父级都指向已存在的文件夹', async () => {
    const deps = createDeps()
    const result = await applyBuiltinProjectTree([], deps)

    expect(result.created).toHaveLength(TOTAL_BUILTIN_NODES)
    expect(deps.saved).toHaveLength(TOTAL_BUILTIN_NODES)
    const ids = new Set(result.collections.map((item) => item.id))
    for (const node of flattenBuiltinProjectTree()) {
      if (node.parentId) expect(ids.has(node.parentId)).toBe(true)
    }
    expect(deps.saved.find((item) => item.id === 'builtin-direction-10')).toMatchObject({
      name: '网赚',
      parentId: 'builtin-product-8',
    })
  })

  it('重复执行幂等：已存在的内置文件夹不新建、不改写', async () => {
    const first = createDeps()
    const applied = await applyBuiltinProjectTree([], first)

    const second = createDeps()
    const again = await applyBuiltinProjectTree(applied.collections, second)

    expect(again.created).toHaveLength(0)
    expect(second.putCollection).not.toHaveBeenCalled()
    expect(again.reused).toBe(TOTAL_BUILTIN_NODES)
  })

  it('用户改过名 / 移动过的内置文件夹原样保留，不被覆盖回原名', async () => {
    const renamed = collection({ id: 'builtin-line-7', name: '我的拉新线' })
    const deps = createDeps()

    const result = await applyBuiltinProjectTree([renamed], deps)

    expect(result.collections.find((item) => item.id === 'builtin-line-7')).toBe(renamed)
    expect(renamed.name).toBe('我的拉新线')
    expect(deps.saved.some((item) => item.id === 'builtin-line-7')).toBe(false)
    // 子级仍按 id 挂到被改名的父级下，不因改名而断链
    expect(deps.saved.find((item) => item.id === 'builtin-product-8')?.parentId).toBe('builtin-line-7')
  })

  it('父级缺失时按「补齐」语义先补回父节点，已存在的子级全部复用', async () => {
    const applied = await applyBuiltinProjectTree([], createDeps())
    // 模拟「APP-拉新」这条产品线本身不在集合里（其余节点仍在）
    const withoutLine = applied.collections.filter((item) => item.id !== 'builtin-line-7')

    const deps = createDeps()
    const result = await applyBuiltinProjectTree(withoutLine, deps)

    expect(result.created.map((item) => item.id)).toEqual(['builtin-line-7'])
    expect(result.reused).toBe(TOTAL_BUILTIN_NODES - 1)
    expect(result.skipped).toBe(0)
  })

  it('回收站里的内置文件夹视为已存在：不复活，其子树一并跳过', async () => {
    const trashedParent = collection({ id: 'builtin-line-7', name: 'APP-拉新', trashedAt: 100 })
    const deps = createDeps()

    const result = await applyBuiltinProjectTree([trashedParent], deps)

    expect(deps.saved.some((item) => item.id === 'builtin-line-7')).toBe(false)
    expect(result.collections).toContain(trashedParent)
    expect(deps.saved.some((item) => item.parentId === 'builtin-line-7')).toBe(false)
    // 另外两条产品线（及各自的子级）正常写入
    expect(deps.saved.filter((item) => item.parentId === null).map((item) => item.id)).toEqual([
      'builtin-line-6',
      'builtin-line-10',
    ])
  })

  it('countMissingBuiltinNodes 只统计缺失项，全量写入后归零', async () => {
    expect(countMissingBuiltinNodes([])).toBe(TOTAL_BUILTIN_NODES)
    const applied = await applyBuiltinProjectTree([], createDeps())
    expect(countMissingBuiltinNodes(applied.collections)).toBe(0)
    // 删掉一个叶子方向：缺失数恰好为 1
    const withoutLeaf = applied.collections.filter((item) => item.id !== 'builtin-direction-10')
    expect(countMissingBuiltinNodes(withoutLeaf)).toBe(1)
    // 删掉整条「APP-拉新」及其直接子级：该分支全部计入缺失
    const withoutLine = applied.collections.filter(
      (item) => item.id !== 'builtin-line-7' && item.parentId !== 'builtin-line-7',
    )
    expect(countMissingBuiltinNodes(withoutLine)).toBe(1 + 11 + 53)
  })
})
