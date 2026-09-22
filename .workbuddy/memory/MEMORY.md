# 糖包（TANGBAO）

> **本文件是索引与铁律，不是知识本体。** 超过 10KB 就是内容放错了层。
> 2026-09-17 从豆泡拆出；2026-09-18 分层重构；2026-09-22 压缩（细节一律去下表各文件）。

## 文档地图（先看这里）

| 要什么                                     | 去哪                                     |
| ------------------------------------------ | ---------------------------------------- |
| 现在交付什么、什么算完                     | `docs/ROADMAP.md`                        |
| 在做什么、卡在哪                           | `docs/BACKLOG.md`                        |
| 为什么不那么做                             | `docs/adr/`                              |
| 哪些坑不能踩（R/P/Q 分级）                 | `docs/RISK.md`                           |
| **哪些设计勿改回**                         | `docs/architecture-constraints.md`       |
| 操作配方（持久化/验收/抓报错/推 GitHub 等） | `docs/tangbao-ops-runbook.md`            |
| 哪份文档还算数                             | `docs/README.md`                         |
| AI 开工/收工规范                           | `AGENTS.md` 的「项目管理（开工前必读）」 |
| 过程记录                                   | 同日 `YYYY-MM-DD.md`                     |

## 身份 · 构建 · 发布

- `tangbao` 0.1.x / appId `com.cooksleep.tangbao` / exe `Tangbao`。
- userData：正式版 `%APPDATA%\糖包`，dev `%APPDATA%\tangbao`。
- 状态落盘 = SQLite `local-saves/db/asset-kernel.sqlite` 的 `app_data_records`。
- 糖包 = 主线，豆泡 = 维护；两仓**无共享 git 历史** → 只能 `fetch` + `cherry-pick`。
- **`vite build` 必须 Node 24**（Node 22 报 `DatabaseSync` 未导出）。
- **⭐ 本机 `node` 默认 v22，跑任何 npm 脚本都会回落 v22 → 必须显式提到 v24**（R-59）。
  正确跑法、`vite --version` 不加载配置、`timeout` 杀不掉 electron → **runbook §18.4**。
  `start.bat` 已内建版本探测，双击即可。
- **探针脚本一律写 `%TEMP%`，禁止落项目根**：根目录是主进程 CWD，会被加载进主进程
  （曾因 `path.join(process.env.APPDATA,…)` 抛 `ERR_INVALID_ARG_TYPE` 弹「main process error」）。
- **⭐ 样式「没生效也没报错」先怀疑级联，不是先读组件**：`design-system/styles.css` 在 `index.css`
  之后加载、特异性同为单类 → **ds 基础类声明过的属性（`position`/`min-height`/`padding`…）会静默
  吃掉 Tailwind 工具类**：不消失不报错，只是把后面兄弟挤开再平移上去压住它（2026-09-22 弹窗 × 压正文）。
  修法：工具类加 `!`（`!absolute`/`!min-h-…`），**别改全局加载顺序**；合规守卫已加（缺 `!` 即红）
  → **runbook §21 / R-80**。
- **改 `.bat` 必须 GBK(936) + CRLF，且不要 `chcp 65001`**，否则满屏 `'xxx' 不是内部或外部命令`。
  **改法：编辑 `scripts/start.bat.utf8-source.txt` 再跑 `node scripts/build-start-bat.mjs`**
  → **runbook §18 / R-61**。
- `npm run verify` ≈ 3–4 分钟（tsc 双端 + lint + format + 全量测试）。
- **改完源码必须 `npx prettier --write`**。`format:check` 范围（2026-09-22 核实）：
  `src/**/*.{ts,tsx,css}` + `electron/**/*.ts` + 根目录 `*.{js,json,md}`；**`docs/**` 不在门禁里**。
- `release.yml` **勿**改回 `--publish always`（exe 超时）。

## 铁律（数据安全级 —— 违反会不可逆丢数据）

| 铁律                                                                                                                                              | 详见        |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **禁用 `git rm`**（曾让 `src/` 576 文件消失）→ 用 `rm` + `git add -A`                                                                             | R-02        |
| **禁用 `git stash` 做基线对比**（会让 `.git/refs/` 消失、`.pack` 可能被删）→ 用 `git show HEAD:<path>` 落盘 + cp 换入换出；恢复配方见 runbook §14 | R-44        |
| **同一文件多条 Edit 必须串行**（并发只最后一条生效）；改完回读校验                                                                                | R-17        |
| **删文件三查**：grep import / grep 字面量 / grep `readFileSync`                                                                                   | R-18        |
| **手改 `app_data_records` 三铁律**：① 编码按 namespace（zustand 型双重 / 记录型单层）② 写库必须带 `record_id` 条件 ③ 停应用 + 备份 + 改完全库体检 | R-04 / R-05 |
| 读 SQLite 基线一律 `readOnly: true`（残留 WAL 未 checkpoint 会读到 0 条）                                                                         | R-06        |
| **写盘/配置相关改动先备份**：`scheduleApiSecretsPersist` 会连真 Key 一起抹掉                                                                      | R-03        |
| **同仓禁止并行开两条工作线**（HMR 互撞 / 41731 与单实例锁互抢）                                                                                   | R-01        |
| **提交前只 add 本轮文件，禁止 `git add -A`**（工作区常挂另一条线的改动）                                                                          | R-09        |
| `Bash` 工具会吃 `\\`、`${}`、改写 `/c/...` → 脚本用 Write 落盘再 `node "C:/…"`                                                                    | R-19        |

## 高频入口（细节见 `docs/architecture-constraints.md`）

