/**
 * 中控台的功能分区注册表。
 *
 * 形态对齐「灵境 · 资产中心」：资产中心不把水印当成独立页面，而是产品资料下的一批
 * **配置维度**（渠道与尺寸 / 输出位置 / 水印 …）。糖包照这个口径把原先「整个 tab 就是水印」
 * 收成「水印是中控台里的一个功能」，与其它维度平级。
 *
 * ⚠️ 这里只声明「有哪些分区、怎么显示」，**分区内容不在这里**——内容各自引用既有组件，
 * 不新造第二套实现。原因见 `PresetProjectTree.tsx` 开头那条铁律：同一个参数有两个入口，
 * 迟早会出现「在 A 改了、在 B 看不到」。
 *
 * 因此本表的设计约束是：**每个分区必须指向一个「唯一作用域」的参数**。
 * - 全局共享规格（渠道与尺寸）→ 可以整体搬进来，因为它本来就只有一个家；
 * - 节点级/多层继承的参数（输出位置、水印归属）→ 只能用「全局基线 + 跳转改节点」的形态，
 *   不能在中控台里再造一套节点编辑。
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
    description: '全局共享规格：每个渠道产出哪些尺寸、体积上限多少。节点上只能勾选启用哪些渠道。',
  },
  {
    id: 'output',
    label: '输出位置',
    description: '按渠道指定导出目录（可双写）。留空 = 走默认输出位置；节点级覆盖请在项目树里改。',
  },
  {
    id: 'distribution',
    label: '分发',
    description: '按天把产出分散到日期目录，以及纯净版原图是否伴随产出。',
  },
]

/** 默认分区。集中一处，测试与「重置回默认」都读它。 */
export const DEFAULT_CONTROL_CONSOLE_SECTION: ControlConsoleSectionId = CONTROL_CONSOLE_SECTIONS[0]!.id

/** 把任意字符串收敛成合法分区 id；认不出时退回默认分区，不抛错。 */
export function normalizeControlConsoleSection(value: unknown): ControlConsoleSectionId {
  const found = CONTROL_CONSOLE_SECTIONS.find((section) => section.id === value)
  return found ? found.id : DEFAULT_CONTROL_CONSOLE_SECTION
}
