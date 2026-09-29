/**
 * 视频参数弹窗：某个「方向 × 渠道」的图转视频参数。
 *
 * ## 为什么是弹窗 + 顶部标签，而不是表格里的 20 列
 *
 * 引擎的参数有 20 多项，横排成表格要横向滚动、一屏看不到几行（TB-137 才刚为列宽 / 行高
 * 打过补丁），而这些参数是「配一次长期有效」的东西 —— 杰哥 2026-09-28 定下的形态：
 * 表格里每行只留一个入口与状态，参数收进弹窗。
 *
 * 2026-09-29 又把「一屏平铺五组」改成**顶部标签 + 一次只显示一组**（杰哥反馈：二十多项
 * 堆在一起要从头扫到尾）。分类与字段的对应关系全在 `TABS` / `PINNED_KEYS` 里，别在渲染处
 * 另写一套 —— 底部「恢复本组 / 全部恢复」的覆盖面也要靠它们算，漏一个键就是清不干净。
 *
 * ## 值从哪来、写到哪去
 *
 * - **读**：`imageVideoByMedia[渠道] ?? imageVideo（节点缺省）?? 沿树向上 ?? 全局默认`，
 *   弹窗里显示的就是**生效值**（`resolveProjectImageVideoParams` 同一条链）。
 * - **写**：只写 `imageVideoByMedia[渠道]`。改这个渠道不会动别的渠道，也不会动节点缺省那份
 *   （那份是 2026-09-28 之前的老配置，留着继续生效 —— 所以没有数据迁移）。
 * - **改一个字段立刻落盘**：与表格的手感一致，不留「保存」按钮 —— 用户改完往往就想直接去跑
 *   视频。数字字段例外（本地草稿 + `onBlur` / 回车提交）：边打字边提交会先把「1」写进去、
 *   再写「12」，中间那一瞬间的脏值会被别的订阅方读走（`commitPostprocessMaxSize` 同理）。
 *
 * ## 两个修过的坑
 *
 * - **字符串字段绝不能走数字渲染**（2026-09-29 实修）：此前所有字段统一渲染成
 *   `<input type="number">` + `Number()` 提交，于是「文件名前缀」「输出位置」两格**填什么都
 *   存不进去** —— 浏览器把非数字输入清成空串，失焦时被判定成「留空 = 恢复默认」提交。
 *   现在两者各走专用控件：位置是目录选择器，命名是模板输入框（`NamePatternField`）。
 * - **点遮罩不关闭**：既然改一个字段立刻落盘，本来就不存在「没保存」；但误触遮罩关掉会让人
 *   以为白配了一遍。关闭只留三条明确的路：×、Esc、底部「关闭」。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Switch, useDialogFocusTrap } from '../../design-system'
import Select from '../../components/Select'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'
import { useStore } from '../../store'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useAssetLibraryStore } from '../assetLibrary/store'
import NamePatternField from '../postprocess/NamePatternField'
import { resolveProjectImageVideoParams } from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { loadVideoLibrary, type VideoLibrarySnapshot } from './library'
import { resolveVideoNamePrefix, resolveVideoNamingContext, validateImageVideoNamePattern } from './naming'
import { IMAGE_VIDEO_NUMBER_RANGES } from './params'
import { useImageVideoStore } from './store'
import {
  IMAGE_VIDEO_EFFECTS,
  IMAGE_VIDEO_NAME_PATTERN,
  IMAGE_VIDEO_NAME_TOKENS,
  IMAGE_VIDEO_RESOLUTIONS,
  IMAGE_VIDEO_SELECTION_MODES,
  IMAGE_VIDEO_TRANSITIONS,
  IMAGE_VIDEO_WATERMARK_AUDIO_MODES,
  IMAGE_VIDEO_WATERMARK_BLEND_MODES,
  IMAGE_VIDEO_WATERMARK_MATCH_METHODS,
  IMAGE_VIDEO_WATERMARK_POSITIONS,
  IMAGE_VIDEO_WATERMARK_SIZE_MODES,
  type ImageVideoNodeOverride,
  type ImageVideoParams,
} from './types'

/** 「不用」「随机」在下拉里的两个哨兵值（不会和转场/效果名撞）。 */
const MODE_OFF = '__off__'
const MODE_RANDOM = '__random__'

