/**
 * 后处理**文件命名**设置：命名模板 + 文件名预览 + 创作者。**全局一套**（产出文件名不按方向分）。
 *
 * 中控台「输出位置」分区的「文件命名」块。原先它挂在后处理弹窗的「全局默认」作用域里，
 * 2026-09-20 弹窗收窄为「只显示方向级参数」后搬到这里 —— 全局参数在中控台各有唯一入口。
 *
 * 校验（未知 / 缺失 / 重复占位符）与模板定义同源（`lib/postprocessNaming.ts`）：
 * token 集一改，校验范围跟着改，不会各说各话。
 *
 * **文件名预览**（杰哥 2026-09-21 要求）：模板 + 当前作用域 → 一个真实文件名，改一个字符立刻变。
 * 它与分区底部「产出预览」的分工是：这里只回答**一个名字长得对不对**，那边回答
 * **这一批会出多少个文件、分别叫什么**（要把渠道 / 尺寸 / 水印都乘进去）。
 */

import { useMemo } from 'react'
import { Alert, Button, TextField } from '../../design-system'
import {
  DEFAULT_POSTPROCESS_NAME_PATTERN,
  buildPostprocessOutputName,
  findDuplicatedPostprocessNameTokens,
  findMissingPostprocessNameTokens,
  findUnknownPostprocessNameTokens,
  validateNamePattern,
} from '../../lib/postprocessNaming'
import { resolveOutputDirection } from '../../lib/postprocessMedia'
import { POSTPROCESS_OUTPUT_EXTENSION } from '../../lib/postprocessRunner'
import {
  resolveNodeWatermarkBinding,
  resolveProjectNodePathNames,
  resolveProjectPostprocessSlice,
} from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useCompositeV2Store } from '../composite/storeV2'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import { usePostprocessGlobalConfig } from './usePostprocessGlobalConfig'
import NamePatternField from './NamePatternField'

/** 一个渠道一个尺寸都没有时的兜底尺寸，只为让预览永远有值 */
const FALLBACK_SIZE = { width: 1280, height: 720 }

