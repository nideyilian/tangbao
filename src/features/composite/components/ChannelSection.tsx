/**
 * 中控台 · 「渠道与输出」分区。
 *
 * **2026-09-22（TB-093）：「输出位置」并入「渠道与尺寸」**，两个 tab 合成这一个。
 * 合并的理由是它们**大部分是同一份数据**（都按渠道来），各占一个 tab 只会让「这个渠道出到哪」
 * 得看两个地方：
 *
 * ```
 * 合并前：渠道与尺寸 tab  → 渠道表 + 尺寸表 + 参与产出 + 纯净版
 *        输出位置 tab    → 按渠道的导出位置 + 文件命名 + 分发 + 产出预览
 * 合并后：渠道与输出 tab  → 一张表（渠道名 / 详细尺寸 / 参与产出 / 导出位置，双写占两行）
 *                          + 画面方向 + 画面适配 + 纯净版 + 文件命名 + 分发 + 产出预览
 * ```
 *
 * 内容来源（合并时逐块搬的，不是重写）：
 * - 表格本体 `ConsoleMediaTables`（TB-060 做的，TB-093 加了导出位置列）；
 * - 「画面方向 / 画面适配」（2026-09-20 从后处理弹窗搬来，它是整批三选一，不进表）；
 * - 「默认输出位置 / 渠道导出位置」（原 `OutputSection`，两层：全局 `mediaOutputDirs` +
 *   节点 `byMedia`，节点层同时摘掉旧的单值 `outputDir`，避免「显示的」与「生效的」不一致）；
 * - 「文件命名」（2026-09-20）、「分发」（2026-09-21 并入）、「产出预览」—— 三节都是**全局一套**。
 *
 * ⚠️ 于是本分区**是混合的**，而且层级比合并前更密：一张表里 渠道名 / 详细尺寸 全局、
 * 参与产出与导出位置跟作用域，表下面三节又全是全局。所以：
 * - 分区顶上给**一条作用域说明**（节点作用域下说明这是谁的覆盖值、留空往哪退）；
 * - 层级写进**每列的 `help`**（列说明里点名「所有方向共用」）；
 * - **不要再挂分区级提示条**「全局设置，所有方向共用」—— 那句话对这张表的后半列是错的
 *   （理由见 `controlConsoleSections.ts` 里 `globalOnly` 的注）。
 *
 * 生效值一律走既有解析函数（`resolveProjectPostprocessSlice` / 产出链同一个），
 * 不在界面里自己再拼一遍继承 —— 两处各写一遍迟早出现「界面显示一套、实际产出按另一套」。
 */

