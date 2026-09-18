# 后处理统一到「瀚灵编排」方案（水印预设保留）

> 2026-09-18 杰哥提出：「我原来的后处理方案不如参考项目的后处理方便，希望直接采用参考项目的方式，
> 仅保留我的后处理中的水印预设，并跟新方案结合。」
>
> 本文件给出可行性判断、风险清单与实施步骤。**阶段 1-3 已完成并全量验证**（手动入口 + 多水印 +
> 分发移植、水印编辑器独立化、A 套编排退役，见第八节的进度表）；阶段 4（数据迁移）待开工，
> 且实测范围比原计划小。

---

## 一、结论

**可行，方向正确，但不能直接删旧方案——必须先补一个能力。**

拆开来看，这句话包含三件事，难度差别很大：

| 诉求                   | 现状                                           | 判断                                 |
| ---------------------- | ---------------------------------------------- | ------------------------------------ |
| 采用参考项目的编排方式 | **数据层与执行层已经做完了**（复刻四阶段完成） | 只剩 UI 与旧方案退役                 |
| 保留水印预设           | 数据层已结合（新链路引用 `CompositeV2Preset`） | 只剩「编辑入口从旧工作区里解放出来」 |
| 与新方案结合           | 已结合，但存在**三处覆盖源打架**               | 这才是「不方便」的真正根因，必须收敛 |

**必须先补的能力**：新链路（下称 B 套）只有「生成完成后自动跑」一个触发点
（`src/store.ts:855`），**没有「对已有素材手动跑」的入口**。而旧方案（下称 A 套）的素材来源恰恰是
「从素材库选一批历史素材 + 本地文件夹」（`BatchExportTab.tsx:718-731`）。
直接删 A 套 = 失去对历史素材补跑的能力。**这是替换的前置条件，不是可选项。**

---

## 二、现状：A 套 / B 套的职责与重叠

### A 套 = 糖包原有「后期处理工作区」（`CompositeWorkspace.tsx:6-71`，挂载于 `App.tsx:487`）

- **Tab 1 批量导出**：四步向导 `① 素材 → ② 预设与规则 → ③ 分配 → ④ 导出`（`BatchExportTab.tsx:260-270`）
  - 素材：素材库多选（`AssetPickerModal`）+ 本地文件夹
  - 预设与规则：勾选预设组/预设（**可多个**）、全局渠道尺寸规则 `outputRuleGroups`、分发设置 `distributionConfig`
  - 导出：队列（`compositeExportQueue.ts`）、历史（`compositeExportHistoryV2.ts`）、结果面板
- **Tab 2 预设管理**：预设组 → 预设库 → 预设详情
  - 水印本体：基准尺寸 + 画布编辑器 `PresetCanvasEditor` + 图层面板 `PresetLayerPanel`
  - **编排污染**：命名/输出目录 `PresetNamingFields`（`:751`）、预设级渠道尺寸覆盖 `outputRuleGroupsOverride`（`:773-935`）

### B 套 = 复刻瀚灵的「后处理」（`PostprocessSettingsModal.tsx`，入口在输入栏胶囊）

- 媒体表：渠道 × 尺寸 × 体积上限（`src/lib/postprocessMedia.ts`）
- 项目树参数：每个方向节点覆盖媒体/水印/命名/目录/开关（`src/features/projectTree/`）
- 触发：生成完成后自动跑（`src/store.ts:855`），按图片归属方向自动取参数
- 纯净版自动伴随 + 原图迭代（`rawImageId`）

### 重叠度：B 套已完整覆盖 A 套的编排职能

