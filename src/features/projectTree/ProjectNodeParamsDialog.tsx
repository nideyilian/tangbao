/**
 * 单个树节点的参数编辑弹窗。
 *
 * 交互口径（也是这套「树 + 参数」设计的关键）：
 * - 每个字段**始终显示当前生效值**，编辑即在本级写入一条覆盖；
 * - 字段右上角标明它是「本级自定义」还是「继承自某某」，并给一个「恢复继承」按钮把覆盖摘掉；
 * - 「恢复继承」写的是 `undefined`（而不是写入当前值）——否则值被固化在本级，
 *   以后改上层就再也影响不到这个节点了。
 */

import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  SectionHeader,
  SegmentedControl,
  Surface,
  Switch,
  TextField,
} from '../../design-system'
import {
  PURE_MEDIA_ID,
  type OutputDirection,
  type PostprocessMediaConfig,
  type PostprocessMediaOverride,
  type PostprocessNodeOverride,
} from '../../lib/postprocessMedia'
import { isCollectionWithinSelection } from '../../lib/postprocessProjectTree'
import { useStore } from '../../store'
import PostprocessDistributionFields from '../postprocess/PostprocessDistributionFields'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useCompositeV2Store } from '../composite/storeV2'
import { PROJECT_NODE_KIND_LABELS } from './types'
import {
  resolveProjectNodeIdChain,
  resolveProjectNodeKind,
  resolveProjectNodePathNames,
  resolveProjectPostprocessSlice,
} from './params'
import { useProjectTreeParamsStore } from './storeProjectTreeParams'

interface Props {
  collectionId: string
  onClose: () => void
}

type DirectionValue = 'auto' | OutputDirection

const DIRECTION_OPTIONS: Array<{ value: DirectionValue; label: string }> = [
  { value: 'auto', label: '跟随尺寸' },
  { value: 'landscape', label: '横版' },
  { value: 'portrait', label: '竖版' },
  { value: 'square', label: '方形' },
]

/** 勾选/取消一个水印预设 id：追加保序，取消时保持其余顺序。 */
function togglePresetId(current: string[], presetId: string): string[] {
  return current.includes(presetId) ? current.filter((id) => id !== presetId) : [...current, presetId]
}

/** 字段外壳：标题 + 来源标记 + 恢复继承。 */
function FieldRow({
  label,
  overridden,
  sourceHint,
  onReset,
  children,
}: {
  label: string
  overridden: boolean
  sourceHint: string
  onReset?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-6 items-center gap-2">
        <span className="text-xs font-medium text-ds-text dark:text-ds-text">{label}</span>
        {overridden ? (
          <>
            <span className="rounded-ds-lg border border-ds-accent/50 bg-ds-accent/10 px-1.5 py-0.5 text-xs text-ds-accent">
              本级自定义
            </span>
            {onReset && (
              <Button variant="ghost" size="sm" onClick={onReset}>
                恢复继承
              </Button>
            )}
          </>
        ) : (
          <span className="text-xs text-ds-muted dark:text-ds-muted">{sourceHint}</span>
        )}
      </div>
      {children}
    </div>
  )
}

