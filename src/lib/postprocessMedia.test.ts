import { describe, expect, it } from 'vitest'
import { DEFAULT_POSTPROCESS_DISTRIBUTION } from './postprocessDistribution'
import {
  DEFAULT_POSTPROCESS_MEDIA,
  DIRECTION_OPTIONS,
  MAX_POSTPROCESS_OUTPUT_DIRS,
  PURE_MEDIA_ID,
  applyPostprocessOverride,
  buildPostprocessOutputs,
  findPostprocessMedia,
  getOutputDirectionLabel,
  matchMediaSizes,
  normalizeOutputDirList,
  resolveOutputDirection,
  resolvePostprocessOutputDirs,
  type PostprocessMedia,
  type PostprocessMediaConfig,
  type PostprocessNodeOverride,
  type PostprocessProjectTarget,
} from './postprocessMedia'

describe('postprocess media table', () => {
  it('内置表为 4 媒体 / 15 尺寸，id 唯一且与宽高一致', () => {
    expect(DEFAULT_POSTPROCESS_MEDIA).toHaveLength(4)
    const sizes = DEFAULT_POSTPROCESS_MEDIA.flatMap((media) => media.sizes)
    expect(sizes).toHaveLength(15)
    expect(new Set(DEFAULT_POSTPROCESS_MEDIA.map((media) => media.id)).size).toBe(4)
    expect(new Set(sizes.map((size) => size.id)).size).toBe(15)
    for (const size of sizes) {
      expect(size.id).toMatch(new RegExp(`^[a-z]+-${size.width}x${size.height}$`))
      expect(size.maxSizeKb).toBeGreaterThan(0)
    }
  })
})

describe('resolveOutputDirection', () => {
  it('按宽高关系判定横竖方', () => {
    expect(resolveOutputDirection(1280, 720)).toBe('landscape')
    expect(resolveOutputDirection(1080, 1920)).toBe('portrait')
    expect(resolveOutputDirection(1024, 1024)).toBe('square')
  })

  it('给出中文展示名', () => {
    expect(getOutputDirectionLabel('landscape')).toBe('横版')
    expect(getOutputDirectionLabel('portrait')).toBe('竖版')
    expect(getOutputDirectionLabel('square')).toBe('方形')
  })
})

describe('matchMediaSizes', () => {
  const media = findPostprocessMedia(DEFAULT_POSTPROCESS_MEDIA, 'vendor')

  it('媒体不存在时返回空数组（不回退到第一个媒体）', () => {
    expect(matchMediaSizes(undefined, 'landscape')).toEqual([])
    // 渠道级「投不投」不在这里判（ADR-0013 删掉了渠道启用字段）：
    // 调用方只对 `selectedMediaIds` 里列出的渠道调本函数
    expect(matchMediaSizes({ id: 'empty', name: '没有启用尺寸', sizes: [] }, 'landscape')).toEqual([])
  })

  it('按方向筛出尺寸，且忽略停用的尺寸', () => {
    expect(matchMediaSizes(media, 'landscape').map((size) => size.id)).toEqual([
      'vendor-1280x720',
      'vendor-320x211',
      'vendor-320x210',
      'vendor-720x498',
      'vendor-1080x528',
    ])
    expect(matchMediaSizes(media, 'portrait').map((size) => size.id)).toEqual([
      'vendor-1080x1920',
      'vendor-720x1280',
      'vendor-474x768',
    ])
  })

  it('方向为 null 或方形时返回全部启用尺寸', () => {
    const all = [
      'vendor-1280x720',
      'vendor-1080x1920',
      'vendor-320x211',
      'vendor-320x210',
      'vendor-720x1280',
      'vendor-720x498',
      'vendor-474x768',
      'vendor-1080x528',
    ]
    expect(matchMediaSizes(media, null).map((size) => size.id)).toEqual(all)
    expect(matchMediaSizes(media, 'square').map((size) => size.id)).toEqual(all)
  })
})

