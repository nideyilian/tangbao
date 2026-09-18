# 糖包 风险登记册（RISK）

> **本文件是唯一的风险清单。** 回答"哪些坑不能踩"。
> 从 `.workbuddy/memory/MEMORY.md` 的叙述式陷阱升级为**带分级、触发条件、检测手段、缓解动作**的登记册。
> 具体操作配方见 `docs/tangbao-ops-runbook.md`；本文件只登记风险与对策，不写配方。

## 等级定义

| 等级 | 含义 | 要求 |
| --- | --- | --- |
| **R** | 数据安全级：会**不可逆地**丢数据 / 密钥 / 历史 | 动手前必须备份 + 停应用；改动必须有守卫 |
| **P** | 返工级：会导致静默失效、误判、诊断成本极高 | 必须有检测手段或测试守卫 |
| **Q** | 质量级：影响可维护性与改动速度 | 有意识控制，不阻断交付 |

**状态**：`OPEN`（现行有效） / `MITIGATED`（已有代码或流程守卫） / `CLOSED`（根因已消除）

---

## R 级 · 数据安全

| ID | 风险 | 触发条件 | 检测 | 缓解 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R-01 | **并行写线互相破坏**：HMR 把改动热更新进另一条正在使用的窗口；41731（`strictPort`）与单实例锁互抢；leveldb 被应用独占 `LOCK` | 同一仓库同时有 ≥2 个会话/进程在动代码或跑 dev | `netstat` 查 41731；确认 dev 进程父链（`bash → npm run dev → vite`） | **单写线原则**；真并行用 `git worktree` + 独立端口/userData，见 `docs/work-protocol.md` | OPEN · 24h 内触发 3 次 |
| R-02 | **`git rm` 会大面积删文件**（曾让 `src/` 576 个文件消失） | 用 `git rm` 删单个文件 | 操作后立即 `git status` 看待删清单 | 一律用 `rm` + `git add -A` | MITIGATED |
| R-03 | **配置重置会连真 Key 一起抹掉**（`scheduleApiSecretsPersist` 随 settings 重写 `api-secrets.bin`，不可逆） | settings 被重置为该 namespace 的默认值 | `api-secrets.bin` **字节数**（正常约 302B；被抹后 282B → 205B） | 改 settings 前先备份该文件；`apiKey` 恒空串是正常的，**判据是字节数** | MITIGATED（`desktopJsonStorage` 读失败已拒绝写盘） |
| R-04 | **手改 `app_data_records` 覆盖其他记录**：`WHERE namespace=...` 不带 `record_id` 会一次写坏同 namespace 的全部记录 | 手工 UPDATE 未带 `record_id` 条件 | 改后逐条回读校验 | ① 停应用 + 备份；② 写库必须带 `record_id`；③ 改完全库体检 | MITIGATED（已写进 runbook） |
| R-05 | **编码分两种**：zustand 型是**双重编码**、记录型（`appDataPut`）是**单层**；用错则数据变字符串 → 下游 `.filter` 崩溃 | 手工写库 / 新增读库代码 | 写前 `typeof JSON.parse(row.json)` 判一次 | 按 namespace 分别处理；读取侧做兼容解析（`decodeSopBatchSnapshotRecord` 已是范例） | MITIGATED |
| R-06 | **读带残留 WAL 的 SQLite 可能读到 0 条**（未 checkpoint 的帧不可见）→ 会把"合并"做成"覆盖" | 用 read-write 连接打开正在使用的库取基线 | 基线读到 0 而备份里有数据 | **基线一律用 `readOnly: true` 读** | MITIGATED（runbook 第九节） |
| R-07 | **新增 store 忘配 namespace 白名单 = 完全存不住且 UI 不报错** | 新增持久化 store 未改 `electron/asset-kernel.ts` | 重启后回读该 namespace | 新增即登记白名单；用 `appDataNamespaceContract.test.ts` 守住 | MITIGATED（有契约测试） |
| R-08 | **`.workbuddy/` 被 gitignore → 记忆永不入库**，换机/故障即全部沉淀归零 | 一直存在（原 `.gitignore:29-30`） | `git ls-files --others --exclude-standard .workbuddy/` | ✅ **已修（2026-09-18）**：`.gitignore` 改为白名单，**只入库 `MEMORY.md`**。范围收敛的原因：实测仓库是 **public**，过程日志含本机路径与服务商域名 → 日志留本地；硬结论已分层到 RISK / runbook / ADR（全部入库） | **MITIGATED** |
| R-09 | **工作区长期挂着未提交改动，与并行改动混在一起** | 多会话同时改同一仓库 | 每次提交前 `git status` 逐文件确认归属 | **禁止 `git add -A`**；提交只 add 本轮文件。⚠️ 2026-09-18 提交前实测：工作区同时挂着**两条线**的改动（未推送的功能修复 + 新建的 docs），已按线拆成两个提交 | MITIGATED |

