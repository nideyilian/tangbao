/**
 * 后处理产出的「分发」：把一批产物按天平均分配到日期文件夹。
 *
 * 来源：`features/composite/lib/compositeDistribution.ts`（原「后期处理工作区」的分发能力），
 * 2026-09-18 按杰哥决定移植进后处理链路，随旧编排一起从 composite 退役。
 * 差异：落点从「预设级 / 渠道级 distributionPaths」简化为单一 `targetDir` ——
 * 后处理的产出目录已经由「项目 / 方向 / 预设」三级子目录表达，再叠一层渠道级落点只会更难理解。
 *
 * 移植时保留的三条硬约束（都是原实现踩过的坑）：
 * - 日期段判定不能用 `\b`：`img_20260601.jpg` 里下划线是单词字符，`\b` 在 `_2` 前不成立，
 *   会导致最常见的下划线命名失效。改用「前后都不是数字」界定。
 * - 判定用**非全局**正则副本：全局正则的 `test()` 会推进 `lastIndex`，
 *   同一目录逐天分配时交替命中/失败，目录结构会在「替换日期」与「嵌套日期子文件夹」之间错乱。
 * - 目标已存在时追加 `-2`/`-3`，绝不静默覆盖 —— `move` 模式下覆盖等于源文件永久丢失。
 */

export interface PostprocessDistributionConfig {
  enabled: boolean
  /** 起始日期，`YYYYMMDD` */
  startDate: string
  /** 分配天数（≥1） */
  days: number
  /** `copy` 保留原文件；`move` 搬走后清理已空的源目录 */
  mode: 'copy' | 'move'
  /** 打乱后再平均分配，避免同一批素材出现肉眼可见的排期规律 */
  randomize: boolean
  /** 只按工作日排期（跳过周六周日） */
  skipWeekends: boolean
  /** `date` = 替换文件名里的日期段；`sequence` = 按日期文件夹名 + 序号重排 */
  renameMode: 'date' | 'sequence'
  /** 追加随机字节改变 md5，规避投放平台的「重复素材」判定 */
  modifyMd5: boolean
  /** 分发目标根目录；空 = 在产出目录原地按日期建子文件夹 */
  targetDir: string
}

/** 默认关闭：分发会移动磁盘上的文件，绝不能靠默认值把用户的产物搬走。 */
export const DEFAULT_POSTPROCESS_DISTRIBUTION: PostprocessDistributionConfig = {
  enabled: false,
  startDate: '',
  days: 1,
  mode: 'copy',
  randomize: false,
  skipWeekends: false,
  renameMode: 'date',
  modifyMd5: false,
  targetDir: '',
}

export function normalizePostprocessDistributionConfig(raw: unknown): PostprocessDistributionConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POSTPROCESS_DISTRIBUTION }
  const input = raw as Record<string, unknown>
  const rawDays = typeof input.days === 'number' && Number.isFinite(input.days) ? Math.trunc(input.days) : 0
  return {
    enabled: input.enabled === true,
    startDate: typeof input.startDate === 'string' ? input.startDate.trim() : '',
    days: rawDays > 0 ? rawDays : DEFAULT_POSTPROCESS_DISTRIBUTION.days,
    mode: input.mode === 'move' ? 'move' : 'copy',
    randomize: input.randomize === true,
    skipWeekends: input.skipWeekends === true,
    renameMode: input.renameMode === 'sequence' ? 'sequence' : 'date',
    modifyMd5: input.modifyMd5 === true,
    targetDir: typeof input.targetDir === 'string' ? input.targetDir.trim() : '',
  }
}

/**
 * 配置是否真正可执行。
 *
 * 三件事缺一不可：开关打开、天数 ≥ 1、起始日期是合法的 `YYYYMMDD`。
 * 缺日期时**不做任何搬运**（而不是退回今天）——猜日期会把素材投放到错误的日子上。
 */
export function isPostprocessDistributionActive(config: PostprocessDistributionConfig): boolean {
  return config.enabled && config.days > 0 && /^\d{8}$/.test(config.startDate)
}

export interface PostprocessDistributionElectronApi {
  pathJoin: (...paths: string[]) => Promise<string>
  /** 目标路径是否已存在，用于碰撞检测 */
  checkExists?: (path: string) => Promise<boolean>
  /**
   * 授权目标根目录（主进程只允许写入「允许根」内的路径）。
   * 未授权的 `targetDir` 会导致整组静默失败，所以必须先授权。
   * 名字沿用主进程既有 channel，不为分发另开一个授权入口。
   */
  authorizeCompositeOutputDirectory?: (dir: string) => Promise<boolean>
  distributeFile?: (input: {
    sourcePath: string
    targetPath: string
    mode: 'copy' | 'move'
    appendRandomByte?: boolean
  }) => Promise<{ success: boolean; error?: string }>
  removeEmptyDir?: (dir: string) => Promise<unknown>
}

