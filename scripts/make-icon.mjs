#!/usr/bin/env node
/**
 * 生成应用图标（Windows .ico / macOS .icns / Wails 用的 appicon.png）。
 *
 * 图形来源见 build/icon/README.md —— Lucide 的 `gallery-horizontal-end`，
 * ISC 许可，可商用、无需署名。
 *
 * 两个关键做法：
 *
 * 1. **每个尺寸单独光栅化**，而不是从 1024px 缩下去。
 *    SVG 按目标尺寸重新渲染能保持描边锐利，缩小则会糊成一团。
 *
 * 2. **小尺寸单独一套参数**。原图是 24px 网格 / 2px 描边，直接等比缩到
 *    16px 时描边只有 0.7px，几乎看不见。因此 < 48px 时加粗描边并放大图形，
 *    这是专业图标集的通行做法。
 *
 * 用法：node scripts/make-icon.mjs
 * 依赖：sharp（frontend 的 devDependency）
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICON_DIR = path.join(ROOT, 'build', 'icon')
/** 完整版图形（32px 及以上） */
const GLYPH_FULL = path.join(ICON_DIR, 'app-icon.svg')
/** 简化版图形（24px 及以下），小尺寸单独出图是专业图标集的通行做法 */
const GLYPH_SMALL = path.join(ICON_DIR, 'app-icon-small.svg')
const BUILD_DIR = path.join(ROOT, 'build')

// ---------------------------------------------------------------- 加载 sharp

const require = createRequire(path.join(ROOT, 'frontend', '__icon.js'))

function loadSharp() {
  const candidates = [
    () => require('sharp'),
    () => createRequire(path.join(ROOT, 'node_modules', '__icon.js'))('sharp'),
  ]
  for (const load of candidates) {
    try {
      return load()
    } catch {
      // 试下一个位置
    }
  }
  console.error(
    '未找到 sharp。请先执行：\n  cd frontend && npm install\n' +
      '若仍失败，可临时安装：npm install --no-save sharp',
  )
  process.exit(1)
}

const sharp = loadSharp()

// ---------------------------------------------------------------- 图标参数

/** 品牌渐变（与界面主色一致） */
const GRADIENT_FROM = '#4F8CFF'
const GRADIENT_TO = '#2450D8'

/** 圆角半径占边长比例，接近 macOS squircle 的观感 */
const RADIUS_RATIO = 0.224

/**
 * 分档渲染参数。
 *
 * 原设计是 24px 网格。等比缩到 16px 时描边只剩 0.7px，画面会糊成一团，
 * 所以做两件事：
 *   1. 尺寸越小，图形越大、描边越粗 —— 保证每个特征占够像素；
 *   2. 24px 及以下换成**简化版图形**（去掉后卡竖杠、减少文字线），
 *      因为完整版的细节密度在小尺寸下必然糊。
 * 这是专业图标集的通行做法：小尺寸单独出图，而不是把大图缩下去。
 */
function profile(size) {
  if (size <= 16) {
    return { glyph: 'small', glyphRatio: 0.92, strokeWidth: 3.2 }
  }
  if (size <= 24) {
    return { glyph: 'small', glyphRatio: 0.86, strokeWidth: 3 }
  }
  if (size < 48) {
    return { glyph: 'full', glyphRatio: 0.84, strokeWidth: 3 }
  }
  return { glyph: 'full', glyphRatio: 0.7, strokeWidth: 2.25 }
}

/** 从原始 SVG 中抽出图形主体（path / rect / defs 等），去掉外层 <svg> */
function extractGlyph(svgText) {
  const inner = svgText.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
  return inner.trim()
}

const GLYPHS = {
  full: extractGlyph(readFileSync(GLYPH_FULL, 'utf8')),
  small: extractGlyph(readFileSync(GLYPH_SMALL, 'utf8')),
}

/** 生成指定尺寸的图标 SVG */
function iconSvg(size) {
  const p = profile(size)
  const glyph = GLYPHS[p.glyph]
  const k = (size * p.glyphRatio) / 24
  const r = Math.round(size * RADIUS_RATIO)
  const half = size / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GRADIENT_FROM}"/>
      <stop offset="1" stop-color="${GRADIENT_TO}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  <g transform="translate(${half},${half}) scale(${k}) translate(-12,-12)"
     fill="none" stroke="#ffffff" stroke-width="${p.strokeWidth}"
     stroke-linecap="round" stroke-linejoin="round">
    ${glyph}
  </g>
