/**
 * 媒体表管理区（渠道 + 尺寸规格的增删改）。
 *
 * 这是 `usePostprocessMediaStore` 里那批 CRUD action 的**唯一 UI 入口**：
 * 在此之前它们只有 store 实现、没有任何界面能调到，媒体表事实上是只读的。
 *
 * 只出现在「全局默认」节点的参数面板里——媒体表是全局共享规格，
 * 节点层只能勾选「启用哪些渠道」，改规格必须回到全局，否则同一个渠道在不同方向
 * 会有不同尺寸，产出数量就没法预告。
 *
 * 删除走 `setConfirmDialog`：删渠道会连带把它从启用范围里摘掉，属于不可逆操作。
 */

import { useState } from 'react'
import { Alert, Button, Checkbox, IconButton, SectionHeader, Switch, TextField } from '../../design-system'
import { PlusIcon, TrashIcon } from '../../components/icons'
import { useStore } from '../../store'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { PURE_MEDIA_ID } from '../../lib/postprocessMedia'

export default function MediaTableManager() {
  const media = usePostprocessMediaStore((state) => state.media)
  const addMedia = usePostprocessMediaStore((state) => state.addMedia)
  const renameMedia = usePostprocessMediaStore((state) => state.renameMedia)
  const setMediaEnabled = usePostprocessMediaStore((state) => state.setMediaEnabled)
  const deleteMedia = usePostprocessMediaStore((state) => state.deleteMedia)
  const addMediaSize = usePostprocessMediaStore((state) => state.addMediaSize)
  const updateMediaSize = usePostprocessMediaStore((state) => state.updateMediaSize)
  const deleteMediaSize = usePostprocessMediaStore((state) => state.deleteMediaSize)
  const resetMedia = usePostprocessMediaStore((state) => state.resetMedia)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const showToast = useStore((state) => state.showToast)

  const [newName, setNewName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const id = addMedia(trimmed)
    if (!id) {
      showToast('添加失败：同名渠道已存在', 'error')
      return
    }
    setNewName('')
    setExpandedId(id)
  }

  const handleDeleteMedia = (mediaId: string, name: string) => {
    setConfirmDialog({
      title: `删除渠道「${name}」？`,
      message:
        '这会把它从媒体表与所有已勾选的启用范围里一并移除，之后按这个渠道产出的变体不再生成。已产出的文件不会被删除。',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger',
      action: () => deleteMedia(mediaId),
    })
  }

  const handleReset = () => {
    setConfirmDialog({
      title: '恢复内置媒体表？',
      message: '当前的渠道增删改会被内置的 4 媒体 15 尺寸覆盖，此操作不可恢复。',
      confirmText: '恢复',
      cancelText: '取消',
      tone: 'danger',
      action: () => resetMedia(),
    })
  }

  return (
    <div className="space-y-3">
      <SectionHeader
        title="媒体表"
        description="渠道与尺寸规格，全局共享。节点层只能勾选启用哪些渠道，改规格统一在这里。"
        actions={
          <Button variant="ghost" size="sm" onClick={handleReset}>
            恢复内置
          </Button>
        }
      />

      {media.length === 0 && (
        <Alert tone="warning">媒体表为空，没有可产出的渠道。请至少添加一个渠道，或恢复内置媒体表。</Alert>
      )}

      <div className="space-y-2">
        {media.map((item) => {
          const expanded = expandedId === item.id
          return (
            <div key={item.id} className="rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={item.enabled}
                  onCheckedChange={(checked) => setMediaEnabled(item.id, checked)}
                  label=""
                  aria-label={`${item.enabled ? '停用' : '启用'}渠道 ${item.name}`}
                />
                <TextField
                  label=""
                  className="flex-1"
                  value={item.name}
                  disabled={item.id === PURE_MEDIA_ID}
                  onChange={(event) => renameMedia(item.id, event.target.value)}
                />
                <span className="shrink-0 text-xs text-ds-muted">{item.sizes.length} 个尺寸</span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`media-sizes-toggle-${item.id}`}
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                >
                  {expanded ? '收起' : '尺寸'}
                </Button>
                {item.id !== PURE_MEDIA_ID && (
                  <IconButton
                    size="sm"
                    aria-label={`删除渠道 ${item.name}`}
                    icon={<TrashIcon className="h-3.5 w-3.5" />}
                    onClick={() => handleDeleteMedia(item.id, item.name)}
                  />
                )}
              </div>

              {expanded && (
                <div className="mt-2 space-y-1.5 border-t border-ds-border pt-2">
                  {item.sizes.length === 0 && <p className="text-xs text-ds-muted">还没有尺寸。</p>}
                  {item.sizes.map((size) => (
                    <div key={size.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={size.enabled}
                        onChange={() => updateMediaSize(item.id, size.id, { enabled: !size.enabled })}
                        aria-label={`${size.enabled ? '停用' : '启用'}尺寸 ${size.width}x${size.height}`}
                      />
                      <SizeField
                        value={size.width}
                        onCommit={(width) => updateMediaSize(item.id, size.id, { width })}
                        ariaLabel={`${item.name} 尺寸宽度`}
                      />
                      <span className="text-xs text-ds-muted">×</span>
                      <SizeField
                        value={size.height}
                        onCommit={(height) => updateMediaSize(item.id, size.id, { height })}
                        ariaLabel={`${item.name} 尺寸高度`}
                      />
                      <TextField
                        label=""
                        containerClassName="w-28"
                        value={size.maxSizeKb === 0 ? '' : String(size.maxSizeKb)}
                        placeholder="不限 KB"
                        onChange={(event) => {
                          const raw = event.target.value.trim()
                          // 留空 = 不压缩（0）；非法输入原样忽略，不写坏数据
                          if (!raw) {
                            updateMediaSize(item.id, size.id, { maxSizeKb: 0 })
                            return
                          }
                          const parsed = Number(raw)
                          if (Number.isFinite(parsed) && parsed >= 0)
                            updateMediaSize(item.id, size.id, { maxSizeKb: parsed })
                        }}
                      />
                      <IconButton
                        size="sm"
                        aria-label="删除尺寸"
                        icon={<TrashIcon className="h-3.5 w-3.5" />}
                        onClick={() => deleteMediaSize(item.id, size.id)}
                      />
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addMediaSize(item.id, { width: 1024, height: 1024, maxSizeKb: 0, enabled: true })}
                  >
                    添加尺寸
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <TextField
          label=""
          className="flex-1"
          placeholder="新渠道名称，如「抖音」"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleAdd()
          }}
        />
        <Button variant="secondary" disabled={!newName.trim()} onClick={handleAdd}>
          <PlusIcon className="h-3.5 w-3.5" />
          添加渠道
        </Button>
      </div>
    </div>
  )
}

/**
 * 尺寸数字输入。
 *
 * 受控于 `value` 但用本地草稿态：直接受控会在用户删空输入框的瞬间把它回填成原值，
 * 数字根本改不了。失焦或回车时才提交。
 */
function SizeField({
  value,
  onCommit,
  ariaLabel,
}: {
  value: number
  onCommit: (next: number) => void
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)
  const shown = focused ? draft : String(value)

  const commit = () => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed) && parsed > 0 && parsed !== value) onCommit(Math.trunc(parsed))
    setFocused(false)
  }

  return (
    <TextField
      label=""
      containerClassName="w-20"
      aria-label={ariaLabel}
      value={shown}
      onFocus={() => {
        setDraft(String(value))
        setFocused(true)
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}
