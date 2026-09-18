/**
 * 未知值的类型收窄与安全取值。
 *
 * 这些判定此前在 `agentApi.ts` / `agentWebSearch.ts` / `openaiCompatibleImageApi.ts` /
 * `apiProfiles.ts` / `store.ts` 各自实现过一份，此处为**唯一实现**，其余一律改为引用。
 */

/** 判断是否为「非数组的对象」。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 取字符串：trim 后非空才返回（空白串视为无值）。 */
export function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * 取字符串：只判非空，**不 trim**。
 *
 * ⚠️ 与 `getStringValue` 的语义差异是刻意的：`agentApi.ts` 的流式事件解析依赖「不 trim」，
 * 纯空白的字段值也需要原样透出。合并去重时请勿把两者统一成一份。
 */
export function getUntrimmedStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value ? value : undefined
}