**以下条目的完整内容一律在 `docs/architecture-constraints.md`，此处只留索引，别在这里补细节。**

| 关键词                                                                  | 去哪                                       |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| 性能基线 · 整图字节优先 · rAF 帧探针验收                                | 一章                                       |
| 生图提示词编排（普通 SOP 1 条 / 系列 1 组）                             | 二章                                       |
| `tangbao://image/` 协议（`fetch` 被 CSP 拦是刻意的）                    | 三章                                       |
| 后处理 + 统一项目树（`undefined` = 继承、空值 = 显式覆盖；`byMedia`）   | 四章                                       |
| 画面适配 `fitMode`（三选一 · **全局一套** · 勿做成方向级）             | 四章 §4.2                                  |
| 持久化 · 读失败 → 降级态拒绝写盘                                        | 五章                                       |
| 任务落盘完整性（`tasks` vs `assets`，**别去查加载链**）                 | 六章                                       |
| SOP 三场景分流（配方卡 > 变量提示词 > AI）· 移植算法保真（R-45 / R-46） | 六·五章                                    |
| UI 约定 · 新增 `.tsx` 必登记 `catalog.ts`（R-48，刻意棘轮）             | 七章                                       |
| **三处「静默失效」清单**（`itemDirty` / 持久化白名单 / 排序键双链路）   | 七·五章                                    |
| 共享工具唯一实现 + 故意不合并的三份                                     | 七·六章                                    |
| `InputBar` prompt 双写（先 `isUserInputRef.current = false`）           | 八章                                       |
| 素材命名与排序（排序键加一项必须改两条链路）                            | 九章                                       |
| 配色/主题 · hex 换算与可辨阈值 · `return null ≠ 卸载` · 主题切换链路    | **runbook §19 / §10 / R-37 / R-38 / R-39** |
| **水印库按产品隔离**（预设带 `productId`；产品线/全局两层不给库）       | **ADR-0012 / TB-067**                      |
| **产出目标只有手动读**，自动按归属；启用范围只拦自动（R-90）            | `architecture-constraints.md` §4.3/§4.4.1 |

## 排查手法（方法论，不是架构事实）

- **抓渲染进程报错**：`ELECTRON_ENABLE_LOGGING=1 npm run dev`。
- **⭐ 报障排查第一步：拿界面原文字符串去 `grep`**（实例：`导出位置不可用` → `outputRoots.ts:47`
  一击命中）。比读文档 / 猜链路快一个数量级。
- **`npm run dev` / `mock:api` 必须出沙箱**：默认沙箱会**无声回收监听端口的进程（~40s）**，
  症状 = 「窗口刚起来就自己消失」；无报错、无 Crashpad 转储 → 要 `dangerouslyDisableSandbox: true`。
- **窗口「点什么都没反应」先看是不是错误页**：`location.href === 'chrome-error://chromewebdata/'`
  ⇒ 界面根本没加载（dev server 已死，**窗口不会自恢复**）。
- **门禁假象**：`noUnusedLocals/Parameters` 关着、`no-unused-vars` 仅 warn → 死 import 零告警
  （存量 116 处，见 TB-021）。
- **⭐ 同仓并行两条写线时怎么收口（2026-09-21 实踩）**：发现工作区冒出没碰过的文件（看 mtime 判断
  是否正在被写）→ ① 不跑全量 `verify`（混着对方 WIP，绿/红都不可信，即 R-74 成因），改跑定向用例
  + 逐条 `tsc`/`lint`/`format:check`；② 只 `git add` 自己那批；③ **一个字节都别碰对方的文件**；
  ④ 任务号会撞 → 开工前在 BACKLOG 占号。
- **⭐ IPC handler 里 `catch (err) { console.error(...); return false }` 是可诊断性缺陷**：
  渲染侧只拿到布尔值，**失败原因永久丢失**。排查「功能完全不可用但没报权限错」时优先怀疑它
  （实例：`fs:ensure-dir` 吞掉 `assertAllowedPath` 的报错 → R-62）。
- **⭐ 主进程 IPC 路径白名单会打死「导出到业务盘」**（`electron/ipc-handlers.ts` 的
  `getAllowedRoots` / `assertAllowedPath`）：**只放行 桌面/文档/下载/图片/userData +
  `localSettings.localSavePath` + `sessionAllowedRoots`**。两处不对称：① 只有 `fs:select-directory`
  对话框选过才 `addAllowedRoot`，**手输同路径无效**；② `sessionAllowedRoots` 是**内存 Set，重启清空**
  ⇒ 任何「导出/写到自定义目录」的功能先想这一层（R-31 / R-62）。
- **写失败文案必须与真因对齐**：写「请检查路径是否可达」会把排查带偏（路径明明打得开，真因是不在白名单）。
  自问一句「用户照这句话去查，能不能查到」。
- **⭐ 要「数字」就别靠截图（2026-09-22 实踩）**：抓窗口截图会**谎报几何** ——
  按标题匹配窗口的脚本会被「标题里含产品名的浏览器页」骗过（Chrome 开着 GitHub 仓库页，
  标题 `nideyilian/tangbao: 糖包 (TANGBAO) — … - Google Chrome` 同时含 `糖包` 与 `tangbao`），
  抓到的是网页不是应用。⇒ ① 截图前先核对窗口身份（标题 / 进程名）；
  ② **量数字走 `document.title`**：把 `getBoundingClientRect` 结果写进标题，
  外部用 Win32 `GetWindowTextW` 读回来 —— 不截图、不读像素。截图只回答「长什么样」。
  反例代价：本仓 TB-079 曾据截图判定「弹窗偏右」，复核后是误读（代码无此缺陷）。
