/**
 * 从 contentEditable 元素取**纯文本**（图片提及 `mention-tag` 按其标注文本取值）。
 *
 * 此前 `InputBar.tsx` 与 `PromptVariableEditor.tsx` 各有一份逐字相同的实现，此处为唯一实现。
 */
export function getContentEditablePlainText(el: HTMLElement): string {
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
