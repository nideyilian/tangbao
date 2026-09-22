/**
 * 后处理设置面板（输入栏「后处理」按钮打开）。
 *
 * ## 它是什么
 *
 * **「当前方向的后处理参数」** —— 打开就落在你正在看的方向上，改完即可。
 * 参数只有一份定义（`features/postprocess/paramSchema.ts`），面板按作用域取字段渲染，
 * 两侧都不再各自维护一份参数列表。
 *
 * ## 作用范围从哪来（2026-09-20 定）
 *
 * 不做「本弹窗自己的选择态」，而是跟随项目里**唯一的上下文指针**
 * `useAssetLibraryStore.scope` —— 中控台 / 素材库 / SOP 读的都是它，
 * 所以「在任何地方打开都默认停在当前方向」自然成立，不需要各工作区各存一份再互相同步
 * （见 `design-system/tangbao/pages/postprocess.md`）。
 * 在这里换方向用 `setCollectionContextScope` 写回同一个指针，**不碰素材库的选中态**
 * （`setScope` 会清空用户选中的图，那是「素材库内部切换范围」的语义）。
 *
 * **没有「全局默认」这个选项**：全局基线（渠道与尺寸、画面方向、命名模板、创作者、分发、
 * 产出预览）在中控台各自的分区有唯一入口。同一个参数给两个入口，迟早出现
 * 「在 A 改了、在 B 显示不一致」。所以本弹窗不显示全局、也不提供选全局。
 * 指针没有指向任何节点时给引导态让用户选方向，**不回落全局**。
 *
 * ## 其他
 *
 * - **启用范围（哪些项目参与自动后处理）不在这个弹窗里配置** —— 入口在项目树工作区的
 *   「后处理」列。这里只在节点不在启用范围内时给一句警告。
 * - 外壳交给设计系统的 `Dialog`：遮罩、ESC、焦点陷阱、滚动锁与焦点回归都由它统一接管
 *   （走 `overlayManager` 的 overlay 栈，多层弹窗时只响应最上层）。
 */

import { useMemo } from 'react'
import { Alert, Button, Dialog, DialogPane, DialogWorkspace, EmptyState, SelectField, Stack } from '../design-system'
import { useAssetLibraryStore } from '../features/assetLibrary/store'
import PostprocessParamPanel from '../features/postprocess/PostprocessParamPanel'
import { usePostprocessGlobalConfig } from '../features/postprocess/usePostprocessGlobalConfig'
import { useJumpToControlConsole } from '../features/composite/lib/useJumpToControlConsole'
import { useProjectTreeParamsStore } from '../features/projectTree/storeProjectTreeParams'
import {
  resolveNodeWatermarkBinding,
  resolveProjectNodeKind,
  resolveProjectNodePathNames,
} from '../features/projectTree/params'
import { PROJECT_NODE_KIND_LABELS } from '../features/projectTree/types'
import {
  buildPostprocessProjectTree,
  findMissingProjectCollectionIds,
  flattenPostprocessProjectTree,
  resolvePostprocessProjectTargets,
} from '../lib/postprocessProjectTree'
import { selectPostprocessOutputPlan, type PostprocessOutputSource } from '../storePostprocessMedia'

interface Props {
  /** 当前生成尺寸（如 `1024x1024`）；`auto` 或空表示无法预估，产出数按示例尺寸估算 */
  sourceSize: string
  onClose: () => void
}

/** 方向不可预知时用于估算产出数的示例尺寸，仅用于展示，不参与落盘。 */
const FALLBACK_PREVIEW_SIZE: PostprocessOutputSource = { width: 1024, height: 1024 }

