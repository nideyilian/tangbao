/**
 * 后处理产出的「分发」：把一批产物按天铺开，**用排期日给产出文件夹重新命名**。
 *
 * 来源：`features/composite/lib/compositeDistribution.ts`（原「后期处理工作区」的分发能力），
 * 2026-09-18 按杰哥决定移植进后处理链路，随旧编排一起从 composite 退役。
 * 差异：落点从「预设级 / 渠道级 distributionPaths」简化为单一 `targetDir` ——
 * 后处理的产出目录已经由「项目 / 方向 / 预设」三级子目录表达，再叠一层渠道级落点只会更难理解。
 *
 * ## 目录结构（2026-09-23 第二轮重定 · TB-116）
 *
 * 分发**不再在产出文件夹里套一层子文件夹**，而是把产出文件夹本身按排期日命名 ——
 * 名字沿用命名模板（`postprocessNaming.ts`），只把日期段换掉：
 *
 * ```
 * D:\导出\20260922-高颜值-头条-广点通-1140x640\a-01.jpg     ← 产出（目录名里的日期 = 产出日）
 *   铺 3 天后 →
 * D:\导出\20260923-高颜值-头条-广点通-1140x640\a-01.jpg
 * D:\导出\20260924-高颜值-头条-广点通-1140x640\b-01.jpg
 * D:\导出\20260925-高颜值-头条-广点通-1140x640\c-01.jpg
 * ```
 *
 * 第一轮的实现是「在产出文件夹下面恒定建一层 `20260923` 这样的纯日期子文件夹 + 按开关复制」。
 * 杰哥 2026-09-23 报障三条：① 导出后同一张图有两份；② 导出位置没变、只是多了层子文件夹；
 * ③ 子文件夹只有日期，认不出是哪批素材。三条都是那套结构的直接后果，故整段推翻。
 *
 * ## 硬约束（都是踩过的坑，别改回去）
 *
 * - **排期日与文件当前位置重合时不搬**（`isSamePath` 那条短路）。起算日 = 产出当天，
 *   所以**第 1 天的目标目录恰好就是产出文件夹自己** —— 去搬它，`copy` 会在原地凭空多出一份，
 *   `move` 会与「自己已存在」撞名拿到 `-2` 副本。现在判定「目标 == 源」直接跳过，一个字节都不碰。
 *   这条判定必须发生在**碰撞检测之前**，顺序反了就形同虚设。
 * - **搬运恒定是 move**。旧实现留了 `copy | move` 开关，但在这套结构下 copy 根本不成立：
 *   第 1 天是原地（无副本可言），第 2 天若复制，第 1 天的目录里就会留着所有天的文件 ——
 *   整个排期错乱。用户要的是「剪切成 N 份」，所以开关撤掉（字段 `mode` 已删，旧数据里的值不读）。
 * - 日期段判定不能用 `\b`：`img_20260601.jpg` 里下划线是单词字符，`\b` 在 `_2` 前不成立，
 *   最常见的下划线命名会直接失效。改用「前后都不是数字」界定。
 * - 判定「有没有日期段」要用**独立的非全局副本**，不能拿 `replace` 的结果与原名比：
 *   替换结果与原名相同时（排期日恰好等于产出日，也就是**第 1 天**）会被误判成「没有日期段」，
 *   于是凭空加一层前缀，第 1 天就不再是原地了。全局那份只用于 `replace`（它不依赖 `lastIndex`）。
 * - 目标已存在时追加 `-2`/`-3`，绝不静默覆盖 —— 搬运恒定 move，覆盖等于源文件永久丢失。
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
  /** 打乱后再平均分配，避免同一批素材出现肉眼可见的排期规律 */
  randomize: boolean
  /** 只按工作日排期（跳过周六周日） */
  skipWeekends: boolean
  /** `date` = 替换文件名里的日期段；`sequence` = 按排期文件夹名 + 序号重排 */
  renameMode: 'date' | 'sequence'
  /** 追加随机字节改变 md5，规避投放平台的「重复素材」判定 */
  modifyMd5: boolean
  /**
   * 分发目标根目录；**空 = 就在产出位置整理**（产出文件夹同级改名，不搬家、不产生副本）。
   *
   * ⚠️ 填成「当前输出根目录」也是合法取值：那等于把排期文件夹建在同一个根下，
   * 与留空的结果相同（都是同级改名）。旧实现会把这种填法算回产出文件夹自身
   * （相对结构回填），表现成「填了等于没填」—— 已随本次重写消失。
   */
  targetDir: string
}

