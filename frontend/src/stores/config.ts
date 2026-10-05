import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'

import type {
  CoverItem,
  Diagnostics,
  ExportSizeEntry,
  FontEntry,
  Geometry,
  ImageInfo,
  MaskType,
  Page,
  PyStatus,
  StyleConfig,
} from '../types'
import {
  CANVAS_PRESETS,
  MAX_COVERS,
  MAX_OVERLAY_ITEMS,
  defaultConfig,
  defaultCoverItem,
  defaultMaskOfType,
  defaultOverlayImageItem,
  defaultOverlayTextItem,
} from '../types'
import { buildLayout } from '../core/layout'
import { computeGeometry } from '../core/layout'
import { FontMetrics } from '../core/FontMetrics'
import { countChars } from '../core/normalizer'
import * as api from '../backend/api'
import { base64ToBlob } from '../utils/bytes'
import { sanitizeConfig } from '../utils/templateCodec'
import { joinDir, renderSubfolder } from '../utils/filename'
import { ensureFontLoaded, waitForFonts } from '../utils/fontLoader'
import type { BackgroundSource, RenderContext } from '../render/CanvasRenderer'
import { CanvasRenderer } from '../render/CanvasRenderer'
import { exportPages, exportSinglePage } from '../render/exporters'

/**
 * 应用状态编排：参数 → 重排 → 预览。
 *
 * 参数变更一律走「防抖 → 重排 → 发布布局树」的链路，界面组件只消费
 * 布局树与诊断信息，不参与任何排版计算。
 */

// 度量用的离屏 canvas。与绘制 canvas 分离，但字体设置完全一致，
// 因此两者的 measureText 结果相同。
let measureCtx: CanvasRenderingContext2D | null = null
let metrics: FontMetrics | null = null

function getMetrics(): FontMetrics {
  if (!metrics) {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建字体度量上下文')
    measureCtx = ctx
    metrics = new FontMetrics(ctx)
  }
  return metrics
}

