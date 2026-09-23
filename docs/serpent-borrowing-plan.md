# 参考 Serpent 的素材库加固方案

- **日期**：2026-09-23
- **来源**：`https://github.com/dolag233/Serpent`（MIT；Electron + TypeScript + better-sqlite3 的开源数字资产管理软件，v0.2.7，面向游戏美术 / VFX / 设计师，竞品 Eagle / Billfish）
- **性质**：**方案**（只出方案与可测验收标准，未改任何代码）
- **相关**：`docs/asset-kernel.md`、`docs/architecture-constraints.md`（五章 持久化 / 六章 落盘完整性）、`docs/RISK.md`（R-04 / R-05 / R-99）、`docs/eagle-interaction-gap-analysis.md`
- **背景**：杰哥提出"把 Serpent 嵌入糖包、替换现有素材库模式"，两轮调研已收口（见「一」）。本方案只保留其中**值得抄的工程纪律**。

---

## 〇、结论先行

**不嵌入（两个方向都不成立），只抄三条纪律 + 核实一条。**

| 优先 | 项                                           | 一句话                                                             | 改动面                |
| ---- | -------------------------------------------- | ------------------------------------------------------------------ | --------------------- |
| P1   | **任务中断要有明确语义**                     | 应用崩了，半截任务既不能被静默重跑，也不能静默消失                 | 中（任务落盘 + 界面） |
| P2   | **数据库升级要有版本号 + 顺序迁移链**        | 现在靠"逐列探测"，只加列能跑；改语义 / 回填 / 重建索引就没地方挂   | 中（`asset-catalog.ts`） |
| P3   | **「老库能不能打开」变成发版必跑的门禁**     | 体检能力已经有了，但它现在只是设置页里一个手动按钮                 | 小（测试 + `verify`） |
| P4   | 派生数据可整体重建                           | **已核实达标**：`thumbs/` 可整目录删除、由原图自动重建             | 无（不需要动作）      |

**明确不采纳**：WebDAV 云同步、插件系统、多资源库、视频/音频/3D 预览、以及"整体替换素材库"本身（逐条理由见「三」，避免以后再讨论一遍）。

---

## 一、为什么是"抄纪律"而不是"抄代码"（前两轮调研的收口）

**方向一（Serpent → 糖包）不成立**：Serpent 是完整应用不是库（`package.json` `private: true`、electron-forge 六套 Vite 入口、无 SDK 入口）；它的 MCP 是"自身内嵌的 loopback 服务"，必须 Serpent 在跑且用户手动开启，等于同时装两个应用。

**方向二（糖包 → Serpent）同样不成立**：它确实有插件门（`unrestricted` 插件跑在独立 Node UtilityProcess，有 fs / 网络 / 子进程），但**插件领域词汇表只有 assets / folders / tags / collections / metadata / jobs** —— 没有"任务队列 / 工作流 / 生成"这类概念，糖包的生图流水线无法用它表达；插件界面是 sandboxed iframe，塞不进糖包那整套界面。而且糖包自身没有任何插件机制（`grep -ril plugin electron/ src/lib/ src/features/` 零结果），两边都没为"被嵌入"设计过。

**真正的差距不在架构，在"数据安全纪律"。** 糖包的素材内核架构已经和 Serpent **同构**，最典型的一处：

> Serpent 的核心不变量是"Library Worker 独占 SQLite 与文件操作，Main 不碰数据库"。
> 糖包已经做了 —— `electron/catalog-worker.ts` 就是那个 UtilityProcess，注释原文：
> "素材目录 SQLite 的独立事件循环（UtilityProcess）…… AssetCatalog 使用 `node:sqlite` 的同步 API（`DatabaseSync`），若直接跑在主进程会阻塞。"

所以不需要再抄架构。**需要抄的是它把"库能不能打开"当成发布级底线的那套做法。**

---

## 二、逐项方案

### P1 · 任务中断要有明确语义 ⭐ 优先级最高

**问题**

糖包有批量生图、后处理跑批、分发排期，任务卡是核心界面。但**应用在一个任务跑到一半时被关闭或崩溃，重启后这条任务算什么状态，目前没有被定义过** —— 既没有定义成"完成"，也没有定义成"失败"，更没有一个被规定过的中间态。

这块正好是活跃改动区（`TB-121` 批次卡片成员改由任务记录决定、`TB-122` 落盘补偿清单、`TB-123` 反向对账），**现在定这件事最合时机**。

**Serpent 的做法（明确写死的规则，不是推断）**

