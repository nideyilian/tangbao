# 豆包账号池（doubao-account-pool）接入可行性评估

- 评估日期：2026-10-09
- 对象：`git@github.com:yaonieyo/doubao-account-pool.git`，当前版本 `0.1.30`（最后提交 2026-08-12）
- 评估范围：能不能把它的账号管理能力接进糖包，**特别是登录自己的豆包账号后，用糖包现在的生图方式出图**

---

## 0. 结论

**一句话：现在接不了「出图」—— 它不是"账号池"，它是「豆包网页版的视频生成调度服务」。账号管理只是它为了实现视频生成而附带的能力。**

三条分开说：

1. **登录态不能跨应用复用。** 它每个账号的登录态存在 `persist:doubao_account_001` 这类 Electron partition 里，而 partition 的存储位置由 **userData 目录**决定。它的 userData 是 `%APPDATA%/doubao-account-manager/`，糖包的是 `%APPDATA%\糖包`。糖包进程 `session.fromPartition('persist:doubao_account_001')` 只会去**糖包自己的** `Partitions/` 下找一个空目录 —— 拿不到它已存好的 Cookie。**要复用"我已登录"这个事实，只能让它在旁边常驻跑（现状），或者把执行器搬进糖包、让用户在糖包里重新登录一次。**

2. **通道能对上，几乎逐字段吻合。** 糖包的「自定义服务商」是一套通用 HTTP 契约（提交 → 拿 taskId → 轮询 → 取图片 URL），账号池的本地接口恰好是同一形状：Bearer 鉴权、multipart 传参考图、返回 `requestId`、状态 `accepted/running/success/failed`。字段名甚至天然对上（`referenceImage`）。**糖包侧理论上零代码改动。**

3. **缺口只有一个，但是决定性的：账号池只产出视频。** 它的对外成功结果只有 `cleanVideoUrl`（MP4 地址）和 `outputVideoPath`（本地 .mp4），模型枚举只有 `seedance_2_0_mini` / `seedance_2_0_fast` 两个视频模型，`ApiRequest` 表里没有任何图片字段，`page-state` 里没有任何图片判定 —— **图片生成这条链路在它代码里一行都没有。**

→ **要做，先改的是它，不是糖包。** 这不是"接一下"，是在对方项目里新写一个功能，然后再接。

**另一个必须先看的判断：糖包已经能出豆包图了。**

- 代码层：`src/lib/openaiCompatibleImageApi.ts:528` 的 `/doubao|seedream|seededit/i` → `callArkImageApi`，按方舟形状发请求（只发 `model/prompt/size/response_format/watermark:false/image`），2026-10-08 落地并有 5 条测试用例。
- 当前实际链路：挂的是**第三方中转**（`ai-claude-code-hub.jetmobo.com`，`/v1/models` 含 `Doubao-seedream-4.0` / `Doubao-seedream-4.5` / `Doubao-Seedream-5.0-lite` / `Doubao-Seed-2.0-Mini` / `Doubao-Seed-2.0-Pro`），且必须走「自定义服务商」通道 —— 内置 OpenAI 通道会因多发 `output_format` 被中转回 503。

所以现状是：**豆包出图 = 付费 + 依赖第三方中转**（昨天那条「HTTP 503: No available providers」就是中转的锅，与豆包无关）。

**账号池路线要换掉的正是"第三方中转"这一环** —— 用你自己的豆包账号替代它。这个动机是成立的：见 §6.7 对两类稳定性风险的对比。但它**不解决"要花钱"以外的技术问题，反而新引入一类技术问题**（网页自动化的失效频率见 §6.6）。

---

## 1. 对方是什么：核心功能

README 与 `CHANGELOG.md`（0.1.0 → 0.1.30）一致指向四件事：

1. **多账号隔离登录**：每个账号一个固定 `persist:` partition，Cookie / LocalStorage / 缓存互不混用，关掉软件登录态保留。
2. **本地 HTTP 接口服务**：默认 `http://127.0.0.1:17888`，Bearer 鉴权，收外面的生成请求。
3. **账号池调度**：自动挑"已登录 + 空闲 + 额度够"的账号，在豆包网页里跑任务。
4. **只把真实 MP4 交出去**：等视频完成 → 复制豆包分享地址 → 调第三方去水印服务 → 校验确实是可播放 MP4 才返回 `success`。

它自己明确声明**不是**视频模型、**不是**另一个豆包客户端（`docs/USER_GUIDE.md` §1），也没有自动注册 / 验证码绕过 / 风控规避。

