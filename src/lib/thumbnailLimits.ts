/**
 * 缩略图尺寸上限（**纯常量模块，不 import 任何东西**）。
 *
 * 为什么单独立一个文件：UI 侧（`tileImagePlan`）要拿这些数字判定「这块磁贴该用哪一档图源」，
 * 而 `db.ts` 是重模块、且多个测试会整体 mock 它 —— 常量从 `db.ts` 出口的话，
 * 那些测试里会拿到 `undefined`，阈值比不出来（`x <= undefined` 恒 false）⇒ 判定静默失效。
 * 依赖方向：`db.ts` 与 `tileImagePlan.ts` 都从这里取，**别在任一处再写一份数字**。
 */

/** grid（网格小图）**宽度**上限：磁贴的宽度维度够用即可；横图结果与旧口径「最长边 512」逐像素一致。 */
export const GRID_THUMBNAIL_WIDTH_LIMIT = 512

/** grid 最长边上限：防止极端长图（如 600×2400）按宽度算之后高度失控。 */
export const GRID_THUMBNAIL_MAX_EDGE = 1024

/** full（详情大图）最长边。 */
export const FULL_THUMBNAIL_MAX_EDGE = 1024
