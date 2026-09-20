/* @vitest-environment jsdom */

/**
 * 「配方卡详情」弹窗测试。
 *
 * 弹窗走 portal（`document.body`），所以用 jsdom + createRoot 而不是 react-test-renderer
 * —— 与 `design-system/overlays.test.tsx` 同一套脚手架。
 *
 * 锁四件事：
 * 1. 摘要口径（组合空间遇空维度归零，不是「乘出来还是 1」）+ 留意条数；
 * 2. 展示内容：原资产信息 / 维度池候选值 / 缺失池 / 告警 —— 这些字段**别处看不到**；
 * 3. **编辑能力**：骨架、维度增删、候选值改动都直接写回 config（它是编辑器，不是只读详情）；
 * 4. 关闭交互四处都通（底部按钮 / 右上 X / Esc / 点遮罩）+ 没解析过时不炸。
 *
 * 另加一条形态断言：**数字只说一次** —— 上一版外面的成功提示与这里都报维度数/组合空间，
 * 被杰哥判为重复；现在只允许维度池标题行说。
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SopCampaignRecipeParseResultDialog, {
  countParsedRecipeAttention,
  summarizeParsedRecipe,
} from './SopCampaignRecipeParseResultDialog'
import { __resetOverlayManager } from '../../design-system/overlayManager'
import type { ParsedCampaignRecipe } from './campaignRecipeImport'
import type { SopCampaignRecipeConfig } from './types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeParsed(overrides: Partial<ParsedCampaignRecipe> = {}): ParsedCampaignRecipe {
  return {
    name: '歌单推荐美女',
    desc: '歌单场景的通用配方',
    body: '{M}, {S1}, {S2}',
    dimensions: [
      {
        name: 'M',
        options: ['戴耳机侧颜特写', '背影浅笑'],
        englishByOption: { 戴耳机侧颜特写: 'close-up side profile' },
      },
      { name: 'S1', options: ['甜美元气', '温柔治愈'] },
      // 这个维度只有空串：不该被算进候选值，但会让组合空间归零（引擎也会拒绝生成）
      { name: 'S2', options: ['  '] },
    ],
    missingPools: ['S3'],
    dominantSlots: ['M'],
    meta: { model: 'gpt-image-1', forbidden: ['敏感词A', '敏感词B'], headlineSlot: 'S1' },
    ok: true,
    error: '',
    warnings: ['字段「desc」未识别，请手动补充'],
    source: 'json',
    ...overrides,
  }
}

function makeConfig(overrides: Partial<SopCampaignRecipeConfig> = {}): SopCampaignRecipeConfig {
  return {
    body: '{M}, {S1}',
    dimensions: [
      { name: 'M', options: ['戴耳机侧颜特写'] },
      { name: 'S1', options: ['甜美元气'] },
    ],
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
/** 最近一次写回的 config（onChange 的结果），断言编辑是否落到配置上 */
let latestConfig: SopCampaignRecipeConfig | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  latestConfig = null
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  __resetOverlayManager()
})

/** 渲染弹窗：内部持有 config 状态，让编辑像真实使用一样「改了就更新」 */
function renderDialog(options: {
  parsed: ParsedCampaignRecipe | null
  config?: SopCampaignRecipeConfig
  onOpenChange?: (open: boolean) => void
}) {
  function Harness() {
    const [config, setConfig] = useState(options.config ?? makeConfig())
    return (
      <SopCampaignRecipeParseResultDialog
        open
        onOpenChange={options.onOpenChange ?? (() => {})}
        parsed={options.parsed}
        config={config}
        onChange={(next) => {
          latestConfig = next
          setConfig(next)
        }}
      />
    )
  }
  act(() => {
    root.render(<Harness />)
  })
}

function dialogText() {
  return document.body.textContent ?? ''
}

function clickButton(label: string) {
  const needle = label.replace(/\s+/g, '')
  const button = Array.from(document.body.querySelectorAll('button')).find((item) =>
    item.textContent?.replace(/\s+/g, '').includes(needle),
  )
  if (!button) throw new Error(`找不到按钮：${label}`)
  act(() => {
    button.click()
  })
}

/** 往受控 input / textarea 写值：必须走原生 setter + input 事件，否则 React 不认 */
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('summarizeParsedRecipe', () => {
  it('候选值只数非空、组合空间遇空维度归零', () => {
    const summary = summarizeParsedRecipe(makeParsed().dimensions)
    // M 2 个 + S1 2 个 + S2 0 个（全是空白）= 4
    expect(summary.optionCount).toBe(4)
    // 2 × 2 × 0 = 0：空维度会让引擎拒绝生成，这里也必须显示 0，而不是「乘成 1」
    expect(summary.combinationCount).toBe(0)
    expect(summary.englishCount).toBe(1)
  })

  it('没有维度时组合空间是 0（不是 1）', () => {
    expect(summarizeParsedRecipe([]).combinationCount).toBe(0)
  })
})

describe('countParsedRecipeAttention', () => {
  it('告警 + 缺失池都算「要留意」（面板入口按钮上只报这个数，不铺内容）', () => {
    expect(countParsedRecipeAttention(makeParsed())).toBe(2) // 1 条 warning + 1 个 missingPool
    expect(countParsedRecipeAttention(makeParsed({ warnings: [], missingPools: [] }))).toBe(0)
    expect(countParsedRecipeAttention(null)).toBe(0)
  })
})

