import { describe, expect, it } from 'vitest'
import { decodeSopBatchSnapshotRecord } from './sopBatchSnapshotRecord'

function buildSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sop-run-1',
    batchId: 'sop-batch-1',
    workspaceTabId: 'tab-1',
    createdAt: 1_700_000_000_000,
    status: 'ready',
    sop: { id: 'preset-sop-compliance', name: '方向', description: '', content: '正文' },
    brief: '画面比例为:9:16',
    referenceImageIds: [],
    promptCount: 1,
    imagesPerPrompt: 1,
    prompts: [{ id: 'p1', text: '第一条', origin: 'ai', edited: false }],
    params: {},
    ...overrides,
  }
}

describe('decodeSopBatchSnapshotRecord', () => {
  it('原样返回结构完整的快照对象', () => {
    const snapshot = buildSnapshot()
    const decoded = decodeSopBatchSnapshotRecord(snapshot)
    expect(decoded?.id).toBe('sop-run-1')
    expect(decoded?.prompts).toHaveLength(1)
    expect(decoded?.sop.id).toBe('preset-sop-compliance')
  })

  it('解开「值是 JSON 字符串」的历史脏数据（本 namespace 曾按 zustand 方式双重编码）', () => {
    // app-data-records 的 json 列 = JSON.stringify(快照)，但历史写入路径又套了一层，
    // 于是读出来是 string。这里是那次事故的复现样本。
    const stored = JSON.stringify(JSON.stringify(buildSnapshot()))
    const decoded = decodeSopBatchSnapshotRecord(JSON.parse(stored))
    expect(typeof JSON.parse(stored)).toBe('string')
    expect(decoded?.id).toBe('sop-run-1')
    expect(decoded?.prompts).toHaveLength(1)
  })

  it('只解一层，再多一层编码仍判为无法识别', () => {
    const triple = JSON.stringify(JSON.stringify(JSON.stringify(buildSnapshot())))
    expect(decodeSopBatchSnapshotRecord(triple)).toBeNull()
  })

  it('补齐缺失的数组字段，避免下游 .filter 崩在 undefined 上', () => {
    const decoded = decodeSopBatchSnapshotRecord(
      buildSnapshot({ prompts: undefined, referenceImageIds: undefined, batchIds: undefined, taskIds: undefined }),
    )
    expect(decoded?.prompts).toEqual([])
    expect(decoded?.referenceImageIds).toEqual([])
    expect(decoded?.batchIds).toEqual([])
    expect(decoded?.taskIds).toEqual([])
    expect(() => decoded!.prompts.filter((item) => !item.deleted)).not.toThrow()
  })

  it('丢弃数组里的非字符串项', () => {
    const decoded = decodeSopBatchSnapshotRecord(buildSnapshot({ taskIds: ['a', 3, null, 'b'] }))
    expect(decoded?.taskIds).toEqual(['a', 'b'])
  })

  it.each([
    ['非对象字符串', 'just a string'],
    ['数字', 42],
    ['null', null],
    ['undefined', undefined],
    ['数组', []],
    ['缺 id', buildSnapshot({ id: '' })],
    ['缺 sop', buildSnapshot({ sop: undefined })],
    ['sop 缺 id', buildSnapshot({ sop: { name: '无 id' } })],
    ['无法解析的字符串', '{ 不是 JSON'],
  ])('认不出来就返回 null：%s', (_label, value) => {
    expect(decodeSopBatchSnapshotRecord(value)).toBeNull()
  })
})
