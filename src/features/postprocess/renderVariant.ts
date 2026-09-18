/**
 * 变体渲染：按目标尺寸适配源图、叠上水印、压到指定体积上限。
 *
 * 从 `features/composite/lib/compositeExportRuntime` 搬出来的。搬家的理由不是整理文件：
 * 后处理不该依赖一个正在退役的旧编排模块，而这里真正用到的只有渲染能力
 * （画布合成 + JPEG 编码 + 体积二分），与导出计划、路径模板、队列毫无关系。
 *
 * 与原实现的差异：去掉了 `shouldPause`（旧「批量导出」的暂停/继续开关）。
 * 后处理是任务完成后的后台产出，没有暂停语义；留一个永远传不进值的回调只会是死分支。
 */

import { renderCompositeV2ToJpegDataUrl } from '../composite/lib/compositeRendererV2'

/** dataUrl 的字节数换算成 KB（base64 膨胀 4/3，另减尾部 padding）。 */
export function dataUrlSizeKb(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? ''
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.ceil(((base64.length * 3) / 4 - padding) / 1024)
}

type RenderInput = Omit<Parameters<typeof renderCompositeV2ToJpegDataUrl>[0], 'quality'>

export interface RenderWithMaxKbOptions {
  /** 返回 true 时中止渲染（抛错，由调用方记 warning） */
  shouldCancel?: () => boolean
}

/**
 * 渲染到目标体积以内。
 *
 * 性能要点：先按高质量 0.9 渲染一次，达标直接返回——大多数输出只需一次编码；
 * 只有超标时才用最低质量 0.01 试探上限，再进行最多 8 次二分逼近。
 * 下限都压不进去时返回最低质量的结果并带 warning，而不是无限逼近或直接失败。
 */
export async function renderWithMaxKb(
  input: RenderInput,
  maxSizeKb: number,
  options?: RenderWithMaxKbOptions,
): Promise<{ dataUrl: string; warning?: string }> {
  const throwIfCanceled = () => {
    if (options?.shouldCancel?.()) throw new Error('渲染被取消')
  }

  throwIfCanceled()
  const highDataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality: 0.9 })
  throwIfCanceled()
  if (dataUrlSizeKb(highDataUrl) <= maxSizeKb) {
    return { dataUrl: highDataUrl }
  }

  // 最低质量仍超限 → 无法压缩到目标体积
  const lowDataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality: 0.01 })
  throwIfCanceled()
  if (dataUrlSizeKb(lowDataUrl) > maxSizeKb) {
    return { dataUrl: lowDataUrl, warning: `最低质量 0.01 仍超过 ${maxSizeKb}KB` }
  }

  let low = 0.01
  let high = 0.9
  let bestDataUrl = lowDataUrl
  for (let iteration = 0; iteration < 8; iteration += 1) {
    throwIfCanceled()

    const quality = (low + high) / 2
    const dataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality })
    if (dataUrlSizeKb(dataUrl) <= maxSizeKb) {
      bestDataUrl = dataUrl
      low = quality
    } else {
      high = quality
    }
  }
  return { dataUrl: bestDataUrl }
}
