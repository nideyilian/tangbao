/**
 * 视频参数弹窗：某个「方向 × 渠道」的图转视频参数。
 *
 * ## 为什么是弹窗，而不是表格里的 20 列
 *
 * 引擎的参数有 20 项，横排成表格要横向滚动、一屏看不到几行（TB-137 才刚为列宽 / 行高打过补丁），
 * 而这些参数是「配一次长期有效」的东西 —— 杰哥 2026-09-28 定下的形态：表格里每行只留一个入口
 * 与状态，参数收进弹窗按组分好。
 *
 * ## 值从哪来、写到哪去
 *
 * - **读**：`imageVideoByMedia[渠道] ?? imageVideo（节点缺省）?? 沿树向上 ?? 全局默认`，
 *   弹窗里显示的就是**生效值**（`resolveProjectImageVideoParams` 同一条链）。
 * - **写**：只写 `imageVideoByMedia[渠道]`。改这个渠道不会动别的渠道，也不会动节点缺省那份
 *   （那份是 2026-09-28 之前的老配置，留着继续生效 —— 所以没有数据迁移）。
 * - **改一个字段立刻落盘**：与表格的手感一致，不留「保存」按钮 —— 用户改完往往就想直接去跑视频。
 *   数字字段例外（本地草稿 + `onBlur` 提交）：边打字边提交会先把「1」写进去，再写「12」，
 *   中间那一瞬间的脏值会被别的订阅方读走（`commitPostprocessMaxSize` 是同一个处理）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Switch, useDialogFocusTrap } from '../../design-system'
import Select from '../../components/Select'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { resolveProjectImageVideoParams } from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { loadVideoLibrary, type VideoLibrarySnapshot } from './library'
import { IMAGE_VIDEO_NUMBER_RANGES } from './params'
import { useImageVideoStore } from './store'
import {
  IMAGE_VIDEO_EFFECTS,
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

interface FieldDef {
  key: FieldKey
  label: string
  unit?: string
  hint?: string
}

interface FieldGroup {
  title: string
  /** 一行放几个（窄字段 4 个、长字段 2 个） */
  columns: number
  fields: FieldDef[]
}

