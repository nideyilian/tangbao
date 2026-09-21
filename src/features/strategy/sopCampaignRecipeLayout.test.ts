/**
 * 配方卡面板的**高度分配契约**（读 CSS 文本 + 断言声明）。
 *
 * 为什么用这种少见写法（与 `design-system/dialogSizing.test.ts` 同一理由）：
 * jsdom 没有排版引擎，量不出真实高度，而这条恰恰是**被报障的根因** ——
 * 面板上写着 `flex: 1 1 auto`（确实撑满了父容器），可 `.sop-recipe-panel__body`
 * 是个 grid 却**没写 `grid-template-rows`**：两条子块都落进隐式 auto 行，
 * 而 `align-content` 的初始值 `normal` 对 auto 轨道表现为 `stretch` ⇒
 * 剩余高度被**均分给两条 auto 行**，概览区（内容只有状态行 + 骨架）底下就挂着一大片空白
 * （2026-09-21 报障：「页面底部仍有这么大的空白」）。
 *
 * 契约（三条一起才成立，缺一条空白就会回来）：
 * 1. 面板撑满父容器的剩余高度（`flex: 1 1 auto`）；
 * 2. 面板内部：剩余高度**只**给录入区那一行（`minmax(0, 1fr)`），概览区按内容（`auto`）；
 * 3. 录入区内部：原文框吃掉它那一行的剩余高度。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** 取出某个选择器的声明块。选择器必须**连 ` {` 一起**匹配，否则 `.a` 会命中 `.a__b` */
function declarations(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `找不到规则：${selector}`).toBeGreaterThanOrEqual(0)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

describe('配方卡面板 · 高度分配契约（底部不留空白）', () => {
  it('面板撑满父容器的剩余高度', () => {
    expect(declarations('.sop-recipe-panel')).toMatch(/flex:\s*1 1 auto/)
  })

  it('面板内部：剩余高度只给录入区，概览区按内容高度（不做 stretch 均分）', () => {
    const body = declarations('.sop-recipe-panel__body')
    // 第一行（录入区）吃掉剩余高度，第二行（内容概览）保持内容高度
    expect(body).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/)
    // 反向：不许把两行都留成 auto（隐式行 + stretch = 空白被均分，就是被报障的形态）
    expect(body).not.toMatch(/grid-template-rows:\s*auto\s+auto/)
    // 面板自己滚动的能力要留着：窗口很矮时不能被面板的 overflow:hidden 裁掉操作栏
    expect(body).toMatch(/min-height:\s*0/)
  })

  it('录入区内部：原文框吃掉它那一行的剩余高度', () => {
    expect(declarations('.sop-recipe-import')).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/)
    // textarea 的高度必须由布局算（写了固定 height 就会与自适应打架）
    const field = declarations('.sop-recipe-import__field textarea')
    expect(field).toMatch(/height:\s*100%/)
    expect(field).toMatch(/min-height:/)
  })
})
