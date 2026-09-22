import { useEffect, useRef } from 'react'
import { executeDailyTarget, todayKey } from './execute'
import { useDailyBatchStore } from './store'

/**
 * 每日生成的自动执行器（挂在应用顶层，无界面）。
 *
 * 模式沿用「自动批量队列」那一套（`components/AgentBatchQueueRunner.tsx`）：
 * 应用运行期间每分钟看一眼，今天没跑过就跑一次，跑完记 `lastRunDate` 靠日期去重。
 *
 * ⚠️ 这意味着**应用关掉就不跑**（杰哥 2026-09-23 拍板）：没有主进程常驻调度，
 * 机器关机或休眠期间的任务不会被补跑。
 */
export default function DailyBatchRunner() {
  const runningRef = useRef(false)

  useEffect(() => {
    const run = async () => {
      if (runningRef.current) return
      const dateKey = todayKey()
      const state = useDailyBatchStore.getState()
      const pending = state.targets.filter(
        (target) => target.enabled && target.dailyTotal > 0 && !state.findRun(dateKey, target.productCollectionId),
      )
      if (pending.length === 0) return
      runningRef.current = true
      try {
        for (const target of pending) {
          await executeDailyTarget(dateKey, target)
        }
      } finally {
        runningRef.current = false
      }
    }

    // 启动后先等一会儿：此时项目树与 SOP 库还在水合，立刻跑会查不到节点
    const initialTimer = window.setTimeout(() => {
      void run()
    }, 5_000)
    const interval = window.setInterval(() => {
      void run()
    }, 60_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
    }
  }, [])

  return null
}