export default function PostprocessNamingFields() {
  const namePattern = usePostprocessMediaStore((state) => state.namePattern)
  const creator = usePostprocessMediaStore((state) => state.creator)
  const setNamePattern = usePostprocessMediaStore((state) => state.setNamePattern)
  const setCreator = usePostprocessMediaStore((state) => state.setCreator)

  const media = usePostprocessMediaStore((state) => state.media)
  const selectedMediaIds = usePostprocessMediaStore((state) => state.selectedMediaIds)
  const globalWatermarkPresetIds = usePostprocessMediaStore((state) => state.watermarkPresetIds)
  const collections = useAssetLibraryStore((state) => state.collections)
  const libraryScope = useAssetLibraryStore((state) => state.scope)
  const params = useProjectTreeParamsStore((state) => state.params)
  const presets = useCompositeV2Store((state) => state.presets)
  const globalConfig = usePostprocessGlobalConfig()

  const issues = useMemo(
    () =>
      validateNamePattern(namePattern, {
        unknown: findUnknownPostprocessNameTokens(namePattern),
        missing: findMissingPostprocessNameTokens(namePattern),
        duplicated: findDuplicatedPostprocessNameTokens(namePattern),
      }),
    [namePattern],
  )

  /**
   * 预览用的作用域 = 中控台左树选中的节点（与右区标题、水印分区分区读同一个全局指针）。
   * 全局默认下没有具体节点，产品 / 方向两段自然是空的 —— 那正是「无归属时会生成什么」的真实样子，
   * 所以不编造示例值，只在界面上说清原因。
   */
  const scopeId = typeof libraryScope === 'object' && libraryScope.kind === 'collection' ? libraryScope.id : null
  const names = useMemo(
    () => (scopeId ? resolveProjectNodePathNames(collections, scopeId) : { line: '', product: '', direction: '' }),
    [collections, scopeId],
  )

  /**
   * 示例渠道要按**当前作用域的生效值**取（ADR-0013 之后「参与产出」是方向级的）。
   * 读全局那份的话，选中某个方向时预览会拿一个它根本不产出的渠道名来算，名字看着对、实际错。
   * 全局默认作用域下它就是全局基线。
   */
  const effectiveSelectedMediaIds = useMemo(
    () =>
      scopeId
        ? resolveProjectPostprocessSlice(collections, params, scopeId, globalConfig).config.selectedMediaIds
        : selectedMediaIds,
    [collections, globalConfig, params, scopeId, selectedMediaIds],
  )

  /** 示例渠道：优先已在产出的（勾选里第一个） */
  const sampleMedia = useMemo(() => {
    const selected = media.filter((item) => effectiveSelectedMediaIds.includes(item.id))
    // 没有勾选的渠道时退回渠道表第一个：预览必须永远有值，否则模板看着像坏了
    return selected[0] ?? media[0]
  }, [effectiveSelectedMediaIds, media])

  const sampleSize = sampleMedia?.sizes.find((size) => size.enabled) ?? sampleMedia?.sizes[0]

  /**
   * 示例水印预设名。
   * 只在模板真的用到 `{preset}` 时才算 —— 否则为了一个用不上的值去解析整条继承链没有意义。
   */
  const samplePresetName = useMemo(() => {
    if (!namePattern.includes('{preset}')) return ''
    const ids = scopeId
      ? resolveNodeWatermarkBinding(collections, params, scopeId, globalWatermarkPresetIds).presetIds
      : globalWatermarkPresetIds
    const first = ids[0]
    if (!first) return ''
    return presets.find((preset) => preset.id === first)?.name ?? first
  }, [namePattern, scopeId, collections, params, globalWatermarkPresetIds, presets])

  const previewName = useMemo(() => {
    const width = sampleSize?.width ?? FALLBACK_SIZE.width
    const height = sampleSize?.height ?? FALLBACK_SIZE.height
    const base = buildPostprocessOutputName(
      { namePattern, creator },
      {
        mediaName: sampleMedia?.name ?? '渠道',
        width,
        height,
        direction: resolveOutputDirection(width, height),
        ...(samplePresetName ? { watermark: { name: samplePresetName } } : {}),
      },
      names,
      1,
    )
    return `${base}.${POSTPROCESS_OUTPUT_EXTENSION}`
  }, [namePattern, creator, sampleMedia, sampleSize, samplePresetName, names])

  return (
    <div className="space-y-2.5">
      <NamePatternField
        value={namePattern}
        onChange={setNamePattern}
        trailing={
          // 清空输入框本身就等于恢复默认（store 侧空串会落回默认模板），
          // 这个按钮只是让「我知道默认长什么样」这件事可点，不是第二个数据路径。
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNamePattern(DEFAULT_POSTPROCESS_NAME_PATTERN)}
            disabled={namePattern === DEFAULT_POSTPROCESS_NAME_PATTERN}
          >
            恢复默认
          </Button>
        }
      />

      {/*
       * 预览只回答「按现在这个模板，产出文件叫什么」。数量、渠道、尺寸那些是下面
       * 「产出预览」的事 —— 两块各管一件事，所以这里刻意只给一行。
       */}
      <div
        data-layout="name-preview"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-ds-lg border border-ds-border bg-ds-surface-subtle px-3 py-1.5 dark:border-ds-border dark:bg-ds-surface-subtle"
      >
        <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">文件名预览</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ds-text dark:text-ds-text" title={previewName}>
          {previewName}
        </span>
        {!scopeId && (
          <span className="shrink-0 text-xs text-ds-muted dark:text-ds-muted">未选方向，产品 / 方向两段为空</span>
        )}
      </div>

      {issues.map((issue) => (
        <Alert key={issue.message} tone={issue.tone === 'error' ? 'danger' : 'warning'}>
          {issue.message}
        </Alert>
      ))}
      <TextField
        label="创作者"
        containerClassName="max-w-[22rem]"
        value={creator}
        placeholder="如：糖包"
        helperText="供 {creator} 占位符取值；留空则该段自动省略。"
        onChange={(event) => setCreator(event.target.value)}
      />
    </div>
  )
}
