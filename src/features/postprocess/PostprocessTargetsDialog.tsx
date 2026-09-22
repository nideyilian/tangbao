/**
 * 产出目标：一批素材要产出到哪些方向（「记住配置」的落点）。
 *
 * **为什么需要它**：归属（素材 `collectionIds` 里最深那条）只能表达「这张图属于哪个方向」，
 * 而一批素材经常要同时投到多个产品 / 多个方向。靠「把素材挂到多个方向」绕不过去 ——
 * 同级挂两个只有一个生效（归属取最深那条），而且挂载会改写素材的真实归属，越挂越乱。
 *
 * **与「项目树后处理列」的分工（别混）**：
 * - 树上的勾选 = **启用范围**（哪些方向允许跑），长期开关；
 * - 这里选的 = **产出目标**（这次产出到哪些），点「记住配置」后长期复用，直到再改。
 * 两者独立：目标里若有一个方向已被取消启用，跑的时候会跳过它并说明是哪个方向（`PP-SCOPE-001`）。
 *
 * **只列启用范围内的叶子节点**：没启用的方向选了也不会产出，列出来只会多一个
 * 「勾了却不产出」的隐形陷阱，所以从源头不提供。叶子才可选是因为命名段
 * `{direction}` 取的是路径末段 —— 勾一个带子节点的中间层，产出目标里的方向段是空的，
 * 用户在界面上推不出这个结果。
 */

import { useMemo, useState } from 'react'
import { Button, Checkbox, Dialog, EmptyState, InfoIcon } from '../../design-system'
import {
  buildPostprocessProjectTree,
  isCollectionWithinSelection,
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

interface TargetOption {
  id: string
  /** 完整路径（`产品线 / 产品 / 方向`）——只给方向名会认不出是哪条产品线下的 */
  label: string
}

/** 收集可选目标：递归下探，只收**叶子**且落在启用范围内的那些。 */
function collectOptions(
  nodes: PostprocessProjectTreeNode[],
  collections: Parameters<typeof isCollectionWithinSelection>[0],
  enabledIds: string[],
  prefix: string[] = [],
): TargetOption[] {
  const result: TargetOption[] = []
  for (const node of nodes) {
    const path = [...prefix, node.name]
    if (node.children.length > 0) {
      result.push(...collectOptions(node.children, collections, enabledIds, path))
      continue
    }
    if (isCollectionWithinSelection(collections, node.id, enabledIds)) {
      result.push({ id: node.id, label: path.join(' / ') })
    }
  }
  return result
}

interface Props {
  onClose: () => void
  /** 当前选中的素材数，用来把「每张图几个」换算成「这次一共几个」 */
  assetCount?: number
}

export default function PostprocessTargetsDialog({ onClose, assetCount }: Props) {
  const collections = useAssetLibraryStore((state) => state.collections)
  const params = useProjectTreeParamsStore((state) => state.params)
  const enabledIds = usePostprocessMediaStore((state) => state.selectedCollectionIds)
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

  const options = useMemo(
    () => collectOptions(buildPostprocessProjectTree(collections), collections, enabledIds),
    [collections, enabledIds],
  )

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

  const toggle = (id: string) =>
    setDraft((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

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

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      size="md"
      title="产出目标"
      description="这批素材要产出到哪些方向。点「记住配置」后，之后每次跑后处理都按这份清单产出，直到你改了它。"
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
        {options.length === 0 ? (
          <EmptyState
            icon={<InfoIcon size={20} />}
            title="还没有可选的方向"
            description="后处理只对「已经在项目树里启用的方向」生效。先到项目树的「后处理」列勾选要参与的方向，再回来选产出目标。"
          />
        ) : (
          <>
            <div className="max-h-[45vh] overflow-y-auto rounded-ds-lg border border-ds-border">
              {options.map((option) => (
                <div key={option.id} className="border-b border-ds-border px-3 py-2 last:border-b-0">
                  <Checkbox
                    checked={draft.includes(option.id)}
                    onChange={() => toggle(option.id)}
                    label={option.label}
                  />
                </div>
              ))}
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
