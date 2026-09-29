/**
 * 视频命名（`naming.ts`）：渲染成「前缀」、校验、上下文组装。
 *
 * 盯三件事：
 * - **序号不在模板里**：引擎固定把 `-1` 加在末尾，模板写了 `{seq}` 也必须被删掉，
 *   否则落盘会出现重复的一段；
 * - **取不到值的段整段消失**，不留下 `A--B` 这种名字；
 * - **视频兑现不了的 token 原样保留**（不静默删掉）—— 用户得能在文件名里看见自己写错了。
 */

import { describe, expect, it } from 'vitest'
import {
  findUnknownImageVideoNameTokens,
  resolveVideoNamePrefix,
  resolveVideoNamingContext,
  validateImageVideoNamePattern,
} from './naming'
import { IMAGE_VIDEO_NAME_PATTERN } from './types'
import type { AssetCollection } from '../../types'

/** 固定成中午，避开时区把日期算到前一天（`formatGeneratedImageDate` 用的是本地时间） */
const NOON = new Date(2026, 8, 29, 12, 0, 0).getTime()

const CONTEXT = {
  line: '智能硬件',
  product: '机器人',
  direction: '竖版展示',
  media: '广点通',
  creator: '糖包',
  resolution: '1920x1080',
}

describe('resolveVideoNamePrefix', () => {
  it('默认模板：日期-产品-方向-渠道（序号由引擎加在末尾）', () => {
    expect(resolveVideoNamePrefix({ namePattern: IMAGE_VIDEO_NAME_PATTERN }, CONTEXT, NOON)).toBe(
      '20260929-机器人-竖版展示-广点通',
    )
  })

  it('⭐ 写了 {seq} 也会被删掉 —— 序号位置没有商量余地，留着会变成重复的一段', () => {
    expect(resolveVideoNamePrefix({ namePattern: '{product}-{seq}' }, CONTEXT, NOON)).toBe('机器人')
  })

  it('取不到值的 token 整段消失，不留下空段', () => {
    expect(resolveVideoNamePrefix({ namePattern: '{product}-{direction}' }, { product: '机器人' }, NOON)).toBe('机器人')
  })

  it('模板只剩分隔符时返回空串（= 只用序号 1.mp4），而不是凭空兜底成 image', () => {
    expect(resolveVideoNamePrefix({ namePattern: '-' }, CONTEXT, NOON)).toBe('')
  })

  it('空模板落到视频自己的默认模板，不是后处理那套', () => {
    expect(resolveVideoNamePrefix({ namePattern: '   ' }, CONTEXT, NOON)).toBe('20260929-机器人-竖版展示-广点通')
  })

  it('视频兑现不了的 {preset} 原样留在前缀里（静默删掉才是最坏的一类不一致）', () => {
    expect(resolveVideoNamePrefix({ namePattern: '{preset}-{product}' }, CONTEXT, NOON)).toBe('{preset}-机器人')
  })

  it('用得上分辨率：{size} 取的是参数里的分辨率', () => {
    expect(resolveVideoNamePrefix({ namePattern: '{media}-{size}' }, CONTEXT, NOON)).toBe('广点通-1920x1080')
  })

  it('渲染结果过长会截断（Windows 路径上限 260，输出目录可能已经很长）', () => {
    const long = resolveVideoNamePrefix(
      { namePattern: Array.from({ length: 20 }, () => '{product}').join('-') },
      CONTEXT,
      NOON,
    )
    expect(long.length).toBeLessThanOrEqual(120)
  })
})

describe('validateImageVideoNamePattern', () => {
  it('没有「缺少必要 token」这一档 —— 序号不由模板决定', () => {
    expect(validateImageVideoNamePattern('{product}')).toEqual([])
  })

  it('没写任何占位符也不算错（等于固定名字 + 序号）', () => {
    expect(validateImageVideoNamePattern('成片')).toEqual([])
  })

  it('未知占位符报错 —— 视频这边把 {preset} 也算未知', () => {
    expect(findUnknownImageVideoNameTokens('{preset}-{product}')).toEqual(['preset'])
    expect(validateImageVideoNamePattern('{preset}')[0]?.tone).toBe('error')
  })

  it('{seq} 单独提示「不生效」而不是「不认识」', () => {
    const issues = validateImageVideoNamePattern('{product}-{seq}')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('不生效')
    expect(issues[0]?.tone).toBe('warning')
  })

  it('重复占位符只是警告（它不会覆盖，只是名字里出现两次）', () => {
    expect(validateImageVideoNamePattern('{product}-{product}')[0]?.tone).toBe('warning')
  })
})

describe('resolveVideoNamingContext', () => {
  const collections: AssetCollection[] = [
    {
      id: 'line-a',
      name: '智能硬件',
      normalizedName: '智能硬件',
      parentId: null,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'product-a',
      name: '机器人',
      normalizedName: '机器人',
      parentId: 'line-a',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'direction-a',
      name: '竖版展示',
      normalizedName: '竖版展示',
      parentId: 'product-a',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  it('产品线 / 产品 / 方向取自项目树路径，渠道名与创作者来自调用方', () => {
    expect(
      resolveVideoNamingContext({
        collections,
        directionId: 'direction-a',
        mediaName: '广点通',
        resolution: '1920x1080',
        creator: '糖包',
      }),
    ).toEqual({
      line: '智能硬件',
      product: '机器人',
      direction: '竖版展示',
      media: '广点通',
      creator: '糖包',
      resolution: '1920x1080',
    })
  })

  it('方向 id 不在树里时不抛错，各段留空（渲染时会整段删掉）', () => {
    const context = resolveVideoNamingContext({
      collections,
      directionId: 'not-exist',
      mediaName: '广点通',
      resolution: '1280x720',
    })
    expect(context.line).toBe('')
    expect(context.product).toBe('')
    expect(context.direction).toBe('')
  })
})
