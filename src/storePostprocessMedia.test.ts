import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildPostprocessMediaSizeId,
  buildPostprocessOutputName,
  createDefaultPostprocessMedia,
  createDefaultPostprocessMediaConfig,
  getPostprocessMediaConfigSnapshot,
  isPostprocessReady,
  normalizePostprocessMediaConfig,
  restorePostprocessMediaConfig,
  selectPostprocessOutputPlan,
  usePostprocessMediaStore,
} from './storePostprocessMedia'
import { DEFAULT_POSTPROCESS_MEDIA, PURE_MEDIA_ID } from './lib/postprocessMedia'
import { DEFAULT_POSTPROCESS_NAME_PATTERN } from './lib/postprocessNaming'

beforeEach(() => {
  usePostprocessMediaStore.setState(createDefaultPostprocessMediaConfig())
})

describe('默认配置', () => {
  it('默认只勾纯净版，方向自动，纯净版自动伴随开启', () => {
    const state = usePostprocessMediaStore.getState()
    expect(state.selectedMediaIds).toEqual([PURE_MEDIA_ID])
    expect(state.selectedCollectionIds).toEqual([])
    expect(state.direction).toBeNull()
    expect(state.namePattern).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN)
    expect(state.watermarkPresetId).toBeNull()
    expect(state.autoCompanionClean).toBe(true)
    expect(state.media).toHaveLength(4)
  })

  it('默认媒体表与内置常量深拷贝隔离，改 store 不会污染常量', () => {
    const media = createDefaultPostprocessMedia()
    media[0].name = '被改过的名字'
    media[0].sizes[0].maxSizeKb = 1
    expect(DEFAULT_POSTPROCESS_MEDIA[0].name).toBe('广点通')
    expect(DEFAULT_POSTPROCESS_MEDIA[0].sizes[0].maxSizeKb).toBe(399)

    usePostprocessMediaStore.getState().renameMedia('gdt', '改过的')
    expect(DEFAULT_POSTPROCESS_MEDIA[0].name).toBe('广点通')
  })
})

