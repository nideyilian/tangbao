/**
 * 「水印库按产品隔离」的一次性迁移（persist v7 的配套，2026-09-21）。
 *
 * **为什么不在 `persist.migrate` 里做**：那里只有本 store 的持久化数据，而这次要回答的
 * 两个问题都在**别的 store** ——
 * ① 这套水印被哪个产品的方向勾过（要 `collections` + `params`）；
 * ② 旧的全局 / 产品线级水印清单该摊给谁（要 `collections`）。
 *
 * **两步的顺序不能反**（先摊旧清单，再推断归属）：摊这一步会让产品节点上出现显式清单，
 * 而推断正是读这些清单。反过来的话，那些「只出现在全局清单里、没有任何方向显式勾过」的水印
 * 会保持未分配 —— 产出链路按 id 全局找预设照样会用它，于是变成
 * 「生成图带了这套水印，但界面上哪儿都找不到它」，比丢掉更难查。
 *
 * **只跑一次**，跑过的标记落在 `CompositeV2LocalState.presetProductMigrationVersion`
 * （未分配是合法状态，没有标记的话用户主动摘出来的水印会在下次启动被自动收回）。
 */

import type { AssetCollection } from '../../../types'
import { normalizePresetProductId } from './compositePresetLibrary'
import type { CompositeV2Preset } from './compositeV2Types'
import type { ProjectNodeParamsMap } from '../../projectTree/types'
import { resolveOwningProductId } from '../../projectTree/params'

/** 本次迁移的版本号；store 里记 >= 这个值就不再跑。 */
export const PRESET_PRODUCT_MIGRATION_VERSION = 1

/** 一条参数写入：某节点（可再细分到渠道）的水印清单改成 `presetIds`。 */
export interface PresetProductParamUpdate {
  collectionId: string
  /** `null` = 本节点的通用清单（`watermarkPresetIds`）；否则是该渠道（`byMedia[mediaId]`） */
  mediaId: string | null
  presetIds: string[]
}

/**
 * 收集全树「显式声明」的水印清单位置。
 *
 * 只认显式声明：继承来的不进迁移 —— 继承是**算出来的**结果，把它落成声明等于把结论固化，
 * 以后改上层就再也影响不到下层（与 `resolveNodeWatermarkBinding` 的口径一致）。
 */
interface WatermarkSlot {
  collectionId: string
  mediaId: string | null
  presetIds: string[]
}

function collectWatermarkSlots(params: ProjectNodeParamsMap): WatermarkSlot[] {
  const slots: WatermarkSlot[] = []
  // `Object.keys` 顺序不可依赖，显式排序保证同一份数据每次迁移得到同样的副本 id 与同样的写入顺序
  for (const collectionId of Object.keys(params).sort()) {
    const override = params[collectionId]?.postprocess
    if (!override) continue
    if (Array.isArray(override.watermarkPresetIds)) {
      slots.push({ collectionId, mediaId: null, presetIds: [...override.watermarkPresetIds] })
    }
    for (const mediaId of Object.keys(override.byMedia ?? {}).sort()) {
      const perMedia = override.byMedia?.[mediaId]
      if (perMedia && Array.isArray(perMedia.watermarkPresetIds)) {
        slots.push({ collectionId, mediaId, presetIds: [...perMedia.watermarkPresetIds] })
      }
    }
  }
  return slots
}

/** 产品节点（项目树第二级）：父为产品线、或父为空的根节点都算，只要它自己不是别人的子层。 */
function listProductIds(collections: AssetCollection[]): string[] {
  return collections
    .filter((item) => !item.trashedAt && resolveOwningProductId(collections, item.id) === item.id)
    .map((item) => item.id)
}

function productName(collections: AssetCollection[], productId: string): string {
  return collections.find((item) => item.id === productId)?.name ?? productId
}

// ---------------------------------------------------------------- 第一步：摊旧清单

export interface LegacyWatermarkPushdownInput {
  collections: AssetCollection[]
  params: ProjectNodeParamsMap
  /** 旧的全局基线（`usePostprocessMediaStore.watermarkPresetIds`） */
  globalPresetIds: string[]
}

