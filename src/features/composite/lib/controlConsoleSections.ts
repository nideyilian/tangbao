/**
 * 中控台的功能分区注册表（右区那排 tab）。
 *
 * ## 分工（杰哥 2026-09-21 定的）
 *
 * ```
 * 左：项目树                        右：一排 tab
 * 业务线 → 产品 → 方向              水印 / 输出位置 / 渠道与尺寸 / 分发
 * 管「改谁」，可增删改查             管「改什么」，跟着树选中哪一层走
 * ```
 *
 * **树是全局的**：它管的是整个框架（业务线 / 产品 / 方向的层级），所以
 * 增删改查都在树上做，一处改动画廊侧栏与项目树自动跟上（同一份
 * `useAssetLibraryStore.collections`）。tab 只是「这个节点上有哪些参数可改」。
 *
 * ⚠️ 前身教训（2026-09-21 上午）：试过把维度挂到树上当一级（维度 → 作用域两级树），
 * 结果是**同一个维度各挂一棵作用域树**——水印组一棵、输出位置组一棵，展开两个组就是
 * 两棵一模一样的方向树。维度和作用域是两个控件维度，套成一层嵌套必然会复制数据。
 *
 * ⚠️ 状态模型：仍然是 `section`（应用 store，外部跳转要指定落点）+ `scope`
 * （全局上下文指针）。改的只是「这两个状态由哪两处控件驱动」。
 *
 * ⚠️ 这里只声明「有哪些分区、怎么显示」，**分区内容不在这里**——内容各自引用既有组件，
 * 不新造第二套实现。
 *
 * 本表的设计约束（2026-09-20 修订）：**中控台是全部参数的统一编辑入口**。
 * 节点级覆盖与全局基线都在分区内改，作用域由左侧树驱动；不设
 * 「中控台只能改全局、节点级要去项目树」的断层。但分区**只在节点层真有
 * 可覆盖字段时才消费作用域** —— `PostprocessNodeOverride` 目前只有 `outputDir` /
 * `byMedia` / `watermarkPresetIds` / `enabled`，所以「渠道与尺寸」「分发」是全局一套。
 * 给了作用域却什么都不变，比不给更糟。详见 `design-system/tangbao/pages/postprocess.md`。
 */

import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'

/**
 * 作用域：`GLOBAL_NODE_ID`（全局基线）或某个 `AssetCollection.id`。
 * 由左侧项目树驱动，工作区级共享 —— 切 tab 不重置。
 */
export type ConsoleScope = string

/** 当前作用域是否为全局基线。全工作区共用同一条判定，避免各处各写一遍哨兵比较。 */
export function isGlobalScope(scope: ConsoleScope): boolean {
  return scope === GLOBAL_NODE_ID
}

export type ControlConsoleSectionId = 'watermark' | 'output' | 'media' | 'distribution'

export interface ControlConsoleSection {
  id: ControlConsoleSectionId
  label: string
  /** 一句话说明这一块管什么，显示在内容区标题下方 */
  description: string
  /**
   * 这一块是不是**全局唯一**的（选哪个节点看到的都是同一套，节点上不存在它的覆盖字段）。
   *
   * 用途：内容顶部据此加一行「全局设置，所有方向共用」，免得用户以为
   * 「我选了某个方向、在这儿改的就是这个方向」。**不隐藏、不置灰** —— 藏起来会让人
   * 切来切去找不着，而它确实是要改的东西，只是不分方向。
   */
  globalOnly: boolean
}

/**
 * tab 顺序即右区显示顺序。**第一个是默认 tab**，也是历史行为唯一的入口，
 * 所以它必须是 `watermark` —— 否则老用户点进来会先看到一块空的地方。
 */
export const CONTROL_CONSOLE_SECTIONS: ControlConsoleSection[] = [
  {
    id: 'watermark',
    label: '水印',
    description: '这个范围内用哪几套水印，以及水印库的建与改。',
    globalOnly: false,
  },
  {
    id: 'output',
    label: '输出位置',
    description: '这个范围的导出目录（按渠道，可双写）与产出文件命名，以及产出预览。',
    globalOnly: false,
  },
  {
    id: 'media',
    label: '渠道与尺寸',
    description: '全局共享规格：每个渠道产出哪些尺寸、体积上限多少。勾选决定渠道是否参与产出。',
    globalOnly: true,
  },
  {
    id: 'distribution',
    label: '分发',
    description: '全局一套：按天把产出分散到日期目录，以及纯净版原图是否伴随产出。',
    globalOnly: true,
  },
]

/** 默认 tab。集中一处，测试与「重置回默认」都读它。 */
export const DEFAULT_CONTROL_CONSOLE_SECTION: ControlConsoleSectionId = CONTROL_CONSOLE_SECTIONS[0]!.id

/** 把任意字符串收敛成合法分区 id；认不出时退回默认分区，不抛错。 */
export function normalizeControlConsoleSection(value: unknown): ControlConsoleSectionId {
  const found = CONTROL_CONSOLE_SECTIONS.find((section) => section.id === value)
  return found ? found.id : DEFAULT_CONTROL_CONSOLE_SECTION
}
