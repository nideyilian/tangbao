import { submitTaskWithData, useStore } from '../../store'
import { useAssetLibraryStore } from '../assetLibrary/store'
import { useRequirementPrototype } from '../requirementPrototype/store'
import { runDailyBatch } from './runner'
import { useDailyBatchStore } from './store'
import type { DailyRun, DailyTarget } from './types'

/** 当天的日期键（YYYY-MM-DD）。跑批去重、批次号、抖动种子都用它。 */
export function todayKey(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 跑一个产品一天的量，并把结果记进 store。
 *
 * 「提示词从哪来」由 `runner` 里的三个引擎按卡的类型自己选（配方卡 / 变量提示词 / 普通 SOP），
 * 这里只负责把生成好的提示词交给**现有**的 `submitTaskWithData` —— 不另开一条出图链路，
 * 于是出图、落库、自动归档到方向、素材库批次分组这些既有能力全部照旧生效。
 */
export async function executeDailyTarget(dateKey: string, target: DailyTarget): Promise<DailyRun> {
  const collections = useAssetLibraryStore.getState().collections
  const sops = useRequirementPrototype.getState().sopLibrary
  const params = useStore.getState().params

  const { run, unplanned } = await runDailyBatch(target, useDailyBatchStore.getState().cards, dateKey, {
    collections,
    sops,
    submitTask: async (input) => {
      const taskId = await submitTaskWithData(
        {
          prompt: input.prompt,
          inputImages: [],
          inputImageFolder: null,
          params: { ...params, n: Math.max(1, input.imagesPerPrompt) },
          maskDraft: null,
          sopBatch: {
            batchId: input.batchId,
            sopId: input.sopId,
            sopName: input.sopName,
            promptIndex: input.promptIndex,
            promptCount: input.promptCount,
            imagesPerPrompt: input.imagesPerPrompt,
          },
          // 图片自动归档到这个方向 —— 「这个方向出的图就进这个方向的文件夹」
          defaultCollectionId: input.directionCollectionId,
        },
        { silentSuccess: true },
      )
      return taskId ?? null
    },
  })

  useDailyBatchStore.getState().upsertRun(run)
  if (unplanned > 0 || run.skipped.length > 0 || run.error) {
    const parts = [
      unplanned > 0 ? `有 ${unplanned} 张没排下去` : '',
      run.skipped.length > 0 ? run.skipped[0].detail : '',
      run.error ?? '',
    ].filter(Boolean)
    useStore.getState().showToast(`每日生成没跑满：${parts.join('；')}`, 'error')
  }
  return run
}

/** 手动「立即跑一次今天」：跳过「当天已跑过」的判断。 */
export async function runDailyBatchNow(dateKey = todayKey()): Promise<DailyRun[]> {
  const targets = useDailyBatchStore.getState().targets.filter((item) => item.enabled && item.dailyTotal > 0)
  const runs: DailyRun[] = []
  for (const target of targets) {
    runs.push(await executeDailyTarget(dateKey, target))
  }
  return runs
}
