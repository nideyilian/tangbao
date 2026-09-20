/**
 * 外面（配方卡面板）的形态测试。
 *
 * 锁的是 2026-09-20 杰哥定的那条：**外面只显示原文内容，不做任何改动**，
 * 骨架 / 维度池 / 预览 / 词表全部在「配方卡详情」弹窗里。
 *
 * 为什么值得单独立测试：这类「搬家」最容易只搬一半 —— 外面留个残留的
 * 「加维度」按钮或提示行，看着没坏、实际是两处入口。断言写死「外面不许出现这些文案」，
 * 以后谁再想往外面加一块，测试会先问一句。
 *
 * 用 react-test-renderer（面板本身不是 portal，不需要 jsdom）。
 */

import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import SopCampaignRecipePanel from './SopCampaignRecipePanel'

/** 递归收集 props.children 里的全部文本 */
function collectText(children: unknown): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(collectText).join('')
  if (children && typeof children === 'object' && 'props' in (children as Record<string, unknown>)) {
    return collectText((children as { props: { children?: unknown } }).props.children)
  }
  return ''
}

/** 整棵渲染树的可读文本（`root` 是组件实例、没有 children，得从 toTree 拿） */
function panelText(renderer: ReturnType<typeof create>) {
  return collectText(renderer.toTree()?.rendered)
}

function renderPanel() {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<SopCampaignRecipePanel config={{ body: '', dimensions: [] }} onChange={() => {}} />)
  })
  return renderer
}

describe('SopCampaignRecipePanel · 外面只留原文', () => {
  it('整块面板只有一个输入区：配方卡原文', () => {
    const renderer = renderPanel()
    // 弹窗没打开时，外面不该有第二个多行输入
    expect(renderer.root.findAllByType('textarea')).toHaveLength(1)
    expect(panelText(renderer)).toContain('配方卡原文')
  })

  it('骨架 / 维度池 / 预览 / 词表都不在外面出现', () => {
    const renderer = renderPanel()
    const text = panelText(renderer)
    for (const moved of ['提示词骨架', '维度池', '加维度', '加候选值', '按骨架补齐', '合规红线词表', '取前']) {
      expect(text, `「${moved}」应已移入弹窗，不该出现在外面`).not.toContain(moved)
    }
  })

  it('带着配置的配方卡（没粘原文）也能进详情 —— 否则骨架/维度就没入口了', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <SopCampaignRecipePanel
          config={{ body: '{{主体}}，高清实拍', dimensions: [{ name: '主体', options: ['帆布包'] }] }}
          onChange={() => {}}
        />,
      )
    })
    const entry = renderer.root
      .findAll((node) => node.type === 'button')
      .find((node) => collectText(node.props.children).includes('查看解析结果'))!
    expect(entry.props.disabled).toBe(false)
  })

  it('入口按钮在既没解析、也没配置时禁用，并在解析成功后解禁', () => {
    const renderer = renderPanel()
    const findEntry = () =>
      renderer.root
        .findAll((node) => node.type === 'button')
        .find((node) => collectText(node.props.children).includes('查看解析结果'))!

    expect(findEntry().props.disabled).toBe(true)

    act(() => {
      ;(renderer.root.findAllByType('textarea')[0]!.props.onChange as (event: { target: { value: string } }) => void)({
        target: {
          value: JSON.stringify({
            name: '歌单推荐美女',
            template: '{M}, {S1}',
            master: [{ name: 'M', values: ['戴耳机侧颜特写'] }],
            pools: { S1: ['甜美元气'] },
          }),
        },
      })
    })
    const parseButton = renderer.root
      .findAll((node) => node.type === 'button')
      .find((node) => collectText(node.props.children).trim() === '解析')!
    act(() => {
      ;(parseButton.props.onClick as () => void)()
    })

    expect(findEntry().props.disabled).toBe(false)
    // 成功反馈只报「完成」，不重复数字（数字在弹窗的维度池标题行里说一次）
    const text = panelText(renderer)
    expect(text).toContain('解析完成')
    expect(text).not.toContain('组合空间')
  })
})
