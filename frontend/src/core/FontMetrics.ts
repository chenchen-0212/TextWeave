import { toGraphemes } from './graphemes'

/**
 * 字体度量与字形宽度缓存。
 *
 * 关键设计（对应产品方案 5.4 / 6.2）：
 *  - 缓存按「字体族 + 字重 + 字号 + 字间距」分层。**字号必须参与缓存键** ——
 *    目标张数约束会在二分搜索中反复改变字号，若缓存键不含字号，
 *    第二轮迭代就会读到上一轮的宽度，算出的页数是错的。
 *  - 使用 ctx.letterSpacing 而非逐字累加偏移，使 measureText 的度量与
 *    实际绘制完全一致。
 */

/** 最多保留多少组字体会话的缓存（二分搜索约需 8~12 组，留出余量） */
const MAX_FONT_CACHES = 24

/** 给字体族名加引号，避免含空格或中文的族名被 CSS 解析器截断。 */
function quoteFamily(family: string): string {
  const f = (family || '').trim()
  if (!f) return 'sans-serif'
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(f)) return f
  return `"${f.replace(/["\\]/g, '')}"`
}

/** 设置字间距。旧内核不支持时静默跳过（渲染会退化为无字间距）。 */
export function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  const c = ctx as unknown as { letterSpacing?: string }
  if ('letterSpacing' in c) {
    c.letterSpacing = `${px}px`
  }
}

export class FontMetrics {
  private ctx: CanvasRenderingContext2D
  private currentKey = ''
  private caches = new Map<string, Map<string, number>>()
  private active: Map<string, number> | null = null

  /** 实际调用 measureText 的次数，用于性能诊断 */
  measureCalls = 0

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx
  }

  /** 切换度量上下文。参数与最终绘制必须完全一致，否则排版会错位。 */
  setFont(family: string, size: number, weight: number, letterSpacing = 0): void {
    const key = `${weight}|${size}|${quoteFamily(family)}|${letterSpacing}`
    if (key === this.currentKey && this.active) return

    this.currentKey = key
    this.ctx.font = `${weight} ${size}px ${quoteFamily(family)}`
    setLetterSpacing(this.ctx, letterSpacing)

    let bucket = this.caches.get(key)
    if (!bucket) {
      bucket = new Map<string, number>()
      // 简单的 FIFO 淘汰，保证二分搜索反复换字号时缓存不会无限增长
      if (this.caches.size >= MAX_FONT_CACHES) {
        const oldest = this.caches.keys().next()
        if (!oldest.done) this.caches.delete(oldest.value)
      }
      this.caches.set(key, bucket)
    }
    this.active = bucket
  }

  get fontKey(): string {
    return this.currentKey
  }

  /** 单个字素的渲染宽度。 */
  widthOf(grapheme: string): number {
    if (!this.active) {
      throw new Error('FontMetrics: 调用 widthOf 前必须先 setFont')
    }
    let w = this.active.get(grapheme)
    if (w === undefined) {
      w = this.ctx.measureText(grapheme).width
      this.measureCalls++
      this.active.set(grapheme, w)
    }
    return w
  }

  /** 一段文本的渲染宽度的精确值（受 ctx.letterSpacing 影响）。 */
  widthOfText(text: string): number {
    if (!text) return 0
    // 整段测量比逐字累加更精确：能正确处理连字与字间距
    const w = this.ctx.measureText(text).width
    this.measureCalls++
    return w
  }

  /** 逐字素累加宽度，用于断行时判断是否超宽。 */
  advanceWidth(grapheme: string): number {
    return this.widthOf(grapheme)
  }

  /** 清空全部缓存（字体实际加载完成后需要调用，因为加载前的度量是回退字体的）。 */
  reset(): void {
    this.caches.clear()
    this.active = null
    this.currentKey = ''
  }

  /** 组合文本用的字素数量。 */
  static count(text: string): number {
    return toGraphemes(text).length
  }
}
