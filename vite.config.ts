/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { readFileSync } from 'fs'
import { fileURLToPath, URL } from 'node:url'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

/**
 * Node 大版本下限：`node:sqlite` 的 `DatabaseSync` 在 Node 22 下会被 Vite 当成
 * 浏览器模块外部化（报 `"DatabaseSync" is not exported by
 * "__vite-browser-external:node:sqlite"`），主进程拿到的 SQLite 是个空壳，
 * 之后任何写库都报 `attempt to write a readonly database`——**看症状像数据层故障，
 * 实际是启动 Node 版本不对**。这里直接拦住，把误导性报错换成明确指引。
 */
const MIN_NODE_MAJOR = 24
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
if (nodeMajor < MIN_NODE_MAJOR) {
  throw new Error(
    `\n\n[糖包] Node 版本过低：当前 v${process.versions.node}，需要 v${MIN_NODE_MAJOR} 或更高。\n` +
      `       否则主进程的 node:sqlite 会加载失败，症状是写库报 "readonly database"。\n` +
      `       解决：用 Node ${MIN_NODE_MAJOR}+ 启动，例如\n` +
      `         "C:\\Program Files\\nodejs\\node.exe" node_modules\\vite\\bin\\vite.js\n\n`,
  )
}

/**
 * 给 dev 的 electron 追加启动参数（可选，默认空）。
 *
 * 用途：需要**在真实 dev 数据上**做自动化检查时（水印库只存在 dev 那个 origin 的
 * localStorage 里，用 `electron .` 加载 `file://` 是读不到的），设
 * `TANGBAO_ELECTRON_ARGS="--remote-debugging-port=9333"` 再 `npm run dev`，
 * 即可用 CDP 驱动这个实例。
 *
 * 不设时**不注入 onstart**，走 vite-plugin-electron 的默认参数
 * （`['.', '--no-sandbox']`）—— 行为与原先逐字一致。
 */
const electronExtraArgs = (process.env.TANGBAO_ELECTRON_ARGS ?? '').split(' ').filter(Boolean)

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main.ts',
          // 只有显式设了 TANGBAO_ELECTRON_ARGS 才接管启动参数；否则不写 onstart，
          // 完全走插件默认（`['.', '--no-sandbox']），避免与插件升级后的默认值漂移。
          ...(electronExtraArgs.length > 0
            ? {
                onstart(args: { startup: (argv?: string[]) => void }) {
                  args.startup(['.', '--no-sandbox', ...electronExtraArgs])
                },
              }
            : {}),
          vite: {
            build: {
              outDir: 'dist-electron',
            },
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart(args) {
            args.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron/electron',
              emptyOutDir: false,
              // preload 必须输出单一 CJS 格式（sandbox 下不支持 ESM import）。
              // 不用 build.lib.formats：vite 的 mergeConfig 对数组是拼接而非覆盖，
              // 会与 vite-plugin-electron 按 package.json "type":"module" 推导出的默认
              // formats:["es"] 合并成 ["es","cjs"]，导致两种格式竞争写同一文件并损坏产物。
              rollupOptions: {
                input: 'electron/preload.ts',
                output: [
                  {
                    format: 'cjs',
                    inlineDynamicImports: true,
                    entryFileNames: 'preload.cjs',
                  },
                ],
              },
            },
          },
        },
        {
          entry: 'electron/asset-indexer.ts',
          onstart() {},
          vite: {
            build: {
              outDir: 'dist-electron/electron',
              emptyOutDir: false,
              lib: {
                entry: 'electron/asset-indexer.ts',
                formats: ['es'],
                fileName: () => 'asset-indexer.js',
              },
            },
          },
        },
        {
          entry: 'electron/catalog-worker.ts',
          onstart() {},
          vite: {
            build: {
              outDir: 'dist-electron/electron',
              emptyOutDir: false,
              lib: {
                entry: 'electron/catalog-worker.ts',
                formats: ['es'],
                fileName: () => 'catalog-worker.js',
              },
            },
          },
        },
      ]),
    ],
    base: './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      // jsdom（vitest 4）下 localStorage 缺失的最小 polyfill（见 vitest.setup.ts）
      setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))],
      // 固定测试时区为东八区：批次命名等按本地时间格式化（如 store.test.ts 的
      // 20260620-123456-batch-001），避免 CI（UTC）与本地（+8）结果不一致。
      env: { TZ: 'Asia/Shanghai' },
      // CI runner（2 核）上 fork worker 偶发崩溃（Worker exited unexpectedly）导致
      // 部分测试丢失，改为单进程串行执行保证发布流水线稳定。
      fileParallelism: false,
      maxWorkers: 1,
    },
    // 只从根 index.html 扫描依赖，避免把 dist-verify/、release/ 里的
    // 同名 index.html 当作多入口，导致 dep-scan 对无关目录报解析错误。
    optimizeDeps: {
      entries: [fileURLToPath(new URL('./index.html', import.meta.url))],
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      // Keep one exact development origin so Electron localStorage/IndexedDB
      // cannot drift to another project bound on a different loopback address.
      host: '127.0.0.1',
      port: 41731,
      strictPort: true,
      /**
       * 别监听生成物。
       *
       * `npm run test:coverage` 会往项目根写 coverage/（实测 39MB、上千个 HTML），而 vite 默认把
       * 项目根下的一切都纳入监听 → **每写一个文件就发一次整页刷新**。dev 日志里一次覆盖跑下来
       * 刷了几千次，正好命中那条铁律「HMR 整页刷新会打断进行中的生成/保存」。
       * `dist/` 是 `vite build` 的产物，dev 用不到，同理。
       *
       * ⚠️ 不要把 `dist-electron/` 加进来 —— vite-plugin-electron 靠它重启主进程。
       */
      watch: {
        ignored: ['**/coverage/**', '**/dist/**'],
      },
      proxy: devProxyConfig?.enabled
        ? {
            [devProxyConfig.prefix]: {
              target: devProxyConfig.target,
              changeOrigin: devProxyConfig.changeOrigin,
              secure: devProxyConfig.secure,
              rewrite: (path) =>
                path.replace(new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ''),
            },
          }
        : undefined,
    },
  }
})
