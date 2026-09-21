/* @vitest-environment jsdom */

/**
 * 文件命名区：命名模板（中文显示）+ **文件名预览** + 创作者。
 *
 * 预览这一块要回答的是「按现在这个模板，产出文件叫什么」，所以它必须
 * 用**真实的当前作用域**拼，而不是编一个固定示例 —— 否则用户看到的名字跟他实际会拿到的
 * 不是一回事，预览就成了摆设。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import PostprocessNamingFields from './PostprocessNamingFields'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function getNodeText(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : getNodeText(child))).join('')
}

function render() {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<PostprocessNamingFields />)
  })
  return renderer
}

/** 预览那一行的整行文本（含「文件名预览」标签与可能的说明） */
function previewText(renderer: ReturnType<typeof create>) {
  return getNodeText(renderer.root.find((node) => node.props['data-layout'] === 'name-preview'))
}

describe('PostprocessNamingFields · 文件名预览', () => {
  beforeEach(() => {
    usePostprocessMediaStore.setState({
      namePattern: '{date}-{product}-{direction}-{media}-{size}-{seq}',
      creator: '糖包',
      media: [
        {
          id: 'toutiao',
          name: '头条',
          enabled: true,
          sizes: [{ id: 't1', width: 1280, height: 720, maxSizeKb: 399, enabled: true }],
        },
      ] as never,
      selectedMediaIds: ['toutiao'],
      watermarkPresetIds: [],
    })
    useAssetLibraryStore.setState({ scope: 'all', collections: [] })
    useProjectTreeParamsStore.setState({ params: {} })
  })

  it('⭐ 预览按模板拼出完整文件名（含扩展名）', () => {
    const renderer = render()
    const text = previewText(renderer)
    // 渠道与尺寸来自真实的渠道表，不是写死的示例
    expect(text).toContain('头条')
    expect(text).toContain('1280x720')
    // 扩展名要一起显示：用户关心的是最终交付的文件名
    expect(text).toContain('.jpg')
    // 日期段是当天的 YYYYMMDD（不锁具体日期，否则测试第二天就红）
    expect(text).toMatch(/\d{8}-/)
  })

  it('⭐ 左树选中的方向名会进文件名', () => {
    useAssetLibraryStore.setState({
      scope: { kind: 'collection', id: 'direction-moon' },
      collections: [
        { id: 'line-a', name: '保险', parentId: null, order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'product-b', name: '百万医疗险', parentId: 'line-a', order: 0, createdAt: 0, updatedAt: 0 },
        { id: 'direction-moon', name: '月亮', parentId: 'product-b', order: 0, createdAt: 0, updatedAt: 0 },
      ] as never,
    })

    const text = previewText(render())
    expect(text).toContain('百万医疗险')
    expect(text).toContain('月亮')
  })

  it('未选方向时明说产品/方向两段为空，而不是编一个假名字', () => {
    // 全局默认下真的没有归属，编个「示例产品」会让用户以为产出会带这个名字
    expect(previewText(render())).toContain('未选方向')
  })

  it('改模板立刻反映到预览上', () => {
    const renderer = render()
    act(() => {
      usePostprocessMediaStore.setState({ namePattern: 'X-{media}-{seq}' })
    })
    expect(previewText(renderer)).toContain('X-头条-1.jpg')
  })
})
