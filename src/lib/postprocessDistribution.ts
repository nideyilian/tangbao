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
  /**
   * 分配天数（≥1）。
   *
   * **没有「起始日期」这个字段**（2026-09-23 删）：起算日由程序取**产出当天**
   * （与命名模板里的 `{date}` 同源，见 `PostprocessDistributionOptions.baseDate`）。
   * 让用户手填日期的后果是双向的 —— 他不知道该填哪天，填成产出当天则会算出
   * 「目标目录 == 产出目录」⇒ 每个文件与**自己**撞名 ⇒ 整目录自我复制一份 `-2`。
   * 排期起算日不是用户能知道的量，它属于程序。
   */
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
    // 旧数据里的 `startDate` **刻意不读**：起算日已改为程序按产出当天算（见类型注释），
    // 用户当年填的值不再有任何含义。留一个死字段往下游传只会让「到底哪个日期生效」需要推理。
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
 * 配置是否真正可执行：开关打开 + 天数 ≥ 1。
 *
 * 2026-09-23 起**不再需要日期** —— 起算日由程序按产出当天取（`baseDate`），
 * 于是「开了开关却忘了填日期 ⇒ 什么都不做还不报错」这个坑从根上不存在了。
 */
export function isPostprocessDistributionActive(config: PostprocessDistributionConfig): boolean {
  return config.enabled && config.days > 0
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
  /**
   * 这张产出是从哪张源图出来的（`rawImageId`）。
   *
   * 存在的唯一目的：**打乱时按「素材」而不是按「文件」洗牌**。一批图会导出到多个渠道目录、
   * 每个目录再展开成多个尺寸，同一张素材因此有十几个文件；若按文件各自洗牌，同一张素材的
   * 头条版可能排在第 1 天、广点通版排在第 3 天 —— **跨渠道就对不上了**（投放要的是同一张
   * 素材在同期上线）。缺省回退用 `path` 当 key（等价于按文件洗牌，兼容手工构造的调用）。
   */
  sourceKey?: string
}

export interface PostprocessDistributionOptions {
  onProgress?: (completed: number, total: number) => void
  /** 返回 true 时尽快停止剩余分发（已完成的保持完成） */
  shouldCancel?: () => boolean
  /**
   * 排期起算日（`YYYYMMDD`）—— **由调用方给，不再由用户填**。
   *
   * 取值口径：本次产出所用源图的生成时间（`taskPostprocess` 的 `createdAt`），与命名模板
   * `{date}` **同源**，这样「产出目录名里的日期」与「第一个日期文件夹」必然一致 ——
   * 不一致会让用户看到一个凭空早于 / 晚于产出日的文件夹，且无从解释。
   * 缺省回退执行当天，只为兼容单测与脚本。
   */
  baseDate?: string
}

export interface PostprocessDistributionResult {
  success: number
  failed: number
  errors: string[]
  canceled: boolean
  /** 成功搬运的映射；调用方据此把产出记录里的路径改成新位置 */
  moved: Array<{ originalPath: string; targetPath: string }>
}

/**
 * 文件名里的日期段：`img_20260601.jpg` → 换成排期日期。
 *
 * ⚠️ 只能用「前后都不是数字」界定，**不能用 `\b`**：`img_20260601.jpg` 里下划线是单词字符，
 * `\b` 在 `_2` 前不成立，最常见的下划线命名会直接失效。
 *
 * ⚠️ 这里只剩这一个**全局**副本：`replace` 不依赖 `lastIndex`（内部会重置），可以安全复用。
 * 原先还有一个非全局副本 `DATE_SEGMENT_TEST`，专门判定「目录名里有没有日期段」——
 * **2026-09-23 随「原地恒定建日期子文件夹」一并去掉**：那个判定会把命名模板产出的
 * `20260922-{方向}-{渠道}…` 目录当成「日期层」去替换，于是
 * ① 用户要的日期子文件夹永远不出现；② 填成产出当天时算出「目标目录 == 产出目录」，
 * 每个文件与**自己**撞名 ⇒ 整目录凭空多出一份 `-2` 自我复制。这两条都是实测踩到的。
 */
const DATE_SEGMENT_PATTERN = /(?<!\d)(20\d{6})(?!\d)/g

