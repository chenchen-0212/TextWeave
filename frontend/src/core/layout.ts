import type {
  AppliedParams,
  Block,
  CoverItem,
  CoverTextBox,
  Diagnostics,
  Geometry,
  Line,
  MaskConfig,
  Page,
  PageDiagnostic,
  StyleConfig,
} from '../types'
import type { FontMetrics } from './FontMetrics'
import { breakIntoLines, breakRaw } from './lineBreaker'
import { measurePageHeight, paginate } from './paginator'
import { splitByLength, splitClauses, splitParagraphs, splitSentences } from './splitter'
import { solvePageConstraint } from './constraint'
import { defaultCoverTextMask } from '../types'
import { pageCanvasSize } from './pageCanvas'

/**
 * 排版编排层 —— 渲染管线第 ①~⑥ 步的实现。
 *
 * 本模块**完全不接触 canvas**，只做纯计算并产出布局树（Page[]）。
 * 这不是风格偏好，而是性能前提：目标张数约束的二分搜索会把 ③~⑤ 反复重跑
 * 约 8 次，如果其中任何一步触发绘制，性能会直接崩掉。
 */

/** 可读性下限：字号不得低于此值 */
export const MIN_FONT_SIZE = 24
export const MIN_PADDING = 24
export const MIN_MASK_PAD = 16

/** 填充率低于此值判定为「过空」 */
const SPARSE_THRESHOLD = 0.5
/** 填充率高于此值判定为「过挤」 */
const DENSE_THRESHOLD = 0.98

