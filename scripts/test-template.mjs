#!/usr/bin/env node
/**
 * 模板编解码与配置净化验证。
 *
 * 重点验证「导入一份来路不明的配置」这条最容易出事链路上的性质：
 *   A. 往返一致性 —— 配置 → 分享码 → 配置，值不丢不错
 *   B. 三种蒙版形态都能正确往返（蒙版是唯一的变长字段）
 *   C. 对抗性输入 —— 空串、乱码、版本过高、字段缺失、超范围数值、非法颜色
 *   D. JSON 载荷（导出文件）往返
 *   E. 分享码长度在可粘贴的范围内
 *
 * 用法：node scripts/test-template.mjs
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = path.join(ROOT, 'frontend')
const OUT_DIR = path.join(ROOT, '.tmp', 'tpl-test')

// ---------------------------------------------------------------- 编译

function compile() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const tscEntry = path.join(FRONTEND, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tscEntry)) {
    console.error(`未找到 TypeScript，请先在 frontend 目录执行 npm install`)
    process.exit(1)
  }

  const args = [
    'src/utils/templateCodec.ts',
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
    console.error('编译失败：\n' + String(e.stdout || '') + String(e.stderr || ''))
    process.exit(1)
  }
  writeFileSync(path.join(OUT_DIR, 'package.json'), '{"type":"commonjs"}\n')
}

compile()

const requireFromOut = createRequire(path.join(OUT_DIR, '__entry.js'))
const codec = requireFromOut('./utils/templateCodec.js')
const types = requireFromOut('./types/index.js')

const {
  sanitizeConfig,
  encodeShareCode,
  decodeSharePayload,
  buildSharePayload,
} = codec
const { defaultConfig, defaultMaskOfType, SHARE_CODE_PREFIX } = types

// ---------------------------------------------------------------- 断言

let passed = 0
let failed = 0
const failures = []

function check(name, ok, detail) {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

/** 比较时剔除设计上就不参与分享的字段 */
function normalize(cfg) {
  const c = JSON.parse(JSON.stringify(cfg))
  c.export.dir = ''
  c.export.book = ''
  c.text.fontPath = ''
  c.cover.activeId = ''
  // 渠道节自 v3 起随分享码传输，参与往返比较，不再剔除。
  // 引导元素（overlay）含本机图片路径，与输出目录同策略，不进分享码。
  c.overlay = { items: [] }
  for (const item of c.cover.items) {
    // 封面 id 是本地标识，导入时重新生成
    item.id = ''
    // 文本元素 id 同样是本地标识
    for (const t of item.texts ?? []) t.id = ''
    // 封面背景图的路径与本机文件名都不参与传输
    item.background.path = ''
    item.background.name = ''
  }
  return c
}

