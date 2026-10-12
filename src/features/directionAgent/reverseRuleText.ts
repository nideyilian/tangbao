/**
 * 反推：参考图 → 三段式规则文本 —— TB-154。
 *
 * ## 这是瀚灵那套的核心入口
 *
 * 不是「写一句话出图」，是「**丢几张参考图进去，把配方反推出来**」。
 * 界面上的原话是「统一维护本项目的参考图拆解、变量词池与去同质化约束」——
 * 拆解、变量词池、去同质化，三件事都在这一个动作里。
 *
 * ## 与瀚灵的两处差别（都是刻意的）
 *
 * 1. **它分两步**（先用视觉模型把图转成一段提示词，再结构化反推），这里**合成一步**：
 *    让模型直接吐三段式纯文本。少一次往返，也少一次信息损失。
 * 2. **它用「质检模型」那条配置**；糖包没有这个独立配置，这里跟 `creativePool/poolAnalysis.ts`
 *    一样用 `getAgentTextApiProfile` —— **糖包现有做法就是「用文本模型配置调多模态」**，
 *    不为这一个功能新造一套模型配置。
 *
 * 合并规则（多图）**逐条照抄瀚灵**：基底去重后用 `；` 连、每个池合并去重截前 50、
 * 反向段按标点切分去重。并发也是它的 6 路。
 */

import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { requestModelJson } from '../strategy/adapters/storeSopGeneration'
import { MAX_POOL_OPTIONS, REVERSE_CONCURRENCY, VARIABLE_POOL_KEYS } from './defaults'
import {
  createEmptyRuleParts,
  parseRuleText,
  parseRuleTextModelOutput,
  RULE_TEXT_FORMAT,
  serializeRuleText,
  type DirectionAgentRuleParts,
} from './ruleText'

/**
 * 反推指令。
 *
 * 前半段**照抄瀚灵原文**（"你是一名专业的商业视觉提示词分析师…"那三句），
 * 后半段是糖包补的**输出格式约束** —— 瀚灵把格式约束放在第二步的结构化请求里，
 * 我们合成一步就把它写进来。
 */
export const REVERSE_INSTRUCTION = [
  '你是一名专业的商业视觉提示词分析师。请完整分析这张参考图，把它反推成一份可复用的出图配方。',
  '需要覆盖主体、环境、构图、镜头、光线、色彩、材质、风格、画面层级、文字排版与商业用途；无法确定的内容不要编造品牌名。',
  '',
  `只输出下面三个章节的纯文本（章节标题一字不差），不要解释过程、不要 Markdown 代码块、不要 JSON。`,
  '',
  '【固定基底Prompt】',
  '写一句“指令”，说清保留什么、把什么换成占位符。占位符只能用 {池名} 形式，池名限定为以下六个：',
  '{main_color_set}、{decor_shape}、{surface_material}、{light_effect}、{background_env}、{typography_style}',
  '',
  '【变量词池】',
  '六个池各一行，格式为  {池名}: 候选词1,候选词2,...',
  '候选词**从这张参考图归纳**（这张图本身用的那个值也要放进去），每组至少 6 个，用英文逗号分隔。',
  '',
  '【反向Prompt】',
  '这张图里不该被照抄的东西（具体物体、人物、品牌、固定色值），加上通用的低质项。**不能为空。**',
  '',
  '硬要求：',
  '1. 六个池全都要写，每个至少 6 个候选词；',
  '2. 固定基底里引用的池名必须是上面那六个之一；',
  '3. 池里的候选词要是**可互相替换的同位概念**（例如主色池放“冷色渐变 / 暖色渐变”这类），不要照抄这张图里的长句描述。',
].join('\n')

export interface ReferenceImage {
  /** 文件名或用户可见的标识，只用于回显进度。 */
  name: string
  /** `data:image/...` 形式的数据地址。 */
  dataUrl: string
}

/** 单张图反推，返回三段式文本。 */
export async function reverseRuleTextFromImage(image: ReferenceImage, signal?: AbortSignal): Promise<string> {
  if (!image.dataUrl.startsWith('data:image/')) {
    throw new Error(`参考图「${image.name}」读不出来，请重新加载`)
  }

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    throw new Error(validationError || '反推需要配置 OpenAI 兼容的、能看图的模型')
  }

  const text = await requestModelJson({
    settings,
    profile,
    instructions: REVERSE_INSTRUCTION,
    userContent: [
      { type: 'input_text', text: `请反推这张参考图：${image.name}` },
      { type: 'input_image', image_url: image.dataUrl },
    ],
    responseFormat: RULE_TEXT_FORMAT,
    signal,
    timeoutLabel: '参考图反推',
  })

  return parseRuleTextModelOutput(text)
}

/**
 * 合并多张图的反推结果。**规则照抄瀚灵**：
 * - 固定基底：去重后用 `；` 连起来
 * - 每个池：各图候选词合并去重，截前 `MAX_POOL_OPTIONS`
 * - 反向段：按 `[\n,，、;；]+` 切分、去重后用 `；` 连
 */
export function mergeRuleParts(list: readonly DirectionAgentRuleParts[]): DirectionAgentRuleParts {
  const merged = createEmptyRuleParts()
  if (list.length === 0) return merged

  merged.basePrompt = [...new Set(list.map((part) => part.basePrompt.trim()).filter(Boolean))].join('；')

  merged.negativePrompt = [
    ...new Set(
      list.flatMap((part) =>
        part.negativePrompt
          .split(/[\n,，、;；]+/u)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ),
  ].join('；')

  for (const key of VARIABLE_POOL_KEYS) {
    merged.variablePools[key] = [...new Set(list.flatMap((part) => part.variablePools[key]).filter(Boolean))].slice(
      0,
      MAX_POOL_OPTIONS,
    )
  }

  return merged
}

/** 按上限并发跑，**单张失败只记录不中断**（照瀚灵：一张挂掉不该毁掉整次反推）。 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length)
  let cursor = 0
  const size = Math.max(1, Math.min(limit, items.length))

  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        try {
          results[index] = { ok: true, value: await worker(items[index], index) }
        } catch (error) {
          results[index] = { ok: false, error }
        }
      }
    }),
  )

  return results
}

/**
 * 反推一批参考图 → 一份三段式规则文本。
 *
 * 单张就直接用它的结果；多张按 `mergeRuleParts` 合并。
 * 全部失败才抛错，且把每张的失败原因带上（瀚灵也是这么拼报错的）。
 */
export async function reverseRuleTextFromImages(
  images: readonly ReferenceImage[],
  signal?: AbortSignal,
): Promise<{ ruleText: string; succeeded: number; failed: Array<{ name: string; message: string }> }> {
  if (images.length === 0) throw new Error('请先加载至少一张参考图，再点反推')

  const settled = await mapWithConcurrency(images, REVERSE_CONCURRENCY, (image) =>
    reverseRuleTextFromImage(image, signal),
  )

  const failed: Array<{ name: string; message: string }> = []
  const parts: DirectionAgentRuleParts[] = []

  settled.forEach((result, index) => {
    if (result.ok) {
      parts.push(parseRuleText(result.value))
      return
    }
    const message = result.error instanceof Error ? result.error.message : String(result.error)
    failed.push({ name: images[index].name, message })
  })

  if (parts.length === 0) {
    throw new Error(failed.map((item) => `${item.name}：${item.message}`).join('；') || '参考图反推失败')
  }

  return {
    ruleText: serializeRuleText(mergeRuleParts(parts)),
    succeeded: parts.length,
    failed,
  }
}
