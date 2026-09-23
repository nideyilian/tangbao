import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
import {
  DEFAULT_POSTPROCESS_FIT_MODE,
  DEFAULT_POSTPROCESS_MEDIA,
  PURE_MEDIA_ID,
  resolvePostprocessOutputDirs,
} from './lib/postprocessMedia'
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
    // 画面适配默认「裁剪填满」：与改动前写死在产出链路里的行为一致（默认改了就是改了所有人的产出）
    expect(state.fitMode).toBe(DEFAULT_POSTPROCESS_FIT_MODE)
    expect(state.namePattern).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN)
    expect(state.watermarkPresetIds).toEqual([])
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

describe('画面适配模式（fitMode，全局一套）', () => {
  it('setFitMode 写进 store，落盘快照与归一化往返都带得走', () => {
    usePostprocessMediaStore.getState().setFitMode('contain-blur')
    expect(usePostprocessMediaStore.getState().fitMode).toBe('contain-blur')

    const snapshot = getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState())
    expect(snapshot.fitMode).toBe('contain-blur')
    expect(normalizePostprocessMediaConfig(snapshot).fitMode).toBe('contain-blur')
  })

  it('旧数据没有这个字段 → 归一化补默认值，升级后产出观感不变', () => {
    expect(normalizePostprocessMediaConfig({}).fitMode).toBe(DEFAULT_POSTPROCESS_FIT_MODE)
  })

  it('坏值在归一化时回落默认值（中文标签是 Excel 里的写法，不是配置层的合法值）', () => {
    expect(normalizePostprocessMediaConfig({ fitMode: '模糊填充' }).fitMode).toBe(DEFAULT_POSTPROCESS_FIT_MODE)
    expect(normalizePostprocessMediaConfig({ fitMode: 42 }).fitMode).toBe(DEFAULT_POSTPROCESS_FIT_MODE)
    expect(normalizePostprocessMediaConfig({ fitMode: 'stretch' }).fitMode).toBe('stretch')
  })

  it('运行期传非法值时也落回默认值，不把坏值原样存进去', () => {
    usePostprocessMediaStore.getState().setFitMode('blur' as never)
    expect(usePostprocessMediaStore.getState().fitMode).toBe(DEFAULT_POSTPROCESS_FIT_MODE)
  })
})

