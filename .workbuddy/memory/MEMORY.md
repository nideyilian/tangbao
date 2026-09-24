# 糖包（TANGBAO）

> **本文件是索引与铁律，不是知识本体。** 超过 10KB 就是内容放错了层（09-18 分层重建，09-22／09-24 压缩）。

## 文档地图

| 要什么 | 去哪 |
| --- | --- |
| 交付什么、什么算完 | `docs/ROADMAP.md` |
| 在做什么、卡在哪 | `docs/BACKLOG.md` |
| 为什么不那么做 | `docs/adr/` |
| 哪些坑不能踩（R/P/Q） | `docs/RISK.md` |
| **哪些设计勿改回** | `docs/architecture-constraints.md` |
| 操作配方 | `docs/tangbao-ops-runbook.md` |
| 哪份文档还算数 | `docs/README.md` |
| 开工/收工规范 | `AGENTS.md` |
| 每日生成模块 | `src/features/dailyBatch/`（TB-108）· `design-system/tangbao/pages/daily.md` |
| 过程记录 | 同日 `YYYY-MM-DD.md` |

## 身份 · 构建 · 发布

- `tangbao` 0.1.x / appId `com.cooksleep.tangbao` / exe `Tangbao`。
- userData：正式版 `%APPDATA%\糖包`，dev `%APPDATA%\tangbao`。
- 状态落盘 = SQLite `local-saves/db/asset-kernel.sqlite` 的 `app_data_records`。
- 糖包 = 主线，豆泡 = 维护；两仓**无共享 git 历史** → 只能 `fetch` + `cherry-pick`。
- **`vite build` 必须 Node 24**（Node 22 报 `DatabaseSync` 未导出）；本机 `node` 默认 v22 →
  跑任何 npm 脚本都要显式提到 v24（R-59 / runbook §18.4；`start.bat` 已内建版本探测，双击即可）。
  探针脚本一律写 `%TEMP%`，**禁止落项目根**（根是主进程 CWD，会被加载进主进程）。
- **样式「没生效也没报错」先怀疑级联**：ds 基础类会**静默吃掉**同名 Tailwind 工具类
  （`styles.css` 后加载、特异性同为单类）。修法：工具类加 `!`，**别改加载顺序** → runbook §21 / R-80。
- **改 `.bat` 必须 GBK(936) + CRLF 且不要 `chcp 65001`**：改 `scripts/start.bat.utf8-source.txt`
  再跑 `node scripts/build-start-bat.mjs` → runbook §18 / R-61。
- **改完源码必须 `npx prettier --write`**；**碰 `.tsx` 的改动提交前必须跑全量测试**：design-system
  合规棘轮（裸 `rounded-*` 等）只对新增敏感，抄一段存量写法就 +1 直接红（2026-09-22 实踩）。
  `format:check` 覆盖 `src/**` + `electron/**/*.ts` + 根 `*.{js,json,md}`；**`docs/**` 不在门禁** →
  别喂 `--write`（重排整篇表格、造无关 diff）。verify ≈ 3–4 分钟。
- `release.yml` **勿**改回 `--publish always`（exe 超时）。

## 铁律（数据安全级 —— 违反会不可逆丢数据）

| 铁律 | 详见 |
| --- | --- |
| **禁用 `git rm`**（曾让 `src/` 576 文件消失）→ 用 `rm` + `git add -A` | R-02 |
| **禁用 `git stash` 做基线对比**（`.git/refs/` 会消失、`.pack` 可能被删）→ `git show HEAD:<path>` 落盘 + cp 换入换出；恢复配方 runbook §14 | R-44 |
| **同一文件多条 Edit 必须串行**（并发只最后一条生效）；改完回读校验 | R-17 |
| **删文件三查**：grep import / grep 字面量 / grep `readFileSync` | R-18 |
| **手改 `app_data_records` 三铁律**：① 编码按 namespace（zustand 型双重／记录型单层）② 写库必须带 `record_id` 条件 ③ 停应用 + 备份 + 改完全库体检 | R-04 / R-05 |
| 读 SQLite 基线一律 `readOnly: true`（残留 WAL 未 checkpoint 会读到 0 条） | R-06 |
| **写盘/配置相关改动先备份**：`scheduleApiSecretsPersist` 会连真 Key 一起抹掉 | R-03 |
| **同仓禁止并行开两条工作线**（HMR 互撞 / 41731 与单实例锁互抢） | R-01 |
| **提交前只 add 本轮文件，禁止 `git add -A`**（工作区常挂另一条线的改动） | R-09 / R-79 |
| `Bash` 工具会吃 `\\`、`${}`、改写 `/c/...` → 脚本用 Write 落盘再 `node "C:/…"` | R-19 |

