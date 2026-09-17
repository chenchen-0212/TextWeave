import type { CoverItem, Geometry, Line, MaskConfig, Page, StyleConfig } from '../types'
import { setLetterSpacing } from '../core/FontMetrics'
import { toGraphemes } from '../core/graphemes'
import { getTextOrigin } from './masks'

/**
 * 文字绘制。
 *
 * 排版计算（换行位置、行宽）在 core 层已完成，这里只负责把布局树画出来。
 * 唯一需要在此处动态处理的是两端对齐：它依赖逐行的实际剩余空间，
 * 通过临时调整 ctx.letterSpacing 实现，因此不会影响断行结果。
 */

/** 两端对齐时允许的最大拉伸量（相对字号），超过则放弃对齐，避免字距夸张 */
const MAX_JUSTIFY_STRETCH = 2.5

export interface TextBox {
  x: number
  y: number
  width: number
}

function applyFont(
  ctx: CanvasRenderingContext2D,
  family: string,
  size: number,
  weight: number,
  color: string,
  letterSpacing: number,
): void {
  ctx.font = `${weight} ${size}px ${quote(family)}`
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  setLetterSpacing(ctx, letterSpacing)
}

function quote(family: string): string {
  const f = (family || '').trim()
  if (!f) return 'sans-serif'
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(f)) return f
  return `"${f.replace(/["\\]/g, '')}"`
}

/** 画一行；align 为 justify 时按目标宽度拉伸字间距。 */
function paintLine(
  ctx: CanvasRenderingContext2D,
  line: Line,
  x: number,
  y: number,
  boxWidth: number,
  fontSize: number,
  align: StyleConfig['text']['textAlign'],
  baseSpacing: number,
  stretch: boolean,
): void {
  if (!line.text) return

  const drawX = align === 'center' ? x + boxWidth / 2 : x
  ctx.textAlign = align === 'center' ? 'center' : 'left'

  if (align === 'justify' && stretch) {
    const count = toGraphemes(line.text).length
    const extra = boxWidth - line.width
    const perGap = count > 0 ? extra / count : 0

    if (extra > 0.5 && perGap <= MAX_JUSTIFY_STRETCH) {
      setLetterSpacing(ctx, baseSpacing + perGap)
      ctx.fillText(line.text, x, y)
      setLetterSpacing(ctx, baseSpacing)
      return
    }
  }

  ctx.fillText(line.text, drawX, y)
}

/**
 * 绘制正文页的全部文字。
 * 返回实际绘制完成后的 y 坐标，供调用方计算内容高度。
 */
export function drawContentText(
  ctx: CanvasRenderingContext2D,
  page: Page,
  cfg: StyleConfig,
  geo: Geometry,
): number {
  const mask: MaskConfig = cfg.mask
  const origin = getTextOrigin(cfg, mask, geo)
  const { fontSize, lineHeight, paragraphSpacing, availW } = geo
  const t = cfg.text
  const indentPx = t.textIndent > 0 ? t.textIndent * fontSize : 0

  applyFont(ctx, t.fontFamily, fontSize, t.fontWeight, t.color, t.letterSpacing)

  let y = origin.y

  for (let bi = 0; bi < page.blocks.length; bi++) {
    const block = page.blocks[bi]
    if (bi > 0) y += paragraphSpacing

    for (let li = 0; li < block.lines.length; li++) {
      const line = block.lines[li]
      const isFirstLineOfPara = li === 0 && block.isParaStart
      const isLastLineOfBlock = li === block.lines.length - 1

      // 首行缩进只作用在段落的真正首行上
      const x = origin.x + (isFirstLineOfPara ? indentPx : 0)
      const boxWidth = Math.max(1, availW - (isFirstLineOfPara ? indentPx : 0))

      // 段落的最后一行不参与两端对齐（否则最后一行会被拉满，非常难看）
      const stretch = !(isLastLineOfBlock && block.isParaEnd)

      paintLine(ctx, line, x, y, boxWidth, fontSize, t.textAlign, t.letterSpacing, stretch)
      y += lineHeight
    }
  }

  return y
}

/** 绘制封面页。样式全部来自该封面自身的配置。 */
export function drawCoverText(
  ctx: CanvasRenderingContext2D,
  page: Page,
  cfg: StyleConfig,
  item: CoverItem,
): void {
  const t = cfg.text

  const mask: MaskConfig = item.useOwnMask ? item.mask : cfg.mask
  const maskPad = mask.type === 'card' ? mask.pad : 0
  const pad = t.padding + maskPad

  const boxX = pad
  const boxW = Math.max(1, cfg.canvas.width - pad * 2)

  const titleLines = page.titleLines ?? []
  const subtitleLines = page.subtitleLines ?? []

  // 空串表示沿用正文颜色，便于只改一处就统一整体系列
  const textColor = item.color || t.color
  const titleSize = item.titleFontSize
  const titleLineHeight = titleSize * 1.25
  const subSize = Math.max(16, Math.round(titleSize * 0.42))
  const subWeight = item.titleWeight >= 700 ? 400 : 300
  const subLineHeight = subSize * 1.6
  const gap = titleLines.length > 0 && subtitleLines.length > 0 ? titleSize * 0.5 : 0

  const blockHeight =
    titleLines.length * titleLineHeight + gap + subtitleLines.length * subLineHeight

  // 整体块的纵向位置
  let startY = (cfg.canvas.height - blockHeight) / 2
  if (item.layout === 'top') {
    startY = pad
  } else if (item.layout === 'bottom') {
    startY = cfg.canvas.height - pad - blockHeight
  }

  let y = startY

  if (titleLines.length > 0) {
    applyFont(ctx, t.fontFamily, titleSize, item.titleWeight, textColor, t.letterSpacing)
    for (const line of titleLines) {
      const lineY = y + (titleLineHeight - titleSize) / 2
      ctx.textAlign = 'center'
      ctx.fillText(line.text, boxX + boxW / 2, lineY)
      y += titleLineHeight
    }
  }

  if (subtitleLines.length > 0) {
    y += gap
    applyFont(ctx, t.fontFamily, subSize, subWeight, textColor, t.letterSpacing)
    // 副标题略透明，形成层次
    ctx.globalAlpha = 0.82
    for (const line of subtitleLines) {
      const lineY = y + (subLineHeight - subSize) / 2
      ctx.textAlign = 'center'
      ctx.fillText(line.text, boxX + boxW / 2, lineY)
      y += subLineHeight
    }
    ctx.globalAlpha = 1
  }
}
