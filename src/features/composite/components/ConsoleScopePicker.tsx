/**
 * 中控台 · 作用域选择器。
 *
 * 解决的问题：中控台的每个分区都要能控制**全局基线**与**任意节点覆盖**两层参数，
 * 但两层共用一个界面就会出现「这个开关现在改的是哪一层」的歧义。
 * 于是把「改哪一层」显式化：下拉选「全局默认」或某个产品线 / 产品 / 方向，
 * 选中后分区内所有控件都作用于该作用域。
 *
 * 这是**入口收敛**，不是第二入口：按 `docs/postprocess-unify-on-hanling-plan.md:321`
 * 的口径，节点级参数的唯一编辑入口就是中控台；树与弹窗不再各持一套编辑 UI。
 *
 * 作用域切换不会丢未保存的改动 —— 所有控件都是「改即写」，
 * 切换只是换了一个读写地址，不需要额外确认。
 */

import { useMemo } from 'react'
import { SelectField } from '../../../design-system'
import { useAssetLibraryStore } from '../../assetLibrary/store'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'
import { buildPostprocessProjectTree, flattenPostprocessProjectTree } from '../../../lib/postprocessProjectTree'

/** 作用域：`GLOBAL_NODE_ID` = 全局基线；其余为 `AssetCollection.id` */
export type ConsoleScope = string

interface Props {
  /** 当前作用域。`GLOBAL_NODE_ID` = 全局默认 */
  value: ConsoleScope
  onValueChange: (value: ConsoleScope) => void
  /** 分区名，用于无障碍标签（「输出位置 · 作用域」） */
  label: string
  /** 是否允许选具体节点。false 时退化为纯全局分区（如尚无节点级能力的参数） */
  allowNodeScope?: boolean
}

/**
 * 层级的视觉前缀。节点选择器里带上缩进符号，用户一眼能看出
 * 「这是产品线还是它下面的方向」，而不必去记树结构。
 */
const DEPTH_PREFIX = ['', '· ', '·· ', '··· '] as const

export function ConsoleScopePicker({ value, onValueChange, label, allowNodeScope = true }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)

  const options = useMemo(() => {
    const list = [{ value: GLOBAL_NODE_ID, label: '全局默认（所有未覆盖的节点）' }]
    if (!allowNodeScope) return list
    const tree = buildPostprocessProjectTree(collections)
    for (const node of flattenPostprocessProjectTree(tree)) {
      // 第 4 层及更深用满前缀，避免深层节点的标签被缩进推到看不见
      const level = Math.min(node.depth, 3)
      list.push({
        value: node.id,
        label: `${'  '.repeat(level)}${DEPTH_PREFIX[level]}${node.name}`,
      })
    }
    return list
  }, [collections, allowNodeScope])

  // 节点被删掉后，旧作用域会指向不存在的 id —— 静默退回全局，不留悬空状态
  const selected = options.some((item) => item.value === value) ? value : GLOBAL_NODE_ID

  return (
    <SelectField
      label="作用域"
      aria-label={`${label}作用域`}
      value={selected}
      options={options}
      onChange={(event) => onValueChange(event.target.value)}
      containerClassName="max-w-md"
    />
  )
}

/** 当前作用域是否为全局基线。所有分区都用同一条判定，避免各处各写一遍哨兵比较。 */
export function isGlobalScope(scope: ConsoleScope): boolean {
  return scope === GLOBAL_NODE_ID
}
