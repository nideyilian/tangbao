/**
 * 中控台数据的 Excel 工作簿（TB-060）。
 *
 * ## 分层：纯数据 / xlsx
 *
 * `buildConsoleSheets` 只做「把数据面摊成二维表」，**不 import xlsx** ——
 * 于是 12 张表的字段映射可以在 vitest 里逐列断言，不需要真的写出一个 Excel。
 * `writeConsoleWorkbook` 才动态 `import('xlsx')`，把二维表变成二进制。
 * 这两层分开还有一个好处：将来换生成器（或手写 OOXML）只动下面那一层。
 *
 * ## 表头是两行
 *
 * 第一行**字段键**、第二行中文显示名：
 *
 * ```
 * id        | name    | parentId
 * 方向ID    | 名称    | 父级ID
 * ```
 *
 * 导入一律按**字段键**匹配（见方案 §4.2），中文只给人看。这样界面文案随便改，
 * 导出文件与导入器的契约不断。`key` 与 `DataGrid` 的列 `key` 是同一套协议，
 * 改一处要改两处（这条记在 `docs/BACKLOG.md` 的技术债里）。
 *
 * ## 空值的语义
 *
 * 目录类字段**空字符串 = 继承**（不是「显式覆盖为空」）。表格里看不出来，所以：
 * - `output_dirs_global` 列**全部渠道**（空 = 用默认位置），而不是只列配过的；
 * - `watermark_binding` 用**哨兵行**（`__postprocess_global__`）表示全局清单，
 *   与「某个方向显式声明」区分开 —— 两者语义不同，混在一起会让导入侧无从判断。
 */

import type { AssetCollection } from '../../../types'
import type { PostprocessMediaConfig } from '../../../lib/postprocessMedia'
import type { PostprocessDistributionConfig } from '../../../lib/postprocessDistribution'
import type { CompositeV2IdentifierConfig, CompositeV2Preset } from './compositeV2Types'
import type { ProjectNodeParamsMap } from '../../projectTree/types'
import {
  resolveNodeWatermarkBinding,
  resolveProjectPostprocessSlice,
  resolveProjectNodeKind,
} from '../../projectTree/params'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { PURE_MEDIA_ID, resolveOutputDirection } from '../../../lib/postprocessMedia'
import { resolveCollectionPath } from '../../../lib/postprocessProjectTree'

/** 导出用的一列：`key` 是字段协议，`header` 只给人看。 */
export interface ConsoleSheetColumn {
  key: string
  header: string
}

export interface ConsoleSheet {
  /** Sheet 名：稳定英文 id，**不随界面语言变**（导入按它找表）。 */
  name: string
  columns: ConsoleSheetColumn[]
  rows: Array<Record<string, unknown>>
}

/**
 * Sheet 名清单。导入侧要按它逐表判定「这个包带来了哪些数据面」，
 * 所以顺序与集合都写在这里，别在导出/导入两头各写一遍。
 */
export const CONSOLE_SHEET_NAMES = [
  'directions',
  'node_params',
  'channels',
  'channel_sizes',
  'output_dirs_global',
  'output_dirs_node',
  'watermark_binding',
  'presets',
  'preset_layers',
  'distribution',
  'naming',
] as const

export type ConsoleSheetName = (typeof CONSOLE_SHEET_NAMES)[number]

export interface ConsoleExportInput {
  /**
   * 全局基线配置（由调用方用 `usePostprocessGlobalConfig()` 组装）。
   * 传整份而不是散字段：少拼一个字段就会出现「导出里少了某个渠道」这类难查的偏差，
   * 而这个 hook 的存在意义就是收口这件事。
   */
  globalConfig: PostprocessMediaConfig
  collections: AssetCollection[]
  params: ProjectNodeParamsMap
  presets: CompositeV2Preset[]
  identifier?: CompositeV2IdentifierConfig
}

const LEVEL_LABELS: Record<string, string> = {
  line: '产品线',
  product: '产品',
  direction: '方向',
  extra: '扩展层',
}

const DIRECTION_LABELS: Record<string, string> = {
  landscape: '横版',
  portrait: '竖版',
  square: '方形',
}

/** 数组值统一用「半角逗号 + 空格」连接 —— 与 `parseTagList`（认全角逗号）往返一致。 */
function joinList(value: string[] | undefined): string {
  return value && value.length > 0 ? value.join(', ') : ''
}