export interface LayoutOutput {
  pages: Page[]
  diag: Diagnostics
  geometry: Geometry
  /** 求解得到的目标字号 */
  fontSize: number
  totalPages: number
  message: string
  violated: boolean
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 计算几何参数。
 *
 * 关键性质：在默认蒙版（card + stretchToFill）下，availW / availH 与单页内容
 * 无关，对所有页都是常量；只有切到 gradient 或 card 的非铺满模式时，
 * availH 才变成参数的函数。
 */
export function computeGeometry(cfg: StyleConfig, fontSize: number, spacingFactor = 1): Geometry {
  const base = Math.max(1, cfg.text.fontSize)
  const k = fontSize / base

  const padding = Math.max(MIN_PADDING, cfg.text.padding * k)
  const maskPad = cfg.mask.type === 'card' ? Math.max(MIN_MASK_PAD, cfg.mask.pad * k) : 0

  const W = cfg.canvas.width
  const H = cfg.canvas.height

  let availW: number
  let availH: number

  switch (cfg.mask.type) {
    case 'card':
      availW = W - padding * 2 - maskPad * 2
      availH = H - padding * 2 - maskPad * 2
      break

    case 'veil':
      availW = W - padding * 2
      availH = H - padding * 2
      break

    case 'gradient':
    default: {
      availW = W - padding * 2
      if (cfg.mask.type === 'gradient' && cfg.mask.direction !== 'both') {
        // 只有从 transparentRatio 之下才是被遮罩覆盖的区域，文字必须落在这一段里。
        // 这是本项目与「画布高度是常量」的卡片类工具最本质的算法差异：
        // 可用高度是参数的函数，改这个比例会直接触发重新分页。
        const ratio = clamp(cfg.mask.transparentRatio, 0.05, 0.95)
        availH = H * (1 - ratio) - padding * 2
      } else {
        availH = H - padding * 2
      }
      break
    }
  }

  const lineHeight = fontSize * cfg.text.lineHeightRatio
  const paragraphSpacing = fontSize * cfg.text.paragraphSpacingRatio * spacingFactor

  // 保底：可用区至少能放下两行，否则排版无法进行
  availH = Math.max(lineHeight * 2, availH)
  availW = Math.max(fontSize * 2, availW)

  return { fontSize, padding, maskPad, availW, availH, lineHeight, paragraphSpacing }
}

/** 把一组行区间合并成尽量大的、不超过单页可用高度的块。 */
function mergeToBlocks(parts: Line[][], geo: Geometry, paraIndex: number): Block[] {
  const out: Block[] = []
  let cur: Line[] = []
  let curH = 0

  const flush = (isEnd: boolean) => {
    if (cur.length === 0) return
    out.push({
      type: 'paragraph',
      lines: cur,
      paraIndex,
      isPartial: isEnd === false || out.length > 0,
      isParaStart: out.length === 0,
      isParaEnd: isEnd,
    })
    cur = []
    curH = 0
  }

  for (const part of parts) {
    const h = part.length * geo.lineHeight
    if (cur.length > 0 && curH + h > geo.availH) {
      flush(false)
    }
    cur.push(...part)
    curH += h
  }
  flush(true)

  return out
}

/**
 * 把一个段落拆成若干「不超过单页可用高度」的行区间。
 * 逐级降级：整段 → 句子 → 分句 → 按字素硬切。
 */
function splitParagraphToFit(
  para: string,
  metrics: FontMetrics,
  geo: Geometry,
): { parts: Line[][]; fixes: number } {
  const whole = breakIntoLines(para, metrics, { maxWidth: geo.availW })
  if (whole.lines.length * geo.lineHeight <= geo.availH) {
    return { parts: [whole.lines], fixes: whole.fixes }
  }

  let fixes = whole.fixes

  // 二级：按句末标点
  const sentences = splitSentences(para)
  if (sentences.length > 1) {
    const parts: Line[][] = []
    let ok = true
    for (const s of sentences) {
      const r = breakIntoLines(s, metrics, { maxWidth: geo.availW })
      fixes += r.fixes
      if (r.lines.length * geo.lineHeight > geo.availH) {
        ok = false
        break
      }
      parts.push(r.lines)
    }
    if (ok && parts.length > 0) return { parts, fixes }
  }

  // 三级：按逗号顿号
  const clauses = splitClauses(para)
  if (clauses.length > 1) {
    const parts: Line[][] = []
    let ok = true
    for (const c of clauses) {
      const r = breakIntoLines(c, metrics, { maxWidth: geo.availW })
      fixes += r.fixes
      if (r.lines.length * geo.lineHeight > geo.availH) {
        ok = false
        break
      }
      parts.push(r.lines)
    }
    if (ok && parts.length > 0) return { parts, fixes }
  }

  // 兜底：按字素硬切，保证任何输入都能落到单页以内
  const linesPerPage = Math.max(1, Math.floor(geo.availH / geo.lineHeight))
  const charsPerLine = Math.max(1, Math.floor(geo.availW / Math.max(1, geo.fontSize)))
  const maxChars = Math.max(1, Math.floor(linesPerPage * charsPerLine * 0.9))

  const chunks = splitByLength(para, maxChars)
  const parts: Line[][] = []
  for (const c of chunks) {
    const r = breakIntoLines(c, metrics, { maxWidth: geo.availW })
    fixes += r.fixes
    parts.push(r.lines)
  }
  return { parts, fixes }
}

/** 构建全部正文块。 */
export function buildContentBlocks(
  text: string,
  metrics: FontMetrics,
  geo: Geometry,
): { blocks: Block[]; fixes: number } {
  const paras = splitParagraphs(text)
  const blocks: Block[] = []
  let fixes = 0

  for (let i = 0; i < paras.length; i++) {
    const { parts, fixes: f } = splitParagraphToFit(paras[i], metrics, geo)
    fixes += f
    blocks.push(...mergeToBlocks(parts, geo, i))
  }

  return { blocks, fixes }
}

/**
 * 计算一张封面上全部文本元素的排版结果。
 *
 * **这是封面文本的唯一测量源**：渲染、拖拽命中框、吸附参考线都消费这里的
 * `CoverTextBox[]`。拖拽层绝不允许自己再 measureText 算一套 —— 那正是
 * D-15「可拖动文本框」当年回滚的原因。
 *
 * 坐标语义：
 *  - 元素 `placed=false` → 锚点由 `cover.layout`（居中/靠上/靠下）决定；
 *  - 元素 `placed=true`  → 锚点取归一化坐标，与画布尺寸解耦；
 *  - 包围盒一律钳制到画布内，防止脏数据把文字画到画布外。
 */
export function layoutCoverTextBoxes(
  cfg: StyleConfig,
  item: CoverItem,
  metrics: FontMetrics,
): CoverTextBox[] {
  // 封面尺寸与正文解耦：这里取的是「封面画布」，不是正文画布
  const { width: W, height: H } = pageCanvasSize(cfg, 'cover')
  const mask: MaskConfig = item.useOwnMask ? item.mask : cfg.mask
  const maskPad = mask.type === 'card' ? mask.pad : 0
  const safe = cfg.text.padding + maskPad

  // 自动版式的纵向锚点（归一化）
  const autoY = item.layout === 'top' ? safe / H : item.layout === 'bottom' ? 1 - safe / H : 0.5

  const boxes: CoverTextBox[] = []

  for (const el of item.texts) {
    const text = el.text.trim()
    if (!text || !el.enabled) continue

    const maxWidth = Math.max(el.fontSize * 2, W * clamp(el.widthRatio, 0.2, 1))
    metrics.setFont(cfg.text.fontFamily, el.fontSize, el.fontWeight, cfg.text.letterSpacing)
    const lines = breakRaw(text, metrics, maxWidth).filter((l) => l.text.length > 0)
    if (lines.length === 0) continue

    const lineHeight = el.fontSize * 1.25
    const w = Math.min(maxWidth, Math.max(...lines.map((l) => l.width)))
    const h = lines.length * lineHeight

    // 锚点 → 左上角
    const anchorX = el.placed ? clamp(el.x, 0, 1) * W : W / 2
    const anchorY = el.placed ? clamp(el.y, 0, 1) * H : autoY * H

    let bx = el.align === 'left' ? anchorX : el.align === 'right' ? anchorX - w : anchorX - w / 2
    let by = anchorY - h / 2

    // 越界钳制：包围盒必须完整落在画布内
    bx = clamp(bx, 0, Math.max(0, W - w))
    by = clamp(by, 0, Math.max(0, H - h))

    // 文本自带蒙版：面板 = 文字块按自身 mask.pad 外扩（card 形态）
    // veil / gradient 形态覆盖整块；未启用时面板退化为文字块本身
    const textMask = el.mask ?? defaultCoverTextMask()
    const pad = el.maskEnabled && textMask.type === 'card' ? Math.max(0, textMask.pad) : 0
    const panel = {
      x: bx - pad,
      y: by - pad,
      w: w + pad * 2,
      h: h + pad * 2,
    }
    // 面板同样钳制在画布内，避免蒙版溢出
    panel.x = clamp(panel.x, 0, Math.max(0, W - panel.w))
    panel.y = clamp(panel.y, 0, Math.max(0, H - panel.h))

    boxes.push({
      elementId: el.id,
      lines,
      x: bx,
      y: by,
      w,
      h,
      fontSize: el.fontSize,
      fontWeight: el.fontWeight,
      color: el.color,
      align: el.align,
      mask: textMask,
      maskEnabled: el.maskEnabled,
      z: Number.isFinite(el.z) ? el.z : 0,
      panel,
      overlapped: false,
    })
  }

  // 按 z 升序渲染：数值大的后绘制（盖在上面）；同 z 保持数组顺序（稳定）
  boxes.sort((a, b) => a.z - b.z)
  markOverlaps(boxes)
  return boxes
}

/** 两两相交检测，给出重叠标记（仅提示，不阻断渲染）。 */
function markOverlaps(boxes: CoverTextBox[]): void {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        a.overlapped = true
        b.overlapped = true
      }
    }
  }
}

