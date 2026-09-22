/**
 * 后处理参数面板（**方向级**参数的唯一编辑区）。
 *
 * 它不认识任何具体字段：读 `paramSchema` 的字段列表与分组，按 `control` 分派到对应控件。
 * 加一个字段 = 在元数据表里加一项，这里不改代码。
 *
 * ## 作用域
 *
 * 只服务**项目树上的一个节点**（方向 / 产品 / 产品线），读写 `useProjectTreeParamsStore`
 * 的覆盖切片：每个字段带「本级自定义 / 继承自某某」标记与「恢复继承」。
 * 覆盖写成 `undefined` 而不是写入当前值 —— 写入会把值固化在本级，以后改上层再也影响不到它。
 *
 * 全局基线（渠道与尺寸、画面方向、命名模板、创作者、分发等）**不在这个面板里**：
 * 它们是全局独有参数，中控台各自的分区有唯一入口，面板里只出现**跳转入口**与继承结果。
 *
 * ## 布局依据（`design-system/tangbao/MASTER.md`，不是自创）
 *
 * **2026-09-21 去掉分组卡片与标题**（用户实测反馈「一个开关占了两行」「卡片标题一点用都没有」）：
 * 原先三个分组各是一个带 `legend` 的 `Fieldset`，标题自己占一行；现在分组只用一条
 * 1px `Divider` 分隔，标题不渲染 —— 组内的字段名（「自动后处理」「输出目录」「水印归属」）
 * 本来就说清了这一段是什么。于是：
 *
 * - **参与方式 / 输出位置**各只占一行（标签、继承状态、说明、控件同行）；
 * - **水印**是「顶部一行：文案 + 按渠道 tab + 跳转入口」+「下方 16:9 预览区」。
 *
 * - **栅格**（§4.4）：字段行走 `FormGrid` 的 **12 列固定列模板**（标签 4 列 / 控件 8 列，
 *   跨度写在 `.ds-form-grid__*` 里）。对齐由列模板决定 —— 原先 flex 的「14rem + 20rem」
 *   是两个最小宽度，宽屏时控件被拉长、窄屏时折行，控件左边界根本不成基线。
 * - **层级**（§5.9 复杂弹窗）：`DialogPane → 分隔线分区 → 字段行`。
 *   组不再用带边框的框：三组框彼此同级，与状态行也分不出主次（§5.9 禁止 DialogPane 里再套大卡片）。
 * - **字号**（§4.3「常用字号 12/13/14/16」「标签 500、标题 600」）：
 *   字段名 14/500 → 帮助文本 12/400 → 状态徽章 12/500。层级靠字号与字重，不靠压暗文字。
 * - **间距**（§4.4 标尺）：组间 20px（`Stack gap={5}`）、组内 16px（`FormGrid rowGap`）、
 *   标签列↔控件列 20px（栅格列间距）、控件内 8px（`Inline gap={2}`）。
 *   全部取自 `--ds-space-*`，不出现 14px / 6px 这类标尺外的值。
 * - **表单**（§5.3）：标签可见；placeholder 只放示例；继承路径这类「会变化的信息」放持续可见的帮助文本。
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AspectRatio,
  Badge,
  Button,
  Divider,
  EmptyState,
  FormGrid,
  FormGridControl,
  FormGridFull,
  FormGridLabel,
  Inline,
  Stack,
  Switch,
  Tabs,
  TextField,
} from '../../design-system'
import ChannelOutputDirs from './ChannelOutputDirs'
import { normalizeOutputDirList, resolvePostprocessOutputDirs } from '../../lib/postprocessMedia'
import type { PostprocessMediaConfig, PostprocessNodeOverride } from '../../lib/postprocessMedia'
import { isCollectionWithinSelection, resolveCollectionPath } from '../../lib/postprocessProjectTree'
import { useStore } from '../../store'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useCompositeV2Store } from '../composite/storeV2'
import { renderCompositeV2ToCanvas } from '../composite/lib/compositeRendererV2'
import type { CompositeV2Preset } from '../composite/lib/compositeV2Types'
import { useJumpToControlConsole } from '../composite/lib/useJumpToControlConsole'
import { useJumpToProjectTree } from '../projectTree/useJumpToProjectTree'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { resolveNodeWatermarkBinding } from '../projectTree/params'
import {
  resolveProjectNodeIdChain,
  resolveProjectNodeKind,
  resolveProjectNodePathNames,
  resolveProjectPostprocessSlice,
} from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { PROJECT_NODE_KIND_LABELS } from '../projectTree/types'
import { selectParamFieldsByGroup, type PostprocessParamField } from './paramSchema'
import { formatParticipationLabel } from './participationLabel'

interface Props {
  /** 当前编辑的项目树节点 id（真实 `AssetCollection.id`；全局基线不在本面板编辑） */
  selectedNodeId: string
  /** 全局基线配置（由宿主组装）—— 这里只作为**继承来源** */
  globalConfig: PostprocessMediaConfig
  /** 勾选的启用范围（判断该节点是否真的会产出） */
  enabledScopeIds: string[]
  /**
   * 请宿主关闭弹窗。
   *
   * 用在「跳到别处」的动作上（目前是「去项目树启用」）：不关的话后处理弹窗会留在原地，
   * 叠在刚打开的项目树工作台上，用户得先关一层才能操作。
   */
  onRequestClose: () => void
}

