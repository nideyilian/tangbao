# 素材库任务卡「切换界面后消失」排查（2026-09-22）

> 只读排查，**未改任何源码**。报障原文（杰哥 2026-09-22 21:32）：
> 「任务卡片经常丢失。切换界面后卡片会消失，按 Ctrl+R 刷新后也可能丢失，
> 有时必须重新加载才能重新显示，但缺失依旧存在。」
> ⚠️ 工作区当时挂着 TB-105 的 12 个未提交文件（另一条写线），本轮未 add、未提交、未跑全量 `verify`。

## 一、结论

**不是一个 bug，是三条各自独立、但都会表现为「卡片不见了」的缺陷叠在一起。**
共同点是：**卡片消失这件事在代码里是静默的** —— 不报错、不留占位、面板计数照旧。

| # | 缺陷                                                                | 位置                                            | 能解释哪几条症状                       |
| - | ------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| ② | 卡片可见性 = **SQL 分页结果 ∩ 内存缓存**，而内存缓存只有最新 200 条 | `query.ts:196-209` + `assetLibraryRepository.ts:167-190` | 切界面消失 / 重载才显示 / 缺失依旧存在 |
| ① | 任务记录取不到 → 素材归为孤儿组 → **整组被一行 filter 丢掉**        | `AssetBatchView.tsx:474-479`                    | ⚠️ **本机实测不成立**（孤儿 0 条，见 §二·六） |
| ③ | 量不到宽度时按 **1px** 渲染卡片（测量 effect 只跑一次、refs 为空即永久不建 observer） | `AssetBatchView.tsx:623-632`、`:504-508`、`:943`  | 切界面消失 / 必须重新加载才显示         |

**⚠️ 2026-09-22 22:20 更正**：第一版把 ① 押为主因。只读直查真库后 **孤儿 0 条**，
① 在本机**不成立**（它仍是潜在缺陷，只是现在没触发）。**主因改为 ②，并有真实数字支撑** ——
479 张 active 素材里 **279 张（58%）落在内存缓存窗口之外**。详见 §二·六。
最终判断顺序：**② 主因 → ③ 叠加（渲染兜底缺失）→ ① 潜在（等哪天任务记录真丢了会咬人）**。

## 二、三条缺陷的逐条论证

### ① 孤儿组被一行 filter 静默掐死（主因）

`src/features/assetLibrary/AssetBatchView.tsx:474-479`

```ts
const groups = useMemo(
  () => buildAssetBatchGroups(assets, tasksById, snapshots, { includeTaskless })
        .filter((group) => group.kind !== 'orphan'),   // ← 整组丢弃
  [assets, includeTaskless, snapshots, tasksById],
)
```

`buildAssetBatchGroups`（`src/lib/assetBatchGrouping.ts:151-221`）的分组判据是
**素材来源里那个 `taskId` 能不能在 `tasksById` 里查到**：

```ts
const task = taskId ? tasksById.get(taskId) : undefined
if (task?.sopBatch) { ... } else if (task) { ... } else { /* orphan 组 */ }
```

**只要任务记录取不到（内存里没有 / 落盘没了），素材就被归成 orphan 组，然后在上面的 filter 里整组消失。**
佐证这条渲染路径**并非没写，而是永远走不到**：

- `OrphanBatchCard` 已 import（`AssetBatchView.tsx:43`）且在 `AssetGroupCardBody` 里渲染（`:330`）
- `kind === 'orphan'` 的分支遍布 `:195 / :238-249 / :559 / :820 / :1136`
- 结果 `groups` 里根本不存在 orphan 组 ⇒ **全是死代码**

这条正是仓库自己最怕的那类失效（`architecture-constraints.md` 七·五章「静默失效」）：
**数据在、图在「图片」视图里还能看到，只有卡片视图把它吞了。**

> 补充：`AssetBatchView.tsx:472-473` 的注释写着「不再展示『任务已删除』孤儿组（按用户要求）」——
> 所以这是一次**有意的产品取舍**。但它没考虑到「任务记录会因为别的原因丢」，
> 于是**任何任务记录损失都会升级成「卡片凭空消失」**。这一点需要杰哥拍板（见第五节）。

### ② SQL 分页结果 ∩ 内存缓存，缓存只有最新 200 条

`src/lib/assetLibraryRepository.ts:167-190`（桌面分支）

