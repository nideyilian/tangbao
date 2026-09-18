# 糖包（TANGBAO）

> **本文件是索引与铁律，不是知识本体。** 超过 10KB 就说明内容放错了层。
> 2026-09-17 从豆泡拆出（历史 `D:\AAA\DOUPAO\.workbuddy\memory\`）；
> 2026-09-18 分层重构：细节迁出到下表各文件，本文件只留指针与不可违的铁律。

## 文档地图（先看这里）

| 要什么 | 去哪 |
| --- | --- |
| 现在交付什么、什么算完 | `docs/ROADMAP.md` |
| 在做什么、卡在哪 | `docs/BACKLOG.md` |
| 为什么不那么做 | `docs/adr/` |
| 哪些坑不能踩（R/P/Q 分级） | `docs/RISK.md` |
| **哪些设计勿改回** | `docs/architecture-constraints.md` |
| 操作配方（持久化/验收/抓报错/推 GitHub/写 localStorage） | `docs/tangbao-ops-runbook.md` |
| 哪份文档还算数 | `docs/README.md` |
| AI 开工/收工规范 | `AGENTS.md` 的「项目管理（开工前必读）」 |
| 过程记录 | 同日 `YYYY-MM-DD.md` |

## 身份 · 构建 · 发布

- `tangbao` 0.1.x / appId `com.cooksleep.tangbao` / exe `Tangbao`。
- userData：正式版 `%APPDATA%\糖包`，dev `%APPDATA%\tangbao`。
- 状态落盘 = SQLite `local-saves/db/asset-kernel.sqlite` 的 `app_data_records`。
- 糖包 = 主线，豆泡 = 维护；两仓**无共享 git 历史** → 只能 `fetch` + `cherry-pick`。
- **`vite build` 必须 Node 24**（Node 22 报 `DatabaseSync` 未导出）。
- `npm run verify` ≈ 3–4 分钟（tsc 双端 + lint + format + 全量测试）。
- **改完源码必须 `npx prettier --write`**，否则 `format:check` 会挂（连 `AGENTS.md` 也要过 prettier）。
- `release.yml` **勿**改回 `--publish always`（exe 超时）。

## 铁律（数据安全级 —— 违反会不可逆丢数据）

| 铁律 | 详见 |
| --- | --- |
| **禁用 `git rm`**（曾让 `src/` 576 文件消失）→ 用 `rm` + `git add -A` | R-02 |
| **同一文件多条 Edit 必须串行**（并发只最后一条生效）；改完回读校验 | R-17 |
| **删文件三查**：grep import / grep 字面量 / grep `readFileSync` | R-18 |
| **手改 `app_data_records` 三铁律**：① 编码按 namespace（zustand 型双重 / 记录型单层）② 写库必须带 `record_id` 条件 ③ 停应用 + 备份 + 改完全库体检 | R-04 / R-05 |
| 读 SQLite 基线一律 `readOnly: true`（残留 WAL 未 checkpoint 会读到 0 条） | R-06 |
| **写盘/配置相关改动先备份**：`scheduleApiSecretsPersist` 会连真 Key 一起抹掉 | R-03 |
| **同仓禁止并行开两条工作线**（HMR 互撞 / 41731 与单实例锁互抢） | R-01 |
| **提交前只 add 本轮文件，禁止 `git add -A`**（工作区常挂另一条线的改动） | R-09 |
| `Bash` 工具会吃 `\\`、`${}`、改写 `/c/...` → 脚本用 Write 落盘再 `node "C:/…"` | R-19 |

## 高频入口（细节见 `docs/architecture-constraints.md`）

- **性能**：高频进度走 `runtimeStore`、SQLite 走 UtilityProcess、缩略图 `canvasToWebpDataUrl`、
  整图字节优先（新代码**勿传 dataUrl**）→ 改编码路径必须用 **rAF 帧探针**验收，不能比总耗时。
- **生图编排**：普通 SOP = 1 条、系列 = 1 组（3 段拆 3 条），互不套用；守卫用字面量断言。
- **`tangbao://image/`**：只能进 `<img src>`；要像素走 `ensureImageCached`；
  `fetch('tangbao://…')` 被 CSP 拦是**刻意的**，别加 `connect-src`。
- **后处理/项目树**：一棵树（`collections`）四模块共用，不另建树；`undefined` = 继承、空值 = 显式覆盖；
  勾选 = 启用范围，产出目标 = 图片归属方向；`byMedia` 只开 `outputDir` 与 `watermarkPresetIds`。
- **素材命名/排序**：命名唯一实现 = `lib/generatedImageFilename.ts`；排序键加一项必须**同时改内存
  `compareAssets` 与桌面端 SQL 分页**（只改前者会让第一页顺序错乱）→ §9。
- **持久化**：`createDesktopJsonStorage(ns)` 是全仓唯一落盘入口；
  **新增 store 忘配白名单 = 完全存不住而 UI 不报**；读失败 → 降级态拒绝写盘。
- **任务数量不一致** = 落盘不完整（`tasks` vs `assets`），**别去查加载链**。
- **`InputBar` 的 prompt 是双写**：程序性改写必须先 `isUserInputRef.current = false`。
- **抓渲染进程报错**：`ELECTRON_ENABLE_LOGGING=1 npm run dev`。
- **门禁假象**：`noUnusedLocals/Parameters` 关着、`no-unused-vars` 仅 warn → 死 import 零告警
  （存量 116 处，见 `BACKLOG.md` TB-021）。
