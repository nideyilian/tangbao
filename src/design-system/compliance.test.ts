import { describe, it, expect } from 'vitest'
import ts from 'typescript'

// 全仓 UI 合规回归测试：锁定规范明确禁止的模式，防止再次分叉。
// 覆盖：MASTER 6.1（不使用 transition: all）、MASTER 4.8（禁止任意数字 z-index，tooltip 为最高层）、
// MASTER 4.3（字号体系 12px 起）、MASTER 4.1（业务代码使用语义 Token，旧工具类只减不增）。

const sources: Record<string, string> = {
  ...import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }),
}

// 排除 design-system 自身（含根文件 ./xxx.tsx 与子目录 ../design-system/xxx）
const entries = Object.entries(sources).filter(([path]) => !path.includes('/design-system/') && !path.startsWith('./'))

/** 将 import.meta.glob 的路径（相对 design-system 目录）归一为快照键形式，如 components/InputBar.tsx */
function normalizeKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\.\//, '')
}

// ===== 持久化用户数据调色板豁免 =====
// 以下文件包含的 hex 色值是"持久化用户数据调色板"（如提示词变量色标、素材标签色），
// 而非 UI 组件 className / 内联 style 硬编码。它们由用户数据驱动，不消费设计 Token，
// 因此对 hex 规则豁免。其他规则（gray / rounded 等）继续检查。
// 新增豁免文件必须在此白名单中登记，否则合规测试报错。

const HEX_EXEMPT_FILES = new Set(['lib/promptVariableColors.ts', 'features/assetLibrary/colorLabels.ts'])

/** 文件级注释标记，声明该文件的 hex 为持久化用户数据调色板。 */
const HEX_EXEMPT_MARKER = /design-token-exempt:\s*persisted-user-color-palette/

/** 检测源文件是否包含豁免标记。 */
function hasHexExemptMarker(src: string): boolean {
  return HEX_EXEMPT_MARKER.test(src)
}

/**
 * 剥离注释后再做样式类匹配。
 *
 * 必要性：源码注释里为了解释「过去是什么、为什么改」经常会**引用被禁的类名**
 * （例如注释写「原 `shadow-2xl` 已收口到 shadow-ds-md」）。直接对原文匹配会把这类
 * 说明性文字误判为违规，逼着后来者不敢写注释 —— 那是更糟的结果。
 */
function stripComments(src: string): string {
  return (
    src
      // 块注释：**保留原有行数**（换成等量换行），这样剥离后行号仍与源文件对齐 ——
      // 定位工具类检查要把违规行号报给人看，行号错位等于没线索。
      .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat((block.match(/\n/g) ?? []).length))
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（避开 http:// 这类）
  )
}

// ===== 设计系统组件的定位工具类（2026-09-22） =====
//
// `styles.css` 里这些基础类声明了 `position: relative`：
//   .ds-button / .ds-icon-button / .ds-check__control / .ds-switch__control / .ds-radio /
//   .ds-select / .ds-aspect-ratio / .ds-tabs__item / .ds-dialog / .ds-tooltip / .ds-popover / .ds-menu
// 而 `main.tsx` 的加载顺序是 `index.css`（Tailwind utilities）→ 再 `design-system/styles.css`。
// 两者特异性相同（都是单类），**后写的赢** → 调用方传 `className="absolute right-4 top-4"`
// 会被静默吃成「相对定位」：元素**留在文档流里**（后面的兄弟节点被挤到它那一行），
// 再被 right/top 平移 16px —— 表现就是「按钮压在正文上」。
//
// 2026-09-22 报障「删除预设？弹窗的 × 压住正文」正是此因（当时全仓 3 处漏了 `!`）。
// 解法与仓库既有约定一致：定位工具类加 `!` 前缀（`!absolute` / `!fixed`），见
// AssetLibrarySidebar / SeriesConsistencyControl 等 6 处先例。
const POSITION_UTILITY = /\b(absolute|fixed|sticky)\b/
const IMPORTANT_POSITION_UTILITY = /!\s*(absolute|fixed|sticky)/
const POSITIONED_DS_CLASS =
  /\bds-(?:button|icon-button|check__control|switch__control|radio|select|legacy-select__option|aspect-ratio|tabs__item|dialog|tooltip|popover|menu|data-grid__editor-wrap)\b/
