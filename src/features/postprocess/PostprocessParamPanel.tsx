/**
 * 后处理参数详情面板（右栏，**唯一**的参数编辑区）。
 *
 * 它不认识任何具体字段：读 `paramSchema` 里当前作用域的字段列表与分组，
 * 按 `control` 分派到对应控件。加一个字段 = 在元数据表里加一项，这里不改代码。
 *
 * 两种宿主：
 * - `scope === 'global'`（树根的「全局默认」节点）→ 读写 `usePostprocessMediaStore` 的基线；
 * - `scope === 'node'`（真实树节点）→ 读写 `useProjectTreeParamsStore` 的覆盖切片，
 *   每个字段带「本级自定义 / 继承自某某」标记与「恢复继承」。
 *
 * 覆盖写成 `undefined` 而不是写入当前值——写入会把值固化在本级，以后改上层再也影响不到它。
 */

import { useMemo } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  SectionHeader,
  SegmentedControl,
  Switch,
  Surface,
  TextField,
} from '../../design-system'
import ChannelOutputDirs from './ChannelOutputDirs'
import NamePatternField from './NamePatternField'
import PostprocessDistributionFields from './PostprocessDistributionFields'
import { PURE_MEDIA_ID, normalizeOutputDirList } from '../../lib/postprocessMedia'
import type { PostprocessMediaConfig, PostprocessNodeOverride } from '../../lib/postprocessMedia'
import {
  findDuplicatedPostprocessNameTokens,
  findMissingPostprocessNameTokens,
  findUnknownPostprocessNameTokens,
} from '../../lib/postprocessNaming'
import { isCollectionWithinSelection, resolveCollectionPath } from '../../lib/postprocessProjectTree'
import { useStore } from '../../store'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useCompositeV2Store } from '../composite/storeV2'
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
import {
  DIRECTION_OPTIONS,
  GLOBAL_NODE_ID,
  selectParamFieldsByGroup,
  validateNamePattern,
  type PostprocessParamField,
} from './paramSchema'

interface Props {
  /** 当前选中的树节点 id；`GLOBAL_NODE_ID` = 全局默认，`null` = 未选中 */
  selectedNodeId: string | null
  /** 全局基线配置（由宿主组装，避免两处各自从 store 拼一份） */
  globalConfig: PostprocessMediaConfig
  /** 勾选的启用范围（判断节点是否真的会产出） */
  enabledScopeIds: string[]
  /** 媒体表管理区：全局作用域下由宿主渲染 */
  renderMediaTable?: () => React.ReactNode
  /** 产出预览：全局作用域下由宿主渲染 */
  renderOutputPreview?: () => React.ReactNode
  /** 产出目标个数（底部汇总用；不传则不显示） */
  outputUnitCount?: number
}

/** 字段外壳：标题 + 来源标记 + 恢复继承。全局作用域下不显示来源标记。 */
function FieldShell({
  field,
  overridden,
  sourceHint,
  onReset,
  children,
}: {
  field: PostprocessParamField
  overridden: boolean
  sourceHint: string
  onReset?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ds-text">{field.label}</span>
        {onReset &&
          (overridden ? (
            <>
              <span className="rounded-ds-lg border border-ds-accent/50 bg-ds-accent/10 px-1.5 py-0.5 text-xs text-ds-accent">
                本级自定义
              </span>
              <Button variant="ghost" size="sm" onClick={onReset}>
                恢复继承
              </Button>
            </>
          ) : (
            <span className="text-xs text-ds-muted">{sourceHint}</span>
          ))}
      </div>
      {children}
      {field.help && <p className="text-xs text-ds-muted">{field.help}</p>}
    </div>
  )
}

