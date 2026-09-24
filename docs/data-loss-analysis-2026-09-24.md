# 糖包数据丢失场景分析（2026-09-24）

> **定位**：本文件按「丢失发生在哪个环节」组织场景与判据，是**分析**不是登记册。
> 条目级风险登记（谁负责、状态、缓解动作）仍以 `docs/RISK.md` 为唯一真相源；
> 架构侧「勿改回」清单在 `docs/architecture-constraints.md`。
> 覆盖范围：只读排查，未改任何源码。

## 结论先行

按「真的会不可逆丢数据」排序，只有下面四条属于**没有任何补偿手段**的：

| 级 | 场景 | 判据（文件:行号） | 为什么没有兜底 |
| --- | --- | --- | --- |
| **A** | **突然断电 / 硬复位丢最近已提交事务** | `electron/asset-catalog.ts:197`：`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL` | WAL+NORMAL 下 SQLite 不保证每个事务 fsync。**进程崩溃不丢**（WAL 帧已在文件系统），**断电才丢** —— 且这不是 bug，是性能取舍，代价是「最近若干次已提交写入可能回退到上一次 checkpoint」 |
| **A** | **退出时渲染层待写不冲刷** | `src/lib/coalescedJsonStorage.ts:27-28`（400ms 防抖 / 1.5s 重试）+ 全仓 `flush()` **零生产调用点**（只出现在 3 个 `.test.ts`）；`electron/main.ts:614-623` 的 `before-quit` 只等 SQLite 关闭 | 关窗 → 渲染进程销毁 → 未 postMessage 的那次写**永远发不出去**。`before-quit` 等的是 worker，不是渲染层的待写队列 |
| **A** | **删除即永久删除** | `docs/adr/0021`、`RISK.md` R-105；底层 `moveToTrash`/`restoreAssets` 保留实现但**已无 UI 入口** | 无回收站、无 Ctrl+Z。四个删除入口（卡片右键 / Delete / 大图查看器 / 重复素材弹窗）+ 删任务卡全走真删 |
| **A** | **整份替换 + 静默过滤 = 静默删除记录** | `src/lib/db.ts:428-439`（`filter(v => typeof v.id === 'string')`）+ `electron/app-data-store.ts:103-113`（`replace` = 先 `DELETE FROM app_data_records WHERE namespace=?` 再逐条插入） | 传进 `replace` 的数组里**只要有一条没有字符串 id，它会被删掉且不写回**，全程不报错。当前唯一调用点是 Agent 会话（`db.ts:635`） |

其余场景都有守卫或补偿，但**补偿本身会失效** —— 下面按环节列。

---

## 一、读写时序

### 1.1 待写合并窗口（最高频的真实丢失）

`coalescedJsonStorage` 把连续 setState 合并成一次写：`pending` 被新内容**整体替换**（`coalescedJsonStorage.ts:52-62`），只有最后一版落盘。

- **窗口**：最后一次改动后 **400ms** 内进程结束 ⇒ 该改动不落盘。
- **放大窗口**：写失败时重试间隔 **1500ms**（`:28`、`:106`）。
- **写入途中再改**：`:85-95` 失败分支把失败版与新版合并时，**保留的是新版内容**（旧版内容被丢弃）—— 这是对的（写最新），但意味着「失败 → 重试」期间磁盘上可能长时间停留在更旧的版本。
- **无退出钩子**：`App.tsx` 只监听 `tangbao:persist-error` 做提示（`src/App.tsx:121`），没有 `beforeunload` 冲刷。

**判断依据**：`enqueue` 第 47 行 `content === lastWrittenContent` 才短路；否则进 pending。pending 只在 debounce 到期后 flush。

**验证方式**
1. 打开设置改一个开关 → **400ms 内**关掉应用 → 重启看是否还是旧值。
2. 代码级：`grep -rn "\.flush()" src/ --include=*.ts --include=*.tsx` → 应只见测试；若出现生产调用点，说明有人加过兜底。
3. 探针：在 `flushPending` 里打日志，复现上面动作，看进程结束时 pending 是否非空。

### 1.2 任务：先上屏、后落盘（两次重试 + 补偿日志）

`submitTaskWithData` 是「先 `setTasks` 上屏、再 `await putTask` 落盘」（依据：`docs/audits/task-card-vanishing-2026-09-22/README.md` §二·五 B2）。落盘失败走 `persistTaskWithRetry`（`src/store.ts:5185-5208`）：**只重试 1 次**，两次都败则：

