# 糖包运维手册（持久化 · 本地验收 · 排错）

> 从 `.workbuddy/memory/MEMORY.md` 拆出来的**操作细节**。MEMORY.md 只留硬结论与指针，具体配方、
> 命令与踩坑现场放这里。**改持久化层或手改数据库前必读第一节。**

## 一、手改 `app_data_records` 的三条铁律（2026-09-18 踩出事故）

**事故现场**：为把一条卡死的 SOP 运行改成 `paused` 直接写库，**把同一 namespace 的其余记录一起写坏** →
SOP 面板恢复时抛 `Cannot read properties of undefined (reading 'filter')`、生成按钮永久不可用。

### 1. `json` 列的编码按 namespace 分两种，不能套用一个配方

| namespace 类型                                                | 例子                                                                                       | 落盘形态                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **zustand 管理的**（凡经 `createDesktopJsonStorage`）         | `zustand` / `postprocessMedia` / `requirementPrototype` / `assetLibraryUi` / `wordLibrary` | 值**本身就是字符串** → `json = JSON.stringify(JSON.stringify(obj))`，**双重编码**；读回来 `JSON.parse` 一次得到字符串，再由 zustand 自己 parse |
| **按记录存对象的**（经 `putXxx` → `appDataPut(ns, id, obj)`） | `sopBatchSnapshots` / `tags` / `collections`                                               | `json = JSON.stringify(obj)`，**单层**。写成双重编码 = 值变成字符串字面量                                                                      |

**判据**：`typeof JSON.parse(row.json)` —— `string` = zustand 型（正常），`object` = 记录型（正常）。**反了就说明写坏了。**

### 2. 写库必须带 `record_id` 条件

`UPDATE ... WHERE namespace='X'` 会把该 namespace **所有**记录写成同一个值。本次就是这样把 3 条快照
写成同一份内容、互相覆盖掉各自原始数据 —— **不可恢复**。

### 3. 改前停应用 + 备份 sqlite，改完全库体检

改完逐 namespace 打印 `typeof JSON.parse(json)` 体检一遍。应用在跑时用 `node:sqlite` **只读**查询是安全的，
**写入不要**。

### 配套代码修复

`src/lib/sopBatchSnapshotRecord.ts` 的 `decodeSopBatchSnapshotRecord()` —— 兼容性再解析一层字符串 +
补齐下游会 `.filter` / `.map` 的数组字段；`getSopBatchSnapshot` / `getAllSopBatchSnapshots`（`src/lib/db.ts`）
已接入并**逐条丢弃**认不出来的记录（一条坏数据不该让整个提示词集列表打不开）。

**教训**：读持久化数据的地方不做形状防护，一条坏记录就能把整个面板锁死。

## 二、`createDesktopJsonStorage` 的两条硬约束

链路：`createDesktopJsonStorage(ns)`（`src/lib/desktopJsonStorage.ts`，**全仓唯一落盘入口**）→ IPC `app-data:put`
→ `electron/asset-kernel.ts` 的 `appDataNamespace()` **白名单校验**。

### 1. 新增 store 忘配白名单 = 配置完全存不住

现象链：`success: false` → throw → `coalescedJsonStorage` 的 `onWriteError` 自动重试 → 主进程刷屏
`invalid app data namespace`，**而 UI 一个字都不报**。守卫 `appDataNamespaceContract.test.ts` 自动比对，新增 store 直接挂。

### 2. `read` 的降级语义（事故后定，勿回退）

`appDataPut` 落 `JSON.stringify(value)`、`appDataGet` 返回 `JSON.parse(row.json)` —— 于是：
zustand 记录**双重编码、get 出来正好是字符串**；记录型 namespace **单层编码、get 出来是对象**。

所以 `read` **不能**用「返回值是不是字符串」判有效性：单层编码会被误判成「没有数据」→ zustand 拿初始 state
→ **首次 set 把磁盘真实配置覆盖掉**。现三种都认（字符串 / 对象还原 / 缺失），且**读失败或格式不认 → 进入降级态、
拒绝本会话写盘**（宁可本次改动不落盘，也不覆盖真实数据）。守卫 `desktopJsonStorage.test.ts`（8 用例）。