## 高频入口（细节见 `docs/architecture-constraints.md`）

**以下条目完整内容在该文档，此处只留索引。**

| 关键词 | 去哪 |
| --- | --- |
| 性能基线 · 整图字节优先 · rAF 帧探针验收 | 一章 |
| 生图提示词编排（普通 SOP 1 条 / 系列 1 组） | 二章 |
| `tangbao://image/` 协议（`fetch` 被 CSP 拦是刻意的） | 三章 |
| 后处理 + 统一项目树（`undefined` = 继承、空值 = 显式覆盖） | 四章 |
| 画面适配 `fitMode`（三选一 · **全局一套** · 勿做成方向级） | 四章 §4.2 |
| 持久化 · 读失败 → 降级态拒绝写盘 | 五章 |
| 任务落盘完整性（`tasks` vs `assets`，**别去查加载链**） | 六章 |
| SOP 三场景分流 · 移植算法保真（R-45 / R-46） | 六·五章 |
| UI 约定 · 新增 `.tsx` 必登记 `catalog.ts`（R-48，刻意棘轮） | 七章 |
| **三处「静默失效」清单**（`itemDirty` / 白名单 / 排序键双链路） | 七·五章 |
| 共享工具唯一实现 + 故意不合并的三份 | 七·六章 |
| `InputBar` prompt 双写（先 `isUserInputRef.current = false`） | 八章 |
| 素材命名与排序（排序键加一项必须改两条链路） | 九章 |
| 配色/主题 · hex 换算与可辨阈值 · `return null ≠ 卸载` | **runbook §19 / §10 / R-37~39** |
| **水印库按产品隔离**（预设带 `productId`） | **ADR-0012 / TB-067** |
| **自动后处理**：总开关默认**关** · 原「启用范围」白名单已撤（字段只剩无归属兜底）· 纯配置跳过不留档（R-90） | §4.3/§4.4.1/§4.4.2 |
| **方向级历史记录 / 取消导出**（两套记录分工 · 全是快照 · 取消不删文件 · ⚠️ R-95 白名单重启清空） | §4.4.3 |
| **分发 = 按排期日同级改名整装**（目录名 = 排期日 + 命名模板 · 恒定 move · 第 1 天原地不搬 · 复制开关已撤） | §4.4.4 / **ADR-0018 / TB-117** |
| **删除即永久删除**（回收站已撤 · 四个删除入口统一走 `deleteAssets`：无冲突当场删、被别的任务/会话引用才弹确认 · 删任务卡 = 产出图随卡真删 · 存量 `trashed` 由 `CATALOG_MIGRATIONS` v2 恢复 · 误删不可恢复） | **ADR-0021 / R-105 / TB-127** |
| **产出目标按方向各存一份**（`savedTargetsByFolder`，键 = 素材库当前文件夹 · 沿树向上找第一个命中 · 自动后处理不读） | **TB-126** |
| **导出位置开关**（保留配置、临时不写 · 列名「写入」**不叫**「启用」·「全停」≠「没配」，后者才回退默认位置 · 开关表与位置列表**分家**） | §4.4.5 / **ADR-0022 / TB-130** |

## 排查手法

**完整 13 条（顺序 / 取证 / 白名单 / 缓存删除键等）在 `PLAYBOOK.md`（同目录；与日常日志一样是
**本机文件、不进 git** —— `.gitignore` 只白名单了本文件）—— 报障、数据对不上、
界面「没反应」、「东西不见了」时先读它。** 以下三条是每次开工都要用到的：

- **⭐ 开工前别只看 `git status`，还要看「未被改动的文件」的 mtime**（09-23 实测）：`git status`
  只回答「有没有改」，看不出「是不是**正在**被改」—— 对方的文件会在你跑验证的几分钟里冒出来
  （实测 `projectTree/params.ts` 在我检查后 **12 秒**落盘）。做法：`git status --short` +
  `stat -c '%y %n' <可疑文件>` 对比 `date`；看到别人在改的，**一个字节都别碰**。
- **⭐ 报障第零步：先确认「哪台机器 / 哪个环境」**（09-22 连踩三轮）：dev 用 `%APPDATA%\tangbao`、
  安装版用 `%APPDATA%\糖包`，**两份互不相干的库**；本机数据对不上描述时先问环境，别先怀疑代码。
- **⭐ 有库可查时：查库 > 读代码 > 猜**（09-22 连错两轮换来）：判断「数据是不是真丢了」先只读直查
  `app_data_records`（`mode=ro`，R-06），**别在代码里推断数据丢没丢。**
