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
import { COLLECTION_DRAG_TYPE } from '../../../lib/assetSidebarUtils'
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
const moveCollectionsToPosition = vi.fn(async () => undefined)

function seedStores() {
  createCollection.mockClear()
  renameCollection.mockClear()
  deleteCollection.mockClear()
  restoreCollection.mockClear()
  moveCollectionsToPosition.mockClear()
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
    moveCollectionsToPosition: moveCollectionsToPosition as never,
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

/**
 * 造一个拖拽事件。
 *
 * `clientY` 决定落点 —— 行高按 40 算：< 12 上沿（插到它前面）、
 * 12~28 中间（变成它的子级）、> 28 下沿（插到它后面）。
 */
function dragEvent(clientY: number, payload: string[] = ['product-a']) {
  return {
    dataTransfer: {
      types: [COLLECTION_DRAG_TYPE],
      getData: (type: string) => (type === COLLECTION_DRAG_TYPE ? JSON.stringify(payload) : ''),
      setData: vi.fn(),
      dropEffect: '',
      effectAllowed: '',
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) },
    clientY,
  }
}

/** 取某一行的缩进类（`pl-*`），用于断言层级画得出来 */
function indentOf(renderer: ReturnType<typeof create>, name: string): string | undefined {
  const row = nodeRows(renderer).find((item) => collectText(item.props.children).includes(name))
  return (row?.props.className as string | undefined)?.split(/\s+/).find((cls) => cls.startsWith('pl-'))
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

  // ===== 拖拽移动（2026-09-22）=====
  //
  // 行顺序固定为：产品线A / 产品A / 月亮 / 太阳（全展开）。

  it('每行都能拖；但搜索态不给拖（剪枝后「插到同级第几个」会算错）', () => {
    const renderer = renderTree()
    expect(nodeRows(renderer).every((row) => row.props.draggable === true)).toBe(true)

    const search = renderer.root.find((node) => node.type === 'input' && node.props.type === 'search')
    act(() => {
      ;(search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '月亮' } })
    })
    expect(nodeRows(renderer).every((row) => row.props.draggable === false)).toBe(true)
  })

  it('拖起来：写入负载，源行标成半透明', () => {
    const renderer = renderTree()
    const setData = vi.fn()
    act(() => {
      nodeRows(renderer)[1]!.props.onDragStart({
        dataTransfer: { setData, effectAllowed: '' },
        preventDefault: vi.fn(),
      })
    })
    expect(setData).toHaveBeenCalledWith(COLLECTION_DRAG_TYPE, JSON.stringify(['product-a']))
    expect(nodeRows(renderer)[1]!.props['data-dragging']).toBe('true')
  })

  it('⭐ 落到某行中间 = 成为它的子级，并自动展开新父级（否则东西掉进去看着像没生效）', () => {
    useAssetLibraryStore.setState({
      collections: [
        { id: 'line-a', name: '产品线A', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'product-a', name: '产品A', parentId: 'line-a', order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'direction-moon', name: '月亮', parentId: 'product-a', order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'line-b', name: '产品线B', parentId: null, order: 1, createdAt: 0, updatedAt: 0 },
      ] as never,
    })
    const renderer = renderTree()
    clickByAriaLabel(renderer, '收起 产品A')
    expect(treeText(renderer)).not.toContain('月亮')

    // 行：产品线A / 产品A / 产品线B —— 把「产品线B」拖进折叠着的「产品A」
    act(() => {
      nodeRows(renderer)[2]!.props.onDragStart({
        dataTransfer: { setData: vi.fn(), effectAllowed: '' },
        preventDefault: vi.fn(),
      })
    })
    act(() => {
      nodeRows(renderer)[1]!.props.onDragOver(dragEvent(20, ['line-b']))
    })
    expect(nodeRows(renderer)[1]!.props['data-drop-zone']).toBe('into')
    act(() => {
      nodeRows(renderer)[1]!.props.onDrop(dragEvent(20, ['line-b']))
    })

    expect(moveCollectionsToPosition).toHaveBeenCalledWith(['line-b'], { kind: 'into', parentId: 'product-a' })
    expect(treeText(renderer)).toContain('月亮')
  })

  it('落到行的上沿 = 插到它前面；下沿 = 插到它后面（同级重排）', () => {
    const renderer = renderTree()
    const dragSunThenDropOnProductA = (clientY: number) => {
      act(() => {
        nodeRows(renderer)[3]!.props.onDragStart({
          dataTransfer: { setData: vi.fn(), effectAllowed: '' },
          preventDefault: vi.fn(),
        })
      })
      act(() => {
        nodeRows(renderer)[1]!.props.onDragOver(dragEvent(clientY, ['direction-sun']))
      })
      act(() => {
        nodeRows(renderer)[1]!.props.onDrop(dragEvent(clientY, ['direction-sun']))
      })
    }

    dragSunThenDropOnProductA(4)
    expect(moveCollectionsToPosition).toHaveBeenLastCalledWith(['direction-sun'], {
      kind: 'before',
      siblingId: 'product-a',
    })

    dragSunThenDropOnProductA(36)
    expect(moveCollectionsToPosition).toHaveBeenLastCalledWith(['direction-sun'], {
      kind: 'after',
      siblingId: 'product-a',
    })
  })

  it('⭐ 不能拖到自己或自己的子孙下：不给落点提示、不落库、给出提示', () => {
    const renderer = renderTree()
    // 拖「产品A」到它自己的子节点「月亮」上
    act(() => {
      nodeRows(renderer)[1]!.props.onDragStart({
        dataTransfer: { setData: vi.fn(), effectAllowed: '' },
        preventDefault: vi.fn(),
      })
    })
    const over = dragEvent(20, ['product-a'])
    act(() => {
      nodeRows(renderer)[2]!.props.onDragOver(over)
    })
    expect(over.dataTransfer.dropEffect).toBe('none')
    expect(nodeRows(renderer)[2]!.props['data-drop-zone']).toBeUndefined()

    act(() => {
      nodeRows(renderer)[2]!.props.onDrop(dragEvent(20, ['product-a']))
    })
    expect(moveCollectionsToPosition).not.toHaveBeenCalled()
    expect(useStore.getState().toast?.message ?? '').toContain('自身的子节点')
  })

  it('拖到树下面那片空白 = 变成业务线（追加到根末尾）', () => {
    const renderer = renderTree()
    const root = renderer.root.find(
      (node) => typeof node.props.onDrop === 'function' && String(node.props.className).includes('overflow-y-auto'),
    )
    act(() => {
      nodeRows(renderer)[1]!.props.onDragStart({
        dataTransfer: { setData: vi.fn(), effectAllowed: '' },
        preventDefault: vi.fn(),
      })
    })
    act(() => {
      root.props.onDragOver(dragEvent(0, ['product-a']))
    })
    expect(
      renderer.root.find((node) => node.type === 'div' && String(node.props.className).includes('border-dashed')),
    ).toBeTruthy()
    act(() => {
      root.props.onDrop(dragEvent(0, ['product-a']))
    })
    expect(moveCollectionsToPosition).toHaveBeenCalledWith(['product-a'], { kind: 'append', parentId: null })
  })

  it('深层缩进继续加深：第 4 层不再和第 3 层一样（拖拽能随手造出第 4 层）', () => {
    useAssetLibraryStore.setState({
      collections: [
        { id: 'l1', name: '第一层', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'p2', name: '第二层', parentId: 'l1', order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'd3', name: '第三层', parentId: 'p2', order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'x4', name: '第四层', parentId: 'd3', order: 0, createdAt: 0, updatedAt: 0 },
      ] as never,
    })
    const renderer = renderTree()
    expect(indentOf(renderer, '第三层')).toBe('pl-11')
    expect(indentOf(renderer, '第四层')).toBe('pl-14')
  })
})
