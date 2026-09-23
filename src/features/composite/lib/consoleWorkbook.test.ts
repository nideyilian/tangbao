/**
 * 中控台 Excel 工作簿的字段映射回归（TB-060）。
 *
 * 这里钉的是**协议**而不是「函数能不能跑」：
 * - 每张 Sheet 的**第一行必须是字段键**（中文名在第二行）—— 导入器按它匹配，
 *   界面文案改了不能让导出文件与导入器脱钩；
 * - 目录类字段**空串 = 继承**，所以全局输出位置表要列全部渠道（不能只列配过的）；
 * - 归属表的**全局哨兵行**与「某方向显式声明」必须能分开；
 * - `sizeId` 要导出来 —— 它由渠道 + 宽高派生，是导入侧「删旧增新」的唯一线索。
 */

import { describe, expect, it } from 'vitest'
import type { PostprocessMediaConfig } from '../../../lib/postprocessMedia'
import { DEFAULT_POSTPROCESS_DISTRIBUTION } from '../../../lib/postprocessDistribution'
import type { AssetCollection } from '../../../types'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import {
  buildConsoleSheets,
  CONSOLE_SHEET_NAMES,
  writeConsoleWorkbook,
  type ConsoleExportInput,
} from './consoleWorkbook'

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '智能客服', null, 0),
  collection('product-a', '机器人', 'line-a', 0),
  collection('direction-a', '竖版展示', 'product-a', 0),
  collection('direction-b', '横版展示', 'product-a', 1),
]

function makeGlobalConfig(overrides: Partial<PostprocessMediaConfig> = {}): PostprocessMediaConfig {
  return {
    // 媒体表里没有「纯净版」（ADR-0020）：它不是渠道，也从来不在内置媒体表里
    media: [
      {
        id: 'gdt',
        name: '广点通',
        sizes: [{ id: 'gdt-1280x720', width: 1280, height: 720, maxSizeKb: 399, enabled: true }],
      },
    ],
    selectedMediaIds: ['gdt'],
    selectedCollectionIds: ['direction-a'],
    savedTargetCollectionIds: [],
    direction: null,
    fitMode: 'crop-fill',
    outputDir: 'D:/默认位置',
    mediaOutputDirs: { gdt: ['D:/投放A', 'D:/投放B'] },
    namePattern: '{date}-{index}',
    creator: '小王',
    watermarkPresetIds: ['preset-global'],
    distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION },
    ...overrides,
  }
}

function makeInput(overrides: Partial<ConsoleExportInput> = {}): ConsoleExportInput {
  return {
    globalConfig: makeGlobalConfig(),
    collections: COLLECTIONS,
    params: {},
    presets: [
      {
        id: 'preset-global',
        name: '角标A',
        productId: '',
        baseCanvas: { width: 1280, height: 720 },
        sampleBackgroundPath: 'D:/bg.png',
        layers: [
          {
            id: 'layer-1',
            type: 'text',
            name: '标题',
            visible: true,
            locked: false,
            opacity: 1,
            rotation: 0,
            position: { mode: 'free', x: 10, y: 20, width: 100, height: 40 },
            shadow: { enabled: false, color: '#000000', x: 0, y: 0, blur: 0, opacity: 0.5 },
            text: '限时',
            fontFamily: 'sans',
            fontSize: 24,
            fontWeight: 500,
            color: '#FFFFFF',
            align: 'left',
            lineHeight: 1.4,
            letterSpacing: 0,
            padding: 0,
          },
        ],
        updatedAt: 123,
      },
    ],
    identifier: { text: '@小王', placement: 'suffix' },
    ...overrides,
  }
}

function sheetNamed(input: ConsoleExportInput, name: string) {
  const sheet = buildConsoleSheets(input).find((item) => item.name === name)
  if (!sheet) throw new Error(`没有这张表：${name}`)
  return sheet
}

