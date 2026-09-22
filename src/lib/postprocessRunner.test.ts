import { describe, expect, it } from 'vitest'
import {
  POSTPROCESS_OUTPUT_EXTENSION,
  buildSourceVariantPlans,
  shouldCompressPostprocessUnit,
  type PostprocessSourceImage,
} from './postprocessRunner'
import { PURE_MEDIA_ID, type PostprocessOutputUnit, type PostprocessProjectTarget } from './postprocessMedia'

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

/** 造一个项目目标；方向名走 `{product}` 段，方便用例里认人。 */
function makeProject(collectionId: string, product: string): PostprocessProjectTarget {
  return { collectionId, line: '', product, direction: '横构图' }
}

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

describe('buildSourceVariantPlans', () => {
  it('不同文件夹各自从 1 开始编号（序号按文件夹分组，不共用一个计数器）', () => {
    const { plans, nextSequences } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      units: [
        makeUnit({ sizeId: 'baidu-1140x640', mediaName: '百度', width: 1140, height: 640 }),
        makeUnit({ sizeId: 'gdt-1280x720', mediaId: 'gdt', mediaName: '广点通', width: 1280, height: 720 }),
      ],
    })

    // 两个单元落在**不同文件夹**（百度-1140x640 / 广点通-1280x720）→ 各自从 1 起。
    // 2026-09-22 之前这里是整批一个计数器，第二个单元会拿到 `-2`（见 TB-104）。
    expect(plans.map((plan) => plan.fileName)).toEqual([
      `百度-1140x640-1.${POSTPROCESS_OUTPUT_EXTENSION}`,
      `广点通-1280x720-1.${POSTPROCESS_OUTPUT_EXTENSION}`,
    ])
    expect(nextSequences).toEqual({ '百度-1140x640': 2, '广点通-1280x720': 2 })
  })

  it('⭐ 某个方向多勾一个渠道，别的方向的序号不受影响（TB-104 的核心诉求）', () => {
    const unitOf = (
      project: PostprocessProjectTarget,
      mediaName: string,
      sizeId: string,
      width: number,
      height: number,
    ) => makeUnit({ project, mediaName, sizeId, width, height })
    const projectA = makeProject('a', '产品A')
    const projectB = makeProject('b', '产品B')

    // 改配置前：只有 B 方向出一个渠道
    const before = buildSourceVariantPlans({
      source,
      config: shortPattern,
      units: [unitOf(projectB, '百度', 'baidu-1140x640', 1140, 640)],
    })
    // 改配置后：A 方向多勾了一个渠道 —— A 的产出量变了，但 B 的号不该跟着串
    const after = buildSourceVariantPlans({
      source,
      config: shortPattern,
      units: [
        unitOf(projectA, '百度', 'baidu-1140x640', 1140, 640),
        unitOf(projectA, '广点通', 'gdt-1280x720', 1280, 720),
        unitOf(projectB, '百度', 'baidu-1140x640', 1140, 640),
      ],
    })

    expect(before.plans[0].fileName).toBe(`产品B-百度-1140x640-1.${POSTPROCESS_OUTPUT_EXTENSION}`)
    // 整批共用一个计数器时这里是 `-3`（被 A 的两个单元吃掉了 1、2）—— 反向验证就靠这条
    expect(after.plans[2].fileName).toBe(`产品B-百度-1140x640-1.${POSTPROCESS_OUTPUT_EXTENSION}`)
    expect(after.plans[0].fileName).toBe(`产品A-百度-1140x640-1.${POSTPROCESS_OUTPUT_EXTENSION}`)
    expect(after.plans[1].fileName).toBe(`产品A-广点通-1280x720-1.${POSTPROCESS_OUTPUT_EXTENSION}`)
  })

  it('同一文件夹内跨源图接着编号，一次生成多张图时不会同名覆盖', () => {
    const first = buildSourceVariantPlans({ source, config: shortPattern, units: [makeUnit()] })
    const second = buildSourceVariantPlans({
      source: { ...source, imageId: 'img-2', index: 1 },
      config: shortPattern,
      startSequences: first.nextSequences,
      units: [makeUnit()],
    })

    expect(second.plans[0].fileName).toBe(`百度-1140x640-2.${POSTPROCESS_OUTPUT_EXTENSION}`)
  })

  it('不修改传入的序号表（调用方会把上次返回的对象原样传回来）', () => {
    const startSequences = { '百度-1140x640': 5 }
    buildSourceVariantPlans({ source, config: shortPattern, startSequences, units: [makeUnit()] })

    expect(startSequences).toEqual({ '百度-1140x640': 5 })
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
    const { plans } = buildSourceVariantPlans({ source, config: shortPattern, units: [cleanUnit] })

    expect(plans).toHaveLength(1)
    expect(plans[0].compress).toBe(false)
    expect(plans[0].unit.clean).toBe(true)
  })

  it('渠道单元按 maxSizeKb 标记为需要压缩', () => {
    const { plans } = buildSourceVariantPlans({ source, config: shortPattern, units: [makeUnit()] })
    expect(plans[0].compress).toBe(true)
  })

  it('项目树方向名优先于尺寸推导', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: { namePattern: '{direction}', creator: '' },
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
      units: [makeUnit({ direction: 'portrait' })],
    })

    expect(plans[0].fileName).toBe(`竖版.${POSTPROCESS_OUTPUT_EXTENSION}`)
  })

  it('⭐ 文件夹名 = 文件名去掉序号（同一批的多个序号因此落进同一个文件夹）', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      units: [
        makeUnit({ project: { collectionId: 'd', line: '线A', product: '产品1', direction: '横构图' } }),
        makeUnit({ sizeId: 'gdt-1280x720', width: 1280, height: 720 }),
      ],
    })

    expect(plans.map((plan) => plan.fileName)).toEqual(['产品1-百度-1140x640-1.jpg', '百度-1280x720-1.jpg'])
    expect(plans.map((plan) => plan.subFolders)).toEqual([['产品1-百度-1140x640'], ['百度-1280x720']])
    // 两者必须同源：文件夹名就是文件名去掉末尾 `-序号`，模板里没有的段两边都不会有
    for (const plan of plans) {
      const base = plan.fileName.replace(`.${POSTPROCESS_OUTPUT_EXTENSION}`, '')
      expect(plan.subFolders[0]).toBe(base.replace(/-\d+$/, ''))
    }
  })

  it('某个文件夹的起始序号非法时兜底为 1', () => {
    const { plans, nextSequences } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequences: { '百度-1140x640': Number.NaN },
      units: [makeUnit()],
    })

    expect(plans[0].fileName).toBe(`百度-1140x640-1.${POSTPROCESS_OUTPUT_EXTENSION}`)
    expect(nextSequences).toEqual({ '百度-1140x640': 2 })
  })

  it('单元为空时不产出也不推进序号', () => {
    const { plans, nextSequences } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      startSequences: { '百度-1140x640': 7 },
      units: [],
    })

    expect(plans).toEqual([])
    expect(nextSequences).toEqual({ '百度-1140x640': 7 })
  })

  it('源图标识透传到每个单元', () => {
    const { plans } = buildSourceVariantPlans({
      source: { imageId: 'img-9', index: 3, width: 1024, height: 1024 },
      config: shortPattern,
      units: [makeUnit(), makeUnit({ sizeId: 'gdt-1280x720' })],
    })

    expect(plans.map((plan) => plan.sourceImageId)).toEqual(['img-9', 'img-9'])
    expect(plans.map((plan) => plan.sourceIndex)).toEqual([3, 3])
  })
})

