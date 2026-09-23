/**
 * 生成完成后的后处理产出执行器。
 *
 * 职责：读编排配置 → 为每张源图逐单元渲染（尺寸适配 + 水印叠加 + 体积压缩）→ 写盘 → 回报结果。
 *
 * 与生成主流程解耦：只在「任务完成」时被 `src/store.ts` 调用一次；任何单点失败都只记为回报项，
 * 不回滚生成结果、不阻塞 UI。
 *
 * 源图读取走注入的 `readSource` 而不是直接 import store —— `store.ts` 会 import 本模块，
 * 反向 import 会形成循环依赖（`ensureImageCached` 就住在 store.ts 里）。
 */

import type { AssetCollection, TaskPostprocessOutput } from '../../types'
import {
  authorizeOutputDirectory,
  getExplicitImageSaveDirectory,
  getLocalSavePath,
  isElectron,
  sanitizeFolderName,
  saveCompositeImage,
} from '../../lib/localSave'
import { PURE_MEDIA_ID, type PostprocessMediaConfig, type PostprocessProjectTarget } from '../../lib/postprocessMedia'
import { isCollectionWithinSelection, resolvePostprocessProjectTargets } from '../../lib/postprocessProjectTree'
import {
  runPostprocessDistribution,
  toBaseDate,
  type PostprocessDistributionConfig,
  type PostprocessDistributionItem,
} from '../../lib/postprocessDistribution'
import { buildSourceVariantPlans, type PostprocessVariantPlan } from '../../lib/postprocessRunner'
import {
  getPostprocessMediaConfigSnapshot,
  selectPostprocessOutputPlan,
  usePostprocessMediaStore,
} from '../../storePostprocessMedia'
import { resolveProjectPostprocessSlice } from '../projectTree/params'
import { mergePromotedGlobals, useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import type { ProjectNodeParamsMap } from '../projectTree/types'
import { renderOnce, renderWithMaxKb, type RenderVariantOutcome } from './renderVariant'
import { resolveBucketOutputRoots } from './outputRoots'
import { isPostprocessCanceledError, throwIfPostprocessCanceled } from './postprocessCancel'
import { createOutputRootResolver } from './outputRootResolver'
import {
  createPostprocessIssue,
  issuesToWarnings,
  type PostprocessIssue,
  type PostprocessIssueInput,
} from './postprocessIssue'
import type { PostprocessProgressPatch, PostprocessRunDiagnostics, PostprocessRunSource } from './postprocessRun'
import type { CompositeV2FitMode, CompositeV2Preset } from '../composite/lib/compositeV2Types'
import { useCompositeV2Store } from '../composite/storeV2'

/** 单次高质量编码的质量；纯净版不限体积时使用。 */
const UNLIMITED_QUALITY = 0.92

/**
 * 未选水印预设时的空图层预设：只借渲染链做尺寸适配与 JPEG 编码。
 * 不作为配置落盘，也不参与复合工作区的预设列表。
 */
const PLAIN_PRESET: CompositeV2Preset = {
  id: 'postprocess-no-watermark',
  name: '后处理（无水印）',
  // 工具预设，不落库也不进任何产品的库：归属留空即可
  productId: '',
  baseCanvas: { width: 1, height: 1 },
  sampleBackgroundPath: '',
  layers: [],
  updatedAt: 0,
}

export interface TaskPostprocessSource {
  imageId: string
  dataUrl: string
  width: number
  height: number
}

export interface RunTaskPostprocessInput {
  taskId: string
  imageIds: string[]
  /** 素材库项目树（内置三级结构 + 用户自建），用于解析 `{line}/{product}/{direction}` */
  collections: AssetCollection[]
  /** 项目树参数覆盖表（`useProjectTreeParamsStore`）；每张图按归属方向逐级继承出生效配置 */
  projectParams?: ProjectNodeParamsMap
  /**
   * 解析某张图**归属的方向节点 id**（由调用方从素材的 `collectionIds` 里取最深的一个）。
   *
   * 这是「执行后处理时无需手动选项目」的落点：有归属就按归属方向的参数与目录产出，
   * 返回 null / 不传则退回全局默认配置（兼容手工触发与旧数据）。
   */
  resolveImageCollectionId?: (imageId: string) => string | null
  /** 已产出过的源图 id：重复触发不重复产出 */
  alreadyProducedImageIds?: string[]
  /** 生成时间（ms），供 `{date}` 取值 */
  createdAt?: number
  /**
   * 谁触发的这次产出：`auto` = 任务完成后自动跑，`manual` = 用户在素材库点了「跑后处理」。
   *
   * 影响两处判定，都是「**自动才拦、手动放行**」：
   * - **方向级的「自动后处理」开关**（`PP-SCOPE-002`）：那个开关的语义是「这个方向参不参与
   *   自动产出」（见 `participationLabel.ts`），拿它否决用户手动点的那一次会变成死循环 ——
   *   提示让他「选中素材单独跑一次」，而手动跑走同一条判定，照做还是被跳过（2026-09-21 报障）。
   * - **启用范围**（`PP-SCOPE-001`，同样只在自动时判）：启用范围的定义就是「哪些方向参与自动
   *   后处理」，所以它不该管用户手动选的那批目标（见下方产出目标来源处注释）。
   */
  source?: PostprocessRunSource
  /**
   * 只产这些目标方向（方向级拆分用）。不传 = 按内部分组口径把每张图的全部目标都产出来。
   *
   * 为什么要有它：后处理现在按产出方向拆成**一条 run 一个方向**（见 `store.ts` 的批次编排）——
   * 每个方向的参数、输出目录、水印、投放渠道都可能不同（ADR-0003 实测 25/61 个方向的目录不同），
   * 拆开跑才能各自排队、各自报进度、各自失败。执行体不需要知道「现在是哪个方向」，
   * 只要把目标收敛到调用方给的那一个即可。
   */
  onlyTargetCollectionIds?: string[]
  /**
   * 把分发推迟回调用方（批次层）。
   *
   * 必须推迟的理由：分发的「打乱」是**全量洗一次牌、各目标目录共用这一份顺序**
   * （`postprocessDistribution.ts` 的 `buildSourceRank`）—— 同一张素材的头条版与广点通版
   * 因此落在同一天。各方向各洗一次就会把这个性质打掉（同一素材跨渠道对不上，2026-09-23
   * TB-107 刚定的口径）。所以**产出并行、分发收敛成一次**：批次层收齐各方向的待分发项后统一执行。
   */
  deferDistribution?: boolean
  /**
   * 取消信号（TB-115）。已取消就在下一个可中断点抛出 `PostprocessCanceledError` ——
   * 刻意**不是**「返回一份空结果」：调用方要能把「用户取消」与「本来就没产出」分开
   * （前者状态记「已取消」、不报错；后者是配置问题，要报出来让人去查）。
   *
   * 抛出时**已写出的文件一律保留** —— 这里不删任何东西，产物是用户要的。
   */
  signal?: AbortSignal
  /** 取源图像素数据；返回 null 表示这张图不可用（跳过并记 warning） */
  readSource: (imageId: string, index: number) => Promise<TaskPostprocessSource | null>
  /**
   * 进度回调（可选）。**每张源图开跑 / 每个产出单元写完各报一次**，绝对值语义（见
   * `postprocessRun.ts` 的 `PostprocessProgressPatch`）。不传就纯静默跑——单测与脚本用得上。
   */
  onProgress?: (patch: PostprocessProgressPatch) => void
}

/**
 * 一组待分发的产出（按「生效分发配置」分组，见 `TaskPostprocessResult.pendingDistribution`）。
 *
 * 提出来当公共类型，是为了让批次编排（`store.ts`）能把各方向的组**合并成一次分发**时
 * 不自己另造一个形状 —— 两处形状一分叉，分发就会漏掉某个方向的产出（静默，不报错）。
 */
export interface PendingPostprocessDistribution {
  config: PostprocessDistributionConfig
  items: PostprocessDistributionItem[]
}

export interface TaskPostprocessResult {
  outputs: TaskPostprocessOutput[]
  /** 配置里勾了、但媒体表里找不到的渠道 id（需向用户提示，不静默回退） */
  skippedMediaIds: string[]
  /**
   * 结构化问题清单：错误码 + 描述 + 定位线索 + 上下文（见 `postprocessIssue.ts`）。
   * 界面按它分类显示「跳过几项 / 失败几项、分别是为什么」。
   */
  issues: PostprocessIssue[]
  /**
   * 待分发的产出。`deferDistribution` 时由调用方收齐后统一执行；否则本执行体已就地分发完
   * （数组为空 —— 已经排过期的产出不再需要二次处理）。
   */
  pendingDistribution: PendingPostprocessDistribution[]
  /**
   * 问题的单行文本，**由 `issues` 派生**（`formatPostprocessIssue`）。
   *
   * 保留它是为了不动既有调用方（toast 取首条、日志取整段）；但**不要再往这里推文案** ——
   * 两份文案一旦分叉，界面按码查到的说法就会与 toast 看到的不一致。
   */
  warnings: string[]
  /**
   * 本次**实际写入**的输出目录（去重保序，第一个是主位置）。
   *
   * 为什么不从 `outputs[].path` 现推：产出记录只登记双写的**第一个**位置（见写盘循环里的注释），
   * 而「这次写到哪几个目录」正是历史记录上那个「打开输出位置」按钮要回答的问题。
   * 另外，一条**零产出**的记录（整批被跳过）也能说清「本该写到哪」—— 那同样是排查线索。
   */
  outputDirs: string[]
  /**
   * 本次的耗时构成（绘制 / 编码 / 编码轮数 / 写盘）。
   *
   * 存在的理由：这条链的耗时**差异极大**（实测单变体 168ms ~ 1312ms，慢的是「每张图都走满
   * 编码轮数」那一类），而在加它之前**没有任何分阶段数据** —— 只能拿两批产出记录的时间戳反推，
   * 反推还会反错。它同时承担两件事：让用户看得见「为什么这次慢」，让优化改完能立刻验证。
   */
  diagnostics: PostprocessRunDiagnostics
}

/** 执行过程中的累加器：问题先以结构化形式收着，返回前统一派生 `warnings`。 */
type PostprocessAccumulator = Pick<
  TaskPostprocessResult,
  'outputs' | 'outputDirs' | 'skippedMediaIds' | 'issues' | 'pendingDistribution' | 'diagnostics'
>

function emptyAccumulator(): PostprocessAccumulator {
  return {
    outputs: [],
    outputDirs: [],
    skippedMediaIds: [],
    issues: [],
    pendingDistribution: [],
    diagnostics: { paintMs: 0, encodeMs: 0, encodeCount: 0, writeMs: 0 },
  }
}

function toResult(acc: PostprocessAccumulator): TaskPostprocessResult {
  return { ...acc, warnings: issuesToWarnings(acc.issues) }
}

/**
 * 收一条问题。
 *
 * `once` = true 时按「码 + 渠道 + 预设 + 目录」去重：配置级问题（方向没启用、预设被删、
 * 目录不可用）一批图会反复遇到，逐图刷出来只会把真正不同的那几条埋掉。
 * 逐图不同的问题（某张图读不到）不去重——那是真的发生了 N 次。
 */
function reportIssue(acc: PostprocessAccumulator, input: PostprocessIssueInput, once = false): void {
  const issue = createPostprocessIssue(input)
  if (once) {
    // `detail` 也进键：多目标产出时同一个码会因「哪个方向」而不同（PP-SCOPE-001 就是
    // 「这个目标方向不在启用范围内」），只按码去重会把后一个方向的问题悄悄吃掉 ——
    // 症状是「记住 3 个方向只出了 2 个，且看不出为什么」。不带 detail 的码行为不变。
    const keyOf = (item: PostprocessIssue) => [item.code, item.mediaId, item.presetId, item.dir, item.detail].join('|')
    const key = keyOf(issue)
    if (acc.issues.some((item) => keyOf(item) === key)) return
  }
  acc.issues.push(issue)
}

/**
 * 执行后处理产出。
 *
 * 参数**逐张图**解析：按图片归属的方向节点，沿「方向 → 产品 → 产品线 → 全局默认」继承出生效配置。
 * 归属由调用方通过 `resolveImageCollectionId` 注入（取自素材的 `collectionIds`），
 * 所以正常流程下用户不需要在任何面板里再勾一次项目。
 *
 * 勾选（`selectedCollectionIds`）在这套模型里是**启用范围**而不是产出目标：
 * 图片归属方向被勾选（或它任一祖先被勾选）才产出，否则跳过。
 * 没有这一步，一棵几十个方向的树上只要图归档到哪儿就产出到哪儿，磁盘会先炸。
 *
 * 提前返回的两种情形都不算失败：非 Electron、没有输出源图。
 * 「启用范围为空」时同样直接返回——没启用就不产出，与输入栏的「未启用」显示保持一致。
 */
export async function runTaskPostprocess(input: RunTaskPostprocessInput): Promise<TaskPostprocessResult> {
  const result = emptyAccumulator()
  /** 进度上报：绝对值语义，调用方（store）把它写进运行记录；没传就纯静默跑。 */
  const reportProgress = (patch: PostprocessProgressPatch) => input.onProgress?.(patch)

  /**
   * 本次产出的时间基准：命名模板的 `{date}` 与分发的排期起算日**必须同源**。
   * 不归一化的话两处各自取一次 `Date.now()`，跨零点那一秒会让「产出目录名里的日期」与
   * 「第一个日期文件夹」差一天 —— 用户看到一个凭空早/晚一天的文件夹，且无从解释。
   */
  const createdAt = input.createdAt ?? Date.now()

  if (!isElectron() || input.imageIds.length === 0) return toResult(result)

  // 迁移提升值要并进基线，否则「升级前配在方向上的命名模板 / 分发排期」在产出时读不到 ——
  // 界面显示的是合并后的值，落盘用的是未合并的值，会出现「看着对、产出错」。
  const baseConfig = mergePromotedGlobals(
    getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState()),
    useProjectTreeParamsStore.getState().promotedGlobals,
  )
  const params = input.projectParams ?? {}
  if (baseConfig.selectedCollectionIds.length === 0) return toResult(result)

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api) {
    reportIssue(result, { code: 'PP-ENV-001', stage: 'prepare' })
    return toResult(result)
  }

  reportProgress({ stage: 'prepare', completedImages: 0, imageUnits: 0, imageUnitsDone: 0, producedFiles: 0 })

  /**
   * 同一批图多半共用输出目录，按配置串缓存，避免每张图都走一次目录创建与授权。
   *
   * 顺序（授权 → 建目录）不可交换，理由见 `outputRootResolver.ts` 的模块注释（TB-049）。
   */
  const resolveOutputRootCached = createOutputRootResolver({
    authorize: authorizeOutputDirectory,
    resolve: resolveOutputRoot,
  })

  const produced = new Set(input.alreadyProducedImageIds ?? [])
  /**
   * 产出的 `{seq}` **按产出文件夹分别计数**（key = 文件夹名），跨图片保留在这个表里。
   *
   * 不能整批共用一个计数器（2026-09-22 杰哥报障）：那样「在某个方向多勾一个渠道 / 尺寸」
   * 会让**别的方向**的产出文件名整体串号 —— 跟这次配置毫无关系的那批素材，文件名却变了。
   * 每个文件夹从 1 开始，同一文件夹内连续且不重号（重名只可能发生在同一文件夹内）。
   */
  let sequencesByFolder: Record<string, number> = {}
  /** 已写成的文件数（双写按实际份数算），进度与收尾结论都看它。 */
  let producedFiles = 0
  /**
   * 本批次已建好的目录链（键 = 根目录 + 子目录链）。
   *
   * 不加这个缓存时，**每一个产出变体**都要走 `pathJoin` + `authorize` + `ensureDir` 三次 IPC，
   * 而同一批的变体绝大多数落在同几个目录里 —— 几百个变体就是上千次 IPC 白跑。
   * 存的是 Promise 而不是结果：同一批的多个变体几乎同时开工，等第一个建完再让其余重复建一遍
   * 就白等了（授权与建目录本身是幂等的，重复调用不会出错，只是慢）。
   */
  const dirCache: DirectoryChainCache = new Map()

  /**
   * 待分发的产出，按**生效分发配置**分组。
   *
   * 不同方向可以配不同排期（A 方向 7 天、B 方向 30 天），分组后各组分独立平均分配。
   * 混在一起排会让「每组内部均匀」这个前提失效——组小时分到的天数未必落在自己要的区间里。
   */
  const distributionGroups = new Map<
    string,
    { config: PostprocessDistributionConfig; items: PostprocessDistributionItem[] }
  >()

  for (let index = 0; index < input.imageIds.length; index += 1) {
    // 每张图开跑前查一次取消：取消发生在「两张图之间」时立刻收工，而不是把剩下几十张跑完
    // （那正是用户按停止要避免的事）。渲染途中那个更细的可中断点在 `paintAndEncode` 里。
    throwIfPostprocessCanceled(input.signal)
    const imageId = input.imageIds[index]
    // 每张图开跑先报一次：`completedImages` 取下标——每轮恰好处理一张（产出或跳过），
    // 所以「已完成」不需要另设计数器，也不会与真实的处理顺序脱节。
    reportProgress({
      stage: 'render',
      completedImages: index,
      imageUnits: 0,
      imageUnitsDone: 0,
      producedFiles,
      currentLabel: undefined,
    })
    if (produced.has(imageId)) continue

    const source = await input.readSource(imageId, index)
    if (!source || !source.dataUrl || !isUsableSize(source.width, source.height)) {
      reportIssue(result, { code: 'PP-SRC-001', stage: 'prepare', sourceImageId: imageId, sourceIndex: index })
      continue
    }

    const collectionId = input.resolveImageCollectionId?.(imageId) ?? null

    /**
     * 产出目标。**手动与自动分开取，别合并**：
     *
     * - **手动触发**（用户在素材库点了「跑后处理」）→ 记住的产出目标（`savedTargetCollectionIds`）
     *   优先，其次归属方向，最后全局启用范围。「这批图要投到哪几个方向」是用户手动那一下
     *   显式定下来的，之后一直复用，直到他再改。
     * - **自动触发**（任务完成后自动跑）→ **不读记住的目标**，一律按归属方向（无归属才退回全局
     *   启用范围）。产出目标是**手动场景**的概念：它掺进自动跑之后，用户在这里勾什么就会悄悄
     *   改变自动产出的去向 —— 而自动产出是在他没看着的时候发生的（2026-09-22 杰哥明确「这个
     *   只针对于手动后处理，不需要改自动后处理」）。
     * - **没记住** → 退回旧口径：有归属就用归属方向本身（「执行时无需手动选项目」的含义）；
     *   无归属（手工拖入、旧数据）才退回全局勾选的项目。
     */
    const savedTargets = input.source === 'manual' ? baseConfig.savedTargetCollectionIds : []
    const resolvedTargetIds =
      savedTargets.length > 0 ? savedTargets : collectionId ? [collectionId] : baseConfig.selectedCollectionIds
    /**
     * 方向级拆分：调用方一次只让本执行体负责一个方向，其余目标归它自己那条 run。
     *
     * 收敛放在**这里**而不是让调用方传更窄的配置，是为了让「目标怎么定」只有一份实现 ——
     * 批次编排的分组用的是 `features/postprocess/directionTargets.ts`，两边口径一字不差；
     * 各写一遍必然出现「分组说投 B、执行体按 A 产」这种只在产物上看得出来的偏差。
     */
    const targetIds = input.onlyTargetCollectionIds?.length
      ? resolvedTargetIds.filter((id) => input.onlyTargetCollectionIds!.includes(id))
      : resolvedTargetIds
    const projects = resolvePostprocessProjectTargets(input.collections, targetIds)
    if (projects.length === 0) {
      reportIssue(result, { code: 'PP-TARGET-001', stage: 'prepare', sourceImageId: imageId, sourceIndex: index }, true)
      continue
    }

    /**
     * 逐目标 × 逐渠道展开成一张**扁平**清单，每项自带它所属的目标。
     *
     * ⚠️ 参数必须**逐个目标重新解析**，不能拿归属方向那一份复用：每个方向有自己的输出目录、
     * 水印预设、投放渠道（ADR-0003 实测 25/61 个方向的目录不同、56/61 个方向的水印不同）。
     * 复用的后果不是报错，而是**后一个方向的文件静默写进前一个方向的目录、叠错水印** ——
     * 用户拿到的是「看着正常但投错地方」的素材，是最难发现的一类错。
     *
     * 展平成一层而不是嵌两个循环：下面的写盘循环体原样不动，少一层缩进就少一处抄错的机会。
     */
    const jobBuckets: Array<{ project: PostprocessProjectTarget; config: PostprocessMediaConfig }> = []
    for (const project of projects) {
      const targetId = project.collectionId
      // 启用范围是「哪些方向参与**自动**后处理」的开关，所以**只拦自动触发**。
      // 手动那一次是用户直接点的：他明确要求产到某个还没参与自动产出的方向（新开的产品先手动
      // 投一版看看、临时补几个方向）是合理诉求，拿自动的开关否决它等于让他没法手动跨产品跑。
      // 与下面 `PP-SCOPE-002` 同一个套路（那里也是 `input.source !== 'manual'`）。
      // 自动触发仍逐个目标都要过：记住过的方向后来被取消启用时跳过并说明是哪个，而不是照旧产出。
      if (
        input.source !== 'manual' &&
        !isCollectionWithinSelection(input.collections, targetId, baseConfig.selectedCollectionIds)
      ) {
        reportIssue(
          result,
          {
            code: 'PP-SCOPE-001',
            stage: 'prepare',
            sourceImageId: imageId,
            sourceIndex: index,
            // 多目标下「是哪个方向没启用」是必要线索（去重键含 detail，若干方向各报一条）
            detail: `目标方向：${[project.line, project.product, project.direction].filter(Boolean).join(' / ') || targetId}`,
          },
          true,
        )
        continue
      }

      const slice = resolveProjectPostprocessSlice(input.collections, params, targetId, baseConfig)
      // 方向级「自动后处理」开关只拦自动触发（理由见 `RunTaskPostprocessInput.source`），
      // 且只对**归属方向**判：其余目标是用户明确记住的，不该被「归属方向参不参与自动产出」牵连。
      if (targetId === collectionId && !slice.enabled && input.source !== 'manual') {
        reportIssue(
          result,
          { code: 'PP-SCOPE-002', stage: 'prepare', sourceImageId: imageId, sourceIndex: index },
          true,
        )
        continue
      }

      // 按渠道拆桶：输出目录与水印预设都能按渠道覆盖（一个方向的厂商/百度/头条可能交付到
      // 完全不同的目录、叠不同的合规水印），一份配置展开不了全部渠道。
      // 纯净版没有渠道，用通用配置单独成桶。
      const channelIds = slice.config.selectedMediaIds.filter((id) => id !== PURE_MEDIA_ID)
      // 纯净版只在**显式勾选**时单独成桶（2026-09-23 去掉「自动伴随」）：它产出的就是
      // 「无水印 + 沿用生成尺寸 + 不压缩」的原图，而素材库里那张原图本来就是无水的 ——
      // 「勾了渠道就顺手多产一份」等于把原图有损重编一份白占磁盘。
      const wantClean = slice.config.selectedMediaIds.includes(PURE_MEDIA_ID)
      if (wantClean) {
        jobBuckets.push({
          project,
          config: { ...slice.config, selectedMediaIds: [PURE_MEDIA_ID] },
        })
      }
      for (const mediaId of channelIds) {
        const perChannel = resolveProjectPostprocessSlice(input.collections, params, targetId, baseConfig, mediaId)
        jobBuckets.push({
          project,
          config: { ...perChannel.config, selectedMediaIds: [mediaId] },
        })
      }
    }

    for (const { project, config: bucketConfig } of jobBuckets) {
      const bucketMediaId = bucketConfig.selectedMediaIds[0] ?? PURE_MEDIA_ID
      // 逐个解析本渠道引用的预设（一个渠道可以挂多套水印）。
      // 任何一个不存在就跳过这一桶——刻意**不**静默降级成无水印，那等于给用户交付了错误的投放素材。
      const bucketPresets = new Map<string, CompositeV2Preset>()
      let missingPreset = false
      for (const presetId of bucketConfig.watermarkPresetIds) {
        const preset = resolveWatermarkPreset(presetId)
        if (!preset) {
          missingPreset = true
          break
        }
        bucketPresets.set(presetId, preset)
      }
      if (missingPreset) {
        reportIssue(result, { code: 'PP-PRESET-001', stage: 'prepare', mediaId: bucketMediaId }, true)
        continue
      }

      const outputRoots = await resolveBucketOutputRoots(
        bucketConfig,
        bucketMediaId,
        resolveOutputRootCached,
        (issue) => reportIssue(result, issue, true),
      )
      if (outputRoots.length === 0) continue
      for (const root of outputRoots) await api.authorizeCompositeOutputDirectory?.(root)

      // 预设 id → 展示名：产出的文件名与预设子目录要靠它区分多套水印
      const presetNames: Record<string, string> = {}
      for (const [presetId, preset] of bucketPresets) presetNames[presetId] = preset.name

      // 只传**当前这一个**目标：单元上的 `project` 决定命名段（`{line}/{product}/{direction}`）
      // 与子目录，把整批目标一起传进去会把所有方向的名字混进同一份计划里。
      const selected = selectPostprocessOutputPlan(
        bucketConfig,
        { width: source.width, height: source.height },
        [project],
        presetNames,
      )
      for (const mediaId of selected.skippedMediaIds) {
        if (!result.skippedMediaIds.includes(mediaId)) result.skippedMediaIds.push(mediaId)
      }

      const { plans, nextSequences } = buildSourceVariantPlans({
        source: { imageId, index, width: source.width, height: source.height },
        units: selected.units,
        config: bucketConfig,
        startSequences: sequencesByFolder,
        createdAt,
      })
      sequencesByFolder = nextSequences

      // 单元数只有到这里才知道（要按渠道 × 尺寸 × 预设展开）：报给进度，界面才能显示
      // 「这张图 3/8」而不是干等。
      reportProgress({
        stage: 'write',
        completedImages: index,
        imageUnits: plans.length,
        imageUnitsDone: 0,
        producedFiles,
      })

      for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
        // 每个产出单元开跑前再查一次：一张源图能展开出几十个变体，只在「两张图之间」查
        // 会让取消延迟到下一个源图才有反应（体感上就是「点了没动静」）
        throwIfPostprocessCanceled(input.signal)
        const plan = plans[planIndex]
        // 每个单元自带自己的水印预设；纯净版与「未选预设」的单元是 null（不叠水印）
        const planPreset = plan.unit.watermark ? (bucketPresets.get(plan.unit.watermark.id) ?? null) : null
        const written = await writeVariant(api, outputRoots, plan, source.dataUrl, planPreset, baseConfig.fitMode, {
          acc: result,
          dirCache,
          sourceImageId: imageId,
          sourceIndex: index,
          signal: input.signal,
        })
        producedFiles += written.length
        reportProgress({
          imageUnits: plans.length,
          imageUnitsDone: planIndex + 1,
          producedFiles,
          // 目录跟着进度走，中途被取消 / 崩溃时上层才拿得到「已经产出的那几张在哪」
          outputDirs: [...result.outputDirs],
          currentLabel: `${plan.unit.clean ? '纯净版' : plan.unit.mediaName} ${plan.unit.width}x${plan.unit.height} · ${plan.fileName}`,
        })
        if (written.length === 0) continue
        // 产出记录只登记**第一个**位置：清单是「产出了哪些变体」，双写的第二份是同一张图，
        // 登记进去只会让「产出 N 个文件」翻倍，而用户关心的是变体数。
        result.outputs.push({
          rawImageId: imageId,
          path: written[0].path,
          mediaId: plan.unit.mediaId,
          mediaName: plan.unit.mediaName,
          sizeId: plan.unit.sizeId,
          width: plan.unit.width,
          height: plan.unit.height,
          clean: plan.unit.clean,
          ...(plan.unit.project ? { collectionId: plan.unit.project.collectionId } : {}),
          createdAt: Date.now(),
        })

        // 分发在整批产出之后统一做（要按天平均分配，逐张搬没法均分）。
        // 这里只登记，`root` 带上是为了「换目录分发」时保留项目/方向/预设的子目录层级。
        // 双写时两个位置的副本都要排期，否则第二个位置会漏下没排的文件。
        // 只判 `enabled`：配置不完整（没填日期）交给分发内部报错，静默跳过等于什么都没发生。
        const distribution = bucketConfig.distribution
        if (distribution.enabled) {
          const key = JSON.stringify(distribution)
          // `sourceKey` = 源图 id：分发据此按**素材**洗牌，同一张图在各渠道目录里落在同一天
          const entries = written.map((item) => ({ path: item.path, outputRoot: item.root, sourceKey: imageId }))
          const group = distributionGroups.get(key)
          if (group) group.items.push(...entries)
          else distributionGroups.set(key, { config: distribution, items: entries })
        }
      }
    }
  }

  // 整批产出结束，进入分发：`completedImages` 到这里补满，进度条不会停在最后一格。
  reportProgress({
    stage: 'distribute',
    completedImages: input.imageIds.length,
    imageUnits: 0,
    imageUnitsDone: 0,
    producedFiles,
  })
  // 分发：默认就地做（手工触发与旧调用方的行为一字不变）；
  // 批次编排传 `deferDistribution` 时把分组原样交回去，由它在**所有方向都跑完之后**统一洗一次牌。
  if (input.deferDistribution) {
    result.pendingDistribution = [...distributionGroups.values()].map(({ config, items }) => ({
      config,
      items: [...items],
    }))
  } else {
    const distributionIssues = await distributePostprocessOutputs(
      api,
      distributionGroups.values(),
      result.outputs,
      createdAt,
    )
    result.issues.push(...distributionIssues)
  }

  // 一个文件都没出、又没记下任何原因：这本身就是结论（配置指向了空产出 —— 渠道的尺寸全禁用、
  // 预设没挂上东西之类）。不留这条的话，界面只能报「结束了」而说不出为什么，
  // 而「跑了但什么都没发生」正是最难自查的一类。
  if (result.outputs.length === 0 && result.issues.length === 0) {
    reportIssue(result, { code: 'PP-EMPTY-001', stage: 'finish' })
  }

  return toResult(result)
}

