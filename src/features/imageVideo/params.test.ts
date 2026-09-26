import { describe, expect, it } from 'vitest'
import {
  buildEngineConfig,
  normalizeImageVideoOverride,
  normalizeImageVideoParams,
  resolveImageVideoParams,
  resolveVideoOutputDir,
  summarizeImageVideoParams,
} from './params'
import { DEFAULT_IMAGE_VIDEO_PARAMS, type ImageVideoParams } from './types'

const BASE: ImageVideoParams = { ...DEFAULT_IMAGE_VIDEO_PARAMS }

describe('normalizeImageVideoOverride', () => {
  it('只保留真的表了态的字段（空串与 undefined 一律丢弃，等于继续继承）', () => {
    const override = normalizeImageVideoOverride({
      imagesPerVideo: 4,
      filePrefix: '',
      outputDir: '   ',
      resolution: undefined,
    })
    expect(override).toEqual({ imagesPerVideo: 4 })
    expect('filePrefix' in override).toBe(false)
    expect('outputDir' in override).toBe(false)
  })

  it('数值越界钳到范围内而不是丢弃 —— 界面显示的值必须与实际生效的值一致', () => {
    expect(normalizeImageVideoOverride({ imagesPerVideo: 9999 })).toEqual({ imagesPerVideo: 200 })
    expect(normalizeImageVideoOverride({ fps: 0 })).toEqual({ fps: 1 })
    expect(normalizeImageVideoOverride({ secondsPerImage: '2.5' })).toEqual({ secondsPerImage: 2.5 })
  })

  it('非数字（打错的内容）当作没表态', () => {
    expect(normalizeImageVideoOverride({ imagesPerVideo: 'abc' })).toEqual({})
    expect(normalizeImageVideoOverride({ imagesPerVideo: Number.NaN })).toEqual({})
  })

  it('名单外的字符串一律拒绝 —— 引擎对未知转场名是静默跳过，放过去就成了「选了不生效」', () => {
    expect(normalizeImageVideoOverride({ transitionType: '不存在的转场' })).toEqual({})
    expect(normalizeImageVideoOverride({ effectType: '不存在' })).toEqual({})
    expect(normalizeImageVideoOverride({ resolution: '999x999' })).toEqual({})
    expect(normalizeImageVideoOverride({ imageSelection: '顺序选择' })).toEqual({})
  })

  it('名单内的字符串按原样保留', () => {
    expect(normalizeImageVideoOverride({ transitionType: '交叉溶解' })).toEqual({ transitionType: '交叉溶解' })
    expect(normalizeImageVideoOverride({ resolution: '1080x1920' })).toEqual({ resolution: '1080x1920' })
    expect(normalizeImageVideoOverride({ imageSelection: '按子文件夹抽取' })).toEqual({
      imageSelection: '按子文件夹抽取',
    })
  })

  it('转场/效果三态只认 off / fixed / random', () => {
    expect(normalizeImageVideoOverride({ transitionMode: 'random' })).toEqual({ transitionMode: 'random' })
    expect(normalizeImageVideoOverride({ transitionMode: '关闭' })).toEqual({})
  })

  it('enabled 缺省时不算表态（继承上层），显式 false 才算', () => {
    expect(normalizeImageVideoOverride({})).toEqual({})
    expect(normalizeImageVideoOverride({ enabled: false })).toEqual({ enabled: false })
    expect(normalizeImageVideoOverride({ enabled: true })).toEqual({ enabled: true })
  })

  it('前缀会过文件名清洗（它要参与拼文件名）', () => {
    expect(normalizeImageVideoOverride({ filePrefix: 'a/b:c*' })).toEqual({ filePrefix: 'a-b-c' })
  })

  it('前缀全是非法字符时视为没表态，而不是留下一个空的「显式覆盖」', () => {
    expect(normalizeImageVideoOverride({ filePrefix: '***' })).toEqual({})
  })

  it('非对象输入返回空覆盖，不抛', () => {
    expect(normalizeImageVideoOverride(null)).toEqual({})
    expect(normalizeImageVideoOverride('x')).toEqual({})
    expect(normalizeImageVideoOverride([1, 2])).toEqual({})
  })
})

describe('normalizeImageVideoParams（全局基线）', () => {
  it('缺字段落默认值，得到完整配置', () => {
    expect(normalizeImageVideoParams({ imagesPerVideo: 3 })).toEqual({ ...BASE, imagesPerVideo: 3 })
  })

  it('落盘数据被改坏时也能兜住', () => {
    expect(normalizeImageVideoParams(null)).toEqual(BASE)
    expect(normalizeImageVideoParams({ fps: 'x', resolution: 'bad' })).toEqual(BASE)
  })
})