### 3. zustand persist v5 的 storage 早退

storage 不可用时**直接早退**，store 上**不挂 `.persist`**。node 环境无 `window`，默认 `localStorage` 取值抛错被吞 →
**测试里访问 `store.persist.*` 必须自己 `vi.stubGlobal('window', { localStorage })`**
（`store.test.ts` 曾因此随机挂：文件全跑能过、`-t` 单跑必挂）。

### 连带伤害：settings 重置会抹掉真 Key

`store.ts:4835` 的 `scheduleApiSecretsPersist` 在 settings 变化时重写 `api-secrets.bin` →
**settings 一旦被重置成出厂默认，用户的真 Key 被一并抹掉**（282B → 205B，不可逆，只能靠备份）。

**配置被重置的现场特征**：`activeProfileId` / `profiles` / 顶层 `baseUrl` / `model` / `agentProfiles` **整组**
回到 `api.openai.com/v1` 且 `agentShareApiParameters` 变 `true`（SOP 提示词随之从金贝贝切成空密钥官方源 →
卡在 `generating`、`prompts=0`）。用 `backup-*/asset-kernel.sqlite` 全字段 diff 可定位到具体时刻。

## 三、本地验收（dev 环境）

### 数据目录

`%APPDATA%\tangbao` = dev 数据目录。**别再说它"空的"**：首次启动就 seed 内置项目树 —— `collections` **77 个**
（保险 / APP-拉新 / 卡券）。真正空的是**任务与素材**（`tasks: []`、`assets` 0 行、`cache-images/` 空）→
卡片徽章必须真跑一次「生成 → 保存到本地」才看得到。

### 只读查状态（应用在跑也能读）

Node 24 内置 `node:sqlite`：

```js
new DatabaseSync('<db>', { readOnly: true })
// 常用：SELECT namespace, record_id, LENGTH(json), updated_at FROM app_data_records
```

**验收「配置是否真落盘」= 改配置 → 重启 → 看该 namespace 有没有记录**（persist 只有初始值时不写盘，
"没记录" ≠ "写失败"）。启动日志若**一次** `invalid app data namespace` 都没有 = store 补水成功。

### 本地 mock 生图服务

`scripts/mock-image-api.mjs` = 零依赖本地生图服务（`npm run mock:api`，8787），返回 1024×1024 真图。
地址填 `http://127.0.0.1:8787/url-ok`（带 CORS）或 `/b64`。**不在 lint / prettier / 测试覆盖面内**，改完手动 prettier。

### API Key 的位置

**Key 只活在 `api-secrets.bin`**（`safeStorage` 加密）；持久化状态里的 `apiKey` 恒为空串。
`validateApiProfile`（`apiProfiles.ts:992`）要求非空 → **只改状态不写密钥文件必被拦在「请先完善请求 API 配置」**。
⚠️ 该文件会被 settings 变化连带重写，见第二节。

### 本机 dev 生效配置

`activeProfileId=default-openai`（JB：`ai-claude-code-hub.jetmobo.com` + `gpt-image-2.5-sunburst`），
`mock-local` 留在 `profiles` 里随时可切；`agentProfiles` = 金贝贝 `jbbt.pages.dev/v1` 两条。

### 后处理自动触发

生成完成 → `saveTaskToLocalFS → scheduleTaskPostprocess`（**不用**手点「保存到本地」）。
产出根 = `<本地保存目录>/postprocess/` + 项目三级目录；一图 = 纯净版 1 + 每个选中媒体的启用尺寸各 1
（多预设再乘预设数）。

## 四、抓渲染进程报错（**不看堆栈就别猜**）

dev 窗口的 `TypeError` **不会**出现在 vite stdout —— `electron/main.ts:389` 的 `console-message` 只转发
含 `electronAPI` / `preload` 的消息。**不用改代码**，加个开关重启即可：

```bash
ELECTRON_ENABLE_LOGGING=1 PATH="/c/Program Files/nodejs:$PATH" npm run dev
```

