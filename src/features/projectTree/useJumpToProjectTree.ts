/**
 * 「去项目树启用」：从别的工作区跳到项目树工作台，并把它定位到某一行。
 *
 * 为什么需要它：**启用范围只能在项目树的「后处理」列勾选**。「后处理」弹窗里那条
 * 「这个方向不在启用范围内，下面的设置都不会产出」如果只说不动，用户就得自己回素材库、
 * 点「项目树」、再在几十行里翻出那个方向 —— 规范里只读/不可改的项必须指出**下一步怎么走**
 * （MASTER §5.6 的同一口径），所以这里给的是**真能到那儿**的入口。
 *
 * 两件事必须一起做，缺一个就是「假跳」：
 * 1. 打开工作台并带上焦点节点（`projectTreeWorkbench`，工作台用它预填搜索关键词）；
 * 2. 切到素材库模式 —— 工作台挂在资产库工具栏里，不在那个模式时它根本不渲染。
 */

import { useCallback } from 'react'
import { useStore } from '../../store'

export function useJumpToProjectTree(): (focusId?: string | null) => void {
  const appMode = useStore((state) => state.appMode)
  const setAppMode = useStore((state) => state.setAppMode)
  const openProjectTreeWorkbench = useStore((state) => state.openProjectTreeWorkbench)

  return useCallback(
    (focusId?: string | null) => {
      openProjectTreeWorkbench(focusId ?? null)
      // 已经在素材库时**不重复切**：`setAppMode('gallery')` 会保存并恢复输入草稿，
      // 对着自己切一次是白跑一趟（还可能把当前输入重置）。
      if (appMode !== 'gallery') setAppMode('gallery')
    },
    [appMode, setAppMode, openProjectTreeWorkbench],
  )
}