describe('记住的产出目标（savedTargetCollectionIds）', () => {
  it('默认与旧数据都是空数组 = 按图片归属方向产出（与改动前的行为一致）', () => {
    expect(createDefaultPostprocessMediaConfig().savedTargetCollectionIds).toEqual([])
    expect(normalizePostprocessMediaConfig({}).savedTargetCollectionIds).toEqual([])
  })

  it('写入 → 快照 → 归一化往返都带得走（等价于「重启之后还在」）', () => {
    usePostprocessMediaStore.getState().setSavedTargetCollectionIds(['direction-a', 'direction-b'])
    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual(['direction-a', 'direction-b'])

    const snapshot = getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState())
    expect(snapshot.savedTargetCollectionIds).toEqual(['direction-a', 'direction-b'])
    expect(normalizePostprocessMediaConfig(snapshot).savedTargetCollectionIds).toEqual(['direction-a', 'direction-b'])
  })

  it('归一化去重、去空、丢非字符串；非数组落回空数组', () => {
    expect(
      normalizePostprocessMediaConfig({ savedTargetCollectionIds: ['a', 'a', '', ' b ', 7] }).savedTargetCollectionIds,
    ).toEqual(['a', 'b'])
    expect(
      normalizePostprocessMediaConfig({ savedTargetCollectionIds: 'direction-a' }).savedTargetCollectionIds,
    ).toEqual([])
  })

  it('clearSavedTargetCollectionIds 回到「按归属方向产出」', () => {
    usePostprocessMediaStore.getState().setSavedTargetCollectionIds(['direction-a'])
    usePostprocessMediaStore.getState().clearSavedTargetCollectionIds()
    expect(usePostprocessMediaStore.getState().savedTargetCollectionIds).toEqual([])
  })

  it('⭐ 落盘白名单（partialize）带上了这个字段', () => {
    // `partialize` 是**显式白名单**，类型系统管不到它：漏字段 = 点完「记住配置」当场生效、
    // 重启就没了，而界面上不报任何错（`appDataNamespaceContract` 只守 namespace，守不住字段）。
    // 测试环境没有存储后端（node 既无 localStorage 也无 electronAPI），拿不到运行期的白名单结果，
    // 所以照那个契约测试的做法读源码（全字段覆盖见文件末尾的守卫）。
    expect(readPersistedFields()).toContain('savedTargetCollectionIds')
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
      sizes: [],
    })

    expect(usePostprocessMediaStore.getState().addMedia('  ')).toBeNull()
    expect(usePostprocessMediaStore.getState().addMedia('重复 id', 'gdt')).toBeNull()
    expect(usePostprocessMediaStore.getState().media).toHaveLength(5)
  })

  it('改名（去空白，空名不生效）', () => {
    const store = usePostprocessMediaStore.getState()
    store.renameMedia('gdt', '  广点通广告位  ')
    expect(usePostprocessMediaStore.getState().media[0].name).toBe('广点通广告位')

    store.renameMedia('gdt', '   ')
    expect(usePostprocessMediaStore.getState().media[0].name).toBe('广点通广告位')
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
    // 渠道上不再有 `enabled` 字段（ADR-0013）——归一化不会把它带回来
    expect('enabled' in normalized.media[0]).toBe(false)
  })

  it('⭐ 旧的渠道「启用 = 否」折成「不参与产出」（ADR-0013 删字段时的一次性迁移）', () => {
    const normalized = normalizePostprocessMediaConfig({
      media: [
        { id: 'on', name: '在用的', enabled: true, sizes: [] },
        { id: 'off', name: '停用过的', enabled: false, sizes: [] },
      ],
      selectedMediaIds: [PURE_MEDIA_ID, 'on', 'off'],
    })

    // 字段本身消失：留着它就是一个界面上看不见、却能把渠道整个杀掉的开关
    expect(normalized.media[1]).toEqual({ id: 'off', name: '停用过的', sizes: [] })
    expect('enabled' in normalized.media[1]).toBe(false)
    // 但它当时表达的「不产出」必须保住 —— 直接从勾选里去掉，而不是让渠道悄悄复活
    expect(normalized.selectedMediaIds).toEqual([PURE_MEDIA_ID, 'on'])
  })

  it('非法方向归 null，非法选择列表走默认值', () => {
    expect(normalizePostprocessMediaConfig({ direction: 'diagonal' }).direction).toBeNull()
    expect(normalizePostprocessMediaConfig({ selectedCollectionIds: 'x' }).selectedCollectionIds).toEqual([])
    expect(normalizePostprocessMediaConfig({ selectedMediaIds: 'x' }).selectedMediaIds).toEqual([PURE_MEDIA_ID])
  })

  it('旧版单值 watermarkPresetId 迁移成数组（升级后不丢用户已配的水印）', () => {
    expect(normalizePostprocessMediaConfig({ watermarkPresetId: 'preset-a' }).watermarkPresetIds).toEqual(['preset-a'])
    expect(normalizePostprocessMediaConfig({ watermarkPresetId: null }).watermarkPresetIds).toEqual([])
    // 新字段存在时以新字段为准，不再看旧字段
    expect(
      normalizePostprocessMediaConfig({ watermarkPresetIds: ['preset-b'], watermarkPresetId: 'preset-a' })
        .watermarkPresetIds,
    ).toEqual(['preset-b'])
    // 去重与空值清理
    expect(normalizePostprocessMediaConfig({ watermarkPresetIds: ['a', 'a', '  ', 'b'] }).watermarkPresetIds).toEqual([
      'a',
      'b',
    ])
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
  it('⭐ 勾渠道媒体时不再自动补纯净版（2026-09-23 去掉「纯净版自动伴随」）', () => {
    // 纯净版产出的是「无水印 + 沿用生成尺寸 + 不压缩」的原图，而素材库里那张原图本来就是无水的，
    // 「勾了渠道就顺手多产一份」等于把原图有损重编一份白占磁盘 ⇒ 现在只在显式勾选时产出。
    usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt'])
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })
    expect(plan.units.map((unit) => unit.mediaId)).toEqual(['gdt'])
    expect(plan.skippedMediaIds).toEqual([])
  })

  it('显式勾选纯净版时排在渠道之前产出', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt', PURE_MEDIA_ID])
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })
    expect(plan.units[0]).toMatchObject({ mediaId: PURE_MEDIA_ID, clean: true, maxSizeKb: 0, width: 1280, height: 720 })
    expect(plan.units.slice(1).map((unit) => unit.sizeId)).toEqual(['gdt-1280x720'])
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
    // 没勾纯净版、也没有「自动伴随」了 ⇒ 一个单元都产不出来（这正是 skippedMediaIds 要提醒的事）
    expect(plan.units).toEqual([])
  })

  it('setSelectedMediaIds 会把悬空媒体清掉（纵深防御，避免脏选择落盘）', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['ghost', 'gdt'])
    expect(usePostprocessMediaStore.getState().selectedMediaIds).toEqual(['gdt'])
  })

  it('isPostprocessReady 只看渠道与可产出单元（不再要求勾项目）', () => {
    const store = usePostprocessMediaStore.getState()
    store.setSelectedMediaIds(['gdt'])
    // 一个方向都没勾也照样算「具备运行条件」：2026-09-23 撤掉了「启用范围」那层白名单，
    // 方向参不参与改由方向级开关决定（默认开），跑不跑由设置里的总开关决定。
    expect(isPostprocessReady(usePostprocessMediaStore.getState())).toBe(true)
    expect(isPostprocessReady(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })).toBe(true)

    // 只勾了不存在的媒体（悬空 id）→ 有配置也产不出东西
    usePostprocessMediaStore.getState().setSelectedMediaIds(['ghost'])
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
    // 每个项目只有勾选的 gdt 横版一份（纯净版不再自动伴随）
    expect(plan.units.map((unit) => unit.project?.collectionId)).toEqual(['c1', 'c2'])
    expect(plan.units.map((unit) => unit.mediaId)).toEqual(['gdt', 'gdt'])
  })

  it('不传项目时不展开（保持阶段二的旧行为）', () => {
    usePostprocessMediaStore.getState().setSelectedMediaIds(['gdt'])
    const plan = selectPostprocessOutputPlan(usePostprocessMediaStore.getState(), { width: 1280, height: 720 })
    expect(plan.units.map((unit) => unit.mediaId)).toEqual(['gdt'])
    expect('project' in plan.units[0]).toBe(false)
  })
})