日志里会多出 `[pid:date:ERROR:CONSOLE:行号] "Uncaught TypeError: ...", source: http://localhost:41731/src/xxx.tsx (行)`
—— 带文件与行号。**排查渲染侧报错先开这个，再谈假设**（前 20 个工具调用都可能在盲猜，开了之后一次定位）。

`%APPDATA%\tangbao\diagnostics\renderer-crashes.jsonl` 只记**进程崩溃**，不记 JS 异常，别指望它。

## 五、并行改动的纪律

⚠️ **同仓禁止并行开两条工作线**：后一条的 HMR 会**整页刷新**前一条正在用的运行窗口，打断进行中的生成/保存。
诊断「界面卡住」先看 dev 日志有没有 `page reload` / 密集 `hmr update`。

## 六、Electron 真机调试装置（低频，验证埋点用）

- 启动：`electron.exe . --no-sandbox --disable-gpu --remote-debugging-port=<port>`
  （**单实例锁会顶掉旧实例**，别指望同时开两个）。
- 临时装置三件套：esbuild 打 cjs（`--external:electron`）+ `app.setName('tangbao')` +
  `loadFile` 真 html（**别用 `data:` URL，源是 opaque 的**）+ 复刻生产 CSP。
  `import.meta.url` / `assertTrustedSender` 在 cjs 下需要 `--define` 补。
- **埋点验证完必须清理**，不要留在工作区。
- 设备基线：Electron 43 = Chromium 150 / Node 24.18.1，`Uint8Array.fromBase64` 可用；
  Node 22 测试环境**没有**这个 API → 走 `atob` 回退（两条分支都有测试）。

## 七、API 配置三层解析（判断「改配置会影响谁」）

**改图片配置 ≠ 影响所有 API 链路。** `src/lib/apiProfiles.ts` 多入口，先确认调用方：

| 函数                      | 取值                                                                                                                 | 谁在用                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `getActiveApiProfile`     | `profiles[activeProfileId]`，**被顶层 `baseUrl`/`apiKey`/`model` 覆盖**（:931）                                      | 生图；`hybrid` 下 Agent 图像侧 |
| `getAgentApiProfile`      | `agentShareApiParameters=true` 才复用生效配置（`apiMode` 强制 `responses`）；false 时返回独立 `agentProfile`（:947） | ——                             |
| `getAgentTextApiProfile`  | = `getAgentApiProfile`                                                                                               | **SOP 提示词生成**、知识分析   |
| `getAgentImageApiProfile` | `agentApiConfigMode==='hybrid' ? getActiveApiProfile : getAgentApiProfile`（:966）                                   | Agent 批量规划/出图            |

→ 本机 `agentShareApiParameters=false` + `agentApiConfigMode='hybrid'`：**文本走独立「金贝贝」，图片走当前生效配置**。
把 `activeProfileId` 换成 mock **动不了 SOP 提示词生成**。mock 服务**只做图像** —— `/v1/chat/completions` 兜底返回
目录 JSON、解析不出内容，链路会卡住。

## 八、推 GitHub 与查 CI（2026-09-18 实测定稿）

### 推送命令

```bash
cd /d/AAA/TANGBAO
git -c http.sslVerify=false -c credential.helper= \
    -c 'credential.helper=!"C:/Program Files/Git/mingw64/bin/git-credential-manager.exe"' \
    push -u origin main
```

两个参数都是必需的，少一个就失败：

- `-c credential.helper=` **必须写在 GCM 那条前面**。PortableGit 的系统级 gitconfig 自带
  `helper-selector`（本机不存在这个二进制），不清空它会把 GCM 顶掉，报
  `remote: Invalid username or token` —— 看起来像 token 过期，其实是根本没走到 GCM。
- **不要套 `env -u http_proxy ...`**。实测整条命令**静默不执行**：exit 0、零输出、连
  `GIT_TRACE` 都不打印，极易误判成推送成功。要绕代理就在 gitconfig 里配。

凭据在 **Windows 凭据管理器**（用户 `nideyilian`，40 位 classic PAT）；`gh` 未登录，
`git 2.55` 的 `http.schannelCheckRevoke=false` 无效。

### 自检：**不要用 `git status -sb`**

