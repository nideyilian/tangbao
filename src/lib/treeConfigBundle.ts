/**
 * 配置包 v9：以**项目树为骨架**的中控台配置快照（纯逻辑，无副作用）。
 *
 * 字段级规范见 `docs/config-spec.md`（**唯一真相源**）—— 本文件只负责「怎么装卸」，
 * 「每个字段是什么、默认值多少、必填还是选填」一律以那份文档为准。
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
 * 配置包 v9
 * ├ format            文件头（类型、版本、导出信息）
 * ├ defaults          全局默认层：渠道与尺寸字典、输出位置、命名、水印引用、产出选择、画面、分发
 * ├ watermarkLibrary  水印库的库级配置（LOGO 列表与顺序、标识符、水印全局适配、背景文件夹）
 * └ tree              项目树（第一层是产品线）
 *     └ 产品：watermarkPresets（按 productId 归属，含 LOGO 图）
 *         └ 方向：overrides（渠道选择、输出位置、命名、是否参与产出）
 * ```
 *
 * **恢复顺序不可交换**：立树 → 灌节点参数 → 放水印库 → 挂渠道与输出位置。
 * 顺序反了会出现「引用了不存在的水印 / 渠道」，这类错误极难自查。
 *
 * **v9 与 v8 的差别**（规范 §八）：配置从包内 `manifest.treeConfig` 字段拆成包内独立的一份
 * `config.json`；`root` → `defaults`、`nodes` → `tree`；节点 `postprocess` → `overrides`、
 * `watermarks` → `watermarkPresets`；`version` + `exportedAt` 收进 `format`；
 * 新增 `watermarkLibrary`（原先靠 `compositeState` 那条并排的路带，现在树是唯一入口）。
 * **不再保留 v7 及更早的老恢复路径** —— 不受向后兼容约束（糖包尚未交付他人使用）。
 */

import type { AssetCollection } from '../types'
import type {
  CompositeV2FitMode,
  CompositeV2IdentifierConfig,
  CompositeV2PersistedSnapshot,
  CompositeV2Preset,
  CompositeV2ProjectLogo,
} from '../features/composite/lib/compositeV2Types'
import type { ProjectNodeKind, ProjectNodeParams } from '../features/projectTree/types'
import {
  POSTPROCESS_FIELD_GROUP,
  type PostprocessFieldGroup,
  type PostprocessMedia,
  type PostprocessMediaConfig,
  type PostprocessNodeOverride,
} from './postprocessMedia'

/** 包结构版本。**结构变化才 +1**；纯新增可选字段不 bump（缺字段回落旧行为即可）。 */
export const TREE_CONFIG_VERSION = 9
/** 文件类型标记：一眼认出这是配置本体（而不是备份包里别的 json）。 */
export const TREE_CONFIG_KIND = 'tangbao-config'
/**
 * 配置本体在包内的固定路径。
 *
 * v9 起配置是包内**独立一份** `config.json`（不再塞进 `manifest.json` 的一个字段）：
 * 这样它人可读、可手改、可整份替换，而 manifest 只管「包里有哪些文件」。
 * 导入侧按这个固定路径找 —— 找不到就是老包或不完整的包，**整包拒收**。
 */
export const TREE_CONFIG_ENTRY = 'config.json'

/**
 * 文件头。不是配置内容，改它不影响产出 —— 所以与 `defaults` / `tree` 平级，而不是塞进某一层。
 */
export interface TreeConfigFormat {
  kind: typeof TREE_CONFIG_KIND
  version: number
  /** ISO 8601；排查「这份包什么时候发的」用 */
  exportedAt: string
  /** 导出这份配置的糖包版本，如 `0.3.2`；拿不到就省略 */
  appVersion?: string
  /**
   * 导出时被跳过的回收站节点数。
   *
   * 回收站里的节点**不进包**（在别人机器上没有意义），但必须**报个数** ——
   * 否则"我明明有 80 个方向，怎么只过去 74 个"会成为下一个报障。
   */
  skippedNodes: number
}

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
  overrides?: PostprocessNodeOverride
  /** 节点参数最后改动时间 */
  updatedAt?: number
  /**
   * 挂在这个节点下的水印库（只有归属产品有；其余层级省略）。
   *
   * 判据是 `CompositeV2Preset.productId === 节点 id` —— **不看层级标记**：
   * 一个节点是不是"产品"由有没有水印挂在它下面说了算，这样自建节点也能当库主。
   */
  watermarkPresets?: CompositeV2Preset[]
  children: TreeConfigNode[]
}

