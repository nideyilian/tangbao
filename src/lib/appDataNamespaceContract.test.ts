import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// App Data Namespace Contract
//
// 渲染进程用 `createDesktopJsonStorage(namespace)` 落盘的每个 namespace，都必须出现在
// 主进程的 `APP_DATA_NAMESPACES` 白名单里（`electron/asset-kernel.ts`）。
//
// 为什么要这道守卫：白名单**只在主进程侧**校验，渲染进程没有任何编译期约束，漏配的症状很难定位：
//   1. 只在运行期出现：`Error occurred in handler for 'app-data:put': Error: invalid app data namespace`
//   2. `coalescedJsonStorage` 写入失败会**自动重试**，于是控制台持续刷屏
//   3. UI 完全不报错，用户只会发现「设置改完、重启就没了」
// 后处理面板就踩过这个坑（`postprocessMedia` 漏配，2026-09-17 修）。
// ---------------------------------------------------------------------------

/** store 模块的命名约定：`store*.ts` / `stores/*.ts` / `features/**\/store*.ts` */
const storeModules = {
  ...import.meta.glob('../store*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../stores/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../features/**/store*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

const NAMESPACE_CALL = /createDesktopJsonStorage\(\s*'([^']+)'\s*\)/g

function collectUsedNamespaces(): Array<{ namespace: string; module: string }> {
  const used: Array<{ namespace: string; module: string }> = []
  for (const [modulePath, source] of Object.entries(storeModules)) {
    if (modulePath.includes('.test.')) continue
    for (const match of source.matchAll(NAMESPACE_CALL)) {
      used.push({ namespace: match[1], module: modulePath })
    }
  }
  return used
}

function readAllowedNamespaces(): Set<string> {
  const kernelSource = readFileSync(fileURLToPath(new URL('../../electron/asset-kernel.ts', import.meta.url)), 'utf8')
  const start = kernelSource.indexOf('const APP_DATA_NAMESPACES = new Set([')
  if (start < 0) throw new Error('未找到 APP_DATA_NAMESPACES 定义，请同步更新本守卫')
  const end = kernelSource.indexOf('])', start)
  if (end < 0) throw new Error('APP_DATA_NAMESPACES 定义不完整，请同步更新本守卫')
  return new Set([...kernelSource.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]))
}

describe('app data namespace 契约', () => {
  it('守卫本身有覆盖面，避免 glob 与项目结构脱节后静默失效', () => {
    const scanned = Object.keys(storeModules)
    expect(scanned.some((modulePath) => modulePath.includes('storePostprocessMedia'))).toBe(true)
    expect(scanned.some((modulePath) => modulePath.includes('features/'))).toBe(true)
  })

  it('白名单解析结果非空，避免守卫假通过', () => {
    expect(readAllowedNamespaces().size).toBeGreaterThan(5)
  })

  it('每个落盘用的 namespace 都在主进程白名单里', () => {
    const allowed = readAllowedNamespaces()
    const missing = collectUsedNamespaces()
      .filter((entry) => !allowed.has(entry.namespace))
      .map((entry) => `${entry.module}: ${entry.namespace}`)

    expect(missing).toEqual([])
  })
})
