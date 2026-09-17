/**
 * 全局数据契约。
 *
 * 对应产品方案 5.12。所有渲染与排版逻辑共享这里的类型定义，
 * core/ 层只操作 Line / Block / Page 这些纯数据结构，不接触 canvas。
 */

// ------------------------------------------------------------------ 枚举

export type FillMode = 'cover' | 'contain' | 'stretch'
export type MaskType = 'card' | 'veil' | 'gradient'
export type TextAlign = 'left' | 'justify' | 'center'
export type OutputFormat = 'png' | 'jpeg' | 'webp'
export type CoverLayout = 'center' | 'top' | 'bottom'
export type GradientDirection = 'top' | 'bottom' | 'both'
export type CardPosition = 'stretchToFill' | 'center' | 'top' | 'bottom'
export type FontSource = 'system' | 'user'

// ------------------------------------------------------------------ 画布

export interface CanvasConfig {
  /** 手机尺寸预设 id，手改宽高后变为 custom */
  preset: string
  width: number
  height: number
  /** 像素倍率，实际画布 = 宽高 × scale */
  scale: number
  format: OutputFormat
  quality: number
}

// ------------------------------------------------------------------ 背景图

export interface BackgroundConfig {
  fillMode: FillMode
  brightness: number
  contrast: number
  saturate: number
  blur: number
  /** 暗角强度 0~1 */
  vignette: number
  /** cover 裁剪后的取景微调，-1 ~ 1 */
  offsetX: number
  offsetY: number
}

// ------------------------------------------------------------------ 蒙版

export interface CardMask {
  type: 'card'
  color: string
  alpha: number
  radius: number
  /** 卡片内边距，决定可用文字区大小 */
  pad: number
  /** 卡片区域毛玻璃强度 */
  blur: number
  position: CardPosition
}

export interface VeilMask {
  type: 'veil'
  color: string
  alpha: number
  topBoost: number
  bottomBoost: number
}

export interface GradientMask {
  type: 'gradient'
  direction: GradientDirection
  color: string
  maxAlpha: number
  /**
   * 从锚定边算起、达到 maxAlpha 的位置比例。
   * 数值越小遮罩越贴近边缘。
   */
  solidRatio: number
  /**
   * 从锚定边算起、alpha 归零的位置比例。必须大于 solidRatio。
   * 该值决定了可用文字区的上界：availH = H × (1 − transparentRatio) − padding × 2
   */
  transparentRatio: number
}

export type MaskConfig = CardMask | VeilMask | GradientMask

// ------------------------------------------------------------------ 文字

export interface TextConfig {
  fontFamily: string
  fontSource: FontSource
  /** 用户字体的文件路径，系统字体为空 */
  fontPath: string
  fontSize: number
  fontWeight: number
  color: string
  lineHeightRatio: number
  letterSpacing: number
  paragraphSpacingRatio: number
  textAlign: TextAlign
  /** 首行缩进（字符数） */
  textIndent: number
  /** 文字区外边距，四边统一 */
  padding: number
  /** 孤寡行保护阈值 */
  minOrphanLines: number
}

// ------------------------------------------------------------------ 封面

/** 封面背景图与正文背景图的叠加方式（对应 ctx.globalCompositeOperation） */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'darken'
  | 'lighten'
  | 'color'
  | 'standalone'

/**
 * 封面专属背景图。
 *
 * `useOwn` 为 false 时整块配置被忽略，直接沿用正文背景图。
 * 为 true 时：先铺正文背景（作为底），再按 opacity / blendMode 叠上封面图，
 * 最后叠 tintColor 单色层。「叠加效果」正是由这三层实现的。
 *
 * 例外：blendMode 为 `standalone`（独立不叠加）时封面图**不走三层合成**，
 * 直接作为底层铺画，正文背景完全不参与 —— 见 render/background.ts。
 */
export interface CoverBackground {
  useOwn: boolean
  /** 本机绝对路径，不参与分享与模板导出 */
  path: string
  /** 仅用于界面展示 */
  name: string
  /** 填满方式，与正文背景一致 */
  fit: FillMode
  /** 在 fit 基础上的额外缩放，0.1~5 */
  scale: number
  /** 相对偏移，-1~1 */
  offsetX: number
  offsetY: number
  /** 不透明度 0~1 */
  opacity: number
  /** 与下方正文背景的混合模式 */
  blendMode: BlendMode
  /** 单色叠加层颜色 */
  tintColor: string
  /** 单色叠加层浓度 0~1 */
  tintAlpha: number
  brightness: number
  contrast: number
  saturate: number
  blur: number
  vignette: number
}

/** 一张封面 */
export interface CoverItem {
  id: string
  /** 是否参与输出 */
  enabled: boolean
  title: string
  subtitle: string
  titleFontSize: number
  titleWeight: number
  layout: CoverLayout
  /** 主标题颜色覆盖；空串表示沿用正文文字颜色 */
  color: string
  /** 是否使用独立蒙版；false 时沿用正文蒙版 */
  useOwnMask: boolean
  mask: MaskConfig
  background: CoverBackground
}

