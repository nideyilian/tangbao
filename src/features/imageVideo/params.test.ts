import { describe, expect, it } from 'vitest'
import {
  buildEngineConfig,
  normalizeImageVideoOverride,
  normalizeImageVideoParams,
  resolveImageVideoParams,
  resolveVideoOutputDir,
  summarizeImageVideoParams,
} from './params'
import { resolveVideoPlan } from './runVideo'
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
  const paths = {
    inputDir: 'D:/导出/方向A',
    outputDir: 'D:/导出/方向A-视频',
    library: { bgm: 'D:/库/bgm', watermark: 'D:/库/watermark' },
  }

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

describe('BGM 与视频水印映射（2026-09-27 接上）', () => {
  const paths = {
    inputDir: 'D:/导出/A',
    outputDir: 'D:/导出/A-视频',
    library: { bgm: 'D:/库/bgm', watermark: 'D:/库/watermark' },
  }

  it('默认不出声、不加水印 —— 不靠默认值去改用户的成片', () => {
    const config = buildEngineConfig(BASE, paths)
    expect(config.use_bgm).toBe(false)
    expect(config.use_watermark).toBe(false)
  })

  it('BGM 选了文件夹：拼成库内的绝对路径', () => {
    const config = buildEngineConfig({ ...BASE, useBgm: true, bgmFolder: '轻快' }, paths)
    expect(config.use_bgm).toBe(true)
    expect(config.bgm_dir).toBe('D:/库/bgm/轻快')
  })

  it('BGM 不选文件夹 = 用整个库', () => {
    expect(buildEngineConfig({ ...BASE, useBgm: true }, paths).bgm_dir).toBe('D:/库/bgm')
  })

  it('显式挑曲那一栏永远空着 —— 无界面 worker 读不到 bgm_files（读的是 _bgm_files）', () => {
    expect(buildEngineConfig({ ...BASE, useBgm: true }, paths).bgm_files).toEqual([])
  })

  it('水印两态：文件夹轮转 / 单文件', () => {
    const folder = buildEngineConfig(
      { ...BASE, useVideoWatermark: true, watermarkMode: 'folder', watermarkPath: '角标' },
      paths,
    )
    expect(folder.watermark_mode).toBe('文件夹')
    expect(folder.watermark_path).toBe('D:/库/watermark/角标')

    const single = buildEngineConfig(
      { ...BASE, useVideoWatermark: true, watermarkMode: 'single', watermarkPath: 'logo.mov' },
      paths,
    )
    expect(single.watermark_mode).toBe('单文件')
    expect(single.watermark_path).toBe('D:/库/watermark/logo.mov')
  })

  it('⭐ 库根拿不到时给空串 —— 绝不退化成相对路径让引擎按自己的工作目录去猜', () => {
    const config = buildEngineConfig(
      { ...BASE, useBgm: true, bgmFolder: '轻快', useVideoWatermark: true, watermarkPath: 'a.mov' },
      { ...paths, library: { bgm: '', watermark: '' } },
    )
    expect(config.bgm_dir).toBe('')
    expect(config.watermark_path).toBe('')
  })

  it('引擎自带的图片水印图层继续关着（与糖包水印库是两回事，别叠两次）', () => {
    const config = buildEngineConfig({ ...BASE, useVideoWatermark: true }, paths)
    expect(config.use_image_watermark).toBe(false)
    expect(config.watermark_layers).toEqual([])
  })

  it('各档取值原样带给引擎（引擎按中文名查映射表）', () => {
    const config = buildEngineConfig(
      {
        ...BASE,
        useVideoWatermark: true,
        watermarkPosition: '左下',
        watermarkSizeMode: '完全覆盖',
        watermarkBlendMode: '滤色',
        watermarkMatchMethod: '拉伸',
        watermarkAudio: '两者混合',
      },
      paths,
    )
    expect(config.watermark_position).toBe('左下')
    expect(config.watermark_size_mode).toBe('完全覆盖')
    expect(config.watermark_blend_mode).toBe('滤色')
    expect(config.watermark_match_method).toBe('拉伸')
    expect(config.watermark_audio).toBe('两者混合')
  })
})

