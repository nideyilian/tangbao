import { applySopGroupMirrorPlan, buildSopGroupMirrorPlan } from './sopGroupMirror'

/**
 * 项目文件夹树 → SOP 分组树的同步编排。
 *
 * 触发点：
 * - 启动：素材库水合完成（含自动归档补齐文件夹）之后跑一次全量对齐；
 * - 运行时：左侧栏新建 / 重命名 / 移动文件夹后增量对齐。
 *
 * 并发策略：同一时刻只跑一次，期间的多次请求合并为「结束后再跑一次」——
 * 连续拖动文件夹不会打出多次写盘，也不会漏掉最后一次状态。
 */

let running: Promise<unknown> | null = null
let rerunRequested = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let autoSyncInstalled = false

/**
 * 请求一次镜像对齐（幂等、可重复调用；失败静默，不影响用户操作）。
 * `delayMs > 0` 时做防抖，用于文件夹连续变动（拖拽排序等）场景。
 */
export function requestSopGroupMirrorSync(delayMs = 0): void {
  if (delayMs > 0) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      requestSopGroupMirrorSync()
    }, delayMs)
    return
  }
  if (running) {
    rerunRequested = true
    return
  }
  running = runMirrorSync()
    .catch(() => {
      /* 镜像失败静默：项目中仍是主源，下次触发会重新对齐 */
    })
    .finally(() => {
      running = null
      if (rerunRequested) {
        rerunRequested = false
        requestSopGroupMirrorSync()
      }
    })
}

/**
 * 挂上「项目文件夹变化 → 自动镜像」的订阅（只挂一次）。
 *
 * 选择订阅而不是在每个 action 里插一行：项目文件夹的写入口很多
 * （新建 / 重命名 / 移动 / 拖拽 / 剪切粘贴 / 合并 / 删除 / 回收站恢复 …），
 * 订阅 collections 引用变化可以一次覆盖全部入口，且不会漏掉后续新增的 action。
 */
export function installSopGroupMirrorAutoSync(): void {
  if (autoSyncInstalled) return
  autoSyncInstalled = true
  void import('../features/assetLibrary/store').then(({ useAssetLibraryStore }) => {
    let previousCollections = useAssetLibraryStore.getState().collections
    useAssetLibraryStore.subscribe((state) => {
      if (state.collections === previousCollections) return
      previousCollections = state.collections
      requestSopGroupMirrorSync(300)
    })
  })
}

/** 立即执行一次镜像（供需要确定结果的调用方使用，例如设置页的手动补齐）。 */
export async function syncSopGroupsWithProjectTree(): Promise<number> {
  return runMirrorSync()
}

async function runMirrorSync(): Promise<number> {
  const [{ useAssetLibraryStore }, { useRequirementPrototype }] = await Promise.all([
    import('../features/assetLibrary/store'),
    import('../features/requirementPrototype/store'),
  ])
  // 素材库还在水合时不跑：水合完成路径会再触发一次，避免用半份数据算出错误的层级
  if (useAssetLibraryStore.getState().hydrationStatus === 'loading') return 0
  await waitForRequirementPrototypeHydration(useRequirementPrototype)

  const collections = useAssetLibraryStore.getState().collections
  const requirementState = useRequirementPrototype.getState()
  const plan = buildSopGroupMirrorPlan(collections, requirementState.sopGroups)
  if (plan.upserts.length === 0) return 0
  applySopGroupMirrorPlan(plan, { saveGroup: requirementState.saveSopGroup })
  return plan.upserts.length
}

/** 等 SOP 库水合完成；已水合时立即返回，最多等 10 秒后按当前状态继续（不阻塞界面）。 */
async function waitForRequirementPrototypeHydration(
  store: typeof import('../features/requirementPrototype/store').useRequirementPrototype,
): Promise<void> {
  if (store.getState().hydrated) return
  const deadline = Date.now() + 10_000
  while (!store.getState().hydrated && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
