/**
 * 中控台数据的 Excel 导入（TB-060）。分三层，与导出对称：
 *
 * ```
 * parseConsoleWorkbook  xlsx 二进制 → 按字段键索引的原始行
 * planConsoleImport     原始行 × 当前状态 → ImportPlan（新增/更新/跳过/拒绝，各带行号）
 * applyConsoleImport    按 plan 调 store action 写库（store 由调用方注入）
 * ```
 *
 * 中间那层是**纯函数**，六条一致性校验全落在它里面 —— 那是唯一能逐条断言的地方。
 *
 * ## 四条口径
 *
 * 1. **按字段键匹配**（首行），不认中文表头。列的顺序无关，缺列 = 该字段不动。
 * 2. **报错带 Excel 行号**（表头占 1、2 行，数据从第 3 行起）。用户拿着「第 7 行」能直接在
 *    Excel 里定位；说「有 1 行不合法」等于没说。
 * 3. **拒绝 ≠ 中断**：一行不合法就拒那一行并记原因，其余照常导入（方案 §4.3）。
 *    但整表级的问题（外键全悬空之类）会让该表整体不出现在 payload 里。
 * 4. **`sizeId` 由「渠道 + 宽高」派生**，所以尺寸表的宽高/渠道一改就是换了主键。
 *    这里**不拒绝**这种行（那是正常的编辑意图），而是把它转成「删旧 + 增新」并记进
 *    `sizeKeyChanges`，由 dry-run 事先告知影响面。
 */

import { buildPostprocessMediaSizeId } from '../../../storePostprocessMedia'
import {
  DEFAULT_POSTPROCESS_FIT_MODE,
  FIT_MODE_OPTIONS,
  PURE_MEDIA_ID,
  normalizeOutputDirList,
  type PostprocessMedia,
} from '../../../lib/postprocessMedia'
import type { PostprocessDistributionConfig } from '../../../lib/postprocessDistribution'
import type { ProjectNodeParamsMap } from '../../projectTree/types'
import type { AssetCollection } from '../../../types'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import type { PostprocessNodeOverride } from '../../../lib/postprocessMedia'
import type { CompositeV2FitMode, CompositeV2IdentifierConfig } from './compositeV2Types'
import { CONSOLE_SHEET_NAMES, type ConsoleSheetName } from './consoleWorkbook'

/** 导入模式：合并按主键新增/更新；覆盖先清空所选表再写。 */
export type ImportMode = 'merge' | 'replace'

export interface ImportIssue {
  sheet: string
  /** Excel 里的行号（从 3 起，因为前两行是表头） */
  line: number
  reason: string
}

export interface SheetSummary {
  sheet: ConsoleSheetName
  label: string
  create: number
  update: number
  skip: number
  reject: number
}

export interface RawRow {
  line: number
  /** 列号 → 单元格文本。空单元格可能是 `undefined` 也可能是 `null`（xlsx 两种都会给）。 */
  values: Record<string, string | null>
}

export interface RawTable {
  name: ConsoleSheetName
  /** 字段键 → 列号；只收协议里认识的键 */
  columns: Map<string, number>
  unknownColumns: string[]
  rows: RawRow[]
}

/** 计划里要落库的内容，按表分组。`undefined` = 这个包没带这张表（那就什么都不做）。 */
export interface ConsoleImportPayload {
  /**
   * 渠道表。`legacyDisabled` = 包里的旧「启用」列写着 false。
   *
   * 该列已从导出里删除（ADR-0013：它与「参与产出」等价），但**老包还得认** ——
   * 认出来之后按「不参与产出」处理（`planImport` 里不再把它放进 `applied`），
   * 并计一条提示，别让用户以为导入漏了什么。
   */
  channels?: Array<{
    id: string
    name: string
    legacyDisabled: boolean
    applied: boolean
    appliedIndex: number | null
  }>
  channelSizes?: Array<{
    mediaId: string
    /** 派生出来的主键（= 渠道 + 宽高） */
    sizeId: string
    /** Excel 里声明的旧主键；与 `sizeId` 不同 = 用户改了宽高或渠道（要按「改」处理） */
    sourceSizeId: string
    width: number
    height: number
    maxSizeKb: number
    enabled: boolean
  }>
  outputDirsGlobal?: Array<{ mediaId: string; dirs: string[] }>
  outputDirsNode?: Array<{ collectionId: string; mediaId: string; dirs: string[] }>
  directions?: Array<{ id: string; name: string; parentId: string | null; order: number }>
  nodeParams?: Array<{ collectionId: string; enabled?: boolean; selectedMediaIds?: string[]; outputDir?: string }>
  watermarkBinding?: Array<{ collectionId: string; presetIds: string[] }>
  distribution?: PostprocessDistributionConfig
  naming?: {
    namePattern?: string
    creator?: string
    identifierText?: string
    identifierPlacement?: 'prefix' | 'suffix' | 'both'
    autoCompanionClean?: boolean
    /** 画面适配模式；表里填英文枚举或导出的中文标签都认 */
    fitMode?: CompositeV2FitMode
  }
}

export interface ImportPlan {
  mode: ImportMode
  summaries: SheetSummary[]
  rejected: ImportIssue[]
  unknownColumns: Array<{ sheet: string; columns: string[] }>
  /** 导入会写进去的目录类值（去重）。**不假装能验证它们在本机存在**，只让人核对。 */
  directoryValues: string[]
  /** `sizeId` 会变的主键（渠道 + 宽高改动导致），dry-run 必须预告 */
  sizeKeyChanges: Array<{ from: string; to: string }>
  payload: ConsoleImportPayload
}

/** 计划所需的当前状态。传快照而不是 store，纯函数才好测。 */
export interface ConsoleImportContext {
  collections: AssetCollection[]
  media: PostprocessMedia[]
  params: ProjectNodeParamsMap
  mediaOutputDirs: Record<string, string[]>
  presetIds: string[]
}

