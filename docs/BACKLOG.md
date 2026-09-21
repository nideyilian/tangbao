# 糖包 需求池（BACKLOG）

> **本文件是唯一的需求池。** 回答"现在在做什么、卡在哪"。
> 目标与里程碑见 `docs/ROADMAP.md`。风险见 `docs/RISK.md`。

## 在途（WIP ≤ 2）

| ID     | 事项                                 | 状态  | 写线   | 开始       |
| ------ | ------------------------------------ | ----- | ------ | ---------- |
| TB-060 | 中控台数据表格化 + Excel 导入导出    | DOING | 主写线 | 2026-09-21 |
| TB-014 | 后处理按图片归属自动匹配参数         | DOING | 主写线 | 2026-09-18 |
| TB-015 | 水印预设升为顶栏 tab，归属与参数分离 | DOING | 主写线 | 2026-09-18 |

> ⚠️ **在途超过 2 条即视为并行**。这个项目的 dev（41731 端口 + 单实例锁 + leveldb 独占）
> 是排他资源，并行必须用 `git worktree` + 独立端口/userData 物理隔离，见 `docs/work-protocol.md`。
>
> **2026-09-21 补**：TB-014 / TB-015 是 09-18 登记的历史在途条目，其内容已被后续
> TB-053「水印预设 tab 改为中控台」等条目实质承接，状态尚未复核更新（不擅自改他人条目）。
> 本轮真正活跃的写线只有 TB-060 一条。

## 状态定义（只用这 5 个）

| 状态      | 含义           | 附加要求                                         |
| --------- | -------------- | ------------------------------------------------ |
| `TODO`    | 已记录，未开工 | 验收标准必须已写清                               |
| `DOING`   | 正在做         | 必须写"写线"（哪条会话 / 哪个 worktree）         |
| `BLOCKED` | 卡住           | 必须写"等谁 / 等什么"                            |
| `DONE`    | 已完成         | 必须有**验收证据**（commit / 测试数 / 实测数字） |
| `DROPPED` | 决定不做       | 必须写原因，并指向对应 ADR                       |

---

## M1 · 后处理与水体系统一

### TB-014 后处理按图片归属自动匹配参数

- **来源**：杰哥原话「默认自动采用图片所在方向文件夹对应的参数，无需手动选择」（2026-09-18）
- **状态**：DOING · 主写线
- **验收标准**（可测）
  1. 勾选范围外的方向**完全不产出**（硬开关，与 UI 显示一致）
  2. 有归属 → 产出到归属方向目录；无归属 → 退回全局勾选
  3. 产出目标 = 图片归属方向本身，命名段取归属方向，与勾选层级无关
  4. `npm run verify` 全绿
- **影响面**：`src/store.ts`、`lib/taskPostprocess.ts`、`features/projectTree/*`、`PostprocessSettingsModal.tsx`
- **已知坑**：新素材 `collectionIds` 默认为空，「任务完成→触发后处理」与「素材异步归档」是两条并发线
  → 需有界等待（`resolveImageOwnership`，2s / 250ms 步长）
- **回滚点**：`git revert 5e0b685`

### TB-015 水印预设升为顶栏 tab，归属与参数分离

- **来源**：杰哥原文「重写需求」（2026-09-18 第三轮）
- **状态**：DOING · 主写线
- **验收标准**
  1. 水印预设是与画廊 / Agent 一致的顶栏 tab，弹窗形态已删除
  2. 归属树只做一件事：一个方向绑定哪些水印预设；不挂任何标注标签
  3. 后处理弹窗的水印来源 = 归属配置，不是水印库全局值
  4. 预设组概念已从类型与持久化中消失（`storeV2` 落盘 v4 → v5，丢弃式迁移）
  5. `npm run verify` 全绿
- **知情取舍**：`undefined`（继承）与 `[]`（显式不加水印）在树上不再可区分，只剩「恢复继承」出口的有无
- **回滚点**：`git revert 4aa04dc` + `31f1ad6`

### TB-016 M1 阶段 4 剩余：迁移用户改过的旧编排规则

- **状态**：TODO · 阻塞：无
- **说明**：`createDefaultCompositeV2OutputRuleGroups()` 与 `lib/postprocessMedia.ts` 的
  `DEFAULT_POSTPROCESS_MEDIA` 完全重复（同 4 媒体 / 15 尺寸 / maxKb 399·299·99·80）
  → **默认值无需映射**，只需搬用户改过的规则
- **验收标准**：迁移脚本对"默认未改"与"用户改过"两类分别处理且有测试；老库升级后产出目录与迁移前一致
- **回滚点**：迁移前 `backup-before-*`

### TB-017 全局启用范围交杰哥定

- **状态**：TODO · 阻塞：**等杰哥拍板**
- **背景**：`selectedMediaIds` 现为 `["clean","gdt"]`，而《输出位置明细》覆盖四渠道
  → 只开广点通时，按渠道配好的目录不会展开；`selectedCollectionIds` 仍只有 1 个方向（没勾就完全不跑）
- **为什么 AI 不做**：这是人的决策，不是技术判断

### TB-018 无文案水印（仅图标 / 空白）覆盖

- **状态**：TODO · 阻塞：**等图标素材到位**
- **背景**：源表 100 行仅图标或空白水印分布在 28 个方向；本机找不到图标素材
  （素材库 0 条、内置只有 `app-icon.png` / `icon.ico`、NAS 浅层未搜到）

---

## M2 · 生成链路稳健性

### TB-019 三次事故的回归用例

- **状态**：DONE（2/3）· ① 转 TB-032
- **验收证据**（2026-09-18 复核）
  1. ⏳ 程序性改写 prompt 不被 DOM 回读覆盖 → **转 TB-032**。
     复核发现 `isUserInputRef` 在 `InputBar.tsx` 有 **18 处**引用（不止先前记录的 4 处），
     且渲染整个 `InputBar` 需 mock 20+ 模块 → 直接写渲染级测试的**投入产出不划算**。
     正确顺序是**先收口再测**（TB-032）。
  2. ✅ 收尾写入不让 `outputImages` 变短 → `src/lib/generatedOutputImages.test.ts`
     （15 例，含 `pickMoreCompleteOutputIds`）
  3. ✅ 看门狗超时后迟到结果仍被收下 → 同上（`canSettleTaskOutputs` 5 例）

### TB-020 覆盖率基线

- **状态**：DONE（2026-09-18）
- **验收证据**：`npm run test:coverage` 可一键跑出报告（`@vitest/coverage-v8` + CLI 参数，
  **不改 `vite.config.ts`** —— 改它会重启正在运行的 dev）。
  首次基线（238 文件 / 2535 用例全绿）：

  | 指标       | 覆盖率                    |
  | ---------- | ------------------------- |
  | Statements | **60.16%**（23488/39040） |
  | Branches   | **52.65%**（16009/30404） |
  | Functions  | **57.87%**（5478/9465）   |
  | Lines      | **62.47%**（20649/33052） |

- **刻意不设门槛**：先能看见，再决定卡在哪一层。**不进 CI**（避免拖慢流水线 + 下述环境坑）
- **已知环境坑**：跑完会打印一条 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 的
  `Unhandled Error`（vitest 收尾清理 `coverage/.tmp` 时被安全删除护栏拦住，命中 239 个文件）。
  **报告已生成，无害**；但退出码可能非 0，所以不要把它直接接进 CI。

### TB-021 收紧未使用符号门禁

- **状态**：DONE（2026-09-18）· **存量 114 处已全部清零，规则直接收紧为 `error`**
- **最终形态**：`@typescript-eslint/no-unused-vars` 与 `@typescript-eslint/no-explicit-any`
  在 `src/**` + `electron/**` 上**均为 `error`**（`eslint.config.js`）。CI 的 Lint 步骤即守卫 —— **新增即红**。
- **棘轮已退役**：原 `scripts/check-unused-symbols.mjs` + `unused-symbols-baseline.json` **已删除**，
  CI 里的对应步骤也一并移除。理由：棘轮是"存量无法一次清零"时的过渡手段；
  存量清零后它与 `error` 规则功能重叠，留着就是两个机制管同一件事（违背单一真相源/简单优先）。
- **清零过程（可复用的操作要点）**
  1. 按"零风险 → 需判断"分层：import 类 → 解构/局部变量类 → 死函数与多行常量类。
  2. 批量替换**必须校验唯一性**：命中数 > 1 就报错停下，绝不"改第一个"。
  3. 多行函数/常量用**括号配平**定位边界（扫描时跳过字符串与注释里的括号）。
  4. ⚠️ **必须用 `tsc` 立刻复验**。本次 tsc 抓出两处真错：
     - `store.ts` 同一行 import 里**只有 `getChangedParams` 未被使用**，误删整行 →
       `normalizeParamsForSettings` 8 处断层（eslint 的报错粒度是"符号"，不是"行"）。
     - 我用"文本出现序号"替换，但 eslint 报的是**行号**，二者不等价 → 改错了
       `promptGenerator.test.ts` 里两处**正在使用 `text`** 的用例。
  5. 删除死代码会暴露**级联死符号**（114 → 39 → 8 → 0），需要迭代，不是一轮能完。
- **净效果**：**删除 600+ 行死代码**（`DetailModal` 4 个未使用 handler、`store.ts` 5 个未使用函数
  与 12 处死 import、`AppShell` 的 `LegacyStrategyPage` 235 行、`AgentBatchPlannerModal` 的
  `splitSelections`、若干个已废弃的 `state`/`setter` 组合等）。
- **验收证据**：`npx eslint .` **零输出**（0 error / 0 warning）；
  `tsc -b` 通过；`npm run verify` 全绿；**删除后 238 文件 / 2535 用例零回归**。
- **依据**：`docs/project-health-audit.md` P2-10 / `RISK.md` R-10

### TB-022 `store.ts` 拆分

- **状态**：TODO · 阻塞：需随 TB-023 一起做
- **约束**：**不要单独开一个大重构**（13346 行，风险收益不划算）
- **验收标准**：主 store 不再反向 import feature；收藏/集合只剩一个真相源

### TB-023 收藏与集合状态归一

- **状态**：TODO
- **背景**：`favoriteCollections`（主 store persist v4）与 `assetLibrary/store.ts` 的 `collections`
  （persist v6）并存，靠 `store.ts:487` 直接读另一个 store 桥接
- **代价**：加一个字段要改两处 + 写两批迁移，漏一处即静默不一致
- **验收标准**：单一 schema、单一迁移；老库升级验证通过

---

## M3 · 数据可恢复性 / 项目管理基建

### TB-024 把机制挂进 `AGENTS.md`

- **状态**：DONE（2026-09-18）
- **验收证据**：`AGENTS.md` 新增「## 项目管理（开工前必读）」一节（在「项目概况」之后），
  含单一真相源表 + 开工三条 + 收工六步 + 三条禁令；已通过 `npx prettier --check AGENTS.md`

### TB-025 记忆资产纳入版本控制

- **状态**：DONE（2026-09-18）· **收敛为「只入库 MEMORY.md」**
- **验收证据**：`.gitignore` 改为白名单（`.workbuddy/*` + `!.workbuddy/memory/MEMORY.md`）；
  `git ls-files --others --exclude-standard .workbuddy/` **只输出 MEMORY.md**，两个过程日志仍被忽略
- **决策变更**：原计划入库全部记忆。**实测仓库是 public**（`api.github.com` → `visibility: public`），
  过程日志含本机路径、第三方服务商域名、备份目录名 → **日志改为留在本地**，
  只入库脱敏后的 `MEMORY.md`。扫描确认**无完整凭据**（命中的只有 `github_pat_…` / `gho_…` 这类前缀示意）
- **残留风险**：日志仍只在本机 → 但其硬结论已全部沉淀进 MEMORY / RISK / runbook / ADR 且都已入库

### TB-026 `MEMORY.md` 分层压缩到 ≤10KB

- **状态**：DONE（2026-09-18）
- **验收证据**：重写为「文档地图 + 身份构建发布 + 铁律表 + 高频入口」；
  细节迁出到**新建 `docs/architecture-constraints.md`**（性能基线 / 生图编排 / 协议约束 /
  后处理与项目树模型 / 持久化 / 任务落盘完整性 / UI 约定 / `InputBar` 双写）
- **背景**：一天内因超限被压缩 4 次（22830 → 17825 → 24400 → 17900 → 16745 → 10069 字节）

### TB-027 风险登记册

- **状态**：DONE（2026-09-18，`docs/RISK.md`）
- **验收证据**：29 条 R/P/Q 分级，含触发条件 / 检测 / 缓解 / 状态；`MEMORY.md` 陷阱节已改为指向 `R-##`

### TB-028 `docs/` 生命周期分拣 + 索引

- **状态**：DONE（第一版，2026-09-18）· **归档移动待做**
- **验收证据**：`docs/README.md` 列出全部条目并标注 现行/参考/归档；豆泡时代 6 份产物已标基线版本；
  本批新增的 `architecture-constraints.md` / `pm-upgrade-plan.md` 等已登记
- **剩余**：把「归档」类**实际移入** `docs/archive/`（未做 —— 避免大范围移动造成引用失效，建议单独一次做）

### TB-029 并行写线协议落地

- **状态**：TODO · 部分完成
- **已完成**：`docs/work-protocol.md`（worktree 命名 + 端口/userData 约定表 + 交接三件套 + 角色边界）
- **剩余**：连续 3 周无"并行导致"的事故
- **依据**：`RISK.md` R-01

### TB-030 自动备份策略

- **状态**：TODO
- **背景**：`userData/backups/` 是空的 —— 配置被重置那次**没有自动备份可救**，只能靠手工 `backup-before-*`
- **验收标准**：启动或每日自动留存一份 `api-secrets.bin` + `asset-kernel.sqlite`；保留策略明确

### TB-031 清理豆泡时代残留与工作区

- **状态**：TODO · 工作区部分已完成
- **已完成**：工作区未提交改动已分类提交（功能修复 1 个提交 + 项目管理基建 1 个提交）
- **剩余**：`release/` 里的旧版本安装包（`AGENTS.md` 要求只留最新）、`release-0.8.14/`、
  `dist-verify/` 等磁盘残留 —— **属破坏性操作，需杰哥确认后再做**

### TB-032 收口 `contentEditable` 双写模式（新发现，2026-09-18）

- **状态**：TODO · 阻塞已解除（"需停 dev"不再是限制）
- **本轮进展**：两个涉及组件的死符号已随 `TB-021` 清空（含 `PromptVariableEditor` 的两处死 import），
  收口时可少绕一步
- **发现**：`getContentEditablePlainText` 与 `isUserInputRef` 这套"prompt 双写"模式在
  **两个组件里各实现一份** —— `InputBar.tsx:374`（`isUserInputRef` 有 **18 处**引用）
  与 `PromptVariableEditor.tsx:30`
- **问题**：靠"记得在每个程序性改写入口复位标志"维持，**漏一处就是静默失效**
  （「选了尺寸比例没生效」就是这么来的，`RISK.md` R-13）
- **验收标准**
  1. 抽出一个可测模块（放 `src/lib/`）：`createPromptDualWriteController` 或等价物，
     把「标志复位 + DOM 文本比对 + 写回」收成一个入口
  2. 两个组件都改用它，**不再各自维护标志**
  3. 该模块有单测覆盖：程序性改写 → DOM 必须更新；用户输入 → 必须跳过（光标不跳）
  4. `npm run verify` 全绿
- **收益**：把 TB-019 ① 从"渲染整个 InputBar"降级为"测一个纯模块"，
  同时消灭一处**重复实现**（与 `P2-6` 的六份 sanitize 同类）

---

## M4 · 冗余清理（2026-09-18 盘点，**待杰哥确认后再动手**）

> 完整证据链与执行顺序见 `docs/redundancy-audit.md`。删除属破坏性操作，**未经确认不执行**。
> 盘点规模：约 7000 行（A 档 ~5470 / B 档 ~200 / C 档 ~300 / D 档待定）。

### TB-034 删除零引用文件（A2 档，992 行）

- **状态**：✅ **DONE（2026-09-18，commit `a7c5a06`）**
- **实际净删**：16 文件 / **+68 −1360**（含 4 个只测这些模块的测试文件）
- **执行记录**：同步清 `catalog.ts` 的 4 条登记 + `compliance.test.ts` 的 1 行白名单；
  `tsc` 通过、`eslint` 零告警、`npm test` 234 文件 / 2513 用例全绿
- **内容**：`TaskGrid.tsx`(516) / `SupportPromptModal.tsx`(120) / `legacyTagsToCollections.ts`(116) /
  `SearchBar.tsx`(95) / `wordEntryGroups.ts`(51) / `assetDerivation.ts`(41) /
  `WordLibrarySidebarToggle.tsx`(27) / `collectionPath.ts`(26)
- **前置**：同步删 `design-system/catalog.ts` 的登记（否则 `compliance.test.ts` 红）；用 `rm` 不用 `git rm`
- **验收标准**：`npm run verify` 全绿；无残留引用

### TB-035 合并 9 组重复实现（B 档）

- **状态**：✅ **DONE（2026-09-18）** —— 9 组全部收敛，共享实现 +6 个模块
- **新建的唯一实现**：`lib/contentEditableText.ts`、`lib/pathBaseName.ts`、`lib/typeGuards.ts`、
  `lib/clamp.ts`、`lib/escapeRegExp.ts`、`lib/browserStorage.ts`
- **收敛明细**：`getContentEditablePlainText` 2→1、`getPathBaseName` 2→1、
  `isRecordValue`+`isRecord` **5→1**（这两组原本是同一个函数，分散在 agentApi / agentWebSearch /
  openaiCompatibleImageApi / apiProfiles / store 五处）、`getStorage` 3→1、`escapeRegExp` 3→1、
  `clamp` 3→1、`isDataUrl` 2→1（并入 `imageApiShared`）、`getDataUrlDecodedByteSize` 2→1（并入 `imageApiShared`）
- **⭐ 两处「看着像重复、其实语义不同」—— 必须保留差异，不能一刀切**：
  1. **`getStringValue`**：`agentApi.ts` 原实现是「非空即返回」（**不 trim**），另两份是「trim 后非空」。
     → 抽出两个具名导出 `getStringValue`（trim）与 `getUntrimmedStringValue`（不 trim），
     并在模块注释里写明差异来源，避免后来者再合并成一份
  2. **`getDataUrlDecodedByteSize`**：`imageApiShared` 用「字符数 + 无 try/catch」，
     `sopReferenceImageCompression` 用「TextEncoder 字节数 + 容错」。→ 取**健壮版**为唯一实现；
     实测调用方（`falAiImageApi` / `openaiCompatibleImageApi` 的遮罩主图与遮罩文件）**全部传 base64**，
     非 base64 分支的行为差异不影响线上路径
- **一处类型收窄副作用**：`isDataUrl` 迁移到类型守卫版（`value is string`）后，
  `dataUrls.map((d) => (isDataUrl(d) ? null : d))` 的负向分支被收窄成 `never`，
  数组从 `(string|null)[]` 推断成 `null[]` → 改为显式标注 `Array<string | null>` 并加注释
- **踩坑**：写批量插 import 的脚本时，`/^type\s/` 会匹配到 `type Xxx = {` 类型声明体，
  导致 import 被插进声明内部（4 个文件语法直接崩）。→ **判断"是否顶层语句"不能只靠开头几个字符**，
  必须判断该行是否完整结束了语句
- **明确不做（已核实）**：路径净化 4 份（前三份共享内核 `sanitizeFileNameCore`、
  第四份**先压空白再剥非法字符**，有测试断言依赖）、`escapeHtml` 3 份（字符集与用途不同）、
  `formatDate`（入参与格式各异）
- **验收证据**：`tsc -b` 通过、`npx eslint .` 零告警、`npm test` 225 文件 / 2470 用例全绿

### TB-036 删除「策略编辑 + 下单」孤岛（A1 档，4479 行）

- **状态**：✅ **DONE（2026-09-18，commit `f925b99`）**
- **实际净删**：16 文件 / **−4835 行**（14 个源文件/测试 + catalog 与 page-coverage 登记清理）
- **⚠️ 执行中发现的连带项**（只清入口映射不够）：`catalog.ts` 里除 10 条 `legacyComponentCoverage`
  条目外，还有 **3 条 `pageCoverage` 条目**（strategy / ordering / requirement-prototype）——
  **是 `page-coverage-regression.test.tsx` 的「无多余登记」断言把它们抓出来的**。
  这正是该测试存在的意义：删工作区必须同时清「组件登记 + 页面登记 + 入口映射」三处。
- **验证**：`tsc` 通过、`eslint` 零告警、`npm test` 232 文件 / 2507 用例全绿
- **根因**：`App.tsx:31` / `Header.tsx:24` 已说明 strategy 工作区屏蔽，但编辑子树仍在代码里；
  孤岛根 `requirementPrototype/AppShell.tsx` **实测 0 处引用**
- **顺序**：**从叶子删到根**（叶 → 中间层 → `AppShell.tsx`）—— 反过来会一次炸出几十个编译错误
- **⚠️ 必须保留**：`strategy/model.ts` + `strategy/contracts.ts`（被 `requirementPrototype/store.ts:15` 使用）、
  `ordering/planner.ts` + `ordering/types.ts`（被 `requirementPrototype/planner.ts` re-export）
- **验收标准**：`npm run verify` 全绿；若同时收敛 `AppMode` 的 `strategy`/`ordering`，
  则 `store.ts:2293-2295` 的归一化与 `:3407` 的分支要同步改

### TB-037 清理兼容残留（C 档）

- **状态**：✅ **主体 DONE（2026-09-18）** ① `cd410fd`（−2730）· ② 真死 state/action（同批）
- **① 已完成（`cd410fd`）**
  1. **`galleryViewMode` 死字段** —— 两处写入方 `assetCommands.ts:116`(addReference) / `:167`(reuseTask)
     写的都是常量 **`'tasks'`**，而唯一读取方 `InputBar` 只判断 `=== 'images'` → **两个分支永不可达**。
     已删 InputBar 的订阅与两处分支、`store` 的字段与 setter、`lib/galleryPreferences.ts`，
     连带删除 `selectedGalleryImageCount`（唯一消费者）。**无独有偶：`filterStatus` 同型**
     （初值 `'all'`、`setFilterStatus` 零调用、InputBar 与 `galleryTaskFilter` 在读），一并处理。
  2. **标签体系 UI**：删 `AssetTagChips.tsx`（**零引用**）与 `AssetLibraryTagSection.tsx`
     （**M18 移除标签体系时漏删**，仅剩自己的测试引用）→ 这是 `PRODUCT.md` M18 写了、代码没清的典型。
     **数据层一律未动**：`AssetTag` 类型、`tagIds`、SQLite/IndexedDB 标签表、备份 v6/v7 的 `assetTags`
     继续读写（`AssetLibraryTagSection` 的 `buildTagTree`/`flattenTagRows` 一并删除）。
  3. **`AssistantActionBar.tsx`（1567 行）** 零生产引用，仅 catalog 一条登记 → 删除。
     ⚠️ `features/assistantActions/` **整体是活的**（`builtInActions`/`matcher`/`runner` 均有引用），
     本次只删这一个组件，不是整目录。
- **② 已完成（真死 state / action）**
  - **纯写入、零读取**（连「静默常量」都算不上，因为根本没人读）：`galleryNavigateTaskId`、
    `varEntryEditor` + `VarEntryEditorConfig`、`wordLibrarySidebarOpen`/`ManagerOpen`/`EditEntryId`/
    `PromptSelectedVarName`（组件已随 TB-038 删除）、`supportPromptOpen`（SupportPromptModal 已删，
    无人写 true）、`agentAssetTab`、`agentAssetPanelCollapsed`、`workspaceTabBarExpanded`、`filterStatus`
  - **死文件**：`lib/galleryTaskFilter.ts` + 其测试（零生产引用）
  - **死函数**：`clearFailedTasks`（71 行，零引用导出）
  - **no-op 残留**：`store.ts` 水合期的 `setState((s) => ({ wordLibraryEditEntryId: s.wordLibraryEditEntryId }))`
    连同 `shouldRewriteWordLibraryLocalState` 一并删除（自赋值，逻辑空转）
- **⚠️ 刻意保留（`stopTask` 及其链路）**：`stopTask`(`store.ts:335`) 虽零引用，但它是
  `docs/code-optimization-audit.md` 第 1 项**明确要求接线的能力**（`taskAbortControllers` +
  三个 `clear*RecoveryTimer`）。删它会连带抹掉已实现的中止基础设施 → **保留，记为待接线项**
- **验收证据**：`tsc -b` 通过；`npx eslint .` 零告警；`npm test` 全量通过
- **踩坑**：同一个脚本里按行号做多次删除会**互相位移**（先删了 3 行导致后续整段偏移 3 行）。
  解决办法：**一律按内容定位**（trim 后精确匹配 + 期望命中计数），必要时用完再复核；
  接口声明与实现是**两段不同文本**，删实现必须同步删 `AppState` 接口声明，否则报
  「缺少属性」而不是「多余的键」

### TB-038 彻底下线词条库（D 档 · 已拍板）

- **状态**：✅ **DONE（2026-09-18）** ① UI 层 `6fda217` · ② 链路层（同批提交，见下）
- **① 已完成内容**（UI 层下线）：删除 `WordLibraryQuickPanel`(328) / `WordLibraryDerivativePanel`(409) /
  `WordLibraryManagerModal`(965) / `VarEntryEditor`(147) 及 3 个测试；
  `WordLibrarySidebar.tsx` 改造为**纯素材详情面板**（592 → 约 260 行，摘掉「词条」Tab 与全部词条逻辑）；
  `App.tsx` 删除 2 个 import + 2 个挂载；`catalog.ts` 删 4 条登记；
  `WordLibrarySidebar.test.tsx` 改写成「不再有 tab」+「无详情返回 null」两条断言。
  净删 **+50 −2476**，`npm test` 229 文件 / 2498 用例全绿。
  ⚠️ 两个 localStorage key（`wordLibrarySidebar_pos_v2` / `_dock_v1`）**保留原字面量**，
  改掉会让用户已保存的面板位置与停靠状态丢失。
- **③ 已完成：数据层彻底退役（2026-09-18 杰哥拍板「彻底退役」）** —— 净删 **−1977 行 / 16 文件**
  - **store.ts**：删 6 个纯函数（含 `replaceStoredWordLibrary`）、state 三字段（`wordLibraryGroups/Entries`、
    `wordGenerationBatches`）、全部 CRUD action、序列化/反序列化、IDB 持久化订阅与 debounce 落盘、
    启动水合、备份导出清单与导入合并整段
  - **db.ts**：删 `StoredWordLibraryState` / `getWordLibraryState` / `putWordLibraryState` 与旧版导入的
    词条分支。**刻意保留** `STORE_WORD_LIBRARY` 常量与 `createObjectStore`（旧库已含该 store，
    保留创建语句可确保任何残留老库仍能打开；代价 3 行）
  - **types.ts**：删 `WordLibraryGroup/Entry/GenerationBatch/ExportData` 四个类型与 `ExportData` 三字段。
    ⚠️ **保留** `wordLibraryDerivativeRule*` 与 `WordLibraryDerivativeRule`（属设置项，被
    `lib/agentApi.ts:1883` 使用，与词条库数据无关）
  - **连锁发现：`RandomPromptModal.tsx`（316 行）是死 UI** —— `setRandomPromptModalOpen`
    **只被它自己调用**，无任何入口能打开它；而它唯一的业务价值就是词条库通配符抽取。
    连同 `lib/promptGenerator.ts`（唯一使用者）与 catalog 登记一并删除
  - **图片引用图**：删 `strategy-reference` 里「词条生成参考图」这一来源；归属判定原本是
    `if (词条批次) wordBatchIds.add else strategyIds.add` → 改为直接 `strategyIds.add`
  - **老备份兼容结论**：主路径未知字段被**静默忽略**、旧版记录导入 `putIfMissing` 不执行 —— **不报错**；
    唯一会报错的是 `ipc-handlers.ts` 的「空备份判定」，已同步删 `wordLibraryEntries` 条件。
    → **老备份中的词条数据将不再恢复，其余数据照常导入**（这是「彻底退役」的既定代价）
- **⚠️ 刻意保留**：`stopTask` 及其中止器链路（见 TB-037）；
  `features/assistantActions` 的 `WordEntryConfig` / `AssistantWordEntryGroup`（**另一个功能**：
  AI 助手动作配置，不读词条 state，不在本次退役范围）；`WordLibrarySidebar.tsx` 的文件名与两个
  localStorage key（改掉会丢失用户已保存的面板位置与停靠状态）
  - `InputBar.tsx`（5565 行）摘除 22 处：7 个 store 订阅、`VAR_COLOR_MAP` + `activeWordLibraryKeys`、
    `normalizePromptVariableMarkers` effect、`handleConvertToVariable`（划词转变量）、双击 `wildcard-var`
    打开编辑器、右键「变量还原为文本」+ 4 个拖拽 handler、两处「转换为变量」按钮、
    prompt 渲染的 variable 支、6 处 `wildcard-var` 选择器、`getContentEditableOffsetFromPoint`（失消费者）
  - ⚠️ **保留 `mention-tag`（图片 @ 引用）全链路** —— 它与变量无关，误删会导致点图片引用无反应
  - 删除两个变量专用 lib：`promptVariableEditor.ts`（`normalizePromptVariableMarkers` /
    `replaceVariableNameInPrompt`）、`promptVariableColors.ts`（6 色变量色标）+ 各自测试
  - `PromptVariableEditor.tsx`（219 → 约 105 行）改造为「可编辑提示词 + 图片 mention 高亮」，
    删掉 `onVariablePromptChange` prop 并同步 `TaskCard.tsx` 调用点
  - `DetailModal.tsx`：删 import、`VAR_COLOR_MAP` 订阅与 variable 渲染支
  - `index.css`：删 `.wildcard-var` 全部样式（含 `--var-*` 自定义属性消费）
  - `lib/promptImageMentions.ts`：删 12 个变量符号（`VAR_*` / `createVariableMention` /
    `parseVariableMention` / `resolveVariableMentionEntry` / `resolveVariableValue` /
    `convertVariableMentionAtVisibleOffsetToText` / `moveVariableMentionInPrompt` /
    `VariableResolver` / `TEMPLATE_VARIABLE_RE` 等）+ `replaceImageMentionsForApi` 去掉
    `variableResolver` 参数；`store.ts` 3 处调用同步
  - ⚠️ **最关键的一处副作用修复**：`normalizePromptVariableMarkers` 处理的是**不可见标记**
    （`\u2060…\u2061`）而非字面 `{{}}`；删掉后历史任务/草稿里的残留标记会**原样发给模型**
    （`\u2060` 是 WORD JOINER，会导致文本粘连）。已在 `replaceImageMentionsForApi` 出口补
    `stripImageMentionMarkers(result)` 兜底（该函数字符集 `[\u2060\u2061\u2062\u2063\u2064]` 已覆盖）
  - ⚠️ **绝对没动**：SOP 的 `{{}}` 是**独立语法**（`variablePrompt.ts` / `variablePromptMeta` /
    `elementPool` 从正文「可变项：」解析候选值），与词条库零耦合，本次只摘 `promptImageMentions`
    这一条旁路
  - 测试：删 `promptVariableEditor.test.ts` / `promptVariableColors.test.ts`；
    `promptImageMentions.test.ts` 删 9 个变量用例与辅助函数（255 → 161 行）
- **决策依据**：杰哥 2026-09-18 明确「词条库已被 SOP 完全替代，我不需要再用了」。
  ⚠️ 初稿把「彻底下线」评为"不建议"是**错的** —— 那是把「代码是活的」当成了「业务还需要」，
  这类判断只能由产品负责人做。教训与修正过程见 `docs/redundancy-audit.md` §5
- **关键结论（已验证）**：SOP 与词条库**零耦合** —— `variablePrompt.ts:48-137` 的
  `parseVariablePrompt` 只从正文「可变项：」区块解析 options；`storeSopGeneration.ts:615/651/660`
  全程只用模板本身 → **下线不影响 SOP 的批量变量展开**
- **唯一会断的地方**：输入框手打 `{{xxx}}` 旁路（`promptImageMentions.ts:307-310`，
  取值源 `store.ts:9835-9836`）→ 取值失败会 `?? marker` 原样发送（**不崩，但变哑变量**）
- **⚠️ 最大的坑**：`App.tsx:470` 挂的 `WordLibrarySidebar` **同时承载素材详情面板**
  （`WordLibrarySidebar.tsx:530-536`）→ **必须改造，不能删组件**
- **会一并丢失的能力**：划词一键建词条（`InputBar.tsx:1925-1947`）—— SOP 无等价交互，
  若你其实用得上，就要改成"只下线候选池 UI"
- **数据策略**：**删功能、保留字段** —— IDB `wordLibrary` store（`db.ts:667-673`）、
  `ExportData` 字段（`types.ts:1270-1272`）、`legacyDataTransfer` 与备份 v7 链路
  （`store.ts:12468/12977-13047`）**全部保留**，否则老备份导入会丢词条数据
- **执行清单**：见 `docs/redundancy-audit.md` §5「下线执行清单」9 项（按风险从低到高）
- **验收标准**：`npm run verify` 全绿；**素材详情侧栏**与**备份导入**两项功能不受影响

---

### TB-039 数据管理精简整合：收敛为「导出 / 导入」

- **来源**：杰哥 2026-09-19「数据管理、导出导入、自动备份三个功能经常无法正常生效，统一收敛为导出和导入两个功能」
- **状态**：**BLOCKED · 等杰哥裁决 3 点**（方案已出，见 `docs/data-portability-redesign.md`）· 本轮**未改任何代码**
- **⭐ 核心发现：三个功能互相打架，不是各自有 bug**
  - 「自动备份」压根不是独立功能，是**两套互不知情的机制**：`App.tsx:372-405` 每周 ZIP **写桌面**；
    `ipc-handlers.ts:1450` 状态文件快照写 `userData/backups/`。而**设置页备份列表读的是后者**
    （`localSave.ts:1001`）→ 自动备份产生的文件**从不出现在备份列表里**
  - 设置页文案「备份默认保存到素材库的 `backups/`」（`SettingsModal:4312`）与实现（写桌面）不符
  - `createBackupInPath`（`localSave.ts:1019`）**死代码，零调用方**
  - **两个 backups 目录并存**：`userData/backups/`（状态快照）vs `库根/backups/`（ZIP 默认）
- **三个可复现的失效根因（这才是「经常不生效」的答案）**
  1. 原图缺失 → **整包导出失败**，无降级（`store.ts:11567/11656`）
  2. 导入**无事务回滚**，失败后数据更糟（`store.ts:11958/12064`）
  3. 自动备份失败仅 `console.warn`，用户无感（`App.tsx:400`）
- **我的三点不同意见（待裁决）**
  1. **密钥默认不导出**（你原方案是默认导出）—— 明文密钥 + 不加密 ZIP，泄露成本 >> 换机重填成本
  2. **定时备份要含任务**（你原方案默认不含）—— 否则灾难恢复形同虚设；手动导出可以不含
  3. **自动备份并入而非移除** —— C 机制是唯一真在自动跑的保护
- **⚠️ 冲突规避**：**不碰 `src/features/composite/**`**（另一会话正在加水印预设导出导入）。
  已核实：水印预设 `presets` **已在 ZIP 的 `compositeState` 通道里**（`store.ts:11272`），
  建议归入「配置」槽位、默认导出、零改动；对方新增的 `mergeImportedPresets`（`storeV2.ts:88`）
  是独立预设级导入，与本方案并行
- **验收标准**：导出/导入**必须有自动化验证**（当前几乎为零）+ 人工清单见方案 §6.3；
  建议**先做 P1（修稳定性根因）** —— 不动 UI、不碰 composite、直接解决"导出经常失败"
- **已知坑**：`ExportData` 除 `version`/`exportedAt` 外全可选（这个设计很好，继续沿用，
  保证 v3~v7 老包可导入）

---

### TB-040 水印预设导出 / 导入（含树状归属）

- **来源**：杰哥原话「支持将当前水印预设配置导出为文件保存，并支持从文件导入恢复预设，
  方便我分享或导入别人的水印，记得要带树状归属的信息」（2026-09-19）
- **状态**：DOING · 写线：主写线
- **验收标准**（可测）
  1. 导出：库里勾选 → 只导勾选的；未勾选 → 导全部；文件内容含 `presets` + `bindings`
     （路径名数组 + 可选渠道名）+ `identifier`；图片资产内嵌为 dataUrl
  2. 归属只收**显式声明**（`params[节点].watermarkPresetIds` / `byMedia[渠道].*`），
     继承来的不导；节点已删除的不导
  3. 导入：路径逐层匹配成功才写绑定；匹配不上进 `unmatched`，**不自动建节点**
  4. 导入同 id 覆盖且**保留原位**，新 id 追加末尾；本机无标识符时才采用文件里的
  5. 非本功能导出的 JSON / 更高版本 / 空 presets → 明确拒绝，不猜着导入
  6. 单测覆盖收集、解析、路径匹配、导入计划；`npm run verify` 全绿
