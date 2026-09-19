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

## 七、UI 与组件约定

- **标准弹窗 = design-system 的 `Dialog`**。
- `react-test-renderer` **不支持 portal** → 涉及 Dialog 的测试用 `createRoot` + jsdom。
- **`localStorage` UI 状态在测试间会泄漏**（分隔条比例等持久化值）→ 受影响测试的 `afterEach` 清 `localStorage`。
- **任务卡片高度固定** `TASK_CARD_ROW_HEIGHT = 192`；卡内加可展开区块会撑破布局。
- 新增 `.tsx` 必须登记 `src/design-system/catalog.ts` 的 `legacyComponentCoverage`；
  旧工具类只减不增（`compliance.test.ts` 强制）。

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
