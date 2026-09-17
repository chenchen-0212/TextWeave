/**
 * 字素（grapheme）切分。
 *
 * 中文排版里不能按 UTF-16 code unit 切分：emoji、代理对、组合字符
 * 都会因此被拆成两半。优先使用 Intl.Segmenter；环境不支持时退化为
 * Array.from（正确处理代理对，但无法处理组合字符序列）。
 */

// Segmenter 实例懒初始化；false 表示当前环境不支持
let segmenter: { segment(input: string): Iterable<{ segment: string }> } | null | false = null

interface SegmenterCtor {
  new (locale: string, options: { granularity: string }): {
    segment(input: string): Iterable<{ segment: string }>
  }
}

function getSegmenter() {
  if (segmenter === null) {
    const ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
    segmenter = typeof ctor === 'function' ? new ctor('zh', { granularity: 'grapheme' }) : false
  }
  return segmenter
}

/** 将文本切分为字素数组。 */
export function toGraphemes(text: string): string[] {
  if (!text) return []

  const seg = getSegmenter()
  if (!seg) return Array.from(text)

  const out: string[] = []
  for (const item of seg.segment(text)) {
    out.push(item.segment)
  }
  return out
}

/** 取首字素，空串时返回空字符串。 */
export function firstGrapheme(text: string): string {
  const g = toGraphemes(text)
  return g.length > 0 ? g[0] : ''
}

/** 取末字素，空串时返回空字符串。 */
export function lastGrapheme(text: string): string {
  const g = toGraphemes(text)
  return g.length > 0 ? g[g.length - 1] : ''
}

/** 统计字素数（比 text.length 更接近用户感知的「字数」）。 */
export function graphemeCount(text: string): number {
  return toGraphemes(text).length
}