type FieldKey = keyof ImageVideoParams
type TabKey = 'rhythm' | 'frame' | 'motion' | 'audio' | 'watermark'

interface FieldDef {
  key: FieldKey
  label: string
  unit?: string
  hint?: string
}

interface TabDef {
  key: TabKey
  label: string
  /**
   * 这个标签涵盖的参数键。
   *
   * 不参与渲染，但有两处非它不可：标签上那个「本组改过」的小点、底部「恢复本组默认」清哪几个键。
   * **每个参数键都必须出现在某个标签里**（`VideoParamsDialog.test.tsx` 有守卫比对
   * `DEFAULT_IMAGE_VIDEO_PARAMS` 的键集）。
   */
  keys: readonly FieldKey[]
}

const TABS: readonly TabDef[] = [
  {
    key: 'rhythm',
    label: '节奏',
    keys: ['videoCountMode', 'videoCount', 'imagesPerVideo', 'secondsPerImage', 'totalDuration'],
  },
  { key: 'frame', label: '画面', keys: ['resolution', 'fps', 'bitrate', 'imageSelection'] },
  {
    key: 'motion',
    label: '转场与效果',
    keys: ['transitionMode', 'transitionType', 'effectMode', 'effectType', 'effectIntensity', 'effectSpeed'],
  },
  { key: 'audio', label: '声音', keys: ['useBgm', 'bgmFolder', 'bgmRandom', 'bgmLoop', 'bgmVolume'] },
  {
    key: 'watermark',
    label: '水印',
    keys: [
      'useVideoWatermark',
      'watermarkMode',
      'watermarkPath',
      'watermarkPosition',
      'watermarkSizeMode',
      'watermarkScale',
      'watermarkBlendMode',
      'watermarkMatchMethod',
      'watermarkAudio',
    ],
  },
]

/**
 * 常驻在标签之外的字段：顶部的「出视频」开关 + 底部的输出与命名。
 *
 * 它们不属于任何一组，但同属「这个渠道配了什么」——「全部恢复」要一并算上，
 * 否则会出现「点了全部恢复，输出位置还留着」这种半清状态。
 */
export const IMAGE_VIDEO_PINNED_KEYS: readonly FieldKey[] = ['enabled', 'namePattern', 'outputDir']

/** 「全部恢复」清空的范围：标签内的 + 常驻的。**必须覆盖每一个参数键**（有测试守卫）。 */
export const IMAGE_VIDEO_FIELD_KEYS: readonly FieldKey[] = [
  ...TABS.flatMap((tab) => tab.keys),
  ...IMAGE_VIDEO_PINNED_KEYS,
]

/** 数值范围（与 `params.ts` 的归一化同一份口径，别在这里另抄一套数）。 */
function rangeOf(key: FieldKey): { min: number; max: number } | null {
  const ranges = IMAGE_VIDEO_NUMBER_RANGES as Record<string, { min: number; max: number } | undefined>
  return ranges[key as string] ?? null
}

function toSelectOptions(values: readonly string[]): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: value }))
}

export interface VideoParamsDialogProps {
  /** 中控台作用域 = 方向 id */
  scope: string
  /** 方向显示名（标题用） */
  scopeLabel: string
  mediaId: string
  mediaName: string
  /** 本方向的其它渠道（供「应用到其它渠道」） */
  otherMedias: ReadonlyArray<{ id: string; name: string }>
  onClose: () => void
}

