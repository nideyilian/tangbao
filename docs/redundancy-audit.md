# 糖包 冗余功能体检报告

> 范围：`src/` + `electron/`，聚焦「被新方案替代但旧代码仍留在仓库里」的历史遗留。
> 方法：四路并行静态调研 + 逐项**独立复核引用计数**（不采信单一来源结论）。
> 基线：`db7d6f0`（2026-09-18）。**本报告只做分析，未删除任何文件。**
> 所有结论均附 `文件:行号` 或引用计数；不确定的明确标注。

---

## 结论先行

**你的判断是对的，但方向和你想的不完全一样。**

1. **真正的冗余不是"散落的小功能没清理"，而是三块完整的工作区被屏蔽后整棵留在了代码里。**
   根因是一行注释：`src/App.tsx:31` / `src/components/Header.tsx:24` 说明 **strategy 工作区已屏蔽** ——
   但它的**编辑界面子树**（策略编辑器 + 下单界面）还在，合计 **4479 行**。
   而且这棵子树的根 `requirementPrototype/AppShell.tsx` **零引用**（我实测 0 处）。

2. **你点名的「词条库」：代码确实是活的，但业务上已由你判定为不需要。**
   静态分析只能看到它还在跑（侧栏常驻 `App.tsx:470-471`、数据在读写），**看不到"业务是否还需要"** ——
   这一条只能由你判断。经补查：**SOP 变量链路与词条库零耦合**（`variablePrompt.ts:48-137` 只解析正文），
   下线**不影响 SOP**；唯一会断的是输入框手打 `{{xxx}}` 旁路。完整方案见 **第五节 D 档**。

3. **总冗余量约 8500 行**（含词条库下线），分四档：立即可删 ~5470 行、可整合 ~200 行、
   兼容残留 ~300 行、词条库下线 ~2500 行（含改造）。

**我的建议：分 5 批做，每批独立跑 `npm run verify`。**

---

## 一、总量盘点

| 档    | 内容                                                  | 规模                   | 风险                                   | 是否需你确认     |
| ----- | ----------------------------------------------------- | ---------------------- | -------------------------------------- | ---------------- |
| **A** | 零引用文件 + 无引用孤岛子树                           | **~5470 行 / 25 文件** | **低**（tsc + 2535 用例可验证）        | 是（涉及删文件） |
| **B** | 真重复实现（可合并）                                  | ~200 行                | 低                                     | 否               |
| **C** | 兼容残留（数据保留、入口已删）                        | ~300 行                | 中（动数据字段）                       | 是               |
| **D** | 词条库**彻底下线**（业务上已被 SOP 替代，杰哥已拍板） | ~2500 行（含改造）     | 中（一个坑：侧栏同时装着素材详情面板） | 已拍板，待执行   |

---

## 二、A 档 —— 确凿死代码（建议删除）

### A1. 一整棵孤岛：策略编辑 + 下单工作区（4479 行）

**证据链（引用计数均排除 test 文件）**

```
AppShell.tsx                      ← 0 处引用（孤岛根）
├─ RequirementStrategyWorkspace   ← 1 处（仅 AppShell:21）
│  ├─ StrategyEditor              ← 2 处（RequirementStrategyWorkspace:15、strategy/index.ts:3）
│  │  ├─ StrategyGrid             ← 4 处（全部在孤岛内）
│  │  ├─ StrategyTree             ← 3 处（全部在孤岛内）
│  │  └─ SopPresetPickerModal     ← 1 处（仅 StrategyEditor:27）
│  └─ StoreStrategyImage          ← 1 处（仅 RequirementStrategyWorkspace:19）
└─ RequirementOrderingWorkspace   ← 1 处（仅 AppShell:25）
   ├─ OrderingCreate              ← 3 处（全部在孤岛内）
   └─ OrderingHistory             ← 3 处（全部在孤岛内）
```

