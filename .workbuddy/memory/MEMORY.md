# 糖包（TANGBAO）

> **本文件是索引与铁律，不是知识本体。** 超过 10KB 就是内容放错了层（09-18 分层重建，09-22 两次压缩）。

## 文档地图（先看这里）

| 要什么                   | 去哪                                     |
| ------------------------ | ---------------------------------------- |
| 交付什么、什么算完       | `docs/ROADMAP.md`                        |
| 在做什么、卡在哪         | `docs/BACKLOG.md`                        |
| 为什么不那么做           | `docs/adr/`                              |
| 哪些坑不能踩（R/P/Q）    | `docs/RISK.md`                           |
| **哪些设计勿改回**       | `docs/architecture-constraints.md`       |
| 操作配方（持久化/推仓等）| `docs/tangbao-ops-runbook.md`            |
| 哪份文档还算数           | `docs/README.md`                         |
| AI 开工/收工规范         | `AGENTS.md`「项目管理（开工前必读）」    |
| 每日生成模块（策略卡等） | `src/features/dailyBatch/`（TB-108）· 页面档 `design-system/tangbao/pages/daily.md` |
| 过程记录                 | 同日 `YYYY-MM-DD.md`                     |

## 身份 · 构建 · 发布

- `tangbao` 0.1.x / appId `com.cooksleep.tangbao` / exe `Tangbao`。
- userData：正式版 `%APPDATA%\糖包`，dev `%APPDATA%\tangbao`。
- 状态落盘 = SQLite `local-saves/db/asset-kernel.sqlite` 的 `app_data_records`。
- 糖包 = 主线，豆泡 = 维护；两仓**无共享 git 历史** → 只能 `fetch` + `cherry-pick`。
- **`vite build` 必须 Node 24**（Node 22 报 `DatabaseSync` 未导出）；
  **本机 `node` 默认 v22 → 跑任何 npm 脚本都要显式提到 v24**（R-59，跑法见 runbook §18.4；
  `start.bat` 已内建版本探测，双击即可）。探针脚本一律写 `%TEMP%`，**禁止落项目根**
  （根目录是主进程 CWD，会被加载进主进程）。
- **样式「没生效也没报错」先怀疑级联**：ds 基础类会**静默吃掉**同名 Tailwind 工具类（`styles.css`
  后加载、特异性同为单类）。修法：工具类加 `!`，**别改加载顺序** → **runbook §21 / R-80**。
- **改 `.bat` 必须 GBK(936) + CRLF 且不要 `chcp 65001`**；改法是编辑
  `scripts/start.bat.utf8-source.txt` 再跑 `node scripts/build-start-bat.mjs` → **runbook §18 / R-61**。
- **改完源码必须 `npx prettier --write`**；**碰 `.tsx` 的改动提交前必须跑全量测试**：design-system
  合规棘轮（裸 `rounded-*` 等）**只对新增敏感**，定向用例覆盖不到 —— 抄一段存量写法就 +1 直接红
  （2026-09-22 实踩）。`format:check` 范围：`src/**` + `electron/**/*.ts` + 根目录 `*.{js,json,md}`；
  **`docs/**` 不在门禁里** → 别喂 `--write`（会重排整篇表格、造几百行无关 diff）。verify ≈ 3–4 分钟。
- `release.yml` **勿**改回 `--publish always`（exe 超时）。

## 铁律（数据安全级 —— 违反会不可逆丢数据）

