/* @vitest-environment jsdom */

/**
 * 视频参数弹窗：按「方向 × 渠道」读写。
 *
 * 断言口径是**写得进、不串台、清得掉**，而不是「渲染出来了」：
 *
 * - 显示的是**生效值**（渠道那份盖住节点缺省那份）；
 * - 改字段只写 `imageVideoByMedia[本渠道]` —— 不碰别的渠道，也不碰节点缺省那份
 *   （那份是 2026-09-28 之前的老配置，改错了用户会看到「改了 A 渠道、B 渠道跟着变」）；
 * - 「恢复」把本渠道这一层清空（整键消失，不是留一堆 `undefined`）；
 * - 「应用到其它渠道」把那层覆盖复制过去。
 *
 * 2026-09-29 补的两条**回归**（这一版修的正是它们）：
 * ① 「输出位置」「文件命名」写不进值 —— 那两格此前被按数字字段渲染，浏览器把非数字输入
 *    清成空串，失焦时按「留空 = 恢复默认」提交，等于白填；现在一个走目录选择器、
 *    一个走命名模板，测试盯的就是「值真的进了 store」。
 * ② 「恢复默认」拆成了「恢复本组 / 全部恢复」—— 后者清哪些字段由 `IMAGE_VIDEO_FIELD_KEYS`
 *    决定，所以这里比对它与 `DEFAULT_IMAGE_VIDEO_PARAMS` 的键集：**新增字段忘了登记就会红**。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMAGE_VIDEO_PARAMS } from './types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { useImageVideoStore } from './store'
import { IMAGE_VIDEO_FIELD_KEYS, VideoParamsDialog } from './VideoParamsDialog'
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
  // 命名模板输入框插入变量后会把光标摆回去（`requestAnimationFrame`）；jsdom 下直接同步执行，
  // 免得断言跑在那一帧之前
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
  // 库读不到不影响参数编辑；jsdom 里没有 electronAPI，这里直接把 loadVideoLibrary 的失败咽掉
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
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

/** 命名模板输入框（`NamePatternField` 上挂了 testid）。 */
function nameInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('[data-testid="name-pattern-input"]')
  if (!input) throw new Error('没找到命名模板输入框')
  return input
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`没找到按钮：${text}`)
  return button as HTMLButtonElement
}

/** 受控输入要这样写值：React 记的是内部 value 描述符，直接赋值它收不到。 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function blur(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

function commitNumber(value: string) {
  const input = firstNumberInput()
  typeInto(input, value)
  blur(input)
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
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

  it('「全部恢复默认」清掉本渠道这一层，节点缺省那份留着', () => {
    useProjectTreeParamsStore.setState({
      params: {
        [DIRECTION]: {
          imageVideo: { imagesPerVideo: 9 },
          imageVideoByMedia: { gdt: { imagesPerVideo: 3, bitrate: 5000 } },
        },
      },
    })
    renderDialog('gdt')
    click(buttonByText('全部恢复默认'))

    expect(overridesOf('gdt')).toBeUndefined()
    expect(useProjectTreeParamsStore.getState().params[DIRECTION]?.imageVideo).toEqual({ imagesPerVideo: 9 })
  })

  it('「恢复本组默认」只清本组：节奏组的清了，画面组的还在', () => {
    useProjectTreeParamsStore.setState({
      params: { [DIRECTION]: { imageVideoByMedia: { gdt: { imagesPerVideo: 3, bitrate: 5000 } } } },
    })
    renderDialog('gdt')
    click(buttonByText('恢复「节奏」默认'))

    expect(overridesOf('gdt')).toEqual({ bitrate: 5000 })
  })

  it('「应用到本方向的其它渠道」把那层覆盖复制过去', () => {
    useProjectTreeParamsStore.setState({ params: { [DIRECTION]: { imageVideoByMedia: { gdt: { bitrate: 5000 } } } } })
    renderDialog('gdt')
    click(buttonByText('应用到'))

    expect(overridesOf('baidu')).toEqual({ bitrate: 5000 })
    expect(overridesOf('gdt')).toEqual({ bitrate: 5000 })
  })

  /**
   * ⭐ 本次修的根因：这一格此前和数字字段共用渲染路径，填什么都进不了 store。
   * 断言到 store 才算数 —— 「输入框里显示着」正是当年骗过人的地方。
   *
   * 输入框里是中文（`{产品}`/`{媒体}`，变量按钮上的叫法），落盘的必须是 `{token}`。
   */
  it('⭐ 文件命名模板写得进去（显示中文、落盘仍是 {token}）', () => {
    renderDialog('gdt')
    typeInto(nameInput(), '{产品}-{媒体}')

    expect(overridesOf('gdt')?.namePattern).toBe('{product}-{media}')
  })

  it('⭐ 输出位置：点「选择文件夹」把选中的路径写进本渠道', async () => {
    const selectDirectory = vi.fn(async () => 'D:/成片/广点通')
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = { selectDirectory }
    renderDialog('gdt')

    await act(async () => {
      buttonByText('选择文件夹').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(selectDirectory).toHaveBeenCalled()
    expect(overridesOf('gdt')?.outputDir).toBe('D:/成片/广点通')
  })

  it('用户取消选择（返回 null）不当成「清空」', async () => {
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = { selectDirectory: async () => null }
    useProjectTreeParamsStore.setState({
      params: { [DIRECTION]: { imageVideoByMedia: { gdt: { outputDir: 'D:/旧位置' } } } },
    })
    renderDialog('gdt')

    await act(async () => {
      buttonByText('选择文件夹').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(overridesOf('gdt')?.outputDir).toBe('D:/旧位置')
  })

  it('没表态的字段用灰字写出上层生效值 —— 不用打开上层就知道现在用的是几', () => {
    useProjectTreeParamsStore.setState({ params: { [DIRECTION]: { imageVideo: { imagesPerVideo: 9 } } } })
    renderDialog('gdt')

    expect(firstNumberInput().placeholder).toBe('跟随 9')
    expect(firstNumberInput().value).toBe('9')
  })

  it('数字越界当场报出范围，落盘仍按范围钳制（提示给人看、钳制给数据兜底）', () => {
    renderDialog('gdt')
    const input = firstNumberInput()
    typeInto(input, '999')

    expect(container.textContent).toContain('范围 1~200')

    blur(input)
    expect(overridesOf('gdt')?.imagesPerVideo).toBe(200)
  })

  /**
   * 这一份测试树只有两级（产品 → 方向），没有产品线，所以 `{product}` 取不到值 ——
   * 正好顺带验证「取不到的段整段消失」，而不是留下 `A--B`。
   */
  it('文件名预览用的是生效模板：方向 / 渠道两段 + 末尾序号（取不到的段自动消失）', () => {
    renderDialog('gdt')

    expect(container.textContent).toContain('竖版展示-广点通-1.mp4')
  })

  it('模板里有视频兑现不了的占位符时当场提示（别等跑完视频才发现名字不对）', () => {
    useProjectTreeParamsStore.setState({
      params: { [DIRECTION]: { imageVideoByMedia: { gdt: { namePattern: '{preset}-{product}' } } } },
    })
    renderDialog('gdt')

    expect(container.textContent).toContain('不认识的占位符')
  })

  it('⭐ 「全部恢复」的字段清单必须覆盖每一个参数（新增字段忘了登记就会红）', () => {
    const covered = [...IMAGE_VIDEO_FIELD_KEYS].sort()
    const all = Object.keys(DEFAULT_IMAGE_VIDEO_PARAMS).sort()
    expect(covered).toEqual(all)
  })
})
