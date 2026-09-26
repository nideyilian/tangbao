/**
 * 引擎状态 hook：回答「能不能出视频、用的是哪份 ffmpeg」。
 *
 * ## 为什么要单独一个 hook
 *
 * 「引擎在不在位」这件事有两层：进程层面的可用性（exe 在不在、能不能起来），
 * 以及环境层面的事实（ffmpeg 到底是系统那份还是引擎自带那份）。后者尤其重要 ——
 * 引擎优先用系统 PATH 里的 ffmpeg，用户机上那份可能是几年前的版本，
 * 出问题时现象是「编码参数不支持」，而界面上什么线索都没有。
 *
 * 所以这个 hook 把「引擎当前用的 ffmpeg 路径与版本」也取回来放在界面上。
 *
 * ## 探测失败不报错
 *
 * 拿不到环境快照（引擎起不来、探测超时）时，只把 `status.available` 那一层如实呈现，
 * 不弹错误 —— 用户此时更需要知道的是「能不能用」，而不是「探测为什么失败」。
 */

import { useCallback, useEffect, useState } from 'react'
import type { ImageVideoEngineStatus } from './engineTypes'

export interface ImageVideoEngineState {
  status: ImageVideoEngineStatus | null
  /** 首次查询还没回来 */
  loading: boolean
  /** 刷新（用户点「重新检测」时用） */
  refresh: () => Promise<void>
}

export function useImageVideoEngine(): ImageVideoEngineState {
  const [status, setStatus] = useState<ImageVideoEngineStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api?.imageVideoStatus) {
      setStatus(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setStatus(await api.imageVideoStatus())
    } catch {
      // 查询本身失败（IPC 断了）：留 null，界面按「不可用」处理
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, loading, refresh }
}
