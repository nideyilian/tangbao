/* @vitest-environment jsdom */

/**
 * 配方卡面板的「定位跳转」测试（TB-153）。
 *
 * 杰哥报的原话是「提示无法点击跳转到对应的出问题位置」—— 所以这个文件只测一件事：
 * **点下去到底有没有真的跳到地方**。而落点分三层，路由完全不同，三层都要锁：
 *
 * 1. 落点在**详情弹窗**里（骨架 / 维度 / 候选值 / 词表）⇒ 先把弹窗打开、等挂载完再滚；
 * 2. 落点在**本面板**里（原文框）⇒ 就地滚，不该弹窗；
 * 3. 落点在**面板外面**（SOP 名称 / 说明，在管理中心左侧字段区）⇒ 关掉弹窗、交回中心。
 *
 * 用 jsdom + createRoot 而不是 react-test-renderer：定位要真的查 DOM、要真的给元素加高亮类，
 * 这些在 test-renderer 的假树里根本不存在（`ref` 是 null，跳转一定「失败」却看不出来）。
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SopCampaignRecipePanel from './SopCampaignRecipePanel'
import { __resetOverlayManager } from '../../design-system/overlayManager'
import type { SopCampaignRecipeConfig } from './types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  __resetOverlayManager()
})

function renderPanel(config: SopCampaignRecipeConfig, onLocateOutside?: (field: string) => void) {
  function Harness() {
    const [current, setCurrent] = useState(config)
    return <SopCampaignRecipePanel config={current} onChange={setCurrent} onLocateOutside={onLocateOutside} />
  }
  act(() => {
    root.render(<Harness />)
  })
}

/** 面板外面铺出来的那条问题里的按钮（按落点 id 精确定位，不靠文案猜）。 */
function buttonInProblem(problemId: string, label: string): HTMLButtonElement {
  const row = document.body.querySelector(`[data-recipe-problem-id="${problemId}"]`)
  if (!row) throw new Error(`外面没有这条问题：${problemId}`)
  const button = Array.from(row.querySelectorAll('button')).find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`这条问题里没有「${label}」按钮`)
  return button as HTMLButtonElement
}

/** 推进一帧：弹窗挂载后由它自己消费定位请求（走 rAF / 定时器）。 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 24))
  })
}

const MISSING_OPTION_CONFIG: SopCampaignRecipeConfig = {
  body: '{M}, {S1}',
  dimensions: [
    { name: 'M', options: ['甲'] },
    { name: 'S1', options: [] },
  ],
}

describe('SopCampaignRecipePanel · 定位跳转（TB-153）', () => {
  it('落点在弹窗里：先打开详情弹窗，再滚到那个维度并高亮', async () => {
    renderPanel(MISSING_OPTION_CONFIG)
    // 弹窗还没开
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    act(() => buttonInProblem('structure-dimension-empty-1', '定位').click())
    await settle()

    // 弹窗被打开了（跨层级跳转的第一步）
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    // 并且目标元素真的被高亮了（scrollIntoView 在 jsdom 里没有，特性检测跳过，但高亮是真的）
    const target = document.body.querySelector('[data-recipe-target="dim:1"]')
    expect(target).not.toBeNull()
    expect(target!.className).toContain('sop-recipe-target--flash')
  })

  it('落点在面板里（原文框）：就地高亮，不该弹出详情弹窗', async () => {
    renderPanel(MISSING_OPTION_CONFIG)
    // 把「原文已改动」这条问题造出来：录入原文 → 解析 → 再改原文
    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!
    const setValue = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      act(() => {
        setter.call(textarea, value)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    setValue('{"template":"{M}","master":[{"name":"M","values":["甲"]}]}')
    const parseButton = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('解析'),
    )!
    act(() => parseButton.click())
    await settle()
    setValue('{"template":"{M}","master":[{"name":"M","values":["甲","乙"]}]}')
    await settle()

    act(() => buttonInProblem('raw-changed', '定位').click())
    await settle()

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(textarea.className).toContain('sop-recipe-target--flash')
  })

  it('落点在面板外面（名称）：交回管理中心，且不弹详情弹窗', async () => {
    const located: string[] = []
    renderPanel(MISSING_OPTION_CONFIG, (field) => located.push(field))

    // 造一条落点在「名称」的问题：原文里没有 name ⇒ 解析器会报「未识别到配方名称」
    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea, '{"template":"{M}","master":[{"name":"M","values":["甲"]}]}')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const parseButton = Array.from(document.body.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('解析'),
    )!
    act(() => parseButton.click())
    await settle()

    act(() => buttonInProblem('parse-name-missing', '定位').click())
    await settle()

    expect(located).toEqual(['name'])
    // 落点不在弹窗里 ⇒ 不该为了定位把弹窗拉起来（那是「跳错地方还盖住界面」）
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('高亮会自己消失（不是永久选中态）', async () => {
    vi.useFakeTimers()
    try {
      renderPanel(MISSING_OPTION_CONFIG)
      const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      act(() => {
        setter.call(textarea, '{"template":"{M}","master":[{"name":"M","values":["甲"]}]}')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
      act(() => {
        Array.from(document.body.querySelectorAll('button'))
          .find((item) => item.textContent?.includes('解析'))!
          .click()
      })
      act(() => {
        vi.advanceTimersByTime(50)
      })
      setter.call(textarea, '{"template":"{M}","master":[{"name":"M","values":["甲","乙"]}]}')
      act(() => {
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })

      act(() => buttonInProblem('raw-changed', '定位').click())
      expect(textarea.className).toContain('sop-recipe-target--flash')
      act(() => {
        vi.advanceTimersByTime(1300)
      })
      expect(textarea.className).not.toContain('sop-recipe-target--flash')
    } finally {
      vi.useRealTimers()
    }
  })
})
