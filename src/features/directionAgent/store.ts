/**
 * 方向 Agent 的持久化 store —— TB-154。
 *
 * 一条记录装下整份（Agent 没有图片本体，全部条目加起来也就几十 KB，
 * 为它多开两个 namespace 不划算）。
 *
 * ⚠️ 命名空间 `directionAgents` **必须**在 `electron/asset-kernel.ts` 的
 * `APP_DATA_NAMESPACES` 白名单里 —— 漏配的症状是「改完重启就没了」且 UI 完全不报错
 * （R-07）。`lib/appDataNamespaceContract.test.ts` 会拦住。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from '../../lib/desktopJsonStorage'
import { BUILTIN_RULES, DEFAULT_RULE_TEXT, type DirectionRule } from './defaults'
import { createAgentId, normalizeAgents } from './normalize'
import { clampAgentName, type DirectionAgent } from './types'

/** 新建 / 更新一个 Agent 的入参。`id` 缺省 = 新建。 */
export interface DirectionAgentInput {
  id?: string
  name: string
  category: string
  direction: string
  description: string
  /** 三段式规则文本。新建时传空串会自动落 `DEFAULT_RULE_TEXT` 打底。 */
  ruleText: string
}

export interface DirectionAgentStore {
  agents: DirectionAgent[]
  /**
   * 当前选中的 Agent（输入框那枚胶囊显示的就是它）。
   *
   * **持久化在这里、不放组件 state**：这是用户的选择，关掉应用再开应该还在。
   * 放组件 state 的话每次热更新 / 重启都要重选一遍（`creativePool` 的选中态
   * 也是因为这个原因收进了 store）。
   */
  activeAgentId: string | null
  setActiveAgent: (id: string | null) => void
  /** 按 id 新增或覆盖。返回该条 id（新建时由这里生成）。 */
  upsertAgent: (input: DirectionAgentInput) => string
  removeAgent: (id: string) => void
  /** 改名字（列表上就地改，不动其他字段）。 */
  renameAgent: (id: string, name: string) => void
  /** 启用 / 停用（照抄瀚灵的「仅显示当前启用的」）。 */
  setAgentEnabled: (id: string, enabled: boolean) => void
  /** 整体替换某条的约束清单（必须遵循 / 禁止出现）。 */
  setAgentRules: (id: string, rules: DirectionRule[]) => void
}

export const useDirectionAgentStore = create<DirectionAgentStore>()(
  persist(
    (set) => ({
      agents: [],
      activeAgentId: null,

      setActiveAgent: (id) => set({ activeAgentId: id }),

      upsertAgent: (input) => {
        const now = Date.now()
        const id = input.id ?? createAgentId()
        set((state) => {
          const index = state.agents.findIndex((agent) => agent.id === id)
          const isNew = index < 0
          const base: DirectionAgent = isNew
            ? {
                id,
                name: '',
                category: '',
                direction: '',
                description: '',
                ruleText: '',
                rules: [],
                enabled: true,
                createdAt: now,
                updatedAt: now,
              }
            : state.agents[index]
          const ruleText = input.ruleText.trim() ? input.ruleText : isNew ? DEFAULT_RULE_TEXT : base.ruleText
          const next: DirectionAgent = {
            ...base,
            name: clampAgentName(input.name),
            category: input.category.trim(),
            direction: input.direction.trim(),
            description: input.description,
            ruleText,
            // 新条目一出生就带着出厂那 13 条（含 6 条合规红线）—— 照抄瀚灵的做法
            rules: isNew ? BUILTIN_RULES.map((rule) => ({ ...rule })) : base.rules,
            updatedAt: now,
          }
          const agents = [...state.agents]
          if (isNew) agents.push(next)
          else agents[index] = next
          // 新建的自动选中 ——「从参考图新建」之后用户下一步就是拿它出图
          return { agents, activeAgentId: isNew ? id : state.activeAgentId }
        })
        return id
      },

      removeAgent: (id) =>
        set((state) => ({
          agents: state.agents.filter((agent) => agent.id !== id),
          // 删掉的正好是当前选中的，就把选中态清空，别让胶囊指着一个不存在的 Agent
          activeAgentId: state.activeAgentId === id ? null : state.activeAgentId,
        })),

      renameAgent: (id, name) =>
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.id === id ? { ...agent, name: clampAgentName(name), updatedAt: Date.now() } : agent,
          ),
        })),

      setAgentEnabled: (id, enabled) =>
        set((state) => ({
          agents: state.agents.map((agent) => (agent.id === id ? { ...agent, enabled, updatedAt: Date.now() } : agent)),
        })),

      setAgentRules: (id, rules) =>
        set((state) => ({
          agents: state.agents.map((agent) => (agent.id === id ? { ...agent, rules, updatedAt: Date.now() } : agent)),
        })),
    }),
    {
      name: 'tangbao-direction-agents',
      version: 1,
      storage: createDesktopJsonStorage('directionAgents'),
      partialize: (state) => ({ agents: state.agents, activeAgentId: state.activeAgentId }),
      // 落盘数据被手改或来自旧版本时兜住：归一化会把「出不了图」的脏条目丢掉，
      // 不让一份坏数据把整个列表卡成「点了没反应」。
      // 选中态也要一起校验 —— 它指向的条目可能刚好被归一化丢掉了，
      // 留着的话胶囊会显示一个并不存在的 Agent。
      migrate: (persisted) => {
        const input = (persisted ?? {}) as Record<string, unknown>
        const agents = normalizeAgents(input.agents)
        const activeAgentId =
          typeof input.activeAgentId === 'string' && agents.some((agent) => agent.id === input.activeAgentId)
            ? input.activeAgentId
            : null
        return { agents, activeAgentId }
      },
    },
  ),
)

/** 读全部 Agent（组件里用）。 */
export function useDirectionAgents(): DirectionAgent[] {
  return useDirectionAgentStore((state) => state.agents)
}

/** 读当前选中的 Agent；没选、或选中的那条已经不在了，都返回 null。 */
export function useActiveDirectionAgent(): DirectionAgent | null {
  return useDirectionAgentStore((state) =>
    state.activeAgentId ? (state.agents.find((agent) => agent.id === state.activeAgentId) ?? null) : null,
  )
}
