/**
 * 变体渲染：按目标尺寸适配源图、叠上水印、压到指定体积上限。
 *
 * 从 `features/composite/lib/compositeExportRuntime` 搬出来的。搬家的理由不是整理文件：
 * 后处理不该依赖一个正在退役的旧编排模块，而这里真正用到的只有渲染能力
 * （画布合成 + JPEG 编码 + 体积搜索），与导出计划、路径模板、队列毫无关系。
 *
 * 与原实现的差异：去掉了 `shouldPause`（旧「批量导出」的暂停/继续开关）。
 * 后处理是任务完成后的后台产出，没有暂停语义；留一个永远传不进值的回调只会是死分支。
 *
 * ## 画布只画一次，编码只打三枪（2026-09-23）
 *
 * 体积压缩的开销**几乎全在 JPEG 编码的次数**上（单次完整编码实测约 127ms）。这块改过两轮：
 *
 * 1. **画布只画一次**：体积搜索只改 JPEG 质量，画面内容一模一样。原实现每轮都调
 *    `renderCompositeV2ToJpegDataUrl`，而它**每次都从 `renderCompositeV2ToCanvas` 开始** ——
 *    背景按 `fitMode` 适配、overlay 缩放到目标尺寸、`clearRect` 全部重放一遍。
 *    现在渲染一次拿到 canvas，之后只对它反复 `toBlob(quality)`。
 * 2. **二分 8 轮 → 插值定位 1 轮**：原策略是「0.9 试探 + 0.01 探底 + 8 轮二分」= 最多 **10 次编码**，
 *    把区间收敛到 `0.89 / 2^8 ≈ 0.35%` 的质量精度 —— 这是**过度精确**：用户要的是
 *    「不超过 399KB」，不是「最高可用质量」，质量差 0.35% 肉眼完全不可辨。
 *    改成「0.9 → 0.5 → 两点对数插值定位 → 验证」，**典型 3 次编码**。
 *
 * 实测依据：同一套配置下，只编 1 轮的批次是 **168ms/变体**，走满 10 轮的批次是 **1312ms/变体**
 * （由 09-21 八个批次的产出时间戳反推，见 `docs/postprocess-watermark-gap-analysis.md`）。
 *
 * ### 为什么插值比二分划算
 *
 * JPEG 体积随质量近似**指数**增长（对数域才近似线性），所以拿两个已测点就能直接算出目标体积
 * 对应的质量，而不用一轮一轮逼近 —— 二分的前几轮必然浪费在离答案很远的地方。
 *
 * ### 正确性约束（改搜索策略时别破坏这三条）
 *
 * 1. **返回的一定是「实测达标」的那一帧**：插值只是选点策略，不改变判定；每帧都量 `blob.size`
 *    再决定取用，猜高了就往回退一档，猜低了就用已验证的低点。
 * 2. **`0.9` 一次达标是最常见路径**，必须仍是 1 次编码（别为了「统一」把它也塞进搜索）。
 * 3. 只有「连最低质量都超标」才返回超限结果 + `warning`。
 *
 * 返回值仍是 dataUrl —— 调用方不必处理 Blob；写盘侧 `saveCompositeImage` 内部会解回字节
 * 走 `saveCompositeImageBytes`。
 */

import { blobToDataUrl, canvasToBlob } from '../../lib/canvasImage'
import { renderCompositeV2ToCanvas, type CompositeV2RenderInput } from '../composite/lib/compositeRendererV2'
import { createPostprocessCanceledError } from './postprocessCancel'

/** 首选质量：内容不复杂的图按它一次编码就达标（最常走的一条路）。 */
const HIGH_QUALITY = 0.9
/** 插值区间的中低点：用来判断目标落在上半区还是下半区。 */
const MID_QUALITY = 0.5
/** 探底用的最低质量：连它都压不进目标体积，说明这个目标不可达。 */
const LOW_QUALITY = 0.02

/**
 * 插值得到的质量点要往区间内部收一点。
 *
 * 两端都是**已经编过**的实测点（低端达标、高端超标），质量恰好算回端点等于白编一次；
 * 收 5% 保证每次猜测都落在未测区间里。
 */
