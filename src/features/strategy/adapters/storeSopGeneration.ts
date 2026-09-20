import {
  DEFAULT_API_TIMEOUT,
  getAgentTextApiProfile,
  getAgentTextProtocol,
  validateApiProfile,
} from '../../../lib/apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../../lib/devProxy'
import { submitTaskWithData, useStore } from '../../../store'
import {
  buildSopRequestContent,
  extractResponseText,
  getSopGeneratorInstruction,
  parseGeneratedSop,
  parseGeneratedVariablePrompt,
  prepareSopReferenceImages,
  validateSopGenerationInput,
  type GenerateSop,
  type GeneratedSop,
} from '../sopGeneration'
import { parseVariablePrompt, renderVariablePromptBatch } from '../../../lib/variablePrompt'
import {
  applyVariablePromptTextPolicy,
  EXCLUDE_TEXT_SKILL_INSTRUCTION,
  KEEP_TEXT_SKILL_INSTRUCTION,
} from '../variablePromptTextPolicy'
import {
  buildSopPromptBatchRequest,
  generateSopPromptBatches,
  findResidualPromptPlaceholders,
  parseSopPromptBatchResponse,
  parseSopSeriesPromptBatchResponse,
  SOP_PROMPT_GENERATOR_INSTRUCTION,
  type SopPromptBatchContext,
} from '../sopPromptBatch'
import { IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION } from '../skillMetaInstructions'
import { buildSopSeriesLockedCopy, buildSopSeriesLockedFixedBlock } from '../sopSeriesDimensions'
import { DERIVE_DIMENSIONS, validateVariablePromptTemplate, type DeriveDimensionPolicy } from '../derivePolicy'
import { VISUAL_PROFILE_INSTRUCTION, buildProfileSummary, parseVisualProfiles } from '../visualProfile'
import {
  deriveUsedSignatures,
  generateCampaignRecipeBatch,
  isCampaignRecipeSop as isCampaignRecipeSopShared,
  MAX_DIMENSION_OPTIONS,
  parseCampaignRecipeConfigFromContent,
  sanitizeCampaignRecipeConfig,
  validateCampaignRecipeConfig,
  type CampaignRecipeConfig,
} from '../campaignRecipe'
import { getAllSopBatchSnapshots } from '../../../lib/db'
import type { SopLibraryItem } from '../types'

/** Agent 配置未提供有效超时时的兜底值（秒）。 */
const TEXT_REQUEST_TIMEOUT_FALLBACK_SECONDS = DEFAULT_API_TIMEOUT

/** 把 Agent 配置的超时（秒）换算成请求用的毫秒值；缺失或非法时回退到默认值。 */
export function resolveTextRequestTimeoutMs(timeoutSeconds?: number) {
  const seconds =
    typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds
      : TEXT_REQUEST_TIMEOUT_FALLBACK_SECONDS
  return Math.round(seconds * 1000)
}

/** 超时错误：调用方据此跳过重试，避免把等待时间成倍拉长。 */
export function isTextRequestTimeoutError(error: unknown) {
  return error instanceof Error && error.name === 'TimeoutError'
}

function createTextRequestTimeoutError(label: string, timeoutMs: number, cause: unknown) {
  const error = new Error(
    `${label}超时：超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成，请检查文本模型或接口连接，或提高 Agent 配置中的超时时间。`,
    { cause },
  )
  error.name = 'TimeoutError'
  return error
}

/**
 * 文本模型请求的统一超时保护。没有超时时，接口不响应会让界面永久停在「正在生成提示词」，
 * 既不报错也无法自动恢复。超时与用户主动取消严格区分：取消抛原信号原因，超时抛 TimeoutError。
 */
async function fetchTextModelWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  options: { signal?: AbortSignal; timeoutMs: number; label: string },
) {
  const { signal, timeoutMs, label } = options
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException(`${label}超时`, 'TimeoutError'))
  }, timeoutMs)
  const abortFromExternal = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abortFromExternal, { once: true })
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error
    if (timedOut) throw createTextRequestTimeoutError(label, timeoutMs, error)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromExternal)
  }
}
import type { ApiProfile, AppSettings } from '../../../types'

const SOP_GENERATION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'generated_sop',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '专业、清晰、可识别用途的 SOP 名称' },
      description: { type: 'string', description: '一到两句话说明 SOP 的用途、输入和产出' },
      sop: { type: 'string', description: '完整、可独立执行的 Markdown SOP 正文' },
    },
    required: ['name', 'description', 'sop'],
    additionalProperties: false,
  },
} as const

const VARIABLE_PROMPT_GENERATION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'generated_variable_prompt',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '简洁、清晰、可识别用途的变量提示词策略名称' },
      description: { type: 'string', description: '一到两句话说明视觉机制和批量应用价值' },
      variablePrompt: { type: 'string', description: '可直接解析执行的变量提示词正文，包含单独一行的可变项区块' },
    },
    required: ['name', 'description', 'variablePrompt'],
    additionalProperties: false,
  },
} as const

export function getSopPromptGenerationModelFromStore() {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  return (profile.model || settings.model).trim()
}

function buildSopPromptTextFormat(quantity: number) {
  const count = Math.max(1, Math.trunc(quantity))
  return {
    type: 'json_schema',
    name: 'sop_prompt_batch',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompts: {
          type: 'array',
          description: `包含 ${count} 条遵循 SOP、彼此不同且可直接用于图片生成模型的提示词`,
          minItems: count,
          maxItems: count,
          items: { type: 'string' },
        },
      },
      required: ['prompts'],
      additionalProperties: false,
    },
  } as const
}

function buildSeriesPromptTextFormat(quantity: number, seriesCount: number) {
  return {
    type: 'json_schema',
    name: 'sop_series_prompt_batch',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        series: {
          type: 'array',
          minItems: quantity,
          maxItems: quantity,
          items: {
            type: 'object',
            properties: {
              fixed: { type: 'string' },
              fixedCopy: { type: 'string' },
              prompts: { type: 'array', minItems: seriesCount, maxItems: seriesCount, items: { type: 'string' } },
            },
            required: ['fixed', 'fixedCopy', 'prompts'],
            additionalProperties: false,
          },
        },
      },
      required: ['series'],
      additionalProperties: false,
    },
  } as const
}

function toChatCompletionsMessageContent(content: Array<Record<string, string>>) {
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (part.type === 'input_image' && typeof part.image_url === 'string') {
      parts.push({ type: 'image_url', image_url: { url: part.image_url } })
    } else if (part.type === 'input_text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text })
    }
  }
  return parts
}