function parseSourceSize(size: string): PostprocessOutputSource | null {
  const match = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(size ?? '')
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

/** 引导态：指针没指向任何方向时，让用户在这里选一个，而不是显示一份全局参数。 */
function PickDirectionHint({ hasDirections }: { hasDirections: boolean }) {
  return (
    <EmptyState
      title="还没有选中方向"
      description={
        hasDirections
          ? '后处理参数按方向配置。在上面的「作用范围」里选一个方向，或到素材库 / 项目树里点一个方向 —— 三处读的是同一个「当前方向」。'
          : '项目树里还没有方向。先到项目树工作区建「产品线 → 产品 → 方向」，再回来配参数。'
      }
    />
  )
}

export default function PostprocessSettingsModal({ sourceSize, onClose }: Props) {
  /**
   * 全局基线（单份组装，与中控台的产出预览共用同一个 hook）。
   *
   * 它在这个弹窗里只承担两件事：**作为继承来源**被面板解析（`resolveProjectPostprocessSlice`），
   * 以及算当前方向的产出数。全局本身的编辑入口在中控台。
   */
  const globalConfig = usePostprocessGlobalConfig()
  const selectedCollectionIds = globalConfig.selectedCollectionIds
  const watermarkPresetIds = globalConfig.watermarkPresetIds

  const collections = useAssetLibraryStore((state) => state.collections)
  const libraryScope = useAssetLibraryStore((state) => state.scope)
  const setCollectionContextScope = useAssetLibraryStore((state) => state.setCollectionContextScope)
  const params = useProjectTreeParamsStore((state) => state.params)
  const jumpToConsole = useJumpToControlConsole()

  /**
   * 当前方向 = 全局上下文指针解析出来的节点；指针不指向节点（「全部」）时为 `null`。
   *
   * 只认真实存在的 collection：指针可能在另一个窗口删了这个节点之后还留着旧 id，
   * 那种情况按「没选方向」处理，而不是崩掉或显示已删除节点。
   */
  const selectedNodeId = useMemo(() => {
    if (typeof libraryScope !== 'object' || libraryScope.kind !== 'collection') return null
    return collections.some((item) => item.id === libraryScope.id) ? libraryScope.id : null
  }, [libraryScope, collections])

  /** 项目树：作用范围下拉的选项来源，与中控台的资产树读同一份 collections。 */
  const projectTree = useMemo(() => buildPostprocessProjectTree(collections), [collections])
  const flatNodes = useMemo(() => flattenPostprocessProjectTree(projectTree), [projectTree])

  const missingProjectIds = useMemo(
    () => findMissingProjectCollectionIds(collections, selectedCollectionIds),
    [collections, selectedCollectionIds],
  )

  /**
   * 产出数：**只算当前方向**。
   *
   * 这一屏是「确认这个方向怎么产出」，算全量启用范围的产出数没有意义 ——
   * 那是中控台「产出预览」的职责（按作用域展开文件名）。
   */
  const previewSource = parseSourceSize(sourceSize) ?? FALLBACK_PREVIEW_SIZE
  const unitCount = useMemo(() => {
    if (!selectedNodeId) return null
    const targets = resolvePostprocessProjectTargets(collections, [selectedNodeId]).map((target) => ({
      ...target,
      watermarkPresetIds: resolveNodeWatermarkBinding(collections, params, target.collectionId, watermarkPresetIds)
        .presetIds,
    }))
    if (targets.length === 0) return 0
    return selectPostprocessOutputPlan(globalConfig, previewSource, targets, {}).units.length
  }, [selectedNodeId, collections, params, watermarkPresetIds, globalConfig, previewSource])

  /**
   * 状态行（MASTER §5.9 的 Status 层）：这个方向到底会不会产出、产出几个文件。
   *
   * 只在参数面板之后出现**一次** —— 原先 footer 与面板各写一句同样的文案，是同一句说明出现两遍。
   */
  const statusLine = (() => {
    if (!selectedNodeId) return ''
    // 短句：这里只报状态，不写「怎么修」——「怎么修」是上面那条 Alert 的按钮。
    if (selectedCollectionIds.length === 0) return '未启用后处理。'
    if (unitCount === 0) return '产不出变体：检查中控台的渠道与尺寸。'
    return `每张原图产出 ${unitCount} 个文件。`
  })()

  /**
   * 作用范围下拉的选项：项目树上的每一层节点，**不含全局默认**。
   *
   * 标签写成「层级：路径」而不是靠缩进 —— 下拉里没有缩进可依，
   * 只有路径（产品线 / 产品 / 方向）才能在几十个同名节点间消歧。
   */
  const scopeOptions = useMemo(
    () => [
      // 空值项是「尚未选方向」的占位：`SelectField` 会把 `placeholder` 透传到原生 select
      // （无效属性），所以用一条禁用的空选项承担占位，而不是靠 placeholder prop。
      { value: '', label: '请选择方向', disabled: true },
      ...flatNodes.map((node) => {
        const names = resolveProjectNodePathNames(collections, node.id)
        const path = [names.line, names.product, names.direction].filter(Boolean).join(' / ')
        const kind = PROJECT_NODE_KIND_LABELS[resolveProjectNodeKind(node.depth)]
        return { value: node.id, label: `${kind}：${path || node.name}` }
      }),
    ],
    [flatNodes, collections],
  )

  const directionCount = flatNodes.filter((node) => node.depth >= 2).length

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="后处理"
      // 两句短句：继承规则 + 全局去哪改。规范要求「说明要能被读懂」，但不等于写得长。
      description="留空的字段向上继承。全局设置在中控台。"
      className="ds-dialog--postprocess"
      footer={
        // footer 只放动作（状态已经在参数区末尾说过一次）；`mr-auto` 让「去中控台」靠左、
        // 完成靠右 —— `.ds-dialog__footer` 是右对齐的 flex（见 styles.css）。
        <>
          <Button
            variant="secondary"
            className="mr-auto"
            title="渠道与输出分区管渠道名 / 尺寸 / 参与产出 / 导出位置；画面方向、命名模板、创作者、分发、产出预览也在中控台配置"
            onClick={() => jumpToConsole('channel')}
          >
            去中控台改全局规格
          </Button>
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      <DialogWorkspace className="min-h-0 flex-1">
        <DialogPane tone="content" scroll={false} className="flex min-h-0 flex-col">
          {/* 竖直间距走设计系统的 Stack（20px = --ds-space-5，MASTER 4.4「组间 20–32px」） */}
          <Stack gap={5} className="min-h-0 flex-1">
            <Stack gap={2} className="shrink-0">
              <SelectField
                label="作用范围"
                options={scopeOptions}
                value={selectedNodeId ?? ''}
                onChange={(event) => setCollectionContextScope(event.target.value || null)}
              />
              {missingProjectIds.length > 0 && (
                <Alert tone="warning">有 {missingProjectIds.length} 个已启用的节点不存在或已删除，将被跳过。</Alert>
              )}
            </Stack>

            {/*
             * 参数区：唯一编辑面，字段与分组全部来自 paramSchema。
             *
             * 「作用范围」固定在滚动区之外（用户随时能确认/切换在改哪个方向），
             * 所以这里给一条 1px 上边界把固定区与滚动区分开 —— 否则滚动时内容会直接
             * 贴着下拉框，看不出哪部分是「不会动的」。
             */}
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-ds-border pt-5 pr-1">
              {selectedNodeId ? (
                <Stack gap={6}>
                  <PostprocessParamPanel
                    selectedNodeId={selectedNodeId}
                    globalConfig={globalConfig}
                    enabledScopeIds={selectedCollectionIds}
                    // 「去项目树启用」要离开这里：不关的话弹窗会叠在刚打开的项目树工作台上
                    onRequestClose={onClose}
                  />
                  {/* 状态（MASTER §5.9 里的 Status 层）：只在面板之后出现一次，footer 不重复 */}
                  <p className="text-xs text-ds-muted">{statusLine}</p>
                </Stack>
              ) : (
                <PickDirectionHint hasDirections={directionCount > 0} />
              )}
            </div>
          </Stack>
        </DialogPane>
      </DialogWorkspace>
    </Dialog>
  )
}
