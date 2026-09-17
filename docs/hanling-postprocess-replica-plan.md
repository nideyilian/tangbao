# 瀚灵系统「后处理」方案复刻计划

> 来源：`http://192.168.122.61:8787`（瀚灵系统）分享链接。
> 该站点是 Electron 桌面端 + 本地 Express 服务（默认 `127.0.0.1:8787`）+ 局域网/手机访问的架构，
> 前端产物未混淆（`assets/index-Wflt42B6.js`，2.4MB，保留中文与类名），本计划的模型与数据均从
> 该产物中直接提取，变量名/函数名为其产物中的原始标识符。
>
> 后端 API 需 token 且绑定客户端 IP，本次未能取到服务端配置；下面标注「内置」的数据来自前端常量，
> 服务端可能另有覆盖版本。

---

## 0. 结论摘要

**瀚灵强在「按投放渠道批量产出变体」的编排，糖包强在水印渲染本身。**

|            | 瀚灵                                                          | 糖包                                                                       |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 水印渲染   | 单张水印图片（本地文件或链接），服务端合成                    | **图层式**（文字/Logo/圆角/描边/多图层），渲染引擎完整                     |
| 后处理编排 | **项目 × 媒体 × 尺寸 笛卡尔积批量输出**                       | 单规则串行，一次一套参数                                                   |
| 渠道规格   | **媒体表**（广点通/百度/厂商/头条，15 个尺寸各带压缩上限）    | 无「媒体」维度                                                             |
| 纯净版     | **自动带一份无水印原图**                                      | 无                                                                         |
| 原图迭代   | **保留未加水印原图**，下一轮基于它改，避免叠水印              | 无                                                                         |
| 命名模板   | `{date}-{project}-{direction}-{creator}-{media}-{size}-{seq}` | 无 token 模板：`前缀-序号` 字符串拼接（`buildGeneratedImageFileNameBase`） |

**所以「整个复刻」的准确说法是**：把瀚灵的**编排层**（媒体表 + 项目多选 + 笛卡尔积 + 纯净版 + 原图迭代）
移植进糖包，水印**继续用糖包自己的引擎**——糖包的水印能力比瀚灵强，不该退回去用单图合成。

---

## 1. 瀚灵后处理方案拆解

### 1.1 数据模型（前端由 `uu()` 归一化，默认值由 `lu()` 提供）

```ts
// 媒体规格（平台/渠道）
interface Media {
  id: string // 'gdt' | 'baidu' | 'vendor' | 'toutiao' | 'clean' | 自定义
  name: string // 广点通 / 百度 / 厂商 / 头条 / 纯净版
  enabled: boolean
  sizes: MediaSize[]
}

interface MediaSize {
  id: string // `${mediaId}-${width}x${height}`
  width: number
  height: number
  maxSizeKb: number // 压缩上限；0 = 不压缩
  enabled: boolean
}

// 项目（两级：产品线 → 产品）
interface ProjectGroup {
  id: string
  name: string // 产品线名；空则显示「未命名类别」
  products: string[] // 产品名列表
}

// 后处理配置，全局一份（lu() 的默认值）
interface SopPostProcessConfig {
  outputPath: string
  projectNames: string[]
  projectGroups: ProjectGroup[]
  namingPattern: string // 默认 su 常量，见 1.3
  media: Media[]
}

// 生成时的勾选（每次生成独立）
interface PostprocessSelection {
  projectNames: string[] // 可多选
  mediaIds: string[] // 可多选，可含 'clean'
}
```

关键常量（产物原文）：

- 纯净版 id：`Eu = 'clean'`，显示名「纯净版」。
- 默认命名模板：`su = '{date}-{project}-{direction}-{creator}-{media}-{size}-{seq}'`。
- 媒体规格工厂：`bu(id, name, [[w, h, maxSizeKb], ...])`。
- 项目组降级：`projectGroups` 为空时回退为 `[{ id: 'legacy', name: '项目', products: projectNames }]`。

### 1.2 内置媒体数据（前端常量 `cu`，共 4 媒体 / 15 尺寸）

