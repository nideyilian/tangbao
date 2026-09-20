# docs 索引

> **本文件回答"哪份文档现在还算数"。**
> 标注规则：**现行** = 描述糖包当前系统，随代码更新 ｜ **参考** = 历史依据，不再更新 ｜ **归档** = 已完成的实施计划，无指导价值。
> 建立于 2026-09-18（此前没有任何生命周期标记，豆泡时代产物与糖包现状混在同一目录）。
> 分层与单一真相源规则见 `docs/pm-upgrade-plan.md` 第三节。

## 项目管理（先看这几个）

| 文件                                                           | 作用                                                                                               | 状态                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`ROADMAP.md`](ROADMAP.md)                                     | 唯一目标源：里程碑与完成判据                                                                       | 现行                             |
| [`BACKLOG.md`](BACKLOG.md)                                     | 唯一需求池：`TB-###` 状态与验收                                                                    | 现行                             |
| [`RISK.md`](RISK.md)                                           | 唯一风险登记册：`R-###` 分级与缓解                                                                 | 现行                             |
| [`work-protocol.md`](work-protocol.md)                         | 写线协议 + 开工/收工清单 + 角色边界                                                                | 现行                             |
| [`adr/`](adr/README.md)                                        | 决策记录：为什么不那么做                                                                           | 现行                             |
| [`pm-upgrade-plan.md`](pm-upgrade-plan.md)                     | 项目管理升级的诊断与方案（一次性报告）                                                             | 参考                             |
| [`redundancy-audit.md`](redundancy-audit.md)                   | **冗余功能盘点**：保留 / 整合 / 删除三分，含逐项引用计数证据（对应 `TB-034`~`TB-038`）             | 现行                             |
| [`data-portability-redesign.md`](data-portability-redesign.md) | **数据管理精简整合方案**：三套机制收敛为「导出 / 导入」，含风险四项评估与改造清单（对应 `TB-039`） | 现行 · **待杰哥裁决 3 点后开工** |

## 操作配方与规范

| 文件                                                             | 作用                                                                                                                     | 状态 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---- |
| [`architecture-constraints.md`](architecture-constraints.md)     | **哪些设计勿改回**：性能基线 / 生图编排 / 协议约束 / 后处理与项目树模型 / 持久化 / UI 约定                               | 现行 |
| [`tangbao-ops-runbook.md`](tangbao-ops-runbook.md)               | **唯一操作配方**：持久化铁律 / 本地验收 / 抓渲染报错 / 调试装置 / API 三层解析 / 推 GitHub 与查 CI / 批量写 localStorage | 现行 |
| [`asset-kernel.md`](asset-kernel.md)                             | 素材内核（SQLite + UtilityProcess）说明                                                                                  | 现行 |
| [`mock-image-api.md`](mock-image-api.md)                         | 本地模拟生图接口，零成本验证链路                                                                                         | 现行 |
| [`library-smoke-checklist.md`](library-smoke-checklist.md)       | 素材库手工冒烟清单                                                                                                       | 现行 |
| [`custom-provider-llm-prompt.md`](custom-provider-llm-prompt.md) | 自定义服务商配置的 LLM 提示词                                                                                            | 现行 |

## 方案 / 设计（糖包时期）