/** 封面集合 */
export interface CoverSet {
  items: CoverItem[]
  /** 当前正在编辑的封面 id */
  activeId: string
}

// ------------------------------------------------------------------ 目标张数约束

export interface ConstraintConfig {
  enable: boolean
  minPages: number
  maxPages: number
}

// ------------------------------------------------------------------ 导出

export interface ExportConfig {
  dir: string
  /** 支持 {index} {total} {title} {date} */
  filenameTemplate: string
  /** 导出完成后附加打包一份 zip */
  alsoZip: boolean
  /** 文件名序号补零位数 */
  pad: number
}

// ------------------------------------------------------------------ 顶层配置

export interface StyleConfig {
  canvas: CanvasConfig
  background: BackgroundConfig
  mask: MaskConfig
  text: TextConfig
  cover: CoverSet
  constraint: ConstraintConfig
  export: ExportConfig
}

// ------------------------------------------------------------------ 布局树（core 层产出）

export interface Line {
  text: string
  width: number
}

export interface Block {
  type: 'paragraph'
  lines: Line[]
  /** 仅正文块使用 */
  paraIndex: number
  /** 该段落是否被切分过（用于诊断） */
  isPartial?: boolean
  /** 块是否为某段落的首块 / 末块，用于首行缩进判断 */
  isParaStart: boolean
  isParaEnd: boolean
}

export interface Page {
  index: number
  kind: 'cover' | 'content'
  blocks: Block[]
  /** 仅封面页：对应的封面 id，用于渲染时取该封面的背景与样式 */
  coverId?: string
  /** 仅封面页 */
  titleLines?: Line[]
  subtitleLines?: Line[]
  /** 内容高度（不含末尾段间距） */
  usedHeight: number
}

// ------------------------------------------------------------------ 诊断

export type PageStatus = 'sparse' | 'normal' | 'dense' | 'overflow'

export interface PageDiagnostic {
  index: number
  /** 填充率 0~1 */
  fillRate: number
  status: PageStatus
  usedHeight: number
  availHeight: number
}

export interface Diagnostics {
  totalPages: number
  pages: PageDiagnostic[]
  /** 被切分过的段落数 */
  splitParagraphs: number
  /** 禁则修正次数 */
  prohibitionFixes: number
  /** 是否违反了张数约束 */
  constraintViolated: boolean
  /** 约束求解后的实际生效参数 */
  applied: AppliedParams
  /** 耗时（毫秒） */
  elapsedMs: number
}

export interface AppliedParams {
  fontSize: number
  padding: number
  maskPad: number
  lineHeightRatio: number
  paragraphSpacingRatio: number
  /** 是否为了压张数而收紧了段间距 */
  tightenedSpacing: boolean
}

// ------------------------------------------------------------------ 几何

export interface Geometry {
  fontSize: number
  padding: number
  maskPad: number
  availW: number
  availH: number
  lineHeight: number
  paragraphSpacing: number
}

// ------------------------------------------------------------------ 后端返回类型

export interface FontEntry {
  family: string
  path: string
  source: FontSource
  hasCJK: boolean
  /** false 表示未能完成字形校验（woff2 需要前端二次确认） */
  verified: boolean
  bytes: number
}

export interface ImageInfo {
  path: string
  name: string
  width: number
  height: number
  aspect: string
  format: string
  bytes: number
  mime: string
}

export interface PyStatus {
  available: boolean
  python: string
  version: string
  scriptDir: string
  message: string
}

// ------------------------------------------------------------------ 画布预设

export interface CanvasPreset {
  id: string
  label: string
  width: number
  height: number
  note: string
}

/** 全部为手机尺寸画布。默认取 9:16 经典竖屏（对应决策 D-10）。 */
export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'phone-9x16', label: '经典竖屏', width: 1080, height: 1920, note: '9:16 · 最通用' },
  { id: 'phone-195x9', label: '全面屏', width: 1080, height: 2340, note: '19.5:9 · 现代安卓' },
  { id: 'phone-iphone', label: 'iPhone 15/16', width: 1179, height: 2556, note: '19.5:9 · 原生分辨率' },
  { id: 'phone-2k', label: '2K 全面屏', width: 1440, height: 3200, note: '20:9 · 高清壁纸' },
]

// ------------------------------------------------------------------ 默认配置

export function defaultMask(): MaskConfig {
  return {
    type: 'card',
    color: '#000000',
    alpha: 0.55,
    radius: 24,
    pad: 48,
    blur: 0,
    position: 'stretchToFill',
  }
}

export function defaultVeilMask(): VeilMask {
  return {
    type: 'veil',
    color: '#000000',
    alpha: 0.4,
    topBoost: 0,
    bottomBoost: 0,
  }
}

export function defaultGradientMask(): GradientMask {
  return {
    type: 'gradient',
    direction: 'bottom',
    color: '#000000',
    maxAlpha: 0.85,
    solidRatio: 0.1,
    transparentRatio: 0.4,
  }
}

