import { storeImage } from '../../lib/db'
import { cacheImage } from '../../store'
import type { InputImage } from '../../types'
import type { CreativePoolItem } from './types'

export interface ResolvedPoolInputImages {
  /** 可供 `submitTask({ extraInputImages })` 直接使用的输入图 */
  images: InputImage[]
  /** 图读不出来的张数（池数据还在、图没了），调用方据此提示而不是静默少发 */
  missing: number
}

/**
 * 把选中的池项转成可提交的输入图。
 *
 * ⚠️ 必须用 `storeImage` 返回的**真实内容哈希 id**，不能自己编一个：
 * `submitTaskWithData` 会把 `inputImageIds` 记进任务，执行时 `ensureImageCached(id)`
 * 先查内存缓存、再查图片存储 —— 自己编的 id 在存储里查不到，一旦内存缓存被淘汰，
 * 这张图就静默变成「没有参考图」。
 *
 * 池子自己那份副本（`creativePoolAssets`）才是真相源，所以这里不做「图不在了就放弃」，
 * 而是如实报出 missing 让调用方决定提示。
 */
export async function resolvePoolInputImages(
  items: CreativePoolItem[],
  assets: Map<string, string>,
): Promise<ResolvedPoolInputImages> {
  const images: InputImage[] = []
  let missing = 0
  for (const item of items) {
    const dataUrl = assets.get(item.assetRef)
    if (!dataUrl) {
      missing += 1
      continue
    }
    const imageId = await storeImage(dataUrl, 'upload')
    cacheImage(imageId, dataUrl)
    images.push({ id: imageId, dataUrl })
  }
  return { images, missing }
}
