/**
 * SOP 管理中心弹窗尺寸契约：高度必须**随内容**，内容根的 flex-basis 必须是 `auto`。
 *
 * 用「读 CSS 文本 + 断言声明」这种少见写法：jsdom 没有排版引擎，量不出真实高度；
 * 但这两条恰恰是**被报障两次**的根因 ——
 * ① `.sop-center-dialog` 写死 `min(86vh, 860px)`：内容少的分组（单张配方卡、列表只几条）
 *    排不满，就在底部留一大片空白；
 * ② 高度改由内容决定之后，内容根若还是 `flex-basis: 0`，它会在固有尺寸计算里贡献 0，
 *    弹窗直接塌成「头部 + 标签栏」（TB-057 在后处理弹窗上踩过同一个坑）。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/**
 * 取出某选择器所在的那组声明。
 * 刻意**不**匹配 `${selector} {`：并列选择器（逗号分隔的组）里，首个选择器后面跟的是逗号。
 */
function declarations(selector: string): string {
  const start = css.indexOf(selector)
  expect(start, `找不到规则：${selector}`).toBeGreaterThanOrEqual(0)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

describe('SOP 管理中心弹窗尺寸契约', () => {
  it('默认尺寸：高度随内容，上限交给 max-height', () => {
    const block = declarations('.sop-center-dialog')
    expect(block).toMatch(/(?<![-\w])height:\s*auto/)
    // 前置边界是必须的：不加的话 `max-height: min(86vh, 860px)` 会被当成 `height:` 误判
    expect(block).not.toMatch(/(?<![-\w])height:\s*\d+(\.\d+)?d?vh/)
    expect(block).toMatch(/max-height:\s*min\(86vh, 860px\)/)
  })

  it('「生成一屏」变体同样随内容：只保留 max-height', () => {
    const block = declarations(".sop-center-dialog:has([data-generation-one-screen='true'])")
    expect(block).toMatch(/(?<![-\w])height:\s*auto/)
    expect(block).not.toMatch(/(?<![-\w])height:\s*min\(/)
    expect(block).toMatch(/max-height:\s*min\(92dvh, 860px\)/)
  })

  it('内容根 flex-basis 是 auto —— basis 0 会让弹窗塌成「头部 + 标签栏」', () => {
    const block = declarations('.sop-center-dialog .sop-center-library-grid')
    expect(block).toMatch(/flex:\s*1 1 auto/)
    expect(block).not.toMatch(/flex:\s*1 1 0/)
    // 行高必须可收缩，超出交给列内自己的滚动区（三个 tab 的网格都要在同一组里）
    expect(block).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\)/)
    expect(block).toContain('.sop-center-dialog .sop-center-meta-grid')
    expect(block).toContain('.sop-center-dialog .sop-center-generate-grid')
  })
})
