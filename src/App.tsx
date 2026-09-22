import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hydrateDesktopApiSecrets, initStore, exportDataToPath, removeDeletedLocalImage } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { mergeImportedSettings } from './lib/apiProfiles'
import { applyWorkspaceEdit, readWorkspaceState } from './lib/externalWorkspaceCommand'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import {
  isElectron as isElectronEnv,
  getDesktopPath,
  getBackupList,
  getLibraryBackupsPath,
  pruneLibraryBackupsInDir,
  restoreFromBackupFile,
  checkBackupHasData,
} from './lib/localSave'
import { applyAppearance, writeAppearanceSnapshot } from './theme/appearance'
import Header from './components/Header'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import PromptInputDialog from './components/PromptInputDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import ErrorBoundary from './components/ErrorBoundary'
import WorkspaceTabBar from './components/WorkspaceTabBar'
import AppPageRail from './components/AppPageRail'
import RequirementQueueRunner from './features/requirementPrototype/QueueRunner'

/**
 * 自动备份的文件名前缀与保留份数。
 * 前缀必须与手动导出的命名规则一致（`tangbao-backup_`），这样清理逻辑按前缀匹配即可，
 * 不会误删用户自己手动导出后放回该目录的文件之外的东西。
 */
const AUTO_BACKUP_FILE_PREFIX = 'tangbao-backup_'
const AUTO_BACKUP_KEEP = 10

const AgentWorkspace = React.lazy(() => import('./components/AgentWorkspace'))
const CompositeWorkspace = React.lazy(() => import('./features/composite/CompositeWorkspace'))
const DailyWorkspace = React.lazy(() => import('./features/dailyBatch/DailyWorkspace'))
// 每日生成的自动执行器：无界面，但要**常驻**（用户停在素材库时也要能跑当天的量）
const DailyBatchRunner = React.lazy(() => import('./features/dailyBatch/DailyBatchRunner'))
// 策略（strategy）与下单（ordering）模块已屏蔽：不再懒加载对应工作区，历史 appMode 值兜底渲染素材库
const DetailModal = React.lazy(() => import('./components/DetailModal'))
const AssetViewer = React.lazy(() => import('./features/assetLibrary/AssetViewer'))
const Lightbox = React.lazy(() => import('./components/Lightbox'))
const SettingsModal = React.lazy(() => import('./components/SettingsModal'))
const MaskEditorModal = React.lazy(() => import('./components/MaskEditorModal'))

const FavoriteCollectionPickerModal = React.lazy(() =>
  import('./components/FavoriteCollections').then((m) => ({ default: m.FavoriteCollectionPickerModal })),
)
const ManageCollectionsModal = React.lazy(() =>
  import('./components/FavoriteCollections').then((m) => ({ default: m.ManageCollectionsModal })),
)
const ScheduleModal = React.lazy(() => import('./components/ScheduleModal'))
const ScheduleRunner = React.lazy(() => import('./components/ScheduleRunner'))
const AgentBatchQueueRunner = React.lazy(() => import('./components/AgentBatchQueueRunner'))
const WorkspaceTabManagerModal = React.lazy(() => import('./components/WorkspaceTabManagerModal'))
const UpdateReleaseNotesModal = React.lazy(() => import('./components/UpdateReleaseNotesModal'))
const AssetLibraryWorkspace = React.lazy(() => import('./features/assetLibrary/AssetLibraryWorkspace'))
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { assetCommands } from './lib/assetCommands'

let customProviderConfigUrlImportStarted = false
let storeInitializationPromise: Promise<void> | null = null

function waitForStoreHydration(): Promise<void> {
  if (useStore.persist.hasHydrated()) return Promise.resolve()

  return new Promise((resolve) => {
    const unsubscribe = useStore.persist.onFinishHydration(() => {
      unsubscribe()
      resolve()
    })

    // Avoid missing hydration if it completed between the first check and subscription.
    if (useStore.persist.hasHydrated()) {
      unsubscribe()
      resolve()
    }
  })
}