**它的能力边界（原文）**：

> 只有真实 MP4 才是最终结果。无限画布不应接收或保存 `doubao.com/chat/...`、`doubao.com/thread/...` 分享页面。

> 模型只能使用：`seedance_2_0_mini`、`seedance_2_0_fast`

> 当前接口没有独立的时长、画面比例字段。

---

## 2. 登录与会话管理机制

### 2.1 隔离方式：Electron partition

- 加账号时自动建独立分区，形如 `persist:doubao_account_001`（`docs/USER_GUIDE.md` §3）。
- `persist:` 前缀 = 落盘的持久会话；同一分区内 Cookie / localStorage / 缓存 / 登录态完全隔离。
- 手动把一个账号的 Cookie 拷给另一个账号是被明确劝阻的（手册 §3）—— 说明它靠分区而非 Cookie 复制来隔离身份。

### 2.2 登录态怎么判断

`electron/types.ts` 里两套状态分离：

```ts
export type LoginStatus = "unknown" | "logged_in" | "logged_out";
export type AccountRuntimeStatus = "idle" | "busy" | "error" | "login_required";
```

- 用户点「检测」触发一次判定，结果写进 `Account.loginStatus`。
- 执行中若发现掉登录，置 `login_required` 并且**不被通用失败处理覆盖成空闲**（0.1.14 修复项）。
- 判定依据是**页面内容**，不是 Cookie 探针（详见 §2.4）。

### 2.3 额度记账：本地账本，不是豆包真实余额

| 项目 | 默认值 | 配置项 |
| --- | ---: | --- |
| 每日总额度 | 10 | `dailyQuotaLimit` |
| Mini 单次消耗 | 2 | `miniCost` |
| Fast 单次消耗 | 3 | `fastCost` |
| 重置时间 | — | `dailyResetTime` |

手册原文提醒：**界面额度是本地调度账本，不是豆包官方实时余额**。用户在网页上手工生成过，本地不会知道。豆包回「额度未扣除」时会自动退回预扣（0.1.14）。

### 2.4 会话内怎么执行任务：纯页面 UI 自动化

这是最关键的一条。`electron/doubao-page-state.ts` 整个文件都是**页面文本正则 + 剪贴板校验**，没有一行后端 API 调用：

- 判完成：`isDoubaoGenerationComplete()` 匹配 `/你的视频(?:已经|已)?生成好[了啦]|视频...生成(?:完成|成功).../`
- 只认新增：`hasNewGenerationCompletion(currentText, baselineText)` —— 数"完成文案"出现的次数比基线多才算，避免被历史对话骗
- 取结果：`getNewDoubaoVideoUrls(currentUrls, baselineUrls)` —— 从页面抓新增的、非 doubao.com 域名的视频资源 URL
- 防误判：`isGenerationReadyForShare()` 明确注释"**完成文案本身永远不足以判定可以分享**"，必须同时看到本次任务的新视频卡片
- 抽地址：`extractDoubaoShareUrl()` 正则抓 `doubao.com/(thread|chat|share)/xxx`
- 清障碍：`isDoubaoDesktopDownloadPrompt()` 认「下载电脑版 / 使用完整功能 / 下次提醒我」弹窗
- 认失败：`extractDoubaoFailureMessage()` 匹配侵权/违规/额度用完/生成失败
- 提示词改写：`isDoubaoPromptRewritePage()` 识别豆包把提示词改写成"完整 N 秒视频生成指令"

`CHANGELOG.md` 逐条印证这条技术路线（0.1.14 → 0.1.30 几乎每个版本都在修页面适配）：

- 「提示词填入改为多策略兜底：普通输入、**剪贴板粘贴**和 **DOM 输入**，并校验输入框确实包含本次提示词签名」
- 「适配豆包当前视频卡片的**图标式分享工具栏**，支持**原生点击、DOM 兜底和剪贴板结果校验**」
- 「兼容豆包使用 `video_dsz_watermark` 图片作为视频封面的页面结构」
- 「分享入口优先限定在当前视频卡片内，避免误点页面顶部的对话级分享」

**结论：它是「开一个浏览器窗口，模拟人操作豆包网页」，不是「调豆包接口」。** 所以它对外能提供什么，完全取决于它能从页面上"看见"什么。

### 2.5 并发模型

`electron/account-scheduler.ts`（全文 60 行）：

