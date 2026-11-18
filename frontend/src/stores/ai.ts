/**
 * AI 封面生成：供应商配置 + 生成任务状态。
 *
 * 配置不走 StyleConfig（那份配置会随模板/分享码外发），而是由 Go 侧单独存
 * ai.json；这里只做内存副本与「是否配置完整」的判断。
 * 生成状态本身记在 app store 里（渲染与导出都要读），本 store 只负责编排。
 */

import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../backend/api'
import { useAppStore } from './config'
import { pageCanvasSize } from '../core/pageCanvas'
import { MAX_COVERS } from '../types'

export interface AIConfig {
  llm: {
    baseUrl: string
    apiKey: string
    model: string
    systemPrompt: string
    contextLength: number
  }
  image: {
    baseUrl: string
    apiKey: string
    model: string
    quality: string
  }
}

const DEFAULT_SYSTEM_PROMPT =
  '你是资深视觉设计提示词工程师。根据用户提供的中文长文，提炼核心主题与情绪，' +
  '输出一段用于文生图模型的高质量提示词。只输出提示词本身，不要解释、不要引号，' +
  '120 字以内，包含画面主体、构图、光线、色彩与风格。'

export const QUALITY_OPTIONS = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
]

/** 一条生图日志：提示词、请求过去的配置（不含密钥）、落盘的图片。 */
export interface AILogEntry {
  id: string
  /** 生成时间戳（毫秒） */
  ts: number
  prompt: string
  endpoint: string
  model: string
  size: string
  format: string
  quality: string
  /** 生成图片的绝对路径 */
  path: string
}

/** 日志文件，存于应用数据目录；超过上限丢弃最旧的 */
const LOG_FILE = 'ai-log.json'
const LOG_LIMIT = 30

function defaultConfig(): AIConfig {
  return {
    llm: { baseUrl: '', apiKey: '', model: '', systemPrompt: DEFAULT_SYSTEM_PROMPT, contextLength: 8000 },
    image: { baseUrl: '', apiKey: '', model: '', quality: 'high' },
  }
}

