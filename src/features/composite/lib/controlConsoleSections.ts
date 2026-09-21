/**
 * 中控台的功能分区注册表。
 *
 * 形态对齐「灵境 · 策略中心」（junbo-cy.jetmobo.com/strategy/center，2026-09-20 登录实测）：
 * **左树 + 右内容**。
 *
 * **2026-09-21 交互改版（杰哥要求）**：配置维度**改由左侧树承载**，不再在右区工具栏里
 * 用一个下拉「切页面」。左树变成两级：
 *
 * ```
 * ▾ 水印                    ← 一级 = 配置维度（维度组）
 *     全局默认              ← 二级 = 作用域
 *     ▾ 智能客服 / 机器人 / 竖版展示
 * ▸ 输出位置
 * ▸ 渠道与尺寸              ← scopeAware=false：下面只有「全局一套」，不铺方向树
 * ```
 *
 * 为什么这么改：维度与作用域本是同一个问题的两半（「改什么」×「改谁」），拆成
 * 「工具栏下拉 + 左树」两处控件后，定一个落点要动两个地方；而且**「哪些维度能按方向配」
 * 这个约束在界面上完全看不出来**。合到一棵树里之后点一次就到，且约束由结构表达 ——
 * 不铺方向树的维度，用户一眼就知道它不按方向分。
 *
 * ⚠️ 状态模型**没变**：仍然是 `section`（应用 store，外部跳转要指定落点）+ `scope`
 * （全局上下文指针）。改的只是「这两个状态由哪两处控件驱动」。
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
 *
 * **2026-09-21 表格化（TB-060）新增「方向」分区**：方向（`AssetCollection` 树）是数据本体的骨架，
 * 但它原先只能通过左树导航与「新建方向」按钮间接管理 —— 改名、改归属、删层级，以及每个方向的
 * 参与方式与输出目录，都没有一个集中的编辑入口。这一区把「方向结构」与「方向级参数」两张表
 * 摆在一起，补上的正是上面那条「不设断层」的约束。
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

export type ControlConsoleSectionId = 'watermark' | 'directions' | 'media' | 'output' | 'distribution'

export interface ControlConsoleSection {
  id: ControlConsoleSectionId
  label: string
  /** 一句话说明这个分区管什么，显示在分区标题下方 */
  description: string
  /**
   * 这个维度是否**按方向分**（消费作用域）。
   *
   * 左树用它决定「这个维度下面要不要铺开整棵方向树」：只有水印与输出位置存在节点级
   * 可覆盖字段（`PostprocessNodeOverride`）；渠道与尺寸 / 分发 / 方向结构是全局一套，
   * 铺开方向只会让人以为能按方向配。
   * **让结构本身表达约束**，比在界面里补一句「本维度不支持按方向配置」有效得多。
   */
  scopeAware: boolean
}

/**
 * 分区顺序即左树的维度顺序。**第一个是默认维度**，也是历史行为唯一的入口，
 * 所以它必须是 `watermark` —— 否则老用户点进来会先看到一块空的地方。
 */
export const CONTROL_CONSOLE_SECTIONS: ControlConsoleSection[] = [
  {
    id: 'watermark',
    label: '水印',
    description: '归属树决定每个产品 / 方向用哪几套水印；水印库负责建与改。',
    scopeAware: true,
  },
  {
    id: 'media',
    label: '渠道与尺寸',
    description: '全局共享规格：每个渠道产出哪些尺寸、体积上限多少。勾选决定渠道是否参与产出。',
    scopeAware: false,
  },
  {
    id: 'output',
    label: '输出位置',
    description: '按渠道指定导出目录（可双写）、产出文件命名模板，以及这个作用域的产出预览。',
    scopeAware: true,
  },
  {
    id: 'distribution',
    label: '分发',
    description: '全局一套：按天把产出分散到日期目录，以及纯净版原图是否伴随产出。',
    scopeAware: false,
  },
  {
    id: 'directions',
    label: '方向',
    description: '产品线 / 产品 / 方向的层级与归属，以及每个方向参不参与产出、产出到哪。',
    scopeAware: false,
  },
]

/** 默认分区。集中一处，测试与「重置回默认」都读它。 */
export const DEFAULT_CONTROL_CONSOLE_SECTION: ControlConsoleSectionId = CONTROL_CONSOLE_SECTIONS[0]!.id

/** 把任意字符串收敛成合法分区 id；认不出时退回默认分区，不抛错。 */
export function normalizeControlConsoleSection(value: unknown): ControlConsoleSectionId {
  const found = CONTROL_CONSOLE_SECTIONS.find((section) => section.id === value)
  return found ? found.id : DEFAULT_CONTROL_CONSOLE_SECTION
}