/**
 * 字段行：栅格里的「标签槽 + 控件槽」。
 *
 * **对齐靠列模板，不靠内容碰运气**：这一对槽由 `FormGrid` 的 12 列模板决定
 * （标签 4 列 / 控件 8 列），于是同一张表单里所有字段的控件左边界落在同一条栅格线上，
 * 与标签文字长短无关。原先的 flex「basis-56 + basis-80」做不到这点 ——
 * 两列都是最小宽度，宽屏时控件列被拉长、窄屏时整块折行。
 *
 * **字号层级**（MASTER §4.3「常用字号 12/13/14/16」「标签 500、标题 600」）：
 * 字段名 14/500（正文默认字号）→ 帮助文本 12/400 → 状态徽章 12/500。
 * 三档靠**字号 + 字重**拉开，不靠压暗文字（规范：「不要用低对比度代替层级」）。
 */
function FieldRow({
  field,
  help,
  overridden,
  sourceHint,
  onReset,
  full,
  children,
}: {
  field: PostprocessParamField
  /** 覆盖字段自带的说明（只有需要拼动态信息时才传，如输出目录的继承路径） */
  help?: React.ReactNode
  overridden: boolean
  sourceHint: string
  onReset?: () => void
  /**
   * 跨整行的附加内容。
   *
   * 用于「一整组」而不是单个值的东西（目前只有按渠道的目录表格）——
   * 它塞进控件槽会被压得读不了（实测中文共享盘路径被截成 `\192.168.202.:`）。
   */
  full?: React.ReactNode
  children: React.ReactNode
}) {
  const helpText = help ?? field.help
  const labelNode = (
    <>
      <span className="text-sm font-medium text-ds-text">{field.label}</span>
      {onReset &&
        (overridden ? (
          <>
            <Badge tone="info">本级自定义</Badge>
            <Button variant="ghost" size="sm" onClick={onReset}>
              恢复继承
            </Button>
          </>
        ) : (
          <span className="text-xs text-ds-muted">{sourceHint}</span>
        ))}
    </>
  )

  /*
   * 整块式（`layout: 'full'`）：字段自带全部内容（水印归属的 tab 行 + 预览），
   * 面板只给它一个跨行槽。标签由字段自己渲染 —— 它要跟 tab 挤在同一行里，
   * 不能另起一列（那样 tab 就掉到第二行了，正是 2026-09-21 被报障的形态）。
   */
  if (field.layout === 'full') {
    return <FormGridFull>{children}</FormGridFull>
  }

  /*
   * 单行式（`layout: 'inline'`）：标签、徽章、说明、控件**全在一行**。
   *
   * 只给开关这类「一个控件就说完了」的字段用 —— 常规两槽布局会把它拆成
   * 「左边标签 + 说明两行、右边一个开关」，一个开关吃掉两行高度（2026-09-20 反馈）。
   * 控件自己决定怎么占位：开关用 `ml-auto` 靠右，输入框用 `flex-1` 撑开。
   */
  if (field.layout === 'inline') {
    return (
      <FormGridFull>
        <Inline gap={3}>
          {labelNode}
          {helpText && <span className="text-xs text-ds-muted">{helpText}</span>}
          {children}
        </Inline>
        {full}
      </FormGridFull>
    )
  }

  return (
    <>
      <FormGridLabel>
        <Inline gap={2}>{labelNode}</Inline>
        {helpText && <p className="mt-1 text-xs leading-normal text-ds-muted">{helpText}</p>}
      </FormGridLabel>
      <FormGridControl>{children}</FormGridControl>
      {full && <FormGridFull>{full}</FormGridFull>}
    </>
  )
}

