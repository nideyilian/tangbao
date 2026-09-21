/* @vitest-environment jsdom */

import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDismissableLayer } from './useDismissableLayer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 下拉浮层的统一关闭行为：点面板外关闭 + Esc 关闭。
 * 两个必须排除的"假外部"：面板自身、触发按钮（否则点按钮会闪一下重开）。
 */
function Harness() {
  const [open, setOpen] = useState(true)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useDismissableLayer({ enabled: open, onDismiss: () => setOpen(false), ref: panelRef, anchorRef })
  return (
    <div>
      <button ref={anchorRef} type="button" data-test-anchor>
        触发
      </button>
      {open ? (
        <div ref={panelRef} data-test-panel>
          <span data-test-inside>面板内容</span>
        </div>
      ) : (
        <span data-test-closed />
      )}
    </div>
  )
}

function firePointerDown(target: EventTarget) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
}

function isOpen() {
  return document.body.querySelector('[data-test-panel]') !== null
}

let container: HTMLDivElement
let outside: HTMLDivElement
let root: Root

beforeEach(() => {
  outside = document.createElement('div')
  outside.setAttribute('data-test-outside', '')
  document.body.appendChild(outside)

  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
    root.render(<Harness />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  outside.remove()
})

describe('useDismissableLayer', () => {
  it('keeps the panel open when the pointer lands inside it', () => {
    act(() => {
      firePointerDown(document.body.querySelector('[data-test-inside]')!)
    })
    expect(isOpen()).toBe(true)
  })

  it('keeps the panel open when the pointer lands on the trigger button', () => {
    act(() => {
      firePointerDown(document.body.querySelector('[data-test-anchor]')!)
    })
    expect(isOpen()).toBe(true)
  })

  it('dismisses on a pointerdown outside the panel and the trigger', () => {
    act(() => {
      firePointerDown(outside)
    })
    expect(isOpen()).toBe(false)
  })

  it('dismisses on Escape', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(isOpen()).toBe(false)
  })
})
