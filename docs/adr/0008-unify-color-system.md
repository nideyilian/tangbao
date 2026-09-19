# 0008 · 配色与主题系统收敛：多皮肤 → 单一设计 Token 体系 + 明暗双主题

- 状态：已采纳
- 日期：2026-09-19
- 相关：`docs/ui-retrofit-plan.md`、ADR 0005（discard style migration）

## 背景

仓库原有三套并行的"配色"概念：

| 层               | 入口                                                                                            | 规模                                                |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 明暗模式         | `html.dark` class                                                                               | 2 态（light / dark）                                |
| 皮肤（配色方案） | `html[data-skin]`                                                                               | 5 套：default / handdrawn / glass / retro / eyecare |
| 旧桥变量         | `index.css :root` 的 `--background` / `--foreground` / `--muted` / `--sidebar` / `--primary` 等 | 10 个变量 × 2 模式                                  |

外加 tailwind.config.js 里两套色板映射（`ds.*` 语义色 与 `blue.*` 皮肤品牌色）。

## 实测数据（决定取舍的依据）

1. **皮肤系统的真实成本**：`skins/` 5 个文件共 **1175 行**，每套皮肤需覆盖约 **60 个 Token**（去重 72 个），
   注册表 88 行 + 运行时 121 行 + 契约测试 **219 行**（含 WCAG 对比度矩阵校验）。合计约 **2320 行**。

2. **旧桥变量已完全死掉**：全仓搜索 `var(--background)` / `var(--foreground)` / `var(--sidebar)`
   / `var(--muted)` / `var(--input)` / `var(--primary)` —— **0 处消费**；
   Tailwind 类名 `bg-background` / `text-foreground` / `bg-muted` 等 —— **0 处消费**。

3. **`skins.css` 的 143 处 `:is(:root[data-skin='X'], …)` 选择器是硬撑**：
   它把业务代码里写死的 `bg-white` / `bg-gray-*` / `text-blue-*` / `border-*` 等旧 Tailwind 类
   在皮肤作用域内重定向到 Token。也就是说 —— **皮肤系统存在的意义，很大一部分是在给"没有统一 Token"擦屁股**。
   一旦业务代码统一消费语义 Token，这段 717 行兼容桥就没有存在理由。

4. **维护成本差异极大**：四套自定义皮肤不只是颜色，还各带字体、纹理（eyecare 内嵌了 3 层 SVG 噪声滤镜）、
   glass 的 backdrop-filter 预算约束。新增一套皮肤要同时写 2 模式 × 60 Token 并满足对比度矩阵。

## 决策

**移除皮肤（换肤）系统，收敛为「单一设计 Token 体系 + 明暗双主题」，并重新设计配色。**

具体：

1. **删除** `src/theme/styles/skins/`（5 文件）、`skins.css`（717 行）、`src/theme/registry.ts`、
   `src/theme/skinContract.test.ts`、`src/design-system/skin.tsx` 中的皮肤 UI。
2. **删除** `index.css` 中的旧桥变量（`--background` 等 10 个）+ tailwind.config.js 的 `blue.*` 皮肤色板映射。
3. **保留** `html.dark` 明暗双主题（这是真实需求，成本低、无维护负担）。
4. **重新设计**一套统一 Token：以模板 00009（xAI-inspired）的克制制度为基底，
   但配色适配明亮工具（模板本身是深色专属，见其 Do's）。

## 为什么这样取舍

**支持移除：**

- 皮肤系统 ≈ 2320 行，支撑 4 个可选的视觉皮肤；而它 143 处工具类重定向说明
  **它在补偿 Token 不统一**，而不是在提供真正的能力。
- 每新增一套皮肤的成本是「2 模式 × 60 Token + 对比度矩阵」，且必须遵守
  「不得覆盖布局 Token」的隐式约束 —— 这是一个高门槛、低回报的扩展点。
- 双轨冗余（`--ds-color-*` 与 `--background` 等）让"改一个颜色要动几处"成为常态，
  是视觉不一致的结构性根源。
- 旧桥变量实测 **0 消费**，属于纯粹的死重量。

**保留 `html.dark`：**

- 明暗模式的成本是「1 组 Token 值 × 2」，语义清晰，无扩展点负担。
- 它是真实用户需求（夜间使用）。

**被否决的方案：**

| 方案                         | 否决原因                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------ |
| 保留皮肤系统但精简为 2 套    | 仍需维护注册表 + 契约测试 + 60 Token×2 模式 ×2 皮肤 = 240 个赋值；收益不抵成本 |
| 保留皮肤机制但只留 default   | "机制空转"——代码还在、测试还在、认知负担还在，却没有任何皮肤在用               |
| 只删死掉的旧桥变量，保留皮肤 | 治标：142 处工具类重定向仍在，视觉一致的根因未除                               |

## 影响（实施结果）

