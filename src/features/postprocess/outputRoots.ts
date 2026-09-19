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

/** 解析一个「导出位置」字符串到真实可用的根目录；返回 null = 建不出来 */
export type OutputRootResolver = (configured: string) => Promise<string | null>

/**
 * 解析某个渠道（桶）要写入的全部输出根目录，按配置顺序返回（第一个是主位置）。
 *
 * `warnOnce` 由调用方负责去重（同一批图逐张解析时不该刷屏）。
 */
export async function resolveBucketOutputRoots(
  config: Pick<PostprocessMediaConfig, 'outputDir' | 'mediaOutputDirs'>,
  mediaId: string,
  resolveRoot: OutputRootResolver,
  warnOnce: (message: string) => void,
): Promise<string[]> {
  const configured = resolvePostprocessOutputDirs(config, mediaId)
  if (configured.length === 0) {
    const fallback = await resolveRoot('')
    if (!fallback) {
      warnOnce('部分源图已跳过：无法创建输出目录')
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
    warnOnce('导出位置不可用，已跳过这批产出（请检查路径是否可达）')
    return []
  }
  if (roots.length < configured.length) {
    warnOnce(`有 ${configured.length - roots.length} 个导出位置不可用，已跳过`)
  }
  return roots
}