| 文件                                                              | 行数     | 引用（生产）                      |
| ----------------------------------------------------------------- | -------- | --------------------------------- |
| `src/features/requirementPrototype/AppShell.tsx`                  | 830      | **0**                             |
| `src/features/strategy/StrategyEditor.tsx`                        | 804      | 2（均在孤岛内）                   |
| `src/features/strategy/StrategyGrid.tsx`                          | 631      | 4（均在孤岛内）                   |
| `src/features/strategy/adapters/RequirementStrategyWorkspace.tsx` | 593      | 1（AppShell）                     |
| `src/features/strategy/SopPresetPickerModal.tsx`                  | 450      | 1（StrategyEditor）               |
| `src/features/ordering/OrderingCreate.tsx`                        | 425      | 3（均在孤岛内）                   |
| `src/features/strategy/StrategyTree.tsx`                          | 304      | 3（均在孤岛内）                   |
| `src/features/ordering/OrderingHistory.tsx`                       | 252      | 3（均在孤岛内）                   |
| `src/features/ordering/adapters/RequirementOrderingWorkspace.tsx` | 155      | 1（AppShell）                     |
| `src/features/strategy/adapters/StoreStrategyImage.tsx`           | 35       | 1（RequirementStrategyWorkspace） |
| **合计**                                                          | **4479** |                                   |

**⚠️ 精确保留（这几份在这棵子树里，但被活代码引用，不能连坐删）**

| 文件                                 | 被谁引用（活代码）                                            |
| ------------------------------------ | ------------------------------------------------------------- |
| `src/features/strategy/model.ts`     | `requirementPrototype/store.ts:15`                            |
| `src/features/strategy/contracts.ts` | `strategy/model.ts:14`（传递依赖，须保留）                    |
| `src/features/ordering/planner.ts`   | `requirementPrototype/planner.ts:1-6` re-export、`store.ts:5` |
| `src/features/ordering/types.ts`     | 同上                                                          |

**判据补充**：`AppMode` 类型里的 `strategy` / `ordering` 两个取值（`src/types.ts:11`）**UI 无入口**
（`Header.tsx:25-29` 只暴露 `gallery` / `postprocess` / `agent`），`setAppMode` 里还留着
"保留原值不改写"的专门分支（`store.ts:3407`）。也就是说：**这两个工作区在 UI 上已经不存在了。**

**删除前置条件（缺一不可）**

1. `src/design-system/catalog.ts` 里对上述组件的字符串登记要一并删除
   （如 `catalog.ts:1037` 的 ordering 条目、`catalog.ts:1083` 的 AppShell 条目 —— 否则
   `compliance.test.ts` 会红）。
2. `AppMode` 若同时收敛掉 `strategy` / `ordering` 两个值，必须同步改
   `src/store.ts:2293-2295`（已有归一化丢弃逻辑）与 `setAppMode` 分支（`store.ts:3407`）。
3. 删完必须跑 `npm run verify`（tsc 会抓住所有遗漏的引用）。
4. 相关测试文件（`page-coverage-regression.test.tsx:39` 引用了 AppShell）要一并处理。

**建议顺序**：先删**叶子**（StrategyGrid / StrategyTree / SopPresetPickerModal / StoreStrategyImage /
OrderingCreate / OrderingHistory），再删中间层（StrategyEditor / RequirementStrategyWorkspace /
RequirementOrderingWorkspace），最后删根（AppShell）。
**反过来做会一次炸出几十个编译错误，分不清是"待删文件的错"还是"待改文件的错"**
（这个教训 `2026-09-18.md` 第七节已记录过一次）。

### A2. 零引用文件（992 行）

| 文件                                               | 行数    | 生产引用 | 测试引用 | 说明                                                              |
| -------------------------------------------------- | ------- | -------- | -------- | ----------------------------------------------------------------- |
| `src/components/TaskGrid.tsx`                      | **516** | **0**    | 0        | 旧画廊任务网格（`PRODUCT.md` M10 说旧画廊已不再挂载路由）         |
| `src/components/SupportPromptModal.tsx`            | 120     | **0**    | 0        | 仅 `catalog.ts:735` 字符串登记 + `compliance.test.ts:103` 白名单  |
| `src/lib/migrations/legacyTagsToCollections.ts`    | 116     | **0**    | 1        | 标签体系已下线（M18），**迁移入口未注册**（`store.ts` 未 import） |
| `src/components/SearchBar.tsx`                     | 95      | **0**    | 0        | 仅 `catalog.ts:699` 字符串登记                                    |
| `src/features/assistantActions/wordEntryGroups.ts` | 51      | **0**    | 1        | 仅自身 test 引用                                                  |
| `src/lib/assetDerivation.ts`                       | 41      | **0**    | 1        | 仅自身 test 引用                                                  |
| `src/components/WordLibrarySidebarToggle.tsx`      | 27      | **0**    | 0        | 仅 `catalog.ts:819` 字符串登记                                    |
| `src/lib/collectionPath.ts`                        | 26      | **0**    | 1        | 仅自身 test 引用                                                  |
| **合计**                                           | **992** |          |          |                                                                   |

