# 0005 持久化版本升级一律用「丢弃式」迁移

- **日期**：2026-09-18
- **状态**：生效中
- **决策者**：杰哥（产品负责人）+ 实现层取舍

## 背景

糖包有多套独立持久化：`store.ts`（persist v4）、`assetLibrary/store.ts`（v6）、
`composite/storeV2.ts`（localStorage，已升到 v5）、`postprocessMedia`（SQLite，v2）。
它们**没有共享持久化层**，每套各自 `version` + `migrate`。

一个反复出现的判断是：**字段语义变了之后，旧数据要不要"换算"到新模型？**

具体案例（2026-09-18 A 套编排退役）：

- `CompositeV2Preset` 剥掉了 7 个编排字段（`outputRootPath` / `distributionPath` / `filenameTemplate` /
  `namingTemplate` / `customVariableValues` / `useOutputOverrides` / `outputRuleGroupsOverride`）。
- 这些字段在新模型里**没有对应物** —— 位置与命名由「项目树参数 + 媒体表」决定。
- 另一个案例：预设组退役（`CompositeV2State.presetGroups` 整块删除）。

同时有一个容易忽略的机制约束：**不 bump version，zustand 不会触发 `migrate`，
旧字段会被静默丢弃 → 用户已配的数据消失**。

## 决策

**落盘版本 bump 时，一律用丢弃式迁移：删掉的字段直接丢，不做换算，也不保留兼容分支。**

细则：

1. 语义变了的字段 → **bump version + 丢弃式 migrate**（只保留能无损映射的部分）。
2. **保留为兼容字段**只允许一种情形：**备份 / 导出链路仍要读写它**（例如已下线的标签体系
   `AssetTag` / `tagIds` —— 界面入口全删，但备份可无损恢复）。
3. 版本号必须 bump，**不能只改字段**。

## 理由

- **丢弃比换算更安全**：把旧字段硬映射到新模型，会造出一份"看起来还算数"的配置，
  用户以为自己在沿用旧设置，实际生效逻辑已经变了。**留着会被当成"还算数"** —— 这是 A 套退役时
  明确写下的理由。
- **兼容分支的成本是永久的**：每个 `if (oldShape)` 都要在后续所有改动中被考虑一次。
  这个项目一天内改过 3 次以上持久化语义，兼容分支会迅速失控。
- **bump 是必须的**：不 bump 时旧字段被静默丢弃且**没有任何提示** —— 用户配置消失而界面不报错，
  属于最坏的一类 bug（`RISK.md` R-26）。

**被否决的方案**：写换算函数把旧编排字段映射成新的项目树参数。
否决原因：映射关系不存在（"预设级的输出根"在新模型里不属于预设），硬凑会造出双真相源。

## 后果

- **正面**：模型干净，没有"历史分支"；每次语义变更的边界清晰可测（有 migrate 测试）。
- **代价 / 知情取舍**：用户升级后**旧的自定义配置会丢**（这是知情接受的，不是疏漏）。
  因此只有"能无损映射"的部分才做迁移（例如默认值：A 套的
  `createDefaultCompositeV2OutputRuleGroups()` 与 `DEFAULT_POSTPROCESS_MEDIA` **完全重复**
  → 默认值无需迁移，只需搬用户**改过**的规则，见 TB-016）。
- **对后续代码的约束**：
  - 新增持久化 store 必须**同时**登记 `electron/asset-kernel.ts` 的 namespace 白名单，
    否则完全存不住而 UI 不报错（`RISK.md` R-07）。
  - `read` 不能用「返回值是否字符串」判有效性；读失败或格式不认 → **降级态 + 拒绝本会话写盘**
    （宁可改动不落盘，也不覆盖真实数据，`RISK.md` R-14）。
  - 删 storeV2 字段时，注意 `store.ts:12093` 的 `buildCompositeBackup` 依赖
    `getCompositeV2PersistedState`，要同步。

**证据**：`storeV2.ts`（v3 → v4 剥字段、v4 → v5 删预设组）、`storePostprocessMedia.ts`（v1 → v2）、
`desktopJsonStorage.ts`（三种编码兼容 + 降级态）、`desktopJsonStorage.test.ts`（8 用例）。
