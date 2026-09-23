/* @vitest-environment jsdom */

/**
 * 「产出目标」弹窗的入口守卫。
 *
 * 守的是**能改得动、写得进 store**，不是「组件渲染出来了」—— 控件渲染出来但没接 onChange，
 * 渲染断言照样全绿（这条口径见 `docs/tangbao-ops-runbook.md` §20 与 negative-verification 纪律）。
 *
 * 2026-09-22 起这个弹窗是**树**（跨产品线 / 跨产品可勾），且**不再只列启用范围内的方向**：
 * 启用范围管的是自动后处理，手动跑那一次由用户直接决定（杰哥：「我需要跨产品」）。
 * 于是这里守住两件容易悄悄回退的事：
 * ① 别的产品线下的方向**照样出现**（别又被人按启用范围过滤回去）；
 * ② 勾中间层 = 其下方向一起勾，但**落盘只有叶子**（命名段 `{direction}` 取路径末段）。
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
/** 同产品下但**没启用**的方向：仍然要出现（手动跑可以产到它），只是标一个「未启用」。 */
const DIRECTION_C = collection('direction-c', '网赚', PRODUCT.id, 2)

/** 另一条产品线：用来守「跨产品」—— 它在启用范围之外，但必须照样可选。 */
const LINE_B = collection('line-2', '工具线', null, 1)
const PRODUCT_B = collection('product-2', '清理大师', LINE_B.id, 0)
const DIRECTION_D = collection('direction-d', '清爽', PRODUCT_B.id, 0)

let container: HTMLDivElement
let root: Root

function checkboxInputs(): HTMLInputElement[] {
  return [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
}

/**
 * 按显示名找复选框。
 *
 * **不能按 `label.textContent` 全等匹配**：`Checkbox` 把勾/横线字符画在一个 `aria-hidden` 的
 * span 里，那个字符也算进文本（形如「✓月亮」），全等匹配会全军覆没。
 * 所以定位 `.ds-check__label` 这层，再回到它所属的 label 上取 input。
 */
function checkboxByLabel(label: string): HTMLInputElement {
  const text = [...document.body.querySelectorAll<HTMLElement>('.ds-check__label')].find(
    (node) => node.textContent?.trim() === label,
  )
  const input = text?.closest('label')?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error(`未找到「${label}」的复选框`)
  return input
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
  useAssetLibraryStore.setState({
    collections: [LINE, PRODUCT, DIRECTION_A, DIRECTION_B, DIRECTION_C, LINE_B, PRODUCT_B, DIRECTION_D],
  })
  usePostprocessMediaStore.setState({
    ...createDefaultPostprocessMediaConfig(),
    // 零渠道零产出：这几条只关心「选了哪些方向、有没有写进 store」
    selectedMediaIds: [],
    // 只启用医疗线下的 A、B —— 工具线整条都在范围外
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
  it('⭐ 整棵树都在 —— 所有产品线（工具线 / 清理大师 / 清爽）照样可选', () => {
    render()

    const text = document.body.textContent ?? ''
    // 层级名都在（是树，不是一长条平铺）
    expect(text).toContain('医疗线')
    expect(text).toContain('工具线')
    // 其它产品下的方向必须出现，否则「跨产品」是句空话
    expect(text).toContain('清爽')
    expect(checkboxByLabel('清爽').disabled).toBe(false)
    // 2026-09-23 起不再标「未启用」：那层「启用范围」白名单已撤，
    // 方向参不参与自动产出改由各自的方向级开关决定，跟这份手动目标清单没有关系。
    expect(text).not.toContain('未启用')
  })

  it('⭐ 勾中间层 = 其下方向一起勾，但落盘只有叶子', () => {
    render()

    act(() => checkboxByLabel('百万医疗险').click())

    // 三个方向都进草稿，产品节点自身不会作为一个「方向」被写进去
    expect(checkboxByLabel('月亮').checked).toBe(true)
    expect(checkboxByLabel('图标').checked).toBe(true)
    expect(checkboxByLabel('网赚').checked).toBe(true)

    act(() => document.body.querySelector<HTMLButtonElement>('[data-testid="postprocess-targets-save"]')!.click())

    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([
      DIRECTION_A.id,
      DIRECTION_B.id,
      DIRECTION_C.id,
    ])
  })

  it('⭐ 跨产品多选：两个产品线下的方向能一起记住', () => {
    render()

    act(() => checkboxByLabel('图标').click())
    act(() => checkboxByLabel('清爽').click())
    act(() => document.body.querySelector<HTMLButtonElement>('[data-testid="postprocess-targets-save"]')!.click())

    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([DIRECTION_B.id, DIRECTION_D.id])
  })

  it('已记住时带入勾选，且中间层显示部分选中（indeterminate）', () => {
    usePostprocessMediaStore.setState({ savedTargetCollectionIds: [DIRECTION_A.id] })
    render()

    expect(checkboxByLabel('月亮').checked).toBe(true)
    expect(checkboxByLabel('图标').checked).toBe(false)
    // 只挑了产品下 3 个方向中的 1 个 → 产品那层既不是全选也不是全空
    expect(checkboxByLabel('百万医疗险').checked).toBe(false)
    expect(checkboxByLabel('百万医疗险').indeterminate).toBe(true)
  })

  it('折叠父节点 → 子级不再渲染；展开又回来', () => {
    render()

    act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="收起「百万医疗险」"]')!.click())
    expect(checkboxInputs().some((input) => input.closest('label')?.textContent?.includes('月亮'))).toBe(false)

    act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="展开「百万医疗险」"]')!.click())
    expect(checkboxByLabel('月亮')).toBeTruthy()
  })

  it('已记住时「恢复按归属」能把目标清空', () => {
    usePostprocessMediaStore.setState({ savedTargetCollectionIds: [DIRECTION_A.id] })
    render()

    act(() => document.body.querySelector<HTMLButtonElement>('[data-testid="postprocess-targets-reset"]')!.click())
    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([])
  })

  it('勾了但点「取消」→ 一个字节都不写盘（草稿语义）', () => {
    let closed = 0
    render(() => {
      closed += 1
    })

    act(() => checkboxByLabel('月亮').click())
    act(() => buttonByText('取消')!.click())

    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([])
    expect(closed).toBe(1)
  })

  it('项目树里一个方向都没有时给出空态，而不是一个空列表', () => {
    useAssetLibraryStore.setState({ collections: [] })
    render()

    expect(checkboxInputs()).toHaveLength(0)
    expect(document.body.textContent ?? '').toContain('项目树里还没有方向')
  })
})