**⚠️ 更正一条过期线索**：`components/GalleryTaskNavigator.tsx` 在本报告中不再出现 ——
它**已经删掉了**（grep 零结果，`PRODUCT.md` M15 记录过）。这说明之前确实做过一轮清理。

**⚠️ `AssistantActionBar.tsx` 的判定要更正**：它自身零引用，但它所属的
`features/assistantActions/` **不是死 feature** —— `builtInActions.ts`（3 处生产引用）、
`matcher.ts`（3 处）、`runner.ts`（2 处）**都是活的**（被 `lib/apiProfiles.ts` 等引用）。
**只删 `AssistantActionBar.tsx` 这一个组件，不要整目录删。**

---

## 三、B 档 —— 重复实现（建议整合）

| 组  | 函数                               | 出现位置                                                                                                                                                                                   | 语义                                       | 可合并                             |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------- |
| 1   | `getContentEditablePlainText`      | `components/InputBar.tsx:365`、`components/PromptVariableEditor.tsx:28`（**逐字节一致**）、`components/WordLibrarySidebar.tsx:96-110`（内联第三份）                                        | 相同                                       | ✅ **强**（抽到 `lib/`，三处共用） |
| 2   | `getPathBaseName`                  | `lib/downloadImages.ts:331`、`lib/generatedImageBatch.ts:110`                                                                                                                              | **逐字相同**                               | ✅ 强                              |
| 3   | `isRecordValue` + `getStringValue` | `lib/agentApi.ts:283/287`、`lib/agentWebSearch.ts:14/18`、`lib/openaiCompatibleImageApi.ts:109/113`                                                                                        | 同源拷贝                                   | ✅ 强                              |
| 4   | `getStorage`                       | `features/strategy/sopAiRevision.ts:57`、`lib/agentBatchQueue.ts:49`、`lib/agentBatchWorkspace.ts:38`                                                                                      | 相同                                       | ✅ 强                              |
| 5   | `escapeRegExp`                     | `features/strategy/variablePromptMeta.ts:98`、`lib/generatedImageFilename.ts:172`、`lib/localSave.ts:626`                                                                                  | 相同                                       | ✅ 强                              |
| 6   | `clamp`                            | `components/Lightbox.tsx:19`、`features/assetLibrary/AssetViewer.tsx:26`、`lib/viewportTransform.ts:27`                                                                                    | 相同（纯数值）                             | ✅ 强                              |
| 7   | `isRecord`                         | `lib/apiProfiles.ts:196`、`store.ts:2860`                                                                                                                                                  | 相同                                       | ✅ 强                              |
| 8   | `isDataUrl`                        | `lib/agentRequestImages.ts:18`、`lib/imageApiShared.ts:44`                                                                                                                                 | 相同                                       | ✅ 强                              |
| 9   | `getDataUrlDecodedByteSize`        | `lib/imageApiShared.ts:60`、`lib/sopReferenceImageCompression.ts:18`                                                                                                                       | 相同                                       | ✅ 强                              |
| 10  | `normalizeStringArray`             | `features/assistantActions/runner.ts:613`、`lib/apiProfiles.ts:188`、`lib/assetLibraryModel.ts:50`、`store.ts:1636`                                                                        | **各异**（trim / fallback / 类型守卫不同） | ⚠️ 部分                            |
| 11  | `formatDate`                       | `components/LegacyDataImportModal.tsx:30`、`features/assetLibrary/CollectionInfoModal.tsx:22`、`features/ordering/OrderingHistory.tsx:19`、`features/requirementPrototype/AppShell.tsx:35` | **各异**（入参与格式不同）                 | ❌ 不建议                          |

