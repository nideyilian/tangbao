# 糖包 架构约束与勿改回清单

> **本文件回答"哪些设计是刻意的、不要改回去"。**
> 从 `.workbuddy/memory/MEMORY.md` 迁出（该文件只保留索引与铁律，不再承载细节）。
> 风险（会怎样出事）见 `docs/RISK.md`；操作配方见 `docs/tangbao-ops-runbook.md`；
> 决策理由见 `docs/adr/`。建立于 2026-09-18。

---

## 一、性能基线（勿回退）

这几项是实测优化后的结论，回退会直接反映为用户可感知的卡顿：

| 约束                                                   | 位置                                            | 为什么                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 高频进度走独立的 `runtimeStore`                        | `src/stores/runtimeStore.ts`                    | 避免高频 setState 触发主 store 全量重渲                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| SQLite 访问走 UtilityProcess                           | `electron/catalog-worker.ts`                    | 主进程不被同步数据库操作阻塞                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 任务网格虚拟化 + `useDeferredValue`                    | `src/components/TaskGrid.tsx`                   | 大列表滚动不掉帧                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 缩略图编码走 `canvasToWebpDataUrl`（异步）             | `src/lib/canvasImage.ts:164`                    | `toDataURL` 是同步的，1024px webp q0.82 实测 **71–110ms/张**主线程冻结                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 整图字节优先：`saveImageBytes`，**新代码勿传 dataUrl** | `electron/preload.ts:46`                        | 避免 base64 双向转换与主进程同步解码                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **体积压缩：画布画一次、编码不超过 3~4 次**            | `features/postprocess/renderVariant.ts`         | ① 搜索只改 JPEG 质量，重绘画面是纯浪费 —— 旧实现每轮都从头 `renderCompositeV2ToCanvas`（背景适配 + overlay 缩放 + `clearRect`）；② **二分 8 轮是过度精确**：收敛到 0.35% 的质量精度，而用户要的是「不超过 N KB」。改成**两点对数插值定位**后典型 3 次编码（实测：旧策略 10 次 = 1312ms/变体，新策略约 400ms）。体积判定用 `blob.size`，不要转 base64 再估长。⚠️ **插值只影响速度、不改变判定** —— 返回的必须永远是「实测达标」的那一帧。守卫 `renderVariant.test.ts`（反向验证：改回旧策略 → 编码次数 3 → 10 变红） |
| **目录链按「根 + 子目录链」缓存**                      | `features/postprocess/taskPostprocess.ts`       | 原来**每个变体**都要 `pathJoin + authorize + ensureDir` 三次 IPC，而同批变体落在同几个目录里 ⇒ 上千次白跑。⚠️ **失败不进缓存**：否则一次偶发失败会被缓存成「整批这个目录都不可用」，而那是最难查的一类错（目录后来建好了却整批跳过）                                                                                                                                                                                                                                                                                |
| **空覆盖层不合成**（空图层预设直接跳过）               | `features/composite/lib/compositeRendererV2.ts` | 纯净版与「未绑水印的渠道」用的是空图层预设，按实测占**一半**产出量；全透明的覆盖层合成上去等于把目标尺寸整张重画一遍，还要先分配一份同尺寸位图（1280×720 ≈ 3.7MB）。判据是「有没有可见图层」                                                                                                                                                                                                                                                                                                                        |

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
- **`fitMode`（画面适配：裁剪填满 / 模糊填充 / 拉伸铺满）是全局一套，刻意不给方向级覆盖**
  （TB-078）。它是「这批素材长什么样」的全局美学规格，与渠道尺寸同层；按方向分会多出一层
  "为什么这次是这个值"的推理。⚠️ 产出链里 `applyPostprocessOverride` 对它是**显式透传**——
  那个函数返回的是**白名单对象**，漏字段下游就是 `undefined`，渲染器会抛「未知的背景适应模式」
  把整批产出废掉（同 4.2.1 ② 那条链）。**默认值恒为 `crop-fill`**：改默认 = 改所有人的产出观感。

### 4.2.1 增删一个「节点级」后处理字段 → 五处清单（必逐项过，2026-09-21 实走一遍）

节点级字段的生效要穿过**三条互相独立的链路**，漏一条就是静默失效：

