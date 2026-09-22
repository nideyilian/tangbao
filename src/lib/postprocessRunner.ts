/**
 * 后处理产出编排（纯逻辑，无副作用）。
 *
 * 把「源图 × 产出单元」展开成可直接执行的写盘清单：文件名、目标文件夹名、扩展名、是否压体积。
 * 渲染与 IO 由 `src/store.ts` 的 `runTaskPostprocess` 完成（那里才拿得到 `electronAPI` 与渲染器）。
 *
 * 两条刻意的口径（见 `docs/hanling-postprocess-replica-plan.md` 阶段四）：
 * - **扩展名固定 `jpg`**：渲染链只产 JPEG；源 PNG 也压不到指定体积
 *   （`imagePostprocess.ts` 的 PNG 分支会直接抛错）。2026-09-17 拍板「自动转 JPEG」。
 * - **`{seq}` 按产出文件夹各自计数、跨源图连续**（2026-09-22 起）：重名只可能发生在
 *   **同一个文件夹里**，所以「同一文件夹内从 1 连续」才是它要保证的事。整批共用一个计数器时，
 *   某个方向多勾一个渠道 / 尺寸就会让别的方向的产出文件名跟着串号（杰哥 2026-09-22 报障）。
 *   磁盘级同名兜底仍由调用方处理。
 */

import { buildPostprocessFolderName, buildPostprocessOutputName } from './postprocessNaming'
import type { PostprocessMediaConfig, PostprocessOutputUnit } from './postprocessMedia'

/** 后处理产出文件的扩展名（不含点）。渲染链固定输出 JPEG，故不随源图格式变化。 */
export const POSTPROCESS_OUTPUT_EXTENSION = 'jpg'

/** 源图在任务输出中的位置与尺寸。尺寸无效（0 / NaN）时调用方不应把它交给本模块。 */
export interface PostprocessSourceImage {
  imageId: string
  /** 任务输出下标（0 起），仅用于日志定位与排序 */
  index: number
  width: number
  height: number
}

/** 一次写盘：某张源图在某个产出单元下的目标文件。 */
export interface PostprocessVariantPlan {
  sourceImageId: string
  sourceIndex: number
  unit: PostprocessOutputUnit
  /** 含扩展名的文件名 */
  fileName: string
  /** 写入的子目录链。现在是**一层**：以该单元自己的名字命名（= 文件名模板去掉 `{seq}`） */
  subFolders: string[]
  /** 是否需要压到 `unit.maxSizeKb` 以内；false 时单次高质量渲染，不做体积二分 */
  compress: boolean
}

/**
 * 该单元是否要走体积压缩。
 *
 * `maxSizeKb <= 0` 语义是**不限体积**（纯净版），必须显式判断——写成隐式真值判断会把
 * 「不限体积」误当成「压到 0KB」，渲染器会把质量一路压到 0.01 还报超限。
 */
export function shouldCompressPostprocessUnit(unit: Pick<PostprocessOutputUnit, 'maxSizeKb'>): boolean {
  return Number.isFinite(unit.maxSizeKb) && unit.maxSizeKb > 0
}

export interface BuildSourceVariantPlansInput {
  source: PostprocessSourceImage
  /** 该源图的产出单元（由 `selectPostprocessOutputPlan` 得出，顺序即产出顺序） */
  units: PostprocessOutputUnit[]
  config: Pick<PostprocessMediaConfig, 'namePattern' | 'creator'>
  /**
   * 各产出文件夹**下一个**要用的序号（1 起）；key = 该单元落盘的文件夹名。
   *
   * 序号**按文件夹各自计**而不是整批一个计数器：同一个文件夹里的号从 1 连续，
   * 某个方向多勾一个渠道 / 尺寸也不会让别的文件夹的号跟着串。
   * 缺省、或这个文件夹还没编过号 → 从 1 开始。
   */
  startSequences?: Record<string, number>
  /** 生成时间（ms），供 `{date}` 取值 */
  createdAt?: number
}

export interface BuildSourceVariantPlansResult {
  plans: PostprocessVariantPlan[]
  /** 各文件夹推进后的下一个序号；原样交给下一张源图，同一文件夹即可跨图接着编 */
  nextSequences: Record<string, number>
}

/** 序号兜底：非法值（`undefined` / `NaN` / 小于 1）一律回到 1。 */
function normalizeSequence(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1
}

/**
 * 构建单张源图的全部产出清单。
 *
 * 序号**按产出文件夹分别计数**（`subFolders[0]` 就是分组键），每个文件夹自 1 起连续；
 * 同一文件夹内不重号 —— 这正是「不覆盖已有文件」真正依赖的那条性质（不同文件夹是不同目录）。
 * 每个单元写进**以它自己的名字命名的文件夹**（= 文件名的模板去掉 `{seq}`，杰哥 2026-09-21 定）：
 * 序号不同的同批产物因此聚在同一个文件夹里，而文件夹名本身就带全了方向 / 渠道 / 尺寸。
 */
export function buildSourceVariantPlans(input: BuildSourceVariantPlansInput): BuildSourceVariantPlansResult {
  const plans: PostprocessVariantPlan[] = []
  // 浅拷贝：不改写入参 —— 调用方会把上一次返回的对象原样传回来
  const sequences: Record<string, number> = { ...input.startSequences }

  for (const unit of input.units) {
    const project = unit.project
    const names = { line: project?.line, product: project?.product, direction: project?.direction }
    // 文件夹名先算：它同时是分组键，又不含 `{seq}`，所以「先定文件夹、再按它取号」是唯一顺序
    const folderName = buildPostprocessFolderName(input.config, unit, names, input.createdAt)
    const sequence = normalizeSequence(sequences[folderName])
    const baseName = buildPostprocessOutputName(input.config, unit, names, sequence, input.createdAt)
    plans.push({
      sourceImageId: input.source.imageId,
      sourceIndex: input.source.index,
      unit,
      fileName: `${baseName}.${POSTPROCESS_OUTPUT_EXTENSION}`,
      subFolders: [folderName],
      compress: shouldCompressPostprocessUnit(unit),
    })
    sequences[folderName] = sequence + 1
  }

  return { plans, nextSequences: sequences }
}
