/* @vitest-environment jsdom */

/**
 * 外面（配方卡面板）的形态测试。
 *
 * 锁两条相互制约的要求：
 * 1. **外面只显示原文内容，不做任何改动**（2026-09-20 杰哥定）：
 *    骨架编辑 / 维度池 / 预览 / 词表全部在「配方卡详情」弹窗里；
 * 2. 但外面**必须能看出「这个配方卡填了什么、解析到哪一步」**（同日追加）：
 *    从库里打开的配方卡不经过「粘贴原文」，只有录入框的话外面一片空白。
 *    ⇒ 新增只读「内容概览」：解析状态徽章 + 失败原因 + 骨架原文 + 维度规模。
 *
 * 所以断言分两侧：不许出现的（编辑器零件）+ 必须出现的（状态与内容）。
 *
 * ⚠️ 用 jsdom：解析走 `window.setTimeout`（先渲染一帧「解析中」再跑同步解析），
 * 需要真实 timer 才能推进。断言「解析中」时要在 flush 之前看。
 */

import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import SopCampaignRecipePanel from './SopCampaignRecipePanel'
import type { SopCampaignRecipeConfig } from './types'

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

/**
 * 整棵渲染树的可读文本。
 *
 * 用 TestInstance 的 `children` 递归，而不是走 `toTree().rendered`：
 * 后者在根是自定义组件（Harness）时，文本挂在 `rendered` 而不是 `props.children` 上，
 * 会静默收集到空串（这个坑踩过一次）。
 */
function panelText(renderer: ReturnType<typeof create>) {
  const parts: string[] = []
  const walk = (node: { children?: unknown }) => {
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) {
      if (typeof child === 'string') parts.push(child)
      else if (child && typeof child === 'object') walk(child as { children?: unknown })
    }
  }
  walk(renderer.root as unknown as { children?: unknown })
  return parts.join('')
}

/**
 * 渲染面板，并**把当前配置暴露出来**（TB-152 起需要）。
 *
 * 原文改存进 `config.rawText` 之后，「录进去的原文有没有落到配方卡上」这件事
 * **只能从 config 回读**：textarea 的 value 不是渲染树的 children，
 * 现有的 `panelText` 走 children 递归，读不到输入框里的文字。
 *
 * 同时**必须让 onChange 落到 state 上**：面板是受控组件，
 * 用空的 onChange 时 config 永远不变，会得出「解析完却没有内容」的假结论。
 */
function renderPanelWithState(initial: SopCampaignRecipeConfig) {
  let latest = initial
  function Harness() {
    const [config, setConfig] = useState(initial)
    return (
      <SopCampaignRecipePanel
        config={config}
        onChange={(next) => {
          latest = next
          setConfig(next)
        }}
      />
    )
  }
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<Harness />)
  })
  return { renderer, getConfig: () => latest }
}

function renderPanel(initial: SopCampaignRecipeConfig) {
  return renderPanelWithState(initial).renderer
}

/** 录入框里的当前文字（受控 textarea 的 value）。 */
function rawTextValue(renderer: ReturnType<typeof create>) {
  return renderer.root.findAllByType('textarea')[0]!.props.value as string
}

function findButton(renderer: ReturnType<typeof create>, label: string) {
  const button = renderer.root
    .findAll((node) => node.type === 'button')
    .find((node) => collectText(node.props.children).includes(label))
  if (!button) throw new Error(`找不到按钮：${label}`)
  return button
}

/** 录入原文（受控 textarea 的 onChange） */
function typeRawText(renderer: ReturnType<typeof create>, value: string) {
  act(() => {
    ;(renderer.root.findAllByType('textarea')[0]!.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value },
    })
  })
}

/** 推进「解析中」那一帧 + 同步解析 */
async function flushParse() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const RECIPE_JSON = JSON.stringify({
  name: '歌单推荐美女',
  template: '{M}, {S1}',
  master: [{ name: 'M', values: ['戴耳机侧颜特写'] }],
  pools: { S1: ['甜美元气'] },
})