```ts
api.assetCatalogQuery({ scope: 'all', query: '', filters: {}, sortKey: 'updatedAt', sortOrder: 'desc', limit: 200 })
→ assets: (page?.assets ?? []).map(normalizeAsset)
```

**`hydrate()` 只把最新 200 条灌进 `assetsById`**（全量在 `hydrateFull()`，只有导入/导出/回收站清空用）。

`src/features/assetLibrary/query.ts:196-209`

```ts
return catalogAssets
  .map((asset) => liveById[asset.id] ?? asset)
  .filter((asset) => {
    const live = liveById[asset.id]
    if (!live || live.status !== asset.status) return false   // ← 内存里没有就剔除
    ...
```

**卡片可见性 = SQL 页 ∩ 内存缓存**。杰哥库里 429 张（TB-082 记录）
⇒ 超过 200 的那 229 张**长期只活在 SQL 页里**，能不能显示取决于「这一屏走的是哪条路」：

- 组件重挂载后 `catalogPage` 归零（`AssetLibraryWorkspace.tsx:332-336 / 481-504`）
  → 首屏退化成**纯内存查询**；
- 目录查询返回后才有 SQL 那一份，且要靠 `applyUpsertedAssets`（`:381`）把它们补进内存。

于是**同一批素材，切一次界面就可能从「有」变「没有」再变「有」**；
期间只要有一条支路没把内存补齐，卡片就是「缺失依旧存在」。

### ③ 量不到宽度就渲染 1px 卡片

`AssetBatchView.tsx:623-632`

```ts
useLayoutEffect(() => {
  const layoutElement = layoutRef.current
  const scrollElement = scrollRef.current
  if (!layoutElement || !scrollElement) return        // ← refs 为空就直接放弃
  measure()
  const observer = new ResizeObserver(() => measure())
  ...
}, [measure])                                          // ← 依赖只有 measure（稳定），只跑一次
```

`:943` 有一段**提前 return** 的空态（`assets.length === 0 && groups.length === 0` 时不渲染 layout 容器，
`layoutRef` / `scrollRef` 全为 `null`）。
⇒ 一旦首帧落在空态，refs 出现后**这个 effect 不会重跑**，observer 永不建立（`:634-643` 只给 window resize 兜了底）。

此时 `layoutWidth === 0`：

```ts
getTaskCardColumns(0) → 2                                  // :72-77
cardWidth = Math.max(1, (0 - 16 * 1) / 2) = Math.max(1, -8) = 1   // :504-508
```

**卡片宽度 1px** —— DOM 在、计数在、就是看不见。`viewport` 也停在初始 `{top:0,height:800}`。

## 二·五、孤儿是怎么来的（2026-09-22 追加，回应「我没删任何东西」）

**先纠正一个容易误解的点**：孤儿组**现在在界面上看不到**（被 `:477` 的 filter 藏了）。
所以「卡片消失」不是「看到孤儿卡」，而是「卡片**少了一张**」。孤儿只是它背后的中间状态。

**孤儿的判据只有一条**（`assetBatchGrouping.ts:152-154`）：

```ts
const origin = getPrimaryOrigin(asset)
const taskId = origin?.taskId ?? ''
const task = taskId ? tasksById.get(taskId) : undefined   // ← 查不到 → 归为孤儿组
```

`tasksById` 来自内存里的 `state.tasks`。**只要这个 taskId 查不到，就是孤儿** ——
**它不要求你删过任何东西**。成因分两大类：

### A. 素材天生就没有任务来源（跟任务、跟删除都无关）

| 来源                                                            | 证据                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **导入的外部图片**                                              | `src/lib/externalAssetImport.ts:23-34`：`origins: []`、`primaryOriginKey: null`     |
| 派生素材（后处理 / 合成产出）                                    | `src/lib/assetCommands.ts:408-427`：同上（⚠️ `createDerivedAsset` 当前**无调用点**，是死代码，接上前不用管） |
| 历史迁移数据                                                     | `src/lib/migrations/legacyFavoritesToAssets.ts`                                     |

`origins: []` ⇒ `getPrimaryOrigin()` 返回 `undefined` ⇒ `taskId = ''` ⇒ **必然孤儿**。

> ⇒ **你导入的每一张图，在「任务卡片」视图里从来就不显示**，但它在「图片」视图、侧栏计数、回收站里都好好的。
> 这跟「删没删」一点关系都没有 —— 它压根没有来源任务可归。

### B. 素材有来源，但那个 taskId 查不到（也不需要你删）

