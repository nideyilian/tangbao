# 数据持久化对标：10 个可借鉴的做法

> 调研日期：2026-09-23 ｜ 调研人：阿伟
> 起因：SOP 批次卡片「图片数量不对 + 任务卡丢失」，多轮修复未愈（杰哥反馈「修过很多次」）
> 对标对象：Immich / PhotoPrism / InvokeAI / ComfyUI / Hydrus / tldraw / Excalidraw / Eagle / digiKam / darktable / Lightroom / A1111
> 状态：调研报告（供裁决，**未开工**）

---

## 0. 先说结论：为什么以前修不好

糖包的数据内核**已经是对的**——`docs/asset-kernel.md` 定义的 `Asset`（逻辑）/ `Blob`（内容寻址）/ `Version` / `Origin`，
机器索引单独建表且「可删可重建，永不覆盖用户标签与事实」，这就是 Immich / PhotoPrism 那一套。

所以失败原因不在模型，在于**有三件事一直没人负责**：

**① 「任务 → 产出图」这条关系没有被明写下来，只以两份副本存在。**

| 副本 | 位置 | 谁在用 |
| --- | --- | --- |
| 一份 id 数组 | 任务记录的 `outputImages` | 任务卡片 |
| 一份 taskId | 素材的 `origins[].taskId` | 素材库分组、查看器 |

两份各自落盘、各自可能写失败。**谁对谁错，没有权威。** 于是只能靠 UI 层「两边取并集」来兜底
（`SopBatchTaskCard.tsx:119-131` 的 `getTaskOutputImageIds`）——而兜底放在这个层级，
一旦任务压根没进组，兜底根本不执行。

**② 两条落盘路径没有同一个事务。**

`docs/architecture-constraints.md` 第六章已经写明：卡片数量来自 `tasks`（`putTask` 是**整条覆盖写**），
素材库数量来自 `assets` 逐条 upsert。两条独立路径 → 天然可能一条成功一条失败，
表现就是「任务说 74、素材说 150」。

**③ UI 层在替数据层做判断，而且是两套不同的判断。**

- 卡片：`buildAssetBatchGroups`（`src/lib/assetBatchGrouping.ts:129`）——**遍历素材**，读 `origin.taskId`，**反查**任务。
  倒推不到的任务直接不算存在（`assetBatchGrouping.ts:232-270` 的 `includeTaskless` 又跳过所有「成功且无失败」的任务）。
- 弹窗：`groupSopBatchTasks`（`src/lib/sopBatchTaskGrouping.ts:76`）——**遍历任务记录**按批次分组。
- 两者对同一批次给出 **74** 与 **150**。

每轮修复都在给这两套算法补守卫（`pickMoreCompleteOutputIds` / `persistTaskWithRetry` / `canSettleTaskOutputs`），
但**没有人去消掉「两套」本身**。

> 一句话：缺的不是校验，是**唯一的那一条边**。

### ④ 硬证据：这两套算法自项目诞生至今，一次都没被改过

```text
$ git log --oneline -- src/lib/assetBatchGrouping.ts      # 卡片那套
7d9b354 feat(assetLibrary): 素材详情弹窗底部改为「同一任务卡片」的图片（TB-080）
0a4b17e rebrand: DOUPAO fork -> 糖包 (TANGBAO)

$ git log --oneline -- src/lib/sopBatchTaskGrouping.ts    # 弹窗那套
0a4b17e rebrand: DOUPAO fork -> 糖包 (TANGBAO)
```

- `sopBatchTaskGrouping.ts`（弹窗那套）自 rebrand 后**零次修改**。
- `assetBatchGrouping.ts`（卡片那套）唯一一次修改是 TB-080 的素材详情弹窗，**与数量无关**。
- `SopBatchTaskCard.tsx` 改过两次，都是**加功能**（TB-088 先建卡后写词、TB-108 存为策略卡），不是修数量。

