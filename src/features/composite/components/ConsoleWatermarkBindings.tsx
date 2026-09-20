/**
 * 中控台 · 方向 × 水印归属表（TB-060，方案 §二 区域 ⑦）。
 *
 * ## 它回答的问题
 *
 * 「哪几个方向在用哪几套水印」原先只能靠左树节点上的覆盖计数徽章逐个点开看。
 * 中控台的水印卡片视图是**按方向工作**的（选中一个方向、勾选它用哪些预设），
 * 那是「改」的最优形态，但它给不出**总览**。这张表补的就是总览：
 * 一行一条归属，一屏看清「谁在用这套水印」与「这套水印被谁用」。
 *
 * 两张视图职责不重叠：卡片负责改、表负责看与批量删。这与 `ConsoleMediaTables`
 * 里「看板并入表格」的情形不同 —— 那里两条视图表达的是同一件事，这里是两个不同的问题。
 *
 * ## 三条口径
 *
 * 1. **只列显式声明过的归属**。没人写过的方向沿用全局默认（`watermarkPresetIds`），
 *    它不出现在表里 —— 否则「全局清单」会让每个方向都长出一行，表格立刻失去信息量。
 *    全局清单在表下单独写明，用户一眼能看到「没列出来的方向用的是什么」。
 * 2. **行主键 = `collectionId:presetId`**（方案里定的复合主键）。单用 presetId 不够：
 *    同一套水印会被多个方向用，那是多行。
 * 3. **两种删除语义要分开**，这是 `resolveNodeWatermarkBinding` 里刻意的区分：
 *    - 「移除」= 写入不含该预设的数组，**空数组 = 显式不加水印**；
 *    - 「继承」= 写入 `undefined`（不表态），沿继承链回到上层或全局。
 *    两者在界面上只差一个字，语义完全不同，所以必须给两个按钮而不是一个。
 *
 * ## 刻意不做的事
 *
 * 渠道级水印（`byMedia[*].watermarkPresetIds`）**不在这张表里**。它是「同一个方向在不同渠道
 * 用不同水印」的高级用法，行粒度是 `(方向, 渠道, 预设)` 三元组，与这里的两元组混在一张表里
 * 会让「移除」按钮的语义说不清（删的是哪个维度的）。它归「输出位置」分区。
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  DataGrid,
  IconButton,
  SectionHeader,
  SelectField,
  type DataGridColumn,
} from '../../../design-system'
import { TrashIcon } from '../../../design-system/icons'
import { useStore } from '../../../store'
import { usePostprocessMediaStore } from '../../../storePostprocessMedia'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { useProjectTreeParamsStore } from '../../projectTree/storeProjectTreeParams'
import { useCompositeV2Store } from '../storeV2'
import { resolveCollectionPath } from '../../../lib/postprocessProjectTree'

interface BindingRow {
  /** 复合主键：`collectionId:presetId` */
  id: string
  collectionId: string
  presetId: string
  directionPath: string
  presetName: string
  /** 预设是否已不在库里（被删掉的悬空引用）——不隐藏它，否则用户永远不知道要清理 */
  presetMissing: boolean
}

