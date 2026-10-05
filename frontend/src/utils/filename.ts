/**
 * 输出文件名模板渲染。
 *
 * 变量：{index} {total} {title} {date} {book} {channel} {size}
 * 后三个为渠道批量产出扩展（对应痛点 P-07 / 优化项 O-02）：
 *   {book}    任务标签·书名
 *   {channel} 任务标签·渠道
 *   {size}    多尺寸导出时的尺寸标签
 */

export interface FilenameVars {
  index: number
  total: number
  title: string
  date: Date
  /** 序号补零位数 */
  pad: number
  /** 任务标签：书名 */
  book?: string
  /** 任务标签：渠道 */
  channel?: string
  /** 多尺寸导出的尺寸标签 */
  size?: string
}

/** 去掉文件系统中非法的字符，并限制长度。 */
export function sanitizeFilename(name: string, maxLength = 60): string {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 渲染文件名模板，返回不含扩展名的名字。 */
export function renderFilenameTemplate(template: string, vars: FilenameVars): string {
  const tpl = (template || '').trim() || '{index}'
  const index = String(vars.index).padStart(Math.max(1, vars.pad), '0')

  const out = tpl
    .replace(/\{index\}/g, index)
    .replace(/\{total\}/g, String(vars.total))
    .replace(/\{title\}/g, sanitizeFilename(vars.title, 40))
    .replace(/\{date\}/g, formatDate(vars.date))
    .replace(/\{book\}/g, sanitizeFilename(vars.book ?? '', 40))
    .replace(/\{channel\}/g, sanitizeFilename(vars.channel ?? '', 40))
    .replace(/\{size\}/g, sanitizeFilename(vars.size ?? '', 40))

  const safe = sanitizeFilename(out, 80)
  return safe || index
}

/** 渲染完整文件名（含扩展名）。 */
export function buildFilename(
  template: string,
  vars: FilenameVars,
  ext: string,
): string {
  const base = renderFilenameTemplate(template, vars)
  const cleanExt = ext.replace(/^\./, '')
  return `${base}.${cleanExt}`
}

/** 输出格式对应的扩展名。 */
export function extForFormat(format: string): string {
  switch (format) {
    case 'jpeg':
      return 'jpg'
    case 'webp':
      return 'webp'
    default:
      return 'png'
  }
}

/** 子目录模板可用的变量（无需 index/total） */
export interface SubfolderVars {
  book?: string
  channel?: string
  size?: string
  date: Date
}

/**
 * 渲染导出子目录模板，返回相对 base 目录的子路径（可为空串）。
 *
 * 规则：
 *  - 以 / 分层，每层独立净化（去非法字符、限长）；
 *  - 净化后为空的层直接丢弃（例如未填书名时 {book} 层不会变成空目录）；
 *  - 全部为空时返回空串，表示不建子目录；
 *  - 最多保留 4 层，防止模板注入超深层级。
 */
export function renderSubfolder(template: string, vars: SubfolderVars): string {
  const tpl = (template || '').trim()
  if (!tpl) return ''

  const date = formatDate(vars.date)
  const resolved = tpl
    .replace(/\{book\}/g, vars.book ?? '')
    .replace(/\{channel\}/g, vars.channel ?? '')
    .replace(/\{size\}/g, vars.size ?? '')
    .replace(/\{date\}/g, date)

  const parts = resolved
    .split(/[\\/]+/)
    .map((seg) => sanitizeFilename(seg, 40))
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')

  return parts.slice(0, 4).join('/')
}

/**
 * 把相对子路径拼到基础目录后面，返回可直接交给后端 SaveImage 的目录。
 * 统一使用 / 分隔（Windows 文件 API 同样接受），空 sub 原样返回 base。
 */
export function joinDir(base: string, sub: string): string {
  const b = (base || '').replace(/[\\/]+$/, '')
  const s = (sub || '').replace(/\\/g, '/').replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
  if (!s) return b
  if (!b) return s
  return `${b}/${s}`
}