export default function App() {
  const appMode = useStore((s) => s.appMode)
  const themeMode = useStore((s) => s.settings.themeMode)
  const themeAppliedRef = useRef(false)
  const [startupSafeMode, setStartupSafeMode] = useState(false)
  useGlobalClickSuppression()

  useLayoutEffect(() => {
    const openGallery = () => {
      if (useStore.getState().appMode !== 'gallery') {
        useStore.getState().setAppMode('gallery')
      }
    }

    openGallery()
    return useStore.persist.onFinishHydration(openGallery)
  }, [])

  useEffect(() => {
    let lastShownAt = 0
    const handlePersistError = (event: Event) => {
      const now = Date.now()
      if (now - lastShownAt < 5000) return
      lastShownAt = now
      // 图片/任务写盘没有自动重试，文案不能照搬「程序正在自动重试」（见 docs/optimization-plan.md ℹ-13）
      const namespace = (event as CustomEvent<{ namespace?: string }>).detail?.namespace
      useStore
        .getState()
        .showToast(
          namespace === 'localImage'
            ? '图片保存到本地失败，请检查磁盘空间或目录权限'
            : namespace === 'apiSecretsUnavailable'
              ? '系统密钥库不可用，已保存的 API Key 无法读取，请在「设置 → 模型接口」重新填写'
              : '本地状态保存失败，程序正在自动重试',
          'error',
        )
    }
    window.addEventListener('tangbao:persist-error', handlePersistError)
    return () => window.removeEventListener('tangbao:persist-error', handlePersistError)
  }, [])

  useEffect(() => {
    // Zustand 正式设置为准：应用外观并重写首屏快照
    applyAppearance({ themeMode }, document.documentElement, { transition: themeAppliedRef.current })
    writeAppearanceSnapshot({ themeMode })
    themeAppliedRef.current = true
  }, [themeMode])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onDeepLink) return
    return api.onDeepLink((payload) => {
      const run = async () => {
        if (payload.kind === 'open') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { getAsset } = await import('./lib/assetLibraryRepository')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          const asset = await getAsset(payload.assetId)
          if (asset) {
            useAssetLibraryStore.getState().applyUpsertedAssets([asset])
            useAssetLibraryStore.getState().setActiveAsset(asset.id)
            // 素材详情已改为双击弹窗（2026-09-21）：deep link 打开的直接是弹窗（原先打开的是详情侧栏）
            useAssetLibraryStore.getState().openViewer(asset.id, [asset.id])
          }
          return
        }
        if (payload.kind === 'search') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          useAssetLibraryStore.getState().setScope('all')
          useAssetLibraryStore.getState().setQuery(payload.query)
          return
        }
        if (payload.kind === 'collection') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          useAssetLibraryStore.getState().setScope({ kind: 'collection', id: payload.collectionId })
          useAssetLibraryStore.getState().setQuery('')
          useAssetLibraryStore.getState().setSidebarOpen(true)
          return
        }
        if (payload.kind === 'import') {
          const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
          const { useStore } = await import('./store')
          useStore.getState().setAppMode('gallery')
          await useAssetLibraryStore.getState().importExternalPaths([payload.path])
        }
      }
      void run().catch((error) => console.error('[deep-link] 处理失败', error))
    })
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onLibraryImageFileRemoved) return
    let queue = Promise.resolve()
    return api.onLibraryImageFileRemoved((file) => {
      queue = queue
        .catch(() => {})
        .then(async () => {
          const removed = await removeDeletedLocalImage(file)
          if (removed > 0) {
            useStore.getState().showToast(`本地文件已删除，已同步移除 ${removed} 张图片`, 'info')
          }
        })
        .catch((error) => console.warn('[library-image-sync] 同步删除失败', error))
    })
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onExternalAssetCommand || !api.completeExternalAssetCommand) return
    return api.onExternalAssetCommand(({ id, command }) => {
      const run = async () => {
        const assetId = command.assetId ?? ''
        switch (command.action) {
          case 'useAsReference':
            return assetCommands.useAsReference(assetId)
          case 'openInPostprocess':
            return assetCommands.openInPostprocess(assetId)
          case 'openInComposite':
            return assetCommands.openInComposite(assetId)
          case 'reuseGenerationConfig':
            return assetCommands.reuseGenerationConfig(assetId)
          case 'exportAsset':
            return assetCommands.exportAsset(assetId)
          case 'createCollection': {
            const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
            const saved = await useAssetLibraryStore
              .getState()
              .createCollection(command.name ?? '', command.parentId ?? null)
            return saved ? { collectionId: saved.id } : { error: 'collection_exists' }
          }
          case 'importExternalFiles': {
            const { useAssetLibraryStore } = await import('./features/assetLibrary/store')
            const count = await useAssetLibraryStore.getState().importExternalPaths(command.paths ?? [])
            return { imported: count }
          }
          case 'getAppState':
            return readWorkspaceState(() => useStore.getState())
          case 'setPrompt':
          case 'setParams':
            return applyWorkspaceEdit(command, () => useStore.getState())
          default:
            throw new Error('unsupported external asset command')
        }
      }
      void run().then(
        (result) =>
          api.completeExternalAssetCommand?.({
            id,
            // 回执必须带上真实结果：只回 { success } 会让 agent 拿不到 collectionId / 应用状态
            result: { success: Boolean(result), ...(result && typeof result === 'object' ? result : {}) },
          }),
        (error) =>
          api.completeExternalAssetCommand?.({ id, error: error instanceof Error ? error.message : String(error) }),
      )
    })
  }, [])

  useEffect(() => {
    const startupSettingsPromise = waitForStoreHydration().then(async () => {
      await hydrateDesktopApiSecrets()
      const searchParams = new URLSearchParams(window.location.search)
      const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

      useStore.getState().setSettings(nextSettings)

      if (hasUrlSettingParams(searchParams)) {
        clearUrlSettingParams(searchParams)

        const nextSearch = searchParams.toString()
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', nextUrl)
      }

      const customProviderConfigUrl = getCustomProviderConfigUrl()
      if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
        customProviderConfigUrlImportStarted = true
        void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
          .then((importedSettings) => {
            if (!importedSettings) return
            const state = useStore.getState()
            state.setSettings(mergeImportedSettings(state.settings, importedSettings))
          })
          .catch((error) => {
            console.warn('Failed to import custom provider config URL:', error)
          })
      }
    })

    // Guard against double invocation in StrictMode or hot reload
    if (!(window as unknown as Record<string, unknown>).__storeInitialized) {
      ;(window as unknown as Record<string, unknown>).__storeInitialized = true
      const startupModePromise = window.electronAPI?.getStartupMode?.() ?? Promise.resolve({ safeMode: false })
      storeInitializationPromise = Promise.all([startupModePromise, startupSettingsPromise])
        .then(([{ safeMode }]) => {
          setStartupSafeMode(safeMode)
          return initStore({ safeMode })
        })
        .catch((error) => {
          console.error('Store initialization failed:', error)
          useStore
            .getState()
            .showToast(`启动数据加载失败：${error instanceof Error ? error.message : String(error)}`, 'error')
          throw error
        })
    }

    // 首次使用备份提醒
    void (storeInitializationPromise ?? Promise.resolve())
      .then(() => {
        const state = useStore.getState()
        const MAX_BACKUP_REMINDERS = 3
        if (
          isElectronEnv() &&
          !state.firstBackupReminderShown &&
          state.backupReminderCount < MAX_BACKUP_REMINDERS &&
          state.tasks.length === 0 &&
          state.agentConversations.length === 0
        ) {
          getBackupList().then(async (backups) => {
            let hasUsableBackup = false
            let usableBackupPath = ''
            for (const bp of backups) {
              if (await checkBackupHasData(bp)) {
                hasUsableBackup = true
                usableBackupPath = bp
                break
              }
            }
            if (hasUsableBackup) {
              const fileName = usableBackupPath.split(/[\\/]/).pop() || usableBackupPath
              const match = fileName.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-\d+\.json$/)
              const displayDate = match
                ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
                : fileName
              useStore.getState().setConfirmDialog({
                title: '检测到备份',
                message: `应用数据为空，检测到可用的自动备份（${displayDate}）。是否从该备份恢复？`,
                confirmText: '恢复',
                cancelText: '忽略',
                action: async () => {
                  const success = await restoreFromBackupFile(usableBackupPath)
                  if (success) {
                    useStore.getState().setFirstBackupReminderShown(true)
                    useStore.getState().showToast('备份已恢复，请刷新页面以生效', 'success')
                  } else {
                    useStore.getState().showToast('恢复备份失败', 'error')
                    const nextCount = useStore.getState().backupReminderCount + 1
                    useStore.getState().setBackupReminderCount(nextCount)
                    if (nextCount >= MAX_BACKUP_REMINDERS) {
                      useStore.getState().setFirstBackupReminderShown(true)
                    }
                  }
                },
              })
            } else {
              const nextCount = useStore.getState().backupReminderCount + 1
              useStore.getState().setBackupReminderCount(nextCount)
              if (nextCount >= MAX_BACKUP_REMINDERS) {
                useStore.getState().setFirstBackupReminderShown(true)
              }
              useStore.getState().setConfirmDialog({
                title: '建议备份',
                message: '首次使用建议立即备份数据，以便在需要时恢复。是否现在备份到桌面？',
                confirmText: '备份到桌面',
                cancelText: '稍后再说',
                action: async () => {
                  const desktop = await getDesktopPath()
                  if (!desktop) {
                    useStore.getState().showToast('无法获取桌面路径', 'error')
                    return
                  }
                  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
                  const bkFileName = `tangbao_backup_${ts}.zip`
                  const filePath = desktop.replace(/\\/g, '/') + '/' + bkFileName
                  useStore.getState().showToast('正在生成备份...', 'info')
                  const success = await exportDataToPath(
                    filePath,
                    { exportConfig: true, exportTasks: true, exportImages: false, exportAssets: true },
                    { showErrorToast: false },
                  )
                  if (success.success) {
                    useStore
                      .getState()
                      .showToast(
                        success.omittedCount > 0
                          ? `备份已保存到桌面：${bkFileName}（跳过 ${success.omittedCount} 张缺失图片）`
                          : `备份已保存到桌面：${bkFileName}`,
                        'success',
                      )
                  } else {
                    useStore.getState().showToast('备份保存失败', 'error')
                  }
                },
              })
            }
          })
        }

        // 每周自动备份（并入导出流程：复用同一条 exportDataToPath 管线，不再另开一套）
        if (isElectronEnv()) {
          const lastBackup = state.lastAutoBackupAt
          const oneWeek = 7 * 24 * 60 * 60 * 1000
          if (Date.now() - lastBackup >= oneWeek) {
            void (async () => {
              const store = useStore.getState()
              // ⚠️ 落到**库根 backups/**：此前写桌面，而设置页「备份列表」读的是库根/状态目录，
              //    导致自动备份产生的文件从不出现在列表里 —— 这是「自动备份不生效」的首因。
              const backupsDir = await getLibraryBackupsPath()
              if (!backupsDir) {
                store.setLastAutoBackupError('未找到库根备份目录，自动备份未执行')
                return
              }
              const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
              const filePath = `${backupsDir.replace(/\\/g, '/')}/${AUTO_BACKUP_FILE_PREFIX}${ts}.zip`
              try {
                const result = await exportDataToPath(
                  filePath,
                  { exportConfig: true, exportTasks: true, exportImages: false, exportAssets: true },
                  { showErrorToast: false },
                )
                if (!result.success) throw new Error('导出未成功')
                store.setLastAutoBackupAt(Date.now())
                store.setLastAutoBackupError(null)
                // 保留最近 N 份：此前不清理，目录里会无限堆积
                void pruneLibraryBackupsInDir(backupsDir, AUTO_BACKUP_FILE_PREFIX, AUTO_BACKUP_KEEP)
                store.showToast(
                  result.omittedCount > 0
                    ? `自动备份已保存（跳过 ${result.omittedCount} 张缺失原图）`
                    : '自动备份已保存',
                  'success',
                )
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                // 失败必须可见：过去只 console.warn，用户「以为有备份、其实一次都没成功」
                store.setLastAutoBackupError(message)
                store.showToast(`自动备份失败：${message}`, 'error')
                console.error('每周自动备份失败:', error)
              }
            })()
          }
        }
      })
      .catch(() => {
        // Initialization already reported the error; never create an incomplete backup.
      })
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const legacyWorkspace = (
    <ErrorBoundary>
      {appMode === 'agent' && <WorkspaceTabBar />}
      <AppPageRail enabled={appMode === 'gallery' || appMode === 'agent'} />
      <div className="app-shell-with-docked-panels">
        <Header />
        {startupSafeMode && (
          <div className="safe-area-x mx-auto max-w-7xl px-4 pt-3">
            <div className="rounded-ds-lg border border-ds-warning/35 bg-ds-warning-subtle px-4 py-3 text-sm text-ds-warning dark:border-ds-warning/40 dark:bg-ds-warning/10 dark:text-ds-warning">
              已进入安全模式：后台图片迁移和历史缩略图回填已暂停。请先备份或清理数据后重新启动。
            </div>
          </div>
        )}
        {appMode === 'agent' ? (
          <React.Suspense fallback={null}>
            <AgentWorkspace />
          </React.Suspense>
        ) : appMode === 'postprocess' ? (
          // 水印预设工作区：顶栏一个 tab，与素材库 / Agent 同级。
          // 它自带撤销栈与画布编辑快捷键，所以是「工作区」而不是面板；但不再盖在素材库上，
          // 因为归属要边看项目树边配，弹窗形式会让下层内容既不可用又占着版面。
          <React.Suspense fallback={null}>
            <CompositeWorkspace />
          </React.Suspense>
        ) : appMode === 'daily' ? (
          // 每日生成：策略卡 / 每日任务 / 预览审核 三步在同一条流水线上，
          // 卡与数量配一次长期有效，每天只看「预览审核」，所以它是这个工作区的默认分区。
          <React.Suspense fallback={null}>
            <DailyWorkspace />
          </React.Suspense>
        ) : (
          // 单一画廊模式：素材库（收藏夹概览 / 收藏夹素材 / 图片与批次分组都在素材库界面内完成）；
          // 已屏蔽的 strategy / ordering 模式同样兜底到这里
          <React.Suspense fallback={null}>
            <AssetLibraryWorkspace />
          </React.Suspense>
        )}
        {(appMode === 'gallery' || appMode === 'agent') && <InputBar />}
        <React.Suspense fallback={null}>
          <DetailModal />
          {/*
           * 素材详情弹窗挂在**顶层**（与 DetailModal / Lightbox 同级），不再放进素材库工作区。
           *
           * 2026-09-21 实测：放在 `<main>` 里时遮罩层盖不住顶栏、弹窗也偏到下方 ——
           * 它的定位基准被框在「顶栏之下」的那块区域，而不是视口。弹窗本来就该挂顶层。
           */}
          <AssetViewer />
          <Lightbox />
          <SettingsModal />
          <ConfirmDialog />
          <PromptInputDialog />

          <FavoriteCollectionPickerModal />
          <ManageCollectionsModal />
          <Toast />
          <MaskEditorModal />
          <ImageContextMenu />
          <ScheduleModal />
          <ScheduleRunner />
          <AgentBatchQueueRunner />
          <DailyBatchRunner />
          <WorkspaceTabManagerModal />
          <UpdateReleaseNotesModal />
        </React.Suspense>
        {/* 水印预设已升为同级工作区（见上方 appMode === 'postprocess' 分支），不再有弹窗形态 */}
      </div>
    </ErrorBoundary>
  )

  return (
    <ErrorBoundary>
      <RequirementQueueRunner />
      {legacyWorkspace}
    </ErrorBoundary>
  )
}
