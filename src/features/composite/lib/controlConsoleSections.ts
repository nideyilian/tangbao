/**
 * 中控台的功能分区注册表。
 *
 * 形态对齐「灵境 · 资产中心」：资产中心不把水印当成独立页面，而是产品资料下的一批
 * **配置维度**（渠道与尺寸 / 输出位置 / 水印 …）。糖包照这个口径把原先「整个 tab 就是水印」
 * 收成「水印是中控台里的一个功能」，与其它维度平级。
 *
 * ⚠️ 这里只声明「有哪些分区、怎么显示」，**分区内容不在这里**——内容各自引用既有组件，
 * 不新造第二套实现。
 *
 * 本表的设计约束（2026-09-20 修订）：**中控台是全部参数的统一编辑入口**。
 * 节点级覆盖与全局基线都在分区内改，靠 `ConsoleScopePicker` 切换作用域；不设
 * 「中控台只能改全局、节点级要去项目树」的断层。但作用域选择器**只在节点层真有
 * 可覆盖字段时才挂** —— `PostprocessNodeOverride` 目前只有 `outputDir` / `byMedia` /
 * `watermarkPresetIds` / `enabled`，所以「渠道与尺寸」「分发」是纯全局分区。
 * 挂了却选不动，比不挂更糟。详见 `design-system/tangbao/pages/postprocess.md`。
 */

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