export function VideoParamsDialog({
  scope,
  scopeLabel,
  mediaId,
  mediaName,
  otherMedias,
  onClose,
}: VideoParamsDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  useDialogFocusTrap(true, modalRef)

  const collections = useAssetLibraryStore((state) => state.collections)
  const nodeParams = useProjectTreeParamsStore((state) => state.params)
  const setImageVideoOverride = useProjectTreeParamsStore((state) => state.setImageVideoOverride)
  const globals = useImageVideoStore((state) => state.globals)
  const creator = usePostprocessMediaStore((state) => state.creator)
  const showToast = useStore((state) => state.showToast)

  const [tab, setTab] = useState<TabKey>('rhythm')

  /** 该渠道这一层写的覆盖（没有就是空对象）。 */
  const override = nodeParams[scope]?.imageVideoByMedia?.[mediaId] ?? {}
  const effective = useMemo(
    () => resolveProjectImageVideoParams(collections, nodeParams, scope, globals, mediaId),
    [collections, nodeParams, scope, globals, mediaId],
  )

  const [library, setLibrary] = useState<VideoLibrarySnapshot | null>(null)
  useEffect(() => {
    let alive = true
    void loadVideoLibrary()
      .then((snapshot) => {
        if (alive) setLibrary(snapshot)
      })
      .catch(() => {
        /* 库读不到：下拉里就没有具体文件夹/素材可选，别的字段照常编辑 */
      })
    return () => {
      alive = false
    }
  }, [])

  /** 当前是否配过（有没有任何一个字段表过态）—— 决定「恢复」按钮能不能点。 */
  const dirty = Object.keys(override).length > 0

  const patch = (next: ImageVideoNodeOverride) => setImageVideoOverride(scope, next, mediaId)

  /**
   * 逐个清空给定字段（`undefined` = 删掉这个键 = 回到继承）。
   *
   * 用一份**键清单**而不是手写 `{ 字段: undefined, ... }`：后者在新增字段时极易漏，
   * 症状是「点了恢复默认，新字段还留着」—— 而这种事只有细心的人才看得出来。
   */
  const resetKeys = (keys: readonly FieldKey[]) => {
    const next: Record<string, undefined> = {}
    for (const key of keys) next[key] = undefined
    patch(next as ImageVideoNodeOverride)
  }

  /** 数值字段的本地草稿：边打字边提交会写进「1」这种半截值。 */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftValue = (key: FieldKey) =>
    drafts[key as string] ?? String((effective[key] as number | string | undefined) ?? '')

  const commitNumber = (key: FieldKey) => {
    const raw = drafts[key as string]
    if (raw === undefined) return
    setDrafts((previous) => {
      const next = { ...previous }
      delete next[key as string]
      return next
    })
    const parsed = Number(raw)
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      // 清空 = 恢复默认（不是「写 0」—— 0 在总时长那儿另有含义）
      patch({ [key]: undefined } as ImageVideoNodeOverride)
      return
    }
    const range = rangeOf(key)
    const clamped = range ? Math.min(Math.max(parsed, range.min), range.max) : parsed
    patch({ [key]: clamped } as ImageVideoNodeOverride)
  }

  /**
   * 草稿值是否越界；越界就把范围返回给界面标红。
   *
   * 落盘仍按范围钳制（见 `commitNumber`）—— 提示是给人看的、钳制是给数据兜底的，两者都要：
   * 只钳制的话，用户填 999 只会看到「值自己变了」，不知道为什么。
   */
  const outOfRange = (key: FieldKey): { min: number; max: number } | null => {
    const range = rangeOf(key)
    if (!range) return null
    const raw = drafts[key as string]
    if (raw === undefined || raw.trim() === '') return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    return parsed < range.min || parsed > range.max ? range : null
  }

  const transitionValue =
    effective.transitionMode === 'off'
      ? MODE_OFF
      : effective.transitionMode === 'random'
        ? MODE_RANDOM
        : effective.transitionType
  const effectValue =
    effective.effectMode === 'off' ? MODE_OFF : effective.effectMode === 'random' ? MODE_RANDOM : effective.effectType

  const applyMode = (
    modeKey: 'transitionMode' | 'effectMode',
    typeKey: 'transitionType' | 'effectType',
    value: string,
  ) => {
    if (value === MODE_OFF) patch({ [modeKey]: 'off' } as ImageVideoNodeOverride)
    else if (value === MODE_RANDOM) patch({ [modeKey]: 'random' } as ImageVideoNodeOverride)
    else patch({ [modeKey]: 'fixed', [typeKey]: value } as ImageVideoNodeOverride)
  }

  const bgmFolderOptions = [
    { value: '', label: '整个库' },
    ...(library?.bgm_folders ?? []).map((folder) => ({ value: folder.relative, label: folder.name })),
  ]
  const watermarkOptions = [
    { value: '', label: '整个库（轮转）' },
    ...(library?.watermark_folders ?? []).map((folder) => ({
      value: `folder:${folder.relative}`,
      label: `${folder.name}/（轮转）`,
    })),
    ...(library?.watermark ?? []).map((item) => ({
      value: `file:${item.folder ? `${item.folder}/${item.name}` : item.name}`,
      label: item.name,
    })),
  ]

  // 「用哪个水印」存的是库内相对路径 + 前缀，与下拉的 value 一一对应（空串 = 整个库）
  const watermarkValue = effective.watermarkPath
    ? effective.watermarkMode === 'folder'
      ? `folder:${effective.watermarkPath}`
      : `file:${effective.watermarkPath}`
    : ''

  /**
   * 命名上下文：与**落盘时**用的是同一份。
   *
   * `runVideoBatch` / `store.ts` 的自动触发走的是同一个 `resolveVideoNamingContext`——
   * 两边各算一份的话，会出现预览显示「产品-方向-渠道」俱全、实际落盘少一段。
   */
  const namingContext = useMemo(
    () =>
      resolveVideoNamingContext({
        collections,
        directionId: scope,
        mediaName,
        resolution: effective.resolution,
        creator,
      }),
    [collections, scope, mediaName, effective.resolution, creator],
  )

  /**
   * 文件名预览：模板 + 这一批的上下文 → 一个真实文件名。
   *
   * 序号固定写 `1`：它由引擎加在末尾，糖包只交出前缀，所以这里不能猜别的数。
   */
  const previewName = useMemo(() => {
    const prefix = resolveVideoNamePrefix(effective, namingContext)
    return prefix ? `${prefix}-1.mp4` : '1.mp4'
  }, [effective, namingContext])

  /** 模板写错（未知占位符 / 重复 / 写了 `{seq}`）当场提示，不等跑视频才发现名字不对。 */
  const namingIssues = useMemo(() => validateImageVideoNamePattern(effective.namePattern), [effective.namePattern])

  const pickOutputDir = async () => {
    try {
      const picked = await window.electronAPI?.selectDirectory?.()
      // null = 用户自己取消了，什么都不做（别把「取消」当成「清空」）
      if (picked) patch({ outputDir: picked })
    } catch {
      showToast('选择输出位置失败，请重试', 'error')
    }
  }

  usePreventBackgroundScroll(true, modalRef)

  const labelClass = 'text-xs text-ds-muted dark:text-ds-muted'
  const inputBase =
    'w-full rounded-ds-md border bg-ds-surface/60 px-2 py-1.5 text-sm text-ds-text outline-none transition dark:bg-ds-surface dark:text-ds-text-subtle'
  const inputClass = `${inputBase} border-ds-border/70 focus:border-ds-primary/60 dark:border-ds-border`
  const inputErrorClass = `${inputBase} border-ds-danger focus:border-ds-danger dark:border-ds-danger`
  const bareButtonClass =
    'shrink-0 rounded-ds-md border border-ds-border/70 px-3 py-1.5 text-xs text-ds-text transition hover:bg-ds-subtle disabled:opacity-40 dark:border-ds-border dark:text-ds-text-subtle dark:hover:bg-ds-surface'

  /**
   * 「图片数/视频」在「每张图各一个」模式下不生效（恒为 1）—— 置灰而不是藏起来：
   * 藏了用户会以为这个设置没了。数字字段一律草稿 + `onBlur` / 回车提交。
   */
  const perImageMode = effective.videoCountMode === 'perImage'

  /** 字段没表过态时，框里用灰字写出**实际生效的值** —— 不用打开上层就知道现在用的是几。 */
  const inheritedPlaceholder = (key: FieldKey) =>
    key in override ? '' : `跟随 ${String((effective[key] as number | string | undefined) ?? '')}`

  const renderNumberField = (field: FieldDef) => {
    const range = rangeOf(field.key)
    const bad = outOfRange(field.key)
    const disabled = field.key === 'imagesPerVideo' && perImageMode
    return (
      <label key={field.key as string} className="flex flex-col gap-1" title={field.hint}>
        <span className={labelClass}>
          {field.label}
          {field.unit ? <span className="ml-1 text-ds-muted">({field.unit})</span> : null}
        </span>
        {disabled ? (
          <span className="flex h-[34px] items-center text-sm text-ds-muted">1（每张图各一个）</span>
        ) : (
          <input
            type="number"
            inputMode="numeric"
            min={range?.min}
            max={range?.max}
            className={bad ? inputErrorClass : inputClass}
            value={draftValue(field.key)}
            placeholder={inheritedPlaceholder(field.key)}
            onChange={(event) => setDrafts((previous) => ({ ...previous, [field.key as string]: event.target.value }))}
            onBlur={() => commitNumber(field.key)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitNumber(field.key)
            }}
          />
        )}
        {bad ? (
          <span className="text-xs text-ds-danger">
            范围 {bad.min}~{bad.max}，超出的会自动收进范围
          </span>
        ) : null}
      </label>
    )
  }

  /**
   * 「视频数」那一格：模式 + 数量。
   *
   * 「每张图各一个」= 单图加特效那种（杰哥 2026-09-28 要的）：视频数跟着**目录里的图片数**走，
   * 每个视频只用 1 张图。数量框这时换成一句说明 —— 它是算出来的，填也没用。
   */
  const renderCountField = () => (
    <label className="flex flex-col gap-1" title="「每张图各一个」时视频数 = 目录里的图片数">
      <span className={labelClass}>视频数</span>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select
            value={effective.videoCountMode}
            onChange={(value) => patch({ videoCountMode: value === 'perImage' ? 'perImage' : 'fixed' })}
            options={[
              { value: 'fixed', label: '固定数量' },
              { value: 'perImage', label: '每张图各一个' },
            ]}
          />
        </div>
        {perImageMode ? (
          <span className="shrink-0 text-xs text-ds-muted">= 图片数</span>
        ) : (
          <input
            type="number"
            inputMode="numeric"
            className={`${inputClass} w-16 shrink-0`}
            value={draftValue('videoCount')}
            placeholder={inheritedPlaceholder('videoCount')}
            onChange={(event) => setDrafts((previous) => ({ ...previous, videoCount: event.target.value }))}
            onBlur={() => commitNumber('videoCount')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitNumber('videoCount')
            }}
          />
        )}
      </div>
    </label>
  )

  const renderSelectField = (
    key: FieldKey,
    label: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    /** 与 `Select` 的签名一致（它可能回数字）；取值方自己按需转，别在这里硬转一遍 */
    onChange: (value: string | number) => void,
    hint?: string,
  ) => (
    <label key={key as string} className="flex flex-col gap-1" title={hint}>
      <span className={labelClass}>{label}</span>
      <Select value={value} onChange={onChange} options={options} />
    </label>
  )

  const renderSwitchRow = (
    key: FieldKey,
    checked: boolean,
    label: string,
    description: string | undefined,
    onChange: (checked: boolean) => void,
  ) => (
    <div
      key={key as string}
      className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/50 px-3 py-2.5 dark:border-ds-border dark:bg-ds-surface"
    >
      <Switch checked={checked} onCheckedChange={onChange} label={label} description={description} />
    </div>
  )

  const renderTab = () => {
    switch (tab) {
      case 'rhythm':
        return (
          <div className="grid grid-cols-2 gap-3">
            {renderNumberField({
              key: 'imagesPerVideo',
              label: '图片数/视频',
              hint: '从目录里抽几张拼成一个视频；「每张图各一个」时恒为 1',
            })}
            {renderNumberField({ key: 'secondsPerImage', label: '每图秒数' })}
            {renderNumberField({
              key: 'totalDuration',
              label: '总时长',
              unit: '秒',
              hint: '0 = 按「图片数 × 每图秒数」自动算',
            })}
            {/* 「视频数」放最后：它比纯数字字段宽（模式 + 数量），排在末尾不挤前面几格 */}
            {renderCountField()}
          </div>
        )
      case 'frame':
        return (
          <div className="grid grid-cols-2 gap-3">
            {renderSelectField(
              'resolution',
              '分辨率',
              effective.resolution,
              toSelectOptions(IMAGE_VIDEO_RESOLUTIONS),
              (value) => patch({ resolution: String(value) }),
            )}
            {renderSelectField(
              'fps',
              '帧率',
              String(effective.fps),
              [24, 25, 30, 60].map((value) => ({ value: String(value), label: String(value) })),
              (value) => patch({ fps: Number(value) }),
            )}
            {renderSelectField(
              'imageSelection',
              '选图方式',
              effective.imageSelection,
              toSelectOptions(IMAGE_VIDEO_SELECTION_MODES),
              (value) => patch({ imageSelection: String(value) }),
              '糖包的口径是「同样配置跑出同样结果」，所以默认按名称排序（随机选图不可复现）',
            )}
            {renderNumberField({ key: 'bitrate', label: '码率', unit: 'kbps' })}
          </div>
        )
      case 'motion':
        return (
          <div className="grid grid-cols-2 gap-3">
            {renderSelectField(
              'transitionMode',
              '转场',
              transitionValue,
              [
                { value: MODE_OFF, label: '不用' },
                { value: MODE_RANDOM, label: '随机（每次不一样，不可复现）' },
                ...toSelectOptions(IMAGE_VIDEO_TRANSITIONS),
              ],
              (value) => applyMode('transitionMode', 'transitionType', String(value)),
            )}
            {renderSelectField(
              'effectMode',
              '画面效果',
              effectValue,
              [
                { value: MODE_OFF, label: '不动' },
                { value: MODE_RANDOM, label: '随机（每次不一样，不可复现）' },
                ...toSelectOptions(IMAGE_VIDEO_EFFECTS),
              ],
              (value) => applyMode('effectMode', 'effectType', String(value)),
            )}
            {renderNumberField({
              key: 'effectIntensity',
              label: '效果强度',
              hint: '100 = 引擎的设计强度，比 100 小则更轻微',
            })}
            {renderSelectField(
              'effectSpeed',
              '效果速度',
              String(effective.effectSpeed),
              [0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}x` })),
              (value) => patch({ effectSpeed: Number(value) }),
            )}
          </div>
        )
      case 'audio':
        return (
          <div className="space-y-3">
            {renderSwitchRow(
              'useBgm',
              effective.useBgm,
              'BGM（背景音乐）',
              '关着就不给成片配乐。默认关：靠默认值往成片里加声音，等到投放才发现不对就晚了。',
              (checked) => patch({ useBgm: checked }),
            )}
            <div className="grid grid-cols-2 gap-3">
              {renderSelectField('bgmFolder', '用哪组曲子', effective.bgmFolder, bgmFolderOptions, (value) =>
                patch({ bgmFolder: String(value) }),
              )}
              {renderSelectField(
                'bgmRandom',
                '选曲',
                effective.bgmRandom ? 'random' : 'rotate',
                [
                  { value: 'rotate', label: '按序号轮转' },
                  { value: 'random', label: '每个视频随机' },
                ],
                (value) => patch({ bgmRandom: value === 'random' }),
              )}
              {renderNumberField({ key: 'bgmVolume', label: '音量', hint: '0~1（不是百分比，1 = 原音量）' })}
              <label
                className="flex flex-col gap-1"
                title="一首曲子放完接着循环；关掉就是放完即止（视频比曲子长时后半段没声音）"
              >
                <span className={labelClass}>放完循环</span>
                <span className="flex h-[34px] items-center">
                  <Switch
                    checked={effective.bgmLoop}
                    onCheckedChange={(checked) => patch({ bgmLoop: checked })}
                    label=""
                  />
                </span>
              </label>
            </div>
          </div>
        )
      case 'watermark':
        return (
          <div className="space-y-3">
            {renderSwitchRow(
              'useVideoWatermark',
              effective.useVideoWatermark,
              '视频水印（MOV / MP4 / 图片）',
              '素材来自「视频素材」分区的水印库。默认关：不靠默认值改用户的成片。',
              (checked) => patch({ useVideoWatermark: checked }),
            )}
            <div className="grid grid-cols-2 gap-3">
              {renderSelectField(
                'watermarkPath',
                '用哪个水印',
                watermarkValue,
                watermarkOptions,
                (value) => {
                  const raw = String(value)
                  if (!raw) {
                    patch({ watermarkPath: '' })
                    return
                  }
                  const [kind, ...rest] = raw.split(':')
                  patch({
                    watermarkMode: kind === 'folder' ? 'folder' : 'single',
                    watermarkPath: rest.join(':'),
                  })
                },
                '整个库 = 按视频序号轮转取；也可以指定某个文件或某个子文件夹',
              )}
              {renderSelectField(
                'watermarkPosition',
                '位置',
                effective.watermarkPosition,
                toSelectOptions(IMAGE_VIDEO_WATERMARK_POSITIONS),
                (value) => patch({ watermarkPosition: String(value) }),
              )}
              {renderSelectField(
                'watermarkSizeMode',
                '大小模式',
                effective.watermarkSizeMode,
                toSelectOptions(IMAGE_VIDEO_WATERMARK_SIZE_MODES),
                (value) => patch({ watermarkSizeMode: String(value) }),
              )}
              {renderNumberField({ key: 'watermarkScale', label: '缩放', unit: '%' })}
              {renderSelectField(
                'watermarkBlendMode',
                '混合模式',
                effective.watermarkBlendMode,
                toSelectOptions(IMAGE_VIDEO_WATERMARK_BLEND_MODES),
                (value) => patch({ watermarkBlendMode: String(value) }),
              )}
              {renderSelectField(
                'watermarkMatchMethod',
                '时长匹配',
                effective.watermarkMatchMethod,
                toSelectOptions(IMAGE_VIDEO_WATERMARK_MATCH_METHODS),
                (value) => patch({ watermarkMatchMethod: String(value) }),
              )}
              {renderSelectField(
                'watermarkAudio',
                '成片音轨',
                effective.watermarkAudio,
                toSelectOptions(IMAGE_VIDEO_WATERMARK_AUDIO_MODES),
                (value) => patch({ watermarkAudio: String(value) }),
                '用了带音轨的水印视频时，成片留谁的声音',
              )}
            </div>
          </div>
        )
    }
  }

  const currentTab = TABS.find((item) => item.key === tab) ?? TABS[0]!
  const tabDirty = currentTab.keys.some((key) => key in override)

  return (
    <div data-no-drag-select className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4">
      {/*
       * 遮罩**刻意不绑 onClick**：改一个字段立刻落盘，误触遮罩不至于丢东西，但会让人怀疑
       * 「我是不是白配了」。关闭只留 ×、Esc、底部按钮这三条明确的路。
       */}
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-params-dialog-title"
        className="ds-modal-surface relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-ds-xl border p-5 animate-modal-in motion-reduce:animate-none"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 id="video-params-dialog-title" className="text-base font-medium text-ds-text dark:text-ds-text-subtle">
              视频参数 · {scopeLabel} · {mediaName}
            </h2>
            <p className="mt-1 text-xs text-ds-muted dark:text-ds-muted">
              只影响这个渠道，改一个字段立刻生效（
              {dirty ? '本渠道已单独配置' : '本渠道尚未单独配置，显示的是上层生效值'}）。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ds-muted transition hover:bg-ds-subtle dark:hover:bg-ds-surface"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {renderSwitchRow(
          'enabled',
          effective.enabled,
          '出视频（后处理一产出完就接着跑）',
          '关着也能在上方工具条手动生成；这个开关只影响本渠道。',
          (checked) => patch({ enabled: checked }),
        )}

        {/* 一次只显示一组（杰哥 2026-09-29）：改过的那组在标签上打点，不用挨个点进去找 */}
        <div className="mt-3 flex flex-wrap gap-1 border-b border-ds-border/70 pb-2 dark:border-ds-border">
          {TABS.map((item) => {
            const active = item.key === tab
            const changed = item.keys.some((key) => key in override)
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-ds-md px-3 py-1.5 text-xs transition ${
                  active
                    ? 'bg-ds-info-subtle text-ds-info'
                    : 'text-ds-muted hover:bg-ds-subtle dark:text-ds-muted dark:hover:bg-ds-surface'
                }`}
              >
                {item.label}
                {changed ? <span className="h-1.5 w-1.5 rounded-full bg-ds-info" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-3 pr-1">{renderTab()}</div>

        {/*
         * 输出与命名**固定在底部**、不随标签切换：这里是用户最常改的两项
         * （「这批成片放哪、叫什么」），而上面的参数是「配一次长期有效」的东西。
         */}
        <div className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/40 p-3 dark:border-ds-border dark:bg-ds-surface/60">
          <p className="mb-2 text-xs font-medium text-ds-text dark:text-ds-text-subtle">输出与命名</p>

          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-ds-muted dark:text-ds-muted">输出位置</span>
            <p
              className="min-w-0 flex-1 truncate rounded-ds-md border border-ds-border/70 bg-ds-surface/60 px-2 py-1.5 text-xs text-ds-text dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle"
              title={effective.outputDir || undefined}
            >
              {effective.outputDir ? (
                effective.outputDir
              ) : (
                <span className="text-ds-muted dark:text-ds-muted">默认：图片目录同级的「-视频」文件夹</span>
              )}
            </p>
            <button type="button" onClick={() => void pickOutputDir()} className={bareButtonClass}>
              选择文件夹
            </button>
            <button
              type="button"
              disabled={!('outputDir' in override)}
              onClick={() => patch({ outputDir: undefined })}
              className={bareButtonClass}
            >
              清除
            </button>
          </div>

          <div className="mt-3">
            <NamePatternField
              value={effective.namePattern}
              onChange={(value) => patch({ namePattern: value.trim() ? value : undefined })}
              tokens={IMAGE_VIDEO_NAME_TOKENS}
              placeholder={IMAGE_VIDEO_NAME_PATTERN}
              trailing={
                <button
                  type="button"
                  disabled={!('namePattern' in override)}
                  onClick={() => patch({ namePattern: undefined })}
                  className={bareButtonClass}
                >
                  恢复默认
                </button>
              }
            />

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-1.5 dark:border-ds-border dark:bg-ds-surface-subtle">
              <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">文件名预览</span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs text-ds-text dark:text-ds-text"
                title={previewName}
              >
                {previewName}
              </span>
              <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">末尾序号自动加</span>
            </div>

            {namingIssues.map((issue) => (
              <div key={issue.message} className="mt-1.5">
                <Alert tone={issue.tone === 'error' ? 'danger' : 'warning'}>{issue.message}</Alert>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ds-border/70 pt-3 dark:border-ds-border">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!tabDirty}
              onClick={() => resetKeys(currentTab.keys)}
              className={bareButtonClass}
            >
              恢复「{currentTab.label}」默认
            </button>
            <button
              type="button"
              disabled={!dirty}
              onClick={() => resetKeys(IMAGE_VIDEO_FIELD_KEYS)}
              className={bareButtonClass}
            >
              全部恢复默认
            </button>
            {otherMedias.length > 0 && dirty ? (
              <button
                type="button"
                onClick={() => otherMedias.forEach((item) => setImageVideoOverride(scope, { ...override }, item.id))}
                className={bareButtonClass}
              >
                应用到本方向的其它 {otherMedias.length} 个渠道
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-ds-md border border-ds-border-info bg-ds-info-subtle px-3 py-1.5 text-xs text-ds-info transition hover:opacity-90"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
