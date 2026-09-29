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
import type { RecipeForbiddenRule } from '../../types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 词名 → 规则（多数用例不关心例外，等价于「这个词没有例外」，TB-145）。
 * 已经是规则形态的项原样保留，方便单独测例外的用例直接用。
 */
const toRules = (terms: Array<string | RecipeForbiddenRule>): RecipeForbiddenRule[] =>
  terms.map((term) => (typeof term === 'string' ? { term, allow: [] } : term))

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

/**
 * 红线词表（TB-142）—— 报障原话是「红线规则既不能删除也不能新增，误判无法手动修正」。
 * 这组用例锁三件事：**能改**（增 / 改 / 删 / 恢复默认都写回设置）、
 * **能看见**（命中当前骨架的词在词表里标红，且写明不会中断生成）、
 * **能退回只读**（不传修改回调时不渲染编辑控件）。
 */
/**
 * 词表可编辑的弹窗脚手架（TB-142 / TB-146 / TB-147 三组用例共用）。
 *
 * 定义在**文件级**而不是某个 describe 内：TB-147 那组要单独测「总开关关闭」，
 * 放在 describe 里会让它看不到这个 helper。
 *
 * `compliance` 默认 `true`：总开关的**实际默认是关的**，而这些用例多数测的是"开着时"的行为，
 * 显式打开才保持原语义（否则每条都会因为不判定而红）。
 */
function renderWithTerms(
  initial: Array<string | RecipeForbiddenRule>,
  configOverrides: Partial<SopCampaignRecipeConfig> = {},
  editable = true,
  compliance = true,
) {
  const changes: RecipeForbiddenRule[][] = []
  const config = { ...makeConfig(), ...configOverrides }
  function Harness() {
    const [terms, setTerms] = useState<RecipeForbiddenRule[]>(toRules(initial))
    return (
      <SopCampaignRecipeParseResultDialog
        open
        onOpenChange={() => {}}
        parsed={makeParsed()}
        config={config}
        onChange={() => {}}
        forbiddenTerms={terms}
        onForbiddenTermsChange={
          editable
            ? (next) => {
                changes.push(next)
                setTerms(next)
              }
            : undefined
        }
        complianceEnabled={compliance}
        onComplianceEnabledChange={() => {}}
      />
    )
  }
  act(() => {
    root.render(<Harness />)
  })
  return changes
}

/** 词表里所有「词」输入框（例外框的 aria-label 前缀是「例外词」，不会被这个选择器命中）。 */
const termInputs = () => Array.from(document.body.querySelectorAll<HTMLInputElement>('input[aria-label^="红线词"]'))

