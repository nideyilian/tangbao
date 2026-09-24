/* @vitest-environment jsdom */

/**
 * 中控台「渠道与输出」分区：**全局参数的编辑入口**。
 *
 * 2026-09-20「后处理」弹窗收窄为「只显示当前方向的参数」之后，原先挂在弹窗全局作用域里的
 * 四个参数搬到了中控台；2026-09-22（TB-093）「输出位置」又并入「渠道与尺寸」——
 * 于是这些参数现在都在**同一个分区**里。本文件是它们的**入口守卫**：
 *
 * | 参数                         | 落在哪                                          |
 * | ---------------------------- | ----------------------------------------------- |
 * | 命名模板 / 创作者 / 产出预览 | 「渠道与输出」分区（文件命名 / 产出预览小节）    |
 * | 画面方向                     | 「渠道与输出」分区（表上方，整批三选一）         |
 * | 画面适配                     | 「渠道与输出」分区（与画面方向并排）             |
 * | 分发 / 纯净版自动伴随        | 「渠道与输出」分区（分发小节）                   |
 * | 渠道名 / 尺寸规格 / 参与产出 | 「渠道与输出」分区的**表本体**                   |
 * | 按渠道的导出位置             | 同上 —— 就在那张表的「导出位置」列（TB-093 并入） |
 *
 * 断言口径不是「组件渲染出来了」，而是**改得动、写得进 store**：参数换了家但入口断了，
 * 是这轮改造最容易出的回归，光看渲染通过是测不出来的。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { DEFAULT_POSTPROCESS_NAME_PATTERN } from '../../../lib/postprocessNaming'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import type { AssetCollection } from '../../../types'
import { ChannelSection } from './ChannelSection'
import { DistributionSection } from './DistributionSection'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '智能客服', null, 0),
  collection('product-a', '机器人', 'line-a', 0),
  collection('direction-a', '竖版展示', 'product-a', 0),
]

let container: HTMLDivElement
let root: Root

function text(): string {
  return container.textContent ?? ''
}

/** 受控 input 的写入要过原生 setter，否则 React 的 value 追踪器认为没变、不触发 onChange */
function typeInto(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`未找到输入框：${selector}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function clickByText(label: string) {
  const node = Array.from(container.querySelectorAll<HTMLElement>('button, label, input')).find((item) =>
    (item.textContent ?? item.getAttribute('aria-label') ?? '').includes(label),
  )
  if (!node) throw new Error(`未找到可点击元素：${label}`)
  act(() => node.click())
}

function clickByAriaLabel(label: string) {
  const node = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!node) throw new Error(`未找到元素：${label}`)
  act(() => node.click())
}

/**
 * 写「按渠道」表格的某个单元格并**提交**。
 *
 * 表格走 `DataGrid`（TB-060），单元格是**草稿态**：输入期间只改本地 draft，失焦或回车才提交。
 * 所以写完必须 blur —— 而且要**先 focus**（jsdom 里未聚焦的元素 `blur()` 不派发事件）。
 * 单元格的无障碍名称形如「导出位置：百度」。
 */
function commitGridCell(cellLabel: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${cellLabel}"]`)
  if (!input) throw new Error(`未找到表格单元格：${cellLabel}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => input.focus())
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.blur())
}

function render(node: React.ReactElement) {
  act(() => {
    root.render(node)
  })
  return text()
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  usePostprocessMediaStore.setState(createDefaultPostprocessMediaConfig())
  useAssetLibraryStore.setState({ collections: COLLECTIONS })
  useProjectTreeParamsStore.setState({ params: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('中控台 · 渠道与输出分区：输出侧（导出目录 / 命名 / 分发 / 产出预览）', () => {
  // 下面两例从 `OutputSection.test.tsx` 搬来（2026-09-22 两个分区合并，那个文件随之删掉）。
  // 锁的是**合并之后内容真的还在这**：原先的独立 tab 已经删掉，漏在这里等于功能直接消失，
  // 而不是「换个地方」。
  it('⭐ 分发并进来了：分发字段渲染得出来', () => {
    const body = render(<ChannelSection scope={GLOBAL_NODE_ID} />)

    // 这一串来自「分发」小节的卡片 —— 它原先只出现在独立的分发分区里，
    // 漏在这里等于功能直接消失，而不是「换个地方」。
    expect(body).toContain('启用分发')
  })

  it('⭐ 三个全局小节各有自己的标题，说清「不随作用域变」', () => {
    const body = render(<ChannelSection scope={GLOBAL_NODE_ID} />)

    // 这一区是混合的：渠道导出目录按作用域走，后三节是全局一套 ——
    // 标题里不写清，用户切了节点会以为连命名 / 分发也一起变了
    expect(body).toContain('文件命名')
    expect(body).toContain('分发')
    expect(body).toContain('全局一套')
  })

  it('命名模板的未知 / 缺失占位符会给出提示', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{date}-{oops}')
    })
    const body = render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(body).toContain('不认识的占位符：{oops}')
    expect(body).toContain('缺少占位符：{seq}')
  })

  it('命名模板可以清空回默认值（留空 = 用默认模板）', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{seq}')
    })
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    // 输入框里显示的是**中文占位符**，存进 store 的仍是 `{seq}`（显示层与存储层分家）
    expect(container.querySelector<HTMLInputElement>('[data-testid="name-pattern-input"]')!.value).toBe('{序号}')

    typeInto('[data-testid="name-pattern-input"]', '')
    const next = usePostprocessMediaStore.getState().namePattern
    expect(next === '' || next === DEFAULT_POSTPROCESS_NAME_PATTERN).toBe(true)
  })

  it('命名模板变量插在光标所在处（不再有第二个模板编辑器）', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{seq}')
    })
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const input = container.querySelector<HTMLInputElement>('[data-testid="name-pattern-input"]')!
    input.setSelectionRange(0, 0)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="name-token-date"]')!.click()
    })
    expect(usePostprocessMediaStore.getState().namePattern).toBe('{date}{seq}')
  })

  it('创作者写进 store（供 {creator} 占位符取值）', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const creatorInput = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find(
      (node) => node.placeholder === '如：糖包',
    )
    if (!creatorInput) throw new Error('未找到创作者输入框')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(creatorInput, '糖包工作室')
      creatorInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(usePostprocessMediaStore.getState().creator).toBe('糖包工作室')
  })

  it('产出预览按全局作用域展开文件名（渠道 + 尺寸）', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const body = render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(body).toContain('产出预览')
    expect(body).toContain('广点通')
    expect(body).toContain('1280×720')
  })

  it('⭐ 产出预览的序号按文件夹分组：两个渠道各自从 1 开始（跟真实产出同一套编排）', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('direction-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
      usePostprocessMediaStore.getState().toggleSelectedMedia('baidu')
    })
    const body = render(<ChannelSection scope="direction-a" />)

    /**
     * 只断言文件名**尾巴**（`-序号.jpg`），不比对整串：模板开头的 `{date}` 取当前时间，
     * 整串断言会随日期变红。
     */
    const fileNames = body.match(/[\w\u4e00-\u9fa5-]+\.jpg/g) ?? []
    // 广点通 / 百度的每个尺寸各落一个文件夹 → 都是 `-1`（先断数量，防 `every` 空数组假绿）
    expect(fileNames.length).toBeGreaterThanOrEqual(4)
    expect(fileNames.every((name) => name.endsWith('-1.jpg'))).toBe(true)
    // 预览自己数下标时（TB-104 之前）第二个渠道会显示成 `-2` —— 这条就是那个缺陷的反向验证
    expect(fileNames.some((name) => name.endsWith('-2.jpg'))).toBe(false)
  })

  it('产出预览跟随作用域：全局层展开全部方向（不再依赖启用范围），节点层按该节点展开', () => {
    // 2026-09-23：撤掉「启用范围」白名单之后，全局层不再看任何勾选 —— 树上的方向全都在列，
    // 旧的那句「还没有启用任何方向」也随之消失（它的触发条件已经不存在了）。
    // 预览本身仍要有可产出的单元才会列文件，而默认一个渠道都不勾 → 这里先勾一个。
    act(() => usePostprocessMediaStore.getState().toggleSelectedMedia('gdt'))
    const globalBody = render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(globalBody).not.toContain('还没有启用任何方向')
    expect(globalBody).toContain('智能客服 / 机器人 / 竖版展示')
    // 节点层：作用域本身就是产出目标
    const nodeBody = render(<ChannelSection scope="direction-a" />)
    expect(nodeBody).toContain('智能客服 / 机器人 / 竖版展示')
  })

  it('全局渠道目录在全局作用域写全局渠道表，并支持双写', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    commitGridCell('导出位置：百度', 'D:/百度一')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度一'])

    // 第二个位置加在**下一行**（不是右边加一列），所以它的单元格名带位置号
    clickByAriaLabel('百度：在下面再加一个位置')
    commitGridCell('导出位置：百度（位置2）', 'D:/百度二')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度一', 'D:/百度二'])
  })

  it('⭐ 每个位置单独删：删一格不影响另一格，删到一个不剩才退回留空', () => {
    // 这是移除「清空」按钮换来的能力：旧按钮一次抹掉整个渠道的两个位置，没有确认也撤不回
    act(() => {
      usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 0, 'D:/百度一')
      usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 1, 'D:/百度二')
    })
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)

    clickByAriaLabel('百度（位置2）：删除这个位置')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度一'])

    clickByAriaLabel('百度：删除这个位置')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toBeUndefined()
  })

  it('⭐ 节点作用域删到一个不剩 = 摘掉本级覆盖（写 undefined，而不是留一条空数组）', () => {
    // 空数组在协议里是**显式**「用默认输出位置」，会把上级的配置一起挡掉；
    // 「删干净」必须是 `undefined`（没表态，继续继承）。这两个含义差在类型上看不出来，
    // 只能靠断言钉住。
    act(() => {
      useProjectTreeParamsStore.getState().setPostprocessOverride('direction-a', {
        byMedia: { baidu: { outputDirs: ['D:/节点一', 'D:/节点二'] } },
      })
    })
    render(<ChannelSection scope="direction-a" />)

    clickByAriaLabel('百度（位置2）：删除这个位置')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.byMedia?.baidu?.outputDirs).toEqual(
      ['D:/节点一'],
    )

    clickByAriaLabel('百度：删除这个位置')
    expect(
      useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.byMedia?.baidu?.outputDirs,
    ).toBeUndefined()
  })

  it('⭐ 没有「一键清空整个渠道」的按钮（误点即丢，2026-09-21 移除）', () => {
    act(() => {
      usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 0, 'D:/百度一')
    })
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(container.querySelector('[aria-label="百度：用默认"]')).toBeNull()
    expect(container.querySelector('[aria-label="百度：恢复继承"]')).toBeNull()
  })

  it('节点作用域下同一条目录写进该节点的 byMedia，而不是全局渠道表', () => {
    render(<ChannelSection scope="direction-a" />)
    commitGridCell('导出位置：百度', 'D:/节点百度')
    const override = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess
    expect(override?.byMedia?.baidu?.outputDirs).toEqual(['D:/节点百度'])
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toBeUndefined()
  })
})

describe('中控台 · 渠道与输出分区：表本体（尺寸 / 参与产出 / 导出位置合成一张表）', () => {
  it('画面方向默认「跟随尺寸」，在这里可以整批强制竖版', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(text()).toContain('画面方向')
    expect(usePostprocessMediaStore.getState().direction).toBeNull()

    clickByText('竖版')
    expect(usePostprocessMediaStore.getState().direction).toBe('portrait')

    clickByText('跟随尺寸')
    expect(usePostprocessMediaStore.getState().direction).toBeNull()
  })

  it('⭐ 画面适配默认「裁剪填满」，可整批切成模糊填充 / 拉伸铺满，并写进产出链读的那份配置', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(text()).toContain('画面适配')
    // 默认值必须与这次改动之前的行为一致（当时写死在产出链路里）——改了默认就是改了所有人的产出
    expect(usePostprocessMediaStore.getState().fitMode).toBe('crop-fill')

    clickByText('模糊填充')
    expect(usePostprocessMediaStore.getState().fitMode).toBe('contain-blur')

    clickByText('拉伸铺满')
    expect(usePostprocessMediaStore.getState().fitMode).toBe('stretch')

    clickByText('裁剪填满')
    expect(usePostprocessMediaStore.getState().fitMode).toBe('crop-fill')
  })

  it('画面适配只显示**当前选中**那条的代价：三个模式都能填满画布，差别全在代价上', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(text()).toContain('代价是丢边缘内容')
    // 没选的那两条不铺开，否则这一区会被撑成一段说明文字
    expect(text()).not.toContain('对留白敏感的渠道可能不收')

    clickByText('模糊填充')
    expect(text()).toContain('对留白敏感的渠道可能不收')
    expect(text()).not.toContain('代价是丢边缘内容')
  })

  it('渠道表的「参与产出」开关写进 selectedMediaIds（决定这个渠道参不参与产出）', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    clickByAriaLabel('参与产出：广点通')
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toContain('gdt')
  })

  it('渠道表直接可见、就地可编辑：不再需要先展开折叠的规格编辑器', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    // 2026-09-22 起只有**一张**表（渠道 + 尺寸 + 参与产出 + 导出位置），独立的「尺寸表」没有了
    expect(container.querySelector('table[aria-label="渠道与输出"]')).toBeTruthy()
    expect(container.querySelector('table[aria-label="尺寸表"]')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[placeholder="新渠道名称，如「抖音」"]')).toBeTruthy()
  })

  it('渠道名、详细尺寸、导出位置都落在列上（原两张表的列合成一张）', () => {
    const body = render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    expect(body).toContain('广点通')
    expect(body).toContain('详细尺寸')
    expect(body).toContain('导出位置')
    expect(body).toContain('横版')
    // 「尺寸数 / 可用尺寸」两个派生列已删：尺寸那格本来就是「一眼数出配了几套」的复选框组
    expect(body).not.toContain('尺寸数')
  })

  it('⭐ 双写占两行：渠道名 / 详细尺寸 / 参与产出 三格跨两行合并，只有导出位置逐行', () => {
    // 一个渠道最多两个位置（双写），所以表的行粒度是**位置槽** —— 第二行读作「它的第二个位置」，
    // 而不是「另一个渠道」。合并靠 `DataGridColumn.spanRows`：三个列返回同一个跨行数，
    // 切换渠道时不会一列合、一列不合。
    act(() => usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 0, 'D:/百度'))
    act(() => usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 1, 'E:/留档百度'))
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)

    const table = container.querySelector<HTMLTableElement>('table[aria-label="渠道与输出"]')!
    const channelCount = usePostprocessMediaStore.getState().media.length
    // 百度配了两个位置 → 它占两行，所以总行数比渠道数多 1
    expect(table.querySelectorAll('tbody tr')).toHaveLength(channelCount + 1)

    // 行序跟渠道表一致：广点通 / 百度#0 / 百度#1 / 厂商 / 头条
    const rows = table.querySelectorAll('tbody tr')
    const baiduFirst = rows[1]!
    const cells = baiduFirst.querySelectorAll('td')
    expect(cells).toHaveLength(6)
    expect(cells[0]!.getAttribute('rowspan')).toBe('2')
    expect(cells[1]!.getAttribute('rowspan')).toBe('2')
    expect(cells[2]!.getAttribute('rowspan')).toBe('2')
    // 导出位置 / 写入 / 操作逐行（跨行的那三格以外，这三列每行各自一格）——
    // 「写入」必须逐行：一个渠道的两个位置各写各的，开关不能拉通
    expect(cells[3]!.getAttribute('rowspan')).toBeNull()
    expect(cells[4]!.getAttribute('rowspan')).toBeNull()
    expect(cells[5]!.getAttribute('rowspan')).toBeNull()

    // 第二行只剩「导出位置 + 写入 + 操作」：被跨行格盖住的那三格**不能出空格子**，否则后面整体右移
    const baiduSecond = rows[2]!
    expect(baiduSecond.querySelectorAll('td')).toHaveLength(3)
  })

  it('⭐ 双写的第 2 个位置写进第 2 槽，第 1 个位置一个字节不动', () => {
    act(() => usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 0, 'D:/百度'))
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)

    // 第 2 行要配过第 1 个位置、再点「+」才会出现（「+」只在组内最后一行）
    clickByAriaLabel('百度：在下面再加一个位置')
    commitGridCell('导出位置：百度（位置2）', 'E:/留档百度')

    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度', 'E:/留档百度'])
  })

  it('⭐ 短标记列居中（渠道名 / 参与产出 / 写入），长内容列左对齐（2026-09-22 定的口径）', () => {
    // 短标记（名字、一个勾）居中比贴左更稳；详细尺寸与导出位置是长内容，必须左对齐。
    // 改回全左或全中，这条会挂。
    //
    // ⚠️ 「写入」（TB-130）也是「一个勾」，与「参与产出」同类，所以一并居中 ——
    // 两列的勾于是落在同一条竖线上。这条守卫原先只断言到第 4 列（导出位置），
    // 新加列能整列逃过检查 —— 加列时**必须把它一起纳入断言**（TB-130 时补的）。
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const heads = container.querySelectorAll('table[aria-label="渠道与输出"] thead th')
    const isCentered = (index: number) =>
      (heads[index]!.className as string).includes('ds-data-grid__head-cell--center')
    expect(isCentered(0)).toBe(true) // 渠道名
    expect(isCentered(1)).toBe(false) // 详细尺寸
    expect(isCentered(2)).toBe(true) // 参与产出
    expect(isCentered(3)).toBe(false) // 导出位置
    expect(isCentered(4)).toBe(true) // 写入（TB-130）
    expect(isCentered(5)).toBe(false) // 操作
  })

  it('⭐ 尺寸表一行一个渠道，详细尺寸是一组复选框（勾选 = 参与产出）', () => {
    // 2026-09-21 反馈：「详细尺寸使用复选框，尽可能排一行，放不下的排两行」。
    // 行 = 渠道，格子里横排复选框 —— 扫一眼就知道每个渠道配了哪几套、哪几套是开的。
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const table = container.querySelector<HTMLTableElement>('table[aria-label="渠道与输出"]')!
    const channelCount = usePostprocessMediaStore.getState().media.length
    // 行粒度是**位置槽**：默认没配导出位置，所以每个渠道正好占一行（配了双写才占两行）
    expect(table.querySelectorAll('tbody tr')).toHaveLength(channelCount)

    // 勾选按**可访问名称**定位（「渠道 宽×高 参与产出」），不受渲染顺序影响
    const box = container.querySelector<HTMLInputElement>('input[aria-label="广点通 1280×720 参与产出"]')
    expect(box?.checked).toBe(true)
    act(() => box!.click())
    const gdt = usePostprocessMediaStore.getState().media.find((item) => item.id === 'gdt')!
    expect(gdt.sizes.find((size) => size.id === 'gdt-1280x720')?.enabled).toBe(false)
  })

  it('⭐ 详细尺寸排成整齐的两列，尺寸多的渠道自己往下长（2026-09-22 由 flex-wrap 改 grid）', () => {
    // 反馈原话：「两列尺寸这种对齐方式太乱了」。flex-wrap 下每行第二个 chip 的起点取决于
    // 它左边那个 chip 有多宽 —— 逐行参差；grid 的列宽由该列最宽的 chip 定，两列各成一条竖线。
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const vendorCell = container.querySelector<HTMLElement>('[data-testid="size-checks-vendor"]')!
    expect(vendorCell.className).toContain('grid-cols-2')

    const vendor = usePostprocessMediaStore.getState().media.find((item) => item.id === 'vendor')!
    // 一个尺寸一个复选框，一个都不少
    expect(vendorCell.querySelectorAll('input[type="checkbox"]')).toHaveLength(vendor.sizes.length)

    // 每格高度定死 24px（h-6）：折行时才一样高，也给「加尺寸」按钮一个能对齐的高度
    expect(vendorCell.children[0]!.className).toContain('h-6')
  })

  it('⭐「加尺寸」按钮与尺寸格同高、且保持正方形（IconButton sm 默认 32px，比 chip 高一截）', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const cell = container.querySelector<HTMLElement>('[data-testid="size-checks-toutiao"]')!
    const addSize = cell.querySelector<HTMLElement>('button[aria-label="给「头条」加一个尺寸"]')!
    // 24px 见方：宽、高、min-height 三个都得覆盖 —— IconButton 的 sm 把它们都声明成了 32px，
    // 少覆盖一个就会被 ds 基础类吃回去（RISK R-80），所以三条都要 `!` 且都要断言。
    expect(addSize.className).toContain('!h-6')
    expect(addSize.className).toContain('!w-6')
    expect(addSize.className).toContain('!min-h-6')
  })

  it('⭐ 点尺寸名展开详细编辑：改宽高 = 换一套尺寸，主键跟着换', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    act(() => container.querySelector<HTMLElement>('[data-testid="edit-size-gdt-1280x720"]')!.click())
    expect(text()).toContain('编辑尺寸：广点通 1280×720')

    typeInto('input[aria-label="尺寸宽"]', '1920')
    clickByText('应用')

    // 主键由「渠道-宽x高」派生：改了宽高就是新主键，旧规格不再存在
    const ids = usePostprocessMediaStore
      .getState()
      .media.find((item) => item.id === 'gdt')!
      .sizes.map((size) => size.id)
    expect(ids).toContain('gdt-1920x720')
    expect(ids).not.toContain('gdt-1280x720')
  })

  it('⭐ 尺寸编辑面板的字段行：标签一条线、控件一条线、操作区跟控件同行（2026-09-22 对齐修正）', () => {
    // 报障：面板里「渠道 / 体积上限」比「宽 / 高」高出一个标签行（底对齐 + 只有部分字段有说明文字），
    // 且「删除尺寸」的图标被 preflight 的 `svg{display:block}` 顶到文字上方单独成行。
    // 这里钉住三件事：① 字段行是顶对齐；② 操作区用 `.ds-field` 的标签槽对齐到控件那条线；
    // ③ 图标走 `leadingIcon`（直接挂在 button 下，而不是塞进文字 span 里）。
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    act(() => container.querySelector<HTMLElement>('[data-testid="edit-size-gdt-1280x720"]')!.click())

    const row = container.querySelector<HTMLElement>('[data-testid="size-editor-fields"]')!
    // 底对齐（flex-end）就是错位成因：带说明文字的字段会被整体顶高
    expect(row.style.alignItems).toBe('flex-start')

    // 操作区：与字段同构（label 槽 + 控件槽），这样才能跟输入框落在同一条控件线上
    const actions = container.querySelector<HTMLElement>('[data-testid="size-editor-actions"]')!
    expect(actions.className).toContain('ds-field')
    const spacer = actions.querySelector<HTMLElement>('.ds-field__label')!
    expect(spacer.className).toContain('invisible') // 占位不显形（visibility 保住布局盒）
    expect(spacer.getAttribute('aria-hidden')).toBe('true') // 读屏不该念这行占位字

    // 图标必须是 button 的直接子节点（leadingIcon 的渲染形态）；塞进 children 时它会被包在文字 span 里
    const deleteButton = [...actions.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('删除尺寸'),
    )!
    expect(deleteButton.querySelector(':scope > svg')).not.toBeNull()
    expect(deleteButton.querySelector('span > svg')).toBeNull()

    // 同一条线上的两个按钮（应用 / 删除尺寸）都在操作区里，不会被拆到下一行
    expect(actions.querySelectorAll('button')).toHaveLength(2)

    // 「添加渠道」同一个坑（图标当 children）：一并钉住
    const addChannel = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('添加渠道'),
    )!
    expect(addChannel.querySelector(':scope > svg')).not.toBeNull()
    expect(addChannel.querySelector('span > svg')).toBeNull()
  })

  it('尺寸行的「+」是图标按钮：加尺寸就近加在这个渠道上', () => {
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    clickByAriaLabel('给「头条」加一个尺寸')
    const toutiao = usePostprocessMediaStore.getState().media.find((item) => item.id === 'toutiao')!
    expect(toutiao.sizes.some((size) => size.width === 1024 && size.height === 1024)).toBe(true)
  })

  it('⭐ 渠道级启停只有一个（「参与产出」）：没有第二个叫「启用」的渠道开关列（ADR-0013）', () => {
    // ADR-0013 删掉渠道级 `enabled`，理由是它与「参与产出」对产出完全等价，留着只会让人怀疑
    // 它们有什么区别 —— 这条是「别再合出来一个」的守卫。
    //
    // ⚠️ 2026-09-24（TB-130）起表里确实有**第二个**开关列，但它不是渠道级：列名叫「写入」，
    // 管的是「这一处导出位置写不写」（关掉照样生成变体，只是不落这一处），与「这个渠道产不产出」
    // 是两件事。所以这条继续守着「不许出现叫『启用』的列」—— 叫「启用」就会让人以为是同一件事。
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const header = container.querySelector('table[aria-label="渠道与输出"] thead')!
    expect(header.textContent).toContain('参与产出')
    expect(header.textContent).toContain('写入')
    expect(header.textContent).not.toContain('启用')
    expect(container.querySelector('[aria-label="启用：广点通"]')).toBeNull()
  })

  it('⭐ 节点作用域：「参与产出」写进该方向的 selectedMediaIds，全局基线一个字节不动', () => {
    // ADR-0013 的核心：渠道**规格**全局一套，但「这个方向投哪几个渠道」是方向级的。
    // 原先选着某个方向改的却是所有方向共用的那份勾选 —— 这条钉住新行为。
    render(<ChannelSection scope="direction-a" />)
    clickByAriaLabel('参与产出：广点通')

    const override = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess
    expect(override?.selectedMediaIds).toContain('gdt')
    // 全局基线的初值是「一个渠道都没勾」，改节点不该动它
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toEqual([])
  })

  it('⭐ 开关显示的是**生效值**：全局勾了、方向没表态时，方向下看到的也是勾上的', () => {
    act(() => usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt']))
    render(<ChannelSection scope="direction-a" />)

    const sw = container.querySelector<HTMLInputElement>('[aria-label="参与产出：广点通"]')
    expect(sw?.checked).toBe(true)
    // 且说清这一格现在是谁说了算 —— 否则用户以为是自己在这个方向上勾的
    expect(text()).toContain('跟随「全局默认」')
  })

  it('⭐「改为跟随上级」把本级值置为「没表态」，而不是空数组（空数组 = 一个渠道都不投）', () => {
    act(() => {
      usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt'])
      useProjectTreeParamsStore.getState().setPostprocessOverride('direction-a', { selectedMediaIds: ['baidu'] })
    })
    render(<ChannelSection scope="direction-a" />)
    expect(text()).toContain('本级自定义')

    clickByText('改为跟随上级')

    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.selectedMediaIds).toBeUndefined()
    // 退回继承后，看到的应该是被继承的那份（全局勾了广点通）
    expect(text()).toContain('跟随「全局默认」')
    expect(container.querySelector<HTMLInputElement>('[aria-label="参与产出：广点通"]')?.checked).toBe(true)
  })

  it('⭐ 导出位置留空时，把继承来的**全部**位置念出来（上一级配了两处就说两处）', () => {
    // TB-095 报障原话：「上一级有一个渠道有两个导出位置，但跟随的只有一个」。
    // 实际产出两处都写，界面只念一处 —— 用户照界面判断就会以为只出一份。
    useProjectTreeParamsStore.setState({
      params: { 'product-a': { postprocess: { byMedia: { baidu: { outputDirs: ['D:/百度A', 'E:/留档B'] } } } } },
    })
    render(<ChannelSection scope="direction-a" />)

    const input = container.querySelector<HTMLInputElement>('input[aria-label="导出位置：百度"]')!
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('留空则继承 2 处：D:/百度A、E:/留档B')
  })

  it('⭐ 隔层继承也念得出来（只看直接父节点会漏成「默认输出位置」）', () => {
    useProjectTreeParamsStore.setState({
      params: { 'line-a': { postprocess: { byMedia: { baidu: { outputDirs: ['D:/A', 'E:/B'] } } } } },
    })
    render(<ChannelSection scope="direction-a" />)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="导出位置：百度"]')!.placeholder).toBe(
      '留空则继承 2 处：D:/A、E:/B',
    )
  })

  it('⭐ 上一级用通用「输出目录」覆盖时提示跟着变（只看 byMedia 会错报成默认位置）', () => {
    useProjectTreeParamsStore.setState({
      params: { 'product-a': { postprocess: { outputDir: 'D:/产品级通用' } } },
    })
    render(<ChannelSection scope="direction-a" />)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="导出位置：百度"]')!.placeholder).toBe(
      '留空则 D:/产品级通用',
    )
  })
})

describe('中控台 · 导出位置开关（TB-130）', () => {
  it('配了位置的行有「写入」开关；关掉只记停用，路径配置一个字节不动', () => {
    act(() => {
      usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 0, 'D:/百度')
    })
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)

    const toggle = container.querySelector<HTMLInputElement>('[aria-label="百度：停掉写入 D:/百度"]')!
    expect(toggle.checked).toBe(true)
    clickByAriaLabel('百度：停掉写入 D:/百度')

    expect(usePostprocessMediaStore.getState().mediaOutputDirEnabled).toEqual({ baidu: { 'D:/百度': false } })
    // 位置本身不动 —— 关掉只是「这一轮别写」，随时能开回来
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度'])
  })

  it('没有位置的行开关是灰的（开关没有作用对象）', () => {
    // 全局层一个渠道都没配位置 → 留空落到默认输出位置。那一行**不给**开关：
    // 全局层停掉兜底位置等于「这个渠道不产出」，而这件事归「参与产出」管（ADR-0013 的教训：
    // 两个开关说同一件事，只会让人怀疑它们有什么区别）
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)
    const toggle = container.querySelector<HTMLInputElement>('[aria-label="百度：这一处还没有导出位置"]')!
    expect(toggle.disabled).toBe(true)
  })

  it('⭐ 本级留空、上级配了位置 → 那行也能关，且只写进本级（全局一个字节不动）', () => {
    usePostprocessMediaStore.setState({ mediaOutputDirs: { baidu: ['D:/百度'] } })
    render(<ChannelSection scope="direction-a" />)

    // 本级这一格的路径是空的（跟着全局），但开关可点、状态按生效值显示
    expect(container.querySelector<HTMLInputElement>('input[aria-label="导出位置：百度"]')!.value).toBe('')
    clickByAriaLabel('百度：停掉写入 D:/百度')

    const byMedia = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.byMedia
    expect(byMedia?.baidu?.outputDirEnabled).toEqual({ 'D:/百度': false })
    // 只有这个方向不写：全局那份既没被改、位置也没被搬过来
    expect(usePostprocessMediaStore.getState().mediaOutputDirEnabled).toEqual({})
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度'])
  })

  it('⭐ 上级有两处时本级铺两行，能只停其中一处（只铺一行的话这种状态显示不出来）', () => {
    usePostprocessMediaStore.setState({ mediaOutputDirs: { baidu: ['D:/共享盘', 'D:/留档'] } })
    render(<ChannelSection scope="direction-a" />)

    // 百度那一组铺两行（继承来的两处各占一行），所以总行数比渠道数多 1
    expect(container.querySelectorAll('tbody tr')).toHaveLength(usePostprocessMediaStore.getState().media.length + 1)

    clickByAriaLabel('百度（位置2）：停掉写入 D:/留档')

    const byMedia = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.byMedia
    expect(byMedia?.baidu?.outputDirEnabled).toEqual({ 'D:/留档': false })
    // 第一处照写（开关仍是开的）
    expect(container.querySelector<HTMLInputElement>('[aria-label="百度：停掉写入 D:/共享盘"]')?.checked).toBe(true)
  })

  it('本级改路径时开关记录跟着搬到新路径（不搬的话那处会「忘记自己关过」）', () => {
    act(() => {
      usePostprocessMediaStore.getState().setMediaOutputDir('baidu', 0, 'D:/百度')
      usePostprocessMediaStore.getState().setMediaOutputDirEnabled('baidu', 'D:/百度', false)
    })
    render(<ChannelSection scope={GLOBAL_NODE_ID} />)

    commitGridCell('导出位置：百度', 'E:/百度新')

    expect(usePostprocessMediaStore.getState().mediaOutputDirEnabled).toEqual({ baidu: { 'E:/百度新': false } })
  })
})

describe('中控台 · 分发分区', () => {
  it('默认关闭时只留开关，不展开具体字段', () => {
    const body = render(<DistributionSection scope={GLOBAL_NODE_ID} />)
    expect(body).toContain('启用分发')
    expect(body).not.toContain('铺几天')
  })

  it('开启后展开条款：铺几天 + 重命名方式', () => {
    act(() => {
      usePostprocessMediaStore.getState().patchDistribution({ enabled: true })
    })
    const body = render(<DistributionSection scope={GLOBAL_NODE_ID} />)
    expect(body).toContain('铺几天')
    expect(body).toContain('重命名方式')
    // 「搬运方式（复制 / 移动）」已撤：这套目录结构下第 1 天是原地，复制会让排期错乱
    expect(body).not.toContain('搬运方式')
    // 起始日期不再由用户填（起算日由程序按产出当天取），界面上不该再有这个输入框
    expect(body).not.toContain('起始日期')
  })
})
