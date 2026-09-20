/**
 * DataGrid —— 可编辑数据表格。
 *
 * ## 为什么要有它
 *
 * 中控台是全部数据的本体（见 `lib/controlConsoleSections.ts` 的头注），而它的每一个数据面
 * —— 渠道、尺寸、输出位置、方向参数、水印归属、分发 —— 都是「多条同构记录」。
 * 用卡片或表单逐条改既慢又容易漏（`MediaTableManager` 那种卡片式编辑器就是例子：
 * 「改规格」要先展开、再逐个字段点）。
 *
 * 表格把「哪些行、哪些列、当前值」一次摆在眼前。**更重要的是它给了导入导出一个单一形状**：
 * 列定义同时驱动界面编辑与 Excel 表头映射，不存在「界面上叫渠道名、导出叫 name」这种两套清单。
 *
 * ## 三条刻意的设计
 *
 * 1. **不并入 `Table`**（`data-display.tsx`）：那个只是样式基元（thead/tr/td 的皮），
 *    已被若干只读场景消费。给它加编辑行为，那些地方会白白承担一份它们不用的复杂度。
 * 2. **行主键必须由调用方给**（`getRowId`），组件**永不**用数组下标。
 *    下标做 key 时，删行或排序会让正在编辑的单元格把值写到隔壁行上 —— 这是静默写坏数据。
 * 3. **单元格是草稿态提交**：输入期间只动本地 draft，失焦或回车才 `onCellCommit`。
 *    直接受控会在用户删空输入框的瞬间把它回填成原值，数字根本改不了
 *    （`MediaTableManager` 的 `SizeField` 已经踩过这个坑，注释还在）。
 *
 * ## 校验失败不写库
 *
 * `column.validate` 返回文案即拒绝提交，并在该单元格内显示红字。**不用 toast** ——
 * toast 一闪而过，用户回头看已经找不到是哪一格错了；行内提示留在原地，直到改对为止。
 * 这是仓库里反复出现的教训：失败必须可见（见 `docs/architecture-constraints.md` 七·五章）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EmptyState, cx } from './components'
import { Checkbox, type SelectOption } from './forms'

/** 单元格编辑器类型。`readonly` 用于派生列（如「画面方向由宽高推导」）。 */
export type DataGridEditorKind = 'text' | 'number' | 'switch' | 'select' | 'tags' | 'path' | 'readonly'

export interface DataGridColumn<Row> {
  /** 列键。**同时是导入导出的字段键** —— 改它等于改协议，别随 UI 文案一起改。 */
  key: string
  /** 中文列名（仅显示用，不参与任何匹配）。 */
  header: string
  /** 一句话说明这一列管什么，挂在表头 `title` 上。 */
  help?: string
  editor: DataGridEditorKind
  /** 固定列宽（px）。不给则按内容自适应。 */
  width?: number
  /** 数字列右对齐更易比较。 */
  align?: 'start' | 'end'
  placeholder?: string
  /** `select` 编辑器的候选（全表共用一套时给这个）。 */
  options?: SelectOption[]
  /** `select` 编辑器的候选（逐行不同时给这个，如「渠道」取决于行）。优先于 `options`。 */
  optionsForRow?: (row: Row) => SelectOption[]
  /**
   * `path` 编辑器的选择目录入口。**由调用方注入** —— 设计系统不认识 Electron，
   * 也不该认识。返回 `null` 表示用户取消。
   */
  pickPath?: (current: string) => Promise<string | null>
  /** 只读列的自定义展示（优先于原值文本）。 */
  render?: (row: Row) => ReactNode
  /** 取值器。默认按 `key` 从行对象上取。 */
  getValue?: (row: Row) => unknown
  /** 校验器：返回文案则拒绝本次提交。 */
  validate?: (value: unknown, row: Row) => string | null
}

export interface DataGridProps<Row extends object> {
  columns: Array<DataGridColumn<Row>>
  rows: Row[]
  /** 行主键。**必填且必须稳定**（见头注第 2 条）。 */
  getRowId: (row: Row) => string
  /** 提交单格改动。调用方负责写回真实的数据源（store action），不要直接改数组。 */
  onCellCommit: (rowId: string, columnKey: string, value: unknown) => void
  /** 表格的无障碍名称（如「渠道与尺寸」）。 */
  'aria-label': string
  className?: string
  /** 空态文案。 */
  emptyTitle?: string
  emptyDescription?: string
  /** 显示字段键（导出/对账时可打开，平时关掉避免噪音）。 */
  showFieldKeys?: boolean
  /** 批量选择。三者同时给出才生效。 */
  selectable?: boolean
  selectedIds?: string[]
  onSelectedIdsChange?: (ids: string[]) => void
  /** 首列冻结（默认开）。宽表横向滚动时没有它基本没法用。 */
  stickyFirstColumn?: boolean
  /** 行高（px），虚拟滚动按它算窗口。 */
  rowHeight?: number
  /** 超过该行数启用虚拟滚动。 */
  virtualizeThreshold?: number
}

