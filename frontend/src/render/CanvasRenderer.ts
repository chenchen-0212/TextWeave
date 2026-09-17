import type { CoverItem, Geometry, Page, StyleConfig } from '../types'
import { FontMetrics } from '../core/FontMetrics'
import {
  drawBackground,
  drawCoverBackground,
  drawVignette,
  type Rect,
} from './background'
import { drawMask } from './masks'
import { drawContentText, drawCoverText } from './textPainter'

/**
 * Canvas 合成器（渲染管线第 ⑦ 步）。
 *
 * 只在最后一步真正绘制。单 canvas 复用 + 逐页重绘（对应方案 5.9 的内存策略）：
 * 不在内存里堆积多张位图，导出完一页立即释放。
 */

export interface BackgroundSource {
  image: CanvasImageSource
  width: number
  height: number
}

export interface RenderContext {
  cfg: StyleConfig
  geo: Geometry
  /** 正文背景图（所有页共用的底） */
  background: BackgroundSource | null
  /** 封面专属背景图缓存，key 为文件绝对路径 */
  coverImages?: Map<string, BackgroundSource>
}

export class CanvasRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private metrics: FontMetrics
  private lastBgRect: Rect | undefined

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法获取 Canvas 2D 上下文')
    this.ctx = ctx
    this.metrics = new FontMetrics(ctx)
  }

  get fontMetrics(): FontMetrics {
    return this.metrics
  }

  /** 按 page.coverId 找到对应的封面配置；找不到时回退到第一张。 */
  private resolveCover(page: Page, cfg: StyleConfig): CoverItem | null {
    if (page.kind !== 'cover') return null
    const items = cfg.cover.items
    if (items.length === 0) return null
    if (page.coverId) {
      const hit = items.find((it) => it.id === page.coverId)
      if (hit) return hit
    }
    return items[0]
  }

  /**
   * 渲染一页。
   *
   * @param pixelScale 像素倍率；缩略图会传一个小于 1 的值，
   *                   所有绘制仍用逻辑坐标，由 transform 统一缩放。
   */
  renderPage(page: Page, rc: RenderContext, pixelScale?: number): void {
    const { cfg, geo, background } = rc
    const scale = pixelScale ?? cfg.canvas.scale
    const logicalW = cfg.canvas.width
    const logicalH = cfg.canvas.height
    const pixelW = Math.max(1, Math.round(logicalW * scale))
    const pixelH = Math.max(1, Math.round(logicalH * scale))

    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW
      this.canvas.height = pixelH
    }

    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pixelW, pixelH)

    // 统一到逻辑坐标系，后续所有绘制都按设计稿尺寸来写
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const cover = this.resolveCover(page, cfg)

    // 1) + 2) 背景层。
    //
    // 独立模式（standalone）：封面图按自身原样铺画，正文背景完全不参与合成 ——
    // 连正文暗角也不画，否则等于变相叠加了正文背景的处理结果。
    // 此时封面图就是"可见的背景"，毛玻璃蒙版也应从它取样。
    // 正文背景为空或封面图尚未加载时，铺中性底色兜底，封面照常显示。
    this.lastBgRect = undefined
    let maskImage: CanvasImageSource | undefined

    const coverBg = cover?.background
    const standaloneSrc =
      cover && coverBg?.useOwn && coverBg.blendMode === 'standalone'
        ? rc.coverImages?.get(coverBg.path)
        : undefined

    if (standaloneSrc && cover) {
      ctx.fillStyle = '#2b2f36'
      ctx.fillRect(0, 0, logicalW, logicalH)
      this.lastBgRect = drawCoverBackground(
        ctx,
        standaloneSrc.image,
        standaloneSrc.width,
        standaloneSrc.height,
        cover.background,
        logicalW,
        logicalH,
      )
      maskImage = standaloneSrc.image
    } else if (background) {
      this.lastBgRect = drawBackground(
        ctx,
        background.image,
        background.width,
        background.height,
        cfg.background,
        logicalW,
        logicalH,
      )
      drawVignette(ctx, logicalW, logicalH, cfg.background.vignette)
      maskImage = background.image
    } else {
      // 尚未导入背景图时铺一层中性底色，让预览可读
      ctx.fillStyle = '#2b2f36'
      ctx.fillRect(0, 0, logicalW, logicalH)
    }

    // 封面专属背景的常规路径 —— 按 opacity / blendMode / tint 叠在正文背景之上
    if (cover && cover.background.useOwn && cover.background.blendMode !== 'standalone') {
      const src = rc.coverImages?.get(cover.background.path)
      if (src) {
        drawCoverBackground(
          ctx,
          src.image,
          src.width,
          src.height,
          cover.background,
          logicalW,
          logicalH,
        )
      }
    }

    // 3) 蒙版 —— 封面可用自己的蒙版，否则沿用正文蒙版
    const mask = cover ? (cover.useOwnMask ? cover.mask : cfg.mask) : cfg.mask
    const maskGeo: Geometry =
      mask.type === 'card' && mask.pad !== geo.maskPad ? { ...geo, maskPad: mask.pad } : geo

    drawMask(
      ctx,
      cfg,
      mask,
      maskGeo,
      page.usedHeight,
      maskImage,
      this.lastBgRect,
    )

    // 4) 文字
    if (cover) {
      drawCoverText(ctx, page, cfg, cover)
    } else {
      drawContentText(ctx, page, cfg, geo)
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** 导出为 data URL（含前缀）。 */
  toDataURL(format: string, quality: number): string {
    const mime = `image/${format}`
    if (format === 'png') {
      return this.canvas.toDataURL(mime)
    }
    return this.canvas.toDataURL(mime, quality)
  }

  /** 导出为 Blob。 */
  toBlob(format: string, quality: number): Promise<Blob> {
    const mime = `image/${format}`
    return new Promise((resolve, reject) => {
      const q = format === 'png' ? undefined : quality
      this.canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Canvas 导出失败'))
        },
        mime,
        q,
      )
    })
  }

  get element(): HTMLCanvasElement {
    return this.canvas
  }
}