export default function PostprocessParamPanel({
  selectedNodeId,
  globalConfig,
  enabledScopeIds,
  renderMediaTable,
  renderOutputPreview,
  outputUnitCount,
}: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const clearNodeParams = useProjectTreeParamsStore((state) => state.clearNodeParams)
  const showToast = useStore((state) => state.showToast)

  const setSelectedMediaIds = usePostprocessMediaStore((state) => state.setSelectedMediaIds)
  const setDirection = usePostprocessMediaStore((state) => state.setDirection)
  const setOutputDir = usePostprocessMediaStore((state) => state.setOutputDir)
  const setMediaOutputDir = usePostprocessMediaStore((state) => state.setMediaOutputDir)
  const clearMediaOutputDirs = usePostprocessMediaStore((state) => state.clearMediaOutputDirs)
  const setNamePattern = usePostprocessMediaStore((state) => state.setNamePattern)
  const setCreator = usePostprocessMediaStore((state) => state.setCreator)
  const setAutoCompanionClean = usePostprocessMediaStore((state) => state.setAutoCompanionClean)
  const patchDistribution = usePostprocessMediaStore((state) => state.patchDistribution)

  const media = globalConfig.media
  const isGlobal = selectedNodeId === GLOBAL_NODE_ID
  const scope: 'global' | 'node' = isGlobal ? 'global' : 'node'

  // 节点已删除（弹窗开着时另一处删掉了它）→ 退化为空状态，不抛错
  const node = useMemo(
    () => (selectedNodeId && !isGlobal ? collections.find((item) => item.id === selectedNodeId) : undefined),
    [collections, selectedNodeId, isGlobal],
  )
  const nodeMissing = !isGlobal && selectedNodeId !== null && !node

  const override = !isGlobal && selectedNodeId ? params[selectedNodeId]?.postprocess : undefined

  const slice = useMemo(() => {
    if (isGlobal || !selectedNodeId) return null
    return resolveProjectPostprocessSlice(collections, params, selectedNodeId, globalConfig)
  }, [isGlobal, selectedNodeId, collections, params, globalConfig])

  const effective = isGlobal ? globalConfig : slice?.config

  const sourceName = (() => {
    if (!slice) return ''
    if (!slice.sourcedFrom) return '继承自全局默认'
    const source = collections.find((item) => item.id === slice.sourcedFrom)
    return slice.sourcedFrom === selectedNodeId ? '本级自定义' : `继承自「${source?.name ?? '已删除节点'}」`
  })()

  const fullPath = useMemo(() => {
    if (!selectedNodeId || isGlobal) return ''
    const names = resolveProjectNodePathNames(collections, selectedNodeId)
    return [names.line, names.product, names.direction].filter(Boolean).join(' / ')
  }, [collections, selectedNodeId, isGlobal])

  const depth = useMemo(
    () =>
      selectedNodeId && !isGlobal ? Math.max(0, resolveProjectNodeIdChain(collections, selectedNodeId).length - 1) : 0,
    [collections, selectedNodeId, isGlobal],
  )

  const inEnabledScope = useMemo(() => {
    if (isGlobal || !selectedNodeId) return true
    return isCollectionWithinSelection(collections, selectedNodeId, enabledScopeIds)
  }, [collections, selectedNodeId, enabledScopeIds, isGlobal])

  const namePatternValue = effective?.namePattern ?? ''
  const nameIssues = useMemo(
    () =>
      validateNamePattern(namePatternValue, {
        unknown: findUnknownPostprocessNameTokens(namePatternValue),
        missing: findMissingPostprocessNameTokens(namePatternValue),
        duplicated: findDuplicatedPostprocessNameTokens(namePatternValue),
      }),
    [namePatternValue],
  )

  /**
   * 某渠道**本级已配**的导出位置（1~2 个）；空数组 = 本级没配。
   *
   * 节点层兼容旧的单值字段 `outputDir`：已导入的数据按渠道目录写在那上面，
   * 不读它就等于用户升级后看到「按渠道配的目录全没了」。
   */
  const resolveDirs = (mediaId: string): string[] => {
    if (isGlobal) return normalizeOutputDirList(globalConfig.mediaOutputDirs?.[mediaId])
    const entry = override?.byMedia?.[mediaId]
    return normalizeOutputDirList(entry?.outputDirs ?? (entry?.outputDir ? [entry.outputDir] : []))
  }

  const writeDirs = (mediaId: string, index: number, outputDir: string) => {
    if (isGlobal) {
      setMediaOutputDir(mediaId, index, outputDir)
      return
    }
    const slots = [...resolveDirs(mediaId)]
    while (slots.length <= index) slots.push('')
    slots[index] = outputDir
    const next = normalizeOutputDirList(slots)
    // 同时写 `outputDirs` 并摘掉旧的单值 `outputDir`：两个字段并存时以 `outputDirs` 为准，
    // 留着旧值只会让「界面上显示的」和「实际生效的」不一致。
    apply({ byMedia: { [mediaId]: { outputDirs: next.length > 0 ? next : undefined, outputDir: undefined } } })
  }

  const clearDirs = (mediaId: string) => {
    if (isGlobal) clearMediaOutputDirs(mediaId)
    else apply({ byMedia: { [mediaId]: { outputDirs: undefined, outputDir: undefined } } })
  }

  /** 本渠道去掉本级覆盖后会落到哪：拿父节点那条链单独解析一次，当占位提示 */
  const inheritedDirsByMedia = useMemo(() => {
    const map: Record<string, string> = {}
    if (isGlobal || !selectedNodeId) {
      for (const item of media) map[item.id] = globalConfig.outputDir
      return map
    }
    const path = resolveCollectionPath(collections, selectedNodeId)
    const parentId = path.length >= 2 ? path[path.length - 2].id : null
    for (const item of media) {
      const sliceUp = resolveProjectPostprocessSlice(collections, params, parentId, globalConfig, item.id)
      map[item.id] = sliceUp.config.outputDir || '默认输出位置'
    }
    return map
  }, [isGlobal, selectedNodeId, collections, params, media, globalConfig])

  const pickDirectory = async (onPicked: (path: string) => void) => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) onPicked(path)
    } catch {
      showToast('选择目录失败，请重试', 'error')
    }
  }

  const apply = (patch: PostprocessNodeOverride) => {
    if (isGlobal || !selectedNodeId) return
    setPostprocessOverride(selectedNodeId, patch)
  }

  const reset = (key: keyof PostprocessNodeOverride) => apply({ [key]: undefined })
  const overridden = (key: string) => override?.[key as keyof PostprocessNodeOverride] !== undefined

  // ── 空状态 ──────────────────────────────────────────────────────────────
  if (!selectedNodeId) {
    return (
      <EmptyState
        title="未选择节点"
        description="在左侧树里点一个节点，这里会显示它的后处理参数。参数按「方向 → 产品 → 产品线 → 全局默认」逐级继承。"
      />
    )
  }

  if (nodeMissing) {
    return <EmptyState title="节点已被删除" description="这个节点在别处被删掉了，请从左侧树另选一个。" />
  }

  if (!effective) {
    return <EmptyState title="无法读取参数" description="该节点的参数解析失败，请关闭弹窗后重试。" />
  }

  const groups = selectParamFieldsByGroup(scope)
  const hasOverride = Boolean(override && Object.keys(override).length > 0)

  /** 按 `control` 分派渲染。加字段只改 paramSchema，这里不动。 */
  const renderControl = (field: PostprocessParamField) => {
    switch (field.control) {
      case 'enabled':
        return (
          <Switch
            checked={slice?.enabled ?? true}
            onCheckedChange={(checked) => apply({ enabled: checked })}
            label="生成完成后自动产出变体"
          />
        )

      case 'media':
        return (
          <div className="space-y-1.5">
            {media.length === 0 && <Alert tone="warning">媒体表为空，请先到「全局默认」的媒体表里补齐渠道规格。</Alert>}
            {media.map((item) => (
              <Checkbox
                key={item.id}
                checked={effective.selectedMediaIds.includes(item.id)}
                disabled={!item.enabled}
                onChange={() => {
                  const has = effective.selectedMediaIds.includes(item.id)
                  const next = has
                    ? effective.selectedMediaIds.filter((id) => id !== item.id)
                    : [...effective.selectedMediaIds, item.id]
                  setSelectedMediaIds(next)
                }}
                label={item.name}
              />
            ))}
            <Checkbox
              checked={effective.selectedMediaIds.includes(PURE_MEDIA_ID)}
              onChange={() => {
                const has = effective.selectedMediaIds.includes(PURE_MEDIA_ID)
                const next = has
                  ? effective.selectedMediaIds.filter((id) => id !== PURE_MEDIA_ID)
                  : [PURE_MEDIA_ID, ...effective.selectedMediaIds]
                setSelectedMediaIds(next)
              }}
              label="纯净版（无渠道）"
            />
          </div>
        )

      case 'direction':
        return (
          <SegmentedControl
            aria-label="画面方向"
            value={effective.direction ?? 'auto'}
            options={DIRECTION_OPTIONS}
            onValueChange={(value) => setDirection(value === 'auto' ? null : value)}
          />
        )

      case 'namePattern':
        return (
          <div className="space-y-2">
            <NamePatternField value={effective.namePattern} onChange={setNamePattern} />
            {nameIssues.map((issue) => (
              <Alert key={issue.message} tone={issue.tone === 'error' ? 'danger' : 'warning'}>
                {issue.message}
              </Alert>
            ))}
          </div>
        )

      case 'creator':
        return <TextField label="" value={effective.creator} onChange={(event) => setCreator(event.target.value)} />

      case 'outputDir':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <TextField
                label=""
                className="flex-1"
                value={effective.outputDir}
                placeholder={isGlobal ? '留空则用系统默认输出位置' : '留空则继承上级；没有上级时用默认输出位置'}
                // 清空 = 恢复继承（`undefined`），不写空串。写空串是一条**显式**「用默认输出位置」的
                // 声明，会把上级（含全局默认输出目录）一起挡掉，界面上却看不出区别。
                onChange={(event) => {
                  const next = event.target.value
                  if (isGlobal) setOutputDir(next)
                  else apply({ outputDir: next.trim() ? next : undefined })
                }}
              />
              <Button
                variant="secondary"
                onClick={() =>
                  void pickDirectory((path) => {
                    if (isGlobal) setOutputDir(path)
                    else apply({ outputDir: path })
                  })
                }
              >
                选择…
              </Button>
            </div>
            <ChannelOutputDirs
              media={media}
              resolveDirs={resolveDirs}
              resolveInheritedHint={(mediaId) => inheritedDirsByMedia[mediaId] ?? ''}
              onChangeDir={writeDirs}
              onClearDirs={clearDirs}
              onPickError={() => showToast('选择导出位置失败，请重试', 'error')}
              collapsible
              clearLabel={isGlobal ? '用默认' : '恢复继承'}
            />
          </div>
        )

      case 'autoCompanionClean':
        return (
          <Switch
            checked={effective.autoCompanionClean}
            onCheckedChange={setAutoCompanionClean}
            label="勾了任一渠道时额外产一份无水印原图"
          />
        )

      case 'distribution':
        return (
          <PostprocessDistributionFields
            config={effective.distribution}
            onChange={patchDistribution}
            onPickError={() => showToast('选择分发目录失败，请重试', 'error')}
          />
        )

      case 'watermarkBinding':
        return <WatermarkBindingSummary selectedNodeId={isGlobal ? null : selectedNodeId} />

      case 'mediaTable':
        return renderMediaTable?.() ?? null

      case 'outputPreview':
        return renderOutputPreview?.() ?? null

      default:
        return null
    }
  }

  return (
    <div className="space-y-5">
      {/* 节点身份条：让用户随时确认「我在改谁」 */}
      <Surface tone="subtle" className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-ds-lg border border-ds-border px-1.5 py-0.5 text-xs text-ds-muted">
            {isGlobal ? '全局默认' : PROJECT_NODE_KIND_LABELS[resolveProjectNodeKind(depth)]}
          </span>
          <span className="text-xs text-ds-text">{isGlobal ? '所有节点的兜底值' : fullPath || '（无路径）'}</span>
          {!isGlobal && hasOverride && selectedNodeId && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => clearNodeParams(selectedNodeId)}>
              清空本级参数
            </Button>
          )}
        </div>
        {!isGlobal && (
          <p className="mt-1 text-xs text-ds-muted">
            未单独设置的字段会沿「方向 → 产品 → 产品线 → 全局默认」向上取值；当前生效来源：{sourceName}。
          </p>
        )}
        {!inEnabledScope && (
          <Alert tone="warning" className="mt-1.5">
            这个节点不在后处理的启用范围内，下面的设置都不会产出。请在左侧树上把它（或它的上级）加入启用范围。
          </Alert>
        )}
      </Surface>

      {groups.map(({ group, fields }) => (
        <section key={group.id} className="space-y-3">
          <SectionHeader title={group.title} description={group.description} />
          {fields.map((field) => (
            <FieldShell
              key={field.key}
              field={field}
              overridden={overridden(field.key)}
              sourceHint={sourceName}
              onReset={
                field.resettable && !isGlobal ? () => reset(field.key as keyof PostprocessNodeOverride) : undefined
              }
            >
              {renderControl(field)}
            </FieldShell>
          ))}
        </section>
      ))}

      {outputUnitCount !== undefined && (
        <p className="text-xs text-ds-muted">
          {outputUnitCount === 0
            ? '当前选择产不出变体，请检查媒体与方向。'
            : `每张原图产出 ${outputUnitCount} 个文件。`}
        </p>
      )}
    </div>
  )
}

