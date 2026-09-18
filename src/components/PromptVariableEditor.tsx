// 注意：文件名保留自历史（原为「变量编辑器」）。
// 词条库与手打 {{}} 变量语法已于 2026-09-18 下线（见 docs/redundancy-audit.md），
// 本组件现在只做「可编辑提示词 + 图片 @ 引用高亮」。
import { useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  escapePromptHtmlAttribute,
  escapePromptHtmlText,
  getPromptMentionParts,
  getSelectedImageMentionLabel,
} from '../lib/promptImageMentions'

type PromptVariableEditorProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  autoFocus?: boolean
  selectOnFocus?: boolean
  spellCheck?: boolean
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

function getContentEditablePlainText(el: HTMLElement): string {
  let text = ''
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
      text += node.dataset.mentionText ?? node.textContent ?? ''
      return
    }
    node.childNodes.forEach(appendNodeText)
  }
  el.childNodes.forEach(appendNodeText)
  return text.replace(/\r\n?/g, '\n')
}

function renderPromptHtml(value: string) {
  return getPromptMentionParts(value, [])
    .map((part) => {
      if (part.type === 'mention') {
        const mentionText = part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0)
        return `<span contenteditable="false" class="mention-tag" data-mention-text="${escapePromptHtmlAttribute(mentionText)}">${escapePromptHtmlText(part.text)}</span>`
      }
      return escapePromptHtmlText(part.text)
    })
    .join('')
}

export default function PromptVariableEditor({
  value,
  onChange,
  className = '',
  autoFocus = false,
  selectOnFocus = false,
  spellCheck = false,
  onBlur,
  onClick,
  onKeyDown,
}: PromptVariableEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isUserInputRef = useRef(false)
  const renderedHtml = useMemo(() => renderPromptHtml(value), [value])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    if (el.innerHTML !== renderedHtml) el.innerHTML = renderedHtml
  }, [renderedHtml])

  useEffect(() => {
    if (!autoFocus) return
    const el = editorRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.focus()
      if (!selectOnFocus) return
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }, [autoFocus, selectOnFocus])

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      className={className}
      spellCheck={spellCheck}
      onInput={(event) => {
        isUserInputRef.current = true
        onChange(getContentEditablePlainText(event.currentTarget))
      }}
      onBlur={onBlur}
      onClick={onClick}
      onKeyDown={onKeyDown}
    />
  )
}