describe('媒体表增删改', () => {
  it('新增自定义媒体并生成 custom- 前缀 id；重名 id 与空名拒绝', () => {
    const store = usePostprocessMediaStore.getState()
    const newId = store.addMedia('小红书')
    expect(newId).toMatch(/^custom-[0-9a-f]{8}$/)
    expect(usePostprocessMediaStore.getState().media).toHaveLength(5)
    expect(usePostprocessMediaStore.getState().media.at(-1)).toEqual({
      id: newId,
      name: '小红书',
      enabled: true,
      sizes: [],
    })

    expect(usePostprocessMediaStore.getState().addMedia('  ')).toBeNull()
    expect(usePostprocessMediaStore.getState().addMedia('重复 id', 'gdt')).toBeNull()
    expect(usePostprocessMediaStore.getState().media).toHaveLength(5)
  })

  it('改名与停用', () => {
    const store = usePostprocessMediaStore.getState()
    store.renameMedia('gdt', '  广点通广告位  ')
    expect(usePostprocessMediaStore.getState().media[0].name).toBe('广点通广告位')

    store.renameMedia('gdt', '   ')
    expect(usePostprocessMediaStore.getState().media[0].name).toBe('广点通广告位')

    store.setMediaEnabled('gdt', false)
    expect(usePostprocessMediaStore.getState().media[0].enabled).toBe(false)
  })

  it('删除媒体会同时清掉它的勾选，删不存在的媒体是 no-op', () => {
    const store = usePostprocessMediaStore.getState()
    store.setSelectedMediaIds([PURE_MEDIA_ID, 'gdt', 'baidu'])
    store.deleteMedia('gdt')
    const state = usePostprocessMediaStore.getState()
    expect(state.media.map((item) => item.id)).toEqual(['baidu', 'vendor', 'toutiao'])
    expect(state.selectedMediaIds).toEqual([PURE_MEDIA_ID, 'baidu'])

    const before = state.media
    usePostprocessMediaStore.getState().deleteMedia('gdt')
    expect(usePostprocessMediaStore.getState().media).toBe(before)
  })

  it('尺寸 id 由宽高派生，重复宽高视为同一规格不重复添加', () => {
    const store = usePostprocessMediaStore.getState()
    store.addMediaSize('gdt', { width: 640, height: 480, maxSizeKb: 100, enabled: true })
    expect(usePostprocessMediaStore.getState().media[0].sizes.at(-1)).toEqual({
      id: 'gdt-640x480',
      width: 640,
      height: 480,
      maxSizeKb: 100,
      enabled: true,
    })

    usePostprocessMediaStore.getState().addMediaSize('gdt', { width: 640, height: 480, maxSizeKb: 200, enabled: true })
    expect(usePostprocessMediaStore.getState().media[0].sizes).toHaveLength(3)

    usePostprocessMediaStore.getState().addMediaSize('gdt', { width: 0, height: 480, maxSizeKb: 100, enabled: true })
    expect(usePostprocessMediaStore.getState().media[0].sizes).toHaveLength(3)

    // maxSizeKb 负数无意义 → 归 0（不压缩），而不是丢弃整条尺寸
    usePostprocessMediaStore.getState().addMediaSize('gdt', { width: 320, height: 240, maxSizeKb: -5, enabled: true })
    expect(usePostprocessMediaStore.getState().media[0].sizes.at(-1)?.maxSizeKb).toBe(0)
  })

  it('改尺寸宽高时重算 id；与同媒体其它尺寸撞车时放弃修改', () => {
    const store = usePostprocessMediaStore.getState()
    store.updateMediaSize('gdt', 'gdt-1280x720', { width: 1000, height: 1000 })
    expect(usePostprocessMediaStore.getState().media[0].sizes.map((size) => size.id)).toEqual([
      'gdt-1000x1000',
      'gdt-1080x1920',
    ])

    // 改成一个已被占用的宽高 → 保持原样
    usePostprocessMediaStore.getState().updateMediaSize('gdt', 'gdt-1000x1000', { width: 1080, height: 1920 })
    expect(usePostprocessMediaStore.getState().media[0].sizes.map((size) => size.id)).toEqual([
      'gdt-1000x1000',
      'gdt-1080x1920',
    ])
  })

  it('改尺寸体积上限与启用态', () => {
    const store = usePostprocessMediaStore.getState()
    store.updateMediaSize('gdt', 'gdt-1280x720', { maxSizeKb: 512, enabled: false })
    expect(usePostprocessMediaStore.getState().media[0].sizes[0]).toEqual({
      id: 'gdt-1280x720',
      width: 1280,
      height: 720,
      maxSizeKb: 512,
      enabled: false,
    })

    usePostprocessMediaStore.getState().deleteMediaSize('gdt', 'gdt-1280x720')
    expect(usePostprocessMediaStore.getState().media[0].sizes).toHaveLength(1)
  })

  it('resetMedia 恢复内置表，并把自定义媒体的勾选清掉', () => {
    const store = usePostprocessMediaStore.getState()
    const customId = store.addMedia('小红书')!
    usePostprocessMediaStore.getState().setSelectedMediaIds([PURE_MEDIA_ID, customId, 'gdt'])
    usePostprocessMediaStore.getState().deleteMedia('baidu')

    usePostprocessMediaStore.getState().resetMedia()
    const state = usePostprocessMediaStore.getState()
    expect(state.media.map((item) => item.id)).toEqual(['gdt', 'baidu', 'vendor', 'toutiao'])
    expect(state.selectedMediaIds).toEqual([PURE_MEDIA_ID, 'gdt'])
  })

  it('buildPostprocessMediaSizeId 与表内既有 id 规则一致', () => {
    expect(buildPostprocessMediaSizeId('toutiao', 1080, 1920)).toBe('toutiao-1080x1920')
  })
})

