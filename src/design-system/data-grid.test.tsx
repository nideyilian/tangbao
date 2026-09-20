/* @vitest-environment jsdom */

/**
 * DataGrid 的行为回归。
 *
 * 重点钉住三件容易悄悄坏掉的事：
 * 1. **主键而不是下标**决定改的是哪一行（行顺序变了，值不能写串）；
 * 2. **草稿态提交**：Esc 必须撤回、非法数字必须不写库（写坏数据是最贵的 bug）；
 * 3. **校验失败留在单元格里**，不落库也不消失。
 */

import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './components'
import { Checkbox } from './forms'
import { DataGrid, parseTagList, type DataGridColumn } from './data-grid'

interface Row {
  id: string
  name: string
  width: number
  enabled: boolean
  dirs: string[]
}

const baseColumns: Array<DataGridColumn<Row>> = [
  { key: 'name', header: '渠道名', editor: 'text' },
  { key: 'width', header: '宽', editor: 'number', align: 'end' },
  { key: 'enabled', header: '启用', editor: 'switch' },
]

const baseRows: Row[] = [
  { id: 'a', name: '广点通', width: 1280, enabled: true, dirs: ['D:/A'] },
  { id: 'b', name: '百度', width: 1080, enabled: false, dirs: [] },
]

function renderGrid(overrides: Partial<Parameters<typeof DataGrid<Row>>[0]> = {}) {
  const onCellCommit = vi.fn()
  const onSelectedIdsChange = vi.fn()
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(
      <DataGrid
        aria-label="渠道表"
        columns={baseColumns}
        rows={baseRows}
        getRowId={(row) => row.id}
        onCellCommit={onCellCommit}
        onSelectedIdsChange={onSelectedIdsChange}
        {...overrides}
      />,
    )
  })
  return { renderer, onCellCommit, onSelectedIdsChange }
}

/** 按无障碍名称取单元格输入框：`列名：行名`。 */
function inputFor(renderer: ReturnType<typeof create>, label: string) {
  const found = renderer.root
    .findAllByType('input')
    .find((node) => String(node.props['aria-label'] ?? '').startsWith(label))
  if (!found) throw new Error(`没找到输入框：${label}`)
  return found
}

function edit(input: ReturnType<typeof inputFor>, text: string, finish: 'blur' | 'enter' = 'blur') {
  act(() => {
    input.props.onFocus()
  })
  act(() => {
    input.props.onChange({ target: { value: text } })
  })
  act(() => {
    if (finish === 'enter') input.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
    else input.props.onBlur()
  })
}

