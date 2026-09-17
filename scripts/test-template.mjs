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
    execFileSync(process.execPath, [tscEntry, ...args], { cwd: FRONTEND, stdio: 'pipe' })
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
  c.text.fontPath = ''
  c.cover.activeId = ''
  for (const item of c.cover.items) {
    // 封面 id 是本地标识，导入时重新生成
    item.id = ''
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
    c.cover.items[0].title = '把长文变成系列图'
    c.cover.items[0].subtitle = '一篇 3000 字的文章 = 10 张统一风格的图'
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

function makeCover(overrides) {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    title: '标题',
    subtitle: '',
    titleFontSize: 96,
    titleWeight: 700,
    layout: 'center',
    color: '',
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
        makeCover({ title: '第一张封面', subtitle: '系列之一' }),
        makeCover({
          title: '第二张封面',
          titleFontSize: 120,
          titleWeight: 400,
          layout: 'bottom',
          color: '#FFCC00',
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
        makeCover({ title: '第三张（停用）', enabled: false }),
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
  check('标题颜色被还原', b.color === '#FFCC00', String(b.color))
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
  check('封面标题被正确迁移', cover.title === '旧版封面标题', cover.title)
  check('封面副标题被正确迁移', cover.subtitle === '旧版副标题', cover.subtitle)
  check('封面色号被正确迁移', cover.titleFontSize === 88, String(cover.titleFontSize))
  check('封面字重被正确迁移', cover.titleWeight === 500, String(cover.titleWeight))
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
  check('标题被迁移', item.title === '对象版标题', item.title)
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
  check('字号被夹到 300', item.titleFontSize === 300, String(item.titleFontSize))
  check('字重非法值回退 700', item.titleWeight === 700, String(item.titleWeight))
  check('版面非法值回退 center', item.layout === 'center', item.layout)
  check('非法标题颜色回退为空（跟随正文）', item.color === '', JSON.stringify(item.color))
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

  check('封面字重回退 700', clean.cover.items[0].titleWeight === 700, String(clean.cover.items[0].titleWeight))
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
    c.cover.items[0].title = '带引号"和换行\n的标题'
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
    decoded.config.cover.items[0].title === cfg.cover.items[0].title,
    JSON.stringify(decoded.config.cover.items[0].title),
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
        c.cover.items[0].title = '这是一段较长的封面标题用于测试体积'
        c.cover.items[0].subtitle = '副标题也写长一点，看看分享码会膨胀到什么程度'
        c.mask = { type: 'gradient', direction: 'both', color: '#0B1220', maxAlpha: 0.9, solidRatio: 0.1, transparentRatio: 0.6 }
      }),
    ],
    [
      '三张封面（含专属背景参数）',
      makeConfig((c) => {
        c.cover.items = [
          makeCover({ title: '封面一' }),
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
          makeCover({ title: '封面三', layout: 'bottom' }),
        ]
      }),
    ],
  ]

  for (const [name, cfg] of samples) {
    const len = encodeShareCode(cfg, '模板名').length
    check(`${name}：${len} 字符（阈值 900）`, len < 900, String(len))
  }
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

console.log('\n' + '='.repeat(64))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
if (failures.length > 0) {
  console.log('\n失败明细：')
  for (const f of failures) console.log('  - ' + f)
}
console.log('='.repeat(64))

process.exit(failed > 0 ? 1 : 0)
