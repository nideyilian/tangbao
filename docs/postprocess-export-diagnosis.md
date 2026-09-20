# 导出 / 后处理四个问题的定位与修复方案

> 2026-09-20 · 只读排查（未改任何代码） · 依据：源码 + 真实 SQLite 落盘数据 + 端到端复现脚本

## 结论先行

| #   | 你的描述                               | 真实根因                                                                                                                                                                               | 性质                                 |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | 后处理完全不可用，配了输出位置却不产出 | **主进程路径白名单拒绝了你的路径**。只有「桌面/文档/下载/图片/userData」可用，`D:\…`、`E:\…` 一律拒绝；且**手输路径永远不会被授权**，只有走「选择…」对话框才行，而这个授权**重启就丢** | **真 bug**（安全边界与业务需求冲突） |
| 2   | 无法按渠道设置导出位置                 | **功能其实已经实现了**（含默认值继承、双写、节点级覆盖）。你感知不到，是因为**入口藏在「输出与命名」组的输出目录控件下方**，且被 1 的问题一并打死                                      | **已实现，入口/可用性问题**          |
| 3   | 命名模板没有预览                       | **确实是缺失**。`NamePatternField` 只有变量按钮，没有文件名预览；但渲染函数 `renderPostprocessNamePattern` 早已存在，**接线即可**                                                      | **真缺失**（改动很小）               |
| 4   | 设置入口分散、部分参数找不到           | 参数元数据已收口到 `paramSchema.ts`（设计是对的），但**「本地保存目录」在 `SettingsModal`、后处理设置在 `InputBar`、媒体表在弹窗里**——三处入口、零交叉链接                             | **信息架构问题**                     |

**一句话**：1 是安全策略与业务需求的冲突（最严重，是「完全不产出」的唯一原因）；2、3 基本是「已经做好了但你看不到」；4 是导航问题。

---

## 问题 1：后处理完全不可用（★ 主因）

### 报错原文的出处

你截图那句 **「没有产出文件：导出位置不可用，已跳过这批产出（请检查路径是否可达）」** 来自：

```
src/features/postprocess/outputRoots.ts:47
```

它由 `resolveBucketOutputRoots` 在**所有配置的目录都拿不到**时抛出。

### 完整的失败链路（逐跳有据）

```
outputRoots.ts:47            warnOnce('导出位置不可用…')
  ↑ roots.length === 0
outputRoots.ts:42            const root = await resolveRoot(dir)
  ↑ 返回 null
taskPostprocess.ts:347       getExplicitImageSaveDirectory(trimmed)
  ↑ 返回 null
localSave.ts:607-608         const ok = await api.ensureDir(trimmed)
                             return ok ? trimmed : null
  ↑ ensureDir 返回 false
electron/ipc-handlers.ts:1197  handleChecked('fs:ensure-dir', …)
electron/ipc-handlers.ts:1199  assertAllowedPath(dirPath)   ← 抛错
electron/ipc-handlers.ts:1202  catch (err) { console.error('创建目录失败:', err); return false }
  ↑ 异常被**吞掉**，只 console.error，不往渲染进程传
electron/ipc-handlers.ts:264-266
    if (!getAllowedRoots().some((root) => isPathInside(normalized, root)))
      throw new Error('Path is outside allowed application directories')
electron/ipc-handlers.ts:241-253  getAllowedRoots()
    = userData / desktop / documents / downloads / pictures
      + sessionAllowedRoots（**内存 Set，重启清空**）
      + readLocalSettings().localSavePath
```

### 白名单的实际放行范围（实测）

```
[拒绝] D:\投放大图                    ← 典型业务目录
[拒绝] D:\工作\投放\2026\百度
[拒绝] E:\素材交付
[拒绝] C:\Users\Public\Pictures      ← 公共目录也不放行
[允许] C:\Users\tt\Desktop\输出
[允许] C:\Users\tt\Documents\投放
[允许] C:\Users\tt\Pictures\投放
[允许] C:\Users\tt\AppData\Roaming\tangbao\local-saves\postprocess
```

