# Generated Image Filenames Design

## Goal

Use one configurable filename policy for generated images saved by Electron and downloaded individually, in batches, or inside ZIP archives.

## Settings

- `imageFilenameDatePrefix`: defaults to `true`.
- `imageFilenameUsePrompt`: defaults to `false`.

Both settings are persisted and shown in the data settings UI.

## Filename Policy

The ordered filename parts are:

1. The task's local generation date (`YYYYMMDD`) when enabled.
2. The owning workspace tab name.
3. The task batch number (组序号; shared by every member of a series group — see below).
4. The task prompt when enabled.
5. A one-based image sequence (组内顺序序号 for series groups).

Examples:

- `20260703-快手-1.png`
- `20260703-快手-提示词-1.png`
- `快手-提示词-1.png`
- `快手-1.png`

The date comes from `TaskRecord.createdAt`, so downloading an older image retains its original date.

The label comes from the workspace tab that owns the task. If no tab owns it, use the scheduled output subfolder, effective output directory name, then `image`.

Filename parts are trimmed, all whitespace (including line breaks) is collapsed to one space, Windows-invalid characters and control characters are replaced with `-`, and the prompt portion is limited to 100 characters.

## Sequence Policy

Electron automatic saving reads the target directory once for a task save operation, finds the largest sequence matching the generated prefix, and continues from the next value. The scan and all writes in that operation are serialized with other automatic-save operations so simultaneous tasks cannot reserve the same names.

Browser downloads cannot inspect the user's download folder. They therefore retain each image's original one-based position in `TaskRecord.outputImages`. Browser collision handling remains responsible for files already present on disk.

ZIP archive names stay unchanged. Only image entries inside ZIP files use the new names; duplicate entry names receive the existing numeric collision suffix.

## Series Groups (系列图)

A series SOP group is submitted as several member tasks (one per prompt), so the group must share one batch number:

- The group identifier (组序号) is the task batch number. The first member of a group allocates the next batch number; every later member of the same group (`sopBatch.batchId` + `series.groupIndex`) reuses it, together with the batch-folder path when `imageSaveLayout` is `batch-folder`.
- The in-group order (组内顺序序号) is `(seriesIndex - 1) × imagesPerPrompt + imageIndexInTask + 1`, so it is independent of submission/completion order, starts at 1, and stays continuous.
- Resulting names read `X-组序号-组内顺序序号`, e.g. `20260703-快手-5-1`, `20260703-快手-5-2` for one two-image group and `20260703-快手-6-1` for the next group.
- Regenerating a batch (`rerunSopBatchTasks`, `retryTask` with a new `batchId`) allocates a fresh group number, so new files never collide with the previous run. A single member retry keeps the group number and continues the group's sequence.
- Non-series tasks are unchanged (`findNextGeneratedImageSequence` directory continuation).

## Integration Points

- Electron automatic save.
- Detail modal single/all/partial downloads.
- Image context-menu single/all downloads.
- Selected-task and favorite-collection downloads.
- Agent round downloads.
- ZIP image entries used by those routes.

Non-generated images retain their existing fallback naming.

## Verification

- Pure filename tests cover all setting combinations, sanitization, local date, truncation, fallback labels, and sequence continuation.
- Settings tests cover defaults and explicit values.
- Local-save tests cover exact filename bases and no-overwrite behavior.
- Download-entry tests cover task/tab ownership and original image positions.
- Store tests cover directory continuation and multi-image consecutive names.
- The complete test suite and production build must pass.
