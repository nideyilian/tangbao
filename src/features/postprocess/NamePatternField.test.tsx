/* @vitest-environment jsdom */

/**
 * 命名模板输入框：框里显示中文、存的是英文。
 *
 * 锁的是「显示层与存储层分家」这条线 —— 它一旦破了，要么用户看不懂一屏 `{date}`，
 * 要么所有人的落盘模板被悄悄换成中文（导出给别人的配置也跟着失效）。两种都是事故。
 */

import { describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import NamePatternField from './NamePatternField'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render(value: string) {
  const onChange = vi.fn()
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(<NamePatternField value={value} onChange={onChange} />)
  })
  return { renderer, onChange }
}

const inputOf = (renderer: ReturnType<typeof create>) => renderer.root.findByType('input')

/** 复刻一次键盘输入：受控 input 的 change 事件带着新值与光标位置 */
function type(renderer: ReturnType<typeof create>, next: string) {
  act(() => {
    inputOf(renderer).props.onChange({
      target: { value: next, selectionStart: next.length, selectionEnd: next.length },
    })
  })
}

describe('NamePatternField（框里中文、底层英文）', () => {
  it('⭐ 输入框显示中文占位符，不是 {date}', () => {
    const { renderer } = render('{date}-{product}-{seq}')
    expect(inputOf(renderer).props.value).toBe('{日期}-{产品}-{序号}')
  })

  it('⭐ 用户输入中文占位符时，交出去的是英文模板', () => {
    const { renderer, onChange } = render('{媒体}')
    type(renderer, '{媒体}-{序号}')
    expect(onChange).toHaveBeenCalledWith('{media}-{seq}')
  })

  it('手打英文占位符也存英文（显示层负责统一，存储层原样不动）', () => {
    const { renderer, onChange } = render('')
    type(renderer, '{date}-{seq}')
    expect(onChange).toHaveBeenCalledWith('{date}-{seq}')
  })

  it('变量按钮插的是底层占位符，不是中文', () => {
    const { renderer, onChange } = render('')
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'name-token-date' }).props.onClick()
    })
    expect(onChange).toHaveBeenCalledWith('{date}')
  })

  it('写错的占位符原样显示 —— 看得见才改得掉', () => {
    const { renderer } = render('{oops}-{date}')
    expect(inputOf(renderer).props.value).toBe('{oops}-{日期}')
  })
})