describe('多水印预设时的文件夹归属', () => {
  const watermarks = [
    { id: 'wm-a', name: '客户甲' },
    { id: 'wm-b', name: '客户乙' },
  ]

  it('模板里没写 {preset} 时分到同一个文件夹，靠文件名末尾的序号区分', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      units: [makeUnit({ watermark: watermarks[0] }), makeUnit({ watermark: watermarks[1] })],
    })

    // 2026-09-21 起文件夹名与文件名同源：模板没写 {preset}，两套水印就不分层
    // （原先只要同一批里有 >1 套水印，就会自动追加一层预设名子目录）
    expect(plans.map((plan) => plan.subFolders)).toEqual([['百度-1140x640'], ['百度-1140x640']])
    expect(plans.map((plan) => plan.fileName)).toEqual(['百度-1140x640-1.jpg', '百度-1140x640-2.jpg'])
  })

  it('模板里写了 {preset} 时文件名与文件夹名都带预设名（要分开就写进模板）', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: { namePattern: '{media}-{size}-{preset}-{seq}', creator: '' },
      units: [makeUnit({ watermark: watermarks[0] }), makeUnit({ watermark: watermarks[1] })],
    })

    expect(plans.map((plan) => plan.subFolders)).toEqual([['百度-1140x640-客户甲'], ['百度-1140x640-客户乙']])
    // 分到两个文件夹 → 各自从 1 起（不再一个 1、一个 2）
    expect(plans.map((plan) => plan.fileName)).toEqual(['百度-1140x640-客户甲-1.jpg', '百度-1140x640-客户乙-1.jpg'])
  })

  it('纯净版（不叠水印）的文件夹名照旧不含预设名', () => {
    const { plans } = buildSourceVariantPlans({
      source,
      config: shortPattern,
      units: [makeUnit({ clean: true, maxSizeKb: 0 }), makeUnit({ watermark: watermarks[0] })],
    })

    expect(plans.map((plan) => plan.subFolders)).toEqual([['百度-1140x640'], ['百度-1140x640']])
  })
})
