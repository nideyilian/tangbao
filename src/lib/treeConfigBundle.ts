/**
 * 配置包 v8：以**项目树为骨架**的中控台配置快照（纯逻辑，无副作用）。
 *
 * 为什么要有它（2026-09-22 杰哥裁决「所有数据都跟着树来走，树就是根」）：
 * 此前的备份里，树结构（`assetCollections`）、水印库（`compositeState`）、渠道与尺寸
 * （`postprocessMediaState`）是**三块并排**，而挂在节点上的 `projectTreeParams`
 * **压根没进包** —— 把包拿到另一台机器恢复，得到的是
 * 「树在、水印在、渠道在，但谁挂谁全断了」。
 *
 * 这里就是把那句话翻成结构：
 *
 * ```
 * 配置包 v8
 * └ 根（全局默认）：渠道与尺寸字典、默认输出位置、命名模板、分发排期
 *    └ 产品线
 *        └ 产品：水印库（按产品隔离，含 LOGO 图）
 *            └ 方向：渠道选择、输出位置、命名、是否参与产出
 * ```
 *
 * **恢复顺序不可交换**：立树 → 灌节点参数 → 放水印库 → 挂渠道与输出位置。
 * 顺序反了会出现「引用了不存在的水印 / 渠道」，这类错误极难自查。
 *
 * 与 `ExportData` 的关系：v8 起包里写 `treeConfig`；导入侧见到它就走新路径，
 * 见不到（v7 及更早的老包）照旧走 `compositeState` / `postprocessMediaState` /
 * `assetCollections` 那套老字段。**两条路都留着**，老备份不作废。
 */

import type { AssetCollection } from '../types'
import type { CompositeV2Preset } from '../features/composite/lib/compositeV2Types'
import type { ProjectNodeKind, ProjectNodeParams } from '../features/projectTree/types'
import type { PostprocessMedia, PostprocessMediaConfig, PostprocessNodeOverride } from './postprocessMedia'

/** 包里的一个树节点。层级任意深（第 4 层及以后是 `extra`），所以结构是递归的。 */
export interface TreeConfigNode {
  id: string
  name: string
  /**
   * 层级语义（产品线 / 产品 / 方向 / 扩展层）。
   *
   * **不从 id 前缀反推**：自建节点没有 `builtin-*` 前缀，反推迟早出错。
   * 由调用方（素材库侧）按父子链算好传进来；算不出就留空，恢复时按 `parentId` 挂回去即可。
   */
  kind?: ProjectNodeKind
  order: number
  color?: string
  pinned?: boolean
  /** 这个节点自己的产出覆盖（任意层级都可能有）；没有 = 全继承 */
  postprocess?: PostprocessNodeOverride
  /** 节点参数最后改动时间 */
  updatedAt?: number
  /**
   * 挂在这个节点下的水印库（只有归属产品有；其余层级为空数组）。
   *
   * 判据是 `CompositeV2Preset.productId === 节点 id` —— **不看层级标记**：
   * 一个节点是不是"产品"由有没有水印挂在它下面说了算，这样自建节点也能当库主。
   */
  watermarks?: CompositeV2Preset[]
  children: TreeConfigNode[]
}

/**
 * 根节点（全局默认）：与具体方向无关的公共配置。
 *
 * 渠道与尺寸的**字典**放这里（全局一份，被各节点按 id 引用）；
 * 「哪个方向用哪几个渠道」则挂在该节点自己的 `postprocess.selectedMediaIds` 上。
 */
export interface TreeConfigRoot {
  /** 渠道与尺寸字典（原 `PostprocessMediaConfig.media`） */
  channels: PostprocessMedia[]
  /** 默认输出位置（空串 = 沿用应用默认位置） */
  outputDir: string
  /** 全局渠道层的导出位置覆盖（`mediaId → 1~2 个位置`） */
  mediaOutputDirs: Record<string, string[]>
  namePattern: string
  creator: string
  fitMode: PostprocessMediaConfig['fitMode']
  /** 默认引用的水印（各节点没表态时继承它） */
  watermarkPresetIds: string[]
  /** 默认参与产出的渠道 */
  selectedMediaIds: string[]
  direction: PostprocessMediaConfig['direction']
  autoCompanionClean: boolean
  distribution: PostprocessMediaConfig['distribution']
  /** 启用范围：这份配置勾了哪些节点（空 = 没启用） */
  selectedCollectionIds: string[]
}