- **影响面**：新增 `lib/compositePresetTransfer.ts`、`lib/compositeIdentifier.ts`；
  `storeV2`（v5→v6 + `mergeImportedPresets`）、`PresetManagementTab`（导入/导出按钮）
- **已知坑**：导出保存目录受主进程白名单限制（桌面/文档/下载/图片/userData），
  选到别处会写失败 → 已给明确提示；见 RISK R-31
- **回滚点**：本轮改动仅 4 个新文件 + 3 个改动文件，可整包 revert

### TB-041 水印标识符附加（全局一份 · 即时生效）

- **来源**：杰哥原话「提供一个专门的标识符输入位置……有文字的水印按设置在文案开头/结尾/两侧
  附加；没有文字水印的自动在左下角添加；位置可设置且对所有相关水印即时生效」（2026-09-19）
- **状态**：DOING · 写线：主写线
- **验收标准**（可测）
  1. 全局一份配置（`storeV2.identifier`），无单预设例外（已与杰哥确认）
  2. 有可出字的文字层 → 按 `prefix` / `suffix` / `both` 附加；**多行只贴整段首尾**
  3. 无文字水印 → 生成左下角（`anchor: bottom-left`）标识符层，字号按短边比例
  4. 改文本或位置后，画布预览与后处理产出**立即**变化（overlay 缓存键含标识符签名）
  5. 纯空格标识符 = 不启用；标识符**不写回预设**（导出预设不夹带署名写死）
  6. 持久化 v5→v6 补默认值，升级后旧水印渲染结果不变
- **影响面**：`lib/compositeIdentifier.ts`、`compositeRendererV2.ts`（drawLayer + 缓存键）、
  `storeV2`、`PresetCanvasEditor`（effect 依赖加 identifier）、`PresetManagementTab`（输入区）
- **已知坑**：**overlay 缓存键必须含标识符签名**，否则「改了不生效」；见 RISK R-32
- **回滚点**：同上

---

### TB-043 「跑后处理」点了没反应：三条静默路径 + 加载态

- **来源**：杰哥反馈「点击『跑后处理』按钮后没有任何反应，页面也没有任何反馈或提示」（2026-09-19）
- **状态**：DONE · 写线：主写线
- **根因（已用测试复现，非推测）**：按钮事件绑定没问题（store.test.ts「手动后处理入口」全绿），
  问题在**执行链路上有三条完全静默的路径**，且全程没有加载态：
  1. **零产出静默**：`reportPostprocessResult` 只在「有产出 / 有被删媒体 / 有 warning」时提示。
     媒体尺寸全部被禁用时三者皆空（`matchMediaSizes` 返回空 → `units` 为空，且不记 warning）
     → 点了按钮界面毫无变化。
  2. **防重入静默丢弃**：`runManualPostprocess` 命中在飞标记时直接 `return`（无提示）→
     一批还在跑时再点，必然「没反应」。
  3. **异常变未处理 rejection**：`resolveImageOwnership` 在 try 之外，调用方又是 `void x()`
     → 该段任何异常都只进控制台，界面零反馈（自动触发同理）。
  4. **单槽 toast 互相顶掉**：一次结果最多连发 5 条 toast，`showToast` 只保留最后一条（3s），
     成功那条会被后面的 warning 顶掉。
- **验收标准**（可测）
  1. 点击后**立即**出现「开始跑后处理：N 张素材」提示，按钮进入 `loading`（转圈 + 禁用）
  2. 结束后**任何**结果都有且只有一条结论 toast：有产出报数量（附首条原因），
     零产出报「没有产出文件：<原因>」
  3. 在飞期间再点 → 提示「后处理正在运行中」，不再静默 return
  4. 执行前段抛错 → toast「手动后处理失败：…」，不产生未处理 rejection
  5. 错误类文案 ≤80 字且原因在前（`getErrorToastMessage` 超长会截成「操作失败，请查看详情」）
  6. `npm run verify` 全绿
- **影响面**：`src/store.ts`（`executePostprocessImageIds` / `runManualPostprocess` /
  `reportPostprocessResult` / 自动触发兜底）、`stores/runtimeStore.ts`（`postprocessRunning` 计数）、
  `features/assetLibrary/AssetLibraryToolbar.tsx`（按钮 `loading`）
- **已知坑**：fire-and-forget 调用一律要有 catch，见 RISK R-33
- **回滚点**：本轮改动集中在 5 个文件，可整包 revert

### TB-044 导出位置按渠道分别配置（单渠道可双写）+ 命名模板变量中文化 / 光标插入

- **来源**：杰哥原话「当前导出位置只能设置一个全局总路径，无法满足我的需求…命名模板的变量目前仍以英文显示…支持在光标位置直接插入变量」（2026-09-19）
- **状态**：DONE · 写线：主写线
- **改了什么**
  1. **全局渠道级导出位置**：`PostprocessMediaConfig` 新增 `mediaOutputDirs: Record<渠道 id, string[]>`
     （每渠道 1~2 个，上限 `MAX_POSTPROCESS_OUTPUT_DIRS = 2`）。后处理设置「输出与命名」新增
     「按渠道设置导出位置」区块（`features/postprocess/ChannelOutputDirs.tsx`）。
  2. **双写**：某渠道配 2 个位置时，同一份产物两处各写一份、**文件名相同**；渲染只做一次
     （体积压缩是逐档试编码，按位置重渲染会让耗时整倍翻）；产出记录只登记主位置，
     分发（按天排期）两份都排。
  3. **保留默认位置**：原来的「输出目录」改名「默认输出目录」，仍是兜底；渠道配置只是覆盖。
  4. **命名模板变量中文化**：按钮显示中文名（`POSTPROCESS_NAME_TOKEN_SHORT_LABELS`），
     插入的仍是 `{token}`（落盘格式不能改），占位符本身进 tooltip。
  5. **光标处插入**：`insertPostprocessNameToken(pattern, token, selection)` 取代原来的
     `setNamePattern(pattern + '{' + token + '}')`；光标位置记在 ref（点按钮时 input 已失焦，
     现读 `selectionStart` 会被浏览器归零）。设置面板与项目节点参数共用 `NamePatternField`。
- **生效顺序（逐渠道）**：节点渠道 → 节点通用 → 全局渠道 → 全局默认 → 本地保存目录 `postprocess`
- **验收标准**（可测）
  1. 某渠道配两个位置 → 产出后两个目录各有同名文件；配一个 → 只写一个；都不配 → 走默认输出位置
  2. 配了位置但一个都建不出来 → **跳过并提示**，不悄悄写到本地（`outputRoots.test.ts` 有断言）
  3. 旧数据（节点 `byMedia[m].outputDir` 单值，已导入 80 处）行为不变，且能与新的 `outputDirs` 共存
  4. 变量按钮显示中文且 tooltip 带 `{date}`；模板为 `{seq}` 时光标在 0 处点「日期」得 `{date}{seq}`
  5. `npm run verify` 全绿
- **影响面**：`lib/postprocessMedia.ts`（模型 + `resolvePostprocessOutputDirs`）、
  `lib/postprocessNaming.ts`（短标签 + 插入函数）、`storePostprocessMedia.ts`（两个 action + 落盘切片）、
  `features/projectTree/params.ts`（归一化 `outputDirs`）、`features/postprocess/outputRoots.ts`（新增，写盘位置策略）、
  `features/postprocess/taskPostprocess.ts`（双写）、两个 UI（`ChannelOutputDirs` / `NamePatternField`）
- **已知坑**：「节点通用输出目录」比「全局渠道表」优先——节点写了通用值，旗下所有渠道都用它，
  渠道表被盖住；见 RISK R-34
- **回滚点**：本轮 16 个文件可整包 revert（无 schema / 无落盘格式变更，`mediaOutputDirs` 缺失即默认空）

### TB-045 配色与主题系统收敛：移除多皮肤机制，统一为一套设计 Token + 明暗双主题

- **来源**：杰哥原话「配色与主题（皮肤）系统不必沿用我当前的实现：配色方案可以完全重新设计，若皮肤/换肤系统会增加复杂度或影响可维护性，也可以直接移除。请按你认为的最优解来实现，优先保证视觉统一、结构清晰和代码简洁，包括重新整理颜色变量（统一为一套设计 token）、清理冗余的主题切换逻辑。」（2026-09-19）
- **状态**：DONE · 写线：主写线
- **决策依据**：`docs/adr/0008-unify-color-system.md`
- **改了什么**
  1. **移除多皮肤（换肤）机制**：删除 `src/theme/styles/skins/`（5 套皮肤 1175 行）、
     `skins.css`（717 行 / 143 处 `:is(:root[data-skin='X'],…)` 工具类重映射）、
     `skinContract.test.ts`（219 行 WCAG 矩阵）、`src/design-system/skin.tsx`、`src/lib/theme.ts`。
  2. **重新设计配色**：`styles.css` 的 `:root` / `.dark` 全量替换为 28 个 `--ds-color-*` Token；
     以模板 00009（xAI-inspired）的克制制度为基底（描边承载层级、不用阴影堆浮起感），
     但按明亮桌面工具重新设计浅色态，品牌蓝（hue 221）保留为 primary。
  3. **清除双轨冗余**：删除 `index.css` 的旧桥变量（`--background` / `--foreground` / `--muted` /
     `--sidebar` / `--input` / `--primary`，**实测 0 消费**）与 `--skin-blue-*` 色板；
     `tailwind.config.js` 删除对应映射与整个 `blue.*` 色板。
  4. **主题逻辑收敛**：`registry.ts` 从皮肤注册表改造为主题注册表（`SKIN_REGISTRY` → `THEME_REGISTRY`）；
     `applyAppearance` 只保留 `themeMode`；顶栏「配色（调色板）」按钮删除（与明暗按钮是同一件事）；
     `ColorSchemeSwitcher` + `ColorPresetGrid` 合并为单一 `ThemeSwitcher`。
  5. **迁移改为丢弃式**：`migratePersistedState` 无条件丢弃旧存档的 `skinId` / `colorScheme`
     （保留字段会让人误以为还能换肤）。
  6. **主题过渡不再全局扫描**：`.theme-transitioning *` → `.theme-transitioning [data-theme-transition]`。
  7. **文档清理**：删除 `docs/skin-authoring-guide.md`（437 行）、`docs/skin-export-jank-analysis.md`；
     同步更新 `COMPONENTS.md` 组件表、`docs/adr/README.md` 索引（补登 0006–0008）。
- **验收标准**（可测）
  1. 全仓 `data-skin` / `SKIN_REGISTRY` / `ColorSchemeSwitcher` / `skins.css` 引用为 0
  2. 浅色 `canvas = 218 24% 96%`、深色 `canvas = 220 14% 5%`，且 `dark` class 切换后
     `document.documentElement.getAttribute('data-skin')` 为 `null`（实测已验）
  3. 全部文字 / 表面组合通过 WCAG AA（`text-subtle` 4.19:1 → 4.82:1）
  4. 相邻表面可辨：浅色 canvas↔surface ≥ 1.10:1（实测 1.102:1）、深色 ≥ 1.10:1（实测 1.134:1）；
     描边 vs 两侧表面 ≥ 1.3:1
  5. 无详情面板时 `--app-docked-right-width` 为 `0px`，主区宽度 == 视口宽度（实测 1258/1258）
  6. `migratePersistedState` 对含 `colorScheme` / `skinId` 的旧存档均丢弃且保留 `themeMode`
  7. `npm run verify` 全绿（226 文件 / 2511 用例）
- **二次修正（2026-09-19，杰哥反馈「怎么没看出什么区别」）**

  首版方案**结构对、取值错**，是一次典型的失败：

  | 问题               | 事实                                                                                      | 修正                                                               |
  | ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
  | **等效值**         | 首版浅色画布 `220 20% 98%` 与旧值 `210 20% 98%` 换算后**同为 `#f9fafb`**；描边只差 2 色阶 | 改用明度差表达层级：浅 `#f2f4f7`↔`#ffffff`；深 `#0b0c0f`↔`#191b1f` |
  | **alpha 抹平层级** | 侧栏 `bg-ds-surface/50`、顶栏 `bg-ds-surface/90 backdrop-blur-sm` 让灰画布透出            | 布局级面板一律不透明 `bg-ds-surface`；仅浮层/抽屉保留透明度        |
  | **存量缺陷被暴露** | 右侧 340px 空白：`WordLibrarySidebar` `return null` 未卸载 → 占位变量不释放               | effect 判定改为 `detailAvailable && !compactViewport`（R-39）      |
  | **暗色层级不足**   | 首版 `canvas 6%` / `surface 10%` 只差 4 色阶                                              | 拉开到 5% / 11%，并抬亮描边（30% → 32%）                           |

  **核心教训**：HSL 在亮度 > 96% 时色相/饱和度几乎不影响 sRGB。改表面色**必须换算 hex 逐条比对**，
  且相邻表面要 ≥ 1.10:1 才有肉眼可见差异。已写进 runbook 第十节 + `RISK.md` R-38/R-39。

  改动文件：`styles.css`、`tokens.tokens.json`（28×2 全量重算）、`tokensContract.test.ts`、
  `AssetLibrarySidebar.tsx`、`AssetLibraryWorkspace.tsx`、`AssetTile.tsx`、
  `Header.tsx`、`WordLibrarySidebar.tsx`、`index.css`

- **影响面**：`design-system/styles.css`、`design-system/tokens.tokens.json`、`design-system/tokensContract.test.ts`、
  `index.css`、`tailwind.config.js`、`theme/registry.ts`、`theme/appearance.ts`、`main.tsx`、`App.tsx`、
  `store.ts`、`types.ts`、`lib/apiProfiles.ts`、`components/Header.tsx`、`components/SettingsModal.tsx`、
  `design-system/themeSwitcher.tsx`（新增）、`design-system/catalog.ts`、`design-system/DesignSystemPreview.tsx`、
  `components/WordLibrarySidebar.tsx`、`features/assetLibrary/AssetLibrarySidebar.tsx`、
  `features/assetLibrary/AssetLibraryWorkspace.tsx`、`features/assetLibrary/AssetTile.tsx`
- **已知坑**：改 `.dark` 的值必须同步 `tokens.tokens.json` 与 `tokensContract.test.ts` 的
  `DARK_COLOR_VALUES`，否则 `tokensContract` 会红（该测试钉死精确值，见 R-37）；
  改表面色必须验算 hex（R-38）；停靠面板占位要对齐可见性（R-39）
- **回滚点**：本轮改动可作为整包 revert；但**不要**只回滚 `styles.css` 而保留已删的皮肤文件
  （皮肤 CSS 依赖已删除的 `--skin-blue-*` 变量，会得到错乱外观）

- **第三轮：UI 细节一致性收口（2026-09-19，杰哥要求「对照设计规范逐一核对」）**

  前两轮解决了**颜色层级**，本轮补**组件与排版细节**。做法：把 `MASTER.md` 当验收清单逐条核对。

  | 项                    | 发现                                                                                           | 处理                                                                                                    |
  | --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | **§4.2 文档过期**     | MASTER.md §4.2 颜色表 26 个值里 **24 个**与实现不符（文档 `Canvas #F9FAFB` vs 实现 `#F2F4F7`） | 用脚本从 `styles.css` 反算 hex 重写全表；新增 `docColorTable.test.ts` **逐行断言**锁死（R-41）          |
  | **§4.5 圆角两套命名** | 裸 `rounded-lg`(8px) 与 Token `rounded-ds-md`(8px) **同值不同名**；规范要求卡片/面板 12px      | 逐点修正真卡片为 `rounded-ds-lg`；存量 376 处建**棘轮快照**只减不增（R-42）                             |
  | **§4.5 阴影**         | 8 处写死数值的临时阴影 + 8 处 `shadow-xl/2xl`                                                  | 全部收口到 `shadow-ds-sm/md/lg`；新增 `--ds-shadow-inner` Token 收编 `shadow-inner`（画布内嵌预览专用） |
  | **§4.3 字号**         | 14 处体系外 `text-[15px]` / `[13px]` / `[17px]` / `[12px]`                                     | 归一到 `text-ds-xs/sm/md/lg`（Agent 聊天正文 15→16px，符合「长文本 16px/1.65」）                        |
  | **§4.3 字重**         | 同名标题「导入旧版数据」在 `SettingsModal` 用 700、在 `LegacyDataImportModal` 用 600           | 同角色统一 `font-semibold`；SettingsModal 改 13 处、HelpModal 改 7 处                                   |
  | **§4.2 焦点色**       | 焦点环碎片化成 **7 档**不透明度；`GallerySopBatchModal` 33 处误用品牌色当焦点环                | 收敛为 `/70`（标准）+ `/50`（轻量）两档；33 处改回 `ring-ds-focus`                                      |
  | **§4.6 半透明面板**   | `SettingsModal` 20 处输入框 `bg-ds-surface/60` 叠在 raised 底上 → 边界不可见                   | 改 `bg-ds-surface-subtle`；`AgentWorkspace` / `InputBar` / `FavoriteCollections` 同类共 8 处一并收口    |
  | **§4.4 派生间距**     | `pl-[26px]` 写死「图标 18px + gap 8px」                                                        | 改 `pl-[calc(1.125rem+0.5rem)]`，改图标尺寸时自动跟随                                                   |
  | **§4.3 标题层级**     | 帮助页品牌标题用 `text-[17px]`（体系外值）                                                     | 改 `text-ds-lg`                                                                                         |

  **本轮新增加固**（`compliance.test.ts` 9 → 12 条规则）：体系外字号、体系外阴影、
  h4 字重、焦点环两档。所有新规则均**剥离注释后匹配**，避免误伤解释性注释。

  **取舍说明**：裸 `rounded-*` 376 处**没有**一次性重写 —— 回归面覆盖 53 个文件、
  视觉收益为零（8px→12px 只在卡片上可辨），用棘轮逐点治理更稳。
  同理 `mt-[1px]` 这类光学校正值、`pb-[76px]` 这类固定工具栏预留是**刻意**的，不动。

### TB-046 后处理参数展示结构收敛：左栏改纯树导航，参数定义收为单一元数据源

- **来源**：杰哥原话「请重构后处理弹窗的参数展示结构，消除参数重复定义的问题…」（2026-09-19）
- **状态**：DONE · 写线：主写线
- **现状问题**（改前实测，非推测）
  1. 左栏**不是纯导航**：每节点一个「参数」IconButton 开第三层弹窗 + 顶部「参数表格」按钮开工作台；
  2. 参数入口共 **3 个**（左栏节点按钮 / 参数表格按钮 / 右栏 6 段硬编码），同名字段在三处出现；
  3. `DIRECTION_OPTIONS` 与 `DirectionValue` 在 `PostprocessSettingsModal` 与 `ProjectNodeParamsDialog`
     **逐字复制 2 份**；
  4. `PostprocessMediaConfig`（全局）与 `PostprocessNodeOverride`（节点）**8 个字段重叠**；
  5. ~9 个 media CRUD action **零 UI 入口**（`addMedia`/`renameMedia`/`deleteMedia`/`addMediaSize`…），
     媒体表事实上只读。
- **验收标准**（可测）
  1. 左栏 `aside.ds-dialog-pane--sidebar` 内 `input[type="checkbox"]` 数量为 **0**，
     且无 `button[aria-label^="设置"]`、无 `[data-testid="postprocess-open-tree-table"]`
     → 断言于 `PostprocessSettingsModal.test.tsx`
  2. `grep -rn "跟随尺寸" src/` **只命中** `features/postprocess/paramSchema.ts`（+ 测试）
  3. 切换树节点右栏同步刷新：选全局默认有「全局编排」分组，选真实节点该分组消失
  4. 未选中节点显示空状态；节点被删显示「节点已被删除」
  5. 节点上改的参数写入 `useProjectTreeParamsStore`，**不回写全局基线**，切换节点不丢
  6. `paramSchema.test.ts` 15 例契约：键唯一 / 分组都有定义 / 无死分组 / 两作用域覆盖完整
  7. `npm run verify` 全绿（**228 文件 / 2556 用例**）
- **影响面**
  - **新增**：`features/postprocess/paramSchema.ts`（唯一元数据源）、`paramSchema.test.ts`、
    `features/postprocess/PostprocessParamPanel.tsx`（右栏唯一详情面板）、
    `features/postprocess/MediaTableManager.tsx`（媒体表 CRUD 的 UI）
  - **重写**：`components/PostprocessSettingsModal.tsx`（701 → 树宿主，只留 `selectedNodeId`）、
    `components/PostprocessSettingsModal.test.tsx`（19 例改写 + 18 例新增）
  - **删除**：`features/projectTree/ProjectNodeParamsDialog.tsx`（446 行）、
    `params.ts` 的死导出 `resolveProjectParams`、`types.ts` 的死类型 `ResolvedProjectParams`
  - **微调**：`ProjectTreeWorkbench.tsx`（`onOpenParams` 改为指路 toast）、`design-system/catalog.ts`
- **关键设计点**
  - 树根挂哨兵节点 `GLOBAL_NODE_ID = '__postprocess_global__'` 代表「全局默认」，
    于是全局配置也在树里，`scope: global|node|both` 这套过滤才立得住；
  - `control` 是**渲染分派键**而非 JSX —— 元数据表保持可断言；
  - 水印归属**只读展示**（编辑唯一入口在水印预设工作区的归属树），
    刻意不在右栏开第二个入口 —— 同一件事两个入口必然出现「在 A 改了、在 B 看不到」。
- **已知坑**：见 `RISK.md` **R-43**（同一份参数被多处渲染）与 runbook **§十三**（含
  `Switch` 必填 `label`、`Button` 无 `icon` 属性、`Checkbox` 文本在 `label` 上等实测坑）
- **追补（同日，杰哥「清掉」）**：再删 3 个**零 UI 调用方**的 action
  - `storePostprocessMedia.ts`：`setMedia`（整表替换，与 `addMedia`/`renameMedia`/`deleteMedia` 重叠）、
    `setWatermarkPresetIds` 与 `toggleWatermarkPreset`（水印归属改为只读后已无编辑入口）——接口声明 + 实现一并删除；
  - **保留字段** `watermarkPresetIds`：它不是死字段，仍参与 `resolvePostprocessOutputPlan`
    的水印归属解析（`lib/postprocessMedia.ts:402`）与落盘快照（`partialize` / `getPostprocessMediaConfigSnapshot`），
    只是**不再有 UI 写入口**——值目前只能由 `migrate`/`restorePostprocessMediaConfig` 与项目节点归属兜底带入。
    这是有意的：真要改水印归属，走水印预设工作区，不在这里开第二入口。
  - 连带确认 `normalizeStringList` 与 `pruneSelectedMediaIds` **未变死**（仍被 `deleteMedia` /
    `setSelectedMediaIds` / 归一化路径调用），保留；
  - `storePostprocessMedia.test.ts` 删掉 2 条断言已删 action 的用例（45 例仍全绿）。
- **回滚点**：本轮改动可整包 revert；但**不要**只还原 `PostprocessSettingsModal.tsx`
  —— 旧版 import 已删除的 `ProjectNodeParamsDialog`，会直接编译失败

## 记录模板（新需求照抄）

```markdown
### TB-0XX <一句话标题>

- **来源**：杰哥原话「…」（日期） / 内部发现（证据位置）
- **状态**：TODO|DOING|BLOCKED|DONE|DROPPED · 写线：主写线 | wt-<主题>
- **验收标准**（可测，不是形容词）：1. … 2. …
- **影响面**：文件清单
- **已知坑**：指向 RISK.md 的 R-### 或 runbook 章节
- **回滚点**：commit / 备份目录
```

### TB-047 配方卡引擎：新增 campaign-recipe SOP 类型，本地最远点采样批量出提示词

- **来源**：杰哥原话「帮我把提示词工厂引擎加到这个项目里…新增一个 SOP 类型叫"配方卡引擎"，
  有 campaignRecipe 字段就走这个类型；这个类型不调 AI 生成提示词，用本地算法批量生成不重复提示词」
  （2026-09-20）
- **状态**：DONE · 写线：主写线
- **需求要点**（杰哥指定，6 条）
  1. 新增 SOP 类型「配方卡引擎」，**有 `campaignRecipe` 字段就走这个类型**
  2. 该类型**不调 AI**，用本地算法批量生成不重复提示词
  3. 算法：最远点采样，保证每批 N 条两两差异够大，**跨批次自动去重**
  4. **合规红线内置**且不可关闭（21 个词，见下）
  5. **不改现有 SOP 逻辑，只加新分支**
  6. 改完确认能跑
- **两种场景的区分**（杰哥第二轮明确要求「区分触发条件、输入来源、输出形式」）

  |              | 配方卡引擎                                                                     | 普通 SOP / 系列图                     |
  | ------------ | ------------------------------------------------------------------------------ | ------------------------------------- |
  | **触发条件** | SOP 带 `campaignRecipe` 字段，或 `executionMode === 'campaign-recipe'`         | 其余全部                              |
  | **输入来源** | 配方卡维度池（`dimensions[].options`）；**不读参考图**，`brief` 仅并入采样种子 | SOP 正文 + `brief` + 参考图（多模态） |
  | **输出形式** | 本地直接算出成品提示词，**无 JSON 解析 / 无结构修复重试**                      | 模型返回 JSON → 校验 → 失败自动重试   |

- **合规红线**（21 词，内置 `CAMPAIGN_RECIPE_FORBIDDEN_TERMS`）
  人民币 / 现金 / 钞票 / 提现 / 赚钱 / 日赚 / 月赚 / 保本 / 稳赚 / 最高 / 必备 / 必看 / 第一 /
  国家级 / 领导人 / 毛泽东 / 军 / 警 / 色情 / 裸体 / 裸
  - 命中即从候选池剔除（`sanitizeCampaignRecipeConfig`），骨架命中则清空并报告；
  - **刻意保守**：中文无词边界，「军」会命中「军绿色」，属可接受的误杀（宁杀不错放）。
- **验收标准**（可测）
  1. `npx tsc -b` + `npx tsc -p electron/tsconfig.json --noEmit` 双端零错误
  2. `campaignRecipe.test.ts` **20 例全绿**：红线 21 词全覆盖、清洗、结构校验、
     近层硬约束、签名稳定性、跨批次去重、组合耗尽不重复、占位符渲染
  3. `GallerySopBatchModal.test.tsx` **38 例全绿**（原 36 + 2 例分流）：
     - 配方卡 SOP → 调 `generateCampaignRecipePromptsFromStore`，**且不调** AI 生成函数
     - 普通 SOP → 调 `generatePromptsFromSopStore`，**且不调** 配方卡引擎
  4. **保真对拍**：同 seed 同输入下，与 `farthestPointSampling.ts` 的
     `selections` / `signatures` / `totalAttempts` **逐位一致**（7 组配置验证）
  5. `npm run verify` 全绿（**229 文件 / 2578 用例**）
- **影响面**
  - **新增**：`src/features/strategy/campaignRecipe.ts`（引擎，含红线 + FPS）、
    `campaignRecipe.test.ts`（20 例）、**`SopCampaignRecipePanel.tsx`**（配方卡编辑器）
  - **扩展**：`types.ts`（`SopKind` 加 `'campaign-recipe'`、新增 `SopCampaignRecipeConfig`
    / `SopCampaignRecipeDimension` / `SopExecutionMode`、`SopLibraryItem.campaignRecipe`）、
    `storeSopGeneration.ts`（新增 `generateCampaignRecipePromptsFromStore` 等 3 个导出）、
    `GallerySopBatchModal.tsx`（加一条平行分支 + `isLocalGenerationSop`）、
    `SopLibraryTab.tsx`（类型徽标 + 「配方卡」新建按钮 + 挂载编辑器）、
    `SopManagementCenter.tsx`（`addCampaignRecipeItem` + `itemDirty` 纳入 `campaignRecipe`）
  - **未改动**：`single` / `series` 的任何既有逻辑（`SopKind` 扩宽后全仓零编译错误，
    因为现有代码用 `kind === 'series'` 判断而非穷尽 switch）
- **关键设计点**
  - **保真移植优先于"修笔误"**：原始引擎有两处疑似笔误（`enforce` 的 `n` 遮蔽、
    `windowFar` 死参数），但实测影响采样分布 → **逐字保留**并注释标明，见 R-45；
  - `SopCampaignRecipeConfig` 定义在 `types.ts`，`campaignRecipe.ts` 用别名引用 → 单一真相源；
  - 弹窗内**内联判定**配方卡类型，不 import 生成模块的辅助函数（否则测试整体 mock 会挂），
    见 R-46；
  - 组合耗尽时**宁可少给也不重复**（`exhausted: true` + console.warn），
    绝不静默产出两条一样的提示词。

- **整段录入（2026-09-20 第二轮，用户要求"只留一个可粘贴全文的输入框"）**
  - **来源原话**：「界面上只保留一个可粘贴全文的输入框，外加"解析"按钮，不再需要我手动拆分填写
    各个字段…程序自动从粘贴的文本中识别并提取配方信息…解析结果先以可编辑的形式展示给我确认和微调」
  - **⚠️ 需求语义与资产不一致（已向用户澄清）**：原话举的字段是「原料与用量 / 制作步骤 /
    温度·时间·重量 / 克·毫升·勺」，属**烹饪配方**语义；但随附资产
    `歌单推荐美女_配方卡.json` 是**广告投放创意配方卡**（`{ body, dimensions }` 骨架 + 维度池），
    全仓没有任何原料/步骤/温度字段。**决策：按实际存在的 schema 实现**，
    把「原料与用量」等词理解为用户对「候选值与权重」的口语化描述 ——
    另建一套烹饪 schema 会造出一个无人消费的平行数据模型。
  - **新增解析器** `src/features/strategy/campaignRecipeImport.ts`
    - 双分支：**JSON 分支**（`findRecipeNode` 递归下钻最多 5 层，兼容 `{items:[{campaignRecipe}]}`
      这类导出包装 / 裸数组 / 对象映射池）+ **文本分支**（逐行扫描）。
    - 字段别名容错：骨架读 `template | body | prompt | skeleton`；
      维度池读 `pools | dimensions | pool`；`master` 块自动映射到**骨架里未被引用的槽位名**
      （本资产为 `{M}`），槽位名靠"未引用占位符"反推而不是硬编码猜测。
    - 排版容错：全角转半角（`toHalfWidth`）、中英文冒号与制表符（`splitKeyValue`）、
      去列表前缀（`1.` `1、` `(2)` `三、` `-` `*` `•`，`stripListPrefix`）、
      多分隔符切分（`[,，;；|、\t]+`，`splitOptions`）。
    - **占位符双花括号兼容**：`{{名称}}` 与 `{M}` 都认，且**先消费双花括号再扫单花括号**，
      避免把 `{{S1}}` 误读成 `{S1}` 而产生重复维度。
    - **权重映射**：`dominant` 数组 + `headline_slot` → 维度 `weight`
      （`headline_slot` 记 3，其余主控槽记 2）→ 引擎的 `pickDominantIndices` 识别为主控槽。
    - **宁可少提取也不乱填**（用户要求 4）：无法确定的一律留空 + 进 `warnings`；
      骨架引用了但池子没给的槽位落成**空维度占位**并进 `missingPools`，
      UI 上可见可补，绝不编造候选值。
  - **UI 改造** `SopCampaignRecipePanel.tsx`
    - 顶部新增**「整段录入」**块（`sop-recipe-import`）：单个 `TextArea` 收全文 +
      「解析」/「清空」+ 字数统计；解析失败走 `parseError` 红条，成功走 `parseNotice` 绿条
      （含识别来源、维度数、缺失槽位、警告数）。
    - 解析结果落在同一份 `onChange` 草稿上 → **原有的读取/保存链路完全不变**（用户要求 5），
      已有配方照旧可编辑存储。
    - 解析后仍以**可编辑**形式呈现（骨架 `TextArea` + 逐维度编辑器，带「主控」/「权重 N」徽标），
      用户可确认微调（用户要求 4）。
    - 空输入 / 无法解析 → 明确报错文案，**不静默产出空配方**（用户要求 6）。
    - 解析出的 `name` / `desc` / `dominantSlots` 经 `onMetaChange` 回填，
      且**仅在该字段当前为空时写入**，绝不覆盖用户已填内容。
  - **引擎侧配套**：`campaignRecipe.ts` 的 `renderRecipeBody` 新增单花括号替换
    （未知名占位符**原样保留**，不静默删除）；新增 `pickDominantIndices` /
    `truncateOversizedDimensions`（`MAX_DIMENSION_OPTIONS = 400`，
    截断结果通过 `truncatedDimensions` 上报，**不静默丢**）。
  - **验收**（实测，真实资产 `歌单推荐美女_配方卡.json` 端到端）
    - `campaignRecipeImport.test.ts` **17 例全绿**
    - 真实资产跑通：`ok: true` / `source: 'json'` / **13 个维度** / `missingPools: []` /
      `warnings: []`；权重 `S8:3 · S1:2 · S3:2 · S4:2 · M:2`
    - 生成侧：组合空间 **2,972,712,960,000**，出 5 条互异，重掷 **481** 次，**无截断**
      （重掷从无权重时的 8 次升到 481 次 → 证明主控槽约束真的生效了）
    - `npm run verify` 全绿（**230 文件 / 2606 用例**）
  - **新增风险**：文本分支维度名大小写坑 + 单双花括号并存 → R-47 / R-48

- **⚠️ 用户实测报障：配方卡走了 AI 大模型生成（2026-09-20 第三轮，已修）**
  - **现象**：杰哥说「我使用配方卡时还是走的普通 SOP 的 AI 大模型生成提示词的方式」，
    弹窗显示「未命名配方卡 · 0 条提示词 · 生成中 · gemini-3.1-pro-preview」
    （当时误判：把「模型名出现在这一行」当成了走了 AI 分支的证据）。
  - **排查方法（可复用）**：只读打开 `%APPDATA%\糖包|tangbao\local-saves\db\asset-kernel.sqlite`
    的 `app_data_records`（`readOnly: true`，R-06），按 namespace 逐条看落盘时间与内容。
    关键证据：**所有 namespace 的 `updated_at` 都停在 9/19 17:07**，而用户是 9/20 上午操作
    → 当晚改动一个字节都没落盘；`sopLibrary` 里只有 1 条预置的普通 SOP（无 `campaignRecipe`）。
  - **根因（三条，全部修复）**：
    1. **R-51** `saveItemDraftNow` 漏了配方卡分支：`if (!draft?.content.trim()) return false`
       对 `content` 为空的配方卡恒为真 → 永远返回 `false` → `runAfterDraftConfirmation`
       弹「放弃未保存的修改？」→ 草稿写不进去、切换后被丢弃。
       `itemDraftValid` 与自动保存 effect 都放宽了，**唯独这一处漏改**。
    2. **R-52** 草稿同步 effect 静默换卡：选中项被搜索/分组过滤掉时直接
       `setItemDraft(filteredItems[0])` → 换成列表第一条（普通 SOP）→ 后续按普通 SOP 走 AI。
       而搜索框只匹配 `name/description/content`，**不匹配 `campaignRecipe`**。
    3. **R-53** 分流口径不一致：引擎侧有 `parseCampaignRecipeConfigFromContent` 兜底
       （认识「content 放 JSON」的手工资产），弹窗分流只认字段与 `executionMode`。
  - **修法**
    - R-51：门槛改为与另两处一致 —— `(!isCampaignRecipeSop(draft) && !draft.content.trim())`；
    - R-52：加全量兜底 `if (selectedItemId && items.some(i => i.id === selectedItemId)) return`，
      **只在「全量列表里也不存在」时才切到第一条**；
    - R-53：弹窗内联补一条 `looksLikeRecipeJson` 探测（`content` 以 `{` 开头且
      `body` 为字符串 + `dimensions` 为数组）。刻意**不**从 `storeSopGeneration` import
      辅助函数 —— 会踩 R-46 的整模块 mock 坑。
  - **验收**：3 例回归测试全绿，且**逐个反向验证过**（临时 `if (false)` / 回退门槛后
    测试确实失败，证明不是"假绿"）；`npm run verify` 全绿（**230 文件 / 2609 用例**）。

