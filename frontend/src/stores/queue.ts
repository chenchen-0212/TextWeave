import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import type { StyleConfig } from '../types'
import { useAppStore } from './config'

/**
 * 批处理任务队列（对应建议项 N-01）。
 *
 * 一条任务 = {书名, 文本, 背景图, **样式快照**}。样式快照是「点击复现」的基础：
 * 点击任务会把它的样式与正文载入工作区（与历史任务恢复走同一套 mergeConfig），
 * 用户改完后自动回写到这条任务，于是同一份队列里可以并存多种版式。
 *
 * 设计约束：
 *  - 不复制任何渲染/排版逻辑，只编排既有 store 的公开能力；
 *  - 串行执行：任务之间天然隔离，单条失败不中断后续任务；
 *  - 任务列表持久化到 localStorage，重启后可复现上次的批量任务。
 */

const QUEUE_STORAGE_KEY = 'textweave.queue.v1'
const MAX_TASKS = 50
const MAX_TASK_TEXT = 50000
/** 持久化防抖：编辑样式时几乎每次输入都会触发，没必要每次都写 localStorage */
const SAVE_DELAY = 400

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
  /** 该任务自己的样式快照；缺失时（旧数据）复现时继承当前样式 */
  config?: StyleConfig
  /** 运行期状态，不持久化 */
  status?: QueueTaskStatus
  /** 运行期结果消息 */
  message?: string
}

function makeTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function cloneConfig(cfg: StyleConfig): StyleConfig {
  return JSON.parse(JSON.stringify(cfg)) as StyleConfig
}

function loadTasks(): QueueTask[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.slice(0, MAX_TASKS).map((t) => {
      const it = (t ?? {}) as Partial<QueueTask>
      const cfg = it.config
      return {
        id: typeof it.id === 'string' && it.id ? it.id : makeTaskId(),
        name: typeof it.name === 'string' ? it.name.slice(0, 60) : '',
        text: typeof it.text === 'string' ? it.text.slice(0, MAX_TASK_TEXT) : '',
        bgPath: typeof it.bgPath === 'string' ? it.bgPath : '',
        bgName: typeof it.bgName === 'string' ? it.bgName.slice(0, 120) : '',
        enabled: it.enabled !== false,
        // 样式只做粗筛，真正的合法性由 mergeConfig 的 sanitizeConfig 兜底
        config: cfg && typeof cfg === 'object' ? (cfg as StyleConfig) : undefined,
      }
    })
  } catch {
    return []
  }
}

