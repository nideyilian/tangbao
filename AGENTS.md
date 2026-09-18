# Agent Instructions — 糖包（TANGBAO）

本文件是 AI 编码助手在本仓库（Electron 桌面应用根目录）的自动加载约定。

## 项目概况

- Electron + React 19 + Vite + TypeScript 桌面应用。
- 状态管理 Zustand，样式 Tailwind CSS + 语义令牌（`--ds-*` 变量、`ds-*` 类，见 `src/design-system/`）。
- 源码：`src/`（渲染进程）、`electron/`（主进程）；`dist/`、`dist-electron/`、`release/` 为构建产物，勿手动编辑。
- 包管理 npm（有 `package-lock.json`），勿用 yarn / pnpm。
- 仓库：https://github.com/nideyilian/tangbao
- 设计规范：`design-system/tangbao/MASTER.md`（全局视觉/交互）、`COMPONENTS.md`（组件规范）；
  可执行规范数据在 `src/design-system/catalog.ts`。

## 项目管理（开工前必读）

单一真相源：**一个事实只有一个家，其它地方只放指针**。

| 回答什么问题                      | 文件                          |
| --------------------------------- | ----------------------------- |
| 现在要交付什么、什么算做完        | `docs/ROADMAP.md`             |
| 现在在做什么、卡在哪              | `docs/BACKLOG.md`             |
| 为什么不那么做                    | `docs/adr/`                   |
| 哪些坑不能踩（R/P/Q 分级 + 缓解） | `docs/RISK.md`                |
| 具体操作配方                      | `docs/tangbao-ops-runbook.md` |
| 哪份文档还算数                    | `docs/README.md`              |

**开工前**

1. 在 `docs/BACKLOG.md` 找到（或新建）`TB-###`，**验收标准要写得能测**，不能是形容词。
2. 确认**没有别的写线在跑**：`netstat -ano | grep 41731`；`git status` 看有无他人未提交改动。
   本仓库的 dev（41731 固定端口 + 单实例锁 + leveldb 独占）是**排他资源**，
   并行必须用 `git worktree` 隔离，见 `docs/work-protocol.md`。**同一仓库默认单写线。**
3. 涉及持久化 / 数据库 → 先备份（`backup-before-*`）。

**收工前**

`npm run verify` 全绿 → `npx prettier --write` → 更新 `BACKLOG.md` 状态与**验收证据** →
新坑登记 `docs/RISK.md`（配方写进 runbook）→ 架构级决策补一条 `docs/adr/` →
**提交并推送**（不留未提交改动过夜）。

**不要**

- 同一仓库并行开两条写线；反复重启 dev 去「救」窗口（只会和对面互相顶掉）。
- 提交时 `git add -A`（工作区常有另一条线的未提交改动，只 add 本轮文件）。
- 擅自扩大需求范围、擅自改本文件、替用户改全局配置（启用范围 / 用户数据 / 版本号 → 一律由杰哥拍板）。

## 常用命令

| 操作                        | 命令                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| 开发服务器                  | `npm run dev`                                                                                        |
| 类型检查（渲染进程）        | `npx tsc -b`                                                                                         |
| 类型检查（主进程）          | `npx tsc -p electron/tsconfig.json --noEmit`                                                         |
| 测试                        | `npm test`（即 `vitest run`）                                                                        |
| Lint                        | `npm run lint`                                                                                       |
| 格式检查                    | `npm run format:check`                                                                               |
| **一键验证（发布前必跑）**  | `npm run verify`（= tsc 双端 + lint + format:check + test）                                          |
| **发布等效预览**            | `npm run electron:preview`（= vite build + `electron .`，走生产分支：loadFile + CSP + 自动更新检查） |
| 构建前端                    | `npm run build`                                                                                      |
| Electron 本地打包（不发布） | `npm run release:dry`                                                                                |
| 发布                        | `npm run release`                                                                                    |

### 开发与发布一致性（重要）

- **dev 与打包版共用同一份 CSP**（`electron/main.ts`，仅 script-src / connect-src 按 dev 微调）：
  打包版才会暴露的资源拦截问题（如 `connect-src` 缺 `data:` 导致图生图 Failed to fetch）在本地 dev 即可发现。
  若 dev 下 HMR 被 CSP 干扰，可临时 `TANGBAO_DEV_NO_CSP=1 npm run dev` 排查，修复后恢复。
- **功能等效验证**：日常迭代用 `npm run dev`；发布前跑 `npm run verify` + `npm run electron:preview`
  （preview 走生产加载分支：loadFile + CSP + 自动更新检查，功能与安装版一致，无需为「发布版效果」额外装包测试）。
  签名 / fuses 加固 / 自动更新推送只影响分发，不影响功能。
