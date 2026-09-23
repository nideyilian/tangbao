/**
 * 产出目标：一批素材要产出到哪些方向（「记住配置」的落点）。
 *
 * **为什么需要它**：归属（素材 `collectionIds` 里最深那条）只能表达「这张图属于哪个方向」，
 * 而一批素材经常要同时投到多个产品 / 多个方向。靠「把素材挂到多个方向」绕不过去 ——
 * 同级挂两个只有一个生效（归属取最深那条），而且挂载会改写素材的真实归属，越挂越乱。
 *
 * **与「项目树后处理列」的分工（别混）**：
 * - 树上的勾选 = **启用范围**（哪些方向参与*自动*后处理），长期开关；
 * - 这里选的 = **产出目标**（手动跑这一次产出到哪些），点「记住配置」后长期复用，直到再改。
 *
 * 两者独立，且**这里可以选到启用范围之外的方向**：启用范围管的是自动后处理，手动跑那一次由
 * 用户直接决定（见 `taskPostprocess.ts` 里 `source === 'manual'` 的分流）。这类叶子在界面上标一个
 * 「未启用」提醒，但不拦着选 —— 卡住他反而没法干活（2026-09-22 杰哥：「我需要跨产品」）。
 *
 * **为什么是树而不是一层平铺清单**：产出目标天生是「跨产品线挑几个方向」，平铺成一长条既看不出
 * 层级、也没法一次勾掉一整个产品。改成可展开的树之后，勾中间层 = 其下所有方向一起勾。
 * 但**落盘的仍然只有叶子**：命名段 `{direction}` 取的是路径末段 —— 勾一个带子节点的中间层，
 * 产出目标里的方向段会是空的，用户在界面上推不出这个结果。
 */

import { useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  ChevronDownIcon,
  ChevronRightIcon,
  Dialog,
  EmptyState,
  IconButton,
  InfoIcon,
} from '../../design-system'
import {
  buildPostprocessProjectTree,
  resolvePostprocessProjectTargets,
  type PostprocessProjectTreeNode,
} from '../../lib/postprocessProjectTree'
import { selectPostprocessOutputPlan, usePostprocessMediaStore } from '../../storePostprocessMedia'
import { useStore } from '../../store'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useCompositeV2Store } from '../composite/storeV2'
import { resolveProjectPostprocessSlice } from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { usePostprocessGlobalConfig } from './usePostprocessGlobalConfig'

/**
 * 估算用的示例源图尺寸。
 *
 * 与中控台的产出预览同一个口径：这里不对应任何一次真实生成，只能给一个有代表性的比例。
 * 「跟随尺寸」时实际产出多少条由图片自身比例决定，所以数字是**约数**，界面上写明这一点。
 */
const SAMPLE_SOURCE = { width: 1280, height: 720 }

/** 每一层缩进的像素数。 */
const INDENT_PER_DEPTH = 18

interface Props {
  onClose: () => void
  /** 当前选中的素材数，用来把「每张图几个」换算成「这次一共几个」 */
  assetCount?: number
}