### 端到端复现（用真实代码逻辑跑出来的）

```
场景 A：全局输出目录 = D:\投放大图（手输路径）
  产出目录 = (空 —— 这一桶被跳过，不产出任何文件)
  提示     = 导出位置不可用，已跳过这批产出（请检查路径是否可达）

场景 B：按渠道配 baidu = D:\百度交付
  产出目录 = (空 —— 这一桶被跳过，不产出任何文件)
  提示     = 导出位置不可用，已跳过这批产出（请检查路径是否可达）

场景 C：完全没配（走默认位置）
  产出目录 = C:\Users\tt\AppData\Roaming\tangbao\local-saves\postprocess   ← 只有这条能出图

场景 D：全局输出目录 = 桌面\输出（白名单内）
  产出目录 = C:\Users\tt\Desktop\输出                                        ← 白名单内能出图

对照：同一路径 D:\投放大图，但本次会话用「选择…」对话框选过
  产出目录 = D:\投放大图                                                     ← 能出图！
```

**关键不对称**（这就是「我明明设置好了」的来源）：

| 配置方式                              | 当次会话          | 重启之后                                 |
| ------------------------------------- | ----------------- | ---------------------------------------- |
| 点「选择…」在对话框里选 `D:\投放大图` | ✅ 能产出         | ❌ **失效**（`addAllowedRoot` 只在内存） |
| 直接在输入框里敲 `D:\投放大图`        | ❌ **当场就失效** | ❌ 失效                                  |

### 你的真实数据（只读读的 SQLite）

```
namespace = postprocessMedia / state
updated_at      = 2026-09-19 13:15:07   ← 近 22 小时没有再写入过
outputDir       = ""
mediaOutputDirs = {}
```

而 `zustand/state` 今天 03:40 还有写入 → **store 的持久化通道是好的**。
所以 `outputDir` 为空有两种可能：① 你填了但没落盘（写盘被拒时不回写）；② 你填的位置本来就没进入生效分支。

> ⚠️ 需要你确认一句：**你设的输出位置是在「后处理设置」弹窗里填的，还是在别处？填的是什么路径？**
> 这决定修复要覆盖哪条分支。但无论哪种，白名单这一层都必须修（见下）。

### 为什么说「异常被静默吞掉」

两处吞异常，这是这个问题难查的根本原因：

1. **`ipc-handlers.ts:1200-1205`**：`assertAllowedPath` 抛出的 `Path is outside allowed application directories` 被 `catch` 吃掉，只 `console.error`（渲染进程看不到），然后 `return false`。
   → 渲染侧只拿到一个布尔 `false`，**丢失了失败原因**。
2. **`outputRoots.ts:47`**：最终文案是「请检查路径是否可达」——这句话**把人往错的方向引**。路径明明可达（`D:\投放大图` 在资源管理器里打得开），真正的问题是「不在白名单里」。文案与原因不符。
3. **缺失的提示**：`getExplicitImageSaveDirectory` 返回 null 时，配置面板**不会告诉你配的这个位置不可用**。你是跑完任务才从 toast 里知道的。

### 最小化修复方案

**修 A（必做，解开业务阻塞）——把「用户显式配置的输出目录」纳入白名单**

```ts
// electron/ipc-handlers.ts  getAllowedRoots()
function getAllowedRoots(): string[] {
  const roots = [, /* …原有 5 个 app.getPath()… */ ...sessionAllowedRoots]
  const settings = readLocalSettings()
  if (typeof settings.localSavePath === 'string') roots.push(settings.localSavePath)
  // 新增：把「已配置的后处理输出目录」全部纳入
  //   读 postprocessMedia 的 outputDir + mediaOutputDirs（走 asset-kernel 的 app-data 读取即可）
  for (const dir of readConfiguredPostprocessOutputDirs()) roots.push(dir)
  return roots.map(normalizeFsPath)
}
```