describe('SopCampaignRecipeParseResultDialog', () => {
  it('展示解析器读到、但别处看不到的内容', () => {
    renderDialog({ parsed: makeParsed() })
    const text = dialogText()

    expect(text).toContain('配方卡详情')
    expect(text).toContain('歌单推荐美女')
    expect(text).toContain('歌单场景的通用配方')
    expect(text).toContain('主控槽')
    // 缺失池 / 告警 / 元信息
    expect(text).toContain('S3')
    expect(text).toContain('字段「desc」未识别，请手动补充')
    expect(text).toContain('gpt-image-1')
    expect(text).toContain('敏感词A')
  })

  it('骨架与维度池都在弹窗里（外面已无编辑入口）', () => {
    renderDialog({ parsed: makeParsed() })
    expect(dialogText()).toContain('提示词骨架')
    expect(dialogText()).toContain('维度池')
    expect(document.body.querySelector('[role="dialog"] textarea')).toBeTruthy()
    // 维度名与候选值都渲染成可编辑输入
    expect(document.body.querySelector('input[aria-label="维度 1 名称"]')).toBeTruthy()
    expect(document.body.querySelector('input[aria-label="维度 M 候选值 1"]')).toBeTruthy()
  })

  it('数字只说一次：维度数 / 候选值数 / 组合空间只出现在维度池标题行', () => {
    renderDialog({ parsed: makeParsed() })
    const occurrences = dialogText().match(/组合空间/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('编辑：改骨架直接写回配置', () => {
    renderDialog({ parsed: makeParsed() })
    const textarea = document.body.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!
    typeInto(textarea, '{M} 新骨架')
    expect(latestConfig?.body).toBe('{M} 新骨架')
  })

  it('编辑：加维度会追加一个空维度写回配置', () => {
    const config = makeConfig()
    renderDialog({ parsed: makeParsed(), config })
    clickButton('加维度')
    expect(latestConfig?.dimensions).toHaveLength(config.dimensions.length + 1)
    expect(latestConfig?.dimensions.at(-1)).toEqual({ name: '', options: [''] })
  })

  it('编辑：骨架缺维度时可以「按骨架补齐」', () => {
    // 骨架用了 {M} 与 {S2}，但配置里只有 M ⇒ 应补出 S2
    const config = makeConfig({ body: '{M}, {S2}', dimensions: [{ name: 'M', options: ['x'] }] })
    renderDialog({ parsed: makeParsed(), config })
    clickButton('按骨架补齐')
    expect(latestConfig?.dimensions.map((item) => item.name)).toEqual(['M', 'S2'])
  })

  it('编辑：改候选值写回配置', () => {
    renderDialog({ parsed: makeParsed() })
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="维度 M 候选值 1"]')!
    typeInto(input, '新候选值')
    expect(latestConfig?.dimensions[0]?.options[0]).toBe('新候选值')
  })

  it('解析失败时展示失败原因，而不是空弹窗', () => {
    renderDialog({
      parsed: makeParsed({ ok: false, error: '原文既不是 JSON，也认不出「键: 值」结构', dimensions: [] }),
    })
    expect(dialogText()).toContain('解析失败')
    expect(dialogText()).toContain('原文既不是 JSON，也认不出「键: 值」结构')
  })

  it('没解析过但有已保存配置时，直接给可编辑内容（从库里打开的老配方卡）', () => {
    renderDialog({ parsed: null })
    const text = dialogText()
    // 没有解析结果 ⇒ 不该出现解析状态条
    expect(text).not.toContain('解析成功')
    expect(text).not.toContain('原资产信息')
    // 但骨架与维度要能看能改
    expect(text).toContain('维度池')
    expect(text).toContain('提示词骨架')
    expect(document.body.querySelector('input[aria-label="维度 M 候选值 1"]')).toBeTruthy()
  })

  it('既没解析过、配置也空时给空态提示，不抛错', () => {
    renderDialog({ parsed: null, config: { body: '', dimensions: [] } })
    expect(dialogText()).toContain('还没有内容')
  })

  it('候选值命中合规红线时标出来（不静默丢弃）', () => {
    renderDialog({
      parsed: makeParsed(),
      config: { body: '{M}', dimensions: [{ name: 'M', options: ['现金礼盒'] }] },
    })
    const text = dialogText()
    expect(text).toContain('红线')
    expect(text).toContain('现金')
  })

  it('关闭交互：底部「关闭」按钮', () => {
    const calls: boolean[] = []
    renderDialog({ parsed: makeParsed(), onOpenChange: (next) => calls.push(next) })
    clickButton('关闭')
    expect(calls).toEqual([false])
  })

  it('关闭交互：右上 X 按钮', () => {
    const calls: boolean[] = []
    renderDialog({ parsed: makeParsed(), onOpenChange: (next) => calls.push(next) })
    const x = document.body.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')!
    act(() => {
      x.click()
    })
    expect(calls).toEqual([false])
  })

  it('关闭交互：Esc', () => {
    const calls: boolean[] = []
    renderDialog({ parsed: makeParsed(), onOpenChange: (next) => calls.push(next) })
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(calls).toEqual([false])
  })

  it('关闭交互：点遮罩（点在 layer 本身上，不是弹窗内部）', () => {
    const calls: boolean[] = []
    renderDialog({ parsed: makeParsed(), onOpenChange: (next) => calls.push(next) })
    const layer = document.body.querySelector<HTMLDivElement>('.ds-dialog-layer')!
    act(() => {
      layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(calls).toEqual([false])
  })
})
