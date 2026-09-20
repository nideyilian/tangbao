/**
 * 后处理**方向级参数**的**唯一元数据源**。
 *
 * 一个字段只在这里声明一次（标签、控件、说明、是否可恢复继承）。参数面板按 `control`
 * 分派渲染 —— 加一个字段 = 在表里加一项，组件不用改，也不会出现「面板里写死一段、
 * 别处再写一段」。
 *
 * ## 为什么这里只剩方向级（2026-09-20 定案）
 *
 * 「中控台是所有参数的统一编辑入口」是既定的定位（见
 * `design-system/tangbao/pages/postprocess.md`）：全局基线与节点级覆盖都在中控台的分区里改，
 * 作用域由左栏配置资产库树驱动。本表因此只负责**一件事**：某个方向怎么产出 ——
 * 是否参与、产出到哪、叠什么水印。
 *
 * 全局层独有的参数（渠道与尺寸、画面方向、命名模板、创作者、分发、产出预览）
 * **不在本表里**，它们在中控台各自的分区有唯一入口。历史上它们在这里也有一份，
 * 结果是同一个参数两个入口：一处改了、另一处显示不一致（也造成过界面上同一句说明出现两遍）。
 *
 * 「全局默认」那个作用域哨兵仍然从这个文件导出 —— 中控台的资产树与分区注册表都读它，
 * 哨兵值只该有一个定义。
 */

/**
 * 作用域树里「全局默认」节点的 id。带前缀避免与真实 collection id 撞名。
 *
 * ⚠️ 本表只描述方向级参数，所以参数面板不会再收到这个值；它服务于中控台的作用域树。
 */
export const GLOBAL_NODE_ID = '__postprocess_global__'

/**
 * 一个方向级参数项的定义。
 *
 * `control` 是渲染分派键：面板按它选控件，不在元数据表里放 JSX——
 * 放 JSX 会让这张表变成组件文件，测试也不好针对字段做断言。
 */
export interface PostprocessParamField {
  /** 覆盖切片里的键名；与 `PostprocessNodeOverride` 的可覆盖字段一一对应 */
  key: string
  label: string
  /** 一句话说明「这个字段管什么」。**同一句说明只写在字段上**，组说明里不重复。 */
  help?: string
  /** 渲染分派键 */
  control: 'enabled' | 'outputDir' | 'watermarkBinding'
  /** 分组：决定字段落在哪张卡片里 */
  group: 'participation' | 'output' | 'watermark'
  /**
   * 该字段是否支持「恢复继承」。水印归属、产出预览这类只读或别处编辑的项不支持 ——
   * 给它一个「恢复继承」按钮只会让人以为这里能改。
   */
  resettable: boolean
}

/**
 * 分组元数据：标题，以及**仅在该组有真正的组级信息时**才给的说明。
 *
 * ⚠️ 不要在这里重复组内字段的说明。历史上「参与方式」「分发」「水印」等组的 description
 * 与组内唯一字段的 help 逐字或同义重复，界面上同一句话出现两遍。组内字段的说明一律写在
 * 字段的 `help` 上；组只有在自己表达了「这组是干什么的、字段之间如何配合」这类
 * 字段级说明覆盖不到的信息时才写 description。
 *
 * **数组顺序即面板里的卡片顺序**，按用户的实际操作顺序排：
 * 先决定这个方向参不参与 → 再决定产出放哪 → 最后决定叠什么水印。
 */
export const PARAM_GROUPS: Array<{ id: PostprocessParamField['group']; title: string; description?: string }> = [
  { id: 'participation', title: '参与方式' },
  { id: 'output', title: '输出位置' },
  { id: 'watermark', title: '水印' },
]

/** 全部方向级参数项。**顺序即组内渲染顺序**。 */
export const POSTPROCESS_PARAM_FIELDS: PostprocessParamField[] = [
  {
    key: 'enabled',
    label: '自动后处理',
    // 短句。标签已经说了「自动后处理」，说明只补用户猜不到的那半句：关了就没变体。
    help: '关闭后不产出变体，原图照常保存。',
    control: 'enabled',
    group: 'participation',
    resettable: true,
  },
  {
    key: 'outputDir',
    label: '输出目录',
    help: '留空则向上继承。',
    control: 'outputDir',
    group: 'output',
    resettable: true,
  },
  {
    key: 'watermarkPresetIds',
    label: '水印归属',
    // 跳转入口就在分组头（「去中控台配水印」），这里只说明「这里不能改」
    help: '只读。',
    control: 'watermarkBinding',
    group: 'watermark',
    resettable: false,
  },
]

/** 取全部方向级字段（本表只有方向级，保留函数是为了让调用方不依赖数组本身）。 */
export function selectParamFields(): PostprocessParamField[] {
  return POSTPROCESS_PARAM_FIELDS
}

/**
 * 按分组取字段。返回空数组的分组不渲染 ——
 * 这样加/删字段时不会冒出一个只有标题的空卡片。
 */
export function selectParamFieldsByGroup(): Array<{
  group: (typeof PARAM_GROUPS)[number]
  fields: PostprocessParamField[]
}> {
  return PARAM_GROUPS.map((group) => ({
    group,
    fields: POSTPROCESS_PARAM_FIELDS.filter((field) => field.group === group.id),
  })).filter((entry) => entry.fields.length > 0)
}