| 媒体           | 尺寸      | 压缩上限 |
| -------------- | --------- | -------- |
| 广点通 `gdt`   | 1280×720  | 399 KB   |
| 广点通         | 1080×1920 | 399 KB   |
| 百度 `baidu`   | 1140×640  | 299 KB   |
| 百度           | 370×245   | 299 KB   |
| 百度           | 1080×1920 | 399 KB   |
| 厂商 `vendor`  | 1280×720  | 99 KB    |
| 厂商           | 1080×1920 | 99 KB    |
| 厂商           | 320×211   | 80 KB    |
| 厂商           | 320×210   | 80 KB    |
| 厂商           | 720×1280  | 99 KB    |
| 厂商           | 720×498   | 99 KB    |
| 厂商           | 474×768   | 99 KB    |
| 厂商           | 1080×528  | 99 KB    |
| 头条 `toutiao` | 1080×1920 | 399 KB   |
| 头条           | 1280×720  | 399 KB   |

> 这张表是「数据」的核心价值所在：**每个渠道的尺寸 + 体积上限**是一次性沉淀、长期复用的资产。

### 1.3 组合算法（产物函数 `ku(project, settings, size)`）

```
输出单元 = 勾选的项目 × 勾选的媒体 × 该媒体匹配尺寸
```

展开细节：

1. `Du()` 解析勾选项目名（去重、trim，兼容单个旧字段 `postProcessingProjectName`）。
2. `Ou()` 解析勾选媒体 id（默认值 `['clean']`）。
3. 对每个媒体 id：
   - `'clean'` → 直接取用户选定的生成尺寸，`maxSizeKb: 0`（不压缩）、`clean: true`。
   - 其他 → 调 `hu()` 找该媒体在**同方向**下的启用尺寸。
4. 方向判定：`_u(w, h) => w >= h ? 'landscape' : 'portrait'`，
   显示名 `vu() => 横版/竖版/方形`。**选了 1024×1280（竖）就只产出该媒体的竖版尺寸**，
   若某媒体有多个竖版尺寸则全部产出。
5. `hu()` 的一个副作用要注意：媒体 id 找不到时**回退到第一个启用媒体**（`?? r[0]`），
   会导致「选错媒体却照样出图」。复刻时应改为显式跳过并提示。

### 1.4 执行链路

产物函数 `HT(e)`：

```
if (postProcessingOutputs.length > 0) POST /api/ai-image/post-process-outputs
else                                 POST /api/ai-image/save
```

请求体：

```jsonc
{
  "image": "...", // 生成的原始图片
  "prompt": "...",
  "revisedPrompt": "...",
  "outputPath": "...",
  "namePattern": "{date}-{project}-{direction}-{creator}-{media}-{size}-{seq}",
  "format": "jpg",
  "maxSizeKb": 0,
  "resizeWidth": 0,
  "resizeHeight": 0,
  "postProcessingOutputs": [/* 1.3 的笛卡尔积结果 */],
  "lanShareToken": "...",
}
```

**关键：原图只生成一次，服务端按 `postProcessingOutputs` 数组一次性产出所有变体。**
生成阶段状态机里 `processing` 的文案就是「保存图片与后处理」。

### 1.5 三个真正值钱的设计

1. **纯净版自动伴随**：只要勾了任一非 clean 媒体，输出里永远多一份无水印原图。
   素材给下游二次加工、投放复盘、投诉自查都用得上，不需要用户记得单独导一次。
2. **保留未处理原图供下一轮修改**：
   - 生成记录里每个版本有 `rawImageId`（未加水印原图）与 `imageIds`（后处理成品）。
   - 界面上「继续修改 V3 · 使用未加水印原图」明确提示引用的是哪一版。
   - 迭代时引用原图 → **不会水印叠水印，也不会水印区域被反复 JPEG 压缩糊掉**。
   - 这一条是「后处理」和「生成」解耦的前提：后处理永远是可再生的派生物。
3. **渠道规格与生成尺寸解耦**：生成用模型友好尺寸（1024×1024 等），
   后处理再落到各渠道尺寸并压到体积上限。同一张图一次生成、多渠道分发。

---

## 2. 糖包现状对照（含关键发现）

### 2.1 糖包目前有**两套**水印实现