describe('分发配置', () => {
  it('默认关闭，且快照里带着这一份配置', () => {
    expect(usePostprocessMediaStore.getState().distribution.enabled).toBe(false)
    expect(getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState()).distribution.enabled).toBe(false)
  })

  it('patchDistribution 只改传入的字段，其余保持', () => {
    usePostprocessMediaStore.getState().patchDistribution({ enabled: true, days: 7, skipWeekends: true })
    usePostprocessMediaStore.getState().patchDistribution({ days: 14 })

    const config = usePostprocessMediaStore.getState().distribution
    expect(config.enabled).toBe(true)
    expect(config.days).toBe(14)
    // 没传的字段保持上一次的值（不是被重置成默认）
    expect(config.skipWeekends).toBe(true)
  })

  it('patchDistribution 走归一化，挡住非法枚举与 0 天', () => {
    usePostprocessMediaStore.getState().patchDistribution({ days: 0, renameMode: 'uuid' } as never)

    const config = usePostprocessMediaStore.getState().distribution
    expect(config.days).toBe(1)
    expect(config.renameMode).toBe('date')
  })

  it('归一化持久化数据时把分发补成完整结构', () => {
    const config = normalizePostprocessMediaConfig({ distribution: { enabled: true } })
    expect(config.distribution.enabled).toBe(true)
    expect(config.distribution.days).toBe(1)
    expect(config.distribution.renameMode).toBe('date')
  })

  it('旧数据里的 startDate 不再出现在归一化结果里', () => {
    const config = normalizePostprocessMediaConfig({ distribution: { enabled: true, startDate: '20260901' } })
    expect(config.distribution.enabled).toBe(true)
    expect('startDate' in config.distribution).toBe(false)
  })
})

