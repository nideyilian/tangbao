# 0020 后处理不再产出「纯净版」

- **日期**：2026-09-23
- **状态**：**生效中（已实现）**
- **决策者**：杰哥（产品负责人）
- **相关**：[0003](0003-per-media-override-scope.md)、[0011](0011-node-override-narrowing.md)
  （这两条里关于 `autoCompanionClean` 的部分已随字段删除失效）、TB-107（先一步砍掉「自动伴随」）、
  TB-120（本次整条摘除）、`architecture-constraints.md` §4.4

---

## 背景

杰哥 2026-09-23 的原话只有一句，但把「现象、判断、结论」都说了：

> 后处理流程中目前会自动导出一份「纯净版」文件，但该功能已无必要，因为程序本身即作为素材库使用。

「纯净版」是后处理里一个保留媒体（`PURE_MEDIA_ID = 'clean'`）：**不叠水印、沿用生成尺寸、不压缩**，
产出到默认输出位置。

## 真因（为什么它「自动」到用户从来没见过那个开关）

三条各自看起来都合理，叠起来变成一个关不掉的开关：

1. **默认值就带着它**：`createDefaultPostprocessMediaConfig()` 里 `selectedMediaIds: [PURE_MEDIA_ID]`
   （`src/storePostprocessMedia.ts`）—— 全新安装、或任何一次「恢复默认」，它都在勾选列表里。
2. **界面上根本没有取消它的入口**：内置媒体表 `DEFAULT_POSTPROCESS_MEDIA` 只有
   广点通 / 百度 / 厂商 / 头条四家，**没有 `clean` 这一行**；而中控台那一栏是条件渲染
   `{pureMedia && …}`（`ChannelSection.tsx`，`pureMedia = media.find(id === 'clean') ?? null`）
   ⇒ 找不到就**整块不画**。用户看得到「广点通」的开关，看不到「纯净版」的开关。
3. **还有两处在往里加**：`pruneSelectedMediaIds` 明确写着「保 `clean` 不被剪掉」；
   Excel 导入（`consoleImport.ts`）在勾选顺序落盘时**无条件**把 `clean` 塞到队首。

实测（2026-09-23，dev 库 `%APPDATA%\tangbao`，命名空间 `postprocessMedia` / `projectTreeParams`）：

- 全局：`selectedMediaIds = ['clean','baidu','vendor','toutiao','gdt']`
- 项目树：**54 个方向节点**的 `postprocess.selectedMediaIds` 全部以 `clean` 打头
- 命名模板 `{date}-{product}-{direction}-{media}-{creator}-{size}-{seq}` ⇒ 产出里多出
  `…-纯净版-陈泽杰-1280x720-1.jpg` 这样的文件

## 决策

1. **`clean` 退出产出维度**，整条路径拆掉，而不是「默认关掉」：
   - `buildPostprocessOutputs` 入口过滤 `mediaIds` 里的 `clean`（旧配置 / 旧备份的最后一道网），
     并删除原先的 `clean` 单元分支；
   - `taskPostprocess` 不再给纯净版单独开桶（原先「它没有渠道，用通用配置单独成桶」）。
2. **默认不预勾任何渠道**（`selectedMediaIds: []`），产出什么由用户在渠道表里自己勾。
3. **两处归一化都要剔掉 `clean`，并各自 bump 版本号**：
   - 全局 `postprocessMedia`（`v3 → v4`）；
   - 项目树 `projectTreeParams`（`v2 → v3`）—— 节点级那份是各自落盘的，全局那次迁移清不到它，
     实测 54 个方向都还挂着，不清就是「改了代码但什么都没发生」（R-63 家族）。
4. **产出记录里的 `clean` 字段保留**：它还给历史记录与任务卡提供「纯净版」角标
   （`TaskPostprocessModal` / `TaskCard`），删字段会让旧记录显示变样；新产出一律 `false`。
5. **界面与 Excel 同步**：删掉中控台那栏（本来也没渲染出来过）；渠道表不再需要「滤掉纯净版」；
   Excel 导出照原样导媒体表，导入遇到旧包里的 `clean` 行**忽略**（不再回写勾选）。

