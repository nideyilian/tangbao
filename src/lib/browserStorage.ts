/**
 * 取 localStorage。非浏览器环境（SSR / 单测 node 环境）返回 null。
 *
 * 此前 `features/strategy/sopAiRevision.ts`、`lib/agentBatchQueue.ts`、
 * `lib/agentBatchWorkspace.ts` 各有一份 —— 其中两份用 `typeof localStorage` 探测、
 * 一份用 `typeof window` 探测，取并集中更严格的窗口探测作为唯一实现。
 */
export function getBrowserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}