describe('渠道导出位置（双写）', () => {
  it('默认一个渠道都不单独指定（全部走默认输出目录）', () => {
    expect(usePostprocessMediaStore.getState().mediaOutputDirs).toEqual({})
  })

  it('逐槽写入：第二个位置可以单独写，不影响第一个', () => {
    const store = usePostprocessMediaStore.getState()
    store.setMediaOutputDir('baidu', 0, 'D:/百度一')
    store.setMediaOutputDir('baidu', 1, 'D:/百度二')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度一', 'D:/百度二'])
    // 其它渠道不受影响
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.gdt).toBeUndefined()
  })

  it('清掉第一个位置后第二个顶上（不留空洞），全空则整键删除', () => {
    const store = usePostprocessMediaStore.getState()
    store.setMediaOutputDir('baidu', 0, 'D:/百度一')
    store.setMediaOutputDir('baidu', 1, 'D:/百度二')
    store.setMediaOutputDir('baidu', 0, '')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toEqual(['D:/百度二'])
    store.setMediaOutputDir('baidu', 0, '')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.baidu).toBeUndefined()
  })

  it('去重：两个位置填同一个目录只留一个（双写同目录没有意义）', () => {
    const store = usePostprocessMediaStore.getState()
    store.setMediaOutputDir('gdt', 0, 'D:/同一个')
    store.setMediaOutputDir('gdt', 1, 'D:/同一个')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.gdt).toEqual(['D:/同一个'])
  })

  it('越界下标与空渠道 id 一律忽略，不抛错', () => {
    const store = usePostprocessMediaStore.getState()
    store.setMediaOutputDir('', 0, 'D:/x')
    store.setMediaOutputDir('gdt', -1, 'D:/x')
    store.setMediaOutputDir('gdt', 2, 'D:/x')
    store.setMediaOutputDir('gdt', 1.5, 'D:/x')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs).toEqual({})
  })

  it('clearMediaOutputDirs 把某个渠道整体恢复到默认位置', () => {
    const store = usePostprocessMediaStore.getState()
    store.setMediaOutputDir('toutiao', 0, 'D:/头条一')
    store.setMediaOutputDir('toutiao', 1, 'D:/头条二')
    store.clearMediaOutputDirs('toutiao')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.toutiao).toBeUndefined()
  })

  it('删除渠道时连带删掉它的导出位置（不留悬空键）', () => {
    const store = usePostprocessMediaStore.getState()
    store.setMediaOutputDir('gdt', 0, 'D:/广点通')
    store.deleteMedia('gdt')
    expect(usePostprocessMediaStore.getState().mediaOutputDirs.gdt).toBeUndefined()
  })

  it('进落盘快照且在归一化（读盘/恢复备份）后原样保留', () => {
    const store = usePostprocessMediaStore.getState()
    store.setMediaOutputDir('baidu', 0, 'D:/百度一')
    store.setMediaOutputDir('baidu', 1, 'D:/百度二')
    store.setOutputDir('D:/默认目录')

    const snapshot = getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState())
    expect(snapshot.mediaOutputDirs).toEqual({ baidu: ['D:/百度一', 'D:/百度二'] })

    const restored = normalizePostprocessMediaConfig(snapshot)
    expect(restored.mediaOutputDirs).toEqual({ baidu: ['D:/百度一', 'D:/百度二'] })
    expect(restored.outputDir).toBe('D:/默认目录')
  })

  it('坏数据（数组、非字符串项、空串、超过两个）在归一化时被清掉', () => {
    expect(normalizePostprocessMediaConfig({ mediaOutputDirs: ['D:/x'] }).mediaOutputDirs).toEqual({})
    expect(normalizePostprocessMediaConfig({ mediaOutputDirs: { baidu: 'D:/x' } }).mediaOutputDirs).toEqual({})
    expect(normalizePostprocessMediaConfig({ mediaOutputDirs: { baidu: ['', '  '] } }).mediaOutputDirs).toEqual({})
    expect(
      normalizePostprocessMediaConfig({ mediaOutputDirs: { baidu: [1, 'D:/a'], gdt: ['D:/b', 'D:/c', 42] } })
        .mediaOutputDirs,
    ).toEqual({ baidu: ['D:/a'], gdt: ['D:/b', 'D:/c'] })
  })

  it('恢复备份时渠道导出位置一起回来', () => {
    restorePostprocessMediaConfig({ mediaOutputDirs: { baidu: ['D:/备份'] }, outputDir: 'D:/备份默认' })
    expect(usePostprocessMediaStore.getState().mediaOutputDirs).toEqual({ baidu: ['D:/备份'] })
    expect(resolveSub(usePostprocessMediaStore.getState())).toEqual(['D:/备份'])
  })
})