describe('resolveImageVideoParams（继承链）', () => {
  it('后出现的覆盖先出现的，根在前、自身在最后', () => {
    const resolved = resolveImageVideoParams([{ imagesPerVideo: 10, fps: 24 }, { imagesPerVideo: 4 }])
    expect(resolved.imagesPerVideo).toBe(4)
    expect(resolved.fps).toBe(24)
  })

  it('空覆盖不破坏继承 —— 这是「节点没表态」的唯一表达方式', () => {
    const resolved = resolveImageVideoParams([{ fps: 60 }, normalizeImageVideoOverride({ fps: '' })])
    expect(resolved.fps).toBe(60)
  })

  it('整条链为空时就是默认值', () => {
    expect(resolveImageVideoParams([])).toEqual(BASE)
  })

  it('覆盖只影响自己那层，不污染默认值对象', () => {
    resolveImageVideoParams([{ imagesPerVideo: 99 }])
    expect(DEFAULT_IMAGE_VIDEO_PARAMS.imagesPerVideo).toBe(6)
  })
})

describe('buildEngineConfig', () => {
  const paths = { inputDir: 'D:/导出/方向A', outputDir: 'D:/导出/方向A-视频' }

  it('三个固定关掉的开关：引擎自带的水印与 BGM 不能悄悄生效', () => {
    const config = buildEngineConfig(BASE, paths)
    expect(config.use_watermark).toBe(false)
    expect(config.use_image_watermark).toBe(false)
    expect(config.watermark_layers).toEqual([])
    expect(config.use_bgm).toBe(false)
  })

  it('转场三态映射到引擎的两个布尔', () => {
    const off = buildEngineConfig({ ...BASE, transitionMode: 'off' }, paths)
    expect(off.use_transition).toBe(false)
    expect(off.random_transition).toBe(false)

    const fixed = buildEngineConfig({ ...BASE, transitionMode: 'fixed', transitionType: '交叉溶解' }, paths)
    expect(fixed.use_transition).toBe(true)
    expect(fixed.random_transition).toBe(false)
    expect(fixed.transition_type).toBe('交叉溶解')

    const random = buildEngineConfig({ ...BASE, transitionMode: 'random' }, paths)
    expect(random.use_transition).toBe(true)
    expect(random.random_transition).toBe(true)
  })

  it('动态效果三态同上', () => {
    expect(buildEngineConfig({ ...BASE, effectMode: 'off' }, paths).use_video_effect).toBe(false)
    expect(buildEngineConfig({ ...BASE, effectMode: 'random' }, paths).random_video_effect).toBe(true)
  })

  it('目录与关键字段原样带给引擎', () => {
    const config = buildEngineConfig({ ...BASE, videoCount: 3, bitrate: 5000 }, paths)
    expect(config.input_dir).toBe(paths.inputDir)
    expect(config.output_dir).toBe(paths.outputDir)
    expect(config.video_count).toBe(3)
    expect(config.bitrate).toBe(5000)
    expect(config.custom_prefix).toBe('')
    expect(config.use_first_image_name).toBe(false)
  })

  it('转场与效果名单整份带给引擎（引擎按名字查表）', () => {
    const config = buildEngineConfig(BASE, paths)
    expect((config.enabled_transitions as string[]).length).toBe(33)
    expect((config.enabled_video_effects as string[]).length).toBe(39)
    expect(config.enabled_transitions).toContain('淡入淡出')
  })
})

describe('resolveVideoOutputDir', () => {
  it('留空 = 就近输出：同级目录 + 后缀', () => {
    expect(resolveVideoOutputDir('D:/导出/方向A', '')).toBe('D:/导出/方向A-视频')
    expect(resolveVideoOutputDir('D:\\导出\\方向A\\', '   ')).toBe('D:\\导出\\方向A-视频')
  })

  it('配了就用自己的', () => {
    expect(resolveVideoOutputDir('D:/导出/方向A', 'E:/成片')).toBe('E:/成片')
  })

  it('输入目录为空时返回空（调用方负责报错，不猜位置）', () => {
    expect(resolveVideoOutputDir('', '')).toBe('')
  })
})

describe('summarizeImageVideoParams', () => {
  it('摘要只讲三个数，不把二十多项参数铺开', () => {
    expect(summarizeImageVideoParams(BASE)).toBe('1 个视频 · 6 张 / 2s 每张 · 1280x720 · 30fps')
  })

  it('固定总时长时带上它', () => {
    expect(summarizeImageVideoParams({ ...BASE, totalDuration: 30 })).toContain('固定总长 30s')
  })
})
