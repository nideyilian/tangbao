/**
 * 「参与自动后处理」开关的文案。
 *
 * 为什么单独成一个模块：它是**纯文案逻辑**，独立后测试不需要拉起整个参数面板
 * （那边拖着 store、composite、项目树一堆依赖）。
 *
 * 语义：「这个方向参不参与自动后处理」有两层 ——
 * ① 方向级开关（`PostprocessNodeOverride.enabled`，可被上级继承）；
 * ② 后处理**启用范围**（项目树「后处理」列，决定哪些方向进流程）。
 * 两层是刻意分开的（见 `ProjectTreeTable` 的「由上级启用」文案），**都合理**；
 * 但只显示「已开启」会和上方那句「不在启用范围内 ⇒ 不会产出渠道变体」的警告自相矛盾
 * （2026-09-20 反馈）。所以不在启用范围时显式标「未生效」——
 * 值如实显示，但不再暗示它正在起作用。
 */
export function formatParticipationLabel(enabled: boolean, inEnabledScope: boolean): string {
  if (!enabled) return '已关闭'
  return inEnabledScope ? '已开启' : '已开启（未生效）'
}