describe('buildPostprocessOutputs', () => {
  it('横版源图产出各媒体的横版尺寸', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt', 'baidu', 'vendor', 'toutiao'],
      sourceWidth: 1280,
      sourceHeight: 720,
    })

    expect(plan.skippedMediaIds).toEqual([])
    expect(plan.units.map((unit) => unit.sizeId)).toEqual([
      'gdt-1280x720',
      'baidu-1140x640',
      'baidu-370x245',
      'vendor-1280x720',
      'vendor-320x211',
      'vendor-320x210',
      'vendor-720x498',
      'vendor-1080x528',
      'toutiao-1280x720',
    ])
    expect(plan.units.every((unit) => unit.clean === false)).toBe(true)
    expect(plan.units.map((unit) => unit.maxSizeKb)).toEqual([399, 299, 299, 99, 80, 80, 99, 99, 399])
  })

  it('竖版源图只产出竖版尺寸（同一媒体多个竖版尺寸全部产出）', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['vendor', 'baidu'],
      sourceWidth: 1024,
      sourceHeight: 1280,
    })

    expect(plan.units.map((unit) => unit.sizeId)).toEqual([
      'vendor-1080x1920',
      'vendor-720x1280',
      'vendor-474x768',
      'baidu-1080x1920',
    ])
    expect(plan.units.every((unit) => unit.direction === 'portrait')).toBe(true)
  })

  it('纯净版沿用生成尺寸且不压缩', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: [PURE_MEDIA_ID],
      sourceWidth: 1024,
      sourceHeight: 1024,
    })

    expect(plan.units).toEqual([
      {
        mediaId: 'clean',
        mediaName: '纯净版',
        sizeId: 'clean-1024x1024',
        width: 1024,
        height: 1024,
        maxSizeKb: 0,
        clean: true,
        direction: 'square',
      },
    ])
  })

  it('方向可手选覆盖自动判定', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt'],
      sourceWidth: 1280,
      sourceHeight: 720,
      direction: 'portrait',
    })

    expect(plan.units.map((unit) => unit.sizeId)).toEqual(['gdt-1080x1920'])
  })

  it('未知媒体显式跳过并上报，不回退到第一个媒体', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['not-a-channel'],
      sourceWidth: 1280,
      sourceHeight: 720,
    })

    expect(plan.units).toEqual([])
    expect(plan.skippedMediaIds).toEqual(['not-a-channel'])
  })

  it('去重勾选的媒体并保持首次出现顺序', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt', 'gdt', PURE_MEDIA_ID, 'clean'],
      sourceWidth: 1280,
      sourceHeight: 720,
    })

    expect(plan.units.map((unit) => unit.sizeId)).toEqual(['gdt-1280x720', 'clean-1280x720'])
  })

  it('源尺寸不可用时只跳过纯净版，渠道尺寸照常产出', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: [PURE_MEDIA_ID, 'gdt'],
      sourceWidth: Number.NaN,
      sourceHeight: 0,
    })

    expect(plan.units.map((unit) => unit.sizeId)).toEqual(['gdt-1280x720'])
  })

  it('渠道在表里、只是没有可用尺寸：不产出，也不算 skipped（渠道本身找到了）', () => {
    // 渠道级「投不投」由 `mediaIds` 决定（ADR-0013 删掉了渠道启用字段），
    // 这里钉住的是「找到了但没规格」与「压根找不到」的区别 —— 它们指向两种不同的排查方向
    const media: PostprocessMedia[] = [{ id: 'empty', name: '没配尺寸', sizes: [] }]
    const plan = buildPostprocessOutputs({
      mediaIds: ['empty'],
      media,
      sourceWidth: 1280,
      sourceHeight: 720,
    })

    expect(plan.units).toEqual([])
    expect(plan.skippedMediaIds).toEqual([])
  })

  it('媒体表里没有这个渠道：不产出，并计入 skipped（供界面提示配置写错）', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['ghost'],
      media: [{ id: 'gdt', name: '广点通', sizes: [] }],
      sourceWidth: 1280,
      sourceHeight: 720,
    })

    expect(plan.units).toEqual([])
    expect(plan.skippedMediaIds).toEqual(['ghost'])
  })
})

