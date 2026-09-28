import { describe, expect, it } from 'vitest'
import { buildPoolReferenceRule, buildTaskPrompt, resolveReferenceImageOrder } from './poolPrompt'
import { clampPoolName, POOL_NAME_MAX_LENGTH } from './types'

describe('buildPoolReferenceRule', () => {
  it('没有池图时不拼任何词（不干扰普通图生图）', () => {
    expect(buildPoolReferenceRule('style', { contentCount: 1, styleCount: 0 })).toBe('')
    expect(buildPoolReferenceRule('style', { contentCount: 0, styleCount: 0 })).toBe('')
  })

  it('有内容图时按实际序号标明两者角色', () => {
    expect(buildPoolReferenceRule('style', { contentCount: 1, styleCount: 1 })).toBe(
      '图 1 是内容参考；图 2 只作风格参考，只提取其笔触、材质、光影与色彩关系，不要复制其主体、构图与元素。',
    )
  })

  it('多张内容图与多张池图时用区间标注序号', () => {
    const rule = buildPoolReferenceRule('style', { contentCount: 2, styleCount: 2 })
    expect(rule).toContain('图 1-2 是内容参考')
    expect(rule).toContain('图 3-4 只作风格参考')
  })

  it('⭐ 没有内容图时必须声明池图不是底图、并要求按文字重新构图', () => {
    const rule = buildPoolReferenceRule('style', { contentCount: 0, styleCount: 1 })
    expect(rule).toContain('下面这张图不是要修改的底图')
    expect(rule).toContain('请完全按文字描述重新构图')
  })

  it('没有内容图且多张池图时用「下面这 N 张图」', () => {
    const rule = buildPoolReferenceRule('style', { contentCount: 0, styleCount: 3 })
    expect(rule.startsWith('下面这 3 张图不是要修改的底图')).toBe(true)
  })

  it('构图池 / 样式池换措辞但守同一结构（扩展位生效）', () => {
    const composition = buildPoolReferenceRule('composition', { contentCount: 0, styleCount: 1 })
    const pattern = buildPoolReferenceRule('pattern', { contentCount: 0, styleCount: 1 })
    expect(composition).toContain('只作构图参考')
    expect(composition).toContain('画面布局')
    expect(pattern).toContain('只作样式参考')
    expect(pattern).toContain('纹样')
    expect(composition).not.toBe(pattern)
  })

  it('脏值（负数 / 小数）按非负整数处理', () => {
    expect(buildPoolReferenceRule('style', { contentCount: -1, styleCount: 0 })).toBe('')
    expect(buildPoolReferenceRule('style', { contentCount: -1, styleCount: 1 })).toContain('下面这张图')
    expect(buildPoolReferenceRule('style', { contentCount: 2, styleCount: 1.6 })).toContain('图 3 只作风格参考')
  })
})

describe('buildTaskPrompt', () => {
  it('角色指令在前、用户提示词在后', () => {
    expect(buildTaskPrompt('一只戴帽子的猫', 'RULE')).toBe('RULE\n一只戴帽子的猫')
  })

  it('用户提示词只有空白时只返回角色指令', () => {
    expect(buildTaskPrompt('   \n ', 'RULE')).toBe('RULE')
  })

  it('没有角色指令时原样返回用户提示词', () => {
    expect(buildTaskPrompt(' 一只猫 ', '')).toBe(' 一只猫 ')
  })
})

describe('resolveReferenceImageOrder', () => {
  it('⭐ 内容图必须排在池图前面（第一张是 API 的主图）', () => {
    expect(resolveReferenceImageOrder(['a', 'b'], ['s1', 's2'])).toEqual(['a', 'b', 's1', 's2'])
  })

  it('只有池图时保持池内顺序', () => {
    expect(resolveReferenceImageOrder([], ['s1'])).toEqual(['s1'])
  })

  it('不修改传入的数组', () => {
    const content = ['a']
    const pool = ['s1']
    resolveReferenceImageOrder(content, pool)
    expect(content).toEqual(['a'])
    expect(pool).toEqual(['s1'])
  })
})

describe('clampPoolName', () => {
  it('超过上限按字数截断（按码点，不切断代理对）', () => {
    expect(clampPoolName('一二三四五六七八九十')).toBe('一二三四五六七八')
    // 按码点数：直接断言 .length 会被代理对骗到（一个 emoji 占 2 个码元）
    expect(Array.from(clampPoolName('🎨🎨🎨🎨🎨🎨🎨🎨🎨'))).toHaveLength(POOL_NAME_MAX_LENGTH)
  })

  it('未超限时去掉首尾空白', () => {
    expect(clampPoolName('  厚涂油画  ')).toBe('厚涂油画')
  })
})