再对照线上版本 v0.3.7（`f106264`）→ HEAD：

```text
$ git diff --stat v0.3.7 HEAD -- src/lib/assetBatchGrouping.ts src/lib/sopBatchTaskGrouping.ts \
    src/features/assetLibrary/AssetBatchView.tsx src/components/SopBatchTaskCard.tsx
 src/features/assetLibrary/AssetBatchView.tsx | 17 +++++++++++------
```

四个数据层文件里，只有 `AssetBatchView.tsx` 变了——改的是**删除提示文案**和**一个过滤器**。
而且 v0.3.7 上那个过滤器是 `(group) => group.kind !== 'orphan'`，**比现在更严格**
（孤儿组在所有作用域都被滤掉，连回收站都不放行）。

**结论：杰哥反馈的「修过很多次」，修的都是这条链路的下游（UI 兜底 / 落盘守卫 / 加载链 / 文案）；
根因位置——两套分组算法——一次都没被碰过。** 这解释了为什么「一直没修好」。

下面的 10 个方案，前 3 个就是围绕这一点。

---

## 1. 把「产出关系」变成一张显式的边表（最高优先）

**对标**：Immich —— `asset`（逻辑）与 `asset_file`（物理文件，类型分 FullSize / Preview / Thumbnail）分离，
一个 asset 对应多条 file；「这张图有几个文件」是查询，不是猜测。
PhotoPrism 同理：`Photo`（逻辑资产）与 `File`（物理字节）分离，一个 Photo 可以有 RAW + JPEG + sidecar 三个 File。

**糖包现状**：`asset-kernel.md` 的模型已经对，但**产出关系仍是素材身上的一个字段副本**，
任务侧想知道「我产出了什么」只能去素材里翻。

**学过来**：新增一条边表（或 `app_data_records` 里一个独立 namespace）：

```text
generation_output(task_id, asset_id, slot, created_at)   PRIMARY KEY(task_id, asset_id)
```

- 任务卡片问「我有哪些产出」→ 查这条边（并集 `task.outputImages` 仅作历史兜底，不再作主）
- 素材库分组问「这批是谁产的」→ 查同一条边
- 删除任务 / 删除图 → 由边上的引用计数决定（见方案 8）
- **两边永远不可能不一致，因为只有一个答案**

**回填**：现有 `origins[].taskId` 是现成的回填来源（`assets` 表已有 `origins` 列，可直接 SQL 展开）。

**代价**：一次 schema 迁移 + 回填；`buildAssetBatchGroups` 与 `groupSopBatchTasks` 收敛成一个函数。

---

## 2. 落盘：一个事务写两边，而不是两条独立路径

**对标**：InvokeAI —— 所有关键操作裹在 SQL 事务中保证原子性，迁移前自动备份、失败回滚。
Hydrus —— 读写走 job 队列，支持 rollback；维护任务有独立队列（`ClientDBFilesMaintenance`）。

**糖包现状**：任务与素材两条落盘路径（见第六章）。文档里已经写明「两者不一致 = 落盘不完整」，
并且已经排除了加载链 —— 也就是说，**这就是根因本身，不是待排查项**。

**学过来**：
- 「任务产出图落盘」这一件事，做成**一个不可分割的写操作**：边表 + 任务 + 素材，同一事务提交。
- 落盘失败要么全成、要么全不成 —— 不允许出现「任务记住了、素材没记住」的中间态。

**代价**：需要把 `putTask` + `saveAssets` 的调用点收敛到一个 `commitGenerationOutput()` 之类的入口。

---

## 3. 整条覆盖写 → 字段级更新 + 版本号（防 lost update）

**对标**：Immich —— Kysely `onConflict()` 做 upsert，只更新目标字段。
tldraw —— 每条 record 自带 `version` / `versionNonce`，变更以「记录 diff」为单位广播与持久化。
Excalidraw —— 每个 element 有独立 `version` 与 `versionNonce`。