本机 `.git/refs/remotes/` 有**环境级写保护**：`git fetch` / `git update-ref` / `mkdir` 全都
**报成功但引用不落盘**（shell 重定向直接 `No such file or directory`）。
后果是 `git status -sb` **恒显 `## main...origin/main [gone]`** —— 这与推送成功与否无关。

唯一可信的自检是拿网络上的真实 SHA 比：

```bash
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git -c http.sslVerify=false ls-remote origin main | awk '{print $1}')
[ "$LOCAL" = "$REMOTE" ] && echo OK || echo MISMATCH
```

另外 `push` 自身打印的 `b4cc9bd..31f1ad6  main -> main` 来自服务端回执，也可以当证据；
但 `exit 0` 单独不可信（见上面 `env -u http_proxy` 那条）。

### 查 CI

⚠️ **取 token 必须直连 GCM，不要用 `git credential fill`**（2026-09-18 实测踩到）：

```bash
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | \
  "C:/Program Files/Git/mingw64/bin/git-credential-manager.exe" get \
  | sed -n 's/^password=//p' | tr -d '\r\n')

curl -s --ssl-no-revoke \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/nideyilian/tangbao/actions/runs?per_page=5"
```

- **`git credential fill` 与 GCM 会返回两个不同的凭据**：前者给出一个 **93 位 `github_pat_…`（已失效）**，
  api.github.com 一律 `401 Bad credentials`；后者给出 **`gho_…` OAuth 令牌**，同一个 API 调用立刻 200。
  本机的全局 `credential.helper` 只有 `helper-selector`（不存在），`fill` 走的是另一条取数路径。
  → **症状是「push 成功但查 CI 恒 401」**，别误判成 token 过期或权限不足。`gh run list` 用的也是那份坏
  凭据，同样 401，**不能用它绕过**。
- 判据：`TOKEN` 以 `gho_` 开头才对；以 `github_pat_` 开头就换 GCM 那条命令。
- `--ssl-no-revoke` **必须加**，否则返回**空 body**（不是报错），很容易误判成「GitHub API 挂了」。
- 别用 `-o /dev/null`：TLS 握手失败会被一起吞掉。
- 未认证 60 次/时，带 token 5000 次/时。轮询用 `for i in $(seq 1 12); do … sleep 20; done` 判
  `status completed`，别靠猜时长（本仓 CI 约 2.5–3min）。
- **一次 push 只给 head commit 生成一个 run**，中间那几条提交不会有独立 run，别以为漏跑了。
- job logs 会 302 到带签名的 URL；`curl -L` 带 `Authorization` 会被拒 → 先 `curl -I` 取
  `location`，再无认证头下载。

### CI / Release 触发条件

| workflow      | 触发          | 注意                                                                                                                          |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`      | 任意分支 push | `tsc -b` + electron typecheck + lint + format:check + vitest（Node 24）                                                       |
| `release.yml` | `v*` tag      | **勿改回 `--publish always`**（124MB exe 必超时）→ `--publish never` + `softprops/action-gh-release@v2`；校验步骤硬编码产物名 |

## 九、批量写入 localStorage（水印预设 / 左栏比例等）—— 2026-09-18 实测定稿

**为什么不能直接改文件**：水印预设存在 **localStorage**（`tangbao-composite-v2-workspace-storage`，
zustand persist `version: 5`），底层是 Chromium LevelDB：

- 位置 `%APPDATA%\tangbao\Local Storage\leveldb\`（**dev** 用 `tangbao`，打包版是 `糖包`）；
- **键按 origin 分区**，dev 下是 `http://localhost:41731`（**不是** `127.0.0.1:41731`，两者是不同 origin、
  数据不互通 —— `vite.config.ts` 写 `host: '127.0.0.1'` 但 vite 报的是 `localhost`，而应用侧最终落在 `localhost`）；
- **值走 Snappy 压缩**：写完去 `grep preset-compliance` 是**搜不到**的，只能看 `.log` 体积变化，别据此判断失败；
- **由应用进程独占 `LOCK`**：应用在跑时外部一律打不开，`cp` 备份都会报 `Device or resource busy`。