| 维度         | A 套                                                        | B 套                                                  |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| 渠道 × 尺寸  | `CompositeV2OutputSizeRule`（`compositeV2Types.ts:99-108`） | `PostprocessMediaSize`（`postprocessMedia.ts:17-24`） |
| 体积上限     | `maxSizeKb`（同上）                                         | `maxSizeKb`（`0` = 不压缩）                           |
| 覆盖粒度     | 预设级 `outputRuleGroupsOverride`                           | **方向级**（项目树参数逐级继承），更贴合业务          |
| 产出目标选择 | 每次手工勾选预设组                                          | 图片归属方向自动匹配 + 勾选范围控制启用               |
| 纯净版       | 有                                                          | 有（自动伴随）                                        |
| 原图迭代     | 有                                                          | 有（变体不写入 `outputImages`）                       |

**B 套多出**：三级参数继承、方向自动匹配、`{seq}` 跨源图连续、媒体→尺寸两级结构。
**A 套独有**：① 对已有素材的手动批量入口；② 多预设并行（一图多水印）；③ 分发（日期重命名/周末跳过/按天分目录）。

---

## 三、「不方便」的根因：三处覆盖源

尺寸 / 体积 / 目录 / 命名这件事，现在能在**三个地方**配：

```
① A 套全局渠道规则      outputRuleGroups        （GlobalOutputRulesPanel）
② A 套预设级覆盖        outputRuleGroupsOverride（PresetManagementTab.tsx:773-935）
③ B 套媒体表 + 方向参数  media / PostprocessNodeOverride
```

命名与输出目录同样有两处：

```
① CompositeV2Preset.outputRootPath / filenameTemplate / namingTemplate（预设级）
② PostprocessMediaConfig.outputDir / namePattern（全局级）+ 方向级覆盖
```

**证据**：`PostprocessSettingsModal.tsx:362` 已经写了一句话来调和冲突——
「这里的输出位置与命名模板只作用于后处理产物，优先于水印预设里的同名设置」。
**需要写这种文案，就说明模型有问题。** 收敛成一处后这句话可以删掉。

---

## 四、调整方案：职责重新划分

**核心思路：A 套从「编排者」降级为「水印素材库提供者」。**

### 保留（A 套的不可替代部分）

| 内容                                                                                             | 理由                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `PresetCanvasEditor` / `PresetLayerPanel`                                                        | 图层式水印编辑，瀚灵只有单张水印图                |
| `compositeRendererV2` / `compositeRenderPlan` / `compositeTextLayout` / `renderWithMaxKb`        | B 套渲染链正在调用（`taskPostprocess.ts:30,305`） |
| `compositeAssets` / `compositeBackgrounds` / `compositePresetLibrary` / `compositeExportRuntime` | 水印渲染的依赖底座                                |
| `CompositeV2Preset`（**剥掉编排字段**）                                                          | B 套按 id 引用（`taskPostprocess.ts:240-243`）    |

### 退役（A 套的编排）

- `BatchExportTab`（四步向导）、`DistributionSettingsPanel`、`GlobalOutputRulesPanel`、
  `ExportResultsPanel`、`ExportHistoryDetailModal`、`PresetNamingFields`
- `compositeDistribution.ts`、`compositeOutputRulesV2.ts`、`compositeExportHistoryV2.ts`、
  `compositeExportQueue.ts`、`compositeExportPlan.ts`、`compositePathTemplates.ts`
- 预设详情里的渠道尺寸覆盖面板（`PresetManagementTab.tsx:773-935`）
- `ExportStatusWatcher` / `PostprocessStatusBadge`（导出状态提醒，随编排一起退）
- `storeV2` 中属于编排的 state 切片

### 新增（补齐 B 套）

- **手动触发入口**：素材库选中若干素材 → 「跑后处理」，复用现有执行链路
  （`runTaskPostprocess` 的输入已经是 `imageIds + readSource + resolveImageCollectionId`，
  天然支持任意素材集合，不需要改执行体）
- **水印预设管理入口**：从 B 套面板的水印下拉、项目树参数弹窗可以直接进编辑器

---

## 五、可行性评估（逐项）