1. **只看「主来源」，不看还有没有别的来源能对上**
   `getPrimaryOrigin`（`assetBatchGrouping.ts:52-58`）只取 `primaryOriginKey` 那一条（取不到才回退 `origins[0]`），
   而 `buildAssetBatchGroups` 只拿这一条去查任务。
   同一张图被**两个任务**产出过时 `origins` 有两条（`generatedAssetOrigin.ts:161-172` 会**追加**），
   只要主来源那条任务取不到，**整张图判孤儿** —— 哪怕另一条来源的任务就在列表里、卡片好好挂着。
2. **任务根本没写进库 / 写盘失败**
   `submitTaskWithData` 是「**先 `setTasks` 上屏、再 `await putTask` 落盘**」（`store.ts:6251-6269`）。
   写盘一失败：屏幕上卡片在、库里没有 ⇒ **重启后这条任务消失，它的素材全变孤儿**。
   TB-082 正是这个方向的现象（那是反向：素材没了任务还在）。
3. **写盘会静默 no-op**
   `db.ts:400-403`（`writeManyElectronRecords`）与 `:428-436`（`replaceElectronRecords`）都用
   `filter((v) => typeof v.id === 'string')` 过滤 —— **没有字符串 id 的记录直接被丢掉，不报错**。
4. **`asset:${imageId}` 与裸 `${imageId}` 双 id**
   生成素材 id 是 `asset:<imageId>`（`generatedAssetOrigin.ts:175`），导入素材 id 是裸 `imageId`
   （`externalAssetImport.ts:23`）。按错前缀查不到 → 被当成新素材重建 → `origins` 重置成单条
   （`generatedAssetOrigin.ts:186`）。这条风险仓库里已有注释警告（`assetLibraryRepository.ts:325-327`）。

**最可能落到你身上的**：A 表的「导入图片」（稳定、100% 复现）+
B1（同一张图两条来源时主来源对不上）。

**30 秒自检（不用跑脚本）**：范围切到「全部素材」、清空搜索框，
拿顶部工具栏的「全部素材 N 张」减去卡片视图速览条的「X 张素材」 —— **差出来的就是孤儿素材数**
（速览条的 `assetCount` 只累加被分组的素材，`assetBatchGrouping.ts:323-332`）。

## 二·六、真库实测（2026-09-22 22:20）—— 撤回上一条主因，改成「内存缓存窗口」

只读探针（`%TEMP%\tb-orphan-probe-{1,3,4}.py`，`mode=ro`）直查
`C:\Users\tt\AppData\Roaming\tangbao\local-saves\db\asset-kernel.sqlite`：

| 指标                                          | 实测值                              |
| --------------------------------------------- | ----------------------------------- |
| tasks 记录                                    | **566**（有 `outputImages` 的 556） |
| assets 行                                     | **484**（active 479 / trashed 5）   |
| **孤儿素材（主来源任务查不到）**              | **0**                               |
| `origins` 为空的素材（导入图）                | **0**                               |
| `primaryOriginKey` 找不到对应 origin 的素材   | **0**                               |
| 内存缓存窗口（`hydrate` 的 `limit: 200`）覆盖 | 只到 **2026-09-21 11:51**           |
| **落在内存窗口之外的 active 素材**            | **279 / 479（58%）**                |

⇒ **落盘层面完全健康，孤儿 0 条。**
**所以「A 类（导入图 / 天生无来源）」和「B 类（任务记录缺失）」在本机都不成立，
第二节主因那一条（任务记录缺失）实测被推翻，撤回。**

**真正的成因是 ②（内存缓存窗口）**，机制三步：

```ts
// 1) 卡片可见性 = 内存缓存 ∩ SQL 页；内存里没有就「直接剔除」，不显示、不报错
//    src/features/assetLibrary/query.ts:196-201
.map((asset) => liveById[asset.id] ?? asset)
.filter((asset) => { const live = liveById[asset.id]; if (!live || live.status !== asset.status) return false; ... })

// 2) 而没有 SQL 页时，整屏退化成「只查内存」
//    src/features/assetLibrary/AssetLibraryWorkspace.tsx:482-483
if (filterFavorite) return queryResult
if (!catalogPage) return queryResult          // ← catalogPage 是组件局部 state

// 3) SQL 页只在「查询成功那一刻」存在；清空/失败都没有重试
//    :332-336 查询上下文变化 → setCatalogPage(null)
//    :408-410 查询失败 → setCatalogPage(null)   ← deps 不变就不会再跑，永久停在这个状态
```

