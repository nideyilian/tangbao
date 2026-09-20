/**
 * 由 UTF-8 源生成 GBK + CRLF 的 `start.bat`。
 *
 * 为什么需要这个脚本（见 docs/tangbao-ops-runbook.md §18）：
 *   cmd.exe 按「当前活动代码页」（本机 936）读取整个批处理文件，且要求 CRLF 行尾。
 *   - 文件若是 UTF-8 无 BOM：中文被解成乱码，乱码字节含引号/括号时，
 *     cmd 会把碎片当命令执行（满屏 `'xxx' 不是内部或外部命令`）。
 *   - 文件若只有 LF 行尾：**cmd 会把多行拼成一行**，症状与上面几乎一样，更难排查。
 *   两者都会让「双击 start.bat 没反应」。
 *
 * 为什么要有「UTF-8 源」这个中间文件：
 *   直接编辑 GBK 的 start.bat 会因编辑器/工具编码不一致反复踩坑；
 *   而本脚本**只能对 UTF-8 源跑**——把已是 GBK 的文件按 utf8 读会得到一堆 `?`（0x3f），
 *   中文永久丢失。所以约定：**改 `scripts/start.bat.utf8-source.txt`，再跑本脚本生成**。
 *
 * 用法：
 *   node scripts/build-start-bat.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import iconv from 'iconv-lite'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')
const source = join(here, 'start.bat.utf8-source.txt')
const target = join(projectRoot, 'start.bat')

const utf8 = readFileSync(source, 'utf8')
if (utf8.includes('\uFFFD')) {
  throw new Error(`${source} 含替换字符（U+FFFD）——它可能已不是合法 UTF-8。请检查来源文件。`)
}

// 统一成 CRLF（先归一成 LF 再转，避免已有 CRLF 被翻成 CRCRLF）
const withCrlf = utf8.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')

// 转 GBK 前先自查：有没有 GBK 表达不了的字符（emoji、→、⇒ 之类会静默变成 ?）
const gbk = iconv.encode(withCrlf, 'gbk')
const roundTrip = iconv.decode(gbk, 'gbk')
if (roundTrip !== withCrlf) {
  // 逐位对比找出丢失的字符。注意长度可能变化（一个字符被替换成 '?' 仍是 1:1，
  // 但某些实现会丢字节），所以同时报「首个差异位置」与「出现过的可疑字符」。
  let firstDiff = -1
  const limit = Math.min(roundTrip.length, withCrlf.length)
  for (let i = 0; i < limit; i += 1) {
    if (roundTrip[i] !== withCrlf[i]) {
      firstDiff = i
      break
    }
  }
  if (firstDiff === -1) firstDiff = limit
  const badChars = [...new Set([...withCrlf.slice(firstDiff, firstDiff + 200)])]
    .filter((ch) => !/[\x00-\x7F\r\n]/.test(ch))
    .slice(0, 10)
  throw new Error(
    `源文件含 GBK 无法表示的字符（emoji / 全角箭头等）。首个差异在第 ${firstDiff} 字符处，` +
      `附近可疑字符：${JSON.stringify(badChars)}\n` +
      `批处理文件里请改用 ASCII 标记（例如 ⚠️ → [!]、→ → ->、⇒ → =>）。`,
  )
}

writeFileSync(target, gbk)
console.log(`[ok] ${target}  <- ${source}  (GBK + CRLF, ${gbk.length} bytes)`)
console.log('     自检：head -c 30 start.bat | xxd    # 行尾应为 0d0a')