- **⚠️ 用户复测仍报「跟之前一模一样，完全没有使用引擎」（2026-09-20 第四轮，已修）**
  - **用户给出的判据**（经追问明确）：① 判断依据 = **「弹窗里出现了模型名」**；
    ② 操作入口 = **SOP 管理中心 → 应用 → 输入栏生成**。
  - **结论先行：用户的判据不成立，真正的缺陷是另一个。**
    1. **那个模型名根本不是「走了 AI」的证据（R-54）**。它渲染在提示词集头部
       （`GallerySopBatchModal.tsx` 的 `{sop.name} · {N} 条提示词 · {状态} · 文本模型 {model}`），
       数据源是 run 快照的 `promptGenerationModel`；而写入它的
       `getSopPromptGenerationModelFromStore()` **只读 `profile.model || settings.model`，
       不发任何网络请求**。也就是说本地引擎跑完一个 run，也会顶着一个「配置里写着」
       的模型名 —— 纯显示噪音。
    2. **配方卡数据与引擎其实都是好的**（实测）。DB 里那张卡：
       `executionMode: "campaign-recipe"` / `kind: "campaign-recipe"` /
       `content: ""`（长度 0）/ `campaignRecipe` 完整（`body` 460 字符、**13 个维度**、
       权重 `S1:2 / S3:2 / S8:3`）→ **R-51 的修复确实生效了，卡存下来了且类型正确**。
       再用 `npx tsx` 直连引擎跑真实卡：`parseCampaignRecipeConfig → OK`、
       红线剔除 `(无)`、校验错误 `(无)`、`生成 5 条 | 组合空间 2972712960000 |
重掷 9`、5 条两两互异。**数据健康 + 引擎健康。**
    3. **真正的异常是「0 条提示词 + 生成中」**：DB 里**每一个** run 快照
       （含 9/18 尚无配方卡时的三次「快手美女网赚」）都是 `promptCount: 0`
       且 `status` 停在 `generating`/`paused` —— **说明这个卡死与配方卡无关，是存量缺陷**，
       只是本地引擎瞬间出词，让「0 条」显得格外刺眼。
  - **根因（两条，已修）**
    - **R-54** 本地分支无条件记录文本模型名 + 快照的 `previous?.promptGenerationModel`
      **粘性回退**（历史 run 一旦写过模型名，光改 ref 洗不掉）+ 界面裸渲染无区分。
    - **R-56** `generateForSources` 开头 `abort` 上一轮，被 abort 的那轮最后落盘的是
      `persistPromptRun(..., 'generating')`，其快照 id 已 ≠ `activeRunIdRef.current`
      → **永远等不到收尾覆盖**，留下「生成中 · 0 条 · 无任务」的孤儿快照。
      触发源：异步 `running`（来自 `status`）挡不住同步重入。**`git log -S` 证实是从豆泡
      fork 继承的存量代码**（指向 rebrand 提交），非本轮引入。
  - **修法**
    - R-54：① 把「本地算法分支」判定**收口到模块级 `isLocalGenerationSopForSop`**
      （含配方卡三条触发条件 + 变量提示词，与分流同源，消灭 R-53 那类口径漂移）；
      ② 记录模型名前先判定，本地分支写 `''`；③ `buildPromptRunSnapshot` 对本地分支
      **直接返回 `undefined`** 挡掉粘性回退；④ 界面无模型名但当前 SOP 是本地引擎时，
      显示「**· 本地引擎（不调用 AI）**」—— 让用户一眼能分辨。
    - R-56：加 **ref 同步重入闸** `generateInFlightRef`（外层 `try/finally` 复位），
      比依赖 `status` 的时序可靠；函数体拆成 `runGenerateForSources` 保持可读。
  - **验收**：`GallerySopBatchModal.test.tsx` **42 例全绿**（+4：R-55 探针 1 例、
    R-54 1 例、R-56 1 例、R-53 存量 1 例）；`npm run verify` 全绿
    （**230 文件 / 2612 用例**）。
  - **⚠️ 排查教训（写进 runbook §16）**：`GallerySopBatchModal.tsx` 有非组件导出
    （`getGallerySopPromptRunStorageKey`）→ Vite **无法 Fast Refresh**，改这个文件后
    HMR 会 `invalidate` 但不热更新；且渲染进程的 `console.warn` **不进终端**。
    → 诊断这个文件**必须用 DB 取证或界面可见标记**，不要靠 `console.warn` + 改代码试。

- **UI 入口（2026-09-20 补做，原为遗留项 1）**
  - **新建**：SOP 列表头部「新建 | 配方卡」两个按钮并列。点「配方卡」直接落一张
    带「主体/背景/光线」三件套骨架与 3×4 维度池的可用资产 —— 不给空对象，
    否则一进编辑器就是格式错误，上手成本太高。
  - **类型徽标**：列表行的参数区显示「配方卡引擎」`Badge`（与「变量提示词」「使用中」并列）。
  - **编辑器**：`SopCampaignRecipePanel`，挂在 SOP 库编辑面板里 `SopTextEditor` **下方**，
    按类型条件渲染（普通 SOP 完全不渲染，已由测试守住）。含：骨架 `TextArea`、
    维度池增删（维度 / 候选值两级）、组合空间计数、前 6 条差异预览、
    「按骨架补齐」维度、合规红线词表折叠区。
  - **红线条前置**：命中红线的候选值就地标 `Badge tone="danger"` + 输入框描边变红 +
    顶部黄条汇总；骨架命中则整条告警并在预览区说明「骨架命中红线，暂不可预览」——
    **不让用户填完才发现值不生效**。
  - **保存门槛按类型分叉**：配方卡的骨架存在 `campaignRecipe` 字段（不在 `content`），
    因此 `itemDraftValid` / 自动保存门槛 / 「保存修改」按钮三处都放宽为
    「名称非空即可；`content` 空不算无效」。否则复制出的配方卡因 `content` 为空而
    **完全存不下去**（R-05 同源问题）。
  - **`itemDirty` 必须纳入 `campaignRecipe`**：这是本轮实测踩到的真坑 ——
    不比较该字段时，编辑维度后草稿**不标记为脏**，自动保存不触发、
    「保存修改」按钮恒 disabled，表现为「看着改了但存不下去」。
    已同时补入 `executionMode` 比较。
  - **验收**：`SopManagementCenter.test.tsx` 新增 5 例（43 例全绿）——
    徽标+编辑器渲染、普通 SOP 不渲染、红线告警、`content` 为空可保存、新建按钮产出可用资产。

- **遗留 / 后续**
  1. ~~UI 入口未做~~ → **已完成**（见上节）；
  2. ~~两处疑似笔误是否要修~~ → **结论：都不改**。定量实测（原始遮蔽版 vs 修复版）：
     <br>· 4维×4值取12：最小差 2/1，**平均差 16.76 / 2.55**
     <br>· 4维×4值取24：最小差 1/1，**平均差 28.25 / 2.85**
     <br>· 6维×5值取20：最小差 4/2，**平均差 7.83 / 4.87**
     <br>· 6维×8值取60：最小差 1/1，**平均差 11.07 / 4.71**
     <br>「修复」后平均差异掉到 1/6 ~ 1/10，属**负优化**。槽位分布（4维取12）：原始 `44/10/6/6`
     集中在第 0 槽 vs 修复版 `1303/6/6/5` 摊薄到全槽 —— 遮蔽行为实际起了「主控槽优先」的作用，
     **是特性不是 bug**。`windowFar` 只赋值不参与判定，保留以维持 API 兼容
     （代码里 `void (options.windowFar ?? 80)` 显式标注为死参数）。两条均登记 R-45 禁止再动；
  3. ~~`usedSignatures` 未接线~~ → **已完成**：`generateCampaignRecipePromptsFromStore`
     在不传 `usedSignatures` 时自动调 `loadCampaignRecipeUsedSignatures`，
     从 `getAllSopBatchSnapshots()` 里按 `snapshot.sop.id` 过滤出本张配方卡的历史产出，
     再用 `deriveUsedSignatures` 反推签名；读历史失败则降级为「仅本批去重」+ console.warn，
     不阻断生成。于是**关弹窗重开、重启应用后跨批次去重依然生效**，且**无需新增存储结构**。

### TB-048 「本地引擎快照显示成 AI 模型」残留 + 生成中卡死（2026-09-20 报障复现）

- **来源**：杰哥报障「为什么提示词引擎无法生成提示词，你是不是一开始就搞错什么了」
  （2026-09-20 上午，截图显示 · 0 条提示词 · **生成中** · `gemini-3.1-pro-preview`）
- **状态**：✅ **已完成**（2026-09-20）· 写线：主写线 · 风险登记 R-54 / R-57 / R-58 均已 MITIGATED
- **排查手法**：SQLite 只读探查（runbook 第十六节），**决定性证据在 `sopBatchSnapshots`**。
  ⚠️ 本次修正了两个此前记录里的**事实错误**：
  ① `app_data_records` 里 **没有 `sopLibrary` 这个 `record_id`** —— SOP 库不是独立 namespace，
  而是并进 `requirementPrototype` / `zustand` 的 `state` 对象里；
  ② 此前 BACKLOG 里「SOP 库只有 1 条预置普通 SOP」与本次实测不符 —— 实际 **2 条**，
  其中 1 条就是「未命名配方卡」（`sop-mu96iez8-4y7cho`），且类型正确。

- **结论先行：配方卡引擎本身是健康的，报障的真实成因在「弹窗状态机」，不在引擎**

  实测（只读取样，2026-09-20 10:29）：
  - `zustand/state` 的 `sopLibrary` 里确有一张配方卡 `sop-mu96iez8-4y7cho`（「未命名配方卡」），
    `content` 为空 —— 这是**合法形态**（骨架在 `campaignRecipe` 字段），R-51 的修复生效了；
  - 最新两条 run 快照（10:10:36 / 10:25:52）**共用同一个 id** `sop-run-mu972k2g-3yyu96`、
    同一个 `sop.id`，两条都是 `status: 'generating'` / `promptCount: 0` / `prompts: []` /
    `taskIds: []`；**10:10 那条带 `promptGenerationModel: 'gemini-3.1-pro-preview'`**，
    10:25 那条已无（说明 R-54 的新写入修法已生效）；
  - 到 10:41（报障时）**再无任何写入，`updated_at` 停在 10:25:52** → 该 run 卡死不前进。

  → **报障截图里那行「生成中 · 0 条提示词 · gemini-3.1-pro-preview」，是
  「一个卡死的孤儿快照」+「一条未清洗的历史模型名」叠加的显示结果，不是引擎没在跑。**
  顺带排除了「本地引擎慢」：`isLocalGenerationSop` → `maxBatchSize = undefined` →
  本地一次返回全部（快照里 `重掷 9`、5 条互异，实测量级是毫秒），根本来不及显示「生成中」。

- **修法 ①（R-54 残留清洗不完整）**
  - **证据**：见上，10:10 那条快照留下了模型名。
  - **根因**：R-54 的第一版修复**只改了「新写入」**，挡不住这个**已存在**的残留。
    写模型名用的是 `activePromptGenerationModelRef`，而弹窗挂载时会从快照把它**恢复**回来
    （`applyPromptRun` 第 997 行 `= run.promptGenerationModel ?? ''`）→ 残留值再经
    `buildPromptRunSnapshot` 回写。于是「只改 ref 洗不掉」从「同一次会话内」升级成
    「**每次打开弹窗都复活**」。
  - **修法**：清洗时机前移到**恢复 run 的那一刻** —— `applyPromptRun` 里读 `run.promptGenerationModel`
    且该 SOP 判为本地引擎（`isLocalGenerationSopForSop`）时置空并回写，
    做到「点开弹窗即净化」，不必等下一次生成。
  - **验收**：DB 回读该 run 快照不再有 `promptGenerationModel`；补回归用例。

- **修法 ②（R-57 静默重入把用户点击吞掉）**
  - **证据**：快照停在 `generating` 后 15 分钟无推进。
  - **根因**：`if (generateInFlightRef.current) return`（第 1809 行）**是静默 return** ——
    上一轮还在飞时直接挡下，不报错、不 toast、**不落终止态快照**，
    界面就停在上一轮留下的 `generating` 上。用户看到的现象即「点了生成没反应 / 一直生成中」。
  - **修法**：① 被挡下时给明确反馈（toast「上一轮生成尚未结束」或复用进行中的轮次）；
    ② **非终态快照必须能收敛** —— 若该 run 已停止推进，收尾成 `failed` / `ready`；
    ③ 补回归测试。
  - **通用防线**：任何「ref 重入闸 + 非终态落盘」的组合，闸门分支都要能收敛到终止态。

### 落地（2026-09-20 全部完成）

| #   | 改动                                                                                                                             | 文件                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| ①   | 重入闸加显式反馈（`setStatusMessage` + toast）                                                                                   | `GallerySopBatchModal.tsx` ~1880             |
| ②   | 新增 `orphanRunsToFlush` ref：挂载时收敛库里残留的 `generating` 孤儿快照                                                         | 同上 ~580                                    |
| ③   | `applyPromptRun` 恢复时**就地净化**残留模型名并立即回写；同时接住收敛结果再落盘                                                  | 同上 ~1007-1055                              |
| ④   | 挂载 effect 收敛 `generating` 快照 + 兜底 flush                                                                                  | 同上 ~1066 / ~1169                           |
| ⑤   | **R-58（新发现的真根因）**：`SopBatchSnapshot['sop']` 补 `campaignRecipe?` / `executionMode?`，`buildPromptRunSnapshot` 原样带上 | `types.ts` / `GallerySopBatchModal.tsx` ~883 |

**⑤ 是关键**：快照的 `sop` 原本只存 `id/name/description/content`，
而读取侧的本地引擎判定要靠 `campaignRecipe` / `executionMode` →
**判定恒为 false，R-54 的整套修复从落地起就是失效的**。这也是「模型名每次打开都复活」的真正机制。

**验收证据**（`npm run verify` 全绿 + 反向验证）：

- 新增 4 个回归用例（R-57 闸门反馈 / R-57 挂载收敛 / R-54 净化 / R-58 快照保真），
  **逐个做过反向验证**（把修复临时改回旧行为 → 对应用例确实失败，再恢复）。
- 全量：**230 文件 / 2616 用例通过**。
- ⚠️ 测试陷阱（已写进 R-58）：mock 的 `putSopBatchSnapshot` 若透传引用、不过序列化边界，
  写盘侧漏字段读回后**依然存在** → 用例假绿。第一版 R-58 用例就是这样被反向验证抓出来的。

### TB-049 导出/后处理四问题：主进程白名单打死产出 + 按渠道目录看不见 + 命名无预览 + 入口分散

- **来源**：杰哥报障（2026-09-20）「使用导出/后处理功能时」，附截图
  「没有产出文件：导出位置不可用，已跳过这批产出（请检查路径是否可达）」，
  并列了 4 条诉求：① 后处理完全不可用；② 无法按渠道设置导出位置；
  ③ 命名模板没有预览；④ 设置入口分散混乱。明确要求「优先说明结论和定位依据」。
- **状态**：🔧 **主要问题已修，待实机验证**（白名单顺序已修 + 真因不再被吞）
  · 写线：主写线 · 风险登记 **R-62**（白名单与业务需求冲突，最严重）
- **完整诊断报告**：`docs/postprocess-export-diagnosis.md`（含端到端复现输出）

#### 结论：4 条里只有 1 条是「真做不了」，另外 3 条性质各不相同

| #   | 报障                   | 真实根因                                                                                                                                                                | 性质               |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | 后处理完全不可用       | **主进程路径白名单**拒绝路径。只有桌面/文档/下载/图片/userData 放行；`D:/…`、`E:/…` 一律拒。且**手输路径永不被授权**，只有走「选择…」对话框才行，而这个授权**重启就丢** | **真 bug（R-62）** |
| 2   | 无法按渠道设置导出位置 | **功能已完整实现**（三层继承 + 双写 + 节点覆盖 + 兼容旧单值），但 UI 折叠在「输出目录」下方，且被问题 1 一并打死                                                        | 已实现，入口问题   |
| 3   | 命名模板没有预览       | 确认缺失。但 `renderPostprocessNamePattern` / `buildPostprocessOutputName` 早已存在，**接线即可**                                                                       | 真缺失（改动极小） |
| 4   | 设置入口分散           | 「本地保存目录」在 `SettingsModal`，后处理配置在 `InputBar` 弹窗，**两处互不知情**，而它们语义强相关                                                                    | 信息架构           |

#### 决定性证据

**① 报错文案的出处**：`src/features/postprocess/outputRoots.ts:47`。

**② 完整失败链路（逐跳有据）**：

```
outputRoots.ts:47   warnOnce('导出位置不可用…')     ← 你截图那句
  ↑ roots.length === 0
outputRoots.ts:42   root = await resolveRoot(dir) → null
taskPostprocess.ts:347  getExplicitImageSaveDirectory(trimmed)
localSave.ts:607-608    ok = await api.ensureDir(trimmed); return ok ? trimmed : null
electron/ipc-handlers.ts:1197  handleChecked('fs:ensure-dir')
electron/ipc-handlers.ts:1199  assertAllowedPath(dirPath)  ← 抛错
electron/ipc-handlers.ts:1202  catch → console.error + return false   ← ★异常被吞
electron/ipc-handlers.ts:264   throw new Error('Path is outside allowed application directories')
electron/ipc-handlers.ts:241-253  getAllowedRoots()
   = userData / desktop / documents / downloads / pictures
     + sessionAllowedRoots（内存 Set，**重启清空**）
     + readLocalSettings().localSavePath
```

**③ 白名单准入实测**（复刻 `assertAllowedPath` 跑的）：

```
[拒绝] D:/投放大图                    [允许] C:/Users/tt/Desktop/输出
[拒绝] D:/工作/投放/2026/百度         [允许] C:/Users/tt/Documents/投放
[拒绝] E:/素材交付                    [允许] C:/Users/tt/Pictures/投放
[拒绝] C:/Users/Public/Pictures       [允许] …\tangbao\local-saves\postprocess
```

**④ 端到端复现**（真实代码逻辑，非猜测）：

```
场景 A：outputDir = D:/投放大图（手输）→ 产出目录 = (空)，提示「导出位置不可用…」
场景 B：mediaOutputDirs.baidu = D:/百度交付 → 产出目录 = (空)，同样提示
场景 C：完全没配 → 产出目录 = …\local-saves\postprocess              ← 只有这条能出图
场景 D：outputDir = 桌面\输出 → 产出目录 = C:/Users/tt/Desktop/输出   ← 白名单内能出图
对照：同 D:/投放大图，但本会话用「选择…」选过 → 产出目录 = D:/投放大图 ← 能出图！
```

**关键不对称**（这就是「我明明设置好了」的来源）：

| 配置方式                        | 当次会话        | 重启后                                   |
| ------------------------------- | --------------- | ---------------------------------------- |
| 「选择…」对话框选 `D:/投放大图` | ✅ 能产出       | ❌ **失效**（`addAllowedRoot` 只在内存） |
| 输入框手敲 `D:/投放大图`        | ❌ **当场失效** | ❌ 失效                                  |

**⑤ 真实落盘数据**（SQLite 只读）：

```
namespace = postprocessMedia / state
updated_at      = 2026-09-19 13:15:07   ← 近 22h 未再写入
outputDir       = ""
mediaOutputDirs = {}
```

而 `zustand/state` 今日 03:40 仍有写入 → **持久化通道本身是好的**，问题不在「存不住」。

#### 三处「静默/误导」，是这个问题难查的根本原因

1. `ipc-handlers.ts:1202`：`assertAllowedPath` 的异常被 `catch` 成 `return false`，
   只 `console.error`（渲染进程看不到）→ **渲染侧只拿到布尔值，丢失失败原因**。
2. `outputRoots.ts:47` 文案「请检查路径是否可达」**把人往错方向引**：
   `D:/投放大图` 在资源管理器里明明打得开，真因是「不在白名单里」。
3. 配置面板**不做事前校验**：填了不可用的目录，当场零提示，要跑完任务才从 toast 知道。

#### 修法（按优先级）

| 序  | 内容                                                                                                               | 位置                                           |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| 1   | **A. 把「用户显式配置的输出目录」纳入白名单**（与现有 `localSavePath` 同样处理，`ipc-handlers.ts:251` 已在这么做） | `electron/ipc-handlers.ts` `getAllowedRoots()` |
| 2   | **B. 保留失败原因**：`fs:ensure-dir` 不再 catch 成 false，让错误传到渲染侧并区分「不在白名单」vs「不可写」         | 同上                                           |
| 3   | C. 输出目录控件加**实时可用性校验**                                                                                | `PostprocessParamPanel.tsx`                    |
| 4   | 问题 2：`ChannelOutputDirs` 默认展开 + 显性化继承来源                                                              | 同上                                           |
| 5   | 问题 3：`NamePatternField` 加预览（复用 `renderPostprocessNamePattern`）                                           | `NamePatternField.tsx`                         |
| 6   | D. 白名单授权持久化到 `local-settings.json`（消除「重启失效」）                                                    | `electron/ipc-handlers.ts`                     |
| 7   | 问题 4：IA 归置（`paramSchema` 输出组补「本地保存根目录」只读项 + 跳转）                                           | `paramSchema.ts` / 两处 UI                     |

**安全口径**（已向杰哥确认）：不是拆掉白名单，而是把「用户显式配置过的目录」升级为受信根 ——
与 `localSavePath` 完全一致的处理方式；用户仍不能写任意路径。

#### ✅ 已实现（2026-09-20）—— 序 1 / 序 2

**一句话**：把「授权」从 `ensureDir` **之后**挪到**之前**。

原实现里授权函数一直存在，但调用点在 `taskPostprocess.ts` 的
`for (const root of outputRoots) await api.authorize…` —— 那行**在 `ensureDir` 之后**，
而 `ensureDir` 一失败 `resolveBucketOutputRoots` 就返回空数组了，**那行永远等不到**。
所以这不是「功能没做」，是**顺序倒了**：先建目录（被白名单拒）→ 再授权（轮不到）。

| 文件                                             | 改动                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/postprocess/outputRootResolver.ts` | **新增**。把原来内联在 `taskPostprocess` 闭包里的「授权 → 建目录 + 缓存」抽成 `createOutputRootResolver`，顺序变成可断言的对象   |
| `src/lib/localSave.ts`                           | **新增** `authorizeOutputDirectory()`（把配置值主动提交给主进程授权）；`ensureDir` 返回值类型放宽为 `Promise<boolean \| string>` |
| `src/features/postprocess/taskPostprocess.ts`    | `resolveOutputRootCached` 改用 `createOutputRootResolver`（授权在前）；`ensureDirectoryChain` **逐级**授权后再建                 |
| `electron/ipc-handlers.ts`                       | `fs:ensure-dir` 失败时**返回错误消息字符串**而不是 `false`（R-62：不再吞掉真因）                                                 |
| `src/features/requirementPrototype/manifests.ts` | 写 manifest 前先授权 `scheduledOutputPath`（同一条口径）                                                                         |

**逐级授权的必要性**（`ensureDirectoryChain`）：只授权根目录挡不住第二级 ——
`assertAllowedPath` 检查的是**实际写盘路径**，`2026-09-20/保险/` 这种多级子目录
在第二级就断链。所以每一级都「先授权、再建」。

**关于「重启失效」（序 6）的现状说明**：本次**没有**做持久化。
现在的口径是「**每次产出前重新授权**」—— 因为 `taskPostprocess` 每次跑都会调
`resolveOutputRootCached`，缓存只在单批内有效，跨批必重新授权。所以**重启后照常能出图**，
不需要持久化。序 6 只在「进设置面板时就校验可用性」这类**事前校验**场景下才需要，
可并入序 3（实时校验）一起做。

**关于序 1 的实现方式**：不是「主进程去反向读用户的配置」，而是
「**渲染进程把用户填的路径主动提交授权**」—— 更简单，且不需要主进程理解
`postprocessMedia` / 节点 `byMedia` 的存储结构（那会引入耦合）。
`getAllowedRoots()` 本身**未改动**，仍是原样的安全边界。

#### 回归测试（输出根目录解析：先授权再建目录）

`src/features/postprocess/outputRootResolver.test.ts` —— **7 条，核心是断言调用顺序**。

⚠️ 一条踩坑记录：**第一版测试写成描述性的**（只断言 `authorizeOutputDirectory` /
`getExplicitImageSaveDirectory` 各自的行为），**反向验证时把顺序改回去，测试依然全绿**
—— 根本没锁住 bug。根因是 bug 住在「调用顺序」里，而那段逻辑当时内联在闭包中不可测。
后来抽成 `createOutputRootResolver` 才让顺序可断言。
**教训：反向验证不通过时，先怀疑测试太弱，而不是怀疑探针。**

抽成模块后的反向验证结果：交换两行 → **3 条立刻挂**
（`expected [ 'resolve:…', 'authorize:…' ] to deeply equal [ 'authorize:…', 'resolve:…' ]`）。

#### 剩余待确认（需杰哥补充）

~~1. 你设的输出位置的具体路径 / 入口~~ → **已确认：输入框手输**（2026-09-20）
~~2. 期望的导出根目录~~ → **已确认：每个渠道配各自目录，可 1 个也可多个**
~~3. 是否接受「显式填过的目录即视为受信」~~ → **已接受**

⇒ **三项全清，本条不再有阻塞。** 但仍需**杰哥实机验证一次**：
在「后处理 → 输出位置」按渠道手输一个 `D:\…` 路径，跑一次后处理，确认文件真的落在那。

### TB-050 后处理参数收窄：只留与「项目 / 方向」直接相关的项，树结构不动

- **来源**：杰哥原话（2026-09-20）「当前参数设置是基于项目树的层级结构。我希望重构为全局的参数设置模块：
  ① 将项目树拓展为全局的参数设置模块，统一管理各项目、各方向的参数；② 后处理环节只保留与「对应项目」和
  「对应方向」直接相关的必要设置项，移除冗余层级和无关参数；③ 请评估：是否仍需要树形结构？」
- **状态**：✅ **已完成（2026-09-20）** · 写线：主写线
- **决策记录**：`docs/adr/0010-param-center-scope-correction.md`（认知纠正，生效中）
  - `docs/adr/0011-node-override-narrowing.md`（**收窄口径与实现，生效中**）
- **⚠️ 前情**：先前的 `docs/adr/0009` 因**误解本项目结构**已作废（见 ADR-0010 与 0009 的作废说明）

#### 杰哥的纠正（原文）

> 「现有的树结构没问题，方向下面生成图片尺寸，比如横竖，后处理导出的分四个渠道，
> 这些不算树结构。我发现你对我的项目的作用没有理解。」

**纠正成立。** 我先前把「渠道 / 尺寸 / 横竖」当成了树的层级，进而提议「移除冗余层级」
—— 提议删的是一个**本来就不存在的问题**。

#### 修正后的正确认知：产物是三个独立维度，只有第一个在树里

| 维度            | 取值                                | 在树里吗  | 说明                                         |
| --------------- | ----------------------------------- | --------- | -------------------------------------------- |
| **① 归属**      | 产品线 → 产品 → 方向                | ✅ **在** | 树。业务归属，决定「这张图属于哪个方向」     |
| **② 尺寸/横竖** | `landscape` / `portrait` / `square` | ❌ 不在   | 按源图自动判定或手选，决定每渠道出哪些尺寸   |
| **③ 渠道**      | 广点通 / 百度 / 厂商 / 头条         | ❌ 不在   | `media` 规格表（全局共享），决定投哪几个平台 |

**产出量 = 方向 × 渠道 × 该渠道同向尺寸 × 水印预设**（`lib/postprocessMedia.ts:472`）。
⇒ **树只管 ①。②③ 是笛卡尔积的另外两维，从来不是「树的层级」。**

实测佐证：

- 内置树 **3 产品线 / 13 产品 / 61 方向**（`lib/builtinProjectTree.ts`），方向名是业务名
  （`网赚` / `萌宠` / `大字报` …），**不是**横竖。
- 媒体表 **4 渠道 / 15 尺寸**（`lib/postprocessMedia.ts:71`），每渠道自带尺寸规格（厂商 8 个、百度 3 个）。
- `matchMediaSizes(media, direction)`（`:149`）—— **同一渠道在不同横竖下出不同尺寸**
  ⇒ 横竖是**筛选尺寸的条件**，不是树的层级。

#### 诉求 B 的正确落点：把「与方向无关」的字段移出节点覆盖

| 处置                        | 字段                                                                  | 依据                                                                             |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ✅ **与方向直接相关，必留** | `outputDir` / `byMedia[].outputDirs`、`watermarkPresetIds`、`enabled` | ADR-0003：25 个方向目录按渠道分叉、56 个方向水印按渠道分叉 —— **确实逐方向不同** |
| ⚠️ **与方向无关，建议上收** | `autoCompanionClean`、`distribution`                                  | **无任何业务证据**表明逐方向不同                                                 |
| ⚠️ **需杰哥定**             | `namePattern`、`creator`                                              | 取决于用法：全库一套，还是不同方向不同？                                         |
| ❓ **属②尺寸维度**          | `direction`                                                           | 若该逐方向可配就**保留**（先前主张「改名上收」是错的）                           |
| ❓ **属③渠道维度**          | `selectedMediaIds`（节点级勾选）                                      | 问的是「勾选范围」要不要逐方向，与规格表全局无关                                 |

⚠️ **无论怎么收窄，都必须处理 R-63**：被删字段的旧值在升级瞬间**静默消失且不可逆**。
修法：归一化阶段提升到全局 + 一次性迁移 + 跑前备份。

#### 杰哥的裁决（2026-09-20，已据此实现）

1. **命名模板 / 创作者** → **全局**
2. **画面方向（横竖）** → **按源图自动判**（取 A 方案：不提供任何手选覆盖口子）
3. **节点级渠道勾选** → **不需要**（勾选是运行时操作）
4. **纯净版伴随 / 分发排期** → **全局一套**

#### 已实现（2026-09-20）

**`PostprocessNodeOverride` 10 字段 → 3 字段（+ `byMedia`）**：

```ts
export interface PostprocessNodeOverride {
  outputDir?: string // 与方向直接相关（ADR-0003：25/61 方向目录分叉）
  watermarkPresetIds?: string[] // 与方向直接相关（ADR-0003：56/61 方向水印分叉）
  enabled?: boolean // 「这个方向要不要跑」
  byMedia?: Record<string, PostprocessMediaOverride> // 同层按渠道再细分
}
```

| 文件                                                 | 改动                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/lib/postprocessMedia.ts`                        | 删 6 字段；`applyPostprocessOverride` 只合并目录与水印，其余透传基线                  |
| `src/features/projectTree/params.ts`                 | 归一化不再读旧字段；新增 `collectPromotedNodeFieldValues` / `hasLegacyNodeOnlyFields` |
| `src/features/projectTree/storeProjectTreeParams.ts` | `version: 1 → 2`；新增 `promotedGlobals` slice 与 `mergePromotedGlobals`              |
| `src/features/postprocess/paramSchema.ts`            | 6 个字段 `scope: both → global`、`resettable: false`                                  |
| `src/features/postprocess/PostprocessParamPanel.tsx` | 删掉节点态分支（已不可能走到）                                                        |
| `src/components/PostprocessSettingsModal.tsx`        | `globalConfig` 走 `mergePromotedGlobals`                                              |
| `src/features/postprocess/taskPostprocess.ts`        | `baseConfig` 同样合并（**运行时落盘必须与界面同源**）                                 |

**R-63 已闭环**（见 RISK.md）：迁移把节点旧值提升到 `promotedGlobals`，两个消费点
（界面 + 运行时）都合并；**只补空缺**，字符串字段空串也算空缺。

**验收**：`npm run verify` 全绿；新增 7 个 R-63 迁移回归用例，**逐个反向验证**；
4 个「节点上能改 X」的用例改写为「节点上不再出现 X」。

#### 前置依赖（已满足）

TB-049 的白名单 bug 仍未修，但本次改动**只动参数模型不触导出路径**，
因此不再阻塞 —— 两者可在同一版本里分别验收。

### TB-051 常量集中化：把散落的魔数收进分层配置文件（用户可配置 vs 开发者可调）

- **来源**：杰哥原话（2026-09-20）「目前很多常量是隐藏起来的，需要用户自己去代码里修改。
  我希望把这些都集中在某个配置文件，让用户可配置。」
- **状态**：📋 **已评估，待杰哥裁决 3 点后开工** · 写线：主写线
- **评估报告**：`docs/config-centralization-assessment.md`

#### 实测数字（判断依据，不是印象）

177 个 `export const` 常量（去重）+ 151 处数字魔数 + 51 处硬编码尺寸 +
20 处硬编码 URL + 8 处硬编码超时 + 5 个存储键字面量。

按名归类：`DEFAULT_*` **34 个**（天然可配）/ `*_KEY`·`*_VERSION`·`*_EVENT`·
`*_TYPE`·`*_PREFIX` **28 个**（内部协议，不该开放）/ 其余 **115 个**（算法与 UI 细节，逐个判断）。

#### 已集中过的部分（**别重复造**）

颜色 Token（`design-system/styles.css` + `tokens.tokens.json` + 契约测试）、
后处理参数（`paramSchema.ts`）、项目树参数（`features/projectTree/*`）、
组件目录棘轮（`catalog.ts`）。⇒ 本次要处理的是**剩下真正散落的**（超时 / 尺寸 /
端点 / 重试 / 缓存上限）。

#### 建议方案：分三档，不是一个大文件

| 档  | 位置                                           | 内容                                    | 是否用户可配      |
| --- | ---------------------------------------------- | --------------------------------------- | ----------------- |
| 一  | 已有的 `local-settings.json` + zustand persist | 输出目录 / API / 命名模板 / 渠道规格    | ✅ 是（已有）     |
| 二  | **新建** `src/config/tunables.ts`              | 重试 / 退避 / 超时 / 并发 / 缓存上限    | ⚠️ 高级设置可改   |
| 三  | **新建** `src/config/constants.ts`             | UI 时序（D 类）+ 安全边界（E 类，只读） | ❌ 否，但便于查阅 |

**Step 1（低风险可立刻做）**：建上面两个文件，把散落字面量换成具名常量。
**行为零变化**，只解决「找不到」。可配棘轮守卫（禁止 `setTimeout` 用裸数字）。
**Step 2**：A/B 类接入统一设置中心 —— **建议与 TB-050 合并做**，避免界面改两遍。

#### ⚠️ 绝不能开放的（E 类）

`electron/ipc-handlers.ts` 的 `getAllowedRoots` 是**安全边界**。TB-049 / R-62 的根源
正是「业务想要 D 盘、策略只放行文档目录」。**做成「用户可配白名单根」= 等于没有边界。**
正确做法仍是 TB-049 方案 A：从用户已配置的输出目录**反推**受信根。

#### 待裁决 3 点

1. **开放范围**：A（推荐，只开放产出结果 + 本机环境）/ B（含 C 类）/ C（全开放，不推荐）
2. **与 TB-050 的先后**：A（推荐，先做 Step 1，Step 2 并入 TB-050）/ B（独立做完 Step 2）
3. **C 类（重试/退避/超时）要不要暴露**为「设置 → 高级」页？

### TB-053 取消提示词生成点了没反应 + 模型报错被换成通用文案

- **来源**：杰哥 2026-09-20 报障「**我无法取消生成提示词**」，同一轮还有「Agent 模型无法生成提示词」
- **状态**：✅ **已修复**（`R-64`）· 写线：主写线

#### 现象

1. 开着「自动生成」（渐进派发）时点「取消」→ 按钮**不消失**、文案停在「正在取消提示词生成」
2. 提示词生成失败时界面只显示「提示词生成中断，可重试缺口。」，**看不到服务端原文**

#### 真因（两处独立缺陷，叠加成同一症状）

| #   | 缺陷                                                                                                                    | 位置                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| ①   | 提交生图任务的 `await` 不接受 `AbortSignal`，把整条批次循环卡死 → 取消分支永远走不到 → `status` 永久停在 `'generating'` | `GallerySopBatchModal.tsx` `dispatchProgressivePrompt` |
| ②   | 失败原因只存进 `SourceRun.error`，`setError` 给的是硬编码通用文案                                                       | 同文件 `setError` 调用点                               |

#### 修法

- **① 竞速**：新增 `raceWithCancellation(task, signal)`（`sopPromptBatch.ts`）—— 自身不响应取消的长任务与信号竞速，取消即立刻 reject。**并把 `catch` 改成先 `throwIfSopPromptGenerationAborted` 再计入失败**（否则取消被当成「提交失败」吞掉，循环继续跑）。
- **② 透传真因**：新增 `collectSourceFailureReason` / `collectOutcomeFailureReason`，失败项原文**原样**进 `setError`，不改写措辞。三处调用点全接（渐进派发失败、列表生成失败、批量提交失败）。

#### 回归

6 例，**逐个反向验证**：

- 渐进派发在途取消必须收口（去掉竞速 → 挂）
- 模型报错必须原样出现在 `role="alert"`（改回硬编码 → 挂）
- 竞速五态（未取消透传 / 取消即拒 / 已取消信号 / 无信号 / 任务自身失败）
- `collect*FailureReason` 四态（含去重、空原因占位）

#### 关联

- 与 R-62（IPC `catch` 吞真因）**同属「可诊断性缺陷」家族**：错误在链路中途被换成通用文案。
- 用户这次的真实报障链：`gemini-3.1-pro-preview` 在服务商侧**无可用渠道**（HTTP 500 `get_channel_failed`）→ 已实测 `gemini-3.1-pro` 等 4 个模型可用。
  这本该是**用户一眼能看出来的配置问题**，被②盖成了「程序坏了」。