/** 一条待分发的产出。 */
export interface PostprocessDistributionItem {
  /** 产出文件的绝对路径 */
  path: string
  /**
   * 该产出所用的输出根目录；配了 `targetDir` 时用它算「相对结构」，
   * 让「项目 / 方向 / 预设」的子目录层级在分发后仍然保留。
   */
  outputRoot?: string
}

export interface PostprocessDistributionOptions {
  onProgress?: (completed: number, total: number) => void
  /** 返回 true 时尽快停止剩余分发（已完成的保持完成） */
  shouldCancel?: () => boolean
}

export interface PostprocessDistributionResult {
  success: number
  failed: number
  errors: string[]
  canceled: boolean
  /** 成功搬运的映射；调用方据此把产出记录里的路径改成新位置 */
  moved: Array<{ originalPath: string; targetPath: string }>
}

const DATE_SEGMENT_TEST = /(?<!\d)(20\d{6})(?!\d)/
const DATE_SEGMENT_PATTERN = /(?<!\d)(20\d{6})(?!\d)/g

function dirnameOf(path: string): string {
  return path.replace(/[/\\][^/\\]+$/, '')
}

function basenameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? ''
}

/** 路径比较前统一分隔符并去掉尾部分隔符：主进程 `pathJoin` 用 `\`，用户输入可能用 `/`。 */
function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 生成待分配的日期序列（`YYYYMMDD`）。 */
export function buildDistributionDates(startDate: string, days: number, skipWeekends: boolean): string[] {
  const match = startDate.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!match || days <= 0) return []
  const cursor = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const dates: string[] = []
  // 极端配置（如只跳周末却要 9999 天）也要能停下来，按 10 倍天数兜底
  const maxIterations = days * 10 + 366
  for (let i = 0; dates.length < days && i < maxIterations; i += 1) {
    if (skipWeekends) {
      const day = cursor.getDay()
      if (day === 0 || day === 6) {
        cursor.setDate(cursor.getDate() + 1)
        continue
      }
    }
    const yyyy = cursor.getFullYear()
    const mm = String(cursor.getMonth() + 1).padStart(2, '0')
    const dd = String(cursor.getDate()).padStart(2, '0')
    dates.push(`${yyyy}${mm}${dd}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

/**
 * 目标文件碰撞检测：已存在时追加 `-2`、`-3`……（扩展名之前）。
 * `move` 模式下覆盖意味着源文件丢失，必须避免。
 */
async function resolveNonCollidingTarget(
  api: PostprocessDistributionElectronApi,
  targetDir: string,
  fileName: string,
): Promise<string> {
  const base = await api.pathJoin(targetDir, fileName)
  if (!api.checkExists) return base
  if (!(await api.checkExists(base))) return base

  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = await api.pathJoin(targetDir, `${stem}-${suffix}${ext}`)
    if (!(await api.checkExists(candidate))) return candidate
  }
  return base
}

/**
 * 算出某条产出的目标目录（不含日期层）。
 *
 * - 配了 `targetDir` 且产物在自己的输出根之下 → `targetDir` + 相对结构，保留「项目 / 方向 / 预设」层级
 * - 配了 `targetDir` 但算不出相对结构 → 直接用 `targetDir`
 * - 没配 `targetDir` → 原地（文件当前所在目录）
 */
async function resolveBaseTargetDir(
  api: PostprocessDistributionElectronApi,
  item: PostprocessDistributionItem,
  config: PostprocessDistributionConfig,
): Promise<string> {
  const originalDir = dirnameOf(item.path)
  const targetRoot = config.targetDir.trim()
  if (!targetRoot) return originalDir

  const outputRoot = item.outputRoot?.trim()
  if (!outputRoot) return targetRoot

  const normalizedDir = normalizePathForCompare(originalDir)
  const normalizedRoot = normalizePathForCompare(outputRoot)
  if (!normalizedDir.startsWith(normalizedRoot)) return targetRoot

  const relative = normalizedDir.slice(normalizedRoot.length).replace(/^[/\\]+/, '')
  return relative ? await api.pathJoin(targetRoot, ...relative.split(/[/\\]+/)) : targetRoot
}

export async function runPostprocessDistribution(
  items: PostprocessDistributionItem[],
  config: PostprocessDistributionConfig,
  api: PostprocessDistributionElectronApi,
  options?: PostprocessDistributionOptions,
): Promise<PostprocessDistributionResult> {
  const shouldCancel = options?.shouldCancel ?? (() => false)
  const result: PostprocessDistributionResult = { success: 0, failed: 0, errors: [], canceled: false, moved: [] }
  // 守卫只看 `enabled`，**不**用 `isPostprocessDistributionActive`：
  // 后者还需要起始日期与天数都合法，用它做守卫会把「用户开了分发但日期没填」变成静默什么都不做，
  // 恰恰是最需要报错的情形。配置不完整走下面的显式报错。
  if (items.length === 0 || !config.enabled) return result

  const targetDates = buildDistributionDates(config.startDate, config.days, config.skipWeekends)
  if (targetDates.length === 0) {
    result.errors.push(
      `起始日期或天数无效（起始日期需为 YYYYMMDD，天数需 ≥ 1），实际为: ${config.startDate || '空'} / ${config.days}`,
    )
    return result
  }

  // 1. 按目标目录分组。主进程只允许写入「允许根」内的路径，未授权会导致整组静默失败，
  //    所以这里按目标根逐个授权并记录失败原因，而不是让整批悄悄什么都没做。
  const grouped = new Map<string, PostprocessDistributionItem[]>()
  const authorizedRoots = new Set<string>()
  for (const item of items) {
    const baseDir = await resolveBaseTargetDir(api, item, config)
    if (config.targetDir.trim() && !authorizedRoots.has(baseDir)) {
      let authorized: boolean
      try {
        authorized = (await api.authorizeCompositeOutputDirectory?.(baseDir)) ?? true
      } catch {
        authorized = false
      }
      if (!authorized) {
        result.errors.push(`分发目标未授权或不是绝对路径: ${baseDir}`)
        continue
      }
      authorizedRoots.add(baseDir)
    }
    const group = grouped.get(baseDir)
    if (group) group.push(item)
    else grouped.set(baseDir, [item])
  }

  let total = 0
  for (const group of grouped.values()) total += group.length
  let completed = 0

  const sourceDirsToClean = new Set<string>()

  outer: for (const [baseDir, groupItems] of grouped.entries()) {
    const queue = [...groupItems]
    if (config.randomize) {
      for (let i = queue.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        const swap = queue[i]
        queue[i] = queue[j]
        queue[j] = swap
      }
    }

    const baseCount = Math.floor(queue.length / targetDates.length)
    const remainder = queue.length % targetDates.length
    let cursor = 0

    for (let dayIndex = 0; dayIndex < targetDates.length; dayIndex += 1) {
      if (shouldCancel()) {
        result.canceled = true
        break outer
      }
      const targetDate = targetDates[dayIndex]
      const countForThisDay = baseCount + (dayIndex < remainder ? 1 : 0)
      // 目录里已有日期段就替换它，否则在末尾追加日期子文件夹。
      // 用非全局副本做判断，避免全局正则的 lastIndex 状态让相邻目录交替走不同分支。
      const targetDir = DATE_SEGMENT_TEST.test(baseDir)
        ? baseDir.replace(DATE_SEGMENT_PATTERN, targetDate)
        : await api.pathJoin(baseDir, targetDate)
      const folderBasename = basenameOf(targetDir) || targetDate

      for (let k = 0; k < countForThisDay && cursor < queue.length; k += 1) {
        if (shouldCancel()) {
          result.canceled = true
          break outer
        }
        const item = queue[cursor]
        cursor += 1
        const originalFileName = basenameOf(item.path)
        const targetFileName =
          config.renameMode === 'date'
            ? originalFileName.replace(DATE_SEGMENT_PATTERN, targetDate)
            : `${folderBasename}_${String(k + 1).padStart(2, '0')}${originalFileName.slice(
                originalFileName.lastIndexOf('.'),
              )}`

        try {
          const targetPath = await resolveNonCollidingTarget(api, targetDir, targetFileName)
          const outcome = await api.distributeFile?.({
            sourcePath: item.path,
            targetPath,
            mode: config.mode,
            appendRandomByte: config.modifyMd5,
          })

          if (outcome?.success) {
            result.success += 1
            result.moved.push({ originalPath: item.path, targetPath })
            if (config.mode === 'move') sourceDirsToClean.add(dirnameOf(item.path))
          } else {
            result.failed += 1
            const reason = outcome?.error || '未知错误'
            result.errors.push(`分发失败: ${item.path} -> ${targetPath} (${reason})`)
          }
        } catch (error) {
          result.failed += 1
          const message = error instanceof Error ? error.message : String(error)
          result.errors.push(`分发异常: ${message}`)
        } finally {
          completed += 1
          options?.onProgress?.(completed, total)
        }
      }
    }
  }

  // move 之后源目录可能空了，顺手清掉；非空目录会失败，忽略即可
  if (config.mode === 'move') {
    for (const sourceDir of sourceDirsToClean) {
      try {
        await api.removeEmptyDir?.(sourceDir)
      } catch {
        // 目录非空或有占用：保持原样，不当作错误上报
      }
    }
  }

  return result
}
