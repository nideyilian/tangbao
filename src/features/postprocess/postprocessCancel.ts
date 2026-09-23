/**
 * 取消一次后处理产出。
 *
 * 为什么单独一个模块：取消要同时做三件事，散在三处必然漏一处 ——
 * 1. **让执行体停下来**：`AbortSignal` 贯穿 `taskPostprocess` 的主循环与 `renderVariant` 的编码循环；
 * 2. **让排队中的方向立刻停下来**：`acquirePostprocessDirection` 支持 signal —— 否则用户点了取消，
 *    界面上还得挂着「排队中」几十秒（要等别的方向跑完、它拿到名额那一刻才发现自己该停）；
 * 3. **让界面找得到「谁可以取消」**：方向 id → 取消句柄的登记表（见下）。
 *
 * 三条刻意的口径：
 *
 * - **取消不删任何已写出的文件**。产物是用户要的东西，停在哪里就留到哪里；替用户删东西是
 *   最不可逆的一种「帮忙」。要清掉是他自己的事。
 * - **取消是一个专属错误，不是一个布尔返回值**。`renderVariant` 的编码循环在 `toBlob` 之间
 *   只能靠抛出来中断（见 `paintAndEncode`），所以取消必须能被**可靠识别**
 *   （`isPostprocessCanceledError`）—— 否则会被 `writeVariant` 的 catch 记成 `PP-RENDER-001`，
 *   症状是「点了取消，记录里却多一条渲染失败」。
 * - **登记表按方向**。后处理是一方向一条 run（TB-112），取消一个方向不该牵连别的方向。
 */

/** 取消信号：`AbortController` 是平台自带的，这里只补一个可识别的错误类型与登记表。 */
const directionCancellers = new Map<string, AbortController>()

/**
 * 取消专用错误。
 *
 * 继承 `Error` 而不是用字符串消息判定（`renderVariant` 早先抛的是 `new Error('渲染被取消')`）：
 * 消息是给用户看的、会被改文案，拿它当判据等于把「取消」和「渲染失败」的区分建在一句中文上。
 */
export class PostprocessCanceledError extends Error {
  constructor() {
    super('后处理已取消')
    this.name = 'PostprocessCanceledError'
  }
}

export function createPostprocessCanceledError(): PostprocessCanceledError {
  return new PostprocessCanceledError()
}

/**
 * 这个错误是不是「用户取消」。
 *
 * 除了自己的类型，还认 `AbortError`：`signal.abort()` 会让某些异步边界（`fetch` 一类的实现、
 * 以及第三方 `sleep`/`wait` 工具）透出 DOMException，它同样是「用户按了停止」，不能被算成失败。
 */
export function isPostprocessCanceledError(error: unknown): boolean {
  if (error instanceof PostprocessCanceledError) return true
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * 已取消就抛。放在主循环的每个可中断点上（每张源图、每个产出变体、每次编码前）。
 *
 * 传 `undefined` 时不做任何事 —— 这样「不关心取消」的调用方（单测、脚本）不必造一个假 signal。
 */
export function throwIfPostprocessCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw createPostprocessCanceledError()
}

/**
 * 登记一个方向的取消句柄，返回它的 signal（传给执行体）。
 *
 * ⚠️ **必须与 `releasePostprocessCancel` 成对**（放在 `finally` 里）。漏释放的后果不是崩溃而是
 * 静默错位：下一次触发复用同一个 `directionId` 时，用户点「取消」会打到一条**已经跑完**的 run 上
 * —— 看起来毫无反应，其实按错了对象，而这条新的 run 照样跑到底。
 */
export function registerPostprocessCancel(directionId: string): AbortSignal {
  const controller = new AbortController()
  directionCancellers.set(directionId, controller)
  return controller.signal
}

/** 注销方向句柄。`controller` 已不在表里（被别人替换过）时不动，避免误删新登记的那一个。 */
export function releasePostprocessCancel(directionId: string, signal?: AbortSignal): void {
  const controller = directionCancellers.get(directionId)
  if (!controller) return
  // 传了 signal 就核对身份：同一方向连续两次触发时，先收尾的那一次不该把后一次的句柄删掉
  if (signal && controller.signal !== signal) return
  directionCancellers.delete(directionId)
}

/** 取消某个方向（在跑或排队中都有效）。返回 false = 这个方向当前没有可取消的 run。 */
export function cancelPostprocessDirection(directionId: string): boolean {
  const controller = directionCancellers.get(directionId)
  if (!controller || controller.signal.aborted) return false
  controller.abort()
  return true
}

/** 取消全部方向，返回实际取消了几个。 */
export function cancelAllPostprocessDirections(): number {
  let count = 0
  for (const controller of directionCancellers.values()) {
    if (controller.signal.aborted) continue
    controller.abort()
    count += 1
  }
  return count
}

/** 这个方向当前有没有可取消的 run（界面据此决定要不要给「取消」按钮）。 */
export function isPostprocessDirectionCancelable(directionId: string): boolean {
  const controller = directionCancellers.get(directionId)
  return Boolean(controller) && !controller!.signal.aborted
}

/** 当前登记在册的方向数（测试与诊断用）。 */
export function countRegisteredPostprocessCancels(): number {
  return directionCancellers.size
}

/** 测试用：清空登记表，避免用例之间互相影响（内存态，不影响 store）。 */
export function resetPostprocessCancellers(): void {
  directionCancellers.clear()
}