- 队列 FIFO，`enqueue` 对同 `key` 去重
- **同一账号绝不同时跑两个任务**（`activeAccountIds` 去重）
- 不同账号可并行，上限 = `maxConcurrentAccounts`（旧版默认 1，0.1.13 一次性迁移为 4）
- 手册补一句：运行期间用户别手工操作那个豆包窗口，会干扰自动操作

### 2.6 对外接口契约（`docs/API.md`）

| 接口 | 说明 |
| --- | --- |
| `GET /health` | 免鉴权 |
| `GET /api/accounts` | 查账号 |
| `POST /api/generate` | 提交视频生成；字段 `prompt` / `model` / `referenceImage`(文件) / `referenceImagePath` / `referenceImageUrl` / `callbackUrl` / `source` |
| `GET /api/requests/:requestId` | 查状态 |
| `POST /api/requests/:requestId/retry-result` | 只重找历史结果，不重新生成、不重复扣额度 |
| `POST /api/watermark/parse` | 单独送去水印解析 |

成功响应**只**含视频字段：

```json
{ "requestId": "...", "status": "success", "model": "seedance_2_0_mini",
  "cleanVideoUrl": "https://.../video.mp4", "outputVideoPath": null }
```

---

## 3. 与糖包的架构与依赖差异

| 维度 | 糖包 | 豆包账号池 |
| --- | --- | --- |
| 版本 / 包名 | `tangbao` 0.5.1 | `doubao-account-manager` 0.1.30 |
| 渲染层 | **React 19** + Zustand + Tailwind/`ds-*` 设计系统（178 个 tsx） | **Vue 3**（单个 `App.vue` 42KB，无状态库） |
| 主进程 | 60+ 文件：ipc-guard / asset-kernel / catalog 迁移 / 导出 / asset-api-server / MCP / 崩溃恢复 | **8 个文件**：main / executor(79KB) / database(26KB) / watermark / account-scheduler / page-state / types / public-api |
| 存储 | SQLite `node:sqlite`（Node 24 `DatabaseSync`）+ `app_data_records` 键值表 + 素材库文件树 + catalog | `better-sqlite3`（原生模块，`asarUnpack: **/*.node`） |
| Electron | **43** | **36** |
| 构建 | Vite 6 + electron-builder 26 + vite-plugin-electron + fuses 加固 + 签名 + electron-updater | Vite 6 + electron-builder 25（无自动更新、无 fuses） |
| 运行形态 | 单窗口桌面应用（生产 `loadFile` + 严格 CSP） | **GUI 控制台 + 常驻本地 HTTP 服务(17888) + 隐藏执行窗口** |
| 核心能力 | 生图（SOP / 系列 / 后处理 / 素材库 / 分发）+ 本地图转视频引擎 | **只做豆包网页版视频生成调度** |
| 第三方依赖 | `@fal-ai/client`、react、zustand、xlsx、electron-updater、react-markdown… | `better-sqlite3`、`electron-log`、`vue` —— **仅 4 个运行时依赖** |
| 网络模型 | **纯 HTTP API 调用**（fal / OpenAI 兼容 / 火山方舟 / 自定义服务商），无任何网页自动化 | **纯网页 UI 自动化**，无任何官方 API |

**一句话差异：糖包是"带着一堆 API Key 去调云服务"，账号池是"开着浏览器假装人点"。两条技术路线没有共享代码的可能，只有接口层面的对接。**

---

## 4. 核心问题：登录我的账号后，能不能复用糖包的生图方式出图

拆成三层回答。

### 第一层：登录态能不能拿来用 —— **不能直接复用**

- partition 的物理位置 = `<userData>/Partitions/<name>`。它的 userData 是 `%APPDATA%/doubao-account-manager`，糖包的是 `%APPDATA%\糖包`。
- Electron 的 `session.fromPartition()` 只在自己进程的 userData 下解析，**跨进程、跨应用拿不到**。
- 唯一"干净"的复用方式：**让它常驻当服务**（就是它现在的形态），糖包只发 HTTP，从头到尾不碰 Cookie。
- 想在糖包进程内做，就必须把执行器搬过来，**partition 从空开始 → 用户得在糖包里重新登录一遍**。不存在"白嫖账号池里已存的登录态"这种捷径（除非去读它的 partition 文件 + 导出 Cookie 再注入，这既脆弱又涉及跨应用搬运登录凭据，不建议）。

### 第二层：通道能不能对上 —— **能，几乎零成本**