安全论证：这不是把白名单拆掉，而是**把「用户显式配置过的目录」升级为受信根**——
与现有的 `localSavePath` 是完全一样的处理方式（`ipc-handlers.ts:251` 已在这么做）。
用户仍然不能写任意路径；只是「他自己在设置里填过的那个目录」被承认。

**修 B（必做，让失败可诊断）——保留失败原因**

```ts
// ipc-handlers.ts  fs:ensure-dir：不要再 catch 成 false
handleChecked('fs:ensure-dir', async (_event, { dirPath }) => {
  const safeDirPath = assertAllowedPath(dirPath) // 让它抛，preload 侧转成可读错误
  if (!existsSync(safeDirPath)) mkdirSync(safeDirPath, { recursive: true })
  return true
})
```

渲染侧 `getExplicitImageSaveDirectory` 把错误往上传，最终文案区分：

- 不在白名单 → 「该目录不在允许范围内：请在「设置 → 本地保存」里添加，或用「选择…」按钮选一次」
- 磁盘/权限问题 → 「目录不可写：请检查磁盘空间与权限」

**修 C（必做，事前告知）——输出目录控件加「可用性」实时校验**

填完路径立刻调 `ensureDir` 探一次，不可用就在输入框下方挂红字。
**不要等到跑任务才从 toast 里知道。**

**修 D（持久化，消除「重启就失效」）**

把 `sessionAllowedRoots` 落到 `local-settings.json`（与 `localSavePath` 同处），
启动时读回 → 「选过一次就永久生效」，符合直觉。

> **反向验证要求**：改完必须把 `getAllowedRoots` 临时改回旧版，确认新增的回归测试**真的失败**
> （这是本项目踩过坑的纪律：静默失效类测试极易写成假绿）。

---

## 问题 2：无法按渠道设置导出位置

### 结论：**功能已经实现了**，你感知不到是入口问题

已在源码里落地的能力（不是半成品，是完整的三层继承）：

| 能力                             | 位置                                                                | 状态 |
| -------------------------------- | ------------------------------------------------------------------- | ---- |
| 全局「默认输出目录」             | `PostprocessMediaConfig.outputDir`                                  | ✅   |
| **全局按渠道独立目录**           | `PostprocessMediaConfig.mediaOutputDirs: Record<mediaId, string[]>` | ✅   |
| **默认值继承逻辑**               | `resolvePostprocessOutputDirs()`（`postprocessMedia.ts:313-320`）   | ✅   |
| 渠道配 1~2 个位置（**双写**）    | `MAX_POSTPROCESS_OUTPUT_DIRS`，实测上限 2                           | ✅   |
| 节点级（方向/产品/产品线）再覆盖 | `PostprocessNodeOverride.byMedia`                                   | ✅   |
| 继承顺序明确                     | 节点渠道 → 节点通用 → 全局渠道 → 全局默认                           | ✅   |
| 显式「用默认位置」与「继承」区分 | `[]` vs `undefined`，`foldMediaOutputDirs()`                        | ✅   |
| 兼容旧单值字段                   | `outputDir`（旧）与 `outputDirs`（新）并存，新优先                  | ✅   |

UI 组件也已存在：**`src/features/postprocess/ChannelOutputDirs.tsx`**（注释明确写着两个入口共用）。

### 那为什么你觉得没有？

**入口位置太深**：它渲染在 `PostprocessParamPanel.tsx:390`，
即在**「输出与命名」→「输出目录」控件的正下方**，且 `collapsible`（默认收起）。
用户看到「输出目录」一个框就以为只能配全局，不会想到下面还折叠着按渠道的配置。

```tsx
// PostprocessParamPanel.tsx:361-401
case 'outputDir':
  return (
    <div className="space-y-2">
      <TextField label="" value={effective.outputDir} … />   ← 全局，显眼
      <Button>选择…</Button>
    </div>
    <ChannelOutputDirs … collapsible />                       ← 按渠道，折叠，看不见
  )
```

