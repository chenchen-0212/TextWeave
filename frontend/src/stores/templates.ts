import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { StyleConfig, Template } from '../types'
import { MAX_TEMPLATES, TEMPLATE_STORAGE_KEY, TEMPLATE_STORE_VERSION } from '../types'
import {
  buildSharePayload,
  decodeSharePayload,
  encodeShareCode,
  makeTemplateId,
  sanitizeConfig,
} from '../utils/templateCodec'
import { copyText, downloadText, readTextFromFile } from '../utils/download'
import { sanitizeFilename } from '../utils/filename'
import { useAppStore } from './config'

/**
 * 模板库。
 *
 * 存储策略：整个列表以单个 JSON 存在 localStorage 的一个键下。
 * 之所以不做分键存储：模板总量有上限（MAX_TEMPLATES），单键读写最简单，
 * 也不会出现「列表索引和实体不同步」的中间态。写入失败（配额超限）时
 * 会明确告知用户，而不是静默丢数据。
 *
 * 安全策略：读进来的数据一律先过 sanitizeConfig 再进内存，
 * 防止手工改过的 localStorage 或外部导入内容带进非法值。
 */

interface PersistShape {
  version: number
  items: Template[]
}

export type NoticeKind = 'info' | 'error' | 'success'

export const useTemplateStore = defineStore('templates', () => {
  const items = ref<Template[]>([])
  const loaded = ref(false)

  const noticeText = ref('')
  const noticeKind = ref<NoticeKind>('info')

  /** 当前生成的分享码 */
  const shareCode = ref('')
  const shareName = ref('')
  /** 分享码来源的模板 id，空串表示来自未保存的当前配置 */
  const shareSourceId = ref('')

  const count = computed(() => items.value.length)
  const hasTemplates = computed(() => items.value.length > 0)
  const shareCodeLength = computed(() => shareCode.value.length)

  function setNotice(text: string, kind: NoticeKind = 'info'): void {
    noticeText.value = text
    noticeKind.value = kind
  }

  function clearNotice(): void {
    noticeText.value = ''
  }

  // ---------------------------------------------------------------- 持久化

  /**
   * 把任意来源的一条记录净化为合法模板，非法则返回 null。
   * keepLocalPaths 为 true：localStorage 是本机数据，封面图路径需要保留。
   */
  function normalizeTemplate(raw: unknown): Template | null {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>

    const name =
      typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : '未命名模板'
    const config = sanitizeConfig(o.config, { keepLocalPaths: true })
    const now = Date.now()

    return {
      id: typeof o.id === 'string' && o.id ? o.id : makeTemplateId(),
      name,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : now,
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : now,
      canvas: { width: config.canvas.width, height: config.canvas.height },
      maskType: config.mask.type,
      config,
    }
  }

  function load(): void {
    if (loaded.value) return
    loaded.value = true

    let raw: string | null = null
    try {
      raw = localStorage.getItem(TEMPLATE_STORAGE_KEY)
    } catch {
      setNotice('无法访问本地存储，模板功能不可用', 'error')
      return
    }
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as Partial<PersistShape>
      if (!Array.isArray(parsed.items)) {
        throw new Error('结构不合法')
      }
      items.value = parsed.items
        .map(normalizeTemplate)
        .filter((t): t is Template => t !== null)
    } catch {
      // 数据损坏时清掉，避免每次启动都失败
      try {
        localStorage.removeItem(TEMPLATE_STORAGE_KEY)
      } catch {
        // 忽略
      }
      setNotice('本地模板数据已损坏，已重置为空列表', 'error')
    }
  }

  function persist(): boolean {
    try {
      const shape: PersistShape = { version: TEMPLATE_STORE_VERSION, items: items.value }
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(shape))
      return true
    } catch (e) {
      const isQuota =
        e instanceof DOMException &&
        (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
      setNotice(
        isQuota
          ? '本地存储空间不足，模板未保存。请先删除部分模板。'
          : '模板写入本地存储失败，请检查应用数据目录是否可写。',
        'error',
      )
      return false
    }
  }

  // ---------------------------------------------------------------- 增删改

  function find(id: string): Template | undefined {
    return items.value.find((t) => t.id === id)
  }

  function buildTemplate(name: string, config: StyleConfig, ts?: number): Template {
    const now = ts ?? Date.now()
    const safeName = (name.trim() || '未命名模板').slice(0, 60)
    return {
      id: makeTemplateId(),
      name: safeName,
      createdAt: now,
      updatedAt: now,
      canvas: { width: config.canvas.width, height: config.canvas.height },
      maskType: config.mask.type,
      // 本地模板保留封面图路径；分享码与导出文件在编码阶段会剥掉
      config: sanitizeConfig(config, { keepLocalPaths: true }),
    }
  }

  /** 把当前配置存为模板。返回新模板，失败返回 null。 */
  function saveCurrent(name: string): Template | null {
    const app = useAppStore()
    // snapshotConfig 会剔除输出目录等本机路径
    const tpl = buildTemplate(name, app.snapshotConfig())

    items.value = [tpl, ...items.value].slice(0, MAX_TEMPLATES)
    if (!persist()) {
      // 写失败就把刚加的这条撤回，保证内存与存储一致
      items.value = items.value.filter((t) => t.id !== tpl.id)
      return null
    }
    setNotice(`已保存模板「${tpl.name}」`, 'success')
    return tpl
  }

  function remove(id: string): boolean {
    const tpl = find(id)
    if (!tpl) return false
    const backup = items.value
    items.value = items.value.filter((t) => t.id !== id)
    if (!persist()) {
      items.value = backup
      return false
    }
    if (shareSourceId.value === id) {
      shareCode.value = ''
      shareSourceId.value = ''
      shareName.value = ''
    }
    setNotice(`已删除模板「${tpl.name}」`, 'info')
    return true
  }

  function rename(id: string, name: string): boolean {
    const tpl = find(id)
    if (!tpl) return false
    const next = name.trim().slice(0, 60)
    if (!next) {
      setNotice('模板名称不能为空', 'error')
      return false
    }
    const before = tpl.name
    tpl.name = next
    tpl.updatedAt = Date.now()
    if (!persist()) {
      tpl.name = before
      return false
    }
    setNotice('模板已重命名', 'info')
    return true
  }

  /** 应用模板到当前配置。 */
  function apply(id: string): boolean {
    const tpl = find(id)
    if (!tpl) {
      setNotice('模板不存在，可能已被删除', 'error')
      return false
    }
    const app = useAppStore()
    const { fontFallback } = app.applyTemplate(tpl.config)
    setNotice(
      fontFallback
        ? `已应用「${tpl.name}」。其中指定的字体在本机不存在，已回退到当前字体。`
        : `已应用「${tpl.name}」`,
      fontFallback ? 'info' : 'success',
    )
    return true
  }

  // ---------------------------------------------------------------- 分享

  /** 为某一份配置生成分享码。 */
  function generateShareCode(config: StyleConfig, name: string): string {
    return encodeShareCode(config, name)
  }

  /** 分享已保存的模板。 */
  function share(id: string): boolean {
    const tpl = find(id)
    if (!tpl) {
      setNotice('模板不存在', 'error')
      return false
    }
    shareCode.value = encodeShareCode(tpl.config, tpl.name)
    shareName.value = tpl.name
    shareSourceId.value = id
    clearNotice()
    return true
  }

  /** 分享当前配置（不落库）。 */
  function shareCurrent(name: string): void {
    const app = useAppStore()
    const displayName = name.trim() || '我的图文模板'
    shareCode.value = encodeShareCode(app.snapshotConfig(), displayName)
    shareName.value = displayName
    shareSourceId.value = ''
    clearNotice()
  }

  function clearShare(): void {
    shareCode.value = ''
    shareName.value = ''
    shareSourceId.value = ''
  }

  /** 复制分享码到剪贴板。 */
  async function copyShare(): Promise<boolean> {
    if (!shareCode.value) return false
    const ok = await copyText(shareCode.value)
    setNotice(ok ? '分享码已复制到剪贴板' : '复制失败，请手动选中文本复制', ok ? 'success' : 'error')
    return ok
  }

  /** 把模板导出为可归档的 JSON 文件。 */
  function exportFile(id: string): boolean {
    const tpl = find(id)
    if (!tpl) {
      setNotice('模板不存在', 'error')
      return false
    }
    const payload = buildSharePayload(tpl.config, tpl.name)
    const filename = `textweave-${sanitizeFilename(tpl.name, 30) || 'template'}.json`
    downloadText(filename, JSON.stringify(payload, null, 2))
    setNotice(`已导出 ${filename}`, 'success')
    return true
  }

  /** 把当前配置导出为 JSON 文件。 */
  function exportCurrent(name: string): void {
    const app = useAppStore()
    const displayName = name.trim() || '我的图文模板'
    const payload = buildSharePayload(app.snapshotConfig(), displayName)
    const filename = `textweave-${sanitizeFilename(displayName, 30) || 'template'}.json`
    downloadText(filename, JSON.stringify(payload, null, 2))
    setNotice(`已导出 ${filename}`, 'success')
  }

  // ---------------------------------------------------------------- 导入

  /**
   * 从文本导入模板。自动识别分享码与 JSON 两种形态。
   * @param applyNow 导入后是否立即应用到当前配置
   */
  function importFromText(text: string, applyNow: boolean): boolean {
    try {
      const decoded = decodeSharePayload(text)
      const tpl = buildTemplate(decoded.name, decoded.config, decoded.ts)

      items.value = [tpl, ...items.value].slice(0, MAX_TEMPLATES)
      if (!persist()) {
        items.value = items.value.filter((t) => t.id !== tpl.id)
        return false
      }

      setNotice(`已导入模板「${tpl.name}」`, 'success')
      if (applyNow) {
        apply(tpl.id)
      }
      return true
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '导入失败，内容无法识别', 'error')
      return false
    }
  }

  /** 从文件导入模板。 */
  async function importFromFile(file: File, applyNow: boolean): Promise<boolean> {
    try {
      const content = await readTextFromFile(file)
      return importFromText(content, applyNow)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '读取文件失败', 'error')
      return false
    }
  }

  return {
    items,
    count,
    hasTemplates,
    loaded,
    noticeText,
    noticeKind,
    shareCode,
    shareName,
    shareSourceId,
    shareCodeLength,
    clearNotice,
    setNotice,
    load,
    find,
    saveCurrent,
    remove,
    rename,
    apply,
    generateShareCode,
    share,
    shareCurrent,
    clearShare,
    copyShare,
    exportFile,
    exportCurrent,
    importFromText,
    importFromFile,
  }
})