/**
 * 执行分发并回写路径；返回本次分发产生的问题项（由调用方决定记在哪条运行记录上）。
 *
 * 导出是给**批次编排**用的：方向拆成并行之后，分发必须收敛成一次（见
 * `RunTaskPostprocessInput.deferDistribution`），于是「执行分发」这个动作有了第二个调用方
 * （`store.ts` 在批次收尾时合并各组再调）。各写一份的话，「路径回写」这条很容易只在一处做对 ——
 * 而漏掉的后果是产出记录指向不存在的文件（重跑判定与「打开文件」一起失效）。
 *
 * 分发失败**不**回滚已产出的文件：产物本身是好的，只是没排到日期目录里，
 * 报出来让用户自己决定要不要重跑，比删掉已产出的东西更安全。
 */
export async function distributePostprocessOutputs(
  api: NonNullable<Window['electronAPI']>,
  groups: Iterable<PendingPostprocessDistribution>,
  /** 产出记录：分发移动过的文件要把路径跟着改（原地改对象，与原先一致） */
  outputs: TaskPostprocessOutput[],
  /** 本次产出的时间基准（与命名模板 `{date}` 同源）；排期起算日由它得出 */
  createdAt: number,
): Promise<PostprocessIssue[]> {
  const list = [...groups]
  if (list.length === 0) return []
  const issues: PostprocessIssue[] = []
  const movedPaths = new Map<string, string>()
  const baseDate = toBaseDate(createdAt)
  for (const { config, items } of list) {
    try {
      const outcome = await runPostprocessDistribution(items, config, api, { baseDate })
      for (const item of outcome.moved) movedPaths.set(item.originalPath, item.targetPath)
      for (const error of outcome.errors) {
        issues.push(createPostprocessIssue({ code: 'PP-DIST-001', stage: 'distribute', cause: error }))
      }
      if (outcome.canceled) issues.push(createPostprocessIssue({ code: 'PP-DIST-002', stage: 'distribute' }))
    } catch (error) {
      issues.push(createPostprocessIssue({ code: 'PP-DIST-003', stage: 'distribute', cause: messageOf(error) }))
    }
  }
  if (movedPaths.size === 0) return issues
  // 产出记录跟着搬。留旧路径会让「已产出」清单指向不存在的文件，重跑判定与打开文件都会失效。
  for (const output of outputs) {
    const moved = movedPaths.get(output.path)
    if (moved) output.path = moved
  }
  return issues
}