const SHEET_LABELS: Record<ConsoleSheetName, string> = {
  directions: '方向结构',
  node_params: '方向级参数',
  channels: '渠道',
  channel_sizes: '尺寸',
  output_dirs_global: '全局输出位置',
  output_dirs_node: '方向 × 渠道覆盖',
  watermark_binding: '水印归属',
  presets: '水印预设',
  preset_layers: '水印图层',
  distribution: '分发',
  naming: '命名与署名',
}

/**
 * 本轮**不导入**的两张表。
 *
 * 水印预设的图层是嵌套结构（位置有 anchor / free 两套形状、图源有 5 种 kind，
 * 其中 `dataUrl` 与 `path` 跨机必然失效），Excel 的平面表格表达不了这种保真度。
 * 预设本来就有自己的专用通道（`compositePresetTransfer.ts` 走 JSON，可整体往返），
 * 所以这里导出但不导入 —— **宁可明确不支持，也不要导进来一套残掉的图层**。
 */
const NOT_IMPORTABLE: ReadonlySet<ConsoleSheetName> = new Set(['presets', 'preset_layers'])

// ---------------------------------------------------------------- 取值与归一

function valueOf(row: RawRow, table: RawTable, key: string): string {
  const index = table.columns.get(key)
  if (index === undefined) return ''
  const raw = row.values[String(index)]
  // 空单元格可能是 undefined 也可能是 null（xlsx 两种都给），都当空串 —— 不处理 null
  // 会让一个空单元格把整次导入打断在 `raw.trim()` 上
  return raw === undefined || raw === null ? '' : String(raw).trim()
}

function hasColumn(table: RawTable, key: string): boolean {
  return table.columns.has(key)
}

/** 布尔容错：用户在 Excel 里会写成各种样子。空串返回 `undefined`（= 不表态）。 */
export function parseImportBool(text: string): boolean | undefined {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return undefined
  if (['true', '1', '是', 'yes', 'y', '开', '启用'].includes(normalized)) return true
  if (['false', '0', '否', 'no', 'n', '关', '停用'].includes(normalized)) return false
  return undefined
}

/** 数字容错：去掉千分位与全角空格；非法返回 `undefined`。 */
export function parseImportNumber(text: string): number | undefined {
  const normalized = text.replace(/[,，]/g, '').replace(/\s/g, '')
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 列表容错：与 `parseTagList` 同源（全角逗号也认）。 */
export function parseImportList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------- 解析

/**
 * 解析工作簿。只认 `CONSOLE_SHEET_NAMES` 里的表名 —— 别的 Sheet 直接跳过，
 * 用户拿一份别的工作簿进来不会炸，只是「什么都没识别到」。
 */
export async function parseConsoleWorkbook(buffer: ArrayBuffer): Promise<Map<ConsoleSheetName, RawTable>> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array' })
  const tables = new Map<ConsoleSheetName, RawTable>()

  for (const name of workbook.SheetNames) {
    if (!(CONSOLE_SHEET_NAMES as readonly string[]).includes(name)) continue
    const sheetName = name as ConsoleSheetName
    const worksheet = workbook.Sheets[name]
    if (!worksheet) continue

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false, defval: '' })
    const headerRow = aoa[0] ?? []
    const columns = new Map<string, number>()
    const unknownColumns: string[] = []
    headerRow.forEach((cell, index) => {
      const key =
        typeof cell === 'string' ? cell.trim() : cell === undefined || cell === null ? '' : String(cell).trim()
      if (!key) return
      // 首行是字段键。认不出的键记下来（**不静默丢弃** —— 静默失效是本仓的已知病灶）
      if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) columns.set(key, index)
      else unknownColumns.push(key)
    })

    const rows: RawRow[] = []
    // 第 1 行字段键、第 2 行中文名 → 数据从第 3 行起（行号直接对应 Excel，报错才定位得到）
    for (let index = 2; index < aoa.length; index += 1) {
      const line = aoa[index] ?? []
      const isEmpty = line.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')
      if (isEmpty) continue
      const values: Record<string, string> = {}
      line.forEach((cell, columnIndex) => {
        values[String(columnIndex)] = cell === undefined || cell === null ? '' : String(cell)
      })
      rows.push({ line: index + 1, values })
    }

    tables.set(sheetName, { name: sheetName, columns, unknownColumns, rows })
  }

  return tables
}

// ---------------------------------------------------------------- 计划

interface PlanAccumulator {
  mode: ImportMode
  rejected: ImportIssue[]
  summaries: SheetSummary[]
  directoryValues: Set<string>
  sizeKeyChanges: Array<{ from: string; to: string }>
  payload: ConsoleImportPayload
}

function reject(acc: PlanAccumulator, sheet: ConsoleSheetName, line: number, reason: string): void {
  acc.rejected.push({ sheet: SHEET_LABELS[sheet], line, reason })
}

function summarize(acc: PlanAccumulator, sheet: ConsoleSheetName, counts: Omit<SheetSummary, 'sheet' | 'label'>): void {
  acc.summaries.push({ sheet, label: SHEET_LABELS[sheet], ...counts })
}

/**
 * 把解析出来的表与当前状态比对，产出可执行的计划（**纯函数**）。
 *
 * 六条一致性校验的落点：
 * 1. `sizeId` 派生 → 尺寸表；
 * 2. 主键自洽 → 同上（其余表的主键没有可校验的第二锚点，改了即视为新记录，见 §10.9 注）；
 * 3. 写入只走 store action → 这里不写库，由 `applyConsoleImport` 负责；
 * 4. 外键悬空 → 尺寸 / 归属 / 节点参数 / 方向覆盖各表；
 * 5. 跨机失效路径 → `directoryValues` 汇总出来给人核对；
 * 6. 三模式 + dry-run → `mode` + 本计划的统计。
 */
