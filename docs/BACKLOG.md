# 糖包 需求池（BACKLOG）

> **本文件是唯一的需求池。** 回答"现在在做什么、卡在哪"。
> 目标与里程碑见 `docs/ROADMAP.md`。风险见 `docs/RISK.md`。

## 在途（WIP ≤ 2）

| ID     | 事项                                  | 状态  | 写线   | 开始       |
| ------ | ------------------------------------- | ----- | ------ | ---------- |
| TB-060 | 中控台数据表格化 + Excel 导入导出     | DOING | 主写线 | 2026-09-21 |
| TB-014 | 后处理按图片归属自动匹配参数          | DOING | 主写线 | 2026-09-18 |
| TB-015 | 水印预设升为顶栏 tab，归属与参数分离  | DOING | 主写线 | 2026-09-18 |
| TB-089 | 多目标产出：「产出目标」+「记住配置」 | DOING | 主写线 | 2026-09-22 |
| TB-107 | 分发排期：起算日自动 + 原地建日期文件夹 + 按素材打乱 | DOING | 主写线 | 2026-09-23 |
| TB-108 | 每日素材批量生成：策略卡 + 每日比例抽取 + 预览审核发布 | DOING | 主写线 | 2026-09-23 |
| TB-110 | 顶栏设计规范统一（高度/圆角/组件/左基线）      | DONE  | 主写线 | 2026-09-23 |
| TB-111 | 配方卡导入兼容「一键衍生」模板            | DONE  | 主写线 | 2026-09-23 |
| TB-112 | 后处理按产出方向拆成独立运行实例          | DONE  | 主写线 | 2026-09-23 |
| TB-116 | 撤「启用范围」白名单 + 总开关（默认关）+ 删旧项目树 | DONE  | 主写线 | 2026-09-23 |
| TB-117 | 分发：按排期日整装（撤「原地套一层」+ 撤复制） | DONE  | 主写线 | 2026-09-23 |
| TB-118 | 后处理状态入口常驻 + 环形进度展现                | DONE  | 主写线 | 2026-09-23 |
| TB-119 | 图片删除：软删退槽 + 删任务卡进回收站 + 清空即彻底清 | DONE  | 主写线 | 2026-09-23 |
| TB-120 | 后处理不再产出「纯净版」（产出路径拆掉） | DONE  | 主写线 | 2026-09-23 |
| TB-121 | 批次卡片成员改由任务记录决定（不再从素材反推） | DONE  | 主写线 | 2026-09-23 |
| TB-122 | 落盘补偿：两次写不进的任务存快照，下次启动重放 | DONE  | 主写线 | 2026-09-23 |
| TB-123 | 反向对账：素材在、来源任务不在的留痕            | DONE  | 主写线 | 2026-09-23 |
| TB-124 | 素材库加固：结构版本 + 顺序迁移链 + 老库兼容门禁 | DONE  | 主写线 | 2026-09-23 |
| TB-125 | 任务中断语义：中断可辨识 + 「继续」入口（不重复产图） | DONE  | 主写线 | 2026-09-24 |

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

### TB-120 后处理不再产出「纯净版」（那条产出路径整条拆掉）

- **来源**：杰哥 2026-09-23 报障原话「后处理流程中目前会自动导出一份『纯净版』文件，但该功能已无必要，
  因为程序本身即作为素材库使用」。
- **诊断（它为什么「自动」—— 默认勾着，而界面上根本没有取消它的入口）**
  1. **默认值就带着它**：`createDefaultPostprocessMediaConfig()` 的
     `selectedMediaIds: [PURE_MEDIA_ID]`（`src/storePostprocessMedia.ts`）。
  2. **界面里没有那个开关**：内置媒体表 `DEFAULT_POSTPROCESS_MEDIA` 只有广点通 / 百度 / 厂商 / 头条，
     **没有 `clean` 这一行**；而中控台那栏是条件渲染 `{pureMedia && …}`（`ChannelSection.tsx`）
     ⇒ 找不到就整块不画。用户看得见渠道的勾，看不见纯净版的勾。
  3. **还有两处在往里加**：`pruneSelectedMediaIds` 明确写着「保 `clean` 不被剪掉」；
     Excel 导入（`consoleImport.ts`）在落勾选顺序时**无条件**把它塞到队首。
  - 实测（dev 库 `%APPDATA%\tangbao` 只读直查）：全局 `['clean','baidu','vendor','toutiao','gdt']`；
    项目树里 **54 个方向节点**的 `postprocess.selectedMediaIds` 全部以 `clean` 打头。
- **改法**（方案 A，杰哥确认后实施）
  - `clean` **退出产出维度**（不是「默认关但留着开关」）：`buildPostprocessOutputs` 入口过滤
    + 删除 clean 单元分支；`taskPostprocess` 不再给纯净版单独开桶。
  - 默认 `selectedMediaIds: []` —— 不预勾任何渠道。
  - **两处归一化各剔一次，并各自 bump 版本号**：`postprocessMedia` v3 → v4、
    `projectTreeParams` v2 → v3。节点级那份是各自落盘的，全局那次迁移清不到它；
    不 bump 就是 R-63 家族 ——「改了代码但什么都没发生」。
  - **产出记录的 `clean` 字段保留**：历史记录与任务卡还要靠它显示「纯净版」角标，新产出一律 `false`。
  - 界面那栏删除；Excel 导入遇到旧包里的 `clean` 行**忽略**、导出不再单独特判。
  - **不动磁盘上已经落盘的历史文件**。
- **验收证据（2026-09-23）**
  - `npx tsc -b` + `npx tsc -p electron/tsconfig.json --noEmit` **双端零错误**。
  - 定向测试全绿：`storePostprocessMedia` / `lib/postprocessMedia` / `ConsolePostprocessSections` /
    `consoleImport` / `consoleWorkbook` / `features/postprocess` / `features/projectTree` /
    `lib/postprocessRunner`，**19 文件 273 用例**；含 4 条新守卫
    （「历史的 clean 不产出，也不计入 `skippedMediaIds`」×2、「归一化剔掉 clean」、
    「勾上 clean 也不再产出」）。
  - 全量：**268 文件 3247 用例全绿**（5 分 32 秒，Node 24 直跑 vitest；`npx vitest` 会撞 vite.config 的
    `MIN_NODE_MAJOR = 24` 守卫，跑法见 runbook §5）。
  - **反向验证**（把修复改回旧行为，确认守卫真的会红）：产出计划入口过滤 → 2 条；
    全局归一化 → 3 条；节点级归一化 → 1 条；`pruneSelectedMediaIds` 的 clean 特例 → 1 条。
    合计精确命中 7 条，恢复后 192 用例复绿、`grep NV-PROBE` 无残留。
  - 决策记 `docs/adr/0020-postprocess-drop-pure-media.md`。
- **行为变更（发布时务必写进 `RELEASE.md`）**
  - 升级后后处理**少一份产出**：不再有 `…-纯净版-…jpg`。这是本次的目的，需明说，否则会被当成产出坏了。
  - **渠道产出的文件名与序号一个字不变**：`{seq}` 按文件夹各自计数，而文件夹名里带 `{media}` 段
    （`postprocessRunner.ts`）⇒ 纯净版与渠道天然落在不同文件夹，各数各的。
    唯一例外：把 `{media}` 从命名模板里删掉的人，两者同文件夹，序号会整体前移一位。
  - 只剩 `clean` 的方向变成「一个渠道都不投」（**不**退回继承）—— 那更接近它当年的本意。

### TB-118 后处理状态入口常驻 + 环形进度（工具栏指示器改版）

- **来源**：杰哥 2026-09-23 截图（素材库工具栏右侧并排两块「后处理中…」与「后处理 162/282 57%」），
  问「能否有更好的展现方式」，并指着 21st.dev 让参考；随后追加本体要求
  「把这两个组件常驻，不然我没有在后处理时无法查看之前的记录」。
- **诊断（截图里那两块是**两个独立元件**，不是一组）**
  1. 左边是「跑后处理 (N)」按钮的运行态（`AssetLibraryToolbar.tsx:984`）、右边是常驻状态入口
     （同文件 `:1052-1082`）—— 两处都在说「后处理」、都在转圈，分不清哪个是入口、哪个是刚点的动作。
  2. 右边的转圈图标是**手塞进 Button children 的 SVG**（`:1069`），而 `Button` 会把 children 包进
     一个 `<span>`；preflight 的 `svg{display:block}` 把它顶到单独一行 → 图标飘在文字左上角。
     顺带发现 `compliance.test.ts` 那条「图标必须走 leadingIcon」的检查**只认直接写出的 JSX 子元素**，
     `{cond && <Icon/>}` 这一类整批漏在检查外（本轮已补上，见该文件 `collectIconChildren`）。
  3. 进度只有数字，扫一眼看不出跑到哪了；且入口在「没在跑 + 最近一次没问题」时**整块消失**。
- **改法**（方案 A，杰哥确认后实施）
  - 新增设计系统组件 **`ProgressRing`**（`design-system/feedback.tsx` + `.ds-progress-ring*` 样式 +
    `catalog.ts` 登记 + `index.ts` 导出）：弧长 = 百分比；`value` 不传即**不定态**（1/4 弧自转，
    比 spinner 慢一档）；tone 复用条形进度那套 `--ds-progress-color`；固定 `aria-hidden`（环是装饰，
    状态由相邻文字提供，与 `StatusIndicator` 的圆点同口径）。
  - 状态入口：图标改走 `leadingIcon`（Button 早就留了 flex 槽位）；环三态 = 单方向在跑给确定进度 /
    多方向在跑给不定态（编「平均进度」是撒谎）/ 跑完给满环 + `POSTPROCESS_RUN_STATUS_TONES` 结果色；
    **首次进入不画环**（一个空环只会被读成「卡在 0%」）。
  - 入口**无条件常驻**，文案三态：`后处理 <进度>` / `后处理出错 (N)`｜`后处理跳过 (N)` / `后处理记录`。
  - 「跑后处理」按钮：运行态只保留 `loading`（它同时是 disabled 的唯一表达：这批方向在跑、点了也会被
    并发闸挡），**文案不再切成「后处理中…」**。
- **验收证据（2026-09-23）**
  - `npx tsc -b` + `tsc -p electron/tsconfig.json --noEmit` **双端零错误**（含新增测试代码）；
    改动文件 `prettier --write` 全 unchanged、`eslint` 零告警。
  - **界面已抽查**（本机 ctypes 抓屏 + zlib 手写 PNG，绕开缺失的 PIL）：素材库工具栏第一行现在显示
    `项目 · 老歌　169 张　[包含子文件夹]　[产出目标]　[后处理记录]　…`——「后处理记录」常驻可见、
    与旁边「产出目标」同款式、文字不截断，且 HMR 已把新代码推到了运行中的窗口 ✅。
  - ⚠️ **测试未跑成**：本机 vitest 当前整体跑不起来（见下），新增/改写的用例
    （`AssetLibraryToolbar.test.tsx`：已有用例 +1 条文案断言，另 +2 条常驻/环用例）**已过 tsc 与 lint，
    但未执行**。
  - ⚠️ **环形进度的实际观感未验证**：环只在「有在跑」或「跑过」时出现，当前窗口停在什么都没跑的态，
    只看到无图标的「后处理记录」。请跑一次后处理过目（顺便看结果色）。
- **环境故障（本轮踩到，**与本次改动无关**，未定位）**
  - 症状：`vitest run` 所有文件在 `describe()` 处报
    `TypeError: Cannot read properties of undefined (reading 'config')`；全量跑则是 268/268 failed、
    `Vitest failed to find the runner`，`environment` 阶段耗 64.5s。
    **最小探针（4 行、只 import vitest）同样失败** ⇒ 与代码无关。
  - 已排除：Node 版本（同日 17:26 的 verify 用的是同一个 v24.14.0）、vite↔vitest 版本冲突、
    sandbox、`NODE_OPTIONS` 里注入的 shim、vitest 缓存、`vite-plugin-electron`
    （用不含该插件的临时 config 复现同样失败）、`--pool=threads|forks`、`--no-isolate`。
  - 时间线：17:26 `npm run verify` 还是 265 文件 / 3171 用例全绿；17:46 起全挂；
    中间无提交、工作区只有本轮改动。

### TB-116 撤掉「启用范围」白名单 + 加「自动后处理」总开关（默认关）+ 删旧项目树

- **来源**：杰哥 2026-09-23 连续三条报障与裁决
  1. 「为什么一直有这种提醒我跳过的提醒，我的程序默认就是不自动后处理的啊」（附「已跳过 ×9」与
     `[PP-SCOPE-001]` 弹窗截图）
  2. 「项目树如果是管能不能按设置参数来执行后处理的话，那么我认为默认就该全部勾选，
     而且不要有提示跳过的提醒，因为我所有图基本都是要后处理的，区别的至少自动后处理和手动后处理而已」
  3. 「我直接已经叫你把项目树融合进中控台，现在你是中控台已经有项目树的功能，但项目树还保留着」
  4. 「要加（总开关），但是默认关」
- **状态**：DONE · 主写线
- **根因（三条是同一件事的三个面）**
  1. **「要不要自动跑」藏在勾选里**：`store.ts` 的闸门判 `selectedCollectionIds.length === 0`。
     用户以为「没勾 = 没启用」，实际勾了别的方向就每批都跑，再因本方向没勾而逐批留一条
     `PP-SCOPE-001`「已跳过」——**刷屏是配置事实被每批重播**，不是故障。
  2. **两层开关说同一件事**：方向级 `PostprocessNodeOverride.enabled`（默认**开**，可继承）
     与「启用范围」白名单（默认**空**）都在回答「这个方向参不参与自动产出」，判定却各写一套，
     UI 还分在两处。用户在两处之间迷路（`PP-SCOPE-001` vs `PP-SCOPE-002`）。
  3. **同一棵树有两份 UI**：中控台 `ConsoleAssetTree` 能管结构（还多了拖拽 / 回收站），
     但「后处理」列**只在旧的项目树工作台**（`ProjectTreeWorkbench`，素材库工具栏入口）。
- **做法**
  1. **加总开关** `AppSettings.autoPostprocess`（**默认关**，`undefined` 与 `false` 同义）；
     自动侧的闸门从「启用范围非空」改成「总开关开着」。手动跑完全不受它约束。
     判定收口在 `store.ts` 的 `isAutoPostprocessEnabled`（可测；一处分叉就会出现
     「以为关着、后台照写盘」）。UI 在设置 → 通用。
  2. **撤掉「启用范围」这一层**：删三处总闸（`store.ts` ×2、`taskPostprocess.ts` ×1）与
     `PP-SCOPE-001` 判定。`selectedCollectionIds` **字段保留**（落盘格式不动，无数据风险），
     只剩一个用途：**无归属的图（手工拖入 / 旧数据）产出到哪**。码表条目保留但不再产生 ——
     旧历史记录里还有它，删码会让那些记录渲染成「未知问题」。
  3. **纯配置使然的跳过不再留档**：零产出且原因只有 `PP-SCOPE-002` 时，从 `runtimeStore`
     撤掉那条 run 且不落方向历史（`isAutoDisabledOnlySkip`）。⚠️ 按**码**判而不是按 severity ——
     `PP-CANCEL-001`（取消）与 `PP-SRC-001`（源图读不到）同属 skipped，但都必须留。
  4. **删旧项目树**：`ProjectTreeWorkbench.tsx` / `ProjectTreeTable.tsx` / `tableRows.ts` /
     `useJumpToProjectTree.ts` 及其测试、素材库工具栏入口、`projectTreeWorkbench` 状态与两个
     action、`catalog.ts` 两条登记。`features/projectTree/` 只留参数层（`params` / `types` /
     `storeProjectTreeParams`）—— 它们被 store、参数面板、水印绑定共用，**不是 UI**。
- **验收标准（可测）**
  1. 总开关缺省（`undefined`）与 `false` 都判为关，只有显式 `true` 为开；
  2. 总开关关着时，手动跑照旧开跑、不报「未启用」；
  3. 自动跑：归属方向的方向级开关关着 → 记 `PP-SCOPE-002`（防回退）；
  4. 零产出且只有 `PP-SCOPE-002` → 不留档；混入任何其它原因 / 取消 / 源图不可用 → 照留；
  5. `isPostprocessReady` 不再要求勾项目；
  6. 产出预览的全局作用域展开**全部方向**（不再依赖勾选）；
  7. `npm run verify` 全绿。
- **验收证据（2026-09-23）**
  - 全量 `vitest run` **268 文件 / 3230 用例全绿**；`tsc -b` 与 `tsc -p electron` 零错误；
    `eslint` 零告警；prettier 已跑。
  - 改造 6 条旧用例（语义已变）：手动跑守「总开关关着也照跑」、`isPostprocessReady` 摘掉项目前提、
    目标弹窗不再标「未启用」、中控台全局预览摘掉「还没有启用任何方向」、删掉两条
    `PP-SCOPE-001` 时代的守卫。新增 2 条守卫（`isAutoPostprocessEnabled` 缺省语义、
    `isAutoDisabledOnlySkip` 按码判定）。
  - ⚠️ **未做渲染验证**（本机离屏渲染受限）：设置里那个开关的观感、中控台树删掉旧入口后的观感，
    请在运行中的应用里过目。
- **文档**：`architecture-constraints.md` §4.3 / §4.4.1 / §4.4.2 重写（含「别再做成闸门」）、
  `config-spec.md` + schema 字段语义、`RISK.md` R-90 补注、runbook 守卫表、
  `pages/postprocess.md`、gap-analysis 环节表。


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

- **状态**：DONE（语义已定并落地）· 图标素材仍缺（只挡「实际铺一套」，不挡代码）
- **语义裁决（2026-09-23 杰哥定「按 TB-018 为准」）**：**无文案水印 = 就是没有文字，不补署名。**
  ⇒ 收回 TB-041 验收标准 3（「无文字水印 → 左下角补一个标识符层」）。
  诊断与代价见 `docs/postprocess-watermark-gap-analysis.md` 卡点 2。
- **为什么要收回**：那条兜底规则把两件**不同**的事判成了同一件 ——
  ①「这个预设**就是没有水印**」（未绑预设 / 纯净版）本该什么都不画；
  ②「这个预设**有图标但没文字层**」（本条目要的纯图标水印）。
  两者都命中「没有可出字的文字层」，于是**没绑水印的产出也被补了一个署名**。
- **为什么长期没暴露**：后处理那条路用的空预设基准画布是 **1×1**（`PLAIN_PRESET`），
  字号按比例算出来 8px，再按 `min(target/base)` 放大 **720 倍** ⇒ 图层框落到画布**上方之外**
  （实测 `rect = { x:0, y:-7200, w:720, h:7920 }` @1280×720），整段文字不可见。
  **几何巧合，不是设计** —— 基准画布一换成真实尺寸，每张干净的图都会被糊上一行巨大文字。
- **落地**：删 `buildIdentifierLayer` / `resolveIdentifierLayer` / `hasRenderableTextLayer` /
  `IDENTIFIER_FALLBACK_STYLE`；`renderOverlayAt` 只画预设自己的图层。
- **验收证据（2026-09-23）**
  1. `compositeRendererV2.test.ts`「⭐ 预设里没有文字层 → 覆盖层一笔都不画（哪怕标识符已启用）」
  2. 同文件一条**对照用例**（有文字层时同一探针能看到字）—— 防止「把绘制循环整个删掉也全绿」
  3. **反向验证**：把兜底层加回 `renderOverlayAt` → ① 精确变红
     （`expected [{ text:'@小王', x:10, y:10 }] to deeply equal []`），对照用例仍绿
  4. `compositeIdentifier.test.ts` 钉住接口面：那两个函数不再导出
  5. `npm run verify` 等效全绿（tsc 双端 / eslint / prettier / **268 文件 3207 测试**）
- **遗留**：图标素材仍没找到（素材库 0 条、内置只有 `app-icon.png` / `icon.ico`、NAS 浅层未搜到）
- **回滚点**：与 TB-113 同一批改动（5 个源文件 + 3 个测试文件），可整包 revert

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

### TB-122 任务落盘失败补偿清单：两次写不进就存快照，下次启动重放

- **来源**：`docs/data-persistence-benchmark.md` 方案 2（杰哥 2026-09-23 裁决「把方案2和4做了」）
- **状态**：DONE · 写线：主写线
- **诊断**：`persistTaskWithRetry` 两次重试都失败时只打一行日志，**任务从此只在内存里活着**。
  重启后内存里也没有它了 —— 而正向对账（`reconcileGeneratedAssets`）遍历的正是**内存里的 tasks**，
  所以**也救不回来**。素材那侧是逐条 upsert 的、仍然完整 ⇒ 结果就是「素材在、任务卡不在」。
- **改动**：新增 `src/lib/taskPersistJournal.ts`
  - 失败时把**任务完整快照**（不是只存 id —— 重启后内存里已经没有它了）记进迁移 journal
    （`pending-task-persist-v1`）；同一任务重复失败只累加次数不堆条目，上限 50 条时丢最旧；
  - 启动时 `retryGeneratedAssetLibraryMigration` **先把这批任务写回磁盘**、再跑正向对账，
    并顺手 `upsertFromTask` 补齐它们的素材。**顺序不能反**：先写回，对账才看得见它们；
  - 写 journal 本身失败只打日志、不递归重试（那说明库整体写不进去，递归只会加剧）。
- **验收标准（可测）**
  1. 同一任务重复失败 → 清单只有一条、`attempts` 累加；
  2. 超过 50 条丢最旧的、保留最近的；
  3. 序列化往返字段不丢；坏 JSON / 非数组 / 缺字段一律当空（不让坏数据拖垮启动）；
  4. 重放：写成功的移出清单、写失败的留下且 `attempts + 1`；串行执行不并发。
- **验证**：新增 9 例（`src/lib/taskPersistJournal.test.ts`）。`tsc -b` ✓ ｜ `eslint` ✓ ｜ `prettier --check` ✓。
- **未验证**：跨进程落盘链路**没有端到端跑过** —— 开工期间 41731 被另一条写线占用，本会话全程未启动 dev。
  接入点靠读代码自检（`store.ts:5203` 失败分支、`store.ts:5780` 启动重放）。
  能跑 dev 时建议手工验一次：制造写失败 → 重启看卡片是否回来。

### TB-125 任务中断语义：让「上次没跑完」可辨识，并给出不重复产图的「继续」

- **来源**：`docs/serpent-borrowing-plan.md` 的 P1（参考 Serpent 的 Job `interrupted` 语义：
  退出时仍是 queued / running 的任务标记为中断、**绝不静默执行**、必须显式重试）。
  杰哥 2026-09-24 批准开工。
- **诊断：现状是四套处理并存、语义不一致**
  1. **OpenAI 系普通生图**：启动时标成 `status:'error'` + `error:'请求中断'`，而
     `taskProgressDisplay.ts` 的 `isStoppedTask` 用**正则匹配错误文案**
     （`/已停止|已取消|请求中断|任务已中止|停止生成/`）把它归进「已停止」分支。
  2. **「卡先建、词后填」的预留卡**：标 `promptFailed`，文案明确说「应用在编写提示词时退出了」。
  3. **fal / 自定义异步**：走远端恢复（`scheduleFalRecovery` / `scheduleCustomRecovery`）。
  4. **批量编排批次**：启动时 `void executeTask(task.id)` —— **自己就续跑了**。
- **要解决的问题**
  - ① **「应用退出」与「用户自己按的停止」共用一张脸（都叫「已停止」）** ——
    一个能接着跑、一个不用再跑，**该做的事相反**，用户分不出来。
  - ② **卡片上只有「重试」，而 `retryTask` 是新建一条任务**（新 id、新卡片）⇒
    想「接着跑剩下的」得到的是重复卡片 + 重复产图。
- **改法（6 个文件）**
  1. `src/types.ts`：`TaskRecord` 新增 `interruptedAt?: number` —— **只由启动时**
     `markInterruptedOpenAIRunningTasks` 写入；`executeTask` 每次开始执行即清掉
     （与 `watchdogTimedOutAt` 放在同一处）。**判据读字段，不再匹配文案**。
  2. `src/store.ts`：OpenAI 中断分支写 `interruptedAt: now`；`executeTask` 开头清它；
     新增导出 `continueInterruptedTask(taskId)` —— 走 `executeTask`，
     **与应用启动时那条自动恢复路径是同一个函数**，按已持久化的槽位 / 远端请求续跑、
     已产出的不重发，所以不另立第二套幂等口径。
  3. `src/lib/taskProgressDisplay.ts`：新增 `interruptedDisplay()`，卡片标签「上次没跑完」
     （tone warning），描述写明「已产出 N / M 张」+「点继续会把剩下的接着跑完」；
     在 `getTaskProgressDisplay` 里**排在「数量够了就算完成」之前**（被标记中断的一定是没跑完就断的）。
  4. `src/components/TaskCard.tsx`：新增 `canResume`，中断的任务把按钮从「重试」换成「继续」。
- **验收证据（2026-09-24）**
  - `npm run verify` **EXIT=0**：**270 文件 / 3279 用例** / 359.86s（比上轮多 2 条，即本次新增）。
  - 定向：`taskProgressDisplay.test.ts` + `store.test.ts` **171 例**；
    `TaskCard.test.tsx` + `SopBatchTaskCard.test.tsx` **14 例**。
  - **反向验证精确命中 2 条**：同时撤掉 `store.ts` 的 `interruptedAt: now` 与
    `taskProgressDisplay.ts` 的中断分支 → 恰好
    `marks legacy and OpenAI running tasks as interrupted` 和「中断的任务说「上次没跑完」…」
    变红，**无连带失败**；恢复后全绿。
- **刻意不动的两件事**
  1. **批量编排批次的「启动即自动续跑」保持原样** —— 改成「先问」属于能力回退
     （忘了点就没跑完），要改需另行拍板。
  2. `TaskCard.tsx:456` 那个既有的 `isInterrupted`（`cardLabel === '已停止'`，**只用于选配色**）
     不动 —— 它把「主动停止」和「应用退出」混在一起，但改它会影响观感；
     本次新增的变量改用 `canResume` 避开重名（首次实现时同名，`tsc` 报 `TS2451` 才发现）。
- **未做**：本机无法做渲染验证 ⇒ **界面观感未经真机确认**。请在运行中的应用里过一眼：
  中断的任务卡片是否显示「上次没跑完」、按钮是否为「继续」。

### TB-124 素材库加固：目录结构版本 + 顺序迁移链 + 老库兼容门禁

- **来源**：杰哥 2026-09-23 问「把 `dolag233/Serpent` 嵌入糖包、替换图片素材库模式」的可行性。
  两轮调研结论是**不嵌入**（两个方向都不成立：Serpent 无库入口、其插件领域词汇表里没有「生成 / 任务」
  这类概念），但从中挑出三条工程纪律抄回糖包。完整调研、逐项证据与「明确不采纳」清单见
  `docs/serpent-borrowing-plan.md`。
