import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { requestModelJson } from '../strategy/adapters/storeSopGeneration'
import { POOL_LABELS } from './poolPrompt'
import { clampPoolName, POOL_NAME_MAX_LENGTH, type CreativePoolKind } from './types'

/** 池项分析的结构化输出：一个名字 + 若干条要点。 */
export const POOL_ITEM_ANALYSIS_FORMAT = {
  type: 'json_schema',
  name: 'pool_item_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      points: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'points'],
    additionalProperties: false,
  },
} as const

/** 各池分析时「该看什么」。新增池类型时在这里补一条。 */
const POOL_ANALYSIS_FOCUS: Record<CreativePoolKind, string> = {
  style: '笔触与绘制手法、材质质感、光影逻辑、色彩关系与整体氛围',
  composition: '画面布局、主体位置与占比、视觉重心与引导线、留白处理',
  pattern: '纹样结构与重复规律、图形语言、线条风格、密度与节奏',
}

export interface PoolAnalysisResult {
  name: string
  points: string[]
}

/** 分析指令。对模型的要求与「只取风格、不复刻内容」的目标一致。 */
export function buildPoolAnalysisInstruction(kind: CreativePoolKind): string {
  return [
    `你是参考图分析器。观察这张图，归纳出可复用的「${POOL_LABELS[kind]}」特征。`,
    `关注：${POOL_ANALYSIS_FOCUS[kind]}。`,
    '要求：',
    `1. name —— 给这套特征起个名字，最多 ${POOL_NAME_MAX_LENGTH} 个字，要能一眼记住（例如「厚涂油画」「胶片颗粒」）。不要书名号、不要引号。`,
    '2. points —— 3 到 6 条要点，每条一句短话，只写上面那些维度。',
    '⚠️ 不要描述画面里的具体主体、物品和场景（那些属于内容，不属于这里要归纳的东西）。',
    '只返回 JSON，不要任何解释。',
  ].join('\n')
}

/**
 * 解析模型返回的分析结果。
 *
 * 名字按上限夹取 —— prompt 里说了不等于模型会守，这里兜住，
 * 免得池子里出现一个撑爆格子的超长名字。
 */
export function parsePoolAnalysisResult(text: string): PoolAnalysisResult {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned) as { name?: unknown; points?: unknown }

  const name = clampPoolName(typeof parsed.name === 'string' ? parsed.name : '')
  if (!name) throw new Error('模型没有返回有效的名字')

  const points = Array.isArray(parsed.points)
    ? parsed.points
        .filter((point): point is string => typeof point === 'string')
        .map((point) => point.trim())
        .filter(Boolean)
    : []
  if (points.length === 0) throw new Error('模型没有返回有效的要点')

  return { name, points }
}

/** 分析一张池图，产出「名字 + 要点」。调用方负责把结果交给用户确认后再入池。 */
export async function analyzePoolImage(
  kind: CreativePoolKind,
  image: { name: string; dataUrl: string },
  signal?: AbortSignal,
): Promise<PoolAnalysisResult> {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    throw new Error(validationError || '风格池分析需要配置 OpenAI 兼容的 Agent 文本模型')
  }

  const content: Array<Record<string, string>> = [
    { type: 'input_text', text: `请分析这张参考图：${image.name}` },
    { type: 'input_image', image_url: image.dataUrl },
  ]

  const text = await requestModelJson({
    settings,
    profile,
    instructions: buildPoolAnalysisInstruction(kind),
    userContent: content,
    responseFormat: POOL_ITEM_ANALYSIS_FORMAT,
    signal,
    timeoutLabel: '风格池分析',
  })

  return parsePoolAnalysisResult(text)
}
