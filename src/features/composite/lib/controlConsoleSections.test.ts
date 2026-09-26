import { describe, expect, it } from 'vitest'
import {
  CONTROL_CONSOLE_SECTIONS,
  DEFAULT_CONTROL_CONSOLE_SECTION,
  isGlobalScope,
  normalizeControlConsoleSection,
} from './controlConsoleSections'
import { GLOBAL_NODE_ID } from '../../postprocess/paramSchema'

describe('controlConsoleSections', () => {
  it('把水印放在第一个分区，因为它是历史行为唯一的入口', () => {
    // 这条是「用户点进来先看到哪里」的等价断言：改顺序会让老用户落到别的功能上
    expect(CONTROL_CONSOLE_SECTIONS[0]!.id).toBe('watermark')
    expect(DEFAULT_CONTROL_CONSOLE_SECTION).toBe('watermark')
  })

  it('分区 id 不重复，且都有标签与说明', () => {
    const ids = CONTROL_CONSOLE_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const section of CONTROL_CONSOLE_SECTIONS) {
      expect(section.label.trim().length).toBeGreaterThan(0)
      expect(section.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('认不出分区时退回默认分区，而不是抛错或返回 undefined', () => {
    // 界面传进来的可能是任意字符串（旧值 / 拼错的 id），必须能收敛
    expect(normalizeControlConsoleSection('channel')).toBe('channel')
    expect(normalizeControlConsoleSection('不存在的分区')).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
    expect(normalizeControlConsoleSection(undefined)).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
    expect(normalizeControlConsoleSection(null)).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
    expect(normalizeControlConsoleSection(42)).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
  })

  it('⭐ 分区表：水印 / 渠道与输出 / 视频（被合并过的两个别再拆回去）', () => {
    // 2026-09-21「分发」并入「输出位置」，2026-09-22「输出位置」再并入「渠道与尺寸」——
    // 两步是同一个道理（同一份数据的半张表不该各占一个 tab），**别再拆回去**。
    // 2026-09-26 新增 `video`（图转视频）：它是一份**新的数据**（视频参数），
    // 与前面两块零重叠，所以单独占一个 tab 是对的 —— 不是当年那种「同一份数据被劈成两半」。
    expect(CONTROL_CONSOLE_SECTIONS.map((section) => section.id)).toEqual(['watermark', 'channel', 'video'])
  })

  it('⭐ 退役的分区值收敛到它搬去的地方，而不是弹回默认分区', () => {
    // 分区是**持久化**的：老用户机器上可能存着这三个历史值。让它们掉进「认不出」分支会把人
    // 弹回水印，等于把「我上次停在哪」这件事默默抹掉 —— 而它们都有明确的新家。
    expect(normalizeControlConsoleSection('media')).toBe('channel')
    expect(normalizeControlConsoleSection('output')).toBe('channel')
    expect(normalizeControlConsoleSection('distribution')).toBe('channel')
    // 更早的退役值（'directions'）没有对应新家，照旧退回默认分区
    expect(normalizeControlConsoleSection('directions')).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
  })

  it('isGlobalScope 只认哨兵值（从已退役的 ConsoleScopePicker 迁来）', () => {
    expect(isGlobalScope(GLOBAL_NODE_ID)).toBe(true)
    expect(isGlobalScope('line-a')).toBe(false)
    expect(isGlobalScope('__postprocess_global__')).toBe(true)
  })
})