- **本次落地 P2 + P3**（P1 / P4 见该文档第六节）
  1. **目录结构版本 + 顺序迁移链**（`electron/asset-catalog.ts`）：新增 `CATALOG_SCHEMA_VERSION`
     （当前 1）与 `CATALOG_MIGRATIONS`，把原先散落的三个 `ensureXxx`（tags 树形列 / collections
     颜色·置顶·软删 / assets 命名排序列 + 存量回填）收敛为迁移链的 v1；版本号写在 `catalog_meta`
     表的 `schema_version` 键（走既有的 `getMeta` / `setMeta`）。
     **新库与老库走同一条链** —— 建表 SQL 只含「基础结构」，后加的列一律由迁移链补（见 RISK R-100）。
  2. **老库兼容门禁**（新增 `electron/asset-catalog-compat.test.ts`，12 例）：缺列自动补齐 /
     老数据一条不丢 / 回填只做一次 / 版本号落后补跑 × 最新则跳过（反向验证）/ 坏 json 不崩 /
     **损坏库显式抛错而不是静默变空库** / 迁移链自检（常量 === 最后一节、严格递增无重复）。
     该文件按 vitest 默认收集规则**自动进 `npm test` → 自动进 `verify`**，不需要改任何配置。
  3. **顺手修一处注释与实现不符**：`ASSET_SORT_BACKFILL_KEY` 的注释写「写在 `catalog_meta` 里」，
     实际走 `AppDataStore`（落在 `app_data_records` 表）。注释已改准；**存储位置未动**
     （改它属于扩大范围且无实际收益）。
- **验收证据（2026-09-23）**
  - `npm run verify` **全绿**：`EXIT=0`，**270 文件 / 3277 用例**，371.66s。
  - 主进程全目录另跑过一轮：**203 / 204**，唯一失败是 `catalog-migration-rollback` 的 5s 超时
    （单文件复跑 3.645s 全绿、且该文件不 import `AssetCatalog`），已登记 **R-102**。
  - 反向验证：`asset-catalog-compat.test.ts` 的「版本号已是最新 → 整条迁移链被跳过」是配对证据 ——
    抹掉一列后重开，列**不该**回来；删掉 `runMigrations` 里的版本判断即变红。
- **落地过程中踩到的两个坑**（已登记 RISK）
  1. **R-100**：一度给「全新库」开特例跳过迁移链 ⇒ `:memory:` 新库没有 `file_name` 列，
     一插入就抛 `table assets has no column named file_name`（`asset-catalog.test.ts` 16 例全红）。
     **而当时自己新写的兼容测试是全绿的**（它用真实文件库，走的是「非新库」那条分支）——
     教训：**改核心初始化逻辑，只跑自己新写的测试是不够的。**
  2. **R-101**：`AssetCatalog` 构造函数抛错时 SQLite 句柄拿不到引用、只能等 GC，
     Windows 上会让整个临时目录 `rmSync` 报 EPERM，表现为「用例全绿但 suite 判失败」。
- **未做**
  1. **P1（任务中断要有明确语义）未开工** —— 与 TB-121 / TB-122 / TB-123 动的是同一片区域
     （任务落盘），建议等那条写线收工后再排期。
  2. 本条目是**提交时才补登记**的：此前 `BACKLOG.md` 挂着另一条写线的未提交改动，
     按 R-09「一个字节都别碰对方的文件」没有提前占号。

### TB-123 反向对账：素材在、来源任务不在的留痕

- **来源**：`docs/data-persistence-benchmark.md` 方案 4（同上）
- **状态**：DONE · 写线：主写线
- **诊断**：现有 `reconcileGeneratedAssets` 只做「任务 → 素材」**单向**。反方向此前**没有任何机制**：
  任务记录丢了（TB-122 那种，或用户删了任务卡），它的图会静默落进孤儿组、从卡片视图整组消失
  （`AssetBatchView` 是刻意的：不展示「任务已删除」状态）。界面上看不出是「没加载」还是「真没有」。
- **改动**：`assetReconciliation.ts` 新增 `findOrphanAssets(assets, taskIds)`（纯函数），
  在启动对账末尾调用一次，把「来源任务不存在」与「连 taskId 都没有」两类素材的**数量与样本**
  写进日志 + journal（`generated-asset-orphans-v1`）。**只留痕、不改数据**。
- **验收标准（可测）**：来源任务不存在 → 进 `orphanAssetIds`；无 taskId → 进 `sourceMissingAssetIds`；
  回收站素材不算孤儿；全部有来源时两个清单为空。
- **验证**：新增 4 例（`assetReconciliation.test.ts`）。`tsc -b` ✓ ｜ `eslint` ✓ ｜ `prettier --check` ✓。
- **未做（刻意）**：没有把孤儿组放行到卡片视图 —— 那会违背「不展示『任务已删除』状态」的既有要求。
  孤儿图的入口仍是图片模式与回收站。

### TB-121 批次卡片成员改由任务记录决定（不再从素材反推）

- **来源**：杰哥 2026-09-23 报障（另一台电脑的 v0.3.7 安装版）——同一批 SOP 批次卡显示
  「整批 74 条提示词 · 图片 72/74」，点开该批次的详情弹窗却写「150 条」。原话
  「这个问题我已经让你修过很多次了，但一直没有成功修复」。
- **状态**：DONE · 写线：主写线
- **诊断（同一批次被两套算法各算一遍）**
  1. 卡片走 `lib/assetBatchGrouping.ts` 的 `buildAssetBatchGroups`：**遍历素材**、读 `origins[].taskId`
     **反推**任务；倒推不到的任务被 `includeTaskless`（`status==='done' && !hasTaskFailure` → `continue`）
     静默跳过。素材只加载到第一页时，批次可能连组都建不出来 ⇒ **整张卡片消失**。
  2. 弹窗走 `lib/sopBatchTaskGrouping.ts` 的 `groupSopBatchTasks`：**遍历任务记录**按批次分组。
  3. 口径不同 ⇒ 同一批次两个数字，卡片 74、弹窗 150。
- **硬证据（为什么以前修不好）**：`git log -- src/lib/assetBatchGrouping.ts` 自 rebrand 只被改过 1 次
  （TB-080，素材详情弹窗，与数量无关）；`sopBatchTaskGrouping.ts` **零次修改**；
  `git diff --stat v0.3.7 HEAD` 四个数据层文件里只有 `AssetBatchView.tsx` 变了 17 行（删除文案 + 一个过滤器）。
  ⇒ 历次修复都在下游（UI 取并集兜底 / 落盘守卫 / 加载链 / 文案），**根因位置从未被碰过**。
- **改动**：`buildAssetBatchGroups` 增加「SOP 批次成员补全」——批次成员由任务记录决定，素材只负责挂图。
  只补**已存在**的组（至少有一张图落进来）；完全无产出的历史批次不凭空建卡（避免卡片视图刷屏）。
- **验收标准（可测）**
  1. 同批次 3 条任务（1 条出图 / 1 条 done 无图 / 1 条 error），素材只有 1 张 →
     `taskIds` = 3 条、`summary.total` = 3（**不传** `includeTaskless` 也成立）。
  2. 别的批次的任务不会被并进来。
  3. 完全无素材的批次不建卡。
  4. 批次位置按组内最早提交时间算（补进来的成员也算）。
- **验收证据（本机真实库：586 任务 / 499 素材 / 18 个批次）**

  | 口径                               | 任务计数合计                            |
  | ---------------------------------- | --------------------------------------- |
  | 弹窗（任务驱动 = 真相）            | 585                                     |
  | 旧卡片（素材全量加载）             | 509                                     |
  | 旧卡片（只加载第一页 120 条）      | 130（其中 **10 个批次整张卡片消失**）   |
  | 新卡片（修复后）                   | **585 = 弹窗**                          |

  18 个批次里，旧口径有 **17 个**与弹窗不一致。
- **反向验证**：换入修复前版本重跑，恰好 2 个新用例变红（另 2 个是防越界守护，旧版本本就该绿），
  恢复后 27 例全绿。
- **验证**：`tsc -b` ✓ ｜ 定向测试 61 例 ✓（含新增 4 例）｜ `eslint` ✓ ｜ `prettier --check` ✓。
  **未跑全量 `verify`**：工作区挂着另一条写线的未提交改动（R-74，绿/红都不可信）。
- **遗留（另立条目再做）**
  1. 弹窗有 `keepLatestPromptAttempts`（同 promptId 只留最新一次尝试），卡片没有 ⇒
     单张重试（`retryTask` 沿用同组批次号）时卡片会多算。
  2. 本改动只**统一口径**，没有解决「任务 → 产出图」这条边缺少权威的问题
     （`tasks.outputImages` 与 `assets.origins[].taskId` 两份副本仍在，落盘仍是两条独立路径）。
     根治方向 + 10 个对标方案见 `docs/data-persistence-benchmark.md`。

### TB-119 图片删除：软删退槽 + 删任务卡进回收站 + 清空即彻底清

- **来源**：杰哥 2026-09-23「当在图片模式下单独删除某张图片时，该图片应自行进入回收站，并与对应的
  任务卡解除关联；当整个任务卡被删除时，则其关联的所有图片随任务卡一并进入回收站，以此避免因
  残留引用导致无法删除的情况。此外，请在图片被清空后，彻底清除与这张图片相关的所有信息和缩略图」
- **状态**：DONE · 写线：主写线 · 决策记 `docs/adr/0019-task-delete-moves-outputs-to-trash.md`
- **诊断（三条是同一模型缺口的三种表现；开工前已报方案，杰哥回复「开工」）**
  1. 回收站是**软删**，而 `moveToTrash`（`features/assetLibrary/store.ts`）**不动任务记录**：
     `task.outputImages[slot]` 仍指着它，卡片封面读 `outputImages[0]`、角标读 `outputImages.length`
     ⇒ 删完「封面照旧、张数照旧」，看起来就是**没删掉**。永久删除那边早就有现成语义
     （`patchTaskForPurgedSlots` + `purgedOutputSlots` → 卡片显示「已删除」），软删没用上。
  2. 删任务卡走 `purgeTaskOutputAssets` → **永久删除**（写墓碑 + 删字节 + 删磁盘原图），与要求相反；
     连界面文案都在替它背书（「一并删除，不可恢复」，6 处）。
  3. 永久删除只清图片记录与内存原图：**磁盘缩略图一个没删**，内存那句写成
     `thumbnailCache.delete(imageId)` —— 真实键是 `` `${id}:${variant}` `` ⇒ **一条都没删掉**。
- **验收标准（可测）**
  1. 图片模式删单张 ⇒ 素材 `status='trashed'`，且它所属任务卡的输出槽位被置空、槽位号记进
     `purgedOutputSlots`、其余槽位不动、改动落盘。
  2. 删任务卡 ⇒ 产出图进回收站（**不**永久删除、不写墓碑），仍被其他任务/会话拥有型引用的图保留不动。
  3. 清空/永久删除 ⇒ 内存缩略图 **full + grid 两个通道**都清空，且磁盘缩略图删除接口收到这批 imageId。
  4. 回收站的任务卡视图能看到「删卡后进回收站」的图（孤儿组只在回收站作用域放行）。
- **验收证据（2026-09-23）**
  1. `src/store.test.ts`（158 例，+2）：`把任务卡删掉时，它的产出图移入回收站而不是永久删除`
     （`purgedAssetIds` 不含它 + 素材库内存里 `status==='trashed'` + 别的任务的导出副本不再被删）、
     `退槽：素材进回收站后，任务卡的输出槽位被置空并记为已删除`（槽位置空 / 第二个槽位不动 /
     `purgedOutputSlots===[0]` / 已落盘 / 无关任务不受影响）、
     `永久删除素材时缩略图一起清`（两个通道各断言一次 + `deleteThumbnailsFromDisk(['purged-thumb'])`）。
  2. `src/features/assetLibrary/store.test.ts`（102 例，+2）：移入回收站时调 `detachTrashedAssetsFromTasks`
     并把它回写的素材传进去；退槽抛错时**回收站本身不受影响**（图仍是 trashed，只留痕）。
  3. `src/features/assetLibrary/AssetBatchView.test.tsx`（+1）：回收站作用域渲染出
     `orphan:t9` 且带「任务已删除」；非回收站作用域仍不渲染（原口径不变）。
  4. **反向验证（五处一起改回旧行为，精确命中 6 条，逐条都红在钉住修复的那条断言上）**：
     ① 永久删除改回 `thumbnailCache.delete(imageId)` → 缩略图用例红
     （`expected "vi.fn()" to be called with arguments: [['purged-thumb']]`，即磁盘删除没发生）；
     ② `trashTaskOutputAssets` 改回 `purgeGeneratedAssets` → 删卡用例红
     （`expected ['img-cascade'] to not include 'img-cascade'`）；
     ③ 拿掉 `detachTrashedAssetsFromTasks` 的引用遍历 → 退槽用例红（`expected +0 to be 1`）；
     ④ `moveToTrash` 里拿掉退槽调用 → 素材库两条红；⑤ 回收站放行条件去掉 → 分组视图用例红
     （`expected 0 to be greater than 0`）。恢复后重跑全绿。
  5. `npm run verify` 等效：`tsc -b` + `tsc -p electron/tsconfig.json --noEmit` 双端零错误、
     `eslint` 本轮 9 个文件零告警、`prettier --check` 全部 unchanged、
     **全量 `268 文件 / 3245 用例`全绿**。
     ⚠️ 顺带给了 R-98（「本机 vitest 整体哑掉」）一个实测答复：**本轮已恢复**（定向 15 例 + 全量
     3245 例全绿，同为 `node_modules/vitest/vitest.mjs run`）。**成因仍未定位**，
     故 R-98 的状态一个字都没改（不替别人改条目，R-09）—— 期望下一轮开工时顺手复核。
- **未做 / 说明**
  1. **恢复不接回任务卡**（有意）：不建「图 ↔ 卡片」反查表，撤销/恢复只把图捞回素材库。
  2. **删任务卡仍会删这张卡自己的导出副本**（`localSavedOutputImagePaths`，旧口径不变）：
     那些路径只存在任务记录上，任务一删就再也追不回来。但**别的任务**引用同一张原图的导出文件
     不再删除（图只是进了回收站，删用户磁盘上的副本说不通）—— 见 ADR-0019。
  3. 回收站会变长（删卡是高频操作），清空回收站是显式动作、默认勾选「解除引用并彻底删除」。
  4. **界面改动未做真机观感确认**（本机无法做网页渲染验证）：三处请杰哥过目 ——
     回收站（任务卡模式）里的「任务已删除」卡片、删卡后的 toast 文案、任务卡被退槽后的封面「已删除」。

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
  3. ~~无文字水印 → 生成左下角（`anchor: bottom-left`）标识符层，字号按短边比例~~
     **⛔ 已作废（2026-09-23，杰哥定「按 TB-018 为准」）**：无文字层的预设**不再**生成任何
     标识符层 —— 「无文案水印」就是没有文字。当初那半句原始需求（「没有文字水印的自动在
     左下角添加」）是把「就是没有水印」和「有图标但没文字层」混成了一件事。
     实测与推导见 **TB-018** / `docs/postprocess-watermark-gap-analysis.md` 卡点 2。
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
- **状态**：DONE · 写线：主写线 ——
  曾报「右侧参数栏不显示 / 弹窗偏右」两条，2026-09-22 复核判定**都是本机测量误差**（截图脚本抓错了窗口），
  代码未改，依据见文末「复核记录」；TB-081 的报障本身就证明杰哥能看到参数栏。
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

#### 复核记录（曾报的两条现象，均已判定为本机测量误差）

**曾报「右侧参数栏不显示」—— 已排除**：后来在更大的窗口下重看，参数栏
「素材信息 / 评分 / 颜色标签 / 文件信息 / 来源与参数 / 提示词」全在且能滚。
再加上 TB-081 的报障就来自参数栏里的按钮（见下），可以确认**参数栏本身一直有渲染**。

**曾报「弹窗略偏右」—— 已排除**。2026-09-22 只读复核，四条依据：

1. **CSS 层不存在包含块制造者**：`src/index.css` 与 `src/design-system/styles.css` 里
   没有 `transform` / `contain` / `will-change` / `filter` / `backdrop-filter` / `zoom` 任何一条；
   壳层 `.app-shell-with-docked-panels`（`src/index.css:84`）只有 `display: flow-root` +
   `padding-left/right` —— **padding 不会让 `position: fixed` 后代改为相对它定位**。
   ⇒ 遮罩的内联 `position: fixed; inset: 0`（`AssetViewer.tsx:334`）必然相对视口。
2. **唯一一次程序化测量是对的**：1386×863 视口下 `getBoundingClientRect` 读到遮罩 `width = 1386`
   （= 视口宽）、弹窗 `L51 T73 W1284 H717` —— 左右各 51、上下各 73，**精确居中**。这是数字，不是目测。
3. **那些像素读数全部来自截图目测，而当时的抓图脚本会「抓错窗口」**：它按「窗口标题含 `糖包`
   或 `tangbao`」匹配，而开着 GitHub 仓库的 Chrome 标题
   `nideyilian/tangbao: 糖包 (TANGBAO) — … - Google Chrome` **同时命中这两个词**，
   应用窗口不在时就会抓到浏览器页。该脚本在 `%TEMP%`、非仓库文件；匹配条件已收窄。
4. **反证**：TB-081 的报障原文是「双击图片后弹出的弹窗中，为什么要设置一个『关闭右侧栏』的按钮」——
   那个按钮就在参数栏里。他能看到它，说明参数栏对他可见，弹窗也没偏到被切。

⇒ 本项**不再作为缺陷跟踪**。日后若肉眼看到偏移，走下面的通道复核，**不要再用截图目测数字**。

**本机诊断的正确姿势（拿不到 DevTools 时）**

- **量数字**：把要读的几何写进 `document.title`，再在外部用 Win32 `GetWindowTextW` 读回 ——
  **不截图、不读像素**。比「界面里画调试条 + 裁图找数字」快，且不会看错。
- **截图只用来回答「长什么样」**，且抓完必须核对窗口身份（标题 / 进程名），
  否则会像本次一样被同名的浏览器页骗过。
- `Ctrl+R` / `Ctrl+Shift+R` 在 Electron 里**没有绑定**（`main.ts` 只有 `autoHideMenuBar: true`），
  也没有可用的 CDP 端口。**删文件后 vite HMR 不再可靠**（探针改三次界面都不动），只能重启 dev；
  而 dev 冷启动 + 页面水合要 **60–90 秒**，截太早会看到空白页。

**复现方式**：`npm run dev` → 双击任一素材 → 看弹窗是否居中、右侧「素材信息」栏是否完整可见。

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

---

### TB-086 配置以树为根：配置包按树重排 + 「发布配置 / 拉取最新」配置中心

**背景**（2026-09-22 杰哥原话链：「为什么没有将我的配置一起发布？」→「那个是固定资产啊」→
「中控台」→「所有数据都跟着树来走，树就是根」→「确认」）

- 事实一：发布包按设计只含 `dist/**` + `dist-electron/**`（`electron-builder.cjs:105`），
  中控台那套配置全在本机（`app_data_records` 的 `postprocessMedia` / `projectTreeParams` +
  `localStorage` 里的水印库）。
- 事实二（更要紧）：**导出/导入本身就不全**。`ExportData`（v7）里树结构 / 水印库 / 渠道尺寸是
  **三块并排**，而挂在节点上的 `projectTreeParams` **根本没进包** ⇒ 把包拿到另一台机器恢复，
  结果是「树在、水印在、渠道在，但谁挂谁全断了」。

**验收标准（可测）**

1. 配置包第一层是树；每个节点能读到它自己的：水印选型 / 渠道 / 输出位置 / 命名 / 是否参与产出。
2. 导出 → 导入 round-trip 后本机配置与导出前**逐节点一致** —— 用例要断言节点的字段值，
   不能只断"恢复了几条"。
3. 旧格式（v7 及更早）备份**仍能导入**，恢复结果与改动前一致。
4. 导入前**自动备份**本地配置，可回退。
5. 拉取 = **单向全量覆盖**（发布方的标准配置是权威）；本地自建部分被覆盖前同样有备份。
6. 配置目录**可自行填写**；重启应用后仍能直接读写（不要求重新做一次授权）。
7. 配置包里**不含 API 密钥**（默认排除 —— 放共享盘等于能进那个盘的人都能拿到）。

**结构（定稿）**

```
配置包 v8
└ 全局默认（根）：渠道与尺寸字典、默认输出位置、命名模板、分发排期
   └ 产品线
       └ 产品：水印库（含 LOGO 图）
           └ 方向：渠道选择、输出位置、命名、参与产出
```

**恢复顺序**：立树 → 灌节点参数 → 放水印库 → 挂渠道与输出位置。
顺序反了会出现「引用了不存在的水印 / 渠道」，这类错误极难自查。

**旧 → 新 映射**：`collections` = 骨架本身；`postprocessMedia` 的全局部分 → 根节点；
`compositeV2.presets` → 产品节点；`projectTreeParams` → 方向节点（本轮补进包的就是它）。

**已知的坑（必须一并处理）**：主进程 IPC 路径白名单（R-31 / R-62）只放行 桌面/文档/下载/图片/
userData + `localSettings.localSavePath` + `sessionAllowedRoots`（内存态、重启清空）。
配置目录若是 UNC 路径（如 `\\192.168.202.11\…`）**不在其中** ⇒ 必须做成持久化放行，
否则发布/拉取会卡在 `assertAllowedPath` 而不说真因。

**进度：第一段已完成（2026-09-22 00:20-00:50）**

1. **配置包 v8 结构**（`src/lib/treeConfigBundle.ts`，新增）：以树为骨架 —— 根节点带渠道字典
   与全局默认；**每个节点带自己的 `postprocess` 覆盖**；水印库挂在 `productId` 指向的那个节点下；
   没归属的水印另存 `unassignedWatermarks`（不丢）；回收站节点不导出但**报数**。
2. 组装 / 展平 / 校验 / 还原全在这一个文件里（纯函数）。
3. **导出接线**：`exportData` 与 `exportDataToPath` **两处 manifest 都写** `treeConfig`
   —— 抽了 `snapshotTreeConfigBundle` 作唯一入口（两处各写一遍，迟早漏一处，那正是本轮的病根）；
   `version` 7 → 8。过渡期**双写** `compositeState` / `postprocessMediaState` / `assetCollections`：
   只写新字段的话，≤0.3.2 的老版本导入 v8 包会**静默什么都不恢复**。
4. **导入接线**：见到 `treeConfig` 走新路径（立树 → 灌节点参数 → 挂渠道与输出位置），
   见不到走老路径；水印库两条路都复用 `restoreCompositeBackup`（来自双写）。
5. ⚠️ 树的恢复取「**同 id 覆盖 + 保留本地独有**」，**不是彻底替换**：彻底替换会把使用者自建的
   方向连同挂在上面的素材变成孤儿，而换来的只是"树长得更一致"。**此点与先前方案里说的"单向全量覆盖"
   有出入，等杰哥定**（要彻底一致的话再加一个"清理本地独有节点"的显式开关）。

**验收证据（第一段）**

- `treeConfigBundle.test.ts` 9 例 + `store.test.ts` 145 例 + `backupImport.test.ts` 6 例 = **160 例全绿**。
- **反向验证**：去掉「节点参数跟着节点走」那一行 → **2 failed / 7 passed**，全部 `AssertionError`
  且精确命中钉这条契约的两例（节点参数 / 逐节点一致）→ 恢复后回到全绿。
- v7 老包（`backupImport.test.ts` 构造的那种）仍能导入 ✓。

**第二段也已完成（2026-09-22 00:53-01:05）**

6. **配置中心入口**：设置 → 数据新增「配置同步」卡片 —— 配置目录输入 + 「选择目录」+
   「发布配置」+「拉取最新」，并显示目录里最新一份是哪个文件（点开设置就能看到，不用先点一次）。
7. **拉取前自动备份**：`backupLocalConfigBeforePull()` 把本机配置写到本地保存目录下的
   `backups/backup-before-pull-<时间>.zip`；**备份失败就直接中止**，不做没有退路的覆盖。
   备份存**本机**而不是共享盘（那是自己的历史配置）。
8. **主进程持久化放行**：`local-settings.json` 新增 `configSyncPath`，`getAllowedRoots()` 放行它，
   启动时 `initLocalSavePath()` 一并 `addAllowedRoot`。设置它的 handler **刻意不走 `assertAllowedPath`**
   —— 那个断言要求路径已在白名单里，而手打共享盘 UNC（正是这个功能的主用法）会被它拒掉且不说真因（R-62）；
   改成「基本体检（禁盘根 / 系统目录）+ 显式放行 + 持久化」。
9. **文档**：`architecture-constraints.md` 新增「十、配置以树为根」；
   新增 `docs/adr/0014-tree-rooted-config-bundle.md`。
10. **树改为跟着「包含配置」走**：`assetCollections` 以前只在勾「素材库元数据」时才进包，
    现在 `exportConfig` 就带它（"树就是根"），但**不**顺带把素材索引（`generatedAssets`）发出去
    —— 否则别人的素材库里会多出一堆指不到的条目。

**已知未做**

- 本地独有节点的"彻底替换"开关（见上面的取舍，等杰哥定）。
- 跨外网场景（把配置目录换成 HTTP 地址）—— 应用侧逻辑不用改，只换那个地址。

---

## TB-087 素材库空格快速预览：确认未被弹窗重构破坏 + 修预览层定位偏移（2026-09-22 阿伟）

**背景**：杰哥报「空格按住预览被弹窗重构误改」。排查结论：**没有被改**——
`useAssetLibraryShortcuts`（按住开/松开关 + 悬停素材优先）、`AssetTile`（pointerenter 记录悬停 + 卡片空格）、
`AssetQuickPreview`、store 链路自 fork 起仅 865bbe4 改过样式；定向测试 16 例全绿；
运行中的应用实测（键鼠注入 + 截图）：悬停 A 按住空格预览 A、松开即关、换悬停 B 预览 B，均正常。
「被误改」的体感来自坏 HMR 会话：dev server 昨晚起一直带病运行
（`localSave.ts does not provide an export named 'selectDirectory'` 错误屏，弹窗重构写线残留），整页不可用。

**顺手修**：AssetQuickPreview 预览层 `fixed inset-0` 类在这个壳层不生效（同 AssetViewer / TB-079 实测），
遮罩被 `--app-docked-left-width` 推偏、预览卡片溢出窗口右缘 → 改内联 `style={{ position: 'fixed', inset: 0 }}`。

**验收**：AssetQuickPreview 4 例 + useAssetLibraryShortcuts 2 例 + compliance 10 例全绿；prettier 零改。
**注意**：定位修复未做渲染验证（另一写线占用运行中应用，未再注入按键），请杰哥在应用里按住空格过目。

---

## TB-088 生图发起即建卡：三条入口统一「先建卡、后写词」（2026-09-22 阿伟）

**背景**（杰哥原话）：「当用户发起生图时，无论处于哪种模式（普通生图、SOP 还是配方卡），都应默认立即创建
任务卡片，而非等待提示词生成完毕后再创建……若提示词生成失败或生图失败，直接在卡片中清晰标注失败原因即可，
不要删除卡片或静默失败。」

**实查的现状：三条入口只有一条本来就合规**

| 入口                  | 改前                                                                                                     | 改后                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 普通生图 / 变量提示词 | 点发送即建卡，词在执行时展开（`submitTaskWithData` 建卡 → `executeTask` 内 `renderVariablePromptBatch`） | 不动（本来就是对的，也是本轮抄的先例）                                                |
| SOP 批量 / 配方卡     | 先 `await` AI 写词、成功才建卡；写词失败 → 弹窗一行红字，**画廊零卡**                                    | 来源开跑先建预留卡（「编写提示词中」），词写好就地填进这张卡开跑；失败/取消都标回卡上 |
| 一键衍生              | 先 AI 两阶段反推再建卡，失败只有 toast                                                                   | 先建卡，卡里走「分析参考图 → 生成模板 → 展开生图」，失败标在卡上                      |

