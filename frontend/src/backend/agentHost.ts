import * as api from './api'
import type { StyleConfig } from '../types'
import { sanitizeConfig } from '../utils/templateCodec'
import { useAppStore } from '../stores/config'
import { useQueueStore } from '../stores/queue'

/**
 * 本地控制口的前端执行侧（A 机制的另一半）。
 *
 * Go 侧 agentapi 收到 HTTP 请求后发事件过来，这里执行并回执；
 * HTTP 请求在收到回执前一直挂着，所以调用方拿到的是真实结果而不是「已投递」。
 *
 * 写入一律走 sanitizeConfig / mergeConfig —— 外部 JSON 是不可信输入，
 * 越界值与未知字段必须在这里被夹取或丢弃，绝不直接 Object.assign。
 */

interface AddItem {
  name?: string
  /** 本机 txt 绝对路径 */
  path?: string
  /** 直接给正文，优先级高于 path */
  text?: string
  bgPath?: string
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 深合并：对象逐键递归，数组整体替换（渠道尺寸这类列表本就该整份覆盖） */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return patch as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 队列里当前样式快照的来源就是工作区，添加时自动带上 */
function baseName(p: string): string {
  const seg = p.split(/[\\/]/).filter(Boolean)
  return (seg[seg.length - 1] ?? '').replace(/\.[^.]+$/, '')
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function installAgentHost(): () => void {
  const app = useAppStore()
  const queue = useQueueStore()

  async function addTasks(rawArgs: unknown): Promise<unknown> {
    const args = (rawArgs ?? {}) as { tasks?: unknown }
    const list = Array.isArray(args.tasks) ? args.tasks : []
    if (list.length === 0) throw new Error('tasks 不能为空')

    const added: { id: string; name: string; chars: number }[] = []
    const failed: { path: string; error: string }[] = []

    for (const entry of list) {
      const it = (entry ?? {}) as AddItem
      let text = typeof it.text === 'string' ? it.text : ''

      if (!text && typeof it.path === 'string' && it.path) {
        try {
          text = await api.readTextFile(it.path)
        } catch (e) {
          failed.push({ path: it.path, error: errMsg(e) })
          continue
        }
      }
      if (!text.trim()) {
        failed.push({ path: it.path ?? '', error: '这条没有正文：path 读不到内容，text 也是空的' })
        continue
      }

      const task = queue.addTask({
        name: (it.name || (it.path ? baseName(it.path) : '')).slice(0, 60),
        text,
        bgPath: typeof it.bgPath === 'string' ? it.bgPath : '',
      })
      if (!task) {
        failed.push({ path: it.path ?? '', error: queue.lastError || '添加失败' })
        continue
      }
      added.push({ id: task.id, name: task.name, chars: text.length })
    }

    return { ok: failed.length === 0, added, failed }
  }

  function listTasks(): unknown {
    return {
      ok: true,
      tasks: queue.tasks.map((t) => {
        const c = t.config
        return {
          id: t.id,
          name: t.name,
          enabled: t.enabled,
          chars: t.text.length,
          status: t.status ?? 'pending',
          hasStyle: Boolean(c),
          canvas: c ? `${c.canvas.width}x${c.canvas.height}` : '',
          maskType: c?.mask.type ?? '',
          maskColor: c?.mask.color ?? '',
        }
      }),
    }
  }

  /** 改某条任务的样式快照：深合并 → 净化 → 若正在编辑则同步工作区 */
  function setTaskStyle(rawArgs: unknown): unknown {
    const args = (rawArgs ?? {}) as { id?: unknown; patch?: unknown }
    const id = typeof args.id === 'string' ? args.id : ''
    const task = queue.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`没有这条任务：${id || '(缺 id)'}`)
    if (!isPlain(args.patch)) throw new Error('patch 必须是 JSON 对象')

    const base = task.config ?? clone(app.cfg)
    task.config = sanitizeConfig(deepMerge(base, args.patch), { keepLocalPaths: true })
    if (queue.activeTaskId === id) void queue.applyTask(id)

    return { ok: true, id, config: task.config }
  }

  /** 删除一条任务（不可撤销） */
  function removeTask(rawArgs: unknown): unknown {
    const args = (rawArgs ?? {}) as { id?: unknown }
    const id = typeof args.id === 'string' ? args.id : ''
    if (!id) throw new Error('缺少 id')
    if (!queue.tasks.some((t) => t.id === id)) throw new Error(`没有这条任务：${id}`)
    queue.removeTask(id)
    return { ok: true, removed: id, remaining: queue.tasks.length }
  }

  /**
   * 触发导出。刻意不等结果：一轮导出远超单次请求的等待上限，
   * 所以立即返回，由调用方轮询 queue.list 的 status。
   */
  function exportTasks(rawArgs: unknown): unknown {
    if (queue.running) throw new Error('队列正在执行，请等这一轮结束')
    const args = (rawArgs ?? {}) as { ids?: unknown }
    const ids = Array.isArray(args.ids)
      ? args.ids.filter((x): x is string => typeof x === 'string')
      : undefined
    if (ids && ids.length === 0) throw new Error('ids 不能是空数组')
    if (!app.cfg.export.dir) {
      throw new Error('还没有输出目录：先在「导出」分区选一个，或用 config.patch 设置 export.dir')
    }

    void queue.runAll(ids)
    return {
      ok: true,
      started: ids ?? queue.tasks.filter((t) => t.enabled).map((t) => t.id),
      note: '导出在后台执行，用 GET /queue/tasks 轮询 status 到 done / failed',
    }
  }

  function getConfig(): unknown {
    return { ok: true, config: clone(app.cfg) }
  }

  /** 改当前工作区配置：深合并后交给 mergeConfig（内部统一 sanitize） */
  function patchConfig(rawArgs: unknown): unknown {
    const args = (rawArgs ?? {}) as { patch?: unknown }
    if (!isPlain(args.patch)) throw new Error('patch 必须是 JSON 对象')

    app.mergeConfig(deepMerge(clone(app.cfg), args.patch) as Partial<StyleConfig>)
    app.notifyAgentChange('外部 agent 修改了配置')
    return { ok: true, config: clone(app.cfg) }
  }

  async function handle(op: string, args: unknown): Promise<unknown> {
    switch (op) {
      case 'queue.add':
        return addTasks(args)
      case 'queue.list':
        return listTasks()
      case 'queue.setStyle':
        return setTaskStyle(args)
      case 'queue.remove':
        return removeTask(args)
      case 'queue.export':
        return exportTasks(args)
      case 'config.get':
        return getConfig()
      case 'config.patch':
        return patchConfig(args)
      default:
        throw new Error(`未知指令：${op}`)
    }
  }

  const off = api.onAgentRequest((req) => {
    void (async () => {
      try {
        const result = await handle(req.op, req.args)
        await api.agentReply(req.id, JSON.stringify(result))
      } catch (e) {
        try {
          await api.agentReply(req.id, JSON.stringify({ ok: false, error: errMsg(e) }))
        } catch {
          // 回执失败说明窗口正在关闭，忽略即可
        }
      }
    })()
  })

  return off
}
