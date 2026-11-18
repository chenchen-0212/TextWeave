/**
 * 全局轻提示（vue-toastification）。
 *
 * 用 createToastInterface 而不是 app.use(Toast) + useToast()：发起提示的地方多在
 * Pinia store 里，没有 setup 上下文，inject 拿不到实例。这个接口会自己挂一个容器，
 * 任何模块 import 后直接调用即可。
 */
import { POSITION, createToastInterface } from 'vue-toastification'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

const api = createToastInterface({
  position: POSITION.TOP_RIGHT,
  timeout: 3200,
  maxToasts: 4,
  newestOnTop: true,
  closeOnClick: true,
  pauseOnHover: true,
})

/** timeout 传大值可用于「必须看见」的提示（如外部 agent 改了配置） */
export function notify(text: string, kind: ToastKind = 'info', timeout?: number): void {
  api[kind](text, timeout ? { timeout } : undefined)
}
