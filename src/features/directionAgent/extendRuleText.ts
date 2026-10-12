/**
 * 延展：现有配方 → 更具体、更可执行的配方 —— TB-154。
 *
 * 瀚灵那边它长这样（前端原文）：
 * - 界面入口写着 `AI 会把延展内容整理到必须遵循与禁止出现，统一审核后自动保存。`
 * - 提示词开头是 `你是设计素材拆解裂变的规则编辑助手。请在保留用户规则全部要求的前提下，补充更具体、可执行的解析约束和多样…`
 * - 校验是 `请先填写反推规则，再使用延展。` / `请先填写延展要求。`
 *
 * **与反推的分工**：反推是「从零，看参考图造一份配方」；延展是「在已有配方上加工」。
 * 所以延展不需要图片，是纯文本进、纯文本出。
 *
 * ⚠️ 上面引号里的是瀚灵原文；下面指令的**具体条款**是我按它的意图补全的
 * （它的完整提示词没能抓到全文），标注在此避免以后误当成原文。
 */

import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { requestModelJson } from '../strategy/adapters/storeSopGeneration'
import { parseRuleTextModelOutput, RULE_TEXT_FORMAT } from './ruleText'

/** 延展指令。开头一句照抄瀚灵原文，其余为糖包补全（见文件头说明）。 */
export const EXTEND_INSTRUCTION = [
  '你是设计素材拆解裂变的规则编辑助手。请在保留用户规则全部要求的前提下，补充更具体、可执行的解析约束和多样性。',
  '',
  '输出仍然是同样的三个章节，标题**一字不差**：',
  '【固定基底Prompt】',
  '【变量词池】',
  '【反向Prompt】',
  '',
  '要求：',
  '1. 用户原有的要求**一条都不能删、不能弱化**，只能在它基础上补充；',
  '2. 六个池都要有，每个池至少 6 个候选词；不够就补，已有的照留；',
  '3. 补出来的候选词要**互相可替换**（同位概念），不要写成描述句；',
  '4. 反向段不能为空；',
  '5. 只输出这三段纯文本，不要解释你改了什么、不要 Markdown 代码块、不要 JSON。',
].join('\n')

/**
 * 按用户的一句「延展要求」加工现有配方。
 *
 * 空配方、空要求都在**调模型之前**就拦下来 —— 报了错却已经烧掉一次请求，
 * 用户会以为是模型的问题。
 */
export async function extendRuleText(ruleText: string, requirement: string, signal?: AbortSignal): Promise<string> {
  const base = ruleText.trim()
  const ask = requirement.trim()
  if (!base) throw new Error('请先填好配方内容，再用延展')
  if (!ask) throw new Error('请先写一句延展要求')

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    throw new Error(validationError || '延展需要配置 OpenAI 兼容的 Agent 文本模型')
  }

  const text = await requestModelJson({
    settings,
    profile,
    instructions: EXTEND_INSTRUCTION,
    userContent: [`用户的延展要求：${ask}`, '', '当前规则：', base].join('\n'),
    responseFormat: RULE_TEXT_FORMAT,
    signal,
    timeoutLabel: '配方延展',
  })

  return parseRuleTextModelOutput(text)
}
