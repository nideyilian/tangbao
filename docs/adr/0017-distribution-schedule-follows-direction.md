# 0017 分发排期回到方向层（推翻 0011 裁决 #4 的「分发」部分）

- **日期**：2026-09-23
- **状态**：**生效中（已实现）**
- **决策者**：杰哥（产品负责人）
- **相关**：[0011](0011-node-override-narrowing.md)（**被本条推翻其中一部分**）、
  [0003](0003-postprocess-channel-override.md)、[0013](0013-participation-follows-direction.md)、
  [0016](0016-text-orientation.md)、TB-107

> ⚠️ **本文件推翻 0011 裁决里 `distribution` 的那一部分。**
> （同一条裁决里的 `autoCompanionClean` 那部分已随字段删除而失效，见 TB-107。）
> 读 0011 时请连同本文件一起看 —— **不要把 `distribution` 按 0011 的口径再收走一次**。
>
> ⚠️ **2026-09-23 补（TB-117）**：下面字段表里的 **`mode`（复制 / 移动）已删除** ——
> 分发改为「按排期日给产出文件夹**同级改名**、搬运恒定移动」，见
> [0018](0018-distribution-renames-folder-in-place.md)。**别把 `mode` 按本表加回来。**

---

## 背景

ADR-0011 把 `distribution` 与 `autoCompanionClean` 一起上收全局，裁决 #4 原文是
「**确定（按全局一套）**」，理由栏写的是「**无逐方向差异证据**」。

## 为什么推翻（四条）

1. **当初的依据是「没找到反证」，不是「已证伪」** —— 理由栏原文就是「无逐方向差异证据」。
2. **更早一次尝试是被类型系统拦下的，不是被判断否掉的**：2026-09-20 曾打算给「渠道与尺寸」
   与「分发」挂作用域选择器，`tsc` 直接报错（`PostprocessNodeOverride` 当时没有这个字段），
   于是作罢并写明「全局一套」。
3. **业务上它就是方向维度**：「A 产品铺 7 天、B 产品铺 30 天」是**投放节奏**，与 ADR-0003 量到的
   「25/61 个方向交付目录不同、56/61 个方向水印不同」是同一类证据 —— 只是当时没人去量。
4. **用户提过两次**：2026-09-20（被 `tsc` 拦下）、2026-09-22（原话「应该跟随产品或方向来设置，
   跟其他参数保持一致的处理方式」）。

## 决策

`PostprocessNodeOverride` 新增 **`distribution`**，但**只放行排期口径**：

```ts
export type PostprocessDistributionOverride = Partial<Pick<PostprocessDistributionConfig, 'days' | 'skipWeekends'>>
```

| 字段 | 归谁 | 理由 |
| --- | --- | --- |
| `days`（铺几天）、`skipWeekends`（跳不跳周末） | **方向级** | 投放节奏，逐方向必然不同 |
| `enabled`、`renameMode`、`randomize`、`modifyMd5`、`targetDir` | **全局一套** | 「怎么搬」是操作习惯，逐方向各配一遍只会让人怀疑哪个生效 |

- **逐字段合并，不是整份替换**：`applyPostprocessOverride` 里
  `{ ...base.distribution, ...override.distribution }` ⇒ 节点只改「铺几天」不会把目标目录一起抹成默认。
- **`undefined` = 这个方向没表态**，沿继承链向上取；一条有效字段都没有时整个丢掉 ——
  与 `watermarkPresetIds` / `byMedia` 同一条口径（留一个空对象会让界面显示成「已覆盖」却什么都没改）。
- **生效值一律走 `resolveProjectPostprocessSlice`**（与产出链同一个函数），界面不自己拼一遍继承。

### 界面

中控台「渠道与输出」→「分发」小节：排期那组带「本级自定义 / 恢复继承」标记；
同一张卡片里的其余字段始终写全局（表单内部**分开投递**，否则节点上改「铺几天」会把目标目录
一起写进节点覆盖）。

## R-63 迁移怎么处置

旧数据里挂在节点上的 `distribution` **不再需要提升到 `promotedGlobals`** —— 现在它会被直接读回。

- `collectPromotedNodeFieldValues` **不再收集**它；
- `hasLegacyNodeOnlyFields` **不再把它算作残留**；
- ⚠️ 但 **`PromotedNodeFieldValues.distribution` 与 `mergePromotedGlobals` 里的合并逻辑保留** ——
  那是给「已经迁移过一次、值已落在全局基线里」的历史数据用的；删掉会让那批用户已配好的排期消失，
  且界面不报任何错（正是 R-63 那一类静默丢配置）。

## 验收

- `params.test.ts`「分发排期回到节点层」三条：
  ① 只放行排期（操作口径丢掉）② 非法值逐条丢（0 天 / 非布尔）③ 节点写了就压掉全局、其余仍继承
- **反向钉住**：「namePattern / creator 仍被丢弃」与「days 能读回来」互为对照 ——
  同样是「曾经被收走」的字段，一个读不回来、一个能读回来，谁改错谁就会看到它变红。
- 全量测试数字见 `docs/BACKLOG.md` 的 TB-107。