| #   | 位置                                                                   | 漏了会怎样                                                         |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ①   | `PostprocessNodeOverride` 类型（`lib/postprocessMedia.ts`）            | 后面几处都不认它                                                   |
| ②   | `applyPostprocessOverride` 的合并（同文件，用 `??` 不用 `\|\|`）       | 类型上有、实际不生效 —— **产出链读的是合并结果**                   |
| ③   | `normalizePostprocessNodeOverride`（`features/projectTree/params.ts`） | **存不住**：写进去、重启就没了                                     |
| ④   | Excel `node_params` 表（导出 + 导入**两侧**）                          | 往返丢配置；导出漏了更糟 —— 导入会把它当成「恢复继承」清掉         |
| ⑤   | 界面消费方按作用域解析（`resolveProjectPostprocessSlice`）             | 「界面显示一套、实际产出另一套」（别在界面里自己再拼一遍继承逻辑） |

**删字段比加字段多两步**（R-63 家族）：
① `persist.version` 必须 bump —— 不 bump 则 `migrate` 不跑，下一步的折算根本不发生；
② 旧值要**折成它当时表达的语义**再丢。实例（ADR-0013）：渠道 `enabled: false` 折成
「从 `selectedMediaIds` 里剔除」，而不是当没看见（否则被停用过的渠道会悄悄重新产出）；
也**不能**留着字段只在界面藏起来 —— 那会变成「勾了却不产出」的隐形杀手开关。

### 4.3 产出目标：自动按归属、手动按「记住配置」（2026-09-24 改为**按文件夹各一份**）

- **自动触发的产出目标 = 图片归属方向本身**（命名段取自归属方向）；
  **手动触发的产出目标 = 「记住配置」那份清单**，键是素材库**当时所在的文件夹**
  （`savedTargetsByFolder`），可以跨产品 / 跨方向 —— 两者在 `taskPostprocess` 里按 `source` 分流，别合并。
- **取用规则只有一条**：沿「归属方向 → 它自己的祖先」向上找第一个设过的文件夹，最近的一环说了算；
  链上一份都没设 → 归属方向自身（老行为）。实现在 `features/postprocess/directionTargets.ts`，
  **界面与执行体都调它这一份** —— 2026-09-24 前执行体在 `taskPostprocess.ts` 里手写过一遍同样的口径，
  两处只要分叉就表现为「分组说投 A、执行体按 B 产」，而这只在产物上看得出来。
- ⚠️ **兜底那一份（`savedTargetCollectionIds`）只对「没有归属」的图生效**：素材库停在
  「全部素材 / 收藏 / 未整理 / 标签」时设置写的就是它。**别让它对有归属的图生效** ——
  那正是 2026-09-24 修掉的 bug：全库只有一份，给一个方向设完，跑别的方向也按它产。
- **无归属（手工拖入 / 旧数据）→ 先兜底那一份，再退回 `selectedCollectionIds`**。
  这个字段**只剩这一个用途**：它原来还是「哪些方向参与自动后处理」的白名单，
  那层 2026-09-23 已撤（见 4.4.1，含「为什么」与「别再做成闸门」）。
- `resolveImageOwnership` 有**有界等待窗口**（2s / 250ms 步长）：
  因为「任务完成 → 触发后处理」与「素材异步归档」是两条并发线；新素材默认无归属。
- 只有**批次任务**会自动归档到项目文件夹，普通生成要用户手动拖。

### 4.4 产出与命名

- `taskPostprocess` **按渠道拆桶**（一个渠道一桶，桶内的 `selectedMediaIds` 只有一个元素）。
- **产出维度里没有「纯净版」**（2026-09-23 整条拆掉，见 ADR-0020）：它产出的就是素材库里那张
  原图有损重编的一份，而程序本身即素材库。旧配置 / 旧备份里残留的 `clean` 由归一化
  （两处 store）与产出计划的入口过滤一起清掉 —— **别再把它做成可产出项**，
  也别在界面上给它留开关（当年那栏因为媒体表里没有对应行，从来就没渲染出来过）。
- **预设 id 不存在 → 跳过整桶**（刻意**不**静默降级：静默降级会让用户以为产出成功）。
- 多预设时产物自动加预设名子目录；单预设时目录结构与原来一致（不破坏既有产出习惯）。

### 4.4.1 触发来源（自动 / 手动）必须传进执行体（2026-09-21 定；2026-09-23 收窄）

