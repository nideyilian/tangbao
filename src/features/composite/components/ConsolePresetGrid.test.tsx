/**
 * 中控台水印卡片网格的行为测试。
 *
 * 锁的是**同一个「方向自带参数」模型的两个视角**——这是最容易做错的一处：
 * - 全局默认：徽章回答「谁在用它」⇒ `N 个方向在用` / `未使用`；
 * - 选中方向：徽章回答「这个方向用不用它」⇒ `已启用` / `未启用`，并且卡上给开关。
 *
 * 另外锁「每行数量」真的作用到排布上（内联 `grid-template-columns`），
 * 因为 Tailwind 无法为运行时变量生成类名，这里一旦写错不会报错、只会静默变成单列。
 *
 * 卡片封面在测试环境（无 canvas 2d）必然渲染失败并退化为尺寸占位块 —— 那是刻意设计：
 * 单张渲染失败不该让整片网格空白。所以这里断言的是**文本信息**，不是像素。
 */

import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { ConsolePresetGrid } from './ConsolePresetGrid'
import type { CompositeV2Preset } from '../lib/compositeV2Types'

function makePreset(id: string, name: string): CompositeV2Preset {
  return {
    id,
    name,
    baseCanvas: { width: 1080, height: 1920 },
    sampleBackgroundPath: '',
    layers: [],
    updatedAt: 0,
  } as CompositeV2Preset
}

const presets = [makePreset('p-1', '月亮水印'), makePreset('p-2', '太阳水印')]

function renderGrid(overrides: Partial<Parameters<typeof ConsolePresetGrid>[0]> = {}) {
  const props: Parameters<typeof ConsolePresetGrid>[0] = {
    presets,
    perRow: 3,
    view: 'grid',
    inNodeScope: false,
    isEnabled: () => false,
    usedByCount: () => 0,
    selectedIds: [],
    onToggleSelect: () => {},
    onToggleEnabled: () => {},
    onEdit: () => {},
    onDuplicate: () => {},
    onDelete: () => {},
    emptyHint: '没有预设',
    ...overrides,
  }
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<ConsolePresetGrid {...props} />)
  })
  return renderer
}

/** 收集渲染树里所有文本 */
function allText(renderer: ReturnType<typeof create>) {
  const parts: string[] = []
  const walk = (children: unknown) => {
    if (typeof children === 'string') parts.push(children)
    else if (typeof children === 'number') parts.push(String(children))
    else if (Array.isArray(children)) children.forEach(walk)
    else if (children && typeof children === 'object' && 'props' in (children as Record<string, unknown>)) {
      walk((children as { props: { children?: unknown } }).props.children)
    }
  }
  for (const node of renderer.root.findAll((item) => typeof item.type === 'string')) walk(node.props.children)
  return parts.join('|')
}

describe('ConsolePresetGrid', () => {
  it('全局作用域下徽章显示有多少方向在用', () => {
    const renderer = renderGrid({ usedByCount: (id) => (id === 'p-1' ? 2 : 0) })
    const text = allText(renderer)
    expect(text).toContain('2 个方向在用')
    expect(text).toContain('未使用')
  })

  it('方向作用域下徽章显示已启用 / 未启用，且卡上给开关', () => {
    const renderer = renderGrid({ inNodeScope: true, isEnabled: (id) => id === 'p-1' })
    const text = allText(renderer)
    expect(text).toContain('已启用')
    expect(text).toContain('未启用')
    // 开停用按钮只在方向作用域出现
    expect(text).toContain('停用')
    expect(text).toContain('启用')
  })

  it('全局作用域下不给开停用按钮（全局清单没有写入点，给了就是假控件）', () => {
    const renderer = renderGrid({ inNodeScope: false })
    const labels = renderer.root
      .findAll((node) => typeof node.props['aria-label'] === 'string')
      .map((node) => String(node.props['aria-label']))
    expect(labels.some((label) => label.startsWith('启用 '))).toBe(false)
    expect(labels.some((label) => label.startsWith('停用 '))).toBe(false)
  })

  it('每行数量真的作用到排布上（内联 grid-template-columns）', () => {
    const renderer = renderGrid({ perRow: 5 })
    const grid = renderer.root.findAll((node) => node.props['data-layout'] === 'console-preset-grid')[0]
    expect(grid.props.style.gridTemplateColumns).toBe('repeat(5, minmax(0, 1fr))')
  })

  it('列表视图不写 grid-template-columns（否则会在 flex 容器上留下无效样式）', () => {
    const renderer = renderGrid({ view: 'list' })
    const grid = renderer.root.findAll((node) => node.props['data-layout'] === 'console-preset-grid')[0]
    expect(grid.props.style).toBeUndefined()
  })

  it('没有卡片时给空态说明', () => {
    const renderer = renderGrid({ presets: [], emptyHint: '水印库是空的' })
    expect(allText(renderer)).toContain('水印库是空的')
  })
})