const EMPTY_CONFIG: SopCampaignRecipeConfig = { body: '', dimensions: [] }
const FILLED_CONFIG: SopCampaignRecipeConfig = {
  body: '{{主体}}，{{背景}}，高清实拍',
  dimensions: [
    { name: '主体', options: ['帆布包', '运动鞋'] },
    { name: '背景', options: ['原木桌面', '城市街景'] },
  ],
}

describe('SopCampaignRecipePanel · 外面只留原文 + 能看出内容与状态', () => {
  it('整块面板只有一个输入区：配方卡原文', () => {
    const renderer = renderPanel(EMPTY_CONFIG)
    expect(renderer.root.findAllByType('textarea')).toHaveLength(1)
    expect(panelText(renderer)).toContain('配方卡原文')
  })

  it('骨架编辑器零件 / 维度池 / 预览 / 词表都不在外面出现', () => {
    const text = panelText(renderPanel(FILLED_CONFIG))
    for (const moved of ['提示词骨架', '维度池', '加维度', '加候选值', '按骨架补齐', '合规红线词表', '取前']) {
      expect(text, `「${moved}」应已移入弹窗，不该出现在外面`).not.toContain(moved)
    }
  })

  it('空配方卡：状态「待解析」+「尚未填写内容」', () => {
    const text = panelText(renderPanel(EMPTY_CONFIG))
    expect(text).toContain('待解析')
    expect(text).toContain('尚未填写内容')
    expect(text).toContain('这个配方卡还没有内容')
  })

  it('已保存内容的配方卡（从库里打开、本次没粘原文）：状态 + 骨架原文 + 规模都能看到', () => {
    const text = panelText(renderPanel(FILLED_CONFIG))
    // 「已保存内容」单列一态：既不是「待解析」（内容其实在），也不是「解析完成」（本次没解析）
    expect(text).toContain('已保存内容')
    expect(text).toContain('当前骨架（配方卡原文）')
    expect(text).toContain('{{主体}}，{{背景}}，高清实拍')
    expect(text).toContain('2 个维度 · 4 个候选值 · 组合空间 4 条')
  })

  it('点「解析」先出现「解析中…」，解析完成后变「解析完成」并显示新骨架', async () => {
    const renderer = renderPanel(EMPTY_CONFIG)
    typeRawText(renderer, RECIPE_JSON)
    act(() => {
      ;(findButton(renderer, '解析').props.onClick as () => void)()
    })

    // flush 之前：必须是「解析中…」—— 大原文解析会阻塞主线程，这一帧就是给用户的反馈
    expect(panelText(renderer)).toContain('解析中…')

    await flushParse()
    const text = panelText(renderer)
    expect(text).toContain('解析完成')
    // 解析出的骨架落到 config 上 ⇒ 概览区立刻能看到（这就是「不打开详情也能核对」）
    expect(text).toContain('{M}, {S1}')
    expect(text).toMatch(/\d+ 个维度 · \d+ 个候选值 · 组合空间 \d+ 条/)
  })

  it('有问题时外面不只报个数：直接摊出是哪一条、去哪儿改（TB-148 / TB-153）', async () => {
    const renderer = renderPanel(EMPTY_CONFIG)
    // 没写 name ⇒ 解析会给一条「未识别到配方名称」的问题（正好 1 条，便于断言）
    typeRawText(renderer, JSON.stringify({ template: '{M}', master: [{ name: 'M', values: ['甲', '乙'] }] }))
    act(() => {
      ;(findButton(renderer, '解析').props.onClick as () => void)()
    })
    await flushParse()

    const text = panelText(renderer)
    // 数字仍在（概览徽章 + 入口按钮都报这个数，同一个来源）
    expect(text).toContain('1 个问题')
    // 而外面直接写着**是哪一条、长在哪、怎么改** ——
    // 上一版外面只有一个数字、一个字内容都没有，看到「1 条待注意」无从下手
    expect(text).toContain('这份配方卡还没有名字')
    expect(text).toContain('位置：')
    expect(text).toContain('填一个就行')
  })

  it('解析失败：状态「解析失败」且原因就地可见', async () => {
    const renderer = renderPanel(EMPTY_CONFIG)
    typeRawText(renderer, '这不是配方卡，也不是 JSON')
    act(() => {
      ;(findButton(renderer, '解析').props.onClick as () => void)()
    })
    await flushParse()

    const text = panelText(renderer)
    expect(text).toContain('解析失败')
  })

  it('解析完又改原文：提示「原文已改动」', async () => {
    const renderer = renderPanel(EMPTY_CONFIG)
    typeRawText(renderer, RECIPE_JSON)
    act(() => {
      ;(findButton(renderer, '解析').props.onClick as () => void)()
    })
    await flushParse()
    expect(panelText(renderer)).not.toContain('原文已改动')

    typeRawText(renderer, `${RECIPE_JSON} `)
    expect(panelText(renderer)).toContain('原文已改动')
  })

  it('入口按钮：既没解析、也没配置时禁用，带着配置时可用', () => {
    const empty = renderPanel(EMPTY_CONFIG)
    expect(findButton(empty, '查看解析结果').props.disabled).toBe(true)

    const filled = renderPanel(FILLED_CONFIG)
    expect(findButton(filled, '查看解析结果').props.disabled).toBe(false)
  })
})