糖包 `src/types.ts:39-74` 的「自定义服务商」契约：

```ts
export interface CustomProviderDefinition {
  submit: CustomProviderSubmitMapping      // path/method/contentType(json|multipart)
                                            // /body/files[{field,source:'inputImages'}]/taskIdPath
  editSubmit?: CustomProviderSubmitMapping
  poll?: CustomProviderPollMapping          // path(支持 {task_id})/intervalSeconds
                                            // /statusPath/successValues/failureValues
  result: CustomProviderResultMapping       // imageUrlPaths[] / b64JsonPaths[]
}
```

对应到账号池的接口，逐项都命中：

| 糖包需要的 | 账号池提供的 | 是否吻合 |
| --- | --- | --- |
| 鉴权头 | `createRequestHeaders()` 统一发 `Authorization: Bearer <apiKey>`（`openaiCompatibleImageApi.ts:100`） | ✅ 与 17888 的鉴权方式一致 |
| multipart 参考图 | `contentType: 'multipart'` + `files:[{field:'referenceImage', source:'inputImages'}]` | ✅ 字段名正好是 `referenceImage` |
| 拿任务号 | `taskIdPath: 'requestId'` | ✅ 响应里就是 `requestId` |
| 轮询 | `path:'/api/requests/{task_id}'`、`statusPath:'status'`、`successValues:['success']`、`failureValues:['failed','stopped']` | ✅ 状态机逐字对上 |
| 取结果 | `result.imageUrlPaths: [...]` | ❌ **账号池返回里没有图片字段** |

而且糖包的取图实现是宽容的 —— `extractCustomImages()`（`openaiCompatibleImageApi.ts:919`）支持**多路径、多张图**，会把 URL 拉成 data URL 存下来：

```ts
const imageUrls = (result.imageUrlPaths ?? []).flatMap((path) =>
  getAllByPath(payload, path).filter((v) => isHttpUrl(v) || isDataUrl(v)))
```

**唯一对不上的就是最后一行。** 拿不到图片时它会抛：

> 接口没有返回可识别的图片数据，请查看原始响应内容确认接口实际返回的数据结构……

### 第三层：能不能出图 —— **不能，因为它压根没有图片能力**

证据（四处独立互证）：

1. **模型枚举**（`electron/types.ts`）：`type DoubaoModel = "seedance_2_0_mini" | "seedance_2_0_fast"` —— 两个都是视频模型。
2. **数据表字段**（`electron/types.ts` 的 `ApiRequest`）：只有 `doubaoThreadUrl` / `rawVideoUrl` / `cleanVideoUrl` / `outputVideoPath` —— **零图片字段**。
3. **页面状态机**（`electron/doubao-page-state.ts`）：全篇是视频完成文案、视频卡片、视频分享面板 —— **零图片判定**。
4. **全部更新日志**（0.1.0 → 0.1.30）：从"提供本地生成接口"到"稳定生成视频分享恢复"，**没有一条涉及图片**。它连"取视频封面图"都是顺手兼容（`video_dsz_watermark`），而不是一项能力。

**所以：账号池对外的成功语义就是"验证过的 MP4"。糖包的生图链路要的是图片 URL / base64。中间那个转换不存在，也没有"降级"的空间 —— 视频不是图片。**

---

## 5. 接入所需的关键改动点

### 路线 A：账号池侧新增图片链路，糖包只用自定义服务商对接（推荐）

**改动全在账号池，糖包侧只加一条配置。**

账号池侧（估算这是主要工作量）：

1. **新增 `electron/doubao-image-page-state.ts`**：一套图片版的页面判定 —— 怎么认"图片生成完成"、怎么定位"本次任务新增的图片"（豆包是对话式返回图片卡片，判定特征与视频不同）、怎么认图片生成失败文案。
2. **`executor.ts` 新增图片执行流程**：选图片生成入口（不是 Seedance 视频技能）→ 填提示词 → 上传参考图 → 等图片卡片 → 取图片。
3. **解决无水印原图**。这是最不确定的一环：它的视频靠**第三方去水印服务**处理（`electron/watermark.ts` + `watermarkApiUrl`）；图片同理需要一条"取原图"的路子 —— 可能是 CDN 上的 watermark 变体换参数，也可能是新的第三方接口。**必须实测确认**，不能假设。
4. **新增接口** `POST /api/generate-image` + `GET /api/image-requests/:id`，状态机沿用 `accepted/running/success/failed`，成功时返回 `imageUrls: string[]`。或者给 `ApiRequest` 加 `kind: 'video'|'image'` 与 `imageUrls`。
5. **额度模型**加图片的计费规则（现在只有 `miniCost`/`fastCost` 两个视频口径）。
6. **失败语义保持一致**：只有拿到"验证过的可用图片"才返回 `success`，否则 `failed`。