于是卡片视图在两种状态间跳：

| `catalogPage` | 画的是                          | 能看见多少                        |
| ------------- | ------------------------------- | --------------------------------- |
| 有（查询成功）| SQL 页（当前范围前 120，可滚动）| 全库（分页）                      |
| 空（重挂载/切范围/查询失败）| **只有内存里最新 200 条** | **最多 200，窗口外那 279 条不存在** |

**四条症状全部对上**：切界面（组件重挂载 → `catalogPage` 归零）→ 只画内存 → 少的正是窗口外那 279 条；
刷新同理；重载/等查询成功 → 又回到 SQL 页 → 「重新显示」；
**查询失败那次没有重试** → 「缺失依旧存在」。
而且**每次重启 `hydrate()` 都把内存重置回最新 200 条**，所以窗口外那批**每次都得重新靠查询挣回来** ——
跟「删没删任何东西」毫无关系。

**30 秒确认**：范围「全部素材」+ 清空搜索，读两个数 ——
顶部工具栏「全部素材 479 张」 vs 卡片视图速览条「X 张素材」（**约 120 上下或 200 上下，切换界面时这个数会跳**）。
差出来的就是「这一屏没画」的那批。它会在切界面时跳动 = 坐实本条。

## 三、10 秒分层确认法（先做这个，别先翻代码）

本机没有渲染验证能力，所以结论要靠**四看**定层：

| 看什么                                   | 结论走哪一层                                            |
| ---------------------------------------- | ------------------------------------------------------- |
| 顶部速览条 `N 个分组 · M 个任务 · X 张素材` | 数字**没变**但网格空 → **渲染层**（①②③）              |
| 切到「图片」视图，那些图还在吗           | 在 → **卡片层**（①，任务记录缺失）；不在 → **素材层**  |
| 速览条数字也掉 / 变 0                    | → **查询层**（②，SQL 页与内存缓存不同源）              |
| 左侧换个范围（比如「全部素材」）再切回来 | 一换就好 → ②；怎么换都好不了 → ③                       |

再加上一条命令就能定「内存 vs 落盘」（读库一律 `readOnly: true`，R-06）：

- 数 `app_data_records` 里 `namespace='tasks'` 的条数
- 数 `assets` 表里 `status='active'` 的条数
- 数「素材 `origins[].taskId` 在 `tasks` 里查不到的条数」← **这个数 > 0 就直接坐实①**

## 四、修复方案（含取舍）

**A. 让「任务记录缺失」重新可见（治①，最小改动、收益最大）**

- 去掉/放宽 `:477` 的 `.filter(g => g.kind !== 'orphan')`，把孤儿卡显示出来
  （`OrphanBatchCard` 的分支现成）；或在卡片上打一枚「任务记录缺失」的标 —— 参考 TB-082
  给素材打「已删除」的做法。
- **代价**：屏幕上会重新出现「任务已删除」这类卡（当初是为了不出现这个状态才滤掉的）
  ⇒ **这一条需要杰哥拍板**：宁愿看到一张带说明的卡，还是宁愿它继续静静消失。

**B. 内存缓存不再决定可见性（治②）**

- `resolveEffectiveAssets`：把 `if (!live || ...) return false` 改成
  **`live` 缺失时以 SQL 页为准**（保留），只在 `live` 存在且 `status` 不同时才剔除。
- **代价**：内存与 SQL 页不一致时，会短暂显示「已删/已回收」的素材，
  要等下一次查询或 `mutationVersion` 刷新才纠正（换取「卡片不无故消失」）。

**C. 兜住测量（治③）**

- 把 `measure` 挂成 ref callback（refs 一出现就测一次），或让 effect 依赖
  `assets.length > 0`；并把 `cardWidth` 在 `layoutWidth === 0` 时**退化为「不渲染」**
  而不是渲染 1px 卡片（宁可空着也不要 1px 幻影）。

**D. 补一条启动自检（治「不知道丢了」）**

- 启动后统计「素材来源任务查不到」的条数与任务 id 样本，进控制台/状态栏
  （现在完全静默 —— 这正是 TB-082 只能靠人工数库的原因）。

## 五、验收标准（可测，含反向验证）

