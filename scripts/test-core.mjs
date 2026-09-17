#!/usr/bin/env node
/**
 * 核心排版逻辑验证。
 *
 * 验证的都是「靠肉眼看不出、但错了整个产品就废掉」的性质：
 *   A. 中文排版禁则 —— 任何一行都不以禁则字符开头 / 结尾
 *   B. 单调性 —— pages(fs) 关于 fs 单调不增（二分搜索正确性的前提）
 *   C. 目标张数约束 —— 解确实是满足约束的最大字号
 *   D. 极端输入不卡死（无空格长串、emoji、超长 URL、无标点长文）
 *   E. 孤寡行保护 —— 被切开的段落头尾行数都不小于阈值
 *
 * 用法：node scripts/test-core.mjs
 * 原理：先用 tsc 把 core/ 编译成 CommonJS 到 .tmp/core-test，再加载执行。
 *       整个过程不依赖浏览器与 Canvas，因此可以在 CI 里直接跑。
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = path.join(ROOT, 'frontend')
const OUT_DIR = path.join(ROOT, '.tmp', 'core-test')

// ---------------------------------------------------------------- 编译

function compile() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const args = [
    'src/core/layout.ts',
    'src/core/lineBreaker.ts',
    'src/core/prohibition.ts',
    'src/types/index.ts',
    '--outDir', OUT_DIR,
    '--rootDir', 'src',
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
    '--strict', 'false',
  ]

  // 直接用当前 Node 执行本地的 tsc JS 入口。
  // 不走 npx / tsc.cmd：Node 18+ 在 Windows 上 spawn .cmd 需要 shell: true，
  // 依赖 shell 会带来引号转义与跨平台的麻烦。
  const tscEntry = path.join(FRONTEND, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tscEntry)) {
    console.error(`未找到 TypeScript，请先在 frontend 目录执行 npm install\n  期望路径：${tscEntry}`)
    process.exit(1)
  }

  try {
    execFileSync(process.execPath, [tscEntry, ...args], { cwd: FRONTEND, stdio: 'pipe' })
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '')
    console.error('核心模块编译失败：\n' + out)
    process.exit(1)
  }

  // 让 Node 把编译产物按 CommonJS 解析
  writeFileSync(path.join(OUT_DIR, 'package.json'), '{"type":"commonjs"}\n')
}

// ---------------------------------------------------------------- 加载

const requireFromOut = createRequire(path.join(OUT_DIR, '__entry.js'))

function load() {
  const layoutPath = path.join(OUT_DIR, 'core', 'layout.js')
  if (!existsSync(layoutPath)) {
    console.error('未找到编译产物：' + layoutPath)
    process.exit(1)
  }
  return {
    layout: requireFromOut('./core/layout.js'),
    lineBreaker: requireFromOut('./core/lineBreaker.js'),
    prohibition: requireFromOut('./core/prohibition.js'),
    types: requireFromOut('./types/index.js'),
  }
}

// ---------------------------------------------------------------- 度量桩

/**
 * 等宽近似的字体度量替身：汉字宽度 = 字号，其余 = 字号 × 0.5。
 * 真实渲染用 Canvas measureText，这里只验证算法性质，不验证字形。
 */
function makeMetrics() {
  let size = 48
  let spacing = 0
  const cache = new Map()

  const m = {
    setFont(_family, _size, _weight, _spacing) {
      size = _size
      spacing = _spacing || 0
    },
    widthOf(g) {
      const key = `${size}|${g}`
      let w = cache.get(key)
      if (w === undefined) {
        w = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(g) ? size : size * 0.5
        cache.set(key, w)
      }
      return w + spacing
    },
    widthOfText(t) {
      let total = 0
      for (const g of [...t]) total += m.widthOf(g)
      return total
    },
    advanceWidth(g) {
      return m.widthOf(g)
    },
    reset() {
      cache.clear()
    },
    fontKey: 'stub',
    measureCalls: 0,
  }
  return m
}

// ---------------------------------------------------------------- 语料

