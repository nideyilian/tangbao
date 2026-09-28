import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzePoolImage } from './poolAnalysis'
import {
  createEmptySelection,
  createPoolAssetRef,
  createPoolId,
  deletePoolAssets,
  readPoolAssets,
  readPools,
  writePoolAsset,
  writePools,
} from './poolStorage'
import {
  clampPoolName,
  type CreativePool,
  type CreativePoolItem,
  type CreativePoolKind,
  type CreativePoolSelection,
} from './types'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export interface CreativePoolController {
  /** 当前池的项（已按池内顺序）。**容量不设上限**，可以一直往里丢。 */
  items: CreativePoolItem[]
  /** 资产引用 id → dataUrl（缩略图与提交都用它） */
  assets: Map<string, string>
  /** 随机抽签的张数上限；`null` = 不限（上限即池子大小） */
  maxRandomCount: number | null
  /**
   * 这次生图用池里的哪些图。
   *
   * ⚠️ **持久化在池子里**，不是组件 state —— 只放组件 state 时，任何一次热更新 / 重挂都会清空它，
   * 用户勾了也「看起来没勾」，而提交只是静默走普通生图：不报错、不留痕，极难排查。
   */
  selection: CreativePoolSelection
  /** 首次读取池数据中 */
  loading: boolean
  /** 分析进度文案；空串表示空闲 */
  analyzing: string
  /** 最近一次操作的提示（成功或失败都走它，面板直接展示） */
  notice: string
  addImages: (files: File[]) => Promise<void>
  removeItem: (itemId: string) => Promise<void>
  renameItem: (itemId: string, name: string) => Promise<void>
  setMaxRandomCount: (value: number | null) => Promise<void>
  setSelection: (next: CreativePoolSelection) => Promise<void>
}

/**
 * 风格池的状态与存储入口。
 *
 * 收在这里而不是写进 `store.ts`：池是独立于「生图状态机」的一块数据，
 * 放进去只会让那个已经很大的 store 继续膨胀（AGENTS.md 明令勿继续膨胀）。
 *
 * 数据流向始终是「磁盘 → state → 磁盘」：任何改动都先落盘成功再更新界面，
 * 免得界面显示成功、重启却回到旧值。
 */