describe('SopCampaignRecipeParseResultDialog · 红线词表（TB-142）', () => {
  it('词表条目就是输入框：可加一条、可改字、可删除', () => {
    const changes = renderWithTerms(['提现', '军'])
    expect(termInputs().map((input) => input.value)).toEqual(['提现', '军'])

    clickButton('加一条')
    expect(changes[changes.length - 1]).toEqual(toRules(['提现', '军', '']))

    typeInto(termInputs()[0], '提现按钮')
    expect(changes[changes.length - 1]).toEqual(toRules(['提现按钮', '军', '']))

    const removeButtons = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button[aria-label^="删除红线词"]'),
    )
    act(() => {
      removeButtons[1].click()
    })
    expect(changes[changes.length - 1]).toEqual(toRules(['提现按钮', '']))
  })

  it('恢复默认还原成内置 21 词，且**带内置例外**（TB-145）', () => {
    const changes = renderWithTerms(['军'])
    clickButton('恢复默认')
    const restored = changes[changes.length - 1]
    expect(restored).toHaveLength(21)
    expect(restored[0].term).toBe('人民币')
    // 关键：恢复默认必须保住内置例外。若退回纯词名版本，用户点一次就回到「裸妆被拦」。
    expect(restored.find((item) => item.term === '裸')?.allow).toContain('裸妆')
  })

  it('命中当前骨架的那一格标红，并指向复核区（TB-144 起骨架提示并入复核清单）', () => {
    renderWithTerms(['提现', '军'], { body: '点击提现到账，{M}' })
    const text = dialogText()
    expect(text).toContain('骨架命中红线「提现」')
    expect(text).toContain('已列入下方「红线复核」')
    const hit = document.body.querySelectorAll('.sop-recipe-term--hit')
    expect(hit).toHaveLength(1)
    // ⚠️ 必须用类选择器定位「词」输入框：格子里还有一个加白勾选框（TB-146），
    // 直接 querySelector('input') 会先命中勾选框（它的 value 是 'on'）。
    expect(hit[0].querySelector<HTMLInputElement>('input.sop-recipe-term__word')?.value).toBe('提现')
  })

  it('骨架命中红线也照常出预览（与真实生成同口径）', () => {
    renderWithTerms(['提现'], { body: '点击提现到账，{M}, {S1}' })
    expect(document.body.querySelectorAll('.sop-recipe-preview__list li').length).toBeGreaterThan(0)
  })

  it('例外输入框写回的是「词 + 例外」规则（TB-145）', () => {
    const changes = renderWithTerms(['裸'])
    const boxes = () => Array.from(document.body.querySelectorAll<HTMLInputElement>('input[aria-label^="例外词"]'))
    expect(boxes()).toHaveLength(1)
    expect(boxes()[0].value).toBe('')

    typeInto(boxes()[0], '裸妆、裸色')
    expect(changes[changes.length - 1]).toEqual([{ term: '裸', allow: ['裸妆', '裸色'] }])
  })

  it('填了例外之后：正常搭配不再误伤，违规用法照拦（端到端）', () => {
    renderWithTerms(['裸'], {
      body: '裸妆效果，{M}',
      dimensions: [{ name: 'M', options: ['裸体艺术'] }],
    })
    // 填例外前：骨架里的「裸妆」被判命中
    expect(dialogText()).toContain('骨架命中红线「裸」')

    const boxes = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[aria-label^="例外词"]'))
    typeInto(boxes[0], '裸妆')

    // 填之后：骨架不再命中……
    expect(dialogText()).not.toContain('骨架命中红线')
    // ……而候选值里的「裸体艺术」照旧命中（例外只豁免填进去的那一段，不是整个词）
    expect(document.body.querySelectorAll('.sop-recipe-option--blocked')).toHaveLength(1)
  })

  /**
   * 加白（TB-146）—— 需求原话：「被错误判定为红线的词只能通过删除来绕过，这不合理。」
   *
   * 与「删除」的关键差别就一条：**词还在表里**，撤白即恢复；删除是不可逆的。
   */
  it('勾选框 = 加白：整词停用，不再判定也不再标红', () => {
    const changes = renderWithTerms(['提现'], { body: '点击提现到账，{M}' })
    expect(dialogText()).toContain('骨架命中红线「提现」')
    expect(document.body.querySelectorAll('.sop-recipe-term--hit')).toHaveLength(1)

    const box = document.body.querySelector<HTMLInputElement>('.sop-recipe-term__whitelist')
    expect(box?.checked).toBe(false)
    act(() => {
      box?.click()
    })

    expect(changes[changes.length - 1]).toEqual([{ term: '提现', allow: [], disabled: true }])
    // 加白后：不再命中骨架、不再标红、整格进入「已加白」态
    expect(dialogText()).not.toContain('骨架命中红线')
    expect(document.body.querySelectorAll('.sop-recipe-term--hit')).toHaveLength(0)
    expect(document.body.querySelectorAll('.sop-recipe-term--muted')).toHaveLength(1)
    // 第二行从「例外输入」换成状态说明 —— 例外已没有服务对象
    expect(dialogText()).toContain('已加白')
    expect(document.body.querySelectorAll('input[aria-label^="例外词"]')).toHaveLength(0)
  })

  it('加白是「可逆的删除」：再点一次恢复，例外配置原样保留', () => {
    const changes = renderWithTerms([{ term: '裸', allow: ['裸妆'] }], { body: '裸妆效果，{M}' })
    act(() => {
      document.body.querySelector<HTMLInputElement>('.sop-recipe-term__whitelist')?.click()
    })
    expect(changes[changes.length - 1][0]).toEqual({ term: '裸', allow: ['裸妆'], disabled: true })

    act(() => {
      document.body.querySelector<HTMLInputElement>('.sop-recipe-term__whitelist')?.click()
    })
    expect(changes[changes.length - 1][0]).toEqual({ term: '裸', allow: ['裸妆'], disabled: false })
    // 撤白后例外输入回到界面上（配置一直没丢）
    expect(document.body.querySelectorAll('input[aria-label^="例外词"]')).toHaveLength(1)
  })

  it('标题行报出已加白条数（否则「词还在、却不生效」会让人以为坏了）', () => {
    renderWithTerms([{ term: '军', allow: [], disabled: true }, '提现'])
    expect(dialogText()).toContain('2 项 · 1 项已加白 · 已启用')
  })

  it('存档里缺 allow 字段时不崩（渲染成空例外，而不是白屏）', () => {
    // 手工改过库 / 旧格式可能缺这个字段：类型上它必填，但运行时不能假设它一定在 ——
    // 缺字段时 `.join()` 会抛错，把整个弹窗渲染崩掉（比显示不对难查得多）。
    const broken = [{ term: '提现', disabled: true } as unknown as RecipeForbiddenRule]
    expect(() => renderWithTerms(broken)).not.toThrow()
    // 词在输入框里（`textContent` 不含 input 的 value），所以查 DOM 而不是查文本
    expect(document.body.querySelector<HTMLInputElement>('input.sop-recipe-term__word')?.value).toBe('提现')
    expect(dialogText()).toContain('已加白')
  })

  it('不给修改回调时词表按只读展示，且把例外与加白一并写明', () => {
    renderWithTerms(
      [
        { term: '裸', allow: ['裸妆'] },
        { term: '军', allow: [], disabled: true },
      ],
      {},
      false,
    )
    expect(termInputs()).toHaveLength(0)
    expect(dialogText()).toContain('裸（例外：裸妆） · 军（已加白）')
  })
})

