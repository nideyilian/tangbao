/* @vitest-environment jsdom */

/**
 * 后处理执行体的行为契约。
 *
 * **当前覆盖**：触发来源（`source`）与方向级「自动后处理」开关的关系。
 * 背景（2026-09-21 报障）：那个开关的语义是「这个方向参不参与**自动**产出」，但执行体原先
 * 不区分来源，于是用户手动点「跑后处理」也被它拦下 —— 而提示里正写着「或选中素材单独跑一次」，
 * 照做还是被跳过，成了死循环。这条契约就是「手动点的那次不被一个管自动的开关否决」。
 *
 * **未覆盖**：渲染链、写盘、分发（依赖 canvas 与主进程 fs）。那部分由 `outputRoots.test.ts`
 * 与本地预览覆盖。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_POSTPROCESS_MEDIA } from '../../lib/postprocessMedia'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import type { AssetCollection } from '../../types'
import { runTaskPostprocess } from './taskPostprocess'

/** 执行体会先问 `isElectron()`，非桌面环境直接返回（`PP-ENV-001`）。 */
function stubElectron(): void {
  vi.stubGlobal('window', {
    electronAPI: {
      isElectron: true,
      getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
      pathJoin: vi.fn(async (base: string, name: string) => `${base}\\${name}`),
      ensureDir: vi.fn(async () => true),
      checkExists: vi.fn(async () => false),
    },
  })
}

/** 归属方向所在节点必须真实存在：`resolveProjectPostprocessSlice` 要沿树把参数解析出来。 */
const DIRECTION: AssetCollection = {
  id: 'direction-a',
  name: '方向A',
  normalizedName: '方向a',
  parentId: null,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
}

/** 这个方向把「自动后处理」关了（就是提示里让用户「单独跑一次」的那种局面）。 */
const DIRECTION_SWITCH_OFF = { 'direction-a': { postprocess: { enabled: false } } }

const readSource = async (imageId: string) => ({
  imageId,
  dataUrl: 'data:image/png;base64,aaa',
  width: 1000,
  height: 1000,
})

function run(source: 'auto' | 'manual') {
  return runTaskPostprocess({
    taskId: source === 'manual' ? 'manual-postprocess' : 'task-a',
    imageIds: ['image-a'],
    collections: [DIRECTION],
    projectParams: DIRECTION_SWITCH_OFF,
    resolveImageCollectionId: () => 'direction-a',
    readSource,
    source,
  })
}

function codesOf(issues: Array<{ code: string }>): string[] {
  return issues.map((issue) => issue.code)
}

describe('后处理执行体：方向级「自动后处理」开关只拦自动触发', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    stubElectron()
    usePostprocessMediaStore.setState({
      selectedCollectionIds: ['direction-a'],
      // 不勾任何渠道 → 零产出、不进渲染链。这条用例只关心「有没有被方向开关拦下」，
      // 让流程停在「没有产出」这一步即可（不依赖渠道表的形状）
      selectedMediaIds: [],
      media: DEFAULT_POSTPROCESS_MEDIA,
    })
  })

  it('自动触发：这个方向关着自动后处理 → 记 PP-SCOPE-002 并跳过', async () => {
    const result = await run('auto')

    expect(codesOf(result.issues)).toContain('PP-SCOPE-002')
    expect(result.outputs).toHaveLength(0)
  })

  it('手动触发：同一个方向关着也照样往下跑（不再被它拦）', async () => {
    const result = await run('manual')

    expect(codesOf(result.issues)).not.toContain('PP-SCOPE-002')
  })
})