/** 把毫秒时间戳格式化成 `YYYYMMDD`；非法值回退执行当天（`baseDate` 的兜底口径）。 */
export function toBaseDate(timestampMs: number | undefined): string {
  const safe = typeof timestampMs === 'number' && Number.isFinite(timestampMs) ? timestampMs : Date.now()
  const date = new Date(safe)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

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

/**
 * 生成待分配的日期序列（`YYYYMMDD`）。
 *
 * `baseDate` 是**起算日**，由调用方按产出当天给出（不是用户填的，见
 * `PostprocessDistributionOptions.baseDate`）。配了 `skipWeekends` 时跳过周六周日往后顺延 ——
 * 顺延后日期不连续，但**天数一定给够**（不是「排到周末就少一天」）。
 */
export function buildDistributionDates(baseDate: string, days: number, skipWeekends: boolean): string[] {
  const match = baseDate.match(/^(\d{4})(\d{2})(\d{2})$/)
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

/**
 * 每张源图的排期序号（越小越先排）。**全量**素材只洗一次牌，各目标目录共用这一份结果。
 *
 * 为什么必须按素材而不是按文件洗牌（2026-09-23）：一批图会导出到多个渠道目录，每个目录里
 * 都是**同一批素材**的一套变体。若按文件各自洗牌，同一张素材的头条版与广点通版会被排到
 * 不同的日子 —— 投放时跨渠道对不上（同一素材本该同期上线）。
 *
 * 集合不同也没关系：`items` 是全量的，缺素材的目录只是在序号序列里留空洞，
 * **相对顺序仍然一致** —— 这正是「共用一次洗牌」而不是「各组各洗一次」的意义。
 */
function buildSourceRank(items: PostprocessDistributionItem[], randomize: boolean): Map<string, number> {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const key = item.sourceKey ?? item.path
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  if (randomize) {
    // Fisher-Yates：先打乱再切分，反过来就白打乱了
    for (let i = keys.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const swap = keys[i]
      keys[i] = keys[j]
      keys[j] = swap
    }
  }
  return new Map(keys.map((key, index) => [key, index]))
}

export async function runPostprocessDistribution(
  items: PostprocessDistributionItem[],
  config: PostprocessDistributionConfig,
  api: PostprocessDistributionElectronApi,
  options?: PostprocessDistributionOptions,
): Promise<PostprocessDistributionResult> {
  const shouldCancel = options?.shouldCancel ?? (() => false)
  const result: PostprocessDistributionResult = { success: 0, failed: 0, errors: [], canceled: false, moved: [] }
  if (items.length === 0 || !config.enabled) return result

  // 起算日：调用方按产出当天给（与命名模板 `{date}` 同源）；没给就退回执行当天。
  const baseDate = options?.baseDate?.trim() || toBaseDate(undefined)
  const targetDates = buildDistributionDates(baseDate, config.days, config.skipWeekends)
  if (targetDates.length === 0) {
    // 走到这里说明 `baseDate` 不合法 —— 它现在由程序算，所以这是内部缺陷而非用户填错。
    // 仍然报错而不是「悄悄换一天继续搬」：猜日期会把素材排到错误的日子上。
    result.errors.push(
      `排期起算日无效（需为 YYYYMMDD），实际为: ${baseDate || '空'}；天数需 ≥ 1，实际为 ${config.days}`,
    )
    return result
  }

  // 按**素材**打乱：全量洗一次牌，各目标目录共用同一份顺序（见 `buildSourceRank`）。
  const sourceRank = buildSourceRank(items, config.randomize)

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
    // 按素材序号排；同序号（同一张素材的多个尺寸变体）用原始下标兜底保持原顺序 ——
    // 显式兜底而不是依赖引擎的排序稳定性，让结果可复现。
    const queue = groupItems
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const rankA = sourceRank.get(a.item.sourceKey ?? a.item.path) ?? 0
        const rankB = sourceRank.get(b.item.sourceKey ?? b.item.path) ?? 0
        return rankA - rankB || a.index - b.index
      })
      .map((entry) => entry.item)

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
      // **恒定**在产出目录下面建一层日期文件夹（2026-09-23 改）。
      // 旧实现是「目录名里已有日期段就替换它」，但产出目录名里的日期来自命名模板 `{date}`
      // （`20260922-{方向}-{渠道}…`）—— 那是「产出日」，不是「排期日」。两者混在一起会：
      // ① 用户要的日期子文件夹永远不出现；② 起始日期填成产出当天时目标目录 == 产出目录，
      // 每个文件与**自己**撞名 ⇒ 整目录凭空多出一份 `-2`。现在不再猜，一律建子文件夹。
      const targetDir = await api.pathJoin(baseDir, targetDate)
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
