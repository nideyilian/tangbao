/**
 * 后处理参数的**唯一元数据源**。
 *
 * 一个字段只在这里声明一次（标签、控件、默认值、校验、说明、适用作用域），
 * 左树与右侧详情面板都从这里读——不再有「面板里写死一段、弹窗里再写一段」的情况。
 *
 * 三件事因此收口：
 * 1. `DIRECTION_OPTIONS` / `DirectionValue` 原先在两个组件里逐字复制了两遍，现在只有 `DIRECTION_OPTIONS`；
 * 2. 面板渲染从「六个硬编码 section」变成「按 `scope` 过滤 + 按 `control` 分派」的循环；
 * 3. 校验（命名模板的未知/缺失/重复 token）与说明文案跟字段定义放在一起，改一处即全局生效。
 *
 * 作用域语义：
 * - `global`：只属于全局编排（媒体表本身、产出预览），节点上不出现；
 * - `node`：只属于树节点（是否参与、产出参数覆盖），全局默认节点上也出现；
 * - `both`：两层都能配，节点上改 = 写一条覆盖，全局上改 = 改基线。
 *
 * 「全局默认」节点在树里的 id 是 `GLOBAL_NODE_ID`（哨兵值，不是真实 `AssetCollection`）。
 */

import type { OutputDirection } from '../../lib/postprocessMedia'

/** 树根那个「全局默认」节点的 id。带前缀避免与真实 collection id 撞名。 */
export const GLOBAL_NODE_ID = '__postprocess_global__'

/** 分段控件里「跟随尺寸」需要一个显式取值，落到 store 时再换算回 `null`。 */
export type DirectionValue = 'auto' | OutputDirection

/** 画面方向选项。原先在 PostprocessSettingsModal 与 ProjectNodeParamsDialog 各写一遍。 */
export const DIRECTION_OPTIONS: Array<{ value: DirectionValue; label: string }> = [
  { value: 'auto', label: '跟随尺寸' },
  { value: 'landscape', label: '横版' },
  { value: 'portrait', label: '竖版' },
  { value: 'square', label: '方形' },
]

/** 校验结果：空数组 = 通过。`tone` 用于决定提示是警告还是错误。 */
export interface ParamIssue {
  message: string
  tone: 'warning' | 'error'
}

/**
 * 一个参数项的定义。
 *
 * `control` 是渲染分派键：右侧面板按它选控件，不在元数据表里放 JSX——
 * 放 JSX 会让这张表变成组件文件，测试也不好针对字段做断言。
 */
export interface PostprocessParamField {
  /** 覆盖切片里的键名；与 `PostprocessNodeOverride` 的可覆盖字段一一对应 */
  key: string
  label: string
  /** 一句话说明「这个字段管什么」 */
  help?: string
  /** 渲染分派键 */
  control:
    | 'enabled'
    | 'direction'
    | 'media'
    | 'namePattern'
    | 'creator'
    | 'outputDir'
    | 'autoCompanionClean'
    | 'distribution'
    | 'watermarkBinding'
    | 'mediaTable'
    | 'outputPreview'
  /** 适用作用域 */
  scope: 'global' | 'node' | 'both'
  /** 分组标题：同组字段在右栏归到一个 section 下 */
  group: 'participation' | 'produce' | 'output' | 'watermark' | 'advanced' | 'globalOnly'
  /**
   * 该字段是否支持「恢复继承」。全局默认节点上是根，没有可恢复的对象；
   * 产出预览、水印绑定、媒体表这类只读/别处编辑的项也不支持。
   */
  resettable: boolean
  /** 校验：返回问题列表，空 = 通过。只有能就地判断字段自身的才放这里。 */
  validate?: (value: unknown) => ParamIssue[]
}

/** 分组元数据：标题、说明、以及在有覆盖时是否显示「本级覆盖」摘要。 */
export const PARAM_GROUPS: Array<{ id: PostprocessParamField['group']; title: string; description?: string }> = [
  {
    id: 'participation',
    title: '参与方式',
    description: '关掉后，归属该节点的图片不再自动产出渠道变体（原图照常保存）。',
  },
  {
    id: 'produce',
    title: '产出规格',
    description: '决定每个媒体产出哪些尺寸、以及勾选哪些渠道。',
  },
  {
    id: 'output',
    title: '输出与命名',
    description: '留空 = 继承上级；没有上级时用全局默认输出位置。',
  },
  {
    id: 'watermark',
    title: '水印',
    description: '归属明细在这里只读展示；要改请到水印预设工作区的「水印归属」树。',
  },
  {
    id: 'advanced',
    title: '分发',
    description: '按天把产出分散到日期目录。',
  },
  {
    id: 'globalOnly',
    title: '全局编排',
    description: '这些只属于全局层：媒体表是共享规格，产出预览只反映全局基线的效果。',
  },
]

/**
 * 命名模板校验。
 *
 * 放在这里而不是组件里，是因为它与 `namePattern` 字段是同一件事的两半：
 * 字段定义改了（比如新增 token），校验范围必须跟着改，分开写迟早对不上。
 */
