/**
 * 尺寸（比例）提示词：把用户选定的画面比例追加进提示词末尾。
 *
 * 为什么要写进提示词：`size` 参数只对部分服务商/中转生效，很多网关会忽略它，
 * 真正约束出图比例的还是提示词本身。所以选择尺寸必须**同时**改参数与提示词，
 * 否则用户会遇到「选了尺寸但出图比例没变」。
 */

/** 提示词末尾的比例约束片段（`，画面比例为:16:9`）：改写前先整段摘掉，再按需重新追加。 */
const TRAILING_ASPECT_RATIO_PROMPT_PATTERN =
  /(?:[，,；;。\s]*画面比例为\s*:\s*(?:\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?)?\s*)$/u

/**
 * 把比例约束写到提示词末尾，已有的一段会被替换而不是重复追加。
 *
 * `ratio` 为空 = 用户没选尺寸：此时**只摘掉旧约束、不追加空片段**，对应「未选择尺寸时仍按
 * 默认的自动尺寸处理」；否则会留下 `画面比例为:` 这种没有值的脏尾巴。
 */
export function withAspectRatioPrompt(prompt: string, ratio: string): string {
  // 循环摘干净：历史脏数据可能堆了不止一段（例如连续点两个比例时留下两层），
  // 只摘末尾一段会让旧的那段一直挂在提示词里。
  let cleaned = prompt
  while (TRAILING_ASPECT_RATIO_PROMPT_PATTERN.test(cleaned)) {
    const next = cleaned.replace(TRAILING_ASPECT_RATIO_PROMPT_PATTERN, '')
    if (next === cleaned) break
    cleaned = next
  }
  const withoutTrailingRatio = cleaned.trimEnd()
  if (!ratio) return withoutTrailingRatio
  return `${withoutTrailingRatio}${withoutTrailingRatio ? '，' : ''}画面比例为:${ratio}`
}
