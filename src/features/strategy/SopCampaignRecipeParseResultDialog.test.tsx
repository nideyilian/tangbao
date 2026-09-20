/* @vitest-environment jsdom */

/**
 * 「解析结果」弹窗测试。
 *
 * 弹窗走 portal（`document.body`），所以用 jsdom + createRoot 而不是 react-test-renderer
 * —— 与 `design-system/overlays.test.tsx` 同一套脚手架。
 *
 * 锁四件事：
 * 1. 摘要数字口径（组合空间遇空维度归零，不是「乘出来还是 1」）；
 * 2. 展示内容：原资产信息 / 维度池候选值 / 缺失池 / 告警 / 元信息 —— 这些字段**别处看不到**，
 *    正是这个弹窗存在的理由；
 * 3. 关闭交互四处都通（底部按钮 / 右上 X / Esc / 点遮罩）；
 * 4. 没解析过时不炸（空态）。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SopCampaignRecipeParseResultDialog, {
  countParsedRecipeAttention,
  summarizeParsedRecipe,
} from './SopCampaignRecipeParseResultDialog'
import { __resetOverlayManager } from '../../design-system/overlayManager'
import type { ParsedCampaignRecipe } from './campaignRecipeImport'

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

let container: HTMLDivElement
let root: Root

function renderHarness(props: { open: boolean; parsed: ParsedCampaignRecipe | null }) {
  const onOpenChange = () => {}
  act(() => {
    root.render(
      <SopCampaignRecipeParseResultDialog open={props.open} onOpenChange={onOpenChange} parsed={props.parsed} />,
    )
  })
}

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
  it('告警 + 缺失池都算「要留意」（入口按钮上只报这个数，不铺内容）', () => {
    expect(countParsedRecipeAttention(makeParsed())).toBe(2) // 1 条 warning + 1 个 missingPool
    expect(countParsedRecipeAttention(makeParsed({ warnings: [], missingPools: [] }))).toBe(0)
    expect(countParsedRecipeAttention(null)).toBe(0)
  })
})

describe('SopCampaignRecipeParseResultDialog', () => {
  it('打开时展示解析器读到的全部关键内容', () => {
    renderHarness({ open: true, parsed: makeParsed() })
    const text = document.body.textContent ?? ''

    expect(text).toContain('解析结果')
    expect(text).toContain('歌单推荐美女')
    expect(text).toContain('歌单场景的通用配方')
    expect(text).toContain('主控槽')
    expect(text).toContain('M')
    // 候选值全文（别处看不到）
    expect(text).toContain('戴耳机侧颜特写')
    expect(text).toContain('温柔治愈')
    // 缺失池 / 告警 / 元信息
    expect(text).toContain('S3')
    expect(text).toContain('字段「desc」未识别，请手动补充')
    expect(text).toContain('gpt-image-1')
    expect(text).toContain('敏感词A')
    // 摘要徽章
    expect(text).toContain('3 个维度')
    expect(text).toContain('4 个候选值')
  })

  it('解析失败时展示失败原因，而不是空弹窗', () => {
    renderHarness({
      open: true,
      parsed: makeParsed({ ok: false, error: '原文既不是 JSON，也认不出「键: 值」结构', dimensions: [] }),
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('解析失败')
    expect(text).toContain('原文既不是 JSON，也认不出「键: 值」结构')
  })

  it('没解析过时给空态提示，不抛错', () => {
    renderHarness({ open: true, parsed: null })
    expect(document.body.textContent ?? '').toContain('还没有解析结果')
  })

  it('关闭交互：底部「关闭」按钮', () => {
    const calls: boolean[] = []
    act(() => {
      root.render(
        <SopCampaignRecipeParseResultDialog open onOpenChange={(next) => calls.push(next)} parsed={makeParsed()} />,
      )
    })
    const closeButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('关闭'),
    )
    expect(closeButton).toBeTruthy()
    act(() => {
      closeButton!.click()
    })
    expect(calls).toEqual([false])
  })

  it('关闭交互：右上 X 按钮', () => {
    const calls: boolean[] = []
    act(() => {
      root.render(
        <SopCampaignRecipeParseResultDialog open onOpenChange={(next) => calls.push(next)} parsed={makeParsed()} />,
      )
    })
    const x = document.body.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')
    expect(x).toBeTruthy()
    act(() => {
      x!.click()
    })
    expect(calls).toEqual([false])
  })

  it('关闭交互：Esc', () => {
    const calls: boolean[] = []
    act(() => {
      root.render(
        <SopCampaignRecipeParseResultDialog open onOpenChange={(next) => calls.push(next)} parsed={makeParsed()} />,
      )
    })
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(calls).toEqual([false])
  })

  it('关闭交互：点遮罩（点在 layer 本身上，不是弹窗内部）', () => {
    const calls: boolean[] = []
    act(() => {
      root.render(
        <SopCampaignRecipeParseResultDialog open onOpenChange={(next) => calls.push(next)} parsed={makeParsed()} />,
      )
    })
    const layer = document.body.querySelector<HTMLDivElement>('.ds-dialog-layer')
    expect(layer).toBeTruthy()
    act(() => {
      layer!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(calls).toEqual([false])
  })
})
