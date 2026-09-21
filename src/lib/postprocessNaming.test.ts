import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POSTPROCESS_NAME_PATTERN,
  POSTPROCESS_NAME_TOKENS,
  POSTPROCESS_NAME_TOKEN_LABELS,
  POSTPROCESS_NAME_TOKEN_SHORT_LABELS,
  buildPostprocessFolderName,
  buildPostprocessOutputName,
  findDuplicatedPostprocessNameTokens,
  findMissingPostprocessNameTokens,
  findUnknownPostprocessNameTokens,
  formatPostprocessSizeToken,
  fromDisplayNamePattern,
  insertPostprocessNameToken,
  listPostprocessNameTokens,
  renderPostprocessNamePattern,
  stripPostprocessNameSequence,
  toDisplayNamePattern,
  validateNamePattern,
} from './postprocessNaming'

const SEPT_17_2026 = new Date(2026, 8, 17, 12, 0, 0).getTime()

describe('formatPostprocessSizeToken', () => {
  it('接受宽高对象与已格式化字符串', () => {
    expect(formatPostprocessSizeToken({ width: 1280, height: 720 })).toBe('1280x720')
    expect(formatPostprocessSizeToken('640x480')).toBe('640x480')
  })

  it('缺值或非法数值返回空串（交给上层的空段折叠处理）', () => {
    expect(formatPostprocessSizeToken(undefined)).toBe('')
    expect(formatPostprocessSizeToken({ width: Number.NaN, height: 720 })).toBe('')
  })
})

describe('模板 token 解析', () => {
  it('按出现顺序列出 token', () => {
    expect(listPostprocessNameTokens('{date}-{product}-{seq}')).toEqual(['date', 'product', 'seq'])
  })

  it('识别未知 token 与重复 token', () => {
    expect(findUnknownPostprocessNameTokens('{date}-{foo}-{bar}-{foo}')).toEqual(['foo', 'bar'])
    expect(findDuplicatedPostprocessNameTokens('{date}-{seq}-{seq}-{date}')).toEqual(['seq', 'date'])
    expect(findUnknownPostprocessNameTokens(DEFAULT_POSTPROCESS_NAME_PATTERN)).toEqual([])
    expect(findDuplicatedPostprocessNameTokens(DEFAULT_POSTPROCESS_NAME_PATTERN)).toEqual([])
  })

  it('提示缺少的必要 token（{seq} 缺失会导致同批次互相覆盖）', () => {
    expect(findMissingPostprocessNameTokens('{date}-{media}')).toEqual(['seq'])
    expect(findMissingPostprocessNameTokens(DEFAULT_POSTPROCESS_NAME_PATTERN)).toEqual([])
  })

  it('默认模板可用的 token 都是已登记的', () => {
    for (const token of listPostprocessNameTokens(DEFAULT_POSTPROCESS_NAME_PATTERN)) {
      expect(findUnknownPostprocessNameTokens(`{${token}}`)).toEqual([])
    }
  })
})

describe('renderPostprocessNamePattern', () => {
  it('按默认模板渲染出完整文件名主干', () => {
    const name = renderPostprocessNamePattern(DEFAULT_POSTPROCESS_NAME_PATTERN, {
      createdAt: SEPT_17_2026,
      product: '智能客服',
      direction: '横版',
      media: '广点通',
      size: { width: 1280, height: 720 },
      seq: 3,
    })
    expect(name).toBe('20260917-智能客服-横版-广点通-1280x720-3')
  })

  it('取值为空的段整段删除，不留下连续连字符', () => {
    const name = renderPostprocessNamePattern('{date}-{creator}-{media}-{seq}', {
      createdAt: SEPT_17_2026,
      creator: '',
      media: '百度',
      seq: 1,
    })
    expect(name).toBe('20260917-百度-1')
  })

  it('清洗非法文件名字符（斜杠、冒号等）', () => {
    const name = renderPostprocessNamePattern('{product}-{seq}', { product: 'A/B:C*D', seq: 2 })
    expect(name).toBe('A-B-C-D-2')
  })

  it('未知 token 原样保留，便于肉眼发现模板写错', () => {
    const name = renderPostprocessNamePattern('{date}-{oops}-{seq}', { createdAt: SEPT_17_2026, seq: 1 })
    expect(name).toBe('20260917-{oops}-1')
  })

  it('{seq} 非法或缺失时兜底为 1，且不会因全是空值产出空名', () => {
    expect(renderPostprocessNamePattern('x-{seq}', { seq: Number.NaN })).toBe('x-1')
    expect(renderPostprocessNamePattern('{seq}', { seq: 0 })).toBe('1')
    expect(renderPostprocessNamePattern('{creator}-{line}', {})).toBe('image')
  })

  it('模板为空或全空白时回退到默认模板', () => {
    const name = renderPostprocessNamePattern('   ', {
      createdAt: SEPT_17_2026,
      product: 'P',
      media: 'M',
      size: { width: 100, height: 200 },
      seq: 1,
    })
    expect(name).toBe('20260917-P-竖版-M-100x200-1')
  })

  it('只折叠连字符：自定义 `_` 分隔符遇空值会留下双下划线（已知边界，默认模板走连字符不受影响）', () => {
    const name = renderPostprocessNamePattern('{product}_{media}_{seq}', { product: 'P', media: '', seq: 7 })
    expect(name).toBe('P__7')
  })

  it('同一上下文重复调用结果稳定（供幂等写入与去重使用）', () => {
    const context = {
      createdAt: SEPT_17_2026,
      product: '智能客服',
      media: '头条',
      size: { width: 1080, height: 1920 },
      seq: 12,
    }
    expect(renderPostprocessNamePattern(DEFAULT_POSTPROCESS_NAME_PATTERN, context)).toBe(
      renderPostprocessNamePattern(DEFAULT_POSTPROCESS_NAME_PATTERN, context),
    )
  })
})