## P 级 · 返工 / 静默失效

| ID | 风险 | 触发条件 | 检测 | 缓解 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R-10 | **门禁放行"声称改了但没落地"**：`noUnusedLocals/Parameters=false`（`tsconfig.json:19-20`）+ `no-unused-vars: warn`（`eslint.config.js:48`），死 import 零告警 | 只加 import 没换调用点 | `npm run lint` 无输出（漏检） | 打开 `error`（TB-021）；✅ **已修（2026-09-18）**：存量 114 处**已全部清零**，`no-unused-vars` 与 `no-explicit-any` 在 `src/**` + `electron/**` 上从 `warn` 收紧为 **`error`**（`eslint.config.js`）→ CI 的 Lint 步骤即守卫，**新增即红**。过渡用的棘轮脚本已按计划退役（规则本身已是硬门禁）。对关键改动仍应补**结构性断言**测试 | **RESOLVED** |
| R-11 | **记忆入库可能连带本机隐私**：记忆文件含本机绝对路径、密钥字节数、凭据获取方式 | TB-025 执行时 | 入库前全文检索 `token` / `pat` / `sk-` / `C:\Users` / 主机名 | ✅ **已执行（2026-09-18）**：扫描确认**无完整凭据**（命中的只有 `github_pat_…` / `gho_…` 这类前缀示意）；仓库实测为 **public** → 进一步收敛为**只入库 `MEMORY.md`**，过程日志留本地 | **MITIGATED** |
| R-12 | **`store.setAppMode` 兜底分支把非白名单值改写成 `agent`** → 顶栏切换"点了没反应、零报错" | 新增 `AppMode` 值时未补分支 | 点 tab 后查 `appMode` 实际值 | 新增工作区必须补分支；已有测试守住 | MITIGATED |
| R-13 | **`InputBar` 的 prompt 是双写**（store + contentEditable）：程序性改写未置 `isUserInputRef.current = false` 会被 effect 吞掉，下次从 DOM 回读把改动整个抹掉 | 新增任何"程序性改写 prompt"的入口 | 改完后在输入框多敲一个字，看改动是否还在 | 改写前必须复位标志；effect 已收紧为「DOM 纯文本 === prompt 才跳过」 | MITIGATED |
| R-14 | **`read` 不能用「返回值是否字符串」判有效性**（单层编码会返回对象 → 判为"首次运行" → 用默认值回写覆盖） | 持久化读取实现 | 用单层编码记录做人工验证 | `desktopJsonStorage` 已三种编码都认 + **读失败进降级态拒绝写盘** | MITIGATED |
| R-15 | **`byMedia` / 参数解析必须 `??` 不能 `\|\|`**：`''` 与 `[]` 都是**有效值**（显式覆盖） | 写合并/回退逻辑 | 用例覆盖「空数组 = 明确不加水印」 | 判据一律 `=== undefined`；`distribution` 语义是**整份替换**不是逐字段继承 | MITIGATED |
| R-16 | **调 API 配置前先看它调哪个解析层**：图片配置改动**动不了** SOP 文本链路（`getAgentApiProfile` 独立），凭直觉判断会诊断到错的层 | 修改 API 配置后判断影响面 | 按调用链定位（`getActiveApiProfile` / `getAgentApiProfile` / `getAgentTextApiProfile` / `getAgentImageApiProfile`） | `apiProfiles.ts` 三层解析已写进 runbook | MITIGATED |
| R-17 | **同一文件多条 Edit 必须串行**（并发只最后一条生效） | 对同一文件连续发多个编辑 | 改后回读关键行 | 串行执行；改完回读校验 | OPEN |
| R-18 | **删文件必须三查**：① grep import ② grep 字符串字面量 ③ grep `readFileSync` | 判定为死代码后删除 | 三查缺一即可能漏 | 按三查流程执行 | MITIGATED（进 `AGENTS.md` 语境） |
| R-19 | **Bash 工具会吃 `\\` 与 `${}`、改写 `/c/...`** → 脚本静默写错路径 | 用 Bash heredoc 传含 Windows 路径的脚本 | 脚本里路径是否完整 | **脚本一律用 Write 落盘，再 `node "C:/…"`（正斜杠）执行** | MITIGATED |
| R-20 | **`npm run verify` 期间删临时文件会让 ESLint 崩**（`ENOENT ... .tmp-*.cjs`，扫描队列与删除并发） | verify 与清理并发 | verify 报 ENOENT | 清理临时文件等 verify 跑完，或放到项目外 | MITIGATED |
| R-21 | **`.git/refs/remotes/` 有环境级写保护** → `git status -sb` **恒报 `[gone]`**，会误判成"推送失败" | 任何 fetch / update-ref | `git for-each-ref refs/remotes/` 恒空 | 推送自检只能用 `ls-remote` 与 `rev-parse HEAD` 比 SHA（runbook 第八节） | OPEN（环境问题，无法消除） |
| R-22 | **看门狗超时会把任务提前标终态但请求还在飞** → 迟到结果是孤儿（既不进卡片也不进素材库） | 生成超时后又返回了结果 | 检查三处 `status === 'running'` 守卫 | 已用 `canSettleTaskOutputs` 放行（`watchdogTimedOutAt` 标记） | MITIGATED |
| R-23 | **收尾写入可以让 `outputImages` 变短** → 卡片数量少于素材库 | 槽位快照与 `outputImages` 写盘不一致；或 fire-and-forget 写失败 | 对比卡片数与素材库数 | `pickMoreCompleteOutputIds` + `persistTaskWithRetry`；**两者不一致即落盘不完整，别去查加载链** | MITIGATED |

