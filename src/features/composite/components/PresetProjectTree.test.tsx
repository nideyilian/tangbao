/* @vitest-environment jsdom */

/**
 * 水印归属树的行为测试。
 *
 * 重点不在「渲染出几个节点」，而在三条容易写错、写错了又很难发现的语义：
 * ① 继承态下第一次改动必须**物化**成本级显式数组（否则「少一个」会被写成「一个都不要」）；
 * ② `undefined`（继承）与 `[]`（显式不加水印）在行上已经没有标签可看了，只剩「恢复继承」
 *    出口的有无这一条区别 —— 所以要守住这个出口；
 * ③ 同一行既是「预设的 drop 目标」又是「节点的拖出源」，靠载荷类型分流，不能串味。
 *
 * 层级管理（新建 / 重命名 / 删除 / 移动）走的是 `useAssetLibraryStore` 的 collections CRUD，
 * 这里把它下方的仓储层换成内存实现，好断言「树上的操作确实落到了项目树上」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import type { AssetCollection } from '../../../types'
import { useStore } from '../../../store'
import { createDefaultPostprocessMediaConfig, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { PRESET_LIBRARY_DRAG_TYPE, serializePresetDragPayload } from '../lib/compositePresetLibrary'
import { useCompositeV2Store } from '../storeV2'
import { COLLECTION_NODE_DRAG_TYPE, PresetProjectTree } from './PresetProjectTree'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const dialogMocks = vi.hoisted(() => ({ openConfirmDialog: vi.fn() }))
vi.mock('../../../hooks/useAppDialog', () => ({
  useAppDialog: () => ({ openConfirmDialog: dialogMocks.openConfirmDialog }),
}))

/** 项目树仓储换成内存实现：CRUD 的语义由 store 负责，这里只负责「存下来」。 */
const repositoryMocks = vi.hoisted(() => ({
  putCollection: vi.fn(),
  getCollection: vi.fn(),
  putCollections: vi.fn(),
  removeCollection: vi.fn(),
}))
// 只替换写/读这一层：其余导出（`hydrate` 等）在模块加载时就被别处抓走了，整体替换会当场炸。
vi.mock('../../../lib/assetLibraryRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/assetLibraryRepository')>()
  return {
    ...actual,
    putCollection: repositoryMocks.putCollection,
    getCollection: repositoryMocks.getCollection,
    putCollections: repositoryMocks.putCollections,
    removeCollection: repositoryMocks.removeCollection,
  }
})

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 0, updatedAt: 0 }
}

const LINE = 'line-a'
const PRODUCT = 'product-a'
const DIRECTION = 'direction-a'
const OTHER_LINE = 'line-b'
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

  dialogMocks.openConfirmDialog.mockReset()
  repositoryMocks.putCollection.mockImplementation(async (saved: AssetCollection) => saved)
  repositoryMocks.putCollections.mockResolvedValue(undefined)
  repositoryMocks.removeCollection.mockResolvedValue(undefined)
  repositoryMocks.getCollection.mockImplementation(
    async (id: string) => useAssetLibraryStore.getState().collections.find((item) => item.id === id) ?? null,
  )
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

function render(props: { librarySelection?: string[] } = {}) {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<PresetProjectTree {...props} />)
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

/**
 * 点击一个靠 aria-label 定位的元素。默认补一个空事件对象——行内按钮普遍会先
 * `event.stopPropagation()`（行本身是 drop 目标），不传参就会当场抛错。
 */
function clickByAriaLabel(root: ReactTestInstance, label: string) {
  const matches = root.findAll((node) => node.props['aria-label'] === label)
  if (matches.length === 0) throw new Error(`未找到 aria-label=${label} 的元素`)
  act(() => matches[0].props.onClick({ stopPropagation: () => {}, preventDefault: () => {} }))
}

