/**
 * 「图转视频」的**命名模板**：渲染、校验、上下文组装。
 *
 * ## 为什么复用后处理那套，而不是另写一个
 *
 * 命名模板对用户只有一个心智模型（「名字由哪几段拼成」）。两个功能各写一套必然分叉：
 * 一边有变量按钮、另一边只能手打，或者 token 改了一边忘改另一边。所以这里直接用
 * `lib/postprocessNaming` 的渲染器与校验，只把 token 集收窄成视频**兑现得了**的那几个
 * （见 `IMAGE_VIDEO_NAME_TOKENS`）。
 *
 * ## 模板为什么只能渲染成「前缀」
 *
 * 引擎（`D:\AAA\image-to-video`）自己拼文件名：`[日期][前缀][序号].mp4`，其中自由文本
 * 只有「自定义前缀」这一段，**序号固定加在末尾**。所以糖包把模板渲染成前缀交给它 ——
 * 序号位置没有商量余地，`{seq}` 因此不在可用 token 里（写了也不生效，见校验）。
 *
 * 这跟后处理的「文件夹名」是同一件事（都不含序号），渲染路径也就一样：
 * `stripPostprocessNameSequence` + `renderPostprocessNamePattern`。
 */

import type { AssetCollection } from '../../types'
import {
  findDuplicatedPostprocessNameTokens,
  listPostprocessNameTokens,
  renderPostprocessNamePattern,
  stripPostprocessNameSequence,
  validateNamePattern,
  type ParamIssue,
  type PostprocessNameContext,
} from '../../lib/postprocessNaming'
import { resolveProjectNodePathNames } from '../projectTree/params'
import { IMAGE_VIDEO_NAME_PATTERN, IMAGE_VIDEO_NAME_TOKENS, type ImageVideoParams } from './types'

/**
 * 引擎 `custom_prefix` 的长度上限。
 *
 * 前缀要跟输出目录拼成完整路径，而 Windows 的路径上限是 260 —— 输出目录本身可能已经
 * 很长（网络共享路径 + 中文层级）。120 是「模板够用」与「别顶爆路径」之间的取值。
 */
export const IMAGE_VIDEO_NAME_PREFIX_MAX = 120

/** 模板里的未知 token（视频 token 集之外，含后处理有、视频兑现不了的 `{preset}`）。 */
export function findUnknownImageVideoNameTokens(pattern: string): string[] {
  const known = new Set<string>(IMAGE_VIDEO_NAME_TOKENS)
  const unknown: string[] = []
  for (const token of listPostprocessNameTokens(pattern)) {
    // `{seq}` 不算「不认识」—— 它由引擎固定加在末尾，单独提示，见 validateImageVideoNamePattern
    if (token === 'seq') continue
    if (!known.has(token) && !unknown.includes(token)) unknown.push(token)
  }
  return unknown
}

/**
 * 校验命名模板。
 *
 * 与后处理共用 `validateNamePattern`，两处差异都是视频这边的客观约束：
 * - **没有「缺少必要 token」这一档** —— 序号不由模板决定，缺了也不会互相覆盖；
 * - `{seq}` 单独一句提示：文案要说清是「不生效」而不是「不让写」，否则用户会以为是禁用词。
 */
export function validateImageVideoNamePattern(pattern: string): ParamIssue[] {
  const issues = validateNamePattern(pattern, {
    unknown: findUnknownImageVideoNameTokens(pattern),
    missing: [],
    duplicated: findDuplicatedPostprocessNameTokens(pattern),
  })
  if (listPostprocessNameTokens(pattern).includes('seq')) {
    return [...issues, { message: '序号固定加在文件名末尾，模板里写 {seq} 不生效', tone: 'warning' }]
  }
  return issues
}

/**
 * 「这一批是什么」——**界面预览与落盘渲染必须用同一份**。
 *
 * 各算各的话，预览显示 `20260929-机器人-竖版-广点通-1.mp4`、实际落盘少一段，
 * 而这种不一致只有跑到目录里数文件才发现。
 */
export interface ImageVideoNamingContext {
  /** 产品线 */
  line?: string
  /** 产品 */
  product?: string
  /** 方向（项目树节点名） */
  direction?: string
  /** 渠道名 */
  media?: string
  /** 创作者（与后处理共用同一份设置） */
  creator?: string
  /** 分辨率预设，如 `1920x1080` */
  resolution?: string
}

/** 视频这边的上下文 → 模板渲染器的上下文。 */
export function toNamePatternContext(context: ImageVideoNamingContext, createdAt?: number): PostprocessNameContext {
  return {
    createdAt,
    line: context.line,
    product: context.product,
    direction: context.direction,
    creator: context.creator,
    media: context.media,
    size: context.resolution,
  }
}

/**
 * 把命名模板渲染成引擎要的「文件名前缀」（不含序号，序号由引擎加）。
 *
 * 兜底用**空串**而不是渲染器默认的 `'image'`：模板只剩分隔符时，正确结果是「只用序号」
 * （`1.mp4`）；凭空造一个 `image` 会让用户以为模板坏了一半。
 */
export function resolveVideoNamePrefix(
  params: Pick<ImageVideoParams, 'namePattern'>,
  context: ImageVideoNamingContext,
  createdAt?: number,
): string {
  const pattern =
    typeof params.namePattern === 'string' && params.namePattern.trim() ? params.namePattern : IMAGE_VIDEO_NAME_PATTERN
  const withoutSequence = stripPostprocessNameSequence(pattern)
  const rendered = renderPostprocessNamePattern(withoutSequence, toNamePatternContext(context, createdAt), {
    knownTokens: IMAGE_VIDEO_NAME_TOKENS,
    fallback: '',
  })
  return rendered.slice(0, IMAGE_VIDEO_NAME_PREFIX_MAX)
}

/**
 * 组装命名上下文：产品线 / 产品 / 方向三段取自 `directionId` 在项目树里的路径。
 *
 * 创作者**由调用方读出来传进来**（`usePostprocessMediaStore` 的 `creator`）：
 * 这里是纯函数，单测不必为了一个字符串去搭 store。
 */
export function resolveVideoNamingContext(input: {
  collections: AssetCollection[]
  directionId: string
  mediaName: string
  resolution: string
  creator?: string
}): ImageVideoNamingContext {
  const names = resolveProjectNodePathNames(input.collections, input.directionId)
  return {
    line: names.line,
    product: names.product,
    direction: names.direction,
    media: input.mediaName,
    creator: input.creator,
    resolution: input.resolution,
  }
}