**实现**

- `TaskProgressStage` 加 `'prompting'`；`TaskRecord` 加 `promptPending`（词未就绪、**禁止生图**）、
  `promptFailed`（失败在写词环节，卡片文案与生图失败区分开）。
- store 新增：`createPendingPromptTask`（只建卡不执行）/ `fulfillPendingTaskPrompt`（写词并开跑）/
  `failPendingTaskPrompt`（就地标红）/ `cancelPendingTaskPrompt`（标已停止）+ `setPendingTaskPromptMessage`
  （把「正在逐张分析参考图…」这类阶段写进卡）。
- `submitTaskWithData` 加 `deferExecution`（只建卡、跳过 prompt 必填校验、不调 `executeTask`）；
  `executeTask` 开头加 `promptPending` 守卫（防拿占位文案去生图）。
- 失败/取消的卡**一律不删**；`retryTask` 拒绝 `promptPending`/`promptFailed` 的卡（卡上没有可用词，
  硬重试等于拿占位文案生图），`TaskCard` 也不给这种卡显示重试按钮。
- 崩溃收尾：`markInterruptedOpenAIRunningTasks` 优先处理 `promptPending` 的卡，标成
  「提示词生成失败：应用在编写提示词时退出了」，而不是含糊的「请求中断」—— 后者会把排查带偏到接口上。
- **不改**：关掉「自动生图」时先在弹窗里列提示词、等用户点「提交生图」再建卡（那时还没发起生图，提前建卡是乱的）。

**验收标准（可测）**

1. SOP 点开始后，`createPendingPromptTask` 发生在提示词引擎调用**之前** → 卡先于提示词存在。
2. 第一条提示词写进预留卡（`fulfillPendingTaskPrompt`），**不产生第二张卡**。
3. 写词失败 → 该卡 `status:'error'` + `promptFailed` + `error` 含模型原话，**卡仍在 tasks 里**。
4. 取消 → 预留卡 `progressStage:'stopped'`，卡仍在。
5. 一键衍生失败 → 同样留在卡上，不再只有 toast。
6. 卡面文案：写词中「编写提示词中」、写词失败「提示词失败」、生图失败仍是「生成失败」。

**验收证据（2026-09-22）**

- 新增用例 12 条全绿：`store.test.ts` 7（deferExecution 建卡 / fulfill 填词不新建 / fail 标红保留 /
  cancel 保留 / 迟到词不复活 / retry 拒绝 / 崩溃收尾文案）、`GallerySopBatchModal.test.tsx` 2
  （建卡先于写词、失败标在卡上）、`taskProgressDisplay.test.ts` 3（文案三态）。
- `tsc -b` 改动文件零错误；全量 `vitest run` **261 文件全绿**；改动文件 eslint 零告警；prettier 已跑。
- ⚠️ **未做渲染验证**（本机离屏渲染限制 + 运行中应用被另一写线占用）：卡面文案的实际观感请杰哥在应用里过目。

**开工时的环境风险（记一笔）**：落地期间同仓有另一条写线在活跃改 `SettingsModal.tsx` / `localSave.ts` /
`electron/ipc-handlers.ts`（配置目录相关），`tsc` 全量会因为它的半成品红在 `selectDirectory` 未导出上。
本轮按隔离方式做：只跑定向用例 + 过滤后的 `tsc`，提交只 add 自己的文件。

---

## TB-089 多目标产出：「产出目标」+「记住配置」（2026-09-22 阿伟）

**需求**（杰哥原话）：「我在做后处理时，经常需要将同一批素材导出到不同产品的不同方向，但目前系统只能实现本方向的导出」「增加一个『记住配置』按钮：点击后将当前所有配置保存并持久化，在用户下次主动修改之前，系统始终复用已保存的配置」。澄清后确认为**记住「多产品导出时选的那些方向」**。

**为什么现在只能出本方向**：产出目标被写死成单元素 —— `taskPostprocess.ts` 的
`const targetIds = collectionId ? [collectionId] : slice.config.selectedCollectionIds`。
而底层 `buildPostprocessOutputs` 的 `projects` **本来就是数组**（「项目 × 渠道 × 尺寸 × 水印」的笛卡尔积一直在跑），能力早就有、上层只喂了一个。
靠「把素材挂到多个方向」绕不过去：归属取最深的一条（`pickDeepestCollectionId`），同级挂两个只有一个生效、另一个**静默忽略**，而且挂载会改写素材的真实归属。

**做法**：素材库工具栏新增常驻「产出目标」按钮（带已记住的数量）→ 弹窗勾选（可跨产品多选，只列**启用范围内的叶子节点**）+ 逐目标估算产出文件数 → 底部「记住配置」写入 `savedTargetCollectionIds`。

**语义三条（别混）**

- 项目树「后处理」列的勾选 = **启用范围**（哪些方向允许跑），**不改**成产出目标 —— 一勾产品线会让整条线全量产出，磁盘先炸；
- 「产出目标」= **这次产出到哪些**，记住后长期复用（自动与手动都照它跑），直到再改；**空数组 = 没记住** → 按图片归属（原行为，也是默认值）；
- 目标里出现一个已被取消启用的方向 → 跳过它并说明是哪个方向（`PP-SCOPE-001` 的 `detail`），不是照旧产出。

**怎么保证批量导出时各方向输出的正确性与一致性**

| 关心的事                                   | 落点                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **每个方向各用自己那套参数**（唯一真风险） | 参数改为**逐目标 × 逐渠道**重新解析。原先是归属方向解析一次、被所有渠道桶复用 → 后一个方向的文件会**静默写进前一个方向的目录、叠错水印**（不报错，最难发现） |
| 命名段逐目标正确                           | `unit.project` 自带 `line/product/direction`；`selectPostprocessOutputPlan` 逐目标只传单个 `project`                                                         |
| 不互相覆盖                                 | `{seq}` 强制必含且跨图跨目标连续递增；`resolveUniquePath` 另有 `-2` 后缀兜底                                                                                 |
| 不重复产出                                 | 幂等仍按 `rawImageId`（一次执行内所有目标一起展开）                                                                                                          |
| 各方向不同排期                             | 分发已按生效配置分组，天然各排各的                                                                                                                           |
| 写盘量可见                                 | 弹窗逐目标估算「每张图 N 个文件」，乘选中数给总量                                                                                                            |
| 多方向的问题各报一条                       | `reportIssue` 去重键补上 `detail` —— 否则「记住 3 个只出 2 个」时看不出是哪个方向被跳过                                                                      |

**不需要**：bump `persist.version`（纯新增字段，空值 = 旧行为，无旧语义要折算）；改 Excel 往返（导入侧是逐个 action 调用而非整份 `setState`，表里没有的字段既不被导出也不会被抹掉 —— 运行偏好本就不该进表）。

**验收标准（可测）**

1. 记住 N 个方向后，每张图在这 N 个方向各产出一次；`resolveProjectPostprocessSlice` 被以**每个目标的 collectionId** 各调用一次（不是只调归属那一个）。
2. 没记住（空数组）→ 与改动前完全一致（只解析归属方向）。
3. 目标内有方向不在启用范围 → 记 `PP-SCOPE-001`，且 `detail` 含该方向名。
4. 方向级「自动后处理」开关只对**归属方向**生效：目标是别的方向时不被牵连；归属自己就是目标时照旧拦自动触发。
5. `savedTargetCollectionIds` 落盘（`partialize` 白名单）/ 快照 / 归一化往返都带得走；`applyPostprocessOverride` 透传（节点写别的字段时不变 `undefined`）。
6. 弹窗守卫：勾选后点「记住配置」→ 真的写进 store；点「取消」→ 一个字节不写；没启用的方向不出现在列表里。

**验收证据（2026-09-22）**

- 全量 `vitest run` **262 文件 / 3038 用例全绿**（改动前基线 261 / 3032）；`npx tsc -b` 零错误；`npm run lint` 零告警；prettier 已跑。
- 新增/改造用例 14 条：
  - `taskPostprocess.test.ts` 2 → **7**（逐目标解析 / 没记住退回归属 / 逐目标过启用范围且 `detail` 含方向名 / 自动开关只判归属 / 归属即目标时照旧拦）
  - `PostprocessTargetsDialog.test.tsx` **5**（新）：只列启用范围内的方向 / 勾选后「记住配置」真的写进 store / 已记住时带入勾选 + 恢复按归属 / 取消不写盘 / 无启用方向给空态
  - `storePostprocessMedia.test.ts` **+5**：默认与旧数据为空 / 写入·快照·归一化往返 / 归一化清洗 / clear / **落盘白名单契约（全字段覆盖 + 守卫自检）**
  - `postprocessMedia.test.ts` **+2**：`applyPostprocessOverride` 透传该字段 / 节点层与 `byMedia` 都改不动它
- **反向验证 4 轮，全部精确命中**（每次失败都是 `AssertionError`、且只有目标用例红、其余照过）：
  1. 产出目标退回单元素 → **3 failed / 4 passed**（恰好那 3 条）
  2. 逐目标解析退回归属方向 → **1 failed**：`expected Set{'direction-a'} to equal Set{'direction-a','direction-b'}`
  3. 落盘白名单删掉该字段 → **2 failed**：`to include 'savedTargetCollectionIds'` / `toEqual([])`
  4. 弹窗「记住配置」的写入改坏 → **1 failed**：`expected [] to deeply equal ['direction-b']`
- 配方与可复用测试手法写进 `docs/tangbao-ops-runbook.md` §20（全局配置加字段的六处清单 / 落盘白名单怎么验 / 多目标正确性用「断言入参」而非「断言产出文件」）。
- RISK 的 R-47（新增字段漏白名单）与 R-65（重建对象丢字段）本轮**未新增条目** —— 属于同一家族，但各自的缓解措施被加强（落了全字段覆盖守卫与透传用例）。
- ⚠️ **未做渲染验证**（本机离屏渲染受限）：工具栏按钮与弹窗的实际观感请杰哥在运行中的应用里过目。

### TB-089 修订：改成跨产品的树，且只作用于手动（2026-09-22 傍晚，同一写线）

**报障**（杰哥 + 截图）：「产出目标不对，应该要映射一个树来让我选择，现在只显示了其中当前产品的，
而我需要跨产品」；随后补一句边界：「我这个只针对于手动后处理，不需要改自动后处理的」。

**原设计的两处硬伤**

1. 弹窗是**扁平平铺清单** —— 一长条看不出层级，也没法一次勾掉一整个产品；
2. 只列**启用范围内的叶子** —— 而「启用范围」是**自动后处理**的开关。用户要跨过去的那个产品若没参与
   自动产出，整支在弹窗里根本看不见，等于把「跨产品」这个核心诉求从源头掐掉。
   作者原意是躲「勾了却不产出」的坑，但躲错了地方：该躲的是**自动**，不是手动。

**改法（两处改 + 一处不动）**

| 落点                           | 改动                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostprocessTargetsDialog.tsx` | 扁平平铺 → **可展开的树**（产品线 → 产品 → 方向），**整棵树都在、跨产品可选**；勾中间层 = 其下方向一起勾，**落盘只有叶子**（命名段 `{direction}` 取路径末段）；未启用的叶子标「未启用」提示但**不拦着选**；折叠态是纯界面态，不进 store |
| `taskPostprocess.ts:263`       | 产出目标按 `source` 分流：`source === 'manual'` 才读 `savedTargetCollectionIds`，自动触发置空                                                                                                                                             |
| `taskPostprocess.ts:291`       | `PP-SCOPE-001`（启用范围）补 `input.source !== 'manual' &&`，与 `PP-SCOPE-002` 同一个套路                                                                                                                                                 |
| **不动**                       | 启用范围（`selectedCollectionIds`）一个字节没改 —— 它仍是自动后处理的路由开关                                                                                                                                                             |

**作废的旧语义**：原文「自动与手动都照它跑」不再成立。产出目标是**手动场景**的概念 —— 掺进自动跑之后，
用户在这儿勾什么就会悄悄改变自动产出的去向，而自动产出是在他没看着的时候发生的。

**`PP-SCOPE-001` 的 `hint` 跟着改**：原来只写「在项目树里勾选该方向（或它的上级），再重跑这一批」，
现在补上第二条出路「只想产这一次，就选中素材手动跑一次（手动不受启用范围限制）」。

**验收标准（本轮增量，已在测试里钉住）**

1. 弹窗：启用范围**之外**的产品线 / 产品 / 方向照样出现且可勾（`清爽` 用例）；
2. 弹窗：勾中间层 → 其下方向全进草稿，落盘**只有叶子 id**；
3. 弹窗：折叠父节点后子级不再渲染，展开又回来；
4. 手动触发：记住的目标跨出启用范围**不报** `PP-SCOPE-001`，且逐目标各解析一次参数；
5. 自动触发：**不读** `savedTargetCollectionIds`（记住 B、归属 A 时仍只解析 A）；
6. 自动触发：归属方向不在启用范围内照旧记 `PP-SCOPE-001`（防回退）。

**验收证据（2026-09-22 傍晚）**

- 全量 `vitest run` **262 文件 / 3108 用例全绿**；`npx tsc -b` 零错误；`eslint` 零告警；prettier 已跑。
- 用例数：`taskPostprocess.test.ts` 7 → **9**；`PostprocessTargetsDialog.test.tsx` 5 → **8**。
- **反向验证 3 轮，全部精确命中**（每轮只有目标那几条红、其余照过；每次改完已回读校验复原）：
  1. `PP-SCOPE-001` 去掉「只拦自动」→ **1 failed / 8 passed**：`expected [ 'PP-SCOPE-001' ] to not include 'PP-SCOPE-001'`
  2. 产出目标改回「自动也读」→ **1 failed / 8 passed**：`expected Set{ 'direction-b' } to deeply equal Set{ 'direction-a' }`
  3. 弹窗树改回「只列启用范围内的节点」→ **5 failed / 3 passed**，渲染结果退回 `✓月亮 ✓图标` 两个孤立叶子（层级与工具线全消失）
- ⚠️ **未做渲染验证**（本机离屏渲染受限）：树的展开 / 缩进 / 复选框对齐，请在运行中的应用里过目。

---

## TB-090 删除类弹窗的 × 压住正文：ds 基础类吃掉定位工具类（2026-09-22 阿伟）

**背景**（杰哥报障 + 截图）：删水印预设时弹「删除预设？」，右上角的 × 跑到正文第一行上，
压住「将永久删除预设「…」。」的开头。杰哥判断「其他删除的弹窗也有这个问题」。

**根因（一步定位）**：`main.tsx` 的加载顺序是 `./index.css`（Tailwind utilities）→ 再
`./design-system/styles.css`，两者特异性相同（单类）→ **后写的赢**。
`.ds-button, .ds-icon-button { position: relative }` 因此吃掉了 `className="absolute right-4 top-4"`：
按钮**留在文档流里**（正文被顶到它那一行）、再被 `top/right` 平移 16px → 正好压在正文上。
构建产物里可直接验证：`.absolute{position:absolute}` @6105 **早于** 基础类 @64924。

**扫全仓**：写 AST 扫描（ds 组件 + `ds-*` 类两种形态），同类漏项共 **3 处**，其余 6 处早已手写 `!absolute`：

| 位置                                               | 症状                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ConfirmDialog.tsx:135`（所有删除/清空弹窗共用）   | × 压住正文第一行（本轮报障）                                                                        |
| `AssetLibraryWorkspace.tsx:910` 移动端导航关闭键   | 留在流里 + 平移 8px；且 `min-h-ds-control-lg` 也被基础类的 `min-height` 吃掉（触控高度长不到 40px） |
| `WorkspaceTabBar.tsx:518` 窄屏「打开标签页」悬浮键 | `fixed` 失效 → 不悬浮，挤进标签栏流里                                                               |

**改法**：定位/尺寸工具类加 `!` 前缀（`!absolute` / `!fixed` / `!min-h-ds-control-lg`），
**不动全局加载顺序**（会让一批本来靠 ds 赢的规则与 `!important` 一起翻车，属单独评估）。
判据与配方写进 runbook §21；风险登记 R-80。

**验收标准（可测）**

1. 弹窗关闭键 `className` 含 `!absolute`；`.ds-icon-button` 的 `position: relative` 不再赢。
2. 全仓扫描「ds 组件 + 定位工具类」无一处缺 `!`。
3. 改动文件 `tsc -b` / `tsc -p electron` / eslint / prettier 零错。

**验收证据（2026-09-22）**

- 定向用例 **29 文件 / 540 例全绿**（`src/design-system` + `src/features/assetLibrary` + `WorkspaceTabBar.test.tsx`）；
  `tsc -b`、`tsc -p electron/tsconfig.json --noEmit`、eslint、prettier 全部零错。
- **反向验证（实做，精确命中）**：把 3 处 `!` 去掉 → 新增合规用例报
  `expected [ …(3) ] to deeply equal []` 并逐条列出那 3 个文件:行；
  `ConfirmDialog.test.tsx` 报 `expected 'absolute right-4 top-4' to contain '!absolute'`；
  恢复后 14/14 全绿。
- **新增守卫**：`compliance.test.ts`「设计系统组件的定位工具类必须加 ! 前缀」（AST + 文本双扫）；
  `ConfirmDialog.test.tsx` 补 `!absolute` 断言（原先只断言「存在 + 点得动」，正是这样漏掉的）。
- ⚠️ **未做渲染验证**（本机离屏渲染限制）：修复前的表现由杰哥截图确证、修复后请杰哥在应用里过目一次。

---

## TB-091 尺寸编辑面板对齐修正：字段行两套基线 + 图标压文字（2026-09-22 阿伟）

**背景**（杰哥报障 + 截图）：「编辑尺寸」面板（中控台 → 渠道与尺寸 → 点尺寸名展开）对齐乱，
要求按设计规范逐一排查各尺寸编辑模块并修正对齐 / 间距 / 位置。

**实测差异**（在杰哥给的截图上量测，该截图缩放 0.756：1 截图 px ≈ 1.32 CSS px）

| 现象                     | 量测                                                            | 成因                                                                 |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| 标签出现**两条基线**     | 渠道 / 体积上限 标签 y 47–57；宽 / 高 标签 y 67–76 → 差 20px（≈26 CSS px，正好一个标签行高 + 字段内间距） | 行用 `align="flex-end"`（底对齐），而只有 渠道 / 体积上限 有 `helperText` → 它们整体被顶高 |
| 输入框同样两条基线       | 渠道 / 体积上限 输入框 y 64–94；宽 / 高 y 84–113 → 差 20px       | 同上（底边对齐，顶部自然错开）                                        |
| 「应用」落在两套基线之间 | 应用底边与 宽 / 高 齐，但比 渠道 / 体积上限 低 20px              | 同上                                                                 |
| 「删除尺寸」图标压在文字上 | 图标单独一行、文字在第二行                                      | `<Button>` 把图标当 children + Tailwind preflight 的 `svg{display:block}` |
| 「添加渠道」比输入框高 4px | 按钮 40px 居中在一个 48px 盒里（空 label 仍占 8px 字段内间距）    | 行用 `items-center`                                                  |
| **状态一变就跳**         | 宽 输入非正整数 → 多一行红字 → 底对齐让整行上移                  | `flex-end` 的派生问题（「各状态对齐」的关键一条）                     |

**改动（4 个文件）**

1. `ConsoleMediaTables.tsx` · SizeEditor 字段行 `align="flex-end"` → `align="flex-start"`：标签一条线、控件一条线
   （控件高度都是 `--ds-control-lg`），说明 / 错误文字各自往下挂。
2. 同处新增**操作区容器**：`<div className="ds-field">` + `<span className="ds-field__label invisible" aria-hidden>操作</span>`
   —— 借字段自己的标签槽占位，操作按钮就落在**控件那条线**上（同一份 class / token，不写死像素；
   以后改字号或字段间距会自己跟着走）。`invisible` 只占位不显形、`aria-hidden` 让读屏跳过。
3. 「删除尺寸」/「添加渠道」/ 资产树「业务线」三个按钮的图标改走 `leadingIcon`（不再当 children）。
4. 「添加渠道」行 `items-center` → `Inline align="flex-end"`（对空 / 非空 label 都成立）。

**守卫（防复发）**

- `compliance.test.ts` 新增「Button 里的图标走 leadingIcon」（AST 扫全仓 `*Icon` 当 children）——
  存量 3 处已清零，再写即红。
- `ConsolePostprocessSections.test.tsx` 新增一条用例，钉住：字段行 `alignItems === 'flex-start'`、
  操作区含 `.ds-field` + `invisible` + `aria-hidden` 占位槽、删除尺寸图标是 `button > svg`（不是 `span > svg`）。

**验收证据（2026-09-22）**

- 定向用例 **36 文件 / 540 例全绿**（`src/features/composite` + `src/design-system`），新增 1 例 + 1 条合规规则。
- `tsc -b` / eslint / prettier 零错。
- **反向验证（三处修复逐一关闭，均精确命中）**：字段行改回 `flex-end` → `expected 'flex-end' to be 'flex-start'`；
  占位槽去掉 `invisible` → `expected 'ds-field__label' to contain 'invisible'`；
  图标改回 children → `expected null not to be null`。三次都是 1 failed / 28 passed。
  新增合规规则同样反向验证：把资产树按钮改回 children → 恰好 1 条违规，点名 `ConsoleAssetTree.tsx:359`。
- **渲染验证（部分）**：在运行中的 dev 应用里截图确认「项目树 + 业务线」按钮由「图标 / 文字分两行」
  变为**一行**（`leadingIcon` 生效）。⚠️ 字段行的对齐修正**未做渲染验证**（需要点开面板，而应用当时有人在用），
  其正确性由 `.ds-field` 的同槽位保证（标签 13px × 1.25 + 字段内间距 8px），请杰哥打开面板过目一次。

**查到但没动的差异（等杰哥定）**

- 4 处字段用 `label=""` 靠 placeholder + `aria-label` 顶替**可见标签**（COMPONENTS 2.3 TextField 强制「可见 label」）。
  标签文案属内容决定，没自己编。
- 行内微间距用 6px / 2px（`gap-1.5` / `py-0.5`）不在 MASTER 4.4 的 4px 基准上 —— 但全仓 **34 个文件**都在这么用，
  属既有风格，单独改这一处只会制造不一致。
- 面板内边距 12 / 8px（紧凑行内编辑器的取舍），低于「卡片内边距优先 16 / 20 / 24px」。

## TB-092 水印预设卡改成长条两栏卡：标题与操作分区、按钮常驻（2026-09-22 阿伟）

**背景**（杰哥报障 + 截图）：水印库（`PresetManagementTab` 左栏）每套水印挤在同一行里 ——
勾选框 / 名字 / `N层 · WxH` / 「复制到…」/ 复制图标 / 删除图标，六样东西共处一行。名字一长就被截断，
后面的规格与图标贴着它跑，整列扫下来没有任何一条竖线可对；而且操作按钮**只在选中的那一行渲染**，
想删某一套还得先点选它。

**要求**：改成更高的长条卡片、增加整体高度、按栏位对内容分区、标题与操作分置不同区域、
块与块之间留出清晰间距。

**改动（组件 1 个 + 测试 1 个）**

| 项         | 改前                                              | 改后                                                                                              |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 卡片高度   | ~30px（`py-1.5`，单行）                           | **~60px**（`py-2` + 上下两栏）                                                                    |
| 结构       | 单行 flex，名字 `flex-1` 与规格 `justify-between` | **上栏**：勾选框 + 名字（`truncate` 独占整行）；**下栏**：左规格 / 右操作，`pl-6` 与名字左缘对齐  |
| 操作按钮   | 仅 `selectedPreviewPresetId` 那行渲染             | **每张卡常驻**，落成固定的一列                                                                    |
| 按钮配色   | 复制 = primary 蓝、删除 = danger 红               | 默认 `text-ds-muted`，hover 才上色（常驻后一列红蓝图标会把名字压得看不见）                        |
| 列表行间距 | `space-y-0.5`（2px）                              | `space-y-1.5`（6px）                                                                              |
| 重命名态   | 单行 `py-0.5` input，卡片缩到 ~40px               | 外层 `flex min-h-11 items-center` 兜住高度，进编辑不再整列跳动                                     |

**顺带补的必要补偿**（是「按钮常驻」的副作用，不是自由发挥）

- 行内删除 / 复制的 tooltip 原本**完全同名**（`删除预设` / `复制为新预设`）。常驻后同一个提示在列表里
  出现 N 次，hover 也分不清删的是哪套 → 补上预设名：`删除预设「<名字>」`。
- 每张卡加 `data-testid="preset-row-<id>"`：同一个 `preset-copy-one` 现在列表里出现多次，
  测试必须能落到具体某一行（否则拿到的是第一行那套）。

**验收证据（2026-09-22）**

- **全量**：`262 文件 / 3041 例全绿`；`tsc -b` / `eslint .` / `prettier --check` 零错。
- **定向**：`PresetManagementTab.test.tsx` 24 例通过（含新增 1 例守卫）。
- **反向验证**：把「按钮常驻」改回 `preset.id === selectedPreviewPresetId &&` 包裹后，
  新增守卫用例**精确失败**（`1 failed | 23 passed`），其余 23 例仍绿 → 测试确实钉的是「常驻」这件事；
  恢复后 24 例重新全绿。
- 同步改了 2 处**既有**测试断言（行为变化导致，非放宽）：`删除预设` → 按名字定位到 preset-b 那行；
  `openCopyDialog` 新增 `rowPresetId` 参数按行定位。
- ⚠️ **未经渲染验证**：本机离屏渲染被环境拦死（见 `MEMORY.md`「无法做网页渲染验证」），
  60px 卡片高度与两栏对齐的实际观感需杰哥在运行中的应用里过目（dev 41731 当时在跑，HMR 自动刷）。

**未做（超出本次要求，等杰哥定）**

- 「未分配」区（`preset-unassigned`）仍是单行紧凑排布，没跟着长条卡一起改 —— 那是次要区，
  同一屏里两套行高会有对比，但改了会扩大改动面。
- 左栏宽 300px，下栏「规格 + 三个操作」实占约 193px / 可用 244px，余量够；
  若以后加第四个操作按钮需要重新算宽度或把「复制到…」收成图标。

## TB-093 中控台「输出位置」并入「渠道与尺寸」：两个 tab 合成一个「渠道与输出」（2026-09-22 阿伟）

**背景**（杰哥 2026-09-22 要求）：右区那排 tab 里，「渠道与尺寸」与「输出位置」两张表**大部分是同一份数据**
—— 都是「一行一个渠道」—— 却各占一个 tab：渠道名 / 尺寸规格 / 参与产出 在一处、导出位置在另一处，
「这个渠道出到哪」得看两个地方。要求合成一张表，因为二者参数与基本框架相同。

**已确认的前提（查证记录，别再重查）**

- 「尺寸表」2026-09-21 起已是**一行一个渠道**（详细尺寸改成格内复选框组，见 `ConsoleMediaTables.tsx` 头注）
  → 与渠道表**粒度一致**；当初「1:N 压成一张会让渠道名重复」这条分表理由**已经不存在**，合并才成立。
- 中控台传给 `ChannelOutputDirs` 的 media **不含 clean**（`DEFAULT_POSTPROCESS_MEDIA` 只有 4 家）
  → 纯净版本来就不在导出位置表里，合并不涉及它。