#### 端到端实测（用杰哥真实配置，2026-09-20 14:52）

| 模型                                 | 结果                              | 耗时 |
| ------------------------------------ | --------------------------------- | ---- |
| `gemini-3.1-pro-preview`（当前配置） | ❌ HTTP 500                       | 1.1s |
| `gemini-3.1-pro`                     | ✅ HTTP 200，返回合法 JSON 提示词 | 9.3s |

服务端原文（修复后界面会**原样**显示这段）：

```
分组 专用gemini 下模型 gemini-3.1-pro-preview 的可用渠道不存在（retry）
code: get_channel_failed
```

⇒ **修复的价值在此**：用户以后看到的是这句话，能自己判断「是模型下架了，不是程序坏了」。

图片链路另测：`POST /v1/images/generations`（真实 payload）→ **200，成功出 1 张图（36.8s）**，
⇒ 图片 API 与模型都正常，**卡点只在 Agent 文本模型**。

---

### TB-052 参考「灵境·资产中心」重整参数管理形态（三栏同屏 / 配置模板 / 审核规则）

- **来源**：杰哥给的线上参考 `https://junbo-cy.jetmobo.com/aiimg/assets/center?tab=products`
  （2026-09-20），并授权用账号登录实测
- **状态**：📋 **已评估 · 已裁决 · P1 待开工** · 写线：主写线
- **评估报告**：`docs/reference-lingjing-asset-center.md`（含三栏布局实测、字段对照、4 项建议）

#### ⭐ 关键发现：这是同一套业务数据的另一个前端

实测对照，产品线 / 产品 / 方向名**逐字一致**（保险 / 百万医疗险 / 月亮·图标·插画·大字报 /
APP-拉新 / 快手 / 网赚·萌宠·老歌 / 卡券 …）。

|        | 灵境（线上）                  | 糖包（本地） |
| ------ | ----------------------------- | ------------ |
| 产品线 | 保险 / APP-拉新 / 卡券（3）   | 同（3）      |
| 产品   | 14                            | 13           |
| 方向   | 月亮 / 图标 / 网赚 / 一分购 … | **逐字相同** |

⇒ **灵境是服务端权威源，糖包是本地客户端**。它的参数组织不是「别人的做法」，
而是**同一份业务在另一端的既有解法** → 参考价值极高且**可直接对照**。

#### 它的「调用配置」分组（原文）

> **调用配置**
> 「产品可继承上级配置，也可以在当前层级覆盖。」
> tab：`渠道与尺寸` / `审核规则` / `输出位置` / `水印`

**「可继承上级，也可在当前层级覆盖」与糖包的继承语义完全一致。**

「渠道与尺寸」是**渠道分组 + 组内尺寸多选 + 计数徽章**，不是树：

```
▸ 广点通        2 / 2 已应用
   [广点通 1080x1920] 竖版 1080x1920 · ≤399KB  当前产品使用 ✓
   [广点通 1280x720 ] 横版 1280x720  · ≤399KB  当前产品使用 ✓
▸ 百度          0 / 3 已应用
   [百度   1140x640 ] 横版 1140x640  · ≤299KB  未应用
```

⇒ **与刚完成的 ADR-0011（节点覆盖收窄）方向一致**，但它多走两步：
**① 有「配置模板」概念；② 有「审核规则」维度。**

#### 差距清单（价值排序）

| #      | 项                                     | 糖包现状                                                                                 | 差距            |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------- | --------------- |
| **P1** | **三栏同屏**（左树 + 中列表 + 右详情） | 表格展平（`ProjectTreeWorkbench`）+ **弹窗**（`PostprocessSettingsModal`），**两块割裂** | ⚠️ **最大差距** |
| **P2** | 渠道分组**计数徽章**（`N / M 已应用`） | 要展开折叠区才知道配了几个                                                               | 小改动          |
| **P3** | **配置模板**（存一套命名模板，可套用） | ❌ 无，只能逐节点配                                                                      | 中等            |
| **P4** | **审核规则**作为产品级参数             | 只有配方卡 `adNegativeRules`                                                             | **已裁决不做**  |

**P1 是 TB-049「入口分散」的根因解法**：不是「把两个入口做个跳转」，
而是**本来就不该是两个入口**（看结构要开一个界面、改参数要开弹窗，且弹窗遮挡上下文）。

#### ⚠️ 不建议照搬

1. **顶级 tab（素材库/BGM/视频水印/产品）** —— 那是**平台级多模块**划分
   （它还有策略中心/下单中心）。糖包是单一桌面工具，加 tab 只是对齐形态无收益。
2. **云端化** —— 灵境是 Web（有服务端），糖包是本地 SQLite。
   **数据主权在本地是糖包的优势**，不要因这个参考引入云端依赖。

#### 与 ADR-0011 的关系：互补

- ADR-0011 解决「每个字段该挂在哪一层」—— **水平方向**（收窄节点覆盖）✅ 已完成
- TB-052 解决「这些参数以什么形态呈现」—— **垂直方向**（呈现方式）📋 待裁决

两者都做完，才是「参数管理」的完整解法。

#### 裁决结果（2026-09-20 已收口 · 裁决原文「1.做，2.要，3.不做，4.不同步」）

| #   | 问题           | 裁决          | 落地动作                                               |
| --- | -------------- | ------------- | ------------------------------------------------------ |
| 1   | 三栏同屏（P1） | ✅ **做**     | P1 立项，**排在 TB-049 之后**（见「前置依赖」）        |
| 2   | 配置模板（P3） | ✅ **要**     | P3 立项；**优先级口径待补裁**（建议见下）              |
| 3   | 审核规则（P4） | ❌ **不做**   | P4 关闭                                                |
| 4   | 灵境与糖包打通 | ⛔ **不同步** | 各自独立维护；灵境仅作**形态参考**，不引入任何数据依赖 |

**② 仍待补裁**：配置模板**要**，但「模板与节点直接覆盖谁优先」未定。建议口径：

> 只做「**从现有节点反向存成模板**」+「**套用**」，
> **不做「所有节点都必须走模板」**。
> 理由：模板是**增加一层间接**，与 ADR-0011「收窄节点覆盖」方向有张力 ——
> 若模板凌驾于节点覆盖之上，等于把刚收窄的层级又加回去。

**④ 不同步的额外收益**：不打通 ⇒ 可放心按糖包本地优先特性演进（SQLite / 离线可用），
不必为「与灵境对齐字段名」而妥协命名或结构。

#### 前置依赖

**P1（三栏同屏）建议排在 TB-049 之后**。理由：三栏同屏会大面积重组
`ProjectTreeWorkbench` 与 `PostprocessSettingsModal`，而 TB-049 的白名单 bug
会让所有导出都落空 —— 重构完仍看到「导出位置不可用」，**分不清是新引入还是老 bug**。

---

### TB-059 「参与自动后处理」开关与「启用范围」警告互相矛盾（文案对齐）

- **来源**：杰哥截图（2026-09-20 23:40）「你这两个参数不是自相矛盾吗，一个没启用，一个又显示已启用」
- **状态**：✅ 文案逻辑与测试已提交；面板里的引用随另一条写线的提交进入（见下）
- **现象**：同一个参数面板里，上方警告写「这个方向不在后处理的启用范围内 ⇒ 归属它的图片不会产出
  渠道变体」，下方「参与自动后处理」开关却写「已开启」。

**根因**：这是**两个维度**，各自都对，但文案让人读不出从属关系 ——

| 维度               | 数据                                        | 粒度                     |
| ------------------ | ------------------------------------------- | ------------------------ |
| 后处理**启用范围** | 项目树「后处理」列勾选（`enabledScopeIds`） | 方向进不进流程           |
| 方向级开关         | `PostprocessNodeOverride.enabled`           | 进了流程的方向里再单独关 |

实际是否产出 = **① AND ②**。只把 ② 显示成「已开启」，等于把它说成结论，于是与"不产出"的警告打架。

**改法（最小、且不禁用）**：文案抽成纯函数 `features/postprocess/participationLabel.ts`
的 `formatParticipationLabel(enabled, inEnabledScope)`：

| enabled | inEnabledScope | 文案                                                        |
| ------- | -------------- | ----------------------------------------------------------- |
| false   | 任意           | `已关闭`（关闭 + 不产出是一致的，本就没有矛盾）             |
| true    | true           | `已开启`                                                    |
| true    | false          | `已开启（未生效）` ← **值如实显示，但不再暗示它正在起作用** |

另给开关外层加 `title`：「这个方向不在后处理的启用范围内，开关值当前不影响产出；请先到项目树启用」。

**⭐ 刻意不置灰**：范围外仍允许改这个值（先把参数配好，进了范围即生效），
而且**既有契约就是「开关随时可写」** —— `PostprocessSettingsModal.test.tsx` 有一条
「参与方式开关写进本级的 enabled 覆盖」，我第一版加了 `disabled` 正是被它拦下。
**先读既有测试再动交互**，这是这回没走弯路的唯一原因。

**为什么单独成一个模块**：纯文案逻辑，独立后测试不必拉起整个参数面板
（那边拖着 store / composite / 项目树一堆依赖）。

**验收**：`participationLabel.test.ts` 3 例；`PostprocessSettingsModal.test.tsx` **31 例全绿**；
反向验证有效（文案改回固定「已开启」⇒ 对应用例失败 ✔）。
**⚠️ 未能渲染验证**：本机仍无法渲染（见 TB-055），改动是文案 + `title`，无布局风险。

**⚠️ 提交边界（这次是"半隔离"）**：`PostprocessParamPanel.tsx` 此刻正被另一条写线重写
（他们刚把开关 label 从静态文案「生成完成后自动产出变体」改成状态文案 —— **矛盾正是这么冒出来的**），
我的两处改动（import + 开关文案）直接落在他们改写的那一段里，
**无法干净地嫁接到 HEAD**（HEAD 连 label 内容都不同，硬贴会造出一个既非旧版也非新版的中间态）。
⇒ 本轮只提交新模块 + 测试（不碰他们的文件）；面板里的引用**留在工作区，随那条线的提交一起进入**。
这是个新的边界形态：**当修复必然与对方的未提交代码重叠时，"只提交我能独立成立的部分"**，
并把依赖写进 BACKLOG，避免将来误判成"改了却没接线"。

---

### TB-058 SOP 管理中心弹窗高度随内容自适应（消除底部留白）

- **来源**：杰哥「底部不要空出这么多空间，请让底部区域的高度根据实际内容动态自动调整」
  （2026-09-20，与 TB-055 / TB-057 同一件事）
- **状态**：✅ 已完成 · 写线：主写线
- **根因**：`.sop-center-dialog { height: min(86vh, 860px) }` 写死高度 ——
  内容少的分组（单张配方卡、列表只几条）排不满，就在底部留一大片空白。

**改法（三处，必须一起）**：

```css
.sop-center-dialog {
  height: auto;
  max-height: min(86vh, 860px);
} /* 随内容，上限兜住 */
.sop-center-dialog:has([data-generation-one-screen='true']) {
  height: auto;
  max-height: min(92dvh, 860px); /* 「生成一屏」变体同理 */
}
.sop-center-dialog .sop-center-library-grid,
.sop-center-dialog .sop-center-meta-grid,
.sop-center-dialog .sop-center-generate-grid {
  flex: 1 1 auto; /* ← 不能是 0，见下 */
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}
```

**⭐ 为什么内容根的 basis 必须一起改**：弹窗高度改由内容决定后，内容根若还是
`flex: 1 1 0%`（行内 `flex-1`），它会在固有尺寸计算里贡献 0 ⇒ **弹窗塌成「头部 + 标签栏」**。
TB-057 在后处理弹窗上踩过同一个坑，这里是同一个坑的第二处 —— 所以两条规则写在同一批改动里。
覆盖用两段选择器提特异性，压过行内的 `.flex-1`。
行高给 `minmax(0, 1fr)` + `overflow: hidden`：内容超高时行可收缩，滚动交给列内自己的滚动区。

**大弹窗模式同步**：行内 `LARGE_MODAL_SIZE_STYLE` 的 `height: 80vh` 会压过 CSS ——
内容少时那处留白比默认模式更大（「点一下放大反而更空」）。局部覆盖为
`{ ...LARGE_MODAL_SIZE_STYLE, height: 'auto', maxHeight: '80vh' }`，宽度仍 80vw。
**没动共享常量**：`DetailModal` / `SopBatchDetailModal` / `GallerySopBatchModal` 都在用它，
改常量会波及一圈弹窗。

**验收**：新增 `features/strategy/sopCenterSizing.test.ts` **尺寸契约 3 例**
（默认随内容 / 一屏变体随内容 / 内容根 basis 非 0 且三个网格同组）。
jsdom 没有排版引擎、量不出真实高度，但「高度是不是写死的、basis 是不是 0」能精确锁住，
而这正是报障根因。**反向验证两条均有效**：高度改回 `min(86vh,860px)` ⇒ 失败 ✔；
basis 改回 `0` ⇒ 失败 ✔。`SopManagementCenter.test.tsx` 的大模式断言同步改为
`height: 'auto'` + `maxHeight: '80vh'`（**50 例全绿**）；`prettier --check` 通过。

**⚠️ 提交边界隔离（第五次）**：`styles.css` / `SopManagementCenter.tsx` /
`SopManagementCenter.test.tsx` 三个文件上都挂着另一条写线的未提交改动（按 R-09 不连带提交）
⇒ `git show HEAD` 取基线 + 只贴我的改动 → 提交 → 还原工作区版本。
自检：暂存区 `21/2`、`8/1`、`3/1` 全是我的。

**⚠️ 未能渲染验证**：本机仍无法渲染（`file://` 被拦 / 浏览器工具缺 Chromium，见 TB-055），
本条目同样只有 CSS 规则推导 + 契约测试。

---

### TB-057 后处理弹窗高度随内容自适应（消除底部留白）

- **来源**：杰哥截图（后处理弹窗）「底部不要空出这么多空间，请让底部区域的高度根据实际内容
  动态自动调整，避免出现多余的留白」
- **状态**：✅ 已完成 · 写线：主写线

**⭐ 同一个诉求：底部不留白**（杰哥 21:32 与 21:36 两次截图说的是同一件事）
**—— 容器高度被写死，内容少就空一截。三处的根因与改法：**

| 位置                     | 写死在哪                                         | 改法                   | 条目   |
| ------------------------ | ------------------------------------------------ | ---------------------- | ------ |
| 配方卡面板（编辑器卡片） | `.sop-recipe-panel { flex: none }`               | 内容**撑满**固定高容器 | TB-055 |
| 后处理弹窗               | `.ds-dialog--postprocess { height: 80dvh }`      | 容器高度**随内容**     | TB-057 |
| SOP 管理中心弹窗         | `.sop-center-dialog { height: min(86vh,860px) }` | 容器高度**随内容**     | TB-058 |

一句话口径：**容器高度固定时让内容撑满；容器高度本来自由时让它贴合内容。**

**根因**：`.ds-dialog--postprocess { height: 80dvh }` —— 写死高度，
参数少的作用域（全局默认 / 单个方向）排不满，底部必然留白。
上一轮有人在内容区加了 `flex: 1 1 0` 补救，其实只是把空白挪进了内容区内部。

**改法**（两处必须一起改）：

```css
.ds-dialog--postprocess {
  height: auto;
  max-height: 80dvh;
} /* 高度随内容，上限兜住 */
.ds-dialog--postprocess .ds-dialog__content {
  flex: 1 1 auto;
} /* basis 不能是 0 */
```

**为什么 basis 必须一起改**：弹窗高度改由内容决定后，内容区 `flex-basis: 0` +
`min-height: 0` 会让它在固有尺寸计算里贡献 0 ⇒ **弹窗直接塌成「头 + 脚」**。
`auto` 在两种情形都对：内容少时贴合内容，被 `max-height` 截住时仍撑满并内部滚动。

**验收**：新增 `design-system/dialogSizing.test.ts` **尺寸契约测试** 2 例
（读 CSS 文本断言声明）—— jsdom 没有排版引擎、量不出真实高度，
但「高度是不是写死的 / basis 是不是 0」可以精确锁住，而这正是报障根因。
**反向验证两条均有效**：高度改回 `80dvh` ⇒ 失败 ✔；basis 改回 `0` ⇒ 失败 ✔。
`prettier --check` 通过；`src/components/PostprocessSettingsModal` + `src/design-system`
**12 文件 / 289 例全绿**；eslint 0。

**顺带确认**：`.ds-dialog--lg / --xl` 只设 `max-width`，高度本来就自适应 ⇒
配方卡详情弹窗（xl）不受此问题影响。

---

### TB-056 外层展示配方卡原文与解析状态（不打开详情也能判断）

- **来源**：杰哥「我发现你在外层界面上不显示配方卡的原始文本，导致我在外部无法判断某个配方卡
  是否已经填写了内容」→ 要求外层同时给**原文**与**解析状态**（待解析 / 解析中 / 已完成 / 失败）
- **状态**：✅ 已完成 · 写线：主写线
- **为什么是真问题**：从库里打开的配方卡**不经过「粘贴原文」这一步**，
  外面只有录人框 ⇒ 一片空白，看不出「有没有内容」。上一轮把内容全搬进弹窗，
  解决了重复、却把「一眼判断」也搬走了。

**外层新增「内容概览」区**（只读，在录入框下方）：

| 内容           | 说明                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| 解析状态徽章   | `待解析` / `解析中…` / `解析完成` / `解析失败` / **`已保存内容`**       |
| 失败原因       | 就地显示（原来在录入区里，已迁入概览）                                  |
| 维度规模       | `N 个维度 · M 个候选值 · 组合空间 X 条`（复用 `summarizeParsedRecipe`） |
| 骨架原文       | 等宽只读展示当前 `config.body`，最高 7rem 可滚                          |
| 空态           | 「这个配方卡还没有内容：粘贴原文后点解析，或进详情手动加骨架与维度」    |
| 原文已改动提示 | 解析后又改了录入框 ⇒ 「原文已改动，点解析更新下面这份内容」             |

**为什么是五态而不是他列的四态**：多一个 `已保存内容` —— 从库里打开的配方卡带着上次存下的骨架，
本次并没有解析过。算「待解析」会让人以为内容没保存，算「解析完成」又是假的。
**这一态必须单列，否则「外面能不能判断填了没有」这件事仍然说不清。**

**「解析中」不是装饰**：解析是本地同步函数，几百 KB 原文会把主线程卡住。
`handleParse` 改为**先置 `parsing` 渲染一帧，再在下一 tick 跑同步解析** ——
没有这一帧，用户看到的只是界面没反应。时序有测试钉住（flush 之前断言「解析中…」）。

**同时删掉的重复**：录入区里原来的绿色成功提示与红色失败提示一起移除 ——
状态徽章 + 概览已经把「成没成、为什么没成」说清了，留着就是同一件事两处都说
（这是 TB-054 那条教训的延续：加了新容器就收掉外面被它取代的那层）。
失败**原因**保留在概览里（徽章只说状态，原因是可执行信息）。

**实现要点**：`rawChangedAfterParse` 用**精确比较**而不是 `trim()` 比较 ——
后者会让「加了个空格」这种改动不提示，提示就不诚实。

**验收**：tsc 0 · eslint 0 · strategy **33 文件 / 472 例全绿**；
面板测试从 3 例扩到 **8 例**（空态 / 已保存内容 / 解析中→完成 / 失败 / 原文改动 / 入口可用性 /
只有 1 个输入框 / 编辑器零件不外露）。
**反向验证有效**：去掉「解析中」那一帧 ⇒ 对应用例失败 ✔。
⚠️ 测试 harness 必须把 `onChange` 落到 state 上（受控组件用空回调会得出
「解析完却没有内容」的假结论）；文本收集改走 TestInstance `children` 递归
（`toTree().rendered` 在根是自定义组件时会静默收空串）。

---

### TB-055 配方卡面板撑满容器（消除下方大片留白）

- **来源**：杰哥截图反馈「引擎卡的组件需要自适应填满整个界面容器，避免在下方留出大面积空白」
- **状态**：✅ 已完成 · 写线：主写线
- **根因**：`.sop-recipe-panel` 写死 `flex: none` —— 它只占自身内容高度，
  而编辑器卡片（`flex-1 flex-col`）里剩下的空间全空着。面板瘦身后（TB-054 续）
  内容更少，留白更明显。

**改法（只动面板自己的伸展链，不碰共享类的行模板）**：

| 选择器                               | 改动                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `.sop-recipe-panel`                  | `flex: none` ⇒ `flex: 1 1 auto` + `min-height: 0` + 行模板 `auto minmax(0,1fr)`（头部固定、正文吃满） |
| `.sop-recipe-panel__body`            | 加 `min-height: 0`（flex/grid 子项默认不收缩）+ 显式 `grid-template-rows: minmax(0,1fr)`              |
| `.sop-recipe-panel > …__body`        | `overflow: auto`：窗口很矮时正文自己滚，而不是被面板的 `overflow:hidden` 裁掉操作栏                   |
| `.sop-recipe-import`                 | 自己吃满 + 行模板 `auto minmax(0,1fr) auto`（标题 / **原文框** / 操作栏）                             |
| `.sop-recipe-import__field`          | 新增规则：`grid-template-rows: auto minmax(0,1fr)`（label / textarea）                                |
| `.sop-recipe-import__field textarea` | 加 `height: 100%` 与 `resize: none`（高度改由布局算，手动拖拽会与自适应打架）                         |

**为什么 `__body` 要显式写 1fr**：原本只靠「auto 行会被 `align-content` 拉伸」这个隐式行为，
它依赖容器有确定高度才成立 —— 换个父容器就会**静默**退回「又留白」。
显式 1fr 后：面板场景吃满；弹窗场景（容器高度由内容决定）1fr 退化为内容尺寸，与原来的 auto 等价。

**⚠️ 验证边界（如实记录）**：本轮**没能渲染验证**。三次尝试都被环境挡住：
① `agent-browser` 的 Chromium 未安装（`open` 静默被杀）；
② Electron 离屏加载 `file://` 一律 `ERR_FAILED`（连极简 HTML 也拦，判定为环境级限制）；
③「Electron + 本地静态服务」组合在这条命令里 127 起不来。
所以改法与量测台都按 CSS 规则推导，**待杰哥在运行中的实例里过目**（styles.css 改动会 HMR 生效）。
量测台与量测脚本已留在 `.git/`（`build-fill-harness.py` / `measure-fill.cjs` / `serve-temp.cjs`），
环境修好后可一键复测。

**验收**：`prettier --check styles.css` 通过（CSS 语法解析无误）；
**无 JS 改动**，故测试面不变。

---

### TB-054 配方卡「解析结果」弹窗（只读）

- **来源**：杰哥「为配方卡引擎解析出的内容添加弹窗展示功能：在配方卡原文区域右下角、
  即解析按钮所在栏的右侧新增一个弹窗入口，点击后以弹窗形式呈现解析结果，
  并明确弹窗的触发方式、展示内容与关闭交互」（2026-09-20）
- **状态**：✅ 已完成 · 写线：主写线
- **为什么需要**：解析完成后界面只有一句提示（「已识别 N 个维度、组合空间 M 条」），
  而解析器其实还读到一批**别处看不到**的信息：原资产声明的名称 / 说明 / 主控槽、
  带 `en` 英文描述的候选值、模板引用了但池里没有的占位符、原资产元信息（模型 / 禁用词）、
  若干非致命告警。识别错了用户没地方核对，只能凭感觉。

**触发方式**：`SopCampaignRecipePanel` 的「配方卡原文」区域右下角、解析按钮所在栏最右端
（放在「N 字符」之后 —— 那个 span 自带 `margin-left:auto`，插在它前面会被挤到中间）。
未解析过时**禁用并给出原因**（`title` 说明「先粘贴原文并点『解析』」），
不给一个点了没反应的按钮。解析过（成功或失败）都可打开：失败时弹窗展示失败原因，
否则用户点入口只看到空弹窗更困惑。

**展示内容**（全部只读，不提供任何编辑或「应用」）：

| 区块       | 内容                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| 摘要       | 成功 / 失败徽章、识别来源（JSON / 自由排版）、维度数、候选值数、组合空间、带英文描述数 |
| 原资产信息 | 名称 / 说明 / 主控槽 / 模型 / 标题槽（缺失显示「未识别」）                             |
| 维度池     | 逐维度：名称、权重徽章、有效候选值数、**候选值全文**                                   |
| 提示词骨架 | 模板原文（等宽、可滚动）                                                               |
| 缺失池     | 模板引用但池里没有的占位符（不补齐引擎会拒绝生成）                                     |
| 解析提示   | 非致命告警逐条列出                                                                     |
| 元信息     | 原资产禁用词项数与词表（标注「本引擎不自动套用」）                                     |

**关闭交互**（四处，全部走既有约定，不新造）：右上 X、底部「关闭」按钮、Esc、点遮罩。
关闭**不清空**解析结果，再点入口内容还在（用户常要「看一眼 → 关掉 → 改两笔 → 再看一眼」）；
「清空」按钮会连带关掉弹窗（结果被清了，弹窗留空态会让人以为内容丢了）。

**⭐ 加了弹窗就要把外面重复的那层收掉（杰哥当场指出）**：

第一版只加不减 —— 弹窗做完了，外面还留着三处重复：

| 外面的旧内容                                    | 与谁重复                       | 处置 |
| ----------------------------------------------- | ------------------------------ | ---- |
| 绿色成功提示（已识别 N 个维度、组合空间 M 条…） | 下方「解析结果确认」区块的数字 | 删   |
| 解析告警行（`parsed.warnings`）                 | 弹窗「解析提示」               | 删   |
| 原资产元信息行（模型 / 禁用词项数）             | 弹窗「原资产信息」             | 删   |

杰哥原话：「你这加了弹窗又还把解析成功放在外面，那你告诉我，改成弹窗的意义在哪里呢」。
⇒ **弹窗的意义就是「外面只留状态与入口」**，收拾后的职责分工：

| 位置                 | 唯一职责                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| 原文区域（外面）     | **状态 + 入口**：成功 / 失败一行结论（不带数字）；入口按钮带「N 条待注意」 |
| 「查看解析结果」弹窗 | **全部细节**：原资产信息 / 维度值全文 / 骨架 / 缺失池 / 告警 / 元信息      |
| 下方「解析结果确认」 | **编辑面**（维度数、组合空间本来就在这，不再于别处复述）                   |

新增导出 `countParsedRecipeAttention`（告警 + 缺失池）：外面**只报条数、不铺内容**，
让人知道「弹窗里有没有事要看」。

**需要留意的一处**：面板里的 `countRecipeEnglishOptions` 现在只被（另一条写线的）测试引用，
生产链路已无消费者 —— 那条信息已由弹窗摘要承担。**没删**（不是我的文件），留给那条线决定。

**三条刻意口径**：

1. **只读**。编辑入口在面板表单上，弹窗再放一套必然出现「弹窗里改了、表单没同步」；
2. **摘要数字是「解析结果自己」的，不是当前表单的** —— 用户改过表单后两者会分叉，
   混淆就会得出「解析器读错了」的错误结论。标题下明确标注这一点；
3. **组合空间遇空维度归零**（不用 `Math.max(1, …)`）：空维度会让引擎拒绝生成，
   显示 0 才是诚实的。

**落地**：新增 `features/strategy/SopCampaignRecipeParseResultDialog.tsx`（+ 同目录测试）、
`SopCampaignRecipePanel.tsx` 加入口与状态、`catalog.ts` 登记。

**验收**：tsc 0（我的文件）· eslint 0 · prettier 全绿 ·
新增测试 **10 例**（摘要口径 2 + 留意条数 1 + 展示内容 3 + 关闭交互 4）；
`src/features/strategy` **31 文件全绿**（跑验证时把另一条线的未跟踪测试临时挪开 ——
它的隔离窗口里引用不到那份未提交导出）。
**反向验证两条均有效**：空维度不归零 ⇒ 摘要用例失败 ✔；禁用 `closeOnBackdrop` ⇒ 遮罩用例失败 ✔

**⭐ 形态再进一层（同日，杰哥定）：外面只放原文，骨架 / 维度 / 预览 / 词表全部进弹窗、且在弹窗里编辑**

原话：「外面窗口只显示原文内容，不要做任何改动；其余所有骨架、维度等信息全部移入详情弹窗中，
仅在弹窗内展示」。我复述确认后他选了 **A（弹窗内可编辑）**，并要求采样预览与红线词表一起进弹窗。

| 位置                | 内容                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| 外面（面板）        | 面板标题 + 「整段录入」：配方卡原文 TextArea（**原样不动**）+ 解析 / 清空 / N 字符 / 查看解析结果         |
| 详情弹窗（size xl） | 状态条 + 原资产信息 + 缺失池/告警 + **提示词骨架（可编辑）** + **维度池（增删改）** + 采样预览 + 红线词表 |

两个必须记的坑：

1. **入口不能只看 `parsed`**：配方卡常是从库里打开的老资产，用户这次根本没粘原文 ⇒
   入口会永远是灰的、编辑器彻底进不去。可用条件是「有解析结果 **或** 有已保存配置」，
   弹窗里跟解析有关的区块在没有解析结果时整块不渲染。
2. **「正文」是骨架，不是 `content`**：顺手按杰哥要求让配方卡 SOP 不渲染普通 SOP 的
   正文编辑窗口（`SopTextEditor`）—— 配方卡 `content` 恒为空，留个空框只会让人以为内容丢了。

**弹窗零外部依赖**：本来要用的 `resolveEffectiveDominantSlots`（主控槽按权重推导）只存在于
另一条写线的未提交改动里，直接 import 会让提交后的 HEAD 编译不过。
⇒ 改成**由面板算好传 prop**（`dominantSlots`）：工作区版用他们的推导，提交版退到
`meta.dominantSlots`（解析声明）。两版都能编译，权重口径的唯一实现仍在引擎模块里。

**测试调整**（react-test-renderer 渲染不了 portal —— 实测报
`parentInstance.children.indexOf is not a function`）：

- 弹窗相关断言全部放 jsdom + createRoot 的 `SopCampaignRecipeParseResultDialog.test.tsx`
  （展示内容 / 编辑骨架 / 加维度 / 按骨架补齐 / 改候选值 / 红线标记 / 数字只说一次 / 关闭四处）；
- `SopManagementCenter.test.tsx` 里 4 个配方卡用例改为「外面断言 + 用面板 `onChange` 模拟编辑」，
  其中红线标记那条**迁入弹窗测试**（原文件触达不到 portal）；
- 新增 `SopCampaignRecipePanel.layout.test.tsx`：外面只有 1 个 textarea、不含「提示词骨架 /
  维度池 / 加维度 / 预览 / 合规红线词表」等已移出文案、入口可用性、成功提示不重复数字。

**⚠️ 提交边界隔离（第二次用同一配方）**：`SopCampaignRecipePanel.tsx` 同时带着另一条写线的
9 处未提交改动。按 R-09 不连带提交 → 用「`git show HEAD` 取基线 + 只贴我的 5 处改动」构造版本
提交，随后把并存版本还原回工作区。自检：`git diff` 该文件只剩对方的改动 ⇒ 隔离成功。

---

### TB-053 水印预设 tab 改为「中控台」，水印降为其中一个功能分区

- **来源**：杰哥原话「将水印预设 tab 改为中控台，具体内容参数参考这个网站的资产中心，
  **将水印预设改为其中的一个功能」**（2026-09-20）
- **状态**：✅ 已完成（三轮）· 写线：主写线
- **验收标准**（可测）
  1. 顶栏 tab 文案 = **「中控台」**（原「水印预设」），`appMode` 仍是 `postprocess`
  2. 工作区有**功能分区导航**（`aria-label="切换中控台功能"`），水印是**首个分区**且为默认
  3. **每个注册分区都能切过去，且同一时刻只渲染一块**（有专门用例锁定）
  4. 水印分区内容与改动前**一致**（三栏装配未动）
  5. 工作区容器 `aria-label` = `中控台工作区`
  6. 中控台是**全部参数的统一编辑入口**：有节点级可覆盖字段的分区必须能就地改节点值
  7. `npm run verify` 全绿
- **落地（第一轮）**：`src/components/Header.tsx`（tab 文案）、`CompositeWorkspace.tsx`、
  `catalog.ts`（登记）、`pages/postprocess.md`
- **落地（第二轮）**：新增 `lib/controlConsoleSections.ts`（分区注册表）、
  `components/MediaSection.tsx` / `OutputSection.tsx` / `DistributionSection.tsx`；
  `CompositeWorkspace.tsx` 改为装配 4 个分区；`catalog.ts` 补 3 条登记
- **形态依据**：灵境资产中心里水印**不是独立页面**，而是产品资料下与
  「渠道与尺寸 / 输出位置」并列的**配置 tab** ⇒ 糖包照此把水印从「整个 tab 就是水印」
  收成「中控台里的一个功能」

#### ⚠️ 未完成的核实（需杰哥补一次凭证）

线上实测没做成：杰哥给的账号密码被服务端拒绝（见本节末「线上复核」）。
分区设计依据的是仓库已沉淀的实测报告 `docs/reference-lingjing-asset-center.md`
（2026-09-20 早先已登录实测过），**不是凭印象**。

#### 第二轮（同日）：从「单分区占位」扩成真正的中控台框架

杰哥原话「你可以拉取这个项目的最新分支来进行复刻资产中心：
`git clone https://git.gzjunbo.net/Digital-Intelligence-Lab/junbo_cy_admin.git`」，
后改为「那先不克隆了，你根据现有资料做好框架出来」。

**⚠️ 仓库拉取失败（已实测，不是猜的）**：

```
curl https://git.gzjunbo.net/.../junbo_cy_admin.git/info/refs?service=git-upload-pack
  → HTTP 401 Unauthorized
git ls-remote <同地址>
  → fatal: could not read Username for 'https://git.gzjunbo.net': terminal prompts disabled
```

⇒ 该仓库**需要鉴权**，且本机 `git-credential-manager` 里**没有 `git.gzjunbo.net` 的凭据**
（同主机 `https://git.gzjunbo.net/` 根路径返回 303，说明站点可达，纯粹是权限问题）。
**未克隆成功，未读取任何该仓库代码。**

**交付：4 个分区的中控台框架**

分区注册表 `src/features/composite/lib/controlConsoleSections.ts`（单一真相源，
顺序即界面顺序，第一个是默认分区）：

| 分区       | 组件                  | 作用域口径                                                         |
| ---------- | --------------------- | ------------------------------------------------------------------ |
| 水印       | `PresetManagementTab` | 既有三栏装配**一行未动**；**默认分区**（历史唯一入口）             |
| 渠道与尺寸 | `MediaSection`        | 复刻资产中心的**分组头计数徽章**（`N / M 已应用`）+ 尺寸卡片三要素 |
| 输出位置   | `OutputSection`       | 全局渠道表（复用 `ChannelOutputDirs`）+ 节点覆盖冲突**显式警告**   |
| 分发       | `DistributionSection` | 纯净版自动伴随 + 分发配置（复用既有组件）                          |

**⭐ 一条准入约束（写进页面规范，新增分区前必读）**：

> **每个分区必须指向「唯一作用域」的参数。**
> 全局共享规格（渠道与尺寸 / 分发）可以整体搬进来 —— 它们本来就只有一个家；
> 多层继承的参数（输出位置、水印归属）只能用「**全局基线 + 冲突警告**」的形态，
> **不在中控台里再造一套节点编辑器**（同参数两个可编辑入口 = 迟早「在 A 改了、在 B 看不到」，
> 见 `PresetProjectTree.tsx:9-11`）。

这条约束直接决定了本轮**没有**把 `PostprocessParamPanel` 整块搬进来 ——
它是「全局 + 节点」双作用域面板，搬进来就会在输出位置/水印上制造第二个编辑器。

**另一个实测发现**：`PostprocessSettingsModal` 是 `InputBar` 的**局部 state**
（`InputBar.tsx:1375`），而 `InputBar` 只在 `gallery` / `agent` 下渲染 ——
**中控台里「跳到后处理设置」这条路走不通**（组件没挂载）。
⇒ 因此三分区改为**直接托管真实编辑器**（`MediaTableManager` / `ChannelOutputDirs` /
`PostprocessDistributionFields` 都是自包含的），而不是「给个链接让人跳过去」。
这条是设计被迫修正的地方，值得记住：**跨工作区的「跳转」要先确认目标在不在挂载树上。**

**验收**

- `tsc -b` 本轮文件零报错 · eslint 0 · prettier 全绿
- `src/features/composite/` **19 文件 / 167 用例全绿**；`src/design-system/` **252 用例全绿**
- 新增测试：分区注册表 3 例 + 装配 4 例（含「每个注册分区都必须能切过去且只渲染一块」）