import { useMemo } from 'react'
import { Alert, Badge, Button, Checkbox, Inline, SectionHeader, SegmentedControl } from '../../../design-system'
import {
  DIRECTION_OPTIONS,
  FIT_MODE_OPTIONS,
  PURE_MEDIA_ID,
  normalizeOutputDirList,
  resolvePostprocessOutputDirs,
  type PostprocessNodeOverride,
} from '../../../lib/postprocessMedia'
import { pruneSelectedMediaIds, usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { resolveProjectOverrideChain, resolveProjectPostprocessSlice } from '../../projectTree/params'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { usePostprocessGlobalConfig } from '../../postprocess/usePostprocessGlobalConfig'
import PostprocessNamingFields from '../../postprocess/PostprocessNamingFields'
import { useStore } from '../../../store'
import type { CompositeV2FitMode } from '../lib/compositeV2Types'
import { isGlobalScope, type ConsoleScope } from '../lib/controlConsoleSections'
import { ConsoleMediaTables } from './ConsoleMediaTables'
import { DistributionSection } from './DistributionSection'
import PostprocessOutputPreview from './PostprocessOutputPreview'
import PostprocessHistoryList from '../../postprocess/PostprocessHistoryList'

interface Props {
  /** 当前作用域：`GLOBAL_NODE_ID`（全局基线）或某个方向节点 id，由左侧树驱动 */
  scope: ConsoleScope
}

/**
 * 每种适配模式的代价，只显示**当前选中**的那一条。
 *
 * 必须逐条说清代价：三个选项都能「把图放进画布」，差别全在代价上（丢边缘 / 带模糊边 / 变形）。
 * 只给三个名字让人选，往往是产出跑完才发现不对，得整批重跑。
 */
const FIT_MODE_HINT: Record<CompositeV2FitMode, string> = {
  'crop-fill': '等比放大填满、超出的边裁掉：画面不变形，代价是丢边缘内容。',
  'contain-blur': '完整画面居中、四周补原图模糊底：画面不丢不变形，代价是带模糊边，对留白敏感的渠道可能不收。',
  stretch: '直接铺满：画面不丢，代价是比例被改变（会变形）。',
}

export function ChannelSection({ scope }: Props) {
  const media = usePostprocessMediaStore((state) => state.media)
  const globalSelectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const setSelectedMediaIds = usePostprocessMediaStore((state) => state.setSelectedMediaIds)
  const direction = usePostprocessMediaStore((state) => state.direction)
  const setDirection = usePostprocessMediaStore((state) => state.setDirection)
  const fitMode = usePostprocessMediaStore((state) => state.fitMode)
  const setFitMode = usePostprocessMediaStore((state) => state.setFitMode)
  const outputDir = usePostprocessMediaStore((state) => state.outputDir)
  const mediaOutputDirs = usePostprocessMediaStore((state) => state.mediaOutputDirs)
  const setMediaOutputDir = usePostprocessMediaStore((state) => state.setMediaOutputDir)
  const clearMediaOutputDirs = usePostprocessMediaStore((state) => state.clearMediaOutputDirs)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const collections = useAssetLibraryStore((state) => state.collections)
  const globalConfig = usePostprocessGlobalConfig()
  const showToast = useStore((state) => state.showToast)

  const isGlobal = isGlobalScope(scope)
  /**
   * 历史产出块只看**当前作用域**那个方向；全局作用域传 `undefined`（= 全部方向）。
   *
   * 用 `useMemo` 是为了给子组件一个**稳定引用**：内联写 `[scope]` 每次渲染都是新数组，
   * 会让子组件的 `useMemo` 每次都重算（历史列表不便宜）。
   */
  const historyDirectionIds = useMemo(() => (isGlobal ? undefined : [scope]), [isGlobal, scope])
  const override = isGlobal ? undefined : params[scope]?.postprocess
  const scopeNode = useMemo(
    () => (isGlobal ? undefined : collections.find((item) => item.id === scope)),
    [collections, isGlobal, scope],
  )

  // ==================== 参与产出（方向级：全局改基线、节点改这个方向那份） ====================

  /**
   * 本级有没有写过这个字段。`undefined` = 没表态（继续向上继承）。
   * **不能看 `length`**：空数组是有效值，表示「这个方向一个渠道都不投」。
   */
  const ownSelectedMediaIds = isGlobal ? undefined : params[scope]?.postprocess?.selectedMediaIds

  /** 生效的参与渠道（节点作用域沿树继承）。产出链读的是同一个函数，界面不会与产出分叉。 */
  const effectiveSelectedMediaIds = useMemo(
    () =>
      isGlobal
        ? globalSelectedMediaIds
        : resolveProjectPostprocessSlice(collections, params, scope, globalConfig).config.selectedMediaIds,
    [collections, globalConfig, globalSelectedMediaIds, isGlobal, params, scope],
  )

  /**
   * 本级没表态时，这个值是从哪儿继承来的 ——「跟随「产品名」」比「继承中」有用得多。
   * 链是根在前、自身在最后，所以从后往前找第一个写了本字段的环。
   */
  const inheritedFromLabel = useMemo(() => {
    if (isGlobal || ownSelectedMediaIds !== undefined) return '全局默认'
    const chain = resolveProjectOverrideChain(collections, params, scope)
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const entry = chain[index]
      if (entry.collectionId === scope) continue
      if (entry.override.selectedMediaIds === undefined) continue
      return collections.find((item) => item.id === entry.collectionId)?.name ?? entry.collectionId
    }
    return '全局默认'
  }, [collections, isGlobal, ownSelectedMediaIds, params, scope])

  /** 写回当前作用域。都**整份重写**：数组顺序即产出顺序，逐项增删表达不出顺序变化。 */
  const writeSelectedMediaIds = (next: string[]) => {
    const pruned = pruneSelectedMediaIds(media, next)
    if (isGlobal) {
      setSelectedMediaIds(pruned)
      return
    }
    setPostprocessOverride(scope, { selectedMediaIds: pruned })
  }

  const toggleSelected = (mediaId: string, next: boolean) => {
    const has = effectiveSelectedMediaIds.includes(mediaId)
    if (has === next) return
    writeSelectedMediaIds(
      next ? [...effectiveSelectedMediaIds, mediaId] : effectiveSelectedMediaIds.filter((id) => id !== mediaId),
    )
  }

  // ==================== 导出位置（跟作用域：全局渠道表 / 节点覆盖，留空向上继承） ====================

  /** 节点作用域下某渠道本级已配的目录；兼容旧的单值 `outputDir` */
  const resolveDirs = (mediaId: string): string[] => {
    if (isGlobal) return mediaOutputDirs[mediaId] ?? []
    const entry = override?.byMedia?.[mediaId]
    return normalizeOutputDirList(entry?.outputDirs ?? (entry?.outputDir ? [entry.outputDir] : []))
  }

  const apply = (patch: PostprocessNodeOverride) => {
    if (isGlobal) return
    setPostprocessOverride(scope, patch)
  }

  const handleChangeDir = (mediaId: string, index: number, value: string) => {
    if (isGlobal) {
      setMediaOutputDir(mediaId, index, value)
      return
    }
    const slots = [...resolveDirs(mediaId)]
    while (slots.length <= index) slots.push('')
    slots[index] = value
    const next = normalizeOutputDirList(slots)
    // 同时写 `outputDirs` 并摘掉旧的单值 `outputDir`：两个字段并存时以 `outputDirs` 为准，
    // 留着旧值只会让「界面上显示的」和「实际生效的」不一致。
    apply({ byMedia: { [mediaId]: { outputDirs: next.length > 0 ? next : undefined, outputDir: undefined } } })
  }

  /**
   * 删掉某渠道的第 `index` 个位置，其余位置上移（删到一个不剩 = 该渠道回到「留空」）。
   *
   * 两个作用域都**整份重写**而不是逐槽位改：`setMediaOutputDir` 只能按槽位写，
   * 「删中间一格、后面的往前顶」要写多次才表达得出来，而节点层的 `apply` 读的是本轮 props
   * 里的旧值 —— 连着写两次，第二笔会基于过期数据。一次写，两条链路才等价。
   */
  const handleRemoveDir = (mediaId: string, index: number) => {
    const next = resolveDirs(mediaId).filter((_, slot) => slot !== index)
    if (isGlobal) {
      clearMediaOutputDirs(mediaId)
      next.forEach((dir, slot) => setMediaOutputDir(mediaId, slot, dir))
      return
    }
    apply({ byMedia: { [mediaId]: { outputDirs: next.length > 0 ? next : undefined, outputDir: undefined } } })
  }

  /**
   * 本渠道留空后会落到哪 —— 返回**继承来的全部位置**（可能 1~2 个），走产出链同一个解析函数。
   *
   * ⚠️ 这里必须复用 `resolveProjectPostprocessSlice`，**不能自己扫父节点的 `byMedia`**
   * （2026-09-22 TB-095 修的就是这个）。手扫那一版有三处错，而且错得都很安静：
   * ① 只取列表第 1 个 → 上一级配了两个位置时界面只念一个，产出侧却两处都写；
   * ② 只看**直接父节点** → 上一级没配、更上层配了时，报成「落到默认输出位置」；
   * ③ 只看 `byMedia` → 上一级用通用 `outputDir` 覆盖时同样报错。
   * 生效值只该有一套推导（本文件头注第 29 条的理由，这段就是当时的漏网之鱼）。
   *
   * 口径是**含本级**：占位提示只在框空时可见，框空 ⇒ 该渠道本级没配 `byMedia` 目录；
   * 但本级可能写了通用 `outputDir`（它同样管这个渠道），含本级解析才能把它算进来。
   */
  const resolveInheritedDirs = useMemo(() => {
    // 全局层没有上级：留空就落到默认输出位置；那条位置本身为空时给一句兜底文案
    if (isGlobal) return (): string[] => [outputDir.trim() || '本地保存目录下的 postprocess']
    return (mediaId: string): string[] =>
      resolvePostprocessOutputDirs(
        resolveProjectPostprocessSlice(collections, params, scope, globalConfig, mediaId).config,
        mediaId,
      )
  }, [collections, globalConfig, isGlobal, outputDir, params, scope])

  /**
   * 有节点级输出覆盖的方向数。只在**全局作用域**下提示——切到节点作用域时用户正在编辑覆盖本身，
   * 再警告「有覆盖」就成了自指噪音。
   *
   * 只统计真的写了 `outputDir` 或 `byMedia[*].outputDirs` 的节点：只有一个 `enabled`
   * 的节点不算，否则这个数会把「所有开过后处理面板的方向」都算进来。
   */
  const overriddenCount = useMemo(() => {
    if (!isGlobal) return { count: 0, names: [] as string[] }
    // 名称 → id 的映射，仅用于把提示说得具体（用户认的是方向名，不是 id）
    const nameOf = new Map(collections.map((item) => [item.id, item.name]))
    let count = 0
    const names: string[] = []
    for (const [collectionId, entry] of Object.entries(params)) {
      if (collectionId === scope) continue
      const item = entry?.postprocess
      if (!item) continue
      const hasDir = typeof item.outputDir === 'string' && item.outputDir.trim().length > 0
      // byMedia 有两种写法：新的 `outputDirs` 数组与兼容用的旧单值 `outputDir`，两种都要算
      const hasByMedia =
        item.byMedia !== undefined &&
        Object.values(item.byMedia).some((value) => {
          if (!value) return false
          if (value.outputDirs !== undefined && value.outputDirs.length > 0) return true
          return typeof value.outputDir === 'string' && value.outputDir.trim().length > 0
        })
      if (!hasDir && !hasByMedia) continue
      count += 1
      if (names.length < 5) names.push(nameOf.get(collectionId) ?? collectionId)
    }
    return { count, names }
  }, [collections, params, isGlobal, scope])

  /** 纯净版不是渠道（不产渠道变体、也没有独立的导出位置），但同样是一个可勾选的产出项。 */
  const pureMedia = media.find((item) => item.id === PURE_MEDIA_ID) ?? null

  const defaultDirLabel = outputDir.trim() || '本地保存目录下的 postprocess'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <SectionHeader
          title="渠道与输出"
          description={
            isGlobal
              ? '全局共享规格：每个渠道产出哪些尺寸、体积上限多少、导出到哪。「参与产出」在这里是基线，某个方向要不一样就在左边树里点它再改；下面的命名、分发与产出预览是全局一套。'
              : '渠道名与尺寸规格是所有方向共用的一份（改这里等于改所有方向）；这个方向能改的是「参与产出」与各渠道的导出位置，留空则沿树向上继承。'
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {/*
         * 作用域说明条。两条互斥（一条给节点作用域、一条给全局），合起来回答：
         * 「我现在在改谁」「留空会退到哪」「渠道没配位置时产物落哪」。
         */}
        {!isGlobal && (
          <div className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 dark:bg-ds-surface-subtle">
            <Inline gap={2} wrap={false}>
              <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">参与渠道</span>
              {ownSelectedMediaIds === undefined ? (
                <span className="truncate text-xs text-ds-text dark:text-ds-text">跟随「{inheritedFromLabel}」</span>
              ) : (
                <>
                  <Badge tone="info">本级自定义</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    // 置 `undefined`（= 恢复继承）而不是 `[]`：`[]` 是「一个渠道都不投」，那是另一个意思
                    onClick={() => setPostprocessOverride(scope, { selectedMediaIds: undefined })}
                  >
                    改为跟随上级
                  </Button>
                </>
              )}
              <span className="min-w-0 flex-1" />
              {/*
               * 说清「留空往哪退」的**兜底终点** —— 具体到每个渠道的落点由表格每格的灰字给
               * （`formatInheritedOutputDirsHint`）。这里再写一遍「落到某目录」会与那些灰字打架：
               * 上一级配过位置时，空框落的是上一级那几处，不是这句里的默认位置（TB-095）。
               */}
              <span className="shrink-0 truncate text-xs text-ds-muted dark:text-ds-muted">
                导出位置留空则沿树向上继承；整条链都没配过才落到 {defaultDirLabel}
              </span>
            </Inline>
          </div>
        )}

        {isGlobal && (
          <div className="mb-3 flex items-center gap-2 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 dark:border-ds-border dark:bg-ds-surface-subtle">
            <span className="text-xs text-ds-muted dark:text-ds-muted">默认输出位置</span>
            <span className="truncate font-mono text-xs text-ds-text dark:text-ds-text">{defaultDirLabel}</span>
            <Badge tone="neutral" className="ml-auto shrink-0">
              渠道未配时落到这里
            </Badge>
          </div>
        )}

        {isGlobal && overriddenCount.count > 0 && (
          <Alert tone="warning" className="mb-3">
            有 <strong>{overriddenCount.count}</strong> 个方向配了节点级覆盖
            {overriddenCount.names.length > 0 && `（如 ${overriddenCount.names.join('、')}）`}
            ，它们<strong>不受下面这套全局配置影响</strong>。在左侧树点那个节点即可直接改。
          </Alert>
        )}

        {/*
         * 画面方向：它决定「每个渠道取用哪一组尺寸」，与下面的渠道表是同一件事的两半，
         * 所以放在表上方而不是另开分区。
         * 默认「跟随尺寸」即按源图比例自动判，只有要整批强制横/竖时才需要动它。
         *
         * ⚠️ 它仍是**全局一套**（ADR-0011 没有把它开放到节点层）—— 所以在节点作用域里
         * 要显式标出来，否则会被上面那条「跟随/本级自定义」的来源提示连带误导。
         */}
        <section
          data-layout="console-direction"
          className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-ds-text dark:text-ds-text">
                画面方向
                <span className="ml-2 text-xs font-normal text-ds-muted dark:text-ds-muted">全局一套</span>
              </p>
              <p className="text-xs text-ds-muted dark:text-ds-muted">
                决定每个渠道取用哪一组尺寸。默认按源图比例自动判，需要整批强制横 / 竖时在这里覆盖。
              </p>
            </div>
            <div className="ml-auto shrink-0">
              <SegmentedControl
                aria-label="画面方向"
                value={direction ?? 'auto'}
                options={DIRECTION_OPTIONS}
                onValueChange={(value) => setDirection(value === 'auto' ? null : value)}
              />
            </div>
          </div>
        </section>

        {/*
         * 「画面适配」：与「画面方向」并排的另一个**整批规格** ——
         * 方向决定每个渠道取用哪一组尺寸，适配决定源图怎么放进那组尺寸，两者配合才是一张成品。
         *
         * 同样是**全局一套**（不做方向级继承，理由见 `PostprocessMediaConfig.fitMode`）。
         */}
        <section
          data-layout="console-fit-mode"
          className="mb-3 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-ds-text dark:text-ds-text">
                画面适配
                <span className="ml-2 text-xs font-normal text-ds-muted dark:text-ds-muted">全局一套</span>
              </p>
              {/*
               * 只显示**当前选中**那条的代价：三条一起铺开会把这一区撑成一段说明文字，
               * 而用户做决定时真正要看的只有「我选的这个有什么坑」。
               */}
              <p className="text-xs text-ds-muted dark:text-ds-muted">{FIT_MODE_HINT[fitMode]}</p>
            </div>
            <div className="ml-auto shrink-0">
              <SegmentedControl
                aria-label="画面适配"
                value={fitMode}
                options={FIT_MODE_OPTIONS}
                onValueChange={setFitMode}
              />
            </div>
          </div>
        </section>

        <ConsoleMediaTables
          selectedMediaIds={effectiveSelectedMediaIds}
          onToggleSelected={toggleSelected}
          participationScopeLabel={isGlobal ? '全局基线' : (scopeNode?.name ?? '已删除节点')}
          resolveDirs={resolveDirs}
          resolveInheritedDirs={resolveInheritedDirs}
          onChangeDir={handleChangeDir}
          onRemoveDir={handleRemoveDir}
          onPickError={() => showToast('选择导出位置失败，请重试', 'error')}
        />

        {/* 纯净版单独一栏：它不是渠道（不产渠道变体），塞进渠道表会让「详细尺寸」那格对它失去意义；
            它的导出位置也没有渠道级的说法，固定沿用默认输出位置。 */}
        {pureMedia && (
          <section
            data-layout="console-pure-media"
            className="mt-4 rounded-ds-lg border border-ds-border bg-ds-surface px-3 py-2 dark:border-ds-border dark:bg-ds-scrim"
          >
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={effectiveSelectedMediaIds.includes(pureMedia.id)}
                onChange={(next) => toggleSelected(pureMedia.id, next)}
                aria-label={`${effectiveSelectedMediaIds.includes(pureMedia.id) ? '取消应用' : '应用'}纯净版`}
              />
              <span className="text-sm font-medium text-ds-text dark:text-ds-text">{pureMedia.name}</span>
              <span className="text-xs text-ds-muted dark:text-ds-muted">
                不产渠道变体，只产一份无水印原图；输出到默认输出位置
              </span>
            </label>
          </section>
        )}

        {/*
         * 下面三节是**全局一套**的参数（命名 / 分发 / 产出预览），不随作用域切换而变。
         * 原先它们在「后处理」弹窗的全局作用域里，2026-09-20 弹窗收窄为方向级后搬到中控台 ——
         * 中控台是全部参数的统一编辑入口，全局参数不该只剩一个已经删掉的入口。
         * 各自在小节标题里写明「全局一套」，**不靠分区级提示条代言**。
         */}
        <div className="mt-5 border-t border-ds-border pt-4">
          <SectionHeader title="文件命名" description="全局一套：产出文件名由模板拼出，不按方向分。" />
          <div className="mt-3">
            <PostprocessNamingFields />
          </div>
        </div>

        <div className="mt-5 border-t border-ds-border pt-4">
          <SectionHeader
            title="分发"
            description="排期（铺几天 / 跳过周末）跟着左边树选的方向走；其余是全局一套：按天把产出分散到日期目录。"
          />
          <div className="mt-3">
            <DistributionSection scope={scope} />
          </div>
        </div>

        <div className="mt-5 border-t border-ds-border pt-4">
          <PostprocessOutputPreview scope={scope} />
        </div>

        {/*
          历史产出（TB-115）：**跟着作用域走** —— 左边树点哪个方向，这里就是哪个方向的历史。
          与上面「产出预览」配成事前 / 事后一对：预览回答「再跑会出什么」，这里回答「上次实际出了什么、
          写到哪了」。与素材库那个「后处理进度」面板不重复：那边一屏看全部方向，这边只看手上这个。
        */}
        <div className="mt-5 border-t border-ds-border pt-4">
          <SectionHeader
            title="历史产出"
            description={
              isGlobal
                ? '全部方向的历史：每次产到哪几个方向、写到哪些目录、有没有出错。长期保留，重启后仍在。'
                : '这个方向的历史：每次产到哪几个方向、写到哪些目录、有没有出错。长期保留；每条都能直接打开产出所在位置。'
            }
          />
          <div className="mt-3">
            <PostprocessHistoryList directionIds={historyDirectionIds} />
          </div>
        </div>
      </div>
    </div>
  )
}
