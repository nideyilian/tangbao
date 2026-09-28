/* @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import CreativePoolPanel, { type CreativePoolPanelProps } from './CreativePoolPanel'
import type { CreativePoolItem } from './types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function item(id: string, name: string): CreativePoolItem {
  return { id, name, assetRef: `a-${id}`, points: [`${name} 的要点`], createdAt: 0, updatedAt: 0 }
}

function renderPanel(overrides: Partial<CreativePoolPanelProps> = {}) {
  const props: CreativePoolPanelProps = {
    items: [],
    assets: new Map<string, string>(),
    maxRandomCount: null,
    loading: false,
    analyzing: '',
    notice: '',
    selection: { mode: 'manual', selectedIds: [], randomCount: 2 },
    onSelectionChange: vi.fn(),
    onMaxRandomCountChange: vi.fn(),
    onAddImages: vi.fn(),
    onRemoveItem: vi.fn(),
    onRenameItem: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<CreativePoolPanel {...props} />)
  })
  return { renderer, props }
}

/** 面板根元素：正是靠这个属性屏蔽全局图片输入，顺带把「必须带它」钉死。 */
function panelRoot(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByProps({ 'data-block-global-image-input': 'true' })
}

describe('CreativePoolPanel 拖拽', () => {
  it('⭐ 根元素必须带 data-block-global-image-input —— 否则拖进来的图会被 InputBar 的全局监听收走当参考图', () => {
    const { renderer } = renderPanel()
    expect(panelRoot(renderer)).toBeTruthy()
    act(() => renderer.unmount())
  })

  it('⭐ 面板与关闭遮罩必须同层（都用 z-overlay）—— 写成 z-dropdown 会被遮罩盖住，点不动也拖不进', () => {
    const { renderer } = renderPanel()
    const overlay = renderer.root.findByProps({ 'aria-label': '关闭风格池' })
    expect(overlay.props.className).toContain('z-overlay')
    const panel = panelRoot(renderer)
    expect(panel.props.className).toContain('z-overlay')
    expect(panel.props.className).not.toContain('z-dropdown')
    act(() => renderer.unmount())
  })

  it('⭐ 拖拽事件就地消化（preventDefault + stopPropagation），不再冒泡给 document 上的全局监听', () => {
    const { renderer } = renderPanel()
    const root = panelRoot(renderer)
    const stopPropagation = vi.fn()
    const preventDefault = vi.fn()
    act(() => {
      root.props.onDragOver({ preventDefault, stopPropagation })
      root.props.onDrop({ preventDefault, stopPropagation, dataTransfer: { files: null } })
    })
    expect(stopPropagation).toHaveBeenCalledTimes(2)
    expect(preventDefault).toHaveBeenCalledTimes(2)
    act(() => renderer.unmount())
  })

  it('丢进来的图片交给 onAddImages', () => {
    const onAddImages = vi.fn()
    const { renderer } = renderPanel({ onAddImages })
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    act(() => {
      panelRoot(renderer).props.onDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files: [file] },
      })
    })
    expect(onAddImages).toHaveBeenCalledWith([file])
    act(() => renderer.unmount())
  })
})