export function validateNamePattern(
  value: string,
  checks: {
    unknown: string[]
    missing: string[]
    duplicated: string[]
  },
): ParamIssue[] {
  const issues: ParamIssue[] = []
  if (checks.unknown.length > 0) {
    issues.push({ message: `模板里有不认识的占位符：${checks.unknown.map((t) => `{${t}}`).join('、')}`, tone: 'error' })
  }
  if (checks.missing.length > 0) {
    issues.push({
      message: `模板缺少占位符：${checks.missing.map((t) => `{${t}}`).join('、')}，同名文件会互相覆盖`,
      tone: 'error',
    })
  }
  if (checks.duplicated.length > 0) {
    issues.push({ message: `占位符重复出现：${checks.duplicated.map((t) => `{${t}}`).join('、')}`, tone: 'warning' })
  }
  return issues
}

/**
 * 全部参数项。**顺序即右栏渲染顺序**，组内按此排列。
 */
export const POSTPROCESS_PARAM_FIELDS: PostprocessParamField[] = [
  {
    key: 'enabled',
    label: '参与自动后处理',
    help: '关闭后，归属该节点的图片不再自动产出渠道变体（原图照常保存）。',
    control: 'enabled',
    scope: 'node',
    group: 'participation',
    resettable: true,
  },
  {
    key: 'selectedMediaIds',
    label: '媒体',
    help: '纯净版可单独勾选；勾了任一渠道且开启「纯净版自动伴随」时会自动补一份无水印原图。全局统一，不按方向分。',
    control: 'media',
    scope: 'global',
    group: 'produce',
    resettable: false,
  },
  {
    key: 'direction',
    label: '画面方向',
    help: '决定每个媒体产出哪些尺寸。跟随源图方向自动判定，不提供手选覆盖。',
    control: 'direction',
    scope: 'global',
    group: 'produce',
    resettable: false,
  },
  {
    key: 'namePattern',
    label: '命名模板',
    help: '产出文件名。全局统一一套。留空或缺少占位符会导致同名文件互相覆盖。',
    control: 'namePattern',
    scope: 'global',
    group: 'output',
    resettable: false,
  },
  {
    key: 'creator',
    label: '创作者',
    help: '供 `{creator}` 占位符取值。全局统一。',
    control: 'creator',
    scope: 'global',
    group: 'output',
    resettable: false,
  },
  {
    key: 'outputDir',
    label: '输出目录',
    help: '绝对路径。清空 = 恢复继承，而不是「用默认位置」这条显式声明。',
    control: 'outputDir',
    scope: 'both',
    group: 'output',
    resettable: true,
  },
  {
    key: 'autoCompanionClean',
    label: '纯净版自动伴随',
    help: '勾了任一渠道时，额外多产一份无水印原图。全局统一。',
    control: 'autoCompanionClean',
    scope: 'global',
    group: 'advanced',
    resettable: false,
  },
  {
    key: 'distribution',
    label: '分发',
    help: '按天把产出分散到日期目录。全局统一一套。',
    control: 'distribution',
    scope: 'global',
    group: 'advanced',
    resettable: false,
  },
  {
    key: 'watermarkPresetIds',
    label: '水印归属',
    help: '只读。归属只在水印预设工作区的「水印归属」树里改，避免两个入口打架。',
    control: 'watermarkBinding',
    scope: 'both',
    group: 'watermark',
    resettable: false,
  },
  {
    key: 'media',
    label: '媒体表',
    help: '渠道与尺寸规格。全局共享，节点上只能勾选启用哪些渠道，不能改规格。',
    control: 'mediaTable',
    scope: 'global',
    group: 'globalOnly',
    resettable: false,
  },
  {
    key: 'outputPlan',
    label: '产出预览',
    help: '按当前配置展开会产出哪些文件。随全局基线变化，不随单个节点变化。',
    control: 'outputPreview',
    scope: 'global',
    group: 'globalOnly',
    resettable: false,
  },
]

/** 按作用域取字段；`scope === 'node'` 表示当前是真实树节点，`'global'` 表示全局默认节点。 */
export function selectParamFields(scope: 'global' | 'node'): PostprocessParamField[] {
  return POSTPROCESS_PARAM_FIELDS.filter((field) => field.scope === 'both' || field.scope === scope)
}

/**
 * 取某分组下、某作用域内的字段。返回空数组的分组不渲染——
 * 这样全局节点上不会冒出一个空的「参与方式」section。
 */
export function selectParamFieldsByGroup(
  scope: 'global' | 'node',
): Array<{ group: (typeof PARAM_GROUPS)[number]; fields: PostprocessParamField[] }> {
  const fields = selectParamFields(scope)
  return PARAM_GROUPS.map((group) => ({ group, fields: fields.filter((field) => field.group === group.id) })).filter(
    (entry) => entry.fields.length > 0,
  )
}