- `runTaskPostprocess` 的入参带 `source: 'auto' | 'manual'`，**不许省**。
- **自动 / 手动由总开关分界**：`AppSettings.autoPostprocess`（**默认关**）。闸门在
  `scheduleTaskPostprocess` 第一行；关着 = 后台一次都不跑，手动「跑后处理」完全不受它约束。
  ⚠️ **别把这道闸门挪回「项目树勾了哪些方向」**：2026-09-23 之前就是那样，条件藏在另一处配置里，
  用户以为没启用、实际每批都在跑，然后逐批留一条「已跳过」记录（杰哥报障的成因）。
- 方向级「自动后处理」开关（`PostprocessNodeOverride.enabled`，提示码 `PP-SCOPE-002`，默认继承即**开**）
  **只拦自动触发**：「这个方向参不参与自动产出」管不着用户手动点的那一次。
  拿它否决手动跑会变成死循环 —— 提示让用户「选中素材单独跑一次」，而手动走同一条判定，
  照做还是被跳过（2026-09-21 报障）。
- **「启用范围」（`selectedCollectionIds` + `PP-SCOPE-001`）已撤掉**（2026-09-23）。
  它原先是「哪些方向参与自动后处理」的白名单，与方向级开关说同一件事、判定却各写一套，
  用户在两处之间迷路；而批量出图的人本来就要所有方向都参与。
  现在 `selectedCollectionIds` **只剩一个用途**：无归属的图（手工拖入 / 旧数据）产出到哪。
  `PP-SCOPE-001` 码表条目**保留但不再产生** —— 落盘历史里还有旧记录带着它，删码会让那些记录
  渲染成「未知问题」。**别再把它做成一层闸门。**
- **「记住的产出目标」只有手动读**：自动产出的去向仍是图片归属方向，
  不被那份清单悄悄改掉。杰哥原话：「我这个只针对于手动后处理，不需要改自动后处理的」。
- 判定的落点就一处：`features/postprocess/directionTargets.ts`（2026-09-24 起执行体也调它，
  `taskPostprocess.ts` 里手写的那份已删；该编组同时负责「取哪个文件夹那份清单」，**取用要传 `collections`**，
  漏传会让「在产品层设的那份」对其下方向失效 = 设置了没生效）。仍在执行体里的只剩
  `PP-SCOPE-002` 那处 `input.source !== 'manual'`。**加新判定时照这个格局走，别再手写第二份。**
- **界面文案要与这条对齐**：`PP-SCOPE-002` 的线索必须说清「手动跑不受这个开关限制」。

### 4.4.2 后处理提示的分级（勿改回「有 issue 就弹红条」）

- **纯配置使然的跳过连记录都不留**（2026-09-23）：判定收在 `isAutoDisabledOnlySkip`
  （`postprocessRun.ts`），落点是 `store.ts` 的 `runDirection` 收尾 —— 零产出且原因只有
  「方向关了自动后处理」时，**从 `runtimeStore` 撤掉那条 run 且不落方向历史**。
  理由：那是用户自己关的开关，每批再记一条只是拿他自己配的事实刷屏。
  ⚠️ **不能按 `severity === 'skipped'` 一刀切**：`PP-CANCEL-001`（取消，严重度刻意是 `skipped`）
  与 `PP-SRC-001`（源图读不到）都必须留 —— 前者要交代「停在哪了」，后者指向真的缺数据。
- `severity` 是 `skipped`（配置使然：自动开关关着、渠道没勾）或 `error`（真失败）。
- **自动触发只在出现 `error` 级问题时播报**；纯 `skipped` 一声不吭 ——
  自动后处理是**每个生成任务完成就跑一次**的后台行为，配置事实逐批重播等于刷屏，
  用户点掉也无可作为。这类结果的落点是**素材库工具栏的状态入口 + 进度面板**（可查询、可关闭）。
- **手动触发每次必有下文**，零产出也要给结论；此时 `skipped` 用 `info` 不用 `error`。
- 状态入口与提示都必须**能关**（提示的 ×、状态入口的 ×）、内容多了不能把按钮顶出屏幕
  （见七章弹窗高度那条）。
