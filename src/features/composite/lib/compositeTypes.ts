/**
 * 水印模块里**不随版本变**的通用类型。
 *
 * 这里曾经是 A 套（`CompositeWorkspace` 时代）的整套数据模型：`CompositePreset` /
 * `CompositeCategory` / `CompositeWatermarkPreset` / `CompositeOutputPresetGroup` /
 * `CompositeWorkspaceStateSnapshot` … 共 24 个类型。A 套的编排在「后处理统一到瀚灵编排」
 * 里整体退役后（见 `docs/postprocess-unify-on-hanling-plan.md` 第四、七节），
 * 这些类型已全仓零引用，遂一并删除 —— **留着会诱发「再按旧模型写一套」**。
 *
 * 现在的水印模型请看 `compositeV2Types.ts`（`CompositeV2Preset` 等，落盘 version 5）。
 */

/** 本地磁盘上的一张图（LOGO 库 / 图标库用），`dataUrl` 只在需要像素时才回填。 */
export type CompositeFsImage = {
  path: string
  name: string
  dataUrl?: string
  width?: number
  height?: number
}