| 实现                                     | 位置                                                    | 状态                   |
| ---------------------------------------- | ------------------------------------------------------- | ---------------------- |
| 独立后处理：水印模板 + 导出规则 + 导出组 | `src/storePostprocess.ts`、`src/lib/watermarkEngine.ts` | **已实现但完全没接线** |
| 合成水印：图层式预设 + 尺寸规则 + 分发   | `src/features/composite/lib/compositeWatermarks.ts` 等  | 活的，有完整 UI        |

**证据（重要）**：

- `processImageWithRule`（水印渲染主函数，`src/lib/watermarkEngine.ts:194`）在全仓**没有任何调用方**——
  只被 `src/design-system/compliance.test.ts:118` 统计过硬编码颜色行数。
- `usePostprocessStore` 只在 `src/storePostprocess.test.ts` 使用；
  持久化状态只在 `src/store.ts:11980`（备份导出）与 `src/store.ts:12877`（恢复）被 `import()`，
  **没有 UI 能编辑 `templates` / `rules` / `groups`，也没有任何地方消费它们去渲染**。
- 也就是说：`templates` / `rules` / `groups` 现在只是「备份里带得动、界面上看不见」的僵尸数据。

### 2.2 合成模块的能力（活的这套）

- `CompositeWatermarkPreset`：`{ id, name, kind: icon|text|iconText|custom, enabled, layers[], sizeRules[], namingTokens[], distribution }`
- `CompositeProductSizeRule`：`{ id, name, enabled, width, height, outputPath, namingTemplate, maxSizeKb, format }`
  默认命名 `{date}-{product}-{size}-{category}-{index}`（`compositeWatermarks.ts:31`）
- `CompositeWatermarkGroup`：`{ id, presetIds[] }`
- UI：`BatchExportTab`、`GlobalOutputRulesPanel`、`PresetManagementTab`、`PresetNamingFields`、
  `DistributionSettingsPanel`、`FloatingLogoLibrary` 等。
- 状态徽标：`src/features/composite/PostprocessStatusBadge.tsx`。

**结论：糖包的 `CompositeProductSizeRule` 已经等价于瀚灵的「媒体尺寸」，
`CompositeWatermarkPreset` 比瀚灵的「单张水印图片」更强。
缺的不是渲染，是「媒体表 + 项目多选 + 笛卡尔积 + 纯净版 + 原图迭代」。**

### 2.3 项目维度已就绪

上一轮已内置「产品线 - 产品 - 方向」三级结构到素材库项目文件夹树
（`src/lib/builtinProjectTree.ts`，3 产品线 / 13 产品 / 61 方向），
由 `AssetCollection` 承载、`src/lib/sopGroupMirror.ts` 镜像到 SOP 分组。

**这正好对应瀚灵的 `projectGroups`（产品线 → 产品），并且糖包多一层「方向」。**
瀚灵里 `{direction}` 取自案例（case）的 `agentDirection`，糖包已有现成的方向数据源，无需另建。

---

## 3. 复刻方案（分四阶段）

### 阶段一：数据模型与内置媒体表（纯数据，无 UI）

新增 `src/lib/postprocessMedia.ts`：

```ts
export interface PostprocessMediaSize {
  id: string
  width: number
  height: number
  maxSizeKb: number // 0 = 不压缩
  enabled: boolean
}
export interface PostprocessMedia {
  id: string
  name: string
  enabled: boolean
  sizes: PostprocessMediaSize[]
}
export const PURE_MEDIA_ID = 'clean'
export const DEFAULT_POSTPROCESS_MEDIA: PostprocessMedia[] = [/* 1.2 的表，可增删 */]
export function resolveOutputDirection(width, height): OutputDirection
export function matchMediaSizes(media, direction): PostprocessMediaSize[] // 对应 hu()
export function buildPostprocessOutputs(input): PostprocessOutputPlan // 对应 ku()，返回 { units, skippedMediaIds }
```

**✅ 阶段一已实现（2026-09-17）**：`src/lib/postprocessMedia.ts` + `src/lib/postprocessMedia.test.ts`（14 用例）。

