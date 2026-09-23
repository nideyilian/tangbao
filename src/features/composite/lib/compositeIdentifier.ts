/**
 * 水印标识符的附加规则（纯函数，无副作用，便于单测）。
 *
 * 两条规则：
 * 1. **预设里有能出字的文字层** → 按位置把标识符贴到文案上（开头 / 结尾 / 两侧）。
 *    ⚠️ 这是**逐层**的：多文案水印默认每段都贴，除非那一层 `withIdentifier: false`
 *    （2026-09-22 加 —— 多文案水印里「卖点」这种文案不该带标识）。
 *    竖排文案（一个字一行）另有一条例外：标识符**自己占一行**，不跟首字并排，见 `applyIdentifierToText`。
 * 2. 「这一层贴不贴」由 `layerWantsIdentifier` **一处**判定 —— 图层界面的勾选框与渲染器
 *    读的是同一份判据，不各写一次。
 *
 * ## ⛔ 刻意不做：给「没有文字的水印」补一个署名图层（2026-09-23 按 TB-018 口径收回）
 *
 * 曾经有第三条规则：预设里一个能出字的文字层都没有时，在**左下角造一个独立文字层**只写标识符
 * （来自 TB-041 验收标准 3）。它本意是服务「只有图标的水印」，实际却把**两类完全不同的东西**
 * 归到了同一个判据下 ——
 *
 * - 「这个预设**就是没有水印**」（后处理没绑预设、纯净版）→ 应该什么都不画；
 * - 「这个预设**有图但没有文字层**」（纯图标水印）→ TB-018 要的正是「无文案 = 纯图标」。
 *
 * 两者都命中「没有可出字的文字层」，于是**没绑水印的产出也会被补一个署名**。
 * 它之所以一直没暴露，是因为后处理那条路用的空预设基准画布是 **1×1**
 * （`taskPostprocess.ts` 的 `PLAIN_PRESET`）：字号按比例算出来 8px，再按
 * `min(target/base)` 放大 **720 倍** ⇒ 图层框算到画布**上方之外**，整段文字落在画布外不可见。
 * **那是几何巧合，不是设计** —— 基准画布一旦换成真实尺寸，每张干净的图（含纯净版）
 * 都会被糊上一行巨大文字。
 *
 * ⇒ 「无文案水印」的语义由 TB-018 定：**没有文字就是没有文字，不补署名**。
 *   要署名就把它写进预设自己的文字层里。**别把兜底层加回来** —— 加回来等于又把
 *   「没有水印」和「只有图标的水印」混成一件事。
 *
 * 标识符本身仍然**不写回预设**：它是渲染时叠加的派生值。写回就得在导出/复制/撤销时反复处理
 * 「这段到底是不是用户自己写的」，还会让「改一次标识符」变成改 N 个预设的批量写盘；
 * 叠加则天然满足「设置后对所有相关水印即时生效」。
 *
 * ⚠️ 叠加层的代价：overlay 缓存键必须纳入标识符签名，否则改了标识符但 `preset.updatedAt`
 * 没变，预览会继续用旧帧（见 `compositeRendererV2.getCompositeOverlayCacheKey`）。
 */

import { type CompositeV2IdentifierConfig, type CompositeV2IdentifierPlacement } from './compositeV2Types'

export const IDENTIFIER_PLACEMENTS: CompositeV2IdentifierPlacement[] = ['prefix', 'suffix', 'both']

export const IDENTIFIER_PLACEMENT_LABELS: Record<CompositeV2IdentifierPlacement, string> = {
  prefix: '开头',
  suffix: '结尾',
  both: '两侧',
}

export function createDefaultIdentifier(): CompositeV2IdentifierConfig {
  return { text: '', placement: 'suffix' }
}

/** 归一化：位置非法退回 `suffix`；文本缺失退回空串（空串 = 不附加）。 */
export function normalizeIdentifier(value: unknown): CompositeV2IdentifierConfig {
  if (!value || typeof value !== 'object') return createDefaultIdentifier()
  const raw = value as Record<string, unknown>
  const placement = raw.placement
  return {
    text: typeof raw.text === 'string' ? raw.text : '',
    placement: placement === 'prefix' || placement === 'both' ? placement : 'suffix',
  }
}

/**
 * 标识符是否真的要贴。
 *
 * 判据是 `trim()` 后非空：用户可能就想要「文案  @小王」这种带间隔的效果，所以原文的前后
 * 空格要保留；但**纯空格**的标识符只会给每个水印多贴一对空白，那不是用户输入它的意图。
 */