export interface TreeConfigBundle {
  version: 8
  exportedAt: string
  root: TreeConfigRoot
  /** 树（第一层是产品线；深层的自建节点原样嵌在里面） */
  nodes: TreeConfigNode[]
  /**
   * 没分配到任何产品的水印预设。
   *
   * **必须单独兜住**：`productId` 缺省（老数据）或指向一个已被删除的产品时，
   * 按产品分组的循环会漏掉它们 —— 漏掉就等于**静默丢配置**，而用户看到的是
   * 「水印少了几套」却查不出为什么。恢复时按原有归属放回去。
   */
  unassignedWatermarks: CompositeV2Preset[]
  /**
   * 被跳过的回收站节点数（`trashedAt` 非空）。
   *
   * 不导出它们（回收站里的东西在别人机器上没有意义），但要**报个数** ——
   * 否则"我明明有 80 个方向，怎么只过去 74 个"会成为下一个报障。
   */
  trashedSkipped: number
}

export interface BuildTreeConfigInput {
  /** 素材库项目树（扁平，含 `parentId`） */
  collections: AssetCollection[]
  /** 节点参数覆盖表（`useProjectTreeParamsStore.params`） */
  nodeParams: Record<string, ProjectNodeParams>
  /** 全部水印预设（`useCompositeV2Store.presets`，含 `productId` 归属） */
  presets: CompositeV2Preset[]
  /** 全局产出配置（`usePostprocessMediaStore` 的快照） */
  postprocess: PostprocessMediaConfig
  /** 层级判定：给一个节点 id，回答它是产品线 / 产品 / 方向 / 扩展层 */
  resolveKind?: (collectionId: string) => ProjectNodeKind | undefined
  exportedAt?: string
}

