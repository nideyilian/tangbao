/**
 * 配方卡「定位跳转」：把问题清单里的落点变成「滚到那儿 + 闪一下」。
 *
 * 三条实现口径：
 *
 * 1. **落点是数据、不是选择器**：组件只负责把 `data-recipe-target="dim:1"` 挂到元素上，
 *    这里按属性查 —— 组件里不许再手写 `.sop-recipe-dimension input` 这类选择器
 *    （那种写法一改 DOM 结构就静默失效，而且失效时报的是「点了没反应」，没法查）。
 * 2. **必须限定 root**：详情弹窗走 portal（挂在 `document.body` 下），
 *    用 `document` 当 root 会在将来出现第二个同名面板时定位到别人身上。
 * 3. **找不到就返回 false，不抛错**：目标可能还没渲染出来（例如刚点「补一个维度」、
 *    维度还没挂上），这是正常时序，交给调用方决定要不要重试。
 */

/** 落点属性名。渲染与查找共用同一个常量，避免两处写歪。 */
export const RECIPE_TARGET_ATTRIBUTE = 'data-recipe-target'

/** 命中后闪一下用的类名（样式在 `features/strategy/styles.css`）。 */
export const RECIPE_TARGET_FLASH_CLASS = 'sop-recipe-target--flash'

/** 高亮持续时长。太短看不见，太长像选中态。 */
const FLASH_MS = 1200

/**
 * 每个元素上一次的摘除定时器。
 *
 * 为什么需要：连着点两次同一条问题（或点了 A 再点 B 又点回 A）时，
 * 第一次的定时器会在第二次高亮刚开始时把它摘掉 —— 表现为「第二次点没反应」。
 */
const flashTimers = new WeakMap<HTMLElement, number>()

/** 在 root 内按落点键找目标元素；找不到返回 `null`。 */
export function findRecipeTargetElement(key: string, root: ParentNode | null | undefined): HTMLElement | null {
  if (!root || !key) return null
  return root.querySelector<HTMLElement>(`[${RECIPE_TARGET_ATTRIBUTE}="${key}"]`)
}

/** 目标是不是可输入元素 —— 是的话顺手聚焦，用户落点即能改。 */
function isFocusable(element: HTMLElement): boolean {
  return element.matches('input, textarea, select')
}

/**
 * 定位到某个落点：滚到视野中间 + 高亮闪一下（+ 可输入元素顺带聚焦）。
 *
 * 返回是否真的找到了目标。`scrollIntoView` 做特性检测：jsdom 没实现它，
 * 测试环境里不该因此抛错（否则一个「环境缺 API」会把真实断言淹掉）。
 */
export function focusRecipeTarget(
  key: string,
  root: ParentNode | null | undefined,
  options: { flashMs?: number } = {},
): boolean {
  const element = findRecipeTargetElement(key, root)
  if (!element) return false

  if (isFocusable(element)) element.focus()

  if (typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }

  const previous = flashTimers.get(element)
  if (previous !== undefined) window.clearTimeout(previous)

  element.classList.add(RECIPE_TARGET_FLASH_CLASS)
  const timer = window.setTimeout(() => {
    element.classList.remove(RECIPE_TARGET_FLASH_CLASS)
    flashTimers.delete(element)
  }, options.flashMs ?? FLASH_MS)
  flashTimers.set(element, timer)
  return true
}
