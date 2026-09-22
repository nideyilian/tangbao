/**
 * 「导入覆盖范围」的勾选组 —— **拉取配置**与**导入备份**共用。
 *
 * **只有这一份实现**：两个入口各写一遍，迟早有一处的默认值或文案跑偏，
 * 而「我明明勾了却没覆盖」比压根不提供选择更让人困惑。
 *
 * 语义一句话：**勾了才用包里的，没勾的这一块完全不动。**
 *
 * 粒度停在模块级是刻意的 —— 方向参数引用节点 id、水印按产品 id 归属、渠道选择引用渠道 id，
 * 允许再细的自由组合就会勾出「引用了不存在的东西」，那是比"多覆盖了一点"更难排查的静默失效。
 */
import { Checkbox } from './Checkbox'
import type { ImportScope } from '../store'

export interface ImportScopeFieldsProps {
  value: ImportScope
  onChange: (next: ImportScope) => void
  disabled?: boolean
}

export function ImportScopeFields({ value, onChange, disabled }: ImportScopeFieldsProps) {
  const patch = (next: Partial<ImportScope>) => onChange({ ...value, ...next })

  return (
    <div className="space-y-2.5">
      <Checkbox
        checked={value.tree}
        onChange={(next) => patch({ tree: next })}
        disabled={disabled}
        label="项目树与各方向的参数"
        description="方向、产品线、渠道选择、输出位置、水印引用一起进来"
      />
      <Checkbox
        checked={value.watermarks}
        onChange={(next) => patch({ watermarks: next })}
        disabled={disabled}
        label="水印库（预设与 LOGO）"
      />
      <Checkbox
        checked={value.channels}
        onChange={(next) => patch({ channels: next })}
        disabled={disabled}
        label="渠道与尺寸"
        description="含「默认投哪些渠道」与按渠道的导出位置"
      />
      <Checkbox
        checked={value.postprocess}
        onChange={(next) => patch({ postprocess: next })}
        disabled={disabled}
        label="全局产出配置"
        description="输出位置、命名模板、画面适配、分发"
      />
      <Checkbox
        checked={value.settings}
        onChange={(next) => patch({ settings: next })}
        disabled={disabled}
        label="应用设置"
        description="主题与各种本机偏好"
      />
      <Checkbox
        checked={value.localOnly === 'drop'}
        onChange={(next) => patch({ localOnly: next ? 'drop' : 'keep' })}
        disabled={disabled}
        tone="danger"
        label="删除本地自建的方向与水印"
        description="不勾则保留（推荐）。勾了是完全以发布方为准，本机自建的会被移进回收站，可再恢复"
      />
    </div>
  )
}