#### 第三轮（同日）：修正定位 —— 中控台是「全部参数的统一编辑入口」

**触发**：杰哥指出「中控台目的是控制所有参数设置资产，所以应该拥有全部权限，你觉得呢」，
并在阿伟以 `PresetProjectTree.tsx:9-11` 那条铁律反驳后澄清：
「有没有可能那个所谓的铁律是你理解错了呢，我说只有一个入口就是指中控台」。

**⭐ 阿伟确实读反了那条注释**（记下来，避免再犯）：

- `PresetProjectTree.tsx` 的主语是**树**：「输出目录、命名模板、渠道规格、启用范围全在
  后处理那套界面里……**所以树上一个都不放**」——树为不跟后处理界面打架而退让，
  **不是**「后处理界面只能看」。
- `docs/postprocess-unify-on-hanling-plan.md:321` 更直白：「**归属的唯一入口 = 树**，
  `ProjectNodeParamsDialog` 删掉『水印预设』字段」——归属树是权威，弹窗是被砍的一方。
- 结论：**中控台才是被保护的主入口**。上一轮把「树」当成权威、把中控台锁在只读全局层，
  是方向搞反了。

**本轮交付：作用域选择器**

新增 `components/ConsoleScopePicker.tsx`：下拉选「全局默认」或某个树节点，
决定分区内控件读写哪一层参数（`GLOBAL_NODE_ID` = 基线，其余 = `AssetCollection.id`），
配套 `isGlobalScope()` 统一哨兵判定。`OutputSection` 已接入：

| 作用域 | 写入目标                                                                        |
| ------ | ------------------------------------------------------------------------------- |
| 全局   | `usePostprocessMediaStore.mediaOutputDirs`（`setMediaOutputDir`）               |
| 节点   | `PostprocessNodeOverride.byMedia[mediaId].outputDirs`（并存时摘旧 `outputDir`） |

节点作用域下留空的项继续向上继承，并用**父节点单独解析一次**作为占位提示——
让用户看见「清掉本级覆盖会退回哪里」，而不是清完才发现变了。

**⭐ 实测纠正了一个错误假设（重要）**：本来打算给「渠道与尺寸」「分发」也挂作用域选择器，
`tsc` 直接报错拦下 —— `PostprocessNodeOverride`（ADR-0011 收窄后）**只有四个字段**：

```
outputDir / watermarkPresetIds / enabled / byMedia
```

`distribution` / `autoCompanionClean` / `selectedMediaIds` **不在其中**，
它们在前端只在全局层存在（v1→v2 迁移时被提升到 `promotedGlobals`，属**只读存档**）。
⇒ 那两个分区**刻意不挂作用域选择器**，界面上写明「全局一套」。
**给用户一个能选节点、选了却什么都不变的控件，比不给更糟。**

（写进 `pages/postprocess.md` 的准入约束：新增分区先问「这个参数在 `PostprocessNodeOverride`
里吗」——在就挂选择器，不在就按纯全局分区处理。）

**验收**

- `tsc -b` 零报错 · 主进程 `tsc` 零报错 · eslint 0 · prettier 全绿
- **`npm test` 237 文件 / 2719 用例全绿**
- 新增 `ConsoleScopePicker.test.tsx` 4 例：全局首项 / 节点按层级缩进 / 悬空 id 退回全局 / `allowNodeScope:false` 只剩一项
- **反向验证已做**（两条探针都有效）：
  1. 拿掉「悬空 id 退回全局」兜底 → 对应用例立刻失败 ✅
  2. 忽略 `allowNodeScope` → 对应用例立刻失败 ✅

**文档同步**：`pages/postprocess.md`（分区表 + 准入约束重写）、
`lib/controlConsoleSections.ts`（表头约束 + 三条描述）、
`PresetProjectTree.tsx`（补一句「别把这条读成树是权威」，点明中控台才是统一入口）、
`catalog.ts`（登记 `ConsoleScopePicker` + 修正 `OutputSection` 描述）

**⚠️ 顺带发现（未处理）**：`docs/BACKLOG.md` 里 **`TB-053` 编号被用了两次** ——
1271 行是「取消提示词生成点了没反应」，1424 行是本节（中控台）。编号冲突应改掉其中一个。

- **反向验证**：摘掉 `distribution` 分区的接线 → 装配用例立刻失败 ✔（探针有效）
- 顺带修：`MediaSection` 两处裸 `rounded-md/sm` 被**设计系统棘轮**拦下 → 改 `rounded-ds-lg`
  （合规测试是硬门禁，新 `.tsx` 写裸圆角必挂）

#### 第四轮（同日）：界面改为「左树 + 右内容」，完全对齐灵境策略中心

**触发**：杰哥实测后说「现在的中控台界面不对，我需要你完全参考
`https://junbo-cy.jetmobo.com/strategy/center`」，并提供凭据（陈泽杰，不勾记住我）。

**登录成功**（第三轮里凭据被拒的结论作废：那轮试的是资产中心地址的 RuoYi 老登录口；
本轮用页面真实表单一次通过）。用 agent-browser 抓了整页无障碍快照，结构如下：

- 左栏「策略资产库」：搜索框 + tab（全部/已归档）+「全部策略 N」+ 树（产品线 → 产品 → 方向，
  节点 = 展开箭头 + 名称 + 计数徽章）+ 回收站；
- 右区：当前方向标题（如「月亮」）+ 筛选行（发布状态 / 配置完整性 / 搜索 / 每行数量 / 网格列表）
  - 批量操作行 + 策略卡片网格（封面多图 + 状态徽章 + 编号 + 最后发布时间 + 渠道/尺寸/审核统计）。

**语义映射**（灵境 → 糖包）：

| 灵境                     | 糖包                                              |
| ------------------------ | ------------------------------------------------- |
| 点方向看该方向的策略卡片 | 点节点**切作用域**，右区编辑该节点覆盖值          |
| 「全部策略 304」         | 「全局默认」总览项（徽章 = 节点总数）             |
| 节点徽章 = 该方向策略数  | 节点徽章 = 该节点写了几个**覆盖字段**（0 不显示） |
| 右区标题 = 方向名        | 右区标题 = 作用域名 + 面包屑路径                  |
| 筛选行 / 卡片网格        | 分区 SegmentedControl + 分区内容                  |
| 回收站                   | 糖包无对应实体，**刻意不做**                      |

**交付**：

- 新增 `components/ConsoleAssetTree.tsx`：左栏作用域树（搜索 + 全局默认项 + 树 +
  覆盖计数徽章，点节点 = 切作用域；搜索命中保留祖先链，搜索态视为全展开）；
- `CompositeWorkspace` 从「顶部 tab 换分区」改为**左树 + 右内容**两栏，
  作用域提升为工作区级状态（切分区不重置）；
- `OutputSection` 去掉内嵌 `ConsoleScopePicker`（作用域由左树驱动）；
- **`ConsoleScopePicker` 退役删除**（含测试），`isGlobalScope` / `ConsoleScope`
  迁到 `controlConsoleSections.ts`（注册表成为作用域概念的单一真相源）。

**验收**：

- `tsc` 双端 0 · eslint 0 · prettier 本轮文件全绿
  （format:check 报的 2 个文件在另一条写线的 `src/features/strategy/`，不属于本轮）·
  **`npm test` 237 文件 / 2722 用例全绿**
- 新增 `ConsoleAssetTree.test.tsx` 5 例（全局项徽章 = 节点数 / 点节点切作用域 /
  点全局回基线 / 覆盖徽章只挂有覆盖的节点 / 搜索过滤剪无关节点）
- **反向验证两条均有效**：废掉搜索过滤 → 搜索用例失败 ✔；徽章恒不显示 → 徽章用例失败 ✔

#### 第五轮（同日）：补灵境的「卡片网格 + 两行工具栏」，并按业务模型校准语义

**触发**：杰哥「我要的是你全局复刻灵境的，而不是套用当前程序本身的功能」，
紧接着澄清业务模型：**「每个方向包含水印、渠道等等的参数，我生成图片直接调用就行，
所以我一直是全局树结构」**。

**这一句校准了三个此前做错的落点**：

1. 左树是**参数的组织骨架**，不是筛选器 ⇒ 点方向 = 右区变成「该方向的参数」；
2. 卡片实体 = 水印预设，但**在方向作用域下它的语义是「这个方向用不用这套」**
   （卡上直接开停用，写 `watermarkPresetIds`），全局作用域下才是只读总览；
3. 「绑定」这个额外动作不存在 —— 是「方向自带参数」的一次表达，不是要用户先建关系。

**交付**：

- `ConsolePresetCard`：真实画布封面（`renderCompositeV2ToCanvas`，与产出同渲染器）
  - 使用状态徽章 + 编号 + 画布/图层说明 + 悬停操作条；
    渲染失败退化尺寸占位块（单张失败不拖垮整片网格）
- `ConsolePresetGrid`：按每行数量排布（内联 `grid-template-columns`）、网格/列表两种视图
- `ConsoleToolbar`：复刻灵境两行工具栏 —— 配置维度/归属范围下拉 + 搜索 + 每行数量
  - 网格列表切换；下行全选/取消/批量启用/批量停用/批量复制/批量删除。
    **灵境的「批量挪动」「一键发布」在糖包无对应动作，刻意不做**
    （放个点了没反应的按钮比不放更糟）
- `ConsoleAssetTree`：补「全部 N / 回收站 N」tab（回收站视图把 `trashedAt` 抹平后单独建树）
- `CompositeWorkspace`：右区改为 标题+新建按钮 / 工具栏 / 内容 三段；
  水印分区有「卡片 ↔ 编辑器」两个视图（编辑画布 ⇒ 切到 `PresetManagementTab`）

**语义细节（都是容易做错的地方）**：

- 「N 个方向在用」只数**显式声明**该预设的方向，不数继承值 ——
  否则全局清单会让每个预设都显示「N 个方向在用」，这个数字就废了；
- 全局态**不给开停用按钮**：全局水印清单在前端没有写入点（只有迁移/导入会写），
  给了就是假控件；
- 卡片上**不做重命名**（名称唯一入口在预设库）。

**验收**：tsc 双端 0 · eslint 0 · prettier 全绿 · **`npm test` 238 文件 / 2738 用例全绿**；
新增 `ConsolePresetGrid.test.tsx` 6 例（两作用域徽章语义 / 全局不给开关 / 每行数量 /
列表视图不留无效样式 / 空态）+ 装配测试重写为 6 例（含「树 → 作用域 → 右区标题」链路）。
**反向验证两条均有效**：全局也给开关 → 对应用例失败 ✔；忽略 perRow → 对应用例失败 ✔

#### 第六轮（同日）：作用域接上全局上下文指针（「在任何地方打开都默认是当前方向」）

**触发**：杰哥「现在全局统一树结构，那么我在那个方向打开任何东西都应该是默认选择了对应方向下的
内容，比如 SOP、比如水印等等，你觉得呢」。

**调研结论：方向和一半基础设施都已经在了（不是从零做）**：

| 已有件                                                                                     | 位置                                                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 唯一主源（项目树）                                                                         | `useAssetLibraryStore.collections`                  |
| **全局、持久化的「当前集合」指针**                                                         | `useAssetLibraryStore.scope`（`partialize` 里含着） |
| SOP 分组**已是项目树的投影**（`SopGroup.collectionId` 注释写明「项目文件夹树是唯一主源」） | `features/strategy/types.ts:100`                    |
| 中控台自己的局部 scope（第四轮写的 `useState`）⇒ **重复状态，本轮消除**                    | `CompositeWorkspace`                                |

**本轮交付（只做中控台这一半，理由见下）**：

- 中控台 `scope` 改为读 `useAssetLibraryStore.scope`（`{kind:'collection',id}` ⇄ `ConsoleScope`，
  非 collection 值 ⇒ 全局默认），点树节点写回同一个指针 ⇒ **切到中控台默认就是当前方向**；
- 新增窄 action `setCollectionContextScope(collectionId | null)`：
  **只挪指针，不动素材选中态**。与 `setScope` 刻意分开 ——
  后者是「素材库内部换范围」的语义，会清 `selectedAssetIds`；
  跨工作区同步时清掉用户在素材库选好的一堆图就是静默丢操作。

**⚠️ 刻意没做 SOP 侧**：`src/features/strategy/*` 正是**另一条写线**在动的文件
（工作区里 8 个 `M`），按 R-09 不碰。SOP 侧的方案已定（`selectedGroupId` 初始值由 scope
推导到对应 collectionId 的分组），等那条线收工再做。

**⭐ 分层铁律（写进页面规范）**：

> **上下文指针 ≠ 参数**。指针唯一（`scope`：现在看哪个方向）；
> 参数可多值（`selectedCollectionIds` 启用范围、`watermarkPresetIds` 方向用哪些水印）。
> 别把「当前方向」做成可多选的参数，也别让「启用范围」去覆盖指针。

**验收**：tsc 双端 0 · eslint 0 · prettier 全绿 · **`npm test` 238 文件 / 2751 用例全绿**；
新增 4 例（装配 3：读全局指针 / 写回全局指针 / 不动素材选中态；store 2：
窄 action 不清选中 + `setScope` 仍清选中）。
**反向验证两条均有效**：窄 action 也清选中 → store 用例失败 ✔；
中控台改回局部常量 → 3 个用例失败 ✔

#### 第七轮（同日）：SOP 打开时自动停在当前方向

**触发**：杰哥「SOP也要自动停在当前方向」（承接第六轮的全局上下文指针）。

**实现**：新增纯函数 `features/strategy/sopInitialGroup.ts` 的 `resolveInitialSopGroupId`
（`groups` × `collections` × `scope` → 分组 id）。当初没做是因为 `strategy/*` 是另一条写线
在动的文件；本轮那条线仍在动（`SopTextEditor.tsx` 等），所以**做了提交边界隔离**（见下）。

**分辨率策略：由深到浅**。项目树是「产品线 → 产品 → 方向」，而镜像到 SOP 的分组未必每层都建。
从方向自己开始往上找，第一个命中的分组就是它 —— 比「找不到就回全部」更符合预期：
用户在方向级会落到它的产品分组里，仍然看到相关内容。

**单向，不做双向绑定**：只在挂载时取一次（`useState` 惰性初始化 + `getState()` 快照）。
在 SOP 里换分组是它自己的浏览行为，不回写指针；反过来也不订阅 ——
订阅会让「别处换了方向」把用户正看的分组顶掉。且 SOP 有「全部 / 未分组 / 收藏 / 最近」
这些不对应任何方向的分组，回写只会把指针带偏。

**⭐ 提交边界隔离（这次事故教训的直接应用）**：
`SopManagementCenter.tsx` 同时带着另一条写线的未提交重构（`isCampaignRecipeSop` 抽模块），
且**与我的 import 落在同一个 hunk**（`git diff -U1` 可见）。硬做补丁手术易错，
改用更稳的构造法：

1. `git show HEAD:<file>` 取基线；
2. 用脚本把「仅我的两处改动」贴到基线上 → 写回文件；
3. tsc + 专项测试 → 提交（此时文件里没有别人的改动）；
4. 把「两者共存」的版本还原回工作区（别人的改动原样留着，仍属未提交）。

这样我的提交干净、R-09 不破，别人的工作也一行没丢。

**验收**：tsc 双端 0 · 新增 `sopInitialGroup.test.ts` 5 例（深优先 / 逐级上退 / 非方向指针 ⇒ 全部 /
对不上 ⇒ 全部不抛错 / 同文件夹多分组结果稳定）+ `SopManagementCenter.test.tsx` 补 2 例集成
（指针指方向 ⇒ 只列该分组的条目；指针非方向 ⇒ 两个分组都可见）。
**反向验证有效**：初始值改回 `'all'` ⇒ 集成用例失败 ✔
（⚠️ 未跑全量 `npm test`：工作区同时挂着另一条写线的改动，全量结果无法归因到本轮）

#### 线上复核（未完成，需杰哥补凭证）

```
POST https://junbo-cy.jetmobo.com/login → {"msg":"用户不存在/密码错误","code":500}
```

已试 `Nideyilian`/`nideyilian` × `nide2025.`/`nide2025`/`Nide2025.`/`Nide2025` 共 8 组全失败。
该站是 RuoYi 框架，登录走 AJAX `POST /login`（`captchaEnabled=false`），
`<form>` 无 action 提交 ⇒ **点「登录」按钮不触发登录，必须调页面上的 `login()`**。
排查手法：页面内 `fetch('/login', ...)` **一步拿到服务端原文**，比反复试界面快得多。

---

### TB-060 中控台数据表格化（类 Excel 可编辑表格 + Excel 导入导出）

- **来源**：杰哥原话「程序中所有适合以表格形式呈现的数据，统一采用类似 Excel 的表格组件显示，
  支持在界面中直接编辑，并支持通过 Excel 文件批量导入和导出。请重点覆盖中控台相关页面」（2026-09-21）
- **前提（杰哥明确，且是本条的判据）**：「所有数据都是中控台的投影，中控台拥有全部数据，你要认清中控台的重要性」
  ⇒ 中控台是**数据本体**，其余界面（生成工作区 / 素材库 / 后处理弹窗 / SOP / Agent）是它的**投影**；
  表格化不是给中控台换个列表外观，而是给数据本体建一个**统一的可编辑读写口**，
  Excel 导入导出是同一个读写口的批量形态（列定义同时驱动界面与表头映射，不存在两套字段清单）。
- **状态**：DOING · 主写线 · 方案见 `docs/control-console-excel-grid-plan.md`
- **裁决（杰哥 2026-09-21，逐条）**

  | #   | 待裁决                     | 裁决                                                                                   |
  | --- | -------------------------- | -------------------------------------------------------------------------------------- |
  | 1   | 工作区那批未提交改动谁先收 | **先本地提交**（已按主题拆 3 个提交完成）                                              |
  | 2   | 是否允许新增 xlsx 依赖     | **允许**                                                                               |
  | 3   | 范围到哪一档               | **A + B**（中控台 A 档 11 个区域 + B 档水印预设主子表 2 张）                           |
  | 4   | 导入冲突模式               | **沿用** TB-042 三模式（合并 / 覆盖 / 仅配置）+ dry-run + 回滚                         |
  | 5   | 是否补节点级可覆盖字段     | **本次不做**（`selectedMediaIds` / `distribution` 保持全局，不动 ADR-0011 的收窄结论） |

- **验收标准（可测）**
  1. 中控台 A 档 11 个区域全部以可编辑表格呈现，每张表的列定义与导出 Excel 的表头逐一对应
  2. 每个区域的行主键 = 真实业务主键（`mediaId` / `sizeId` / `collectionId` / `presetId`），
     把行顺序打乱后编辑不串行（有回归用例）
  3. 非法值不写库，且错误留在单元格内可见（不依赖 toast）
  4. 导出产出一份 xlsx 含 12 张 Sheet（Sheet 名用稳定英文 id），表头为「字段键 + 中文显示名」
  5. 导入按表独立判定（表不在包里即不动）；主键被改的行整行拒绝并报行号；未知列列出而不静默丢弃
  6. 尺寸宽高变化按「删旧 + 增新」处理，dry-run 预告影响面（`sizeId` 由 `mediaId + 宽高` 派生）
  7. 导入失败可回滚到导入前状态，并明确告知已回滚
  8. `npm run verify` 全绿

- **已完成（2026-09-21）**

  | 阶段 | 内容                                          | 证据                                                                                                                                                                                                                                                                            |
  | ---- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | P0   | 清空工作区：54 个未提交文件按主题拆 3 个提交  | 提交前 `npm run verify` = **246 文件 / 2810 用例全绿**；三个提交：中控台收口（TB-053）/ 密钥 EPERM 健壮性 / SOP 配方卡                                                                                                                                                          |
  | P1   | `DataGrid` 通用可编辑表格                     | `src/design-system/data-grid.tsx` + 15 个用例；7 种编辑器、草稿态提交、主键制、校验留行内、吸顶表头、冻结首列、>200 行虚拟滚动；`catalog.ts` 已登记                                                                                                                             |
  | P2-① | 「渠道与尺寸」分区表格化                      | `ConsoleMediaTables.tsx`（渠道表 + 尺寸表）；卡片看板的信息全部并入渠道表的列（尺寸数 / 可用尺寸 / 参与产出），**信息无损失**；旧卡片式编辑器 `MediaTableManager.tsx` 已删除                                                                                                    |
  | P2-② | 新增「方向」分区：方向结构 + 方向级参数两张表 | `ConsoleDirectionTables.tsx` + 8 个用例（含成环保护、生效值口径、留空 = 恢复继承）；`CONTROL_CONSOLE_SECTIONS` 新增 `directions` ⚠️ **已于 TB-062 第二轮撤销**（方向交给树，不再单开分区）                                                                                      |
  | P3   | Excel 导入（解析 / 计划 / 执行三层）          | `consoleImport.ts` + 18 个用例（含往返：导出的文件读回来能正确生成计划）；dry-run 用 `confirmDialog` 的 `buttons` 做三选一；导入前快照、失败整体回滚；新建方向的 id 走映射表（否则后续表整片落空）；预设与图层只导出不导入                                                      |
  | P3   | 导出 Excel 工作簿 + 修保存对话框授权缺失      | `consoleWorkbook.ts` + 13 个用例（含往返验证：写出的工作簿读回来首行仍是字段键）；11 张 Sheet；xlsx 走 SheetJS CDN 的 0.20.3（npm 上的 0.18.5 带 2 个 high 漏洞）；顺带修 `fs:select-save-path` / `fs:select-zip-save-path` 未 `addAllowedRoot` 导致的静默保存失败（R-62 同类） |
  | P2-③ | 方向 × 水印归属表                             | `ConsoleWatermarkBindings.tsx` + 4 个用例；行主键 `collectionId:presetId`，区分「移除」（空数组 = 显式不加水印）与「改为继承」（`undefined`） ⚠️ **已于 TB-062 第二轮撤销**（组件已删）                                                                                         |

- **剩余（按依赖顺序）**
  1. P2 剩余区域：全局输出位置表 + 方向 × 渠道覆盖表（与另一条写线的 `ChannelOutputDirs` 重叠，
     等它先落）、命名与署名、产出清单（只读表）、水印预设主子表（B 档）

- **不做（附理由）**
  - 分发配置（区域 ⑩）保持表单：单例配置不是数据集，做成「一行一个字段」是伪表格，
    拿不到表格的任何好处（详见方案 §10.7）；
  - 尺寸表行粒度已按反馈从「一行一个规格」改为「一行一个渠道」（另一条写线，同上）。

- **已知边界（不扩大范围）**
  - 素材（`GeneratedAsset`）与任务（`TaskRecord`）不在中控台，本轮**不纳入**（D 档）；
  - 全局水印清单在前端仍无写入点（各方向显式声明才是权威），本轮不改；
  - 水印图层位置等空间信息仍走画布编辑器，表格只做数字级批改。

### TB-061 配方卡跨批次去重静默失效（单花括号骨架）+ 单花括号保留正文

- **来源**：杰哥原话「检查提示词引擎的最远端算法是否失效了，现在出的提示词重复率有点高了」（2026-09-21 09:09）
- **状态**：✅ 已修（`campaignRecipe.ts` + 3 条回归用例），登记 R-66 / R-67
- **结论**：**最远点采样本身没坏**，坏的是喂给它的「历史签名」输入 —— 引擎质量始终在高位
  （单批 13 维 × 10 条，两两最小差异 1.000 = 每个槽都不同、重掷 1081 次）。
- **根因**：`deriveUsedSignatures` 的 `usedInBody` 写死 `body.includes('{{' + name + '}}')`（R-66）。
  真实资产骨架用单花括号（`{M}` / `{S1主体}`）⇒ 判定恒为假 ⇒ 整批历史塌缩成
  一条假签名 `*|*|…|*` ⇒ 跨批去重等于不存在。

**实测对照**（临时探针，跑完已删；13 维 × 6 候选 × 10 条，只改花括号写法）：

| 骨架写法           | 反推签名数      | 单批最小差异 | 重掷 | 批间重复           |
| ------------------ | --------------- | ------------ | ---- | ------------------ |
| `{{S1主体}}`（双） | 10              | 1.000        | 1081 | **0/10**           |
| `{S1主体}`（单）   | **1（假签名）** | 1.000        | 1081 | **10/10 一字不差** |
| 单 + 修复版反推    | 10              | —            | —    | **0/10**           |

**改法**：① 两条占位符正则提为模块常量（`RECIPE_DOUBLE_BRACE_PATTERN` /
`RECIPE_SINGLE_BRACE_PATTERN`），**渲染与反推共用**，杜绝口径再次分叉；
② 新增 `referencedDimensionNames(body)`（先双后单 + 哨兵，与 R-50 同序）；
③ 不能复用 `campaignRecipeImport.ts` 的 `extractPlaceholders` —— 依赖方向单向，反向引用成环。

- **验收证据**：`npm run verify` 全绿；新增 3 例（逐条真签名 / **同 seed** 批间零重复 / 单双混写 + 通配）。
  **反向验证**：把 `usedInBody` 改回旧写法 → **精确 3 例失败、其余 56 例全绿**；修复后 59/59。

- **⚠️ 附带纠正一条既有测试的盲区**：原「跨批次去重闭环」用例用 `first` / `second` **两个不同 seed**，
  不同 seed 本就会撒出不同组合 ⇒ **去重完全失效时它照样绿着**，这正是这个 bug 苟了两天的原因。
  凡是要验「去重是否真的生效」，必须用**同一 seed** 复跑。

---

### TB-062 中控台配置维度改由左树承载（取消独立切换器）

- **来源**：杰哥原话「中控台的配置维度应改由左侧树结构承担展示与切换，而不是单独使用一个独立页面来展示」
  （2026-09-21）
- **状态**：✅ 已完成并提交（第一版 `5f52e88`，**第二版推翻它**，见下方「第二轮修订」）
- **背景**：改版前维度与作用域分散在两处 —— 右区工具栏的「配置维度」下拉（换页式切换）
  ＋ 左树的作用域树。定一个落点要动两个控件，且**「哪些维度能按方向配」这个约束在界面上
  完全看不出来**（用户会以为「渠道与尺寸」也能按方向配，选了半天方向却发现改的是全局）。
- **改法**：左树两级 —— 一级 = 配置维度，二级 = 作用域。
  - `ControlConsoleSection` 新增 `scopeAware: boolean`（只有水印与输出位置为 `true`）；
  - `scopeAware=false` 的维度组里只有「全局一套（不按方向分）」一行，**不铺方向树** ——
    **约束由结构表达**，不再需要文案警告；
  - 点纯全局维度会把作用域一并归位到全局默认（否则标题写着某方向、内容却是全局一套 = 所见非所改）；
  - 覆盖徽章改为**按当前维度**计（输出位置维度看到 1、水印维度看到 0）；
  - `ConsoleToolbar` 移除「配置维度」下拉，props 从 `section/onSectionChange` 改为 `presetCardMode`。
- **对「现有独立页面」的处理**：**没有页面被删**。维度从来不是独立页面，而是同一工作区里的
  视图切换；这次只是把**切换器**从工具栏挪进树。五个内容组件（`MediaSection` /
  `ConsoleDirectionTables` / `OutputSection` / `DistributionSection` / `ConsolePresetGrid`）
  **零迁移**，只是触发它们的控件换了位置 —— 这是本次改动风险低的关键。
- **布局影响**：左栏 240 → 256px（多一级缩进）；右区工具栏第一行少一个控件；
  右区标题加维度名前缀（`水印 · 全局默认`）；树的可见行数变多（5 个维度组 ＋ 展开组内的作用域树），
  靠「只展开当前维度」控制长度。
- **契约不变**：状态模型仍是 `section`（应用 store，外部跳转指定落点）＋ `scope`（全局上下文指针）；
  `useJumpToControlConsole` 不用改。仅左树的 `aria-label` 由「中控台作用域树」改为「中控台配置资产库」。
- **验收证据**：`ConsoleAssetTree.test.tsx` 11 例（含「纯全局维度不铺方向树」「点纯全局维度
  归位作用域」「徽章按维度计」「维度组可折叠」）＋ `CompositeWorkspace.test.tsx` 12 例；
  `npm test` 全绿；`tsc` 双端 + eslint + prettier 全绿。

#### 第二轮修订（2026-09-21，**推翻上一版**）

- **触发**：杰哥看到界面后原话「你怎么见了这么多个重复的树？」「我只要一个树，管理全局，
  其他参数是树里面的参数，用 tab 展示」「树是全局的，管理整个框架的，右边的 tab 参数是跟随树的，
  选中哪一层级就显示对应的参数，树不止显示，还要可以增加业务线、产品、方向，增删改查等等」。
- **上一版错在哪**：把「维度」做成树的**父层级**后，每个 `scopeAware` 的维度都各自渲染了一份
  **完整的同一棵作用域树**（水印组一棵、输出位置组一棵）。默认只展开当前维度所以初看只有一棵，
  但 `expandedSections` 是 `Set`（允许同时展开），手动展开第二个组就出两棵；搜索态更糟 ——
  当时写的 `searching || expandedSections.has(...)` 会让**所有组无条件展开**，直接铺两棵。
  **根因**：维度与作用域是两个独立的控件维度，硬套成一层嵌套必然复制数据。
- **本版改法**：
  - 树回到**单棵**：项目树（业务线 → 产品 → 方向），且**增删改查都在树上做**（行内输入框，
    不弹窗）：节点行悬停有「+ 加子级 / 铅笔改名 / 垃圾桶删除」，右上角「业务线」加根级；
    回收站 tab 里可一键恢复。删除当前作用域（或其祖先）时作用域自动归位「全局默认」。
  - 「改什么」交给**右区那排 tab**（用设计系统的 `Tabs`）：水印 / 输出位置 / 渠道与尺寸 / 分发，
    内容跟着树选中哪一层走。
  - `ControlConsoleSection.scopeAware` → **`globalOnly`**（语义反过来）：`globalOnly` 的 tab
    在内容顶部加一句「全局设置，所有方向共用」，**不隐藏也不置灰** —— 藏起来会让人切来切去找不着。
  - **去掉「方向」分区**（树已经承担方向）与其全部内容：`ConsoleDirectionTables.tsx`（方向结构表 /
    方向级参数表）、`ConsoleWatermarkBindings.tsx`（水印归属表）**删除**，catalog 登记同步清掉。
    方向级参数表本就是「没有 tab 模型时的替代品」——有了「选方向 + 点 tab」，它是冗余的。
  - 删掉树上的**覆盖计数徽章**（上一版自己加的，杰哥原话「不要自己搞些莫名其妙的东西来问我」）
    与工作区标题栏的「新建方向」按钮（树上有「+」，一个动作只留一个入口）。
  - 右区标题不再带维度前缀（tab 就在标题下面，不用重复说）。
- **顺带修掉一处真实冗余**：切到回收站时，全部视图原来是 CSS `hidden`（DOM 里仍有一整棵树），
  等于同一份数据在页面里渲染两遍。改成条件渲染（展开态存在 state 里，不会丢）。
- **验收证据**：`ConsoleAssetTree.test.tsx` **14 例**，第一条就是回归断言
  「⭐ 树只有一棵：每个节点在树上只渲染一次」，另含增删改查、删除当前作用域的归位、
  删父节点时后代的归位判定；`CompositeWorkspace.test.tsx` 用 `role="tab"` 定位那排 tab；
  `src/features/composite` + `src/design-system` = 36 文件 / 516 用例全绿。

### TB-063 配方卡「相似度过高」根因修复（主控槽短路 / 幻影槽位 / 系列同 seed / 基座散列精度丢失）

- **来源**：杰哥原话「最远点采样（max-min）算法在引擎 `scripts/提示词工厂_引擎.py` 里，分三层……
  这个算法你看一下能否参考一下，当前还是存在相似度过高的情况」（2026-09-21 09:40），并附上了
  原始 Python 引擎的 L1/L2/L3 完整规格（**该文件本机不存在**，按规格文字对拍）。
- **状态**：✅ 已修（`campaignRecipe.ts` 六处 + `campaignRecipeImport.ts` 注释一处），登记 R-68 / R-69 / R-70
- **结论**：**相似度高是真的，而且不是"有点高"—— 核心约束从来就没生效过。** 根因三条，互相叠加。

| 编号 | 机制                                                                                                                                                                                                                                     | 触发条件                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| R-68 | 判据是 `domDiff < minDom \|\| hamming < minTotal` 的**或**关系，而 `domDiff` 上限 = 主控槽数；真实资产主控槽只有 1 个 ⇒ `domDiff < 2` **恒真** ⇒ `hamming` 侧被短路 ⇒ `minTotalNear/Far` 沦为死参数 ⇒ 打满预算后**放行未满足约束的候选** | 配方卡有多个非并列最高的 `weight`                    |
| R-69 | `for (let n = …)` 遮蔽 `const n = variables.length` ⇒ `Array(n)` 枚举轮次 ⇒ 幻影槽位（两数组该下标同为 `undefined` ⇒ 相等，且"重合最多"恒胜出）⇒ `% undefined` = NaN ⇒ **`selection` 被撑到 119 长、塞满 NaN**                           | 任何一次采样（默认 `maxAttempt=120` > 维度数即触发） |
| R-70 | 系列模式每组用**同一个 seed**；且签名重掷选槽 `dom[guard % len]` 的 `guard` 从 0 起、浅轮次只碰靠前的槽 ⇒ **靠后的槽（M）永远轮不到重掷**，其值完全由 `baseCandidate` 决定                                                               | 系列出图且组数 ≥ 2                                   |

**实测对照（13 维 × 6 候选，只统计真实槽；条数递增）**：

| 指标                            | 修复前                          | 修复后                                             |
| ------------------------------- | ------------------------------- | -------------------------------------------------- |
| 主控槽（`pickDominantIndices`） | `[7]`（1 个）                   | **`[0,2,3,7,12]`（5 个，= 全部带 weight 的维度）** |
| 最小差异（30 / 50 / 100 条）    | 1/13                            | **6/13**                                           |
| 差异 <6 的组合对                | 9.7% / 11.4% / **12.5%**        | **0% / 0% / 0%**                                   |
| 平均差异（100 条）              | 10.60                           | 10.86                                              |
| `selection` 形状                | 55/100 条异常、**5300 个 NaN**  | **全部长度 13、0 NaN**                             |
| 重掷次数（30 条）               | 3481                            | **131（快 27 倍）**                                |
| 官方 `computeBatchMinDistance`  | 报 1.000「完美」而真实只有 3/13 | 与真实槽口径一致                                   |
| 系列组间 M 槽                   | 三组全同（`3,2,1,0` 逐位一致）  | **`1,0,3`（互异）**                                |

- **改法（六处）**：① `pickDominantIndices` 改「全部带 `weight` 即主控」（对齐原始引擎的
  `cfg["dominant"]` 显式列表语义，不比数值大小）；② `enforce` 下限取 `min(minDom, 主控槽数)` 消除短路；
  ③ `enforce` 新增 **best-so-far 择优**（预算耗尽时返回过程中最优，不拿随机游走终点当结果）；
  ④ 槽位枚举改用 `sizes.length`；⑤ `hamming` 上界取两数组较小值；⑥ 系列模式每组 `seed` 混入 `groupIndex`。
- **验收证据**：全量测试 **251 文件 / 2887 例全绿**；新增 4 条回归用例
  （下限收敛 + 「调大 `minTotalFar` 必须真的改变输出」/ 形状无 NaN / 系列组间不雷同 / 全槽差异含 shape 断言）。
  **反向验证四组全部精确命中**：取消下限收敛 → **1** 例失败；恢复幻影槽位 → **2** 例；恢复旧主控槽口径 → **3** 例；
  恢复组间同 seed → **1** 例。
- **⚠️ 同时作废两张既有对照表**：R-45 与 `farthestPointSample` 旧 JSDoc 里「放宽下限是净亏」
  「全槽最小差异 7.00 vs 3.10」「保留 `n` 屏蔽否则 4→1」**全部由被 R-69 污染的指标量出，结论相反**，
  已改用真实槽口径重测并改写。**新纪律：验收多样性一律自己用「下标 < 维度数」的真实槽重算，
  不复用引擎的自检函数**（自检函数可能与被测对象共享同一个缺陷）。

### 补充轮（同日 10:20，用杰哥的真实产出验收）

杰哥 10:16 生成的 30 条（模板「快手短剧_信息流」）存在库里，用**只读副本**（复制 db + wal 到临时目录，
不碰原库）从 `app_data_records` 的 `sopBatchSnapshots` 捞出后逐条分析。

**第一件事：确认这批跑在哪个版本上。** 用同一 config + seed 回放对比 ——

- 逐条比对：**前 10 条完全一致**，第 11 条起分歧（窗口未满时新旧代码行为相同，窗口满了才分道扬镳）
- 库里那条最直观的证据：**第 1 条与第 11 条的前 80 字完全一样**（14 个槽只差 1 个）
- 多样性差 4.6 倍：实测「差异 <6 的组合对」36 个（8.3%），修复后只有 8 个（1.8%）