| 事项                         | 可行性 | 说明                                                                |
| ---------------------------- | ------ | ------------------------------------------------------------------- |
| B 套编排承担全部输出         | ✅     | 已实现且已在跑，无需新建模型                                        |
| 水印预设编辑独立成面板       | ✅     | 组件边界清晰（画布+图层面板），只需换容器与去掉编排字段             |
| 手动触发复用现有执行体       | ✅     | `runTaskPostprocess` 输入面已经是通用集合，不用改编排               |
| A 套编排代码删除             | ⚠️     | 涉及约 20 个源文件 + 13 个测试文件，需分批删并逐批验证              |
| 一图多水印（A 套的多预设）   | ⚠️     | B 套 `watermarkPresetId` 是**单值**，要多套必须扩成数组（见待决策） |
| 分发能力（日期/周末/分目录） | ⚠️     | B 套无对应物，要么移植进 `postprocessRunner`，要么放弃（见待决策）  |
| 导出产物回流素材库           | ⚠️     | A 套有 `archiveExportsToLibrary` 开关，B 套产物只落盘               |

**无不可行项**，三个 ⚠️ 都是产品取舍，不是技术障碍。

---

## 六、需要注意的细节（风险清单）

1. **能力落差必须先补**：先做手动入口，再拆 A 套。顺序反了就是功能倒退。
2. **持久化是两套机制**：`storeV2` 走 **localStorage**（`tangbao-composite-v2-workspace-storage`），
   B 套走 **SQLite**（`app_data_records` 表，ns `postprocessMedia` / `projectTreeParams`）。
   删 `storeV2` 字段必须 **bump persist version + migrate 丢弃**，否则旧数据反序列化会把脏字段写回。
3. **备份链路联动**：`src/store.ts:12093` 的 `buildCompositeBackup` 依赖
   `getCompositeV2PersistedState` 与 `collectCompositeAssetIds`。改 storeV2 的持久化切片要同步这段，
   否则备份/恢复对不上（`ExportData.compositeAssetFiles`）。
4. **数据迁移可以做**：A 套 `outputRuleGroups`（渠道×尺寸×上限）本质就是 B 套的 `media` 表，
   可写一次性迁移映射；A 套 `CompositeV2Preset.outputRootPath` 可映射到 B 套 `outputDir`。
   **建议只在首次启动时迁移、且不覆盖用户已有的 B 套配置。**
5. **门禁连带**：
   - 删任何 `.tsx` 要同步 `src/design-system/catalog.ts` 的 `legacyComponentCoverage`，
     否则 `catalog.test.ts`（`import.meta.glob` 扫全量）必挂。
   - `compliance.test.ts` 统计覆盖面，删组件会改变统计基线，需一并复核。
6. **删除清单要过两道**（历史教训）：① grep import 引用；② grep **文件名字面量**——
   `readFileSync` + 文件名数组这类引用**不走 import**。分批删（每批 ≤8）并逐批校验文件数。
7. **`git rm` 禁用**（本仓库实测会连带删除大量文件）：一律 `rm` + `git add -A <路径>`。
8. **A 套的「导出成图归档到素材库」开关**（`BatchExportTab.tsx:1105`）需要明确去留：
   B 套产物目前只落盘，不进素材库。
9. **文案同步**：`PostprocessSettingsModal.tsx:362` 那句优先级说明、输入栏胶囊、面板预览区说明都要跟着改。
10. **AGENTS.md 要求「不留 TODO/stub；错误但完整优于正确但残缺」**：不能拆一半留个坏页面。

---

## 七、实施步骤（四阶段，每阶段可独立验证）

### 阶段 1｜补齐 B 套手动入口（前置，先有后拆）

- 素材库工具栏/右键菜单加「跑后处理」，作用于选中素材
- 从 `src/store.ts:855` 附近抽出可复用的执行函数，接受任意 `imageIds` 与归属解析器
- 复用既有幂等闸（`postprocessOutputs[].rawImageId`）与状态提示
- 验证：选中一批历史素材 → 产出落到各自方向目录、命名与体积符合方向参数

### 阶段 2｜水印预设编辑器独立化