function extractChatCompletionsText(payload: unknown) {
  const record = payload as { choices?: Array<{ message?: { content?: unknown } }> } | null
  const firstChoice = Array.isArray(record?.choices) ? record.choices[0] : undefined
  return firstChoice?.message && typeof firstChoice.message.content === 'string' ? firstChoice.message.content : ''
}

export const generateSopFromStore: GenerateSop = async (
  description,
  context,
  referenceImages = [],
  kind = 'general',
  metaInstruction,
  options,
) => {
  options?.onProgress?.({ stage: 'validate', message: '正在校验生成条件与模型配置' })
  validateSopGenerationInput(description, referenceImages, kind)
  const brief = description.trim()
  const variablePromptMode = kind === 'variable-prompt-skill'
  const excludeText = variablePromptMode ? (options?.excludeText ?? true) : false

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : 'SOP 智能生成需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }

  const proxy = readClientDevProxyConfig()
  options?.onProgress?.({
    stage: 'prepare',
    message:
      referenceImages.length > 0
        ? `正在整理 ${referenceImages.length} 张参考图片与生成说明`
        : '正在整理生成说明与元指令',
  })
  const preparedReferences = await prepareSopReferenceImages(referenceImages)
  if (preparedReferences.compressedCount > 0) {
    options?.onProgress?.({
      stage: 'prepare',
      message: `已自动压缩 ${preparedReferences.compressedCount} 张过大参考图，正在继续生成`,
    })
  }
  const content = buildSopRequestContent(brief, context, preparedReferences.images, kind, excludeText)
  const useChatCompletions = getAgentTextProtocol(settings, profile) === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const baseInstruction = getSopGeneratorInstruction(kind, metaInstruction)
  const responseFormat = variablePromptMode ? VARIABLE_PROMPT_GENERATION_TEXT_FORMAT : SOP_GENERATION_TEXT_FORMAT
  const send = (useStructuredOutput: boolean, retryIncomplete = false) => {
    const instructions = [
      baseInstruction,
      variablePromptMode
        ? '应用只接收 name、description、variablePrompt 三个字段；不得返回 sop。variablePrompt 必须是可直接拆解生图的完整模板，包含正文变量、单独一行的“可变项：”和逐行变量定义。'
        : '应用只接收 name、description、sop 三个字段；不得省略任何字段，sop 必须包含完整正文。',
      variablePromptMode ? (excludeText ? EXCLUDE_TEXT_SKILL_INSTRUCTION : KEEP_TEXT_SKILL_INSTRUCTION) : '',
      variablePromptMode && options?.dimensionPolicyInstruction ? options.dimensionPolicyInstruction : '',
      retryIncomplete ? '上一轮结果结构不完整。请重新完整生成，不要复述错误结果。' : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const body = useChatCompletions
      ? {
          model: profile.model || settings.model,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: toChatCompletionsMessageContent(content) },
          ],
          max_tokens: 8000,
          ...(useStructuredOutput
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: responseFormat.name,
                    strict: true,
                    schema: responseFormat.schema,
                  },
                },
              }
            : {}),
        }
      : {
          model: profile.model || settings.model,
          instructions,
          input: [{ role: 'user', content }],
          max_output_tokens: 8000,
          ...(useStructuredOutput ? { text: { format: responseFormat } } : {}),
        }
    return fetchTextModelWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${profile.apiKey}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify(body),
      },
      { signal: options?.signal, timeoutMs: resolveTextRequestTimeoutMs(profile.timeout), label: 'SOP 生成' },
    )
  }

  options?.onProgress?.({
    stage: 'request',
    message:
      referenceImages.length > 1
        ? `AI 正在逐张分析 ${referenceImages.length} 张图片并${variablePromptMode ? '反推变量提示词' : '编译 SOP'}`
        : `AI 正在分析输入并${variablePromptMode ? '反推变量提示词' : '编译 SOP'}`,
  })
  let structuredOutputEnabled = true
  let response = await send(structuredOutputEnabled)
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    structuredOutputEnabled = false
    options?.onProgress?.({ stage: 'request', message: '当前模型已切换为兼容生成模式' })
    response = await send(false)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SOP 生成失败（${response.status}）：${body.slice(0, 180)}`)
  }
  options?.onProgress?.({
    stage: 'parse',
    message: variablePromptMode ? '正在校验变量提示词语法与选项池' : '正在校验名称、说明与 SOP 正文',
  })
  const parse = (payload: unknown) => {
    const text = useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
    if (!variablePromptMode) return parseGeneratedSop(text)
    const generated = parseGeneratedVariablePrompt(text)
    const contentWithTextPolicy = applyVariablePromptTextPolicy(generated.sop, excludeText)
    const validation = parseVariablePrompt(contentWithTextPolicy)
    if (!validation.enabled) {
      throw new Error(`生成的变量提示词格式有误：${validation.errors[0] ?? '未识别到有效变量'}`)
    }
    return { ...generated, sop: contentWithTextPolicy }
  }
  try {
    return parse(await response.json())
  } catch (error) {
    options?.onProgress?.({ stage: 'repair', message: '返回结构不完整，正在自动修复并重试' })
    const retryResponse = await send(structuredOutputEnabled, true)
    if (!retryResponse.ok) {
      const body = await retryResponse.text()
      throw new Error(
        `${variablePromptMode ? '变量提示词' : 'SOP'}自动修复失败（${retryResponse.status}）：${body.slice(0, 180)}`,
        { cause: error },
      )
    }
    options?.onProgress?.({
      stage: 'parse',
      message: variablePromptMode ? '正在校验修复后的变量提示词' : '正在校验修复后的 SOP 结构',
    })
    try {
      return parse(await retryResponse.json())
    } catch (retryError) {
      // 「排除文字」违规不是结构问题，重试无法修复，直接透出
      if (retryError instanceof Error && /开启“排除文字”后/.test(retryError.message)) throw retryError
      throw new Error('AI 连续两次返回不完整内容，请切换文本模型或简化元指令后重试', { cause: retryError })
    }
  }
}

export async function generatePromptsFromSopStore(
  sop: SopLibraryItem,
  quantity: number,
  brief = '',
  options: {
    context?: SopPromptBatchContext
    referenceImages?: Array<{ name: string; dataUrl: string }>
    exact?: boolean
    existingPrompts?: string[]
    onProgress?: (completed: number, total: number) => void
    maxBatchSize?: number
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
  } = {},
) {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : 'SOP 提示词生成需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }

  const proxy = readClientDevProxyConfig()
  const useChatCompletions = getAgentTextProtocol(settings, profile) === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const textModel = (profile.model || settings.model || '').trim()
  let structuredOutputEnabled = !/\b(gemini|deepseek|glm|kimi|claude|qwen)\b/i.test(textModel)
  const timeoutMs = resolveTextRequestTimeoutMs(profile.timeout)
  const seriesConfig = options.context?.seriesConfig
  // 单成员重生成只请求组内一条提示词：批次单位与组内条数都按 1 计算，
  // 否则会为了重生成一张画面而多生成并丢弃整组提示词。
  const seriesCount = seriesConfig ? (options.context?.seriesMemberOnly ? 1 : seriesConfig.imageCount) : 1
  return generateSopPromptBatches(
    quantity,
    async (batchQuantity, existingPrompts) => {
      const requestQuantity = batchQuantity
      const requestText = buildSopPromptBatchRequest(sop, requestQuantity, brief, {
        ...options.context,
        existingPrompts,
      })
      const send = (useStructuredOutput: boolean) => {
        const textFormat = seriesConfig
          ? buildSeriesPromptTextFormat(requestQuantity, seriesCount)
          : buildSopPromptTextFormat(batchQuantity)
        const body = useChatCompletions
          ? {
              model: profile.model || settings.model,
              messages: [
                { role: 'system', content: SOP_PROMPT_GENERATOR_INSTRUCTION },
                {
                  role: 'user',
                  content: options.referenceImages?.length
                    ? [
                        { type: 'text', text: requestText },
                        ...options.referenceImages.map((image) => ({
                          type: 'image_url',
                          image_url: { url: image.dataUrl },
                        })),
                      ]
                    : requestText,
                },
              ],
              max_tokens: 12000,
              ...(useStructuredOutput
                ? {
                    response_format: {
                      type: 'json_schema',
                      json_schema: { name: textFormat.name, strict: true, schema: textFormat.schema },
                    },
                  }
                : {}),
            }
          : {
              model: profile.model || settings.model,
              instructions: SOP_PROMPT_GENERATOR_INSTRUCTION,
              input: options.referenceImages?.length
                ? [
                    {
                      role: 'user',
                      content: [
                        { type: 'input_text', text: requestText },
                        ...options.referenceImages.map((image) => ({
                          type: 'input_image',
                          image_url: image.dataUrl,
                        })),
                      ],
                    },
                  ]
                : requestText,
              max_output_tokens: 12000,
              ...(useStructuredOutput ? { text: { format: textFormat } } : {}),
            }
        return fetchTextModelWithTimeout(
          url,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${profile.apiKey}`,
              'Content-Type': 'application/json',
            },
            cache: 'no-store',
            body: JSON.stringify(body),
          },
          { signal: options.signal, timeoutMs, label: 'SOP 提示词生成' },
        )
      }

      let response: Response
      try {
        response = await send(structuredOutputEnabled)
      } catch (error) {
        if (options.signal?.aborted) throw error
        // 超时说明接口大概率不可用：既不重试无结构化输出，也不进入批次重试，直接给出可读错误。
        if (isTextRequestTimeoutError(error)) throw error
        if (!structuredOutputEnabled) {
          throw new Error(`提示词生成失败：${error instanceof Error ? error.message : '文本模型未返回结果'}`, {
            cause: error,
          })
        }
        structuredOutputEnabled = false
        response = await send(false)
      }
      if (!response.ok && structuredOutputEnabled && (response.status === 400 || response.status === 422)) {
        structuredOutputEnabled = false
        response = await send(false)
      }
      if (!response.ok) {
        const body = await response.text()
        throw new Error(`提示词生成失败（${response.status}）：${body.slice(0, 180)}`)
      }
      const payload = await response.json()
      const resultText = useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
      if (seriesConfig) {
        const groups = parseSopSeriesPromptBatchResponse(resultText, requestQuantity, seriesCount, {
          fixedBlock: options.context?.seriesFixedBlock,
          copyBlock: options.context?.seriesCopyBlock,
          // 用户手工填了值的固定维度由客户端逐字拼进固定块，模型改写不了
          lockedFixedBlock: buildSopSeriesLockedFixedBlock(seriesConfig),
          // 文案同理：单独走画面文字段，避免被「非画面文字」前缀挡掉
          lockedCopy: buildSopSeriesLockedCopy(seriesConfig),
        })
        return groups.flatMap((group) => group.prompts)
      }
      return parseSopPromptBatchResponse(resultText, batchQuantity, { exact: false, existingPrompts })
    },
    {
      exact: options.exact,
      existingPrompts: options.existingPrompts,
      onProgress: options.onProgress,
      maxBatchSize: options.maxBatchSize,
      onBatch: options.onBatch,
      beforeBatch: options.beforeBatch,
      outputUnitSize: seriesCount,
      signal: options.signal,
      isRetryable: (error) => !isTextRequestTimeoutError(error),
    },
  )
}

