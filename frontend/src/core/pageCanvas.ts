import type { CoverCanvasConfig, Orientation, Page, SizeUnit, StyleConfig } from '../types'
import { CANVAS_MAX_PX, CANVAS_MIN_PX } from '../types'

/**
 * 页面画布尺寸解析（v0.4.0：封面尺寸与正文尺寸解耦）。
 *
 * 全应用只有这一处决定「某一页实际用多大画布」：
 * 排版层（core/layout）、渲染层（CanvasRenderer）、预览与缩略图都读它，
 * 因此不存在两套口径打架的问题。
 *
 * 换算规则：
 *  - 单位统一按 96 DPI 折算成像素：1in = 96px，1cm = 96/2.54px，1mm = 96/25.4px；
 *  - 结果一律夹到 [CANVAS_MIN_PX, CANVAS_MAX_PX]，杜绝负值/0/NaN 造成渲染异常；
 *  - `followBody=true`（默认，也是旧数据的行为）→ 直接用正文画布尺寸。
 */

/** 每英寸像素数（CSS 基准 96 DPI） */
export const DPI = 96

/** 单位 → 像素 的换算系数 */
const UNIT_TO_PX: Record<SizeUnit, number> = {
  px: 1,
  in: DPI,
  cm: DPI / 2.54,
  mm: DPI / 25.4,
}

export function unitFactor(unit: SizeUnit): number {
  return UNIT_TO_PX[unit] ?? 1
}

/** 像素夹取：非有限值一律回退到下限 */
export function clampPx(v: number, fallback = CANVAS_MIN_PX): number {
  if (!Number.isFinite(v)) return fallback
  return Math.min(CANVAS_MAX_PX, Math.max(CANVAS_MIN_PX, Math.round(v)))
}

/** 按朝向归一化宽高。auto 不做任何调整。 */
function applyOrientation(
  w: number,
  h: number,
  orientation: Orientation,
): { width: number; height: number } {
  if (orientation === 'portrait' && w > h) return { width: h, height: w }
  if (orientation === 'landscape' && h > w) return { width: h, height: w }
  if (orientation === 'square' && w !== h) {
    const s = Math.max(w, h)
    return { width: s, height: s }
  }
  return { width: w, height: h }
}

/** 解析封面画布的最终像素尺寸（含单位换算、朝向归一、边界夹取）。 */
export function resolveCoverCanvas(coverCanvas: CoverCanvasConfig): {
  width: number
  height: number
} {
  const k = unitFactor(coverCanvas.unit)
  const oriented = applyOrientation(
    clampPx(coverCanvas.width * k),
    clampPx(coverCanvas.height * k),
    coverCanvas.orientation,
  )
  // 归一后可能因交换顺序而越界，再夹一次
  return { width: clampPx(oriented.width), height: clampPx(oriented.height) }
}

/**
 * 某一页实际使用的画布尺寸（逻辑像素）。
 *
 * 正文页 → 正文画布；封面页 → 封面画布（followBody 时等于正文画布）。
 */
export function pageCanvasSize(
  cfg: StyleConfig,
  pageKind: Page['kind'] | 'thumbnail',
): { width: number; height: number } {
  if (pageKind === 'cover' && cfg.coverCanvas && !cfg.coverCanvas.followBody) {
    return resolveCoverCanvas(cfg.coverCanvas)
  }
  return { width: cfg.canvas.width, height: cfg.canvas.height }
}

/** 页面是否使用独立画布（用于界面提示与「跟随正文」开关的说明） */
export function usesOwnCanvas(cfg: StyleConfig, pageKind: Page['kind']): boolean {
  return pageKind === 'cover' && cfg.coverCanvas ? !cfg.coverCanvas.followBody : false
}