⇒ **这批是修复前生成的**，不是修复失效。

**第二件事：发现修复后仍有 1.8% 违约** → 顺藤摸到第四条、也是最根的一条：

| 指标             | 实测（修复前）              | 只修 R-68/69/70               | **再修 R-72（基座散列）**         |
| ---------------- | --------------------------- | ----------------------------- | --------------------------------- |
| 差异 <6 的组合对 | 36（8.3%）                  | 8（1.8%）                     | **0（0.0%）**                     |
| 平均相同槽       | 3.86/14                     | 2.69/14                       | **1.90/14**                       |
| 各槽唯一取值数   | 2,7,5,7,4,5,6,5,5,3,7,4,2,4 | 2,10,5,8,7,5,8,5,5,6,16,5,6,4 | **3,10,6,8,8,6,8,6,6,7,19,6,8,4** |
| 重掷次数         | —                           | 98                            | **31**                            |

**根因（R-72）**：`mix64` 用 float64 算 splitmix64 的 64 位常量，而 `0x9e3779b97f4a7c15` ≈ 1.14e19
**超出 float64 的整数精度**（该量级间隔 2048）⇒ 第一步 `(x + BIG) & 0xffffffff` 把 `x` 的贡献
**整个吞掉**（实测 `x = 0` 与 `x = 1000` 结果完全相同）⇒ 基座坍缩 ⇒ **8 个选项的槽实际只用 2 个取值**
（实测证据：`S13副标题` 是 15:15 完美对半、`M` 有 27/30 挤在前两个值上）。

**这也是「约束修好了但看起来还是像」的原因** —— 每个槽只有两个值可用时，任意两条必然大量雷同，
再强的 max-min 也变不出不存在的取值。

**修法**：改用 **BigInt 精确 64 位**（= Python 原版的任意精度整数语义）。代价可忽略
（`mix64` 只在每槽盐值与每条的 `base_cand` 处调用，重掷走 xorshift 不经过它）。
**与 R-45 不冲突**：R-45 禁的是把常量**截断成短常量**，这里是**恢复精确 64 位** ——
BigInt 版才是真正的「与原始引擎逐位一致」。

**验收**：全量测试全绿；新增回归用例「低差异基座不能退化」用 `maxAttempt: 0` **关掉重掷**直测基座分布
（重掷会从其它选项取值、把退化盖住），反向验证：改回 float64 → `expected 4 to be greater than or equal to 6` 精确 1 例失败。

⚠️ **这会改变全部采样输出**（含跨批去重与系列模式），已与 R-68/69/70 在同一轮一并验收。

- **未做（有意不扩大范围）**：R-70 的彻底对齐 —— 原始引擎签名重掷用 `rng.choice(dominant)`（真随机），
  移植版是确定性轮转；换 seed 已消除可观测症状，改 rng 会再动一次采样输出，留待需要时单独评估。

---

### TB-064 中控台水印分区收敛为单一编辑器（去归属侧栏 / 去卡片中转 / 高度自适应）

- **来源**：杰哥原话「水印不应归属到侧栏，因为它当前已经跟随树结构走了，请移除水印归属侧栏；
  不需要再通过卡片跳转到编辑窗口，水印 tab 本身就直接作为编辑窗口，直接去除卡片这一层界面；
  水印窗口下方不要留空白，需实现高度自适应填充」（2026-09-21）
- **状态**：DONE · 写线：主写线
- **背景**：这三处是 TB-062 那轮收口时留下的形态债 ——
  ① 编辑器左栏**又**放了一棵「水印归属」树，而中控台左边已经是同一棵树、同一个选中
  （TB-062 刚把「只留一棵树」定成铁律，这里等于自己破了）；
  ② 水印是「卡片网格 → 点编辑 → 编辑器」两级，中间那层只起跳转作用；
  ③ 编辑器被 `overflow-y-auto` + `min-h-[32rem]` 包着，高度由内容顶出来，窗口高了下面留一片空白。
- **验收标准**（可测）
  1. 编辑器内不存在任何项目树（`data-layout="preset-project-tree"` 计数 = 0）
  2. 水印分区渲染即编辑器：无卡片网格、无「返回卡片」按钮、无卡片工具栏
  3. 水印分区的内容槽不带 `overflow-y-auto`；表格型分区（渠道与尺寸等）的槽仍带
  4. 「某个方向用哪几套水印」仍可编辑：水印库行勾选框 → 写该方向 `watermarkPresetIds`
  5. 全局默认下勾选框禁用（全局基线在前端没有写入点）
- **⚠️ 需求真空（动手前已与杰哥对齐）**：删掉归属树 + 卡片层之后，
  「这个方向用哪几套水印」的**两个原有入口同时消失**，不补就等于水印直接配不了 ——
  这是本次唯一动到能力面的地方。补法：**库行勾选框的语义从「选几个准备拖到树上」
  改为「当前范围是否启用这套水印」**，作用域读全局上下文指针 `useAssetLibraryStore.scope`
  （与左树、右区标题是同一个值，所以不会出现「库里勾的方向和树上选的不一致」）。
- **知情取舍**（杰哥确认接受）
  - 归属树上「按渠道单独设水印」（`byMedia`）的**编辑入口消失**：解析与落盘不受影响，
    已有数据照旧生效，只是不再能在界面上改。要恢复得先定新入口。
  - 「勾选几个水印批量导出」消失，导出改为一次导全部。
  - 卡片上的画布缩略图预览消失（水印库行只列名称 / 层数 / 画布尺寸）。
- **改动面**
  - 删：`ConsolePresetGrid` / `ConsolePresetCard` / `ConsoleToolbar` / `PresetProjectTree`（含 2 个测试文件）
  - 改：`CompositeWorkspace.tsx`（去卡片分支与工具栏；高度按分区给 —— 编辑器撑满、表格走滚动）、
    `PresetManagementTab.tsx`（去归属栏；三栏 → 两栏；行勾选 = 归属开关）
  - 登记：`catalog.ts` 四条退役 + 两条描述更新；`compliance.test.ts` 白名单去掉 `PresetProjectTree`
  - **特意保留**：`compositePresetLibrary.ts` 的拖拽载荷编解码、`presetBinding.ts` 的三个纯函数
    （已无生产使用者，但恢复「拖到树上绑定」时可直接用；文件头已注明现状与共用字面量的要求）
- **验收证据**：`PresetManagementTab.test.tsx` 12 例（含「库行勾选写的是该方向的
  `watermarkPresetIds`」「全局默认下禁用」「两栏并列 + 不再有归属树」）＋
  `CompositeWorkspace.test.tsx` 14 例（含「水印分区打开即编辑器」「水印槽不吃滚动容器，
  表格槽仍可滚」）；`npm test` **248 文件 / 2852 例全绿**；`tsc` 双端 + eslint + prettier 全绿。
- **⚠️ 未经渲染自证**：本机做不了网页渲染验证（Electron 离屏加载一律失败），
  高度自适应只有 Tailwind flex 链路推导 + 单测断言，**实际观感需在运行中的应用里过目**。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）

#### 第二轮（2026-09-21 下午）：把「按渠道单独设水印」接回来

- **触发**：杰哥看到界面后原话「水印框侧栏显示的水印默认按照树的产品维度来，即该产品下的所有方向
  都显示同一个产品水印；但现实中部分方向的不同渠道需要使用不同的水印，当前实现方式似乎无法支持
  这种按方向+渠道区分水印的配置」（2026-09-21）
- **⭐ 诊断结论：不是「不支持」，是入口被第一轮一起删掉了**。逐层查证：
  - 数据层：`PostprocessNodeOverride` 本来就是「本级通用值 + `byMedia[渠道]`」两格；
  - 继承层：产品线 → 产品 → 方向逐级继承，所以「产品配一套、下面所有方向跟着」**一直能跑**；
  - 产出层：`taskPostprocess.ts:219` 按渠道分 bucket，每个 bucket 用
    `applyPostprocessOverride(..., mediaId)` 解析出的 `watermarkPresetIds` —— 生成图**真按渠道取**；
  - 通道层：`normalizeByMediaOverride` / `mergeByMediaOverride` / 预设传输 / 归一化全都带 `byMedia`；
  - 测试层：`params.test.ts` 里早就有「按渠道解析水印」与「只回传与通用值不同的渠道」两组用例。
    缺的只有 UI —— 第一轮删掉的「水印归属树」正是唯一能改 `byMedia[渠道].watermarkPresetIds` 的地方
    （藏在节点行右侧一个小图标里），当时没有把它搬到新界面上。**这是第一轮的漏项，不是模型缺陷。**
- **改法**：水印库栏加一排「**生效范围**」：`通用 | 头条 | 百度 | …`
  - 选「通用」= 写 `watermarkPresetIds`（与第一轮行为一致，不变）；
  - 选某渠道 = 写 `byMedia[该渠道].watermarkPresetIds`，**首次改动即物化**（继承态下先把该渠道
    当前生效值复制成显式数组再改，否则「加一个」会被写成「只留这一个」）；
  - 被本级单独设过的渠道 pill 上打一个点，口径同 `resolveNodeWatermarkBindingsByMedia`
    的「只回传与通用值不同的渠道」；
  - **撤掉覆盖的出口补回来了**：渠道视图给「跟随通用」、通用视图给「跟随上级」，两者都是
    **写 `undefined` 删掉那一格**，不是写回当前值（写值会把继承来的那份固化在本级，
    以后改上层就再也影响不到它 —— 与「输出位置」分区的「恢复继承」同一个口径）。
  - **渠道不进左树**：它是「作用域（左树给）」与「水印（库给）」之外的**第三个维度**，
    维度与作用域套成嵌套必然复制数据 —— TB-062 已经为此付过一次代价。
  - 全局默认下整排不渲染：全局基线在数据层就没有 `byMedia` 这一层，
    摆一排点不动的渠道只会让人以为「全局也能按渠道配，只是现在锁着」。
- **三种用法**（正好覆盖杰哥的两条需求）
  1. 产品统一：左树点**产品** → 生效范围「通用」→ 勾几套 → 该产品下所有方向都跟；
  2. 某个方向整体换：左树点**方向** → 「通用」→ 勾；
  3. 只改某方向的某渠道：左树点**方向** → 生效范围切到「头条」→ 勾。
- **界面一致性**：与隔壁「输出位置」分区的模型对齐（那里已是「按渠道分别配 + 留空 = 继承 +
  一键恢复继承」），不新造一套交互。
- **验收证据**：`PresetManagementTab.test.tsx` 16 例（新增 4 例：继承来源文案 / 切渠道写 `byMedia`
  且物化继承值 /「跟随通用」是删格不是写值 /「跟随上级」撤回继承）；
  `npm test` **248 文件 / 2856 例全绿**；`tsc` 双端 + eslint + prettier 全绿。
- **顺带发现（存量缺陷，未动手修）**：`text-ds-accent` **是无效类** —— `tailwind.config.js`
  的 `theme.extend.colors.ds` 里没有 `accent`，所以 `ChannelOutputDirs.tsx:214` 与
  `ConsoleMediaTables.tsx:284` 那两处「已单独设置」的强调色实际不生效（静默回落成继承色）。
  本轮刻意不引入这个类（渠道打点用 `bg-ds-warning`）。要修得先定：补 token 还是换现有语义色。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）

---

### TB-065 命名模板中文显示 + 文件名预览 + 导出文件夹改名

- **来源**：杰哥原话「命名模板输入框中的变量应以中文显示，但底层变量标识保持不变。新增一个最终输出
  文件命名的预览区域，实时展示按当前模板生成的文件名。同时修改导出时文件夹的命名规则：文件夹名按照
  最终文件命名来生成，但需去掉末尾的"-序号"部分」（2026-09-21）
- **状态**：DONE · 写线：主写线
- **① 中文显示 —— 只改显示层**
  - 框里 `{日期}-{产品}-{方向}-{媒体}-{尺寸}-{序号}`，存进 store / 落盘 / 导出给别人的配置里仍是
    `{date}-{product}-…`。模板是**落盘格式**（写进产出文件名、被导出导入的配置引用），换成中文会让
    所有已配好的模板一起失效，所以中文只是显示层（`to/fromDisplayNamePattern`）。
  - 手打的英文占位符会被显示层统一成中文；认不出的 `{写错了}` 原样保留 —— 与渲染器
    「未知 token 原样保留」同口径（用户得能在框里看见自己写错了）。
  - ⭐ **两套光标坐标系**（本节最易踩的坑）：`caretRef` 存的是**底层模板**坐标（插入函数操作的
    就是底层串），DOM 里的是显示串坐标。`{日期}` 4 字符 vs `{date}` 6 字符，拿 DOM 坐标直接插会错位。
    处理：显示串被规范化（手打英文/中文占位符）时按「光标前那段的转换结果」重定位；中文输入法
    组合期间不碰光标（否则打断打字）；rAF 里调 `focus`/`setSelectionRange` 前判存在
    （react-test-renderer 的替身没有这两个方法，不判会在下一帧抛一个与本次编辑无关的错）。
- **② 文件名预览**：命名模板输入框正下方一行，用**当前作用域**（中控台左树选中）的真实产品 / 方向名
  - 该作用域第一个渠道与尺寸 + 序号 1 实时拼出，改一个字符立刻变。左树选「全局默认」时明说
    「未选方向，产品 / 方向两段为空」，**不编造示例值** —— 编了用户会以为产出真带那个名字。
- **③ 导出文件夹改名**：`resolvePostprocessSubFolders`（原 `产品线/产品/方向[/预设名]` 逐级建目录）
  退役，换成 `buildPostprocessFolderName` = **同一套上下文渲染「模板去掉 `{seq}`」**，只写**一层**目录。
  - 例：文件名 `20260921-百万医疗险-月亮-头条-1280x720-1.jpg`
    → 文件夹 `20260921-百万医疗险-月亮-头条-1280x720/`
  - 理由（杰哥原话）：文件夹要能**自己说清**「这是哪个方向、哪个渠道、哪个尺寸的一批」——
    原先靠外层三级目录继承这些信息，把文件夹单独发给别人就丢了。
  - 文件名的上下文与文件夹名**共用一处** `resolveNameContext`：两处各写一遍的话，
    将来加 token 漏改一处就会出现「文件名里有、文件夹名里没有」这种几乎看不出来的不一致。
  - 副作用（知情）：原先「同一批多套水印自动追加一层预设名子目录」的行为**取消** ——
    要按水印分开，把 `{preset}` 写进模板即可（文件名与文件夹名会同时带上预设名）。公式单一、可预测。
  - **老的产出目录不会跟着变**，新旧结构会在导出位置里并存（不做批量搬迁）。
  - **按天分发不受影响**：它按「相对输出根的路径」整体搬迁，不依赖目录层级（已读
    `runPostprocessDistribution` / `resolveBaseTargetDir` 确认）。
- **④ 「产出预览」的作用（问答，未改代码）**：它回答的是「**这一批跑下去会出多少个文件、分别叫
  什么、落在哪**」，由 `方向 × 渠道 × 该渠道尺寸 × 水印预设` 乘出来的清单，用一个示例源图
  1280×720 估算、只列前 6 条。与本次新加的命名预览分工是：
  **命名预览管「一个名字长得对不对」（改模板即时反馈，不依赖渠道勾选）；产出预览管「这批算出来
  多少个」（要把渠道 / 尺寸 / 水印都勾对才有意义）。**
- **改动面**
  - `lib/postprocessNaming.ts`：+4 导出（`to/fromDisplayNamePattern`、`stripPostprocessNameSequence`、
    `buildPostprocessFolderName`）+ 私有 `resolveNameContext`
  - `lib/postprocessRunner.ts`：`subFolders` 换源；删 `resolvePostprocessSubFolders`
  - `NamePatternField.tsx`：显示层 + 光标双坐标系
  - `PostprocessNamingFields.tsx`：+文件名预览
- **验收证据**：`postprocessNaming.test.ts` **40 例**（新增 11：双向转换 / 往返无损 / `{产品线}`
  与 `{产品}` 不互相吃掉 / stripSeq 空模板兜底 / 文件夹名与文件名同源）；
  `postprocessRunner.test.ts` **16 例**（文件夹名 = 文件名去序号、模板没写 `{preset}` 就不分层）；
  新建 `NamePatternField.test.tsx` **5 例**（框里中文、交出去英文、按钮插底层占位符）；
  新建 `PostprocessNamingFields.test.tsx` **4 例**（预览用真实作用域、未选方向明说、改模板即时反映）；
  `npm test` 全绿；`tsc` 双端 + eslint + prettier 全绿。
- **⚠️ 提交边界（本轮的一个现场情况）**：`ConsolePostprocessSections.test.tsx` 里混着另一条写线
  （TB-060 表格化）的未提交改动，而其中一条断言写死了「输入框显示 `{seq}`」，会被本次改动打破。
  处理：**只把那一行断言（`{seq}` → `{序号}`）并入本次提交**（先 `git show HEAD:<path>` 回基线、
  改这一行、再恢复对方的 WIP），没有把对方的 WIP 卷进来。对方那条线的改动仍未提交、仍在工作区。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）

---

### TB-066 渠道导出位置改成「一行一个位置 + 逐行删除」（TB-060 的子项）

- **来源**：杰哥原话「导出位置改为在该渠道原本表格行的下方新增一行来添加多一个导出位置，而不是在
  右侧新增列；添加之后，左侧的渠道格子应该对于多行导出位置，参考 Excel 表格。每个导出位置需配对应
  的删除按钮，可单独删除；移除当前的清空按钮，避免误删已填写的资料」（2026-09-21，附报障截图）
- **状态**：DONE · 写线：主写线（挂在 TB-060「中控台数据表格化」下）
- **改了什么**
  1. **位置加在下一行**：表格回到「渠道 / 导出位置 / 操作」三列，一个渠道有几个位置就占几行。
     第二个位置不再占一整列（旧表头「双写位置」）—— 列数不随位置数增长，路径列拿满剩余宽度。
  2. **渠道格跨行合并**（Excel 合并单元格）：渠道名只在该组第一行出现、垂直居中。
     新增 `DataGridColumn.spanRows`（`1` 不合并 / `n>1` 跨 n 行 / `0` 本行不出这一格，**默认关**）。
  3. **逐行删**：每行 `✕` 删掉这一个位置，其余位置上移；删到一个不剩 = 该渠道回到「留空」
     （全局层落到默认输出位置、节点层继续向上继承）。`+` 只出现在该组最后一行，到上限（2）即收。
  4. **「清空」按钮移除**（`onClearDirs` / `clearLabel` 两个 prop 一起删，调用方 `OutputSection` /
     `PostprocessParamPanel` 的对应函数换成 `onRemoveDir`）。
- **验收标准**（可测）
  1. 表头恒为 `['渠道','导出位置','操作']`，配 2 个位置时**列数不变**、总行数 +1；
  2. 配 2 个位置的那一组，渠道名只出现一次且带 `rowspan="2"`；
  3. 删第 2 个位置后第 1 个位置**原样保留**；再删第 1 个 = 该渠道整条退回留空（全局层
     `mediaOutputDirs[mediaId]` 变 `undefined`）；
  4. 不存在「一键清空整个渠道」的按钮（`aria-label` 里没有 `用默认` / `恢复继承`）。
- **改动面**：`design-system/data-grid.tsx`（+`spanRows`）、`features/postprocess/ChannelOutputDirs.tsx`
  （行模型 + 合并 + 逐行删）、`features/composite/components/OutputSection.tsx`、
  `features/postprocess/PostprocessParamPanel.tsx`（`handleRemoveDir` / `removeDirs` 整份重写）、
  `design-system/catalog.ts`（登记 targets）、`design-system/styles.css`（弹窗宽度依据的注释）、
  `docs/architecture-constraints.md` 七章。
- **验收证据**：提交 **`54e98a9`**（未推送）；提交前 `npm run verify` 全绿
  （**254 文件 / 2935 例**，比本条目登记时多了同一批 WIP 里另外两条线的用例）；
  相关 3 个文件 **73 例**（`data-grid.test.tsx` · `PostprocessSettingsModal.test.tsx` ·
  `ConsolePostprocessSections.test.tsx`），新增 4 例（跨行格行为 / 多一行且列数不变 /
  逐行删留存另一格 + 节点层删干净写 `undefined` / 清空按钮不存在）、改写 2 例（标签与断言口径）。
  ⚠️ 本条目的改动与「尺寸表改一行一个渠道（TB-060）」「后处理面板字段行三形态」落在同一个提交里
  —— `PostprocessParamPanel.tsx` 同时含三者改动（`onRemoveDir` + `layout` + 预览换渲染器），
  按文件切不干净，详见该提交的正文。
- **反向验证**（3 个变异，全部精确命中，其余用例照过）
  | 变异                               | 结果                                                                                   |
  | ---------------------------------- | -------------------------------------------------------------------------------------- |
  | 关掉 `DataGrid.rowSpanAt` 的行合并 | `data-grid.test.tsx` **1 failed / 15 passed**（AssertionError）；Modal 那条恰好 1 例红 |
  | `removeRow` 不调 `onRemoveDir`     | `ConsolePostprocessSections.test.tsx` **1 failed / 20 passed**                         |
  | 把「清空」按钮放回去               | 「没有一键清空」守卫用例 **1 failed**                                                  |
- **未做**：本机无法做界面渲染验证（环境级限制，见 `~/.workbuddy/MEMORY.md`），
  布局与合并单元格效果**未经真机过目**，请在中控台「输出位置」分区 / 后处理弹窗里核对。
- **刻意保留的边界**：上限仍是 **2 个**（杰哥拍板）。放开要先改 Excel 导入导出的
  `outputDir1` / `outputDir2` 表头与校验（`consoleWorkbook` / `consoleImport`），不在本轮范围。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）；
  `spanRows` 与虚拟滚动互斥（见 `docs/architecture-constraints.md` 七章）。

---

### TB-067 水印库改为按产品隔离（每个产品一个独立水印库）

- **来源**：杰哥原话「水印库应改为按产品隔离，即每个产品各自维护独立的水印库，而不再使用全局通用的
  一批水印预设；请调整水印库的组织与归属逻辑，使每个产品下的水印库相互独立，便于分别管理、按产品选择
  和区分，避免混淆，并确保产品之间不共用同一套水印预设」（2026-09-21）
- **状态**：DONE · 写线：主写线（承接 TB-064；与另一条线 TB-066 **无文件重叠**）
- **背景（诊断）**：水印库原本是**一个全局数组**，与左树选中谁无关 ——
  `CompositeV2Preset` 上没有「属于哪个产品」这个字段（`compositeV2Types.ts`），
  库列表直接渲染全量 `store.presets`（`PresetManagementTab.tsx` 的 `visiblePresets`），
  新建也只是往这个数组末尾追加（`storeV2.ts` 的 `createPreset`）。
  于是左边点 A 产品、点 B 产品，看到的库**一模一样**，任何一套水印都能被任意产品的方向勾上。
- **改了什么**
  1. **预设加归属字段** `CompositeV2Preset.productId`（可选；缺省或空串 = 未分配）。
     库仍是**一个扁平数组 + 每条一个产品标签**，不是 `Record<productId, presets[]>` —— 理由写在
     `storeV2.ts` 头注：归属引用（`watermarkPresetIds`）存的是 preset id、撤销快照 / 导入导出 /
     资产引用扫描都在遍历这一份数组；隔离要解决的是「看与选」，不是 id 冲突。
  2. **库按产品过滤**：中控台左栏只列「当前作用域所属产品」的预设（`filterPresetsByProduct`），
     标题带产品名（「水印库 · 百万医疗险」）。「作用域 → 产品」的解析收敛成一个函数
     `resolveOwningProductId`（产品节点 = 它自己；方向 = 往上一级；产品线 / 全局 = 无）。
  3. **产品线 / 全局默认两层不再有库**：只给一句「水印属于产品 —— 先在左侧选一个产品」，
     新建 / 导入 / 导出三个入口同时禁用（点不动的控件比不给更糟）。
  4. **新建 / 导入落当前产品**：`createPreset(name, productId)`；导入文件里的 `productId` 是
     **导出方机器上的 id**，本机不存在，落库前必须改写成本机的当前产品（否则导入完就「消失了」）。
  5. **导出只导当前产品**（归属也只带这个产品下的节点）。
  6. **「未分配」区**：升级后没有任何产品的节点勾过的水印单独成区，可单个或一键归到当前产品。
  7. **一次性迁移**（`lib/compositePresetProductMigration.ts` 纯函数计划 +
     `presetProductMigrationRunner.ts` 跨 store 写入，挂在 `PresetManagementTab` 挂载时跑，幂等）：
     - 先**摊旧清单**：v6 的全局基线 / 产品线级 `watermarkPresetIds` 摊到每个产品（产品自己写过的
       不动），摊完清掉产品线那一格与全局基线 —— 不摊就等于直接抹掉用户已配的水印（R-63）；
     - 再**推断归属**：按「哪个产品的节点显式勾过它」归位；**跨产品共用的各复制一份**并把引用改指到
       各自的副本（隔离的语义就是互不共用）；没人勾过的保持未分配；
     - **两步顺序不能反**（先摊后猜）：否则那些「只在全局清单里出现过」的水印会保持未分配，
       而产出链路按 id 照样找得到它 —— 变成「生成图带了这套水印，界面上哪儿都没有」；
     - 跑过的标记 `presetProductMigrationVersion` 落盘。**没有标记**的话，用户主动摘出来的水印会在
       下次启动被自动收回 —— 最难查的那类「我明明删了，它自己又回来了」。
- **验收标准**（可测）
  1. 选中产品 A 时库里只有 A 的预设；产品 B 的水印**不出现在界面文本里**、也没有可勾的框；
  2. 标题形如「水印库 · 〈产品名〉」；选中产品线 / 全局默认时列表为空且提示「水印属于产品」，
     新建 / 导入 / 导出三个按钮 `disabled`，且不存在「生效范围」那一排；
  3. 新建的水印 `productId` = 当前作用域所属产品；
  4. 未分配的预设不进任何产品的库，但出现在「未分配（N）」区；点「归到〈产品〉」后归属立即变更；
  5. 迁移后：单一产品勾过 → 归它且参数不动；两个产品共用 → 新增一份副本 + 后一个产品的引用改指副本；
     没人勾过 → 保持未分配；同一份数据跑两次副本 id 相同（确定性）；
  6. 标记已置位时再打开水印库，**不会**把用户摘出来的水印自动收回。
- **改动面**
  - 新增：`features/composite/lib/compositePresetProductMigration.ts`（计划 + 推断）、
    `features/composite/presetProductMigrationRunner.ts`（读三个 store 并写回）
  - 修改：`lib/compositeV2Types.ts`（+`productId`）、`lib/compositeV2Defaults.ts`、
    `lib/compositePresetLibrary.ts`（+3 个过滤 / 归一化函数）、`storeV2.ts`（v6→v7、
    `createPreset` 带产品、`assignPresetProduct` / `assignPresetsToProduct`、
    `presetProductMigrationVersion`）、`components/PresetManagementTab.tsx`（库过滤 + 未分配区 + 迁移调用）、
    `projectTree/params.ts`（+`resolveOwningProductId`）、`lib/compositePresetTransfer.ts`（读归属）、
    `features/postprocess/taskPostprocess.ts`（工具预设补空归属）
- **验收证据**：`npm run verify` 全绿；新增 `compositePresetProductMigration.test.ts` **13 例**；
  `PresetManagementTab.test.tsx` 新增 6 例（只列本产品 / 未分配区与一键指派 / 新建落产品 /
  存量按归属归位 / 迁移只跑一次 / 无产品层不给库）；`storeV2.test.ts` 新增 1 例（改归属不动内容）。
- **知情取舍**（口径已与杰哥确认）
  - **产品线级的「配一次、全线继承」退役**：隔离后水印是产品的资产，产品线层没有可勾的清单。
    迁移会把旧值摊到每个产品，之后要改得逐产品改。
  - **产出链路不校验产品归属**：`taskPostprocess.ts` 仍按 preset id 全局找预设，所以一旦归属数据是
    「跨产品」的（例如 Excel 导入把 A 产品的方向绑上 B 产品的预设），产出照样会叠上去 ——
    界面层已经选不到，但**数据层不拦**。要彻底拦需要在产出前加一道「预设属于该节点所属产品」的校验，
    那会让现有跨产品绑定突然不出图，留待单独评估。
- **⚠️ 未经渲染自证**：本机做不了网页渲染验证（环境级限制，见 `~/.workbuddy/MEMORY.md`），
  按产品过滤后的列表、「未分配」区与标题形态**未经真机过目**，请在中控台「水印」分区里核对。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）

---

### TB-068 「分发」并入「输出位置」分区（取消独立入口）

- **来源**：杰哥原话「将『分发』Tab 合并到『输出位置』Tab 中，移除独立的分发入口，并相应调整合并后
  Tab 内的布局，确保原有分发相关功能与选项不丢失，整体界面排列合理、层级清晰、不影响其他 Tab 的
  正常使用」（2026-09-21）
- **状态**：DONE · 写线：主写线
- **为什么合**：「分发」只有两块内容（纯净版自动伴随 + 按天分发配置），与「输出位置」是同一件事的
  两半 —— 一个管「目录 + 文件名」，一个管「按天怎么分」。各占一个 tab 只会让「产出放哪」这件事
  要看两个地方。
- **改了什么**
  1. 分区表从 4 项变 3 项：水印 / 输出位置 / 渠道与尺寸（`controlConsoleSections.ts`）；
  2. **退役值收敛**：`normalizeControlConsoleSection('distribution') → 'output'`。分区 id 是**持久化**的，
     老用户机器上就存着它 —— 掉进「认不出」分支会把人弹回水印，等于把「我上次停在哪」默默抹掉；
  3. 「分发」内容搬进 `OutputSection` 的滚动区，插在「文件命名」之后、「产出预览」之前，
     与同级小节一样的 `SectionHeader` + 内容形态；
  4. `DistributionSection` **保留**为纯内容组件（去掉外层 `flex` / 滚动壳与自带标题）：嵌在别人的
     滚动区里再自带一个会出现两层滚动条与高度塌陷；宽度也不自带上限（原 `max-w-2xl`），交给容器
     统一 —— 否则它会比同级的渠道表窄一截；
  5. 「全局设置，所有方向共用」提示条**不再挂在「输出位置」上**：这一区是混合的（渠道导出目录按
     作用域走，命名 / 分发 / 预览是全局一套），顶上挂一句会连前半段一起说错 —— 改由三个小节各自
     在标题里说清。
- **验收标准**（可测）
  1. `CONTROL_CONSOLE_SECTIONS` 的 id 序列 = `['watermark','output','media']`，tab 上不存在「分发」；
  2. `normalizeControlConsoleSection('distribution')` = `'output'`；`'directions'`（更早的退役值，
     没有新家）仍退回默认分区；
  3. `OutputSection` 渲染出的内容里含「纯净版自动伴随」与「启用分发」—— 分发功能一件没丢；
  4. 切到「输出位置」时**没有**那句「全局设置，所有方向共用」；切到「渠道与尺寸」时仍有；
  5. 其余分区（水印 / 渠道与尺寸）行为不变。
- **改动面**：`lib/controlConsoleSections.ts`（+退役别名表）、`CompositeWorkspace.tsx`（删渲染分支与
  import、改 `globalOnly` 处注释）、`components/DistributionSection.tsx`（纯内容化）、
  `components/OutputSection.tsx`（+分发小节）、`design-system/catalog.ts`（两条登记更新）
- **验收证据**：`npm run verify` 全绿；新增 `OutputSection.test.tsx` **2 例**、
  `controlConsoleSections.test.ts` **+2 例**（分区序列 / 退役值收敛）、
  `CompositeWorkspace.test.tsx` 改写 1 例（提示条只挂整块全局的分区）。
  **反向验证**：临时摘掉 `<DistributionSection />` → `OutputSection.test.tsx` 精确 1 例失败
  （`expected ... to contain '纯净版自动伴随'`）。
  **干净树验证**：本轮有两个文件（`OutputSection.tsx` / `PostprocessSettingsModal.test.tsx`）与另一条
  写线的未提交 WIP 重叠，于是用 `git worktree add --detach` + junction `node_modules` 建了一棵
  **只含已提交代码**的树，把本轮 9 个文件覆盖进去跑 `tsc -b` 与 4 个测试文件 **37 例** ——
  我这部分零类型错误、全绿；树上**唯一**的错仍是 R-74 那条既有问题
  （`PostprocessParamPanel.tsx:56` 引用已删组件）。
- **⚠️ 未经渲染自证**：本机做不了网页渲染验证，合并后的三段排列与「输出位置」的高度表现
  **未经真机过目**，请在中控台「输出位置」分区里核对。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）

---

### TB-069 后处理：进度查询 + 状态通知 + 带错误码的失败原因

- **来源**：杰哥原话（2026-09-21）「当前后处理流程缺少任务进度查询与状态通知能力，用户无法判断任务
  是否正在执行、是否已成功完成或已失败」，要求补：① 实时进度查询（百分比 / 阶段 / 已处理数量）；
  ② 覆盖进行中 / 成功 / 失败的状态通知机制；③ 失败时给出错误码 + 描述 + 定位线索。
- **状态**：DONE · 写线：主写线（与另一条线 TB-060 的 WIP 无文件重叠）
- **背景（诊断）**
  1. 执行体（`taskPostprocess.ts`）一次调用到底，**中途不上报任何东西** —— 不是「没显示」，
     是根本没有进度数据源；
  2. 界面反馈只有三样：按钮转圈（`runtimeStore.postprocessRunning` 计数）、开跑一条 toast、
     结束一条 toast（`store.ts` 的 `reportPostprocessResult`）；
  3. 失败原因只剩**第一条**（`warnings[0]`），且是自由文本：没有码、没有文件名 / 渠道 / 目录，
     文案还与真因不对齐 —— 典型是 `outputRoots.ts` 那句「导出位置不可用（请检查路径是否可达）」，
     而真因九成是**目录不在主进程允许的位置内**（R-62），照那句话查永远查不到。
- **改了什么**
  1. **错误码表 + 问题项**（新 `postprocessIssue.ts`）：19 个码（`PP-SRC/ENV/SCOPE/TARGET/MEDIA/PRESET/DIR/
NAME/WRITE/RENDER/DIST/EMPTY/CRASH-*`），每条固定「描述 + 可照做的线索 + 严重度（skipped / error）」；
     上下文（文件 / 源图 / 渠道 / 目录 / 预设 / 原始异常）由调用点填。
     `TaskPostprocessResult` 新增 `issues`，**`warnings` 改为由 `issues` 派生**（`issuesToWarnings`），
     老调用方与测试不受影响，也不会再出现两处文案分叉。
  2. **运行记录 + 进度查询**（新 `postprocessRun.ts` + `runtimeStore.postprocessRuns` 切片，内存态不落盘）：
     一次运行可查 `状态 / 阶段 / 已完成张数 / 总张数 / 百分比 / 当前产出 / 产出文件数 / 问题清单 /
起止时间`；查询走导出函数 `getPostprocessRun(id)`、`listPostprocessRuns()`、
     `getActivePostprocessRuns()`、`getLatestPostprocessRun()`、`getLatestPostprocessRunForTask(taskId)`。
     **百分比按源图张数算**（分母事前可知），当前这张图按已完成的产出单元折算小数部分 —— 单元总数要
     逐图展开才知道，拿它当分母会让数字中途回退。
  3. **状态通知**：状态机 `running → succeeded | partial | failed`（有产出 + 有真错 = partial；
     `issues` 里区分 skipped / error，配置使然的跳过不算失败）。通知分两层：① 运行记录可订阅
     （不新造事件总线，沿用项目里订阅 zustand 的写法）；② 状态切换各发一条 toast。
     **中途进度不弹 toast**（`showToast` 是单槽，连发会互相顶掉）。
  4. **通知的落点**：素材库工具栏新增常驻「后处理状态」入口（进行中显示 `3/12 45%`，
     有问题显示「后处理问题 (N)」并打开完整清单）；失败 toast 带错误码并挂「查看问题」动作；
     任务卡在「后处理进行中 / 有问题」时补徽章 —— 自动触发那条路径原本要等产出落库才在卡片上有反应。
  5. **修掉误导文案**：`outputRoots.ts` 的 `warnOnce(string)` 改为结构化 issue 回调，
     `PP-DIR-001` 的线索直指真因（允许的位置 / 用「选择目录」选过 / 手输其它盘符会被拒）。
- **验收标准**（可测）
  1. 跑一次后处理，**开跑瞬间**就能查到运行记录（`status: 'running'`、`totalImages` 正确）；
  2. 结束后同一条记录落定：`completedImages` 补满、进度 100%、`status` 与 `issues` 可查；
  3. 零产出时 `issues[0].code === 'PP-EMPTY-001'`（不再是「三项皆空、界面毫无反应」）；
  4. 执行体整体抛异常时 `issues[0]` = `PP-CRASH-001` 且 `cause` 是原始错误消息；
  5. 界面：进行中能看到「N/M 百分比」，失败 toast 带 `[PP-xxx-000]`，并可展开完整清单；
  6. `npm run verify` 全绿。