- 后台任务必须声明恢复策略：`recovery: idempotent | checkpoint`；
- 应用退出 / 崩溃 / 会话结束时，仍处于 `queued` / `running` 的任务**被标记为 `interrupted`，绝不被静默执行**；
- 重启后必须由用户或调用方**显式重试**才重新入队；
- `interrupted` 是宿主状态，**任务自己不能伪造**这个状态；
- 配套的对外约定写得更直白：**"客户端超时 ≠ 操作失败 —— 先查执行状态，再决定要不要重试。"**

**糖包怎么做**

1. 任务记录增加中断态（`interrupted`，或等价的一次性结果字段）；启动时扫描"上次会话遗留的 `running` 任务"，改成中断态。
2. 界面上**显式露出来**（"上次没跑完 · 继续 / 放弃"），而不是让它挂在"进行中"或者干脆消失。
3. "继续" = 显式重新入队，且**产出计数按已完成槽位续算**，不重复产图。

**代价**

任务落盘结构加字段 → 需要一次迁移（正好会成为 P2 的第一批使用者）；界面多一个状态分支。

**可测验收**

- 跑到一半 `kill` 应用 → 重启后该任务是"中断"，既不是"进行中"也不是"已完成"；
- **不点"继续"，它永远不会自己跑**；
- 点"继续"后，已完成槽位的产图数不增加、不重复；
- 该状态在应用正常运行期间不可能出现（只有异常退出才会产生）—— 反向验证："正常跑完的任务绝不会变成中断"。

---

### P2 · 数据库升级要有版本号 + 顺序迁移链

**问题（证据）**

糖包的库升级现在是**逐列探测**，全部散在 `electron/asset-catalog.ts`：

- 建表用 `CREATE TABLE IF NOT EXISTS`（`asset-catalog.ts:153-248`）；
- 升级靠"看缺哪列就补哪列"：`PRAGMA table_info(assets)` → 缺 `file_name` 就 `ALTER TABLE assets ADD COLUMN`（`asset-catalog.ts:265-269`），`collections`、`tags` 同理（`asset-catalog.ts:305-321`），收口在 `ensureTagTreeColumns()` / `ensureCollectionExtraColumns()` / `ensureAssetSortColumns()` 三个函数；
- **数据库层没有版本号** —— 全仓 grep `user_version` 为空。已有的 `LIBRARY_LAYOUT_VERSION = 1`（`electron/library-paths.ts:23`）管的是 `db/thumbs/backups` **目录骨架**，不是表结构；
- 需要回填时靠 `catalog_meta` 打一次性标记防重复。`asset-catalog.ts` 的注释记录了真实代价：

  > 新增 `file_name` / `filename_batch` 两列时，存量行是 `NULL` / `0`，"**老素材会全部挤在同一端、看起来像排序坏了**"，
  > 所以要用一次回填补齐，并用 `catalog_meta` 标记防重复。

**代价（为什么值得改）**

"只加列"时逐列探测够用。但一旦要做**改语义 / 回填 / 重建索引 / 拆表**，就没有"该不该跑、跑没跑过"的统一判据 —— 只能靠每个功能"自己记得"打 `catalog_meta` 标记。漏一个，用户看到的就是"数据看起来坏了"（上面那条注释就是这个坑的实例）。

**Serpent 的做法**

`MIGRATIONS` 数组 + schema 版本号（当前 v33），按版本顺序执行。配套纪律两条：

- **"只加不改"**：禁止删改现有表 / 列 / 索引 / 触发器；
- **宽容读取**：新代码必须能打开旧库，缺列降级取默认值，不崩溃。

**糖包怎么做**

1. 库里存一个 schema 版本 —— `catalog_meta` 是现成的 KV 表（`asset-catalog.ts:243-246`），加一个 `schema_version` 键即可，不必引入新机制；
2. 把散落的 `ensureXxxColumns()` 收敛成一个**有序迁移数组**，每项 = `{ 版本号, 说明, 步骤 }`；
3. 打开库时比对当前版本 → 按序跑缺失项 → 跑完写回版本号（幂等）。

**可测验收**

- 造一个"缺 `file_name` 列 **且** 已有回填标记"的老库快照 → 新代码打开后列补齐、回填恰好一次、排序正确；
- 同一个库连续打开 10 次，迁移步骤不重复执行（幂等）；
- fixtures 里放 2~3 个历史结构快照，逐个打开都不崩。

---

### P3 · 「老库能不能打开」变成发版必跑的门禁

**问题（证据）**

