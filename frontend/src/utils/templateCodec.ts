import type {
  BlendMode,
  CardMask,
  CoverBackground,
  CoverItem,
  CoverSet,
  GradientMask,
  MaskConfig,
  MaskType,
  StyleConfig,
  TemplateSharePayload,
  VeilMask,
} from '../types'
import {
  MAX_COVERS,
  MAX_EXPORT_SIZES,
  MAX_OVERLAY_ITEMS,
  SHARE_CODE_PREFIX,
  SHARE_PAYLOAD_VERSION,
  defaultConfig,
  defaultCoverBackground,
  defaultCoverItem,
  defaultCoverMask,
  defaultMaskOfType,
} from '../types'

/**
 * 模板编解码与配置净化。
 *
 * 设计要点：
 *
 * 1. **单一校验闸门** —— localStorage 读取、分享码导入、JSON 文件导入三条路径
 *    全部经过 `sanitizeConfig()`。绝不各自实现一套校验，否则规则迟早漂移，
 *    而「导入一份来路不明的配置」恰恰是最容易把应用搞崩的地方。
 *
 * 2. **分享码用位置数组而非对象** —— 配置里字段名重复度极高（brightness、
 *    contrast 之类），对象形式光键名就要占掉一半体积。改成固定顺序的数组 +
 *    枚举短码映射后，一个典型配置的分享码在 400 字符上下，可以直接粘贴到聊天窗口。
 *
 * 3. **不分享本地路径** —— 字体文件路径与输出目录是机器相关的，
 *    分享出去在别人机器上必然失效，因此不进分享载荷。
 */

// ---------------------------------------------------------------- 枚举短码

type EnumMap = Record<string, string>

const FILL_MODE: EnumMap = { cover: 'c', contain: 'o', stretch: 's' }
const FORMAT: EnumMap = { png: 'p', jpeg: 'j', webp: 'w' }
const ALIGN: EnumMap = { left: 'l', justify: 'j', center: 'c' }
const MASK_TYPE: EnumMap = { card: 'c', veil: 'v', gradient: 'g' }
const GRADIENT_DIR: EnumMap = { top: 't', bottom: 'b', both: 'x' }
const CARD_POS: EnumMap = { stretchToFill: 's', center: 'c', top: 't', bottom: 'b' }
const COVER_LAYOUT: EnumMap = { center: 'c', top: 't', bottom: 'b' }
const FONT_SOURCE: EnumMap = { system: 's', user: 'u' }
const BLEND: EnumMap = {
  normal: 'n',
  multiply: 'm',
  screen: 's',
  overlay: 'o',
  'soft-light': 'l',
  darken: 'd',
  lighten: 'h',
  color: 'k',
  // 'x' 为 v3 时代新增的「独立不叠加」。短码追加在尾部，
  // 旧版解码器遇到未知短码会回退 fallback，不会错位
  standalone: 'x',
}
const PRESET: EnumMap = {
  custom: '0',
  'phone-9x16': '1',
  'phone-195x9': '2',
  'phone-iphone': '3',
  'phone-2k': '4',
}

function enc(map: EnumMap, value: string, fallback: string): string {
  const hit = map[value]
  return hit === undefined ? fallback : hit
}

function dec(map: EnumMap, value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  for (const key of Object.keys(map)) {
    if (map[key] === value) return key
  }
  return fallback
}

// ---------------------------------------------------------------- 净化辅助

