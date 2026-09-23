/**
 * 后处理失败项：错误码 + 描述 + 定位线索（纯逻辑，无副作用）。
 *
 * 存在的前提：后处理一次跑几十秒、要写盘、要压体积，失败原因散在渲染链 / 文件系统 / 分发三处，
 * 早先只回一句自由文本（`warnings`），用户拿到「输出子目录创建失败」根本无从下手 ——
 * 不知道哪个目录、为什么。这里把每条问题固定成 **码 + 描述 + 线索 + 上下文**，
 * 上下文（文件 / 源图 / 渠道 / 预设 / 目录）由调用点填，描述与线索只在这一份码表里维护。
 *
 * 与 `warnings: string[]` 的关系：**码表是唯一真相，`warnings` 由它派生**
 * （`formatPostprocessIssue`）。两处各写一份文案的话，界面按码查到的说法会与 toast 看到的不一致。
 */

/** 后处理阶段：进度与问题都挂在这一组枚举上，界面按它显示「现在在干什么」。 */
export type PostprocessStage = 'prepare' | 'render' | 'write' | 'distribute' | 'finish'

export const POSTPROCESS_STAGE_LABELS: Record<PostprocessStage, string> = {
  prepare: '准备',
  render: '渲染',
  write: '写盘',
  distribute: '分发',
  finish: '收尾',
}

/**
 * 问题严重度。
 *
 * - `skipped`：这条源图 / 位置没参与本次产出，但**不等于出错**（方向没启用、图已清理、
 *   分发被用户取消）—— 有产出时不该把它算成失败。
 * - `error`：真出错（目录写不了、渲染炸了、预设没了）。
 *
 * 分开的理由：以前全塞进 `warnings`，于是「跳过 3 张」和「3 个写盘失败」在界面上长得一样，
 * 用户没法判断要不要去修。
 */
export type PostprocessIssueSeverity = 'skipped' | 'error'

export type PostprocessIssueCode =
  /** 源图数据或尺寸不可用（已被清理、还没写完） */
  | 'PP-SRC-001'
  /** 非桌面环境：后处理要写盘，跑不了 */
  | 'PP-ENV-001'
  /** 所属方向未在启用范围内 */
  | 'PP-SCOPE-001'
  /** 所属方向关闭了自动后处理 */
  | 'PP-SCOPE-002'
  /** 找不到对应的项目目标（归属方向已删） */
  | 'PP-TARGET-001'
  /** 该方向已有一次后处理在跑/排队，本次跳过 */
  | 'PP-RUN-001'
  /** 勾选的渠道已被删除 */
  | 'PP-MEDIA-001'
  /** 引用的水印预设不存在 */
  | 'PP-PRESET-001'
  /** 导出位置全不可用（多半不在允许目录内） */
  | 'PP-DIR-001'
  /** 默认输出目录建不出来 */
  | 'PP-DIR-002'
  /** 部分导出位置不可用，其余照写 */
  | 'PP-DIR-003'
  /** 输出子目录创建失败 */
  | 'PP-DIR-004'
  /** 同名文件过多，分配不出文件名 */
  | 'PP-NAME-001'
  /** 图片写入失败 */
  | 'PP-WRITE-001'
  /** 渲染抛异常 */
  | 'PP-RENDER-001'
  /** 压不到目标体积 */
  | 'PP-RENDER-002'
  /** 分发失败 */
  | 'PP-DIST-001'
  /** 分发被取消 */
  | 'PP-DIST-002'
  /** 分发抛异常 */
  | 'PP-DIST-003'
  /** 整批跑完没有任何产出 */
  | 'PP-EMPTY-001'
  /** 执行体整体抛异常（兜底；真因在 cause 里） */
  | 'PP-CRASH-001'
  /** 用户主动取消了这次产出 */
  | 'PP-CANCEL-001'

/**
 * 「本次产出被用户取消」的码。
 *
 * 单独提成常量而不是就地写字面量：**三处**都要认它 —— `resolvePostprocessRunStatus` 据此把状态
 * 判成「已取消」（而不是「失败」）、`writeVariant` 据此不把它记成渲染失败、界面据此给它一个
 * 中性色调。三处各写一遍字符串，改码名时必然漏一处，而漏掉的表现是「点了取消却显示失败」。
 */
export const POSTPROCESS_CANCEL_CODE: PostprocessIssueCode = 'PP-CANCEL-001'

interface IssueTemplate {
  message: string
  hint: string
  severity: PostprocessIssueSeverity
}

/**
 * 码表。
 *
 * `hint` 是**给用户照着做**的一步，不是复述现象 —— 尤其 `PP-DIR-001`：
 * 原来的文案是「请检查路径是否可达」，而真因通常是「目录不在应用允许的位置内」
 * （主进程的 `assertAllowedPath`，手输的其它盘符照样被拒）。照原话来查永远查不到，
 * 线索必须指向真因。
 */