describe('buildConsoleSheets', () => {
  it('产出方案里约定的全部 Sheet，顺序与清单一致', () => {
    const sheets = buildConsoleSheets(makeInput())
    expect(sheets.map((sheet) => sheet.name)).toEqual([...CONSOLE_SHEET_NAMES])
  })

  it('每一列都有字段键与中文名（字段键是导入协议，不能为空）', () => {
    for (const sheet of buildConsoleSheets(makeInput())) {
      expect(sheet.columns.length).toBeGreaterThan(0)
      for (const column of sheet.columns) {
        expect(column.key.trim().length, `${sheet.name} 有空字段键`).toBeGreaterThan(0)
        expect(column.header.trim().length, `${sheet.name}.${column.key} 缺中文名`).toBeGreaterThan(0)
      }
      // 字段键不重复，否则导入会发生「两列抢同一个字段」
      const keys = sheet.columns.map((column) => column.key)
      expect(new Set(keys).size, `${sheet.name} 字段键重复`).toBe(keys.length)
    }
  })

  it('方向结构表带层级与路径（由 parentId 链算出，不落库）', () => {
    const rows = sheetNamed(makeInput(), 'directions').rows
    const leaf = rows.find((row) => row.id === 'direction-a')
    expect(leaf?.level).toBe('方向')
    expect(leaf?.path).toBe('智能客服 / 机器人 / 竖版展示')
    // 顶层没有上级 → 导出空串而不是 undefined（空串才是「继承 / 无」的一致表达）
    expect(rows.find((row) => row.id === 'line-a')?.parentId).toBe('')
  })

  it('方向参数表导出的是生效值，且标注来源', () => {
    const input = makeInput({
      params: { 'direction-a': { postprocess: { outputDir: 'D:/方向级' } } },
    })
    const rows = sheetNamed(input, 'node_params').rows
    const own = rows.find((row) => row.collectionId === 'direction-a')
    expect(own?.outputDir).toBe('D:/方向级')
    expect(own?.sourcedFrom).toBe('本级')
    // 没写过参数的节点：继承链空 → 来源是全局
    expect(rows.find((row) => row.collectionId === 'direction-b')?.sourcedFrom).toBe('全局')
  })

  it('渠道表原样导出媒体表（不再有要单独排除的「纯净版」），并导出产出顺序', () => {
    const rows = sheetNamed(makeInput(), 'channels').rows
    expect(rows.map((row) => row.id)).toEqual(['gdt'])
    // selectedMediaIds = ['gdt'] → 下标 0，顺序要如实导出（它决定产出次序）
    expect(rows[0]?.appliedIndex).toBe(0)
    expect(rows[0]?.applied).toBe(true)
  })

  it('尺寸表导出 sizeId（导入侧靠它判断「改了宽高 = 换了主键」）', () => {
    const rows = sheetNamed(makeInput(), 'channel_sizes').rows
    expect(rows[0]?.sizeId).toBe('gdt-1280x720')
    expect(rows[0]?.mediaId).toBe('gdt')
    expect(rows[0]?.direction).toBe('横版')
  })

  it('全局输出位置表列出全部渠道（空 = 用默认位置），而不是只列配过的', () => {
    const input = makeInput({
      globalConfig: makeGlobalConfig({
        media: [
          { id: 'gdt', name: '广点通', sizes: [] },
          { id: 'baidu', name: '百度', sizes: [] },
        ],
      }),
    })
    const rows = sheetNamed(input, 'output_dirs_global').rows
    expect(rows.map((row) => row.mediaId)).toEqual(['gdt', 'baidu'])
    expect(rows[0]?.outputDir1).toBe('D:/投放A')
    expect(rows[0]?.outputDir2).toBe('D:/投放B')
    // 没配过的渠道留空，而不是省略这一行 —— 空串的语义是「用默认位置」
    expect(rows[1]?.outputDir1).toBe('')
    expect(rows[1]?.defaultOutputDir).toBe('D:/默认位置')
  })

  it('方向 × 渠道覆盖表只列真的写了覆盖的组合', () => {
    const input = makeInput({
      params: {
        'direction-a': { postprocess: { byMedia: { gdt: { outputDirs: ['D:/节点'] } } } },
        'direction-b': { postprocess: { enabled: false } },
      },
    })
    const rows = sheetNamed(input, 'output_dirs_node').rows
    expect(rows).toHaveLength(1)
    expect(rows[0]?.collectionId).toBe('direction-a')
    expect(rows[0]?.outputDir1).toBe('D:/节点')
  })

  it('归属表用哨兵行表示全局清单，与「某方向显式声明」分开', () => {
    const input = makeInput({
      params: { 'direction-a': { postprocess: { watermarkPresetIds: ['preset-global'] } } },
    })
    const rows = sheetNamed(input, 'watermark_binding').rows
    expect(rows.filter((row) => row.collectionId === GLOBAL_NODE_ID)).toHaveLength(1)
    const own = rows.filter((row) => row.collectionId === 'direction-a')
    expect(own).toHaveLength(1)
    expect(own[0]?.scope).toBe('本级')
    expect(own[0]?.presetName).toBe('角标A')
  })

  it('图层表把 position 按模式展平：free 用 x/y，anchor 用锚点 + 偏移', () => {
    const rows = sheetNamed(makeInput(), 'preset_layers').rows
    expect(rows[0]?.positionMode).toBe('free')
    expect(rows[0]?.anchor).toBe('')
    expect(rows[0]?.x).toBe(10)
    expect(rows[0]?.text).toBe('限时')
  })

  it('命名表覆盖署名等原本没有集中导出位置的项', () => {
    const rows = sheetNamed(makeInput(), 'naming').rows
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    expect(byKey.namePattern).toBe('{date}-{index}')
    expect(byKey.creator).toBe('小王')
    expect(byKey.identifierText).toBe('@小王')
    expect(byKey.identifierPlacement).toBe('suffix')
    // 画面适配也在这张表里：它与命名、分发同属「全局一套」的产出规格
    expect(byKey.fitMode).toBe('crop-fill')
  })

  it('分发表 7 个字段一个不少（起始日期与搬运方式已移除）', () => {
    const rows = sheetNamed(makeInput(), 'distribution').rows
    expect(rows).toHaveLength(7)
    expect(rows.map((row) => row.key)).toContain('targetDir')
    expect(rows.map((row) => row.key)).not.toContain('startDate')
    // 搬运方式（复制 / 移动）已撤：这套目录结构下第 1 天是原地，复制会让排期错乱
    expect(rows.map((row) => row.key)).not.toContain('mode')
  })
})

