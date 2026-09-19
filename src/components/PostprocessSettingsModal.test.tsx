/* @vitest-environment jsdom */

/**
 * 面板外壳走设计系统的 `Dialog`（portal 到 `document.body`），
 * 因此这里用 `react-dom/client` + 真实 DOM 查询 —— 与 `design-system/overlays.test.tsx`
 * 测 Dialog 的方式一致。`react-test-renderer` 不支持 portal 到真实 DOM 节点
 * （宿主配置会把 container 当成 `{ children: [] }`，对 `document.body` 调 `children.indexOf` 会抛错）。
 *
 * 2026-09-19 结构调整后本文件覆盖三件事：
 * 1. **左栏是纯树导航**——只有名称/展开/选中，没有任何参数控件与参数弹窗入口；
 * 2. **右栏是唯一参数面板**——按选中节点从 `paramSchema` 读字段渲染，切换节点同步刷新；
 * 3. 全局默认节点 → 写 store 基线；真实节点 → 写覆盖切片并标出继承来源。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetOverlayManager } from '../design-system/overlayManager'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { useCompositeV2Store } from '../features/composite/storeV2'
import { useProjectTreeParamsStore } from '../features/projectTree/storeProjectTreeParams'
import { DEFAULT_POSTPROCESS_NAME_PATTERN } from '../lib/postprocessNaming'
import type { AssetCollection } from '../types'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../storePostprocessMedia'
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

function findButton(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  const exact = buttons.find((node) => (node.textContent ?? '').trim() === label)
  const found = exact ?? buttons.find((node) => (node.textContent ?? '').includes(label))
  if (!found) throw new Error(`未找到按钮：${label}`)
  return found
}

/** 点左栏某个树节点（用 testid，避免与右栏里的同名文案混淆）。 */
function selectTreeNode(nodeId: string) {
  const node = document.querySelector<HTMLButtonElement>(`[data-testid="postprocess-tree-node-${nodeId}"]`)
  if (!node) throw new Error(`未找到树节点：${nodeId}`)
  act(() => node.click())
}