1. 打结构化日志（含 taskId / 状态 / 产出张数）；
2. 把**任务完整快照**写进补偿 journal —— `rememberFailedTaskPersist` → `src/lib/taskPersistJournal.ts`（上限 50 条，超出丢**最旧**的，`:32`、`:70`），下次启动重放。

**仍会丢的边界**：补偿清单本身也走落盘（`putMigrationJournal`），**库整体写不进去时它同样写不进**（`:5164-5174` 的 catch 只打日志）。即「库坏了 → 任务和补偿记录一起丢」。
另外清单超 50 条时丢最旧的（`:32`）—— 那正是「更可能是已完结、留不住」的那些。

**验证方式**：`app_data_records` 里 `namespace='tasks'` 条数 vs 界面卡片数；再查 `migrations` journal 里的 `pending-task-persist-v1` 是否非空。反向验证：把 `persistTaskWithRetry` 的第二次尝试去掉，守卫测试应变红。

### 1.3 素材落盘：文件与记录两条链，顺序不同后果不同

- **原图字节**：`cache-images/<sha256>.<ext>`，文件名 = 内容哈希。
- **工作区命名副本**：优先**硬链接**指向同一物理文件（`src/store.ts:760-767`：`linkImageToLocal`，不可用时才写字节副本）。硬链接的好处是「删一个入口不影响另一个」；代价是**同一物理文件被多处引用**，按路径删文件时要意识到它可能还有别的入口。
- **落盘幂等**：`saveTaskImagesToLocalFSNow` 用 `${imageIndex}:${imageId}` 作键跳过已存过的（`:744-746`），所以流式到达 / 完成补存 / 恢复重跑不会重复写。

**风险点**：这条链是「先有图字节（内存/dataUrl）→ 写盘 → 再 `markTaskOutputImagesSavedToLocal`」。中间崩溃 = **图在磁盘上、任务记录里没有这条路径** → 卡片看不到「已保存到本地」。文件不丢，但**用户视角是丢了**（没有任何界面提示）。

**验证方式**：写盘前后各查一次 `tasks` 记录里 `localSavedOutputImagePaths` 的键数；或数 `images/` 工作区目录里的文件数 vs 记录里的路径数（多出来的就是「写成功但没记账」）。

### 1.4 永久删除的顺序契约（assetPurge）

`src/lib/assetPurge.ts:195-227` 的注释写死了顺序：

```
取走磁盘路径（必须最先）
  → purgeRecords（删素材记录 + 写墓碑）
    → 删图片字节记录（分块）
      → 按**事先取好的**路径删磁盘原图
```

**为什么必须这个顺序**：`purgeRecords` 之后按图记录已经查不到 `localPath`。

**崩溃窗口**：

| 崩在哪 | 后果 |
| --- | --- |
| 记录已删、字节/文件未删 | 图**不可见**了（用户视为已丢失），磁盘上留下**永久孤儿文件**（再无人引用，`library-integrity` 只能报 `orphanFiles`） |
| 文件删除失败（Windows 杀软/索引器占用 → `EPERM`/`EBUSY`） | 同上，且**不会报错**（`deleteImageFiles` 的失败没有上报路径） |
| 反序（先删文件） | 记录指向不存在的文件 = 界面有卡、图打不开 —— 所以这个顺序是刻意的 |

**验证方式**：`runLibraryIntegrityCheck`（`electron/library-integrity.ts:43`）读 `orphanFiles` 与 `missingFiles` 两个数组。**注意抽查上限 100 张**（`:35`），大库要分批或提高上限。

### 1.5 分发（move）之后的路径回写

分发**恒定 move**（`src/lib/postprocessDistribution.ts:512`），目标已存在时追加 `-2/-3` **绝不覆盖**（`:290`、`:508`，「覆盖等于源文件永久丢失」）。分发完成后由 `distributePostprocessOutputs` 把 `output.path` 跟着搬（`src/features/postprocess/taskPostprocess.ts:598-630`，注释原文：「漏掉的后果是产出记录指向不存在的文件（重跑判定与「打开文件」一起失效）」）。