- 用**确定性 id**（`gdt-1280x720` 形式），与内置项目树同一套「靠 id 不靠名称」的判重惯例。
- `buildPostprocessOutputs` 是**纯函数**，顺序稳定，单测锁死了笛卡尔积与方向匹配。
- **修正瀚灵的回退缺陷**：媒体 id 不存在时返回空并计入 `skippedMediaIds`（供 UI 提示），
  不再静默回退到第一个媒体。停用的媒体既不产出也不计入 skipped（那是用户的有意设置，不是错误）。
- 实现时补的两个边界决策（源系统未定义）：
  1. **方形源图视作通配**：`direction === 'square'` 时返回该媒体全部启用尺寸。
     源系统的 `w >= h → 横版` 会把方形图当横版，导致竖版渠道拿不到图。
  2. **源尺寸不可用时只跳过纯净版**：纯净版没有尺寸就无从产出，但渠道尺寸照常生成。

### 阶段二：后处理配置存储

**✅ 阶段二已实现（2026-09-17）**：`src/storePostprocessMedia.ts` + `src/lib/postprocessNaming.ts`（42 用例）。

> 2026-09-17 更新：原计划「在 `src/storePostprocess.ts` 上扩切片」的前提已不成立——该文件与其
> 配套的 `watermarkEngine` / `watermarkWorkbench` 经确认是**完全没有接线**的死代码，已按杰哥决定整体删除。

- **`src/storePostprocessMedia.ts`**：zustand + `persist` + `createDesktopJsonStorage('postprocessMedia')`，version 1。
- 配置切片 `PostprocessMediaConfig`（类型定义在 `src/lib/postprocessMedia.ts`，避免 `types.ts` 反向依赖 store）：
  `media` / `selectedMediaIds` / `selectedCollectionIds` / `direction` / `outputDir` / `namePattern` / `creator` /
  `watermarkPresetId` / `autoCompanionClean`。
- **不含任何水印概念**：只存 `watermarkPresetId`，引用 `CompositeWatermarkPreset`，避免第三套水印概念复活。
- 归一化 `normalizePostprocessMediaConfig()` 供持久化 `migrate` 与备份恢复**共用同一份逻辑**：
  - `media` **缺失** → 回填内置表；用户手动清空的 `[]` **保持为空**，不复活已删媒体。
  - 坏条目（缺 id、宽高非正）**逐条丢弃**而非整份回退，保住用户其余编辑；尺寸 id 重复按同规格去重。
  - `setSelectedMediaIds` 会剔除悬空媒体 id（防脏选择落盘）；而直接写 state（如备份导入）留下的悬空 id，
    由产出计划的 `skippedMediaIds` 兜住并向 UI 提示——与阶段一同一个「显式跳过、不静默回退」的口径。
- **`src/lib/postprocessNaming.ts`**：token 渲染与校验。
  - 默认模板 `{date}-{product}-{direction}-{media}-{size}-{seq}`（对齐糖包风格，不照抄 7 段；`{creator}` 保留但默认不用）。
  - token 集：`date / line / product / direction / creator / media / size / seq`。
  - 取值统一过 `sanitizeGeneratedImageFilenamePart`；**空值段整段删除**（不留 `A--B`）；未知 token 原样保留，
    由 `findUnknownPostprocessNameTokens` 供 UI 提前报错；`{direction}` 缺省时按尺寸推导中文方向。
- 备份链路：`ExportData.postprocessMediaState?`（旧备份无此字段 → 按默认配置恢复，不报错），
  两处导出装配 + 导入侧 `restorePostprocessMediaConfig()`。**不 bump `ExportData.version`**：加的是可选字段，向后兼容。

原计划要点（保留备查）：

- 只存**编排配置**：媒体表（`media`）与上次选择（`selectedMediaIds` / `outputDir` / `namePattern` / `creator`）。
- 加 `version` 迁移，`media` 缺失时用 `DEFAULT_POSTPROCESS_MEDIA` 填充；用户删掉的媒体不被自动加回。
- `ExportData` 备份链路：按需新增 `postprocessMediaState` 字段（旧备份无此字段时用默认值，不报错）。

### 阶段三：后处理设置 UI（对齐 `Nu()` 面板）