体检能力其实**已经有了，而且做得不差**：`electron/library-integrity.ts`（123 行）只读连接跑

- `PRAGMA integrity_check`（`library-integrity.ts:56`，只读连接、WAL 下安全）；
- 抽查 100 个 `cache-images/` 原图重算 SHA-256 与文件名（=内容哈希）比对（`:95-104`，`INTEGRITY_SAMPLE_LIMIT = 100`）；
- 列出孤儿文件与缺失文件（`:105-111`）。

问题是它**只是设置页里的一个手动按钮**（`src/components/SettingsModal.tsx:1128` → `src/lib/libraryIntegrityCheck.ts:27` → IPC `electron/ipc-handlers.ts:1769`）。

而发版门禁 `verify` = `tsc -b && npm run typecheck:electron && npm run lint && npm run format:check && npm test`（`package.json`）—— **一条都不是"老库还能不能打开"**。现有测试里 `catalog-migration.test.ts` / `catalog-migration-rollback.test.ts` / `asset-catalog.test.ts` 覆盖的是迁移逻辑，不是"用真实旧版本库文件打开"的兼容矩阵。

**Serpent 的做法**

把资源库可用性列为**项目最重要底线**，单独一条 `test:library-availability`，覆盖 schema 兼容 / 降级链 / 宽容读 / 库恢复 / schema 失败 / 迁移纪律，相关改动**必须完整跑完**才允许发布。

**糖包怎么做**

1. 在 `electron/` 下加库兼容测试：fixtures 放历史结构快照，逐个打开并断言「不崩 + 数据条数不变」；
2. 挂进 `verify`（或加 `test:library` 子命令由 `verify` 调用）。

**代价**

fixtures 要维护 —— 每次改 schema 补一个快照。这是唯一成本，也是最值的地方。

**可测验收**

- 故意从 fixtures 库里删掉一列 → 打开不崩，且列自动补回；
- 故意写坏库文件 → 走降级态而不是白屏 / 崩溃；
- 上述两条在 CI 里能变红（反向验证：把兼容代码改回旧行为，测试必须失败）。

---

### P4 · 派生数据可整体重建 —— 已核实：达标，不需要动作

**现状**

糖包库骨架已经是 `cache-images/`（原图，内容寻址，文件名 = SHA-256）+ `thumbs/` + `db/` + `backups/`（`electron/library-paths.ts:74-75`，`ensureLibraryLayout` 见 `:122-128`）。**这已经和 Serpent 的 `Assets/` ↔ `.serpent/artifacts/` 同构。**

**要核实的一句**

`thumbs/` 是否**可以被整个删掉、然后由原图自动重建**？在 `electron/` 侧只找到 `mkdirSync`（`library-paths.ts:125`），没找到重建 / 清理逻辑 —— 缩略图的写入方可能在渲染端缓存（`thumbnailCache`）。

Serpent 的硬规则是：派生目录（缩略图 / 预览 / 代理）**可以整目录删掉重建**，且导出时默认排除它们，只导出托管资产 + 数据库 + 用户元数据。

**可测验收（若核实为"不能"）**

- 删掉整个 `thumbs/` → 重启后缩略图自动补齐、界面不出现破图；
- 全程 `cache-images/` 字节不变（派生可重建 ≠ 动源字节）。

**若核实为"能"** → 本项直接标"已达标"，不需要动作，只把这条写进 `docs/architecture-constraints.md` 免得以后被改回。

**核实结论（2026-09-23，代码级）**

`thumbs/` 可以整个删掉，并由原图自动重建。证据链：

| 环节         | 证据                                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计声明     | `electron/ipc-handlers.ts:439` 注释：磁盘缩略图缓存（库根 `thumbs/`，**可重建**；文件名含版本号，旧版本自动失效）                                                                                                                        |
| 目录会自建   | `writeThumbnailFile` → `ipc-handlers.ts:520`：目录不存在时 `mkdir(dir, { recursive: true })` —— 删掉整个目录也能写回去                                                                                                                  |
| 文件名带版本 | `ipc-handlers.ts:483`：`${id}.v${version}.webp`（grid 另有 `.grid` 后缀）→ 版本升级 = 整批自然失效                                                                                                                                      |
| 未命中会回源 | `src/lib/db.ts:901 getImageThumbnail`：磁盘 → IndexedDB → `getImage` 原图 → 现场生成 → `persistThumbnailToDisk` 写回<br>`src/store.ts:1858 startThumbnailLoad` 第 ④ 步注释：两处都没有 → 交给既有回填链路（**会从原图现场生成**） |
| 懒回填       | `src/lib/db.ts:859-866`：缩略图双写磁盘（**懒迁移**：生成/命中当前版本时按需回填库根 `thumbs/`，失败静默）                                                                                                                              |
| 不碰源字节   | 原图在 `cache-images/`、缩略图在 `thumbs/`，`getDiskStorageUsage` 分开统计（`ipc-handlers.ts:534-587`）                                                                                                                                  |

