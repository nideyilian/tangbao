# 糖包 架构约束与勿改回清单

> **本文件回答"哪些设计是刻意的、不要改回去"。**
> 从 `.workbuddy/memory/MEMORY.md` 迁出（该文件只保留索引与铁律，不再承载细节）。
> 风险（会怎样出事）见 `docs/RISK.md`；操作配方见 `docs/tangbao-ops-runbook.md`；
> 决策理由见 `docs/adr/`。建立于 2026-09-18。

---

## 一、性能基线（勿回退）

这几项是实测优化后的结论，回退会直接反映为用户可感知的卡顿：

| 约束                                                   | 位置                          | 为什么                                                                 |
| ------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| 高频进度走独立的 `runtimeStore`                        | `src/stores/runtimeStore.ts`  | 避免高频 setState 触发主 store 全量重渲                                |
| SQLite 访问走 UtilityProcess                           | `electron/catalog-worker.ts`  | 主进程不被同步数据库操作阻塞                                           |
| 任务网格虚拟化 + `useDeferredValue`                    | `src/components/TaskGrid.tsx` | 大列表滚动不掉帧                                                       |
| 缩略图编码走 `canvasToWebpDataUrl`（异步）             | `src/lib/canvasImage.ts:164`  | `toDataURL` 是同步的，1024px webp q0.82 实测 **71–110ms/张**主线程冻结 |
| 整图字节优先：`saveImageBytes`，**新代码勿传 dataUrl** | `electron/preload.ts:46`      | 避免 base64 双向转换与主进程同步解码                                   |

⚠️ **验收陷阱**：改缩略图编码路径时，**改前后"总耗时"几乎一样**（编码量相同）。
按总耗时比会得出"这个改动没用"的错误结论 —— **必须挂 rAF 帧探针看主线程长任务**。
这个项目已经因为同样的误判绕过一次，别再绕第二次。

## 二、生图提示词编排（勿改回）

- 普通 SOP = **1 条**提示词；系列 = **1 组**（3 段拆成 3 条）。**两者互不套用。**
- 常量定义在 `src/features/strategy/sopPromptBatch.ts`。
- 守卫测试必须用**字面量断言**（断言具体条数/内容），不要断言"大于 0"这种弱条件。
- 系列图的视觉锚定链见 `src/lib/sopSeriesAnchor.ts`。

## 三、`tangbao://image/` 协议与调试

- 协议图**只能进 `<img src>`**（元素需带 `data-image-id`）。
- 需要像素数据时，走 `ensureImageCached` 拿 dataUrl，**不要直接读协议 URL**。
- **`fetch('tangbao://…')` 会被 CSP 拦** —— 这是刻意的，**不要**为了让它通而在 CSP 里加 `connect-src`。
- 真机调试启动前 `unset ELECTRON_RUN_AS_NODE`。

## 四、后处理 + 统一项目树（核心模型）

改后处理**先读 `docs/postprocess-unify-on-hanling-plan.md` 第九节**。

### 4.1 一棵树，不另建

「产品线 → 产品 → 方向」= `collections`（`src/features/projectTree/`）。
左栏 / SOP / 后处理 / 水印**共用这一棵**，**不另建树**。
结构改动一律走 `useAssetLibraryStore` 的 collections CRUD → 左栏同步、SOP 经 `sopGroupMirror`
（订阅 + 防抖）跟上，**所以没有"同步"按钮**。

### 4.2 参数层语义

- 参数按 `collectionId` 存 `PostprocessNodeOverride`，**逐级浅合并**（方向 → 产品 → 产品线 → 全局默认）。
- **`undefined` = 继承，空值（`''` / `[]`）= 显式覆盖。**
  → 合并与回退**必须用 `??`，不能用 `||`**（`RISK.md` R-15）。
- **`distribution` 是整份替换，不是逐字段继承** —— 排期由起始日期 + 天数共同决定，
  拆开继承会拼出界面上推理不出来的组合。
