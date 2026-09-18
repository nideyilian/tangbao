/** 转义正则元字符（字面量匹配用）。此前 variablePromptMeta / generatedImageFilename / localSave 各有一份。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
