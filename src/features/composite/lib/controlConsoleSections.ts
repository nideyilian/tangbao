/**
 * 中控台的功能分区注册表。
 *
 * 形态对齐「灵境 · 策略中心」（junbo-cy.jetmobo.com/strategy/center，2026-09-20 登录实测）：
 * **左树 + 右内容**。左树是项目树（产品线 / 产品 / 方向，节点带计数徽章 + 搜索框 +
 * 「全局默认」总览项），右侧是当前作用域的分区工作区。顶部分区切换（水印 /
 * 渠道与尺寸 / 输出位置 / 分发）在右区工具栏上，树不在分区里 ——
 * 树决定「改谁」，分区决定「改什么」。
 *
 * ⚠️ 这里只声明「有哪些分区、怎么显示」，**分区内容不在这里**——内容各自引用既有组件，
 * 不新造第二套实现。
 *
 * 本表的设计约束（2026-09-20 修订）：**中控台是全部参数的统一编辑入口**。
 * 节点级覆盖与全局基线都在分区内改，作用域由左侧树驱动；不设
 * 「中控台只能改全局、节点级要去项目树」的断层。但分区**只在节点层真有
 * 可覆盖字段时才消费作用域** —— `PostprocessNodeOverride` 目前只有 `outputDir` /
 * `byMedia` / `watermarkPresetIds` / `enabled`，所以「渠道与尺寸」「分发」是纯全局分区。
 * 给了作用域却什么都不变，比不给更糟。详见 `design-system/tangbao/pages/postprocess.md`。
 */

import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'

/**
 * 作用域：`GLOBAL_NODE_ID`（全局基线）或某个 `AssetCollection.id`。
 * 由左侧作用域树驱动，工作区级共享 —— 切分区不重置。
 */
export type ConsoleScope = string

/** 当前作用域是否为全局基线。全工作区共用同一条判定，避免各处各写一遍哨兵比较。 */
export function isGlobalScope(scope: ConsoleScope): boolean {
  return scope === GLOBAL_NODE_ID
}

export type ControlConsoleSectionId = 'watermark' | 'media' | 'output' | 'distribution'

export interface ControlConsoleSection {
  id: ControlConsoleSectionId
  label: string
  /** 一句话说明这个分区管什么，显示在分区标题下方 */
  description: string
}

/**
 * 分区顺序即顶部分段控件的顺序。**第一个是默认分区**，也是历史行为唯一的入口，
 * 所以它必须是 `watermark`——否则老用户点进来会先看到一块空的地方。
 */
export const CONTROL_CONSOLE_SECTIONS: ControlConsoleSection[] = [
  {
    id: 'watermark',
    label: '水印',
    description: '归属树决定每个产品 / 方向用哪几套水印；水印库负责建与改。',
  },
  {
    id: 'media',
    label: '渠道与尺寸',
    description: '全局共享规格：每个渠道产出哪些尺寸、体积上限多少。勾选决定渠道是否参与产出。',
  },
  {
    id: 'output',
    label: '输出位置',
    description: '按渠道指定导出目录（可双写）。切换作用域可分别设置全局默认与单个节点。',
  },
  {
    id: 'distribution',
    label: '分发',
    description: '全局一套：按天把产出分散到日期目录，以及纯净版原图是否伴随产出。',
  },
]

/** 默认分区。集中一处，测试与「重置回默认」都读它。 */
export const DEFAULT_CONTROL_CONSOLE_SECTION: ControlConsoleSectionId = CONTROL_CONSOLE_SECTIONS[0]!.id

/** 把任意字符串收敛成合法分区 id；认不出时退回默认分区，不抛错。 */
export function normalizeControlConsoleSection(value: unknown): ControlConsoleSectionId {
  const found = CONTROL_CONSOLE_SECTIONS.find((section) => section.id === value)
  return found ? found.id : DEFAULT_CONTROL_CONSOLE_SECTION
}