**仍会失效的地方**：方向历史里存的是**快照**（`architecture-constraints.md` §4.4.3）—— 若历史条目在分发**之前**落盘，它的输出目录就指向搬走前的位置，界面上表现为「打开输出位置」失效。这不是数据丢失，但**和丢失无法区分**。

**验证方式**：查历史条目里的输出目录 vs 磁盘实际位置（`store.ts` 启动时有 `authorizeHistoryOutputDirs` 重新放行目录，见 §三.3）。判据：**「昨天还能打开、今天点不动」先怀疑白名单（R-95），不怀疑文件没了**。

### 1.6 换保存目录：先改配置、再改路径

`migrateLocalSaveRoot`（`src/store.ts:6578-6599`）：复制 cache-images → 生成 mappings → 校验「没有落在新根之外的历史图」→ `setLocalSavePath(newRoot)` → `updateImageLocalPaths(mappings)`；**后者失败则回滚 root 并抛错**。

**窗口**：`setLocalSavePath` 已写盘、`updateImageLocalPaths` 未完成时崩溃 ⇒ **配置指向新根、记录仍指旧路径**。此路径无补偿。

**验证方式**：迁移后核对 `images` 记录里的 `localPath` 是否都落在新根下（`getAllLocalImagePaths` 的判据就是这条，`:6586-6590`）。

---

## 二、异常与中断处理

### 2.1 读失败 → 降级态 → 整会话拒写（保护，但有副作用）

`src/lib/desktopJsonStorage.ts:56-64, 126-127`：读 IPC 抛错、或记录存在但格式不认识 → `degraded = true`，**`setItem` / `removeItem` 直接 return**。

- 设计意图正确：宁可本次会话改动不落盘，也不允许用初始 state 覆盖磁盘真实数据（2026-09-18 整份 `settings` 被重置成出厂默认事故的直接对策，见文件头注释）。
- **副作用**：降级期间**用户的所有改动都不落盘**，界面只有一条「persist-error」提示（`:24-32`，`App.tsx` 收）—— 用户很容易忽略，然后关掉应用，**这一整段时间的改动全丢**。
- **降级是内存态**，重启自动解除（`degradedNotified` 也是）—— 即「重启就好了」，但已经丢的改动回不来。

**验证方式**：故意让 `appDataGet` 抛错（或在探针里改 namespace 名）→ 改设置 → 重启 → 设置回到旧值且**无任何持久提示**。

### 2.2 catalog worker 退出：在途写被 reject 或被重放

`electron/catalog-client.ts:87-124`：worker 退出时

1. 取出所有在途调用，**500ms 后自动重启** worker；
2. 重启成功后**把这些调用原样重发**（`:110-114`）；
3. 重启失败 / 被换代打断 → 逐个 `reject('asset catalog worker restarted' / 'unavailable')`。

**两个方向都可能丢**：

- **reject 方向**：写请求失败。zustand 那条链有 1.5s 重试（§1.1）；`putTask` 那条链有 journal 补偿（§1.2）；**其余直接调 `appDataPut` 的路径没有重试**（要按调用点逐条确认）。
- **重放方向**：worker 可能**已经执行并提交**了该请求，只是响应没回到主进程（`catalog-worker.ts:80-89` 是同步执行 → `postMessage`，中间崩就是这种）。重放对 `upsert` 无害，但对**非幂等写**（追加型：`putUsageEvents`、`putTombstones`）会重复写入。→ **这是「重复」不是「丢失」，但会让计数/用量对不上。**

**验证方式**：`electron/catalog-client.test.ts` 已有覆盖；实测思路是在 worker 的 `method.apply` 之后、`postMessage` 之前 `process.exit()`，看主进程是否重发、库里是否多一条。

### 2.3 看门狗超时 → 迟到的真实结果变孤儿（R-22）

任务被看门狗提前标终态，但请求还在飞。三处 `status === 'running'` 守卫必须走 `canSettleTaskOutputs` 放行（`watchdogTimedOutAt` 标记），否则**迟到的结果既不进任务卡片也不进素材库**。

`architecture-constraints.md` §六已经把这条列为**已知且已缓解**；但它是「丢失」而不是「报错」的典型 —— 用户看不到任何异常。

### 2.4 崩溃在「请求已发出、回执未收到」（R-103，已知并接受）