export function planConsoleImport(
  tables: Map<ConsoleSheetName, RawTable>,
  context: ConsoleImportContext,
  mode: ImportMode = 'merge',
): ImportPlan {
  const acc: PlanAccumulator = {
    mode,
    rejected: [],
    summaries: [],
    directoryValues: new Set(),
    sizeKeyChanges: [],
    payload: {},
  }

  const mediaById = new Map(context.media.map((item) => [item.id, item]))
  const collectionIds = new Set(context.collections.map((item) => item.id))
  const presetIds = new Set(context.presetIds)

  // ---- channels ----
  const channelsTable = tables.get('channels')
  if (channelsTable) {
    const rows: NonNullable<ConsoleImportPayload['channels']> = []
    let create = 0
    let update = 0
    let skip = 0
    for (const row of channelsTable.rows) {
      const id = valueOf(row, channelsTable, 'id')
      const name = valueOf(row, channelsTable, 'name')
      if (!id || !name) {
        reject(acc, 'channels', row.line, !id ? '缺少渠道ID' : '缺少渠道名')
        continue
      }
      if (id === PURE_MEDIA_ID) {
        // 纯净版是保留渠道，它的名字与尺寸都由程序管；允许改「参与产出」，不许改名
        skip += 1
        continue
      }
      const existing = mediaById.get(id)
      /**
       * 旧包里的「启用」列（新版导出已不含它，ADR-0013）。
       *
       * `false` 当时的含义是「这个渠道不产出」，与「不参与产出」等价 —— 所以折过去，
       * 而不是当作没看见：忽略它等于把用户停用过的渠道**重新放回产出**（行为反转）。
       * 报告末尾会汇总说一句（见 `formatImportPlan`），免得用户以为导入没生效。
       */
      const legacyDisabled = hasColumn(channelsTable, 'enabled')
        ? (parseImportBool(valueOf(row, channelsTable, 'enabled')) ?? true) === false
        : false
      const declaredApplied = parseImportBool(valueOf(row, channelsTable, 'applied')) ?? false
      const applied = declaredApplied && !legacyDisabled
      const appliedIndex = hasColumn(channelsTable, 'appliedIndex')
        ? (parseImportNumber(valueOf(row, channelsTable, 'appliedIndex')) ?? null)
        : null
      rows.push({ id, name, legacyDisabled, applied, appliedIndex })
      if (existing) {
        // 「是否参与产出」不进这个计数：它由整份列表决定（见下面的应用段），逐行比对只会误报
        if (existing.name !== name) update += 1
        else skip += 1
      } else create += 1
    }
    acc.payload.channels = rows
    summarize(acc, 'channels', { create, update, skip, reject: countRejected(acc, 'channels') })
  }

  // ---- channel_sizes ----
  const sizesTable = tables.get('channel_sizes')
  if (sizesTable) {
    const rows: NonNullable<ConsoleImportPayload['channelSizes']> = []
    let create = 0
    let update = 0
    let skip = 0
    for (const row of sizesTable.rows) {
      const mediaId = valueOf(row, sizesTable, 'mediaId')
      const width = parseImportNumber(valueOf(row, sizesTable, 'width'))
      const height = parseImportNumber(valueOf(row, sizesTable, 'height'))
      if (!mediaId) {
        reject(acc, 'channel_sizes', row.line, '缺少渠道ID')
        continue
      }
      // 外键：渠道可以来自这个包（同批导入的 channels 表），也可以来自库里
      const known = mediaById.has(mediaId) || acc.payload.channels?.some((item) => item.id === mediaId)
      if (!known) {
        reject(acc, 'channel_sizes', row.line, `渠道 ${mediaId} 既不在库里也不在这个包里`)
        continue
      }
      if (width === undefined || height === undefined || width <= 0 || height <= 0) {
        reject(acc, 'channel_sizes', row.line, '宽高必须是正整数')
        continue
      }
      const maxSizeKb = parseImportNumber(valueOf(row, sizesTable, 'maxSizeKb')) ?? 0
      if (maxSizeKb < 0) {
        reject(acc, 'channel_sizes', row.line, '体积上限不能为负')
        continue
      }
      const enabled = parseImportBool(valueOf(row, sizesTable, 'enabled')) ?? true
      // ⭐ 主键自洽：sizeId 必须等于 mediaId + 宽高派生值。不等 = 用户改了宽高或渠道，
      //    那是「换了一个规格主键」，记进 sizeKeyChanges 让 dry-run 预告影响面。
      const declaredId = valueOf(row, sizesTable, 'sizeId')
      const derivedId = buildPostprocessMediaSizeId(mediaId, width, height)
      if (declaredId && declaredId !== derivedId) {
        acc.sizeKeyChanges.push({ from: declaredId, to: derivedId })
      }
      rows.push({ mediaId, sizeId: derivedId, sourceSizeId: declaredId, width, height, maxSizeKb, enabled })
      const existing = mediaById.get(mediaId)?.sizes.find((size) => size.id === derivedId)
      if (existing) {
        if (existing.maxSizeKb !== maxSizeKb || existing.enabled !== enabled) update += 1
        else skip += 1
      } else create += 1
    }
    acc.payload.channelSizes = rows
    summarize(acc, 'channel_sizes', { create, update, skip, reject: countRejected(acc, 'channel_sizes') })
  }

  // ---- output_dirs_global（豁免外键：允许指向已删除的渠道） ----
  const globalDirsTable = tables.get('output_dirs_global')
  if (globalDirsTable) {
    const rows: NonNullable<ConsoleImportPayload['outputDirsGlobal']> = []
    let create = 0
    let update = 0
    let skip = 0
    for (const row of globalDirsTable.rows) {
      const mediaId = valueOf(row, globalDirsTable, 'mediaId')
      if (!mediaId) {
        reject(acc, 'output_dirs_global', row.line, '缺少渠道ID')
        continue
      }
      const dirs = normalizeOutputDirList([
        valueOf(row, globalDirsTable, 'outputDir1'),
        valueOf(row, globalDirsTable, 'outputDir2'),
      ])
      // 位置 1 空、位置 2 有值是非法的（normalize 会把空槽丢掉，位置会串位）
      const first = valueOf(row, globalDirsTable, 'outputDir1')
      const second = valueOf(row, globalDirsTable, 'outputDir2')
      if (!first && second) {
        reject(acc, 'output_dirs_global', row.line, '填了「导出位置2」却没填「导出位置1」')
        continue
      }
      dirs.forEach((dir) => acc.directoryValues.add(dir))
      const current = normalizeOutputDirList(context.mediaOutputDirs[mediaId])
      rows.push({ mediaId, dirs })
      if (current.length === 0 && dirs.length === 0) skip += 1
      else if (sameList(current, dirs)) skip += 1
      else if (current.length === 0) create += 1
      else update += 1
    }
    acc.payload.outputDirsGlobal = rows
    summarize(acc, 'output_dirs_global', { create, update, skip, reject: countRejected(acc, 'output_dirs_global') })
  }

  // ---- output_dirs_node ----
  const nodeDirsTable = tables.get('output_dirs_node')
  if (nodeDirsTable) {
    const rows: NonNullable<ConsoleImportPayload['outputDirsNode']> = []
    let create = 0
    let update = 0
    let skip = 0
    for (const row of nodeDirsTable.rows) {
      const collectionId = valueOf(row, nodeDirsTable, 'collectionId')
      const mediaId = valueOf(row, nodeDirsTable, 'mediaId')
      if (!collectionId || !mediaId) {
        reject(acc, 'output_dirs_node', row.line, '缺少方向ID或渠道ID')
        continue
      }
      if (!collectionIds.has(collectionId) && !acc.payload.directions?.some((item) => item.id === collectionId)) {
        reject(acc, 'output_dirs_node', row.line, `方向 ${collectionId} 不在项目树里`)
        continue
      }
      const first = valueOf(row, nodeDirsTable, 'outputDir1')
      const second = valueOf(row, nodeDirsTable, 'outputDir2')
      if (!first && second) {
        reject(acc, 'output_dirs_node', row.line, '填了「覆盖位置2」却没填「覆盖位置1」')
        continue
      }
      const dirs = normalizeOutputDirList([first, second])
      dirs.forEach((dir) => acc.directoryValues.add(dir))
      const current = context.params[collectionId]?.postprocess?.byMedia?.[mediaId]
      const currentDirs = normalizeOutputDirList(current?.outputDirs ?? (current?.outputDir ? [current.outputDir] : []))
      rows.push({ collectionId, mediaId, dirs })
      if (sameList(currentDirs, dirs)) skip += 1
      else if (currentDirs.length === 0) create += 1
      else update += 1
    }
    acc.payload.outputDirsNode = rows
    summarize(acc, 'output_dirs_node', { create, update, skip, reject: countRejected(acc, 'output_dirs_node') })
  }

  // ---- directions ----
  const directionsTable = tables.get('directions')
  if (directionsTable) {
    const rows: NonNullable<ConsoleImportPayload['directions']> = []
    let create = 0
    let update = 0
    let skip = 0
    const seenIds = new Set<string>()
    for (const row of directionsTable.rows) {
      const id = valueOf(row, directionsTable, 'id')
      const name = valueOf(row, directionsTable, 'name')
      if (!id || !name) {
        reject(acc, 'directions', row.line, !id ? '缺少方向ID' : '缺少名称')
        continue
      }
      if (seenIds.has(id)) {
        reject(acc, 'directions', row.line, `方向ID ${id} 在这张表里重复出现`)
        continue
      }
      seenIds.add(id)
      const parentId = valueOf(row, directionsTable, 'parentId') || null
      // 上级必须存在（树里或这个包里）—— 否则会造出挂空的节点
      if (
        parentId &&
        !collectionIds.has(parentId) &&
        !directionsTable.rows.some((r) => valueOf(r, directionsTable, 'id') === parentId)
      ) {
        reject(acc, 'directions', row.line, `上级 ${parentId} 不存在`)
        continue
      }
      const order = parseImportNumber(valueOf(row, directionsTable, 'order')) ?? 0
      rows.push({ id, name, parentId, order })
      const existing = context.collections.find((item) => item.id === id)
      if (!existing) create += 1
      else if (existing.name !== name || (existing.parentId ?? null) !== parentId || existing.order !== order)
        update += 1
      else skip += 1
    }
    // 造环检测：把计划里的父子关系拼起来走一遍，能回到自己就是环
    const cyclic = findCycle(rows)
    if (cyclic) {
      acc.rejected.push({
        sheet: SHEET_LABELS.directions,
        line: 0,
        reason: `这棵树的父子关系成环（${cyclic}），整表未导入`,
      })
      summarize(acc, 'directions', { create: 0, update: 0, skip: 0, reject: rows.length })
    } else {
      acc.payload.directions = rows
      summarize(acc, 'directions', { create, update, skip, reject: countRejected(acc, 'directions') })
    }
  }

  // ---- node_params ----
  const nodeParamsTable = tables.get('node_params')
  if (nodeParamsTable) {
    const rows: NonNullable<ConsoleImportPayload['nodeParams']> = []
    let create = 0
    let update = 0
    let skip = 0
    for (const row of nodeParamsTable.rows) {
      const collectionId = valueOf(row, nodeParamsTable, 'collectionId')
      if (!collectionId) {
        reject(acc, 'node_params', row.line, '缺少方向ID')
        continue
      }
      if (!collectionIds.has(collectionId) && !acc.payload.directions?.some((item) => item.id === collectionId)) {
        reject(acc, 'node_params', row.line, `方向 ${collectionId} 不在项目树里`)
        continue
      }
      const enabled = parseImportBool(valueOf(row, nodeParamsTable, 'enabled'))
      const outputDir = valueOf(row, nodeParamsTable, 'outputDir')
      if (outputDir) acc.directoryValues.add(outputDir)
      /**
       * ADR-0013：这个方向投哪几个渠道。
       *
       * **列缺失（旧包）时留 `undefined`（= 不表态），不能折成空数组** —— 空数组是
       * 「这个方向一个渠道都不投」，那会把「导入一份旧包」变成「所有方向都不产出」。
       */
      const declaredSelected = hasColumn(nodeParamsTable, 'selectedMediaIds')
        ? parseImportList(valueOf(row, nodeParamsTable, 'selectedMediaIds'))
        : undefined
      rows.push({ collectionId, enabled, selectedMediaIds: declaredSelected, outputDir: outputDir || undefined })
      const current = context.params[collectionId]?.postprocess
      if (!current) create += 1
      else if (
        current.enabled !== enabled ||
        (current.outputDir ?? '') !== outputDir ||
        // 列缺失时不算改动（否则「导入旧包」会把每一行都报成更新）
        (declaredSelected !== undefined && !sameList(current.selectedMediaIds ?? [], declaredSelected))
      )
        update += 1
      else skip += 1
    }
    acc.payload.nodeParams = rows
    summarize(acc, 'node_params', { create, update, skip, reject: countRejected(acc, 'node_params') })
  }

  // ---- watermark_binding ----
  const bindingTable = tables.get('watermark_binding')
  if (bindingTable) {
    const byCollection = new Map<string, string[]>()
    let create = 0
    let update = 0
    let skip = 0
    for (const row of bindingTable.rows) {
      const collectionId = valueOf(row, bindingTable, 'collectionId')
      const presetId = valueOf(row, bindingTable, 'presetId')
      if (!collectionId || !presetId) {
        reject(acc, 'watermark_binding', row.line, '缺少方向ID或预设ID')
        continue
      }
      // 全局哨兵行不在本轮导入范围：全局清单在前端没有写入点（见方案 §一 缺口 2）
      if (collectionId === GLOBAL_NODE_ID) {
        skip += 1
        continue
      }
      if (!collectionIds.has(collectionId) && !acc.payload.directions?.some((item) => item.id === collectionId)) {
        reject(acc, 'watermark_binding', row.line, `方向 ${collectionId} 不在项目树里`)
        continue
      }
      // 外键：预设必须存在。悬空预设会让产出少一层水印却不报错，宁可拒绝
      if (!presetIds.has(presetId)) {
        reject(acc, 'watermark_binding', row.line, `预设 ${presetId} 不在水印库里`)
        continue
      }
      const list = byCollection.get(collectionId) ?? []
      if (!list.includes(presetId)) list.push(presetId)
      byCollection.set(collectionId, list)
    }
    const rows: NonNullable<ConsoleImportPayload['watermarkBinding']> = []
    for (const [collectionId, presetIdsOfNode] of byCollection) {
      rows.push({ collectionId, presetIds: presetIdsOfNode })
      const current = context.params[collectionId]?.postprocess?.watermarkPresetIds
      if (!current) create += 1
      else if (sameList(current, presetIdsOfNode)) skip += 1
      else update += 1
    }
    acc.payload.watermarkBinding = rows
    summarize(acc, 'watermark_binding', { create, update, skip, reject: countRejected(acc, 'watermark_binding') })
  }

  // ---- distribution ----
  const distributionTable = tables.get('distribution')
  if (distributionTable) {
    const read = (key: string) => {
      const row = distributionTable.rows.find((item) => valueOf(item, distributionTable, 'key') === key)
      return row ? valueOf(row, distributionTable, 'value') : ''
    }
    const distribution: PostprocessDistributionConfig = {
      enabled: parseImportBool(read('enabled')) ?? false,
      startDate: read('startDate'),
      days: parseImportNumber(read('days')) ?? 1,
      mode: read('mode') === 'move' ? 'move' : 'copy',
      randomize: parseImportBool(read('randomize')) ?? false,
      skipWeekends: parseImportBool(read('skipWeekends')) ?? false,
      renameMode: read('renameMode') === 'sequence' ? 'sequence' : 'date',
      modifyMd5: parseImportBool(read('modifyMd5')) ?? false,
      targetDir: read('targetDir'),
    }
    if (distribution.targetDir) acc.directoryValues.add(distribution.targetDir)
    if (distribution.enabled && !/^\d{8}$/.test(distribution.startDate)) {
      reject(acc, 'distribution', 0, '开了分发但起始日期不是 8 位日期（YYYYMMDD），分发不会被启用')
      distribution.enabled = false
    }
    acc.payload.distribution = distribution
    summarize(acc, 'distribution', { create: 0, update: 1, skip: 0, reject: countRejected(acc, 'distribution') })
  }

  // ---- naming ----
  const namingTable = tables.get('naming')
  if (namingTable) {
    const read = (key: string) => {
      const row = namingTable.rows.find((item) => valueOf(item, namingTable, 'key') === key)
      return row ? valueOf(row, namingTable, 'value') : ''
    }
    const placement = read('identifierPlacement')
    /**
     * 画面适配：**英文枚举与中文标签都认** —— 这张表就是给人手改的，
     * 中文标签（「模糊填充」）比 `contain-blur` 更可能被填进来。
     *
     * 填了不认识的值时**刻意报一条而不是静默回落**：静默回落成默认值会让用户
     * 以为改生效了，实际产出还是老样子。留空则视为「这轮不动这个字段」。
     */
    const fitModeRaw = read('fitMode').trim()
    const fitModeOption = FIT_MODE_OPTIONS.find((option) => option.value === fitModeRaw || option.label === fitModeRaw)
    if (fitModeRaw && !fitModeOption) {
      reject(acc, 'naming', 0, `画面适配「${fitModeRaw}」不认识，已按「裁剪填满」处理`)
    }
    acc.payload.naming = {
      namePattern: read('namePattern') || undefined,
      creator: read('creator') || undefined,
      identifierText: read('identifierText') || undefined,
      identifierPlacement:
        placement === 'prefix' || placement === 'suffix' || placement === 'both' ? placement : undefined,
      autoCompanionClean: parseImportBool(read('autoCompanionClean')),
      fitMode: fitModeOption?.value ?? (fitModeRaw ? DEFAULT_POSTPROCESS_FIT_MODE : undefined),
    }
    summarize(acc, 'naming', { create: 0, update: 1, skip: 0, reject: countRejected(acc, 'naming') })
  }

  // 导出里有、本轮不导入的表：明确列出来，别让人以为「导入成功了但预设没变」
  for (const name of NOT_IMPORTABLE) {
    if (tables.has(name)) {
      acc.summaries.push({ sheet: name, label: SHEET_LABELS[name], create: 0, update: 0, skip: 0, reject: 0 })
    }
  }

  const unknownColumns = [...tables.values()]
    .filter((table) => table.unknownColumns.length > 0)
    .map((table) => ({ sheet: SHEET_LABELS[table.name], columns: table.unknownColumns }))

  return {
    mode,
    summaries: acc.summaries,
    rejected: acc.rejected,
    unknownColumns,
    directoryValues: [...acc.directoryValues],
    sizeKeyChanges: acc.sizeKeyChanges,
    payload: acc.payload,
  }
}

