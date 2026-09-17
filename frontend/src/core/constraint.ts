/**
 * 目标张数约束求解（渲染管线第 ⑥ 步）—— P0 功能。
 *
 * 核心是一个针对字号的二分搜索。正确性依赖一条单调性：
 *
 *   pages(fs) 关于 fs 单调不增
 *
 * 因为字号减小时，行高与段距等比减小、每行容纳的字数增加、每页容纳的行数
 * 也增加，三个方向都只会让页数减少，页数不会反弹。这条性质保证了二分搜索
 * 能拿到「满足张数约束的最大字号」这一全局最优解。
 *
 * 该函数保持泛型与纯函数，不依赖 canvas，便于单独测试与在 Web Worker 中运行。
 */

export interface ConstraintOptions {
  enable: boolean
  minPages: number
  maxPages: number
  /** 用户设定的字号，作为搜索上界 */
  userFontSize: number
  /** 可读性下限 */
  minFontSize: number
}

export interface ConstraintOutcome<T> {
  value: T
  /** 总页数（含封面） */
  totalPages: number
  /** 求解得到的目标字号 */
  fontSize: number
  /** 实际执行了多少次布局（诊断用） */
  iterations: number
  /** 是否违反约束（触底仍超页） */
  violated: boolean
  /** 是否为压张数而收紧了段间距 */
  tightenedSpacing: boolean
  /** 给用户看的提示，空串表示无异常 */
  message: string
}

/** 压张数时允许的段间距收紧系数 */
export const SPACING_TIGHTEN_FACTOR = 0.6

export type LayoutAt<T> = (fontSize: number, spacingFactor: number) => { value: T; totalPages: number }

export function solvePageConstraint<T>(
  opts: ConstraintOptions,
  layoutAt: LayoutAt<T>,
): ConstraintOutcome<T> {
  const { enable, userFontSize, minFontSize, minPages, maxPages } = opts

  let iterations = 0
  const run = (fs: number, factor: number) => {
    iterations++
    return layoutAt(fs, factor)
  }

  // 未启用约束：直接按用户字号跑一次
  if (!enable) {
    const r = run(userFontSize, 1)
    return {
      value: r.value,
      totalPages: r.totalPages,
      fontSize: userFontSize,
      iterations,
      violated: false,
      tightenedSpacing: false,
      message: '',
    }
  }

  const hi0 = Math.max(minFontSize, Math.round(userFontSize))

  /** 二分搜索满足 totalPages <= maxPages 的最大字号 */
  const search = (factor: number) => {
    let lo = minFontSize
    let hi = hi0
    let best: { fs: number; r: { value: T; totalPages: number } } | null = null

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      const r = run(mid, factor)
      if (r.totalPages <= maxPages) {
        best = { fs: mid, r }
        lo = mid + 1 // 还能更大，继续往大试
      } else {
        hi = mid - 1
      }
    }
    return best
  }

  let best = search(1)
  let tightenedSpacing = false

  // 一级回退：段间距收紧后再搜一遍
  if (!best) {
    tightenedSpacing = true
    best = search(SPACING_TIGHTEN_FACTOR)
  }

  // 二级回退：连最小可读字号都压不进 maxPages，允许超页输出并明确告知
  if (!best) {
    const r = run(minFontSize, SPACING_TIGHTEN_FACTOR)
    return {
      value: r.value,
      totalPages: r.totalPages,
      fontSize: minFontSize,
      iterations,
      violated: true,
      tightenedSpacing: true,
      message: `内容超出 ${maxPages} 张，已按最小可读字号 ${minFontSize}px 输出 ${r.totalPages} 张。建议放宽张数上限或精简内容。`,
    }
  }

  // 内容不足以填满最少张数：如实告知，不靠放大字号硬凑
  if (best.r.totalPages < minPages) {
    return {
      value: best.r.value,
      totalPages: best.r.totalPages,
      fontSize: best.fs,
      iterations,
      violated: false,
      tightenedSpacing,
      message: `内容仅够 ${best.r.totalPages} 张，少于设定的最少 ${minPages} 张。`,
    }
  }

  return {
    value: best.r.value,
    totalPages: best.r.totalPages,
    fontSize: best.fs,
    iterations,
    violated: false,
    tightenedSpacing,
    message: '',
  }
}