/** 水印归属只读摘要：编辑入口在水印预设工作区，这里不提供第二个入口。 */
function WatermarkBindingSummary({ selectedNodeId }: { selectedNodeId: string | null }) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const media = usePostprocessMediaStore((state) => state.media)
  const presets = useCompositeV2Store((state) => state.presets)

  const presetIds = new Set(presets.map((preset) => preset.id))
  const rows = media.map((item) => {
    const binding = resolveNodeWatermarkBinding(collections, params, selectedNodeId, globalWatermarkPresetIds, item.id)
    return {
      mediaId: item.id,
      name: item.name,
      presetIds: binding.presetIds,
      // 预设可能已被删除：`presetIds` 里留着悬空 id，这里数出来提示用户
      missingCount: binding.presetIds.filter((id) => !presetIds.has(id)).length,
    }
  })
  const visible = rows.filter((row) => row.presetIds.length > 0)

  if (visible.length === 0) {
    return <p className="text-xs text-ds-muted">当前不叠水印。要加请在「水印预设」工作区的「水印归属」树里配置。</p>
  }

  const presetName = (id: string) => presets.find((preset) => preset.id === id)?.name ?? '已删除预设'

  return (
    <div className="space-y-1.5">
      {visible.map((row) => (
        <div key={row.mediaId} className="rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-2 py-1.5">
          <span className="text-xs font-medium text-ds-text">{row.name}</span>
          <span className="ml-2 text-xs text-ds-muted">{row.presetIds.map(presetName).join('、')}</span>
          {row.missingCount > 0 && <span className="ml-2 text-xs text-ds-warning">{row.missingCount} 套已删除</span>}
        </div>
      ))}
    </div>
  )
}