/** 默认关闭：分发会移动磁盘上的文件，绝不能靠默认值把用户的产物搬走。 */
export const DEFAULT_POSTPROCESS_DISTRIBUTION: PostprocessDistributionConfig = {
  enabled: false,
  days: 1,
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
    randomize: input.randomize === true,
    skipWeekends: input.skipWeekends === true,
    renameMode: input.renameMode === 'sequence' ? 'sequence' : 'date',
    modifyMd5: input.modifyMd5 === true,
    targetDir: typeof input.targetDir === 'string' ? input.targetDir.trim() : '',
    // 旧数据里的 `mode`（copy / move）同样刻意不读：搬运恒定是 move，
    // 留着它只会让人以为「复制」还能选（见模块头注释第二条硬约束）。
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
  /**
   * 搬运一个文件。`mode` 留着是主进程的能力（`composite:distribute-file` 两档都支持），
   * **但分发链路上恒传 `move`** —— 理由见模块头注释第二条硬约束。
   */
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
   * 让输出根之下的**中间层级**（如项目 / 预设）在换位置分发后仍然保留。
   *
   * ⚠️ 相对结构的**最后一段（产出文件夹名）不进路径**，它进的是排期文件夹名 ——
   * 那正是「按排期日重命名」这件事本身。
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
   * `{date}` **同源**，这样「产出目录名里的日期」与「第一个排期文件夹」必然一致 ——
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
  /**
   * 每个产出的落点（`originalPath` → `targetPath`）；调用方据此把产出记录里的路径改成新位置。
   *
   * **包含「本来就在排期位置上、没搬动」的那些**（起算日 = 产出当天时第 1 天就是这种情况）：
   * 调用方要的是「这个文件现在在哪」，而不是「磁盘上发生过几次重命名」。
   */
  moved: Array<{ originalPath: string; targetPath: string }>
}

/**
 * 文件名 / 目录名里的日期段：`img_20260601.jpg`、`20260922-高颜值-头条` → 换成排期日期。
 *
 * ⚠️ 只能用「前后都不是数字」界定，**不能用 `\b`**：`img_20260601.jpg` 里下划线是单词字符，
 * `\b` 在 `_2` 前不成立，最常见的下划线命名会直接失效。
 *
 * ⚠️ 只保留这一个**全局**副本，只在 `replace` 里用（`replace` 不依赖 `lastIndex`，内部会重置，
 * 可以安全复用）。
 */
const DATE_SEGMENT_PATTERN = /(?<!\d)(20\d{6})(?!\d)/g

/**
 * 「这个名字里有没有日期段」的判定副本。
 *
 * ⚠️ 必须独立于上面那份、且**非全局**：
 * - 非全局：`test()` 不推进 `lastIndex`（全局副本的 `test` 会推，同一目录逐天判定时交替命中/失败）；
 * - 独立：**不能**用「`replace` 的结果与原名是否相同」代替它 —— 排期日恰好等于产出日时
 *   （第 1 天，也就是最常见的场景）替换结果与原名一字不差，会被误判成「没有日期段」，
 *   于是凭空加一层日期前缀，第 1 天就不再是原地了。
 */
const HAS_DATE_SEGMENT_PATTERN = /(?<!\d)20\d{6}(?!\d)/

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
 * 判两个路径是不是同一个位置。
 *
 * 盘符大小写、分隔符方向都可以不同（`D:\out` / `d:/out/`），而这条判定的后果是「搬」还是
 * 「不搬」—— 判错的代价很直接：搬了就是复制一份自己。
 */
function isSamePath(a: string, b: string): boolean {
  return normalizePathForCompare(a).toLowerCase() === normalizePathForCompare(b).toLowerCase()
}

/**
 * 排期文件夹名：把产出文件夹名里的日期段换成排期日。
 *
 * - `('20260922-高颜值-头条-广点通-1140x640', '20260923')` → `20260923-高颜值-头条-广点通-1140x640`
 * - 名字里**没有**日期段（命名模板没写 `{date}`）→ 前置排期日：`('高颜值-头条', '20260923')`
 *   → `20260923-高颜值-头条`。不能保持原样 —— 那样每天的文件夹会撞名，分配结果直接错乱。
 */
