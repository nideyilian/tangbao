/* @vitest-environment jsdom */

/**
 * 「输出位置」分区的装配契约（2026-09-21「分发」并入之后）。
 *
 * 这一区现在是**混合**的：渠道导出目录跟着作用域走，命名 / 分发 / 产出预览是全局一套。
 * 本文件只锁一件事 —— **合并之后分发的内容真的还在这**：
 * 它原先的独立 tab 已经删掉，入口只剩这一处，漏在这里等于功能直接消失（而不是「换个地方」）。
 *
 * 单独开一个文件而不是往 `ConsolePostprocessSections.test.tsx` 里加：那个文件同时被另一条
 * 写线改着（TB-066 表格化的未提交改动），往里面补断言会把两条线的改动搅在一起。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { OutputSection } from './OutputSection'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  usePostprocessMediaStore.setState(createDefaultPostprocessMediaConfig())
  useProjectTreeParamsStore.setState({ params: {} })
  useAssetLibraryStore.setState({ collections: [], scope: 'all' })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
})

function render(): string {
  act(() => {
    root = createRoot(container)
    root.render(<OutputSection scope={GLOBAL_NODE_ID} />)
  })
  return container.textContent ?? ''
}

describe('中控台 · 输出位置分区', () => {
  it('⭐ 分发并进来了：纯净版伴随与分发字段都渲染得出来', () => {
    const body = render()

    // 这两串分别来自「分发」小节的两张卡片 —— 它们原先只出现在独立的分发分区里
    expect(body).toContain('纯净版自动伴随')
    expect(body).toContain('启用分发')
  })

  it('⭐ 三个全局小节各有自己的标题，说清「不随作用域变」', () => {
    const body = render()

    // 这一区是混合的：渠道导出目录按作用域走，后三节是全局一套 ——
    // 标题里不写清，用户切了节点会以为连命名 / 分发也一起变了
    expect(body).toContain('文件命名')
    expect(body).toContain('分发')
    expect(body).toContain('全局一套')
  })
})
