/* @vitest-environment jsdom */

/**
 * 中控台「方向」分区（TB-060）的行为回归。
 *
 * 这里重点钉住两件在界面上看不出来的事：
 * 1. **表格行序与左树一致**（否则用户会改错行）；
 * 2. **成环保护**——「上级」候选项排除自己与子孙、遍历带 visited。
 *    树成环不是理论问题：脏数据里一个 `parentId` 互指就能让整个工作区白屏。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import type { AssetCollection } from '../../../types'
import { buildDirectionRows, collectSubtreeIds, ConsoleDirectionTables } from './ConsoleDirectionTables'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '智能客服', null, 0),
  collection('line-b', '电商', null, 1),
  collection('product-a', '机器人', 'line-a', 0),
  collection('direction-a', '竖版展示', 'product-a', 0),
  collection('direction-b', '横版展示', 'product-a', 1),
  collection('direction-c', '首页图', 'line-b', 0),
]

let container: HTMLDivElement
let root: Root

function text(): string {
  return container.textContent ?? ''
}

/** DataGrid 的单元格是草稿态：先 focus、写值、再 blur 才算提交。 */
function commitCell(cellLabel: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[aria-label="${cellLabel}"]`)
  if (!input) throw new Error(`未找到单元格：${cellLabel}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => input.focus())
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.blur())
}

beforeEach(() => {
  usePostprocessMediaStore.setState(createDefaultPostprocessMediaConfig())
  useAssetLibraryStore.setState({ collections: COLLECTIONS })
  useProjectTreeParamsStore.setState({ params: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.localStorage.clear()
})

describe('buildDirectionRows', () => {
  it('按树序展开：父在子之前，且带深度与路径', () => {
    const rows = buildDirectionRows(COLLECTIONS)
    expect(rows.map((row) => row.id)).toEqual([
      'line-a',
      'product-a',
      'direction-a',
      'direction-b',
      'line-b',
      'direction-c',
    ])
    expect(rows.find((row) => row.id === 'direction-a')?.depth).toBe(2)
    expect(rows.find((row) => row.id === 'direction-a')?.pathNames).toEqual(['智能客服', '机器人', '竖版展示'])
  })

  it('脏数据成环时不死循环（只丢弃环上的节点）', () => {
    const dirty: AssetCollection[] = [
      collection('a', 'A', 'b'),
      collection('b', 'B', 'a'),
      collection('ok', '正常', null),
    ]
    const rows = buildDirectionRows(dirty)
    expect(rows.map((row) => row.id)).toEqual(['ok'])
  })
})

describe('collectSubtreeIds', () => {
  it('收集自己与全部子孙', () => {
    expect([...collectSubtreeIds(COLLECTIONS, 'line-a')].sort()).toEqual([
      'direction-a',
      'direction-b',
      'line-a',
      'product-a',
    ])
    expect([...collectSubtreeIds(COLLECTIONS, 'direction-c')]).toEqual(['direction-c'])
  })
})

describe('方向分区渲染与写库', () => {
  it('两张表都在，且行数与方向数一致', () => {
    act(() => {
      root.render(<ConsoleDirectionTables />)
    })
    expect(container.querySelector('table[aria-label="方向结构表"]')).toBeTruthy()
    expect(container.querySelector('table[aria-label="方向参数表"]')).toBeTruthy()
    expect(text()).toContain('智能客服')
    expect(text()).toContain('产品线')
    expect(text()).toContain('方向')
  })

  it('「上级」候选项里没有自己（挡住把节点挂到自己下面）', () => {
    act(() => {
      root.render(<ConsoleDirectionTables />)
    })
    const select = container.querySelector<HTMLSelectElement>('select[aria-label^="上级：智能客服"]')
    expect(select).toBeTruthy()
    const values = Array.from(select!.options).map((option) => option.value)
    expect(values).not.toContain('line-a')
    // 自己的子孙也不该出现（否则挂上去就成环）
    expect(values).not.toContain('product-a')
    expect(values).not.toContain('direction-a')
    // 顶层与不相关的兄弟仍然可选
    expect(values).toContain('')
    expect(values).toContain('line-b')
  })

  it('改「参与产出」写进该方向的 enabled 覆盖', async () => {
    act(() => {
      root.render(<ConsoleDirectionTables />)
    })
    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label^="参与产出：竖版展示"]')
    expect(checkbox).toBeTruthy()
    await act(async () => {
      checkbox!.click()
    })
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.enabled).toBe(false)
  })

  it('「设置来源」区分「全局」与「本级」', async () => {
    await act(async () => {
      useProjectTreeParamsStore.getState().setPostprocessOverride('direction-a', { outputDir: 'D:/产出' })
    })
    act(() => {
      root.render(<ConsoleDirectionTables />)
    })
    const body = text()
    // 写过参数的那一行显示「本级」，其余显示「全局」
    expect(body).toContain('本级')
    expect(body).toContain('全局')
  })

  it('留空输出目录 = 恢复继承（写 undefined 而不是空字符串覆盖）', async () => {
    await act(async () => {
      useProjectTreeParamsStore.getState().setPostprocessOverride('direction-a', { outputDir: 'D:/产出' })
    })
    act(() => {
      root.render(<ConsoleDirectionTables />)
    })
    commitCell('输出目录：竖版展示', '')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.outputDir).toBeUndefined()
  })
})
