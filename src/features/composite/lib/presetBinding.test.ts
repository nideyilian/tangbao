import { describe, expect, it } from 'vitest'
import type { CompositeV2Preset } from './compositeV2Types'
import { bindPresetToNode, summarizeBoundPresets, unbindPresetFromNode } from './presetBinding'

function preset(id: string, name = id): CompositeV2Preset {
  return { id, name, baseCanvas: { width: 1, height: 1 }, sampleBackgroundPath: '', layers: [], updatedAt: 0 }
}

describe('bindPresetToNode', () => {
  it('追加到末尾（数组顺序即产出顺序）', () => {
    expect(bindPresetToNode(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('已绑过的不重复追加，且返回原引用（避免无意义的重渲染）', () => {
    const current = ['a', 'b']
    expect(bindPresetToNode(current, 'a')).toBe(current)
  })

  it('空串与纯空白不写入（拖拽/输入都可能给出空 id）', () => {
    const current = ['a']
    expect(bindPresetToNode(current, '')).toBe(current)
    expect(bindPresetToNode(current, '   ')).toBe(current)
  })

  it('两侧空白被裁掉后再判重', () => {
    expect(bindPresetToNode(['a'], ' a ')).toEqual(['a'])
    expect(bindPresetToNode([], ' b ')).toEqual(['b'])
  })

  it('不修改传入数组（纯函数）', () => {
    const current = ['a']
    bindPresetToNode(current, 'b')
    expect(current).toEqual(['a'])
  })
})

describe('unbindPresetFromNode', () => {
  it('摘掉指定项，其余顺序不变', () => {
    expect(unbindPresetFromNode(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('摘掉最后一项返回空数组——这是「这个方向不加水印」的显式表达，不是继承', () => {
    expect(unbindPresetFromNode(['a'], 'a')).toEqual([])
  })

  it('没绑过时返回原引用', () => {
    const current = ['a']
    expect(unbindPresetFromNode(current, 'zzz')).toBe(current)
  })

  it('空串不误删任何东西', () => {
    const current = ['a']
    expect(unbindPresetFromNode(current, '')).toBe(current)
  })

  it('不修改传入数组（纯函数）', () => {
    const current = ['a', 'b']
    unbindPresetFromNode(current, 'a')
    expect(current).toEqual(['a', 'b'])
  })
})

describe('summarizeBoundPresets', () => {
  it('按绑定顺序解析成预设对象', () => {
    const summary = summarizeBoundPresets(['b', 'a'], [preset('a', '角标'), preset('b', '标题条')])
    expect(summary.presets.map((item) => item.name)).toEqual(['标题条', '角标'])
    expect(summary.missingIds).toEqual([])
  })

  it('已删除的预设单独列出来，不静默少显示一个', () => {
    // 绑定值跟着节点参数走，预设被删时没有任何清理路径，必须让用户看见
    const summary = summarizeBoundPresets(['a', 'gone-1', 'gone-2'], [preset('a')])
    expect(summary.presets.map((item) => item.id)).toEqual(['a'])
    expect(summary.missingIds).toEqual(['gone-1', 'gone-2'])
  })

  it('空绑定返回空结果，不抛错', () => {
    expect(summarizeBoundPresets([], [preset('a')])).toEqual({ presets: [], missingIds: [] })
    expect(summarizeBoundPresets(['a'], [])).toEqual({ presets: [], missingIds: ['a'] })
  })
})
