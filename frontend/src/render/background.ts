import type { BackgroundConfig, BlendMode, CoverBackground, FillMode } from '../types'
import { toCompositeOperation } from '../types'

/**
 * 背景图绘制。
 *
 * 系列一致性的关键：同一张背景图必须**在所有页使用完全相同的目标矩形**，
 * 否则多张图拼在一起时取景会跳变，系列感立刻被破坏。因此 destRect 的
 * 计算只依赖画布尺寸、图片尺寸与固定参数，与页内容无关。
 *
 * 封面专属背景则是例外 —— 它本来就该每张不同，因此额外支持
 * 缩放、不透明度、混合模式与单色叠加层。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 计算背景图在画布上的目标矩形。
 *
 * @param scale 在适应结果之上的额外缩放倍率，1 表示不加缩放。
 *   cover 模式下小于 1 会让图片不再铺满画布 —— 这是刻意的，
 *   配合不透明度与混合模式可做出「画中画」式的封面效果。
 */
export function computeDestRect(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  mode: FillMode,
  offsetX = 0,
  offsetY = 0,
  scale = 1,
): Rect {
  if (imgW <= 0 || imgH <= 0) {
    return { x: 0, y: 0, w: canvasW, h: canvasH }
  }

  if (mode === 'stretch') {
    const w = canvasW * scale
    const h = canvasH * scale
    const slackX = (w - canvasW) / 2
    const slackY = (h - canvasH) / 2
    return {
      x: (canvasW - w) / 2 + offsetX * slackX,
      y: (canvasH - h) / 2 + offsetY * slackY,
      w,
      h,
    }
  }

  const imgAspect = imgW / imgH
  const boxAspect = canvasW / canvasH

  let fitScale: number
  if (mode === 'cover') {
    // 等比放大到完全覆盖画布，超出部分裁剪
    fitScale = imgAspect > boxAspect ? canvasH / imgH : canvasW / imgW
  } else {
    // contain：等比缩放到完整可见
    fitScale = imgAspect > boxAspect ? canvasW / imgW : canvasH / imgH
  }

  const w = imgW * fitScale * scale
  const h = imgH * fitScale * scale

  // 居中 + offset 微调取景（cover 裁剪后，主体偏一侧时用得上）
  const slackX = (w - canvasW) / 2
  const slackY = (h - canvasH) / 2

  return {
    x: (canvasW - w) / 2 + offsetX * slackX,
    y: (canvasH - h) / 2 + offsetY * slackY,
    w,
    h,
  }
}

/** 滤镜参数的通用结构，正文背景与封面背景共用同一套字段 */
export interface FilterLike {
  brightness: number
  contrast: number
  saturate: number
  blur: number
}

/** 组装 Canvas 滤镜链。无任何滤镜时返回 'none'。 */
export function buildFilter(bg: FilterLike): string {
  const parts: string[] = []
  if (bg.brightness !== 1) parts.push(`brightness(${bg.brightness})`)
  if (bg.contrast !== 1) parts.push(`contrast(${bg.contrast})`)
  if (bg.saturate !== 1) parts.push(`saturate(${bg.saturate})`)
  if (bg.blur > 0) parts.push(`blur(${bg.blur}px)`)
  return parts.length > 0 ? parts.join(' ') : 'none'
}

/**
 * 绘制封面专属背景。
 *
 * 两种路径：
 *
 *   常规 —— 三层结构（「叠加效果」就是由这三层实现的）：
 *     1. 封面图本体 —— 受 fit / scale / offset / opacity / blendMode / 滤镜控制
 *     2. 单色叠加层 —— tintColor + tintAlpha，用于统一色调或压暗
 *     3. 暗角 —— vignette
 *   调用前画布上应已铺好正文背景，blendMode 决定封面图与正文背景如何混合。
 *
 *   独立（standalone）—— 封面图**按自身原样作为底层**铺画：
 *     正文背景完全不参与，opacity 与 blendMode 失去意义（没有可混合的底层），
 *     强制不透明 + source-over；滤镜、单色叠加层与暗角仍然生效，
 *     因为它们只作用于封面图自身，不涉及与正文背景的混合。
 */
export function drawCoverBackground(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  bg: CoverBackground,
  canvasW: number,
  canvasH: number,
): Rect {
  const rect = computeDestRect(
    imgW,
    imgH,
    canvasW,
    canvasH,
    bg.fit,
    bg.offsetX,
    bg.offsetY,
    bg.scale,
  )

  const standalone = bg.blendMode === 'standalone'
  const filter = buildFilter(bg)
  const canFilter = supportsFilter(ctx)
  // 'normal' 对应 source-over，其余直接取 canvas 的混合模式取值
  const operation: GlobalCompositeOperation = toCompositeOperation(bg.blendMode)

  ctx.save()
  ctx.globalAlpha = standalone ? 1 : Math.max(0, Math.min(1, bg.opacity))
  ctx.globalCompositeOperation = operation
  if (canFilter && filter !== 'none') {
    ctx.filter = filter
  }
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h)
  ctx.restore()

  if (bg.tintAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, bg.tintAlpha))
    ctx.fillStyle = bg.tintColor
    ctx.fillRect(0, 0, canvasW, canvasH)
    ctx.restore()
  }

  if (bg.vignette > 0) {
    drawVignette(ctx, canvasW, canvasH, bg.vignette)
  }

  return rect
}

/** 检测当前内核是否支持 ctx.filter。 */
export function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof (ctx as unknown as { filter?: unknown }).filter === 'string'
}

/**
 * 绘制背景图。返回实际使用的目标矩形，供毛玻璃蒙版复用。
 *
 * 注意：ctx.filter 会作用于后续所有绘制操作，必须严格 save/restore 成对包裹，
 * 否则会污染文字绘制。
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  cfg: BackgroundConfig,
  canvasW: number,
  canvasH: number,
): Rect {
  const rect = computeDestRect(imgW, imgH, canvasW, canvasH, cfg.fillMode, cfg.offsetX, cfg.offsetY)

  const filter = buildFilter(cfg)
  const canFilter = supportsFilter(ctx)

  if (canFilter && filter !== 'none') {
    ctx.save()
    ctx.filter = filter
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h)
    ctx.restore()
  } else {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h)
  }

  return rect
}

/** 绘制暗角（从中心透明到大面积压暗）。 */
export function drawVignette(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  strength: number,
): void {
  if (strength <= 0) return

  const cx = canvasW / 2
  const cy = canvasH / 2
  const outer = Math.hypot(canvasW, canvasH) / 2

  const g = ctx.createRadialGradient(cx, cy, outer * 0.45, cx, cy, outer)
  g.addColorStop(0, 'rgba(0, 0, 0, 0)')
  g.addColorStop(1, `rgba(0, 0, 0, ${Math.min(1, strength)})`)

  ctx.save()
  ctx.fillStyle = g
  ctx.fillRect(0, 0, canvasW, canvasH)
  ctx.restore()
}

/** 在 cover 模式下把画布填满（避免图片比画布小时露出透明背景）。 */
export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
): void {
  ctx.clearRect(0, 0, canvasW, canvasH)
}