**糖包现状**：`putTask` 是**整条覆盖写**。两个并发的落盘点（自动保存 / 看门狗收尾 / 用户操作）
后写的那次会**整条盖掉**先写的那次 —— 这正是 `pickMoreCompleteOutputIds` 这类补丁存在的原因：
「本轮产出更少时保留已落盘的一份，不让数量回退」。

**学过来**：
- 任务记录加 `rev`（自增版本号），写入带 `WHERE rev = ?` 条件；不匹配就重读再合并。
- 或者：把「产出图」从整条覆盖写里**拆出去**（方案 1 的边表天然解决这一点 —— 边表用插入，不用覆盖）。

**代价**：改动集中在持久化封装层，不动 UI。

---

## 4. 对账作业（reconcile）：一致性问题由后台修，不由 UI 猜

**对标**：
- Immich —— `asset_job_status` 逐项记录每个后台处理任务是否完成，用「哪些还没做」驱动重跑。
- Hydrus —— `ClientDBFilesMaintenance` + 维护队列（缩略图重生成等），`ClearJobs` 落库。
- PhotoPrism —— 索引过程与「完整重扫（rescan）」是常备能力，UI 计数与文件数差异有明确解释
  （Search 数的是逻辑照片，Library > Originals 数的是物理文件）。

**糖包现状**：有 `generated-asset-reconcile-v1`（meta 里有游标），但**它不负责修「任务 ↔ 产出」的边**。
而且 UI 一旦看到不一致，没有任何机制被告知「该修什么」。

**学过来**：加一个**幂等的对账函数**，启动后空闲时跑一次，也提供手动入口：

```text
对每一批：
  边表说有的、任务记录/素材里没有的  → 补
  任务记录说有、边表和素材都没有的  → 标记为「产出丢失」并计数
  素材存在但没有归属的（孤儿）      → 归属到「未归属」而不是从视图里消失
```

关键：**对账的产物要能显示出来**（哪怕是「本批 2 张图未归属」这种一行提示），
而不是像现在这样「静默少 76 条」。

**代价**：中等；但它是唯一能保证「以后不会再出现同类 bug」的机制。

---

## 5. 派生数据独立存放、可重建、不参与计数

**对标**：digiKam —— 把数据拆成**四个库**：core（相册/图片/搜索）、thumbnail（缩略图）、
similarity（指纹）、face。缩略图和指纹都是**可重建的派生数据**，坏了不影响真相。
PhotoPrism —— 明确使用 denormalized 的搜索索引，并说明它只是索引。

**糖包现状**：machine index 已经这么做了（好）。但**缩略图缓存参与过"图还在不在"的判断**
（`useCoverThumbnail` 的 `lost` 状态、`thumbnailCache`），历史上踩过「删了图，缩略图还在，
已删的图还能被推回界面」的坑（R-99 同族）。

**学过来**：明确一条铁律 ——
> **派生数据（缩略图 / 指纹 / 向量 / FTS）永远不能参与「某条记录是否存在」的判定。**

UI 要显示「图片已丢失」，只能依据**素材记录本身的状态**，不能依据「缩略图读不出来」。

**代价**：小；主要是审查现有判定点。糖包已有 `IsImageLost` 之类的判断，需要逐处核对来源。

---

## 6. 加载时归一化与修复（normalize & repair on load）

**对标**：Excalidraw —— 有专门的 Data Restoration 层：加载旧文件时**修 binding、补尺寸、迁移版本**，
坏数据在进入内存前就被修好，而不是让渲染层面对半截数据。
tldraw —— `onValidationFailure` 钩子：校验失败时**返回修正后的记录**而不是崩溃。

**糖包现状**：`normalizeTaskRecordFields` 做了部分字段归一化，但**不变式没有被检查**
（例如「status=done 就应当有产出，或者有明确的失败标记」）。

**学过来**：任务/素材**进内存前**过一遍不变式检查，发现违反就**修 + 记一笔**（不是静默放过）：