- `byMedia`（按渠道覆盖）**只开放两个字段**：`outputDir` 与 `watermarkPresetIds`。
  其余字段按渠道分会 让"哪个值生效"需要递归推理。

### 4.3 勾选 = 启用范围（硬开关）

- 勾选**不是**产出目标，是**启用范围**：归属方向**自身或任一祖先**被勾才算启用；**没勾就完全不跑**。
- **产出目标 = 图片归属方向本身**（命名段取自归属方向，与勾选层级无关）。
- 无归属 → 退回全局勾选。
- `resolveImageOwnership` 有**有界等待窗口**（2s / 250ms 步长）：
  因为「任务完成 → 触发后处理」与「素材异步归档」是两条并发线；新素材默认无归属。
- 只有**批次任务**会自动归档到项目文件夹，普通生成要用户手动拖。

### 4.4 产出与命名

- `taskPostprocess` **按渠道拆桶**；纯净版（clean）单独一桶且 `autoCompanionClean = false`。
- **预设 id 不存在 → 跳过整桶**（刻意**不**静默降级：静默降级会让用户以为产出成功）。
- 多预设时产物自动加预设名子目录；单预设时目录结构与原来一致（不破坏既有产出习惯）。

### 4.4.1 触发来源（自动 / 手动）必须传进执行体（2026-09-21）

- `runTaskPostprocess` 的入参带 `source: 'auto' | 'manual'`，**不许省**。
- 方向级「自动后处理」开关（`PostprocessNodeOverride.enabled`，提示码 `PP-SCOPE-002`）
  **只拦自动触发**：「这个方向参不参与自动产出」管不着用户手动点的那一次。
  拿它否决手动跑会变成死循环 —— 提示让用户「选中素材单独跑一次」，而手动走同一条判定，
  照做还是被跳过（2026-09-21 报障）。
- 「启用范围」（`selectedCollectionIds`，4.3）**两层触发都要过**：手动跑也不能绕过它，
  否则「任何图都能跑」等于把这层保护废掉。
- **界面文案要与这条对齐**：`PP-SCOPE-002` 的线索必须说清「手动跑不受这个开关限制」。

### 4.4.2 后处理提示的分级（勿改回「有 issue 就弹红条」）

- `severity` 是 `skipped`（配置使然：方向没参与、自动开关关着、渠道没勾）或 `error`（真失败）。
- **自动触发只在出现 `error` 级问题时播报**；纯 `skipped` 一声不吭 ——
  自动后处理是**每个生成任务完成就跑一次**的后台行为，配置事实逐批重播等于刷屏，
  用户点掉也无可作为。这类结果的落点是**素材库工具栏的状态入口 + 进度面板**（可查询、可关闭）。
- **手动触发每次必有下文**，零产出也要给结论；此时 `skipped` 用 `info` 不用 `error`。
- 状态入口与提示都必须**能关**（提示的 ×、状态入口的 ×）、内容多了不能把按钮顶出屏幕
  （见七章弹窗高度那条）。

### 4.5 水印模型

- **水印预设 = `CompositeV2Preset`**（`src/features/composite/storeV2.ts`，落盘 **version 5**，存 **localStorage**）。
  v1 与 A 套编排链已删。bump 版本必须配**丢弃式** migrate（`docs/adr/0005`）。
- **「预设组」概念已取消**（`docs/adr/0002`）。
- **水印归属 = 参数层的 `watermarkPresetIds`**（数组），**不是**水印 store 里的字段。
  继承态下首次改动**必须物化**成本级显式数组（直接写结果会把"少一个"表达成"一个都不要"）。
- `deletePreset` **刻意不清理引用**。
- `PresetProjectTree.tsx` **只管归属一件事**：拖入 / 行内 `+` / chip `×` / 恢复继承 + 层级管理；
  **行上不挂任何标注标签**（层级靠缩进表达）。
  - `onDrop` 必须 `stopPropagation()`（否则会连带命中根容器"拖到空白 = 移回顶层"）；`moveNode` 有环检测。
  - 按渠道编辑**就地展开**，别用浮层（树的滚动容器会裁掉绝对定位浮层）。