const DS_POSITIONED_COMPONENTS = new Set([
  'Button',
  'IconButton',
  'Checkbox',
  'Switch',
  'Radio',
  'SelectField',
  'AspectRatio',
  'Tabs',
  'Dialog',
  'Tooltip',
  'Popover',
  'Menu',
])

/** 找出「被子类吃掉」的定位工具类：返回 `文件:行 描述` 列表，空数组 = 合规。 */
function findSwallowedPositionUtilities(path: string, src: string): string[] {
  const display = normalizeKey(path)
  const violations: string[] = []

  // ① ds-* 类直接写在元素上（position 与工具类同处一个 className）
  const clean = stripComments(src)
  for (const match of clean.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const cls = match[1] ?? match[2] ?? ''
    if (!POSITION_UTILITY.test(cls) || IMPORTANT_POSITION_UTILITY.test(cls)) continue
    if (!POSITIONED_DS_CLASS.test(cls)) continue
    const line = clean.slice(0, match.index).split('\n').length
    violations.push(`${display}:${line} className="${cls.replace(/\s+/g, ' ').trim()}"（ds-* 基础类吃掉了定位）`)
  }

  // ② 设计系统组件：position 来自组件基础类，className 里看不到 ds-*
  if (!path.endsWith('.tsx')) return violations

  const file = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file).split('.').pop() ?? ''
      if (DS_POSITIONED_COMPONENTS.has(tag)) {
        const attr = node.attributes.properties.find(
          (prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'className',
        )
        const init = attr?.initializer
        const cls = init
          ? ts.isStringLiteral(init)
            ? init.text
            : ts.isJsxExpression(init)
              ? (init.expression?.getText(file) ?? '')
              : ''
          : ''
        if (cls && POSITION_UTILITY.test(cls) && !IMPORTANT_POSITION_UTILITY.test(cls)) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
          violations.push(`${display}:${line + 1} <${tag}> className="${cls.replace(/\s+/g, ' ').trim()}"（缺 ! 前缀）`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)

  return violations
}

describe('UI 合规回归', () => {
  it('不使用 transition-all（MASTER 6.1：只声明实际变化的属性）', () => {
    const violations = entries
      .filter(([, src]) => /\btransition-all\b/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ''))
    expect(violations).toEqual([])
  })

  it('不使用任意数字 z-index（MASTER 4.8：禁止 z-[...]，改用 --ds-z-* token）', () => {
    const violations = entries
      .filter(([, src]) => /z-\[(?!var)[0-9]/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ''))
    expect(violations).toEqual([])
  })

  it('设计系统组件的定位工具类必须加 ! 前缀（styles.css 的 position: relative 会连带吃掉它）', () => {
    const violations = entries.flatMap(([path, src]) => findSwallowedPositionUtilities(path, src))
    expect(violations).toEqual([])
  })

  it('字号归一到 DS 体系：禁止 text-[8/9/10/11px]（MASTER 4.3：字号 12/13/14/16/20/24）', () => {
    const violations = entries
      .filter(([, src]) => /text-\[(?:8|9|10|11)px\]/.test(src))
      .map(([path]) => normalizeKey(path))
    expect(violations).toEqual([])
  })

  it('禁止体系外任意字号 text-[Npx]（MASTER 4.3：统一走 text-ds-* / text-xs..2xl）', () => {
    // 2026-09-19 收口：历史上散落 text-[15px] / text-[13px] / text-[17px] 等体系外字号，
    // 与 Token 字号并存会让同一层级文字出现 1–2px 的不可解释差异。
    const violations = entries
      .filter(([, src]) => /text-\[[0-9]+px\]/.test(stripComments(src)))
      .map(([path]) => normalizeKey(path))
    expect(violations).toEqual([])
  })

  it('禁止体系外阴影：shadow-xl/2xl 与临时 shadow-[...]（MASTER 4.5：只允许 shadow-ds-*）', () => {
    // 允许两类 token 系写法：
    //   ① `shadow-ds-*`（Tailwind 映射到 --ds-shadow-*）
    //   ② `shadow-[var(--ds-shadow-*)]`（显式引 Token）
    // 禁止写死数值的临时阴影；也不允许 Tailwind 自带的 xl/2xl 档（不在 Token 体系内、
    // 深浅色不单独校准）。唯一豁免：`shadow-[inset_...]` 这类**非阴影语义**的描边/指示条。
    const internalShadow = /shadow-\[(?!var\(|inset_)/
    const violations = entries
      .filter(([, src]) => {
        const code = stripComments(src)
        return /\bshadow-(?:xl|2xl)\b/.test(code) || internalShadow.test(code)
      })
      .map(([path]) => normalizeKey(path))
    expect(violations).toEqual([])
  })

  it('区块标题 h4 字重统一为 600+（MASTER 4.3：标题使用 600–700，标签使用 500）', () => {
    // 背景：SettingsModal 的 14 个区块标题用 font-bold(700)，而 HelpModal / LegacyDataImportModal
    // 等 8 个文件里**同一角色**用 font-semibold(600) 或 font-medium(500)，
    // 甚至「导入旧版数据」这个同名标题在两个文件里字重不同。同层级标题必须同一字重。
    //
    // 只检查 `<h4>`：它在本仓约定里就是「弹窗/面板内的区块标题」。
    // `<h3>` 被复用作卡片主文本（truncate/line-clamp 的提示词预览），不属此列。
    // 豁免：`uppercase tracking-wide` 的微标签式标题（语义是标签，不是标题）。
    const violations: string[] = []
    for (const [path, src] of entries) {
      const code = stripComments(src)
      for (const m of code.matchAll(/<h4\b[^>]*>/g)) {
        const tag = m[0]
        if (!/font-(?:thin|extralight|light|normal|medium)\b/.test(tag)) continue
        if (/uppercase/.test(tag)) continue
        violations.push(`${normalizeKey(path)}: ${tag.slice(0, 90)}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('焦点环统一：只用 ring-ds-focus/70 与 /50 两档（MASTER 4.2：焦点色唯一）', () => {
    // 背景：2026-09-19 审计发现业务代码手搓了 7 档不透明度（/10 /20 /40 /50 /60 /70 + 无修饰），
    // 同一个「键盘焦点」在不同控件上明暗不一。收敛为两档：
    //   /70 = 标准控件；/50 = 轻量（大面积容器、次级动作）
    // 同时禁止把品牌色 ring-ds-primary 用作焦点环 —— 它是选中态/装饰环，语义不同。
    const violations: string[] = []
    for (const [path, src] of entries) {
      const code = stripComments(src)
      for (const m of code.matchAll(/focus(?:-visible)?:ring-ds-focus\/(\d+)/g)) {
        if (m[1] !== '70' && m[1] !== '50') {
          violations.push(`${normalizeKey(path)}: focus 环用了 /${m[1]}，只允许 /70 或 /50`)
        }
      }
      const primaryRingCount = [...code.matchAll(/focus(?:-visible)?:ring-ds-primary\b/g)].length
      if (primaryRingCount > 0) {
        violations.push(
          `${normalizeKey(path)}: 焦点环不可用品牌色 ring-ds-primary（${primaryRingCount} 处），应用 ring-ds-focus`,
        )
      }
    }
    expect(violations).toEqual([])
  })

  it('design-token-exempt: persisted-user-color-palette 标记仅允许出现在白名单文件中', () => {
    const violations: string[] = []
    for (const [path, src] of entries) {
      const key = normalizeKey(path)
      if (hasHexExemptMarker(src) && !HEX_EXEMPT_FILES.has(key)) {
        violations.push(`${key} 带有豁免标记但不在白名单中`)
      }
    }
    expect(violations).toEqual([])
  })

  it('白名单文件必须包含 design-token-exempt: persisted-user-color-palette 标记', () => {
    const missing: string[] = []
    for (const [path, src] of entries) {
      const key = normalizeKey(path)
      if (HEX_EXEMPT_FILES.has(key) && !hasHexExemptMarker(src)) {
        missing.push(`${key} 在白名单中但缺少豁免标记`)
      }
    }
    expect(missing).toEqual([])
  })
})

// ===== 存量旧工具类治理快照（只减不增）=====
// 背景：业务组件历史上有大量裸 Tailwind 旧类（bg-white / bg-gray-* / text-blue-* /
// rounded-xl 等）与写死 Hex，不消费语义 Token，是皮肤切换后观感不一致的根源。
// 治理方式：以下快照记录当前基线。任何文件的计数只允许下降（迁移旧类），
// 新增文件出现任何旧类即失败。新代码应使用设计系统组件与 ds.* / --ds-* Token。
// 更新快照：仅在完成一段旧类迁移后，重新生成快照并提交。
const LEGACY_PATTERNS: Record<string, RegExp> = {
  gray: /\b(?:bg-white|bg-gray-\d+|text-gray-\d+|border-gray-\d+|bg-slate-\d+|text-slate-\d+|border-slate-\d+|bg-zinc-\d+|text-zinc-\d+|border-zinc-\d+|bg-neutral-\d+|text-neutral-\d+|border-neutral-\d+)\b/g,
  brandBlue: /\b(?:bg-blue-\d+|text-blue-\d+|border-blue-\d+|ring-blue-\d+)\b/g,
  semantic:
    /\b(?:bg-emerald-\d+|text-emerald-\d+|bg-amber-\d+|text-amber-\d+|bg-red-\d+|text-red-\d+|bg-rose-\d+|text-rose-\d+)\b/g,
  rounded: /\brounded-(?:xl|2xl|3xl)\b/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  // 2026-09-19 新增：裸 rounded-lg 与 Token 圆角是**两套并行的命名**，「值相同 ≠ 语义相同」。
  // 现状 177 处存量不适一次清零（回归面太大、收益低），改为棘轮：只许减少、新增即失败。
  // 语义对照：rounded-sm=2px(无 token) / rounded-md=6px(≡ds-sm) / rounded-lg=8px(≡ds-md)
  //          / rounded-xl=12px(≡ds-lg) / rounded-2xl=16px(≡ds-xl)。
  // 卡片与面板应使用 rounded-ds-lg（12px，MASTER 4.5）。
  bareRounded: /\brounded-(?:sm|md|lg)\b/g,
}

const LEGACY_SNAPSHOT: Record<string, number> = {
  'components/AgentWorkspace.tsx|hex': 1,
  'components/DetailModal.tsx|hex': 8,
  'components/FavoriteCollections.tsx|hex': 5,
  'components/InputBar.tsx|hex': 7,
  'components/MaskEditorModal.tsx|hex': 16,
  'components/PromptVariableEditor.tsx|hex': 7,
  'features/assetLibrary/AssetBatchView.tsx|hex': 7,
  'features/assetLibrary/AssetGrid.tsx|hex': 7,
  'features/assetLibrary/AssetLibrarySidebar.tsx|hex': 10,
  'features/assetLibrary/AssetLibraryToolbar.tsx|hex': 7,
  'features/assetLibrary/AssetListView.tsx|hex': 7,
  'features/composite/components/PresetLayerPanel.tsx|hex': 1,
  'features/composite/lib/compositeDefaults.ts|hex': 18,
  // IDENTIFIER_FALLBACK_STYLE 的白/黑是画布水印默认色（写入持久化数据、不随主题变），非 UI 样式类
  'features/composite/lib/compositeV2Types.ts|hex': 2,
  'features/composite/lib/compositeRenderer.ts|hex': 1,
  'features/composite/lib/compositeRendererV2.ts|hex': 2,
  'features/composite/storeV2.ts|hex': 4,
  'features/requirementPrototype/manifests.ts|hex': 4,
  'lib/imagePostprocess.ts|hex': 1,

  // ===== bareRounded 基线（2026-09-19 建立，只减不增）=====
  // 裸 rounded-sm/md/lg 与 ds Token 并行存在，值为 2/6/8px。卡片与面板应走 rounded-ds-lg(12px)。
  // 此处为存量棘轮起点，迁移时把数字调小，不改基线不动它。
  'features/strategy/adapters/GallerySopBatchModal.tsx|bareRounded': 49,
  'components/SettingsModal.tsx|bareRounded': 37,
  'components/AgentBatchPlannerModal.tsx|bareRounded': 35,
  'components/HelpModal.tsx|bareRounded': 23,
  'components/AgentWorkspace.tsx|bareRounded': 20,
  'components/DetailModal.tsx|bareRounded': 20,
  'components/ScheduleModal.tsx|bareRounded': 16,
  'components/FavoriteCollections.tsx|bareRounded': 15,
  'components/InputBar.tsx|bareRounded': 12,
  'components/SopBatchDetailModal.tsx|bareRounded': 10,
  'components/MaskEditorModal.tsx|bareRounded': 9,
  'features/assetLibrary/AssetLibrarySidebar.tsx|bareRounded': 9,
  'features/composite/components/PresetManagementTab.tsx|bareRounded': 8,
  'components/WorkspaceTabManagerModal.tsx|bareRounded': 7,
  'features/composite/components/FloatingLogoLibrary.tsx|bareRounded': 7,
  'features/composite/components/PresetLayerPanel.tsx|bareRounded': 7,
  'components/LegacyDataImportModal.tsx|bareRounded': 5,
  'components/TaskCard.tsx|bareRounded': 5,
  'features/assetLibrary/AssetBatchView.tsx|bareRounded': 5,
  'components/SizePickerModal.tsx|bareRounded': 3,
  'features/assetLibrary/AssetDuplicateModal.tsx|bareRounded': 3,
  'features/assetLibrary/AssetLibraryWorkspace.tsx|bareRounded': 3,
  'features/assetLibrary/AssetPickerModal.tsx|bareRounded': 3,
  'features/assetLibrary/AssetPurgeModal.tsx|bareRounded': 3,
  'features/composite/components/PresetCanvasEditor.tsx|bareRounded': 3,
  'features/strategy/SopGenerateTab.tsx|bareRounded': 3,
  'components/AgentImageGrid.tsx|bareRounded': 2,
  'components/Lightbox.tsx|bareRounded': 2,
  'components/PromptInputDialog.tsx|bareRounded': 2,
  'features/assetLibrary/AssetListView.tsx|bareRounded': 2,
  'features/assetLibrary/FilterControlStrip.tsx|bareRounded': 2,
  'components/DerivePolicyModal.tsx|bareRounded': 1,
  'components/ErrorBoundary.tsx|bareRounded': 1,
  'components/GalleryImageTile.tsx|bareRounded': 1,
  'components/Header.tsx|bareRounded': 1,
  'components/HoverImagePreview.tsx|bareRounded': 1,
  'components/LargeModalToggle.tsx|bareRounded': 1,
  'components/TaskParamSummary.tsx|bareRounded': 1,
  'features/assetLibrary/AssetCardMenu.tsx|bareRounded': 1,
  'features/assetLibrary/AssetFilterTabBar.tsx|bareRounded': 1,
  'features/assetLibrary/AssetGrid.tsx|bareRounded': 1,
  'features/assetLibrary/AssetLibraryToolbar.tsx|bareRounded': 1,
  'features/assetLibrary/AssetParamBreakdown.tsx|bareRounded': 1,
  'features/assetLibrary/AssetQuickPreview.tsx|bareRounded': 1,
  'features/assetLibrary/AssetTile.tsx|bareRounded': 1,
  'features/composite/components/FloatingLayerToolbar.tsx|bareRounded': 1,
  'features/strategy/SopCoverPickerDialog.tsx|bareRounded': 1,
  'features/strategy/SopImageStack.tsx|bareRounded': 1,
  'features/strategy/SopPromptRunsDialog.tsx|bareRounded': 1,
  'features/strategy/SopVersionHistoryDialog.tsx|bareRounded': 1,
}

describe('UI 合规治理（存量旧工具类只减不增）', () => {
  it('每个文件的旧类计数不超过基线快照；新文件出现旧类即失败', () => {
    const regressions: string[] = []
    for (const [path, src] of entries) {
      if (/\.test\.(ts|tsx)$/.test(path)) continue
      const key = normalizeKey(path)
      for (const [name, re] of Object.entries(LEGACY_PATTERNS)) {
        re.lastIndex = 0
        // hex 规则：白名单文件带有豁免标记时跳过，其他规则继续检查
        if (name === 'hex' && HEX_EXEMPT_FILES.has(key) && hasHexExemptMarker(src)) {
          continue
        }
        const count = (src.match(re) ?? []).length
        const allowed = LEGACY_SNAPSHOT[`${key}|${name}`] ?? 0
        if (count > allowed) {
          regressions.push(`${key} [${name}]: ${count} 处，快照上限 ${allowed} 处`)
        }
      }
    }
    expect(regressions).toEqual([])
  })
})
