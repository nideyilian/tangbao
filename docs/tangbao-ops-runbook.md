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

```bash
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | \
  git -c credential.helper= \
      -c 'credential.helper=!"C:/Program Files/Git/mingw64/bin/git-credential-manager.exe"' \
      credential fill | grep '^password=' | cut -d= -f2-)

curl -s --ssl-no-revoke \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/nideyilian/tangbao/actions/runs?per_page=5"
```

- `--ssl-no-revoke` **必须加**，否则返回**空 body**（不是报错），很容易误判成「GitHub API 挂了」。
- 别用 `-o /dev/null`：TLS 握手失败会被一起吞掉。
- 未认证 60 次/时，带 token 5000 次/时。token 就是上面的 `git credential fill`（`password=` 那段）。
- **一次 push 只给 head commit 生成一个 run**，中间那几条提交不会有独立 run，别以为漏跑了。
- job logs 会 302 到带签名的 URL；`curl -L` 带 `Authorization` 会被拒 → 先 `curl -I` 取
  `location`，再无认证头下载。

### CI / Release 触发条件

| workflow      | 触发           | 注意                                                                 |
| ------------- | -------------- | -------------------------------------------------------------------- |
| `ci.yml`      | 任意分支 push  | `tsc -b` + electron typecheck + lint + format:check + vitest（Node 24） |
| `release.yml` | `v*` tag       | **勿改回 `--publish always`**（124MB exe 必超时）→ `--publish never` + `softprops/action-gh-release@v2`；校验步骤硬编码产物名 |