export async function testSopRevisionFromStore(sop: SopLibraryItem) {
  const [prompt] = await generatePromptsFromSopStore(sop, 1, '', {
    exact: true,
    maxBatchSize: 1,
  })
  if (!prompt?.trim()) throw new Error('AI 未能从该 SOP 生成可测试的生图提示词')

  const state = useStore.getState()
  const activeTab = state.workspaceTabs.find((tab) => tab.id === state.activeWorkspaceTabId)
  const taskId = await submitTaskWithData(
    {
      prompt: prompt.trim(),
      inputImages: state.inputImages,
      inputImageFolder: state.inputImageFolder,
      params: { ...state.params, n: 1 },
      maskDraft: null,
      targetTabId: state.activeWorkspaceTabId,
      scheduledOutputPath: state.customOutputPath.trim() || undefined,
      scheduledOutputSubFolder: activeTab?.name,
    },
    { silentSuccess: true },
  )
  if (!taskId) throw new Error('测试生图任务未能提交，请检查图片 API 配置')
  state.showToast('测试任务已提交，可在当前画廊查看生成结果', 'success')
}

// ---------------------------------------------------------------------------
// 变量提示词模式（executionMode='variable-prompt'）批量展开
// ---------------------------------------------------------------------------

const VARIABLE_EXPANSION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'expanded_variable_prompt',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      variablePrompt: {
        type: 'string',
        description:
          '扩词条后的完整变量提示词正文：保留原正文与全部原选项，为每个变量追加足够多的新选项，必须可直接解析执行（包含单独一行的可变项区块）',
      },
    },
    required: ['variablePrompt'],
    additionalProperties: false,
  },
} as const