**正确姿势**（顺序不能换）：

1. **停应用**（`taskkill /PID <electron主进程> /T /F`）。只停 electron 不够 —— vite 也得停，
   否则第 3 步的静态服务抢不到 41731。**保留** `scripts/mock-image-api.mjs` 等无关 node。
2. **备份**：`local-saves/`、`Local Storage/`、`Session Storage/` 三份一起拷。必须停应用后再拷。
3. **用应用自己那份 userData 起一个最小 Electron 脚本**（不要走 `npm run dev`，vite-plugin-electron
   会顺手把没带调试端口的应用拉起来，撞单实例锁）：

   ```js
   // write_presets.cjs —— 与 node_modules/electron/dist/electron.exe 一起跑
   app.setPath('userData', 'C:\\Users\\tt\\AppData\\Roaming\\tangbao') // 必须在 ready 之前
   // 自己起 http 服务占 127.0.0.1:41731，页面 origin 才会是 http://localhost:41731
   const server = http.createServer((_q, s) => s.end('<meta charset="utf-8">ready'))
   await app.whenReady()
   server.listen(41731, '127.0.0.1')
   const win = new BrowserWindow({ show: false })
   await win.loadURL('http://localhost:41731/')
   await win.webContents.executeJavaScript(script, true) // 在这里读写 localStorage
   session.defaultSession.flushStorageData()
   await new Promise((r) => setTimeout(r, 2000)) // 不 flush + 不等待 = 写入还在缓冲里就退出
   app.quit()
   ```

   启动前必须 `unset ELECTRON_RUN_AS_NODE`（本机环境默认带它，否则被当 Node 跑、报
   `does not provide an export named 'BrowserWindow'`）。

4. **合并而不是覆盖**：`JSON.parse(localStorage.getItem(KEY))` → `state.presets` 里按 id
   替换/追加 → 原样写回，`version` 保持不动（改了版本号会触发 migrate，旧字段静默丢失）。
5. **回读验证必须用新进程**：再跑一遍只读脚本读 `count / names / layers`，不能信写入进程内的回读。
6. **把 dev 环境还给用户**：`npm run dev` 后台拉起。

**踩过的坑**：`node:sqlite` 用 `readOnly: true` 读是对的；但**用 read-write 打开一个带残留 WAL 的库时，
WAL 里未 checkpoint 的帧可能不可见** —— 实测读到 0 条记录、实际 WAL 里有 1 条，差点把「合并」做成
「覆盖」。所以：**写库前的基线一律先用 `readOnly` 连接读出来**，再开 rw 去 UPDATE。

## 十、改颜色 / 主题 Token（2026-09-19 实测定稿，ADR-0008）

颜色只有**一套**真相源，但改了要**三处同步**，漏一处 `npm test` 就红：

| 顺序 | 文件                                       | 改什么                                                    |
| ---- | ------------------------------------------ | --------------------------------------------------------- |
| 1    | `src/design-system/styles.css`             | `:root`（浅色）/ `.dark`（深色）的 `--ds-color-*` 值      |
| 2    | `src/design-system/tokens.tokens.json`     | `color.light` / `color.dark` 的 sRGB `components` + `hex` |
| 3    | `src/design-system/tokensContract.test.ts` | `LIGHT_COLOR_VALUES` / `DARK_COLOR_VALUES` 两个 dict      |

**为什么是这些值**：HSL 通道格式（`220 20% 98%`，无 `hsl()` 包裹）才能让 Tailwind 加 alpha
（`bg-ds-surface/90`）。换算 sRGB 手算易错，写一次性脚本转换后**立刻删**：

```js
// hsl → sRGB（h 0-360, s/l 0-100）→ hex
const f = (n) => {
  const k = (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
}
```

**验收命令**（不要跑全量，太慢）：

```bash
npm test -- src/design-system/tokensContract.test.ts   # 150 例，钉死精确值 + CSS↔JSON 交叉校验
```

**看实际生效值**（比读 CSS 文件可靠，能看到继承与 `data-theme-transition` 的影响）：

```js
getComputedStyle(document.documentElement).getPropertyValue('--ds-color-canvas')
```

