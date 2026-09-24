/**
 * 中控台 Excel 导入的回归（TB-060）。
 *
 * 重点钉住四类「会静默出错」的地方，它们都不是渲染问题，看不出、也不报错：
 *
 * 1. **未知列 / 悬空外键 / 成环** —— 静默丢弃或写坏树，用户以为导入成功了；
 * 2. **`sizeId` 派生** —— 改宽高必须按「删旧 + 增新」处理并预告影响面；
 * 3. **新建方向的 id 会变** —— 后续表的 `collectionId` 必须过映射，否则整片落空；
 * 4. **全局哨兵行** —— 归属表里代表全局清单的那行**不能**被当成某个方向来写。
 */

import { describe, expect, it, vi } from 'vitest'
import type { PostprocessMedia } from '../../../lib/postprocessMedia'
import type { AssetCollection } from '../../../types'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { buildConsoleSheets, writeConsoleWorkbook, type ConsoleSheetName } from './consoleWorkbook'
import {
  applyConsoleImport,
  formatImportPlan,
  parseConsoleWorkbook,
  parseImportBool,
  parseImportList,
  parseImportNumber,
  planConsoleImport,
  type ConsoleImportActions,
  type ConsoleImportContext,
  type RawTable,
} from './consoleImport'

function collection(id: string, name: string, parentId: string | null, order = 0): AssetCollection {
  return { id, name, normalizedName: name, parentId, order, createdAt: 1, updatedAt: 1 }
}

const COLLECTIONS: AssetCollection[] = [
  collection('line-a', '智能客服', null, 0),
  collection('direction-a', '竖版展示', 'line-a', 0),
]

// 媒体表里没有「纯净版」（ADR-0020）：它不是渠道，也从来不在内置媒体表里
const MEDIA: PostprocessMedia[] = [
  {
    id: 'gdt',
    name: '广点通',
    sizes: [{ id: 'gdt-1280x720', width: 1280, height: 720, maxSizeKb: 0, enabled: true }],
  },
]

function makeContext(overrides: Partial<ConsoleImportContext> = {}): ConsoleImportContext {
  return {
    collections: COLLECTIONS,
    media: MEDIA,
    params: {},
    mediaOutputDirs: {},
    presetIds: ['preset-a'],
    ...overrides,
  }
}

/** 手工造一张表：首行字段键、数据行从 Excel 第 3 行起。空单元格故意用 `null` 试一遍。 */
function table(name: ConsoleSheetName, keys: string[], rows: Array<Array<string | null>>): RawTable {
  return {
    name,
    columns: new Map(keys.map((key, index) => [key, index])),
    unknownColumns: [],
    rows: rows.map((values, index) => ({
      line: index + 3,
      values: Object.fromEntries(values.map((value, columnIndex) => [String(columnIndex), value])),
    })),
  }
}

function tablesOf(...entries: Array<[ConsoleSheetName, RawTable]>): Map<ConsoleSheetName, RawTable> {
  return new Map(entries)
}