const VARIABLE_EXPANSION_INSTRUCTION = `你是变量提示词词条扩充器。用户提供一条变量提示词模板与期望的批量数量，当前模板的可变项组合数不足以覆盖该数量。
你的任务：在完全保留模板正文、变量名与已有选项的前提下，为每个变量追加足够多的新选项，使总组合数达到或超过期望数量。
要求：
1. 不得修改正文中的变量占位符（{{变量名}}）和已有选项，只能新增选项。
2. 新选项必须与原选项语义同级、互不重复，并在模板原有主题方向上形成有意义的差异。
3. 保持“可变项：”单独一行、每个变量单独一行的格式，选项用「 / 」分隔。
4. 最终只输出 JSON：{"variablePrompt":"完整的变量提示词正文"}，不要 Markdown、解释或编号。`

/**
 * 变量提示词模式的批量提示词生成：本地展开组合，组合不足时自动调 AI 扩词条。
 * 与 generatePromptsFromSopStore 同签名，弹窗可无缝切换执行分支。
 */
export async function generateVariablePromptsFromSopStore(
  sop: SopLibraryItem,
  quantity: number,
  brief = '',
  options: {
    context?: SopPromptBatchContext
    referenceImages?: Array<{ name: string; dataUrl: string }>
    exact?: boolean
    existingPrompts?: string[]
    onProgress?: (completed: number, total: number) => void
    maxBatchSize?: number
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
    /** 系列模式下批次单位是「组」：quantity 为组数，每组展开 outputUnitSize 条画面。 */
    outputUnitSize?: number
  } = {},
) {
  const parsed = parseVariablePrompt(sop.content)
  if (!parsed.enabled) {
    throw new Error(`变量提示词模板格式有误：${parsed.errors[0] ?? '请检查可变项格式'}`)
  }

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : '变量提示词批量展开需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }

  // 模板实际可展开的组合数；请求数量不能超过组合数（否则必然重复）
  // quantity 是批次单位数（系列模式下为组数），展开成实际画面条数再和组合数比较
  const outputUnitSize = Math.max(1, Math.trunc(options.outputUnitSize ?? 1))
  const targetCount = Math.max(1, Math.trunc(quantity)) * outputUnitSize
  let template = sop.content

  // 组合不足时自动调 AI 扩词条（仅当目标数量超过组合数，且未显式关闭）
  if (targetCount > parsed.combinationCount && options.signal?.aborted !== true) {
    template = await expandSopVariablePromptOptions(template, targetCount, {
      settings,
      profile,
      brief,
      referenceImages: options.referenceImages,
      signal: options.signal,
    })
    const reparsed = parseVariablePrompt(template)
    if (!reparsed.enabled) {
      throw new Error(`扩词条后模板格式异常：${reparsed.errors[0] ?? '请检查可变项格式'}`)
    }
  }
  // 用扩词条后的模板重新计算组合上限；按整组向下取整，避免凑不满一组时 exact 校验失败
  const finalParsed = parseVariablePrompt(template)
  const combinationLimit = Math.min(targetCount, finalParsed.combinationCount)
  const unitCount = Math.max(1, Math.floor(combinationLimit / outputUnitSize))

  const seed = `${sop.id}:${brief.trim() || 'default'}`
  // 复用 generateSopPromptBatches 驱动：本地展开作为唯一一批，走现有 onBatch 逐条推进/提交
  return generateSopPromptBatches(
    unitCount,
    async () => {
      const prompts = renderVariablePromptBatch(template, combinationLimit, seed)
      // 与配方卡同源的问题：renderBody 对未命中的 `{{X}}` 原样保留，
      // 不拦就会带着占位符直接出图。变量提示词是纯本地展开，残留必然是名称写错。
      assertNoResidualPlaceholders(prompts, '变量提示词')
      return prompts
    },
    {
      exact: options.exact,
      existingPrompts: options.existingPrompts,
      maxBatchSize: options.maxBatchSize,
      onProgress: options.onProgress,
      onBatch: options.onBatch,
      beforeBatch: options.beforeBatch,
      signal: options.signal,
      outputUnitSize,
    },
  )
}

async function expandSopVariablePromptOptions(
  template: string,
  targetCount: number,
  context: {
    settings: AppSettings
    profile: ApiProfile
    brief: string
    referenceImages?: Array<{ name: string; dataUrl: string }>
    signal?: AbortSignal
  },
): Promise<string> {
  const { settings, profile, brief, referenceImages } = context
  const proxy = readClientDevProxyConfig()
  const useChatCompletions = getAgentTextProtocol(settings, profile) === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const userText = [
    `期望批量数量：${targetCount} 条。`,
    brief.trim() ? `补充要求：\n${brief.trim()}` : '',
    '',
    '当前变量提示词模板：',
    '<TEMPLATE>',
    template,
    '</TEMPLATE>',
  ]
    .filter(Boolean)
    .join('\n')

  const send = (useStructuredOutput: boolean) => {
    const body = useChatCompletions
      ? {
          model: profile.model || settings.model,
          messages: [
            { role: 'system', content: VARIABLE_EXPANSION_INSTRUCTION },
            {
              role: 'user',
              content: referenceImages?.length
                ? [
                    { type: 'text', text: userText },
                    ...referenceImages.map((image) => ({
                      type: 'image_url',
                      image_url: { url: image.dataUrl },
                    })),
                  ]
                : userText,
            },
          ],
          max_tokens: 8000,
          ...(useStructuredOutput
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: VARIABLE_EXPANSION_TEXT_FORMAT.name,
                    strict: true,
                    schema: VARIABLE_EXPANSION_TEXT_FORMAT.schema,
                  },
                },
              }
            : {}),
        }
      : {
          model: profile.model || settings.model,
          instructions: VARIABLE_EXPANSION_INSTRUCTION,
          input: referenceImages?.length
            ? [
                {
                  role: 'user',
                  content: [
                    { type: 'input_text', text: userText },
                    ...referenceImages.map((image) => ({
                      type: 'input_image',
                      image_url: image.dataUrl,
                    })),
                  ],
                },
              ]
            : userText,
          max_output_tokens: 8000,
          ...(useStructuredOutput ? { text: { format: VARIABLE_EXPANSION_TEXT_FORMAT } } : {}),
        }
    return fetchTextModelWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${profile.apiKey}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify(body),
      },
      { signal: context.signal, timeoutMs: resolveTextRequestTimeoutMs(profile.timeout), label: '扩词条' },
    )
  }

  let response = await send(true)
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    response = await send(false)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`扩词条失败（${response.status}）：${body.slice(0, 180)}`)
  }
  const payload = (await response.json()) as unknown
  const text = useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
  const generated = parseGeneratedVariablePrompt(text)
  const validation = parseVariablePrompt(generated.sop)
  if (!validation.enabled) {
    throw new Error(`扩词条后模板仍无法解析：${validation.errors[0] ?? '请检查模型返回'}`)
  }
  return generated.sop
}

