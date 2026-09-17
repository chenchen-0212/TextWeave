import type { CardMask, Geometry, GradientMask, MaskConfig, StyleConfig, VeilMask } from '../types'
import { withAlpha } from '../utils/color'
import type { Rect } from './background'

/**
 * 蒙版三形态绘制（对应决策 D-04：三种全部实现可切换）。
 *
 * 三种形态对「可用文字区」的影响不同，这是本项目与卡片类工具最本质的差异：
 *
 *   card     可用区 = 画布 − padding×2 − maskPad×2，**每页恒定**
 *   veil     可用区 = 画布 − padding×2，**每页恒定**
 *   gradient 可用区 = 画布 ×(1−transparentRatio) − padding×2，随参数变化
 *
 * 默认形态为 card + stretchToFill（决策 D-11）：卡片区域每页完全一致，
 * 系列视觉一致性最强，且可用区是常量，分页算法最稳。
 */

// ---------------------------------------------------------------- 离屏画布复用

let scratch: HTMLCanvasElement | null = null

/** 复用一个离屏 canvas 做毛玻璃处理，避免每次新建造成的内存抖动。 */
function getScratch(w: number, h: number): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  return scratch
}

// ---------------------------------------------------------------- 圆角路径

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()

  const anyCtx = ctx as unknown as {
    roundRect?: (x: number, y: number, w: number, h: number, r: number) => void
  }
  if (typeof anyCtx.roundRect === 'function') {
    anyCtx.roundRect(x, y, w, h, radius)
    return
  }

  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

// ---------------------------------------------------------------- 卡片区域

/**
 * 计算卡片矩形。
 *
 * stretchToFill（默认）下卡片恒等于 padded 区域，与内容多少无关 ——
 * 这是保证系列一致性的关键。其余三种定位方式卡片高度随内容变化，
 * 会牺牲一致性，因此不作为默认。
 */
export function getCardRegion(cfg: StyleConfig, mask: CardMask, geo: Geometry, contentHeight: number): Rect {
  const pad = cfg.text.padding
  const maxW = Math.max(1, cfg.canvas.width - pad * 2)
  const maxH = Math.max(1, cfg.canvas.height - pad * 2)

  if (mask.position === 'stretchToFill') {
    return { x: pad, y: pad, w: maxW, h: maxH }
  }

  const minH = geo.lineHeight + mask.pad * 2
  const h = Math.min(maxH, Math.max(minH, contentHeight + mask.pad * 2))

  let y = pad
  if (mask.position === 'center') {
    y = (cfg.canvas.height - h) / 2
  } else if (mask.position === 'bottom') {
    y = cfg.canvas.height - pad - h
  }

  return { x: pad, y, w: maxW, h }
}

/** 文字起点：卡片内缩 maskPad（非 card 形态只内缩 padding）。 */
export function getTextOrigin(cfg: StyleConfig, mask: MaskConfig, geo: Geometry): { x: number; y: number } {
  if (mask.type === 'card') {
    return { x: cfg.text.padding + mask.pad, y: cfg.text.padding + mask.pad }
  }
  return { x: cfg.text.padding, y: cfg.text.padding }
}

// ---------------------------------------------------------------- 三种形态

