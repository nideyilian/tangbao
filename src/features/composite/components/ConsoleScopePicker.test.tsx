/**
 * 中控台作用域选择器的行为测试。
 *
 * 重点验三件事，都是「看起来没问题但实际会坏」的地方：
 * 1. 节点被删掉后作用域指向悬空 id —— 必须静默退回全局，而不是显示空值；
 * 2. `allowNodeScope: false` 时只有全局一项（给尚无节点级能力的参数留的口子）；
 * 3. `isGlobalScope` 的判定与 `GLOBAL_NODE_ID` 哨兵一致 —— 各分区共用同一条判定。
 *
 * 用 `react-test-renderer` 而不是 testing-library：本仓库组件测试统一走前者，
 * 不额外引入依赖。断言落在 `select` 的 `value` / `options` 上，不依赖 DOM 查询能力。
 */

import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConsoleScopePicker, isGlobalScope } from './ConsoleScopePicker'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { useAssetLibraryStore } from '../../assetLibrary/store'

/** 必须在 `act` 里创建，否则拿不到已挂载的树 */
function renderPicker(props: Parameters<typeof ConsoleScopePicker>[0]) {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<ConsoleScopePicker {...props} />)
  })
  return renderer
}

function seedCollections() {
  useAssetLibraryStore.setState({
    collections: [
      { id: 'line-a', name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
      { id: 'product-a', name: '产品A', parentId: 'line-a', order: 0, createdAt: 0, updatedAt: 0 },
    ] as never,
  })
}

/** 取渲染树里那个 select 元素与它的选项文本 */
function readSelect(renderer: ReturnType<typeof create>) {
  const select = renderer.root.findAllByType('select')[0]
  const options = select.findAllByType('option')
  return {
    value: select.props.value as string,
    labels: options.map((item) => String(item.props.children)),
    values: options.map((item) => String(item.props.value)),
  }
}

describe('ConsoleScopePicker', () => {
  beforeEach(() => {
    useAssetLibraryStore.setState({ collections: [] })
  })

  it('全局默认是第一个选项，节点按层级追加在后', () => {
    seedCollections()
    const renderer = renderPicker({ value: GLOBAL_NODE_ID, onValueChange: () => {}, label: '输出位置' })
    const { labels, values } = readSelect(renderer)

    expect(values[0]).toBe(GLOBAL_NODE_ID)
    expect(labels[0]).toContain('全局默认')
    expect(values).toContain('line-a')
    expect(values).toContain('product-a')
    // 子节点带缩进，与父级在同一列表里可区分
    const productLabel = labels[values.indexOf('product-a')]!
    expect(productLabel).toContain('产品A')
    expect(productLabel.startsWith('  ')).toBe(true)
  })

  it('作用域指向已删除节点时退回全局，不显示悬空值', () => {
    seedCollections()
    const renderer = renderPicker({ value: '已删除的节点', onValueChange: () => {}, label: '输出位置' })
    expect(readSelect(renderer).value).toBe(GLOBAL_NODE_ID)
  })

  it('allowNodeScope=false 时只给全局一项', () => {
    seedCollections()
    const renderer = renderPicker({
      value: GLOBAL_NODE_ID,
      onValueChange: () => {},
      label: '分发',
      allowNodeScope: false,
    })
    expect(readSelect(renderer).values).toHaveLength(1)
  })

  it('isGlobalScope 只认哨兵值', () => {
    expect(isGlobalScope(GLOBAL_NODE_ID)).toBe(true)
    expect(isGlobalScope('line-a')).toBe(false)
    expect(isGlobalScope('__postprocess_global__')).toBe(true)
  })
})