const ISSUE_TEMPLATES: Record<PostprocessIssueCode, IssueTemplate> = {
  'PP-SRC-001': {
    message: '源图数据或尺寸不可用，已跳过',
    hint: '这张图可能已被清理或还没写完。在素材库里确认它还能打开，或重新生成后再跑一次。',
    severity: 'skipped',
  },
  'PP-ENV-001': {
    message: '后处理已跳过：非桌面环境',
    hint: '后处理要写文件，只能在桌面客户端里跑。',
    severity: 'skipped',
  },
  'PP-SCOPE-001': {
    message: '所属方向未启用后处理',
    hint: '这个方向还没参与自动后处理。要长期产出，去项目树的「后处理」列勾选该方向（或它的上级）；只想产这一次，就选中素材手动跑一次（手动不受启用范围限制）。',
    severity: 'skipped',
  },
  'PP-SCOPE-002': {
    message: '所属方向关闭了自动后处理',
    hint: '这个方向关掉了「自动后处理」，所以不自动产出变体。要恢复就在该方向节点上重新打开；只想跑这一次，选中素材点「跑后处理」即可（手动跑不受这个开关限制）。',
    severity: 'skipped',
  },
  'PP-RUN-001': {
    message: '该方向正在运行后处理，本次已跳过',
    // 后处理改成按方向独立运行后，同一方向仍然只允许一条（两条会争同一批输出目录与文件名序号）。
    // 所以这里要**说清去哪看它**，否则用户只知道「没跑」，不知道该等什么。
    hint: '同一方向同时只跑一条。进度在素材库工具栏的「后处理」入口里（点开有完整面板）；不想等就换别的方向先跑，方向之间互不阻塞。',
    severity: 'skipped',
  },
  'PP-TARGET-001': {
    message: '找不到对应的项目目标',
    hint: '图片归属的方向可能已被删除。重新把这张图归档到一个方向，再跑一次。',
    severity: 'skipped',
  },
  'PP-MEDIA-001': {
    message: '勾选的渠道已被删除',
    hint: '在中控台「渠道与尺寸」里确认渠道还在，或重新勾选要产出的渠道。',
    severity: 'skipped',
  },
  'PP-PRESET-001': {
    message: '引用的水印预设不存在',
    hint: '这套水印已被删除。在中控台「水印」分区里给这个范围重新选一套，或把水印归到当前产品。',
    severity: 'error',
  },
  'PP-DIR-001': {
    message: '导出位置不可用，这批产出已跳过',
    hint: '导出位置要在应用允许的范围里：桌面 / 文档 / 下载 / 图片 / 应用数据，或用「选择目录」对话框选过它。手输的其它盘符（如 D:\\）会被拒绝。',
    severity: 'error',
  },
  'PP-DIR-002': {
    message: '默认输出目录无法创建',
    hint: '确认本地保存目录还在（设置里可改），以及磁盘没满。',
    severity: 'error',
  },
  'PP-DIR-003': {
    message: '部分导出位置不可用，已跳过',
    hint: '不可用的位置按上面的规则检查；其余位置照常写出，产物是完整的。',
    severity: 'error',
  },
  'PP-DIR-004': {
    message: '输出子目录创建失败',
    hint: '检查该目录是否只读、是否被别的程序占用（同名文件正被打开也会失败），或磁盘是否已满。',
    severity: 'error',
  },
  'PP-NAME-001': {
    message: '同名文件过多，无法分配文件名',
    hint: '目标目录下同名候选已到 999 个。清一次旧产出，或在命名模板里加 {seq} / {date}。',
    severity: 'error',
  },
  'PP-WRITE-001': {
    message: '图片写入失败',
    hint: '磁盘可能已满，或文件被别的程序占用。确认后重跑这一张。',
    severity: 'error',
  },
  'PP-RENDER-001': {
    message: '渲染失败',
    hint: '多半是这套水印里的图片 / LOGO 素材失效了。在中控台「水印」分区里打开这套水印核对图层。',
    severity: 'error',
  },
  'PP-RENDER-002': {
    message: '压缩后仍超过体积上限',
    hint: '这个尺寸压不到目标体积。把该尺寸的体积上限调大，或改用更大的尺寸。',
    severity: 'error',
  },
  'PP-DIST-001': {
    message: '分发失败',
    hint: '按天排期的目标目录不可用。确认分发目录可达后重跑分发。',
    severity: 'error',
  },
  'PP-DIST-002': {
    message: '分发已取消，部分产出未排期',
    hint: '未排期的文件还在原目录下，需要的话重新分发一次。',
    severity: 'skipped',
  },
  'PP-DIST-003': {
    message: '分发异常',
    hint: '分发过程中抛了异常。查看下方线索里的原始错误，必要时重跑分发。',
    severity: 'error',
  },
  'PP-EMPTY-001': {
    message: '没有产出任何文件',
    hint: '按顺序检查三处：项目树里「启用范围」勾了哪些方向、「渠道与尺寸」勾了哪些渠道、图片是否已归档到方向。',
    severity: 'error',
  },
  'PP-CRASH-001': {
    message: '后处理过程中出现未预期的错误，这一批没有跑完',
    hint: '看下面的原始错误定位；重跑一次通常能排除偶发的读图 / 写盘失败，反复出现再查该环节。',
    severity: 'error',
  },
  'PP-CANCEL-001': {
    message: '已取消，本次产出提前结束',
    // severity 必须是 skipped：它是「用户主动停的」，不是故障。写成 error 会让自动触发的
    // 播报逻辑把取消当失败报出来，也会让「有产出」的记录被算成「部分完成」。
    hint: '已经写出的文件都留在原处，不会删除。要接着产出剩下的，重新跑一次即可（同一张图不会重复产出）。',
    severity: 'skipped',
  },
}

