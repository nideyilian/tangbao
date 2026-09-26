/**
 * 中控台「视频」分区：**一行一个方向**配图转视频参数，左边树定作用域。
 *
 * ## 形态与既有分区对齐
 *
 * 「改什么」跟着左侧项目树走 —— 树选到哪个方向，这张表里出现哪个方向的行。
 * 表格第一行永远是**全局（所有方向）**，它下面是作用域内的方向行；上一行是下一行的继承来源，
 * 从上往下读就是继承链。
 *
 * ## 留空 = 继承，两条规则与后处理一字不差
 *
 * - **方向行**留空 ⇒ 继续向上取（方向 → 产品 → 产品线 → 全局），格子的占位文字会写明
 *   「跟随：6」这样的具体值 —— 不写清楚，用户没法核对到底会生效成什么；
 * - **全局行**留空 ⇒ 回到默认值（它上面没有别的东西可继承）。
 *
 * 「启用」这一列是三态而不是开关：`跟随上级 / 出 / 不出`。用开关就没法表达「我没意见」——
 * 那会让每个方向都必须自己表一次态，上层开关一改，下面全部跟不上。
 *
 * ## 转场与动态效果是**一列下拉**，不是「模式 + 具体样式」两列
 *
 * 用户想的是「用哪种转场」，不是「先选模式再选样式」。所以下拉里直接并列：
 * `不用` / `随机` / 33 种具体转场名。选中具体名字 ⇒ 引擎那边是
 * `use_transition=true, random_transition=false, transition_type=名字`（映射见 `params.ts`）。
 * 两列合成的代价是一次提交写两个字段（`onCellCommit` 里一起写），换来的是少 4 列宽度。
 *
 * ## 出视频是重活，所以按钮不常亮
 *
 * 「生成视频」只在**选中某个方向**、且**那个方向找得到图片目录**、且**引擎在位**时才可用；
 * 且它只跑这一个方向，不提供「所有方向一起跑」——批量出视频会长时间占满 CPU，
 * 那应该是显式多次点击的结果，不是一个顺手点的按钮。
 */

import { useCallback, useMemo, useState } from 'react'
import { Badge, Button, DataGrid, Inline, Stack } from '../../design-system'
import type { DataGridColumn } from '../../design-system'
import { useStore } from '../../store'
import type { TaskRecord } from '../../types'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { isGlobalScope } from '../composite/lib/controlConsoleSections'
import { collectDirectionIds, describeCollectionPath } from '../dailyBatch/scope'
import { GLOBAL_NODE_ID } from '../postprocess/paramSchema'
import { resolveProjectImageVideoParams } from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { resolveDirectionInputDirs, runImageVideoJob } from './runVideo'
import { useImageVideoStore } from './store'
import {
  IMAGE_VIDEO_EFFECTS,
  IMAGE_VIDEO_RESOLUTIONS,
  IMAGE_VIDEO_TRANSITIONS,
  type ImageVideoNodeOverride,
  type ImageVideoParams,
} from './types'
import { useImageVideoEngine } from './useImageVideoEngine'

/** 「不用」「随机」在下拉里的两个哨兵值（不会和转场/效果名撞）。 */
const MODE_OFF = '__off__'
const MODE_RANDOM = '__random__'

/** 「出视频」三态在下拉里的值。 */
const ENABLED_INHERIT = ''
const ENABLED_ON = 'on'
const ENABLED_OFF = 'off'

interface ImageVideoRow {
  id: string
  name: string
  isGlobal: boolean
  /** 本级覆盖（全局行恒为空对象） */
  override: ImageVideoNodeOverride
  /** 本级生效值（含继承） */
  effective: ImageVideoParams
  /** 上一级的生效值 —— 占位文字按它显示「跟随：X」 */
  inherited: ImageVideoParams
  /** 这个方向能拿到的图片目录数（全局行为 0） */
  inputDirCount: number
}

interface Props {
  /** 中控台作用域：`GLOBAL_NODE_ID` 或某个 `AssetCollection.id` */
  scope: string
}