function countRejected(acc: PlanAccumulator, sheet: ConsoleSheetName): number {
  return acc.rejected.filter((issue) => issue.sheet === SHEET_LABELS[sheet]).length
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/** 找父子关系里的环：沿着 parentId 往上走，超过节点总数还没到顶就是环。 */
function findCycle(rows: Array<{ id: string; parentId: string | null }>): string | null {
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const row of rows) {
    let cursor: string | null = row.parentId
    let steps = 0
    while (cursor && steps <= rows.length) {
      const parent: { id: string; parentId: string | null } | undefined = byId.get(cursor)
      if (!parent) break
      cursor = parent.parentId
      steps += 1
    }
    if (steps > rows.length) return row.id
  }
  return null
}

// ---------------------------------------------------------------- 执行

/**
 * 写库要用的 action 集合，**由调用方注入**。
 *
 * lib 层不认识 zustand store —— 这条边界不能破：一旦 lib 直接 import store，
 * 就再也没法用假 store 跑「导入中途失败要不要回滚」这类用例，而那恰恰是最该测的。
 */
export interface ConsoleImportActions {
  addMedia: (name: string, id?: string) => string | null
  renameMedia: (mediaId: string, name: string) => void
  addMediaSize: (mediaId: string, size: { width: number; height: number; maxSizeKb: number; enabled: boolean }) => void
  updateMediaSize: (
    mediaId: string,
    sizeId: string,
    patch: { width?: number; height?: number; maxSizeKb?: number; enabled?: boolean },
  ) => void
  deleteMediaSize: (mediaId: string, sizeId: string) => void
  setSelectedMediaIds: (ids: string[]) => void
  setMediaOutputDir: (mediaId: string, index: number, outputDir: string) => void
  clearMediaOutputDirs: (mediaId: string) => void
  setPostprocessOverride: (collectionId: string, patch: PostprocessNodeOverride) => void
  patchDistribution: (patch: Partial<PostprocessDistributionConfig>) => void
  setNamePattern: (pattern: string) => void
  setFitMode: (fitMode: CompositeV2FitMode) => void
  setCreator: (creator: string) => void
  setAutoCompanionClean: (enabled: boolean) => void
  setIdentifier: (patch: Partial<CompositeV2IdentifierConfig>) => void
  createCollection: (name: string, parentId?: string | null) => Promise<{ id: string } | null>
  renameCollection: (id: string, name: string) => Promise<void>
  moveCollection: (id: string, parentId: string | null) => Promise<void>
}