```text
status=done 且 边表无产出 且 无 batchItemErrors  → 标记为「产出缺失」，进对账队列
status=error 但 边表有产出                        → 视为「部分完成」，不是失败
```

这样卡片就不会再把「其实有图的任务」算成失败，也不会把「其实没图的任务」当成正常。

**代价**：小到中；与方案 4 共用同一套判定函数。

---

## 7. schema 版本 + 记录级迁移（含 down）+ 迁移前自动备份

**对标**：
- tldraw —— 快照里序列化 schema 版本；`migratePersistedRecord(record, schema, 'up' | 'down')`
  **逐条记录**迁移，且支持回退；`getMigrationsSince` 判断「能否升级」。
- InvokeAI —— 迁移前**自动备份**、失败**完整回滚**；还提供「内存数据库模式」专门用于
  试新版本时不碰真实数据（`use_memory_db: true`）。
- Hydrus —— 启动时比对版本号，低则执行迁移函数；`Vacuum Into` 到临时文件降低损坏风险。

**糖包现状**：`app_data_records` 的 JSON 结构随代码演进，**没有版本号**，
迁移靠 `normalizeTaskRecordFields` 之类的「读的时候顺手补」，且**没有 down 路径**。

**学过来**：
- 每条记录带 `schemaVersion`；
- 迁移是**纯函数序列**（`up` / `down`），可单测；
- 迁移前自动备份（糖包已有 `backup-before-*` 的实践，把它做成自动的）；
- 提供一个「用副本库启动」的开关，专门验证迁移。

**代价**：中；但这是防「升级把用户数据搞坏」的唯一正解（Lightroom 用户 5 万张图编辑丢失就是栽在这）。

---

## 8. 内容寻址去重 + 引用计数

**对标**：
- Immich —— `checksum`（SHA1，存为 bytea）做上传去重。
- PhotoPrism —— `File.FileHash`（SHA-1）标识物理文件，一个 Photo 多 File 时靠哈希判定同一份字节。
- Eagle —— 内建「扫描重复文件」工具，按内容而不是文件名判定重复。

**糖包现状**：`Blob` 已经是内容寻址（好）。但**没有引用计数**：
一张图被多个任务 / 会话 / 导出引用时，「能不能删」只能靠 `trashTaskOutputAssets` 里
「被其他任务/会话引用的图片会保留」这种**推测式判断**。

**学过来**：由方案 1 的边表天然推导出引用计数（`COUNT(*) WHERE asset_id = ?`）。
- 删任务 → 边表删该任务的边 → 计数为 0 的素材才进回收站
- 删图 → 明确告知「还有 N 处引用」，由用户决定

**代价**：小（建在方案 1 之上）。

---

## 9. 明确「谁是真相、谁只是缓存」（scope 分层）

**对标**：tldraw —— 把数据分成三个 scope，各自有**不同的持久化与同步策略**：
`document`（跨会话、要同步）/ `session`（本机偏好）/ `presence`（实时，不持久化）。
这个分法让「什么该存、什么不该存」不再是一个每次都要重新讨论的问题。

**糖包现状**：至少三份东西在表达同一件事——
`app_data_records`（落盘）/ zustand store（内存）/ 直接读 SQLite 的分页快照（`catalogPage`）。
三者谁是真相没有写下来。历史上踩过「内存缓存窗口决定可见性」（TB-106）和
「只画内存那一份列表」的坑。

**学过来**：给每一类数据标注归属，写进 `docs/architecture-constraints.md`：

| 数据 | 归属 | 规则 |
| --- | --- | --- |
| 任务 / 素材 / 边表 | 数据库（唯一真相） | 内存只是投影，读到什么算什么 |
| 缩略图 / 指纹 / 搜索索引 | 派生（可重建） | 永不参与「存在性」判定 |
| 选中项 / 滚动位置 / 密度 / 展开状态 | 会话（本机 UI） | 不进库，不入统计 |