describe('选择与开关', () => {
  it('切换媒体勾选', () => {
    const store = usePostprocessMediaStore.getState()
    store.toggleSelectedMedia('gdt')
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toEqual([PURE_MEDIA_ID, 'gdt'])
    usePostprocessMediaStore.getState().toggleSelectedMedia('gdt')
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toEqual([PURE_MEDIA_ID])
    usePostprocessMediaStore.getState().toggleSelectedMedia('   ')
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toEqual([PURE_MEDIA_ID])
  })

  it('setSelectedMediaIds 去重、去空，并剔除不存在的媒体（clean 例外）', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt', 'gdt', '', '  ', 'ghost', PURE_MEDIA_ID])
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toEqual(['gdt', PURE_MEDIA_ID])
  })

  it('切换项目勾选', () => {
    const store = usePostprocessMediaStore.getState()
    store.toggleSelectedCollection('builtin-product-a')
    store.toggleSelectedCollection('builtin-product-b')
    expect(usePostprocessMediaStore.getState().selectedCollectionIds).toEqual([
      'builtin-product-a',
      'builtin-product-b',
    ])
    usePostprocessMediaStore.getState().toggleSelectedCollection('builtin-product-a')
    expect(usePostprocessMediaStore.getState().selectedCollectionIds).toEqual(['builtin-product-b'])
  })

  it('方向、目录、模板、创作者、水印预设、伴随开关的写入与非法值兜底', () => {
    const store = usePostprocessMediaStore.getState()
    store.setDirection('portrait')
    expect(usePostprocessMediaStore.getState().direction).toBe('portrait')
    store.setDirection(null)
    expect(usePostprocessMediaStore.getState().direction).toBeNull()

    usePostprocessMediaStore.getState().setOutputDir('D:\\投放大图')
    expect(usePostprocessMediaStore.getState().outputDir).toBe('D:\\投放大图')

    // 模板清空 → 回退默认模板，避免 UI 里出现无法渲染的空模板
    usePostprocessMediaStore.getState().setNamePattern('  ')
    expect(usePostprocessMediaStore.getState().namePattern).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN)

    usePostprocessMediaStore.getState().setCreator('杰哥')
    expect(usePostprocessMediaStore.getState().creator).toBe('杰哥')

    usePostprocessMediaStore.getState().setWatermarkPresetId('  ')
    expect(usePostprocessMediaStore.getState().watermarkPresetId).toBeNull()
    usePostprocessMediaStore.getState().setWatermarkPresetId('preset-1')
    expect(usePostprocessMediaStore.getState().watermarkPresetId).toBe('preset-1')

    usePostprocessMediaStore.getState().setAutoCompanionClean(false)
    expect(usePostprocessMediaStore.getState().autoCompanionClean).toBe(false)
  })
})

describe('归一化（持久化与备份恢复共用）', () => {
  it('非对象输入 → 全套默认值', () => {
    expect(normalizePostprocessMediaConfig(null)).toEqual(createDefaultPostprocessMediaConfig())
    expect(normalizePostprocessMediaConfig('坏数据')).toEqual(createDefaultPostprocessMediaConfig())
  })

  it('media 缺失回填内置表；media 为空数组保持为空（不复活已删媒体）', () => {
    expect(normalizePostprocessMediaConfig({ selectedMediaIds: ['gdt'] }).media).toHaveLength(4)
    expect(normalizePostprocessMediaConfig({ media: [] }).media).toEqual([])
  })

  it('坏条目逐条丢弃，保住用户其余编辑', () => {
    const normalized = normalizePostprocessMediaConfig({
      media: [
        { id: 'ok', name: '正常', sizes: [{ id: 'ok-1', width: 100, height: 200, maxSizeKb: 50 }] },
        { id: '', name: '缺 id' },
        { id: 'no-name', name: '  ' },
        {
          id: 'dup-sizes',
          name: '重复尺寸',
          sizes: [
            { id: 's1', width: 10, height: 20, maxSizeKb: 30 },
            { id: 's1', width: 10, height: 20, maxSizeKb: 30 },
            { id: 's2', width: 0, height: 20, maxSizeKb: 30 },
            { id: 's3', width: Number.NaN, height: 20, maxSizeKb: 30 },
          ],
        },
        { id: 'ok', name: '重复媒体 id' },
      ],
    })
    expect(normalized.media.map((item) => item.id)).toEqual(['ok', 'dup-sizes'])
    expect(normalized.media[0].sizes).toHaveLength(1)
    expect(normalized.media[1].sizes).toHaveLength(1)
    expect(normalized.media[0].enabled).toBe(true)
  })

  it('非法方向归 null，非法选择列表走默认值', () => {
    expect(normalizePostprocessMediaConfig({ direction: 'diagonal' }).direction).toBeNull()
    expect(normalizePostprocessMediaConfig({ selectedCollectionIds: 'x' }).selectedCollectionIds).toEqual([])
    expect(normalizePostprocessMediaConfig({ selectedMediaIds: 'x' }).selectedMediaIds).toEqual([PURE_MEDIA_ID])
  })

  it('备份恢复走归一化，缺字段不抛错', () => {
    restorePostprocessMediaConfig({ selectedMediaIds: ['gdt'], creator: '杰哥' })
    const state = usePostprocessMediaStore.getState()
    expect(state.selectedMediaIds).toEqual(['gdt'])
    expect(state.creator).toBe('杰哥')
    expect(state.media).toHaveLength(4)
    expect(state.namePattern).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN)

    restorePostprocessMediaConfig(undefined)
    expect(usePostprocessMediaStore.getState()).toMatchObject(createDefaultPostprocessMediaConfig())
  })

  it('快照是深拷贝，改快照不影响 store', () => {
    const snapshot = getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState())
    snapshot.media[0].name = '改了'
    snapshot.selectedMediaIds.push('baidu')
    const state = usePostprocessMediaStore.getState()
    expect(state.media[0].name).toBe('广点通')
    expect(state.selectedMediaIds).toEqual([PURE_MEDIA_ID])
  })
})

