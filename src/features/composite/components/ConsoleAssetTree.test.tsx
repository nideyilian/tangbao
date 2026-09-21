/**
 * 中控台左栏「项目树」的行为测试。
 *
 * 锁三组事：
 *
 * 1. ⭐ **树只有一棵**（2026-09-21 的回归断言）—— 上一版把「配置维度」挂成树的一级，
 *    于是每个能按方向配的维度各挂一棵完整的作用域树，展开两个组就是两棵一模一样的
 *    方向树。这里直接数节点行：每个集合在树上只出现一次。
 * 2. **树管「改谁」**：点节点 / 点「全局默认」→ `onValueChange`。
 * 3. **树管增删改查**：新增业务线、在某节点下新增、改名、删除（删除走确认弹窗）。
 */

import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleAssetTree } from './ConsoleAssetTree'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useStore } from '../../../store'

/** 新建出来的节点形状（与 `AssetCollection` 对齐；`null` 表示被 store 拒绝了） */
type CreatedCollection = {
  id: string
  name: string
  parentId: string | null
  order: number
  createdAt: number
  updatedAt: number
}

const createCollection = vi.fn(
  async (name: string, parentId: string | null = null): Promise<CreatedCollection | null> => ({
    id: 'created-1',
    name,
    parentId,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  }),
)
const renameCollection = vi.fn(async () => undefined)
const deleteCollection = vi.fn(async () => undefined)
const restoreCollection = vi.fn(async () => undefined)

function seedStores() {
  createCollection.mockClear()
  renameCollection.mockClear()
  deleteCollection.mockClear()
  restoreCollection.mockClear()
  useStore.setState({ confirmDialog: null })
  useAssetLibraryStore.setState({
    collections: [
      { id: 'line-a', name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
      { id: 'product-a', name: '产品A', parentId: 'line-a', order: 0, createdAt: 0, updatedAt: 0 },
      { id: 'direction-moon', name: '月亮', parentId: 'product-a', order: 0, createdAt: 0, updatedAt: 0 },
      { id: 'direction-sun', name: '太阳', parentId: 'product-a', order: 1, createdAt: 0, updatedAt: 0 },
    ] as never,
    createCollection: createCollection as never,
    renameCollection: renameCollection as never,
    deleteCollection: deleteCollection as never,
    restoreCollection: restoreCollection as never,
  })
}

/** 必须在 `act` 里创建，否则拿不到已挂载的树 */
function renderTree(props: { value?: string; onValueChange?: (value: string) => void } = {}) {
  const { value = GLOBAL_NODE_ID, onValueChange = () => {} } = props
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<ConsoleAssetTree value={value} onValueChange={onValueChange} />)
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

/** 按可访问名点按钮 */
function clickByAriaLabel(renderer: ReturnType<typeof create>, label: string) {
  const node = renderer.root.find((item) => item.props['aria-label'] === label)
  act(() => {
    ;(node.props.onClick as () => void)()
  })
}

/** 按可见文本点一个按钮 */
function clickButton(renderer: ReturnType<typeof create>, text: string) {
  const button = renderer.root.find((node) => node.type === 'button' && collectText(node.props.children).includes(text))
  act(() => {
    ;(button.props.onClick as () => void)()
  })
}

/** 树上所有节点行 */
function nodeRows(renderer: ReturnType<typeof create>) {
  return renderer.root.findAll((node) => node.props['data-layout'] === 'console-tree-node')
}

/** 把树上所有行的文本拼起来（断言「某个名字在不在树上」用） */
function treeText(renderer: ReturnType<typeof create>) {
  return nodeRows(renderer)
    .map((row) => collectText(row.props.children))
    .join('|')
}

/** 找到当前的编辑输入框（改名与新增共用一套渲染） */
function findEditor(renderer: ReturnType<typeof create>) {
  return renderer.root.find((node) => node.type === 'input' && typeof node.props['aria-label'] === 'string')
}

/** 在输入框里打字并回车 */
async function typeAndSubmit(renderer: ReturnType<typeof create>, text: string) {
  const input = findEditor(renderer)
  act(() => {
    ;(input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: text } })
  })
  await act(async () => {
    ;(input.props.onKeyDown as (event: { key: string }) => void)({ key: 'Enter' })
    await Promise.resolve()
  })
}

