// 死符号棘轮门禁：存量允许、新增拦截。
//
// 背景（docs/pm-upgrade-plan.md P2-1）：
// tsconfig 的 noUnusedLocals / noUnusedParameters 关着，eslint 的 no-unused-vars 只是 warn
// —— 结果一个「只加了 import、没换调用点」的性能修复能一路混过 npm run verify 并写进 RELEASE.md。
// 一次性清掉存量风险大（116 处，且部分涉及局部变量赋值不能盲删），所以改用棘轮：
// 存量数字写进 baseline，**只许减少，不许增加**。
//
// 用法：
//   node scripts/check-unused-symbols.mjs            # 校验（CI 与本地用）
//   node scripts/check-unused-symbols.mjs --update   # 清理完存量后刷新基线

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'scripts', 'unused-symbols-baseline.json')

// 纳入棘轮的规则：死符号 + 类型逃逸。其余规则（如 no-useless-assignment）暂不纳入。
const TRACKED = ['@typescript-eslint/no-unused-vars', '@typescript-eslint/no-explicit-any']

function collectCounts() {
  let raw = ''
  try {
    raw = execFileSync('npx', ['eslint', '.', '-f', 'json'], {
      cwd: root,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    })
  } catch (error) {
    // eslint 有 error 级问题时退出码非 0，但 stdout 仍有完整 JSON —— 继续解析。
    raw = error.stdout ?? ''
    if (!raw) throw error
  }

  const results = JSON.parse(raw)
  const counts = Object.fromEntries(TRACKED.map((rule) => [rule, 0]))
  const samples = Object.fromEntries(TRACKED.map((rule) => [rule, []]))

  for (const file of results) {
    for (const message of file.messages) {
      if (!TRACKED.includes(message.ruleId)) continue
      counts[message.ruleId] += 1
      if (samples[message.ruleId].length < 3) {
        samples[message.ruleId].push(`${file.filePath.replace(root, '').replace(/\\/g, '/')}:${message.line}`)
      }
    }
  }

  return { counts, samples }
}

const { counts, samples } = collectCounts()

if (process.argv.includes('--update')) {
  const payload = {
    note: '死符号棘轮基线：只许减少，不许增加。清理完存量后用 --update 刷新。',
    updatedAt: new Date().toISOString().slice(0, 10),
    counts,
  }
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  console.log(`[ratchet] 基线已更新：${JSON.stringify(counts)}`)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  console.error('[ratchet] 缺少基线文件，先跑：node scripts/check-unused-symbols.mjs --update')
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')).counts ?? {}
let failed = false

for (const rule of TRACKED) {
  const now = counts[rule] ?? 0
  const allowed = baseline[rule] ?? 0
  if (now > allowed) {
    failed = true
    console.error(`[ratchet] ✗ ${rule}：${now} 处，基线 ${allowed}（**新增 ${now - allowed} 处**）`)
    for (const sample of samples[rule]) console.error(`          例：${sample}`)
  } else {
    const delta = allowed - now
    const suffix = delta > 0 ? `（已减少 ${delta} 处，可用 --update 收紧基线）` : ''
    console.log(`[ratchet] ✓ ${rule}：${now} / ${allowed}${suffix}`)
  }
}

if (failed) {
  console.error(
    '\n[ratchet] 死符号或 any 比基线更多。请在本次改动里清掉新增的那些（多半是删了调用点却没删 import）。',
  )
  process.exit(1)
}

console.log('[ratchet] 通过。')
