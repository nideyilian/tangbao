/**
 * 图转视频的**全局基线**（项目树之上那一层）。
 *
 * ## 与节点覆盖的分工
 *
 * 参数分两层，跟后处理完全对位：
 *
 * ```
 * 全局基线（本文件，一份）            → 节点覆盖（useProjectTreeParamsStore，按 collectionId）
 * 「谁都没表态时用我」                → 「我这个方向要不一样」
 * ```
 *
 * 节点层没表态的字段一路向上取，取到根还没表态就用这里的值（见
 * `projectTree/params.ts` 的 `resolveProjectImageVideoParams`）。
 *
 * ## 为什么单独一个 store，不塞进后处理那个
 *
 * 后处理的全局配置（`usePostprocessMediaStore`）里全是渠道、尺寸、水印预设这些**引用型**字段，
 * 与图转视频的字段没有一处重叠；塞在一起只会让「导入 / 拉取覆盖范围」那个按模块分组的机制
 * 多出一个不存在的模块。两者共用的是**继承机制**（项目树的节点覆盖层），不是存储。
 */

import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from '../../lib/desktopJsonStorage'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { resolveProjectImageVideoParams } from '../projectTree/params'
import { useProjectTreeParamsStore } from '../projectTree/storeProjectTreeParams'
import { normalizeImageVideoParams } from './params'
import { DEFAULT_IMAGE_VIDEO_PARAMS, type ImageVideoParams } from './types'

export interface ImageVideoStore {
  /** 全局基线参数（完整一份） */
  globals: ImageVideoParams
  /**
   * 按补丁改全局基线。
   *
   * `undefined` 的字段 = **回到默认值**（不是「保持原值」）：界面上把「每图时长」清空，
   * 意思就是「这块我不特别指定了」。注意这与节点覆盖层的语义**相反**
   * （那里 `undefined` = 继续向上继承），两者不要混。
   */
  setGlobals: (patch: Partial<ImageVideoParams>) => void
  resetGlobals: () => void
}

export const useImageVideoStore = create<ImageVideoStore>()(
  persist(
    (set) => ({
      globals: { ...DEFAULT_IMAGE_VIDEO_PARAMS },

      setGlobals: (patch) => set((state) => ({ globals: normalizeImageVideoParams({ ...state.globals, ...patch }) })),

      resetGlobals: () => set({ globals: { ...DEFAULT_IMAGE_VIDEO_PARAMS } }),
    }),
    {
      name: 'tangbao-image-video',
      version: 1,
      storage: createDesktopJsonStorage('imageVideo'),
      partialize: (state) => ({ globals: state.globals }),
      // 落盘数据被手改或来自旧版本时兜住：归一化会把非法值换成默认，不让一份坏数据
      // 把「生成视频」整条链路卡死
      migrate: (persisted) => {
        const input = (persisted ?? {}) as Record<string, unknown>
        return { globals: normalizeImageVideoParams(input.globals) }
      },
    },
  ),
)

/** 读全局基线（组件里用）。 */
export function useImageVideoGlobals(): ImageVideoParams {
  return useImageVideoStore((state) => state.globals)
}

/**
 * 解析某个节点**生效的**图转视频参数（含继承链）。
 *
 * 作用域传 `null`（未选任何节点）时得到的就是全局基线 + 默认值。
 */
export function useResolvedImageVideoParams(collectionId: string | null): ImageVideoParams {
  const collections = useAssetLibraryStore((state) => state.collections)
  const nodeParams = useProjectTreeParamsStore((state) => state.params)
  const globals = useImageVideoStore((state) => state.globals)
  return useMemo(
    () => resolveProjectImageVideoParams(collections, nodeParams, collectionId, globals),
    [collections, nodeParams, collectionId, globals],
  )
}