export default function ProjectNodeParamsDialog({ collectionId, onClose }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const clearNodeParams = useProjectTreeParamsStore((state) => state.clearNodeParams)
  const showToast = useStore((state) => state.showToast)

  // 全局默认 = 「后处理设置」面板里那份配置；树上的覆盖是叠加在它之上的差分。
  // 逐字段订阅而不是整份取 store，避免任意一次 action 都重建对象让引用比较空转。
  const media = usePostprocessMediaStore((state) => state.media)
  const globalSelectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const globalSelectedCollectionIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
  const globalDirection = usePostprocessMediaStore((state) => state.direction)
  const globalOutputDir = usePostprocessMediaStore((state) => state.outputDir)
  const globalNamePattern = usePostprocessMediaStore((state) => state.namePattern)
  const globalCreator = usePostprocessMediaStore((state) => state.creator)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const globalAutoCompanionClean = usePostprocessMediaStore((state) => state.autoCompanionClean)
  const globalDistribution = usePostprocessMediaStore((state) => state.distribution)
  const presets = useCompositeV2Store((state) => state.presets)

  const globalConfig = useMemo<PostprocessMediaConfig>(
    () => ({
      media,
      selectedMediaIds: globalSelectedMediaIds,
      selectedCollectionIds: globalSelectedCollectionIds,
      direction: globalDirection,
      outputDir: globalOutputDir,
      namePattern: globalNamePattern,
      creator: globalCreator,
      watermarkPresetIds: globalWatermarkPresetIds,
      autoCompanionClean: globalAutoCompanionClean,
      distribution: globalDistribution,
    }),
    [
      media,
      globalSelectedMediaIds,
      globalSelectedCollectionIds,
      globalDirection,
      globalOutputDir,
      globalNamePattern,
      globalCreator,
      globalWatermarkPresetIds,
      globalAutoCompanionClean,
      globalDistribution,
    ],
  )

  const override = params[collectionId]?.postprocess
  const slice = useMemo(
    () => resolveProjectPostprocessSlice(collections, params, collectionId, globalConfig),
    [collections, params, collectionId, globalConfig],
  )
  const effective = slice.config

  /**
   * 每个渠道各自解析一次生效配置。
   *
   * 渠道覆盖（`byMedia`）只影响输出目录与水印预设，但界面上要回答的**不是**「本级写没写」，
   * 而是「这个渠道现在到底用哪个目录、叠哪几套水印」——没单独设过时得看得见它继承到了什么。
   */
  const perMediaEffective = useMemo(() => {
    const map: Record<string, PostprocessMediaConfig> = {}
    for (const item of media) {
      map[item.id] = resolveProjectPostprocessSlice(collections, params, collectionId, globalConfig, item.id).config
    }
    return map
  }, [media, collections, params, collectionId, globalConfig])

  /** 「按渠道分别设置」的展开态，两个字段各自独立。默认收起：多数方向各渠道共用一个目录。 */
  const [expandedMediaOverride, setExpandedMediaOverride] = useState<'outputDir' | 'watermarkPresetIds' | null>(null)

  // 节点本身可能已被删除（弹窗开着时另一处删掉了它）——此时 title 与路径都退化为占位文案，不抛错
  const self = useMemo(() => collections.find((item) => item.id === collectionId), [collections, collectionId])
  const pathNames = useMemo(() => resolveProjectNodePathNames(collections, collectionId), [collections, collectionId])
  const fullPath = [pathNames.line, pathNames.product, pathNames.direction].filter(Boolean).join(' / ')
  const depth = Math.max(0, resolveProjectNodeIdChain(collections, collectionId).length - 1)

  const sourceName = (() => {
    if (!slice.sourcedFrom) return '继承自全局默认'
    const node = collections.find((item) => item.id === slice.sourcedFrom)
    return slice.sourcedFrom === collectionId ? '本级自定义' : `继承自「${node?.name ?? '已删除节点'}」`
  })()

  const overridden = (key: keyof PostprocessNodeOverride) => override?.[key] !== undefined
  const apply = (patch: PostprocessNodeOverride) => setPostprocessOverride(collectionId, patch)
  const reset = (key: keyof PostprocessNodeOverride) => apply({ [key]: undefined })

  /** 某渠道的某个字段在本级是否写了覆盖。 */
  const mediaOverridden = (mediaId: string, key: keyof PostprocessMediaOverride) =>
    override?.byMedia?.[mediaId]?.[key] !== undefined

  /**
   * 「按渠道分别设置」区块。
   *
   * 只给输出目录与水印预设提供入口——这正是业务上确实会按渠道分叉的两项：同一个方向的
   * 厂商/百度/头条可能交付到完全不同的目录、叠不同的合规水印。其余字段按渠道分只会让
   * 「到底哪个值生效」需要递归推理，所以这里根本不提供入口。
   *
   * 默认收起并在收起时用一句话交代「哪几个渠道已单独设置」——多数方向各渠道共用一个目录，
   * 一上来就把每个渠道铺开只会把简单情况显得很复杂。
   */
  const mediaOverrideBlock = (
    field: 'outputDir' | 'watermarkPresetIds',
    renderRow: (mediaId: string) => React.ReactNode,
  ) => {
    const expanded = expandedMediaOverride === field
    const overriddenNames = media.filter((item) => mediaOverridden(item.id, field)).map((item) => item.name)
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setExpandedMediaOverride(expanded ? null : field)}>
            {expanded ? '收起按渠道设置' : '按渠道分别设置'}
          </Button>
          {!expanded && overriddenNames.length > 0 && (
            <span className="text-xs text-ds-accent dark:text-ds-accent">{overriddenNames.join('、')} 已单独设置</span>
          )}
        </div>
        {expanded && (
          <div className="space-y-1.5">
            <p className="text-xs text-ds-muted dark:text-ds-muted">
              留空 = 用上面的通用值。只有同一方向各渠道不一样时才需要在这里单独填。
            </p>
            {media.length === 0 && <Alert tone="warning">媒体表为空，没有可单独设置的渠道。</Alert>}
            {media.map((item) => (
              <div key={item.id} className="flex items-start gap-2">
                <span className="w-14 shrink-0 pt-1.5 text-xs text-ds-text dark:text-ds-text">{item.name}</span>
                <div className="flex min-w-0 flex-1 items-center gap-2">{renderRow(item.id)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const pickDirectory = async () => {
    try {
      const path = await window.electronAPI?.selectDirectory?.()
      if (path) apply({ outputDir: path })
    } catch {
      showToast('选择输出目录失败，请重试', 'error')
    }
  }

  const hasAnyOverride = Boolean(override && Object.keys(override).length > 0)

  // 「启用范围」与「节点参数」是两件事：不在范围内时下面配什么都没用，
  // 所以必须在用户动任何字段之前就说清楚，否则会得到一堆「设了不生效」的困惑。
  const inEnabledScope = useMemo(
    () => isCollectionWithinSelection(collections, collectionId, globalSelectedCollectionIds),
    [collections, collectionId, globalSelectedCollectionIds],
  )

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`参数 · ${self?.name ?? '已删除节点'}`}
      description="这里的设置随项目树一起生效：该方向下的图片做后处理时会自动采用，无需再手动选择。"
      size="lg"
      footer={
        <>
          {hasAnyOverride && (
            <Button variant="ghost" onClick={() => clearNodeParams(collectionId)}>
              清空本级参数
            </Button>
          )}
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      <div className="space-y-5">
        <Surface tone="subtle" className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/60 px-1.5 py-0.5 text-xs text-ds-muted dark:border-ds-border dark:bg-ds-surface dark:text-ds-muted">
              {PROJECT_NODE_KIND_LABELS[resolveProjectNodeKind(depth)]}
            </span>
            <span className="text-xs text-ds-text dark:text-ds-text">{fullPath || '（无路径）'}</span>
          </div>
          <p className="mt-1 text-xs text-ds-muted dark:text-ds-muted">
            未单独设置的字段会沿「方向 → 产品 → 产品线 → 全局默认」向上取值；当前生效来源：{sourceName}。
          </p>
          {!inEnabledScope && (
            <Alert tone="warning" className="mt-1.5">
              这个方向不在后处理的启用范围内，下面的设置都不会产出。请到「项目树」表格的「后处理」列勾选它本身，或勾选它的上级。
            </Alert>
          )}
        </Surface>

        <section>
          <SectionHeader
            title="参与自动后处理"
            description="关闭后，归属该节点的图片不再自动产出渠道变体（原图照常保存）。"
          />
          <div className="mt-2">
            <Switch
              checked={slice.enabled}
              onCheckedChange={(checked) => apply({ enabled: checked })}
              label="生成完成后自动产出变体"
            />
          </div>
        </section>

        <section>
          <SectionHeader title="媒体" description="纯净版通常会随渠道一起产出；这里勾选的渠道会覆盖全局默认的勾选。" />
          <div className="mt-2 space-y-1.5">
            {media.length === 0 && <Alert tone="warning">媒体表为空，请先到「后处理」设置里补齐渠道规格。</Alert>}
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
                  apply({ selectedMediaIds: next })
                }}
                label={item.name}
              />
            ))}
            <Checkbox
              checked={effective.selectedMediaIds.includes(PURE_MEDIA_ID)}
              onChange={() => {
                const has = effective.selectedMediaIds.includes(PURE_MEDIA_ID)
                apply({
                  selectedMediaIds: has
                    ? effective.selectedMediaIds.filter((id) => id !== PURE_MEDIA_ID)
                    : [PURE_MEDIA_ID, ...effective.selectedMediaIds],
                })
              }}
              label="纯净版（无渠道）"
            />
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader title="产出参数" />

          <FieldRow
            label="画面方向"
            overridden={overridden('direction')}
            sourceHint={sourceName}
            onReset={() => reset('direction')}
          >
            <SegmentedControl
              aria-label="画面方向"
              value={effective.direction ?? 'auto'}
              options={DIRECTION_OPTIONS}
              onValueChange={(value) => apply({ direction: value === 'auto' ? null : value })}
            />
          </FieldRow>

          <FieldRow
            label="水印预设"
            overridden={overridden('watermarkPresetIds')}
            sourceHint={sourceName}
            onReset={() => reset('watermarkPresetIds')}
          >
            <div className="space-y-2">
              {presets.length === 0 ? (
                <span className="text-xs text-ds-muted dark:text-ds-muted">还没有水印预设可勾选。</span>
              ) : (
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {presets.map((preset) => (
                    <Checkbox
                      key={preset.id}
                      checked={effective.watermarkPresetIds.includes(preset.id)}
                      onChange={() =>
                        apply({ watermarkPresetIds: togglePresetId(effective.watermarkPresetIds, preset.id) })
                      }
                      label={preset.name}
                    />
                  ))}
                </div>
              )}
              {mediaOverrideBlock('watermarkPresetIds', (mediaId) => {
                const ids = perMediaEffective[mediaId]?.watermarkPresetIds ?? []
                return (
                  <>
                    <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                      {presets.map((preset) => (
                        <Checkbox
                          key={preset.id}
                          checked={ids.includes(preset.id)}
                          onChange={() =>
                            apply({ byMedia: { [mediaId]: { watermarkPresetIds: togglePresetId(ids, preset.id) } } })
                          }
                          label={preset.name}
                        />
                      ))}
                      {presets.length === 0 && (
                        <span className="text-xs text-ds-muted dark:text-ds-muted">没有预设可选。</span>
                      )}
                    </div>
                    {mediaOverridden(mediaId, 'watermarkPresetIds') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => apply({ byMedia: { [mediaId]: { watermarkPresetIds: undefined } } })}
                      >
                        恢复继承
                      </Button>
                    )}
                  </>
                )
              })}
            </div>
          </FieldRow>

          <FieldRow
            label="命名模板"
            overridden={overridden('namePattern')}
            sourceHint={sourceName}
            onReset={() => reset('namePattern')}
          >
            <TextField
              label=""
              value={effective.namePattern}
              onChange={(event) => apply({ namePattern: event.target.value })}
            />
          </FieldRow>

          <FieldRow
            label="创作者"
            overridden={overridden('creator')}
            sourceHint={sourceName}
            onReset={() => reset('creator')}
          >
            <TextField
              label=""
              value={effective.creator}
              onChange={(event) => apply({ creator: event.target.value })}
            />
          </FieldRow>

          <FieldRow
            label="输出目录"
            overridden={overridden('outputDir')}
            sourceHint={sourceName}
            onReset={() => reset('outputDir')}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TextField
                  label=""
                  className="flex-1"
                  value={effective.outputDir}
                  placeholder="留空则用默认输出位置"
                  onChange={(event) => apply({ outputDir: event.target.value })}
                />
                <Button variant="secondary" onClick={() => void pickDirectory()}>
                  选择…
                </Button>
              </div>
              {mediaOverrideBlock('outputDir', (mediaId) => (
                <>
                  <TextField
                    label=""
                    className="flex-1"
                    value={override?.byMedia?.[mediaId]?.outputDir ?? ''}
                    // 占位符显示的是**该渠道继承到的**目录：留空不代表没配置，而是正在用这个
                    placeholder={perMediaEffective[mediaId]?.outputDir.trim() || '留空则用默认输出位置'}
                    onChange={(event) => apply({ byMedia: { [mediaId]: { outputDir: event.target.value } } })}
                  />
                  {mediaOverridden(mediaId, 'outputDir') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => apply({ byMedia: { [mediaId]: { outputDir: undefined } } })}
                    >
                      恢复继承
                    </Button>
                  )}
                </>
              ))}
            </div>
          </FieldRow>

          <FieldRow
            label="纯净版自动伴随"
            overridden={overridden('autoCompanionClean')}
            sourceHint={sourceName}
            onReset={() => reset('autoCompanionClean')}
          >
            <Switch
              checked={effective.autoCompanionClean}
              onCheckedChange={(checked) => apply({ autoCompanionClean: checked })}
              label="勾了任一渠道时额外产一份无水印原图"
            />
          </FieldRow>

          <FieldRow
            label="分发"
            overridden={overridden('distribution')}
            sourceHint={sourceName}
            onReset={() => reset('distribution')}
          >
            <div className="space-y-2">
              <p className="text-xs text-ds-muted dark:text-ds-muted">
                分发是「整份」配置：一旦在本级改动，所有分发字段都会固化在这里，以后改上层不再影响这个节点。
                排期由起始日期与天数共同决定，拆开继承会拼出界面上推理不出来的组合。
              </p>
              <PostprocessDistributionFields
                config={effective.distribution}
                onChange={(patch) => apply({ distribution: { ...effective.distribution, ...patch } })}
                onPickError={() => showToast('选择分发目录失败，请重试', 'error')}
              />
            </div>
          </FieldRow>
        </section>
      </div>
    </Dialog>
  )
}