/**
 * 把多个来源（各方向各一条 run）的待分发组**按生效分发配置合并**成一批。
 *
 * 合并键与执行体内部的分组键必须是同一个口径（`JSON.stringify(分布配置)`）：
 * 不同配置混在一组会让「按天均分」的前提失效（A 方向 7 天、B 方向 30 天，混着排谁都不均匀）；
 * 而同一配置被拆成两组又会各自洗一次牌 —— 那正是本次改造要避免的（同一素材跨渠道不同天）。
 */
export function mergePendingPostprocessDistribution(
  sources: Iterable<PendingPostprocessDistribution>,
): PendingPostprocessDistribution[] {
  const merged = new Map<string, PendingPostprocessDistribution>()
  for (const group of sources) {
    const key = JSON.stringify(group.config)
    const existing = merged.get(key)
    if (existing) existing.items.push(...group.items)
    else merged.set(key, { config: group.config, items: [...group.items] })
  }
  return [...merged.values()]
}

function isUsableSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
}

function resolveWatermarkPreset(presetId: string): CompositeV2Preset | null {
  return useCompositeV2Store.getState().presets.find((item) => item.id === presetId) ?? null
}

/** 输出根目录：配置了就用配置的（支持目录变量），否则落到本地保存目录下的 `postprocess/`。 */
async function resolveOutputRoot(configured: string): Promise<string | null> {
  const trimmed = configured.trim()
  if (trimmed) return await getExplicitImageSaveDirectory(trimmed)

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const base = await getLocalSavePath()
  if (!api || !base) return null
  return await getExplicitImageSaveDirectory(await api.pathJoin(base, 'postprocess'))
}