**形状（预览图已过目，2026-09-22）**：一个渠道占 1 行（单写）或 2 行（双写）

| 列       | 内容                                                                   | 层级     |
| -------- | ---------------------------------------------------------------------- | -------- |
| 渠道名   | 可改名；**跨行合并**                                                   | 全局一套 |
| 详细尺寸 | 格内复选框组（点尺寸名开 `SizeEditor` 改宽高 / 体积上限 / 移渠道）     | 全局一套 |
| 参与产出 | 开关；**跨行合并**                                                     | 跟作用域 |
| 导出位置 | **一行一个位置**（位置1 在上、位置2 在下），留空显示继承落点           | 跟作用域 |
| 操作     | 🗑 删渠道（该组首行）/ ✕ 删这个位置（逐行）/ + 往下加一个位置（末行）    | ——       |

- 「尺寸数」「可用尺寸」两个派生列**删除**：复选框组本来就是为了「一眼数出配了几套」才做的。
- 导出位置选**上下排列**而不是左右两列（杰哥 2026-09-22 改的口径）：与 Excel 的合并单元格读法一致，
  而且路径列能拿满剩余宽度 —— 这个表历史上为「路径显示不全」报过两次障。

**tab 结构**：3 → 2（水印 / 渠道与输出）。`output` 与 `media` 两个旧 id 都要进 `RETIRED_SECTION_ALIASES`，
否则老状态认不出会被弹回水印（等于把「我上次停在哪」默默抹掉）。分区内部顺序：
作用域条 → 默认输出位置 → 画面方向 / 画面适配 → 渠道主表 → 纯净版 → 文件命名 → 分发 → 产出预览。

**验收标准（可测）**

1. 右区只有 **2 个** tab；`normalizeControlConsoleSection('output')` 与 `('media')` **都返回新分区 id**；
   `CONTROL_CONSOLE_SECTIONS[0].id` 仍是 `watermark`（默认 tab 不能被换掉）。
2. 双写渠道（`mediaOutputDirs[id]` 有两个值）在表里**占两行**，渠道名 / 详细尺寸 / 参与产出三格跨两行；
   改第 2 行路径**只写进第 2 个位置**，第 1 个位置的值不变。
3. 节点作用域下改路径写进该节点 `byMedia[id].outputDirs`，全局 `mediaOutputDirs` **不动**（与合并前同一口径）。
4. 删位置的语义不变：删中间那个位置其余**上移**；删到一个不剩 = 该渠道回「留空」（全局落到默认位置、
   节点继续向上继承）。
5. **全局规格不随作用域变**：节点作用域下改渠道名 / 尺寸勾选，写的是全局那一份。
6. Excel 四张 sheet（`channels` / `channel_sizes` / `output_dirs_global` / `output_dirs_node`）的
   字段与形状**不变** —— 那是数据形状，与界面怎么摆无关。

**状态**：**已完成**（2026-09-22）。

**验收证据（2026-09-22）**

- **全量**：`261 文件 / 3043 例全绿`。比上一条少 1 个文件、多 2 例 —— 删掉 `OutputSection.test.tsx`（2 例），
  新增 2 例合并形态守卫、并从它搬了 2 例进 `ConsolePostprocessSections.test.tsx`。
  `tsc -b` / `tsc -p electron/tsconfig.json` / `eslint .`（**零 warning**）/ `prettier --check` 全绿。
- **反向验证**（两条都精确命中，证明守卫真的在钉这件事）：
  1. 把三列的 `spanRows` 改成恒返回 1（= 关掉跨行合并）→「⭐ 双写占两行」**精确 1 例**失败；
  2. 把 `onChangeDir` 的下标写死成 0 →「⭐ 双写的第 2 个位置写进第 2 槽」＋既有「并支持双写」共 **2 例**失败。
- **过程发现（已登记 RISK R-82）**：第一版把「加尺寸」入口漏了 —— 尺寸表整张消失后，它的行级动作
  无处安放（字段有列可对齐，动作没有）。是**既有守卫**抓到才补回的，现在贴在「详细尺寸」格内。
- ⚠️ **未经渲染验证**：本机离屏/无头渲染被环境拦死（见用户级记忆「无法做网页渲染验证」），
  所以**路径列实际能显示多少字符、跨行合并的观感、组内两行的辨识度**需杰哥在运行中的应用里过目。
  实现口径：`详细尺寸` 列固定 300px（它是 `flex-wrap` 复选框组，不固定宽会抢走弹性空间）、
  路径列不给宽 → 拿剩余。真机上若仍嫌窄，调这个固定宽即可。

**改到的文件**

| 文件                                                                                                                    | 改动                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `features/composite/lib/controlConsoleSections.ts`                                                                      | 分区 3 → 2（`watermark` / `channel`）；`output` / `media` / `distribution` 进别名表 |
| `features/composite/components/ChannelSection.tsx`                                                                      | **新增**：合并后的分区（画面方向 / 画面适配 / 渠道主表 / 纯净版 / 命名 / 分发 / 产出预览） |
| `features/composite/components/ConsoleMediaTables.tsx`                                                                  | 加导出位置列 + 三列跨行合并 + 操作列三动作；删「尺寸数 / 可用尺寸」两列    |
| `features/composite/components/MediaSection.tsx` · `OutputSection.tsx` · `OutputSection.test.tsx`                        | **删除**（内容合入 `ChannelSection`；三查确认无引用）                     |
| `features/composite/CompositeWorkspace.tsx`                                                                             | tab 渲染分支合一                                                         |
| `controlConsoleSections.test.ts` · `CompositeWorkspace.test.tsx` · `ConsolePostprocessSections.test.tsx` · `PostprocessSettingsModal.test.tsx` | 分区 id 与表格 aria-label 的断言更新 + 新增 2 例            |
| `src/design-system/catalog.ts`                                                                                          | `ChannelSection` 新增登记；撤掉两条已删文件；表格本体职责描述更新         |
| `docs/adr/0015-*` · `docs/RISK.md`（R-82） · `design-system/tangbao/pages/postprocess.md` · `docs/tangbao-ops-runbook.md` | 决策 / 风险 / 界面说明 / 配方同步                                        |

## TB-094 文字水印不再「自己换行」：框宽只用来定位，不再当排版约束（2026-09-22 阿伟）

**现象**（杰哥 2026-09-22 报障 + 截图）：一套合规水印「具体活动或商品优惠以活动页面或商品详情页信息为准」
**没设换行却自己断成两行**，末字「准」被推到第二行。杰哥的判断「宽度被自动固定了」是对的 —— 就是框宽在断行。

**根因**（查的是**真实落盘数据**，不是推测 —— 从 `%APPDATA%\tangbao\Local Storage\leveldb` 里挖的预设）：

| 事实               | 实测值                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| 该层框宽 / padding | `position.width = 448` / padding 8 ⇒ 框内可用 **432**                        |
| 框宽是什么         | **历史数据**（旧版文本层的框是手拖的 / 铺满画布的），不是当前文案的自动适应结果 |
| 要画的字           | `★`（标识符前缀，`storeV2.identifier`）+ 23 字 = **24 字 × 18px = 432**，**正好卡在边界** |
| 结果               | 超出一丁点（★ 的实际字宽 / 浮点误差）→ 折行逻辑把末字推到第二行               |

⚠️ 这是**上一条修复（`c4399ad`）带出来的**：那次为了让带标识的长文案不再被 `fillText(maxWidth)` 压扁，
改成了逐字折行 —— 压扁治好了，但折行把「差一像素」放大成「差一行」。**两次都是拿「框宽」当硬约束。**

**决策**：框宽**只用来定位**（对齐锚点 + padding），排版只看文案自己的换行符。

- `fillText` / `strokeText` **不传 maxWidth**（canvas 收 maxWidth 是横向压缩，不是换行）；
- 删掉 `wrapCompositeTextLine`（已无调用方）；
- 溢出按 `align` 向外长：`right` 保持右边缘不动、往左溢出，`center` 两边对称 —— 水印这几行本来就贴边对齐。

**为什么不「让框架跟着字长」**：框是**持久化数据**、还要乘以目标尺寸的缩放比，而标识符是**运行时派生值**
（不写回预设，见 ADR-0006）—— 改框就得在导出 / 复制 / 撤销时反复处理「这段是不是用户自己写的」。
渲染时按文案自然宽画、框只定锚点，是唯一不用把派生值写进预设的做法。

**验收标准（可测）**

- 24 字文案 + `★` 前缀（框内宽正好 432）⇒ **只调用一次 `fillText`**，且**不传 maxWidth**；
- 手动敲的 `\n` **仍生效**（两行画两次）；
- 右对齐时文字右边缘 = 框右边缘 − padding（溢出方向不漂移）。

**状态**：**已完成**（2026-09-22）。

**验收证据（2026-09-22）**

- 新增 2 例守卫（`compositeRendererV2.test.ts`）：用**记录调用的假 ctx** 驱动 `drawLayer` 验证
  （jsdom 没有 canvas 实现，这也是 `drawLayer` 为此导出的原因）。
- **反向验证**（两条都精确命中，且**只**挂新守卫）：
  1. 把逐字折行塞回去 → 「整行只画一次」失败：`expected [ { …(4) }, …(1) ] to have a length of 1 but got 2`；
  2. 把 `maxWidth` 塞回去 → 同一例失败：`expected 432 to be undefined` —— **432 正是上表算出的框内宽**，
     与数据推出的结论逐位对上。
- 全量：`261 文件 / 3053 例全绿`（删掉 5 例折行用例、新增 2 例守卫）。
  `tsc -b` / `tsc -p electron/tsconfig.json` / `eslint .`（零 warning）/ `prettier --check` 全绿。
- ⚠️ **未经渲染验证**：本机离屏渲染被环境拦死（用户级记忆有记录）；杰哥在运行中的应用里过目（dev 已 HMR）。

**改到的文件**

| 文件                                              | 改动                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `features/composite/lib/compositeRendererV2.ts`   | 文本分支：删掉折行与 maxWidth（框宽只用于 `textX` 定位）；`drawLayer` 导出供测试 |
| `features/composite/lib/compositeTextLayout.ts`   | 删除 `wrapCompositeTextLine`；`measureCompositeTextBox` 头注写明「这是框、不是排版约束」及两个原因 |
| `features/composite/lib/compositeRendererV2.test.ts` | 新增假 ctx 工具 + 2 例守卫                                            |
| `features/composite/lib/compositeTextLayout.test.ts` | 删掉 5 例折行用例（函数已删）                                          |
| `docs/RISK.md`（R-83） · `docs/adr/0006-*`        | 风险登记 + ADR 补「标识符不进框，所以框宽不能断行」                        |
| `docs/tangbao-ops-runbook.md`（§二十三）           | **配方**：从 LevelDB 挖真实预设数据（dev/正式版两处路径、UTF-16LE、只读） |

---

## TB-095 导出位置「跟随上级」要把继承来的位置念全（2026-09-22 阿伟）

**现象**（杰哥 2026-09-22 报障 + 截图）：上一级给某个渠道配了**两个**导出位置（双写），
在它下面的方向里，那个渠道只显示**一个**位置和一句灰字「留空则 D:/百度A」。

**先定性（这一步决定了修什么）**：跟随**本来就是整份列表** —— 用临时探针实测，
父级 `byMedia.baidu.outputDirs = ['D:/A','E:/B']` + 本级留空 ⇒ `resolvePostprocessOutputDirs` 返回**两处**，
产出侧两处都写。所以**不是行为缺失，是界面显示少于实际生效**。

三处成因都在显示层（`ChannelSection` 的 `inheritedHint`，自己扫父节点 `byMedia`）：

| 成因                                     | 后果                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| 只取列表第 1 个（`dirs[0]`）             | 上一级两处只念一处 —— **本次报障**                                |
| 只看**直接父节点**那一层                 | 上一级没配、更上层配了 ⇒ 报成「默认输出位置」                      |
| 只看 `byMedia`，不看父级通用 `outputDir` | 父级用通用输出目录覆盖时同样错报                                  |

⚠️ 这三处正是 `ChannelSection` 头注自己禁的写法（「生效值一律走既有解析函数，不在界面里自己拼一遍继承」）
—— 它是那句话的漏网之鱼。弹窗侧（`PostprocessParamPanel`）还有一份同源实现，且错得更彻底：
取 `sliceUp.config.outputDir` 拿不到按渠道配的目录（那条在 `mediaOutputDirs[mediaId]` 里）⇒ **恒定**错报默认位置。

**修法**（杰哥选 A：只把灰字说准，**不动表格结构**）

- `ChannelSection`：`inheritedHint: (mediaId) => string` → `resolveInheritedDirs: (mediaId) => string[]`，
  值来自 `resolvePostprocessOutputDirs(resolveProjectPostprocessSlice(…, scope, …).config, mediaId)`
  （口径**含本级**：框空 ⇒ 本级没配 `byMedia` 目录，但本级通用 `outputDir` 同样管这个渠道）；
- 新增纯函数 `formatInheritedOutputDirsHint(dirs)`：一处 ⇒「留空则 D:/A」；两处 ⇒「留空则继承 2 处：D:/A、E:/B」
  —— **数量写在最前**，共享盘长路径被输入框截断时，那一眼要看到的就是「几处」；
- 两个共用组件（中控台 `ConsoleMediaTables` / 弹窗 `ChannelOutputDirs`）的 props 同步改为列表；
- 弹窗侧 `PostprocessParamPanel` 一并改用 `resolvePostprocessOutputDirs`（含本级链）；
- 说明条那句改为「导出位置留空则沿树向上继承；整条链都没配过才落到 {默认}」——
  与逐格灰字分工：**兜底终点**留在条上，**每格落点**由灰字说（原先那句话会被读成「每个空框都落这里」）。

**验收标准（可测）**

- 上一级某渠道两处 ⇒ 该渠道第一行 placeholder = `留空则继承 2 处：A、B`；
- **隔层**（更上层配两处）⇒ 同样念出两处；
- 上一级用通用 `outputDir` ⇒ placeholder 跟着变成那条；
- 纯函数四种输入（两处 / 一处 / 空列表 / 全空串）各有固定文案。

**验证**

- **反向验证（精确命中，且只挂新守卫）**：
  ① 把 `resolveInheritedDirs` 改回旧实现（手扫直接父节点 `byMedia` + 只取第 1 个）⇒ 上面前三条用例全挂（3 failed）；
  ② 再把 `formatInheritedOutputDirsHint` 的多位置分支改成「只念第一个」⇒ 4 failed（2 组件 + 2 纯函数）。
- 全量：`261 文件 / 3060 例全绿`（新增 7 例：纯函数 4 + 组件 3）。
  `tsc -b` / `tsc -p electron/tsconfig.json` / `eslint .` / `prettier --check` 全绿。
- ⚠️ **未经渲染验证**（本机离屏渲染被环境拦死）：灰字被输入框截断后的实际可读长度由杰哥在运行应用里过目。

**明确不做（杰哥选 A）**：表格里**看不见**继承来的第二个位置 —— 行数仍按「本级已配的位置数」算。
要「看得见」得改行模型（把继承值画成只读行），代价是没配过位置的方向表格会变长、扫起来更乱。

**改到的文件**

| 文件                                                      | 改动                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `lib/postprocessMedia.ts`                                 | 新增 `formatInheritedOutputDirsHint`（含「为何要念全」的头注）        |
| `features/composite/components/ChannelSection.tsx`        | `inheritedHint` → `resolveInheritedDirs`（走既有解析函数）；说明条措辞 |
| `features/composite/components/ConsoleMediaTables.tsx`    | props 改列表 + 头注补「念全」一节                                     |
| `features/postprocess/ChannelOutputDirs.tsx`              | 同上（弹窗侧共用组件）                                                |
| `features/postprocess/PostprocessParamPanel.tsx`          | `inheritedDirsByMedia` 改用 `resolvePostprocessOutputDirs`（原先恒定错报） |
| `docs/RISK.md`（R-84）                                     | 风险登记：界面里自己拼继承 ⇒ 显示少于实际生效                          |

---

## TB-096 竖排水印的标识符挤在首字旁边：竖排时让它自己占一格（2026-09-22 阿伟）

**现象**（杰哥 2026-09-22 报障 + 截图）：竖排合规水印「该活动存在时效性，具体优惠以实际为准」
画出来第一行是 `★该` —— 标识符与首字并排，看着像「★ 被排到文案左边去了」。

**根因**：标识符是**贴到文案首行的行首**（`applyIdentifierToText`：`lines[0] = value + lines[0]`），
渲染再逐行画。横排里这正确（读作「署名 + 文案」）；但竖排文案是**一个字一行**排出来的，
那一行就是**一个字的格子** —— 贴上去必然与首字并排。

**关键事实：产品里没有「文字方向」参数**（回答杰哥的第二个问题：为什么找不到那个组件）

- `CompositeV2TextLayer`（`compositeV2Types.ts:97`）只有 text / fontFamily / fontSize / fontWeight /
  color / align / lineHeight / letterSpacing / padding / withIdentifier，**没有方向字段**；
- 图层面板（`PresetLayerPanel.tsx`「内容」组）也只有 文字 / 字体 / 字号 / 字重 / 颜色 / 文字对齐；
- 全仓 grep `竖排 / vertical / writing-mode` 只命中**素材库的横竖筛选**与**策略提示词里的
  「左上角竖排」文字描述**，与文字排版无关。
- ⇒ 竖向文案目前的**唯一做法就是逐字换行**（一个字一行）—— 截图里那段水印就是这么来的。
  所以「找不到设为竖向的组件」是因为**不存在**，不是入口藏起来了。

**修法（本轮）**

- 新增判据 `isVerticalText(text)`：≥2 行且**每行只占一个字符**（`Array.from` 数 —— emoji 是代理对，
  `'👍'.length === 2` 会把它判成横排）；
- 竖排时标识符 `unshift` / `push`（自己占一格），横排逻辑一字不改；
- 空行会让整段判为「非竖排」—— 兜底方向刻意选「维持既有行为」：判错成横排只是维持现状，
  判错成竖排会让标识符凭空多占一格。

**验收标准（可测）**

- `applyIdentifierToText('该\n活\n动', { text:'★', placement:'prefix' })` ⇒ `★\n该\n活\n动`（★ 在最上方）；
- `placement:'both'` ⇒ 上下各一格；
- 横排三条（单行 / 多行 / both）与改前**逐字节相同**；
- 判据边界：`优惠\n限时` 不算竖排、含空行不算、emoji 竖排要算。

**验证**

- **反向验证**：把竖排分支短路（`if (false && isVerticalText(text))`）⇒ **精确挂 1 例**，
  失败信息正是 `expected '★该\n活\n动\n存\n在' to be '★\n该\n活\n动\n存\n在'` —— 与报障现场逐字对上。
- 全量：`261 文件 / 3063 例全绿`（新增 3 例）。`tsc` 双端 / `eslint` / `prettier --check` 全绿。
- ⚠️ **未经渲染验证**（本机离屏渲染被环境拦死）：杰哥在运行应用里过目竖排效果。

**「可用的竖向文案配置方式」（当前）**

在图层「文字」框里**一个字一行**输入即可（如 `该⏎活⏎动⏎…`）；标识符现在会自动占最上面一格。
换行次数 = 字数，是目前唯一可行、且已被本轮修好的写法。

**待定（要杰哥拍板，本轮没做）**

「真竖排」作为一个**参数**：一段不换行的文案 + 勾「竖排」⇒ 自动逐字向下（列 = 换行符），
不用手敲十几个换行。要动的面：`CompositeV2TextLayer` 加方向字段（老数据缺省横向）+ 渲染器逐字定位
+ 图层面板加控件 + 预设导入导出兼容。**兼容提醒**：现有那条水印的文案是逐字换行的，
加了开关也不会自动认出来，仍要重输一次文案（或就保留逐字换行写法 —— 本轮修完它已能正确显示）。

**改到的文件**

| 文件                                              | 改动                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `features/composite/lib/compositeIdentifier.ts`    | 新增 `isVerticalText` + `applyIdentifierToText` 的竖排分支（含头注） |
| `features/composite/lib/compositeIdentifier.test.ts` | 新增 3 例（竖排三态 / 横排不变 / 判据边界）                      |
| `docs/adr/0006-*`                                  | 补一条：竖排时标识符占独立一格，判据与理由                        |

---

## TB-097 文字层支持竖排：加「方向」参数（2026-09-22 阿伟）

**需求**（杰哥 2026-09-22 拍板）：TB-096 修好了「竖排时标识符挤在首字旁边」，但竖向文案当时只能
**一个字敲一个换行**排出来 —— 改一个字就要把后面所有字往后挪。杰哥确认：做成参数。

**决策与理由见 `docs/adr/0016-text-orientation.md`**（含被否决的两个方案：布尔开关、自动折列）。

**改法**

| 面        | 改动                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 类型      | `CompositeV2TextLayer.orientation?: 'horizontal' \| 'vertical'`，**只有显式 `'vertical'` 才是竖排** ⇒ 老数据缺省横排，**无需迁移、无需改导入导出** |
| 渲染      | 竖排：换行符 = 换列、列内逐字向下；`lineHeight` 当**列距**、`letterSpacing` 当**列内字距**；多列以对齐锚点为中心摊开；并把 `ctx.letterSpacing` 清 `0px`（canvas 的字距只作用于水平方向，不清会被算两次） |
| 列的切分  | `resolveVerticalColumns`：**「一个字一行」的老写法先折成一段** —— 不折就会被当成换列、排成横着的一排；渲染与测量**共用**这一个函数 |
| 框        | `measureCompositeTextBox` 竖排时与横排**逐项对调**（宽 = 列数 × 列距、高 = 最长列），锚点才对得上；**仍然只是框**，不参与折列        |
| 面板      | 图层面板「内容」组加「方向」下拉（横排 / 竖排）；切换时 `updateLayer` 里统一走 `fitCompositeTextLayer`，框立刻变「窄而高」            |

**验收标准（可测）**

- 竖排「该活动」⇒ `fillText` 三次（逐字）、同列 x 相同、y 递增、不传 maxWidth；
- 竖排 +「一字一行」⇒ 折成一列，且**步进 = fontSize + 字距**（不是横排的 fontSize × 行高）；
- 竖排 + 整段换行 ⇒ 换列（两列的 x 不同）；
- 竖排 + 标识符 prefix ⇒ ★ 是第一格（y 最小）；
- 框：竖排「ABCDEF」⇒ 34×130（1 列 6 字）；「A\nB\nC」⇒ 34×70（折成 1 列 3 字）；「AB\nCD」⇒ 58×50（2 列）；
- 横排三条守卫（单行 / 多行 / both）**逐字节不变**。

**验证**

- **反向验证（逐条看挂在哪）**：
  - 关掉渲染器的竖排分支 ⇒ **精确挂 4 例**（竖排逐字 / 老写法 / 换列 / 标识符第一格）；
  - 关掉 measure 的竖排分支 ⇒ **精确挂 3 例**。
  - ⚠️ 过程中抓出一条**空守卫**：「一字一行 + 竖排」那条最初只断言「3 次 fillText + x 相同」，
    而横排渲染同一文案**输出逐字段相同** ⇒ 短路竖排分支时它居然全绿。已补「y 步进 = fontSize + 字距」
    这条**只有竖排路径才给得出**的判据，重跑 4/4 命中 —— 这是 **R-85** 的现场。
- 全量：`261 文件 / 3070 例全绿`（新增 7 例：渲染 4 + 框 3）。tsc 双端 / eslint / prettier 全绿。
- ⚠️ **未经渲染验证**（本机离屏渲染被环境拦死）：竖排的实际观感（列距 / 字距 / 与画面的贴合）
  由杰哥在运行应用里过目 —— 面板里把任一层「方向」切到竖排即可。

**改到的文件**

| 文件                                                      | 改动                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `features/composite/lib/compositeV2Types.ts`              | 新增 `CompositeV2TextOrientation` + 文字层的 `orientation` 字段（含口径注释） |
| `features/composite/lib/compositeTextLayout.ts`           | 新增 `resolveVerticalColumns`；`measureCompositeTextBox` 加竖排分支      |
| `features/composite/lib/compositeRendererV2.ts`           | 文本绘制加竖排分支；抽出 `paint`（描边 + 填充，横竖两处共用）            |
| `features/composite/components/PresetLayerPanel.tsx`      | 「内容」组加「方向」下拉                                                 |
| `features/composite/lib/compositeRendererV2.test.ts`      | 新增 4 例（逐字向下 / 老写法折列 + 字距 / 换列 / 标识符第一格）           |
| `features/composite/lib/compositeTextLayout.test.ts`      | 新增 3 例（框对调 / 老写法折列 / 换列）                                   |
| `docs/adr/0016-text-orientation.md` · `docs/adr/README.md` | 新 ADR + 索引（**顺带补上遗漏的 0014 索引行**）                          |
| `docs/RISK.md`（R-85）                                     | 风险登记：空守卫 —— 两条路径产出同一份输出                              |

## TB-098 中控台项目树支持拖拽移动节点：整棵子树跟着走、自动更新层级与顺序（2026-09-22 阿伟）

**需求**（杰哥原话）：「支持通过拖拽将某个产品或方向节点（例如「快手极速版」）连同其包含的子节点
整体移动到树中的目标位置，并自动更新层级关系和顺序」，并要求说清**交互方式 / 合法放置范围限制 /
移动后的数据更新逻辑 / 视觉反馈**。

**现状：地基已有，缺的只是绑事件**（这一步决定了改动面）

| 已有的                                | 落在哪                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| 移动 / 嵌套 / 重排的落库逻辑 + 防环    | `assetLibrary/store.ts` 的 `moveCollectionsToPosition`（1181 行起） |
| 拖拽协议（负载类型 / 三区判定）        | 原先**私有**在 `AssetLibrarySidebar.tsx` 里（三份实现）             |
| 两棵树读同一份数据                     | `useAssetLibraryStore.collections`（中控台树与画廊侧栏同源）        |
| **中控台树一个拖拽事件都没绑**         | `ConsoleAssetTree.tsx` ← 本次补的就是这里                           |

**做法（6 条）**

1. **协议抽成唯一一份**：`COLLECTION_DRAG_TYPE` / `parseCollectionDragIds` / `canAcceptCollectionDrag` /
   `getCollectionDropZone` 从画廊侧栏搬进 `lib/assetSidebarUtils` 的「集合拖拽协议」一节，两棵树共用
   —— 同一份数据不该有两种手感。画廊侧栏只换 import，行为不变（测试同步改 import 来源）。
2. **三区拖拽**：每行可拖；落到某行**上 30% 插到它前**、**下 30% 插到它后**、**中间成为它的子级**；
   拖到树下面那片空白 = 变成业务线（追加到根末尾）。
3. **非法目标画成禁止态**：拖到自身或自身的子孙上时不给任何落点提示 + `dropEffect = 'none'`；
   drop 阶段再用解析出的 id 严格算一遍（dragover 阶段 Chromium 不让读负载内容，只能读 `types`）。
   store 侧本来就有防环，UI 这层只为「别让人以为能放」。
4. **落进去自动展开新父级**：否则东西掉进折叠着的节点里，看着像没生效。
5. **搜索态不给拖**：搜索会剪枝（只留命中节点 + 祖先链），画面里缺了兄弟节点 —— 这时候算
   「插到同级第几个」会**算错**。宁可这一段不给拖，也不能写错顺序。