/**
 * 全局默认层：与具体方向无关的公共配置。**它不对应树上的任何节点。**
 *
 * 渠道与尺寸的**字典**放这里（全局一份，被各节点按 id 引用）；
 * 「哪个方向用哪几个渠道」则挂在该节点自己的 `overrides.selectedMediaIds` 上。
 */
export interface TreeConfigDefaults {
  /** 渠道与尺寸字典（原 `PostprocessMediaConfig.media`） */
  channels: PostprocessMedia[]
  /** 默认输出位置（空串 = 沿用应用默认位置） */
  outputDir: string
  /** 全局渠道层的导出位置覆盖（`mediaId → 1~2 个位置`） */
  mediaOutputDirs: Record<string, string[]>
  /**
   * 全局渠道层的**导出位置开关**（`mediaId → { 路径: 是否启用 }`；缺键 = 启用）。
   *
   * 跟着配置包走：它是「这套配置要不要往这一处写」的一部分。落在包外的话，换台机器导入
   * 会**把停用的交付目录重新打开**（比如共享盘本来被关着），属于静默改变产出行为。
   */
  mediaOutputDirEnabled: PostprocessMediaConfig['mediaOutputDirEnabled']
  namePattern: string
  creator: string
  fitMode: PostprocessMediaConfig['fitMode']
  /** 默认引用的水印（各节点没表态时继承它） */
  watermarkPresetIds: string[]
  /** 默认参与产出的渠道 */
  selectedMediaIds: string[]
  direction: PostprocessMediaConfig['direction']
  distribution: PostprocessMediaConfig['distribution']
  /** 启用范围：这份配置勾了哪些节点（空 = 没启用） */
  selectedCollectionIds: string[]
  /**
   * 「记住配置」保存的产出目标（空 = 没记住，按图片归属方向产出）。
   *
   * 跟着配置包走：「这套配置该产出到哪些方向」是配置本身的一部分。落在包外的话，
   * 别人导入这份包会**少掉目标**却看不出少在哪 —— 属于 R-63 那一类静默丢配置。
   */
  savedTargetCollectionIds: string[]
  /**
   * 按文件夹存的产出目标（键 = 节点 id）。**跟着配置包走**，理由同上。
   *
   * 键指向的节点 id 在别的机器上可能对不上（那棵树是另一套 id）：导入后表现为「那份按方向
   * 细分的清单没跟过来」，而不是产出到错误的方向 —— 取用时查不到就是没设过，
   * 退回按归属产出（见 `directionTargets.ts`）。这比"猜一个方向折算过去"安全。
   */
  savedTargetsByFolder: Record<string, string[]>
}

/**
 * 水印库的**库级**配置（全局一份，不属于任何节点）。
 *
 * 水印库有两半：库级配置（这里）与预设本体（`tree[].watermarkPresets`）。
 * v8 里这半是跟着并排的 `compositeState` 走的；v9 起树是唯一入口，所以它必须有位置 ——
 * 否则删掉 `compositeState` 就等于把这些字段静默丢掉。
 */
export interface TreeConfigWatermarkLibrary {
  /** LOGO 列表；图片本体按 `assetId` 落库并随包打包 */
  logos: CompositeV2ProjectLogo[]
  /** LOGO 的展示顺序（元素是 `logos[].id`） */
  logoOrder: string[]
  /** LOGO 库文件夹（本机路径，换机器不保证可用） */
  libraryPath: string
  /** 水印画布的适配方式。**与后处理的 `fitMode` 不是同一个** */
  globalFitMode: CompositeV2FitMode
  /** 水印标识符（署名）；缺省时由归一化兜底 */
  identifier?: CompositeV2IdentifierConfig
  /** 背景图文件夹（本机路径） */
  backgroundFolders?: string[]
  /** 背景图是否递归扫子目录 */
  recursiveBackgrounds?: boolean
}

export interface TreeConfigBundle {
  format: TreeConfigFormat
  defaults: TreeConfigDefaults
  watermarkLibrary: TreeConfigWatermarkLibrary
  /** 树（第一层是产品线；深层的自建节点原样嵌在里面） */
  tree: TreeConfigNode[]
  /**
   * 没分配到任何产品的水印预设。
   *
   * **必须单独兜住**：`productId` 缺省（老数据）或指向一个已被删除的产品时，
   * 按产品分组的循环会漏掉它们 —— 漏掉就等于**静默丢配置**，而用户看到的是
   * 「水印少了几套」却查不出为什么。恢复时按原有归属放回去。
   */
  unassignedWatermarks: CompositeV2Preset[]
}