function drawCardMask(
  ctx: CanvasRenderingContext2D,
  cfg: StyleConfig,
  mask: CardMask,
  geo: Geometry,
  contentHeight: number,
  bgImage?: CanvasImageSource,
  bgRect?: Rect,
): void {
  const region = getCardRegion(cfg, mask, geo, contentHeight)
  const { x, y, w, h } = region

  // 毛玻璃：把背景图对应区域重绘到离屏 canvas 并加模糊，再裁剪回圆角路径贴回
  if (mask.blur > 0 && bgImage && bgRect) {
    const sw = Math.max(1, Math.round(w))
    const sh = Math.max(1, Math.round(h))
    const off = getScratch(sw, sh)
    const octx = off.getContext('2d')

    if (octx) {
      octx.setTransform(1, 0, 0, 1, 0, 0)
      octx.clearRect(0, 0, sw, sh)
      octx.filter = `blur(${mask.blur}px)`
      // 把画布坐标系平移到卡片左上角，使背景图在卡片内的相对位置保持不变
      octx.drawImage(bgImage, bgRect.x - x, bgRect.y - y, bgRect.w, bgRect.h)
      octx.filter = 'none'

      ctx.save()
      roundRectPath(ctx, x, y, w, h, mask.radius)
      ctx.clip()
      ctx.drawImage(off, x, y)
      ctx.restore()
    }
  }

  ctx.save()
  roundRectPath(ctx, x, y, w, h, mask.radius)
  ctx.fillStyle = withAlpha(mask.color, mask.alpha)
  ctx.fill()
  ctx.restore()
}

function drawVeilMask(
  ctx: CanvasRenderingContext2D,
  cfg: StyleConfig,
  mask: VeilMask,
): void {
  const W = cfg.canvas.width
  const H = cfg.canvas.height

  ctx.save()
  ctx.fillStyle = withAlpha(mask.color, mask.alpha)
  ctx.fillRect(0, 0, W, H)

  if (mask.topBoost > 0) {
    const band = H * 0.4
    const g = ctx.createLinearGradient(0, 0, 0, band)
    g.addColorStop(0, withAlpha(mask.color, mask.topBoost))
    g.addColorStop(1, withAlpha(mask.color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, band)
  }

  if (mask.bottomBoost > 0) {
    const band = H * 0.4
    const g = ctx.createLinearGradient(0, H, 0, H - band)
    g.addColorStop(0, withAlpha(mask.color, mask.bottomBoost))
    g.addColorStop(1, withAlpha(mask.color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, H - band, W, band)
  }

  ctx.restore()
}

function drawGradientMask(
  ctx: CanvasRenderingContext2D,
  cfg: StyleConfig,
  mask: GradientMask,
): void {
  const W = cfg.canvas.width
  const H = cfg.canvas.height

  const solid = Math.max(0, Math.min(0.95, mask.solidRatio))
  const transparent = Math.max(solid + 0.01, Math.min(0.99, mask.transparentRatio))

  ctx.save()

  if (mask.direction === 'bottom' || mask.direction === 'both') {
    // 锚定底边：距底 solidRatio 处达到 maxAlpha，距底 transparentRatio 处归零
    const ySolid = H - H * solid
    const yZero = H - H * transparent
    const g = ctx.createLinearGradient(0, yZero, 0, ySolid)
    g.addColorStop(0, withAlpha(mask.color, 0))
    g.addColorStop(1, withAlpha(mask.color, mask.maxAlpha))
    ctx.fillStyle = g
    ctx.fillRect(0, yZero, W, H - yZero)
  }

  if (mask.direction === 'top' || mask.direction === 'both') {
    const ySolid = H * solid
    const yZero = H * transparent
    const g = ctx.createLinearGradient(0, yZero, 0, ySolid)
    g.addColorStop(0, withAlpha(mask.color, 0))
    g.addColorStop(1, withAlpha(mask.color, mask.maxAlpha))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, yZero)
  }

  ctx.restore()
}

/** 统一的蒙版绘制入口。 */
export function drawMask(
  ctx: CanvasRenderingContext2D,
  cfg: StyleConfig,
  mask: MaskConfig,
  geo: Geometry,
  contentHeight: number,
  bgImage?: CanvasImageSource,
  bgRect?: Rect,
): void {
  switch (mask.type) {
    case 'card':
      drawCardMask(ctx, cfg, mask, geo, contentHeight, bgImage, bgRect)
      break
    case 'veil':
      drawVeilMask(ctx, cfg, mask)
      break
    case 'gradient':
      drawGradientMask(ctx, cfg, mask)
      break
  }
}
