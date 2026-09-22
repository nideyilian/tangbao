# 0011 节点覆盖收窄到 3 字段（收口 0010 的四个待定问题）

- **日期**：2026-09-20
- **状态**：**生效中（已实现）**，但 ⚠️ **裁决 #3 已被 [0013](0013-participation-follows-direction.md) 推翻**
- **决策者**：杰哥（产品负责人）
- **相关**：[0010](0010-param-center-scope-correction.md)（本条的出发认知）、
  [0003](0003-postprocess-channel-override.md)（按渠道覆盖）、TB-050、R-63

> ⚠️ **2026-09-23 修订提示（二）**：裁决 #4 里的 **`distribution`** 部分
> **已被 [0017](0017-distribution-schedule-follows-direction.md) 推翻** —— 排期（铺几天 / 跳过周末）
> 回到了节点层。**同一条裁决里的 `autoCompanionClean` 那部分已随字段删除失效**（TB-107）。
> 读下面「刻意收窄掉的字段」那张表时请连同 0013、0017 一起看，不要把 `distribution` 再收走一次。
>
> ⚠️ **2026-09-21 修订提示**：下方表格里的裁决 #3（「节点级渠道勾选 —— 不需要，我自己勾选」）
> **已被 [0013](0013-participation-follows-direction.md) 推翻**：`selectedMediaIds` 回到了节点层，
> 节点覆盖现在是 **4 字段 + `byMedia`**。本文件其余部分（尤其 §三 的 R-63 迁移设计）
> 仍然有效，**但读「刻意收窄掉的字段」那张表时请连同 0013 一起看**，
> 不要把 `selectedMediaIds` 按本文件的口径再收走一次。

## 背景：杰哥对 ADR-0010 四个问题的裁决

ADR-0010 末尾列了 4 个待回答问题。杰哥逐条回答：

| #   | 问题                  | 裁决                   |
| --- | --------------------- | ---------------------- |
| 1   | 命名模板 / 创作者     | **全局**               |
| 2   | 画面方向（横竖）      | **按源图自动判**       |
| 3   | 节点级渠道勾选        | **不需要，我自己勾选** |
| 4   | 纯净版伴随 / 分发排期 | **确定（按全局一套）** |

对第 2 点另确认取 **A 方案**：从节点覆盖里删除 `direction`，**不提供任何手选覆盖口子**，
彻底靠 `resolveOutputDirection(width, height)` 按源图判定。

---

## 一、决策：`PostprocessNodeOverride` 10 字段 → 3 字段（+ `byMedia`）

```ts
export interface PostprocessNodeOverride {
  outputDir?: string // 与方向直接相关（ADR-0003：25/61 个方向目录分叉）
  watermarkPresetIds?: string[] // 与方向直接相关（ADR-0003：56/61 个方向水印分叉）
  enabled?: boolean // 「这个方向要不要跑」——节点自有语义
  byMedia?: Record<string, PostprocessMediaOverride> // 同层按渠道再细分（仅目录 + 水印）
}
```

**收窄掉的 6 个字段与理由**：

| 字段                 | 处置     | 理由                                             |
| -------------------- | -------- | ------------------------------------------------ |
| `namePattern`        | 上收全局 | 命名规则全局一套，逐方向配只会让文件名口径分散   |
| `creator`            | 上收全局 | 同上                                             |
| `autoCompanionClean` | 上收全局 | 属于「全局怎么跑」，无逐方向差异证据             |
| `distribution`       | 上收全局 | 同上                                             |
| `direction`          | **删除** | 按源图自动判，不给手选口子（A 方案）             |
| `selectedMediaIds`   | **删除** | 「勾哪些渠道」是运行时操作，不需要落成逐方向配置 |

**旁证**：`postprocessMedia.ts:276` 的既有注释早就写明 `byMedia` 层刻意不开放这四项，
理由是「要么是全局规格，要么是『这个节点要不要跑』的开关，按渠道分只会让『到底哪个值生效』
需要递归推理」。本次裁决与那段判断**同一个方向**，只是当时节点层没跟上。

---

## 二、配套改动

### 全局层同步移除 `direction` 的手选入口

`PostprocessMediaConfig.direction` 是**全局基线的可选强制覆盖**（`buildPostprocessOutputs`：
`input.direction ?? 自动判`）。既然按源图自动判，全局层也不再提供手选。
**注意**：`OutputDirection` 类型与 `resolveOutputDirection` **保留** —— 自动判定逻辑仍需要它。