/**
 * 红线复核（TB-144）—— 需求原话：「变量池在识别时经常出现误判并错误显示红线，
 * 我希望能够对标记结果进行人工复核，并支持手动关闭这些红线提示」。
 *
 * 这组用例锁四件事：**命中项摆出来**（不再是只标个红）、**两个动作各自落到已有真相源**
 * （删词 → 词表；剔除 → 候选值）、**显示开关只停用标红不改变判定**、
 * **复核完（命中清零）整块消失**。
 */
describe('SopCampaignRecipeParseResultDialog · 红线复核（TB-144）', () => {
  function renderReview(options: {
    terms?: string[]
    config?: Partial<SopCampaignRecipeConfig>
    hints?: boolean
    /** TB-147 总开关；默认 `true`（这组用例测的是「启用时」的行为）。 */
    compliance?: boolean
  }) {
    const termsChanges: RecipeForbiddenRule[][] = []
    const hintsChanges: boolean[] = []
    const initial = {
      body: '点击提现到账，{M}',
      dimensions: [{ name: 'M', options: ['提现金色文案', '手感出色'] }],
      ...options.config,
    }
    function Harness() {
      const [terms, setTerms] = useState<RecipeForbiddenRule[]>(toRules(options.terms ?? ['提现', '军']))
      const [hints, setHints] = useState<boolean>(options.hints ?? true)
      const [config, setConfig] = useState(initial)
      return (
        <SopCampaignRecipeParseResultDialog
          open
          onOpenChange={() => {}}
          parsed={makeParsed()}
          config={config}
          onChange={(next) => {
            latestConfig = next
            setConfig(next)
          }}
          forbiddenTerms={terms}
          onForbiddenTermsChange={(next) => {
            termsChanges.push(next)
            setTerms(next)
          }}
          complianceEnabled={options.compliance ?? true}
          onComplianceEnabledChange={() => {}}
          showComplianceHints={hints}
          onShowComplianceHintsChange={(value) => {
            hintsChanges.push(value)
            setHints(value)
          }}
        />
      )
    }
    act(() => {
      root.render(<Harness />)
    })
    return { termsChanges, hintsChanges }
  }

  it('命中项摆进复核区，逐条给出处置动作', () => {
    renderReview({})
    const text = dialogText()
    expect(text).toContain('红线复核 · 本次命中 2 处')
    expect(text).toContain('候选值命中会在生成前被剔除')
    // TB-146：首选动作从「删掉这个词」改成「加白」（可逆，比删除安全）
    expect(text).toContain('这不是红线，加白')
    expect(text).toContain('确认违规，剔除')
  })

  it('「这不是红线」把该词加白（词留在表里，只是不参与判定）', () => {
    const { termsChanges } = renderReview({})
    clickButton('这不是红线，加白')
    // 关键：词**还在**（草稿里看得见、可随时切回），这正是它比「删掉」安全的地方
    expect(termsChanges[termsChanges.length - 1]).toEqual([
      { term: '提现', allow: [], disabled: true },
      { term: '军', allow: [] },
    ])
  })

  it('「确认违规，剔除」从维度池删掉这个候选值', () => {
    renderReview({})
    clickButton('确认违规，剔除')
    expect(latestConfig?.dimensions[0].options).toEqual(['手感出色'])
  })

  it('关掉显示后不再标红、复核区不出现（判定照旧，只是不看）', () => {
    renderReview({ hints: false })
    expect(dialogText()).not.toContain('红线复核')
    expect(document.body.querySelectorAll('.sop-recipe-option--blocked')).toHaveLength(0)
    expect(dialogText()).toContain('显示红线标记：关')
  })

  it('显示开关点击后写回设置', () => {
    const { hintsChanges } = renderReview({
      config: { body: '{M}', dimensions: [{ name: 'M', options: ['手感出色'] }] },
    })
    clickButton('显示红线标记')
    expect(hintsChanges).toEqual([false])
  })

  it('复核完（命中清零）后复核区自动消失', () => {
    renderReview({ terms: ['提现'], config: { body: '{M}', dimensions: [{ name: 'M', options: ['提现金色文案'] }] } })
    expect(dialogText()).toContain('红线复核')
    // 判为误判：加白 → 该词不再参与判定 → 命中清零 → 整块消失
    clickButton('这不是红线，加白')
    expect(dialogText()).not.toContain('红线复核')
  })

  // 守卫「格子上那处标红」有没有把**当前词表**传进去 —— 漏传会退回内置 21 词，
  // 于是用户删掉误判词之后格子照旧标红（"删了还标红"，TB-144 实测过的真 bug）。
  it('候选值是否标红按当前生效词表判定（删掉的词不再让它标红）', () => {
    renderReview({ terms: ['军'], config: { body: '{M}', dimensions: [{ name: 'M', options: ['提现金色文案'] }] } })
    expect(document.body.querySelectorAll('.sop-recipe-option--blocked')).toHaveLength(0)
    expect(dialogText()).not.toContain('红线复核')
  })
})

