/* @vitest-environment jsdom */

/**
 * 后处理执行体的行为契约。
 *
 * **当前覆盖**：触发来源（`source`）与两处「自动才拦」判定的关系。
 * 背景（2026-09-21 报障）：那个开关的语义是「这个方向参不参与**自动**产出」，但执行体原先
 * 不区分来源，于是用户手动点「跑后处理」也被它拦下 —— 而提示里正写着「或选中素材单独跑一次」，
 * 照做还是被跳过，成了死循环。这条契约就是「手动点的那次不被一个管自动的开关否决」。
 *
 * 2026-09-22 追问同一条边界：**启用范围**（`selectedCollectionIds`）的定义也是「哪些方向参与
 * 自动后处理」，所以它同样只拦自动触发；并且**「记住的产出目标」只有手动跑才读**，不掺进自动
 * 产出（杰哥：「我这个只针对于手动后处理，不需要改自动后处理的」）。
 *
 * **未覆盖**：渲染链、写盘、分发（依赖 canvas 与主进程 fs）。那部分由 `outputRoots.test.ts`
 * 与本地预览覆盖。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_POSTPROCESS_DISTRIBUTION } from '../../lib/postprocessDistribution'
import { DEFAULT_POSTPROCESS_MEDIA } from '../../lib/postprocessMedia'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import type { AssetCollection } from '../../types'
import { resolveProjectPostprocessSlice } from '../projectTree/params'
import type { ProjectNodeParamsMap } from '../projectTree/types'
import { runTaskPostprocess, mergePendingPostprocessDistribution } from './taskPostprocess'

/**
 * 包一层 mock 才能断言「参数是按哪个方向解析的」—— 这是「多目标不串味」在**可测层面**的
 * 等价观测。真正的串味表现是文件写进错目录，那要跑渲染 + 写盘，jsdom 下测不到。
 */
/**
 * 渲染链的固定耗时。用 `vi.hoisted` 是为了让它比 `vi.mock` 的工厂先就位 ——
 * 工厂被提升到 import 之前执行，引用普通模块级 `const` 会撞 TDZ。
 */
const MOCK_STATS = vi.hoisted(() => ({ paintMs: 1.5, encodeMs: 2.5, encodeCount: 1 }))

/**
 * 渲染链整体替身：jsdom 没有 canvas，而「目录缓存」与「耗时累计」这两件事都不在渲染里 ——
 * 用固定 stats 换取可精确断言的累计值（真渲染的耗时是随机的，断言不了）。
 */
vi.mock('./renderVariant', () => ({
  renderOnce: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', stats: MOCK_STATS })),
  renderWithMaxKb: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', stats: MOCK_STATS })),
}))

vi.mock('../projectTree/params', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../projectTree/params')>()
  return { ...actual, resolveProjectPostprocessSlice: vi.fn(actual.resolveProjectPostprocessSlice) }
})

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

/** 一个真实形状的三级树：产品线 → 产品 → 方向（`{line}/{product}/{direction}` 命名段靠它）。 */
function collection(id: string, name: string, parentId: string | null): AssetCollection {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    parentId,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
  }
}

const LINE = collection('line-x', '医疗线', null)
const PRODUCT = collection('product-x', '百万医疗险', LINE.id)
const DIRECTION_A = collection('direction-a', '月亮', PRODUCT.id)
const DIRECTION_B = collection('direction-b', '图标', PRODUCT.id)
const THREE_LEVEL_TREE = [LINE, PRODUCT, DIRECTION_A, DIRECTION_B]

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

/**
 * 多目标产出（「记住配置」）。
 *
 * 背景（2026-09-22）：一批素材经常要同时投到多个产品 / 多个方向，而归属（`collectionIds` 里
 * 最深那条）只能表达「这张图属于哪个方向」——靠把素材挂到多个方向绕不过去（同级挂两个只有
 * 一个生效），还会改写素材的真实归属。用户点「记住配置」把「这批图要投到哪几个方向」定下来
 * （`savedTargetCollectionIds`），之后手动跑一直复用，直到他再改。
 *
 * 这里守三件事：
 * ① **每个目标各用自己那一套参数**（输出目录 / 水印 / 渠道）—— 复用归属那一份会把后一个方向的
 *    文件静默写进前一个方向的目录，属于最难发现的一类错（看着正常但不能投）；
 * ② **手动跨产品照产**：记住的目标即使在启用范围之外也不拦（启用范围管的是自动后处理），
 *    自动触发则照旧逐个目标过；
 * ③ **自动跑不读这份清单**：自动产出的去向仍是图片归属方向，不被「记住配置」悄悄改掉。
 */