- `release/` 只保留**最新版本**的安装包（Setup + portable + blockmap + latest.yml），
  历史版本包勿堆入；需要旧包时从 GitHub Releases 下载。

## 代码风格（强制）

- 2 空格缩进、单引号、无分号；箭头函数参数始终加括号：`(x) => x`。
- 代码注释与 UI 文案默认中文。
- 简单优先：写能工作的最简代码，少抽象；函数只在多处复用且非平凡时才提取。
- 完整实现：不留 TODO/stub；错误但完整优于正确但残缺。
- 跟随现有风格是最高优先级。
- 目录约定：组件放 `src/components/`，hooks 放 `src/hooks/`，纯工具放 `src/lib/`；
  `src/store.ts` 只放 state 定义与 action 入口（已过大，勿继续膨胀）。
- 设计系统合规（`src/design-system/compliance.test.ts` 强制）：
  - 不用 `transition-all`（只声明实际变化的属性）。
  - 不用任意数字 `z-[N]`，改用 `--ds-z-*` 令牌。
  - 字号从 12px 起（不用 `text-[8/9/10/11px]`）。
  - 旧工具类（`bg-white`/`gray-*`/`blue-*`/`rounded-xl`/写死 hex 等）只减不增。

## 发布流程

触发词：用户说「发布 / 发布版本 / 推送更新 / release / 更新版本」。

### 版本号规则（不要反问用户）

- 默认 `patch`：`0.8.2` → `0.8.3`。
- 用户明确指定版本号或 bump 类型（patch/minor/major）时，以用户为准。
- 用户说「大版本/小版本」时据此推断：破坏性改动 → major、新功能 → minor、修 bug → patch；不确定就 patch。

### 步骤

1. **确定版本号**：读 `package.json` 的 `version`，按上规则得到新版本号 `<V>`。

2. **本地验证**（任一步失败即停下修复，不得继续）：

   ```bash
   npx tsc -b
   npx tsc -p electron/tsconfig.json --noEmit
   npm run lint
   npm run format:check
   npm test
   ```

3. **更新 changelog**：在 `RELEASE.md` 顶部新增 `## v<V>（YYYY-MM-DD）` 段落，
   按「🎨 优化 / 🔧 修复与内部」归类列出本次改动。

4. **提交 + 打 tag + 推送**：

   ```bash
   git add package.json package-lock.json RELEASE.md
   git commit -m "release: v<V>"
   git tag v<V>
   git push origin main
   git push origin v<V> --tags
   ```
   - 网络可能需 Watt Toolkit 加速 GitHub；推送失败时提醒用户开启加速后重试。

5. **CI 自动发布**：推送 tag `v*` 触发 `.github/workflows/release.yml`（Windows runner：
   `npm ci` → 测试/lint/format → 主进程类型检查 → 构建前端 → `electron-builder --publish always --win`），
   产物发布到 GitHub Releases。通常需 5–10 分钟，勿打断。

6. **验证发布**：确认 GitHub Actions 对应 run 成功，且新版本出现在
   https://github.com/nideyilian/tangbao/releases 。

### 本地直接发布（可选，跳过 CI）

仅在需要本地出包/调试发布时使用，需先配置 `GH_TOKEN`：

```powershell
[Environment]::SetEnvironmentVariable("GH_TOKEN", "<token>", "User")  # 持久化；或 $env:GH_TOKEN = "<token>"
npm run release
```

`npm run release` = 构建前端 + `electron-builder --publish always` + `scripts/apply-fuses.mjs` 加固。

### 签名与加固

- **代码签名**（正式分发前必须）：设置 `CSC_LINK`、`CSC_KEY_PASSWORD`、`CSC_PUBLISHER_NAME`
  后 electron-builder 自动签名。未签名安装包会被 Windows SmartScreen 拦截。
- **fuses 加固**：本地 `release`/`electron:build` 会执行 `scripts/apply-fuses.mjs`（禁用 RunAsNode、
  asar 完整性校验、Cookie 加密等）。注意：CI 的 `release.yml` 目前未包含此步，如需补全要改 workflow。

### 自动更新机制

- `electron-updater` 从 GitHub Releases 拉取新版本。
- 生产模式启动时自动检查；设置页「关于」显示更新状态与手动检查按钮。
- 有新版本时提示下载，安装于退出时完成。

## 测试与验证要求

- 修改完成后，最少运行 `npx tsc -b` + 受影响模块的测试；改动设计系统/样式时额外跑
  `src/design-system/` 下测试（catalog / compliance / tokensContract 等）。
- 发布前必须按「发布流程」完整跑一遍验证。