export interface BuildTreeConfigInput {
  /** 素材库项目树（扁平，含 `parentId`） */
  collections: AssetCollection[]
  /** 节点参数覆盖表（`useProjectTreeParamsStore.params`） */
  nodeParams: Record<string, ProjectNodeParams>
  /** 全部水印预设（`useCompositeV2Store.presets`，含 `productId` 归属） */
  presets: CompositeV2Preset[]
  /** 水印库的库级配置（`getCompositeV2PersistedState` 的那一半） */
  watermarkLibrary: TreeConfigWatermarkLibrary
  /** 全局产出配置（`usePostprocessMediaStore` 的快照） */
  postprocess: PostprocessMediaConfig
  /** 层级判定：给一个节点 id，回答它是产品线 / 产品 / 方向 / 扩展层 */
  resolveKind?: (collectionId: string) => ProjectNodeKind | undefined
  /** 导出这份配置的糖包版本 */
  appVersion?: string
  exportedAt?: string
}

/**
 * `PostprocessMediaConfig` 的每个字段 → 它在配置包 `defaults` 里叫什么。
 *
 * **这是一道编译期闸门**：类型写成 `Record<keyof PostprocessMediaConfig, …>`，
 * 于是 `PostprocessMediaConfig` 一旦新增字段而这里没跟上，**编译就红**。
 *
 * 为什么必须有它：`buildTreeConfigBundle` 里就算手写 13 行也对不上 ——
 * 加了新设置却忘了写进来，编译不会报错，表现是「这个设置在别的机器上莫名回到默认值」
 * （R-65 家族：重建对象时漏字段）。进出两个方向都从这一张表生成，**不可能不对称**。
 */
const POSTPROCESS_FIELD_TO_DEFAULTS: Record<keyof PostprocessMediaConfig, keyof TreeConfigDefaults> = {
  media: 'channels',
  selectedMediaIds: 'selectedMediaIds',
  selectedCollectionIds: 'selectedCollectionIds',
  savedTargetCollectionIds: 'savedTargetCollectionIds',
  savedTargetsByFolder: 'savedTargetsByFolder',
  direction: 'direction',
  fitMode: 'fitMode',
  outputDir: 'outputDir',
  mediaOutputDirs: 'mediaOutputDirs',
  mediaOutputDirEnabled: 'mediaOutputDirEnabled',
  namePattern: 'namePattern',
  creator: 'creator',
  watermarkPresetIds: 'watermarkPresetIds',
  distribution: 'distribution',
}

const DEFAULT_FIELD_PAIRS = Object.entries(POSTPROCESS_FIELD_TO_DEFAULTS) as Array<
  [keyof PostprocessMediaConfig, keyof TreeConfigDefaults]
>

/** 全局产出配置 → 包里的 `defaults`（纯搬运，字段对应关系见上面那张表）。 */
function toTreeConfigDefaults(config: PostprocessMediaConfig): TreeConfigDefaults {
  const mapped: Record<string, unknown> = {}
  for (const [processKey, defaultsKey] of DEFAULT_FIELD_PAIRS) {
    mapped[defaultsKey] = config[processKey]
  }
  // 表驱动映射的固有代价：运行时拼出来的对象，类型系统追不到逐字段对应关系，只能断言过去。
  // 换来的是**编译期闸门**（表缺键即红）与「进 / 出两个方向必然对称」—— 这笔买卖划算。
  return mapped as unknown as TreeConfigDefaults
}

