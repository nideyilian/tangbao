/**
 * 「解析结果」弹窗：把配方卡解析器**读到的东西**完整摊开给用户看。
 *
 * 为什么需要它：解析完成后，界面上只有一句提示（「已识别 N 个维度、组合空间 M 条」），
 * 而解析器其实还读到了一批**别处看不到**的信息 —— 原资产声明的名称 / 说明 / 主控槽、
 * 带 `en` 英文描述的候选值、模板用了但池里没有的占位符、原资产元信息（模型 / 禁用词）、
 * 以及若干非致命告警。识别错了（或漏了）时，用户没有地方核对，只能凭感觉。
 *
 * 三条口径：
 * - **只读**。弹窗不提供任何编辑：编辑入口在面板表单上，弹窗再放一套必然出现
 *   「弹窗里改了、表单没同步」。所以这里只呈现，连「应用」按钮都没有；
 * - **成功失败都开**。解析失败时也能打开（展示失败原因 + 原文摘要），
 *   否则用户点了入口只看到一个灰按钮，反而更困惑；
 * - **摘要列的是「解析结果自己」的数**，不是当前表单的：两者会在用户改过表单后分叉，
 *   混淆就会得出「解析器读错了」的错误结论。标题下方明确标注这是哪一次解析的结果。
 *
 * 关闭交互（四处，都是既有约定，不新造）：右上 X、底部「关闭」、Esc、点遮罩。
 * 关闭**不清空**解析结果，再点入口内容还在。
 */

import { Badge, Button, Dialog } from '../../design-system'
import { AlertTriangleIcon, FileTextIcon, SparklesIcon } from '../../design-system/icons'
import type { ParsedCampaignRecipe, ParsedCampaignRecipeDimension } from './campaignRecipeImport'

export interface SopCampaignRecipeParseResultDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 解析结果；`null` = 还没解析过（此时不该打开，组件按空态兜底处理） */
  parsed: ParsedCampaignRecipe | null
}

/** 解析结果摘要。抽成导出函数便于直接测试（数字口径是这里最容易出错的地方）。 */
export function summarizeParsedRecipe(dimensions: ParsedCampaignRecipeDimension[]) {
  let optionCount = 0
  let englishCount = 0
  let combinationCount = dimensions.length > 0 ? 1 : 0
  for (const dimension of dimensions) {
    const usable = (dimension.options ?? []).filter((option) => option.trim()).length
    optionCount += usable
    // 空维度会让组合空间归零（引擎也会拒绝生成），保留 0 比「乘出来还是 1」诚实
    combinationCount *= Math.max(0, usable)
    englishCount += Object.keys(dimension.englishByOption ?? {}).length
  }
  return { optionCount, combinationCount, englishCount }
}

const SOURCE_LABEL: Record<ParsedCampaignRecipe['source'], string> = {
  json: 'JSON',
  text: '自由排版',
}