- **改动面**
  - 新增：`features/postprocess/postprocessIssue.ts`、`features/postprocess/postprocessRun.ts`
  - 修改：`features/postprocess/taskPostprocess.ts`（issues 收集 + `onProgress` + 零产出兜底）、
    `features/postprocess/outputRoots.ts`、`stores/runtimeStore.ts`、`store.ts`、
    `features/assetLibrary/AssetLibraryToolbar.tsx`、`components/TaskCard.tsx`
- **验收证据**：`npm run verify` 全绿（254 文件 / **2935 例**）；提交 **`cc228f0`**（已推送）。
  ⚠️ 该次 CI 在 `Typecheck renderer` 步骤失败，真因是 **R-74**（提交态里
  `src/features/postprocess/PostprocessParamPanel.tsx:56` 仍 import 已被 TB-064 删掉的
  `ConsolePresetCard`，且第 463 行还在用 `PresetCover`）—— 属另一条写线的在途改动，
  其工作区 WIP 已重写该文件，**与本轮改动无关**（本地 `tsc -b` 干净是因为编译的是「HEAD + 它的 WIP」）。
  新增 `postprocessIssue.test.ts` **8 例**、`postprocessRun.test.ts` **10 例**、
  `store.test.ts` 新增 **3 例**（开跑可查 + 崩溃落码 + 问题清单弹窗逐条给码与线索）、
  `TaskCard.test.tsx` 新增 **3 例**（进行中徽章带真实进度 / 问题徽章把问题交给弹窗 / 无记录不渲染）、
  `outputRoots.test.ts` 改写 **2 例**（改断言错误码，顺带反向验证「文案不再写『请检查路径是否可达』」）。
- **知情取舍**
  - **运行记录只有最近 20 条且不落盘**：进度是会话内信息，重启后没有意义；要长期留痕得另做产出日志，
    不在本轮范围。
  - **`issues` 不写进任务记录**：任务记录是持久化的，塞会话级问题会让「重开应用还挂着上一条失败原因」。
    自动触发的失败因此只在**当前会话**可查（toast + 工具栏入口）。
  - **快照式进度（每张图 / 每个单元一次）不是流式**：足够回答「在跑吗、跑到哪、成了没」，
    也不至于让 React 每帧重渲染。
- **⚠️ 未经渲染自证**：本机做不了网页渲染验证（环境级限制，见 `~/.workbuddy/MEMORY.md`），
  工具栏的进度文本、任务卡两个徽章、问题清单弹窗的排版**未经真机过目**，请在素材库与画廊里核对。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）

---

### TB-070 水印库：产品之间的复制（单条 + 整库）

- **来源**：杰哥原话（2026-09-21）「当前水印库缺少产品之间的复制功能，请一并补充该复制能力，
  明确可复制的产品属性范围及复制后的预期行为」。
- **状态**：DONE · 写线：主写线
- **背景（诊断）**：水印库在 TB-067 按产品隔离后，跨产品搬一套水印**只能**「导出 JSON → 切产品 →
  导入」（`PresetManagementTab` 的 `handleExportPresets` / `handleImportPresets`）—— 要落一个临时文件、
  还得记着刚才那套叫什么。行内那个「复制为新预设」是 `duplicatePreset`，**同产品内**复制
  （`productId` 原样带走），跨产品确实没有。
- **改了什么**
  1. **复制的属性范围（= 整套预设，除 id / 名称 / 归属）**：画布尺寸、全部图层（文字 / 图片 / LOGO
     的资产引用）、采样背景路径、适配方式一律带过去。**不带**：`id`（换新，否则两个产品指向同一套，
     改一个另一个跟着变 = 共用而不是复制）、`name`（默认「源名 副本」，目标产品已有同名则加序号
     「… 副本 2」）、`productId`（改为目标产品）、`updatedAt`（盖当前时间）。
     「水印标识符」是全局一份，本来就不属于单个预设，不随复制走。
  2. **资产只沿用引用，不复制文件**：图片 / LOGO 是同一台机器上的 blob，复制既慢又占空间；
     引用计数（`isCompositeAssetReferenced`）保证「删源水印不会让副本变成没图」。
  3. **复制后的预期行为**：副本只落进目标产品的库，**不自动启用** —— 不替任何方向勾选
     （`watermarkPresetIds` 引用的是新 id，没人指向它），所以「复制一下」不会静默改变任何产出结果；
     当前画布的选中预设也不动（画布只在**当前产品**的库里找预设，指过去会切到一套左栏不列的预设）。
  4. **两个入口，一个弹窗**：库行选中后的「复制到…」（单条）+ 库头图标按钮（整库），
     都打开 `PresetCopyDialog` 选目标产品；候选按产品线归组，**排除当前产品**（同产品复制
     是另一个动作，且数据层直接跳过）。三种「点不动」的情形分别给说明（没选产品 / 库是空的 / 树里没有别的产品）。
  5. **产品候选**收敛到 `listProductNodes`（项目树第二级，排除回收站与回收站产品线下的节点），
     与 `resolveOwningProductId` 共用「第 2 级 = 产品」这一条口径。
- **验收标准**（可测）
  1. 单条复制：源水印不变；目标产品里多出一套 `productId` = 目标、名称 = 「源名 副本」的新预设，
     画布尺寸与图层与源一致；
  2. 整库复制：本产品全部水印各复制一份，目标产品已有的同名让开（加序号）；
  3. **不自动启用**：复制前后任何节点的 `watermarkPresetIds` 都不变；当前画布选中预设不变；
  4. 同产品 / 空目标 / 不存在的 id 一律不产生副本，且不抛错；
  5. 候选里不出现当前产品，也不出现回收站里的产品；
  6. `npm run verify` 全绿。
- **改动面**
  - 新增：`features/composite/components/PresetCopyDialog.tsx`（+ `design-system/catalog.ts` 登记）
  - 修改：`features/composite/lib/compositePresetLibrary.ts`（`buildCopiedPresetName` / `planPresetCopies`）、
    `features/composite/storeV2.ts`（`copyPresetsToProduct`）、`features/projectTree/params.ts`（`listProductNodes`）、
    `features/composite/components/PresetManagementTab.tsx`（两个入口 + 弹窗装配）
- **验收证据**：`npm run verify` 全绿（254 文件 / **2935 例**）；提交 **`cc228f0`**（已推送）；
  新增 `compositePresetLibrary.test.ts` **5 例**、
  `storeV2.test.ts` **2 例**、`params.test.ts` **4 例**、`PresetManagementTab.test.tsx` **3 例**
  （单条复制 / 整库复制 + 让名 / 候选排除当前产品）。
- **知情取舍**
  - **不复制到「未分配」区**：目标必须是真实产品。未分配是个过渡态（TB-067），
    把水印复制进去只会变成「谁都看不见」。
  - **源自己就是副本时不去猜尾部**：统一在原名后追加（`X 副本` → `X 副本 副本`），
    名字可预测；重名规避交给序号那一步，不做「替换尾部 副本」这类隐式改写。
  - **不跨机器**：复制只在本机同一份数据里搬（资产是引用）。换台机器仍然要走导出 / 导入。
- **⚠️ 未经渲染自证**：本机做不了网页渲染验证，弹窗的产品分组列表、`复制到…` 文字链与库头图标按钮的
  排版**未经真机过目**，请在中控台「水印」分区里核对。
- **已知坑**：R-59（本机 `node` 默认 v22，跑 vitest / vite 必须显式用 Node 24）

---

### TB-071 配方卡面板底部空白（根因：grid 隐式 auto 行被 stretch 均分）

- **来源**：杰哥报障「页面底部仍有这么大的空白」（2026-09-21，同一处第二次报）
- **状态**：DONE · 写线：主写线
- **改了什么**：`.sop-recipe-panel__body` 显式写 `grid-template-rows: minmax(0, 1fr) auto`
  —— 剩余高度只给录入区（textarea 随窗口长高），概览区按内容高度。
  **面板那层的 `flex: 1 1 auto` 本身没错**（上一轮改的就是那里，报障依旧），
  空白是在面板**内部**被行拉伸出来的：不写 `grid-template-rows` 时子块全落进隐式
  auto 行，而 `align-content` 初始值 `normal` 对 auto 轨道表现为 `stretch` ⇒ 剩余高度**均分**。
- **验收证据**：提交 **`8039251`**（未推送）；新增
  `features/strategy/sopCampaignRecipeLayout.test.ts` **3 例**（面板撑满 / 内部只给录入区 /
  录入区内部 textarea 吃掉剩余高度），读 CSS 文本断言声明（jsdom 无排版引擎，
  与 `design-system/dialogSizing.test.ts` 同手法）；`npm run verify` 全绿（254 文件 / 2935 例）。
- **通用结论已上收**：`docs/architecture-constraints.md` 七章新增
  「grid 容器只要某一块该吃剩余高度，就必须写出 `grid-template-rows`」。
- **未做**：本机无渲染验证能力，空白是否真消失**未经真机过目**。

---

### TB-072 后处理提示的「反复弹 / 关不掉」+ 进度面板 + 手动跑被自动开关拦住

- **来源**：杰哥 2026-09-21 一次报了三件（附 `[PP-SCOPE-002]` 弹窗截图）：
  ① 「请修改提示的弹出逻辑：不要对并非错误的提示反复弹出打扰用户；针对工具栏上的提示，
  确保用户可以正常关闭…不要出现关不掉的情况，并说明是什么原因」；
  ② 「真正的处理进度弹窗为什么没有实现，我要从哪里查看进度」；
  ③ 「为什么我无法手动后处理，一直提示这个又是什么意思」。
- **状态**：DONE · 写线：主写线（与同时在途的另一条线——渠道 `enabled` 删除重构——无文件重叠）
- **背景（三条各自独立，都不是观感问题）**
  1. **反复弹**：`reportPostprocessResult` 只看「有没有 issues」，不看 `severity` ——
     零产出时一律 `showToast(..., 'error')`。而自动后处理**每个生成任务完成就跑一次**，
     配置使然的跳过（`PP-SCOPE-001/002`、`PP-TARGET-001` 等）每批都会照原样重播一次。
  2. **关不掉（两层，第二层会真卡住）**：
     - 提示（toast）**没有关闭按钮**；且没挂 action 时容器是 `pointer-events-none`，
       连「点掉它」都做不到，只能干等 3s（带按钮 6s）。
     - `ConfirmDialog` 的卡片**不设高度上限、内容也不滚动** —— 这是全仓唯一的例外
       （其余 20 处 `ds-modal-surface` 都写了 `max-h-* + flex flex-col overflow-hidden`，
       见 `sizePicker` / `favoriteCollections` / `helpModal` 等）。问题清单条数一多，卡片超出视口、
       底部按钮被顶到屏幕外，而背景滚动是锁着的 ⇒ 只剩 Esc 一条路。
     - 素材库工具栏那个「后处理跳过 (N)」是**状态**不是通知：关掉清单后按钮还在，
       主观感受同样是「关不掉」。
  3. **手动跑被拦**：执行体 `RunTaskPostprocessInput` **没有来源字段**，自动与手动共用
     `if (!slice.enabled)` 判定 ⇒ 用户手动点「跑后处理」也被方向级「自动后处理」开关拦下；
     而 `PP-SCOPE-002` 的线索正写着「或选中素材单独跑一次」，照做还是被跳过 —— 死循环，
     提示本身是错的。
  4. **进度没有查询界面**：TB-069 的进度落点只有「素材库工具栏一行文本 + 任务卡徽章」，
     在画廊 / 中控台里生成图时看不到任何进度；运行记录（`postprocessRuns`）本来就有数据，
     缺的只是一个打开的界面。
- **改了什么**
  1. 执行体加 `source: 'auto' | 'manual'`（store 两个触发点分别传）；
     方向级开关判定改为 `!slice.enabled && input.source !== 'manual'`。
     **「启用范围」（`selectedCollectionIds`）两层触发都仍然要过** —— 手动不能绕过它。
  2. `reportPostprocessResult(result, { successPrefix, source })`：自动触发且无 error 级问题 → 不播报；
     手动触发必有下文，`skipped` 用 `info`。函数改为导出（这条分支走不到完整生成链，只能直接测）。
  3. `showPostprocessIssuesDialog` 标题按内容说真话：有 error → 「后处理出错（N）」，
     否则「后处理跳过（N）」。
  4. `Toast` 传 `onDismiss`（design-system 的 `ToastMessage` 本就带 ×，只是没传），
     容器改 `pointer-events-auto`；store 加 `clearToast`。
  5. `ConfirmDialog`：卡片 `max-h-[calc(100dvh-2rem)]` + `flex-col`，内容区 `flex-auto` 独立滚动，
     右上角加 `IconButton`（`aria-label="关闭"`），按钮组移出滚动区并 `mt-6`。
     （用 `flex-auto` 而不是 `flex-1`：basis 0 会让自适应高度的弹窗内容区塌成 0，
     同一个坑 `dialogSizing.test.ts` 已为 `.ds-dialog--postprocess` 守过一次。）
  6. 新增 `PostprocessRunsDialog`（进度面板）：进行中给 `Progress` + 计数 + 阶段 + 产出数 +
     当前产出；下面列最近记录（状态 / 来源 / 时间 / 结论 / 问题入口），可一键清掉已结束的。
  7. `runtimeStore.dismissPostprocessRun`：清一条已结束记录（**进行中的拒绝** —— 进度还要往它写）；
     新增 `usePostprocessRuns`（分两步取引用，避免 selector 每次返回新数组）。
  8. 工具栏状态入口改为「点开面板」+ 旁边一个 × 清除；文案区分「出错 / 跳过」。
  9. `PP-SCOPE-002` 的线索改成实话（手动跑不受该开关限制）。
- **验收证据**
  - 新增 `features/postprocess/taskPostprocess.test.ts` **2 例**（自动记 PP-SCOPE-002 / 手动不记）
  - 新增 `features/postprocess/PostprocessRunsDialog.test.tsx` **4 例**（进行中给计数与阶段 /
    历次记录与问题入口 / 清空只清已结束 / 空态）
  - 新增 `components/ConfirmDialog.test.tsx` **3 例**（× 点了真关 / 限高 + 内容区滚动 /
    既有 checkbox 与自定义按钮组未被吃掉）
  - 新增 `components/Toast.test.tsx` **3 例**（× 调 clearToast / 容器可点 / 无提示不渲染）
  - `stores/runtimeStore.test.ts` **+1 例**（清已结束、拒清进行中）
  - `store.test.ts` **+1 例**（自动不打扰 / 手动必有下文 / 真出错照弹）+ 改写 1 例（弹窗标题）
  - 涉及文件全绿：`store.test.ts`(146) / `AssetLibraryToolbar.test.tsx`(7) /
    `TaskCard.test.tsx`(7) / `postprocessIssue`(8) / `postprocessRun`(10) / `runtimeStore`(3) /
    `catalog`(6) / `compliance`(10) / `dialogSizing`(2) / `page-coverage`(15)
  - `npm test` **全绿：258 文件 / 2959 例**；`tsc -b --force` **零错误**
  - **CI `ci.yml` success**（head commit `19be835`，2026-09-21）
  - 提交链：`caae697`（主体）→ `02c3eab`（补七章「弹窗高度上限」）→ `19be835`（修 CI 红）
- **⚠️ 本轮踩到并已登记的两个坑**
  1. **CI 第一版红在 `Toast.test.tsx`**：`renderer.root.children[0]` 的类型是
     `string | ReactTestInstance`，取 `.props` 前必须先收窄（已改成给容器加 `data-testid`
     再用 `findByProps`）。**本地为什么会漏**：过滤 tsc 输出时模式写成了 `Toast\.tsx`，
     匹配不到 `Toast.test.tsx` —— 复检一律用「列出全部报错文件」，别用凭记忆拼的文件名模式。
  2. **`architecture-constraints.md` 4.4.2 里写了悬空指针**（指向「七章弹窗高度那条」，
     而那条当时并不存在）→ 已在 `02c3eab` 补写七章那一条。**写指针前先确认目标真的存在。**
- **同文件混着另一条写线**：本轮 `docs/architecture-constraints.md` 与 `src/store.test.ts`
  同时含对方的未提交改动，按 runbook §八 的 hunk 筛选只把**自己的部分**入索引
  （判据：提交后这两个文件在 `git status` 里**仍是 `M`**，对方内容仍在工作区）。
  对方随后把 `enabled` 删除的调用点改完，全仓类型随之转干净。
- **未做**：本机无渲染验证能力 —— 面板排版、× 的位置与进度条观感**未经真机过目**，
  请在素材库工具栏点开核对。
- **通用结论已上收**：`docs/architecture-constraints.md` **4.4.1**（触发来源必须传进执行体）
  与 **4.4.2**（后处理提示的分级：skipped 不是错误、状态入口必须可关）。
- **追加修复（同日 17:45，同一批 UI 报障的第 4 件）**：工具栏被进度文本撑满。
  - **现象**：「跑后处理」按钮与常驻状态入口**同时**铺完整进度文本
    （`0/100 0% · 纯净版 1280x720 · 20260921-快手-网赚-纯净版-陈泽杰-1280x720-1.jpg`），
    两段加起来占满整条工具栏、把别的按钮挤走（截图报障；`0/100` 说明这批是 100 张）。
  - **分工固定**（改法要点）：动作按钮只说「我点的这次在跑」（跑时文案 = `后处理中…`，
    不再复述数字）；常驻入口给**紧凑计数** `后处理 0/100 0%`；**完整详情**归
    ① hover 的悬浮提示（含写盘文件名）② 点开的面板。
  - **新增唯一口径** `formatPostprocessRunBadge(run)`（`postprocessRun.ts`）：计数 + 百分比，
    **永不含 `currentLabel`** —— 那个字段是写盘文件名、几十个字符，正是撑满工具栏的元凶。
    完整口径仍是 `formatPostprocessRunProgress`（悬浮提示用）。
  - **面板补详情**：进行中那格加了「共 N 张 · 已产出 N 个文件 · 开始于 MM/DD HH:MM」，
    并把「正在写：〈文件名〉」拆成单独一行 + `break-all`（长名字换行而非溢出）；
    历史行的全文挂到 `title`（行内仍 `truncate`，保持一行一条）。
  - **布局稳定**：数字走 `tabular-nums`（`0/100` → `100/100` 长宽不变，工具栏不抖）；
    面板是 portal 弹窗，开合不影响工具栏布局。
  - **测试**：`postprocessRun.test.ts` **+1 例**（紧凑口径永不含文件名；分母未知时返回 `undefined`）。
- **仍未做**：紧凑文本与面板详情**未经真机过目** —— 报障时他的视图停在画廊，
  素材库工具栏不可见，截图验不了这处；请在素材库里跑一次后处理核对。

---

### TB-075 「参与产出」回到方向级 + 合并渠道「启用」开关（ADR-0013）

- **来源**：杰哥 2026-09-21 的四项重构评估（第 1、2 项本轮做；第 3、4 项见 TB-076 / TB-077）。
  原话：「1）参数为全局通用，但启用状态跟随对应方向；2）评估『参与产品』与『启用』两个选项是否重复，
  是否可合并为一个」。确认口径：**「对应方向」= 左树上的方向节点**（不是顶上横版/竖版）；
  方向级勾选取**「默认基线 + 生成前照样能临时改」**（不取代运行时勾选）。
- **状态**：DOING · 写线：主写线（⚠️ 编号说明：本条原登记为 TB-072，**与另一条写线的 TB-072 撞号**，故改为 TB-075）
- **改了什么**
  1. **`selectedMediaIds` 回到节点层**（推翻 ADR-0011 裁决 #3）：`PostprocessNodeOverride` 加该字段，
     `applyPostprocessOverride` 用 `??` 合并。**产出链本来就读 `slice.config.selectedMediaIds`**
     （`taskPostprocess.ts` 按渠道拆桶那一段），所以这一步同时让界面与产出生效，没有第二处要改。
     语义与 `watermarkPresetIds` 同构：`undefined` = 继承、**`[]` = 这个方向一个渠道都不投**、
     数组顺序 = 产出顺序。`byMedia` 层仍不开放它（递归推理，且「投不投」就是有没有在列表里）。
  2. **删掉渠道的 `enabled` 字段**：它与「参与产出」对产出的影响完全等价
     （`matchMediaSizes` 先看渠道启用、`buildPostprocessOutputs` 先按参与列表迭代）。
     保留「参与产出」（带产出顺序 + Excel「产出顺序」列 + 输入栏计数都认它）。
  3. **两条迁移**（不做就是静默出错）：`storePostprocessMedia` `version: 2 → 3` + 归一化把旧
     `enabled: false` 折成「从 `selectedMediaIds` 剔除」（否则被停用过的渠道会**悄悄重新产出**）；
     Excel 老包的「启用」列仍认，`否` → 不参与 + 导入报告里汇总说明。
  4. **Excel `node_params` 补 `selectedMediaIds` 列**：不补则「导出 → 导入」把方向级勾选静默丢掉。
  5. **界面**：「渠道与尺寸」分区不再 `globalOnly`；显示「本级自定义 / 跟随「X」」+「改为跟随上级」
     （置 `undefined`，不是 `[]`）；**`ControlConsoleSection.globalOnly` 字段与那条分区级提示条一起删**
     （两个分区现在都是混合的，一句分区级的话说不清哪一半是全局）；文件名预览的示例渠道改按
     当前作用域生效值取样。
- **验收标准**（可测）
  1. 节点作用域下点「参与产出」写进 `params[node].postprocess.selectedMediaIds`，全局基线不变；
  2. 方向没表态时开关显示的是继承来的值，并写出「跟随「X」」；
  3. 「改为跟随上级」把该字段置 `undefined`（不是 `[]`）；
  4. 旧数据 `enabled: false` 的渠道归一化后不在 `selectedMediaIds` 里，且对象上不再有 `enabled` 键；
  5. 渠道表表头不含「启用」；
  6. 老包「启用 = 否 + 参与产出 = 是」→ 该渠道不进 `setSelectedMediaIds` 的参数，且报告里出现「启用 = 否」。
- **改动面**：`lib/postprocessMedia.ts`、`storePostprocessMedia.ts`、`features/projectTree/params.ts`、
  `features/composite/components/{MediaSection,ConsoleMediaTables,CompositeWorkspace}.tsx`、
  `features/composite/lib/{controlConsoleSections,consoleWorkbook,consoleImport}.ts`、
  `features/postprocess/PostprocessNamingFields.tsx`；文档 `docs/adr/0013-*.md`（新）、
  `docs/adr/0011-*.md`（加取代指针）、`docs/architecture-constraints.md` §4.2.1（新）、`docs/RISK.md` R-63。
- **验收证据**：提交 **`396dd08`**（未推送）；`npm run verify` **在提交态上全绿**
  —— **258 文件 / 2959 例**（tsc 双端 + lint + format:check + test 四环齐过）；
  受影响 12 个文件 **442 例**全绿。
  > 过程中一度只能逐条跑：提交前 HEAD 上还压着另一条写线的类型错（`src/components/Toast.test.tsx:70`），
  > `verify` 在第一步就断；对方随后自己修了（`19be835`），本条的完整门禁才补上。
  > **别把「逐条跑过」当成等价于「verify 全绿」**——它少了「四环在同一份代码上一起过」这个信息。
- **反向验证**（3 个变异，逐个确认精确变红）
  | 变异                                          | 结果                                                                           |
  | --------------------------------------------- | ------------------------------------------------------------------------------ |
  | `normalizePostprocessNodeOverride` 不读该字段 | `params.test.ts` **1 failed / 72 passed**（「selectedMediaIds 回到节点层」红） |
  | 去掉 `enabled: false` 的折算                  | `storePostprocessMedia.test.ts` **1 failed / 45 passed**（「折成不参与」红）   |
  | 老包的「启用」列不折、照 `applied` 走         | `consoleImport.test.ts` **1 failed / 19 passed**（渠道多进了列表）             |
- **知情取舍**：输入栏「已勾 N 个渠道」仍读全局基线（它没有方向上下文），核对真实产出用中控台产出预览。
- **已知坑（本轮实踩三条，都值得记）**
  1. ⚠️ **动手时工作区里有另一条写线在并行改后处理**（`Toast/ConfirmDialog/PostprocessRunsDialog/
taskPostprocess` + `store.ts`/`runtimeStore.ts`/`postprocessIssue.ts`）。本轮与它**文件级零重叠**，
     但它改的 `taskPostprocess.ts` 正是我这条线依赖的产出链 —— R-01「同仓单写线」不是洁癖，
     是这里真的会撞。
  2. ⚠️ **任务号撞车**：对方同期也登记了 TB-072（后处理提示分级 / 进度面板），本条因此改为 **TB-075**。
     **同一轮里两条线各自编号 → 必然撞**，要么开工前在 BACKLOG 留一行占位，要么错开号段。
  3. ⚠️ **HEAD 目前是红的**（对方的 `Toast.test.tsx` 类型错，见「验收证据」）：推送前得先修，
     否则 CI 又会连续红（R-74）。

---

### TB-076 尺寸表并进渠道表（每个渠道下方新增一行）—— 待评估

- **来源**：杰哥 2026-09-21 第 3 项：「评估尺寸表格能否合并进渠道表格，在每个渠道下方新增一行来展示」
- **状态**：TODO · 阻塞：**需要先给 `DataGrid` 加横向合并**
- **结论（评估已做）**：可行，但「每个渠道下方新增一行」要那一行**占满整表宽度**才排得开复选框组，
  而 `DataGrid` 现在只有**纵向**合并（`column.spanRows`，TB-066 刚加的）；横向合并（`colSpan`）
  目前只用在虚拟滚动的补白行上。加它约 20–30 行，但要额外定「横向合并与纵向合并同时用时的顺序」。
- **次要约束**：`.ds-data-grid__row { height: var(--ds-data-grid-row-height) }` 是**统一行高**，
  尺寸行会更高（复选框折行）—— 今天尺寸表已经是这样，不算新问题，但合并后同一张表要容忍两种行高。
- **省事替代**（不动设计系统）：渠道表留「渠道名 / 参与产出 / 详细尺寸」三列，复选框组放进
  「详细尺寸」列吃满剩余宽度，并砍掉「尺寸数 / 可用尺寸」两个计数列（信息在复选框组里已有）。
  代价：复选框宽度约 780 → 570px，厂商那 8 个尺寸会折成两行。
- **建议顺序**：等 TB-075 落地后再做（少一个开关列，横向空间反而宽一点）。

---

### TB-077 整个「渠道与尺寸」tab 并入「输出位置」—— 待评估

- **来源**：杰哥 2026-09-21 第 4 项：「评估能否将整个 tab 合并到『输出位置』tab 中」
- **状态**：TODO · 阻塞：**等 TB-075 落地后再评估**（当前倾向：不做）
- **结论（评估已做）**：技术上很轻（分区注册表删一项 + 把 `media` 加进退役分区映射表，
  与当初「分发」并入输出位置同一个做法），但**现在做不划算**：
  1. 「输出位置」已经吞过「分发」，再吞就是五段长页；且它的 tab 名会变成谎话（里面一半不是「位置」），
     改名要连带动弹窗里「去中控台改全局规格」的落点文案；
  2. 合并的收益要等 TB-075 才成立 —— 现在两者节奏不同（规格偶尔配一次、位置每个方向都要动）；
     TB-075 落地后「参与产出」与「按渠道导出位置」都是「方向级 × 按渠道」，那时更值得做的是
     **把这两张表并成一张**（一个渠道行里同时看到勾选 / 尺寸 / 导出位置），而不是并 tab。
- **注意**：`media` 是**持久化**的分区 id，真要合并必须进 `RETIRED_SECTION_ALIASES`
  （否则老用户会被弹回水印，等于把「我上次停在哪」默默抹掉）。

---

### TB-078 后处理画面适配开放为三选一（全局一套）

- **来源**：杰哥 2026-09-21：「后处理导出在处理不同尺寸或宽高比的图片时，默认对图片进行拉伸填充。
  请将模糊填充和裁剪作为备选方案，并说明如何配置或切换这些选项。」
  确认口径：**全局一套**（不按方向分别设）—— 原话「这个改尺寸模式是全局设置一个的就可以全部生效的」。
- **状态**：DONE · 写线：主写线
- **⚠️ 前提纠正（查证结论）**：**原先不是「拉伸」，是「裁剪填满」**。
  `taskPostprocess.ts:58` 曾写死 `POSTPROCESS_FIT_MODE = 'crop-fill'` —— 等比放大铺满 + 从中心裁掉溢出，
  比例不变、丢边缘内容。会被感知成「拉伸」，是因为画面被硬撑满 + 边缘内容整个消失。
  真正的 `stretch`（变形）引擎里一直有实现（`compositeRenderPlan.ts:62`），只是后处理链路没用它。
  **三种模式引擎侧本来就齐**（含 `contain-blur` 的糊底，`compositeRendererV2.ts:339`），
  所以这条不是「新做三种适配」，是「把已有能力接到配置上 + 给入口」。
- **改了什么**
  1. `PostprocessMediaConfig` 加 `fitMode: CompositeV2FitMode`（**默认 `crop-fill` = 旧行为不变**）；
     类型复用渲染器那一份（`compositeV2Types`），不另立同义字面量。
  2. `DEFAULT_POSTPROCESS_FIT_MODE` + `normalizePostprocessFitMode` + `FIT_MODE_OPTIONS`
     （`lib/postprocessMedia.ts`；界面控件与 Excel 取值域共用这一份）。
     **`persist.version` 刻意不 bump**：纯新增字段、默认值等于旧行为，没有旧语义要折算。
  3. 产出链删掉写死的常量，改读配置（`taskPostprocess.ts` 的 `writeVariant` / `renderVariant` 加参数）。
  4. `applyPostprocessOverride` **显式透传** `fitMode` —— 这个函数返回**白名单对象**，
     漏一个字段下游就是 `undefined`，渲染器会抛「未知的背景适应模式」把整批产出废掉
     （`architecture-constraints.md` 4.2.1 第 ② 条那条链）。
  5. 界面：中控台「渠道与尺寸」分区、「画面方向」下面并排一行三选一（标注「全局一套」），
     **只显示当前选中那条的代价**（三条一起铺开会把这一区撑成一段说明文字）。
  6. Excel `naming` 表加 `fitMode` 行（导出）＋ 导入**英文枚举与中文标签都认**；
     填了不认识的值**报一条 reject 而不是静默回落**（静默回落会让人以为改生效了）。
- **怎么切换**（需求里问的「如何配置」）
  中控台（顶栏 tab）→ 左树选作用域 → 「渠道与尺寸」分区 → 「画面适配」三选一。
  **它是全局一套**：在哪个作用域选都一样，改一次所有渠道所有方向生效。
  等价路径是 Excel：导出中控台数据 → 改 `naming` 表的 `fitMode` 行 → 导入。
  选项与代价：**裁剪填满**（默认，填满不变形、丢边缘）/ **模糊填充**（画面完整、带模糊边）/
  **拉伸铺满**（画面完整、比例被改变）。
- **验收标准**（可测）
  1. 中控台点「模糊填充」→ `usePostprocessMediaStore.fitMode === 'contain-blur'`；
  2. 默认值是 `crop-fill`（升级不改观感）；
  3. 旧数据（无该字段）归一化后 = `crop-fill`；坏值（中文标签 / 数字）也回落 `crop-fill`；
  4. `applyPostprocessOverride` 后 `fitMode` 与基线一致（节点写了别的字段也不丢）；
  5. Excel 往返：导出含 `fitMode` 行；导入认 `contain-blur` 与「模糊填充」；
     填 `blur` 时 payload 回落 `crop-fill` **且** `rejected` 里出现「画面适配」；
  6. 方向级参数弹窗里不出现「画面适配」（全局参数不在方向级面板里）。
- **改动面**：`lib/postprocessMedia.ts`、`storePostprocessMedia.ts`、
  `features/postprocess/{taskPostprocess,usePostprocessGlobalConfig}.ts`、
  `features/composite/components/MediaSection.tsx`、
  `features/composite/lib/{consoleWorkbook,consoleImport}.ts`、`features/composite/CompositeWorkspace.tsx`
  ＋ 对应测试 5 个文件。
- **验收证据**：`npm run verify` **全绿** —— **258 文件 / 2974 例**
  （tsc 双端 + lint + format:check + test 四环在同一份代码上齐过）。
  > **跑 verify 的时机**：本轮动手时工作区压着另一条写线的未提交改动（见「已知坑」1），
  > 那时跑全量绿红都不可信（R-74）；等对方 `b50ff28` 提交、工作区只剩本轮改动之后才补跑。
  > 随后只追加了 `BACKLOG.md` / `runbook` 的文档段，**不涉及任何被 verify 覆盖的文件**。
- **反向验证**（1 个变异，确认精确变红）

  | 变异                                        | 结果                                                                  |
  | ------------------------------------------- | --------------------------------------------------------------------- |
  | `applyPostprocessOverride` 不返回 `fitMode` | `postprocessMedia.test.ts` **2 failed / 49 passed**（两条透传用例红） |

- **未验证（如实说明）**：**渲染入参这一段没有端到端测试** —— `taskPostprocess.test.ts` 明确定位为
  「未覆盖渲染链、写盘」，本机也无法做像素级验证。该段由类型系统（`writeVariant` / `renderVariant`
  的 `CompositeV2FitMode` 参数）+ `applyPostprocessOverride` 测试 + 界面写 store 三项共同保障。
  **三种模式的画面差异请在运行中的应用里过目。**
- **已知坑**
  1. ⚠️ **动手时工作区有另一条写线在并行**（`PostprocessRunsDialog` / `postprocessRun(.test)` /
     `AssetLibraryToolbar` / `BACKLOG.md` / `architecture-constraints.md`，其 `BACKLOG.md` 的 mtime
     就在开工前 2 分钟）。本轮与它**文件级零重叠**（只共享 `BACKLOG.md`，用精确插入避让）；
     它于 `b50ff28` 提交后工作区只剩本轮改动，全量 `verify` 才补上（R-01 / R-74）。
  2. ⚠️ **渲染器另一处入参是死参数，别去「修」它**：`PostprocessParamPanel.tsx:508` 的水印归属预览
     也传 `fitMode: 'crop-fill'`，但它**不传 `backgroundDataUrl`** → `renderCompositeV2ToCanvas` 里
     `if (background)` 分支根本不进，这个参数不生效。改了也没有任何视觉差异（查证结论）。
  3. ⚠️ 水印预设编辑器（`PresetCanvasEditor.tsx:258`）的预览仍是 `crop-fill`，**这是对的**：
     适配模式只影响背景，水印叠在最终画布上按 `targetSize` 定位，两者互不影响。

---

### TB-079 素材详情：去掉右侧栏，双击改为「左图右参」大弹窗

- **来源**：杰哥 2026-09-21：「去除素材详情页的右侧栏，将原本显示在右侧栏的参数信息迁移到双击素材时打开的
  弹窗中。双击打开时不要使用全屏模式，改为较大的弹窗展示。弹窗采用左右布局：左侧显示图片，右侧显示参数信息。」
  追加口径：「项目归属参数模块不需要了」「右键菜单已有的参数不要删除」。
- **状态**：DOING · 写线：主写线 ——
  ⚠️ **未完成**：弹窗已居中（实测左右边距各 51px），但**右侧参数栏在本机实测不显示**，见文末「未解决的问题」
- **改前是「一个素材两套参数、两个入口」**
  1. **单击**素材 → 右侧浮出「素材详情」浮动面板（`WordLibrarySidebar` 承载 `AssetDetailPanel`，可拖宽/停靠/收起）。
     触发点是 `store.selectAsset` 里写死的 `detailOpen: true` —— 用户以为的「素材详情页右侧栏」就是它。
  2. **双击**素材 → 铺满全屏的黑底查看器（`AssetViewer`），右侧另有一条 `w-80` 信息栏。
     两处内容还不一样：侧栏独有（操作按钮组 / SOP / 来源明细 / 输入图片数 / 项目归属），
     查看器独有（颜色标签 / 注释 / 衍生关系）。所以这活不是「搬家」，是**把两套并成一套**。
