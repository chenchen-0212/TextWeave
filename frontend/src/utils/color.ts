/** 颜色工具：把 #RRGGBB / #RGB / #RRGGBBAA 解析为分量并重新组合出带透明度的颜色。 */

export interface RGB {
  r: number
  g: number
  b: number
  a: number
}

const cache = new Map<string, RGB>()

/** 解析颜色字符串，失败时返回不透明黑色。 */
export function parseColor(input: string): RGB {
  const key = (input || '').trim().toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit

  let result: RGB = { r: 0, g: 0, b: 0, a: 1 }

  if (key.startsWith('#')) {
    const hex = key.slice(1)
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) result = { r, g, b, a: 1 }
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) result = { r, g, b, a: 1 }
    } else if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = parseInt(hex.slice(6, 8), 16)
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
        result = { r, g, b, a: a / 255 }
      }
    }
  }

  cache.set(key, result)
  if (cache.size > 256) cache.clear()
  return result
}

/** 生成带指定不透明度的 rgba 颜色。alpha 与颜色自身透明度相乘。 */
export function withAlpha(color: string, alpha: number): string {
  const { r, g, b, a } = parseColor(color)
  const finalAlpha = Math.max(0, Math.min(1, a * alpha))
  return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`
}

/** 计算颜色的相对亮度（0~1），用于判断背景明暗以推荐文字颜色。 */
export function luminance(color: string): number {
  const { r, g, b } = parseColor(color)
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
