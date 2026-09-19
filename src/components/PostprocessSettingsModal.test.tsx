/* @vitest-environment jsdom */

/**
 * 面板外壳走设计系统的 `Dialog`（portal 到 `document.body`），
 * 因此这里用 `react-dom/client` + 真实 DOM 查询 —— 与 `design-system/overlays.test.tsx`
 * 测 Dialog 的方式一致。`react-test-renderer` 不支持 portal 到真实 DOM 节点
 * （宿主配置会把 container 当成 `{ children: [] }`，对 `document.body` 调 `children.indexOf` 会抛错）。
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

function findButton(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  const exact = buttons.find((node) => (node.textContent ?? '').trim() === label)
  const found = exact ?? buttons.find((node) => (node.textContent ?? '').includes(label))
  if (!found) throw new Error(`未找到按钮：${label}`)
  return found
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

describe('PostprocessSettingsModal', () => {
  it('默认展示核心提示与空预览状态', () => {
    const body = render()
    expect(body).toContain('勾选项目 = 启用自动后处理的范围')
    expect(body).toContain('未满足启用条件：需同时勾选启用范围与媒体')
    expect(body).toContain('勾选启用范围与媒体后显示产出清单。')
  })

  it('渲染项目树的层级标签与投影', () => {
    const body = render()
    expect(body).toContain('智能客服')
    expect(body).toContain('产品线')
    // 产品线默认展开，产品可见；方向要先展开产品
    expect(body).toContain('机器人')
    expect(body).toContain('产品')
  })

  it('勾选项目与媒体后展示变体数与文件名预览', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const body = render()
    // 1280x720 → 横版；gdt 只有 1280x720 横版尺寸；勾了渠道 → 自动伴随纯净版
    expect(body).toContain('1 个启用节点，共 2 个变体')
    expect(body).toContain('每张原图产出 2 个文件')
    expect(body).toContain('纯净版')
    expect(body).toContain('广点通')
    expect(body).toContain('横版')
  })

  it('媒体行只读展示尺寸与体积上限', () => {
    const body = render()
    expect(body).toContain('1280x720')
    expect(body).toContain('≤399KB')
  })

  it('停用的媒体显示为已停用且勾选框禁用', () => {
    act(() => {
      usePostprocessMediaStore.getState().setMediaEnabled('gdt', false)
    })
    render()
    expect(text()).toContain('已停用')
    const disabledCheckbox = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (node) => node.disabled,
    )
    expect(disabledCheckbox).toBeTruthy()
  })

  it('全选按钮勾上全部启用媒体并保留纯净版', () => {
    render()
    act(() => {
      findButton('全选').click()
    })
    const selected = usePostprocessMediaStore.getState().selectedMediaIds
    expect(selected).toContain('clean')
    expect(selected).toEqual(expect.arrayContaining(['gdt', 'baidu', 'vendor', 'toutiao']))
  })

  it('方向按钮写入 store', () => {
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

  it('命名模板的未知/缺失占位符会给出提示', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{date}-{oops}')
    })
    const body = render()
    expect(body).toContain('未知占位符：{oops}')
    expect(body).toContain('缺少 {seq}')
  })

  it('水印归属列的是「各方向实际会叠的」，不是水印库全集', () => {
    // 归属只在水印工作区的树上改；面板里列出「库里有哪些水印」回答不了
    // 「这批图实际会叠什么」，而后者才是用户在产出前要确认的。
    act(() => {
      useProjectTreeParamsStore.setState({
        params: { 'direction-a': { postprocess: { watermarkPresetIds: ['preset-a'] } } },
      })
      usePostprocessMediaStore.getState().toggleSelectedCollection('direction-a')
    })
    const body = render()

    expect(body).toContain('水印归属')
    expect(body).toContain('机器人 / 竖版展示')
    expect(body).toContain('糖包水印')
    // 面板里不再提供「勾选水印」的入口，避免归属有两个来源
    expect(body).not.toContain('一个都不勾 = 不叠水印')
  })

  it('「设置水印归属」入口切到水印预设工作区', () => {
    useStore.setState({ appMode: 'gallery' })
    render()

    act(() => {
      findButton('设置水印归属').click()
    })

    expect(useStore.getState().appMode).toBe('postprocess')
  })

  it('没有启用范围时不列水印归属，而是给空态', () => {
    useCompositeV2Store.setState({ presets: [] })
    const body = render()

    expect(body).toContain('勾选启用范围后，这里显示各方向实际会叠的水印。')
    expect(body).not.toContain('后期处理 → 预设管理')
  })

  it('归属里引用了不存在的水印预设时提示会整批跳过', () => {
    act(() => {
      useProjectTreeParamsStore.setState({
        params: { 'direction-a': { postprocess: { watermarkPresetIds: ['preset-ghost'] } } },
      })
      usePostprocessMediaStore.getState().toggleSelectedCollection('direction-a')
    })
    const body = render()
    expect(body).toContain('引用的水印预设已不存在')
    expect(body).toContain('已失效')
  })

  it('项目勾选里出现已删除的 id 时给出跳过提示', () => {
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: ['ghost-project'] })
    })
    const body = render()
    expect(body).toContain('有 1 个已勾选的项目不存在或已删除')
  })

  it('方向不可预知（auto）时预览标注为示例尺寸', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const body = render('auto')
    expect(body).toContain('1024x1024（示例）')
  })

  it('恢复默认模板按钮把模板写回默认值', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{seq}')
    })
    render()
    act(() => {
      findButton('恢复默认').click()
    })
    expect(usePostprocessMediaStore.getState().namePattern).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN)
  })

  describe('弹窗外壳走设计系统 Dialog', () => {
    it('挂载为 portal 到 body 的模态对话框', () => {
      render()
      const dialog = document.body.querySelector('[role="dialog"]')
      expect(dialog).toBeTruthy()
      expect(dialog!.getAttribute('aria-modal')).toBe('true')
      // 走 ds-dialog 骨架而不是自搓的 ds-modal-*
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
  })

  describe('80% 双栏布局与参数入口', () => {
    /** 当前打开的所有弹窗标题（父子弹窗会同时在 portal 里，用标题区分） */
    function dialogTitles(): string[] {
      return Array.from(document.querySelectorAll('.ds-dialog__title')).map((node) => node.textContent ?? '')
    }

    it('外壳是 80% 工作区：左栏为 sidebar 树，右栏为内容区', () => {
      render()
      const dialog = document.body.querySelector('[role="dialog"]')!
      // 80vw × 80dvh 的骨架类（见 design-system/styles.css 的 .ds-dialog--postprocess）
      expect(dialog.classList.contains('ds-dialog--postprocess')).toBe(true)
      // 两栏由 DialogWorkspace--split 提供，左栏必须是 aside + sidebar 语义
      expect(dialog.querySelector('.ds-dialog-workspace--split')).toBeTruthy()
      const sidebar = dialog.querySelector('aside.ds-dialog-pane--sidebar')
      expect(sidebar).toBeTruthy()
      // 项目树落在左栏里，而不是继续挤在右栏正文
      expect(sidebar!.textContent).toContain('启用范围')
      expect(sidebar!.textContent).toContain('智能客服')
    })

    it('左栏每个节点带「参数」入口，点开该节点的参数弹窗', () => {
      render()
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="设置 智能客服 的后处理参数"]')
      expect(button).toBeTruthy()
      act(() => {
        button!.click()
      })
      // 单节点参数弹窗的标题带节点名，且带「参与自动后处理」开关
      expect(dialogTitles()).toContain('参数 · 智能客服')
      expect(document.body.textContent).toContain('参与自动后处理')
    })

    it('「参数表格」按钮打开项目树工作台（整棵树的参数总表）', () => {
      render()
      const button = document.querySelector<HTMLButtonElement>('[data-testid="postprocess-open-tree-table"]')
      expect(button).toBeTruthy()
      act(() => {
        button!.click()
      })
      expect(dialogTitles()).toContain('项目树')
      // 「后处理参数」这一列只有总表才有（逐节点标出参数是本级设的、还是继承自谁）
      expect(document.body.textContent).toContain('后处理参数')
    })
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
    // 按钮上不再出现 `{date}` 这种英文占位符（占位符本身只在 tooltip 里交代）
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
    // 把光标放到开头（真实交互里由点击/键盘移动，这里直接设并触发一次 keyup 让组件记住位置）
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
    typeInto('[data-testid="channel-output-dir-baidu-0"]', 'D:/百度一')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度一'])

    // 只有第一个位置填了才给「再加一个」（避免出现「位置 2 有值、位置 1 空着」）
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
})

describe('启用范围的继承态', () => {
  function checkboxFor(label: string): HTMLInputElement {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const found = inputs.find(
      (input) => input.closest('label')?.querySelector('.ds-check__label')?.textContent === label,
    )
    if (!found) throw new Error(`未找到复选框：${label}`)
    return found
  }

  it('勾了上级 → 旗下节点显示为已勾但不可改', () => {
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: ['line-a'] })
    })
    render()

    expect(checkboxFor('智能客服').checked).toBe(true)
    expect(checkboxFor('智能客服').disabled).toBe(false)
    // 产品自身没勾，是靠产品线启用的：勾着但点不动——否则界面上看着没勾、实际却在产出
    expect(checkboxFor('机器人').checked).toBe(true)
    expect(checkboxFor('机器人').disabled).toBe(true)
  })

  it('未勾任何节点时全部未勾且可改', () => {
    render()
    expect(checkboxFor('智能客服').checked).toBe(false)
    expect(checkboxFor('智能客服').disabled).toBe(false)
    expect(checkboxFor('机器人').checked).toBe(false)
    expect(checkboxFor('机器人').disabled).toBe(false)
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
