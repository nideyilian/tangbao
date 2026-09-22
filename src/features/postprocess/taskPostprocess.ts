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
import { renderWithMaxKb } from './renderVariant'
import { resolveBucketOutputRoots } from './outputRoots'
import { createOutputRootResolver } from './outputRootResolver'
import {
  createPostprocessIssue,
  issuesToWarnings,
  type PostprocessIssue,
  type PostprocessIssueInput,
} from './postprocessIssue'
import type { PostprocessProgressPatch, PostprocessRunSource } from './postprocessRun'
import { renderCompositeV2ToJpegDataUrl } from '../composite/lib/compositeRendererV2'
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
  /** 取源图像素数据；返回 null 表示这张图不可用（跳过并记 warning） */
  readSource: (imageId: string, index: number) => Promise<TaskPostprocessSource | null>
  /**
   * 进度回调（可选）。**每张源图开跑 / 每个产出单元写完各报一次**，绝对值语义（见
   * `postprocessRun.ts` 的 `PostprocessProgressPatch`）。不传就纯静默跑——单测与脚本用得上。
   */
  onProgress?: (patch: PostprocessProgressPatch) => void
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
   * 问题的单行文本，**由 `issues` 派生**（`formatPostprocessIssue`）。
   *
   * 保留它是为了不动既有调用方（toast 取首条、日志取整段）；但**不要再往这里推文案** ——
   * 两份文案一旦分叉，界面按码查到的说法就会与 toast 看到的不一致。
   */
  warnings: string[]
}

/** 执行过程中的累加器：问题先以结构化形式收着，返回前统一派生 `warnings`。 */
type PostprocessAccumulator = Pick<TaskPostprocessResult, 'outputs' | 'skippedMediaIds' | 'issues'>