**代价**：小（主要是审查与登记），但收益是**以后每个新功能都不再需要重新争论这件事**。

---

## 10. 可移植导出层：库坏了也不至于全丢

**对标**：
- PhotoPrism —— 索引时自动写 **YAML sidecar**，明确用途就是「数据库丢了也能恢复」；
  编辑字段（标题/日期/地点）后同步更新。另写 JSON sidecar 供调试与外部工具处理。
- Eagle —— 一张图一个文件夹，旁边一份 `metadata.json`（标题、标签、评分、所属文件夹）；
  **文件夹归属是虚拟的**（存的是 folder id 列表），所以一张图能在三个文件夹里而不复制三份。
- Lightroom —— 中央 `.lrcat` 数据库 + **可选**的 XMP sidecar。默认不开，
  于是「库文件一坏，5 万张图的编辑全没了」成了经典事故（用户实测反馈）。

**糖包现状**：`app_data_records` 是黑盒 JSON，一旦库损坏或用户误删库文件，
任务/素材的组织结构就没了（图片字节本身还在 `local-saves`）。

**学过来**：
- 给「批次」写一份人类可读的 sidecar（JSON 或 YAML）落在批次目录里，
  记录：批次 id、SOP 名、提示词、产出图 id 列表、参数。**只读不回写**（避免双写冲突）。
- 已有 `data-portability-redesign.md`（导出/导入收敛）可以作为落点，不要另起一套。

**代价**：小；主要是导出时机与「谁负责写」要定清楚（建议只在批次结束时写一次）。

---

## 建议的落地顺序

这三个做完，本类 bug 从根上不会再出现；其余是加固。

| 顺序 | 方案 | 为什么先做 |
| --- | --- | --- |
| 1 | 方案 1：明写产出边 | 消掉「两套算法」，是本次 bug 的直接解 |
| 2 | 方案 2：一个事务写两边 | 消掉「落盘不完整」这个已确认的根因 |
| 3 | 方案 4：对账作业 | 让**已经存在**的历史脏数据能被修好并看见，而不是静默消失 |
| 4 | 方案 5 / 6 / 9 | 防止新的「派生数据参与判定」「内存决定可见性」重演（TB-106 同族） |
| 5 | 方案 3 / 7 / 8 / 10 | 长期加固，可在各自触发点分批做 |

---

## 参考来源

- Immich：`asset` / `asset_file` / `asset_job_status` 表设计、Kysely upsert、checksum 去重、软删状态机
  （`server/src/repositories/asset.repository.ts`、`server/src/schema/tables/*`）
- PhotoPrism：`Photo`（逻辑）/ `File`（物理）分离、YAML/JSON sidecar 作为「库丢失后的恢复路径」、
  denormalized 搜索索引（`internal/entity/photo_yaml.go`、`internal/entity/file_fixtures.go`）
- InvokeAI：SQLite 事务 + 迁移系统 + 迁移前备份 + `use_memory_db` 测试模式（`docs/features/DATABASE.md`）
- Hydrus Network：模块化 ClientDB、读写 job 队列、维护队列、`Vacuum Into`（`hydrus/client/db/ClientDB*.py`）
- tldraw：`Scope`（document / session / presence）、`StoreSchema` 记录级迁移（支持 down）、`onValidationFailure`
- Excalidraw：`serializeAsJSON` 的 local/database 两种口径、Data Restoration（加载时修复 binding 与版本迁移）
- Eagle：一张图一文件夹 + `metadata.json`，文件夹归属为虚拟 folder id 列表；内容重复扫描
- digiKam：core / thumbnail / similarity / face 四库分离，XMP sidecar 互操作
- darktable / Lightroom：编辑历史自动镜像到 XMP（darktable）vs 中央 catalog + 可选 sidecar（Lightroom）
- A1111 WebUI：PNG 内嵌生成参数（文件即记录，gallery 靠扫描目录）
