/**
 * Agent 编辑器 —— TB-154。
 *
 * 一个弹窗管完：看配方、改配方、管那 13 条规则、用 AI 延展、存 / 删。
 *
 * ## 两处刻意的设计
 *
 * 1. **三段式是纯文本域，不是拆成表格**。配方就是一段文本（真相源），
 *    拆成字段再拼回去，用户手改的换行和顺序就保不住了。
 *    旁边给一份**实时解析出来的体检报告**（`findRuleTextIssues`），比表格更能说清哪里不对。
 * 2. **草稿只在「打开」或「换 Agent」时重置**，不跟着 store 每次更新重置 ——
 *    否则正在打字时被一次无关的 store 更新清掉（R-122 那类"瞬时态被冲掉"的坑）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Dialog, Switch, TextArea } from '../../design-system'
import type { DirectionRule } from './defaults'
import { extendRuleText } from './extendRuleText'
import { findRuleTextIssues, parseRuleText } from './ruleText'
import { useDirectionAgentStore } from './store'

export interface DirectionAgentEditorProps {
  /** 要编辑的 Agent；null = 没选中（弹窗不显示内容）。 */
  agentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Draft {
  name: string
  category: string
  direction: string
  description: string
  ruleText: string
}

const EMPTY_DRAFT: Draft = { name: '', category: '', direction: '', description: '', ruleText: '' }