describe('库内相对路径的清洗（这两个值会被拼成绝对路径交给引擎）', () => {
  it('挡住 .. 穿越', () => {
    expect(normalizeImageVideoOverride({ bgmFolder: '../../Windows' })).toEqual({})
    expect(normalizeImageVideoOverride({ watermarkPath: 'a/../../b' })).toEqual({})
  })

  it('挡住带盘符的绝对路径（拼接后会指向库外）', () => {
    expect(normalizeImageVideoOverride({ bgmFolder: 'C:/Windows' })).toEqual({})
    expect(normalizeImageVideoOverride({ watermarkPath: 'D:\\其它' })).toEqual({})
  })

  it('反斜杠归一化成 /，首尾斜杠剥掉', () => {
    expect(normalizeImageVideoOverride({ bgmFolder: '\\轻快\\子目录\\' })).toEqual({ bgmFolder: '轻快/子目录' })
  })

  it('单个前导斜杠只是剥掉、不算穿越（拼出来仍在库内）', () => {
    expect(normalizeImageVideoOverride({ watermarkPath: '/logo.mov' })).toEqual({ watermarkPath: 'logo.mov' })
  })

  it('videoCountMode 只认那两个值，别的（含手改 JSON 写进来的中文）一律丢弃', () => {
    expect(normalizeImageVideoOverride({ videoCountMode: 'perImage' })).toEqual({ videoCountMode: 'perImage' })
    expect(normalizeImageVideoOverride({ videoCountMode: 'fixed' })).toEqual({ videoCountMode: 'fixed' })
    expect(normalizeImageVideoOverride({ videoCountMode: '按图片数' })).toEqual({})
    expect(normalizeImageVideoOverride({ videoCountMode: true })).toEqual({})
  })
})

/**
 * 「视频数怎么定」（2026-09-28 杰哥要的「单图加特效那种，视频数按图片数量来」）。
 *
 * 引擎没有这个模式，所以换算是糖包这边做的：`perImage` ⇒ 每片 1 张图、视频数 = 图片数。
 */
describe('resolveVideoPlan', () => {
  it('fixed：照参数里写的来，图片数不参与（老行为）', () => {
    const plan = resolveVideoPlan({ ...BASE, videoCountMode: 'fixed', imagesPerVideo: 6, videoCount: 3 }, 40)
    expect(plan).toEqual({ imagesPerVideo: 6, videoCount: 3 })
  })

  it('perImage：每张图各一个 —— 每片 1 张图、视频数 = 目录里的图片数', () => {
    const plan = resolveVideoPlan({ ...BASE, videoCountMode: 'perImage', imagesPerVideo: 6, videoCount: 1 }, 40)
    expect(plan).toEqual({ imagesPerVideo: 1, videoCount: 40 })
  })

  it('⭐ 换算结果恒满足引擎那条校验（图片数 ≥ 视频数 × 每片图片数），所以不会出现「图片数量不足」', () => {
    const params = { ...BASE, videoCountMode: 'perImage' as const }
    for (const imageCount of [1, 2, 7, 500]) {
      const plan = resolveVideoPlan(params, imageCount)
      expect(imageCount).toBeGreaterThanOrEqual(plan.videoCount * plan.imagesPerVideo)
    }
  })

  it('buildEngineConfig 认这个换算结果：num_images / video_count 用实际值，其余照参数', () => {
    const params = { ...BASE, videoCountMode: 'perImage' as const, fps: 25 }
    const config = buildEngineConfig(
      params,
      { inputDir: 'D:/in', outputDir: 'D:/out', library: { bgm: '', watermark: '' } },
      resolveVideoPlan(params, 12),
    )
    expect(config.num_images).toBe(1)
    expect(config.video_count).toBe(12)
    expect(config.fps).toBe(25)
  })

  it('不传换算结果时仍是参数里的值（别的调用方不受影响）', () => {
    const config = buildEngineConfig(
      { ...BASE, imagesPerVideo: 4, videoCount: 2 },
      {
        inputDir: 'D:/in',
        outputDir: 'D:/out',
        library: { bgm: '', watermark: '' },
      },
    )
    expect(config.num_images).toBe(4)
    expect(config.video_count).toBe(2)
  })
})