export function isIdentifierEnabled(identifier?: CompositeV2IdentifierConfig | null): boolean {
  return Boolean(identifier && identifier.text.trim() !== '')
}

/**
 * 这段文案是不是**竖排**写法（一个字一行）。
 *
 * 产品里**没有「文字方向」参数** —— 竖排是靠用户逐字换行排出来的（2026-09-22 报障的现场：
 * 合规水印「该活动存在时效性，具体优惠以实际为准」就是十几行、每行一个字）。
 * 所以「这一层是不是竖排」只能从文案形状判断，而这个判据很稳：
 * **横排文案不会每行都只占一个字符**（「优惠\n限时」这种两行两字的极少，且那样排本来就
 * 更接近竖排，当作竖排处理不违和）。
 *
 * 用 `Array.from` 数**字符**而不是 `.length` 数码元：emoji 是代理对，`'👍'.length === 2`
 * 会被当成两个字，判据就把它当横排了。
 *
 * 空行会让整段判为「不是竖排」—— 这是刻意的兜底方向：判错成横排只是维持既有行为，
 * 判错成竖排会让标识符凭空多占一行。
 */
export function isVerticalText(text: string): boolean {
  const lines = text.split('\n')
  if (lines.length < 2) return false
  return lines.every((line) => Array.from(line).length === 1)
}

/**
 * 把标识符贴到一段文案上。
 *
 * 多行文案只贴**整段**的首尾（首行前 / 末行后），不是逐行都贴——「文案开头、文案结尾」
 * 说的是整段，逐行贴会把多行水印变得像列表。
 *
 * ⚠️ **竖排例外**（2026-09-22 杰哥报障）：竖排时每一行就是**一个字的格子**，把标识符贴到
 * 首行前面会让它与首字并排 —— 现场是 `★该` 挤在同一排、看着像「★ 被排到了文案左边」。
 * 竖排的「上 / 下」对应横排的「前 / 后」，所以这里换成 `unshift` / `push` 让它**自己占一格**，
 * 位置关系才与横排一致（`★` 独占第一格 = 文案上方）。
 */
export function applyIdentifierToText(text: string, identifier?: CompositeV2IdentifierConfig | null): string {
  if (!isIdentifierEnabled(identifier)) return text
  const value = identifier!.text
  const atPrefix = identifier!.placement === 'prefix' || identifier!.placement === 'both'
  const atSuffix = identifier!.placement === 'suffix' || identifier!.placement === 'both'
  if (!atPrefix && !atSuffix) return text
  const lines = text.split('\n')
  if (isVerticalText(text)) {
    if (atPrefix) lines.unshift(value)
    if (atSuffix) lines.push(value)
    return lines.join('\n')
  }
  if (atPrefix) lines[0] = value + (lines[0] ?? '')
  if (atSuffix) lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + value
  return lines.join('\n')
}

/**
 * 这一层要不要贴标识符。**缺省 = 要**，只有显式 `false` 才跳过。
 *
 * 单独成函数，是为了让「图层面板那个勾选框」与「渲染时贴不贴」读**同一个判据**——
 * 两处各写一次 `!== false` / `=== false`，迟早有一处写反，而症状是
 * 「界面上勾着、产出的图上却没有」这种最难查的一类不一致。
 */
export function layerWantsIdentifier(layer: { withIdentifier?: boolean }): boolean {
  return layer.withIdentifier !== false
}

/**
 * 某一层**最终要画的文字**：要标识就叠加，不要就原样。
 *
 * 渲染器与测试都读它 —— 「贴不贴标识」只有这一处实现；测试也就不必 mock 一个 canvas
 * 才能验证「关掉标识的那一层真的不带署名」。
 */
export function resolveLayerText(
  layer: { text: string; withIdentifier?: boolean },
  identifier?: CompositeV2IdentifierConfig | null,
): string {
  return layerWantsIdentifier(layer) ? applyIdentifierToText(layer.text, identifier) : layer.text
}

/**
 * 标识符签名，供 overlay 缓存键使用。
 *
 * 必须同时含文本与位置：只含文本时，把「结尾」改成「两侧」会因为签名不变而命中旧缓存，
 * 表现是「切换位置没反应」。
 */
export function getIdentifierSignature(identifier?: CompositeV2IdentifierConfig | null): string {
  if (!isIdentifierEnabled(identifier)) return '-'
  return `${identifier!.placement}:${identifier!.text}`
}