/** 一行「标签：值」；值缺失时显示占位词，体现「解析器只填能确定的字段」 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">{label}</span>
      <span className="min-w-0 break-words text-xs text-ds-text dark:text-ds-text">
        {value.trim() ? value : <span className="text-ds-muted dark:text-ds-muted">未识别</span>}
      </span>
    </div>
  )
}

export default function SopCampaignRecipeParseResultDialog({
  open,
  onOpenChange,
  parsed,
}: SopCampaignRecipeParseResultDialogProps) {
  const close = () => onOpenChange(false)
  const summary = summarizeParsedRecipe(parsed?.dimensions ?? [])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="解析结果"
      description="「解析」按钮读到的东西全文在此，只读。表单里的修改不会回写到这里。"
      footer={
        <Button size="sm" variant="secondary" onClick={close}>
          关闭
        </Button>
      }
    >
      {!parsed ? (
        <p className="text-xs text-ds-muted dark:text-ds-muted">还没有解析结果。请在上方粘贴配方卡原文后点「解析」。</p>
      ) : (
        <div className="space-y-3">
          {/* 摘要：识别来源 + 三个数（维度 / 候选值 / 组合空间） */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={parsed.ok ? 'success' : 'danger'}>{parsed.ok ? '解析成功' : '解析失败'}</Badge>
            <Badge tone="neutral">识别来源：{SOURCE_LABEL[parsed.source]}</Badge>
            {parsed.ok && (
              <>
                <Badge tone="info">{parsed.dimensions.length} 个维度</Badge>
                <Badge tone="neutral">{summary.optionCount} 个候选值</Badge>
                <Badge tone="neutral">组合空间 {summary.combinationCount} 条</Badge>
                {summary.englishCount > 0 && <Badge tone="neutral">{summary.englishCount} 个带英文描述</Badge>}
              </>
            )}
          </div>

          {!parsed.ok && (
            <p
              className="flex items-start gap-1.5 rounded-ds-lg border border-ds-danger/35 bg-ds-danger-subtle px-3 py-2 text-xs text-ds-danger dark:border-ds-danger/40 dark:bg-ds-danger/10 dark:text-ds-danger"
              role="alert"
            >
              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{parsed.error || '解析失败，请检查原文格式后重试。'}</span>
            </p>
          )}

          {parsed.ok && (
            <>
              {/* 原资产声明的元信息：这些字段不会写进表单，所以只有这里能看到 */}
              <section className="space-y-1 rounded-ds-lg border border-ds-border px-3 py-2 dark:border-ds-border">
                <div className="flex items-center gap-1.5">
                  <SparklesIcon className="h-3.5 w-3.5 text-ds-muted dark:text-ds-muted" />
                  <span className="text-xs font-medium text-ds-text dark:text-ds-text">原资产信息</span>
                </div>
                <Field label="名称" value={parsed.name} />
                <Field label="说明" value={parsed.desc} />
                <Field label="主控槽" value={parsed.dominantSlots.join('、')} />
                <Field label="模型" value={parsed.meta.model ?? ''} />
                <Field label="标题槽" value={parsed.meta.headlineSlot ?? ''} />
              </section>

              {/* 维度池：逐个列出全部候选值（带 en 的标注出来） */}
              <section className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <FileTextIcon className="h-3.5 w-3.5 text-ds-muted dark:text-ds-muted" />
                  <span className="text-xs font-medium text-ds-text dark:text-ds-text">维度池</span>
                </div>
                {parsed.dimensions.length === 0 && (
                  <p className="text-xs text-ds-muted dark:text-ds-muted">没有识别到任何维度。</p>
                )}
                {parsed.dimensions.map((dimension, index) => {
                  const usable = (dimension.options ?? []).filter((option) => option.trim()).length
                  return (
                    <div
                      key={`${dimension.name}-${index}`}
                      className="rounded-ds-lg border border-ds-border px-3 py-2 dark:border-ds-border"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-ds-text dark:text-ds-text">
                          {dimension.name.trim() || `（第 ${index + 1} 个维度未命名）`}
                        </span>
                        {dimension.weight !== undefined && <Badge tone="neutral">权重 {dimension.weight}</Badge>}
                        <span className="text-xs text-ds-muted dark:text-ds-muted">{usable} 个值</span>
                      </div>
                      <p className="mt-1 text-xs leading-6 text-ds-text dark:text-ds-text">
                        {dimension.options.length === 0
                          ? '（无候选值）'
                          : dimension.options.map((option) => (option.trim() ? option : '（空）')).join('、')}
                      </p>
                    </div>
                  )
                })}
              </section>

              {/* 骨架：模板原文 */}
              <section className="space-y-1">
                <span className="text-xs font-medium text-ds-text dark:text-ds-text">提示词骨架</span>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 font-mono text-xs text-ds-text dark:border-ds-border dark:bg-ds-surface-subtle dark:text-ds-text">
                  {parsed.body.trim() || '（未识别到骨架）'}
                </pre>
              </section>

              {/* 需要用户补的：模板引用了但池里没有 */}
              {parsed.missingPools.length > 0 && (
                <p className="rounded-ds-lg border border-ds-warning/35 bg-ds-warning-subtle px-3 py-2 text-xs text-ds-warning dark:border-ds-warning/40 dark:bg-ds-warning/10 dark:text-ds-warning">
                  模板引用了但候选池缺失的占位符：
                  <strong>{parsed.missingPools.join('、')}</strong>
                  （不补齐引擎会拒绝生成）
                </p>
              )}

              {/* 非致命告警：字段留空 / 有池无值等 */}
              {parsed.warnings.length > 0 && (
                <section className="space-y-1">
                  <span className="text-xs font-medium text-ds-text dark:text-ds-text">解析提示</span>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-ds-muted dark:text-ds-muted">
                    {parsed.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 原资产的禁用词：只做告知，本引擎不自动套用 */}
              {parsed.meta.forbidden && parsed.meta.forbidden.length > 0 && (
                <p className="text-xs text-ds-muted dark:text-ds-muted">
                  原资产禁用词 {parsed.meta.forbidden.length} 项（本引擎不自动套用）：
                  {parsed.meta.forbidden.join('、')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}