**且被问题 1 一并打死**：即使你在 `ChannelOutputDirs` 里配了 `D:\百度交付`，
因为白名单，产出那一刻同样返回「导出位置不可用」。**你配了也没用 → 自然认为「不支持」。**

### 修复思路

1. **把 `ChannelOutputDirs` 默认展开**（`collapsible` 保留但默认 `open`），
   或在「输出目录」控件旁加一句「已按渠道单独配置 N 个位置」的摘要 + 展开链接。
2. **问题 1 修好后，这个功能自然「复活」**——这是最关键的一步。
3. 建议在渠道行上显示**继承来源**，例如：
   `百度  [D:\百度交付          ] (覆盖全局)`
   `优酷  [用默认位置 ▾          ] (继承：D:\投放大图)`
   现状已有 `resolveInheritedHint` 提供继承提示，把它显性化即可。

### 关于「默认值继承逻辑」的现状（你要求的那条）

已经实现且语义严谨，**无需新增**：

- 渠道没配 → 落回 `outputDir`
- 渠道配了空列表 `[]` → **显式**「用默认位置」，会把全局渠道配置一起让位
- 没表态 `undefined` → 继续向上继承
- 纯净版（`clean`）无渠道概念 → 固定沿用 `outputDir`

这套「`undefined` = 继承、`[]` = 显式覆盖」的约定在本项目是**统一铁律**，改动时务必沿用。

---

## 问题 3：命名模板没有预览

### 结论：确认缺失，且**改动极小**

`src/features/postprocess/NamePatternField.tsx` 只有：

- 一个输入框
- 9 个变量插入按钮（`POSTPROCESS_NAME_TOKENS`）

**没有文件名预览**。

而渲染函数**早就存在**，无需新写：

```ts
// src/lib/postprocessNaming.ts:207
export function renderPostprocessNamePattern(pattern, context): string
// src/lib/postprocessNaming.ts:238
export function buildPostprocessOutputName(config, unit, names, sequence, createdAt): string
```

配套的**示例数据也现成**：`PostprocessSettingsModal` 里已有 `FALLBACK_PREVIEW_SIZE = {1024, 1024}`
（`PostprocessSettingsModal.tsx:47`），正是为「尺寸不可预知时预览」准备的。

### 修复思路

在 `NamePatternField` 内、变量按钮下方加一行预览：

```
预览：20260920-产品A-横版-百度-1280x720-1.jpg
```

实现要点：

1. 调 `renderPostprocessNamePattern(value, context)`，context 用示例数据兜底
   （`line='产品A'`、`product='示例产品'`、`media='百度'`、`size={1280,720}`、`seq=1`、
   `createdAt=Date.now()`）。
2. **`{creator}` 取真实值**（来自 store），不要示例——它是用户真会填的字段。
3. 把**已有校验**（`validateNamePattern` 的未知/缺失/重复 token）与预览**并排**展示：
   目前校验在 `PostprocessParamPanel.tsx:344-350` 渲染，位置在控件下方，与预览天然同区。
4. 展示 1~2 行示例（不同 `seq`）能更直观看出序号作用。
5. 注意 `renderPostprocessNamePattern` 的既有约定，别在预览里「顺手修」：
   - 未知 token **原样保留**（`{foo}` 留在结果里，便于肉眼发现写错）
   - 已知但取值为空的 token **整段删除**
   - 折叠连续 `-` 与首尾 `-`
   - 兜底 `'image'`

> 这个字段被**两个入口共用**（后处理设置 + 项目节点参数），所以预览加在
> `NamePatternField` 内部 = 两处同时获得能力，无需改两遍。这也是它当初抽成组件的原因。

---

## 问题 4：设置入口分散混乱 —— 信息架构重组

### 现状盘点（实测的所有入口）