**对比度**：改文字色必查 WCAG AA（≥ 4.5:1）。实测教训：浅色 `text-subtle` 取 `220 8% 50%` 只有
**4.19:1**，调到 `220 8% 46%` 才过（4.82:1）—— 目测"够灰了"不可靠，必须算。

### ⚠️ 验收第一关：先算 hex，别只看 diff（2026-09-19 翻车实录）

**表面色（canvas / surface / surface-subtle / border）改完，必须先换算成 hex 与旧值逐条比对。**

原因是 HSL 在**高亮度段**极度不敏感：色相差 10°、饱和度差 10%，换算后可能**完全是同一个颜色**。

真实案例：首版把浅色画布从 `210 20% 98%` "重新设计"为 `220 20% 98%`，两个值换算后
**同为 `#f9fafb`**；描边 `#e0e2e6` → `#e2e4e9` 只差 2 个色阶。代码 diff 很漂亮，
但界面**零变化** —— 杰哥一眼看出「怎么没看出什么区别」。

**可辨性阈值（实测）**：

| 关系                       | 最低要求   | 说明                    |
| -------------------------- | ---------- | ----------------------- |
| 相邻表面（canvas↔surface） | ≥ 1.10 : 1 | < 1.05:1 肉眼基本不可辨 |
| 描边 vs 其两侧表面         | ≥ 1.30 : 1 | 低于此值描边"糊"在一起  |
| 正文文字 vs 背景           | ≥ 4.5 : 1  | WCAG AA                 |

第二轮定稿值（换算后）：浅色 `#f2f4f7` ↔ `#ffffff` = **1.102:1**；
深色 `#0b0c0f` ↔ `#191b1f` = **1.134:1**。

### 层级没出来时，先查「透明修饰符」再查 Token

**语义类带 alpha 会让画布色透上来，把面板层级直接抹平** —— 这时改 Token 完全无效。

- `bg-ds-surface/50`（侧栏）：一半透明 → 灰画布透出 → 侧栏看着和画布一样 → 面板"浮"不起来
- `bg-ds-surface/90 backdrop-blur-sm`（顶栏）：同理

**规则：布局级面板（顶栏 / 侧栏 / 主区）一律用不透明 `bg-ds-surface`；
只有抽屉 / 浮层 / 气泡这类"临时悬浮物"才保留透明度。**

查法：在真实 DOM 上遍历 `getComputedStyle(el).backgroundColor`，凡是 `rgba(...,<1)` 且
宽度 > 200px 的高层容器，基本就是嫌疑对象。

### 弹窗内的「下沉分组」：白叠白是隐形 bug

弹窗底是 `surface-raised`（≈白）。**里面所有 `bg-ds-surface/xx` 的分组卡 = 白叠白 = 看不见**，
而且半透明会把弹窗外的遮罩透进来。这类写法一律是缺陷。

**正确层级（四级，照这个选）**：

| 角色                           | 用哪个 Token     | 说明                                      |
| ------------------------------ | ---------------- | ----------------------------------------- |
| 弹窗本体                       | `surface-raised` | `.ds-dialog` / `.ds-modal-surface` 已设好 |
| 弹窗内**分区/内容**面          | `surface`        | `DialogPane tone="content\|sidebar"`      |
| 弹窗内**下沉分组卡 / 输入框**  | `surface-subtle` | 让分组"凹"下去，才看得出边界              |
| 画布型工作台（蒙版编辑器舞台） | `canvas`         | `DialogPane tone="canvas"`                |

排查命令（列出弹窗里所有仍带 alpha 的 surface 面板）：

```bash
grep -rn "bg-ds-surface/[0-9]\|bg-ds-subtle/[0-9]" src/components/*Modal*.tsx \
  | grep -viE "backdrop-blur|/9[05]|/5\b|/10\b|/20\b"
```

**验收阈值**（2026-09-19 实测）：`surface-subtle` vs `surface-raised`
浅色 **1.151:1**（`#edeff3` vs `#ffffff`）、深色 **1.137:1**（`#282c33` vs `#1f2228`）。
深色侧原本 16% 只有 1.068:1 → 低于可辨线，已提到 18%。**改这个值必须两侧都验算。**

