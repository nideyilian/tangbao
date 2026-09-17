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
  getExplicitImageSaveDirectory,
  getLocalSavePath,
  isElectron,
  sanitizeFolderName,
  saveCompositeImage,
} from '../../lib/localSave'
import { isCollectionWithinSelection, resolvePostprocessProjectTargets } from '../../lib/postprocessProjectTree'
import { buildSourceVariantPlans, type PostprocessVariantPlan } from '../../lib/postprocessRunner'
import {
  getPostprocessMediaConfigSnapshot,
  selectPostprocessOutputPlan,
  usePostprocessMediaStore,
} from '../../storePostprocessMedia'
import { resolveProjectPostprocessSlice } from '../projectTree/params'
import type { ProjectNodeParamsMap } from '../projectTree/types'
import { renderWithMaxKb } from '../composite/lib/compositeExportRuntime'
import { renderCompositeV2ToJpegDataUrl } from '../composite/lib/compositeRendererV2'
import type { CompositeV2FitMode, CompositeV2Preset } from '../composite/lib/compositeV2Types'
import { useCompositeV2Store } from '../composite/storeV2'

/**
 * 变体的画面适配模式。
 *
 * `crop-fill`（等比放大填满 + 裁掉溢出）：渠道尺寸与生成尺寸比例不一致时，
 * 留白（`contain-blur`）会产出带模糊边的素材、拉伸（`stretch`）会变形，都不适合投放。
 */
export const POSTPROCESS_FIT_MODE: CompositeV2FitMode = 'crop-fill'

/** 单次高质量编码的质量；纯净版不限体积时使用。 */
const UNLIMITED_QUALITY = 0.92

/**
 * 未选水印预设时的空图层预设：只借渲染链做尺寸适配与 JPEG 编码。
 * 不作为配置落盘，也不参与复合工作区的预设列表。
 */
const PLAIN_PRESET: CompositeV2Preset = {
  id: 'postprocess-no-watermark',
  name: '后处理（无水印）',
  outputRootPath: '',
  distributionPath: '',
  filenameTemplate: '',
  customVariableValues: {},
  baseCanvas: { width: 1, height: 1 },
  sampleBackgroundPath: '',
  layers: [],
  useOutputOverrides: false,
  outputRuleGroupsOverride: [],
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
  /** 取源图像素数据；返回 null 表示这张图不可用（跳过并记 warning） */
  readSource: (imageId: string, index: number) => Promise<TaskPostprocessSource | null>
}

export interface TaskPostprocessResult {
  outputs: TaskPostprocessOutput[]
  /** 配置里勾了、但媒体表里找不到的渠道 id（需向用户提示，不静默回退） */
  skippedMediaIds: string[]
  /** 可向用户展示的降级说明（预设缺失、目录不可用、单张失败等） */
  warnings: string[]
}

