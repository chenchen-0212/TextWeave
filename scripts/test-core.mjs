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
    'src/core/pageCanvas.ts',
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
    try {
      execFileSync(process.execPath, [tscEntry, ...args], { cwd: FRONTEND, stdio: 'pipe' })
    } catch (e) {
      // 某些运行环境下 pipe 模式的子进程会被无信号终止（无退出码、无输出），
      // 这类情况改用继承模式重试一次，真实编译错误仍会照常抛出。
      if (e && (e.status === null || e.status === undefined)) {
        execFileSync(process.execPath, [tscEntry, ...args], { cwd: FRONTEND, stdio: 'inherit' })
      } else {
        throw e
      }
    }
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
    pageCanvas: requireFromOut('./core/pageCanvas.js'),
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

const { layout, lineBreaker, prohibition, types, pageCanvas } = (compile(), load())
const { buildLayout, computeGeometry, layoutCoverTextBoxes, MIN_FONT_SIZE } = layout
const { defaultConfig, defaultCoverText, CANVAS_MIN_PX, CANVAS_MAX_PX } = types
const { pageCanvasSize, resolveCoverCanvas, unitFactor, DPI } = pageCanvas

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

// ---------------------------------------------------------------- F 封面文本元素

function testCoverTexts() {
  console.log('\nF. 封面文本元素（拖拽定位的排版基础）')

  const cfg = defaultConfig()
  const cover = cfg.cover.items[0]
  const W = cfg.canvas.width
  const H = cfg.canvas.height

  // 默认封面文本为空 → 不产出任何包围盒
  const empty = layoutCoverTextBoxes(cfg, cover, makeMetrics())
  check('空文本不产出包围盒', empty.length === 0, String(empty.length))

  // 自动版式：居中 / 靠上 / 靠下
  cover.texts[0].text = '这是一段封面文字'
  cover.texts[0].placed = false

  const centerBox = layoutCoverTextBoxes(cfg, cover, makeMetrics())[0]
  const centerMidY = centerBox.y + centerBox.h / 2
  check('居中版式：块中心在画布中线附近', Math.abs(centerMidY - H / 2) <= 2, centerMidY.toFixed(1))

  cover.layout = 'top'
  const topBox = layoutCoverTextBoxes(cfg, cover, makeMetrics())[0]
  check('靠上版式：块顶边不高于安全区', topBox.y >= 0 && topBox.y < H * 0.3, topBox.y.toFixed(1))

  cover.layout = 'bottom'
  const bottomBox = layoutCoverTextBoxes(cfg, cover, makeMetrics())[0]
  check('靠下版式：块底边不小于安全区', bottomBox.y + bottomBox.h > H * 0.6, bottomBox.y.toFixed(1))

  // 手动定位 + 越界钳制
  cover.layout = 'center'
  cover.texts[0].placed = true
  cover.texts[0].align = 'left'
  cover.texts[0].x = -1
  cover.texts[0].y = 2
  const clamped = layoutCoverTextBoxes(cfg, cover, makeMetrics())[0]
  check('越界锚点被钳制到画布内', clamped.x >= 0 && clamped.y >= 0, `${clamped.x.toFixed(1)},${clamped.y.toFixed(1)}`)
  check('钳制后包围盒不超出画布', clamped.x + clamped.w <= W + 0.5 && clamped.y + clamped.h <= H + 0.5)

  // 窄宽度触发换行，块高随之增加
  cover.texts[0].text = '一二三四五六七八九十一二三四五六七八九十'
  cover.texts[0].x = 0.5
  cover.texts[0].y = 0.5
  cover.texts[0].align = 'center'
  cover.texts[0].widthRatio = 1
  const wide = layoutCoverTextBoxes(cfg, cover, makeMetrics())[0]
  cover.texts[0].widthRatio = 0.25
  const narrow = layoutCoverTextBoxes(cfg, cover, makeMetrics())[0]
  check('窄宽度导致更多行与更大块高', narrow.lines.length > wide.lines.length && narrow.h > wide.h,
    `${wide.lines.length}行/${wide.h.toFixed(0)} vs ${narrow.lines.length}行/${narrow.h.toFixed(0)}`)

  // 重叠检测
  cover.texts[0].widthRatio = 0.86
  cover.texts = [cover.texts[0], { ...cover.texts[0], id: 'second', y: 0.5, x: 0.5 }]
  const overlapped = layoutCoverTextBoxes(cfg, cover, makeMetrics())
  check('同位置双元素被标记为重叠', overlapped.length === 2 && overlapped.every((b) => b.overlapped), JSON.stringify(overlapped.map((b) => b.overlapped)))

  cover.texts[1].y = 0.95
  const separated = layoutCoverTextBoxes(cfg, cover, makeMetrics())
  check('错开足够距离后不再重叠', separated.every((b) => !b.overlapped), JSON.stringify(separated.map((b) => b.overlapped)))

  // 停用元素不参与排版
  cover.texts[0].enabled = false
  const disabled = layoutCoverTextBoxes(cfg, cover, makeMetrics())
  check('停用元素被跳过', disabled.length === 1 && disabled[0].elementId === 'second', String(disabled.length))

  // ---- 文本级蒙版：面板贴合文字块 ----
  cover.texts = [
    { ...defaultCoverText({ id: 'a', text: '甲', placed: true, x: 0.5, y: 0.3, widthRatio: 0.5 }) },
    { ...defaultCoverText({ id: 'b', text: '乙', placed: true, x: 0.5, y: 0.7, widthRatio: 0.5 }) },
  ]
  cover.texts[0].maskEnabled = true
  cover.texts[0].mask = { type: 'card', color: '#000000', alpha: 0.4, radius: 18, pad: 30, blur: 0, position: 'center' }
  const withMask = layoutCoverTextBoxes(cfg, cover, makeMetrics())
  const a = withMask.find((b) => b.elementId === 'a')
  const pad = 30
  check('面板按 mask.pad 外扩', Math.abs(a.panel.w - a.w - pad * 2) < 0.5 && Math.abs(a.panel.h - a.h - pad * 2) < 0.5,
    `panel ${a.panel.w.toFixed(1)}x${a.panel.h.toFixed(1)} vs text ${a.w.toFixed(1)}x${a.h.toFixed(1)}`)
  check('面板相对文字块居中', Math.abs((a.panel.x + a.panel.w / 2) - (a.x + a.w / 2)) < 0.5)
  check('启用标记透传', a.maskEnabled === true)
  check('未启用元素面板退化为文字块', withMask.find((b) => b.elementId === 'b').panel.w === withMask.find((b) => b.elementId === 'b').w)

  // 面板越界也要被钳制
  cover.texts[0].y = 0
  const clampedPanel = layoutCoverTextBoxes(cfg, cover, makeMetrics()).find((b) => b.elementId === 'a')
  check('面板被钳制在画布内', clampedPanel.panel.x >= 0 && clampedPanel.panel.y >= 0 &&
    clampedPanel.panel.x + clampedPanel.panel.w <= cfg.canvas.width + 0.5 &&
    clampedPanel.panel.y + clampedPanel.panel.h <= cfg.canvas.height + 0.5,
    `${clampedPanel.panel.x.toFixed(1)},${clampedPanel.panel.y.toFixed(1)}`)

  // veil/gradient 形态不做 pad 外扩
  cover.texts[0].y = 0.3
  cover.texts[0].mask = { type: 'veil', color: '#000000', alpha: 0.4, topBoost: 0, bottomBoost: 0 }
  const veilBox = layoutCoverTextBoxes(cfg, cover, makeMetrics()).find((b) => b.elementId === 'a')
  check('veil 形态面板等于文字块', veilBox.panel.w === veilBox.w && veilBox.panel.h === veilBox.h)

  // ---- 层级：按 z 升序 ----
  cover.texts[0].maskEnabled = false
  cover.texts[0].z = 5
  cover.texts[1].z = 1
  const ordered = layoutCoverTextBoxes(cfg, cover, makeMetrics())
  check('按 z 升序排列', ordered[0].elementId === 'b' && ordered[1].elementId === 'a',
    ordered.map((b) => `${b.elementId}:${b.z}`).join(','))

  cover.texts[0].z = 0
  cover.texts[1].z = 0
  const stable = layoutCoverTextBoxes(cfg, cover, makeMetrics())
  check('同 z 保持数组顺序', stable[0].elementId === 'a' && stable[1].elementId === 'b',
    stable.map((b) => b.elementId).join(','))
}