export interface LegacyWatermarkPushdownPlan {
  /** 要写到产品节点上的通用清单 */
  paramUpdates: PresetProductParamUpdate[]
  /** 摊完之后要清掉 `watermarkPresetIds` 的产品线节点（它们的值已经摊给下辖产品） */
  lineCleanupIds: string[]
  /** 全局基线是否要清空（已成功摊给产品，留着只会让人以为它还在生效） */
  clearGlobalPresetIds: boolean
}

/**
 * 把 v6 之前的「全局基线」与「产品线级清单」摊到每个产品上。
 *
 * **为什么非摊不可**：隔离后各产品读各自的库，而 v6 的水印解析是
 * 「方向 → 产品 → 产品线 → 全局默认」逐级继承。直接让上层失效等于把用户配好的水印
 * 一次性抹掉（R-63 记的就是这类事故）；摊成「每个产品各一份」既保住已配的值，
 * 又让每个产品都有一份能自己管理的清单。
 *
 * 只摊**非空**清单：空数组的语义是「显式不加水印」，而产品没写过时本来就不加水印，
 * 写进去只会多一条什么都没改的记录。
 *
 * 产品自己已经写过 → 不动（用户在当前层的表态优先于上层）。
 */
export function planLegacyWatermarkPushdown(input: LegacyWatermarkPushdownInput): LegacyWatermarkPushdownPlan {
  const productIds = listProductIds(input.collections)
  const updates: PresetProductParamUpdate[] = []
  const usedLineIds = new Set<string>()
  let usedGlobal = false

  for (const productId of productIds) {
    const product = input.collections.find((item) => item.id === productId)
    const alreadyDeclared = input.params[productId]?.postprocess?.watermarkPresetIds !== undefined
    if (alreadyDeclared) continue

    const lineId = product?.parentId ?? ''
    const linePresetIds = lineId ? input.params[lineId]?.postprocess?.watermarkPresetIds : undefined
    if (Array.isArray(linePresetIds) && linePresetIds.length > 0) {
      updates.push({ collectionId: productId, mediaId: null, presetIds: [...linePresetIds] })
      usedLineIds.add(lineId)
      continue
    }
    if (input.globalPresetIds.length > 0) {
      updates.push({ collectionId: productId, mediaId: null, presetIds: [...input.globalPresetIds] })
      usedGlobal = true
    }
  }

  return {
    paramUpdates: updates,
    // 只在**真的摊下去了**才清产品线层：产品线下面一个产品都没有时清掉它就等于删数据
    lineCleanupIds: [...usedLineIds],
    clearGlobalPresetIds: usedGlobal,
  }
}

// ---------------------------------------------------------------- 第二步：推断归属

export interface PresetProductClaimInput {
  presets: CompositeV2Preset[]
  collections: AssetCollection[]
  params: ProjectNodeParamsMap
}

export interface PresetProductClaimPlan {
  presets: CompositeV2Preset[]
  paramUpdates: PresetProductParamUpdate[]
  /** 归到单一产品的预设数 */
  assigned: number
  /** 因为被多个产品的方向共用而复制出来的副本数 */
  duplicated: number
  /** 仍然未分配的（没有任何产品的节点勾过它） */
  unassigned: number
}

/**
 * 按现有归属推断每套水印属于哪个产品。
 *
 * 三种情形：
 * - 恰好 1 个产品勾过它 → 直接归过去，参数不用动；
 * - **多个产品勾过它**（跨产品共用）→ 每个产品各**复制一份**，并把该产品下的引用改指到副本。
 *   隔离的语义就是互不共用：留着一份让两个产品共写，等于「改 A 的水印顺手改了 B 的」，
 *   正是这次要治的病。副本名带产品名后缀，便于在两个库里对上号；
 * - 没有任何产品的节点勾过它 → 保持未分配。
 */