1. `resolveEffectiveAssets` 新增用例：**SQL 页里的素材不在内存缓存 → 仍必须保留**；
   反向：把 `!live → return false` 改回去 → 该用例必须变红。
2. `AssetBatchView` 新增用例：**空态切回非空后，卡片不得以 1px 宽度渲染**
   （断言卡片 style 的 width），且测量 effect 在 refs 出现后必定跑过一次；
   反向：去掉 ref callback 兜底 → 用例变红。
3. 视图层用例：**任务记录缺失时该组不得被静默丢弃**（要么出卡、要么出说明）；
   反向：恢复 `:477` 的 filter → 用例变红。
4. 真机过目（本机无渲染验证能力，必须由杰哥过目）：
   ① 素材数 > 200 的库，切文件夹来回 5 次不出现卡片缺失；
   ② 搜索一个无结果的关键词 → 清空搜索 → 卡片必须正常；
   ③ Ctrl+R 连续 3 次，卡片集合稳定。
5. 定向门禁（不开全量，因为工作区挂着 TB-105 的 WIP）：`npx tsc -b` +
   `npx tsc -p electron/tsconfig.json --noEmit` + `vitest run src/features/assetLibrary src/lib`
   + `eslint` + `prettier --check`（**不要把 `docs/**` 喂给 prettier**，runbook §6）。

## 六、给杰哥的两个待定项

1. **孤儿卡要不要重新显示**（方案 A）—— 这是产品口径，只有你能定。
   我倾向：**显示**，因为「静静消失」比「看到一张带说明的卡」危险得多（这次就是你报的障）。
2. 修复顺序建议 **C → A → B → D**：C 最安全（纯渲染兜底）、A 收益最大、
   B 动的是可见性判据（要回归的面最大）、D 只是为了下次不再靠人工数库。

## 七、实施记录（2026-09-22 22:26，杰哥批准「按推荐的来」）

按 §四 的**小改**方案实施 ①②③，**未动**启动性能（`hydrate` 仍是 200 条窗口）。

### 改了什么

| # | 文件                                        | 改动                                                                                                                            |
| - | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ① | `src/features/assetLibrary/query.ts`        | `resolveEffectiveAssets`：`!live` 时**以数据库分页结果为准保留**（原来直接剔除）；`live` 存在时行为完全不变                      |
| ② | `.../AssetLibraryWorkspace.tsx`             | 新增 `catalogAwaitingFirstPage = desktopCatalog && !filterFavorite && !catalogPage`，该状态内容区显示「素材列表加载中…」，**不再把内存那 200 条当整屏数据源** |
| ③ | 同上                                        | 查询失败**不再清分页快照**：有快照就留着（卡片不消失，只出一条「素材列表刷新失败 · 重试」），没快照才显示失败态 + 重试；重试令牌进 effect 依赖，失败后能真正重跑 |

### 验收证据

- `npx tsc -b` → 零错
- `eslint` 三个改动文件 → 零告警
- `prettier --check` 三个改动文件 → 通过
- `vitest run src/features/assetLibrary src/lib` → **124 files / 1318 passed**

### 反向验证（精确命中）

把 `query.ts` 改回 `if (!live || live.status !== asset.status) return false` 后重跑，
**恰好 3 条红、其余 39 条绿**，且红的正是目标那 3 条：

1. `keeps assets absent from the in-memory state（内存缓存窗口之外不能剔除）`
2. `keeps snapshot objects when the asset is not in memory (defensive fallback)`
3. `keeps a whole page when the in-memory cache window is narrower than the library（TB-106 回归）`

改完已逐行回读校验复原。

> ⚠️ 顺带发现两条**把 bug 钉成「预期行为」的用例**（`query.test.ts`）：一条标题就叫
> `drops assets absent from the in-memory state`，另一条标题写 `keeps snapshot objects when the
> asset is not in memory` 而**断言却是 drop** —— 标题与断言自相矛盾，说明作者本意就是保留。

### 未做 / 待拍板

1. **分页快照提到 store**（根治②，跨重挂载存活）—— 要改 `features/assetLibrary/store.ts`，
   而该文件是 TB-105 的未提交文件，本轮**一个字节都没碰**（R-09 / R-79）。
2. **内存缓存全量化**（`hydrateFull`）—— 启动性能取舍，留给杰哥拍板。
3. **侧栏 / 工具栏计数在首帧仍走内存派生**（`queryResult.counts`），加载态只盖住了网格，
   数字会短暂偏小；与第 1 条一并解决更合适。