</svg>`
}

/** 把图标渲染为 PNG Buffer */
async function renderPng(size) {
  return sharp(Buffer.from(iconSvg(size)), { density: 72 })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

// ---------------------------------------------------------------- ICO

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * 组装 ICO 文件。
 * Vista 起支持内嵌 PNG，因此无需转成 BMP，直接塞 PNG 即可（且保留透明通道）。
 */
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const payloads = []

  entries.forEach((entry, i) => {
    const at = i * 16
    // 256 在 ICO 目录里用 0 表示
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0)
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)
    dir.writeUInt8(0, at + 2) // 调色板数
    dir.writeUInt8(0, at + 3) // 保留
    dir.writeUInt16LE(1, at + 4) // 色彩平面
    dir.writeUInt16LE(32, at + 6) // 位深
    dir.writeUInt32LE(entry.data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += entry.data.length
    payloads.push(entry.data)
  })

  return Buffer.concat([header, dir, ...payloads])
}

// ---------------------------------------------------------------- ICNS

/**
 * ICNS 分块类型与尺寸的对应关系。
 * ic07~ic10 是 1x 尺寸，ic11~ic14 是对应的 @2x 版本。
 */
const ICNS_TYPES = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic08', 256],
]

function buildIcns(bySize) {
  const chunks = []
  for (const [type, size] of ICNS_TYPES) {
    const data = bySize.get(size)
    if (!data) continue
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(8 + data.length, 4)
    chunks.push(Buffer.concat([head, data]))
  }

  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

// ---------------------------------------------------------------- 主流程

async function main() {
  for (const p of [GLYPH_FULL, GLYPH_SMALL]) {
    if (!existsSync(p)) {
      console.error(`缺少图形源文件：${p}`)
      process.exit(1)
    }
  }

  mkdirSync(BUILD_DIR, { recursive: true })
  mkdirSync(path.join(BUILD_DIR, 'windows'), { recursive: true })
  mkdirSync(path.join(BUILD_DIR, 'darwin'), { recursive: true })

  // 1024 主图：Wails 构建时作为图标源
  const master = await renderPng(1024)
  const masterPath = path.join(BUILD_DIR, 'appicon.png')
  writeFileSync(masterPath, master)
  console.log(`appicon.png       1024×1024  ${(master.length / 1024).toFixed(1)} KB`)

  // Windows ICO
  const icoEntries = []
  for (const size of ICO_SIZES) {
    icoEntries.push({ size, data: await renderPng(size) })
  }
  const ico = buildIco(icoEntries)
  const icoPath = path.join(BUILD_DIR, 'windows', 'icon.ico')
  writeFileSync(icoPath, ico)
  console.log(
    `windows/icon.ico  ${ICO_SIZES.join('/')}  ${(ico.length / 1024).toFixed(1)} KB`,
  )

  // macOS ICNS
  const icnsSizes = [...new Set(ICNS_TYPES.map(([, s]) => s))].sort((a, b) => a - b)
  const bySize = new Map()
  for (const size of icnsSizes) {
    bySize.set(size, await renderPng(size))
  }
  const icns = buildIcns(bySize)
  const icnsPath = path.join(BUILD_DIR, 'darwin', 'icons.icns')
  writeFileSync(icnsPath, icns)
  console.log(
    `darwin/icons.icns  ${icnsSizes.join('/')}  ${(icns.length / 1024).toFixed(1)} KB`,
  )

  // 预览图：方便人工核对各尺寸实际观感
  const previewDir = path.join(BUILD_DIR, 'icon', 'preview')
  mkdirSync(previewDir, { recursive: true })
  for (const size of [256, 128, 64, 32, 24, 16]) {
    writeFileSync(path.join(previewDir, `icon-${size}.png`), await renderPng(size))
  }
  console.log(`icon/preview/     ${[256, 128, 64, 32, 24, 16].join('/')}`)

  console.log('\n完成。')
}

main().catch((e) => {
  console.error('生成图标失败：', e)
  process.exit(1)
})
