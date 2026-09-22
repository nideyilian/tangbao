/**
 * 通用 CDP 求值：把一段表达式丢进**已启动**的糖包渲染进程里执行，回显结果。
 *
 * 什么时候用：需要在**真实运行的应用**上查状态 / 驱动一次操作时（详见运维手册 §二十四）。
 * 典型场景是查「值到底存成什么了」—— 只读代码只能在「实现本该如此」的层面打转。
 *
 * 用法（先让应用带调试端口起来）：
 *   TANGBAO_ELECTRON_ARGS="--remote-debugging-port=9333 --disable-gpu" npm run dev
 *   node scripts/cdp-eval.mjs "location.href"
 *   node scripts/cdp-eval.mjs "(async () => { const raw = localStorage.getItem('…'); return JSON.stringify({…}) })()"
 *
 * - 端口用环境变量 `CDP_PORT` 覆盖（默认 9333）。
 * - 表达式**不支持顶层 await**，要包成 async IIFE —— 本脚本已开 `awaitPromise`。
 * - 只读查询直接用；会改状态的操作（点按钮、调 IPC）自己确认清楚再做。
 */
import http from 'node:http'

const PORT = Number(process.env.CDP_PORT ?? 9333)
const expression = process.argv.slice(2).join(' ')
if (!expression) {
  console.error('用法: node scripts/cdp-eval.mjs "<js 表达式>"')
  process.exit(1)
}

const getJson = (targetPath) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: targetPath }, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error(data.slice(0, 300)))
          }
        })
      })
      .on('error', reject)
  })

const targets = await getJson('/json/list').catch((error) => {
  console.error(`连不上 127.0.0.1:${PORT}（${error.message}）`)
  console.error(`提示：应用要先带 --remote-debugging-port=${PORT} 启动，见运维手册 §二十四。`)
  process.exit(1)
})

const page = targets.find((target) => target.type === 'page' && !target.url.startsWith('devtools://'))
if (!page) {
  console.error('没找到页面目标，当前 targets:', JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url }))))
  process.exit(1)
}
// 页面 URL 是 file:// 说明这是用构建产物起的实例 —— 它的 localStorage 与 dev 不是同一个 origin，
// 水印库那类只存在 localStorage 的数据会读成空。运维手册 §二十四 第 1 节。
if (page.url.startsWith('file://')) {
  console.error(`⚠️ 当前页面是 ${page.url}`)
  console.error('   这是 file:// origin，读不到 dev 的 localStorage（水印库会显示为空）。')
  console.error('   需要真实数据时请用 TANGBAO_ELECTRON_ARGS=… npm run dev 启动。')
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

let messageId = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++messageId
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })

const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
if (result.result?.exceptionDetails) {
  console.error('页面异常:', JSON.stringify(result.result.exceptionDetails).slice(0, 900))
  process.exitCode = 1
} else {
  const value = result.result?.result?.value
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}
socket.close()