## Q 级 · 质量 / 效率

| ID | 风险 | 缓解 | 状态 |
| --- | --- | --- | --- |
| R-24 | **组件巨型化**：`store.ts` 13346 / `InputBar.tsx` 5565 / `SettingsModal.tsx` 5414 / `GallerySopBatchModal.tsx` 4216 行 | `AGENTS.md` 已写「勿继续膨胀」；拆分随 TB-023 顺带做，不单独立项 | OPEN |
| R-25 | **大提交不可回滚**：最大 `8b26160` 为 54 文件 / +338 −8978 行 | 按"可独立验收的最小单元"提交；大重构按「删消费方 → 剥字段 → 清死代码」分次提交 | OPEN |
| R-26 | **落盘版本 bump 必须配丢弃式 migrate**，否则旧字段被静默丢弃、用户配置消失 | 已固化为惯例（`storeV2` v4→v5、v3→4 均为丢弃式） | MITIGATED |
| R-27 | **`CompositeV2Preset.sampleBackgroundPath` 只有读没有生产者**（暂留） | 明确标注，避免被当死代码删掉时误伤读端 | OPEN（刻意保留） |
| R-28 | **任务卡片高度固定** `TASK_CARD_ROW_HEIGHT = 192`，卡内加可展开区块会撑破布局 | 已知约束；新增内容前先确认高度 | MITIGATED |
| R-29 | **`localStorage` UI 状态在测试间泄漏**（分隔条比例等持久化值会变成下个用例初值） | 受影响测试的 `afterEach` 清 `localStorage` | MITIGATED（已有先例） |
| R-30 | **`test:coverage` 收尾会报一条无害的 `Unhandled Error`**：vitest 清理 `coverage/.tmp` 时被安全删除护栏拦住（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，命中 239 个文件 > 阈值 50）。**报告已正常生成**，但退出码可能非 0 | 本地跑 `npm run test:coverage` | 输出末尾的 `[safe-delete]` 段 | **刻意不接进 CI**（会被误报成失败）；CI 只跑 `npm test` | OPEN |

---

## 登记规则

1. **踩到新坑当场登记**，不要只写进日志 —— 日志会被压缩，本文件是长期资产。
2. 每条必须能回答：**什么条件下会发生** / **怎么发现** / **怎么避免或兜住**。
3. 根因消除后把状态改为 `CLOSED`，**不要删除**（保留"曾经有过这个坑"的信息）。
4. **一个事实一个家**：配方写进 `docs/tangbao-ops-runbook.md`，本文件只登记风险与对策，不复述配方。
