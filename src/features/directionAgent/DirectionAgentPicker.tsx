/**
 * 输入框上的「Agent 模式」胶囊 + 选择弹窗 —— TB-154。
 *
 * ## 为什么是一个组件管两件事
 *
 * 胶囊只有一枚，但它承担两个动作：**开关模式** 和 **选哪个 Agent**。
 * 拆成两个按钮会挤占底栏（那行已经有模型选择器 + 快捷键提示），
 * 所以做成「一个胶囊，右半截是下拉」—— 左半截点击切开关，右半截点击开列表。
 * 两半是各自独立的 `<button>`，各自有 aria，不是画上去的一个伪元素。
 *
 * ## 弹窗为什么照 ModelSwitcher
 *
 * 同一个底栏里已经有一个「图标按钮 + 向上弹出的 340px 面板」（`ModelSwitcher`），
 * 位置、圆角、阴影、弹向全是现成的范式。这里照搬，不另立一套视觉。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, cx } from '../../design-system'
import { useDirectionAgentStore } from './store'
import { describeAgentGroup, type DirectionAgent } from './types'

export interface DirectionAgentPickerProps {
  /** 模式是否开启。 */
  enabled: boolean
  /** 切开关。 */
  onToggle: (enabled: boolean) => void
  /**
   * 点「＋ 从参考图新建」。
   *
   * 由调用方接管 —— 只有输入框知道当前挂了几张参考图（`inputImages`），
   * 本组件不该去读那份状态。
   */
  onRequestReverse: () => void
  /** 打开「编辑 Agent」（点列表项右侧的铅笔）。不给就不显示该按钮。 */
  onEditAgent?: (agent: DirectionAgent) => void
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 shrink-0" aria-hidden="true">
      <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" />
    </svg>
  )
}

export default function DirectionAgentPicker({
  enabled,
  onToggle,
  onRequestReverse,
  onEditAgent,
}: DirectionAgentPickerProps) {
  const agents = useDirectionAgentStore((state) => state.agents)
  const activeAgentId = useDirectionAgentStore((state) => state.activeAgentId)
  const setActiveAgent = useDirectionAgentStore((state) => state.setActiveAgent)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 点到组件外面就收起来。用 mousedown 而不是 click：拖拽挂图那条链路
  // （InputBar 在 document 上挂了 dragover/drop）会吃掉 click，mousedown 更早也更稳。
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current) return
      if (rootRef.current.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const activeAgent = useMemo(
    () => (activeAgentId ? (agents.find((agent) => agent.id === activeAgentId) ?? null) : null),
    [activeAgentId, agents],
  )

  // 弹窗里只列启用中的（照抄瀚灵的「仅显示当前启用的」）；停用的条目只算个数，不铺开
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents])
  const disabledCount = agents.length - enabledAgents.length

  /** 按「分类 · 方向」分组，保持插入顺序（不用排序，用户按自己建卡的顺序找更快）。 */
  const groups = useMemo(() => {
    const map = new Map<string, DirectionAgent[]>()
    for (const agent of enabledAgents) {
      const key = describeAgentGroup(agent)
      const bucket = map.get(key)
      if (bucket) bucket.push(agent)
      else map.set(key, [agent])
    }
    return [...map.entries()]
  }, [enabledAgents])

  const label = activeAgent
    ? `${activeAgent.direction.trim() || activeAgent.category.trim() || '未命名'} · ${activeAgent.name}`
    : 'Agent 模式'

  const pick = (agent: DirectionAgent) => {
    setActiveAgent(agent.id)
    if (!enabled) onToggle(true)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cx(
          'inline-flex h-6 items-center overflow-hidden rounded-ds-md border text-xs transition-colors',
          enabled
            ? 'border-transparent bg-ds-primary text-ds-text-inverse'
            : 'border-ds-border bg-ds-surface-subtle text-ds-muted',
        )}
      >
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          title={enabled ? '关闭 Agent 模式' : '开启 Agent 模式：按配方出一批同方向、互不相同的图'}
          className="inline-flex h-full items-center gap-1.5 px-2.5 transition-[filter] duration-150 hover:brightness-95"
        >
          <StarIcon />
          <span className="max-w-[150px] truncate">{label}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="选择 Agent"
          title="选择 Agent"
          className={cx(
            'inline-flex h-full w-6 items-center justify-center border-l transition-[filter] duration-150 hover:brightness-95',
            enabled ? 'border-ds-text-inverse/25' : 'border-ds-border',
          )}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            className="h-3 w-3"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          aria-label="选择 Agent"
          className="absolute bottom-full left-0 z-dropdown mb-2 w-[300px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface p-1.5 shadow-ds-md dark:border-ds-border"
        >
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1 text-xs text-ds-muted">
            <span>选择 Agent</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onRequestReverse()
              }}
              className="rounded-ds-sm px-1.5 py-0.5 font-medium text-ds-primary transition-colors hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10"
            >
              ＋ 从参考图新建
            </button>
          </div>

          {groups.length === 0 ? (
            <p className="px-2 pb-2 pt-1 text-xs text-ds-muted">
              还没有 Agent。挂一张参考图，点上面「＋ 从参考图新建」把它反推出来。
            </p>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {groups.map(([groupName, list]) => (
                <div key={groupName}>
                  <div className="px-2 pb-0.5 pt-2 text-xs text-ds-text-subtle dark:text-ds-muted">{groupName}</div>
                  {list.map((agent) => {
                    const selected = agent.id === activeAgentId
                    return (
                      <div
                        key={agent.id}
                        className={cx(
                          'group flex items-center gap-2 rounded-ds-lg px-2 py-1.5 text-xs transition-colors',
                          selected
                            ? 'bg-ds-primary-subtle text-ds-primary dark:bg-ds-primary/10'
                            : 'text-ds-text hover:bg-ds-surface-subtle',
                        )}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => pick(agent)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="w-3 shrink-0 text-ds-primary">{selected ? '✓' : ''}</span>
                          <span className="truncate">{agent.name}</span>
                        </button>
                        {onEditAgent && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false)
                              onEditAgent(agent)
                            }}
                            aria-label={`编辑 ${agent.name}`}
                            title="编辑配方"
                            className="shrink-0 rounded-ds-sm px-1.5 py-0.5 text-xs text-ds-muted opacity-0 transition-opacity hover:text-ds-primary focus:opacity-100 group-hover:opacity-100"
                          >
                            编辑
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="mt-1 flex items-center justify-between gap-2 border-t border-ds-border px-2 pt-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs text-ds-text-subtle dark:text-ds-muted">
                {disabledCount > 0 ? `${disabledCount} 个已停用（不显示）` : ''}
              </span>
              {activeAgent && onEditAgent && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onEditAgent(activeAgent)
                  }}
                  className="shrink-0 rounded-ds-sm px-1.5 py-0.5 text-xs font-medium text-ds-primary transition-colors hover:bg-ds-primary-subtle dark:hover:bg-ds-primary/10"
                >
                  编辑当前配方
                </button>
              )}
            </div>
            {enabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onToggle(false)
                  setOpen(false)
                }}
              >
                关闭 Agent 模式
              </Button>
            )}
          </div>
        </div>
      )}

      {enabled && !activeAgent && agents.length > 0 && (
        <Badge tone="warning" className="ml-1.5">
          还没选 Agent
        </Badge>
      )}
    </div>
  )
}
