/**
 * 「去中控台改」：从别的工作区跳到中控台，并指定落在哪个分区。
 *
 * 为什么需要它：**不是所有参数都能在本地改**（例如「后处理」弹窗只放方向级参数，
 * 渠道与尺寸 / 画面方向 / 命名模板 / 分发都在中控台）。规范里只读项必须指出下一步
 * （MASTER §5.6 EmptyState 的同一口径），所以给一个**能真的到那儿**的入口，
 * 而不是一句「请到中控台修改」的文案。
 *
 * 两个动作必须一起做，否则跳过去会落在默认分区上，等于没跳：
 * 1. 写一次性跳转意图（`controlConsoleSection`，`CompositeWorkspace` 消费后清空）；
 * 2. 切到 `postprocess` 工作区。
 *
 * 用 `useStore` 的选择器订阅而不是 `useStore.getState()`：这样调用方（弹窗内的按钮）
 * 能跟着 store 变化重渲染，也不会在组件外偷跑副作用。
 */

import { useCallback } from 'react'
import { useStore } from '../../../store'
import type { ControlConsoleSectionId } from './controlConsoleSections'

export function useJumpToControlConsole(): (section: ControlConsoleSectionId) => void {
  const setAppMode = useStore((state) => state.setAppMode)
  const setControlConsoleSection = useStore((state) => state.setControlConsoleSection)

  return useCallback(
    (section: ControlConsoleSectionId) => {
      setControlConsoleSection(section)
      setAppMode('postprocess')
    },
    [setAppMode, setControlConsoleSection],
  )
}