4. `resolveEffectiveAssets` 的 `live.status !== asset.status → 剔除` 是**同一类隐患的反向**
   （内存陈旧时会把回收站里的图剔掉），本轮刻意未动，已记 RISK R-91。
5. **③ 的 1px 卡片测量兜底** —— ✅ **已在第二轮修掉，见 §八**。

## 八、第二轮实施（2026-09-22 22:40，杰哥「接着做」）

按 §七 的遗留推进：**能立刻做、不需要拍板的两条做掉了，并撤销一条我自己的假警报。**

### 1. 「还没量到宽度 → 渲染 1px 幻影卡片」已修（`AssetBatchView.tsx`）

链路（§二 表格第 ③ 行的完整版）：

```ts
useLayoutEffect(() => {
  const layoutElement = layoutRef.current
  const scrollElement = scrollRef.current
  if (!layoutElement || !scrollElement) return   // ← 首帧落在空态就是这里 return
  measure()
  const observer = new ResizeObserver(() => measure())
  ...
}, [measure])                                    // ← measure 是 useCallback([])，恒定 ⇒ 一生只跑一次
```

空态与非空态是**两棵不同的子树**（`assets.length === 0 && groups.length === 0` 时提前 return，
两个 ref 都是 `null`）⇒ 一旦首帧落在空态，effect 不会重跑、`ResizeObserver` 永不建立，
`layoutWidth` 永远停在 0 ⇒ `cardWidth = Math.max(1, (0 - 16) / 2) = 1`（1px）。

- **改法**：新增 `hasMeasurableContent = assets.length > 0 || groups.length > 0` 进依赖
  （空 → 非空必补一次测量），并让 `cardWidth` 在 `layoutWidth === 0` 时保持 0、
  由 `visibleItems` 拦住不渲染（宁可空这一帧，也不要 1px 幻影卡片）。
- **守卫用例**：`AssetBatchView.test.tsx`「never renders 1px phantom cards while the layout width
  is unknown」；harness 的 `renderGrouped(layoutWidth = 800)` 加了参数，传 `0` 即模拟该状态。
- **反向验证精确命中 1 条**：把 `cardWidth` 改回 `Math.max(1, …)` → 恰好那条红，其余 28 条绿。
- ⚠️ **实测踩到的测试卫生坑（值得记住）**：这类用例**必须 `try/finally` 卸载 renderer**。
  本文件后续用例共用 `useAssetLibraryStore`，断言失败时漏掉 `unmount()` 会把
  「查看来源任务」那 3 条滚动用例一起带红（表现成 3 条迷惑性连带失败，害我多查了一轮）。

### 2. 查询失败自动补试一次（`AssetLibraryWorkspace.tsx`）

目录查询失败后自动补试**一次**（600ms 退避，成功后计数归零）；再失败才停在提示条 / 失败态等人工重试。
瞬时 IPC 抖动（主进程 / utility 进程刚重启）不该让用户自己去找「重试」按钮。

### 3. 撤销一条假警报：`live.status !== asset.status → 剔除` 的反向隐患（原 §七 遗留 4）

**经复核不成立。** 该判据只在「内存与库对同一素材状态不一致」时才有影响，而：

- 应用是**单实例**，所有状态变更都经 store（同时写内存与库）；
- 直写库的批量路径（导入 / 恢复 / 迁移）后面都跟 `hydrate()` 重灌内存。

⇒ **内存只可能比库新，不可能更旧**，「库说 trashed、内存还说 active」这条路径**不可达**。
判据保留（用户刚回收时立即从活跃网格消失是预期行为）。已同步更正 RISK R-91。

### 验收证据（第二轮）

| 项 | 结果 |
| --- | --- |
| `vitest run src/features/assetLibrary src/lib` | **124 files / 1319 passed**（比第一轮多 1 条，即新增的 1px 用例） |
| `npx tsc -b` | 零错 |
| `eslint`（5 个改动文件） | 零告警 |
| `prettier --check`（5 个改动文件） | 通过 |

### 仍未做（等杰哥拍板）

1. 启动 `hydrate()` 的 **200 条窗口要不要全量化**（`hydrateFull`）—— 启动性能取舍。
2. 分页快照提到 `features/assetLibrary/store.ts` —— 能彻底消掉「加载中」那一帧，
   但该文件挂着另一条写线的未提交改动，本轮**一个字节都没碰**（R-09 / R-79）。