function emptyResult(): TaskPostprocessResult {
  return { outputs: [], skippedMediaIds: [], warnings: [] }
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
  const result = emptyResult()
  if (!isElectron() || input.imageIds.length === 0) return result

  const baseConfig = getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState())
  const params = input.projectParams ?? {}
  if (baseConfig.selectedCollectionIds.length === 0) return result

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api) {
    result.warnings.push('后处理已跳过：非桌面环境')
    return result
  }

  /** 同一批图多半共用输出目录，按配置串缓存，避免每张图都走一次目录创建与授权。 */
  const outputRootCache = new Map<string, string | null>()
  const resolveOutputRootCached = async (configured: string): Promise<string | null> => {
    const key = configured.trim()
    const cached = outputRootCache.get(key)
    if (cached !== undefined) return cached
    const root = await resolveOutputRoot(configured)
    outputRootCache.set(key, root)
    return root
  }

  /** 配置级问题（预设被删、方向关闭）每批只提示一次，不逐图刷屏。 */
  const warnOnce = (message: string) => {
    if (!result.warnings.includes(message)) result.warnings.push(message)
  }

  const produced = new Set(input.alreadyProducedImageIds ?? [])
  let sequence = 1

  for (let index = 0; index < input.imageIds.length; index += 1) {
    const imageId = input.imageIds[index]
    if (produced.has(imageId)) continue

    const source = await input.readSource(imageId, index)
    if (!source || !source.dataUrl || !isUsableSize(source.width, source.height)) {
      result.warnings.push('跳过 1 张源图：图片数据或尺寸不可用')
      continue
    }

    const collectionId = input.resolveImageCollectionId?.(imageId) ?? null
    // 归属方向不在启用范围内 → 跳过。判定放在解析参数之前：没启用的方向连参数都不必解析。
    if (
      collectionId &&
      !isCollectionWithinSelection(input.collections, collectionId, baseConfig.selectedCollectionIds)
    ) {
      warnOnce('部分源图已跳过：所属方向未启用后处理（在项目树里勾选该方向或其上级即可启用）')
      continue
    }

    const slice = resolveProjectPostprocessSlice(input.collections, params, collectionId, baseConfig)
    if (!slice.enabled) {
      warnOnce('部分源图已跳过：所属方向关闭了自动后处理')
      continue
    }

    // 有归属就用归属方向本身做产出目标——这正是「无需手动选择」的含义；
    // 没有归属（手工拖入、旧数据）才退回全局勾选的项目。
    const targetIds = collectionId ? [collectionId] : slice.config.selectedCollectionIds
    const projects = resolvePostprocessProjectTargets(input.collections, targetIds)
    if (projects.length === 0) {
      warnOnce('部分源图已跳过：找不到对应的项目目标')
      continue
    }

    const preset = slice.config.watermarkPresetId ? resolveWatermarkPreset(slice.config.watermarkPresetId) : null
    if (slice.config.watermarkPresetId && !preset) {
      // 预设被删掉了。刻意**不**静默降级成无水印——那等于给用户交付了错误的投放素材。
      warnOnce('部分源图已跳过：引用的水印预设不存在')
      continue
    }

    const outputRoot = await resolveOutputRootCached(slice.config.outputDir)
    if (!outputRoot) {
      warnOnce('部分源图已跳过：无法创建输出目录')
      continue
    }
    await api.authorizeCompositeOutputDirectory?.(outputRoot)

    const selected = selectPostprocessOutputPlan(slice.config, { width: source.width, height: source.height }, projects)
    for (const mediaId of selected.skippedMediaIds) {
      if (!result.skippedMediaIds.includes(mediaId)) result.skippedMediaIds.push(mediaId)
    }

    const { plans, nextSequence } = buildSourceVariantPlans({
      source: { imageId, index, width: source.width, height: source.height },
      units: selected.units,
      config: slice.config,
      startSequence: sequence,
      createdAt: input.createdAt,
    })
    sequence = nextSequence

    for (const plan of plans) {
      const path = await writeVariant(api, outputRoot, plan, source.dataUrl, preset, result)
      if (!path) continue
      result.outputs.push({
        rawImageId: imageId,
        path,
        mediaId: plan.unit.mediaId,
        mediaName: plan.unit.mediaName,
        sizeId: plan.unit.sizeId,
        width: plan.unit.width,
        height: plan.unit.height,
        clean: plan.unit.clean,
        ...(plan.unit.project ? { collectionId: plan.unit.project.collectionId } : {}),
        createdAt: Date.now(),
      })
    }
  }

  return result
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

/** 渲染 + 写盘一个变体；返回最终文件路径，失败时把原因写进 `result.warnings` 并返回 null。 */
async function writeVariant(
  api: NonNullable<Window['electronAPI']>,
  outputRoot: string,
  plan: PostprocessVariantPlan,
  sourceDataUrl: string,
  preset: CompositeV2Preset | null,
  result: TaskPostprocessResult,
): Promise<string | null> {
  try {
    const directory = await ensureDirectoryChain(api, outputRoot, plan.subFolders)
    if (!directory) throw new Error('输出子目录创建失败')
    const filePath = await resolveUniquePath(api, directory, plan.fileName)
    if (!filePath) throw new Error('同名文件过多，无法分配文件名')

    const rendered = await renderVariant(sourceDataUrl, plan, preset)
    if (rendered.warning) result.warnings.push(`${plan.fileName}：${rendered.warning}`)

    const saved = await saveCompositeImage(api, filePath, rendered.dataUrl)
    if (!saved) throw new Error('图片写入失败')
    return filePath
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.warnings.push(`${plan.fileName}：${message}`)
    console.error('后处理产出失败', plan.fileName, error)
    return null
  }
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
): Promise<{ dataUrl: string; warning?: string }> {
  const renderInput = {
    backgroundDataUrl: sourceDataUrl,
    preset: preset ?? PLAIN_PRESET,
    targetSize: { width: plan.unit.width, height: plan.unit.height },
    fitMode: POSTPROCESS_FIT_MODE,
  }
  if (!plan.compress) {
    return { dataUrl: await renderCompositeV2ToJpegDataUrl({ ...renderInput, quality: UNLIMITED_QUALITY }) }
  }
  return await renderWithMaxKb(renderInput, plan.unit.maxSizeKb)
}

async function ensureDirectoryChain(
  api: NonNullable<Window['electronAPI']>,
  root: string,
  subFolders: string[],
): Promise<string | null> {
  let directory = root
  for (const segment of subFolders) {
    directory = await api.pathJoin(directory, sanitizeFolderName(segment))
    const ok = await api.ensureDir(directory)
    if (!ok) return null
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
