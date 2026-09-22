/* @vitest-environment jsdom */

/**
 * 「产出目标」弹窗的入口守卫。
 *
 * 守的是**能改得动、写得进 store**，不是「组件渲染出来了」—— 控件渲染出来但没接 onChange，
 * 渲染断言照样全绿（这条口径见 `docs/tangbao-ops-runbook.md` §20 与 negative-verification 纪律）。
 *
 * 弹窗挂在 Dialog 上（portal 到 body），所以断言走 `document.body`。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../../storePostprocessMedia'
import type { AssetCollection } from '../../types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import PostprocessTargetsDialog from './PostprocessTargetsDialog'

// React 19 要求显式声明 act 环境，否则每个 act 都打一条告警（同 PostprocessRunsDialog.test.tsx）
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function collection(id: string, name: string, parentId: string | null, order: number): AssetCollection {
  return { id, name, normalizedName: name.toLowerCase(), parentId, order, createdAt: 1, updatedAt: 1, pinned: false }
}

const LINE = collection('line-1', '医疗线', null, 0)
const PRODUCT = collection('product-1', '百万医疗险', LINE.id, 0)
const DIRECTION_A = collection('direction-a', '月亮', PRODUCT.id, 0)
const DIRECTION_B = collection('direction-b', '图标', PRODUCT.id, 1)
/** 没在启用范围内的方向：列出来只会变成「勾了却不产出」的陷阱，所以要断言它**不出现**。 */
const DIRECTION_C = collection('direction-c', '网赚', PRODUCT.id, 2)

let container: HTMLDivElement
let root: Root

function checkboxInputs(): HTMLInputElement[] {
  return [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)
}

function render(onClose: () => void = () => {}) {
  act(() => {
    root = createRoot(container)
    root.render(<PostprocessTargetsDialog onClose={onClose} />)
  })
}

beforeEach(() => {
  useAssetLibraryStore.setState({ collections: [LINE, PRODUCT, DIRECTION_A, DIRECTION_B, DIRECTION_C] })
  usePostprocessMediaStore.setState({
    ...createDefaultPostprocessMediaConfig(),
    // 零渠道零产出：这几条只关心「选了哪些方向、有没有写进 store」
    selectedMediaIds: [],
    // 只启用 A、B
    selectedCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
    savedTargetCollectionIds: [],
  })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

describe('PostprocessTargetsDialog', () => {
  it('只列启用范围内的可产出方向（没启用的不出现）', () => {
    render()

    const text = document.body.textContent ?? ''
    expect(text).toContain('医疗线 / 百万医疗险 / 月亮')
    expect(text).toContain('医疗线 / 百万医疗险 / 图标')
    expect(text).not.toContain('网赚')
  })

  it('⭐ 勾选后点「记住配置」→ 写进 store（入口真的改得动）', () => {
    let closed = 0
    render(() => {
      closed += 1
    })

    const boxes = checkboxInputs()
    expect(boxes).toHaveLength(2)
    act(() => boxes[1]!.click())
    act(() => document.body.querySelector<HTMLButtonElement>('[data-testid="postprocess-targets-save"]')!.click())

    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([DIRECTION_B.id])
    expect(closed).toBe(1)
  })

  it('已记住时带入勾选，且「恢复按归属」能把目标清空', () => {
    usePostprocessMediaStore.setState({ savedTargetCollectionIds: [DIRECTION_A.id] })
    render()

    expect(checkboxInputs()[0]?.checked).toBe(true)
    act(() => document.body.querySelector<HTMLButtonElement>('[data-testid="postprocess-targets-reset"]')!.click())
    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([])
  })

  it('勾了但点「取消」→ 一个字节都不写盘（草稿语义）', () => {
    let closed = 0
    render(() => {
      closed += 1
    })

    act(() => checkboxInputs()[0]!.click())
    act(() => buttonByText('取消')!.click())

    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([])
    expect(closed).toBe(1)
  })

  it('没有任何启用方向时给出空态，而不是一个空列表', () => {
    usePostprocessMediaStore.setState({ selectedCollectionIds: [] })
    render()

    expect(checkboxInputs()).toHaveLength(0)
    expect(document.body.textContent ?? '').toContain('还没有可选的方向')
  })
})
