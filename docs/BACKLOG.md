# 糖包 需求池（BACKLOG）

> **本文件是唯一的需求池。** 回答"现在在做什么、卡在哪"。
> 目标与里程碑见 `docs/ROADMAP.md`。风险见 `docs/RISK.md`。

## 在途（WIP ≤ 2）

| ID | 事项 | 状态 | 写线 | 开始 |
| --- | --- | --- | --- | --- |
| TB-014 | 后处理按图片归属自动匹配参数 | DOING | 主写线 | 2026-09-18 |
| TB-015 | 水印预设升为顶栏 tab，归属与参数分离 | DOING | 主写线 | 2026-09-18 |

> ⚠️ **在途超过 2 条即视为并行**。这个项目的 dev（41731 端口 + 单实例锁 + leveldb 独占）
> 是排他资源，并行必须用 `git worktree` + 独立端口/userData 物理隔离，见 `docs/work-protocol.md`。

## 状态定义（只用这 5 个）

| 状态 | 含义 | 附加要求 |
| --- | --- | --- |
| `TODO` | 已记录，未开工 | 验收标准必须已写清 |
| `DOING` | 正在做 | 必须写"写线"（哪条会话 / 哪个 worktree） |
| `BLOCKED` | 卡住 | 必须写"等谁 / 等什么" |
| `DONE` | 已完成 | 必须有**验收证据**（commit / 测试数 / 实测数字） |
| `DROPPED` | 决定不做 | 必须写原因，并指向对应 ADR |

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

  | 指标 | 覆盖率 |
  | --- | --- |
  | Statements | **60.16%**（23488/39040） |
  | Branches | **52.65%**（16009/30404） |
  | Functions | **57.87%**（5478/9465） |
  | Lines | **62.47%**（20649/33052） |

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
- **状态**：TODO · 阻塞：**等杰哥确认**
- **内容**：`getContentEditablePlainText`(3→1)、`getPathBaseName`(2→1)、
  `isRecordValue`+`getStringValue`(3→1)、`getStorage`(3→1)、`escapeRegExp`(3→1)、
  `clamp`(3→1)、`isRecord`(2→1)、`isDataUrl`(2→1)、`getDataUrlDecodedByteSize`(2→1)
- **明确不做**：路径净化 4 份（前三份已共享内核、第四份**刻意不合并**）、`escapeHtml` 3 份（字符集/用途不同）、
  `formatDate` 4 份（入参与格式各异）
- **验收标准**：`npm run verify` 全绿；每组合并都补或改对应单测

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
- **② 已完成内容（InputBar 链路 + `{{xxx}}` 按选项 a 彻底移除）**
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