describe('多目标产出：记住的产出目标', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    stubElectron()
    vi.mocked(resolveProjectPostprocessSlice).mockClear()
    usePostprocessMediaStore.setState({
      media: DEFAULT_POSTPROCESS_MEDIA,
      // 不勾任何渠道 → 零产出、不进渲染链。这几条只关心「目标怎么定、参数按谁解析」
      selectedMediaIds: [],
      savedTargetCollectionIds: [],
    })
  })

  /** 参数是按哪些方向解析的（`resolveProjectPostprocessSlice` 的第 3 个入参）。 */
  function resolvedDirectionIds(): Set<string> {
    return new Set(vi.mocked(resolveProjectPostprocessSlice).mock.calls.map((call) => String(call[2])))
  }

  function run(options: { source?: 'auto' | 'manual'; params?: ProjectNodeParamsMap; onlyTargets?: string[] } = {}) {
    return runTaskPostprocess({
      taskId: 'task-targets',
      imageIds: ['image-a'],
      collections: THREE_LEVEL_TREE,
      projectParams: options.params ?? {},
      resolveImageCollectionId: () => DIRECTION_A.id,
      readSource,
      source: options.source ?? 'manual',
      ...(options.onlyTargets ? { onlyTargetCollectionIds: options.onlyTargets } : {}),
    })
  }

  it('记住多个方向 → 每个方向各解析一次参数，不再只解析归属那一个', async () => {
    usePostprocessMediaStore.setState({
      selectedCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
      savedTargetCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
    })

    await run()

    expect(resolvedDirectionIds()).toEqual(new Set([DIRECTION_A.id, DIRECTION_B.id]))
  })

  it('没记住（空数组）→ 退回旧口径：只解析归属方向', async () => {
    usePostprocessMediaStore.setState({
      selectedCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
      savedTargetCollectionIds: [],
    })

    await run()

    expect(resolvedDirectionIds()).toEqual(new Set([DIRECTION_A.id]))
  })

  it('⭐ 手动跑：记住的目标跨出启用范围也照产（新开的产品先手动投一版）', async () => {
    usePostprocessMediaStore.setState({
      // 只启用 A：B 是还没参与自动产出的方向
      selectedCollectionIds: [DIRECTION_A.id],
      savedTargetCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
    })

    const result = await run({ source: 'manual' })

    expect(codesOf(result.issues)).not.toContain('PP-SCOPE-001')
    expect(resolvedDirectionIds()).toEqual(new Set([DIRECTION_A.id, DIRECTION_B.id]))
  })

  it('自动跑：启用范围仍是硬开关，归属方向不在范围内 → 记 PP-SCOPE-001 并跳过（防回退）', async () => {
    usePostprocessMediaStore.setState({
      // 只启用 B：归属方向 A 反而在范围外
      selectedCollectionIds: [DIRECTION_B.id],
      savedTargetCollectionIds: [],
    })

    const result = await run({ source: 'auto' })

    expect(codesOf(result.issues)).toContain('PP-SCOPE-001')
  })

  it('⭐ 自动跑不读「记住的产出目标」—— 那份清单只管手动点的那一次', async () => {
    usePostprocessMediaStore.setState({
      selectedCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
      // 用户手动那批只想投 B
      savedTargetCollectionIds: [DIRECTION_B.id],
    })

    await run({ source: 'auto' })

    // 自动跑仍按归属 A 产出，没有被「记住配置」改成 B
    expect(resolvedDirectionIds()).toEqual(new Set([DIRECTION_A.id]))
  })

  it('目标不是归属方向时，不被归属那个「自动后处理」开关牵连', async () => {
    usePostprocessMediaStore.setState({
      selectedCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
      // 这一批只产到 B；A 是归属方向但不打算产它
      savedTargetCollectionIds: [DIRECTION_B.id],
    })

    const result = await run({
      source: 'manual',
      params: { [DIRECTION_A.id]: { postprocess: { enabled: false } } },
    })

    expect(codesOf(result.issues)).not.toContain('PP-SCOPE-002')
  })

  it('归属方向自己就是目标时，它的「自动后处理」开关照旧拦自动触发（防回退）', async () => {
    usePostprocessMediaStore.setState({
      selectedCollectionIds: [DIRECTION_A.id],
      savedTargetCollectionIds: [DIRECTION_A.id],
    })

    const result = await run({
      source: 'auto',
      params: { [DIRECTION_A.id]: { postprocess: { enabled: false } } },
    })

    expect(codesOf(result.issues)).toContain('PP-SCOPE-002')
  })

  /**
   * 方向级拆分：调用方一次只让执行体负责**一个**方向（其余目标各有自己的一条 run）。
   *
   * 这条契约是本次改造的执行体侧落点：编排层按方向拆开之后，执行体必须能被收敛到单个目标，
   * 否则「同一个方向产两遍、别的方向一遍没产」这种账在界面上完全看不出来。
   */
  it('⭐ 只产指定方向（方向级拆分）：只解析那一个方向的参数', async () => {
    usePostprocessMediaStore.setState({
      selectedCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
      savedTargetCollectionIds: [DIRECTION_A.id, DIRECTION_B.id],
    })

    const result = await run({ source: 'manual', onlyTargets: [DIRECTION_B.id] })

    expect(resolvedDirectionIds()).toEqual(new Set([DIRECTION_B.id]))
    // 只收敛目标，不改变「没产出也没理由」这条结论的形状（渠道没勾时照旧报 PP-EMPTY-001）
    expect(result.pendingDistribution).toEqual([])
  })
})