6. **顺带治缩进硬截断**：`INDENT_CLASS` 由 4 档扩到 6 档、取档不再 `Math.min(…, 3)`。
   原先第 4 层与第 3 层缩进**完全相同** —— 以前点不出第 4 层所以看不出，拖拽一上就随手能造出来。

**数据怎么变（回答第 3 问）**

- 只改两样：被拖节点自己的 `parentId`、落点那一层的 `order`（从 0 重排）；子节点**一个都不动**
  —— 它们靠 `parentId` 挂在被拖节点上，父级一换整串自动跟随（这就是「连同子节点整体移动」）。
- 节点 id 不变 ⇒ 右区那些参数（水印 / 导出位置 / 参与产出…）都是按 id 存的，全部跟着节点走。
- 落盘走 `repository.putCollections`，并进撤销栈（可 Ctrl+Z）。
- ⚠️ 派生后果：后处理命名里的 `{产品}` / `{方向}` 是按**路径深度**解析的
  （`resolvePostprocessProjectTargets`：根 / 第二级 / 叶）—— 跨层移动会改这个取值。
  这是「移动」本身的含义，不是 bug。

**验收标准（可测）**

1. 落在行中间 ⇒ `moveCollectionsToPosition(ids, { kind: 'into', parentId })`；上沿 ⇒ `before`；下沿 ⇒ `after`。
2. 拖到自身或自身子孙 ⇒ **不落库**、无落点提示（`dropEffect === 'none'`）、给出提示。
3. 落进折叠着的目标 ⇒ 目标被展开（其子节点行重新出现）。
4. 拖到树空白区 ⇒ `{ kind: 'append', parentId: null }`。
5. 搜索态下所有行 `draggable === false`。
6. 第 4 层缩进 ≠ 第 3 层缩进。

**验收证据（2026-09-22）**

- **全量**：`261 文件 / 3077 例全绿`（本轮基线 3070，+7 例）。
  `tsc -b` 零错误；`eslint`（改动 5 文件）零告警；`prettier --write` 已跑。
- **定向**：4 文件 / 73 例 —— `ConsoleAssetTree.test.tsx` **21**（原 14 + 新增 7）、
  `AssetLibrarySidebar.test.tsx`（协议换家后行为不变）、`assetSidebarUtils.test.ts`、`compliance.test.ts`。
- **反向验证 3 轮，全部精确命中（每轮只挂 1 例，其余照过）**：
  1. 去掉 drop 阶段的防环判据（只留「拖到自身」）⇒ 只挂 **「⭐ 不能拖到自己或自己的子孙下」**（20 passed）；
  2. 关掉自动展开（`zone === 'into'` → `'not-into'`）⇒ 只挂 **「⭐ 落到某行中间…自动展开新父级」**，
     报错正是 `expected '产品线A|产品A|产品线B' to contain '月亮'`（折叠着没展开，与新父级里的节点
     真的没出现逐字对上）；
  3. 缩进改回硬截断（`Math.min(…, 3)`）⇒ 只挂 **「深层缩进继续加深」**，报错 `expected 'pl-11' to be 'pl-14'`
     —— 正是「第 4 层和第 3 层一样」这件事。
- ⚠️ **未经渲染验证**（本机离屏/无头渲染被环境拦死，见 `MEMORY.md`）：
  **三区手感（行高约 28px 时中间那段够不够点）、插入线的粗细/位置、禁止态的光标**需杰哥在
  运行中的应用里过目一次。实现口径：上/下 30% + 中间 40%（与画廊侧栏同一套阈值，两棵树不另立标准）。
- **顺带发现并登记 R-86**（本轮不动）：`moveCollectionsToPosition` 只重排落点那一层的 `order`，
  源那一层留空洞 ⇒ 之后新建节点按「同级数量」取 order 会撞号、顺序静默退化成按名称。画廊侧栏同源。

**改到的文件**

| 文件                                                     | 改动                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `features/composite/components/ConsoleAssetTree.tsx`     | 绑三区拖拽（拖起 / 落点 / 禁止态 / 自动展开 / 根投放）+ 缩进扩到 6 档 + 头注 |
| `lib/assetSidebarUtils.tsx`                              | **协议抽成唯一一份**：`COLLECTION_DRAG_TYPE` / 解析 / `canAccept` / 三区判定 |
| `features/assetLibrary/AssetLibrarySidebar.tsx`          | 删掉私有的三份实现，改 import；调用点改名（行为不变）                       |
| `features/composite/components/ConsoleAssetTree.test.tsx` | 新增 7 例（拖起 / 三区 / 防环 / 自动展开 / 根投放 / 搜索态不给拖 / 缩进）    |
| `features/assetLibrary/AssetLibrarySidebar.test.tsx`     | `COLLECTION_DRAG_TYPE` 的 import 来源改到共享模块                           |
| `docs/RISK.md`（R-86）                                   | 风险登记：源层 `order` 空洞 ⇒ 新建撞号、排序静默退化                        |

**状态**：**已完成**（2026-09-22）。

---

## TB-099 树节点折叠状态持久化：收敛成三棵树共用的一份实现（2026-09-22 阿伟）

**需求**（杰哥原话）：「为树形结构组件添加状态持久化功能，用于记住各节点的展开与收起状态」，
并要求说清**初始化恢复 / 切换即保存 / 刷新或重进应用后正确还原 / 新增·删除·重命名后的不一致
处理 / 存储方式 / 数据量大时的性能与稳定**。

**现状**（决定了范围）：三棵树里**两棵已经有**这能力 —— 画廊左侧栏、SOP 分组树，都存 localStorage；
缺的是**中控台那棵**（展开状态只在内存里，关掉就没了）。而那两处**各写各的**：一份私有在
`AssetLibrarySidebar`、一份私有在 `SopLibraryTab`，且**两份都直接读 `window.localStorage`**
（违反架构约束七·六「`lib/browserStorage.ts` 是 localStorage 唯一入口」）。
杰哥选 **A：一次收敛**（折叠状态不在「故意不合并」的豁免清单里）。

**存储方式**：`localStorage`（键 `tangbao.console-tree-collapsed`）。
判据是仓库既有口径 —— **纯 UI 偏好走 localStorage，业务数据才走 `app_data_records`**
（折叠状态是「我这台机器上想怎么看」，不该跟着配置包走）。三处键各一档，互不影响。

**做法**

1. **新增 `hooks/usePersistedCollapsedIds.ts`**（三处共用）：挂载时读一次、
   集合一变就写回、读写全包 try/catch（隐私模式 / 配额满 → 静默退回，不打扰用户）。
   内部走 `getBrowserStorage()`，不再碰裸 `window.localStorage`。
2. **语义：记「折叠的」，不记「展开的」**。中控台树原先存的是「展开集合」且**只在挂载时
   拍一次快照** —— 于是挂载后新增的节点会掉出集合、**默认收起**。改成记折叠的之后：
   存档空 = 全展开 = 既有默认行为；新增节点天然展开；**存档体积只跟「折了几个」有关，与树
   的大小无关**（内置树 77 节点，真折叠的三五个 → 每次写几十个字符）。
3. **失效 id 在写回时清**：传 `validIds` 时每次写回先求交集，删掉的节点不会在存档里无限累积。
   **不在渲染时清**（渲染期改 state 会引入额外重渲染）。传的是**全量**集合 id（含回收站里的）
   —— 回收站节点仍算「存在」，这样恢复回来折叠状态还在。
4. **中控台树**：`expandedIds`（展开集合）→ `collapsedIds`（折叠集合），`toggleExpand` 语义
   反过来，新增一个 `expandNode`（摊开某节点，已是展开态就原样返回、不白写盘）。
5. **画廊侧栏 / SOP 分组树**：换成同一个 hook，删掉各自的私有实现与写回 effect（等价替换）。

**语义三条（别写反）**

- 记**折叠**的：存档读不到 / 坏掉 → 空集合 → **全展开**（不会因为存档坏掉把树折起来）；
- 新增节点**天然是展开的**，不需要任何「补一条」逻辑；
- **按 `id` 记、不按名字记** ⇒ **重命名不影响折叠状态**（杰哥专门问到的第三类不一致，答案是
  「不需要处理」，但这一点必须靠按 id 记来保证）。

**验收标准（可测）**

1. 存档 `['product-a']` ⇒ 挂载后「产品A」是折着的（它的子节点不渲染）。
2. 点「收起 产品A」⇒ 存档变 `['product-a']`；再点展开 ⇒ 变 `[]`。
3. 存档里混进已被删掉的 id ⇒ **挂载后的第一次写回就清掉**，不必等用户再折一次。
4. 存档坏掉（非 JSON / 非数组 / 元素非字符串）⇒ 退回全展开且**不抛错**，坏值被下一次写回覆盖。
5. 新增子级 ⇒ 父级被摊开且写进存档（折着的父级要展开，否则新建的看不见）。
6. **搜索态仍强制全展开** —— 折着的节点也要能被搜出来。
7. 存档键写死在测试里（**跨版本契约**：改键 = 老用户的折叠状态静默丢失）。

**验收证据（2026-09-22）**

- **全量**：`262 文件 / 3089 例全绿`（本轮基线 3077，+12 例）。定向：`ConsoleAssetTree.test.tsx`
  **28 例**（原 21 + 新增 7）、`usePersistedCollapsedIds.test.tsx` **5 例**（新）、
  `AssetLibrarySidebar.test.tsx`（拖拽协议与折叠状态都换过家，行为不变）。
- **反向验证 2 轮，精确命中**：
  1. 去掉 hook 里的失效 id 过滤 ⇒ **恰好挂 2 例**（hook 的「失效 id 不落盘」+ 中控台的
     「存档里已被删掉的节点 id 会被清掉」），报错都是 `expected ['still-here','deleted-long-ago']
     to deeply equal ['still-here']` 这一类；
  2. 去掉中控台搜索态的强制展开（`searching ||`）⇒ **恰好挂 1 例**，报错
     `expected '产品线A|产品A' to contain '月亮'` —— 正是「折着的节点搜不出来」。
- `tsc -b` / `eslint`（改动 6 文件）/ `prettier --write` 全绿。
- ⚠️ **未新增 SOP 树的守卫**：`SopLibraryTab` 没有既有测试文件，本次是**等价替换**
  （同一 hook、同一键、同语义），改动面 4 处、`tsc`/`eslint`/全量测试均过；
  新增守卫需要为它补一套组件测试基建，成本大于收益，记在这里备查。
- ⚠️ **未经渲染验证**（本机限制）：折叠状态的实际还原需杰哥在应用里折几个节点、重启一次看。

**改到的文件**

| 文件                                                      | 改动                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `hooks/usePersistedCollapsedIds.ts`                        | **新增**：三棵树共用的折叠状态持久化（含「为什么记折叠的」头注）            |
| `hooks/usePersistedCollapsedIds.test.tsx`                  | **新增** 5 例：恢复 / 实时写回 / 坏存档降级 / 失效 id 清理 / 不过滤兜底     |
| `features/composite/components/ConsoleAssetTree.tsx`       | 展开集合 → 折叠集合 + `expandNode`；文档头注补「折叠状态是持久化的」一节     |
| `features/composite/components/ConsoleAssetTree.test.tsx`  | 新增 7 例 + 开 jsdom 环境（node 下 `getBrowserStorage()` 返回 null 测不到） |
| `features/assetLibrary/AssetLibrarySidebar.tsx`            | 换 hook，删私有 `loadCollapsedIds` 与写回 effect                            |
| `features/strategy/SopLibraryTab.tsx`                      | 换 hook，删私有 `loadCollapsedGroupIds` 与写回 effect                       |

**状态**：**已完成**（2026-09-22）。

**本轮明确没动（发现但未扩大范围）**

- `AssetLibrarySidebar.tsx` 里**面板宽度**那处仍是裸 `window.localStorage`（同一违规家族，2 行），
  且它的读函数有一个可疑行为：`Number(null)` = 0 是有限数 ⇒ **从没存过宽度时会返回 208（最小值）**
  而不是 `null`（"用默认"）。两者都与折叠状态无关，没碰 —— 要不要收，等杰哥定。


---

## TB-100 配置包结构重设计 + 配置规范文档（v8 → v9，2026-09-22 阿伟）

> ⚠️ **编号让号史**：本条原登记为 `TB-099`，但另一条写线（树节点折叠状态持久化）**先提交**并占用了该号
> （commit `d9948b5`）。按仓库先例（见 `TB-042` 的让号记录）**由后提交方让号**，本条改为 `TB-100`。

**需求**（杰哥原话）：「优化配置文档的结构，按照最优实践重新设计配置文件的组织方式。由于目前尚未交付
他人使用，可不受向后兼容性约束，请明确配置文件的整体分层与模块划分、命名规范、字段类型与默认值、
必填与选填项、各配置项的作用及取值范围，并给出可直接替换现有配置的完整示例与必要的注释说明。」

**诊断（实测，不是印象）**

| # | 问题 | 证据 |
| - | ---- | ---- |
| 1 | 配置不是一个文件，是 ZIP 包里 `manifest.json` 的一个字段 | `store.ts:12099` 写 `manifest.treeConfig` |
| 2 | 为了 ≤0.3.2 双写了三份重复内容 | `store.ts:12100-12108` 同时写 `compositeState` / `postprocessMediaState` / `assetCollections` |
| 3 | 同名异物：「水印本体」与「水印引用」都叫 watermark 系 | 节点上 `watermarks`（实体）vs `watermarkPresetIds`（引用） |
| 4 | 元信息与配置内容混在顶层 | `version` / `exportedAt` 与 `root` / `nodes` 平级 |
| 5 | 「没写 vs 空」这条继承地基只活在代码注释里，不成文 | `treeConfigBundle.ts:180` 靠 `...(x ? {x} : {})` 表达 |
| 6 | 无 schema，字段类型只能读 TS；写错字段名导入时静默丢弃 | 本次新增 schema 后才可校验 |

**本轮的交付物（设计定稿，已落盘）**

| 文件 | 内容 |
| ---- | ---- |
| `docs/config-spec.md` | **配置规范（唯一真相源）**：分层 / 命名 / 字段表（类型·默认值·必填选填·取值范围·作用）/ 继承与空值语义 / 完整示例骨架 / 落地清单 / 安全边界 |
| `docs/examples/tangbao.config.example.json` | 可直接替换的完整示例（4 渠道 15 尺寸 / 6 节点树 / 含水印库） |
| `docs/examples/tangbao.config.schema.json` | JSON Schema，编辑器实时校验 + 悬浮说明 |

**核心设计取舍（与 v8 的差异）**

- 配置从包内 `treeConfig` 字段**拆成独立一份 `config.json`**（zip 只当信封；水印 LOGO 等资源进 `assets/`）。
- `root` → `defaults`（`root` 会被误读成"树的根"，而树的第一层是产品线）、`nodes` → `tree`。
- 节点 `postprocess` → `overrides`（它是覆盖值，不是"后处理本身"）；`watermarks` → `watermarkPresets`（与引用区分）。
- `version` + `exportedAt` 收进 `format`，新增 `kind` / `appVersion` / `skippedNodes`。
- **删掉过渡期双写与 v7 老恢复路径**（不受兼容约束）。
- **字段名与代码保持一致**（`media` / `mediaOutputDirs` / `selectedMediaIds`），只加一份"文件里的名字 ↔ 界面上的说法"对照表 —— 不制造第二套名字。

**验收标准（可测）**

1. 导出的 ZIP 内确实有 `config.json` 且通过 schema 校验；不再有 `treeConfig` 字段。
2. 导出 → 导入 round-trip 后**逐节点字段值一致**（断言字段值，不是"恢复了几条"）。
3. v8 旧包导入时**明确报「版本不认识」并拒收**，不静默什么都不恢复。
4. `format.skippedNodes` == 回收站节点数；`unassignedWatermarks` 含缺归属水印。
5. 映射层加穷尽守卫（`Record<keyof X, …>` 让漏字段编译报错），并有反向验证。
6. 全量 `npm run verify` 全绿。
7. **跨机器还原**：干净机器上导入后，水印里「从本机磁盘选的图」不再断图（本轮新发现的缺口，见下）。

**2026-09-22 追问补充：跨机器一致性（规范 §十）**

杰哥追问「全新电脑装糖包 + 拉取最新配置，能否与上传时中控台完全一致」。逐条查证后**结论是否**，
并把「哪些一定不一样、为什么」写成了规范 §十。其中**发现一个真实缺口**：

- 水印图层的图片引用有 5 种形态，但导出前的 `migrateLegacyCompositeAssets` 只迁 `dataUrl` / `project`，
  `collectCompositeAssetIds`（`compositeAssets.ts:76-87`）**只收集 `stored`**；
- 而 `{ kind: 'path', path }`（用户在编辑器里**从本机磁盘选图**，`PresetCanvasEditor.tsx:376` /
  `PresetLayerPanel.tsx:121`）既不迁移也不收集 ⇒ **这类图片不进包，换机器断图**；
- ⇒ 已列为 §八 落地清单第 11 项 + 验收标准第 7 条，**按 v9 落地时一并修**（导出前把 `path` 也迁成 `stored`）。

**落地记录（2026-09-22，§八 清单 12 项已全部完成）**

