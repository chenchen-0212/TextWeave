import type { OverlayItem, StyleConfig } from '../types'
import type { BackgroundSource } from './CanvasRenderer'

/**
 * 引导元素图层绘制（建议项 N-03）。
 *
 * 在正文文字之后绘制：文字条（CTA / 账号名，可带半透明底条）与图片
 * （二维码 / logo / 水印）。位置由九宫格锚点 + 边距决定，
 * 同一元素在所有页面的位置像素级一致 —— 这是手工在导出图上叠加做不到的。
 *
 * 封面页默认不绘制，仅 `onCover` 为 true 的元素例外。
 */

const ANCHOR_H = { left: 0, center: 0.5, right: 1 } as const
const ANCHOR_V = { top: 0, middle: 0.5, bottom: 1 } as const

function anchorParts(anchor: OverlayItem['anchor']): { h: 0 | 0.5 | 1; v: 0 | 0.5 | 1 } {
  const [v, h] = anchor.split('-') as [keyof typeof ANCHOR_V, keyof typeof ANCHOR_H]
  return { h: ANCHOR_H[h], v: ANCHOR_V[v] }
}

/** 计算元素左上角位置：以锚点为原点、边距内推。 */
function resolvePosition(
  anchor: OverlayItem['anchor'],
  marginX: number,
  marginY: number,
  w: number,
  h: number,
  W: number,
  H: number,
): { x: number; y: number } {
  const { h: fh, v: fv } = anchorParts(anchor)
  // 锚点在画布上的位置（含边距内推）
  const ax = marginX + fh * (W - marginX * 2)
  const ay = marginY + fv * (H - marginY * 2)
  // 元素以锚点对齐：left 对齐左边、center 对齐中线、right 对齐右边
  const x = ax - fh * w
  const y = ay - fv * h
  return {
    x: Math.max(0, Math.min(W - w, x)),
    y: Math.max(0, Math.min(H - h, y)),
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 底条内边距（相对字号的比例） */
const BAR_PAD_X = 0.6
const BAR_PAD_Y = 0.35

function drawTextItem(
  ctx: CanvasRenderingContext2D,
  item: Extract<OverlayItem, { kind: 'text' }>,
  cfg: StyleConfig,
  measure: (text: string) => number,
): void {
  const { width: W, height: H } = cfg.canvas
  const text = item.text.trim()
  if (!text) return

  ctx.save()
  ctx.font = `${item.fontWeight} ${item.fontSize}px ${cfg.text.fontFamily || 'sans-serif'}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  const textW = measure(text)
  const lineH = item.fontSize * 1.3
  const barW = textW + item.fontSize * BAR_PAD_X * 2
  const barH = lineH + item.fontSize * BAR_PAD_Y * 2
  const { x, y } = resolvePosition(item.anchor, item.marginX, item.marginY, barW, barH, W, H)

  if (item.barColor) {
    ctx.globalAlpha = item.barAlpha
    ctx.fillStyle = item.barColor
    roundRectPath(ctx, x, y, barW, barH, Math.min(12, barH / 2))
    ctx.fill()
    ctx.globalAlpha = 1
  }

  ctx.fillStyle = item.color
  ctx.fillText(text, x + item.fontSize * BAR_PAD_X, y + barH / 2)
  ctx.restore()
}

function drawImageItem(
  ctx: CanvasRenderingContext2D,
  item: Extract<OverlayItem, { kind: 'image' }>,
  cfg: StyleConfig,
  src: BackgroundSource,
): void {
  const { width: W, height: H } = cfg.canvas
  const ratio = src.width > 0 && src.height > 0 ? src.width / src.height : 1
  const h = item.height
  const w = h * ratio
  const { x, y } = resolvePosition(item.anchor, item.marginX, item.marginY, w, h, W, H)

  ctx.save()
  ctx.globalAlpha = item.opacity
  ctx.drawImage(src.image, x, y, w, h)
  ctx.restore()
}

/** 绘制某一页的全部引导元素。 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  cfg: StyleConfig,
  pageKind: 'cover' | 'content',
  overlayImages?: Map<string, BackgroundSource>,
  measureText?: (text: string) => number,
): void {
  const items = cfg.overlay?.items ?? []
  if (items.length === 0) return

  for (const item of items) {
    if (!item.enabled) continue
    if (pageKind === 'cover' && !item.onCover) continue

    if (item.kind === 'text') {
      drawTextItem(ctx, item, cfg, measureText ?? ((t) => ctx.measureText(t).width))
    } else if (overlayImages) {
      const src = overlayImages.get(item.path)
      if (src) drawImageItem(ctx, item, cfg, src)
    }
  }
}
