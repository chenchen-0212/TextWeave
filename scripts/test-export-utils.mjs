#!/usr/bin/env node
/**
 * 导出工具验证（优化项 O-01 / O-02 的基础层）。
 *
 * 覆盖 utils/filename.ts：
 *   A. 文件名模板变量（{index}/{total}/{title}/{date}/{book}/{channel}/{size}）
 *   B. 文件名净化（非法字符、长度上限、空值兜底）
 *   C. 子目录模板渲染（空段丢弃、层级上限、路径穿越防护）
 *   D. 目录拼接（分隔符归一、空段处理）
 *
 * 用法：node scripts/test-export-utils.mjs
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = path.join(ROOT, 'frontend')
const OUT_DIR = path.join(ROOT, '.tmp', 'export-test')

// ---------------------------------------------------------------- 编译

function compile() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const args = [
    'src/utils/filename.ts',
    '--outDir', OUT_DIR,
    '--rootDir', 'src',
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--skipLibCheck',
    '--esModuleInterop',
    '--strict', 'false',
  ]

  const tscEntry = path.join(FRONTEND, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tscEntry)) {
    console.error(`未找到 TypeScript，请先在 frontend 目录执行 npm install\n  期望路径：${tscEntry}`)
    process.exit(1)
  }

  try {
    execFileSync(process.execPath, [tscEntry, ...args], { cwd: FRONTEND, stdio: 'pipe' })
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '')
    console.error('导出工具编译失败：\n' + out)
    process.exit(1)
  }

  writeFileSync(path.join(OUT_DIR, 'package.json'), '{"type":"commonjs"}\n')
}

// ---------------------------------------------------------------- 用例

const requireFromOut = createRequire(path.join(OUT_DIR, '__entry.js'))

compile()

const f = requireFromOut('./utils/filename.js')

let passed = 0
let failed = 0
const failures = []

function check(name, actual, expected) {
  const ok = actual === expected
  if (ok) {
    passed++
  } else {
    failed++
    failures.push(`✗ ${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`)
  }
}

const DATE = new Date(2026, 8, 18)

// A. 模板变量
check('A1 默认模板 {index}',
  f.renderFilenameTemplate('', { index: 1, total: 8, title: '', date: DATE, pad: 2 }),
  '01')
check('A2 序号补零',
  f.renderFilenameTemplate('{index}', { index: 7, total: 8, title: '', date: DATE, pad: 3 }),
  '007')
check('A3 组合变量',
  f.renderFilenameTemplate('{book}-{channel}-{size}-{index}',
    { index: 2, total: 8, title: '', date: DATE, pad: 2, book: '断桥残雪', channel: '抖音', size: '小红书 3:4' }),
  '断桥残雪-抖音-小红书 34-02')
check('A4 date 格式',
  f.renderFilenameTemplate('{date}', { index: 1, total: 1, title: '', date: DATE, pad: 1 }),
  '20260918')
check('A5 title 净化并截断 40 字',
  f.renderFilenameTemplate('{title}', { index: 1, total: 1, title: 'a'.repeat(50), date: DATE, pad: 1 }),
  'a'.repeat(40))
check('A6 缺省 book/channel/size 变量为空串',
  f.renderFilenameTemplate('tw-{book}-{index}', { index: 3, total: 5, title: '', date: DATE, pad: 1 }),
  'tw--3')

// B. 净化
check('B1 非法字符被剥离',
  f.renderFilenameTemplate('{book}', { index: 1, total: 1, title: '', date: DATE, pad: 1, book: 'a/b\\c:d*e?f"g<h>i|j' }),
  'abcdefghij')
check('B2 全非法时回退到序号',
  f.renderFilenameTemplate('{book}', { index: 4, total: 9, title: '', date: DATE, pad: 2, book: '???' }),
  '04')
check('B3 buildFilename 带扩展名',
  f.buildFilename('{index}', { index: 1, total: 1, title: '', date: DATE, pad: 2 }, 'png'),
  '01.png')
check('B4 extForFormat',
  f.extForFormat('jpeg') + ',' + f.extForFormat('webp') + ',' + f.extForFormat('png'),
  'jpg,webp,png')

// C. 子目录模板
const SV = (book, channel, size) => ({ book, channel, size, date: DATE })
check('C1 两层子目录',
  f.renderSubfolder('{book}/{channel}', SV('书名', '抖音', '')),
  '书名/抖音')
check('C2 空段丢弃',
  f.renderSubfolder('{book}/{channel}', SV('', '抖音', '')),
  '抖音')
check('C3 空模板返回空串',
  f.renderSubfolder('', SV('书名', '抖音', '')),
  '')
check('C4 路径穿越防护',
  f.renderSubfolder('../{book}/..', SV('书名', '', '')),
  '书名')
check('C5 非法字符按层净化',
  f.renderSubfolder('{size}/{book}', SV('a:b', '', '9:16')),
  '916/ab')
check('C6 最多 4 层',
  f.renderSubfolder('a/b/c/d/e/f', SV('', '', '')),
  'a/b/c/d')
check('C7 size 进入子目录',
  f.renderSubfolder('{book}/{size}', SV('书名', '', '方图')),
  '书名/方图')

// D. 目录拼接
check('D1 基础拼接',
  f.joinDir('D:\\out', '书名/抖音'),
  'D:\\out/书名/抖音')
check('D2 base 尾部分隔符去重',
  f.joinDir('D:\\out\\', '书名'),
  'D:\\out/书名')
check('D3 空 sub 原样返回',
  f.joinDir('D:\\out', ''),
  'D:\\out')
check('D4 反斜杠子路径归一',
  f.joinDir('D:\\out', 'a\\b'),
  'D:\\out/a/b')

// ---------------------------------------------------------------- 汇总

if (failures.length > 0) {
  console.error(failures.join('\n'))
}
console.log(`导出工具验证：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
