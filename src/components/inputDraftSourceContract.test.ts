import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// 生图输入「按素材库文件夹隔离」的单一实现契约
//
// 这件事只能有一处实现：store 的 `folderInputDrafts`（由 `AssetLibraryWorkspace`
// 订阅素材库 scope 变化触发，见 store.ts 的 `onAssetLibraryFolderScopeChange`）。
// 它同时保存 **提示词 + 参数 + 参考图 + 遮罩**，所以两者永远同进退。
//
// 2026-09-28 实故：InputBar 里曾另有一套 localStorage 草稿，只存提示词、
// 且只在「切走那一刻」写一次。切文件夹时两套同时恢复 —— store 先把「提示词 + 尺寸」
// 一起换到目标文件夹，紧接着旧那套拿过期的提示词把输入框盖回去、尺寸却不动，
// 界面表现为「输入框写着 画面比例为:9:16、下面尺寸选着 16:9」。
// 而提示词里的比例会随请求一起发出去（很多网关忽略 `size`、只认提示词，见
// `lib/aspectRatioPrompt.ts`），所以这个不一致会**真的影响出图**。
//
// 下面的断言是源码级守卫：把第二套草稿加回来就会红。
// ---------------------------------------------------------------------------

const inputBarSource = readFileSync(fileURLToPath(new URL('./InputBar.tsx', import.meta.url)), 'utf8')
const storeSource = readFileSync(fileURLToPath(new URL('../store.ts', import.meta.url)), 'utf8')

describe('生图输入草稿的单一实现契约', () => {
  it('守卫本身有覆盖面，避免读错文件后静默失效', () => {
    expect(inputBarSource.length).toBeGreaterThan(10000)
    expect(inputBarSource).toContain('export default function InputBar')
    expect(storeSource).toContain('getFolderInputDraftFromState')
  })

  it('InputBar 不再自带「按文件夹存提示词」的第二套草稿', () => {
    expect(inputBarSource).not.toContain('gallery-input-draft')
    expect(inputBarSource).not.toMatch(/readGalleryInputDraft|writeGalleryInputDraft|getGalleryInputDraftKey/)
    expect(inputBarSource).not.toMatch(/galleryPromptFolderRef/)
  })

  it('权威实现同时保存提示词与参数（少一样就会重演「一个回退、一个不回退」）', () => {
    expect(storeSource).toMatch(/type FolderInputDraft = \{[^}]*prompt: string[^}]*params: TaskParams/s)
    expect(storeSource).toMatch(/function getFolderInputDraftFromState[\s\S]{0,200}prompt: state\.prompt/)
    expect(storeSource).toMatch(/function getFolderInputDraftFromState[\s\S]{0,300}params: state\.params/)
  })
})
