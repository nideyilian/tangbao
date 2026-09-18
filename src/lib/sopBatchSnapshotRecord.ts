import type { SopBatchSnapshot } from '../types'

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 把 `app-data-records` 里读到的 `sopBatchSnapshots` 原始值解码成快照对象；认不出来的返回 `null`。
 *
 * 这个命名空间**按记录存对象**（`json` 列 = `JSON.stringify(snapshot)`），但历史上有一条写入路径
 * 把它当成 zustand 的 `createDesktopJsonStorage` 处理（那里的值本身就是字符串，所以要再 stringify
 * 一层），于是留下了值是**字符串字面量**的记录 —— 读出来是 `string` 而不是对象。
 *
 * 后果不是「读不到」而是「把界面打挂」：SOP 面板恢复历史运行时直接读 `run.prompts.filter(...)`，
 * 字符串上取属性得到 `undefined`，抛
 * `TypeError: Cannot read properties of undefined (reading 'filter')`；
 * 而它抛在 `useEffect` 的 async 分支里、没有 try/catch，于是 `restoreComplete` 永远不置位，
 * 面板卡在「恢复中」——生成按钮点不动，表现为「无法生图」。
 *
 * 所以这里做两件事：① 兼容性再解析一层字符串（把历史脏数据救回来）；② 补齐下游会 `.filter` /
 * `.map` 的数组字段，避免同类崩溃。**不做静默修数据**：结构上有硬伤（缺 id / 缺 sop）就丢弃。
 */
export function decodeSopBatchSnapshotRecord(value: unknown): SopBatchSnapshot | null {
  let current = value
  for (let depth = 0; depth < 2 && typeof current === 'string'; depth += 1) {
    try {
      current = JSON.parse(current)
    } catch {
      return null
    }
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) return null

  const raw = current as Partial<SopBatchSnapshot>
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  const sop = raw.sop
  if (!sop || typeof sop !== 'object' || typeof sop.id !== 'string' || !sop.id.trim()) return null

  return {
    ...(raw as SopBatchSnapshot),
    id: raw.id,
    sop,
    batchId: typeof raw.batchId === 'string' ? raw.batchId : '',
    workspaceTabId: typeof raw.workspaceTabId === 'string' ? raw.workspaceTabId : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    brief: typeof raw.brief === 'string' ? raw.brief : '',
    referenceImageIds: toStringArray(raw.referenceImageIds),
    batchIds: toStringArray(raw.batchIds),
    taskIds: toStringArray(raw.taskIds),
    prompts: Array.isArray(raw.prompts) ? raw.prompts : [],
    promptCount: typeof raw.promptCount === 'number' ? raw.promptCount : 0,
    imagesPerPrompt: typeof raw.imagesPerPrompt === 'number' ? raw.imagesPerPrompt : 1,
  }
}
