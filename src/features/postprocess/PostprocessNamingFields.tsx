/**
 * 后处理**文件命名**设置：命名模板 + 创作者。**全局一套**（产出文件名不按方向分）。
 *
 * 中控台「输出位置」分区的「文件命名」块。原先它挂在后处理弹窗的「全局默认」作用域里，
 * 2026-09-20 弹窗收窄为「只显示方向级参数」后搬到这里 —— 全局参数在中控台各有唯一入口。
 *
 * 校验（未知 / 缺失 / 重复占位符）与模板定义同源（`lib/postprocessNaming.ts`）：
 * token 集一改，校验范围跟着改，不会各说各话。
 */

import { useMemo } from 'react'
import { Alert, Button, TextField } from '../../design-system'
import {
  DEFAULT_POSTPROCESS_NAME_PATTERN,
  findDuplicatedPostprocessNameTokens,
  findMissingPostprocessNameTokens,
  findUnknownPostprocessNameTokens,
  validateNamePattern,
} from '../../lib/postprocessNaming'
import { usePostprocessMediaStore } from '../../storePostprocessMedia'
import NamePatternField from './NamePatternField'

export default function PostprocessNamingFields() {
  const namePattern = usePostprocessMediaStore((state) => state.namePattern)
  const creator = usePostprocessMediaStore((state) => state.creator)
  const setNamePattern = usePostprocessMediaStore((state) => state.setNamePattern)
  const setCreator = usePostprocessMediaStore((state) => state.setCreator)

  const issues = useMemo(
    () =>
      validateNamePattern(namePattern, {
        unknown: findUnknownPostprocessNameTokens(namePattern),
        missing: findMissingPostprocessNameTokens(namePattern),
        duplicated: findDuplicatedPostprocessNameTokens(namePattern),
      }),
    [namePattern],
  )

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