export const useQueueStore = defineStore('queue', () => {
  const app = useAppStore()

  const tasks = ref<QueueTask[]>(loadTasks())
  const running = ref(false)
  const activeTaskId = ref('')
  const lastSummary = ref('')
  const lastError = ref('')
  let cancelRequested = false
  /** 复现任务期间挂起回写，避免把别的任务的样式写进来 */
  let loading = false
  /** 连点两个任务时，只有最后一次复现能决定「当前编辑」是哪条 */
  let applySeq = 0

  // 持久化：运行期状态不入盘；带样式快照，故稍作防抖
  let saveTimer: number | null = null
  function persist(): void {
    try {
      const slim = tasks.value.slice(0, MAX_TASKS).map((t) => ({
        id: t.id,
        name: t.name,
        text: t.text.slice(0, MAX_TASK_TEXT),
        bgPath: t.bgPath,
        bgName: t.bgName,
        enabled: t.enabled,
        config: t.config,
      }))
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(slim))
    } catch {
      // 写满/隐私模式等情况忽略，不影响使用
    }
  }

  watch(
    tasks,
    () => {
      if (saveTimer !== null) clearTimeout(saveTimer)
      saveTimer = window.setTimeout(persist, SAVE_DELAY)
    },
    { deep: true },
  )

  /**
   * 工作区 → 当前任务。
   *
   * 「点击任务调整样式」的闭环就在这里：cfg / 正文一变就回写到活跃任务，
   * 这样切换任务不会丢改动，导出时也用的是各自任务自己的样式。
   */
  watch(
    [() => app.text, () => app.cfg],
    () => {
      if (loading || !activeTaskId.value) return
      const t = tasks.value.find((it) => it.id === activeTaskId.value)
      if (!t) return
      t.text = app.text.slice(0, MAX_TASK_TEXT)
      t.config = cloneConfig(app.cfg)
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
      // 新任务继承当前样式快照：之后各任务可以各自改，互不影响
      config: partial?.config ? cloneConfig(partial.config) : cloneConfig(app.cfg),
    }
    tasks.value.push(task)
    lastError.value = ''
    return task
  }

  /** 把当前工作区（文本 + 背景图 + 封面标题 + 样式）捕获为新任务。 */
  function addTaskFromCurrent(): QueueTask | null {
    const name = app.primaryCoverTitle || ''
    if (!app.text.trim() && !name) {
      lastError.value = '当前没有可捕获的内容，请先输入文本'
      return null
    }
    return addTask({ name, text: app.text, bgPath: app.bgPath, bgName: app.bgName })
  }

  /**
   * 复现一条任务：样式 + 正文 + 背景图载入工作区。
   *
   * 与历史任务恢复（config.ts: restoreHistory）刻意走同一套动作：
   * mergeConfig（内部 sanitizeConfig 夹取）→ 覆盖正文 → 恢复背景图。
   */
  async function applyTask(id: string): Promise<void> {
    if (running.value) return
    const task = tasks.value.find((t) => t.id === id)
    if (!task) return

    // 旧任务没有样式快照：用当前样式补一份，之后它就独立了
    if (!task.config) task.config = cloneConfig(app.cfg)

    const seq = ++applySeq
    loading = true
    try {
      app.mergeConfig(JSON.parse(JSON.stringify(task.config)) as Partial<StyleConfig>)
      app.text = task.text
      activeTaskId.value = id
      lastError.value = ''
      // 换背景图是异步的，期间用户可能又点了别的任务
      if (task.bgPath) await app.setBackground(task.bgPath)
      if (seq !== applySeq) return
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : '复现任务失败'
    } finally {
      if (seq === applySeq) loading = false
    }
  }

  function removeTask(id: string): void {
    if (running.value && id === activeTaskId.value) return
    tasks.value = tasks.value.filter((t) => t.id !== id)
    if (activeTaskId.value === id) activeTaskId.value = ''
  }

  function clearFinished(): void {
    if (running.value) return
    const removed = new Set(
      tasks.value
        .filter((t) => t.status === 'done' || t.status === 'failed' || t.status === 'skipped')
        .map((t) => t.id),
    )
    tasks.value = tasks.value.filter((t) => !removed.has(t.id))
    if (removed.has(activeTaskId.value)) activeTaskId.value = ''
  }

  function cancel(): void {
    if (running.value) {
      cancelRequested = true
      // 同步取消当前正在进行的单任务导出
      app.cancelExport()
    }
  }

  /**
   * 顺序执行所有启用的任务。
   *
   * 每条任务：载入自己的样式快照 → 写入文本 → 恢复背景图 → 显式重排 →
   * 以任务书名作为 {book} 标签导出。导出失败记为 failed，继续下一条。
   */
  async function runAll(onlyIds?: string[]): Promise<void> {
    if (running.value) return
    if (!app.cfg.export.dir) {
      lastError.value = '请先在「导出」分区选择输出目录'
      return
    }

    const queue = tasks.value.filter((t) => t.enabled && (!onlyIds || onlyIds.includes(t.id)))
    if (queue.length === 0) {
      lastError.value = '队列中没有可执行的任务'
      return
    }

    running.value = true
    cancelRequested = false
    lastError.value = ''
    lastSummary.value = ''

    // 只重置本次要跑的那几条，其余任务的状态不动
    for (const t of tasks.value) {
      if (onlyIds && !onlyIds.includes(t.id)) continue
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
        // 1) 载入该任务自己的样式；输出目录是工作区设置，不跟着任务走
        const outDir = app.cfg.export.dir
        loading = true
        try {
          if (task.config) {
            app.mergeConfig(JSON.parse(JSON.stringify(task.config)) as Partial<StyleConfig>)
            app.cfg.export.dir = outDir
          }
          app.text = task.text
        } finally {
          loading = false
        }

        // 2) 恢复背景图（没有则沿用当前）
        if (task.bgPath && task.bgPath !== app.bgPath) {
          await app.setBackground(task.bgPath)
        }

        // 3) 显式重排（等待字体与布局就绪后再导出）
        await app.rebuild()

        if (app.pages.length === 0) {
          task.status = 'failed'
          task.message = '没有可导出的页面（文本为空）'
          failCount++
          continue
        }

        // 4) 导出：书名作为任务标签进入文件名与子目录
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
          task.config = cloneConfig(app.cfg)
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
    applyTask,
    removeTask,
    clearFinished,
    cancel,
    runAll,
  }
})