describe('buildPostprocessOutputs 的项目维度', () => {
  const projects: PostprocessProjectTarget[] = [
    { collectionId: 'p1', line: '智能客服', product: '机器人', direction: '竖版展示' },
    { collectionId: 'p2', line: '智能硬件', product: '音箱', direction: '' },
  ]

  it('按「项目 × 媒体 × 尺寸」展开，项目顺序即产出顺序', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt'],
      sourceWidth: 1280,
      sourceHeight: 720,
      projects,
    })

    expect(plan.units.map((unit) => [unit.project?.collectionId, unit.sizeId])).toEqual([
      ['p1', 'gdt-1280x720'],
      ['p2', 'gdt-1280x720'],
    ])
    expect(plan.units[0].project?.product).toBe('机器人')
    expect(plan.units[1].project?.direction).toBe('')
  })

  it('纯净版每个项目各产出一份（沿用各自的原图尺寸）', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: [PURE_MEDIA_ID],
      sourceWidth: 1080,
      sourceHeight: 1920,
      projects,
    })

    expect(plan.units.map((unit) => unit.project?.collectionId)).toEqual(['p1', 'p2'])
    expect(plan.units.every((unit) => unit.clean && unit.sizeId === 'clean-1080x1920')).toBe(true)
  })

  it('未传项目或传空数组时不展开，单元里不含 project 字段', () => {
    for (const input of [
      { mediaIds: ['gdt'], sourceWidth: 1280, sourceHeight: 720 },
      { mediaIds: ['gdt'], sourceWidth: 1280, sourceHeight: 720, projects: [] },
    ]) {
      const plan = buildPostprocessOutputs(input)
      expect(plan.units).toHaveLength(1)
      expect('project' in plan.units[0]).toBe(false)
    }
  })

  it('同一个找不到的媒体在多个项目下只上报一次', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['ghost'],
      sourceWidth: 1280,
      sourceHeight: 720,
      projects,
    })

    expect(plan.units).toEqual([])
    expect(plan.skippedMediaIds).toEqual(['ghost'])
  })

  it('媒体 id 在项目循环外先去重，避免逐项目重复产出', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt', 'gdt'],
      sourceWidth: 1280,
      sourceHeight: 720,
      projects,
    })

    expect(plan.units.map((unit) => unit.project?.collectionId)).toEqual(['p1', 'p2'])
  })
})

describe('多水印预设展开', () => {
  const watermarks = [
    { id: 'wm-a', name: '客户甲' },
    { id: 'wm-b', name: '客户乙' },
  ]

  it('配 N 个预设 → 每个渠道尺寸各出 N 份，单元各自带自己的预设', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt'],
      sourceWidth: 1280,
      sourceHeight: 720,
      watermarks,
    })

    // gdt 在横版下只有 1280x720 一个尺寸，所以 1 尺寸 × 2 预设 = 2 份
    expect(plan.units).toHaveLength(2)
    expect(plan.units.map((unit) => unit.watermark?.id)).toEqual(['wm-a', 'wm-b'])
    expect(plan.units.map((unit) => unit.watermark?.name)).toEqual(['客户甲', '客户乙'])
    expect(plan.units.every((unit) => unit.sizeId === 'gdt-1280x720')).toBe(true)
  })

  it('纯净版不随预设倍增：同一张原图只出一份', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: [PURE_MEDIA_ID],
      sourceWidth: 1024,
      sourceHeight: 1024,
      watermarks,
    })

    expect(plan.units).toHaveLength(1)
    expect(plan.units[0].clean).toBe(true)
    expect('watermark' in plan.units[0]).toBe(false)
  })

  it('不传预设时每个尺寸只出一份，且单元不含 watermark 字段', () => {
    for (const input of [
      { mediaIds: ['gdt'], sourceWidth: 1280, sourceHeight: 720 },
      { mediaIds: ['gdt'], sourceWidth: 1280, sourceHeight: 720, watermarks: [] },
    ]) {
      const plan = buildPostprocessOutputs(input)
      expect(plan.units).toHaveLength(1)
      expect('watermark' in plan.units[0]).toBe(false)
    }
  })

  it('预设按 id 去重、丢掉空 id，顺序即产出顺序', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt'],
      sourceWidth: 1280,
      sourceHeight: 720,
      watermarks: [
        { id: 'wm-b', name: '乙' },
        { id: 'wm-a', name: '甲' },
        { id: 'wm-b', name: '乙（重复）' },
        { id: '  ', name: '空 id' },
      ],
    })

    expect(plan.units.map((unit) => unit.watermark?.id)).toEqual(['wm-b', 'wm-a'])
  })

  it('预设与项目两个维度相乘：项目 × 尺寸 × 预设', () => {
    const plan = buildPostprocessOutputs({
      mediaIds: ['gdt'],
      sourceWidth: 1280,
      sourceHeight: 720,
      projects: [
        { collectionId: 'p1', line: 'L', product: 'P', direction: 'D1' },
        { collectionId: 'p2', line: 'L', product: 'P', direction: 'D2' },
      ],
      watermarks,
    })

    expect(plan.units).toHaveLength(4)
    expect(plan.units.map((unit) => `${unit.project?.collectionId}:${unit.watermark?.id}`)).toEqual([
      'p1:wm-a',
      'p1:wm-b',
      'p2:wm-a',
      'p2:wm-b',
    ])
  })
})

