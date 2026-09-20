# 糖包 需求池（BACKLOG）

> **本文件是唯一的需求池。** 回答"现在在做什么、卡在哪"。
> 目标与里程碑见 `docs/ROADMAP.md`。风险见 `docs/RISK.md`。

## 在途（WIP ≤ 2）

| ID     | 事项                                 | 状态  | 写线   | 开始       |
| ------ | ------------------------------------ | ----- | ------ | ---------- |
| TB-014 | 后处理按图片归属自动匹配参数         | DOING | 主写线 | 2026-09-18 |
| TB-015 | 水印预设升为顶栏 tab，归属与参数分离 | DOING | 主写线 | 2026-09-18 |

> ⚠️ **在途超过 2 条即视为并行**。这个项目的 dev（41731 端口 + 单实例锁 + leveldb 独占）
> 是排他资源，并行必须用 `git worktree` + 独立端口/userData 物理隔离，见 `docs/work-protocol.md`。

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
