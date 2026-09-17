import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POSTPROCESS_MEDIA,
  PURE_MEDIA_ID,
  buildPostprocessOutputs,
  findPostprocessMedia,
  getOutputDirectionLabel,
  matchMediaSizes,
  resolveOutputDirection,
  type PostprocessMedia,
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

  it('媒体不存在或已停用时返回空数组', () => {
    expect(matchMediaSizes(undefined, 'landscape')).toEqual([])
    expect(matchMediaSizes({ id: 'off', name: '停用', enabled: false, sizes: [] }, 'landscape')).toEqual([])
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

  it('停用的媒体不产出也不计入 skipped', () => {
    const media: PostprocessMedia[] = [{ id: 'off', name: '停用渠道', enabled: false, sizes: [] }]
    const plan = buildPostprocessOutputs({
      mediaIds: ['off'],
      media,
      sourceWidth: 1280,
      sourceHeight: 720,
    })

    expect(plan.units).toEqual([])
    expect(plan.skippedMediaIds).toEqual([])
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