- **工具栏上的进度只给「计数 + 百分比」，不带写盘文件名**（2026-09-21 报障）：`currentLabel`
  是形如 `20260921-快手-网赚-纯净版-陈泽杰-1280x720-1.jpg` 的写盘文件名，几十个字符铺进工具栏
  会把整条工具栏占满、把别的按钮挤走。紧凑口径的**唯一实现**是 `formatPostprocessRunBadge`
  （别在组件里自己拼字符串）；文件名一类的详情归悬浮提示（`formatPostprocessRunProgress`）
  与点开的面板。数字加 `tabular-nums`：`0/100` 涨到 `100/100` 时宽度不变，工具栏不抖。

### 4.4.3 方向级历史记录与取消（TB-115，2026-09-23）

- **两套记录分工，别合并**：`PostprocessRun`（`stores/runtimeStore`）= **正在跑**（内存态、实时上报、
  重启即失、只留会话内 60 条）；`PostprocessHistoryEntry`（`storePostprocessHistory`）= **跑完了**
  （落盘、按**方向**分桶、长期保留、每方向 50 条）。收尾时在 `finishPostprocessRun` **之后**读一次
  run 生成历史条目（`createHistoryEntryFromRun`）—— 从参数另拼一份必然与记录分叉
  （状态判定一改、那边没跟上，历史里就会出现「显示成功、实际失败」）。
- **没有方向的批次级记录不进方向历史**（分发失败、准备阶段崩溃）：桶键就是方向 id，
  塞进某个方向的桶会让「这个方向出了问题」变成假话。这类记录只在进度弹窗里显示，且**不落盘**。
- **进度面板按范围分页，在飞的进度跟着页走**（2026-09-24 杰哥定）：面板从素材库工具栏打开，
  「当前方向」页 = 素材库**当时所在文件夹**的范围（与产出目标弹窗的 `scopeFolderId` 判据同源，
  逐字相同），只列这个方向在飞的 + 它的历史；「全部方向」页才是全量（含批次级记录）。
  ⚠️ **别把在飞的记录改成常驻在两页之上**（那会更好看、更"不丢信息"，但杰哥明确要的是
  「要不从对应方向打开才能看到、要不就切换到全体的 tab」——代价是当前方向页看不见别的方向在跑，
  这是他知情选择的）。停在哪个页**每次打开按当时的 scope 重算**，不记上次。
  不在具体文件夹里打开时不渲染标签条（只有一项的标签没有意义）。
- **历史里的是快照，不是引用**：方向名 / 产出目标方向 / 实际输出目录都是**当时**的值 ——
  记录的价值就是事后还原当时发生了什么；读当前配置只能得到今天的答案（输出目录与水印都在节点层
  可覆盖，ADR-0003 实测 25/61 个方向目录不同，改一次全变）。
- **记录归记录、配置归配置**（见 4.3）：历史里的 `targetDirectionIds` 是**当时那份清单的快照**，
  不是"配置存在哪"。配置存在 `savedTargetsByFolder`（按文件夹各一份，2026-09-24 改）与兜底的
  `savedTargetCollectionIds` 上 —— 改配置不该改历史，读历史也不该拿去反推今天该产到哪。
- **问题只存上下文、不存文案**：`PostprocessHistoryIssue` 刻意缺 `message` / `hint` / `severity`，
  读回时由 `createPostprocessIssue` 从码表补。文案的真相源始终只有 `ISSUE_TEMPLATES` 一处。
- **取消是专属错误类型**（`PostprocessCanceledError`），**不是**布尔返回值、也**不用消息字符串判定**
  （曾经的 `new Error('渲染被取消')` 就是靠消息判的）。理由：`paintAndEncode` 只能在 `toBlob`
  之间靠抛出来中断，而「取消」与「渲染失败」的处理完全不同 —— 取消不报错、产物保留；
  失败要记 `PP-RENDER-001` 让人去查。
- **取消优先于一切状态判定**：`resolvePostprocessRunStatus` **先**判取消码 → `canceled`。
  不然中途取消会掉进「有产出 + 有真错 ⇒ 部分完成」「零产出 ⇒ 失败」两档里 —— 用户明明是自己
  按的停止，界面却报一条红色失败。
- **取消句柄按方向登记，且必须与 run 同生命周期**：漏释放不会崩溃，而是让**下一次**触发的
  「取消」打到一条已经跑完的记录上（点了毫无反应，而新的那次照样跑到底）。
