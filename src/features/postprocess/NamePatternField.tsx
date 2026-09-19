/**
 * 命名模板输入框 + 变量按钮（后处理设置与项目节点参数共用）。
 *
 * 三条约定：
 * 1. 变量按钮显示**中文**、插入的是 `{token}`。模板是落盘格式不能改成中文，
 *    但按钮上写 `{date}` 对用户是一串看不懂的符号，所以按钮给中文名、占位符进 tooltip。
 * 2. 插入位置取**光标所在处**（有选区就替换选区），而不是无脑追加末尾——往模板中间补一个变量是常态。
 * 3. 光标位置记在 ref 里而不是现读 DOM：点按钮时输入框已经失焦，此时再读 `selectionStart`
 *    会被浏览器归零，结果就是「不管点哪儿都插到开头」。
 *
 * 两个入口共用同一份实现，避免「设置面板里能插中间、节点参数里只能追加」这种两套手感。
 */

import { useRef, type ReactNode } from 'react'
import { Button, TextField } from '../../design-system'
import {
  POSTPROCESS_NAME_TOKENS,
  POSTPROCESS_NAME_TOKEN_LABELS,
  POSTPROCESS_NAME_TOKEN_SHORT_LABELS,
  insertPostprocessNameToken,
  type PostprocessNameToken,
} from '../../lib/postprocessNaming'

interface Props {
  value: string
  onChange: (value: string) => void
  label?: ReactNode
  containerClassName?: string
  placeholder?: string
  /** 输入框右侧的操作按钮（如「恢复默认」）；跟随输入框底对齐 */
  trailing?: ReactNode
}

/** 光标位置：读不到就给 null，插入时按「追加到末尾」处理 */
interface Caret {
  start: number
  end: number
}

export default function NamePatternField({
  value,
  onChange,
  label = '命名模板',
  containerClassName,
  placeholder,
  trailing,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  /** 最后一次已知的光标位置；`null` = 用户还没在框里落过光标 */
  const caretRef = useRef<Caret | null>(null)

  const rememberCaret = () => {
    const input = inputRef.current
    if (!input) return
    caretRef.current = {
      start: input.selectionStart ?? value.length,
      end: input.selectionEnd ?? value.length,
    }
  }

  const insert = (token: PostprocessNameToken) => {
    const result = insertPostprocessNameToken(value, token, caretRef.current ?? undefined)
    onChange(result.pattern)
    // 受控 input 要等这次渲染提交后才能设光标，所以放到下一帧；顺便把焦点交回输入框，
    // 用户可以接着敲下一个变量（点按钮会让 input 失焦）
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(result.caret, result.caret)
      caretRef.current = { start: result.caret, end: result.caret }
    })
  }

  return (
    <div className={containerClassName}>
      <div className="flex items-end gap-2">
        <TextField
          ref={inputRef}
          label={label}
          containerClassName="min-w-0 flex-1"
          data-testid="name-pattern-input"
          value={value}
          placeholder={placeholder}
          onClick={rememberCaret}
          onKeyUp={rememberCaret}
          onSelect={rememberCaret}
          onBlur={rememberCaret}
          onChange={(event) => {
            const next = event.target.value
            onChange(next)
            // 键盘输入后事件里已经是新值，光标位置比 `useRef` 里的旧值可靠
            caretRef.current = {
              start: event.target.selectionStart ?? next.length,
              end: event.target.selectionEnd ?? next.length,
            }
          }}
        />
        {trailing}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {POSTPROCESS_NAME_TOKENS.map((token) => (
          <Button
            key={token}
            variant="ghost"
            size="sm"
            data-testid={`name-token-${token}`}
            title={`在光标处插入「${POSTPROCESS_NAME_TOKEN_LABELS[token]}」，占位符 {${token}}`}
            onClick={() => insert(token)}
          >
            {POSTPROCESS_NAME_TOKEN_SHORT_LABELS[token]}
          </Button>
        ))}
      </div>
    </div>
  )
}
