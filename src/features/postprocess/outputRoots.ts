/**
 * 产出前解析「这一桶要写到哪些目录」的策略。
 *
 * 单独成模块而不是留在 `taskPostprocess.ts` 里：这里全是**决策**（配了几个、可用几个、
 * 不可用时该不该降级），跟渲染、写盘没有关系，抽出来才能不起 canvas 就测到。
 *
 * 三条口径（都是刻意的，别改成「悄悄写到别处」）：
 * - **配了位置但一个都建不出来 → 返回空列表**（调用方跳过这一桶）。不降级写到本地：
 *   用户以为进了共享盘、文件其实落在本机，是最坏的一种错，宁可不产出并提示。
 * - 配了 2 个、只有 1 个可用 → 写可用的那个并提示少了几个位置（保产物优先）。
 * - 一个位置都没配 → 用默认输出位置（本地保存目录下的 `postprocess`），即老行为。
 */

import { resolvePostprocessOutputDirs, type PostprocessMediaConfig } from '../../lib/postprocessMedia'
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
  config: Pick<PostprocessMediaConfig, 'outputDir' | 'mediaOutputDirs'>,
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

  const roots: string[] = []
  for (const dir of configured) {
    const root = await resolveRoot(dir)
    // 两个位置配成同一个目录时去重：同一份产物写两遍没有意义
    if (root && !roots.includes(root)) roots.push(root)
  }
  if (roots.length === 0) {
    onIssue({ code: 'PP-DIR-001', stage: 'write', mediaId, dir: configured.join('、') })
    return []
  }
  if (roots.length < configured.length) {
    onIssue({
      code: 'PP-DIR-003',
      stage: 'write',
      mediaId,
      detail: `配了 ${configured.length} 个，可用 ${roots.length} 个`,
    })
  }
  return roots
}
