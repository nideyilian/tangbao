import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 用 fs 直读而不是 `?raw` 导入：CSS 的 `?raw` 在 vitest 下会被 CSS 管线处理，
// 拿到的不是源文本（实测 `:root {` 找不到）。文档一致性校验必须看**源码原文**。
const readSource = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const stylesCss = readSource('./styles.css')
const masterMd = readSource('../../design-system/tangbao/MASTER.md')

// 文档一致性回归：MASTER.md §4.2 的颜色表必须与 styles.css 的实现值逐行吻合。
//
// 背景：2026-09-19 审计发现该表 26 个值里有 24 个是过期数据（例如文档写 Canvas #F9FAFB、
// 实现已是 #F2F4F7），说明书与实现长期分叉。人肉同步不可靠，改为测试强制。
// 见 docs/RISK.md R-41。

/** 解析某个选择器块内的 --ds-color-* 通道值。 */
function parseColorBlock(startMarker: string): Record<string, [number, number, number]> {
  const start = stylesCss.indexOf(startMarker)
  if (start < 0) throw new Error(`styles.css 中找不到块：${startMarker}`)
  const end = stylesCss.indexOf('}', start)
  const block = stylesCss.slice(start, end)
  const out: Record<string, [number, number, number]> = {}
  for (const m of block.matchAll(/--ds-color-([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}

/** HSL（通道值）→ 大写 hex。与实现同一套换算，避免「等效值」误判。 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}

/** §4.2 表格里的「语义名 → 文档列标题」映射（语义名必须与 Token 名一致）。 */
const DOC_ROWS: Array<{ token: string; label: string }> = [
  { token: 'canvas', label: 'Canvas' },
  { token: 'surface', label: 'Surface' },
  { token: 'surface-subtle', label: 'Surface subtle' },
  { token: 'surface-raised', label: 'Surface raised' },
  { token: 'text', label: 'Text' },
  { token: 'text-muted', label: 'Text muted' },
  { token: 'text-subtle', label: 'Text subtle' },
  { token: 'border', label: 'Border' },
  { token: 'border-strong', label: 'Border strong' },
  { token: 'primary', label: 'Primary' },
  { token: 'primary-hover', label: 'Primary hover' },
  { token: 'primary-subtle', label: 'Primary subtle' },
  { token: 'success', label: 'Success' },
  { token: 'warning', label: 'Warning' },
  { token: 'danger', label: 'Danger' },
  { token: 'info', label: 'Info' },
  { token: 'selection-surface', label: 'Selection surface' },
  { token: 'selection-border', label: 'Selection border' },
  { token: 'focus', label: 'Focus' },
  { token: 'scrim', label: 'Scrim' },
]

/** 从 Markdown 行里取出「标签 → [浅色, 深色]」的 hex。 */
function readDocRow(label: string): [string, string] | null {
  for (const line of masterMd.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
    if (cells.length < 3) continue
    if (cells[0] !== label) continue
    const strip = (s: string) => s.replaceAll('`', '').trim()
    return [strip(cells[1]), strip(cells[2])]
  }
  return null
}

describe('MASTER.md §4.2 颜色表与实现一致', () => {
  const light = parseColorBlock(':root {')
  const dark = parseColorBlock('.dark {')

  for (const { token, label } of DOC_ROWS) {
    it(`${label}（--ds-color-${token}）文档值与实现一致`, () => {
      const impl = light[token]
      const implDark = dark[token]
      expect(impl, `styles.css 缺少浅色 --ds-color-${token}`).toBeDefined()
      expect(implDark, `styles.css 缺少深色 --ds-color-${token}`).toBeDefined()

      const documented = readDocRow(label)
      expect(documented, `MASTER.md §4.2 缺少行：${label}`).not.toBeNull()

      expect(documented![0]).toBe(hslToHex(...impl))
      expect(documented![1]).toBe(hslToHex(...implDark))
    })
  }
})