- ⚠️ `CompositeV2Preset.sampleBackgroundPath` **只有读、没有生产者**（刻意暂留，别当死代码删掉读端）。

### 4.6 工作区

- 工作区 = 顶栏 `appMode === 'postprocess'`。
- ⚠️ `store.setAppMode` 的**兜底分支会把非白名单值改写成 `agent`** → 新增工作区必须补分支，
  否则表现为"点 tab 完全没反应且零报错"（`RISK.md` R-12）。

## 五、持久化

- **`createDesktopJsonStorage(ns)` 是全仓唯一落盘入口。**
- **新增 store 忘配 namespace 白名单 = 完全存不住，而 UI 不报任何错**
  （白名单在 `electron/asset-kernel.ts`；由 `appDataNamespaceContract.test.ts` 守）。
- `read` **不能用「返回值是否字符串」判有效性**（`RISK.md` R-14）：
  读失败或格式不认 → **进降级态并拒绝本会话写盘**（宁可改动不落盘，也不覆盖真实数据）。
- ⚠️ **`scheduleApiSecretsPersist`** 随 settings 变化重写 `api-secrets.bin`
  → 配置一旦被重置，**真 Key 会跟着被抹掉（不可逆）**（`RISK.md` R-03）。
- **Key 只活在 `api-secrets.bin`**；状态里的 `apiKey` 恒为空串是**正常的**，不是"Key 丢了"。
  判据是该文件的**字节数**。

## 六、任务落盘完整性

- **卡片数量**来自 `tasks` 记录（`putTask` 是**整条覆盖写**）；**素材库数量**来自 `assets` 逐条 upsert。
  → **两者不一致 = 落盘不完整**。**别去查加载链**（已逐个排除）。
- 收尾写 `outputImages` **不得回退**：守卫 = `src/lib/generatedOutputImages.ts`
  （`planRestoredOutputAssignments` / `pickMoreCompleteOutputIds` / `canSettleTaskOutputs`）
  \+ `persistTaskWithRetry`。
- ⚠️ **看门狗超时会把任务提前标终态，但请求还在飞** → 三处 `status === 'running'` 守卫
  必须走 `canSettleTaskOutputs` 放行，否则迟到的真实结果是**孤儿数据**
  （既不进任务卡片也不进素材库）（`RISK.md` R-22）。

## 六·五、SOP 三场景分流（互斥，勿互相套用）

`campaign-recipe`（配方卡）/ `variable-prompt`（变量提示词）/ 其余（AI 生成）。

- **触发优先级**：`campaignRecipe` 字段 > `executionMode`。**判定写在弹窗内联**
  （`Boolean(sop.campaignRecipe) || sop.executionMode === 'campaign-recipe'`），
  **不要为省一行去 import 生成模块的辅助函数**（R-46：测试整体 mock 会挂掉该文件全部生成用例）。
- **配方卡 = 纯本地**：不调 AI、不读参考图、无 JSON 解析重试；合规红线 21 词内置且不可关闭。
- **骨架存 `campaignRecipe.body`，不是 `content`** —— 配方卡 `content` 为空是**合法形态**，
  保存门槛按类型分叉（R-51）。
- 编辑入口：SOP 列表头「新建 | 配方卡」→ `SopCampaignRecipePanel`
  （挂在 `SopTextEditor` 下方，按类型条件渲染）。

### 移植外部算法：保真优先于"顺手修笔误"（R-45）

`farthestPointSampling.ts` 有两处**疑似笔误**（`enforce` 的循环变量 `n` 遮蔽外层、
`windowFar` 死参数），但**实测影响采样分布**（8 维池取 10 条的最小差异由 4 → 1）。
`mix64` 的 64 位常量也不能截断。改前必须与原始实现对拍
（同 seed 同输入下 `selections` / `signatures` / `totalAttempts` **逐位一致**），
有意保留的怪异行为要写注释 + 登记 RISK。详见 R-45。

