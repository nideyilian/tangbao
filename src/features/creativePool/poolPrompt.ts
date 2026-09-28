import type { CreativePoolKind } from './types'

/**
 * 池参考图在生图请求里的「角色指令」。
 *
 * 为什么必须有这段词，而不是只把图丢过去：
 * - 只喂像素会泄漏参考图的主体与构图 —— 官方的风格迁移示例同样是「图 + 明确只取风格的措辞」。
 * - gpt-image-2 取消了 `input_fidelity` 参数（旧模型可以调低保真度），输入图默认按高保真处理，
 *   不写清楚更容易被整幅复刻。
 *
 * 为什么**不要**发 AI 分析出来的「内容描述」：
 * - 与图冗余、是有损转述；更要命的是文字与图冲突时模型可能信文字 —— 那才是「偏离原图」的来源。
 *   所以池项里的 `points` 只用于展示，不进 prompt（见 `types.ts`）。
 */

export interface PoolPromptInput {
  /** 用户手动挂的内容参考图数量（排在请求数组最前） */
  contentCount: number
  /** 从池里选中的参考图数量（紧跟在内容图之后） */
  styleCount: number
}

/** 各池「只要什么」。新增池类型时在这里补一条。 */
const POOL_TAKE_RULES: Record<CreativePoolKind, string> = {
  style: '只提取其笔触、材质、光影与色彩关系',
  composition: '只提取其画面布局、主体位置与视觉重心',
  pattern: '只提取其纹样、图形语言与重复规律',
}

/** 各池「不要什么」。 */
const POOL_SKIP_RULES: Record<CreativePoolKind, string> = {
  style: '不要复制其主体、构图与元素',
  composition: '不要复制其具体内容、色彩与画风',
  pattern: '不要复制其具体内容、色彩与画风',
}

/** 各池在指令里的称呼（分析提示词也复用它，保证两处口径一致）。 */
export const POOL_LABELS: Record<CreativePoolKind, string> = {
  style: '风格参考',
  composition: '构图参考',
  pattern: '样式参考',
}

/** 非负整数归一（外部传进来的数量可能来自 UI state，防脏值）。 */
function toCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function rangeLabel(start: number, end: number): string {
  return start === end ? `图 ${start}` : `图 ${start}-${end}`
}

/**
 * 拼池参考图的角色指令；没有池图时返回空串（调用方据此跳过拼接）。
 *
 * 两个场景必须分开写 —— 差别不在措辞好不好看，而在**语义正确**：
 * - **有内容图**：内容图在第 1 位，池图在后，各自标明序号即可。
 * - **没有内容图**：池图会落在第 0 位，也就是 API 眼里「主图 / 被编辑的图」的位置
 *   （遮罩也只作用于第一张）⇒ 必须显式声明它**不是底图**，否则模型会把新主题
 *   画进参考图原有的构图里，而不是按文字重新构图。
 */
export function buildPoolReferenceRule(kind: CreativePoolKind, input: PoolPromptInput): string {
  const contentCount = toCount(input.contentCount)
  const styleCount = toCount(input.styleCount)
  if (styleCount === 0) return ''

  const label = POOL_LABELS[kind]
  const take = POOL_TAKE_RULES[kind]
  const skip = POOL_SKIP_RULES[kind]

  if (contentCount > 0) {
    const contentRange = rangeLabel(1, contentCount)
    const poolRange = rangeLabel(contentCount + 1, contentCount + styleCount)
    return `${contentRange} 是内容参考；${poolRange} 只作${label}，${take}，${skip}。`
  }

  const subject = styleCount === 1 ? '下面这张图' : `下面这 ${styleCount} 张图`
  return `${subject}不是要修改的底图，只作${label}：${take}，${skip}，请完全按文字描述重新构图。`
}

/** 角色指令 + 用户提示词（指令在前）。没有指令时**原样**返回用户提示词，不改变既有行为。 */
export function buildTaskPrompt(userPrompt: string, rule: string): string {
  if (!rule) return userPrompt
  const trimmed = userPrompt.trim()
  return trimmed ? `${rule}\n${trimmed}` : rule
}

/**
 * 请求里图片的排列顺序：**内容图在前、池图在后**。
 *
 * ⚠️ 这是契约不是偏好：API 把第一张当主图（被编辑的图），遮罩也只作用于第一张。
 * 顺序反了，模型会去「编辑」风格图。必须与 `buildPoolReferenceRule` 的序号口径一致。
 */
export function resolveReferenceImageOrder(contentIds: string[], poolImageIds: string[]): string[] {
  return [...contentIds, ...poolImageIds]
}