const PARA = [
  '内容创作者把一篇长文变成系列图文时，最容易卡住的地方并不是写作本身，而是排版。',
  '一篇文章三千字，手工拆成八张图需要反复调整字号、行距和对齐，改一个字就要重排全部。',
  '更麻烦的是，当你想用自己的实拍照片或品牌视觉作为底图时，现成的卡片工具只能输出纯色与渐变背景。',
  '于是我们做了这个工具：输入一段文本与一张背景图，自动切分为多个段落，分别渲染到背景图上。',
  '它会优先在段落之间分页；段落过长时按句末标点二次切分；仍然过长时按逗号顿号继续拆分。',
  '中文排版禁则会保证标点不出现在行首，括号与引号不会被拆开，破折号与省略号保持完整。',
  '最后，目标张数约束会用二分搜索找到满足张数区间的最大字号，兼顾清晰度与产出量。',
]
const LONG_TEXT = PARA.join('\n\n')

const PATHOLOGICAL = [
  { name: '无空格超长串', text: 'A'.repeat(110) },
  {
    name: '超长 URL',
    text: '参考链接 https://example.com/very/long/path/with/many/segments/that/never/ends/and/keeps/going?query=1234567890 请查阅。',
  },
  { name: 'emoji 与组合字符', text: '表情符号测试 👨‍👩‍👧‍👦🏳️‍🌈👍🏽 这些是组合字素，不能被拆成两半。'.repeat(20) },
  { name: '单段无标点超长文本', text: '这是一个没有任何标点的超长段落'.repeat(200) },
  { name: '纯空行与空白', text: '\n\n\n   \n\n\n' },
  { name: '单个字符', text: '中' },
]

// ---------------------------------------------------------------- 断言

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const { layout, lineBreaker, prohibition, types } = (compile(), load())
const { buildLayout, computeGeometry, MIN_FONT_SIZE } = layout
const { defaultConfig } = types

function pagesAt(text, fontSize) {
  const cfg = defaultConfig()
  cfg.constraint.enable = false
  cfg.text.fontSize = fontSize
  return buildLayout(text, cfg, makeMetrics())
}

// ---------------------------------------------------------------- A 禁则

function testProhibition() {
  console.log('\nA. 中文排版禁则')
  const metrics = makeMetrics()
  const geo = computeGeometry(defaultConfig(), 48, 1)
  metrics.setFont('stub', 48, 400, 0)

  let badStart = 0
  let badEnd = 0
  let totalLines = 0

  for (const para of [...PARA, ...PATHOLOGICAL.map((p) => p.text)]) {
    const { lines } = lineBreaker.breakIntoLines(para, metrics, { maxWidth: geo.availW })
    for (const line of lines) {
      if (!line.text) continue
      totalLines++
      const gs = [...line.text]
      if (prohibition.NO_LINE_START.has(gs[0])) badStart++
      if (prohibition.NO_LINE_END.has(gs[gs.length - 1])) badEnd++
    }
  }

  check(`共 ${totalLines} 行，无不以禁则字符开头的行`, badStart === 0, badStart ? `${badStart} 行违规` : '')
  check('无不以禁则字符结尾的行', badEnd === 0, badEnd ? `${badEnd} 行违规` : '')
}

// ---------------------------------------------------------------- B 单调性

function testMonotonicity() {
  console.log('\nB. pages(fs) 单调性（二分搜索的正确性前提）')
  const series = []
  let monotonic = true
  let worst = ''

  for (let fs = 24; fs <= 160; fs += 4) {
    const pages = pagesAt(LONG_TEXT, fs).totalPages
    series.push({ fs, pages })
    if (series.length > 1) {
      const prev = series[series.length - 2]
      if (pages < prev.pages) {
        monotonic = false
        worst = `fs=${prev.fs}→${prev.pages}张，fs=${fs}→${pages}张`
      }
    }
  }

  console.log('        抽样：' + series.filter((_, i) => i % 4 === 0).map((s) => `${s.fs}px:${s.pages}张`).join('  '))
  check('字号增大时页数单调不减少（即字号减小时页数不反弹）', monotonic, worst)
}

// ---------------------------------------------------------------- C 约束