/** 菜单项是带 `role="menuitem"` 的按钮，取文本相等的那一个。 */
function clickMenuItem(root: ReactTestInstance, label: string) {
  const matches = root.findAll((node) => node.props.role === 'menuitem' && getNodeText(node).trim() === label)
  if (matches.length === 0) throw new Error(`未找到菜单项 ${label}`)
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

/** 取节点行上第一个承接拖放的元素的 drop 处理器（行容器，不是它里面的按钮）。 */
function dropTargetOf(root: ReactTestInstance, nodeId: string) {
  return findNodeRow(root, nodeId).find((node) => typeof node.props.onDrop === 'function')
}

/**
 * 拖一个拖拽载荷到节点上。载荷默认走新格式（id 数组）；直接传裸字符串可以模拟
 * 早期版本的单 id 载荷，传 `{}` 形状的字符串可以模拟坏载荷。
 */
function dropPayload(root: ReactTestInstance, nodeId: string, raw: string) {
  const dataTransfer = {
    types: [PRESET_LIBRARY_DRAG_TYPE],
    dropEffect: '',
    getData: (type: string) => (type === PRESET_LIBRARY_DRAG_TYPE ? raw : ''),
  }
  const target = dropTargetOf(root, nodeId)
  act(() => {
    target.props.onDragOver({ dataTransfer, preventDefault: () => {} })
    target.props.onDrop({ dataTransfer, preventDefault: () => {}, stopPropagation: () => {} })
  })
}

function dropPreset(root: ReactTestInstance, nodeId: string, presetId: string) {
  dropPayload(root, nodeId, serializePresetDragPayload([presetId]))
}

/** 拖一个**节点**到另一个节点上。载荷类型与预设不同，两者共用同一个 drop 目标。 */
async function dropNode(root: ReactTestInstance, draggedId: string, targetId: string) {
  const dataTransfer = {
    types: [COLLECTION_NODE_DRAG_TYPE],
    dropEffect: '',
    getData: (type: string) => (type === COLLECTION_NODE_DRAG_TYPE ? draggedId : ''),
  }
  const target = dropTargetOf(root, targetId)
  await act(async () => {
    target.props.onDragOver({ dataTransfer, preventDefault: () => {} })
    target.props.onDrop({ dataTransfer, preventDefault: () => {}, stopPropagation: () => {} })
  })
}

function clickByText(root: ReactTestInstance, text: string) {
  const matches = root.findAll((node) => typeof node.props.onClick === 'function' && getNodeText(node) === text)
  if (matches.length === 0) throw new Error(`未找到文本为 ${text} 的可点元素`)
  act(() => matches[0].props.onClick())
}

function findInputByAriaLabel(root: ReactTestInstance, label: string) {
  return root.findAllByType('input').find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

function storedPresetIds(nodeId: string): string[] | undefined {
  return useProjectTreeParamsStore.getState().params[nodeId]?.postprocess?.watermarkPresetIds
}

function collectionsInStore(): AssetCollection[] {
  return useAssetLibraryStore.getState().collections
}

function parentOf(nodeId: string): string | null | undefined {
  return collectionsInStore().find((item) => item.id === nodeId)?.parentId
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

  it('行上不挂任何分类 / 来源 / 状态标签，没绑定就只剩一个节点名', () => {
    // 层级靠缩进表达，不必再标「产品线 / 产品」；「跟随全局 / 本级自定义 / 继承自 X / 不加水印」
    // 全是注释，一排灰底小字会把树压成两行一个节点。没有绑定 → 行下那排整块不渲染。
    const root = render()
    expect(rowText(root.root, LINE)).toBe('智能客服')
  })

  it('点节点上的「+」把当前选中的水印绑上去，子方向拿到同一份值', () => {
    const root = render()
    clickByAriaLabel(root.root, '把水印绑定到 智能客服')

    expect(storedPresetIds(LINE)).toEqual(['preset-a'])
    expect(boundPresetIds(root.root, LINE)).toEqual(['preset-a'])

    expand(root.root, '智能客服')
    // 值确实继承下来了，但行上不再标「继承自谁」——来源是内部实现，用户要看的是绑了哪几套
    expect(boundPresetIds(root.root, PRODUCT)).toEqual(['preset-a'])
    expect(rowText(root.root, PRODUCT)).not.toContain('继承自')
  })

  it('从预设库把水印拖到某个方向上即完成绑定', () => {
    const root = render()
    expand(root.root, '智能客服')
    expand(root.root, '机器人')

    dropPreset(root.root, DIRECTION, 'preset-b')

    expect(storedPresetIds(DIRECTION)).toEqual(['preset-b'])
    expect(boundPresetIds(root.root, DIRECTION)).toEqual(['preset-b'])
    // 「拖到哪一级就落在哪一级」由存储值证明，行上不再标「本级自定义」
    expect(rowText(root.root, DIRECTION)).not.toContain('本级自定义')
  })

  it('库多选的水印点一次「+」就全部绑上，顺序即产出顺序', () => {
    const root = render({ librarySelection: ['preset-b', 'preset-a'] })
    clickByAriaLabel(root.root, '把水印绑定到 智能客服')

    expect(storedPresetIds(LINE)).toEqual(['preset-b', 'preset-a'])
    expect(boundPresetIds(root.root, LINE)).toEqual(['preset-b', 'preset-a'])
  })

  it('拖拽只认预设库的类型，别的拖放不会误绑', () => {
    const root = render()
    const target = dropTargetOf(root.root, LINE)
    act(() => {
      target.props.onDrop({
        dataTransfer: { types: ['text/plain'], getData: () => 'preset-b' },
        preventDefault: () => {},
        stopPropagation: () => {},
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
    // 回到继承态后连「恢复继承」这个出口也一起消失（本级已经没有覆盖可摘）
    expect(
      findNodeRow(root.root, DIRECTION).findAll((node) => node.props['aria-label'] === '恢复 竖版展示 的水印继承'),
    ).toHaveLength(0)
  })

  it('显式「这个方向不加水印」不再靠标签表达，只剩「恢复继承」这个出口', () => {
    useProjectTreeParamsStore.setState({
      params: { [DIRECTION]: { postprocess: { watermarkPresetIds: [] } } },
    })
    const root = render()
    expand(root.root, '智能客服')
    expand(root.root, '机器人')

    // 撤掉「本级自定义 / 不加水印」之后，显式空数组在行上就是一片空白——视觉上等于「没有水印」
    expect(boundPresetIds(root.root, DIRECTION)).toEqual([])
    expect(rowText(root.root, DIRECTION)).not.toContain('不加水印')
    // 但它仍是「本级表过态」而不是「没表态」，必须留一条回到继承的路。
    // 没表过态的兄弟节点没有这个出口 —— 这是两者现在唯一可见的区别。
    expect(
      findNodeRow(root.root, DIRECTION).findAll((node) => node.props['aria-label'] === '恢复 竖版展示 的水印继承'),
    ).toHaveLength(1)
    expect(
      findNodeRow(root.root, PRODUCT).findAll((node) => node.props['aria-label'] === '恢复 机器人 的水印继承'),
    ).toHaveLength(0)
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

  it('树上不显示与「用哪几套水印」无关的后处理状态', () => {
    // 启用范围属于后处理的配置，不归归属树管。留在树上会让「未启用」看起来像归属失效，
    // 而用户要做的是去后处理里改启用范围，不是在树上折腾水印。
    usePostprocessMediaStore.setState({ selectedCollectionIds: [] })
    const root = render()
    expect(rowText(root.root, LINE)).toBe('智能客服')
  })

  it('「按渠道」是节点行上一个图标入口而不是标签，点开就地改该渠道专属的水印', () => {
    // 归属的编辑入口只有树这一个。渠道分叉（同一方向在厂商/百度叠不同水印）也必须在这里改，
    // 否则源表那 56 个按渠道分叉的方向就没有地方维护。但它是**动作**，不该占树的一行。
    const root = render()

    expect(rowText(root.root, LINE)).not.toContain('按渠道')
    clickByAriaLabel(root.root, '智能客服 的按渠道水印')
    expect(getNodeText(root.root)).toContain('勾选 = 该渠道单独用这套')

    // 第一个渠道（厂商）下的第一个预设：勾上 → 落成该渠道的显式数组
    const firstUnchecked = root.root
      .findAll((node) => node.type === 'input' && node.props.type === 'checkbox')
      .find((node) => node.props.checked === false)
    act(() => {
      firstUnchecked!.props.onChange({ target: { checked: true } })
    })

    const byMedia = useProjectTreeParamsStore.getState().params[LINE]?.postprocess?.byMedia ?? {}
    const entries = Object.entries(byMedia)
    expect(entries).toHaveLength(1)
    expect(entries[0]![1].watermarkPresetIds).toEqual([PRESET_A.id])
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
    clickByAriaLabel(root.root, '把水印绑定到 智能客服')
    expect(showToast).toHaveBeenCalledWith('已把水印「糖包角标」绑到「智能客服」', 'success')
  })
})

describe('PresetProjectTree 层级管理', () => {
  it('菜单里新建子节点，建完直接进重命名输入框', async () => {
    const root = render()
    expand(root.root, '智能客服')

    clickByAriaLabel(root.root, '智能客服 的更多操作')
    clickMenuItem(root.root, '新建子节点')
    await act(async () => {})

    const created = collectionsInStore().find((item) => !COLLECTIONS.some((original) => original.id === item.id))
    // 层级语义给默认名：产品线下面新建的就是「产品」
    expect(created?.name).toBe('新产品')
    expect(created?.parentId).toBe(LINE)
    expect(collectionsInStore()).toHaveLength(4)
    // 建完立刻可改名，省掉「建完再回头找它改名」这一步
    expect(findInputByAriaLabel(root.root, '重命名 新产品')).toBeDefined()
  })

  it('双击节点名进入重命名，回车落到项目树上', async () => {
    const root = render()
    const nameButton = findNodeRow(root.root, LINE).find(
      (node) => typeof node.props.onDoubleClick === 'function' && getNodeText(node) === '智能客服',
    )
    act(() => nameButton.props.onDoubleClick())

    act(() => findInputByAriaLabel(root.root, '重命名 智能客服')!.props.onChange({ target: { value: 'AI 客服' } }))
    await act(async () => {
      findInputByAriaLabel(root.root, '重命名 智能客服')!.props.onKeyDown({ key: 'Enter', preventDefault: () => {} })
    })

    expect(collectionsInStore().find((item) => item.id === LINE)?.name).toBe('AI 客服')
    expect(getNodeText(root.root)).toContain('AI 客服')
  })

  it('改名改成空白等于放弃，不会把节点名清掉', async () => {
    const root = render()
    const nameButton = findNodeRow(root.root, LINE).find(
      (node) => typeof node.props.onDoubleClick === 'function' && getNodeText(node) === '智能客服',
    )
    act(() => nameButton.props.onDoubleClick())

    act(() => findInputByAriaLabel(root.root, '重命名 智能客服')!.props.onChange({ target: { value: '   ' } }))
    await act(async () => {
      findInputByAriaLabel(root.root, '重命名 智能客服')!.props.onKeyDown({ key: 'Enter', preventDefault: () => {} })
    })

    expect(collectionsInStore().find((item) => item.id === LINE)?.name).toBe('智能客服')
  })

  it('删除先弹确认（含子级数量），确认后才真的删', async () => {
    const root = render()
    clickByAriaLabel(root.root, '智能客服 的更多操作')
    clickMenuItem(root.root, '删除')

    expect(dialogMocks.openConfirmDialog).toHaveBeenCalledTimes(1)
    const options = dialogMocks.openConfirmDialog.mock.calls[0]![0] as {
      message: string
      action: () => Promise<void>
    }
    expect(options.message).toContain('2 个子级')
    // 没确认之前树不动
    expect(collectionsInStore()).toHaveLength(3)

    await act(async () => {
      await options.action()
    })
    expect(collectionsInStore()).toHaveLength(0)
  })

  it('把节点拖到另一个节点上即换父级', async () => {
    useAssetLibraryStore.setState({ collections: [...COLLECTIONS, collection(OTHER_LINE, '电商', null, 1)] })
    const root = render()
    expand(root.root, '智能客服')

    await dropNode(root.root, PRODUCT, OTHER_LINE)

    expect(parentOf(PRODUCT)).toBe(OTHER_LINE)
    // 节点拖拽不是「绑水印」：不能顺手往参数里写东西
    expect(storedPresetIds(OTHER_LINE)).toBeUndefined()
    expect(storedPresetIds(PRODUCT)).toBeUndefined()
  })

  it('把节点拖进自己的子级会被拒绝，树不动', () => {
    const showToast = vi.spyOn(useStore.getState(), 'showToast')
    const root = render()
    expand(root.root, '智能客服')
    expand(root.root, '机器人')

    dropNode(root.root, LINE, DIRECTION)

    expect(showToast).toHaveBeenCalledWith('不能把文件夹放进它自己的子级里', 'error')
    expect(parentOf(LINE)).toBeNull()
    expect(parentOf(PRODUCT)).toBe(LINE)
  })
})
