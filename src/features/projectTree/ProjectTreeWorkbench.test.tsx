/* @vitest-environment jsdom */

/**
 * 项目树工作台 —— 只覆盖一件事：**外部跳转进来时要定位到那一行**。
 *
 * 背景（杰哥 2026-09-20 报「顶部提示没有对应跳转」）：「后处理」弹窗里
 * 「这个方向不在启用范围内」的那条提示，光说一句没用 —— 用户得回素材库、点「项目树」、
 * 再在几十行里自己翻出那个方向。现在那个按钮会把节点 id 带过来（`projectTreeWorkbench.focusId`），
 * 工作台用它预填搜索。**只打开不定位仍然是「假跳」**，所以这条行为必须钉住。
 *
 * 表格结构与参数的语义由 `tableRows.test.ts` 覆盖，这里只管「落点」。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetOverlayManager } from '../../design-system/overlayManager'
import { useStore } from '../../store'
import type { AssetCollection } from '../../types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import ProjectTreeWorkbench from './ProjectTreeWorkbench'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useProjectTreeParamsStore } from './storeProjectTreeParams'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '智能客服', null, 0),
  collection('product-a', '机器人', 'line-a', 0),
  collection('direction-a', '竖版展示', 'product-a', 0),
  collection('direction-b', '横版展示', 'product-a', 1),
]

let container: HTMLDivElement
let root: Root

/** 表格里的搜索框（placeholder 是它唯一的稳定标识） */
function searchInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>('input[placeholder^="搜索名称或路径"]')
  if (!input) throw new Error('未找到搜索框')
  return input
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

function render() {
  act(() => {
    root.render(<ProjectTreeWorkbench onClose={() => {}} />)
  })
  return bodyText()
}

beforeEach(() => {
  __resetOverlayManager()
  useAssetLibraryStore.setState({ collections: COLLECTIONS, scope: 'all', selectedAssetIds: [] })
  useProjectTreeParamsStore.setState({ params: {} })
  usePostprocessMediaStore.setState({ selectedCollectionIds: [] })
  useStore.setState({ projectTreeWorkbench: { open: true, focusId: null } })
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('ProjectTreeWorkbench — 跳转落点', () => {
  it('不带焦点打开时不预填搜索，所有节点都在', () => {
    render()
    expect(searchInput().value).toBe('')
    expect(bodyText()).toContain('竖版展示')
    expect(bodyText()).toContain('横版展示')
  })

  it('⭐ 带焦点打开时预填该节点的名称，把目录树过滤到那一行', () => {
    // 模拟「后处理」弹窗点「去项目树启用」：带上目标节点
    useStore.setState({ projectTreeWorkbench: { open: true, focusId: 'direction-a' } })
    render()

    expect(searchInput().value).toBe('竖版展示')
    expect(bodyText()).toContain('竖版展示')
    // 无关的那个方向被过滤掉了 —— 这正是「定位」与「只是打开」的区别
    expect(bodyText()).not.toContain('横版展示')
  })
})
