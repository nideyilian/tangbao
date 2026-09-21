/* @vitest-environment jsdom */

/**
 * 中控台的后处理分区：**全局参数的编辑入口**。
 *
 * 2026-09-20「后处理」弹窗收窄为「只显示当前方向的参数」之后，原先挂在弹窗全局作用域里的
 * 四个参数搬到了中控台，本文件就是它们的**入口守卫**：
 *
 * | 参数                     | 新家                              |
 * | ------------------------ | --------------------------------- |
 * | 命名模板 / 创作者 / 产出预览 | 「输出位置」分区                   |
 * | 画面方向                 | 「渠道与尺寸」分区                 |
 * | 分发 / 纯净版自动伴随     | 「分发」分区（本来就在这里）        |
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
import { PURE_MEDIA_ID } from '../../../lib/postprocessMedia'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import type { AssetCollection } from '../../../types'
import { DistributionSection } from './DistributionSection'
import { MediaSection } from './MediaSection'
import { OutputSection } from './OutputSection'

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

describe('中控台 · 输出位置分区（文件命名 + 产出预览）', () => {
  it('命名模板的未知 / 缺失占位符会给出提示', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{date}-{oops}')
    })
    const body = render(<OutputSection scope={GLOBAL_NODE_ID} />)
    expect(body).toContain('不认识的占位符：{oops}')
    expect(body).toContain('缺少占位符：{seq}')
  })

  it('命名模板可以清空回默认值（留空 = 用默认模板）', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{seq}')
    })
    render(<OutputSection scope={GLOBAL_NODE_ID} />)
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
    render(<OutputSection scope={GLOBAL_NODE_ID} />)
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
    render(<OutputSection scope={GLOBAL_NODE_ID} />)
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

  it('产出预览按全局作用域展开文件名（渠道 + 尺寸 + 水印）', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const body = render(<OutputSection scope={GLOBAL_NODE_ID} />)
    expect(body).toContain('产出预览')
    expect(body).toContain('广点通')
    expect(body).toContain('1280×720')
    expect(body).toContain('纯净版')
  })

  it('产出预览跟随作用域：全局层没启用方向时给提示，节点层按该节点照常展开', () => {
    // 全局层：产出目标来自「已启用的范围」，一条都没启用时就没有可展开的目标
    expect(render(<OutputSection scope={GLOBAL_NODE_ID} />)).toContain('还没有启用任何方向')
    // 节点层：作用域本身就是产出目标，不需要「启用范围」也能展开出归属路径
    const nodeBody = render(<OutputSection scope="direction-a" />)
    expect(nodeBody).not.toContain('还没有启用任何方向')
    expect(nodeBody).toContain('智能客服 / 机器人 / 竖版展示')
  })

  it('全局渠道目录在全局作用域写全局渠道表，并支持双写', () => {
    render(<OutputSection scope={GLOBAL_NODE_ID} />)
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
    render(<OutputSection scope={GLOBAL_NODE_ID} />)

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
    render(<OutputSection scope="direction-a" />)

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
    render(<OutputSection scope={GLOBAL_NODE_ID} />)
    expect(container.querySelector('[aria-label="百度：用默认"]')).toBeNull()
    expect(container.querySelector('[aria-label="百度：恢复继承"]')).toBeNull()
  })

  it('节点作用域下同一条目录写进该节点的 byMedia，而不是全局渠道表', () => {
    render(<OutputSection scope="direction-a" />)
    commitGridCell('导出位置：百度', 'D:/节点百度')
    const override = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess
    expect(override?.byMedia?.baidu?.outputDirs).toEqual(['D:/节点百度'])
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toBeUndefined()
  })
})

describe('中控台 · 渠道与尺寸分区（表格化，TB-060）', () => {
  it('画面方向默认「跟随尺寸」，在这里可以整批强制竖版', () => {
    render(<MediaSection />)
    expect(text()).toContain('画面方向')
    expect(usePostprocessMediaStore.getState().direction).toBeNull()

    clickByText('竖版')
    expect(usePostprocessMediaStore.getState().direction).toBe('portrait')

    clickByText('跟随尺寸')
    expect(usePostprocessMediaStore.getState().direction).toBeNull()
  })

  it('渠道表的「参与产出」开关写进 selectedMediaIds（决定这个渠道参不参与产出）', () => {
    render(<MediaSection />)
    clickByAriaLabel('参与产出：广点通')
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toContain('gdt')
  })

  it('渠道表与尺寸表直接可见、就地可编辑：不再需要先展开折叠的规格编辑器', () => {
    render(<MediaSection />)
    expect(container.querySelector('table[aria-label="渠道表"]')).toBeTruthy()
    expect(container.querySelector('table[aria-label="尺寸表"]')).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('input[placeholder="新渠道名称，如「抖音」"]')).toBeTruthy()
  })

  it('渠道名、尺寸数都落在列上（原卡片看板的信息一个没丢）', () => {
    const body = render(<MediaSection />)
    expect(body).toContain('广点通')
    expect(body).toContain('尺寸数')
    expect(body).toContain('横版')
  })

  it('⭐ 尺寸表一行一个渠道，详细尺寸是一组复选框（勾选 = 参与产出）', () => {
    // 2026-09-21 反馈：「详细尺寸使用复选框，尽可能排一行，放不下的排两行」。
    // 行 = 渠道，格子里横排复选框 —— 扫一眼就知道每个渠道配了哪几套、哪几套是开的。
    render(<MediaSection />)
    const table = container.querySelector<HTMLTableElement>('table[aria-label="尺寸表"]')!
    const channelCount = usePostprocessMediaStore.getState().media.filter((item) => item.id !== PURE_MEDIA_ID).length
    expect(table.querySelectorAll('tbody tr')).toHaveLength(channelCount)

    // 勾选按**可访问名称**定位（「渠道 宽×高 参与产出」），不受渲染顺序影响
    const box = container.querySelector<HTMLInputElement>('input[aria-label="广点通 1280×720 参与产出"]')
    expect(box?.checked).toBe(true)
    act(() => box!.click())
    const gdt = usePostprocessMediaStore.getState().media.find((item) => item.id === 'gdt')!
    expect(gdt.sizes.find((size) => size.id === 'gdt-1280x720')?.enabled).toBe(false)
  })

  it('⭐ 详细尺寸排不下就折行：格子是 flex-wrap 容器，尺寸多的渠道自己折到第二行', () => {
    render(<MediaSection />)
    const vendorCell = container.querySelector<HTMLElement>('[data-testid="size-checks-vendor"]')!
    expect(vendorCell.className).toContain('flex-wrap')
    const vendor = usePostprocessMediaStore.getState().media.find((item) => item.id === 'vendor')!
    expect(vendorCell.querySelectorAll('input[type="checkbox"]')).toHaveLength(vendor.sizes.length)
  })

  it('⭐ 点尺寸名展开详细编辑：改宽高 = 换一套尺寸，主键跟着换', () => {
    render(<MediaSection />)
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

  it('尺寸行的「+」是图标按钮：加尺寸就近加在这个渠道上', () => {
    render(<MediaSection />)
    clickByAriaLabel('给「头条」加一个尺寸')
    const toutiao = usePostprocessMediaStore.getState().media.find((item) => item.id === 'toutiao')!
    expect(toutiao.sizes.some((size) => size.width === 1024 && size.height === 1024)).toBe(true)
  })
})

describe('中控台 · 分发分区', () => {
  it('默认关闭时只留开关，不展开具体字段', () => {
    const body = render(<DistributionSection />)
    expect(body).toContain('启用分发')
    expect(body).not.toContain('分配天数')
  })

  it('开启后展开排期相关字段', () => {
    act(() => {
      usePostprocessMediaStore.getState().patchDistribution({ enabled: true })
    })
    const body = render(<DistributionSection />)
    expect(body).toContain('起始日期')
    expect(body).toContain('分配天数')
    expect(body).toContain('搬运方式')
    expect(body).toContain('重命名方式')
  })

  it('开了开关但日期不合法时给出原因，而不是静默什么都不做', () => {
    act(() => {
      usePostprocessMediaStore.getState().patchDistribution({ enabled: true })
    })
    const body = render(<DistributionSection />)
    expect(body).toContain('起始日期需填满 8 位数字')
  })
})
