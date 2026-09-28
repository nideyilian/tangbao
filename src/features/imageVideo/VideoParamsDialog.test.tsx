/* @vitest-environment jsdom */

/**
 * 视频参数弹窗：按「方向 × 渠道」读写。
 *
 * 断言口径是**写得进、不串台、清得掉**，而不是「渲染出来了」：
 *
 * - 显示的是**生效值**（渠道那份盖住节点缺省那份）；
 * - 改字段只写 `imageVideoByMedia[本渠道]` —— 不碰别的渠道，也不碰节点缺省那份
 *   （那份是 2026-09-28 之前的老配置，改错了用户会看到「改了 A 渠道、B 渠道跟着变」）；
 * - 「恢复默认」把本渠道这一层清空（整键消失，不是留一堆 `undefined`）；
 * - 「应用到其它渠道」把那层覆盖复制过去。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMAGE_VIDEO_PARAMS } from './types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { useImageVideoStore } from './store'
import { VideoParamsDialog } from './VideoParamsDialog'
import type { AssetCollection } from '../../types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIRECTION = 'direction-a'

const COLLECTIONS: AssetCollection[] = [
  {
    id: 'product-a',
    name: '机器人',
    normalizedName: '机器人',
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: DIRECTION,
    name: '竖版展示',
    normalizedName: '竖版展示',
    parentId: 'product-a',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  useAssetLibraryStore.setState({ collections: COLLECTIONS })
  useImageVideoStore.setState({ globals: { ...DEFAULT_IMAGE_VIDEO_PARAMS } })
  useProjectTreeParamsStore.setState({ params: {} })
  // 库读不到不影响参数编辑；jsdom 里没有 electronAPI，这里直接把 loadVideoLibrary 的失败咽掉
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  vi.restoreAllMocks()
})

function renderDialog(mediaId = 'gdt', mediaName = '广点通') {
  act(() => {
    root = createRoot(container)
    root.render(
      <VideoParamsDialog
        scope={DIRECTION}
        scopeLabel="竖版展示"
        mediaId={mediaId}
        mediaName={mediaName}
        otherMedias={[{ id: 'baidu', name: '百度' }]}
        onClose={() => {}}
      />,
    )
  })
}

/** 第一个数字框就是「图片数/视频」（节奏组的第一项）。 */
function firstNumberInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="number"]')
  if (!input) throw new Error('没找到数字输入框')
  return input
}

function commitNumber(value: string) {
  const input = firstNumberInput()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

function overridesOf(mediaId: string) {
  return useProjectTreeParamsStore.getState().params[DIRECTION]?.imageVideoByMedia?.[mediaId]
}

describe('VideoParamsDialog', () => {
  it('显示调的是生效值：渠道那份盖住节点缺省那份', () => {
    useProjectTreeParamsStore.setState({
      params: {
        [DIRECTION]: {
          imageVideo: { imagesPerVideo: 9 },
          imageVideoByMedia: { gdt: { imagesPerVideo: 3 } },
        },
      },
    })
    renderDialog('gdt')
    expect(firstNumberInput().value).toBe('3')

    act(() => root.unmount())
    container.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    // 同一个方向、换一个没单独配过的渠道 → 落到节点缺省那份
    renderDialog('baidu', '百度')
    expect(firstNumberInput().value).toBe('9')
  })

  it('⭐ 改一个字段只写本渠道那一层：别的渠道与节点缺省那份都一个字节不动', () => {
    useProjectTreeParamsStore.setState({
      params: {
        [DIRECTION]: {
          imageVideo: { imagesPerVideo: 9 },
          imageVideoByMedia: { baidu: { imagesPerVideo: 5 } },
        },
      },
    })
    renderDialog('gdt')
    commitNumber('7')

    expect(overridesOf('gdt')).toEqual({ imagesPerVideo: 7 })
    expect(overridesOf('baidu')).toEqual({ imagesPerVideo: 5 })
    expect(useProjectTreeParamsStore.getState().params[DIRECTION]?.imageVideo).toEqual({ imagesPerVideo: 9 })
  })

  it('清空输入框 = 恢复默认，而不是写 0（0 在总时长那儿另有含义）', () => {
    useProjectTreeParamsStore.setState({
      params: { [DIRECTION]: { imageVideoByMedia: { gdt: { imagesPerVideo: 4 } } } },
    })
    renderDialog('gdt')
    commitNumber('')

    expect(overridesOf('gdt')).toBeUndefined()
  })

  it('「恢复默认」清掉本渠道这一层，节点缺省那份留着', () => {
    useProjectTreeParamsStore.setState({
      params: {
        [DIRECTION]: {
          imageVideo: { imagesPerVideo: 9 },
          imageVideoByMedia: { gdt: { imagesPerVideo: 3, bitrate: 5000 } },
        },
      },
    })
    renderDialog('gdt')
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('恢复默认'))
    if (!button) throw new Error('没找到「恢复默认」按钮')
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(overridesOf('gdt')).toBeUndefined()
    expect(useProjectTreeParamsStore.getState().params[DIRECTION]?.imageVideo).toEqual({ imagesPerVideo: 9 })
  })

  it('「应用到本方向的其它渠道」把那层覆盖复制过去', () => {
    useProjectTreeParamsStore.setState({ params: { [DIRECTION]: { imageVideoByMedia: { gdt: { bitrate: 5000 } } } } })
    renderDialog('gdt')
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('应用到'))
    if (!button) throw new Error('没找到「应用到」按钮')
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(overridesOf('baidu')).toEqual({ bitrate: 5000 })
    expect(overridesOf('gdt')).toEqual({ bitrate: 5000 })
  })
})
