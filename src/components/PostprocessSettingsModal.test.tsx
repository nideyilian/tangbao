/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import { useCompositeV2Store } from '../features/composite/storeV2'
import { DEFAULT_POSTPROCESS_NAME_PATTERN } from '../lib/postprocessNaming'
import type { AssetCollection } from '../types'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../storePostprocessMedia'
import PostprocessSettingsModal from './PostprocessSettingsModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function collectText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  const children = (node as { children?: unknown[] } | null)?.children
  if (!Array.isArray(children)) return ''
  return children.map((child) => collectText(child)).join('')
}

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '智能客服', null, 0),
  collection('product-a', '机器人', 'line-a', 0),
  collection('direction-a', '竖版展示', 'product-a', 0),
]

let renderer: ReactTestRenderer | null = null

function render(sourceSize = '1280x720'): string {
  act(() => {
    renderer = create(<PostprocessSettingsModal sourceSize={sourceSize} onClose={() => {}} />)
  })
  return collectText(renderer!.toJSON())
}

function findButton(text: string) {
  const buttons = renderer!.root.findAllByType('button')
  const exact = buttons.find((node) => collectText(node).trim() === text)
  const found = exact ?? buttons.find((node) => collectText(node).includes(text))
  if (!found) throw new Error(`未找到按钮：${text}`)
  return found
}

beforeEach(() => {
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
})

afterEach(() => {
  renderer?.unmount()
  renderer = null
  window.localStorage.clear()
})

describe('PostprocessSettingsModal', () => {
  it('默认展示核心提示与空预览状态', () => {
    const text = render()
    expect(text).toContain('同时选择项目与媒体后启用')
    expect(text).toContain('未满足启用条件：需同时选择项目与媒体')
    expect(text).toContain('选择项目与媒体后显示产出清单。')
  })

  it('渲染项目树的层级标签与投影', () => {
    const text = render()
    expect(text).toContain('智能客服')
    expect(text).toContain('产品线')
    // 产品线默认展开，产品可见；方向要先展开产品
    expect(text).toContain('机器人')
    expect(text).toContain('产品')
  })

  it('勾选项目与媒体后展示变体数与文件名预览', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const text = render()
    // 1280x720 → 横版；gdt 只有 1280x720 横版尺寸；勾了渠道 → 自动伴随纯净版
    expect(text).toContain('1 个项目，共 2 个变体')
    expect(text).toContain('每张原图产出 2 个文件')
    expect(text).toContain('纯净版')
    expect(text).toContain('广点通')
    expect(text).toContain('横版')
  })

  it('媒体行只读展示尺寸与体积上限', () => {
    const text = render()
    expect(text).toContain('1280x720')
    expect(text).toContain('≤399KB')
  })

  it('停用的媒体显示为已停用且勾选框禁用', () => {
    act(() => {
      usePostprocessMediaStore.getState().setMediaEnabled('gdt', false)
    })
    render()
    const text = collectText(renderer!.toJSON())
    expect(text).toContain('已停用')
    const disabledCheckbox = renderer!.root
      .findAllByType('input')
      .find((node) => String(node.props.type) === 'checkbox' && node.props.disabled === true)
    expect(disabledCheckbox).toBeTruthy()
  })

  it('全选按钮勾上全部启用媒体并保留纯净版', () => {
    render()
    act(() => {
      findButton('全选').props.onClick()
    })
    const selected = usePostprocessMediaStore.getState().selectedMediaIds
    expect(selected).toContain('clean')
    expect(selected).toEqual(expect.arrayContaining(['gdt', 'baidu', 'vendor', 'toutiao']))
  })

  it('方向按钮写入 store', () => {
    render()
    act(() => {
      findButton('竖版').props.onClick()
    })
    expect(usePostprocessMediaStore.getState().direction).toBe('portrait')
    act(() => {
      findButton('跟随尺寸').props.onClick()
    })
    expect(usePostprocessMediaStore.getState().direction).toBeNull()
  })

  it('命名模板的未知/缺失占位符会给出提示', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{date}-{oops}')
    })
    const text = render()
    expect(text).toContain('未知占位符：{oops}')
    expect(text).toContain('缺少 {seq}')
  })

  it('水印预设下拉列出可用预设', () => {
    const text = render()
    expect(text).toContain('水印预设')
    expect(text).toContain('不加水印')
  })

  it('引用了不存在的水印预设时提示将跳过叠加', () => {
    act(() => {
      usePostprocessMediaStore.getState().setWatermarkPresetId('preset-ghost')
    })
    const text = render()
    expect(text).toContain('引用的水印预设已不存在')
  })

  it('项目勾选里出现已删除的 id 时给出跳过提示', () => {
    act(() => {
      usePostprocessMediaStore.setState({ selectedCollectionIds: ['ghost-project'] })
    })
    const text = render()
    expect(text).toContain('有 1 个已勾选的项目不存在或已删除')
  })

  it('方向不可预知（auto）时预览标注为示例尺寸', () => {
    act(() => {
      usePostprocessMediaStore.getState().toggleSelectedCollection('product-a')
      usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    })
    const text = render('auto')
    expect(text).toContain('1024x1024（示例）')
  })

  it('恢复默认模板按钮把模板写回默认值', () => {
    act(() => {
      usePostprocessMediaStore.getState().setNamePattern('{seq}')
    })
    render()
    act(() => {
      findButton('恢复默认').props.onClick()
    })
    expect(usePostprocessMediaStore.getState().namePattern).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN)
  })
})