/**
 * 按计划写库。
 *
 * **执行顺序由依赖方向决定**，不能随意调换：方向 → 渠道 → 尺寸 → 输出位置 →
 * 节点参数 → 归属 → 分发 / 命名。方向必须最先（后三张表都按 `collectionId` 找宿主），
 * 渠道要在尺寸之前（尺寸的外键是渠道）。
 *
 * **回滚不在这里做**：由调用方在调用前抓快照、捕获异常后恢复。混在一起会让出错时
 * 难以判断「恢复到哪一步」。
 *
 * **`replace` 模式的边界**（刻意的，不是漏做）：只有**尺寸表**会被清空重写 ——
 * 它是「集合」语义，Excel 里没有的行就等于用户删了。渠道与方向是**实体**，
 * 在 Excel 里删一行就让整个方向连同参数消失太危险，删除请回 UI 操作。
 */
export async function applyConsoleImport(
  plan: ImportPlan,
  actions: ConsoleImportActions,
  context: ConsoleImportContext,
): Promise<{ written: number }> {
  const payload = plan.payload
  let written = 0

  /**
   * ⚠️ 方向 id 可能变：`createCollection` 自己生成 id、不接受指定。
   * 所以新建之后要有这张映射表，后面几张表的 `collectionId` 全部过一遍映射 ——
   * 否则「这次新建的方向」在节点参数 / 归属 / 渠道覆盖里会全部落空（静默丢数据）。
   */
  const collectionIdMap = new Map<string, string>()
  const resolveCollectionId = (id: string): string => collectionIdMap.get(id) ?? id

  // ---- ① 方向结构：父必须先建，逐轮推进 ----
  if (payload.directions && payload.directions.length > 0) {
    const pending = [...payload.directions]
    const known = new Set(context.collections.map((item) => item.id))
    let guard = pending.length + 1
    while (pending.length > 0 && guard > 0) {
      guard -= 1
      let progressed = false
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const row = pending[index]!
        if (row.parentId !== null && !known.has(row.parentId)) continue
        const existing = context.collections.find((item) => item.id === row.id)
        if (existing) {
          if (existing.name !== row.name) await actions.renameCollection(row.id, row.name)
          if ((existing.parentId ?? null) !== row.parentId) await actions.moveCollection(row.id, row.parentId)
        } else {
          const created = await actions.createCollection(
            row.name,
            row.parentId === null ? null : resolveCollectionId(row.parentId),
          )
          if (created?.id) collectionIdMap.set(row.id, created.id)
        }
        known.add(row.id)
        pending.splice(index, 1)
        progressed = true
        written += 1
      }
      // 一轮下来没有任何推进 = 剩下的父都不存在（plan 已拒过这类行），停手而不是死循环
      if (!progressed) break
    }
  }

  // ---- ② 渠道 ----
  const mediaById = new Map(context.media.map((item) => [item.id, item]))
  if (payload.channels) {
    const appliedIds: Array<{ id: string; index: number | null }> = []
    for (const row of payload.channels) {
      const existing = mediaById.get(row.id)
      if (existing) {
        if (existing.name !== row.name) actions.renameMedia(row.id, row.name)
      } else {
        actions.addMedia(row.name, row.id)
      }
      if (row.applied) appliedIds.push({ id: row.id, index: row.appliedIndex })
      written += 1
    }
    // 产出顺序：`appliedIndex` 有值就按它排，没值就保持表里的先后
    if (payload.channels.some((row) => row.applied)) {
      const ordered = appliedIds
        .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
        .map((item) => item.id)
      // 纯净版始终在列（它是保留项，不参与渠道表）
      const currentSelected = context.media.some((item) => item.id === PURE_MEDIA_ID)
      actions.setSelectedMediaIds(currentSelected ? [PURE_MEDIA_ID, ...ordered] : ordered)
    }
  }

  // ---- ③ 尺寸 ----
  if (payload.channelSizes) {
    if (plan.mode === 'replace') {
      const touched = new Set(payload.channelSizes.map((row) => row.mediaId))
      for (const mediaId of touched) {
        for (const size of mediaById.get(mediaId)?.sizes ?? []) actions.deleteMediaSize(mediaId, size.id)
      }
    }
    for (const row of payload.channelSizes) {
      const channel = mediaById.get(row.mediaId)
      if (!channel) continue
      if (channel.sizes.some((size) => size.id === row.sizeId)) {
        // 目标主键已在库里 → 只更新可编辑字段（宽高决定主键，改了就是另一条，交给下面两支）
        actions.updateMediaSize(row.mediaId, row.sizeId, { maxSizeKb: row.maxSizeKb, enabled: row.enabled })
      } else if (row.sourceSizeId && channel.sizes.some((size) => size.id === row.sourceSizeId)) {
        // 源在、目标不在 → 用户改了宽高。走 update 让 store 内部重算主键
        // （它自己带了「撞车就放弃」的保护，别绕过它直接改数组）
        actions.updateMediaSize(row.mediaId, row.sourceSizeId, {
          width: row.width,
          height: row.height,
          maxSizeKb: row.maxSizeKb,
          enabled: row.enabled,
        })
      } else {
        actions.addMediaSize(row.mediaId, {
          width: row.width,
          height: row.height,
          maxSizeKb: row.maxSizeKb,
          enabled: row.enabled,
        })
      }
      written += 1
    }
  }

  // ---- ④ 全局输出位置 ----
  if (payload.outputDirsGlobal) {
    for (const row of payload.outputDirsGlobal) {
      if (row.dirs.length === 0) actions.clearMediaOutputDirs(row.mediaId)
      else {
        actions.clearMediaOutputDirs(row.mediaId)
        row.dirs.forEach((dir, index) => actions.setMediaOutputDir(row.mediaId, index, dir))
      }
      written += 1
    }
  }

  // ---- ⑤ 方向 × 渠道覆盖 / ⑥ 方向级参数 / ⑦ 归属 ----
  if (payload.outputDirsNode) {
    for (const row of payload.outputDirsNode) {
      const collectionId = resolveCollectionId(row.collectionId)
      actions.setPostprocessOverride(collectionId, {
        byMedia: {
          [row.mediaId]: {
            outputDirs: row.dirs.length > 0 ? row.dirs : undefined,
            // 新值写 `outputDirs`，同时摘掉旧的单值 `outputDir`，避免「显示的」与「生效的」不一致
            outputDir: undefined,
          },
        },
      })
      written += 1
    }
  }

  if (payload.nodeParams) {
    for (const row of payload.nodeParams) {
      const collectionId = resolveCollectionId(row.collectionId)
      const patch: PostprocessNodeOverride = { enabled: row.enabled, outputDir: row.outputDir }
      // 列缺失（旧包）时**不进 patch**：`undefined` 在合并里表示「恢复继承」，
      // 会把用户在新版里配好的方向级渠道清掉 ——「包里没写这一列」不等于「包里说要继承」
      if (row.selectedMediaIds !== undefined) patch.selectedMediaIds = row.selectedMediaIds
      actions.setPostprocessOverride(collectionId, patch)
      written += 1
    }
  }

  if (payload.watermarkBinding) {
    for (const row of payload.watermarkBinding) {
      const collectionId = resolveCollectionId(row.collectionId)
      // 空数组 = 显式「这个方向不加水印」，照写（与「恢复继承」是两种语义）
      actions.setPostprocessOverride(collectionId, { watermarkPresetIds: row.presetIds })
      written += 1
    }
  }

  // ---- ⑧ 分发 / ⑨ 命名 ----
  if (payload.distribution) {
    actions.patchDistribution(payload.distribution)
    written += 1
  }

  if (payload.naming) {
    const { namePattern, creator, identifierText, identifierPlacement, autoCompanionClean, fitMode } = payload.naming
    if (namePattern) actions.setNamePattern(namePattern)
    if (creator !== undefined) actions.setCreator(creator)
    if (autoCompanionClean !== undefined) actions.setAutoCompanionClean(autoCompanionClean)
    if (fitMode !== undefined) actions.setFitMode(fitMode)
    const identifierPatch: Partial<CompositeV2IdentifierConfig> = {}
    if (identifierText !== undefined) identifierPatch.text = identifierText
    if (identifierPlacement !== undefined) identifierPatch.placement = identifierPlacement
    if (Object.keys(identifierPatch).length > 0) actions.setIdentifier(identifierPatch)
    written += 1
  }

  return { written }
}