describe('applyPostprocessOverride —— 按渠道（byMedia）覆盖', () => {
  function baseConfig(): PostprocessMediaConfig {
    return {
      media: DEFAULT_POSTPROCESS_MEDIA,
      selectedMediaIds: ['clean'],
      selectedCollectionIds: [],
      direction: null,
      outputDir: '基线目录',
      mediaOutputDirs: {},
      namePattern: '{seq}',
      creator: '基线',
      watermarkPresetIds: ['基线水印'],
      autoCompanionClean: true,
      distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION },
    }
  }

  it('命中渠道优先于本级通用值', () => {
    const override: PostprocessNodeOverride = {
      outputDir: '通用目录',
      watermarkPresetIds: ['通用水印'],
      byMedia: { baidu: { outputDir: '百度目录', watermarkPresetIds: ['百度水印'] } },
    }
    const baidu = applyPostprocessOverride(baseConfig(), override, 'baidu')
    expect(baidu.outputDir).toBe('百度目录')
    expect(baidu.watermarkPresetIds).toEqual(['百度水印'])
  })

  it('未命中的渠道回退本级通用值，而不是回退基线', () => {
    const override: PostprocessNodeOverride = {
      outputDir: '通用目录',
      byMedia: { baidu: { outputDir: '百度目录' } },
    }
    expect(applyPostprocessOverride(baseConfig(), override, 'toutiao').outputDir).toBe('通用目录')
    // 本级连通用值都没写 → 才轮到基线
    expect(
      applyPostprocessOverride(baseConfig(), { byMedia: { baidu: { outputDir: 'x' } } }, 'toutiao').outputDir,
    ).toBe('基线目录')
  })

  it('不传 mediaId 时完全忽略 byMedia（既有调用点行为不变）', () => {
    const override: PostprocessNodeOverride = {
      outputDir: '通用目录',
      byMedia: { baidu: { outputDir: '百度目录' } },
    }
    expect(applyPostprocessOverride(baseConfig(), override).outputDir).toBe('通用目录')
  })

  it('渠道内的空串 / 空数组是有效值：合并用 ?? 而不是 ||', () => {
    const override: PostprocessNodeOverride = {
      outputDir: '通用目录',
      watermarkPresetIds: ['通用水印'],
      byMedia: { baidu: { outputDir: '', watermarkPresetIds: [] } },
    }
    const baidu = applyPostprocessOverride(baseConfig(), override, 'baidu')
    // 空串 = 用默认输出位置；空数组 = 这个渠道不加水印。两者都不能掉回通用值
    expect(baidu.outputDir).toBe('')
    expect(baidu.watermarkPresetIds).toEqual([])
  })

  it('⭐ 节点层不再能改已收归全局的字段（ADR-0011）', () => {
    // `creator` / `namePattern` 等已从 `PostprocessNodeOverride` 移除，节点只影响目录与水印。
    // 用 `as` 绕过类型（模拟旧数据 / JS 调用方），验证运行期也不会被采纳。
    const legacyOverride = {
      creator: '通用',
      namePattern: '{product}',
      byMedia: { baidu: { outputDir: '百度目录' } },
    } as unknown as PostprocessNodeOverride
    const baidu = applyPostprocessOverride(baseConfig(), legacyOverride, 'baidu')
    // 基线值原样保留，节点上的同名字段被忽略
    expect(baidu.creator).toBe(baseConfig().creator)
    expect(baidu.namePattern).toBe(baseConfig().namePattern)
  })

  it('不修改基线配置（纯函数）', () => {
    const config = baseConfig()
    applyPostprocessOverride(config, { byMedia: { baidu: { outputDir: '百度目录' } } }, 'baidu')
    expect(config.outputDir).toBe('基线目录')
  })

  it('override 为空时原样返回基线对象', () => {
    const config = baseConfig()
    expect(applyPostprocessOverride(config, undefined, 'baidu')).toBe(config)
  })
})