/**
 * 红线**总开关**（TB-147）—— 需求原话：「直接帮我屏蔽红线词功能」。
 *
 * 关键是**默认关闭**：不传 / `undefined` / `false` 一律不生效。关闭时标红、复核区、
 * 骨架命中提示**一起**消失 —— 因为它把判定用的词表置空，复用「空词表 = 红线全关」的既有语义。
 */
describe('SopCampaignRecipeParseResultDialog · 红线总开关（TB-147）', () => {
  it('⭐ 不传开关时按【关闭】处理（不留「缺省即开」的兜底）', () => {
    act(() => {
      root.render(
        <SopCampaignRecipeParseResultDialog
          open
          onOpenChange={() => {}}
          parsed={makeParsed()}
          config={{ ...makeConfig(), body: '点击提现到账，{M}' }}
          onChange={() => {}}
        />,
      )
    })
    const text = dialogText()
    expect(text).toContain('已关闭')
    // 三项命中痕迹一个都不能有：骨架提示 / 复核区 / 格子标红
    expect(text).not.toContain('骨架命中红线')
    expect(text).not.toContain('红线复核')
    expect(document.body.querySelectorAll('.sop-recipe-term--hit')).toHaveLength(0)
  })

  it('关闭时词表仍可看可编辑（让人先把词配好、再打开开关）', () => {
    const changes = renderWithTerms(['提现'], { body: '点击提现到账，{M}' }, true, false)
    expect(dialogText()).toContain('已关闭')
    expect(document.body.querySelectorAll('.sop-recipe-term--hit')).toHaveLength(0)
    expect(dialogText()).not.toContain('红线复核')
    // 词表还在，改动照常写回
    expect(termInputs().map((input) => input.value)).toEqual(['提现'])
    typeInto(termInputs()[0], '提现到账')
    expect(changes[changes.length - 1]).toEqual([{ term: '提现到账', allow: [] }])
  })

  it('关闭时隐藏「显示红线标记」开关（没东西可标，留着只是噪音）', () => {
    renderWithTerms(['提现'], {}, true, false)
    expect(dialogText()).not.toContain('显示红线标记')
    expect(dialogText()).toContain('合规红线：关')
  })
})