**注意**：`formatDate` 的两处（#11）在 A 档删除后会自然少两处。

### 已确认**不该合并**的（避免重复劳动）

- **路径/文件名净化 4 份**：`sanitizeFolderName`(`lib/localSave.ts:550`)、
  `sanitizePathPart`(`lib/agentBatchPlanner.ts:87`)、`sanitizeFileNamePart`(`lib/downloadImages.ts:381`)、
  `sanitizeGeneratedImageFilenamePart`(`lib/generatedImageFilename.ts:15`) —— 前三份已共享内核
  `sanitizeFileNameCore`(`lib/sanitizeFileName.ts:26`)，差异只在截断长度与兜底；
  第四份**先压空白再剥非法字符**（顺序相反，避免 `\n` 变 `-`），**有测试断言依赖，刻意不合并**
  （`lib/sanitizeFileName.ts:4-15` 有注释说明）。
- **`escapeHtml`**：InputBar 那份**已经删掉了**（`InputBar.tsx:386-391` 注释记录了这次清理）；
  现存 3 份字符集与用途不同（XML / HTML Text / HTML Attribute / XML Attribute），可抽但收益低。
- **`dataUrlToBlob`**：已合并到 `lib/blobDataUrl.ts:39`，`canvasImage.ts:75` 只是 re-export。

---

## 四、C 档 —— 兼容残留（数据保留、入口已删）

### C1. 标签体系（M18 已下线）

| 项                  | 位置                                                                | 状态                                           |
| ------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| 类型 / 字段         | `types.ts:1153`（`AssetTag`）、`types.ts:997`（`tagIds`）           | 保留（备份无损恢复用）                         |
| tag actions（7 个） | `features/assetLibrary/store.ts:1640/1673/1703/1746/1802/1820/1832` | **生产无调用**（仅 `store.test.ts:1287-1360`） |
| UI 组件             | `AssetLibraryTagSection.tsx`、`AssetTagChips.tsx`                   | **生产引用 0**（仅 catalog 登记 + test）       |
| 查询侧              | `features/assetLibrary/query.ts:94-97,258` 仍在读 `tagIds`          | 兼容保留                                       |
| 备份链路            | `store.ts:12374/12503/12920` 仍在读写                               | **必须保留**（否则老备份导入丢数据）           |

**建议**：删 UI 组件（`AssetLibraryTagSection.tsx` / `AssetTagChips.tsx`）+ 删 7 个无调用的 tag action；
**保留**类型与 `tagIds` 字段 + 备份链路（这是 PRODUCT.md M18 明确的设计意图）。

### C2. `galleryViewMode` + `TaskGrid`（一处**真正的隐患**）

- 写入方：`setGalleryViewMode` 只被 `TaskGrid.tsx:313` 调用 —— 而 `TaskGrid` **零引用**（A2）。
- 读取方：**`InputBar.tsx:768/3915/4115` 仍在读** ⚠️
- 持久化：经 `lib/galleryPreferences` 存 localStorage，不在 `getPersistedState`。

**这意味着：InputBar 在读一个「永远不会被更新」的字段。**
删除顺序必须是：**先摘掉 InputBar 的 3 处读取 → 再删字段与 setter → 最后删 TaskGrid**。
（先删 TaskGrid 会让字段彻底失去写入方，问题从"死字段"变成"静默常量"。）

### C3. 已无调用的 store action

| action                   | 定义            | 核实方式                                                        |
| ------------------------ | --------------- | --------------------------------------------------------------- |
| `stopTask`               | `store.ts:336`  | grep `\bstopTask\b`（src+electron+test）**仅定义处**，零引用    |
| `getAllOrphanedImageIds` | `store.ts:7675` | 仅同文件 `cleanupAllOrphanedImages:7617` 内部调用，无外部消费者 |
| tag 系列 7 个            | 见 C1           | 见 C1                                                           |

### C4. 双真相源（该整合，但**不要现在做**）

