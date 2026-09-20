/**
 * 弹窗尺寸契约：后处理弹窗的高度必须**随内容自适应**。
 *
 * 为什么用「读 CSS 文本 + 断言声明」这种少见写法：jsdom 没有排版引擎，量不出真实高度；
 * 但这条恰恰是**被报障两次**的根因 —— `.ds-dialog--postprocess` 曾写死 `height: 80dvh`，
 * 参数少的作用域（全局默认 / 单个方向）排不满，就在底部留一大片空白。
 *
 * 规则一旦被改回固定高度、或内容区的 `flex-basis` 被改回 `0`，这里就会失败：
 * 后者在「高度由内容决定」之后会让内容区在固有尺寸计算里贡献 0，弹窗直接塌成「头 + 脚」。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** 取出某个选择器的声明块（选择器名不能互为前缀，这里两个选择器天然区分得开） */
function declarations(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `找不到规则：${selector}`).toBeGreaterThanOrEqual(0)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

describe('后处理弹窗尺寸契约', () => {
  it('弹窗高度随内容自适应，只保留上限（不再写死 80dvh）', () => {
    const block = declarations('.ds-dialog--postprocess')
    expect(block).toMatch(/(?<![-\w])height:\s*auto/)
    // 前置边界是必须的：不加的话 `max-height: 80dvh` 会被当成 `height:` 误判
    expect(block).not.toMatch(/(?<![-\w])height:\s*\d+(\.\d+)?d?vh/)
    // 上限仍在：内容超高时不会顶破视口，交给内容区自己滚
    expect(block).toMatch(/max-height:\s*80dvh/)
  })

  it('内容区 flex-basis 必须是 auto —— basis 0 会随自适应高度一起塌掉弹窗', () => {
    const block = declarations('.ds-dialog--postprocess .ds-dialog__content')
    expect(block).toMatch(/flex:\s*1 1 auto/)
    expect(block).not.toMatch(/flex:\s*1 1 0/)
  })
})
