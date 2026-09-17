import { toGraphemes } from './graphemes'
import { normalizeText } from './normalizer'

/**
 * 文本切分（渲染管线第 ① ② ④ 步）。
 *
 * 三级递进策略（对应决策 D-06「段落优先 + 容量自适应」）：
 *   一级 —— 按空行分段；
 *   二级 —— 段落过长时按句末标点拆成句子；
 *   三级 —— 句子仍过长时按逗号顿号拆成分句；
 *   兜底 —— 仍过长则按字素硬切。
 * 保证任何输入都能落到「不超过单页可用高度」的块上，且尽量不断句。
 */

const SENTENCE_END = new Set([
  '。', '！', '？', '；', '…', '!', '?', ';',
])

/** 句末标点后需要一并收尾的字符（结束引号 / 括号） */
const TRAILING = /[”’」』）】》〉]/

const CLAUSE_END = new Set([
  '，', '、', ',', '：', ':', '—',
])

function isSentenceEnd(g: string): boolean {
  return SENTENCE_END.has(g)
}

function isClauseEnd(g: string): boolean {
  return CLAUSE_END.has(g)
}

/**
 * 一级切分：把规范化后的文本切成段落数组。
 *
 * 逐级降级：空行 → 单换行 → 句末标点。这样无论用户是规范分段书写，
 * 还是把整篇文章塞成一行，都能得到合理的段落划分。
 */
export function splitParagraphs(text: string): string[] {
  const norm = normalizeText(text)
  if (!norm) return []

  let parts = norm
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (parts.length <= 1) {
    const byLine = norm
      .split('\n')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (byLine.length > 1) parts = byLine
  }

  if (parts.length <= 1) {
    const bySentence = splitSentences(norm)
    if (bySentence.length > 1) parts = bySentence
  }

  if (parts.length === 0) parts = [norm]
  return parts
}

/** 按句末标点切分，标点跟随前句。 */
export function splitSentences(text: string): string[] {
  const gs = toGraphemes(text)
  const out: string[] = []
  let buf = ''

  for (let i = 0; i < gs.length; i++) {
    buf += gs[i]
    if (!isSentenceEnd(gs[i])) continue

    // 连续标点（如「？！」）要一起收尾，不能在中间断开
    const next = gs[i + 1]
    if (next && isSentenceEnd(next)) continue

    // 把紧随其后的结束引号 / 括号带上
    let j = i + 1
    while (j < gs.length && TRAILING.test(gs[j])) {
      buf += gs[j]
      j++
    }
    i = j - 1

    const t = buf.trim()
    if (t) out.push(t)
    buf = ''
  }

  const rest = buf.trim()
  if (rest) out.push(rest)
  return out
}

/** 按逗号顿号等分句标点切分。 */
export function splitClauses(text: string): string[] {
  const gs = toGraphemes(text)
  const out: string[] = []
  let buf = ''

  for (let i = 0; i < gs.length; i++) {
    buf += gs[i]
    if (!isClauseEnd(gs[i])) continue

    const next = gs[i + 1]
    if (next && isClauseEnd(next)) continue

    let j = i + 1
    while (j < gs.length && TRAILING.test(gs[j])) {
      buf += gs[j]
      j++
    }
    i = j - 1

    const t = buf.trim()
    if (t) out.push(t)
    buf = ''
  }

  const rest = buf.trim()
  if (rest) out.push(rest)
  return out
}

/** 兜底：按固定字素数硬切，仅在前面所有策略都无法压到单页时使用。 */
export function splitByLength(text: string, maxChars: number): string[] {
  if (maxChars <= 0) return [text]
  const gs = toGraphemes(text)
  const out: string[] = []
  for (let i = 0; i < gs.length; i += maxChars) {
    out.push(gs.slice(i, i + maxChars).join(''))
  }
  return out.length > 0 ? out : [text]
}

/**
 * 判断某段提示文本是否适合作为系列首图的默认封面标题。
 * 取第一段的第一个句子，并裁到合理长度。
 */
export function suggestCoverTitle(text: string, maxChars = 20): string {
  const paras = splitParagraphs(text)
  if (paras.length === 0) return ''
  const first = splitSentences(paras[0])[0] ?? paras[0]
  const gs = toGraphemes(first)
  return gs.length > maxChars ? gs.slice(0, maxChars).join('') : first
}