/**
 * 跨方向合并待分发项（批次收尾统一分发用）。
 *
 * 为什么必须合并成**一次**：分发的「打乱」是全量洗一次牌、各目标目录共用同一份顺序 ——
 * 同一张素材的头条版与广点通版因此落在同一天。各方向各洗一次就会把这个性质打掉
 * （2026-09-23 TB-107 刚定的口径），而产物看上去完全正常，只有跨渠道对日期时才发现。
 */
describe('待分发项：按生效分发配置合并', () => {
  /** 用真实默认配置做基底：手拼一个字面量会在配置新增字段时静默漏项（这里就漏过三次）。 */
  const distribution = (days: number) => ({ ...DEFAULT_POSTPROCESS_DISTRIBUTION, days })

  it('同配置合并成一组（各方向的产出进同一份洗牌），不同配置各成一组', () => {
    const merged = mergePendingPostprocessDistribution([
      { config: distribution(7), items: [{ path: 'a.jpg', outputRoot: 'D:/out' }] },
      { config: distribution(7), items: [{ path: 'b.jpg', outputRoot: 'D:/out' }] },
      { config: distribution(30), items: [{ path: 'c.jpg', outputRoot: 'D:/out' }] },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0].items.map((item) => item.path)).toEqual(['a.jpg', 'b.jpg'])
    expect(merged[1].items.map((item) => item.path)).toEqual(['c.jpg'])
  })

  it('合并键与执行体内部的分组键同口径（同字段同值算同一组，归一化由配置层负责）', () => {
    const one = distribution(7)
    const two = distribution(7)

    expect(
      mergePendingPostprocessDistribution([
        { config: one, items: [] },
        { config: two, items: [] },
      ]),
    ).toHaveLength(1)
  })
})

/**
 * 目录链缓存与耗时诊断（2026-09-23）。
 *
 * 背景：实测同一套配置下，单变体耗时在 **168ms ~ 1312ms** 之间摆动（8 倍），而当时
 * **没有任何分阶段数据**，只能拿两批产出记录的时间戳反推 —— 而且反推错过两次。
 * 这一组守住新加的两件事：
 * ① 同一批里重复的目录只建一次（原来每个变体都要 pathJoin + authorize + ensureDir 三次 IPC）；
 * ② 耗时构成被如实累计（否则界面上那行诊断永远显示 0，等于白加）。
 */