const INTERPOLATION_INSET_RATIO = 0.05

export interface RenderWithMaxKbOptions {
  /** 返回 true 时中止渲染（抛错，由调用方记 warning） */
  shouldCancel?: () => boolean
}

/**
 * 一次渲染的耗时构成，供运行记录展示（让「慢在哪」有数可看，而不是只能靠体感）。
 *
 * 刻意只拆「绘制」与「编码」两段：它们是这条链仅有的两个大头，而且**性质不同** ——
 * 绘制是主线程同步的（会卡界面），编码是异步的（不卡界面但吃 CPU）。
 * 编码轮数单独记，因为它是「编码耗时」最直接的驱动量。
 */
export interface RenderVariantStats {
  /** 画布绘制耗时（只包 `renderCompositeV2ToCanvas`） */
  paintMs: number
  /** 本次渲染调了几次 `toBlob` */
  encodeCount: number
  /** 编码总耗时 */
  encodeMs: number
}

export interface RenderVariantOutcome {
  dataUrl: string
  warning?: string
  stats: RenderVariantStats
}

/** KB 判定：向上取整，避免 399.2KB 被当成「不超过 399KB」放过。 */
function blobSizeKb(blob: Blob): number {
  return Math.ceil(blob.size / 1024)
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * 把「要不要取消」折成一个「不该继续就抛」的检查函数。
 *
 * 抛的是 `PostprocessCanceledError` 而**不是** `new Error('渲染被取消')`（早先的写法）：
 * 消息是给用户看的、会随文案改，拿它当判据等于把「取消」与「渲染失败」的区分建在一句中文上 ——
 * 而这两件事的处理完全不同（前者不报错、产物保留，后者要记 `PP-RENDER-001` 让人去查）。
 */
function createCancelGate(shouldCancel?: () => boolean): () => void {
  return () => {
    if (shouldCancel?.()) throw createPostprocessCanceledError()
  }
}

/**
 * 「画 + 编」的公共骨架：两个对外入口（单次编码 / 压到体积以内）共用它，
 * 保证计时口径与画布生命周期只有一份实现。
 */
async function paintAndEncode(
  input: CompositeV2RenderInput,
  shouldCancel: (() => void) | undefined,
  encodePlan: (encode: (quality: number) => Promise<Blob>) => Promise<{ dataUrl: string; warning?: string }>,
): Promise<RenderVariantOutcome> {
  shouldCancel?.()
  const canvas = document.createElement('canvas')
  const paintStart = nowMs()
  await renderCompositeV2ToCanvas(input, canvas)
  const paintMs = nowMs() - paintStart

  let encodeCount = 0
  let encodeMs = 0
  const encode = async (quality: number): Promise<Blob> => {
    shouldCancel?.()
    encodeCount += 1
    const started = nowMs()
    try {
      return await canvasToBlob(canvas, 'image/jpeg', quality)
    } finally {
      encodeMs += nowMs() - started
    }
  }

  const outcome = await encodePlan(encode)
  return { ...outcome, stats: { paintMs, encodeCount, encodeMs } }
}

/** 单次高质量编码：不限体积的产出（纯净版）走这条，不进体积搜索。 */
export async function renderOnce(
  input: CompositeV2RenderInput,
  quality: number,
  options?: RenderWithMaxKbOptions,
): Promise<RenderVariantOutcome> {
  const throwIfCanceled = createCancelGate(options?.shouldCancel)
  return await paintAndEncode(input, throwIfCanceled, async (encode) => ({
    dataUrl: await blobToDataUrl(await encode(quality)),
  }))
}

/**
 * 在**对数域**上，用两个已测点估计「体积刚好等于 target」对应的质量。
 *
 * 取对数是因为 JPEG 体积随质量近似指数增长：`log(size)` 与 `quality` 才近似线性。
 * 直接对 size 做线性插值会把结果系统性地压向低质量那端（曲线下凸）。
 *
 * 入参约定：`lower` 是**已验证达标**的点，`upper` 是**已验证超标**的点 ——
 * 于是 `target` 必然夹在两者之间，比值天然落在 [0, 1)。异常输入（体积倒挂或相等）退回区间中点。
 */
function interpolateQuality(
  lower: { quality: number; sizeKb: number },
  upper: { quality: number; sizeKb: number },
  targetKb: number,
): number {
  const span = Math.log(upper.sizeKb) - Math.log(lower.sizeKb)
  const raw =
    span > 0 && Number.isFinite(span)
      ? lower.quality + ((Math.log(targetKb) - Math.log(lower.sizeKb)) / span) * (upper.quality - lower.quality)
      : (lower.quality + upper.quality) / 2
  const inset = (upper.quality - lower.quality) * INTERPOLATION_INSET_RATIO
  return Math.min(upper.quality - inset, Math.max(lower.quality + inset, raw))
}

/**
 * 渲染到目标体积以内。
 *
 * 三条路径，按代价从低到高（每步只做一次编码）：
 * 1. `0.9` 一次达标 → 直接返回（最常见，也是原来就有的快速路径，别弄丢）；
 * 2. `0.5` 达标 → 目标在上半区，用 (0.5, 0.9) 两点插值定点，验证一次；
 * 3. `0.5` 不达标 → 目标在下半区，先探底确认可达，再插值。
 */
export async function renderWithMaxKb(
  input: CompositeV2RenderInput,
  maxSizeKb: number,
  options?: RenderWithMaxKbOptions,
): Promise<RenderVariantOutcome> {
  const throwIfCanceled = createCancelGate(options?.shouldCancel)

  return await paintAndEncode(input, throwIfCanceled, async (encode) => {
    const high = await encode(HIGH_QUALITY)
    const highKb = blobSizeKb(high)
    if (highKb <= maxSizeKb) return { dataUrl: await blobToDataUrl(high) }

    const mid = await encode(MID_QUALITY)
    const midKb = blobSizeKb(mid)
    if (midKb <= maxSizeKb) {
      return await refineByInterpolation(
        encode,
        { quality: MID_QUALITY, sizeKb: midKb },
        { quality: HIGH_QUALITY, sizeKb: highKb },
        maxSizeKb,
        mid,
      )
    }

    // 连 0.5 都超标：先确认这个目标到底可不可达，再在下半区找
    const floor = await encode(LOW_QUALITY)
    const floorKb = blobSizeKb(floor)
    if (floorKb > maxSizeKb) {
      return { dataUrl: await blobToDataUrl(floor), warning: `最低质量 ${LOW_QUALITY} 仍超过 ${maxSizeKb}KB` }
    }
    return await refineByInterpolation(
      encode,
      { quality: LOW_QUALITY, sizeKb: floorKb },
      { quality: MID_QUALITY, sizeKb: midKb },
      maxSizeKb,
      floor,
    )
  })
}

/**
 * 插值定位 + 验证一次；猜高了就退回「已验证的低点」与「刚被否掉的高点」之间再试一档。
 *
 * 每一步都**实测**结果再决定取用，所以「猜」只影响速度、不影响正确性：
 * 无论插值准不准，返回的都是一个真正压进了目标体积的帧。
 */
async function refineByInterpolation(
  encode: (quality: number) => Promise<Blob>,
  lower: { quality: number; sizeKb: number },
  upper: { quality: number; sizeKb: number },
  maxSizeKb: number,
  lowerBlob: Blob,
): Promise<{ dataUrl: string; warning?: string }> {
  const guess = interpolateQuality(lower, upper, maxSizeKb)
  const probe = await encode(guess)
  if (blobSizeKb(probe) <= maxSizeKb) return { dataUrl: await blobToDataUrl(probe) }

  const retreat = await encode((lower.quality + guess) / 2)
  if (blobSizeKb(retreat) <= maxSizeKb) return { dataUrl: await blobToDataUrl(retreat) }
  return { dataUrl: await blobToDataUrl(lowerBlob) }
}