**✅ 阶段三已实现（2026-09-17）**：`src/components/PostprocessSettingsModal.tsx` +
`src/lib/postprocessProjectTree.ts`（13 用例）+ 面板组件测试（13 用例）。

- 入口：生成面板参数行（`InputBar.renderParamSummary`）新增「后处理」胶囊按钮，紧邻「审核规则」，
  显示 `N 项目 · N 媒体` / `未启用`。
- 面板结构（单列滚动，即时写入 store，无草稿态）：
  ```
  项目（AssetCollection 项目树，可勾任意层级，产品线默认展开）
  方向（跟随尺寸 / 横版 / 竖版 / 方形）
  媒体（全选 / 仅保留纯净版；每个媒体下只读展示「宽x高 · ≤上限KB」）
  输出与命名（目录 + 命名模板 + token 快捷插入 + 创作者 + 水印预设 + 纯净版伴随）
  产出预览（逐条列出「项目 / 媒体 / 尺寸 / 文件名」，超过 6 条可展开）
  ```
- 提示文案沿用核心语义：「同时选择项目与媒体后启用。沿用对应水印、尺寸和命名，保留未处理原图以供下一轮修改。」
- **项目维度在本阶段补齐**：`buildPostprocessOutputs` 增加可选 `projects`，
  单元带可选 `project: {collectionId, line, product, direction}`，展开成
  「项目 × 媒体 × 尺寸」；不传 `projects` 时行为与阶段一完全一致（单元里不含 `project` 字段）。
- 层级 → 命名 token 的映射由 `resolvePostprocessProjectTargets` 完成：
  第一级 → `{line}`，第二级 → `{product}`，最后一级（层级 ≥ 3）→ `{direction}`；
  只勾到产品时方向留空，由尺寸推导补齐。
- 面板的两个刻意的降级：
  1. **没有项目就没有产出目标**——此时不拿「单个匿名项目」的单元数当预览数量，直接显示空状态；
  2. 生成尺寸为 `auto` 时用 1024×1024 作**示例**预览并明确标注，不假装能预知。
- 坏数据兜底：勾选里存在已删除/回收站的项目、已不存在的媒体、已不存在的水印预设，面板各自给提示且**不静默改产出别的**。

原计划要点（保留备查）：

- 默认命名模板对齐糖包既有风格，不要直接抄 7 段：`{date}-{product}-{direction}-{media}-{size}-{seq}`。

### 阶段四：输出链路与「原图迭代」（2026-09-17 完成）

挂在任务完成路径（`src/store.ts` 的 `saveTaskToLocalFSNow` → `scheduleTaskPostprocess`）；
执行体 `src/features/postprocess/taskPostprocess.ts`，纯逻辑编排 `src/lib/postprocessRunner.ts`。

1. 后处理变体**不写入** `outputImages`——任务的输出原图始终是原始生成结果，
   「继续修改」天然从原图出发，不会水印叠水印。`rawImageId` / `postprocessOutputs[].rawImageId` 记录溯源。
2. 渲染走 **composite 渲染链**；没选水印预设时用空图层预设（只借尺寸适配与 JPEG 编码）：
   - **尺寸 + 压缩**：`renderWithMaxKb(input, unit.maxSizeKb)`（`compositeExportRuntime.ts`）已含
     「0.9 先试 → 0.01 探底 → 最多 8 次二分」，超限时返回 warning 而不抛错——比
     `imagePostprocess.ts` 在 PNG 超限时直接抛错更适合批量链路。
   - **水印叠加**：`CompositeV2Preset`（配置里只存 id），画布尺寸取该单元的目标尺寸。
   - `clean` 单元不叠水印，且 `maxSizeKb` 恒为 0 → **不走体积二分**（0 会被误当成「压到 0KB」），
     单次 0.92 质量编码。
3. **输出一律 JPEG**（2026-09-17 拍板「自动转 JPEG」）：渲染链只产 JPEG，源 PNG 也压不到指定体积。
4. 比例不一致时用 `crop-fill`（等比放大裁切填满），不拉伸、不留白边。
5. 目录：`outputDir` 优先（支持目录变量）；留空落到「本地保存目录/postprocess」。
   勾了项目时按三级项目树逐级建子目录，空层级不建空目录。
