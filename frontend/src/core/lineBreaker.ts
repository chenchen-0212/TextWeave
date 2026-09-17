import type { Line } from '../types'
import { toGraphemes } from './graphemes'
import type { FontMetrics } from './FontMetrics'
import { applyProhibition } from './prohibition'

/**
 * 按可用宽度把一段文本断成多行，并应用中文排版禁则。
 *
 * 处理要点：
 *  - 按字素而非 UTF-16 code unit 累加宽度，emoji 与组合字符不会被拆开；
 *  - 单个字素本身就宽于可用区时强制单独成行，避免死循环；
 *  - 拉丁文按单词边界回退断行，不在单词内部硬切；
 *  - 文本中的 \n 视为强制换行。
 */

const WORD_CHAR = /[A-Za-z0-9\u00C0-\u024F]/

/** 度量时必须使用的字距，调用方需保证与绘制一致 */
export interface BreakOptions {
  maxWidth: number
  /** 是否应用禁则修正，默认 true */
  applyRules?: boolean
}

/**
 * 在 buf 中寻找拉丁单词的起始下标。
 * 返回 -1 表示当前行尾不是可回退的拉丁单词边界（应硬切）。
 */
function findLatinWordStart(buf: string[]): number {
  const last = buf[buf.length - 1]
  if (!last || !WORD_CHAR.test(last)) return -1

  for (let i = buf.length - 1; i >= 0; i--) {
    const ch = buf[i]
    if (ch === ' ' || ch === '\t') {
      const start = i + 1
      // 整行只有一个词，无法回退
      return start < buf.length ? start : -1
    }
    if (!WORD_CHAR.test(ch)) return -1
  }
  return -1
}

function joinWidth(buf: string[], metrics: FontMetrics): number {
  return buf.length > 0 ? metrics.widthOfText(buf.join('')) : 0
}

/** 把一段文本断成多行（未应用禁则）。 */
export function breakRaw(text: string, metrics: FontMetrics, maxWidth: number): Line[] {
  const out: Line[] = []
  const hardLines = text.split('\n')

  for (const hard of hardLines) {
    if (!hard) {
      out.push({ text: '', width: 0 })
      continue
    }

    const gs = toGraphemes(hard)
    let buf: string[] = []
    let bufW = 0

    for (const g of gs) {
      const gw = metrics.widthOf(g)

      // 单个字素就超宽：强制单独成行（超长 URL / 组合 emoji 的兜底）
      if (buf.length === 0) {
        buf.push(g)
        bufW = gw
        if (gw > maxWidth) {
          out.push({ text: g, width: gw })
          buf = []
          bufW = 0
        }
        continue
      }

      if (bufW + gw <= maxWidth) {
        buf.push(g)
        bufW += gw
        continue
      }

      // 放不下：优先在拉丁单词边界回退
      const wordStart = findLatinWordStart(buf)
      if (wordStart > 0) {
        const head = buf.slice(0, wordStart)
        const tail = buf.slice(wordStart)
        out.push({ text: head.join(''), width: joinWidth(head, metrics) })

        buf = tail
        bufW = joinWidth(buf, metrics)
        if (bufW + gw <= maxWidth) {
          buf.push(g)
          bufW += gw
        } else {
          out.push({ text: buf.join(''), width: bufW })
          buf = [g]
          bufW = gw
        }
      } else {
        out.push({ text: buf.join(''), width: bufW })
        buf = [g]
        bufW = gw
      }
    }

    if (buf.length > 0) {
      out.push({ text: buf.join(''), width: bufW })
    }
  }

  return out
}

/**
 * 断行 + 禁则修正，返回可直接用于排版的 Line[]。
 */
export function breakIntoLines(
  text: string,
  metrics: FontMetrics,
  opts: BreakOptions,
): { lines: Line[]; fixes: number } {
  const raw = breakRaw(text, metrics, opts.maxWidth)
  if (opts.applyRules === false) {
    return { lines: raw, fixes: 0 }
  }
  return applyProhibition(raw, metrics)
}

/** 测量一段文本在给定宽度下会占多少行。 */
export function countLines(text: string, metrics: FontMetrics, maxWidth: number): number {
  return breakRaw(text, metrics, maxWidth).length
}