/** 构建单张封面页。 */
function buildOneCoverPage(cfg: StyleConfig, item: CoverItem, metrics: FontMetrics): Page {
  const coverTextBoxes = layoutCoverTextBoxes(cfg, item, metrics)
  return {
    index: 0,
    kind: 'cover',
    coverId: item.id,
    blocks: [],
    coverTextBoxes,
    usedHeight: coverTextBoxes.reduce((sum, b) => sum + b.h, 0),
  }
}

/**
 * 构建全部封面页，顺序与封面列表一致。
 *
 * 只有 `enabled` 的封面才会产出页面；封面页数会一并计入目标张数约束的总张数
 * （对应小红书等平台「封面也算一张」的实际情况）。
 */
export function buildCoverPages(cfg: StyleConfig, metrics: FontMetrics): Page[] {
  const out: Page[] = []
  for (const item of cfg.cover.items) {
    if (!item.enabled) continue
    out.push(buildOneCoverPage(cfg, item, metrics))
  }
  return out
}

/** 单次布局（不含张数约束），返回正文页与诊断素材。 */
function layoutOnce(
  text: string,
  cfg: StyleConfig,
  metrics: FontMetrics,
  fontSize: number,
  spacingFactor: number,
): { contentPages: Block[][]; geo: Geometry; fixes: number; splitParagraphs: number; overflow: boolean } {
  const geo = computeGeometry(cfg, fontSize, spacingFactor)
  metrics.setFont(cfg.text.fontFamily, geo.fontSize, cfg.text.fontWeight, cfg.text.letterSpacing)

  const { blocks, fixes } = buildContentBlocks(text, metrics, geo)
  const result = paginate(blocks, {
    availHeight: geo.availH,
    lineHeight: geo.lineHeight,
    paragraphSpacing: geo.paragraphSpacing,
    minOrphanLines: cfg.text.minOrphanLines,
  })

  return {
    contentPages: result.pages,
    geo,
    fixes,
    splitParagraphs: result.splitParagraphs,
    overflow: result.overflow,
  }
}