/**
 * 选一个 xlsx 并解析成表。用户取消返回 `null`（调用方据此安静收场）。
 *
 * 复用 `selectFile` + `readFileBuffer` 两个既有通道，不新开 IPC。
 */
export async function pickConsoleWorkbook(): Promise<Map<ConsoleSheetName, RawTable> | null> {
  if (typeof window === 'undefined') return null
  const api = window.electronAPI
  if (!api?.selectFile || !api?.readFileBuffer) return null
  const filePath = await api.selectFile([{ name: 'Excel 工作簿', extensions: ['xlsx'] }])
  if (!filePath) return null
  const file = await api.readFileBuffer(filePath)
  if (!file) return null
  return parseConsoleWorkbook(file.data)
}

/**
 * 把计划摊成给人看的 dry-run 文本。
 *
 * 用**字符串**而不是 JSX：`confirmDialog.message` 只吃字符串，而这个摘要要在写库前弹出来。
 * 行号一律保留 Excel 的行号，用户拿着能直接定位。
 */
export function formatImportPlan(plan: ImportPlan): string {
  const lines: string[] = []
  const total = plan.summaries.reduce((sum, item) => sum + item.create + item.update, 0)
  lines.push(`将写入 ${total} 项：`)
  for (const item of plan.summaries) {
    if (item.create === 0 && item.update === 0 && item.reject === 0) continue
    const parts = [`新增 ${item.create}`, `更新 ${item.update}`, `不变 ${item.skip}`]
    if (item.reject > 0) parts.push(`拒绝 ${item.reject}`)
    lines.push(`· ${item.label}：${parts.join('，')}`)
  }
  if (plan.sizeKeyChanges.length > 0) {
    lines.push('')
    lines.push(
      `⚠️ 有 ${plan.sizeKeyChanges.length} 个尺寸改了宽高或渠道 —— 尺寸主键由「渠道 + 宽高」派生，` +
        '这些会按「删旧 + 增新」处理，指向旧规格的产出记录会随之失效。',
    )
  }
  if (plan.rejected.length > 0) {
    lines.push('')
    lines.push(`有 ${plan.rejected.length} 行未通过校验（其余照常导入）：`)
    for (const issue of plan.rejected.slice(0, 8)) {
      lines.push(`· ${issue.sheet} 第 ${issue.line} 行：${issue.reason}`)
    }
    if (plan.rejected.length > 8) lines.push(`· 另有 ${plan.rejected.length - 8} 行未列出`)
  }
  // 旧包的「启用 = 否」折成「不参与产出」（ADR-0013）—— 必须说出来：
  // 用户看到的会是「这个渠道没被勾上」，不说清就像导入漏了东西
  const legacyDisabledChannels = plan.payload.channels?.filter((row) => row.legacyDisabled) ?? []
  if (legacyDisabledChannels.length > 0) {
    lines.push('')
    lines.push(
      `· 有 ${legacyDisabledChannels.length} 个渠道在包里标着「启用 = 否」（旧版本导出的列，` +
        `现已并入「参与产出」）：${legacyDisabledChannels
          .slice(0, 5)
          .map((row) => row.name)
          .join('、')}${legacyDisabledChannels.length > 5 ? ' 等' : ''} —— 按「不参与产出」导入。`,
    )
  }
  if (plan.unknownColumns.length > 0) {
    lines.push('')
    lines.push('认不出的列（已忽略，不参与导入）：')
    for (const item of plan.unknownColumns) lines.push(`· ${item.sheet}：${item.columns.join('、')}`)
  }
  if (plan.directoryValues.length > 0) {
    lines.push('')
    lines.push(`会写入 ${plan.directoryValues.length} 个目录，请确认它们在本机存在：`)
    for (const dir of plan.directoryValues.slice(0, 5)) lines.push(`· ${dir}`)
    if (plan.directoryValues.length > 5) lines.push(`· 另有 ${plan.directoryValues.length - 5} 个`)
  }
  if (plan.summaries.some((item) => item.sheet === 'channel_sizes')) {
    lines.push('')
    lines.push('「整体覆盖」会先清空这些渠道的现有尺寸再写入（尺寸是集合语义）；渠道与方向不会被删。')
  }
  if (plan.summaries.some((item) => item.sheet === 'presets' || item.sheet === 'preset_layers')) {
    lines.push('')
    lines.push('水印预设与图层：本次只导出不导入（图层是嵌套结构，平面表格表达不了，请用预设的专用导入）。')
  }
  return lines.join('\n')
}
