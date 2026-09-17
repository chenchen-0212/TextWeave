import type { Page, StyleConfig } from '../types'
import * as api from '../backend/api'
import type { RenderContext } from './CanvasRenderer'
import { CanvasRenderer } from './CanvasRenderer'
import { buildFilename, extForFormat } from '../utils/filename'

/**
 * 导出器（对应决策 D-14：默认逐张落盘）。
 *
 * 内存策略（对应方案 5.9 / 风险 R-01）：
 *  - 复用同一个 canvas 实例，逐页重绘，不在内存里堆积多张位图；
 *  - 每页渲染 → 立即转 base64 → 立即交给 Go 写盘 → 进入下一页；
 *  - 每页之间让出主线程，保证导出过程中界面不假死。
 */

export interface ExportProgress {
  done: number
  total: number
  filename: string
  /** 当前阶段描述，用于界面提示 */
  phase: string
}

export interface ExportOptions {
  pages: Page[]
  rc: RenderContext
  renderer: CanvasRenderer
  onProgress?: (p: ExportProgress) => void
  /** 返回 true 时中断导出（已写出的文件保持可用） */
  shouldCancel?: () => boolean
}

export interface ExportResult {
  files: string[]
  zipPath: string
  cancelled: boolean
}

/** 让出主线程，避免长时间导出把界面卡死。 */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

/**
 * 取主封面标题，用于文件名模板的 {title} 变量。
 * 多封面场景下以第一张启用封面的标题作为整个系列的代表名。
 */
function primaryCoverTitle(cfg: StyleConfig): string {
  const first = cfg.cover.items.find((c) => c.enabled) ?? cfg.cover.items[0]
  return first?.title?.trim() ?? ''
}

/** 导出全部页面。 */
export async function exportPages(opts: ExportOptions): Promise<ExportResult> {
  const { pages, rc, renderer, onProgress, shouldCancel } = opts
  const cfg: StyleConfig = rc.cfg

  if (!cfg.export.dir) {
    throw new Error('请先选择输出目录')
  }
  if (pages.length === 0) {
    throw new Error('没有可导出的页面，请先输入文本')
  }

  const ext = extForFormat(cfg.canvas.format)
  const title = primaryCoverTitle(cfg)
  const total = pages.length

  const files: string[] = []
  const zipEntries: api.ZipEntryPayload[] = []
  const collectZip = cfg.export.alsoZip

  for (let i = 0; i < pages.length; i++) {
    if (shouldCancel?.()) {
      return { files, zipPath: '', cancelled: true }
    }

    const page = pages[i]

    // 单 canvas 复用：每次直接覆盖重绘
    renderer.renderPage(page, rc)

    const dataUrl = renderer.toDataURL(cfg.canvas.format, cfg.canvas.quality)
    const base64 = stripDataUrl(dataUrl)

    const filename = buildFilename(
      cfg.export.filenameTemplate,
      { index: i + 1, total, title, date: new Date(), pad: cfg.export.pad },
      ext,
    )

    onProgress?.({ done: i, total, filename, phase: `正在导出 ${i + 1}/${total}` })

    const full = await api.saveImage(cfg.export.dir, filename, base64)
    files.push(full)

    // 仅在需要时保留 base64，避免无谓的内存占用
    if (collectZip) {
      zipEntries.push({ name: filename, data: base64 })
    }

    onProgress?.({ done: i + 1, total, filename, phase: `已导出 ${i + 1}/${total}` })
    await yieldToUI()
  }

  let zipPath = ''
  if (collectZip && zipEntries.length > 0) {
    onProgress?.({ done: total, total, filename: '', phase: '正在打包 ZIP' })
    zipPath = await api.saveZip(cfg.export.dir, 'textweave-cards.zip', zipEntries)
  }

  return { files, zipPath, cancelled: false }
}

/** 只导出指定的一页。 */
export async function exportSinglePage(
  page: Page,
  index: number,
  total: number,
  rc: RenderContext,
  renderer: CanvasRenderer,
): Promise<string> {
  const cfg = rc.cfg
  if (!cfg.export.dir) throw new Error('请先选择输出目录')

  const ext = extForFormat(cfg.canvas.format)
  renderer.renderPage(page, rc)

  const base64 = stripDataUrl(renderer.toDataURL(cfg.canvas.format, cfg.canvas.quality))
  const filename = buildFilename(
    cfg.export.filenameTemplate,
    { index, total, title: primaryCoverTitle(cfg), date: new Date(), pad: cfg.export.pad },
    ext,
  )
  return api.saveImage(cfg.export.dir, filename, base64)
}

/** 把某一页渲染成缩略图 data URL。 */
export function renderThumbnail(
  page: Page,
  rc: RenderContext,
  renderer: CanvasRenderer,
  targetWidth: number,
): string {
  const scale = targetWidth / rc.cfg.canvas.width
  renderer.renderPage(page, rc, scale)
  // 缩略图统一用 JPEG 以便复用，质量取中高
  return renderer.toDataURL('jpeg', 0.82)
}