- **`skinId` 字段彻底废弃**：`AppSettings.skinId` 改为 `skinId?: string`，运行时被完全忽略，
  不再产生任何视觉影响。`migratePersistedState` 新增一步无条件丢弃旧存档里的 `skinId` /
  `colorScheme`（保留字段会让用户误以为还能换肤）。
- **`lib/theme.ts` 兼容桥删除**：它只做 re-export，实测无第三方消费点；
  保留它等于让「皮肤」这个概念继续在代码里存活。
- **`src/theme/registry.ts` 从皮肤注册表改造为主题注册表**：`SKIN_REGISTRY` → `THEME_REGISTRY`
  （light / dark 两项），`SkinId` → `ThemeId`，`normalizeSkinId` → `normalizeThemeId`。
- **UI 收敛为单一开关**：`ColorSchemeSwitcher` + `ColorPresetGrid` 两个组件删除，
  合并为 `src/design-system/themeSwitcher.tsx` 的 `ThemeSwitcher`；
  顶栏那个「配色（调色板）按钮」一并删除 —— 它与旁边的明暗按钮就是同一件事。
- **`darkMode: 'class'` 机制不变**，`applyAppearance` 只负责 toggle `dark` 类与 `style.colorScheme`。
- **主题过渡不再全局扫描**：`index.css` 的 `.theme-transitioning *` 改为
  `.theme-transitioning [data-theme-transition]`，避免切换瞬间对整棵 350KB DOM 施加 transition。
- **配色重新设计**：浅色以中性灰阶 + 品牌蓝（hue 221）为 primary；深色为近黑画布（`220 14% 5%`）。
  全部文字/表面组合实测通过 WCAG AA（`text-subtle` 从 4.19:1 调整到 4.82:1）。
- **文档清理**：`docs/skin-authoring-guide.md`（437 行）、`docs/skin-export-jank-analysis.md` 已删除；
  `design-system/tangbao/COMPONENTS.md` 的组件表同步更新。

### 第二轮修正（2026-09-19，用户反馈「看不出区别」）

首版方案的问题**不在结构，而在取值**——这是本次改造最重要的教训：

- **「等效值」假改造**：首版浅色画布取 `220 20% 98%`，与旧值 `210 20% 98%` 换算后**同为
  `#f9fafb`**；描边 `#e0e2e6` → `#e2e4e9` 仅差 2 个色阶。HSL 在 96% 以上的高亮度段，
  色相/饱和度的变化**几乎不影响最终 sRGB**。结果：代码 diff 漂亮，界面零变化。
- **修正**：把表面层级改用**明度差**表达。浅色 `#f2f4f7` ↔ `#ffffff`（1.102:1）、
  深色 `#0b0c0f` ↔ `#191b1f`（1.134:1），描边全部提到 ≥ 1.3:1。28 个 Token × 2 模式全部重算。
- **更深的根因**：即便取值正确，层级仍会被**语义类上的 alpha 修饰符**抹平 ——
  侧栏写的是 `bg-ds-surface/50`，50% 透明让灰画布透上来，面板与画布重新糊成一片。
  顶栏 `bg-ds-surface/90 backdrop-blur-sm` 同理。已改为不透明 `bg-ds-surface`。
  **结论：Token 只负责"给对颜色"，"用对颜色"要靠消费端不滥用透明度。**
- **顺带暴露的存量缺陷**：右侧一条 340px 空白。根因是 `WordLibrarySidebar` 在
  `!detailAvailable` 时 `return null`（未卸载 → effect cleanup 不触发），
  而占位变量只按 `docked` 判定 → `--word-library-right-width` 被永久写成 340px。
  已改为按 `detailAvailable && !compactViewport` 判定（`RISK.md` R-39）。
  **这个 bug 一直存在，只是画布与面板同色时看不出来；颜色改对之后才显形。**

经验阈值：相邻表面 ≥ **1.10:1** 才肉眼可辨，描边 ≥ **1.30:1** 才不糊。配方见 runbook 第十节。

### 净变化量

| 项             | 变化                                                               |
| -------------- | ------------------------------------------------------------------ |
| 删除文件       | 11（5 套皮肤 + skins.css + skinContract + skin.tsx + theme.ts 等） |
| 删除行数（约） | 2400+                                                              |
| 新增文件       | 2（`themeSwitcher.tsx`、ADR-0008）                                 |
| 颜色 Token     | 28 个 × 2 模式（唯一一套）                                         |
| 测试           | 226 文件 / 2511 用例 全绿                                          |

## 后续

- 若将来确实需要"换肤"，应基于**变量集（variable modes）**重做，
  而不是再引入一层 CSS 覆盖 —— 见 ADR 后续讨论。
- 存量 `bg-white` / `bg-gray-*` / `text-blue-*` 等旧工具类仍受
  `src/design-system/compliance.test.ts` 的棘轮管控（只减不增），可继续按需收敛。