export const useAIStore = defineStore('ai', () => {
  const app = useAppStore()

  const config = reactive<AIConfig>(defaultConfig())
  const configOpen = ref(false)
  const lastError = ref('')
  const saving = ref(false)
  /** 因配置不全被挡下的生成请求，保存配置后自动续上 */
  const pendingGenerate = ref(false)

  /** 生图日志（新的在前） */
  const logs = ref<AILogEntry[]>([])
  /** 只读一次盘；并发调用共享同一个 promise，避免读到一半拿到空列表 */
  let logsPromise: Promise<void> | null = null

  /** 是否已经读过磁盘；没有 ai.json 也算读过（结果就是默认值） */
  let loaded = false

  function merge(raw: string): void {
    const src = JSON.parse(raw) as {
      llm?: Partial<AIConfig['llm']>
      image?: Partial<AIConfig['image']>
    }
    const d = defaultConfig()
    const llm = src.llm ?? {}
    const image = src.image ?? {}
    config.llm.baseUrl = String(llm.baseUrl ?? d.llm.baseUrl)
    config.llm.apiKey = String(llm.apiKey ?? d.llm.apiKey)
    config.llm.model = String(llm.model ?? d.llm.model)
    config.llm.systemPrompt = String(llm.systemPrompt ?? '') || d.llm.systemPrompt
    config.llm.contextLength = Number(llm.contextLength) > 0 ? Number(llm.contextLength) : d.llm.contextLength
    config.image.baseUrl = String(image.baseUrl ?? '')
    config.image.apiKey = String(image.apiKey ?? '')
    config.image.model = String(image.model ?? '')
    config.image.quality = String(image.quality ?? '') || d.image.quality
  }

  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    const raw = await api.loadAIConfig()
    if (!raw) return
    try {
      merge(raw)
    } catch {
      // 文件损坏时保持默认值，用户重新填一遍即可覆盖
    }
  }

  async function save(): Promise<void> {
    saving.value = true
    try {
      await api.saveAIConfig(JSON.stringify(config))
      loaded = true
      lastError.value = ''
      app.notify('AI 配置已保存')
      if (pendingGenerate.value) {
        pendingGenerate.value = false
        configOpen.value = false
        // 不 await：配置窗要立刻关掉，生成在后台继续
        void generate()
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : '保存 AI 配置失败'
    } finally {
      saving.value = false
    }
  }

  /** 配置是否够用：LLM 与生图两段的地址、密钥、模型都不能缺 */
  function isComplete(): boolean {
    const l = config.llm
    const i = config.image
    return Boolean(
      l.baseUrl.trim() && l.apiKey.trim() && l.model.trim() && i.baseUrl.trim() && i.apiKey.trim() && i.model.trim(),
    )
  }

  /** 导出当前配置到用户选的文件；文件含 API Key，只应留在本机 */
  async function exportConfig(): Promise<void> {
    lastError.value = ''
    try {
      const path = await api.pickAIConfigSavePath()
      if (!path) return
      await api.writeTextFile(path, JSON.stringify(config, null, 2))
      app.notify(`AI 配置已导出到 ${path}`)
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : '导出 AI 配置失败'
    }
  }

  /** 从 .json 导入配置并立即生效（缺失字段回落到默认值） */
  async function importConfig(): Promise<void> {
    lastError.value = ''
    try {
      const path = await api.pickAIConfigFile()
      if (!path) return
      const raw = await api.readTextFile(path)
      if (!raw.trim()) throw new Error('配置文件是空的')
      try {
        merge(raw)
      } catch {
        throw new Error('配置文件内容不是合法 JSON')
      }
      await save()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : '导入 AI 配置失败'
    }
  }

  const activeCoverId = computed(() => app.cfg.cover.activeId)
  const activeGenerating = computed(() => app.generatingCovers.has(activeCoverId.value))

  // ---------------------------------------------------------------- 生图日志

  /** 单条校验：ai-log.json 可能被手工改动，坏条目丢弃，避免列表渲染崩溃。 */
  function parseLogs(raw: string): AILogEntry[] {
    if (!raw) return []
    try {
      const list = JSON.parse(raw)
      if (!Array.isArray(list)) return []
      return list
        .map((it: unknown): AILogEntry | null => {
          const e = (it ?? {}) as Partial<AILogEntry>
          if (typeof e.path !== 'string' || !e.path) return null
          return {
            id: typeof e.id === 'string' && e.id ? e.id : `ailog-${e.path}`,
            ts: typeof e.ts === 'number' && Number.isFinite(e.ts) ? e.ts : 0,
            prompt: typeof e.prompt === 'string' ? e.prompt : '',
            endpoint: typeof e.endpoint === 'string' ? e.endpoint : '',
            model: typeof e.model === 'string' ? e.model : '',
            size: typeof e.size === 'string' ? e.size : '',
            format: typeof e.format === 'string' ? e.format : '',
            quality: typeof e.quality === 'string' ? e.quality : '',
            path: e.path,
          }
        })
        .filter((e): e is AILogEntry => e !== null)
        .slice(0, LOG_LIMIT)
    } catch {
      return []
    }
  }

  function loadLogs(): Promise<void> {
    if (!logsPromise) {
      logsPromise = (async () => {
        try {
          logs.value = parseLogs(await api.readCache(LOG_FILE))
        } catch {
          logs.value = []
        }
      })()
    }
    return logsPromise
  }

  function persistLogs(): void {
    void api.writeCache(LOG_FILE, JSON.stringify(logs.value)).catch(() => {
      // 写盘失败不影响生成，下次记录会重试
    })
  }

  function recordLog(entry: Omit<AILogEntry, 'id' | 'ts'>): void {
    logs.value = [
      {
        ...entry,
        id: `ailog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
      },
      ...logs.value,
    ].slice(0, LOG_LIMIT)
    persistLogs()
  }

  function removeLog(id: string): void {
    logs.value = logs.value.filter((l) => l.id !== id)
    persistLogs()
  }

  function clearLogs(): void {
    logs.value = []
    persistLogs()
  }

  async function generate(): Promise<void> {
    lastError.value = ''
    const article = app.text.trim()
    if (!article) {
      lastError.value = '请先在左侧输入正文'
      return
    }

    await load()
    if (!isComplete()) {
      // 配置不全：直接弹配置窗，填完保存后会自动接着生成
      pendingGenerate.value = true
      configOpen.value = true
      return
    }
    pendingGenerate.value = false
    await loadLogs()

    // 先生成一张占位封面顶上去：不动用户已有的封面，失败或取消再撤掉
    const placeholder = app.addCover()
    if (!placeholder) {
      lastError.value = `封面数量已达上限（${MAX_COVERS} 张）`
      return
    }
    const coverId = placeholder.id

    // 尺寸按封面页实际画布 × 像素倍率，与导出口径一致
    const box = pageCanvasSize(app.cfg, 'cover')
    const scale = app.cfg.canvas.scale
    const width = Math.round(box.width * scale)
    const height = Math.round(box.height * scale)
    const format = app.cfg.canvas.format
    // 日志里记的「宽x高」与实际发出去的一致（提示词里的尺寸说明由 Go 侧追加）
    const size = `${width}x${height}`
    // 请求发出去之前的配置快照：日志要记的是这一次真正用的值
    const sent = { ...config.image }

    app.setCoverGenerating(coverId, true)
    // 跳到占位封面，让用户看得见进度（封面页排在正文之前）
    const readyIdx = app.pages.findIndex((p) => p.kind === 'cover' && p.coverId === coverId)
    if (readyIdx >= 0) app.currentPage = readyIdx
    else app.currentPage = Math.max(0, app.cfg.cover.items.filter((c) => c.enabled).length - 1)

    try {
      const res = await api.generateCover(coverId, { article, coverId, width, height, format })

      await app.setCoverBackground(coverId, res.path)

      const target = app.cfg.cover.items.find((c) => c.id === coverId)
      if (target && target.background.path === res.path) {
        // 占位封面本来就没有背景，生成的图直接当底图
        target.background.fit = 'cover'
        target.background.blendMode = 'standalone'
        target.background.opacity = 1
      }
      recordLog({
        prompt: res.prompt,
        endpoint: sent.baseUrl,
        model: sent.model,
        size,
        format,
        quality: sent.quality,
        path: res.path,
      })
      app.notify('封面已生成')
    } catch (e) {
      // 失败或被取消：占位封面没有保留价值
      app.removeCover(coverId)
      const msg = e instanceof Error ? e.message : String(e)
      // 用户主动取消不算失败
      if (!/cancel/i.test(msg)) {
        lastError.value = msg
        app.notify(msg)
      }
    } finally {
      app.setCoverGenerating(coverId, false)
    }
  }

  async function cancel(): Promise<void> {
    const coverId = app.cfg.cover.activeId
    if (coverId) await api.cancelCover(coverId)
  }

  /** 左侧按钮：生成中就是取消 */
  async function toggle(): Promise<void> {
    if (activeGenerating.value) await cancel()
    else await generate()
  }

  return {
    config,
    configOpen,
    lastError,
    saving,
    load,
    save,
    exportConfig,
    importConfig,
    activeGenerating,
    // 生图日志
    logs,
    loadLogs,
    removeLog,
    clearLogs,
    generate,
    cancel,
    toggle,
  }
})