const DEFAULT_ROW_HEIGHT = 34
/** 可视区上下各多渲染几行，滚动时不会出现空白带。 */
const OVERSCAN_ROWS = 6
const DEFAULT_VIRTUALIZE_THRESHOLD = 200

/** 把任意单元格值转成可编辑文本。数组（如水印清单、多目录）用逗号连接。 */
function toEditorText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  return String(value)
}

/** 解析逗号分隔列表（中文逗号也认：用户从表格里粘过来的多半是全角）。 */
export function parseTagList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

interface GridCellProps<Row extends object> {
  column: DataGridColumn<Row>
  row: Row
  rowId: string
  onCommit: (rowId: string, columnKey: string, value: unknown) => void
}

/**
 * 单个可编辑单元格。
 *
 * 内部持有 draft：聚焦期间显示 draft、忽略外部值变化（否则 store 回写会打断用户输入），
 * 失焦或回车时提交，`Esc` 撤回。
 */
function GridCell<Row extends object>({ column, row, rowId, onCommit }: GridCellProps<Row>) {
  const rawValue = column.getValue ? column.getValue(row) : (row as Record<string, unknown>)[column.key]
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const commit = useCallback(
    (next: unknown): boolean => {
      const message = column.validate?.(next, row) ?? null
      if (message) {
        setError(message)
        return false
      }
      setError(null)
      onCommit(rowId, column.key, next)
      return true
    },
    [column, onCommit, row, rowId],
  )

  // ---- 只读 ----
  if (column.editor === 'readonly') {
    return (
      <span className="ds-data-grid__readonly">
        {column.render ? column.render(row) : toEditorText(rawValue) || '—'}
      </span>
    )
  }

  // ---- 开关：点一下就是一个完整动作，不需要草稿 ----
  if (column.editor === 'switch') {
    return (
      <span className="ds-data-grid__switch">
        <Checkbox
          checked={Boolean(rawValue)}
          onChange={(next) => commit(next)}
          aria-label={`${column.header}：${getRowLabel(row)}`}
        />
      </span>
    )
  }

  // ---- 枚举下拉：选中即提交 ----
  if (column.editor === 'select') {
    const options = column.optionsForRow?.(row) ?? column.options ?? []
    const current = toEditorText(rawValue)
    return (
      <select
        className="ds-input ds-data-grid__editor"
        aria-label={`${column.header}：${getRowLabel(row)}`}
        value={current}
        onChange={(event) => commit(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  const shown = focused ? draft : toEditorText(rawValue)

  /** 提交当前草稿；非法输入只报错、不写库，也**不**把 draft 清掉（用户还要接着改）。 */
  const commitDraft = () => {
    if (!focused) return
    setFocused(false)
    if (column.editor === 'number') {
      const text = draft.trim()
      if (!text) {
        commit(undefined)
        return
      }
      const parsed = Number(text)
      if (!Number.isFinite(parsed)) {
        setError('需要一个数字')
        return
      }
      if (parsed === rawValue) return
      commit(parsed)
      return
    }
    if (column.editor === 'tags') {
      commit(parseTagList(draft))
      return
    }
    const next = draft
    if (next === toEditorText(rawValue)) return
    commit(next)
  }

  return (
    <span className="ds-data-grid__editor-wrap">
      <input
        className={cx('ds-input', 'ds-data-grid__editor', column.align === 'end' && 'ds-data-grid__editor--end')}
        aria-label={`${column.header}：${getRowLabel(row)}`}
        aria-invalid={error ? true : undefined}
        placeholder={column.placeholder}
        value={shown}
        onFocus={() => {
          setDraft(toEditorText(rawValue))
          setFocused(true)
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraft()
            return
          }
          // Esc 撤回：先把值还原再失焦，避免 blur 处理器把 draft 又提交上去
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(toEditorText(rawValue))
            setFocused(false)
            setError(null)
            event.currentTarget.blur()
          }
        }}
      />
      {column.editor === 'path' && column.pickPath && (
        <button
          type="button"
          className="ds-data-grid__path-button"
          disabled={picking}
          aria-label={`选择${column.header}目录`}
          onClick={async () => {
            setPicking(true)
            try {
              const picked = await column.pickPath?.(toEditorText(rawValue))
              if (picked) commit(picked)
            } finally {
              setPicking(false)
            }
          }}
        >
          选择
        </button>
      )}
      {error && <span className="ds-data-grid__cell-error">{error}</span>}
    </span>
  )
}

/** 单元格无障碍名称里的行标识：优先名称，其次主键。 */
function getRowLabel(row: object): string {
  const record = row as Record<string, unknown>
  for (const key of ['name', 'label', 'title']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  for (const key of ['id', 'collectionId', 'mediaId', 'presetId']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return '当前行'
}

/**
 * 可编辑数据表格。
 *
 * 虚拟滚动：行数超过 `virtualizeThreshold`（默认 200）时只渲染可视区间，
 * 用上下两条占位行撑起滚动条高度。可视高度未知（首帧）时**不虚拟** —— 否则会只渲染几行，
 * 用户看到一张几乎空白的表。
 */
export function DataGrid<Row extends object>({
  columns,
  rows,
  getRowId,
  onCellCommit,
  className,
  emptyDescription,
  emptyTitle = '没有数据',
  onSelectedIdsChange,
  rowHeight = DEFAULT_ROW_HEIGHT,
  selectable = false,
  selectedIds = [],
  showFieldKeys = false,
  stickyFirstColumn = true,
  virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
  'aria-label': ariaLabel,
}: DataGridProps<Row>) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    setViewportHeight(node.clientHeight)
  }, [])

  const virtualize = rows.length > virtualizeThreshold && viewportHeight > 0

  const window_ = useMemo(() => {
    if (!virtualize) {
      return { start: 0, end: rows.length, topPad: 0, bottomPad: 0 }
    }
    const perScreen = Math.max(1, Math.ceil(viewportHeight / rowHeight))
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS)
    const end = Math.min(rows.length, start + perScreen + OVERSCAN_ROWS * 2)
    return { start, end, topPad: start * rowHeight, bottomPad: (rows.length - end) * rowHeight }
  }, [virtualize, rows.length, viewportHeight, scrollTop, rowHeight])

  const visibleRows = rows.slice(window_.start, window_.end)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selectedSet.has(getRowId(row)))
  const someSelected = selectable && selectedIds.length > 0 && !allSelected

  const columnWidthStyle = (column: DataGridColumn<Row>) =>
    column.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : undefined

  if (rows.length === 0) {
    return (
      <div className={cx('ds-data-grid__viewport ds-data-grid__viewport--empty', className)}>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      className={cx('ds-data-grid__viewport', className)}
      // 行高同时给 CSS 与虚拟窗口用：JS 侧写死一个数、CSS 侧写死另一个数，迟早会飘
      style={{ '--ds-data-grid-row-height': `${rowHeight}px` } as CSSProperties}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <table className="ds-data-grid" aria-label={ariaLabel}>
        <thead>
          <tr>
            {selectable && (
              <th className="ds-data-grid__head-cell ds-data-grid__head-cell--select" scope="col">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(next) => onSelectedIdsChange?.(next ? rows.map((row) => getRowId(row)) : [])}
                  aria-label={allSelected ? '取消全选' : '全选'}
                />
              </th>
            )}
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  'ds-data-grid__head-cell',
                  index === 0 && stickyFirstColumn && 'ds-data-grid__cell--sticky',
                  column.align === 'end' && 'ds-data-grid__head-cell--end',
                )}
                style={columnWidthStyle(column)}
                title={column.help}
              >
                <span className="ds-data-grid__head-label">{column.header}</span>
                {showFieldKeys && <span className="ds-data-grid__field-key">{column.key}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {window_.topPad > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                style={{ height: `${window_.topPad}px`, padding: 0 }}
              />
            </tr>
          )}
          {visibleRows.map((row) => {
            const rowId = getRowId(row)
            const selected = selectable && selectedSet.has(rowId)
            return (
              <tr key={rowId} className="ds-data-grid__row" data-selected={selected ? '' : undefined}>
                {selectable && (
                  <td className="ds-data-grid__cell ds-data-grid__cell--select">
                    <Checkbox
                      checked={selected}
                      onChange={(next) =>
                        onSelectedIdsChange?.(next ? [...selectedIds, rowId] : selectedIds.filter((id) => id !== rowId))
                      }
                      aria-label={`选择 ${getRowLabel(row)}`}
                    />
                  </td>
                )}
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cx(
                      'ds-data-grid__cell',
                      index === 0 && stickyFirstColumn && 'ds-data-grid__cell--sticky',
                      column.align === 'end' && 'ds-data-grid__cell--end',
                    )}
                    style={columnWidthStyle(column)}
                  >
                    <GridCell column={column} row={row} rowId={rowId} onCommit={onCellCommit} />
                  </td>
                ))}
              </tr>
            )
          })}
          {window_.bottomPad > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                style={{ height: `${window_.bottomPad}px`, padding: 0 }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