/** 取某渠道最终生效的导出位置列表（`resolvePostprocessOutputDirs` 的薄封装，避免测试里重复拼参） */
function resolveSub(config: Parameters<typeof getPostprocessMediaConfigSnapshot>[0], mediaId = 'baidu') {
  return resolvePostprocessOutputDirs(getPostprocessMediaConfigSnapshot(config), mediaId)
}

// ---------------------------------------------------------------------------
// 落盘白名单契约
//
// `partialize` 决定哪些字段真能落盘，是**手写的显式白名单**：类型系统不会因为
// `PostprocessMediaConfig` 多了个字段就报错，漏字段的症状是「界面上改完当场生效、重启就没了」，
// 而且**一声不响** —— 与 namespace 漏配同一族（见 `appDataNamespaceContract.test.ts`）。
// node 环境没有存储后端，拿不到运行期的白名单结果，所以照那个契约测试读源码做守卫。
// ---------------------------------------------------------------------------

const STORE_SOURCE = readFileSync(fileURLToPath(new URL('./storePostprocessMedia.ts', import.meta.url)), 'utf8')

/** `partialize: (state) => ({ … })` 里列出的字段名（形如 `namePattern: state.namePattern`）。 */
function readPersistedFields(): string[] {
  const start = STORE_SOURCE.indexOf('partialize:')
  if (start < 0) throw new Error('未找到 partialize，请同步更新本守卫')
  const end = STORE_SOURCE.indexOf('}),', start)
  if (end < 0) throw new Error('partialize 定义不完整，请同步更新本守卫')
  return [...STORE_SOURCE.slice(start, end).matchAll(/^\s+(\w+): state\./gm)].map((match) => match[1])
}

describe('落盘白名单契约（partialize）', () => {
  it('守卫本身有覆盖面，避免解析规则与源码格式脱节后静默失效', () => {
    // 与 `appDataNamespaceContract` 同一条自检：解析不出东西时下一条断言会恒真
    expect(readPersistedFields().length).toBeGreaterThan(5)
  })

  it('配置里的每个字段都在白名单里（谁加了字段却没进白名单，这里立刻红）', () => {
    const persisted = new Set(readPersistedFields())
    const missing = Object.keys(createDefaultPostprocessMediaConfig()).filter((key) => !persisted.has(key))

    expect(missing).toEqual([])
  })
})