export function ImageVideoSection({ scope }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const nodeParams = useProjectTreeParamsStore((state) => state.params)
  const setNodeOverride = useProjectTreeParamsStore((state) => state.setImageVideoOverride)
  const globals = useImageVideoStore((state) => state.globals)
  const setGlobals = useImageVideoStore((state) => state.setGlobals)
  const tasks = useStore((state) => state.tasks)
  const engine = useImageVideoEngine()

  const [running, setRunning] = useState<{
    directionId: string
    message: string
    percent: number
    batchIndex: number
    batchTotal: number
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [abortController, setAbortController] = useState<AbortController | null>(null)

  const isGlobal = isGlobalScope(scope)
  /** 方向 = 项目树第 3 级；全局作用域时传 null 表示「全树搜」 */
  const directionIds = useMemo(
    () => collectDirectionIds(collections, isGlobal ? null : scope),
    [collections, scope, isGlobal],
  )

  /** 方向 id → 这次能拿到的图片目录（来自任务的后处理产出记录） */
  const dirsByDirection = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const task of tasks as TaskRecord[]) {
      const outputs = task.postprocessOutputs
      if (!outputs || outputs.length === 0) continue
      for (const directionId of directionIds) {
        const dirs = resolveDirectionInputDirs(outputs, directionId)
        if (dirs.length === 0) continue
        const existing = map.get(directionId) ?? []
        for (const dir of dirs) if (!existing.includes(dir)) existing.push(dir)
        map.set(directionId, existing)
      }
    }
    return map
  }, [tasks, directionIds])

  const rows: ImageVideoRow[] = useMemo(() => {
    const globalRow: ImageVideoRow = {
      id: GLOBAL_NODE_ID,
      name: '全局（所有方向）',
      isGlobal: true,
      override: {},
      effective: globals,
      inherited: globals,
      inputDirCount: 0,
    }
    const directionRows = directionIds.map((id) => {
      // 上一级生效值 = 从主线算到**父节点**为止；节点没有父级时就是全局基线
      const parentId = collections.find((item) => item.id === id)?.parentId ?? null
      return {
        id,
        name: describeCollectionPath(collections, id).join(' / '),
        isGlobal: false,
        override: nodeParams[id]?.imageVideo ?? {},
        effective: resolveProjectImageVideoParams(collections, nodeParams, id, globals),
        inherited: resolveProjectImageVideoParams(collections, nodeParams, parentId, globals),
        inputDirCount: dirsByDirection.get(id)?.length ?? 0,
      }
    })
    return [globalRow, ...directionRows]
  }, [collections, directionIds, globals, nodeParams, dirsByDirection])

  /** 一次提交只改一个格子的数据，其它字段原样不动。 */
  const commitPatch = useCallback(
    (rowId: string, patch: ImageVideoNodeOverride) => {
      if (rowId === GLOBAL_NODE_ID) {
        // 全局层没有「继承」这一说：留空就是回默认值（`setGlobals` 内部会归一化补默认）
        setGlobals(patch as Partial<ImageVideoParams>)
        return
      }
      setNodeOverride(rowId, patch)
    },
    [setGlobals, setNodeOverride],
  )

  const handleCellCommit = useCallback(
    (rowId: string, columnKey: string, value: unknown) => {
      switch (columnKey) {
        case 'enabled':
          commitPatch(rowId, { enabled: value === ENABLED_ON ? true : value === ENABLED_OFF ? false : undefined })
          return
        case 'transition': {
          const text = typeof value === 'string' ? value : ''
          if (text === MODE_OFF) commitPatch(rowId, { transitionMode: 'off' })
          else if (text === MODE_RANDOM) commitPatch(rowId, { transitionMode: 'random' })
          else if (text) commitPatch(rowId, { transitionMode: 'fixed', transitionType: text })
          else commitPatch(rowId, { transitionMode: undefined, transitionType: undefined })
          return
        }
        case 'effect': {
          const text = typeof value === 'string' ? value : ''
          if (text === MODE_OFF) commitPatch(rowId, { effectMode: 'off' })
          else if (text === MODE_RANDOM) commitPatch(rowId, { effectMode: 'random' })
          else if (text) commitPatch(rowId, { effectMode: 'fixed', effectType: text })
          else commitPatch(rowId, { effectMode: undefined, effectType: undefined })
          return
        }
        default: {
          const text = typeof value === 'string' ? value.trim() : value
          const blank = text === '' || text === undefined || text === null
          commitPatch(rowId, { [columnKey]: blank ? undefined : text } as ImageVideoNodeOverride)
        }
      }
    },
    [commitPatch],
  )

  const columns = useMemo<Array<DataGridColumn<ImageVideoRow>>>(() => {
    /** 占位文字：节点行念继承值，全局行念默认值。 */
    const inheritHint = (row: ImageVideoRow, pick: (params: ImageVideoParams) => string, label: string) =>
      row.isGlobal ? label : `跟随：${pick(row.inherited)}`

    return [
      {
        key: 'scope',
        header: '范围',
        help: '这一行改的是全局基线，还是某个方向自己的那份',
        editor: 'readonly',
        width: 150,
        render: (row) => (
          <span className={row.isGlobal ? 'font-medium text-ds-text' : 'text-ds-text'} title={row.name}>
            {row.name}
          </span>
        ),
      },
      {
        key: 'enabled',
        header: '出视频',
        help: '这个方向要不要生成视频。默认「跟随上级」；全局层默认不出，需要用哪个方向就在那一行打开',
        editor: 'select',
        width: 96,
        align: 'center',
        options: [
          { value: ENABLED_INHERIT, label: '跟随上级' },
          { value: ENABLED_ON, label: '出' },
          { value: ENABLED_OFF, label: '不出' },
        ],
        getValue: (row) =>
          row.override.enabled === undefined ? ENABLED_INHERIT : row.override.enabled ? ENABLED_ON : ENABLED_OFF,
        placeholderForRow: (row) =>
          row.isGlobal ? '不出' : row.inherited.enabled ? '跟随上级（出）' : '跟随上级（不出）',
      },
      {
        key: 'imagesPerVideo',
        header: '图片数/视频',
        help: '每个视频放几张图。图片会按选图方式从目录里取',
        editor: 'number',
        width: 110,
        align: 'end',
        placeholderForRow: (row) => inheritHint(row, (params) => String(params.imagesPerVideo), '6'),
      },
      {
        key: 'secondsPerImage',
        header: '每图秒数',
        help: '每张图停留多久',
        editor: 'number',
        width: 96,
        align: 'end',
        placeholderForRow: (row) => inheritHint(row, (params) => String(params.secondsPerImage), '2'),
      },
      {
        key: 'totalDuration',
        header: '总时长(秒)',
        help: '固定成片总长度；填 0 = 按「图片数 × 每图秒数」自动算',
        editor: 'number',
        width: 104,
        align: 'end',
        placeholderForRow: (row) => inheritHint(row, (params) => String(params.totalDuration), '0'),
      },
      {
        key: 'videoCount',
        header: '视频数',
        help: '这个方向一次出几个视频',
        editor: 'number',
        width: 84,
        align: 'end',
        placeholderForRow: (row) => inheritHint(row, (params) => String(params.videoCount), '1'),
      },
      {
        key: 'resolution',
        header: '分辨率',
        help: '成片尺寸',
        editor: 'select',
        width: 116,
        options: IMAGE_VIDEO_RESOLUTIONS.map((item) => ({ value: item, label: item })),
        placeholderForRow: (row) => inheritHint(row, (params) => params.resolution, '1280x720'),
      },
      {
        key: 'fps',
        header: '帧率',
        help: '每秒多少帧；投放平台一般 30 就够',
        editor: 'number',
        width: 76,
        align: 'end',
        placeholderForRow: (row) => inheritHint(row, (params) => String(params.fps), '30'),
      },
      {
        key: 'transition',
        header: '转场',
        help: '图片之间怎么切换。「随机」是每个视频各随机一种',
        editor: 'select',
        width: 116,
        options: [
          { value: MODE_OFF, label: '不用' },
          { value: MODE_RANDOM, label: '随机' },
          ...IMAGE_VIDEO_TRANSITIONS.map((item) => ({ value: item, label: item })),
        ],
        getValue: (row) =>
          row.override.transitionMode === undefined
            ? ''
            : row.override.transitionMode === 'off'
              ? MODE_OFF
              : row.override.transitionMode === 'random'
                ? MODE_RANDOM
                : (row.override.transitionType ?? ''),
        placeholderForRow: (row) => (row.isGlobal ? '淡入淡出' : `跟随：${describeTransition(row.inherited)}`),
      },
      {
        key: 'effect',
        header: '画面效果',
        help: '画面在动画里的动态（缓慢推拉、呼吸等）。「随机」是每个视频各随机一种',
        editor: 'select',
        width: 132,
        options: [
          { value: MODE_OFF, label: '不动' },
          { value: MODE_RANDOM, label: '随机' },
          ...IMAGE_VIDEO_EFFECTS.map((item) => ({ value: item, label: item })),
        ],
        getValue: (row) =>
          row.override.effectMode === undefined
            ? ''
            : row.override.effectMode === 'off'
              ? MODE_OFF
              : row.override.effectMode === 'random'
                ? MODE_RANDOM
                : (row.override.effectType ?? ''),
        placeholderForRow: (row) => (row.isGlobal ? '镜头呼吸' : `跟随：${describeEffect(row.inherited)}`),
      },
      {
        key: 'effectIntensity',
        header: '效果强度',
        help: '百分比，100 是设计强度；调小则更轻微',
        editor: 'number',
        width: 96,
        align: 'end',
        placeholderForRow: (row) => inheritHint(row, (params) => String(params.effectIntensity), '100'),
      },
      {
        key: 'bitrate',
        header: '码率(kbps)',
        help: '越高越清晰、文件越大。2000 适合投放',
        editor: 'number',
        width: 104,
        align: 'end',
        placeholderForRow: (row) => inheritHint(row, (params) => String(params.bitrate), '2000'),
      },
      {
        key: 'filePrefix',
        header: '文件名前缀',
        help: '视频文件名的开头；留空则只有序号（如 1.mp4）',
        editor: 'text',
        width: 118,
        placeholderForRow: (row) => (row.isGlobal ? '（只有序号）' : '跟随上级'),
      },
      {
        key: 'outputDir',
        header: '输出位置',
        help: '视频写到哪。留空 = 写在图片目录同级的「<目录名>-视频」里',
        editor: 'path',
        pickPath: async () => (await window.electronAPI?.selectDirectory?.()) ?? null,
        placeholderForRow: (row) => (row.isGlobal ? '（图片目录同级 -视频）' : '留空 = 图片目录同级'),
      },
    ]
  }, [])

  const selectedDirectionId = isGlobal ? null : scope
  const selectedRow = selectedDirectionId ? rows.find((row) => row.id === selectedDirectionId) : undefined
  // 必须包 useMemo：直接写 `?? []` 会每次渲染都产出一个新数组，让下面的 useCallback 依赖失效
  const selectedDirs = useMemo(
    () => (selectedDirectionId ? (dirsByDirection.get(selectedDirectionId) ?? []) : []),
    [selectedDirectionId, dirsByDirection],
  )
  const engineReady = Boolean(engine.status?.available)
  const canRun = Boolean(selectedDirectionId && selectedDirs.length > 0 && engineReady && !running)

  const handleRun = useCallback(async () => {
    if (!selectedDirectionId || !selectedRow) return
    setNotice(null)
    const controller = new AbortController()
    setAbortController(controller)
    const params = selectedRow.effective
    let completed = 0
    try {
      for (let index = 0; index < selectedDirs.length; index += 1) {
        const inputDir = selectedDirs[index]!
        setRunning({
          directionId: selectedDirectionId,
          message: '正在准备…',
          percent: 0,
          batchIndex: index + 1,
          batchTotal: selectedDirs.length,
        })
        const result = await runImageVideoJob({
          inputDir,
          params,
          signal: controller.signal,
          onProgress: (progress) => {
            setRunning({
              directionId: selectedDirectionId,
              message: progress.message || '渲染中…',
              percent: progress.overall || progress.percent,
              batchIndex: index + 1,
              batchTotal: selectedDirs.length,
            })
          },
        })
        if (result.status === 'cancelled') {
          setNotice(`已取消：停止前已完成 ${completed} 个视频目录`)
          return
        }
        if (result.status === 'failed') {
          setNotice(`生成失败：${result.message || '引擎报错'}（目录 ${inputDir}）`)
          return
        }
        completed += 1
      }
      setNotice(`生成完成：${completed} 个视频目录已输出`)
    } catch (error) {
      setNotice(`生成失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRunning(null)
      setAbortController(null)
    }
  }, [selectedDirectionId, selectedRow, selectedDirs])

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Inline gap={2} align="center" wrap>
          <span className="text-sm font-medium text-ds-text">图转视频</span>
          {engine.loading ? (
            <Badge tone="neutral">检测引擎…</Badge>
          ) : engineReady ? (
            <Badge tone="success">引擎就绪</Badge>
          ) : (
            <Badge tone="danger">引擎不可用</Badge>
          )}
          {engine.status?.ffmpegPath ? (
            <span className="text-xs text-ds-muted" title={engine.status.ffmpegPath}>
              ffmpeg：{engine.status.ffmpegVersion?.split(' ').slice(0, 3).join(' ') ?? '已就绪'}
            </span>
          ) : null}
        </Inline>
        <p className="text-xs text-ds-muted">
          {engineReady
            ? '参数按左侧项目树分层：点全局行改所有方向的基线，点某个方向的行只改它自己。格子里留空 = 向上继承，占位文字会写出会生效成什么。'
            : (engine.status?.reason ?? '当前环境不支持图转视频（需要在桌面应用里使用）。')}
        </p>
        {!engine.loading && !engineReady ? (
          <p className="text-xs text-ds-muted">
            引擎是独立程序，需要先取到本地：在项目根执行 <code>npm run engine:fetch</code>。
          </p>
        ) : null}
      </Stack>

      <DataGrid
        aria-label="图转视频参数"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onCellCommit={handleCellCommit}
        emptyTitle="当前作用域下没有方向"
        emptyDescription="视频参数是按方向配的，先在左侧项目树建好方向（第 3 级节点）。"
      />

      <Stack gap={2}>
        <Inline gap={2} align="center" wrap>
          <Button onClick={handleRun} disabled={!canRun}>
            生成视频
          </Button>
          {running ? (
            <Button variant="ghost" onClick={() => abortController?.abort()}>
              取消
            </Button>
          ) : null}
          {running ? (
            <span className="text-xs text-ds-muted">
              第 {running.batchIndex}/{running.batchTotal} 个目录 · {running.percent}% · {running.message}
            </span>
          ) : !selectedDirectionId ? (
            <span className="text-xs text-ds-muted">在左边树里点一个方向，再来生成视频。</span>
          ) : selectedDirs.length === 0 ? (
            <span className="text-xs text-ds-muted">
              这个方向还没有可用的图片目录 —— 先跑一次后处理把图导出来（视频用导出后的图）。
            </span>
          ) : (
            <span className="text-xs text-ds-muted">
              将处理 {selectedDirs.length} 个图片目录 · {rows.find((row) => row.id === selectedDirectionId)?.name}
            </span>
          )}
        </Inline>
        {notice ? <p className="text-xs text-ds-text">{notice}</p> : null}
        {selectedDirs.length > 1 ? (
          <p className="text-xs text-ds-muted">这个方向有多个产出目录（多渠道各一份），每个目录各自出一批视频。</p>
        ) : null}
      </Stack>
    </Stack>
  )
}

/** 把生效参数里的转场读成下拉上那个字（供占位提示用）。 */
function describeTransition(params: ImageVideoParams): string {
  if (params.transitionMode === 'off') return '不用'
  if (params.transitionMode === 'random') return '随机'
  return params.transitionType
}

function describeEffect(params: ImageVideoParams): string {
  if (params.effectMode === 'off') return '不动'
  if (params.effectMode === 'random') return '随机'
  return params.effectType
}