export default function DirectionAgentEditor({ agentId, open, onOpenChange }: DirectionAgentEditorProps) {
  const agents = useDirectionAgentStore((state) => state.agents)
  const upsertAgent = useDirectionAgentStore((state) => state.upsertAgent)
  const setAgentRules = useDirectionAgentStore((state) => state.setAgentRules)
  const setAgentEnabled = useDirectionAgentStore((state) => state.setAgentEnabled)
  const removeAgent = useDirectionAgentStore((state) => state.removeAgent)

  const agent = useMemo(() => agents.find((item) => item.id === agentId) ?? null, [agents, agentId])

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [rules, setRules] = useState<DirectionRule[]>([])
  const [extendAsk, setExtendAsk] = useState('')
  const [extending, setExtending] = useState(false)
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // 只在「打开」或「换了个 Agent」时灌一次草稿。
  // 依赖里放 agentId 而不是 agent —— 放 agent 的话，保存后再一次 store 更新会把草稿重置回旧值。
  useEffect(() => {
    if (!open || !agent) return
    setDraft({
      name: agent.name,
      category: agent.category,
      direction: agent.direction,
      description: agent.description,
      ruleText: agent.ruleText,
    })
    setRules(agent.rules.map((rule) => ({ ...rule })))
    setExtendAsk('')
    setError('')
    setConfirmingDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId])

  const issues = useMemo(() => findRuleTextIssues(parseRuleText(draft.ruleText)), [draft.ruleText])
  const required = rules.filter((rule) => rule.kind === 'required')
  const forbidden = rules.filter((rule) => rule.kind === 'forbidden')

  const toggleRule = useCallback((id: string, enabled: boolean) => {
    setRules((previous) => previous.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)))
  }, [])

  const save = useCallback(() => {
    if (!agent) return
    upsertAgent({
      id: agent.id,
      name: draft.name,
      category: draft.category,
      direction: draft.direction,
      description: draft.description,
      ruleText: draft.ruleText,
    })
    setAgentRules(agent.id, rules)
    onOpenChange(false)
  }, [agent, draft, rules, upsertAgent, setAgentRules, onOpenChange])

  const runExtend = useCallback(async () => {
    if (extending) return
    if (!extendAsk.trim()) {
      setError('先写一句延展要求，比如「每个池的候选词补到 8 个，再加一档冷色调」')
      return
    }
    setExtending(true)
    setError('')
    try {
      const next = await extendRuleText(draft.ruleText, extendAsk.trim())
      setDraft((previous) => ({ ...previous, ruleText: next }))
      setExtendAsk('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '延展失败，请重试')
    } finally {
      setExtending(false)
    }
  }, [extending, extendAsk, draft.ruleText])

  if (!agent) return null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={`编辑 Agent · ${agent.name}`}
      description="配方是一段文本：固定基底（保留什么、替换什么）/ 变量词池（每组候选词）/ 反向（禁止项）。改完点保存。"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Switch
              label="启用"
              checked={agent.enabled}
              onCheckedChange={(checked: boolean) => setAgentEnabled(agent.id, checked)}
            />
            {confirmingDelete ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-ds-danger">删掉就没了，确定？</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    removeAgent(agent.id)
                    onOpenChange(false)
                  }}
                >
                  删除
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  算了
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
                删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={issues.length > 0}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {(
            [
              ['name', '名字', '如：暖色促销版'],
              ['category', '分类', '如：百度'],
              ['direction', '方向', '如：网赚'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="inline-flex items-center gap-2 text-xs">
              <span className="text-ds-muted">{label}</span>
              <input
                value={draft[key]}
                onChange={(event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }))}
                placeholder={placeholder}
                className="h-8 w-[150px] rounded-ds-md border border-ds-border bg-ds-surface-subtle px-2 text-xs text-ds-text outline-none transition placeholder:text-ds-text-subtle focus:border-ds-primary/40 dark:bg-ds-surface"
              />
            </label>
          ))}
        </div>

        <label className="block text-xs">
          <span className="text-ds-muted">备注（不参与出图，只是让人看明白这版配方要什么）</span>
          <textarea
            value={draft.description}
            onChange={(event) => setDraft((previous) => ({ ...previous, description: event.target.value }))}
            rows={2}
            className="mt-1 w-full rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 text-xs leading-relaxed text-ds-text outline-none transition placeholder:text-ds-text-subtle focus:border-ds-primary/40 dark:bg-ds-surface"
          />
        </label>

        <div>
          <div className="mb-1 flex items-center justify-end">
            <span className="text-xs text-ds-text-subtle dark:text-ds-muted">
              {issues.length === 0 ? '格式没问题' : `${issues.length} 处要改`}
            </span>
          </div>
          <TextArea
            label="配方"
            value={draft.ruleText}
            onChange={(event) => setDraft((previous) => ({ ...previous, ruleText: event.target.value }))}
            rows={16}
            spellCheck={false}
            className="font-mono text-xs"
          />
          {issues.length > 0 && (
            <Alert tone="warning" className="mt-2">
              <ul className="list-disc space-y-0.5 pl-4">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={extendAsk}
            onChange={(event) => setExtendAsk(event.target.value)}
            placeholder="让 AI 改一版，比如：每个池补到 8 个候选词"
            className="h-8 min-w-[260px] flex-1 rounded-ds-md border border-ds-border bg-ds-surface-subtle px-2 text-xs text-ds-text outline-none transition placeholder:text-ds-text-subtle focus:border-ds-primary/40 dark:bg-ds-surface"
          />
          <Button variant="secondary" size="sm" loading={extending} onClick={() => void runExtend()}>
            用 AI 延展
          </Button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="border-t border-ds-border pt-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs text-ds-muted">规则</span>
            <Badge tone="info">必须遵循 {required.length}</Badge>
            <Badge tone="danger">禁止出现 {forbidden.length}</Badge>
            <span className="text-xs text-ds-text-subtle dark:text-ds-muted">
              出品时按这里的勾选生效，取消勾选即停用
            </span>
          </div>
          <div className="max-h-[180px] space-y-1 overflow-y-auto pr-1">
            {[...required, ...forbidden].map((rule) => (
              <label
                key={rule.id}
                className="flex items-start gap-2 rounded-ds-md px-2 py-1.5 text-xs transition-colors hover:bg-ds-surface-subtle dark:hover:bg-ds-surface"
              >
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => toggleRule(rule.id, event.target.checked)}
                  className="mt-0.5 shrink-0"
                  aria-label={rule.text}
                />
                <span className={rule.enabled ? 'text-ds-text' : 'text-ds-text-subtle line-through dark:text-ds-muted'}>
                  <span className="mr-1 text-ds-text-subtle dark:text-ds-muted">
                    {rule.kind === 'required' ? '必须' : '禁止'}
                  </span>
                  {rule.text}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
