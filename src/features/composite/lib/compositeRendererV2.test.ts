import { describe, expect, it } from 'vitest'
import {
  drawLayer,
  getCompositeOverlayCacheKey,
  getScaledLayerStrokeWidth,
  getScaledTextMetrics,
} from './compositeRendererV2'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'
import type { CompositeV2TextLayer } from './compositeV2Types'

/**
 * 假的 2D 上下文：只记录「画了什么字、画在哪、有没有传 maxWidth」。
 * jsdom 没有 canvas 实现（`getContext('2d')` 返回 null），而这次要防的两件事恰恰只在
 * 绘制调用上看得见。
 */
function recordingContext(widthPerChar: number) {
  const drawn: { text: string; x: number; y: number; maxWidth?: number }[] = []
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    letterSpacing: '0px',
    textAlign: 'center',
    textBaseline: 'middle',
    globalAlpha: 1,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    measureText: (text: string) => ({ width: [...text].length * widthPerChar }),
    fillText: (text: string, x: number, y: number, maxWidth?: number) => {
      drawn.push({ text, x, y, maxWidth })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn }
}

/**
 * 库里那套真实水印（`preset-compliance-04`）：框内宽 432 = 23 字 × 18px，
 * 再叠加 `★` 前缀就正好 24 字 —— 卡在边界上的那一档。
 */
function complianceTextLayer(patch: Partial<CompositeV2TextLayer> = {}): CompositeV2TextLayer {
  return {
    id: 'compliance-text-04',
    type: 'text',
    name: '合规文案',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: {
      mode: 'anchor',
      anchor: 'bottom-right',
      marginX: 0,
      marginY: 0,
      offsetX: 0,
      offsetY: 0,
      width: 448,
      height: 40,
    },
    shadow: { enabled: false, color: '#000000', x: 0, y: 2, blur: 6, opacity: 0.7 },
    text: '具体活动或商品优惠以活动页面或商品详情页信息为准',
    fontFamily: 'sans-serif',
    fontSize: 18,
    fontWeight: 700,
    color: '#ffffff',
    align: 'right',
    lineHeight: 1.3,
    letterSpacing: 0,
    padding: 8,
    ...patch,
  }
}