/** 反查：包里的 `defaults` → 全局产出配置。**与上面共用同一张表**。 */
function fromTreeConfigDefaults(defaults: TreeConfigDefaults): PostprocessMediaConfig {
  const mapped: Record<string, unknown> = {}
  for (const [processKey, defaultsKey] of DEFAULT_FIELD_PAIRS) {
    mapped[processKey] = defaults[defaultsKey]
  }
  // 纯新增字段：老包可能缺它 → 空数组 = 按图片归属方向产出（与旧行为一致）
  mapped.savedTargetCollectionIds = defaults.savedTargetCollectionIds ?? []
  // 同上：老包没有"按文件夹"这一层 → 空表 = 所有方向都按归属产出
  mapped.savedTargetsByFolder = defaults.savedTargetsByFolder ?? {}
  return mapped as unknown as PostprocessMediaConfig
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
  const skippedNodes = input.collections.length - active.length

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
    const watermarkPresets = presetsByOwner.get(node.id)
    return {
      id: node.id,
      name: node.name,
      ...(kind ? { kind } : {}),
      order: node.order,
      ...(node.color ? { color: node.color } : {}),
      ...(node.pinned ? { pinned: true } : {}),
      ...(params?.postprocess ? { overrides: params.postprocess } : {}),
      ...(params?.updatedAt ? { updatedAt: params.updatedAt } : {}),
      ...(watermarkPresets && watermarkPresets.length > 0 ? { watermarkPresets } : {}),
      children: sortSiblings(childrenOf.get(node.id) ?? []).map(buildNode),
    }
  }

  const config = input.postprocess
  const library = input.watermarkLibrary
  return {
    format: {
      kind: TREE_CONFIG_KIND,
      version: TREE_CONFIG_VERSION,
      exportedAt: input.exportedAt ?? new Date().toISOString(),
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
      skippedNodes,
    },
    defaults: toTreeConfigDefaults(config),
    watermarkLibrary: {
      logos: library.logos,
      logoOrder: library.logoOrder,
      libraryPath: library.libraryPath,
      globalFitMode: library.globalFitMode,
      ...(library.identifier ? { identifier: library.identifier } : {}),
      ...(library.backgroundFolders ? { backgroundFolders: library.backgroundFolders } : {}),
      ...(library.recursiveBackgrounds === undefined ? {} : { recursiveBackgrounds: library.recursiveBackgrounds }),
    },
    // 顶层只放没有父节点的那些（游离节点也要导出去，否则同样算丢配置）
    tree: sortSiblings(childrenOf.get('') ?? []).map(buildNode),
    unassignedWatermarks,
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
  overrides?: PostprocessNodeOverride
  updatedAt?: number
  watermarkPresets?: CompositeV2Preset[]
}

/**
 * 深度优先展平（恢复侧用）。
 *
 * `parentId` 由递归路径带出来，不从节点上读 —— 树形里本来就没有这个字段，
 * 让每个节点自己记住父节点等于把同一份信息存两遍，早晚不一致。
 */
export function flattenTreeConfigNodes(tree: TreeConfigNode[]): FlatTreeConfigNode[] {
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
        ...(node.overrides ? { overrides: node.overrides } : {}),
        ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
        ...(node.watermarkPresets && node.watermarkPresets.length > 0
          ? { watermarkPresets: node.watermarkPresets }
          : {}),
      })
      walk(node.children, node.id)
    }
  }
  walk(tree, null)
  return flat
}