批量编排中**没拿到远端 ID** 的请求，重启后被退回 `pending` 并**重新发请求**（`src/store.ts:10302-10334`）⇒ 服务商侧可能已计费，糖包再发一次 = **重复计费**。杰哥 2026-09-24 明确决定保留现状。**这不是数据丢失，是钱**，但同属「中断窗口」家族。

### 2.5 API Key：写盘被重置会连真 Key 一起抹掉（R-03）

- 文件：`%APPDATA%\<产品名>\api-secrets.bin`；写法本身是**安全的原子替换**（`electron/secure-api-secrets.ts:39-59`：temp → 旧文件挪 .bak.swap → rename 就位 → 清备份；清理动作一律降级为告警，因为 Windows `EPERM/EBUSY` 会让整个保存永久失败）。
- **风险不在写法，在触发条件**：`scheduleApiSecretsPersist` 随 settings 变化重写该文件 ⇒ **settings 一旦被重置为该 namespace 的默认值，真 Key 跟着被抹掉，不可逆**。
- **判据是文件字节数**，不是状态里的 `apiKey`（后者恒为空串是正常的）。
- 附带面：`scrubLegacyStateFiles`（`:155-166`）会**重写**旧 `tangbao.json` 及其 `.bak`（目的是清理残留 Key）—— 对旧文件的这次重写同样走 `replaceFile`。

**验证方式**：`ls -l api-secrets.bin` 记字节数 → 在设置里做一次「重置为默认」→ 再看字节数（正常约 302B；被抹后 282B → 205B）。**动之前先备份该文件。**

### 2.6 渲染进程反复崩溃时的退避

`electron/renderer-crash-recovery.ts:8-18`：60s 窗口内 ≥3 次崩溃 → **不再自动 reload**。此时**未落盘的改动就停在那儿**（没有任何机制把它们冲出去）。

---

## 三、持久化与同步

### 3.1 单库单点，且没有周期性备份

- 权威状态 = `local-saves/db/asset-kernel.sqlite` 的 `app_data_records`（`electron/app-data-store.ts:15`）+ `assets`/`collections`/`tags` 等表。
- `backups/` 目录（`electron/library-paths.ts:76`）服务于**配置同步与库搬迁**，**不是 SQLite 的定期快照**。
- 图片字节是内容寻址，**可重建**（`docs/asset-kernel.md`：machine index 可删可重建）；**但任务/素材/项目树/水印这些元数据不可重建**。

⇒ **DB 损坏 = 元数据全失**，图片文件还在磁盘上但没人知道它们属于谁。这是全系统最大的单点。

**已有的检测**：`runLibraryIntegrityCheck`（只读、`PRAGMA integrity_check` + 抽查 100 张哈希 + 孤儿/缺失），以及启动迁移里的同一检查（`electron/catalog-migration.ts:38-44`，「完整性失败则保留旧文件并继续用旧路径」，`:65-68`）。

**注意**：检测 ≠ 恢复。**目前没有「从检查结果自动修复」的路径**，也没有 DB 快照可回退。

### 3.2 落盘白名单漏登记 = 完全存不住且不报错（R-07）

`electron/asset-kernel.ts:37-59` 的 `APP_DATA_NAMESPACES`。新增 store 忘了加 → 主进程 `appDataNamespace()` 直接抛 `invalid app data namespace`（`:62`）→ 写失败 → 按 §1.1 重试到永远。由 `src/lib/appDataNamespaceContract.test.ts` 守。

### 3.3 只在新会话里失效 ⇒ 先怀疑内存态白名单（R-95）

`sessionAllowedRoots` 是主进程内存 `Set`，**重启即清空**。`store.ts` 的 `authorizeHistoryOutputDirs` 在 `initStore` 第一句把「历史里真的写出过文件的目录」重新放行。少了这一步，「打开输出位置」会在重启后报「路径不在允许范围」。**刻意不放行配置里写的那条**（可能只是手滑打错的路径）。

### 3.4 配置同步：单向覆盖，靠「备份失败就中止」兜

`architecture-constraints.md` §十：发布文件名带时间戳（字典序 = 时间序）；**拉取 = 单向覆盖，拉之前先备份本机配置，备份失败就中止**；备份在本机 `backups/`，包里**不含 API Key**。

**残留风险**：覆盖是单向的 ⇒ **如果本机有、远端没有的配置项，拉取后消失**（这是语义而非 bug）。以及包结构版本不认识时**整包拒收**（不做猜测性解析）—— 拒收是安全行为，但用户会以为「同步没生效」。