export default function PostprocessParamPanel({
  selectedNodeId,
  globalConfig,
  enabledScopeIds,
  onRequestClose,
}: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const clearNodeParams = useProjectTreeParamsStore((state) => state.clearNodeParams)
  const showToast = useStore((state) => state.showToast)
  const jumpToProjectTree = useJumpToProjectTree()

  const media = globalConfig.media

  // 节点已删除（弹窗开着时另一处删掉了它）→ 退化为空状态，不抛错
  const node = useMemo(() => collections.find((item) => item.id === selectedNodeId), [collections, selectedNodeId])
  const nodeMissing = !node

  const override = params[selectedNodeId]?.postprocess

  const slice = useMemo(
    () => resolveProjectPostprocessSlice(collections, params, selectedNodeId, globalConfig),
    [collections, params, selectedNodeId, globalConfig],
  )

  const effective = slice?.config

  const sourceName = (() => {
    if (!slice) return ''
    if (!slice.sourcedFrom) return '继承自全局默认'
    const source = collections.find((item) => item.id === slice.sourcedFrom)
    return slice.sourcedFrom === selectedNodeId ? '本级自定义' : `继承自「${source?.name ?? '已删除节点'}」`
  })()

  const fullPath = useMemo(() => {
    const names = resolveProjectNodePathNames(collections, selectedNodeId)
    return [names.line, names.product, names.direction].filter(Boolean).join(' / ')
  }, [collections, selectedNodeId])

  const depth = useMemo(
    () => Math.max(0, resolveProjectNodeIdChain(collections, selectedNodeId).length - 1),
    [collections, selectedNodeId],
  )

  const inEnabledScope = useMemo(
    () => isCollectionWithinSelection(collections, selectedNodeId, enabledScopeIds),
    [collections, selectedNodeId, enabledScopeIds],
  )

  /**
   * 某渠道**本级已配**的导出位置（1~2 个）；空数组 = 本级没配。
   *
   * 节点层兼容旧的单值字段 `outputDir`：已导入的数据按渠道目录写在那上面，
   * 不读它就等于用户升级后看到「按渠道配的目录全没了」。
   */
  const resolveDirs = (mediaId: string): string[] => {
    const entry = override?.byMedia?.[mediaId]
    return normalizeOutputDirList(entry?.outputDirs ?? (entry?.outputDir ? [entry.outputDir] : []))
  }

  const writeDirs = (mediaId: string, index: number, outputDir: string) => {
    const slots = [...resolveDirs(mediaId)]
    while (slots.length <= index) slots.push('')
    slots[index] = outputDir
    const next = normalizeOutputDirList(slots)
    // 同时写 `outputDirs` 并摘掉旧的单值 `outputDir`：两个字段并存时以 `outputDirs` 为准，
    // 留着旧值只会让「界面上显示的」和「实际生效的」不一致。
    apply({ byMedia: { [mediaId]: { outputDirs: next.length > 0 ? next : undefined, outputDir: undefined } } })
  }

  /**
   * 删掉某渠道的第 `index` 个位置，其余位置上移（删到一个不剩 = 该渠道回到「留空」= 继续向上继承）。
   *
   * 整份重写而不是逐槽位改：`writeDirs` 读的是本轮 props 里的旧值，
   * 一次事件里连写两笔的话，第二笔会基于过期数据（`byMedia` 只认最后一次 `apply`）。
   */
  const removeDirs = (mediaId: string, index: number) => {
    const next = resolveDirs(mediaId).filter((_, slot) => slot !== index)
    apply({ byMedia: { [mediaId]: { outputDirs: next.length > 0 ? next : undefined, outputDir: undefined } } })
  }

  /**
   * 本渠道去掉本级覆盖后会落到**哪些**位置（1~2 个）。
   *
   * ⚠️ 两个坑（TB-095）：
   * ① 必须取**按渠道**的生效列表（`resolvePostprocessOutputDirs`），不能只看 `config.outputDir` ——
   *    按渠道配的目录存在 `mediaOutputDirs[mediaId]` 里，`config.outputDir` 看不到它，
   *    于是父级配过「百度 → 两个位置」时这里会恒定报成默认位置；
   * ② 必须把列表**全给出去**：上一级配两处时只说第一个，用户会以为「跟随只跟一处」，
   *    而产出侧两处都写。
   *
   * 口径是**含本级**：占位提示只在框空时可见，框空 ⇒ 该渠道本级没配 `byMedia` 目录；
   * 但本级可能写了通用 `outputDir`（它同样管这个渠道），含本级解析才能把它算进来。
   */
  const inheritedDirsByMedia = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const item of media) {
      const sliceHere = resolveProjectPostprocessSlice(collections, params, selectedNodeId, globalConfig, item.id)
      map[item.id] = resolvePostprocessOutputDirs(sliceHere.config, item.id)
    }
    return map
  }, [selectedNodeId, collections, params, media, globalConfig])

  /**
   * 「输出目录」留空后会落到哪个目录。
   *
   * 它进**帮助文本**而不是 placeholder：MASTER §5.3「placeholder 只展示示例」，
   * 而这是一条会随继承链变化的信息，恰好属于「复杂字段提供持续可见的帮助文本」。
   */
  const inheritedOutputDir = useMemo(() => {
    const path = resolveCollectionPath(collections, selectedNodeId)
    const parentId = path.length >= 2 ? path[path.length - 2].id : null
    const sliceUp = resolveProjectPostprocessSlice(collections, params, parentId, globalConfig)
    return sliceUp.config.outputDir || '默认输出位置'
  }, [selectedNodeId, collections, params, globalConfig])

  const pickDirectory = async (onPicked: (path: string) => void) => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) onPicked(path)
    } catch {
      showToast('选择目录失败，请重试', 'error')
    }
  }

  const apply = (patch: PostprocessNodeOverride) => {
    setPostprocessOverride(selectedNodeId, patch)
  }

  const reset = (key: keyof PostprocessNodeOverride) => apply({ [key]: undefined })
  const overridden = (key: string) => override?.[key as keyof PostprocessNodeOverride] !== undefined

  // ── 空状态 ──────────────────────────────────────────────────────────────
  if (nodeMissing) {
    return (
      <EmptyState
        title="节点已被删除"
        description="这个方向在别处被删掉了。请在项目树里重新建一个，或在上方选另一个方向。"
      />
    )
  }

  if (!effective) {
    return <EmptyState title="无法读取参数" description="该方向的参数解析失败，请关闭弹窗后重试。" />
  }

  const groups = selectParamFieldsByGroup()
  const hasOverride = Boolean(override && Object.keys(override).length > 0)

  /** 按 `control` 分派渲染。加字段只改 paramSchema，这里不动。 */
  const renderControl = (field: PostprocessParamField) => {
    switch (field.control) {
      case 'enabled': {
        const enabled = slice?.enabled ?? true
        return (
          // `w-fit` 必须：`.ds-switch` 是 `justify-content: space-between` 的 flex，
          // 放进撑满宽度的控件列会把开关甩到最右、中间留一大片空。
          // `ml-auto` 把它推到行尾（整行式布局里没有 spacer，靠它占剩余空间）。
          // `aria-label` 给无障碍名称（可见的字段名在左侧标签位里，不在 `<label>` 内）。
          // 文案走 formatParticipationLabel：不在启用范围时必须能读出「未生效」，
          // 否则它会与上方那句「不会产出渠道变体」的警告互相打脸。
          // 同时**刻意不置灰**：范围外仍然允许改这个值（先把参数配好，等方向进了范围即生效），
          // 既有契约也是「开关随时可写」，把交互拿掉等于单方面改契约。
          // `title` 负责解释它当前为什么不影响产出。
          <div
            className="ml-auto w-fit"
            title={
              inEnabledScope ? undefined : '这个方向不在后处理的启用范围内，开关值当前不影响产出；请先到项目树启用'
            }
          >
            <Switch
              checked={enabled}
              onCheckedChange={(next) => apply({ enabled: next })}
              label={formatParticipationLabel(enabled, inEnabledScope)}
              aria-label={field.label}
            />
          </div>
        )
      }

      case 'outputDir':
        // 按渠道的目录列表**不在这里** —— 它走 `renderFieldFull` 落到跨行槽（见那边的注释）
        return (
          <Inline gap={2}>
            <TextField
              label=""
              aria-label={field.label}
              // ⚠️ 撑开宽度必须写 `containerClassName`：`className` 落到内层 `<input>` 上，
              // 外层 `.ds-field` 是 `display:grid`，写错位置输入框就按内容宽度定死、右侧留一大片空。
              containerClassName="min-w-0 flex-1"
              value={effective.outputDir}
              placeholder="如 D:\导出"
              // 清空 = 恢复继承（`undefined`），不写空串。写空串是一条**显式**「用默认输出位置」的
              // 声明，会把上级（含全局默认输出目录）一起挡掉，界面上却看不出区别。
              onChange={(event) => {
                const next = event.target.value
                apply({ outputDir: next.trim() ? next : undefined })
              }}
            />
            <Button variant="secondary" onClick={() => void pickDirectory((path) => apply({ outputDir: path }))}>
              选择…
            </Button>
          </Inline>
        )

      case 'watermarkBinding':
        return <WatermarkBindingSummary selectedNodeId={selectedNodeId} label={field.label} hint={field.help} />
    }
  }

  /**
   * 字段的**跨行内容**：只有「输出目录」有 —— 按渠道的目录表格。
   *
   * 为什么必须跨整行：它是一张「渠道 × 位置」的表，每一行自身还要
   * 「渠道名 + 输入框 + 图标按钮 + 操作」，挤在控件槽里会把中文共享盘路径
   * 截成 `\192.168.202.:`（2026-09-20 实测踩过）—— 用户核对不了路径，这屏就白给了。
   */
  const renderFieldFull = (field: PostprocessParamField) => {
    if (field.control !== 'outputDir') return null
    return (
      <ChannelOutputDirs
        media={media}
        resolveDirs={resolveDirs}
        resolveInheritedDirs={(mediaId) => inheritedDirsByMedia[mediaId] ?? []}
        onChangeDir={writeDirs}
        onRemoveDir={removeDirs}
        onPickError={() => showToast('选择导出位置失败，请重试', 'error')}
      />
    )
  }

  return (
    <Stack gap={5}>
      {/*
       * 状态行（MASTER §5.9 的 Status 层）：当前改的是谁、值从哪来。
       *
       * 刻意**不再用卡片**：原来它是一个 `Surface` 框，与下面三个分组同为「带边框的框」，
       * 层级分不出来 —— 而它其实是**元信息**，不是可编辑模块。
       */}
      <Stack gap={4}>
        <Inline gap={3}>
          <Badge tone="neutral">{PROJECT_NODE_KIND_LABELS[resolveProjectNodeKind(depth)]}</Badge>
          <span className="min-w-0 flex-1 truncate text-sm text-ds-text" title={fullPath}>
            {fullPath || '（无路径）'}
          </span>
          <span className="shrink-0 text-xs text-ds-muted">来源：{sourceName}</span>
          {hasOverride && (
            <Button variant="ghost" size="sm" onClick={() => clearNodeParams(selectedNodeId)}>
              清空本级参数
            </Button>
          )}
        </Inline>

        {/*
         * 未启用范围：**必须给出真的能到那儿的入口**（MASTER §5.6 同一口径）。
         * 启用范围的唯一编辑点是项目树的「后处理」列 —— 只写一句「请在项目树里勾选」，
         * 用户只能自己回素材库、点「项目树」、再在几十行里翻出这个方向。
         */}
        {!inEnabledScope && (
          <Stack gap={2}>
            <Alert tone="warning">未启用后处理，不会产出变体。</Alert>
            <Inline gap={2} justify="flex-end">
              <Button
                variant="secondary"
                size="sm"
                title="打开项目树的「后处理」列，把这个方向（或它的上级）勾上"
                onClick={() => {
                  onRequestClose()
                  jumpToProjectTree(selectedNodeId)
                }}
              >
                去项目树启用
              </Button>
            </Inline>
          </Stack>
        )}
      </Stack>

      {/*
       * 分组之间只用一条 1px 分隔线（MASTER §5.9 的层级手法）。
       *
       * 原先每组是一个带 `legend` 的 `Fieldset`——标题自己占一行，一个开关就吃掉两行
       * （2026-09-21 反馈：「我已经明确说了用一行」「卡片标题一点用都没有」）。
       * 组内的字段名本来就说清了这段是什么，标题纯属重复。
       */}
      {groups.map(({ group, fields }, index) => (
        <Fragment key={group.id}>
          {index > 0 && <Divider />}
          <FormGrid>
            {fields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                help={field.key === 'outputDir' ? `留空则继承上级（${inheritedOutputDir}）` : undefined}
                overridden={overridden(field.key)}
                sourceHint={sourceName}
                onReset={field.resettable ? () => reset(field.key as keyof PostprocessNodeOverride) : undefined}
                full={renderFieldFull(field)}
              >
                {renderControl(field)}
              </FieldRow>
            ))}
          </FormGrid>
        </Fragment>
      ))}
    </Stack>
  )
}

