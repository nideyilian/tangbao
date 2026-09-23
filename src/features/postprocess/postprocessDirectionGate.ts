/**
 * 方向级并发闸的「等待 / 唤醒」实现。
 *
 * 分工：**判断**是纯函数（`lib/postprocessDirectionQueue.ts`，可单测），**状态**存在
 * `runtimeStore`（界面要读「几个方向在跑 / 谁在排队」），这里只补最后一件事 ——
 * 拿不到名额就等，别人释放时醒过来重试。
 *
 * 为什么等待不用轮询：一次后处理动辄几十秒，轮询要么太密（白跑）要么太疏（开工延迟肉眼可见）。
 * 唤醒是**广播**式的（所有等待者都醒来看一眼名额），代价是有人白醒一次 ——
 * 换来的是「不会漏掉任何一个等待者」，而漏唤醒的后果是那个方向**永远开不了工且不报错**。
 *
 * ⚠️ 注册等待与抢名额**必须相邻且同步**（`while` 里先注册再 `tryAdmit`）：JS 单线程保证
 * 这两行之间不会被插入广播，也就不会出现「注册之前名额已被释放」的丢唤醒窗口。
 * 再加一层 2 秒定时兜底：万一哪条路径漏了广播（新加的释放点忘了调用），排队的方向
 * 也只是慢，不会静默卡死 —— 这是「排队中」这个状态唯一可能表现成 bug 的地方。
 */

import { useRuntimeStore } from '../../stores/runtimeStore'
import { createPostprocessCanceledError, throwIfPostprocessCanceled } from './postprocessCancel'

/** 兜底重试间隔（ms）：只在广播漏掉时才会真正起作用。 */
const WAITER_RECHECK_MS = 2000

const waiters = new Set<() => void>()

function registerWaiter(): { promise: Promise<void>; cancel: () => void } {
  let resolveWaiter: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolveWaiter = resolve
  })
  waiters.add(resolveWaiter)
  return { promise, cancel: () => waiters.delete(resolveWaiter) }
}

function wakeWaiters(): void {
  // 先清空再逐个唤醒：等待者醒来后会重新注册，不清空会把它们又叫一遍
  const pending = [...waiters]
  waiters.clear()
  for (const resolve of pending) resolve()
}

/**
 * 申请某个方向的开工资格；拿不到就等着。
 *
 * 返回时该调用方**已经拿到名额**，用完必须 `releasePostprocessDirection` ——
 * 漏掉释放会让这个方向永久占着一个名额，症状是「别的方向一直排不上队」。
 *
 * `signal` 给出时支持**中途取消**（TB-115）：abort 会让等待**立刻**中断并抛出取消错误，
 * 而不是「等它拿到名额再自己退出」—— 后者用户看到的是「点了取消，界面还挂着『排队中』
 * 几十秒」，而他并不知道自己在等什么。
 */
export async function acquirePostprocessDirection(
  directionKey: string,
  maxConcurrent: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfPostprocessCanceled(signal)
  /**
   * 取消唤醒源：整个等待期间只建**一次**。
   *
   * 逐轮迭代新建会让 `addEventListener` 攒下几十个一次性监听（abort 之前一个都不会被移除）。
   * 无 signal 时它就是一个永不 settle 的 promise —— 挂在 `race` 里不占资源、不影响任何分支。
   *
   * ⚠️ 末尾那个空 `catch` 不是多余的：acquire **第一次就抢到名额**时（最常见的情形）
   * 这个 promise 从未进过 `race`，之后执行体阶段用户再点取消，它的 reject 就没人接了 ——
   * 表现为一条未处理拒绝。挂上空处理即可。
   */
  const canceled = new Promise<never>((_resolve, reject) => {
    if (!signal) return
    signal.addEventListener('abort', () => reject(createPostprocessCanceledError()), { once: true })
  })
  canceled.catch(() => undefined)

  while (true) {
    const waiter = registerWaiter()
    try {
      // 注册等待与抢名额**相邻且同步**：中间不会被插入广播，也就没有「注册之前名额已被释放」的丢唤醒窗口
      if (useRuntimeStore.getState().tryAdmitPostprocessDirection(directionKey, maxConcurrent)) return
      await Promise.race([
        waiter.promise,
        new Promise<void>((resolve) => setTimeout(resolve, WAITER_RECHECK_MS)),
        canceled,
      ])
      // 醒来后先看是不是被取消了：取消的语义是「别再开跑」，而不是「抢到名额再退出」
      throwIfPostprocessCanceled(signal)
    } finally {
      // 取消抛错时也必须清掉等待者，否则它会一直留在 Set 里等下一次广播（白醒一次）
      waiter.cancel()
    }
  }
}

/** 释放名额并唤醒等待者。幂等：重复调用不会动到别人的名额（见纯函数的 `releaseDirection`）。 */
export function releasePostprocessDirection(directionKey: string): void {
  useRuntimeStore.getState().releasePostprocessDirection(directionKey)
  wakeWaiters()
}

/** 测试用：清掉所有等待者，避免用例之间互相唤醒（内存态，不影响 store 里的名额）。 */
export function resetPostprocessDirectionWaiters(): void {
  waiters.clear()
}