const GROUPS: FieldGroup[] = [
  {
    title: '节奏',
    columns: 4,
    fields: [
      { key: 'imagesPerVideo', label: '图片数/视频', hint: '从目录里抽几张拼成一个视频' },
      { key: 'secondsPerImage', label: '每图秒数' },
      { key: 'totalDuration', label: '总时长', unit: '秒', hint: '0 = 按「图片数 × 每图秒数」自动算' },
      { key: 'videoCount', label: '视频数' },
    ],
  },
  {
    title: '画面',
    columns: 4,
    fields: [
      { key: 'bitrate', label: '码率', unit: 'kbps' },
      { key: 'effectIntensity', label: '效果强度', hint: '100 = 引擎的设计强度' },
      { key: 'filePrefix', label: '文件名前缀', hint: '留空 = 只用序号' },
      { key: 'outputDir', label: '输出位置', hint: '留空 = 图片目录同级的「-视频」文件夹' },
    ],
  },
  {
    title: '声音',
    columns: 4,
    fields: [{ key: 'bgmVolume', label: '音量', hint: '0~1（不是百分比）' }],
  },
  {
    title: '视频水印',
    columns: 4,
    fields: [{ key: 'watermarkScale', label: '缩放', unit: '%' }],
  },
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

  /** 当前是否配过（有没有任何一个字段表过态）—— 决定「恢复默认」按钮能不能点。 */
  const dirty = Object.keys(override).length > 0

  const patch = (next: ImageVideoNodeOverride) => setImageVideoOverride(scope, next, mediaId)

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

  usePreventBackgroundScroll(true, modalRef)

  const labelClass = 'text-xs text-ds-muted dark:text-ds-muted'
  const inputClass =
    'w-full rounded-ds-md border border-ds-border/70 bg-ds-surface/60 px-2 py-1.5 text-sm text-ds-text outline-none transition focus:border-ds-primary/60 dark:border-ds-border dark:bg-ds-surface dark:text-ds-text-subtle'

  const renderField = (field: FieldDef) => {
    const range = rangeOf(field.key)
    return (
      <label key={field.key as string} className="flex flex-col gap-1" title={field.hint}>
        <span className={labelClass}>
          {field.label}
          {field.unit ? <span className="ml-1 text-ds-muted">({field.unit})</span> : null}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={range?.min}
          max={range?.max}
          className={inputClass}
          value={draftValue(field.key)}
          placeholder={field.hint ? '默认' : ''}
          onChange={(event) => setDrafts((previous) => ({ ...previous, [field.key as string]: event.target.value }))}
          onBlur={() => commitNumber(field.key)}
        />
      </label>
    )
  }

  return (
    <div data-no-drag-select className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4">
      <div
        className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none"
        onClick={onClose}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-params-dialog-title"
        className="ds-modal-surface relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col rounded-ds-xl border p-5 animate-modal-in motion-reduce:animate-none"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="video-params-dialog-title" className="text-base font-medium text-ds-text dark:text-ds-text-subtle">
              视频参数 · {scopeLabel} · {mediaName}
            </h2>
            <p className="mt-1 text-xs text-ds-muted dark:text-ds-muted">
              只影响这个渠道。留空 = 沿用默认（
              {dirty ? '本渠道已单独配置' : '本渠道尚未单独配置'}）。
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

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div className="rounded-ds-lg border border-ds-border/70 bg-ds-surface/50 px-3 py-2.5 dark:border-ds-border dark:bg-ds-surface">
            <Switch
              checked={effective.enabled}
              onCheckedChange={(checked) => patch({ enabled: checked })}
              label="出视频（后处理一产出完就接着跑）"
              description="关着也能在上方工具条手动生成；这个开关只影响本渠道。"
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>分辨率</span>
              <Select
                value={effective.resolution}
                onChange={(value) => patch({ resolution: String(value) })}
                options={toSelectOptions(IMAGE_VIDEO_RESOLUTIONS)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>帧率</span>
              <Select
                value={String(effective.fps)}
                onChange={(value) => patch({ fps: Number(value) })}
                options={[24, 25, 30, 60].map((value) => ({ value: String(value), label: String(value) }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>选图方式</span>
              <Select
                value={effective.imageSelection}
                onChange={(value) => patch({ imageSelection: String(value) })}
                options={toSelectOptions(IMAGE_VIDEO_SELECTION_MODES)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>文件名带日期</span>
              <span className="flex h-[34px] items-center">
                <Switch
                  checked={effective.datePrefix}
                  onCheckedChange={(checked) => patch({ datePrefix: checked })}
                  label=""
                />
              </span>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>转场</span>
              <Select
                value={transitionValue}
                onChange={(value) => applyMode('transitionMode', 'transitionType', String(value))}
                options={[
                  { value: MODE_OFF, label: '不用' },
                  { value: MODE_RANDOM, label: '随机' },
                  ...toSelectOptions(IMAGE_VIDEO_TRANSITIONS),
                ]}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>画面效果</span>
              <Select
                value={effectValue}
                onChange={(value) => applyMode('effectMode', 'effectType', String(value))}
                options={[
                  { value: MODE_OFF, label: '不动' },
                  { value: MODE_RANDOM, label: '随机' },
                  ...toSelectOptions(IMAGE_VIDEO_EFFECTS),
                ]}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>效果速度</span>
              <Select
                value={String(effective.effectSpeed)}
                onChange={(value) => patch({ effectSpeed: Number(value) })}
                options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}x` }))}
              />
            </label>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <p className="text-xs text-ds-muted dark:text-ds-muted">{group.title}</p>
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))` }}>
                {group.fields.map((field) => renderField(field))}
              </div>
            </div>
          ))}

          <div className="space-y-2">
            <Switch
              checked={effective.useBgm}
              onCheckedChange={(checked) => patch({ useBgm: checked })}
              label="BGM（背景音乐）"
            />
            <div className="grid grid-cols-4 gap-3">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>用哪组曲子</span>
                <Select
                  value={effective.bgmFolder}
                  onChange={(value) => patch({ bgmFolder: String(value) })}
                  options={bgmFolderOptions}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>选曲</span>
                <Select
                  value={effective.bgmRandom ? 'random' : 'rotate'}
                  onChange={(value) => patch({ bgmRandom: value === 'random' })}
                  options={[
                    { value: 'rotate', label: '按序号轮转' },
                    { value: 'random', label: '每个视频随机' },
                  ]}
                />
              </label>
              <label className="flex flex-col gap-1">
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

          <div className="space-y-2">
            <Switch
              checked={effective.useVideoWatermark}
              onCheckedChange={(checked) => patch({ useVideoWatermark: checked })}
              label="视频水印（MOV / MP4 / 图片）"
            />
            <div className="grid grid-cols-4 gap-3">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>用哪个水印</span>
                <Select
                  value={watermarkValue}
                  onChange={(value) => {
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
                  }}
                  options={watermarkOptions}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>位置</span>
                <Select
                  value={effective.watermarkPosition}
                  onChange={(value) => patch({ watermarkPosition: String(value) })}
                  options={toSelectOptions(IMAGE_VIDEO_WATERMARK_POSITIONS)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>大小模式</span>
                <Select
                  value={effective.watermarkSizeMode}
                  onChange={(value) => patch({ watermarkSizeMode: String(value) })}
                  options={toSelectOptions(IMAGE_VIDEO_WATERMARK_SIZE_MODES)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>混合模式</span>
                <Select
                  value={effective.watermarkBlendMode}
                  onChange={(value) => patch({ watermarkBlendMode: String(value) })}
                  options={toSelectOptions(IMAGE_VIDEO_WATERMARK_BLEND_MODES)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>时长匹配</span>
                <Select
                  value={effective.watermarkMatchMethod}
                  onChange={(value) => patch({ watermarkMatchMethod: String(value) })}
                  options={toSelectOptions(IMAGE_VIDEO_WATERMARK_MATCH_METHODS)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>成片音轨</span>
                <Select
                  value={effective.watermarkAudio}
                  onChange={(value) => patch({ watermarkAudio: String(value) })}
                  options={toSelectOptions(IMAGE_VIDEO_WATERMARK_AUDIO_MODES)}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ds-border/70 pt-3 dark:border-ds-border">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!dirty}
              onClick={() => patch({ ...resetPatch() })}
              className="rounded-ds-md border border-ds-border/70 px-3 py-1.5 text-xs text-ds-text transition hover:bg-ds-subtle disabled:opacity-40 dark:border-ds-border dark:text-ds-text-subtle dark:hover:bg-ds-surface"
            >
              恢复默认
            </button>
            {otherMedias.length > 0 && dirty ? (
              <button
                type="button"
                onClick={() => otherMedias.forEach((item) => setImageVideoOverride(scope, { ...override }, item.id))}
                className="rounded-ds-md border border-ds-border/70 px-3 py-1.5 text-xs text-ds-text transition hover:bg-ds-subtle dark:border-ds-border dark:text-ds-text-subtle dark:hover:bg-ds-surface"
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
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

/** 把该渠道这一层写的字段**逐个清空**（`undefined` = 删掉这个键 = 回到默认）。 */
function resetPatch(): ImageVideoNodeOverride {
  return {
    enabled: undefined,
    imagesPerVideo: undefined,
    secondsPerImage: undefined,
    totalDuration: undefined,
    videoCount: undefined,
    resolution: undefined,
    fps: undefined,
    imageSelection: undefined,
    transitionMode: undefined,
    transitionType: undefined,
    effectMode: undefined,
    effectType: undefined,
    effectIntensity: undefined,
    effectSpeed: undefined,
    bitrate: undefined,
    filePrefix: undefined,
    datePrefix: undefined,
    outputDir: undefined,
    useBgm: undefined,
    bgmVolume: undefined,
    bgmRandom: undefined,
    bgmLoop: undefined,
    bgmFolder: undefined,
    useVideoWatermark: undefined,
    watermarkMode: undefined,
    watermarkPath: undefined,
    watermarkPosition: undefined,
    watermarkSizeMode: undefined,
    watermarkScale: undefined,
    watermarkBlendMode: undefined,
    watermarkMatchMethod: undefined,
    watermarkAudio: undefined,
  }
}