/** 水印预览舞台的渲染尺寸：16:9。水印的缩放由渲染器按目标尺寸算，与产出链路同一套。 */
const STAGE_SIZE = { width: 640, height: 360 }

/**
 * 预览里的一层水印：把预设**真实渲染**到 16:9 画布上（与产出用同一个渲染器）。
 *
 * 为什么不画示意块：这一块的全部意义是**核对** —— 用户要确认这个渠道叠的到底是哪几套、
 * 长什么样。用占位块等于让他去中控台再看一遍。
 */
function WatermarkStageLayer({ preset }: { preset: CompositeV2Preset }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let stale = false
    void renderCompositeV2ToCanvas({ preset, targetSize: STAGE_SIZE, fitMode: 'crop-fill' }, canvas, {
      isStale: () => stale,
    }).catch(() => {
      // 无 canvas 的环境（jsdom）或单层渲染失败：这一层透明，不影响其余层与任何写入
    })
    return () => {
      stale = true
    }
    // 预设内容变化（改图层/改画布）要重绘，所以依赖整个 preset 引用
  }, [preset])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
}

/**
 * 水印归属：**顶部一行是参数文案 + 按渠道的 tab，下方是 16:9 预览区**。
 *
 * 布局来由（2026-09-21 反馈「参数文案、tab 位于顶部，下方展示 16:9 的预览区」）：
 * 上一版把文案放在左边的标签列里，tab 挤在控件列 —— 左边空、右边挤，预览还是竖版缩略图。
 * 现在整块跨满 12 列：一行说清「这是什么 + 看哪个渠道 + 去哪改」，下面给够宽度的画面。
 *
 * tab 上的圆点是状态提示，但**预览区同时有文字状态**（「叠 N 套水印」/「不叠水印」）——
 * 规范要求状态不能只靠颜色表达。
 *
 * 仍然**只读**：编辑入口在中控台的水印分区（那边才有画布编辑器），这里放第二个编辑面只会打架。
 */
