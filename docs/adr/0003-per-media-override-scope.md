# 0003 按渠道覆盖只开放 `outputDir` 与 `watermarkPresetIds`

- **日期**：2026-09-18
- **状态**：生效中
- **决策者**：杰哥（产品负责人）

## 背景

《输出位置明细-独立版》xlsx 是业务方给的真实交付表，覆盖 61 个方向。
逐行核对发现两件硬事实：

1. **这张表与项目树本来就是同一份源数据**。`builtinProjectTree.ts` 头注释写着「内置结构**由
   《输出位置明细-独立版》整理**，节点 id 的业务 id 取自明细表」，202 行逐行核对 **0 处对不上**。
   → 当初只搬了**结构**，**交付信息这半从来没落进系统**，这才是"要手工填一遍"的根因。
2. **主要矛盾是渠道维度**：61 个方向里 **25 个的目录按渠道分叉、56 个的水印按渠道分叉**。
   三段共享盘目录连层级顺序都不同，**塞不进一个值**。

渠道名 ↔ media id 有铁证：Sheet2「资产中心原值」直接给了英文渠道码
（厂商→`vendor`、百度→`baidu`、头条→`toutiao`、广点通→`gdt`）。

## 决策

参数层增加**按渠道覆盖**（`PostprocessMediaOverride` + `PostprocessNodeOverride.byMedia`），
但**只开放两个字段**：`outputDir` 与 `watermarkPresetIds`。

## 理由

- **"按渠道覆盖"是唯一能完整装下这张表的形式** —— 不给这个维度，25 个方向的目录与 56 个方向的水印
  就只能靠人工在别处维护。
- **只开放两项，是因为其余字段按渠道分会让"哪个值生效"需要递归推理**：
  参数已经是"方向 → 产品 → 产品线 → 全局"四级合并，再叠一层渠道，每一级都要回答"渠道值算不算"。
  两个字段是这张表的真实需求上界，超出这个范围的复杂度没有业务依据支撑。

**被否决的方案**：① 把表格数据摊平成"每个方向一份完整参数"（丢结构、无法继承）；
② 全字段支持按渠道（无业务依据的复杂度）。

## 后果

- **正面**：源表的交付信息可以完整落库；命中渠道用渠道值、其余**回退本级通用值**，语义可推理。
- **代价 / 知情取舍**：
  1. **合并必须逐渠道合并**（`mergeByMediaOverride`），整份替换会把"没提到的渠道"静默抹掉。
  2. **空对象渠道整个键丢掉**（`normalizeByMediaOverride`）—— 否则界面会出现"配置了但没内容"的项。
  3. 解析**必须 `??` 不能 `||`**：`outputDir: ''` 与 `watermarkPresetIds: []` 都是**有效值**。
  4. `taskPostprocess` 要**按渠道拆桶**，纯净版单独一桶且 `autoCompanionClean = false`。
- **对后续代码的约束**：
  - 想给 `byMedia` 加第三个字段，必须先有业务表格证据，并按 ADR 流程新开一条记录。
  - `PresetProjectTree` 上「按渠道 N」chip 只展示**与通用值不同的渠道**
    （`resolveNodeWatermarkBindingsByMedia` 的返回语义）。
  - 按渠道编辑**必须就地展开，不能用浮层**（树的滚动容器会裁掉绝对定位）。

**证据**：`lib/postprocessMedia.ts`（`applyPostprocessOverride`）、`params.ts`
（`normalizeByMediaOverride` / `mergeByMediaOverride`）、`ProjectNodeParamsDialog.tsx`、
`docs/output-location-import-2026-09-18.md`、新增 23 个用例（params 16 + postprocessMedia 7）。
