/**
 * 素材目录「单页条数」的唯一口径 —— 主进程 SQLite 目录（`electron/asset-catalog.ts`）
 * 与渲染进程浏览器回退（`src/lib/assetLibraryRepository.ts`）共用这一份实现。
 *
 * 这里曾经把上限写死成 `Math.min(200, …)`：渲染进程「全选全部结果」按 500/页翻页
 * （`assetCommands.searchAllAssetIds` 的 `PAGE_SIZE`），每次都被悄悄夹回 200 —— 一页少拿
 * 300 条，大库全选要多跑好几轮 IPC；HTTP 素材 API 的 `?limit=` 更是怎么调都跨不过 200，
 * 在界面上看起来就是「结果被限死在 200 条」。
 *
 * 现在按调用方请求的页大小返回，只留一个防畸形请求（`?limit=999999`）的兜底上限：
 * 它是安全阀，不是功能上的数量限制。
 */
export const DEFAULT_ASSET_PAGE_SIZE = 100

export const MAX_ASSET_PAGE_SIZE = 1000

/** 单页条数：认调用方要的值（缺省 100），只夹掉非正数与畸形大值。 */
export function resolveAssetPageSize(requested?: number): number {
  const value = Math.floor(Number(requested ?? DEFAULT_ASSET_PAGE_SIZE))
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.min(MAX_ASSET_PAGE_SIZE, value)
}