## 为什么不那么做

- **不保留「显式勾选还能产」的开关**：界面上不存在的开关是最坏的一种开关 ——
  用户既不知道它存在、也关不掉它，只能靠产出的文件名发现「怎么多了一张」。而它产出的东西
  素材库里本来就有：素材库里那张原图就是无水的、同尺寸的，纯净版只是把它有损重编一份。
- **不做成「默认关但可开」**：那要么新造一个 UI 入口，要么把 `clean` 补进媒体表当成一个渠道
  （它的「尺寸」概念与渠道根本不同，塞进渠道表会让「详细尺寸」那格对它失去意义）——
  为一条没有新增价值的路径付 UI 复杂度不划算。TB-107 已经砍掉「勾了渠道就自动多产一份」，
  这次是把最后一条残留（默认勾选 + 关不掉的开关）一起清掉。
- **不动用户已经落盘的历史文件**：磁盘上那些 `…-纯净版-…jpg` 一个都不删（可能是交付过的素材）。
- **不删 `PURE_MEDIA_ID` 常量本身**：它还有两个用处 —— 归一化时认出并剔除旧值、
  认出历史产出记录里的那份纯净版。
- **不 bump `selectedCollectionIds` / 不碰「启用范围」**：那是另一条已经收口的事（见 §4.4.1）。

## 代价 / 影响

- **升级后产出会少一份**：这正是要的结果，但必须在发布说明里写明（否则用户会以为产出坏了）。
  建议写进该版本的 `RELEASE.md`：一条「行为变更」+ 一句「这是预期」。
- **只剩 `clean` 的方向 → 变成「一个渠道都不投」，而不是退回继承**：旧值意思接近「我只要那份原图」，
  改成继承会凭空继承出一堆渠道来（产出反而暴增）。
- **渠道产出的文件名与序号一个字不变**：`{seq}` 按**文件夹**各自计数，而文件夹名里带 `{media}`
  这一段（`postprocessRunner.ts`）⇒ 纯净版与渠道天然落在不同文件夹，各数各的。
  唯一例外是把 `{media}` 从命名模板里删掉的人 —— 那时两者同文件夹，序号会整体前移一位。
- **历史记录照旧显示**：旧记录里带 `clean: true` 的条目仍显示「纯净版」角标。

## 落地位置

| 文件 | 改了什么 |
| --- | --- |
| `src/lib/postprocessMedia.ts` | `buildPostprocessOutputs` 入口过滤 `clean` + 删除 clean 单元分支；`PURE_MEDIA_ID` / `PURE_MEDIA_NAME` 注释改为「历史遗留」 |
| `src/storePostprocessMedia.ts` | 默认 `selectedMediaIds: []`；归一化剔除 `clean`；`pruneSelectedMediaIds` 去掉 clean 特例；产出计划去掉「clean 提到最前」；`version: 3 → 4` |
| `src/features/postprocess/taskPostprocess.ts` | 删掉纯净版桶；进度标签不再特判 `clean` |
| `src/features/projectTree/params.ts` | 节点级 `selectedMediaIds` 归一化剔除 `clean` |
| `src/features/projectTree/storeProjectTreeParams.ts` | `version: 2 → 3` |
| `src/features/composite/components/{ChannelSection,ConsoleMediaTables}.tsx` | 删掉纯净版那一栏与相关过滤 / 帮助文案 |
| `src/features/composite/lib/{consoleImport,consoleWorkbook}.ts` | 导入忽略旧包的 `clean` 行、不再回写勾选；导出不再单独特判 |
| `src/features/postprocess/PostprocessNamingFields.tsx` | 产出预览的示例渠道不再过滤 `clean` |
| `src/types.ts` | 产出记录 `clean` 字段注释改为「历史标记」 |
| 测试 | `storePostprocessMedia` / `postprocessMedia` / `postprocessRunner` / `ConsolePostprocessSections` / `consoleImport` / `consoleWorkbook` / `params` 等按新口径改写（含 4 条「历史 clean 不产出」的新守卫） |
