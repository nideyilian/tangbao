/**
 * 「自动后处理」开关的文案。
 *
 * 为什么单独成一个模块：它是**纯文案逻辑**，独立后测试不需要拉起整个参数面板
 * （那边拖着 store、composite、项目树一堆依赖）。
 *
 * 语义：「这个方向参不参与自动后处理」有两层 ——
 * ① 方向级开关（`PostprocessNodeOverride.enabled`，可被上级继承）；
 * ② 后处理**启用范围**（项目树「后处理」列，决定哪些方向进流程）。
 * 两层是刻意分开的（见 `ProjectTreeTable` 的「由上级启用」文案），**都合理**；
 * 但只显示「已开启」会和上方那句「未启用后处理 ⇒ 不会产出变体」的警告自相矛盾
 * （2026-09-20 反馈）。所以不在启用范围时改说「未生效」。
 *
 * 文案只留最短的必要信息（2026-09-20 反馈「太长的说明又说不明白」）：
 * 开关的**位置**已经表达了开/关，label 不必再复述「已开启」，
 * 于是这里只说一句结论 —— 它现在起不起作用。
 */
export function formatParticipationLabel(enabled: boolean, inEnabledScope: boolean): string {
  // 不在启用范围时，无论开关本身是开还是关，都不会产出 —— 直接说结论
  if (!inEnabledScope) return '未生效'
  return enabled ? '已开启' : '已关闭'
}