## 七、UI 与组件约定

- **标准弹窗 = design-system 的 `Dialog`**。
- **弹窗高度上限不是可选项**（2026-09-21 报障「关不掉」）：自建弹窗那套
  （`ds-modal-layer` + `ds-modal-surface`，不经 `Dialog`）**不会自动限高** ——
  `.ds-dialog` 有 `max-height: min(48rem, calc(100dvh - 2rem))`，而 `.ds-modal-surface` 只管
  背景/边框/阴影。内容一长，卡片就超出视口、底部按钮被顶到屏幕外，而弹窗打开时背景滚动是锁着的
  ⇒ 用户只剩 Esc 一条路。`ConfirmDialog` 曾是全仓**唯一**漏掉这条的（另外 20 处 `ds-modal-surface`
  都写了 `max-h-*` + `flex flex-col overflow-hidden`）→ **写自建弹窗时抄这一行**：
  卡片 `flex max-h-[calc(100dvh-2rem)] flex-col`，内容区 `min-h-0 flex-auto overflow-y-auto`
  （滚的只有正文，按钮在滚动区外）。
  ⚠️ 内容区**不能用 `flex-1`**（`flex: 1 1 0%`）：高度由内容决定时 basis 0 会让它在固有尺寸
  计算里贡献 0，弹窗直接塌成「标题 + 按钮」—— 同一个坑 `dialogSizing.test.ts` 已为
  `.ds-dialog--postprocess` 守过。
- `react-test-renderer` **不支持 portal** → 涉及 Dialog 的测试用 `createRoot` + jsdom。
- **`localStorage` UI 状态在测试间会泄漏**（分隔条比例等持久化值）→ 受影响测试的 `afterEach` 清 `localStorage`。
- **任务卡片高度固定** `TASK_CARD_ROW_HEIGHT = 192`；卡内加可展开区块会撑破布局。
- 新增 `.tsx` 必须登记 `src/design-system/catalog.ts` 的 `legacyComponentCoverage`；
  旧工具类只减不增（`compliance.test.ts` 强制）。
- **新增组件必须登记 `design-system/catalog.ts`**，否则 `catalog.test.ts` 的全等比较直接失败
  —— 这是**刻意的棘轮**，不是 bug（R-48）。
- **`TextField` 撑开宽度必须写 `containerClassName`，不是 `className`**（2026-09-20 实测）：
  `className` 落到内层 `<input>`，外层 `.ds-field` 是 `display:grid` 的 flex 子项 ——
  写成 `className="flex-1"` 时容器按内容宽度定死，**输入框只占 ~200px，右侧留一大片空白**，
  且没有任何报错。正确写法 `containerClassName="min-w-0 flex-1"`。
  ⚠️ 同一坑在 `MediaTableManager` / `ChannelOutputDirs` 各有一处，已一并修；
  **写新表单行时先 `grep 'containerClassName="min-w-0 flex-1"'` 抄现成的**。
- **`.ds-switch` 是 `justify-content: space-between` 的 flex**：直接放进撑满宽度的容器里，
  状态文字在最左、开关被甩到最右，中间留一大片空。行式布局里要**外面套一层 `w-fit`**。
- **后处理面板的字段行有三种形态**（`PostprocessParamField.layout`，见 `paramSchema.ts`）：
  不给 = 两槽（标签 4 列 + 控件 8 列）；`'inline'` = 标签 / 徽章 / 说明 / 控件**挤在同一行**
  （开关这类「一个控件就说完了」的字段）；`'full'` = 字段**自带整块内容**并跨满 12 列，
  面板不渲染标签（按渠道的水印 tab + 16:9 预览就是这种）。
  ⚠️ 单行式里**不要再放 `flex-1` 的 spacer**：控件自己决定怎么占位
  （开关 `ml-auto` 靠右、输入框 `flex-1` 撑开），多一个弹性兄弟元素会把剩余空间**均分**，
  开关就停在一半位置（2026-09-21 写这版时避开的一个坑）。