describe('{preset} token（多套水印时区分同名产物）', () => {
  it('取水印预设名；没有水印时整段删除', () => {
    expect(renderPostprocessNamePattern('{product}-{preset}-{seq}', { product: 'A', preset: '客户甲', seq: 3 })).toBe(
      'A-客户甲-3',
    )
    expect(renderPostprocessNamePattern('{product}-{preset}-{seq}', { product: 'A', seq: 3 })).toBe('A-3')
  })

  it('已登记进 token 表（UI 的快捷插入才不会漏掉它）', () => {
    expect(listPostprocessNameTokens('{preset}')).toEqual(['preset'])
    expect(findUnknownPostprocessNameTokens('{preset}')).toEqual([])
  })

  it('buildPostprocessOutputName 从单元的 watermark 取预设名', () => {
    const config = { namePattern: '{media}-{preset}-{seq}', creator: '' }
    const unit = { mediaName: '广点通', width: 1280, height: 720, direction: 'landscape' as const }
    expect(buildPostprocessOutputName(config, unit, {}, 1)).toBe('广点通-1')
    expect(buildPostprocessOutputName(config, { ...unit, watermark: { name: '客户甲' } }, {}, 2)).toBe(
      '广点通-客户甲-2',
    )
  })
})

describe('insertPostprocessNameToken（在光标处插入变量）', () => {
  it('有光标时插在光标处，而不是追加到末尾', () => {
    const result = insertPostprocessNameToken('{seq}', 'date' as const, { start: 0, end: 0 })
    expect(result.pattern).toBe('{date}{seq}')
  })

  it('把光标后应落的位置算出来（紧跟在插入的占位符之后）', () => {
    const result = insertPostprocessNameToken('AB', 'line' as const, { start: 1, end: 1 })
    expect(result.pattern).toBe('A{line}B')
    expect(result.caret).toBe(1 + '{line}'.length)
    expect(result.pattern.slice(0, result.caret)).toBe('A{line}')
  })

  it('有选区时替换选区', () => {
    // '{date}-{seq}'：`{seq}` 占 7..11，选了它就整段换掉
    expect(insertPostprocessNameToken('{date}-{seq}', 'media' as const, { start: 7, end: 12 }).pattern).toBe(
      '{date}-{media}',
    )
  })

  it('不给光标时追加到末尾（保留旧的「点一下就加在最后」行为）', () => {
    expect(insertPostprocessNameToken('{date}', 'seq' as const).pattern).toBe('{date}{seq}')
    expect(insertPostprocessNameToken('', 'date' as const).pattern).toBe('{date}')
  })

  it('越界或过期的选区一律夹回合法范围，不抛错', () => {
    expect(insertPostprocessNameToken('{seq}', 'date' as const, { start: 99, end: 99 }).pattern).toBe('{seq}{date}')
    expect(insertPostprocessNameToken('{seq}', 'date' as const, { start: -3, end: -1 }).pattern).toBe('{date}{seq}')
    // start > end（反选）按「从 start 起插」处理
    expect(insertPostprocessNameToken('{seq}', 'date' as const, { start: 0, end: -5 }).pattern).toBe('{date}{seq}')
    // 位置本身不可用（NaN）= 「没有光标」，按追加处理，与不传选区一致
    expect(insertPostprocessNameToken('{seq}', 'date' as const, { start: Number.NaN, end: Number.NaN }).pattern).toBe(
      '{seq}{date}',
    )
  })

  it('插入结果能被模板解析器认出来（不会插进去一个未知占位符）', () => {
    const result = insertPostprocessNameToken('', 'preset' as const)
    expect(findUnknownPostprocessNameTokens(result.pattern)).toEqual([])
    expect(listPostprocessNameTokens(result.pattern)).toEqual(['preset'])
  })
})

describe('变量按钮的中文名', () => {
  it('每个 token 都有短中文名，且不出现英文占位符', () => {
    for (const token of POSTPROCESS_NAME_TOKENS) {
      const short = POSTPROCESS_NAME_TOKEN_SHORT_LABELS[token]
      expect(short).toBeTruthy()
      expect(short).not.toContain('{')
      expect(short).not.toContain(token)
      // 短名是详细标签去括号后的前缀，两者不能各说各的
      expect(POSTPROCESS_NAME_TOKEN_LABELS[token].startsWith(short)).toBe(true)
    }
  })
})

