import { describe, expect, it } from 'vitest'
import {
  POSTPROCESS_OUTPUT_EXTENSION,
  buildSourceVariantPlans,
  resolvePostprocessSubFolders,
  shouldCompressPostprocessUnit,
  type PostprocessSourceImage,
} from './postprocessRunner'
import { PURE_MEDIA_ID, type PostprocessOutputUnit } from './postprocessMedia'

function makeUnit(patch: Partial<PostprocessOutputUnit> = {}): PostprocessOutputUnit {
  return {
    mediaId: 'baidu',
    mediaName: '百度',
    sizeId: 'baidu-1140x640',
    width: 1140,
    height: 640,
    maxSizeKb: 299,
    clean: false,
    direction: 'landscape',
    ...patch,
  }
}

const source: PostprocessSourceImage = { imageId: 'img-1', index: 0, width: 2048, height: 1152 }

const shortPattern = { namePattern: '{product}-{media}-{size}-{seq}', creator: '' }

describe('shouldCompressPostprocessUnit', () => {
  it('maxSizeKb 为 0 表示不限体积，不算压缩', () => {
    expect(shouldCompressPostprocessUnit({ maxSizeKb: 0 })).toBe(false)
  })

  it('正数上限算压缩', () => {
    expect(shouldCompressPostprocessUnit({ maxSizeKb: 299 })).toBe(true)
  })

  it('非法值按不压缩处理，避免把 NaN 带进体积二分搜索', () => {
    expect(shouldCompressPostprocessUnit({ maxSizeKb: Number.NaN })).toBe(false)
  })
})

describe('resolvePostprocessSubFolders', () => {
  it('项目三级逐级建目录', () => {
    const folders = resolvePostprocessSubFolders(
      makeUnit({ project: { collectionId: 'd', line: '线A', product: '产品1', direction: '横构图' } }),
    )
    expect(folders).toEqual(['线A', '产品1', '横构图'])
  })

  it('只勾到二级时不留下空目录', () => {
    const folders = resolvePostprocessSubFolders(
      makeUnit({ project: { collectionId: 'p', line: '线A', product: '产品1', direction: '' } }),
    )
    expect(folders).toEqual(['线A', '产品1'])
  })

  it('无项目维度时平铺到输出根', () => {
    expect(resolvePostprocessSubFolders(makeUnit())).toEqual([])
  })
})