| 参数                            | 实际存放                | 现入口                              | 问题                                                       |
| ------------------------------- | ----------------------- | ----------------------------------- | ---------------------------------------------------------- |
| 本地保存目录（`localSavePath`） | `local-settings.json`   | **`SettingsModal.tsx:4447`**        | 与后处理设置**完全分离**，但它正是「默认输出位置」的父目录 |
| 输出目录 `outputDir`            | `storePostprocessMedia` | 后处理弹窗 → 输出与命名             | 与上面那个**语义强相关却不在同一屏**                       |
| 按渠道目录 `mediaOutputDirs`    | 同上                    | 后处理弹窗 → 输出目录**下方折叠区** | 折叠 → 找不到                                              |
| 命名模板 `namePattern` / 创作者 | 同上                    | 后处理弹窗 → 输出与命名             | 无预览                                                     |
| 媒体表（渠道+尺寸）             | 同上                    | 后处理弹窗 → 全局编排               | 全局与节点混在一个弹窗里                                   |
| 水印归属                        | `projectTreeParams`     | **水印预设工作区**的「水印归属」树  | 刻意分离（有注释说明避免打架）✅                           |
| 分发 `distribution`             | `storePostprocessMedia` | 后处理弹窗 → 分发                   | ✅                                                         |
| 节点级覆盖                      | `projectTreeParams`     | 后处理弹窗 → 左侧树                 | ✅ 设计合理                                                |

**核心症结**：**「文件存到哪」被拆到了两个互不相连的地方** ——
`SettingsModal`（本地保存目录）与 后处理弹窗（输出目录）。
用户在 A 处设了根目录，在 B 处设了子目录，两处谁也不知道谁。

### 归置方案

原则（沿用本项目既有铁律）：**一个事实只有一个家；参数元数据只有一处声明。**

#### 1. 保留 `paramSchema.ts` 作为唯一元数据源 ✅（已经在这么做）

`POSTPROCESS_PARAM_FIELDS` 已经做到「一个字段只声明一次（label/help/control/scope/group/validate）」，
左右两栏都从这里读。**这是对的架构，不要在重组里破坏它。**

#### 2. 把「本地保存目录」提升为后处理的显式一环

在 `paramSchema.ts` 的输出组里**新增一个字段**（只读展示 + 跳转）：

```ts
{
  key: 'localSaveRoot',
  label: '本地保存根目录',
  help: '「默认输出位置」就在它下面。产出目录留空时用这里。',
  control: 'localSaveRoot',   // 新控件：显示当前值 + 「打开设置」按钮
  scope: 'global',
  group: 'output',            // ← 与 outputDir 同组，终于在一起了
  resettable: false,
}
```

值只在 `SettingsModal` 改（**唯一写入点不变**），但要**在输出组里可见**。
这样用户看到「输出目录」时，上方就是它的兜底根目录。

#### 3. 后处理弹窗内按「我要配什么」重排（不新增弹窗）

```
左树（导航）              右栏（详情）
├─ 全局默认               ┌─ 参与方式 ────────────┐
├─ 产品线A                │  参与自动后处理        │
│  ├─ 产品A1              ├─ 产出规格 ────────────┤
│  │  └─ 方向X   ←───────┤  媒体（渠道勾选）      │
│  └─ 产品A2              │  画面方向              │
└─ 产品线B                ├─ 输出与命名 ──────────┤
                          │  本地保存根目录(只读)  │
                          │  输出目录 [选择…]      │
                          │  ▾ 按渠道导出位置      │  ← 默认展开
                          │    百度 [D:\百度交付]  │
                          │    优酷 [继承默认]     │
                          │  命名模板 + 预览 ★     │
                          │  创作者                │
                          ├─ 水印（只读+跳转）─────┤
                          ├─ 分发 ────────────────┤
                          └─ 全局编排 ────────────┤
                             媒体表                │
                             产出预览              │
```

关键改动只有三处：**① 输出组内补「本地保存根目录」只读项；② `ChannelOutputDirs` 默认展开；③ 命名模板加预览。**

