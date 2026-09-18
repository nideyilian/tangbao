/* @vitest-environment jsdom */

/**
 * 水印归属树的行为测试。
 *
 * 重点不在「渲染出几个节点」，而在两条容易写错、写错了又很难发现的语义：
 * ① 继承态下第一次改动必须**物化**成本级显式数组（否则「少一个」会被写成「一个都不要」）；
 * ② `undefined`（继承）与 `[]`（显式不加水印）在界面上必须能区分。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import type { AssetCollection } from '../../../types'
import { useStore } from '../../../store'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { PRESET_LIBRARY_DRAG_TYPE } from '../lib/compositePresetLibrary'
import { useCompositeV2Store } from '../storeV2'
import { PresetProjectTree } from './PresetProjectTree'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 0, updatedAt: 0 }
}

const LINE = 'line-a'
const PRODUCT = 'product-a'
const DIRECTION = 'direction-a'
const COLLECTIONS: AssetCollection[] = [
  collection(LINE, '智能客服', null, 0),
  collection(PRODUCT, '机器人', LINE, 0),
  collection(DIRECTION, '竖版展示', PRODUCT, 0),
]

const PRESET_A = { id: 'preset-a', name: '糖包角标', updatedAt: 1 }
const PRESET_B = { id: 'preset-b', name: '活动标题条', updatedAt: 2 }

const mountedRenderers: Array<ReturnType<typeof create>> = []

beforeEach(() => {
  useAssetLibraryStore.setState({ collections: COLLECTIONS })
  useProjectTreeParamsStore.setState({ params: {} })
  usePostprocessMediaStore.setState({ ...createDefaultPostprocessMediaConfig(), selectedCollectionIds: [LINE] })
  useCompositeV2Store.setState({
    presets: [PRESET_A, PRESET_B].map((preset) => ({
      ...preset,
      baseCanvas: { width: 100, height: 100 },
      sampleBackgroundPath: '',
      layers: [],
    })),
    selectedPreviewPresetId: 'preset-a',
  })
})

afterEach(() => {
  while (mountedRenderers.length) {
    const renderer = mountedRenderers.pop()
    if (renderer) act(() => renderer.unmount())
  }
  useProjectTreeParamsStore.setState({ params: {} })
  useAssetLibraryStore.setState({ collections: [] })
  usePostprocessMediaStore.setState(createDefaultPostprocessMediaConfig())
  vi.restoreAllMocks()
})

function render() {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<PresetProjectTree />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child: string | ReactTestInstance) => (typeof child === 'string' ? child : getNodeText(child)))
    .join('')
}

function nodeRows(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => typeof node.props['data-preset-tree-node'] === 'string')
    .map((node) => {
      return node.props['data-preset-tree-node'] as string
    })
}

function findNodeRow(root: ReactTestInstance, nodeId: string) {
  return root.find((node) => node.props['data-preset-tree-node'] === nodeId)
}

function clickByAriaLabel(root: ReactTestInstance, label: string) {
  const matches = root.findAll((node) => node.props['aria-label'] === label)
  if (matches.length === 0) throw new Error(`未找到 aria-label=${label} 的元素`)
  act(() => matches[0].props.onClick())
}

function expand(root: ReactTestInstance, name: string) {
  clickByAriaLabel(root, `展开 ${name}`)
}

function rowText(root: ReactTestInstance, nodeId: string): string {
  return getNodeText(findNodeRow(root, nodeId))
}

function boundPresetIds(root: ReactTestInstance, nodeId: string): string[] {
  return findNodeRow(root, nodeId)
    .findAll((node) => typeof node.props['data-bound-preset'] === 'string')
    .map((node) => node.props['data-bound-preset'] as string)
}

function dropPreset(root: ReactTestInstance, nodeId: string, presetId: string) {
  const target = findNodeRow(root, nodeId).find((node) => typeof node.props.onDrop === 'function')
  const dataTransfer = {
    types: [PRESET_LIBRARY_DRAG_TYPE],
    dropEffect: '',
    getData: (type: string) => (type === PRESET_LIBRARY_DRAG_TYPE ? presetId : ''),
  }
  act(() => {
    target.props.onDragOver({ dataTransfer, preventDefault: () => {} })
    target.props.onDrop({ dataTransfer, preventDefault: () => {} })
  })
}

function storedPresetIds(nodeId: string): string[] | undefined {
  return useProjectTreeParamsStore.getState().params[nodeId]?.postprocess?.watermarkPresetIds
}

describe('PresetProjectTree', () => {
  it('按占位符渲染项目树', () => {
    const root = render()
    expect(root.root.findAll((node) => node.props['data-layout'] === 'preset-project-tree')).toHaveLength(1)
    expect(getNodeText(root.root)).toContain('水印归属')
  })

  it('默认只展开到产品线，逐级点开才出现产品与方向', () => {
    const root = render()
    expect(nodeRows(root.root)).toEqual([LINE])

    expand(root.root, '智能客服')
    expect(nodeRows(root.root)).toEqual([LINE, PRODUCT])

    expand(root.root, '机器人')
    expect(nodeRows(root.root)).toEqual([LINE, PRODUCT, DIRECTION])
    expect(getNodeText(root.root)).toContain('竖版展示')
  })

  it('没配过的地方显示为「跟随全局」而不是空着', () => {
    const root = render()
    expect(rowText(root.root, LINE)).toContain('跟随全局')
    expect(rowText(root.root, LINE)).toContain('不加水印')
  })

  it('点节点上的「+」把当前选中的水印绑上去，子方向显示为继承', () => {
    const root = render()
    clickByAriaLabel(root.root, '把当前选中的水印预设绑定到 智能客服')

    expect(storedPresetIds(LINE)).toEqual(['preset-a'])
    expect(boundPresetIds(root.root, LINE)).toEqual(['preset-a'])

    expand(root.root, '智能客服')
    expect(rowText(root.root, PRODUCT)).toContain('继承自「智能客服」')
    expect(boundPresetIds(root.root, PRODUCT)).toEqual(['preset-a'])
  })

  it('从预设库把水印拖到某个方向上即完成绑定', () => {
    const root = render()
    expand(root.root, '智能客服')
    expand(root.root, '机器人')

    dropPreset(root.root, DIRECTION, 'preset-b')

    expect(storedPresetIds(DIRECTION)).toEqual(['preset-b'])
    expect(boundPresetIds(root.root, DIRECTION)).toEqual(['preset-b'])
    // 拖过去的是方向自己那一级，来源标记必须是「本级自定义」
    expect(rowText(root.root, DIRECTION)).toContain('本级自定义')
  })

  it('拖拽只认预设库的类型，别的拖放不会误绑', () => {
    const root = render()
    const target = findNodeRow(root.root, LINE).find((node) => typeof node.props.onDrop === 'function')
    act(() => {
      target.props.onDrop({
        dataTransfer: { types: ['text/plain'], getData: () => 'preset-b' },
        preventDefault: () => {},
      })
    })
    expect(storedPresetIds(LINE)).toBeUndefined()
  })

  it('解绑继承来的水印会物化成本级数组，而不是把上层一起改掉', () => {
    // 这是最容易写错的一条：直接写结果数组会把「少一个」表达成「一个都不要」
    useProjectTreeParamsStore.setState({
      params: { [LINE]: { postprocess: { watermarkPresetIds: ['preset-a', 'preset-b'] } } },
    })
    const root = render()
    expand(root.root, '智能客服')
    expand(root.root, '机器人')

    // 方向此时继承着两个水印
    expect(boundPresetIds(root.root, DIRECTION)).toEqual(['preset-a', 'preset-b'])
    clickByAriaLabel(root.root, '从 竖版展示 解绑水印 糖包角标')

    expect(storedPresetIds(DIRECTION)).toEqual(['preset-b'])
    // 上层原封不动
    expect(storedPresetIds(LINE)).toEqual(['preset-a', 'preset-b'])
  })

  it('「恢复继承」把本级覆盖摘干净，重新跟随上级', () => {
    useProjectTreeParamsStore.setState({
      params: {
        [LINE]: { postprocess: { watermarkPresetIds: ['preset-a'] } },
        [DIRECTION]: { postprocess: { watermarkPresetIds: ['preset-b'] } },
      },
    })
    const root = render()
    expand(root.root, '智能客服')
    expand(root.root, '机器人')

    clickByAriaLabel(root.root, '恢复 竖版展示 的水印继承')

    // 只写了这一个字段 → 整条记录被删掉，回到「未配置」
    expect(useProjectTreeParamsStore.getState().params[DIRECTION]).toBeUndefined()
    expect(boundPresetIds(root.root, DIRECTION)).toEqual(['preset-a'])
    expect(rowText(root.root, DIRECTION)).toContain('继承自「智能客服」')
  })

  it('显式「这个方向不加水印」与「还没配」在界面上能区分', () => {
    useProjectTreeParamsStore.setState({
      params: { [DIRECTION]: { postprocess: { watermarkPresetIds: [] } } },
    })
    const root = render()
    expand(root.root, '智能客服')
    expand(root.root, '机器人')

    expect(rowText(root.root, DIRECTION)).toContain('本级自定义')
    expect(rowText(root.root, DIRECTION)).toContain('不加水印')
    // 显式空数组是可恢复继承的，要给出出口
    expect(
      findNodeRow(root.root, DIRECTION).findAll((node) => node.props['aria-label'] === '恢复 竖版展示 的水印继承'),
    ).toHaveLength(1)
  })

  it('绑定的预设被删掉时给出失效提示，不静默少显示', () => {
    useProjectTreeParamsStore.setState({
      params: { [LINE]: { postprocess: { watermarkPresetIds: ['preset-a', 'gone'] } } },
    })
    const root = render()
    expect(rowText(root.root, LINE)).toContain('已失效 1')
    expect(boundPresetIds(root.root, LINE)).toEqual(['preset-a'])
  })

  it('点水印 chip 会把它切成当前预览的预设', () => {
    useProjectTreeParamsStore.setState({
      params: { [LINE]: { postprocess: { watermarkPresetIds: ['preset-b'] } } },
    })
    const root = render()
    const chip = findNodeRow(root.root, LINE).find(
      (node) => getNodeText(node) === '活动标题条' && typeof node.props.onClick === 'function',
    )
    act(() => chip.props.onClick())
    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe('preset-b')
  })

  it('不在启用范围内的方向会标出来（配了也不产出）', () => {
    usePostprocessMediaStore.setState({ selectedCollectionIds: [] })
    const root = render()
    expect(rowText(root.root, LINE)).toContain('未启用')
  })

  it('绑定已满一行时折叠成 +N', () => {
    useProjectTreeParamsStore.setState({
      params: { [LINE]: { postprocess: { watermarkPresetIds: ['a', 'b', 'c', 'd'] } } },
    })
    useCompositeV2Store.setState({
      presets: ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        name: `水印${id}`,
        baseCanvas: { width: 1, height: 1 },
        sampleBackgroundPath: '',
        layers: [],
        updatedAt: 0,
      })),
      selectedPreviewPresetId: 'a',
    })

    const root = render()
    expect(rowText(root.root, LINE)).toContain('+1')
  })

  it('没有项目文件夹时给出引导，而不是一片空白', () => {
    useAssetLibraryStore.setState({ collections: [] })
    const root = render()
    expect(getNodeText(root.root)).toContain('还没有项目文件夹')
    expect(nodeRows(root.root)).toEqual([])
  })

  it('写参数后 toast 会告诉用户绑到了哪个方向', () => {
    const showToast = vi.spyOn(useStore.getState(), 'showToast')
    const root = render()
    clickByAriaLabel(root.root, '把当前选中的水印预设绑定到 智能客服')
    expect(showToast).toHaveBeenCalledWith('已把水印「糖包角标」绑到「智能客服」', 'success')
  })
})