### 界面：`paramSchema` 5 个字段 `scope: both → global`

`POSTPROCESS_PARAM_FIELDS` 里的 `selectedMediaIds` / `direction` / `namePattern` / `creator` /
`autoCompanionClean` / `distribution` 全部改为 `scope: 'global'`、`resettable: false`。
节点上不再渲染这些控件（面板按 `scope` 过滤，零代码改动即生效）。
节点层最后只剩「参与自动后处理」（`enabled`）+「输出与命名」（`outputDir` + 渠道表）+
水印归属（只读）。

---

## 三、⚠️ R-63：旧值必须被接住，否则静默丢失

**这是本次唯一的真实数据风险，已实现迁移。**

字段集一收窄，旧数据里挂在节点上的 6 个字段会被 `normalizePostprocessNodeOverride` 直接丢弃
—— 用户**已经配好的命名模板 / 分发排期 / 纯净版开关凭空消失，界面不报任何错**，且不可逆。
与 R-07 / R-47 同属「改动静默失效」家族，但这次的失效发生在**升级瞬间**。

### 迁移设计（落点与口径）

1. **版本号 bump**：`storeProjectTreeParams` `version: 1 → 2`
   —— 不 bump 则 zustand 不调 `migrate`，等于没有迁移。
2. **提升出来的值存在参数层 store 自己的 slice 里**（`promotedGlobals`），
   **不跨 store 写入** —— `persist.migrate` 是同步纯函数，跨 store 写会引入时序依赖。
3. **消费方合并**：`mergePromotedGlobals(base, promoted)`，两个调用点：
   - `PostprocessSettingsModal`（界面读的 `globalConfig`）
   - `runTaskPostprocess`（**运行时真正落盘用的 `baseConfig`**）
     —— ⚠️ 两处都要接：只接界面会出现「看着对、产出错」。
4. **只补空缺，不夺回控制权**：基线已有值的字段不被迁移值覆盖。
   「空缺」判定按类型分 —— 字符串字段**空串也算空缺**（`creator: ''` 就是没填过），
   布尔 / 对象字段只有 `undefined` 算空缺（`autoCompanionClean: false` 是有效设置）。
   > 这条是测试抓出来的：首版只判 `=== undefined`，`creator: ''` 把迁移值挡掉了。
5. **取谁的值**：按 `collectionId` 字典序取第一个写了该字段的节点。
   **刻意不用「层级最深优先」** —— `migrate` 里拿不到 `collections`（另一个 store）算不了深度。
   多值并存时按 id 稳定取一个，保证结果可复现；其余值用户到全局层重配。
6. **必须吃原始数据**：`collectPromotedNodeFieldValues(rawParams)` 接收的是**归一化前**的
   `unknown`。从归一化结果里收集只会得到空对象（字段已经被丢掉了）。

---

## 四、验收

- `npm run verify` 全绿；
- 新增 7 个 R-63 迁移回归用例（含「必须吃原始数据」「稳定取一个」「空串算空缺」三个边界），
  **逐个做过反向验证**：
  - 撤掉 `mergePromotedGlobals` 的合并 → 对应用例失败 ✔
  - 让 `collectPromotedNodeFieldValues` 返回 `{}` → 2 个用例失败 ✔
  - 让归一化重新读 `creator` → 2 个用例失败 ✔
- 行为反转验证：`PostprocessSettingsModal.test.tsx` 4 个「节点上能改 X」的用例
  改写为「节点上不再出现 X」，并在节点上保留对 `outputDir` 的覆盖能力验证。

### 过程中测试抓出的两个真问题（值得记）

1. **探针选错**：替我把「节点没表态」的占位值写成 `outputDir: 'D:/某某'`，
   而 `outputDir` 恰好是**节点仍生效的字段** → 意外覆盖了全局渠道表。
   原用例只是想验证「写个无关字段不影响渠道表」，改回 `enabled: true` 才语义等价。
   → 印证：**反向验证/改写测试时，探针本身也要验**。
2. **空串 vs undefined**：见上文迁移设计第 4 条。**每个字段的「没设过」表示法不同**，
   字符串是 `''`、布尔是 `undefined`、数组里 `[]` 可能是有效值 —— 写合并逻辑必须逐字段确认。