- 新建独立面板，容纳「预设库 + 基准尺寸 + 画布编辑器 + 图层面板」
- 从预设详情移除：命名/输出目录、渠道尺寸覆盖面板
- `CompositeV2Preset` 剥掉编排字段（`outputRootPath` / `distributionPath` / `filenameTemplate` /
  `namingTemplate` / `customVariableValues` / `useOutputOverrides` / `outputRuleGroupsOverride`）
- 入口：B 套设置面板的水印下拉旁 + 项目树参数弹窗 → 「管理水印预设」
- 验证：预设画布编辑、图层能力与现在完全一致；B 套产出结果不变

### 阶段 3｜A 套编排退役

- 删组件与纯逻辑（按第六节第 6 条分批）
- `CompositeWorkspace` 收敛为「水印预设」单页
- `storeV2` 清理编排切片 + persist version bump + migrate
- 同步 `catalog.ts` / 测试文件
- 验证：`npm run verify` 全绿；水印预设编辑与 B 套产出链路完整

### 阶段 4｜数据迁移与收尾

- A 套 `outputRuleGroups` → B 套 `media` 表（首次启动，不覆盖已有）
- 清理 `docs/hanling-postprocess-replica-plan.md` 的状态、更新本文件
- 验证：老用户升级后编排配置不丢、不重复

---

## 八、决策结果（2026-09-18 杰哥拍板）

| 决策点             | 结论                      | 落地情况                                                               |
| ------------------ | ------------------------- | ---------------------------------------------------------------------- |
| 手动批量入口       | **保留**，用 B 套链路重做 | ✅ `store.ts` 的 `runManualPostprocess` + 素材库工具栏「跑后处理 (N)」 |
| 多水印预设         | **需要**，单值改数组      | ✅ `watermarkPresetIds: string[]`，展开单位加一维，`{preset}` token    |
| 分发能力           | **保留**，移植进后处理    | ✅ `src/lib/postprocessDistribution.ts` + 共用表单组件                 |
| 产物自动归档素材库 | **不要**                  | ✅ 未实现，产出只落盘                                                  |

### 进度

- **阶段 1（手动入口）**：✅ 完成并全量验证（244 文件 / 2506 测试）。
  顺带一并落地的还有上面三项决策 —— 它们与阶段 1 共用同一批数据模型改动
  （`watermarkPresetIds` 数组化会动 `PostprocessOutputUnit`，分发配置会动 `PostprocessMediaConfig`），
  拆成两次改反而要动两遍持久化迁移。
- **阶段 2（水印编辑器独立化）**：✅ 完成。
  - `CompositeWorkspace` 收敛为**预设编辑单页**：删掉「批量导出 / 预设管理」两个 tab 与导航，
    只渲染 `PresetManagementTab`（保留 Ctrl+Z 撤销栈）。
  - `CompositeV2Preset` 剥掉 **7 个编排字段**（`outputRootPath` / `distributionPath` /
    `filenameTemplate` / `namingTemplate` / `customVariableValues` / `useOutputOverrides` /
    `outputRuleGroupsOverride`），只剩 `id` / `name` / `baseCanvas` / `sampleBackgroundPath` /
    `layers` / `updatedAt`。连带删掉 `CompositeV2OutputSizeRule` / `CompositeV2OutputRuleGroup` /
    `CompositeV2CustomVariable` 与整套导出/分发/历史类型。
  - 预设详情删掉「输出与分配设置」（命名模板 + 变量编辑器 + 输出目录）与「覆盖全局渠道与尺寸规则」
    两大块，只留「基准尺寸」。
  - **新入口**：后处理设置面板「水印预设」标题右侧的「管理水印预设」→ 打开工作区；
    顶栏标签「后期处理」→「水印预设」；弹窗标题/描述同步。