/** 深度：用现成的路径解析算，避免再造一个「父链遍历」。 */
function depthOf(collections: AssetCollection[], id: string): number {
  return Math.max(0, resolveCollectionPath(collections, id).length - 1)
}

function pathOf(collections: AssetCollection[], id: string): string {
  return resolveCollectionPath(collections, id)
    .map((item) => item.name)
    .join(' / ')
}

/**
 * 把中控台的全部数据面摊成 11 张 Sheet（纯函数，无副作用、不依赖 xlsx）。
 *
 * 不含 `output_manifest`（产出清单）：它是运行时的派生结果、每次生成都变，
 * 导出一份静态快照只会让人拿它去对账而对不上（见方案 §10.9）。
 */
export function buildConsoleSheets(input: ConsoleExportInput): ConsoleSheet[] {
  const { collections, globalConfig, identifier, params, presets } = input
  const presetNames = Object.fromEntries(presets.map((preset) => [preset.id, preset.name]))

  // ---- ① directions：方向结构 ----
  const directions: ConsoleSheet = {
    name: 'directions',
    columns: [
      { key: 'id', header: '方向ID' },
      { key: 'name', header: '名称' },
      { key: 'parentId', header: '上级ID' },
      { key: 'level', header: '层级' },
      { key: 'path', header: '层级路径' },
      { key: 'order', header: '同级排序' },
      { key: 'color', header: '颜色' },
      { key: 'pinned', header: '置顶' },
    ],
    rows: collections.map((item) => ({
      id: item.id,
      name: item.name,
      parentId: item.parentId ?? '',
      level: LEVEL_LABELS[resolveProjectNodeKind(depthOf(collections, item.id))] ?? '扩展层',
      path: pathOf(collections, item.id),
      order: item.order,
      color: item.color ?? '',
      pinned: item.pinned === true,
    })),
  }

  // ---- ② node_params：方向级参数（生效值 + 来源） ----
  //
  // ⚠️ 导的是**生效值**（含从上级继承来的），`sourcedFrom` 说明它来自谁。于是「导出 → 导入」
  // 会把继承摊平成每个节点自己的值 —— 这是本表既有的口径（`outputDir` / 水印清单同理），
  // 改口径要先想清楚「导入后改全局基线不再影响这些节点」是否可接受。
  const nodeParams: ConsoleSheet = {
    name: 'node_params',
    columns: [
      { key: 'collectionId', header: '方向ID' },
      { key: 'path', header: '层级路径' },
      { key: 'enabled', header: '自动后处理' },
      // ADR-0013：这个方向投哪几个渠道（逗号分隔的渠道 id；空 = 一个渠道都不投）
      { key: 'selectedMediaIds', header: '参与渠道' },
      { key: 'outputDir', header: '输出目录' },
      { key: 'watermarkPresetIds', header: '水印清单' },
      { key: 'sourcedFrom', header: '设置来源' },
    ],
    rows: collections.map((item) => {
      const slice = resolveProjectPostprocessSlice(collections, params, item.id, globalConfig)
      const binding = resolveNodeWatermarkBinding(collections, params, item.id, globalConfig.watermarkPresetIds)
      return {
        collectionId: item.id,
        path: pathOf(collections, item.id),
        enabled: slice.enabled,
        selectedMediaIds: joinList(slice.config.selectedMediaIds),
        outputDir: slice.config.outputDir,
        watermarkPresetIds: joinList(binding.presetIds),
        sourcedFrom:
          slice.sourcedFrom === null ? '全局' : slice.sourcedFrom === item.id ? '本级' : `继承（${slice.sourcedFrom}）`,
      }
    }),
  }

  // ---- ③ channels：渠道表（纯净版不是渠道，单独一行也不放，它的语义不同） ----
  const channelMedia = globalConfig.media.filter((item) => item.id !== PURE_MEDIA_ID)
  const channels: ConsoleSheet = {
    name: 'channels',
    columns: [
      { key: 'id', header: '渠道ID' },
      { key: 'name', header: '渠道名' },
      { key: 'applied', header: '参与产出' },
      { key: 'appliedIndex', header: '产出顺序' },
      { key: 'sizeCount', header: '尺寸数' },
      { key: 'enabledSizeCount', header: '可用尺寸数' },
    ],
    rows: channelMedia.map((item) => {
      const index = globalConfig.selectedMediaIds.indexOf(item.id)
      return {
        id: item.id,
        name: item.name,
        applied: index >= 0,
        // 产出顺序就是 selectedMediaIds 的数组顺序；空 = 不参与
        appliedIndex: index >= 0 ? index : '',
        sizeCount: item.sizes.length,
        enabledSizeCount: item.sizes.filter((size) => size.enabled).length,
      }
    }),
  }

  // ---- ④ channel_sizes：尺寸表（外键 mediaId） ----
  const channelSizes: ConsoleSheet = {
    name: 'channel_sizes',
    columns: [
      { key: 'sizeId', header: '尺寸ID' },
      { key: 'mediaId', header: '渠道ID' },
      { key: 'width', header: '宽' },
      { key: 'height', header: '高' },
      { key: 'maxSizeKb', header: '体积上限KB' },
      { key: 'enabled', header: '启用' },
      { key: 'direction', header: '画面方向' },
    ],
    rows: channelMedia.flatMap((item) =>
      item.sizes.map((size) => ({
        // ⚠️ sizeId 由 mediaId + 宽高派生。导入侧改了宽高就必须按「删旧 + 增新」处理，
        // 否则指向旧 id 的引用会静默失联（方案 §4.3.1）。这里把它导出来，导入才好对账。
        sizeId: size.id,
        mediaId: item.id,
        width: size.width,
        height: size.height,
        maxSizeKb: size.maxSizeKb,
        enabled: size.enabled,
        direction: DIRECTION_LABELS[resolveOutputDirection(size.width, size.height)] ?? '',
      })),
    ),
  }

  // ---- ⑤ output_dirs_global：全局输出位置（列全部渠道，空 = 用默认位置） ----
  const outputDirsGlobal: ConsoleSheet = {
    name: 'output_dirs_global',
    columns: [
      { key: 'mediaId', header: '渠道ID' },
      { key: 'channelName', header: '渠道名' },
      { key: 'outputDir1', header: '导出位置1' },
      { key: 'outputDir2', header: '导出位置2' },
      { key: 'defaultOutputDir', header: '默认输出位置' },
    ],
    rows: channelMedia.map((item) => {
      const dirs = globalConfig.mediaOutputDirs[item.id] ?? []
      return {
        mediaId: item.id,
        channelName: item.name,
        outputDir1: dirs[0] ?? '',
        outputDir2: dirs[1] ?? '',
        defaultOutputDir: globalConfig.outputDir,
      }
    }),
  }

  // ---- ⑥ output_dirs_node：方向 × 渠道 覆盖 ----
  const outputDirsNode: ConsoleSheet = {
    name: 'output_dirs_node',
    columns: [
      { key: 'collectionId', header: '方向ID' },
      { key: 'mediaId', header: '渠道ID' },
      { key: 'outputDir1', header: '覆盖位置1' },
      { key: 'outputDir2', header: '覆盖位置2' },
    ],
    rows: Object.entries(params).flatMap(([collectionId, entry]) => {
      const byMedia = entry?.postprocess?.byMedia
      if (!byMedia) return []
      return Object.entries(byMedia)
        .filter(([, value]) => value !== undefined)
        .map(([mediaId, value]) => {
          // 兼容旧的单值 `outputDir`：读取时两者都认（UI 侧写新值时同时摘掉旧值）
          const dirs = value?.outputDirs !== undefined ? value.outputDirs : value?.outputDir ? [value.outputDir] : []
          return {
            collectionId,
            mediaId,
            outputDir1: dirs[0] ?? '',
            outputDir2: dirs[1] ?? '',
          }
        })
    }),
  }

  // ---- ⑦ watermark_binding：归属（含全局哨兵行） ----
  const watermarkBinding: ConsoleSheet = {
    name: 'watermark_binding',
    columns: [
      { key: 'collectionId', header: '方向ID' },
      { key: 'directionPath', header: '方向' },
      { key: 'presetId', header: '预设ID' },
      { key: 'presetName', header: '预设名' },
      { key: 'scope', header: '来源' },
      { key: 'order', header: '叠加顺序' },
    ],
    rows: [
      // 全局清单用哨兵行：它与「某个方向显式声明」是两种语义，
      // 混在同一组行里会让导入侧无从判断「这一行要不要写进节点」
      ...globalConfig.watermarkPresetIds.map((presetId, index) => ({
        collectionId: GLOBAL_NODE_ID,
        directionPath: '（全局默认）',
        presetId,
        presetName: presetNames[presetId] ?? presetId,
        scope: '全局',
        order: index,
      })),
      ...Object.entries(params).flatMap(([collectionId, entry]) => {
        const declared = entry?.postprocess?.watermarkPresetIds
        if (!declared || declared.length === 0) return []
        return declared.map((presetId, index) => ({
          collectionId,
          directionPath: pathOf(collections, collectionId) || collectionId,
          presetId,
          presetName: presetNames[presetId] ?? presetId,
          scope: '本级',
          order: index,
        }))
      }),
    ],
  }

  // ---- ⑧ presets：预设元数据 ----
  const presetsSheet: ConsoleSheet = {
    name: 'presets',
    columns: [
      { key: 'id', header: '预设ID' },
      { key: 'name', header: '预设名' },
      { key: 'canvasWidth', header: '画布宽' },
      { key: 'canvasHeight', header: '画布高' },
      { key: 'layerCount', header: '图层数' },
      { key: 'sampleBackgroundPath', header: '示例底图' },
      { key: 'updatedAt', header: '更新时间' },
    ],
    rows: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      canvasWidth: preset.baseCanvas.width,
      canvasHeight: preset.baseCanvas.height,
      layerCount: preset.layers.length,
      sampleBackgroundPath: preset.sampleBackgroundPath,
      updatedAt: preset.updatedAt,
    })),
  }

  // ---- ⑨ preset_layers：图层（position 按模式展平） ----
  const presetLayers: ConsoleSheet = {
    name: 'preset_layers',
    columns: [
      { key: 'presetId', header: '预设ID' },
      { key: 'layerId', header: '图层ID' },
      { key: 'type', header: '类型' },
      { key: 'name', header: '图层名' },
      { key: 'visible', header: '可见' },
      { key: 'locked', header: '锁定' },
      { key: 'opacity', header: '不透明度' },
      { key: 'rotation', header: '旋转' },
      { key: 'positionMode', header: '定位模式' },
      { key: 'anchor', header: '锚点' },
      { key: 'x', header: 'X' },
      { key: 'y', header: 'Y' },
      { key: 'width', header: '宽' },
      { key: 'height', header: '高' },
      { key: 'text', header: '文本' },
      { key: 'fontSize', header: '字号' },
      { key: 'color', header: '颜色' },
    ],
    rows: presets.flatMap((preset) =>
      preset.layers.map((layer) => {
        const position = layer.position
        const isAnchor = position.mode === 'anchor'
        return {
          presetId: preset.id,
          layerId: layer.id,
          type: layer.type,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          opacity: layer.opacity,
          rotation: layer.rotation,
          positionMode: position.mode,
          anchor: isAnchor ? position.anchor : '',
          x: isAnchor ? position.offsetX : position.x,
          y: isAnchor ? position.offsetY : position.y,
          width: position.width,
          height: position.height,
          text: layer.type === 'text' ? layer.text : '',
          fontSize: layer.type === 'text' ? layer.fontSize : '',
          color: layer.type === 'text' ? layer.color : '',
        }
      }),
    ),
  }

  // ---- ⑩ distribution / ⑪ naming：键值表 ----
  // 这两张是**单例配置**，不是数据集。为什么 UI 上不做成表格、却仍导出成表，
  // 见方案 §10.7：导出的目的是「可读可改可回填」，与界面用哪种控件无关。
  const distributionSheet: ConsoleSheet = {
    name: 'distribution',
    columns: [
      { key: 'key', header: '字段' },
      { key: 'label', header: '含义' },
      { key: 'value', header: '值' },
    ],
    rows: buildDistributionRows(globalConfig.distribution),
  }

  const namingSheet: ConsoleSheet = {
    name: 'naming',
    columns: [
      { key: 'key', header: '字段' },
      { key: 'label', header: '含义' },
      { key: 'value', header: '值' },
    ],
    rows: [
      { key: 'namePattern', label: '命名模板', value: globalConfig.namePattern },
      { key: 'creator', label: '创作者', value: globalConfig.creator },
      { key: 'identifierText', label: '署名文本', value: identifier?.text ?? '' },
      { key: 'identifierPlacement', label: '署名位置', value: identifier?.placement ?? 'suffix' },
      { key: 'autoCompanionClean', label: '纯净版自动伴随', value: globalConfig.autoCompanionClean },
    ],
  }

  return [
    directions,
    nodeParams,
    channels,
    channelSizes,
    outputDirsGlobal,
    outputDirsNode,
    watermarkBinding,
    presetsSheet,
    presetLayers,
    distributionSheet,
    namingSheet,
  ]
}

