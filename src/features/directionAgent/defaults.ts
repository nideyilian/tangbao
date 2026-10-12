/**
 * 方向 Agent 的出厂常量 —— TB-154。
 *
 * 本文件的**结构与内容全部照抄瀚灵「项目 Agent」的实测数据**（不是我的发挥）。
 * 逐项溯源见 `.workbuddy/reference/hanling/hanling-project-agent-blueprint.md`。
 *
 * 有一处是本仓补的、瀚灵没有，已在下面逐条标明：**池的中文名**。
 */

/** 六个变量词池的 key。**顺序与拼写照抄瀚灵常量**（原文 `ls` 数组）。 */
export const VARIABLE_POOL_KEYS = [
  'main_color_set',
  'decor_shape',
  'surface_material',
  'light_effect',
  'background_env',
  'typography_style',
] as const

export type VariablePoolKey = (typeof VARIABLE_POOL_KEYS)[number]

/**
 * 池的中文名，**仅界面显示用**。
 *
 * ⚠️ 这套中文名是**糖包自拟的** —— 瀚灵原始数据里只有 key 和候选词，
 * **没有中文名字段**（在其前端 bundle 里搜「主色」「装饰形状」「变量池」等词，命中 0）。
 * 加它是因为界面上总得让用户看懂哪个池是什么。觉得叫法不顺手，改这里即可，
 * **不影响已存的规则文本**（文本里引用的是 key）。
 */
export const VARIABLE_POOL_LABELS: Record<VariablePoolKey, string> = {
  main_color_set: '主色',
  decor_shape: '装饰形状',
  surface_material: '表面材质',
  light_effect: '光效',
  background_env: '背景环境',
  typography_style: '字体风格',
}

/** 三段式文本的三个章节标题。解析器靠它们切段，**一个字都不能改**（原文）。 */
export const RULE_SECTION_BASE = '【固定基底Prompt】'
export const RULE_SECTION_POOLS = '【变量词池】'
export const RULE_SECTION_NEGATIVE = '【反向Prompt】'

/**
 * 出厂默认的三段式规则文本。**逐字照抄瀚灵前端里的默认模板**（原文常量 `cs`）。
 *
 * ⚠️ 占位符是**单花括号** `{main_color_set}` —— 瀚灵就是这么写的，别改成双花括号。
 */
export const DEFAULT_RULE_TEXT = [
  RULE_SECTION_BASE,
  '分析参考图，保留风格、构图和主体层级，将表层内容替换为 {main_color_set}、{decor_shape}、{surface_material}、{light_effect}、{background_env}、{typography_style}；不要照抄具体物体、人物、品牌或固定色值。',
  '',
  RULE_SECTION_POOLS,
  '{main_color_set}: 冷色渐变,暖色渐变,低饱和中性色,高对比撞色,单色明暗层次,柔和粉彩',
  '{decor_shape}: 几何切片,流体曲线,圆角卡片,抽象光环,粒子点阵,折纸结构',
  '{surface_material}: 磨砂玻璃,拉丝金属,半透明亚克力,细腻纸张,柔软织物,陶瓷釉面',
  '{light_effect}: 柔和轮廓光,体积光束,局部高光,漫反射柔光,霓虹边缘光,自然窗光',
  '{background_env}: 极简棚拍空间,抽象渐变空间,现代室内,自然户外,未来科技场景,品牌展示台',
  '{typography_style}: 现代无衬线,紧凑粗体,优雅细体,几何标题字,编辑排版,留白信息排版',
  '',
  RULE_SECTION_NEGATIVE,
  '禁止原图复刻、具体人物或品牌照搬、低质量、低分辨率、模糊、乱码、重复构图和明显生成瑕疵。',
].join('\n')

/** 规则种类。瀚灵只有这两种（原文 `kind`）。 */
export type DirectionRuleKind = 'required' | 'forbidden'

/** 一条约束规则。字段对齐瀚灵 `rules[]`。 */
export interface DirectionRule {
  id: string
  kind: DirectionRuleKind
  text: string
  /** 冲突时用来裁定优先级，数值大的先满足（原文有 priority）。 */
  priority: number
  enabled: boolean
  source: 'builtin' | 'user' | 'ai'
}

/**
 * 出厂内置的 13 条规则。**逐条照抄瀚灵的实测数据**（6 条 required + 7 条 forbidden）。
 *
 * 后 7 条（forbidden）里前 6 条是合规红线，**每个 agent 一出生就带着**——
 * 这是瀚灵的做法，也是糖包 `RISK.md` 那套红线的同一个思路。
 */
export const BUILTIN_RULES: readonly DirectionRule[] = [
  {
    id: 'default-prompt-chinese',
    kind: 'required',
    text: '输出提示词必须以中文形式展示；除必要的品牌名、型号和行业专有名词外，不使用英文提示词。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'default-prompt-aspect-ratio',
    kind: 'required',
    text: '最终提示词必须明确包含当前选择的画面比例；选择9:16时写入9:16比例，选择16:9时写入16:9比例。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'default-quality',
    kind: 'required',
    text: '输出高质量、高分辨率、清晰锐利的画面，主体细节完整，避免噪点、压缩伪影和明显瑕疵。',
    priority: 90,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'default-anatomy',
    kind: 'required',
    text: '人物或物体结构自然准确，避免肢体、五官、文字和透视错误。',
    priority: 85,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'default-brand-safety',
    kind: 'required',
    text: '画面应符合用户任务、品牌和投放场景，不添加未经要求的文案、商标、价格或承诺。',
    priority: 85,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'default-composition',
    kind: 'required',
    text: '构图稳定，主体突出，视觉层级清楚，光影、色彩和材质协调。',
    priority: 80,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'redline-porn',
    kind: 'forbidden',
    text: '禁止色情、裸露、性暗示及其他不适宜内容。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'redline-politics',
    kind: 'forbidden',
    text: '禁止政治敏感内容、政治人物、国家领导人及相关肖像或影射。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'redline-celebrity',
    kind: 'forbidden',
    text: '禁止未经明确授权使用名人、明星、公众人物的姓名、肖像或高度相似形象。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'redline-military',
    kind: 'forbidden',
    text: '禁止军人、军装、军事组织、武器装备或军事行动等敏感军事内容。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'redline-landmark',
    kind: 'forbidden',
    text: '禁止敏感地标、政治象征和国家或政党标识，包括但不限于天安门、毛主席像、五角星、国旗、党旗等。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'redline-hate',
    kind: 'forbidden',
    text: '禁止仇恨、极端主义、违法犯罪及其他高风险内容。',
    priority: 100,
    enabled: true,
    source: 'builtin',
  },
  {
    id: 'default-low-quality',
    kind: 'forbidden',
    text: '禁止低质量、低分辨率、模糊、失焦、重影、过度噪点、水印和明显生成瑕疵。',
    priority: 95,
    enabled: true,
    source: 'builtin',
  },
]

/**
 * 反推 / 延展的硬校验门槛（数字取自瀚灵的报错文案，不是拍的）：
 * `反推规则的禁止出现不能为空。` / `反推规则的必须遵循中每个变量至少需要六个候选词。`
 */
export const MIN_POOL_OPTIONS = 6

/** 单个池的候选词上限。瀚灵多图合并时截前 50（原文 `.slice(0,50)`）。 */
export const MAX_POOL_OPTIONS = 50

/** 反推一次最多吃几张参考图（瀚灵文件夹反推的限制）。 */
export const MAX_REVERSE_IMAGES = 12

/** 反推的并发路数（原文 `Math.min(6, 图片数)`）。 */
export const REVERSE_CONCURRENCY = 6