- **阶段 3（A 套编排退役）**：✅ 完成。**净删 27 个文件**（组件 8 + 纯逻辑 7 + 测试 11 + 冗余类型测试 1），
  测试从 2506 降到 2424（删掉的都是编排用例，新增 2 个入口按钮用例）。
  阶段 2 + 3 合计 **54 文件、+338 / −8978 行**（净删 8.6k）；`npm run verify` 全绿：**233 文件 / 2424 测试**。
  - 组件：`BatchExportTab` / `ExportResultsPanel` / `DistributionSettingsPanel` / `GlobalOutputRulesPanel` /
    `ExportHistoryDetailModal` / `PresetNamingFields` / `ExportStatusWatcher` / `PostprocessStatusBadge`。
  - 纯逻辑：`compositeExportQueue` / `compositeExportPlan` / `compositeExportRuntime` / `compositePathTemplates` /
    `compositeOutputRulesV2` / `compositeDistribution` / `compositeExportHistoryV2`。
  - `storeV2` 只留预设编辑切片（logo / presets / presetGroups / backgrounds / 预览历史 / 撤销栈），
    persist **version 3 → 4**，`migrate` 改为**丢弃式**（不换算，直接丢编排字段），
    `merge` 去掉 distributionConfig 合并与 enabledPresetIds 校验。`App.tsx` / `Header.tsx` /
    `catalog.ts` / `compliance.test.ts` 引用同步。
- **入口语义修正**（退役的连带，容易漏）：素材右键的「发送到后期处理」与查看大图里的同名按钮，
  在 A 套时代表示「这批素材作为批量导出的背景」；编排退场后工作区不再消费「一批素材」，
  遂改为 **「用作水印预览底图」**（`openInPostprocess*` 协议名不变，只改语义与文案）。
  `setBackgrounds` 这条链**保留**——没有真实素材当底图，用户看不到水印叠上去的效果。
- **阶段 4（数据迁移）**：⏳ 未开始，且范围比原计划小：
  A 套 `outputRuleGroups` 的内置目录与 B 套 `DEFAULT_POSTPROCESS_MEDIA` **完全一致**
  （4 媒体 / 15 尺寸 / 相同体积上限），不需要映射；只有「用户改过的 A 套规则」才值得迁移。
  `CompositeV2Preset.outputRootPath → B 套 outputDir` 的映射同理：默认值都是空，改过的才有意义。

- **阶段 2 后续（水印归属树）**：✅ 完成（2026-09-18，杰哥提出「水印预设没有跟项目对应的树状结构」）。
  水印工作区左栏顶部新增 **「水印归属」树**（`features/composite/components/PresetProjectTree.tsx`）：
  产品线 → 产品 → 方向，每行显示该节点**生效**的水印与来源（`本级自定义` / `继承自「X」` / `跟随全局`
  / `不加水印` / `未启用` / `已失效 N`），可把预设从下方预设库**拖到节点上**绑定，也能用行内 `+`
  绑当前选中预设、chip 上的 `×` 解绑、「恢复继承」摘掉本级覆盖。
  - **不新增第二份数据**：绑定的落点就是项目树参数层的 `ProjectNodeOverride.watermarkPresetIds`，
    与节点「参数」弹窗同一份值、同一个 `setPostprocessOverride` 写入口。
  - `params.ts` 抽出共享的 `resolveProjectOverrideChain`（根→叶的覆盖链），
    `resolveProjectPostprocessSlice`（全字段合并）与新增的 `resolveNodeWatermarkBinding`（单字段查询）
    共用同一条链，避免两处遍历在「空对象算不算表态」「环怎么兜底」上分叉。
  - 继承态下第一次改动会**物化**成本级显式数组——直接写结果数组会把「少一个」表达成「一个都不要」。
  - 拖拽 MIME 常量统一到 `lib/compositePresetLibrary.ts`（原先两个组件各写一份字面量）。
  - ⚠️ 左栏当时是三段（树 / 预设组 / 预设库）；**预设组已在下一步退役**，见下面的「统一树」小节。