describe('导出位置：全局渠道表 + 双写', () => {
  function baseConfig(): PostprocessMediaConfig {
    return {
      media: DEFAULT_POSTPROCESS_MEDIA,
      selectedMediaIds: ['clean'],
      selectedCollectionIds: [],
      direction: null,
      outputDir: '全局默认目录',
      mediaOutputDirs: {},
      namePattern: '{seq}',
      creator: '',
      watermarkPresetIds: [],
      autoCompanionClean: true,
      distribution: { ...DEFAULT_POSTPROCESS_DISTRIBUTION },
    }
  }

  it('归一化：去空白、丢空串、去重、保序，最多两个', () => {
    expect(normalizeOutputDirList([' D:/a ', '', 'D:/a', 'D:/b'])).toEqual(['D:/a', 'D:/b'])
    expect(normalizeOutputDirList(['D:/a', 'D:/b', 'D:/c'])).toEqual(['D:/a', 'D:/b'])
    expect(normalizeOutputDirList(['  ', ''])).toEqual([])
    expect(normalizeOutputDirList(undefined)).toEqual([])
    expect(normalizeOutputDirList('D:/a')).toEqual([])
    expect(MAX_POSTPROCESS_OUTPUT_DIRS).toBe(2)
  })

  it('渠道命中时用渠道位置（含双写），否则回退全局默认位置', () => {
    const config = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/b1', 'D:/b2'] } }
    expect(resolvePostprocessOutputDirs(config, 'baidu')).toEqual(['D:/b1', 'D:/b2'])
    expect(resolvePostprocessOutputDirs(config, 'toutiao')).toEqual(['全局默认目录'])
    // 纯净版没有渠道，固定沿用默认位置
    expect(resolvePostprocessOutputDirs(config, PURE_MEDIA_ID)).toEqual(['全局默认目录'])
  })

  it('渠道表为空/空串时仍然回退全局默认位置（默认位置不会被弄丢）', () => {
    const config = { ...baseConfig(), mediaOutputDirs: { baidu: [] } }
    expect(resolvePostprocessOutputDirs(config, 'baidu')).toEqual(['全局默认目录'])
    expect(resolvePostprocessOutputDirs(baseConfig(), 'baidu')).toEqual(['全局默认目录'])
  })

  it('一个位置都没配时返回空列表（调用方据此落到本地默认目录）', () => {
    expect(resolvePostprocessOutputDirs({ ...baseConfig(), outputDir: '' }, 'baidu')).toEqual([])
  })

  it('节点通用目录覆盖全局渠道表（层级：节点 > 全局渠道 > 全局默认）', () => {
    const base = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/b'] } }
    const merged = applyPostprocessOverride(base, { outputDir: '节点目录' }, 'baidu')
    expect(resolvePostprocessOutputDirs(merged, 'baidu')).toEqual(['节点目录'])
  })

  it('节点按渠道的两个位置优先于节点通用值，且双写被完整保留', () => {
    const base = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/全局百度'] } }
    const override: PostprocessNodeOverride = {
      outputDir: '节点通用',
      byMedia: { baidu: { outputDirs: ['D:/节点百度一', 'D:/节点百度二'] } },
    }
    const merged = applyPostprocessOverride(base, override, 'baidu')
    expect(resolvePostprocessOutputDirs(merged, 'baidu')).toEqual(['D:/节点百度一', 'D:/节点百度二'])
    // 未命中的渠道仍走节点通用值
    expect(resolvePostprocessOutputDirs(applyPostprocessOverride(base, override, 'toutiao'), 'toutiao')).toEqual([
      '节点通用',
    ])
  })

  it('兼容旧的单值 outputDir（已导入的按渠道目录写在这个字段上）', () => {
    const merged = applyPostprocessOverride(baseConfig(), { byMedia: { baidu: { outputDir: 'D:/旧百度' } } }, 'baidu')
    expect(resolvePostprocessOutputDirs(merged, 'baidu')).toEqual(['D:/旧百度'])
  })

  it('outputDirs 优先于同一条里的旧单值 outputDir', () => {
    const merged = applyPostprocessOverride(
      baseConfig(),
      { byMedia: { baidu: { outputDir: 'D:/旧', outputDirs: ['D:/新一', 'D:/新二'] } } },
      'baidu',
    )
    expect(resolvePostprocessOutputDirs(merged, 'baidu')).toEqual(['D:/新一', 'D:/新二'])
  })

  it('节点显式清空 = 用默认位置，连全局渠道表一起让位', () => {
    const base = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/全局百度'] } }
    // 渠道行被清空（`outputDirs: []`）→ 落回全局面板里配的「默认输出目录」
    const byEmptyList = applyPostprocessOverride(base, { byMedia: { baidu: { outputDirs: [] } } }, 'baidu')
    expect(resolvePostprocessOutputDirs(byEmptyList, 'baidu')).toEqual(['全局默认目录'])
    // 旧数据的「节点通用字段写空串」：旧口径就是直接落本地默认目录，这里原样保留
    const byEmptyString = applyPostprocessOverride(base, { outputDir: '' }, 'baidu')
    expect(resolvePostprocessOutputDirs(byEmptyString, 'baidu')).toEqual([])
    expect(byEmptyString.outputDir).toBe('')
  })

  it('节点只清掉旧的单值字段时，全局渠道表随之生效', () => {
    const base = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/全局百度'] } }
    const merged = applyPostprocessOverride(base, { byMedia: { baidu: { outputDirs: undefined } } }, 'baidu')
    expect(resolvePostprocessOutputDirs(merged, 'baidu')).toEqual(['D:/全局百度'])
  })

  it('节点没表态时全局渠道表照旧生效', () => {
    const base = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/全局百度'] } }
    const merged = applyPostprocessOverride(base, { enabled: true }, 'baidu')
    expect(resolvePostprocessOutputDirs(merged, 'baidu')).toEqual(['D:/全局百度'])
  })

  it('不原地修改基线的渠道表（纯函数）', () => {
    const base = { ...baseConfig(), mediaOutputDirs: { baidu: ['D:/全局百度'] } }
    applyPostprocessOverride(base, { byMedia: { baidu: { outputDirs: ['D:/节点'] } } }, 'baidu')
    expect(base.mediaOutputDirs.baidu).toEqual(['D:/全局百度'])
  })
})

describe('DIRECTION_OPTIONS（画面方向选项的唯一来源）', () => {
  // 原先这份常量在参数元数据表里，方向选择控件（中控台「渠道与尺寸」）与它同源。
  // 参数表收窄为方向级后搬到这里，与 `OutputDirection` / `getOutputDirectionLabel` 同家。
  it('取值与顺序固定：跟随尺寸在最前（默认）', () => {
    expect(DIRECTION_OPTIONS.map((option) => option.value)).toEqual(['auto', 'landscape', 'portrait', 'square'])
    expect(DIRECTION_OPTIONS[0].label).toBe('跟随尺寸')
  })

  it('除 auto 外的每个取值都是真实方向，且中文名与 getOutputDirectionLabel 一致', () => {
    for (const option of DIRECTION_OPTIONS) {
      if (option.value === 'auto') continue
      expect(option.label).toBe(getOutputDirectionLabel(option.value))
    }
  })
})