/** 同级排序：`order` 为主，`id` 兜底 —— 排序键必须稳定，否则每次导出的包都长得不一样。 */
function sortSiblings(list: AssetCollection[]): AssetCollection[] {
  return [...list].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/**
 * 组装配置包（纯函数）。
 *
 * 只读入参、不改入参：`collections` / `presets` 都可能直接被 store 的 state 传进来，
 * 就地排序会**改到界面上的顺序**（这类"读的时候顺手改了状态"的 bug 极难定位）。
 */
export function buildTreeConfigBundle(input: BuildTreeConfigInput): TreeConfigBundle {
  const active = input.collections.filter((node) => !node.trashedAt)
  const trashedSkipped = input.collections.length - active.length

  const childrenOf = new Map<string, AssetCollection[]>()
  for (const node of active) {
    const parentId = node.parentId ?? ''
    const list = childrenOf.get(parentId)
    if (list) list.push(node)
    else childrenOf.set(parentId, [node])
  }

  /** 挂在各产品下的水印；没归属的（缺省 / 指向已删产品）另存，见 `unassignedWatermarks` 注释。 */
  const presetsByOwner = new Map<string, CompositeV2Preset[]>()
  const knownIds = new Set(active.map((node) => node.id))
  const unassignedWatermarks: CompositeV2Preset[] = []
  for (const preset of input.presets) {
    const owner = (preset.productId ?? '').trim()
    if (!owner || !knownIds.has(owner)) {
      unassignedWatermarks.push(preset)
      continue
    }
    const list = presetsByOwner.get(owner)
    if (list) list.push(preset)
    else presetsByOwner.set(owner, [preset])
  }

  const buildNode = (node: AssetCollection): TreeConfigNode => {
    const params = input.nodeParams[node.id]
    const kind = input.resolveKind?.(node.id)
    const watermarks = presetsByOwner.get(node.id)
    return {
      id: node.id,
      name: node.name,
      ...(kind ? { kind } : {}),
      order: node.order,
      ...(node.color ? { color: node.color } : {}),
      ...(node.pinned ? { pinned: true } : {}),
      ...(params?.postprocess ? { postprocess: params.postprocess } : {}),
      ...(params?.updatedAt ? { updatedAt: params.updatedAt } : {}),
      ...(watermarks && watermarks.length > 0 ? { watermarks } : {}),
      children: sortSiblings(childrenOf.get(node.id) ?? []).map(buildNode),
    }
  }

  const config = input.postprocess
  return {
    version: 8,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    root: {
      channels: config.media,
      outputDir: config.outputDir,
      mediaOutputDirs: config.mediaOutputDirs,
      namePattern: config.namePattern,
      creator: config.creator,
      fitMode: config.fitMode,
      watermarkPresetIds: config.watermarkPresetIds,
      selectedMediaIds: config.selectedMediaIds,
      direction: config.direction,
      autoCompanionClean: config.autoCompanionClean,
      distribution: config.distribution,
      selectedCollectionIds: config.selectedCollectionIds,
    },
    // 顶层只放没有父节点的那些（游离节点也要导出去，否则同样算丢配置）
    nodes: sortSiblings(childrenOf.get('') ?? []).map(buildNode),
    unassignedWatermarks,
    trashedSkipped,
  }
}

/** 展平后的一条节点记录：`AssetCollection` 减去由树形本身表达的东西。 */
export interface FlatTreeConfigNode {
  id: string
  name: string
  parentId: string | null
  order: number
  color?: string
  pinned?: boolean
  kind?: ProjectNodeKind
  postprocess?: PostprocessNodeOverride
  updatedAt?: number
  watermarks?: CompositeV2Preset[]
}

/**
 * 深度优先展平（恢复侧用）。
 *
 * `parentId` 由递归路径带出来，不从节点上读 —— 树形里本来就没有这个字段，
 * 让每个节点自己记住父节点等于把同一份信息存两遍，早晚不一致。
 */
export function flattenTreeConfigNodes(nodes: TreeConfigNode[]): FlatTreeConfigNode[] {
  const flat: FlatTreeConfigNode[] = []
  const walk = (list: TreeConfigNode[], parentId: string | null) => {
    for (const node of list) {
      flat.push({
        id: node.id,
        name: node.name,
        parentId,
        order: node.order,
        ...(node.color ? { color: node.color } : {}),
        ...(node.pinned ? { pinned: true } : {}),
        ...(node.kind ? { kind: node.kind } : {}),
        ...(node.postprocess ? { postprocess: node.postprocess } : {}),
        ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
        ...(node.watermarks && node.watermarks.length > 0 ? { watermarks: node.watermarks } : {}),
      })
      walk(node.children, node.id)
    }
  }
  walk(nodes, null)
  return flat
}

/** 包里全部水印预设（含未分配的）。**恢复侧的入口只有这一个** —— 两处各扫一遍必然漏一处。 */
export function collectTreeConfigPresets(bundle: TreeConfigBundle): CompositeV2Preset[] {
  const presets: CompositeV2Preset[] = []
  const walk = (list: TreeConfigNode[]) => {
    for (const node of list) {
      if (node.watermarks) presets.push(...node.watermarks)
      walk(node.children)
    }
  }
  walk(bundle.nodes)
  presets.push(...bundle.unassignedWatermarks)
  return presets
}

/**
 * 包里的树 → `AssetCollection[]`（恢复侧第一步：立树）。
 *
 * `normalizedName` / `createdAt` / `updatedAt` 在包里没存（它们是本地索引与时间戳），
 * 按落库口径补齐：前者由 `name` 推，后两者用 `now`。
 */
export function toAssetCollections(bundle: TreeConfigBundle, now = Date.now()): AssetCollection[] {
  return flattenTreeConfigNodes(bundle.nodes).map((node) => ({
    id: node.id,
    name: node.name,
    normalizedName: node.name.trim().toLowerCase(),
    parentId: node.parentId,
    order: node.order,
    ...(node.color ? { color: node.color } : {}),
    ...(node.pinned ? { pinned: true } : {}),
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }))
}

/** 包里的节点参数 → `Record<collectionId, ProjectNodeParams>`（恢复侧第二步：灌参数）。 */
export function toNodeParams(bundle: TreeConfigBundle): Record<string, ProjectNodeParams> {
  const params: Record<string, ProjectNodeParams> = {}
  for (const node of flattenTreeConfigNodes(bundle.nodes)) {
    if (!node.postprocess) continue
    params[node.id] = {
      postprocess: node.postprocess,
      ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
    }
  }
  return params
}

/** 包里的根 + 渠道字典 → `PostprocessMediaConfig`（恢复侧最后一步：挂渠道与输出位置）。 */
export function toPostprocessMediaConfig(bundle: TreeConfigBundle): PostprocessMediaConfig {
  const { root } = bundle
  return {
    media: root.channels,
    selectedMediaIds: root.selectedMediaIds,
    selectedCollectionIds: root.selectedCollectionIds,
    direction: root.direction,
    fitMode: root.fitMode,
    outputDir: root.outputDir,
    mediaOutputDirs: root.mediaOutputDirs,
    namePattern: root.namePattern,
    creator: root.creator,
    watermarkPresetIds: root.watermarkPresetIds,
    autoCompanionClean: root.autoCompanionClean,
    distribution: root.distribution,
  }
}

/** 结构体检：包能不能用。恢复前先过一遍，别拿半个包去覆盖用户的配置。 */
export function validateTreeConfigBundle(
  value: unknown,
): { ok: true; bundle: TreeConfigBundle } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') return { ok: false, reason: '配置包不是一个对象' }
  const bundle = value as Partial<TreeConfigBundle>
  if (bundle.version !== 8) return { ok: false, reason: `配置包版本不认识：${String(bundle.version)}` }
  if (!Array.isArray(bundle.nodes)) return { ok: false, reason: '配置包里没有树（nodes）' }
  if (!bundle.root || typeof bundle.root !== 'object') return { ok: false, reason: '配置包里没有根节点配置' }
  if (!Array.isArray(bundle.root.channels)) return { ok: false, reason: '配置包里没有渠道与尺寸字典' }
  return {
    ok: true,
    bundle: {
      ...(bundle as TreeConfigBundle),
      unassignedWatermarks: Array.isArray(bundle.unassignedWatermarks) ? bundle.unassignedWatermarks : [],
      trashedSkipped: typeof bundle.trashedSkipped === 'number' ? bundle.trashedSkipped : 0,
    },
  }
}