/** 写到某个位置的结果：`root` 用于分发时还原子目录层级。 */
interface WrittenVariant {
  path: string
  root: string
}

/** 本批次已建好的目录链；键是「根目录 + 子目录链」，值是尚未 settle 的建目录 Promise。 */
type DirectoryChainCache = Map<string, Promise<string | null>>

/**
 * 一次变体写盘的上下文。
 *
 * 收成一个对象而不是继续加形参：这个函数本来就有 6 个入参，再逐个加（累加器、目录缓存、
 * 定位线索）会到 9 个 —— 调用点全是位置参数，多一个少一个只能靠数数对，加字段时极易错位。
 */
interface WriteVariantContext {
  /** 问题与耗时累加器 */
  acc: PostprocessAccumulator
  /** 本批次的目录链缓存（见 `RunTaskPostprocessInput` 上方的说明） */
  dirCache: DirectoryChainCache
  /** 定位线索：出问题时用户要靠「哪张源图的哪个文件」去查 */
  sourceImageId: string
  sourceIndex: number
  /** 取消信号：渲染途中（编码轮之间）的中断点靠它，见 `renderVariant` */
  signal?: AbortSignal
}

/**
 * 渲染 + 写盘一个变体（可以写多个位置）；返回实际写成的那些位置，全失败时把原因记成带码的问题项
 * 并返回空数组。
 *
 * 渲染只做**一次**：双写时若按位置各渲染一遍，体积压缩（逐档试编码）会整份翻倍，
 * 而两个位置要的本来就是同一张图。
 */