describe('buildSourceVariantPlans', () => {
  it('文件名带扩展名，序号按单元顺序连续递增', () => {
    const { plans, nextSequence } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequence: 1,
      units: [
        makeUnit({ sizeId: 'baidu-1140x640', mediaName: '百度', width: 1140, height: 640 }),
        makeUnit({ sizeId: 'gdt-1280x720', mediaId: 'gdt', mediaName: '广点通', width: 1280, height: 720 }),
      ],
    })

    expect(plans.map((plan) => plan.fileName)).toEqual([
      `百度-1140x640-1.${POSTPROCESS_OUTPUT_EXTENSION}`,
      `广点通-1280x720-2.${POSTPROCESS_OUTPUT_EXTENSION}`,
    ])
    expect(nextSequence).toBe(3)
  })

  it('跨源图续号，一次生成多张图时不会同名覆盖', () => {
    const first = buildSourceVariantPlans({ source, config: shortPattern, startSequence: 1, units: [makeUnit()] })
    const second = buildSourceVariantPlans({
      source: { ...source, imageId: 'img-2', index: 1 },
      config: shortPattern,
      startSequence: first.nextSequence,
      units: [makeUnit()],
    })

    expect(second.plans[0].fileName).toBe(`百度-1140x640-2.${POSTPROCESS_OUTPUT_EXTENSION}`)
  })

  it('纯净版不限体积，不参与体积二分', () => {
    const cleanUnit = makeUnit({
      mediaId: PURE_MEDIA_ID,
      mediaName: '纯净版',
      width: 2048,
      height: 1152,
      maxSizeKb: 0,
      clean: true,
    })
    const { plans } = buildSourceVariantPlans({ source, config: shortPattern, startSequence: 1, units: [cleanUnit] })

    expect(plans).toHaveLength(1)
    expect(plans[0].compress).toBe(false)
    expect(plans[0].unit.clean).toBe(true)
  })

  it('渠道单元按 maxSizeKb 标记为需要压缩', () => {
    const { plans } = buildSourceVariantPlans({ source, config: shortPattern, startSequence: 1, units: [makeUnit()] })
    expect(plans[0].compress).toBe(true)
  })

  it('项目树方向名优先于尺寸推导', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: { namePattern: '{direction}', creator: '' },
      startSequence: 1,
      units: [
        makeUnit({
          direction: 'landscape',
          project: { collectionId: 'd', line: '', product: '', direction: '横构图' },
        }),
      ],
    })

    expect(plans[0].fileName).toBe(`横构图.${POSTPROCESS_OUTPUT_EXTENSION}`)
  })

  it('缺项目方向名时回退到按尺寸推导的中文方向', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: { namePattern: '{direction}', creator: '' },
      startSequence: 1,
      units: [makeUnit({ direction: 'portrait' })],
    })

    expect(plans[0].fileName).toBe(`竖版.${POSTPROCESS_OUTPUT_EXTENSION}`)
  })

  it('项目路径随单元带出到子目录', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequence: 1,
      units: [
        makeUnit({ project: { collectionId: 'd', line: '线A', product: '产品1', direction: '横构图' } }),
        makeUnit({ sizeId: 'gdt-1280x720', width: 1280, height: 720 }),
      ],
    })

    expect(plans[0].subFolders).toEqual(['线A', '产品1', '横构图'])
    expect(plans[1].subFolders).toEqual([])
  })

  it('起始序号非法时兜底为 1', () => {
    const { plans, nextSequence } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequence: Number.NaN,
      units: [makeUnit()],
    })

    expect(plans[0].fileName).toBe(`百度-1140x640-1.${POSTPROCESS_OUTPUT_EXTENSION}`)
    expect(nextSequence).toBe(2)
  })

  it('单元为空时不产出也不推进序号', () => {
    const { plans, nextSequence } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequence: 7,
      units: [],
    })

    expect(plans).toEqual([])
    expect(nextSequence).toBe(7)
  })

  it('源图标识透传到每个单元', () => {
    const { plans } = buildSourceVariantPlans({
      source: { imageId: 'img-9', index: 3, width: 1024, height: 1024 },
      config: shortPattern,
      startSequence: 1,
      units: [makeUnit(), makeUnit({ sizeId: 'gdt-1280x720' })],
    })

    expect(plans.map((plan) => plan.sourceImageId)).toEqual(['img-9', 'img-9'])
    expect(plans.map((plan) => plan.sourceIndex)).toEqual([3, 3])
  })
})

describe('多水印预设的子目录分层', () => {
  const watermarks = [
    { id: 'wm-a', name: '客户甲' },
    { id: 'wm-b', name: '客户乙' },
  ]

  it('resolvePostprocessSubFolders 只在要求时追加预设层，无预设的单元不受影响', () => {
    const project = { collectionId: 'c1', line: 'L', product: 'P', direction: 'D' }
    expect(resolvePostprocessSubFolders(makeUnit({ project }))).toEqual(['L', 'P', 'D'])
    expect(resolvePostprocessSubFolders(makeUnit({ project, watermark: watermarks[0] }))).toEqual(['L', 'P', 'D'])
    expect(
      resolvePostprocessSubFolders(makeUnit({ project, watermark: watermarks[0] }), { includePresetFolder: true }),
    ).toEqual(['L', 'P', 'D', '客户甲'])
  })

  it('单预设不额外分层，保持既有目录结构', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequence: 1,
      units: [makeUnit({ watermark: watermarks[0] })],
    })

    expect(plans[0].subFolders).toEqual([])
  })

  it('多预设时按预设名分子目录，不再靠后缀兜底区分', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequence: 1,
      units: [makeUnit({ watermark: watermarks[0] }), makeUnit({ watermark: watermarks[1] })],
    })

    expect(plans.map((plan) => plan.subFolders)).toEqual([['客户甲'], ['客户乙']])
  })

  it('纯净版混在多预设里时仍不进预设子目录', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequence: 1,
      units: [
        makeUnit({ clean: true, maxSizeKb: 0 }),
        makeUnit({ watermark: watermarks[0] }),
        makeUnit({ watermark: watermarks[1] }),
      ],
    })

    expect(plans.map((plan) => plan.subFolders)).toEqual([[], ['客户甲'], ['客户乙']])
  })
})