describe('ConsoleAssetTree（项目树：一棵树管整个框架）', () => {
  beforeEach(() => {
    seedStores()
  })

  it('⭐ 树只有一棵：每个节点在树上只渲染一次（维度不再挂在树上）', () => {
    const renderer = renderTree()
    const rows = nodeRows(renderer)
    expect(rows).toHaveLength(4)
    for (const name of ['产品线A', '产品A', '月亮', '太阳']) {
      const matched = rows.filter((row) => collectText(row.props.children).includes(name))
      expect(matched, `「${name}」在树上出现了 ${matched.length} 次`).toHaveLength(1)
    }
  })

  it('层级三层都在：业务线 → 产品 → 方向', () => {
    const renderer = renderTree()
    const labels = nodeRows(renderer).map((row) => collectText(row.props.children))
    expect(labels.join('|')).toContain('产品线A')
    expect(labels.join('|')).toContain('产品A')
    expect(labels.join('|')).toContain('月亮')
  })

  it('点节点 = 定作用域：onValueChange 收到节点 id', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ onValueChange })
    clickButton(renderer, '月亮')
    expect(onValueChange).toHaveBeenCalledWith('direction-moon')
  })

  it('点「全局默认」= 作用域归位', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ value: 'direction-moon', onValueChange })
    clickByAriaLabel(renderer, '全局默认')
    expect(onValueChange).toHaveBeenCalledWith(GLOBAL_NODE_ID)
  })

  it('折叠箭头能收起子树', () => {
    const renderer = renderTree()
    expect(treeText(renderer)).toContain('月亮')
    clickByAriaLabel(renderer, '收起 产品A')
    expect(treeText(renderer)).not.toContain('月亮')
  })

  it('搜索命中的节点保留，并且带出它的祖先链', () => {
    const renderer = renderTree()
    const search = renderer.root.find((node) => node.type === 'input' && node.props.type === 'search')
    act(() => {
      ;(search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '月亮' } })
    })
    expect(treeText(renderer)).toContain('月亮')
    expect(treeText(renderer)).toContain('产品A')
    expect(treeText(renderer)).not.toContain('太阳')
  })

  it('新增业务线：点右上角按钮 → 输入名称回车 → createCollection(name, null)', async () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ onValueChange })
    clickButton(renderer, '业务线')
    await typeAndSubmit(renderer, '新业务线')
    expect(createCollection).toHaveBeenCalledWith('新业务线', null)
    // 加完自动选中新节点：下一步必然是在右区给它配参数，不该再让用户自己找一遍
    expect(onValueChange).toHaveBeenCalledWith('created-1')
  })

  it('新增子级：点节点行悬停的「+」→ createCollection(name, 该节点 id)', async () => {
    const renderer = renderTree()
    clickByAriaLabel(renderer, '在 月亮 下新增')
    await typeAndSubmit(renderer, '新方向')
    expect(createCollection).toHaveBeenCalledWith('新方向', 'direction-moon')
  })

  it('同名节点被拒时给出提示，不静默失败', async () => {
    createCollection.mockResolvedValueOnce(null)
    const renderer = renderTree()
    clickButton(renderer, '业务线')
    await typeAndSubmit(renderer, '产品线A')
    expect(useStore.getState().toast?.message ?? '').toContain('同名')
  })

  it('改名：输入框预填原名，回车写回 store', async () => {
    const renderer = renderTree()
    clickByAriaLabel(renderer, '重命名 月亮')
    const input = findEditor(renderer)
    expect(input.props.value).toBe('月亮')
    await typeAndSubmit(renderer, '月亮（改）')
    expect(renameCollection).toHaveBeenCalledWith('direction-moon', '月亮（改）')
  })

  it('删除走确认弹窗，标题带上节点名（不直接删）', () => {
    const renderer = renderTree()
    clickByAriaLabel(renderer, '删除 产品A')
    expect(deleteCollection).not.toHaveBeenCalled()
    expect(useStore.getState().confirmDialog?.title).toContain('产品A')
    expect(useStore.getState().confirmDialog?.message).toContain('2 个子节点')
  })

  it('⭐ 删掉的正是当前作用域时，作用域归位到「全局默认」', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ value: 'direction-moon', onValueChange })
    clickByAriaLabel(renderer, '删除 月亮')
    act(() => {
      useStore.getState().confirmDialog?.action?.()
    })
    expect(deleteCollection).toHaveBeenCalledWith('direction-moon')
    expect(onValueChange).toHaveBeenCalledWith(GLOBAL_NODE_ID)
  })

  it('删父节点时，后代也在归位判定里（不能留下悬空作用域）', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ value: 'direction-sun', onValueChange })
    clickByAriaLabel(renderer, '删除 产品A')
    act(() => {
      useStore.getState().confirmDialog?.action?.()
    })
    expect(onValueChange).toHaveBeenCalledWith(GLOBAL_NODE_ID)
  })

  it('回收站：切过去只列已回收节点，可一键恢复', () => {
    useAssetLibraryStore.setState({
      collections: [
        { id: 'line-a', name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'gone', name: '删掉的', parentId: null, order: 0, createdAt: 0, updatedAt: 0, trashedAt: 1 },
      ] as never,
    })
    const renderer = renderTree()
    clickButton(renderer, '回收站')
    expect(nodeRows(renderer)).toHaveLength(1)
    clickByAriaLabel(renderer, '恢复 删掉的')
    expect(restoreCollection).toHaveBeenCalledWith('gone')
  })
})