- **统一树（预设组退役，2026-09-18）**：✅ 完成。杰哥定案：「可以去除原本的组的方案，完全按照新的树来」。
  原设计里 **「预设组」与「水印归属」是两条不相交的线**——`presetGroups` 全仓只有 7 处引用、
  只服务于左栏水印库的筛选，与「哪个方向用哪些水印」**零关系**；把两者记住全靠人脑，
  这才是「看不出树」的真正根因，而不是「少画了一棵树」。
  - **数据模型上消灭「组」**：删掉 `CompositeV2PresetGroup` 类型、`CompositeV2State.presetGroups`、
    `CompositeV2PersistedSnapshot.selectedPresetGroupId`，以及 8 个分组 action
    （`createPresetGroup` / `renamePresetGroup` / `movePresetGroup` / `duplicatePresetGroup` /
    `deletePresetGroup` / `reorderPresetInGroup` / `addPresetToGroup` / `removePresetFromGroup`）
    与 `setSelectedPresetGroup`。persist **version 4 → 5**，migrate 依旧**丢弃式**：直接不搬这两个字段。
    不 bump 的话 zustand 根本不跑 migrate、旧字段静默丢失；只搬一半则等于把退役字段当成「还算数」。
  - **分组交给项目树本身**：`PresetProjectTree` 从「归属视图」升级为**统一树**，除原有的归属
    （拖入 / 行内 `+` / chip `×` / 恢复继承）外，加上**层级管理**——新建子节点、重命名、删除、拖拽移动，
    全部复用 `useAssetLibraryStore` 的 `createCollection` / `renameCollection` / `deleteCollection` /
    `moveCollection`。树是项目树的**投影**，不另建结构，结构改动照旧即时同步到左侧栏与 SOP 分组。
  - **「预设组」唯一不可替代的能力 = 一次绑一组**，由**水印库多选 + 批量绑定**顶替：
    库行支持多选（`librarySelection`），逐行拖拽或点节点上的 `+` 一次绑上整批，
    `lib/presetBinding.ts` 的 `bindPresetsToNode` 逐个走 `bindPresetToNode` 以**保住顺序即产出顺序**；
    库里没勾任何东西时退回「当前正在编辑的那个预设」，不打断原有的单绑路径。
  - **同一行的两种拖拽意图靠 MIME 分流**：预设 = `PRESET_LIBRARY_DRAG_TYPE`
    （载荷是 id 数组的 JSON，兼容早期裸 id），节点 = `COLLECTION_NODE_DRAG_TYPE`。
    行上的 `onDrop` **必须 `stopPropagation()`**，否则会连带命中根容器「拖到空白处 = 移回顶层」，
    把刚挪进来的节点又拎出去。`moveNode` 自带**环检测**（目标是自己或后代时拒绝）。
  - **左栏从三段改两段**（统一树 + 水印库，只剩一根 `tree-resizer`），
    删掉 `librarySplit` / `resizingLibraryRef` / `resizeLibraryPanes` 与全部组内联编辑状态。
  - ⚠️ `deletePreset` **刻意不清理**参数层引用：由树显示「已失效 N」让用户自己决定，而不是替他决定。
  - ⚠️ 遗留：`lib/compositeTypes.ts` 里 A 套 v1 的编排类型（`CompositeOutputPresetGroup` /
    `CompositeWorkspaceStateSnapshot` / `CompositeProduct` …）已成**死类型**（全仓零引用，
    该文件只剩 `CompositeFsImage` 还在用）。留着容易诱发「再引入第二套」，建议后续单独清理。

**已完成部分的关键顺序**（下次接着做时照用）：先删消费方 → 再剥字段 → 最后清 store + 删纯逻辑。
反过来的话，剥字段会一次性炸出 70+ 个编译错误，分不清哪些来自「要删的文件」、哪些来自「要改的文件」。

## 九、实现要点（从项目记忆搬来，改这些地方前先读）

### 模块地图

