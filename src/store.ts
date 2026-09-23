import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDesktopJsonStorage } from './lib/desktopJsonStorage'
import { applyApiSecrets, extractApiSecrets, stripApiSecrets, type ApiSecretBundle } from './lib/apiSecrets'
import { calculateImageSize, inferSizeTier } from './lib/size'
import { parseVariablePrompt, renderVariablePromptBatch } from './lib/variablePrompt'
import { getPostprocessRun, isDirectionPostprocessBusy, useRuntimeStore } from './stores/runtimeStore'
import {
  getPostprocessMediaConfigSnapshot,
  restorePostprocessMediaConfig,
  usePostprocessMediaStore,
} from './storePostprocessMedia'
import { isRecord } from './lib/typeGuards'
import {
  applyPostprocessScope,
  buildTreeConfigBundle,
  toAssetCollections,
  toCompositeV2State,
  toNodeParams,
  toPostprocessMediaConfig,
  validateTreeConfigBundle,
  TREE_CONFIG_ENTRY,
  type TreeConfigBundle,
} from './lib/treeConfigBundle'
// 只引类型：`postprocessMedia` 是纯逻辑模块，不反向依赖 store，静态引它安全。
import type { PostprocessMediaConfig } from './lib/postprocessMedia'
// 只引类型：执行体在 `scheduleTaskPostprocess` 里动态 import。
// 静态 import 会把 features/postprocess → features/composite 整条链拉进 store.ts 的模块图，
// 与 composite 侧的循环初始化冲突（store.test.ts 曾因此拿到 undefined 的 useCompositeV2Store）。
import type { TaskPostprocessResult, TaskPostprocessSource } from './features/postprocess/taskPostprocess'
import {
  POSTPROCESS_CANCEL_CODE,
  createPostprocessIssue,
  describePostprocessIssueCode,
  formatPostprocessIssue,
  formatPostprocessIssueList,
  isErrorIssue,
  issuesToWarnings,
  type PostprocessIssue,
} from './features/postprocess/postprocessIssue'
import type { PostprocessRunSource } from './features/postprocess/postprocessRun'
// 方向拆分相关：`directionTargets` 只依赖纯类型（无副作用模块），`postprocessDirectionGate`
// 只依赖 runtimeStore —— 两者都不会把 features/composite 拉进 store.ts 的模块图（见上面那条注释）。
import { groupImageIdsByTargetDirection } from './features/postprocess/directionTargets'
import {
  acquirePostprocessDirection,
  releasePostprocessDirection,
} from './features/postprocess/postprocessDirectionGate'
// 取消（TB-115）：句柄按方向登记在这里，界面点「取消」时按方向打过来。
// 只能放在编排层 —— 它必须与并发闸的「拿到名额 → 跑完释放」同生命周期（见 runDirection）。
import {
  isPostprocessCanceledError,
  registerPostprocessCancel,
  releasePostprocessCancel,
} from './features/postprocess/postprocessCancel'
import {
  appendPostprocessHistoryEntry,
  createPostprocessHistoryId,
  getPostprocessHistoryState,
} from './storePostprocessHistory'
import { collectHistoryOutputDirs, createHistoryEntryFromRun } from './features/postprocess/postprocessHistory'
import { resolvePostprocessProjectTargets } from './lib/postprocessProjectTree'
import {
  DEFAULT_CONTROL_CONSOLE_SECTION,
  type ControlConsoleSectionId,
} from './features/composite/lib/controlConsoleSections'
import type {
  AgentConversation,
  AgentMessage,
  AgentRound,
  ApiMode,
  ApiProfile,
  AppSettings,
  RemoteGenerationProvider,
  AppMode,
  BatchItemError,
  BatchItemStatus,
  TaskProgressStage,
  TaskParams,
  TaskStatus,
  InputImage,
  InputImageFolder,
  MaskDraft,
  ScheduleItem,
  ScheduleState,
  SopBatchSnapshot,
  TaskRecord,
  FavoriteCollection,
  ExportData,
  GeneratedAsset,
  ResponsesApiResponse,
  ResponsesOutputItem,
  WorkspaceTab,
  WorkspaceTabGroup,
  AssetCollection,
} from './types'
import type { StoredImage, StoredImageThumbnail, ThumbnailVariant } from './types'
import type { CallApiResult } from './lib/imageApiShared'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_PARAMS } from './types'
import {
  createDefaultScheduleRows,
  formatDateKey,
  getScheduleRunKey,
  getWeekStartDate,
  parseDateKey,
  resolveScheduleOutputTarget,
} from './lib/schedule'
import {
  DEFAULT_SETTINGS,
  getActiveApiProfile,
  getAgentImageApiProfile,
  getAgentProfileValidationError,
  getAgentTextApiProfile,
  getApiMaxN,
  getCustomProviderDefinition,
  mergeImportedSettings,
  normalizeMaxConcurrent,
  normalizeMaxRetries,
  normalizeSettings,
  validateApiProfile,
} from './lib/apiProfiles'
import { dismissAllTooltips } from './lib/tooltipDismiss'
import { reconcileGeneratedAssets } from './lib/assetReconciliation'
import { runGeneratedAssetLibraryMigration } from './lib/migrations/generatedAssetLibraryV1'
import {
  identifyShadowFavoriteTasks,
  runLegacyFavoritesToAssetsMigration,
} from './lib/migrations/legacyFavoritesToAssets'
import { runLegacyImageFoldersToCollectionsMigration } from './lib/migrations/legacyImageFoldersToCollections'
import { createAssetSyncQueue } from './lib/assetSyncQueue'
import { createToastReplayGuard } from './lib/toastReplayGuard'
import {
  executeAssetPurge,
  patchTaskForPurgedSlots,
  planAssetPurge,
  type AssetPurgeBlockedItem,
  type AssetPurgePlan,
  type ForceDetachItem,
} from './lib/assetPurge'
import {
  patchAssetOriginsForDetachedImages,
  patchAgentConversationForDetachedImages,
  patchInputDraftLike,
  patchInputImageList,
  patchOrderForDetachedImages,
  patchSopLibraryItemForDetachedImages,
  patchSopSnapshotForDetachedImages,
  patchStrategyAssetForDetachedImages,
  patchTaskForDetachedInputs,
  patchWorkspaceTabForDetachedImages,
} from './lib/assetDetach'
import {
  getAssetsByIds,
  getAssetsByImageIds,
  hydrateFull,
  mergeImportedAssetLibrary,
  putGeneratedAssets,
  type AssetLibrarySnapshot,
} from './lib/assetLibraryRepository'
import {
  normalizeAsset,
  normalizeAssetUsageEvent,
  normalizeCollection,
  normalizeTag,
  normalizeTombstone,
} from './lib/assetLibraryModel'
import { getTaskSourceMode, type AssetTaskContext } from './lib/generatedAssetOrigin'
import { upsertFromTask } from './lib/assetLibraryRepository'
import { useAssetLibraryStore } from './features/assetLibrary/store'
import {
  pickDeepestCollectionId,
  resolveProjectNodeIdChain,
  resolveProjectNodeKind,
} from './features/projectTree/params'
import { useProjectTreeParamsStore } from './features/projectTree/storeProjectTreeParams'
import { isScrollActive } from './lib/scrollActivity'
import { buildLocalImageUrl, isLocalImageUrl, localImageUrlToDataUrl } from './lib/localImageUrl'
import { remapImageMentionsForOrder, replaceImageMentionsForApi } from './lib/promptImageMentions'
import { appendAdNegativeRule, createAdNegativeRuleSnapshot, getAdNegativeRule } from './lib/adNegativeRules'
import {
  CURRENT_THUMBNAIL_VERSION,
  getAllTasks,
  loadTasksIncrementally,
  putTask as dbPutTask,
  putTasks as dbPutTasks,
  deleteTask as dbDeleteTask,
  clearTasks as dbClearTasks,
  getAllAgentConversations,
  replaceAgentConversations,
  clearAgentConversations as dbClearAgentConversations,
  getImage,
  getImageThumbnail,
  getStoredImageThumbnail,
  resolveImageFromCatalog,
  getAllImageIds,
  getAllImages,
  getLegacyImageBatch,
  putImage,
  deleteImage,
  clearImages,
  clearGeneratedAssets,
  clearAssetCollections,
  clearAssetTags,
  clearAssetTombstones,
  clearAssetUsageEvents,
  clearAssetBlobs,
  clearAssetVersions,
  storeImage,
  batchDeleteImages,
  batchGetImages,
  batchGetImageThumbnails,
  batchGetCompositeAssets,
  putCompositeAssets,
  batchPutTasks,
  commitImportedRecords,
  getMigrationJournal,
  putMigrationJournal,
  cleanupElectronLegacyIndexedDb,
  getSopBatchSnapshot,
  getAllSopBatchSnapshots,
  putSopBatchSnapshot,
  clearSopBatchSnapshots,
  updateImageLocalPaths,
  getAllLocalImagePaths,
  getAllAssetUsageEvents,
  putAssetUsageEvents,
  purgeGeneratedAssetsInTransaction,
  getFreshThumbnailFromDisk,
  buildGridThumbnail,
  type PurgeRecords,
} from './lib/db'
import { buildImageReferenceGraph, isImageReferenced, type ImageReferenceGraph } from './lib/imageReferenceGraph'
import { callImageApi } from './lib/api'
import {
  callAgentChatCompletionsApi,
  callAgentConversationTitleApi,
  callAgentResponsesApi,
  callBatchImageSingle,
  parseBatchImageCallArguments,
  type AgentApiResultImage,
} from './lib/agentApi'
import {
  collectAgentRoundOutputImageSlots,
  extractAgentReferenceIds,
  getAgentCurrentReferenceId,
  getAgentGeneratedImageReferenceId,
  replaceAgentPromptImageReferencesForApi,
} from './lib/agentImageReferences'
import { showBrowserNotification } from './lib/browserNotification'
import {
  IMAGE_FETCH_CORS_HINT,
  isRetryableError,
  retryTransientRequest,
  runWithConcurrencyAndRetry,
} from './lib/imageApiShared'
import {
  MAX_DIRECT_INPUT_IMAGES,
  MAX_REFERENCE_IMAGE_CONCURRENCY,
  shouldCycleReferenceImages,
} from './lib/inputImageLimits'
import { getFalErrorMessage, getFalQueuedImageResult } from './lib/falAiImageApi'
import { getCustomQueuedImageResult } from './lib/openaiCompatibleImageApi'
import { setApiTransportMode } from './lib/desktopApiFetch'
import { getSourceHeight, getSourceWidth, loadImageOriented, validateMaskMatchesImage } from './lib/canvasImage'
import { mergePostprocessedActualParams, postprocessGeneratedImage } from './lib/imagePostprocess'
import { fingerprintImage } from './lib/imageFingerprint'
import {
  applyProviderResult,
  applyRemoteRequestSubmitted,
  applyRequestFailure,
  classifyGenerationError,
  classifyImageAgainstState,
  computeSeed,
  createGenerationPolicy,
  createInitialGenerationState,
  getBatchCompletion,
  getRecoverableRequests,
  markExhaustedSlots,
  planNextRequests,
  computeBackoffDelay,
  type GenerationPolicy,
  type GenerationState,
  type ImageProviderCapabilities,
  type PlannedRequest,
  type SlotAssignment,
  type ImageFingerprintLike,
} from './lib/imageBatchOrchestrator'
import { orderInputImagesForMask } from './lib/mask'
import { normalizeParamsForSettings } from './lib/paramCompatibility'
import { Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate, UnzipPassThrough, strToU8, strFromU8 } from 'fflate'
import {
  isElectron as isElectronEnv,
  getLocalSavePath,
  setLocalSavePath,
  copyRawCacheImagesToRoot,
  getImageExtensionFromDataUrl,
  saveImageToLocal,
  linkImageToLocal,
  saveTaskMetaToLocal,
  savePromptToLocal,
  saveAgentConversationToLocal,
  saveAgentRoundSummaryToLocal,
  readFileBuffer,
  saveRawCacheImageToLocal,
  exportZipToPath,
  selectZipSavePath,
  getLocalImageSaveDirectory,
  getLocalImageSaveDirectoryForSegments,
  getExplicitImageSaveDirectory,
  authorizeOutputDirectory,
  getDirectoryBaseName,
  readDirectory,
  joinPath,
  writeThumbnailToDisk,
  deleteThumbnailsFromDisk,
  fileExistsOnDisk,
  getLibraryBackupsPath,
  pruneLibraryBackupsInDir,
} from './lib/localSave'
import { migrateLegacyImages } from './lib/imageStorageMigration'
import {
  buildElectronImageExportEntries,
  buildExportImageRefs,
  collectReferencedExportImageIds,
} from './lib/dataExport'
import { ByteLruCache } from './lib/byteLruCache'
import { sanitizeSettingsForBackup } from './lib/backupManifest'
import { reconcileBackupWorkspaceImages, validateBackupArchive } from './lib/backupImport'
import { runMigration } from './lib/migrations/registry'
import { shouldDeleteOrphanImage } from './lib/storageCleanup'
import { createWorkspaceBackupState, restoreWorkspaceBackupState } from './lib/workspaceBackup'
import {
  buildGeneratedImageFileNameBase,
  findNextGeneratedImageSequence,
  getSeriesGroupImageSequence,
} from './lib/generatedImageFilename'
import {
  assignMissingGeneratedImageBatches,
  getNextGeneratedImageBatch,
  resolveSeriesGroupGeneratedImageNaming,
} from './lib/generatedImageBatch'
import {
  canSettleTaskOutputs,
  pickMoreCompleteOutputIds,
  planRestoredOutputAssignments,
} from './lib/generatedOutputImages'
import { useRequirementPrototype } from './features/requirementPrototype/store'
import { getSopAiRevisionAttachmentReferences, removeSopAiRevisionAttachments } from './features/strategy/sopAiRevision'

export const ALL_FAVORITES_COLLECTION_ID = '__all_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_ID = '__default_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_NAME = '默认'

// ===== Image cache =====
// 内存缓存，id → dataUrl。只保留少量最近使用图片，避免大量 4K data URL 常驻内存。

const imageCache = new ByteLruCache<string, string>(128 * 1024 * 1024)
const thumbnailCache = new ByteLruCache<
  string,
  { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number }
>(64 * 1024 * 1024)
// 以下三个结构统一按 `${id}:${variant}` 分键（见 thumbnailKey）：
// 待回填队列 / 回填在途集合 / 缩略图更新订阅。
const thumbnailBackfillIds = new Map<string, ThumbnailBackfillRequest>()
const thumbnailBackfillRunningIds = new Set<string>()
const thumbnailSubscribers = new Map<string, Set<(thumbnail: ThumbnailResult) => void>>()
let thumbnailBackfillScheduled = false
const MAX_THUMBNAIL_BACKFILL_CONCURRENT = 4
export const MAX_RETAINED_STREAM_PARTIAL_IMAGES = 3
const FAL_RECOVERY_POLL_MS = 10_000
const CUSTOM_RECOVERY_POLL_MS = 10_000
const SUPPORT_PROMPT_IMAGE_THRESHOLD = 50
const AGENT_INPUT_DRAFT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
const AGENT_ROUND_IMAGE_MENTION_RE = /@(?:第)?(\d+)轮图(\d+)/g
const falRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const customRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const agentRoundControllers = new Map<string, AbortController>()
// 恢复轮询在途集合：防止同一任务并发双轮询（定时器 map 提前自删 + 无在途标志的问题）。
const falRecoveryInFlight = new Set<string>()
const customRecoveryInFlight = new Set<string>()
// 手动生图任务级取消：任务停止时中止在途 API 请求 / 退避等待 / 恢复轮询。
const taskAbortControllers = new Map<string, AbortController>()

/** 停止一个正在运行的手动生图任务（中止在途请求；任务状态由执行路径收敛为已停止）。 */
export function stopTask(taskId: string): boolean {
  const controller = taskAbortControllers.get(taskId)
  if (!controller) return false
  clearFalRecoveryTimer(taskId)
  clearCustomRecoveryTimer(taskId)
  clearOpenAIWatchdogTimer(taskId)
  controller.abort(new DOMException('任务已停止', 'AbortError'))
  return true
}
const agentRecoveryContinuations = new Set<string>()
let localImageSaveQueue = Promise.resolve()
let agentRoundSummarySaveQueue = Promise.resolve()
let agentConversationPersistenceReady = false
let agentConversationMigrationPending = false
let imageStorageMigrationPromise: Promise<number> | null = null
const OPENAI_INTERRUPTED_ERROR = '请求中断'
const AGENT_STOPPED_MESSAGE = '已停止生成。'
const AGENT_RECOVERY_PAUSE_ERROR = 'AgentRecoveryPauseError'
const AGENT_CONVERSATION_TITLE_MAX_LENGTH = 28
const ERROR_TOAST_MAX_LENGTH = 80
type ToastType = 'info' | 'success' | 'error'
type AgentInputDraft = {
  prompt: string
  inputImages: InputImage[]
  inputImageFolder: InputImageFolder | null
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath?: string
  updatedAt?: number
}

/** 项目文件夹维度的生图输入隔离草稿：每个文件夹（含子文件夹，按 id 独立）保存各自的提示词/参数/参考图/遮罩。 */
type FolderInputDraft = {
  prompt: string
  params: TaskParams
  inputImages: InputImage[]
  inputImageFolder: InputImageFolder | null
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath?: string
  updatedAt?: number
}

export function getErrorToastMessage(message: string): string {
  const text = message.trim()
  if (!text) return '操作失败'

  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  const separatorIndex = firstLine.search(/[：:]/)
  if (separatorIndex > 0) {
    const title = firstLine.slice(0, separatorIndex).trim()
    if (isErrorToastTitle(title)) return title
  }

  if (firstLine.length > ERROR_TOAST_MAX_LENGTH) return '操作失败，请查看详情'
  return firstLine || '操作失败'
}

function getToastMessage(message: string, type: ToastType): string {
  return type === 'error' ? getErrorToastMessage(message) : message
}

/**
 * 「用户亲手关掉的提示不再重播」闸门（逻辑与约定见 `src/lib/toastReplayGuard.ts`）。
 * 修的是 2026-09-21 报障「失败提示突然弹出且无法关闭」：批量生成每个任务结算播一次同款文案，
 * 点掉后立刻被下一条顶回来。
 */
const toastReplayGuard = createToastReplayGuard()

function isErrorToastTitle(title: string): boolean {
  return /(?:失败|错误|异常|报错|无法|不能|超时|中断|断开|请先|请输入|已达上限|不存在|已丢失)$/.test(title)
}

// 'backup' 已并入 'data'（TB-042 P2）：备份列表/恢复/备份间隔不再独立成 Tab，
// 与导出/导入同处「数据管理」页。移除该成员后 tsc 会抓出所有旧的 setShowSettings(…, 'backup') 调用点。
export type SettingsTab = 'general' | 'agent' | 'api' | 'data' | 'about'

const TIMEOUT_STREAMING_HINT = '也可尝试打开「流式传输」，并提高「请求中间步骤图像数」来维持连接。'
const TIMEOUT_PARTIAL_IMAGES_ZERO_HINT =
  '官方流式接口不发送心跳，当前「请求中间步骤图像数」为 0，连接可能因无数据传输而断开。建议提高到 2 或 3。'
const TIMEOUT_PARTIAL_IMAGES_LOW_HINT = '也可尝试提高「请求中间步骤图像数」来维持连接，避免长时间无数据传输导致断开。'

type TimeoutStreamingHintProfile = Pick<ApiProfile, 'provider' | 'streamImages' | 'streamPartialImages'>

function getTimeoutStreamingHint(profile?: TimeoutStreamingHintProfile | null) {
  if (profile?.provider !== 'openai') return ''
  const partialImages = profile.streamPartialImages ?? DEFAULT_SETTINGS.streamPartialImages ?? 0
  if (profile.streamImages !== true) return TIMEOUT_STREAMING_HINT
  if (partialImages === 0) return TIMEOUT_PARTIAL_IMAGES_ZERO_HINT
  return partialImages < 3 ? TIMEOUT_PARTIAL_IMAGES_LOW_HINT : ''
}

function createOpenAITimeoutError(timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。${getTimeoutStreamingHint(profile)}`
}

export function getCachedImage(id: string): string | undefined {
  return imageCache.get(id)
}

export function cacheImage(id: string, dataUrl: string) {
  imageCache.set(id, dataUrl, dataUrl.length * 2)
}

/**
 * 本地写盘失败上报。
 *
 * 复用 `App.tsx` 已在监听的 `tangbao:persist-error` 通道（带 5 秒节流，不会 Toast 洪水）。
 * 只上报、不上抛 —— `enqueueLocalImageSave` 的调用方全是 `void ...`（后台尽力保存语义），
 * 上抛只会变成未捕获 rejection，用户可感知性由这条通道负责。
 */
function notifyLocalImagePersistError() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('tangbao:persist-error', { detail: { namespace: 'localImage' } }))
}

/** 导出仅供测试断言「失败会上报且不毒化队列」—— 调用点在文件内部，均为 `void` 尽力保存语义。 */
export function enqueueLocalImageSave(operation: () => Promise<void>): Promise<void> {
  // 队列隔离（前一项失败不毒化后续项）保持原语义不变；新增的是「失败必须留痕并上报」。
  // 磁盘满 / 只读目录 / U 盘拔出时，静默 resolve 会让用户在图已经不存在之后才发现。
  const queued = localImageSaveQueue
    .catch(() => {})
    .then(operation)
    .catch((error) => {
      console.error('[store] 本地图片保存失败：', error)
      notifyLocalImagePersistError()
    })
  localImageSaveQueue = queued
  return queued
}

function getTaskFilenameFallbackLabel(task: TaskRecord): string {
  return (
    task.scheduledOutputSubFolder ??
    (task.scheduledOutputPath ? getDirectoryBaseName(task.scheduledOutputPath) : 'image')
  )
}

function getNextTaskFilenameBatch(createdAt: number, targetTabId: string | null, fallbackLabel = 'image') {
  const state = useStore.getState()
  const tab = targetTabId ? state.workspaceTabs.find((item) => item.id === targetTabId) : null
  if (tab) return getNextGeneratedImageBatch(tab.tasks, createdAt)

  // 一次 O(总任务数) 建索引：原实现在 filter 回调里对每个任务再扫一遍所有标签页，
  // 复杂度是 O(任务数 × 标签页数 × 每页任务数)。千级任务量下每张图命名都要跑数百万次比较，
  // 而它位于「保存到本地」链路，批量出图时会被反复调用。
  const ownedTaskIds = new Set<string>()
  for (const item of state.workspaceTabs) {
    for (const candidate of item.tasks) ownedTaskIds.add(candidate.id)
  }
  const unownedTasks = state.tasks.filter(
    (task) => !ownedTaskIds.has(task.id) && getTaskFilenameFallbackLabel(task) === fallbackLabel,
  )
  return getNextGeneratedImageBatch(unownedTasks, createdAt)
}

function formatLocalSaveBatchFolder(createdAt: number, filenameBatch = 1): string {
  const date = new Date(createdAt)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const batch = String(Math.max(1, filenameBatch)).padStart(3, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}-batch-${batch}`
}

function getTaskLocalSaveBatchFolder(createdAt: number, filenameBatch: number): string | undefined {
  const settings = normalizeSettings(useStore.getState().settings)
  return settings.imageSaveLayout === 'batch-folder' ? formatLocalSaveBatchFolder(createdAt, filenameBatch) : undefined
}

/**
 * 任务保存命名上下文：批次号（= 文件名里的组标识）+ 批次目录。
 *
 * 系列图（一组多张）会拆成多条成员任务提交，同一个系列的成员必须共用**同一个批次号**，
 * 文件名才稳定为「X-组序号-组内顺序序号」，图片也落在同一个批次目录里而不是分散存放
 * （见 `resolveSeriesGroupGeneratedImageNaming`）。非系列任务、以及组内首个成员，
 * 按常规领取新批次号。
 */
function resolveTaskGeneratedImageNaming(
  createdAt: number,
  tabIdToUpdate: string | null,
  sopBatch: TaskRecord['sopBatch'],
): { filenameBatch: number; localSaveBatchFolder: string | undefined } {
  const seriesGroupNaming = resolveSeriesGroupGeneratedImageNaming(useStore.getState().tasks, sopBatch)
  if (seriesGroupNaming) {
    return {
      filenameBatch: seriesGroupNaming.filenameBatch,
      localSaveBatchFolder:
        seriesGroupNaming.localSaveBatchFolder ??
        getTaskLocalSaveBatchFolder(createdAt, seriesGroupNaming.filenameBatch),
    }
  }
  const filenameBatch = getNextTaskFilenameBatch(createdAt, tabIdToUpdate)
  return { filenameBatch, localSaveBatchFolder: getTaskLocalSaveBatchFolder(createdAt, filenameBatch) }
}

/**
 * 「树状工作区 → 文件夹」：任务所属标签页在分组下的目录段（[分组名, 标签页名]）。
 * 标签页无分组时只有标签页名；标签页已删除时回退到提交时快照的标签页名。
 */
function resolveWorkspaceTreeSegments(
  groups: WorkspaceTabGroup[],
  task: TaskRecord,
  containingTab: WorkspaceTab | undefined,
): string[] | null {
  const tabName = containingTab?.name?.trim() || task.scheduledOutputSubFolder?.trim()
  if (!tabName) return null
  const groupId = containingTab?.groupId ?? null
  const groupName = groupId ? groups.find((group) => group.id === groupId)?.name?.trim() : undefined
  return groupName ? [groupName, tabName] : [tabName]
}

/**
 * 「素材库项目文件夹 → 磁盘目录」：任务提交时所在的项目文件夹（defaultCollectionId）在
 * 项目树中的完整路径段（如 [APP, 快手, 老歌]）。文件夹不存在、被回收或层级异常时返回
 * null，由调用方回退到「树状工作区」目录。
 */
function resolveAssetTreeSegments(task: TaskRecord): string[] | null {
  const folderId = task.defaultCollectionId
  if (!folderId) return null
  const collections: AssetCollection[] = useAssetLibraryStore.getState().collections
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  const segments: string[] = []
  let current: AssetCollection | null | undefined = byId.get(folderId)
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const name = current.name.trim()
    if (!name || current.trashedAt) return null
    segments.unshift(name)
    current = current.parentId ? byId.get(current.parentId) : null
  }
  return segments.length > 0 ? segments : null
}

async function getTaskImageSaveDirectory(
  task: TaskRecord,
  options: { subFolder?: string; workspaceSegments?: string[] | null },
): Promise<string | null> {
  const { subFolder, workspaceSegments } = options
  // 优先级：显式输出目录 > 树状工作区（分组/标签页） > 标签页/日程子文件夹
  let baseDir: string | null
  if (task.scheduledOutputPath) {
    baseDir = await getExplicitImageSaveDirectory(task.scheduledOutputPath)
  } else if (workspaceSegments && workspaceSegments.length > 0) {
    baseDir = await getLocalImageSaveDirectoryForSegments(workspaceSegments)
  } else {
    baseDir = await getLocalImageSaveDirectory(subFolder)
  }
  if (!baseDir) return null
  if (!task.localSaveBatchFolder) return baseDir
  return getExplicitImageSaveDirectory(await joinPath(baseDir, task.localSaveBatchFolder))
}

async function getTaskLocalFilenameState(taskId: string) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) return null

  const containingTab = state.workspaceTabs.find(
    (tab) => tab.tasks.some((item) => item.id === taskId) || tab._taskIds?.includes(taskId),
  )
  // 「根据树状结构创建对应文件夹」：任务输出命名副本按目录保存——
  // 优先按「素材库项目文件夹树」（在哪个文件夹发送任务，磁盘目录就按该文件夹的树路径建，
  // 如 images/APP/快手/老歌）；无项目文件夹时回退到「树状工作区」分组/标签页两级目录
  // （无分组的标签页 → 仅标签页目录）；显式输出目录不掺入这两套路径。
  const workspaceSegments = task.scheduledOutputPath
    ? null
    : (resolveAssetTreeSegments(task) ?? resolveWorkspaceTreeSegments(state.workspaceTabGroups, task, containingTab))
  const subFolder = task.scheduledOutputPath
    ? undefined
    : workspaceSegments
      ? undefined
      : (task.scheduledOutputSubFolder ?? containingTab?.name)
  const imagesDir = await getTaskImageSaveDirectory(task, { subFolder, workspaceSegments })
  if (!imagesDir) return null

  const context = {
    createdAt: task.createdAt,
    // 工作区保存时用标签页名（最后一级目录）作为文件名基础，避免文件名过长
    label: workspaceSegments
      ? workspaceSegments[workspaceSegments.length - 1]
      : (containingTab?.name ?? task.scheduledOutputSubFolder ?? getDirectoryBaseName(imagesDir)),
    prompt: task.prompt,
    batch: task.filenameBatch ?? 1,
  }
  const settings = normalizeSettings(state.settings)
  let fileNames: string[] = []
  try {
    fileNames = await readDirectory(imagesDir)
  } catch (err) {
    console.error('Failed to read directory for generated image naming', err)
  }
  const startSequence = findNextGeneratedImageSequence(fileNames, context, settings)

  return { task, context, settings, startSequence, imagesDir }
}

async function saveTaskImagesToLocalFS(taskId: string, imageIds: string[], imageIndexOffset: number = 0) {
  return enqueueLocalImageSave(async () => {
    await saveTaskImagesToLocalFSNow(taskId, imageIds, imageIndexOffset)
  })
}

function getLocalSavedOutputImageKey(imageId: string, imageIndex: number): string {
  return `${imageIndex}:${imageId}`
}

function markTaskOutputImagesSavedToLocal(taskId: string, saved: Record<string, string>) {
  if (Object.keys(saved).length === 0) return

  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task) return

  updateTaskInStore(taskId, {
    localSavedOutputImagePaths: {
      ...(task.localSavedOutputImagePaths ?? {}),
      ...saved,
    },
  })
}

async function saveTaskImagesToLocalFSNow(taskId: string, imageIds: string[], imageIndexOffset: number) {
  // 恢复 0.7.56 交互：任务输出按「树状工作区」目录（images/分组/标签页）提供原图。
  // 磁盘上同一张图只存一份（cache-images 唯一原图），工作区目录里放**硬链接**——
  // 零额外空间；源文件缺失（非 Electron / 原图未落盘）时才回退为字节副本。
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const filenameState = await getTaskLocalFilenameState(taskId)
  if (!filenameState) return
  const { task, context, settings, startSequence, imagesDir } = filenameState

  const saved: Record<string, string> = {}
  let savedCount = 0
  // 系列图：组内顺序序号由「组内第几名成员 × 每成员张数 + 任务内图片序号」直接决定（1 起连续），
  // 组标识沿用同组共享的批次号；普通任务沿用目录续号。
  const series = task.sopBatch?.series
  for (let index = 0; index < imageIds.length; index++) {
    const imageId = imageIds[index]
    const imageIndex = imageIndexOffset + index
    const key = getLocalSavedOutputImageKey(imageId, imageIndex)
    // 已保存过的输出跳过（幂等：流式到达/完成补存/恢复重跑不会重复写盘）
    if (task.localSavedOutputImagePaths?.[key]) continue
    const rec = await getImage(imageId)
    const dataUrl = rec?.dataUrl || (await ensureImageCached(imageId))
    if (!rec?.localPath && !dataUrl) continue
    // 扩展名优先从 dataUrl 推导；不可解码时回退到磁盘原图的真实扩展名
    const ext = getImageExtensionFromDataUrl(
      dataUrl ?? 'data:image/png;base64,',
      rec?.localPath?.split('.').pop()?.toLowerCase() || task.params?.output_format || 'png',
    )
    const sequence =
      getSeriesGroupImageSequence(series, task.sopBatch?.imagesPerPrompt ?? task.params?.n, imageIndex) ??
      startSequence + savedCount
    const fileNameBase = buildGeneratedImageFileNameBase(context, settings, sequence)
    let savedPath: string | null = null
    if (rec?.localPath) {
      // 硬链接：同一物理文件、两个目录入口
      savedPath = await linkImageToLocal(rec.localPath, taskId, imageIndex, ext, undefined, imagesDir, fileNameBase)
    }
    if (!savedPath && dataUrl) {
      // 回退：源文件不可用（如原图未落盘）时写字节副本
      savedPath = await saveImageToLocal(taskId, imageIndex, dataUrl, ext, undefined, imagesDir, fileNameBase)
    }
    if (savedPath) {
      saved[key] = savedPath
      savedCount++
    }
  }
  if (Object.keys(saved).length > 0) markTaskOutputImagesSavedToLocal(taskId, saved)
}

async function saveTaskMetaToLocalFS(taskId: string) {
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const state = useStore.getState()
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task || !task.outputImages?.length) return

  try {
    await saveTaskMetaToLocal(taskId, task)
    await savePromptToLocal(taskId, task.prompt)
  } catch (err) {
    console.error('保存任务元数据到本地失败:', err)
  }
}

async function saveTaskToLocalFS(taskId: string) {
  return enqueueLocalImageSave(async () => {
    await saveTaskToLocalFSNow(taskId)
  })
}

async function saveTaskToLocalFSNow(taskId: string) {
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const state = useStore.getState()
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task || !task.outputImages?.length) return

  // 任务输出原图按「树状工作区」目录保存命名副本（见 saveTaskImagesToLocalFSNow）；
  // 此处同时保留任务元数据/提示词的本地记录。
  try {
    await saveTaskMetaToLocal(taskId, task)
    await savePromptToLocal(taskId, task.prompt)
  } catch (err) {
    console.error('保存到本地失败:', err)
    useStore.getState().showToast('保存到本地失败', 'error')
  }
  // 完成/恢复路径兜底：补存尚未写入工作区目录的输出命名副本（幂等，已存过的跳过）
  await saveTaskImagesToLocalFSNow(taskId, task.outputImages ?? [], 0)
  // 后处理产出（额外产出一份各渠道变体）：未启用配置时直接返回，失败只提示不回滚生成结果。
  // fire-and-forget，所以必须自己兜住异常——漏出去的 rejection 不会变成任何界面提示。
  void scheduleTaskPostprocess(taskId).catch((error) => {
    console.error('自动后处理触发失败', error)
    useStore.getState().showToast('自动后处理失败，可在素材库选中素材手动补跑', 'error')
  })
}

/** 已产出过后处理的源图键（`${taskId}:${imageId}`）：流式追加与恢复重跑都只处理一次 */
const postprocessedSourceKeys = new Set<string>()

/** 等素材归属落地的总时长与步长（仅批次任务用，见 `resolveImageOwnership`）。 */
const OWNERSHIP_WAIT_TOTAL_MS = 2000
const OWNERSHIP_WAIT_STEP_MS = 250

/**
 * 同步读一次每张图的归属方向（`Asset.collectionIds` 里最深的一条）。
 *
 * 为什么要有同步版本（2026-09-23 按方向拆分后）：归属现在决定「这次触发会拆成几条 run」，
 * 而 run 记录必须在**同一个同步段**里建出来 —— 用户点「跑后处理」之后，工具栏的「后处理」入口
 * 里要立刻能看到 N 条记录（这是「点了到底有没有生效」唯一的答复）。中间插一个 `await`
 * 就意味着那一帧查不到任何东西。
 */
function collectImageOwnership(imageIds: string[]): Map<string, string | null> {
  const state = useAssetLibraryStore.getState()
  const assetByImageId = new Map<string, GeneratedAsset>()
  for (const asset of Object.values(state.assetsById)) {
    if (!assetByImageId.has(asset.imageId)) assetByImageId.set(asset.imageId, asset)
  }
  const result = new Map<string, string | null>()
  for (const imageId of imageIds) {
    const asset = assetByImageId.get(imageId)
    result.set(imageId, asset ? pickDeepestCollectionId(state.collections, asset.collectionIds) : null)
  }
  return result
}

/**
 * 有界等待归属落地（**仅批次任务用**，见 `collectImageOwnership`）。
 *
 * 为什么要等：批次任务的素材归档走异步队列（`assetSyncQueue → archiveTaskToBatchFolder`），
 * 与「任务保存完成 → 触发后处理」是并发的两条线。不等的话首轮几乎必然拿不到归属，
 * 后处理会静默退回全局默认参数——用户看到的现象就是「树上配的方向参数没生效」。
 *
 * 等待是有界的，且只在**一张都拿不到**归属时继续等：一旦有任何一张拿到，
 * 说明归档已经跑过一轮，剩下的按当前结果走即可，不再多花时间。
 */
async function waitForImageOwnership(
  imageIds: string[],
  initial: Map<string, string | null>,
): Promise<Map<string, string | null>> {
  let ownership = initial
  for (let waited = 0; waited < OWNERSHIP_WAIT_TOTAL_MS; waited += OWNERSHIP_WAIT_STEP_MS) {
    if ([...ownership.values()].some((id) => id)) break
    await new Promise((resolve) => setTimeout(resolve, OWNERSHIP_WAIT_STEP_MS))
    try {
      ownership = collectImageOwnership(imageIds)
    } catch (error) {
      // 等待期间读失败就用已有的那份接着跑：这一步只是「尽量拿到归属」，
      // 让整个批次因为一次读失败而中断（而且失败在 await 之后，没人接）才是更糟的结果。
      console.error('后处理等待归属期间读取失败', error)
      break
    }
  }
  return ownership
}

/**
 * 产出成功后回写素材状态（TB-105）：素材打上「已使用」、并清掉「已审核」（两者互斥）。
 *
 * 入参是**源图 id**（`TaskPostprocessOutput.rawImageId`）。素材库没有 `imageId → assetId` 的
 * 现成索引，这里按需构建一张反查表 —— 比逐张 `find` 少一个数量级。
 * 一张图在库里找不到对应素材是正常的（被彻底删除、或本来就不属于素材库），跳过不报错。
 *
 * **产出为空的批次根本不调用本函数**：失败、以及「配置指向空产出」都不算「已使用」——
 * 亮着一枚没有任何产物支撑的标签，比不亮更糟。
 */
async function markImagesPostprocessed(imageIds: string[]): Promise<void> {
  const unique = Array.from(new Set(imageIds.filter(Boolean)))
  if (unique.length === 0) return
  const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
  const { assetsById, applyPostprocessProduced } = useAssetLibraryStore.getState()
  const byImageId = new Map(Object.values(assetsById).map((asset) => [asset.imageId, asset.id]))
  const assetIds = unique.map((imageId) => byImageId.get(imageId)).filter((id): id is string => Boolean(id))
  if (assetIds.length === 0) return
  await applyPostprocessProduced(assetIds)
}

/**
 * 任务完成后按后处理配置产出各渠道变体。
 *
 * 幂等三闸：内存键（同会话防并发重入）、任务的 `postprocessOutputs`（跨重启）、
 * 以及源图不可用时的显式跳过。全部失败路径都只提示，不影响生成结果。
 */
async function scheduleTaskPostprocess(taskId: string): Promise<void> {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task) return
  const imageIds = (task.outputImages ?? []).filter(Boolean)
  if (imageIds.length === 0) return

  const config = usePostprocessMediaStore.getState()
  // 勾选项 = 后处理的**启用范围**（不是产出目标——产出目标由图片归属决定）。
  // 一个都没勾就是不启用：不看树上有多少参数，否则「没勾却照跑」会与输入栏的「未启用」自相矛盾。
  if (config.selectedCollectionIds.length === 0) return

  const produced = new Set((task.postprocessOutputs ?? []).map((item) => item.rawImageId))
  const result = await executePostprocessImageIds(imageIds, {
    // 批次任务会自动归档到项目文件夹，归属能决定参数、输出目录和 `{line}/{product}/{direction}` 命名段，
    // 所以即使树上还没配参数也要等一下（`waitForImageOwnership` 一拿到归属就提前退出，不是干等 2s）。
    waitForOwnership: Boolean(task.sopBatch),
    alreadyProducedImageIds: [...produced],
    createdAt: task.createdAt,
    taskId,
    source: 'auto',
    /**
     * 会话内幂等闸挪到**分组之后**（执行体按方向逐张认领）。
     *
     * 键里必须带方向：按方向拆分之后，同一次触发的每个方向都要处理同一张图 ——
     * 沿用原来的 `taskId:imageId` 会让第二个方向以为自己「已经产出过」而整条跳过，
     * 症状是「只出了一个方向的东西」（而它看起来像是配置问题）。
     *
     * 「先占位再执行」的次序没变：认领发生在建 run 之前，本函数仍是 fire-and-forget 的防重入。
     */
    claimImage: (directionId, imageId) => {
      if (produced.has(imageId)) return false
      const key = `${taskId}:${directionId}:${imageId}`
      if (postprocessedSourceKeys.has(key)) return false
      postprocessedSourceKeys.add(key)
      return true
    },
  })
  if (!result) return

  if (result.outputs.length > 0) {
    const latest = useStore.getState().tasks.find((item) => item.id === taskId)
    updateTaskInStore(taskId, {
      postprocessOutputs: [...(latest?.postprocessOutputs ?? []), ...result.outputs],
      rawImageId: latest?.rawImageId ?? result.outputs[0].rawImageId,
    })
    // 素材侧同步亮起「已使用」（TB-105）。放在写回任务之后：任务记录是幂等的依据，
    // 先落它再改素材，中途失败最多是「标记少了」而不是「任务记录缺一块导致重复产出」。
    await markImagesPostprocessed(result.outputs.map((item) => item.rawImageId))
  }
  reportPostprocessResult(result, { source: 'auto' })
}

/**
 * 把执行结果翻成用户提示：产出数、没产出时的原因。
 *
 * **只发一条**：`showToast` 是单槽（`set({ toast })` + 3s 自动清），连发多条会互相顶掉 ——
 * 之前「产出 3 个文件」后面紧跟一条 warning，用户只看到 warning，成功那次反而像什么都没发生。
 * 所以产出数与首条原因合并进同一条。
 *
 * **自动触发只报真错**（2026-09-21 报障「并非错误的提示反复弹出」）：自动后处理是**每个生成任务
 * 完成就跑一次**的后台行为，而配置使然的跳过（方向没参与 / 该方向的自动开关关着 / 渠道没勾）
 * 每批都会照原样再发生一次 —— 逐批弹红条等于拿配置事实刷屏，且用户点掉它也没有任何可做的。
 * 这类结果改由素材库工具栏的状态入口与进度面板承接（常驻、可查询、可关闭）。
 * **手动触发照旧逐次回应**：那是用户明确点的一次，必须有下文，哪怕结论是「什么都没产出」。
 *
 * 没产出时**也必须**给结论（手动路径）。曾经的写法是「三项皆空就不提示」，而
 * 「媒体尺寸全被禁用」这类情况恰好三项皆空 → 点了按钮界面毫无变化，与「按钮坏了」无法区分。
 *
 * 现在每条提示都带**错误码**，并在有问题时挂一个「查看问题」动作：toast 3 秒后就没了，
 * 而排查要的是完整清单（码 + 上下文 + 线索），靠 toast 装不下。
 *
 * 导出是为了让「自动不打扰、手动必有下文」这两条能被测试直接守住 —— 它们只体现在
 * 这一层（走 `scheduleTaskPostprocess` 需要跑完整条生成链，测不到这条分支）。
 */
export function reportPostprocessResult(
  result: TaskPostprocessResult,
  options: { successPrefix?: string; source: PostprocessRunSource },
): void {
  const successPrefix = options.successPrefix ?? '后处理完成'
  const showToast = useStore.getState().showToast
  const produced = result.outputs.length
  const first = result.issues[0]
  const reason = first ? formatPostprocessIssue(first) : undefined
  // 「跳过」不是错误：只有出现 error 级问题才用红色提示（码表里每个码自己声明严重度）
  const hasError = result.issues.some(isErrorIssue)
  const action =
    result.issues.length > 0
      ? { label: '查看问题', onClick: () => showPostprocessIssuesDialog(result.issues) }
      : undefined

  // 后台自动产出：没有真错就闭嘴。成果在素材库/输出目录里看得见，跳过项在工具栏入口里查得到。
  if (options.source === 'auto' && !hasError) return

  if (produced > 0) {
    // 有原因时降级成 info：结果本身是成功的，但要让用户知道有东西被跳过
    const message = reason
      ? `${successPrefix}：产出 ${produced} 个文件；${reason}`
      : `${successPrefix}：产出 ${produced} 个文件`
    showToast(message, reason ? 'info' : 'success', action)
    return
  }

  // 原因放最前：error 型 toast 超过 80 字会被截成「操作失败，请查看详情」，原因就丢了
  if (reason) {
    showToast(`没有产出文件：${reason}`, hasError ? 'error' : 'info', action)
    return
  }
  if (result.skippedMediaIds.length > 0) {
    showToast(`没有产出文件：选中的 ${result.skippedMediaIds.length} 个媒体已被删除`, 'error')
    return
  }
  // 三项皆空（没产出、没问题、没跳过）说明是配置没配上，用码表里的排查顺序，别让用户猜
  showToast(`没有产出文件：${describePostprocessIssueCode('PP-EMPTY-001').hint}`, 'error')
}

/**
 * 完整问题清单弹窗（错误码 + 描述 + 上下文 + 定位线索）。
 *
 * 用既有确认弹窗而不是新做一个：`message` 支持多行与反引号，列表形态刚好够，
 * 而每多一个模态窗就多一份焦点陷阱 / Esc 关闭 / 滚动锁的维护面。
 *
 * **标题按内容说真话**：19 个码里大多数是「配置使然、不是故障」的跳过（方向没参与、
 * 该方向的自动开关关着、渠道没勾），一个真错都没有时它叫「跳过」而不是「问题」——
 * 一律叫「问题」会让用户以为软件坏了（2026-09-21 报障）。
 *
 * 导出是给素材库工具栏的「查看问题」入口用：toast 3 秒后消失，问题清单得留得住。
 */
export function showPostprocessIssuesDialog(issues: PostprocessIssue[]): void {
  const errors = issues.filter(isErrorIssue).length
  const skipped = issues.length - errors
  useStore.getState().setConfirmDialog({
    title: errors > 0 ? `后处理出错（${errors}）` : `后处理跳过（${skipped}）`,
    message: formatPostprocessIssueList(issues),
    icon: 'info',
    showCancel: false,
    confirmText: '知道了',
  })
}

/**
 * 后处理同时能跑几个方向。
 *
 * 口径（杰哥 2026-09-23）：「同时跑的数量不要限制，可以使用最多并发数 + 排队的方式」——
 * 所以这里读的就是设置里那个「最多并发数」（`ApiProfile.maxConcurrent`，默认 5），
 * 刻意**不另造**一个只属于后处理的常数：用户已经有一个地方在管这个数字，多一个必然分叉。
 * 配大了就是真并行（不封顶），配成 1 就等于串行，配小了超出的方向排队。
 */
function resolvePostprocessDirectionConcurrency(): number {
  return normalizeMaxConcurrent(getActiveApiProfile(useStore.getState().settings).maxConcurrent)
}

/** 空结果（没启用 / 没有可处理的图 / 某个方向被跳过都用它，形状统一免得下游各写一套判空）。 */
function emptyPostprocessResult(): TaskPostprocessResult {
  return {
    outputs: [],
    outputDirs: [],
    skippedMediaIds: [],
    issues: [],
    pendingDistribution: [],
    warnings: [],
    diagnostics: { paintMs: 0, encodeMs: 0, encodeCount: 0, writeMs: 0 },
  }
}

/** 把各方向的结果并成一份（批次级回写与提示看的就是它）。 */
function mergePostprocessResults(results: TaskPostprocessResult[]): TaskPostprocessResult {
  const merged = emptyPostprocessResult()
  for (const result of results) {
    merged.outputs.push(...result.outputs)
    merged.issues.push(...result.issues)
    merged.pendingDistribution.push(...result.pendingDistribution)
    // 耗时构成同样累加：批次级的「这次一共花多少在画、多少在编码」是排查慢的第一眼
    merged.diagnostics.paintMs += result.diagnostics.paintMs
    merged.diagnostics.encodeMs += result.diagnostics.encodeMs
    merged.diagnostics.encodeCount += result.diagnostics.encodeCount
    merged.diagnostics.writeMs += result.diagnostics.writeMs
    for (const mediaId of result.skippedMediaIds) {
      if (!merged.skippedMediaIds.includes(mediaId)) merged.skippedMediaIds.push(mediaId)
    }
  }
  return merged
}

/** 方向的展示名 `产品线 / 产品 / 方向`；树上找不到（已被删）时退回 id，宁可显示 id 也不要空。 */
function describeDirectionLabel(collections: AssetCollection[], directionId: string): string {
  const [target] = resolvePostprocessProjectTargets(collections, [directionId])
  if (!target) return directionId
  return [target.line, target.product, target.direction].filter(Boolean).join(' / ') || directionId
}

/**
 * 给**批次级**问题留一条可查记录（准备阶段失败、分发失败）。
 *
 * 为什么不挂在某条方向 run 上：分发是跨方向的收尾动作、准备失败时连方向都还没拆出来 ——
 * 它们都不属于任何一个方向，挂到第一条 run 上会让「这个方向有问题」变成假话。
 * 但也不能不留：toast 3 秒就没了，而错误码正是排查的起点（`postprocessIssue.ts` 的码表就是为这个存在的）。
 */
function recordBatchLevelPostprocessRun(input: {
  batchId: string
  source: PostprocessRunSource
  taskId?: string
  directionLabel: string
  issues: PostprocessIssue[]
  producedFiles: number
}): void {
  const runId = `${input.source}-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const runtime = useRuntimeStore.getState()
  runtime.startPostprocessRun({
    id: runId,
    source: input.source,
    taskId: input.taskId,
    totalImages: 0,
    batchId: input.batchId,
    directionLabel: input.directionLabel,
  })
  runtime.finishPostprocessRun(runId, { issues: input.issues, producedFiles: input.producedFiles })
}

/** 准备阶段（读归属 / 读树 / 读配置 / 分方向）就已经失败：留痕 + 返回可上报的结果。 */
function recordPostprocessPrepareCrash(input: {
  batchId: string
  source: PostprocessRunSource
  taskId?: string
  error: unknown
}): TaskPostprocessResult {
  const issues = [
    createPostprocessIssue({ code: 'PP-CRASH-001', stage: 'prepare', cause: messageOfError(input.error) }),
  ]
  recordBatchLevelPostprocessRun({
    ...input,
    directionLabel: '全部方向（准备阶段失败）',
    issues,
    producedFiles: 0,
  })
  return { ...emptyPostprocessResult(), issues, warnings: issuesToWarnings(issues) }
}

/**
 * 把一条已收尾的 run 落到**方向级历史**里（TB-115）。
 *
 * 为什么在收尾**之后**再读一次 run：`finishPostprocessRun` 已经把状态、问题、耗时、产出数
 * 全部写进了记录，历史要存的就是那份**终态快照** —— 拿参数另拼一份，两处必然分叉
 * （状态判定一改、这边没跟上，历史里就会出现「显示成功、实际失败」这类谎报）。
 *
 * 读不到 run（已被会话内 60 条上限挤掉、或已被用户清掉）时静默跳过：历史只是留档，
 * 不该因为一条内存记录不在了就中断收尾流程。
 */
function recordDirectionPostprocessHistory(input: {
  runId: string
  targetDirectionIds: string[]
  /** 本次实际写入的目录；不传则取 run 上进度里累积的那些 */
  outputDirs?: string[]
}): void {
  const run = getPostprocessRun(input.runId)
  if (!run) return
  const entry = createHistoryEntryFromRun(run, {
    id: createPostprocessHistoryId(),
    targetDirectionIds: input.targetDirectionIds,
    outputDirs: input.outputDirs ?? run.outputDirs ?? [],
  })
  if (entry) appendPostprocessHistoryEntry(entry)
}

/**
 * 把历史记录里出现过的输出目录逐个重新放行（启动时调用，见 `initStore` 的第一句）。
 *
 * 逐条 fire-and-forget、单条失败即跳过：这是启动期的补齐动作，任何一个目录不可达
 * （共享盘没挂上、目录被手删）都不该拖住启动，更不该弹错 —— 真正需要它的那一刻
 * （用户点「打开输出位置」）主进程自己会给出可读的结果。
 */
async function authorizeHistoryOutputDirs(): Promise<void> {
  // 上限是防御性的：理论上历史里不会攒出几百个目录，但一条被外部改坏的记录
  // 不该让启动时发出去几百次 IPC
  const dirs = collectHistoryOutputDirs(getPostprocessHistoryState()).slice(0, 200)
  for (const dir of dirs) {
    try {
      await authorizeOutputDirectory(dir)
    } catch {
      // 放行失败不是错误：只说明这个目录现在用不了，其它目录照常
    }
  }
}

/**
 * 执行后处理并回报结果（自动触发与手动批量**共用**）的**批次编排**。
 *
 * 抽出来是因为两个触发点只差「处理哪些图」与「结果记到哪」，其余（归属解析、源图读取、
 * 参数继承、**方向拆分**、warning 上报）完全一样。各写一份必然出现「自动跑有归属、手动跑没归属」这类偏差。
 *
 * **为什么是「批次 + 方向」两级**（2026-09-23 杰哥要求按方向独立运行）：
 * 一次触发 = 一个批次；批次内**每个产出方向各一条独立 run** —— 各自的进度、各自的输出目录与
 * 文件序号、各自的失败，方向之间互不阻塞（上限见 `resolvePostprocessDirectionConcurrency`，
 * 超出的排队）。但**分发与总结算是一次**的：分发要跨方向共用一次洗牌，各方向各洗一次会让
 * 「同一张素材在各渠道目录落在同一天」这条性质失效（`taskPostprocess` 的 `deferDistribution`）。
 *
 * 拆分的键是**产出目标方向**（`directionTargets.ts` 的唯一实现），不是图片归属方向 ——
 * 手动跑的「记住配置」可以一批跨方向，按归属拆会拆不干净。
 *
 * 不碰任务记录：自动触发要写回 `postprocessOutputs`，手动触发没有任务可写，
 * 把写回塞进来会让两边的幂等语义互相污染。返回 null = 后处理没启用（调用方据此提示）。
 */
async function executePostprocessImageIds(
  imageIds: string[],
  options: {
    waitForOwnership: boolean
    alreadyProducedImageIds?: string[]
    createdAt?: number
    taskId?: string
    /** 自动（任务完成触发）还是手动（素材库补跑）；只影响记录归属与文案 */
    source: PostprocessRunSource
    /**
     * 认领一张图在某个方向上的处理权；返回 false = 这次不用处理它。
     *
     * 自动触发用它做会话内幂等（`postprocessedSourceKeys`）。**键里必须带方向**：
     * 同一次触发的每个方向都要处理同一张图，不带方向的话第二个方向会以为自己
     * 「已经产出过」而整条跳过 —— 症状是「只出了一个方向的东西」。
     */
    claimImage?: (directionId: string, imageId: string) => boolean
  },
): Promise<TaskPostprocessResult | null> {
  // 启用范围为空 = 没启用。与输入栏的「未启用」显示保持一致，不看树上有多少参数。
  if (usePostprocessMediaStore.getState().selectedCollectionIds.length === 0) return null

  const batchId = `${options.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  /**
   * 准备阶段（读归属 / 读树 / 读配置）逐处兜错：**这一步炸了也要留一条带码的记录**。
   *
   * 2026-09-21 排查过同类问题：前段抛错只进 console，界面上什么也没有 ——「点了没反应」。
   * 归属读取尤其如此（它是第一个真正碰到其它 store 的地方，`useAssetLibraryStore.getState()`
   * 一旦出问题，后面全部无从谈起）。
   */
  const readFailures: unknown[] = []
  const readOrNull = <T>(read: () => T): T | null => {
    try {
      return read()
    } catch (error) {
      readFailures.push(error)
      return null
    }
  }

  const ownedNow = readOrNull(() => collectImageOwnership(imageIds))
  const ownership = options.waitForOwnership && ownedNow ? await waitForImageOwnership(imageIds, ownedNow) : ownedNow

  // 等待期间归档可能新建了项目文件夹，这里取最新的树
  const collections = readOrNull(() => useAssetLibraryStore.getState().collections)
  const projectParams = readOrNull(() => useProjectTreeParamsStore.getState().params)
  const config = readOrNull(() => getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState()))
  if (readFailures.length > 0 || !ownership || !collections || !projectParams || !config) {
    return recordPostprocessPrepareCrash({
      batchId,
      source: options.source,
      taskId: options.taskId,
      error: readFailures[0] ?? new Error('准备阶段读取失败'),
    })
  }

  /**
   * 方向分组 → 剔掉在跑的 → 逐张认领。
   *
   * 三处顺序都是刻意的：
   * - **先判方向是否在跑，再认领**：同一方向已经有一条在飞时这次跳过（`PP-RUN-001`）。
   *   若反过来先认领再判，被跳过的那些图会白白占掉会话内幂等键，之后再触发就**再也产不出**
   *   它们了（而这个"丢了"完全不可见）。
   * - **认领后为空的组不建 run**：那是「这一组的图都已经产出过」的正常幂等命中，
   *   建一条只会产出 0 个文件的 run，还会在记录里留一句「没有产出任何文件」误导用户。
   * - 每一步都不含 await，于是「判定 → 建 run」仍在同一个同步段里，不存在抢到一半被别人插队。
   */
  const groups = new Map<string, string[]>()
  const skippedBusyIssues: PostprocessIssue[] = []
  for (const [directionId, ids] of groupImageIdsByTargetDirection({
    imageIds,
    ownership,
    source: options.source,
    config,
  })) {
    // 同一方向已经有在飞的一条 → 跳过这次：用户要的是「别的方向能同时用」，
    // 同一方向重复触发本来就是误操作，而且两条会争同一批输出目录与文件名序号。
    if (isDirectionPostprocessBusy(directionId)) {
      skippedBusyIssues.push(
        createPostprocessIssue({
          code: 'PP-RUN-001',
          stage: 'prepare',
          detail: `方向：${describeDirectionLabel(collections, directionId)}`,
        }),
      )
      continue
    }
    const claimable = options.claimImage ? ids.filter((id) => options.claimImage!(directionId, id)) : ids
    if (claimable.length > 0) groups.set(directionId, claimable)
  }
  if (groups.size === 0) {
    // 全被跳过 / 全已产出：也要把「为什么没跑」说清楚（否则界面只能报「没有产出」）。
    // 被跳过的方向**没有自己的 run**，所以留一条批次级记录让用户能查得到。
    if (skippedBusyIssues.length > 0) {
      recordBatchLevelPostprocessRun({
        batchId,
        source: options.source,
        taskId: options.taskId,
        directionLabel: '未开跑的方向',
        issues: skippedBusyIssues,
        producedFiles: 0,
      })
    }
    return { ...emptyPostprocessResult(), issues: skippedBusyIssues, warnings: issuesToWarnings(skippedBusyIssues) }
  }

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  // 并发上限在**派发那一刻**定死：跑到一半改设置，不该让同一次触发的各方向按不同上限排队
  const maxConcurrent = resolvePostprocessDirectionConcurrency()
  const createdAt = options.createdAt ?? Date.now()

  const readSource = async (imageId: string, index: number): Promise<TaskPostprocessSource | null> => {
    const rec = await getImage(imageId)
    const dataUrl = rec?.dataUrl || (await ensureImageCached(imageId))
    if (!dataUrl) return null
    let width = rec?.width ?? 0
    let height = rec?.height ?? 0
    if (!width || !height) {
      // 后处理要靠源图尺寸判方向、筛尺寸；记录里缺尺寸时从像素解一次
      try {
        const image = await loadImageOriented(dataUrl)
        width = getSourceWidth(image)
        height = getSourceHeight(image)
      } catch (error) {
        console.error('后处理源图尺寸解析失败', index, error)
        return null
      }
    }
    return { imageId, dataUrl, width, height }
  }

  /**
   * 跑一个方向。**永不抛错**：单点失败只变成这个方向的结果（别的方向照跑）。
   * 这也是「按方向独立运行」真正要买到的东西 —— 以前一个方向炸了，整批一起停。
   */
  const runDirection = async (directionId: string, ids: string[]): Promise<TaskPostprocessResult> => {
    const directionLabel = describeDirectionLabel(collections, directionId)

    const runId = `${options.source}-${directionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    useRuntimeStore.getState().startPostprocessRun({
      id: runId,
      source: options.source,
      taskId: options.taskId,
      totalImages: ids.length,
      batchId,
      directionId,
      directionLabel,
      // 先按「排队中」建：能不能立刻开工由下面抢名额决定（抢到就转进行中）。
      // 这样「点了之后界面上什么都没有」的空窗期不存在（排队也是一种明确状态）。
      queued: true,
    })

    /**
     * 登记取消句柄（TB-115）。**必须早于 `acquire`**：排队中的方向也要能取消 ——
     * 否则用户点了「取消」，界面还得挂着「排队中」几十秒（要等它拿到名额那一刻才发现自己该停），
     * 而这段时间里他不知道自己在等什么。
     */
    const signal = registerPostprocessCancel(directionId)

    let acquired = false
    try {
      /**
       * 先**同步**抢一次名额。
       *
       * 绝大多数情况下这一下就成了，于是「点下去 → 这条记录就是 running」与拆方向之前完全一致；
       * 若写成「无条件 await acquire」，状态会晚一个微任务才从 queued 变 running ——
       * 界面看不出差别，但「点下去就能查到在跑」这条契约就不再是同步成立的了。
       * 抢不到才进等待（`acquire` 内部会重试并注册唤醒）。
       */
      acquired = useRuntimeStore.getState().tryAdmitPostprocessDirection(directionId, maxConcurrent)
      if (!acquired) {
        // 排队等待期间也响应取消（TB-115）：`acquire` 里 race 了 abort 源，abort 立刻抛取消错误
        await acquirePostprocessDirection(directionId, maxConcurrent, signal)
        acquired = true
      }
      useRuntimeStore.getState().markPostprocessRunStarted(runId)

      const { runTaskPostprocess } = await import('./features/postprocess/taskPostprocess')
      const result = await runTaskPostprocess({
        // 手动触发没有任务，给一个占位 id：执行体只用它做日志与幂等键，不查任务表
        taskId: options.taskId ?? 'manual-postprocess',
        imageIds: ids,
        collections,
        projectParams,
        // 图片来源 → 所在方向：取素材归属里最深的一条，后处理据此自动取参数与输出目录
        resolveImageCollectionId: (imageId) => ownership.get(imageId) ?? null,
        alreadyProducedImageIds: options.alreadyProducedImageIds ?? [],
        // 只产这一个方向：其余目标各有自己的一条 run（键是产出目标方向，不是归属方向）
        onlyTargetCollectionIds: [directionId],
        // 分发推迟到批次收尾统一做一次（一次洗牌，同一素材跨渠道同一天）
        deferDistribution: true,
        createdAt,
        // 来源决定方向级「自动后处理」开关是否生效（手动跑不该被它拦）——见执行体的 `source` 注释
        source: options.source,
        // 取消信号（TB-115）：执行体在每个可中断点查它，已取消就抛专属的取消错误
        signal,
        readSource,
        // 进度上报：绝对值补丁，直接落到**这个方向**的运行记录上（界面订阅它显示「3/12」）
        onProgress: (patch) => useRuntimeStore.getState().updatePostprocessRun(runId, patch),
      })
      useRuntimeStore.getState().finishPostprocessRun(runId, {
        issues: result.issues,
        producedFiles: result.outputs.length,
        diagnostics: result.diagnostics,
      })
      // 收尾之后落一条方向级历史（TB-115）：实时进度归 runtimeStore（内存态），长期留档归
      // 历史 store（落盘）—— 同一份数据的两个生命周期，而不是两处各自记账
      recordDirectionPostprocessHistory({
        runId,
        targetDirectionIds: [directionId],
        outputDirs: result.outputDirs,
      })
      return result
    } catch (error) {
      /**
       * 取消**不是**崩溃（TB-115）：走专属码，也不往 console 打「后处理产出失败」。
       *
       * 不分开的话，用户点「取消」会得到一条 `PP-CRASH-001`（「出现未预期的错误，这一批没有跑完」）
       * —— 而他明明是主动停的，产物也好好地留在磁盘上。
       */
      const canceled = isPostprocessCanceledError(error)
      if (!canceled) console.error('后处理产出失败', directionId, error)
      const issues = [
        canceled
          ? createPostprocessIssue({ code: POSTPROCESS_CANCEL_CODE, stage: 'finish' })
          : createPostprocessIssue({ code: 'PP-CRASH-001', stage: 'prepare', cause: messageOfError(error) }),
      ]
      // 产出数**沿用进度里已经写下的值**，不写 0：中断可能发生在已经写出若干文件之后
      // （某次 IPC 掉链子、目录授权被拒、用户按了取消），磁盘上产物是齐的，写 0 会让记录谎报
      // 「失败：没有产出文件」—— 又是一条「显示失败、实际成功」（2026-09-21 排查）。
      const interrupted = getPostprocessRun(runId)
      useRuntimeStore.getState().finishPostprocessRun(runId, {
        issues,
        producedFiles: interrupted?.producedFiles ?? 0,
      })
      // 中断（含取消）同样要留档：那一刻「已经产出的那几张在哪」正是用户最想知道的事，
      // 而目录只能从进度里累积的那份拿 —— 执行体是抛出去的，收尾结果根本没返回
      recordDirectionPostprocessHistory({ runId, targetDirectionIds: [directionId] })
      return { ...emptyPostprocessResult(), issues, warnings: issuesToWarnings(issues) }
    } finally {
      // 名额必须成对释放：漏掉会让别的方向**永远**排不上队，且只表现为「一直在排队」
      if (acquired) releasePostprocessDirection(directionId)
      // 取消句柄同样成对释放：漏掉会让**下一次**触发的「取消」打到一条已经跑完的 run 上
      // （用户点了毫无反应，其实按错了对象）。传 signal 是为了核对身份 ——
      // 同一方向连续两次触发时，先收尾的那一次不该把后一次的句柄删掉。
      releasePostprocessCancel(directionId, signal)
    }
  }

  // `map` 里的 `runDirection` 会同步执行到第一个 await —— N 条 run 记录在这一刻全部建好，
  // 所以「点下去 → 入口里立刻查到 N 条」这条契约与拆方向之前一模一样。
  const results = await Promise.all([...groups].map(([directionId, ids]) => runDirection(directionId, ids)))
  const merged = mergePostprocessResults(results)
  /**
   * 被跳过（同一方向在跑）的那些方向也要进结论，否则用户只看到「产出 N 个文件」，
   * 不知道有一批图根本没轮到。
   *
   * 同时单独留一条批次级记录：这些方向**没有自己的 run**（因为没开跑），
   * 而 toast 只显示第一条原因、3 秒就没 —— 那些没轮到的图需要一个能查得到的地方。
   */
  merged.issues.push(...skippedBusyIssues)
  if (skippedBusyIssues.length > 0) {
    recordBatchLevelPostprocessRun({
      batchId,
      source: options.source,
      taskId: options.taskId,
      directionLabel: '未开跑的方向',
      issues: skippedBusyIssues,
      producedFiles: 0,
    })
  }

  // 分发：跨方向合并成**一次**（合并键 = 生效分发配置，见 `mergePendingPostprocessDistribution`）。
  // 各方向各分发一次会把「同一张素材在各渠道目录落在同一天」这条性质打掉（TB-107，2026-09-23）。
  if (api) {
    const { distributePostprocessOutputs, mergePendingPostprocessDistribution } =
      await import('./features/postprocess/taskPostprocess')
    const distributionIssues = await distributePostprocessOutputs(
      api,
      mergePendingPostprocessDistribution(merged.pendingDistribution),
      merged.outputs,
      createdAt,
    )
    if (distributionIssues.length > 0) {
      merged.issues.push(...distributionIssues)
      recordBatchLevelPostprocessRun({
        batchId,
        source: options.source,
        taskId: options.taskId,
        directionLabel: '全部方向（分发）',
        issues: distributionIssues,
        producedFiles: merged.outputs.length,
      })
    }
  }

  return { ...merged, warnings: issuesToWarnings(merged.issues) }
}

function messageOfError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 手动对一批已有素材跑后处理。
 *
 * 存在的意义：自动触发只发生在「任务完成」那一刻，历史素材、以及当时还没启用后处理的老图
 * 再也拿不到变体。旧「后期处理工作区」的批量导出正是覆盖这条路径，退役它之前必须先补上。
 *
 * 与自动触发的两点不同：
 * - **不**剔除已产出的图：手动就是「再跑一次」的意思，重名由写盘的 `-2` 后缀兜底，不静默跳过；
 * - **不**等待归属：素材早已归档完毕，归属是即时可读的（等待窗口只为批次任务的异步归档存在）。
 *
 * **重入按方向判**（2026-09-23 起）：这里原先有一个按图片 id 的在飞集合，效果等于
 * 「有一批在跑就别再点」。现在由编排对**每个产出方向**逐条判：已在跑的那个方向记
 * `PP-RUN-001` 跳过（提示里说清去哪看进度），别的方向照跑 —— 所以这里不再需要任何全局闸，
 * 而那个全局闸正是「一个方向占了整个功能」的来源（按钮的 `loading` 直接等于 `disabled`）。
 */
export async function runManualPostprocess(imageIds: string[]): Promise<void> {
  const ids = [...new Set(imageIds.filter((id) => typeof id === 'string' && id.trim()))]
  if (ids.length === 0) {
    useStore.getState().showToast('请先选择要跑后处理的素材', 'error')
    return
  }

  // 开跑立刻给一条提示：后处理（读图 + 逐渠道渲染 + 体积压缩）可能持续几十秒，
  // 期间按钮会转圈，这条 toast 是「点击已生效」的第二重确认。
  useStore.getState().showToast(`开始跑后处理：${ids.length} 张素材`, 'info')

  try {
    const result = await executePostprocessImageIds(ids, { waitForOwnership: false, source: 'manual' })
    if (!result) {
      useStore.getState().showToast('后处理未启用：请先在项目树里勾选启用范围', 'error')
      return
    }
    reportPostprocessResult(result, { successPrefix: '手动后处理完成', source: 'manual' })
    // 素材侧亮「已使用」（TB-105）：手动跑没有任务记录可写，这行是它**唯一**的落库点 ——
    // 少了它，手动产出的图在素材库里永远显示成「没跑过」。
    if (result.outputs.length > 0) await markImagesPostprocessed(result.outputs.map((item) => item.rawImageId))
  } catch (error) {
    // 兜底：任何逃出编排的异常都要变成用户能看见的提示（调用方是 `void`，抛出去等于没发生）
    console.error('手动后处理失败', error)
    const message = error instanceof Error ? error.message : String(error)
    useStore.getState().showToast(`手动后处理失败：${message}`, 'error')
  }
}

async function saveAgentConversationToLocalFS(conversationId: string) {
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const conversation = useStore.getState().agentConversations.find((c) => c.id === conversationId)
  if (conversation) {
    try {
      const saved = await saveAgentConversationToLocal(conversationId, conversation)
      if (!saved) {
        useStore.getState().showToast('Agent 对话保存到本地失败', 'error')
      }
    } catch (err) {
      console.error('保存 Agent 对话到本地失败:', err)
      useStore.getState().showToast('Agent 对话保存到本地失败', 'error')
    }
  }
}

export interface ThumbnailResult {
  dataUrl: string
  width?: number
  height?: number
}

/**
 * 网格磁贴（图库 / 素材库 / Agent 网格 / 文件夹封面）统一使用的缩略图通道。
 * grid 小图最长边 512px（见 `db.ts` 的 GRID_THUMBNAIL_MAX_SIZE），实测读取量约为 full 的 1/3
 * （full 均值 79.9KB → grid 26.7KB），解码位图内存约 1/4，内存缓存可多放约 3 倍张数。
 * 查看器、详情面板、任务卡封面等需要看清细节或原图分辨率的位置保持默认的 `'full'`（1024px）。
 */
export const GRID_THUMBNAIL_VARIANT: ThumbnailVariant = 'grid'

/**
 * 缩略图内存缓存键：`${id}:${variant}`。
 * full（详情大图 1024px）与 grid（网格小图 512px）必须分开分键，
 * 否则大图会顶掉小图、网格磁贴读到的仍是大图。
 */
function thumbnailKey(id: string, variant: ThumbnailVariant): string {
  return `${id}:${variant}`
}

export function getCachedThumbnail(id: string, variant: ThumbnailVariant = 'full') {
  const key = thumbnailKey(id, variant)
  const thumbnail = thumbnailCache.get(key)
  if (thumbnail?.thumbnailVersion === CURRENT_THUMBNAIL_VERSION) {
    return thumbnail
  }
  if (thumbnail) {
    thumbnailCache.delete(key)
  }
  return undefined
}

function cacheThumbnail(
  id: string,
  thumbnail: { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number },
  variant: ThumbnailVariant = 'full',
) {
  if (thumbnail.thumbnailVersion !== CURRENT_THUMBNAIL_VERSION) return
  thumbnailCache.set(thumbnailKey(id, variant), thumbnail, thumbnail.dataUrl.length * 2)
}

/** 清掉一张图两个通道的内存缓存（图片被删除 / 内容重算后的统一入口）。 */
function clearCachedThumbnail(id: string) {
  thumbnailCache.delete(thumbnailKey(id, 'full'))
  thumbnailCache.delete(thumbnailKey(id, 'grid'))
}

// 同一图片并发加载去重：快速划过网格 / 多个组件同时请求同一 imageId 时，
// 只发一次 IndexedDB 读取，避免重复读取多 MB 的 dataUrl 记录造成卡顿。
const imageLoadPromises = new Map<string, Promise<string | undefined>>()

// 缩略图读取去重（键 `${id}:${variant}`）：虚拟列表快速滚动时新挂载的卡片会并发请求同一批缩略图，
// 这里合并为一次读取，避免一帧内开几十个 IPC/IndexedDB 事务。
const thumbnailLoadPromises = new Map<string, Promise<ThumbnailResult | undefined>>()

export function ensureImageCached(id: string): Promise<string | undefined> {
  const cached = getCachedImage(id)
  if (cached) return Promise.resolve(cached)
  const inFlight = imageLoadPromises.get(id)
  if (inFlight) return inFlight
  const promise = loadAndCacheImage(id).finally(() => {
    imageLoadPromises.delete(id)
  })
  imageLoadPromises.set(id, promise)
  return promise
}

async function loadAndCacheImage(id: string): Promise<string | undefined> {
  let rec = await getImage(id)
  // 兜底：IndexedDB 缺图时，从主进程 SQLite 目录恢复 localPath（Electron）。
  if (!rec?.dataUrl && !rec?.localPath) {
    const recovered = await resolveImageFromCatalog(id)
    if (recovered) rec = recovered
  }
  if (rec) {
    if (!rec.dataUrl && rec.localPath && isElectronEnv()) {
      try {
        const fileResult = await readFileBuffer(rec.localPath)
        if (fileResult) {
          const mime = fileResult.name.endsWith('webp')
            ? 'image/webp'
            : fileResult.name.endsWith('jpg') || fileResult.name.endsWith('jpeg')
              ? 'image/jpeg'
              : 'image/png'
          const blob = new Blob([fileResult.data], { type: mime })
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          cacheImage(id, dataUrl)
          return dataUrl
        }
      } catch (err) {
        console.error('Failed to read image from localPath', rec.localPath, err)
      }
    } else if (rec.dataUrl) {
      cacheImage(id, rec.dataUrl)
      return rec.dataUrl
    }
  }
  return undefined
}

// 显示地址解析去重：同一张图可能被 Lightbox 与网格悬停同时请求。
const imageDisplaySrcPromises = new Map<string, Promise<string | undefined>>()

/**
 * 展示用原图地址。
 *
 * Electron 下优先返回本地图片协议 URL（`tangbao://image/`），让 Chromium 直接从磁盘
 * 流式读取并在解码线程池出图，省掉 `fs:read-file-buffer` 的结构化克隆、Blob 拷贝、
 * `FileReader.readAsDataURL` 的 base64 编码以及 `<img>` 侧的解码回字节——一张 5MB 原图
 * 从约 30MB 内存流量降到约 10MB，且不再占用渲染主线程。
 *
 * 浏览器环境、缺少 localPath、或路径不在协议服务范围（库根 cache-images/thumbs）内时，
 * 一律回退到 `ensureImageCached` 的 dataUrl，行为与改动前完全一致。
 * 调用方仍需在 `<img onError>` 上兜底：文件可能被外部删除，此时协议会 404。
 */
export function resolveImageDisplaySrc(id: string): Promise<string | undefined> {
  const cached = getCachedImage(id)
  if (cached) return Promise.resolve(cached)
  const inFlight = imageDisplaySrcPromises.get(id)
  if (inFlight) return inFlight
  const promise = loadImageDisplaySrc(id).finally(() => {
    imageDisplaySrcPromises.delete(id)
  })
  imageDisplaySrcPromises.set(id, promise)
  return promise
}

async function loadImageDisplaySrc(id: string): Promise<string | undefined> {
  let rec = await getImage(id)
  // 兜底：IndexedDB 缺图时从主进程目录恢复 localPath（与 loadAndCacheImage 同口径）。
  if (!rec?.dataUrl && !rec?.localPath) {
    const recovered = await resolveImageFromCatalog(id)
    if (recovered) rec = recovered
  }
  // 已有 dataUrl 说明磁盘副本未必存在，走原路径更稳；只有「纯 localPath」才用协议直出。
  if (rec?.localPath && !rec.dataUrl) {
    const url = buildLocalImageUrl(rec.localPath)
    if (url) return url
  }
  return ensureImageCached(id)
}

/**
 * 取缩略图（带内存缓存 + 滚动闸门 + 并发去重）。
 * `variant` 决定通道：网格磁贴传 `'grid'`（512px 小图），查看器/详情面板用默认 `'full'`（1024px）。
 */
export function ensureImageThumbnailCached(
  id: string,
  backfillPriority: 'visible' | 'background' = 'visible',
  variant: ThumbnailVariant = 'full',
): Promise<ThumbnailResult | undefined> {
  const key = thumbnailKey(id, variant)
  const cached = getCachedThumbnail(id, variant)
  if (cached) return Promise.resolve(cached)

  const inFlight = thumbnailLoadPromises.get(key)
  if (inFlight) return inFlight

  // 滚动闸门：滚动中挂起缩略图加载（任务卡封面 / Agent 网格 / 收藏夹等全部消费方共享），
  // 滚动停止后按可见优先补齐——避免滚动帧内开几十个 IPC/IDB 事务与离屏解码。
  if (isScrollActive(THUMBNAIL_DEFER_WINDOW_MS)) {
    const priority = thumbnailSubscribers.has(key) ? 'visible' : backfillPriority
    // Map 重新插入可把刚进入视口的图片放到同优先级队尾；离屏卡片卸载时会取消该项，
    // 因此停滚后不会先处理快速划过时遗留的大批废弃请求。
    pendingThumbnailIds.delete(key)
    pendingThumbnailIds.set(key, { id, variant, priority })
    return new Promise((resolve) => {
      let waiters = thumbnailWaiters.get(key)
      if (!waiters) {
        waiters = new Set()
        thumbnailWaiters.set(key, waiters)
      }
      waiters.add(resolve)
      scheduleThumbnailDrain(priority === 'visible' ? 100 : THUMBNAIL_DEFER_WINDOW_MS)
    })
  }
  return startThumbnailLoad(id, backfillPriority, variant)
}

/**
 * grid 未命中时的 full 回退来源：内存缓存 → 磁盘 → IndexedDB（Electron 命中当前版本时懒迁移写盘）。
 * 先查内存是有意的：页面级预取往往已经把 full 读进内存，这一步能省掉一次磁盘往返。
 * `fromDisk` 表示记录来自压缩后的 WebP 文件（宽高是缩略图自身尺寸，需要从图片记录补原图尺寸）。
 */
async function loadFullThumbnailFallback(id: string): Promise<{ rec?: StoredImageThumbnail; fromDisk: boolean }> {
  const cached = getCachedThumbnail(id, 'full')
  if (cached) {
    return {
      rec: {
        id,
        thumbnailDataUrl: cached.dataUrl,
        width: cached.width,
        height: cached.height,
        thumbnailVersion: cached.thumbnailVersion,
      },
      fromDisk: false,
    }
  }
  const disk = isElectronEnv() ? await getFreshThumbnailFromDisk(id, 'full') : undefined
  if (disk?.thumbnailDataUrl) return { rec: disk, fromDisk: true }

  const stored = await getStoredImageThumbnail(id)
  // 守卫：只有当前版本才写盘——旧版本缩略图不能以"当前版本"标签落盘（会顶替版本升级后的重建）
  if (stored?.thumbnailDataUrl && stored.thumbnailVersion === CURRENT_THUMBNAIL_VERSION && isElectronEnv()) {
    void writeThumbnailToDisk(id, CURRENT_THUMBNAIL_VERSION, stored.thumbnailDataUrl).catch(() => {})
  }
  return { rec: stored, fromDisk: false }
}

function startThumbnailLoad(
  id: string,
  backfillPriority: 'visible' | 'background' = 'visible',
  variant: ThumbnailVariant = 'full',
): Promise<ThumbnailResult | undefined> {
  const key = thumbnailKey(id, variant)
  const promise = (async () => {
    const cached = getCachedThumbnail(id, variant)
    if (cached) return cached

    // ① 目标通道的磁盘文件（库根 thumbs/）：full 与 grid 各自命名空间，命中直接返回
    let rec: StoredImageThumbnail | undefined = isElectronEnv()
      ? await getFreshThumbnailFromDisk(id, variant)
      : undefined
    let fromDisk = Boolean(rec?.thumbnailDataUrl)
    // 记录是否真的属于目标通道：grid 回退到 full 时不能把大图塞进 grid 的内存缓存，
    // 否则网格磁贴会被 1024px 大图长期占位，grid 通道白接通。
    const matchedTargetChannel = fromDisk

    // ② grid 未命中：先挂后台回填任务补出小图，再照旧用 full 兜底（观感与改动前一致）。
    //    存量图库的 grid 就是靠这条路径逐步补齐的，不必等 THUMBNAIL_VERSION 升级。
    //    silent=true：订阅方当前已有图可显示，回填完成只入缓存/落盘，不推送，避免同一张图二次换 src 闪烁。
    if (!rec?.thumbnailDataUrl && variant === 'grid') {
      scheduleThumbnailBackfill([{ id, variant, priority: backfillPriority, silent: true }])
      const fallback = await loadFullThumbnailFallback(id)
      rec = fallback.rec
      fromDisk = fallback.fromDisk
    }

    // ③ full 通道（或 grid 的兜底）：磁盘 → IndexedDB
    if (!rec?.thumbnailDataUrl && variant === 'full') {
      rec = await getStoredImageThumbnail(id)
      fromDisk = false
      // 守卫：只有当前版本才写盘——旧版本缩略图不能以"当前版本"标签落盘（会顶替版本升级后的重建）
      if (rec?.thumbnailDataUrl && rec.thumbnailVersion === CURRENT_THUMBNAIL_VERSION && isElectronEnv()) {
        void writeThumbnailToDisk(id, CURRENT_THUMBNAIL_VERSION, rec.thumbnailDataUrl).catch((error) => {
          // 同上：可接受降级，只留痕不上报
          console.warn('[store] 缩略图落盘失败：', error)
        })
      }
    }

    // ④ 两处都没有：交给既有回填链路（会从原图现场生成）。
    //    grid 在 ② 已排过一次 silent 任务；这里再排一次以把 silent 降为 false——
    //    没有任何图可显示时，回填完成必须推送给订阅方，否则卡片会一直停在占位。
    if (!rec?.thumbnailDataUrl) {
      scheduleThumbnailBackfill([{ id, variant, priority: backfillPriority, silent: false }])
      return undefined
    }

    let width = rec.width
    let height = rec.height
    // 磁盘缩略图（thumbs/）是压缩后的 WebP，解析出的 width/height 是缩略图自身尺寸
    // （最长边 ≤1024px），不是原图尺寸；从图片记录补齐原图尺寸，
    // 保证任务卡封面徽章等处的比例/分辨率显示原图实际值（浏览器端 IndexedDB 记录保存的是原图尺寸，无需补齐）。
    if (fromDisk) {
      try {
        const image = await getImage(id)
        if (image?.width && image?.height) {
          width = image.width
          height = image.height
        }
      } catch {
        // 图片记录读取失败时保留缩略图尺寸兜底
      }
    }

    const thumbnail = {
      dataUrl: rec.thumbnailDataUrl,
      width,
      height,
      thumbnailVersion: rec.thumbnailVersion,
    }
    if (thumbnail.thumbnailVersion !== CURRENT_THUMBNAIL_VERSION) {
      scheduleThumbnailBackfill([{ id, variant, priority: 'background', silent: false }])
      return thumbnail
    }

    cacheThumbnail(id, thumbnail, matchedTargetChannel ? variant : 'full')
    return thumbnail
  })().finally(() => {
    thumbnailLoadPromises.delete(key)
  })
  thumbnailLoadPromises.set(key, promise)
  return promise
}

// 缩略图滚动延迟队列：full 与 grid 共用同一条队列（键 `${id}:${variant}`），
// 滚动停止后按可见优先补齐。
const THUMBNAIL_DEFER_WINDOW_MS = 300
const THUMBNAIL_DRAIN_BATCH = 8
/** 待读取请求：id + 通道 + 优先级，避免从缓存键里反解。 */
interface ThumbnailRequest {
  id: string
  variant: ThumbnailVariant
  priority: 'visible' | 'background'
}
const pendingThumbnailIds = new Map<string, ThumbnailRequest>()
const thumbnailWaiters = new Map<string, Set<(thumbnail: ThumbnailResult | undefined) => void>>()
let thumbnailDrainScheduled = false
/** 离屏预取窗口：键 → 请求（Map 保序，便于「保留最新窗口」）。 */
const aheadThumbnailIds = new Map<string, { id: string; variant: ThumbnailVariant }>()
let aheadThumbnailRunning = 0
let aheadThumbnailDrainScheduled = false
const MAX_AHEAD_THUMBNAIL_CONCURRENT = 3

function resolveThumbnailWaiters(key: string, thumbnail: ThumbnailResult | undefined) {
  const waiters = thumbnailWaiters.get(key)
  if (!waiters) return
  thumbnailWaiters.delete(key)
  for (const resolve of waiters) resolve(thumbnail)
}

function scheduleThumbnailDrain(delay = THUMBNAIL_DEFER_WINDOW_MS) {
  if (thumbnailDrainScheduled) return
  thumbnailDrainScheduled = true
  setTimeout(() => {
    thumbnailDrainScheduled = false
    void runThumbnailDrain()
  }, delay)
}

async function runThumbnailDrain() {
  if (pendingThumbnailIds.size === 0) return
  const scrolling = isScrollActive(THUMBNAIL_DEFER_WINDOW_MS)
  const visible: ThumbnailRequest[] = []
  const background: ThumbnailRequest[] = []
  for (const request of pendingThumbnailIds.values()) {
    if (request.priority === 'visible') visible.push(request)
    else background.push(request)
  }
  // 滚动中只读取少量当前可见图，保持画面跟手；离屏预取继续由 ahead 队列负责。
  const requests = (scrolling ? visible.slice(0, 2) : [...visible, ...background]).slice(0, THUMBNAIL_DRAIN_BATCH)
  if (requests.length === 0) {
    scheduleThumbnailDrain()
    return
  }
  for (const request of requests) pendingThumbnailIds.delete(thumbnailKey(request.id, request.variant))
  await Promise.allSettled(
    requests.map(async (request) => {
      const result = await startThumbnailLoad(request.id, request.priority, request.variant)
      resolveThumbnailWaiters(thumbnailKey(request.id, request.variant), result)
    }),
  )
  // 已经停滚时连续排空小批次；滚动中保持短间隔，只补当前可见图。
  if (pendingThumbnailIds.size > 0) scheduleThumbnailDrain(scrolling ? 100 : 0)
}

// 缩略图批量预取：分页加载（如素材库每批 120 张）落地后提前把缩略图读入内存缓存，
// 卡片真正挂载时 getCachedThumbnail 同步命中，避免「灰底占位 → 图片」的闪烁。
// 分批串行（每批默认 12 张），避免一次性打开大量 IndexedDB 事务。
const THUMBNAIL_PREFETCH_BATCH_SIZE = 12

function scheduleAheadThumbnailDrain() {
  if (aheadThumbnailDrainScheduled || aheadThumbnailIds.size === 0) return
  aheadThumbnailDrainScheduled = true
  const run = () => {
    aheadThumbnailDrainScheduled = false
    while (aheadThumbnailRunning < MAX_AHEAD_THUMBNAIL_CONCURRENT && aheadThumbnailIds.size > 0) {
      const entry = aheadThumbnailIds.values().next().value as { id: string; variant: ThumbnailVariant } | undefined
      if (!entry) break
      const key = thumbnailKey(entry.id, entry.variant)
      aheadThumbnailIds.delete(key)
      if (getCachedThumbnail(entry.id, entry.variant) || thumbnailLoadPromises.has(key)) continue
      pendingThumbnailIds.delete(key)
      aheadThumbnailRunning++
      void startThumbnailLoad(entry.id, 'visible', entry.variant)
        .then((result) => resolveThumbnailWaiters(key, result))
        .catch(() => resolveThumbnailWaiters(key, undefined))
        .finally(() => {
          aheadThumbnailRunning--
          scheduleAheadThumbnailDrain()
        })
    }
  }

  if ('requestIdleCallback' in globalThis) {
    globalThis.requestIdleCallback(run, { timeout: 250 })
  } else {
    globalThis.setTimeout(run, 0)
  }
}

/**
 * 缩略图批量预取：分页加载（如素材库每批 120 张）落地后提前把缩略图读入内存缓存，
 * 卡片真正挂载时 getCachedThumbnail 同步命中，避免「灰底占位 → 图片」的闪烁。
 * `variant` 必须与真正渲染的消费方一致，否则预热的是另一条通道、磁贴仍要各读一次盘。
 */
export function prefetchImageThumbnails(
  imageIds: Iterable<string>,
  mode: 'background' | 'ahead' = 'background',
  variant: ThumbnailVariant = 'full',
): void {
  if (mode === 'ahead') {
    // 快速滚动时旧窗口没有继续预取的价值，保留最新窗口避免 FIFO 队列拖住当前视口。
    aheadThumbnailIds.clear()
    for (const id of imageIds) {
      const key = thumbnailKey(id, variant)
      if (!getCachedThumbnail(id, variant) && !thumbnailLoadPromises.has(key)) {
        aheadThumbnailIds.set(key, { id, variant })
      }
    }
    scheduleAheadThumbnailDrain()
    return
  }

  const pending: string[] = []
  for (const id of imageIds) {
    if (!getCachedThumbnail(id, variant)) pending.push(id)
  }
  if (pending.length === 0) return

  let index = 0
  const runBatch = () => {
    const batch = pending.slice(index, index + THUMBNAIL_PREFETCH_BATCH_SIZE)
    index += batch.length
    if (batch.length === 0) return
    void Promise.all(batch.map((id) => ensureImageThumbnailCached(id, 'background', variant))).then(() => {
      if (index < pending.length) {
        if ('requestIdleCallback' in globalThis) {
          globalThis.requestIdleCallback(runBatch, { timeout: 2_000 })
        } else {
          globalThis.setTimeout(runBatch, 0)
        }
      }
    })
  }
  runBatch()
}

/** 订阅某张图某条通道的缩略图更新；`variant` 必须与 `ensureImageThumbnailCached` 传的一致。 */
export function subscribeImageThumbnail(
  id: string,
  callback: (thumbnail: ThumbnailResult) => void,
  variant: ThumbnailVariant = 'full',
) {
  const key = thumbnailKey(id, variant)
  let subscribers = thumbnailSubscribers.get(key)
  if (!subscribers) {
    subscribers = new Set()
    thumbnailSubscribers.set(key, subscribers)
  }
  subscribers.add(callback)
  const pending = pendingThumbnailIds.get(key)
  if (pending) {
    pendingThumbnailIds.delete(key)
    pendingThumbnailIds.set(key, { ...pending, priority: 'visible' })
  }
  return () => {
    subscribers?.delete(callback)
    if (subscribers?.size === 0) {
      thumbnailSubscribers.delete(key)
      const current = pendingThumbnailIds.get(key)
      if (current?.priority === 'visible') {
        pendingThumbnailIds.delete(key)
        resolveThumbnailWaiters(key, undefined)
      }
    }
  }
}

function notifyImageThumbnail(id: string, thumbnail: ThumbnailResult, variant: ThumbnailVariant) {
  thumbnailSubscribers.get(thumbnailKey(id, variant))?.forEach((callback) => callback(thumbnail))
}

/** 回填任务：`silent` 表示订阅方当前已有可用图（full 兜底），完成后只入缓存不推送。 */
interface ThumbnailBackfillRequest {
  id: string
  variant: ThumbnailVariant
  priority: 'visible' | 'background'
  silent: boolean
}

function scheduleThumbnailBackfill(requests: ThumbnailBackfillRequest[]) {
  for (const request of requests) {
    const key = thumbnailKey(request.id, request.variant)
    if (getCachedThumbnail(request.id, request.variant) || thumbnailBackfillRunningIds.has(key)) continue
    const current = thumbnailBackfillIds.get(key)
    if (!current) {
      thumbnailBackfillIds.set(key, request)
      continue
    }
    thumbnailBackfillIds.set(key, {
      ...current,
      priority: request.priority === 'visible' ? 'visible' : current.priority,
      // 只要出现过一次「当前无图可显示」，回填完成就必须推送，否则卡片会一直停在占位。
      silent: current.silent && request.silent,
    })
  }
  scheduleThumbnailBackfillTick()
}

function scheduleThumbnailBackfillTick() {
  if (thumbnailBackfillScheduled || thumbnailBackfillIds.size === 0) return
  thumbnailBackfillScheduled = true

  const run = () => {
    thumbnailBackfillScheduled = false
    void processNextThumbnailBackfill()
  }

  if ('requestIdleCallback' in globalThis) {
    globalThis.requestIdleCallback(run, { timeout: 2_000 })
  } else {
    globalThis.setTimeout(run, 250)
  }
}

async function processNextThumbnailBackfill() {
  if (thumbnailBackfillRunningIds.size > 0) return

  const requests = await getNextThumbnailBackfillBatch()
  for (const request of requests) startThumbnailBackfill(request)

  if (thumbnailBackfillIds.size > 0) scheduleThumbnailBackfillTick()
}

async function getNextThumbnailBackfillBatch() {
  const candidates = getOrderedThumbnailBackfillRequests().slice(0, MAX_THUMBNAIL_BACKFILL_CONCURRENT)
  if (candidates.length === 0) return []

  const sizes = await Promise.all(
    candidates.map(async ({ id }) => {
      const image = await getImage(id)
      return { width: image?.width, height: image?.height }
    }),
  )
  const concurrency = getThumbnailConcurrencyForBatch(sizes)
  const selected = candidates.slice(0, concurrency)
  for (const request of selected) thumbnailBackfillIds.delete(thumbnailKey(request.id, request.variant))
  return selected
}

function getOrderedThumbnailBackfillRequests(): ThumbnailBackfillRequest[] {
  const visible: ThumbnailBackfillRequest[] = []
  const background: ThumbnailBackfillRequest[] = []
  for (const request of thumbnailBackfillIds.values()) {
    if (request.priority === 'visible') visible.push(request)
    else background.push(request)
  }
  return [...visible, ...background]
}

function getThumbnailConcurrencyForBatch(sizes: Array<{ width?: number; height?: number }>) {
  let maxMegapixels = 0
  for (const { width, height } of sizes) {
    if (!width || !height) return 1
    maxMegapixels = Math.max(maxMegapixels, (width * height) / 1_000_000)
  }
  const megapixels = maxMegapixels
  if (megapixels >= 8) return 1
  if (megapixels >= 4) return 2
  if (megapixels >= 2) return 3
  return 4
}

function startThumbnailBackfill(request: ThumbnailBackfillRequest) {
  const { id, variant, silent } = request
  const key = thumbnailKey(id, variant)
  thumbnailBackfillRunningIds.add(key)

  void (async () => {
    if (getCachedThumbnail(id, variant)) return

    // 两条通道共用同一条 full 缩略图记录作源：grid 由它现出小图
    // （解码 1024px 小图比解码 2K/4K 原图便宜得多，且 full 的生成/LRU 逻辑不需要复制一份）。
    const source = await getImageThumbnail(id)
    if (!source?.thumbnailDataUrl) return

    let dataUrl = source.thumbnailDataUrl
    if (variant === 'grid') {
      const gridDataUrl = await buildGridThumbnail(id, source.thumbnailDataUrl)
      if (!gridDataUrl) return
      dataUrl = gridDataUrl
    }
    const thumbnail = {
      dataUrl,
      width: source.width,
      height: source.height,
      thumbnailVersion: CURRENT_THUMBNAIL_VERSION,
    }
    cacheThumbnail(id, thumbnail, variant)
    // silent：订阅方当前显示的是 full 兜底图，同一张图再换一次 src 会白闪一下，
    // 因此只入缓存/落盘，等下次挂载或缓存淘汰后自然用上小图。
    if (!silent) notifyImageThumbnail(id, thumbnail, variant)
  })()
    .catch(() => {
      // Keep thumbnail generation best-effort; cards remain on placeholders if it fails.
    })
    .finally(() => {
      thumbnailBackfillRunningIds.delete(key)
      scheduleThumbnailBackfillTick()
    })
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function isAgentTask(task: TaskRecord) {
  return task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
}

function isGalleryTask(task: TaskRecord) {
  return !isAgentTask(task)
}

function showTaskCompletionNotification(title: string, body: string) {
  const settings = normalizeSettings(useStore.getState().settings)
  if (!settings.taskCompletionNotification) return
  showBrowserNotification(title, { body })
}

function countSuccessfulOutputImages(tasks: TaskRecord[]) {
  return tasks.reduce(
    (count, task) => count + (task.status === 'done' && !isAgentTask(task) ? (task.outputImages?.length ?? 0) : 0),
    0,
  )
}

function skipSupportPromptForImportedData(tasks: TaskRecord[]) {
  const count = countSuccessfulOutputImages(tasks)
  useStore.setState((state) => {
    if (state.supportPromptDismissed) return {}
    if (count <= SUPPORT_PROMPT_IMAGE_THRESHOLD) {
      return { supportPromptSkippedForImportedData: false }
    }
    return { supportPromptSkippedForImportedData: true }
  })
}

function showSupportPromptForExistingLocalData(tasks: TaskRecord[]) {
  // 禁用赞助提示弹窗
  return
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeAgentRound(value: unknown, fallbackIndex: number): AgentRound | null {
  if (!value || typeof value !== 'object') return null
  const round = value as Partial<AgentRound>
  if (typeof round.id !== 'string' || !round.id) return null
  if (typeof round.userMessageId !== 'string' || !round.userMessageId) return null

  const status =
    round.status === 'running' ? 'error' : round.status === 'error' || round.status === 'done' ? round.status : 'done'

  return {
    id: round.id,
    index: typeof round.index === 'number' ? round.index : fallbackIndex + 1,
    parentRoundId: typeof round.parentRoundId === 'string' ? round.parentRoundId : null,
    userMessageId: round.userMessageId,
    ...(typeof round.assistantMessageId === 'string' ? { assistantMessageId: round.assistantMessageId } : {}),
    prompt: typeof round.prompt === 'string' ? round.prompt : '',
    inputImageIds: normalizeStringArray(round.inputImageIds),
    maskTargetImageId: typeof round.maskTargetImageId === 'string' ? round.maskTargetImageId : null,
    maskImageId: typeof round.maskImageId === 'string' ? round.maskImageId : null,
    outputTaskIds: normalizeStringArray(round.outputTaskIds),
    ...(typeof round.responseId === 'string' ? { responseId: round.responseId } : {}),
    ...(Array.isArray(round.responseOutput) ? { responseOutput: round.responseOutput } : {}),
    status,
    error: status === 'error' ? (typeof round.error === 'string' ? round.error : '上次请求已中断') : null,
    createdAt: typeof round.createdAt === 'number' ? round.createdAt : Date.now(),
    finishedAt: typeof round.finishedAt === 'number' ? round.finishedAt : null,
  }
}

function normalizeAgentMessage(value: unknown): AgentMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Partial<AgentMessage>
  if (typeof message.id !== 'string' || !message.id) return null
  if (message.role !== 'user' && message.role !== 'assistant') return null
  if (typeof message.roundId !== 'string' || !message.roundId) return null

  return {
    id: message.id,
    role: message.role,
    content: typeof message.content === 'string' ? message.content : '',
    roundId: message.roundId,
    ...(Array.isArray(message.inputImageIds) ? { inputImageIds: normalizeStringArray(message.inputImageIds) } : {}),
    maskTargetImageId: typeof message.maskTargetImageId === 'string' ? message.maskTargetImageId : null,
    maskImageId: typeof message.maskImageId === 'string' ? message.maskImageId : null,
    ...(Array.isArray(message.outputTaskIds) ? { outputTaskIds: normalizeStringArray(message.outputTaskIds) } : {}),
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
  }
}

function normalizeAgentConversations(value: unknown): AgentConversation[] {
  if (!Array.isArray(value)) return []

  const normalized = value
    .filter(
      (item): item is AgentConversation =>
        Boolean(item) && typeof item === 'object' && typeof (item as AgentConversation).id === 'string',
    )
    .map((conversation, index) => {
      const normalizedRounds = Array.isArray(conversation.rounds)
        ? conversation.rounds.map(normalizeAgentRound).filter((round): round is AgentRound => Boolean(round))
        : []
      const hasBranchParents = normalizedRounds.some((round) => round.parentRoundId)
      const hasStoredActiveRound = typeof conversation.activeRoundId === 'string'
      const rounds =
        hasBranchParents || hasStoredActiveRound
          ? normalizedRounds
          : normalizedRounds.map((round, index) => ({
              ...round,
              parentRoundId: index > 0 ? normalizedRounds[index - 1].id : null,
            }))
      const roundIds = new Set(rounds.map((round) => round.id))
      const messages = Array.isArray(conversation.messages)
        ? conversation.messages
            .map(normalizeAgentMessage)
            .filter((message): message is AgentMessage => message != null && roundIds.has(message.roundId))
        : []
      return {
        id: conversation.id,
        title: typeof conversation.title === 'string' && conversation.title.trim() ? conversation.title : '新对话',
        order:
          typeof conversation.order === 'number' && Number.isFinite(conversation.order) ? conversation.order : index,
        activeRoundId:
          typeof conversation.activeRoundId === 'string' && roundIds.has(conversation.activeRoundId)
            ? conversation.activeRoundId
            : (rounds[rounds.length - 1]?.id ?? null),
        createdAt: typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now(),
        updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : Date.now(),
        rounds,
        messages,
      }
    })

  const hasPersistedOrder = value.every(
    (item) => isRecord(item) && typeof item.order === 'number' && Number.isFinite(item.order),
  )
  return (
    hasPersistedOrder
      ? normalized.sort((a, b) => a.order - b.order)
      : normalized.sort((a, b) => b.updatedAt - a.updatedAt)
  ).map((conversation, index) => ({ ...conversation, order: index }))
}

function scheduleAgentRoundSummaryToLocalFS(conversationId: string, roundId: string) {
  if (!isElectronEnv()) return Promise.resolve()

  agentRoundSummarySaveQueue = agentRoundSummarySaveQueue
    .catch(() => {})
    .then(async () => {
      const localSavePath = await getLocalSavePath()
      if (!localSavePath) return
      const state = useStore.getState()
      const conversation = state.agentConversations.find((item) => item.id === conversationId)
      const round = conversation?.rounds.find((item) => item.id === roundId)
      if (!conversation || !round) return
      const saved = await saveAgentRoundSummaryToLocal(conversation, round, state.tasks)
      if (!saved) useStore.getState().showToast('Agent 任务汇总文档保存失败', 'error')
    })
    .catch((error) => {
      console.error('保存 Agent 任务汇总文档失败:', error)
      useStore.getState().showToast('Agent 任务汇总文档保存失败', 'error')
    })
  return agentRoundSummarySaveQueue
}

function mergeImportedAgentConversations(current: AgentConversation[], imported: AgentConversation[]) {
  const merged = [...current]
  const indexes = new Map(merged.map((conversation, index) => [conversation.id, index]))

  for (const conversation of imported) {
    const index = indexes.get(conversation.id)
    if (index == null) {
      indexes.set(conversation.id, merged.length)
      merged.push(conversation)
    } else {
      merged[index] = conversation
    }
  }

  return merged
}

function mergeAgentConversationsForStorage(stored: AgentConversation[], legacy: AgentConversation[]) {
  const merged = new Map<string, AgentConversation>()
  for (const conversation of stored) merged.set(conversation.id, conversation)
  for (const conversation of legacy) {
    const existing = merged.get(conversation.id)
    if (!existing || conversation.updatedAt >= existing.updatedAt) {
      merged.set(conversation.id, conversation)
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.order - b.order)
    .map((conversation, index) => ({ ...conversation, order: index }))
}

function getPersistableResponseOutputItem(item: ResponsesOutputItem): ResponsesOutputItem {
  if (item.type !== 'image_generation_call' || item.result == null) return item

  if (typeof item.result === 'string') {
    const { result: _result, ...rest } = item
    return rest
  }

  if (!isRecord(item.result)) return item
  const { b64_json: _b64Json, base64: _base64, image: _image, data: _data, ...restResult } = item.result
  if (Object.keys(restResult).length === 0) {
    const { result: _result, ...rest } = item
    return rest
  }

  return { ...item, result: restResult }
}

function getPersistableAgentConversations(conversations: AgentConversation[]): AgentConversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) =>
      round.responseOutput?.length
        ? {
            ...round,
            responseOutput: round.responseOutput.map(getPersistableResponseOutputItem),
          }
        : round,
    ),
  }))
}

function stripPersistedAgentConversations(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((conversation) => {
    if (!isRecord(conversation) || !Array.isArray(conversation.rounds)) return conversation
    return {
      ...conversation,
      rounds: conversation.rounds.map((round) => {
        if (!isRecord(round) || !Array.isArray(round.responseOutput)) return round
        return {
          ...round,
          responseOutput: round.responseOutput.map((item) =>
            isRecord(item) ? getPersistableResponseOutputItem(item as ResponsesOutputItem) : item,
          ),
        }
      }),
    }
  })
}

export function migratePersistedState(persistedState: unknown, version?: number): unknown {
  if (!isRecord(persistedState)) return persistedState
  const migrated: Record<string, unknown> = {
    ...persistedState,
    agentConversations: stripPersistedAgentConversations(persistedState.agentConversations),
  }
  // v5：移除皮肤（换肤）字段（docs/adr/0008）。旧存档里的 skinId / colorScheme 一律丢弃，
  // 因为颜色已收敛为「一套 Token × 明暗两态」，保留这两个字段只会让人误以为还能换肤。
  if (isRecord(persistedState.settings)) {
    const settings = persistedState.settings as Record<string, unknown>
    if (settings.skinId !== undefined || settings.colorScheme !== undefined) {
      const { skinId: _skinId, colorScheme: _colorScheme, ...rest } = settings
      migrated.settings = rest
    }
  }
  // Migrate old data without workspaceTabs or with empty workspaceTabs: create a default tab from galleryInputDraft or current input state
  const hasWorkspaceTabsField = Array.isArray((persistedState as Record<string, unknown>).workspaceTabs)
  const hasValidWorkspaceTabs =
    hasWorkspaceTabsField && ((persistedState as Record<string, unknown>).workspaceTabs as unknown[]).length > 0
  if (!hasValidWorkspaceTabs) {
    const galleryDraft = isRecord(persistedState.galleryInputDraft) ? persistedState.galleryInputDraft : null
    const prompt =
      typeof persistedState.prompt === 'string'
        ? persistedState.prompt
        : galleryDraft && typeof galleryDraft.prompt === 'string'
          ? galleryDraft.prompt
          : ''
    const inputImages = Array.isArray(persistedState.inputImages)
      ? persistedState.inputImages
      : galleryDraft && Array.isArray(galleryDraft.inputImages)
        ? galleryDraft.inputImages
        : []
    const inputImageFolder =
      isRecord(galleryDraft?.inputImageFolder) &&
      typeof galleryDraft.inputImageFolder.path === 'string' &&
      Array.isArray(galleryDraft.inputImageFolder.imageIds)
        ? {
            path: galleryDraft.inputImageFolder.path,
            imageIds: galleryDraft.inputImageFolder.imageIds.filter(
              (id: unknown): id is string => typeof id === 'string',
            ),
          }
        : null
    const params = isRecord(persistedState.params)
      ? persistedState.params
      : isRecord(galleryDraft?.params)
        ? galleryDraft.params
        : {}
    const now = Date.now()
    const defaultTab: WorkspaceTab = {
      id: Math.random().toString(36).slice(2, 9),
      name: '默认',
      groupId: null,
      prompt: String(prompt),
      inputImages: normalizeInputImages(inputImages),
      inputImageFolder,
      params: { ...DEFAULT_PARAMS, ...(isRecord(params) ? params : {}) },
      maskDraft: normalizeMaskDraft(galleryDraft?.maskDraft ?? persistedState.maskDraft),
      maskEditorImageId: typeof persistedState.maskEditorImageId === 'string' ? persistedState.maskEditorImageId : null,
      customOutputPath: typeof persistedState.customOutputPath === 'string' ? persistedState.customOutputPath : '',
      tasks: [],
      createdAt: now,
      updatedAt: now,
      order: 0,
    }
    migrated.workspaceTabs = [defaultTab]
    migrated.activeWorkspaceTabId = defaultTab.id
    migrated.workspaceTabGroups = []
  }
  return migrated
}

function normalizeFavoriteCollectionName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function createDefaultFavoriteCollection(now = Date.now()): FavoriteCollection {
  return {
    id: DEFAULT_FAVORITE_COLLECTION_ID,
    name: DEFAULT_FAVORITE_COLLECTION_NAME,
    createdAt: now,
    updatedAt: now,
  }
}

function createDefaultScheduleState(now = new Date()): ScheduleState {
  return {
    rows: createDefaultScheduleRows(),
    items: [],
    activeWeekStart: formatDateKey(getWeekStartDate(now)),
    modalOpen: false,
    runningWeekStarts: [],
  }
}

function addScheduleDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

function formatFavoriteOutputDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function applyFavoriteOutputDateVariable(path: string | undefined, enabled: boolean): string {
  const value = path ?? ''
  if (enabled) return value.replace(/(?:19|20)\d{6}/, '{date}')
  return value.replace(/\{date\}/gi, formatFavoriteOutputDate())
}

function normalizeScheduleState(value: unknown, fallback = createDefaultScheduleState()): ScheduleState {
  if (!isRecord(value)) return fallback
  const legacyRunningWeekStart =
    typeof value.runningDate === 'string' ? formatDateKey(getWeekStartDate(parseDateKey(value.runningDate))) : null
  const runningWeekStarts = Array.isArray(value.runningWeekStarts)
    ? Array.from(
        new Set(value.runningWeekStarts.filter((weekStart): weekStart is string => typeof weekStart === 'string')),
      )
    : legacyRunningWeekStart
      ? [legacyRunningWeekStart]
      : fallback.runningWeekStarts
  const rows = Array.isArray(value.rows)
    ? value.rows
        .filter((row): row is Record<string, unknown> => isRecord(row) && typeof row.id === 'string')
        .map((row, index) => ({
          id: String(row.id),
          name: typeof row.name === 'string' && row.name.trim() ? row.name : `任务 ${index + 1}`,
          order: typeof row.order === 'number' ? row.order : index,
        }))
    : fallback.rows
  const items = Array.isArray(value.items)
    ? value.items
        .filter(
          (item): item is Record<string, unknown> =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.taskId === 'string' &&
            typeof item.date === 'string' &&
            typeof item.rowId === 'string',
        )
        .map((item, index): ScheduleItem => ({
          id: String(item.id),
          taskId: String(item.taskId),
          collectionId: typeof item.collectionId === 'string' ? item.collectionId : null,
          date: String(item.date),
          rowId: String(item.rowId),
          order: typeof item.order === 'number' ? item.order : index,
          count: Math.max(1, typeof item.count === 'number' ? Math.floor(item.count) : 1),
          time: typeof item.time === 'string' && item.time.trim() ? item.time : null,
          lastRunKey: typeof item.lastRunKey === 'string' ? item.lastRunKey : undefined,
          status:
            item.status === 'queued' ||
            item.status === 'running' ||
            item.status === 'done' ||
            item.status === 'error' ||
            item.status === 'idle'
              ? item.status
              : undefined,
          lastTaskIds: Array.isArray(item.lastTaskIds)
            ? item.lastTaskIds.filter((id): id is string => typeof id === 'string')
            : undefined,
          lastError: typeof item.lastError === 'string' ? item.lastError : undefined,
        }))
    : fallback.items
  return {
    rows: rows.length ? rows : fallback.rows,
    items,
    activeWeekStart: typeof value.activeWeekStart === 'string' ? value.activeWeekStart : fallback.activeWeekStart,
    modalOpen: Boolean(value.modalOpen),
    runningWeekStarts,
  }
}

function normalizeFavoriteCollections(value: unknown): FavoriteCollection[] {
  const now = Date.now()
  const collections = Array.isArray(value) ? value : []
  const normalized: FavoriteCollection[] = []
  const ids = new Set<string>()
  for (const item of collections) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    const id = item.id
    if (id === ALL_FAVORITES_COLLECTION_ID || ids.has(id)) continue
    const name = normalizeFavoriteCollectionName(typeof item.name === 'string' ? item.name : '')
    if (!name) continue
    ids.add(id)
    normalized.push({
      id,
      name: name.slice(0, 60),
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
    })
  }
  return normalized
}

function ensureDefaultFavoriteCollection(collections: FavoriteCollection[]) {
  if (collections.some((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID)) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

/** 确保"默认"收藏夹存在（用于兜底孤立收藏任务） */
function ensureDefaultNamedCollection(collections: FavoriteCollection[]) {
  if (getDefaultNamedFavoriteCollectionId(collections)) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

function getDefaultNamedFavoriteCollectionId(collections: FavoriteCollection[]) {
  return (
    collections.find((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID)?.id ??
    collections.find((collection) => collection.name === DEFAULT_FAVORITE_COLLECTION_NAME)?.id ??
    null
  )
}

function resolveDefaultFavoriteCollectionId(collections: FavoriteCollection[], preferredId: unknown) {
  if (preferredId === null) return null
  if (typeof preferredId === 'string' && collections.some((collection) => collection.id === preferredId))
    return preferredId
  if (collections.some((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID))
    return DEFAULT_FAVORITE_COLLECTION_ID
  return collections[0]?.id ?? null
}

function createAgentConversation(now = Date.now()): AgentConversation {
  return {
    id: genId(),
    title: '新对话',
    order: 0,
    activeRoundId: null,
    createdAt: now,
    updatedAt: now,
    rounds: [],
    messages: [],
  }
}

function createAgentConversationTitle(prompt: string, fallbackTitle: string) {
  const title = prompt.replace(/\s+/g, ' ').trim()
  if (!title) return fallbackTitle
  const chars = Array.from(title)
  if (chars.length <= AGENT_CONVERSATION_TITLE_MAX_LENGTH) return title
  return `${chars.slice(0, AGENT_CONVERSATION_TITLE_MAX_LENGTH - 3).join('')}...`
}

function isEmptyAgentConversation(conversation: AgentConversation) {
  return conversation.rounds.length === 0 && conversation.messages.length === 0 && !conversation.activeRoundId
}

function getLatestAgentConversation(conversations: AgentConversation[]) {
  return conversations.reduce<AgentConversation | null>((latest, conversation) => {
    if (!latest) return conversation
    if (conversation.updatedAt !== latest.updatedAt)
      return conversation.updatedAt > latest.updatedAt ? conversation : latest
    return conversation.createdAt > latest.createdAt ? conversation : latest
  }, null)
}

let secureApiSecretsAvailable = false
let pendingApiSecrets: ApiSecretBundle | null = null
let apiSecretsPersistTimer: ReturnType<typeof setTimeout> | null = null
let apiSecretsPersisting = false

function notifyApiSecretsPersistError() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('tangbao:persist-error', { detail: { namespace: 'apiSecrets' } }))
}

/**
 * 系统密钥库不可用（`safeStorage.isEncryptionAvailable() === false`）。
 *
 * 与 `apiSecrets`（写入失败、会自动重试）不同：这种情况**读不回来也写不下去**，
 * 已保存的 Key 已经拿不到了，重试没有意义。必须给一条能让用户自己动手的文案，
 * 否则表现就是「昨天还能生图，今天所有 Key 都空了」而界面一个字都不说。
 */
function notifyApiSecretsUnavailable() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('tangbao:persist-error', { detail: { namespace: 'apiSecretsUnavailable' } }))
}

async function flushApiSecrets(): Promise<void> {
  if (apiSecretsPersisting || !pendingApiSecrets) return
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.saveApiSecrets) return
  apiSecretsPersisting = true
  const secrets = pendingApiSecrets
  pendingApiSecrets = null
  try {
    const result = await api.saveApiSecrets(secrets)
    if (!result.success) throw new Error(result.error || 'API 密钥安全存储失败')
  } catch (error) {
    console.error('[api-secrets] 写入失败，将自动重试', error)
    pendingApiSecrets = pendingApiSecrets ?? secrets
    notifyApiSecretsPersistError()
  } finally {
    apiSecretsPersisting = false
    if (pendingApiSecrets && !apiSecretsPersistTimer) {
      apiSecretsPersistTimer = setTimeout(() => {
        apiSecretsPersistTimer = null
        void flushApiSecrets()
      }, 1500)
    }
  }
}

function scheduleApiSecretsPersist(settings: AppSettings) {
  if (!secureApiSecretsAvailable) return
  pendingApiSecrets = extractApiSecrets(settings)
  void flushApiSecrets()
}

export async function hydrateDesktopApiSecrets(): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.loadApiSecrets || !api.saveApiSecrets) return
  try {
    const loaded = await api.loadApiSecrets()
    if (!loaded.available) {
      // 密钥库不可用：读不回已存的 Key，这时**不要**继续往下走（下面会把空 secrets
      // 写回去，等于把唯一的一份真值覆盖掉），也**不能**静默 return —— 用户会看到
      // 所有 API Key 变空却没有任何解释。这里显式上报，交给 App.tsx 出 Toast。
      console.error('[api-secrets] 系统密钥库不可用，无法还原已保存的 API Key')
      notifyApiSecretsUnavailable()
      return
    }
    if (loaded.error) console.warn('[api-secrets] 读取安全存储失败，将使用当前配置', loaded.error)
    const current = normalizeSettings(useStore.getState().settings)
    const settings = normalizeSettings(applyApiSecrets(current, loaded.secrets))
    const saved = await api.saveApiSecrets(extractApiSecrets(settings))
    if (!saved.success) throw new Error(saved.error || 'API 密钥安全存储失败')
    secureApiSecretsAvailable = true
    useStore.setState({ settings })
  } catch (error) {
    console.error('[api-secrets] 初始化失败，暂不清理普通设置中的密钥', error)
    notifyApiSecretsPersistError()
  }
}

function getPersistableCodexCliPromptKeys(settings: AppSettings, values: string[]) {
  const allowed = new Set(
    [...settings.profiles, ...settings.agentProfiles].map((profile) => `${profile.id}\n${profile.baseUrl}`),
  )
  return values.filter((value) => allowed.has(value))
}

export function getPersistedState(state: AppState) {
  const settings = normalizeSettings(state.settings)
  const persistedSettings = secureApiSecretsAvailable ? stripApiSecrets(settings) : settings
  const galleryInputDraft = getPersistableGalleryInputDraft(state)
  return {
    settings: persistedSettings,
    params: state.params,
    customOutputPath: state.customOutputPath,
    ...(settings.persistInputOnRestart && (state.appMode === 'gallery' || galleryInputDraft)
      ? {
          prompt: galleryInputDraft?.prompt ?? '',
          inputImages: galleryInputDraft?.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) ?? [],
        }
      : {}),
    dismissedCodexCliPrompts: getPersistableCodexCliPromptKeys(settings, state.dismissedCodexCliPrompts),
    appMode: state.appMode,
    galleryInputDraft:
      settings.persistInputOnRestart && galleryInputDraft
        ? {
            ...galleryInputDraft,
            inputImages: galleryInputDraft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
            inputImageFolder: galleryInputDraft.inputImageFolder,
          }
        : null,
    // 项目文件夹隔离草稿：dataUrl 不落盘（重启后按 imageId 重新加载图片内容）
    folderInputDrafts: Object.fromEntries(
      Object.entries(state.folderInputDrafts).map(([folderId, draft]) => [
        folderId,
        {
          ...draft,
          params: draft.params ? { ...DEFAULT_PARAMS, ...draft.params } : { ...DEFAULT_PARAMS },
          inputImages: draft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
        },
      ]),
    ),
    ...(agentConversationMigrationPending && !agentConversationPersistenceReady
      ? { agentConversations: getPersistableAgentConversations(state.agentConversations) }
      : {}),
    activeAgentConversationId: state.activeAgentConversationId,
    agentInputDrafts: getPersistableAgentInputDrafts(state),
    agentSidebarCollapsed: state.agentSidebarCollapsed,
    agentDesktopSidebarCollapsed: state.agentDesktopSidebarCollapsed,
    favoriteCollections: state.favoriteCollections,
    defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
    schedule: state.schedule,
    supportPromptDismissed: state.supportPromptDismissed,
    supportPromptSkippedForImportedData: state.supportPromptSkippedForImportedData,
    ...(state.workspaceTabs.length > 0
      ? {
          workspaceTabs: state.workspaceTabs.map((tab) => ({
            ...tab,
            inputImages: tab.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
            inputImageFolder: tab.inputImageFolder,
            tasks: [],
            // Async storage hydration restores task ownership before IndexedDB
            // has populated tab.tasks. Preserve those IDs across interim writes.
            _taskIds: Array.isArray(tab._taskIds)
              ? [...new Set([...tab._taskIds, ...tab.tasks.map((t) => t.id)])]
              : tab.tasks.map((t) => t.id),
          })),
          activeWorkspaceTabId: state.activeWorkspaceTabId,
          workspaceTabGroups: state.workspaceTabGroups,
        }
      : {}),
    lastAutoBackupAt: state.lastAutoBackupAt,
    firstBackupReminderShown: state.firstBackupReminderShown,
    backupReminderCount: state.backupReminderCount,
  }
}

async function replaceStoredAgentConversations(conversations: AgentConversation[]) {
  await replaceAgentConversations(conversations.map(getPersistableAgentConversation))
}

function getPersistableAgentConversation(conversation: AgentConversation): AgentConversation {
  return getPersistableAgentConversations([conversation])[0]!
}

function normalizeTaskRecordFields(task: TaskRecord): TaskRecord {
  return {
    ...task,
    params: task.params ? { ...DEFAULT_PARAMS, ...task.params } : { ...DEFAULT_PARAMS },
    outputImages: Array.isArray(task.outputImages) ? task.outputImages : [],
    inputImageIds: Array.isArray(task.inputImageIds) ? task.inputImageIds : [],
  }
}

function mergePersistedState(persistedState: unknown, currentState: AppState): AppState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = persistedState as Partial<AppState>
  const settings = normalizeSettings(persisted.settings ?? currentState.settings)
  setApiTransportMode(settings.apiTransportMode)
  const hasPersistedAgentConversations = Array.isArray(persisted.agentConversations)
  if (hasPersistedAgentConversations && normalizeAgentConversations(persisted.agentConversations).length > 0) {
    agentConversationMigrationPending = true
  }
  const agentConversations = hasPersistedAgentConversations
    ? normalizeAgentConversations(persisted.agentConversations)
    : currentState.agentConversations
  const activeAgentConversationId =
    typeof persisted.activeAgentConversationId === 'string' &&
    (!hasPersistedAgentConversations ||
      agentConversations.some((conversation) => conversation.id === persisted.activeAgentConversationId))
      ? persisted.activeAgentConversationId
      : (agentConversations[0]?.id ?? null)
  // 下单 / 策略模块已屏蔽：历史持久化中的这两个模式归一化回素材库。
  // ⚠️ `daily` 必须在这里放行 —— 不放行的话重启后会被打回素材库，
  //    用户的观感是「昨天配好的每日任务没了」，而数据其实还在。
  const appMode = persisted.appMode === 'agent' || persisted.appMode === 'daily' ? persisted.appMode : 'gallery'
  const galleryInputDraft = settings.persistInputOnRestart
    ? normalizeAgentInputDraft(
        persisted.galleryInputDraft ?? {
          prompt: persisted.prompt,
          inputImages: persisted.inputImages,
          maskDraft: null,
          maskEditorImageId: null,
        },
      )
    : null
  const normalizedAgentInputDrafts = hasPersistedAgentConversations
    ? normalizeAgentInputDrafts(persisted.agentInputDrafts, agentConversations)
    : normalizeAgentInputDraftsByKey(persisted.agentInputDrafts)
  let agentInputDrafts = cleanStaleAgentInputDrafts(normalizedAgentInputDrafts, activeAgentConversationId)
  if (
    appMode === 'agent' &&
    activeAgentConversationId &&
    !agentInputDrafts[activeAgentConversationId] &&
    settings.persistInputOnRestart &&
    typeof persisted.prompt === 'string'
  ) {
    agentInputDrafts = {
      ...agentInputDrafts,
      [activeAgentConversationId]: normalizeAgentInputDraft(
        {
          prompt: persisted.prompt,
          inputImages: persisted.inputImages,
          maskDraft: null,
          maskEditorImageId: null,
        },
        Date.now(),
      ),
    }
  }
  const restoredAgentDraft =
    appMode === 'agent' && activeAgentConversationId ? (agentInputDrafts[activeAgentConversationId] ?? null) : null
  const favoriteCollections = Array.isArray(persisted.favoriteCollections)
    ? ensureDefaultFavoriteCollection(normalizeFavoriteCollections(persisted.favoriteCollections))
    : currentState.favoriteCollections
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(
    favoriteCollections,
    persisted.defaultFavoriteCollectionId,
  )
  const schedule = normalizeScheduleState(persisted.schedule, currentState.schedule)
  // Gallery 模式下顶层输入状态（params/inputImageFolder）应镜像活动 workspace 标签页，
  // 与 setAppMode 的恢复逻辑保持一致。
  const normalizedWorkspaceTabs =
    Array.isArray(persisted.workspaceTabs) && persisted.workspaceTabs.length > 0
      ? persisted.workspaceTabs.map((tab) => ({
          ...tab,
          inputImages: normalizeInputImages(tab.inputImages),
          inputImageFolder:
            isRecord(tab.inputImageFolder) &&
            typeof tab.inputImageFolder.path === 'string' &&
            Array.isArray(tab.inputImageFolder.imageIds)
              ? {
                  path: tab.inputImageFolder.path,
                  imageIds: tab.inputImageFolder.imageIds.filter((id: unknown): id is string => typeof id === 'string'),
                }
              : null,
          params: isRecord(tab.params) ? { ...DEFAULT_PARAMS, ...tab.params } : { ...DEFAULT_PARAMS },
          maskDraft: normalizeMaskDraft(tab.maskDraft),
          customOutputPath: typeof tab.customOutputPath === 'string' ? tab.customOutputPath : '',
          tasks: Array.isArray(tab.tasks)
            ? tab.tasks.filter((t) => typeof t !== 'string').map(normalizeTaskRecordFields)
            : [],
          _taskIds: Array.isArray(tab._taskIds)
            ? tab._taskIds
            : Array.isArray(tab.tasks)
              ? tab.tasks.map((t) => (typeof t === 'string' ? t : (t?.id ?? '')))
              : [],
        }))
      : currentState.workspaceTabs
  const persistedActiveWorkspaceTabId =
    typeof persisted.activeWorkspaceTabId === 'string'
      ? persisted.activeWorkspaceTabId
      : currentState.activeWorkspaceTabId
  const activeWorkspaceTabForRestore =
    appMode === 'gallery' && persistedActiveWorkspaceTabId
      ? (normalizedWorkspaceTabs.find((t) => t.id === persistedActiveWorkspaceTabId) ?? null)
      : null
  const restoredParams = activeWorkspaceTabForRestore
    ? activeWorkspaceTabForRestore.params
    : isRecord(persisted.params)
      ? { ...DEFAULT_PARAMS, ...persisted.params }
      : currentState.params
  const restoredInputImageFolder = activeWorkspaceTabForRestore
    ? activeWorkspaceTabForRestore.inputImageFolder
    : restoredAgentDraft
      ? (restoredAgentDraft.inputImageFolder ?? null)
      : (galleryInputDraft?.inputImageFolder ?? null)
  const restoredCustomOutputPath = activeWorkspaceTabForRestore
    ? activeWorkspaceTabForRestore.customOutputPath
    : typeof persisted.customOutputPath === 'string'
      ? persisted.customOutputPath
      : currentState.customOutputPath
  return {
    ...currentState,
    appMode,
    settings,
    dismissedCodexCliPrompts: persisted.dismissedCodexCliPrompts ?? currentState.dismissedCodexCliPrompts,
    galleryInputDraft: galleryInputDraft && !isEmptyAgentInputDraft(galleryInputDraft) ? galleryInputDraft : null,
    folderInputDrafts: isRecord(persisted.folderInputDrafts)
      ? (persisted.folderInputDrafts as Record<string, FolderInputDraft>)
      : {},
    agentConversations,
    activeAgentConversationId,
    agentInputDrafts,
    agentSidebarCollapsed: Boolean(persisted.agentSidebarCollapsed),
    agentDesktopSidebarCollapsed:
      typeof persisted.agentDesktopSidebarCollapsed === 'boolean' ? persisted.agentDesktopSidebarCollapsed : false,
    favoriteCollections,
    defaultFavoriteCollectionId,
    schedule,
    activeFavoriteCollectionId: null,
    favoritePickerTaskIds: null,
    supportPromptDismissed: Boolean(persisted.supportPromptDismissed),
    supportPromptSkippedForImportedData: Boolean(persisted.supportPromptSkippedForImportedData),
    workspaceTabs: normalizedWorkspaceTabs,
    activeWorkspaceTabId: persistedActiveWorkspaceTabId,
    workspaceTabGroups:
      Array.isArray(persisted.workspaceTabGroups) && persisted.workspaceTabGroups.length > 0
        ? persisted.workspaceTabGroups.map((g) => ({
            id: String(g.id ?? Math.random().toString(36).slice(2, 9)),
            name: String(g.name ?? '未命名分组'),
            order: typeof g.order === 'number' ? g.order : 0,
            collapsed: Boolean(g.collapsed),
          }))
        : currentState.workspaceTabGroups,
    lastAutoBackupAt: persisted.lastAutoBackupAt ?? currentState.lastAutoBackupAt,
    firstBackupReminderShown: Boolean(persisted.firstBackupReminderShown),
    backupReminderCount:
      typeof persisted.backupReminderCount === 'number'
        ? persisted.backupReminderCount
        : currentState.backupReminderCount,
    prompt: restoredAgentDraft ? restoredAgentDraft.prompt : (galleryInputDraft?.prompt ?? ''),
    inputImages: restoredAgentDraft ? restoredAgentDraft.inputImages : (galleryInputDraft?.inputImages ?? []),
    inputImageFolder: restoredInputImageFolder,
    params: restoredParams,
    maskDraft: restoredAgentDraft ? restoredAgentDraft.maskDraft : (galleryInputDraft?.maskDraft ?? null),
    maskEditorImageId: restoredAgentDraft
      ? restoredAgentDraft.maskEditorImageId
      : (galleryInputDraft?.maskEditorImageId ?? null),
    customOutputPath: restoredCustomOutputPath,
  }
}

// ===== Store 类型 =====

interface PromptInputDialogConfig {
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  action: (value: string) => void
  onCancel?: () => void
}

interface AppState {
  // 模式
  appMode: AppMode
  setAppMode: (mode: AppMode) => void
  /**
   * 中控台**当前分区**（唯一真相源）。
   *
   * 放在应用 store 而不是工作区局部 state，是因为**外部要能指定落点**：
   * 「后处理」弹窗里的「去中控台改全局规格」如果不带目标分区，用户跳过去会落在默认分区、
   * 还得自己再找一遍（等于没跳）。
   *
   * 默认值必须是 `watermark`（`DEFAULT_CONTROL_CONSOLE_SECTION`，理由见
   * `controlConsoleSections.ts`）；**离开中控台时由工作区把它归位默认**，
   * 所以「从顶栏点进来」看到的仍是水印，行为不变。
   */
  controlConsoleSection: ControlConsoleSectionId
  setControlConsoleSection: (section: ControlConsoleSectionId) => void
  /**
   * 项目树工作台的打开状态（唯一真相源，`null` = 关着）。
   *
   * 它原本是资产库工具栏里的局部 state，于是**别处没法把用户送过去** ——
   * 「后处理」弹窗那条「这个方向不在启用范围内，请到项目树的『后处理』列勾选」
   * 就只能干说一句、让人自己去翻（这正是杰哥 2026-09-20 报的那条）。
   *
   * `focusId`：跳过去时要让人一眼看到的那一行（工作台用它预填搜索关键词）。
   * 与 `open` 放在同一个值里，避免出现「开着但带着上一次的焦点」这种不一致。
   *
   * 刻意**不落盘**（`getPersistedState` 是白名单）：它是「这一次跳转」的意图，不是偏好。
   */
  projectTreeWorkbench: { open: boolean; focusId: string | null }
  openProjectTreeWorkbench: (focusId?: string | null) => void
  closeProjectTreeWorkbench: () => void
  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  replaceInputImage: (idx: number, img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[], options?: { equivalentImageIds?: Record<string, string> }) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  inputImageFolder: InputImageFolder | null
  setInputImageFolder: (folder: InputImageFolder | null) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void
  galleryInputDraft: AgentInputDraft | null
  /** 项目文件夹（含子文件夹）各自的生图输入草稿：提示词/参数/参考图/遮罩相互隔离 */
  folderInputDrafts: Record<string, FolderInputDraft>
  /** 素材库范围切换时保存/恢复文件夹草稿（由素材库 scope 订阅触发） */
  onAssetLibraryFolderScopeChange: (prevScope: unknown, nextScope: unknown) => void
  customOutputPath: string
  setCustomOutputPath: (path: string) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void
  reusedTaskApiProfileId: string | null
  reusedTaskApiProfileName: string | null
  reusedTaskApiProfileMissing: boolean
  setReusedTaskApiProfile: (profileId: string | null, missing?: boolean, profileName?: string | null) => void

  // Agent
  agentConversations: AgentConversation[]
  agentConversationsLoaded: boolean
  activeAgentConversationId: string | null
  agentInputDrafts: Record<string, AgentInputDraft>
  agentSidebarCollapsed: boolean
  agentDesktopSidebarCollapsed: boolean
  agentMobileHeaderVisible: boolean
  agentEditingRoundId: string | null
  agentEditingConversationId: string | null
  agentGeneratingTitleIds: Record<string, true>
  createAgentConversation: () => string
  setActiveAgentConversationId: (id: string | null) => void
  setActiveAgentRoundId: (conversationId: string, roundId: string | null) => void
  renameAgentConversation: (id: string, title: string) => void
  deleteAgentConversation: (id: string) => void
  reorderAgentConversations: (sourceId: string, targetId: string, position?: 'before' | 'after') => void
  setAgentSidebarCollapsed: (collapsed: boolean) => void
  setAgentDesktopSidebarCollapsed: (collapsed: boolean) => void
  setAgentMobileHeaderVisible: (visible: boolean) => void
  setAgentEditingRoundId: (id: string | null) => void
  setAgentEditingConversationId: (id: string | null) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  favoriteCollections: FavoriteCollection[]
  setFavoriteCollections: (collections: FavoriteCollection[]) => void
  defaultFavoriteCollectionId: string | null
  setDefaultFavoriteCollectionId: (id: string | null) => void
  activeFavoriteCollectionId: string | null
  isManageCollectionsModalOpen: boolean
  setActiveFavoriteCollectionId: (id: string | null) => void
  openManageCollectionsModal: () => void
  closeManageCollectionsModal: () => void
  favoritePickerTaskIds: string[] | null
  openFavoritePicker: (taskIds: string[]) => void
  closeFavoritePicker: () => void
  schedule: ScheduleState
  setScheduleModalOpen: (open: boolean) => void
  setScheduleWeekStart: (weekStart: string) => void
  startScheduleWeek: (weekStart: string) => void
  stopScheduleWeek: (weekStart: string) => void
  copyPreviousWeekSchedule: () => string[]
  addScheduleRow: () => string
  updateScheduleRow: (id: string, name: string) => void
  removeScheduleRow: (id: string) => void
  addScheduleItem: (item: Omit<ScheduleItem, 'id' | 'order'> & { order?: number }) => string
  updateScheduleItem: (id: string, patch: Partial<Omit<ScheduleItem, 'id'>>) => void
  removeScheduleItem: (id: string) => void
  updateTaskFavoriteOutputPath: (taskId: string, outputPath: string) => void
  updateTaskFavoriteOutputDateVariable: (taskId: string, enabled: boolean) => void
  runScheduleItem: (
    id: string,
    now?: Date,
    countOverride?: number,
    appendToLastTaskIds?: boolean,
  ) => Promise<string | null>
  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void
  selectedFavoriteCollectionIds: string[]
  setSelectedFavoriteCollectionIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleFavoriteCollectionSelection: (id: string, force?: boolean) => void
  clearFavoriteCollectionSelection: () => void

  // UI
  detailTaskId: string | null
  detailImageId: string | null
  detailReturnToSchedule: boolean
  setDetailTaskId: (id: string | null, options?: { returnToSchedule?: boolean; imageId?: string }) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  settingsTabRequest: SettingsTab | null
  setShowSettings: (v: boolean, tab?: SettingsTab) => void
  supportPromptDismissed: boolean
  supportPromptSkippedForImportedData: boolean

  // Toast
  toast: { message: string; type: ToastType; action?: { label: string; onClick: () => void } } | null
  showToast: (message: string, type?: ToastType, action?: { label: string; onClick: () => void }) => void
  /** 手动关掉当前提示（toast 上的关闭按钮）。等它自己消失是另一条路，两条都要有。 */
  clearToast: () => void

  // SOP 管理中心跳转请求（后台生成完成后的「查看结果」按钮触发）
  sopCenterJump: { itemId: string; nonce: number } | null
  requestSopCenterJump: (itemId: string) => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    checkbox?: {
      label: string
      defaultChecked?: boolean
      disabled?: boolean
      tone?: 'primary' | 'danger'
    }
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    buttons?: Array<{
      label: string
      tone?: 'primary' | 'secondary' | 'danger' | 'warning'
      action: (checkboxChecked?: boolean) => void
    }>
    icon?: 'info' | 'copy'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action?: (checkboxChecked?: boolean) => void
    cancelAction?: (checkboxChecked?: boolean) => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void

  // Prompt input dialog
  promptInputDialog: PromptInputDialogConfig | null
  setPromptInputDialog: (config: PromptInputDialogConfig | null) => void

  // Random prompt generator

  // Workspace tabs (工作区标签页)
  workspaceTabs: WorkspaceTab[]
  activeWorkspaceTabId: string | null
  workspaceTabGroups: WorkspaceTabGroup[]
  selectedWorkspaceTabIds: string[]
  workspaceTabManagerOpen: boolean
  setActiveWorkspaceTabId: (id: string | null) => void
  setSelectedWorkspaceTabIds: (updater: string[] | ((prev: string[]) => string[])) => void
  toggleWorkspaceTabSelection: (id: string, force?: boolean) => void
  clearWorkspaceTabSelection: () => void
  setWorkspaceTabManagerOpen: (open: boolean) => void
  createWorkspaceTab: () => string
  closeWorkspaceTab: (id: string) => void
  duplicateWorkspaceTab: (id: string) => string
  renameWorkspaceTab: (id: string, name: string) => void
  reorderWorkspaceTabs: (tabs: WorkspaceTab[]) => void
  createWorkspaceTabGroup: (name: string) => string
  renameWorkspaceTabGroup: (id: string, name: string) => void
  deleteWorkspaceTabGroup: (id: string) => void
  moveWorkspaceTabToGroup: (tabId: string, groupId: string | null) => void
  updateWorkspaceTabState: (id: string, patch: Partial<WorkspaceTab>) => void
  saveCurrentStateToActiveTab: () => void

  // 自动备份
  lastAutoBackupAt: number
  setLastAutoBackupAt: (t: number) => void
  /**
   * 上次自动备份的失败原因（瞬态，不持久化）。
   * 之所以要落到 store：自动备份过去只在 console.warn 里报错，
   * 用户「以为有备份、实际一次都没成功」—— 必须让它可见。
   */
  lastAutoBackupError: string | null
  setLastAutoBackupError: (message: string | null) => void
  firstBackupReminderShown: boolean
  setFirstBackupReminderShown: (v: boolean) => void
  backupReminderCount: number
  setBackupReminderCount: (v: number) => void

  // Agent 流式文本缓冲（不参与持久化，避免频繁更新 agentConversations）
}

function isImageReferencedByState(state: AppState, imageId: string) {
  if (useRequirementPrototype.getState().sopLibrary.some((item) => item.coverImageId === imageId)) return true
  if (state.inputImages.some((img) => img.id === imageId)) return true
  if (state.galleryInputDraft?.inputImages.some((img) => img.id === imageId)) return true
  if (Object.values(state.agentInputDrafts).some((draft) => draft.inputImages.some((img) => img.id === imageId)))
    return true
  if (
    state.workspaceTabs.some(
      (tab) =>
        tab.inputImages.some((img) => img.id === imageId) ||
        tab.maskDraft?.targetImageId === imageId ||
        tab.tasks.some(
          (task) =>
            task.inputImageIds?.includes(imageId) ||
            task.outputImages?.includes(imageId) ||
            task.streamPartialImageIds?.includes(imageId) ||
            task.maskTargetImageId === imageId ||
            task.maskImageId === imageId,
        ),
    )
  )
    return true
  if (
    state.tasks.some(
      (task) =>
        task.inputImageIds.includes(imageId) ||
        task.outputImages.includes(imageId) ||
        task.streamPartialImageIds?.includes(imageId) ||
        task.maskTargetImageId === imageId ||
        task.maskImageId === imageId,
    )
  )
    return true
  return state.agentConversations.some(
    (conversation) =>
      conversation.rounds.some(
        (round) =>
          round.inputImageIds.includes(imageId) || round.maskTargetImageId === imageId || round.maskImageId === imageId,
      ) ||
      conversation.messages.some(
        (message) =>
          message.inputImageIds?.includes(imageId) ||
          message.maskTargetImageId === imageId ||
          message.maskImageId === imageId,
      ),
  )
}

export async function deleteImageIfUnreferenced(imageId: string) {
  imageCache.delete(imageId)
  clearCachedThumbnail(imageId)
  for (const variant of ['full', 'grid'] as const) {
    const key = thumbnailKey(imageId, variant)
    thumbnailBackfillIds.delete(key)
    thumbnailBackfillRunningIds.delete(key)
    thumbnailSubscribers.delete(key)
  }
  if (isImageReferencedByState(useStore.getState(), imageId)) return
  try {
    const graph = await buildStoreImageReferenceGraph()
    if (isImageReferenced(graph, imageId)) return
    await deleteImage(imageId)
  } catch {
    // 清理是内存/存储优化，失败不影响替换结果。
  }
}

/** 回收站词条保留期限：超过后自动清理（30 天） */

function normalizeInputImages(value: unknown): InputImage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((img): InputImage | null => {
      if (!isRecord(img) || typeof img.id !== 'string') return null
      return { id: img.id, dataUrl: typeof img.dataUrl === 'string' ? img.dataUrl : '' }
    })
    .filter((img): img is InputImage => img != null)
}

function normalizeMaskDraft(value: unknown): MaskDraft | null {
  if (!isRecord(value)) return null
  if (typeof value.targetImageId !== 'string' || typeof value.maskDataUrl !== 'string') return null
  return {
    targetImageId: value.targetImageId,
    maskDataUrl: value.maskDataUrl,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

function createDefaultWorkspaceTab(
  options: {
    prompt?: unknown
    inputImages?: unknown
    inputImageFolder?: InputImageFolder | null
    params?: unknown
    maskDraft?: unknown
    maskEditorImageId?: unknown
    tasks?: TaskRecord[]
    customOutputPath?: unknown
    now?: number
  } = {},
): WorkspaceTab {
  const now = options.now ?? Date.now()
  return {
    id: Math.random().toString(36).slice(2, 9),
    name: '默认',
    groupId: null,
    prompt: typeof options.prompt === 'string' ? options.prompt : '',
    inputImages: normalizeInputImages(options.inputImages),
    inputImageFolder: options.inputImageFolder ?? null,
    params: { ...DEFAULT_PARAMS, ...(isRecord(options.params) ? options.params : {}) },
    maskDraft: normalizeMaskDraft(options.maskDraft),
    maskEditorImageId: typeof options.maskEditorImageId === 'string' ? options.maskEditorImageId : null,
    customOutputPath: typeof options.customOutputPath === 'string' ? options.customOutputPath : '',
    tasks: options.tasks ?? [],
    createdAt: now,
    updatedAt: now,
    order: 0,
  }
}

function normalizeAgentInputDraft(value: unknown, fallbackUpdatedAt = Date.now()): AgentInputDraft {
  const draft = isRecord(value) ? value : {}
  const updatedAt =
    typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : fallbackUpdatedAt
  const folder = isRecord(draft.inputImageFolder) ? draft.inputImageFolder : null
  return {
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    inputImages: normalizeInputImages(draft.inputImages),
    inputImageFolder:
      folder && typeof folder.path === 'string' && Array.isArray(folder.imageIds)
        ? { path: folder.path, imageIds: folder.imageIds.filter((id: unknown): id is string => typeof id === 'string') }
        : null,
    maskDraft: normalizeMaskDraft(draft.maskDraft),
    maskEditorImageId: typeof draft.maskEditorImageId === 'string' ? draft.maskEditorImageId : null,
    updatedAt,
  }
}

function normalizeAgentInputDrafts(
  value: unknown,
  conversations: AgentConversation[],
): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const conversationIds = new Set(conversations.map((conversation) => conversation.id))
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    if (!conversationIds.has(conversationId)) continue
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized)) drafts[conversationId] = normalized
  }
  return drafts
}

function normalizeAgentInputDraftsByKey(value: unknown): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized)) drafts[conversationId] = normalized
  }
  return drafts
}

export function cleanStaleAgentInputDrafts(
  drafts: Record<string, AgentInputDraft>,
  activeConversationId: string | null,
  now = Date.now(),
) {
  const cutoff = now - AGENT_INPUT_DRAFT_RETENTION_MS
  const next: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (conversationId === activeConversationId || (draft.updatedAt ?? now) >= cutoff) {
      next[conversationId] = draft
    }
  }
  return next
}

function clearInputDraftState(): Pick<
  AgentInputDraft,
  'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'
> {
  return {
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    maskDraft: null,
    maskEditorImageId: null,
  }
}

function copyAgentInputDraft(draft: AgentInputDraft): AgentInputDraft {
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    inputImageFolder: draft.inputImageFolder,
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
    updatedAt: draft.updatedAt ?? Date.now(),
  }
}

function getCurrentAgentInputDraft(
  state: Pick<AppState, 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'>,
): AgentInputDraft {
  return {
    prompt: state.prompt,
    inputImages: state.inputImages,
    inputImageFolder: state.inputImageFolder,
    maskDraft: state.maskDraft,
    maskEditorImageId: state.maskEditorImageId,
    updatedAt: Date.now(),
  }
}

function isEmptyAgentInputDraft(draft: AgentInputDraft) {
  return (
    draft.prompt.length === 0 &&
    draft.inputImages.length === 0 &&
    !draft.inputImageFolder &&
    !draft.maskDraft &&
    !draft.maskEditorImageId
  )
}

function setAgentInputDraft(drafts: Record<string, AgentInputDraft>, conversationId: string, draft: AgentInputDraft) {
  const next = { ...drafts }
  if (isEmptyAgentInputDraft(draft)) {
    delete next[conversationId]
  } else {
    next[conversationId] = copyAgentInputDraft(draft)
  }
  return next
}

function saveActiveAgentInputDrafts(
  state: Pick<
    AppState,
    | 'appMode'
    | 'activeAgentConversationId'
    | 'agentInputDrafts'
    | 'prompt'
    | 'inputImages'
    | 'inputImageFolder'
    | 'maskDraft'
    | 'maskEditorImageId'
  >,
) {
  if (state.appMode !== 'agent' || !state.activeAgentConversationId) return state.agentInputDrafts

  const existingDraft = state.agentInputDrafts[state.activeAgentConversationId]
  if (existingDraft) {
    const hasChanges =
      state.prompt !== existingDraft.prompt ||
      state.inputImages.length !== existingDraft.inputImages.length ||
      state.inputImages.some((img, idx) => img.id !== existingDraft.inputImages[idx]?.id) ||
      state.inputImageFolder?.path !== existingDraft.inputImageFolder?.path ||
      JSON.stringify(state.maskDraft) !== JSON.stringify(existingDraft.maskDraft) ||
      state.maskEditorImageId !== existingDraft.maskEditorImageId

    if (!hasChanges) {
      return state.agentInputDrafts
    }
  }

  return setAgentInputDraft(state.agentInputDrafts, state.activeAgentConversationId, getCurrentAgentInputDraft(state))
}

function saveGalleryInputDraft(
  state: Pick<
    AppState,
    'appMode' | 'galleryInputDraft' | 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'
  >,
) {
  if (state.appMode !== 'gallery') return state.galleryInputDraft
  const hasChanges =
    state.prompt !== state.galleryInputDraft?.prompt ||
    state.inputImages.length !== state.galleryInputDraft?.inputImages.length ||
    state.inputImages.some((img, idx) => img.id !== state.galleryInputDraft?.inputImages[idx]?.id) ||
    state.inputImageFolder?.path !== state.galleryInputDraft?.inputImageFolder?.path ||
    JSON.stringify(state.maskDraft) !== JSON.stringify(state.galleryInputDraft?.maskDraft) ||
    state.maskEditorImageId !== state.galleryInputDraft?.maskEditorImageId

  if (!hasChanges && state.galleryInputDraft) {
    return state.galleryInputDraft
  }

  const draft = getCurrentAgentInputDraft(state)
  return isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft)
}

function getPersistableGalleryInputDraft(state: AppState) {
  return saveGalleryInputDraft(state)
}

/** 从全局输入状态提取当前文件夹草稿（提示词 + 参数 + 参考图 + 遮罩 + 输出路径）。 */
function getFolderInputDraftFromState(state: AppState): FolderInputDraft {
  return {
    prompt: state.prompt,
    params: state.params,
    inputImages: state.inputImages.map((img) => ({ ...img })),
    inputImageFolder: state.inputImageFolder,
    maskDraft: state.maskDraft ? { ...state.maskDraft } : null,
    maskEditorImageId: state.maskEditorImageId,
    customOutputPath: state.customOutputPath,
    updatedAt: Date.now(),
  }
}

function restoreGalleryInputDraftState(
  draft: AgentInputDraft | null,
): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'> {
  if (!draft) return clearInputDraftState()
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    inputImageFolder: draft.inputImageFolder ?? null,
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
  }
}

function restoreAgentInputDraftState(
  drafts: Record<string, AgentInputDraft>,
  conversationId: string | null,
): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'> {
  const draft = conversationId ? drafts[conversationId] : null
  return restoreGalleryInputDraftState(draft ?? null)
}

function syncActiveInputDraft<
  T extends Partial<AgentInputDraft> & {
    inputImageFolder?: import('./types').InputImageFolder | null
    params?: Partial<TaskParams>
    customOutputPath?: string
  },
>(
  state: AppState,
  patch: T,
): T & {
  agentInputDrafts?: Record<string, AgentInputDraft>
  galleryInputDraft?: AgentInputDraft | null
  workspaceTabs?: WorkspaceTab[]
  folderInputDrafts?: Record<string, FolderInputDraft>
} {
  const draft: AgentInputDraft = {
    prompt: patch.prompt ?? state.prompt,
    inputImages: patch.inputImages ?? state.inputImages,
    inputImageFolder: patch.inputImageFolder !== undefined ? patch.inputImageFolder : state.inputImageFolder,
    maskDraft: patch.maskDraft !== undefined ? patch.maskDraft : state.maskDraft,
    maskEditorImageId: patch.maskEditorImageId !== undefined ? patch.maskEditorImageId : state.maskEditorImageId,
    customOutputPath: patch.customOutputPath !== undefined ? patch.customOutputPath : state.customOutputPath,
  }
  if (state.appMode === 'gallery') {
    const activeTabId = state.activeWorkspaceTabId
    if (activeTabId) {
      const activeTab = state.workspaceTabs.find((t) => t.id === activeTabId)
      if (activeTab) {
        const tabHasChanges =
          activeTab.prompt !== draft.prompt ||
          activeTab.inputImages.length !== draft.inputImages.length ||
          activeTab.inputImages.some((img, idx) => img.id !== draft.inputImages[idx]?.id) ||
          (patch.inputImageFolder !== undefined && activeTab.inputImageFolder?.path !== patch.inputImageFolder?.path) ||
          (patch.params !== undefined &&
            JSON.stringify(activeTab.params) !== JSON.stringify({ ...state.params, ...patch.params })) ||
          JSON.stringify(activeTab.maskDraft) !== JSON.stringify(draft.maskDraft) ||
          activeTab.maskEditorImageId !== draft.maskEditorImageId ||
          (patch.customOutputPath !== undefined && activeTab.customOutputPath !== patch.customOutputPath)

        if (!tabHasChanges) {
          const existingDraft = state.galleryInputDraft
          const draftHasChanges =
            !existingDraft ||
            existingDraft.prompt !== draft.prompt ||
            existingDraft.inputImages.length !== draft.inputImages.length ||
            existingDraft.inputImages.some((img, idx) => img.id !== draft.inputImages[idx]?.id) ||
            existingDraft.inputImageFolder?.path !== draft.inputImageFolder?.path ||
            JSON.stringify(existingDraft.maskDraft) !== JSON.stringify(draft.maskDraft) ||
            existingDraft.maskEditorImageId !== draft.maskEditorImageId ||
            existingDraft.customOutputPath !== draft.customOutputPath

          if (!draftHasChanges) {
            return patch
          }
        }
      }
    }

    const updatedTabs = activeTabId
      ? state.workspaceTabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                prompt: draft.prompt,
                inputImages: draft.inputImages.map((img) => ({ ...img })),
                inputImageFolder:
                  patch.inputImageFolder !== undefined ? patch.inputImageFolder : state.inputImageFolder,
                params: patch.params !== undefined ? { ...state.params, ...patch.params } : t.params,
                maskDraft: draft.maskDraft,
                maskEditorImageId: draft.maskEditorImageId,
                customOutputPath: patch.customOutputPath !== undefined ? patch.customOutputPath : t.customOutputPath,
                updatedAt: Date.now(),
              }
            : t,
        )
      : state.workspaceTabs
    // 项目文件夹隔离：当前处于项目文件夹（含子文件夹）时，把输入变更同步进该文件夹的草稿
    const assetScope = useAssetLibraryStore.getState().scope
    const folderInputDrafts =
      typeof assetScope === 'object' && assetScope.kind === 'collection'
        ? {
            ...state.folderInputDrafts,
            [assetScope.id]: {
              prompt: draft.prompt,
              params: patch.params !== undefined ? { ...state.params, ...patch.params } : state.params,
              inputImages: draft.inputImages.map((img) => ({ ...img })),
              inputImageFolder: draft.inputImageFolder,
              maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
              maskEditorImageId: draft.maskEditorImageId,
              customOutputPath: draft.customOutputPath,
              updatedAt: Date.now(),
            },
          }
        : state.folderInputDrafts
    return {
      ...patch,
      galleryInputDraft: isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft),
      workspaceTabs: updatedTabs,
      folderInputDrafts,
    }
  }
  if (!state.activeAgentConversationId) return patch

  const existingDraft = state.agentInputDrafts[state.activeAgentConversationId]
  if (existingDraft) {
    const draftHasChanges =
      existingDraft.prompt !== draft.prompt ||
      existingDraft.inputImages.length !== draft.inputImages.length ||
      existingDraft.inputImages.some((img, idx) => img.id !== draft.inputImages[idx]?.id) ||
      existingDraft.inputImageFolder?.path !== draft.inputImageFolder?.path ||
      JSON.stringify(existingDraft.maskDraft) !== JSON.stringify(draft.maskDraft) ||
      existingDraft.maskEditorImageId !== draft.maskEditorImageId

    if (!draftHasChanges) {
      return patch
    }
  }

  return {
    ...patch,
    agentInputDrafts: setAgentInputDraft(state.agentInputDrafts, state.activeAgentConversationId, draft),
  }
}

function getPersistableAgentInputDrafts(state: AppState) {
  const drafts = saveActiveAgentInputDrafts(state)
  const conversationIds = new Set(state.agentConversations.map((conversation) => conversation.id))
  const persistable: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (!conversationIds.has(conversationId) || isEmptyAgentInputDraft(draft)) continue
    persistable[conversationId] = {
      ...copyAgentInputDraft(draft),
      inputImages: draft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
    }
  }
  return persistable
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Mode
      appMode: 'gallery',
      controlConsoleSection: DEFAULT_CONTROL_CONSOLE_SECTION,
      setControlConsoleSection: (controlConsoleSection) => set({ controlConsoleSection }),
      projectTreeWorkbench: { open: false, focusId: null },
      openProjectTreeWorkbench: (focusId = null) => set({ projectTreeWorkbench: { open: true, focusId } }),
      closeProjectTreeWorkbench: () => set({ projectTreeWorkbench: { open: false, focusId: null } }),
      setAppMode: (appMode) => {
        if (appMode === 'gallery') {
          const state = get()
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          const galleryInputDraft = saveGalleryInputDraft(state)
          const restored = restoreGalleryInputDraftState(galleryInputDraft)
          set((state) => ({
            appMode,
            agentInputDrafts,
            galleryInputDraft,
            agentMobileHeaderVisible: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            agentEditingRoundId: null,
            ...restored,
          }))
          return
        }

        if (appMode === 'postprocess') {
          // 水印预设工作区：与素材库 / Agent 同级的第三个 tab。它没有输入栏，
          // 只需把两边的输入草稿存下来再切——否则从 Agent 切过来会丢掉正在写的那段提示词。
          const state = get()
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          const galleryInputDraft = saveGalleryInputDraft(state)
          set({ appMode, agentInputDrafts, galleryInputDraft, agentMobileHeaderVisible: true })
          return
        }

        if (appMode === 'daily') {
          // 每日生成：与中控台同款 —— 自带工作区、没有底部输入栏，
          // 切换时只需把两边正在写的提示词存下来。
          const state = get()
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          const galleryInputDraft = saveGalleryInputDraft(state)
          set({ appMode, agentInputDrafts, galleryInputDraft, agentMobileHeaderVisible: true })
          return
        }

        if (appMode === 'strategy' || appMode === 'ordering') {
          const state = get()
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          const galleryInputDraft = saveGalleryInputDraft(state)
          set({
            appMode,
            agentInputDrafts,
            galleryInputDraft,
            agentMobileHeaderVisible: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            agentEditingRoundId: null,
          })
          return
        }

        const state = get()
        const settings = normalizeSettings(state.settings)
        const agentProfile = getAgentTextApiProfile(settings)
        const agentValidationError = getAgentProfileValidationError(settings)

        if (!agentValidationError) {
          const galleryInputDraft = saveGalleryInputDraft(state)
          set((state) => ({
            appMode: 'agent',
            galleryInputDraft,
            agentMobileHeaderVisible: false,
            agentSidebarCollapsed: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            ...restoreAgentInputDraftState(state.agentInputDrafts, state.activeAgentConversationId),
          }))
          return
        }

        if (agentProfile.provider === 'openai' && agentProfile.apiMode !== 'responses') {
          state.setConfirmDialog({
            title: '需要 Responses API 配置',
            message: `Agent 配置「${agentProfile.name}」使用的是 Images API，仅支持生成图片，无 Agent 模式需要的对话能力。\n\n请前往 API 配置页，将 Agent 配置调整为 Responses API，或切换/新建一个支持 Responses API 的配置。`,
            confirmText: '去设置',
            cancelText: '取消',
            action: () => {
              useStore.getState().setShowSettings(true, 'agent')
            },
          })
          return
        }

        state.setConfirmDialog({
          title: 'Agent API 配置不完整',
          message: `${agentValidationError?.message ?? `Agent 配置「${agentProfile.name}」不支持 Responses API`}\n\n请前往 Agent 配置页完善配置。`,
          confirmText: '去设置',
          cancelText: '取消',
          action: () => {
            useStore.getState().setShowSettings(true, 'agent')
          },
        })
      },

      // Settings
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (s) =>
        set((st) => {
          const previous = normalizeSettings(st.settings)
          const incoming = s as Partial<AppSettings>
          const hasLegacyOverrides =
            incoming.baseUrl !== undefined ||
            incoming.apiKey !== undefined ||
            incoming.model !== undefined ||
            incoming.timeout !== undefined ||
            incoming.apiMode !== undefined ||
            incoming.codexCli !== undefined ||
            incoming.apiProxy !== undefined ||
            incoming.streamImages !== undefined ||
            incoming.streamPartialImages !== undefined
          const merged = normalizeSettings({ ...previous, ...incoming })
          if (hasLegacyOverrides && incoming.profiles === undefined) {
            merged.profiles = merged.profiles.map((profile) =>
              profile.id === merged.activeProfileId
                ? {
                    ...profile,
                    baseUrl: incoming.baseUrl ?? profile.baseUrl,
                    apiKey: incoming.apiKey ?? profile.apiKey,
                    model: incoming.model ?? profile.model,
                    timeout: incoming.timeout ?? profile.timeout,
                    apiMode:
                      incoming.apiMode === 'images' || incoming.apiMode === 'responses'
                        ? incoming.apiMode
                        : profile.apiMode,
                    codexCli: incoming.codexCli ?? profile.codexCli,
                    apiProxy: incoming.apiProxy ?? profile.apiProxy,
                    streamImages: incoming.streamImages ?? profile.streamImages,
                    streamPartialImages: incoming.streamPartialImages ?? profile.streamPartialImages,
                  }
                : profile,
            )
          }
          const settings = normalizeSettings(merged)
          setApiTransportMode(settings.apiTransportMode)
          const shouldClearReusedProfile =
            st.reusedTaskApiProfileId && settings.activeProfileId === st.reusedTaskApiProfileId
          return {
            settings,
            ...(shouldClearReusedProfile
              ? { reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
              : {}),
          }
        }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) =>
        set((st) => ({
          dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
            ? st.dismissedCodexCliPrompts
            : [...st.dismissedCodexCliPrompts, key],
        })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set((s) => syncActiveInputDraft(s, { prompt })),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          if (s.inputImages.length >= MAX_DIRECT_INPUT_IMAGES) return s
          return syncActiveInputDraft(s, { inputImages: [...s.inputImages, img] })
        }),
      replaceInputImage: (idx, img) => {
        let removedImageId: string | null = null
        set((s) => {
          if (idx < 0 || idx >= s.inputImages.length) return s
          const previous = s.inputImages[idx]
          if (!previous || previous.id === img.id) return s
          if (s.inputImages.some((item, itemIdx) => itemIdx !== idx && item.id === img.id)) return s
          removedImageId = previous.id
          const inputImages = s.inputImages.map((item, itemIdx) => (itemIdx === idx ? img : item))
          const shouldClearMask = previous.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, { [previous.id]: img.id }),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        })
        if (removedImageId) void deleteImageIfUnreferenced(removedImageId)
      },
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const inputImages = s.inputImages.filter((_, i) => i !== idx)
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) imageCache.delete(img.id)
          return syncActiveInputDraft(s, {
            inputImages: [],
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
            maskDraft: null,
            maskEditorImageId: null,
          })
        }),
      setInputImages: (imgs, options) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(
            imgs.slice(0, MAX_DIRECT_INPUT_IMAGES),
            s.maskDraft?.targetImageId,
          )
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, options?.equivalentImageIds),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return syncActiveInputDraft(s, {
            inputImages: images,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, images),
          })
        }),
      inputImageFolder: null,
      setInputImageFolder: (folder) =>
        set((s) => {
          if (folder) {
            for (const img of s.inputImages) imageCache.delete(img.id)
            return syncActiveInputDraft(s, {
              inputImageFolder: folder,
              inputImages: [],
              prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
              maskDraft: null,
              maskEditorImageId: null,
            })
          }
          return syncActiveInputDraft(s, { inputImageFolder: null })
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            maskDraft,
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
          })
        }),
      clearMaskDraft: () => set((s) => syncActiveInputDraft(s, { maskDraft: null })),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => {
        if (maskEditorImageId) dismissAllTooltips()
        set((s) => syncActiveInputDraft(s, { maskEditorImageId }))
      },
      galleryInputDraft: null,
      folderInputDrafts: {},
      // 素材库范围切换（项目文件夹隔离）：离开文件夹时保存其输入草稿；进入文件夹时恢复其草稿
      onAssetLibraryFolderScopeChange: (prevScope, nextScope) => {
        const state = get()
        const prevId =
          typeof prevScope === 'object' && prevScope !== null && (prevScope as { kind?: string }).kind === 'collection'
            ? ((prevScope as { id: string }).id ?? null)
            : null
        const nextId =
          typeof nextScope === 'object' && nextScope !== null && (nextScope as { kind?: string }).kind === 'collection'
            ? ((nextScope as { id: string }).id ?? null)
            : null
        const patches: Partial<AppState> = {}
        let folderInputDrafts = state.folderInputDrafts
        if (prevId && prevId !== nextId) {
          // 保存离开文件夹的输入草稿（含参数）
          folderInputDrafts = { ...folderInputDrafts, [prevId]: getFolderInputDraftFromState(state) }
        }
        if (nextId) {
          const draft = folderInputDrafts[nextId]
          if (draft) {
            patches.prompt = draft.prompt
            patches.params = draft.params
            patches.inputImages = draft.inputImages.map((img) => ({ ...img }))
            patches.inputImageFolder = draft.inputImageFolder ?? null
            patches.maskDraft = draft.maskDraft ? { ...draft.maskDraft } : null
            patches.maskEditorImageId = draft.maskEditorImageId
            patches.customOutputPath = draft.customOutputPath ?? ''
          } else {
            // 首次进入该文件夹：用当前输入初始化它的草稿（之后各自独立）
            folderInputDrafts = { ...folderInputDrafts, [nextId]: getFolderInputDraftFromState(state) }
          }
        }
        if (folderInputDrafts !== state.folderInputDrafts) patches.folderInputDrafts = folderInputDrafts
        if (Object.keys(patches).length > 0) set(patches)
      },

      customOutputPath: '',
      setCustomOutputPath: (path) => set((s) => syncActiveInputDraft(s, { customOutputPath: path })),

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => syncActiveInputDraft(s, { params: { ...s.params, ...p } })),
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      setReusedTaskApiProfile: (profileId, missing = false, profileName = null) =>
        set({
          reusedTaskApiProfileId: profileId,
          reusedTaskApiProfileName: profileName,
          reusedTaskApiProfileMissing: missing,
        }),

      // Agent
      agentConversations: [],
      agentConversationsLoaded: false,
      activeAgentConversationId: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: true,
      agentDesktopSidebarCollapsed: false,
      agentMobileHeaderVisible: false,
      agentEditingRoundId: null,
      agentEditingConversationId: null,
      agentGeneratingTitleIds: {},
      createAgentConversation: () => {
        const now = Date.now()
        const latestConversation = getLatestAgentConversation(get().agentConversations)
        if (latestConversation && isEmptyAgentConversation(latestConversation)) {
          set((state) => {
            const agentInputDrafts = saveActiveAgentInputDrafts(state)
            return {
              agentConversations: state.agentConversations.map((conversation) =>
                conversation.id === latestConversation.id
                  ? { ...conversation, order: 0, createdAt: now, updatedAt: now }
                  : { ...conversation, order: conversation.order + 1 },
              ),
              activeAgentConversationId: latestConversation.id,
              agentInputDrafts,
              agentSidebarCollapsed: true,
              agentEditingRoundId: null,
              ...restoreAgentInputDraftState(agentInputDrafts, latestConversation.id),
            }
          })
          return latestConversation.id
        }

        const conversation = createAgentConversation(now)
        set((state) => {
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          return {
            agentConversations: [
              conversation,
              ...state.agentConversations.map((item) => ({ ...item, order: item.order + 1 })),
            ],
            activeAgentConversationId: conversation.id,
            agentInputDrafts,
            agentSidebarCollapsed: true,
            agentEditingRoundId: null,
            ...restoreAgentInputDraftState(agentInputDrafts, conversation.id),
          }
        })
        return conversation.id
      },
      setActiveAgentConversationId: (id) =>
        set((state) => {
          if (state.activeAgentConversationId === id) {
            return state
          }
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          return {
            activeAgentConversationId: id,
            agentInputDrafts,
            agentSidebarCollapsed: true,
            agentEditingRoundId: null,
            ...restoreAgentInputDraftState(agentInputDrafts, id),
          }
        }),
      setActiveAgentRoundId: (conversationId, roundId) =>
        set((state) => ({
          agentConversations: state.agentConversations.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, activeRoundId: roundId, updatedAt: Date.now() }
              : conversation,
          ),
        })),
      renameAgentConversation: (id, title) =>
        set((state) => ({
          agentConversations: state.agentConversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
          ),
        })),
      deleteAgentConversation: (id) =>
        set((state) => {
          // 删除对话时清理其所有消息的 flush 定时器与流式文本残留，避免内存泄漏。
          const conversationToDelete = state.agentConversations.find((conversation) => conversation.id === id)
          if (conversationToDelete) {
            for (const message of conversationToDelete.messages) {
              clearAgentTextFlushTimer(id, message.id)
            }
            useRuntimeStore.getState().clearAgentStreamingText(id)
          }
          const agentInputDrafts = { ...state.agentInputDrafts }
          delete agentInputDrafts[id]
          const activeDeleted = state.activeAgentConversationId === id
          const remainingConversations = state.agentConversations
            .filter((conversation) => conversation.id !== id)
            .map((conversation, index) => ({ ...conversation, order: index }))
          const nextActiveConversationId = activeDeleted
            ? (remainingConversations.find(
                (conversation) =>
                  conversation.order >=
                  (state.agentConversations.find((conversation) => conversation.id === id)?.order ?? 0),
              )?.id ??
              remainingConversations.at(-1)?.id ??
              null)
            : state.activeAgentConversationId
          return {
            agentConversations: remainingConversations,
            activeAgentConversationId: nextActiveConversationId,
            agentInputDrafts,
            ...(activeDeleted ? restoreAgentInputDraftState(agentInputDrafts, nextActiveConversationId) : {}),
          }
        }),
      reorderAgentConversations: (sourceId, targetId, position = 'before') =>
        set((state) => {
          if (sourceId === targetId) return state
          const conversations = [...state.agentConversations].sort((a, b) => a.order - b.order)
          const sourceIndex = conversations.findIndex((conversation) => conversation.id === sourceId)
          const targetIndex = conversations.findIndex((conversation) => conversation.id === targetId)
          if (sourceIndex < 0 || targetIndex < 0) return state
          const [source] = conversations.splice(sourceIndex, 1)
          const adjustedTargetIndex = conversations.findIndex((conversation) => conversation.id === targetId)
          conversations.splice(position === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex, 0, source)
          return { agentConversations: conversations.map((conversation, index) => ({ ...conversation, order: index })) }
        }),
      setAgentSidebarCollapsed: (agentSidebarCollapsed) => set({ agentSidebarCollapsed }),
      setAgentDesktopSidebarCollapsed: (agentDesktopSidebarCollapsed) => set({ agentDesktopSidebarCollapsed }),
      setAgentMobileHeaderVisible: (agentMobileHeaderVisible) => set({ agentMobileHeaderVisible }),
      setAgentEditingRoundId: (agentEditingRoundId) => set({ agentEditingRoundId }),
      setAgentEditingConversationId: (agentEditingConversationId) => set({ agentEditingConversationId }),

      // Tasks
      tasks: [],
      setTasks: (tasks) =>
        set(() => ({
          tasks,
          ...(countSuccessfulOutputImages(tasks) <= SUPPORT_PROMPT_IMAGE_THRESHOLD
            ? { supportPromptSkippedForImportedData: false }
            : {}),
        })),
      favoriteCollections: [createDefaultFavoriteCollection()],
      setFavoriteCollections: (favoriteCollections) =>
        set((state) => {
          const nextCollections = ensureDefaultFavoriteCollection(normalizeFavoriteCollections(favoriteCollections))
          return {
            favoriteCollections: nextCollections,
            defaultFavoriteCollectionId: resolveDefaultFavoriteCollectionId(
              nextCollections,
              state.defaultFavoriteCollectionId,
            ),
          }
        }),
      defaultFavoriteCollectionId: DEFAULT_FAVORITE_COLLECTION_ID,
      setDefaultFavoriteCollectionId: (defaultFavoriteCollectionId) =>
        set((state) =>
          defaultFavoriteCollectionId === null ||
          state.favoriteCollections.some((collection) => collection.id === defaultFavoriteCollectionId)
            ? { defaultFavoriteCollectionId }
            : state,
        ),
      activeFavoriteCollectionId: null,
      isManageCollectionsModalOpen: false,
      setActiveFavoriteCollectionId: (activeFavoriteCollectionId) =>
        set({ activeFavoriteCollectionId, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }),
      openManageCollectionsModal: () => set({ isManageCollectionsModalOpen: true }),
      closeManageCollectionsModal: () => set({ isManageCollectionsModalOpen: false }),
      favoritePickerTaskIds: null,
      openFavoritePicker: (taskIds) => {
        if (!taskIds.length) return
        dismissAllTooltips()
        set({ favoritePickerTaskIds: Array.from(new Set(taskIds)).filter(Boolean) })
      },
      closeFavoritePicker: () => set({ favoritePickerTaskIds: null }),
      schedule: createDefaultScheduleState(),
      setScheduleModalOpen: (modalOpen) =>
        set((state) => ({
          schedule: { ...state.schedule, modalOpen },
        })),
      setScheduleWeekStart: (activeWeekStart) =>
        set((state) => ({
          schedule: { ...state.schedule, activeWeekStart },
        })),
      startScheduleWeek: (weekStart) =>
        set((state) => ({
          schedule: {
            ...state.schedule,
            runningWeekStarts: Array.from(new Set([...state.schedule.runningWeekStarts, weekStart])).sort(),
          },
        })),
      stopScheduleWeek: (weekStart) =>
        set((state) => ({
          schedule: {
            ...state.schedule,
            runningWeekStarts: state.schedule.runningWeekStarts.filter((item) => item !== weekStart),
          },
        })),
      copyPreviousWeekSchedule: () => {
        const copiedIds: string[] = []
        set((state) => {
          const activeWeekStart = state.schedule.activeWeekStart
          const previousWeekStart = addScheduleDays(activeWeekStart, -7)
          const activeWeekEnd = addScheduleDays(activeWeekStart, 6)
          const previousWeekEnd = addScheduleDays(previousWeekStart, 6)
          const activeItems = state.schedule.items.filter(
            (item) => item.date >= activeWeekStart && item.date <= activeWeekEnd,
          )
          const previousItems = state.schedule.items
            .filter((item) => item.date >= previousWeekStart && item.date <= previousWeekEnd)
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date) || a.rowId.localeCompare(b.rowId) || a.order - b.order)
          const orderByCell = new Map<string, number>()
          for (const item of activeItems) {
            const key = `${item.date}:${item.rowId}`
            orderByCell.set(key, Math.max(orderByCell.get(key) ?? -1, item.order))
          }
          const copiedItems = previousItems.map((item) => {
            const nextDate = addScheduleDays(item.date, 7)
            const cellKey = `${nextDate}:${item.rowId}`
            const order = (orderByCell.get(cellKey) ?? -1) + 1
            orderByCell.set(cellKey, order)
            const id = genId()
            copiedIds.push(id)
            return {
              id,
              taskId: item.taskId,
              collectionId: item.collectionId,
              date: nextDate,
              rowId: item.rowId,
              order,
              count: item.count,
              time: item.time,
              status: 'idle' as const,
            }
          })
          if (copiedItems.length === 0) return state
          return {
            schedule: {
              ...state.schedule,
              items: [...state.schedule.items, ...copiedItems],
            },
          }
        })
        return copiedIds
      },
      addScheduleRow: () => {
        const id = genId()
        set((state) => ({
          schedule: {
            ...state.schedule,
            rows: [
              ...state.schedule.rows,
              {
                id,
                name: `任务 ${state.schedule.rows.length + 1}`,
                order: state.schedule.rows.length,
              },
            ],
          },
        }))
        return id
      },
      updateScheduleRow: (id, name) =>
        set((state) => {
          const normalizedName = name.trim()
          if (!normalizedName) return state
          return {
            schedule: {
              ...state.schedule,
              rows: state.schedule.rows.map((row) => (row.id === id ? { ...row, name: normalizedName } : row)),
            },
          }
        }),
      removeScheduleRow: (id) =>
        set((state) => {
          if (state.schedule.rows.length <= 1) return state
          const rows = state.schedule.rows.filter((row) => row.id !== id)
          if (rows.length === state.schedule.rows.length) return state
          return {
            schedule: {
              ...state.schedule,
              rows: rows.map((row, index) => ({ ...row, order: index })),
              items: state.schedule.items.filter((item) => item.rowId !== id),
            },
          }
        }),
      addScheduleItem: (item) => {
        const id = genId()
        set((state) => {
          const sameCellItems = state.schedule.items.filter(
            (existing) => existing.date === item.date && existing.rowId === item.rowId,
          )
          const order = item.order ?? sameCellItems.reduce((max, existing) => Math.max(max, existing.order), -1) + 1
          const nextItem: ScheduleItem = {
            id,
            taskId: item.taskId,
            collectionId: item.collectionId,
            date: item.date,
            rowId: item.rowId,
            order,
            count: Math.max(1, Math.floor(item.count || 1)),
            time: item.time || null,
            status: 'idle',
          }
          return {
            schedule: {
              ...state.schedule,
              items: [...state.schedule.items, nextItem],
            },
          }
        })
        return id
      },
      updateScheduleItem: (id, patch) =>
        set((state) => ({
          schedule: {
            ...state.schedule,
            items: state.schedule.items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    ...patch,
                    count: patch.count === undefined ? item.count : Math.max(1, Math.floor(patch.count || 1)),
                    time: patch.time === undefined ? item.time : patch.time || null,
                  }
                : item,
            ),
          },
        })),
      removeScheduleItem: (id) =>
        set((state) => ({
          schedule: {
            ...state.schedule,
            items: state.schedule.items.filter((item) => item.id !== id),
          },
        })),
      updateTaskFavoriteOutputPath: (taskId, outputPath) =>
        set((state) => {
          const patchTask = (task: TaskRecord) =>
            task.id === taskId
              ? {
                  ...task,
                  favoriteOutputPath: task.favoriteOutputUseDateVariable
                    ? applyFavoriteOutputDateVariable(outputPath, true)
                    : outputPath,
                }
              : task
          return {
            tasks: state.tasks.map(patchTask),
            workspaceTabs: state.workspaceTabs.map((tab) => ({
              ...tab,
              tasks: tab.tasks.map(patchTask),
            })),
          }
        }),
      updateTaskFavoriteOutputDateVariable: (taskId, enabled) =>
        set((state) => {
          const patchTask = (task: TaskRecord) =>
            task.id === taskId
              ? {
                  ...task,
                  favoriteOutputPath: applyFavoriteOutputDateVariable(task.favoriteOutputPath, enabled),
                  favoriteOutputUseDateVariable: enabled,
                }
              : task
          return {
            tasks: state.tasks.map(patchTask),
            workspaceTabs: state.workspaceTabs.map((tab) => ({
              ...tab,
              tasks: tab.tasks.map(patchTask),
            })),
          }
        }),
      runScheduleItem: async (id, now = new Date(), countOverride, appendToLastTaskIds = false) => {
        const state = useStore.getState()
        const item = state.schedule.items.find((scheduleItem) => scheduleItem.id === id)
        if (!item) return null
        const sourceTask = state.tasks.find((task) => task.id === item.taskId)
        if (!sourceTask || !sourceTask.isFavorite) {
          const message = '日程任务引用的收藏任务不存在'
          useStore.getState().updateScheduleItem(id, {
            status: 'error',
            lastError: message,
          })
          state.showToast(message, 'error')
          return null
        }

        useStore.getState().updateScheduleItem(id, {
          status: 'queued',
          lastError: undefined,
        })

        const inputImages = sourceTask.inputImageFolderPath
          ? []
          : (
              await Promise.all(
                sourceTask.inputImageIds.map(async (imageId) => {
                  const dataUrl = getCachedImage(imageId) || (await getImage(imageId))?.dataUrl
                  return dataUrl ? { id: imageId, dataUrl } : null
                }),
              )
            ).filter((image): image is InputImage => Boolean(image))
        const inputImageFolder = sourceTask.inputImageFolderPath
          ? { path: sourceTask.inputImageFolderPath, imageIds: sourceTask.inputImageIds }
          : null
        const maskDataUrl = sourceTask.maskImageId
          ? getCachedImage(sourceTask.maskImageId) || (await getImage(sourceTask.maskImageId))?.dataUrl
          : null
        const maskDraft =
          sourceTask.maskTargetImageId && maskDataUrl
            ? { targetImageId: sourceTask.maskTargetImageId, maskDataUrl, updatedAt: now.getTime() }
            : null
        const outputTarget = resolveScheduleOutputTarget({
          favoriteOutputPath: sourceTask.favoriteOutputPath,
          collectionId: item.collectionId,
          taskCollectionIds: sourceTask.favoriteCollectionIds,
          collections: state.favoriteCollections,
          defaultCollectionId: state.defaultFavoriteCollectionId,
        })

        try {
          const runCount = Math.max(1, Math.floor((countOverride ?? item.count) || 1))
          const taskId = await submitTaskWithData(
            {
              prompt: sourceTask.prompt,
              inputImages,
              inputImageFolder,
              params: { ...sourceTask.params, n: runCount },
              maskDraft,
              scheduledOutputPath: 'path' in outputTarget ? outputTarget.path : undefined,
              scheduledOutputSubFolder: 'subFolder' in outputTarget ? outputTarget.subFolder : undefined,
            },
            { useCurrentApiProfileWhenReusedMissing: true, skipFolderCapture: true },
          )
          if (!taskId) {
            useStore.getState().updateScheduleItem(id, { status: 'idle' })
            return null
          }
          const latestItem = useStore.getState().schedule.items.find((scheduleItem) => scheduleItem.id === id)
          useStore.getState().updateScheduleItem(id, {
            status: 'running',
            lastRunKey: getScheduleRunKey(item),
            lastTaskIds: appendToLastTaskIds ? [...(latestItem?.lastTaskIds ?? []), taskId] : [taskId],
            lastError: undefined,
          })
          return taskId
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          useStore.getState().updateScheduleItem(id, {
            status: 'error',
            lastRunKey: getScheduleRunKey(item),
            lastError: message,
          })
          state.showToast(message, 'error')
          return null
        }
      },
      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) =>
        set(
          filterFavorite
            ? { filterFavorite, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }
            : {
                filterFavorite,
                activeFavoriteCollectionId: null,
                selectedTaskIds: [],
                selectedFavoriteCollectionIds: [],
              },
        ),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) =>
        set((s) => ({
          selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater,
        })),
      toggleTaskSelection: (id, force) =>
        set((s) => {
          const isSelected = s.selectedTaskIds.includes(id)
          const shouldSelect = force !== undefined ? force : !isSelected
          if (shouldSelect === isSelected) return s
          return {
            selectedTaskIds: shouldSelect ? [...s.selectedTaskIds, id] : s.selectedTaskIds.filter((x) => x !== id),
          }
        }),
      clearSelection: () => set({ selectedTaskIds: [] }),
      selectedFavoriteCollectionIds: [],
      setSelectedFavoriteCollectionIds: (updater) =>
        set((s) => ({
          selectedFavoriteCollectionIds:
            typeof updater === 'function' ? updater(s.selectedFavoriteCollectionIds) : updater,
        })),
      toggleFavoriteCollectionSelection: (id, force) =>
        set((s) => {
          const isSelected = s.selectedFavoriteCollectionIds.includes(id)
          const shouldSelect = force !== undefined ? force : !isSelected
          if (shouldSelect === isSelected) return s
          return {
            selectedFavoriteCollectionIds: shouldSelect
              ? [...s.selectedFavoriteCollectionIds, id]
              : s.selectedFavoriteCollectionIds.filter((x) => x !== id),
          }
        }),
      clearFavoriteCollectionSelection: () => set({ selectedFavoriteCollectionIds: [] }),

      // UI
      detailTaskId: null,
      detailImageId: null,
      detailReturnToSchedule: false,
      setDetailTaskId: (detailTaskId, options) => {
        if (detailTaskId) dismissAllTooltips()
        set((state) => {
          if (detailTaskId) {
            return {
              detailTaskId,
              detailImageId: options?.imageId ?? null,
              detailReturnToSchedule: Boolean(options?.returnToSchedule),
            }
          }
          return {
            detailTaskId: null,
            detailImageId: null,
            detailReturnToSchedule: false,
            schedule: state.detailReturnToSchedule ? { ...state.schedule, modalOpen: true } : state.schedule,
          }
        })
      },
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) => {
        if (lightboxImageId) dismissAllTooltips()
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) })
      },
      showSettings: false,
      settingsTabRequest: null,
      setShowSettings: (showSettings, settingsTabRequest) => {
        if (showSettings) dismissAllTooltips()
        set({
          showSettings,
          ...(settingsTabRequest ? { settingsTabRequest } : {}),
          ...(!showSettings ? { settingsTabRequest: null } : {}),
        })
      },
      supportPromptDismissed: false,
      supportPromptSkippedForImportedData: false,

      // Toast
      toast: null,
      showToast: (message, type = 'info', action) => {
        const toastMessage = getToastMessage(message, type)
        // 用户刚亲手关掉过同一句话 ⇒ 不再重播，否则「关掉」的下一秒就被下一条同款顶回来
        if (toastReplayGuard.isSuppressed(toastMessage)) return
        const toast = { message: toastMessage, type, action: action ?? undefined }
        set({ toast })
        // 带操作按钮的 toast 停留更久，给用户点击时间
        setTimeout(
          () => {
            set((s) => (s.toast === toast ? { toast: null } : s))
          },
          action ? 6000 : 3000,
        )
      },
      // 清空时不必取消上面那个定时器：它到点会比对 `s.toast === toast`，引用已变就什么都不做
      clearToast: () => {
        const current = get().toast
        if (!current) return
        // 记下「用户亲手关掉了什么」——同文案在窗口内不再重播（见 toastReplayGuard）
        toastReplayGuard.rememberDismissed(current.message)
        set({ toast: null })
      },

      // SOP 管理中心跳转请求
      sopCenterJump: null,
      requestSopCenterJump: (itemId) =>
        set((state) => ({ sopCenterJump: { itemId, nonce: (state.sopCenterJump?.nonce ?? 0) + 1 } })),

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => {
        if (confirmDialog) dismissAllTooltips()
        set({ confirmDialog })
      },

      // Prompt input
      promptInputDialog: null,
      setPromptInputDialog: (config) => {
        if (config) dismissAllTooltips()
        set({ promptInputDialog: config })
      },

      // Random prompt generator

      // Workspace tabs
      workspaceTabs: [],
      activeWorkspaceTabId: null,
      workspaceTabGroups: [],
      selectedWorkspaceTabIds: [],
      workspaceTabManagerOpen: false,
      setActiveWorkspaceTabId: (id) =>
        set((state) => {
          const currentTabId = state.activeWorkspaceTabId
          if (currentTabId === id) return state
          // Save current state to current tab
          const currentTab = currentTabId ? state.workspaceTabs.find((t) => t.id === currentTabId) : null
          const updatedTabs = currentTab
            ? state.workspaceTabs.map((t) =>
                t.id === currentTabId
                  ? {
                      ...t,
                      prompt: state.prompt,
                      inputImages: state.inputImages.map((img) => ({ ...img })),
                      inputImageFolder: state.inputImageFolder,
                      params: { ...state.params },
                      maskDraft: state.maskDraft,
                      maskEditorImageId: state.maskEditorImageId,
                      customOutputPath: state.customOutputPath,
                      updatedAt: Date.now(),
                    }
                  : t,
              )
            : state.workspaceTabs
          // Restore state from target tab
          const targetTab = id ? updatedTabs.find((t) => t.id === id) : null
          if (targetTab) {
            return {
              activeWorkspaceTabId: id,
              workspaceTabs: updatedTabs,
              prompt: targetTab.prompt,
              inputImages: targetTab.inputImages.map((img) => ({ ...img })),
              inputImageFolder: targetTab.inputImageFolder,
              params: { ...targetTab.params },
              maskDraft: targetTab.maskDraft,
              maskEditorImageId: targetTab.maskEditorImageId,
              customOutputPath: targetTab.customOutputPath,
              galleryInputDraft: null,
            }
          }
          return { activeWorkspaceTabId: id, workspaceTabs: updatedTabs }
        }),
      setSelectedWorkspaceTabIds: (updater) =>
        set((s) => ({
          selectedWorkspaceTabIds: typeof updater === 'function' ? updater(s.selectedWorkspaceTabIds) : updater,
        })),
      toggleWorkspaceTabSelection: (id, force) =>
        set((s) => {
          const isSelected = s.selectedWorkspaceTabIds.includes(id)
          const shouldSelect = force !== undefined ? force : !isSelected
          if (shouldSelect === isSelected) return s
          return {
            selectedWorkspaceTabIds: shouldSelect
              ? [...s.selectedWorkspaceTabIds, id]
              : s.selectedWorkspaceTabIds.filter((x) => x !== id),
          }
        }),
      clearWorkspaceTabSelection: () => set({ selectedWorkspaceTabIds: [] }),
      setWorkspaceTabManagerOpen: (open) => set({ workspaceTabManagerOpen: open }),
      createWorkspaceTab: () => {
        const state = get()
        const now = Date.now()
        const sourceTab = state.activeWorkspaceTabId
          ? state.workspaceTabs.find((t) => t.id === state.activeWorkspaceTabId)
          : null

        let newName = '默认'
        let counter = 1
        while (state.workspaceTabs.some((t) => t.name === newName)) {
          counter++
          newName = `默认 ${counter}`
        }

        const newTab: WorkspaceTab = {
          id: Math.random().toString(36).slice(2, 9),
          name: newName,
          groupId: null,
          prompt: sourceTab ? sourceTab.prompt : state.prompt,
          inputImages: sourceTab
            ? sourceTab.inputImages.map((img) => ({ ...img }))
            : state.inputImages.map((img) => ({ ...img })),
          inputImageFolder: sourceTab ? sourceTab.inputImageFolder : state.inputImageFolder,
          params: sourceTab ? { ...sourceTab.params } : { ...state.params },
          maskDraft: sourceTab ? sourceTab.maskDraft : state.maskDraft,
          maskEditorImageId: sourceTab ? sourceTab.maskEditorImageId : state.maskEditorImageId,
          customOutputPath: sourceTab ? sourceTab.customOutputPath : state.customOutputPath,
          tasks: [],
          createdAt: now,
          updatedAt: now,
          order: state.workspaceTabs.length,
        }
        set((s) => ({ workspaceTabs: [...s.workspaceTabs, newTab], activeWorkspaceTabId: newTab.id }))
        return newTab.id
      },
      closeWorkspaceTab: (id) =>
        set((state) => {
          const tabs = state.workspaceTabs.filter((t) => t.id !== id)
          if (tabs.length === 0) {
            // Create a default tab if all closed
            const now = Date.now()
            const defaultTab: WorkspaceTab = {
              id: Math.random().toString(36).slice(2, 9),
              name: '默认',
              groupId: null,
              prompt: state.prompt,
              inputImages: state.inputImages.map((img) => ({ ...img })),
              inputImageFolder: state.inputImageFolder,
              params: { ...state.params },
              maskDraft: state.maskDraft,
              maskEditorImageId: state.maskEditorImageId,
              customOutputPath: state.customOutputPath,
              tasks: [],
              createdAt: now,
              updatedAt: now,
              order: 0,
            }
            return {
              workspaceTabs: [defaultTab],
              activeWorkspaceTabId: defaultTab.id,
              selectedWorkspaceTabIds: state.selectedWorkspaceTabIds.filter((x) => x !== id),
            }
          }
          let nextActiveId = state.activeWorkspaceTabId
          if (state.activeWorkspaceTabId === id) {
            const closedIndex = state.workspaceTabs.findIndex((t) => t.id === id)
            const nextIndex = closedIndex < tabs.length ? closedIndex : tabs.length - 1
            nextActiveId = tabs[nextIndex]?.id ?? tabs[0]?.id ?? null
          }
          return {
            workspaceTabs: tabs,
            activeWorkspaceTabId: nextActiveId,
            selectedWorkspaceTabIds: state.selectedWorkspaceTabIds.filter((x) => x !== id),
          }
        }),
      duplicateWorkspaceTab: (id) => {
        const state = get()
        const tab = state.workspaceTabs.find((t) => t.id === id)
        if (!tab) return ''
        const now = Date.now()
        const newTab: WorkspaceTab = {
          ...tab,
          id: Math.random().toString(36).slice(2, 9),
          name: `${tab.name} - 副本`,
          inputImages: tab.inputImages.map((img) => ({ ...img })),
          params: { ...tab.params },
          customOutputPath: tab.customOutputPath,
          tasks: tab.tasks.map((t) => ({ ...t })),
          createdAt: now,
          updatedAt: now,
          order: state.workspaceTabs.length,
        }
        set((s) => ({ workspaceTabs: [...s.workspaceTabs, newTab] }))
        return newTab.id
      },
      renameWorkspaceTab: (id, name) =>
        set((s) => ({
          workspaceTabs: s.workspaceTabs.map((t) => (t.id === id ? { ...t, name, updatedAt: Date.now() } : t)),
        })),
      reorderWorkspaceTabs: (tabs) => set({ workspaceTabs: tabs.map((t, i) => ({ ...t, order: i })) }),
      createWorkspaceTabGroup: (name) => {
        const id = Math.random().toString(36).slice(2, 9)
        const group: WorkspaceTabGroup = { id, name, order: 0, collapsed: false }
        set((s) => ({
          workspaceTabGroups: [...s.workspaceTabGroups, group].map((g, i) => ({ ...g, order: i })),
        }))
        return id
      },
      renameWorkspaceTabGroup: (id, name) =>
        set((s) => ({
          workspaceTabGroups: s.workspaceTabGroups.map((g) => (g.id === id ? { ...g, name } : g)),
        })),
      deleteWorkspaceTabGroup: (id) =>
        set((s) => ({
          workspaceTabGroups: s.workspaceTabGroups.filter((g) => g.id !== id),
          workspaceTabs: s.workspaceTabs.map((t) => (t.groupId === id ? { ...t, groupId: null } : t)),
        })),
      moveWorkspaceTabToGroup: (tabId, groupId) =>
        set((s) => ({
          workspaceTabs: s.workspaceTabs.map((t) => (t.id === tabId ? { ...t, groupId } : t)),
        })),
      updateWorkspaceTabState: (id, patch) =>
        set((s) => ({
          workspaceTabs: s.workspaceTabs.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
        })),
      saveCurrentStateToActiveTab: () =>
        set((state) => {
          const currentTabId = state.activeWorkspaceTabId
          if (!currentTabId) return state
          const currentTab = state.workspaceTabs.find((t) => t.id === currentTabId)
          if (!currentTab) return state
          const hasChanges =
            currentTab.prompt !== state.prompt ||
            currentTab.inputImages.length !== state.inputImages.length ||
            currentTab.inputImages.some((img, idx) => img.id !== state.inputImages[idx]?.id) ||
            currentTab.inputImageFolder?.path !== state.inputImageFolder?.path ||
            JSON.stringify(currentTab.params) !== JSON.stringify(state.params) ||
            JSON.stringify(currentTab.maskDraft) !== JSON.stringify(state.maskDraft) ||
            currentTab.maskEditorImageId !== state.maskEditorImageId
          if (!hasChanges) return state
          return {
            workspaceTabs: state.workspaceTabs.map((t) =>
              t.id === currentTabId
                ? {
                    ...t,
                    prompt: state.prompt,
                    inputImages: state.inputImages.map((img) => ({ ...img })),
                    inputImageFolder: state.inputImageFolder,
                    params: { ...state.params },
                    maskDraft: state.maskDraft,
                    maskEditorImageId: state.maskEditorImageId,
                    customOutputPath: state.customOutputPath,
                    updatedAt: Date.now(),
                  }
                : t,
            ),
          }
        }),

      // 自动备份
      lastAutoBackupAt: 0,
      setLastAutoBackupAt: (t) => set({ lastAutoBackupAt: t }),
      lastAutoBackupError: null,
      setLastAutoBackupError: (lastAutoBackupError) => set({ lastAutoBackupError }),
      firstBackupReminderShown: false,
      setFirstBackupReminderShown: (v) => set({ firstBackupReminderShown: v }),
      backupReminderCount: 0,
      setBackupReminderCount: (v) => set({ backupReminderCount: v }),

      // Agent 流式文本缓冲（不参与持久化）
    }),
    {
      name: 'tangbao',
      version: 4,
      migrate: (persistedState, version) => migratePersistedState(persistedState, version),
      partialize: getPersistedState,
      merge: mergePersistedState,
      storage: createDesktopJsonStorage('zustand', {
        read: async () => {
          const api = window.electronAPI
          if (!api) return null
          const fileName = 'tangbao.json'
          const defaultPath = await api.getDefaultPath()
          const filePath = api.getStateFilePath
            ? await api.getStateFilePath()
            : defaultPath.replace(/[\\/]local-saves$/, '') + '/' + fileName
          return api.readJsonText(filePath)
        },
      }),
    },
  ),
)

useStore.subscribe((state, previous) => {
  if (state.settings !== previous.settings) scheduleApiSecretsPersist(normalizeSettings(state.settings))
})

let lastStoredAgentConversations = useStore.getState().agentConversations
let agentConversationPersistRunning = false
let agentConversationPersistQueued = false
let agentConversationPersistDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function flushAgentConversationsToIndexedDB() {
  if (agentConversationPersistRunning) {
    agentConversationPersistQueued = true
    return
  }

  agentConversationPersistRunning = true
  try {
    do {
      agentConversationPersistQueued = false
      const conversations = useStore.getState().agentConversations
      await replaceStoredAgentConversations(conversations)
      lastStoredAgentConversations = conversations
    } while (agentConversationPersistQueued || useStore.getState().agentConversations !== lastStoredAgentConversations)
  } finally {
    agentConversationPersistRunning = false
  }
}

useStore.subscribe((state) => {
  if (state.agentConversations === lastStoredAgentConversations) return
  if (!agentConversationPersistenceReady) {
    agentConversationPersistQueued = true
    return
  }
  // Debounce IndexedDB writes to avoid excessive serialization during streaming
  if (agentConversationPersistDebounceTimer) clearTimeout(agentConversationPersistDebounceTimer)
  agentConversationPersistDebounceTimer = setTimeout(() => {
    agentConversationPersistDebounceTimer = null
    void flushAgentConversationsToIndexedDB()
  }, 500)
})

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

function getPersistableRawResponsePayload(rawResponsePayload?: string) {
  if (!rawResponsePayload) return rawResponsePayload
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown }
    if (!Array.isArray(payload.output)) return rawResponsePayload
    const output = payload.output.map((item) =>
      isRecord(item) ? getPersistableResponseOutputItem(item as ResponsesOutputItem) : item,
    )
    return JSON.stringify({ ...payload, output }, null, 2)
  } catch {
    return rawResponsePayload
  }
}

function getPersistableTask(task: TaskRecord): TaskRecord {
  const rawResponsePayload = getPersistableRawResponsePayload(task.rawResponsePayload)
  return rawResponsePayload === task.rawResponsePayload ? task : { ...task, rawResponsePayload }
}

/** 从任务特征与工作区归属推导素材来源上下文。 */
function getAssetTaskContext(task: TaskRecord): AssetTaskContext {
  const state = useStore.getState()
  const tab = state.workspaceTabs.find((t) => t._taskIds?.includes(task.id) || t.tasks?.some((tk) => tk.id === task.id))
  return {
    sourceMode: getTaskSourceMode(task),
    workspaceTabId: tab?.id,
    workspaceTabName: tab?.name,
  }
}

/**
 * 串行素材同步队列：任务写库成功后异步 upsert 素材。
 * 崩溃场景由启动 reconcile 兜底补齐，因此这里失败不阻塞任务完成。
 */
const assetSyncQueue = createAssetSyncQueue({
  getTask: async (taskId) => useStore.getState().tasks.find((task) => task.id === taskId),
  syncTask: async (task) => {
    // 修复：参考图（输入图）不再自动归档成素材（archiveTaskReferences 已停用），
    // 素材库只收录生成输出；已归档的参考图素材由 referenceAssetCleanup 一次性清理。
    const updated = await upsertFromTask(task, getAssetTaskContext(task))
    if (updated.length > 0) {
      useAssetLibraryStore.getState().applyUpsertedAssets(updated)
    }
    // 批次任务产出即时自动归档到词库路径对应的项目文件夹（幂等，失败静默）
    if (task.sopBatch) {
      void import('./lib/assetAutoArchive')
        .then(async (module) => {
          const result = await module.archiveTaskToBatchFolder(task)
          if (result.archivedAssets > 0 || (result.createdCollections?.length ?? 0) > 0) {
            // 归档改动了素材的文件夹归属或新建了文件夹：把更新同步回素材库内存态
            // （applyUpsertedAssets 在归属变化时 bump mutationVersion），
            // 驱动桌面目录页重查并合并显示，无需切换文件夹即可看到新素材。
            const { getAssetsByIds } = await import('./lib/assetLibraryRepository')
            const updated = await getAssetsByIds(task.outputImages)
            if (updated.size > 0) useAssetLibraryStore.getState().applyUpsertedAssets([...updated.values()])
            const createdCollections = result.createdCollections
            if (createdCollections && createdCollections.length > 0) {
              useAssetLibraryStore.getState().upsertCollections(createdCollections)
            }
          }
        })
        .catch(() => {})
    }
  },
  onError: (taskId, error) => {
    // 这是「任务卡上有图、素材库里没有」的唯一线索（此前只有一行裸 console.error，
    // 事后无法判断失败发生在哪一步、哪个任务）——带上足以定位任务的上下文。
    const task = useStore.getState().tasks.find((item) => item.id === taskId)
    console.error('[asset-sync] 素材同步失败', {
      taskId,
      taskStatus: task?.status ?? '(任务已被删除)',
      outputCount: task?.outputImages?.length ?? 0,
      taskCreatedAt: task?.createdAt,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
  },
})

function enqueueAssetSync(taskId: string) {
  assetSyncQueue.enqueue(taskId)
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  const persistPromise = dbPutTask(getPersistableTask(task))
  void persistPromise.then(() => enqueueAssetSync(task.id)).catch(() => {})
  return persistPromise
}

/**
 * 批量持久化任务：Electron 下合并为一次跨进程提交（`app-data:put-many` 单事务），
 * 省掉逐条走「渲染→主进程→UtilityProcess→SQLite」的往返。
 * 语义与逐个 {@link putTask} 一致：先落盘，再逐个排入素材同步队列。
 */
export async function putTasks(tasks: TaskRecord[]): Promise<void> {
  if (tasks.length === 0) return
  await dbPutTasks(tasks.map((task) => getPersistableTask(task)))
  for (const task of tasks) enqueueAssetSync(task.id)
}

/**
 * 任务落盘带一次重试。
 *
 * `putTask` 是 fire-and-forget 的跨进程写（渲染 → 主进程 → UtilityProcess → SQLite），
 * 素材 worker 换代时在途请求会被直接 reject（见 `electron/catalog-client.ts` 的
 * `asset catalog worker restarted`）。丢一次写就意味着内存与磁盘永久不一致 ——
 * 素材是逐条 upsert 的所以仍然完整，而任务卡片按任务记录渲染，数量就少了。
 */
async function persistTaskWithRetry(task: TaskRecord): Promise<void> {
  try {
    await putTask(task)
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    try {
      await putTask(task)
    } catch (retryError) {
      // 两次都失败 = 这条任务在磁盘上永久缺失：重启后任务卡片会少一张，
      // 而它的素材仍会入库（素材是逐条 upsert 的）——即「素材在、任务卡不在」。
      // 光看界面无从判断，日志必须把这条因果写明。
      console.error('[task-persist] 任务落盘失败（已重试 1 次，内存与磁盘从此不一致）', {
        taskId: task.id,
        taskStatus: task.status,
        outputCount: task.outputImages?.length ?? 0,
        createdAt: task.createdAt,
        firstError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        retryError: retryError instanceof Error ? `${retryError.name}: ${retryError.message}` : String(retryError),
      })
    }
  }
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${profile.id}\n${profile.baseUrl}`
}

function isOpenAITask(task: TaskRecord) {
  return (task.apiProvider ?? 'openai') !== 'fal'
}

function isRunningOpenAITask(task: TaskRecord) {
  return task.status === 'running' && isOpenAITask(task)
}

function isAsyncCustomProviderTask(settings: AppSettings, provider: string, hasInputImages: boolean) {
  const customProvider = getCustomProviderDefinition(settings, provider)
  if (!customProvider?.poll) return false
  const submitMapping = hasInputImages && customProvider.editSubmit ? customProvider.editSubmit : customProvider.submit
  return Boolean(submitMapping.taskIdPath)
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    // 「卡先建、词后填」的预留卡：写提示词期间应用退出/崩溃，它既没有提示词、也没发出任何请求。
    // 不能按「生图请求中断」报（那会让人去查接口）—— 实际只是词没写出来。
    if (task.status === 'running' && task.promptPending) {
      const updated: TaskRecord = {
        ...task,
        status: 'error',
        promptPending: false,
        promptFailed: true,
        error: '提示词生成失败：应用在编写提示词时退出了',
        progressStage: 'stopped',
        progressUpdatedAt: now,
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: now,
        elapsed: Math.max(0, now - task.createdAt),
      }
      interruptedTasks.push(updated)
      return updated
    }
    const hasPersistedRemoteRequest = task.remoteGenerationRequests?.some(
      (request) =>
        (request.provider === 'fal' || request.provider === 'custom') &&
        Boolean(request.remoteRequestId) &&
        (request.status === 'submitted' || request.status === 'running'),
    )
    if (!isRunningOpenAITask(task) || task.customTaskId || hasPersistedRemoteRequest) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      progressStage: 'stopped',
      progressUpdatedAt: now,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

function clearOpenAIWatchdogTimer(taskId: string) {
  const timer = openAIWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  openAIWatchdogTimers.delete(taskId)
}

function failOpenAITaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return false

  const existingOutputImages = task.outputImages || []
  const hasSuccessfulImages = existingOutputImages.length > 0

  if (hasSuccessfulImages) {
    const totalRequested = task.params?.n ?? 1
    const successCount = existingOutputImages.length
    const failCount = Math.max(0, totalRequested - successCount)
    const batchItemStatuses: BatchItemStatus[] = Array.from({ length: totalRequested }, (_, i) =>
      i < successCount ? 'done' : 'error',
    )
    const batchItemErrors: BatchItemError[] = []
    for (let j = 0; j < failCount; j++) {
      batchItemErrors.push({ index: successCount + j, error })
    }

    updateTaskInStore(taskId, {
      status: 'done',
      error: undefined,
      batchItemStatuses,
      batchItemErrors: batchItemErrors.length > 0 ? batchItemErrors : undefined,
      falRecoverable: false,
      // 超时只是「先给用户一个交代」，请求可能还在飞；留下标记让迟到返回的真实结果仍能结算。
      watchdogTimedOutAt: now,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
    const totalCount = batchItemStatuses.length
    useStore.getState().showToast(`生成超时，${successCount}/${totalCount} 张成功`, 'info')
  } else {
    updateTaskInStore(taskId, {
      status: 'error',
      error,
      falRecoverable: false,
      // 同上：超时判定不代表请求真的失败，迟到结果仍应被收下。
      watchdogTimedOutAt: now,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return true
}

function scheduleOpenAIWatchdog(taskId: string, timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  clearOpenAIWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return

  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const timer = setTimeout(() => {
    openAIWatchdogTimers.delete(taskId)
    const failed = failOpenAITaskIfStillRunning(taskId, createOpenAITimeoutError(timeoutSeconds, profile))
    if (failed) useStore.getState().showToast('OpenAI 任务请求超时', 'error')
  }, timeoutMs)
  openAIWatchdogTimers.set(taskId, timer)
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: '开启',
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

function getFalRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === 'fal') return taskProfile
  return null
}

function getCustomRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const provider = task.apiProvider
  if (!provider || provider === 'openai' || provider === 'fal') return null
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === provider) return taskProfile
  return null
}

export function getTaskApiProfile(settings: AppSettings, task: TaskRecord): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  const provider = task.apiProvider

  if (!task.apiProfileId) return null

  const byId = normalized.profiles.find((profile) => profile.id === task.apiProfileId)
  if (byId && (!provider || byId.provider === provider)) return byId
  return null
}

function createSettingsForApiProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const normalized = normalizeSettings(settings)
  return normalizeSettings({
    ...normalized,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    profiles: normalized.profiles.map((item) => (item.id === profile.id ? profile : item)),
    activeProfileId: profile.id,
  })
}

function getReusedTaskApiProfile(settings: AppSettings, profileId: string | null): ApiProfile | null {
  if (!profileId) return null
  return normalizeSettings(settings).profiles.find((profile) => profile.id === profileId) ?? null
}

function getTaskApiProfileName(task: TaskRecord) {
  return task.apiProfileName || task.apiModel || '未知配置'
}

function isFalConnectionRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}

function isStreamingRelatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /流式|stream/i.test(message)
}

function getStreamingErrorHint(
  err: unknown,
  profile?: Pick<ApiProfile, 'provider' | 'apiMode' | 'streamImages' | 'streamPartialImages'> | null,
): string {
  if (profile?.streamImages !== true) return ''
  if (!isStreamingRelatedError(err)) return ''
  return '\n提示：这可能是当前接口不支持流式传输导致的，可尝试关闭「流式传输」功能后重试。'
}

function getApiModeApiName(apiMode: ApiMode) {
  return apiMode === 'responses' ? 'Responses API' : 'Image API'
}

function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: Pick<ApiProfile, 'provider' | 'apiMode' | 'streamImages' | 'streamPartialImages'> | null,
  hasInputImages = false,
): string | null {
  if (!isApiRequestNetworkError(err)) return null

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000)

  // 带参考图的编辑请求：中转站通常需要 1-3 分钟/张，短暂等待后断开属常见现象
  const slowEditHint = hasInputImages
    ? '\n提示：带参考图的图生图请求在中转站通常需要 1-3 分钟，若频繁中途断开，可尝试压缩参考图大小、把生成数量 n 设为 1，或咨询中转站是否限制了编辑接口的并发。'
    : ''

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return '提示：请求立即失败，请检查 API 代理服务是否正常运行。'
    }
    const unsupportedApiHint =
      profile?.provider === 'openai' ? `\n· API 不支持 ${getApiModeApiName(profile.apiMode)}` : ''
    return `提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行${unsupportedApiHint}\n· 接口不支持浏览器跨域请求，可使用 Docker 部署版或本地运行版并配置 API 代理解决${slowEditHint}`
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return `提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}${slowEditHint}`
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return `提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。${getTimeoutStreamingHint(profile)}${slowEditHint}`
  }

  return `提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}${slowEditHint}`
}

function getRawErrorPayload(err: unknown): Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'> {
  if (!(err instanceof Error)) return {}

  const rawImageUrls = 'rawImageUrls' in err ? (err as { rawImageUrls?: unknown }).rawImageUrls : undefined
  const rawResponsePayload =
    'rawResponsePayload' in err ? (err as { rawResponsePayload?: unknown }).rawResponsePayload : undefined
  return {
    rawImageUrls:
      Array.isArray(rawImageUrls) && rawImageUrls.length
        ? rawImageUrls.filter((url): url is string => typeof url === 'string')
        : undefined,
    rawResponsePayload: typeof rawResponsePayload === 'string' ? rawResponsePayload : undefined,
  }
}

function clearFalRecoveryTimer(taskId: string) {
  const timer = falRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  falRecoveryTimers.delete(taskId)
}

function scheduleFalRecovery(taskId: string, delayMs = FAL_RECOVERY_POLL_MS) {
  if (falRecoveryTimers.has(taskId) || falRecoveryInFlight.has(taskId)) return
  const timer = setTimeout(() => {
    falRecoveryTimers.delete(taskId)
    recoverFalTask(taskId)
  }, delayMs)
  falRecoveryTimers.set(taskId, timer)
}

function clearCustomRecoveryTimer(taskId: string) {
  const timer = customRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  customRecoveryTimers.delete(taskId)
}

function scheduleCustomRecovery(taskId: string, delayMs = CUSTOM_RECOVERY_POLL_MS) {
  if (customRecoveryTimers.has(taskId) || customRecoveryInFlight.has(taskId)) return
  const timer = setTimeout(() => {
    customRecoveryTimers.delete(taskId)
    recoverCustomTask(taskId)
  }, delayMs)
  customRecoveryTimers.set(taskId, timer)
}

function hasActualParams(params: Partial<TaskParams> | undefined): params is Partial<TaskParams> {
  return Boolean(params && Object.keys(params).length > 0)
}

function firstActualParams(
  paramsList: Array<Partial<TaskParams> | undefined> | undefined,
): Partial<TaskParams> | undefined {
  return paramsList?.find(hasActualParams)
}

function mapActualParamsByImage(outputIds: string[], paramsList: Array<Partial<TaskParams> | undefined> | undefined) {
  const mapped = paramsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && hasActualParams(params)) acc[imgId] = params
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

export interface PreparedGeneratedImage {
  dataUrl: string
  actualParams?: Partial<TaskParams>
}

/**
 * 预处理（后处理）但不写入存储。
 * 拆分自 {@link processAndStoreGeneratedImage}，用于先校验 / 去重，再决定是否 commit。
 */
async function prepareGeneratedImage(
  dataUrl: string,
  params: TaskParams,
  originalActualParams?: Partial<TaskParams>,
): Promise<PreparedGeneratedImage> {
  const processed = await postprocessGeneratedImage(dataUrl, params)
  const actualParams = mergePostprocessedActualParams(originalActualParams, processed.actualParams)
  return { dataUrl: processed.dataUrl, actualParams }
}

/** 仅在校验通过（非重复）后调用：写入 IndexedDB（及内存缓存）。返回 imageId。 */
async function commitGeneratedImage(prepared: PreparedGeneratedImage): Promise<string> {
  const imgId = await storeImage(prepared.dataUrl, 'generated')
  cacheImage(imgId, prepared.dataUrl)
  return imgId
}

async function processAndStoreGeneratedImage(
  dataUrl: string,
  params: TaskParams,
  originalActualParams?: Partial<TaskParams>,
): Promise<{ id: string; dataUrl: string; actualParams?: Partial<TaskParams> }> {
  const prepared = await prepareGeneratedImage(dataUrl, params, originalActualParams)
  const id = await commitGeneratedImage(prepared)
  return { id, dataUrl: prepared.dataUrl, actualParams: prepared.actualParams }
}

async function readImageSizeParam(dataUrl: string): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return undefined

  return new Promise((resolve) => {
    let settled = false
    const image = new Image()
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    }
    const timer = setTimeout(() => finish(undefined), 2000)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
      } else {
        finish(undefined)
      }
    }
    image.onerror = () => finish(undefined)
    image.src = dataUrl
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
    }
  })
}

async function readImageSizeParamsList(images: string[]): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)))
}

async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  if (preferred?.length === images.length && preferred.every(hasActualParams)) return preferred
  const fallback = await readImageSizeParamsList(images)
  return images.map((_, index) => (hasActualParams(preferred?.[index]) ? preferred?.[index] : fallback[index]))
}

async function completeRecoveredFalTask(task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  // 任务被停止/删除后 falRecoverable 会被置 false，此时不得把任务"复活"为 done。
  if (!latest || latest.status === 'done' || latest.falRecoverable !== true) return

  const originalActualParamsList = await resolveImageSizeParamsList(result.images, result.actualParamsList)
  const outputIds: string[] = []
  const actualParamsList: Array<Partial<TaskParams> | undefined> = []
  for (let i = 0; i < result.images.length; i++) {
    const stored = await processAndStoreGeneratedImage(result.images[i], task.params, originalActualParamsList[i])
    outputIds.push(stored.id)
    actualParamsList.push(stored.actualParams)
  }

  // 恢复查询可能只带回一部分图片（例如生成过程中已经就地产出过几张）：不得把已有产出覆盖掉。
  const restoredOutputIds = pickMoreCompleteOutputIds(outputIds, latest.outputImages ?? [])
  updateTaskInStore(
    task.id,
    {
      outputImages: restoredOutputIds,
      actualParams: firstActualParams(actualParamsList),
      actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
      revisedPromptByImage: undefined,
      status: 'done',
      error: null,
      falRecoverable: false,
      watchdogTimedOutAt: undefined,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    },
    (current) => current.falRecoverable === true,
  )
  useStore.getState().showToast(`fal.ai 任务已恢复，共 ${restoredOutputIds.length} 张图片`, 'success')
  if (!isAgentTask(task))
    showTaskCompletionNotification('图像生成完成', `fal.ai 任务已恢复，共 ${restoredOutputIds.length} 张图片。`)
  else void continueRecoveredAgentRound(task.id)
  void saveTaskToLocalFS(task.id)
}

async function recoverFalTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || task.apiProvider !== 'fal' || !task.falRequestId || !task.falEndpoint || task.status === 'done') return
  if (task.falRecoverable !== true) return
  if (falRecoveryInFlight.has(taskId)) return
  falRecoveryInFlight.add(taskId)

  const profile = getFalRecoveryProfile(settings, task)
  if (!profile) {
    falRecoveryInFlight.delete(taskId)
    scheduleFalRecovery(taskId)
    return
  }

  try {
    const result = await getFalQueuedImageResult(profile, task.falEndpoint, task.falRequestId, task.params)
    clearFalRecoveryTimer(taskId)
    await completeRecoveredFalTask(task, result)
  } catch (err) {
    if (isFalConnectionRecoverableError(err)) {
      // 先移出在途集合再调度，否则 scheduleFalRecovery 会因在途检查而跳过重试。
      falRecoveryInFlight.delete(taskId)
      scheduleFalRecovery(taskId)
    } else {
      clearFalRecoveryTimer(taskId)
      updateTaskInStore(taskId, {
        status: 'error',
        error: getFalErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)),
        ...getRawErrorPayload(err),
        falRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      if (isAgentTask(task)) void continueRecoveredAgentRound(taskId)
    }
  } finally {
    falRecoveryInFlight.delete(taskId)
  }
}

export function ensureImageStorageMigrated(): Promise<number> {
  if (!isElectronEnv()) return Promise.resolve(0)
  imageStorageMigrationPromise ??= (async () => {
    let migrated = 0
    const failedImageIds = new Set<string>()
    await runMigration(
      'electron-image-files-v1',
      {
        get: getMigrationJournal,
        put: putMigrationJournal,
      },
      async ({ checkpoint }) => {
        migrated = await migrateLegacyImages({
          readBatch: getLegacyImageBatch,
          saveImage: (image) =>
            image.dataUrl ? saveRawCacheImageToLocal(image.id, image.dataUrl) : Promise.resolve(null),
          replaceImage: putImage,
          onProgress: (count) => checkpoint(String(count)),
          onFailure: (image) => failedImageIds.add(image.id),
        })
      },
    )
    if (failedImageIds.size > 0) {
      useStore.getState().showToast(`有 ${failedImageIds.size} 张历史图片无法迁移，已跳过且保留原数据`, 'error')
    }
    return migrated
  })().catch((error) => {
    imageStorageMigrationPromise = null
    throw error
  })
  return imageStorageMigrationPromise
}

export async function retryGeneratedAssetLibraryMigration(
  seedTasks?: TaskRecord[],
  seedTabs?: WorkspaceTab[],
): Promise<void> {
  useAssetLibraryStore.setState({ migrationStatus: 'running', migrationError: null, migrationProgress: null })
  const tasks = seedTasks ?? (await getAllTasks())
  const workspaceTabs = seedTabs ?? useStore.getState().workspaceTabs
  const journal = { get: getMigrationJournal, put: putMigrationJournal }
  try {
    await runGeneratedAssetLibraryMigration(journal, {
      tasks,
      workspaceTabs,
      shadowTaskIds: identifyShadowFavoriteTasks(tasks, workspaceTabs),
    })
    await runLegacyFavoritesToAssetsMigration(journal, {
      tasks,
      workspaceTabs,
      favoriteCollections: useStore.getState().favoriteCollections,
      defaultFavoriteCollectionId: useStore.getState().defaultFavoriteCollectionId,
    })
    // 旧版「标签页 → 磁盘图片文件夹」→ 项目文件夹：扫描保存根目录 images/ 下的子文件夹（标签 2/3/4、短剧…），
    // 建成同名项目文件夹，并把文件夹内的历史图片导入素材库归入对应文件夹（内容去重，磁盘原文件保留）。
    // 注：AssetTag（自动打标标签）不做迁移——那些是图像内容自动标签，不是用户的组织标签，转成文件夹会再次搞乱归属。
    await runLegacyImageFoldersToCollectionsMigration(journal, {
      onProgress: (done, total) => useAssetLibraryStore.setState({ migrationProgress: { done, total } }),
    })
    // 启动对账（幂等兜底）：增量游标只处理上次未覆盖/未终结的任务，避免每次启动全量重扫上万任务。
    // 游标持久化到独立 journal：仅「全部成功且已推进」时写回；失败或未终结时不推进（下次继续补齐）。
    const reconcileJournalId = 'generated-asset-reconcile-v1'
    const pendingJournalId = 'generated-asset-reconcile-pending-v1'
    const [prevReconcileJournal, prevPendingJournal] = await Promise.all([
      getMigrationJournal(reconcileJournalId),
      getMigrationJournal(pendingJournalId),
    ])
    let pendingTaskIds: string[] = []
    try {
      pendingTaskIds = prevPendingJournal?.sourceBackup ? (JSON.parse(prevPendingJournal.sourceBackup) as string[]) : []
    } catch {
      pendingTaskIds = []
    }
    const result = await reconcileGeneratedAssets({
      tasks,
      workspaceTabs,
      batchSize: 100,
      cursor: prevReconcileJournal?.cursor ?? null,
      pendingTaskIds,
      onProgress: (done, total) => useAssetLibraryStore.setState({ migrationProgress: { done, total } }),
    })
    if (result.failedTasks > 0) {
      // 红条文案必须能直接拿去定位：只说「N 个任务索引失败」时用户与事后排查都无从下手。
      // 带上前几个任务 id（完整清单在 [asset-reconcile] 日志里）。
      const sample = result.failedTaskIds.slice(0, 3).join('、')
      throw new Error(`${result.failedTasks} 个任务索引失败${sample ? `（如 ${sample}）` : ''}`)
    }
    // 持久化：游标（成功后推进）+ 未终结任务 id（下次强制重扫）
    if (result.nextCursor) {
      await putMigrationJournal({
        id: reconcileJournalId,
        status: 'completed',
        cursor: result.nextCursor,
        updatedAt: Date.now(),
      })
    }
    await putMigrationJournal({
      id: pendingJournalId,
      status: result.pendingTaskIds.length > 0 ? 'running' : 'completed',
      sourceBackup: result.pendingTaskIds.length > 0 ? JSON.stringify(result.pendingTaskIds) : undefined,
      updatedAt: Date.now(),
    })
    await useAssetLibraryStore.getState().hydrate()
    // 内置「产品线 - 产品 - 方向」三级结构：首次启动写入一次（走迁移 journal，
    // 用户此后删除/改名/移动的内置文件夹不会被自动重建），需要找回时走设置页的显式补齐入口。
    try {
      const { runBuiltinProjectTreeMigration } = await import('./lib/builtinProjectTreeSync')
      const builtinCollections = await runBuiltinProjectTreeMigration()
      if (builtinCollections.length > 0) {
        useAssetLibraryStore.getState().upsertCollections(builtinCollections)
      }
    } catch (error) {
      console.warn('[builtin-project-tree] 内置结构写入失败', error)
    }
    // 项目文件夹树是唯一主源：挂上变化订阅并做一次全量对齐，把结构镜像到 SOP 管理分组树（只增不删）。
    void import('./lib/sopGroupSync').then((module) => {
      module.installSopGroupMirrorAutoSync()
      module.requestSopGroupMirrorSync()
    })
    // 一次性清理历史遗留的"参考图素材"（幂等；下次启动无残留时直接返回 0）
    await import('./lib/referenceAssetCleanup')
      .then((module) => module.cleanupReferenceOnlyAssets())
      .catch((error) => console.warn('[reference-asset-cleanup] 清理失败', error))
    useAssetLibraryStore.setState({ migrationStatus: 'done', migrationError: null, migrationProgress: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useAssetLibraryStore.setState({ migrationStatus: 'error', migrationError: message, migrationProgress: null })
    throw error
  }
}

/** 初始化：从 IndexedDB 加载任务，按需恢复输入图片，并清理孤立图片 */
export async function initStore(options: { safeMode?: boolean } = {}) {
  /**
   * 重新放行历史记录里出现过的输出目录（TB-115）。放在**最前面**：用户一进界面就可能去点
   * 历史记录上的「打开输出位置」，那时白名单必须已经补齐。
   *
   * 修的是一个**只在重启后才暴露**的坑：主进程路径白名单里的 `sessionAllowedRoots` 是内存 Set、
   * 重启即清空；`localSavePath` / `configSyncPath` 两条会从本地设置读回来，而后处理的自定义
   * 输出目录（多半是内网共享盘）**不属于这两条** —— 产出那一次靠
   * `composite:authorize-output-directory` 放行，重启后就再没人放行它了。于是历史记录上那个
   * 按钮会被 `assertAllowedPath` 拒掉，用户看到的是「昨天还能打开，今天点不动了」。
   *
   * 刻意**不**放行「配置里写的目录」而是「历史里真的写出过文件的目录」：后者是可信来源
   * （用户亲自配过、产出确实落在那里），前者可能只是一条手滑打错的路径。
   */
  if (!options.safeMode) void authorizeHistoryOutputDirs()

  const legacyAgentConversations = normalizeAgentConversations(useStore.getState().agentConversations)
  const storedTasks = await loadTasksIncrementally((task) => getPersistableTask(normalizeTaskRecordFields(task)))
  const storedAgentConversations = normalizeAgentConversations(await getAllAgentConversations())
  let loadedAgentConversations = mergeAgentConversationsForStorage(storedAgentConversations, legacyAgentConversations)
  const currentAgentConversations = normalizeAgentConversations(useStore.getState().agentConversations)
  loadedAgentConversations = mergeAgentConversationsForStorage(loadedAgentConversations, currentAgentConversations)
  const activeAgentConversationId =
    useStore.getState().activeAgentConversationId &&
    loadedAgentConversations.some((conversation) => conversation.id === useStore.getState().activeAgentConversationId)
      ? useStore.getState().activeAgentConversationId
      : (loadedAgentConversations[0]?.id ?? null)
  if (loadedAgentConversations.length > 0 || legacyAgentConversations.length > 0) {
    useStore.setState((state) => {
      const agentInputDrafts = cleanStaleAgentInputDrafts(
        normalizeAgentInputDrafts(state.agentInputDrafts, loadedAgentConversations),
        activeAgentConversationId,
      )
      return {
        agentConversations: loadedAgentConversations,
        agentConversationsLoaded: true,
        activeAgentConversationId,
        agentInputDrafts,
        ...(state.appMode === 'agent' ? restoreAgentInputDraftState(agentInputDrafts, activeAgentConversationId) : {}),
      }
    })
    await replaceStoredAgentConversations(loadedAgentConversations)
  } else {
    useStore.setState({ agentConversationsLoaded: true })
  }
  const shouldRewritePersistedLocalState = agentConversationMigrationPending
  agentConversationPersistenceReady = true
  agentConversationMigrationPending = false
  if (agentConversationPersistQueued || useStore.getState().agentConversations !== lastStoredAgentConversations) {
    await flushAgentConversationsToIndexedDB()
  }
  if (shouldRewritePersistedLocalState) {
    // Force persist rewrite by touching a stable field without triggering reactive updates
    useStore.setState((state) => ({ agentConversationsLoaded: state.agentConversationsLoaded }))
  }
  const { tasks: markedTasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(storedTasks)
  const interruptedTaskIds = new Set(interruptedTasks.map((task) => task.id))
  const favoriteState = useStore.getState()
  const normalizedFavorites = normalizeLoadedFavoriteState(
    markedTasks.map(getPersistableTask),
    favoriteState.favoriteCollections,
    favoriteState.defaultFavoriteCollectionId,
  )
  let tasks = normalizedFavorites.tasks
  if (normalizedFavorites.collections !== favoriteState.favoriteCollections) {
    favoriteState.setFavoriteCollections(normalizedFavorites.collections)
  }
  if (normalizedFavorites.defaultFavoriteCollectionId !== favoriteState.defaultFavoriteCollectionId) {
    useStore.getState().setDefaultFavoriteCollectionId(normalizedFavorites.defaultFavoriteCollectionId)
  }
  const tasksToWrite = tasks.filter(
    (task, index) =>
      normalizedFavorites.changed ||
      interruptedTaskIds.has(task.id) ||
      task.rawResponsePayload !== markedTasks[index]?.rawResponsePayload,
  )
  if (tasksToWrite.length > 0) await batchPutTasks(tasksToWrite)
  for (const interruptedTask of interruptedTasks) {
    if (interruptedTask.outputImages?.length) {
      void saveTaskToLocalFS(interruptedTask.id)
      void saveTaskMetaToLocalFS(interruptedTask.id)
    }
  }
  useStore.getState().setTasks(tasks)
  // Assign gallery tasks to the default workspace tab on first load
  // and sync task state (e.g. running -> error) across all workspace tabs
  const galleryTasks = tasks.filter(isGalleryTask)
  let currentTabs = useStore.getState().workspaceTabs
  let recoveryPlan: WorkspaceTaskRecoveryPlan | null = null
  if (currentTabs.length === 0) {
    const state = useStore.getState()
    const defaultTab = createDefaultWorkspaceTab({
      prompt: state.prompt,
      inputImages: state.inputImages.map((img) => ({ ...img })),
      inputImageFolder: state.inputImageFolder,
      params: state.params,
      maskDraft: state.maskDraft,
      maskEditorImageId: state.maskEditorImageId,
      tasks: galleryTasks,
    })
    useStore.setState({
      workspaceTabs: [defaultTab],
      activeWorkspaceTabId: defaultTab.id,
      selectedWorkspaceTabIds: [],
    })
    currentTabs = [defaultTab]
  } else {
    // Sync task state changes (e.g. interrupted tasks) to existing tab tasks
    const taskMap = new Map(tasks.map((t) => [t.id, t]))
    const claimedTaskIds = new Set<string>()

    // 我们必须非常小心：
    // _taskIds 是持久化时保存的任务ID列表。
    // 但是，如果没有持久化 _taskIds（旧版本或者刚从 IndexedDB 恢复但还没触发持久化），
    // 那么 tab.tasks 里面可能包含了它应该有的任务。
    // 注意：Zustand Persist 会从 localStorage 读取 workspaceTabs，里面的 tab.tasks 可能是空数组（因为在 persist 阶段被置空了）
    // 所以，如果在 localStorage 里的 `_taskIds` 是一个空数组，这说明用户主动清空了该标签页的任务。

    // 首先恢复各个标签页的任务
    const updatedTabs: WorkspaceTab[] = currentTabs.map((tab) => {
      let taskIds: string[] = []

      // 检查持久化状态中是否有 _taskIds
      if (Array.isArray(tab._taskIds)) {
        taskIds = tab._taskIds
      } else if (Array.isArray(tab.tasks)) {
        // 如果没有 _taskIds 但有 tasks，可能是旧数据或尚未初始化的状态
        taskIds = tab.tasks.map((t) => t.id)
      }

      // 尝试恢复任务：只有在 IndexedDB 中存在的任务才会被恢复
      const tabTasks = taskIds.map((id) => taskMap.get(id)).filter((t): t is TaskRecord => t !== undefined)

      // 记录已经被分配给某个标签页的任务 ID
      tabTasks.forEach((t: TaskRecord) => claimedTaskIds.add(t.id))

      return {
        ...tab,
        tasks: tabTasks,
        _taskIds: undefined, // 恢复完毕，清除中间字段
      }
    })

    // 找出所有画廊任务中没有被任何标签页认领的"孤儿任务"
    // 这些任务可能是因为版本升级、HMR 热更新导致 localStorage 保存失败、或者旧版本残留导致的
    const orphanTasks = galleryTasks.filter((t) => !claimedTaskIds.has(t.id))

    if (orphanTasks.length > 0) {
      // 为了不打乱用户当前的标签页，我们把这些丢失的任务放进一个专门的"恢复的历史任务"标签页
      const recoveryTab = updatedTabs.find((t) => t.name === '恢复的历史任务')
      if (recoveryTab) {
        recoveryTab.tasks = [...orphanTasks, ...recoveryTab.tasks]
      } else {
        const newTab = createDefaultWorkspaceTab({
          prompt: '',
          inputImages: [],
          inputImageFolder: null,
          params: { ...DEFAULT_PARAMS },
          maskDraft: null,
          maskEditorImageId: null,
          tasks: orphanTasks,
        })
        newTab.name = '恢复的历史任务'
        updatedTabs.push(newTab)
      }
    }

    currentTabs = updatedTabs
    recoveryPlan = detectWorkspaceTaskRecovery(updatedTabs)
    useStore.setState({ workspaceTabs: currentTabs })
  }

  const batchBackfill = assignMissingGeneratedImageBatches(tasks, currentTabs)
  if (batchBackfill.changedTaskIds.length > 0) {
    const changedTaskIds = new Set(batchBackfill.changedTaskIds)
    await batchPutTasks(batchBackfill.tasks.filter((task) => changedTaskIds.has(task.id)))
  }
  tasks = batchBackfill.tasks
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  currentTabs = currentTabs.map((tab) => ({
    ...tab,
    tasks: tab.tasks.map((task) => taskById.get(task.id) ?? task),
  }))
  useStore.setState({ tasks, workspaceTabs: currentTabs })

  if (recoveryPlan && recoveryPlan.recoverableTaskCount > 0) {
    const plan = recoveryPlan
    const unresolvedMessage =
      plan.unresolvedTaskCount > 0
        ? `\n另有 ${plan.unresolvedTaskCount} 个任务来源不明确，将继续保留在「恢复的历史任务」。`
        : ''
    useStore.getState().setConfirmDialog({
      title: '检测到任务归属异常',
      message: `检测到 ${plan.recoverableTaskCount} 个任务可能被错误合并到「恢复的历史任务」，可按原保存目录恢复到 ${plan.targetTabCount} 个标签。${unresolvedMessage}\n\n是否立即恢复？`,
      confirmText: '恢复任务',
      cancelText: '暂不恢复',
      icon: 'info',
      action: () => {
        const state = useStore.getState()
        const result = applyWorkspaceTaskRecovery(state.workspaceTabs, plan)
        if (result.recoveredTaskCount === 0) {
          state.showToast('没有仍需恢复的任务', 'info')
          return
        }
        useStore.setState({ workspaceTabs: result.tabs })
        state.showToast(`已恢复 ${result.recoveredTaskCount} 个任务到 ${result.targetTabCount} 个标签`, 'success')
      },
    })
  } else if (recoveryPlan && recoveryPlan.unresolvedTaskIds.length > 0) {
    const state = useStore.getState()
    const dismissed = new Set(normalizeSettings(state.settings).dismissedRecoveryTaskIds ?? [])
    // 「不再提醒」只对当前这组任务生效：全部已忽略时不再打扰；出现新的无归属任务时仍会提醒
    const pendingTaskIds = recoveryPlan.unresolvedTaskIds.filter((taskId) => !dismissed.has(taskId))
    if (pendingTaskIds.length > 0) {
      state.setConfirmDialog({
        title: '检测到任务归属异常',
        message: `检测到 ${pendingTaskIds.length} 个任务位于「恢复的历史任务」，但缺少唯一、可靠的原标签信息，程序不会自动移动。\n\n点击「前往整理」直接定位到该标签页；若确认无需处理，可点击「不再提醒」。`,
        icon: 'info',
        buttons: [
          {
            label: '前往整理',
            tone: 'primary',
            action: () => {
              const current = useStore.getState()
              if (current.appMode !== 'gallery') current.setAppMode('gallery')
              const tab = current.workspaceTabs.find((item) => item.name === '恢复的历史任务')
              if (tab) current.setActiveWorkspaceTabId(tab.id)
              current.showToast('已定位到「恢复的历史任务」，请确认后手动整理', 'info')
            },
          },
          {
            label: '不再提醒',
            tone: 'secondary',
            action: () => {
              const current = useStore.getState()
              const list = new Set(normalizeSettings(current.settings).dismissedRecoveryTaskIds ?? [])
              for (const taskId of pendingTaskIds) list.add(taskId)
              current.setSettings({ dismissedRecoveryTaskIds: [...list] })
              current.showToast('已记住，不再提醒这组任务', 'info')
            },
          },
        ],
      })
    }
  }

  // 素材库历史回填与启动补齐：任务恢复、工作区归属恢复之后执行。
  // 链式串行保证不并发争写素材；全部幂等且不阻塞启动。
  const assetMigrationPromise = retryGeneratedAssetLibraryMigration(tasks, currentTabs)

  showSupportPromptForExistingLocalData(tasks)
  for (const task of tasks) {
    if (
      task.status === 'running' &&
      task.generationSlots?.length === Math.max(1, task.params.n || 1) &&
      Array.isArray(task.remoteGenerationRequests)
    ) {
      // New orchestrated batches restore every persisted request and slot through
      // executeTask. Do not also run the legacy single-request recovery below.
      void executeTask(task.id)
      continue
    }
    if (
      task.apiProvider === 'fal' &&
      task.falRequestId &&
      task.falEndpoint &&
      (task.status === 'running' || task.falRecoverable)
    ) {
      scheduleFalRecovery(task.id, 0)
    }
    if (task.customTaskId && (task.status === 'running' || task.customRecoverable)) {
      scheduleCustomRecovery(task.id, 0)
    }
  }

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  const state = useStore.getState()
  addSopCoverReferencedImageIds(referencedIds)
  const persistedInputImages = state.inputImages
  const galleryInputDraft = state.galleryInputDraft
  const agentConversations = state.agentConversations
  const agentInputDrafts = state.agentInputDrafts
  for (const img of persistedInputImages) referencedIds.add(img.id)
  if (galleryInputDraft) {
    for (const img of galleryInputDraft.inputImages) referencedIds.add(img.id)
  }
  for (const draft of Object.values(agentInputDrafts)) {
    for (const img of draft.inputImages) referencedIds.add(img.id)
  }
  for (const conversation of agentConversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) referencedIds.add(id)
    }
  }
  for (const t of tasks) {
    addTaskReferencedImageIds(referencedIds, t)
  }
  const sopRuns = await getAllSopBatchSnapshots()
  for (const run of sopRuns) {
    for (const imageId of run.referenceImageIds) referencedIds.add(imageId)
  }
  for (const reference of getSopAiRevisionAttachmentReferences()) referencedIds.add(reference.imageId)
  for (const tab of state.workspaceTabs) {
    for (const img of tab.inputImages) referencedIds.add(img.id)
    if (tab.inputImageFolder) {
      for (const id of tab.inputImageFolder.imageIds) referencedIds.add(id)
    }
  }

  // 只枚举 key 清理孤立图片，避免启动时把所有 4K 原图读进内存。
  const imageIds = await getAllImageIds()
  const orphanIds: string[] = []
  for (const imgId of imageIds) {
    if (!referencedIds.has(imgId)) {
      orphanIds.push(imgId)
    }
  }
  if (orphanIds.length > 0) {
    const orphanRecords = await batchGetImages(orphanIds)
    const expiredOrphanIds = orphanIds.filter((id) => {
      const image = orphanRecords.get(id)
      return image ? shouldDeleteOrphanImage(image, Date.now(), 7) : false
    })
    if (expiredOrphanIds.length > 0) await batchDeleteImages(expiredOrphanIds)
  }

  // 失效图片清理：源文件丢失的图删除记录与缩略图（用户此前主动清理过源文件的历史数据，
  // 保留记录只会让界面永远「加载中」）。后台执行不阻塞启动；安全模式跳过。
  if (!options.safeMode) {
    void cleanupMissingImageRecords().catch((error) => {
      console.warn('清理失效图片失败:', error)
    })
  }

  const idsToFetch = new Set<string>()
  for (const img of persistedInputImages) {
    if (!img.dataUrl) idsToFetch.add(img.id)
  }
  if (galleryInputDraft) {
    for (const img of galleryInputDraft.inputImages) {
      if (!img.dataUrl) idsToFetch.add(img.id)
    }
  }
  for (const [, draft] of Object.entries(agentInputDrafts)) {
    for (const img of draft.inputImages) {
      if (!img.dataUrl) idsToFetch.add(img.id)
    }
  }
  for (const round of agentConversations.flatMap((c) => c.rounds)) {
    for (const id of round.inputImageIds) idsToFetch.add(id)
  }
  for (const tab of state.workspaceTabs) {
    for (const img of tab.inputImages) {
      if (!img.dataUrl) idsToFetch.add(img.id)
    }
  }
  const imageMap = idsToFetch.size > 0 ? await batchGetImages([...idsToFetch]) : new Map<string, StoredImage>()

  const restoredInputImages: InputImage[] = []
  for (const img of persistedInputImages) {
    if (img.dataUrl) {
      restoredInputImages.push(img)
      cacheImage(img.id, img.dataUrl)
      continue
    }
    const storedImage = imageMap.get(img.id)
    if (storedImage?.dataUrl) {
      restoredInputImages.push({ ...img, dataUrl: storedImage.dataUrl })
      cacheImage(img.id, storedImage.dataUrl)
    }
  }
  if (
    restoredInputImages.length !== persistedInputImages.length ||
    restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)
  ) {
    useStore.getState().setInputImages(restoredInputImages)
  }

  if (galleryInputDraft) {
    const restoredGalleryImages: InputImage[] = []
    for (const img of galleryInputDraft.inputImages) {
      if (img.dataUrl) {
        restoredGalleryImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = imageMap.get(img.id)
      if (storedImage?.dataUrl) {
        restoredGalleryImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }
    const shouldClearMask =
      Boolean(galleryInputDraft.maskDraft) &&
      !restoredGalleryImages.some((img) => img.id === galleryInputDraft.maskDraft?.targetImageId)
    const restoredGalleryDraft: AgentInputDraft = {
      ...galleryInputDraft,
      inputImages: restoredGalleryImages,
      prompt: remapImageMentionsForOrder(
        galleryInputDraft.prompt,
        galleryInputDraft.inputImages,
        restoredGalleryImages,
      ),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    }
    const galleryDraftsChanged =
      restoredGalleryImages.length !== galleryInputDraft.inputImages.length ||
      restoredGalleryImages.some((img, index) => img.dataUrl !== galleryInputDraft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    if (galleryDraftsChanged) {
      const latestState = useStore.getState()
      const nextGalleryInputDraft = isEmptyAgentInputDraft(restoredGalleryDraft) ? null : restoredGalleryDraft
      useStore.setState({
        galleryInputDraft: nextGalleryInputDraft,
        ...(latestState.appMode === 'gallery' ? restoreGalleryInputDraftState(nextGalleryInputDraft) : {}),
      })
    }
  }

  const restoredAgentInputDrafts: Record<string, AgentInputDraft> = {}
  let agentDraftsChanged = false
  for (const [conversationId, draft] of Object.entries(agentInputDrafts)) {
    const restoredDraftImages: InputImage[] = []
    for (const img of draft.inputImages) {
      if (img.dataUrl) {
        restoredDraftImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = imageMap.get(img.id)
      if (storedImage?.dataUrl) {
        restoredDraftImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }

    const shouldClearMask =
      Boolean(draft.maskDraft) && !restoredDraftImages.some((img) => img.id === draft.maskDraft?.targetImageId)
    const restoredDraft: AgentInputDraft = {
      ...draft,
      inputImages: restoredDraftImages,
      prompt: remapImageMentionsForOrder(draft.prompt, draft.inputImages, restoredDraftImages),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    }
    if (!isEmptyAgentInputDraft(restoredDraft)) restoredAgentInputDrafts[conversationId] = restoredDraft
    if (
      restoredDraftImages.length !== draft.inputImages.length ||
      restoredDraftImages.some((img, index) => img.dataUrl !== draft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    ) {
      agentDraftsChanged = true
    }
  }
  if (agentDraftsChanged) {
    const latestState = useStore.getState()
    useStore.setState({
      agentInputDrafts: restoredAgentInputDrafts,
      ...(latestState.appMode === 'agent'
        ? restoreAgentInputDraftState(restoredAgentInputDrafts, latestState.activeAgentConversationId)
        : {}),
    })
  }
  await hydrateWorkspaceTabsInStore()
  const imageMigrationPromise = options.safeMode ? Promise.resolve() : ensureImageStorageMigrated()
  void Promise.all([assetMigrationPromise, imageMigrationPromise])
    .then(() => cleanupElectronLegacyIndexedDb())
    .catch((error) => {
      console.error('素材库迁移失败（不影响生成批次视图）:', error)
    })
}

async function hydrateWorkspaceTabsInStore(): Promise<void> {
  const current = useStore.getState()
  if (current.workspaceTabs.length === 0) return

  const workspaceTabs = await Promise.all(
    current.workspaceTabs.map(async (tab) => {
      const dataUrls = new Map<string, string>()
      await Promise.all(
        [...new Set(tab.inputImages.map((image) => image.id))].map(async (imageId) => {
          const direct = tab.inputImages.find((image) => image.id === imageId)?.dataUrl
          const dataUrl = direct || (await ensureImageCached(imageId))
          if (dataUrl) dataUrls.set(imageId, dataUrl)
        }),
      )

      const inputImages = tab.inputImages
        .map((image) => {
          const dataUrl = dataUrls.get(image.id)
          return dataUrl ? { ...image, dataUrl } : null
        })
        .filter((image): image is InputImage => image !== null)
      const inputImageFolder = tab.inputImageFolder
      const folderImageIds = new Set(tab.inputImageFolder?.imageIds ?? [])
      const maskDraft =
        tab.maskDraft && (dataUrls.has(tab.maskDraft.targetImageId) || folderImageIds.has(tab.maskDraft.targetImageId))
          ? { ...tab.maskDraft }
          : null
      const maskEditorImageId =
        tab.maskEditorImageId && (dataUrls.has(tab.maskEditorImageId) || folderImageIds.has(tab.maskEditorImageId))
          ? tab.maskEditorImageId
          : null
      const changed =
        inputImages.length !== tab.inputImages.length ||
        inputImages.some(
          (image, index) =>
            image.id !== tab.inputImages[index]?.id || image.dataUrl !== tab.inputImages[index]?.dataUrl,
        ) ||
        JSON.stringify(maskDraft) !== JSON.stringify(tab.maskDraft) ||
        maskEditorImageId !== tab.maskEditorImageId
      return changed ? { ...tab, inputImages, inputImageFolder, maskDraft, maskEditorImageId } : tab
    }),
  )

  const activeTab =
    current.activeWorkspaceTabId && current.appMode === 'gallery'
      ? workspaceTabs.find((tab) => tab.id === current.activeWorkspaceTabId)
      : undefined
  useStore.setState({
    workspaceTabs,
    ...(activeTab
      ? {
          prompt: activeTab.prompt,
          inputImages: activeTab.inputImages.map((image) => ({ ...image })),
          inputImageFolder: activeTab.inputImageFolder,
          params: { ...activeTab.params },
          maskDraft: activeTab.maskDraft ? { ...activeTab.maskDraft } : null,
          maskEditorImageId: activeTab.maskEditorImageId,
          customOutputPath: activeTab.customOutputPath,
          galleryInputDraft: null,
        }
      : {}),
  })
}

type WorkspaceTaskRecoveryPlan = {
  assignments: Array<{ targetTabId: string; taskIds: string[] }>
  createTabAssignments: Array<{ tabName: string; taskIds: string[] }>
  recoverableTaskCount: number
  targetTabCount: number
  unresolvedTaskCount: number
  /** 缺少唯一、可靠原标签信息、无法自动归位的任务 id（供「前往整理/不再提醒」使用） */
  unresolvedTaskIds: string[]
}

function detectWorkspaceTaskRecovery(tabs: WorkspaceTab[]): WorkspaceTaskRecoveryPlan | null {
  const recoveryTabName = '恢复的历史任务'
  const tabsByName = new Map<string, WorkspaceTab[]>()
  for (const tab of tabs) {
    if (tab.name === recoveryTabName) continue
    const name = tab.name.trim()
    if (!name) continue
    tabsByName.set(name, [...(tabsByName.get(name) ?? []), tab])
  }

  const taskIdsByTargetTabId = new Map<string, string[]>()
  const taskIdsByCreateTabName = new Map<string, string[]>()
  const unresolvedTaskIds: string[] = []
  let recoveryTaskCount = 0
  for (const tab of tabs) {
    if (tab.name !== recoveryTabName) continue
    for (const task of tab.tasks) {
      const sourceName = task.scheduledOutputSubFolder?.trim()
      // 原标签信息就是「恢复的历史任务」本身的任务（提交时该标签页正处于激活状态，被当作普通标签页使用）
      // 不是丢失的任务，无需恢复：跳过它们，避免每次启动都误报「检测到任务归属异常」。
      if (sourceName === recoveryTabName) continue
      recoveryTaskCount++
      const matches = sourceName ? tabsByName.get(sourceName) : undefined
      if (matches?.length === 1) {
        const targetTab = matches[0]
        taskIdsByTargetTabId.set(targetTab.id, [...(taskIdsByTargetTabId.get(targetTab.id) ?? []), task.id])
      } else if (sourceName && !matches && sourceName !== recoveryTabName) {
        // 任务记录了明确的原标签名，但当前没有同名标签页：自动创建一个同名标签页来归位
        taskIdsByCreateTabName.set(sourceName, [...(taskIdsByCreateTabName.get(sourceName) ?? []), task.id])
      } else {
        // 没有原标签名（如 SOP/日程任务），或原标签名对应多个同名标签页：无法可靠归位
        unresolvedTaskIds.push(task.id)
      }
    }
  }

  const assignments = [...taskIdsByTargetTabId].map(([targetTabId, taskIds]) => ({ targetTabId, taskIds }))
  const createTabAssignments = [...taskIdsByCreateTabName].map(([tabName, taskIds]) => ({ tabName, taskIds }))
  const recoverableTaskCount =
    assignments.reduce((sum, assignment) => sum + assignment.taskIds.length, 0) +
    createTabAssignments.reduce((sum, assignment) => sum + assignment.taskIds.length, 0)
  if (recoveryTaskCount === 0) return null
  return {
    assignments,
    createTabAssignments,
    recoverableTaskCount,
    targetTabCount: assignments.length + createTabAssignments.length,
    unresolvedTaskCount: unresolvedTaskIds.length,
    unresolvedTaskIds,
  }
}

function applyWorkspaceTaskRecovery(
  tabs: WorkspaceTab[],
  plan: WorkspaceTaskRecoveryPlan,
): { tabs: WorkspaceTab[]; recoveredTaskCount: number; targetTabCount: number } {
  const recoveryTabName = '恢复的历史任务'
  const plannedTargetByTaskId = new Map<string, string>()
  for (const assignment of plan.assignments) {
    if (!tabs.some((tab) => tab.id === assignment.targetTabId && tab.name !== recoveryTabName)) continue
    for (const taskId of assignment.taskIds) plannedTargetByTaskId.set(taskId, assignment.targetTabId)
  }

  // 为“原标签名已不存在”的任务计划自动创建同名标签页，把它们作为恢复目标
  const createdTabsById = new Map<string, WorkspaceTab>()
  let createOrder = tabs.length
  for (const assignment of plan.createTabAssignments) {
    const tabName = assignment.tabName
    const newTab = createDefaultWorkspaceTab({ tasks: [] })
    newTab.name = tabName
    newTab.order = createOrder++
    createdTabsById.set(newTab.id, newTab)
    for (const taskId of assignment.taskIds) plannedTargetByTaskId.set(taskId, newTab.id)
  }

  const recoveredByTabId = new Map<string, TaskRecord[]>()
  const remainingByRecoveryTabId = new Map<string, TaskRecord[]>()
  for (const tab of tabs) {
    if (tab.name !== recoveryTabName) continue
    const remaining: TaskRecord[] = []
    for (const task of tab.tasks) {
      const targetTabId = plannedTargetByTaskId.get(task.id)
      if (!targetTabId) {
        remaining.push(task)
        continue
      }
      recoveredByTabId.set(targetTabId, [...(recoveredByTabId.get(targetTabId) ?? []), task])
    }
    remainingByRecoveryTabId.set(tab.id, remaining)
  }

  const recoveredTaskCount = [...recoveredByTabId.values()].reduce((sum, recovered) => sum + recovered.length, 0)
  if (recoveredTaskCount === 0) return { tabs, recoveredTaskCount: 0, targetTabCount: 0 }
  const now = Date.now()
  const updatedTabs = tabs.map((tab) => {
    if (tab.name === recoveryTabName) {
      return { ...tab, tasks: remainingByRecoveryTabId.get(tab.id) ?? tab.tasks, updatedAt: now }
    }
    const recovered = recoveredByTabId.get(tab.id)
    if (!recovered?.length) return tab
    const taskById = new Map([...tab.tasks, ...recovered].map((task) => [task.id, task]))
    return {
      ...tab,
      tasks: [...taskById.values()].sort((a, b) => b.createdAt - a.createdAt),
      updatedAt: now,
    }
  })

  // 把新创建的标签页追加到标签页列表，并放入恢复的任务
  const appendedTabs = [...updatedTabs]
  for (const [createdTabId, createdTab] of createdTabsById) {
    const recovered = recoveredByTabId.get(createdTabId) ?? []
    void createdTabId
    appendedTabs.push({
      ...createdTab,
      tasks: [...recovered].sort((a, b) => b.createdAt - a.createdAt),
      updatedAt: now,
    })
  }

  return {
    tabs: appendedTabs,
    recoveredTaskCount,
    targetTabCount: recoveredByTabId.size,
  }
}

export async function migrateLocalSaveRoot(newRoot: string): Promise<void> {
  const previousRoot = await getLocalSavePath()
  if (!previousRoot || previousRoot === newRoot) {
    await setLocalSavePath(newRoot)
    return
  }
  const mappings = await copyRawCacheImagesToRoot(newRoot)
  const mappedSources = new Set(mappings.map((mapping) => mapping.from.toLowerCase()))
  const unmappedPaths = (await getAllLocalImagePaths()).filter(
    (localPath) => !mappedSources.has(localPath.toLowerCase()),
  )
  if (unmappedPaths.length > 0) {
    throw new Error(`仍有 ${unmappedPaths.length} 个历史图片文件不在当前缓存目录中，请先导出完整备份后再迁移保存目录`)
  }
  await setLocalSavePath(newRoot)
  try {
    await updateImageLocalPaths(mappings)
  } catch (error) {
    await setLocalSavePath(previousRoot)
    throw error
  }
}

/**
 * 解析新任务归属的标签页：绝不落入「恢复的历史任务」等待区。
 * 若首选标签页是恢复标签页（或缺失），回退到第一个普通标签页。
 * 注意：调用方仍需按自己的语义决定「首选标签页」（激活标签页 / 来源标签页等）。
 */
function resolveTaskTabId(tabs: WorkspaceTab[], preferredId: string | null | undefined): string | null {
  const recoveryTabName = '恢复的历史任务'
  const preferred = preferredId ? tabs.find((t) => t.id === preferredId) : undefined
  if (preferred && preferred.name !== recoveryTabName) return preferred.id
  return tabs.find((t) => t.name !== recoveryTabName)?.id ?? null
}

/** 提交新任务（使用显式数据，不依赖全局状态） */
export async function submitTaskWithData(
  data: {
    prompt: string
    inputImages: InputImage[]
    inputImageFolder: InputImageFolder | null
    params: TaskParams
    maskDraft: MaskDraft | null
    targetTabId?: string | null
    scheduledOutputPath?: string
    scheduledOutputSubFolder?: string
    apiProfileId?: string
    sopBatch?: TaskRecord['sopBatch']
    /**
     * 显式指定生成图片归档的素材库项目文件夹；缺省时按提交时刻素材库选中的文件夹捕获
     * （SOP 批量等长任务用它固定批次启动时的文件夹，避免生成中途切换文件夹导致产出错投）。
     */
    defaultCollectionId?: string
  },
  options: {
    allowFullMask?: boolean
    useCurrentApiProfileWhenReusedMissing?: boolean
    silentSuccess?: boolean
    /** 跳过「按当前项目文件夹自动归档」捕获；日程等自带输出目标的任务使用 */
    skipFolderCapture?: boolean
    /**
     * 只建卡、先不执行：用于「AI 先写提示词、写完再生图」的链路（SOP 批量 / 一键衍生）。
     * 这样用户点完「生成」立刻就能在画廊看到卡片（写着「编写提示词中」），
     * 而不是对着空画廊干等提示词。提示词由调用方拿到 taskId 后经
     * `fulfillPendingTaskPrompt` 写入并触发执行。
     */
    deferExecution?: boolean
  } = {},
) {
  const {
    settings,
    reusedTaskApiProfileId,
    reusedTaskApiProfileName,
    reusedTaskApiProfileMissing,
    showToast,
    setConfirmDialog,
  } = useStore.getState()

  const {
    prompt,
    inputImages,
    inputImageFolder,
    params,
    maskDraft,
    targetTabId,
    scheduledOutputPath,
    scheduledOutputSubFolder,
    apiProfileId,
    sopBatch,
    defaultCollectionId: explicitDefaultCollectionId,
  } = data

  const variablePrompt = parseVariablePrompt(prompt)
  if (variablePrompt.detected && !variablePrompt.enabled) {
    showToast(`变量提示词格式有误：${variablePrompt.errors[0] ?? '请检查可变项格式'}`, 'error')
    return
  }

  const normalizedSettings = normalizeSettings(settings)
  let activeProfile = getActiveApiProfile(settings)
  if (apiProfileId) {
    activeProfile = normalizedSettings.profiles.find((profile) => profile.id === apiProfileId) ?? activeProfile
  }
  let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  if (
    !apiProfileId &&
    normalizedSettings.reuseTaskApiProfileTemporarily &&
    (reusedTaskApiProfileId || reusedTaskApiProfileMissing)
  ) {
    const reusedProfile = getReusedTaskApiProfile(normalizedSettings, reusedTaskApiProfileId)
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        useStore.getState().setReusedTaskApiProfile(null)
      } else {
        setConfirmDialog({
          title: '找不到 API 配置',
          message: `找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
          confirmText: '使用当前配置提交',
          cancelText: '放弃提交',
          action: () => {
            void submitTaskWithData(data, { ...options, useCurrentApiProfileWhenReusedMissing: true })
          },
        })
        return
      }
    } else {
      activeProfile = reusedProfile
      requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
    }
  }

  if (validateApiProfile(activeProfile)) {
    showToast(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  // deferExecution（卡先建、词后填）时提示词本来就要等一下才写出来，此刻为空是正常的。
  if (!prompt.trim() && !options.deferExecution) {
    showToast('请输入提示词', 'error')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => {
            void submitTaskWithData(data, { allowFullMask: true })
          },
        })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  if (inputImageFolder) {
    for (const imgId of inputImageFolder.imageIds) {
      const dataUrl = imageCache.get(imgId)
      if (dataUrl) await storeImage(dataUrl)
    }
  }

  const hasInputImages =
    orderedInputImages.length > 0 || (inputImageFolder ? inputImageFolder.imageIds.length > 0 : false)
  // 变量提示词在正文声明宽高比时，自动把请求尺寸改写到对应档位（如 2K→16:9 = 2560x1440）
  const promptAdjustedParams =
    variablePrompt.enabled && variablePrompt.aspectRatio
      ? { ...params, size: calculateImageSize(inferSizeTier(params.size), variablePrompt.aspectRatio) ?? params.size }
      : params
  const normalizedParams = normalizeParamsForSettings(promptAdjustedParams, requestSettings, { hasInputImages })

  // 「在哪个项目文件夹中发送生图任务，生成的图片就属于哪个文件夹」：
  // 画廊模式下自动捕获素材库当前选中的项目文件夹并写入任务，生成图片随素材同步自动归档到该文件夹。
  // 日程等自带输出目标的任务显式跳过（skipFolderCapture），避免把定时产出错投到浏览中的文件夹。
  // SOP 批量等长任务可显式传入 defaultCollectionId，固定批次启动时的文件夹，不跟随中途切换。
  const galleryScope = useAssetLibraryStore.getState().scope
  const defaultCollectionId =
    explicitDefaultCollectionId ??
    (!options.skipFolderCapture &&
    useStore.getState().appMode === 'gallery' &&
    typeof galleryScope === 'object' &&
    galleryScope.kind === 'collection'
      ? galleryScope.id
      : undefined)

  const taskState = useStore.getState()
  const tabIdToUpdate = resolveTaskTabId(
    taskState.workspaceTabs,
    targetTabId ?? taskState.activeWorkspaceTabId ?? taskState.workspaceTabs[0]?.id ?? null,
  )
  const createdAt = Date.now()
  const taskId = genId()
  const { filenameBatch, localSaveBatchFolder } = resolveTaskGeneratedImageNaming(createdAt, tabIdToUpdate, sopBatch)
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    // 卡先建、词后填：置位期间 `executeTask` 会直接返回（见其开头的守卫），
    // 避免拿着占位文案去生图；提示词写好由 `fulfillPendingTaskPrompt` 清掉它并开跑。
    ...(options.deferExecution ? { promptPending: true } : {}),
    sopBatch,
    params: normalizedParams,
    adNegativeRuleSnapshot: createAdNegativeRuleSnapshot(normalizedSettings, normalizedParams.adNegativeRuleId),
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: inputImageFolder ? inputImageFolder.imageIds : orderedInputImages.map((i) => i.id),
    inputImageFolderPath: inputImageFolder?.path ?? undefined,
    maskTargetImageId,
    maskImageId,
    outputImages: [],
    filenameBatch,
    status: 'running',
    error: null,
    progressStage: options.deferExecution ? 'prompting' : 'queued',
    progressUpdatedAt: Date.now(),
    createdAt,
    finishedAt: null,
    elapsed: null,
    scheduledOutputPath,
    scheduledOutputSubFolder,
    defaultCollectionId,
    localSaveBatchFolder,
  }

  const latestTasks = useStore.getState().tasks
  const newTasks = [task, ...latestTasks]
  useStore.getState().setTasks(newTasks)
  // Also add to target workspace tab (or active tab if not specified)
  if (tabIdToUpdate) {
    useStore.setState((state) => ({
      workspaceTabs: state.workspaceTabs.map((t) => (t.id === tabIdToUpdate ? { ...t, tasks: [task, ...t.tasks] } : t)),
    }))
  } else {
    // If no tab is active, try to add to the first tab (usually "默认" / "标签 1")
    useStore.setState((state) => {
      if (state.workspaceTabs.length === 0) return state
      const firstTabId = state.workspaceTabs[0].id
      return {
        workspaceTabs: state.workspaceTabs.map((t) => (t.id === firstTabId ? { ...t, tasks: [task, ...t.tasks] } : t)),
      }
    })
  }
  await putTask(task)
  if (!options.silentSuccess) useStore.getState().showToast('任务已提交', 'success')

  // 异步调用 API（「卡先建、词后填」的链路不在这里启动：提示词还没写出来，
  // 由调用方在 `fulfillPendingTaskPrompt` 里写入提示词之后再触发）
  if (!options.deferExecution) executeTask(taskId)
  return taskId
}

/**
 * 「卡先建、词后填」的建卡入口（显式数据版，SOP 批量用）。
 *
 * 就是 `submitTaskWithData` 的语义化包装：把 `deferExecution` 收在这里 ——
 * 每个调用点各传一次的话，漏一个就退回「等提示词生成完才建卡」，而那正是这次要修的病。
 */
export async function createPendingPromptTask(data: Parameters<typeof submitTaskWithData>[0]): Promise<string | null> {
  const taskId = await submitTaskWithData(data, { silentSuccess: true, deferExecution: true })
  return taskId ?? null
}

/**
 * 提示词就绪：写进已建好的卡并开始生图（「先建卡、后写词」链路的第二步）。
 *
 * 幂等 + 防迟到：卡已被删除、或提示词已被别的路径填过（`promptPending` 已清），一律直接返回。
 * 取消 / 删除之后姗姗来迟的提示词，不能把任务重新拉起来。
 *
 * @returns 是否真的接着开了生图（调用方据此统计「成功提交几条」）
 */
export async function fulfillPendingTaskPrompt(taskId: string, promptText: string): Promise<boolean> {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !task.promptPending) return false

  const text = promptText.trim()
  if (!text) {
    await failPendingTaskPrompt(taskId, '这一条没有写出可用的提示词')
    return false
  }

  await updateTaskInStore(taskId, {
    prompt: text,
    promptPending: false,
    promptFailed: false,
    progressStage: 'queued',
    progressUpdatedAt: Date.now(),
  })
  executeTask(taskId)
  return true
}

/**
 * 提示词环节失败：**就地标红、卡片保留**（不删卡、不静默 —— 2026-09-22 杰哥定的交互）。
 * `promptFailed` 把「写词失败」与「生图失败」分开，卡片才好说清是哪一段坏的。
 */
export async function failPendingTaskPrompt(taskId: string, reason: string): Promise<void> {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !task.promptPending) return

  const detail = reason.trim() || '服务商没有返回具体原因'
  await updateTaskInStore(taskId, {
    status: 'error',
    promptPending: false,
    promptFailed: true,
    progressStage: 'failed',
    error: `提示词生成失败：${detail}`,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
    falRecoverable: false,
    customRecoverable: false,
  })
}

/**
 * 取消收尾：还没写词的预留卡标成「已停止」，**保留在画廊**。
 *
 * 要求是「不删卡」—— 删掉会让用户以为这事没发生过；留着才对得上「点过开始」这件事。
 * 已经填了词、正在生图的卡不归这里管（由任务自身的停止逻辑处理）。
 */
export async function cancelPendingTaskPrompt(taskId: string): Promise<void> {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !task.promptPending) return

  await updateTaskInStore(taskId, {
    status: 'error',
    promptPending: false,
    promptFailed: false,
    progressStage: 'stopped',
    error: '提示词生成已取消',
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
    falRecoverable: false,
    customRecoverable: false,
  })
}

/**
 * 更新「编写提示词中」那张卡上的说明文字（如「正在逐张分析参考图…」）。
 * 只写运行时进度：这类文案变化频繁，没必要每次重建任务数组、写一遍库。
 */
export function setPendingTaskPromptMessage(taskId: string, message: string) {
  updateTaskProgress(taskId, 'prompting', message)
}

/** 提交新任务 */
export async function submitTask(
  options: {
    allowFullMask?: boolean
    useCurrentApiProfileWhenReusedMissing?: boolean
    /** 只建卡不执行；调用方拿到 taskId 后写提示词再触发（见 `submitTaskWithData`）。 */
    deferExecution?: boolean
  } = {},
) {
  const state = useStore.getState()
  const { prompt, inputImages, inputImageFolder, params, maskDraft, customOutputPath } = state

  // 查找当前激活的标签页
  const activeTab = state.workspaceTabs.find((tab) => tab.id === state.activeWorkspaceTabId)

  // 修复：只有自定义输出路径被设置时才使用，否则使用标签页名称作为子文件夹
  const scheduledOutputPath = customOutputPath.trim() ? customOutputPath : undefined
  const scheduledOutputSubFolder = activeTab ? activeTab.name : undefined

  // 返回 taskId：一键衍生等「卡先建、词后填」的调用方要拿它去回写提示词
  return submitTaskWithData(
    {
      prompt,
      inputImages,
      inputImageFolder,
      params,
      maskDraft,
      scheduledOutputPath,
      scheduledOutputSubFolder,
    },
    options,
  )
}

function getActiveAgentConversation(): AgentConversation {
  const state = useStore.getState()
  const existing = state.agentConversations.find((conversation) => conversation.id === state.activeAgentConversationId)
  if (existing) return existing

  const id = state.createAgentConversation()
  return useStore.getState().agentConversations.find((conversation) => conversation.id === id)!
}

function updateAgentConversation(
  conversationId: string,
  updater: (conversation: AgentConversation) => AgentConversation,
) {
  useStore.setState((state) => ({
    agentConversations: state.agentConversations.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation,
    ),
  }))
}

function getAgentRoundControllerKey(conversationId: string, roundId: string) {
  return `${conversationId}:${roundId}`
}

function createAgentAbortError() {
  return new DOMException('Agent 请求已停止', 'AbortError')
}

function createAgentRecoveryPauseError() {
  const error = new Error('Agent recovery paused')
  error.name = AGENT_RECOVERY_PAUSE_ERROR
  return error
}

function isAgentRecoveryPauseError(error: unknown) {
  return error instanceof Error && error.name === AGENT_RECOVERY_PAUSE_ERROR
}

function appendAgentStoppedMessage(content: string) {
  const trimmed = content.trimEnd()
  if (!trimmed) return AGENT_STOPPED_MESSAGE
  if (trimmed.endsWith(AGENT_STOPPED_MESSAGE)) return trimmed
  return `${trimmed}\n\n${AGENT_STOPPED_MESSAGE}`
}

function markAgentRoundTasksStopped(conversationId: string, roundId: string, now = Date.now()) {
  const runningTasks = useStore
    .getState()
    .tasks.filter(
      (task) =>
        task.status === 'running' && task.agentConversationId === conversationId && task.agentRoundId === roundId,
    )

  for (const task of runningTasks) {
    updateTaskInStore(task.id, {
      status: 'error',
      error: AGENT_STOPPED_MESSAGE,
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return runningTasks.length > 0
}

function markAgentRoundStopped(conversationId: string, roundId: string) {
  const now = Date.now()
  const stoppedTasks = markAgentRoundTasksStopped(conversationId, roundId, now)
  let stoppedRound = false
  // Flush any pending streaming text before updating conversation state
  const conversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
  const round = conversation?.rounds.find((item) => item.id === roundId)
  const assistantMessage = round
    ? round.assistantMessageId
      ? conversation?.messages.find((message) => message.id === round.assistantMessageId)
      : conversation?.messages.find((message) => message.roundId === round.id && message.role === 'assistant')
    : undefined
  if (assistantMessage) {
    flushAgentAssistantMessageContent(conversationId, assistantMessage.id)
    useRuntimeStore.getState().clearAgentStreamingText(conversationId, assistantMessage.id)
  }
  updateAgentConversation(conversationId, (current) => {
    const round = current.rounds.find((item) => item.id === roundId)
    if (!round || round.status !== 'running') return current

    stoppedRound = true
    const existingAssistantMessage = current.messages.find(
      (message) => message.roundId === roundId && message.role === 'assistant',
    )
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    return {
      ...current,
      updatedAt: now,
      rounds: current.rounds.map((item) =>
        item.id === roundId
          ? {
              ...item,
              ...(assistantMessageId ? { assistantMessageId } : {}),
              status: 'error',
              error: AGENT_STOPPED_MESSAGE,
              finishedAt: now,
            }
          : item,
      ),
      messages: existingAssistantMessage
        ? current.messages.map((message) =>
            message.id === existingAssistantMessage.id
              ? { ...message, content: appendAgentStoppedMessage(message.content) }
              : message,
          )
        : [
            ...current.messages,
            {
              id: assistantMessageId,
              role: 'assistant',
              content: AGENT_STOPPED_MESSAGE,
              roundId,
              createdAt: now,
            },
          ],
    }
  })
  return stoppedRound || stoppedTasks
}

// ===== Agent streaming text debounce =====
const agentTextFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const agentTextBuffers = new Map<string, string>()

function getAgentTextFlushKey(conversationId: string, messageId: string) {
  return `${conversationId}:${messageId}`
}

function flushAgentAssistantMessageContent(conversationId: string, messageId: string) {
  const key = getAgentTextFlushKey(conversationId, messageId)
  const delta = agentTextBuffers.get(key)
  agentTextBuffers.delete(key)
  agentTextFlushTimers.delete(key)
  if (!delta) return
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    messages: current.messages.map((message) =>
      message.id === messageId ? { ...message, content: `${message.content}${delta}` } : message,
    ),
  }))
}

function appendAgentAssistantMessageContent(conversationId: string, messageId: string, delta: string) {
  if (!delta) return
  const key = getAgentTextFlushKey(conversationId, messageId)
  const existing = agentTextBuffers.get(key) ?? ''
  agentTextBuffers.set(key, existing + delta)
  // Update lightweight streaming text state immediately for UI responsiveness
  useRuntimeStore.getState().setAgentStreamingText(conversationId, messageId, existing + delta)
  // Debounce heavy agentConversations update
  const existingTimer = agentTextFlushTimers.get(key)
  if (existingTimer) clearTimeout(existingTimer)
  agentTextFlushTimers.set(
    key,
    setTimeout(() => flushAgentAssistantMessageContent(conversationId, messageId), 80),
  )
}

function clearAgentTextFlushTimer(conversationId: string, messageId: string) {
  const key = getAgentTextFlushKey(conversationId, messageId)
  const timer = agentTextFlushTimers.get(key)
  if (timer) clearTimeout(timer)
  agentTextFlushTimers.delete(key)
  agentTextBuffers.delete(key)
}

/** 消息终态（完成/出错/删除）时统一清理：陈旧 flush 定时器 + 流式文本残留。 */
function clearAgentMessageStreamState(conversationId: string, messageId: string) {
  clearAgentTextFlushTimer(conversationId, messageId)
  useRuntimeStore.getState().clearAgentStreamingText(conversationId, messageId)
}

async function generateAgentConversationTitle(
  conversationId: string,
  prompt: string,
  inputImageIds: string[],
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  fallbackTitle: string,
) {
  useStore.setState((state) => {
    const next = { ...state.agentGeneratingTitleIds, [conversationId]: true as const }
    return { agentGeneratingTitleIds: next }
  })
  try {
    const imageDataUrls = await readAgentImageDataUrls(inputImageIds)
    const title = await callAgentConversationTitleApi({
      settings: requestSettings,
      profile: activeProfile,
      prompt,
      imageDataUrls,
    })
    if (!title || title === fallbackTitle) return

    updateAgentConversation(conversationId, (current) => {
      const firstRound = current.rounds[0]
      if (!firstRound || firstRound.prompt !== prompt || current.title !== fallbackTitle) return current
      return { ...current, title, updatedAt: Date.now() }
    })
  } catch {
    // Title generation is best-effort; keep the local fallback title on failure.
  } finally {
    useStore.setState((state) => {
      const next = { ...state.agentGeneratingTitleIds }
      delete next[conversationId]
      return { agentGeneratingTitleIds: next }
    })
  }
}

export function stopAgentResponse(conversationId = useStore.getState().activeAgentConversationId) {
  if (!conversationId) return
  const conversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
  if (!conversation) return
  const activeRunningRound = [...getActiveAgentRounds(conversation)]
    .reverse()
    .find((round) => round.status === 'running')
  const runningRound = activeRunningRound ?? conversation.rounds.find((round) => round.status === 'running')
  if (!runningRound) return

  // Clear any pending streaming text flush and buffer
  const assistantMessage = runningRound.assistantMessageId
    ? conversation.messages.find((message) => message.id === runningRound.assistantMessageId)
    : conversation.messages.find((message) => message.roundId === runningRound.id && message.role === 'assistant')
  if (assistantMessage) {
    clearAgentTextFlushTimer(conversationId, assistantMessage.id)
    useRuntimeStore.getState().clearAgentStreamingText(conversationId, assistantMessage.id)
  }

  const controller = agentRoundControllers.get(getAgentRoundControllerKey(conversationId, runningRound.id))
  if (controller) {
    controller.abort()
    if (markAgentRoundStopped(conversationId, runningRound.id)) {
      useStore.getState().showToast('已停止生成', 'info')
    }
    return
  }

  markAgentRoundStopped(conversationId, runningRound.id)
  useStore.getState().showToast('已停止生成', 'info')
}

function getAgentRoundChildren(conversation: AgentConversation, parentRoundId: string | null) {
  return conversation.rounds.filter((round) => (round.parentRoundId ?? null) === parentRoundId)
}

function getLatestAgentLeafId(conversation: AgentConversation, startRoundId: string | null = null): string | null {
  let currentId = startRoundId
  if (!currentId) {
    const roots = getAgentRoundChildren(conversation, null)
    currentId = roots[roots.length - 1]?.id ?? null
  }

  while (currentId) {
    const children = getAgentRoundChildren(conversation, currentId)
    const nextId = children[children.length - 1]?.id ?? null
    if (!nextId) return currentId
    currentId = nextId
  }

  return null
}

export function getAgentRoundPath(conversation: AgentConversation, roundId: string | null): AgentRound[] {
  if (!roundId) return []
  const byId = new Map(conversation.rounds.map((round) => [round.id, round]))
  const path: AgentRound[] = []
  const seen = new Set<string>()
  let current = byId.get(roundId) ?? null

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentRoundId ? (byId.get(current.parentRoundId) ?? null) : null
  }

  return path
}

export function getActiveAgentRounds(conversation: AgentConversation): AgentRound[] {
  const activeRoundId =
    conversation.activeRoundId && conversation.rounds.some((round) => round.id === conversation.activeRoundId)
      ? conversation.activeRoundId
      : getLatestAgentLeafId(conversation)
  return getAgentRoundPath(conversation, activeRoundId ?? null)
}

function reindexAgentRounds(conversation: AgentConversation): AgentConversation {
  const indexById = new Map<string, number>()
  const visit = (parentRoundId: string | null, depth: number) => {
    for (const child of getAgentRoundChildren(conversation, parentRoundId)) {
      indexById.set(child.id, depth)
      visit(child.id, depth + 1)
    }
  }
  visit(null, 1)
  return {
    ...conversation,
    rounds: conversation.rounds.map((round) => ({
      ...round,
      index: indexById.get(round.id) ?? round.index,
    })),
  }
}

export function remapAgentRoundMentionsForPathChange(content: string, oldPath: AgentRound[], newPath: AgentRound[]) {
  if (!content || oldPath.length === 0) return content
  const newIndexByRoundId = new Map(newPath.map((round, index) => [round.id, index + 1]))
  return content.replace(AGENT_ROUND_IMAGE_MENTION_RE, (match, roundNumber: string, imageNumber: string) => {
    const oldRound = oldPath[Number(roundNumber) - 1]
    if (!oldRound) return match
    const newRoundIndex = newIndexByRoundId.get(oldRound.id)
    if (!newRoundIndex) return `@已删除轮次图${imageNumber}`
    return `@第${newRoundIndex}轮图${imageNumber}`
  })
}

export function deleteAgentRoundFromConversation(
  conversation: AgentConversation,
  roundId: string,
  now = Date.now(),
): AgentConversation {
  const targetRound = conversation.rounds.find((round) => round.id === roundId)
  if (!targetRound) return conversation

  const oldPathByRoundId = new Map(
    conversation.rounds.map((round) => [round.id, getAgentRoundPath(conversation, round.id)]),
  )
  const rounds = conversation.rounds
    .filter((candidate) => candidate.id !== roundId)
    .map((candidate) =>
      candidate.parentRoundId === roundId
        ? { ...candidate, parentRoundId: targetRound.parentRoundId ?? null }
        : candidate,
    )
  const messages = conversation.messages.filter((candidate) => candidate.roundId !== roundId)
  const nextConversation = reindexAgentRounds({
    ...conversation,
    rounds,
    messages,
    activeRoundId: conversation.activeRoundId === roundId ? null : (conversation.activeRoundId ?? null),
  })
  const newPathByRoundId = new Map(
    nextConversation.rounds.map((round) => [round.id, getAgentRoundPath(nextConversation, round.id)]),
  )
  const remappedMessages = nextConversation.messages.map((message) => {
    if (!message.roundId) return message
    const oldPath = oldPathByRoundId.get(message.roundId) ?? []
    const newPath = newPathByRoundId.get(message.roundId) ?? []
    const content = remapAgentRoundMentionsForPathChange(message.content, oldPath, newPath)
    return content === message.content ? message : { ...message, content }
  })
  const withRemappedMessages = { ...nextConversation, messages: remappedMessages }
  const activeRounds = getActiveAgentRounds(withRemappedMessages)
  return {
    ...withRemappedMessages,
    activeRoundId: withRemappedMessages.activeRoundId ?? activeRounds[activeRounds.length - 1]?.id ?? null,
    updatedAt: now,
  }
}

export function getAgentSiblingRounds(conversation: AgentConversation, round: AgentRound) {
  return getAgentRoundChildren(conversation, round.parentRoundId ?? null)
}

export function getAgentBranchLeafId(conversation: AgentConversation, roundId: string) {
  return getLatestAgentLeafId(conversation, roundId) ?? roundId
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)))
}

function addTaskReferencedImageIds(target: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) target.add(id)
  if (task.maskImageId) target.add(task.maskImageId)
  for (const id of task.outputImages || []) target.add(id)
  for (const id of task.streamPartialImageIds || []) target.add(id)
}

function addSopCoverReferencedImageIds(target: Set<string>) {
  for (const item of useRequirementPrototype.getState().sopLibrary) {
    if (item.coverImageId) target.add(item.coverImageId)
  }
}

/**
 * 从当前 store 状态 + 素材库构建统一引用图。
 * 素材（有效/回收站）持有原图与来源输入的拥有型引用，删除任务不会误删素材原图。
 * @param snapshot 可复用的素材库快照；缺省时内部全量读取（purge 预览/执行可传入复用，避免重复全量扫描）
 */
export async function buildStoreImageReferenceGraph(snapshot?: AssetLibrarySnapshot): Promise<ImageReferenceGraph> {
  const state = useStore.getState()
  const requirementState = useRequirementPrototype.getState()
  const [sopRuns, resolvedSnapshot] = await Promise.all([
    getAllSopBatchSnapshots(),
    snapshot ? Promise.resolve(snapshot) : hydrateFull(),
  ])
  return buildImageReferenceGraph({
    tasks: state.tasks,
    assets: resolvedSnapshot.assets,
    workspaceTabs: state.workspaceTabs,
    agentConversations: state.agentConversations,
    sopRuns,
    sopCoverImageIds: requirementState.sopLibrary
      .map((item) => item.coverImageId)
      .filter((id): id is string => Boolean(id)),
    currentInputImageIds: state.inputImages.map((img) => img.id),
    galleryDraftInputImageIds: state.galleryInputDraft?.inputImages.map((img) => img.id) ?? [],
    agentDraftInputImageIds: Object.values(state.agentInputDrafts).flatMap((draft) =>
      draft.inputImages.map((img) => img.id),
    ),
    additionalReferences: [
      ...requirementState.strategyAssets.flatMap((strategy) => [
        ...(strategy.coverImageId
          ? [
              {
                imageId: strategy.coverImageId,
                reference: {
                  type: 'strategy-cover' as const,
                  ownerId: strategy.id,
                  label: `策略封面（${strategy.name}）`,
                  blocking: true,
                },
              },
            ]
          : []),
        ...(strategy.workflow.reference?.imageIds ?? []).map((imageId) => ({
          imageId,
          reference: {
            type: 'strategy-reference' as const,
            ownerId: strategy.id,
            label: `策略参考图（${strategy.name}）`,
            blocking: true,
          },
        })),
      ]),
      ...Object.values(requirementState.strategyAssetVersions)
        .flat()
        .flatMap((strategy) => [
          ...(strategy.coverImageId
            ? [
                {
                  imageId: strategy.coverImageId,
                  reference: {
                    type: 'strategy-cover' as const,
                    ownerId: strategy.id,
                    label: `策略历史封面（${strategy.name}）`,
                    blocking: true,
                  },
                },
              ]
            : []),
          ...(strategy.workflow.reference?.imageIds ?? []).map((imageId) => ({
            imageId,
            reference: {
              type: 'strategy-reference' as const,
              ownerId: strategy.id,
              label: `策略历史参考图（${strategy.name}）`,
              blocking: true,
            },
          })),
        ]),
      ...requirementState.orders.flatMap((order) =>
        order.units.flatMap((unit) =>
          (unit.referenceImageIds ?? []).map((imageId) => ({
            imageId,
            reference: {
              type: 'ordering' as const,
              ownerId: order.id,
              label: `排单参考图（${order.number}）`,
              blocking: true,
            },
          })),
        ),
      ),
      ...getSopAiRevisionAttachmentReferences().map(({ documentId, imageId }) => ({
        imageId,
        reference: {
          type: 'sop-ai-conversation' as const,
          ownerId: documentId,
          label: 'SOP AI 对话图片',
          blocking: true,
        },
      })),
    ],
  })
}

export interface PurgeGeneratedAssetsResult {
  purged: string[]
  blocked: AssetPurgeBlockedItem[]
  /** force 清空时解除的引用处数（无解除时为 undefined） */
  detachedRefCount?: number
}

/** 强制清空：解除引用后用于提示的汇总信息。 */
export interface PurgeDetachSummary {
  detachedRefCount: number
  patchedTasks: number
  patchedAssets: number
  patchedTabs: number
  patchedConversations: number
  patchedSopSnapshots: number
  patchedModuleRecords: number
}

function countChanged<T>(before: T[], after: T[]): number {
  return after.reduce((count, item, index) => count + (item !== before[index] ? 1 : 0), 0)
}

/**
 * 强制清空回收站：在删除素材前，把对将删图片的所有拥有型引用从归属记录中剥离。
 * 覆盖：任务输入/遮罩/流式中间图、其他素材来源快照、工作区标签页与输入草稿、
 * Agent 会话、SOP 批量快照，以及策略 / SOP 库 / 排单 / 词条批次（持久化 store）。
 * 全部成功后才允许调用方删除素材记录与图片字节；返回补丁汇总供 UI 提示。
 */
async function detachImageReferencesForPurge(items: ForceDetachItem[]): Promise<PurgeDetachSummary> {
  const imageIds = new Set(items.map((item) => item.imageId))
  let detachedRefCount = 0
  for (const item of items) detachedRefCount += item.references.length

  const state = useStore.getState()
  const tasksById = new Map(state.tasks.map((task) => [task.id, task]))
  const workspaceTabIds = new Set(state.workspaceTabs.map((tab) => tab.id))

  // 按引用类型与归属者归类（mask 类型同时被任务与工作区标签页使用，按 ownerId 归属判定）
  const taskIds = new Set<string>()
  const assetOwnerIds = new Set<string>()
  const tabIds = new Set<string>()
  const conversationIds = new Set<string>()
  const sopRunIds = new Set<string>()
  const strategyIds = new Set<string>()
  const orderIds = new Set<string>()
  const sopAiDocumentIds = new Set<string>()
  let sopCoverTouched = false
  let currentInputTouched = false
  let galleryDraftTouched = false
  const agentDraftConversationIds = new Set<string>()

  const requirementState = useRequirementPrototype.getState()
  for (const item of items) {
    for (const ref of item.references) {
      switch (ref.type) {
        case 'task-input':
          taskIds.add(ref.ownerId)
          break
        case 'mask':
          if (tasksById.has(ref.ownerId)) taskIds.add(ref.ownerId)
          else if (workspaceTabIds.has(ref.ownerId)) tabIds.add(ref.ownerId)
          break
        case 'asset-origin-input':
          assetOwnerIds.add(ref.ownerId)
          break
        case 'gallery-draft':
          if (ref.ownerId === 'current-input') currentInputTouched = true
          else if (ref.ownerId === 'gallery-draft') galleryDraftTouched = true
          else tabIds.add(ref.ownerId)
          break
        case 'agent-draft':
          agentDraftConversationIds.add(ref.ownerId)
          break
        case 'agent-conversation':
          conversationIds.add(ref.ownerId)
          break
        case 'sop-reference':
          sopRunIds.add(ref.ownerId)
          break
        case 'sop-ai-conversation':
          sopAiDocumentIds.add(ref.ownerId)
          break
        case 'sop-cover':
          sopCoverTouched = true
          break
        case 'strategy-cover':
        case 'strategy-reference':
          strategyIds.add(ref.ownerId)
          break
        case 'ordering':
          orderIds.add(ref.ownerId)
          break
        default:
          console.warn('[asset-purge] 强制清空遇到未处理的引用类型', ref.type, ref.ownerId)
      }
    }
  }

  // ---- 任务（task-input / mask / 流式中间图）----
  const tasksToPatch: TaskRecord[] = []
  for (const taskId of taskIds) {
    const task = tasksById.get(taskId)
    if (!task) continue
    const patched = patchTaskForDetachedInputs(task, imageIds)
    if (patched !== task) {
      tasksToPatch.push(patched)
      tasksById.set(taskId, patched)
    }
  }
  if (tasksToPatch.length > 0) {
    useStore.setState({ tasks: [...tasksById.values()] })
    await batchPutTasks(tasksToPatch)
  }

  // ---- 其他素材来源快照（asset-origin-input）----
  const assetsToPatch: GeneratedAsset[] = []
  if (assetOwnerIds.size > 0) {
    const owners = await getAssetsByIds([...assetOwnerIds])
    for (const owner of owners.values()) {
      const patched = patchAssetOriginsForDetachedImages(owner, imageIds)
      if (patched !== owner) assetsToPatch.push(patched)
    }
    if (assetsToPatch.length > 0) {
      await putGeneratedAssets(assetsToPatch)
      useAssetLibraryStore.setState((current) => {
        const assetsById = { ...current.assetsById }
        for (const asset of assetsToPatch) assetsById[asset.id] = asset
        return { assetsById, mutationVersion: current.mutationVersion + 1 }
      })
    }
  }

  // ---- 工作区标签页 + 当前输入 + 画廊草稿 + Agent 草稿（gallery-draft / agent-draft / mask）----
  const workspaceState = useStore.getState()
  let workspaceTabs = workspaceState.workspaceTabs
  const tabChanges = new Map<string, WorkspaceTab>()
  if (tabIds.size > 0) {
    for (const tab of workspaceState.workspaceTabs) {
      if (!tabIds.has(tab.id)) continue
      const patched = patchWorkspaceTabForDetachedImages(tab, imageIds)
      if (patched !== tab) tabChanges.set(tab.id, patched)
    }
    if (tabChanges.size > 0) workspaceTabs = workspaceState.workspaceTabs.map((tab) => tabChanges.get(tab.id) ?? tab)
  }
  let inputImages = workspaceState.inputImages
  if (currentInputTouched) inputImages = patchInputImageList(inputImages, imageIds)
  let galleryInputDraft = workspaceState.galleryInputDraft
  if (galleryDraftTouched && galleryInputDraft) {
    const patched = patchInputDraftLike(galleryInputDraft, imageIds)
    galleryInputDraft = isEmptyAgentInputDraft(patched) ? null : patched
  }
  let agentInputDrafts = workspaceState.agentInputDrafts
  if (agentDraftConversationIds.size > 0) {
    const next: Record<string, AgentInputDraft> = { ...agentInputDrafts }
    for (const conversationId of agentDraftConversationIds) {
      const draft = next[conversationId]
      if (!draft) continue
      const patched = patchInputDraftLike(draft, imageIds)
      if (isEmptyAgentInputDraft(patched)) delete next[conversationId]
      else next[conversationId] = patched
    }
    agentInputDrafts = next
  }
  if (
    workspaceTabs !== workspaceState.workspaceTabs ||
    inputImages !== workspaceState.inputImages ||
    galleryInputDraft !== workspaceState.galleryInputDraft ||
    agentInputDrafts !== workspaceState.agentInputDrafts
  ) {
    useStore.setState({ workspaceTabs, inputImages, galleryInputDraft, agentInputDrafts })
  }

  // ---- Agent 会话（agent-conversation）----
  let agentConversations = workspaceState.agentConversations
  if (conversationIds.size > 0) {
    agentConversations = workspaceState.agentConversations.map((conversation) =>
      conversationIds.has(conversation.id)
        ? patchAgentConversationForDetachedImages(conversation, imageIds)
        : conversation,
    )
    const changed = agentConversations.some(
      (conversation, index) => conversation !== workspaceState.agentConversations[index],
    )
    if (changed) useStore.setState({ agentConversations })
  }

  // ---- SOP 批量快照（IndexedDB）----
  let patchedSopSnapshots = 0
  if (sopRunIds.size > 0) {
    const snapshots = await getAllSopBatchSnapshots()
    const changed: SopBatchSnapshot[] = []
    for (const snapshot of snapshots) {
      if (!sopRunIds.has(snapshot.id)) continue
      const patched = patchSopSnapshotForDetachedImages(snapshot, imageIds)
      if (patched !== snapshot) changed.push(patched)
    }
    if (changed.length > 0) {
      patchedSopSnapshots = changed.length
      await Promise.all(changed.map((snapshot) => putSopBatchSnapshot(snapshot)))
    }
  }

  // ---- requirementPrototype 持久化 store（策略 / 版本 / SOP 库 / 排单）----
  let strategyAssets = requirementState.strategyAssets
  let strategyAssetVersions = requirementState.strategyAssetVersions
  let sopLibrary = requirementState.sopLibrary
  let orders = requirementState.orders
  if (strategyIds.size > 0) {
    strategyAssets = requirementState.strategyAssets.map((strategy) =>
      strategyIds.has(strategy.id) ? patchStrategyAssetForDetachedImages(strategy, imageIds) : strategy,
    )
    strategyAssetVersions = Object.fromEntries(
      Object.entries(requirementState.strategyAssetVersions).map(([strategyId, versions]) => [
        strategyId,
        versions.map((strategy) =>
          strategyIds.has(strategy.id) ? patchStrategyAssetForDetachedImages(strategy, imageIds) : strategy,
        ),
      ]),
    )
  }
  if (sopCoverTouched) {
    sopLibrary = requirementState.sopLibrary.map((item) =>
      item.coverImageId && imageIds.has(item.coverImageId)
        ? patchSopLibraryItemForDetachedImages(item, imageIds)
        : item,
    )
  }
  if (orderIds.size > 0) {
    orders = requirementState.orders.map((order) =>
      orderIds.has(order.id) ? patchOrderForDetachedImages(order, imageIds) : order,
    )
  }
  const requirementChanged =
    strategyAssets !== requirementState.strategyAssets ||
    strategyAssetVersions !== requirementState.strategyAssetVersions ||
    sopLibrary !== requirementState.sopLibrary ||
    orders !== requirementState.orders
  if (requirementChanged) {
    useRequirementPrototype.setState({ strategyAssets, strategyAssetVersions, sopLibrary, orders })
  }

  let patchedModuleRecords = 0
  if (strategyIds.size > 0) {
    patchedModuleRecords += countChanged(requirementState.strategyAssets, strategyAssets)
    for (const [strategyId, versions] of Object.entries(requirementState.strategyAssetVersions)) {
      const patched = strategyAssetVersions[strategyId] ?? []
      if (patched.some((strategy, index) => strategy !== versions[index])) patchedModuleRecords++
    }
  }
  if (sopCoverTouched) patchedModuleRecords += countChanged(requirementState.sopLibrary, sopLibrary)
  if (orderIds.size > 0) patchedModuleRecords += countChanged(requirementState.orders, orders)
  if (sopAiDocumentIds.size > 0) patchedModuleRecords += removeSopAiRevisionAttachments(imageIds)

  return {
    detachedRefCount,
    patchedTasks: tasksToPatch.length,
    patchedAssets: assetsToPatch.length,
    patchedTabs: tabChanges?.size ?? 0,
    patchedConversations:
      conversationIds.size > 0
        ? agentConversations.reduce(
            (count, conversation, index) => count + (conversation !== workspaceState.agentConversations[index] ? 1 : 0),
            0,
          )
        : 0,
    patchedSopSnapshots,
    patchedModuleRecords,
  }
}

/**
 * 永久删除前预览：构建删除计划（允许项 + 阻断引用），不执行任何写入。
 * 供 UI 在真正删除前展示引用冲突与数量确认。
 */
export async function planPurgeGeneratedAssets(assetIds: string[]): Promise<AssetPurgePlan> {
  const { tasks } = useStore.getState()
  const snapshot = await hydrateFull()
  const graph = await buildStoreImageReferenceGraph(snapshot)
  return planAssetPurge({ assetIds, assets: snapshot.assets, tasks, graph })
}

/**
 * 永久删除素材的事务写入（Electron：SQLite 单事务删素材+写墓碑为权威，
 * 随后同步清理 IndexedDB 旧记录；浏览器：原有 IndexedDB 单事务）。
 */
async function purgeGeneratedAssetsNow(records: PurgeRecords): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (api?.assetCatalogPurge) {
    await api.assetCatalogPurge(
      records.assetIds,
      Date.now(),
      records.tasksToPatch.map((task) => ({ id: task.id, value: task })),
    )
    return
  }
  await purgeGeneratedAssetsInTransaction(records)
}

/**
 * 永久删除素材：引用冲突检查 → 权威存储清理（任务补丁 + 删素材 + 写墓碑）→ 删除图片字节。
 * 阻断的素材不会被删除，返回值供 UI 展示冲突原因。
 */
export interface PurgeGeneratedAssetsProgress {
  /** 执行阶段：preparing=读取素材/构建引用图/制定计划；records=删除素材记录；images=清理图片字节 */
  phase: 'preparing' | 'records' | 'images'
  done?: number
  total?: number
}

export interface PurgeGeneratedAssetsOptions {
  /** 复用调用方已生成的删除计划（如确认弹窗预览），跳过重复的读取/建图/规划 */
  plan?: AssetPurgePlan
  /**
   * 强制清空：被引用（拥有型引用）的素材也一并彻底删除，删除前自动解除其全部引用
   * （任务输入、工作区、Agent 会话、SOP、策略/排单等）。默认 false：被引用素材保留。
   */
  force?: boolean
  /**
   * 本次删除的发起者标签（如 `local-file-removed` / `user-purge` / `trash-empty`）。
   *
   * 「素材莫名消失」是事后最贵的一类问题：库里只剩 tombstones 的时间戳，
   * 谁删的、为什么删全是空白（2026-09-21 实测：132 张素材被永久删除，
   * 只有 16:36/16:45/16:47 三批时间戳，无法判断来源）。带上来源即可一眼定位。
   */
  reason?: string
  onProgress?: (progress: PurgeGeneratedAssetsProgress) => void
}

export interface RemovedManagedImageFile {
  path: string
  imageId?: string
}

function normalizeManagedImagePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').toLocaleLowerCase()
}

/** 磁盘上的应用管理图片被外部删除后，按图片 id 走统一永久删除流程。 */
export async function removeDeletedLocalImage(file: RemovedManagedImageFile): Promise<number> {
  const imageIds = new Set<string>()
  if (file.imageId) imageIds.add(file.imageId)
  const removedPath = normalizeManagedImagePath(file.path)
  for (const task of useStore.getState().tasks) {
    for (const [key, localPath] of Object.entries(task.localSavedOutputImagePaths ?? {})) {
      if (normalizeManagedImagePath(localPath) !== removedPath) continue
      const imageId = key.slice(key.indexOf(':') + 1)
      if (imageId) imageIds.add(imageId)
    }
  }
  if (imageIds.size === 0) {
    // 文件消失但没有任何任务引用它 ⇒ 多为缓存/中间图的正常清理。
    // 记一行是为了与「素材被删」区分开：排查「素材莫名消失」时，
    // 「没有这行」本身就是证据（说明被删的确实是任务产出图）。
    console.info('[library-image-sync] 托管图片文件消失，未命中任何任务产出', { filePath: file.path })
    return 0
  }

  const loadedAssets = Object.values(useAssetLibraryStore.getState().assetsById).filter((asset) =>
    imageIds.has(asset.imageId),
  )
  const assetsByImageId =
    loadedAssets.length === imageIds.size
      ? new Map(loadedAssets.map((asset) => [asset.imageId, asset]))
      : await getAssetsByImageIds([...imageIds])
  const eventAssets = [
    ...new Map([...loadedAssets, ...assetsByImageId.values()].map((asset) => [asset.id, asset])).values(),
  ]
  const assetIds = eventAssets.map((asset) => asset.id)
  if (assetIds.length === 0) return 0

  // 删除事件可能发生在当前分页未加载该素材时。把事件命中的素材补进全量快照，
  // 仍由统一引用图和永久删除事务决定最终清理范围。
  const snapshot = await hydrateFull()
  const snapshotAssetsById = new Map(snapshot.assets.map((asset) => [asset.id, asset]))
  for (const asset of eventAssets) snapshotAssetsById.set(asset.id, asset)
  const mergedSnapshot = { ...snapshot, assets: [...snapshotAssetsById.values()] }
  const graph = await buildStoreImageReferenceGraph(mergedSnapshot)
  const plan = planAssetPurge(
    { assetIds, assets: mergedSnapshot.assets, tasks: useStore.getState().tasks, graph },
    { force: true },
  )
  const result = await purgeGeneratedAssets(assetIds, { plan, reason: 'local-file-removed' })
  if (result.purged.length > 0) {
    // 这是唯一会**自动**永久删除素材的路径（file watcher 报告原图文件消失）。
    // 「素材莫名消失」排查时先看这行：命中说明是文件先没了，未命中则另有来源。
    console.warn('[library-image-sync] 原图文件消失 ⇒ 素材被永久删除', {
      filePath: file.path,
      imageIds: [...imageIds],
      purged: result.purged.length,
    })
  }
  return result.purged.length
}

export async function purgeGeneratedAssets(
  assetIds: string[],
  options: PurgeGeneratedAssetsOptions = {},
): Promise<PurgeGeneratedAssetsResult> {
  if (assetIds.length === 0) return { purged: [], blocked: [] }
  const force = options.force === true
  const { setTasks } = useStore.getState()
  let plan = options.plan
  // force 模式必须用 force 计划（被引用素材也要进入删除列表），不能复用普通预览计划
  if (!plan || force) {
    options.onProgress?.({ phase: 'preparing' })
    const snapshot = await hydrateFull()
    const graph = await buildStoreImageReferenceGraph(snapshot)
    const { tasks } = useStore.getState()
    plan = planAssetPurge({ assetIds, assets: snapshot.assets, tasks, graph }, { force })
  }
  if (plan.allowedAssetIds.length === 0) {
    return { purged: [], blocked: plan.blocked }
  }

  // 强制清空：先解除全部引用（任务输入、工作区、Agent、SOP、策略/排单等），再删记录与字节
  let detachedRefCount = 0
  if (force && plan.forceDetach.length > 0) {
    const summary = await detachImageReferencesForPurge(plan.forceDetach)
    detachedRefCount = summary.detachedRefCount
  }

  // 引用解除后重新读取任务（getTask 供输出槽位补丁使用，需包含解除后的任务状态）
  const tasksById = new Map(useStore.getState().tasks.map((task) => [task.id, task]))
  // 提前收集被删素材的本地导出文件路径——executeAssetPurge 会把任务的
  // localSavedOutputImagePaths 中对应条目清空，之后再读取就收集不到了。
  const purgeLocalSavedPaths = collectLocalSavedOutputPaths([...tasksById.values()], (imageId) =>
    plan.imageIdsToDelete.includes(imageId),
  )
  // 磁盘原图路径由 `executeAssetPurge` 在删记录**之前**回调收集（顺序契约写在那个函数里）：
  // 记录一删就再也查不到 localPath，磁盘原图会静默残留。
  await executeAssetPurge(
    plan,
    {
      getTask: async (taskId) => tasksById.get(taskId),
      purgeRecords: purgeGeneratedAssetsNow,
      collectImagePaths: async (imageIds) => {
        const { batchGetImages } = await import('./lib/db')
        const images = await batchGetImages(imageIds)
        return [...images.values()].map((image) => image.localPath).filter((path): path is string => Boolean(path))
      },
      deleteImageFiles: async (filePaths) => {
        const { deleteRawCacheImages } = await import('./lib/localSave')
        await deleteRawCacheImages(filePaths)
      },
      // 批量删除图片字节（分块事务 + 磁盘缓存分批清理），清空回收站/批量删除时避免逐张事务
      deleteImages: async (imageIds, onImagesProgress) => {
        if (imageIds.length === 0) return
        const { batchDeleteImages } = await import('./lib/db')
        await batchDeleteImages(imageIds, onImagesProgress)
        for (const imageId of imageIds) {
          imageCache.delete(imageId)
          thumbnailCache.delete(imageId)
        }
      },
    },
    (stage, done, total) => {
      if (stage === 'records') options.onProgress?.({ phase: 'records' })
      else options.onProgress?.({ phase: 'images', done, total })
    },
  )

  // 同步主 store 内存任务：输出槽位已由事务清空
  if (plan.taskOutputCleanups.length > 0) {
    for (const cleanup of plan.taskOutputCleanups) {
      const task = tasksById.get(cleanup.taskId)
      if (task) tasksById.set(cleanup.taskId, patchTaskForPurgedSlots(task, cleanup.outputSlots))
    }
    setTasks([...tasksById.values()])
  }

  // 同步素材库 store
  for (const id of plan.allowedAssetIds) {
    useAssetLibraryStore.getState().removeAssetLocal(id)
  }

  // 永久删除素材后，把引用这些原图 id 的本地导出文件（用户保存到自定义目录的真实文件）一并删除
  if (purgeLocalSavedPaths.length > 0) {
    const { deleteLocalImageFiles } = await import('./lib/localSave')
    await deleteLocalImageFiles(purgeLocalSavedPaths)
  }

  // 永久删除是**不可逆**的，且界面上事后只剩「素材莫名消失」——必须留下可回溯的一行：
  // 谁发起的（reason）、请求几条、实际删了几条、被引用拦下几条。
  console.info('[asset-purge] 永久删除素材', {
    reason: options.reason ?? '(未标注来源)',
    requested: assetIds.length,
    purged: plan.allowedAssetIds.length,
    blocked: plan.blocked.length,
    force,
    detachedRefCount,
    sampleAssetIds: plan.allowedAssetIds.slice(0, 3),
  })

  return {
    purged: plan.allowedAssetIds,
    blocked: plan.blocked,
    detachedRefCount: detachedRefCount > 0 ? detachedRefCount : undefined,
  }
}

async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  const candidates = Array.from(new Set(Array.from(imageIds).filter(Boolean)))
  if (candidates.length === 0) return

  const graph = await buildStoreImageReferenceGraph()
  for (const imgId of candidates) {
    if (isImageReferenced(graph, imgId)) continue
    await deleteImage(imgId)
    imageCache.delete(imgId)
    clearCachedThumbnail(imgId)
  }
}

export async function cleanupAllOrphanedImages(): Promise<number> {
  const orphanIds = await getAllOrphanedImageIds()
  for (const imgId of orphanIds) {
    await deleteImage(imgId)
    imageCache.delete(imgId)
    clearCachedThumbnail(imgId)
  }
  return orphanIds.length
}

/**
 * 失效图片清理：源文件丢失（无 dataUrl 且 localPath 文件不存在）的图片，
 * 删除其 IDB 记录与磁盘缩略图——这类图大概率是用户此前主动清理过源文件的历史数据，
 * 保留记录只会让界面永远显示「加载中」占位。
 * 排除素材库引用的图（素材有 SQLite 目录兜底，不应被图记录清理波及）。
 * 返回清理数量。
 */
export async function cleanupMissingImageRecords(): Promise<number> {
  if (!isElectronEnv()) return 0
  const allImages = await getAllImages()
  const candidates: StoredImage[] = []
  for (const image of allImages) {
    if (image.dataUrl) continue
    if (!image.localPath) {
      candidates.push(image)
      continue
    }
    const exists = await fileExistsOnDisk(image.localPath)
    if (!exists) candidates.push(image)
  }
  if (candidates.length === 0) return 0

  // 排除素材库引用的图：素材的原图仍由 SQLite 目录兜底（resolveImageFromCatalog 可恢复）。
  // 素材 id（asset:xxx）与 imageId 是两套键，这里直接取全量素材的 imageId 集合比对。
  let referencedImageIds = new Set<string>()
  try {
    const api = window.electronAPI
    if (api?.assetCatalogExportAll) {
      const allAssets = await api.assetCatalogExportAll()
      referencedImageIds = new Set(allAssets.map((asset) => asset.imageId).filter(Boolean))
    }
  } catch {
    // 导出失败时保守处理：不清理任何图（避免误删素材引用）
    return 0
  }
  const toClean = candidates.filter((candidate) => !referencedImageIds.has(candidate.id))
  if (toClean.length === 0) return 0

  const ids = toClean.map((candidate) => candidate.id)
  await batchDeleteImages(ids)
  await deleteThumbnailsFromDisk(ids)
  for (const id of ids) {
    imageCache.delete(id)
    clearCachedThumbnail(id)
  }
  useStore.getState().showToast(`已清理 ${toClean.length} 张源文件缺失的图片（含缩略图）`, 'info')
  return toClean.length
}

export async function getAllOrphanedImageIds(): Promise<string[]> {
  const allImageIds = await getAllImageIds()
  const graph = await buildStoreImageReferenceGraph()
  return allImageIds.filter((imageId) => !isImageReferenced(graph, imageId))
}

async function persistTaskStreamPartialImage(taskId: string, dataUrl: string) {
  try {
    const imgId = await storeImage(dataUrl, 'generated')
    cacheImage(imgId, dataUrl)

    const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
    if (!latestTask || latestTask.status === 'done') {
      await deleteUnreferencedImageIds([imgId])
      return
    }

    const currentIds = latestTask.streamPartialImageIds || []
    if (currentIds.includes(imgId)) return
    const nextIds = [...currentIds, imgId]
    const retainedIds = nextIds.slice(-MAX_RETAINED_STREAM_PARTIAL_IMAGES)
    const discardedIds = nextIds.slice(0, Math.max(0, nextIds.length - retainedIds.length))
    updateTaskInStore(taskId, { streamPartialImageIds: retainedIds })
    if (discardedIds.length > 0) await deleteUnreferencedImageIds(discardedIds)
  } catch (err) {
    console.error(err)
  }
}

async function readAgentImageDataUrls(ids: string[]) {
  const dataUrls: string[] = []
  for (const id of ids) {
    const dataUrl = await ensureImageCached(id)
    if (dataUrl) dataUrls.push(dataUrl)
  }
  return dataUrls
}

async function createAgentUserInputItem(
  conversation: AgentConversation,
  round: AgentRound,
  message: AgentMessage,
  tasks: TaskRecord[],
) {
  const imageDataUrls = await readAgentImageDataUrls(round.inputImageIds)
  const rounds = getAgentRoundPath(conversation, round.id)
  const text = replaceAgentPromptImageReferencesForApi(message.content, round, rounds, tasks)
  const referenceText =
    round.inputImageIds.length > 0
      ? `\n\n<available_refs>${round.inputImageIds.map((_, index) => `\n  <ref id="${getAgentCurrentReferenceId(round, index)}" />`).join('')}\n</available_refs>`
      : ''
  return {
    role: 'user',
    content: [
      { type: 'input_text', text: `${text}${referenceText}` },
      ...imageDataUrls.map((dataUrl) => ({ type: 'input_image', image_url: dataUrl })),
    ],
  }
}

async function createAgentGeneratedImagesInputItem(round: AgentRound, tasks: TaskRecord[]) {
  const contentParts: Array<{ type: string; text?: string; image_url?: string }> = []
  let imageIndex = 0
  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) {
      contentParts.push({
        type: 'input_text',
        text: `<removed_ref id="${getAgentGeneratedImageReferenceId(round, imageIndex)}" />`,
      })
      imageIndex += 1
      continue
    }
    for (const imageId of task.outputImages || []) {
      const dataUrl = await ensureImageCached(imageId)
      if (dataUrl) {
        contentParts.push({ type: 'input_image', image_url: dataUrl })
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex)
      const prompt = truncateAgentReferencePrompt(task.prompt || '')
      const promptAttribute = prompt ? ` prompt="${escapeXmlAttribute(prompt)}"` : ''
      contentParts.push({ type: 'input_text', text: `<ref id="${refId}"${promptAttribute} />` })
      imageIndex += 1
    }
  }
  if (contentParts.length === 0) return null
  return { role: 'user', content: contentParts }
}

async function createAgentBatchImagesInputItem(round: AgentRound, tasks: TaskRecord[], batchTaskIds: string[]) {
  const contentParts: Array<{ type: string; text?: string; image_url?: string }> = []
  // Count existing images in the round to compute correct imageIndex offset
  let baseImageIndex = 0
  for (const taskId of round.outputTaskIds) {
    if (batchTaskIds.includes(taskId)) break
    const task = tasks.find((item) => item.id === taskId)
    baseImageIndex += task ? (task.outputImages?.length ?? 0) : 1
  }
  let imageIndex = baseImageIndex
  for (const taskId of batchTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.status !== 'done') continue
    for (const imgId of task.outputImages) {
      const dataUrl = await ensureImageCached(imgId)
      if (dataUrl) {
        contentParts.push({ type: 'input_image', image_url: dataUrl })
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex)
      const prompt = truncateAgentReferencePrompt(task.prompt || '')
      const promptAttribute = prompt ? ` prompt="${escapeXmlAttribute(prompt)}"` : ''
      contentParts.push({ type: 'input_text', text: `<ref id="${refId}"${promptAttribute} />` })
      imageIndex += 1
    }
  }
  if (contentParts.length === 0) return null
  return { role: 'user', content: contentParts }
}

function escapeXmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncateAgentReferencePrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized
}

function createAgentAssistantFallbackItem(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }
}

function parseResponseOutputFromPayload(rawResponsePayload?: string): ResponsesOutputItem[] | null {
  if (!rawResponsePayload) return null
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown }
    return Array.isArray(payload.output) ? (payload.output as ResponsesOutputItem[]) : null
  } catch {
    return null
  }
}

function sanitizeResponseOutputItemForInput(item: ResponsesOutputItem): unknown | null {
  if (item.type === 'web_search_call') return null
  if (item.type === 'image_generation_call') return null

  if (item.type === 'message') {
    const content = (item.content ?? [])
      .map((part) => {
        if (typeof part.text !== 'string') return null
        if (part.type === 'output_text' || part.type === 'text') {
          return { type: 'output_text', text: part.text }
        }
        return null
      })
      .filter((part): part is { type: 'output_text'; text: string } => Boolean(part))

    return content.length > 0 ? { role: 'assistant', content } : null
  }

  return item
}

function filterAgentRoundResponseOutputForInput(
  _round: AgentRound,
  _tasks: TaskRecord[],
  output: ResponsesOutputItem[],
) {
  // image_generation_call items are now dropped by sanitizeResponseOutputItemForInput;
  // this filter is kept as a structural pass-through for future use.
  return output
}

function scrubResponseOutputForDeletedAgentTasks(
  round: AgentRound,
  output: ResponsesOutputItem[],
  deletedTasks: TaskRecord[],
) {
  const deletedTaskIds = new Set(deletedTasks.map((task) => task.id))
  const deletedToolCallIds = new Set(
    deletedTasks
      .filter((task) => task.agentRoundId === round.id && task.agentToolCallId)
      .map((task) => task.agentToolCallId!),
  )
  if (deletedTaskIds.size === 0) return output

  let anonymousImageIndex = 0
  return output.filter((item) => {
    if (item.type !== 'image_generation_call') return true

    if (typeof item.id === 'string' && item.id) {
      return !deletedToolCallIds.has(item.id)
    }

    const taskId = round.outputTaskIds[anonymousImageIndex]
    anonymousImageIndex += 1
    return !deletedTaskIds.has(taskId)
  })
}

function scrubAgentConversationsForDeletedTasks(conversations: AgentConversation[], deletedTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return conversations

  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) => {
      const roundDeletedTasks = deletedTasks.filter((task) => round.outputTaskIds.includes(task.id))
      if (roundDeletedTasks.length === 0 || !round.responseOutput?.length) return round
      return {
        ...round,
        responseOutput: scrubResponseOutputForDeletedAgentTasks(round, round.responseOutput, roundDeletedTasks),
      }
    }),
  }))
}

function scrubTaskRawResponsePayloadForDeletedTasks(
  task: TaskRecord,
  conversations: AgentConversation[],
  deletedTasks: TaskRecord[],
) {
  if (!task.rawResponsePayload || !task.agentRoundId) return task

  const round = conversations
    .flatMap((conversation) => conversation.rounds)
    .find((item) => item.id === task.agentRoundId)
  if (!round) return task

  const roundDeletedTasks = deletedTasks.filter((item) => round.outputTaskIds.includes(item.id))
  if (roundDeletedTasks.length === 0) return task

  try {
    const payload = JSON.parse(task.rawResponsePayload) as ResponsesApiResponse
    if (!Array.isArray(payload.output)) return task
    const output = scrubResponseOutputForDeletedAgentTasks(round, payload.output, roundDeletedTasks)
    if (output.length === payload.output.length) return task
    return { ...task, rawResponsePayload: JSON.stringify({ ...payload, output }, null, 2) }
  } catch {
    return task
  }
}

async function scrubAgentOutputPayloadsForDeletedTasks(deletedTasks: TaskRecord[], remainingTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return remainingTasks

  const conversations = scrubAgentConversationsForDeletedTasks(useStore.getState().agentConversations, deletedTasks)
  const scrubbedTasks = remainingTasks.map((task) =>
    scrubTaskRawResponsePayloadForDeletedTasks(task, conversations, deletedTasks),
  )
  useStore.setState({ agentConversations: conversations })

  for (const task of scrubbedTasks) {
    const previous = remainingTasks.find((item) => item.id === task.id)
    if (previous?.rawResponsePayload !== task.rawResponsePayload) await putTask(task)
  }

  return scrubbedTasks
}

function sanitizeResponseOutputForInput(
  output: ResponsesOutputItem[],
  options: { allowPendingFunctionCalls?: boolean } = {},
) {
  const items = output.map(sanitizeResponseOutputItemForInput).filter((item): item is unknown => item != null)
  if (options.allowPendingFunctionCalls) return items

  const functionCallIds = new Set<string>()
  const functionOutputCallIds = new Set<string>()
  for (const item of items) {
    if (!isRecord(item)) continue
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (!callId) continue
    if (item.type === 'function_call') functionCallIds.add(callId)
    if (item.type === 'function_call_output') functionOutputCallIds.add(callId)
  }

  return items.filter((item) => {
    if (!isRecord(item)) return true
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (item.type === 'function_call') return callId && functionOutputCallIds.has(callId)
    if (item.type === 'function_call_output') return callId && functionCallIds.has(callId)
    return true
  })
}

function mergeResponseOutputItems(previous: ResponsesOutputItem[], next: ResponsesOutputItem[]) {
  const merged = [...previous]
  for (const item of next) {
    const index = item.id ? merged.findIndex((existing) => existing.id === item.id) : -1
    if (index >= 0) merged[index] = item
    else merged.push(item)
  }
  return merged
}

function countResponseToolCalls(output: ResponsesOutputItem[]) {
  return output.filter((item) => item.type === 'image_generation_call').length
}

function createAgentContinuationInputItem(newImageRefs: string[], toolCallsUsed: number, maxToolCalls: number) {
  const lines = ['[System] The app has saved your generated outputs and is continuing the same Agent turn.']
  if (newImageRefs.length > 0) {
    lines.push(
      `The following image ref ids are now available for you to reference in subsequent image_generation prompts: ${newImageRefs.join(', ')}`,
    )
  }
  lines.push(
    'Continue generating. Do NOT repeat what you already said in earlier responses.',
    'If you still need another round after this (e.g. more dependent images), call continue_generation.',
    `Tool-call budget: ${toolCallsUsed}/${maxToolCalls} used.`,
  )
  return {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: lines.join('\n'),
      },
    ],
  }
}

function buildAgentContinuationInput(
  baseInput: unknown[],
  round: AgentRound,
  tasks: TaskRecord[],
  currentRoundOutput: ResponsesOutputItem[],
  toolCallsUsed: number,
  maxToolCalls: number,
) {
  const input = [
    ...baseInput,
    ...sanitizeResponseOutputForInput(currentRoundOutput, { allowPendingFunctionCalls: true }),
  ]
  const newImageRefs = collectAgentRoundOutputImageSlots(round, tasks)
    .map((imageId, index) => (imageId ? `<ref id="${getAgentGeneratedImageReferenceId(round, index)}" />` : null))
    .filter((ref): ref is string => Boolean(ref))
  input.push(createAgentContinuationInputItem(newImageRefs, toolCallsUsed, maxToolCalls))
  return input
}

function getAgentRoundResponseOutput(round: AgentRound, tasks: TaskRecord[]): ResponsesOutputItem[] | null {
  if (round.responseOutput?.length) return round.responseOutput

  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    const output = parseResponseOutputFromPayload(task?.rawResponsePayload)
    if (output?.length) return output
  }

  return null
}

async function buildAgentApiInput(
  conversation: AgentConversation,
  currentRound: AgentRound,
  tasks: TaskRecord[],
): Promise<unknown[]> {
  const input: unknown[] = []
  const rounds = getAgentRoundPath(conversation, currentRound.id)

  for (const round of rounds) {
    const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
    if (!userMessage) continue

    input.push(await createAgentUserInputItem(conversation, round, userMessage, tasks))
    if (round.id === currentRound.id) continue

    const output = getAgentRoundResponseOutput(round, tasks)
    if (output?.length) {
      const sanitizedOutput = sanitizeResponseOutputForInput(
        filterAgentRoundResponseOutputForInput(round, tasks, output),
      )
      if (sanitizedOutput.length > 0) {
        input.push(...sanitizedOutput)
      } else {
        // All output items were filtered (e.g. only image_generation_call); add fallback
        const assistantMessage = round.assistantMessageId
          ? conversation.messages.find((message) => message.id === round.assistantMessageId)
          : null
        input.push(createAgentAssistantFallbackItem(assistantMessage?.content || '图像已生成。'))
      }
    } else {
      const assistantMessage = round.assistantMessageId
        ? conversation.messages.find((message) => message.id === round.assistantMessageId)
        : null
      input.push(createAgentAssistantFallbackItem(assistantMessage?.content || '[No text response]'))
    }

    // Inject generated images as a separate user message with input_image parts
    if (round.outputTaskIds.length > 0) {
      const imagesItem = await createAgentGeneratedImagesInputItem(round, tasks)
      if (imagesItem) input.push(imagesItem)
    }
  }

  return input
}

function getAgentFunctionOutputCallIds(output: ResponsesOutputItem[]) {
  return new Set(
    output.filter((item) => item.type === 'function_call_output' && item.call_id).map((item) => item.call_id!),
  )
}

function createAgentRecoveredToolOutputs(round: AgentRound, tasks: TaskRecord[]) {
  const output = round.responseOutput ?? []
  if (output.length === 0) return null

  const existingOutputCallIds = getAgentFunctionOutputCallIds(output)
  const additions: ResponsesOutputItem[] = []
  const recoveredTaskIds: string[] = []
  let hasPendingRecoverableCall = false
  let allSuccessful = true

  for (const item of output) {
    if (item.type !== 'function_call' || !item.call_id || existingOutputCallIds.has(item.call_id)) continue

    if (item.name === 'generate_image') {
      let imageId = 'image'
      try {
        const value = JSON.parse(item.arguments ?? '{}') as Record<string, unknown>
        if (typeof value.id === 'string' && value.id.trim()) imageId = value.id.trim()
      } catch {
        // Keep the stable fallback id when persisted arguments are malformed.
      }
      const task = tasks.find(
        (candidate) => candidate.agentRoundId === round.id && candidate.agentToolCallId === item.call_id,
      )
      if (!task || task.status === 'running' || task.falRecoverable || task.customRecoverable) {
        hasPendingRecoverableCall = true
        continue
      }

      recoveredTaskIds.push(task.id)
      const ok = task.status === 'done' && task.outputImages.length > 0
      if (!ok) allSuccessful = false
      additions.push({
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify({
          id: imageId,
          status: ok ? 'done' : 'error',
          ...(ok ? {} : { error: task.error || '图像生成失败' }),
        }),
      })
      continue
    }

    if (item.name === 'generate_image_batch') {
      const batchPlan = parseBatchImageCallArguments(item.arguments ?? '')
      if (!batchPlan) continue
      const batchItems = batchPlan.images

      const batchTasks = round.outputTaskIds
        .map((taskId) => tasks.find((task) => task.id === taskId))
        .filter((task): task is TaskRecord => Boolean(task && task.agentBatchCallId === item.call_id))
      if (
        batchTasks.length < batchItems.length ||
        batchTasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)
      ) {
        hasPendingRecoverableCall = true
        continue
      }

      recoveredTaskIds.push(...batchTasks.map((task) => task.id))
      const images = batchItems.map((batchItem, index) => {
        const task = batchTasks[index]
        const ok = task?.status === 'done' && task.outputImages.length > 0
        if (!ok) allSuccessful = false
        return {
          id: batchItem.id,
          status: ok ? 'done' : 'error',
          ...(ok ? {} : { error: task?.error || '图像生成失败' }),
        }
      })
      additions.push({
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify({ images }),
      })
    }
  }

  if (hasPendingRecoverableCall || additions.length === 0) return null
  return { additions, recoveredTaskIds, allSuccessful }
}

function createReadyAgentRecoveredToolState(round: AgentRound, tasks: TaskRecord[]) {
  const recovered = createAgentRecoveredToolOutputs(round, tasks)
  if (recovered) return recovered
  if (!round.responseOutput?.length || round.outputTaskIds.length === 0) return null

  const outputCallIds = getAgentFunctionOutputCallIds(round.responseOutput)
  const pendingFunctionCall = round.responseOutput.some(
    (item) =>
      item.type === 'function_call' &&
      (item.name === 'generate_image' || item.name === 'generate_image_batch') &&
      item.call_id &&
      !outputCallIds.has(item.call_id),
  )
  if (pendingFunctionCall) return null

  const roundTasks = round.outputTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TaskRecord => Boolean(task))
  if (
    roundTasks.length === 0 ||
    roundTasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)
  )
    return null

  return {
    additions: [] as ResponsesOutputItem[],
    recoveredTaskIds: roundTasks.map((task) => task.id),
    allSuccessful: roundTasks.every((task) => task.status === 'done' && task.outputImages.length > 0),
  }
}

function appendAgentRecoveredToolOutputs(conversationId: string, roundId: string, additions: ResponsesOutputItem[]) {
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    rounds: current.rounds.map((round) => {
      if (round.id !== roundId) return round
      const output = round.responseOutput ?? []
      const existingOutputCallIds = getAgentFunctionOutputCallIds(output)
      const nextAdditions = additions.filter((item) => item.call_id && !existingOutputCallIds.has(item.call_id))
      return nextAdditions.length > 0 ? { ...round, responseOutput: [...output, ...nextAdditions] } : round
    }),
  }))
}

function getAgentRecoveredToolCallCount(output: ResponsesOutputItem[], tasks: TaskRecord[]) {
  const functionCallCount = output
    .filter((item) => item.type === 'function_call_output')
    .reduce((count, item) => {
      if (!item.output) return count
      try {
        const payload = JSON.parse(item.output) as { images?: unknown[]; status?: string }
        if (Array.isArray(payload.images)) {
          return count + payload.images.filter((image) => isRecord(image) && image.status === 'done').length
        }
        return payload.status === 'done' ? count + 1 : count
      } catch {
        return count
      }
    }, 0)
  return Math.max(
    functionCallCount + countResponseToolCalls(output),
    tasks.filter((task) => task.status === 'done').length,
  )
}

function getAgentRecoveredFailureError(round: AgentRound, tasks: TaskRecord[]) {
  const failedTasks = round.outputTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TaskRecord =>
      Boolean(task && task.status === 'error' && !task.falRecoverable && !task.customRecoverable),
    )
  if (failedTasks.length === 0) return '图像生成失败'
  if (failedTasks.length === 1) return failedTasks[0].error || '图像生成失败'
  return '部分图像生成任务失败。'
}

/** 失败 toast 用：截断长错误（取首行、限长）。 */
function shortenTaskErrorMessage(message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? ''
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine || '未知错误'
}

async function continueRecoveredAgentRound(taskId: string) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task?.agentConversationId || !task.agentRoundId) return

  const key = getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId)
  if (agentRoundControllers.has(key) || agentRecoveryContinuations.has(key)) return

  agentRecoveryContinuations.add(key)
  try {
    const latestState = useStore.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === task.agentConversationId)
    const round = conversation?.rounds.find((item) => item.id === task.agentRoundId)
    if (!conversation || !round || round.status === 'done' || round.error === AGENT_STOPPED_MESSAGE) return

    const failRound = (error: string) =>
      updateAgentConversation(conversation.id, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((currentRound) =>
          currentRound.id === round.id
            ? { ...currentRound, status: 'error', error, finishedAt: Date.now() }
            : currentRound,
        ),
      }))

    const recovered = createReadyAgentRecoveredToolState(round, latestState.tasks)
    if (!recovered) return
    appendAgentRecoveredToolOutputs(conversation.id, round.id, recovered.additions)

    const updatedState = useStore.getState()
    const updatedConversation = updatedState.agentConversations.find((item) => item.id === conversation.id)
    const updatedRound = updatedConversation?.rounds.find((item) => item.id === round.id)
    if (!updatedConversation || !updatedRound) return
    if (!recovered.allSuccessful) {
      failRound(getAgentRecoveredFailureError(updatedRound, updatedState.tasks))
      return
    }

    const normalizedSettings = normalizeSettings(updatedState.settings)
    const validationError = getAgentProfileValidationError(normalizedSettings)
    if (validationError) {
      failRound(`无法继续恢复任务：${validationError.message}`)
      return
    }
    const activeProfile = getAgentTextApiProfile(normalizedSettings)
    const imageProfile = getAgentImageApiProfile(normalizedSettings)
    if (!activeProfile || !imageProfile) {
      failRound('Agent API 配置不存在，无法继续恢复任务。')
      return
    }

    const roundTasks = updatedState.tasks.filter((item) => item.agentRoundId === round.id)
    const resumeParams =
      roundTasks.find((item) => item.params)?.params ??
      normalizeParamsForSettings(updatedState.params, createSettingsForApiProfile(normalizedSettings, imageProfile), {
        hasInputImages: round.inputImageIds.length > 0,
      })
    const toolCallsUsed = getAgentRecoveredToolCallCount(updatedRound.responseOutput ?? [], roundTasks)

    updateAgentConversation(conversation.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((currentRound) =>
        currentRound.id === round.id
          ? { ...currentRound, status: 'running', error: null, finishedAt: null }
          : currentRound,
      ),
    }))

    void executeAgentRound(
      conversation.id,
      round.id,
      resumeParams,
      createSettingsForApiProfile(normalizedSettings, activeProfile),
      activeProfile,
      imageProfile,
      {
        responseOutput: updatedRound.responseOutput ?? [],
        recoveredTaskIds: recovered.recoveredTaskIds,
        toolCallsUsed,
      },
    )
  } finally {
    agentRecoveryContinuations.delete(key)
  }
}

export async function submitAgentMessage() {
  const state = useStore.getState()
  const { settings, prompt, inputImages, maskDraft, params, showToast } = state
  const normalizedSettings = normalizeSettings(settings)
  const agentValidationError = getAgentProfileValidationError(normalizedSettings)
  if (agentValidationError) {
    showToast(`请先完善 Agent API 配置：${agentValidationError.message}`, 'error')
    state.setShowSettings(true, 'agent')
    return
  }
  const activeProfile = getAgentTextApiProfile(normalizedSettings)
  const imageProfile = getAgentImageApiProfile(normalizedSettings)

  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) {
    showToast('请输入消息', 'error')
    return
  }

  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        state.clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  const inputImageIds = uniqueIds(orderedInputImages.map((image) => image.id))

  for (const image of orderedInputImages) {
    await storeImage(image.dataUrl)
  }

  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const imageRequestSettings = createSettingsForApiProfile(normalizedSettings, imageProfile)
  const now = Date.now()
  const editingRound = state.agentEditingRoundId
    ? (conversation.rounds.find((item) => item.id === state.agentEditingRoundId) ?? null)
    : null
  const editingRoundAssistantMessage = editingRound?.assistantMessageId
    ? (conversation.messages.find((message) => message.id === editingRound.assistantMessageId) ?? null)
    : (conversation.messages.find((message) => message.roundId === editingRound?.id && message.role === 'assistant') ??
      null)
  const editingRoundHasAssistantMessage = Boolean(editingRoundAssistantMessage)
  const editingRoundHasErrorAssistantMessage = Boolean(
    editingRound?.status === 'error' && editingRoundAssistantMessage?.content.startsWith('请求失败：'),
  )
  const editingRoundHasChildren = editingRound
    ? conversation.rounds.some((round) => (round.parentRoundId ?? null) === editingRound.id)
    : false
  const shouldAppendToEditingRound = Boolean(
    editingRound &&
    !editingRoundHasChildren &&
    (!editingRoundHasAssistantMessage || editingRoundHasErrorAssistantMessage),
  )
  const roundId = shouldAppendToEditingRound && editingRound ? editingRound.id : genId()
  const userMessageId = shouldAppendToEditingRound && editingRound ? editingRound.userMessageId : genId()
  const activeRounds = getActiveAgentRounds(conversation)
  const activeLeafId = activeRounds[activeRounds.length - 1]?.id ?? null
  const parentRoundId = editingRound ? (editingRound.parentRoundId ?? null) : activeLeafId
  const parentPath = parentRoundId ? getAgentRoundPath(conversation, parentRoundId) : []
  const normalizedParams = {
    ...normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const round: AgentRound = {
    id: roundId,
    index: shouldAppendToEditingRound && editingRound ? editingRound.index : parentPath.length + 1,
    parentRoundId,
    ...(editingRoundHasErrorAssistantMessage && editingRoundAssistantMessage
      ? { assistantMessageId: editingRoundAssistantMessage.id }
      : {}),
    userMessageId,
    prompt: trimmedPrompt,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const userMessage: AgentMessage = {
    id: userMessageId,
    role: 'user',
    content: trimmedPrompt,
    roundId,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    createdAt: now,
  }

  let fallbackTitle: string | null = null
  let submitBlockedByRunningRound = false
  updateAgentConversation(conversation.id, (current) => {
    // 二次校验：updateAgentConversation 的 updater 同步执行，能关闭"守卫在 await 之前"
    // 的双击间隙——第二个提交的 updater 会看到第一个提交已插入的 running 轮次。
    if (current.rounds.some((item) => item.status === 'running')) {
      submitBlockedByRunningRound = true
      return current
    }
    const nextTitle =
      current.rounds.length === 0 ? createAgentConversationTitle(trimmedPrompt, current.title) : current.title
    if (current.rounds.length === 0) fallbackTitle = nextTitle
    const messages = shouldAppendToEditingRound
      ? current.messages.some((message) => message.id === userMessageId)
        ? current.messages.map((message) => {
            if (message.id === userMessageId) return userMessage
            if (editingRoundHasErrorAssistantMessage && message.id === editingRoundAssistantMessage?.id) {
              return { ...message, content: '', outputTaskIds: [] }
            }
            return message
          })
        : [...current.messages, userMessage]
      : [...current.messages, userMessage]

    return {
      ...current,
      title: nextTitle,
      activeRoundId: roundId,
      updatedAt: now,
      rounds: shouldAppendToEditingRound
        ? current.rounds.map((item) => (item.id === roundId ? round : item))
        : [...current.rounds, round],
      messages,
    }
  })

  if (submitBlockedByRunningRound) {
    showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  state.setPrompt('')
  state.clearInputImages()
  state.clearMaskDraft()
  state.setAgentEditingRoundId(null)

  if (fallbackTitle) {
    void generateAgentConversationTitle(
      conversation.id,
      trimmedPrompt,
      inputImageIds,
      requestSettings,
      activeProfile,
      fallbackTitle,
    )
  }

  void executeAgentRound(conversation.id, roundId, normalizedParams, requestSettings, activeProfile, imageProfile)
}

export async function regenerateAgentAssistantMessage(conversationId: string, roundId: string) {
  const state = useStore.getState()
  const { settings, params, showToast } = state
  const normalizedSettings = normalizeSettings(settings)
  const agentValidationError = getAgentProfileValidationError(normalizedSettings)
  if (agentValidationError) {
    showToast(`请先完善 Agent API 配置：${agentValidationError.message}`, 'error')
    state.setShowSettings(true, 'agent')
    return
  }
  const activeProfile = getAgentTextApiProfile(normalizedSettings)
  const imageProfile = getAgentImageApiProfile(normalizedSettings)

  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const sourceRound = conversation?.rounds.find((item) => item.id === roundId) ?? null
  const sourceUserMessage = sourceRound
    ? (conversation?.messages.find((message) => message.id === sourceRound.userMessageId) ?? null)
    : null
  if (!conversation || !sourceRound || !sourceUserMessage) {
    showToast('找不到要重新生成的 Agent 消息', 'error')
    return
  }

  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  const inputImageIds = uniqueIds(sourceRound.inputImageIds)
  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const imageRequestSettings = createSettingsForApiProfile(normalizedSettings, imageProfile)
  const normalizedParams = {
    ...normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const now = Date.now()
  if (sourceRound.status === 'error') {
    const assistantMessageId =
      sourceRound.assistantMessageId ??
      conversation.messages.find((message) => message.roundId === sourceRound.id && message.role === 'assistant')?.id
    updateAgentConversation(conversationId, (current) => ({
      ...current,
      activeRoundId: sourceRound.id,
      updatedAt: now,
      rounds: current.rounds.map((round) =>
        round.id === sourceRound.id
          ? {
              ...round,
              outputTaskIds: [],
              responseId: undefined,
              responseOutput: undefined,
              status: 'running',
              error: null,
              finishedAt: null,
            }
          : round,
      ),
      messages: assistantMessageId
        ? current.messages.map((message) =>
            message.id === assistantMessageId ? { ...message, content: '', outputTaskIds: [] } : message,
          )
        : current.messages,
    }))
    state.setAgentEditingRoundId(null)
    void executeAgentRound(
      conversationId,
      sourceRound.id,
      normalizedParams,
      requestSettings,
      activeProfile,
      imageProfile,
    )
    return
  }

  const newRoundId = genId()
  const newUserMessageId = genId()
  const newRound: AgentRound = {
    id: newRoundId,
    index: sourceRound.index,
    parentRoundId: sourceRound.parentRoundId ?? null,
    userMessageId: newUserMessageId,
    prompt: sourceRound.prompt || sourceUserMessage.content.trim(),
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const newUserMessage: AgentMessage = {
    id: newUserMessageId,
    role: 'user',
    content: sourceUserMessage.content,
    roundId: newRoundId,
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    createdAt: now,
  }

  updateAgentConversation(conversationId, (current) => ({
    ...current,
    activeRoundId: newRoundId,
    updatedAt: now,
    rounds: [...current.rounds, newRound],
    messages: [...current.messages, newUserMessage],
  }))
  state.setAgentEditingRoundId(null)
  void executeAgentRound(conversationId, newRoundId, normalizedParams, requestSettings, activeProfile, imageProfile)
}

async function executeAgentRound(
  conversationId: string,
  roundId: string,
  params: TaskParams,
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  imageProfile: ApiProfile,
  resume?: { responseOutput: ResponsesOutputItem[]; recoveredTaskIds: string[]; toolCallsUsed: number },
) {
  const startedAt = Date.now()
  const imageRequestSettings = createSettingsForApiProfile(requestSettings, imageProfile)
  const controller = new AbortController()
  const controllerKey = getAgentRoundControllerKey(conversationId, roundId)
  agentRoundControllers.set(controllerKey, controller)
  try {
    const latestState = useStore.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === conversationId)
    if (!conversation) return
    const round = conversation.rounds.find((item) => item.id === roundId)
    const userMessage = round ? conversation.messages.find((message) => message.id === round.userMessageId) : null
    if (!round || !userMessage) return
    void scheduleAgentRoundSummaryToLocalFS(conversationId, roundId)
    const maskDataUrl = round.maskImageId ? await ensureImageCached(round.maskImageId) : undefined
    if (round.maskImageId && !maskDataUrl) throw new Error('遮罩图片已不存在')

    const apiInput = await buildAgentApiInput(conversation, round, latestState.tasks)
    if (controller.signal.aborted) throw createAgentAbortError()
    const existingAssistantMessage = round.assistantMessageId
      ? (conversation.messages.find((message) => message.id === round.assistantMessageId) ?? null)
      : (conversation.messages.find((message) => message.roundId === roundId && message.role === 'assistant') ?? null)
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    const resumedAssistantContent = resume ? (existingAssistantMessage?.content.trim() ?? '') : ''
    const shouldStreamAssistantMessage = activeProfile.streamImages === true
    const streamingTaskIds: string[] = resume ? [...round.outputTaskIds] : []
    const runCreatedTaskIds = new Set<string>()
    const taskIdByToolCallId = new Map<string, string>()

    const attachTaskToAgentRound = (taskId: string) => {
      if (streamingTaskIds.includes(taskId)) return
      streamingTaskIds.push(taskId)
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? {
                ...item,
                outputTaskIds: item.outputTaskIds.includes(taskId)
                  ? item.outputTaskIds
                  : [...item.outputTaskIds, taskId],
              }
            : item,
        ),
        messages: current.messages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), taskId])] }
            : message,
        ),
      }))
    }

    const ensureStreamingAgentTask = async (
      toolCallId: string,
      taskPrompt = '',
      inputImageIds = round.inputImageIds ?? [],
      options: {
        createdAt?: number
        agentBatchCallId?: string
        maskTargetImageId?: string | null
        maskImageId?: string | null
        taskParams?: TaskParams
      } = {},
    ) => {
      const existingTaskId = taskIdByToolCallId.get(toolCallId)
      if (existingTaskId) return existingTaskId

      const existingTask = useStore.getState().tasks.find((task) => task.agentToolCallId === toolCallId)
      if (existingTask) {
        taskIdByToolCallId.set(toolCallId, existingTask.id)
        attachTaskToAgentRound(existingTask.id)
        return existingTask.id
      }

      const createdAt = options.createdAt ?? Date.now()
      const filenameBatch = getNextTaskFilenameBatch(createdAt, null, 'image')
      const task: TaskRecord = {
        id: genId(),
        prompt: taskPrompt,
        params: options.taskParams ?? { ...params, n: 1 },
        adNegativeRuleSnapshot: createAdNegativeRuleSnapshot(requestSettings, params.adNegativeRuleId),
        apiProvider: imageProfile.provider,
        apiProfileId: imageProfile.id,
        apiProfileName: imageProfile.name,
        apiMode: imageProfile.apiMode,
        apiModel: imageProfile.model,
        inputImageIds,
        maskTargetImageId:
          options.maskTargetImageId !== undefined ? options.maskTargetImageId : (round.maskTargetImageId ?? null),
        maskImageId: options.maskImageId !== undefined ? options.maskImageId : (round.maskImageId ?? null),
        outputImages: [],
        filenameBatch,
        status: 'running',
        error: null,
        createdAt,
        finishedAt: null,
        elapsed: null,
        sourceMode: 'agent',
        localSaveBatchFolder: getTaskLocalSaveBatchFolder(createdAt, filenameBatch),
        agentConversationId: conversationId,
        agentRoundId: roundId,
        agentMessageId: assistantMessageId,
        agentToolCallId: toolCallId,
        ...(options.agentBatchCallId ? { agentBatchCallId: options.agentBatchCallId } : {}),
      }

      taskIdByToolCallId.set(toolCallId, task.id)
      runCreatedTaskIds.add(task.id)
      useStore.getState().setTasks([task, ...useStore.getState().tasks])
      attachTaskToAgentRound(task.id)
      await putTask(task)
      void scheduleAgentRoundSummaryToLocalFS(conversationId, roundId)
      return task.id
    }

    const completeAgentImageTask = async (image: AgentApiResultImage, rawResponsePayload?: string) => {
      const toolCallId = image.toolCallId ?? genId()
      const taskId = await ensureStreamingAgentTask(toolCallId)
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (latestTask?.status === 'done' && (latestTask.outputImages?.length ?? 0) > 0) return taskId

      const stored = await processAndStoreGeneratedImage(image.dataUrl, params, image.actualParams)
      const imgId = stored.id
      const actualParams: Partial<TaskParams> = {
        ...(Object.keys(stored.actualParams ?? {}).length ? stored.actualParams : {}),
        n: 1,
      }
      updateTaskInStore(
        taskId,
        {
          prompt: image.revisedPrompt ?? latestTask?.prompt ?? '',
          outputImages: [imgId],
          actualParams,
          actualParamsByImage: { [imgId]: actualParams },
          revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
          rawResponsePayload,
          status: 'done',
          error: null,
          finishedAt: Date.now(),
          elapsed: Date.now() - (latestTask?.createdAt ?? startedAt),
          agentToolAction: image.action,
        },
        (current) => current.status === 'running',
      )
      useRuntimeStore.getState().setTaskStreamPreview(taskId)
      void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
      return taskId
    }

    const failAgentImageTask = (toolCallId: string, error: string, rawResponsePayload?: string) => {
      const taskId = taskIdByToolCallId.get(toolCallId)
      if (!taskId) return
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestTask || latestTask.status !== 'running') return

      useRuntimeStore.getState().setTaskStreamPreview(taskId)
      updateTaskInStore(taskId, {
        status: 'error',
        error,
        rawResponsePayload,
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - latestTask.createdAt,
      })
      void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
    }

    const pauseAgentImageTaskForRecovery = (toolCallId: string, error: unknown) => {
      const taskId = taskIdByToolCallId.get(toolCallId)
      if (!taskId || !isFalConnectionRecoverableError(error)) return false
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestTask || latestTask.status !== 'running') return false

      if (latestTask.apiProvider === 'fal' && latestTask.falRequestId && latestTask.falEndpoint) {
        useRuntimeStore.getState().setTaskStreamPreview(taskId)
        updateTaskInStore(taskId, {
          status: 'error',
          error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
          falRecoverable: true,
          finishedAt: Date.now(),
          elapsed: Date.now() - latestTask.createdAt,
        })
        scheduleFalRecovery(taskId)
        return true
      }

      if (latestTask.customTaskId) {
        useRuntimeStore.getState().setTaskStreamPreview(taskId)
        updateTaskInStore(taskId, {
          status: 'error',
          error: '与自定义异步任务的连接已断开，之后会继续查询任务结果。',
          customRecoverable: true,
          finishedAt: Date.now(),
          elapsed: Date.now() - latestTask.createdAt,
        })
        scheduleCustomRecovery(taskId)
        return true
      }

      return false
    }

    if (shouldStreamAssistantMessage) {
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) => (item.id === roundId ? { ...item, assistantMessageId } : item)),
        messages: current.messages.some((message) => message.id === assistantMessageId)
          ? current.messages.map((message) =>
              message.id === assistantMessageId
                ? resume
                  ? {
                      ...message,
                      outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), ...round.outputTaskIds])],
                    }
                  : { ...message, content: '', outputTaskIds: [] }
                : message,
            )
          : [
              ...current.messages,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                roundId,
                createdAt: Date.now(),
              },
            ],
      }))
    }
    const maxToolCalls = Number.isFinite(requestSettings.agentMaxToolRounds)
      ? Math.max(1, Math.trunc(requestSettings.agentMaxToolRounds))
      : DEFAULT_AGENT_MAX_TOOL_ROUNDS
    let accumulatedOutputItems: ResponsesOutputItem[] = resume?.responseOutput ?? []
    let accumulatedText = resumedAssistantContent
    const textSegments: string[] = resumedAssistantContent ? [resumedAssistantContent] : []
    let lastResponseId: string | undefined = round.responseId
    let toolCallsUsed = resume?.toolCallsUsed ?? 0
    let apiInputForTurn = apiInput
    if (resume) {
      apiInputForTurn = buildAgentContinuationInput(
        apiInput,
        round,
        useStore.getState().tasks,
        accumulatedOutputItems,
        toolCallsUsed,
        maxToolCalls,
      )
      const recoveredImagesItem = await createAgentBatchImagesInputItem(
        round,
        useStore.getState().tasks,
        resume.recoveredTaskIds,
      )
      if (recoveredImagesItem) apiInputForTurn.splice(apiInputForTurn.length - 1, 0, recoveredImagesItem)
    }
    let reachedToolLimit = resume ? toolCallsUsed >= maxToolCalls : false
    let pendingToolTextSeparator = false

    // Helper: resolve reference image ids to data URLs for batch image calls
    const resolveReferenceImages = async (
      referenceIds: string[],
    ): Promise<{ dataUrls: string[]; imageIds: string[] }> => {
      const dataUrls: string[] = []
      const imageIds: string[] = []
      for (const refId of referenceIds) {
        // Resolve both generated image refs and current/user input refs from XML tags.
        const latestConv = useStore.getState().agentConversations.find((item) => item.id === conversationId)
        if (!latestConv) continue
        for (const r of getAgentRoundPath(latestConv, roundId)) {
          for (let imgIdx = 0; imgIdx < r.inputImageIds.length; imgIdx++) {
            const currentRefId = getAgentCurrentReferenceId(r, imgIdx)
            if (currentRefId === refId) {
              const imageId = r.inputImageIds[imgIdx]
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
          const outputImages = collectAgentRoundOutputImageSlots(r, useStore.getState().tasks)
          for (let imgIdx = 0; imgIdx < outputImages.length; imgIdx++) {
            const generatedRefId = getAgentGeneratedImageReferenceId(r, imgIdx)
            if (generatedRefId === refId) {
              const imageId = outputImages[imgIdx]
              if (!imageId) continue
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
        }
      }
      return { dataUrls, imageIds }
    }

    const parseSingleImageCallArguments = (args: string): { id: string; prompt: string } | null => {
      try {
        const parsed = JSON.parse(args) as Record<string, unknown>
        const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
        if (!prompt) return null
        const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : 'image'
        return { id, prompt }
      } catch {
        return null
      }
    }

    const callHybridImageApiSingle = async (opts: {
      taskId: string
      prompt: string
      referenceImageDataUrls: string[]
      taskParams: TaskParams
      signal: AbortSignal
      onPartialImage?: (event: { image: string; partialImageIndex?: number }) => void
    }) => {
      let requestProgressed = false
      const result = await retryTransientRequest(
        () =>
          callImageApi({
            settings: imageRequestSettings,
            prompt: replaceImageMentionsForApi(opts.prompt, opts.referenceImageDataUrls.length),
            params: opts.taskParams,
            inputImageDataUrls: opts.referenceImageDataUrls,
            onPartialImage: opts.onPartialImage
              ? (partial) => {
                  requestProgressed = true
                  opts.onPartialImage?.({
                    image: partial.image,
                    partialImageIndex: partial.partialImageIndex ?? partial.requestIndex,
                  })
                }
              : undefined,
            onFalRequestEnqueued: (request) => {
              requestProgressed = true
              return updateTaskInStore(opts.taskId, {
                falRequestId: request.requestId,
                falEndpoint: request.endpoint,
                falRecoverable: false,
              })
            },
            onCustomTaskEnqueued: (request) => {
              requestProgressed = true
              return updateTaskInStore(opts.taskId, {
                customTaskId: request.taskId,
                customRecoverable: false,
              })
            },
          }),
        {
          maxRetries: normalizeMaxRetries(imageProfile.maxRetries),
          signal: opts.signal,
          shouldRetry: (error) => !requestProgressed && isRetryableError(error),
        },
      )
      if (opts.signal.aborted) throw createAgentAbortError()
      const dataUrl = result.images[0]
      return {
        image: dataUrl
          ? ({
              dataUrl,
              actualParams: result.actualParamsList?.[0] ?? result.actualParams,
              revisedPrompt: result.revisedPrompts?.[0] ?? opts.prompt,
            } satisfies AgentApiResultImage)
          : null,
        error: dataUrl ? null : '接口未返回图片数据',
        rawResponsePayload: JSON.stringify(
          {
            imageCount: result.images.length,
            actualParams: result.actualParams,
            actualParamsList: result.actualParamsList,
            revisedPrompts: result.revisedPrompts,
            rawImageUrls: result.rawImageUrls,
          },
          null,
          2,
        ),
      }
    }

    const executeSingleImageFunctionCall = async (functionCallItem: ResponsesOutputItem): Promise<string> => {
      const item = parseSingleImageCallArguments(functionCallItem.arguments ?? '')
      if (!item) return JSON.stringify({ error: 'Invalid or empty image arguments' })
      const referenceIds = uniqueIds(extractAgentReferenceIds(item.prompt))
      const references = await resolveReferenceImages(referenceIds)
      const toolCallId = functionCallItem.call_id || genId()
      const taskParams = {
        ...normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: references.dataUrls.length > 0 }),
        n: 1,
      }
      const taskId = await ensureStreamingAgentTask(toolCallId, item.prompt, references.imageIds, {
        createdAt: Date.now(),
        taskParams,
        maskTargetImageId: null,
        maskImageId: null,
      })

      try {
        const result = await callHybridImageApiSingle({
          taskId,
          prompt: appendAdNegativeRule(
            item.prompt,
            getAdNegativeRule(requestSettings, params.adNegativeRuleId).content,
          ),
          referenceImageDataUrls: references.dataUrls,
          taskParams,
          signal: controller.signal,
          onPartialImage: ({ image, partialImageIndex }) => {
            const taskId = taskIdByToolCallId.get(toolCallId)
            if (taskId) useRuntimeStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
          },
        })
        if (controller.signal.aborted) throw createAgentAbortError()
        if (result.image) {
          await completeAgentImageTask({ ...result.image, toolCallId }, result.rawResponsePayload)
          toolCallsUsed += 1
          return JSON.stringify({ id: item.id, status: 'done' })
        }
        failAgentImageTask(toolCallId, result.error ?? '图像生成失败', result.rawResponsePayload)
        return JSON.stringify({ id: item.id, status: 'error', error: result.error })
      } catch (error) {
        if (controller.signal.aborted) throw createAgentAbortError()
        if (pauseAgentImageTaskForRecovery(toolCallId, error)) throw createAgentRecoveryPauseError()
        const message = error instanceof Error ? error.message : String(error)
        failAgentImageTask(toolCallId, message)
        return JSON.stringify({ id: item.id, status: 'error', error: message })
      }
    }

    // Helper: execute a generate_image_batch function call concurrently
    const executeBatchFunctionCall = async (
      functionCallItem: ResponsesOutputItem,
    ): Promise<{
      output: string
      finalizeAfterBatch: boolean
      totalCount: number
      successCount: number
      failureCount: number
    }> => {
      const callId = functionCallItem.call_id ?? ''
      const args = functionCallItem.arguments ?? ''
      const batchPlan = parseBatchImageCallArguments(args)

      if (!batchPlan) {
        return {
          output: JSON.stringify({
            error:
              'Invalid batch arguments: requested_count must match a non-empty images array with unique ids and prompts',
          }),
          finalizeAfterBatch: false,
          totalCount: 0,
          successCount: 0,
          failureCount: 0,
        }
      }
      const batchItems = batchPlan.images.map((item) => ({
        ...item,
        prompt: [batchPlan.sharedPrompt, item.prompt].filter(Boolean).join('\n\n'),
      }))

      // Create task cards in model-provided order before starting network calls.
      const batchExecutionItems = []
      for (const item of batchItems) {
        const referenceIds = uniqueIds(extractAgentReferenceIds(item.prompt))
        const references = await resolveReferenceImages(referenceIds)
        const batchToolCallId = genId()
        const taskParams =
          requestSettings.agentApiConfigMode === 'hybrid'
            ? {
                ...normalizeParamsForSettings(params, imageRequestSettings, {
                  hasInputImages: references.dataUrls.length > 0,
                }),
                n: 1,
              }
            : { ...params, n: 1 }
        await ensureStreamingAgentTask(batchToolCallId, item.prompt, references.imageIds, {
          createdAt: Date.now(),
          taskParams,
          maskTargetImageId: null,
          maskImageId: null,
          ...(callId ? { agentBatchCallId: callId } : {}),
        })
        batchExecutionItems.push({ item, batchToolCallId, references, referenceIds, taskParams })
      }

      // Fire all batch items concurrently after all cards are visible.
      const batchResults = await runWithConcurrencyAndRetry(
        batchExecutionItems,
        imageProfile.maxConcurrent ?? 1,
        requestSettings.agentApiConfigMode === 'hybrid' ? 0 : (imageProfile.maxRetries ?? 0),
        async ({ item, batchToolCallId, references, referenceIds, taskParams }) => {
          const prompt = appendAdNegativeRule(
            item.prompt,
            getAdNegativeRule(requestSettings, params.adNegativeRuleId).content,
          )
          const batchResult =
            requestSettings.agentApiConfigMode === 'hybrid'
              ? {
                  batchItemId: item.id,
                  ...(await callHybridImageApiSingle({
                    taskId: taskIdByToolCallId.get(batchToolCallId)!,
                    prompt,
                    referenceImageDataUrls: references.dataUrls,
                    taskParams,
                    signal: controller.signal,
                    onPartialImage: ({ image, partialImageIndex }) => {
                      const taskId = taskIdByToolCallId.get(batchToolCallId)
                      if (taskId) useRuntimeStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
                    },
                  })),
                }
              : await callBatchImageSingle({
                  profile: imageProfile,
                  params: taskParams,
                  batchItemId: item.id,
                  prompt,
                  referenceImageDataUrls: references.dataUrls,
                  referenceIds,
                  allowPromptRewrite: requestSettings.allowPromptRewrite,
                  signal: controller.signal,
                  onImageToolStarted: shouldStreamAssistantMessage
                    ? async () => {
                        if (controller.signal.aborted) return
                      }
                    : undefined,
                  onPartialImage: shouldStreamAssistantMessage
                    ? async ({ image, partialImageIndex }) => {
                        if (controller.signal.aborted) return
                        const taskId = taskIdByToolCallId.get(batchToolCallId)
                        if (taskId) {
                          useRuntimeStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
                          if (partialImageIndex === 0 || partialImageIndex == null) {
                            void persistTaskStreamPartialImage(taskId, image)
                          }
                        }
                      }
                    : undefined,
                  onImageToolCompleted: shouldStreamAssistantMessage
                    ? async (image) => {
                        if (controller.signal.aborted) return
                        await completeAgentImageTask({ ...image, toolCallId: batchToolCallId })
                      }
                    : undefined,
                })

          if (batchResult.error) {
            throw new Error(batchResult.error)
          }

          if (batchResult.image) {
            await completeAgentImageTask(
              { ...batchResult.image, toolCallId: batchToolCallId },
              batchResult.rawResponsePayload,
            )
          }

          return batchResult
        },
      )

      let pausedForRecovery = false
      for (let i = 0; i < batchResults.length; i++) {
        const settled = batchResults[i]
        const { batchToolCallId } = batchExecutionItems[i]
        const taskId = taskIdByToolCallId.get(batchToolCallId)
        if (!taskId) continue

        if (
          settled.status === 'rejected' &&
          (isAgentRecoveryPauseError(settled.reason) || pauseAgentImageTaskForRecovery(batchToolCallId, settled.reason))
        ) {
          pausedForRecovery = true
          continue
        }

        let errorMsg: string | undefined
        let rawPayload: string | undefined

        if (settled.status === 'fulfilled') {
          const r = settled.value
          if (!r.image && r.error) {
            errorMsg = r.error
            rawPayload = r.rawResponsePayload
          }
        } else {
          errorMsg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
        }

        if (errorMsg) {
          const latestTask = useStore.getState().tasks.find((t) => t.id === taskId)
          if (latestTask && latestTask.status === 'running') {
            updateTaskInStore(taskId, {
              status: 'error',
              error: errorMsg,
              rawResponsePayload: rawPayload,
              finishedAt: Date.now(),
              elapsed: Date.now() - (latestTask.createdAt ?? startedAt),
            })
            useRuntimeStore.getState().setTaskStreamPreview(taskId)
            void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
          }
        }
      }

      if (pausedForRecovery) throw createAgentRecoveryPauseError()

      // Build function_call_output
      const outputImages: Array<{ id: string; status: string; error?: string }> = []
      for (let i = 0; i < batchItems.length; i++) {
        const settled = batchResults[i]
        const batchItem = batchItems[i]
        if (settled.status === 'fulfilled') {
          const r = settled.value
          outputImages.push({
            id: r.batchItemId,
            status: r.image ? 'done' : 'error',
            ...(r.error ? { error: r.error } : {}),
          })
        } else {
          outputImages.push({
            id: batchItem.id,
            status: 'error',
            error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
          })
        }
      }

      const successCount = outputImages.filter((img) => img.status === 'done').length
      toolCallsUsed += successCount

      return {
        output: JSON.stringify({ images: outputImages }),
        finalizeAfterBatch: batchPlan.finalizeAfterBatch,
        totalCount: outputImages.length,
        successCount,
        failureCount: outputImages.length - successCount,
      }
    }

    while (true) {
      if (controller.signal.aborted) throw createAgentAbortError()
      const textBeforeResponse = accumulatedText
      let currentResponseOutputItems: ResponsesOutputItem[] = []
      let agentAttemptProgressed = false
      const result = await retryTransientRequest(
        () => {
          agentAttemptProgressed = false
          const callAgent =
            requestSettings.agentTextProtocol === 'chat-completions'
              ? callAgentChatCompletionsApi
              : callAgentResponsesApi
          return callAgent({
            settings: requestSettings,
            profile: activeProfile,
            params,
            input: apiInputForTurn,
            maskDataUrl,
            signal: controller.signal,
            onTextDelta: shouldStreamAssistantMessage
              ? (delta) => {
                  if (controller.signal.aborted) return
                  agentAttemptProgressed = true
                  if (pendingToolTextSeparator && delta && accumulatedText.trim()) {
                    accumulatedText += '\n\n'
                    appendAgentAssistantMessageContent(conversationId, assistantMessageId, '\n\n')
                  }
                  pendingToolTextSeparator = false
                  accumulatedText += delta
                  appendAgentAssistantMessageContent(conversationId, assistantMessageId, delta)
                }
              : undefined,
            onOutputItems: shouldStreamAssistantMessage
              ? (outputItems) => {
                  if (controller.signal.aborted) return
                  agentAttemptProgressed = true
                  currentResponseOutputItems = outputItems
                  // Debounce output items updates to avoid excessive store updates
                  const existingTimer = agentTextFlushTimers.get(
                    getAgentTextFlushKey(conversationId, roundId + ':outputItems'),
                  )
                  if (existingTimer) clearTimeout(existingTimer)
                  agentTextFlushTimers.set(
                    getAgentTextFlushKey(conversationId, roundId + ':outputItems'),
                    setTimeout(() => {
                      updateAgentConversation(conversationId, (current) => ({
                        ...current,
                        rounds: current.rounds.map((item) =>
                          item.id === roundId
                            ? { ...item, responseOutput: mergeResponseOutputItems(accumulatedOutputItems, outputItems) }
                            : item,
                        ),
                      }))
                    }, 120),
                  )
                }
              : undefined,
            onImageToolStarted: shouldStreamAssistantMessage
              ? async ({ toolCallId }) => {
                  if (controller.signal.aborted) return
                  agentAttemptProgressed = true
                  await ensureStreamingAgentTask(toolCallId)
                }
              : undefined,
            onImagePartialImage: shouldStreamAssistantMessage
              ? async ({ toolCallId, image, partialImageIndex }) => {
                  if (controller.signal.aborted) return
                  agentAttemptProgressed = true
                  const taskId = await ensureStreamingAgentTask(toolCallId)
                  if (controller.signal.aborted) return
                  useRuntimeStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
                  if (partialImageIndex === 0 || partialImageIndex == null) {
                    void persistTaskStreamPartialImage(taskId, image)
                  }
                }
              : undefined,
            onImageToolCompleted: shouldStreamAssistantMessage
              ? async (image) => {
                  if (controller.signal.aborted) return
                  agentAttemptProgressed = true
                  await completeAgentImageTask(image)
                }
              : undefined,
            onImageToolFailed: shouldStreamAssistantMessage
              ? async ({ toolCallId, error }) => {
                  if (controller.signal.aborted) return
                  agentAttemptProgressed = true
                  await ensureStreamingAgentTask(toolCallId)
                  if (controller.signal.aborted) return
                  failAgentImageTask(toolCallId, error)
                }
              : undefined,
          })
        },
        {
          maxRetries: normalizeMaxRetries(activeProfile.maxRetries),
          signal: controller.signal,
          shouldRetry: (error) => !agentAttemptProgressed && isRetryableError(error),
        },
      )
      if (controller.signal.aborted) throw createAgentAbortError()

      lastResponseId = result.responseId ?? lastResponseId
      currentResponseOutputItems = currentResponseOutputItems.length
        ? currentResponseOutputItems
        : (result.outputItems ?? [])
      accumulatedOutputItems = mergeResponseOutputItems(accumulatedOutputItems, currentResponseOutputItems)
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems } : item,
        ),
      }))

      // Force flush any pending text delta before processing the response
      flushAgentAssistantMessageContent(conversationId, assistantMessageId)
      const outputItemsKey = getAgentTextFlushKey(conversationId, roundId + ':outputItems')
      const outputItemsTimer = agentTextFlushTimers.get(outputItemsKey)
      if (outputItemsTimer) {
        clearTimeout(outputItemsTimer)
        agentTextFlushTimers.delete(outputItemsKey)
      }

      const responseText = result.text.trim()
      if (responseText && accumulatedText === textBeforeResponse) {
        const textToAppend = accumulatedText ? `\n\n${responseText}` : responseText
        accumulatedText += textToAppend
        if (shouldStreamAssistantMessage)
          appendAgentAssistantMessageContent(conversationId, assistantMessageId, textToAppend)
      }
      const newTextInThisResponse = accumulatedText.slice(textBeforeResponse.length).trim()
      if (newTextInThisResponse) textSegments.push(newTextInThisResponse)

      // Process built-in image_generation_call results (single images)
      for (const image of result.images) {
        if (image.toolCallId && taskIdByToolCallId.has(image.toolCallId)) {
          const completedTaskId = await completeAgentImageTask(image, result.rawResponsePayload)
          const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
          if (promptRefIds.length > 0) {
            const promptRefs = await resolveReferenceImages(promptRefIds)
            if (promptRefs.imageIds.length > 0) {
              const latestTask = useStore.getState().tasks.find((t) => t.id === completedTaskId)
              if (latestTask) {
                const mergedInputIds = uniqueIds([...latestTask.inputImageIds, ...promptRefs.imageIds])
                if (mergedInputIds.length !== latestTask.inputImageIds.length) {
                  updateTaskInStore(completedTaskId, { inputImageIds: mergedInputIds })
                }
              }
            }
          }
          continue
        }
        const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
        const promptRefs = await resolveReferenceImages(promptRefIds)
        const stored = await processAndStoreGeneratedImage(image.dataUrl, params, image.actualParams)
        const imgId = stored.id
        const actualParams: Partial<TaskParams> = {
          ...(Object.keys(stored.actualParams ?? {}).length ? stored.actualParams : {}),
          n: 1,
        }
        const filenameBatch = getNextTaskFilenameBatch(startedAt, null, 'image')
        const task: TaskRecord = {
          id: genId(),
          prompt: image.revisedPrompt ?? round?.prompt ?? userMessage.content,
          params,
          apiProvider: imageProfile.provider,
          apiProfileId: imageProfile.id,
          apiProfileName: imageProfile.name,
          apiMode: imageProfile.apiMode,
          apiModel: imageProfile.model,
          inputImageIds: uniqueIds([...(round?.inputImageIds ?? []), ...promptRefs.imageIds]),
          maskTargetImageId: round?.maskTargetImageId ?? null,
          maskImageId: round?.maskImageId ?? null,
          outputImages: [imgId],
          filenameBatch,
          actualParams,
          actualParamsByImage: { [imgId]: actualParams },
          revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
          rawResponsePayload: result.rawResponsePayload,
          status: 'done',
          error: null,
          createdAt: startedAt,
          finishedAt: Date.now(),
          elapsed: Date.now() - startedAt,
          sourceMode: 'agent',
          localSaveBatchFolder: getTaskLocalSaveBatchFolder(startedAt, filenameBatch),
          agentConversationId: conversationId,
          agentRoundId: roundId,
          agentMessageId: assistantMessageId,
          agentToolCallId: image.toolCallId,
          agentToolAction: image.action,
        }
        useStore.getState().setTasks([task, ...useStore.getState().tasks])
        attachTaskToAgentRound(task.id)
        await putTask(task)
        void saveTaskToLocalFS(task.id).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
      }

      if (result.rawResponsePayload && streamingTaskIds.length > 0) {
        for (const taskId of streamingTaskIds) {
          const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
          if (latestTask && !latestTask.rawResponsePayload)
            updateTaskInStore(taskId, { rawResponsePayload: result.rawResponsePayload })
        }
      }

      for (const taskId of runCreatedTaskIds) {
        const latestTask = useStore.getState().tasks.find((t) => t.id === taskId)
        if (latestTask && latestTask.status === 'running') {
          updateTaskInStore(taskId, {
            status: 'error',
            error: '接口未返回图片数据',
            finishedAt: Date.now(),
            elapsed: Date.now() - (latestTask.createdAt ?? startedAt),
          })
          useRuntimeStore.getState().setTaskStreamPreview(taskId)
          void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
        }
      }

      // Check for function calls that require continuation
      const singleImageFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'generate_image',
      )
      const batchFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'generate_image_batch',
      )
      const continueFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'continue_generation',
      )

      // Count built-in tool calls (image_generation, web_search) for budget tracking
      const responseToolCalls = countResponseToolCalls(currentResponseOutputItems)
      toolCallsUsed += responseToolCalls

      // Collect function_call_output items for all function calls that need responses
      const functionCallOutputs: ResponsesOutputItem[] = []

      const singleImageResults = await runWithConcurrencyAndRetry(
        singleImageFunctionCalls,
        imageProfile.maxConcurrent ?? 1,
        0,
        executeSingleImageFunctionCall,
      )
      for (let index = 0; index < singleImageFunctionCalls.length; index++) {
        const fc = singleImageFunctionCalls[index]
        const result = singleImageResults[index]
        if (result.status === 'rejected') throw result.reason
        functionCallOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: result.value,
        })
      }

      const batchExecutionResults = []
      if (batchFunctionCalls.length > 0) {
        for (const fc of batchFunctionCalls) {
          const batchExecution = await executeBatchFunctionCall(fc)
          batchExecutionResults.push(batchExecution)
          functionCallOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: batchExecution.output,
          })
        }
      }

      for (const fc of continueFunctionCalls) {
        functionCallOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify({ status: 'continued' }),
        })
      }

      // If no function calls need output → model decided the task is done → break
      if (functionCallOutputs.length === 0) {
        updateAgentConversation(conversationId, (current) => ({
          ...current,
          updatedAt: Date.now(),
          rounds: current.rounds.map((item) =>
            item.id === roundId
              ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems }
              : item,
          ),
        }))
        break
      }

      const accumulatedOutputItemsWithFunctionOutputs = mergeResponseOutputItems(
        accumulatedOutputItems,
        functionCallOutputs,
      )

      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItemsWithFunctionOutputs }
            : item,
        ),
      }))

      const terminalBatch =
        batchExecutionResults.length === 1 &&
        batchFunctionCalls.length === 1 &&
        singleImageFunctionCalls.length === 0 &&
        continueFunctionCalls.length === 0 &&
        result.images.length === 0 &&
        batchExecutionResults[0].finalizeAfterBatch
          ? batchExecutionResults[0]
          : null
      if (terminalBatch) {
        const summary =
          terminalBatch.failureCount === 0
            ? `批量生成完成，共 ${terminalBatch.successCount} 张图片。`
            : `批量生成完成：${terminalBatch.successCount} 张成功，${terminalBatch.failureCount} 张失败。`
        const textToAppend = accumulatedText ? `\n\n${summary}` : summary
        accumulatedText += textToAppend
        textSegments.push(summary)
        if (shouldStreamAssistantMessage)
          appendAgentAssistantMessageContent(conversationId, assistantMessageId, textToAppend)
        accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
        break
      }

      if (toolCallsUsed >= maxToolCalls) {
        reachedToolLimit = true
        break
      }

      // Build continuation input with function call outputs and available refs
      const latestConversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
      const latestRound = latestConversation?.rounds.find((item) => item.id === roundId)
      if (!latestRound) break

      const continuationBase = buildAgentContinuationInput(
        apiInput,
        latestRound,
        useStore.getState().tasks,
        accumulatedOutputItems,
        toolCallsUsed,
        maxToolCalls,
      )
      // Insert function_call_output items before the continuation system message
      continuationBase.splice(continuationBase.length - 1, 0, ...functionCallOutputs)
      // Inject batch-generated images as input_image user message for model visibility
      const batchImagesItem = await createAgentBatchImagesInputItem(
        latestRound,
        useStore.getState().tasks,
        streamingTaskIds,
      )
      if (batchImagesItem) continuationBase.splice(continuationBase.length - 1, 0, batchImagesItem)
      apiInputForTurn = continuationBase
      accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
      pendingToolTextSeparator = true
    }

    const taskIds: string[] = [...streamingTaskIds]
    const outputIds = taskIds.flatMap(
      (taskId) => useStore.getState().tasks.find((task) => task.id === taskId)?.outputImages ?? [],
    )
    const limitNotice = reachedToolLimit ? `已达到最大工具调用次数（${maxToolCalls}），已停止自动续跑。` : ''
    const joinedText = textSegments.join('\n\n').trim()
    const finalContent =
      [joinedText, limitNotice].filter(Boolean).join(joinedText ? '\n\n' : '') ||
      (taskIds.length > 0 || outputIds.length > 0 ? '图像已生成。' : '')

    const assistantMessage: AgentMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: finalContent,
      roundId,
      outputTaskIds: taskIds,
      createdAt: Date.now(),
    }

    // 轮次完成：丢弃未 flush 的缓冲 delta（finalContent 已包含其文本），
    // 并清理流式文本残留，防止陈旧 80ms 定时器把残缺 delta 追加到终态消息。
    clearAgentMessageStreamState(conversationId, assistantMessageId)

    updateAgentConversation(conversationId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((round) =>
        round.id === roundId
          ? {
              ...round,
              assistantMessageId,
              outputTaskIds: taskIds,
              responseId: lastResponseId,
              responseOutput: accumulatedOutputItems,
              status: 'done',
              error: null,
              finishedAt: Date.now(),
            }
          : round,
      ),
      messages: current.messages.some((message) => message.id === assistantMessageId)
        ? current.messages.map((message) => (message.id === assistantMessageId ? assistantMessage : message))
        : [...current.messages, assistantMessage],
    }))

    useStore.getState().showToast(outputIds.length > 0 ? 'Agent 已生成图片' : 'Agent 已回复', 'success')
    showTaskCompletionNotification(
      outputIds.length > 0 ? 'Agent 已生成图片' : 'Agent 已回复',
      outputIds.length > 0 ? `Agent 回复已结束，共生成 ${outputIds.length} 张图片。` : 'Agent 回复已结束。',
    )
    void saveAgentConversationToLocalFS(conversationId)
  } catch (err) {
    if (controller.signal.aborted) {
      if (markAgentRoundStopped(conversationId, roundId)) {
        useStore.getState().showToast('已停止生成', 'info')
      }
      return
    }

    if (isAgentRecoveryPauseError(err)) return

    let message = err instanceof Error ? err.message : String(err)
    const usesApiProxy = activeProfile.apiProxy ?? requestSettings.apiProxy
    const networkErrorHint = getApiRequestNetworkErrorHint(err, startedAt, usesApiProxy, activeProfile)
    if (networkErrorHint && !message.includes(IMAGE_FETCH_CORS_HINT)) {
      message += `\n${networkErrorHint}`
    }
    const streamingHint = getStreamingErrorHint(err, activeProfile)
    if (streamingHint && !message.includes(streamingHint)) {
      message += streamingHint
    }

    // 出错路径：先清理陈旧 flush 定时器与流式文本，避免残缺 delta 在错误信息落定后被追加。
    const failedRound = useStore
      .getState()
      .agentConversations.find((item) => item.id === conversationId)
      ?.rounds.find((round) => round.id === roundId)
    const failedAssistantMessage = failedRound?.assistantMessageId
      ? useStore
          .getState()
          .agentConversations.find((item) => item.id === conversationId)
          ?.messages.find((item) => item.id === failedRound.assistantMessageId)
      : useStore
          .getState()
          .agentConversations.find((item) => item.id === conversationId)
          ?.messages.find((item) => item.roundId === roundId && item.role === 'assistant')
    if (failedAssistantMessage) {
      clearAgentMessageStreamState(conversationId, failedAssistantMessage.id)
    }

    updateAgentConversation(conversationId, (current) => {
      const failedRound = current.rounds.find((round) => round.id === roundId)
      const existingAssistantMessage = failedRound?.assistantMessageId
        ? current.messages.find((item) => item.id === failedRound.assistantMessageId)
        : current.messages.find((item) => item.roundId === roundId && item.role === 'assistant')
      const errorContent = `请求失败：${message}`

      return {
        ...current,
        title: current.rounds.length === 1 && current.rounds[0].id === roundId ? '新对话' : current.title,
        updatedAt: Date.now(),
        rounds: current.rounds.map((round) =>
          round.id === roundId
            ? {
                ...round,
                ...(existingAssistantMessage ? { assistantMessageId: existingAssistantMessage.id } : {}),
                status: 'error',
                error: message,
                finishedAt: Date.now(),
              }
            : round,
        ),
        messages: existingAssistantMessage
          ? current.messages.map((item) =>
              item.id === existingAssistantMessage.id ? { ...item, content: errorContent } : item,
            )
          : [
              ...current.messages,
              {
                id: genId(),
                role: 'assistant',
                content: errorContent,
                roundId,
                createdAt: Date.now(),
              },
            ],
      }
    })
    useStore.getState().showToast(`Agent 请求失败：${message}`, 'error')
  } finally {
    void scheduleAgentRoundSummaryToLocalFS(conversationId, roundId)
    if (agentRoundControllers.get(controllerKey) === controller) {
      agentRoundControllers.delete(controllerKey)
    }
  }
}

async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return
  // 提示词还没写出来（「卡先建、后写词」的链路）：此刻开跑只会拿着占位文案去生图。
  // 提示词就绪后由 `fulfillPendingTaskPrompt` 清掉标记再进来。
  if (task.promptPending) return
  // 新一次执行开始：上一次执行留下的「超时终结」标记作废，否则收尾会把迟到的旧结果误判成属于本次执行。
  if (task.watchdogTimedOutAt !== undefined) updateTaskInStore(taskId, { watchdogTimedOutAt: undefined })
  // 任务级取消：注册 AbortController，停止时中止在途请求/轮询
  const abortController = new AbortController()
  taskAbortControllers.set(taskId, abortController)
  const signal = abortController.signal
  const throwIfTaskStopped = () => {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException('任务已停止', 'AbortError')
    }
  }
  const taskParams = task.params
  const taskProfile = getTaskApiProfile(settings, task)
  if (!taskProfile && task.apiProfileId) {
    updateTaskInStore(taskId, {
      status: 'error',
      error: '找不到此任务所使用的 API 配置。',
      progressStage: 'failed',
      progressUpdatedAt: Date.now(),
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    return
  }
  const activeProfile = taskProfile ?? getActiveApiProfile(settings)
  const requestSettings = createSettingsForApiProfile(settings, activeProfile)
  const taskProvider = task.apiProvider ?? activeProfile.provider
  updateTaskProgress(taskId, 'requesting')
  let falRequestInfo: { requestId: string; endpoint: string } | null =
    task.falRequestId && task.falEndpoint ? { requestId: task.falRequestId, endpoint: task.falEndpoint } : null
  let customTaskInfo: { taskId: string } | null = task.customTaskId ? { taskId: task.customTaskId } : null

  if (
    taskProvider !== 'fal' &&
    !isAsyncCustomProviderTask(requestSettings, taskProvider, task.inputImageIds.length > 0)
  ) {
    scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
  }

  try {
    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    const n = task.params.n > 0 ? task.params.n : 1
    // 文件夹输入模式下按「逐张参考」始终逐张分配参考图：即使单张输出也不把文件夹全部图片
    // 同时发给一条提示词（仅在用户显式选择「同时参考全部」时才合并发送）。
    const useFolderMode = shouldCycleReferenceImages(
      task.params.reference_mode,
      task.inputImageIds.length,
      n,
      Boolean(task.inputImageFolderPath),
    )
    // 变量提示词：提交时按 n 个槽位展开成具体提示词，每个槽位对应一个独立组合；
    // 展开基于任务 id 的确定性种子，重试/恢复时结果一致。
    const variablePrompt = parseVariablePrompt(task.prompt)
    const renderedVariablePrompts = variablePrompt.enabled ? renderVariablePromptBatch(task.prompt, n, task.id) : []
    const resolveTaskPrompt = (slotIndex = 0) => renderedVariablePrompts[slotIndex] ?? task.prompt

    const maxConcurrent = normalizeMaxConcurrent(activeProfile.maxConcurrent)
    const maxRetries = normalizeMaxRetries(activeProfile.maxRetries)

    // 带参考图的编辑请求对中转站压力大且通常很慢（实测部分中转站 1-3 分钟/张，
    // 并发时容易过载拒连导致整批失败）：把并发压到上限内，避免多请求同时打爆慢速接口。
    const effectiveMaxConcurrent =
      inputDataUrls.length > 0 ? Math.min(maxConcurrent, MAX_REFERENCE_IMAGE_CONCURRENCY) : maxConcurrent

    const apiMaxN = getApiMaxN(activeProfile)

    /**
     * 多图（n>1）的编排执行：使用纯函数编排器保证数量、去重与补偿。
     * - 按供应商能力拆分首轮请求（fal 每请求最多 4 张，OpenAI 兼容每请求 1 张）。
     * - 欠交付 / 完全重复 -> 自动创建单张补偿请求（n=1）。
     * - 每张图先预处理 + 指纹校验，确认非重复后才 commit（只写入一次）。
     * - 每个远端请求独立持久化 request id，支持崩溃后恢复。
     * 返回与 CallApiResult 兼容的结构，复用下方既有的最终化逻辑。
     */
    async function executeOrchestratedBatch(): Promise<
      CallApiResult & {
        outputImages?: string[]
        batchItemStatuses?: BatchItemStatus[]
        batchItemErrors?: BatchItemError[]
        status?: 'running' | 'done' | 'partial-failure' | 'error' | 'cancelled'
        error?: string
      }
    > {
      if (!task) {
        return {
          images: [],
          actualParams: { n: 0 },
          actualParamsList: [],
          revisedPrompts: [],
          status: 'error' as const,
          error: '任务不存在',
        }
      }
      const isAsyncCustom =
        taskProvider !== 'fal' && isAsyncCustomProviderTask(requestSettings, taskProvider, inputDataUrls.length > 0)
      const capabilities: ImageProviderCapabilities = {
        maxImagesPerRequest: useFolderMode || variablePrompt.enabled ? 1 : apiMaxN,
        supportsSeed: taskProvider === 'fal',
        supportsAsyncRecovery: taskProvider === 'fal' || isAsyncCustom,
        supportsCancel: taskProvider === 'fal' || isAsyncCustom,
      }
      const policy: GenerationPolicy = createGenerationPolicy(n, {
        maxConcurrent: effectiveMaxConcurrent,
        transientRetries: maxRetries,
        replacementAttempts: 2,
        rejectExactDuplicates: !variablePrompt.enabled,
        rejectNearDuplicates: false,
        nearDuplicateThreshold: 0,
        capabilities,
      })
      const canResume = task.generationSlots?.length === n && Array.isArray(task.remoteGenerationRequests)
      let state: GenerationState = canResume
        ? {
            requestedCount: n,
            slots: task.generationSlots!.map((slot) => ({ ...slot })),
            remoteRequests: task.remoteGenerationRequests!.map((request) => ({
              ...request,
              slotIndexes: [...request.slotIndexes],
            })),
            replacementCount: 0,
            duplicateCount: 0,
            nearDuplicateCount: 0,
            providerFailureCount: 0,
            status: 'running',
          }
        : createInitialGenerationState(n)

      // A renderer crash can happen after creating a local request record but before
      // the provider returns its remote id. That request cannot be recovered, so make
      // its slots eligible for a bounded replacement instead of leaving them in flight forever.
      if (canResume) {
        const unrecoverableIds = new Set(
          state.remoteRequests
            .filter(
              (request) =>
                (request.status === 'created' || request.status === 'submitted' || request.status === 'running') &&
                !request.remoteRequestId,
            )
            .map((request) => request.id),
        )
        if (unrecoverableIds.size > 0) {
          const affectedSlots = new Set(
            state.remoteRequests
              .filter((request) => unrecoverableIds.has(request.id))
              .flatMap((request) => request.slotIndexes),
          )
          state = {
            ...state,
            remoteRequests: state.remoteRequests.map((request) =>
              unrecoverableIds.has(request.id)
                ? { ...request, status: 'failed' as const, error: '应用中断，未取得远端任务 ID', updatedAt: Date.now() }
                : request,
            ),
            slots: state.slots.map((slot) =>
              affectedSlots.has(slot.index) && slot.status !== 'done' && slot.status !== 'failed'
                ? { ...slot, status: 'pending' as const }
                : slot,
            ),
          }
        }
      }
      const persist = () =>
        updateTaskInStore(taskId, {
          generationSlots: state.slots.map((s) => ({ ...s })),
          remoteGenerationRequests: state.remoteRequests.map((r) => ({ ...r })),
        })

      persist()

      // 并发信号量
      let activeCount = 0
      const waitQueue: Array<() => void> = []
      const acquire = async () => {
        if (activeCount < maxConcurrent) {
          activeCount++
          return
        }
        await new Promise<void>((resolve) => waitQueue.push(resolve))
      }
      const release = () => {
        activeCount--
        if (waitQueue.length > 0 && activeCount < maxConcurrent) {
          activeCount++
          waitQueue.shift()!()
        }
      }

      const committed = new Map<
        number,
        { imgId: string; dataUrl: string; actualParams?: Partial<TaskParams>; revised?: string; rawUrl?: string }
      >()

      // Result processing mutates slot state and persists images. Serializing this
      // critical section prevents two concurrently completed requests from accepting
      // the same fingerprint before either one has committed it.
      let resultCommitChain = Promise.resolve()
      const withResultCommitLock = async <T>(fn: () => Promise<T>): Promise<T> => {
        const next = resultCommitChain.then(fn, fn)
        resultCommitChain = next.then(
          () => undefined,
          () => undefined,
        )
        return next
      }

      for (const slot of state.slots) {
        if (slot.status !== 'done' || !slot.outputImageId) continue
        const dataUrl = await ensureImageCached(slot.outputImageId)
        if (!dataUrl) continue
        committed.set(slot.index, {
          imgId: slot.outputImageId,
          dataUrl,
          actualParams: task.actualParamsByImage?.[slot.outputImageId],
        })
      }

      // 恢复重算时槽位快照可能落后于已落盘的 outputImages（图已产出，槽位却还停在 pending / submitted）。
      // 只按槽位状态回收会在收尾把 outputImages 覆盖成更短的列表，表现为「刷新后任务卡片显示的已生成
      // 数量变少，而素材库仍是全量」（素材是逐条 upsert 的，不受影响）。
      // 这里把它们补回空闲槽位并直接标 done：既保住图片，也避免对同一张图重复发起生成。
      if (canResume) {
        const restoredOutputs = planRestoredOutputAssignments(state.slots, task.outputImages ?? [])
        for (const { slotIndex, imageId } of restoredOutputs) {
          const dataUrl = await ensureImageCached(imageId)
          if (!dataUrl) continue
          committed.set(slotIndex, { imgId: imageId, dataUrl, actualParams: task.actualParamsByImage?.[imageId] })
          state = {
            ...state,
            slots: state.slots.map((slot) =>
              slot.index === slotIndex ? { ...slot, status: 'done' as const, outputImageId: imageId } : slot,
            ),
          }
        }
        if (restoredOutputs.length > 0) persist()
      }

      const processResult = async (requestId: string, result: CallApiResult): Promise<GenerationState> =>
        withResultCommitLock(async () => {
          const request = state.remoteRequests.find((r) => r.id === requestId)
          if (!request) return state
          const candidates: Array<{
            slotIndex: number
            prepared: PreparedGeneratedImage
            contentHash: string
            perceptualHash?: string
            revised?: string
            rawUrl?: string
          }> = []
          const rejectedExact: number[] = []
          const seen: ImageFingerprintLike[] = []
          for (let i = 0; i < request.slotIndexes.length; i++) {
            const slotIndex = request.slotIndexes[i]
            const image = result.images[i]
            if (!image) continue
            const prepared = await prepareGeneratedImage(
              image,
              taskParams,
              result.actualParamsList?.[i] ?? result.actualParams,
            )
            const fingerprint = await fingerprintImage(prepared.dataUrl)
            const kind = classifyImageAgainstState(
              state,
              fingerprint.contentHash,
              fingerprint.perceptualHash,
              policy,
              seen,
            )
            if (kind === 'accepted') {
              candidates.push({
                slotIndex,
                contentHash: fingerprint.contentHash,
                perceptualHash: fingerprint.perceptualHash,
                prepared,
                revised: result.revisedPrompts?.[i],
                rawUrl: result.rawImageUrls?.[i],
              })
              seen.push({ contentHash: fingerprint.contentHash, perceptualHash: fingerprint.perceptualHash })
            } else if (kind === 'exact-duplicate') {
              rejectedExact.push(slotIndex)
            }
          }

          const assignments: SlotAssignment[] = []
          const newlyCommittedIds: string[] = []
          try {
            for (const candidate of candidates) {
              const imgId = await commitGeneratedImage(candidate.prepared)
              newlyCommittedIds.push(imgId)
              assignments.push({
                slotIndex: candidate.slotIndex,
                imageId: imgId,
                contentHash: candidate.contentHash,
                perceptualHash: candidate.perceptualHash,
              })
              committed.set(candidate.slotIndex, {
                imgId,
                dataUrl: candidate.prepared.dataUrl,
                actualParams: candidate.prepared.actualParams,
                revised: candidate.revised,
                rawUrl: candidate.rawUrl,
              })
            }
          } catch (err) {
            await deleteUnreferencedImageIds(newlyCommittedIds)
            for (const candidate of candidates) committed.delete(candidate.slotIndex)
            throw err
          }

          state = applyProviderResult(
            state,
            requestId,
            assignments,
            rejectedExact.length ? { slotIndexes: rejectedExact, kind: 'exact-duplicate' } : undefined,
          )
          const current = useStore.getState().tasks.find((t) => t.id === taskId)
          // 看门狗超时后仍需把已 commit 的图片落进任务：否则这批图只存在于 images 表，
          // 收尾前一旦崩溃就是卡片和素材库都收不到的孤儿数据。
          if (canSettleTaskOutputs(current)) {
            const outputImages = state.slots
              .filter((slot) => slot.status === 'done' && slot.outputImageId)
              .sort((a, b) => a.index - b.index)
              .map((slot) => slot.outputImageId!)
            updateTaskProgress(taskId, 'generating')
            updateTaskInStore(taskId, { outputImages })
            for (const assignment of assignments) {
              void saveTaskImagesToLocalFS(taskId, [assignment.imageId], assignment.slotIndex)
            }
            scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
          }
          return state
        })

      const submitRequest = async (planned: PlannedRequest): Promise<void> => {
        await acquire()
        throwIfTaskStopped()
        const requestId = genId()
        try {
          const provider: RemoteGenerationProvider =
            taskProvider === 'fal' ? 'fal' : isAsyncCustom ? 'custom' : 'openai'
          state = applyRemoteRequestSubmitted(state, planned, { id: requestId, provider })
          persist()
          const seed = capabilities.supportsSeed
            ? computeSeed(taskId, planned.slotIndexes[0], planned.attempt)
            : undefined
          const requestInputDataUrls = useFolderMode
            ? await Promise.all(
                planned.slotIndexes.map(async (slotIndex) => {
                  const imgId = task.inputImageIds[slotIndex % task.inputImageIds.length]
                  const dataUrl = await ensureImageCached(imgId)
                  if (!dataUrl) throw new Error('输入图片已不存在')
                  return dataUrl
                }),
              )
            : inputDataUrls
          const result = await retryWithBackoff(requestId, async () =>
            callImageApi({
              settings: requestSettings,
              prompt: appendAdNegativeRule(
                replaceImageMentionsForApi(
                  resolveTaskPrompt(planned.slotIndexes[0]),
                  requestInputDataUrls.length,
                  undefined,
                ),
                task.adNegativeRuleSnapshot?.content ??
                  getAdNegativeRule(requestSettings, task.params.adNegativeRuleId).content,
              ),
              params: { ...taskParams, n: planned.count, ...(seed !== undefined ? { seed } : {}) },
              inputImageDataUrls: requestInputDataUrls,
              maskDataUrl,
              signal,
              onFalRequestEnqueued: (request) => {
                state = applyRemoteRequestSubmitted(state, planned, {
                  id: requestId,
                  provider: 'fal',
                  endpoint: request.endpoint,
                  remoteRequestId: request.requestId,
                })
                persist()
                falRequestInfo = request
                updateTaskProgress(taskId, 'relay-received')
                return updateTaskInStore(taskId, {
                  falRequestId: request.requestId,
                  falEndpoint: request.endpoint,
                  falRecoverable: false,
                })
              },
              onCustomTaskEnqueued: (request) => {
                state = applyRemoteRequestSubmitted(state, planned, {
                  id: requestId,
                  provider: 'custom',
                  remoteRequestId: request.taskId,
                })
                persist()
                customTaskInfo = request
                updateTaskProgress(taskId, 'relay-received')
                return updateTaskInStore(taskId, {
                  customTaskId: request.taskId,
                  customRecoverable: false,
                })
              },
              onPartialImage: (partial) => {
                updateTaskProgress(taskId, 'previewing')
                const baseIndex = planned.slotIndexes[0] + (partial.requestIndex ?? 0)
                useRuntimeStore.getState().setTaskStreamPreview(taskId, partial.image, baseIndex)
                void persistTaskStreamPartialImage(taskId, partial.image)
                scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
              },
            }),
          )
          state = await processResult(requestId, result)
          persist()
        } catch (err) {
          const kind = classifyGenerationError(err, {
            hasRemoteId: Boolean(state.remoteRequests.find((r) => r.id === requestId)?.remoteRequestId),
            afterSubmitTimeout: err instanceof Error ? /timeout/i.test(err.message) : false,
          })
          const failureMessage = err instanceof Error ? err.message : String(err)
          // 带参考图的慢速编辑请求：附加可操作的提示，避免用户只看到裸错误
          const slowEditHint = getApiRequestNetworkErrorHint(
            err,
            task.createdAt,
            activeProfile.apiProxy,
            activeProfile,
            inputDataUrls.length > 0,
          )
          state = applyRequestFailure(
            state,
            requestId,
            kind,
            slowEditHint && !failureMessage.includes(IMAGE_FETCH_CORS_HINT)
              ? `${failureMessage}\n${slowEditHint}`
              : failureMessage,
          )
          persist()
        } finally {
          release()
        }
      }

      const retryWithBackoff = async (requestId: string, fn: () => Promise<CallApiResult>): Promise<CallApiResult> => {
        let lastError: unknown
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          throwIfTaskStopped()
          if (attempt > 0) {
            const delayMs = computeBackoffDelay(attempt - 1)
            release()
            try {
              await new Promise<void>((resolve, reject) => {
                if (signal.aborted) {
                  reject(signal.reason instanceof Error ? signal.reason : new DOMException('任务已停止', 'AbortError'))
                  return
                }
                const timer = setTimeout(resolve, delayMs)
                signal.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(timer)
                    reject(
                      signal.reason instanceof Error ? signal.reason : new DOMException('任务已停止', 'AbortError'),
                    )
                  },
                  { once: true },
                )
              })
            } finally {
              await acquire()
            }
          }
          try {
            return await fn()
          } catch (err) {
            lastError = err
            const hasRemoteId = Boolean(
              state.remoteRequests.find((request) => request.id === requestId)?.remoteRequestId,
            )
            const kind = classifyGenerationError(err, { hasRemoteId, afterSubmitTimeout: hasRemoteId })
            // Once a queue provider has accepted a request, resubmitting would create
            // an untracked duplicate. Let the outer failure path poll that request instead.
            if (hasRemoteId) throw err
            if (attempt < maxRetries && (kind === 'transient' || kind === 'rate-limit' || kind === 'result-missing')) {
              continue
            }
            throw err
          }
        }
        throw lastError
      }

      const recoverRequest = async (req: (typeof state.remoteRequests)[number]): Promise<void> => {
        try {
          let result: CallApiResult
          if (req.provider === 'fal' && req.endpoint && req.remoteRequestId) {
            result = await getFalQueuedImageResult(activeProfile, req.endpoint, req.remoteRequestId, taskParams, signal)
          } else if (req.provider === 'custom' && req.remoteRequestId) {
            const customDef = getCustomProviderDefinition(requestSettings, task.apiProvider ?? activeProfile.provider)
            if (!customDef) {
              state = applyRequestFailure(state, req.id, 'invalid-input')
              persist()
              return
            }
            result = await getCustomQueuedImageResult(activeProfile, customDef, req.remoteRequestId, taskParams, signal)
          } else {
            return
          }
          state = await processResult(req.id, result)
          persist()
        } catch (err) {
          const kind = classifyGenerationError(err, { hasRemoteId: true, afterSubmitTimeout: true })
          const failureMessage = err instanceof Error ? err.message : String(err)
          state = applyRequestFailure(state, req.id, kind, failureMessage)
          persist()
        }
      }

      let recoveryIterations = 0
      const maxRecovery = maxRetries + 2
      // 主循环：规划 -> 提交 -> 恢复，直到完成或进入 partial-failure
      for (;;) {
        throwIfTaskStopped()
        const completion = getBatchCompletion(state, policy)
        if (completion.status !== 'running') break
        state = markExhaustedSlots(state, policy)
        const afterMark = getBatchCompletion(state, policy)
        if (afterMark.status !== 'running') break
        const plannedList = planNextRequests(state, policy)
        if (plannedList.length > 0) {
          await Promise.all(plannedList.map((planned) => submitRequest(planned)))
          throwIfTaskStopped()
          persist()
          continue
        }
        const recoverable = getRecoverableRequests(state)
        if (recoverable.length === 0) break
        if (recoveryIterations >= maxRecovery) {
          // 恢复预算耗尽：硬失败该请求，并把被覆盖的槽位退回 pending，
          // 使其能被当作补偿请求重新规划（若补偿预算也用尽，则由 markExhaustedSlots 标记失败）。
          for (const req of recoverable) {
            state = {
              ...state,
              remoteRequests: state.remoteRequests.map((r) =>
                r.id === req.id
                  ? { ...r, status: 'failed' as const, error: '恢复超时，放弃该远端请求', updatedAt: Date.now() }
                  : r,
              ),
              slots: state.slots.map((s) =>
                req.slotIndexes.includes(s.index) && s.status !== 'done' && s.status !== 'failed'
                  ? { ...s, status: 'pending' as const }
                  : s,
              ),
            }
          }
          persist()
          continue
        }
        recoveryIterations++
        for (const req of recoverable) await recoverRequest(req)
      }

      const doneSlots = state.slots.filter((s) => s.status === 'done').sort((a, b) => a.index - b.index)
      const images = doneSlots.map((s) => committed.get(s.index)!.dataUrl)
      //  race-free 的槽位级结果（并发提交不会互相覆盖），用于最终 outputImages。
      const outputImages = doneSlots.map((s) => committed.get(s.index)!.imgId)
      const actualParamsList = doneSlots.map((s) => committed.get(s.index)!.actualParams)
      const revisedPrompts = doneSlots.map((s) => committed.get(s.index)!.revised)
      const rawImageUrls = doneSlots.map((s) => committed.get(s.index)!.rawUrl).filter((u): u is string => Boolean(u))
      const batchItemStatuses: BatchItemStatus[] = state.slots.map((s) => (s.status === 'failed' ? 'error' : 'done'))
      const batchItemErrors: BatchItemError[] = state.slots
        .filter((s) => s.status === 'failed' && s.error)
        .map((s) => ({ index: s.index, error: s.error! }))
      const hasPartialFailure = batchItemErrors.length > 0
      const finalCompletion = getBatchCompletion(state, policy)
      return {
        images,
        outputImages,
        actualParams: { ...firstActualParams(actualParamsList), n: images.length },
        actualParamsList,
        revisedPrompts,
        ...(rawImageUrls.length ? { rawImageUrls } : {}),
        // 始终输出槽位级状态，便于 UI 展示「生成中 X/N」「补齐 Y 张」等。
        batchItemStatuses,
        batchItemErrors,
        status: finalCompletion.status,
        ...(finalCompletion.status === 'error'
          ? { error: state.error ?? '生成失败' }
          : hasPartialFailure
            ? { error: `${batchItemErrors.length} 张图片生成失败` }
            : {}),
      }
    }

    let result: CallApiResult & {
      status?: 'running' | 'done' | 'partial-failure' | 'error' | 'cancelled'
      error?: string
      outputImages?: string[]
      batchItemStatuses?: BatchItemStatus[]
      batchItemErrors?: BatchItemError[]
    }
    if (n > 1) {
      result = await executeOrchestratedBatch()
    } else {
      let singleRequestProgressed = false
      result = await retryTransientRequest(
        () =>
          callImageApi({
            settings: requestSettings,
            prompt: appendAdNegativeRule(
              replaceImageMentionsForApi(resolveTaskPrompt(0), inputDataUrls.length),
              task.adNegativeRuleSnapshot?.content ??
                getAdNegativeRule(requestSettings, task.params.adNegativeRuleId).content,
            ),
            params: task.params,
            inputImageDataUrls: inputDataUrls,
            maskDataUrl,
            signal,
            onFalRequestEnqueued: (request) => {
              singleRequestProgressed = true
              falRequestInfo = request
              updateTaskProgress(taskId, 'relay-received')
              return updateTaskInStore(taskId, {
                falRequestId: request.requestId,
                falEndpoint: request.endpoint,
                falRecoverable: false,
              })
            },
            onCustomTaskEnqueued: (request) => {
              singleRequestProgressed = true
              customTaskInfo = request
              updateTaskProgress(taskId, 'relay-received')
              return updateTaskInStore(taskId, {
                customTaskId: request.taskId,
                customRecoverable: false,
              })
            },
            onPartialImage: (partial) => {
              singleRequestProgressed = true
              updateTaskProgress(taskId, 'previewing')
              useRuntimeStore.getState().setTaskStreamPreview(taskId, partial.image, partial.requestIndex)
              void persistTaskStreamPartialImage(taskId, partial.image)
              scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
            },
          }),
        {
          maxRetries: normalizeMaxRetries(activeProfile.maxRetries),
          shouldRetry: (error) => !singleRequestProgressed && isRetryableError(error),
          signal,
        },
      )
    }

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    // 同样放行「看门狗超时后迟到返回」的结果：这些图已经拿到手了，丢掉只会造出孤儿数据。
    if (!latestBeforeSuccess || !canSettleTaskOutputs(latestBeforeSuccess)) {
      useRuntimeStore.getState().setTaskStreamPreview(taskId)
      return
    }

    // 存储输出图片（n>1 分批模式已在每轮追加，这里只需补充单张模式）
    // 多图编排路径直接返回 race-free 的槽位级 outputImages；单张路径沿用 store 中已累积的 outputImages。
    // 收尾这一笔不得让「已生成的图片数量」回退成更短的一份（恢复重算 / 迟到的中间态结果都可能返回较短列表，
    // 一旦覆盖就会出现「刷新后任务卡片数量变少、素材库却仍是全量」），因此取两者中更完整的那一份。
    const resultOutputIds = result.outputImages && result.outputImages.length > 0 ? result.outputImages : []
    const persistedOutputIds = latestBeforeSuccess.outputImages ?? []
    const outputIds = pickMoreCompleteOutputIds(resultOutputIds, persistedOutputIds)
    let storedSingleActualParamsList: Array<Partial<TaskParams> | undefined> | undefined
    if (n === 1) {
      storedSingleActualParamsList = []
      for (let i = 0; i < result.images.length; i++) {
        const stored = await processAndStoreGeneratedImage(
          result.images[i],
          taskParams,
          result.actualParamsList?.[i] ?? result.actualParams,
        )
        outputIds.push(stored.id)
        storedSingleActualParamsList.push(stored.actualParams)
      }
    }
    const isAsyncCustomTask = taskProvider !== 'fal' && taskProvider !== 'openai' && Boolean(customTaskInfo)
    const actualParamsList =
      storedSingleActualParamsList ??
      (taskProvider === 'fal'
        ? await resolveImageSizeParamsList(result.images, result.actualParamsList)
        : isAsyncCustomTask
          ? await readImageSizeParamsList(result.images)
          : result.actualParamsList)
    const actualParams = (() => {
      if (storedSingleActualParamsList) return { ...firstActualParams(actualParamsList), n: outputIds.length }
      if (taskProvider === 'fal') return firstActualParams(actualParamsList)
      if (isAsyncCustomTask) return firstActualParams(actualParamsList)
      return { ...result.actualParams, n: outputIds.length }
    })()
    const shouldStoreRevisedPrompts = taskProvider !== 'fal' && !isAsyncCustomTask
    const actualParamsByImage = mapActualParamsByImage(outputIds, actualParamsList)
    const revisedPromptByImage = shouldStoreRevisedPrompts
      ? result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
          const imgId = outputIds[index]
          if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
          return acc
        }, {})
      : undefined
    const promptWasRevised =
      shouldStoreRevisedPrompts &&
      // 变量提示词展开后的提示词必然与模板不同，不触发“接口改写提示词”的误判
      !variablePrompt.enabled &&
      result.revisedPrompts?.some(
        (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== task.prompt.trim(),
      )
    const hasRevisedPromptValue =
      shouldStoreRevisedPrompts && result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (taskProvider === 'openai' && activeProfile.apiMode === 'responses' && !activeProfile.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, '接口没有返回官方 API 会返回的部分信息')
      }
    }

    // 更新任务
    const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
    // 用户主动停止 / 任务已删除时不得把任务"复活"为完成；但看门狗超时是例外 —— 它只是
    // 「先给用户一个交代」，请求可能还在飞，带着本次执行的超时标记时仍必须结算，
    // 否则这批刚 commit 的图片既不进卡片也不进素材库，直接变成孤儿数据。
    if (!latestBeforeUpdate || !canSettleTaskOutputs(latestBeforeUpdate)) {
      useRuntimeStore.getState().setTaskStreamPreview(taskId)
      return
    }
    const partialImageIdsToClean = latestBeforeUpdate.streamPartialImageIds || []
    clearOpenAIWatchdogTimer(taskId)
    useRuntimeStore.getState().setTaskStreamPreview(taskId)
    const hasPartialFailure = result.batchItemStatuses && result.batchItemErrors && result.batchItemErrors.length > 0
    // 编排批处理可能返回明确的失败/部分完成状态，避免伪装成成功。
    const finalTaskStatus: TaskStatus = result.status === 'error' ? 'error' : 'done'
    updateTaskProgress(taskId, 'saving')
    updateTaskInStore(taskId, {
      outputImages: outputIds,
      streamPartialImageIds: undefined,
      rawImageUrls: result.rawImageUrls?.length ? result.rawImageUrls : undefined,
      actualParams,
      actualParamsByImage,
      revisedPromptByImage:
        revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
      batchItemStatuses: result.batchItemStatuses,
      batchItemErrors: result.batchItemErrors,
      status: finalTaskStatus,
      ...(result.status === 'error' ? { error: result.error ?? '生成失败' } : { error: null }),
      // 真实结果已结算，超时标记作废（残留会让下一次执行误判）。
      watchdogTimedOutAt: undefined,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
      falRecoverable: false,
      customRecoverable: false,
    })
    void deleteUnreferencedImageIds(partialImageIdsToClean)

    // 完全失败（编排批处理返回 error）时用 toast 反馈即可：任务卡片自身已显示失败状态
    // （红色标识 + 重试按钮），需要详情时用户可自行点击卡片，不强制弹出详情弹窗打断操作。
    if (finalTaskStatus === 'error') {
      useStore.getState().showToast(`生成失败：${shortenTaskErrorMessage(result.error ?? '生成失败')}`, 'error')
    } else if (hasPartialFailure) {
      const failCount = result.batchItemErrors!.length
      const totalCount = result.batchItemStatuses!.length
      useStore.getState().showToast(`生成完成，${totalCount - failCount}/${totalCount} 张成功`, 'info')
      if (!isAgentTask(task))
        showTaskCompletionNotification(
          '图像生成完成',
          `生成完成，${totalCount - failCount}/${totalCount} 张成功，${failCount} 张失败。`,
        )
    } else {
      useStore.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
      if (!isAgentTask(task))
        showTaskCompletionNotification('图像生成完成', `生成完成，共 ${outputIds.length} 张图片。`)
    }
    if (n > 1) {
      void saveTaskMetaToLocalFS(task.id)
    } else {
      void saveTaskToLocalFS(task.id)
    }
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    clearOpenAIWatchdogTimer(taskId)
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId) ?? task
    if (latestTask.status !== 'running') return
    // 任务被用户停止：不当作失败处理，直接收敛为"已停止"（保留已生成的图片）
    if (err instanceof DOMException && err.name === 'AbortError') {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '任务已停止',
        progressStage: 'stopped',
        progressUpdatedAt: Date.now(),
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      useRuntimeStore.getState().setTaskStreamPreview(taskId)
      useStore.getState().showToast('任务已停止', 'info')
      return
    }
    useRuntimeStore.getState().setTaskStreamPreview(taskId)
    const latestFalRequestInfo =
      falRequestInfo ??
      (latestTask.falRequestId && latestTask.falEndpoint
        ? { requestId: latestTask.falRequestId, endpoint: latestTask.falEndpoint }
        : null)
    const latestCustomTaskInfo =
      customTaskInfo ?? (latestTask.customTaskId ? { taskId: latestTask.customTaskId } : null)
    if (latestTask.apiProvider === 'fal' && latestFalRequestInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
        progressStage: 'recovering',
        progressUpdatedAt: Date.now(),
        falRequestId: latestFalRequestInfo.requestId,
        falEndpoint: latestFalRequestInfo.endpoint,
        falRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleFalRecovery(taskId)
    } else if (latestCustomTaskInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与自定义异步任务的连接已断开，之后会继续查询任务结果。',
        progressStage: 'recovering',
        progressUpdatedAt: Date.now(),
        customTaskId: latestCustomTaskInfo.taskId,
        customRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleCustomRecovery(taskId)
    } else {
      let errorMessage = err instanceof Error ? err.message : String(err)
      const settings = useStore.getState().settings
      const profile = getTaskApiProfile(settings, latestTask)
      const usesApiProxy = profile?.apiProxy ?? settings.apiProxy
      const activeProfile = getActiveApiProfile(settings)
      const hintProfile = profile ?? {
        provider: latestTask.apiProvider ?? activeProfile.provider,
        apiMode: settings.apiMode,
        streamImages: activeProfile.streamImages,
        streamPartialImages: activeProfile.streamPartialImages,
      }
      const networkErrorHint = getApiRequestNetworkErrorHint(
        err,
        latestTask.createdAt,
        usesApiProxy,
        hintProfile,
        (latestTask.inputImageIds?.length ?? 0) > 0,
      )
      if (networkErrorHint && !errorMessage.includes(IMAGE_FETCH_CORS_HINT)) {
        errorMessage += `\n${networkErrorHint}`
      }
      const streamingHint = getStreamingErrorHint(err, hintProfile)
      if (streamingHint && !errorMessage.includes(streamingHint)) {
        errorMessage += streamingHint
      }
      const existingOutputImages = latestTask.outputImages || []
      if (existingOutputImages.length > 0) {
        const totalRequested = latestTask.params?.n ?? 1
        const successCount = existingOutputImages.length
        const batchItemStatuses: BatchItemStatus[] = Array.from({ length: totalRequested }, (_, i) =>
          i < successCount ? 'done' : 'error',
        )
        const batchItemErrors: BatchItemError[] = Array.from(
          { length: Math.max(0, totalRequested - successCount) },
          (_, i) => ({ index: successCount + i, error: errorMessage }),
        )
        updateTaskInStore(taskId, {
          status: 'done',
          error: undefined,
          progressStage: 'partial-failure',
          progressUpdatedAt: Date.now(),
          batchItemStatuses,
          batchItemErrors: batchItemErrors.length > 0 ? batchItemErrors : undefined,
          streamPartialImageIds: undefined,
          falRecoverable: false,
          customRecoverable: false,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        })
        const totalCount = batchItemStatuses.length
        useStore.getState().showToast(`生成异常，${successCount}/${totalCount} 张成功`, 'info')
      } else {
        updateTaskInStore(taskId, {
          status: 'error',
          error: errorMessage,
          progressStage: 'failed',
          progressUpdatedAt: Date.now(),
          ...getRawErrorPayload(err),
          falRecoverable: false,
          customRecoverable: false,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        })
        // 完全失败用 toast 反馈（3 秒自动消失）；失败详情与重试入口在任务卡片上可见，
        // 用户需要时点击卡片自行查看，不强制弹出详情弹窗。
        useStore.getState().showToast(`生成失败：${shortenTaskErrorMessage(errorMessage)}`, 'error')
      }
    }
  } finally {
    // 释放任务级取消控制器与输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    taskAbortControllers.delete(taskId)
    for (const imgId of task.inputImageIds) {
      imageCache.delete(imgId)
    }
  }
}

function normalizeFavoritePatch(
  task: TaskRecord,
  patch: Partial<TaskRecord>,
  defaultFavoriteCollectionId: string | null,
): Partial<TaskRecord> {
  if ('favoriteCollectionIds' in patch) {
    const ids = normalizeFavoriteCollectionIds(patch.favoriteCollectionIds)
    return { ...patch, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
  }
  if ('isFavorite' in patch) {
    if (patch.isFavorite) {
      const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds)
      return {
        ...patch,
        favoriteCollectionIds: ids.length ? ids : defaultFavoriteCollectionId ? [defaultFavoriteCollectionId] : [],
      }
    }
    return { ...patch, favoriteCollectionIds: [] }
  }
  return patch
}

// ===== 任务瞬态字段写盘合并 =====
// progressStage/progressMessage/progressUpdatedAt/streamPartialImageIds 在生成期间高频更新
// （每次进度 tick / 每帧流式 partial）。这些字段的写盘合并到 300ms 窗口内一次完成，
// 避免单次生成 10~30+ 次整任务重写 IndexedDB；非瞬态字段（status/outputImages/error 等）
// 仍立即写盘，保持既有语义。
const TRANSIENT_TASK_FIELDS = new Set([
  'progressStage',
  'progressMessage',
  'progressUpdatedAt',
  'streamPartialImageIds',
])

const transientPersistPending = new Set<string>()
let transientPersistTimer: ReturnType<typeof setTimeout> | null = null
let transientPersistRunning = false
let transientPersistQueued = false

function isTransientTaskPatch(patch: Partial<TaskRecord>): boolean {
  const keys = Object.keys(patch)
  return keys.length > 0 && keys.every((key) => TRANSIENT_TASK_FIELDS.has(key))
}

async function flushTransientTaskPersists() {
  if (transientPersistRunning) {
    transientPersistQueued = true
    return
  }
  transientPersistRunning = true
  try {
    do {
      transientPersistQueued = false
      const pending = [...transientPersistPending]
      transientPersistPending.clear()
      if (pending.length > 0) {
        // 写盘时读取当前内存状态（已包含期间所有 patch）；任务已被删除则跳过。
        const tasksById = new Map(useStore.getState().tasks.map((task) => [task.id, task]))
        await Promise.all(
          pending.map((taskId) => {
            const task = tasksById.get(taskId)
            return task ? persistTaskWithRetry(task) : Promise.resolve()
          }),
        )
      }
    } while (transientPersistQueued || transientPersistPending.size > 0)
  } finally {
    transientPersistRunning = false
  }
}

function scheduleTransientTaskPersist(taskId: string) {
  transientPersistPending.add(taskId)
  if (transientPersistTimer) clearTimeout(transientPersistTimer)
  transientPersistTimer = setTimeout(() => {
    transientPersistTimer = null
    void flushTransientTaskPersists()
  }, 300)
}

// 关闭/刷新前尽力落盘防抖窗口内的瞬态更新。
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (transientPersistTimer) {
      clearTimeout(transientPersistTimer)
      transientPersistTimer = null
    }
    void flushTransientTaskPersists()
  })
}

export function updateTaskInStore(
  taskId: string,
  patch: Partial<TaskRecord>,
  expected?: (task: TaskRecord) => boolean,
): Promise<void> {
  const { tasks, defaultFavoriteCollectionId, workspaceTabs } = useStore.getState()
  const current = tasks.find((t) => t.id === taskId)
  if (!current) return Promise.resolve()
  // 前置状态条件：避免 await 之后迟到的成功/恢复结果覆盖已被停止或删除的任务。
  if (expected && !expected(current)) return Promise.resolve()

  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...normalizeFavoritePatch(t, patch, defaultFavoriteCollectionId) } : t,
  )
  const task = updated.find((t) => t.id === taskId)
  let tabsChanged = false
  const updatedTabs = workspaceTabs.map((tab) => {
    const taskIndex = tab.tasks.findIndex((tabTask) => tabTask.id === taskId)
    if (taskIndex < 0) return tab
    tabsChanged = true

    const nextTasks = [...tab.tasks]
    const tabTask = nextTasks[taskIndex]
    nextTasks[taskIndex] = {
      ...tabTask,
      ...normalizeFavoritePatch(tabTask, patch, defaultFavoriteCollectionId),
    }
    return { ...tab, tasks: nextTasks }
  })

  useStore.setState({
    tasks: updated,
    // 任务不属于任何 tab 时保持 workspaceTabs 数组身份不变，避免订阅者无谓重渲染。
    workspaceTabs: tabsChanged ? updatedTabs : workspaceTabs,
  })

  // 任务变为不可恢复（完成 / 显式关闭恢复）时统一清理恢复定时器与 watchdog，
  // 覆盖所有停止、失败、删除之外的终态路径。
  if (task && (task.status === 'done' || task.falRecoverable === false || task.customRecoverable === false)) {
    clearFalRecoveryTimer(taskId)
    clearCustomRecoveryTimer(taskId)
    clearOpenAIWatchdogTimer(taskId)
  }
  // 任务终态（done）时清理运行时进度，避免 taskProgress 记录泄漏。
  if (task?.status === 'done') {
    useRuntimeStore.getState().clearTaskProgress(taskId)
  }
  if (!task) return Promise.resolve()
  if (isTransientTaskPatch(patch)) {
    scheduleTransientTaskPersist(taskId)
    return Promise.resolve()
  }
  return persistTaskWithRetry(task)
}

function updateTaskProgress(taskId: string, progressStage: TaskProgressStage, progressMessage?: string) {
  // 高频瞬态进度只写 runtimeStore：不重建 tasks 数组、不触发 s.tasks 订阅者重渲染、不写 IndexedDB。
  useRuntimeStore.getState().setTaskProgress(taskId, {
    progressStage,
    ...(progressMessage ? { progressMessage } : {}),
    progressUpdatedAt: Date.now(),
  })
}

function normalizeFavoriteCollectionIds(ids: unknown) {
  if (!Array.isArray(ids)) return []
  return Array.from(new Set(ids.map(String).filter((id) => id && id !== ALL_FAVORITES_COLLECTION_ID)))
}

function sameFavoriteCollectionIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

export function getTaskFavoriteCollectionIds(task: TaskRecord) {
  const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds)
  if (ids.length > 0) return ids
  const defaultFavoriteCollectionId = useStore.getState().defaultFavoriteCollectionId
  return task.isFavorite && defaultFavoriteCollectionId ? [defaultFavoriteCollectionId] : []
}

function normalizeTaskFavoriteState(task: TaskRecord, collections: FavoriteCollection[]): TaskRecord {
  const collectionIdSet = new Set(collections.map((collection) => collection.id))
  const normalizedIds = normalizeFavoriteCollectionIds(task.favoriteCollectionIds).filter((id) =>
    collectionIdSet.has(id),
  )
  // 旧版本只有 isFavorite 没有 favoriteCollectionIds，迁移到"默认"收藏夹
  const defaultId = getDefaultNamedFavoriteCollectionId(collections)
  const ids = normalizedIds.length > 0 ? normalizedIds : task.isFavorite && defaultId ? [defaultId] : []
  const isFavorite = ids.length > 0 || Boolean(task.isFavorite)
  if (
    ids.length === (task.favoriteCollectionIds ?? []).length &&
    ids.every((id, index) => id === task.favoriteCollectionIds?.[index]) &&
    Boolean(task.isFavorite) === isFavorite
  ) {
    return task
  }
  return { ...task, favoriteCollectionIds: ids, isFavorite }
}

function normalizeLoadedFavoriteState(
  tasks: TaskRecord[],
  collections: FavoriteCollection[],
  preferredDefaultFavoriteCollectionId: string | null,
) {
  let changed = false
  // 确保"默认"收藏夹存在，给孤立收藏任务一个归属
  const normalizedCollections = ensureDefaultNamedCollection(
    ensureDefaultFavoriteCollection(normalizeFavoriteCollections(collections)),
  )
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(
    normalizedCollections,
    preferredDefaultFavoriteCollectionId,
  )
  const normalizedTasks = tasks.map((task) => {
    const nextTask = normalizeTaskFavoriteState(task, normalizedCollections)
    if (nextTask !== task) changed = true
    return nextTask
  })
  return { tasks: normalizedTasks, collections: normalizedCollections, defaultFavoriteCollectionId, changed }
}

export function getFavoriteCollectionTitle(
  collectionId: string | null,
  collections = useStore.getState().favoriteCollections,
) {
  if (collectionId === ALL_FAVORITES_COLLECTION_ID) return '全部'
  return collections.find((collection) => collection.id === collectionId)?.name ?? DEFAULT_FAVORITE_COLLECTION_NAME
}

export function createFavoriteCollection(name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName) return null
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('收藏夹名称最多 60 个字符', 'error')
    return null
  }
  const state = useStore.getState()
  const existing = state.favoriteCollections.find((collection) => collection.name === normalizedName)
  if (existing) return existing
  const now = Date.now()
  const collection: FavoriteCollection = { id: genId(), name: normalizedName, createdAt: now, updatedAt: now }
  state.setFavoriteCollections([...state.favoriteCollections, collection])
  state.showToast(`已创建收藏夹「${normalizedName}」`, 'success')
  return collection
}

export function renameFavoriteCollection(collectionId: string, name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('收藏夹名称最多 60 个字符', 'error')
    return
  }
  const { favoriteCollections, setFavoriteCollections, showToast } = useStore.getState()
  setFavoriteCollections(
    favoriteCollections.map((collection) =>
      collection.id === collectionId ? { ...collection, name: normalizedName, updatedAt: Date.now() } : collection,
    ),
  )
  showToast('收藏夹名称已更新', 'success')
}

export async function updateTasksFavoriteCollections(taskIds: string[], collectionIds: string[]) {
  const ids = normalizeFavoriteCollectionIds(collectionIds)
  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean)
  if (!uniqueTaskIds.length) return
  const { tasks, workspaceTabs, setTasks, clearSelection, showToast } = useStore.getState()
  const idSet = new Set(uniqueTaskIds)
  const changedTaskIds = new Set<string>()
  const newFavoriteTasks: TaskRecord[] = []

  const updated = tasks.map((task) => {
    if (!idSet.has(task.id)) return task
    if (sameFavoriteCollectionIds(getTaskFavoriteCollectionIds(task), ids)) return task

    const isFavorite = ids.length > 0
    if (isFavorite && !task.isFavorite) {
      // 收藏时复制一份作为收藏卡片，只保留第一张图
      const duplicateTask: TaskRecord = {
        ...task,
        id: genId(),
        outputImages: task.outputImages?.length > 0 ? [task.outputImages[0]] : [],
        favoriteCollectionIds: ids,
        isFavorite: true,
        error: null,
        status: 'done' as const,
        elapsed: null,
        progressStage: undefined,
        progressMessage: undefined,
        progressUpdatedAt: undefined,
        batchItemStatuses: undefined,
        batchItemErrors: undefined,
        rawResponsePayload: undefined,
        falRequestId: undefined,
        falEndpoint: undefined,
        falRecoverable: undefined,
        customTaskId: undefined,
        customRecoverable: undefined,
        // 清理输出地址参数，保留提示词
        favoriteOutputPath: undefined,
        favoriteOutputUseDateVariable: undefined,
        scheduledOutputPath: undefined,
        scheduledOutputSubFolder: undefined,
        localSaveBatchFolder: undefined,
      }
      newFavoriteTasks.push(duplicateTask)
      return task // 原任务卡不会被改变
    }

    changedTaskIds.add(task.id)
    return { ...task, favoriteCollectionIds: ids, isFavorite }
  })

  if (!changedTaskIds.size && !newFavoriteTasks.length) {
    clearSelection()
    return
  }

  const finalTasks = [...updated, ...newFavoriteTasks]
  setTasks(finalTasks)

  const duplicateSourceMap = new Map<string, string>()
  for (let i = 0; i < updated.length; i++) {
    if (newFavoriteTasks.length > 0 && newFavoriteTasks[newFavoriteTasks.length - 1].id !== undefined) {
      // Find matching duplicate source
      const dup = newFavoriteTasks.find(
        (d) =>
          d.createdAt === updated[i].createdAt &&
          d.prompt === updated[i].prompt &&
          d.apiProfileId === updated[i].apiProfileId,
      )
      if (dup) {
        duplicateSourceMap.set(dup.id, updated[i].id)
      }
    }
  }

  const updatedTaskById = new Map(
    finalTasks.filter((task) => changedTaskIds.has(task.id)).map((task) => [task.id, task]),
  )
  useStore.setState({
    workspaceTabs: workspaceTabs.map((tab) => {
      const newTasks: TaskRecord[] = []
      for (const task of tab.tasks) {
        newTasks.push(updatedTaskById.get(task.id) ?? task)
        // 注意：不将 newFavoriteTasks 添加到 workspaceTabs 中，这样生图窗口就不会显示复制的收藏卡片
      }
      return { ...tab, tasks: newTasks }
    }),
  })

  const tasksToPut = [...finalTasks.filter((task) => changedTaskIds.has(task.id)), ...newFavoriteTasks]
  await putTasks(tasksToPut)

  clearSelection()
  showToast(ids.length ? '收藏夹已更新' : '已取消收藏', 'success')
}

export async function updateTaskPrompt(taskId: string, newPrompt: string) {
  const { tasks, workspaceTabs, setTasks } = useStore.getState()
  const updatedTasks = tasks.map((t) => (t.id === taskId ? { ...t, prompt: newPrompt } : t))
  setTasks(updatedTasks)
  useStore.setState({
    workspaceTabs: workspaceTabs.map((tab) => ({
      ...tab,
      tasks: tab.tasks.map((t) => (t.id === taskId ? { ...t, prompt: newPrompt } : t)),
    })),
  })
  const task = updatedTasks.find((t) => t.id === taskId)
  if (task) {
    await dbPutTask(task)
  }
}

export async function updateTaskParams(taskId: string, params: Partial<TaskParams>) {
  const { tasks, workspaceTabs, setTasks } = useStore.getState()
  const updatedTasks = tasks.map((t) => (t.id === taskId ? { ...t, params: { ...t.params, ...params } } : t))
  setTasks(updatedTasks)
  useStore.setState({
    workspaceTabs: workspaceTabs.map((tab) => ({
      ...tab,
      tasks: tab.tasks.map((t) => (t.id === taskId ? { ...t, params: { ...t.params, ...params } } : t)),
    })),
  })
  const task = updatedTasks.find((t) => t.id === taskId)
  if (task) {
    await dbPutTask(task)
  }
}

export async function deleteFavoriteCollection(collectionId: string, deleteTasks = false) {
  if (!collectionId || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  const state = useStore.getState()
  const collection = state.favoriteCollections.find((item) => item.id === collectionId)
  if (!collection || state.favoriteCollections.length <= 1) return
  const collectionTaskRefs = state.tasks
    .map((task) => ({ task, favoriteIds: getTaskFavoriteCollectionIds(task) }))
    .filter(({ favoriteIds }) => favoriteIds.includes(collectionId))
  const taskIds = collectionTaskRefs.map(({ task }) => task.id)
  const nextCollections = state.favoriteCollections.filter((item) => item.id !== collectionId)
  const nextCollectionIdSet = new Set(nextCollections.map((item) => item.id))
  state.setFavoriteCollections(nextCollections)
  if (state.defaultFavoriteCollectionId === collectionId) {
    const nextDefaultId = nextCollections[0]?.id
    if (nextDefaultId) useStore.getState().setDefaultFavoriteCollectionId(nextDefaultId)
  }
  if (state.activeFavoriteCollectionId === collectionId) state.setActiveFavoriteCollectionId(null)
  if (deleteTasks) {
    const idsByTaskToKeep = new Map<string, string[]>()
    const taskIdsToDelete: string[] = []
    for (const { task, favoriteIds } of collectionTaskRefs) {
      const nextIds = favoriteIds.filter((id) => id !== collectionId && nextCollectionIdSet.has(id))
      if (nextIds.length) {
        idsByTaskToKeep.set(task.id, nextIds)
      } else {
        taskIdsToDelete.push(task.id)
      }
    }
    if (idsByTaskToKeep.size) {
      const latestTasks = useStore.getState().tasks
      const updated = latestTasks.map((task) => {
        const ids = idsByTaskToKeep.get(task.id)
        return ids ? { ...task, favoriteCollectionIds: ids, isFavorite: true } : task
      })
      useStore.getState().setTasks(updated)
      await putTasks(updated.filter((task) => idsByTaskToKeep.has(task.id)))
    }
    if (taskIdsToDelete.length) await removeMultipleTasks(taskIdsToDelete)
  } else if (taskIds.length) {
    const idsByTaskId = new Map(
      collectionTaskRefs.map(({ task, favoriteIds }) => [
        task.id,
        favoriteIds.filter((id) => id !== collectionId && nextCollectionIdSet.has(id)),
      ]),
    )
    const updated = state.tasks.map((task) => {
      const ids = idsByTaskId.get(task.id)
      if (!ids) return task
      return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
    })
    state.setTasks(updated)
    await putTasks(updated.filter((task) => idsByTaskId.has(task.id)))
  }
  useStore.getState().setSelectedFavoriteCollectionIds((ids) => ids.filter((id) => id !== collectionId))
  useStore.getState().showToast(`已删除收藏夹「${collection.name}」`, 'success')
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(
  task: TaskRecord,
  options: { sopBatch?: TaskRecord['sopBatch'] } = {},
): Promise<string | null> {
  // 「写提示词」环节的失败不能直接重试：这种卡身上没有可用提示词（存的是来源标签占位），
  // 硬重试等于拿着占位文案去生图。重试要回发起它的地方（SOP 弹窗 / 输入栏），
  // 那里才有参考图、SOP 预设和 brief。
  if (task.promptPending || task.promptFailed) {
    useStore
      .getState()
      .showToast(
        task.promptPending ? '这条任务还在写提示词，请稍候' : '这条失败在「编写提示词」环节，请回到发起它的地方重试',
        'error',
      )
    return null
  }
  let createdTaskId: string | null = null
  try {
    const { settings, workspaceTabs, activeWorkspaceTabId } = useStore.getState()
    const activeProfile = getActiveApiProfile(settings)
    const normalizedParams = normalizeParamsForSettings(task.params, settings, {
      hasInputImages: task.inputImageIds.length > 0,
    })
    const sourceTabId = workspaceTabs.find((t) => t.tasks.some((rt) => rt.id === task.id))?.id
    const tabIdToUpdate = resolveTaskTabId(
      workspaceTabs,
      sourceTabId ?? activeWorkspaceTabId ?? workspaceTabs[0]?.id ?? null,
    )
    const createdAt = Date.now()
    const taskId = genId()
    createdTaskId = taskId
    const sopBatch = options.sopBatch ?? (task.sopBatch ? { ...task.sopBatch } : undefined)
    // 系列图单张重试沿用同组批次号：新图仍归入原组（组内顺号自动续号）而不是另起一组；
    // 「重新生成」整批会带新的 batchId，因此不会命中旧任务
    const { filenameBatch, localSaveBatchFolder } = resolveTaskGeneratedImageNaming(createdAt, tabIdToUpdate, sopBatch)
    const newTask: TaskRecord = {
      id: taskId,
      prompt: task.prompt,
      sopBatch,
      params: normalizedParams,
      apiProvider: activeProfile.provider,
      apiProfileId: activeProfile.id,
      apiProfileName: activeProfile.name,
      apiMode: activeProfile.apiMode,
      apiModel: activeProfile.model,
      inputImageIds: [...task.inputImageIds],
      inputImageFolderPath: task.inputImageFolderPath,
      maskTargetImageId: task.maskTargetImageId ?? null,
      maskImageId: task.maskImageId ?? null,
      outputImages: [],
      filenameBatch,
      status: 'running',
      error: null,
      createdAt,
      finishedAt: null,
      elapsed: null,
      defaultCollectionId: task.defaultCollectionId,
      localSaveBatchFolder,
    }

    const latestTasks = useStore.getState().tasks
    useStore.getState().setTasks([newTask, ...latestTasks])

    // 查找原任务所在的标签页，或者使用当前激活的标签页
    if (tabIdToUpdate) {
      useStore.setState((state) => ({
        workspaceTabs: state.workspaceTabs.map((t) =>
          t.id === tabIdToUpdate ? { ...t, tasks: [newTask, ...t.tasks] } : t,
        ),
      }))
    } else {
      // 兜底：如果没有激活的标签页，尝试加到第一个标签页
      useStore.setState((state) => {
        if (state.workspaceTabs.length === 0) return state
        const firstTabId = state.workspaceTabs[0].id
        return {
          workspaceTabs: state.workspaceTabs.map((t) =>
            t.id === firstTabId ? { ...t, tasks: [newTask, ...t.tasks] } : t,
          ),
        }
      })
    }

    await putTask(newTask)

    void executeTask(taskId)
    return taskId
  } catch (error) {
    if (createdTaskId) {
      taskAbortControllers.get(createdTaskId)?.abort()
      taskAbortControllers.delete(createdTaskId)
      useStore.setState((state) => ({
        tasks: state.tasks.filter((item) => item.id !== createdTaskId),
        workspaceTabs: state.workspaceTabs.map((tab) => ({
          ...tab,
          tasks: tab.tasks.filter((item) => item.id !== createdTaskId),
        })),
      }))
    }
    console.error('任务重试失败:', error)
    useStore.getState().showToast('任务重试失败，请重试', 'error')
    return null
  }
}

export async function rerunSopBatchTasks(tasks: TaskRecord[]) {
  try {
    const batchTasks = tasks.filter((task) => task.sopBatch)
    if (!batchTasks.length) return
    const firstMeta = batchTasks[0].sopBatch!
    const batchId = `sop-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    let snapshotId: string | undefined
    if (firstMeta.snapshotId) {
      const previousSnapshot = await getSopBatchSnapshot(firstMeta.snapshotId)
      if (previousSnapshot) {
        snapshotId = `sop-snapshot-${batchId}`
        await putSopBatchSnapshot({
          ...previousSnapshot,
          id: snapshotId,
          batchId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'generating',
          batchIds: [batchId],
          taskIds: [],
          prompts: previousSnapshot.prompts.map((prompt) => ({ ...prompt })),
          referenceImageIds: [...previousSnapshot.referenceImageIds],
          params: { ...previousSnapshot.params },
          sop: { ...previousSnapshot.sop },
        })
      }
    }
    const createdTaskIds = (
      await Promise.all(
        batchTasks.map((task) =>
          retryTask(task, {
            sopBatch: {
              ...task.sopBatch!,
              batchId,
              snapshotId,
            },
          }),
        ),
      )
    ).filter((taskId): taskId is string => Boolean(taskId))
    if (snapshotId) {
      const snapshot = await getSopBatchSnapshot(snapshotId)
      if (snapshot) {
        await putSopBatchSnapshot({
          ...snapshot,
          taskIds: createdTaskIds,
          status: createdTaskIds.length > 0 ? 'submitted' : 'failed',
          updatedAt: Date.now(),
        })
      }
    }
    if (createdTaskIds.length === 0) {
      useStore.getState().showToast('SOP 批次重新生成失败，没有创建新任务', 'error')
      return
    }
    const failedCount = batchTasks.length - createdTaskIds.length
    useStore
      .getState()
      .showToast(
        failedCount > 0
          ? `SOP 批次部分创建成功：${createdTaskIds.length} 条成功，${failedCount} 条失败`
          : `已创建新的 SOP 批次，共 ${createdTaskIds.length} 条提示词`,
        failedCount > 0 ? 'info' : 'success',
      )
  } catch (error) {
    console.error('SOP 批次重新生成失败:', error)
    useStore.getState().showToast('SOP 批次重新生成失败', 'error')
  }
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const {
    settings,
    setPrompt,
    setParams,
    setInputImages,
    setInputImageFolder,
    setMaskDraft,
    clearMaskDraft,
    showToast,
    setConfirmDialog,
    setReusedTaskApiProfile,
    setCustomOutputPath,
  } = useStore.getState()
  const normalizedSettings = normalizeSettings(settings)
  const currentProfile = getActiveApiProfile(settings)
  const matchedProfile = normalizedSettings.reuseTaskApiProfileTemporarily
    ? getTaskApiProfile(normalizedSettings, task)
    : null
  const shouldTemporarilyReuseProfile = Boolean(matchedProfile && matchedProfile.id !== currentProfile.id)
  const missingReusedProfile = normalizedSettings.reuseTaskApiProfileTemporarily && !matchedProfile
  const taskProfileName = matchedProfile?.name ?? getTaskApiProfileName(task)

  setParams(task.params)
  setReusedTaskApiProfile(
    shouldTemporarilyReuseProfile && matchedProfile ? matchedProfile.id : null,
    missingReusedProfile,
    taskProfileName,
  )
  clearMaskDraft()

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }

  if (task.inputImageFolderPath) {
    setInputImageFolder({ path: task.inputImageFolderPath, imageIds: imgs.map((img) => img.id) })
  } else {
    setInputImages(imgs)
  }

  setPrompt(task.prompt)
  // 恢复输出地址
  if (task.scheduledOutputPath) {
    setCustomOutputPath(task.scheduledOutputPath)
  } else {
    setCustomOutputPath('')
  }
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageCached(task.maskImageId)
    if (maskDataUrl) {
      setMaskDraft({
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
    } else {
      clearMaskDraft()
    }
  } else {
    clearMaskDraft()
  }
  if (missingReusedProfile) {
    setConfirmDialog({
      title: '找不到 API 配置',
      message: `找不到复用任务所使用的 API 配置「${taskProfileName}」，要使用当前的 API 配置「${currentProfile.name}」提交任务吗？`,
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
      action: () => {
        void submitTask({ useCurrentApiProfileWhenReusedMissing: true })
      },
    })
    return
  }

  showToast(
    shouldTemporarilyReuseProfile && matchedProfile
      ? `已临时复用该任务的 API 配置「${matchedProfile.name}」`
      : '已复用配置到输入框',
    'success',
  )
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 将任务从当前标签移动到另一个标签 */
export function moveTasksToWorkspaceTab(taskIds: string[], targetTabId: string, sourceTabId?: string): boolean {
  const state = useStore.getState()
  const targetTab = state.workspaceTabs.find((tab) => tab.id === targetTabId)
  const sourceTab = sourceTabId ? state.workspaceTabs.find((tab) => tab.id === sourceTabId) : null

  if (!targetTab) {
    state.showToast('目标标签不存在', 'error')
    return false
  }

  if (sourceTabId && !sourceTab) {
    state.showToast('当前标签不存在', 'error')
    return false
  }

  if (sourceTabId === targetTabId) {
    state.showToast('所选任务已在该标签中', 'info')
    return false
  }

  const selectedIds = new Set(taskIds.filter(Boolean))
  const movableIds = new Set(
    sourceTab
      ? sourceTab.tasks.filter((task) => selectedIds.has(task.id)).map((task) => task.id)
      : state.workspaceTabs
          .filter((tab) => tab.id !== targetTabId)
          .flatMap((tab) => tab.tasks)
          .filter((task) => selectedIds.has(task.id))
          .map((task) => task.id),
  )

  if (movableIds.size === 0) {
    state.showToast('所选任务已在该标签中', 'info')
    return false
  }

  const taskById = new Map(state.tasks.map((task) => [task.id, task]))
  for (const tab of state.workspaceTabs) {
    for (const task of tab.tasks) {
      if (!taskById.has(task.id)) taskById.set(task.id, task)
    }
  }
  const movingTasks = [...movableIds]
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is TaskRecord => Boolean(task))

  if (movingTasks.length === 0) {
    state.showToast('未找到可移动的任务', 'info')
    return false
  }

  const now = Date.now()
  const targetTaskIds = new Set(targetTab.tasks.map((task) => task.id))
  const updatedTabs = state.workspaceTabs.map((tab) => {
    if (tab.id === targetTabId) {
      const additions = movingTasks.filter((task) => !targetTaskIds.has(task.id))
      return {
        ...tab,
        tasks: [...additions, ...tab.tasks],
        updatedAt: now,
      }
    }

    if (sourceTabId && tab.id !== sourceTabId) return tab
    const remainingTasks = tab.tasks.filter((task) => !movableIds.has(task.id))
    return remainingTasks.length === tab.tasks.length ? tab : { ...tab, tasks: remainingTasks, updatedAt: now }
  })

  useStore.setState({
    workspaceTabs: updatedTabs,
    selectedTaskIds: [],
  })
  state.showToast(`已将 ${movingTasks.length} 个任务移动到「${targetTab.name}」`, 'success')
  return true
}

/** 删除多条任务 */
/**
 * 删除任务时连同其生成的素材图片一起永久删除：
 * 按任务输出图片找到对应素材，走统一的永久删除计划（引用冲突安全——
 * 被其他任务输入 / Agent 会话等拥有型引用的图片保留，**不自动改动任何数据**，
 * 不回收到站、不强制解除引用）。
 * 返回 { purged: 已永久删除图片数, kept: 因被引用而保留的图片数 }。
 */
async function purgeTaskOutputAssets(
  deletedTasks: TaskRecord[],
  graph: ImageReferenceGraph,
): Promise<{ purged: number; kept: number }> {
  const outputImageIds = new Set<string>()
  for (const t of deletedTasks) {
    for (const id of t.outputImages ?? []) {
      if (id) outputImageIds.add(id)
    }
  }
  if (outputImageIds.size === 0) return { purged: 0, kept: 0 }

  // 桌面端素材权威存储是 SQLite，必须走 getAssetsByImageIds（Electron 下走 SQLite、
  // 浏览器下才回退 IndexedDB）；不能再用 db 层的 batchGetGeneratedAssetsByImageIds（只查 IndexedDB），
  // 否则 Electron 下查不到素材，删除任务时图片不会被一起删除。
  const assetsByImage = await getAssetsByImageIds([...outputImageIds])
  const assets = [...assetsByImage.values()]
  if (assets.length === 0) return { purged: 0, kept: 0 }

  const plan = planAssetPurge({
    assetIds: assets.map((asset) => asset.id),
    assets,
    tasks: useStore.getState().tasks,
    graph,
  })
  if (plan.allowedAssetIds.length > 0) {
    await purgeGeneratedAssets(
      assets.map((asset) => asset.id),
      {
        plan,
        reason: 'task-deleted',
      },
    )
  }
  return { purged: plan.allowedAssetIds.length, kept: plan.blocked.length }
}

/**
 * 收集任务本地导出文件路径（localSavedOutputImagePaths）。
 * - imageIdFilter：可选，仅收集指定原图 id 的导出文件（素材永久删除时按被删 imageId 筛选）。
 */
function collectLocalSavedOutputPaths(tasks: TaskRecord[], imageIdFilter?: (imageId: string) => boolean): string[] {
  const paths = new Set<string>()
  for (const task of tasks) {
    for (const [key, filePath] of Object.entries(task.localSavedOutputImagePaths ?? {})) {
      if (typeof filePath !== 'string' || !filePath.trim()) continue
      if (imageIdFilter) {
        // key 形如 "0:img-id"
        const imageId = key.slice(key.indexOf(':') + 1)
        if (!imageIdFilter(imageId)) continue
      }
      paths.add(filePath)
    }
  }
  return [...paths]
}

/** 删除指定任务的本地导出真实文件（任务删除/批量删除/失败清除时调用）。 */
async function deleteLocalSavedOutputFilesForTasks(tasks: TaskRecord[]): Promise<number> {
  if (tasks.length === 0) return 0
  const paths = collectLocalSavedOutputPaths(tasks)
  if (paths.length === 0) return 0
  const { deleteLocalImageFiles } = await import('./lib/localSave')
  return deleteLocalImageFiles(paths)
}

export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, showToast, selectedTaskIds, workspaceTabs } = useStore.getState()

  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const deletedTasks = tasks.filter((t) => toDelete.has(t.id))
  const remaining = await scrubAgentOutputPayloadsForDeletedTasks(
    deletedTasks,
    tasks.filter((t) => !toDelete.has(t.id)),
  )

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      addTaskReferencedImageIds(deletedImageIds, t)
    }
  }

  // 删除任务前先删除其本地导出文件（localSavedOutputImagePaths 里用户保存的真实文件），
  // 否则删除任务后这些磁盘文件无从追查。
  await deleteLocalSavedOutputFilesForTasks(deletedTasks)

  setTasks(remaining)
  // Remove from all workspace tabs
  const updatedTabs = workspaceTabs.map((tab) => ({
    ...tab,
    tasks: tab.tasks.filter((t) => !toDelete.has(t.id)),
  }))
  useStore.setState({ workspaceTabs: updatedTabs })
  for (const id of taskIds) {
    // 删除任务前清理恢复定时器/watchdog，避免在途恢复把图写进已删除任务（孤儿图片）。
    clearFalRecoveryTimer(id)
    clearCustomRecoveryTimer(id)
    clearOpenAIWatchdogTimer(id)
    useRuntimeStore.getState().clearTaskProgress(id)
    await dbDeleteTask(id)
  }

  // 统一引用图：素材（有效/回收站）持有输出原图引用，任务输出不会被误删
  const graph = await buildStoreImageReferenceGraph()
  for (const imgId of deletedImageIds) {
    if (isImageReferenced(graph, imgId)) continue
    await deleteImage(imgId)
    imageCache.delete(imgId)
    clearCachedThumbnail(imgId)
  }

  // 删除任务时连同其生成的素材图片一起永久删除（被其他任务/会话引用的图片安全保留，不自动改动数据）
  const { purged, kept } = await purgeTaskOutputAssets(deletedTasks, graph)

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter((id) => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  const summaryParts: string[] = []
  if (purged > 0) summaryParts.push(`含 ${purged} 张生成图片`)
  if (kept > 0) summaryParts.push(`${kept} 张被其他任务/会话引用，已保留`)
  showToast(
    summaryParts.length > 0
      ? `已删除 ${taskIds.length} 个任务（${summaryParts.join('；')}）`
      : `已删除 ${taskIds.length} 个任务`,
    'success',
  )
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, showToast, workspaceTabs } = useStore.getState()

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
    ...(task.streamPartialImageIds || []),
  ])

  // 从列表移除
  const remaining = await scrubAgentOutputPayloadsForDeletedTasks(
    [task],
    tasks.filter((t) => t.id !== task.id),
  )
  setTasks(remaining)
  // Remove from all workspace tabs
  const updatedTabs = workspaceTabs.map((tab) => ({
    ...tab,
    tasks: tab.tasks.filter((t) => t.id !== task.id),
  }))
  useStore.setState({ workspaceTabs: updatedTabs })
  clearFalRecoveryTimer(task.id)
  clearCustomRecoveryTimer(task.id)
  clearOpenAIWatchdogTimer(task.id)
  useRuntimeStore.getState().clearTaskProgress(task.id)
  await dbDeleteTask(task.id)

  // 删除任务前先删除其本地导出文件（localSavedOutputImagePaths 里用户保存的真实文件）
  await deleteLocalSavedOutputFilesForTasks([task])

  // 统一引用图：素材持有输出原图引用，删除任务不会误删素材原图
  const graph = await buildStoreImageReferenceGraph()
  for (const imgId of taskImageIds) {
    if (isImageReferenced(graph, imgId)) continue
    await deleteImage(imgId)
    imageCache.delete(imgId)
    clearCachedThumbnail(imgId)
  }

  // 删除任务时连同其生成的素材图片一起永久删除（被其他任务/会话引用的图片安全保留，不自动改动数据）
  const { purged, kept } = await purgeTaskOutputAssets([task], graph)

  const summaryParts: string[] = []
  if (purged > 0) summaryParts.push(`含 ${purged} 张生成图片`)
  if (kept > 0) summaryParts.push(`${kept} 张被其他任务/会话引用，已保留`)
  showToast(summaryParts.length > 0 ? `已删除任务（${summaryParts.join('；')}）` : '已删除任务', 'success')
}

/** 清空数据选项 */
export interface ClearOptions {
  clearConfig?: boolean
  clearTasks?: boolean
}

/** 清空数据 */
export async function clearData(options: ClearOptions = { clearConfig: true, clearTasks: true }) {
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()

  if (options.clearTasks) {
    await dbClearTasks()
    await dbClearAgentConversations()
    await clearSopBatchSnapshots()
    // 清空数据时同步删除所有任务的本地导出真实文件（localSavedOutputImagePaths）
    await deleteLocalSavedOutputFilesForTasks(useStore.getState().tasks)
    await clearImages()
    await Promise.all([
      clearGeneratedAssets(),
      clearAssetCollections(),
      clearAssetTags(),
      clearAssetTombstones(),
      clearAssetUsageEvents(),
      clearAssetBlobs(),
      clearAssetVersions(),
    ])
    await window.electronAPI?.assetCatalogClear?.()
    imageCache.clear()
    thumbnailCache.clear()
    falRecoveryTimers.clear()
    customRecoveryTimers.clear()
    openAIWatchdogTimers.clear()
    falRecoveryInFlight.clear()
    customRecoveryInFlight.clear()
    thumbnailBackfillIds.clear()
    aheadThumbnailIds.clear()
    if (typeof localStorage !== 'undefined') {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index)
        if (key?.startsWith('tangbao.gallery-sop-prompt-run.')) localStorage.removeItem(key)
      }
    }
    setTasks([])
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      supportPromptSkippedForImportedData: false,
    })
    clearInputImages()
    clearMaskDraft()
    useAssetLibraryStore.setState({
      assetsById: {},
      assetOrder: [],
      collections: [],
      selectedAssetIds: [],
      activeAssetId: null,
    })
  }

  if (options.clearConfig) {
    useStore.setState({ dismissedCodexCliPrompts: [], supportPromptDismissed: false })
    setSettings({ ...DEFAULT_SETTINGS })
    setParams({ ...DEFAULT_PARAMS })
  }

  showToast('所选数据已清空', 'success')
}

/** 从 dataUrl 解析出 MIME 扩展名和二进制数据 */
function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

/** 将二进制数据还原为 dataUrl（分块转换，避免大文件逐字节字符串拼接） */
function bytesToDataUrl(bytes: Uint8Array, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  const mime = mimeMap[ext] ?? 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** 拼接多个 Uint8Array 块（用于流式解压/压缩的条目数据收集）。 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0)
  if (chunks.length === 1) return chunks[0]!
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/** 从 ZIP 归档中提取单个条目（其余条目跳过不解压），并收集全部条目路径清单。 */
async function pushFileStreamToUnzip(file: File, unzip: Unzip): Promise<void> {
  if (typeof file.stream !== 'function') {
    if (file.size > 256 * 1024 * 1024) {
      throw new Error('当前浏览器不支持大型备份流式导入，请使用 Chromium 浏览器或 Windows 桌面版')
    }
    unzip.push(new Uint8Array(await file.arrayBuffer()), true)
    return
  }
  const reader = file.stream().getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    unzip.push(value, false)
  }
  unzip.push(new Uint8Array(), true)
}

async function scanZipFile(file: File): Promise<{
  manifestBytes: Uint8Array | null
  paths: Set<string>
  error: unknown
}> {
  const paths = new Set<string>()
  let manifestBytes: Uint8Array | null = null
  let error: unknown = null
  const unzip = new Unzip((entry) => {
    paths.add(entry.name)
    if (entry.name !== 'manifest.json') return
    const chunks: Uint8Array[] = []
    entry.ondata = (entryError, data, final) => {
      if (entryError) {
        error = entryError
        return
      }
      if (data) chunks.push(data)
      if (final) manifestBytes = concatBytes(chunks)
    }
    entry.start()
  })
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  await pushFileStreamToUnzip(file, unzip)
  return { manifestBytes, paths, error }
}

async function completeRecoveredCustomTask(
  task: TaskRecord,
  result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>,
) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  // 任务被停止/删除后 customRecoverable 会被置 false，此时不得把任务"复活"为 done。
  if (!latest || latest.status === 'done' || latest.customRecoverable !== true) return

  const originalActualParamsList = await readImageSizeParamsList(result.images)
  const outputIds: string[] = []
  const actualParamsList: Array<Partial<TaskParams> | undefined> = []
  for (let i = 0; i < result.images.length; i++) {
    const stored = await processAndStoreGeneratedImage(result.images[i], task.params, originalActualParamsList[i])
    outputIds.push(stored.id)
    actualParamsList.push(stored.actualParams)
  }

  // 同 fal 恢复：查询结果可能只覆盖一部分产出，不能把已生成的图片覆盖掉。
  const restoredOutputIds = pickMoreCompleteOutputIds(outputIds, latest.outputImages ?? [])
  updateTaskInStore(
    task.id,
    {
      outputImages: restoredOutputIds,
      actualParams: firstActualParams(actualParamsList),
      actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
      revisedPromptByImage: undefined,
      status: 'done',
      error: null,
      customRecoverable: false,
      watchdogTimedOutAt: undefined,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    },
    (current) => current.customRecoverable === true,
  )
  useStore.getState().showToast(`自定义异步任务已恢复，共 ${restoredOutputIds.length} 张图片`, 'success')
  if (!isAgentTask(task))
    showTaskCompletionNotification('图像生成完成', `自定义异步任务已恢复，共 ${restoredOutputIds.length} 张图片。`)
  else void continueRecoveredAgentRound(task.id)
  void saveTaskToLocalFS(task.id)
}

async function recoverCustomTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || !task.customTaskId || task.status === 'done') return
  if (task.customRecoverable !== true) return
  if (customRecoveryInFlight.has(taskId)) return
  customRecoveryInFlight.add(taskId)

  const profile = getCustomRecoveryProfile(settings, task)
  const customProvider = task.apiProvider ? getCustomProviderDefinition(settings, task.apiProvider) : null
  if (!profile || !customProvider?.poll) {
    customRecoveryInFlight.delete(taskId)
    scheduleCustomRecovery(taskId)
    return
  }

  try {
    const result = await getCustomQueuedImageResult(profile, customProvider, task.customTaskId, task.params)
    clearCustomRecoveryTimer(taskId)
    await completeRecoveredCustomTask(task, result)
  } catch (err) {
    clearCustomRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      ...getRawErrorPayload(err),
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    if (isAgentTask(task)) void continueRecoveredAgentRound(taskId)
  } finally {
    customRecoveryInFlight.delete(taskId)
  }
}

function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/** ZIP 条目 mtime 仅支持 1980-2099 年（DOS 时间格式），越界值会被 fflate 拒绝。 */
function isValidZipMtime(value: number): boolean {
  return value >= Date.UTC(1980, 0, 1) && value <= Date.UTC(2099, 11, 31)
}

/** 导出选项 */
export interface ExportOptions {
  exportConfig?: boolean
  exportTasks?: boolean
  exportImages?: boolean
  exportAssets?: boolean
  includeSecrets?: boolean
}

interface ExportDataToPathBehavior {
  showErrorToast?: boolean
}

async function buildCompositeBackup() {
  const [
    { useCompositeV2Store, getCompositeV2PersistedState },
    { collectCompositeAssetIds },
    { migrateLegacyCompositeAssets },
  ] = await Promise.all([
    import('./features/composite/storeV2'),
    import('./features/composite/lib/compositeAssets'),
    import('./features/composite/lib/compositeAssetMigration'),
  ])
  await migrateLegacyCompositeAssets({
    getState: useCompositeV2Store.getState,
    setState: (patch) => useCompositeV2Store.setState(patch),
    // 「从本机磁盘选图」写进图层的图**只记了磁盘上的位置**，不落库就跨不了机器。
    // 导出前把它读进来落库 —— 否则配置包搬过去就是断图（规范 §十 10.4·A）。
    readImageDataUrl: async (path) => {
      const payload = await window.electronAPI?.readImageFile(path)
      return payload?.dataUrl ?? null
    },
  })
  const compositeState = getCompositeV2PersistedState(useCompositeV2Store.getState())
  const ids = collectCompositeAssetIds(compositeState)
  const assets = await batchGetCompositeAssets(ids)
  for (const id of ids) {
    if (!assets.has(id)) throw new Error(`后期处理资源 ${id} 不存在`)
  }
  const compositeAssetFiles: NonNullable<ExportData['compositeAssetFiles']> = {}
  for (const id of ids) {
    const asset = assets.get(id)!
    compositeAssetFiles[id] = {
      path: `composite-assets/${id}.${getCompositeAssetExtension(asset.blob.type)}`,
      createdAt: asset.createdAt,
      type: asset.blob.type || 'application/octet-stream',
    }
  }
  return { compositeState, compositeAssetFiles, assets }
}

function getCompositeAssetExtension(type: string) {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/svg+xml') return 'svg'
  return 'png'
}

type BrowserZipSink = {
  onData: (error: Error | null, chunk: Uint8Array, final: boolean) => void
  complete: () => Promise<void>
}

async function createBrowserZipSink(fileName: string): Promise<BrowserZipSink | null> {
  const runtimeWindow = window as typeof window & {
    showSaveFilePicker?: (options: {
      suggestedName: string
      types: Array<{ description: string; accept: Record<string, string[]> }>
    }) => Promise<{
      createWritable: () => Promise<{
        write: (chunk: Uint8Array) => Promise<void>
        close: () => Promise<void>
        abort: () => Promise<void>
      }>
    }>
  }
  const picker = runtimeWindow.showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: 'ZIP 备份', accept: { 'application/zip': ['.zip'] } }],
      })
      const writable = await handle.createWritable()
      let writeChain = Promise.resolve()
      let resolveComplete!: () => void
      let rejectComplete!: (error: unknown) => void
      const completed = new Promise<void>((resolve, reject) => {
        resolveComplete = resolve
        rejectComplete = reject
      })
      return {
        onData: (error, chunk, final) => {
          if (error) {
            writeChain = writeChain.then(() => writable.abort())
            rejectComplete(error)
            return
          }
          if (chunk.length > 0) writeChain = writeChain.then(() => writable.write(chunk))
          if (final) {
            writeChain.then(() => writable.close()).then(resolveComplete, rejectComplete)
          }
        },
        complete: () => completed,
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null
      throw error
    }
  }

  const chunks: Uint8Array[] = []
  let accumulatedBytes = 0
  let failed = false
  let resolveComplete!: () => void
  let rejectComplete!: (error: unknown) => void
  const completed = new Promise<void>((resolve, reject) => {
    resolveComplete = resolve
    rejectComplete = reject
  })
  return {
    onData: (error, chunk, final) => {
      if (failed) return
      if (error) {
        failed = true
        rejectComplete(error)
        return
      }
      if (chunk.length > 0) {
        accumulatedBytes += chunk.length
        if (accumulatedBytes > 256 * 1024 * 1024) {
          failed = true
          chunks.length = 0
          rejectComplete(new Error('当前浏览器不支持大型备份流式保存，请使用 Chromium 浏览器或 Windows 桌面版'))
          return
        }
        chunks.push(chunk)
      }
      if (!final) return
      const blob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      URL.revokeObjectURL(url)
      resolveComplete()
    },
    complete: () => completed,
  }
}

/**
 * 把包里的水印资源（LOGO 图等）落库。
 *
 * v9 起「配置长什么样」全部由 `config.json` 负责（`restoreTreeConfigBundle` 会走
 * `toCompositeV2State` 重建水印库状态），这里只管**二进制资源**。
 *
 * 必须先落库、再恢复状态 —— 顺序反了就是「引用了还不存在的图」，
 * 而这类错误要到渲染那一刻才炸。
 */
async function restoreCompositeAssets(
  data: ExportData,
  bundle: TreeConfigBundle,
  unzipped: Record<string, Uint8Array>,
): Promise<void> {
  const { collectCompositeAssetIds } = await import('./features/composite/lib/compositeAssets')
  const ids = collectCompositeAssetIds(toCompositeV2State(bundle))
  if (ids.length === 0) return

  const assets = ids.map((id) => {
    const info = data.compositeAssetFiles?.[id]
    if (!info) throw new Error(`后期处理资源 ${id} 缺少备份索引`)
    const bytes = unzipped[info.path]
    if (!bytes) throw new Error(`后期处理资源 ${id} 缺少二进制文件`)
    return {
      id,
      blob: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: info.type,
      }),
      createdAt: info.createdAt,
    }
  })

  await putCompositeAssets(assets)
}

/** 导出数据为 ZIP */
/**
 * 从当前各 store 抽一份**以树为骨架**的配置快照（导出侧的唯一入口）。
 *
 * 抽成函数是因为 `exportData`（浏览器分支）与 `exportDataToPath`（桌面分支）**各有一份
 * manifest 组装代码** —— 两处各写一遍的话，迟早有一处忘了带树，而那正是这轮要修的病。
 */
async function snapshotTreeConfigBundle(exportedAt: number): Promise<TreeConfigBundle> {
  // composite store 只能动态 import：静态引它会在模块初始化期与 composite 侧互相等，
  // 结果是 `useCompositeV2Store` 拿到 undefined（store.ts 顶部那条注释记的就是这个坑）。
  const { useCompositeV2Store, getCompositeV2PersistedState } = await import('./features/composite/storeV2')
  const collections = useAssetLibraryStore.getState().collections
  const composite = getCompositeV2PersistedState(useCompositeV2Store.getState())
  return buildTreeConfigBundle({
    collections,
    nodeParams: useProjectTreeParamsStore.getState().params,
    presets: composite.presets,
    // 水印库的**库级**那半（LOGO 列表与顺序、标识符、水印全局适配、背景文件夹）。
    // v9 起「树是唯一入口」，它必须进包 —— 否则删掉并排的 `compositeState` 就是静默丢掉这些字段。
    watermarkLibrary: {
      logos: composite.projectLogos,
      logoOrder: composite.logoOrder,
      libraryPath: composite.logoLibraryPath,
      globalFitMode: composite.globalFitMode,
      ...(composite.identifier ? { identifier: composite.identifier } : {}),
      ...(composite.backgroundFolders ? { backgroundFolders: composite.backgroundFolders } : {}),
      ...(composite.recursiveBackgrounds === undefined ? {} : { recursiveBackgrounds: composite.recursiveBackgrounds }),
    },
    postprocess: getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState()),
    // 层级复用中控台表格那套口径，免得"包里的层级"与"界面标的层级"变成两套说法
    resolveKind: (collectionId) =>
      resolveProjectNodeKind(resolveProjectNodeIdChain(collections, collectionId).length - 1),
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined,
    exportedAt: new Date(exportedAt).toISOString(),
  })
}

/**
 * 恢复 v8 配置包：立树 → 灌节点参数 → 挂渠道与输出位置（水印库由调用方先行恢复）。
 *
 * ⚠️ **立树用的是「同 id 覆盖 + 保留本地独有」，不是彻底替换**（2026-09-22 的取舍）：
 * 彻底替换会把使用者自己建的方向、以及挂在上面的素材一起变成孤儿，而换来的只是
 * "树长得更一致"。覆盖已经保证了**包里有的一律以包为准** —— 那才是「拉取标准配置」的实质；
 * 本地多出来的分支留着不影响产出。
 *
 * 节点参数则是**整表替换**：参数是"这份配置"的一部分，留着本地的旧值会出现
 * 「界面显示的是新树、产出用的却是旧参数」这种最难查的不一致。
 */
/**
 * 按覆盖范围拼产出配置（分组逻辑在 `applyPostprocessScope` 里，是个好测的纯函数）。
 * 这里只负责把两份配置取出来、把 scope 翻译成「哪几组要覆盖」。
 */
function mergePostprocessConfig(bundle: TreeConfigBundle, scope: ImportScope): PostprocessMediaConfig {
  return applyPostprocessScope(
    getPostprocessMediaConfigSnapshot(usePostprocessMediaStore.getState()),
    toPostprocessMediaConfig(bundle),
    {
      channels: scope.channels,
      watermarks: scope.watermarks,
      tree: scope.tree,
      postprocess: scope.postprocess,
    },
  )
}

async function restoreTreeConfigBundle(bundle: TreeConfigBundle, scope: ImportScope): Promise<void> {
  // ① 立树 + 灌参数。两者**同进同退** —— 树没被覆盖却灌了参数，就会出现
  //    「节点的参数挂在一棵不属于这份包的树上」这种对不上的状态。
  if (scope.tree) {
    await mergeImportedAssetLibrary(
      {
        assets: [],
        collections: toAssetCollections(bundle),
        tags: [],
        tombstones: [],
      },
      { dropLocalOnlyCollections: scope.localOnly === 'drop' },
    )
    await useAssetLibraryStore.getState().hydrate()
    useProjectTreeParamsStore.setState({ params: toNodeParams(bundle) })
  }

  // ② 水印库（库级配置 + 全部预设，含未归属的）。v9 起树是**唯一入口**，不再有并排的
  //    `compositeState` 那条路。资源（LOGO 图）必须已经落库，见 `restoreCompositeAssets`。
  if (scope.watermarks) {
    const { mergeCompositeV2Library } = await import('./features/composite/storeV2')
    mergeCompositeV2Library(toCompositeV2State(bundle), scope.localOnly)
  }

  // ③ 产出配置：按字段归属分组拼，只勾了「渠道与尺寸」就不该顺手换掉命名模板。
  restorePostprocessMediaConfig(mergePostprocessConfig(bundle, scope))
}

export async function exportData(
  // 默认值与设置页一致：只导必要数据（配置 + 项目树/素材库索引），
  // 任务与图片体量大，需显式开启（杰哥 2026-09-19 裁决）。
  options: ExportOptions = { exportConfig: true, exportTasks: false, exportAssets: true, exportImages: false },
) {
  try {
    if (isElectronEnv()) {
      const exportedAt = Date.now()
      const defaultName = `tangbao-backup_${formatExportFileTime(new Date(exportedAt))}.zip`
      const filePath = await selectZipSavePath(defaultName)
      if (!filePath) return
      const result = await exportDataToPath(filePath, options)
      if (result.success) {
        useStore
          .getState()
          .showToast(
            result.omittedCount > 0 ? `数据已导出（跳过 ${result.omittedCount} 张缺失图片）` : '数据已导出',
            'success',
          )
      }
      return
    }
    const tasks = options.exportTasks || options.exportImages ? await getAllTasks() : []
    const sopPromptRuns = options.exportTasks || options.exportImages ? await getAllSopBatchSnapshots() : []
    const state = useStore.getState()
    const { settings, agentConversations, favoriteCollections, defaultFavoriteCollectionId } = state
    const exportedAt = Date.now()
    const fileName = `tangbao-backup_${formatExportFileTime(new Date(exportedAt))}.zip`
    const zipSink = await createBrowserZipSink(fileName)
    if (!zipSink) return
    const assetLibrary = options.exportAssets || options.exportImages ? await hydrateFull() : null
    const imageCreatedAtFallback = new Map<string, number>()

    if (options.exportTasks || options.exportImages) {
      for (const task of tasks) {
        for (const id of [
          ...(task.inputImageIds || []),
          ...(task.maskImageId ? [task.maskImageId] : []),
          ...(task.outputImages || []),
          ...(task.streamPartialImageIds || []),
        ]) {
          const prev = imageCreatedAtFallback.get(id)
          if (prev == null || task.createdAt < prev) {
            imageCreatedAtFallback.set(id, task.createdAt)
          }
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const thumbnailFiles: NonNullable<ExportData['thumbnailFiles']> = {}
    const missingOriginalImageIds = new Set<string>()
    const imageIds = [
      ...new Set([
        ...collectReferencedExportImageIds(
          options.exportTasks || options.exportImages ? tasks : [],
          options.exportTasks || options.exportImages ? agentConversations : [],
          options.exportConfig || options.exportImages ? state.workspaceTabs : [],
          options.exportAssets || options.exportImages ? (assetLibrary?.assets ?? []) : [],
        ),
      ]),
    ]
    const imageRefs = await buildExportImageRefs(imageIds, getImage)
    // 流式 ZIP：逐条目写入并立即丢弃，不再全量驻留图片字节 + zipSync 同步压缩。
    // 图片/缩略图/合成资源用 ZipPassThrough（存储模式）——它们已是压缩格式，
    // 再压缩收益极小，且避免压缩内存翻倍；manifest 用 Deflate 压缩。
    const zip = new Zip(zipSink.onData)
    const compositeBackup = options.exportConfig ? await buildCompositeBackup() : null
    if (compositeBackup) {
      for (const [id, asset] of compositeBackup.assets) {
        const info = compositeBackup.compositeAssetFiles[id]!
        const entry = new ZipPassThrough(info.path)
        if (info.createdAt && isValidZipMtime(info.createdAt)) entry.mtime = new Date(info.createdAt)
        zip.add(entry)
        entry.push(new Uint8Array(await asset.blob.arrayBuffer()), true)
      }
    }

    if (options.exportTasks || options.exportImages) {
      const IMAGE_BATCH = 16
      const thumbnailIds: string[] = []
      for (let batchStart = 0; batchStart < imageIds.length; batchStart += IMAGE_BATCH) {
        const batchIds = imageIds.slice(batchStart, batchStart + IMAGE_BATCH)
        const batch = await batchGetImages(batchIds)
        for (const imageId of batchIds) {
          const img = batch.get(imageId)
          if (!img) {
            if (options.exportImages) missingOriginalImageIds.add(imageId)
            continue
          }
          const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt

          if (options.exportImages && !img.dataUrl) {
            missingOriginalImageIds.add(img.id)
          } else if (options.exportImages && img.dataUrl) {
            const { ext, bytes } = dataUrlToBytes(img.dataUrl)
            const path = `images/${img.id}.${ext}`
            imageFiles[img.id] = {
              path,
              createdAt,
              source: img.source,
              width: img.width,
              height: img.height,
            }
            const entry = new ZipPassThrough(path)
            if (isValidZipMtime(createdAt)) entry.mtime = new Date(createdAt)
            zip.add(entry)
            entry.push(bytes, true)
          }

          if (options.exportTasks) thumbnailIds.push(img.id)
        }
        // 让出事件循环，避免长导出阻塞 UI
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      if (options.exportTasks) {
        for (let batchStart = 0; batchStart < thumbnailIds.length; batchStart += IMAGE_BATCH) {
          const batch = await batchGetImageThumbnails(thumbnailIds.slice(batchStart, batchStart + IMAGE_BATCH))
          for (const thumbnail of batch.values()) {
            if (!thumbnail?.thumbnailDataUrl) continue
            const { ext: thumbnailExt, bytes: thumbnailBytes } = dataUrlToBytes(thumbnail.thumbnailDataUrl)
            const thumbnailPath = `thumbnails/${thumbnail.id}.${thumbnailExt}`
            const createdAt = imageCreatedAtFallback.get(thumbnail.id) ?? exportedAt
            if (options.exportImages) {
              const info = imageFiles[thumbnail.id]
              if (info) {
                info.width = info.width ?? thumbnail.width
                info.height = info.height ?? thumbnail.height
              }
            }
            thumbnailFiles[thumbnail.id] = {
              path: thumbnailPath,
              width: thumbnail.width,
              height: thumbnail.height,
              thumbnailVersion: thumbnail.thumbnailVersion,
            }
            const entry = new ZipPassThrough(thumbnailPath)
            if (isValidZipMtime(createdAt)) entry.mtime = new Date(createdAt)
            zip.add(entry)
            entry.push(thumbnailBytes, true)
            cacheThumbnail(thumbnail.id, {
              dataUrl: thumbnail.thumbnailDataUrl,
              width: thumbnail.width,
              height: thumbnail.height,
              thumbnailVersion: thumbnail.thumbnailVersion,
            })
          }
        }
      }
    }
    // 原图缺失不再让整包导出失败（与 Electron 侧一致）：跳过并在完成提示里报数。
    const omittedOriginalImageCount = missingOriginalImageIds.size

    const manifest: ExportData = {
      version: 9,
      exportedAt: new Date(exportedAt).toISOString(),
      // 档位标记（TB-042）：含任务或图片即完整包，否则为精简包。
      // ⚠️ 旧备份没有这个字段，导入侧必须把「缺字段」当 full（见 types.ts ExportData.profile 注释）。
      profile: options.exportTasks || options.exportImages ? 'full' : 'config',
      includesSecrets: options.includeSecrets === true,
      includesOriginalImages: options.exportImages === true,
      ...(imageIds.length > 0 ? { imageRefs } : {}),
    }

    let configBundle: TreeConfigBundle | undefined
    if (options.exportConfig) {
      manifest.settings = sanitizeSettingsForBackup(settings, options.includeSecrets === true)
      manifest.favoriteCollections = favoriteCollections
      manifest.defaultFavoriteCollectionId = defaultFavoriteCollectionId
      // 水印资源（LOGO 图）的**文件索引**留在 manifest 里：它和 `imageFiles` / `thumbnailFiles` 同类，
      // 回答的是「包里有哪些文件」，不是「配置长什么样」。
      manifest.compositeAssetFiles = compositeBackup!.compositeAssetFiles
      manifest.workspaceState = createWorkspaceBackupState(
        state.workspaceTabs,
        state.workspaceTabGroups,
        state.activeWorkspaceTabId,
        options.exportTasks === true,
      )
      // v9：配置本体写成包内**独立一份 `config.json`**（见下），不再塞进 manifest ——
      // 「树就是根」之后它自带全部中控台配置，标志是 `format.version`。
      configBundle = await snapshotTreeConfigBundle(exportedAt)
    }
    if (options.exportTasks) {
      manifest.tasks = tasks
      manifest.sopPromptRuns = sopPromptRuns
      manifest.agentConversations = getPersistableAgentConversations(agentConversations)
      manifest.thumbnailFiles = thumbnailFiles
    }
    if (options.exportAssets) {
      manifest.generatedAssets = assetLibrary?.assets ?? []
      manifest.assetCollections = assetLibrary?.collections ?? []
      manifest.assetTags = assetLibrary?.tags ?? []
      manifest.assetTombstones = assetLibrary?.tombstones ?? []
      manifest.assetUsageEvents = await getAllAssetUsageEvents()
    }
    if (options.exportImages) {
      manifest.imageFiles = imageFiles
    }

    // 配置本体在 manifest 之前写。顺序只为可读性 —— 读取侧按**固定路径**取，
    // 找不到就是老包（v8 及更早把配置塞在 manifest.treeConfig 里），整包拒收。
    if (configBundle) {
      const configEntry = new ZipDeflate(TREE_CONFIG_ENTRY, { level: 6 })
      zip.add(configEntry)
      configEntry.push(strToU8(JSON.stringify(configBundle, null, 2)), true)
    }
    const manifestEntry = new ZipDeflate('manifest.json', { level: 6 })
    zip.add(manifestEntry)
    manifestEntry.push(strToU8(JSON.stringify(manifest, null, 2)), true)
    zip.end()
    await zipSink.complete()
    useStore
      .getState()
      .showToast(
        omittedOriginalImageCount > 0 ? `数据已导出（跳过 ${omittedOriginalImageCount} 张缺失原图）` : '数据已导出',
        'success',
      )
  } catch (e) {
    useStore.getState().showToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** 导出数据到指定路径 */
export async function exportDataToPath(
  filePath: string,
  options: ExportOptions = { exportConfig: true, exportTasks: true, exportAssets: true, exportImages: false },
  behavior: ExportDataToPathBehavior = {},
): Promise<{ success: boolean; omittedCount: number; error?: string }> {
  try {
    if (!isElectronEnv()) throw new Error('当前环境不支持流式导出')
    await ensureImageStorageMigrated()
    const allTasks = options.exportTasks || options.exportImages ? await getAllTasks() : []
    const sopPromptRuns = options.exportTasks || options.exportImages ? await getAllSopBatchSnapshots() : []
    const state = useStore.getState()
    const exportedAt = Date.now()
    const compositeBackup = options.exportConfig ? await buildCompositeBackup() : null
    const assetLibrary = options.exportAssets || options.exportImages ? await hydrateFull() : null
    const ids = [
      ...new Set([
        ...collectReferencedExportImageIds(
          options.exportTasks || options.exportImages ? allTasks : [],
          options.exportTasks || options.exportImages ? state.agentConversations : [],
          options.exportConfig || options.exportImages ? state.workspaceTabs : [],
          options.exportAssets || options.exportImages ? (assetLibrary?.assets ?? []) : [],
        ),
        ...(options.exportTasks || options.exportImages ? sopPromptRuns.flatMap((run) => run.referenceImageIds) : []),
        ...(options.exportImages
          ? useRequirementPrototype
              .getState()
              .sopLibrary.flatMap((item) => (item.coverImageId ? [item.coverImageId] : []))
          : []),
      ]),
    ]
    const imageRefs = await buildExportImageRefs(ids, getImage)
    const imagePlan = options.exportImages
      ? await buildElectronImageExportEntries(ids, getImage)
      : { entries: [], omittedCount: 0, omittedImageIds: [] }
    // v8：以树为骨架的配置快照。在 manifest 之前算好 —— 对象字面量里不能 `await`
    const treeBundle = options.exportConfig ? await snapshotTreeConfigBundle(exportedAt) : undefined
    // 原图缺失**不再让整包导出失败**：跳过缺失项，由 `omittedCount` 在完成提示里报数。
    // 用户要的是一次能用的备份，而不是因为一张图丢了什么都导不出（这是「导出经常失败」的首因）。
    const { entries, omittedCount } = imagePlan
    const imageFiles: ExportData['imageFiles'] = {}
    const thumbnailFiles: NonNullable<ExportData['thumbnailFiles']> = {}
    const thumbnailEntries: Array<{ archivePath: string; data: Uint8Array; mtime?: number }> = []
    for (const entry of entries) {
      const image = await getImage(entry.imageId)
      imageFiles[entry.imageId] = {
        path: entry.archivePath,
        createdAt: entry.createdAt ?? exportedAt,
        source: image?.source,
        width: image?.width,
        height: image?.height,
      }
    }
    if (options.exportTasks) {
      for (const imageId of ids) {
        const thumbnail = await getImageThumbnail(imageId)
        if (!thumbnail?.thumbnailDataUrl) continue
        const { ext, bytes } = dataUrlToBytes(thumbnail.thumbnailDataUrl)
        const archivePath = `thumbnails/${imageId}.${ext}`
        thumbnailFiles[imageId] = {
          path: archivePath,
          width: thumbnail.width,
          height: thumbnail.height,
          thumbnailVersion: thumbnail.thumbnailVersion,
        }
        thumbnailEntries.push({
          archivePath,
          data: bytes,
          mtime: imageRefs[imageId]?.createdAt,
        })
      }
    }
    const manifest: ExportData = {
      version: 9,
      exportedAt: new Date(exportedAt).toISOString(),
      // 档位标记（TB-042）：含任务或图片即完整包，否则为精简包。
      // ⚠️ 旧备份没有这个字段，导入侧必须把「缺字段」当 full（见 types.ts ExportData.profile 注释）。
      profile: options.exportTasks || options.exportImages ? 'full' : 'config',
      includesSecrets: options.includeSecrets === true,
      includesOriginalImages: options.exportImages === true,
      ...(ids.length > 0 ? { imageRefs } : {}),
      ...(options.exportConfig
        ? {
            settings: sanitizeSettingsForBackup(state.settings, options.includeSecrets === true),
            favoriteCollections: state.favoriteCollections,
            defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
            // 水印资源（LOGO 图）的**文件索引**留在这里：与 `imageFiles` / `thumbnailFiles` 同类，
            // 回答的是「包里有哪些文件」，不是「配置长什么样」。配置本体见包内 `config.json`。
            compositeAssetFiles: compositeBackup!.compositeAssetFiles,
            workspaceState: createWorkspaceBackupState(
              state.workspaceTabs,
              state.workspaceTabGroups,
              state.activeWorkspaceTabId,
              options.exportTasks === true,
            ),
          }
        : {}),
      ...(options.exportTasks
        ? {
            tasks: allTasks,
            sopPromptRuns,
            agentConversations: getPersistableAgentConversations(state.agentConversations),
          }
        : {}),
      ...(options.exportAssets && assetLibrary
        ? {
            generatedAssets: assetLibrary.assets,
            assetCollections: assetLibrary.collections,
            assetTags: assetLibrary.tags,
            assetTombstones: assetLibrary.tombstones,
            assetUsageEvents: await getAllAssetUsageEvents(),
          }
        : {}),
      ...(options.exportTasks ? { thumbnailFiles } : {}),
      ...(options.exportImages ? { imageFiles } : {}),
    }
    const result = await exportZipToPath({
      destinationPath: filePath,
      manifestJson: JSON.stringify(manifest, null, 2),
      entries: [
        // 配置本体（v9）：包内独立一份 `config.json` —— 人可读、可手改、可整份替换。
        // manifest 只管「包里有哪些文件」，配置内容不放在它里面。
        ...(treeBundle ? [{ archivePath: TREE_CONFIG_ENTRY, data: strToU8(JSON.stringify(treeBundle, null, 2)) }] : []),
        ...entries.map((entry) => ({
          sourcePath: entry.sourcePath,
          archivePath: entry.archivePath,
          mtime: entry.createdAt,
        })),
        ...thumbnailEntries,
        ...(compositeBackup
          ? await Promise.all(
              [...compositeBackup.assets].map(async ([id, asset]) => ({
                archivePath: compositeBackup.compositeAssetFiles[id]!.path,
                data: new Uint8Array(await asset.blob.arrayBuffer()),
                mtime: asset.createdAt,
              })),
            )
          : []),
      ],
    })
    if (!result.success) throw new Error(result.error || '导出失败')
    return { success: true, omittedCount }
  } catch (error) {
    // 失败原因必须回传：调用方（发布配置 / 导出数据）要根据它说清"到底为什么没成"。
    // 此前只把原因丢进 toast 就返回 `success: false`，上层只能编一句通用文案 ——
    // 实例：ZIP 条目白名单漏了 `config.json` 时，界面显示「确认这个目录可写」，
    // 而目录明明可写，真因被彻底带偏（R-89）。
    const message = error instanceof Error ? error.message : String(error)
    if (behavior.showErrorToast !== false) {
      useStore.getState().showToast(`导出失败：${message}`, 'error')
    }
    return { success: false, omittedCount: 0, error: message }
  }
}

/**
 * 导入 / 拉取时的**覆盖范围**：勾了才用包里的，没勾的这一块**完全不动**。
 *
 * 粒度刻意停在这一层（模块级）：方向参数引用节点 id、水印按产品 id 归属、
 * 渠道选择引用渠道 id —— 允许再细的自由组合，就会勾出「引用了不存在的东西」，
 * 那比"多覆盖了一点"更难排查。
 */
export interface ImportScope {
  /** 项目树（产品线 / 产品 / 方向）与各节点的参数 */
  tree: boolean
  /** 水印库（预设 + LOGO 列表） */
  watermarks: boolean
  /** 渠道与尺寸（含「默认投哪些渠道」与按渠道的导出位置） */
  channels: boolean
  /** 全局产出配置（输出位置 / 命名模板 / 画面适配 / 分发） */
  postprocess: boolean
  /** 应用设置（主题与本机偏好） */
  settings: boolean
  /**
   * 本地自建的方向与水印怎么办。
   *
   * 它回答的问题与上面五个**不同**：上面是「包里的要不要进来」，这个是「包里没有的要不要删」。
   * 塞进同一个控件会让人算不清自己到底选了什么。
   */
  localOnly: 'keep' | 'drop'
}

/** 全勾：导入自己导出的备份时的默认 —— 目的就是把这台机器恢复成包里的样子。 */
export const IMPORT_SCOPE_ALL: ImportScope = {
  tree: true,
  watermarks: true,
  channels: true,
  postprocess: true,
  settings: true,
  localOnly: 'keep',
}

/**
 * 拉取别人发布的配置时的默认：**不覆盖应用设置**。
 *
 * 主题与各种本机偏好是「我这台机器想怎么用」，不该被一份工作配置顺手改掉。
 * 本地自建的东西默认**保留** —— 拉一次配置就把自己加的方向抹掉，用户下次就不敢拉了。
 */
export const IMPORT_SCOPE_CONFIG_SYNC: ImportScope = { ...IMPORT_SCOPE_ALL, settings: false }

/** 把可能不全的 scope 补成完整的一份。 */
export function resolveImportScope(scope?: Partial<ImportScope>): ImportScope {
  return { ...IMPORT_SCOPE_ALL, ...(scope ?? {}) }
}

/** 导入选项 */
export interface ImportOptions {
  importConfig?: boolean
  importTasks?: boolean
  importImages?: boolean
  importAssets?: boolean
  /** 覆盖范围。不给 = 全勾（既有调用方的行为不变）。 */
  scope?: Partial<ImportScope>
}

/**
 * 备份导入的提取状态与逐条目处理（浏览器流式解压与 Electron IPC 按条目读取共用）。
 * 图片/缩略图按批落库（≤32/64 条一批），避免全量驻留。
 */
interface ImportExtractionState {
  compositeFiles: Map<string, Uint8Array>
  importedImageIds: string[]
  availableImageIds: Set<string>
  pendingImages: StoredImage[]
  pendingThumbnails: StoredImageThumbnail[]
  processingChain: Promise<void>
  processingError: unknown
  /**
   * 包内 `config.json`（`TREE_CONFIG_ENTRY`）解析后的原始内容。
   *
   * 提取阶段顺手收下来，是因为两个入口（浏览器流式 Unzip / 桌面 IPC 逐条读）
   * 都要在写库前拿到它 —— 让各自去补一遍读取，迟早有一处漏掉。
   * 老包（v8 及更早把配置塞在 `manifest.treeConfig` 里）拿不到 → `undefined`，导入侧据此拒收。
   */
  configBundle: unknown
}

function createImportExtractionState(availableImageIds: Iterable<string> = []): ImportExtractionState {
  return {
    compositeFiles: new Map<string, Uint8Array>(),
    importedImageIds: [],
    availableImageIds: new Set(availableImageIds),
    pendingImages: [],
    pendingThumbnails: [],
    processingChain: Promise.resolve(),
    processingError: null,
    configBundle: undefined,
  }
}

/**
 * 解析包内 `config.json` 的字节。
 *
 * 坏 JSON **不在这里抛** —— 交给 `validateTreeConfigBundle` 给出「配置包不是一个对象」
 * 这种可读原因，让用户看到的是「配置包不可用」而不是 `Unexpected token <`。
 */
function parseConfigEntry(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(bytes))
  } catch {
    return undefined
  }
}

function flushImportImageBatches(state: ImportExtractionState): Promise<void> {
  if (state.pendingImages.length === 0 && state.pendingThumbnails.length === 0) return Promise.resolve()
  const images = state.pendingImages
  const thumbnails = state.pendingThumbnails
  state.pendingImages = []
  state.pendingThumbnails = []
  return commitImportedRecords({ images, thumbnails, tasks: [] }).then(() => {
    for (const image of images) {
      state.importedImageIds.push(image.id)
      state.availableImageIds.add(image.id)
    }
  })
}

function enqueueImportedImage(
  state: ImportExtractionState,
  id: string,
  info: { createdAt?: number; source?: StoredImage['source']; width?: number; height?: number } | undefined,
  bytes: Uint8Array,
  name: string,
) {
  const dataUrl = bytesToDataUrl(bytes, name)
  state.processingChain = state.processingChain
    .then(async () => {
      if (!info) return // 清单外条目忽略
      let localPath: string | undefined
      if (isElectronEnv()) {
        const { saveRawCacheImageToLocal } = await import('./lib/localSave')
        localPath = (await saveRawCacheImageToLocal(id, dataUrl)) || undefined
      }
      state.pendingImages.push({
        id,
        dataUrl: localPath ? undefined : dataUrl,
        localPath,
        createdAt: info.createdAt,
        source: info.source,
        width: info.width,
        height: info.height,
      })
      if (!localPath) {
        cacheImage(id, dataUrl)
      }
      if (state.pendingImages.length >= 32) await flushImportImageBatches(state)
    })
    .catch((error: unknown) => {
      state.processingError = error
    })
}

function enqueueImportedThumbnail(
  state: ImportExtractionState,
  id: string,
  info: { width?: number; height?: number; thumbnailVersion?: number } | undefined,
  bytes: Uint8Array,
  name: string,
) {
  const thumbnailDataUrl = bytesToDataUrl(bytes, name)
  state.processingChain = state.processingChain
    .then(async () => {
      if (!info) return
      state.pendingThumbnails.push({
        id,
        thumbnailDataUrl,
        width: info.width,
        height: info.height,
        thumbnailVersion: info.thumbnailVersion,
      })
      cacheThumbnail(id, {
        dataUrl: thumbnailDataUrl,
        width: info.width,
        height: info.height,
        thumbnailVersion: info.thumbnailVersion,
      })
      if (state.pendingThumbnails.length >= 64) await flushImportImageBatches(state)
    })
    .catch((error: unknown) => {
      state.processingError = error
    })
}

async function settleImportExtraction(state: ImportExtractionState): Promise<void> {
  await state.processingChain
  if (state.processingError) throw state.processingError
  await flushImportImageBatches(state)
}

function entryIdFromArchivePath(prefix: string, name: string): string {
  const dotIndex = name.lastIndexOf('.')
  return name.slice(prefix.length, dotIndex > 0 ? dotIndex : undefined)
}

/** 从 ZIP 中读取备份（流式 ZIP 导入入口）：manifest 由主进程流式读取，条目按需读取。 */
export async function importDataFromPath(
  filePath: string,
  options: ImportOptions = { importConfig: true, importTasks: true },
): Promise<boolean> {
  try {
    const api = window.electronAPI
    if (!api?.readZipManifest || !api?.readZipEntry) throw new Error('当前环境不支持流式导入')

    const manifestResult = await api.readZipManifest(filePath)
    if (!manifestResult.success) throw new Error(manifestResult.error)
    const parsedData = manifestResult.manifest as ExportData
    const paths = new Set(manifestResult.entryPaths)
    const existingImageIds = new Set(await getAllImageIds())
    const candidateImageIds = new Set(existingImageIds)
    if (options.importImages) {
      Object.keys(parsedData.imageFiles ?? {}).forEach((id) => candidateImageIds.add(id))
    }
    const preflightBackup =
      parsedData.version >= 5 && options.importConfig && options.importTasks
        ? reconcileBackupWorkspaceImages(parsedData, candidateImageIds)
        : { data: parsedData, omittedImageCount: 0 }
    const preflightData = preflightBackup.data
    validateBackupArchive(preflightData, {}, options, paths, candidateImageIds)
    const replaceWorkspace =
      preflightData.version >= 5 &&
      Boolean(preflightData.workspaceState) &&
      options.importConfig === true &&
      options.importTasks === true &&
      // ⚠️ 必须要求「包里确实带了任务」才允许整体替换：
      // 否则导入一个「只导配置」的包（任务默认不纳入导出）会把本地任务整体替换为空 —— 数据被静默清空。
      // 用户要清空任务有专门的「清除数据」，不该由一次配置导入顺手完成。
      (preflightData.tasks?.length ?? 0) > 0

    const readEntry = async (archivePath: string): Promise<Uint8Array> => {
      const result = await api.readZipEntry!(filePath, archivePath)
      if (!result.success) throw new Error(result.error)
      return result.bytes
    }

    const state = createImportExtractionState(existingImageIds)
    // 按清单条目逐条读取（主进程每次只解压一个条目，渲染端不驻留整包）
    if (options.importImages && preflightData.imageFiles) {
      for (const [id, info] of Object.entries(preflightData.imageFiles)) {
        const bytes = await readEntry(info.path)
        enqueueImportedImage(state, id, info, bytes, info.path)
      }
    }
    if (options.importTasks && preflightData.thumbnailFiles) {
      for (const [id, info] of Object.entries(preflightData.thumbnailFiles)) {
        const bytes = await readEntry(info.path)
        enqueueImportedThumbnail(state, id, info, bytes, info.path)
      }
    }
    if (options.importConfig && preflightData.compositeAssetFiles) {
      for (const info of Object.values(preflightData.compositeAssetFiles)) {
        const bytes = await readEntry(info.path)
        state.compositeFiles.set(info.path, bytes)
      }
    }
    // 配置本体（v9）：包内独立一份 `config.json`。读不到就是老包（v8 及更早塞在 manifest 里），
    // 交给 `validateTreeConfigBundle` 给出「版本不认识」并拒收 —— 不做猜测性解析。
    if (options.importConfig && paths.has(TREE_CONFIG_ENTRY)) {
      state.configBundle = parseConfigEntry(await readEntry(TREE_CONFIG_ENTRY))
    }
    await settleImportExtraction(state)

    const reconciledBackup =
      parsedData.version >= 5 && options.importConfig && options.importTasks
        ? reconcileBackupWorkspaceImages(parsedData, state.availableImageIds)
        : { data: parsedData, omittedImageCount: 0 }
    const data = reconciledBackup.data
    // 写库阶段没有事务回滚：先落一份「导入前快照」作为安全网（尽力而为，失败不阻断导入）
    await createPreImportSafetySnapshot()
    await importBackupTail(data, state, replaceWorkspace, options, state.configBundle)
    const missingImageCount = Object.keys(data.imageRefs ?? data.imageFiles ?? {}).filter(
      (id) => !state.availableImageIds.has(id),
    ).length
    showImportedBackupSummary(data, options, reconciledBackup.omittedImageCount, missingImageCount)
    return true
  } catch (error) {
    useStore.getState().showToast(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    return false
  }
}

/** 导入 ZIP 数据 */
export async function importData(
  file: File,
  options: ImportOptions = { importConfig: true, importTasks: true },
): Promise<boolean> {
  try {
    // 第一遍：只解压 manifest.json + 收集全部条目路径清单（其余条目跳过、不解压不驻留）
    const { manifestBytes, paths, error: scanError } = await scanZipFile(file)
    if (scanError) throw scanError
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const parsedData: ExportData = JSON.parse(strFromU8(manifestBytes))
    const existingImageIds = new Set(await getAllImageIds())
    const candidateImageIds = new Set(existingImageIds)
    if (options.importImages) {
      Object.keys(parsedData.imageFiles ?? {}).forEach((id) => candidateImageIds.add(id))
    }
    const preflightBackup =
      parsedData.version >= 5 && options.importConfig && options.importTasks
        ? reconcileBackupWorkspaceImages(parsedData, candidateImageIds)
        : { data: parsedData, omittedImageCount: 0 }
    const preflightData = preflightBackup.data
    validateBackupArchive(preflightData, {}, options, paths, candidateImageIds)
    const replaceWorkspace =
      preflightData.version >= 5 &&
      Boolean(preflightData.workspaceState) &&
      options.importConfig === true &&
      options.importTasks === true &&
      // ⚠️ 必须要求「包里确实带了任务」才允许整体替换：
      // 否则导入一个「只导配置」的包（任务默认不纳入导出）会把本地任务整体替换为空 —— 数据被静默清空。
      // 用户要清空任务有专门的「清除数据」，不该由一次配置导入顺手完成。
      (preflightData.tasks?.length ?? 0) > 0

    const state = createImportExtractionState(existingImageIds)

    const unzip = new Unzip((file) => {
      const name = file.name
      if (name === 'manifest.json') return // 第一遍已处理

      if (options.importImages && name.startsWith('images/')) {
        const id = entryIdFromArchivePath('images/', name)
        const info = preflightData.imageFiles?.[id]
        const chunks: Uint8Array[] = []
        file.ondata = (err, data, final) => {
          if (err) {
            state.processingError = err
            return
          }
          if (data) chunks.push(data)
          if (!final) return
          enqueueImportedImage(state, id, info, concatBytes(chunks), name)
        }
        file.start()
        return
      }

      if (options.importTasks && name.startsWith('thumbnails/')) {
        const id = entryIdFromArchivePath('thumbnails/', name)
        const info = preflightData.thumbnailFiles?.[id]
        const chunks: Uint8Array[] = []
        file.ondata = (err, data, final) => {
          if (err) {
            state.processingError = err
            return
          }
          if (data) chunks.push(data)
          if (!final) return
          enqueueImportedThumbnail(state, id, info, concatBytes(chunks), name)
        }
        file.start()
        return
      }

      if (options.importConfig && name.startsWith('composite-assets/')) {
        const chunks: Uint8Array[] = []
        file.ondata = (err, data, final) => {
          if (err) {
            state.processingError = err
            return
          }
          if (data) chunks.push(data)
          if (final) state.compositeFiles.set(name, concatBytes(chunks))
        }
        file.start()
        return
      }
      if (options.importConfig && name === TREE_CONFIG_ENTRY) {
        const chunks: Uint8Array[] = []
        file.ondata = (err, data, final) => {
          if (err) {
            state.processingError = err
            return
          }
          if (data) chunks.push(data)
          if (final) state.configBundle = parseConfigEntry(concatBytes(chunks))
        }
        file.start()
        return
      }

      // 其余条目跳过（不解压）
    })
    unzip.register(UnzipInflate)
    unzip.register(UnzipPassThrough)
    await pushFileStreamToUnzip(file, unzip)
    await settleImportExtraction(state)

    const reconciledBackup =
      parsedData.version >= 5 && options.importConfig && options.importTasks
        ? reconcileBackupWorkspaceImages(parsedData, state.availableImageIds)
        : { data: parsedData, omittedImageCount: 0 }
    const data = reconciledBackup.data
    // 写库阶段没有事务回滚：先落一份「导入前快照」作为安全网（尽力而为，失败不阻断导入）
    await createPreImportSafetySnapshot()
    await importBackupTail(data, state, replaceWorkspace, options, state.configBundle)
    const missingImageCount = Object.keys(data.imageRefs ?? data.imageFiles ?? {}).filter(
      (id) => !state.availableImageIds.has(id),
    ).length
    showImportedBackupSummary(data, options, reconciledBackup.omittedImageCount, missingImageCount)
    return true
  } catch (e) {
    useStore.getState().showToast(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    return false
  }
}

/** 导入前安全网快照的文件名前缀与保留份数 */
const PRE_IMPORT_SNAPSHOT_PREFIX = 'tangbao-preimport_'
const PRE_IMPORT_SNAPSHOT_KEEP = 5

/**
 * 导入前安全网：把**当前配置状态**导出一份到库根 `backups/`。
 *
 * 为什么需要它：导入的写库阶段（`importBackupTail`）**没有事务回滚** ——
 * 中途失败（磁盘满 / 配额 / 用户强退）会让数据停在半途状态，比导入前更糟。
 * 预检（`validateBackupArchive`）只能拦住"包本身有问题"，拦不住这类运行时失败。
 * 有了这份快照，用户至少能退回导入前。
 *
 * 只导配置（不含任务与原图），所以体积小、耗时可忽略；**失败不阻断导入**。
 */
async function createPreImportSafetySnapshot(): Promise<void> {
  if (!isElectronEnv()) return
  try {
    const backupsDir = await getLibraryBackupsPath()
    if (!backupsDir) return
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = `${backupsDir.replace(/\\/g, '/')}/${PRE_IMPORT_SNAPSHOT_PREFIX}${ts}.zip`
    const result = await exportDataToPath(
      filePath,
      { exportConfig: true, exportTasks: false, exportImages: false, exportAssets: false },
      { showErrorToast: false },
    )
    if (result.success) {
      void pruneLibraryBackupsInDir(backupsDir, PRE_IMPORT_SNAPSHOT_PREFIX, PRE_IMPORT_SNAPSHOT_KEEP)
    }
  } catch {
    // 尽力而为：安全网本身失败不应阻断导入
  }
}

/**
 * 备份导入尾段：任务 / Agent 会话 / 素材库 / 配置合并。
 * 浏览器与 Electron 流式导入共用；state 为提取阶段累积的图片/缩略图/合成资源。
 */
async function importBackupTail(
  data: ExportData,
  state: ImportExtractionState,
  replaceWorkspace: boolean,
  options: ImportOptions,
  /** 包内 `config.json`（`TREE_CONFIG_ENTRY`）的原始内容；老包没有它 → undefined */
  configBundle: unknown,
): Promise<void> {
  const importedTasks: TaskRecord[] = []
  if (options.importTasks) {
    if (data.tasks) {
      for (const task of data.tasks) {
        importedTasks.push(getPersistableTask(task))
      }
    }

    await commitImportedRecords({
      images: [],
      thumbnails: [],
      tasks: importedTasks,
      replaceTasks: replaceWorkspace,
    })
    if (data.sopPromptRuns?.length) {
      await Promise.all(data.sopPromptRuns.map((run) => putSopBatchSnapshot(run)))
    }

    const tasks = await getAllTasks()

    const importedAgentConversations = normalizeAgentConversations(data.agentConversations ?? []).filter(
      (conversation) => !isEmptyAgentConversation(conversation),
    )
    useStore.setState((current) => {
      const agentConversations = replaceWorkspace
        ? importedAgentConversations
        : mergeImportedAgentConversations(current.agentConversations, importedAgentConversations)
      const activeAgentConversationId = replaceWorkspace
        ? (agentConversations[0]?.id ?? null)
        : current.activeAgentConversationId &&
            agentConversations.some((conversation) => conversation.id === current.activeAgentConversationId)
          ? current.activeAgentConversationId
          : (importedAgentConversations[0]?.id ?? agentConversations[0]?.id ?? null)
      return {
        agentConversations,
        activeAgentConversationId,
      }
    })
    await replaceStoredAgentConversations(useStore.getState().agentConversations)
    skipSupportPromptForImportedData(tasks)
    scheduleThumbnailBackfill(
      Array.from(state.importedImageIds, (id) => ({
        id,
        variant: 'full' as const,
        priority: 'background' as const,
        silent: false,
      })),
    )
  }

  if (
    options.importAssets &&
    (data.generatedAssets?.length ||
      data.assetCollections?.length ||
      data.assetTags?.length ||
      data.assetTombstones?.length)
  ) {
    await mergeImportedAssetLibrary({
      assets: (data.generatedAssets ?? []).map(normalizeAsset),
      collections: (data.assetCollections ?? [])
        .map(normalizeCollection)
        .filter((value): value is NonNullable<typeof value> => value !== null),
      tags: (data.assetTags ?? [])
        .map(normalizeTag)
        .filter((value): value is NonNullable<typeof value> => value !== null),
      tombstones: (data.assetTombstones ?? [])
        .map(normalizeTombstone)
        .filter((value): value is NonNullable<typeof value> => value !== null),
    })
    await useAssetLibraryStore.getState().hydrate()
  }
  if (options.importAssets && data.assetUsageEvents?.length) {
    const usageEvents = data.assetUsageEvents
      .map(normalizeAssetUsageEvent)
      .filter((event): event is NonNullable<typeof event> => event !== null)
    await putAssetUsageEvents(usageEvents)
    await window.electronAPI?.assetCatalogRecordUsage?.(usageEvents)
  }

  if (options.importConfig) {
    const scope = resolveImportScope(options.scope)
    // v9：配置本体只从包内 `config.json` 来。到不了这里（老包 / 缺条目 / 结构不对）就是不可用包 ——
    // **不做猜测性解析**，宁可这次不导入，也别拿半个包覆盖用户已经调好的配置。
    const treeBundle = validateTreeConfigBundle(configBundle)
    if (!treeBundle.ok) throw new Error(`配置包不可用：${treeBundle.reason}`)
    // 顺序不可交换：资源先落库 → 立树 → 灌参数 → 放水印库 → 挂渠道与输出位置。
    // 反了会出现「引用了不存在的水印 / 渠道」，而这类错误要到产出那一刻才炸，极难自查。
    // 资源跟着 `watermarks` 走：没勾水印库就不需要它们的二进制。
    if (scope.watermarks) {
      await restoreCompositeAssets(data, treeBundle.bundle, Object.fromEntries(state.compositeFiles))
    }
    await restoreTreeConfigBundle(treeBundle.bundle, scope)
    const mainState = useStore.getState()

    // 应用设置按范围来：没勾就**一点不碰** —— 拉一份工作配置，不该顺手改掉别人的主题与偏好。
    if (data.settings && scope.settings) {
      mainState.setSettings(mergeImportedSettings(mainState.settings, data.settings))
    }

    const importedCollections = normalizeFavoriteCollections(data.favoriteCollections ?? [])
    const favoriteCollections = importedCollections.length
      ? ensureDefaultFavoriteCollection(
          normalizeFavoriteCollections([...mainState.favoriteCollections, ...importedCollections]),
        )
      : mainState.favoriteCollections
    const defaultFavoriteCollectionId = importedCollections.length
      ? resolveDefaultFavoriteCollectionId(favoriteCollections, data.defaultFavoriteCollectionId)
      : mainState.defaultFavoriteCollectionId
    const tasks = await getAllTasks()
    const normalizedFavorites = normalizeLoadedFavoriteState(tasks, favoriteCollections, defaultFavoriteCollectionId)
    const restoredWorkspace = replaceWorkspace
      ? restoreWorkspaceBackupState(data.workspaceState!, normalizedFavorites.tasks, state.availableImageIds)
      : null
    useStore.setState({
      tasks: normalizedFavorites.tasks,
      favoriteCollections: normalizedFavorites.collections,
      defaultFavoriteCollectionId: normalizedFavorites.defaultFavoriteCollectionId,
      ...(restoredWorkspace
        ? {
            workspaceTabs: restoredWorkspace.tabs,
            workspaceTabGroups: restoredWorkspace.groups,
            activeWorkspaceTabId: restoredWorkspace.activeTabId,
            selectedWorkspaceTabIds: [],
          }
        : {}),
    })
    await hydrateWorkspaceTabsInStore()
    if (normalizedFavorites.changed) await putTasks(normalizedFavorites.tasks)
  }
}

function showImportedBackupSummary(
  data: ExportData,
  options: ImportOptions,
  omittedImageCount: number,
  missingImageCount: number,
): void {
  let msg = '数据已成功导入'
  if (options.importTasks && data.tasks) {
    msg = `已导入 ${data.tasks.length} 个任务`
  } else if (options.importImages && data.imageFiles) {
    msg = `已导入 ${Object.keys(data.imageFiles).length} 张图片`
  } else if (options.importConfig && data.settings) {
    msg = '配置已成功导入'
  }
  if (omittedImageCount > 0) {
    msg += `，已移除 ${omittedImageCount} 张不可用的工作区图片`
  }
  if (missingImageCount > 0) {
    msg += `，${missingImageCount} 张原图未包含在备份中`
  }
  useStore.getState().showToast(msg, 'success')
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  const image = await createInputImageFromFile(file)
  if (!image) return
  useStore.getState().addInputImage(image)
}

export async function createInputImageFromFile(file: File): Promise<InputImage | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await fileToDataUrl(file)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  let dataUrl: string
  if (isLocalImageUrl(src)) {
    // 展示用协议地址不能 fetch（CSP connect-src 不含 tangbao:）：经 IPC 读回字节再转 dataUrl。
    const resolved = await localImageUrlToDataUrl(src)
    if (!resolved) throw new Error('读取图片失败')
    dataUrl = resolved
  } else {
    const res = await fetch(src)
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
    dataUrl = await blobToDataUrl(blob)
  }
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
