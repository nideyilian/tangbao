# -*- coding: utf-8 -*-
"""一次性改造脚本：糖包拆分的 legacy 导入解耦（跑完即删）。"""
import io

# 1) legacy-data-import.ts: 源用旧名，目标用新应用的状态文件名
p = 'electron/legacy-data-import.ts'
s = io.open(p, encoding='utf-8').read()
old = '''  if (selection.importState) {
    copyFileIfMissing(
      path.join(sourceDir, STATE_FILE),
      path.join(userDataDir, STATE_FILE),
      imported,
      skipped,
      '标签工作区与设置（状态文件）',
    )
    copyFileIfMissing(
      path.join(sourceDir, STATE_FILE + '.bak'),
      path.join(userDataDir, STATE_FILE + '.bak'),
      imported,
      skipped,
      '状态文件备份(.bak)',
    )
  }'''
new = '''  if (selection.importState) {
    // 源是旧版本的状态文件名（gpt-image-playground.json）；落到当前 userData 用本应用的新文件名，
    // 否则导入的数据本应用永远读不到。目标名与 ipc-handlers.ts / store.ts 保持一致。
    copyFileIfMissing(
      path.join(sourceDir, STATE_FILE),
      path.join(userDataDir, TARGET_STATE_FILE),
      imported,
      skipped,
      '标签工作区与设置（状态文件）',
    )
    copyFileIfMissing(
      path.join(sourceDir, STATE_FILE + '.bak'),
      path.join(userDataDir, TARGET_STATE_FILE + '.bak'),
      imported,
      skipped,
      '状态文件备份(.bak)',
    )
  }'''
assert old in s, 'import block not found'
s = s.replace(old, new)
old_imp = "import { LEGACY_APP_DIR_NAMES, LOCAL_SETTINGS_FILE, STATE_FILE } from './legacy-data-migration'"
new_imp = old_imp + "\n\n/** 本应用（糖包）自己的状态文件名；旧版本状态文件名见 legacy-data-migration.ts 的 STATE_FILE。 */\nconst TARGET_STATE_FILE = 'tangbao.json'"
assert old_imp in s, 'import line not found'
s = s.replace(old_imp, new_imp)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

# 2) legacy-data-migration.ts: 历史目录列表追加 doupao v2（供手动导入扫描）
p = 'electron/legacy-data-migration.ts'
s = io.open(p, encoding='utf-8').read()
old = "  'doupao-liangnianban',\n]"
new = ("  'doupao-liangnianban',\n"
       "  // 糖包的「手动导入」允许从 DOUPAO V2 搬数据；自动迁移已在 main.ts 移除，本列表只影响手动导入扫描。\n"
       "  'doupao v2',\n]")
assert old in s, 'dir list not found'
s = s.replace(old, new)
s = s.replace('/** 历史版本使用过的 userData 目录名（大小写不敏感匹配；当前目录名 DOUPAO V2 不在其中）。 */',
              '/** 历史版本使用过的 userData 目录名（大小写不敏感匹配），供手动导入扫描；含糖包的前身 DOUPAO V2。 */')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('legacy files done')
