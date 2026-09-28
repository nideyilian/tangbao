import { describe, expect, it } from 'vitest'
import { parseVariablePrompt, renderVariablePromptBatch } from './variablePrompt'

const prompt = `图片比例为16:9。根据{{主体文案包}}生成内容图，画面加入{{参与证据}}，采用{{文案区结构}}。

可变项：
{{主体文案包}}：冬瓜丸子汤，标题“冬瓜丸子汤” / 番茄牛腩汤，标题“番茄牛腩汤”
{{参与证据}}：汤勺正在舀起主料 / 切配食材与成品同时出现
{{文案区结构}}：右侧标题加六行配料卡 / 上方标题加底部双列配料表`

describe('variable prompt templates', () => {
  it('recognizes a strict variable section and extracts the fixed aspect ratio', () => {
    const parsed = parseVariablePrompt(prompt)
    expect(parsed.enabled).toBe(true)
    expect(parsed.variables.map((variable) => variable.name)).toEqual(['主体文案包', '参与证据', '文案区结构'])
    expect(parsed.combinationCount).toBe(8)
    expect(parsed.aspectRatio).toBe('16:9')
  })

  it('renders clean prompts without sending the option pool to the image model', () => {
    const rendered = renderVariablePromptBatch(prompt, 4, 'task-1')
    expect(rendered).toHaveLength(4)
    rendered.forEach((item) => {
      expect(item).not.toContain('可变项：')
      expect(item).not.toMatch(/\{\{.+?\}\}/u)
      expect(item).toContain('图片比例为16:9')
    })
    expect(new Set(rendered).size).toBe(4)
  })

  it('reports undefined body variables instead of silently enabling the template', () => {
    const parsed = parseVariablePrompt(`生成{{主体}}和{{风格}}。\n\n可变项：\n{{主体}}：猫 / 狗`)
    expect(parsed.detected).toBe(true)
    expect(parsed.enabled).toBe(false)
    expect(parsed.errors.join('\n')).toContain('风格')
  })

  it('ignores definitions that are not used in the body', () => {
    const parsed = parseVariablePrompt(`生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗\n{{风格}}：水彩 / 油画`)
    expect(parsed.enabled).toBe(true)
    expect(parsed.variables.map((variable) => variable.name)).toEqual(['主体'])
    expect(parsed.warnings.join('\n')).toContain('风格')
  })

  it('requires the variable section heading to occupy its own line', () => {
    const parsed = parseVariablePrompt('生成{{主体}}。\n\n可变项：{{主体}}：猫 / 狗')
    expect(parsed.detected).toBe(true)
    expect(parsed.enabled).toBe(false)
    expect(parsed.errors[0]).toContain('单独占一行')
  })

  // ---- TB-143：AI 生成与从文档/聊天粘贴过来的模板，定义行常带 Markdown 装饰 ----
  // 旧版严格匹配会判「格式有误」→ 输入框点生成直接被拦下（报错还说「必须单独占一行」，
  // 而用户看到的明明就是每行一个变量）。宽容后这些写法都能直接用。
  it('定义行带列表符号 / 编号 / 加粗包裹也能认', () => {
    const forms = [
      '正文{{主体}}。\n\n可变项：\n- {{主体}}：猫 / 狗',
      '正文{{主体}}。\n\n可变项：\n* {{主体}}：猫 / 狗',
      '正文{{主体}}。\n\n可变项：\n+ {{主体}}：猫 / 狗',
      '正文{{主体}}。\n\n可变项：\n1. {{主体}}：猫 / 狗',
      '正文{{主体}}。\n\n可变项：\n1、{{主体}}：猫 / 狗',
      '正文{{主体}}。\n\n可变项：\n**{{主体}}**：猫 / 狗',
      '正文{{主体}}。\n\n可变项：\n__{{主体}}__：猫 / 狗',
    ]
    for (const text of forms) {
      const parsed = parseVariablePrompt(text)
      expect(parsed.enabled, text).toBe(true)
      expect(parsed.errors, text).toEqual([])
      expect(
        parsed.variables.map((variable) => variable.name),
        text,
      ).toEqual(['主体'])
      expect(parsed.variables[0].options, text).toEqual(['猫', '狗'])
      // 渲染结果不能留下装饰符号
      const rendered = renderVariablePromptBatch(text, 2, 'seed')
      expect(rendered, text).toHaveLength(2)
      for (const item of rendered) {
        expect(item, text).not.toMatch(/\{\{|^[-*+] |^\d+[.、)] /u)
      }
    }
  })

  it('「可变项：」带标题 / 加粗 / 列表装饰也能认', () => {
    // 旧版这几行**认不出**是变量块（detected=false）——后果比报错更坏：
    // 整段模板（含定义块）会被当成画面描述直接送去生图。
    for (const heading of ['## 可变项：', '**可变项：**', '__可变项：__', '- 可变项：', '1. 可变项：', '### 可变项:']) {
      const parsed = parseVariablePrompt(`正文{{主体}}。\n\n${heading}\n{{主体}}：猫 / 狗`)
      expect(parsed.detected, heading).toBe(true)
      expect(parsed.enabled, heading).toBe(true)
      expect(parsed.variables[0]?.options, heading).toEqual(['猫', '狗'])
    }
  })

  it('读不出变量定义时，报错给出该行原文与期望写法（不再只是「必须单独占一行」）', () => {
    const parsed = parseVariablePrompt('正文{{主体}}。\n\n可变项：\n主体：猫 / 狗')
    expect(parsed.enabled).toBe(false)
    expect(parsed.errors[0]).toContain('可变项第 1 行')
    expect(parsed.errors[0]).toContain('主体：猫 / 狗')
    expect(parsed.errors[0]).toContain('{{变量名}}：选项A / 选项B')
    expect(parsed.errors.join('\n')).not.toContain('必须单独占一行')
  })
})