/** 包里全部水印预设（含未分配的）。**恢复侧的入口只有这一个** —— 两处各扫一遍必然漏一处。 */
export function collectTreeConfigPresets(bundle: TreeConfigBundle): CompositeV2Preset[] {
  const presets: CompositeV2Preset[] = []
  const walk = (list: TreeConfigNode[]) => {
    for (const node of list) {
      if (node.watermarkPresets) presets.push(...node.watermarkPresets)
      walk(node.children)
    }
  }
  walk(bundle.tree)
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
  return flattenTreeConfigNodes(bundle.tree).map((node) => ({
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

/** 包里的节点覆盖 → `Record<collectionId, ProjectNodeParams>`（恢复侧第二步：灌参数）。 */
export function toNodeParams(bundle: TreeConfigBundle): Record<string, ProjectNodeParams> {
  const params: Record<string, ProjectNodeParams> = {}
  for (const node of flattenTreeConfigNodes(bundle.tree)) {
    if (!node.overrides) continue
    params[node.id] = {
      postprocess: node.overrides,
      ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
    }
  }
  return params
}

/**
 * 包里的水印库 → 可喂给 `replaceCompositeV2PersistedState` 的快照（恢复侧第三步：放水印库）。
 *
 * `presets` 一律走 `collectTreeConfigPresets`（含未归属的）——
 * 两处各扫一遍必然漏一处，而漏掉的表现是"水印少了几套"且查不出为什么。
 * `selectedPreviewPresetId` 刻意不设：它是「我上次在看哪套」的 UI 状态，不属于配置，
 * 由 `mergeCompositeV2PersistedState` 按「预设还在就保留」自行决定。
 */
export function toCompositeV2State(bundle: TreeConfigBundle): CompositeV2PersistedSnapshot {
  const library = bundle.watermarkLibrary
  return {
    logoLibraryPath: library.libraryPath,
    logoOrder: library.logoOrder,
    projectLogos: library.logos,
    presets: collectTreeConfigPresets(bundle),
    globalFitMode: library.globalFitMode,
    ...(library.identifier ? { identifier: library.identifier } : {}),
    ...(library.backgroundFolders ? { backgroundFolders: library.backgroundFolders } : {}),
    ...(library.recursiveBackgrounds === undefined ? {} : { recursiveBackgrounds: library.recursiveBackgrounds }),
  }
}

/** 包里的全局默认层 + 渠道字典 → `PostprocessMediaConfig`（恢复侧最后一步：挂渠道与输出位置）。 */
export function toPostprocessMediaConfig(bundle: TreeConfigBundle): PostprocessMediaConfig {
  return fromTreeConfigDefaults(bundle.defaults)
}

/**
 * 按覆盖范围把包里的全局产出配置叠到本机那份上：**勾了的组用包里的，没勾的组保持本机原样**。
 *
 * 必须**按字段拼**而不是整份替换 —— 「渠道与尺寸」与「全局产出配置」住在**同一个对象**里
 * （`PostprocessMediaConfig`），整份替换会让只想换渠道的人连命名模板一起被换掉。
 * 某个字段归哪一组由 `POSTPROCESS_FIELD_GROUP` 决定（那张表漏一个字段就编译报错）。
 *
 * 做成纯函数是为了好测：它没有副作用，也不认识 store。
 */
export function applyPostprocessScope(
  current: PostprocessMediaConfig,
  incoming: PostprocessMediaConfig,
  enabled: Record<PostprocessFieldGroup, boolean>,
): PostprocessMediaConfig {
  const merged: Record<string, unknown> = { ...current }
  for (const [field, group] of Object.entries(POSTPROCESS_FIELD_GROUP) as Array<
    [keyof PostprocessMediaConfig, PostprocessFieldGroup]
  >) {
    if (enabled[group]) merged[field] = incoming[field]
  }
  return merged as unknown as PostprocessMediaConfig
}

/** 结构体检：包能不能用。恢复前先过一遍，别拿半个包去覆盖用户的配置。 */
export function validateTreeConfigBundle(
  value: unknown,
): { ok: true; bundle: TreeConfigBundle } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') return { ok: false, reason: '配置包不是一个对象' }
  const bundle = value as Partial<TreeConfigBundle> & { version?: unknown }
  // 老包（v8 及更早）把版本挂在**顶层**、配置藏在 `manifest.treeConfig` 里。报错必须念出
  // **真实看到的那个数** —— 否则用户看到的是「版本不认识：undefined」，明明包里写着 8 却说不出是几，
  // 排查第一步就卡住（同 runbook 里那条「写失败文案必须与真因对齐」）。
  const rawVersion = bundle.format?.version ?? bundle.version
  if (rawVersion !== TREE_CONFIG_VERSION) {
    // 版本不认识就整包拒收，**不做猜测性解析** —— 拿半个包覆盖用户配置比不导入更糟。
    return {
      ok: false,
      reason:
        typeof rawVersion === 'number'
          ? `配置包版本不认识：v${rawVersion}（本机只认 v${TREE_CONFIG_VERSION}）`
          : `配置包缺少版本信息（本机只认 v${TREE_CONFIG_VERSION}）`,
    }
  }
  if (!Array.isArray(bundle.tree)) return { ok: false, reason: '配置包里没有树（tree）' }
  if (!bundle.defaults || typeof bundle.defaults !== 'object') {
    return { ok: false, reason: '配置包里没有全局默认层（defaults）' }
  }
  if (!Array.isArray(bundle.defaults.channels)) return { ok: false, reason: '配置包里没有渠道与尺寸字典' }
  if (!bundle.watermarkLibrary || typeof bundle.watermarkLibrary !== 'object') {
    return { ok: false, reason: '配置包里没有水印库配置（watermarkLibrary）' }
  }
  const library = bundle.watermarkLibrary
  return {
    ok: true,
    bundle: {
      ...(bundle as TreeConfigBundle),
      // 兜底字段必须补齐默认值：缺字段读成 undefined 会在下游各处炸出不同的错
      unassignedWatermarks: Array.isArray(bundle.unassignedWatermarks) ? bundle.unassignedWatermarks : [],
      format: {
        ...(bundle.format as TreeConfigFormat),
        skippedNodes: typeof bundle.format?.skippedNodes === 'number' ? bundle.format.skippedNodes : 0,
      },
      watermarkLibrary: {
        ...library,
        logos: Array.isArray(library.logos) ? library.logos : [],
        logoOrder: Array.isArray(library.logoOrder) ? library.logoOrder : [],
        libraryPath: typeof library.libraryPath === 'string' ? library.libraryPath : '',
      },
    },
  }
}