function emptyAccumulator(): PostprocessAccumulator {
  return { outputs: [], skippedMediaIds: [], issues: [] }
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
    const targetIds =
      savedTargets.length > 0 ? savedTargets : collectionId ? [collectionId] : baseConfig.selectedCollectionIds
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
        const plan = plans[planIndex]
        // 每个单元自带自己的水印预设；纯净版与「未选预设」的单元是 null（不叠水印）
        const planPreset = plan.unit.watermark ? (bucketPresets.get(plan.unit.watermark.id) ?? null) : null
        const written = await writeVariant(
          api,
          outputRoots,
          plan,
          source.dataUrl,
          planPreset,
          // 画面适配是全局一套（不随方向覆盖），整批图取同一个值
          baseConfig.fitMode,
          result,
          {
            sourceImageId: imageId,
            sourceIndex: index,
          },
        )
        producedFiles += written.length
        reportProgress({
          imageUnits: plans.length,
          imageUnitsDone: planIndex + 1,
          producedFiles,
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
  await distributeOutputs(api, distributionGroups, result, createdAt)

  // 一个文件都没出、又没记下任何原因：这本身就是结论（配置指向了空产出 —— 渠道的尺寸全禁用、
  // 预设没挂上东西之类）。不留这条的话，界面只能报「结束了」而说不出为什么，
  // 而「跑了但什么都没发生」正是最难自查的一类。
  if (result.outputs.length === 0 && result.issues.length === 0) {
    reportIssue(result, { code: 'PP-EMPTY-001', stage: 'finish' })
  }

  return toResult(result)
}

/**
 * 执行分发并回写路径。
 *
 * 分发失败**不**回滚已产出的文件：产物本身是好的，只是没排到日期目录里，
 * 报出来让用户自己决定要不要重跑，比删掉已产出的东西更安全。
 */
async function distributeOutputs(
  api: NonNullable<Window['electronAPI']>,
  groups: Map<string, { config: PostprocessDistributionConfig; items: PostprocessDistributionItem[] }>,
  result: PostprocessAccumulator,
  /** 本次产出的时间基准（与命名模板 `{date}` 同源）；排期起算日由它得出 */
  createdAt: number,
): Promise<void> {
  if (groups.size === 0) return
  const movedPaths = new Map<string, string>()
  const baseDate = toBaseDate(createdAt)
  for (const { config, items } of groups.values()) {
    try {
      const outcome = await runPostprocessDistribution(items, config, api, { baseDate })
      for (const item of outcome.moved) movedPaths.set(item.originalPath, item.targetPath)
      for (const error of outcome.errors) {
        reportIssue(result, { code: 'PP-DIST-001', stage: 'distribute', cause: error })
      }
      if (outcome.canceled) reportIssue(result, { code: 'PP-DIST-002', stage: 'distribute' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reportIssue(result, { code: 'PP-DIST-003', stage: 'distribute', cause: message })
    }
  }
  if (movedPaths.size === 0) return
  // 产出记录跟着搬。留旧路径会让「已产出」清单指向不存在的文件，重跑判定与打开文件都会失效。
  for (const output of result.outputs) {
    const moved = movedPaths.get(output.path)
    if (moved) output.path = moved
  }
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
  result: PostprocessAccumulator,
  /** 定位线索：出问题时用户要靠「哪张源图的哪个文件」去查 */
  context: { sourceImageId: string; sourceIndex: number },
): Promise<WrittenVariant[]> {
  const written: WrittenVariant[] = []
  const locator = {
    file: plan.fileName,
    mediaId: plan.unit.mediaId,
    mediaName: plan.unit.mediaName,
    sourceImageId: context.sourceImageId,
    sourceIndex: context.sourceIndex,
  }

  let rendered: { dataUrl: string; warning?: string }
  try {
    rendered = await renderVariant(sourceDataUrl, plan, preset, fitMode)
  } catch (error) {
    // 渲染抛异常：以前这里只留一条「全部导出位置写入失败」，真因（异常本身）只在 console 里。
    reportIssue(result, { code: 'PP-RENDER-001', stage: 'render', ...locator, cause: messageOf(error) })
    console.error('后处理产出失败', plan.fileName, error)
    return written
  }
  if (rendered.warning)
    reportIssue(result, { code: 'PP-RENDER-002', stage: 'render', ...locator, cause: rendered.warning })

  // 第一个位置定下的文件名（含撞名后缀）给后面几个位置沿用，双写的两份看起来才是同一个东西
  let fileName = plan.fileName
  for (const root of roots) {
    const directory = await ensureDirectoryChain(api, root, plan.subFolders)
    if (!directory) {
      reportIssue(result, { code: 'PP-DIR-004', stage: 'write', ...locator, dir: root })
      continue
    }
    const filePath = await resolveUniquePath(api, directory, fileName)
    if (!filePath) {
      reportIssue(result, { code: 'PP-NAME-001', stage: 'write', ...locator, dir: directory })
      continue
    }
    const saved = await saveCompositeImage(api, filePath, rendered.dataUrl)
    if (!saved) {
      reportIssue(result, { code: 'PP-WRITE-001', stage: 'write', ...locator, dir: directory })
      continue
    }
    fileName = filePath.split(/[\\/]/).pop() ?? fileName
    written.push({ path: filePath, root })
  }
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
): Promise<{ dataUrl: string; warning?: string }> {
  const renderInput = {
    backgroundDataUrl: sourceDataUrl,
    preset: preset ?? PLAIN_PRESET,
    targetSize: { width: plan.unit.width, height: plan.unit.height },
    fitMode,
  }
  if (!plan.compress) {
    return { dataUrl: await renderCompositeV2ToJpegDataUrl({ ...renderInput, quality: UNLIMITED_QUALITY }) }
  }
  return await renderWithMaxKb(renderInput, plan.unit.maxSizeKb)
}

/**
 * 逐级建子目录（`2026-09-20/保险/…` 这类）。
 *
 * 子目录跟在已授权的根目录之下，且**每一级都先授权再建**：只授权根目录是不够的 ——
 * `assertAllowedPath` 逐级检查的是实际写入路径，多一层没授权就整条链断在这里，
 * 而 `ensureDir` 现在会在失败时返回错误消息字符串（不再是布尔 `false`），所以用 `!== true` 判定。
 */
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
 * 同名兜底：模板缺 `{seq}` 或人为重跑时会撞名，加 `-2`/`-3` 后缀而不是覆盖已有文件。
 * （正常路径下 `{seq}` 已保证唯一，这里只是不覆盖用户已有素材的安全网。）
 */
async function resolveUniquePath(
  api: NonNullable<Window['electronAPI']>,
  directory: string,
  fileName: string,
): Promise<string | null> {
  const candidate = await api.pathJoin(directory, fileName)
  if (!(await api.checkExists(candidate))) return candidate

  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const next = await api.pathJoin(directory, `${base}-${suffix}${ext}`)
    if (!(await api.checkExists(next))) return next
  }
  return null
}
