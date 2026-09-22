import type { DailyDirectionRatio, DailyRun, DailySkip, DailyTarget, StrategyCard } from './types'

/**
 * 每日批量生成的落盘归一化（TB-108）。
 *
 * ⚠️ 这份文件里的字段清单是**显式白名单**：漏一个字段，落库读回来它就凭空消失，
 * 而且**全程不报错**（界面只是少显示一样东西，没有任何痕迹可查）。
 * TB-105 在 `normalizeAsset` 上踩过同一件事，所以新增字段时务必同时改这里。
 */

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asPositiveInt(value: unknown, fallback: number, min = 1): number {
  const raw = asNumber(value, fallback)
  return Math.max(min, Math.trunc(raw))
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => asString(item)).filter(Boolean))]
}

/** 无效记录直接丢弃（缺 id / 缺引用目标），不留半截对象在库里。 */
export function normalizeStrategyCard(raw: unknown, now = Date.now()): StrategyCard | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const id = asString(input.id)
  const sopId = asString(input.sopId)
  const directionCollectionId = asString(input.directionCollectionId)
  if (!id || !sopId || !directionCollectionId) return null
  const createdAt = asNumber(input.createdAt, now)
  return {
    id,
    sopId,
    directionCollectionId,
    // 名字缺省时用 SOP 名兜底：卡必须有看得懂的标题，否则界面上一片「未命名」
    name: asString(input.name) || asString(input.sopName) || '未命名策略卡',
    sopName: asString(input.sopName),
    imagesPerPrompt: asPositiveInt(input.imagesPerPrompt, 1),
    weight: asPositiveInt(input.weight, 1),
    enabled: asBoolean(input.enabled, true),
    notes: asString(input.notes) || undefined,
    createdAt,
    updatedAt: asNumber(input.updatedAt, createdAt),
    sourceBatchId: asString(input.sourceBatchId) || undefined,
  }
}

function normalizeRatio(raw: unknown): DailyDirectionRatio | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const directionCollectionId = asString(input.directionCollectionId)
  if (!directionCollectionId) return null
  return {
    directionCollectionId,
    ratio: Math.max(0, asNumber(input.ratio, 0)),
  }
}

export function normalizeDailyTarget(raw: unknown, now = Date.now()): DailyTarget | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const id = asString(input.id)
  const productCollectionId = asString(input.productCollectionId)
  if (!id || !productCollectionId) return null
  const createdAt = asNumber(input.createdAt, now)
  return {
    id,
    productCollectionId,
    // 每日总数允许为 0（等于关掉），但不许是负数
    dailyTotal: Math.max(0, Math.trunc(asNumber(input.dailyTotal, 0))),
    directionRatios: Array.isArray(input.directionRatios)
      ? input.directionRatios.map(normalizeRatio).filter((item): item is DailyDirectionRatio => item !== null)
      : [],
    enabled: asBoolean(input.enabled, true),
    createdAt,
    updatedAt: asNumber(input.updatedAt, createdAt),
  }
}

function normalizeSkip(raw: unknown): DailySkip | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const detail = asString(input.detail)
  if (!detail) return null
  const reason = asString(input.reason)
  return {
    reason: (['no-cards', 'card-sop-missing', 'direction-missing', 'prompt-empty'].includes(reason)
      ? reason
      : 'no-cards') as DailySkip['reason'],
    directionCollectionId: asString(input.directionCollectionId) || undefined,
    cardId: asString(input.cardId) || undefined,
    detail,
  }
}

export function normalizeDailyRun(raw: unknown, now = Date.now()): DailyRun | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const id = asString(input.id)
  const date = asString(input.date)
  if (!id || !date) return null
  const status = asString(input.status)
  return {
    id,
    date,
    productCollectionId: asString(input.productCollectionId),
    batchId: asString(input.batchId),
    status: (['running', 'done', 'partial', 'failed'].includes(status) ? status : 'failed') as DailyRun['status'],
    plans: Array.isArray(input.plans)
      ? input.plans.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const plan = item as Record<string, unknown>
          return [
            {
              directionCollectionId: asString(plan.directionCollectionId),
              directionName: asString(plan.directionName),
              plannedCount: Math.max(0, Math.trunc(asNumber(plan.plannedCount, 0))),
              cards: Array.isArray(plan.cards)
                ? plan.cards.flatMap((card) => {
                    if (!card || typeof card !== 'object') return []
                    const entry = card as Record<string, unknown>
                    return [
                      {
                        cardId: asString(entry.cardId),
                        cardName: asString(entry.cardName),
                        count: Math.max(0, Math.trunc(asNumber(entry.count, 0))),
                      },
                    ]
                  })
                : [],
            },
          ]
        })
      : [],
    submittedTaskIds: asStringArray(input.submittedTaskIds),
    skipped: Array.isArray(input.skipped)
      ? input.skipped.map(normalizeSkip).filter((item): item is DailySkip => item !== null)
      : [],
    startedAt: asNumber(input.startedAt, now),
    finishedAt: typeof input.finishedAt === 'number' ? input.finishedAt : null,
    error: asString(input.error) || undefined,
  }
}

/** 只保留最近 N 天的跑批记录：跑批记录只服务于「当天去重」和「预览最近几天」，不需要全留。 */
export const DAILY_RUN_KEEP_DAYS = 30

export function pruneDailyRuns(runs: DailyRun[]): DailyRun[] {
  const sorted = [...runs].sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt)
  return sorted.slice(0, DAILY_RUN_KEEP_DAYS)
}