- **取消不回收任何已写出的文件**：产物是用户要的东西，停在哪里就留到哪里；替用户删是最不可逆的
  一种「帮忙」。
- ⚠️ **启动时必须重新放行历史里出现过的输出目录**（`store.ts` 的 `authorizeHistoryOutputDirs`，
  在 `initStore` 第一句）。主进程的 `sessionAllowedRoots` 是内存 Set、**重启即清空**，而
  `localSavePath` / `configSyncPath` 之外的后处理输出目录（多半是内网共享盘）不再有人放行 ——
  少了这一步，历史记录上的「打开输出位置」会在重启后报「路径不在允许范围」（R-95）。

### 4.4.4 分发 = 同级改名整装（TB-117，2026-09-23 定）

- **排期文件夹与产出文件夹同级**，不再在产出文件夹里面套一层纯日期子文件夹。
  文件夹名 = 产出文件夹名（命名模板），**只把日期段换成排期日**：
  `20260922-高颜值-头条-广点通-1140x640` → `20260924-高颜值-头条-广点通-1140x640`。
  模板里没有 `{date}` 时把排期日前置（否则每天撞名，分配结果直接错乱）。
- ⚠️ **排期日与文件当前位置重合时不许搬**（起算日 = 产出当天 ⇒ 第 1 天必然重合）。
  这条判定必须在**碰撞检测之前**：顺序反了就走到「目标已存在（那是它自己）」→ 改判 `-2`
  → 凭空多出一份副本（杰哥 2026-09-23 报的「重复两份素材」就是这个）。
- ⚠️ **搬运恒定 move，别把「复制 / 移动」开关加回来**：这套结构下 copy 不成立 ——
  第 1 天是原地（无副本可言），第 2 天若复制，第 1 天的文件夹里会留着所有天的文件，排期整个错乱。
- ⚠️ **判「文件夹名里有没有日期段」要用独立的非全局正则**，不能用「`replace` 结果是否与原名相同」：
  排期日 == 产出日时替换结果一字不差，会被误判成「没有日期段」而凭空加前缀，第 1 天就不再是原地。
- 分发根：`targetDir` 空 = 产出文件夹的父目录（同级改名）；填了 = 该目录 + 输出根之下的**中间层级**。
  **产出文件夹名不进路径**，它进的是排期文件夹名 —— 旧实现把它拼回路径，于是
  `targetDir` 填成输出根时被算回产出文件夹自身（「填了等于没填」）。

### 4.4.5 导出位置开关（TB-130，2026-09-24 定）

- **位置列表与开关表分家**：位置仍是 `mediaOutputDirs: Record<mediaId, string[]>`（全局）
  与 `byMedia[m].outputDirs`（节点），开关另存一份「路径 → 开/关」（`mediaOutputDirEnabled` /
  `outputDirEnabled`）。
  ⚠️ **别把 `enabled` 塞进位置元素**（做成 `{path, enabled}[]`）：位置列表的继承口径是**整份覆盖**，
  而开关要能逐处表态，合在一起就要求**逐槽位继承** —— 那会把存量行为改成「本级填一处 =
  本级那处 + 继承的所有处」，一次升级就多写文件（ADR-0022）。
- **开关逐层逐键浅合并，不是整份替换**。整份替换时「全局停了共享盘、某个方向再停本地」
  会把全局那条抹掉 —— 共享盘自己又开始写了。三态缺一不可：缺键 = 沿用浅一层；`false` = 停用；
  **`true` = 盖掉浅一层的 `false`**（少了这档，本级点开被上级停用的开关会「没反应」）。
- ⚠️ **「配了位置但全被停用」与「一处都没配」必须分开判**（`outputRoots.ts`）：两者解析出来
  **都是空数组、意思正相反** —— 前者一处都不写并报 `PP-DIR-005`（`skipped`，不是故障），
  后者用默认输出位置。合在一起会让「把交付目录全关掉」变成**悄悄写到本地默认位置**。
  同理，报 `PP-DIR-003` 的分母要用**过滤后**的数量（被关掉的不算「配了却不可用」）。
