// ESLint 9 flat config
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-verify/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      'build.log',
      '*.log',
      // 独立 Service Worker 脚本，使用 worker 全局（self/caches/fetch）
      'public/sw.js',
      // 开发工具脚本（Node 全局，未配置 node globals）
      'scripts/**/*.mjs',
      'scripts/**/*.cjs',
      // electron-builder 配置（Node 全局 module/process）
      'electron-builder.config.cjs',
      'electron-builder.cjs',
      // 临时浏览器 profile（Edge DevTools 等扩展内容脚本）
      'tmp-edge-profile2/**',
      // 项目工具临时文件
      '_drift_check.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Hooks 规则：rules-of-hooks 必须为 error（违反会破坏运行时行为）
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps 先以 warn 接入，避免一次性大量改动
      'react-hooks/exhaustive-deps': 'warn',
      // any 存量已清零，2026-09-18 从 warn 收紧为 error
      '@typescript-eslint/no-explicit-any': 'error',
      // 空接口保持宽松。
      // 未使用符号：2026-09-18 存量 114 处已全部清零，故从 warn 收紧为 error。
      // 它是「声称改了但调用点没换」这类半成品事故的唯一自动拦截点
      // （v0.8.19 的 db.ts 死 import 就是这么溜过 verify 并写进 RELEASE 的）。
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // 函数形参不报（回调与接口实现的噪音远大于信号）
          args: 'none',
          ignoreRestSiblings: true,
          // 不强制消费 catch 变量（空 catch 是有意的隔离语义）
          caughtErrors: 'none',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 存量噪音规则：已清零的重新收紧为 error；no-useless-assignment 尚待人工复核，保持 warn
      'no-useless-escape': 'error',
      'no-control-regex': 'error',
      'preserve-caught-error': 'error',
      'no-useless-assignment': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
)