/** 展开某个树节点（点它的展开箭头）。 */
function expandTreeNode(name: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="展开 ${name}"]`)
  if (!button) throw new Error(`未找到展开按钮：${name}`)
  act(() => button.click())
}

/** 展开产品并选中它下面的方向节点。方向是叶子，没有展开箭头。 */
function selectDirectionNode() {
  expandTreeNode('机器人')
  selectTreeNode('direction-a')
}

/** 勾/取消勾某个媒体：媒体是 Checkbox（label 文本），不是 button。 */
function toggleMedia(label: string) {
  const input = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
    (node) => node.closest('label')?.querySelector('.ds-check__label')?.textContent === label,
  )
  if (!input) throw new Error(`未找到媒体复选框：${label}`)
  act(() => input.click())
}

/** 展开「默认输出目录」下的按渠道设置区（节点上默认收起）。 */
function expandChannelDirs() {
  const toggle = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((node) =>
    (node.textContent ?? '').includes('按渠道分别设置'),
  )
  if (!toggle) throw new Error('未找到「按渠道分别设置」展开按钮')
  act(() => toggle.click())
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
  useAssetLibraryStore.setState({ collections: COLLECTIONS })
  useProjectTreeParamsStore.setState({ params: {} })
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

describe('PostprocessSettingsModal — 左栏纯树导航', () => {
  it('左栏没有任何参数控件：没有复选框、没有「参数」入口、没有参数表格按钮', () => {
    render()
    const sidebar = document.body.querySelector('aside.ds-dialog-pane--sidebar')!
    expect(sidebar).toBeTruthy()

    // 树节点行里不再出现复选框（启用范围已移到右栏）
    expect(sidebar.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    // 不再有节点级「参数」按钮
    expect(sidebar.querySelector('button[aria-label^="设置"]')).toBeNull()
    // 不再有「参数表格」按钮
    expect(sidebar.querySelector('[data-testid="postprocess-open-tree-table"]')).toBeNull()
    // 也不再有「参数」文案的入口按钮
    expect(Array.from(sidebar.querySelectorAll('button')).map((b) => b.textContent?.trim())).not.toContain('参数表格')
  })

  it('左栏只展示节点名称与层级徽章', () => {
    const body = render()
    expect(body).toContain('智能客服')
    expect(body).toContain('产品线')
    // 产品线默认展开，产品可见
    expect(body).toContain('机器人')
    expect(body).toContain('产品')
    // 方向默认折叠，要展开产品才可见
    expect(body).not.toContain('竖版展示')
    expandTreeNode('机器人')
    expect(text()).toContain('竖版展示')
    expect(text()).toContain('方向')
  })

  it('「全局默认」是树根，作为默认选中项', () => {
    render()
    const globalNode = document.querySelector('[data-testid="postprocess-tree-node-global"]')
    expect(globalNode).toBeTruthy()
    expect(globalNode!.getAttribute('aria-current')).toBe('true')
    // 右栏随即显示全局编排分组
    expect(text()).toContain('全局编排')
  })

  it('支持展开与收起，收起后子节点消失', () => {
    render()
    expect(text()).toContain('机器人')
    const collapse = document.querySelector<HTMLButtonElement>('button[aria-label="收起 智能客服"]')
    expect(collapse).toBeTruthy()
    act(() => collapse!.click())
    expect(text()).not.toContain('机器人')
  })

  it('点击树节点切换选中态', () => {
    render()
    expandTreeNode('机器人')
    selectTreeNode('product-a')
    expect(
      document.querySelector('[data-testid="postprocess-tree-node-product-a"]')!.getAttribute('aria-current'),
    ).toBe('true')
    expect(
      document.querySelector('[data-testid="postprocess-tree-node-global"]')!.getAttribute('aria-current'),
    ).toBeNull()
  })

  it('项目勾选里出现已删除的 id 时给出跳过提示', () => {
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: ['ghost-project'] })
    })
    const body = render()
    expect(body).toContain('有 1 个已勾选的节点不存在或已删除')
  })
})

describe('PostprocessSettingsModal — 右栏参数详情面板', () => {
  it('未选中节点时展示空状态', () => {
    // 右栏默认选中「全局默认」。要走到空状态，只能让选中的节点在别处被删掉。
    // 先渲染并把某个节点选中，再把它从 collections 里移除。
    render()
    expandTreeNode('机器人')
    selectTreeNode('product-a')
    act(() => {
      useAssetLibraryStore.setState({ collections: COLLECTIONS.filter((item) => item.id !== 'product-a') })
    })
    expect(text()).toContain('节点已被删除')
  })

  it('切换树节点时右栏同步刷新：节点专属字段出现，全局专属字段消失', () => {
    render()
    // 全局默认：有媒体表与全局编排分组
    expect(text()).toContain('全局编排')
    selectDirectionNode()
    // 节点上：全局编排分组消失（媒体表 / 产出预览不再渲染），节点专属分组出现
    expect(text()).not.toContain('全局编排')
    expect(text()).toContain('参与方式')
    expect(text()).toContain('参与自动后处理')
    expect(text()).toContain('产出规格')
  })

  it('全局默认节点上的方向按钮写 store 基线', () => {
    render()
    act(() => {
      findButton('竖版').click()
    })
    expect(usePostprocessMediaStore.getState().direction).toBe('portrait')
    act(() => {
      findButton('跟随尺寸').click()
    })
    expect(usePostprocessMediaStore.getState().direction).toBeNull()
  })

  it('节点上的方向按钮写覆盖切片，而不是改全局基线', () => {
    render()
    selectDirectionNode()
    act(() => {
      findButton('竖版').click()
    })
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.direction).toBe('portrait')
    // 全局基线不动
    expect(usePostprocessMediaStore.getState().direction).toBeNull()
  })

  it('已编辑的参数在切换节点后仍然保留（写回节点数据）', () => {
    render()
    selectDirectionNode()
    act(() => {
      findButton('竖版').click()
    })
    // 切到另一个节点再切回来
    selectTreeNode('line-a')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.direction).toBe('portrait')
    selectTreeNode('direction-a')
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.direction).toBe('portrait')
  })

  it('节点上未覆盖的字段标出来源，覆盖过的标「本级自定义」并提供恢复继承', () => {
    render()
    selectDirectionNode()
    expect(text()).toContain('继承自全局默认')
    act(() => {
      findButton('竖版').click()
    })
    expect(text()).toContain('本级自定义')
    act(() => {
      findButton('恢复继承').click()
    })
    expect(useProjectTreeParamsStore.getState().params['direction-a']?.postprocess?.direction).toBeUndefined()
  })

  it('媒体勾选在全局写基线、在节点写覆盖', () => {
    render()
    toggleMedia('广点通')
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toContain('gdt')

    selectDirectionNode()
    toggleMedia('百度')
    const override = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess
    expect(override?.selectedMediaIds).toContain('baidu')
    // 全局仍然只有 gdt（节点覆盖不回流到基线）
    expect(usePostprocessMediaStore.getState().selectedMediaIds).not.toContain('baidu')
  })

  it('命名模板的未知/缺失占位符会给出提示', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{date}-{oops}')
    })
    const body = render()
    expect(body).toContain('不认识的占位符：{oops}')
    expect(body).toContain('缺少占位符：{seq}')
  })

  it('命名模板可以清空回默认值（留空 = 用默认模板）', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{seq}')
    })
    render()
    const input = document.querySelector<HTMLInputElement>('[data-testid="name-pattern-input"]')!
    expect(input.value).toBe('{seq}')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 清空后 store 里落的是默认模板（`NamePatternField` 的语义：空 = 默认）
    const next = usePostprocessMediaStore.getState().namePattern
    expect(next === '' || next === DEFAULT_POSTPROCESS_NAME_PATTERN).toBe(true)
  })

  it('媒体表在节点上不渲染，在全局渲染', () => {
    render()
    expect(text()).toContain('媒体表')
    selectDirectionNode()
    expect(text()).not.toContain('恢复内置')
  })

  it('产出预览在全局渲染并按配置展开文件名', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const body = render()
    expect(body).toContain('每张原图产出 2 个文件')
    expect(body).toContain('纯净版')
    expect(body).toContain('广点通')
    expect(body).toContain('横版')
  })

  it('方向不可预知（auto）时预览退化到示例尺寸', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const body = render('auto')
    // 预览按 1024x1024 展开（示例尺寸），产出数与方向无关
    expect(body).toContain('每张原图产出')
  })

  it('水印归属只读展示，不提供第二个编辑入口', () => {
    act(() => {
      useProjectTreeParamsStore.setState({
        params: { 'direction-a': { postprocess: { watermarkPresetIds: ['preset-a'] } } },
      })
    })
    render()
    selectDirectionNode()
    expect(text()).toContain('水印归属')
    expect(text()).toContain('糖包水印')
    expect(text()).not.toContain('一个都不勾 = 不叠水印')
  })

  it('水印引用已删除预设时标出数量', () => {
    act(() => {
      useProjectTreeParamsStore.setState({
        params: { 'direction-a': { postprocess: { watermarkPresetIds: ['preset-ghost'] } } },
      })
    })
    render()
    selectDirectionNode()
    expect(text()).toContain('1 套已删除')
  })

  it('没有水印归属时给出指路文案', () => {
    render()
    expect(text()).toContain('当前不叠水印')
  })
})

describe('PostprocessSettingsModal — 媒体表管理区', () => {
  it('全局默认节点上可以增删渠道（原先只有 store action、没有入口）', () => {
    render()
    const input = document.querySelector<HTMLInputElement>('input[placeholder="新渠道名称，如「抖音」"]')
    expect(input).toBeTruthy()
  })

  it('渲染已有渠道与尺寸数，并支持展开尺寸', () => {
    const body = render()
    expect(body).toContain('广点通')
    expect(body).toContain('百度')
    expect(body).toContain('恢复内置')
    // 「尺寸」是每个渠道行的展开按钮；点开第一个渠道后应出现该渠道的尺寸编辑行
    const sizeButtons = document.querySelectorAll<HTMLButtonElement>('[data-testid^="media-sizes-toggle-"]')
    expect(sizeButtons.length).toBeGreaterThan(0)
    act(() => sizeButtons[0].click())
    expect(text()).toContain('添加尺寸')
  })

  it('能改渠道名（写回 store）', () => {
    render()
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
    const nameInput = inputs.find((node) => node.value === '广点通')
    if (!nameInput) throw new Error('未找到渠道名输入框：广点通')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(nameInput, '腾讯广告')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(usePostprocessMediaStore.getState().media.find((item) => item.id === 'gdt')?.name).toBe('腾讯广告')
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
    const labelId = document.body.querySelector('[role="dialog"]')!.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId!)!.textContent).toBe('后处理')
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

  it('外壳是 80% 双栏工作区，左栏为 sidebar 语义', () => {
    render()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.classList.contains('ds-dialog--postprocess')).toBe(true)
    expect(dialog.querySelector('.ds-dialog-workspace--split')).toBeTruthy()
    expect(dialog.querySelector('aside.ds-dialog-pane--sidebar')).toBeTruthy()
  })
})

describe('命名模板变量与渠道导出位置', () => {
  /** 受控 input 的写入要过原生 setter，否则 React 的 value 追踪器认为没变、不触发 onChange */
  function typeInto(selector: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(selector)
    if (!input) throw new Error(`未找到输入框：${selector}`)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('变量按钮显示中文名，而不是英文占位符', () => {
    render()
    const labels = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid^="name-token-"]')).map(
      (node) => (node.textContent ?? '').trim(),
    )
    expect(labels).toContain('日期')
    expect(labels).toContain('序号')
    expect(labels).toContain('水印预设')
    expect(labels.some((label) => label.includes('{'))).toBe(false)
    expect(document.querySelector('[data-testid="name-token-date"]')!.getAttribute('title')).toContain('{date}')
  })

  it('变量插在光标所在处，而不是默认追加到末尾', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{seq}')
    })
    render()
    const input = document.querySelector<HTMLInputElement>('[data-testid="name-pattern-input"]')!
    expect(input.value).toBe('{seq}')
    input.setSelectionRange(0, 0)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
    })
    act(() => {
      findButton('日期').click()
    })
    expect(usePostprocessMediaStore.getState().namePattern).toBe('{date}{seq}')
  })

  it('渠道行可以加第二个位置（双写），两个路径都写进配置', () => {
    render()
    expandChannelDirs()
    typeInto('[data-testid="channel-output-dir-baidu-0"]', 'D:/百度一')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度一'])

    const add = document.querySelector<HTMLButtonElement>('[data-testid="channel-output-add-baidu"]')!
    expect(add).toBeTruthy()
    act(() => add.click())

    typeInto('[data-testid="channel-output-dir-baidu-1"]', 'D:/百度二')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度一', 'D:/百度二'])
  })

  it('没填位置的渠道不进配置（留空 = 用默认输出位置）', () => {
    render()
    expect(usePostprocessMediaStore.getState().mediaOutputDirs).toEqual({})
  })

  it('节点上的渠道位置写进 byMedia，而不是全局渠道表', () => {
    render()
    selectDirectionNode()
    expandChannelDirs()
    typeInto('[data-testid="channel-output-dir-baidu-0"]', 'D:/节点百度')
    const override = useProjectTreeParamsStore.getState().params['direction-a']?.postprocess
    expect(override?.byMedia?.baidu?.outputDirs).toEqual(['D:/节点百度'])
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toBeUndefined()
  })
})

describe('分发配置区', () => {
  it('默认关闭时只留开关，不展开具体字段', () => {
    const body = render()
    expect(body).toContain('启用分发')
    expect(body).not.toContain('分配天数')
  })

  it('开启后展开排期相关字段', () => {
    act(() => {
      usePostprocessMediaStore.getState().patchDistribution({ enabled: true })
    })
    const body = render()
    expect(body).toContain('起始日期')
    expect(body).toContain('分配天数')
    expect(body).toContain('搬运方式')
    expect(body).toContain('重命名方式')
  })

  it('开了开关但日期不合法时给出原因，而不是静默什么都不做', () => {
    act(() => {
      usePostprocessMediaStore.getState().patchDistribution({ enabled: true })
    })
    const body = render()
    expect(body).toContain('起始日期需填满 8 位数字')
  })
})