| 文件                                                                                                                         | 作用                                                                               | 状态 |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---- |
| [`ui-retrofit-plan.md`](ui-retrofit-plan.md)                                                                                 | 主工作台首屏改造方案（含已实施记录与验收证据）                                     | 现行 |
| [`postprocess-export-diagnosis.md`](postprocess-export-diagnosis.md)                                                         | **导出/后处理四问题定位报告**（含端到端复现证据，对应 `TB-049` / `R-62`）          | 现行 |
| [`config-centralization-assessment.md`](config-centralization-assessment.md)                                                 | **常量集中化评估报告**（177 常量实测归类 + 三档分层方案，对应 `TB-051`）           | 现行 |
| [`reference-lingjing-asset-center.md`](reference-lingjing-asset-center.md)                                                   | **参考「灵境·资产中心」的全局参数管理评估**（同源数据的另一端解法，对应 `TB-052`） | 现行 |
| [`postprocess-unify-on-hanling-plan.md`](postprocess-unify-on-hanling-plan.md)                                               | 后处理统一到瀚灵编排的完整方案（**当前主线**，第九节是实现要点）                   | 现行 |
| [`hanling-postprocess-replica-plan.md`](hanling-postprocess-replica-plan.md)                                                 | 复刻瀚灵后处理链路的原始方案                                                       | 参考 |
| [`output-location-import-2026-09-18.md`](output-location-import-2026-09-18.md)                                               | 《输出位置明细》导入记录 + 三条定案                                                | 现行 |
| [`sop-image-generation-interaction-redesign.md`](sop-image-generation-interaction-redesign.md)                               | SOP 生图交互改版                                                                   | 参考 |
| [`sop-management-center-features.md`](sop-management-center-features.md)                                                     | SOP 管理中心功能设计                                                               | 参考 |
| [`sop-prompt-to-image-full-flow.md`](sop-prompt-to-image-full-flow.md)                                                       | SOP 提示词到出图全链路                                                             | 现行 |
| [`sop-parameters-editor-layout-analysis.md`](sop-parameters-editor-layout-analysis.md)                                       | SOP 参数编辑器布局分析                                                             | 参考 |
| [`strategy-workspace-migration.md`](strategy-workspace-migration.md)                                                         | 策略工作区迁移                                                                     | 归档 |
| [`ordering-workspace-migration.md`](ordering-workspace-migration.md)                                                         | 下单工作区迁移                                                                     | 归档 |
| [`requirement-ordering-local-prototype-prd.md`](requirement-ordering-local-prototype-prd.md)                                 | 需求下单原型 PRD（1742 行）                                                        | 参考 |
| [`requirement-ordering-local-prototype-implementation-plan.md`](requirement-ordering-local-prototype-implementation-plan.md) | 上文实施计划                                                                       | 归档 |
| [`gallery-sop-batch-task-card-implementation.md`](gallery-sop-batch-task-card-implementation.md)                             | 批次任务卡实施记录                                                                 | 归档 |
| [`word-library-quick-panel-spec.md`](word-library-quick-panel-spec.md)                                                       | 词库快捷面板规格                                                                   | 参考 |
| [`merge-feasibility-variable-prompt.md`](merge-feasibility-variable-prompt.md)                                               | 变量提示词合并可行性                                                               | 参考 |
| [`prompt-library-modal-optimization.md`](prompt-library-modal-optimization.md)                                               | 提示词库弹窗优化                                                                   | 归档 |
| [`store-split-plan.md`](store-split-plan.md)                                                                                 | store 拆分计划（**未执行**，见 TB-022）                                            | 参考 |
| [`eagle-interaction-gap-analysis.md`](eagle-interaction-gap-analysis.md)                                                     | Eagle 交互差距分析                                                                 | 参考 |
| [`analysis-doupao-liangnianban.md`](analysis-doupao-liangnianban.md)                                                         | 竞品分析                                                                           | 参考 |

## AI / Agent 相关

| 文件                                                                                           | 作用                       | 状态 |
| ---------------------------------------------------------------------------------------------- | -------------------------- | ---- |
| [`agent-batch-workbench-implementation-plan.md`](agent-batch-workbench-implementation-plan.md) | Agent 批量工作台实施计划   | 参考 |
| [`agent-hybrid-batch-image-failure-fix.md`](agent-hybrid-batch-image-failure-fix.md)           | Agent 混合批量出图失败修复 | 现行 |
| [`agent-image-grid-concurrency-feasibility.md`](agent-image-grid-concurrency-feasibility.md)   | 图片网格并发可行性         | 参考 |

## 豆泡（DOUPAO）时期遗产 —— 基线已过时

> ⚠️ 这些文档的结论基于 **豆泡 v0.8.x**（`docs/project-health-audit.md` 自己标注基线 `v0.8.19` / `edc7db4`）。
> 糖包 rebrand 后未重新审计。**结论可能仍适用，但引用前必须先核对当前代码。**

| 文件                                                                                     | 说明                                                 | 状态                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------- |
| [`project-health-audit.md`](project-health-audit.md)                                     | 全仓体检报告（P1-1「声称改了但没落地」的完整证据链） | 参考（基线 v0.8.19） |
| [`performance-diagnosis.md`](performance-diagnosis.md)                                   | 性能诊断 9 项修复的定位依据与实测数字                | 参考（基线 v0.8.x）  |
| [`optimization-plan.md`](optimization-plan.md)                                           | 优化计划                                             | 参考（基线 v0.8.x）  |
| [`code-optimization-audit.md`](code-optimization-audit.md)                               | 代码优化审计                                         | 参考                 |
| [`revert-generation-0.7.56-asset-library.md`](revert-generation-0.7.56-asset-library.md) | 回退到 0.7.56 素材库的说明                           | 归档                 |

## 其他资产

| 路径                                  | 说明                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `superpowers/plans/`（53 文件）       | 规格驱动开发的实施计划（截至 2026-08-20，**已断档**）。模式值得恢复，历史条目建议移入 `archive/` |
| `superpowers/specs/`                  | 设计规格（被 `PRODUCT.md:49,66` 引用）                                                           |
| `audits/`（2 子目录）                 | 分主题审计（命名模板 / 后处理）                                                                  |
| `*-prototype.html` / `*-options.html` | 交互原型（保留可查）                                                                             |
| `tangbao-architecture.html` / `.json` | 架构可视化                                                                                       |
| `images/`                             | 文档插图                                                                                         |

---

## 待办（见 `docs/BACKLOG.md` TB-028）

- [ ] 完成全部条目的 现行/参考/归档 标记（本索引为第一版）
- [ ] 把「归档」类移入 `docs/archive/`，根目录只留现行与参考
- [ ] 恢复 `superpowers/plans/` 的规格驱动实践（或明确废弃并说明替代方案）