| #   | 两处                                                                                             | 桥接方式                                                      | 备注                                |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------- |
| 1   | `favoriteCollections`（`store.ts:2220`）vs `collections`（`features/assetLibrary/store.ts:77`）  | 一次性迁移 `store.ts:5567-5571` + 两处读取 `store.ts:552/877` | 与 `BACKLOG` 的 `TB-023` 是同一件事 |
| 2   | `workspaceTabs[]._taskIds`（localStorage `store.ts:2242`）vs IDB `tab.tasks`（`putTask:5010`）   | 启动水合                                                      | 任务归属兼容                        |
| 3   | `viewStyle` vs `groupBy`/`groupedViewStyle`（`store.ts:2057` / `:2069-2070`）                    | migrate 入参                                                  | 旧新 schema 同 store 并存           |
| 4   | 词条库：zustand persist（`store.ts:2226-2232`）vs IDB `STORE_WORD_LIBRARY`（`db.ts:40,668-683`） | 双写                                                          | 见 D 档                             |

**⚠️ 更正**：`docs/project-health-audit.md:168` 说双真相源靠 `src/store.ts:487` 桥接 ——
**该行号已过期**（现在 `:487` 是 `formatLocalSaveBatchFolder`）。实际桥接在 `store.ts:552/877/5567`。

### C5. `@deprecated` 标记

| 项                                       | 位置                 | 能否清                                                        |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------- |
| `ColorScheme`                            | `types.ts:16`        | ❌ **不能删** —— 仍被 `design-system/skin.tsx:5` 引用（3 处） |
| `normalizeColorScheme` / `COLOR_SCHEMES` | `lib/theme.ts:19,22` | 需先确认无生产调用（标**不确定**）                            |

---

## 五、D 档 —— 词条库：**已确认彻底下线**（2026-09-18 杰哥拍板）

### 事实：代码确实是活的（这部分结论不变）

**词条库不是死代码，它还活着**：

| 事实             | 证据                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有常驻入口       | `App.tsx:470` 挂 `WordLibrarySidebar`（`appMode` 为 gallery/agent 时）、`:471` 挂管理弹窗；桌面端侧栏默认常驻（`WordLibrarySidebar.tsx:70` 无值时返回 `'right'`）     |
| 数据在读写       | `wordLibrary` IDB store（`db.ts:40`），经 `replaceStoredWordLibrary`（`store.ts:2965`）全量写；读方 `InputBar.tsx:773-843/1888/1925/4896`                             |
| 有**独有**职责   | ① 一个 key 对多候选值的**候选池**；② 回收站；③ `{{变量}}` 的**色彩映射**（`InputBar.tsx:840`）；④ **划词自动建词条**（`InputBar.tsx:1925-1947`）；⑤ AI 衍生候选值面板 |
| 与 SOP 库的关系  | SOP 库管**整段提示词 / SOP 资产**；词条库管**变量候选值**。**两者不重叠，SOP 不覆盖它**                                                                               |
| 无任何"废弃"注释 | 全仓未发现"词条库已废弃/被替代"的说明                                                                                                                                 |

**唯一确凿的孤儿**：`WordLibrarySidebarToggle.tsx`（27 行，零引用，仅 catalog 登记）→ 属 A 档可删。

### 修正：初稿为什么判错了

初稿把「彻底下线」评为**不建议**，理由是"会把变量候选值这个真实需求一并删掉"。
**这个推理的前提是错的** —— 我把「代码是活的」当成了「业务还需要」。
静态分析能看到前者，**看不到后者**；这一条只能由产品负责人判断，你判断得对。

> **方法论教训**：这类盘点报告必须把「代码活性」与「业务需求」**分开列**，
> 并且**不替用户判断后者**。初稿替它判断了，于是错在结论上。

### 关键结论：SOP 与词条库**零耦合**，下线不影响 SOP

