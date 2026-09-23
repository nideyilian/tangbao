# 0019 删任务卡 = 产出图进回收站（不再永久删除）+ 素材进回收站必须与任务卡退槽

- **日期**：2026-09-23
- **状态**：**生效中（已实现）**
- **决策者**：杰哥（产品负责人）
- **相关**：[0012](0012-watermark-library-per-product.md)（同一套「回收站是软删」的数据模型）、
  TB-108（每日批量生成，产出会大量进回收站）、TB-119

---

## 背景

杰哥 2026-09-23 的原话拆成三条要求：

1. 图片模式下单独删一张图 → 该图**自行进入回收站**，并与对应的任务卡**解除关联**；
2. 整个任务卡被删 → 其关联的所有图片**随任务卡一并进入回收站**；
3. 图片被清空后，**彻底清除**与这张图片相关的所有信息和缩略图。

原话里的理由是一句判断：「以此避免因残留引用导致无法删除的情况」。

## 真因（三条是同一个模型缺口的三种表现）

- **①** 回收站是**软删**（只把 `asset.status` 改成 `trashed`，图与记录都还在），
  而删除入口 `moveToTrash`（`src/features/assetLibrary/store.ts`）**没有任何一步去动任务记录**：
  `task.outputImages[slot]` 仍指着那张图。任务卡封面直接读 `task.outputImages[0]`
  （`TaskCard.tsx`）、角标读 `task.outputImages.length` ⇒ 删完看起来「没删掉」
  （封面照旧、张数照旧）。而永久删除路径早就有一套现成的收尾语义
  （`patchTaskForPurgedSlots`：置空槽位 + 记 `purgedOutputSlots`，卡片据此显示「已删除」），
  软删路径**没用它**。
- **②** 删任务卡走的是 `purgeTaskOutputAssets` → **永久删除**（写墓碑 + 删图片字节 + 删磁盘原图），
  与要求正好相反；界面文案也在替这个行为背书（「一并删除，不可恢复」）。
- **③** 永久删除路径只清了图片记录与内存原图：磁盘缩略图（`thumbs/<id>.v*.webp`）**一个没删**，
  内存缩略图那句写成了 `thumbnailCache.delete(imageId)` —— 而缓存键是 `` `${id}:${variant}` ``
  ⇒ **一条都没删掉**。素材没了、缩略图还在，订阅方还能把已删的图推回界面。

## 决策

1. **删任务卡把产出图移入回收站**（`trashTaskOutputAssets` 取代 `purgeTaskOutputAssets`）：
   仍被其他任务输入 / Agent 会话 / 工作区等**拥有型引用**的图**保留不动**（口径与旧实现逐字一致，
   仍报「N 张被其他任务/会话引用，已保留」），其余移入回收站。**永久删除只保留在回收站的显式入口**
   （清空回收站 / 永久删除按钮），不再有第二条通往不可逆的暗路。
2. **素材进回收站时同步「退槽」**（`detachTrashedAssetsFromTasks`，在 `moveToTrash` 内调用）：
   把该图在所属任务里的输出槽位置空 + 记进 `purgedOutputSlots` + 落盘。
   复用永久删除的槽位语义，卡片显示「已删除」两处一致。
3. **清空即彻底清**：新增 `purgeImageDerivedData` / `clearImageDerivedCaches`，
   一次清掉**内存**（原图、缩略图两个通道、待算队列、在途回填、订阅者、预取窗口、等待者）
   与**磁盘**（`thumbs/<id>.v*.webp`，full + grid 所有版本）两处派生数据；
   三条删除路径（永久删除 / 失效记录清理 / 单张清理）统一走这一份实现。

## 为什么不那么做

- **不为「恢复」建反查表**：从回收站恢复这张图时**不会**自动接回任务卡。要接回就得长期维护
  一份「图 ↔ 卡片」映射，还要处理「卡片已被删」「槽位已被别的图占用」「图被移进别的卡片」
  这些组合；收益远小于代价。恢复后它作为一张**独立素材**回到素材库。
- **不用操作系统回收站**：本应用的回收站是素材库的一等公民（可浏览、可恢复、可永久删除、
  带 30 天策略），把它交给 OS 回收站等于把「恢复」这个动作从应用里搬走。
- **不在软删时删用户磁盘上的导出副本**：删任务卡仍会清掉**被删那张卡自己的**
  `localSavedOutputImagePaths`（旧口径不变 —— 那些路径只存在于任务记录上，任务一没了就再也追不回来，
  留着只会变成永久孤儿文件）；但**别的任务**引用的同一张原图的导出文件不再删除
  （图只是进了回收站，字节还在，删用户磁盘上的副本说不通）。
- **不把「被其他任务输出引用」也算作保留理由**：那会让「删一张卡」的后果取决于另一张卡是否
  恰好生成了同一张图（内容去重后同 imageId），口径反而更难讲清。现在这条路径上，
  两张卡都指同一张图时，删一张 ⇒ 图进回收站 ⇒ 另一张卡也显示「已删除」（与永久删除时代的
  观感一致，只是可恢复）。

## 代价 / 影响

- **磁盘占用变大**：以前删任务卡会真删图，现在图留在回收站（30 天策略 + 手动清空）。
- **回收站会变长**：删卡是高频操作，回收站里会积累。清空回收站是显式动作，默认勾选「解除引用并彻底删除」。
- **回收站的任务卡视图必须放行「孤儿组」**：删卡后图的来源任务随之消失 ⇒ 这些图只会归进孤儿组；
  若沿用「任务卡视图禁止出现孤儿组」的旧口径，用户按「删任务卡 → 去回收站捞图」走会看到空回收站
  （只有切回图片模式才看得见）。现在的口径是：**孤儿组只在回收站作用域可见**，
  正常视图仍然禁止出现「任务已删除」状态。
- **UI 文案全面改口径**：`AssetBatchView` / `DetailModal` / `InputBar` / `TaskCard` 六处
  「一并删除，不可恢复」→「一并移入回收站（可恢复）」。
- **Ctrl+Z 的语义变窄**：删任务卡后撤销只会把**图片**从回收站捞回来，卡片不会回来
  （与「恢复不接回卡片」同一条口径）。

## 落地位置

| 文件 | 改了什么 |
| --- | --- |
| `src/store.ts` | `purgeTaskOutputAssets` → `trashTaskOutputAssets`（改走回收站）；新增 `detachTrashedAssetsFromTasks`；新增 `clearImageDerivedCaches` / `purgeImageDerivedData`；`deleteImageIfUnreferenced` / `deleteUnreferencedImageIds` / `cleanupAllOrphanedImages` / `cleanupMissingImageRecords` / 永久删除的 `deleteImages` 统一到新入口 |
| `src/features/assetLibrary/store.ts` | `moveToTrash` 内调 `detachTrashedAssetsFromTasks`（失败不回滚回收站，只留痕） |
| `src/features/assetLibrary/AssetBatchView.tsx` | 回收站作用域放行孤儿组；两处确认文案改口径 |
| `src/components/{DetailModal,InputBar,TaskCard}.tsx` | 确认文案改口径 |
| `src/store.test.ts` / `src/features/assetLibrary/store.test.ts` / `AssetBatchView.test.tsx` | 6 条新守卫（见 BACKLOG TB-119 的验收证据） |
