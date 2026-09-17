/* @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskPostprocessOutput, type TaskRecord } from '../types'
import TaskPostprocessModal, { getPostprocessOutputFileName } from './TaskPostprocessModal'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  openInExplorer: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}))

vi.mock('../lib/localSave', () => ({
  openInExplorer: mocks.openInExplorer,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const outputs: TaskPostprocessOutput[] = [
  {
    rawImageId: 'image-1',
    path: 'D:\\out\\20260917-清爽洗发水-方形-1.jpg',
    mediaId: 'clean',
    mediaName: '纯净版',
    sizeId: 'clean-1024x1024',
    width: 1024,
    height: 1024,
    clean: true,
    createdAt: 1,
  },
  {
    rawImageId: 'image-1',
    path: 'D:\\out\\20260917-清爽洗发水-横版-广点通-1280x720-1.jpg',
    mediaId: 'gdt',
    mediaName: '广点通',
    sizeId: 'gdt-1280x720',
    width: 1280,
    height: 720,
    clean: false,
    createdAt: 2,
  },
]

function makeTask(postprocessOutputs: TaskPostprocessOutput[] = outputs): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'single image',
    params: { ...DEFAULT_PARAMS, n: 1 },
    inputImageIds: [],
    outputImages: ['image-1'],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    postprocessOutputs,
  }
}

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (root) {
    const mounted = root
    act(() => mounted.unmount())
    root = null
  }
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function render(task: TaskRecord = makeTask(), onClose = vi.fn()) {
  act(() => {
    root = createRoot(container)
    root.render(<TaskPostprocessModal task={task} onClose={onClose} />)
  })
  return { onClose }
}

function findRevealButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[aria-label*="所在文件夹"]'))
}

describe('getPostprocessOutputFileName', () => {
  it('同时兼容 Windows 反斜杠与 POSIX 斜杠', () => {
    expect(getPostprocessOutputFileName('D:\\out\\a\\b.jpg')).toBe('b.jpg')
    expect(getPostprocessOutputFileName('/home/u/out/b.jpg')).toBe('b.jpg')
  })

  it('末段为空时取倒数第二段（与 POSIX basename 一致），空串仍返回空串', () => {
    expect(getPostprocessOutputFileName('D:\\out\\')).toBe('out')
    expect(getPostprocessOutputFileName('D:\\out\\\\a.jpg')).toBe('a.jpg')
    expect(getPostprocessOutputFileName('')).toBe('')
  })
})

describe('TaskPostprocessModal', () => {
  it('逐条列出产出：媒体名、尺寸与文件名', () => {
    render()
    const text = document.body.textContent ?? ''

    expect(text).toContain('纯净版 · 1024×1024')
    expect(text).toContain('广点通 · 1280×720')
    expect(text).toContain('20260917-清爽洗发水-横版-广点通-1280x720-1.jpg')
    expect(text).toContain('共 2 个文件')
  })

  it('纯净版带标记，渠道产出不带', () => {
    render()
    expect(document.body.textContent).toContain('纯净版')
    const cleanRows = Array.from(document.body.querySelectorAll('.ds-list-row')).filter((row) =>
      row.textContent?.includes('1024×1024'),
    )
    expect(cleanRows).toHaveLength(1)
    expect(cleanRows[0]?.textContent).toContain('纯净版')
  })

  it('用产出时的尺寸快照展示，不读当前媒体表配置', () => {
    const snapshot = makeTask([{ ...outputs[1]!, width: 300, height: 250, mediaName: '厂商' }])
    render(snapshot)
    expect(document.body.textContent).toContain('厂商 · 300×250')
  })

  it('点开所在文件夹时传入该条产出的绝对路径', () => {
    mocks.openInExplorer.mockResolvedValue({ ok: true })
    render()
    const buttons = findRevealButtons()
    expect(buttons).toHaveLength(2)

    act(() => {
      buttons[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.openInExplorer).toHaveBeenCalledWith(outputs[1]!.path)
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('打开失败时把错误提示出来', async () => {
    mocks.openInExplorer.mockResolvedValue({ ok: false, error: '当前环境不支持打开文件位置' })
    render()

    await act(async () => {
      findRevealButtons()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.showToast).toHaveBeenCalledWith('当前环境不支持打开文件位置', 'error')
  })

  it('没有产出时列表为空但弹层仍可打开', () => {
    render(makeTask([]))
    expect(document.body.textContent).toContain('共 0 个文件')
    expect(findRevealButtons()).toHaveLength(0)
  })

  it('点关闭按钮回调 onClose', () => {
    const { onClose } = render()
    const closeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭对话框"]')
    expect(closeButton).not.toBeNull()

    act(() => {
      closeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onClose).toHaveBeenCalled()
  })
})
