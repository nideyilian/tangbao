/* @vitest-environment jsdom */

/**
 * 折叠状态持久化 hook 的测试。
 *
 * 钉四件事：**从存档恢复 / 变化即写回 / 存档坏掉退回全展开 / 失效 id 不落盘**。
 * 其中「失效 id 不落盘」是本轮新增的能力（原先两处私有实现都没有清理，
 * 删掉的节点 id 会在存档里无限累积）。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePersistedCollapsedIds } from './usePersistedCollapsedIds'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STORAGE_KEY = 'tangbao.test-collapsed-ids'

/** 宿主组件：把 hook 的返回值挂到模块变量上，测试直接读/改 */
let latest: { ids: Set<string>; set: ReturnType<typeof usePersistedCollapsedIds>[1] } | null = null

function Host({ validIds }: { validIds?: ReadonlySet<string> }) {
  const [ids, set] = usePersistedCollapsedIds(STORAGE_KEY, validIds)
  latest = { ids, set }
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  latest = null
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
})

function mount(validIds?: ReadonlySet<string>) {
  act(() => {
    root = createRoot(container)
    root.render(<Host validIds={validIds} />)
  })
}

/** 存档里现在写着什么 */
function stored(): string[] {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
}

describe('usePersistedCollapsedIds（折叠状态本地持久化）', () => {
  it('挂载时从存档恢复', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']))
    mount()
    expect([...latest!.ids].sort()).toEqual(['a', 'b'])
  })

  it('切换即写回（重进应用能还原）', () => {
    mount()
    act(() => latest!.set((current) => new Set(current).add('x')))
    expect(stored()).toEqual(['x'])
    act(() => latest!.set((current) => new Set([...current].filter((id) => id !== 'x'))))
    expect(stored()).toEqual([])
  })

  it('存档坏掉（不是 JSON / 不是数组 / 混进非字符串）一律降级成空集合，不抛错', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-json-at-all')
    mount()
    expect([...latest!.ids]).toEqual([])

    act(() => root.unmount())
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 1, null, { id: 'b' }, 'c']))
    mount()
    expect([...latest!.ids]).toEqual(['a', 'c'])
  })

  it('⭐ 失效 id 不落盘：删掉的节点不会在存档里无限累积', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['still-here', 'deleted-long-ago']))
    mount(new Set(['still-here']))
    // 挂载后的第一次写回就把它清掉了，不需要等用户再折叠一次
    expect(stored()).toEqual(['still-here'])
  })

  it('不传 validIds 时不过滤（保持通用）', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['whatever']))
    mount()
    expect(stored()).toEqual(['whatever'])
  })
})
