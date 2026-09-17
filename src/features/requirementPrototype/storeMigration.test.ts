import { describe, expect, it } from 'vitest'
import { REQUIREMENT_PROTOTYPE_STORE_VERSION, migrateRequirementPrototypeState } from './store'
import { seedSopGroups, seedSopMetaInstructions } from '../strategy/sopLibrary'

describe('requirement prototype store migration', () => {
  it('upgrades existing workspaces and injects the prompt reverse SOP compiler', () => {
    const existingInstruction = {
      ...seedSopMetaInstructions()[0],
      instruction: '用户修改后的通用元指令',
    }

    const migrated = migrateRequirementPrototypeState({
      strategyAssets: [],
      strategyPresets: [],
      sopGroups: [],
      sopLibrary: [],
      sopMetaInstructions: [existingInstruction],
      strategyAssetVersions: {},
    })

    expect(REQUIREMENT_PROTOTYPE_STORE_VERSION).toBe(6)
    expect(migrated.sopMetaInstructions.find((item) => item.id === existingInstruction.id)?.instruction).toBe(
      '用户修改后的通用元指令',
    )
    expect(migrated.sopMetaInstructions.find((item) => item.id === 'sop-meta-prompt-reverse')).toMatchObject({
      name: '提示词反推 SOP 编译器',
      kind: 'prompt-reverse',
    })
    expect(migrated.sopVersionHistory).toEqual({})
  })

  it('补齐旧分组的层级字段，并保留用户既有的分组数据', () => {
    const legacyGroups = seedSopGroups().map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      updatedAt,
    }))

    const migrated = migrateRequirementPrototypeState({
      strategyAssets: [],
      strategyPresets: [],
      sopGroups: legacyGroups,
      sopLibrary: [],
      sopMetaInstructions: [],
      strategyAssetVersions: {},
    })

    // 旧数据没有 parentId：补齐为根级，名称与既有分组一并保留
    expect(migrated.sopGroups).toHaveLength(legacyGroups.length)
    expect(migrated.sopGroups.map((group) => group.name)).toEqual(legacyGroups.map((group) => group.name))
    expect(migrated.sopGroups.every((group) => (group.parentId ?? null) === null)).toBe(true)
  })
})
