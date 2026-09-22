import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getBrowserStorage } from '../lib/browserStorage'

/**
 * 树节点的折叠状态：本地持久化（localStorage，纯 UI 偏好）。
 *
 * **三棵树共用这一份**（中控台项目树 / 画廊左侧栏 / SOP 分组树）。原先各写各的：
 * 一份私有在 `AssetLibrarySidebar`、一份私有在 `SopLibraryTab`，两份都直接读
 * `window.localStorage`（违反架构约束七·六「`lib/browserStorage.ts` 是 localStorage 唯一入口」）。
 *
 * ## 为什么走 localStorage，而不是落盘数据库
 *
 * 折叠状态是「我这台机器上想怎么看」，不是业务数据 —— 它不该跟着配置包走、也不该进
 * `app_data_records`。仓库既有口径如此（侧栏面板宽度、SOP 分组折叠都存本地）。
 *
 * ## 语义：记「折叠的」，不记「展开的」
 *
 * 三棵树都是**默认展开**，所以只记被折起来的那几个。这个选择直接解决三件事：
 *
 * - 存档读不到 / 坏了 → 空集合 = 全展开 = 默认行为（**不会因为存档坏掉把整棵树折起来**）；
 * - **新增节点自动是展开的**（新 id 不在集合里），不需要任何「补一条」的逻辑；
 * - **存档体积只跟「折叠了几个」有关，与树的大小无关** —— 树长到几千节点也不会因此变慢，
 *   而且「重命名不影响」是白送的：按 `id` 记，不按名字记。
 *
 * ## 失效 id 怎么清
 *
 * 传了 `validIds` 时，每次写回前先跟它求交集 —— 删掉的节点不会在存档里无限累积。
 * **在写回时清、不在渲染时清**：渲染期改 state 会引入额外的重渲染。
 * 传 `undefined` = 不过滤。
 *
 * ⚠️ 调用方注意：「进回收站」的节点仍算「存在」（别只传树上可见的 id），
 * 否则把它恢复回来时折叠状态就没了。
 */
export function usePersistedCollapsedIds(
  storageKey: string,
  validIds?: ReadonlySet<string>,
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => loadCollapsedIds(storageKey))
  /**
   * 写入时要按「当前还存在的节点 id」筛一遍。用 ref 取最新值，而不是塞进 effect 依赖：
   * 调用方那个 Set 通常每次渲染都是新对象，进依赖会让 effect 每帧都跑。
   */
  const validIdsRef = useRef(validIds)
  validIdsRef.current = validIds

  useEffect(() => {
    const storage = getBrowserStorage()
    if (!storage) return
    const valid = validIdsRef.current
    const ids = valid ? [...collapsedIds].filter((id) => valid.has(id)) : [...collapsedIds]
    try {
      storage.setItem(storageKey, JSON.stringify(ids))
    } catch {
      /* 忽略写入失败（隐私模式 / 配额满）：折叠状态丢了不影响用，不打扰用户 */
    }
  }, [collapsedIds, storageKey])

  return [collapsedIds, setCollapsedIds]
}

/**
 * 读存档：读不到、不是数组、元素不是字符串**一律退回空集合**（= 全展开），不抛错。
 * 逐项过滤而不是只看 `Array.isArray` —— 存档可能被手改过或被旧版本写歪。
 */
function loadCollapsedIds(storageKey: string): Set<string> {
  const storage = getBrowserStorage()
  if (!storage) return new Set()
  try {
    const raw = storage.getItem(storageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}