- **分组标题一律不渲染**（2026-09-21，后处理弹窗）：三段之间只隔一条 1px `Divider`，
  由字段名自报家门。`PARAM_GROUPS[].title` 仍在元数据里（测试与将来的导入导出按它分组），
  但**别指望它出现在界面上**。
- **图标按钮必须有 `aria-label`**（并给 `title` 说清后果）：`IconButton` 没有可见文字，
  测试查询与读屏都只能靠它。渠道目录表的「+ / 删除位置」、尺寸表的「+」都是例子。
- **`DataGrid` 的行合并（`column.spanRows`）与虚拟滚动互斥**（2026-09-21）：虚拟滚动启用时
  一律按「不合并」渲染 —— 窗口可能从半截合并组开始，跨行格会缺一块。**不出错、不报错，只是
  合并没了**。所以只给行数远低于 `virtualizeThreshold` 的表用（按渠道的导出位置就是如此）；
  哪天有人给它调到几千行，合并会**静默**消失（这正是本仓最怕的那类失效）。
- **按渠道的导出位置：位置加在「下一行」，每个位置单独删，没有「清空」按钮**（2026-09-21）。
  ① 第二个位置曾经占一整列（「双写位置」），列一多就把「导出位置」挤窄，
  中文共享盘路径读不了 —— **路径列宽度**是这一屏的硬约束，别的元素都得让位；
  ② 「一键清空整个渠道」已移除：它没有确认也撤不回来，误点即丢；退回留空改成逐行删
  （删到一个不剩自然回到「留空」）。**别再往回收**——它的替代品是逐行 `✕`。
- **grid 容器只要「某一块该吃剩余高度」，就必须写出 `grid-template-rows`**：
  不写时子块全落进**隐式 auto 行**，而 `align-content` 的初始值 `normal` 对 auto 轨道
  表现为 `stretch` ⇒ 剩余高度被**均分**，每块内容顶部对齐、底下各挂一段空白。
  实例：`.sop-recipe-panel__body`（2026-09-21 报障「页面底部仍有这么大的空白」）——
  面板那层的 `flex: 1 1 auto` 本身没错（它确实撑满了父容器），
  空白是在**面板内部**被行拉伸出来的，所以在面板上加 flex 治不了这个。
  契约测试：`features/strategy/sopCampaignRecipeLayout.test.ts`（读 CSS 文本断言声明，
  与 `design-system/dialogSizing.test.ts` 同一手法）。

## 七·五、新增可编辑字段 → 三处「静默失效」清单（必逐项过）

三者都表现为「改了但存不下去 / 顺序错乱」，而 **UI 不报任何错**，所以只能靠清单防：

| #   | 位置                                                                  | 漏了会怎样                                                         | 详见 |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------ | ---- |
| ①   | `SopManagementCenter.itemDirty` 的手写比较链                          | 草稿**不标记为脏** → 自动保存不触发、「保存修改」按钮恒 `disabled` | R-47 |
| ②   | `createDesktopJsonStorage` 持久化白名单（`electron/asset-kernel.ts`） | **完全存不住**                                                     | R-14 |
| ③   | 排序键：内存 `compareAssets` + 桌面端 SQL `SORT_EXPRESSIONS` 分页     | **第一页顺序错乱**（首屏 120 条由 SQL 给）                         | §九  |

`itemDirty` 是**手写枚举比较**（逐字段 `!==` + 两处 `JSON.stringify`），不是深比较。
对象/数组字段用 `JSON.stringify(x ?? null)`，与既有 `variableMeta` / `seriesConfig` 写法一致。

## 七·六、共享工具（勿再复制）

2026-09-18 起为**唯一实现**：