- **改了什么**
  1. **只留一处**：详情 = 双击弹窗。`detailOpen` / `setDetailOpen` 状态、`WordLibrarySidebar` 浮层、
     窄屏详情抽屉、`AssetDetailPanel` 主体**整体删除**（删 3 个文件）。
  2. `AssetViewer` 从全屏改**大弹窗**：`w-[min(1440px,94vw)] h-[88vh]` 居中 + 圆角 + `bg-ds-scrim/45` 遮罩，
     左图右参（`md:flex-row`；窄屏自动折成上下，参数栏高 45% 自己滚）。
  3. 参数栏合并两边内容并按组排：评分/收藏 → 颜色标签 → 文件信息（含输入图片数）→
     来源与参数（`AssetParamBreakdown` + 多来源列表）→ 提示词 → SOP → 注释 → 衍生关系，
     底部固定条放「移入回收站」/「恢复」。
  4. **不加「项目归属」模块**：右键菜单的「添加到项目」就是改归属的入口，弹窗里再来一块是同一件事的第二入口。
  5. **操作只留右键菜单没有的**：「查看来源任务」放进「来源与参数」标题行；SOP 区块自带复用入口。
     其余（查看大图 / 找相似 / 复制 / 收藏 / 添加到项目 / 用作水印预览底图 / 复用提示词与参数 /
     导出原图 / 打开文件位置 / 移入回收站）右键菜单都有，弹窗内不再各放一份；顶部图标条保留现状。
  6. 可复用区块搬到新文件 `AssetDetailSections.tsx`（注释编辑 / 衍生关系），删掉 `AssetDetailPanel.tsx`；
     顺带去掉那两块写死的 `mt-4`（间距交给容器的 `space-y-4`，否则在弹窗里会叠成两倍）。
  7. `AssetViewer` 的写死色改成语义 token（hex 7 → 0 处、裸 `rounded-*` 6 → 0 处），compliance 基线相应下调，
     并删掉失效的 `AssetDetailPanel.tsx|bareRounded: 19` 条目。
- **验收标准**（可测）
  1. 单击素材：`activeAssetId` 变化，但 `viewerAssetId` 仍为 `null`（不再弹出任何面板）；
  2. 双击素材：出现 `data-testid="asset-viewer"` 的弹窗，含左图与 `asset-viewer-info` 参数栏；
  3. 参数栏有文件信息 / 来源与参数 / 提示词 / 注释 / 衍生关系；**不含**「项目归属」字样；
  4. 回收站素材在弹窗里只给「恢复」；
  5. 全仓不再有 `detailOpen` / `WordLibrarySidebar` / `AssetDetailPanel` 的**代码**引用（注释里的历史说明除外）；
  6. `catalog.test.ts` 的「每个 UI 模块都登记、无失效登记」通过（新文件登记、删掉的登记项移除）。
- **改动面**：`features/assetLibrary/{AssetViewer,AssetDetailSections(新),AssetLibraryWorkspace,store}`、
  `App.tsx`、`design-system/{catalog,compliance.test}`、`lib/referenceAssetCleanup.ts`、
  `components/{HelpModal,InputBar}`；**删除** `components/WordLibrarySidebar.tsx` 及其测试、
  `features/assetLibrary/AssetDetailPanel.tsx`。
- **验收证据**：`tsc -b` + `tsc -p electron/tsconfig.json --noEmit` 双端零错；
  `design-system` + `assetLibrary` **29 文件 / 539 例全绿**（含 catalog 登记守卫与 compliance 棘轮）。
- **知情取舍 / 遗留**
  1. `wordLibrarySidebar_pos_v2` / `wordLibrarySidebar_dock_v1` 两个 localStorage 键成了遗留数据；
     共享键 `floating_panel_width_v1` 仍被 `WorkspaceTabBar` 使用，**不能清**。前者留着无害，未做清理。
  2. 弹窗里**没有**「永久删除」：它要先弹引用冲突确认（`AssetPurgeModal`），而那个确认弹窗挂在素材库
     工作区上（要读它的 `requestPurge`），弹窗拿不到。回收站素材的右键菜单里有这个入口，不算丢功能。
  3. 深色画布只落在图片区（`bg-ds-scrim/40`），弹窗外框与参数栏走 `bg-ds-surface` ——
     与 `DetailModal` 的做法一致（同一套「弹窗」语义），不再有全屏黑底。

#### ⚠️ 未解决的问题（本条**不能算完**）

**已解决**：参数栏**能正常显示** —— 在最大化窗口（视口 1717×931 CSS）下实测：
「素材信息 / 评分 / 颜色标签 / 文件信息 / 来源与参数 / 提示词」全在，且能滚。
所以先前在 1400×900 小窗口下观察到的「参数栏完全不可见」与窗口尺寸或当时的中间状态有关，
**不是参数栏本身没渲染**。

**残留问题：弹窗略偏右**。实测弹窗左边界约在 x≈868（物理像素），而居中应在 ~207；
右参数栏被窗口右边界切掉一部分（可见约 153px）。偏移量约 441 CSS——
**与 `--app-docked-left-width`（左页轨宽度）同量级**，即遮罩层的 `position: fixed`
在真实窗口里**没有完全按视口定位**（尽管在 1400×900 窗口下探针读到的是 `position: fixed`、宽度 = 视口宽）。
**未定位**：需要用 DevTools 看遮罩层的 `offsetParent` / 祖先链里谁建立了包含块。

**本机限制（为什么没查下去）**：这个环境拿不到渲染进程的 DevTools ——
`Ctrl+R` / `Ctrl+Shift+R` 在 Electron 里**都没有绑定**（`main.ts` 只有 `autoHideMenuBar: true`，
没有 reload 菜单项），也没有可用的 CDP 端口。只能靠「PrintWindow 截图 + 界面上的临时调试条」诊断，
而**在截图上目测边界我连错三次**（把弹窗内的元素当成弹窗边界、把素材库卡片当成弹窗内容）。
真正可靠的定位手段是 `getBoundingClientRect()` 打在界面上读数字，但改一次要重启 dev（60–90 秒），
成本很高。

**复现方式**：`npm run dev` → 双击任一素材 → 看弹窗是否居中、右侧「素材信息」栏是否完整可见。

> 过程提醒：**删文件后 vite 的 HMR 不再可靠**（探针改了三次界面都不动），期间只能靠重启 dev；
> 而 dev 冷启动 + 页面水合需要 **60–90 秒**，截太早会看到空白页（我因此误判了好几轮）。

---

### TB-080 素材详情弹窗底部：从「类似图片」改为「同一任务卡片的图片」

- **来源**：杰哥 2026-09-21：「将图片双击打开的弹窗下方的类似图片，改为同一任务卡片生成的图片」
- **状态**：DONE · 写线：主写线
- **改前**：底部条标题「类似图片」，内容走 `assetCommands.recommend({ similarToAssetId })` ——
  按内容相似度 / 文本向量**跨任务**排序，列出来的是**别的任务**里长得像的图，不是"这张卡还出了哪几张"。
- **改了什么**
  1. 口径改为「该素材在素材库任务卡片视图里所属的那张卡」：普通任务卡 = 同一 `taskId` 的全部输出图；
     SOP 批次卡 = 同一 `snapshotId || batchId` 的整批任务输出图；任务记录已清理的卡片仍按来源快照
     里的 `taskId` 匹配，只是不再扩到整批。与 `buildAssetBatchGroups` 的分组口径一致。
  2. 逻辑抽成 `src/lib/assetBatchGrouping.ts` 的纯函数 `resolveTaskCardScopeKey` / `collectTaskCardAssets`，
     不写在组件里裸算（这样才有单测）。
  3. 组件里拆两步 memo：范围键只随任务列表变、素材扫描只随范围键 / 素材变 ——
     否则生图过程中每次任务进度更新都会把已加载素材全量重扫一遍。
  4. 列表含当前这张并描边高亮（`aria-current`），点击即切换；卡片只有一张图时整条不渲染。
  5. 顺带修：「从底部条切进不在打开时浏览列表里的图」会让标题右侧显示成 `0 / n` → 算不出位置就不显示。
  6. 标题「类似图片」→「同一任务」；`catalog.ts` 里的登记描述同步（"Eagle 式全屏查看器…类似图片…" →
     "素材详情弹窗…同一任务图片…"）。
- **验收标准**（可测）
  1. 同一任务出了多张图 → 打开其中任一张，底部条只列该任务的那几张，不含其他任务的图；
  2. 底部条里当前那张有描边高亮，点另一张能切过去；
  3. 该卡片只有一张图时底部条不出现；
  4. 从底部条切换后，标题右侧不再出现「0 / n」；
  5. 单测覆盖：普通任务范围 / SOP 批次扩批 / `snapshotId` 不同不合并 / 任务记录缺失 / 只取在库素材并按槽位排序。
- **改动面**：`features/assetLibrary/AssetViewer.tsx`、`lib/assetBatchGrouping.ts`（新增两个纯函数）、
  `lib/assetBatchGrouping.test.ts`、`design-system/catalog.ts`。
- **验收证据**：`tsc -b` + `tsc -p electron/tsconfig.json --noEmit` 双端零错；`eslint .` 零告警；
  `prettier --check` 通过；**全量 `vitest run` 257 文件 / 2972 例全绿**。
  新增 `assetBatchGrouping` 5 例，并做反向验证：临时禁用 SOP 批次扩批后「SOP 批次卡片…」一例确实变红，
  恢复后重新变绿（证明测试确实在测这条口径）。
- **知情取舍 / 遗留**
  1. 素材来源取自已加载的 `assetsById`（Electron 下初始 200 条 + 随浏览合页）。能渲染出来的卡片，
     其图必然已加载，所以用户点得到的卡片都覆盖；不加新的 IPC 查询。
  2. 左右方向键的浏览顺序**保持打开时那个列表不变**（只换底部条的口径），刻意的最小改动。
  3. **未经渲染验证**（本机无法离屏渲染）：界面效果需在运行中的应用里过目。
     单图任务现在整条不显示 —— 这是此次改动的预期结果。

---

### TB-081 素材详情弹窗：去掉参数栏的「收起」按钮（同一个弹窗里两个 ×）

- **来源**：杰哥 2026-09-21 报障：「双击图片后弹出的弹窗中，为什么要设置一个『关闭右侧栏』的按钮，
  导致同一个弹窗里出现两个按钮？这容易让人误点并意外关闭右侧栏且无法恢复。请去除弹窗中这个
  关闭右侧栏的按钮，使弹窗只保留必要的操作按钮，避免误操作。」
- **状态**：DONE · 写线：主写线
- **改前**：参数栏标题行右侧有一个 `aria-label="收起信息栏"` 的 ×（TB-079 引进），
  与顶部图标条里「关闭素材详情」的 × 长得一样、位置又近 → 误点后参数栏整个消失；
  而"恢复"入口是收起之后才渲染的浮层按钮（`absolute right-3 top-14`，容易被当成别的东西），
  等于**关了找不回来**。
- **改了什么**
  1. 删掉参数栏标题行的收起按钮；标题保留为纯文字分区标题（「素材信息」）。
  2. `infoOpen` state 连同 `{infoOpen && …}` 包裹与 `{!infoOpen && 展开入口}` 一起删除 ——
     参数栏常驻，不再有开合状态。
  3. 弹窗里现在**只剩一个 ×**（顶部「关闭素材详情」）。
- **验收标准**（可测）
  1. 弹窗内不存在 `[aria-label="收起信息栏"]`；
  2. 弹窗内 `XIcon` 只剩 1 处（关闭素材详情）；
  3. 参数栏（`data-testid="asset-viewer-info"`）始终渲染，与宽 / 窄布局无关。
- **改动面**：`features/assetLibrary/AssetViewer.tsx`。
- **验收证据**：`tsc -b` + `tsc -p electron/tsconfig.json --noEmit` 零错；`eslint .` 与
  `prettier --check` 通过；`assetLibrary` + `design-system` 29 文件 / 539 例全绿。
- **知情取舍**
  1. 窄屏（`< 768px`）折成上下布局时，参数栏固定占下半部 45% 且**不能收起** ——
     这是"消除误点"的必然结果；正常窗口的左右布局不受影响。
  2. **未经渲染验证**（本机无法离屏渲染）：界面效果需在运行中的应用里过目。

---

### TB-082 任务卡「素材丢失」+ 失败提示「关不掉」+ 素材删除/同步失败无日志

- **来源**：杰哥 2026-09-21 19:52 报障（附两张截图：任务卡片视图概览条
  `4 个分组 · 130 个任务 · 120 张素材 ●完成 120 ●失败 10`，与顶部工具栏 `全部素材 429 张`）：
  「任务卡片生成过程中素材会不定时丢失，并突然弹出失败提示，且该提示无法被关闭」。
  ⚠️ **编号说明**：本条原拟登记为 TB-080，开工后才发现 TB-080 / TB-081 已被**同期另一条写线**
  占用（`7d9b354` / `5092016`，都是素材详情弹窗的活），故改为 TB-082。
- **状态**：DONE（其中「132 张素材被永久删除」的**来源未定位**，已补日志待复现）
- **实测取证**（直查 dev 库 `%APPDATA%\tangbao\local-saves\`；探针写在 `%TEMP%\tb-asset-doctor*.py`，不落项目根）
  1. `tasks/` 561 个任务文件、561 张产出图，**磁盘原图一张不少**；素材表 `assets` 只有 429 张
     ⇒ **132 张的素材记录被永久删除**。
  2. `tombstones` 132 条，`purged_at` 全部落在**今天 16:36:24（一次 50 张）/ 16:45:00（一次 10 张）/
     16:47:00–16:47:24（每秒 2–4 张，共 72 张）**。
  3. 删除**只清了记录**（`assets` + `app_data_records` + `blobs` 都没了），**没删磁盘原图**
     ⇒ `561 = 429 + 132` 精确吻合。
  4. 这 132 张**仍被 132 个 `done` 任务引用**（`tasks/*.json` 的 `outputImages`）
     ⇒ 任务卡上这些图正是「素材丢失」的现场。
  5. **删除来源无法从数据判定**（过去没有任何日志，只剩墓碑时间戳）⇒ 这正是「补日志」的动因。
- **代码根因（三块，各自独立）**
  1. **封面「图片已丢失」标记永不复位**：`TaskCard.tsx` 加载封面的 effect 清了 `thumbSrc` / 比例 / 尺寸，
     **漏了 `setThumbLost(false)`** ⇒ 某一轮在「缩略图未就绪 + 图片记录查不到」的瞬间点亮后永久粘住，
     此后任何一次 `thumbSrc` 为空（切封面、重新生成、加载中）都会闪出「图片已丢失」，图其实一直在。
     对照 `hooks/useCoverThumbnail.ts` 的同名 effect 是**重置**的 —— 属于写漏，不是设计。
  2. **「关不掉」有两条独立路径**：
     - 素材库顶部「素材索引补齐失败」红条**没有任何关闭入口**，只剩「重试」；它由启动后台对账失败写入，
       一旦失败就常驻（`AssetLibraryWorkspace.tsx`）。
     - 批量生成**每个任务结算播一次** toast（`store.ts` 的 `生成失败：…` / `生成完成…`），
       而 toast 只有一个槽位 ⇒ 点 × 关掉后，下一个任务结算立刻顶一条同款回来。
  3. **失败只进控制台、界面上无痕**：素材归档失败（`assetSyncQueue.onError`）、任务落盘两次都失败
     （`persistTaskWithRetry`）、启动对账失败（`assetReconciliation`）此前都只有一行裸 `console.error`；
     红条文案只说「N 个任务索引失败」，不带任何任务 id，事后无从下手。
- **改了什么**
  1. `TaskCard.tsx`：封面 effect 补 `setThumbLost(false)`，并写明为什么必须跟着一起重置。
  2. `AssetLibraryWorkspace.tsx`：红条加 `IconButton`（`aria-label="关闭提示"`）+ 本地 `migrationNoticeDismissed`；
     离开 error 态自动复位；点「重试」先复位再请求（否则「关掉 → 点重试 → 毫无变化」看着像按钮坏了）。
  3. **新增 `src/lib/toastReplayGuard.ts`**：「用户亲手关掉的提示，短窗口（默认 8s）内同文案不重播」。
     只有**点 × 主动关闭**才登记（到点自动消失不算）；精确匹配文案；窗口有限 —— 不吞真正的新提示。
     `store.ts` 的 `showToast` 前置拦截、`clearToast` 登记。
     单独成模块的原因写在该文件注释里：store 是单例，测试里字段一旦被 `setState` 换掉就测不了这段逻辑。
  4. 补五处结构化日志：`[asset-sync]` / `[task-persist]` / `[asset-reconcile]` / `[asset-purge]` /
     `[library-image-sync]`，统一带 taskId、任务状态、产出张数、错误名与消息；
     `purgeGeneratedAssets` 新增 `reason` 入参（标注发起者），每次永久删除都留一行可回溯的记录。
  5. `assetReconciliation` 新增 `failedTaskIds`；对账失败的红条文案带上前 3 个任务 id。
- **验收标准**（可测）
  1. 点 × 关掉某条提示后，同一文案 8 秒内不再出现；换文案照常出现；
  2. 「素材索引补齐失败」红条可关闭，关闭后不再自动冒出；点「重试」会重新显示；
  3. 图片数据正常时，任务卡封面不再闪出「图片已丢失」；
  4. 素材归档失败 / 任务落盘失败 / 对账失败都能在控制台看到带 taskId 的结构化日志；
  5. 红条文案含具体任务 id，不再只有数字。
- **改动面**：`src/components/TaskCard.tsx`、`src/features/assetLibrary/AssetLibraryWorkspace.tsx`、`src/store.ts`、
  `src/lib/assetReconciliation.ts`、`src/lib/toastReplayGuard.ts`（新）+ 其测试、`src/store.test.ts`、
  `src/lib/assetReconciliation.test.ts`。
- **验收证据**：`tsc -b` + `tsc -p electron/tsconfig.json --noEmit` 双端零错；`npm run lint` 零告警；
  `npm run format:check` 通过；**全量 `vitest run` 258 文件 / 2984 例全绿**（含新增用例）。新增用例：闸门 5 例（窗口内不重播 / 换文案照播 / 超窗恢复 / 记住最后一次）、
  store 接线 2 例（关掉后同文案不弹、换文案照播）、对账失败带 `failedTaskIds` 1 例。
- **知情取舍 / 遗留**
  1. **「132 张被永久删除」的来源仍未定位**：数据只能给出时间戳，且这些删除**没有删磁盘文件**
     （与「用户彻底删除」的预期行为不符）。已埋 `[asset-purge]`（带 `reason`）与 `[library-image-sync]` 日志，
     **下次复现即可判定是「文件先消失」还是「别的调用方」**。同时请杰哥确认：今天 16:36 / 16:45 / 16:47
     是否自己删过素材（例如清理不满意的批次）。
  2. 磁盘上残留 132 个孤儿原图（记录已删、文件还在）**本次未清理**。
  3. 任务卡视图概览的「N 张素材」只统计**已加载页**（首屏 `limit: 120`），与顶部工具栏的
     「全部素材 429 张」口径不同，两者并排容易被读成「素材丢了」。**未改**：口径怎么显示属于交互取舍，
     待杰哥定（可选：概览直接显示全库总数，或写成「已加载 120 / 共 429」）。
  4. 未经真机渲染验证：红条 × 的位置与观感、提示「关掉不再复活」的手感，请在运行中的应用里过目。

---

### TB-083 删任务连带删图（磁盘那一步没删掉）+ 卡片标「已删除」+ 提示一律可关

- **来源**：杰哥 2026-09-21 22:07 三条需求：
  ① 「删除任务卡片时，应同时删除该任务关联生成的所有图片」；
  ② 「当素材库中的图片被删除后，对应的任务卡片上直接将该图片状态显示为『已删除』，而无需移除卡片其他内容」；
  ③ 「整个界面中禁止出现任何无法关闭的提示，所有提示都必须提供明确的关闭方式」。
- **状态**：DONE（③ 的**范围**待杰哥确认，见遗留 1）
- **① 的核查与真 bug**
  - 链路本来是接好的：`removeTask` / `removeMultipleTasks` → `purgeTaskOutputAssets` → `purgeGeneratedAssets`，
    且按「被其他任务/会话引用则保留」的口径（文案也是这么写的）。
  - **但磁盘原图删不掉**：`executeAssetPurge` 的次序是「先删素材/图记录（事务）→ 再删图片字节」，
    而字节删除要按**图记录里的 `localPath`** 去找文件 —— 记录已经没了，这一步静默空转，一个文件都删不动。
  - **本机实测佐证**：132 张素材记录被永久删除，而 `cache-images/` 里文件**一张不少**
    （`561 = 429 + 132` 精确吻合）；`deleteCacheImageFiles` 的失败也只是回给了一个**没人看的**
    `{ deleted, failed }`。
  - **改法（把顺序变成契约）**：`AssetPurgeExecutorDeps` 新增 `collectImagePaths`（**在 `purgeRecords` 之前**回调）
    与 `deleteImageFiles`（删完记录后按路径删文件）；`purgeGeneratedAssets` 实现这两个钩子
    （`batchGetImages` 取路径 → `deleteRawCacheImages` 删文件）。顺序写在 `executeAssetPurge` 里，
    单测直接按调用顺序断言。
- **② 的改法**
  - 数据侧**本来就对**：素材被永久删除时 `patchTaskForPurgedSlots` 会把 `outputImages[slot]` 置空
    并把槽位号记进 `purgedOutputSlots`，**任务与卡片都不删**（本机库里 72 个任务带这个字段）。
  - 缺的是界面：`TaskCard` 从来没读 `purgedOutputSlots`，于是被删的封面槽位只显示一个**没有任何说明**的空白占位。
  - 改法：`TaskCard` 增加 `coverPurged`（封面槽位在 `purgedOutputSlots` 里）→ 直接渲染「已删除」，
    排在「加载中占位 / 图片已丢失」之前（这一格的结论是确定的，不必等加载）；
    张数角标从 `outputImages.length` 改为**仍在的槽位数**，否则会报一个用户点不开的数字。
- **③ 的清点与改法**
  - 浮层类：Toast（上一轮加 × + 关掉后不重播）、ConfirmDialog（有 ×）、`PromptInputDialog` / 各类 Modal（有取消/关闭）。
  - **常驻条**（本轮补）：素材库「素材索引补齐失败」红条（上一轮加 ×）；
    「生成中 / N 个任务失败」提示条 —— 原来整条是个 `<button>`，**没有任何关闭入口**。
    改成「可点区域 + 右侧 ×」，关闭口径：**只有失败数继续上涨才重新出现**
    （「生成中」数量变化不重弹，否则任务一路跑、条一路弹，用户只会觉得关不掉）。
  - 进度类（`正在补齐素材索引 X/Y`、加载骨架屏、工具栏「后处理 3/100」）按**状态**处理：
    到点自行消失，不属「提示」，不加 ×（口径待确认，见遗留 1）。
- **验收标准**（可测）
  1. 删任务 / 删素材后，该图在 `cache-images/` 里的原图文件也被删除（路径在删记录前收集）；
  2. 顺序契约：`collectImagePaths` → `purgeRecords` → 删字节 → `deleteImageFiles`；
  3. 素材被删后，任务卡封面位置显示「已删除」，卡片其余内容（提示词/参数/耗时）保留，状态仍为完成；
  4. 张数角标只计仍在的图；
  5. 素材库两条常驻提示条都能关，且关掉后不会因为「生成中」数量变化立刻弹回来。
- **改动面**：`src/lib/assetPurge.ts`（+ `AssetPurgeExecutorDeps` 两个钩子）、`src/lib/assetPurge.test.ts`、
  `src/store.ts`（实现钩子 + `reason: 'task-deleted'`）、`src/components/TaskCard.tsx`（+ 测试）、
  `src/features/assetLibrary/AssetLibraryWorkspace.tsx`。
- **验收证据**：`tsc -b` + `tsc -p electron/tsconfig.json --noEmit` 双端零错；`npm run lint` 零告警；
  `npm run format:check` 通过；全量 `vitest run` **258 文件 / 2987 例全绿**。
  新增用例 3 个：`assetPurge` 顺序契约 1 例（`collect → records → bytes → files`）、`TaskCard` 2 例
  （被删槽位标「已删除」且不误报「图片已丢失」/ 未删的卡片不误标）。
  **反向验证**：临时禁用 `collectImagePaths`（改成 `[]`）后顺序用例立刻变红、改回即绿；
  临时把 `coverPurged` 写死 `false` 后「已删除」用例变红、改回即绿。
- **知情取舍 / 遗留**
  1. **③ 的适用范围请杰哥定**：本轮把「浮层 + 常驻提示条」全部做成了可关；
     **面板内的内联错误文字**（如 SOP 批量弹窗底部的红字、表单校验提示）**没加 ×** ——
     它们随操作消失、且关掉弹窗即消失，按惯例不加关闭按钮。若你要求连这些也各自带关闭入口，我再补。
  2. **磁盘删除失败仍是静默的**：主进程 `deleteCacheImageFiles` 返回 `{ deleted, failed }`，
     渲染侧 `deleteRawCacheImages` 直接丢掉返回值 —— 路径不匹配（如库根换过）或 `unlink` 失败时，
     UI 与日志都无痕。**本轮未改**（改它会让删除接口的返回语义变化），已登记 `docs/RISK.md` R-78。
  3. 本机库里那 **132 个孤儿原图**（记录已删、文件还在）源自这次修掉的顺序缺陷。
     **已在追加段里清理**（见下）。
- **追加（同日 22:3x-22:5x，杰哥确认「是我删的，一起做」）**
  1. **磁盘删除失败不再静默**：`deleteRawCacheImages` 改为返回 `{ deleted, failed }`；
     `failed` 非空、或 IPC 抛错时打 `[cache-image-delete]` 日志（请求数 / 失败数 / 前 3 个失败路径）。
     这正是「132 张记录被删、文件一张不少」当初查不出原因的那一环。
     新增 3 例单测：全成功不打日志 / 部分失败回路径且打日志 / IPC 抛错算全失败且不向调用方外抛。
  2. **本机那 132 个孤儿原图已清理**：判据 = 「文件名（内容哈希）出现在 `tombstones` 里，
     且**不被任何现存记录引用**」——全文本扫 `app_data_records` 全部 namespace，
     外加 `assets` / `blobs` / `asset_machine_index` / `asset_semantic_buckets` / `asset_usage_events` / `collections`。
     命中 132 个、267.4 MB。
     **先备份再删**（`%TEMP%\tangbao-orphan-backup-20260921-223047`，132 个文件齐全可回滚），
     删完 `cache-images` 从 616 → **484 个文件**，正好等于「被现存记录引用的哈希数」。
     清理脚本 `%TEMP%\tb-orphan-scan.py`（默认只预览，`--delete` 才动手）。
  3. 结论：TB-082 里「132 张素材被永久删除」的来源**至此闭环** ——
     是杰哥自己在 16:36 / 16:45 / 16:47 删的（三批），而文件没跟着删是上面那个顺序缺陷。

---

### TB-084 后处理记录：跳过型问题不再标红「失败」+ 异常收尾保住已产出数

**验收标准**

1. `resolvePostprocessRunStatus({ producedFiles: 0, issues: [只有 skipped 级别] })` 返回
   **`skipped`**（不再是 `failed`）；面板标签显示灰色「已跳过」，一行结论写「后处理没有产出：N 项被跳过」。
2. `{ producedFiles: 0, issues: [有 error 级别] }` 仍返回 `failed`（红灯不放松）。
3. `{ producedFiles: 0, issues: [] }` 仍返回 `succeeded`（本次没有可做的事）。
4. 执行体中途抛异常时（`store.ts` 的 catch 兜底），收尾写入的产出数**取进度里最后一次上报的值**，
   不再是写死的 0 —— 磁盘上已有产物时，记录必须显示「部分完成」而不是「没有产出文件」。

**背景**（2026-09-21 22:30 报障「为什么后处理的记录里有这么多显示失败的，但实际上最后是成功的」）

- 界面上 7 条「失败 · 自动触发 · 后处理结束：没有产出文件 · 查看跳过 (1)」，下面一条
  「成功 · 手动触发 · 产出 100 个文件」。判据：按钮文案是「查看跳过」⇒ `errors === 0`。
- 真实原因：杰哥 22:22:51 关掉了 `builtin-direction-17`（= 百万医疗险 / **图标**）的
  「自动后处理」开关（库里 `projectTreeParams`），那批图都属于该方向 ⇒ 每个任务完成触发的
  自动后处理都被 `PP-SCOPE-002` 跳过（`taskPostprocess.ts:256` 刻意只拦自动触发）⇒ 零产出。
  22:25 手动跑不受该开关限制 ⇒ 产出 100 个文件。「这么多」= 每个任务各触发一次。
- 即：**处理过程本身没错，错的是零产出那条判定没看 severity**，把「配置使然的跳过」渲染成了红色故障。

**改动**

- `src/features/postprocess/postprocessRun.ts`：`PostprocessRunStatus` 增加 `skipped`；
  判定改为「零产出先看有没有 error」；`summarizePostprocessRun` 增 `skipped` 档。
- `src/features/postprocess/PostprocessRunsDialog.tsx`：状态色调表补 `skipped: 'neutral'`（灰，不是红）。
- `src/store.ts`：`executePostprocessImageIds` 暂存进度里的产出数，异常兜底带上它。

**不做**（已知而不改，避免扩大范围）

- 「产出 N 个文件」在正常路径用的是**变体数**（`result.outputs.length`，双写只记一份），
  而进度里滚动的是**文件数**。两个口径并存，本轮不动（统一会牵到 toast 与任务卡文案）。

**验收证据**（2026-09-21 22:42）

- 定向用例 `src/features/postprocess/` + `stores/runtimeStore.test.ts` + `store.test.ts`
  → **12 文件 / 207 例全绿**。
- **反向验证（A）**：把判定改回旧行为（`return input.issues.length > 0 ? 'failed' : 'succeeded'`）
  → **3 failed / 12 passed**，全部是 `AssertionError`，且恰好是钉住这条契约的那三例
  （判定表 / 一行结论 / 面板渲染「已跳过」），其余照过 → 探针精确命中。恢复后重跑回到 207 全绿。
- `npx tsc -b`、`npx eslint`（5 个改动文件）、`npx prettier --write` 均零错、零 diff。
- ⚠️ **B 没有自动化测试，也没有反向验证**：要构造「执行体在写出若干文件**之后**抛异常」，
  必须让渲染链在 jsdom 里跑通，而它依赖 canvas（`taskPostprocess.test.ts` 顶部已注明
  「未覆盖：渲染链、写盘、分发」）。B 只在异常路径生效、实质是换一个取值来源（不新增逻辑），
  按代码审查交付。**将来若有人把 `producedFiles` 改回写死 0，现有测试不会红。**
- 顺带（发布前顺手修）：`docs/BACKLOG.md` 的 `format:check` 一度红 —— TB-085 段里有一行以
  `+ Esc…` 开头（prettier 要规范化成 `- Esc…`），发布轮已改为 `-`（只动这一个字符）。

---

### TB-085 统一浮层关闭：一级弹窗「点空白 + Esc」、下拉浮层「点外 + Esc」

- **来源**：杰哥 2026-09-21：「统一一级弹窗的关闭交互方式……部分下拉弹窗和一级弹窗只能通过再次点击
  触发按钮或点击关闭按钮来关闭，造成交互不一致和用户困惑……同时明确下拉弹窗等特殊类型的关闭规则，
  确保交互逻辑一致、无冲突。」
- **状态**：DONE · 写线：主写线（与 TB-082~084 的后处理线并行；本轮只碰浮层相关文件）
- **摸底结论**（逐个核实 30+ 个浮层，其中**推翻了两处误判**，见下）
  1. 一级弹窗（独立遮罩）**绝大多数早已支持点空白关闭**（部分走共享 `isModalBackdropEvent`，
     部分手写 `target === currentTarget`）。真正"点空白不关"的只有 `AgentBatchPlannerModal` 内那个
     「执行方式确认」二级弹窗。
  2. 用户真正感觉"关不掉、只能再点一次触发按钮"的是**下拉浮层**：`AssetLibraryToolbar` 的
     筛选 / 排序 / 保存智能文件夹，`FilterControlStrip` 的「+」菜单（只认 `onMouseLeave`），
     `SettingsModal` 的 API 配置下拉（缺 Esc），`InputBar` 的若干下拉（缺 Esc）。
  3. 根因：`Popover` / `Menu` 是**纯壳子**（只有样式、没有任何关闭逻辑），每个调用方各写一套 →
     必然不一致；且 `useCloseOnEscape`（window 上的 escStack）与 `overlayManager`（document 上的
     overlayStack）**两套 Esc 栈并存**，已有组件只能靠 `stopPropagation` 打补丁。
  4. 两处误判（本轮核实）：`SopTextEditor` 查找替换**本来就有** Esc + 点外部（两份自写 effect）；
     `GallerySopBatchModal` 的提示词库右键菜单**本来就有** Esc（capture 阶段抢先）。
- **改了什么**
  1. 新增 `src/hooks/useDismissableLayer.ts`：下拉浮层统一关闭（document 级 `pointerdown` capture
     判"点在外面" + Esc 走 `useCloseOnEscape` 的栈，保证只关最内层）；**排除面板自身与触发按钮**，
     否则点按钮会「先关再开」闪一下。配 4 例单测。
  2. 接入：素材库筛选 / 排序 / 保存面板（3 处）、`FilterControlStrip`「+」菜单（**去掉** `onMouseLeave`）、
     `SopTextEditor` 查找替换（两份自写 effect 收敛到 hook）。
  3. 补 Esc：`InputBar` 参数下拉 / 输出位置 / 移动端上传来源 / 视觉 Skill 面板、`SettingsModal`
     API 配置下拉、`ImageContextMenu` 右键菜单。
  4. 一级浮层：`SopManagementCenter` 补 Esc（此前只有遮罩 + 关闭按钮）；`AgentWorkspace` 窄屏会话抽屉
     补 Esc + 显式关闭按钮（`lg:hidden`）；`AgentBatchPlannerModal`「执行方式确认」补「点空白返回上一步」
     - Esc 返回上一步（此前 Esc 会直接把整个工作台关掉，只剩「返回修改」一条退路）。
  5. `Popover` / `Menu` 增加 `ref` 透传（React 19 ref-as-prop），调用方才能判定"指针是否落在面板内"。
  6. `useCloseOnEscape` / `useDismissableLayer` 补非浏览器环境守卫 —— node 环境的组件测试没有
     `window` / `document`，此前会把无关用例整片带红（本轮实际踩到）。
  7. 规范落地：`MASTER.md` 新增 **§6.9 浮层关闭**（按类型给规则 + 例外），§6.2 的 Escape 行加指针；
     `COMPONENTS.md` §2.7 的 Dialog / Drawer / Popover / Menu 行补关闭口径。
- **验收标准**（可测）
  1. 素材库三个面板：点面板外任意处或按 Esc 关闭；点触发按钮仍正常开合、不闪；
  2. `FilterControlStrip`「+」菜单：鼠标移开**不再**关闭，点外部 / Esc 关闭；
  3. 上述每个一级浮层按 Esc 只关自己，不穿透到下层；
  4. `useDismissableLayer` 单测：面板内点击不关、触发按钮上点击不关、面板外点击关闭、Esc 关闭；
  5. `compliance` 基线不超（新增 UI 类不得引入旧工具类 —— 本轮新按钮第一版用了 `rounded-lg`，
     实跑即被基线拦下，已改 `rounded-ds-lg`）。
- **改动面**：`src/hooks/{useDismissableLayer(新),useCloseOnEscape}`、`src/design-system/overlays.tsx`、
  `features/assetLibrary/{AssetLibraryToolbar,FilterControlStrip}`、
  `features/strategy/{SopTextEditor,SopManagementCenter}`、
  `components/{InputBar,SettingsModal,ImageContextMenu,AgentWorkspace,AgentBatchPlannerModal}`、
  `design-system/tangbao/{MASTER,COMPONENTS}.md`。
- **验收证据**：`tsc -b` + `tsc -p electron/tsconfig.json --noEmit` 零错；`eslint .` 与 `prettier --check`
  通过；定向测试分两批全绿 —— `hooks`+`features/strategy`+`features/assetLibrary`+`design-system`
  **68 文件 / 1035 例**，`components` **16 文件 / 98 例**（含新增 4 例与 compliance 基线）。
  ⚠️ **未跑全量 `verify`**：工作区混着另一条写线（TB-082~084）的未提交改动，绿/红都不可信。
- **明确不做（作为规则登记，非遗漏）**：右键菜单保持「点任意处 / 滚轮关闭」不加遮罩；
  tooltip / 悬停预览不做点击关闭；遮罩编辑画布（`MaskEditorModal`）刻意不响应点空白（防误关丢未保存
  改动）；破坏性操作执行中（删除、提交）忽略关闭请求。
- **遗留（单开一轮）**：`useCloseOnEscape`（window 栈）与 `overlayManager`（document 栈）**两套 Esc 栈
  尚未合并**。本轮统一的是"谁能关"，"谁先关"在极端嵌套下仍靠 `stopPropagation` 补丁维系
  （`Select.tsx`、`GallerySopBatchModal` 的提示词库菜单）。合并要动所有手写弹窗，需要一轮完整回归。
