import type { CoverItem, CoverTextBox, Geometry, Line, MaskConfig, Page, StyleConfig } from '../types'
import { setLetterSpacing } from '../core/FontMetrics'
import { toGraphemes } from '../core/graphemes'
import { getTextOrigin } from './masks'
import { withAlpha } from '../utils/color'

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

/**
 * 绘制封面页。
 *
 * 每个文本自带蒙版（`box.mask` + `box.maskEnabled`），蒙版面板挂在**该文本图层**上
 * （`box.panel`，由 core 按文字块外扩得到），而不是整页共用封面蒙版。
 * 多个文本按 `z` 升序绘制：靠后（z 大）的文本及其蒙版盖在前面之上。
 * 坐标与换行全部来自 core 的 `coverTextBoxes`，这里只负责按盒绘制。
 */
export function drawCoverText(
  ctx: CanvasRenderingContext2D,
  page: Page,
  cfg: StyleConfig,
  item: CoverItem,
): void {
  const boxes = page.coverTextBoxes ?? []
  if (boxes.length === 0) return

  const t = cfg.text
  // 空串表示沿用正文颜色，便于只改一处就统一整体系列
  const fallbackColor = t.color

  for (const box of boxes) {
    // 该文本自己的蒙版（局部面板，挂在文本图层上）
    if (box.maskEnabled) {
      drawTextLayerMask(ctx, box, cfg)
    }

    const lineHeight = box.fontSize * 1.25
    applyFont(ctx, t.fontFamily, box.fontSize, box.fontWeight, box.color || fallbackColor, t.letterSpacing)

    // 盒内水平对齐：left/right 用实际行宽，center 用盒宽中线
    ctx.textAlign = box.align === 'left' ? 'left' : box.align === 'right' ? 'right' : 'center'
    const anchorX =
      box.align === 'left' ? box.x : box.align === 'right' ? box.x + box.w : box.x + box.w / 2

    let y = box.y
    for (const line of box.lines) {
      // 基线对齐：让视觉中心落在行盒中心
      const lineY = y + (lineHeight - box.fontSize) / 2
      ctx.fillText(line.text, anchorX, lineY)
      y += lineHeight
    }
  }
}

/**
 * 绘制单个文本的局部蒙版面板。
 * 面板区域已由 core 计算好（文字块 + mask.pad 外扩），这里只按形态填充。
 */
function drawTextLayerMask(ctx: CanvasRenderingContext2D, box: CoverTextBox, cfg: StyleConfig): void {
  const m = box.mask
  const p = box.panel
  ctx.save()
  switch (m.type) {
    case 'card': {
      const radius = Math.max(0, Math.min(m.radius, Math.min(p.w, p.h) / 2))
      ctx.beginPath()
      ctx.roundRect(p.x, p.y, p.w, p.h, radius)
      ctx.fillStyle = withAlpha(m.color, m.alpha)
      ctx.fill()
      break
    }
    case 'veil': {
      ctx.fillStyle = withAlpha(m.color, m.alpha)
      ctx.fillRect(p.x, p.y, p.w, p.h)
      break
    }
    case 'gradient': {
      // 在面板内做垂直渐变
      const dir = m.direction
      const solid = Math.max(0, Math.min(0.95, m.solidRatio))
      const transparent = Math.max(solid + 0.01, Math.min(0.99, m.transparentRatio))
      if (dir === 'bottom' || dir === 'both') {
        const ySolid = p.y + p.h - p.h * solid
        const yZero = p.y + p.h - p.h * transparent
        const g = ctx.createLinearGradient(0, yZero, 0, ySolid)
        g.addColorStop(0, withAlpha(m.color, 0))
        g.addColorStop(1, withAlpha(m.color, m.maxAlpha))
        ctx.fillStyle = g
        ctx.fillRect(p.x, yZero, p.w, p.y + p.h - yZero)
      }
      if (dir === 'top' || dir === 'both') {
        const ySolid = p.y + p.h * solid
        const yZero = p.y + p.h * transparent
        const g = ctx.createLinearGradient(0, yZero, 0, ySolid)
        g.addColorStop(0, withAlpha(m.color, 0))
        g.addColorStop(1, withAlpha(m.color, m.maxAlpha))
        ctx.fillStyle = g
        ctx.fillRect(p.x, p.y, p.w, yZero - p.y)
      }
      break
    }
  }
  ctx.restore()
  void cfg
}