function num(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

function int(value: unknown, def: number, min: number, max: number): number {
  return Math.round(num(value, def, min, max))
}

function str(value: unknown, def: string, maxLen = 200): string {
  if (typeof value !== 'string') return def
  return value.slice(0, maxLen)
}

function bool(value: unknown, def: boolean): boolean {
  return typeof value === 'boolean' ? value : def
}

/** 从白名单里挑值，不在白名单内一律回退到默认值 */
function pick<T extends string | number>(value: unknown, allowed: readonly T[], def: T): T {
  const list = allowed as readonly (string | number)[]
  return typeof value === 'string' || typeof value === 'number'
    ? list.includes(value)
      ? (value as T)
      : def
    : def
}

/** 只接受完整的 6 位十六进制颜色，其余一律回退，避免把非法值喂给 canvas */
function color(value: unknown, def: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : def
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// ---------------------------------------------------------------- 配置净化

/**
 * 把任意来路的输入净化为一份合法可用的完整配置。
 *
 * 所有字段都会被裁剪到合法区间，缺失字段用默认值补齐。
 * 这是唯一的安全入口：localStorage、分享码、JSON 文件都走这里。
 *
 * @param keepLocalPaths 是否保留本机文件路径（字体文件、封面背景图）。
 *   **默认 false**：分享码与外部导入一律丢弃路径，既是安全考虑（防路径注入），
 *   也因为别人机器上的路径本来就没有意义。
 *   只有在处理**本机数据**时才传 true —— 本地模板库读取、当前配置快照、应用本地模板。
 */
export function sanitizeConfig(
  raw: unknown,
  opts: { keepLocalPaths?: boolean } = {},
): StyleConfig {
  const keepPaths = opts.keepLocalPaths === true
  const d = defaultConfig()
  const src = obj(raw)

  const c = obj(src.canvas)
  const b = obj(src.background)
  const t = obj(src.text)
  const ct = obj(src.constraint)
  const ex = obj(src.export)

  const canvas: StyleConfig['canvas'] = {
    preset: pick(
      c.preset,
      ['custom', 'phone-9x16', 'phone-195x9', 'phone-iphone', 'phone-2k'],
      d.canvas.preset,
    ),
    width: int(c.width, d.canvas.width, 200, 8000),
    height: int(c.height, d.canvas.height, 200, 8000),
    scale: int(c.scale, d.canvas.scale, 1, 3),
    format: pick(c.format, ['png', 'jpeg', 'webp'], d.canvas.format),
    quality: num(c.quality, d.canvas.quality, 0.5, 1),
  }

  const background: StyleConfig['background'] = {
    fillMode: pick(b.fillMode, ['cover', 'contain', 'stretch'], d.background.fillMode),
    brightness: num(b.brightness, d.background.brightness, 0.3, 2),
    contrast: num(b.contrast, d.background.contrast, 0.3, 2),
    saturate: num(b.saturate, d.background.saturate, 0, 2),
    blur: num(b.blur, d.background.blur, 0, 40),
    vignette: num(b.vignette, d.background.vignette, 0, 1),
    offsetX: num(b.offsetX, d.background.offsetX, -1, 1),
    offsetY: num(b.offsetY, d.background.offsetY, -1, 1),
  }

  const mask = sanitizeMask(src.mask, d.mask)

  const text: StyleConfig['text'] = {
    fontFamily: str(t.fontFamily, d.text.fontFamily, 100),
    fontSource: pick(t.fontSource, ['system', 'user'], d.text.fontSource),
    // 字体路径是机器相关的，只有处理本机数据时才保留，避免外部载荷指向任意文件
    fontPath: keepPaths ? str(t.fontPath, '', 500) : '',
    fontSize: int(t.fontSize, d.text.fontSize, 16, 200),
    fontWeight: pick(t.fontWeight, [300, 400, 500, 700] as const, 400),
    color: color(t.color, d.text.color),
    lineHeightRatio: num(t.lineHeightRatio, d.text.lineHeightRatio, 1.2, 2.5),
    letterSpacing: num(t.letterSpacing, d.text.letterSpacing, -2, 10),
    paragraphSpacingRatio: num(
      t.paragraphSpacingRatio,
      d.text.paragraphSpacingRatio,
      0,
      2,
    ),
    textAlign: pick(t.textAlign, ['left', 'justify', 'center'], d.text.textAlign),
    textIndent: num(t.textIndent, d.text.textIndent, 0, 4),
    padding: int(t.padding, d.text.padding, 0, 400),
    minOrphanLines: int(t.minOrphanLines, d.text.minOrphanLines, 1, 5),
  }

  const cover = sanitizeCoverSet(src.cover, keepPaths)

  const constraint: StyleConfig['constraint'] = {
    enable: bool(ct.enable, d.constraint.enable),
    // 下限至少要 1，上限不能小于下限
    minPages: int(ct.minPages, d.constraint.minPages, 1, 100),
    maxPages: int(ct.maxPages, d.constraint.maxPages, 1, 200),
  }
  if (constraint.maxPages < constraint.minPages) {
    constraint.maxPages = constraint.minPages
  }

  const exportCfg: StyleConfig['export'] = {
    // 输出目录同样是本机路径，只在处理本机数据时保留
    dir: keepPaths ? str(ex.dir, '', 1000) : '',
    filenameTemplate: str(ex.filenameTemplate, d.export.filenameTemplate, 120),
    alsoZip: bool(ex.alsoZip, d.export.alsoZip),
    pad: int(ex.pad, d.export.pad, 1, 5),
    book: str(ex.book, '', 60),
  }

  // 渠道节（v3 起随分享码传输）。兼容旧版 config.json：channel 字段曾挂在 export 下，
  // 迁移时作为缺失字段的回退来源。
  const cn = obj(src.channel)
  const legacyChannel = str(ex.channel, '', 60)
  const legacySubfolder = str(ex.subfolderPattern, '', 120)
  const channel: StyleConfig['channel'] = {
    name: str(cn.name, legacyChannel, 60),
    subfolderPattern: str(cn.subfolderPattern, legacySubfolder || d.channel.subfolderPattern, 120),
    sizes: sanitizeExportSizes(Array.isArray(cn.sizes) && cn.sizes.length > 0 ? cn.sizes : ex.sizes),
  }

  const overlay = sanitizeOverlay(src.overlay, keepPaths)

  return {
    canvas,
    background,
    mask,
    text,
    cover,
    constraint,
    export: exportCfg,
    channel,
    overlay,
  }
}

/** 净化多尺寸导出列表：逐项校验区间、按 id 去重、限量，非法输入整条丢弃。 */
function sanitizeExportSizes(raw: unknown): StyleConfig['channel']['sizes'] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StyleConfig['channel']['sizes'] = []
  for (const item of raw.slice(0, MAX_EXPORT_SIZES * 2)) {
    if (out.length >= MAX_EXPORT_SIZES) break
    const it = obj(item)
    const id = str(it.id, '', 60)
    const width = int(it.width, 0, 200, 8000)
    const height = int(it.height, 0, 200, 8000)
    if (!id || seen.has(id) || width < 200 || height < 200) continue
    seen.add(id)
    out.push({ id, label: str(it.label, id, 40) || id, width, height })
  }
  return out
}

/** 九宫格锚点合法值（与 types 的 OVERLAY_ANCHORS 保持一致） */
const OVERLAY_ANCHOR_VALUES = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const

/** 生成引导元素 id（净化可能把原 id 裁坏，需要兜底） */
function overlayId(rawId: unknown): string {
  return str(rawId, '', 60) || `ovl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 净化引导元素列表（N-03）。
 *
 * 图片路径是本机资源：只在处理本机数据时保留，外部导入一律剥离，
 * 剥离后 path 为空的图片元素视为无效整条丢弃（渲染无意义）。
 */
function sanitizeOverlay(raw: unknown, keepPaths: boolean): StyleConfig['overlay'] {
  const o = obj(raw)
  const list = Array.isArray(o.items) ? o.items : []
  const items: StyleConfig['overlay']['items'] = []

  for (const entry of list.slice(0, MAX_OVERLAY_ITEMS)) {
    const it = obj(entry)
    const base = {
      id: overlayId(it.id),
      enabled: bool(it.enabled, true),
      anchor: pick(it.anchor, OVERLAY_ANCHOR_VALUES, 'bottom-center' as const),
      marginX: int(it.marginX, 96, 0, 2000),
      marginY: int(it.marginY, 96, 0, 2000),
      onCover: bool(it.onCover, false),
    }

    if (it.kind === 'text' || it.kind === undefined) {
      // barColor 允许空串（无底条），非法颜色一律回退为空
      const bar = color(it.barColor, '')
      items.push({
        ...base,
        kind: 'text',
        text: str(it.text, '', 200),
        fontSize: int(it.fontSize, 34, 10, 200),
        fontWeight: pick(it.fontWeight, [300, 400, 500, 700] as const, 500),
        color: color(it.color, '#FFFFFF'),
        barColor: bar,
        barAlpha: num(it.barAlpha, 0.45, 0, 1),
      })
      continue
    }

    if (it.kind === 'image') {
      const path = keepPaths ? str(it.path, '', 500) : ''
      if (!path) continue
      items.push({
        ...base,
        kind: 'image',
        path,
        name: str(it.name, '', 120),
        height: int(it.height, 120, 16, 1000),
        opacity: num(it.opacity, 1, 0, 1),
      })
    }
  }

  return { items }
}

/**
 * 净化蒙版配置，同时保证形态与字段一致（切形态时不会残留上一个形态的字段）。
 *
 * 默认值的选取规则：形态与 fallback 相同就沿用 fallback —— 这一点很关键，
 * 因为封面蒙版的默认浓度（0.65）与正文蒙版（0.55）不同，
 * 一律取 defaultMaskOfType 会把封面的默认值抹平。
 */
function sanitizeMask(raw: unknown, fallback: MaskConfig): MaskConfig {
  const m = obj(raw)
  const type = pick(m.type, ['card', 'veil', 'gradient'], fallback.type)
  const base = type === fallback.type ? fallback : defaultMaskOfType(type as MaskType)

  if (type === 'card') {
    const card = base as CardMask
    return {
      type: 'card',
      color: color(m.color, card.color),
      alpha: num(m.alpha, card.alpha, 0, 1),
      radius: int(m.radius, card.radius, 0, 200),
      pad: int(m.pad, card.pad, 0, 400),
      blur: int(m.blur, card.blur, 0, 40),
      position: pick(
        m.position,
        ['stretchToFill', 'center', 'top', 'bottom'],
        card.position,
      ),
    }
  }

  if (type === 'veil') {
    const veil = base as VeilMask
    return {
      type: 'veil',
      color: color(m.color, veil.color),
      alpha: num(m.alpha, veil.alpha, 0, 1),
      topBoost: num(m.topBoost, veil.topBoost, 0, 1),
      bottomBoost: num(m.bottomBoost, veil.bottomBoost, 0, 1),
    }
  }

  const grad = base as GradientMask
  const direction = pick(m.direction, ['top', 'bottom', 'both'], grad.direction)
  const solidRatio = num(m.solidRatio, grad.solidRatio, 0, 0.9)
  // transparentRatio 必须严格大于 solidRatio，否则渐变区间为空
  const transparentRatio = num(
    m.transparentRatio,
    grad.transparentRatio,
    Math.min(0.95, solidRatio + 0.01),
    0.95,
  )
  return {
    type: 'gradient',
    direction,
    color: color(m.color, grad.color),
    maxAlpha: num(m.maxAlpha, grad.maxAlpha, 0, 1),
    solidRatio,
    transparentRatio: Math.max(transparentRatio, solidRatio + 0.01),
  }
}

// ---------------------------------------------------------------- 封面净化

const BLEND_KEYS = [
  'standalone',
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'darken',
  'lighten',
  'color',
] as const

/** 净化封面背景。路径仅在 keepPaths 时保留。 */
function sanitizeCoverBackground(raw: unknown, keepPaths: boolean): CoverBackground {
  const d = defaultCoverBackground()
  const o = obj(raw)
  return {
    useOwn: bool(o.useOwn, d.useOwn),
    path: keepPaths ? str(o.path, '', 500) : '',
    name: str(o.name, '', 120),
    fit: pick(o.fit, ['cover', 'contain', 'stretch'], d.fit),
    scale: num(o.scale, d.scale, 0.1, 5),
    offsetX: num(o.offsetX, d.offsetX, -1, 1),
    offsetY: num(o.offsetY, d.offsetY, -1, 1),
    opacity: num(o.opacity, d.opacity, 0, 1),
    blendMode: pick(o.blendMode, BLEND_KEYS, d.blendMode) as BlendMode,
    tintColor: color(o.tintColor, d.tintColor),
    tintAlpha: num(o.tintAlpha, d.tintAlpha, 0, 1),
    brightness: num(o.brightness, d.brightness, 0.3, 2),
    contrast: num(o.contrast, d.contrast, 0.3, 2),
    saturate: num(o.saturate, d.saturate, 0, 2),
    blur: num(o.blur, d.blur, 0, 40),
    vignette: num(o.vignette, d.vignette, 0, 1),
  }
}

function sanitizeCoverItem(raw: unknown, index: number, keepPaths: boolean): CoverItem {
  const d = defaultCoverItem(index + 1)
  const o = obj(raw)
  return {
    id: str(o.id, d.id, 64) || d.id,
    enabled: bool(o.enabled, true),
    title: str(o.title, d.title, 200),
    subtitle: str(o.subtitle, d.subtitle, 200),
    titleFontSize: int(o.titleFontSize, d.titleFontSize, 24, 300),
    titleWeight: pick(o.titleWeight, [400, 500, 700] as const, 700),
    layout: pick(o.layout, ['center', 'top', 'bottom'], d.layout),
    // 空串表示「沿用正文文字颜色」，需要与「非法颜色」区分开
    color: typeof o.color === 'string' && o.color ? color(o.color, '') : '',
    useOwnMask: bool(o.useOwnMask, false),
    mask: sanitizeMask(o.mask, defaultCoverMask()),
    background: sanitizeCoverBackground(o.background, keepPaths),
  }
}

/**
 * 净化封面集合，并把 v1 的单封面结构迁移过来。
 *
 * 迁移判断依据：v2 一定带 `items` 数组；只要对象上出现过 v1 的字段
 * （enable / title / useDifferentMask 等）就按单封面迁移。
 */
function sanitizeCoverSet(raw: unknown, keepPaths: boolean): CoverSet {
  const r = obj(raw)
  let items: CoverItem[] = []

  if (Array.isArray(r.items)) {
    items = r.items
      .slice(0, MAX_COVERS)
      .map((it, i) => sanitizeCoverItem(it, i, keepPaths))
  } else if (
    'enable' in r ||
    'title' in r ||
    'useDifferentMask' in r ||
    'titleFontSize' in r
  ) {
    // v1 → v2：单封面无损迁移
    items = [
      sanitizeCoverItem(
        {
          enabled: r.enable,
          title: r.title,
          subtitle: r.subtitle,
          titleFontSize: r.titleFontSize,
          titleWeight: r.titleWeight,
          layout: r.layout,
          color: '',
          useOwnMask: r.useDifferentMask,
          mask: r.mask,
          background: undefined,
        },
        0,
        keepPaths,
      ),
    ]
  }

  // 至少保留一张封面，避免界面出现空列表导致无法录入
  if (items.length === 0) {
    items = [sanitizeCoverItem(undefined, 0, keepPaths)]
  }

  const activeId =
    typeof r.activeId === 'string' && items.some((it) => it.id === r.activeId)
      ? r.activeId
      : items[0].id

  return { items, activeId }
}

// ---------------------------------------------------------------- 紧凑编码

/** 把蒙版编码为定长数组（用短码压缩枚举值） */
function encodeMask(mask: MaskConfig): unknown[] {
  switch (mask.type) {
    case 'card':
      return [
        'c',
        mask.color,
        r2(mask.alpha),
        r0(mask.radius),
        r0(mask.pad),
        r0(mask.blur),
        enc(CARD_POS, mask.position, 's'),
      ]
    case 'veil':
      return ['v', mask.color, r2(mask.alpha), r2(mask.topBoost), r2(mask.bottomBoost)]
    default:
      return [
        'g',
        enc(GRADIENT_DIR, (mask as GradientMask).direction, 'b'),
        mask.color,
        r2((mask as GradientMask).maxAlpha),
        r2((mask as GradientMask).solidRatio),
        r2((mask as GradientMask).transparentRatio),
      ]
  }
}

/**
 * 蒙版数组 → 原始对象（**刻意不做净化**的例外已收回：这里直接净化）。
 */
function decodeMask(raw: unknown, fallback: MaskConfig): MaskConfig {
  if (!Array.isArray(raw) || raw.length === 0) return fallback
  const type = dec(MASK_TYPE, raw[0], fallback.type)
  if (type === 'card') {
    return sanitizeMask(
      {
        type: 'card',
        color: raw[1],
        alpha: raw[2],
        radius: raw[3],
        pad: raw[4],
        blur: raw[5],
        position: dec(CARD_POS, raw[6], 'stretchToFill'),
      },
      fallback,
    )
  }
  if (type === 'veil') {
    return sanitizeMask(
      {
        type: 'veil',
        color: raw[1],
        alpha: raw[2],
        topBoost: raw[3],
        bottomBoost: raw[4],
      },
      fallback,
    )
  }
  return sanitizeMask(
    {
      type: 'gradient',
      direction: dec(GRADIENT_DIR, raw[1], 'bottom'),
      color: raw[2],
      maxAlpha: raw[3],
      solidRatio: raw[4],
      transparentRatio: raw[5],
    },
    fallback,
  )
}

function r0(v: number): number {
  return Math.round(v)
}
function r2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 截断尾部的默认值以压缩体积。解码端会按同样的默认值补齐缺失位置。 */
function trimTrailing(arr: unknown[], defaults: unknown[]): unknown[] {
  let last = arr.length - 1
  while (last >= 0 && arr[last] === defaults[last]) last--
  return arr.slice(0, last + 1)
}

/** 封面背景的编码默认值（写成短码形式，便于逐项比较） */
const BG_ENCODED_DEFAULTS: unknown[] = [
  0, 'c', 1, 0, 0, 1, 'n', '#000000', 0, 1, 1, 1, 0, 0,
]

function encodeCoverBackground(bg: CoverItem['background']): unknown[] {
  return trimTrailing(
    [
      bg.useOwn ? 1 : 0,
      enc(FILL_MODE, bg.fit, 'c'),
      r2(bg.scale),
      r2(bg.offsetX),
      r2(bg.offsetY),
      r2(bg.opacity),
      enc(BLEND, bg.blendMode, 'n'),
      bg.tintColor,
      r2(bg.tintAlpha),
      r2(bg.brightness),
      r2(bg.contrast),
      r2(bg.saturate),
      r0(bg.blur),
      r2(bg.vignette),
    ],
    BG_ENCODED_DEFAULTS,
  )
}

function decodeCoverBackground(raw: unknown, keepPaths: boolean): CoverBackground {
  const d = defaultCoverBackground()
  if (!Array.isArray(raw)) return d
  const g = (i: number, def: unknown): unknown => (raw[i] === undefined ? def : raw[i])
  // 解码后统一交给 sanitize 收口，保证夹取规则只有一处
  return sanitizeCoverBackground(
    {
      useOwn: g(0, 0) === 1,
      fit: dec(FILL_MODE, g(1, 'c'), 'cover'),
      scale: g(2, d.scale),
      offsetX: g(3, d.offsetX),
      offsetY: g(4, d.offsetY),
      opacity: g(5, d.opacity),
      blendMode: dec(BLEND, g(6, 'n'), 'normal'),
      tintColor: g(7, d.tintColor),
      tintAlpha: g(8, d.tintAlpha),
      brightness: g(9, d.brightness),
      contrast: g(10, d.contrast),
      saturate: g(11, d.saturate),
      blur: g(12, d.blur),
      vignette: g(13, d.vignette),
    },
    keepPaths,
  )
}

/** 单张封面 → 10 元数组。未启用独立蒙版时蒙版位编码为空数组以省体积。 */
function encodeCover(c: CoverItem): unknown[] {
  return [
    c.enabled ? 1 : 0,
    str(c.title, '', 200),
    str(c.subtitle, '', 200),
    r0(c.titleFontSize),
    r0(c.titleWeight),
    enc(COVER_LAYOUT, c.layout, 'c'),
    c.color || '',
    c.useOwnMask ? 1 : 0,
    c.useOwnMask ? encodeMask(c.mask) : [],
    encodeCoverBackground(c.background),
  ]
}

function decodeCover(raw: unknown, index: number, keepPaths: boolean): CoverItem {
  const d = defaultCoverItem(index + 1)
  if (!Array.isArray(raw)) return d
  const g = (i: number, def: unknown): unknown => (raw[i] === undefined ? def : raw[i])
  const useOwnMask = g(7, 0) === 1

  return {
    // id 是本地标识，不参与传输，导入时重新生成
    id: d.id,
    enabled: g(0, 1) === 1,
    title: str(g(1, d.title), d.title, 200),
    subtitle: str(g(2, d.subtitle), d.subtitle, 200),
    titleFontSize: int(g(3, d.titleFontSize), d.titleFontSize, 24, 300),
    titleWeight: pick(g(4, d.titleWeight), [400, 500, 700] as const, 700),
    layout: pick(dec(COVER_LAYOUT, g(5, 'c'), 'center'), ['center', 'top', 'bottom'], 'center'),
    color: typeof g(6, '') === 'string' && g(6, '') ? color(g(6, ''), '') : '',
    useOwnMask,
    mask: useOwnMask ? decodeMask(raw[8], defaultCoverMask()) : defaultCoverMask(),
    background: decodeCoverBackground(raw[9], keepPaths),
  }
}

/**
 * 配置 → 位置数组（协议 v2）。
 *
 * 顺序即协议，**改动必须同步递增 SHARE_PAYLOAD_VERSION 并保留旧版解码分支**，
 * 否则老分享码会解出一堆错位的值。
 */
function configToArray(cfg: StyleConfig): unknown[] {
  return [
    SHARE_PAYLOAD_VERSION,
    enc(PRESET, cfg.canvas.preset, '0'),
    r0(cfg.canvas.width),
    r0(cfg.canvas.height),
    r0(cfg.canvas.scale),
    enc(FORMAT, cfg.canvas.format, 'p'),
    r2(cfg.canvas.quality),

    enc(FILL_MODE, cfg.background.fillMode, 'c'),
    r2(cfg.background.brightness),
    r2(cfg.background.contrast),
    r2(cfg.background.saturate),
    r0(cfg.background.blur),
    r2(cfg.background.vignette),
    r2(cfg.background.offsetX),
    r2(cfg.background.offsetY),

    enc(MASK_TYPE, cfg.mask.type, 'c'),

    str(cfg.text.fontFamily, '', 100),
    enc(FONT_SOURCE, cfg.text.fontSource, 's'),
    r0(cfg.text.fontSize),
    r0(cfg.text.fontWeight),
    cfg.text.color,
    r2(cfg.text.lineHeightRatio),
    r2(cfg.text.letterSpacing),
    r2(cfg.text.paragraphSpacingRatio),
    enc(ALIGN, cfg.text.textAlign, 'l'),
    r2(cfg.text.textIndent),
    r0(cfg.text.padding),
    r0(cfg.text.minOrphanLines),

    cfg.constraint.enable ? 1 : 0,
    r0(cfg.constraint.minPages),
    r0(cfg.constraint.maxPages),

    str(cfg.export.filenameTemplate, '{index}', 120),
    cfg.export.alsoZip ? 1 : 0,
    r0(cfg.export.pad),

    encodeMask(cfg.mask),
    cfg.cover.items.map(encodeCover),

    // ---- v3 追加：渠道节（O-03）。追加在尾部，旧版解码器按自身长度校验拒绝或忽略
    str(cfg.channel.name, '', 60),
    str(cfg.channel.subfolderPattern, '', 120),
    cfg.channel.sizes.map((s) => [s.id, s.label, r0(s.width), r0(s.height)]),
  ]
}

/** v2 位置数组 → 配置对象 */
function v2ArrayToConfig(arr: unknown[]): Record<string, unknown> {
  const at = (i: number): unknown => arr[i]
  const coverList = Array.isArray(at(35)) ? (at(35) as unknown[]) : []

  return {
    canvas: {
      preset: dec(PRESET, at(1), 'custom'),
      width: at(2),
      height: at(3),
      scale: at(4),
      format: dec(FORMAT, at(5), 'png'),
      quality: at(6),
    },
    background: {
      fillMode: dec(FILL_MODE, at(7), 'cover'),
      brightness: at(8),
      contrast: at(9),
      saturate: at(10),
      blur: at(11),
      vignette: at(12),
      offsetX: at(13),
      offsetY: at(14),
    },
    mask: decodeMask(at(34), defaultMaskOfType('card')),
    text: {
      fontFamily: at(16),
      fontSource: dec(FONT_SOURCE, at(17), 'system'),
      fontSize: at(18),
      fontWeight: at(19),
      color: at(20),
      lineHeightRatio: at(21),
      letterSpacing: at(22),
      paragraphSpacingRatio: at(23),
      textAlign: dec(ALIGN, at(24), 'left'),
      textIndent: at(25),
      padding: at(26),
      minOrphanLines: at(27),
    },
    cover: {
      items: coverList.map((c, i) => decodeCover(c, i, false)),
      activeId: '',
    },
    constraint: {
      enable: at(28) === 1,
      minPages: at(29),
      maxPages: at(30),
    },
    export: {
      filenameTemplate: at(31),
      alsoZip: at(32) === 1,
      pad: at(33),
    },
  }
}

/** v3 位置数组 → 配置对象（在 v2 基础上尾部追加渠道节） */
function v3ArrayToConfig(arr: unknown[]): Record<string, unknown> {
  const base = v2ArrayToConfig(arr)
  const rawSizes = Array.isArray(arr[38]) ? (arr[38] as unknown[]) : []

  return {
    ...base,
    channel: {
      name: arr[36],
      subfolderPattern: arr[37],
      sizes: rawSizes.map((s) => {
        const e = Array.isArray(s) ? (s as unknown[]) : []
        return { id: e[0], label: e[1], width: e[2], height: e[3] }
      }),
    },
    // overlay 含本机路径，不进分享码；缺失时 sanitizeConfig 补默认空列表
  }
}

/**
 * v1 位置数组 → 配置对象（历史格式，字段索引与 v2 不同）。
 *
 * 产出的是 v1 的单封面结构，交给 sanitizeCoverSet 自动迁移成 v2 的封面集合。
 * 保留这条分支是为了让旧分享码继续可用。
 */
function legacyV1ArrayToConfig(arr: unknown[]): Record<string, unknown> {
  const at = (i: number): unknown => arr[i]
  return {
    canvas: {
      preset: dec(PRESET, at(1), 'custom'),
      width: at(2),
      height: at(3),
      scale: at(4),
      format: dec(FORMAT, at(5), 'png'),
      quality: at(6),
    },
    background: {
      fillMode: dec(FILL_MODE, at(7), 'cover'),
      brightness: at(8),
      contrast: at(9),
      saturate: at(10),
      blur: at(11),
      vignette: at(12),
      offsetX: at(13),
      offsetY: at(14),
    },
    mask: decodeMask(at(41), defaultMaskOfType('card')),
    text: {
      fontFamily: at(16),
      fontSource: dec(FONT_SOURCE, at(17), 'system'),
      fontSize: at(18),
      fontWeight: at(19),
      color: at(20),
      lineHeightRatio: at(21),
      letterSpacing: at(22),
      paragraphSpacingRatio: at(23),
      textAlign: dec(ALIGN, at(24), 'left'),
      textIndent: at(25),
      padding: at(26),
      minOrphanLines: at(27),
    },
    // 刻意用 v1 的字段名，让 sanitizeCoverSet 走迁移分支
    cover: {
      enable: at(28) === 1,
      title: at(29),
      subtitle: at(30),
      titleFontSize: at(31),
      titleWeight: at(32),
      layout: dec(COVER_LAYOUT, at(33), 'center'),
      useDifferentMask: at(34) === 1,
      mask: decodeMask(at(42), defaultMaskOfType('card')),
    },
    constraint: {
      enable: at(35) === 1,
      minPages: at(36),
      maxPages: at(37),
    },
    export: {
      filenameTemplate: at(38),
      alsoZip: at(39) === 1,
      pad: at(40),
    },
  }
}

/**
 * 各版本位置数组的最小长度。
 * 校验这个长度可以挡住字段错位的旧版本分享码。
 */
const ARRAY_MIN_LENGTH_V1 = 43
const ARRAY_MIN_LENGTH_V2 = 36
const ARRAY_MIN_LENGTH_V3 = 39

// ---------------------------------------------------------------- Base64URL

/** 字符串 → URL 安全的 Base64（去掉填充，换成 - 与 _） */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (normalized.length % 4)) % 4
  const binary = atob(normalized + '='.repeat(padLen))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

// ---------------------------------------------------------------- 对外 API

/** 生成一个分享码。形如 TW1-eyJ... 可直接粘贴传递 */
export function encodeShareCode(config: StyleConfig, name: string): string {
  const envelope = [name.slice(0, 60), Math.floor(Date.now() / 1000), configToArray(config)]
  return SHARE_CODE_PREFIX + toBase64Url(JSON.stringify(envelope))
}

export interface DecodedTemplate {
  name: string
  config: StyleConfig
  ts: number
}

/**
 * 解析分享内容。自动识别两种形态：
 *   - 分享码：以 TW1- 开头
 *   - JSON 载荷：完整的 { $tw: 'template', ... } 对象（导出的文件内容）
 * 解析失败一律抛出带说明的错误，不做「静默导入个默认配置」这种坑人的事。
 */
export function decodeSharePayload(input: string): DecodedTemplate {
  const text = (input || '').trim()
  if (!text) {
    throw new Error('分享内容为空')
  }

  if (text.startsWith(SHARE_CODE_PREFIX)) {
    return decodeShareCode(text)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('无法识别的内容：既不是分享码，也不是合法的 JSON')
  }
  return decodeJsonPayload(parsed)
}

function decodeShareCode(code: string): DecodedTemplate {
  const body = code.slice(SHARE_CODE_PREFIX.length)
  let decoded: string
  try {
    decoded = fromBase64Url(body)
  } catch {
    throw new Error('分享码格式损坏，无法解码')
  }

  let envelope: unknown
  try {
    envelope = JSON.parse(decoded)
  } catch {
    throw new Error('分享码内容损坏，无法解析')
  }

  if (!Array.isArray(envelope) || envelope.length < 3) {
    throw new Error('分享码结构不完整')
  }

  const [name, ts, arr] = envelope as [unknown, unknown, unknown]
  if (!Array.isArray(arr)) {
    throw new Error('分享码缺少配置数据')
  }

  const version = arr[0]
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('分享码缺少有效的版本标识，内容可能已损坏')
  }
  if (version > SHARE_PAYLOAD_VERSION) {
    throw new Error(
      `分享码版本 ${version} 高于当前应用支持的版本 ${SHARE_PAYLOAD_VERSION}，请升级应用后再导入`,
    )
  }

  // 按版本选择长度下限与解码分支：v1 / v2 / v3 的字段索引不同（v3 是 v2 的尾部追加）
  const minLength =
    version >= 3 ? ARRAY_MIN_LENGTH_V3 : version >= 2 ? ARRAY_MIN_LENGTH_V2 : ARRAY_MIN_LENGTH_V1
  if (arr.length < minLength) {
    throw new Error(
      `分享码字段数量不足（${arr.length} < ${minLength}），可能来自不兼容的版本`,
    )
  }

  const raw =
    version >= 3 ? v3ArrayToConfig(arr) : version >= 2 ? v2ArrayToConfig(arr) : legacyV1ArrayToConfig(arr)

  return {
    name: str(name, '未命名模板', 60) || '未命名模板',
    ts: typeof ts === 'number' ? ts * 1000 : Date.now(),
    // 外部内容一律走不保留本机路径的净化
    config: sanitizeConfig(raw),
  }
}

function decodeJsonPayload(parsed: unknown): DecodedTemplate {
  const p = obj(parsed)

  if (p.$tw !== 'template') {
    throw new Error('这不是文织的模板文件（缺少 $tw 标识）')
  }
  const version = num(p.v, 0, 0, 999)
  if (version > SHARE_PAYLOAD_VERSION) {
    throw new Error(
      `模板版本 ${version} 高于当前应用支持的版本 ${SHARE_PAYLOAD_VERSION}，请升级应用后再导入`,
    )
  }

  return {
    name: str(p.name, '未命名模板', 60) || '未命名模板',
    ts: num(p.ts, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    config: sanitizeConfig(p.config),
  }
}

/** 构造可归档、可读的 JSON 载荷（导出为 .json 文件时使用） */
export function buildSharePayload(config: StyleConfig, name: string): TemplateSharePayload {
  return {
    $tw: 'template',
    v: SHARE_PAYLOAD_VERSION,
    name: name || '未命名模板',
    ts: Date.now(),
    config: sanitizeConfig(config),
  }
}

/** 生成模板 id。用时间戳 + 随机后缀，避免依赖 crypto.randomUUID 的可用性 */
export function makeTemplateId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `t${Date.now().toString(36)}${rand}`
}

/** 估算分享码长度，用于界面提示 */
export function shareCodeLength(config: StyleConfig, name: string): number {
  return encodeShareCode(config, name).length
}