糖包侧（**零代码**，只加配置）：

| 配置项 | 值 |
| --- | --- |
| baseUrl | `http://127.0.0.1:17888` |
| apiKey | 账号池里配的 API Key |
| submit.path / method / contentType | `/api/generate-image` · `POST` · `multipart` |
| submit.files | `[{ field: 'referenceImage', source: 'inputImages', array: true }]` |
| submit.taskIdPath | `requestId` |
| poll.path | `/api/image-requests/{task_id}` |
| poll.statusPath / successValues / failureValues | `status` · `['success']` · `['failed','stopped']` |
| poll.result.imageUrlPaths | `['imageUrls']` 或 `['data.items[].url']` 等 |

⚠️ 一个接入细节：糖包生产环境是 `loadFile` + 严格 CSP，**渲染进程直连 `127.0.0.1:17888` 会被 `connect-src` 拦**。自定义服务商配置里的 `apiProxy` 开关（走主进程转发，糖包已有 `api-transport.ts` 这层）应当打开。这一条不用改代码，但配置时容易踩。

### 路线 B：把执行器搬进糖包（不推荐）

需要移植 `executor` + `page-state` + `account-scheduler` + `database` 四块，还要：

- partition 重落到糖包 userData → 用户重新登录
- `better-sqlite3`（原生模块，ABI 绑 Electron 版本）要么按 Electron 43 重编、要么改写成糖包现有的 `node:sqlite` 存储 —— 后者是重写
- 渲染层要新写一套 React 账号管理界面（对方是 Vue）
- 主进程要新增"豆包执行窗口"的生命周期管理（糖包目前只有主窗口 + 额外服务进程）
- 单实例锁 / 端口 / 素材库 CWD 都要重新规划

**这不是"接入"，是把一个网页自动化项目并进糖包，并让糖包从此背上豆包改版就发版的包袱。**

---

## 6. 潜在冲突与限制

**技术层**

1. **原生模块 ABI**：`better-sqlite3` 按 Electron 版本编译。糖包已经用 Node 24 的 `node:sqlite` 绕开了原生模块（记忆：`vite build` 必须 Node 24，Node 22 报 `DatabaseSync` 未导出），引入 `better-sqlite3` 是**倒退**，且要在 fuses / asarUnpack 流程里额外处理 `*.node`。
2. **Electron 36 → 43**：`executeJavaScript` / `session` / `webContents` 大体兼容，但豆包页面对 UA / 指纹敏感，换 Electron 大版本很可能改变页面行为，等于把对方已验证过的适配重新踩一遍。
3. **端口与单实例**：账号池固定 17888，糖包 dev 固定 41731 且有单实例锁；两边各自独立运行时没问题，一旦要合并，端口规划与"糖包自己已有 asset-api-server"要一起安排。
4. **CSP**：见 §5 的 ⚠️。主进程发起请求不受限，渲染进程受限。
5. **两套额度体系**：糖包按 API 用量/成本，账号池按"点"本地记账，合并后口径要重新设计。

**稳定性层（这才是大头）**

6. **页面自动化天然脆弱，但"风险性质"未必更差 —— 这条要单独看。** 对方的 `CHANGELOG` 显示 0.1.14 → 0.1.30 十来个版本里，绝大部分是**豆包改页面、它跟着改**（换分享按钮位置、加弹窗、改完成文案、视频封面结构变化……）。接进糖包意味着**豆包的每次改版都会变成糖包的线上故障**。

   但把两类风险摆在一起看，结论没那么单向：
   - **现在的痛点**：中转是黑盒。它 503 时你只能等，连真因都看不到（它把自己的问题翻译成「所有供应商暂时不可用」这种误导文案）。
   - **账号池路线的真实优势**：豆包改版时**你自己能修** —— 照着 `page-state.ts` 调正则和选择器，主动权在自己手里。这是这条路唯一站得住的优点，不能一笔抹掉。
   - **代价**：把「低频、不可控、等得起」的风险（中转偶发 503）换成「高频、必须即时响应」的风险（豆包改版当天出图链路全断）。对方的发版节奏就是这条风险的实测频率 —— **平均不到两周就要跟着页面改一次**。
   - **折中方案**：别二选一。账号池做成糖包的**第二服务商**（自定义服务商天然支持多套），日常走中转，中转挂了临时切过去，两类风险互相兜底。