function makeActions(overrides: Partial<ConsoleImportActions> = {}): ConsoleImportActions {
  return {
    addMedia: vi.fn(() => 'new-media'),
    renameMedia: vi.fn(),
    addMediaSize: vi.fn(),
    updateMediaSize: vi.fn(),
    deleteMediaSize: vi.fn(),
    setSelectedMediaIds: vi.fn(),
    setMediaOutputDir: vi.fn(),
    clearMediaOutputDirs: vi.fn(),
    setPostprocessOverride: vi.fn(),
    patchDistribution: vi.fn(),
    setNamePattern: vi.fn(),
    setFitMode: vi.fn(),
    setCreator: vi.fn(),
    setIdentifier: vi.fn(),
    createCollection: vi.fn(async () => ({ id: 'created-1' })),
    renameCollection: vi.fn(async () => undefined),
    moveCollection: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('取值容错', () => {
  it('布尔认各种写法的同义词', () => {
    for (const truthy of ['true', 'TRUE', '1', '是', 'yes', 'Y']) expect(parseImportBool(truthy)).toBe(true)
    for (const falsy of ['false', '0', '否', 'no', 'N']) expect(parseImportBool(falsy)).toBe(false)
    expect(parseImportBool('')).toBeUndefined()
    expect(parseImportBool('随便')).toBeUndefined()
  })

  it('数字去掉千分位与全角逗号', () => {
    expect(parseImportNumber('1,280')).toBe(1280)
    expect(parseImportNumber('１２８０')).toBeUndefined()
    expect(parseImportNumber('')).toBeUndefined()
  })

  it('列表半角全角逗号都认', () => {
    expect(parseImportList('a, b，c')).toEqual(['a', 'b', 'c'])
  })
})

describe('planConsoleImport：校验', () => {
  it('未知列被列出来，不静默丢弃', () => {
    const channels = table('channels', ['id', 'name'], [['gdt', '广点通']])
    channels.unknownColumns = ['我瞎加的列']
    const plan = planConsoleImport(tablesOf(['channels', channels]), makeContext())
    expect(plan.unknownColumns).toEqual([{ sheet: '渠道', columns: ['我瞎加的列'] }])
  })

  it('尺寸的外键悬空 → 拒该行并报 Excel 行号', () => {
    const sizes = table(
      'channel_sizes',
      ['sizeId', 'mediaId', 'width', 'height'],
      [['x-100x100', '不存在的渠道', '100', '100']],
    )
    const plan = planConsoleImport(tablesOf(['channel_sizes', sizes]), makeContext())
    expect(plan.rejected).toHaveLength(1)
    expect(plan.rejected[0]?.line).toBe(3)
    expect(plan.rejected[0]?.reason).toContain('既不在库里也不在这个包里')
  })

  it('填了「位置2」却没填「位置1」→ 拒绝（否则位置会串位）', () => {
    const dirs = table('output_dirs_global', ['mediaId', 'outputDir1', 'outputDir2'], [['gdt', '', 'D:/B']])
    const plan = planConsoleImport(tablesOf(['output_dirs_global', dirs]), makeContext())
    expect(plan.rejected[0]?.reason).toContain('却没填')
  })

  it('归属指向不存在的预设 → 拒绝（悬空预设会少一层水印却不报错）', () => {
    const binding = table('watermark_binding', ['collectionId', 'presetId'], [['direction-a', 'preset-不存在']])
    const plan = planConsoleImport(tablesOf(['watermark_binding', binding]), makeContext())
    expect(plan.rejected[0]?.reason).toContain('不在水印库里')
  })

  it('归属表的全局哨兵行被跳过，不会被当成某个方向写进去', () => {
    const binding = table(
      'watermark_binding',
      ['collectionId', 'presetId'],
      [
        [GLOBAL_NODE_ID, 'preset-a'],
        ['direction-a', 'preset-a'],
      ],
    )
    const plan = planConsoleImport(tablesOf(['watermark_binding', binding]), makeContext())
    expect(plan.payload.watermarkBinding).toEqual([{ collectionId: 'direction-a', presetIds: ['preset-a'] }])
  })

  it('方向树成环 → 整表拒绝并说明', () => {
    const directions = table(
      'directions',
      ['id', 'name', 'parentId', 'order'],
      [
        ['a', 'A', 'b', '0'],
        ['b', 'B', 'a', '0'],
      ],
    )
    const plan = planConsoleImport(tablesOf(['directions', directions]), makeContext({ collections: [] }))
    expect(plan.payload.directions).toBeUndefined()
    expect(plan.rejected[0]?.reason).toContain('成环')
  })
})

describe('planConsoleImport：sizeId 派生', () => {
  it('宽高改了 → 记进 sizeKeyChanges（不拒绝，但必须预告）', () => {
    const sizes = table(
      'channel_sizes',
      ['sizeId', 'mediaId', 'width', 'height', 'maxSizeKb', 'enabled'],
      [['gdt-1280x720', 'gdt', '1280', '800', '0', '是']],
    )
    const plan = planConsoleImport(tablesOf(['channel_sizes', sizes]), makeContext())
    expect(plan.sizeKeyChanges).toEqual([{ from: 'gdt-1280x720', to: 'gdt-1280x800' }])
    expect(plan.payload.channelSizes?.[0]?.sizeId).toBe('gdt-1280x800')
    expect(plan.payload.channelSizes?.[0]?.sourceSizeId).toBe('gdt-1280x720')
    expect(formatImportPlan(plan)).toContain('尺寸主键由「渠道 + 宽高」派生')
  })

  it('宽高没变 → 不产生主键变化', () => {
    const sizes = table(
      'channel_sizes',
      ['sizeId', 'mediaId', 'width', 'height', 'maxSizeKb', 'enabled'],
      [['gdt-1280x720', 'gdt', '1280', '720', '266', '是']],
    )
    const plan = planConsoleImport(tablesOf(['channel_sizes', sizes]), makeContext())
    expect(plan.sizeKeyChanges).toEqual([])
  })
})

describe('applyConsoleImport', () => {
  it('新建的方向会记录 id 映射，后续表的 collectionId 用映射后的值', async () => {
    const directions = table('directions', ['id', 'name', 'parentId', 'order'], [['新建的方向', '新方向', null, '0']])
    const nodeParams = table('node_params', ['collectionId', 'enabled'], [['新建的方向', '是']])
    const plan = planConsoleImport(tablesOf(['directions', directions], ['node_params', nodeParams]), makeContext())
    const actions = makeActions()
    await applyConsoleImport(plan, actions, makeContext())

    expect(actions.createCollection).toHaveBeenCalledWith('新方向', null)
    // ⭐ 关键：节点参数必须写到「新建后的真实 id」上，而不是 Excel 里的占位 id
    expect(actions.setPostprocessOverride).toHaveBeenCalledWith('created-1', expect.objectContaining({ enabled: true }))
  })

  it('尺寸改了宽高 → 走 update（让 store 自己重算主键），不是删一条加一条', async () => {
    const sizes = table(
      'channel_sizes',
      ['sizeId', 'mediaId', 'width', 'height', 'maxSizeKb', 'enabled'],
      [['gdt-1280x720', 'gdt', '1280', '800', '0', '是']],
    )
    const plan = planConsoleImport(tablesOf(['channel_sizes', sizes]), makeContext())
    const actions = makeActions()
    await applyConsoleImport(plan, actions, makeContext())

    expect(actions.addMediaSize).not.toHaveBeenCalled()
    expect(actions.deleteMediaSize).not.toHaveBeenCalled()
    expect(actions.updateMediaSize).toHaveBeenCalledWith(
      'gdt',
      'gdt-1280x720',
      expect.objectContaining({ width: 1280, height: 800 }),
    )
  })

  it('库里没有的新尺寸 → 新增', async () => {
    const sizes = table(
      'channel_sizes',
      ['sizeId', 'mediaId', 'width', 'height', 'maxSizeKb', 'enabled'],
      [['gdt-1080x1920', 'gdt', '1080', '1920', '399', '是']],
    )
    const plan = planConsoleImport(tablesOf(['channel_sizes', sizes]), makeContext())
    const actions = makeActions()
    await applyConsoleImport(plan, actions, makeContext())
    expect(actions.addMediaSize).toHaveBeenCalledWith(
      'gdt',
      expect.objectContaining({ width: 1080, height: 1920, maxSizeKb: 399 }),
    )
  })

  it('replace 模式先清空该渠道的尺寸再写（尺寸是集合语义）', async () => {
    const sizes = table(
      'channel_sizes',
      ['sizeId', 'mediaId', 'width', 'height', 'maxSizeKb', 'enabled'],
      [['gdt-1080x1920', 'gdt', '1080', '1920', '0', '是']],
    )
    const plan = planConsoleImport(tablesOf(['channel_sizes', sizes]), makeContext(), 'replace')
    const actions = makeActions()
    await applyConsoleImport(plan, actions, makeContext())
    expect(actions.deleteMediaSize).toHaveBeenCalledWith('gdt', 'gdt-1280x720')
    expect(actions.addMediaSize).toHaveBeenCalled()
  })

  it('产出顺序按 appliedIndex 排', async () => {
    const channels = table(
      'channels',
      ['id', 'name', 'applied', 'appliedIndex', 'enabled'],
      [
        ['gdt', '广点通', '是', '1', '是'],
        ['baidu', '百度', '是', '0', '是'],
      ],
    )
    const plan = planConsoleImport(tablesOf(['channels', channels]), makeContext())
    const actions = makeActions()
    await applyConsoleImport(plan, actions, makeContext())
    // 导入只认表里勾了什么：原先这里会无条件把 `clean` 塞到队首，等于「导入一次就把纯净版打开」
    expect(actions.setSelectedMediaIds).toHaveBeenCalledWith(['baidu', 'gdt'])
  })

  it('⭐ 旧包的「启用 = 否」折成「不参与产出」，并在导入报告里说清（ADR-0013）', async () => {
    // 渠道「启用」字段已并入「参与产出」。老包里那一列写着「否」时**不能当没看见** ——
    // 忽略它等于把用户停用过的渠道悄悄放回产出（行为反转），用户只会在磁盘上发现多出一批文件。
    const channels = table(
      'channels',
      ['id', 'name', 'applied', 'appliedIndex', 'enabled'],
      [
        ['gdt', '广点通', '是', '0', '否'],
        ['baidu', '百度', '是', '1', '是'],
      ],
    )
    const plan = planConsoleImport(tablesOf(['channels', channels]), makeContext())
    const actions = makeActions()
    await applyConsoleImport(plan, actions, makeContext())

    expect(actions.setSelectedMediaIds).toHaveBeenCalledWith(['baidu'])
    // 而且要**说出来**：用户看到的是「这个渠道没被勾上」，不解释就像导入漏了东西
    const report = formatImportPlan(plan)
    expect(report).toContain('启用 = 否')
    expect(report).toContain('广点通')
  })

  it('没有「启用」列的新包（当前导出口径）照常导入，不产生那条提示', () => {
    const channels = table('channels', ['id', 'name', 'applied', 'appliedIndex'], [['gdt', '广点通', '是', '0']])
    const plan = planConsoleImport(tablesOf(['channels', channels]), makeContext())
    expect(plan.payload.channels?.[0]).toMatchObject({ id: 'gdt', applied: true, legacyDisabled: false })
    expect(formatImportPlan(plan)).not.toContain('启用 = 否')
  })

  it('全局输出位置：空目录 = 清掉覆盖（回到默认位置）', async () => {
    const dirs = table('output_dirs_global', ['mediaId', 'outputDir1', 'outputDir2'], [['gdt', '', '']])
    const plan = planConsoleImport(
      tablesOf(['output_dirs_global', dirs]),
      makeContext({ mediaOutputDirs: { gdt: ['D:/旧'] } }),
    )
    const actions = makeActions()
    await applyConsoleImport(plan, actions, makeContext({ mediaOutputDirs: { gdt: ['D:/旧'] } }))
    expect(actions.clearMediaOutputDirs).toHaveBeenCalledWith('gdt')
    expect(actions.setMediaOutputDir).not.toHaveBeenCalled()
  })
})

describe('往返：导出的工作簿能被导入解析回同样的数据', () => {
  it('导出 → 读回 → 计划，渠道与尺寸一一对上', async () => {
    const input = {
      globalConfig: {
        media: MEDIA,
        selectedMediaIds: ['gdt'],
        selectedCollectionIds: ['direction-a'],
        savedTargetCollectionIds: [],
        savedTargetsByFolder: {},
        direction: null,
        fitMode: 'crop-fill' as const,
        outputDir: 'D:/默认',
        mediaOutputDirs: { gdt: ['D:/投放'] },
        namePattern: '{date}',
        creator: '小王',
        watermarkPresetIds: ['preset-a'],
        distribution: {
          enabled: false,
          startDate: '',
          days: 1,
          randomize: false,
          skipWeekends: false,
          renameMode: 'date' as const,
          modifyMd5: false,
          targetDir: '',
        },
      },
      collections: COLLECTIONS,
      params: { 'direction-a': { postprocess: { outputDir: 'D:/方向级' } } },
      presets: [],
      identifier: { text: '@小王', placement: 'suffix' as const },
    }

    const buffer = await writeConsoleWorkbook(buildConsoleSheets(input))
    const tables = await parseConsoleWorkbook(buffer)
    // 首行字段键被正确识别成列索引（中文名那行没被当数据）
    expect([...tables.get('channels')!.columns.keys()]).toContain('id')
    expect(tables.get('channels')!.rows).toHaveLength(1)

    const plan = planConsoleImport(tables, makeContext({ mediaOutputDirs: {} }))
    expect(plan.rejected).toHaveLength(0)
    expect(plan.payload.channels?.[0]).toMatchObject({ id: 'gdt', name: '广点通', applied: true })
    expect(plan.payload.channelSizes?.[0]).toMatchObject({ mediaId: 'gdt', width: 1280, height: 720 })
    // node_params 是一行一个方向（连产品线也有一行），所以按 id 找而不是取第一行
    expect(plan.payload.nodeParams?.find((row) => row.collectionId === 'direction-a')).toMatchObject({
      outputDir: 'D:/方向级',
    })
    // 归属：导出时只有全局哨兵行（那个方向没显式声明水印），而哨兵行导入时被跳过
    // → 前端没有全局清单的写入点，所以这里应当为空，而不是把全局值写成某个方向的
    expect(plan.payload.watermarkBinding).toEqual([])
    expect(plan.payload.distribution?.enabled).toBe(false)
    expect(plan.payload.naming?.namePattern).toBe('{date}')
    // 画面适配也走 naming 表往返（导出英文枚举，导入原样认）
    expect(plan.payload.naming?.fitMode).toBe('crop-fill')
  })
})

describe('画面适配（naming 表往返）', () => {
  const namingTable = (value: string) =>
    tablesOf(['naming', table('naming', ['key', 'label', 'value'], [['fitMode', '画面适配', value]])])

  it('英文枚举与中文标签都认：这张表是给人手改的', () => {
    expect(planConsoleImport(namingTable('contain-blur'), makeContext()).payload.naming?.fitMode).toBe('contain-blur')
    expect(planConsoleImport(namingTable('模糊填充'), makeContext()).payload.naming?.fitMode).toBe('contain-blur')
    expect(planConsoleImport(namingTable('拉伸铺满'), makeContext()).payload.naming?.fitMode).toBe('stretch')
  })

  it('⭐ 填了不认识的值要报出来，而不是静默回落', () => {
    // 静默回落成默认值会让用户以为改生效了，实际产出还是老样子 —— 这个项目明确不要这种降级
    const plan = planConsoleImport(namingTable('blur'), makeContext())
    expect(plan.payload.naming?.fitMode).toBe('crop-fill')
    expect(plan.rejected.some((issue) => issue.reason.includes('画面适配'))).toBe(true)
  })

  it('留空 = 这轮不动这个字段（既不覆盖配置，也不报错）', () => {
    const plan = planConsoleImport(namingTable(''), makeContext())
    expect(plan.payload.naming?.fitMode).toBeUndefined()
    expect(plan.rejected).toHaveLength(0)
  })
})