// ---------------------------------------------------------------------------
// 配方卡引擎（executionMode='campaign-recipe' / kind='campaign-recipe'）批量生成
// ---------------------------------------------------------------------------

/**
 * 判定一个 SOP 是否走「配方卡引擎」本地生成分支。
 *
 * **实现已收口到 `campaignRecipe.ts` 的 `isCampaignRecipeSop`**（全应用唯一实现），
 * 此处保留同名导出仅为兼容既有调用点。**不要再在此处派生新口径** ——
 * 判定分叉会导致「引擎能认出、界面认不出」的展示与执行割裂（R-53 / R-54 的病根）。
 */
export const isCampaignRecipeSop = isCampaignRecipeSopShared

/**
 * 本地生成分支（配方卡 / 变量提示词）的最后一道拦网：提示词里不允许残留占位符。
 *
 * 为什么只拦本地分支、不在 normalizeSopPromptCandidates 里统一拦：AI 分支的模型输出
 * 可能天然包含成对花括号（描述 JSON 结构、代码片段），统一拦会误伤正常提示词。
 * 而本地分支的提示词是由「骨架 + 维度替换」机械拼出来的，出现残留必然是骨架里的
 * 维度名与维度定义对不上（典型：骨架写 `{{场景}}`、维度定义成 `场景名`），一定是 bug。
 *
 * 抛错而不是静默过滤：静默过滤会让「生成 10 条」变成「生成 7 条」，
 * 用户只会看到数量不对，永远不知道是占位符没替换。
 */
function assertNoResidualPlaceholders(prompts: string[], source: string) {
  for (const prompt of prompts) {
    const placeholders = findResidualPromptPlaceholders(prompt)
    if (placeholders.length === 0) continue
    throw new Error(
      `${source}生成失败：提示词里存在未替换的占位符 ${placeholders.join('、')}。` +
        `请检查骨架中的占位符写法与可变项名称是否完全一致（区分大小写）。`,
    )
  }
}

/**
 * 配方卡引擎的批量提示词生成：纯本地最远点采样，全程不调用 AI。
 *
 * 与 generatePromptsFromSopStore / generateVariablePromptsFromSopStore 同签名，
 * 批量弹窗可无缝切换执行分支。
 *
 * 与另两条分支的关键差异：
 * - 输入来源：不使用对话式 brief 驱动生成，也不读 referenceImages（配方卡的多样性来自维度池，
 *   不来自参考图）；brief 仅作为采样种子的一部分，用于区分不同会话的批次。
 * - 输出形式：本地直接算出成品提示词，无需 JSON 解析与结构修复，因此没有「模型返回不完整」重试路径。
 * - 去重：existingPrompts 既用于跨批次去重，也作为最远点采样的「已选点」锚定历史分布。
 */
export async function generateCampaignRecipePromptsFromStore(
  sop: SopLibraryItem,
  quantity: number,
  brief = '',
  options: {
    context?: SopPromptBatchContext
    referenceImages?: Array<{ name: string; dataUrl: string }>
    exact?: boolean
    existingPrompts?: string[]
    onProgress?: (completed: number, total: number) => void
    maxBatchSize?: number
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
    outputUnitSize?: number
    /** 历史签名集合（跨批次去重）；不传时自动从本张配方的历史记录推导 */
    usedSignatures?: Set<string>
    /**
     * 候选值池被截断时回调（维度名列表）。
     * 截断是静默发生的（超出 MAX_DIMENSION_OPTIONS 的候选值被丢弃），不透出的话
     * 用户只会发现「生成数量比预期少」，无法定位到是池子被砍。
     */
    onTruncated?: (dimensions: string[]) => void
    /**
     * 合规红线剔除候选值时回调（可读的剔除说明列表）。
     * 剔除本身是正确行为，但用户需要知道「我写的值被系统丢了」，否则会误以为程序漏读。
     */
    onSanitized?: (removed: string[]) => void
    /** 内置变量（{比例} / {方向} / {尺寸}），由调用方按界面当前尺寸注入；见 describeCampaignRecipeSize。 */
    builtinValues?: Record<string, string>
  } = {},
) {
  const rawConfig = sop.campaignRecipe ?? parseCampaignRecipeConfigFromContent(sop.content)
  if (!rawConfig) {
    throw new Error('配方卡配置缺失：需要在 SOP 中提供提示词骨架与维度池')
  }

  // 合规红线内置且不可关闭：命中红线的候选值在生成前剔除，避免脏数据进入出图链路。
  const { config, removed, bodyRemoved } = sanitizeCampaignRecipeConfig(rawConfig)
  if (removed.length > 0) {
    console.warn(`[配方卡引擎] 已剔除命中合规红线的候选值：${removed.join('；')}`)
    options.onSanitized?.(removed)
  }
  // body 被清空时的报错必须点名真因：否则下游 validateCampaignRecipeConfig 只会说
  // 「缺少提示词骨架 body」，用户去检查骨架却发现它明明在，排查方向被彻底带偏。
  if (bodyRemoved) {
    throw new Error(
      `配方卡提示词骨架命中合规红线，已被整段移除。请在「配方卡」页检查骨架文案，` +
        `移除违规表述后重试（命中项：${removed.filter((item) => item.startsWith('提示词骨架')).join('；')}）。`,
    )
  }
  const errors = validateCampaignRecipeConfig(config)
  if (errors.length > 0) throw new Error(`配方卡格式有误：${errors[0]}`)

  const outputUnitSize = Math.max(1, Math.trunc(options.outputUnitSize ?? 1))
  // 种子并入 brief：同一张配方卡在不同会话/不同补充要求下产出不同批次，
  // 但同参数重跑结果稳定可复现。
  const seed = `${sop.id}:${brief.trim() || 'default'}`

  // 跨批次去重：签名集合优先用调用方传入的；否则从「本张配方的历史记录」自动推导。
  // 历史以文本形式落库在 SopBatchSnapshot.prompts[].text，这里按配方卡结构反推签名，
  // 于是「关掉弹窗重开、重启应用」之后跨批次去重依然有效。
  // 诊断打点（临时）：区分「卡在读历史 IPC」vs「卡在采样计算」。
  console.info(
    `[诊-配方卡] 引擎入口 quantity=${quantity} unitSize=${outputUnitSize} exact=${options.exact}` +
      ` signal.aborted=${options.signal?.aborted ?? '(无signal)'} signal.reason=${String(options.signal?.reason ?? '-')}`,
  )
  const sigStart = Date.now()
  const usedSignatures =
    options.usedSignatures ?? (await loadCampaignRecipeUsedSignatures(sop.id, config, options.existingPrompts ?? []))
  console.info(`[诊-配方卡] 读历史签名完成 ${usedSignatures.size} 个（${Date.now() - sigStart}ms）`)
  const batchStart = Date.now()
  return generateSopPromptBatches(
    quantity,
    async (batchQuantity, existingPrompts) => {
      const batchTarget = batchQuantity * outputUnitSize
      const { samples, exhausted, truncatedDimensions } = generateCampaignRecipeBatch(config, {
        count: batchTarget,
        seed,
        existingPrompts,
        usedSignatures,
        // 本地采样是同步长任务，不接 signal 的话「取消」按钮点了要等它跑完才生效。
        signal: options.signal,
        // 界面选中的尺寸注入 {比例} / {方向} / {尺寸} 内置变量（维度池同名时维度优先）
        builtinValues: options.builtinValues,
        // 系列模式：outputUnitSize = 每组画面数。>1 时启用组内约束（组内固定主控槽、
        // 组间不重样）—— 否则系列图会退化成 N 条互不相干的独立采样，看起来不成套。
        seriesGroupSize: outputUnitSize,
      })
      // 本批已选签名回写，同一轮多次校验批次之间也不会重复
      for (const sample of samples) usedSignatures.add(sample.signature)
      if (samples.length === 0) {
        throw new Error('配方卡候选组合已耗尽：请增加维度候选值，或减少生成数量')
      }
      if (exhausted && samples.length < batchTarget) {
        console.warn(
          `[配方卡引擎] 候选组合不足以覆盖请求数量（组合空间 ${samples.length} 条可用 / 请求 ${batchTarget} 条），已返回不重复的部分。`,
        )
      }
      // 截断提示：truncateOversizedDimensions 静默砍掉超出上限的候选值，
      // 若不透出，用户只会看到「生成数量不够」却不知道是池子被截了。
      if (truncatedDimensions.length > 0) {
        console.warn(
          `[配方卡引擎] 维度候选值超过上限已截断：${truncatedDimensions.join('、')}（每维最多保留 ${MAX_DIMENSION_OPTIONS} 条）`,
        )
        options.onTruncated?.(truncatedDimensions)
      }
      const prompts = samples.map((sample) => sample.prompt)
      // 占位符残留 = 骨架写的维度名与维度定义对不上。renderRecipeBody 有意原样保留
      // 以便暴露问题，但若不在此拦下，带 `{{未定义}}` 的提示词会直接送去生图。
      assertNoResidualPlaceholders(prompts, '配方卡')
      return prompts
    },
    {
      exact: options.exact,
      existingPrompts: options.existingPrompts,
      maxBatchSize: options.maxBatchSize,
      onProgress: options.onProgress,
      onBatch: options.onBatch,
      beforeBatch: options.beforeBatch,
      signal: options.signal,
      outputUnitSize,
      // 本地算法无网络依赖，除「组合耗尽」外没有值得重试的错误
      isRetryable: (error) => !(error instanceof Error && /候选组合已耗尽/.test(error.message)),
    },
  )
    .then((prompts) => {
      console.info(`[诊-配方卡] 批次循环完成 ${prompts.length} 条（${Date.now() - batchStart}ms）`)
      return prompts
    })
    .catch((error) => {
      console.warn(
        `[诊-配方卡] 批次循环失败（${Date.now() - batchStart}ms）:` +
          ` name=${error instanceof Error ? error.name : typeof error}` +
          ` message=${error instanceof Error ? error.message : String(error)}` +
          ` signal.aborted=${options.signal?.aborted ?? '-'} signal.reason=${String(options.signal?.reason ?? '-')}`,
      )
      throw error
    })
}