/**
 * 完整排版入口：应用目标张数约束并产出最终布局树。
 *
 * 封面页计入总张数（对应小红书等平台「封面也算一张」的实际情况）。
 */
export function buildLayout(text: string, cfg: StyleConfig, metrics: FontMetrics): LayoutOutput {
  const started = performance.now()

  const normalized = text.trim()

  // 封面页与字号无关，先算一次即可；封面数要计入张数约束的总张数
  const coverPages = buildCoverPages(cfg, metrics)
  const coverCount = coverPages.length

  if (!normalized) {
    const geo = computeGeometry(cfg, cfg.text.fontSize, 1)
    return {
      pages: [],
      diag: emptyDiagnostics(geo, performance.now() - started),
      geometry: geo,
      fontSize: cfg.text.fontSize,
      totalPages: 0,
      message: '',
      violated: false,
    }
  }

  // 复用同一个 metrics 实例，缓存按字号分层，二分搜索期间不会互相污染
  const outcome = solvePageConstraint(
    {
      enable: cfg.constraint.enable,
      minPages: cfg.constraint.minPages,
      maxPages: cfg.constraint.maxPages,
      userFontSize: cfg.text.fontSize,
      minFontSize: MIN_FONT_SIZE,
    },
    (fs, factor) => {
      const r = layoutOnce(normalized, cfg, metrics, fs, factor)
      return { value: r, totalPages: coverCount + r.contentPages.length }
    },
  )

  const r = outcome.value
  const geo = computeGeometry(cfg, outcome.fontSize, outcome.tightenedSpacing ? 0.6 : 1)

  // 组装最终页序：多张封面按列表顺序排在正文之前
  const pages: Page[] = []
  let idx = 0

  for (const cover of coverPages) {
    cover.index = idx++
    pages.push(cover)
  }

  for (const blocks of r.contentPages) {
    pages.push({
      index: idx++,
      kind: 'content',
      blocks,
      usedHeight: measurePageHeight(blocks, r.geo.lineHeight, r.geo.paragraphSpacing),
    })
  }

  const diag = buildDiagnostics(pages, r.geo, {
    splitParagraphs: r.splitParagraphs,
    fixes: r.fixes,
    violated: outcome.violated,
    tightenedSpacing: outcome.tightenedSpacing,
    fontSize: outcome.fontSize,
    elapsedMs: performance.now() - started,
  })

  return {
    pages,
    diag,
    geometry: r.geo,
    fontSize: outcome.fontSize,
    totalPages: pages.length,
    message: outcome.message,
    violated: outcome.violated,
  }
}

function emptyDiagnostics(geo: Geometry, elapsedMs: number): Diagnostics {
  return {
    totalPages: 0,
    pages: [],
    splitParagraphs: 0,
    prohibitionFixes: 0,
    constraintViolated: false,
    applied: {
      fontSize: geo.fontSize,
      padding: geo.padding,
      maskPad: geo.maskPad,
      lineHeightRatio: 0,
      paragraphSpacingRatio: 0,
      tightenedSpacing: false,
    },
    elapsedMs,
  }
}

function buildDiagnostics(
  pages: Page[],
  geo: Geometry,
  extra: {
    splitParagraphs: number
    fixes: number
    violated: boolean
    tightenedSpacing: boolean
    fontSize: number
    elapsedMs: number
  },
): Diagnostics {
  const list: PageDiagnostic[] = pages.map((p) => {
    const used = p.kind === 'cover' ? p.usedHeight : p.usedHeight
    const rate = geo.availH > 0 ? used / geo.availH : 0
    let status: PageDiagnostic['status'] = 'normal'
    if (rate > 1) status = 'overflow'
    else if (rate > DENSE_THRESHOLD) status = 'dense'
    else if (rate < SPARSE_THRESHOLD) status = 'sparse'

    return {
      index: p.index,
      fillRate: rate,
      status,
      usedHeight: used,
      availHeight: geo.availH,
    }
  })

  const applied: AppliedParams = {
    fontSize: extra.fontSize,
    padding: geo.padding,
    maskPad: geo.maskPad,
    lineHeightRatio: geo.fontSize > 0 ? geo.lineHeight / geo.fontSize : 0,
    paragraphSpacingRatio: geo.fontSize > 0 ? geo.paragraphSpacing / geo.fontSize : 0,
    tightenedSpacing: extra.tightenedSpacing,
  }

  return {
    totalPages: pages.length,
    pages: list,
    splitParagraphs: extra.splitParagraphs,
    prohibitionFixes: extra.fixes,
    constraintViolated: extra.violated,
    applied,
    elapsedMs: extra.elapsedMs,
  }
}