describe('writeConsoleWorkbook', () => {
  /**
   * 往返验证：把工作簿写成二进制、再用同一个库读回来。
   *
   * 只测纯函数是不够的 —— 表头契约（第一行字段键、第二行中文名）是**导入器唯一的匹配依据**，
   * 而它只有在真的写出去再读回来之后才能被确证（比如 xlsx 把首行当成数据、或把字段键当日期解析）。
   */
  it('写出的工作簿能被读回，且每张表第一行是字段键、第二行是中文名', async () => {
    const sheets = buildConsoleSheets(makeInput())
    const buffer = await writeConsoleWorkbook(sheets)
    expect(buffer.byteLength).toBeGreaterThan(0)

    const XLSX = await import('xlsx')
    const workbook = XLSX.read(buffer, { type: 'array' })
    expect(workbook.SheetNames).toEqual([...CONSOLE_SHEET_NAMES])

    for (const sheet of sheets) {
      const aoa = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheet.name]!, { header: 1 })
      expect(aoa[0], `${sheet.name} 首行不是字段键`).toEqual(sheet.columns.map((column) => column.key))
      expect(aoa[1], `${sheet.name} 次行不是中文名`).toEqual(sheet.columns.map((column) => column.header))
      expect(aoa.length).toBe(sheet.rows.length + 2)
    }
  })
})
