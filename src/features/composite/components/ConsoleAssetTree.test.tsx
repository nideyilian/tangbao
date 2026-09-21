/**
 * 中控台左栏「配置资产库」树的行为测试（2026-09-21 改版后：**两级 = 配置维度 → 作用域**）。
 *
 * 锁六件事，其中后三件是这次改版的核心承诺：
 * 1. 「全局默认」总览项存在且徽章 = 节点总数（灵境「全部策略 N」的对应物）；
 * 2. 点节点 = 切作用域（`onValueChange` 收到节点 id）；
 * 3. 点维度组 = 切维度（`onSectionChange` 收到维度 id）；
 * 4. **纯全局维度的组里不铺方向树** —— 约束由结构表达，不靠文案警告；
 * 5. **点纯全局维度会把作用域一并归位到「全局默认」** —— 否则右区标题写着某方向、
 *    内容却是全局一套，等于自己制造一次「所见非所改」；
 * 6. 覆盖徽章按**当前维度**计，不是「总共写了几个字段」——
 *    在输出位置维度看到「1」、在水印维度看到「0」，才答得了「这个维度下谁偏离了全局」。
 */

import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleAssetTree } from './ConsoleAssetTree'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import type { ControlConsoleSectionId } from '../lib/controlConsoleSections'
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
      // 月亮写了输出目录 ⇒ 它在「输出位置」维度下偏离了全局；水印维度下没写
      'direction-moon': { postprocess: { outputDir: 'D:/月亮' } },
    },
  })
}

interface TreeProps {
  section?: ControlConsoleSectionId
  onSectionChange?: (section: ControlConsoleSectionId) => void
  value?: string
  onValueChange?: (value: string) => void
}

/** 必须在 `act` 里创建，否则拿不到已挂载的树 */
function renderTree(props: TreeProps = {}) {
  const { section = 'watermark', onSectionChange = () => {}, value = GLOBAL_NODE_ID, onValueChange = () => {} } = props
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(
      <ConsoleAssetTree
        section={section}
        onSectionChange={onSectionChange}
        value={value}
        onValueChange={onValueChange}
      />,
    )
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

/** 取渲染树里所有「无 aria-label」按钮的可见文本（有 aria-label 的是展开箭头，不参与文本匹配） */
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

/** 按可访问名点按钮（展开箭头用这个，它们的 children 是图标、没有文本） */
function clickByAriaLabel(renderer: ReturnType<typeof create>, label: string) {
  const node = renderer.root.find((item) => item.props['aria-label'] === label)
  act(() => {
    ;(node.props.onClick as () => void)()
  })
}

describe('ConsoleAssetTree（两级：配置维度 → 作用域）', () => {
  beforeEach(() => {
    seedStores()
  })

  it('五个配置维度都在树上（维度由树承载，不再是独立的下拉）', () => {
    const renderer = renderTree()
    for (const label of ['水印', '渠道与尺寸', '输出位置', '分发', '方向']) {
      // 维度行带 aria-label（它的可见文本后面会跟计数徽章，拿文本定位不稳）
      expect(
        renderer.root.findAll((node) => node.props['aria-label'] === `配置维度 ${label}`).length,
        `树上缺少维度「${label}」`,
      ).toBe(1)
    }
  })

  it('默认展开当前维度组：水印组下有「全局默认」+ 节点，徽章 = 节点总数', () => {
    const renderer = renderTree({ section: 'watermark' })
    const globalRow = renderer.root.find((node) => node.props['aria-label'] === '水印 · 全局默认')
    // 4 个节点（产品线A / 产品A / 月亮 / 太阳）
    expect(collectText(globalRow.props.children)).toBe('全局默认4')
    expect(buttonLabels(renderer).some((label) => label.includes('月亮'))).toBe(true)
  })

  it('点维度组 = 切维度：onSectionChange 收到维度 id', () => {
    const onSectionChange = vi.fn()
    const renderer = renderTree({ onSectionChange })
    clickButton(renderer, '输出位置')
    expect(onSectionChange).toHaveBeenCalledWith('output')
  })

  it('纯全局维度的组里**不铺方向树**：只有「全局一套」一行，没有节点', () => {
    // 初始只展开当前维度（media），水印组是折叠的 —— 所以月亮本就不该出现
    const renderer = renderTree({ section: 'media' })
    const globalRow = renderer.root.find((node) => node.props['aria-label'] === '渠道与尺寸 · 全局默认')
    expect(collectText(globalRow.props.children)).toContain('全局一套（不按方向分）')

    const allTexts = renderer.root
      .findAll((node) => node.type === 'button')
      .map((node) => collectText(node.props.children))
    expect(allTexts.some((label) => label.includes('月亮'))).toBe(false)
    expect(allTexts.some((label) => label.includes('产品线A'))).toBe(false)
  })

  it('维度组可折叠：折叠后组内的作用域节点不再渲染', () => {
    const renderer = renderTree({ section: 'watermark' })
    expect(buttonLabels(renderer).some((label) => label.includes('月亮'))).toBe(true)
    clickByAriaLabel(renderer, '收起配置维度 水印')
    expect(buttonLabels(renderer).some((label) => label.includes('月亮'))).toBe(false)
  })

  it('⭐ 点纯全局维度会把作用域一并归位到「全局默认」（不能只切维度）', () => {
    const onSectionChange = vi.fn()
    const onValueChange = vi.fn()
    const renderer = renderTree({
      section: 'watermark',
      value: 'direction-moon',
      onSectionChange,
      onValueChange,
    })
    clickButton(renderer, '渠道与尺寸')
    expect(onSectionChange).toHaveBeenCalledWith('media')
    expect(onValueChange).toHaveBeenCalledWith(GLOBAL_NODE_ID)
  })

  it('点按方向分的维度时保留当前作用域（切回来还在原处）', () => {
    const onSectionChange = vi.fn()
    const onValueChange = vi.fn()
    const renderer = renderTree({
      section: 'watermark',
      value: 'direction-moon',
      onSectionChange,
      onValueChange,
    })
    clickButton(renderer, '输出位置')
    expect(onSectionChange).toHaveBeenCalledWith('output')
    expect(onValueChange).toHaveBeenCalledWith('direction-moon')
  })

  it('点节点 = 切作用域：onValueChange 收到节点 id', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ onValueChange })
    clickButton(renderer, '月亮')
    expect(onValueChange).toHaveBeenCalledWith('direction-moon')
  })

  it('点「全局默认」= 回到全局基线', () => {
    const onValueChange = vi.fn()
    const renderer = renderTree({ value: 'direction-moon', onValueChange })
    clickButton(renderer, '全局默认')
    expect(onValueChange).toHaveBeenCalledWith(GLOBAL_NODE_ID)
  })

  it('覆盖徽章按当前维度计：输出位置维度下月亮有、水印维度下没有', () => {
    const inOutput = renderTree({ section: 'output' })
    const outputLabels = buttonLabels(inOutput)
    expect(outputLabels.some((label) => label === '月亮1')).toBe(true)

    const inWatermark = renderTree({ section: 'watermark' })
    const watermarkLabels = buttonLabels(inWatermark)
    // 月亮没写 watermarkPresetIds ⇒ 在这个维度上不算偏离全局
    expect(watermarkLabels.some((label) => label === '月亮1')).toBe(false)
    expect(watermarkLabels.some((label) => label === '月亮')).toBe(true)
  })

  it('搜索过滤：命中节点保留，无关节点剪掉', () => {
    const renderer = renderTree()
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