| 链路                     | 数据来源                                                                                | 依赖词条库        |
| ------------------------ | --------------------------------------------------------------------------------------- | ----------------- |
| SOP 变量解析             | `variablePrompt.ts:48-137` 的 `parseVariablePrompt`：从正文「可变项：」区块解析 options | ❌                |
| SOP 批量展开             | `variablePrompt.ts:228-235` 的 `renderVariablePromptBatch`                              | ❌                |
| SOP 生成                 | `storeSopGeneration.ts:615/651/660` 全程只用模板本身                                    | ❌                |
| 变量元信息 / 策略        | `variablePromptMeta.ts:33-96`、`variablePromptTextPolicy.ts:16`、`elementPool.ts:64-93` | ❌ 只解析正文     |
| **输入框手打 `{{xxx}}`** | `promptImageMentions.ts:307-310` → 词条 `entries` 随机取值（源 `store.ts:9835-9836`）   | ✅ **唯一依赖点** |

**删掉词条库，SOP 的批量变量展开完全不受影响。**

### 唯一会断的地方 —— 需要你选处理方式

`{{xxx}}` 手打旁路：取值失败会走 `?? marker`（`promptImageMentions.ts:303,309`）
→ **不崩，但 `{{xxx}}` 会原样发给模型**（哑变量）。

| 选项  | 行为                                             | 适用场景              |
| ----- | ------------------------------------------------ | --------------------- |
| **a** | **彻底移除该语法**：`{{xxx}}` 当普通文本         | 你完全不再手打 `{{}}` |
| b     | 保留解析但无候选值：原样发送（= 现状的降级行为） | 偶尔还会用到          |
| c     | 保留并在 UI 提示「该语法已废弃」                 | 想给旧习惯一个过渡期  |

### ⚠️ 一个容易出事的点（必须**改造**而非删除）

`src/App.tsx:470` 挂的 `WordLibrarySidebar` **同时承载素材详情面板 `AssetDetailPanel`**
（`WordLibrarySidebar.tsx:530-536`）。
**直接删这个组件会连带删掉素材详情侧栏** —— 这是本次下线最大的坑。
→ 正确做法：**只摘「词条」Tab 与相关逻辑，保留壳与素材详情**。

### 会一并丢失的能力（请你确认可接受）

**划词一键建词条**（`InputBar.tsx:1925-1947`）：划选文字 → 按 key 建词条 → 插入带 entryId 的标记。
SOP 体系**没有等价交互**（只能在模板内用 `replaceVariableOptions`（`variablePromptMeta.ts:78-96`）
或 AI 扩词条（`storeSopGeneration.ts:637-644`）管理选项）。

> 如果你其实用得上这个交互，那就不是「整块下线」而是「只下线候选池 UI」。

### 数据策略：**删功能、保留字段**（成本最低）

| 项                                                                    | 处置     | 理由                                                                       |
| --------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| IDB `wordLibrary` store（`db.ts:667-673`）                            | **保留** | 老备份恢复要用                                                             |
| `types.ts:1270-1272` 的 `ExportData` 字段                             | **保留** | 备份 manifest v7（`store.ts:12468`）导出三字段、导入合并（`:12977-13047`） |
| `legacyDataTransfer.ts:32/47-55/119/131`                              | **保留** | 迁移链路                                                                   |
| store 的 `wordLibrary*` 持久化（`store.ts:2693-2755/2226-2232/2965`） | **保留** | 同上                                                                       |
| 纯 UI 专用 action 与类型                                              | 删除     | 无消费者（见下方执行清单）                                                 |

**「删功能、保留字段」不破坏备份导入与老数据恢复** ✓

### 下线执行清单（按风险从低到高）

