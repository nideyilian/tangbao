import { describe, expect, it } from 'vitest'
import {
  createPostprocessIssue,
  describePostprocessIssueCode,
  describePostprocessIssueDetail,
  formatPostprocessIssue,
  formatPostprocessIssueList,
  isErrorIssue,
  POSTPROCESS_STAGE_LABELS,
} from './postprocessIssue'
import type { PostprocessIssueCode } from './postprocessIssue'

const ALL_CODES: PostprocessIssueCode[] = [
  'PP-SRC-001',
  'PP-ENV-001',
  'PP-SCOPE-001',
  'PP-SCOPE-002',
  'PP-TARGET-001',
  'PP-MEDIA-001',
  'PP-PRESET-001',
  'PP-DIR-001',
  'PP-DIR-002',
  'PP-DIR-003',
  'PP-DIR-004',
  'PP-NAME-001',
  'PP-WRITE-001',
  'PP-RENDER-001',
  'PP-RENDER-002',
  'PP-DIST-001',
  'PP-DIST-002',
  'PP-DIST-003',
  'PP-EMPTY-001',
]

describe('后处理错误码表', () => {
  it('每个码都有描述与可照做的线索', () => {
    for (const code of ALL_CODES) {
      const template = describePostprocessIssueCode(code)
      expect(template.message.trim(), code).not.toBe('')
      expect(template.hint.trim(), code).not.toBe('')
      // 线索要能被照着做：至少一句完整的话，不是「失败」这种复述
      expect(template.hint.length, code).toBeGreaterThan(8)
    }
  })

  it('目录不可用的线索指向真因（允许位置），不再写「请检查路径是否可达」', () => {
    const { hint } = describePostprocessIssueCode('PP-DIR-001')
    expect(hint).toContain('允许')
    // 反向验证：这句误导性文案正是要修掉的 —— 用户照它去查永远查不到
    // （真因是主进程 assertAllowedPath 的白名单，路径本身是可达的）
    for (const code of ALL_CODES) {
      expect(describePostprocessIssueCode(code).hint, code).not.toContain('请检查路径是否可达')
    }
  })

  it('跳过与出错分开：配置使然的不算错', () => {
    expect(isErrorIssue(createPostprocessIssue({ code: 'PP-SCOPE-001', stage: 'prepare' }))).toBe(false)
    expect(isErrorIssue(createPostprocessIssue({ code: 'PP-DIST-002', stage: 'distribute' }))).toBe(false)
    expect(isErrorIssue(createPostprocessIssue({ code: 'PP-DIR-001', stage: 'write' }))).toBe(true)
    expect(isErrorIssue(createPostprocessIssue({ code: 'PP-PRESET-001', stage: 'prepare' }))).toBe(true)
  })

  it('构造时上下文原样保留，描述与严重度由码表决定', () => {
    const issue = createPostprocessIssue({
      code: 'PP-DIR-004',
      stage: 'write',
      file: '月亮-toutiao-1080x1920-3.jpg',
      dir: 'D:/投放',
      sourceImageId: 'img-1',
    })
    expect(issue).toMatchObject({
      code: 'PP-DIR-004',
      message: '输出子目录创建失败',
      severity: 'error',
      stage: 'write',
      file: '月亮-toutiao-1080x1920-3.jpg',
      dir: 'D:/投放',
    })
  })

  it('单行文本带码，且文件名在码前面（用户先认文件再认码）', () => {
    const issue = createPostprocessIssue({
      code: 'PP-WRITE-001',
      stage: 'write',
      file: 'a.jpg',
    })
    expect(formatPostprocessIssue(issue)).toBe('a.jpg：[PP-WRITE-001] 图片写入失败')

    const global = createPostprocessIssue({ code: 'PP-SCOPE-002', stage: 'prepare', detail: '跳过 2 张' })
    expect(formatPostprocessIssue(global)).toBe('[PP-SCOPE-002] 所属方向关闭了自动后处理（跳过 2 张）')
  })

  it('详情文本按固定顺序列出上下文与线索', () => {
    const detail = describePostprocessIssueDetail(
      createPostprocessIssue({
        code: 'PP-PRESET-001',
        stage: 'prepare',
        file: 'a.jpg',
        sourceImageId: 'img-9',
        sourceIndex: 4,
        mediaName: '头条',
        presetId: 'preset-3',
      }),
    )
    const lines = detail.split('\n')
    expect(lines[0]).toBe('[PP-PRESET-001] 引用的水印预设不存在')
    expect(lines[1]).toBe('文件 a.jpg · 源图 img-9（第 5 张） · 渠道 头条 · 水印 preset-3')
    expect(lines[2]).toContain('线索：')
  })

  it('详情列表按条用空行隔开，条数与入参一致', () => {
    const list = formatPostprocessIssueList([
      createPostprocessIssue({ code: 'PP-DIR-001', stage: 'write' }),
      createPostprocessIssue({ code: 'PP-EMPTY-001', stage: 'finish' }),
    ])
    expect(list.split('\n\n')).toHaveLength(2)
    expect(list).toContain('[PP-DIR-001]')
    expect(list).toContain('[PP-EMPTY-001]')
  })

  it('阶段标签齐全（界面按它显示「现在在干什么」）', () => {
    expect(Object.keys(POSTPROCESS_STAGE_LABELS).sort()).toEqual(
      ['prepare', 'render', 'write', 'distribute', 'finish'].sort(),
    )
  })
})
