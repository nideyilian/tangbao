/* @vitest-environment jsdom */

/**
 * 后处理弹窗（2026-09-20 收窄为「当前方向的后处理参数」）。
 *
 * 本文件覆盖四件事：
 * 1. **作用范围跟随全局上下文指针**（`useAssetLibraryStore.scope`）——没有「本弹窗自己的选择态」；
 * 2. **没有全局作用域**：下拉里没有「全局默认」，指针不在任何节点上时给引导态而不是回落全局；
 * 3. **面板只渲染方向级参数**：全局独有参数（渠道与尺寸、画面方向、命名模板、分发…）不出现；
 * 4. 方向级写入路径：`enabled` / `outputDir`(+`byMedia`) / 水印归属只读。
 * 全局参数的编辑入口在中控台，对应用例在
 * `features/composite/components/ConsolePostprocessSections.test.tsx`。
 *
 * 面板外壳走设计系统的 `Dialog`（portal 到 `document.body`），因此这里用 `react-dom/client`
 * + 真实 DOM 查询 —— 与 `design-system/overlays.test.tsx` 测 Dialog 的方式一致。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetOverlayManager } from '../design-system/overlayManager'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { useCompositeV2Store } from '../features/composite/storeV2'
import { DEFAULT_CONTROL_CONSOLE_SECTION } from '../features/composite/lib/controlConsoleSections'
import { useProjectTreeParamsStore } from '../features/projectTree/storeProjectTreeParams'
import type { AssetCollection } from '../types'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../storePostprocessMedia'
import { useStore } from '../store'
import PostprocessSettingsModal from './PostprocessSettingsModal'

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

/** 面板内容在 portal 里，读取整页文本（container 本身是空的） */
function text(): string {
  return document.body.textContent ?? ''
}

/**
 * 只读**参数区**的文本。
 *
 * 不能拿整页文本来断言「某个词没出现」—— Dialog 的描述里会点明全局参数去哪改
 * （渠道与尺寸、画面方向、命名模板、分发），那是说明而不是入口。
 */
function panelText(): string {
  const workspace = document.body.querySelector('.ds-dialog-workspace')
  if (!workspace) throw new Error('未找到弹窗工作区')
  return workspace.textContent ?? ''
}

function findButton(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  const exact = buttons.find((node) => (node.textContent ?? '').trim() === label)
  const found = exact ?? buttons.find((node) => (node.textContent ?? '').includes(label))
  if (!found) throw new Error(`未找到按钮：${label}`)
  return found
}