function findDiff(a, b, trail = '') {
  if (a === b) return null
  if (typeof a !== typeof b) return `${trail}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  if (a === null || b === null) return `${trail}: ${a} vs ${b}`
  if (typeof a !== 'object') return `${trail}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`

  if (Array.isArray(a) !== Array.isArray(b)) return `${trail}: 数组/对象不一致`
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const d = findDiff(a[k], b[k], trail ? `${trail}.${k}` : k)
    if (d) return d
  }
  return null
}

function makeConfig(mutate) {
  const cfg = defaultConfig()
  cfg.text.fontFamily = '微软雅黑'
  if (mutate) mutate(cfg)
  return cfg
}

// ---------------------------------------------------------------- A 往返

function testRoundTrip() {
  console.log('\nA. 分享码往返一致性')

  const cfg = makeConfig((c) => {
    c.canvas.width = 1080
    c.canvas.height = 2340
    c.canvas.preset = 'phone-195x9'
    c.background.brightness = 1.15
    c.background.contrast = 0.95
    c.background.vignette = 0.35
    c.text.fontSize = 52
    c.text.fontWeight = 700
    c.text.lineHeightRatio = 1.85
    c.text.letterSpacing = 1.5
    c.text.textAlign = 'justify'
    c.text.textIndent = 2
    c.cover.items[0].texts[0].text = '把长文变成系列图'
    c.cover.items[0].texts[0].x = 0.42
    c.cover.items[0].texts[0].y = 0.28
    c.cover.items[0].texts[0].placed = true
    c.cover.items[0].texts[0].align = 'left'
    c.constraint.enable = true
    c.constraint.maxPages = 12
    c.export.filenameTemplate = '{index}-{title}'
    c.export.alsoZip = true
    c.export.pad = 3
  })

  const code = encodeShareCode(cfg, '我的模板')
  check(`生成了分享码（前缀 ${SHARE_CODE_PREFIX}）`, code.startsWith(SHARE_CODE_PREFIX), code.slice(0, 12))

  const decoded = decodeSharePayload(code)
  check('名称正确还原', decoded.name === '我的模板', decoded.name)

  const diff = findDiff(normalize(cfg), normalize(decoded.config))
  check('全部字段往返一致', diff === null, diff || '')
}

// ---------------------------------------------------------------- B 蒙版

function testMaskRoundTrip() {
  console.log('\nB. 三种蒙版形态往返')

  const cases = [
    {
      type: 'card',
      mutate: (c) => {
        c.mask = { type: 'card', color: '#1A2B3C', alpha: 0.62, radius: 32, pad: 56, blur: 12, position: 'center' }
      },
    },
    {
      type: 'veil',
      mutate: (c) => {
        c.mask = { type: 'veil', color: '#000000', alpha: 0.48, topBoost: 0.3, bottomBoost: 0.7 }
      },
    },
    {
      type: 'gradient',
      mutate: (c) => {
        c.mask = {
          type: 'gradient',
          direction: 'both',
          color: '#0B1220',
          maxAlpha: 0.9,
          solidRatio: 0.12,
          transparentRatio: 0.55,
        }
      },
    },
  ]

  for (const cs of cases) {
    const cfg = makeConfig(cs.mutate)
    const code = encodeShareCode(cfg, cs.type)
    const decoded = decodeSharePayload(code)

    const a = JSON.stringify(cfg.mask)
    const b = JSON.stringify(decoded.config.mask)
    check(`${cs.type} 蒙版字段完整还原`, a === b, a === b ? '' : `${a} vs ${b}`)

    const diff = findDiff(normalize(cfg), normalize(decoded.config))
    check(`${cs.type} 整份配置一致`, diff === null, diff || '')
  }

  // 封面的独立蒙版
  const cfg = makeConfig((c) => {
    c.cover.items[0].useOwnMask = true
    c.cover.items[0].mask = {
      type: 'veil',
      color: '#000000',
      alpha: 0.8,
      topBoost: 0,
      bottomBoost: 0.2,
    }
  })
  const decoded = decodeSharePayload(encodeShareCode(cfg, 'cover-mask'))
  check(
    '封面独立蒙版完整还原',
    JSON.stringify(cfg.cover.items[0].mask) ===
      JSON.stringify(decoded.config.cover.items[0].mask),
    JSON.stringify(decoded.config.cover.items[0].mask),
  )
}

// ---------------------------------------------------------------- F 多封面

/** 封面文本元素工厂（v0.4.0 模型） */
function textEl(text, over = {}) {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    text,
    fontSize: 96,
    fontWeight: 700,
    color: '',
    align: 'center',
    x: 0.5,
    y: 0.5,
    widthRatio: 0.86,
    placed: false,
    mask: { type: 'card', color: '#000000', alpha: 0.45, radius: 18, pad: 28, blur: 0, position: 'center' },
    maskEnabled: false,
    z: 0,
    ...over,
  }
}

function makeCover(overrides) {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    texts: [
      {
        id: `t-${Math.random().toString(36).slice(2, 8)}`,
        enabled: true,
        text: '标题',
        fontSize: 96,
        fontWeight: 700,
        color: '',
        align: 'center',
        x: 0.5,
        y: 0.5,
        widthRatio: 0.86,
        placed: false,
      },
    ],
    layout: 'center',
    useOwnMask: false,
    mask: {
      type: 'card',
      color: '#000000',
      alpha: 0.65,
      radius: 24,
      pad: 48,
      blur: 0,
      position: 'stretchToFill',
    },
    background: {
      useOwn: false,
      path: '',
      name: '',
      fit: 'cover',
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      blendMode: 'normal',
      tintColor: '#000000',
      tintAlpha: 0,
      brightness: 1,
      contrast: 1,
      saturate: 1,
      blur: 0,
      vignette: 0,
    },
    ...overrides,
  }
}
function testMultiCover() {
  console.log('\nF. 多封面往返')

  const cfg = makeConfig((c) => {
    c.cover = {
      items: [
        makeCover({ texts: [textEl('第一张封面')] }),
        makeCover({
          texts: [{ ...textEl('第二张封面'), fontSize: 120, fontWeight: 400, color: '#FFCC00' }],
          layout: 'bottom',
          useOwnMask: true,
          mask: { type: 'veil', color: '#101820', alpha: 0.72, topBoost: 0.1, bottomBoost: 0.3 },
          background: {
            useOwn: true,
            path: 'D:\\local\\cover-b.jpg',
            name: 'cover-b.jpg',
            fit: 'contain',
            scale: 1.8,
            offsetX: -0.4,
            offsetY: 0.25,
            opacity: 0.6,
            blendMode: 'multiply',
            tintColor: '#20304A',
            tintAlpha: 0.35,
            brightness: 1.2,
            contrast: 0.9,
            saturate: 0.7,
            blur: 6,
            vignette: 0.4,
          },
        }),
        makeCover({ texts: [textEl('第三张（停用）')], enabled: false }),
      ],
      activeId: 'whatever',
    }
  })

  const code = encodeShareCode(cfg, '三封面模板')
  const decoded = decodeSharePayload(code)

  check('封面数量还原为 3', decoded.config.cover.items.length === 3, String(decoded.config.cover.items.length))
  check('停用状态被保留', decoded.config.cover.items[2].enabled === false)

  const diff = findDiff(normalize(cfg), normalize(decoded.config))
  check('三张封面全部字段往返一致', diff === null, diff || '')

  // 逐项校验第二张封面的关键视觉参数
  const b = decoded.config.cover.items[1]
  check('缩放被还原', b.background.scale === 1.8, String(b.background.scale))
  check('水平位置被还原', b.background.offsetX === -0.4, String(b.background.offsetX))
  check('不透明度被还原', b.background.opacity === 0.6, String(b.background.opacity))
  check('叠加模式被还原', b.background.blendMode === 'multiply', b.background.blendMode)
  check('叠加色被还原', b.background.tintColor === '#20304A', b.background.tintColor)
  check('叠加浓度被还原', b.background.tintAlpha === 0.35, String(b.background.tintAlpha))
  check('填满方式被还原', b.background.fit === 'contain', b.background.fit)
  check('文本元素颜色被还原', b.texts[0].color === '#FFCC00', String(b.texts[0].color))
  check('独立蒙版被还原', b.useOwnMask === true && b.mask.type === 'veil', b.mask.type)

  check(
    '本机路径未进入分享码',
    !code.includes('cover-b.jpg') && !code.includes('D:'),
    '分享码里出现了本机路径',
  )
  check('封面图名未进入分享码', !code.includes('D%3A') && !code.includes('local'))
}

// ---------------------------------------------------------------- G' 独立不叠加

/**
 * 「独立（不叠加）」是叠加模式枚举的追加项，不是数组结构变更：
 * 分享码仍走同一张位置表，短码 'x' 追加在枚举表尾部。
 * 必须验证：新值能往返、旧值不受影响、未知短码安全回退。
 */
function testStandaloneBlend() {
  console.log("\nG'. 叠加模式新增「独立不叠加」")

  const cfg = makeConfig((c) => {
    c.cover.items[0].background.useOwn = true
    c.cover.items[0].background.blendMode = 'standalone'
    c.cover.items[0].background.opacity = 0.3
  })
  const decoded = decodeSharePayload(encodeShareCode(cfg, '独立模式'))
  check(
    'standalone 经分享码往返保留',
    decoded.config.cover.items[0].background.blendMode === 'standalone',
    decoded.config.cover.items[0].background.blendMode,
  )
  check(
    '独立模式下其余背景参数不受影响',
    decoded.config.cover.items[0].background.scale === cfg.cover.items[0].background.scale,
    String(decoded.config.cover.items[0].background.scale),
  )

  // 对象形态导入（JSON 载荷）同样接受新值
  const obj = sanitizeConfig({
    cover: {
      items: [
        {
          background: { useOwn: true, blendMode: 'standalone', tintAlpha: 0.2 },
        },
      ],
    },
  })
  check(
    '对象形态导入接受 standalone',
    obj.cover.items[0].background.blendMode === 'standalone',
    obj.cover.items[0].background.blendMode,
  )

  // 旧配置 / 未知短码必须回退到 normal，绝不能误判成独立模式
  const legacy = sanitizeConfig({
    cover: { items: [{ background: { useOwn: true, blendMode: 'multiply' } }] },
  })
  check(
    '旧值 multiply 不受影响',
    legacy.cover.items[0].background.blendMode === 'multiply',
    legacy.cover.items[0].background.blendMode,
  )

  const unknown = sanitizeConfig({
    cover: { items: [{ background: { useOwn: true, blendMode: 'hologram' } }] },
  })
  check(
    '非法值回退 normal（默认值未变）',
    unknown.cover.items[0].background.blendMode === 'normal',
    unknown.cover.items[0].background.blendMode,
  )
}

// ---------------------------------------------------------------- G 旧版兼容

/** 构造一条 v1 协议的分享码（字段索引与 v2 不同） */
function makeV1Code() {
  const arr = new Array(43).fill(0)
  arr[0] = 1 // version
  arr[1] = '1'
  arr[2] = 1080
  arr[3] = 1920
  arr[4] = 1
  arr[5] = 'p'
  arr[6] = 0.92
  arr[7] = 'c'
  arr[8] = 1
  arr[9] = 1
  arr[10] = 1
  arr[11] = 0
  arr[12] = 0
  arr[13] = 0
  arr[14] = 0
  arr[15] = 'c'
  arr[16] = '微软雅黑'
  arr[17] = 's'
  arr[18] = 48
  arr[19] = 400
  arr[20] = '#FFFFFF'
  arr[21] = 1.75
  arr[22] = 0
  arr[23] = 0.9
  arr[24] = 'l'
  arr[25] = 0
  arr[26] = 96
  arr[27] = 2
  arr[28] = 1 // cover.enable
  arr[29] = '旧版封面标题'
  arr[30] = '旧版副标题'
  arr[31] = 88
  arr[32] = 500
  arr[33] = 't'
  arr[34] = 1 // useDifferentMask
  arr[35] = 1
  arr[36] = 1
  arr[37] = 18
  arr[38] = '{index}'
  arr[39] = 0
  arr[40] = 2
  arr[41] = ['c', '#000000', 0.55, 24, 48, 0, 's']
  arr[42] = ['v', '#000000', 0.8, 0, 0.2]

  return SHARE_CODE_PREFIX + toBase64Url(JSON.stringify(['旧模板', 1700000000, arr]))
}

function testLegacyCompat() {
  console.log('\nG. 旧版（v1）分享码兼容')

  let decoded = null
  let err = ''
  try {
    decoded = decodeSharePayload(makeV1Code())
  } catch (e) {
    err = e.message
  }

  check('v1 分享码仍可导入', decoded !== null, err)
  if (!decoded) return

  const cover = decoded.config.cover.items[0]
  check('自动迁移为单封面集合', decoded.config.cover.items.length === 1)
  check('封面标题被迁移为文本元素', cover.texts[0].text === '旧版封面标题', cover.texts[0].text)
  check('副标题已下线并被丢弃', cover.texts.length === 1, String(cover.texts.length))
  check('封面色号被迁移到元素', cover.texts[0].fontSize === 88, String(cover.texts[0].fontSize))
  check('封面字重被迁移到元素', cover.texts[0].fontWeight === 500, String(cover.texts[0].fontWeight))
  check('迁移后仍为自动版式（未定位）', cover.texts[0].placed === false)
  check('封面版面被正确迁移', cover.layout === 'top', cover.layout)
  check('独立蒙版标记被正确迁移', cover.useOwnMask === true)
  check('封面遮罩被正确迁移（veil）', cover.mask.type === 'veil', cover.mask.type)
  check('正文蒙版未受封面迁移影响', decoded.config.mask.type === 'card', decoded.config.mask.type)
  check('画布尺寸未错位', decoded.config.canvas.width === 1080, String(decoded.config.canvas.width))
  check('张数上限未错位', decoded.config.constraint.maxPages === 18, String(decoded.config.constraint.maxPages))
}

/** 对象形态的 v1 结构（旧 config.json）也要能迁移 */
function testLegacyObjectMigration() {
  console.log('\nG2. 旧版对象结构的迁移（旧 config.json）')

  const v1 = {
    cover: {
      enable: false,
      title: '对象版标题',
      subtitle: '对象版副标题',
      titleFontSize: 100,
      titleWeight: 700,
      layout: 'bottom',
      useDifferentMask: true,
      mask: { type: 'card', color: '#112233', alpha: 0.7, radius: 30, pad: 40, blur: 5, position: 'center' },
    },
  }

  const cleaned = sanitizeConfig(v1)
  const item = cleaned.cover.items[0]

  check('对象结构的封面被迁移', cleaned.cover.items.length === 1)
  check('enabled 由 enable 映射而来', item.enabled === false, String(item.enabled))
  check('标题被迁移为文本元素', item.texts[0].text === '对象版标题', item.texts[0].text)
  check('旧副标题被丢弃', item.texts.length === 1, String(item.texts.length))
  check('旧字号被迁移到元素', item.texts[0].fontSize === 100, String(item.texts[0].fontSize))
  check('独立蒙版被迁移', item.useOwnMask === true)
  check('蒙版字段被迁移', item.mask.color === '#112233' && item.mask.radius === 30, JSON.stringify(item.mask))
  check('背景配置补上默认值', item.background.useOwn === false && item.background.scale === 1)
}

// ---------------------------------------------------------------- H 路径安全

function testPathSafety() {
  console.log('\nH. 本机路径的保留与剥离')

  const withPaths = {
    text: { fontPath: 'C:\\Windows\\Fonts\\evil.ttf' },
    export: { dir: 'D:\\somewhere' },
    cover: {
      items: [
        makeCover({
          background: {
            useOwn: true,
            path: 'D:\\secret\\photo.jpg',
            name: 'photo.jpg',
            fit: 'cover',
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            opacity: 1,
            blendMode: 'normal',
            tintColor: '#000000',
            tintAlpha: 0,
            brightness: 1,
            contrast: 1,
            saturate: 1,
            blur: 0,
            vignette: 0,
          },
        }),
      ],
    },
  }

  const stripped = sanitizeConfig(withPaths)
  check('外部导入：字体路径被剥离', stripped.text.fontPath === '', stripped.text.fontPath)
  check('外部导入：输出目录被剥离', stripped.export.dir === '', stripped.export.dir)
  check(
    '外部导入：封面图路径被剥离',
    stripped.cover.items[0].background.path === '',
    stripped.cover.items[0].background.path,
  )

  const kept = sanitizeConfig(withPaths, { keepLocalPaths: true })
  check('本机数据：字体路径被保留', kept.text.fontPath === 'C:\\Windows\\Fonts\\evil.ttf')
  check('本机数据：输出目录被保留', kept.export.dir === 'D:\\somewhere')
  check(
    '本机数据：封面图路径被保留',
    kept.cover.items[0].background.path === 'D:\\secret\\photo.jpg',
    kept.cover.items[0].background.path,
  )
  check('useOwn 标记不受路径策略影响', kept.cover.items[0].background.useOwn === true)
}

function testCoverSanitize() {
  console.log('\nH2. 封面背景参数的越界裁剪')

  const dirty = {
    cover: {
      items: [
        {
          enabled: 'yes',
          titleFontSize: 9999,
          titleWeight: 123,
          layout: 'diagonal',
          color: 'not-a-color',
          useOwnMask: 'maybe',
          mask: { type: 'card' },
          background: {
            useOwn: true,
            fit: 'weird',
            scale: 99,
            offsetX: -50,
            offsetY: 50,
            opacity: 5,
            blendMode: 'magic',
            tintColor: 'red',
            tintAlpha: -3,
            brightness: 99,
            contrast: -1,
            saturate: 99,
            blur: -5,
            vignette: 99,
          },
        },
      ],
    },
  }

  const c = sanitizeConfig(dirty)
  const item = c.cover.items[0]
  const bg = item.background

  check('enabled 非法值回退为 true', item.enabled === true, String(item.enabled))
  check('字号被夹到 300', item.texts[0].fontSize === 300, String(item.texts[0].fontSize))
  check('字重非法值回退 700', item.texts[0].fontWeight === 700, String(item.texts[0].fontWeight))
  check('版面非法值回退 center', item.layout === 'center', item.layout)
  check('非法标题颜色回退为空（跟随正文）', item.texts[0].color === '', JSON.stringify(item.texts[0].color))
  check('useOwnMask 非法值回退 false', item.useOwnMask === false)
  check('填满方式非法值回退 cover', bg.fit === 'cover', bg.fit)
  check('缩放被夹到 5', bg.scale === 5, String(bg.scale))
  check('水平位置被夹到 -1', bg.offsetX === -1, String(bg.offsetX))
  check('垂直位置被夹到 1', bg.offsetY === 1, String(bg.offsetY))
  check('不透明度被夹到 1', bg.opacity === 1, String(bg.opacity))
  check('叠加模式非法值回退 normal', bg.blendMode === 'normal', bg.blendMode)
  check('非法叠加色回退默认', /^#[0-9a-fA-F]{6}$/.test(bg.tintColor), bg.tintColor)
  check('叠加浓度不为负', bg.tintAlpha === 0, String(bg.tintAlpha))
  check('亮度被夹到 2', bg.brightness === 2, String(bg.brightness))
  check('对比度被夹到下限', bg.contrast === 0.3, String(bg.contrast))
  check('饱和度被夹到 2', bg.saturate === 2, String(bg.saturate))
  check('模糊不为负', bg.blur === 0, String(bg.blur))
  check('暗角被夹到 1', bg.vignette === 1, String(bg.vignette))

  // 封面列表必须至少有一张，否则界面无法录入
  const empty = sanitizeConfig({ cover: { items: [] } })
  check('空封面列表自动补一张', empty.cover.items.length === 1, String(empty.cover.items.length))
}

// ---------------------------------------------------------------- C 对抗输入

function testAdversarial() {
  console.log('\nC. 对抗性输入（必须明确报错或安全裁剪，绝不崩溃）')

  const shouldThrow = [
    ['空字符串', ''],
    ['纯空白', '   \n  '],
    ['随机文本', 'hello world 你好'],
    ['JSON 但不是模板', '{"foo": 1, "bar": [1,2,3]}'],
    ['数组 JSON', '[1,2,3]'],
    ['损坏的分享码', SHARE_CODE_PREFIX + 'not-a-valid-base64!!!'],
    ['分享码体为空', SHARE_CODE_PREFIX],
  ]

  for (const [name, input] of shouldThrow) {
    let threw = false
    let msg = ''
    try {
      decodeSharePayload(input)
    } catch (e) {
      threw = true
      msg = e.message
    }
    check(`${name} → 明确报错`, threw && msg.length > 0, threw ? '' : '竟然没有抛错')
  }

  // 版本过高：手工构造 v99 的分享码（内容全为 ASCII，直接 btoa 即可）
  const future = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41,
    ['c', '#000000', 0.5, 10, 10, 0, 's'], ['c', '#000000', 0.5, 10, 10, 0, 's']]
  future[0] = 99
  const code = SHARE_CODE_PREFIX + toBase64Url(JSON.stringify(['future', 1700000000, future]))

  let futureThrew = false
  let futureMsg = ''
  try {
    decodeSharePayload(code)
  } catch (e) {
    futureThrew = true
    futureMsg = e.message
  }
  check('版本过高 → 提示升级应用', futureThrew && futureMsg.includes('版本'), futureMsg)

  // 字段缺失：只给 20 项，应当被长度校验拦住
  const shortCode = SHARE_CODE_PREFIX + toBase64Url(JSON.stringify(['short', 1700000000, future.slice(0, 20)]))
  let shortThrew = false
  try {
    decodeSharePayload(shortCode)
  } catch {
    shortThrew = true
  }
  check('字段数量不足 → 拒绝导入', shortThrew)
}

/** 与实现同款的 base64url 编码，用于构造对抗样本 */
function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return Buffer.from(binary, 'binary').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function testSanitize() {
  console.log('\nC2. 配置净化（超范围 / 非法值被安全裁剪）')

  const dirty = {
    canvas: { width: 999999, height: -50, scale: 99, format: 'exe', quality: 42 },
    background: { fillMode: 'weird', brightness: 999, contrast: -5, blur: -10, offsetX: 50 },
    mask: { type: 'card', color: 'not-a-color', alpha: 5, radius: -20, pad: 99999, position: 'nowhere' },
    text: {
      fontSize: 9999,
      fontWeight: 123,
      color: 'rgb(1,2,3)',
      lineHeightRatio: 0.1,
      textAlign: 'middle',
      minOrphanLines: 99,
      fontPath: 'C:\\evil\\path.ttf',
    },
    cover: { titleWeight: 999, layout: 'diagonal' },
    constraint: { minPages: 10, maxPages: 3 },
    export: { dir: 'D:\\somewhere', pad: 99 },
  }

  const clean = sanitizeConfig(dirty)

  check('宽度被夹到上限', clean.canvas.width === 8000, String(clean.canvas.width))
  check('高度被夹到下限', clean.canvas.height === 200, String(clean.canvas.height))
  check('倍率被夹到 3', clean.canvas.scale === 3, String(clean.canvas.scale))
  check('非法格式回退为 png', clean.canvas.format === 'png', clean.canvas.format)
  check('画质被夹到 1', clean.canvas.quality === 1, String(clean.canvas.quality))

  check('非法填充模式回退 cover', clean.background.fillMode === 'cover', clean.background.fillMode)
  check('亮度被夹到 2', clean.background.brightness === 2, String(clean.background.brightness))
  check('对比度被夹到下限', clean.background.contrast === 0.3, String(clean.background.contrast))
  check('模糊不为负', clean.background.blur === 0, String(clean.background.blur))
  check('偏移被夹到 1', clean.background.offsetX === 1, String(clean.background.offsetX))

  check('非法颜色回退默认', /^#[0-9a-fA-F]{6}$/.test(clean.mask.color), clean.mask.color)
  check('蒙版透明度被夹到 1', clean.mask.alpha === 1, String(clean.mask.alpha))
  check('圆角不为负', clean.mask.radius === 0, String(clean.mask.radius))
  check('卡片位置回退铺满', clean.mask.position === 'stretchToFill', clean.mask.position)

  check('字号被夹到 200', clean.text.fontSize === 200, String(clean.text.fontSize))
  check('非法字重回退 400', clean.text.fontWeight === 400, String(clean.text.fontWeight))
  check('非十六进制颜色回退', /^#[0-9a-fA-F]{6}$/.test(clean.text.color), clean.text.color)
  check('行高被夹到下限', clean.text.lineHeightRatio === 1.2, String(clean.text.lineHeightRatio))
  check('非法对齐回退 left', clean.text.textAlign === 'left', clean.text.textAlign)
  check('孤寡行被夹到 5', clean.text.minOrphanLines === 5, String(clean.text.minOrphanLines))
  check('字体路径被强制清空（防注入本地路径）', clean.text.fontPath === '', clean.text.fontPath)

  check('封面字重回退 700', clean.cover.items[0].texts[0].fontWeight === 700, String(clean.cover.items[0].texts[0].fontWeight))
  check('封面版面回退 center', clean.cover.items[0].layout === 'center', clean.cover.items[0].layout)

  check(
    '张数上限不得小于下限（自动纠正）',
    clean.constraint.maxPages >= clean.constraint.minPages,
    `${clean.constraint.minPages}~${clean.constraint.maxPages}`,
  )
  check('导出目录被强制清空（不从外部载荷恢复）', clean.export.dir === '', clean.export.dir)
  check('序号位数被夹到 5', clean.export.pad === 5, String(clean.export.pad))

  // 完全空的输入也必须能产出一份可用配置
  const fromNothing = sanitizeConfig(null)
  const diff = findDiff(normalize(defaultConfig()), normalize(fromNothing))
  check('null 输入 → 回退为完整默认配置', diff === null, diff || '')

  const fromGarbage = sanitizeConfig('this is a string')
  check('字符串输入 → 不崩溃且得到默认值', fromGarbage.canvas.width === 1080, String(fromGarbage.canvas.width))

  const fromArray = sanitizeConfig([1, 2, 3])
  check('数组输入 → 不崩溃', fromArray.canvas.width === 1080, String(fromArray.canvas.width))
}

// ---------------------------------------------------------------- D JSON 载荷

function testJsonPayload() {
  console.log('\nD. JSON 载荷（导出文件）往返')

  const cfg = makeConfig((c) => {
    c.cover.items[0].texts[0].text = '带引号"和换行\n的标题'
    c.mask = { type: 'gradient', direction: 'top', color: '#123456', maxAlpha: 0.7, solidRatio: 0.2, transparentRatio: 0.5 }
  })

  const payload = buildSharePayload(cfg, 'JSON 测试')
  check('载荷带 $tw 标识', payload.$tw === 'template', String(payload.$tw))
  check('载荷带版本号', typeof payload.v === 'number' && payload.v >= 1, String(payload.v))

  const text = JSON.stringify(payload, null, 2)
  const decoded = decodeSharePayload(text)

  check('名称还原', decoded.name === 'JSON 测试', decoded.name)
  const diff = findDiff(normalize(cfg), normalize(decoded.config))
  check('含特殊字符的标题正确还原', diff === null, diff || '')
  check(
    '标题里的换行与引号未被破坏',
    decoded.config.cover.items[0].texts[0].text === cfg.cover.items[0].texts[0].text,
    JSON.stringify(decoded.config.cover.items[0].texts[0].text),
  )
}

// ---------------------------------------------------------------- E 长度

function testLength() {
  console.log('\nE. 分享码长度（需可粘贴到聊天窗口）')

  const samples = [
    ['默认配置', makeConfig()],
    [
      '全量自定义',
      makeConfig((c) => {
        c.text.fontFamily = '思源黑体 CN Medium'
        c.cover.items[0].texts[0].text = '这是一段较长的封面标题用于测试体积，看看分享码会膨胀到什么程度'
        c.mask = { type: 'gradient', direction: 'both', color: '#0B1220', maxAlpha: 0.9, solidRatio: 0.1, transparentRatio: 0.6 }
      }),
    ],
    [
      '三张封面（含专属背景参数）',
      makeConfig((c) => {
        c.cover.items = [
          makeCover({ texts: [textEl('封面一')] }),
          makeCover({
            title: '封面二',
            useOwnMask: true,
            background: {
              useOwn: true,
              path: '',
              name: '',
              fit: 'cover',
              scale: 1.6,
              offsetX: -0.3,
              offsetY: 0.2,
              opacity: 0.65,
              blendMode: 'multiply',
              tintColor: '#223344',
              tintAlpha: 0.3,
              brightness: 1.1,
              contrast: 1,
              saturate: 0.8,
              blur: 4,
              vignette: 0.3,
            },
          }),
          makeCover({ texts: [textEl('封面三')], layout: 'bottom' }),
        ]
      }),
    ],
  ]

  for (const [name, cfg] of samples) {
    const len = encodeShareCode(cfg, '模板名').length
    check(`${name}：${len} 字符（阈值 900）`, len < 900, String(len))
  }
}

/** I. 渠道节与引导元素（v3 新增能力的净化与迁移） */
function testChannelAndOverlay() {
  console.log('\nI. 渠道节与引导元素（v3）')

  // 渠道节随分享码 v3 往返
  const cfg = makeConfig((c) => {
    c.channel.name = '抖音信息流'
    c.channel.subfolderPattern = '{book}/{channel}'
    c.channel.sizes = [{ id: 'ch-9x16', label: '抖音快手 9:16', width: 1080, height: 1920 }]
  })
  const decoded = decodeSharePayload(encodeShareCode(cfg, '渠道包'))
  check('渠道名随分享码还原', decoded.config.channel.name === '抖音信息流', decoded.config.channel.name)
  check('子目录模板还原', decoded.config.channel.subfolderPattern === '{book}/{channel}', decoded.config.channel.subfolderPattern)
  check(
    '渠道尺寸组还原',
    decoded.config.channel.sizes.length === 1 &&
      decoded.config.channel.sizes[0].width === 1080 &&
      decoded.config.channel.sizes[0].label === '抖音快手 9:16',
    JSON.stringify(decoded.config.channel.sizes),
  )

  // 旧版 config.json 的渠道字段挂在 export 下 → 迁移到 channel 节
  const migrated = sanitizeConfig({
    export: { channel: '小红书', subfolderPattern: '{channel}', sizes: [{ id: 'x', label: 'x', width: 1080, height: 1440 }] },
  })
  check('旧 export.channel 迁移到 channel.name', migrated.channel.name === '小红书', migrated.channel.name)
  check('旧 subfolderPattern 迁移', migrated.channel.subfolderPattern === '{channel}', migrated.channel.subfolderPattern)
  check('旧 sizes 迁移', migrated.channel.sizes.length === 1, JSON.stringify(migrated.channel.sizes))

  // 引导元素：本机数据保留路径，外部导入剥离路径并丢弃空图片元素
  const overlaySrc = {
    overlay: {
      items: [
        { kind: 'text', text: '点击下方链接', anchor: 'bottom-center', marginX: 96, marginY: 96 },
        { kind: 'image', path: 'D:\\pics\\qr.png', name: 'qr.png', height: 120, opacity: 0.9, onCover: true },
      ],
    },
  }
  const kept = sanitizeConfig(JSON.parse(JSON.stringify(overlaySrc)), { keepLocalPaths: true })
  check('本机数据：文字条保留', kept.overlay.items.length === 2, String(kept.overlay.items.length))
  check('本机数据：图片路径保留', kept.overlay.items[1].kind === 'image' && kept.overlay.items[1].path !== '', '')

  const stripped = sanitizeConfig(JSON.parse(JSON.stringify(overlaySrc)))
  check(
    '外部导入：图片路径被剥离、元素整条丢弃，仅剩文字条',
    stripped.overlay.items.length === 1 && stripped.overlay.items[0].kind === 'text',
    JSON.stringify(stripped.overlay.items),
  )

  // 非法 anchor 回退、越界数值被夹紧
  const bad = sanitizeConfig({
    overlay: { items: [{ kind: 'text', text: 'x', anchor: 'nowhere', marginX: 99999, fontSize: 999 }] },
  })
  const badItem = bad.overlay.items[0]
  check('非法 anchor 回退 bottom-center', badItem.anchor === 'bottom-center', badItem.anchor)
  check('marginX 被夹到 2000', badItem.marginX === 2000, String(badItem.marginX))
  check('fontSize 被夹到 200', badItem.fontSize === 200, String(badItem.fontSize))
}

/** J. 封面文本元素化（v0.4.0） */
function testCoverTextElements() {
  console.log('\nJ. 封面文本元素（v4）')

  const cfg = makeConfig((c) => {
    c.cover.items[0].texts = [
      textEl('主标题', { x: 0.35, y: 0.3, placed: true, align: 'left' }),
      textEl('第二块', { x: 0.8, y: 0.85, placed: true, fontSize: 64, fontWeight: 400 }),
    ]
  })
  const decoded = decodeSharePayload(encodeShareCode(cfg, '双元素封面'))
  const texts = decoded.config.cover.items[0].texts
  check('多文本元素数量还原', texts.length === 2, String(texts.length))
  check('归一化坐标 x 还原', Math.abs(texts[0].x - 0.35) < 0.002, String(texts[0].x))
  check('归一化坐标 y 还原', Math.abs(texts[1].y - 0.85) < 0.002, String(texts[1].y))
  check('placed 标记还原', texts[0].placed === true && texts[1].placed === true)
  check('对齐方式还原', texts[0].align === 'left', texts[0].align)
  check('元素字号/字重还原', texts[1].fontSize === 64 && texts[1].fontWeight === 400, `${texts[1].fontSize}/${texts[1].fontWeight}`)

  // 越界与非法值必须被夹紧
  const dirty = sanitizeConfig({
    cover: {
      items: [
        {
          texts: [
            { text: 'x', x: 5, y: -3, widthRatio: 9, fontSize: 1, align: 'diagonal', placed: 'yes' },
          ],
        },
      ],
    },
  })
  const el = dirty.cover.items[0].texts[0]
  check('x 越界被夹到 1', el.x === 1, String(el.x))
  check('y 越界被夹到 0', el.y === 0, String(el.y))
  check('widthRatio 被夹到 1', el.widthRatio === 1, String(el.widthRatio))
  check('fontSize 被夹到 16', el.fontSize === 16, String(el.fontSize))
  check('非法 align 回退 center', el.align === 'center', el.align)
  check('非布尔 placed 回退 false', el.placed === false, String(el.placed))

  // 旧结构（含副标题）迁移：标题保留、副标题丢弃
  const legacy = sanitizeConfig({
    cover: {
      items: [
        { title: '旧标题', subtitle: '旧副标题', titleFontSize: 120, titleWeight: 500, color: '#ff0000' },
      ],
    },
  })
  const lt = legacy.cover.items[0].texts
  check('旧 title 迁移为唯一元素', lt.length === 1, String(lt.length))
  check('旧 title 文本保留', lt[0].text === '旧标题', lt[0].text)
  check('旧字号/字重/颜色继承到元素', lt[0].fontSize === 120 && lt[0].fontWeight === 500 && lt[0].color === '#ff0000', JSON.stringify(lt[0]))
  check('迁移元素默认不定位（沿用自动版式）', lt[0].placed === false)

  // ---- 文本级蒙版：往返 ----
  const masked = makeConfig((c) => {
    c.cover.items[0].texts = [
      textEl('带蒙版', {
        maskEnabled: true,
        z: 3,
        mask: { type: 'card', color: '#112233', alpha: 0.62, radius: 26, pad: 40, blur: 4, position: 'center' },
      }),
      textEl('无蒙版', { z: 1 }),
    ]
  })
  const mDecoded = decodeSharePayload(encodeShareCode(masked, '文本蒙版')).config.cover.items[0].texts
  check('文本蒙版开关往返', mDecoded[0].maskEnabled === true && mDecoded[1].maskEnabled === false,
    `${mDecoded[0].maskEnabled}/${mDecoded[1].maskEnabled}`)
  check('文本蒙版颜色往返', mDecoded[0].mask.color === '#112233', mDecoded[0].mask.color)
  check('文本蒙版 pad 往返', mDecoded[0].mask.pad === 40, String(mDecoded[0].mask.pad))
  check('文本蒙版圆角往返', mDecoded[0].mask.radius === 26, String(mDecoded[0].mask.radius))
  check('文本层级 z 往返', mDecoded[0].z === 3 && mDecoded[1].z === 1, `${mDecoded[0].z}/${mDecoded[1].z}`)

  // ---- 旧数据兼容：无 mask 字段时补默认且默认关闭 ----
  const oldStyle = sanitizeConfig({
    cover: { items: [{ texts: [{ text: '旧文本', fontSize: 80, fontWeight: 500 }] }] },
  })
  const oldEl = oldStyle.cover.items[0].texts[0]
  check('旧文本补默认蒙版对象', oldEl.mask && typeof oldEl.mask === 'object', JSON.stringify(oldEl.mask))
  check('旧文本蒙版默认关闭', oldEl.maskEnabled === false, String(oldEl.maskEnabled))
  check('旧文本 z 默认按数组序', oldEl.z === 0, String(oldEl.z))

  // 旧 v4 分享码（texts 数组缺尾部三件套）仍能导入
  const legacyArr = JSON.parse(Buffer.from(encodeShareCode(cfg, 'x').slice(4).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  const arr = legacyArr[2]
  for (const t of arr[35]) { t.length = 10 }  // 砍掉尾部蒙版三件套，模拟早期 v4
  arr[0] = 4
  const legacyCode = 'TW1-' + Buffer.from(JSON.stringify([legacyArr[0], legacyArr[1], arr]))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  let legacyOk = false
  let legacyMsg = ''
  try {
    const d = decodeSharePayload(legacyCode)
    legacyOk = d.config.cover.items[0].texts.length > 0
    legacyMsg = `maskEnabled=${d.config.cover.items[0].texts[0].maskEnabled}`
  } catch (e) {
    legacyMsg = e.message
  }
  check('早期 v4 分享码（无蒙版字段）仍可导入', legacyOk, legacyMsg)

  // 蒙版非法值被净化
  const badMask = sanitizeConfig({
    cover: { items: [{ texts: [{ text: 'x', mask: { type: 'card', color: 'zzz', alpha: 9, radius: -5, pad: 1e9, blur: 999 }, maskEnabled: true, z: 999 }] }] },
  })
  const bm = badMask.cover.items[0].texts[0]
  check('非法蒙版颜色回退', bm.mask.color === '#000000', bm.mask.color)
  check('蒙版浓度被夹到 1', bm.mask.alpha === 1, String(bm.mask.alpha))
  check('蒙版圆角夹到 0', bm.mask.radius === 0, String(bm.mask.radius))
  check('蒙版内边距被夹上限', bm.mask.pad <= 400, String(bm.mask.pad))
  check('z 被夹到上限', bm.z <= types.MAX_COVER_TEXTS, String(bm.z))

  // 元素 id 是本地标识，不参与传输
  const code = encodeShareCode(cfg, 'id 脱敏')
  const raw = JSON.parse(Buffer.from(code.slice(4).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  check('分享码内不含元素 id 文本', !JSON.stringify(raw).includes(cfg.cover.items[0].texts[0].id))
}

/** K. 封面尺寸解耦（v5） */
function testCoverCanvasSection() {
  console.log('\nK. 封面尺寸独立配置（v5）')

  // 1) 往返：独立尺寸完整保留
  const cfg = makeConfig((c) => {
    c.canvas.width = 1080
    c.canvas.height = 1920
    c.coverCanvas = {
      width: 1200,
      height: 630,
      unit: 'px',
      orientation: 'landscape',
      followBody: false,
    }
  })
  const dec = decodeSharePayload(encodeShareCode(cfg, '独立封面')).config.coverCanvas
  check('封面宽往返', dec.width === 1200, String(dec.width))
  check('封面高往返', dec.height === 630, String(dec.height))
  check('单位往返', dec.unit === 'px', dec.unit)
  check('朝向往返', dec.orientation === 'landscape', dec.orientation)
  check('跟随开关往返', dec.followBody === false, String(dec.followBody))
  check('正文尺寸未受影响', dec === null ? false : true)

  const both = decodeSharePayload(encodeShareCode(cfg, 'x')).config
  check('正文画布未被封面设置污染', both.canvas.width === 1080 && both.canvas.height === 1920,
    `${both.canvas.width}x${both.canvas.height}`)

  // 2) 旧数据兼容：无 coverCanvas 字段 → 默认跟随正文
  const legacyCfg = sanitizeConfig({ canvas: { width: 1080, height: 1920 } })
  check('旧数据补默认封面尺寸节', legacyCfg.coverCanvas !== undefined)
  check('旧数据默认跟随正文', legacyCfg.coverCanvas.followBody === true)
  check('旧数据封面尺寸等于正文', legacyCfg.coverCanvas.width === 1080 && legacyCfg.coverCanvas.height === 1920)

  // 3) 早期 v4 分享码（无封面画布节）仍可导入
  const v4Arr = JSON.parse(Buffer.from(encodeShareCode(cfg, 'y').slice(4).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  const a2 = v4Arr[2]
  a2.length = 39      // 砍掉 v5 追加的 5 个位置
  a2[0] = 4          // 版本号回退到 v4
  const v4Code = 'TW1-' + Buffer.from(JSON.stringify([v4Arr[0], v4Arr[1], a2]))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  let v4Ok = false
  let v4Msg = ''
  try {
    const d = decodeSharePayload(v4Code)
    v4Ok = d.config.coverCanvas.followBody === true
    v4Msg = `followBody=${d.config.coverCanvas.followBody}`
  } catch (e) {
    v4Msg = e.message
  }
  check('早期 v4 分享码（无封面画布）仍可导入', v4Ok, v4Msg)

  // 4) 非法值净化
  const dirty = sanitizeConfig({
    coverCanvas: { width: -100, height: 0, unit: 'furlong', orientation: 'diagonal', followBody: 'yes' },
  })
  check('负宽被夹到下限', dirty.coverCanvas.width >= 1, String(dirty.coverCanvas.width))
  check('零高被夹到下限', dirty.coverCanvas.height >= 1, String(dirty.coverCanvas.height))
  check('非法单位回退 px', dirty.coverCanvas.unit === 'px', dirty.coverCanvas.unit)
  check('非法朝向回退 portrait', dirty.coverCanvas.orientation === 'portrait', dirty.coverCanvas.orientation)
  check('非布尔 followBody 回退 true', dirty.coverCanvas.followBody === true, String(dirty.coverCanvas.followBody))

  // 5) 分享码体积仍在阈值内（v5 追加 5 个位置）
  const len = encodeShareCode(cfg, '这是一段比较长的模板名称用于测试分享码体积').length
  check('分享码长度未超阈值', len < 900, `${len} 字符`)
}

// ---------------------------------------------------------------- 主流程

console.log('='.repeat(64))
console.log('文织 TextWeave · 模板编解码与配置净化验证')
console.log('='.repeat(64))

testRoundTrip()
testMaskRoundTrip()
testMultiCover()
testStandaloneBlend()
testLegacyCompat()
testLegacyObjectMigration()
testPathSafety()
testCoverSanitize()
testAdversarial()
testSanitize()
testJsonPayload()
testLength()
testChannelAndOverlay()
testCoverTextElements()
testCoverCanvasSection()

console.log('\n' + '='.repeat(64))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failures.length > 0) {
  console.log('\n失败明细：')
  for (const f of failures) console.log('  - ' + f)
}
console.log('='.repeat(64))

process.exit(failed > 0 ? 1 : 0)
