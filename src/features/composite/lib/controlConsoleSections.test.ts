import { describe, expect, it } from 'vitest'
import {
  CONTROL_CONSOLE_SECTIONS,
  DEFAULT_CONTROL_CONSOLE_SECTION,
  normalizeControlConsoleSection,
} from './controlConsoleSections'

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
    expect(normalizeControlConsoleSection('media')).toBe('media')
    expect(normalizeControlConsoleSection('不存在的分区')).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
    expect(normalizeControlConsoleSection(undefined)).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
    expect(normalizeControlConsoleSection(null)).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
    expect(normalizeControlConsoleSection(42)).toBe(DEFAULT_CONTROL_CONSOLE_SECTION)
  })
})