/** 改「作用范围」下拉的值并派发 change（React 受控组件监听原生 change，`bubbles: true` 才能被委托到） */
function selectScope(value: string) {
  const select = document.body.querySelector<HTMLSelectElement>('select')
  if (!select) throw new Error('未找到作用范围下拉')
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** 把全局上下文指针指到某个节点（等价于在素材库 / 中控台点了那个方向） */
function pointScopeAt(collectionId: string | null) {
  act(() => {
    useAssetLibraryStore.getState().setCollectionContextScope(collectionId)
  })
}

/**
 * 「按渠道的导出位置」**默认就是展开的**（杰哥 2026-09-20「输出位置不要折叠」）。
 *
 * 断言本身就是回归：折叠态下这张表只有点开之后才存在，
 * 用户得先点一次才能核对各渠道到底存到哪 —— 那正是被报障的形态。
 */
function expectChannelDirsVisible() {
  if (!document.querySelector('table[aria-label="按渠道设置导出位置"]')) {
    throw new Error('按渠道的导出位置默认没有展开（输出位置应当是展开态）')
  }
}

/**
 * 写「按渠道」表格的某个单元格并**提交**。
 *
 * 表格走 `DataGrid`，单元格是**草稿态**：输入期间只改本地 draft，失焦或回车才提交
 * （直接受控会在用户删空输入框的瞬间回填成原值，数字根本改不了）。
 * 所以测试写完必须 blur，否则库里什么都不会变 —— 这不是 bug，是刻意的。
 *
 * 无障碍名称形如「导出位置：百度」（`DataGrid` 用「列名：行标签」拼）。
 */
function commitGridCell(cellLabel: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${cellLabel}"]`)
  if (!input) throw new Error(`未找到表格单元格：${cellLabel}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  // 必须先 focus：jsdom 里 `blur()` 只在元素是激活元素时才派发 blur 事件，
  // 不先聚焦的话「失焦提交」永远不会发生。
  act(() => input.focus())
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.blur())
}

function render(sourceSize = '1280x720', onClose: () => void = () => {}) {
  act(() => {
    root.render(<PostprocessSettingsModal sourceSize={sourceSize} onClose={onClose} />)
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
  // 默认「没选方向」（指针 = 全部）：专门的用例再把它指到某个节点上
  useAssetLibraryStore.setState({ collections: COLLECTIONS, scope: 'all', selectedAssetIds: [] })
  useProjectTreeParamsStore.setState({ params: {} })
  useStore.setState({
    appMode: 'gallery',
    controlConsoleSection: DEFAULT_CONTROL_CONSOLE_SECTION,
    // 项目树工作台是一次性意图：不重置会让「跳过去要带上焦点」那条用例污染别的用例
    projectTreeWorkbench: { open: false, focusId: null },
  })
  useCompositeV2Store.setState({
    presets: [
      {
        id: 'preset-a',
        name: '糖包水印',
        baseCanvas: { width: 100, height: 100 },
        sampleBackgroundPath: '',
        layers: [],
        updatedAt: 1,
      },
    ],
  })
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
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('PostprocessSettingsModal — 作用范围跟随全局上下文指针', () => {
  it('打开就落在「当前方向」上，不需要先选', () => {
    pointScopeAt('direction-a')
    const body = render()
    expect(body).toContain('竖版展示')
    expect(body).toContain('输出目录')
    expect(body).not.toContain('还没有选中方向')
  })

  it('下拉里没有「全局默认」这个作用域', () => {
    pointScopeAt('direction-a')
    render()
    const options = Array.from(document.querySelectorAll<HTMLOptionElement>('select option'))
    expect(options.map((option) => option.textContent)).not.toContain('全局默认')
    expect(options.some((option) => (option.textContent ?? '').includes('全局默认'))).toBe(false)
    // 项目树上的每一层都在，且用「层级：路径」消歧
    expect(options.map((option) => option.textContent)).toContain('方向：智能客服 / 机器人 / 竖版展示')
  })

  it('⭐ 指针不在任何节点上时给选方向的引导，而不是回落显示全局参数', () => {
    const body = render()
    expect(body).toContain('还没有选中方向')
    // 全局独有参数一个都不能出现（这正是「不要全局设置」的验收口径）
    const panel = panelText()
    for (const globalOnly of ['媒体表', '命名模板', '创作者', '画面方向', '全局编排', '产出预览']) {
      expect(panel, `引导态里不该出现全局参数「${globalOnly}」`).not.toContain(globalOnly)
    }
  })

  it('在下拉里换方向 = 写回同一个上下文指针，且不动素材库的选中态', () => {
    act(() => {
      useAssetLibraryStore.setState({ selectedAssetIds: ['asset-1'] })
    })
    pointScopeAt('direction-a')
    render()
    selectScope('product-a')
    expect(useAssetLibraryStore.getState().scope).toEqual({ kind: 'collection', id: 'product-a' })
    // `setScope`（会清空选中态）与 `setCollectionContextScope` 是两件事，换方向不该影响选中
    expect(useAssetLibraryStore.getState().selectedAssetIds).toEqual(['asset-1'])
  })

  it('指针指向的节点已被删除时按「没选方向」处理，不崩', () => {
    act(() => {
      useAssetLibraryStore.setState({ scope: { kind: 'collection', id: 'ghost' } })
    })
    const body = render()
    expect(body).toContain('还没有选中方向')
  })

  it('已启用的节点缺失时给出跳过提示', () => {
    pointScopeAt('direction-a')
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: ['ghost-project'] })
    })
    expect(render()).toContain('有 1 个已启用的节点不存在或已删除')
  })
})

describe('PostprocessSettingsModal — 方向级参数面板', () => {
  beforeEach(() => pointScopeAt('direction-a'))

  it('只有方向级的三个分组，全局独有参数一律不出现', () => {
    const body = render()
    // 三段各由它的字段名自报家门（分组标题 2026-09-21 起不再渲染）
    expect(body).toContain('自动后处理')
    expect(body).toContain('输出目录')
    expect(body).toContain('水印归属')
    const panel = panelText()
    for (const globalOnly of ['媒体表', '命名模板', '创作者', '画面方向', '分发', '纯净版自动伴随', '产出预览']) {
      expect(panel, `全局独有参数「${globalOnly}」不该出现在方向面板里`).not.toContain(globalOnly)
    }
  })

  it('参与方式开关写进本级的 enabled 覆盖', () => {
    render()
    // 按**可访问名称**定位，不用「DOM 里第一个 checkbox」—— 后者依赖渲染顺序，
    // 顺序一变就点到别的控件上（本用例在多文件同跑时曾偶发失败）。
    const toggle = document.querySelector<HTMLInputElement>('input[aria-label="自动后处理"]')
    if (!toggle) throw new Error('未找到自动后处理开关')
    act(() => toggle.click())
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.enabled).toBe(false)
  })

  it('⭐ 字段行走 12 列栅格：标签槽与控件槽成对，间距取自标尺', () => {
    // jsdom 不做布局计算，所以这里断的是**契约**：列模板与间距由栅格类 + token 变量决定，
    // 而不是靠内容宽度碰运气。对齐本身（控件左边界成一条线）由 `.ds-form-grid__*` 的
    // `grid-column: span N` 保证 —— 只要「成对 + 同模板」，对齐就是确定的。
    render()
    const grids = Array.from(document.querySelectorAll<HTMLElement>('.ds-form-grid'))
    expect(grids).toHaveLength(3) // 三个分组各一张
    for (const grid of grids) {
      expect(grid.style.columnGap).toBe('var(--ds-space-5)') // 标签列↔控件列 20px
      expect(grid.style.rowGap).toBe('var(--ds-space-4)') // 字段行之间 16px

      // 每个分组的布局只有两种合法形态：
      // ① 两槽成对（标签槽数 === 控件槽数，漏一个就会出现半行空洞）；
      // ② 整行式（`layout: 'inline' | 'full'` 的字段，跨满 12 列，不产生两槽）。
      const labels = grid.querySelectorAll('.ds-form-grid__label')
      const controls = grid.querySelectorAll('.ds-form-grid__control')
      const fulls = grid.querySelectorAll('.ds-form-grid__full')
      expect(labels.length + fulls.length).toBeGreaterThan(0)
      expect(labels.length).toBe(controls.length)
    }
  })

  it('⭐ 参与方式是整行式：标签、说明、开关同一行（一个开关不该占两行）', () => {
    render()
    const row = Array.from(document.querySelectorAll<HTMLElement>('.ds-form-grid__full')).find((node) =>
      node.textContent?.includes('自动后处理'),
    )
    expect(row).toBeTruthy()
    // 同一行里同时有标签、说明与控件
    expect(row!.textContent).toContain('关闭后不产出变体')
    expect(row!.querySelector('input[role="switch"]')).toBeTruthy()
    // 这一组不产生「标签槽 / 控件槽」，所以字段行的高度就是一行
    const grid = row!.closest('.ds-form-grid')!
    expect(grid.querySelectorAll('.ds-form-grid__label')).toHaveLength(0)
  })

  it('⭐ 视觉层级：字段名 14/500、帮助文本 12，且状态行不再是第二个「框」', () => {
    render()
    // 字段名：正文默认字号 + 标签字重（MASTER 4.3）
    const fieldName = Array.from(document.querySelectorAll('.ds-form-grid__label span')).find(
      (node) => node.textContent === '输出目录',
    )
    expect(fieldName?.className).toContain('text-sm')
    expect(fieldName?.className).toContain('font-medium')

    // 状态行用 1px 分隔线而不是 Surface 卡片：面板里除 Fieldset 之外不该再出现「框」，
    // 否则它与分组框层级相同，用户分不出「哪个是能改的」。
    const workspace = document.body.querySelector('.ds-dialog-workspace')!
    expect(workspace.querySelector('.ds-surface')).toBeNull()
  })

  it('⭐ 分组不再有卡片与标题：三段之间只用 1px 分隔线（卡片标题「一点用都没有」）', () => {
    // 2026-09-21 反馈：「我已经明确说了用一行」「每个卡片的标题全部去掉」。
    // 原先三个 `Fieldset` 的 legend 各占一行，一个开关就吃掉两行高度，
    // 而且三组框彼此同级、与顶部的状态行也分不出主次（MASTER §5.9 禁止 DialogPane 里套大卡片）。
    render()
    expect(document.querySelectorAll('fieldset.ds-fieldset')).toHaveLength(0)
    expect(document.querySelectorAll('legend')).toHaveLength(0)

    // 三组分段 → 两条分隔线。字段名（自动后处理 / 输出目录 / 水印归属）自己说清这一段是什么。
    const workspace = document.body.querySelector('.ds-dialog-workspace')!
    expect(workspace.querySelectorAll('hr.ds-divider')).toHaveLength(2)
  })

  it('⭐ 状态行只说一次（原先 footer 与面板各写一句同样的话）', () => {
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: ['direction-a'] })
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const body = render()
    expect(body.match(/每张原图产出/g)?.length).toBe(1)
  })

  it('输出目录：默认标继承来源，写覆盖后标本级自定义，可恢复继承', () => {
    render()
    expect(text()).toContain('继承自全局默认')

    act(() => {
      useProjectTreeParamsStore.getState().setPostprocessOverride('direction-a', { outputDir: 'D:/方向级' })
    })
    expect(text()).toContain('本级自定义')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.outputDir).toBe('D:/方向级')

    act(() => findButton('恢复继承').click())
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.outputDir).toBeUndefined()
  })

  it('⭐ 宽度契约：撑开必须落在输入框容器上，开关容器必须收紧（否则右侧留一大片空）', () => {
    // jsdom 不做布局计算，量不出像素，所以这里钉的是**结构性契约**——
    // 它正好是那个真实 bug：`flex-1` 写到了 `className`（落到内层 <input>）而不是
    // `containerClassName`（外层 `display:grid` 的 `.ds-field`），输入框就按内容宽度定死，
    // 右边空出 700px。`Switch` 则是 `justify-content: space-between`，容器一撑开就被甩到最右。
    //
    // 渠道目录那一列不在此列：它走 `DataGrid`，列宽由表格自己管（不靠 flex 撑）。
    render()
    const outputDirField = document
      .querySelector<HTMLInputElement>('input[aria-label="输出目录"]')
      ?.closest('.ds-field')
    expect(outputDirField?.className).toContain('flex-1')

    const switchWrapper = document.querySelector('input[role="switch"]')!.closest('.ds-switch')!.parentElement!
    expect(switchWrapper.className).toContain('w-fit')
  })

  it('渠道位置写进本级的 byMedia，而不是全局渠道表', () => {
    render()
    expectChannelDirsVisible()
    commitGridCell('导出位置：百度', 'D:/节点百度')
    const override = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess
    expect(override?.byMedia?.baidu?.outputDirs).toEqual(['D:/节点百度'])
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toBeUndefined()
  })

  it('⭐ 输出位置的渠道行默认展开（不再藏在「按渠道分别设置」后面）', () => {
    render()
    // 展开态的两个标志：渠道名直接可见、没有那个折叠开关
    expectChannelDirsVisible()
    const labels = Array.from(document.querySelectorAll('button')).map((node) => node.textContent ?? '')
    expect(labels.some((label) => label.includes('按渠道分别设置'))).toBe(false)
    expect(panelText()).toContain('广点通')
  })

  it('⭐ 渠道目录是 DataGrid：表头说清每列，一行一个渠道', () => {
    // 「渠道 × 位置」是行列数据，交给设计系统的 `DataGrid`（TB-060）——
    // 列定义同时驱动界面编辑与将来的导入导出，路径列还自带「选择目录」按钮。
    render()
    const table = document.querySelector<HTMLTableElement>('table[aria-label="按渠道设置导出位置"]')!
    expect(table).toBeTruthy()

    const headers = Array.from(table.querySelectorAll('th')).map((node) => node.textContent?.trim())
    expect(headers).toEqual(['渠道', '导出位置', '操作'])

    const mediaCount = usePostprocessMediaStore.getState().media.length
    expect(table.querySelectorAll('tbody tr')).toHaveLength(mediaCount)
  })

  it('⭐ 渠道表跨整行（8 列的控件槽放不下它，会把路径截断）', () => {
    render()
    const table = document.querySelector<HTMLTableElement>('table[aria-label="按渠道设置导出位置"]')!
    // 它必须落在跨行槽里 —— 控件槽窄到读不了中文路径（实测截成 `\192.168.202.:`）
    expect(table.closest('.ds-form-grid__full')).toBeTruthy()
    expect(table.closest('.ds-form-grid__control')).toBeNull()
  })

  it('⭐ 出现第二个位置时该渠道多一行、渠道格跨两行，而不是右边多一列', () => {
    act(() => {
      useProjectTreeParamsStore.setState({
        params: {
          'direction-a': {
            postprocess: { byMedia: { baidu: { outputDirs: ['D:/一', 'D:/二'] } } },
          },
        },
      })
    })
    render()
    const table = document.querySelector<HTMLTableElement>('table[aria-label="按渠道设置导出位置"]')!

    // 列数不随位置数增长 —— 往右加列会把「导出位置」这一列挤窄，而中文共享盘路径
    // 正是这一屏唯一要看清的东西（2026-09-21 改版的原因）
    const headers = Array.from(table.querySelectorAll('th')).map((node) => node.textContent?.trim())
    expect(headers).toEqual(['渠道', '导出位置', '操作'])

    // 百度那一组占两行：渠道名只在第一行出现，且跨两行（Excel 的合并单元格）
    const mediaCount = usePostprocessMediaStore.getState().media.length
    expect(table.querySelectorAll('tbody tr')).toHaveLength(mediaCount + 1)
    const merged = table.querySelector<HTMLTableCellElement>('td[rowspan="2"]')
    expect(merged?.textContent?.trim()).toBe('百度')
  })

  it('没填位置的渠道不进配置（留空 = 继承上级）', () => {
    render()
    expect(useProjectTreeParamsStore.getState().params['direction-a']).toBeUndefined()
  })

  it('⭐ 水印顶部一行：参数文案 + 按渠道 tab + 跳转入口，全在同一行里', () => {
    act(() => {
      useProjectTreeParamsStore.setState({
        params: { 'direction-a': { postprocess: { watermarkPresetIds: ['preset-a', 'preset-ghost'] } } },
      })
    })
    const body = render()
    expect(body).toContain('水印归属')
    expect(body).toContain('只读。')
    expect(body).toContain('去中控台配水印')

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const mediaCount = usePostprocessMediaStore.getState().media.length
    expect(tabs).toHaveLength(mediaCount)
    expect(tabs[0].textContent).toContain('广点通')

    // 文案与 tab 必须在**同一个容器**里（上一版把文案留在左侧标签列、tab 挤在控件列，
    // 于是文案一行、tab 又一行 —— 正是被报障的「两行」形态）
    const row = tabs[0].closest('.ds-inline')
    expect(row?.textContent).toContain('水印归属')
    expect(row?.textContent).toContain('只读。')

    // 默认看第一个渠道：预览区给状态文字（画面由渲染器画，jsdom 量不到像素）
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(body).toContain('叠 1 套水印')
    // 悬空 id 不能静默咽掉，否则用户以为还叠着那套水印
    expect(body).toContain('1 套预设已删除')

    // 切换 tab → 选中态跟着走，预览换到那个渠道
    act(() => tabs[tabs.length - 1].click())
    expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
  })

  it('⭐ 水印下方是 16:9 的横版预览区（水印叠在画面上，横版才看得出压边与占位）', () => {
    render()
    const stage = document.querySelector<HTMLElement>('[data-testid="watermark-stage"]')!
    expect(stage).toBeTruthy()
    // 浏览器会把 `aspect-ratio: 1.777…` 规范化成 `1.777… / 1`，所以按前缀比而不是全等
    expect(stage.style.aspectRatio).toMatch(/^16\s*\/\s*9|^1\.777/)
  })

  it('没有水印归属时：tab 照旧列出所有渠道，预览区明说不叠', () => {
    const body = render()
    expect(body).toContain('不叠水印')
    // tab 不因为「没水印」就消失 —— 用户要能看到每个渠道的状态
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(usePostprocessMediaStore.getState().media.length)
    // 指路只在同一行右侧的按钮上（「去中控台配水印」），字段说明不再复述一遍
    expect(body.match(/水印归属」树/g)?.length ?? 0).toBe(0)
  })

  it('⭐ 顶部「不在启用范围」的提示能真的跳到项目树那一行', () => {
    // 场景：这个方向没在项目树的「后处理」列勾选 → 参数照常保存，但图片不产出变体。
    // 原先只写一句「请在项目树里勾选」，用户得自己回素材库、点「项目树」、再翻几十行。
    render()
    expect(panelText()).toContain('未启用后处理')

    act(() => findButton('去项目树启用').click())

    const workbench = useStore.getState().projectTreeWorkbench
    expect(workbench.open).toBe(true)
    // 必须带上焦点节点：工作台用它预填搜索，否则跳过去还是要自己找那一行
    expect(workbench.focusId).toBe('direction-a')
    // 工作台挂在资产库工具栏里 —— 不切模式的话它根本不渲染，等于跳了个寂寞
    expect(useStore.getState().appMode).toBe('gallery')
  })

  it('不在启用范围内的方向给出警告（启用范围在项目树里勾）', () => {
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: [] })
    })
    expect(render()).toContain('未启用后处理')
  })
})

describe('PostprocessSettingsModal — 底部产出数', () => {
  beforeEach(() => pointScopeAt('direction-a'))

  it('算的是当前方向的产出数', () => {
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: ['direction-a'] })
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    expect(render()).toContain('每张原图产出')
  })

  it('没有启用任何范围时指路到项目树，而不是显示产出数', () => {
    expect(render()).toContain('未启用后处理。')
  })
})

describe('PostprocessSettingsModal — 跳转到中控台（不能在这里改的参数要有出口）', () => {
  beforeEach(() => pointScopeAt('direction-a'))

  it('footer 的「去中控台改全局规格」写下跳转意图并切到中控台工作区', () => {
    render()
    act(() => findButton('去中控台改全局规格').click())
    // 只切工作区不写意图 = 跳过去落在默认分区（水印），等于没跳
    expect(useStore.getState().controlConsoleSection).toBe('media')
    expect(useStore.getState().appMode).toBe('postprocess')
  })

  it('水印分组头给「去中控台配水印」（只读项必须指出下一步，且真的能到）', () => {
    // 先把分区放在别处：否则「写没写 watermark」和「什么都没写」都是 watermark，测不出区别
    useStore.setState({ controlConsoleSection: 'media' })
    render()
    act(() => findButton('去中控台配水印').click())
    expect(useStore.getState().controlConsoleSection).toBe('watermark')
    expect(useStore.getState().appMode).toBe('postprocess')
  })
})

describe('PostprocessSettingsModal — 弹窗外壳走设计系统 Dialog', () => {
  it('挂载为 portal 到 body 的模态对话框', () => {
    render()
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog!.getAttribute('aria-modal')).toBe('true')
    expect(dialog!.classList.contains('ds-dialog')).toBe(true)
    expect(document.body.querySelector('.ds-modal-surface')).toBeNull()
  })

  it('标题与描述由 Dialog 的 header 提供', () => {
    render()
    const dialog = document.body.querySelector('[role="dialog"]')!
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId!)!.textContent).toBe('后处理')
    // 描述只说两句短话：继承规则 + 全局去哪改（面板里的字段各自只讲自己）
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)!.textContent).toContain('向上继承')
  })

  it('ESC 关闭交给 overlay 栈处理', () => {
    const onClose = vi.fn()
    render('1280x720', onClose)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('点击遮罩关闭（按下即在遮罩上才判定）', () => {
    const onClose = vi.fn()
    render('1280x720', onClose)
    const layer = document.body.querySelector('.ds-dialog-layer')
    expect(layer).toBeTruthy()
    act(() => {
      layer!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('外壳是单栏工作区：没有 sidebar 栏位', () => {
    render()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.classList.contains('ds-dialog--postprocess')).toBe(true)
    expect(dialog.querySelector('.ds-dialog-workspace--split')).toBeNull()
    expect(dialog.querySelector('aside.ds-dialog-pane--sidebar')).toBeNull()
    expect(dialog.querySelector('.ds-dialog-workspace--single')).toBeTruthy()
  })
})
