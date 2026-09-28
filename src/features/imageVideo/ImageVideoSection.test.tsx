/* @vitest-environment jsdom */

/**
 * 中控台「视频」分区参数表：**全局行改得动、每格读得回**。
 *
 * 2026-09-28 修的那条 bug 值得单独钉住 —— 它不是「少写一个 handler」那类一眼可见的漏，
 * 而是**读的键和写的键不是同一个**：
 *
 * | | 走哪条路 |
 * | --- | --- |
 * | 写 | 全局行的下拉 → `setGlobals` → `useImageVideoStore.globals` |
 * | 读 | 每列 `getValue` → `row.override` |
 *
 * 而全局行的 `override` 当时被写死成空对象 → 值确实写进库了，但没有任何一格去读它，
 * 于是**改完立刻弹回「跟随上级」**，看起来像「这个模式改不了」。
 *
 * 同一轮还漏了第二件：所有编辑列都没写 `getValue`，组件按 `key` 从行对象上取 ——
 * 而这一行是包装对象（只有 `override` / `effective` / `inherited`），根本没有那些键，
 * 于是**每一格都取到 `undefined`**，用户填的数写完就看不见（只剩占位文字）。
 *
 * 所以本文件的断言口径不是「渲染出来了」，而是**写得进、读得回、切得动**。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetCollection } from '../../types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { GLOBAL_NODE_ID } from '../postprocess/paramSchema'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { ImageVideoSection } from './ImageVideoSection'
import { useImageVideoStore } from './store'
import { DEFAULT_IMAGE_VIDEO_PARAMS } from './types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '智能客服', null, 0),
  collection('product-a', '机器人', 'line-a', 0),
  collection('direction-a', '竖版展示', 'product-a', 0),
]

const DIRECTION_LABEL = '智能客服 / 机器人 / 竖版展示'
const GLOBAL_LABEL = '全局（所有方向）'

let container: HTMLDivElement
let root: Root

/** 单元格的无障碍名称形如「列名：行名」（见 `data-grid.tsx` 的 `getRowLabel`）。 */
function selectFor(cellLabel: string): HTMLSelectElement {
  const node = container.querySelector<HTMLSelectElement>(`select[aria-label="${cellLabel}"]`)
  if (!node) throw new Error(`未找到下拉：${cellLabel}`)
  return node
}

function inputFor(cellLabel: string): HTMLInputElement {
  const node = container.querySelector<HTMLInputElement>(`input[aria-label="${cellLabel}"]`)
  if (!node) throw new Error(`未找到输入框：${cellLabel}`)
  return node
}

/** 受控 select 的写入要过原生 setter + `change` 事件，否则 React 认不出值变了。 */
function changeSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  act(() => {
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/**
 * 写表格单元格并**提交**。
 *
 * `DataGrid` 的单元格是草稿态（输入期间只改本地 draft，失焦或回车才提交），
 * 所以写完必须 blur —— 而且要**先 focus**（jsdom 里未聚焦的元素 `blur()` 不派发事件）。
 */
function commitGridCell(cellLabel: string, value: string) {
  const input = inputFor(cellLabel)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => input.focus())
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.blur())
}

function render() {
  act(() => {
    root.render(<ImageVideoSection scope={GLOBAL_NODE_ID} />)
  })
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  useAssetLibraryStore.setState({ collections: COLLECTIONS })
  useProjectTreeParamsStore.setState({ params: {} })
  useImageVideoStore.setState({ globals: { ...DEFAULT_IMAGE_VIDEO_PARAMS } })
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
  vi.unstubAllGlobals()
})

describe('中控台 · 图转视频参数表', () => {
  it('⭐ 全局行：改「出视频」写得进，也回显得出来', () => {
    render()

    // 默认是不出。**这一条本身就是回归哨兵** —— 修之前这里恒为「跟随上级」（空值），
    // 因为读的是那个写死的空对象。
    const select = selectFor(`出视频：${GLOBAL_LABEL}`)
    expect(select.value).toBe('off')

    changeSelect(select, 'on')
    expect(useImageVideoStore.getState().globals.enabled).toBe(true)
    // 回显：写进去的值必须被读回来。修之前这一步会弹回 ''
    expect(selectFor(`出视频：${GLOBAL_LABEL}`).value).toBe('on')

    // 改回「不出」也要停得住（单向生效不算修好）
    changeSelect(selectFor(`出视频：${GLOBAL_LABEL}`), 'off')
    expect(useImageVideoStore.getState().globals.enabled).toBe(false)
    expect(selectFor(`出视频：${GLOBAL_LABEL}`).value).toBe('off')
  })

  it('⭐ 全局行不给「跟随上级」这一档 —— 它上面没有东西可跟随', () => {
    render()

    const values = Array.from(selectFor(`出视频：${GLOBAL_LABEL}`).options).map((option) => option.value)
    expect(values).toEqual(['on', 'off'])

    // 同理适用于另外两个三态列与所有枚举列：全局行只该出现「真实的值」
    const transition = Array.from(selectFor(`转场：${GLOBAL_LABEL}`).options).map((option) => option.value)
    expect(transition).not.toContain('')
  })

  it('⭐ 方向行：枚举列能选回「跟随上级」，且那一档直接写出会生效成什么', () => {
    render()

    const select = selectFor(`转场：${DIRECTION_LABEL}`)
    const first = select.options[0]!
    // 空串 = 数据层的「没表态」；提交它才真的恢复继承（以前这一档根本不存在，改不回去）
    expect(first.value).toBe('')
    // 下拉没有 placeholder，继承到什么必须写在档位名里 —— 否则用户只能靠猜
    expect(first.textContent).toBe('跟随：淡入淡出')
    expect(select.value).toBe('')

    // 选个具体的转场 → 写进节点覆盖 → 回显
    changeSelect(select, '百叶窗')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.imageVideo?.transitionType).toBe('百叶窗')
    expect(selectFor(`转场：${DIRECTION_LABEL}`).value).toBe('百叶窗')

    // 再选回「跟随上级」→ 覆盖被摘掉，继续继承
    changeSelect(selectFor(`转场：${DIRECTION_LABEL}`), '')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.imageVideo?.transitionType).toBeUndefined()
    expect(selectFor(`转场：${DIRECTION_LABEL}`).value).toBe('')
  })

  it('⭐ 方向行：数字列填了值要显示得出来，没填则念出继承值', () => {
    render()

    const label = `图片数/视频：${DIRECTION_LABEL}`
    // 没表过态 → 空的，靠占位文字说明会跟随成什么
    expect(inputFor(label).value).toBe('')
    expect(inputFor(label).placeholder).toBe('跟随：6')

    commitGridCell(label, '12')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.imageVideo?.imagesPerVideo).toBe(12)
    // **修之前这里恒为空**：每列都没写 getValue，组件按 key 从包装对象上取，取到的永远是 undefined
    expect(inputFor(label).value).toBe('12')
  })

  it('全局行改了基线，方向行的「跟随」提示跟着变（继承链是活的）', () => {
    render()

    expect(inputFor(`图片数/视频：${DIRECTION_LABEL}`).placeholder).toBe('跟随：6')
    changeSelect(selectFor(`出视频：${GLOBAL_LABEL}`), 'on')
    commitGridCell(`图片数/视频：${GLOBAL_LABEL}`, '9')
    // 方向行自己没表态 → 占位文字要念出新基线，用户才核对得出上层改动的影响
    expect(inputFor(`图片数/视频：${DIRECTION_LABEL}`).placeholder).toBe('跟随：9')
  })
})