| 铁律                                                                                         | 详见        |
| -------------------------------------------------------------------------------------------- | ----------- |
| **禁用 `git rm`**（曾让 `src/` 576 文件消失）→ 用 `rm` + `git add -A`                        | R-02        |
| **禁用 `git stash` 做基线对比**（`.git/refs/` 会消失、`.pack` 可能被删）→ 用 `git show HEAD:<path>` 落盘 + cp 换入换出；恢复配方 runbook §14 | R-44 |
| **同一文件多条 Edit 必须串行**（并发只最后一条生效）；改完回读校验                           | R-17        |
| **删文件三查**：grep import / grep 字面量 / grep `readFileSync`                              | R-18        |
| **手改 `app_data_records` 三铁律**：① 编码按 namespace（zustand 型双重 / 记录型单层）② 写库必须带 `record_id` 条件 ③ 停应用 + 备份 + 改完全库体检 | R-04 / R-05 |
| 读 SQLite 基线一律 `readOnly: true`（残留 WAL 未 checkpoint 会读到 0 条）                    | R-06        |
| **写盘/配置相关改动先备份**：`scheduleApiSecretsPersist` 会连真 Key 一起抹掉                 | R-03        |
| **同仓禁止并行开两条工作线**（HMR 互撞 / 41731 与单实例锁互抢）                              | R-01        |
| **提交前只 add 本轮文件，禁止 `git add -A`**（工作区常挂另一条线的改动）                     | R-09 / R-79 |
| `Bash` 工具会吃 `\\`、`${}`、改写 `/c/...` → 脚本用 Write 落盘再 `node "C:/…"`               | R-19        |

## 高频入口（细节见 `docs/architecture-constraints.md`）

**以下条目完整内容在 `docs/architecture-constraints.md`，此处只留索引。**

| 关键词                                                            | 去哪                                       |
| ----------------------------------------------------------------- | ------------------------------------------ |
| 性能基线 · 整图字节优先 · rAF 帧探针验收                          | 一章                                       |
| 生图提示词编排（普通 SOP 1 条 / 系列 1 组）                       | 二章                                       |
| `tangbao://image/` 协议（`fetch` 被 CSP 拦是刻意的）              | 三章                                       |
| 后处理 + 统一项目树（`undefined` = 继承、空值 = 显式覆盖）        | 四章                                       |
| 画面适配 `fitMode`（三选一 · **全局一套** · 勿做成方向级）        | 四章 §4.2                                  |
| 持久化 · 读失败 → 降级态拒绝写盘                                  | 五章                                       |
| 任务落盘完整性（`tasks` vs `assets`，**别去查加载链**）           | 六章                                       |
| SOP 三场景分流 · 移植算法保真（R-45 / R-46）                      | 六·五章                                    |
| UI 约定 · 新增 `.tsx` 必登记 `catalog.ts`（R-48，刻意棘轮）       | 七章                                       |
| **三处「静默失效」清单**（`itemDirty` / 白名单 / 排序键双链路）   | 七·五章                                    |
| 共享工具唯一实现 + 故意不合并的三份                               | 七·六章                                    |
| `InputBar` prompt 双写（先 `isUserInputRef.current = false`）     | 八章                                       |
| 素材命名与排序（排序键加一项必须改两条链路）                      | 九章                                       |
| 配色/主题 · hex 换算与可辨阈值 · `return null ≠ 卸载`            | **runbook §19 / §10 / R-37~39**            |
| **水印库按产品隔离**（预设带 `productId`）                        | **ADR-0012 / TB-067**                      |
| **产出目标只有手动读**，自动按归属；启用范围只拦自动（R-90）      | `architecture-constraints.md` §4.3/§4.4.1 |
| **方向级历史记录 / 取消导出**（两套记录分工 · 全是快照 · 取消不删文件 · ⚠️ R-95 白名单重启清空） | `architecture-constraints.md` §4.4.3 |

## 排查手法（方法论，不是架构事实）

- **⭐ 开工前别只看 `git status`，还要看「未被改动的文件」的 mtime**（2026-09-23 实测）：
  `git status` 只回答「有没有改」，看不出「是不是**正在**被改」。同一天两条写线并行时，
  对方的文件会在你跑验证的那几分钟里冒出来（实测：`projectTree/params.ts` 在我检查后 **12 秒**
  落盘，另一边是 TB-107）。做法：`git status --short` + `stat -c '%y %n' <可疑文件>` 对比 `date`；
  看到别人在改的文件，**一个字节都别碰**，本轮新增全部放进自己的目录。

- **⭐ 报障第零步：先确认「哪台机器 / 哪个环境」**（2026-09-22 连踩三轮）——
  dev 用 `%APPDATA%\tangbao`、安装版用 `%APPDATA%\糖包`，**是两份互不相干的库**；
  本机数据对不上用户描述时，先问环境，别先怀疑代码。**跨机共用的事实只有共享盘**：
  `//192.168.202.11/设计素材交付专用/...` 可直连（但 `find -newermt` 扫全盘会超时，只能定向看）。