/** 切换蒙版类型时使用的默认参数，保证各形态一上手就有合理效果。 */
export function defaultMaskOfType(type: MaskType): MaskConfig {
  switch (type) {
    case 'veil':
      return defaultVeilMask()
    case 'gradient':
      return defaultGradientMask()
    default:
      return defaultMask()
  }
}

/** 封面默认蒙版浓度比正文更浓，让大标题更醒目 */
export function defaultCoverMask(): MaskConfig {
  return {
    type: 'card',
    color: '#000000',
    alpha: 0.65,
    radius: 24,
    pad: 48,
    blur: 0,
    position: 'stretchToFill',
  }
}

/** 可选的叠加模式，附带中文标签供界面使用 */
export const BLEND_MODES: ReadonlyArray<{ value: BlendMode; label: string }> = [
  { value: 'standalone', label: '独立（不叠加）' },
  { value: 'normal', label: '正常' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'overlay', label: '叠加' },
  { value: 'soft-light', label: '柔光' },
  { value: 'darken', label: '变暗' },
  { value: 'lighten', label: '变亮' },
  { value: 'color', label: '着色' },
]

export function defaultCoverBackground(): CoverBackground {
  return {
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
  }
}

export function defaultCoverItem(index = 1): CoverItem {
  return {
    id: `cover-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    title: index === 1 ? '' : `封面 ${index}`,
    subtitle: '',
    titleFontSize: 96,
    titleWeight: 700,
    layout: 'center',
    color: '',
    useOwnMask: false,
    mask: defaultCoverMask(),
    background: defaultCoverBackground(),
  }
}

export function defaultCoverSet(): CoverSet {
  const first = defaultCoverItem(1)
  return { items: [first], activeId: first.id }
}

/** 可用的背景混合模式（供 canvas 直接使用的取值） */
/**
 * blendMode → canvas 混合模式。`standalone` 不参与混合，任何调用方
 * 误把它传进来时退化为 source-over，绝不会产出非法的 composite 值。
 */
export function toCompositeOperation(mode: BlendMode): GlobalCompositeOperation {
  return mode === 'normal' || mode === 'standalone'
    ? 'source-over'
    : (mode as GlobalCompositeOperation)
}

export function defaultConfig(): StyleConfig {
  return {
    canvas: {
      preset: 'phone-9x16',
      width: 1080,
      height: 1920,
      scale: 1,
      format: 'png',
      quality: 0.92,
    },
    background: {
      fillMode: 'cover',
      brightness: 1,
      contrast: 1,
      saturate: 1,
      blur: 0,
      vignette: 0,
      offsetX: 0,
      offsetY: 0,
    },
    mask: defaultMask(),
    text: {
      fontFamily: '',
      fontSource: 'system',
      fontPath: '',
      fontSize: 48,
      fontWeight: 400,
      color: '#FFFFFF',
      lineHeightRatio: 1.75,
      letterSpacing: 0,
      paragraphSpacingRatio: 0.9,
      textAlign: 'left',
      textIndent: 0,
      padding: 96,
      minOrphanLines: 2,
    },
    cover: defaultCoverSet(),
    constraint: {
      enable: true,
      minPages: 1,
      maxPages: 18,
    },
    export: {
      dir: '',
      filenameTemplate: '{index}',
      alsoZip: false,
      pad: 2,
    },
  }
}

/** 读取字形校验所需的最少采样汉字数 */
export const CJK_SAMPLE = '中文字体测试汉阅读'

// ------------------------------------------------------------------ 模板

/** 模板列表项（不含完整配置，用于列表渲染） */
export interface TemplateMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** 生成时的画布尺寸，列表里作为副标题展示 */
  canvas: { width: number; height: number }
  maskType: MaskType
}

/** 完整模板 = 元信息 + 配置快照 */
export interface Template extends TemplateMeta {
  config: StyleConfig
}

/** 模板分享载荷（导出为 .json 时使用，可读、可归档） */
export interface TemplateSharePayload {
  /** 协议标识，用于识别本应用的分享内容 */
  $tw: 'template'
  /** 载荷版本，用于未来兼容迁移 */
  v: number
  name: string
  /** 创建时间戳 */
  ts: number
  config: StyleConfig
}

/** 分享码前缀。带前缀的短串走紧凑编码，其余按 JSON 解析 */
export const SHARE_CODE_PREFIX = 'TW1-'

/**
 * 分享载荷版本。
 *  v1 —— 单封面结构（cover.enable / title / ...）
 *  v2 —— 封面集合结构（cover.items[]，每张封面带独立背景）
 * 解码端必须保留旧版分支，否则老分享码会解出一堆错位的值。
 */
export const SHARE_PAYLOAD_VERSION = 2

/** 封面数量上限 */
export const MAX_COVERS = 20

/** 模板存储的 schema 版本，用于本地数据迁移 */
export const TEMPLATE_STORE_VERSION = 1

/** 本地模板数量上限，防止 localStorage 被写满 */
export const MAX_TEMPLATES = 60

/** localStorage 的键名 */
export const TEMPLATE_STORAGE_KEY = 'textweave.templates.v1'