| 文件                                                     | 改动                                                                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/treeConfigBundle.ts`                            | v9 结构（`format` / `defaults` / `watermarkLibrary` / `tree`）、`TREE_CONFIG_ENTRY`、`toCompositeV2State`、**映射穷尽闸门**（`Record<keyof PostprocessMediaConfig, …>`：漏字段编译报错）、校验口径与可读报错 |
| `src/store.ts`                                           | 导出两处写包内 `config.json`；**删过渡期双写**（`treeConfig` / `compositeState` / `postprocessMediaState` / 配置通道的 `assetCollections`）与 v7 老恢复路径；`restoreCompositeAssets`（资源先落库）+ `restoreTreeConfigBundle` 恢复水印库；两个导入入口收 `config.json`；包版本 8 → 9 |
| `src/types.ts`                                           | `ExportData` 删三个双写字段；`compositeAssetFiles` 的说明改成「文件索引」（与 `imageFiles` 同类）                                                                                                     |
| `src/lib/backupImport.ts`                                | `CURRENT_BACKUP_VERSION` 7 → 9（**R-87**，见下）                                                                                                                                                     |
| `src/features/composite/lib/compositeAssetMigration.ts`  | **第 11 项**：`path` 型（从本机磁盘选图）在导出前读进来落库成 `stored`；读不到则原样保留（不假装成功）                                                                                                |
| `docs/config-spec.md` / `docs/examples/*`                | 新增 `watermarkLibrary` 一节、§十 跨机器一致性、§八 改动账、§七「两个版本号别混」；示例与 schema 同步 `watermarkLibrary`                                                                              |
| 测试                                                     | `treeConfigBundle.test.ts` 重写为 v9 契约（13 例）；`store.test.ts` 断言改到包内 `config.json`；`compositeAssetMigration.test.ts` +2 例；`backupImport.test.ts` +1 例守版本同步                        |

**顺带修掉一个既有 bug（R-87，P 级 → 已 CLOSED）**

`exportData` / `exportDataToPath` 写 `version: 8`（`7decde3`「配置包 v8」引入），而导入侧上限
`CURRENT_BACKUP_VERSION` 停在 `7` ⇒ **导出的每个包都被自己拒收**（"备份版本 8 高于当前支持的版本 7"）。
「发布配置 / 拉取最新」因此形同虚设 —— 配置同步失效的根因不在同步本身，而在包根本进不来。
**两边各自的用例都是绿的**，因为从来没有「导出 → 导入」的 round-trip。已统一到 9 并补守卫用例。

**验收证据（2026-09-22）**

- 全量 `vitest run` **262 文件 / 3096 例全绿**；`tsc -b` 与 `tsc -p electron/tsconfig.json --noEmit` **双端零错误**。
- **反向验证 2 轮，均精确命中**：
  1. 映射表删掉 `media` 一个键 ⇒ `tsc` 报 `Property 'media' is missing … but required in type 'Record<keyof PostprocessMediaConfig, …>'`；
  2. 去掉 `hasLegacyCompositeAssets` 的 `path` 判断 ⇒ 只挂「⭐ 把「从本机磁盘选图」的图层迁进库」一条（`expected +0 to be 1`），其余 3 例照过。
- ⚠️ **未经渲染验证**（本机离屏渲染受限）：本次改的是导出/导入链路，界面观感不受影响；
  但**建议发一次包、在另一台机器（或清空 userData 后）拉一次**做端到端确认。

**状态**：`DONE`（2026-09-22）。

**为什么当初分成两步**：这是核心链路（store 导出/导入 + 配置同步），先让设计可评审比直接改代码省返工。

---

## TB-101 导入 / 拉取时的覆盖范围（谁能覆盖谁、本地自建怎么办，2026-09-22 阿伟）

**需求**（杰哥原话链）：「对于已有资料的用户在导入时，该如何解决重复的、或者有更新数据的情况呢」→
我给了三种统一口径 → 杰哥：**「能否做成选择哪些覆盖，哪些不覆盖呢」** → 过目线框后「可以，开工」。

**诊断（实测，逐项查的合并语义）**

| 数据 | 原语义 | 对已有资料的同事 |
| ---- | ------ | ---------------- |
| 项目树 `collections` | 同 id 覆盖 + **保留本地独有** | ✅ 合理 |
| **节点参数** | **整表替换** | ❌ 自建方向的参数被清空 |
| **水印预设 / LOGO** | **整份替换** | ❌ 自建水印全消失 |
| 全局产出配置 | 整份替换 | ⚠️ 本机调好的被覆盖 |
| 应用设置 | 干净机器整份采用；否则只追加 profile | ⚠️ 不一致 |
| 素材库 / 任务 / 收藏夹 | 字段级合并 / 按 id / 追加去重 | ✅ |

**⭐ 最坏组合**：树保留了自建方向（界面上看着都在），但那几个方向的**渠道选择 / 输出位置 /
水印引用被清空** ⇒ **产出结果悄悄变了，且不报错**。ADR-0014 §七 只对「节点保留还是删掉」做了裁决，
同一条链路上的参数与水印没跟着统一。

**做法**

- **语义**：*勾了才用包里的，没勾的这一块完全不动。* 粒度停在**模块级**（5 项）——
  再细会勾出「引用了不存在的东西」（方向参数引用节点 id、水印按产品 id 归属、渠道选择引用渠道 id）。
- **「本地自建怎么办」单独一个开关**（保留 / 删除）：它回答的是「包里没有的要不要删」，
  与「包里的要不要进来」是两个问题，合成一个控件会让人算不清。
  **删除 = 移进回收站**（不是彻底删 —— 拉配置可反悔，走 `deleteCollection` 那条路是不可逆的）。
- **产出配置按字段分组拼**：`POSTPROCESS_FIELD_GROUP`（`Record<keyof PostprocessMediaConfig, …>`，
  **加字段忘归类编译即红**），合并是纯函数 `applyPostprocessScope`。
- **预览**：拉取面板展开时读一次包内 `config.json`，显示「这份包含 N 个节点、M 套水印；
  你本机还有 K 项是这份里没有的」。读不到就不显示，不阻断。
- **默认值分场景**：拉取配置不勾「应用设置」；导入自己的备份全勾。

**验收标准（可测）**

1. `scope` 里没勾的模块，导入后**本机对应数据一个字没变**（逐块断言）。
2. `localOnly: 'keep'` → 本地自建的节点与水印都还在；`'drop'` → 节点被移进回收站（`trashedAt` 非空）。
3. 水印库按 id 合并：同 id 以包为准，本地独有的保留（且排在包里的之后 —— **顺序即产出顺序**）。
4. 只勾「渠道与尺寸」时，命名模板 / 输出位置**不受影响**（反向验证：改成无条件覆盖 → 用例必须红）。
5. 全量 `npm run verify` 全绿。

**验收证据（2026-09-22）**

- 全量 `vitest run` **262 文件 / 3099 例全绿**（本轮 +3）；`tsc -b` / `tsc -p electron` 双端零错；
  `eslint .` 与 `prettier --check` 干净。
- 新增用例：`treeConfigBundle.test.ts` 13 → **16**（覆盖范围三分支 / 水印选型同组 / 引用节点 id 同组）；
  `catalog.test.ts` 通过（新组件 `ImportScopeFields.tsx` 已登记）。
- **反向验证（实做，精确命中）**：把 `if (enabled[group])` 改成无条件覆盖 ⇒ 只挂
  「⭐ 覆盖范围：勾了的组用包里的，没勾的组一个字都不动」，报错
  `expected 'D:/包里输出' to be 'D:/本机输出'`，其余 15 例照过。
- ⚠️ **未经渲染验证**（本机离屏渲染受限）：拉取面板与导入区的实际观感请杰哥在应用里过目。

**改到的文件**

| 文件 | 改动 |
| ---- | ---- |
| `src/store.ts` | `ImportScope` 模型与两套默认值、`resolveImportScope`、按范围分流的 `restoreTreeConfigBundle`、`mergePostprocessConfig` |
| `src/lib/treeConfigBundle.ts` | 纯函数 `applyPostprocessScope`（按字段分组拼） |
| `src/lib/postprocessMedia.ts` | `POSTPROCESS_FIELD_GROUP` 归属表（编译期闸门） |
| `src/features/composite/storeV2.ts` | `mergeCompositeV2Library`（水印库按 id 合并，原先只有整份替换） |
| `src/lib/assetLibraryRepository.ts` | `mergeImportedAssetLibrary` 支持 `dropLocalOnlyCollections`（移回收站） |
| `src/lib/configSync.ts` | `pullLatestConfigFromSyncDir(scope)` + `previewLatestConfigFromSyncDir()` |
| `src/components/ImportScopeFields.tsx` | 新增：范围勾选组（拉取与导入共用一份） |
| `src/components/SettingsModal.tsx` | 拉取面板（含预览）与导入区的范围入口 |

**状态**：`DONE`（2026-09-22）。

---

## TB-102 修复「导出全挂」+ 让失败文案与真因对齐（2026-09-22 阿伟）

**怎么发现的**：杰哥要「发布最新配置到网盘」，走真实链路时界面报
「发布失败：写不进 `\\192.168.202.11\…`（确认这个目录可写）」—— 而那个目录**明明可写**
（同一次会话里 `writeJsonText` 实测能写进去）。顺这条追下去，真因是 R-89。

**诊断（诚实记一笔：这个缺口是 TB-100 引入的）**

- `electron/streaming-zip.ts` 的 `validArchivePath` 是**白名单**式校验，只放行
  `images/` / `thumbnails/` / `composite-assets/`；TB-100 把配置本体改成**包内根级**的
  `config.json` 后没同步放行 ⇒ 导出时写第一个条目就被拒（`无效 ZIP 路径：config.json`），
  **发布配置 / 导出数据 / 导出备份一起失败**。
- **为什么没测出来**：`streaming-zip.test.ts` 只覆盖了三个资源目录，**没有一条用例覆盖包内根级文件**。
- **为什么报错查不到**：真因被吞了两层 —— `exportDataToPath` 的 catch 把 message 只丢进 toast、
  返回值**没有 error 字段**，`publishConfigToSyncDir` 只能编一句「确认这个目录可写」。

**改法**

| 文件                            | 改动                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `electron/streaming-zip.ts`     | `ROOT_ARCHIVE_FILES` 放行根级信封文件（`config.json`）                     |
| `electron/streaming-zip.test.ts` | **成对守卫**：用渲染侧 `TREE_CONFIG_ENTRY` 写用例 —— 改一边不改另一边就红 |
| `src/store.ts`                  | `exportDataToPath` 回传 `error`（此前只有 toast 里才有真因）               |
| `src/lib/configSync.ts`         | 发布失败照实报 `result.error`，不再编通用文案                              |
| `vite.config.ts`                | 新增 `TANGBAO_ELECTRON_ARGS`（默认不注入 `onstart`，行为逐字不变）         |
| `docs/tangbao-ops-runbook.md`   | 新增 §二十四：在真实 dev 数据上做自动化的配方                              |
| `docs/RISK.md`                  | 登记 R-89（CLOSED）                                                        |

**验收证据（2026-09-22）**

- 全量 `npm run verify` **262 文件 / 3100 例全绿**（+1 = 新增守卫）；eslint / prettier 干净。
- **反向验证**：把 `config.json` 从白名单拿掉 → **只有**守卫用例红，报错
  `无效 ZIP 路径：config.json`（与线上真因**一字不差**），其余 5 例照过。
- **端到端实做**：在 dev 实例（`http://localhost:41731`，水印库所在的那个 origin）发布
  `tangbao-config-20260922-171903.zip`，拆包与渲染进程真实状态**逐项比对一致**：
  树 82 / 预设 28 + 未归属 1 = 29 / LOGO 27 / 库内资源 28 且**缺图 0** / 渠道 4 / 尺寸 16 /
  `globalFitMode = crop-fill` / 含 identifier / 不含 API Key / 双写字段全清。

**遗留**（已消除）：发布期间在网盘目录留过一份作废的 `tangbao-config-20260922-171523.zip`
（在 `file://` origin 下发的**空水印包**）与两个探测文件。本机**无法删除 UNC 上的文件** ——
shell 的 rm、Node/Python 的 unlink、Windows 原生 del 三条路都被环境拦（详见 runbook §二十四 第 4 节），
故当时标注需人工清理；**2026-09-22 17:39 复查，目录里只剩正式那份
`tangbao-config-20260922-171903.zip`**（杰哥手动清理）。

**状态**：`DONE`（2026-09-22）。版本处理见下：v0.3.3 已发布**且含此缺口**。

---

### TB-103 任务卡片视图：「失败 N」关不掉 + 点「查看来源任务」后被反复拽回那张卡

- **来源**：杰哥 2026-09-22 17:41 报障（附速览条截图
  `2 个分组 · 121 个任务 · 120 张素材 ●完成 120 ●失败 1`）：
  「任务卡片模式下有奇怪的失败提醒，还无法关闭，也突发跳转」。
- **状态**：DONE（A + B 一次做完；全量 `verify` 因**同期另一条写线**在动而未跑，见验收证据）
- **实测取证**（直查 dev 库 `%APPDATA%\tangbao\local-saves\db`，`mode=ro` 只读；
  探针落 `%TEMP%\tb-probe-*.py`，不落项目根）
  - `app_data_records/tasks` 566 条落盘，其中 **10 条 `status:'error'`**，
    全部同属 SOP 批次 `sop-batch-muakprir`（「快手短剧_信息流」，`defaultCollectionId: builtin-direction-15`），
    **错误原文统一 = `HTTP 503: No available providers`**（服务端当时无可用通道，非糖包缺陷），
    且 `outputImages` 全为 0、`promptFailed` 为 null。
  - ⇒ **「失败 N」是真失败，不是误报**。截图只算 1 个，是因为速览统计**跟着当前视图范围**走
    （TB-082 遗留 3 的同一口径问题，仍未改）。
- **两条独立根因**
  1. **「关不掉」**：`AssetBatchView.tsx` 顶部那条 sticky 速览行里，`失败 N` 只是统计文本，
     **从做出来就没有任何关闭入口**。TB-082 / TB-083 两轮「界面上不允许出现关不掉的提示」
     只覆盖了浮层 + 图片模式那条提示条（`AssetLibraryWorkspace.tsx`）+ 索引进度红条，
     把它漏了。
  2. **「突发跳转」**：`AssetBatchView.tsx` 的「查看来源任务」定位/高亮 effect
     （唯一入口：`AssetViewer.tsx` 大图里的「查看来源任务 →」）依赖数组含 `groups`，
     而 `groups` 随 `assets` 变；**生成中素材每秒都在新增** ⇒ effect 反复重跑
     ⇒ `scrollIntoView` 反复执行 + 3 秒高亮计时器反复重置
     ⇒ 用户手动滚走后被拽回那张卡，且高亮永不消失。
- **改了什么**
  1. **定位改成「登记 → 销账」**：新增 `focusIntentRef`。
     `batchFocusTaskId` 的 effect 只负责**接住意图**（登记进 ref 后立刻把 store 值清空，
     这样同一个任务再点一次仍算新意图）；真正的滚动放在另一个 effect 里，
     **只有意图尚未销账时才动作**，滚动那一刻即 `focusIntentRef.current = null`。
     `groups` 仍留在依赖里（素材未加载完 / 目标卡未进虚拟化视口时要重试），但已不会重复滚。
  2. **高亮计时拆成独立 effect**（只依赖 `highlightGroupId`）。原来滚动与计时在同一个 effect，
     `groups` 每次变化都跑 cleanup 把计时器清掉 —— 高亮永远等不到清除。
     顺带删掉不再需要的 `highlightTimerRef` 与其 unmount 清理 effect（局部 timer + cleanup 已覆盖）。
  3. **速览的「失败 N」可关**：`store.ts` 新增 `dismissedOverviewFailedCount` + `dismissOverviewFailed`
     （**不持久化**，不进 `partialize`）。显示条件
     `overview.failed > 0 && (dismissed === null || overview.failed > dismissed)` ——
     与图片模式那条提示条**同一口径**：关掉后只有失败数继续上涨才重新出现。
     值放 store 而不是组件内 state：批次视图在切换图片/卡片模式时会卸载，
     放组件里会出现「关掉 → 切个视图回来又冒出来」＝用户感知的「关不掉」。
     关闭按钮用 `IconButton` + `!h-5 !min-h-5 !w-5`：`.ds-icon-button` 自带
     `height/min-height: var(--ds-control-md)`，特异性与 Tailwind 工具类同为单类，
     不加 `!` 会静默吃掉尺寸、把这条 sticky 细行撑高（R-80 级联）。
- **验收标准**（可测）
  1. 点「查看来源任务」后**只滚动一次**；此后素材持续新增（生成中）不再产生新的滚动；
  2. 高亮 3 秒后自行清除，且素材变化**不会把计时重置**；
  3. 速览的「失败 N」有关闭按钮，点掉即消失；
  4. 关掉后素材再变**不复活**；失败数上涨才重新出现；
  5. 「生成中 N」不受影响（它是状态，不是提醒）。
- **改动面**：`src/features/assetLibrary/AssetBatchView.tsx`、`src/features/assetLibrary/AssetBatchView.test.tsx`、
  `src/features/assetLibrary/store.ts`。
- **验收证据**（2026-09-22）
  - `npx tsc -b` + `npx tsc -p electron/tsconfig.json --noEmit` 双端零错；三个文件 `eslint` 零告警、
    `prettier --check` 通过。
  - 定向用例：`vitest run AssetBatchView.test.tsx store.test.ts` = **123 passed**（新增 3 例）。
  - **⚠️ 未跑全量 `npm run verify`**：开工时工作区干净（HEAD `8c0f205`），
    但验证过程中 `src/features/postprocess/PostprocessTargetsDialog.tsx` 与
    `taskPostprocess.ts` 出现**本线未触碰的改动**（同期另一条写线）。
    按 R-74 / work-protocol，混着对方 WIP 的全量门禁绿红都不可信，故只做定向验证 + 逐条单文件门禁。
  - **反向验证（两条，均精确命中）**
    1. 关掉滚动销账（删掉 `focusIntentRef.current = null`）→ **2 failed / 26 passed**：
       恰是那两条新用例。断言 `expected 5 to be 2`（滚动次数 5 vs 期望 2）、
       另一条高亮未清除（计时被素材变化重置）—— 其余照过。
    2. 把显示条件改回 `overview.failed > 0` → **1 failed / 27 passed**，恰是失败数那条：
       `expected '3 个分组 · 3 个任务 · 4 张素材完成 2失败 1' not to contain '失败'`。
- **测试过程中顺带修掉的一处假断言**：原「滚动 + 高亮」用例断言
  `className` 含 `'ring-2'` —— 但卡片基础类里本来就有 `focus-visible:ring-2`，
  该断言**恒真**（写了等于没写）。已改为只有高亮态才出现的 `'ring-inset'`。
- **本条踩到的测试陷阱（已写进用例注释，防后人也踩）**
  1. **`AssetGroupedView` 是 `memo`**：`renderer.update` 传等值 props（同 assets 引用）会直接 bailout，
     新换的 mock 数据读不到 —— 表现为「改了 mock 却没变化」。用新数组引用驱动。
  2. 因此**「不该发生的事」这类断言（不滚动）极易写成假绿** —— 若 update 被 bailout、
     根本没重渲染，滚动数自然也不变。新增用例都带一条「重渲染确实发生」的旁证
     （速览素材数必须跟着涨）。
  3. `vi.useFakeTimers()` 默认连 `requestAnimationFrame` 一起替换，
     与 `beforeEach` 里 stub 的 rAF 打架、React effect 刷不出来（实测高亮压根没上）。
     改成 `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`，只冻计时器。
- **知情取舍 / 遗留**
  1. **速览「N 张素材」只统计当前视图范围**（与顶部工具栏的「全部素材」口径不同）
     —— TB-082 遗留 3 的老问题，本轮**未动**，仍需杰哥定口径。
  2. **目标卡片在虚拟化视口外时定位不到**：`groupElementRefs` 只登记已渲染的卡片，
     此时意图保持 pending、不滚动（等卡片下次被渲染才会滚）。这是**改动前就有的行为**，
     本轮未扩大范围去修（可行方案：按 `cardLayouts` / `blockLayouts` 的 top 直接设
     `scrollTop`，不依赖元素挂载）。杰哥要点再做。
  3. **未经真机渲染验证**：本机做不了网页/离屏渲染（环境级限制），关闭按钮的实际观感、
     `!h-5` 是否真的没把 sticky 行撑高，请在运行中的应用里过目。
     我按 `py-1.5` + `text-xs`（行高约 28px）与按钮 20px 推算不会撑高 —— 这是算式，不是实测。

**状态**：`DONE`（2026-09-22）。

---

### TB-104 后处理 `{seq}` 按产出文件夹各自计数（不再整批共用一个计数器）

- **来源**：杰哥 2026-09-22 17:56：「输出多渠道多尺寸时，不同的文件夹里的素材共用了一个排序」。
  追问三层（产出先后 / 文件名序号 / 两层都要）后确认是**文件名的 `{seq}`**。
- **状态**：DONE · 本线
- **问题**：`taskPostprocess.ts` 里 `sequence` 是**一个**计数器，贯穿整批
  （所有图片 × 所有方向 × 所有渠道 × 所有尺寸）。于是：
  ① 同一个产出文件夹里的号是跳的（1、4、7…，中间的号被别的文件夹吃掉）；
  ② 在 A 方向多勾一个渠道/尺寸 → A 的产出量变 → **B 方向的文件名序号整体后移**
  （这正是杰哥说的「在某一处改了会串到别处」）。
- **改法**：序号改成**按产出文件夹（`subFolders[0]`，即 方向×渠道×尺寸）各自计数**，
  每个文件夹从 1 开始；计数器跨图片保留，同一文件夹内仍连续。
- **验收标准**（可测）
  1. 同一产出文件夹内的 `{seq}` 从 1 连续（不再跳跃）；
  2. 改 A 方向的渠道/尺寸后，B 方向的文件名序号**不变**；
  3. 同一文件夹内不出现重号（不覆盖已有文件，`-2/-3` 兜底仍生效）；
  4. 产出预览显示的序号与实际产出一致；
  5. 全量 `npm run verify` 全绿。
- **改动面**：`src/lib/postprocessRunner.ts`、`src/features/postprocess/taskPostprocess.ts`、
  `src/features/composite/components/PostprocessOutputPreview.tsx` + 对应测试、
  `docs/hanling-postprocess-replica-plan.md`（口径那句）。
- **改了什么**
  1. `postprocessRunner.ts`：`startSequence: number` → `startSequences: Record<文件夹名, 号>`
     （返回 `nextSequences`）。分组键就用 `subFolders[0]`（文件夹名），因为**重名只可能发生在
     同一个文件夹内**：不同文件夹是不同目录，跨文件夹重号无妨 —— 这也让「不覆盖已有文件」
     这条性质在改造后依然成立。
  2. `taskPostprocess.ts`：`let sequence = 1` → `let sequencesByFolder`（跨图片保留），
     调用处改成传入/接收这张表。
  3. `PostprocessOutputPreview.tsx`：预览不再自己数 `units` 下标，改成直接复用
     `buildSourceVariantPlans` —— 预览与真实产出从此是**同一份编排**，序号不可能分叉。
- **验收证据**（2026-09-22）
  - **全量 `npm run verify` 通过**：`262 files / 3111 passed`（Node v24.14.0，tsc 双端 + lint +
    format:check + test 全绿）。开工时工作区挂着 TB-089 的未提交改动，验证前它已被提交
    （`c0311b2`）→ 门禁是在**只剩本轮改动**的工作区上跑的，R-74 的顾虑消除、结论可信。
  - 定向用例：`vitest run src/lib/postprocess src/features/postprocess src/features/composite`
    = 39 files / 543 passed（新增 2 例：runner 的「方向隔离」+ 预览的「按文件夹分组」）。
  - **反向验证（两条，均精确命中）**
    1. 把分组键改回「所有单元共用一把号」→ `postprocessRunner.test.ts` **5 failed / 13 passed**，
       失败全是新口径那几条；核心断言原文
       `expected '产品B-百度-1140x640-3.jpg' to be '产品B-百度-1140x640-1.jpg'`
       —— **这正是杰哥报的现象**（B 方向的号被 A 吃掉两位）。
    2. 让预览自己数下标（`fileName: index + 1`）→ `ConsolePostprocessSections.test.tsx`
       **1 failed / 38 skipped**，恰是预览那条（`expected false to be true`）。
- **提交**：TB-089 已独立提交（`c0311b2`），本条因此可与它分开提交
  （R-09：只 add 本轮 7 个文件）。本轮由杰哥决定何时提。
- **知情取舍**
  1. 同一批次里，某个文件夹内的号可能与其他文件夹重号 —— 这是刻意的（不同目录）。
     真正要守的性质是「**同一文件夹内唯一**」，它仍然成立，且 `-2`/`-3` 兜底没动。
  2. `{seq}` 在模板里的位置不限于末尾，所以分组键取的是**文件夹名**而不是「文件名去掉尾部序号」，
     模板再怎么改都不会错配。
  3. 已产出的文件不受影响，**只有新产出**的文件名会变（同一批重跑、配置没变时，号也一模一样）。

---

### TB-105 图片列表状态标记：「已使用」（自动）+「已审核」（批量人工）

- **来源**：杰哥 2026-09-22 21:22 原话：「为图片列表添加状态标记功能：对已完成后处理的图片，自动在缩略图或
  预览图上叠加"已使用"小标签；同时支持多选图片批量打上"已审核"标记，且该批量标记操作仅对未后处理的
  图片生效，已后处理的图片不可被标记为已审核。」
- **状态**：DOING · 本线
- **现状（开工前查证）**：「是否已后处理」**在素材上没有任何存放处** —— 自动跑只写 `task.postprocessOutputs`
  （挂在任务上），手动跑连任务都没有、结果只进内存里的运行记录，重启即丢。所以这个功能必须先把状态落下来。
- **验收标准**（可测）
  1. 后处理**产出成功**的素材，缩略图左上角常驻「已使用」小标签（产出 0 文件 / 失败**不亮**）；
  2. 多选批量「标记为已审核」**只对未产出后处理的素材生效**，已产出的跳过，且提示里**报明跳过了几张**
     （不许静默少标）；
  3. 全选区都已使用 → 菜单项**置灰并给出原因**（不留「点了没反应」）；
  4. 后处理产出成功后，该素材原有的「已审核」被清掉（两者互斥）；
  5. 批量打标进撤销栈，Ctrl+Z 可回退；
  6. 网格 / 任务卡片 / 列表 / 大图查看器四处都能看到标记；
  7. 全量 `npm run verify` 全绿。
- **改动面**：`src/types.ts`、`src/lib/assetLibraryModel.ts`、`src/store.ts`、
  `src/features/assetLibrary/{store,AssetTile,AssetListView,AssetViewer,AssetCardMenu}.tsx` + 对应测试。
- **存储取舍（与口头方案的一处偏离，已在交付说明里报明）**：原话说用「系统标签」，落地改成
  **素材上的两个时间戳字段**（`postprocessAt` / `reviewedAt`）—— 因为素材库是 IndexedDB（无 schema 迁移成本），
  而标量字段能用现成的 `patchAssets(ids, patch)` **一次原子批量写**；走标签则要造「系统标签」机制
  （仓库里只有内置项目树、**没有内置标签**），且 `tagIds` 是整份替换、批量时得逐张合并，
  还会往用户的标签树里塞一个系统概念。
- **知情取舍**：功能上线**之前**已产出的历史素材不会亮「已使用」（当时没记这个字段）。
  回填需扫全部任务的 `postprocessOutputs`，本轮**刻意不做**（会让素材库 hydrate 变重），杰哥要了再补迁移。
- **改了什么（逐处）**
  1. `types.ts`：`GeneratedAsset` 加 `postprocessAt` / `reviewedAt`；`AssetPatch` 放行两者
     （`reviewedAt: number | null`，传 `null` = **清除**）。
  2. `lib/assetLibraryModel.ts`：
     - **`normalizeAsset` 白名单放行这两个字段** ← 最容易漏的一处。它是显式白名单，
       漏加 = 落库读回时字段凭空消失，而**全程一个错都不报**（界面只是不亮标签）。
     - `applyAssetPatch` 写入两者：`postprocessAt` 只写不清，`reviewedAt` 判 `undefined`（与 `colorLabel` 同款）。
     - 新增纯函数 `resolveAssetStatusMark`（两枚互斥、`postprocessAt` 优先 —— 事实优先于人的判断）、
       `canAssetBeReviewed`、`ASSET_STATUS_MARK_LABELS`（网格胶囊与列表 chip **共用同一份文案**，防两处叫法分叉）。
  3. `features/assetLibrary/store.ts`：
     - `markAssetsReviewed(ids)`：**逐条**过 `canAssetBeReviewed` 过滤，返回 `{ marked, skipped }`；
       一张都不可标时**不写库、不留撤销记录**（否则 Ctrl+Z 会回退一次「什么都没改」）。
     - `applyPostprocessProduced(assetIds)`：一次原子批量写 `{ postprocessAt, reviewedAt: null }`；
       **刻意不进撤销栈** —— 它是链路写下的事实，进栈会让 Ctrl+Z 撤销掉「已使用」。
     - `patchAssets` 加可选 `label`：撤销栈里显示「标记为已审核」而不是笼统的「修改素材」。
  4. `store.ts`：新增 `markImagesPostprocessed(imageIds)`（按需构建 `imageId → assetId` 反查表），
     接在**自动**（`scheduleTaskPostprocess` 写回任务之后）与**手动**（`executePostprocessImageIds` 出结果之后）两处。
     **产出为空的批次根本不调用**：失败与「配置指向空产出」都不算已使用 —— 亮一枚没有产物支撑的标签比不亮更糟。
  5. UI：`AssetTile` 导出 `AssetStatusBadge`，**只出外观、定位由调用方给**
     （`cx` 是纯字符串拼接、不做同类冲突合并，组件里写死 `absolute left-5` 再让调用方传 `left-3` 会两条并存）
     + 砖上左上角（颜色圆点右侧）渲染；`AssetListView` 改用**行内 chip**
     （那列缩略图只有 56px 宽，三个字的胶囊会把画面盖掉大半）；`AssetViewer` 大图左上角；
     `AssetCardMenu` 加「标记为已审核」项（含置灰与跳过文案）。
- **验收证据**（2026-09-22）
  - **全量 `npm run verify` 通过**：`262 files / 3124 passed`（Node v24.14.0，tsc 双端 + lint +
    format:check + test 全绿）。比 TB-104 时的 3111 多 **13** 例 —— 正是本轮新增的 6 + 5 + 2。
  - 定向：`assetLibraryModel.test.ts` **33 passed**（新增 6）、`assetLibrary/store.test.ts`
    **100 passed**（新增 5）、`AssetCardMenu.test.tsx` **10 passed**（新增 2）；
    改动文件 `eslint` 零告警、`prettier --check` 通过。
  - **反向验证 3 条，全部精确命中**（每次只红目标那几条，其余照过；改完已逐个回读校验复原）：
    1. `markAssetsReviewed` 去掉互斥过滤 → store **2 failed / 98 passed**，
       报错 `expected { marked: 2, skipped: 0 } to deeply equal { marked: 1, skipped: 1 }`；
    2. `normalizeAsset` 不放行新字段 → model **1 failed / 32 passed**，`expected undefined to be 1727`
       （正是「白名单漏加 = 静默丢字段」的样子）；
    3. 菜单项改成不置灰 → 菜单 **1 failed / 9 passed**，`expected false to be true`。
- **遗留 / 未覆盖**
  1. 「产出成功 → 回写素材」这根**中间的线没有端到端用例**（要跑通 electronAPI + 渲染链）：
     产出侧与素材侧各自有测试，中间那一跳靠代码审查 + 类型检查。
  2. 历史素材不回填（见上「知情取舍」）。
  3. **未经真机渲染验证**：胶囊与颜色圆点 / 选中勾并存时的实际观感，请在运行中的应用里过目
     （本机做不了网页与离屏渲染，这是环境级限制）。

---

### TB-106 素材库「任务卡片切换界面后消失」（内存缓存窗口不该决定可见性）

- **来源**：杰哥 2026-09-22 21:32 原话：「任务卡片经常丢失。切换界面后卡片会消失，按 Ctrl+R 刷新后
  也可能丢失，有时必须重新加载才能重新显示，但缺失依旧存在。」
- **状态**：DONE（代码）· **未提交**（工作区挂着 TB-105 的未提交改动，R-09 / R-79 无法分离）
- **实测取证**（只读直查 dev 库 `%APPDATA%\tangbao\local-saves\db\asset-kernel.sqlite`，
  探针写 `%TEMP%\tb-orphan-probe-{1,3,4}.py`，`mode=ro` 满足 R-06）

  | 指标 | 实测 |
  | --- | --- |
  | tasks 记录 | 566（有 `outputImages` 的 556） |
  | assets 行 | 484（active 479 / trashed 5） |
  | **孤儿素材（主来源 taskId 查不到）** | **0** |
  | `origins` 为空的素材（导入图） | **0** |
  | 内存缓存窗口（`hydrate` 的 `limit: 200`）覆盖到 | 2026-09-21 11:51 |
  | **落在窗口之外的 active 素材** | **279 / 479（58%）** |

  ⇒ **落盘完全健康，一条任务都没丢**。所以「任务卡片消失」与删除/孤儿/落盘**都无关**。

- **代码根因（三处，缺一不可）**
  1. **内存缓存窗口被当成可见性判据**：`query.ts:199` 旧实现 `if (!live || live.status !== asset.status)
     return false` —— 桌面端启动只把**最新 200 条**灌进 `assetsById`
     （`assetLibraryRepository.ts:175-182` 写死 `limit: 200`），**窗口外的素材一律被剔除**，
     不显示、不报错、不留占位。
  2. **没有分页快照时整屏换成另一份数据源**：`AssetLibraryWorkspace.tsx:483` 旧实现
     `if (!catalogPage) return queryResult` —— `catalogPage` 是**组件局部 state**，
     切界面重挂载 / 切范围都归零，于是整屏退回「只画内存那 200 条」。
  3. **查询失败静默清空、且不重试**：`.catch(() => setCatalogPage(null))` —— 一次失败 = 一批卡片
     消失，且 effect 依赖没变、不会再跑，只能重启（这正是「缺失依旧存在」）。
- **改了什么（逐处）**
  1. `src/features/assetLibrary/query.ts`：`!live` 时**以数据库分页结果为准保留**（数据库那一页
     本身已按范围/搜索/筛选查过，无需复检）；`live` 存在时行为不变（删除/回收即时消失、
     移动/改标签复检）。
  2. `src/features/assetLibrary/AssetLibraryWorkspace.tsx`：
     - 新增 `catalogError` / `catalogRetryToken`；
     - **查询失败不再清分页快照** —— 有快照就留着（卡片不消失，只出一条「刷新失败」+ 重试），
       没快照（首帧 / 刚切范围）则由内容区显示失败态 + 重试；
     - 新增 `catalogAwaitingFirstPage = desktopCatalog && !filterFavorite && !catalogPage`：
       这种状态下内容区显示「素材列表加载中…」，**不再拿内存那一份当整屏数据源**；
     - 重试令牌进查询 effect 依赖数组，失败后能真正重跑。
- **验收证据**
  - `vitest run src/features/assetLibrary src/lib` → **124 files / 1318 passed**；
  - `npx tsc -b` 零错；`eslint` 三个改动文件零告警；三个文件 `prettier --check` 通过。
  - **反向验证（精确命中）**：把 `query.ts` 改回 `if (!live || …) return false` →
    **恰好 3 条红、其余 39 条绿**：`keeps assets absent from the in-memory state（内存缓存窗口之外不能剔除）`
    / `keeps snapshot objects when the asset is not in memory (defensive fallback)`
    / `keeps a whole page when the in-memory cache window is narrower than the library（TB-106 回归）`
    ，改完已逐行回读校验复原。
  - ⚠️ 顺带修掉两条**把 bug 钉成预期行为的用例**：`query.test.ts` 原先一条叫
    `drops assets absent from the in-memory state`（断言剔除），另一条标题写 `keeps snapshot objects
    when the asset is not in memory`、**断言却是 drop** —— 标题与断言自相矛盾，说明作者本意就是保留。
- **遗留（未做，已登记 RISK）**
  1. **真正根治**是把分页快照提到 `features/assetLibrary/store.ts`（模块级、跨重挂载存活），
     但该文件是 TB-105 的未提交文件，本轮**一个字节都没碰**（R-09 / R-79）。
  2. **内存缓存仍是 200 条窗口**：`hydrate()` 每次启动都重置，窗口外素材每次都要靠目录查询挣回来。
     要不要放全量（`hydrateFull`）是启动性能取舍，留给杰哥拍板。
  3. **侧栏 / 工具栏计数在首帧仍走内存派生**（`queryResult.counts`），加载态只是把网格盖住了，
     数字会短暂偏小 —— 与「快照提到 store」一并解决更合适。
  4. `resolveEffectiveAssets` 的 `live.status !== asset.status → 剔除` 是**同一类隐患的反向**
     （内存陈旧时会把回收站里的图剔掉），本轮**刻意未动**，另记 RISK。

#### TB-106 第二轮（同日 22:40，杰哥「接着做」）

**又修掉两条 + 撤销一条我自己的假警报。**

1. **「还没量到宽度 → 渲染 1px 幻影卡片」已修**（`AssetBatchView.tsx`）
   - 测量 effect 的依赖原先只有 `measure`（`useCallback([])` 恒定）⇒ **一生只跑一次**；
     首帧若落在空态（两个 ref 都是 `null` 就 `return`），`ResizeObserver` **从此永不建立**
     ⇒ `layoutWidth` 恒为 0 ⇒ `cardWidth` 算成 `Math.max(1, 负数)` = **1px** ——
     卡片「在 DOM 里但看不见」，不报错、不留占位。
   - 改法：新增 `hasMeasurableContent`（空态与非空态是两棵子树）进依赖，空 → 非空必补一次测量；
     `cardWidth` 在 `layoutWidth === 0` 时保持 0，由 `visibleItems` 拦住不渲染。
   - 守卫用例：`AssetBatchView.test.tsx`「never renders 1px phantom cards while the layout width
     is unknown」；harness 的 `renderGrouped(layoutWidth = 800)` 新增参数，传 0 即可模拟。
   - **反向验证精确命中 1 条**（`cardWidth` 改回旧算法 → 恰好那条红）。
   - ⚠️ **实测踩到的测试卫生坑**：这类用例**必须 `try/finally` 卸载 renderer**
     —— 本文件后续用例共用 `useAssetLibraryStore`，断言失败时漏掉 `unmount()` 会把
     「查看来源任务」那 3 条滚动用例一起带红（出现 3 条迷惑性连带失败，浪费了一轮排查）。
2. **查询失败自动补试一次**（`AssetLibraryWorkspace.tsx`）：600ms 退避，成功后计数归零；
   再失败才停在提示条 / 失败态等人工重试。瞬时 IPC 抖动不该让用户自己去找「重试」按钮。
3. **撤销 TB-106 第一轮的「遗留 4」**（`live.status !== asset.status → 剔除` 的反向隐患）：
   **经复核不成立** —— 本应用单实例，所有状态变更都经 store 同时写内存与库，直写库的批量路径
   （导入 / 恢复 / 迁移）后面都跟 `hydrate()` 重灌内存 ⇒ 内存只可能比库新，不可能更旧，
   「库说 trashed、内存还说 active」不可达。已同步更正 RISK R-91（不留假警报）。

**验收证据（第二轮）**：`vitest run src/features/assetLibrary src/lib` → **124 files / 1319 passed**
（比第一轮多 1 条，即新增的 1px 用例）；`tsc -b` 零错；五个改动文件 eslint 零告警 + prettier 全过。

**仍未做（等杰哥拍板）**：启动 `hydrate()` 的 200 条窗口要不要全量化（会拉长启动）；
分页快照提到 `features/assetLibrary/store.ts`（要碰另一条写线的未提交文件，本轮一个字节没碰）。

---

### TB-107 分发排期：起算日自动 + 原地建日期文件夹 + 按素材打乱

> ⚠️ **2026-09-23 晚补**：标题里的「**原地建日期文件夹**」已被 **TB-117** 推翻
> （杰哥报障「同一张图出现两份」）。仍然有效的是「起算日自动」与「按素材打乱」两条口径；
> 其余（原地套一层、恒定复制）按 TB-117 的新结构读。**不要照本条的验收表改回去。**
> 下表最后两条用例已按 TB-117 改写，现名分别是「⭐ 铺 N 天：产出文件夹按排期日改名，同级并列」
> 与「⭐ 起算日 = 产出当天时一个字节都不搬：没有副本、也没有 -2」。

- **来源**：杰哥 2026-09-22 报障 + 原话
  - 「目标目录留空时，分发就是原地按日期建子文件夹，但却没成功」
  - 「**这是你机制的问题，就不该让我自己填日期**」
  - 「我是一批图导出不同渠道不同位置，**图的数量是固定的**」（⇒ 跨渠道同步是硬需求）
- **状态**：DOING（本轮完成「起算日自动 / 原地语义 / 按素材打乱」三项；方向级覆盖待做）

**报障的真因（复盘）**：不是分发坏了，是**机制本身让用户填了一个他不该填的量**。
`startDate` 由用户手填 ⇒ 填成产出当天时，`baseDir` 里的日期段被替换成同一个日期 ⇒
**目标目录 == 产出目录** ⇒ 每个文件与**自己**撞名 ⇒ 整目录凭空多出一份 `-2` 自我复制。
用户在另一台电脑上试，只看到「没成功」，磁盘上不留任何可解释的痕迹。

**验收标准（本轮部分，已达成）**

| 项 | 验收方式 |
| --- | --- |
| 起算日不再由用户填 | 界面上不再有「起始日期」输入框（`ConsolePostprocessSections.test.tsx` 断言 `not.toContain('起始日期')`）；导出表 8 行、不再含 `startDate` |
| 起算日 = 产出当天，且与命名模板 `{date}` 同源 | `runTaskPostprocess` 把 `input.createdAt ?? Date.now()` 归一化成 `createdAt` 后，**同时**喂给命名与分发（跨零点不会差一天） |
| 原地恒定建日期子文件夹 | `postprocessDistribution.test.ts`「⭐ 原地恒定建日期子文件夹，不再替换目录名里的日期段」 |
| 起算日 = 产出当天不再自我复制 | 同上文件「⭐ 起算日等于产出当天时，目标目录是日期子文件夹而不是文件自己（自我复制回归）」 |
| 打乱按素材（跨渠道同期） | 同上文件「⭐ 打乱按素材洗牌：同一张图在各渠道目录里落在同一天」（连跑 3 次含随机的用例均稳定） |
| 纯净版只在显式勾选时产出 | `storePostprocessMedia.test.ts`「⭐ 勾渠道媒体时不再自动补纯净版」+「显式勾选纯净版时排在渠道之前产出」 |

**实施要点（代码位置）**

- `src/lib/postprocessDistribution.ts`：删 `startDate` 字段与 `DATE_SEGMENT_TEST`；
  新增 `toBaseDate()`（导出，供调用方算 `baseDate`）与 `buildSourceRank()`（全量素材只洗一次牌，
  各组按同一序号排序 ⇒ 同一素材在各渠道落在同一天）；原地改为恒定 `pathJoin(baseDir, targetDate)`。
- `src/features/postprocess/taskPostprocess.ts`：归一化 `createdAt`；登记项带 `sourceKey: imageId`；
  `distributeOutputs` 多收一个 `createdAt` 并算出 `baseDate` 传给执行体。
- `src/features/postprocess/PostprocessDistributionFields.tsx`：日期输入框 → 「铺几天」+ 一句口径说明。
- 纯净版：`autoCompanionClean` 全链删除（类型 / 归一化 / partialize / action / 产出计划 /
  导入导出 / treeConfigBundle / R-63 迁移字段 / UI 开关），**`PURE_MEDIA_ID` 保留**（还能显式勾选）。

**验收证据（本轮）**

- `npx tsc -b` 零报错 · `tsc -p electron/tsconfig.json --noEmit` 零报错
- 改动文件 eslint 零告警 · `prettier --check` 全过
- **`npx vitest run` → 262 文件 / 3133 用例全绿**
- 定向：`postprocessDistribution.test.ts` 30 条（含 2 条新回归）连跑 3 次稳定

**行为变化（要写进 RELEASE.md）**

1. **纯净版不再自动伴随**：原来默认 `autoCompanionClean: true`，勾任一渠道就多产一份无水印原图
   （= 把素材库里本来就无水的原图有损重编一份）。升级后**产出会比以前少一份**，这是预期变化。
2. **起始日期不再手填**：旧配置里存过的 `startDate` 被忽略（`normalize` 不读），界面与导出表都已去掉。

### 第二轮：分发排期回到方向层（2026-09-23 · ADR-0017）

**杰哥 2026-09-23 01:15 选 A 方案**：只有「铺几天 / 跳过周末」跟方向走，
其余（启用 / 搬运方式 / 重命名 / 打乱 / 改 md5 / 目标目录）留全局。

- `PostprocessNodeOverride.distribution?: PostprocessDistributionOverride`
  （`= Partial<Pick<…, 'days' | 'skipWeekends'>>`）；`applyPostprocessOverride` **逐字段**合并
  ⇒ 节点只改「铺几天」不会把目标目录一起抹成默认。
- `normalizePostprocessNodeOverride` 恢复读它；`collectPromotedNodeFieldValues` 不再提升它
  （但 `PromotedNodeFieldValues.distribution` 与 `mergePromotedGlobals` 的合并**保留** ——
  那是给「已经迁移过一次、值已落在全局基线里」的历史数据用的，删掉会让那批用户的排期消失）。
- 中控台分发小节接作用域：排期那组带「本级自定义 / 恢复继承」，其余字段**始终写全局**
  （表单内**分开投递**：否则节点上改排期会把目标目录一起写进节点覆盖）。
- 反转 `params.test.ts` 里「节点写 distribution 会被丢弃」那两条；
  与「namePattern / creator 仍被丢弃」形成**互为反向**的钉子（同样是曾被收走的字段，
  一个读不回来、一个能读回来，谁改错谁看到它变红）。
- 新 ADR `0017-distribution-schedule-follows-direction.md`，并在 ADR-0011 顶部加了交叉引用提示。

**验收证据（第二轮）**：`tsc -b` 零错 · 改动文件 eslint 零告警 · prettier 全过 ·
**`npx vitest run` → 264 文件 / 3159 用例全绿**（比第一轮多 26 条）。

**仍未做**

- 分发结果可见性（「已排期 N 个 → M 天」写进运行结论）。

### TB-117 分发：按排期日整装（撤「原地套一层日期子文件夹」+ 撤复制）

- **来源**：杰哥 2026-09-23 报障三条 ——「① 导出后出现了重复的两份素材；② 导出位置仍然只有一个，
  只是在其中增加了子文件夹；③ 子文件夹仅以日期命名，实际应采用完整的命名（至少应改变日期）」。
  他给的目标形态：「沿用命名模板，只改日期命名」，实现上「先导出到当天日期的文件夹，再算每天多少个、
  剪切进去」。
- **状态**：DONE（代码）· 验收证据见下

**真因（三条全在 `src/lib/postprocessDistribution.ts`）**

| 现象 | 成因 |
| --- | --- |
| ① 重复两份 | `resolveBaseTargetDir` 在 `targetDir` 留空时**返回产出文件夹自身**（:252）+ `mode` 默认 `copy`（:47）⇒ 在产出文件夹里**复制自己**。这是「copy × 原地」组合的必然结果，不是偶发。 |
| ② 位置没变 | 同上；另外 `targetDir` 填成**输出根**时，「保留相对结构」（:257-262）会把目标算回产出文件夹自身 ⇒ **填了等于没填**（独立 bug）。 |
| ③ 只有日期 | `:379` 硬编码 `pathJoin(baseDir, targetDate)`，命名模板产出的 `folderName`（`{date}-{product}-{direction}-{media}-{size}`）被整段丢掉。 |

**改法（新口径）**

分发 = 在「分发根」下建一个**以排期日开头的完整命名文件夹**，把当天的文件放进去。

- 分发根 = `targetDir`；留空 = 产出文件夹的父目录（= 输出根）⇒ **同级改名**，不换位置、不产生副本。
- 文件夹名 = 产出文件夹名，日期段换成排期日：`20260922-高颜值-头条-广点通-1140x640`
  →（铺 3 天）`20260923-…` / `20260924-…` / `20260925-…`；模板里没有 `{date}` 时前置排期日。
- **排期日与文件当前位置重合（= 第 1 天，起算日就是产出当天）→ 跳过，一个字节都不碰**。
- **搬运恒定 move**，`mode` 字段删除（旧数据里的值不读）：这套结构下 copy 不成立 ——
  第 1 天是原地（无副本可言），第 2 天若复制，第 1 天的目录里会留着所有天的文件，排期整个错乱。

**验收标准**

| 项 | 验收方式 | 证据 |
| --- | --- | --- |
| 不再原地复制 | 第 1 天（起算日 = 产出日）`distributeFile` 调用次数 = 0，且 `moved[0].targetPath == 原路径` | `postprocessDistribution.test.ts`「⭐ 起算日 = 产出当天时一个字节都不搬」 |
| 同级改名、不套一层 | 目标路径为 `<根>\<排期日>-<完整命名>\<文件>`，与产出文件夹同级 | 同上「⭐ 铺 N 天：产出文件夹按排期日改名，同级并列」 |
| 搬运恒定 move | 全部调用 `mode === 'move'` | 同上「搬运恒定是 move」 |
| `targetDir` = 输出根时不再算回原地 | 目标 ≠ 源，路径落在输出根下的排期文件夹里 | 同上「⭐ 目标目录填成输出根本身时不再「算回原地」」 |
| 完整命名 | `buildDistributionFolderName` 单测（含无日期段前置、下划线命名） | 同上 4 条 |
| 界面无「搬运方式」 | `ConsolePostprocessSections.test.tsx` 断言 `not.toContain('搬运方式')` | ✔ |
| 导出表同步 | `consoleWorkbook.test.ts` 断言分发表 7 行、不含 `mode` / `startDate` | ✔ |

**顺带修的独立 bug**：`targetDir` 填成输出根（或产出文件夹的任意上级）时，相对结构回填会把目标算回
产出文件夹自身 —— 用户视角是「填了等于没填」（②的成因之一）。

**行为变化（要写进 RELEASE.md）**

1. 分发结果从「产出文件夹里多一层 `20260923\`」变成「产出文件夹**同级**出现 `20260923-高颜值-头条\`」；
2. 第 1 天不再动文件（原来会复制一份进去）；铺 1 天 = 什么都不做；
3. 「搬运方式（复制 / 移动）」开关撤掉（`PostprocessDistributionConfig.mode` 删除，旧值忽略）。

**坑（已写进模块注释）**：判定「文件夹名里有没有日期段」**不能**用「replace 结果是否与原名相同」——
排期日恰好等于产出日时（就是第 1 天）替换结果一字不差，会被误判成「没有日期段」而凭空加前缀，
第 1 天就不再是原地。要用独立的**非全局**正则副本判定。

---

### TB-108 每日素材批量生成：策略卡 + 每日比例抽取 + 预览审核发布

- **来源**：杰哥 2026-09-23 01:02 口述四条 —— ① 需求分析与拆解；② 策略卡管理页
  （每张 SOP 或配方卡出图后可转成策略卡，卡须关联方向与产品，一个方向可有多张）；
  ③ 每日生成任务（以项目为单位设每日总数如 1000 张，为每个方向配抽取比例，
  每天按比例从各方向策略卡中随机抽取并生成对应数量，确保总数达标，多产品各配各的）；
  ④ 预览与后续处理（专门的预览界面、按方向分区展示、可看详情，审核通过后执行后处理并分发）。
- **状态**：DOING · 本线
- **杰哥拍板（2026-09-23，三选三）**
  1. **策略卡 = SOP/配方卡 × 方向**：每张卡引用一张 SOP/配方卡并固定挂在某个方向下
     （同一张 SOP 可在不同方向各建一张，参数互不干扰）；出图后点「存为策略卡」建立。
  2. **应用开着才跑**：复用现有「运行期每分钟 tick + 当天只跑一次」的机制，**不动主进程调度**。
  3. **一期范围**：策略卡 + 每日生成 + 预览审核（通过后触发现有后处理分发）一次做完。
     每日报表 / 失败补跑 / 多产品并发闸门留二期。
- **现状（开工前查证：三块有现成骨架，两块纯新建）**
  - **按比例分张数已有**：`agentBatchPlanner.ts:127 allocateInteger` —— 先按权重取底、
    余数按小数部分从大到小补，**合计恒等于总数**（「确保总数达到设定值」就靠这条）。
  - **「随机但不重复」已有引擎**：配方卡 `campaignRecipe.ts` 的最远点采样 + `existingPrompts`
    跨批次去重；三个入口签名一致（`storeSopGeneration.ts:381/609/856`）。
  - **每日一次的跑批模式已有**：`AgentBatchQueueRunner.tsx`（60s tick + `lastRunDate` 去重）。
  - **出图只要一条线**：`submitTaskWithData`（`store.ts:6036`），带 `sopBatch.batchId` +
    `defaultCollectionId` 就能「批次可聚 + 自动归档到方向」—— **不另开生成链路**。
  - **审核 / 后处理 / 分发已有**：`reviewedAt` + `markAssetsReviewed`（TB-105）；
    `runManualPostprocess`（`store.ts:1117`）；输出位置按方向解析；命名模板全局一套。
    ⇒ **本页不重配后处理参数，全用中控台已有配置**。
  - **新建**：策略卡实体本身、长期「每日配置」、按方向分区的预览页。
- **验收标准**（可测）
  1. 策略卡页：左树选方向、右侧该方向的卡；能新建 / 启停 / 删除；卡上显示引用的 SOP
     与**从树推出的产品名**（产品不落在卡上）；
  2. 卡引用的 SOP 被删、或挂的方向节点没了 ⇒ 卡片标红并写清原因，不参与抽取；
  3. 每日配置按产品设总数 + 各方向比例；**各方向张数之和恒等于总数**；
  4. 比例旁**实时显示折算张数**（配 50% 就看到 500 张），用的是与跑批同一个分配函数；
  5. 多产品各配一套，互不影响；
  6. 应用内每分钟检查，当天只跑一次（`findRun(date, product)` 去重）；可手动「立即跑一次」；
  7. 预览页按方向分区，显示「计划 N / 已出 M」，差的张数与原因一并显示；
  8. 整区 / 单张挑选通过后，走现有后处理链路（水印 / 适配 / 命名 / 按方向落盘 / 分发）；
  9. 新 namespace 进主进程白名单（有守卫测试钉着）、新增 `.tsx` 全部登记 catalog；
  10. 全量 `npm run verify` 全绿。
- **改动面**
  - 新增 `src/features/dailyBatch/`：`types.ts`、`normalize.ts`、`planner.ts`、`runner.ts`、
    `execute.ts`、`scope.ts`、`store.ts`、`DailyScopeTree.tsx`、`DailyWorkspace.tsx`、
    `StrategyCardsSection.tsx`、`DailyTargetsSection.tsx`、`DailyReviewSection.tsx`、
    `DailyBatchRunner.tsx` + 3 个测试文件。
  - 修改：`electron/asset-kernel.ts`（namespace 白名单）、`src/types.ts`（AppMode）、
    `src/components/Header.tsx`（tab）、`src/App.tsx`（lazy + 分支 + 执行器挂载）、
    `src/store.ts`（setAppMode 分支 + **持久化归一化白名单**）、
    `src/design-system/catalog.ts`（pageCoverage + legacyComponentCoverage）、
    `src/design-system/page-coverage-regression.test.tsx`、`design-system/tangbao/pages/daily.md`。
- **设计取舍**
  - **产品不落库**：卡上只存 `directionCollectionId`，产品沿树由 `describeCollectionPath` 推导。
    改名 / 移动节点后归属自动跟着走；代价是节点被删时只能退到 id 显示（已写明）。
  - **策略卡只引用不复制 SOP**：改 SOP，所有引用它的卡一起变；SOP 删了则卡标失效并报出来。
  - **不新建第二棵树、不新配后处理参数**（见「现状」）。
  - **随机做成「按日期的稳定抖动」**（`dailyJitter`）：每天份额有浮动，但当天重跑结果一致
    —— 用 `Math.random` 会让补跑翻盘，出了问题没法复现。
- **知情取舍**
  1. **应用关掉就不跑**（杰哥已拍板），机器休眠 / 关机当天不补。
  2. **串行提交**：1000 张会慢，但不会把 API 打挂；并发闸门留二期。
  3. **1000 张/天受 API 并发与配额限制**，建议先 100–200 张验证链路（数量本身可配）。
  4. **未经真机渲染验证**：新页面布局请在运行中的应用里过目（本机做不了网页与离屏渲染）。
- **第二轮（2026-09-23 上午）：把「出图后存为策略卡」的入口接上**（杰哥需求原文里的那一步）
  - **落点**：素材库**任务卡片视图的 SOP 批次卡**（`SopBatchTaskCard`）—— 批次粒度正好对应
    「一次用某张 SOP 出的一批图」；通用任务卡上没有 SOP 信息，不适用。
  - 按钮是**受控**的（`onSaveAsStrategyCard` + `saveAsStrategyCardDisabledReason`），
    与既有的 查看批次 / 再次生成 / 删除 三个操作同款。
    ⚠️ `SopBatchTaskCard` 是 `memo` + **自定义比较函数**，新 prop 必须加进比较函数，
    否则按钮点击后状态不刷新（改了却像没改）。
  - 两种「不能存」的情形**置灰并把原因写在 title 上**，既不藏按钮也不让它点了没反应：
    ① 这批不是 SOP 出的（没有可引用的卡片）；② 发任务时素材库没选中文件夹
    （策略卡必须挂在方向上，没方向就无处可挂）。
  - 重复判定抽成纯函数 `hasSameStrategyCard`：同一张 SOP 在同一方向已有卡 ⇒ 提示「已存在」，
    而不是默默多建一张（两张一样的卡只会把当天的张数摊薄两份）。
    **同一张 SOP 在不同方向不算重复** —— 这正是「一卡一方向」的用法。
- **验收证据**（2026-09-23）
  - **全量 `npm run verify` 通过**：`265 files / 3171 passed`（Node v24.14.0，tsc 双端 +
    lint + format:check + test 全绿）。比开工基线 `262 / 3133` 多 **3 文件 38 用例** —— 全部是本轮新增。
  - 定向：`planner.test.ts` **18 passed**（比例分配 / 抖动可复现 / 跳过原因 / 存卡去重）、
    `normalize.test.ts` **10 passed**（含⭐字段白名单往返）、`runner.test.ts` **8 passed**
    （含⭐单卡失败不牵连整批、⭐SOP 被删不静默）、`AssetBatchView.test.tsx` **29 passed**
    （既有用例未受影响）。
  - 门禁关联：`appDataNamespaceContract.test.ts` 3 passed（新 namespace 已进白名单）；
    `catalog.test.ts` / `page-coverage-regression.test.tsx`（新页面登记 + `pages/daily.md` 存在）。
  - **开工前先收口了 TB-105**：那批未提交改动（11 文件 / 396 行）单独提交为 `0e8c4c2`，
    与本轮改动分离（R-09 / R-79）。
- **遗留 / 未覆盖**
  1. **未经真机渲染验证**：新页面布局请在运行中的应用里过目（本机做不了网页与离屏渲染）。
  2. 每日生成**没有端到端用例**（要跑通真实 API + 电子环境）：分配、归一化、编排三层各有测试，
     「提示词引擎 → `submitTaskWithData`」那一跳靠注入点隔离 + 类型检查。
  3. 「存为策略卡」这条 UI 路径**只有纯函数层有测试**（去重判定），按钮本身无组件测试
     （`SopBatchTaskCard` 目前没有测试文件）。
  4. 二期：每日报表、失败自动补跑、多产品并发闸门。
- **⚠️ 并行写线提醒（开工时实测）**：本轮开工时 `src/features/projectTree/params.ts` 与
  `src/lib/postprocessMedia.ts` 正被 TB-107 那条线**活跃修改**（`params.ts` 在开工前 12 秒
  刚落盘）。本轮**一个字节都没碰**这两个文件（R-09 / R-79）。

---

### TB-109 SOP 管理中心弹窗「标签栏被压扁」

- **来源**：杰哥 2026-09-23 报障「界面出BUG了，标签栏显示异常」→ 澄清为「SOP 管理弹窗」（安装版）
- **状态**：DONE · 主写线
- **现象**：打开 SOP 管理中心，顶部标签栏（SOP 库 / 生成元指令 / 智能生成）被压成一条，
  文字只剩上半截；**全程不报错**。dev 与生产构建表现一致（已在生产等效预览上复现原 bug）。
- **根因（见 R-92）**：`.sop-center-dialog` 是 `flex flex-col`，高度由 `max-height: min(86vh, 860px)`
  兜住；内容一多（SOP 列表）浏览器就**按比例压缩可收缩子项**。`.sop-center-header` 有
  `min-height: 3.25rem`，所以保住了自己；`.sop-center-tabs` 只有 `background` + `padding-inline`、
  **没有任何高度下限** ⇒ 实测被压到 **7px**。
- **改动**：`src/features/strategy/styles.css` → `.sop-center-tabs` 加 `flex: none;`（注释写明原因）。
- **验收证据**（2026-09-23）
  - **CDP 实测 `getBoundingClientRect`**：修复前标签栏高 **7px**（三个 `.ds-tabs__item` 全被压）；
    修复后 **41px**、三个标签各 **40px**，弹窗高度由 742（顶到 max-height）回落到 691。
  - 守卫：`sopCenterSizing.test.ts` 新增「标签栏不被压缩：必须不参与 flex 收缩」。
  - **反向验证**：撤掉 `flex: none` → **恰好 1 条红、其余 3 条绿**，报错原文即缺该声明；恢复后 4/4 绿。
  - ⚠️ 第一次反向验证**是假绿**：注释里写了「`flex: none`」几个字，而 `declarations()` 不剥注释、
    正则命中了注释 → 已修（见 R-93）。
- **未做**：其他用了同一个 `Tabs` 的地方（中控台 / 后处理参数面板）没体检 —— 它们当前渲染正常，
  但同属「放进行高受限 flex 列里的横向条」，若要根治应给 `.ds-tabs` 本身加不收缩约束（会动到
  design-system 组件，需单独评估）。
- **环境副作用（非项目问题）**：本机 `npm run build` 会被 WorkBuddy 的 safe-delete 护栏拦住
  （vite 清空 `dist/` 时一次删 62 个文件 > 阈值 50）。绕过方式与「备份目录必须移出项目根」的坑
  见 `docs/tangbao-ops-runbook.md` §二十五。

---

### TB-110 顶栏设计规范统一

- **来源**：杰哥 2026-09-23「顶栏存在设计风格、组件 UI 和对齐不统一的问题，按设计规范统一」
  → 先报方案（给出具体规范 / 组件范围 / 验收标准），杰哥选 **A+B** 后开工。
- **状态**：DONE · 主写线
- **范围**：A = 全局顶栏 `Header.tsx`；B = 各工作区顶部行（素材库 / 每日生成 / 中控台）。
- **问题（改动前实测）**
  1. **一行四种高度**：品牌图标 24 · 图标按钮 36 · 工作区切换 38（`.ds-segmented` 的
     padding 3px 把控件顶到体系外）· 统计胶囊 44（`px-1.5 py-1` + 边框）。
  2. **统计胶囊内部再叠一层**：指标块 34（`px-2.5 py-1`）vs 范围按钮 24（`py-1.5`），差 10px；
     且「胶囊套胶囊 + 各自 pill 圆角」与同排图标按钮的平面语言冲突（MASTER 4.5）。
  3. **两套图标按钮**：顶栏是手搓 `p-2 rounded-full` 幽灵按钮，素材库等处用的是设计系统
     `IconButton`（8px 圆角 + 描边）。
  4. **NEW 徽章手搓**：`rounded-sm` + `font-black`（超规范字重）+ 绝对定位魔法数字。
  5. **移动端第二行比第一行多缩进 8px**：组件自带 `mx-2`，叠加 `.app-mode-switcher--mobile`
     的 `width: calc(100% - 1rem)`。
  6. **动效手写**：`duration-300`；`transition`（全属性）出现在只变 max-height/opacity 的地方。
  7. **素材库水平内边距 32px**：全应用唯一一处（顶栏 `safe-area-x`、每日生成、中控台都是 16px，
     设计系统 `.ds-container` 的 `padding-inline` 也是 `--ds-space-4` = 16px）。
- **改动**
  - `src/components/Header.tsx`：图标按钮 → `IconButton`；统计区改为「指标组(gap-1) + 范围按钮」
    两组(gap-3)、全部 `h-ds-control-md`；NEW → `Badge tone="danger"` 并改为同排 flex 项；
    品牌区 `items-start` → `items-center`；去掉 `max-w-7xl`（应用壳不套内容宽度上限，
    与下方工作区标题行共用 16px 基线）；移动端去掉 `mx-2`；动效改
    `duration-[var(--ds-duration-normal)]` / `ease-[var(--ds-ease-in-out)]`，
    并只声明实际变化的属性。
  - `src/index.css`：`.app-mode-switcher--mobile` 宽度 `calc(100% - 1rem)` → `100%`。
  - `src/design-system/styles.css`：`.ds-segmented` 落到控件高度体系 —— `padding: 3px` → `2px`、
    圆角 `lg(12px)` → `md(8px)`，item 圆角 `md` → `sm(6px)`。
    ⇒ md 变体 = 30 + 4 + 2 = **36px**（`--ds-control-md`），sm 变体 = 26 + 4 + 2 = **32px**（`--ds-control-sm`）。
  - B 组：素材库 12 处 `px-8` → `px-4`（工具条 / 网格 / 批次视图 / 列表 / 表头 / 筛选条 /
    子文件夹条 / 提示条）；`DailyWorkspace.tsx` 手搓分区按钮 → 设计系统 `Tabs`
    （顺带修掉选中态用 `bg-ds-primary-subtle` 品牌蓝铺底的规范违规）。
- **验收证据（2026-09-23，CDP 实测实机窗口，非截图）**
  - 高度：`IconButton` ×3 = **36.0px** · 统计块 ×4 = **36.0px** · 范围按钮 = **36.0px**；
    段控容器 = **35.33px**（`dpr = 1.5` 把 1px 边框折算成 0.667 CSS px，逻辑值仍为 36px）。
  - 垂直对齐：上述元素与品牌区、段控 item 的中心线**全部 `cy = 28`**（顶栏 56px 的几何中心）。
  - 左基线：顶栏 `padding-left = 16px`、素材库工具条 `padding-left = 16px`。
  - 圆角：IconButton / 统计块 / 段控容器 = **8px**，段控 item = **6px**（改前分别是 pill / pill / 12px / 8px）。
  - 层级：IconButton 带 1px `ds-border` 描边（改前无边框）。
  - 动效：顶栏 `transition-property: transform`、`duration: 0.18s`（改前 300ms）；
    移动行 `transition-property: max-height, opacity, padding`（改前全属性）。
  - 移动端：切换器 `margin-left = 0px`、`width = 100%`（改前 8px / `calc(100% - 1rem)`）。
  - `npm run verify` → **265 文件 / 3172 用例全绿**（与 v0.3.6 基线同数，未新增用例）。
- **未做 / 说明**
  1. **中控台未改**：体检后已合规（`px-4` + 已用设计系统 `Tabs`），其标题行没有独立底线是
     因为下面的 Tabs 自带底线承担了分界，不是遗漏。
  2. **素材库工具条的 16px 是相对右栏的**（左侧栏展开时它不在窗口坐标起点上）——
     「顶栏与素材库内容左边界差 16px」的准确说法是「素材库内部用 32px、与全应用其余地方的
     16px 不一致」，本轮统一的是后者。
  3. 顶栏宽度上限：去掉了 `max-w-7xl`(80rem)。MASTER 4.4 的 75rem 针对「主内容」，
     应用壳跟随窗口；若日后要改，需连带 `AgentWorkspace` 的 `max-w-7xl` 一起评估（本轮未动）。
  4. 未新增回归用例 —— 本轮是样式/结构统一，既有 `compliance.test.ts` 棘轮负责「旧类只减不增」，
     实测数据来自 CDP 而非自动化断言。
- **⚠️ 并行写线（开工期间实测）**：`src/features/strategy/campaignRecipeImport.ts` 在
  10:34:41 被**另一条线**修改（dev 日志里的 `page reload` 暴露的），本轮**一个字节没碰**该文件，
  提交时也只 `git add` 本轮文件（R-09 / R-79）。

### TB-111 配方卡导入兼容「一键衍生」模板

- **来源**：杰哥 2026-09-23 要求分析「一键衍生与配方卡共用的逻辑实现」，评估让配方卡兼容识别
  一键衍生格式提示词的可行性 → 先给结论（含实测证据与改造点清单），杰哥回「可以」后开工。
- **状态**：DONE · 主写线
- **背景（实测：改动前 0% 可识别）**：一键衍生产物是「正文 + 单独一行『可变项：』+ `{{名}}：A / B`」，
  而配方卡导入解析器 `parseCampaignRecipeText` 只认配方卡 JSON 与「template / pools」自由排版。
  用 esbuild 把解析器打包到 `%TEMP%` 跑真实样例：`ok=false`、`body` 空、`dimensions` 空，
  报文「既不是合法 JSON，也没有找到 template / pools 结构」。缺口四点：① 不认「可变项：」区块头；
  ② 正文没有 `template:` 前缀就被整段丢弃；③ 选项分隔符集合不含 `/`（一键衍生只认它）；
  ④ 定义行的 `{{名}}` 若手工改写成配方卡键名会连花括号一起入库，与骨架里的占位符对不上。
- **改动（只新增，存量逻辑一条未改）**
  - `campaignRecipeImport.ts`：新增「一键衍生（变量提示词）分支」——
    `looksLikeVariablePromptTemplate`（互斥守卫）+ `splitLeadingRecipeMeta`（剥离手写的 name/说明 行）
    + `parseVariablePromptRecipe`（**复用 `lib/variablePrompt.ts` 的 `parseVariablePrompt`**，
    不另抄正则 —— 抄一份就等于把口径复制成两份，漂移后会变成「那侧认得出、这侧认不出」这种
    只能靠人工比对发现的咬合问题，即 R-53 / R-54 的病根）。
    分支插在 JSON 与自由排版**之间**；守卫保证含 `template / body / pools / master / 骨架` 的文本
    仍走原生分支。失败文案改写为指向一键衍生格式（沿用原文案会把用户带去检查一个根本不存在的键）。
  - `ParsedCampaignRecipe.source` 增 `'variable-prompt'`；
    `SopCampaignRecipeParseResultDialog.tsx` 的 `SOURCE_LABEL` 同步（穷尽 Record，改漏了 `tsc` 就红）。
  - `SopCampaignRecipePanel.tsx`：录入说明与 placeholder 补一键衍生范例。
- **验收证据（2026-09-23）**
  - `campaignRecipeImport.test.ts` 17 → **25 例**（新增 8 例：基本识别 / 落成引擎可直接消费的 config /
    name 描述剥离 / 引用未定义变量补空池 / 互斥守卫 / 失败文案指向 / 头部未独占一行仍容忍 /
    单花括号骨架只当引用并提示变量被忽略）。
  - **反向验证**：把新分支临时短路 ⇒ 新用例 **7 条红**、旧 18 条全绿。证明用例确实在测这条路径，
    且老路径零影响（防 R-93 那类「注释骗过测试」的假绿）。
  - 定向回归：`src/features/strategy` + `src/lib/variablePrompt.test.ts` = **36 文件 / 499 例全绿**；
    `src/design-system`（含合规棘轮）= **12 文件 / 272 例全绿**；
    逐条门禁 `tsc -b` / `eslint`（改动文件）/ `prettier --check`（改动文件）全绿。
  - **未跑全量 `npm run verify`**：与 TB-110 写线并行期间工作区混着对方 WIP，全量结果绿红都不可信
    （R-74）⇒ 改跑定向用例 + 逐条门禁；收工时工作区已只剩本轮 4 个文件。
- **未做 / 说明**
  1. **判定层一个字没动**：`isCampaignRecipeSop` / `isLocalGenerationSop` 保持原口径。一旦判定也认
     变量提示词格式，`GallerySopBatchModal` 里 `isLocalGenerationSop` 优先的分流会把**所有一键衍生
     SOP 抢进配方卡引擎**（AI 扩词条、可变项参数面板全部失效，R-53 / R-54 复发）。
  2. `splitOptions` 未加 `/` —— 会改变既有自由排版资产的解析口径（候选值含 `16/9` 之类会被误切）。
  3. 已知取舍：转成配方卡后**组合不足不再自动调 AI 扩词条**（只报「候选组合已耗尽」）、
     生成时走配方卡合规红线（含「最高 / 第一 / 军」等词的候选值会被剔除）、
     `variableMeta`（主题 / 类型 / 衍生数量）在配方卡无对应物，只能丢弃。

### TB-112 后处理按产出方向拆成独立运行实例

- **来源**：杰哥 2026-09-23「当前后处理是全局单例的：只要有一个方向启动了后处理，该功能就被
  整体占用，其他方向无法同时使用。请改为按方向维度管理」。先出诊断 + 方案（含四项说明：
  涉及模块 / 数据结构 / 线程管理 / 隔离与释放），杰哥回「同时跑的数量不要限制，可以使用
  最多并发数 + 排队的方式」后开工。
- **状态**：DONE · 主写线
- **诊断（先查证再动手，结论与杰哥的描述一致但位置不同）**
  1. **执行体本来就没有全局锁**：`runTaskPostprocess` 是每次调用独立的 async 长任务；
     `manualPostprocessInFlight` 是**按图片 id** 的在飞集合，不是全局闸。
  2. **「整体占用」的真身在 UI**：`ManualPostprocessButton` 拿**全局计数器**
     `runtimeStore.postprocessRunning` 当 `loading`，而 ds 的 `Button` 是
     `disabled={disabled || loading}` ⇒ **任一方向在跑，全库「跑后处理」按钮点不动**（零报错）。
  3. 状态入口只取 `postprocessRunIds` **第一条** running ⇒ 多方向并行时界面只显示一个。
  4. **「生图按方向独立运行」在代码里不存在**（`TaskRecord` 无方向字段，生图是 per-task 执行体 +
     task 内并发信号量）⇒ 照抄它的结构 = 一个方向一条 run + 方向级并发闸。
- **改动**
  - 新增 `lib/postprocessDirectionQueue.ts`（纯判断：名额 / 同一方向互斥 / 上限钳制）+
    `features/postprocess/postprocessDirectionGate.ts`（广播唤醒 + 2s 兜底重试）+
    `features/postprocess/directionTargets.ts`（**产出目标方向解析的唯一实现**，界面与编排共用）。
  - `PostprocessRun` 加 `batchId` / `directionId` / `directionLabel` 与 `queued` 状态；
    runtimeStore 的全局计数换成 `postprocessRunningDirections`（方向级名额表）+ 方向级派生查询；
    `POSTPROCESS_RUN_KEEP` 20 → 60（一次触发就产生 N 条）。
  - `taskPostprocess` 加 `onlyTargetCollectionIds`（只产一个方向）与 `deferDistribution`
    （分发推迟到批次收尾），抽出 `distributePostprocessOutputs` / `mergePendingPostprocessDistribution`；
    `resolveUniquePath` 改为**先占位再查盘**（`reservedOutputPaths`）。
  - `store.ts` 的 `executePostprocessImageIds` 改成**批次编排**：按目标方向分组建 run →
    抢名额（**先同步试一次**，保证「点下去就有记录」仍是同步成立）→ 各方向独立跑 →
    全部结束后**统一分发一次**；删除 `manualPostprocessInFlight`。
  - 界面：按钮 loading 改看**选中素材所在方向**；状态入口显示「N 个方向在跑 · M 排队」；
    进度面板列出全部在飞方向；任务卡补「N 个方向」并改为汇总最近一批全方向的问题。
- **验收证据（2026-09-23）**
  - `npm run verify`（用 Node 24 跑）：**267 文件 / 3204 用例全绿** + tsc 双端 + eslint + format:check。
  - 新增用例 31 例：方向闸 6、目标方向口径 8、待分发合并 2、方向拆分/排队/跳过 3、
    runtimeStore 方向闸 3、工具栏按方向判 loading 1、任务卡多方向 1、执行体只产单方向 1 等。
  - **新增：一次触发拆成多条 run**（`store.test.ts`）—— 同步段就建好 2 条、各带自己的方向、
    同一个 `batchId`、各只处理 1 张图；**最多并发数配 1 时**第二条为 `queued` 且最终照样跑完；
    **某方向在跑时只跳过那一个**，别的方向照跑，跳过原因落在批次级记录里可查。
- **刻意保留（勿改回，详见 `architecture-constraints.md` §4.7）**
  1. **分发收敛成一次**：各方向各分发一次会让「同一素材跨渠道落在同一天」失效（TB-107 口径）。
  2. **幂等键带方向**（`taskId:direction:imageId`），且**先判在跑再认领** ——
     顺序反了会白白吃掉幂等键，那批图之后再也产不出来（不可见）。
  3. **同一方向同时一条**：两条会争同一批输出目录与文件名序号。
- **未做 / 说明**
  1. **无取消**：本轮只做并发与状态，方向级取消（`AbortSignal`）留接口未做 ——
     产出链现在没有取消机制，加它要穿过渲染链与写盘。
  2. **内存登记表不清理**（`reservedOutputPaths`）：一场几千张图的会话几百 KB，
     与「清了旧条目又开始覆盖」相比宁可留着。
  3. 本机无法做渲染验证（`.env` 已知限制）→ 界面改动只做了 `prettier --check` + 规则推导 +
     组件级用例，**未经真机观感确认**，请杰哥在运行中的应用里过一眼工具栏与进度面板。

---

### TB-113 后处理渲染：画布只画一次 + 体积判定去 base64

- **来源**：杰哥 2026-09-23「着重优化③ 每轮压缩二分都从头重绘这一点」
  （诊断见 `docs/postprocess-watermark-gap-analysis.md` 卡点 5 / 4）
- **状态**：DONE · 写线：主写线（与 TB-018 同一批改动）
- **根因（两件，同一处代码）**
  1. **每轮二分都从头重绘**：`renderWithMaxKb` 每轮都调 `renderCompositeV2ToJpegDataUrl`，
     而那个函数**每次都从 `renderCompositeV2ToCanvas` 开始** —— 背景按 `fitMode` 适配、
     overlay 缩放到目标尺寸、`clearRect` 全部重放一遍，只为了换一个 JPEG quality。
     最多 10 轮 = 10 次完全无谓的重绘。
  2. **体积判定要过一遍 base64**：原实现把每轮 Blob 转 dataUrl、再 `split(',')` 还原长度来估算体积
     —— 1080×1920 的 JPEG 约 400KB → base64 约 533KB，**每张图来回搬 10 次**。
- **做法**
  - 渲染**一次**拿到 canvas，之后只对它反复 `canvasToBlob(canvas, 'image/jpeg', quality)`。
  - 体积判定改用 `blob.size`（零成本，且比估算更准），`Math.ceil(bytes / 1024)` 口径与原来一致。
  - 删掉只服务于旧路径的 `dataUrlSizeKb`。返回值仍是 dataUrl ⇒ 调用方（`writeVariant`）零改动。
- **验收证据（2026-09-23）**
  1. 新增 `renderVariant.test.ts`（5 例，jsdom）：高质量达标 1 次渲染 / 1 次编码；需要二分时
     **渲染 1 次 / 编码 10 次**；最低质量仍超标 1 / 2 + warning；二分选出的是**达标里质量最高**
     的那一档；取消时渲染前抛错、一张画布都不建。
  2. **反向验证**：把「每轮重绘」加回 `encode` → 渲染次数 **1 → 11**（另两条 1→2、1→3）精确变红；
     「选质量」「取消」两条不受影响 —— 证明探针只打在「渲染次数」这条契约上。
  3. `npm run verify` 等效全绿（tsc 双端 / eslint / prettier / **268 文件 3207 测试**）。
- **刻意保留（勿改回，见 `architecture-constraints.md` 一章）**
  - **画布只画一次、只反复编码**：二分改的只是编码质量，重绘画面是纯浪费。
  - **体积判定用 `blob.size`**，不要回到「转 base64 再估长」。
- **未做 / 说明**
  1. **中间产物仍是 dataUrl**：返回值在最后仍转一次 base64（本次刻意没动，控制改动面）。
     写盘侧 `saveCompositeImage` 内部已解回字节走 `saveCompositeImageBytes`，所以主进程侧没问题；
     要彻底去掉得让渲染函数返回 Blob 并改 `writeVariant` —— 留作独立改动（诊断报告卡点 4 的另一半）。
  2. ⚠️ **别把本次优化理解成「水印渲染慢」**：overlay 的重复渲染**早已被内存缓存消掉**
     （键 `preset.id:updatedAt:WxH`，同尺寸跨渠道命中；同比例还有 `base:` 键共享）。本次治的是
     **编码循环里混进来的重绘**。诊断报告卡点 5 里写明了这两件事的区别。
  3. 本机无法做渲染验证 ⇒ **未经真机耗时对比**，请杰哥在真机跑一批看是否体感变快。

---

### TB-114 后处理太慢：编码轮数 10 → 3 + 目录 IPC 缓存 + 耗时埋点

- **来源**：杰哥 2026-09-23「我是觉得当前后处理太慢了」
- **状态**：DONE · 写线：主写线
- **诊断（有数据，不是猜）**：从本机 `asset-kernel.sqlite` 里 529 条产出记录的时间戳反推单变体耗时 ——
  同一套配置下 **168ms ~ 1312ms（8 倍）**，而**渠道构成 / 目标尺寸 / 源图数量完全一致**。
  联立两批数据解出：**单轮 JPEG 编码 ≈ 127ms、其他开销 ≈ 41ms、慢的那批每变体走满 10 轮**
  （10 = 1 次 0.9 + 1 次探底 + 8 轮二分）。
  ⇒ **瓶颈是编码轮数，与配置无关，取决于图的内容复杂度**（0.9 时是否超过体积上限）。
- **改动**
  1. **体积搜索：8 轮二分 → 两点对数插值定位**（`renderVariant.ts`）。JPEG 体积随质量近似指数增长，
     对数域上两个已测点就能算出目标质量；二分的前几轮必然浪费在离答案很远的地方。
     **典型 3 次编码**（0.9 一次达标 1 次 / 0.5 达标 3 次 / 插值猜高退一档 4 次）。
     ⚠️ **正确性约束**：返回的**一定是实测达标的那一帧** —— 插值只影响速度，不改变判定。
  2. **空覆盖层不再合成**（`compositeRendererV2.ts`）：纯净版与「未绑水印的渠道」用的是空图层预设，
     而它们按实测占**一半**产出量。跳过的不只是一次整图合成，还有一份同尺寸位图分配（1280×720 约 3.7MB）。
  3. **目录链按「根 + 子目录链」缓存**（`taskPostprocess.ts`）：原来每个变体都要走
     `pathJoin + authorize + ensureDir` 三次 IPC。⚠️ **失败不进缓存** —— 否则一次偶发失败会被缓存成
     「整批这个目录都不可用」，那是最难查的一类错（目录后来建好了却整批跳过）。
  4. **耗时埋点**（`PostprocessRunDiagnostics` = `paintMs / encodeMs / encodeCount / writeMs`）：
     收尾时写进运行记录，进度面板每条历史记录多一行
     「耗时 12.4s · 画 400ms · 编码 9.80s（38 轮）· 写盘 1.10s」。
     加它的直接原因：这条链**此前没有任何分阶段数据**，而我从产出记录反推时**猜错过两次**。
- **验收证据（2026-09-23）**
  1. `renderVariant.test.ts`（7 例）：0.9 一次达标 = 1 次编码；需要压缩 = **3 次编码**（旧上限 10）；
     插值猜高退一档且返回的一定达标；最低质量仍超标 = 3 次 + warning；stats 与实际调用次数一致；
     `renderOnce` 单次编码不进搜索。
  2. `compositeRendererV2.test.ts`：「⭐ 预设没有可见图层时：只清屏，不合成覆盖层」+ 一条**对照用例**
     （有图层时同一探针能看到 `drawImage`）。
  3. `taskPostprocess.test.ts`：「⭐ 两张源图落同一个目录时，目录链只建一次」——判据写成
     「**每个目录路径只建一次**」而不是总数，避免把 `getExplicitImageSaveDirectory` 那一次也算进来
     （第一次写成了总数=1，被测试当场纠出）；外加耗时累计用例。
  4. `PostprocessRunsDialog.test.tsx`：带诊断时三段时间都显示、无诊断时整行不出现。
  5. **反向验证三遍，全部精确命中**：
     - 体积搜索改回旧策略 → 编码次数 **3 → 10** 变红（另两条 4→10、3→2 同样变红）；
     - 绕过目录缓存 → `Set 去重 2 个路径 / 实际调 3 次` 变红；
     - 让空覆盖层照样合成 → `ops` 由 `['clearRect']` 变成 `['clearRect','drawImage']` 变红。
  6. `npm run verify` 等效全绿（tsc 双端 / eslint / prettier / **268 文件 3215 测试**）。
- **预期收益**：慢批次单变体 1312ms → **约 400ms**（编码 10 轮 → 3 轮，每轮 ≈127ms）；
  60 秒的批次预计落到 20 秒上下。
  ⚠️ **未经真机计时确认**（本机无法做渲染验证）—— 请杰哥跑一批看进度面板那行新加的耗时。
- **未做**
  1. 中间产物仍是 dataUrl（诊断报告卡点 4 的另一半）：实测原生 base64 往返 **0.59ms/张**，
     不值得为它改三个出口 + 两条写盘通道。
  2. **方向内的编码流水线**（让多个变体的编码重叠，而不是逐个 `await`）—— 理论收益可能更大，
     但它要重构 `taskPostprocess` 的主循环（渲染是主线程同步的、编码才是异步的，两者不能一视同仁）。
     **等这次的真机数据出来再判断要不要做**。

---

### TB-115 方向级后处理历史记录 + 打开输出位置 + 取消导出

- **来源**：杰哥 2026-09-23「为每个方向的后处理操作添加一个长期保留的历史记录列表，用于记录各方向的历史处理结果，并在界面中提供一个可点击的按钮，用于直接打开对应的输出文件所在位置……产出目标也是根据每个方向的，而不是全局的，还有添加取消导出的功能」
- **状态**：DONE · 写线：主写线（`bc24fba`；verify 270 文件 / 3253 用例全绿）
- **口径裁决（杰哥 2026-09-23 选 A）**：历史记录**每条自带**「这次产到哪几个方向、实际写到哪些目录」的
  **快照**；**产出目标的配置语义不动**（仍是全局一份 `savedTargetCollectionIds`）。
  理由：产出目标的语义天生是「**这一批**要投到哪几个方向」（跨方向），逐方向各存一份会让
  「到底哪个值生效」需要递归推理 —— `lib/postprocessMedia.ts` 里已有明确约束，不推翻。
- **验收标准（可测）**
  1. 每个方向各自一份历史，**重启后仍在**（落 `app_data_records` 的 `postprocessHistory` namespace）。
  2. 每个方向最多留 50 条（`POSTPROCESS_HISTORY_PER_DIRECTION`），超出丢最老的；可按方向清空。
  3. 每条记录带：方向名快照 / 触发来源 / 结果状态 / 产出文件数 / 产出目标方向 / 实际输出目录 /
     问题（封顶 10 条 + 总数）/ 耗时构成。
  4. 记录上有「打开输出位置」按钮：单目录打开目录、双写给两个入口；目标不存在时打开**最近的已存在父目录**；
     失败给出可见原因（不静默无反应）。
  5. **重启后**（共享盘输出目录已不在会话白名单里）该按钮**仍可用**。
  6. 在飞的方向可取消：**已写出的文件保留**、状态记「已取消」、不再报成「渲染失败」；
     排队中的方向也能**立刻**取消（不等名额）。
- **验收证据（2026-09-23）**
  1. `postprocessHistory.test.ts`（16 例）：批次级记录（无方向）不进方向历史；方向名 / 产出目标 /
     输出目录都是**快照**；目录去重（大小写不敏感）+ 上限；问题截断但 `issueCount` 仍是**真总数**；
     紧凑形式不含文案、读回时从码表补；每方向 50 条上限丢最老；坏条目**逐条丢**而不是整份回退；
     按 `startedAt` 重排成「最新在前」。
  2. `postprocessCancel.test.ts`（10 例）：按方向登记 / 取消 / 幂等；取消一个不牵连别的方向；
     释放后不再可取消；**同一方向二次登记时按 signal 核对身份**（防删错句柄）；
     `AbortError` 也认、普通错误不认；已 abort 抛专属错误。
  3. `taskPostprocess.test.ts`（19 例，新增 5）：开工前已取消 → **一个文件都不写**；
     第二张图之前取消 → **第一张的产出留在磁盘上**（不回收）；渲染链抛取消错误 → **穿透到上层**；
     **对照**：渲染链抛普通错误 → 记 `PP-RENDER-001` 并正常返回；无 signal 时行为不变 +
     新字段 `outputDirs` 被记下。
  4. `postprocessRun.test.ts`（13 例，新增 2）：取消**优先于**「部分完成 / 失败」；结论文案说的是
     「停在哪了」而不是「失败了」。
  5. `renderVariant.test.ts`（8 例，改 1 增 1）：取消改为**按类型**断言（不再靠消息字符串）；
     新增「编码途中取消 → 下一枪之前断掉，不返回半成品」。
  6. `PostprocessRunsDialog.test.tsx`（10 例，新增 4）：历史记录按方向分组并显示
     「源图数 → 产出数」与「打开位置」；空历史给说明而不是空白；在跑的方向给「取消」
     且**传出该方向 id**；没有方向的批次级记录**不给**取消按钮。
  7. **反向验证两处，全部精确命中**：
     - 拿掉 `writeVariant` 的取消穿透 → 「渲染链抛取消错误 → 穿透」变红
       （`promise resolved … instead of rejecting`，即取消被吞成普通结果）；
     - 拿掉 `resolvePostprocessRunStatus` 的取消优先 → 「取消优先」变红
       （`expected 'skipped' to be 'canceled'`）、「结论文案」变红
       （`expected '后处理完成：产出 7 个文件，跳过 1 项' to be '已取消：停止前已产出 7 个文件'`）。
  8. `npm run verify` 全绿（tsc 双端 / eslint / prettier / **270 文件 3253 测试**）。
- **未做 / 说明**
  1. **本机无法做渲染验证**（`.env` 已知限制）⇒ 界面改动只做了组件级用例 + 规则推导，
     **未经真机观感确认**。请杰哥在运行中的应用里过一眼三处：进度弹窗下半段的历史分组、
     「打开位置」展开后的目录清单、在飞记录旁的「取消」。
  2. **批次级记录不进方向历史**（分发失败、准备阶段崩溃）：它们不属于任何方向，塞进某个方向的桶里
     会让「这个方向出了问题」变成假话。这类记录仍只在进度弹窗的「不属于某个方向的结果」段里，
     **且仍是会话内可见**（重启即失，这一档没做落盘）。
  3. **取消不删任何已写出的文件**：这是刻意的，不是遗漏 —— 产物是用户要的东西，替用户删是最
     不可逆的一种「帮忙」。
  4. 历史记录里**不存逐个文件路径**（只存目录 + 文件数）：一条记录几十上百个路径会把落库体积撑大
     两个数量级，而「打开哪个目录」已经回答了绝大多数诉求。要逐文件清单走任务卡上的产出弹窗。
  5. **产出目标的配置语义仍然不动**（杰哥选 A）：历史里的是**记录快照**，`savedTargetCollectionIds`
     仍是全局一份。想改成「每方向各一份配置」是另一件事，得先回答「A 方向的设置写产出到 X、Y，
     X 方向的设置写产出到 A、Z，到底哪个生效」。