/**
 * 从持久化的历史记录里收集「本张配方卡用过的组合签名」，用于跨批次去重。
 *
 * 数据源是 `SopBatchSnapshot`（提示词仓库），它已经按文本保存了历次产出，
 * 因此无需新增存储结构即可让去重在重启后依然生效。
 * 只统计属于同一张 SOP 的记录，避免不同配方卡互相干扰。
 */
export async function loadCampaignRecipeUsedSignatures(
  sopId: string,
  config: CampaignRecipeConfig,
  extraPrompts: string[] = [],
): Promise<Set<string>> {
  const signatures = new Set<string>(deriveUsedSignatures(config, extraPrompts).values())
  try {
    const snapshots = await getAllSopBatchSnapshots()
    const historyForSop = snapshots
      .filter((snapshot) => snapshot.sop?.id === sopId)
      .flatMap((snapshot) => snapshot.prompts.map((prompt) => prompt.text))
      .filter((text) => typeof text === 'string' && text.trim().length > 0)
    for (const signature of deriveUsedSignatures(config, historyForSop)) signatures.add(signature)
  } catch (error) {
    // 读历史失败不应阻断生成：退化为「仅本批去重」，并留下可排查的日志
    console.warn('[配方卡引擎] 读取历史提示词失败，本轮跨批次去重降级为仅本批去重', error)
  }
  return signatures
}

/**
 * 从纯文本正文反解配方卡配置。
 *
 * **实现已收口到 `campaignRecipe.ts`**，此处保留同名导出仅为兼容既有调用点 ——
 * 弹窗分流需要同一口径探测（见 `isCampaignRecipeSop`），而弹窗不能 import 本模块（R-46）。
 */
export { parseCampaignRecipeConfigFromContent }

// ---------------------------------------------------------------------------
// 两阶段衍生：阶段一视觉档案 → 阶段二模板生成（带质量校验与重试）
// ---------------------------------------------------------------------------

const VISUAL_PROFILE_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'visual_profiles',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      profiles: {
        type: 'array',
        description: '每张参考图的结构化视觉档案',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            subjectCategory: { type: 'string' },
            style: { type: 'string' },
            composition: { type: 'string' },
            color: { type: 'string' },
            scene: { type: 'string' },
            lighting: { type: 'string' },
            material: { type: 'string' },
            mood: { type: 'string' },
            textElements: { type: 'array', items: { type: 'string' } },
            coreVisualMechanism: { type: 'string' },
            derivableDimensions: { type: 'array', items: { type: 'string' } },
            lockedFacts: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'subject',
            'subjectCategory',
            'style',
            'composition',
            'color',
            'scene',
            'lighting',
            'material',
            'mood',
            'textElements',
            'coreVisualMechanism',
            'derivableDimensions',
            'lockedFacts',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['profiles'],
    additionalProperties: false,
  },
} as const

const REFERENCE_STYLE_PROMPT_FORMAT = {
  type: 'json_schema',
  name: 'reference_style_prompt',
  strict: true,
  schema: {
    type: 'object',
    properties: { prompt: { type: 'string' } },
    required: ['prompt'],
    additionalProperties: false,
  },
} as const

