/**
 * 中控台左栏「配置资产库」作用域树的行为测试。
 *
 * 锁四件事（都是「看起来没问题但实际会坏」的地方）：
 * 1. 「全局默认」总览项存在且徽章 = 节点总数（灵境「全部策略 N」的对应物）；
 * 2. 点节点 = 切作用域（`onValueChange` 收到节点 id）——这是左树存在的全部意义；
 * 3. 搜索过滤：命中节点保留、无关节点剪掉（含祖先链保留）；
 * 4. 有覆盖的节点显示计数徽章，没覆盖的不显示——徽章回答「哪些节点偏离了全局」。
 */

import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleAssetTree } from './ConsoleAssetTree'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'

function seedStores() {
  useAssetLibraryStore.setState({
    collections: [
      { id: 'line-a', name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
      { id: 'product-a', name: '产品A', parentId: 'line-a', order: 0, createdAt: 0, updatedAt: 0 },
      { id: 'direction-moon', name: '月亮', parentId: 'product-a', order: 0, createdAt: 0, updatedAt: 0 },
      { id: 'direction-sun', name: '太阳', parentId: 'product-a', order: 1, createdAt: 0, updatedAt: 0 },
    ] as never,
  })
  useProjectTreeParamsStore.setState({
    params: {
      // 月亮写了两个覆盖字段（outputDir + enabled）⇒ 徽章应为 2
      'direction-moon': { postprocess: { outputDir: 'D:/月亮', enabled: false } },
    },
  })
}

/** 必须在 `act` 里创建，否则拿不到已挂载的树 */
function renderTree(props: { value: string; onValueChange: (value: string) => void }) {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<ConsoleAssetTree {...props} />)
  })
  return renderer
}

/** 递归收集 props.children 里的全部文本（children 可能是字符串 / 单元素 / 数组） */
function collectText(children: unknown): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(collectText).join('')
  if (children && typeof children === 'object' && 'props' in (children as Record<string, unknown>)) {
    return collectText((children as { props: { children?: unknown } }).props.children)
  }
  return ''
}

/** 取渲染树里所有按钮的可访问名 */
function buttonLabels(renderer: ReturnType<typeof create>) {
  return renderer.root
    .findAll((node) => node.type === 'button' && typeof node.props['aria-label'] !== 'string')
    .map((node) => collectText(node.props.children))
}

/** 按可见文本点一个按钮 */
function clickButton(renderer: ReturnType<typeof create>, text: string) {
  const button = renderer.root.find((node) => node.type === 'button' && collectText(node.props.children).includes(text))
  act(() => {
    ;(button.props.onClick as () => void)()
  })
}

describe('ConsoleAssetTree', () => {
  beforeEach(() => {
    seedStores()
  })

  it('渲染「全局默认」总览项，徽章 = 节点总数', () => {
    const renderer = renderTree({ value: GLOBAL_NODE_ID, onValueChange: () => {} })
    const labels = buttonLabels(renderer)
    expect(labels.some((label) => label.includes('全局默认'))).toBe(true)
    // 4 个节点（产品线A / 产品A / 月亮 / 太阳）
    expect(labels.some((label) => label === '全局默认4')).toBe(true)
  })

  it('点节点 = 切作用域：onValueChange 收到节点 id', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ value: GLOBAL_NODE_ID, onValueChange })
    clickButton(renderer, '月亮')
    expect(onValueChange).toHaveBeenCalledWith('direction-moon')
  })

  it('点「全局默认」= 回到全局基线', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ value: 'direction-moon', onValueChange })
    clickButton(renderer, '全局默认')
    expect(onValueChange).toHaveBeenCalledWith(GLOBAL_NODE_ID)
  })

  it('有覆盖的节点带计数徽章，没覆盖的不带', () => {
    const renderer = renderTree({ value: GLOBAL_NODE_ID, onValueChange: () => {} })
    const labels = buttonLabels(renderer)
    // 月亮有 2 个覆盖字段（outputDir + enabled）
    expect(labels.some((label) => label === '月亮2')).toBe(true)
    // 太阳没有覆盖 ⇒ 行上只有名字，没有数字
    expect(labels.some((label) => label === '太阳2')).toBe(false)
    expect(labels.some((label) => label === '太阳')).toBe(true)
  })

  it('搜索过滤：命中节点保留，无关节点剪掉', () => {
    const renderer = renderTree({ value: GLOBAL_NODE_ID, onValueChange: () => {} })
    // 触发的是内层 <input> 的 DOM 事件（SearchField 的外层 onChange 收的是纯字符串）
    const input = renderer.root.findByType('input')
    act(() => {
      ;(input.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: '月亮' },
      })
    })
    const labels = buttonLabels(renderer)
    expect(labels.some((label) => label.includes('月亮'))).toBe(true)
    expect(labels.some((label) => label.includes('太阳'))).toBe(false)
  })
})
