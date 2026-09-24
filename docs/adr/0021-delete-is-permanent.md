# 0021 删除即永久删除：撤除素材回收站

- **日期**：2026-09-24
- **状态**：**生效中（已实现）**
- **决策者**：杰哥（产品负责人）
- **相关**：**作废** [0019](0019-task-delete-moves-outputs-to-trash.md)；TB-119 / TB-127

---

## 背景

杰哥 2026-09-24 的原话：「这些项都帮我去掉，特别是回收站，导致我当前删除时出现了非常多问题，
去掉后，删除就是真正的删除就行」。定下的范围是**只撤回收站**，保留「全部素材 / 最近生成 / 收藏 / 未整理」。

为什么 0019 的「软删 + 退槽」会带来「非常多问题」：

- **同一个「删除」，后果取决于入口**：卡片右键是软删（图还在，只把 `status` 改成 `trashed`），
  得再进回收站点一次「永久删除」才是真删。用户看到的是「删了没删掉」——封面照旧、角标照旧。
- 软删之后要**额外维护一致性**：退槽（`detachTrashedAssetsFromTasks`）、
  回收站作用域放行孤儿组、六处文案改口径、磁盘占用不释放 —— 每一条都是新长出来的复杂度。
- 结果：删一张图要经过两个界面、两套语义，而**唯一通往真删的路藏在回收站里**。

## 决策

1. **侧边栏撤除「回收站」**（`SYSTEM_SCOPES` 去掉 trash 项），工具栏撤除「清空回收站」。
2. **删除 = 永久删除**：四个入口（卡片右键菜单 / Delete 键 / 大图查看器 / 重复素材弹窗）
   统一走 `deleteAssets` → `purgeGeneratedAssets`：
   - 无引用冲突 ⇒ **当场彻底删除**（记录 + 原图字节 + 磁盘缩略图）；
   - 被其他任务输入 / 工作区 / Agent 会话等**拥有型引用** ⇒ 挂起，由素材库工作区弹
     「解除引用并彻底删除」确认（`AssetPurgeModal`），用户确认后才 force 删。
     这一条保留了 0019 唯一值得留的东西：**不静默替用户改别的卡片的数据**。
3. **删任务卡 = 产出图随卡永久删除**（`trashTaskOutputAssets` 改回 `purgeTaskOutputAssets`），
   被其他任务/会话引用的图仍保留并如实报数。任务卡的输出槽位收尾由 `patchTaskForPurgedSlots` 承担。
4. **数据层不动表结构**：`assets.status` 列保留（此后只会产 `active`）；`moveToTrash` / `restoreAssets`
   作为底层能力保留，但**已无 UI 入口**。
5. **存量迁移**：主进程 `CATALOG_MIGRATIONS` v2 把残留的 `status='trashed'` 素材**恢复成正常素材**
   （不是删掉 —— 用户从没说过那些图不要了）；渲染层 `normalizePersistedScope` 把持久化的
   `scope='trash'` 归一为 `all`（否则升级后重启会停在一个不存在的范围上，界面空白且没有入口切回来）。

## 为什么不那么做

- **不删 `assets.status` 列**：改 59MB 本地库的表结构风险大、收益为零；列留着不动，语义上只产 `active`。
- **不删底层软删能力**（`moveToTrash` / `restoreAssets` / `applyTrashStatus`）：它们是 `status` 的另一半，
  删掉要连带动 repository 接口、undo 栈与一批测试；且将来若要做「撤销删除」，软删是基础。
  现状是**保留实现、不接任何入口**。
- **不把存量 trashed 素材直接清掉**：那才是真正不可逆的一步；恢复成正常素材是最保守的处置。
- **不给删除加「每次都弹确认」**：杰哥的要求是「删除就是真正的删除就行」——
  日常删除不打断，只有会**连带影响别的卡片**（被引用）时才拦一下。
- **不做「撤销删除」**：真删除不进撤销栈，Ctrl+Z 捞不回来。这条代价明写在 RISK R-105。

## 代价 / 影响

- **误删不可恢复**（RISK **R-105**）：没有回收站兜底，也没有 Ctrl+Z。
- 删任务卡的连带影响**永久化**：同一张图被两张卡引用时，删一张 ⇒ 另一张显示「已删除」且图真没了。
- **磁盘立刻释放**（原来是删完还占着原图空间）。
- 0019 引入的「孤儿组在回收站可见」例外**一并撤除**：任务与产出图同时消失，不再产生孤儿。
- 六处确认文案与帮助页改口径（「可恢复」→「不可恢复」）。

## 落地位置

| 文件                                                                             | 改了什么                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/store.ts`                                                                    | `trashTaskOutputAssets` → `purgeTaskOutputAssets`（走永久删除）；两处删任务的变量与 toast 文案               |
| `src/features/assetLibrary/store.ts`                                              | 新增 `deleteAssets` / `pendingPurgeRequest` / `clearPendingPurgeRequest`；新增 `normalizePersistedScope`     |
| `src/features/assetLibrary/AssetLibrarySidebar.tsx`                               | 撤回收站项与 `systemCounts.trash`                                                                            |
| `src/features/assetLibrary/AssetLibraryToolbar.tsx`                               | 撤「清空回收站」按钮 + `trashCount` / `onEmptyTrash` 两个 props                                              |
| `src/features/assetLibrary/AssetLibraryWorkspace.tsx`                             | 撤 `emptyTrash` / `isTrashScope` / `counts.trash`；消费 `pendingPurgeRequest` 弹确认；撤 `onPurgeRequest` 透传 |
| `src/features/assetLibrary/{AssetCardMenu,AssetViewer,AssetDuplicateModal}.tsx`   | 删除入口改真删除、菜单/按钮文案改「删除」                                                                     |
| `src/hooks/useAssetLibraryShortcuts.ts`                                           | Delete 键改真删除（撤「回收站视图不响应」分支）                                                              |
| `src/features/assetLibrary/query.ts` + `src/lib/assetLibraryModel.ts`             | 撤 trash 计数与 scope 分支（**保留**「trashed 对所有范围不可见」的安全网）                                   |
| `src/types.ts`                                                                    | `AssetLibraryScope` 与 `AssetCatalogCursorPage.counts` 去掉 trash                                            |
| `electron/asset-catalog.ts`                                                       | 撤 trash 查询分支与计数；新增 `restoreTrashedAssets` + `CATALOG_MIGRATIONS` v2（schema 1 → 2）               |
| `electron/asset-api-server.ts`                                                    | scope 白名单撤 trash（旧值归一为 all）                                                                       |
| `src/components/{HelpModal,DetailModal,InputBar,TaskCard}.tsx`                    | 文案改「一并删除（不可恢复）」                                                                                |