- **那一列的文案是「写入」，不许叫「启用」**：同一张表里已经有一个渠道级开关「参与产出」，
  撞名会让人以为是同一件事的两种说法（ADR-0013 删掉渠道级 `enabled` 正是因为它们等价）。
  一句话区分：关「参与产出」= 这个渠道**不产出变体**；关「写入」= 变体照产出、只是**不落这一处**。
  ⚠️ **别再为了「一个开关管一个渠道」加渠道级启停** —— 那是「参与产出」的重复。
- **铺行规则只有一份**（`planPostprocessOutputDirSlots`）：本级留空时按**能继承到的位置数**铺行，
  两个入口（中控台大表 / 后处理弹窗按渠道表）共用。只铺一行的话，「停了继承来的第一处、
  第二处还在写」这种状态显示不出来 —— 开关会撒谎。
- **全局作用域留空那行不给开关（刻意的不对称）**：全局层停掉兜底位置等于「这个渠道不产出」，
  那件事归「参与产出」管，不造第二个入口。节点作用域给 —— 那行的落点是**上级配置**，
  停它是方向级决策（「这个方向先别写出去」），没有等价的替代入口。
- **Excel 往返不带开关**（`output_dirs_global` / `output_dirs_node` 两张表），导入时**保留**
  既有记录；**配置包带**（`treeConfigBundle` —— 它是整份配置搬家，漏了就少一处状态）。
  导入侧写位置要用 `setMediaOutputDirs`（整份重写、按还在的位置过滤记录），
  ⚠️ **别改回 `clearMediaOutputDirs` + 逐个 `setMediaOutputDir` 那个组合** ——
  它会把开关记录一起清掉，等于把用户关掉的交付目录重新打开，而且一声不响。
- **改路径要搬记录、删位置要丢记录**（`renameOutputDirEnabledKey` / `dropOutputDirEnabledKey`）：
  不搬 = 改完路径那处「忘记自己关过」；不丢 = 以后填回同一路径会莫名是关着的。

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
- **标识符只在「预设自己有文字层」时才叠加**（2026-09-23，按 TB-018 口径收回）。
  **没有文字的水印 = 就是没有文字，不补署名。** 曾经那条「一个能出字的文字层都没有 → 在左下角
  造一个署名层」的兜底规则已删：它把「**就是没有水印**」（未绑预设 / 纯净版）和
  「**有图标但没文字层**」（TB-018 的纯图标水印）判成了同一件事，于是没绑水印的产出也会被补署名。
  它长期没暴露是因为后处理用的空预设基准画布是 **1×1**（`PLAIN_PRESET`）：字号算出来 8px，
  再按 `min(target/base)` 放大 **720 倍** ⇒ 图层框落到画布**上方之外**，文字不可见 ——
  **几何巧合，不是设计**；基准画布一换成真实尺寸，每张干净的图都会被糊上一行巨大文字。
  ⇒ **别把兜底层加回来**。守卫在 `compositeRendererV2.test.ts`
  （「预设里没有文字层 → 覆盖层一笔都不画」+ 一条对照用例证明探针能看见字）；
  `compositeIdentifier.test.ts` 另钉住接口面（那两个函数不再导出）。

### 4.6 工作区

- 工作区 = 顶栏 `appMode === 'postprocess'`。
- ⚠️ `store.setAppMode` 的**兜底分支会把非白名单值改写成 `agent`** → 新增工作区必须补分支，
  否则表现为"点 tab 完全没反应且零报错"（`RISK.md` R-12）。

### 4.7 运行实例按**产出方向**拆（2026-09-23，TB-112）

**一次触发 = 一个批次；批次内每个产出方向各一条独立 run**，方向之间互不阻塞。
改这块之前先读这一节 —— 下面每一条都是"看起来可以合并、合并了就出静默错"的地方。

- **拆分的键是「产出目标方向」，不是图片归属方向**（唯一实现在
  `features/postprocess/directionTargets.ts`）：手动跑的「记住配置」可以一批跨方向，
  按归属拆会拆不干净。**界面与编排必须共用这一份实现** ——
  各写一遍的结果是「按钮让点、点下去被跳过」，而界面上看不出为什么。
  2026-09-24 起它同时负责「按哪个文件夹的那份清单取目标」（见 4.3），调用要点见 4.4.1。
