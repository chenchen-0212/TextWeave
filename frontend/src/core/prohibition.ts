import type { Line } from '../types'
import { toGraphemes, firstGrapheme } from './graphemes'
import type { FontMetrics } from './FontMetrics'

/**
 * 中文排版禁则（渲染管线第 ② 步的修正环节）。
 *
 * 依据 W3C《中文排版需求》草案，实现三类禁则：
 *   1. 行首禁则 —— 某些字符不得出现在行首
 *   2. 行尾禁则 —— 某些字符不得出现在行尾
 *   3. 符号分离禁则 —— 成对符号不可被断行拆开
 *
 * 修正策略采用「推出原则」：断行点命中禁则时，把上一行的最后一个字素
 * 推到下一行，必要时连续前推，直到行首合法；若整行被推空则放弃修正，
 * 保证绝不丢失内容。
 *
 * 已知简化（与 text-frame 的实现口径一致）：不实现 W3C 规定的「先挤进」
 * （把标点压缩挤进上一行末尾）。代价是极端情况下行宽略有参差，
 * 通过两端对齐 + 字间距微调补偿。
 */

/** 行首禁则：这些字符不得出现在行首 */
export const NO_LINE_START = new Set<string>([
  // 点号
  '、', '。', '，', '．', '：', '；', '！', '？',
  ',', '.', ':', ';', '!', '?',
  // 结束引号（中文引号有方向性，不会与行尾禁则冲突）
  '”', '’', '」', '』',
  // 结束括号
  '）', '］', '｝', '〕', '〗', '】', '》', '〉',
  ')', ']', '}',
  // 连接号 / 间隔号 / 分隔号
  '–', '~', '～', '—', '·', '‧', '•', '・', '／', '/',
  // 省略号
  '…', '‥',
])

/** 行尾禁则：这些字符不得出现在行尾 */
export const NO_LINE_END = new Set<string>([
  // 开始引号
  '“', '‘', '「', '『',
  // 开始括号
  '（', '［', '｛', '〔', '〖', '【', '《', '〈',
  '(', '[', '{',
  // 分隔号
  '／', '/',
])

/** 符号分离禁则：成对符号不可拆行 */
export const NO_SPLIT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['—', '—'],
  ['…', '…'],
]

/** 单行内最多修正次数，防止异常输入导致的长循环 */
const MAX_FIXES_PER_LINE = 64

export interface ProhibitionResult {
  lines: Line[]
  fixes: number
}

function measure(text: string, metrics: FontMetrics): number {
  return text ? metrics.widthOfText(text) : 0
}

/**
 * 对已断行的结果应用排版禁则修正。
 * 输入应为按宽度粗切后的行数组，输出为修正后的行数组。
 */
export function applyProhibition(lines: Line[], metrics: FontMetrics): ProhibitionResult {
  let fixes = 0
  const out: Line[] = lines.map((l) => ({ text: l.text, width: l.width }))

  for (let i = 0; i < out.length - 1; i++) {
    // ---- 行首禁则：下一行不能以禁则字符开头 ----
    let guard = 0
    while (guard++ < MAX_FIXES_PER_LINE) {
      const cur = out[i]
      const next = out[i + 1]
      if (!cur || !next || !next.text) break

      const first = firstGrapheme(next.text)
      if (!first || !NO_LINE_START.has(first)) break

      const gs = toGraphemes(cur.text)
      // 推到本行打空则放弃，绝不丢内容
      if (gs.length <= 1) break

      const moved = gs.pop() as string
      const newCur = gs.join('')
      out[i] = { text: newCur, width: measure(newCur, metrics) }

      const newNext = moved + next.text
      out[i + 1] = { text: newNext, width: measure(newNext, metrics) }
      fixes++
    }

    // ---- 行尾禁则：本行不能以禁则字符结尾 ----
    guard = 0
    while (guard++ < MAX_FIXES_PER_LINE) {
      const cur = out[i]
      const next = out[i + 1]
      if (!cur || !next) break

      const gs = toGraphemes(cur.text)
      if (gs.length <= 1) break

      const last = gs[gs.length - 1]
      if (!NO_LINE_END.has(last)) break

      gs.pop()
      const newCur = gs.join('')
      out[i] = { text: newCur, width: measure(newCur, metrics) }

      const newNext = last + next.text
      out[i + 1] = { text: newNext, width: measure(newNext, metrics) }
      fixes++
    }
  }

  return { lines: out, fixes }
}

/** 判断某个字素是否属于符号分离禁则的成对符号。 */
export function isPairSymbol(g: string): boolean {
  for (const [a, b] of NO_SPLIT_PAIRS) {
    if (g === a || g === b) return true
  }
  return false
}