const VISUAL_SKILL_FORMAT = {
  type: 'json_schema',
  name: 'visual_skill',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      visualAnalysis: { type: 'object', additionalProperties: { type: 'string' } },
      preservedRules: { type: 'array', items: { type: 'string' } },
      replaceableElements: { type: 'array', items: { type: 'string' } },
      textRules: { type: 'array', items: { type: 'string' } },
      chinesePromptTemplate: { type: 'string' },
      englishPromptTemplate: { type: 'string' },
      keywordTable: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dimension: { type: 'string' },
            chinese: { type: 'string' },
            english: { type: 'string' },
            locked: { type: 'boolean' },
          },
          required: ['dimension', 'chinese', 'english', 'locked'],
          additionalProperties: false,
        },
      },
    },
    required: [
      'name',
      'description',
      'visualAnalysis',
      'preservedRules',
      'replaceableElements',
      'textRules',
      'chinesePromptTemplate',
      'englishPromptTemplate',
      'keywordTable',
    ],
    additionalProperties: false,
  },
} as const

async function requestModelJson(options: {
  settings: AppSettings
  profile: ApiProfile
  instructions: string
  userContent: unknown
  responseFormat:
    | typeof VISUAL_PROFILE_TEXT_FORMAT
    | typeof VARIABLE_PROMPT_GENERATION_TEXT_FORMAT
    | typeof REFERENCE_STYLE_PROMPT_FORMAT
    | typeof VISUAL_SKILL_FORMAT
  signal?: AbortSignal
  /** 超时提示里展示的业务名，便于用户判断卡在哪一步。 */
  timeoutLabel?: string
}): Promise<string> {
  const { settings, profile, instructions, userContent, responseFormat, signal, timeoutLabel = '模型请求' } = options
  const proxy = readClientDevProxyConfig()
  const useChatCompletions = getAgentTextProtocol(settings, profile) === 'chat-completions'
  const url = buildApiUrl(
    profile.baseUrl,
    useChatCompletions ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const send = (useStructuredOutput: boolean) => {
    const body = useChatCompletions
      ? {
          model: profile.model || settings.model,
          messages: [
            { role: 'system', content: instructions },
            {
              role: 'user',
              // chat 协议：content 数组需用 text/image_url 类型（responses 的 input_text/input_image 不兼容）
              content: Array.isArray(userContent)
                ? toChatCompletionsMessageContent(userContent as Array<Record<string, string>>)
                : typeof userContent === 'string'
                  ? userContent
                  : JSON.stringify(userContent),
            },
          ],
          max_tokens: 12000,
          ...(useStructuredOutput
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: responseFormat.name, strict: true, schema: responseFormat.schema },
                },
              }
            : {}),
        }
      : {
          model: profile.model || settings.model,
          instructions,
          // responses 协议：input 必须是 [{role, content}]，content 内才是多模态数组/字符串
          input: [{ role: 'user', content: userContent as string | Array<Record<string, unknown>> }],
          max_output_tokens: 12000,
          ...(useStructuredOutput ? { text: { format: responseFormat } } : {}),
        }
    return fetchTextModelWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${profile.apiKey}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify(body),
      },
      { signal, timeoutMs: resolveTextRequestTimeoutMs(profile.timeout), label: timeoutLabel },
    )
  }

  let response = await send(true)
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    response = await send(false)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`模型请求失败（${response.status}）：${body.slice(0, 180)}`)
  }
  const payload = (await response.json()) as unknown
  return useChatCompletions ? extractChatCompletionsText(payload) : extractResponseText(payload)
}

/**
 * 两阶段变量提示词生成：一键衍生专用。
 * 阶段一：参考图 → 结构化视觉档案（事实，不偷懒）
 * 阶段二：档案摘要 + 维度策略 → 变量模板，质量校验不合格自动重试一次
 */