### 3.5 两种编码并存（R-05）

zustand 型 = **双重编码**（`appDataPut` 存的已是 `JSON.stringify(value)` 的结果，见 `desktopJsonStorage.ts:34-50` 文件头说明）；记录型（`appDataPut`）= **单层**。手工写库或新增读库代码用错 ⇒ 数据变字符串 ⇒ 下游 `.filter` 崩。

**判据**：写前 `typeof JSON.parse(row.json)` 判一次。

### 3.6 「卡片数 ≠ 素材数」不等于丢数据（易误判）

卡片数来自 `tasks` 记录（`putTask` 整条覆盖写），素材数来自 `assets` 逐条 upsert（`architecture-constraints.md` §六）。两者不一致确实代表落盘不完整，**但 2026-09-22 的实测表明更多时候是「可见性窗口」问题**：`hydrate()` 只灌最新 200 条，卡片可见性 = SQL 分页结果 ∩ 内存缓存 —— 479 张里有 279 张长期落在窗口外（`docs/audits/task-card-vanishing-2026-09-22/README.md` §二·六）。

⇒ **判据顺序：先查库确认条数，再谈「丢」**（`PLAYBOOK.md` 的「有库可查时：查库 > 读代码 > 猜」）。

---

## 四、并发访问

### 4.1 渲染进程内：只有一把锁，覆盖面很窄

`src/lib/assetWriteLock.ts` 的 `withAssetWriteLock` 只解决「purge 与素材同步队列」之间的 TOCTOU（防已永久删除的素材被旧墓碑快照「复活」）。**其余写路径靠 SQLite 事务本身**（`app-data-store.ts` 每个写方法都是 `BEGIN IMMEDIATE` + `COMMIT` / `ROLLBACK`，原子性有保证）。

### 4.2 顺序倒置：后到的旧快照覆盖新值

`putTask` 是**整条覆盖写**。`catalog-client` 的「退出重放」（§2.2）或任何延迟到达的写，都会把**较旧的快照**盖在较新状态上。因为进程内单线程 + 消息串行，日常不会撞；**但重放路径恰好打破了「发出顺序 = 执行顺序」这个前提**。

**验证方式**：构造「写 A → 写 A' → 让第一次的响应延迟到第二次之后」，检查库里最终是哪一版。这是当前**没有守卫测试**的一条。

### 4.3 多方向并行后处理（2026-09-23 起）

同一批次内每个产出方向一条独立 run，并发上限 = `ApiProfile.maxConcurrent`（默认 5），超出**排队**（`PostprocessRun.status === 'queued'`）。已针对性加的守卫：

- **写盘路径先占位再查盘**（`reservedOutputPaths` + `reserveIfAvailable`）—— 否则两个方向共用同一输出目录时会双双查到「不存在」然后互相覆盖（`architecture-constraints.md` §4.7）。
- **认领幂等键必须带方向**（`taskId:direction:imageId`）且**先判方向是否在跑、再认领** —— 先认领会白白吃掉幂等键，那批图之后**再也产不出来且完全不可见**（同上）。
- **同一方向同时最多一条**（新来的按 `PP-RUN-001` 跳过）。
- **分发收敛成一次**（`deferDistribution` + `mergePendingPostprocessDistribution`）—— 各方向各分发一次会让「同一素材跨渠道落同一天」这个性质静默消失。

### 4.4 实例级并发

单实例锁 + leveldb 独占（R-01）。**例外**：MCP stdio 进程（`--asset-mcp`）**刻意豁免单实例锁**，但它只读 SQLite / 走 REST，不写库（`docs/asset-kernel.md`）。

**同仓两条写线**是另一回事：41731 固定端口 + 单实例锁 + leveldb 独占 = 排他资源，必须用 `git worktree` 隔离（R-01 / `docs/work-protocol.md`）。

### 4.5 同库多连接：只读直查的坑（R-06）

有**残留未 checkpoint 的 WAL** 时，用读写连接打开去读基线**可能读到 0 条**（未 checkpoint 的帧不可见）⇒ 会把「合并」做成「覆盖」。

**规则**：只读直查一律 `readOnly: true`（`electron/library-integrity.ts:54` 就是范例）。

---

## 五、边界条件