describe('composite renderer v2', () => {
  it('scales text metrics from the preset base canvas', () => {
    expect(getScaledTextMetrics(48, 2, { width: 1280, height: 720 }, { width: 640, height: 360 })).toEqual({
      fontSize: 24,
      strokeWidth: 1,
    })
  })

  it('keys combined watermark overlays by preset revision and target size', () => {
    expect(getCompositeOverlayCacheKey({ id: 'p1', updatedAt: 123 }, { width: 640, height: 360 })).toBe(
      'p1:123:640x360',
    )
  })

  it('includes the project logo signature in the overlay cache key', () => {
    expect(getCompositeOverlayCacheKey({ id: 'p1', updatedAt: 123 }, { width: 640, height: 360 }, 'logoA|logoB')).toBe(
      'p1:123:640x360:logos=logoA|logoB',
    )
  })

  it('includes the watermark identifier signature in the overlay cache key', () => {
    // 标识符不写回预设，改它不会动 updatedAt —— 不进缓存键就是「改了但预览/产出不变」
    const base = { id: 'p1', updatedAt: 123 }
    const size = { width: 640, height: 360 }
    expect(getCompositeOverlayCacheKey(base, size, undefined, 'suffix:@小王')).toBe('p1:123:640x360:id=suffix:@小王')
    expect(getCompositeOverlayCacheKey(base, size, undefined, 'prefix:@小王')).not.toBe(
      getCompositeOverlayCacheKey(base, size, undefined, 'suffix:@小王'),
    )
  })

  it('scales a shared layer stroke from the preset canvas', () => {
    expect(
      getScaledLayerStrokeWidth(
        { enabled: true, color: '#111827', width: 4 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toBe(2)
  })

  /*
   * 文字排版只认**手动换行符**，不认框宽（2026-09-22「我没设置换行，它自己换行」）。
   *
   * 这一格上连栽两次，都是拿「框宽」当硬约束：先把框宽当 `fillText` 第 4 参传下去
   * （canvas 收到 maxWidth 是**横向压扁**，报障「文字被拉伸变形」）；改成逐字折行后，
   * 末字又被推到第二行。根因是框宽两头都对不上 —— 算不进渲染时才叠加的标识符，
   * 也对不上旧版手拖出来的历史框。
   */
  it('⭐ 字比框宽也不断行、不压缩：整行只画一次，且不传 maxWidth', async () => {
    const { ctx, drawn } = recordingContext(18.2)
    await drawLayer(
      ctx,
      complianceTextLayer(),
      createDefaultCompositeV2Preset(),
      { width: 1280, height: 720 },
      { text: '★', placement: 'prefix' },
    )

    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.text).toBe('★具体活动或商品优惠以活动页面或商品详情页信息为准')
    // 传第 4 参会被 canvas 横向压扁（那是压缩，不是换行）
    expect(drawn[0]!.maxWidth).toBeUndefined()
    // 右对齐 = 文字右边缘钉在框右侧、溢出往左长（框宽只用来定位）
    expect(drawn[0]!.x).toBe(448 / 2 - 8)
  })

  it('手动敲的换行符照旧生效 —— 不认框宽不等于吃掉换行', async () => {
    const { ctx, drawn } = recordingContext(10)
    await drawLayer(ctx, complianceTextLayer({ text: '第一行\n第二行' }), createDefaultCompositeV2Preset(), {
      width: 1280,
      height: 720,
    })

    expect(drawn.map((item) => item.text)).toEqual(['第一行', '第二行'])
  })

  /*
   * 竖排（`orientation: 'vertical'`）：一列一行地画、列内逐字向下。
   *
   * 上面两条守卫继续管横排；这里钉竖排的三个口径 —— 换行 = 换列、「一字一行」的老写法
   * 先折成一段（不折就会被当成换列，排成横着的一排）、标识符成为第一格。
   */
  it('⭐ 竖排：逐字向下画，同列 x 相同、y 递增，且不传 maxWidth', async () => {
    const { ctx, drawn } = recordingContext(18)
    await drawLayer(
      ctx,
      complianceTextLayer({ orientation: 'vertical', text: '该活动' }),
      createDefaultCompositeV2Preset(),
      {
        width: 1280,
        height: 720,
      },
    )

    expect(drawn.map((item) => item.text)).toEqual(['该', '活', '动'])
    expect(new Set(drawn.map((item) => item.x)).size).toBe(1)
    expect(drawn[1]!.y).toBeGreaterThan(drawn[0]!.y)
    expect(drawn[2]!.y).toBeGreaterThan(drawn[1]!.y)
    // 竖排同样不传 maxWidth：那是横向压缩，不是换行
    expect(drawn.every((item) => item.maxWidth === undefined)).toBe(true)
  })

  it('⭐ 竖排 +「一字一行」的老写法：折成一列，且用竖排的字距（不是横排的行距）', async () => {
    const preset = createDefaultCompositeV2Preset()
    const target = { width: 1280, height: 720 }
    const { ctx, drawn } = recordingContext(18)
    await drawLayer(ctx, complianceTextLayer({ orientation: 'vertical', text: '该\n活\n动' }), preset, target)

    expect(drawn.map((item) => item.text)).toEqual(['该', '活', '动'])
    // 折成一列（不折的话三个换行会被当成三列，x 各不相同）
    expect(new Set(drawn.map((item) => item.x)).size).toBe(1)
    /*
     * ⚠️ 步进必须按**竖排**算：`fontSize + 字距`（横排那里是 `fontSize × 行高`）。
     * 少了这一条，「一字一行」横排与竖排**画出完全一样的三个字**，这条守卫就会在
     * 竖排分支被整个删掉时依然全绿（探针没打中目标）。
     */
    const metrics = getScaledTextMetrics(18, 0, preset.baseCanvas, target)
    expect(drawn[1]!.y - drawn[0]!.y).toBeCloseTo(metrics.fontSize)
  })

  it('竖排 + 整段换行 = 换列：两列的 x 不同', async () => {
    const { ctx, drawn } = recordingContext(18)
    await drawLayer(
      ctx,
      complianceTextLayer({ orientation: 'vertical', text: '该活动\n存在' }),
      createDefaultCompositeV2Preset(),
      { width: 1280, height: 720 },
    )

    expect(drawn.map((item) => item.text)).toEqual(['该', '活', '动', '存', '在'])
    expect(new Set(drawn.map((item) => item.x)).size).toBe(2)
  })

  it('⭐ 竖排 + 标识符：★ 成为第一格（在文案上方），不与首字并排', async () => {
    const { ctx, drawn } = recordingContext(18)
    await drawLayer(
      ctx,
      complianceTextLayer({ orientation: 'vertical', text: '该活动' }),
      createDefaultCompositeV2Preset(),
      { width: 1280, height: 720 },
      { text: '★', placement: 'prefix' },
    )

    expect(drawn.map((item) => item.text)).toEqual(['★', '该', '活', '动'])
    expect(new Set(drawn.map((item) => item.x)).size).toBe(1)
    expect(drawn[0]!.y).toBeLessThan(drawn[1]!.y)
  })
})