- **并发上限 = 设置里那个「最多并发数」**（`ApiProfile.maxConcurrent`，默认 5），
  超出的方向**排队**（`PostprocessRun.status === 'queued'`，不是被丢弃）。
  杰哥 2026-09-23：「同时跑的数量不要限制，可以使用最多并发数 + 排队的方式」。
  纯判断在 `lib/postprocessDirectionQueue.ts`（可单测），等待唤醒在
  `features/postprocess/postprocessDirectionGate.ts`（广播唤醒 + 2s 兜底重试）。
- **同一方向同时最多一条**：两条会争同一批输出目录与文件名序号。新来的那次按
  `PP-RUN-001` 跳过（不是排队）并说明去哪看进度。
- ⚠️ **分发必须收敛成一次**（`RunTaskPostprocessInput.deferDistribution` + 批次层
  `mergePendingPostprocessDistribution`）：分发的"打乱"是**全量洗一次牌、各目标目录共用
  同一份顺序**（`postprocessDistribution.ts` 的 `buildSourceRank`），同一张素材的头条版与
  广点通版因此落在同一天。**改成各方向各分发一次，这个性质就没了**，而产物看上去完全正常，
  只有跨渠道对日期时才发现。
- ⚠️ **认领幂等键必须带方向**（`store.ts` 的 `claimImage`，键 `taskId:direction:imageId`），
  且**先判方向是否在跑、再认领**：同一次触发的每个方向都要处理同一张图，
  不带方向会让第二个方向以为自己"已经产出过"而整条跳过；先认领后被跳过则会白白吃掉幂等键，
  那批图之后**再也产不出来**（且完全不可见）。
- ⚠️ **写盘路径要先占位再查盘**（`taskPostprocess.ts` 的 `reservedOutputPaths` +
  `reserveIfAvailable`）：`resolveUniquePath` 是"查存在 → 再写"，以前同批串行所以撞名一定被
  已写完的文件挡下；方向并行之后，两个方向共用同一输出目录（命名模板里不带方向段）会双双
  查到"不存在"然后互相覆盖。
- 幂等 / 进度契约不变：run 记录**在同步段就建好**（手动点下去立刻能查到 N 条），
  所以抢名额要**先同步试一次**再进等待（多一次 `await` 会让状态晚一个微任务才变）。
- 批次级问题（准备阶段失败、分发失败、被跳过的方向）**没有自己的方向 run**，
  单独留一条批次级记录（`recordBatchLevelPostprocessRun`）—— 否则它们只活在 toast 里（3 秒）。

## 五、持久化

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

## 十、配置以树为根（配置包与配置同步）

**一句话：中控台那几块配置的家是「项目树」，包里第一层也必须是树。**
（2026-09-22 杰哥裁决「所有数据都跟着树来走，树就是根」；完整推导见
[adr/0014](adr/0014-tree-rooted-config-bundle.md)）

> **字段级细节一律以 [`config-spec.md`](config-spec.md)（配置规范）为准** —— 本文只说
> 「哪些设计勿改回」。规范描述的 **v9 已落地**（TB-100）：配置是包内**独立一份 `config.json`**、
> `root`→`defaults`、`nodes`→`tree`、节点 `postprocess`→`overrides`、`watermarks`→`watermarkPresets`，
> 并**删掉了过渡期双写**（`compositeState` / `postprocessMediaState` / `assetCollections`）。

- **包结构**：根节点 = 渠道与尺寸字典 + 默认输出位置 / 命名模板 / 分发排期；
  产品节点 = 水印库（按 `CompositeV2Preset.productId` 归属，含 LOGO 图）；
  方向节点 = 渠道选择 / 输出位置 / 命名 / 是否参与产出。
- **恢复顺序不可交换**：立树 → 灌节点参数 → 放水印库 → 挂渠道与输出位置。
  反了会出现「引用了不存在的水印 / 渠道」，而这类错误要到产出那一刻才炸。
- **树跟着「包含配置」走**，不再挂在「包含素材库元数据」下；同时**不要**顺带把素材索引
  （`generatedAssets`）发出去 —— 别人导入后素材库里会多出一堆指不到的条目。