export function buildDistributionFolderName(produceFolderName: string, targetDate: string): string {
  const name = produceFolderName.trim()
  if (!name) return targetDate
  if (!HAS_DATE_SEGMENT_PATTERN.test(name)) return `${targetDate}-${name}`
  return name.replace(DATE_SEGMENT_PATTERN, targetDate)
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
 * 搬运恒定是 move，覆盖意味着源文件丢失，必须避免。
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

/** 一个排期批次：同一个分发根、同一个产出文件夹名的一批文件，合起来铺 N 天。 */
interface DistributionGroup {
  root: string
  /** 产出文件夹名（如 `20260922-高颜值-头条-广点通-1140x640`）；排期文件夹名由它派生 */
  folderName: string
  items: PostprocessDistributionItem[]
}

/**
 * 算出某条产出的**分发根**（排期文件夹的父目录）。
 *
 * - 没配 `targetDir` → 产出文件夹的父目录（= 输出根）。分发因此是**同级改名**：不换位置、不产生副本。
 * - 配了 `targetDir` → `targetDir` + 输出根之下的**中间层级**（保留「项目 / 预设」这类结构）。
 *   产出恒在「输出根 / 产出文件夹」这一层，所以中间层通常为空，此时就是 `targetDir` 本身。
 * - 算不出相对结构 → 直接用 `targetDir`（旧行为）。
 */
async function resolveDistributionRoot(
  api: PostprocessDistributionElectronApi,
  item: PostprocessDistributionItem,
  config: PostprocessDistributionConfig,
): Promise<string> {
  const produceDir = dirnameOf(item.path)
  const targetRoot = config.targetDir.trim()
  if (!targetRoot) return dirnameOf(produceDir)

  const outputRoot = item.outputRoot?.trim()
  if (!outputRoot) return targetRoot

  const normalizedDir = normalizePathForCompare(produceDir)
  const normalizedRoot = normalizePathForCompare(outputRoot)
  if (!normalizedDir.startsWith(normalizedRoot)) return targetRoot

  const relative = normalizedDir.slice(normalizedRoot.length).replace(/^[/\\]+/, '')
  const segments = relative.split(/[/\\]+/).filter(Boolean)
  // 最后一段是**产出文件夹名** —— 它进排期文件夹名，不进路径；只有前面那些才是要保留的中间层。
  const middle = segments.slice(0, Math.max(0, segments.length - 1))
  return middle.length > 0 ? await api.pathJoin(targetRoot, ...middle) : targetRoot
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

  // 1. 按「分发根 + 产出文件夹名」分组：不同产出文件夹（渠道 / 尺寸 / 预设不同）各自排各自的 ——
  //    混在一组会让「组内按天均匀」这个前提失效。
  //    分发根逐个授权（主进程只允许写入「允许根」内的路径）；授权失败要报出来，
  //    否则整组静默什么都不做 —— 用户只看到「点了没反应」。
  const grouped = new Map<string, DistributionGroup>()
  const authorizedRoots = new Set<string>()
  for (const item of items) {
    let root: string
    try {
      root = await resolveDistributionRoot(api, item, config)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`分发目标解析失败: ${message}`)
      continue
    }

    if (!authorizedRoots.has(root)) {
      let authorized: boolean
      try {
        authorized = (await api.authorizeCompositeOutputDirectory?.(root)) ?? true
      } catch {
        authorized = false
      }
      if (!authorized) {
        result.errors.push(`分发目标未授权或不是绝对路径: ${root}`)
        continue
      }
      authorizedRoots.add(root)
    }

    const folderName = basenameOf(dirnameOf(item.path))
    const key = `${normalizePathForCompare(root)}\u0000${folderName}`
    const group = grouped.get(key)
    if (group) group.items.push(item)
    else grouped.set(key, { root, folderName, items: [item] })
  }

  let total = 0
  for (const group of grouped.values()) total += group.items.length
  let completed = 0

  const sourceDirsToClean = new Set<string>()

  outer: for (const group of grouped.values()) {
    // 按素材序号排；同序号（同一张素材的多个尺寸变体）用原始下标兜底保持原顺序 ——
    // 显式兜底而不是依赖引擎的排序稳定性，让结果可复现。
    const queue = group.items
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
      // 每天的落点 = 分发根 + 以排期日开头（日期段已换掉）的产出文件夹名。
      // 起算日 = 产出当天时，第 1 天算出来与产出文件夹**同名** ⇒ 目标 == 源，
      // 下面的短路会直接跳过 —— 文件留在原地，正是它该在的位置。
      const scheduleFolder = buildDistributionFolderName(group.folderName, targetDate)
      const targetDir = await api.pathJoin(group.root, scheduleFolder)

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
            : `${scheduleFolder}_${String(k + 1).padStart(2, '0')}${originalFileName.slice(
                originalFileName.lastIndexOf('.'),
              )}`

        try {
          const candidate = await api.pathJoin(targetDir, targetFileName)
          /**
           * ⭐ **已经在排期位置上就不碰它**。
           *
           * 起算日 = 产出当天 ⇒ 第 1 天的目标就是产出文件夹自己。这里若继续往下走，
           * `resolveNonCollidingTarget` 会看到「目标已存在」（那是它自己）而改判 `-2`，
           * 整目录于是凭空多出一份副本 —— 这正是杰哥 2026-09-23 报的第一条。
           */
          if (isSamePath(candidate, item.path)) {
            result.success += 1
            result.moved.push({ originalPath: item.path, targetPath: candidate })
            continue
          }

          const targetPath = await resolveNonCollidingTarget(api, targetDir, targetFileName)
          const outcome = await api.distributeFile?.({
            sourcePath: item.path,
            targetPath,
            mode: 'move',
            appendRandomByte: config.modifyMd5,
          })

          if (outcome?.success) {
            result.success += 1
            result.moved.push({ originalPath: item.path, targetPath })
            sourceDirsToClean.add(dirnameOf(item.path))
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

  // 搬空的源目录顺手清掉；非空目录会失败，忽略即可（原地跳过的那批文件没动，目录自然不空）
  for (const sourceDir of sourceDirsToClean) {
    try {
      await api.removeEmptyDir?.(sourceDir)
    } catch {
      // 目录非空或有占用：保持原样，不当作错误上报
    }
  }

  return result
}