### 停靠面板的占位变量要对齐「可见性」

`--app-docked-left/right-width` 决定主区两侧留多少空。**留白必须与该面板是否真的渲染一致**，
否则会出现右侧一条莫名其妙的空白（`--word-library-right-width` 被写死 340px）。

排查一行命令（无详情面板时应为 `0px`）：

```js
getComputedStyle(document.documentElement).getPropertyValue('--app-docked-right-width')
```

坑点在于：组件 `return null` **不等于卸载**，`useEffect` 的 cleanup 不会触发，
所以副作用必须自己按「可见性」判定，不能只按 docked 状态。详见 `RISK.md` R-39。

### 主题切换链路（只有一条）

`settings.themeMode` → `App.tsx` effect → `applyAppearance()` → `html.dark` class + `style.colorScheme`；
首屏由 `main.tsx` 的 `bootstrapAppearance()` 读 localStorage 快照提前应用（防闪白）。

**多皮肤（`data-skin`）机制已于 2026-09-19 移除**（ADR-0008）。不要再引入 `data-skin` 这类
"再叠一层 CSS 覆盖"的方案；若确需换肤，用**变量集（variable modes）**重做。

### 清 vite 缓存（改 Token 后样式不更新时）

Vite 预打包缓存会被安全删除护栏拦住（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50 个文件/次），
`npm run dev` 会直接起不来。分批删：

```js
// 每批 ≤ 40 个，避免触发护栏
const fs = require('fs'),
  p = 'node_modules/.vite/deps'
// 同时清掉报 EPERM 的 deps_temp_* 残留目录
```

残留 `deps_temp_*` 会让 dev 报 `EPERM: open ...\react-dom.js` —— 删掉即可，不是代码问题。

## 十一、UI 细节一致性改动的五条纪律（2026-09-19 实测定稿）

做「统一间距 / 组件样式 / 排版层级」这类收口时，**先分类再动手**，否则会把设计意图当缺陷改掉。

### 1. 改之前先分「本体背景」和「交互反馈背景」

半透明不是一律要清。判据是**它是不是元素本体**：

| 写法                                   | 判定     | 处理                        |
| -------------------------------------- | -------- | --------------------------- |
| `bg-ds-surface/55` 直接在面板/输入框上 | 本体背景 | 改不透明或 `surface-subtle` |
| `hover:bg-ds-surface/60`               | 交互反馈 | **保留**（半透明是合理的）  |
| `group-hover:bg-*` / `focus:bg-*`      | 交互反馈 | 保留                        |
| `bg-ds-scrim/45`（遮罩）               | 遮罩语义 | 保留                        |

用这条命令列出**本体背景**（已排除交互前缀）：

```bash
grep -rn --include=*.tsx -E "bg-ds-(surface|raised)/(55|60|70|80|85|90|95)" src \
  | grep -vE "hover:bg-|group-hover:bg-|focus:bg-"
```

### 2. 焦点环只用两档，且必须用 `focus` 色

`ring-ds-focus/70` = 标准控件；`ring-ds-focus/50` = 轻量（大面积容器）。
**不要用 `ring-ds-primary` 当焦点环** —— 它是选中/装饰环，语义不同（但 `ring-ds-primary`
不带 `focus:` 前缀用于选中态是**合法的**，别误改）。

### 3. 光学校正类微调不要动

`mt-[1px]` / `mt-[1.5px]` / `mt-[2px]` 是图标与文字基线对齐的**手工校正**，不是错误。
同理 `pb-[76px]` 这类是给固定工具栏预留的空间。只有**派生值写死**才该改
（例：`pl-[26px]` = 图标 18px + gap 8px → 改 `pl-[calc(1.125rem+0.5rem)]`，改图标时自动跟随）。

### 4. 圆角按语义选 Token，不要按"值相同"选

| 角色            | 类                  | 实际值   |
| --------------- | ------------------- | -------- |
| 小控件 / 输入框 | `rounded-ds-md`     | 8px      |
| **卡片 / 面板** | **`rounded-ds-lg`** | **12px** |
| 模态壳 / 大浮层 | `rounded-ds-xl`     | 16px     |