| # | 边界 | 行为 | 依据 |
| --- | --- | --- | --- |
| 5.1 | 记录缺字符串 `id` | **静默丢弃**（`filter`），`replace` 语义下等于删除 | `src/lib/db.ts:396-407`、`:428-439` |
| 5.2 | 值里含 `Blob` / `ArrayBuffer` / TypedArray | **抛错拒写**（宁可写不进也不静默丢字节） | `electron/app-data-store.ts:290-294`；注释记录了当年「复合资源整批损坏」的成因 |
| 5.3 | `id` 为空串或 > 512 字符 | 抛 `invalid app data id` | `electron/asset-kernel.ts:66-69` |
| 5.4 | 序列化结果为 `undefined` | 抛「无法序列化应用记录」并回滚事务 | `electron/app-data-store.ts:255-269` |
| 5.5 | 磁盘满 / 文件被占用（`EPERM`/`EBUSY`） | 写：重试 1.5s（§1.1）；**删文件：静默失败**（§1.4） | — |
| 5.6 | 二进制经非守护路径落盘 | 会**静默变 `{}`** —— 所以所有落盘必须走 `assertJsonSerializable` 那条链 | `electron/app-data-store.ts:284-289` |
| 5.7 | 跨盘 `rename`（`EXDEV`） | 回退「复制 + 删源」；**复制成功、删源失败** ⇒ 两份都在（安全方向） | `electron/ipc-handlers.ts:1100-1114` |
| 5.8 | 补偿清单超 50 条 | 丢**最旧**的 | `src/lib/taskPersistJournal.ts:32,70` |
| 5.9 | 迁移标志位已置但数据只写了一半 | 重启不再导入 ⇒ 旧文件还在但永不读入 | `electron/legacy-data-migration.ts`（有 `.corrupt-` 重命名与 `.bak` 回退，`:226`、`:293-332`） |

---

## 六、统一验证方法（可执行）

**① 库级体检（只读，任何怀疑「丢了」之前先做这一步）**

```bash
# 一律 readOnly，避免残留 WAL 读到 0 条（R-06）
python -c "
import sqlite3
db = sqlite3.connect('file:.../local-saves/db/asset-kernel.sqlite?mode=ro', uri=True)
print('tasks    ', db.execute(\"select count(*) from app_data_records where namespace='tasks'\").fetchone())
print('assets   ', db.execute(\"select count(*) from assets where status='active'\").fetchone())
print('orphan   ', db.execute('''select count(*) from assets a where a.status='active' and not exists
        (select 1 from app_data_records t where t.namespace='tasks' and t.json like '%'||a.id||'%')''').fetchone())
"
```

**② 崩窗口演练**：在写盘前后插探针（`console.error` 带 taskId / imageId），复现 §1.2 / §1.3 / §1.4 / §1.5 各一次，看哪一步的后半段没发生。

**③ 退出时序演练**：改动设置后分别在 100ms / 500ms / 2s 关掉应用，比较重启后的值 —— 能直接量出 §1.1 的窗口大小。

**④ 断电演练**（唯一能验证 A 级第 1 条的方法）：在写入密集时**硬断电/长按电源**（不要正常关闭），重启后看最近若干条记录是否回退。**做之前在另一台机器或副本上做。**

**⑤ 反向验证**：本仓惯例 —— 撤掉修复（或把守卫改回旧行为）后跑守卫测试，必须**精确红在目标用例上**（`RISK.md` R-85 / R-99 的反向验证手法）。

---

## 七、建议登记（待杰哥拍板）

以下三条目前**没有**在 `RISK.md` 里独立成条，建议补登记：

1. **`synchronous=NORMAL` 的断电容灾等级**（§A-1）—— 需要明确「接受」还是「改成 FULL」。改成 FULL 的代价是每次提交都 fsync，写入吞吐下降（本仓有 `docs/data-persistence-benchmark.md` 可作基线）。
2. **退出时不冲刷渲染层待写**（§A-2）—— 修法可以是 `before-quit` 里先让渲染进程 flush 一次再关（`CoalescedJsonStorage.flush()` 接口已经现成）。这是**低成本、直接消掉一条 A 级**的改动。
3. **`replace` + 静默过滤**（§A-4）—— 建议至少把 `filter` 改成「丢弃前打日志」，`replace` 路径的丢失就从静默变成可见。

其余场景都已有缓解，只是**缓解手段本身也有失效边界**（已在正文逐条标出）。
