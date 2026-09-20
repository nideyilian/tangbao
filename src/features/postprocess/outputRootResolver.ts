/**
 * 输出根目录解析器：**先授权、再建目录**，并带一层按配置串的缓存。
 *
 * ## 为什么要单独成模块
 *
 * 这段逻辑原先内联在 `taskPostprocess.ts` 的 `resolveOutputRootCached` 里，导致它不可测 ——
 * 而 TB-049 恰恰就是**这一段的顺序错了**：授权排在 `resolveOutputRoot`（内部走 `ensureDir`）之后，
 * 而 `ensureDir` 一旦因为白名单拒绝失败，`resolveBucketOutputRoots` 早就返回空数组了，
 * 后面那行授权永远轮不到。测试只测 `localSave` 的两个函数是锁不住这个顺序的
 * （反向验证时把顺序改回去，测试依然全绿 —— 那次教训记在这里）。
 *
 * 抽出来之后，顺序本身可以被断言。
 *
 * ## 为什么必须先授权
 *
 * 主进程 `assertAllowedPath` 只放行 桌面/文档/下载/图片/userData + `localSettings.localSavePath`
 * + 本次会话用**目录选择对话框**选过的路径。而「按渠道设置导出位置」允许用户**直接敲路径**，
 * 手输的 `D:\导出\保险` 不在白名单里 → `ensureDir` 抛
 * 「Path is outside allowed application directories」→ 整批产出静默跳过，
 * 界面上只剩一句把人带偏的「导出位置不可用，请检查路径是否可达」。
 *
 * 口径（杰哥 2026-09-20 确认）：**用户在设置里显式填过的目录即视为受信**。
 * 这不是开放整个盘 —— 目录是用户自己敲进去的，等价于一次授权行为。
 */

export interface OutputRootResolverDeps {
  /** 把目录纳入主进程白名单；返回 false = 主进程拒绝或旧 preload 无此通道 */
  authorize: (dir: string) => Promise<boolean>
  /** 解析并创建目录；返回 null = 建不出来（含白名单拒绝） */
  resolve: (configured: string) => Promise<string | null>
}

/**
 * 建一个带缓存的解析器（同一批图多半共用输出目录，不缓存会逐张重复建目录与授权）。
 *
 * 返回的 `resolve` 对**空白配置串**刻意跳过授权：授权 `''` 会被 `path.resolve('')`
 * 解析成进程当前工作目录，等于凭空放行一个目录。
 */
export function createOutputRootResolver(deps: OutputRootResolverDeps): (configured: string) => Promise<string | null> {
  const cache = new Map<string, string | null>()
  return async (configured: string): Promise<string | null> => {
    const key = configured.trim()
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    // ⚠️ 顺序不可交换：授权在前，解析在后。
    if (key) await deps.authorize(key)
    const root = await deps.resolve(configured)
    cache.set(key, root)
    return root
  }
}