describe('目录链缓存与耗时诊断', () => {
  /** 只有一个尺寸的渠道：让两张源图**落进同一个目录**，才验得了「只建一次」。 */
  const SINGLE_SIZE_MEDIA = [
    {
      id: 'gdt',
      name: '广点通',
      sizes: [{ id: 'gdt-1280x720', width: 1280, height: 720, maxSizeKb: 399, enabled: true }],
    },
  ]

  function stubWritableApi() {
    // 参数签名要写出来：`mock.calls` 的类型由它推断，写成 `vi.fn(async () => true)` 会得到
    // 一个零长度元组，`calls.map(([dir]) => …)` 直接编译不过
    const ensureDir = vi.fn(async (_dirPath: string) => true)
    const saveBytes = vi.fn(async (_filePath: string, _bytes: Uint8Array) => true)
    vi.stubGlobal('window', {
      electronAPI: {
        isElectron: true,
        getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
        pathJoin: vi.fn(async (base: string, name: string) => `${base}\\${name}`),
        ensureDir,
        authorizeCompositeOutputDirectory: vi.fn(async () => true),
        checkExists: vi.fn(async () => false),
        saveCompositeImageBytes: saveBytes,
        saveCompositeImage: vi.fn(async () => true),
      },
    })
    return { ensureDir, saveBytes }
  }

  /** 两张源图 × 一个渠道 × 一个尺寸 = 2 个变体，且两者落在**同一个**输出子目录。 */
  function runTwoImages() {
    return runTaskPostprocess({
      taskId: 'task-dir-cache',
      imageIds: ['image-a', 'image-b'],
      collections: [DIRECTION],
      projectParams: {},
      resolveImageCollectionId: () => 'direction-a',
      readSource,
      source: 'manual',
    })
  }

  beforeEach(() => {
    vi.unstubAllGlobals()
    usePostprocessMediaStore.setState({
      media: SINGLE_SIZE_MEDIA,
      selectedMediaIds: ['gdt'],
      selectedCollectionIds: ['direction-a'],
      outputDir: '',
      mediaOutputDirs: {},
      watermarkPresetIds: [],
      savedTargetCollectionIds: [],
    })
  })

  it('⭐ 两张源图落同一个目录时，目录链只建一次', async () => {
    const { ensureDir, saveBytes } = stubWritableApi()

    const result = await runTwoImages()

    // 先确认真的写出了 2 个文件 —— 否则「只建了一次目录」可能只是根本没走到写盘（探针打空）
    expect(saveBytes).toHaveBeenCalledTimes(2)
    expect(result.outputs).toHaveLength(2)

    /*
     * 判据写成「每个目录路径只建一次」而不是「总共调了几次」：`ensureDir` 还有第二个调用方
     * （`getExplicitImageSaveDirectory` 解析输出根时也要建），按总数断言会把那一次也算进来，
     * 变成一条随输出根实现变化而碎的脆弱断言。
     *
     * 旧实现的行为差异在**重复项**上：第二张源图会拿同一个子目录再走一遍
     * `pathJoin + authorize + ensureDir`（`dirs` 里出现同一个路径两次）。
     */
    const dirs = ensureDir.mock.calls.map(([dir]) => String(dir))
    expect(new Set(dirs).size).toBe(dirs.length)
    // 输出根 1 次 + 这一批共用的子目录 1 次
    expect(dirs).toHaveLength(2)
  })

  it('耗时构成按变体累计（渲染替身的 stats × 变体数）', async () => {
    stubWritableApi()

    const result = await runTwoImages()

    expect(result.diagnostics.encodeCount).toBe(2)
    expect(result.diagnostics.paintMs).toBeCloseTo(MOCK_STATS.paintMs * 2)
    expect(result.diagnostics.encodeMs).toBeCloseTo(MOCK_STATS.encodeMs * 2)
  })
})