| #   | 文件                                                                                                                                 | 改动                                                          | 风险   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------ |
| 1   | `WordLibrarySidebarToggle.tsx`(27 行)                                                                                                | 删除（已零引用）                                              | 低     |
| 2   | `WordLibraryQuickPanel.tsx`(328) / `WordLibraryDerivativePanel.tsx`(409) / `WordLibraryManagerModal.tsx`(965) / `VarEntryEditor.tsx` | 删除                                                          | 低     |
| 3   | `WordLibrarySidebar.tsx`                                                                                                             | **改造**：摘「词条」Tab 与自动补建，保留壳 + AssetDetailPanel | **高** |
| 4   | `InputBar.tsx` 五处：`:773-779` 订阅 / `:840-843` 色标 / `:1888` 归一化 / `:1925-1947` 划词建词条 / `:4896-4925` 编辑器入口          | 摘除                                                          | 中     |
| 5   | `PromptVariableEditor.tsx:199-205`、`DetailModal.tsx:108-110`、`promptVariableColors.ts` 的词条色标                                  | 摘除                                                          | 中     |
| 6   | `promptImageMentions.ts:303,309` + `store.ts:9835`                                                                                   | 按上表选项 a / b / c 处理                                     | 中     |
| 7   | `App.tsx:22-23`（ManagerModal 挂载）；`:470-471` 保留 Sidebar 壳                                                                     | 删除挂载                                                      | **高** |
| 8   | `WordLibrary*.test`、`store.test.ts:106-107/374-448/3116-3593`、`PromptVariableEditor.test`                                          | 删或改写                                                      | 低     |
| 9   | `design-system/catalog.ts` 的相关登记                                                                                                | 同步删                                                        | 低     |

---

## 六、执行建议（分批 + 顺序 + 验证）

**原则：每批独立可验证、可回滚。做完一批跑一次 `npm run verify`，再进下一批。**

| 批          | 内容                                                     | 预估     | 风险                                          |
| ----------- | -------------------------------------------------------- | -------- | --------------------------------------------- |
| **第 1 批** | A2 零引用文件（992 行）—— 最安全，纯删除                 | 1 小时   | 低                                            |
| **第 2 批** | B 档 9 组重复实现合并                                    | 2 小时   | 低                                            |
| **第 3 批** | A1 孤岛（4479 行）—— **从叶子删到根**                    | 3–4 小时 | 中（需同步改 catalog.ts）                     |
| **第 4 批** | C1/C2/C3 兼容残留（标签 UI、galleryViewMode、死 action） | 2 小时   | 中（涉及数据字段）                            |
| **第 5 批** | D 档词条库下线（按 §5 清单，从低风险到高风险逐项做）     | 1 天     | 中（`WordLibrarySidebar` **必须改造不能删**） |

**共性前置条件**

1. 删除前**必须备份**：`git status` 干净（当前 ✓）+ 一个可回滚的 commit。
2. `src/design-system/catalog.ts` 的 `legacyComponentCoverage` 登记要同步删，否则 `compliance.test.ts` 会红。
3. 每次删除后跑 `npm run verify`（tsc 是最快的"漏引用"探测器）。
4. **禁用 `git rm`**（项目铁律，曾导致 `src/` 576 文件消失）→ 用 `rm` + `git add -u`。
5. 建议**单独开一个 commit 一次删除**，不与其他改动混在一起（便于整体 revert）。

---

## 七、本报告修正的三条过期认知（避免你被旧文档误导）

| 旧说法                             | 现状                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| 「文件名净化有 6 份」              | 实际 **4 份**，且三份已共享内核，第四份**刻意不合并** |
| 「`escapeHtml` 有 4 份」           | InputBar 那份**已删**，现存 3 份用途不同              |
| 「双真相源靠 `store.ts:487` 桥接」 | 行号**已过期**，实际在 `store.ts:552/877/5567`        |
| 「`GalleryTaskNavigator` 待清理」  | **已删**                                              |

> 这四条来自 `docs/` 与旧记忆里的描述，说明**旧审计文档本身也需要生命周期标记**（见 `BACKLOG` 的 `TB-028`）。

---

## 已知限制

- 引用计数基于 `from '.../Name'` 的静态 grep，**未覆盖动态 import 与字符串拼接路径**（如
  `catalog.ts` 里的 `module: '...'` 字符串登记不算运行时引用，已在文中区分）。
- 未做运行时验证（本次全程只读，未启动应用）。
- `theme.ts:19,22` 的 `normalizeColorScheme` / `COLOR_SCHEMES` 是否有生产调用**未核实完**，标「不确定」。
- **D 档已由杰哥拍板：词条库彻底下线**（初稿把它评为"不建议下线"是错的 ——
  原因见 §5「修正：初稿为什么判错了」）。仍需你确认的是 **§5 里"手打 `{{xxx}}` 怎么办"的 a/b/c 三选一**。