- **⭐ 区分「分发复制」与「产出重编码」只能靠字节**：两条路径的撞名后缀规则**完全一样**
  （都是 `-2`），看文件名分不出来；分发是 `copyFileSync` ⇒ 复制件与原型**字节完全相同**，
  产出是重新渲染 ⇒ **字节必不同**。
- **抓渲染进程报错**：`ELECTRON_ENABLE_LOGGING=1 npm run dev`。
- **⭐ 报障排查第一步：拿界面原文字符串去 `grep`**（实例：`导出位置不可用` → `outputRoots.ts:47`）。
- **`npm run dev` / `mock:api` 必须出沙箱**：默认沙箱会**无声回收监听端口的进程（~40s）**，症状 =
  「窗口刚起来就自己消失」；无报错、无 Crashpad 转储 → 要 `dangerouslyDisableSandbox: true`。
- **窗口「点什么都没反应」先看是不是错误页**：`location.href === 'chrome-error://chromewebdata/'`
  ⇒ 界面根本没加载（dev server 已死，**窗口不会自恢复**）。
- **门禁假象**：`noUnusedLocals/Parameters` 关着、`no-unused-vars` 仅 warn → 死 import 零告警
  （存量 116 处，见 TB-021）。
- **⭐ 同仓并行两条写线时怎么收口**：发现没碰过的文件（看 mtime）→ ① 不跑全量 `verify`（混着对方
  WIP，绿/红都不可信，即 R-74 成因），改跑定向用例 + 逐条 `tsc`/`lint`/`format:check`；
  ② 只 `git add` 自己那批；③ **一个字节都别碰对方的文件**；④ 开工前在 BACKLOG 占号（R-09 / R-79）。
- **⭐ IPC handler 里 `catch { console.error; return false }` 是可诊断性缺陷**：渲染侧只拿到布尔值，
  **失败原因永久丢失**（实例：`fs:ensure-dir` 吞掉 `assertAllowedPath` 的报错 → R-62）。
- **⭐ 主进程 IPC 路径白名单会打死「导出到业务盘」**（`ipc-handlers.ts` 的 `getAllowedRoots` /
  `assertAllowedPath`）：只放行 桌面/文档/下载/图片/userData + `localSavePath` +
  `sessionAllowedRoots`（**内存 Set，重启清空**，只有走对话框选过才加白名单，手输无效）→ R-31 / R-62。
- **写失败文案必须与真因对齐**：自问「用户照这句话去查，能不能查到」。
- **⭐ 要「数字」就别靠截图**：按标题匹配窗口会被「标题里含产品名的浏览器页」骗过（抓到的是网页）。
  ⇒ 截图前先核对窗口身份；**量数字走 `document.title`**（把 `getBoundingClientRect` 写进标题，
  外部用 Win32 `GetWindowTextW` 读回）——不截图、不读像素。反例代价：TB-079 曾据截图判定「弹窗偏右」。
- **⭐ 「可见性」由 filter 决定的列表，缺数据时表现为「静默消失」**：卡片被上游 `filter` 丢掉时
  既不报错也不留占位。排查「东西不见了」先看**数据还在不在**（顶部计数条 / 换成图片视图看），
  再判断是**查询层**丢的、**渲染层**滤的、还是**落盘**就没写进去 —— 顺序反了会在代码里白翻一天。
  实例：素材库任务卡视图的孤儿组被一行 filter 掐死（`AssetBatchView.tsx:477`，渲染分支其实已写好）。
- **⭐ 有库可查时：查库 > 读代码 > 猜**（2026-09-22 连错两轮换来的）。判断「数据是不是真丢了」，
  先只读直查 `app_data_records`（`mode=ro`，R-06）：按 `namespace` 分组数条数、解 JSON 做集合差。
  实例：我推理两轮「任务记录怎么丢的」，真库一查 —— **566 任务 / 484 素材 / 孤儿 0 条，一条没丢**；
  真因是「这一屏画的是哪一份列表」（内存缓存窗口）。**别在代码里推断数据丢没丢。**