| 工具                         | 职责                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `lib/contentEditableText.ts` | contentEditable 取纯文本                                                                                |
| `lib/pathBaseName.ts`        | 取路径末段                                                                                              |
| `lib/typeGuards.ts`          | `isRecord` / `getStringValue`(trim) / **`getUntrimmedStringValue`**（不 trim，`agentApi` 流式解析依赖） |
| `lib/clamp.ts`               | 数值钳制                                                                                                |
| `lib/escapeRegExp.ts`        | 正则转义                                                                                                |
| `lib/browserStorage.ts`      | localStorage 读写                                                                                       |
| `lib/imageApiShared.ts`      | `isDataUrl` 与 `getDataUrlDecodedByteSize` 的唯一实现                                                   |

**故意不合并**（差异是有意的，别去"统一"）：路径净化 4 份、`escapeHtml` 3 份、`formatDate`。

## 八、`InputBar` 的 prompt 是双写（易踩）

prompt 同时存在于 store 与 contentEditable，靠 4 个入口双向同步。
**任何程序性改写 prompt 必须先 `isUserInputRef.current = false`**，
否则"同步 prompt 至 contentEditable"的 effect 会跳过渲染，**下次从 DOM 回读还会把改动整个抹掉**
（「选了尺寸比例没生效」就是这个，`RISK.md` R-13）。

比例改写逻辑 = `src/lib/aspectRatioPrompt.ts`。

## 九、素材命名与排序（两条链路，别只改一条）

- **生成命名的唯一实现 = `src/lib/generatedImageFilename.ts`**，格式 `{YYYYMMDD}-{标签}-{批次}-{序号}`
  （如 `20260918-网赚-401-1`）。**两个出口的序号来源不同，这是刻意的**：
  - 落盘（`store.ts` 的 `saveTaskImagesToLocalFSNow`）→ `buildGeneratedImageFileNameBase`，
    序号 = **目录续号**（要扫目录才知道下一个号）。
  - 下载 / 导出 / 排序 → **`resolveGeneratedAssetNameBase`**，序号 = **槽位号 + 1**。
    同一张图必须永远同名，不能取决于磁盘当时状态。
- ⚠️ **`TaskRecord.generatedFileNameBase` 与 `GeneratedAssetOrigin.generatedFileNameBase` 全仓没有生产者**
  （类型注释写着"供素材来源快照与导出命名使用"，但从没被赋值过）。
  `getAssetFileName` 曾只读它 → 每次都退回 `asset.imageId`，即 **64 位 sha256** 文件名。
  **别再把新逻辑挂在"等它被写入"上**；有显式值才优先用。
- ⚠️ **`outputSlot` 是 0 起的**：不要用 `toPositiveInt`（它把 0 钳成 1），
  否则序号集体错位一位（第一张变 `-2`）。0 起下标用 `toNonNegativeInt`。
- **`AssetSortKey` 加键必须同时改两条链路**，只改前者会让**第一页顺序错乱**（首屏 120 条由 SQL 给）：
  1. 渲染进程内存：`src/features/assetLibrary/query.ts` 的 `compareAssets`；
  2. 桌面端 SQL 分页：`electron/asset-catalog.ts` 的 `SORT_EXPRESSIONS`（用 `Record<AssetSortKey, string>`，
     漏配即编译错误）+ 分页游标。
- **目录库的命名排序列是冗余列** `assets.file_name` / `assets.filename_batch`
  （`ensureAssetSortColumns` 幂等 ALTER + 两个索引 + `catalog_meta` 标记的一次性回填）。
  不这么做的两种错误做法：在 SQL 里按 `origins` JSON 现算（要格式化时间戳，做不出来）、
  或按 `json_extract(origins, '$[0]…')` 取（**主来源不是第 0 个**的多来源素材会取错）。
- ⚠️ **分页游标值可以是字符串**（`name` 排序的 `sort_value` 是 TEXT）。
  写游标时**不能用 `Number(sort_value)`** —— 文本会变 `NaN`，**第二页就断**。
- `cache-images/<sha256>.png` 的**物理文件名不改**：库完整性校验就是拿文件名当预期哈希重算比对，
  改名等于把校验与内容寻址去重一起打掉。命名只作用于用户可见的下载 / 导出 / 排序。