describe('产出计划', () => {
  it('勾渠道媒体时自动补上纯净版（干净版自动伴随）', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt'])
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })
    expect(plan.units[0]).toMatchObject({ mediaId: PURE_MEDIA_ID, clean: true, maxSizeKb: 0, width: 1280, height: 720 })
    expect(plan.units.slice(1).map((unit) => unit.sizeId)).toEqual(['gdt-1280x720'])
    expect(plan.skippedMediaIds).toEqual([])
  })

  it('关掉伴随开关后只产出勾选内容', () => {
    const store = usePostprocessMediaStore.getState()
    store.setSelectedMediaIds(['gdt'])
    store.setAutoCompanionClean(false)
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })
    expect(plan.units.map((unit) => unit.mediaId)).toEqual(['gdt'])
  })

  it('只勾纯净版时不重复添加', () => {
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 512, height: 512 })
    expect(plan.units).toHaveLength(1)
    expect(plan.units[0].sizeId).toBe('clean-512x512')
  })

  it('选择里存在悬空媒体 id（如备份导入后）→ 计入 skippedMediaIds 交 UI 提示', () => {
    // 正常路径下 setSelectedMediaIds 会剔除不存在的媒体；这里直接写 state 模拟
    // 「持久化/备份里 media 与选择列表不一致」的情况，验证产出计划不会静默出错图。
    usePostprocessMediaStore.setState({ selectedMediaIds: ['ghost'] })
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })
    expect(plan.skippedMediaIds).toEqual(['ghost'])
    expect(plan.units.map((unit) => unit.mediaId)).toEqual([PURE_MEDIA_ID])
  })

  it('setSelectedMediaIds 会把悬空媒体清掉（纵深防御，避免脏选择落盘）', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['ghost', 'gdt'])
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toEqual(['gdt'])
  })

  it('isPostprocessReady 要求至少勾一个项目，且勾了项目后有可产出单元', () => {
    const store = usePostprocessMediaStore.getState()
    store.setSelectedMediaIds(['gdt'])
    expect(isPostprocessReady(usePostprocessMediaStore.getState())).toBe(false)

    usePostprocessMediaStore.getState().setSelectedCollectionIds(['builtin-product-a'])
    expect(isPostprocessReady(usePostprocessMediaStore.getState())).toBe(true)
    expect(isPostprocessReady(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })).toBe(true)

    // 只勾了不存在的媒体 + 无伴随 → 有项目也产不出东西
    usePostprocessMediaStore.getState().setSelectedMediaIds(['ghost'])
    usePostprocessMediaStore.getState().setAutoCompanionClean(false)
    expect(isPostprocessReady(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })).toBe(false)
  })
})

describe('产出命名', () => {
  it('按模板拼出媒体与尺寸段，方向缺省取尺寸推导值', () => {
    const name = buildPostprocessOutputName(
      { namePattern: DEFAULT_POSTPROCESS_NAME_PATTERN, creator: '杰哥' },
      { mediaName: '广点通', width: 1080, height: 1920, direction: 'portrait' },
      { product: '智能客服' },
      3,
      new Date(2026, 8, 17, 9, 0, 0).getTime(),
    )
    expect(name).toBe('20260917-智能客服-竖版-广点通-1080x1920-3')
  })

  it('项目树方向名优先于尺寸推导', () => {
    const name = buildPostprocessOutputName(
      { namePattern: '{direction}-{seq}', creator: '' },
      { mediaName: '百度', width: 1080, height: 1920, direction: 'portrait' },
      { direction: '竖构图' },
      1,
    )
    expect(name).toBe('竖构图-1')
  })
})

describe('产出计划的项目维度', () => {
  it('传入项目后按「项目 × 媒体」展开', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt'])
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 }, [
      { collectionId: 'c1', line: '线一', product: '品一', direction: '' },
      { collectionId: 'c2', line: '线二', product: '品二', direction: '' },
    ])
    // 每个项目都是「纯净版 + gdt 横版」两份
    expect(plan.units.map((unit) => unit.project?.collectionId)).toEqual(['c1', 'c1', 'c2', 'c2'])
    expect(plan.units.map((unit) => unit.mediaId)).toEqual(['clean', 'gdt', 'clean', 'gdt'])
  })

  it('不传项目时不展开（保持阶段二的旧行为）', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt'])
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })
    expect(plan.units.map((unit) => unit.mediaId)).toEqual(['clean', 'gdt'])
    expect('project' in plan.units[0]).toBe(false)
  })
})