export function planPresetProductClaim(input: PresetProductClaimInput): PresetProductClaimPlan {
  const slots = collectWatermarkSlots(input.params)
  /**
   * slot 的所属产品（`null` = 产品线层 / 节点已不存在 / 产品在回收站，都不参与推断）。
   *
   * 与 `planLegacyWatermarkPushdown` 用**同一份**产品清单：那边摊给谁、这边就归给谁，
   * 两边口径不一致的话会出现「摊给产品的清单里那套水印自己没归过去」这种半拉子状态。
   */
  const productIds = new Set(listProductIds(input.collections))
  const productIdOfSlot = slots.map((slot) => {
    const productId = resolveOwningProductId(input.collections, slot.collectionId)
    return productId && productIds.has(productId) ? productId : null
  })

  const existingIds = new Set(input.presets.map((preset) => preset.id))
  /** 原 id → 主份归的产品 */
  const primaryProductByPreset = new Map<string, string>()
  /** `${原 id}|${产品}` → 副本 id（只有跨产品共用才有） */
  const copyIdByPresetProduct = new Map<string, string>()
  const extraPresets: CompositeV2Preset[] = []
  let assigned = 0
  let duplicated = 0

  for (const preset of input.presets) {
    if (normalizePresetProductId(preset.productId)) continue
    const products: string[] = []
    slots.forEach((slot, index) => {
      const productId = productIdOfSlot[index]
      if (!productId || !slot.presetIds.includes(preset.id) || products.includes(productId)) return
      products.push(productId)
    })
    if (products.length === 0) continue

    const primary = products[0]!
    primaryProductByPreset.set(preset.id, primary)
    assigned++
    for (const productId of products.slice(1)) {
      const copyId = buildCopyPresetId(preset.id, productId, existingIds)
      existingIds.add(copyId)
      copyIdByPresetProduct.set(`${preset.id}|${productId}`, copyId)
      duplicated++
      extraPresets.push({
        ...structuredClone(preset),
        id: copyId,
        name: `${preset.name}（${productName(input.collections, productId)}）`,
        productId,
      })
    }
  }

  // 重写被牵动的水印清单：副本产品下的引用改指副本，主产品与其余节点保持原样。
  const paramUpdates: PresetProductParamUpdate[] = []
  slots.forEach((slot, index) => {
    const productId = productIdOfSlot[index]
    if (!productId) return
    const nextIds = slot.presetIds.map((presetId) => copyIdByPresetProduct.get(`${presetId}|${productId}`) ?? presetId)
    if (nextIds.length === slot.presetIds.length && nextIds.every((id, i) => id === slot.presetIds[i])) return
    paramUpdates.push({ collectionId: slot.collectionId, mediaId: slot.mediaId, presetIds: nextIds })
  })

  const claimed = primaryProductByPreset.size > 0 || extraPresets.length > 0
  // 一套都没归出去时**返回原数组引用**：调用方据此判断「这次什么都没改」，
  // 不去写一份逐条相同的新数组（写了会让所有订阅预设的组件白白重渲一次）
  const presets = claimed
    ? input.presets.map((preset) => {
        const productId = primaryProductByPreset.get(preset.id)
        return productId ? { ...preset, productId } : preset
      })
    : input.presets

  return {
    presets: claimed ? [...presets, ...extraPresets] : presets,
    paramUpdates,
    assigned,
    duplicated,
    unassigned: presets.filter((preset) => !normalizePresetProductId(preset.productId)).length,
  }
}

/**
 * 副本 id：`原id--产品id`，冲突时补序号。
 *
 * 刻意做成**确定性**的（不掺随机数 / 时间戳）：同一份数据重复迁移必须得到同样的 id，
 * 否则「跑两次」会凭空长出两批副本 —— 这类问题只会在用户的机器上偶发一次，极难复现。
 */
function buildCopyPresetId(originalId: string, productId: string, existing: Set<string>): string {
  const base = `${originalId}--${productId}`
  if (!existing.has(base)) return base
  let index = 2
  while (existing.has(`${base}-${index}`)) index++
  return `${base}-${index}`
}
