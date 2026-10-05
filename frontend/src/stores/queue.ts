import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useAppStore } from './config'

/**
 * 批处理任务队列（对应建议项 N-01）。
 *
 * 一条任务 = {书名, 文本, 背景图}。执行时逐条恢复输入状态 → 重排 →
 * 复用现有单尺寸导出链路落盘（书名作为 {book} 标签进入文件名与子目录）。
 *
 * 设计约束：
 *  - 不复制任何渲染/排版逻辑，只编排既有 store 的公开能力；
 *  - 串行执行：任务之间天然隔离，单条失败不中断后续任务；
 *  - 任务列表持久化到 localStorage，重启后可复现上次的批量任务。
 */

const QUEUE_STORAGE_KEY = 'textweave.queue.v1'
const MAX_TASKS = 50
const MAX_TASK_TEXT = 50000

export type QueueTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface QueueTask {
  id: string
  /** 书名标签，进入 {book} 变量与导出子目录 */
  name: string
  text: string
  /** 背景图绝对路径；空串表示沿用当前背景 */
  bgPath: string
  /** 仅用于列表展示 */
  bgName: string
  enabled: boolean
  /** 运行期状态，不持久化 */
  status?: QueueTaskStatus
  /** 运行期结果消息 */
  message?: string
}

function makeTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function loadTasks(): QueueTask[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.slice(0, MAX_TASKS).map((t) => {
      const it = (t ?? {}) as Partial<QueueTask>
      return {
        id: typeof it.id === 'string' && it.id ? it.id : makeTaskId(),
        name: typeof it.name === 'string' ? it.name.slice(0, 60) : '',
        text: typeof it.text === 'string' ? it.text.slice(0, MAX_TASK_TEXT) : '',
        bgPath: typeof it.bgPath === 'string' ? it.bgPath : '',
        bgName: typeof it.bgName === 'string' ? it.bgName.slice(0, 120) : '',
        enabled: it.enabled !== false,
      }
    })
  } catch {
    return []
  }
}

export const useQueueStore = defineStore('queue', () => {
  const tasks = ref<QueueTask[]>(loadTasks())
  const running = ref(false)
  const activeTaskId = ref('')
  const lastSummary = ref('')
  const lastError = ref('')
  let cancelRequested = false

  // 持久化：只存结构字段，运行期状态不入盘
  watch(
    tasks,
    () => {
      try {
        const slim = tasks.value.slice(0, MAX_TASKS).map((t) => ({
          id: t.id,
          name: t.name,
          text: t.text.slice(0, MAX_TASK_TEXT),
          bgPath: t.bgPath,
          bgName: t.bgName,
          enabled: t.enabled,
        }))
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(slim))
      } catch {
        // 写满/隐私模式等情况忽略，不影响使用
      }
    },
    { deep: true },
  )

  const enabledCount = computed(() => tasks.value.filter((t) => t.enabled).length)
  const doneCount = computed(
    () => tasks.value.filter((t) => t.status === 'done').length,
  )
  const activeTask = computed(
    () => tasks.value.find((t) => t.id === activeTaskId.value) ?? null,
  )

  function addTask(partial?: Partial<QueueTask>): QueueTask | null {
    if (tasks.value.length >= MAX_TASKS) {
      lastError.value = `队列最多 ${MAX_TASKS} 条任务`
      return null
    }
    const task: QueueTask = {
      id: makeTaskId(),
      name: partial?.name ?? '',
      text: (partial?.text ?? '').slice(0, MAX_TASK_TEXT),
      bgPath: partial?.bgPath ?? '',
      bgName: partial?.bgName ?? '',
      enabled: partial?.enabled ?? true,
    }
    tasks.value.push(task)
    lastError.value = ''
    return task
  }

  /** 把当前工作区（文本 + 背景图 + 封面标题）捕获为新任务。 */
  function addTaskFromCurrent(): QueueTask | null {
    const app = useAppStore()
    const name = app.primaryCoverTitle || ''
    if (!app.text.trim() && !name) {
      lastError.value = '当前没有可捕获的内容，请先输入文本'
      return null
    }
    return addTask({ name, text: app.text, bgPath: app.bgPath, bgName: app.bgName })
  }

  function removeTask(id: string): void {
    if (running.value && id === activeTaskId.value) return
    tasks.value = tasks.value.filter((t) => t.id !== id)
  }

  function clearFinished(): void {
    if (running.value) return
    tasks.value = tasks.value.filter(
      (t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'skipped',
    )
  }

  function cancel(): void {
    if (running.value) {
      cancelRequested = true
      // 同步取消当前正在进行的单任务导出
      useAppStore().cancelExport()
    }
  }

  /**
   * 顺序执行所有启用的任务。
   *
   * 每条任务：写入文本 → 恢复背景图（或保留当前）→ 显式重排 →
   * 以任务书名作为 {book} 标签导出。导出失败记为 failed，继续下一条。
   */
  async function runAll(): Promise<void> {
    if (running.value) return
    const app = useAppStore()
    if (!app.cfg.export.dir) {
      lastError.value = '请先在「导出」分区选择输出目录'
      return
    }

    const queue = tasks.value.filter((t) => t.enabled)
    if (queue.length === 0) {
      lastError.value = '队列中没有启用的任务'
      return
    }

    running.value = true
    cancelRequested = false
    lastError.value = ''
    lastSummary.value = ''

    for (const t of tasks.value) {
      t.status = t.enabled ? 'pending' : 'skipped'
      t.message = ''
    }

    let okCount = 0
    let failCount = 0

    for (const task of queue) {
      if (cancelRequested) {
        task.status = 'skipped'
        task.message = '已取消'
        continue
      }

      activeTaskId.value = task.id
      task.status = 'running'
      task.message = '执行中…'

      try {
        // 1) 恢复任务内容
        app.text = task.text
        if (task.bgPath) {
          if (task.bgPath !== app.bgPath) {
            await app.setBackground(task.bgPath)
          }
        }

        // 2) 显式重排（等待字体与布局就绪后再导出）
        await app.rebuild()

        if (app.pages.length === 0) {
          task.status = 'failed'
          task.message = '没有可导出的页面（文本为空）'
          failCount++
          continue
        }

        // 3) 导出：书名作为任务标签进入文件名与子目录
        await app.runExport(task.name)

        if (app.exportError) {
          task.status = 'failed'
          task.message = app.exportError
          failCount++
        } else if (cancelRequested) {
          task.status = 'skipped'
          task.message = '已取消'
        } else {
          task.status = 'done'
          task.message = app.exportSuccess || '完成'
          okCount++
        }
      } catch (e) {
        task.status = 'failed'
        task.message = e instanceof Error ? e.message : String(e)
        failCount++
      }
    }

    activeTaskId.value = ''
    running.value = false
    lastSummary.value = `队列执行完成：成功 ${okCount} 条${failCount > 0 ? `，失败 ${failCount} 条` : ''}${
      cancelRequested ? '（已取消剩余任务）' : ''
    }`
  }

  return {
    tasks,
    running,
    activeTaskId,
    activeTask,
    lastSummary,
    lastError,
    enabledCount,
    doneCount,
    addTask,
    addTaskFromCurrent,
    removeTask,
    clearFinished,
    cancel,
    runAll,
  }
})