describe('DataGrid', () => {
  it('每个编辑列都渲染出带行列名的输入框（表头与行都进了无障碍树）', () => {
    const { renderer } = renderGrid()
    const labels = renderer.root.findAllByType('input').map((node) => String(node.props['aria-label'] ?? ''))
    expect(labels).toContain('渠道名：广点通')
    expect(labels).toContain('宽：百度')
  })

  it('失焦提交文本改动', () => {
    const { renderer, onCellCommit } = renderGrid()
    edit(inputFor(renderer, '渠道名：广点通'), '广点通新')
    expect(onCellCommit).toHaveBeenCalledWith('a', 'name', '广点通新')
  })

  it('回车提交，不必先点走', () => {
    const { renderer, onCellCommit } = renderGrid()
    edit(inputFor(renderer, '渠道名：百度'), '百度新', 'enter')
    expect(onCellCommit).toHaveBeenCalledWith('b', 'name', '百度新')
  })

  it('Esc 撤回：不提交，且输入框回到原值', () => {
    const { renderer, onCellCommit } = renderGrid()
    const input = inputFor(renderer, '渠道名：广点通')
    act(() => {
      input.props.onFocus()
    })
    act(() => {
      input.props.onChange({ target: { value: '改了一半' } })
    })
    act(() => {
      input.props.onKeyDown({ key: 'Escape', preventDefault: vi.fn(), currentTarget: { blur: vi.fn() } })
    })
    expect(onCellCommit).not.toHaveBeenCalled()
    expect(inputFor(renderer, '渠道名：广点通').props.value).toBe('广点通')
  })

  it('数字列：合法值按数字类型提交（不是字符串）', () => {
    const { renderer, onCellCommit } = renderGrid()
    edit(inputFor(renderer, '宽：广点通'), '1281')
    expect(onCellCommit).toHaveBeenCalledWith('a', 'width', 1281)
  })

  it('数字列：非法输入不写库，错误留在单元格里', () => {
    const { renderer, onCellCommit } = renderGrid()
    edit(inputFor(renderer, '宽：广点通'), '一千')
    expect(onCellCommit).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('需要一个数字')
  })

  it('主键决定改哪一行：把行顺序反转后，第一行仍然是「百度」那一行', () => {
    const { renderer, onCellCommit } = renderGrid({ rows: [...baseRows].reverse() })
    const first = renderer.root.findAllByType('input')[0]!
    expect(String(first.props['aria-label'])).toContain('百度')
    edit(first, '百度改')
    expect(onCellCommit).toHaveBeenCalledWith('b', 'name', '百度改')
  })

  it('开关列点一下就是一个完整提交（不需要草稿）', () => {
    const { renderer, onCellCommit } = renderGrid()
    const switches = renderer.root
      .findAllByType(Checkbox)
      .filter((node) => String(node.props['aria-label'] ?? '').startsWith('启用'))
    act(() => {
      switches[0]!.props.onChange(false)
    })
    expect(onCellCommit).toHaveBeenCalledWith('a', 'enabled', false)
  })

  it('标签列按逗号切分，全角逗号也认', () => {
    const { renderer, onCellCommit } = renderGrid({
      columns: [{ key: 'dirs', header: '目录', editor: 'tags' }, ...baseColumns],
    })
    edit(inputFor(renderer, '目录：广点通'), 'D:/A, D:/B，D:/C')
    expect(onCellCommit).toHaveBeenCalledWith('a', 'dirs', ['D:/A', 'D:/B', 'D:/C'])
  })

  it('只读列不出现输入框', () => {
    const { renderer } = renderGrid({
      columns: [{ key: 'name', header: '渠道名', editor: 'readonly', render: (row) => `#${row.id}` }],
    })
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('#a')
  })

  it('校验失败拒绝提交，并把原因留在该单元格', () => {
    const { renderer, onCellCommit } = renderGrid({
      columns: [
        {
          key: 'name',
          header: '渠道名',
          editor: 'text',
          validate: (value) => (String(value).includes('纯净') ? '纯净版是保留渠道，不能改名' : null),
        },
      ],
    })
    edit(inputFor(renderer, '渠道名：广点通'), '纯净版')
    expect(onCellCommit).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('纯净版是保留渠道，不能改名')
  })

  it('空态给出可读的说明，而不是一张空表', () => {
    const { renderer } = renderGrid({ rows: [], emptyTitle: '媒体表为空', emptyDescription: '到「编辑规格」里加。' })
    expect(renderer.root.findAllByType(EmptyState)).toHaveLength(1)
    expect(JSON.stringify(renderer.toJSON())).toContain('媒体表为空')
  })

  it('批量选择：全选把当前行全部交出去', () => {
    const { renderer, onSelectedIdsChange } = renderGrid({ selectable: true, selectedIds: [] })
    const header = renderer.root
      .findAllByType(Checkbox)
      .find((node) => String(node.props['aria-label'] ?? '').includes('全选'))
    act(() => {
      header!.props.onChange(true)
    })
    expect(onSelectedIdsChange).toHaveBeenCalledWith(['a', 'b'])
  })

  it('showFieldKeys 打开时表头带字段键（导出对账用）', () => {
    const { renderer } = renderGrid({ showFieldKeys: true })
    expect(JSON.stringify(renderer.toJSON())).toContain('width')
  })

  it('parseTagList 丢掉空段与重复空白', () => {
    expect(parseTagList(' a , b ,, c ')).toEqual(['a', 'b', 'c'])
    expect(parseTagList('')).toEqual([])
  })
})