export interface PostprocessIssue {
  code: PostprocessIssueCode
  message: string
  hint: string
  severity: PostprocessIssueSeverity
  stage: PostprocessStage
  /** 产出文件名（含扩展名），写盘 / 渲染阶段的定位线索 */
  file?: string
  /** 源图 id 与它在本次批次里的下标 */
  sourceImageId?: string
  sourceIndex?: number
  /** 渠道（`PURE_MEDIA_ID` 表示纯净版） */
  mediaId?: string
  mediaName?: string
  /** 涉及的目录（导出位置 / 子目录 / 分发目标） */
  dir?: string
  /** 涉及的预设 id */
  presetId?: string
  /** 补充说明（数量等），拼在描述后面 */
  detail?: string
  /** 原始异常 / 底层库给的话，真因往往在这里 */
  cause?: string
}

export type PostprocessIssueInput = Pick<PostprocessIssue, 'code' | 'stage'> &
  Partial<Omit<PostprocessIssue, 'code' | 'stage' | 'message' | 'hint' | 'severity'>>

/** 按码构造一条问题项：描述、线索、严重度都从码表取，调用点只负责填上下文。 */
export function createPostprocessIssue(input: PostprocessIssueInput): PostprocessIssue {
  const template = ISSUE_TEMPLATES[input.code]
  return {
    ...input,
    message: template.message,
    hint: template.hint,
    severity: template.severity,
  }
}

/** 某个码的描述与线索（界面按码显示时用，避免各处再抄一遍文案）。 */
export function describePostprocessIssueCode(code: PostprocessIssueCode): IssueTemplate {
  return ISSUE_TEMPLATES[code]
}

/**
 * 单行文本（`warnings` 与 toast 用）。
 *
 * 形如 `xxx.jpg：[PP-DIR-004] 输出子目录创建失败`：**码放前面**，因为 error 型 toast
 * 超过 80 字会被截成通用文案，尾巴上的码最先丢，而码正是排查的起点。
 */
export function formatPostprocessIssue(issue: PostprocessIssue): string {
  const head = issue.file ? `${issue.file}：` : ''
  const detail = issue.detail ? `（${issue.detail}）` : ''
  return `${head}[${issue.code}] ${issue.message}${detail}`
}

/**
 * 详情多行文本：描述 + 上下文 + 线索（「查看问题」里逐条展示，一行一条）。
 *
 * 上下文按「文件 / 源图 / 渠道 / 目录 / 预设 / 原始错误」的固定顺序取，
 * 顺序固定是为了让同类问题在列表里行行对齐，扫一眼就能对比。
 */
export function describePostprocessIssueDetail(issue: PostprocessIssue): string {
  const segments: string[] = []
  if (issue.file) segments.push(`文件 ${issue.file}`)
  if (issue.sourceImageId)
    segments.push(
      `源图 ${issue.sourceImageId}${issue.sourceIndex === undefined ? '' : `（第 ${issue.sourceIndex + 1} 张）`}`,
    )
  if (issue.mediaName) segments.push(`渠道 ${issue.mediaName}`)
  else if (issue.mediaId) segments.push(`渠道 ${issue.mediaId}`)
  if (issue.dir) segments.push(`目录 ${issue.dir}`)
  if (issue.presetId) segments.push(`水印 ${issue.presetId}`)
  if (issue.cause) segments.push(`原始错误 ${issue.cause}`)
  if (issue.detail) segments.push(issue.detail)
  return [`[${issue.code}] ${issue.message}`, segments.join(' · '), `线索：${issue.hint}`]
    .filter((line) => line !== '')
    .join('\n')
}

/** 是否算「真出错」（决定整批是 partial 还是 succeeded）。 */
export function isErrorIssue(issue: PostprocessIssue): boolean {
  return issue.severity === 'error'
}

/** 全部问题的详情文本，供「查看问题」弹窗直接显示。 */
export function formatPostprocessIssueList(issues: PostprocessIssue[]): string {
  return issues.map((issue) => describePostprocessIssueDetail(issue)).join('\n\n')
}

/**
 * `issues` → `warnings` 的唯一转换点。
 *
 * 执行体与 store 的兜底路径都走这里：各写一遍 `map(formatPostprocessIssue)` 的话，
 * 迟早有一处忘了加码前缀，而错误码恰恰是排查的起点。
 */
export function issuesToWarnings(issues: PostprocessIssue[]): string[] {
  return issues.map(formatPostprocessIssue)
}
