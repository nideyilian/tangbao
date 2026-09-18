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
        outputRootPath: '',
        distributionPath: '',
        filenameTemplate: '',
        customVariableValues: {},
        baseCanvas: { width: 100, height: 100 },
        sampleBackgroundPath: '',
        layers: [],
        useOutputOverrides: false,
        outputRuleGroupsOverride: [],
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

  it('水印预设是多选，文案讲清「一个都不勾 = 不叠水印」', () => {
    const body = render()
    expect(body).toContain('水印预设')
    expect(body).toContain('一个都不勾 = 不叠水印')
  })

  it('引用了不存在的水印预设时提示会整批跳过', () => {
    act(() => {
      usePostprocessMediaStore.getState().setWatermarkPresetIds(['preset-ghost'])
    })
    const body = render()
    expect(body).toContain('引用的水印预设已不存在')
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