/**
 * 原文随手保存（TB-152）。
 *
 * 病根：原文原先只是面板的组件私有 state，不落库 ⇒ 关掉管理中心、或切一次 tab
 * （条件渲染，整块卸载）就没了，骨架却还在 —— 用户看到「0 字符」。
 *
 * 四条守卫，各钉住改法的一半：
 * 1. 录入 = 写回配方卡字段（不是内存）；
 * 2. 从库里打开时按字段回显；
 * 3. 「清空」连存下来的那份一起清；
 * 4. **解析时不能把原文冲掉** —— `toCampaignRecipeConfig` 内部走 `parseCampaignRecipeConfig`，
 *    那个函数只挑 body / dimensions，漏回填就是「刚粘完一点解析，原文立刻消失」。
 */
describe('SopCampaignRecipePanel · 配方卡原文随手保存（TB-152）', () => {
  it('录入的原文写回配方卡字段', () => {
    const { renderer, getConfig } = renderPanelWithState(EMPTY_CONFIG)
    typeRawText(renderer, RECIPE_JSON)
    expect(getConfig().rawText).toBe(RECIPE_JSON)
  })

  it('从库里打开的配方卡：原文按字段回显，字符数跟着它', () => {
    const { renderer } = renderPanelWithState({ ...FILLED_CONFIG, rawText: '原文留档' })
    expect(rawTextValue(renderer)).toBe('原文留档')
    expect(panelText(renderer)).toContain('4 字符')
  })

  it('「清空」连存下来的原文一起清（只清输入框等于没清）', () => {
    const { renderer, getConfig } = renderPanelWithState({ ...FILLED_CONFIG, rawText: '原文留档' })
    act(() => {
      ;(findButton(renderer, '清空').props.onClick as () => void)()
    })
    expect(getConfig().rawText).toBe('')
    expect(rawTextValue(renderer)).toBe('')
  })

  it('「解析」之后原文仍在配方卡里（解析只写骨架与维度）', async () => {
    const { renderer, getConfig } = renderPanelWithState(EMPTY_CONFIG)
    typeRawText(renderer, RECIPE_JSON)
    act(() => {
      ;(findButton(renderer, '解析').props.onClick as () => void)()
    })
    await flushParse()

    expect(panelText(renderer)).toContain('解析完成')
    expect(getConfig().rawText).toBe(RECIPE_JSON)
    // 骨架也照旧落到 config 上（别为了保住原文把正常流程改坏）
    expect(getConfig().body).toContain('{M}')
  })
})