export const useAppStore = defineStore('app', () => {
  // ------------------------------------------------------------ 配置

  const cfg = reactive<StyleConfig>(defaultConfig())

  // ------------------------------------------------------------ 输入

  const text = ref('')
  const bgPath = ref('')
  const bgName = ref('')
  const bgInfo = ref<ImageInfo | null>(null)
  const bgBitmap = shallowRef<ImageBitmap | null>(null)
  const bgError = ref('')
  /** 背景图预览用的 object URL，切换背景时需回收 */
  const bgPreviewUrl = ref('')
  /** 封面专属背景图的操作错误（与正文背景的错误分开，避免互相覆盖） */
  const coverBackgroundError = ref('')

  /**
   * 封面专属背景图的位图缓存，key 为文件绝对路径。
   *
   * 用 Map 而不是逐个 ref：同一张图可能被多张封面引用，按路径去重可以避免
   * 重复解码；替换整个 Map 引用才能触发 shallowRef 的响应式更新。
   */
  const coverImages = shallowRef<Map<string, BackgroundSource>>(new Map())

  /**
   * 引导元素图片（二维码/logo/水印）的位图缓存，结构与 coverImages 相同。
   * 多个元素可引用同一张图（如每页同一枚二维码），按路径去重。
   */
  const overlayImages = shallowRef<Map<string, BackgroundSource>>(new Map())

  // ------------------------------------------------------------ 字体

  const fonts = ref<FontEntry[]>([])
  const fontsLoading = ref(false)
  const fontWarning = ref('')

  // ------------------------------------------------------------ 布局结果

  const pages = shallowRef<Page[]>([])
  const diag = ref<Diagnostics | null>(null)
  const geometry = shallowRef<Geometry | null>(null)
  const layoutMessage = ref('')
  const layoutViolated = ref(false)
  const rebuilding = ref(false)
  const currentPage = ref(0)

  // ------------------------------------------------------------ 导出

  const exporting = ref(false)
  const exportDone = ref(0)
  const exportTotal = ref(0)
  const exportPhase = ref('')
  const exportError = ref('')
  const exportSuccess = ref('')
  let cancelRequested = false

  // ------------------------------------------------------------ 环境信息

  const py = ref<PyStatus | null>(null)
  const appVersion = ref('')
  const configDir = ref('')
  /** 文件拖拽是否注册成功。注册失败时界面上要给出提示，否则用户会以为拖拽坏了。 */
  const dragDropReady = ref(false)

  // ------------------------------------------------------------ 派生

  const charCount = computed(() => countChars(text.value))
  const totalPages = computed(() => pages.value.length)
  const current = computed<Page | null>(() => pages.value[currentPage.value] ?? null)
  const hasContent = computed(() => pages.value.length > 0)

  const geometryResolved = computed<Geometry>(
    () => geometry.value ?? computeGeometry(cfg, cfg.text.fontSize, 1),
  )

  /**
   * 配置版本号。
   *
   * 预览需要响应**任意**参数变化（包括亮度、蒙版浓度这类纯视觉参数），
   * 但 renderCtx 内部只引用了 cfg 对象本身，不会追踪其嵌套属性。
   * 因此用一个深度 watch 驱动的计数器作为显式依赖。
   */
  const cfgVersion = ref(0)

  /** 渲染上下文：所有预览与导出共用，保证像素一致。 */
  const renderCtx = computed<RenderContext>(() => {
    // 显式读取版本号，建立依赖关系
    void cfgVersion.value
    const info = bgInfo.value
    const bmp = bgBitmap.value
    return {
      cfg: cfg as StyleConfig,
      geo: geometryResolved.value,
      background:
        bmp && info ? { image: bmp, width: info.width, height: info.height } : null,
      // 封面专属背景图缓存（Map 整体替换以触发更新）
      coverImages: coverImages.value,
      // 引导元素图片缓存
      overlayImages: overlayImages.value,
    }
  })

  /** 预计张数（用于输入阶段的即时反馈）。 */
  const estimateLabel = computed(() => {
    if (charCount.value === 0) return '尚无内容'
    if (pages.value.length === 0) return `${charCount.value} 字`
    return `${charCount.value} 字 · ${pages.value.length} 张`
  })

  /** 启用中的封面数量 */
  const enabledCoverCount = computed(
    () => cfg.cover.items.filter((c) => c.enabled).length,
  )

  /**
   * 主封面标题。
   * 用于文件名模板的 {title} 变量与快速存模板时的默认命名 ——
   * 多封面场景下取第一张启用封面的标题作为系列代表。
   */
  const primaryCoverTitle = computed(() => {
    const first = cfg.cover.items.find((c) => c.enabled) ?? cfg.cover.items[0]
    return first?.title?.trim() ?? ''
  })

  // 导出专用的离屏 canvas（与预览 canvas 分开，避免互相干扰）
  let exportRenderer: CanvasRenderer | null = null
  function getExportRenderer(): CanvasRenderer {
    if (!exportRenderer) {
      exportRenderer = new CanvasRenderer(document.createElement('canvas'))
    }
    return exportRenderer
  }

  // ------------------------------------------------------------ 重排

  let rebuildTimer: number | null = null
  let pendingRebuild = false

  /** 防抖重排。delay 为 0 表示尽快执行。 */
  function scheduleRebuild(delay = 120): void {
    if (rebuildTimer !== null) {
      clearTimeout(rebuildTimer)
    }
    if (delay <= 0) {
      rebuildTimer = null
      void rebuild()
      return
    }
    rebuildTimer = window.setTimeout(() => {
      rebuildTimer = null
      void rebuild()
    }, delay)
  }

  async function rebuild(): Promise<void> {
    // 合并并发调用：重排期间再次被触发时，结束后再跑一次即可
    if (rebuilding.value) {
      pendingRebuild = true
      return
    }
    rebuilding.value = true
    try {
      await waitForFonts()

      if (cfg.text.fontSource === 'user' && cfg.text.fontPath) {
        const ok = await ensureFontLoaded(cfg.text.fontFamily, cfg.text.fontPath)
        fontWarning.value = ok ? '' : '自定义字体加载失败，已回退到系统字体'
      } else {
        fontWarning.value = ''
      }

      const m = getMetrics()
      m.reset()

      const out = buildLayout(text.value, cfg as StyleConfig, m)

      pages.value = out.pages
      diag.value = out.diag
      geometry.value = out.geometry
      layoutMessage.value = out.message
      layoutViolated.value = out.violated

      if (currentPage.value >= out.pages.length) {
        currentPage.value = Math.max(0, out.pages.length - 1)
      }
    } catch (e) {
      layoutMessage.value = e instanceof Error ? e.message : String(e)
      pages.value = []
      diag.value = null
    } finally {
      rebuilding.value = false
      if (pendingRebuild) {
        pendingRebuild = false
        void rebuild()
      }
    }
  }

  // ------------------------------------------------------------ 配置持久化

  let coverSyncTimer: number | null = null

  /**
   * 延迟同步封面背景图。
   * 拖动封面参数滑块时会频繁触发配置变更，这里合并成一次，
   * 避免反复探测文件系统。
   */
  function scheduleCoverSync(delay = 260): void {
    if (coverSyncTimer !== null) clearTimeout(coverSyncTimer)
    coverSyncTimer = window.setTimeout(() => {
      coverSyncTimer = null
      void syncCoverImages()
    }, delay)
  }

  let saveTimer: number | null = null

  function scheduleSave(): void {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void persist()
    }, 500)
  }

  async function persist(): Promise<void> {
    try {
      await api.saveConfig(JSON.stringify(cfg))
    } catch {
      // 保存失败不打断使用，下次变更会重试
    }
  }

  watch(
    cfg,
    () => {
      cfgVersion.value++
      scheduleRebuild()
      scheduleSave()
      scheduleCoverSync()
    },
    { deep: true },
  )

  watch(text, () => {
    scheduleRebuild()
  })

  // ------------------------------------------------------------ 初始化

  async function init(): Promise<void> {
    // 1) 载入上次配置
    try {
      const raw = await api.loadConfig()
      if (raw) {
        const saved = JSON.parse(raw) as Partial<StyleConfig>
        mergeConfig(saved)
      }
    } catch {
      // 配置损坏时静默回退到默认值，不阻塞启动
    }

    // 2) 环境信息
    void api.pyStatus().then((s) => {
      py.value = s
    })
    void api.getConfigDir().then((d) => {
      configDir.value = d
    })
    void api.appInfo().then((i) => {
      appVersion.value = i.version || ''
    })

    // 3) 字体列表（首次扫描较慢，异步进行）
    void loadFonts()

    // 4) 首轮排版
    await rebuild()

    // 5) 加载封面专属背景图（配置里可能存有上次使用的封面图路径）
    await syncCoverImages()

    // 6) 默认导出目录
    if (!cfg.export.dir && configDir.value) {
      cfg.export.dir = configDir.value
    }
  }

  /**
   * 把持久化的配置合并进当前配置。
   *
   * 走 sanitizeConfig 而不是裸 Object.assign：
   *  1. 缺失字段自动补默认值（跨版本升级时结构可能变化）
   *  2. 数值越界、枚举非法、结构损坏都能被兜住
   *  3. 封面结构从 v1 到 v2 的迁移逻辑只写了一遍，这里直接复用
   * keepLocalPaths 为 true 是因为这是本机自己的数据，封面图与输出目录的路径要保留。
   */
  function mergeConfig(saved: Partial<StyleConfig>): void {
    try {
      const clean = sanitizeConfig(saved, { keepLocalPaths: true })
      Object.assign(cfg, clean)
    } catch {
      // 配置损坏时保持默认值，不影响启动
    }
  }

  async function loadFonts(): Promise<void> {
    fontsLoading.value = true
    try {
      const list = await api.listFonts()
      fonts.value = list
      // 尚未选定字体时挑一个合理的默认值
      if (!cfg.text.fontFamily && list.length > 0) {
        const preferred = ['微软雅黑', 'Microsoft YaHei', '思源黑体', 'Noto Sans CJK SC', '黑体']
        const hit = list.find((f) => preferred.includes(f.family))
        const chosen = hit ?? list[0]
        cfg.text.fontFamily = chosen.family
        cfg.text.fontSource = chosen.source
        cfg.text.fontPath = chosen.source === 'user' ? chosen.path : ''
      }
    } finally {
      fontsLoading.value = false
    }
  }

  // ------------------------------------------------------------ 背景图

  async function setBackground(path: string): Promise<void> {
    bgError.value = ''
    try {
      const info = await api.probeImage(path)
      if (!info) {
        bgError.value = '无法识别的图片格式（支持 PNG / JPG / WebP / BMP / GIF）'
        return
      }
      const b64 = await api.readFileBase64(path)
      if (!b64) {
        bgError.value = '读取图片失败'
        return
      }
      const blob = base64ToBlob(b64, info.mime)
      const bitmap = await createImageBitmap(blob)

      // 释放上一张位图与预览 URL，避免内存堆积
      bgBitmap.value?.close?.()
      if (bgPreviewUrl.value) URL.revokeObjectURL(bgPreviewUrl.value)

      bgBitmap.value = bitmap
      bgPreviewUrl.value = URL.createObjectURL(blob)
      bgInfo.value = info
      bgPath.value = path
      bgName.value = info.name
      scheduleRebuild(0)
    } catch (e) {
      bgError.value = e instanceof Error ? e.message : '导入背景图失败'
    }
  }

  async function chooseBackground(): Promise<void> {
    try {
      const path = await api.pickImage()
      if (path) await setBackground(path)
    } catch (e) {
      bgError.value = e instanceof Error ? e.message : '打开图片选择对话框失败'
    }
  }

  /** 通过拖拽导入背景图（Wails 的 OnFileDrop 能拿到真实路径）。 */
  async function dropBackground(path: string): Promise<void> {
    await setBackground(path)
  }

  /** 通过拖拽导入文本。 */
  async function dropTextFile(path: string): Promise<void> {
    try {
      const content = await api.readTextFile(path)
      text.value = content
    } catch (e) {
      layoutMessage.value = e instanceof Error ? e.message : '读取文本文件失败'
    }
  }

  function clearBackground(): void {
    bgBitmap.value?.close?.()
    bgBitmap.value = null
    if (bgPreviewUrl.value) {
      URL.revokeObjectURL(bgPreviewUrl.value)
      bgPreviewUrl.value = ''
    }
    bgInfo.value = null
    bgPath.value = ''
    bgName.value = ''
    scheduleRebuild(0)
  }

  // ------------------------------------------------------------ 封面

  async function ensureCoverImage(path: string): Promise<BackgroundSource | null> {
    if (!path) return null
    const cached = coverImages.value.get(path)
    if (cached) return cached

    try {
      const info = await api.probeImage(path)
      if (!info) return null
      const b64 = await api.readFileBase64(path)
      if (!b64) return null

      const bitmap = await createImageBitmap(base64ToBlob(b64, info.mime))
      const src: BackgroundSource = { image: bitmap, width: info.width, height: info.height }

      const next = new Map(coverImages.value)
      next.set(path, src)
      coverImages.value = next
      return src
    } catch {
      return null
    }
  }

  /** 释放不再被任何封面引用的位图，避免长时间编辑后内存堆积。 */
  function pruneCoverImages(): void {
    const live = new Set(
      cfg.cover.items
        .filter((it) => it.enabled && it.background.useOwn && it.background.path)
        .map((it) => it.background.path),
    )

    let changed = false
    const next = new Map<string, BackgroundSource>()
    for (const [key, src] of coverImages.value) {
      if (live.has(key)) {
        next.set(key, src)
      } else {
        ;(src.image as ImageBitmap).close?.()
        changed = true
      }
    }
    if (changed) coverImages.value = next
  }

  /** 预加载所有启用封面用到的专属背景图，并同步引导元素图片的加载与回收。 */
  async function syncCoverImages(): Promise<void> {
    const coverWanted = new Set<string>()
    for (const it of cfg.cover.items) {
      if (it.enabled && it.background.useOwn && it.background.path) {
        coverWanted.add(it.background.path)
      }
    }
    const overlayWanted = new Set<string>()
    for (const it of cfg.overlay.items) {
      if (it.enabled && it.kind === 'image' && it.path) {
        overlayWanted.add(it.path)
      }
    }

    let loaded = 0
    for (const p of coverWanted) {
      if (!coverImages.value.has(p)) {
        const src = await ensureCoverImage(p)
        if (src) loaded++
      }
    }
    for (const p of overlayWanted) {
      if (!overlayImages.value.has(p)) {
        const src = await ensureOverlayImage(p)
        if (src) loaded++
      }
    }
    pruneCoverImages()
    pruneOverlayImages()
    if (loaded > 0) scheduleRebuild(0)
  }

  /** 加载一张引导元素图片到 overlayImages 缓存（与封面图缓存互相独立）。 */
  async function ensureOverlayImage(path: string): Promise<BackgroundSource | null> {
    if (!path) return null
    const cached = overlayImages.value.get(path)
    if (cached) return cached

    try {
      const info = await api.probeImage(path)
      if (!info) return null
      const b64 = await api.readFileBase64(path)
      if (!b64) return null

      const bitmap = await createImageBitmap(base64ToBlob(b64, info.mime))
      const src: BackgroundSource = { image: bitmap, width: info.width, height: info.height }

      const next = new Map(overlayImages.value)
      next.set(path, src)
      overlayImages.value = next
      return src
    } catch {
      return null
    }
  }

  /** 释放不再被任何引导元素引用的图片位图。 */
  function pruneOverlayImages(): void {
    const live = new Set(
      cfg.overlay.items
        .filter((it) => it.enabled && it.kind === 'image' && it.path)
        .map((it) => (it as { path: string }).path),
    )

    let changed = false
    const next = new Map<string, BackgroundSource>()
    for (const [key, src] of overlayImages.value) {
      if (live.has(key)) {
        next.set(key, src)
      } else {
        ;(src.image as ImageBitmap).close?.()
        changed = true
      }
    }
    if (changed) overlayImages.value = next
  }

  function activeCover(): CoverItem | null {
    const items = cfg.cover.items
    if (items.length === 0) return null
    return items.find((it) => it.id === cfg.cover.activeId) ?? items[0]
  }

  function setActiveCover(id: string): void {
    cfg.cover.activeId = id
  }

  /** 新增封面，继承当前封面的版式设置，便于批量产出风格一致的封面。 */
  function addCover(): CoverItem | null {
    if (cfg.cover.items.length >= MAX_COVERS) {
      layoutMessage.value = `最多支持 ${MAX_COVERS} 张封面`
      return null
    }
    const base = activeCover()
    const item = defaultCoverItem(cfg.cover.items.length + 1)
    if (base) {
      item.titleFontSize = base.titleFontSize
      item.titleWeight = base.titleWeight
      item.layout = base.layout
      item.color = base.color
      item.useOwnMask = base.useOwnMask
      item.mask = JSON.parse(JSON.stringify(base.mask))
      item.background = JSON.parse(JSON.stringify(base.background))
      // 背景图不继承：新封面默认回到「沿用正文背景」，避免误用同一张图
      item.background.path = ''
      item.background.name = ''
      item.background.useOwn = false
    }
    cfg.cover.items.push(item)
    cfg.cover.activeId = item.id
    return item
  }

  /** 复制一张封面（含背景图设置），插到原封面之后。 */
  function duplicateCover(id: string): CoverItem | null {
    if (cfg.cover.items.length >= MAX_COVERS) {
      layoutMessage.value = `最多支持 ${MAX_COVERS} 张封面`
      return null
    }
    const idx = cfg.cover.items.findIndex((it) => it.id === id)
    if (idx < 0) return null

    const src = cfg.cover.items[idx]
    const copy: CoverItem = JSON.parse(JSON.stringify(src))
    copy.id = `cover-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    copy.title = src.title ? `${src.title} 副本` : ''

    cfg.cover.items.splice(idx + 1, 0, copy)
    cfg.cover.activeId = copy.id
    void syncCoverImages()
    return copy
  }

  /** 删除封面。始终保留至少一张，避免界面出现空列表无法录入。 */
  function removeCover(id: string): void {
    if (cfg.cover.items.length <= 1) {
      layoutMessage.value = '至少保留一张封面'
      return
    }
    const idx = cfg.cover.items.findIndex((it) => it.id === id)
    if (idx < 0) return

    cfg.cover.items.splice(idx, 1)
    if (cfg.cover.activeId === id) {
      const next = cfg.cover.items[Math.min(idx, cfg.cover.items.length - 1)]
      cfg.cover.activeId = next.id
    }
    scheduleRebuild(0)
  }

  /** 调整封面顺序。delta 为 -1 上移、+1 下移。 */
  function moveCover(id: string, delta: number): void {
    const idx = cfg.cover.items.findIndex((it) => it.id === id)
    if (idx < 0) return
    const target = idx + delta
    if (target < 0 || target >= cfg.cover.items.length) return

    const items = cfg.cover.items
    const [moved] = items.splice(idx, 1)
    items.splice(target, 0, moved)
    scheduleRebuild(0)
  }

  /** 为某张封面选择并加载专属背景图。 */
  async function pickCoverBackground(id: string): Promise<void> {
    const cover = cfg.cover.items.find((it) => it.id === id)
    if (!cover) return

    let path = ''
    try {
      path = await api.pickImage()
    } catch (e) {
      coverBackgroundError.value = e instanceof Error ? e.message : '打开图片选择对话框失败'
      return
    }
    if (!path) return
    await setCoverBackground(id, path)
  }

  /** 直接为某张封面设置背景图（拖拽导入也走这里）。 */
  async function setCoverBackground(id: string, path: string): Promise<void> {
    const cover = cfg.cover.items.find((it) => it.id === id)
    if (!cover) return

    coverBackgroundError.value = ''
    const info = await api.probeImage(path)
    if (!info) {
      coverBackgroundError.value = '无法识别的图片格式（支持 PNG / JPG / WebP / BMP / GIF）'
      return
    }

    const src = await ensureCoverImage(path)
    if (!src) {
      coverBackgroundError.value = '读取封面背景图失败'
      return
    }

    cover.background.useOwn = true
    cover.background.path = path
    cover.background.name = info.name
    scheduleRebuild(0)
  }

  /** 让某张封面回到「沿用正文背景」。 */
  function clearCoverBackground(id: string): void {
    const cover = cfg.cover.items.find((it) => it.id === id)
    if (!cover) return
    cover.background.useOwn = false
    cover.background.path = ''
    cover.background.name = ''
    pruneCoverImages()
    scheduleRebuild(0)
  }

  /** 切换封面是否参与输出。 */
  function toggleCover(id: string): void {
    const cover = cfg.cover.items.find((it) => it.id === id)
    if (!cover) return
    cover.enabled = !cover.enabled
    void syncCoverImages()
    scheduleRebuild(0)
  }

  // ------------------------------------------------------------ 文本

  async function importTextFile(): Promise<void> {
    try {
      const path = await api.pickTextFile()
      if (!path) return
      const content = await api.readTextFile(path)
      text.value = content
    } catch (e) {
      layoutMessage.value = e instanceof Error ? e.message : '导入文本失败'
    }
  }

  // ------------------------------------------------------------ 画布 / 蒙版快捷操作

  function applyPreset(id: string): void {
    const preset = CANVAS_PRESETS.find((p) => p.id === id)
    if (!preset) {
      cfg.canvas.preset = 'custom'
      return
    }
    cfg.canvas.preset = preset.id
    cfg.canvas.width = preset.width
    cfg.canvas.height = preset.height
  }

  function markCustomSize(): void {
    cfg.canvas.preset = 'custom'
  }

  function switchMaskType(type: MaskType): void {
    if (cfg.mask.type === type) return
    // 记住各形态上次的参数，切回来时不会丢配置
    const previous = cfg.mask
    const next = defaultMaskOfType(type)
    if (previous && previous.type === type) {
      cfg.mask = previous
      return
    }
    cfg.mask = next
  }

  // ------------------------------------------------------------ 导出

  async function chooseOutputDir(): Promise<void> {
    try {
      const dir = await api.pickOutputDir()
      if (dir) cfg.export.dir = dir
    } catch (e) {
      exportError.value = e instanceof Error ? e.message : '打开目录选择对话框失败'
    }
  }

  /** 解析实际输出目录：配置目录 + 子目录模板（size 传入时进入 {size} 变量）。 */
  function resolveOutDir(sizeLabel?: string, bookOverride?: string): string {
    const sub = renderSubfolder(cfg.channel.subfolderPattern, {
      book: bookOverride ?? cfg.export.book,
      channel: cfg.channel.name,
      size: sizeLabel,
      date: new Date(),
    })
    return joinDir(cfg.export.dir, sub)
  }

  async function runExport(bookOverride?: string): Promise<void> {
    if (exporting.value) return
    exportError.value = ''
    exportSuccess.value = ''

    if (!cfg.export.dir) {
      exportError.value = '请先选择输出目录'
      return
    }
    if (pages.value.length === 0) {
      exportError.value = '没有可导出的页面，请先输入文本'
      return
    }

    exporting.value = true
    cancelRequested = false
    exportDone.value = 0
    exportTotal.value = pages.value.length
    exportPhase.value = '准备导出'

    try {
      const result = await exportPages({
        pages: pages.value,
        rc: renderCtx.value,
        renderer: getExportRenderer(),
        onProgress: (p) => {
          exportDone.value = p.done
          exportTotal.value = p.total
          exportPhase.value = p.phase
        },
        shouldCancel: () => cancelRequested,
        // 批处理队列按任务传书名，覆盖配置里的标签
        labels: bookOverride !== undefined ? { book: bookOverride } : undefined,
      })

      const outDir = result.outDir || cfg.export.dir
      if (result.cancelled) {
        exportSuccess.value = `已取消，成功导出 ${result.files.length} 张`
      } else {
        const zipNote = result.zipPath ? '，并已打包 ZIP' : ''
        exportSuccess.value = `已导出 ${result.files.length} 张到 ${outDir}${zipNote}`
        recordHistory(result.files.length, outDir)
      }
    } catch (e) {
      exportError.value = e instanceof Error ? e.message : '导出失败'
    } finally {
      exporting.value = false
      exportPhase.value = ''
    }
  }

  /**
   * 多尺寸一次导出（对应优化项 O-01）。
   *
   * 每个勾选的渠道尺寸用同一份文本与视觉参数**独立重排**——不同宽高比下
   * 分页张数可以不同，这是预期行为。所有尺寸先纯计算完布局，再统一逐张落盘，
   * 全程共用单个导出 canvas，内存策略与单尺寸导出一致。
   */
  async function runExportMultiSize(): Promise<void> {
    if (exporting.value) return
    exportError.value = ''
    exportSuccess.value = ''

    if (!cfg.export.dir) {
      exportError.value = '请先选择输出目录'
      return
    }
    if (!text.value.trim()) {
      exportError.value = '没有可导出的页面，请先输入文本'
      return
    }
    if (cfg.channel.sizes.length === 0) {
      exportError.value = '请先勾选至少一个目标尺寸'
      return
    }

    exporting.value = true
    cancelRequested = false
    exportDone.value = 0
    exportPhase.value = '准备多尺寸导出'

    try {
      await waitForFonts()
      const m = getMetrics()
      m.reset()

      // 先把各尺寸的布局全部算完（core 层纯计算），拿到总张数后再统一导出
      const jobs: Array<{
        size: ExportSizeEntry
        cfg: StyleConfig
        pages: Page[]
        geo: Geometry
      }> = []
      for (const size of cfg.channel.sizes) {
        const variant = JSON.parse(JSON.stringify(cfg)) as StyleConfig
        variant.canvas.preset = 'custom'
        variant.canvas.width = size.width
        variant.canvas.height = size.height
        const out = buildLayout(text.value, variant, m)
        if (out.pages.length > 0) {
          jobs.push({ size, cfg: variant, pages: out.pages, geo: out.geometry })
        }
      }
      if (jobs.length === 0) {
        throw new Error('没有可导出的页面，请先输入文本')
      }

      const bgSource = renderCtx.value.background
      exportTotal.value = jobs.reduce((sum, j) => sum + j.pages.length, 0)

      let done = 0
      let exported = 0
      let cancelled = false
      let firstOutDir = ''

      for (const job of jobs) {
        if (cancelRequested) {
          cancelled = true
          break
        }
        const rc: RenderContext = {
          cfg: job.cfg,
          geo: job.geo,
          background: bgSource,
          coverImages: coverImages.value,
          overlayImages: overlayImages.value,
        }
        const outDir = resolveOutDir(job.size.label)
        const result = await exportPages({
          pages: job.pages,
          rc,
          renderer: getExportRenderer(),
          onProgress: (p) => {
            exportDone.value = done + p.done
            exportPhase.value = `${job.size.label} · ${p.phase}`
          },
          shouldCancel: () => cancelRequested,
          labels: { size: job.size.label },
          dirOverride: outDir,
        })
        done += job.pages.length
        exported += result.files.length
        if (!firstOutDir && result.outDir) firstOutDir = result.outDir
        if (result.cancelled) {
          cancelled = true
          break
        }
      }

      exportDone.value = done
      if (cancelled) {
        exportSuccess.value = `已取消，成功导出 ${exported} 张`
      } else {
        exportSuccess.value = `多尺寸导出完成：${jobs.length} 组共 ${exported} 张，输出于 ${firstOutDir || cfg.export.dir}`
        recordHistory(exported, firstOutDir || cfg.export.dir, jobs.map((j) => j.size.label).join('+'))
      }
    } catch (e) {
      exportError.value = e instanceof Error ? e.message : '多尺寸导出失败'
    } finally {
      exporting.value = false
      exportPhase.value = ''
    }
  }

  function cancelExport(): void {
    cancelRequested = true
  }

  async function runExportCurrent(): Promise<void> {
    const page = current.value
    if (!page) return
    exportError.value = ''
    exportSuccess.value = ''
    try {
      const full = await exportSinglePage(
        page,
        currentPage.value + 1,
        pages.value.length,
        renderCtx.value,
        getExportRenderer(),
      )
      exportSuccess.value = `已导出当前页：${full}`
    } catch (e) {
      exportError.value = e instanceof Error ? e.message : '导出失败'
    }
  }

  // ------------------------------------------------------------ 引导元素图层（N-03）

  /** 新增一个文字条引导元素（CTA / 账号名等）。 */
  function addOverlayText(): void {
    if (cfg.overlay.items.length >= MAX_OVERLAY_ITEMS) {
      layoutMessage.value = `最多 ${MAX_OVERLAY_ITEMS} 个引导元素`
      return
    }
    cfg.overlay.items.push(defaultOverlayTextItem())
  }

  /** 新增一个图片引导元素（二维码 / logo / 水印），弹出选图。 */
  async function addOverlayImage(): Promise<void> {
    if (cfg.overlay.items.length >= MAX_OVERLAY_ITEMS) {
      layoutMessage.value = `最多 ${MAX_OVERLAY_ITEMS} 个引导元素`
      return
    }
    let path = ''
    try {
      path = await api.pickImage()
    } catch (e) {
      exportError.value = e instanceof Error ? e.message : '打开图片选择对话框失败'
      return
    }
    if (!path) return

    const info = await api.probeImage(path)
    if (!info) {
      layoutMessage.value = '无法识别的图片格式'
      return
    }
    const item = defaultOverlayImageItem()
    item.path = path
    item.name = info.name
    cfg.overlay.items.push(item)
    await ensureOverlayImage(path)
    scheduleRebuild(0)
  }

  function removeOverlay(id: string): void {
    const idx = cfg.overlay.items.findIndex((it) => it.id === id)
    if (idx < 0) return
    cfg.overlay.items.splice(idx, 1)
    pruneOverlayImages()
    scheduleRebuild(0)
  }

  // ------------------------------------------------------------ 历史任务存档（N-06）

  const HISTORY_STORAGE_KEY = 'textweave.history.v1'
  const HISTORY_LIMIT = 20
  const HISTORY_TEXT_LIMIT = 20000

  /** 一条历史快照：恢复一次导出所需的全部信息 */
  interface HistoryEntry {
    id: string
    /** 导出时间戳（毫秒） */
    ts: number
    /** 导出张数 */
    pages: number
    /** 尺寸标签（多尺寸导出时为组合名） */
    sizeLabel: string
    /** 实际输出目录 */
    outDir: string
    /** 任务书名 */
    book: string
    /** 渠道名 */
    channel: string
    /** 正文文本（截断存档） */
    text: string
    /** 背景图路径 */
    bgPath: string
    bgName: string
    /** 完整配置快照（含路径，本机数据） */
    config: StyleConfig
  }

  const exportHistory = ref<HistoryEntry[]>(loadHistory())

  function loadHistory(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
      if (!raw) return []
      const list = JSON.parse(raw)
      if (!Array.isArray(list)) return []
      return list.slice(0, HISTORY_LIMIT)
    } catch {
      return []
    }
  }

  function persistHistory(): void {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(exportHistory.value))
    } catch {
      // 配额不足等情况忽略，不影响导出主流程
    }
  }

  /** 导出成功后记录一条快照（供「历史任务」一键复现）。 */
  function recordHistory(pages: number, outDir: string, sizeLabel = ''): void {
    const entry: HistoryEntry = {
      id: `his-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      pages,
      sizeLabel,
      outDir,
      book: cfg.export.book,
      channel: cfg.channel.name,
      text: text.value.slice(0, HISTORY_TEXT_LIMIT),
      bgPath: bgPath.value,
      bgName: bgName.value,
      // 快照含封面图/字体路径：本机数据，复现时免去重选
      config: sanitizeConfig(JSON.parse(JSON.stringify(cfg)), { keepLocalPaths: true }),
    }
    // 同一分钟内的重复导出不重复记录（微调重导场景）
    const dup = exportHistory.value.find(
      (h) => h.text === entry.text && h.bgPath === entry.bgPath && entry.ts - h.ts < 60_000,
    )
    if (dup) return
    exportHistory.value = [entry, ...exportHistory.value].slice(0, HISTORY_LIMIT)
    persistHistory()
  }

  /** 恢复一条历史快照：配置 + 文本 + 背景图一并回到工作区。 */
  async function restoreHistory(id: string): Promise<void> {
    const entry = exportHistory.value.find((h) => h.id === id)
    if (!entry) return
    mergeConfig(JSON.parse(JSON.stringify(entry.config)))
    text.value = entry.text
    if (entry.bgPath) {
      await setBackground(entry.bgPath)
    } else {
      scheduleRebuild(0)
    }
    exportSuccess.value = `已恢复历史任务（${formatTime(entry.ts)}），请核对后导出`
  }

  function removeHistory(id: string): void {
    exportHistory.value = exportHistory.value.filter((h) => h.id !== id)
    persistHistory()
  }

  function clearHistory(): void {
    exportHistory.value = []
    persistHistory()
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  // ------------------------------------------------------------ 字体管理

  async function chooseAndImportFont(): Promise<void> {
    fontWarning.value = ''
    let src = ''
    try {
      src = await api.pickFontFile()
    } catch (e) {
      fontWarning.value = e instanceof Error ? e.message : '打开字体选择对话框失败'
      return
    }
    if (!src) return
    try {
      const entry = await api.importFont(src)
      if (!entry) return
      await loadFonts()
      cfg.text.fontFamily = entry.family
      cfg.text.fontSource = 'user'
      cfg.text.fontPath = entry.path
      scheduleRebuild(0)
    } catch (e) {
      fontWarning.value = e instanceof Error ? e.message : '字体导入失败'
    }
  }

  async function deleteFont(path: string): Promise<void> {
    try {
      await api.removeFont(path)
      if (cfg.text.fontPath === path) {
        cfg.text.fontSource = 'system'
        cfg.text.fontPath = ''
      }
      await loadFonts()
      scheduleRebuild(0)
    } catch (e) {
      fontWarning.value = e instanceof Error ? e.message : '字体移除失败'
    }
  }

  function selectFont(family: string, source: 'system' | 'user', path: string): void {
    cfg.text.fontFamily = family
    cfg.text.fontSource = source
    cfg.text.fontPath = source === 'user' ? path : ''
    scheduleRebuild(0)
  }

  // ------------------------------------------------------------ 重置

  function resetConfig(): void {
    Object.assign(cfg, defaultConfig())
    scheduleRebuild(0)
  }

  /**
   * 把模板指定的字体解析到本机可用的字体上。
   *
   * 模板可能在别人机器上创建，指定的字体本机未必存在；直接套用会渲染出满屏方块。
   * 因此逐级回退：同名系统字体 → 同名用户字体 → 当前字体 → 字体列表首项。
   * 返回 true 表示发生了回退。
   */
  function resolveTemplateFont(target: StyleConfig['text']): boolean {
    const list = fonts.value
    // 字体列表尚未扫描完成时不做判断，避免把用户原本可用的字体误替换掉
    if (list.length === 0) return false

    const hit = list.find((f) => f.family === target.fontFamily)
    if (hit) {
      target.fontSource = hit.source
      target.fontPath = hit.source === 'user' ? hit.path : ''
      return false
    }

    const current = list.find((f) => f.family === cfg.text.fontFamily)
    const fallback = current ?? list[0]
    target.fontFamily = fallback.family
    target.fontSource = fallback.source
    target.fontPath = fallback.source === 'user' ? fallback.path : ''
    return true
  }

  /**
   * 应用一份模板配置。
   *
   * 两处刻意保留本机现状：
   *   - 输出目录：模板里的路径是别人的机器路径，套用后会导出失败；
   *   - 字体路径由 resolveTemplateFont 重新解析。
   *
   * keepLocalPaths 为 true：模板来自本机模板库时，封面专属背景图的路径应当保留，
   * 否则同一台机器上套用自己的模板还要重新选一遍图。
   * 从分享码导入的配置已经在解码阶段剥掉了路径，这里传 true 也不会带进来外部路径。
   */
  function applyTemplate(next: StyleConfig): { fontFallback: boolean } {
    const sanitized = sanitizeConfig(next, { keepLocalPaths: true })
    sanitized.export.dir = cfg.export.dir
    const fontFallback = resolveTemplateFont(sanitized.text)

    const before = new Set(
      cfg.cover.items.map((c) => c.background.path).filter(Boolean),
    )

    Object.assign(cfg, sanitized)

    // 模板可能带来新的封面背景图，预加载它们
    const after = cfg.cover.items
      .filter((c) => c.enabled && c.background.useOwn && c.background.path)
      .map((c) => c.background.path)
    if (after.some((p) => !before.has(p))) {
      void syncCoverImages()
    }

    scheduleRebuild(0)
    return { fontFallback }
  }

  /** 截取当前配置作为模板快照，剔除输出目录但保留封面图路径。 */
  function snapshotConfig(): StyleConfig {
    const snap = sanitizeConfig(JSON.parse(JSON.stringify(cfg)), { keepLocalPaths: true })
    snap.export.dir = ''
    return snap
  }

  /** 在系统文件管理器中定位到指定路径。 */
  async function showInFolder(path: string): Promise<void> {
    if (!path) return
    try {
      await api.revealInFolder(path)
    } catch {
      // 定位失败不弹出错误，避免打断导出后的正常流程
    }
  }

  return {
    // 配置
    cfg,
    // 输入
    text,
    bgPath,
    bgName,
    bgInfo,
    bgBitmap,
    bgError,
    bgPreviewUrl,
    // 字体
    fonts,
    fontsLoading,
    fontWarning,
    // 布局
    pages,
    diag,
    geometry,
    geometryResolved,
    layoutMessage,
    layoutViolated,
    rebuilding,
    currentPage,
    totalPages,
    current,
    hasContent,
    charCount,
    estimateLabel,
    enabledCoverCount,
    primaryCoverTitle,
    renderCtx,
    // 导出
    exporting,
    exportDone,
    exportTotal,
    exportPhase,
    exportError,
    exportSuccess,
    // 环境
    py,
    appVersion,
    configDir,
    dragDropReady,
    // 动作
    init,
    rebuild,
    scheduleRebuild,
    setBackground,
    chooseBackground,
    dropBackground,
    dropTextFile,
    clearBackground,
    // 封面
    coverImages,
    coverBackgroundError,
    activeCover,
    setActiveCover,
    addCover,
    duplicateCover,
    removeCover,
    moveCover,
    toggleCover,
    pickCoverBackground,
    setCoverBackground,
    clearCoverBackground,
    importTextFile,
    applyPreset,
    markCustomSize,
    switchMaskType,
    chooseOutputDir,
    runExport,
    runExportMultiSize,
    cancelExport,
    runExportCurrent,
    // 引导元素（N-03）
    overlayImages,
    addOverlayText,
    addOverlayImage,
    removeOverlay,
    // 历史任务（N-06）
    exportHistory,
    restoreHistory,
    removeHistory,
    clearHistory,
    chooseAndImportFont,
    deleteFont,
    selectFont,
    loadFonts,
    resetConfig,
    showInFolder,
    applyTemplate,
    snapshotConfig,
  }
})