function buildDistributionRows(config: PostprocessDistributionConfig): Array<Record<string, unknown>> {
  return [
    { key: 'enabled', label: '启用分发', value: config.enabled },
    { key: 'startDate', label: '起始日期', value: config.startDate },
    { key: 'days', label: '分配天数', value: config.days },
    { key: 'mode', label: '搬运方式', value: config.mode },
    { key: 'randomize', label: '打乱后分配', value: config.randomize },
    { key: 'skipWeekends', label: '跳过周末', value: config.skipWeekends },
    { key: 'renameMode', label: '重命名方式', value: config.renameMode },
    { key: 'modifyMd5', label: '改写 MD5', value: config.modifyMd5 },
    { key: 'targetDir', label: '目标根目录', value: config.targetDir },
  ]
}

/**
 * 把二维表写成 xlsx 二进制。
 *
 * `xlsx` 动态导入有两个原因：纯函数层不该背这个依赖；它体积不小，
 * 只在中控台真的点「导出」时才加载。
 */
export async function writeConsoleWorkbook(sheets: ConsoleSheet[]): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const aoa: unknown[][] = [
      sheet.columns.map((column) => column.key),
      sheet.columns.map((column) => column.header),
      ...sheet.rows.map((row) => sheet.columns.map((column) => normalizeCell(row[column.key]))),
    ]
    const worksheet = XLSX.utils.aoa_to_sheet(aoa)
    // 列宽按表头长度粗算：不设的话打开就是一片 ####，用户第一眼就以为导出坏了
    worksheet['!cols'] = sheet.columns.map((column) => ({
      wch: Math.max(10, Math.min(36, Math.max(column.header.length, column.key.length) * 2 + 4)),
    }))
    // Sheet 名不能超 31 字符也不能含 []:*?/\ —— 这里的名字都是自造的短英文 id，天然合规
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** 单元格归一：`undefined`/`null` → 空串；其余原样交给 xlsx（数字与布尔会写成对应类型）。 */
function normalizeCell(value: unknown): string | number | boolean {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

/** 导出结果。调用方要把「用户取消」与「写失败」分开说 —— 都吞成一个 toast 会让失败无声无息。 */
export type ConsoleExportOutcome = 'saved' | 'canceled' | 'failed' | 'unsupported'

/** 默认文件名：带日期，免得同一个目录里堆出一串同名文件。 */
export function defaultConsoleWorkbookName(now = new Date()): string {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `糖包-中控台数据-${stamp}.xlsx`
}

/**
 * 导出中控台工作簿到用户选定的文件。
 *
 * 复用两个既有的**通用**通道，不新开 IPC：
 * - `selectSavePath`（保存对话框，自带 filters）；
 * - `saveZipBuffer`（写任意二进制字节，名字里的 zip 是历史命名，对内容透明）。
 *
 * 主进程侧已在选中路径时授权该目录（`addAllowedRoot`），所以用户选到 `D:\…` 这类
 * 业务盘也能写成功 —— 与 R-62 那次「路径明明打得开却导出失败」是同一个坑。
 *
 * ⚠️ 本函数只在 Electron 里有意义；浏览器环境返回 `unsupported`，由调用方给出提示。
 */
export async function exportConsoleWorkbook(
  input: ConsoleExportInput,
  defaultName = defaultConsoleWorkbookName(),
): Promise<ConsoleExportOutcome> {
  if (typeof window === 'undefined') return 'unsupported'
  const api = window.electronAPI
  if (!api?.selectSavePath || !api?.saveZipBuffer) return 'unsupported'

  const filePath = await api.selectSavePath(defaultName, [{ name: 'Excel 工作簿', extensions: ['xlsx'] }])
  if (!filePath) return 'canceled'

  const buffer = await writeConsoleWorkbook(buildConsoleSheets(input))
  const saved = await api.saveZipBuffer(filePath, buffer)
  return saved ? 'saved' : 'failed'
}