**比推断更硬的一条**：`THUMBNAIL_VERSION` 现在是 **5**（`src/lib/db.ts:64`），且 `db.ts:861` 的注释记录了历史事故 ——
"512→1024 升级就因此失效过"。**每次版本升级都会让全部缩略图文件名失效、整批走重建路径**，
这条链路已经被反复实战验证过，不是"设计上应该能"。

**边界（如实说明）**：以上是**代码级核实**，本机无法做渲染验证（见长期记忆"本机无法做网页渲染验证"）。
要在真机确认，只需把库目录下 `thumbs/` 整个删掉、重开应用，看网格是否逐步补齐。
预期：首次滚动有一波生成峰值（后台回填队列 `scheduleThumbnailBackfill` 带优先级），随后恢复正常，`cache-images/` 字节不变。

**建议写进 `docs/architecture-constraints.md`（"哪些设计勿改回"）的一句话**

> `thumbs/` 是可重建的派生缓存：**删掉整个目录必须能由原图自动重建**。文件名必须带 `THUMBNAIL_VERSION`（旧版本自然失效），写入前必须能自建目录。任何"把缩略图当权威数据"或"删了就不生成"的改动都属于回退。

---

## 三、明确不采纳的（附理由，避免重复讨论）

| 项                                       | 为什么不抄                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| WebDAV 云同步                            | 糖包已定"数据主权在本地、不引入云端依赖"（见 `reference-lingjing-asset-center.md` 第四节）   |
| 插件系统 / QuickJS 脚本运行时            | 糖包没有插件需求；已有的本地 REST API + MCP stdio 已覆盖"被外部驱动"的场景                   |
| 多资源库并存                             | 糖包多库是 P3 远期；单库更简单，且多库会带来跨库搜索 / 信任 / 同步一堆新问题                 |
| 视频 / 音频 / 3D / PSD / RAW 预览        | 糖包只产出图片                                                                              |
| **整体替换素材库**                       | 业务字段对不上：prompt / 生成参数 / seed / 来源任务 / 衍生链 / 后处理状态在 Serpent 无处安放 |
| 给 Serpent 写"糖包启动器"插件            | 要用户同时装两个应用；且绑在一个 0.2.7 项目的 dev 态 API 上                                  |
| "目录接口"互通（Serpent 链接文件夹 ← 糖包分发输出盘） | 技术上**零代码可行**，但**会丢业务字段**（Serpent 只看到文件名）。列为可选实验，不进方案 |

---

## 四、建议顺序与需要拍板的一点

**顺序**：先 **P3**（最小、纯测试、立刻可跑）→ 再 **P2**（同时成为 P1 的前置）→ 最后 **P1**。P4 先核实一句即可。

**要拍板的只有一件**：

> **P1「任务中断」现在定，还是等 `TB-121/122/123` 那条写线收工之后再定？**
> 它和那条线动的是同一片地方（任务落盘），现在动会撞车 —— 按本仓"同仓默认单写线"的规矩，建议**排队**，而不是并行。

---

## 五、证据索引

**糖包侧（本仓，已核对）**

| 位置                                     | 说明                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `electron/catalog-worker.ts:2-4`         | SQLite 独立事件循环（UtilityProcess），与 Serpent 架构同构        |
| `electron/catalog-client.ts`             | 主进程侧的异步客户端                                             |
| `electron/asset-catalog.ts:153-248`      | `CREATE TABLE IF NOT EXISTS` 建表                                |
| `electron/asset-catalog.ts:265-321`      | 逐列探测 + `ALTER TABLE ADD COLUMN` 升级（三个 `ensureXxx`）     |
| `electron/asset-catalog.ts` 注释         | `file_name` / `filename_batch` 回填与"看起来像排序坏了"的实例      |
| `electron/asset-catalog.ts:243-246`      | `catalog_meta` KV 表（可存 schema 版本）                          |
| `electron/library-paths.ts:23`           | `LIBRARY_LAYOUT_VERSION = 1`（目录骨架版本，非表结构）             |
| `electron/library-paths.ts:74-75,122-128`| `cache-images` / `thumbs` / `db` / `backups` 布局                  |
| `electron/library-integrity.ts`（全 123 行） | 只读体检：integrity_check + SHA-256 抽查 + 孤儿 + 缺失          |
| `src/components/SettingsModal.tsx:1128`  | 体检的**手动**入口                                                |
| `package.json` `verify`                  | `tsc -b && typecheck:electron && lint && format:check && test`     |
| `electron/asset-api-server.ts:51`        | 对外应用级命令仅 `getAppState` / `setPrompt` / `setParams`         |