describe('CreativePoolPanel 选图', () => {
  it('勾 1 张就是单选（不需要单独的「单选模式」）', () => {
    const onSelectionChange = vi.fn()
    const { renderer } = renderPanel({ items: [item('a', '厚涂油画')], onSelectionChange })
    act(() => {
      renderer.root.findByProps({ 'aria-label': '选择 厚涂油画' }).props.onClick()
    })
    expect(onSelectionChange).toHaveBeenCalledWith({ mode: 'manual', selectedIds: ['a'], randomCount: 2 })
    act(() => renderer.unmount())
  })

  it('再点一次取消勾选', () => {
    const onSelectionChange = vi.fn()
    const { renderer } = renderPanel({
      items: [item('a', '厚涂油画')],
      selection: { mode: 'manual', selectedIds: ['a'], randomCount: 2 },
      onSelectionChange,
    })
    act(() => {
      renderer.root.findByProps({ 'aria-label': '选择 厚涂油画' }).props.onClick()
    })
    expect(onSelectionChange).toHaveBeenCalledWith({ mode: 'manual', selectedIds: [], randomCount: 2 })
    act(() => renderer.unmount())
  })

  it('空池时给出引导文案（并说明数量不限）', () => {
    const { renderer } = renderPanel()
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('还没有图')
    expect(text).toContain('数量不限')
    act(() => renderer.unmount())
  })

  it('⭐ 勾选不受任何上限约束 —— 池子可以无限扩展', () => {
    const onSelectionChange = vi.fn()
    const many = Array.from({ length: 30 }, (_, index) => item(`i${index}`, `风格${index}`))
    const { renderer } = renderPanel({
      items: many,
      selection: { mode: 'manual', selectedIds: many.slice(0, 20).map((entry) => entry.id), randomCount: 2 },
      onSelectionChange,
    })
    act(() => {
      renderer.root.findByProps({ 'aria-label': '选择 风格20' }).props.onClick()
    })
    expect(onSelectionChange).toHaveBeenCalledWith({
      mode: 'manual',
      selectedIds: many.slice(0, 21).map((entry) => entry.id),
      randomCount: 2,
    })
    act(() => renderer.unmount())
  })

  it('⭐ 随机上限：留空 = 不限，填了就回传数值', () => {
    const onMaxRandomCountChange = vi.fn()
    const { renderer } = renderPanel({ onMaxRandomCountChange })
    const limitInput = renderer.root.findByProps({ 'aria-label': '随机抽签张数上限（留空不限）' })
    act(() => limitInput.props.onChange({ target: { value: '3' } }))
    expect(onMaxRandomCountChange).toHaveBeenCalledWith(3)
    act(() => limitInput.props.onChange({ target: { value: '' } }))
    expect(onMaxRandomCountChange).toHaveBeenLastCalledWith(null)
    act(() => renderer.unmount())
  })
})

describe('CreativePoolPanel 卡片（整格图 + 图内名字条）', () => {
  it('⭐ 名字条底色跟主题走（ds-surface），不得写成 ds-scrim —— scrim 两主题皆深色，浅色下深底配深字会看不见', () => {
    const { renderer } = renderPanel({ items: [item('a', '厚涂油画')] })
    const bar = renderer.root.findByProps({ 'data-pool-name': 'a' })
    expect(bar.props.className).toContain('bg-ds-surface/90')
    expect(bar.props.className).not.toContain('bg-ds-scrim')
    act(() => renderer.unmount())
  })

  it('选中时名字条变主色（一眼看出选了哪张）', () => {
    const { renderer } = renderPanel({
      items: [item('a', '厚涂油画')],
      selection: { mode: 'manual', selectedIds: ['a'], randomCount: 2 },
    })
    const bar = renderer.root.findByProps({ 'data-pool-name': 'a' })
    expect(bar.props.className).toContain('bg-ds-primary')
    act(() => renderer.unmount())
  })

  it('图片用正方形（aspect-square）—— 图纸不能再被裁成扁条', () => {
    const { renderer } = renderPanel({
      items: [item('a', '厚涂油画')],
      assets: new Map([['a-a', 'data:image/png;base64,x']]),
    })
    const img = renderer.root.findByType('img')
    expect(img.props.className).toContain('aspect-square')
    act(() => renderer.unmount())
  })

  it('双击名字条进入改名（改名入口不能随着布局改版丢掉）', () => {
    const { renderer } = renderPanel({ items: [item('a', '厚涂油画')] })
    expect(renderer.root.findAllByProps({ 'aria-label': '重命名 厚涂油画' })).toHaveLength(0)
    act(() => renderer.root.findByProps({ 'data-pool-name': 'a' }).props.onDoubleClick())
    expect(renderer.root.findAllByProps({ 'aria-label': '重命名 厚涂油画' })).toHaveLength(1)
    act(() => renderer.unmount())
  })
})
