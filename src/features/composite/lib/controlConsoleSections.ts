/**
 * 中控台的功能分区注册表（右区那排 tab）。
 *
 * ## 分工（杰哥 2026-09-21 定的）
 *
 * ```
 * 左：项目树                        右：一排 tab
 * 业务线 → 产品 → 方向              水印 / 渠道与输出
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
 * 可覆盖字段时才消费作用域** —— 给了作用域却什么都不变，比不给更糟。
 * `PostprocessNodeOverride` 现有 `outputDir` / `byMedia` / `watermarkPresetIds` /
 * `selectedMediaIds`（ADR-0013 加回）/ `enabled`，所以：
 * - 「渠道与输出」消费作用域（**2026-09-22 起**：「渠道与尺寸」并入「输出位置」后的分区 ——
 *   「参与产出」是方向级、导出位置跟着作用域走且留空可继承）；
 * - 「分发」作为小节并进「渠道与输出」，**只有排期（铺几天 / 跳过周末）消费作用域** ——
 *   2026-09-23 起（ADR-0017）。在那之前它连排期也不消费：那份「全局一套」是 2026-09-20 被
 *   `tsc` 报错拦出来的（类型里没这个字段），不是判断「方向级没用」。
 * 详见 `design-system/tangbao/pages/postprocess.md`。
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

export type ControlConsoleSectionId = 'watermark' | 'channel' | 'video'

export interface ControlConsoleSection {
  id: ControlConsoleSectionId
  label: string
  /** 一句话说明这一块管什么，显示在内容区标题下方 */
  description: string
}

/**
 * ⚠️ 曾经有一个 `globalOnly` 字段，用来在分区顶上挂一句「全局设置，所有方向共用」。
 * **2026-09-21 删除**：分区都是**混合**的 —— 「渠道与输出」（合并前那两个分区也一样）是
 * 「渠道名与尺寸规格全局 + 参与产出与导出位置跟作用域 + 命名 / 分发 / 产出预览全局」。
 * 一条**分区级**提示已经说不清，挂着只会连不该覆盖的那一半一起误导。
 * 改成每个小节在自己的标题里说清属于哪一层。**别再按分区级提示加回来。**
 */

/**
 * tab 顺序即右区显示顺序。**第一个是默认 tab**，也是历史行为唯一的入口，
 * 所以它必须是 `watermark` —— 否则老用户点进来会先看到一块空的地方。
 *
 * ⚠️ 分区合并账（每一步都有人踩过，别再往回拆）：
 * - 「分发」曾是与「输出位置」并列的第 4 个分区，2026-09-21 并入后者：两者本来就是同一件事的
 *   两半（一个管「目录 + 文件名」，一个管「按天怎么分」），各占一个 tab 只会让「产出放哪」
 *   要看两个地方。
 * - 「输出位置」2026-09-22 再并入「渠道与尺寸」（合起来叫**渠道与输出**）：两张表**大部分是
 *   同一份数据** —— 都是「一行一个渠道」（尺寸表 2026-09-21 起已是一行一个渠道，见
 *   `ConsoleMediaTables`）—— 所以合成一张表：渠道名 / 详细尺寸 / 参与产出 / 导出位置 在一行里，
 *   双写占两行。合成之后「这个渠道出到哪」一屏看全，不必两个 tab 对着看。
 */
export const CONTROL_CONSOLE_SECTIONS: ControlConsoleSection[] = [
  {
    id: 'watermark',
    label: '水印',
    description: '这个范围内用哪几套水印，以及水印库的建与改。',
  },
  {
    id: 'channel',
    label: '渠道与输出',
    description:
      '渠道名与尺寸规格是所有方向共用的一份；「参与产出」与导出位置跟着左侧作用域走——全局改基线，选某个方向就改它自己那份，目录留空则向上继承。',
  },
  {
    id: 'video',
    label: '视频',
    description:
      '把导出好的图片做成视频（独立引擎，本地渲染）。一行一个方向：全局行改基线，点某个方向的行只改它自己，留空向上继承。',
  },
]

/** 默认 tab。集中一处，测试与「重置回默认」都读它。 */
export const DEFAULT_CONTROL_CONSOLE_SECTION: ControlConsoleSectionId = CONTROL_CONSOLE_SECTIONS[0]!.id

/**
 * 已退役的分区 id → 现行分区 id。
 *
 * **必须有这张表**：分区 id 是持久化的（`useStore.controlConsoleSection`），
 * 老用户机器上就存着 `'distribution'` / `'output'` / `'media'` 三个历史值。让它们掉进
 * 「认不出」分支会把人弹回水印，等于把「我上次停在哪」这件事默默抹掉 —— 而它们都有明确的新家
 * （三个都指到「渠道与输出」：前两个是它先后吞掉的邻居，`media` 是它自己的前身）。
 * （同类的历史值还有更早的 `'directions'`，那个没有对应新家，所以照旧退回默认。）
 */
const RETIRED_SECTION_ALIASES: Record<string, ControlConsoleSectionId> = {
  distribution: 'channel',
  output: 'channel',
  media: 'channel',
}

/** 把任意字符串收敛成合法分区 id；认不出时退回默认分区，不抛错。 */
export function normalizeControlConsoleSection(value: unknown): ControlConsoleSectionId {
  if (typeof value === 'string' && value in RETIRED_SECTION_ALIASES) return RETIRED_SECTION_ALIASES[value]!
  const found = CONTROL_CONSOLE_SECTIONS.find((section) => section.id === value)
  return found ? found.id : DEFAULT_CONTROL_CONSOLE_SECTION
}