7. **语义上的硬限制**：账号池按 `requestId` 区分任务、靠页面文案确认完成。这类"看页面说话"的判定**没有 API 级别的确定性**，批量出图（糖包的核心场景是 SOP 批量/系列出图）时失败率与重试成本都会明显高于当前 API 链路。
8. **并发上限低**：单账号串行，每日额度按账号数×10 点线性叠加。糖包现在的批量出图是**按并发打 API** 的节奏，接到账号池上会被硬压成"一个账号一次一张"。

**合规与边界层**

9. **技术路线与糖包现状冲突**：糖包现有全部通道都是**官方/授权 API**（fal、OpenAI 兼容、火山方舟）。接入网页版自动化会引入一类性质完全不同的依赖 —— 而且它是**绕开官方计费的免费额度**，对方 README 也专门写了"使用边界"。这条要你自己拍板，我只把事实摆在这里。
10. **许可证**：仓库 README 未声明开源许可证。**严格说没有许可证 = 默认保留所有权利**，直接搬运其代码（哪怕是我方重构）存在法律上的不确定性。若只做接口对接（各跑各的进程）风险低得多。

---

## 7. 建议

**先说最省事的一条：如果目标只是「用豆包出图」，糖包已经有了 —— 挂第三方中转走自定义服务商就行，完全不用碰账号池。** 成本是明的（按量付费），代价是受制于中转（昨天那条 503 就是）。

**但如果你的真实痛点其实是「不想再被别人家的中转卡住」，那账号池这件事值得认真看** —— 它换掉的是供应链，不是技术方案。这时按下面的顺序走：

**如果你确实要拿豆包网页版的免费额度出图**，我的排序：

1. **先花 30 分钟做一个"可能性验证"，再谈任何代码**：拿一个已登录的豆包窗口，手工用它的图片生成功能出一张图，在页面上确认**能不能取到无水印原图**（DOM 里的图片真实地址、有没有下载入口、地址是否带 watermark 参数）。这一步过不了，后面全白干。
2. **验证通过 → 走路线 A**，且**只在账号池里加图片能力**，糖包保持"消费者"角色不动代码。这样两边解耦：豆包改版只改账号池，糖包不受影响。
3. **不要走路线 B**。把网页自动化并进糖包，等于用一个我们无法控制的第三方页面结构，绑架糖包的发布节奏。
4. **无论走哪条**，都建议在糖包里保留 API 通道作为默认，把账号池做成**可选的第二服务商**（自定义服务商天然就是这个形态），别让它成为主链路。

---

## 附：本次评估的证据与边界

**已核对（可直接复查）**

- 对方仓库：`README.md`、`CHANGELOG.md`、`docs/API.md`、`docs/USER_GUIDE.md`、`package.json`、`electron/types.ts`、`electron/account-scheduler.ts`、`electron/doubao-page-state.ts`、完整文件树
- 糖包：`src/lib/api.ts`、`src/lib/openaiCompatibleImageApi.ts`（含 `callArkImageApi` / `createRequestHeaders` / `extractCustomImages` / `submitCustomRequest` / `pollCustomTaskResult`）、`src/types.ts`、`src/lib/apiProfiles.ts`、`package.json`、`electron/main.ts`（部分）
- 糖包侧「豆包出图现状」的证据：`.workbuddy/memory/2026-10-08.md`（本机记录，含中转实测与 503 根因）

**未核对（受限，结论不受影响）**

- 对方 `electron/executor.ts`（79KB）与 `electron/main.ts`（23KB）：抓取工具对单文件有大小上限，未能逐行读。但 §4 第三层的结论由**四处独立证据互证**（模型枚举 / 数据表字段 / 页面状态机 / 全部更新日志），不依赖对 executor 的逐行阅读。
- 对方 `electron/watermark.ts` 与去水印服务的具体协议未读；图片去水印是否可行属**未验证假设**，已在 §5 标为最不确定环节。
- 网络说明：本机 `git clone` 与 `gh api` 均不可用（代理返回 502、GitHub 直连超时、`gh` 凭据 401），本报告经由网页抓取通道获取资料，因此无法核对 git 历史细节。