**Serpent 侧（上游，来自官方文档与 `package.json`）**

| 依据                          | 说明                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `docs/developer/architecture.md` | 不变量：Renderer 无 Node、Main 不碰数据库、Worker 独占 SQLite + FS；`MIGRATIONS`，schema v33；"迁移只加不改 + 宽容读取" |
| `package.json` `test:library-availability` | 资源库可用性专项门禁（schema 兼容 / 降级链 / 宽容读 / 恢复 / 失败） |
| `docs/manual/plugins/development.md` §9 | Job 的 `recovery: idempotent \| checkpoint`；退出时 `queued`/`running` → `interrupted`，不静默执行，须显式重试 |
| `docs/manual/README.md` 共同约定 §3 | "客户端超时不等于操作失败 —— 先查执行状态，再决定是否重试"        |
| `docs/product-brief.md`        | 派生数据（缩略图/预览/代理）可重建、导出默认排除；资产模型字段清单    |
| `docs/developer/architecture.md` §数据层 | 资产存 `Assets/`，派生数据存 `.serpent/artifacts/`                  |

---

## 六、状态

**P3 / P2 / P4 已完成（2026-09-23）**，只剩 P1 待排期。

| 项  | 状态   | 落地证据                                                                                                                                                                                                    |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3  | 已完成 | 新增 `electron/asset-catalog-compat.test.ts`：老库能打开（缺列自动补齐 / 数据一条不丢 / 回填只做一次 / 坏 json 不崩 / 损坏库显式抛错而不是静默变空库）。vitest 用默认收集规则，该文件自动进 `npm test` → 自动进 `verify`，无需改配置。 |
| P2  | 已完成 | `electron/asset-catalog.ts` 引入 `CATALOG_SCHEMA_VERSION` + `CATALOG_MIGRATIONS`，原本散落的三个 `ensureXxx` 收敛为 v1；版本号写在 `catalog_meta` 表的 `schema_version` 键。**新库与老库走同一条链**，不存在两套结构定义。 |
| P1  | 未开工 | 与 `TB-121/122/123` 动的同一片区域（任务落盘），**建议等那条写线收工后再动**。                                                                                                                                |
| P4  | ✅ 已核实 | **达标，不需要动作**：`thumbs/` 可整目录删除并由原图自动重建（证据链见第二节 P4）。                                                                                                                                                          |

**验证证据**

- 主进程全目录：**203 / 204 通过**。唯一失败 `catalog-migration-rollback.test.ts` 的「目标已有同名文件」是**并发下的 5s 超时**（单独跑 3.645s 全绿）；该文件**不引用 `AssetCatalog`**（它测的是库目录搬家 `moveLibraryData`），与本次改动无关。
- 定向：`tsc -p electron/tsconfig.json --noEmit`、`eslint`、`prettier --check` 全过。
- **未跑全量 `verify`** —— 工作区混着另一条写线的 WIP（`src/design-system`、`src/features/assetLibrary`），跑了绿红皆不可信（详见 `RISK.md` R-74 的成因）。
- **未占 TB 号** —— `docs/BACKLOG.md` / `RISK.md` / `tangbao-ops-runbook.md` 当时仍被另一条写线占用，按"一个字节都别碰对方的文件"未登记。

**落地过程中确认的两个易踩点**

1. **建表 SQL 只含「基础结构」，后加的列全靠迁移链补** —— 所以"全新库跳过迁移链"是**错的**优化：新库会缺列（`table_name has no column named file_name`）。新库必须和老库走同一条链。（本次实现中真实踩到，由 `electron/asset-catalog.test.ts` 用 `:memory:` 暴露。）
2. **`AssetCatalog` 构造函数抛错时会泄漏 SQLite 句柄**（`new DatabaseSync(损坏文件)` 成功后 `PRAGMA` 才抛，实例拿不到引用、只能等 GC）→ Windows 上未释放句柄会让整个临时目录 `rmSync` 报 EPERM，表现为「用例全绿但 suite 判失败」。测试里需把损坏库用例隔离到独立临时目录。