async function writeVariant(
  api: NonNullable<Window['electronAPI']>,
  roots: string[],
  plan: PostprocessVariantPlan,
  sourceDataUrl: string,
  preset: CompositeV2Preset | null,
  /** 源图适配目标尺寸的方式（全局配置，见 `PostprocessMediaConfig.fitMode`） */
  fitMode: CompositeV2FitMode,
  ctx: WriteVariantContext,
): Promise<WrittenVariant[]> {
  const written: WrittenVariant[] = []
  const locator = {
    file: plan.fileName,
    mediaId: plan.unit.mediaId,
    mediaName: plan.unit.mediaName,
    sourceImageId: ctx.sourceImageId,
    sourceIndex: ctx.sourceIndex,
  }

  let rendered: RenderVariantOutcome
  try {
    rendered = await renderVariant(sourceDataUrl, plan, preset, fitMode, ctx.signal)
  } catch (error) {
    /**
     * 取消**不是**渲染失败 —— 往上抛给主循环（它记 `PP-CANCEL-001` 并收尾）。
     *
     * 早先这里一律记 `PP-RENDER-001`，于是用户点了「取消」会在记录里得到一条
     * 「渲染失败，多半是这套水印里的图片 / LOGO 素材失效了」—— 而产物好好地留在磁盘上，
     * 他只会拿这句话去白查一遍水印。
     */
    if (isPostprocessCanceledError(error)) throw error
    // 渲染抛异常：以前这里只留一条「全部导出位置写入失败」，真因（异常本身）只在 console 里。
    reportIssue(ctx.acc, { code: 'PP-RENDER-001', stage: 'render', ...locator, cause: messageOf(error) })
    console.error('后处理产出失败', plan.fileName, error)
    return written
  }
  ctx.acc.diagnostics.paintMs += rendered.stats.paintMs
  ctx.acc.diagnostics.encodeMs += rendered.stats.encodeMs
  ctx.acc.diagnostics.encodeCount += rendered.stats.encodeCount
  if (rendered.warning)
    reportIssue(ctx.acc, { code: 'PP-RENDER-002', stage: 'render', ...locator, cause: rendered.warning })

  // 第一个位置定下的文件名（含撞名后缀）给后面几个位置沿用，双写的两份看起来才是同一个东西
  const writeStart = performance.now()
  let fileName = plan.fileName
  for (const root of roots) {
    const directory = await ensureDirectoryChainCached(api, root, plan.subFolders, ctx.dirCache)
    if (!directory) {
      reportIssue(ctx.acc, { code: 'PP-DIR-004', stage: 'write', ...locator, dir: root })
      continue
    }
    const filePath = await resolveUniquePath(api, directory, fileName)
    if (!filePath) {
      reportIssue(ctx.acc, { code: 'PP-NAME-001', stage: 'write', ...locator, dir: directory })
      continue
    }
    const saved = await saveCompositeImage(api, filePath, rendered.dataUrl)
    if (!saved) {
      reportIssue(ctx.acc, { code: 'PP-WRITE-001', stage: 'write', ...locator, dir: directory })
      continue
    }
    fileName = filePath.split(/[\\/]/).pop() ?? fileName
    written.push({ path: filePath, root })
    // 登记这个目录（去重保序）：历史记录上的「打开输出位置」按钮、以及「重启后重新放行
    // 这些目录」两件事都靠它。放在写成功**之后** —— 写都没写成的目录不该进历史。
    if (!ctx.acc.outputDirs.includes(root)) ctx.acc.outputDirs.push(root)
  }
  ctx.acc.diagnostics.writeMs += performance.now() - writeStart
  return written
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 渲染一个变体。
 *
 * 不限体积（`maxSizeKb <= 0`，即纯净版）时**不能**走 `renderWithMaxKb`：
 * 那里的 0 会被当成「压到 0KB」，质量一路压到 0.01 仍报超限。单次高质量编码即可。
 */
async function renderVariant(
  sourceDataUrl: string,
  plan: PostprocessVariantPlan,
  preset: CompositeV2Preset | null,
  fitMode: CompositeV2FitMode,
  signal?: AbortSignal,
): Promise<RenderVariantOutcome> {
  const renderInput = {
    backgroundDataUrl: sourceDataUrl,
    preset: preset ?? PLAIN_PRESET,
    targetSize: { width: plan.unit.width, height: plan.unit.height },
    fitMode,
  }
  /**
   * 取消探针交给渲染链。编码一轮实测 ≈127ms、一张图最多三枪，不在这一层给出中断点的话，
   * 「取消」的粒度会粗到「整张图」—— 体感就是「点了停止，它还在编」。
   * `paintAndEncode` 会在绘制前与**每次编码前**各查一次。
   */
  const options = { shouldCancel: () => signal?.aborted === true }
  if (!plan.compress) {
    return await renderOnce(renderInput, UNLIMITED_QUALITY, options)
  }
  return await renderWithMaxKb(renderInput, plan.unit.maxSizeKb, options)
}

/**
 * 逐级建子目录（`2026-09-20/保险/…` 这类），并按「根 + 子目录链」缓存结果。
 *
 * 子目录跟在已授权的根目录之下，且**每一级都先授权再建**：只授权根目录是不够的 ——
 * `assertAllowedPath` 逐级检查的是实际写入路径，多一层没授权就整条链断在这里，
 * 而 `ensureDir` 现在会在失败时返回错误消息字符串（不再是布尔 `false`），所以用 `!== true` 判定。
 *
 * ⚠️ **失败不进缓存**：建目录失败（返回 null）时把条目删掉，让后面的变体还能自己重试一次 ——
 * 把一次偶发失败缓存成「整批这个目录都不可用」是最难查的那种错（明明目录后来建好了，却整批跳过）。
 */
async function ensureDirectoryChainCached(
  api: NonNullable<Window['electronAPI']>,
  root: string,
  subFolders: string[],
  cache: DirectoryChainCache,
): Promise<string | null> {
  const key = [root, ...subFolders].join('\u0000')
  const hit = cache.get(key)
  if (hit) return await hit

  const pending = ensureDirectoryChain(api, root, subFolders)
  cache.set(key, pending)
  const resolved = await pending
  if (resolved === null) cache.delete(key)
  return resolved
}

async function ensureDirectoryChain(
  api: NonNullable<Window['electronAPI']>,
  root: string,
  subFolders: string[],
): Promise<string | null> {
  let directory = root
  for (const segment of subFolders) {
    directory = await api.pathJoin(directory, sanitizeFolderName(segment))
    await api.authorizeCompositeOutputDirectory?.(directory)
    const ok = await api.ensureDir(directory)
    if (ok !== true) return null
  }
  return directory
}

/**
 * 本会话已经分配出去（可能还没写完）的输出路径。
 *
 * 为什么必须有它（2026-09-23 按方向并发运行之后）：`resolveUniquePath` 是「查存在 → 再写」
 * 两步，以前同一批产出串行跑，撞名一定被前一个**已经写完**的文件挡下；方向拆成并行之后，
 * 两个方向共用同一个输出目录（命名模板里不带方向段时就是这种情况）会双双查到「不存在」，
 * 然后后写的那个把先写的覆盖掉 —— 而这在界面上不报任何错，用户拿到的是少了一个文件。
 *
 * 注册和使用都发生在 `resolveUniquePath` 内部，顺序是**先占位再查盘**：
 * 若反过来（先查盘再登记），两个并发调用仍会双双查空、双双登记、返回同一条路径。
 *
 * 只登记、不清理：一条路径几十字节，一场几千张图的会话也不过几百 KB；
 * 与「清了旧条目又开始覆盖」相比，宁可留着。键做大小写归一（Windows 路径不区分大小写）。
 */
const reservedOutputPaths = new Set<string>()

function outputPathKey(path: string): string {
  return path.trim().toLowerCase()
}

/**
 * 同名兜底：模板缺 `{seq}` 或人为重跑时会撞名，加 `-2`/`-3` 后缀而不是覆盖已有文件。
 * （正常路径下 `{seq}` 已保证唯一，这里只是不覆盖用户已有素材的安全网。）
 *
 * 判据是**两个**：磁盘上不存在、且本会话没把这条路径分配给别的产出（见 `reservedOutputPaths`）。
 */
async function resolveUniquePath(
  api: NonNullable<Window['electronAPI']>,
  directory: string,
  fileName: string,
): Promise<string | null> {
  const candidate = await api.pathJoin(directory, fileName)
  const taken = await reserveIfAvailable(api, candidate)
  if (taken) return taken

  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const next = await api.pathJoin(directory, `${base}-${suffix}${ext}`)
    const taken = await reserveIfAvailable(api, next)
    if (taken) return taken
  }
  return null
}

/**
 * 尝试占住一条路径：磁盘上没有、且本会话没分配给别的产出 → 登记并返回它；否则返回 null。
 *
 * **先登记再查盘**是关键（见 `reservedOutputPaths` 的注释）：两个并发调用因此不会同时
 * 选中同一路径。查盘发现真存在时把占位撤掉，让后面的候选继续用。
 */
async function reserveIfAvailable(api: NonNullable<Window['electronAPI']>, candidate: string): Promise<string | null> {
  const key = outputPathKey(candidate)
  if (reservedOutputPaths.has(key)) return null
  reservedOutputPaths.add(key)
  if (await api.checkExists(candidate)) {
    reservedOutputPaths.delete(key)
    return null
  }
  return candidate
}