export default function PostprocessTargetsDialog({ onClose, assetCount }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const savedTargets = usePostprocessMediaStore((state) => state.savedTargetCollectionIds)
  const setSavedTargetCollectionIds = usePostprocessMediaStore((state) => state.setSavedTargetCollectionIds)
  const clearSavedTargetCollectionIds = usePostprocessMediaStore((state) => state.clearSavedTargetCollectionIds)
  const presets = useCompositeV2Store((state) => state.presets)
  const globalConfig = usePostprocessGlobalConfig()
  const showToast = useStore((state) => state.showToast)

  /**
   * 草稿。**不能直接编辑 store**：那样「取消」就没有意义了（点一下勾选就已经落盘）。
   * 组件由调用方条件挂载（`{open && <PostprocessTargetsDialog …/>}`），所以这里的初始值
   * 天然就是「打开那一刻的已记住值」，不需要再靠 effect 同步一次。
   */
  const [draft, setDraft] = useState<string[]>(savedTargets)

  /**
   * 折叠的节点 id。**默认全展开**：产出目标就是来跨产品挑方向的，一进来全收着反而要一层层点开
   * 才看得见有哪些可选；列表本身有滚动条兜底。折叠是纯界面态，不进 store、不落盘。
   */
  const [collapsed, setCollapsed] = useState<string[]>([])

  const tree = useMemo(() => buildPostprocessProjectTree(collections), [collections])

  /**
   * 每个节点「勾它等于勾中哪些叶子」。**预计算一次**：渲染时每个节点都要问一次，
   * 放在渲染里递归会让每次勾选都重算整棵树。
   */
  const leafIdsByNode = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (nodes: PostprocessProjectTreeNode[]): string[] => {
      for (const node of nodes) {
        // 无子节点 = 叶子，它就是自己；有子节点则先递归到底，再把结果收上来
        map.set(node.id, node.children.length > 0 ? walk(node.children) : [node.id])
      }
      return nodes.flatMap((node) => map.get(node.id) ?? [])
    }
    walk(tree)
    return map
  }, [tree])

  /** 整棵树里一个方向都没有（用户还没建过项目树）—— 这与「方向存在但没启用」是两件事。 */
  const hasAnyDirection = leafIdsByNode.size > 0

  const presetNames = useMemo(() => Object.fromEntries(presets.map((preset) => [preset.id, preset.name])), [presets])

  /**
   * 每张源图会产出几个文件。**逐目标各算一次**：每个方向的渠道勾选与水印预设都不同，
   * 拿一份配置乘以目标数会得到一个跟实际对不上的数字（用户拿它去核磁盘空间会被误导）。
   */
  const filesPerImage = useMemo(() => {
    const targets = resolvePostprocessProjectTargets(collections, draft)
    let total = 0
    for (const target of targets) {
      const slice = resolveProjectPostprocessSlice(collections, params, target.collectionId, globalConfig)
      total += selectPostprocessOutputPlan(slice.config, SAMPLE_SOURCE, [target], presetNames).units.length
    }
    return total
  }, [collections, params, draft, globalConfig, presetNames])

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  /** 勾中间节点 = 其下所有方向一起勾；已经全勾上时再点就是一起取消。 */
  const toggleLeaves = (ids: string[]) => {
    const allChecked = ids.length > 0 && ids.every((id) => draft.includes(id))
    setDraft((current) => (allChecked ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]))
  }

  const handleSave = () => {
    setSavedTargetCollectionIds(draft)
    showToast(
      draft.length > 0 ? `已记住产出目标：${draft.length} 个方向` : '产出目标已清空：回到按图片归属方向产出',
      'success',
    )
    onClose()
  }

  const handleReset = () => {
    clearSavedTargetCollectionIds()
    showToast('产出目标已清空：回到按图片归属方向产出', 'success')
    onClose()
  }

  const renderNodes = (nodes: PostprocessProjectTreeNode[], depth: number) =>
    nodes.map((node) => {
      const leafIds = leafIdsByNode.get(node.id) ?? []
      const checkedCount = leafIds.filter((id) => draft.includes(id)).length
      const hasChildren = node.children.length > 0
      const isOpen = !collapsed.includes(node.id)

      return (
        <div key={node.id}>
          <div
            className="flex items-center gap-1.5 border-b border-ds-border py-1.5 pr-3"
            style={{ paddingLeft: depth * INDENT_PER_DEPTH + 8 }}
          >
            {hasChildren ? (
              <IconButton
                size="sm"
                aria-label={isOpen ? `收起「${node.name}」` : `展开「${node.name}」`}
                icon={isOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                onClick={() => toggleCollapsed(node.id)}
              />
            ) : (
              // 与展开箭头等宽的空位，让同层的复选框左边缘对齐
              <span className="w-6 shrink-0" aria-hidden="true" />
            )}
            <Checkbox
              checked={leafIds.length > 0 && checkedCount === leafIds.length}
              indeterminate={checkedCount > 0 && checkedCount < leafIds.length}
              onChange={() => toggleLeaves(leafIds)}
              label={node.name}
            />
            {/* 收起时看不到子级，用计数告诉用户「这条分支里已经挑了 N 个」 */}
            {hasChildren && checkedCount > 0 ? (
              <span className="shrink-0 text-xs text-ds-muted">已选 {checkedCount}</span>
            ) : null}
          </div>
          {hasChildren && isOpen ? renderNodes(node.children, depth + 1) : null}
        </div>
      )
    })

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      size="md"
      title="产出目标"
      description="这批素材手动跑后处理时要产出到哪些方向，跨产品线和产品都能选。点「记住配置」后，之后每次手动跑都按这份清单产出，直到你改了它。自动后处理不受这里影响，仍按图片归属的方向产出。"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {savedTargets.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={handleReset} data-testid="postprocess-targets-reset">
              恢复按归属
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSave} data-testid="postprocess-targets-save">
              记住配置
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {!hasAnyDirection ? (
          <EmptyState
            icon={<InfoIcon size={20} />}
            title="项目树里还没有方向"
            description="产出目标取自项目树。先到项目树建好「产品线 / 产品 / 方向」，再回来选。"
          />
        ) : (
          <>
            <div className="max-h-[45vh] overflow-y-auto rounded-ds-lg border border-ds-border">
              {renderNodes(tree, 0)}
            </div>
            <p className="text-xs text-ds-muted">
              已选 {draft.length} 个方向 · 每张图约 {filesPerImage} 个文件
              {assetCount ? `，这次选中的 ${assetCount} 张共约 ${filesPerImage * assetCount} 个` : ''}
              。按 {SAMPLE_SOURCE.width}×{SAMPLE_SOURCE.height} 源图估算，实际条数随图片比例变化。
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}
