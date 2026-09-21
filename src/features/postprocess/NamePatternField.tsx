/**
 * 命名模板输入框 + 变量按钮（后处理设置与项目节点参数共用）。
 *
 * 四条约定：
 * 1. 框里显示**中文**（`{日期}-{产品}-…`），存的是 `{date}-{product}-…`。模板是落盘格式
 *    （会被产出文件名、导出/导入的配置引用），换成中文会让所有已配好的模板一起失效，
 *    所以中文只是显示层，双向转换见 `lib/postprocessNaming` 的 `to/fromDisplayNamePattern`。
 * 2. 变量按钮显示中文、插入的仍是底层占位符。插入位置取**光标所在处**（有选区就替换选区），
 *    而不是无脑追加末尾 —— 往模板中间补一个变量是常态。
 * 3. 光标位置记在 ref 里而不是现读 DOM：点按钮时输入框已经失焦，此时再读 `selectionStart`
 *    会被浏览器归零，结果就是「不管点哪儿都插到开头」。
 * 4. **两套光标坐标系**：`caretRef` 存的是**底层模板**的坐标（插入函数操作的就是底层串），
 *    DOM 里的是显示串坐标，两者随时互转。中文比英文短（`{日期}` 4 字符 vs `{date}` 6 字符），
 *    拿 DOM 坐标直接去插会错位。
 *
 * 两个入口共用同一份实现，避免「设置面板里能插中间、节点参数里只能追加」这种两套手感。
 */

import { useRef, type ReactNode } from 'react'
import { Button, TextField } from '../../design-system'
import {
  POSTPROCESS_NAME_TOKENS,
  POSTPROCESS_NAME_TOKEN_LABELS,
  POSTPROCESS_NAME_TOKEN_SHORT_LABELS,
  fromDisplayNamePattern,
  insertPostprocessNameToken,
  toDisplayNamePattern,
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
  /** 最后一次已知的光标位置（**底层模板**坐标）；`null` = 用户还没在框里落过光标 */
  const caretRef = useRef<Caret | null>(null)
  /** 中文输入法组合期间不碰光标：此时改选区会打断打字 */
  const composingRef = useRef(false)

  const display = toDisplayNamePattern(value)

  /** 显示串坐标 → 底层模板坐标 */
  const toStoredCaret = (displayCaret: number) =>
    fromDisplayNamePattern(display.slice(0, Math.max(0, displayCaret))).length

  const rememberCaret = () => {
    const input = inputRef.current
    if (!input) return
    caretRef.current = {
      start: toStoredCaret(input.selectionStart ?? display.length),
      end: toStoredCaret(input.selectionEnd ?? display.length),
    }
  }

  /**
   * 把光标移到显示串的某个位置。
   *
   * `focus` / `setSelectionRange` 都先判存在：受控 input 在非浏览器宿主（单测的
   * react-test-renderer）里拿到的是个没有这两个方法的替身，不判会直接抛在下一帧里 ——
   * 那是个跟本次编辑毫无关系的报错，排查起来很费劲。
   */
  const applyDisplayCaret = (caret: number) => {
    const input = inputRef.current
    if (!input) return
    if (typeof input.focus === 'function') input.focus()
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(caret, caret)
  }

  const insert = (token: PostprocessNameToken) => {
    const result = insertPostprocessNameToken(value, token, caretRef.current ?? undefined)
    onChange(result.pattern)
    // 受控 input 要等这次渲染提交后才能设光标，所以放到下一帧；顺便把焦点交回输入框，
    // 用户可以接着敲下一个变量（点按钮会让 input 失焦）
    const displayCaret = toDisplayNamePattern(result.pattern.slice(0, result.caret)).length
    requestAnimationFrame(() => {
      applyDisplayCaret(displayCaret)
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
          value={display}
          placeholder={placeholder}
          onClick={rememberCaret}
          onKeyUp={rememberCaret}
          onSelect={rememberCaret}
          onBlur={rememberCaret}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onChange={(event) => {
            const nextDisplay = event.target.value
            const displayCaret = event.target.selectionStart ?? nextDisplay.length
            const displayCaretEnd = event.target.selectionEnd ?? displayCaret
            const stored = fromDisplayNamePattern(nextDisplay)
            onChange(stored)
            // 键盘输入后事件里已经是新值，光标位置比 `useRef` 里的旧值可靠；
            // 存进去的是底层坐标，插入时才不会用错坐标系
            caretRef.current = {
              start: fromDisplayNamePattern(nextDisplay.slice(0, displayCaret)).length,
              end: fromDisplayNamePattern(nextDisplay.slice(0, displayCaretEnd)).length,
            }
            // 手打英文占位符（`{date}`）或中文占位符时，显示串会被规范化、长度随之变化，
            // 这时要按「光标之前那一段转换后的长度」重新定位，否则光标会跳到末尾。
            // 常规打字不会走到这里（规范化前后同一个串），所以不影响输入流畅度。
            if (composingRef.current) return
            if (toDisplayNamePattern(stored) !== nextDisplay) {
              const mapped = toDisplayNamePattern(fromDisplayNamePattern(nextDisplay.slice(0, displayCaret))).length
              requestAnimationFrame(() => applyDisplayCaret(mapped))
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