export async function generateVariablePromptTwoPhase(
  description: string,
  referenceImages: Array<{ name: string; dataUrl: string }>,
  options: {
    excludeText?: boolean
    dimensionPolicyInstruction?: string
    copyModeInstruction?: string
    metaInstruction?: string
    onProgress?: (stage: string, message: string) => void
    signal?: AbortSignal
  } = {},
): Promise<GeneratedSop> {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    const message = validationError
      ? `请先完善 Agent 配置：${validationError}`
      : '两阶段衍生需要管理员配置 OpenAI 兼容的 Agent 文本模型'
    throw new Error(message)
  }
  if (referenceImages.length === 0) throw new Error('两阶段衍生至少需要一张参考图片')

  const brief = description.trim()
  const imageContent: Array<Record<string, string>> = [
    { type: 'input_text', text: brief ? `用户补充需求：\n${brief}` : '未提供补充需求，请完全依据参考图分析。' },
  ]
  referenceImages.forEach((image, index) => {
    imageContent.push({ type: 'input_text', text: `参考图 ${index + 1}/${referenceImages.length}：${image.name}` })
    imageContent.push({ type: 'input_image', image_url: image.dataUrl })
  })

  options.onProgress?.('analyze', `正在逐张分析 ${referenceImages.length} 张参考图…`)
  const profileText = await requestModelJson({
    settings,
    profile,
    instructions: VISUAL_PROFILE_INSTRUCTION,
    userContent: imageContent,
    responseFormat: VISUAL_PROFILE_TEXT_FORMAT,
    signal: options.signal,
    timeoutLabel: '参考图视觉分析',
  })

  options.onProgress?.('summarize', '正在整理视觉档案…')
  const profiles = parseVisualProfiles(profileText)
  const profileSummary = buildProfileSummary(profiles)

  const baseInstruction =
    options.metaInstruction ?? (options.excludeText ? IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION : '')
  const isCopyDeriveMode = !options.excludeText && /文案也参与衍生/.test(options.copyModeInstruction ?? '')
  const instructions = [
    isCopyDeriveMode
      ? '你是「带文案变量提示词生成器」。根据参考图视觉档案，生成可直接解析执行的变量提示词模板，模板必须同时包含视觉变量与文案变量。'
      : baseInstruction || '你是变量提示词模板生成器。根据参考图视觉档案，生成可直接解析执行的变量提示词模板。',
    '应用只接收 name、description、variablePrompt 三个字段。variablePrompt 必须是可直接拆解生图的完整模板：正文使用 {{变量名}} 占位，正文后空一行写“可变项：”，每个变量单独一行，格式为 {{变量名}}：选项A / 选项B / 选项C。',
    options.excludeText === false && !options.metaInstruction ? KEEP_TEXT_SKILL_INSTRUCTION : '',
    options.excludeText ? EXCLUDE_TEXT_SKILL_INSTRUCTION : '',
    options.dimensionPolicyInstruction ?? '',
    options.copyModeInstruction ?? '',
    isCopyDeriveMode
      ? '本模式为「文案也衍生」：视觉档案中的「画面文字」是必须衍生的素材，不是锁定事实。正文中不得写死任何文案，所有文字内容必须出现在可变项中。'
      : '以下视觉档案是对参考图的客观分析。模板必须忠于档案中的事实：锁定事实不得改变；可衍生维度必须来自档案列出的维度；不要编造档案中没有的视觉元素。',
    '',
    '视觉档案：',
    profileSummary,
  ]
    .filter(Boolean)
    .join('\n\n')

  options.onProgress?.('generate', '正在基于视觉档案生成变量提示词模板…')
  const generateOnce = async (retryHint: string): Promise<GeneratedSop> => {
    // 维度策略与文案模式放用户消息：贴近请求，模型必须回应而非忽略系统指令
    const userInstructions = [
      options.dimensionPolicyInstruction
        ? `【衍生维度策略（必须严格遵守）】\n${options.dimensionPolicyInstruction}`
        : '',
      options.copyModeInstruction ? `【文案处理】\n${options.copyModeInstruction}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const text = await requestModelJson({
      settings,
      profile,
      instructions: `${instructions}\n\n${retryHint}`,
      userContent: [
        {
          type: 'input_text',
          text: [
            '根据以下视觉档案生成变量提示词模板。',
            userInstructions,
            '',
            '【参考图视觉档案】',
            profileSummary,
            '',
            '输出要求：每个「大改」维度的选项必须跨越语义层级（换主体类别/风格流派/场景类型），禁止同义改写；每个变量至少 8 个选项。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      responseFormat: VARIABLE_PROMPT_GENERATION_TEXT_FORMAT,
      signal: options.signal,
      timeoutLabel: '变量提示词模板生成',
    })
    return parseGeneratedVariablePrompt(text)
  }

  const generated = await generateOnce('')
  // 质量校验：不合格自动重试一次（携带问题说明）
  const parsed = parseVariablePrompt(generated.sop)
  if (parsed.enabled && options.dimensionPolicyInstruction) {
    const policy = parsePolicyFromInstruction(options.dimensionPolicyInstruction)
    if (policy) {
      const issues = validateVariablePromptTemplate(parsed.body, parsed.variables, policy)
      if (issues.length > 0) {
        options.onProgress?.('validate', `模板质量校验未通过（${issues[0]}），正在重新生成…`)
        const retried = await generateOnce(`上一轮模板存在质量问题：\n- ${issues.join('\n- ')}\n请修正后重新完整生成。`)
        const retriedParsed = parseVariablePrompt(retried.sop)
        if (retriedParsed.enabled) {
          const retriedIssues = validateVariablePromptTemplate(retriedParsed.body, retriedParsed.variables, policy)
          if (retriedIssues.length === 0) return retried
          options.onProgress?.('validate', `重新生成仍存在质量问题：${retriedIssues[0]}`)
        }
      }
    }
  }
  return generated
}

/** 独立的参考图风格复刻：只返回普通生图提示词，不生成变量模板。 */
export async function generateReferenceStylePrompt(
  theme: string,
  referenceImages: Array<{ name: string; dataUrl: string }>,
  signal?: AbortSignal,
): Promise<string> {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai') {
    throw new Error(
      validationError
        ? `请先完善 Agent 配置：${validationError}`
        : '参考图风格复刻需要配置 OpenAI 兼容的 Agent 文本模型',
    )
  }
  if (!theme.trim()) throw new Error('请输入至少一个新主题')
  if (referenceImages.length === 0) throw new Error('参考图风格复刻至少需要一张参考图')
  const content: Array<Record<string, string>> = [{ type: 'input_text', text: `新主题：${theme.trim()}` }]
  referenceImages.forEach((image, index) => {
    content.push({ type: 'input_text', text: `参考图 ${index + 1}：${image.name}` })
    content.push({ type: 'input_image', image_url: image.dataUrl })
  })
  const text = await requestModelJson({
    settings,
    profile,
    instructions: `你是参考图风格复刻提示词生成器。分析参考图后，为用户的新主题生成一条可直接用于图片生成模型的完整提示词。
必须保留参考图的构图、视角、主体比例、材质、色彩关系、光照、背景处理和整体视觉风格；只替换主体主题。
不要输出变量、占位符、可变项列表、JSON 以外的解释、Markdown 或多个方案。prompt 必须是普通完整提示词。`,
    userContent: content,
    responseFormat: REFERENCE_STYLE_PROMPT_FORMAT,
    signal,
    timeoutLabel: '参考图风格复刻',
  })
  const parsed = JSON.parse(text) as { prompt?: unknown }
  if (typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) throw new Error('模型没有返回有效的风格复刻提示词')
  return parsed.prompt.trim()
}

export async function generateVisualSkill(
  referenceImages: Array<{ name: string; dataUrl: string }>,
  description = '',
): Promise<string> {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError || profile.provider !== 'openai')
    throw new Error(validationError || '创建视觉 Skill 需要 OpenAI 兼容的 Agent 文本模型')
  const content: Array<Record<string, string>> = [
    { type: 'input_text', text: description || '请根据参考图创建可复用的视觉 Skill' },
  ]
  referenceImages.forEach((image, index) => {
    content.push({ type: 'input_text', text: `参考图 ${index + 1}：${image.name}` })
    content.push({ type: 'input_image', image_url: image.dataUrl })
  })
  const text = await requestModelJson({
    settings,
    profile,
    instructions:
      '分析参考图并生成可复用视觉 Skill。只替换主体主题，保留视觉风格、构图、材质、色彩、光影和背景。所有提示词模板必须使用 {theme} 作为唯一主题占位符。只返回 JSON。',
    userContent: content,
    responseFormat: VISUAL_SKILL_FORMAT,
    timeoutLabel: '视觉 Skill 创建',
  })
  return text
}

/** 从维度策略指令反解出策略对象（用于质量校验）；解析失败返回 null。 */
function parsePolicyFromInstruction(instruction: string): DeriveDimensionPolicy | null {
  const policy: Partial<DeriveDimensionPolicy> = {}
  for (const dimension of DERIVE_DIMENSIONS) {
    const match = instruction.match(new RegExp(`- ${dimension}：\\s*(锁定|微调|大改)`))
    if (!match) return null
    policy[dimension] = match[1] === '锁定' ? 'lock' : match[1] === '大改' ? 'change' : 'tweak'
  }
  if (DERIVE_DIMENSIONS.some((dimension) => !policy[dimension])) return null
  return policy as DeriveDimensionPolicy
}