// ---------------------------------------------------------------- G 封面尺寸解耦

function testCoverCanvas() {
  console.log('\nG. 封面尺寸与正文解耦')

  // 1) 默认跟随正文 → 与解耦前行为一致
  const cfg = defaultConfig()
  check('默认跟随正文', cfg.coverCanvas.followBody === true)
  check('默认封面尺寸等于正文', pageCanvasSize(cfg, 'cover').width === cfg.canvas.width &&
    pageCanvasSize(cfg, 'cover').height === cfg.canvas.height)
  check('正文页始终取正文画布', pageCanvasSize(cfg, 'content').width === cfg.canvas.width)

  // 2) 独立尺寸：只影响封面
  cfg.coverCanvas.followBody = false
  cfg.coverCanvas.width = 1200
  cfg.coverCanvas.height = 630
  cfg.coverCanvas.orientation = 'auto'
  const coverSize = pageCanvasSize(cfg, 'cover')
  const bodySize = pageCanvasSize(cfg, 'content')
  check('封面取独立尺寸', coverSize.width === 1200 && coverSize.height === 630, `${coverSize.width}x${coverSize.height}`)
  check('正文尺寸不受影响', bodySize.width === cfg.canvas.width && bodySize.height === cfg.canvas.height,
    `${bodySize.width}x${bodySize.height}`)

  // 3) 封面文本排版按封面尺寸，正文分页按正文尺寸
  const cover = cfg.cover.items[0]
  cover.texts[0].text = '封面文字'
  cover.texts[0].placed = false
  const wide = layoutCoverTextBoxes(cfg, cover, makeMetrics())[0]
  check('封面文本盒不超过封面宽度', wide.x + wide.w <= coverSize.width + 0.5,
    `${(wide.x + wide.w).toFixed(1)} vs ${coverSize.width}`)

  const bodyText = '这是一段正文内容，用来验证封面尺寸变化不会影响正文排版。'.repeat(6)
  cfg.constraint.enable = false
  const layoutWide = buildLayout(bodyText, cfg, makeMetrics())
  const beforePages = layoutWide.pages.filter((p) => p.kind === 'content').length

  // 把封面改成极端尺寸，正文页数必须一模一样
  cfg.coverCanvas.width = 400
  cfg.coverCanvas.height = 400
  const layoutNarrow = buildLayout(bodyText, cfg, makeMetrics())
  const afterPages = layoutNarrow.pages.filter((p) => p.kind === 'content').length
  check('封面尺寸变化后正文页数不变', beforePages === afterPages, `${beforePages} vs ${afterPages}`)

  const boxA = layoutWide.pages.find((p) => p.kind === 'content')
  const boxB = layoutNarrow.pages.find((p) => p.kind === 'content')
  const sameLayout =
    boxA.blocks.length === boxB.blocks.length &&
    boxA.blocks.every((blk, i) => blk.lines.length === boxB.blocks[i].lines.length)
  check('封面尺寸变化后正文逐块结构不变', sameLayout)

  // 4) 单位换算（96 DPI）
  check('px 系数为 1', unitFactor('px') === 1)
  check('in 系数为 96', unitFactor('in') === DPI)
  const mm = resolveCoverCanvas({ width: 25.4, height: 25.4, unit: 'mm', orientation: 'auto', followBody: false })
  check('25.4mm ≈ 96px', Math.abs(mm.width - 96) <= 1, String(mm.width))
  const inch = resolveCoverCanvas({ width: 1, height: 2, unit: 'in', orientation: 'auto', followBody: false })
  check('1in × 2in = 96 × 192', inch.width === 96 && inch.height === 192, `${inch.width}x${inch.height}`)

  // 5) 朝向归一
  const land = resolveCoverCanvas({ width: 1080, height: 1920, unit: 'px', orientation: 'landscape', followBody: false })
  check('横向自动交换宽高', land.width === 1920 && land.height === 1080, `${land.width}x${land.height}`)
  const sq = resolveCoverCanvas({ width: 800, height: 1200, unit: 'px', orientation: 'square', followBody: false })
  check('方形取较大值补齐', sq.width === 1200 && sq.height === 1200, `${sq.width}x${sq.height}`)
  const auto = resolveCoverCanvas({ width: 800, height: 1200, unit: 'px', orientation: 'auto', followBody: false })
  check('不约束时保持原值', auto.width === 800 && auto.height === 1200, `${auto.width}x${auto.height}`)

  // 6) 边界校验：负值 / 0 / NaN / 超大 全部夹到合法区间
  for (const [label, w, h] of [
    ['负值', -500, -300],
    ['零', 0, 0],
    ['NaN', NaN, NaN],
    ['超大', 999999, 999999],
  ]) {
    const r = resolveCoverCanvas({ width: w, height: h, unit: 'px', orientation: 'auto', followBody: false })
    const ok =
      Number.isFinite(r.width) && Number.isFinite(r.height) &&
      r.width >= CANVAS_MIN_PX && r.width <= CANVAS_MAX_PX &&
      r.height >= CANVAS_MIN_PX && r.height <= CANVAS_MAX_PX
    check(`${label}尺寸被夹到合法区间`, ok, `${r.width}x${r.height}`)
  }

  // 7) 单位切换后仍不越界（英寸 + 极大值）
  const big = resolveCoverCanvas({ width: 1000, height: 1000, unit: 'in', orientation: 'auto', followBody: false })
  check('英寸大值被夹到上限', big.width === CANVAS_MAX_PX, String(big.width))
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
testCoverTexts()
testCoverCanvas()

console.log('\n' + '='.repeat(64))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failures.length > 0) {
  console.log('\n失败明细：')
  for (const f of failures) console.log('  - ' + f)
}
console.log('='.repeat(64))

process.exit(failed > 0 ? 1 : 0)