describe('validateNamePattern（模板校验）', () => {
  // 校验与上面三个 find* 是同一件事的几半：模板 token 集改了，校验范围必须跟着改。
  // 原先它挂在参数元数据表里，参数表收窄为方向级后随命名工具一起搬到这里。
  it('全部通过时返回空数组', () => {
    expect(validateNamePattern('{date}-{seq}', { unknown: [], missing: [], duplicated: [] })).toEqual([])
  })

  it('未知占位符是 error', () => {
    const issues = validateNamePattern('{oops}', { unknown: ['oops'], missing: [], duplicated: [] })
    expect(issues).toHaveLength(1)
    expect(issues[0].tone).toBe('error')
    expect(issues[0].message).toContain('{oops}')
  })

  it('缺少占位符是 error，并说明会互相覆盖', () => {
    const issues = validateNamePattern('{date}', { unknown: [], missing: ['seq'], duplicated: [] })
    expect(issues[0].tone).toBe('error')
    expect(issues[0].message).toContain('覆盖')
  })

  it('重复占位符只是 warning', () => {
    const issues = validateNamePattern('{size}-{size}', { unknown: [], missing: [], duplicated: ['size'] })
    expect(issues[0].tone).toBe('warning')
  })

  it('多个问题同时报出，不互相盖掉', () => {
    const issues = validateNamePattern('{oops}', { unknown: ['oops'], missing: ['seq'], duplicated: ['size'] })
    expect(issues).toHaveLength(3)
  })
})

describe('中文显示 ↔ 底层模板（框里给中文，落盘仍是英文）', () => {
  it('已知 token 显示成中文，存进去的还是英文', () => {
    expect(toDisplayNamePattern('{date}-{product}-{seq}')).toBe('{日期}-{产品}-{序号}')
    expect(fromDisplayNamePattern('{日期}-{产品}-{序号}')).toBe('{date}-{product}-{seq}')
  })

  it('⭐ 往返无损：默认模板转一圈回到原样', () => {
    // 显示层每一次渲染都要走一遍「底层 → 显示」，无损是它成立的前提
    const display = toDisplayNamePattern(DEFAULT_POSTPROCESS_NAME_PATTERN)
    expect(fromDisplayNamePattern(display)).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN)
    expect(toDisplayNamePattern(fromDisplayNamePattern(display))).toBe(display)
  })

  it('手打的英文占位符也会被统一成中文（显示层归一化）', () => {
    expect(toDisplayNamePattern('{date}-{seq}')).toBe('{日期}-{序号}')
  })

  it('认不出的花括号原样保留 —— 用户得能在框里看见自己写错了', () => {
    expect(toDisplayNamePattern('{oops}-{date}')).toBe('{oops}-{日期}')
    expect(fromDisplayNamePattern('{写错了}-{日期}')).toBe('{写错了}-{date}')
  })

  it('{产品线} 与 {产品} 不互相吃掉（精确匹配，不是前缀匹配）', () => {
    expect(toDisplayNamePattern('{line}{product}')).toBe('{产品线}{产品}')
    expect(fromDisplayNamePattern('{产品线}{产品}')).toBe('{line}{product}')
  })

  it('空值原样返回，不抛错', () => {
    expect(toDisplayNamePattern('')).toBe('')
    expect(fromDisplayNamePattern('')).toBe('')
  })
})

describe('stripPostprocessNameSequence（文件夹名 = 文件名去掉序号）', () => {
  it('删掉 {seq}（留下的连字符交给渲染器折叠）', () => {
    expect(stripPostprocessNameSequence('{date}-{product}-{seq}')).toBe('{date}-{product}-')
  })

  it('空模板按默认模板处理，否则会渲染出一个带序号的文件夹名', () => {
    expect(stripPostprocessNameSequence('')).toBe(DEFAULT_POSTPROCESS_NAME_PATTERN.replace('{seq}', ''))
  })
})

describe('buildPostprocessFolderName', () => {
  const unit = { mediaName: '百度', width: 1140, height: 640, direction: 'landscape' as const }
  const names = { product: '百万医疗险' }

  it('⭐ 与文件名同源，只少末尾的序号', () => {
    const config = { namePattern: '{product}-{media}-{size}-{seq}', creator: '' }
    expect(buildPostprocessOutputName(config, unit, names, 3, SEPT_17_2026)).toBe('百万医疗险-百度-1140x640-3')
    expect(buildPostprocessFolderName(config, unit, names, SEPT_17_2026)).toBe('百万医疗险-百度-1140x640')
  })

  it('模板里本来就没有 {seq} 时两者相同', () => {
    const config = { namePattern: '{media}-{size}', creator: '' }
    expect(buildPostprocessFolderName(config, unit, {}, SEPT_17_2026)).toBe('百度-1140x640')
  })

  it('模板里的 {preset} 照样进文件夹名（要按水印分开就写进模板）', () => {
    const config = { namePattern: '{media}-{preset}-{seq}', creator: '' }
    const withPreset = { ...unit, watermark: { name: '客户甲' } }
    expect(buildPostprocessFolderName(config, withPreset, {}, SEPT_17_2026)).toBe('百度-客户甲')
  })
})
