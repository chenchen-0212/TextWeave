import type { Block, Line } from '../types'

/**
 * 容量装箱（渲染管线第 ⑤ 步）。
 *
 * 策略：贪心放置 + 回退借行 + 孤寡行保护。
 *  - 能整块放下就整块放；
 *  - 放不下时尝试「从本块借走当前页剩余空间能容纳的行数」，
 *    但切出来的头和尾都不能短于 minOrphanLines；
 *  - 不满足则整块推到下一页 —— 宁可留白，也不破坏阅读连贯性。
 */

export interface PaginateOptions {
  availHeight: number
  lineHeight: number
  paragraphSpacing: number
  /** 孤寡行保护阈值 */
  minOrphanLines: number
}

export interface PaginateResult {
  /** 每页的块列表 */
  pages: Block[][]
  /** 被切分过的段落数 */
  splitParagraphs: number
  /** 是否出现了单块超页的溢出情况（正常情况下不应发生） */
  overflow: boolean
}

/** 复制块的一个行区间，生成新的块。 */
function sliceBlock(
  block: Block,
  from: number,
  to: number,
  isParaStart: boolean,
  isParaEnd: boolean,
): Block {
  const lines: Line[] = block.lines.slice(from, to).map((l) => ({ text: l.text, width: l.width }))
  return {
    type: 'paragraph',
    lines,
    paraIndex: block.paraIndex,
    isPartial: true,
    isParaStart,
    isParaEnd,
  }
}

function blockLineCount(b: Block): number {
  return b.lines.length
}

export function paginate(blocks: Block[], opts: PaginateOptions): PaginateResult {
  const { availHeight, lineHeight, paragraphSpacing, minOrphanLines } = opts
  const minLines = Math.max(1, minOrphanLines)

  const pages: Block[][] = [[]]
  let used = 0 // 当前页已用内容高度（不含末尾段间距）
  let splitParagraphs = 0
  let overflow = false

  const pushPage = (blocksOnPage: Block[]) => {
    pages.push(blocksOnPage)
  }

  for (const block of blocks) {
    const total = blockLineCount(block)

    // 空行块：直接参与占位计算
    const gap = used > 0 ? paragraphSpacing : 0
    const need = gap + total * lineHeight

    if (used + need <= availHeight) {
      pages[pages.length - 1].push(block)
      used += need
      continue
    }

    // 当前页是空的却仍放不下 —— 单块超页，只能溢出放置
    // （正常流程下 splitter 已保证不会出现，此处为防御性兜底）
    if (used === 0) {
      pages[pages.length - 1].push(block)
      used = total * lineHeight
      overflow = true
      continue
    }

    // 尝试借行
    const slack = availHeight - used - gap
    const take = Math.floor(slack / lineHeight)

    if (take >= minLines && total - take >= minLines) {
      const head = sliceBlock(block, 0, take, block.isParaStart, false)
      const tail = sliceBlock(block, take, total, false, block.isParaEnd)

      pages[pages.length - 1].push(head)
      pushPage([tail])
      used = (total - take) * lineHeight
      splitParagraphs++
      continue
    }

    // 孤寡行保护不通过 → 整块推到下一页
    pushPage([block])
    used = total * lineHeight
  }

  // 兜底：若最后一页为空页，去掉它
  if (pages.length > 1 && pages[pages.length - 1].length === 0) {
    pages.pop()
  }

  return { pages, splitParagraphs, overflow }
}

/** 计算一页的内容高度（不含末尾段间距）。 */
export function measurePageHeight(
  blocks: Block[],
  lineHeight: number,
  paragraphSpacing: number,
): number {
  let h = 0
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) h += paragraphSpacing
    h += blockLineCount(blocks[i]) * lineHeight
  }
  return h
}