| 文件                                                         | 职责                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/lib/postprocessMedia.ts`                                | 媒体（渠道）表 + 尺寸笛卡尔积纯函数；`DEFAULT_POSTPROCESS_MEDIA` = 4 媒体 / 15 尺寸                |
| `src/lib/postprocessNaming.ts`                               | `{token}` 命名模板（含 `{preset}`）；项目树方向名优先于尺寸推导的横/竖/方                          |
| `src/lib/postprocessProjectTree.ts`                          | `buildPostprocessProjectTree` / `resolvePostprocessProjectTargets` / `isCollectionWithinSelection` |
| `src/lib/postprocessDistribution.ts`                         | 按天分发排期（起始日期 + 天数共同决定）                                                            |
| `src/storePostprocessMedia.ts`                               | 编排配置 store（namespace `postprocessMedia`）                                                     |
| `src/components/PostprocessSettingsModal.tsx`                | 80% 双栏工作区外壳                                                                                 |
| `src/features/postprocess/renderVariant.ts`                  | `renderWithMaxKb`（尺寸压缩 + 水印叠加）                                                           |
| `src/features/postprocess/PostprocessDistributionFields.tsx` | 分发表单（面板与节点参数弹窗共用）                                                                 |
| `src/features/projectTree/params.ts`                         | 继承链遍历与逐级合并                                                                               |
| `src/features/composite/components/PresetProjectTree.tsx`    | 统一树：项目树层级管理（新建/改名/删除/移动）+ 水印归属（拖入绑定）                                |
| `src/features/composite/lib/compositePresetLibrary.ts`       | 水印库筛选 + 跨组件拖拽 MIME（`PRESET_LIBRARY_DRAG_TYPE`，载荷 = id 数组 JSON）                    |
| `src/features/composite/lib/presetBinding.ts`                | 单个 / 批量绑定纯函数（`bindPresetsToNode` 保住顺序即产出顺序）                                    |

**类型落点**：`PostprocessMediaConfig` 放 `lib/` 而不是 store 文件 —— `src/types.ts` 的 `ExportData` 要引它，
放 store 会让基础模块反向依赖 store。

### 三个容易踩的执行细节

1. **渲染入口**：`maxSizeKb === 0`（纯净版）**不能**进 `renderWithMaxKb`。变体**不写入** `outputImages`，
   所以「原图迭代」天然成立（派生图不会变成下一次生成的源）。
2. **分发执行体的 early return 只看 `enabled`**，不能改判 `isPostprocessDistributionActive` ——
   后者还要求日期合法，会把「开了开关但没填日期」变成静默什么都不做。
   主进程 channel 是 `composite:authorize-output-directory`（preload `authorizeCompositeOutputDirectory`）。
3. **手动 vs 自动**：`src/store.ts` 的 `executePostprocessImageIds()` 是两者共用的执行闭包，只差
   「处理哪些图」与「结果记到哪」。手动跑**不剔除已产出**（语义就是「再跑一次」，重名靠 `-2` 后缀）
   且**不等归属**；自动触发的幂等闸 = 内存键 `${taskId}:${imageId}` + 任务上的 `postprocessOutputs`。

### 弹窗骨架的一个隐式依赖

`ds-dialog--postprocess`（80vw × 80dvh）不是 `Dialog` 的尺寸档 —— `Dialog` 只认 `sm|md|lg|xl`，
80% 是靠 `className` 传进去的，**它压过 `--md` 的 `max-width: 32rem` 靠的是 CSS 源码顺序**：
别把 `--postprocess` 的规则挪到 `--md` 前面。另外 `DialogWorkspace` 必须带 `flex-1`，
否则内容区撑不满 80dvh、底部露白（可照抄 `src/features/strategy/SopLibraryTab.tsx`）。

### 入口

- 编排设置：素材库工具栏「项目树」按钮；后处理设置面板（输入栏胶囊）。
- 手动产出：选中素材时的「跑后处理 (N)」（`runManualPostprocess`）。
- 水印编辑：后处理设置面板「水印预设」标题右侧的「管理水印预设」。