- **过渡期双写已删除（v9 / TB-100）**：v8 曾经同时写 `treeConfig`（新）与 `compositeState` /
  `postprocessMediaState` / `assetCollections`（旧），为的是让 ≤0.3.2 的老版本也能导入。
  配置同步上线前该系统已全线升级，于是按「不受向后兼容约束」**一次删干净**；同时补上了
  `watermarkLibrary`（水印库的**库级**字段：LOGO 列表与顺序、标识符、水印全局适配、背景文件夹）——
  它们原先搭的是 `compositeState` 那条并排的路，删掉它就等于静默丢这些字段。
  ⇒ **别再把它加回来**。老包导入时**整包拒收**（报「配置包版本不认识：v8（本机只认 v9）」），
  不做猜测性解析。包结构版本与配置格式版本是两个数，别混（见规范 §七 / R-87）。
- **两处静默丢配置的高发点**，改导出/导入时必须逐条过：
  ① 没归属到任何产品的水印要进 `unassignedWatermarks`；
  ② 已软删的文件夹（`trashedAt > 0`）不导出，但要在 `trashedSkipped` 里**报个数**
  （⚠️ 这是**文件夹**的软删位，与已撤除的素材回收站无关，见 ADR-0021）。
- **同步语义**：发布文件名带时间戳（`tangbao-config-YYYYMMDD-HHmmss.zip`，字典序 = 时间序）；
  拉取 = 单向覆盖，**拉之前先备份本机配置，备份失败就中止**（不做没有退路的覆盖）；
  备份存本机 `backups/`，包里**不含 API Key**。
- **配置目录必须持久化放行**：它多半是内网共享盘的 UNC 路径，落在
  `local-settings.json` 的 `configSyncPath` 并由 `getAllowedRoots` 放行（另见 R-31 / R-62）。
  **别指望 `sessionAllowedRoots`** —— 那是内存 Set，重启就清空。
- 新增任何中控台配置项时，先回答一句「**它挂在哪一层**」，不要平铺进包。

## 十一、图转视频（嵌入外部引擎）

引擎是**另一个程序**（`D:\AAA\image-to-video` 冻结成的独立 exe），糖包用 stdin/stdout 的 NDJSON
跟它说话；壳（Tauri）没有复用。决策见 `docs/adr/0023-embed-image-video-engine.md`，
操作配方见 runbook 二十八节，坑见 R-108 / R-109。以下几条**勿改回**：

- **引擎 exe 不进 git**：111,487,840 字节 = 106.3 MiB，**超过 GitHub 单文件 100 MiB 硬上限**。
  由 `scripts/fetch-image-engine.mjs` 在构建前取件（本机源 / `TANGBAO_ENGINE_SOURCE` /
  `TANGBAO_ENGINE_URL`），`electron-builder.cjs` 的 `beforePack` 在缺文件或体积过小时**让构建失败** ——
  别改成警告：缺引擎的包能装能开能生图，只有点生成视频才炸。
- **退出必须收整棵进程树**（`taskkill /T /F`）：引擎跑渲染时会 spawn **自己**
  （`exe --legacy-worker`），`child.kill()` 在 Windows 上杀不掉孙子，会留下啃 CPU 的孤儿。
  `before-quit` 优雅关闭 + `will-quit` 同步兜底，两层缺一不可。
- **参数按项目树分层**：全局基线在 `useImageVideoStore.globals`，节点覆盖在**既有的**
  `ProjectNodeParams.imageVideo`（`useProjectTreeParamsStore`）。留空 = 向上继承，
  口径与后处理一字不差。⚠️ 改 `buildProjectNodeParams` / `normalizeProjectNodeParamsMap` 时
  必须**两个模块一起看** —— 只判 `postprocess` 会把节点上的视频参数静默丢掉。
- **自动出视频挂在产出之后、分发之前**：分发会把产出文件夹按排期日搬走，搬完之后
  「这个方向的一批图」散在多个日期目录里，一个视频没法跨那么多目录取图。
- **IPC 只开白名单方法**（`image-video/engine-ipc.ts`）：引擎不认识糖包的 `assertAllowedPath`，
  透出一个通用 `call(method, params)` 等于开了个能读写任意目录的后门。
- **ffmpeg 不额外捆**：引擎内自带的 `imageio_ffmpeg` 就是它的兜底那份；但引擎查找顺序是
  **先系统 PATH 后自带**，所以界面必须把「实际用的是哪一份」显示出来。
- **持久化 namespace `imageVideo` 必须留在主进程白名单**（`electron/asset-kernel.ts` 的
  `APP_DATA_NAMESPACES`），否则设置改完重启就没了且 UI 不报错（R-07）。