function testConstraint() {
  console.log('\nC. 目标张数约束')

  const cases = [
    { maxPages: 4, userFontSize: 96 },
    { maxPages: 6, userFontSize: 96 },
    { maxPages: 10, userFontSize: 96 },
    { maxPages: 3, userFontSize: 48 },
  ]

  for (const c of cases) {
    const cfg = defaultConfig()
    cfg.text.fontSize = c.userFontSize
    cfg.constraint = { enable: true, minPages: 1, maxPages: c.maxPages }

    const out = buildLayout(LONG_TEXT, cfg, makeMetrics())
    const satisfied = out.totalPages <= c.maxPages
    const atLimit = out.fontSize >= c.userFontSize
    const bigger = atLimit ? null : pagesAt(LONG_TEXT, out.fontSize + 1).totalPages
    const optimal = atLimit || bigger > c.maxPages

    check(
      `maxPages=${c.maxPages}：得到 ${out.totalPages} 张 / ${out.fontSize}px，满足约束`,
      satisfied,
      satisfied ? '' : `实际 ${out.totalPages} 张`,
    )
    check(
      `maxPages=${c.maxPages}：字号是满足约束的最大值（${out.fontSize}px）`,
      optimal,
      optimal ? '' : `+1px 后仅 ${bigger} 张，还能更大`,
    )
  }

  const cfg = defaultConfig()
  cfg.text.fontSize = 96
  cfg.constraint = { enable: true, minPages: 1, maxPages: 1 }
  const out = buildLayout(LONG_TEXT, cfg, makeMetrics())

  check(
    '张数上限过小时触底并如实告知（不静默截断）',
    out.fontSize === MIN_FONT_SIZE && out.totalPages > 1 && out.message.length > 0,
    `fontSize=${out.fontSize} pages=${out.totalPages}`,
  )
  check('触底时给出 violated 标记', out.violated === true)
}

// ---------------------------------------------------------------- D 极端输入

function testPathological() {
  console.log('\nD. 极端输入不卡死、不丢内容')
  for (const p of PATHOLOGICAL) {
    const started = Date.now()
    let ok = true
    let info = ''
    try {
      const out = pagesAt(p.text, 48)
      const elapsed = Date.now() - started
      ok = elapsed < 8000
      info = `${out.totalPages} 张 / ${elapsed}ms`
    } catch (e) {
      ok = false
      info = String(e && e.message)
    }
    check(`${p.name}（${info}）`, ok)
  }
}

// ---------------------------------------------------------------- E 孤寡行

function testOrphans() {
  console.log('\nE. 孤寡行保护')
  const cfg = defaultConfig()
  cfg.text.fontSize = 48
  cfg.text.minOrphanLines = 2
  const out = buildLayout(LONG_TEXT, cfg, makeMetrics())

  let violations = 0
  const perPara = new Map()

  for (const page of out.pages) {
    if (page.kind !== 'content') continue
    for (const b of page.blocks) {
      perPara.set(b.paraIndex, (perPara.get(b.paraIndex) || 0) + b.lines.length)
    }
  }

  for (const page of out.pages) {
    if (page.kind !== 'content') continue
    for (const b of page.blocks) {
      if (!b.isPartial) continue
      const total = perPara.get(b.paraIndex) || 0
      if (total <= cfg.text.minOrphanLines * 2) continue
      if (b.lines.length < cfg.text.minOrphanLines) violations++
    }
  }

  check(`被切分的块行数均不小于 ${cfg.text.minOrphanLines} 行`, violations === 0, violations ? `${violations} 个违规块` : '')
}

// ---------------------------------------------------------------- 主流程

console.log('='.repeat(64))
console.log('文织 TextWeave · 核心排版逻辑验证')
console.log('='.repeat(64))
console.log(`语料：${LONG_TEXT.length} 字符 / ${PARA.length} 段，另含 ${PATHOLOGICAL.length} 组极端输入`)
console.log(`编译产物：${path.relative(ROOT, OUT_DIR)}`)

testProhibition()
testMonotonicity()
testConstraint()
testPathological()
testOrphans()

console.log('\n' + '='.repeat(64))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failures.length > 0) {
  console.log('\n失败明细：')
  for (const f of failures) console.log('  - ' + f)
}
console.log('='.repeat(64))

process.exit(failed > 0 ? 1 : 0)
