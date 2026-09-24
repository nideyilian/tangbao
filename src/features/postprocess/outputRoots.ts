/**
 * 产出前解析「这一桶要写到哪些目录」的策略。
 *
 * 单独成模块而不是留在 `taskPostprocess.ts` 里：这里全是**决策**（配了几个、可用几个、
 * 不可用时该不该降级），跟渲染、写盘没有关系，抽出来才能不起 canvas 就测到。
 *
 * 四条口径（都是刻意的，别改成「悄悄写到别处」）：
 * - **配了位置但一个都建不出来 → 返回空列表**（调用方跳过这一桶）。不降级写到本地：
 *   用户以为进了共享盘、文件其实落在本机，是最坏的一种错，宁可不产出并提示。
 * - 配了 2 个、只有 1 个可用 → 写可用的那个并提示少了几个位置（保产物优先）。
 * - 一个位置都没配 → 用默认输出位置（本地保存目录下的 `postprocess`），即老行为。
 * - **配了位置、但全被「启用」开关关掉 → 返回空列表并报 `PP-DIR-005`**（TB-130）。
 *   ⚠️ 这一条必须与上一条**分开判**：两种情况解析出来都可能是空数组，意思却正相反 ——
 *   「一处都没配」= 用默认位置，「配了但全关」= 一处都别写。混在一起会让「把交付目录全关掉」
 *   变成**悄悄写到本地默认位置**，而用户以为它停掉了（以为没写、其实写了，最难自查的一类）。
 */

import {
  isOutputDirEnabled,
  resolvePostprocessOutputDirs,
  type PostprocessMediaConfig,
} from '../../lib/postprocessMedia'
import type { PostprocessIssueInput } from './postprocessIssue'

/** 解析一个「导出位置」字符串到真实可用的根目录；返回 null = 建不出来 */
export type OutputRootResolver = (configured: string) => Promise<string | null>

/**
 * 解析某个渠道（桶）要写入的全部输出根目录，按配置顺序返回（第一个是主位置）。
 *
 * `onIssue` 由调用方负责去重与落库（同一批图逐张解析时不该刷屏）；**报的是错误码而不是一句话**：
 * 原来这里回一句「导出位置不可用（请检查路径是否可达）」，而真因九成是目录不在应用允许的位置内
 * （主进程的 `assertAllowedPath`），照那句话去查永远查不到 —— 文案必须与真因对齐。
 */
export async function resolveBucketOutputRoots(
  config: Pick<PostprocessMediaConfig, 'outputDir' | 'mediaOutputDirs' | 'mediaOutputDirEnabled'>,
  mediaId: string,
  resolveRoot: OutputRootResolver,
  onIssue: (issue: PostprocessIssueInput) => void,
): Promise<string[]> {
  const configured = resolvePostprocessOutputDirs(config, mediaId)
  if (configured.length === 0) {
    const fallback = await resolveRoot('')
    if (!fallback) {
      onIssue({ code: 'PP-DIR-002', stage: 'write', mediaId })
      return []
    }
    return [fallback]
  }

  // 被「启用」开关关掉的那些不进清单 —— 也就不会去建目录、不会报「不可用」：
  // 关掉的意义就是这一轮完全别碰它（共享盘断开时正是要这个）。
  const enabled = configured.filter((dir) => isOutputDirEnabled(config, mediaId, dir))
  if (enabled.length === 0) {
    onIssue({
      code: 'PP-DIR-005',
      stage: 'write',
      mediaId,
      detail: `配了 ${configured.length} 处，全部已停用`,
    })
    return []
  }

  const roots: string[] = []
  for (const dir of enabled) {
    const root = await resolveRoot(dir)
    // 两个位置配成同一个目录时去重：同一份产物写两遍没有意义
    if (root && !roots.includes(root)) roots.push(root)
  }
  if (roots.length === 0) {
    onIssue({ code: 'PP-DIR-001', stage: 'write', mediaId, dir: enabled.join('、') })
    return []
  }
  // 分母用 `enabled` 而不是 `configured`：被开关停用的位置不算「配了却不可用」，
  // 否则每次跑都会顶着一条「少写了几个位置」，而那几处是用户自己关的。
  if (roots.length < enabled.length) {
    onIssue({
      code: 'PP-DIR-003',
      stage: 'write',
      mediaId,
      detail: `配了 ${enabled.length} 个，可用 ${roots.length} 个`,
    })
  }
  return roots
}