export function useCreativePool(kind: CreativePoolKind = 'style'): CreativePoolController {
  const [pools, setPools] = useState<CreativePool[]>([])
  const [assets, setAssets] = useState<Map<string, string>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState('')
  const [notice, setNotice] = useState('')
  const runningRef = useRef(false)
  // 供回调读取「此刻最新的池」，避免闭包里拿到过期数组
  const poolsRef = useRef<CreativePool[]>([])

  const findPool = useCallback((from: CreativePool[]) => from.find((pool) => pool.kind === kind), [kind])

  const items = useMemo(() => findPool(pools)?.items ?? [], [findPool, pools])
  const maxRandomCount = useMemo(() => findPool(pools)?.maxRandomCount ?? null, [findPool, pools])
  const selection = useMemo(() => findPool(pools)?.selection ?? createEmptySelection(), [findPool, pools])

  useEffect(() => {
    let cancelled = false
    void readPools().then((loaded) => {
      if (cancelled) return
      poolsRef.current = loaded
      setPools(loaded)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 只在「项集合」变化时重读资产（改名 / 改选中都不换 assetRef，因此不会触发）
  const assetKey = items.map((item) => item.assetRef).join(',')
  useEffect(() => {
    const refs = assetKey ? assetKey.split(',') : []
    if (refs.length === 0) {
      setAssets(new Map())
      return
    }
    let cancelled = false
    void readPoolAssets(refs).then((loaded) => {
      if (!cancelled) setAssets(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [assetKey])

  /**
   * 落盘并更新当前 kind 的池（**池项、池设置、选中态都走它**，只有一个写入口）。
   * 写失败返回 false，调用方据此提示 —— 不静默当成成功。
   */
  const commitPool = useCallback(
    async (patch: Partial<Omit<CreativePool, 'kind'>>): Promise<boolean> => {
      const base = poolsRef.current.length > 0 ? poolsRef.current : await readPools()
      const nextPools = base.map((pool) => (pool.kind === kind ? { ...pool, ...patch } : pool))
      const written = await writePools(nextPools)
      if (!written) {
        setNotice('保存失败：本次改动没有落盘，重启后会回到改动前的状态')
        return false
      }
      poolsRef.current = nextPools
      setPools(nextPools)
      return true
    },
    [kind],
  )

  const commitItems = useCallback((next: CreativePoolItem[]) => commitPool({ items: next }), [commitPool])

  const currentItems = useCallback(() => findPool(poolsRef.current)?.items ?? [], [findPool])

  /**
   * 丢图入池：逐张分析（起名 + 要点）→ 直接入池。**不设容量上限**。
   *
   * 逐张容错：某张分析失败（图片损坏 / 模型抽风）不该让整批白跑，
   * 成功的照常入池，失败的汇总成一句提示。
   */
  const addImages = useCallback(
    async (files: File[]) => {
      if (runningRef.current) return
      const images = files.filter((file) => file.type.startsWith('image/'))
      if (images.length === 0) return
      runningRef.current = true
      setNotice('')
      const created: CreativePoolItem[] = []
      const createdAssets = new Map<string, string>()
      const failures: string[] = []
      try {
        for (let index = 0; index < images.length; index += 1) {
          const file = images[index]
          setAnalyzing(`正在分析第 ${index + 1}/${images.length} 张…`)
          try {
            const dataUrl = await readFileAsDataUrl(file)
            const analysis = await analyzePoolImage(kind, { name: file.name, dataUrl })
            const now = Date.now()
            created.push({
              id: createPoolId(),
              name: analysis.name,
              assetRef: createPoolAssetRef(),
              points: analysis.points,
              createdAt: now,
              updatedAt: now,
            })
            createdAssets.set(created[created.length - 1].assetRef, dataUrl)
          } catch (cause) {
            failures.push(`${file.name}：${cause instanceof Error ? cause.message : String(cause)}`)
          }
        }

        if (created.length === 0) {
          setNotice(failures[0] ? `入池失败 —— ${failures[0]}` : '没有可入池的图片')
          return
        }

        // 图先落盘：元数据一旦写入，界面就会去读这些引用，图不在就会是空格子
        for (const [assetRef, dataUrl] of createdAssets) await writePoolAsset(assetRef, dataUrl)
        const written = await commitItems([...created, ...currentItems()])
        if (!written) return

        setNotice(
          failures.length > 0
            ? `已入池 ${created.length} 张；${failures.length} 张失败 —— ${failures[0]}`
            : `已入池 ${created.length} 张：${created.map((item) => item.name).join('、')}`,
        )
      } finally {
        setAnalyzing('')
        runningRef.current = false
      }
    },
    [commitItems, currentItems, kind],
  )

  const removeItem = useCallback(
    async (itemId: string) => {
      const current = currentItems()
      const target = current.find((item) => item.id === itemId)
      if (!target) return
      const written = await commitItems(current.filter((item) => item.id !== itemId))
      // 元数据删成功后再删图；顺序反了会留下「有元数据、没图」的空格子
      if (!written) return
      await deletePoolAssets([target.assetRef])
      // 勾选残留要一并清掉：留着它会让界面写着「已选 1 张」而实际发不出去
      const stale = findPool(poolsRef.current)?.selection
      if (stale?.selectedIds.includes(itemId)) {
        await commitPool({ selection: { ...stale, selectedIds: stale.selectedIds.filter((id) => id !== itemId) } })
      }
    },
    [commitItems, commitPool, currentItems, findPool],
  )

  const renameItem = useCallback(
    async (itemId: string, name: string) => {
      const clean = clampPoolName(name)
      if (!clean) {
        setNotice('名字不能为空')
        return
      }
      const current = currentItems()
      const target = current.find((item) => item.id === itemId)
      if (!target || target.name === clean) return
      await commitItems(
        current.map((item) => (item.id === itemId ? { ...item, name: clean, updatedAt: Date.now() } : item)),
      )
    },
    [commitItems, currentItems],
  )

  /** 设置随机抽签上限；传 `null` / 非正数 = 不限。 */
  const setMaxRandomCount = useCallback(
    async (value: number | null) => {
      const clean = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
      await commitPool({ maxRandomCount: clean })
    },
    [commitPool],
  )

  /** 更新选中态：只留池内真实存在的 id（删图后的残留勾选自动被清掉）。 */
  const setSelection = useCallback(
    async (next: CreativePoolSelection) => {
      const valid = new Set(currentItems().map((item) => item.id))
      await commitPool({
        selection: {
          mode: next.mode === 'random' ? 'random' : 'manual',
          selectedIds: [...new Set(next.selectedIds.filter((id) => valid.has(id)))],
          randomCount: Math.max(1, Math.floor(next.randomCount) || 1),
        },
      })
    },
    [commitPool, currentItems],
  )

  return {
    items,
    assets,
    maxRandomCount,
    selection,
    loading,
    analyzing,
    notice,
    addImages,
    removeItem,
    renameItem,
    setMaxRandomCount,
    setSelection,
  }
}