function WatermarkBindingSummary({
  selectedNodeId,
  label,
  hint,
}: {
  selectedNodeId: string
  label: string
  hint?: string
}) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const media = usePostprocessMediaStore((state) => state.media)
  const presets = useCompositeV2Store((state) => state.presets)
  const jumpToConsole = useJumpToControlConsole()

  const presetById = useMemo(() => new Map(presets.map((preset) => [preset.id, preset])), [presets])

  const rows = media.map((item) => {
    const binding = resolveNodeWatermarkBinding(collections, params, selectedNodeId, globalWatermarkPresetIds, item.id)
    return { mediaId: item.id, name: item.name, presetIds: binding.presetIds }
  })

  /** 当前查看的渠道。默认第一个；切换方向或渠道被删时回落到第一个，不留空白 */
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null)
  const activeRow = rows.find((row) => row.mediaId === activeMediaId) ?? rows[0]

  if (!activeRow) return <p className="text-xs text-ds-muted">媒体表为空。</p>

  // 预设可能已被删除：悬空 id 不能静默咽掉，否则用户以为还叠着那套水印
  const activePresets = activeRow.presetIds
    .map((presetId) => presetById.get(presetId))
    .filter((preset): preset is CompositeV2Preset => Boolean(preset))
  const missingCount = activeRow.presetIds.length - activePresets.length

  return (
    <Stack gap={3}>
      {/* 顶部一行：参数文案（这是什么）+ tab（看哪个渠道）+ 跳转入口（要改去哪） */}
      <Inline gap={3}>
        <span className="text-sm font-medium text-ds-text">{label}</span>
        {hint && <span className="text-xs text-ds-muted">{hint}</span>}
        <Tabs
          aria-label="按渠道查看水印"
          size="sm"
          value={activeRow.mediaId}
          items={rows.map((row) => ({
            value: row.mediaId,
            label: row.name,
            badge: (
              <span
                aria-hidden="true"
                className={`block h-1.5 w-1.5 rounded-full ${
                  row.presetIds.length > 0 ? 'bg-ds-success' : 'bg-ds-muted/40'
                }`}
              />
            ),
          }))}
          onValueChange={(value) => setActiveMediaId(value)}
        />
        <span className="min-w-4 flex-1" />
        <Button variant="ghost" size="sm" onClick={() => jumpToConsole('watermark')}>
          去中控台配水印
        </Button>
      </Inline>

      {/* 下方：16:9 预览区。水印是叠在画面上的，横版比例最能看出压边与占位 */}
      <AspectRatio
        ratio={16 / 9}
        data-testid="watermark-stage"
        className="relative w-full max-w-xl rounded-ds-lg border border-ds-border bg-ds-surface-subtle"
      >
        {activePresets.map((preset) => (
          <WatermarkStageLayer key={preset.id} preset={preset} />
        ))}
        {activePresets.length === 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-ds-muted">不叠水印</span>
        )}
        {activePresets.length > 0 && (
          <span className="absolute left-2 top-2 rounded-ds-md bg-ds-scrim px-2 py-0.5 text-xs text-ds-text">
            叠 {activePresets.length} 套水印
          </span>
        )}
        {missingCount > 0 && (
          <span className="absolute bottom-2 right-2 rounded-ds-md bg-ds-scrim px-2 py-0.5 text-xs text-ds-warning">
            {missingCount} 套预设已删除
          </span>
        )}
      </AspectRatio>
    </Stack>
  )
}