6. 命名：`{token}` 模板 + 序号**跨源图连续递增**，磁盘同名再加 `-2`/`-3` 兜底（绝不覆盖已有文件）。
7. 幂等三闸：内存键「任务 id:图片 id」、`postprocessOutputs[].rawImageId`（跨重启）、
   源图不可用则显式跳过并上报 warning。失败一律只提示，不回滚生成结果。

> 与早期计划的差异：原计划复用 `src/lib/imagePostprocess.ts`（映射临时 `postprocess_*` 参数）做尺寸+压缩，
> 实际改为直接复用 composite 的 `renderWithMaxKb`。原因是后者已内建「超限降级为 warning」与 JPEG 输出，
> 一次编码同时完成缩放/压缩/水印，避免两张渲染链各自维护一套体积策略。

---

## 4. 与糖包现有水印的融合

**不建议让糖包退化成「单张水印图片」。** 融合方式：

| 瀚灵概念                | 糖包对应                        | 处理方式                                                  |
| ----------------------- | ------------------------------- | --------------------------------------------------------- |
| 水印图片（案例级 1 张） | `CompositeV2Preset`（图层式）   | 把「案例水印」映射为「水印预设」，一个预设可含多图层      |
| 案例的 `projectName`    | `AssetCollection` 项目树节点 id | 复用，不新造                                              |
| 案例的 `agentDirection` | 项目树「方向」层                | 复用，`{direction}` token 取自它                          |
| 案例的 `mediaReuseIds`  | 媒体表勾选                      | 替换为 mediaId 多选                                       |
| `sizeRules`             | `CompositeProductSizeRule`      | 已有 width/height/maxSizeKb/format，补 channelId 归属即可 |

水印概念的收敛已完成（2026-09-17）：`storePostprocess` 的 `WatermarkTemplate` 与 `watermarkEngine` /
`watermarkWorkbench` 一并删除，糖包**只剩 `CompositeV2Preset` 一套水印**。
复刻的后处理编排不再引入任何新的水印模型，只引用既有预设 id。

> ⚠️ 2026-09-17 勘误：本计划早先写的 `CompositeWatermarkPreset` 出自 `src/features/composite/store.ts`（**旧版 v1**）。
> 该文件导出 `useCompositeStore` 却**没有任何外部引用**（`CompositeWorkspace` 走的是 `storeV2`），
> 属于又一块死代码候选，**尚未删除**。后处理编排引用的是 **`CompositeV2Preset.id`**。

---

## 5. 已确认的决策（2026-09-17 杰哥拍板）

| #   | 决策点           | 结论                                                                                                   |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | 媒体表内容       | **用瀚灵这 4 个渠道起步**，表可编辑（内置只是起点）                                                    |
| 2   | 项目维度         | **复用已内置的「产品线-产品-方向」三级项目树**，不另建 `projectGroups`                                 |
| 3   | 水印渲染选型     | **走 `composite` 图层式预设（`CompositeV2Preset`）**；`watermarkEngine` 那套死代码**直接删除**（已删） |
| 4   | 纯净版与原图迭代 | **两条都做**（纯净版自动伴随 + `rawImageId` 原图迭代）                                                 |

---

## 6. 风险与边界

- **抓包合法性**：以上数据来自公开分享链接的前端产物，未绕过任何鉴权。
  服务端配置（`projectGroups`、案例水印、实际媒体表）因 IP 绑定未能获取，
  阶段一的内置表以产物常量为准，可能与你线上实际配置不一致——**请以你系统里的配置为准复核一遍**。
- **`hu()` 的回退行为**（1.3 第 5 条）是瀚灵的缺陷，复刻时不要照抄。
- **`maxSizeKb: 0` 语义**是「不压缩」，不是「压到 0」，落盘逻辑里要显式判断，别写成 `if (maxSizeKb)` 之外的隐式真值判断。
- **PNG 无法压到指定体积** → 已按「自动转 JPEG」处理（2026-09-17 拍板）：后处理链路统一输出 JPEG，
  不经过 `imagePostprocess.ts` 的 PNG 抛错分支。