export function ConsoleWatermarkBindings() {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const setPostprocessOverride = useProjectTreeParamsStore((state) => state.setPostprocessOverride)
  const presets = useCompositeV2Store((state) => state.presets)
  const globalPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const showToast = useStore((state) => state.showToast)

  const [newDirectionId, setNewDirectionId] = useState('')
  const [newPresetId, setNewPresetId] = useState('')

  const presetNames = useMemo(() => Object.fromEntries(presets.map((preset) => [preset.id, preset.name])), [presets])

  const rows = useMemo<BindingRow[]>(() => {
    const result: BindingRow[] = []
    for (const [collectionId, entry] of Object.entries(params)) {
      const declared = entry?.postprocess?.watermarkPresetIds
      if (!declared || declared.length === 0) continue
      const path = resolveCollectionPath(collections, collectionId)
        .map((item) => item.name)
        .join(' / ')
      for (const presetId of declared) {
        result.push({
          id: `${collectionId}:${presetId}`,
          collectionId,
          presetId,
          directionPath: path || collectionId,
          presetName: presetNames[presetId] ?? presetId,
          presetMissing: presetNames[presetId] === undefined,
        })
      }
    }
    // 行序按方向路径排序：与左树、与「方向结构表」的阅读顺序一致
    return result.sort(
      (a, b) => a.directionPath.localeCompare(b.directionPath) || a.presetName.localeCompare(b.presetName),
    )
  }, [params, collections, presetNames])

  const directionOptions = useMemo(
    () =>
      collections.map((item) => ({
        value: item.id,
        label: resolveCollectionPath(collections, item.id)
          .map((entry) => entry.name)
          .join(' / '),
      })),
    [collections],
  )

  const presetOptions = useMemo(() => presets.map((preset) => ({ value: preset.id, label: preset.name })), [presets])

  const currentIds = useCallback(
    (collectionId: string) => params[collectionId]?.postprocess?.watermarkPresetIds ?? [],
    [params],
  )

  const removeBinding = useCallback(
    (row: BindingRow) => {
      const next = currentIds(row.collectionId).filter((id) => id !== row.presetId)
      // 空数组 = 显式「这个方向不加水印」，不是「恢复继承」（见头注第 3 条）
      setPostprocessOverride(row.collectionId, { watermarkPresetIds: next })
    },
    [currentIds, setPostprocessOverride],
  )

  const revertToInherit = useCallback(
    (row: BindingRow) => {
      setPostprocessOverride(row.collectionId, { watermarkPresetIds: undefined })
    },
    [setPostprocessOverride],
  )

  const addBinding = () => {
    if (!newDirectionId || !newPresetId) {
      showToast('先选方向与预设', 'error')
      return
    }
    const current = currentIds(newDirectionId)
    if (current.includes(newPresetId)) {
      showToast('这个方向已经绑了这套水印', 'error')
      return
    }
    setPostprocessOverride(newDirectionId, { watermarkPresetIds: [...current, newPresetId] })
    setNewPresetId('')
  }

  const columns = useMemo<Array<DataGridColumn<BindingRow>>>(
    () => [
      {
        key: 'directionPath',
        header: '方向',
        help: '产品线 / 产品 / 方向 的完整路径。',
        editor: 'readonly',
        width: 280,
      },
      {
        key: 'presetName',
        header: '水印预设',
        help: '这个方向显式声明在用的水印。标了「已删除」的是悬空引用，建议清掉。',
        editor: 'readonly',
        width: 240,
        render: (row) => (row.presetMissing ? `${row.presetName}（已删除）` : row.presetName),
      },
      {
        key: 'directionCount',
        header: '被几个方向使用',
        help: '同一套水印被几个方向显式声明在用。',
        editor: 'readonly',
        width: 128,
        align: 'end',
        getValue: (row) => rows.filter((item) => item.presetId === row.presetId).length,
      },
      {
        key: 'actions',
        header: '',
        editor: 'readonly',
        width: 148,
        render: (row) => (
          <span className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => revertToInherit(row)}>
              改为继承
            </Button>
            <IconButton
              size="sm"
              aria-label={`从 ${row.directionPath} 移除 ${row.presetName}`}
              icon={<TrashIcon className="h-3.5 w-3.5" />}
              onClick={() => removeBinding(row)}
            />
          </span>
        ),
      },
    ],
    [removeBinding, revertToInherit, rows],
  )

  /** 全局默认清单：没在表里出现的所有方向都走它 */
  const globalNames = globalPresetIds.map((id) => presetNames[id] ?? id)

  return (
    <section className="space-y-3">
      <SectionHeader
        title="水印归属"
        description="一行一条「方向 → 水印」的显式声明。「移除」= 这个方向不加水印，「改为继承」= 交还给上层或全局。"
      />

      {rows.length === 0 && (
        <Alert tone="info">
          还没有任何方向显式声明水印，所有方向都用全局默认（{globalNames.length > 0 ? globalNames.join('、') : '无水印'}
          ）。 用户版的「水印」分区里选中方向后可直接勾选。
        </Alert>
      )}

      <DataGrid
        aria-label="水印归属表"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        // 归属只有「有 / 没有」，单元格本身不可编辑：改动一律走右侧的两个按钮，
        // 因为它们对应两种不同的写入语义（空数组 vs undefined），一个开关表达不了
        onCellCommit={() => undefined}
        emptyTitle="还没有显式的水印归属"
        emptyDescription="用下面的下拉给某个方向绑定第一套水印。"
      />

      <div className="flex items-end gap-2">
        <SelectField
          label=""
          aria-label="要绑定的方向"
          containerClassName="w-64"
          value={newDirectionId || collections[0]?.id || ''}
          options={directionOptions}
          onChange={(event) => setNewDirectionId(event.target.value)}
        />
        <SelectField
          label=""
          aria-label="要绑定的水印预设"
          containerClassName="w-48"
          value={newPresetId || presets[0]?.id || ''}
          options={presetOptions}
          onChange={(event) => setNewPresetId(event.target.value)}
        />
        <Button variant="secondary" disabled={collections.length === 0 || presets.length === 0} onClick={addBinding}>
          绑定水印
        </Button>
        <span className="text-xs text-ds-muted dark:text-ds-muted">
          没出现在表里的方向 → 全局默认（{globalNames.length > 0 ? globalNames.join('、') : '无水印'}）
        </span>
      </div>
    </section>
  )
}

export default ConsoleWatermarkBindings