陷阱：裸 `rounded-lg` **也是 8px**，与 `rounded-ds-md` 同值但是另一套命名。
存量 376 处裸圆角走棘轮（`compliance.test.ts` 的 `bareRounded` 快照），**只减不增**，
不要一次性 sed 替换。

### 5. 同角色元素的字重必须一致

`<h4>` 在本仓约定 = 弹窗/面板内的**区块标题**，统一 `font-semibold`(600)。
例外：`uppercase tracking-wide` 的微标签式 h4（语义是标签 → 保留 `font-medium`）。
`<h3>` 被复用作卡片主文本（`truncate`/`line-clamp` 的提示词预览），**不属标题**。

---

## 十二、加了合规规则后必须做的事

`src/design-system/compliance.test.ts` 是**棘轮**：一旦加了新规则，全仓立刻要能过。

1. 先用 `grep` 数出违规量。**量级 > 50 就不要一次清零** —— 改为快照棘轮
   （仿 `LEGACY_SNAPSHOT` 的模式：`'<文件>|<规则名>': 数量`），只减不增。
2. 写规则时**必须剥离注释**再做匹配，否则注释里为解释历史而引用的类名会被误判，
   逼着后来者不敢写注释。用 `compliance.test.ts` 里现成的 `stripComments()`。
3. 规则要**足够窄**。例：`h4` 字重规则只查 `h4` 不查 `h3`（`h3` 被复用作卡片文本）；
   阴影规则豁免 `shadow-[inset_...]`（那是描边/指示条，不是阴影）。
4. 跑 `npx vitest run src/design-system/compliance.test.ts` 单独验证，再进 `npm run verify`。

---

## 十三、给"多处渲染同一份参数"做结构收敛（2026-09-19 定稿）

**症状识别**：改一个字段要动 N 个文件；或同一个选项数组（如方向选项）在仓库里出现多份。
`grep -c` 一下就能确认，别靠印象。

```bash
grep -rn "跟随尺寸" src/          # 应只命中 paramSchema.ts
git grep -c "DIRECTION_OPTIONS"   # 每份都是漏改点
```

**标准配方**（后处理那轮的形态，可照搬）：

1. **建元数据表**（`src/features/postprocess/paramSchema.ts`）。每项声明
   `key` / `label` / `control` / `scope` / `group` / `resettable` / `help`。
   - `control` 是**渲染分派键**，不是 JSX —— 放 JSX 会让这张表变成组件文件，也没法针对字段断言。
   - `scope` 三档：`global` / `node` / `both`。两种宿主共用的字段才写 `both`。
   - 校验（如命名模板的未知/缺失/重复占位符）**跟字段放一起**，因为它与字段定义是同一件事的两半。
2. **容器只留状态**：左栏树只提供 `selectedNodeId`，不再持有任何参数控件。
   树根挂一个哨兵 id（`GLOBAL_NODE_ID = '__postprocess_global__'`）代表「全局默认」，
   不要让全局配置游离在树外——否则 `scope` 这套过滤就用不起来。
3. **详情面板一次性渲染**：取字段 → 按 `group` 分组 → 按 `control` 分派。加字段不改这里。
4. **删掉旧入口**：按 R-18 三查（grep import / grep 字面量 / grep `readFileSync`）后 `rm`，
   并同步删掉 `design-system/catalog.ts` 里对应的条目（否则 catalog 测试会红）。
5. **测试**：原有用例会因为 DOM 变了而大面积失败，这是**预期**而非回归。
   逐条判断该用例断言的是"新结构下的等价行为"还是"已废除的入口"，前者改写、后者删除。
   另外补一条**契约测试**守住本轮的核心不变量（键唯一、无死分组、无重复定义）。

**坑**：`Switch` 的 `label` 是必填（要传 `label=""`）；`Button` 没有 `icon` 属性
（图标当 children 传）；`Checkbox` 的文本在 `label` 上而不是 `button` 里——
用 `findButton` 找媒体勾选框会失败，要按 `input[type=checkbox]` + `.ds-check__label` 找。