#### 4. 加「跳转」而不是搬家

- 水印归属 → 保留在**水印预设工作区**（现状有明确注释论证过，别动），
  但在后处理里给一个「去水印归属」按钮。
- 媒体表只在**全局节点**出现（现状已如此，`scope: 'global'`）✅。
- `SettingsModal` 的本地保存目录 → 加一句「后处理的默认输出位置在此目录下」+ 跳转按钮。

#### 5. 不建议做的事

- ❌ **不要把 `paramSchema` 拆开**——它现在是「唯一元数据源」，拆开就回到「改一处漏两处」的老问题。
- ❌ **不要给 `namePattern` 开放节点级以外的第二份实现**——`NamePatternField` 是共用组件。
- ❌ **不要把水印归属并进后处理**——两个入口改同一份数据必然打架（源码注释已论证）。

---

## 兼容性保证（你特别要求的一条）

现有配置数据**零迁移成本**，因为改动都不碰已有字段语义：

| 已有数据                             | 是否受影响         | 说明                                          |
| ------------------------------------ | ------------------ | --------------------------------------------- |
| `outputDir`（单值）                  | ❌ 不影响          | 继续作为全局默认与兜底                        |
| `mediaOutputDirs`                    | ❌ 不影响          | 已存在，只改 UI 可见性                        |
| 节点 `byMedia[].outputDirs`（新）    | ❌ 不影响          | 已支持                                        |
| 节点 `byMedia[].outputDir`（旧单值） | ❌ 不影响          | `foldMediaOutputDirs` 已有兼容分支 + 测试覆盖 |
| `namePattern` / `creator`            | ❌ 不影响          | 只加预览，不改渲染                            |
| 持久化 `version: 2`                  | ❌ **不需要 bump** | 无字段增删，`migrate` 不必动                  |
| `localSavePath`                      | ❌ 不影响          | 只增加只读展示                                |

**唯一需要新增持久化的是**：白名单授权目录（问题 1 修 D）。
建议放进 `local-settings.json`（已经在读，`ipc-handlers.ts:250`），**不动 zustand store**。

⚠️ 若要动 `storePostprocessMedia` 的字段 → **必须同步三处**（本项目铁律）：
① `partialize` 白名单；② `getPostprocessMediaConfigSnapshot`；③ 若加排序键还要改桌面端 SQL。
**且如果新增/改字段，`version` 必须 bump**，否则 zustand 不触发 `migrate`，旧字段被静默丢弃。

---

## 建议的修复顺序

| 序    | 内容                                   | 理由                                               |
| ----- | -------------------------------------- | -------------------------------------------------- |
| **1** | **修 A + B（白名单 + 保留失败原因）**  | 不修这个，2 配了也没用、1 永远不产出。**最高优先** |
| 2     | 修 C（输出目录可用性实时校验）         | 让失败在配置时就暴露，而不是跑完才从 toast 知道    |
| 3     | 问题 2 的入口可见性（展开 + 继承提示） | 功能已有，成本极低，收益立竿见影                   |
| 4     | 问题 3 命名预览                        | 独立小改，体验提升明显                             |
| 5     | 修 D（白名单授权持久化）               | 消除「重启就失效」                                 |
| 6     | 问题 4 的 IA 归置                      | 前 5 项做完后再收口，避免同时改 UI 与行为          |

---

## 需要你补充的信息

1. **你设的输出位置到底是什么路径？是在「后处理设置」里填的，还是在「设置 → 本地保存」里填的？**
   ← 决定问题 1 的修复要覆盖哪条分支（虽然白名单这层无论哪种都要修）。
2. **你期望的导出根目录**（例如 `D:\投放大图`）——我用它做修复后的验收用例。
3. 是否接受「**在设置里显式填过的目录即视为受信**」这个安全口径？
   （与现有 `localSavePath` 的处理方式一致；不接受的话就得改成「只能从对话框选」。）
